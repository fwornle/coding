/**
 * lib/experiments/route-heuristics.mjs
 *
 * Phase 72, Plan 72-01 (Wave 1) — the pure, zero-LLM `computeHeuristics(trace)`
 * function that turns an ordered `RouteEvent[]` into the six syntactic
 * route-quality metrics (ROUTE-02), under strict / high-precision calibration
 * (D-06) and per-heuristic null fallback (D-02).
 *
 * This is the deterministic floor under Phase 73's judge. A non-zero count must
 * be UNAMBIGUOUS signal — the definitions here are strict and every heuristic is
 * backed by a true-negative fixture (D-06/D-08).
 *
 * The metric values follow the `0` vs `null` contract (D-02, Pitfall 4):
 *   - `null`  → "could not compute" (no trace, or fewer than 1 event).
 *   - `0`     → "trace present, genuinely none".
 *
 * Pure ESM (no build step). Imports only the RouteEvent typedef + `inputsDigest`
 * from the sibling schema module — no `node:fs`, no km-core. Any diagnostics use
 * `process.stderr.write` only (the no-console-log rule — never the stdout API).
 *
 * @typedef {import('../lsl/route/route-event.mjs').RouteEvent} RouteEvent
 */

import process from 'node:process';
// inputsDigest is the canonical loop/redundant-read key. Imported per the
// key-link contract (every reader hashes inputs the same way) even though
// computeHeuristics consumes the already-stamped `inputs_digest` field — the
// import keeps the contract explicit and lets callers re-derive a digest.
import { inputsDigest } from '../lsl/route/route-event.mjs'; // eslint-disable-line no-unused-vars
export { inputsDigest };

/** The six heuristic keys, in canonical order. */
const HEURISTIC_KEYS = Object.freeze([
  'loop_count',
  'edit_revert_count',
  'redundant_read_count',
  'abandoned_tool_count',
  'total_step_count',
  'wallclock_per_step',
]);

/**
 * The all-null result (D-02). Returned for a `null` trace OR a trace with fewer
 * than one event — "could not compute", NEVER `0`. Frozen so callers cannot
 * mutate the shared sentinel.
 *
 * @type {Readonly<{loop_count:null,edit_revert_count:null,redundant_read_count:null,abandoned_tool_count:null,total_step_count:null,wallclock_per_step:null}>}
 */
export const ALL_NULL_HEURISTICS = Object.freeze({
  loop_count: null,
  edit_revert_count: null,
  redundant_read_count: null,
  abandoned_tool_count: null,
  total_step_count: null,
  wallclock_per_step: null,
});

/** A file tool whose target_path participates in read/edit ordering. */
function isReadTool(name) {
  return name === 'Read';
}
function isMutateTool(name) {
  // Edit/Write/MultiEdit/NotebookEdit all mutate the target_path's state.
  return name === 'Edit' || name === 'Write' || name === 'MultiEdit' || name === 'NotebookEdit';
}

/**
 * total_step_count — count of ALL RouteEvents regardless of outcome (D-07).
 * success/error/denied/abandoned each consumed a step.
 */
function totalStepCount(trace) {
  return trace.length;
}

/**
 * wallclock_per_step — `(lastTerminal − firstStart) / max(1, count)` in ms.
 * The run span runs first `started_at` → last terminal timestamp (an event's
 * `ended_at` if present, else its `started_at`). Single-event run → the event's
 * own `ended − started`. Timestamps are parsed via `Date.parse` ONLY (Pitfall 6
 * — readers already normalize to ISO-8601). Returns a number (ms).
 */
function wallclockPerStep(trace) {
  const count = trace.length;
  if (count === 1) {
    const e = trace[0];
    const start = Date.parse(e.started_at);
    const end = e.ended_at != null ? Date.parse(e.ended_at) : start;
    return Math.max(0, end - start);
  }
  const firstStart = Date.parse(trace[0].started_at);
  const last = trace[count - 1];
  const lastTerminal = last.ended_at != null ? Date.parse(last.ended_at) : Date.parse(last.started_at);
  const span = Math.max(0, lastTerminal - firstStart);
  return span / Math.max(1, count);
}

/**
 * abandoned_tool_count — count of events whose `outcome === 'abandoned'` (D-06).
 * A reader stamps `abandoned` exactly when a start event has no matching
 * terminal result; here we trust that contract and count the marker.
 */
function abandonedToolCount(trace) {
  let n = 0;
  for (const e of trace) if (e.outcome === 'abandoned') n += 1;
  return n;
}

