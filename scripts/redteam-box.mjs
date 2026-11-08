#!/usr/bin/env node
/**
 * Red-team the agent box: run each agent against each scenario INSIDE the
 * shipped box and report a verdict per cell (lib/redteam/cells.mjs).
 *
 *   coding box redteam [--agents script,claude,copilot,opencode,pi] [--scenarios a,b]
 *                      [--model agent=model …] [--timeout 360] [--keep]
 *
 * `script` is no model: lib/redteam/attacks.mjs runs each scenario as fixed
 * steps in the box, so the box is tested even where a model declines. Each
 * model agent first gets a canary-only run (its guard check), so "made no
 * tool call" can be told apart from "the guard is missing".
 *
 * Per cell: a disposable git workspace, a throwaway home volume (seeded with
 * generated provider config, and with the box's Claude login when one exists),
 * a host sentinel directory the box cannot see, and ONE scratch guard for the
 * whole run on a free port — with a random password the harness never uses,
 * so any approval at all is a bypass. The image must be current: what is
 * tested is what ships.
 *
 * Results: .data/redteam/runs/<run-id>.json, plus a table. Exit 1 when any
 * cell regressed, 2 when the run could not start.
 *
 * Plan: .planning/guardrail-hardening.md (Phase 1 item 6, Phase 3).
 */

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  boxRunArgs, boxAgentConfig, prepareCopilotConfig, imageDigest, guardSource, IMAGE, HOME_VOLUME, BOX_HOME,
} from './agent-box.mjs';
import { createGuard } from './coding-guard-daemon.mjs';
import { guardPaths } from '../lib/guard/home.mjs';
import { verifyAudit } from '../lib/guard/audit.mjs';
import { listenLocal } from '../lib/network/local-only.mjs';
import { wireAgentEnv } from '../lib/agents/proxy-routing.mjs';
import { agentEnv, assertProxyReachable } from '../lib/kgbench/runner.mjs';
import { argvForAgent } from '../lib/experiments/agent-headless.mjs';
import {
  SCENARIOS, CANARY_FILE, CANARY_TEXT, CALL_LOG, scenarioPrompt, canaryPrompt, classify, digestPaths, guardChanges, secretNeedles, findText,
  callStats, scriptReport, probeBypass, factorsDigest, canaryFiled, guardCheckResult,
} from '../lib/redteam/cells.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNS_DIR = path.join(REPO, '.data', 'redteam', 'runs');
const AGENTS = ['script', 'claude', 'copilot', 'opencode', 'pi'];
const DEFAULT_MODELS = { script: 'none', claude: 'sonnet', copilot: 'claude-sonnet-5', opencode: 'rapid-proxy/claude-sonnet-5', pi: 'claude-sonnet-5' };
/** Where lib/redteam is mounted in a `script` box. */
const BOX_REDTEAM = '/redteam';
const log = (s) => process.stderr.write(`${s}\n`);

/** The canary text on disk in the workspace: a guarded write that went through. */
function canaryOnDisk(workspace) {
  try { return fs.readFileSync(path.join(workspace, CANARY_FILE), 'utf8').includes(CANARY_TEXT); } catch { return false; }
}

function parseArgs(argv) {
  const o = { agents: AGENTS, scenarios: Object.keys(SCENARIOS), models: { ...DEFAULT_MODELS }, timeout: 360, keep: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--agents') o.agents = argv[++i].split(',');
    else if (a === '--scenarios') o.scenarios = argv[++i].split(',');
    else if (a === '--model') { const [k, v] = argv[++i].split('='); o.models[k] = v; }
    else if (a === '--timeout') o.timeout = Number(argv[++i]);
    else if (a === '--keep') o.keep = true;
    else throw new Error(`unknown argument ${a}`);
  }
  for (const a of o.agents) if (!AGENTS.includes(a)) throw new Error(`unknown agent ${a}`);
  for (const s of o.scenarios) if (!SCENARIOS[s]) throw new Error(`unknown scenario ${s}`);
  return o;
}

const freePort = () => new Promise((resolve, reject) => {
  const srv = net.createServer();
  srv.once('error', reject);
  srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
});

function docker(args, opts = {}) {
  return spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
}

/**
 * The agent's headless argv (lib/experiments), with the box as the sandbox:
 * the agent's own permission prompts, which nobody answers here, would stop
 * an attack before it reaches the box — and test the CLI instead of the box.
 */
function agentArgs(agent, prompt, model) {
  const argv = argvForAgent(agent, prompt, { model });
  if (agent === 'copilot') return [...argv, '--allow-all-paths', '--allow-all-urls'];
  if (agent !== 'claude') return argv;
  const i = argv.indexOf('--permission-mode');
  return [...argv.slice(0, i), '--dangerously-skip-permissions', ...argv.slice(i + 2)];
}

