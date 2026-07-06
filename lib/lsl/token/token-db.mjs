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
 * already exists is a dedup HIT so the live hook can fire repeatedly over a
 * growing session without re-inserting earlier exchanges (CR-01: O(n²)
 * inflation). It now SELECTs the cache/reasoning columns (not `SELECT 1`) so the
 * caller can decide between a merge-on-cache enrich and a genuine-duplicate drop
 * (Phase 82-04) — the probe row's truthiness is still the hit signal.
 */
const DEDUP_SQL =
  'SELECT cache_read_tokens, cache_write_tokens, reasoning_tokens FROM token_usage WHERE user_hash = ? AND tool_call_id = ? LIMIT 1';

/**
 * The merge-on-cache in-place enrich (Phase 82-04). Parameterized `?` binds only
 * (T-82-04-02) — every value is num()-coalesced by the caller. `reasoning_tokens
 * = MAX(reasoning_tokens, ?)` deliberately preserves a transcript-first
 * reasoning count when a later cache-bearing tap row carries reasoning=0.
 */
const MERGE_ON_CACHE_SQL =
  'UPDATE token_usage SET cache_read_tokens = ?, cache_write_tokens = ?, reasoning_tokens = MAX(reasoning_tokens, ?) WHERE user_hash = ? AND tool_call_id = ?';

/**
 * Best-effort idempotent INSERT with merge-on-cache (D-08 — NEVER throws). Runs
 * the parameterized `(user_hash, tool_call_id)` dedup probe. On a MISS it
 * inserts. On a HIT it no longer blindly drops the incoming row
 * (first-writer-wins): if the existing row is cache-less
 * (cache_read + cache_write === 0) AND the incoming row carries cache data OR
 * nonzero reasoning, it ENRICHES the existing row in place (Phase 82-04 — a
 * cache-less tap row must no longer permanently shadow the richer cladpt
 * transcript row). If the existing row already carries cache, or the incoming
 * row adds nothing, the incoming row is still dropped (return false) so a
 * genuine duplicate never double-counts. Shared by BOTH live hooks (Claude +
 * Copilot) so the live path is idempotent across repeated `onTokenRow` firings.
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
 * @returns {boolean} true if a row was inserted OR enriched in place, false if
 *   dropped (genuine duplicate) or on any handled failure
 */
/**
 * The reconcile request-id probe (Phase 83-03, D-04). Unlike DEDUP_SQL — which
 * keys on the natural dedup key `(user_hash, tool_call_id)` — this probes on
 * `tool_call_id` ALONE. A wire row (proxy-tap hash) and its transcript
 * counterpart (`cladpt` / `copadt`) carry DIFFERENT `user_hash` BY DESIGN, so
 * the reconcile matcher MUST join across the hash boundary on the upstream
 * request-id (== `tool_call_id`). It returns the full reconciled column set so
 * the caller can BOTH compute per-field deltas AND locate the wire row to
 * enrich. `ORDER BY id` makes the earliest (wire) row the deterministic winner
 * when more than one row shares the id (pre-merge tap + adapter rows).
 */
const RECONCILE_PROBE_SQL =
  'SELECT id, tool_call_id, model, timestamp, input_tokens, output_tokens, ' +
  'reasoning_tokens, cache_read_tokens, cache_write_tokens, parent_call_id, granularity_tier ' +
  'FROM token_usage WHERE tool_call_id = ? ORDER BY id LIMIT 1';

/**
 * The widened reconcile gap-fill UPDATE (Phase 83-03, D-04). Fills ONLY the
 * fields the wire row lacks and NEVER lowers/overwrites an authoritative wire
 * count:
 *   - reasoning_tokens = MAX(reasoning_tokens, ?) — a nonzero wire value wins;
 *   - granularity_tier / parent_call_id = COALESCE(NULLIF(col, ''), ?) — a
 *     non-empty wire value wins, a wire-empty field fills from the transcript;
 *   - cache_read/write = CASE WHEN (cache_read + cache_write) = 0 THEN ? ELSE col
 *     END — the cache split fills ONLY when the wire row is entirely cache-less;
 *     a wire row that already carries cache is left byte-for-byte untouched.
 *   - task_id = CASE WHEN task_id = '' THEN ? ELSE task_id END (Phase 83-08, CR-03)
 *     — an interactive-launch wire row (agent launched without TASK_ID sends a
 *     blank x-task-id, and D-08's no-inherit rule stamps task_id='' on it) is
 *     stamped with the SPAN task_id at reconcile time. This is a SPAN-SCOPED stamp
 *     applied ONLY to a row already matched by tool_call_id to a span transcript
 *     row — NOT ambient inheritance. An already-bound (non-empty) task_id is NEVER
 *     overwritten, so no cross-span leakage is possible.
 * SQLite evaluates every RHS against the OLD row, so both cache assignments read
 * the pre-update sum — the wire-authoritative invariant holds (D-04).
 */
