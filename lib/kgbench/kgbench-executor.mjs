/**
 * Host-side kgbench-executor seam (Phase 3 of the kgbench dashboard plan).
 *
 * The same architectural correction the experiment seam carries, for the same reason: a
 * kgbench cell spawns `claude` / `copilot` / `opencode`, and those binaries live ON THE
 * HOST. The coding-services container has only `node`. So the launch and the cancel must
 * happen here, and the container's `/api/kgbench/*` routes reach these functions over HTTP
 * via the coordinator (:3034), exactly as `/api/experiments/*` reaches
 * `lib/experiments/experiment-executor.mjs`.
 *
 * WHY THIS IS NOT `lib/experiments/run-launch.mjs`
 *
 * `launchRun()` spawns `process.execPath` with a node script. kgbench's entry point is
 * `scripts/kgbench-supervise.sh` — bash, deliberately, because the supervisor exists to
 * re-exec itself under `nohup` so a task manager that tidies up process trees cannot reach
 * the run (two r6 attempts died that way). Feeding a shell script to a node-pinned spawn
 * would either not run or lose the detach. The launch primitive is therefore its own, and it
 * inherits the supervisor's detach rather than imposing a second one.
 *
 * THE PID THIS MODULE RETURNS IS NOT THE PID IT SPAWNED. The wrapper invocation exits within
 * milliseconds, having re-exec'd itself under nohup; a pid recorded from the spawn would be
 * dead on arrival and, worse, reusable. The supervisor writes its REAL pid to
 * `<runDir>/supervise.pid` and removes it on exit, so that file — not the spawn — is the
 * authority on whether a run is live, and this module waits for it before reporting success.
 *
 * CANCEL SIGNALS A PROCESS GROUP RESOLVED FROM `ps`, NOT A NEGATED PID. The experiment seam
 * can negate its own pid because `spawn(detached:true)` makes that child a group leader. Here
 * the process worth killing is the supervisor's nohup'd GRANDCHILD, which inherits a group it
 * does not lead — negating its pid would signal a group it is not the leader of, or nothing.
 * The pgid is read from `/bin/ps -o pgid=` (an absolute path: `ps` is shell-aliased in this
 * environment) and sanity-bounded before any signal is delivered.
 *
 * Constraints:
 *  - FIXED-ARGV ONLY: never `shell:true`, never a template-string command line. Every option
 *    value is pushed as its own argv element, so a set name or arm id can never become shell.
 *  - Diagnostics via process.stderr.write only (no-console-log, CLAUDE.md).
 *  - Every syscall boundary (spawn / kill / ps / clock) is injectable so the coordinator
 *    wiring and the tests drive this without spawning or killing anything real.
 */

