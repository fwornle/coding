// lib/experiments/timeline-read.mjs
//
// DASH-02 read half (Phase 74, Plan 02): `readTimeline(taskId, dbPathOverride)`
// reads the per-turn / per-reasoning-step token rows for ONE task_id read-only
// from the proxy-owned `token-usage.db` and nests the reasoning sub-bands under
// their parent turn. The Performance tab's timeline view (Plan 04) consumes this.
//
// TWO-STORE BOUNDARY: Runs/Scores/Outcomes live in the experiment LevelDB
// (query.mjs); the per-call token timeline lives in the SQLite token-usage.db
// owned and written EXCLUSIVELY by the rapid-llm-proxy. This reader touches only
// the latter, and only for reading.
//
// SOLE-WRITER GUARDRAIL (Security V5 / Phase 70, T-74-02-02): the DB is opened
// `{ readonly: true }` so coding NEVER becomes a second writer. Mirrors
// token-aggregate.mjs exactly. NEVER change to writable.
//
// SQL-INJECTION GUARDRAIL (T-74-02-01 / T-71-03-01): task_id is ALWAYS a bound `?`
// parameter — never string-interpolated into the SQL text.
//
// GRACEFUL-EMPTY (environment-availability): a missing DB file (proxy never
// started, fresh checkout, wiped .data) returns `[]` — NOT a throw — same as
// aggregateByTaskId.
//
// Output via process.stderr.write only — the no-console-log rule (CLAUDE.md).
//
// Analog: lib/experiments/token-aggregate.mjs:55-100 (readonly open, bound param,
//   graceful-missing-file, dbPathOverride, resolveDbPath). Parent/child token_call
//   convention: lib/lsl/token/claude-token-rows.mjs (`${base}:reason:${N}`).
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const REASON_SEP = ':reason:';

// Repo root derived from THIS module's location (<repo>/lib/experiments/timeline-read.mjs).
// Container-safe: resolves to /coding inside coding-services and to the host repo on the
// host, so DASH-02 works in BOTH contexts. The old hardcoded host path
// (/Users/.../coding/.data) does not exist inside the container, so vkb-server (:8080,
// in-container) silently returned [] for every run's timeline — the timeline appeared
// permanently empty in the deployed dashboard. (token-aggregate.mjs has the same latent
// host-path fallback but is only ever reached via the on-host llm-proxy :12435, so it was
// never exposed; left for a follow-up fix.)
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '..', '..');

/**
 * Resolve the `.data` dir. Precedence: explicit `LLM_PROXY_DATA_DIR` (the sanctioned
 * override, same var the backfill uses) -> `CODING_ROOT/.data` (set in the container
 * env) -> module-relative repo-root `.data`. No hardcoded host path.
 */
function resolveDataDir() {
  if (process.env.LLM_PROXY_DATA_DIR) return process.env.LLM_PROXY_DATA_DIR;
  if (process.env.CODING_ROOT) return path.join(process.env.CODING_ROOT, '.data');
  return path.join(REPO_ROOT, '.data');
}

function resolveDbPath(override) {
  return override || path.join(resolveDataDir(), 'llm-proxy', 'token-usage.db');
}

/**
 * Read the per-turn / per-reasoning-step token timeline for a single task_id,
 * read-only, with reasoning sub-bands nested under their parent turn.
 *
 * A `per-reasoning-step` row has a `tool_call_id` of the form
 * `${parentToolCallId}:reason:${N}`; it attaches to the parent whose
 * `tool_call_id` equals that base. Any other row (per-turn, per-session-aggregate,
 * or an orphan reasoning row whose parent is absent) becomes its own parent so
 * nothing is dropped. Copilot `per-session-aggregate` rows have no children.
 *
 * @param {string} taskId measurement-span / experiment-run identifier (bound param).
 * @param {string} [dbPathOverride] explicit DB path (tests point at a temp DB).
 * @returns {Promise<Array<object>>} an array of `{ ...parentRow, tier:
 *   granularity_tier, estimated: tokens_estimated === 1, children: [...] }`.
 *   A missing DB yields `[]` (graceful empty, not a throw).
 */
