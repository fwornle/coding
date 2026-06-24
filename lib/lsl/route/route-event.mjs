/**
 * lib/lsl/route/route-event.mjs
 *
 * Phase 72, Plan 72-01 (Wave 1) — the ONE cross-agent normalized `RouteEvent`
 * schema (D-01) + the deterministic `inputsDigest` helper that keys the
 * loop / redundant-read / edit-revert heuristics.
 *
 * This module is a pure transform utility. It imports NOTHING from km-core or
 * `node:fs` — every Wave-2 reader (claude / copilot / opencode) emits the shape
 * defined here, and `lib/experiments/route-heuristics.mjs` consumes only
 * `RouteEvent[]`. Pure ESM, no build step.
 *
 * Per the CLAUDE.md logging rule: any diagnostics use `process.stderr.write`
 * only (no stdout logging API). The happy path here is silent; `warnOnce`
 * exists so reader-side misuse (a non-string digest input that fails to
 * canonicalize) surfaces on stderr rather than throwing.
 */

import crypto from 'node:crypto';
import process from 'node:process';

/**
 * One normalized tool-call event. D-07: one RouteEvent == one tool call;
 * parallel same-turn calls are SEPARATE RouteEvents (never collapsed). The
 * nine fields are the single cross-agent contract every reader emits against.
 *
 * @typedef {Object} RouteEvent
 * @property {number} seq            0-based ordinal in the run; stable sort key, ties broken by tool_call_id.
 * @property {string} tool_call_id   Native id — Claude `toolu_*`, Copilot `toolCallId`, OpenCode `callID`.
 * @property {string} tool_name      Agent-native tool name (`'Read'` | `'Edit'` | `'Bash'` | ...); NOT normalized away.
 * @property {string} inputs_digest  sha256 hex of canonical JSON of the tool input args (loop / redundant-read key).
 * @property {string|null} target_path  Resolved `file_path` for file tools (Read/Edit/Write); null otherwise.
 * @property {string} started_at     ISO-8601 — when the tool call began.
 * @property {string|null} ended_at  ISO-8601 — when it terminated; null === abandoned (no matching terminal event).
 * @property {'success'|'error'|'denied'|'abandoned'} outcome  Per-agent outcome (RESEARCH §Pattern 1 mapping table).
 * @property {'claude'|'copilot'|'opencode'} agent  The agent that produced this event.
 */

/**
 * The exhaustive set of `RouteEvent.outcome` values (D-07). Frozen so callers
 * cannot mutate the contract. Errored / denied / abandoned events all count
 * toward `total_step_count` — they are real tool calls that consumed a step.
 *
 * @type {Readonly<{SUCCESS:'success',ERROR:'error',DENIED:'denied',ABANDONED:'abandoned'}>}
 */
export const OUTCOMES = Object.freeze({
  SUCCESS: 'success',
  ERROR: 'error',
  DENIED: 'denied',
  ABANDONED: 'abandoned',
});

/**
 * The four outcome strings as a frozen array, for membership checks.
 * @type {ReadonlyArray<'success'|'error'|'denied'|'abandoned'>}
 */
export const OUTCOME_VALUES = Object.freeze(Object.values(OUTCOMES));

/**
 * Deterministic sha256 digest of a tool's input args (V6 — NEVER hand-roll a
 * hash). Canonicalizes via `JSON.stringify(input ?? null)` then hashes with the
 * `node:crypto` stdlib. Stable for identical input; distinct for different
 * input; never throws for `null` / `undefined` (both canonicalize to the JSON
 * literal `null`, yielding a stable hex string).
 *
 * Note: this is the redundant/loop-detection KEY only — raw tool inputs are NOT
 * carried forward (threat T-72-01-CRYPTO: no raw inputs persisted by this plan).
 *
 * @param {*} input the tool input args (any JSON-serializable value, or null/undefined)
 * @returns {string} 64-char lowercase hex sha256 digest
 */
export function inputsDigest(input) {
  let canonical;
  try {
    canonical = JSON.stringify(input ?? null);
  } catch (err) {
    // Non-serializable input (e.g. a circular reference). Never throw — a route
    // reader must keep building the trace. Fall back to a stable marker so the
    // event still gets a digest (it just won't dedupe against other inputs).
    process.stderr.write(
      `[route-event] inputsDigest: input not JSON-serializable (${err?.message ?? 'unknown'}); using fallback marker\n`,
    );
    canonical = '"__route_event_unserializable_input__"';
  }
  // `undefined` survives JSON.stringify as the literal `undefined` (not a
  // string); coalesce so update() always receives a string.
  if (typeof canonical !== 'string') canonical = 'null';
  return crypto.createHash('sha256').update(canonical).digest('hex');
}
