/**
 * lib/lsl/route/build-trace.mjs
 *
 * Phase 72, Plan 72-04 (Wave 3) — the `buildNormalizedTrace` dispatcher (D-01).
 * One entry point the close orchestrator (Plan 05) calls to obtain the
 * cross-agent `RouteEvent[]` for a run: it picks the per-agent reader by the
 * run's DOMINANT agent, scopes the emitted events to the span time-window
 * (Pitfall 7 — the single biggest correctness risk), and returns `null`
 * (NOT `[]`) when no trace FILE can be located for the run (D-02 / Pitfall 4
 * honest fallback — a fabricated empty trace is NOT a measured-empty trace).
 *
 * Reader dispatch (the three Wave-2/3 readers, each emitting the SAME contract):
 *   'claude'   → buildClaudeRouteTrace   (lib/lsl/route/claude-route-trace.mjs)
 *   'copilot'  → buildCopilotRouteTrace  (lib/lsl/route/copilot-route-trace.mjs)
 *   'opencode' → buildOpenCodeRouteTrace (lib/lsl/route/opencode-route-trace.mjs)
 * Any other / missing dominantAgent → null (no fabricated trace).
 *
 * Trace-file location reuses the SAME env-override → home-default contract the
 * Phase-51 adapters publish (lib/lsl/adapters/index.mjs:132-137,
 * lib/lsl/adapters/README.md) — this dispatcher does NOT invent a new path
 * walker (RESEARCH Don't-Hand-Roll):
 *   claude   : LSL_CLAUDE_PROJECTS_DIR  → ~/.claude/projects
 *   copilot  : LSL_COPILOT_SESSIONS_DIR → ~/.copilot/session-state
 *   opencode : LSL_OPENCODE_DB          → ~/.local/share/opencode/opencode.db
 * The default locator returns a path only when it EXISTS on disk (so a missing
 * file → null, distinct from a found-but-empty-window file → []). The readers
 * apply their own uid-check gates; this dispatcher never derives a filename from
 * the task_id (T-72-04 threat model — no task_id-derived filenames).
 *
 * Time-window predicate (Pitfall 7): an event is kept iff
 *   event.started_at >= span.started_at && event.started_at <= span.ended_at
 * INCLUSIVE on both bounds, lexical ISO-8601 UTC comparison — CONFIRMED against
 * scripts/backfill-task-id-by-timestamp.mjs:131-147 (the D-03 timestamp-join
 * `timestamp >= ? AND timestamp <= ?` predicate; "Lexical comparison on ISO-8601
 * UTC text is chronologically correct").
 *
 * Per the CLAUDE.md logging rule: process.stderr.write only (no stdout logging
 * API). Pure ESM (no build step).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { buildClaudeRouteTrace } from './claude-route-trace.mjs';
import { buildCopilotRouteTrace } from './copilot-route-trace.mjs';
import { buildOpenCodeRouteTrace } from './opencode-route-trace.mjs';

/** The set of dominant-agent ids this dispatcher knows how to read. */
const KNOWN_AGENTS = new Set(['claude', 'copilot', 'opencode']);

/**
 * Return `p` if it exists on disk, else null. A missing file is the signal for
 * the D-02 null fallback (distinct from a found-but-empty-window []).
 *
 * @param {string} p
 * @returns {string|null}
 */
