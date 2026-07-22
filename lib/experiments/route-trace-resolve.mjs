// Phase 72 gap-closure (72-06 inline): wire the dominant-agent trace resolution
// the close orchestrator was missing. Two breaks made route heuristics permanently
// null for Claude/Copilot runs (the agents that actually run /gsd):
//
//   1. The proxy token rows leave `agent` blank (only `model` is set, e.g.
//      'claude-sonnet-4.6'), so `byAgentModel[0].agent === ''` and
//      `buildNormalizedTrace`'s `KNOWN_AGENTS.has('')` short-circuits to null.
//   2. `build-trace.mjs`'s DEFAULT_LOCATORS.claude/copilot return null by design —
//      they expect the CLOSE ORCHESTRATOR to resolve the per-run session JSONL and
//      inject it via the `__seam`. measurement-stop never did this.
//
// This module supplies both: `normalizeAgent` derives the canonical agent family
// from the (agent, model) pair, and `locateClaudeSessionForSpan` resolves the
// session transcript that overlaps the span time-window (time/mtime-based — it
// NEVER derives a filename from the task_id; that threat-model rule from
// build-trace.mjs:78 is preserved).

import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Canonical agents the route readers + build-trace dispatcher understand.
 * Exported as the single source of truth so experiment-spec.mjs's own KNOWN_AGENTS can be
 * drift-tested against it (WR-02, Phase 77 review) instead of a hardcoded test literal.
 */
export const KNOWN_AGENTS = ['claude', 'copilot', 'opencode'];

/**
 * Map a measurement-span's dominant (agent, model) to one of KNOWN_AGENTS, or
 * null when it can't be classified. `agent` wins when it already names a known
 * family; otherwise the model string is the fallback signal (Claude proxy rows
 * carry model='claude-*' with a blank agent — the exact live-blocker case).
 *
 * @param {{agent?:string, model?:string}} [dominant]
 * @returns {'claude'|'copilot'|'opencode'|null}
 */
export function normalizeAgent({ agent, model } = {}) {
  const a = (agent || '').toLowerCase().trim();
  for (const known of KNOWN_AGENTS) {
    if (a === known || a.includes(known)) return known;
  }
  const m = (model || '').toLowerCase();
  if (m.includes('claude')) return 'claude'; // claude-sonnet-4.6, claude-opus-*, …
  if (m.includes('copilot') || m.startsWith('gpt-') || m.startsWith('o1') || m.startsWith('o3')) {
    return 'copilot'; // Copilot fronts gpt-*/o-series models
  }
  return null; // honest no-classification — caller falls back to ALL_NULL heuristics
}

/**
 * Resolve the Claude session JSONL that was active during a span's time-window.
 *
 * Strategy (NEVER task_id-derived — build-trace.mjs:78 threat model): under the
 * encoded-cwd projects dir, consider only TOP-LEVEL `<session-uuid>.jsonl` files
 * (sub-agent files live under `<uuid>/subagents/` and are linked by the reader,
 * not selected here), drop any whose file was last written well BEFORE the run
 * started (can't overlap), and return the most-recently-written remaining
 * candidate — the session being appended to at close. Returns null when the dir
 * is absent or no file overlaps (honest no-trace → ALL_NULL heuristics, D-02).
 *
 * @param {{started_at?:string, ended_at?:string}} span
 * @param {{projectsDir?:string, repoRoot?:string, slackMs?:number}} [opts] injectable for tests
 * @returns {string|null} absolute path to the session JSONL, or null
 */
export function locateClaudeSessionForSpan(span, opts = {}) {
  const projectsDir =
    opts.projectsDir ||
    process.env.LSL_CLAUDE_PROJECTS_DIR ||
    path.join(os.homedir(), '.claude', 'projects');
  const repoRoot = opts.repoRoot || process.env.CODING_REPO || process.cwd();
  const slackMs = opts.slackMs ?? 5 * 60 * 1000; // 5-min edge slack

  // Claude encodes the project cwd by replacing every '/' AND '.' with '-' — so a
  // sandbox worktree '/Users/…/coding/.data/run-restores/smoke-spec-…' becomes
  // '-Users-…-coding--data-run-restores-smoke-spec-…' (note '.data' → '--data').
  // This MUST match the token path's encodeCwd (stop-adapter-registry.mjs:164,
  // `cwd.replace(/[/.]/g, '-')`) — a prior slash-only encoding here silently missed
  // every sandbox transcript (whose paths contain dots), which is exactly what made
  // cross-agent cells fake-`trivial`. For a dot-free main-repo cwd the two are identical.
  const encoded = repoRoot.replace(/[/.]/g, '-');
  const projDir = path.join(projectsDir, encoded);

  let entries;
  try {
    entries = fs.readdirSync(projDir, { withFileTypes: true });
  } catch {
    return null; // no project dir → no trace
  }

  const startMs = span?.started_at ? Date.parse(span.started_at) : NaN;
  const candidates = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.jsonl')) continue; // top-level sessions only
    const p = path.join(projDir, e.name);
    let st;
    try {
      st = fs.statSync(p);
    } catch {
      continue;
    }
    // A session last written well before the run began cannot overlap it.
    if (Number.isFinite(startMs) && st.mtimeMs < startMs - slackMs) continue;
    candidates.push({ p, mtimeMs: st.mtimeMs });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs); // newest first = active session
  return candidates[0].p;
}