/**
 * redundant_read_count — count of successful reads of a `target_path` already
 * read earlier in the run with NO intervening Edit/Write to that same path
 * (strict, D-06). A re-read after an edit is NOT redundant (state changed).
 */
function redundantReadCount(trace) {
  // Per target_path: has it been read since the last mutation?
  const readSinceMutate = new Map(); // target_path -> boolean
  let n = 0;
  for (const e of trace) {
    const p = e.target_path;
    if (p == null) continue;
    if (isMutateTool(e.tool_name)) {
      // Any mutation resets the "already read" state for this path.
      readSinceMutate.set(p, false);
      continue;
    }
    if (isReadTool(e.tool_name) && e.outcome === 'success') {
      if (readSinceMutate.get(p) === true) {
        n += 1; // exact re-read with no mutation between → redundant
      } else {
        readSinceMutate.set(p, true);
      }
    }
  }
  return n;
}

/**
 * edit_revert_count — v0 strict definition (OQ2/A2 lock): an Edit-input
 * A→B→A pattern on the SAME `target_path`, where the per-edit `inputs_digest`
 * returns to a digest already seen earlier for that path. Each such return
 * counts 1. A→B→C (never returns) → 0 (true-negative). This is the input-pattern
 * v0 — byte-state reconstruction is a future refinement (RESEARCH §Notes).
 *
 * Returns `null` only when edit inputs are not reconstructable for the run; here
 * the trace already carries `inputs_digest` on every event, so we never return
 * `null` from this path (the null case is owned by the no-trace gate in
 * `computeHeuristics`).
 */
function editRevertCount(trace) {
  const seenByPath = new Map(); // target_path -> Set<inputs_digest seen before the current edit>
  let n = 0;
  for (const e of trace) {
    if (!isMutateTool(e.tool_name)) continue;
    const p = e.target_path;
    if (p == null) continue;
    let seen = seenByPath.get(p);
    if (!seen) {
      seen = new Set();
      seenByPath.set(p, seen);
    }
    if (seen.has(e.inputs_digest)) {
      n += 1; // returned to an earlier edit-input state on this path → revert
    }
    seen.add(e.inputs_digest);
  }
  return n;
}

/**
 * loop_count — count of MAXIMAL runs of ≥2 consecutive RouteEvents identical in
 * `(tool_name, inputs_digest)` (strict, D-06). Each maximal repeat-cluster
 * contributes 1 (a 3x repeat = one loop, NOT two). Non-adjacent repeats
 * (x, y, x) → 0 (true-negative).
 */
function loopCount(trace) {
  let n = 0;
  let runLen = 1;
  for (let i = 1; i < trace.length; i += 1) {
    const prev = trace[i - 1];
    const cur = trace[i];
    if (cur.tool_name === prev.tool_name && cur.inputs_digest === prev.inputs_digest) {
      runLen += 1;
      if (runLen === 2) n += 1; // first time this cluster reaches length 2
    } else {
      runLen = 1;
    }
  }
  return n;
}

/**
 * computeHeuristics — turn an ordered `RouteEvent[]` into the six syntactic
 * route-quality metrics. A `null`/non-array trace OR an empty trace (fewer than
 * one event) yields `ALL_NULL_HEURISTICS` (D-02 — "could not compute", never 0).
 *
 * @param {RouteEvent[]|null|undefined} trace ordered RouteEvent array
 * @returns {{loop_count:number|null,edit_revert_count:number|null,redundant_read_count:number|null,abandoned_tool_count:number|null,total_step_count:number|null,wallclock_per_step:number|null}}
 */
export function computeHeuristics(trace) {
  if (!Array.isArray(trace) || trace.length < 1) {
    return ALL_NULL_HEURISTICS;
  }
  return {
    loop_count: loopCount(trace),
    edit_revert_count: editRevertCount(trace),
    redundant_read_count: redundantReadCount(trace),
    abandoned_tool_count: abandonedToolCount(trace),
    total_step_count: totalStepCount(trace),
    wallclock_per_step: wallclockPerStep(trace),
  };
}

// Touch process so the CLAUDE.md logging-contract import is genuinely used; this
// is a no-op guard that keeps the module's stderr-only logging discipline
// explicit without emitting any output on the happy path.
if (process == null) {
  // Unreachable in any real Node runtime; present only to anchor the import.
  throw new Error('node:process unavailable');
}

export { HEURISTIC_KEYS };
