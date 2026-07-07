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
import { buildCopilotTokenRows } from './copilot-token-rows.mjs';
import {
  openTokenDb,
  insertTokenRowDeduped,
  reconcileGapFill,
  ADAPTER_USER_HASH_CLAUDE,
  ADAPTER_USER_HASH_COPILOT,
} from './token-db.mjs';
import { reconcileRow } from './reconcile.mjs';
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
 * The reconcile FALLBACK provenance marker (Phase 83-04, D-02). A transcript row
 * with NO wire match on the MEASURED path is inserted with this distinct `process`
 * tag (`token-adapter-<agent>-fallback`) — mirroring the SUBAGENT_PROCESS
 * convention (~:64) — so canonical selection AND the reconciliation sink can tell
 * a proxy-down fallback apart from a normal wire-matched row. A matching bug then
 * surfaces as a HIGH fallback count, never a silent double-count.
 *
 * @param {string} agent 'claude' | 'copilot'
 * @returns {string}
 */
export function fallbackProcessFor(agent) {
  return `token-adapter-${agent}-fallback`;
}

/** A `:reason:N`-suffixed tool_call_id — a per-reasoning-step row the wire never
 * carries, so it BYPASSES the window + match and ALWAYS inserts (D-02). */
function isReasonStep(toolCallId) {
  return typeof toolCallId === 'string' && /:reason:\d+$/.test(toolCallId);
}

/**
 * Per-agent stop-time adapter registry (Pattern 1 — keyed map).
 *
 * - 'transcript' (claude, copilot): the agent's foreground LLM calls BYPASS the
 *   rapid-llm-proxy, so their tokens are NOT in token_usage — the only way to record
 *   them is to rebuild rows from the agent's own on-disk session file and stamp them
 *   with the adapter user_hash (`cladpt`/`copadt`) + task_id.
 *     • claude   → `~/.claude/projects/<cwd>/<uuid>.jsonl` transcript (via locateMainSessionJsonl);
 *                  ALSO captures Task sub-agent transcripts (`subagents:true`).
 *     • copilot  → `~/.copilot/session-state/<sid>/events.jsonl` (via locateCopilotSessionForSpan).
 *                  The Copilot CLI (GitHub-Enterprise OAuth to bmw.ghe) has NO base-URL override,
 *                  so it cannot be pointed at the proxy — the bypass-guard the original
 *                  stamp-only note anticipated ("added ONLY if copilot talks to Anthropic
 *                  directly") is PERMANENTLY true for this CLI, so the copadt adapter is wired.
 * - 'stamp-only' (opencode / mastra): these DO route through the proxy (ANTHROPIC_BASE_URL /
 *   self-routed), so their foreground rows are ALREADY in token_usage — the only gap is the
 *   task_id, NOT capture. They carry NO `build` property; adding one would DOUBLE-COUNT the
 *   proxy rows (D-04 anti-pattern). This is the no-double-count invariant: a `build` binding
 *   exists ONLY for agents whose foreground genuinely bypasses the proxy (claude, copilot).
 */
