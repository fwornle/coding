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

// The per-row SELECT shared by readTimeline (task_id-exact) and readAmbientTimeline
// (window + non-attributed). `where` is a STATIC clause string (never interpolated
// user data); all values arrive via bound `?` params. `cacheSel` degrades to literal
// 0 when the proxy DB predates the cache columns (see token-aggregate). Ordering
// matches readTimeline's original (timestamp then tool_call_id) so grouping is stable.
function selectTimelineRows(db, where, params) {
  const hasCache = db
    .prepare("SELECT COUNT(*) AS c FROM pragma_table_info('token_usage') WHERE name IN ('cache_read_tokens','cache_write_tokens')")
    .get().c === 2;
  const cacheSel = hasCache
    ? 'cache_read_tokens, cache_write_tokens'
    : '0 AS cache_read_tokens, 0 AS cache_write_tokens';
  return db.prepare(`
    SELECT timestamp, granularity_tier, tool_call_id, parent_call_id,
           reasoning_tokens, input_tokens, output_tokens, total_tokens,
           ${cacheSel},
           tokens_estimated, model, process, agent, provider, prompt_preview
    FROM token_usage
    WHERE ${where}
    ORDER BY timestamp ASC, tool_call_id ASC
  `).all(...params);
}

// Group flat token_usage rows into parent turns + nested reasoning sub-bands. A row
// whose tool_call_id contains the `:reason:` separator is a reasoning sub-band; its
// base (the substring before the separator) names its parent turn. Everything else is
// a parent. Two passes so a child attaches even if its parent appears later, and an
// orphan reasoning row (no matching parent) is promoted to its own parent so nothing
// is dropped. Empty/blank tool_call_ids are DISTINCT untagged turns (one per LLM call)
// — NEVER collapsed by the shared '' key (that dropped all but the first; the timeline
// showed 1 row while the aggregate summed all N — they MUST agree).
function groupRows(rows) {
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
      const promoted = shape(child);
      parentsById.set(child.tool_call_id ?? '', promoted);
      parentOrder.push(promoted);
    }
  }

  return parentOrder;
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
    // task_id ALWAYS bound as `?` — never string-interpolated (T-74-02-01).
    // `process`, `agent`, `provider` identify WHAT produced each row (e.g.
    // consolidator-insight / observation-writer vs the foreground chat) so a row
    // reads "08:03 · consolidator-insight" not "Turn N · untagged" (finding-1).
    rows = selectTimelineRows(db, 'task_id = ?', [taskId]);
  } finally {
    if (db) db.close();
  }

  const parentOrder = groupRows(rows);
  process.stderr.write(
    `[experiments] readTimeline task_id=${taskId} parents=${parentOrder.length}\n`,
  );
  return parentOrder;
}

// Background processes whose LLM calls run as decoupled daemons (knowledge-capture
// + infrastructure), NOT as part of any single run's foreground work. Mirrors the
// role glossary in integrations/system-health-dashboard/src/components/performance/
// roles.ts (observation-writer / consolidator* / wave-analysis|kg-|persistence- ->
// knowledge; health-coordinator / llm-proxy|proxy- -> infrastructure). Kept in sync
// with that file by hand — the two live in different runtimes (Node reader vs React).
const AMBIENT_PROCESS_RE =
  /^(observation-writer|consolidator|wave-analysis|kg-|persistence-|health-coordinator|llm-proxy|proxy-)/;

/**
 * OPTION 2 — "ambient background activity" reader (concurrent, NOT attributed).
 *
 * Read-only rollup of background knowledge/infra token rows that ran DURING a run's
 * wall-clock window `[startIso, endIso]` but are NOT attributed to it (their task_id
 * differs from this run's — usually empty, because background daemons don't stamp a
 * run's task_id). This is deliberately SEPARATE from readTimeline's task_id-exact
 * join: the authors reject a silent time-window join into a run's own role stats
 * (timeline.tsx "NEVER a time-window join against foreign sessions"). This function
 * surfaces the same window in a clearly-labelled, non-attributed panel instead.
 *
 * Same guardrails as readTimeline: readonly open, bound `?` params (start/end/taskId
 * are all bound — never interpolated), graceful-empty on a missing DB.
 *
 * @param {string} taskId the run whose rows to EXCLUDE (so Option-1 attributed rows
 *   never double-count here). Bound param.
 * @param {string} startIso ISO timestamp — window lower bound (inclusive). Bound.
 * @param {string} endIso ISO timestamp — window upper bound (inclusive). Bound.
 * @param {string} [dbPathOverride] explicit DB path (tests point at a temp DB).
 * @returns {Promise<Array<object>>} per-process rollup rows
 *   `{ process, agent, model, calls, total_tokens, cache_read_tokens,
 *      cache_write_tokens, first_ts, last_ts }`, or `[]` (graceful).
 */
