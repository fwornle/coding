/**
 * KB-02 token-sourcing: read-only aggregation over the proxy-owned
 * `token-usage.db` (Plan 71-03).
 *
 * `aggregateByTaskId(taskId, dbPathOverride?)` is a PURE recompute: a parameterized
 * `WHERE task_id = ?` SUM over the attribution columns plus a per-(agent,model,
 * provider,granularity_tier) breakdown. Because it recomputes from scratch every
 * call, re-running it AFTER a timestamp-join backfill re-attributes orphan rows
 * yields the new, COMPLETE totals — the D-14 self-healing contract. The dominant
 * (first) `byAgentModel` row also sources a Run's `agent`/`model` tags (Q3).
 *
 * SOLE-WRITER GUARDRAIL (Security V5 / Phase 70 principle): the DB is opened
 * `{ readonly: true }` so coding NEVER becomes a second writer to a DB owned and
 * written exclusively by the rapid-llm-proxy.
 *
 * SQL-INJECTION GUARDRAIL (T-71-03-01): task_id is ALWAYS a bound `?` parameter —
 * never string-interpolated into the SQL text.
 *
 * Analog: scripts/backfill-task-id-by-timestamp.mjs (createRequire+better-sqlite3
 * import, LLM_PROXY_DATA_DIR resolution, readonly open, try/finally close).
 * Column names: _work/rapid-llm-proxy/src/token-usage.ts (attribution columns).
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import process from 'node:process';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

/** Mirror the proxy's resolveTokenDbPath order (same env var the backfill uses). */
function resolveDataDir() {
  return process.env.LLM_PROXY_DATA_DIR
    || '/Users/Q284340/Agentic/coding/.data';
}

function resolveDbPath(override) {
  return override || path.join(resolveDataDir(), 'llm-proxy', 'token-usage.db');
}

/**
 * ATTR-01 / D-02 — aggregation-time foreground/background lineage classifier.
 *
 * A measurement task_id collects BOTH the measured foreground session AND any
 * concurrent background-daemon traffic the old in-window blanket rule stamped
 * with the same task_id. Foreground == an adapter user_hash (the claude/copilot
 * stop-adapters stamp `cladpt`/`copadt`) whose `process` is NOT a known
 * background daemon. The denylist OVERRIDES the adapter hash so an
 * observation-writer row carrying `cladpt` still classifies as background
 * (T-75-23) — the daemon signal wins.
 *
 * Derived at READ time (no column added to the proxy-owned token-usage.db); it
 * survives re-aggregation after a backfill (D-14 self-healing).
 *
 * Regex + Set are taken VERBATIM from 75-RESEARCH.md §Code Examples — these
 * denylist values were confirmed against real token_usage `process` values; do
 * NOT re-derive them.
 */
const BACKGROUND_PROCESS_RE = /^(consolidator-|health-coordinator$|observation-writer$|backfill$|reproject-|route-judge$)/;
const FOREGROUND_USER_HASHES = new Set(['cladpt', 'copadt', 'opnadt']); // claude / copilot / opencode FILE adapters

// Phase 78 gap-closure — proxy-routed foreground agents (opencode, mastra) have
// NO file adapter, so their rows carry the session hash (e.g. `c197ef`), not a
// cladpt/copadt adapter hash. The old adapter-hash-only allowlist therefore
// mis-classified an opencode foreground session as "no foreground group" →
// canonical_model persisted null → the runs table rendered "unmeasured" even
// though the timeline (which buckets unknown→fg) showed the real model. These
// agents instead stamp their own name into `process` (stop-adapter-registry
// 'stamp-only'), so recognise that. Their concurrent daemons (consolidator-*,
// observation-writer, …) still stamp a daemon process name caught by
// BACKGROUND_PROCESS_RE, which OVERRIDES this — so no daemon leaks in.
const FOREGROUND_PROXY_PROCESSES = new Set(['opencode', 'mastra']);

/**
 * @param {{ user_hash?:string, process?:string }} group a byAgentModel row
 * @returns {boolean} true iff this group is the measured foreground session
 */
export function isForegroundGroup(group) {
  const proc = group?.process || '';
  // Daemon signal wins — the denylist OVERRIDES any foreground hint, so an
  // observation-writer row carrying `cladpt` still classifies as background (T-75-23).
  if (BACKGROUND_PROCESS_RE.test(proc)) return false;
  // Foreground via a claude/copilot/opencode file-adapter hash (opnadt is the
  // opencode-store reconstruction adapter, foreground by construction), OR a
  // proxy-routed agent (opencode/mastra) that stamps its own process name.
  return FOREGROUND_USER_HASHES.has(group?.user_hash)
    || FOREGROUND_PROXY_PROCESSES.has(proc);
}