export async function readTimeline(taskId, dbPathOverride) {
  const dbPath = resolveDbPath(dbPathOverride);

  // Environment-availability fallback: a missing DB file is a graceful empty
  // result, NOT a throw (mirrors aggregateByTaskId).
  if (!fs.existsSync(dbPath)) {
    process.stderr.write(`[experiments] readTimeline task_id=${taskId} db missing -> []\n`);
    return [];
  }

  let db;
  let rows;
  try {
    // readonly: true is load-bearing — coding never writes the proxy-owned DB
    // (T-74-02-02). NEVER change to writable.
    db = new Database(dbPath, { readonly: true, fileMustExist: true });

    // Cache columns may be absent on a fresh proxy-created DB (see token-aggregate) — degrade
    // to literal 0 so the timeline SELECT never throws "no such column".
    const hasCache = db
      .prepare("SELECT COUNT(*) AS c FROM pragma_table_info('token_usage') WHERE name IN ('cache_read_tokens','cache_write_tokens')")
      .get().c === 2;
    const cacheSel = hasCache
      ? 'cache_read_tokens, cache_write_tokens'
      : '0 AS cache_read_tokens, 0 AS cache_write_tokens';

    // task_id ALWAYS bound as `?` — never string-interpolated (T-74-02-01).
    // `process`, `agent`, `provider` identify WHAT produced each row (e.g.
    // consolidator-insight / observation-writer vs the foreground chat) — the
    // timeline renders them so a row reads as "08:03 · consolidator-insight"
    // instead of an anonymous "Turn N · untagged" (finding-1 display gap, 2026-06-29).
    rows = db.prepare(`
      SELECT timestamp, granularity_tier, tool_call_id, parent_call_id,
             reasoning_tokens, input_tokens, output_tokens, total_tokens,
             ${cacheSel},
             tokens_estimated, model, process, agent, provider
      FROM token_usage WHERE task_id = ?
      ORDER BY timestamp ASC, tool_call_id ASC
    `).all(taskId);
  } finally {
    if (db) db.close();
  }

  // Group rows into parents + children. A row whose tool_call_id contains the
  // `:reason:` separator is a reasoning sub-band; its base (the substring before
  // the separator) names its parent turn. Everything else is a parent. We do two
  // passes so a child can attach even if its parent appears later in iteration
  // order, and an orphan reasoning row (no matching parent) is promoted to its
  // own parent so nothing is dropped.
  const shape = (row) => ({
    ...row,
    tier: row.granularity_tier,
    estimated: row.tokens_estimated === 1,
    children: [],
  });

  const parentsById = new Map(); // tool_call_id -> shaped parent
  const parentOrder = []; // preserve first-seen (timestamp-sorted) order
  const childRows = [];

  for (const row of rows) {
    const id = row.tool_call_id ?? '';
    if (id && id.includes(REASON_SEP)) {
      childRows.push(row);
      continue;
    }
    // Parent rows dedup ONLY by a NON-EMPTY tool_call_id (a real turn key). Empty/blank
    // ids are distinct untagged turns — one per LLM call. Collapsing them by the shared
    // '' key dropped all but the first (timeline showed 1 row / 8.9k tokens while the
    // aggregate summed all 186 / 1.24M — they MUST agree). Each empty-id row becomes its
    // own parent and is NOT stored in parentsById (no child attaches to an empty base).
    if (id && parentsById.has(id)) continue; // genuine duplicate of a keyed turn
    const parent = shape(row);
    if (id) parentsById.set(id, parent);
    parentOrder.push(parent);
  }

  for (const child of childRows) {
    const base = (child.tool_call_id ?? '').split(REASON_SEP)[0];
    const parent = parentsById.get(base);
    if (parent) {
      parent.children.push(shape(child));
    } else {
      // Orphan reasoning row (no matching parent turn) — promote so nothing drops.
      const promoted = shape(child);
      parentsById.set(child.tool_call_id ?? '', promoted);
      parentOrder.push(promoted);
    }
  }

  process.stderr.write(
    `[experiments] readTimeline task_id=${taskId} parents=${parentOrder.length} ` +
    `children=${childRows.length}\n`,
  );

  return parentOrder;
}
