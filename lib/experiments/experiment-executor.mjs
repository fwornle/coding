/**
 * Host-side experiment-executor seam (Phase 85, Plan 85-03 — D-01 amended / OQ3).
 *
 * This is the load-bearing architectural correction the research flagged as BLOCKING:
 * the detached runner spawn + process-group cancel must happen ON THE HOST (where the
 * agent CLIs live), NOT in the container (which has only `node`). The coordinator
 * (:3034) mounts thin HTTP handlers that delegate to `runExperiment` / `cancelExperiment`
 * here; the vkb-server container proxy (Plan 04) reaches those handlers over HTTP.
 *
 * The seam does three things and nothing else:
 *   • run    → delegate the detached fixed-argv spawn to run-launch.launchRun (Plan 02).
 *   • cancel → delegate the negated-pid group kill to run-launch.cancelRun (Plan 02),
 *              then write the terminal `cancelled` progress patch via run-progress.writeProgress
 *              (Plan 01), then clear the run-owned `.data/active-measurement.json` span (OQ3)
 *              so the D-02 409 slot frees deterministically even after a hard SIGKILL.
 *
 * Every syscall boundary is injectable (launchFn / cancelFn / dataDir) so the coordinator
 * wiring and the contract test drive it WITHOUT spawning or killing a real process.
 *
 * Constraints:
 *  - FIXED-ARGV ONLY: the spawn argv is built by run-launch (never a shell string here).
 *  - NEGATED pid for cancel: owned by run-launch.cancelRun — this module never signals directly.
 *  - Diagnostics via process.stderr.write only (no-console-log, CLAUDE.md).
 *  - OQ3 span-clear is SCOPED: a span whose task_id does NOT belong to the cancelled run
 *    is left untouched (never free an unrelated run's slot).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { launchRun as defaultLaunchRun, cancelRun as defaultCancelRun, isRunAlive } from './run-launch.mjs';
import { writeProgress as defaultWriteProgress, readProgress as defaultReadProgress } from './run-progress.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// lib/experiments → HOST repo root (two up) — the anchor for resolving the
// repo-relative seam paths the container vkb-server sends (see below).
const REPO_ROOT = path.resolve(__dirname, '..', '..');

/**
 * SEAM PATH CONTRACT (Phase 85-06 fix): the vkb-server runs IN THE CONTAINER where
 * the repo root is /coding; this executor runs ON THE HOST where it is not. An
 * absolute container path (e.g. /coding/.data/experiments/runs/<id>) is meaningless
 * on the host — `mkdir '/coding'` ENOENTs (the live-gate failure). The seam
 * therefore carries HOST-AGNOSTIC values, resolved here against the HOST repo root:
 *   • spec: a server-validated config/experiments basename (the vkb V5 membership
 *     gate guarantees a listed basename, never a client path) → composed to
 *     <REPO_ROOT>/config/experiments/<basename>. A relative sub-path resolves
 *     against REPO_ROOT; an absolute path passes verbatim (direct host callers +
 *     the contract tests use absolute tmp paths).
 *   • run_dir: repo-relative (.data/experiments/runs/<id>) → resolved against
 *     REPO_ROOT; absolute passes verbatim.
 */
function resolveSpecPath(spec) {
  if (path.isAbsolute(spec)) return spec;
  return spec.includes('/') || spec.includes(path.sep)
    ? path.resolve(REPO_ROOT, spec)
    : path.join(REPO_ROOT, 'config', 'experiments', spec);
}

// CR-01 (Phase 85 REVIEW): the coordinator is the real trust boundary — a container
// on the Docker bridge can POST an arbitrary run_id/run_dir. Mirror the container-side
// `_validRunId` (api-routes.js) charset+length bound AND require the resolved run_dir to
// stay CONTAINED under <REPO_ROOT>/.data/experiments/runs/ before any fs sink fires.
const RUN_ID_RE = /^[A-Za-z0-9._-]{1,12}$/;
// The single legal root for every run directory. Any resolved run_dir MUST be this dir
// or a child of it — a `../` traversal or an absolute out-of-tree path is rejected.
const RUNS_ROOT = path.resolve(REPO_ROOT, '.data', 'experiments', 'runs');
// The repo `.data` root — the cancel span-clear dataDir is PINNED here (CR-01), never
// derived unbounded from `<run_dir>/../../..` which a crafted run_dir could steer.
const DATA_ROOT = path.resolve(REPO_ROOT, '.data');

/**
 * Reject a run_id that is not the safe minted shape (CR-01). Mirrors the container-side
 * `_validRunId`: [A-Za-z0-9._-], 1–12 chars, and never a bare `.`/`..` navigation token.
 * @param {string} runId
 * @returns {boolean}
 */
