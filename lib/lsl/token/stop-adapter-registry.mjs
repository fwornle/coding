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
 * The `process` stamp for captured SUB-AGENT rows (ATTR-04). Distinct from the
 * main-session rows' 'token-adapter-claude' so the read-time fg/bg classifier keeps
 * sub-agents FOREGROUND (BACKGROUND_PROCESS_RE does NOT match this) while
 * measurement-stop's canonical picker can still exclude them from chat-model
 * selection — a big Explore sweep on a cheaper model must not hijack the canonical
 * model of the interactive chat.
 */
export const SUBAGENT_PROCESS = 'token-adapter-claude-subagent';

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
    // WR-03 (ATTR-03): an interactive Claude transcript is appended right up to
    // — and often a few ms/seconds AFTER — the recorded ended_at (the file is
    // still being written when stop fires). A strict `mtime <= endMs` upper
    // bound therefore EXCLUDES the active session file, the locator returns '',
    // and captureForegroundTokens records ZERO foreground tokens for the most
    // common case. Allow a grace window past ended_at so the still-being-written
    // file is still selected. Lower-bound (started_at) intent is preserved.
    const GRACE_MS = 5 * 60 * 1000; // 5 min — covers in-flight appends / clock skew.
    const upperMs = endMs + GRACE_MS;
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
      .filter((e) => Number.isFinite(e.mtime) && e.mtime >= startMs && e.mtime <= upperMs)
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
 * Locate the SUB-AGENT transcripts for the span's main session (ATTR-04). A
 * Task/Agent sub-agent's LLM calls bypass the proxy exactly like the main session,
 * so its tokens are invisible to token_usage unless reconstructed from its own
 * JSONL. Claude stores a session's sub-agents at
 * `<projectsDir>/<main-uuid>/subagents/agent-*.jsonl` (SUBAGENT_PATH_RE) — so we
 * derive <main-uuid> from the located main JSONL and glob that dir, filtered to the
 * SAME `[started_at, ended_at + grace]` window as the main locator. Best-effort: a
 * missing dir / unreadable entry yields fewer paths, never throws.
 *
 * @param {string} mainJsonlPath absolute path to the located main-session JSONL
 * @param {{started_at?:string, ended_at?:string}} span
 * @returns {string[]} absolute sub-agent JSONL paths (possibly empty)
 */
function locateSubagentJsonls(mainJsonlPath, span) {
  try {
    if (!mainJsonlPath) return [];
    // main is <projectsDir>/<uuid>.jsonl ; its sub-agents live one dir deeper.
    const dir = path.dirname(mainJsonlPath);
    const uuid = path.basename(mainJsonlPath, '.jsonl');
    const subDir = path.join(dir, uuid, 'subagents');
    if (!fs.existsSync(subDir)) return [];
    const startMs = tsMs(span.started_at, 0);
    const endMs = tsMs(span.ended_at, Date.now());
    const GRACE_MS = 5 * 60 * 1000; // mirror locateMainSessionJsonl: cover in-flight appends.
    const upperMs = endMs + GRACE_MS;
    return fs
      .readdirSync(subDir)
      .filter((f) => f.startsWith('agent-') && f.endsWith('.jsonl'))
      .map((f) => path.join(subDir, f))
      .filter((full) => {
        let mtime = NaN;
        try {
          mtime = fs.statSync(full).mtimeMs;
        } catch {
          mtime = NaN;
        }
        return Number.isFinite(mtime) && mtime >= startMs && mtime <= upperMs;
      });
  } catch (err) {
    process.stderr.write(
      `[stop-adapter] subagent locate failed (non-fatal): ${err.message}\n`,
    );
    return [];
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
 * @param {string[]} [opts.subagentPaths]   inject the sub-agent JSONL list (tests)
 * @param {function} [opts.resolveTaskId]   inject the task_id resolver (tests)
 * @returns {Promise<number>} number of rows inserted (main + sub-agents; 0 for
 *   stamp-only / on failure)
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

    // (4) Build the MAIN-session rows. Pass the located path STRAIGHT to build()
    // so the existing uid-gate inside buildClaudeTokenRows runs — NEVER re-stat
    // with a weaker check.
    const mainRows = adapter.build(jsonlPath);

    // (5) ATTR-04: also capture the span's SUB-AGENT transcripts. Their LLM calls
    // bypass the proxy exactly like the main session, so their tokens are invisible
    // to token_usage unless reconstructed here. buildClaudeTokenRows already handles
    // a sub-agent path (SUBAGENT_PATH_RE → isSidechain gate + parent linkage), so we
    // reuse it verbatim and stamp a distinct `process` (SUBAGENT_PROCESS) — keeping
    // the rows FOREGROUND yet distinguishable from the main chat (see the constant).
    const subagentPaths = opts.subagentPaths ?? locateSubagentJsonls(jsonlPath, span);
    const batches = [{ rows: mainRows, process: undefined }];
    for (const sp of subagentPaths) {
      batches.push({ rows: adapter.build(sp), process: SUBAGENT_PROCESS });
    }

    const dbPath = opts.dbPath ?? DEFAULT_TOKEN_DB;
    const db = openTokenDb(dbPath);
    let inserted = 0;
    try {
      for (const batch of batches) {
        if (!Array.isArray(batch.rows)) continue;
        for (const row of batch.rows) {
          // Stamp the captured row with the adapter user_hash + the active task_id
          // (idempotent on (user_hash, tool_call_id)); sub-agent rows also get the
          // SUBAGENT_PROCESS marker so canonical selection can exclude them.
          const ok = insertTokenRowDeduped(db, {
            ...row,
            ...(batch.process ? { process: batch.process } : {}),
            user_hash: adapter.userHash,
            task_id: taskId,
          });
          if (ok) inserted += 1;
        }
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