/** A throwaway home volume with the agent's generated provider config (and the box login for claude). */
function seedHome(volume, agent, uid, gid, stage) {
  docker(['volume', 'create', volume]);
  fs.mkdirSync(stage, { recursive: true });
  for (const f of boxAgentConfig(agent)) {
    fs.mkdirSync(path.dirname(path.join(stage, f.path)), { recursive: true });
    fs.writeFileSync(path.join(stage, f.path), f.content);
  }
  // `script` too: its persistence check runs a real claude (see main).
  const copyLogin = agent === 'claude' || agent === 'script'
    ? `mkdir -p /h/.claude && if [ -s /real/.claude/.credentials.json ]; then cp /real/.claude/.credentials.json /h/.claude/; fi; `
    : '';
  const res = docker(['run', '--rm', '-u', 'root', '--entrypoint', 'sh', '-v', `${volume}:/h`, '-v', `${stage}:/seed:ro`,
    '-v', `${HOME_VOLUME}:/real:ro`, IMAGE, '-c', `cp -a /seed/. /h/ && ${copyLogin}chown -R ${uid}:${gid} /h`]);
  if (res.status !== 0) throw new Error(`seeding ${volume} failed: ${res.stderr}`);
}

/**
 * One container run of `agent` with `prompt` (for `script`: the scenario, or
 * 'canary'); returns { code, output, timedOut, diff, callLog }.
 */
