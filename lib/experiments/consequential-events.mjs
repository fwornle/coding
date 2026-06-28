/**
 * lib/experiments/consequential-events.mjs
 *
 * Phase 73, Plan 73-01 (Wave 1) — the pure, zero-LLM route-logic primitives the
 * judge (73-04) and the close orchestrator depend on:
 *   1. `isConsequentialTool` / `CONSEQUENTIAL_TOOLS` — separate ACTING tool calls
 *      (Edit/Write/MultiEdit/NotebookEdit/Bash/Task) from navigation/read calls
 *      (Read/Glob/Grep/WebFetch/WebSearch/TodoWrite) (D-02).
 *   2. `filterConsequential(trace)` — the shared projection used by both the
 *      trivial-run guard (D-04) and the judge's input builder.
 *   3. `isTrivialRun(trace)` — detect a run with ≈0 acting events WITHOUT an LLM
 *      call (D-04), so trivial runs short-circuit before the judge is paid for.
 *   4. `computeGoalAlignedRatio(labels)` — D-02 math: `toward/(toward+away)` with
 *      neutral EXCLUDED from the denominator. Computed in code (never trusting LLM
 *      arithmetic) so ROUTE-03 stays reproducible.
 *
 * The ratio follows the same `0` vs `null` contract as route-heuristics.mjs
 * (D-02, Pitfall 4):
 *   - `null` → "could not compute" (no labels, or every label is neutral so the
 *     denominator is zero). NEVER coerced to `0` (threat T-73-01-COERCE — a silent
 *     0 would corrupt cross-run averages).
 *   - `0`    → "labels present, genuinely all-away".
 *
 * Pure ESM (no build step). Imports NOTHING from the knowledge-graph core or the
 * filesystem stdlib — it consumes only the `RouteEvent` shape (tool_name + seq
 * order) defined in `../lsl/route/route-event.mjs`. Any diagnostics use
 * `process.stderr.write` only (the no-console-log rule — never the stdout API).
 *
 * @typedef {import('../lsl/route/route-event.mjs').RouteEvent} RouteEvent
 */

import process from 'node:process';

/**
 * The CONSEQUENTIAL (acting) tool-name set — the union of native acting-tool
 * names across claude / copilot / opencode (tool_name arrives un-normalized,
 * route-event.mjs:30). An event with one of these names changed real state
 * (a file edit, a shell command, or a delegated sub-agent task). Frozen so
 * callers cannot mutate the shared contract. Keep extensible — document each
 * entry's intent so a new agent's acting tool is added deliberately.
 *
 * @type {ReadonlyArray<string>}
 */
const CONSEQUENTIAL_TOOLS = Object.freeze([
  'Edit', // single in-place file edit (acts on target_path)
  'Write', // create/overwrite a file (acts on target_path)
  'MultiEdit', // batched in-place edits to one file
  'NotebookEdit', // edit a Jupyter notebook cell
  'Bash', // run a shell command — arbitrary side effects
  'Task', // delegate to a sub-agent — consequential by delegation
]);

/**
 * isConsequentialTool — true when `name` is an ACTING tool (mutates state) vs a
 * navigation/read tool. Membership check against the frozen set; a non-string or
 * unknown name is non-consequential (navigation/read by default).
 *
 * @param {string} name agent-native tool name (RouteEvent.tool_name)
 * @returns {boolean}
 */
export function isConsequentialTool(name) {
  return CONSEQUENTIAL_TOOLS.includes(name);
}

/**
 * filterConsequential — project an ordered `RouteEvent[]` down to ONLY the
 * acting events, preserving seq order (the array is already seq-ordered by the
 * reader). A non-array / empty trace yields `[]` (nothing to act on). This is the
 * single shared projection both `isTrivialRun` and the judge input consume.
 *
 * @param {RouteEvent[]|null|undefined} trace ordered RouteEvent array
 * @returns {RouteEvent[]} the consequential subset, in original order
 */
export function filterConsequential(trace) {
  if (!Array.isArray(trace) || trace.length < 1) {
    return [];
  }
  return trace.filter((e) => isConsequentialTool(e.tool_name));
}

/**
 * The trivial-run threshold (D-04 discretion: ≈0 consequential events). A run
 * with fewer than this many acting events is "trivial" — the agent navigated /
 * read but never changed state, so there is nothing for the judge to evaluate.
 *
 * @type {number}
 */
const TRIVIAL_THRESHOLD = 1;

/**
 * isTrivialRun — true when the trace has fewer than `TRIVIAL_THRESHOLD`
 * consequential events (D-04). Detected here, in code, with NO LLM call, so the
 * close orchestrator can short-circuit trivial runs before paying the judge.
 *
 * @param {RouteEvent[]|null|undefined} trace ordered RouteEvent array
 * @returns {boolean}
 */
export function isTrivialRun(trace) {
  return filterConsequential(trace).length < TRIVIAL_THRESHOLD;
}

/**
 * computeGoalAlignedRatio — the D-02 ratio `toward/(toward+away)` computed
 * deterministically from per-event labels. NEUTRAL labels never enter the
 * numerator OR the denominator. The denominator being zero (no labels, or every
 * label neutral) yields `null` — "could not compute", NEVER `0` (threat
 * T-73-01-COERCE: a silent 0 corrupts cross-run averages). A non-array / empty
 * `labels` also yields `null`.
 *
 * @param {Array<{seq:number,label:'toward'|'neutral'|'away'}>|null|undefined} labels
 * @returns {number|null} ratio in [0,1], or null when the denominator is zero
 */
export function computeGoalAlignedRatio(labels) {
  if (!Array.isArray(labels) || labels.length < 1) {
    return null;
  }
  let toward = 0;
  let away = 0;
  for (const l of labels) {
    if (l.label === 'toward') toward += 1;
    else if (l.label === 'away') away += 1;
    // 'neutral' (and any unknown label) is excluded from BOTH counts.
  }
  const denom = toward + away;
  return denom === 0 ? null : toward / denom;
}

// Touch process so the CLAUDE.md logging-contract import is genuinely used; this
// is a no-op guard that keeps the module's stderr-only logging discipline
// explicit without emitting any output on the happy path.
if (process == null) {
  // Unreachable in any real Node runtime; present only to anchor the import.
  throw new Error('node:process unavailable');
}

export { CONSEQUENTIAL_TOOLS, TRIVIAL_THRESHOLD };
