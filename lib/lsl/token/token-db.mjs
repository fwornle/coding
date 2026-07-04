/**
 * lib/lsl/token/token-db.mjs
 *
 * Phase 69, Plan 69-02, Task 1 — the ONLY host-side file that touches the
 * proxy-owned `.data/llm-proxy/token-usage.db`. A best-effort, never-throw
 * second-writer INSERT helper for the Claude / Copilot token adapters.
 *
 * Design (locked decisions):
 *   - D-06 (id-collision avoidance): adapter rows use a DISTINCT adapter
 *     `user_hash` (`cladpt` / `copadt`) so the second writer's `MAX(id)+1`
 *     never races the proxy's in-memory id counter. Both match the proxy's
 *     `/^[a-z][a-z0-9]{5}$/` charset (token-usage.ts:46-47).
 *   - D-07 (WAL coexistence): open the DB and immediately set
 *     `busy_timeout = 5000` (per-connection — the proxy sets WAL globally).
 *   - D-08 (best-effort): a locked DB / malformed row NEVER throws out of
 *     `insertTokenRow` — it catches, writes a `[token-adapter]` stderr line,
 *     and returns false. An emission failure can never crash the LSL path.
 *
 * Security:
 *   - V5 / SQL-injection (T-69-sql): every value is bound via a `?`
 *     placeholder — model name / task_id are NEVER interpolated into SQL.
 *   - T-69-nan: every numeric column is coalesced `?? 0`, every TEXT `?? ''`,
 *     and `overhead_ms ?? null` (better-sqlite3 rejects `undefined`).
 *
 * Analogs:
 *   - INSERT shape + logCall discipline: _work/rapid-llm-proxy/src/token-usage.ts
 *     (insertStmt L574-581, id seed L588-595, logCall L788-824).
 *   - Host-side open: scripts/backfill-task-id-by-timestamp.mjs:38-44.
 */

import { createRequire } from 'node:module';
import process from 'node:process';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

/**
 * Distinct adapter `user_hash` constants (D-06). Both match the proxy's
 * `/^[a-z][a-z0-9]{5}$/` validation (token-usage.ts:47) so they are valid
 * in the composite `(user_hash, id)` PK, yet isolated from the proxy's hash.
 */
export const ADAPTER_USER_HASH_CLAUDE = 'cladpt';
export const ADAPTER_USER_HASH_COPILOT = 'copadt';

/**
 * The 23-column INSERT — the base 21 (token-usage.ts:574-581) PLUS the two cache
 * columns (cache_read_tokens / cache_write_tokens) this adapter adds idempotently via
 * ensureCacheColumns. Column order is load-bearing — the positional binds in
 * `insertTokenRow` mirror it exactly. cache_* are surfaced SEPARATELY from total_tokens
 * (which stays input+output) so cheap cache-reads are not conflated with fresh input.
 */