export async function readAmbientBackground(taskId, startIso, endIso, dbPathOverride) {
  const dbPath = resolveDbPath(dbPathOverride);

  if (!startIso || !endIso) return []; // no window -> nothing to attribute
  if (!fs.existsSync(dbPath)) {
    process.stderr.write(`[experiments] readAmbientBackground task_id=${taskId} db missing -> []\n`);
    return [];
  }

  let db;
  let rows;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });

    const hasCache = db
      .prepare("SELECT COUNT(*) AS c FROM pragma_table_info('token_usage') WHERE name IN ('cache_read_tokens','cache_write_tokens')")
      .get().c === 2;
    const cacheSel = hasCache
      ? 'SUM(cache_read_tokens) AS cache_read_tokens, SUM(cache_write_tokens) AS cache_write_tokens'
      : '0 AS cache_read_tokens, 0 AS cache_write_tokens';

    // All of start/end/taskId are bound `?` — never interpolated (SQL-injection guard).
    // `task_id != ?` (with the empty-string fallback via COALESCE) excludes rows already
    // attributed to THIS run so Option-1 stamping never double-counts here.
    rows = db.prepare(`
      SELECT process,
             MAX(agent) AS agent,
             MAX(model) AS model,
             COUNT(*) AS calls,
             SUM(total_tokens) AS total_tokens,
             ${cacheSel},
             MIN(timestamp) AS first_ts,
             MAX(timestamp) AS last_ts
      FROM token_usage
      WHERE timestamp BETWEEN ? AND ?
        AND COALESCE(task_id, '') != ?
        AND process IS NOT NULL
      GROUP BY process
      ORDER BY total_tokens DESC
    `).all(startIso, endIso, taskId).filter((r) => AMBIENT_PROCESS_RE.test(r.process ?? ''));
  } finally {
    if (db) db.close();
  }

  process.stderr.write(
    `[experiments] readAmbientBackground task_id=${taskId} window=${startIso}..${endIso} ` +
    `processes=${rows.length}\n`,
  );

  return rows;
}

/**
 * Per-CALL variant of readAmbientBackground: the same concurrent, NON-attributed
 * background knowledge/infra activity in `[startIso, endIso]`, but returned as
 * INDIVIDUAL turn rows (same shape as readTimeline) instead of a `GROUP BY process`
 * rollup — so the dashboard can interleave them chronologically with foreground turns.
 *
 * Same guardrails as readTimeline/readAmbientBackground: readonly open, bound `?`
 * params (start/end/taskId), graceful-empty on a missing DB/window, and the shared
 * `selectTimelineRows` + `groupRows` so the row shape + reasoning-child nesting stay
 * identical to the foreground timeline. Rows are filtered to background processes via
 * AMBIENT_PROCESS_RE (same classifier as the rollup) BEFORE grouping, so a reasoning
 * child stays with its parent (they share `process`).
 *
 * @param {string} taskId run whose rows to EXCLUDE (COALESCE(task_id,'') != ?). Bound.
 * @param {string} startIso window lower bound (inclusive). Bound.
 * @param {string} endIso window upper bound (inclusive). Bound.
 * @param {string} [dbPathOverride] explicit DB path (tests point at a temp DB).
 * @returns {Promise<Array<object>>} individual `{ ...row, tier, estimated, children }`
 *   background rows, or `[]` (graceful).
 */
export async function readAmbientTimeline(taskId, startIso, endIso, dbPathOverride) {
  const dbPath = resolveDbPath(dbPathOverride);

  if (!startIso || !endIso) return []; // no window -> nothing to surface
  if (!fs.existsSync(dbPath)) {
    process.stderr.write(`[experiments] readAmbientTimeline task_id=${taskId} db missing -> []\n`);
    return [];
  }

  let db;
  let rows;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    // Individual rows (NOT GROUP BY), non-attributed window. All values bound `?`.
    rows = selectTimelineRows(
      db,
      "timestamp BETWEEN ? AND ? AND COALESCE(task_id, '') != ? AND process IS NOT NULL",
      [startIso, endIso, taskId],
    ).filter((r) => AMBIENT_PROCESS_RE.test(r.process ?? ''));
  } finally {
    if (db) db.close();
  }

  const parentOrder = groupRows(rows);
  process.stderr.write(
    `[experiments] readAmbientTimeline task_id=${taskId} window=${startIso}..${endIso} ` +
    `rows=${parentOrder.length}\n`,
  );
  return parentOrder;
}