/**
 * Resolve the Copilot `events.jsonl` that was active during a span's time-window.
 *
 * Copilot writes per-session state under `~/.copilot/session-state/<uuid>/events.jsonl`
 * (the same file the copilot route reader + token adapter consume). These dirs are
 * uuid-keyed, NOT cwd-scoped — so, unlike Claude, the repoRoot/cwd is not a selector;
 * the span time-window is. Consider every `<uuid>/events.jsonl`, drop any last written
 * well BEFORE the run began (can't overlap) or well AFTER it ended (a later session),
 * and return the most-recently-written remaining candidate — the session being appended
 * to at close. Returns null when the dir is absent or nothing overlaps (honest no-trace
 * → ALL_NULL heuristics, D-02). Ownership is enforced downstream by the reader's
 * uid-check gate (copilot-route-trace.mjs readOwnedFile).
 *
 * NOTE (matches the Claude locator's limitation): with concurrent Copilot sessions the
 * newest-in-window pick can be ambiguous. Acceptable for isolated experiment cells.
 *
 * @param {{started_at?:string, ended_at?:string}} span
 * @param {{copilotStateDir?:string, slackMs?:number}} [opts] injectable for tests
 * @returns {string|null} absolute path to the events.jsonl, or null
 */
export function locateCopilotSessionForSpan(span, opts = {}) {
  const stateDir =
    opts.copilotStateDir ||
    process.env.LSL_COPILOT_STATE_DIR ||
    path.join(os.homedir(), '.copilot', 'session-state');
  const slackMs = opts.slackMs ?? 5 * 60 * 1000; // 5-min edge slack

  let entries;
  try {
    entries = fs.readdirSync(stateDir, { withFileTypes: true });
  } catch {
    return null; // no session-state dir → no trace
  }

  const startMs = span?.started_at ? Date.parse(span.started_at) : NaN;
  const endMs = span?.ended_at ? Date.parse(span.ended_at) : NaN;
  const candidates = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue; // <uuid>/ dirs only
    const p = path.join(stateDir, e.name, 'events.jsonl');
    let st;
    try {
      st = fs.statSync(p);
    } catch {
      continue; // no events.jsonl in this session dir
    }
    // A session last written well before the run began — or well after it ended —
    // cannot be this run's session.
    if (Number.isFinite(startMs) && st.mtimeMs < startMs - slackMs) continue;
    if (Number.isFinite(endMs) && st.mtimeMs > endMs + slackMs) continue;
    candidates.push({ p, mtimeMs: st.mtimeMs });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs); // newest first = active session
  return candidates[0].p;
}

/**
 * Build the `__seam` argument for `buildNormalizedTrace` for a given normalized
 * agent + span. Claude and Copilot both need a seam (their default locators are
 * stubs); OpenCode resolves via its single-file DB default, so it needs none.
 * Returns undefined when no seam injection is required.
 *
 * `opts.repoRoot` (the cell's `span.meta.cwd` sandbox worktree) selects the Claude
 * projects dir; it is ignored by the Copilot locator (uuid-keyed, not cwd-scoped).
 *
 * @param {'claude'|'copilot'|'opencode'|null} normAgent
 * @param {{started_at?:string, ended_at?:string}} span
 * @param {{projectsDir?:string, repoRoot?:string, copilotStateDir?:string, slackMs?:number}} [opts]
 * @returns {{locate:{claude?:Function, copilot?:Function}}|undefined}
 */
export function buildTraceSeam(normAgent, span, opts = {}) {
  if (normAgent === 'claude') {
    return { locate: { claude: () => locateClaudeSessionForSpan(span, opts) } };
  }
  if (normAgent === 'copilot') {
    return { locate: { copilot: () => locateCopilotSessionForSpan(span, opts) } };
  }
  return undefined;
}