/** The all-zero totals shape (COALESCE result for a task_id with no rows). */
function zeroTotals() {
  return {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    reasoning_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    calls: 0,
  };
}

/**
 * Aggregate token usage for a single task_id, read-only.
 *
 * @param {string} taskId measurement-span / experiment-run identifier (bound param)
 * @param {string} [dbPathOverride] explicit DB path (tests point at a temp DB)
 * @returns {{
 *   totals: { input_tokens:number, output_tokens:number, total_tokens:number, reasoning_tokens:number, calls:number },
 *   byAgentModel: Array<{ agent:string, model:string, provider:string, granularity_tier:string, user_hash:string, process:string, total_tokens:number, calls:number }>
 * }}
 */
export function aggregateByTaskId(taskId, dbPathOverride) {
  // WR-06: a non-string taskId (e.g. a malformed span where span.task_id is
  // missing/null/an object — measurement-stop.mjs can pass the minimal
  // { task_id: closeMarker.task_id } fallback) would be handed straight to
  // better-sqlite3's bound `?` and throw a TypeError. The aggregator is
  // otherwise best-effort (missing DB → zero result), so degrade gracefully
  // here too rather than throwing in the close path.
  if (typeof taskId !== 'string' || taskId === '') {
    return { totals: zeroTotals(), byAgentModel: [] };
  }

  const dbPath = resolveDbPath(dbPathOverride);

  // Environment-availability fallback: a missing DB file (proxy never started,
  // fresh checkout, wiped .data) is a graceful zero-result, NOT a throw. The
  // close path below must also survive a never-opened handle.
  if (!fs.existsSync(dbPath)) {
    return { totals: zeroTotals(), byAgentModel: [] };
  }

  let db;
  try {
    // readonly: true is load-bearing — coding never writes the proxy-owned DB
    // (Security V5 / Phase 70 sole-writer principle). NEVER change to writable.
    db = new Database(dbPath, { readonly: true, fileMustExist: true });

    // Cache columns are added by the adapter (ensureCacheColumns); a fresh proxy-created DB
    // may predate them, and a readonly connection cannot ADD them. Detect + degrade to 0 so
    // the SELECT never throws "no such column" on an un-migrated DB.
    const hasCache = db
      .prepare("SELECT COUNT(*) AS c FROM pragma_table_info('token_usage') WHERE name IN ('cache_read_tokens','cache_write_tokens')")
      .get().c === 2;
    const cacheSel = hasCache
      ? 'COALESCE(SUM(cache_read_tokens),0) AS cache_read_tokens, COALESCE(SUM(cache_write_tokens),0) AS cache_write_tokens'
      : '0 AS cache_read_tokens, 0 AS cache_write_tokens';

    const totals = db.prepare(`
      SELECT
        COALESCE(SUM(input_tokens),0)     AS input_tokens,
        COALESCE(SUM(output_tokens),0)    AS output_tokens,
        COALESCE(SUM(total_tokens),0)     AS total_tokens,
        COALESCE(SUM(reasoning_tokens),0) AS reasoning_tokens,
        ${cacheSel},
        COUNT(*)                          AS calls
      FROM token_usage WHERE task_id = ?
    `).get(taskId);

    // user_hash + process are additional GROUP BY identifiers (NOT user input —
    // bound-param discipline applies only to task_id, T-75-22). They feed the
    // read-time fg/bg classifier (isForegroundGroup) without any DB schema change.
    const byAgentModel = db.prepare(`
      SELECT agent, model, provider, granularity_tier, user_hash, process,
             SUM(total_tokens) AS total_tokens, COUNT(*) AS calls
      FROM token_usage WHERE task_id = ?
      GROUP BY agent, model, provider, granularity_tier, user_hash, process
      ORDER BY total_tokens DESC
    `).all(taskId);

    return { totals, byAgentModel };
  } finally {
    if (db) db.close();
  }
}