export const STOP_ADAPTERS = {
  claude: {
    mode: 'transcript',
    userHash: ADAPTER_USER_HASH_CLAUDE,
    build: buildClaudeTokenRows,
    locate: locateMainSessionJsonl,
    subagents: true,
  },
  // The Copilot CLI cannot be proxy-routed (no base-URL override — GitHub-Enterprise OAuth),
  // so its foreground tokens are reconstructed from copilot's own session-state events.jsonl.
  copilot: {
    mode: 'transcript',
    userHash: ADAPTER_USER_HASH_COPILOT,
    build: buildCopilotTokenRows,
    locate: locateCopilotSessionForSpan,
    subagents: false,
  },
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
    // The agent's cwd — NOT this stop-process's cwd. For a sandboxed experiment cell the agent
    // ran in a throwaway worktree (span.meta.cwd, set by measurement-start --cwd); its transcript
    // lives under ~/.claude/projects/<worktree>/. Falling back to process.cwd() (the main repo)
    // MISSES the sandbox session — the ~530× claude undercount. Interactive /gsd has no meta.cwd
    // and the agent shares this process's cwd, so the fallback stays correct there.
    const agentCwd = span?.meta?.cwd || process.cwd();
    const projectsDir = path.join(
      os.homedir(),
      '.claude',
      'projects',
      encodeCwd(agentCwd),
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
 * Locate the Copilot session `events.jsonl` for a span by mtime window. The Copilot CLI
 * writes per-session state to `~/.copilot/session-state/<sessionId>/events.jsonl` and appends
 * the `session.shutdown` event (carrying `data.modelMetrics`) when the run ends — so the file's
 * mtime lands inside (or just after) the span window. Mirrors locateMainSessionJsonl: coarse
 * mtime filter + a grace window past ended_at, most-recent wins, best-effort (never throws).
 *
 * The ownership/read safety is enforced downstream by buildCopilotTokenRows' uid-gate — this
 * locator deliberately does NOT re-stat with a weaker check.
 *
 * @param {{started_at?:string, ended_at?:string}} span
 * @returns {string} absolute events.jsonl path, or '' if not found
 */
function locateCopilotSessionForSpan(span) {
  try {
    const stateDir = path.join(os.homedir(), '.copilot', 'session-state');
    if (!fs.existsSync(stateDir)) return '';
    const startMs = tsMs(span.started_at, 0);
    const endMs = tsMs(span.ended_at, Date.now());
    const GRACE_MS = 5 * 60 * 1000; // mirror locateMainSessionJsonl: cover the shutdown-event append.
    const upperMs = endMs + GRACE_MS;
    const entries = fs
      .readdirSync(stateDir)
      .map((sid) => {
        const full = path.join(stateDir, sid, 'events.jsonl');
        let mtime = NaN;
        try {
          mtime = fs.statSync(full).mtimeMs;
        } catch {
          mtime = NaN;
        }
        return { full, mtime };
      })
      .filter((e) => Number.isFinite(e.mtime) && e.mtime >= startMs && e.mtime <= upperMs)
      .sort((a, b) => b.mtime - a.mtime);
    return entries.length ? entries[0].full : '';
  } catch (err) {
    process.stderr.write(
      `[stop-adapter] copilot-session locate failed (non-fatal): ${err.message}\n`,
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
// Keep only rows whose turn timestamp falls inside the span's window (same grace as
// the locators: 1min before started_at, 5min after ended_at). A Claude session runs
// FAR longer than any one measured span, and buildClaudeTokenRows returns the WHOLE
// transcript — so without this filter a 10-min measured window would over-attribute
// the entire session's foreground tokens to the run. When the span carries no window
// (e.g. unit tests) or a row has no timestamp, keep it (best-effort, backward compat).
function withinSpanWindow(row, span) {
  const startMs = span && span.started_at ? Date.parse(span.started_at) : NaN;
  const endMs = span && span.ended_at ? Date.parse(span.ended_at) : NaN;
  if (!Number.isFinite(startMs) && !Number.isFinite(endMs)) return true;
  const t = row && row.timestamp ? Date.parse(row.timestamp) : NaN;
  if (!Number.isFinite(t)) return true;
  const lo = Number.isFinite(startMs) ? startMs - 60_000 : -Infinity;
  const hi = Number.isFinite(endMs) ? endMs + 5 * 60_000 : Infinity;
  return t >= lo && t <= hi;
}

export async function captureForegroundTokens(span = {}, opts = {}) {
  try {
    const agent = opts.agent ?? span.agent;
    const adapter = agent ? STOP_ADAPTERS[agent] : undefined;

    // (1) Double-count guard: stamp-only / unknown agents do ZERO transcript
    // work — their tokens are already proxy-captured in token_usage.
    if (!adapter || adapter.mode !== 'transcript' || typeof adapter.build !== 'function') {
      return 0;
    }

    // (2) Resolve the task_id to stamp. The span being CLOSED is authoritative —
    // use its task_id. resolveLiveTaskIdSafe() (which reads the *active* span) is
    // only a fallback: by the time the stop pipeline runs this, the active span has
    // usually already been archived/removed, so it returns '' and the foreground
    // rows would be stamped with an EMPTY task_id (never joined to the run). That
    // exact bug left link-obs-control with 0 foreground turns despite 92k captured
    // tokens. opts.resolveTaskId still wins for tests.
    const taskId = opts.resolveTaskId
      ? await opts.resolveTaskId()
      : (span.task_id || await resolveLiveTaskIdSafe());

    // (3) Locate the agent's session file by time-window (injectable for tests). Each
    // transcript adapter supplies its own locator: claude → ~/.claude transcript,
    // copilot → ~/.copilot/session-state events.jsonl.
    const locate = adapter.locate ?? locateMainSessionJsonl;
    const jsonlPath =
      opts.mainSessionPath ?? opts.locateOverride ?? locate(span);
    if (!jsonlPath) {
      process.stderr.write(
        `[stop-adapter] no ${agent} session file located in span window (non-fatal)\n`,
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
    // Sub-agent transcripts are a claude-only concept (Task tool); copilot has none.
    const subagentPaths = adapter.subagents
      ? (opts.subagentPaths ?? locateSubagentJsonls(jsonlPath, span))
      : [];
    const batches = [{ rows: mainRows, process: undefined }];
    for (const sp of subagentPaths) {
      batches.push({ rows: adapter.build(sp), process: SUBAGENT_PROCESS });
    }

    const dbPath = opts.dbPath ?? DEFAULT_TOKEN_DB;
    const db = openTokenDb(dbPath);

    // RECONCILE PATH (Phase 83-04, D-01): on a MEASURED span the caller passes
    // `opts.reconcile === true`, which replaces the blind insertTokenRowDeduped
    // loop with match-then-enrich-or-fallback via the Plan-03 matcher and returns
    // a structured reconciliation report for the sink (Plan 05). The interactive
    // Stop/sweep path (no `reconcile`) is UNCHANGED — it keeps the dedup-merge
    // insert loop below and returns an insert count. (The `mode: 'transcript'`
    // dispatch + the stamp-only zero-work guard above stay intact either way.)
    if (opts.reconcile) {
      try {
        return reconcileBatches({ db, batches, span, agent, adapter, taskId, opts });
      } finally {
        db.close();
      }
    }

    let inserted = 0;
    try {
      for (const batch of batches) {
        if (!Array.isArray(batch.rows)) continue;
        for (const row of batch.rows) {
          // Window-scope: only rows within the measured span (see withinSpanWindow) —
          // never the whole ambient session.
          if (!withinSpanWindow(row, span)) continue;
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

/**
 * The reconcile-mode inner loop (Phase 83-04, D-01/D-02/D-04). Runs
 * match-then-enrich-or-fallback over the SAME batches the interactive loop would
 * insert, and returns the reconciliation report the sink (Plan 05) consumes.
 *
 * Per transcript row:
 *   - A `:reason:N` row BYPASSES the window + match and ALWAYS inserts with
 *     NORMAL provenance (wire never carries a reasoning-step split — D-02); it is
 *     an expected always-insert, NOT a proxy-down fallback.
 *   - Otherwise the row is window-scoped, then `reconcileRow` decides:
 *       • matched → the Plan-03 gap-fill enriched the wire row IN PLACE (zero net
 *         rows — the no-double-count invariant, T-83-04-01); the matched wire row's
 *         PK is recorded (matchedWireRowIds) for the post-loop unmatched_wire diff.
 *       • no match → a FALLBACK insert tagged with a distinct provenance marker
 *         (fallbackProcessFor) and counted (D-02).
 * `reconcileRow` never throws (D-06); a per-row catch degrades to a counted
 * fallback so a reconciliation failure never blocks the measurement-stop close.
 *
 * `unmatched_wire` (CR-02) is the PRE-LOOP wire-row PK snapshot MINUS the matched
 * wire-row PKs — keyed on row identity, NOT a `user_hash` exclusion (which for
 * claude excluded the exact cladpt rows it should count → structurally 0) and NOT
 * a silent default. Plan-07's golden comparison asserts `unmatched_wire === 0`,
 * which a vacuous exclusion would have made trivially pass.
 *
 * @param {{db:object, batches:Array, span:object, agent:string, adapter:object,
 *   taskId:string, opts:object}} ctx
 * @returns {{matched:number, unmatched_wire:number, unmatched_transcript:number,
 *   fallback:number, perRequest:Array, flaggedCount:number}}
 */
function reconcileBatches({ db, batches, span, agent, adapter, taskId, opts }) {
  const report = {
    matched: 0,
    unmatched_wire: 0,
    unmatched_transcript: 0,
    fallback: 0,
    perRequest: [],
    flaggedCount: 0,
  };
  // CR-02 (83-08): matchedRequestIds tracks the matched WIRE tool_call_ids for the
  // copilot cache-merge; matchedWireRowIds tracks the matched WIRE-row PKs for the
  // unmatched_wire diff. wireRowIds is the PRE-LOOP snapshot of candidate wire-row
  // PKs — taken BEFORE any transcript-adapter row is inserted, so every captured
  // row is a proxy-tap wire row (indistinguishable from the cladpt transcript rows
  // by user_hash/process for claude — only the PK separates them).
  //
  // CR-01 (83-09): wireRowIds/matchedWireRowIds now ALSO scope the fuzzy matcher —
  // not just the post-loop unmatched_wire diff. Threaded into each reconcileRow
  // call as candidateWireIds (the pre-loop snapshot) + consumedWireIds (the live
  // matched-PK Set, passed BY REFERENCE so each iteration sees rows matched by
  // earlier turns), so fuzzy can only land on a snapshot row not already consumed —
  // never a loop-inserted fallback / :reason: row, never a double-consume.
  const matchedRequestIds = new Set();
  const matchedWireRowIds = new Set();
  const wireRowIds = snapshotWireRowIds(db, span, taskId, adapter.userHash);
  const fallbackProcess = fallbackProcessFor(agent);
  // Built ONCE before the loop: the capture opts augmented with the CR-01 scoping
  // Sets. consumedWireIds is matchedWireRowIds by reference — populated AFTER each
  // match below, so the row matched in the CURRENT iteration is not self-excluded.
  const reconcileOpts = { ...(opts || {}), candidateWireIds: wireRowIds, consumedWireIds: matchedWireRowIds };

  for (const batch of batches) {
    if (!Array.isArray(batch.rows)) continue;
    for (const row of batch.rows) {
      const transcriptRow = {
        ...row,
        ...(batch.process ? { process: batch.process } : {}),
        user_hash: adapter.userHash,
        task_id: taskId,
      };
      const tcid = transcriptRow.tool_call_id;
      const reasonStep = isReasonStep(tcid);
      // D-02: a :reason:N row bypasses the window/match; every other row is
      // window-scoped to the measured span (same clamp as the interactive loop).
      if (!reasonStep && !withinSpanWindow(transcriptRow, span)) continue;

      let result;
      try {
        result = reconcileRow(db, transcriptRow, span, reconcileOpts);
      } catch (err) {
        // Never-throw (D-06 / T-83-04-03): degrade to a counted fallback.
        process.stderr.write(
          `[stop-adapter] reconcileRow failed (non-fatal): ${err.message}\n`,
        );
        result = { method: null, matched: false, enriched: false, fallback: true, deltas: {}, flagged: false };
      }

      if (result.matched) {
        report.matched += 1;
        // CR-02: record the matched WIRE row's PK (drives the unmatched_wire diff)
        // and its tool_call_id (drives the copilot cache-merge). reconcileRow now
        // returns BOTH directly — no fuzzy re-probe needed (works for request-id
        // AND fuzzy matches, whose wire tool_call_id differs from the transcript's).
        if (result.wireRowId != null) matchedWireRowIds.add(result.wireRowId);
        if (result.wireToolCallId) matchedRequestIds.add(result.wireToolCallId);
      } else if (result.alwaysInsert) {
        // :reason:N — always-insert with NORMAL provenance (not a fallback tag).
        insertTokenRowDeduped(db, transcriptRow);
      } else {
        // Genuine no-match → fallback insert with a DISTINCT provenance marker.
        report.unmatched_transcript += 1;
        report.fallback += 1;
        insertTokenRowDeduped(db, { ...transcriptRow, process: fallbackProcess });
      }

      report.perRequest.push({
        tool_call_id: tcid ?? '',
        method: result.method ?? null,
        deltas: result.deltas ?? {},
        flagged: !!result.flagged,
      });
      if (result.flagged) report.flaggedCount += 1;
    }
  }

  // D-04: merge the copilot session-state cache split into matched wire rows that
  // are still cache-less (gap-fill only — never overwrites an authoritative wire
  // cache). Best-effort / never-throw.
  if (agent === 'copilot') {
    mergeCopilotSessionStateCache(db, matchedRequestIds, opts);
  }

  // unmatched_wire (CR-02): the pre-loop wire-row PKs that were NEVER matched
  // during the loop. Keys on ROW IDENTITY — NOT a user_hash exclusion (the old
  // query excluded the exact cladpt rows it should count) and NOT a `process`
  // filter (wire and transcript share `process` for claude). A cladpt FALLBACK or
  // :reason: row inserted DURING the loop post-dates the snapshot, so it is never
  // miscounted as an orphan wire row.
  let unmatchedWire = 0;
  for (const id of wireRowIds) {
    if (!matchedWireRowIds.has(id)) unmatchedWire += 1;
  }
  report.unmatched_wire = unmatchedWire;

  return report;
}

/**
 * Pre-loop snapshot of the candidate WIRE-row PKs for a measured span (Phase
 * 83-08, CR-02). Taken BEFORE any transcript-adapter row is inserted, so every row
 * carrying the adapter `user_hash` is a proxy-tap WIRE row: for claude the tap
 * stamps the SAME `cladpt` hash the adapter uses (server.mjs:2217), so wire and
 * transcript rows are indistinguishable by `user_hash` OR `process` — ONLY the PK
 * (row identity) separates them. The OLD `countUnmatchedWireRows` keyed on a
 * user_hash-inequality exclusion (excluding the adapter's own hash), which for
 * claude excluded the exact rows it should have counted → unmatched_wire was
 * structurally 0 (the CR-02 defect). Scopes to the span's `task_id` OR '' (interactive-launch wire rows carry
 * task_id='' per D-08) and the span window (same withinSpanWindow bounds as the
 * transcript loop). Parameterized binds only; best-effort/never-throw — a query
 * failure yields an EMPTY set (unmatched_wire 0), never blocking the close.
 *
 * @param {object} db handle from openTokenDb
 * @param {object} span the measured span (window clamp)
 * @param {string} taskId the span's task_id (the wire-row scope)
 * @param {string} adapterUserHash the adapter's user_hash (the tap stamps it too)
 * @returns {Set<number>} the candidate wire-row PKs
 */
function snapshotWireRowIds(db, span, taskId, adapterUserHash) {
  const ids = new Set();
  try {
    const rows = db
      .prepare(
        "SELECT id, tool_call_id, timestamp, task_id FROM token_usage WHERE user_hash = ? AND (task_id = ? OR task_id = '')",
      )
      .all(adapterUserHash, taskId ?? '');
    for (const r of rows) {
      if (!withinSpanWindow(r, span)) continue;
      ids.add(r.id);
    }
  } catch (err) {
    process.stderr.write(
      `[stop-adapter] wire-row snapshot failed (non-fatal): ${err.message}\n`,
    );
  }
  return ids;
}

/**
 * Merge the Copilot session-state cache split into matched wire rows still
 * lacking cache (Phase 83-04, D-04). The Plan-03 `reconcileGapFill` primitive
 * fills cache ONLY when the wire row is entirely cache-less, so this NEVER
 * overwrites an authoritative wire cache.
 *
 * Session-state read mechanics are Claude's Discretion (per PLAN). In the normal
 * path the copilot TRANSCRIPT rows already carry the session-state cache split
 * (buildCopilotTokenRows reads `modelMetrics.<model>.usage.cache*`), so a matched
 * wire row is enriched by reconcileRow's gap-fill DURING the loop. This hook only
 * applies an EXPLICIT per-wire-row override map when provided
 * (`opts.copilotCacheSplit = { [wireToolCallId]: {cache_read_tokens,
 * cache_write_tokens} }`) — a precise, deterministic seam that avoids blindly
 * re-applying the per-session aggregate across multiple wire rows (which would
 * over-count). Best-effort / never-throw.
 *
 * @param {object} db handle from openTokenDb
 * @param {Set<string>} matchedRequestIds wire ids matched during the loop
 * @param {object} opts capture opts (may carry `copilotCacheSplit`)
 * @returns {void}
 */
function mergeCopilotSessionStateCache(db, matchedRequestIds, opts) {
  try {
    const split = opts && opts.copilotCacheSplit;
    if (!split || typeof split !== 'object') return;
    for (const [wireToolCallId, cache] of Object.entries(split)) {
      if (!matchedRequestIds.has(wireToolCallId)) continue;
      reconcileGapFill(db, wireToolCallId, {
        cache_read_tokens: cache && cache.cache_read_tokens,
        cache_write_tokens: cache && cache.cache_write_tokens,
      });
    }
  } catch (err) {
    process.stderr.write(
      `[stop-adapter] copilot cache merge failed (non-fatal): ${err.message}\n`,
    );
  }
}