import { spawn, execFileSync } from 'node:child_process';
import { openSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// lib/kgbench → HOST repo root (two up).
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SUPERVISE_SCRIPT = path.join(REPO_ROOT, 'scripts', 'kgbench-supervise.sh');
const PROBE_SCRIPT = path.join(REPO_ROOT, 'scripts', 'llm-model-probe.mjs');

// The single legal root for a kgbench run directory. Any resolved run_dir must be this dir or
// a child of it — the same containment contract the experiment seam enforces.
const RUNS_ROOT = path.resolve(REPO_ROOT, '.data', 'kgbench', 'runs');

/**
 * kgbench run ids are NOT experiment run ids and must not borrow their validator.
 *
 * The experiment seam bounds ids at 12 characters because it MINTS them. kgbench ids are
 * chosen by an operator and are descriptive by design — `coding-v1-r7` is exactly 12, and
 * `coding-v1-VOID-tool-escape` (a real run on disk) is 26. A 12-char bound would reject the
 * project's own naming convention. The charset stays identical, because the charset is what
 * makes the id safe as a path segment; only the length differs.
 */
const RUN_ID_RE = /^[A-Za-z0-9._-]{1,48}$/;

/**
 * Reject a run id that is not a safe single path segment. `.` and `..` are excluded
 * explicitly — both match the charset and both navigate.
 * @param {string} runId
 * @returns {boolean}
 */
export function isValidKgbenchRunId(runId) {
  return typeof runId === 'string' && RUN_ID_RE.test(runId) && runId !== '.' && runId !== '..';
}

/**
 * A comma-separated selector (arms, agents, models, questions) as it reaches the supervisor's
 * `--arms` / `--agents` / `--models` / `--only` flags.
 *
 * These are forwarded as ONE argv element, so shell metacharacters cannot execute — but they
 * do become filenames and JSON keys downstream, and a value containing `/` or `..` would be a
 * path traversal in the sandbox worktree layout. The charset is therefore the same one that
 * makes a run id safe, plus `,` as the separator and `.` for dotted model names
 * (`claude-sonnet-4.6`) and `/` for opencode's provider-qualified refs (`rapid-proxy/...`).
 * `..` is rejected as a whole segment so the `/` allowance cannot compose into a traversal.
 */
const SELECTOR_SEGMENT_RE = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

/**
 * Validate a comma-separated selector list. Returns the cleaned string, or null when any
 * segment is unsafe (the caller turns null into a 400 — never a silently dropped filter,
 * which would run a BIGGER matrix than asked for).
 * @param {string|string[]|null|undefined} value
 * @returns {string|null}  cleaned CSV, '' for an empty selection, or null when invalid
 */
export function cleanSelector(value) {
  if (value === undefined || value === null || value === '') return '';
  const parts = (Array.isArray(value) ? value : String(value).split(','))
    .map((s) => String(s).trim())
    .filter((s) => s !== '');
  if (parts.length === 0) return '';
  for (const p of parts) {
    if (!SELECTOR_SEGMENT_RE.test(p)) return null;
    if (p.split('/').some((seg) => seg === '.' || seg === '..')) return null;
  }
  return parts.join(',');
}

/**
 * A positive-integer option (reps, deepen-reps, max-restarts, baseline wait seconds), bounded
 * so a typo cannot request a matrix that runs for a month. Returns null when present but
 * invalid so the caller can 400 rather than silently substitute a default — a run that
 * quietly used 3 reps when 300 was typed is a measurement error, not a UX inconvenience.
 * @param {*} value
 * @param {number} max
 * @returns {string|null|undefined}  stringified int, undefined when absent, null when invalid
 */
export function cleanPositiveInt(value, max) {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > max) return null;
  return String(n);
}

/**
 * Resolve a repo-relative (or absolute) run_dir against the HOST repo root AND assert it is
 * contained within <REPO_ROOT>/.data/kgbench/runs/. Checked on the resolved absolute path
 * with a path.sep boundary, so a sibling like `runs-evil` cannot satisfy a bare prefix test.
 * @param {string} runDir
 * @returns {string}  validated absolute run directory
 */
function resolveRunDir(runDir) {
  const abs = path.isAbsolute(runDir) ? path.resolve(runDir) : path.resolve(REPO_ROOT, runDir);
  if (abs !== RUNS_ROOT && !abs.startsWith(RUNS_ROOT + path.sep)) {
    throw new Error(`run_dir escapes ${RUNS_ROOT}: ${runDir}`);
  }
  return abs;
}

/**
 * Build the supervisor argv (never a shell string).
 *
 * Returns `[superviseScript, '--run-id', id, '--set', set, '--reps', n, ...conditional]`.
 * Optional flags are pushed ONLY when their value is a non-empty cleaned string, so an
 * omitted selector never appears on the command line and the supervisor falls back to its
 * own default (all enabled arms, claude, per-arm models).
 *
 * @param {object} o  already-validated option values
 * @param {string} [scriptPath]  supervisor path override (test seam)
 * @returns {string[]}
 */
export function buildSuperviseArgv(o, scriptPath = SUPERVISE_SCRIPT) {
  const argv = [scriptPath, '--run-id', o.run_id, '--set', o.set];
  if (o.reps) argv.push('--reps', o.reps);
  const flags = [
    ['only', '--only'],
    ['arms', '--arms'],
    ['agents', '--agents'],
    ['models', '--models'],
    ['baseline_token_wait_s', '--baseline-token-wait-s'],
    ['deepen', '--deepen'],
    ['deepen_reps', '--deepen-reps'],
    ['max_restarts', '--max-restarts'],
  ];
  for (const [key, flag] of flags) {
    const v = o[key];
    if (v !== undefined && v !== null && v !== '') argv.push(flag, String(v));
  }
  return argv;
}