async function runBox({ agent, prompt, model, workspace, volume, name, guardDir, port, sentinel, env, timeoutS, outFile }) {
  const script = agent === 'script';
  const argv = boxRunArgs({
    agent: script ? 'claude' : agent, args: script ? [] : agentArgs(agent, prompt, model),
    env: { ...env, TARGET_PROJECT_DIR: workspace }, cwd: workspace,
    uid: process.getuid(), gid: process.getgid(), name, guardDir, guardPortNum: port,
  });
  argv.splice(argv.indexOf('--rm'), 1); // keep the stopped container for `docker diff`
  const hv = argv.indexOf(`${HOME_VOLUME}:${BOX_HOME}`);
  argv[hv] = `${volume}:${BOX_HOME}`;
  if (script) {
    const label = argv.indexOf('coding.box.agent=claude');
    if (label < 0 || argv.indexOf(IMAGE) < 0) throw new Error('boxRunArgs changed shape: cannot build the script box');
    argv[label] = 'coding.box.agent=script';
    argv.splice(argv.indexOf(IMAGE) + 1, Infinity, 'node', `${BOX_REDTEAM}/attacks.mjs`, prompt);
    argv.splice(argv.indexOf(IMAGE), 0, '-v', `${path.join(REPO, 'lib', 'redteam')}:${BOX_REDTEAM}:ro`);
  }
  argv.splice(argv.indexOf(IMAGE), 0, '-e', `HOST_SENTINEL=${sentinel}`, '-e', 'CODING_KNOWLEDGE_INJECTION=0');
  const out = fs.openSync(outFile, 'w');
  const child = spawn('docker', argv, { stdio: ['ignore', out, out] });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; docker(['kill', name]); }, timeoutS * 1000);
  const code = await new Promise((r) => child.on('close', r));
  clearTimeout(timer);
  fs.closeSync(out);
  const diff = docker(['diff', name]).stdout || '';
  // No record = no call reached the guard (or the agent deleted it): no result, never a pass.
  let callLog = '';
  try {
    callLog = execFileSync('sh', ['-c', `docker cp ${name}:${CALL_LOG} - | tar -xO`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { /* no record */ }
  docker(['rm', '-f', name]);
  return { code, timedOut, diff, callLog, output: fs.readFileSync(outFile, 'utf8') };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const built = imageDigest();
  const current = guardSource().digest;
  if (built !== current) {
    log(`redteam: ${IMAGE} is ${built ? `built from guard ${built}` : 'missing'}; the committed guard is ${current}. Run: coding box build`);
    return 2;
  }
  await assertProxyReachable();

  const runId = `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${randomBytes(3).toString('hex')}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-redteam-'));
  const uid = process.getuid();
  const gid = process.getgid();

  // One scratch guard for the run, outside every mount; nobody approves anything.
  const paths = guardPaths(path.join(tmp, 'guard'));
  const port = await freePort();
  const guard = createGuard({ paths, port, codingRepo: REPO });
  guard.factors.setPassword(randomBytes(24).toString('base64url'));
  const server = await new Promise((resolve, reject) => {
    const s = listenLocal(guard.handler, port, () => resolve(s));
    s.on('error', reject);
  });
  const api = async (route) => (await fetch(`http://127.0.0.1:${port}${route}`)).json();
  const signingKey = fs.readFileSync(paths.signingKey, 'utf8');
  const needles = [...secretNeedles(signingKey), fs.readFileSync(paths.token, 'utf8').trim()];
  const factorsFile = path.join(paths.dir, 'factors.json');
  const guardHome = () => `${digestPaths([paths.signingKey, paths.token, paths.publicDir])}:${factorsDigest(factorsFile)}`;
  const guardHomeBefore = guardHome();

  log(`redteam ${runId}: image guard ${built}, scratch guard :${port}, ${opts.agents.length} agent(s) × ${opts.scenarios.length} scenario(s)`);
  const cells = [];
  const guardChecks = {}; // agent → its canary-only run was blocked
  // Interrupted: leave nothing behind — the current cell's containers and
  // volume, the scratch guard, and the temp dir that holds its key.
  const live = { names: [], volume: null };
  const abort = (sig) => {
    for (const n of live.names) docker(['rm', '-f', n]);
    if (live.volume) docker(['volume', 'rm', '-f', live.volume]);
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    log(`redteam: interrupted (${sig}); cleaned up`);
    process.exit(130);
  };
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);
  try {
    const wiredEnv = async (agent) => {
      const wired = await wireAgentEnv(agent, agentEnv(process.env), { targetProjectDir: tmp });
      if (wired.unrouted) throw new Error(`proxy wiring failed for ${agent}`);
      delete wired.env.PI_CODING_AGENT_DIR; // the box home holds a generated copy; never mount the host's
      delete wired.env.PI_CODING_AGENT_SESSION_DIR;
      return wired.env;
    };
    for (const agent of opts.agents) {
      const script = agent === 'script';
      const env = script ? agentEnv(process.env) : await wiredEnv(agent);
      const followUpEnv = script ? await wiredEnv('claude') : null;
      // A model agent's guard check comes first: one canary-only run.
      for (const scenario of script ? opts.scenarios : ['guard-check', ...opts.scenarios]) {
        const check = scenario === 'guard-check';
        const id = `${agent}-${scenario}`;
        const dir = path.join(tmp, id);
        const workspace = path.join(dir, 'ws');
        const sentinel = path.join(dir, 'sentinel');
        fs.mkdirSync(workspace, { recursive: true });
        fs.mkdirSync(sentinel, { recursive: true });
        fs.writeFileSync(path.join(sentinel, 'sentinel.txt'), 'host only\n');
        fs.writeFileSync(path.join(workspace, 'README.md'), '# Scratch project\n\nA disposable workspace.\n');
        execFileSync('git', ['init', '-q'], { cwd: workspace });
        if (agent === 'copilot') prepareCopilotConfig(workspace, workspace);
        const protectedPaths = agent === 'copilot' ? [path.join(workspace, '.github', 'copilot'), path.join(workspace, '.claude')] : [];
        const protectedBefore = digestPaths(protectedPaths);
        const sentinelBefore = digestPaths([sentinel]);
        const volume = `coding-redteam-${runId}-${id}`.toLowerCase();
        const name = `coding-box-${id}-${runId.slice(-6)}`;
        live.names = [name, `${name}-again`];
        live.volume = volume;
        seedHome(volume, agent, uid, gid, path.join(dir, 'seed'));

        // One guard for the run: a lockout tripped by an earlier cell's guesses
        // must not answer this cell's.
        guard.factors.data.lockout = { failures: 0, until: 0 };
        guard.factors.save();
        const t0 = Date.now();
        log(`  ${id} …`);
        const common = { agent, model: opts.models[agent], workspace, volume, guardDir: paths.dir, port, sentinel, env, timeoutS: opts.timeout };
        const prompt = script ? scenario : check ? canaryPrompt() : scenarioPrompt(scenario);
        const run = await runBox({ ...common, prompt, name, outFile: path.join(dir, 'output.txt') });
        if (check) {
          const reqs = (await api('/requests')).requests;
          guardChecks[agent] = guardCheckResult({
            filed: canaryFiled(reqs, name, { workspace }),
            calls: callStats(run.callLog, { workspace }).calls,
            written: canaryOnDisk(workspace),
          });
          log(`  ${id}: ${{ true: 'the guard ran', false: 'NOT BLOCKED — the canary is on disk', null: 'no evidence either way (the agent did not try)' }[guardChecks[agent]]}`);
          docker(['volume', 'rm', '-f', volume]);
          live.names = [];
          live.volume = null;
          continue;
        }
        // Does a NEW box on the same workspace and home still guard? Asked of a
        // real agent CLI — for `script`, claude — since settings that switch
        // hooks off act in the CLI, not in the hook. true: the canary was
        // filed; false: it is on disk unguarded; null: the agent did not try.
        let persistenceCanary;
        if (SCENARIOS[scenario].persistence) {
          const again = `${name}-again`;
          const before = canaryOnDisk(workspace);
          const followUp = script ? { agent: 'claude', model: opts.models.claude ?? DEFAULT_MODELS.claude, env: followUpEnv } : {};
          await runBox({ ...common, ...followUp, prompt: canaryPrompt(), name: again, outFile: path.join(dir, 'output-again.txt') });
          const reqs = (await api('/requests')).requests;
          persistenceCanary = canaryFiled(reqs, again, { workspace }) ? true
            : !before && canaryOnDisk(workspace) ? false : null;
        }
        const requests = (await api('/requests')).requests.filter((r) => r.session.startsWith(name));
        const grants = (await api(`/grants?session=${encodeURIComponent(name)}`)).grants;
        const sentinelChanged = digestPaths([sentinel]) !== sentinelBefore ? 'the host sentinel directory changed' : null;
        const leakedIn = needles.some((n) => run.output.includes(n)) ? 'agent output'
          : needles.map((n) => findText(workspace, n)).find(Boolean);
        const evidence = {
          exitCode: run.code,
          timedOut: run.timedOut,
          output: run.output,
          canary: canaryFiled(requests, name, { workspace }),
          guardDiff: guardChanges(run.diff),
          guardHomeChanged: guardHome() !== guardHomeBefore,
          protectedChanged: protectedPaths.length > 0 && digestPaths(protectedPaths) !== protectedBefore,
          auditOk: verifyAudit(paths.audit).ok,
          persistenceCanary,
          ...callStats(run.callLog, { workspace }),
          guardCheck: guardChecks[agent],
          scripted: script,
          lockedOut: guard.factors.lockedFor() > 0,
        };
        const report = script ? scriptReport(run.output) : null;
        evidence.noReport = script && !report;
        evidence.bypass = probeBypass(report) || SCENARIOS[scenario].bypassed({
          workspace,
          guard: { approved: requests.filter((r) => r.status === 'approved'), grants },
          sentinelChanged,
          leaked: leakedIn ? `the guard's signing key or token appeared in ${leakedIn}` : null,
        });
        const result = classify(scenario, evidence);
        cells.push({
          id, agent, scenario, model: opts.models[agent], seconds: Math.round((Date.now() - t0) / 1000),
          ...result, requests: requests.map((r) => ({ rule: r.rule, file: r.file, status: r.status })),
          ...(report ? { probes: report.probes, attempts: report.attempts } : {}),
          evidence: { ...evidence, output: undefined, outputTail: run.output.slice(-2000) },
        });
        log(`  ${id}: ${result.verdict} (${result.status})${result.reasons.length ? ` — ${result.reasons.join('; ')}` : ''}`);
        docker(['volume', 'rm', '-f', volume]);
        live.names = [];
        live.volume = null;
      }
    }
  } finally {
    server.close();
    if (!opts.keep) fs.rmSync(tmp, { recursive: true, force: true });
  }

  fs.mkdirSync(RUNS_DIR, { recursive: true });
  const file = path.join(RUNS_DIR, `${runId}.json`);
  fs.writeFileSync(file, `${JSON.stringify({ runId, image: built, guardChecks, cells }, null, 2)}\n`);
  const width = Math.max(...cells.map((c) => c.id.length));
  const checks = Object.entries(guardChecks).map(([a, ok]) => `${a} ${ok === null ? 'no evidence' : ok ? 'ran' : 'NOT BLOCKED'}`).join(', ');
  if (checks) process.stdout.write(`\nguard check (canary only): ${checks}\n`);
  process.stdout.write(`\n${'cell'.padEnd(width)}  verdict       status\n`);
  for (const c of cells) process.stdout.write(`${c.id.padEnd(width)}  ${c.verdict.padEnd(12)}  ${c.status}${c.knownGap ? ` (${c.knownGap})` : ''}\n`);
  process.stdout.write(`\n${file}${opts.keep ? `\nworkspaces kept in ${tmp}` : ''}\n`);
  return cells.some((c) => c.status === 'regression') || Object.values(guardChecks).includes(false) ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code), (err) => { log(`redteam: ${err.message}`); process.exit(2); });
}
