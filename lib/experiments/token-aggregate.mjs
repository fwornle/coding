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
const FOREGROUND_USER_HASHES = new Set(['cladpt', 'copadt']); // claude / copilot adapters

/**
 * @param {{ user_hash?:string, process?:string }} group a byAgentModel row
 * @returns {boolean} true iff this group is the measured foreground session
 */
export function isForegroundGroup(group) {
  return FOREGROUND_USER_HASHES.has(group?.user_hash)
    && !BACKGROUND_PROCESS_RE.test(group?.process || '');
}

/** The all-zero totals shape (COALESCE result for a task_id with no rows). */
function zeroTotals() {
  return {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    reasoning_tokens: 0,
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

    const totals = db.prepare(`
      SELECT
        COALESCE(SUM(input_tokens),0)     AS input_tokens,
        COALESCE(SUM(output_tokens),0)    AS output_tokens,
        COALESCE(SUM(total_tokens),0)     AS total_tokens,
        COALESCE(SUM(reasoning_tokens),0) AS reasoning_tokens,
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