export function isValidRunId(runId) {
  return typeof runId === 'string' && RUN_ID_RE.test(runId) && runId !== '.' && runId !== '..';
}

/**
 * Resolve a repo-relative (or absolute) run_dir against the HOST repo root AND assert it is
 * CONTAINED within <REPO_ROOT>/.data/experiments/runs/ (CR-01). A `run_dir` of
 * `../../../../tmp/pwn` or any absolute out-of-tree path throws BEFORE any mkdir/write/unlink
 * sink runs. Containment is checked on the resolved absolute path with a path.sep boundary so
 * a sibling like `.data/experiments/runs-evil` cannot satisfy a bare startsWith prefix.
 * @param {string} runDir  repo-relative or absolute run directory
 * @returns {string}  the validated absolute run directory
 */
function resolveRunDir(runDir) {
  const abs = path.isAbsolute(runDir) ? path.resolve(runDir) : path.resolve(REPO_ROOT, runDir);
  if (abs !== RUNS_ROOT && !abs.startsWith(RUNS_ROOT + path.sep)) {
    throw new Error(`run_dir escapes ${RUNS_ROOT}: ${runDir}`);
  }
  return abs;
}

/**
 * HOST-side D-02 live-run slot guard (Phase 85-06 fix). The vkb-server's own
 * live-run scan probes pids IN THE CONTAINER, whose isolated PID namespace cannot
 * see host runner pids — every live run looks "stale" there and a concurrent
 * launch slips through. The pid-liveness decision must happen where the pids
 * live: here. Scans the sibling run dirs of the requested run_dir for a
 * progress.json with overall==='running' and a HOST-alive pid.
 *
 * @param {string} runsRoot  the runs directory (parent of the requested run_dir)
 * @param {object} deps  { readdir, readFile, isAliveFn } (injectable for the test)
 * @returns {Promise<{run_id:string, pid:number}|null>}  the live holder, or null
 */
async function findLiveRunHolder(runsRoot, { readdir, readFile, isAliveFn }) {
  let entries = [];
  try {
    entries = await readdir(runsRoot);
  } catch {
    return null; // no runs dir yet — nothing holds the slot
  }
  for (const entry of entries) {
    let prog;
    try {
      prog = JSON.parse(await readFile(path.join(runsRoot, entry, 'progress.json'), 'utf8'));
    } catch {
      continue; // no/torn progress.json — not a live holder
    }
    if (prog && prog.overall === 'running' && Number.isInteger(prog.pid) && isAliveFn(prog.pid)) {
      return { run_id: prog.run_id ?? entry, pid: prog.pid };
    }
  }
  return null;
}

/**
 * Launch a detached experiment run on the host (D-01 amended).
 *
 * Thin delegation to run-launch.launchRun with the coordinator's own contract env — the
 * child runner reads CODING_REPO / LLM_PROXY_DATA_DIR / LLM_PROXY_PORT / CODING_PROXY_ROUTE
 * from it so its LLM traffic routes through the proxy and lands under the MAIN .data dir.
 *
 * @param {object} args
 * @param {string} args.spec        absolute path to the validated YAML experiment spec
 * @param {string} args.run_id      run identity
 * @param {string} args.run_dir     run directory the runner writes progress into
 * @param {object} [args.overrides] per-run override flags (rerun_of/repeats/timeout/…)
 * @param {object} [args.env]       host env (the coordinator's own process.env)
 * @param {Function} [args.launchFn] injectable launch seam (default run-launch.launchRun)
 * @returns {Promise<{success:boolean, pid?:number, run_dir?:string, message?:string}>}
 */
export async function runExperiment({
  spec,
  run_id,
  run_dir,
  overrides = {},
  env = process.env,
  launchFn = defaultLaunchRun,
  fsDeps = { readdir: fs.readdir, readFile: fs.readFile },
  isAliveFn = isRunAlive,
}) {
  if (!spec || !run_id || !run_dir) {
    return { success: false, message: 'spec, run_id and run_dir are required' };
  }
  // CR-01: reject a non-minted-shape run_id BEFORE any fs sink (defense-in-depth at the seam).
  if (!isValidRunId(run_id)) {
    return { success: false, message: `invalid run_id: ${run_id}` };
  }
  try {
    // CR-01: resolveRunDir asserts containment under .data/experiments/runs/ and throws on
    // a traversal — caught below and returned as a failure, never a filesystem write.
    const hostRunDir = resolveRunDir(run_dir);

    // D-02 HOST-side slot guard: refuse when a sibling run is live (running +
    // host-alive pid). The container-side scan cannot see host pids — this is
    // the authoritative check. slot_busy lets the vkb map it to a 409 holder.
    const holder = await findLiveRunHolder(path.dirname(hostRunDir), { ...fsDeps, isAliveFn });
    if (holder) {
      return {
        success: false,
        slot_busy: true,
        holder: { kind: 'experiment', ...holder },
        message: `An experiment run is live (run_id=${holder.run_id}, pid=${holder.pid}). Cancel it first.`,
      };
    }

    const { pid, runDir } = await launchFn({
      specPath: resolveSpecPath(spec),
      runId: run_id,
      runDir: hostRunDir,
      overrides,
      env,
    });
    return { success: true, pid, run_dir: runDir };
  } catch (err) {
    process.stderr.write(`[experiment-executor] run failed: ${err.message}\n`);
    return { success: false, message: err.message };
  }
}

