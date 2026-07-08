/**
 * Host-side run-launch primitives (Phase 85, Plan 85-02 — D-01 / D-08).
 *
 * The only genuinely net-new host mechanisms in the phase: a DETACHED, unref'd fixed-argv
 * spawn of `scripts/experiment-run.mjs` that survives a coordinator/vkb restart (D-01
 * amended intent), a process-GROUP SIGTERM→SIGKILL cancel via the NEGATED pid (D-08), and
 * a never-throw signal-0 pid-liveness probe with a pid-reuse sanity guard. Every syscall
 * boundary (spawn / kill) is injectable so the coordinator seam (Plan 03) and the unit
 * tests drive it without a live process.
 *
 * Constraints:
 *  - FIXED-ARGV ONLY (T-85-02-01 / T-78-03-01): argv is always a flat string[]; NEVER
 *    shell:true, NEVER a template-string command line. Values are flags, never concatenated.
 *  - NEGATED pid for cancel EVERYWHERE (Pitfall 2 / T-85-02-03): a positive-pid kill leaves
 *    the agent-CLI grandchild burning tokens + holding the span. `process.kill(-pid, sig)`
 *    reaps the whole detached group.
 *  - Diagnostics via process.stderr.write only (no-console-log, CLAUDE.md).
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// lib/experiments → repo root (two up); the runner lives under scripts/.
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const EXPERIMENT_RUN_SCRIPT = path.join(REPO_ROOT, 'scripts', 'experiment-run.mjs');

// Grace between SIGTERM and the escalated SIGKILL (experiment-runner.mjs DEFAULT_GRACE_MS).
const DEFAULT_GRACE_MS = 5_000;

// The four env-contract vars the runner reads (scripts/experiment-run.mjs:26-37). Merged
// from the caller's env on top of process.env so the spawned child sees the live proxy/data
// dir + routing config.
const ENV_CONTRACT_KEYS = ['CODING_REPO', 'LLM_PROXY_DATA_DIR', 'LLM_PROXY_PORT', 'CODING_PROXY_ROUTE'];

/**
 * Build the fixed-argv array (never a shell string) that invokes the experiment runner.
 *
 * Returns `[experimentRunScriptPath, '--spec', specPath, '--run-id', runId, '--run-dir',
 * runDir, ...conditionalOverrideFlags]`. Every element is a string. Override flags are pushed
 * ONLY when their value is defined (so an absent override never appears on the command line).
 *
 * @param {string} specPath  absolute path to the YAML experiment spec
 * @param {string} runId     run identity
 * @param {string} runDir    run-dir the runner writes progress into
 * @param {object} [overrides]
 * @param {string} [overrides.rerun_of]
 * @param {number|string} [overrides.repeats]
 * @param {number|string} [overrides.timeout]  seconds (per-cell wall-clock cap)
 * @param {string} [overrides.variant]
 * @param {string[]} [overrides.variants]  variant-name SUBSET → repeated --variant flags (D-09)
 * @param {string} [overrides.model]
 * @param {string} [overrides.agent]
 * @param {boolean} [overrides.capture_raw_bodies]
 * @param {string} [scriptPath] override the resolved runner script path (test/repoRoot seam)
 * @returns {string[]}
 */
export function buildRunArgv(specPath, runId, runDir, overrides = {}, scriptPath = EXPERIMENT_RUN_SCRIPT) {
  const argv = [
    scriptPath,
    '--spec', specPath,
    '--run-id', runId,
    '--run-dir', runDir,
  ];

  // Value-carrying overrides: pushed only when defined (never null/undefined). Coerced to
  // String so argv stays homogeneous — a fixed-argv array of strings, no shell interpolation.
  const valueFlags = [
    ['rerun_of', '--rerun-of'],
    ['repeats', '--repeats'],
    ['timeout', '--timeout'],
    ['variant', '--variant'],
    ['model', '--model'],
    ['agent', '--agent'],
  ];
  for (const [key, flag] of valueFlags) {
    const v = overrides[key];
    if (v !== undefined && v !== null) {
      argv.push(flag, String(v));
    }
  }

  // Variant SUBSET (Phase 85-06 fix): the launcher UI submits `variants: string[]`
  // (multi-pick, D-09) which the Plan-04 API validates and forwards whole — map it
  // to repeated `--variant <name>` pairs (the runner collects every occurrence).
  // The singular `variant` key above stays for direct single-cell callers.
  if (Array.isArray(overrides.variants)) {
    for (const name of overrides.variants) {
      if (name !== undefined && name !== null && String(name).trim() !== '') {
        argv.push('--variant', String(name));
      }
    }
  }

  // Boolean flag: present only when explicitly true.
  if (overrides.capture_raw_bodies === true) {
    argv.push('--capture-raw-bodies');
  }

  return argv;
}

/**
 * Atomic run.json write: write to a sibling tmp file then rename (rename is atomic within a
 * dir), so a crash mid-write never leaves a truncated run.json a later cancel would parse.
 */
