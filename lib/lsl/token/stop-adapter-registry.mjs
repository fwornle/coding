/**
 * lib/lsl/token/stop-adapter-registry.mjs
 *
 * Phase 75, Plan 75-03 (Wave 2) — the per-agent foreground-token capture
 * registry (ATTR-03 / D-04). The foreground Claude Code session talks to
 * Anthropic DIRECTLY (it bypasses the rapid-llm-proxy), so its own tokens are
 * invisible to `token_usage` today — a measured Opus session recorded 0 cladpt
 * rows for its task_id. This registry closes that gap by composing the THREE
 * existing primitives at measurement-stop time:
 *
 *   - buildClaudeTokenRows()   — claude-token-rows.mjs (transcript → rows, uid-gated)
 *   - insertTokenRowDeduped()  — token-db.mjs (idempotent (user_hash,tool_call_id) insert)
 *   - resolveLiveTaskIdSafe()  — task-id.mjs (best-effort active task_id; never throws)
 *
 * CRITICAL no-double-count rule (D-04): ONLY claude gets a transcript adapter.
 * copilot / opencode / mastra ALL route through the rapid-llm-proxy and are
 * therefore ALREADY recorded in `token_usage` — building a transcript adapter
 * for any of them would DOUBLE-COUNT their tokens. They are encoded as
 * `mode: 'stamp-only'` with NO `build` property, and captureForegroundTokens
 * returns immediately (doing zero transcript work) for them.
 *
 * Security / robustness:
 *   - uid-gate (V4): the located main-session path is passed STRAIGHT to
 *     buildClaudeTokenRows so its existing owner-uid ownership gate runs. This
 *     module introduces NO weaker re-stat of the transcript.
 *   - best-effort (D-08): the whole capture body is wrapped — on ANY failure it
 *     writes a `[stop-adapter]` stderr line and returns. The DB close lives in a
 *     finally so a capture failure can never crash the measurement-stop close.
 *
 * Per CLAUDE.md: this module uses process.stderr.write only (no-console-log).
 * Pure ESM (no build step).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { buildClaudeTokenRows } from './claude-token-rows.mjs';
import {
  openTokenDb,
  insertTokenRowDeduped,
  ADAPTER_USER_HASH_CLAUDE,
} from './token-db.mjs';
import { resolveLiveTaskIdSafe } from './task-id.mjs';

/**
 * The default proxy-owned token DB (the second-writer target). Overridable via
 * `opts.dbPath` (tests) so the capture path never has to touch the live DB.
 */
const DEFAULT_TOKEN_DB =
  '/Users/Q284340/Agentic/coding/.data/llm-proxy/token-usage.db';

/**
 * Per-agent stop-time adapter registry (Pattern 1 — keyed map).
 *
 * - 'transcript' (claude ONLY): build main-session rows and insert them as
 *   `cladpt`. Claude bypasses the proxy, so this is the only way its tokens are
 *   recorded.
 * - 'stamp-only' (copilot / opencode / mastra): rows are ALREADY in token_usage
 *   via the proxy; the only gap is the task_id, NOT capture. These carry NO
 *   `build` property — adding one would DOUBLE-COUNT proxy rows (D-04 anti-pattern).
 *
 * The single transcript-build binding (claude) is the grep-gated no-double-count invariant.
 */
export const STOP_ADAPTERS = {
  claude: {
    mode: 'transcript',
    userHash: ADAPTER_USER_HASH_CLAUDE,
    build: buildClaudeTokenRows,
  },
  // proxy-routed today; a copadt transcript adapter is added ONLY if a
  // bypass-guard (A1/OQ2) ever shows copilot talking to Anthropic directly.
  copilot: { mode: 'stamp-only' },
  opencode: { mode: 'stamp-only' },
  mastra: { mode: 'stamp-only' },
};

/**
 * Encode a span ISO timestamp to epoch-ms, tolerating undefined / unparseable.
 * @param {string|undefined} iso
 * @param {number} fallback
 * @returns {number}
 */
function tsMs(iso, fallback) {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : fallback;
}

/**
 * Encode a cwd into Claude Code's projects-dir convention (each path separator
 * and dot becomes a dash), e.g. `/Users/me/Agentic/coding` →
 * `-Users-me-Agentic-coding`.
 * @param {string} cwd
 * @returns {string}
 */
function encodeCwd(cwd) {
  return cwd.replace(/[/.]/g, '-');
}

/**
 * Default main-session locator (Pitfall 2): scan
 * `~/.claude/projects/<cwd-encoded>/` for the `*.jsonl` whose mtime falls inside
 * the span window `[started_at, ended_at]` — the same time-window approach
 * `buildTraceSeam` uses in measurement-stop.mjs. Returns the located absolute
 * path, or '' when nothing matches (best-effort — never throws).
 *
 * NOTE: this is intentionally a coarse mtime locator. The uid-gate / read
 * safety is enforced downstream by buildClaudeTokenRows (V4) — this locator
 * deliberately does NOT re-stat with any weaker ownership check.
 *
 * @param {{started_at?:string, ended_at?:string}} span
 * @returns {string} absolute JSONL path, or '' if not found
 */
