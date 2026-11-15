// lib/glass/ab-cli.mjs — `glass ab`: run an A/B experiment, list them, report one.
//
//   glass ab run --agent pi|opencode|claude|copilot --variant <label>=<provider>/<model> (twice or more)
//                --prompt "…" | --prompt-file <f>  [--repeats N] [--check "<cmd>"] [--repo <dir>]
//                [--label <name>] [--timeout <s>] [--check-timeout <s>] [--seed N] [--keep]
//                [--agent-arg <arg>]…
//   glass ab list [--json]
//   glass ab report [<id>|latest] [--json|--csv]
//
// A trial: a fresh copy of the repository (its uncommitted and untracked changes
// included), a glass session of its own (tagged with the experiment, variant and
// trial), the agent run non-interactively in that copy with its output kept,
// then the check, also in the copy. Its exit code is the trial's pass or fail.
// The copy is removed afterwards unless --keep.
//
// The daemon measures every call as for `glass <agent>`; the report joins the
// experiment file to the token DB by task id, through the daemon (GET /api/ab/<id>),
// so the CLI and the UI's A/B page read one computation.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

import { glassHome, glassPaths, glassPort } from './home.mjs';
import { closeSession, openSession } from './client.mjs';
import { sessionEnv } from './wiring.mjs';
import { sessionRelays } from './coexist.mjs';
import { proxyEnvOf } from './egress.mjs';
import { cmdLine } from './spawn.mjs';
import {
  AB_AGENTS, agentArgs, experimentId, formatReport, parseVariant, reportCsv, runExperiment, saveExperiment, schedule,
  seededRandom, trialDir,
} from './ab.mjs';

const HELP = `glass ab — the same agent and prompt on two or more models, measured side by side

  glass ab run --agent pi --variant base=local-llama/Qwen/Qwen3.5-4B --variant tuned=cluster/my-adapter \\
               --prompt "Fix the failing test in cart.py" --check "python -m pytest -q" --repeats 3
  glass ab list [--json]                       experiments, newest first
  glass ab report [<id>|latest] [--json|--csv] the comparison (also: glass ui → A/B)

run options
  --agent <a>          ${AB_AGENTS.join(' | ')}
  --variant <l>=<p>/<m> label = provider/model as the agent names them (claude, copilot: label=model);
                       give it once per variant, at least twice
  --prompt <text>      the task (or --prompt-file <file>)
  --repeats <n>        rounds; each round runs every variant once, in a random order (default 1)
  --check <cmd>        run in the trial's copy after the agent; exit 0 = pass. Without it there
                       is no pass rate: glass has no judge of its own
  --repo <dir>         the repository each trial copies (default: here), uncommitted changes included
  --label <name>       a name for the experiment
  --timeout <s>        per agent run (default 1800); --check-timeout <s> per check (default 600)
  --seed <n>           the order's random seed (default: random, recorded)
  --keep               keep each trial's copy (default: removed after its check)
  --agent-arg <arg>    one more argument for the agent (repeatable)`;

function parseArgs(argv) {
  const a = { variants: [], agentArgs: [], flags: new Set() };
  const value = ['--agent', '--prompt', '--prompt-file', '--repeats', '--check', '--repo', '--label', '--timeout', '--check-timeout', '--seed'];
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--variant') a.variants.push(argv[++i]);
    else if (k === '--agent-arg') a.agentArgs.push(argv[++i]);
    else if (value.includes(k)) {
      if (argv[i + 1] === undefined) throw new Error(`${k} needs a value`);
      a[k.slice(2)] = argv[++i];
    } else if (k.startsWith('--')) a.flags.add(k);
    else (a.positional ||= []).push(k);
  }
  return a;
}