function existingPathOrNull(p) {
  try {
    return fs.existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

/**
 * Default per-agent trace-file locators (env-override → home-default contract,
 * mirroring lib/lsl/adapters/index.mjs:132-137). Each returns an absolute path
 * that EXISTS on disk, or null when no trace file is located for the run.
 *
 * For Claude/Copilot the canonical store is a DIRECTORY of per-session files;
 * resolving the exact session for a given run is the close orchestrator's job
 * (Plan 05, which passes the resolved path through the seam). The default
 * locator here returns the OpenCode single-file db when present, and for
 * Claude/Copilot returns null unless an explicit per-run file is injected — it
 * never guesses a session filename from the task_id (threat model: no
 * task_id-derived filenames).
 */
const DEFAULT_LOCATORS = Object.freeze({
  opencode() {
    const db = process.env.LSL_OPENCODE_DB
      || path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
    return existingPathOrNull(db);
  },
  // Claude/Copilot per-run file resolution is a Plan-05 concern; the dispatcher
  // accepts the resolved path via the seam. With no seam, there is no single
  // canonical file to read for a run → null (honest no-trace, not a guess).
  claude() {
    return null;
  },
  copilot() {
    return null;
  },
});

/** Default per-agent readers (the three Wave-2/3 readers). */
const DEFAULT_READERS = Object.freeze({
  claude: buildClaudeRouteTrace,
  copilot: buildCopilotRouteTrace,
  opencode: buildOpenCodeRouteTrace,
});

/**
 * Keep only events whose `started_at` falls within the span time-window,
 * INCLUSIVE on both bounds (Pitfall 7 — confirmed against the backfill
 * predicate). Events with a null/absent `started_at` are dropped (they cannot
 * be attributed to the window). Lexical ISO-8601 UTC comparison.
 *
 * @param {Array<import('./route-event.mjs').RouteEvent>} events
 * @param {{started_at:string, ended_at:string}} span
 * @returns {Array<import('./route-event.mjs').RouteEvent>}
 */
function filterToWindow(events, span) {
  const lo = span.started_at;
  const hi = span.ended_at;
  return events.filter((e) => {
    const t = e.started_at;
    if (typeof t !== 'string' || t.length === 0) return false;
    return t >= lo && t <= hi;
  });
}

/**
 * Build the normalized cross-agent `RouteEvent[]` for one run.
 *
 * Dispatches to the reader for `dominantAgent`, locates the run's trace file,
 * reads it, and scopes the events to `[span.started_at, span.ended_at]`.
 *
 *   - Unknown / missing `dominantAgent` → null (no fabricated trace).
 *   - No trace FILE located → null (D-02 / Pitfall 4) — distinct from
 *   - file located but zero in-window events → [] (genuinely measured-empty).
 *
 * @param {{task_id?:string, started_at:string, ended_at:string}} span
 *        the run's measurement span (ISO-8601 bounds; lexical-comparable).
 * @param {object} [opts]
 * @param {'claude'|'copilot'|'opencode'} [opts.dominantAgent] the run's dominant
 *        agent (computed at the call site — measurement-stop.mjs:188-189,
 *        `byAgentModel[0].agent`).
 * @param {{locate?:object, readers?:object}} [opts.__seam] test/orchestrator
 *        injection seam: `locate[agent](span) → path|null` and
 *        `readers[agent](path, window) → RouteEvent[]`. Falls back to the
 *        default home-dir locators + the three real readers.
 * @returns {Promise<Array<import('./route-event.mjs').RouteEvent>|null>}
 */
export async function buildNormalizedTrace(span, { dominantAgent, __seam } = {}) {
  if (!span || typeof span !== 'object') return null;
  if (!KNOWN_AGENTS.has(dominantAgent)) {
    // Unknown / missing agent → null (no fabricated trace).
    if (dominantAgent != null) {
      process.stderr.write(
        `[build-trace] unknown dominantAgent="${dominantAgent}"; returning null\n`,
      );
    }
    return null;
  }

  const locate = (__seam && __seam.locate && __seam.locate[dominantAgent])
    || DEFAULT_LOCATORS[dominantAgent];
  const reader = (__seam && __seam.readers && __seam.readers[dominantAgent])
    || DEFAULT_READERS[dominantAgent];

  // Locate the run's trace FILE. No file → null (D-02 honest no-trace fallback).
  let tracePath;
  try {
    tracePath = await locate(span);
  } catch (err) {
    process.stderr.write(
      `[build-trace] locate(${dominantAgent}) threw: ${err?.message ?? err}; returning null\n`,
    );
    return null;
  }
  if (!tracePath) return null;

  // Read the trace file via the matching reader, then window-filter. A reader
  // returning [] for a LOCATED file is a genuine empty trace (NOT null) — keep
  // [] distinct from the no-file null above (Pitfall 4).
  let events;
  try {
    events = await reader(tracePath, {
      startedAt: span.started_at,
      endedAt: span.ended_at,
    });
  } catch (err) {
    process.stderr.write(
      `[build-trace] reader(${dominantAgent}) threw for ${tracePath}: ${err?.message ?? err}; returning null\n`,
    );
    return null;
  }
  if (!Array.isArray(events)) return [];

  return filterToWindow(events, span);
}