/**
 * Read the supervisor's own pid from `<runDir>/supervise.pid`, waiting for it to appear.
 *
 * The wrapper invocation returns before the nohup'd supervisor has written its lock, so a
 * single read races and reports "launched, pid unknown" for a run that started perfectly.
 * Polling closes that race without making the caller wait on the run itself: the file appears
 * within one bash startup, and the ceiling exists only so a supervisor that refused to start
 * (double-launch guard, bad flag) is reported as a failure instead of hanging the request.
 *
 * @param {string} runDir
 * @param {object} deps  { readFile, sleep, attempts }
 * @returns {Promise<number|null>}  the supervisor pid, or null if it never appeared
 */
async function waitForSupervisorPid(runDir, { readFile, sleep, attempts = 25 } = {}) {
  const lockPath = path.join(runDir, 'supervise.pid');
  for (let i = 0; i < attempts; i += 1) {
    try {
      const raw = await readFile(lockPath, 'utf8');
      const pid = Number(String(raw).trim());
      if (Number.isInteger(pid) && pid > 1) return pid;
    } catch {
      /* not written yet — fall through to the wait */
    }
    await sleep(200);
  }
  return null;
}

/**
 * Whether a kgbench run is live, decided the way the supervisor itself decides it: the lock
 * file exists AND names a process that is still alive. The supervisor removes the lock on its
 * EXIT trap, so a stale lock only survives a SIGKILL — hence the liveness probe as well.
 *
 * @param {string} runDir
 * @param {object} deps  { readFile, isAliveFn }
 * @returns {Promise<{live:boolean, pid:number|null}>}
 */
export async function readRunLiveness(runDir, { readFile = fs.readFile, isAliveFn = isPidAlive } = {}) {
  try {
    const raw = await readFile(path.join(runDir, 'supervise.pid'), 'utf8');
    const pid = Number(String(raw).trim());
    if (!Number.isInteger(pid) || pid <= 1) return { live: false, pid: null };
    return { live: isAliveFn(pid), pid };
  } catch {
    return { live: false, pid: null };
  }
}

/**
 * Never-throw pid-liveness probe: signal 0 tests existence/permission without delivering a
 * signal. Returns false on ESRCH or any error.
 * @param {number} pid
 * @returns {boolean}
 */
export function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve a pid's process-group id via `/bin/ps -o pgid= -p <pid>`.
 *
 * ABSOLUTE PATH ON PURPOSE: `ps` is shell-aliased in this environment, and an aliased `ps`
 * has previously returned output this kind of parse could not read. execFileSync also means
 * the pid never touches a shell.
 *
 * @param {number} pid
 * @param {Function} [execFn]  injectable exec seam (default node:child_process execFileSync)
 * @returns {number|null}  the pgid, or null when it cannot be determined
 */
export function pgidOf(pid, execFn = execFileSync) {
  try {
    const out = execFn('/bin/ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8', timeout: 5000 });
    const pgid = Number(String(out).trim());
    return Number.isInteger(pgid) && pgid > 1 ? pgid : null;
  } catch {
    return null;
  }
}

/**
 * Launch a kgbench matrix on the host.
 *
 * The supervisor self-detaches (nohup + disown), so this spawn is a thin, short-lived
 * wrapper: it exists to hand the supervisor a clean environment and a log file, and it exits
 * immediately. `detached:true` + `unref()` are still set so the wrapper is not tied to the
 * coordinator's lifetime during those milliseconds.
 *
 * REFUSES A CONCURRENT RUN. kgbench cells restore a snapshot into a sandbox worktree and hold
 * the measurement slot; two matrices at once produce two sets of numbers that each include
 * the other's traffic. The supervisor has its own double-launch guard for the SAME run id;
 * this adds the cross-run guard, which it cannot have (it only knows its own directory).
 *
 * @param {object} args  validated option values (run_id, set, reps, arms, agents, models, …)
 * @param {string} args.run_dir  repo-relative or absolute; must resolve under .data/kgbench/runs/
 * @param {object} [args.env]    host env (the coordinator's own process.env)
 * @param {Function} [args.spawnFn]
 * @param {Function} [args.openLogFn]
 * @param {object} [args.fsDeps]
 * @param {Function} [args.sleepFn]
 * @param {Function} [args.isAliveFn]
 * @returns {Promise<{success:boolean, pid?:number, run_dir?:string, log?:string, slot_busy?:boolean, holder?:object, message?:string}>}
 */