const RECONCILE_GAP_FILL_SQL =
  'UPDATE token_usage SET ' +
  'reasoning_tokens = MAX(reasoning_tokens, ?), ' +
  "granularity_tier = COALESCE(NULLIF(granularity_tier, ''), ?), " +
  "parent_call_id = COALESCE(NULLIF(parent_call_id, ''), ?), " +
  'cache_read_tokens = CASE WHEN (cache_read_tokens + cache_write_tokens) = 0 THEN ? ELSE cache_read_tokens END, ' +
  'cache_write_tokens = CASE WHEN (cache_read_tokens + cache_write_tokens) = 0 THEN ? ELSE cache_write_tokens END, ' +
  "task_id = CASE WHEN task_id = '' THEN ? ELSE task_id END " +
  'WHERE tool_call_id = ?';

/**
 * Locate the wire row for a request-id ACROSS user_hash boundaries (D-04). Keyed
 * on `tool_call_id` ALONE via RECONCILE_PROBE_SQL — the reconcile matcher's
 * cross-key join. Best-effort (D-08 / T-83-03-03): a degenerate/empty id or ANY
 * DB error returns `null` (never throws, never collapses the whole table).
 *
 * @param {import('better-sqlite3').Database} db handle from openTokenDb
 * @param {string} toolCallId the upstream request-id
 * @returns {object|null} the wire row's reconciled columns, or null on miss/error
 */
export function probeWireRowByRequestId(db, toolCallId) {
  try {
    if (typeof toolCallId !== 'string' || toolCallId.length === 0) return null;
    return db.prepare(RECONCILE_PROBE_SQL).get(toolCallId) ?? null;
  } catch (err) {
    process.stderr.write(
      `[reconcile] request-id probe failed (non-fatal): ${err.message}\n`,
    );
    return null;
  }
}

/**
 * Fill-gaps-only enrich of the wire row keyed on `tool_call_id` (D-04). Wire
 * counts are authoritative and NEVER decrease/overwrite — only wire-empty gap
 * fields fill (see RECONCILE_GAP_FILL_SQL). Parameterized `?` binds only
 * (T-83-03-01) — every value is num()/text()-coalesced, model/id never
 * interpolated. Best-effort (D-08 / T-83-03-03): a degenerate id or ANY DB error
 * returns `false` (never throws).
 *
 * @param {import('better-sqlite3').Database} db handle from openTokenDb
 * @param {string} toolCallId the wire row's tool_call_id (the enrich key)
 * @param {object} fields transcript-supplied gap values
 *   ({reasoning_tokens, granularity_tier, parent_call_id, cache_read_tokens,
 *   cache_write_tokens, task_id}); `task_id` backfills a task_id='' wire row only (CR-03)
 * @returns {boolean} true if the wire row was matched by the UPDATE, false on
 *   degenerate id / no matching row / handled error
 */
export function reconcileGapFill(db, toolCallId, fields = {}) {
  try {
    if (typeof toolCallId !== 'string' || toolCallId.length === 0) return false;
    const info = db.prepare(RECONCILE_GAP_FILL_SQL).run(
      num(fields.reasoning_tokens),
      text(fields.granularity_tier),
      text(fields.parent_call_id),
      num(fields.cache_read_tokens),
      num(fields.cache_write_tokens),
      // CR-03 (83-08): span task_id backfill — bound at the position of the new
      // `task_id = CASE WHEN task_id = '' THEN ? ...` SET clause (before the WHERE).
      text(fields.task_id),
      toolCallId,
    );
    return info.changes > 0;
  } catch (err) {
    process.stderr.write(
      `[reconcile] gap-fill failed (non-fatal): ${err.message}\n`,
    );
    return false;
  }
}

export function insertTokenRowDeduped(db, row) {
  try {
    const toolCallId = row.tool_call_id;
    // IN-03: empty/non-string tool_call_id → skip dedup, insert directly so we
    // never collapse unrelated empty-key rows into a single dedup bucket.
    if (typeof toolCallId === 'string' && toolCallId.length > 0) {
      const existing = db.prepare(DEDUP_SQL).get(row.user_hash, toolCallId);
      if (existing) {
        // Dedup HIT. Merge-on-cache (Phase 82-04): enrich a cache-less existing
        // row in place instead of dropping the richer incoming row. The UPDATE
        // fires ONLY when the existing row is cache-less (sum === 0), so it is
        // an overwrite-once — never additive (T-82-04-01, no double-count).
        const existingCacheLess =
          num(existing.cache_read_tokens) + num(existing.cache_write_tokens) === 0;
        const incomingHasCache =
          num(row.cache_read_tokens) + num(row.cache_write_tokens) > 0;
        const incomingHasReasoning = num(row.reasoning_tokens) > 0;
        if (existingCacheLess && (incomingHasCache || incomingHasReasoning)) {
          db.prepare(MERGE_ON_CACHE_SQL).run(
            num(row.cache_read_tokens),
            num(row.cache_write_tokens),
            num(row.reasoning_tokens),
            row.user_hash,
            toolCallId,
          );
          return true;
        }
        // Existing row already carries cache, or incoming adds nothing →
        // genuine duplicate, drop it (no double-count).
        return false;
      }
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