const INSERT_SQL = `INSERT INTO token_usage (
  id, timestamp, provider, model, process, subscription,
  input_tokens, output_tokens, total_tokens, latency_ms,
  prompt_preview, tokens_estimated, user_hash, model_raw, overhead_ms,
  agent, task_id, tool_call_id, parent_call_id, granularity_tier, reasoning_tokens,
  cache_read_tokens, cache_write_tokens
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/**
 * Idempotently add the cache-token columns to an existing token_usage table. The DB is
 * created + owned by the rapid-llm-proxy (whose base schema lacks these), so the adapter
 * adds them here on open. SQLite `ADD COLUMN` is instant and backward-compatible: the
 * proxy's own INSERTs omit these columns and get the DEFAULT 0; readers `SELECT` them
 * explicitly. Wrapped per-column in try/catch → a "duplicate column" error (already added)
 * is swallowed, so this is safe to run on every open. Never throws.
 *
 * @param {import('better-sqlite3').Database} db an open read-WRITE handle
 */
export function ensureCacheColumns(db) {
  for (const col of ['cache_read_tokens', 'cache_write_tokens']) {
    try {
      db.exec(`ALTER TABLE token_usage ADD COLUMN ${col} INTEGER NOT NULL DEFAULT 0`);
    } catch {
      // Column already exists (or table missing) — idempotent no-op.
    }
  }
}

/**
 * The id-allocation seed (token-usage.ts:588-595) — per-`user_hash` MAX(id)+1.
 * Because the adapter uses a DISTINCT hash, this never races the proxy counter.
 */
const NEXT_ID_SQL =
  'SELECT COALESCE(MAX(id), 0) + 1 AS next FROM token_usage WHERE user_hash = ?';

/** Coalesce a numeric field to 0 (NOT-NULL numeric columns, V5 / T-69-nan). */
function num(v) {
  return v ?? 0;
}

/** Coalesce a TEXT field to '' (NOT-NULL TEXT columns). */
function text(v) {
  return v ?? '';
}

/**
 * Open `token-usage.db` as a SECOND writer (the proxy daemon is writer #1).
 *
 * Uses `{ fileMustExist: true }` (the adapter never creates the proxy DB), and
 * immediately sets `busy_timeout = 5000` (D-07 — per-connection setting; the
 * proxy enables WAL globally). Re-asserting `journal_mode = wal` is harmless,
 * so we do not — the proxy owns the global pragma.
 *
 * @param {string} dbPath absolute path to token-usage.db
 * @returns {import('better-sqlite3').Database} an open better-sqlite3 handle
 */
export function openTokenDb(dbPath) {
  const db = new Database(dbPath, { fileMustExist: true });
  db.pragma('busy_timeout = 5000');
  ensureCacheColumns(db); // idempotent — add cache_read/write columns if the proxy schema lacks them
  return db;
}

/**
 * Best-effort INSERT of a single adapter token row (D-08 — NEVER throws).
 *
 * Allocates the row id via `MAX(id)+1` within the row's adapter `user_hash`
 * space, then runs the verbatim 21-column INSERT with parameterized `?`
 * placeholders only. Every numeric field is coalesced `?? 0`, every TEXT
 * `?? ''`, and `overhead_ms ?? null` (better-sqlite3 rejects `undefined`).
 *
 * On ANY failure (locked DB, closed handle, malformed row) it writes a
 * `[token-adapter] insert failed (non-fatal): <msg>` line to stderr and
 * returns false — the emission failure never propagates into ingestion.
 *
 * @param {import('better-sqlite3').Database} db handle from openTokenDb
 * @param {object} row a TokenUsageRow-shaped object (user_hash is one of the
 *   two adapter constants)
 * @returns {boolean} true on success, false on any handled failure
 */
export function insertTokenRow(db, row) {
  try {
    const userHash = row.user_hash;
    const seed = db.prepare(NEXT_ID_SQL).get(userHash);
    const id = seed ? seed.next : 1;

    db.prepare(INSERT_SQL).run(
      id,
      text(row.timestamp),
      text(row.provider),
      text(row.model),
      text(row.process),
      text(row.subscription),
      num(row.input_tokens),
      num(row.output_tokens),
      num(row.total_tokens),
      num(row.latency_ms),
      text(row.prompt_preview),
      num(row.tokens_estimated),
      // user_hash MUST be the caller-supplied adapter constant (D-06) — never
      // coalesced to '' (that would violate the /^[a-z][a-z0-9]{5}$/ contract).
      userHash,
      text(row.model_raw ?? row.model),
      // better-sqlite3 rejects undefined; an explicit null is required.
      row.overhead_ms ?? null,
      text(row.agent),
      text(row.task_id),
      text(row.tool_call_id),
      text(row.parent_call_id),
      text(row.granularity_tier),
      num(row.reasoning_tokens),
      num(row.cache_read_tokens),
      num(row.cache_write_tokens),
    );
    return true;
  } catch (err) {
    process.stderr.write(
      `[token-adapter] insert failed (non-fatal): ${err.message}\n`,
    );
    return false;
  }
}

/**
 * The dedup probe (Pitfall 4 / T-69-id) — the SAME parameterized
 * `(user_hash, tool_call_id)` natural-key check the sweep path uses. A row that
 * already exists is skipped so the live hook can fire repeatedly over a growing
 * session without re-inserting earlier exchanges (CR-01: O(n²) inflation).
 */
const DEDUP_SQL =
  'SELECT 1 FROM token_usage WHERE user_hash = ? AND tool_call_id = ? LIMIT 1';

/**
 * Best-effort idempotent INSERT (D-08 — NEVER throws). Runs the parameterized
 * `(user_hash, tool_call_id)` dedup probe and inserts only when no matching row
 * exists. Shared by BOTH live hooks (Claude + Copilot) so the live path is
 * idempotent across repeated `onTokenRow` firings over the same session.
 *
 * Per-turn rows (`tool_call_id = base`) and per-reasoning-step rows
 * (`tool_call_id = base:reason:N`) carry DISTINCT tool_call_ids, so they never
 * dedup against each other.
 *
 * IN-03 degeneracy guard: a row whose `tool_call_id` is the empty string would
 * make the dedup key collapse unrelated rows into one bucket (any two empty-id
 * rows look identical). For such rows we SKIP the dedup probe and insert
 * unconditionally — better a possible duplicate than silently dropping
 * unrelated turns. A non-empty id always takes the dedup path.
 *
 * @param {import('better-sqlite3').Database} db handle from openTokenDb
 * @param {object} row a TokenUsageRow-shaped object
 * @returns {boolean} true if a row was inserted, false if skipped (dedup hit)
 *   or on any handled failure
 */
export function insertTokenRowDeduped(db, row) {
  try {
    const toolCallId = row.tool_call_id;
    // IN-03: empty/non-string tool_call_id → skip dedup, insert directly so we
    // never collapse unrelated empty-key rows into a single dedup bucket.
    if (typeof toolCallId === 'string' && toolCallId.length > 0) {
      const hit = db.prepare(DEDUP_SQL).get(row.user_hash, toolCallId);
      if (hit) return false;
    }
    return insertTokenRow(db, row);
  } catch (err) {
    process.stderr.write(
      `[token-adapter] dedup probe failed (non-fatal): ${err.message}\n`,
    );
    // Best-effort: fall back to a plain insert rather than dropping the row.
    return insertTokenRow(db, row);
  }
}