export async function runKgbench({
  run_id,
  run_dir,
  set: setName = 'coding-v1',
  reps,
  only,
  arms,
  agents,
  models,
  deepen,
  deepen_reps,
  max_restarts,
  baseline_token_wait_s,
  env = process.env,
  spawnFn = spawn,
  openLogFn = openSync,
  fsDeps = { readFile: fs.readFile, readdir: fs.readdir, mkdir: fs.mkdir },
  sleepFn = (ms) => new Promise((r) => setTimeout(r, ms)),
  isAliveFn = isPidAlive,
  scriptPath = SUPERVISE_SCRIPT,
}) {
  if (!run_id || !run_dir) {
    return { success: false, message: 'run_id and run_dir are required' };
  }
  if (!isValidKgbenchRunId(run_id)) {
    return { success: false, message: `invalid run_id: ${run_id}` };
  }

  // Every selector is validated BEFORE it becomes argv. A null return means the operator
  // asked for something unsafe; a silently-dropped filter would run a larger matrix.
  const cleaned = {
    run_id,
    set: cleanSelector(setName),
    only: cleanSelector(only),
    arms: cleanSelector(arms),
    agents: cleanSelector(agents),
    models: cleanSelector(models),
    deepen: cleanSelector(deepen),
    reps: cleanPositiveInt(reps, 100),
    deepen_reps: cleanPositiveInt(deepen_reps, 100),
    max_restarts: cleanPositiveInt(max_restarts, 50),
    baseline_token_wait_s: cleanPositiveInt(baseline_token_wait_s, 600),
  };
  for (const [key, value] of Object.entries(cleaned)) {
    if (value === null) return { success: false, message: `invalid ${key}` };
  }
  if (!cleaned.set) return { success: false, message: 'set is required' };

  try {
    const hostRunDir = resolveRunDir(run_dir);

    // Cross-run slot guard: refuse when ANY kgbench run is live. Scans sibling run dirs for a
    // supervise.pid naming a host-alive process (the supervisor's own liveness contract).
    let siblings = [];
    try {
      siblings = await fsDeps.readdir(path.dirname(hostRunDir));
    } catch {
      siblings = [];
    }
    for (const entry of siblings) {
      const dir = path.join(path.dirname(hostRunDir), entry);
      const { live, pid } = await readRunLiveness(dir, { readFile: fsDeps.readFile, isAliveFn });
      if (live) {
        return {
          success: false,
          slot_busy: true,
          holder: { kind: 'kgbench', run_id: entry, pid },
          message: `A kgbench run is live (run_id=${entry}, pid=${pid}). Cancel it first.`,
        };
      }
    }

    await fsDeps.mkdir(hostRunDir, { recursive: true });

    const argv = buildSuperviseArgv(cleaned, scriptPath);

    // The wrapper's own stdout/stderr (the "detached (pid N)" banner, or a flag-parse
    // refusal) go to launch.log. The supervisor's real log is supervise.log, which it opens
    // itself — keeping them apart means a launch that never reached the supervisor is
    // diagnosable without reading a run log that will never exist.
    const logPath = path.join(hostRunDir, 'launch.log');
    let childStdio;
    try {
      const fd = openLogFn(logPath, 'a');
      childStdio = ['ignore', fd, fd];
    } catch (err) {
      process.stderr.write(`[kgbench-executor] could not open ${logPath} (${err.message}) — stdio falls back to ignore\n`);
      childStdio = 'ignore';
    }

    // FIXED-ARGV via bash, never shell:true. `env` is the coordinator's own, so the run
    // inherits CODING_REPO / the proxy routing vars the cells need.
    const child = spawnFn('/bin/bash', argv, {
      cwd: REPO_ROOT,
      detached: true,
      stdio: childStdio,
      env: { ...env },
    });
    if (typeof child.unref === 'function') child.unref();

    // The authority on "did it start" is the supervisor's own lock file, not this spawn.
    const pid = await waitForSupervisorPid(hostRunDir, { readFile: fsDeps.readFile, sleep: sleepFn });
    if (pid === null) {
      return {
        success: false,
        message: `supervisor did not report a pid within 5s — see ${path.relative(REPO_ROOT, logPath)}`,
      };
    }

    return { success: true, pid, run_dir: hostRunDir, log: logPath };
  } catch (err) {
    process.stderr.write(`[kgbench-executor] run failed: ${err.message}\n`);
    return { success: false, message: err.message };
  }
}