const positiveInt = (raw, name, fallback) => {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} must be a positive integer`);
  return n;
};

/** The experiment a `glass ab run` command line describes (validated; throws a usage error). */
export function experimentFromArgs(argv, { cwd = process.cwd(), now = new Date(), random = Math.random } = {}) {
  const a = parseArgs(argv);
  if (!AB_AGENTS.includes(a.agent)) throw new Error(`--agent must be one of ${AB_AGENTS.join(', ')}`);
  const variants = a.variants.map((v) => parseVariant(v, a.agent));
  if (variants.length < 2) throw new Error('give --variant at least twice');
  const labels = new Set(variants.map((v) => v.label));
  if (labels.size !== variants.length) throw new Error('each --variant needs its own label');
  const prompt = a['prompt-file'] ? fs.readFileSync(path.resolve(cwd, a['prompt-file']), 'utf8').trim() : a.prompt;
  if (!prompt) throw new Error('--prompt (or --prompt-file) is required');
  const repo = path.resolve(cwd, a.repo || '.');
  if (!fs.existsSync(repo) || !fs.statSync(repo).isDirectory()) throw new Error(`--repo ${repo} is not a directory`);
  const repeats = positiveInt(a.repeats, '--repeats', 1);
  const seed = a.seed === undefined ? Math.floor(random() * 2 ** 31) : Number(a.seed);
  if (!Number.isInteger(seed)) throw new Error('--seed must be an integer');
  return {
    id: experimentId(now), label: a.label || '', agent: a.agent, prompt, check: a.check || null, repo,
    repeats, seed, timeout_s: positiveInt(a.timeout, '--timeout', 1800), check_timeout_s: positiveInt(a['check-timeout'], '--check-timeout', 600),
    keep: a.flags.has('--keep'), agent_args: a.agentArgs,
    variants, plan: schedule(variants, repeats, seededRandom(seed)), trials: [],
    status: 'planned', pid: process.pid, created_at: now.toISOString(), finished_at: null,
  };
}

// ── the working copy ──

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  return r.status === 0 ? r.stdout : null;
}
const zlist = (s) => (s || '').split('\0').filter(Boolean);

/**
 * A copy of `repo` at `dest` as the user has it now: for a git checkout, a clone
 * at HEAD (sharing the objects, so it is quick) with every path that differs
 * from HEAD — staged, unstaged, deleted — and every untracked, not ignored file
 * laid over it. Ignored files (node_modules, .venv, build output) are not
 * copied. Anything else: a plain recursive copy.
 * @returns {string} the directory the agent starts in (the repo's place in the copy)
 */
export function prepareWorkspace(repo, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const top = git(['rev-parse', '--show-toplevel'], repo)?.trim();
  if (!top) {
    fs.cpSync(repo, dest, { recursive: true, verbatimSymlinks: true });
    return dest;
  }
  const head = git(['rev-parse', '--verify', '-q', 'HEAD'], top)?.trim();
  if (git(['clone', '--quiet', '--shared', '--no-checkout', top, dest], top) === null) throw new Error(`git clone of ${top} failed`);
  if (head) {
    const branch = git(['symbolic-ref', '--short', '-q', 'HEAD'], top)?.trim();
    const ok = branch ? git(['checkout', '--quiet', '-B', branch, head], dest) : git(['checkout', '--quiet', '--detach', head], dest);
    if (ok === null) throw new Error(`checkout of ${head} in the copy failed`);
  }
  const changed = head ? zlist(git(['diff', '--name-only', '--no-renames', '-z', 'HEAD'], top)) : zlist(git(['ls-files', '-z'], top));
  const untracked = zlist(git(['ls-files', '-z', '--others', '--exclude-standard'], top));
  for (const rel of new Set([...changed, ...untracked])) {
    const from = path.join(top, rel);
    const to = path.join(dest, rel);
    if (fs.existsSync(from) || isLink(from)) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.cpSync(from, to, { recursive: true, verbatimSymlinks: true, force: true });
    } else {
      fs.rmSync(to, { force: true, recursive: true });
    }
  }
  // git names the top by its real path (/private/var/… on macOS for /var/…).
  return path.join(dest, path.relative(fs.realpathSync(top), fs.realpathSync(repo)));
}

function isLink(p) {
  try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; }
}

// ── running a command, its output to a file ──

function killTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    return;
  }
  try { process.kill(-child.pid, 'SIGTERM'); } catch { /* gone */ }
  setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } }, 5000).unref();
}

/**
 * Run `bin args` (or, with `shell`, the command line `bin`) in `cwd`, stdout and
 * stderr to `logFile`, no stdin. Its own process group, so a timeout or Ctrl-C
 * stops what it started too.
 * @returns {Promise<{ exit: number|null, wall_ms: number, timed_out: boolean, aborted: boolean, error?: string }>}
 */
export function runCaptured(bin, args, { cwd, env, logFile, timeoutMs, signal = null, shell = false }) {
  return new Promise((resolve) => {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    const fd = fs.openSync(logFile, 'a');
    const win = process.platform === 'win32';
    const t0 = Date.now();
    let child;
    try {
      child = shell || win
        ? spawn(shell ? bin : cmdLine(bin, args, env), { cwd, env, stdio: ['ignore', fd, fd], shell: true, detached: !win, windowsHide: true })
        : spawn(bin, args, { cwd, env, stdio: ['ignore', fd, fd], detached: true });
    } catch (err) {
      fs.closeSync(fd);
      resolve({ exit: null, wall_ms: 0, timed_out: false, aborted: false, error: `could not start ${bin}: ${err.message}` });
      return;
    }
    let timedOut = false;
    let aborted = false;
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs);
    const onAbort = () => { aborted = true; killTree(child); };
    signal?.addEventListener('abort', onAbort, { once: true });
    let settled = false;
    const done = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      try { fs.closeSync(fd); } catch { /* closed */ }
      resolve({ wall_ms: Date.now() - t0, timed_out: timedOut, aborted, ...r });
    };
    child.on('error', (err) => done({ exit: null, error: `could not start ${bin}: ${err.message}` }));
    child.on('exit', (code, sig) => done({ exit: code ?? (sig ? 128 + (sig === 'SIGKILL' ? 9 : 15) : 1) }));
  });
}

// ── one trial, for real ──

/**
 * The trial runner `runExperiment` calls: everything here has a side effect —
 * the copy, the session, the agent, the check. `run` (runCaptured) is
 * injectable so the orchestration can be tested with a stand-in agent.
 */
export function createTrialRunner({ port, home, bin, baseEnv, project, piExtension, signal, run = runCaptured, log = () => {} }) {
  const data = glassPaths(home).data;
  return async function runTrial(trial, variant, exp) {
    const dir = trialDir(data, exp.id, trial);
    const work = path.join(dir, 'work');
    try {
      return await runIn(prepareWorkspace(exp.repo, work), dir, trial, variant, exp);
    } finally {
      if (!exp.keep) fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  };

  async function runIn(cwd, dir, trial, variant, exp) {
    const relays = sessionRelays(exp.agent, { env: baseEnv, port, intercept: true });
    const session = await openSession(port, {
      agent: exp.agent, intercept: true, cwd, project, pid: process.pid, relays, proxyEnv: proxyEnvOf(baseEnv),
      ab: { experiment: exp.id, variant: variant.label, trial: trial.n },
    });
    if (!session) throw new Error(`the glass daemon on 127.0.0.1:${port} did not open a session`);
    const { env } = sessionEnv(exp.agent, baseEnv, {
      port, taskId: session.taskId, token: session.token, caPath: session.caPath, project, intercept: true, relays,
    });
    let args = agentArgs(exp.agent, variant, exp.prompt, exp.agent_args);
    if (env.GLASS_PI_RELAYS) args = ['-e', piExtension, ...args];
    let agent;
    try {
      agent = await run(bin, args, { cwd, env, logFile: path.join(dir, 'agent.log'), timeoutMs: exp.timeout_s * 1000, signal });
    } finally {
      await closeSession(port, session.token);
    }
    const result = {
      task_id: session.taskId, wall_ms: agent.wall_ms, agent_exit: agent.exit, timed_out: agent.timed_out,
      ...(agent.error ? { error: agent.error } : agent.aborted ? { error: 'aborted' } : {}),
      check: null,
    };
    log(`  agent ${agent.error ? agent.error : agent.timed_out ? `timed out after ${exp.timeout_s} s` : `exit ${agent.exit}`} in ${(agent.wall_ms / 1000).toFixed(1)} s · ${session.taskId}`);
    if (exp.check && !agent.aborted) {
      const c = await run(exp.check, [], { cwd, env: baseEnv, logFile: path.join(dir, 'check.log'), timeoutMs: exp.check_timeout_s * 1000, signal, shell: true });
      result.check = { exit: c.exit, passed: c.exit === 0 && !c.timed_out, wall_ms: c.wall_ms, timed_out: c.timed_out, ...(c.error ? { error: c.error } : {}) };
      log(`  check ${result.check.passed ? 'pass' : c.timed_out ? 'timed out' : `fail (exit ${c.exit})`}`);
    }
    return result;
  }
}

// ── the command ──

async function api(port, route) {
  const r = await fetch(`http://127.0.0.1:${port}${route}`, { signal: AbortSignal.timeout(15_000) });
  const j = await r.json().catch(() => null);
  if (r.status === 404 && /no route/.test(j?.error || '')) throw new Error('the running glass daemon has no A/B reads — glass stop, then try again');
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
  return j;
}

