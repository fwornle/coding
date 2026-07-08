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

import { launchRun as defaultLaunchRun, cancelRun as defaultCancelRun } from './run-launch.mjs';
import { writeProgress as defaultWriteProgress, readProgress as defaultReadProgress } from './run-progress.mjs';

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
}) {
  if (!spec || !run_id || !run_dir) {
    return { success: false, message: 'spec, run_id and run_dir are required' };
  }
  try {
    const { pid, runDir } = await launchFn({
      specPath: spec,
      runId: run_id,
      runDir: run_dir,
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

  // (1) group-kill the detached run (negated pid, SIGTERM→SIGKILL grace — owned by run-launch).
  let killResult = { killed: false };
  try {
    killResult = cancelFn({ pid });
  } catch (err) {
    process.stderr.write(`[experiment-executor] cancel kill failed: ${err.message}\n`);
    // Continue to the progress patch + span clear even if the kill raced — the run may be
    // already-gone, and the terminal patch + slot-free must still happen.
  }

  // (2) terminal progress patch (Plan 01 writeProgress — atomic + never-throw).
  //     Read current cells to flip only the in-flight ones to 'abort'.
  let progress = null;
  try {
    progress = await readProgressFn(run_dir);
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
  await writeProgressFn(run_dir, patch);

  // (3) OQ3 stale-span clear — SCOPED to this run's recorded cell task_ids.
  const resolvedDataDir =
    dataDir || env.LLM_PROXY_DATA_DIR || path.resolve(run_dir, '..', '..', '..');
  const spanResult = await clearRunOwnedSpan(resolvedDataDir, progress, fsDeps);

  return {
    success: true,
    killed: !!killResult.killed,
    reason: killResult.reason,
    span_cleared: spanResult.cleared,
  };
}