/**
 * Aggregate token usage over a TIME WINDOW rather than a task_id, read-only.
 *
 * WHY a second aggregator exists. `aggregateByTaskId` needs the caller to have bound its
 * task_id onto the wire, and not every agent has a binding seam. The copilot and opencode
 * rows that reach this DB are frequently written by their STOP-ADAPTERS (user_hash
 * `copadt`/`opcadt`) after the CLI exits, and those rows are stamped with the agent's OWN
 * session identity — an opencode `ses_01f5…`, a copilot UUID — which the harness that spawned
 * the process never learns. A task_id join returns zero for them; the tokens are in the DB,
 * just under a key nobody outside that CLI can predict.
 *
 * A window join recovers exactly those rows, at a strictly weaker guarantee: it attributes by
 * "ran while this cell ran" instead of "was tagged as this cell". That is sound only when the
 * caller knows nothing else of the same agent ran concurrently, so the return value carries
 * the DISTINCT (task_id, user_hash) sessions it summed — more than one is the caller's signal
 * that the window was shared and the number must not be presented as a clean measurement.
 *
 * Bounds are ISO-8601 strings compared as TEXT, which is correct here and not a shortcut:
 * `token_usage.timestamp` is a TEXT column holding `2026-08-08T09:41:24.068Z`, and that format
 * sorts lexically in timestamp order. Both are BOUND parameters, never interpolated.
 *
 * @param {object} params
 * @param {string} params.startedAt  ISO-8601 lower bound (inclusive)
 * @param {string} params.endedAt    ISO-8601 upper bound (inclusive)
 * @param {string} [params.agent]    restrict to one `agent` value (bound param)
 * @param {string} [params.dbPathOverride] explicit DB path (tests point at a temp DB)
 * @returns {{
 *   totals: { input_tokens:number, output_tokens:number, total_tokens:number, reasoning_tokens:number, calls:number },
 *   sessions: Array<{ task_id:string, user_hash:string, agent:string, model:string, total_tokens:number, calls:number }>
 * }}
 */
export function aggregateByWindow({ startedAt, endedAt, agent, dbPathOverride } = {}) {
  // Same graceful-degradation contract as aggregateByTaskId: a malformed window is a
  // zero-result, never a throw, because this runs in a measurement path whose job is to
  // record what happened — including that it could not measure.
  if (typeof startedAt !== 'string' || typeof endedAt !== 'string' || !startedAt || !endedAt) {
    return { totals: zeroTotals(), sessions: [] };
  }

  const dbPath = resolveDbPath(dbPathOverride);
  if (!fs.existsSync(dbPath)) return { totals: zeroTotals(), sessions: [] };

  let db;
  try {
    // readonly: true — the proxy is the sole writer (Security V5). NEVER change.
    db = new Database(dbPath, { readonly: true, fileMustExist: true });

    const hasCache = db
      .prepare("SELECT COUNT(*) AS c FROM pragma_table_info('token_usage') WHERE name IN ('cache_read_tokens','cache_write_tokens')")
      .get().c === 2;
    const cacheSel = hasCache
      ? 'COALESCE(SUM(cache_read_tokens),0) AS cache_read_tokens, COALESCE(SUM(cache_write_tokens),0) AS cache_write_tokens'
      : '0 AS cache_read_tokens, 0 AS cache_write_tokens';

    // The agent predicate is applied as `(? IS NULL OR agent = ?)` so the SQL text is
    // constant and the optional filter stays a bound parameter.
    const agentParam = agent == null || agent === '' ? null : String(agent);

    const totals = db.prepare(`
      SELECT
        COALESCE(SUM(input_tokens),0)     AS input_tokens,
        COALESCE(SUM(output_tokens),0)    AS output_tokens,
        COALESCE(SUM(total_tokens),0)     AS total_tokens,
        COALESCE(SUM(reasoning_tokens),0) AS reasoning_tokens,
        ${cacheSel},
        COUNT(*)                          AS calls
      FROM token_usage
      WHERE timestamp BETWEEN ? AND ?
        AND (? IS NULL OR agent = ?)
    `).get(startedAt, endedAt, agentParam, agentParam);

    const sessions = db.prepare(`
      SELECT task_id, user_hash, agent, model,
             SUM(total_tokens) AS total_tokens, COUNT(*) AS calls
      FROM token_usage
      WHERE timestamp BETWEEN ? AND ?
        AND (? IS NULL OR agent = ?)
      GROUP BY task_id, user_hash, agent, model
      ORDER BY total_tokens DESC
    `).all(startedAt, endedAt, agentParam, agentParam);

    return { totals, sessions };
  } finally {
    if (db) db.close();
  }
}