/**
 * @param {string[]} argv
 * @param {object} deps  from cli.mjs: out, err, daemonFor, agentBin, whichBin, projectOf, piExtension
 */
export async function abCmd(argv, deps) {
  const { out, err } = deps;
  const [sub, ...rest] = argv;
  const home = glassHome();
  const port = glassPort();
  try {
    if (sub === 'run') return await runCmd(rest, { ...deps, home, port });
    if (sub === 'list' || sub === 'report') {
      if (!(await deps.daemonFor({ home, port, env: { ...process.env } }))) {
        err(`glass: daemon not reachable on 127.0.0.1:${port}`);
        return 1;
      }
      if (sub === 'list') {
        const { experiments } = await api(port, '/api/ab');
        if (rest.includes('--json')) { out(JSON.stringify(experiments, null, 2)); return 0; }
        if (!experiments.length) { out('no experiments yet — glass ab run …'); return 0; }
        for (const e of experiments) {
          out(`${e.id}  ${e.status.padEnd(11)} ${e.agent.padEnd(8)} ${e.trials}/${e.planned} trials  ${e.variants.map((v) => v.label).join(' vs ')}${e.label ? `  · ${e.label}` : ''}`);
        }
        return 0;
      }
      let id = rest.find((x) => !x.startsWith('--')) || 'latest';
      if (id === 'latest') {
        const { experiments } = await api(port, '/api/ab');
        if (!experiments.length) { err('glass ab report: no experiments yet'); return 1; }
        id = experiments[0].id;
      }
      const { report } = await api(port, `/api/ab/${encodeURIComponent(id)}`);
      if (rest.includes('--json')) out(JSON.stringify(report, null, 2));
      else if (rest.includes('--csv')) out(reportCsv(report));
      else out(formatReport(report));
      return 0;
    }
    out(HELP);
    return sub === undefined || sub === 'help' || sub === '--help' ? 0 : 2;
  } catch (e) {
    err(`glass ab: ${e.message}`);
    return 2;
  }
}