/**
 * Cancel a kgbench run by group-killing the supervisor's process group.
 *
 * The pid is read from the run's OWN supervise.pid — never accepted from the caller. The
 * experiment seam takes a pid and verifies it against run.json; here there is a live lock
 * file that is already the authority, so taking a pid at all would only add a way to be
 * wrong. A caller can therefore ask to cancel a RUN, and nothing else.
 *
 * The group, not the pid: killing the supervisor alone leaves `node kgbench-run.mjs` running,
 * which would finish the pass and leak a worktree with no supervisor to clean up after it.
 * SIGTERM first so the runner's own handler removes its worktree (it cleans up on
 * SIGINT/SIGTERM and LEAKS on SIGKILL — the escalation is a last resort, not the plan).
 *
 * @param {object} args
 * @param {string} args.run_id
 * @param {string} args.run_dir
 * @param {number} [args.graceMs]
 * @param {Function} [args.killFn]
 * @param {Function} [args.isAliveFn]
 * @param {Function} [args.pgidFn]
 * @param {object} [args.fsDeps]
 * @returns {Promise<{success:boolean, killed:boolean, pid?:number|null, pgid?:number|null, reason?:string, message?:string}>}
 */
export async function cancelKgbench({
  run_id,
  run_dir,
  graceMs = 8_000,
  killFn = process.kill,
  isAliveFn = isPidAlive,
  pgidFn = pgidOf,
  fsDeps = { readFile: fs.readFile, writeFile: fs.writeFile },
}) {
  if (!run_dir) return { success: false, killed: false, message: 'run_dir is required' };
  if (run_id !== undefined && run_id !== null && !isValidKgbenchRunId(run_id)) {
    return { success: false, killed: false, message: `invalid run_id: ${run_id}` };
  }

  let hostRunDir;
  try {
    hostRunDir = resolveRunDir(run_dir);
  } catch (err) {
    return { success: false, killed: false, message: err.message };
  }

  const { live, pid } = await readRunLiveness(hostRunDir, { readFile: fsDeps.readFile, isAliveFn });
  if (pid === null) {
    return { success: true, killed: false, pid: null, reason: 'no-lock' };
  }
  if (!live) {
    // A lock naming a dead process: the supervisor was SIGKILLed before its EXIT trap ran.
    // Nothing to signal, but the status still says whatever the last pass boundary wrote, so
    // record the terminal state — otherwise this run reads as live forever.
    await writeCancelledStatus(hostRunDir, fsDeps);
    return { success: true, killed: false, pid, reason: 'already-gone' };
  }

  const pgid = pgidFn(pid);
  if (pgid === null) {
    return { success: false, killed: false, pid, message: `could not resolve the process group of pid ${pid}` };
  }
  // Refuse to signal our OWN group. Without this, a stale supervise.pid that a reused pid now
  // maps onto the coordinator's own group would make "cancel this run" kill the coordinator —
  // a self-inflicted outage triggered from a UI button. Also reject an implausible group id.
  const ownPgid = pgidFn(process.pid);
  if (pgid <= 1 || pgid === ownPgid) {
    return { success: false, killed: false, pid, pgid, message: `refusing to signal process group ${pgid}` };
  }

  try {
    killFn(-pgid, 'SIGTERM');
  } catch (err) {
    if (err && err.code === 'ESRCH') {
      await writeCancelledStatus(hostRunDir, fsDeps);
      return { success: true, killed: false, pid, pgid, reason: 'already-gone' };
    }
    return { success: false, killed: false, pid, pgid, message: err.message };
  }

  // TERMINAL STATUS PATCH — the counterpart of the experiment seam's terminal progress write.
  //
  // Without it a cancelled run stays indistinguishable from a running one. The supervisor
  // writes `supervise.status` only at pass boundaries and its EXIT trap removes the lock file
  // but never touches the status, so a killed run leaves `running` on disk forever. Readers
  // that trust the status then keep the dashboard attached to a dead run, and the operator
  // sees "running" for something they just cancelled and watched stop.
  //
  // The kill is what matters and it has already happened; failing to record it must not turn
  // a successful cancel into a reported failure, so this never throws.
  await writeCancelledStatus(hostRunDir, fsDeps);

  // Escalate only if the group survives the grace window. The timer is unref'd so a pending
  // escalation never keeps the coordinator alive.
  const t = setTimeout(() => {
    try {
      killFn(-pgid, 'SIGKILL');
    } catch {
      /* already reaped by the SIGTERM */
    }
  }, graceMs);
  if (typeof t.unref === 'function') t.unref();

  return { success: true, killed: true, pid, pgid };
}