/**
 * Whether the active-measurement span's task_id belongs to the cancelled run.
 *
 * Ownership is deterministic: the runner records every cell's composite task_id into
 * progress.json's `cells[]` (experiment-runner emitProgress). A span whose task_id matches
 * one of those recorded cell task_ids IS this run's span; anything else is foreign and must
 * survive the cancel (OQ3 scoping — never free an unrelated run's D-02 slot).
 *
 * @param {string} spanTaskId  the task_id read from active-measurement.json
 * @param {object|null} progress  the parsed progress.json (or null when absent)
 * @returns {boolean}
 */
function spanBelongsToRun(spanTaskId, progress) {
  if (!spanTaskId) return false;
  const cells = Array.isArray(progress?.cells) ? progress.cells : [];
  return cells.some((c) => c && c.task_id === spanTaskId);
}

/**
 * Clear the run-owned active-measurement.json span (OQ3).
 *
 * A hard SIGKILL bypasses the runner's measurement-stop finally, leaving a stale span that
 * keeps the D-02 single-slot 409 gate closed forever. This removes the span file ONLY when
 * its task_id belongs to the cancelled run — a foreign span is left in place. Never throws.
 *
 * @param {string} dataDir  the LLM_PROXY_DATA_DIR holding active-measurement.json
 * @param {object|null} progress  the run's parsed progress.json (task_id ownership source)
 * @param {object} deps  { readFile, unlink } fs seams (injectable for the test)
 * @returns {Promise<{cleared:boolean, reason?:string}>}
 */
async function clearRunOwnedSpan(dataDir, progress, { readFile, unlink }) {
  const spanPath = path.join(dataDir, 'active-measurement.json');
  let span;
  try {
    span = JSON.parse(await readFile(spanPath, 'utf8'));
  } catch (err) {
    // No span (ENOENT) or a torn file → nothing to clear; the slot is already free.
    if (err && err.code === 'ENOENT') return { cleared: false, reason: 'no-span' };
    process.stderr.write(`[experiment-executor] span read failed (non-fatal): ${err.message}\n`);
    return { cleared: false, reason: 'unreadable' };
  }

  if (!spanBelongsToRun(span?.task_id, progress)) {
    // Foreign span (or task-less) — leave it untouched (OQ3 scoping).
    return { cleared: false, reason: 'foreign-span' };
  }

  try {
    await unlink(spanPath);
    return { cleared: true };
  } catch (err) {
    if (err && err.code === 'ENOENT') return { cleared: false, reason: 'no-span' };
    process.stderr.write(`[experiment-executor] span clear failed (non-fatal): ${err.message}\n`);
    return { cleared: false, reason: 'unlink-failed' };
  }
}

/**
 * Cancel an experiment run on the host (D-08 + OQ3).
 *
 * (1) Delegate the negated-pid group kill to run-launch.cancelRun (Plan 02).
 * (2) Write the terminal progress patch via run-progress.writeProgress (Plan 01):
 *     run-level overall='cancelled', every in-flight cell (state running/restoring/scoring)
 *     → 'abort', and every pending cell stays 'pending' (already its state; explicit no-op).
 * (3) Clear the run-owned active-measurement.json span (OQ3) so the D-02 slot frees even
 *     after a hard SIGKILL — SCOPED to this run's task_ids.
 *
 * @param {object} args
 * @param {string} args.run_id
 * @param {string} args.run_dir
 * @param {number} args.pid
 * @param {string} [args.dataDir]  LLM_PROXY_DATA_DIR holding active-measurement.json
 *                                 (default: env.LLM_PROXY_DATA_DIR ?? <run_dir>/../../..)
 * @param {object} [args.env]      host env (for the default dataDir resolution)
 * @param {Function} [args.cancelFn]        injectable cancel seam (default run-launch.cancelRun)
 * @param {Function} [args.writeProgressFn] injectable progress seam (default run-progress.writeProgress)
 * @param {Function} [args.readProgressFn]  injectable progress reader (default run-progress.readProgress)
 * @param {object} [args.fsDeps]   { readFile, unlink } for the span-clear (default node:fs/promises)
 * @returns {Promise<{success:boolean, killed?:boolean, reason?:string, span_cleared?:boolean, message?:string}>}
 */