/**
 * Every session that touched a window, reported with its FULL lifespan and FULL totals —
 * not just the part that fell inside the window.
 *
 * WHY THIS EXISTS. `aggregateByWindow` sums the rows whose timestamps land between two
 * instants. For a sequence of back-to-back cells that is wrong in both directions at once,
 * because a session does not stop when the process that started it does: its last calls are
 * still being written while the next cell is already running.
 *
 * Measured on kgbench run `coding-v1-x2`, cell `grep/L1 rep1`:
 *
 *   ses_…iG1tHz  06:58:37 → 06:59:14   72,887 tokens   started 33s BEFORE this cell spawned
 *   ses_…SBBuDZ  06:59:15 → 06:59:22   71,723 tokens   started inside the window — the cell's
 *
 * The window sum charged this cell 25,620 tokens of its predecessor's traffic, and would
 * equally have lost any of its own rows written after the window closed. 94 of 96 opencode
 * cells in that run were affected.
 *
 * Returning whole sessions lets the caller attribute by SESSION rather than by instant: a
 * session that began inside the window belongs to the cell, and everything it spent belongs
 * with it, wherever the rows happen to land in time.
 *
 * @param {object} params
 * @param {string} params.startedAt  ISO-8601 lower bound (inclusive)
 * @param {string} params.endedAt    ISO-8601 upper bound (inclusive)
 * @param {string} [params.agent]    restrict to one `agent` value (bound param)
 * @param {string} [params.dbPathOverride] explicit DB path (tests point at a temp DB)
 * @returns {{ sessions: Array<{
 *   task_id:string, user_hash:string, agent:string,
 *   first_seen:string, last_seen:string,
 *   input_tokens:number, output_tokens:number, total_tokens:number,
 *   reasoning_tokens:number, cache_read_tokens:number, cache_write_tokens:number, calls:number
 * }> }}
 */
export function aggregateSessionsTouchingWindow({ startedAt, endedAt, agent, dbPathOverride } = {}) {
  if (typeof startedAt !== 'string' || typeof endedAt !== 'string' || !startedAt || !endedAt) {
    return { sessions: [] };
  }

  const dbPath = resolveDbPath(dbPathOverride);
  if (!fs.existsSync(dbPath)) return { sessions: [] };

  let db;
  try {
    // readonly: true — the proxy is the sole writer (Security V5). NEVER change.
    db = new Database(dbPath, { readonly: true, fileMustExist: true });

    const hasCache = db
      .prepare("SELECT COUNT(*) AS c FROM pragma_table_info('token_usage') WHERE name IN ('cache_read_tokens','cache_write_tokens')")
      .get().c === 2;
    const cacheSel = hasCache
      ? 'COALESCE(SUM(t.cache_read_tokens),0) AS cache_read_tokens, COALESCE(SUM(t.cache_write_tokens),0) AS cache_write_tokens'
      : '0 AS cache_read_tokens, 0 AS cache_write_tokens';

    const agentParam = agent == null || agent === '' ? null : String(agent);

    // `IS` rather than `=` on the join keys: user_hash is nullable, and `NULL = NULL` is
    // NULL in SQL, which would silently drop every session that has no user hash.
    return {
      sessions: db.prepare(`
        WITH touched AS (
          SELECT DISTINCT task_id, user_hash
          FROM token_usage
          WHERE timestamp BETWEEN ? AND ?
            AND (? IS NULL OR agent = ?)
        )
        SELECT t.task_id, t.user_hash, t.agent,
               MIN(t.timestamp) AS first_seen,
               MAX(t.timestamp) AS last_seen,
               COALESCE(SUM(t.input_tokens),0)     AS input_tokens,
               COALESCE(SUM(t.output_tokens),0)    AS output_tokens,
               COALESCE(SUM(t.total_tokens),0)     AS total_tokens,
               COALESCE(SUM(t.reasoning_tokens),0) AS reasoning_tokens,
               ${cacheSel},
               COUNT(*) AS calls
        FROM token_usage t
        JOIN touched w ON t.task_id IS w.task_id AND t.user_hash IS w.user_hash
        WHERE (? IS NULL OR t.agent = ?)
        GROUP BY t.task_id, t.user_hash, t.agent
        ORDER BY first_seen
      `).all(startedAt, endedAt, agentParam, agentParam, agentParam, agentParam),
    };
  } finally {
    if (db) db.close();
  }
}