/**
 * Record a cancel in `supervise.status`, in the supervisor's own `state: detail` format so
 * every existing reader parses it unchanged.
 *
 * Never throws: the process group is already dead by the time this runs, and a status file
 * that could not be written must not turn a successful cancel into a reported failure.
 *
 * @param {string} runDir  validated absolute run directory
 * @param {object} fsDeps  { writeFile }
 */
async function writeCancelledStatus(runDir, fsDeps = {}) {
  const writeFile = fsDeps.writeFile ?? fs.writeFile;
  try {
    await writeFile(
      path.join(runDir, 'supervise.status'),
      `cancelled: group-killed from the dashboard at ${new Date().toISOString()}\n`,
      'utf8',
    );
  } catch (err) {
    process.stderr.write(`[kgbench-executor] could not record cancelled status (non-fatal): ${err.message}\n`);
  }
}

/**
 * Run the model probe on the host and return its cached result.
 *
 * The probe must run here, not in the container: it targets the proxy on 127.0.0.1:12435 and
 * — more importantly — it INSTALLS a temporary processOverride, sends a completion, and
 * removes the key on exit. That is a mutation of live routing config, and the container is
 * not where mutations of host routing belong.
 *
 * Probes are serialised inside the script (they share one override key), so this is slow by
 * construction — minutes for a full sweep. It is therefore explicitly operator-triggered and
 * never fired on page load; the launcher reads the CACHED file and offers this as an action.
 *
 * @param {object} args
 * @param {string} [args.provider]  restrict to one provider
 * @param {string} [args.models]    restrict to a CSV of candidates
 * @param {number} [args.timeoutMs]
 * @param {Function} [args.spawnFn]
 * @param {object} [args.env]
 * @returns {Promise<{success:boolean, code?:number, message?:string}>}
 */
export async function probeKgbenchModels({
  provider,
  models,
  timeoutMs = 15 * 60_000,
  spawnFn = spawn,
  env = process.env,
  scriptPath = PROBE_SCRIPT,
} = {}) {
  const cleanProvider = cleanSelector(provider);
  const cleanModels = cleanSelector(models);
  if (cleanProvider === null) return { success: false, message: 'invalid provider' };
  if (cleanModels === null) return { success: false, message: 'invalid models' };

  const argv = [scriptPath];
  if (cleanProvider) argv.push('--provider', cleanProvider);
  if (cleanModels) argv.push('--models', cleanModels);

  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };

    const child = spawnFn(process.execPath, argv, {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...env },
    });

    let stderr = '';
    child.stderr?.on('data', (b) => { stderr += String(b).slice(0, 4000); });

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      done({ success: false, message: `model probe exceeded ${Math.round(timeoutMs / 1000)}s` });
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    child.on('error', (err) => { clearTimeout(timer); done({ success: false, message: err.message }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      done(code === 0
        ? { success: true, code }
        : { success: false, code, message: stderr.trim() || `model probe exited ${code}` });
    });
  });
}

export { RUNS_ROOT as KGBENCH_RUNS_ROOT, REPO_ROOT as KGBENCH_REPO_ROOT };