export async function cancelExperiment({
  run_id,
  run_dir,
  pid,
  dataDir,
  env = process.env,
  cancelFn = defaultCancelRun,
  writeProgressFn = defaultWriteProgress,
  readProgressFn = defaultReadProgress,
  fsDeps = { readFile: fs.readFile, unlink: fs.unlink },
}) {
  if (!run_dir || pid === undefined || pid === null) {
    return { success: false, message: 'run_dir and pid are required' };
  }
  // CR-01: reject a non-minted-shape run_id BEFORE any fs sink (when supplied).
  if (run_id !== undefined && run_id !== null && !isValidRunId(run_id)) {
    return { success: false, message: `invalid run_id: ${run_id}` };
  }

  // Seam path contract: a repo-relative run_dir (sent by the container vkb-server)
  // resolves against the HOST repo root; CR-01 resolveRunDir also asserts containment
  // under .data/experiments/runs/ — a traversal throws here, never signals or writes.
  let hostRunDir;
  try {
    hostRunDir = resolveRunDir(run_dir);
  } catch (err) {
    return { success: false, message: err.message };
  }

  // CR-02: read the run's OWN run.json and assert the requested pid MATCHES the pid this run
  // recorded at launch. A caller-supplied pid that does not match the run is REFUSED — the
  // coordinator must never group-kill an arbitrary process group on an attacker's say-so.
  let runJson = null;
  try {
    runJson = JSON.parse(await fsDeps.readFile(path.join(hostRunDir, 'run.json'), 'utf8'));
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return { success: false, message: `no run.json for run_dir=${run_dir}; refusing to signal pid ${pid}` };
    }
    process.stderr.write(`[experiment-executor] run.json read failed: ${err.message}\n`);
    return { success: false, message: `run.json unreadable for run_dir=${run_dir}; refusing to signal pid ${pid}` };
  }
  if (!Number.isInteger(runJson?.pid) || Number(runJson.pid) !== Number(pid)) {
    return {
      success: false,
      pid_mismatch: true,
      message: `pid ${pid} does not match run.json.pid (${runJson?.pid}) — refusing to group-kill an unowned pid`,
    };
  }

  // CR-02: a pid-reuse sanity guard — decline if the live process no longer plausibly belongs
  // to THIS run (its recorded run.json is missing the started_at anchor we launched with).
  // run-launch.cancelRun already accepts this hook; wire it here (it was never supplied before).
  const pidLooksLikeRunner = (rj) => !!(rj && typeof rj.started_at === 'string' && rj.started_at.length > 0);

  // (1) group-kill the detached run (negated pid, SIGTERM→SIGKILL grace — owned by run-launch).
  let killResult = { killed: false };
  try {
    killResult = cancelFn({ pid, runJson, pidLooksLikeRunner });
  } catch (err) {
    process.stderr.write(`[experiment-executor] cancel kill failed: ${err.message}\n`);
    // Continue to the progress patch + span clear even if the kill raced — the run may be
    // already-gone, and the terminal patch + slot-free must still happen.
  }

  // (2) terminal progress patch (Plan 01 writeProgress — atomic + never-throw).
  //     Read current cells to flip only the in-flight ones to 'abort'.
  let progress = null;
  try {
    progress = await readProgressFn(hostRunDir);
  } catch {
    progress = null;
  }
  const inflightStates = new Set(['running', 'restoring', 'scoring']);
  const abortedCells = Array.isArray(progress?.cells)
    ? progress.cells
        .filter((c) => c && inflightStates.has(c.state))
        .map((c) => ({
          variant: c.variant,
          rep: c.rep,
          state: 'abort',
          ended_at: new Date().toISOString(),
          reason: 'cancelled',
        }))
    : [];
  const patch = { overall: 'cancelled' };
  if (abortedCells.length > 0) patch.cells = abortedCells;
  await writeProgressFn(hostRunDir, patch);

  // (3) OQ3 stale-span clear — SCOPED to this run's recorded cell task_ids.
  // CR-01: the dataDir is PINNED to the repo `.data` root (never derived unbounded from
  // `<run_dir>/../../..`, which a crafted run_dir could otherwise steer the span `unlink`
  // to an attacker-chosen directory). An explicit dataDir arg / LLM_PROXY_DATA_DIR still
  // wins for the injectable contract test + a relocated data dir.
  const resolvedDataDir = dataDir || env.LLM_PROXY_DATA_DIR || DATA_ROOT;
  const spanResult = await clearRunOwnedSpan(resolvedDataDir, progress, fsDeps);

  return {
    success: true,
    killed: !!killResult.killed,
    reason: killResult.reason,
    span_cleared: spanResult.cleared,
  };
}