function locateMainSessionJsonl(span) {
  try {
    const projectsDir = path.join(
      os.homedir(),
      '.claude',
      'projects',
      encodeCwd(process.cwd()),
    );
    const startMs = tsMs(span.started_at, 0);
    const endMs = tsMs(span.ended_at, Date.now());
    const entries = fs
      .readdirSync(projectsDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => {
        const full = path.join(projectsDir, f);
        let mtime = NaN;
        try {
          mtime = fs.statSync(full).mtimeMs;
        } catch {
          mtime = NaN;
        }
        return { full, mtime };
      })
      .filter((e) => Number.isFinite(e.mtime) && e.mtime >= startMs && e.mtime <= endMs)
      // Prefer the most recently touched within the window.
      .sort((a, b) => b.mtime - a.mtime);
    return entries.length ? entries[0].full : '';
  } catch (err) {
    process.stderr.write(
      `[stop-adapter] main-session locate failed (non-fatal): ${err.message}\n`,
    );
    return '';
  }
}

/**
 * Capture the foreground agent's tokens at measurement-stop time.
 *
 * Dispatch is driven by STOP_ADAPTERS keyed on the agent (`opts.agent` ??
 * `span.agent`):
 *   - For a STAMP-ONLY agent (copilot/opencode/mastra) OR an unknown agent, it
 *     returns IMMEDIATELY doing NO transcript work — those rows are already in
 *     token_usage via the proxy (the D-04 double-count guard).
 *   - For the TRANSCRIPT agent (claude) it: resolves the active task_id, locates
 *     the main-session JSONL by time-window, passes that path STRAIGHT to the
 *     adapter's `build` (so the uid-gate inside buildClaudeTokenRows runs), then
 *     idempotently inserts each row stamped with the adapter user_hash + task_id.
 *
 * The whole body is best-effort (D-08): on any failure it writes a non-fatal
 * `[stop-adapter]` stderr line and returns; the DB close lives in a finally so a
 * capture failure can never crash the measurement-stop close.
 *
 * @param {{task_id?:string, agent?:string, started_at?:string, ended_at?:string}} span
 *   the active measurement span (.data/active-measurement.json shape)
 * @param {object} [opts]
 * @param {string}   [opts.agent]          override the agent (else span.agent)
 * @param {string}   [opts.dbPath]         override the token DB (tests)
 * @param {string}   [opts.mainSessionPath] inject the main-session JSONL (tests)
 * @param {string}   [opts.locateOverride]  alias for mainSessionPath
 * @param {function} [opts.resolveTaskId]   inject the task_id resolver (tests)
 * @returns {Promise<number>} number of rows inserted (0 for stamp-only / on failure)
 */
export async function captureForegroundTokens(span = {}, opts = {}) {
  try {
    const agent = opts.agent ?? span.agent;
    const adapter = agent ? STOP_ADAPTERS[agent] : undefined;

    // (1) Double-count guard: stamp-only / unknown agents do ZERO transcript
    // work — their tokens are already proxy-captured in token_usage.
    if (!adapter || adapter.mode !== 'transcript' || typeof adapter.build !== 'function') {
      return 0;
    }

    // (2) Resolve the active task_id (injectable for tests; best-effort default).
    const taskId = opts.resolveTaskId
      ? await opts.resolveTaskId()
      : await resolveLiveTaskIdSafe();

    // (3) Locate the main-session JSONL by time-window (injectable for tests).
    const jsonlPath =
      opts.mainSessionPath ?? opts.locateOverride ?? locateMainSessionJsonl(span);
    if (!jsonlPath) {
      process.stderr.write(
        '[stop-adapter] no main-session JSONL located in span window (non-fatal)\n',
      );
      return 0;
    }

    // (4) Pass the located path STRAIGHT to build() so the existing uid-gate
    // inside buildClaudeTokenRows runs — NEVER re-stat with a weaker check.
    const rows = adapter.build(jsonlPath);
    if (!Array.isArray(rows) || rows.length === 0) return 0;

    const dbPath = opts.dbPath ?? DEFAULT_TOKEN_DB;
    const db = openTokenDb(dbPath);
    let inserted = 0;
    try {
      for (const row of rows) {
        // Stamp the captured row with the adapter user_hash + the active
        // task_id; idempotent on (user_hash, tool_call_id).
        const ok = insertTokenRowDeduped(db, {
          ...row,
          user_hash: adapter.userHash,
          task_id: taskId,
        });
        if (ok) inserted += 1;
      }
    } finally {
      db.close();
    }
    return inserted;
  } catch (err) {
    process.stderr.write(
      `[stop-adapter] capture failed (non-fatal): ${err.message}\n`,
    );
    return 0;
  }
}