async function runCmd(argv, { out, err, home, port, daemonFor, agentBin, whichBin, projectOf, piExtension }) {
  const exp = experimentFromArgs(argv);
  const bin = whichBin(agentBin(exp.agent));
  if (!bin) throw new Error(`${exp.agent} is not on PATH (or GLASS_${exp.agent.toUpperCase()}_BIN)`);
  const baseEnv = { ...process.env };
  // Unmeasured trials would compare nothing: no daemon, no experiment.
  if (!(await daemonFor({ home, port, env: baseEnv }))) {
    err(`glass: daemon not reachable on 127.0.0.1:${port} — an A/B run needs it (log: ${path.join(glassPaths(home).logs, 'daemon.log')})`);
    return 1;
  }
  const data = glassPaths(home).data;
  const save = (e) => saveExperiment(data, e);
  save(exp);
  out(`glass ab ${exp.id}: ${exp.agent}, ${exp.variants.map((v) => v.label).join(' vs ')}, ${exp.repeats} round(s), seed ${exp.seed}`);
  out(`  live: http://127.0.0.1:${port}/#/ab?id=${exp.id}`);

  const controller = new AbortController();
  let interrupts = 0;
  const onSigint = () => {
    interrupts += 1;
    if (interrupts > 1) process.exit(130);
    err('glass ab: stopping after this trial’s agent is stopped (Ctrl-C again to quit at once)');
    controller.abort();
  };
  process.on('SIGINT', onSigint);
  try {
    await runExperiment(exp, {
      save, signal: controller.signal, log: out,
      runTrial: createTrialRunner({
        port, home, bin, baseEnv, project: projectOf(exp.repo), piExtension, signal: controller.signal, log: out,
      }),
    });
  } finally {
    process.off('SIGINT', onSigint);
  }
  out('');
  try {
    const { report } = await api(port, `/api/ab/${exp.id}`);
    out(formatReport(report));
  } catch (e) {
    err(`glass ab: the report could not be read (${e.message}) — glass ab report ${exp.id}`);
  }
  return exp.status === 'done' ? 0 : 130;
}