async function writeRunJsonAtomic(runDir, payload) {
  const target = path.join(runDir, 'run.json');
  const tmp = path.join(runDir, `.run.json.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(tmp, JSON.stringify(payload, null, 2));
  await fs.rename(tmp, target);
}

/**
 * Launch the experiment runner DETACHED so a coordinator/vkb restart does NOT kill the run
 * (D-01). Spawns process.execPath (node) with the fixed argv, `detached:true`, `stdio:'ignore'`,
 * then `child.unref()`s it, persists run.json {run_id, pid, spec, started_at}, and returns
 * {pid, runDir}.
 *
 * @param {object} args
 * @param {string} args.specPath
 * @param {string} args.runId
 * @param {string} args.runDir
 * @param {object} [args.overrides]
 * @param {object} [args.env]        caller env — the four contract vars are merged over process.env
 * @param {Function} [args.spawnFn]  injectable spawn seam (default node:child_process spawn)
 * @param {string} [args.repoRoot]   cwd for the child (default REPO_ROOT)
 * @param {string} [args.scriptPath] runner script path override
 * @returns {Promise<{pid:number, runDir:string}>}
 */
export async function launchRun({
  specPath,
  runId,
  runDir,
  overrides = {},
  env = process.env,
  spawnFn = spawn,
  repoRoot = REPO_ROOT,
  scriptPath = EXPERIMENT_RUN_SCRIPT,
}) {
  await fs.mkdir(runDir, { recursive: true });

  const argv = buildRunArgv(specPath, runId, runDir, overrides, scriptPath);

  // Child env = process.env overlaid with the four contract vars resolved from the caller's env.
  const hostEnv = { ...process.env };
  for (const key of ENV_CONTRACT_KEYS) {
    if (env[key] !== undefined) hostEnv[key] = env[key];
  }

  // FIXED-ARGV, NEVER shell:true (T-85-02-01). detached+unref → survives launcher restart.
  const child = spawnFn(process.execPath, argv, {
    cwd: repoRoot,
    detached: true,
    stdio: 'ignore',
    env: hostEnv,
  });
  child.unref();

  await writeRunJsonAtomic(runDir, {
    run_id: runId,
    pid: child.pid,
    spec: specPath,
    started_at: new Date().toISOString(),
  });

  return { pid: child.pid, runDir };
}

/**
 * Never-throw pid-liveness probe: signal 0 tests for existence/permission without delivering
 * a signal (server-manager.js:51-58 template). Returns true when the process exists, false on
 * ESRCH (or any error). Never throws.
 *
 * @param {number} pid
 * @returns {boolean}
 */
export function isRunAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Cancel a run by group-killing the NEGATED pid with a SIGTERM→SIGKILL grace escalation (D-08).
 *
 * Signals `-pid` (the process GROUP of the detached spawn) EVERYWHERE — a positive pid would
 * leave the agent-CLI grandchild burning tokens + holding the measurement span (Pitfall 2 /
 * T-85-02-03; the live agent-group reap is proven in the Plan 06 gate).
 *
 * Guards (T-85-02-02):
 *  - already-gone: if the pid is not alive, short-circuit → {killed:false, reason:'already-gone'}
 *    (a stale run.json pid whose process already exited is never signalled).
 *  - pid-reuse: an optional `pidLooksLikeRunner(runJson)` hook lets the caller (coordinator,
 *    Plan 03) compare the observed process against run.json metadata (e.g. start-time). When it
 *    returns false the reused pid is NOT killed → {killed:false, reason:'pid-reuse-guard'}. When
 *    absent, the residual small reuse risk is accepted, matching the server-manager/coordinator
 *    precedent (RESEARCH OQ2).
 *
 * OQ3 (RESEARCH): a hard SIGKILL bypasses the runner's measurement-stop finally, leaving a stale
 * active-measurement.json. Clearing that span file AND writing the `cancelled` progress patch is
 * owned by the coordinator/canceller (Plan 03) — NOT here.
 *
 * @param {object} args
 * @param {number} args.pid
 * @param {number} [args.graceMs]   ms between SIGTERM and the escalated SIGKILL
 * @param {Function} [args.killFn]  injectable kill seam (default process.kill)
 * @param {Function} [args.isAliveFn] injectable liveness seam (default isRunAlive)
 * @param {object} [args.runJson]   persisted run.json — passed to the reuse guard hook
 * @param {Function} [args.pidLooksLikeRunner] optional reuse guard: (runJson) => boolean
 * @returns {{killed:boolean, reason?:string}}
 */
export function cancelRun({
  pid,
  graceMs = DEFAULT_GRACE_MS,
  killFn = process.kill,
  isAliveFn = isRunAlive,
  runJson,
  pidLooksLikeRunner,
}) {
  // already-gone: never signal a pid that is not alive.
  if (!isAliveFn(pid)) {
    return { killed: false, reason: 'already-gone' };
  }

  // pid-reuse sanity guard (OQ2): decline if the caller's hook says the live process no longer
  // plausibly belongs to this run.
  if (typeof pidLooksLikeRunner === 'function' && !pidLooksLikeRunner(runJson)) {
    return { killed: false, reason: 'pid-reuse-guard' };
  }

  // NEGATED pid → the whole detached process group (Pitfall 2).
  try {
    killFn(-pid, 'SIGTERM');
  } catch (err) {
    // Raced to death between the liveness probe and the signal — treat as gone.
    if (err && err.code === 'ESRCH') return { killed: false, reason: 'already-gone' };
    throw err;
  }

  // Escalate to SIGKILL after the grace window. The timer is unref'd so a pending escalation
  // never keeps the host process alive.
  const graceTimer = setTimeout(() => {
    try {
      killFn(-pid, 'SIGKILL');
    } catch {
      /* group already reaped by the SIGTERM — nothing to escalate */
    }
  }, graceMs);
  if (typeof graceTimer.unref === 'function') graceTimer.unref();

  return { killed: true };
}
