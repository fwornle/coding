/**
 * tests/token-adapters/token-db-dedup-merge.test.js
 *
 * Phase 82, Plan 82-04, Task 2 — unit tests for the merge-on-cache upgrade to
 * `insertTokenRowDeduped` (lib/lsl/token/token-db.mjs).
 *
 * Before 82-04 a dedup HIT dropped the incoming row (first-writer-wins), so a
 * cache-less tap row permanently shadowed the richer `cladpt` transcript row.
 * Now a HIT on a cache-less existing row ENRICHES it in place, while a HIT on an
 * already-cached row still drops (no double-count).
 *
 * Covers (matches PLAN <behavior>):
 *   1. Positive in-place merge  — cache-less seed + cache-bearing incoming →
 *      returns true, exactly ONE row, cache_read=11/cache_write=22/reasoning=3.
 *   2. Negative genuine drop     — already-cached seed + same-key incoming →
 *      returns false, existing row unchanged, still exactly one row.
 *   3. Empty tool_call_id        — skip-dedup direct insert, no merge path.
 *   4. Reasoning preservation    — reasoning-first seed + cache-bearing incoming
 *      with reasoning=0 → MAX() keeps the earlier reasoning count.
 *
 * Run: node --test tests/token-adapters/token-db-dedup-merge.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const { openTokenDb, insertTokenRowDeduped, ADAPTER_USER_HASH_CLAUDE } =
  await import('../../lib/lsl/token/token-db.mjs');

/**
 * The full Phase-68 token_usage shape PLUS the three merge-relevant columns
 * (cache_read_tokens / cache_write_tokens / reasoning_tokens). openTokenDb's
 * ensureCacheColumns re-adds the cache columns idempotently (duplicate-column
 * error is swallowed), so declaring them here is safe.
 */
const CREATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS token_usage (
  id INTEGER NOT NULL,
  timestamp TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  process TEXT NOT NULL,
  subscription TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  total_tokens INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL,
  prompt_preview TEXT NOT NULL,
  tokens_estimated INTEGER NOT NULL,
  user_hash TEXT NOT NULL,
  model_raw TEXT NOT NULL,
  overhead_ms INTEGER,
  agent TEXT NOT NULL DEFAULT '',
  task_id TEXT NOT NULL DEFAULT '',
  tool_call_id TEXT NOT NULL DEFAULT '',
  parent_call_id TEXT NOT NULL DEFAULT '',
  granularity_tier TEXT NOT NULL DEFAULT '',
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_hash, id)
);`;

/** Build a fresh temp DB file with the token_usage shape; return its path + dir. */
function makeTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-db-merge-test-'));
  const dbPath = path.join(dir, 'token-usage.db');
  const seed = new Database(dbPath);
  seed.pragma('journal_mode = wal');
  seed.exec(CREATE_TABLE_SQL);
  seed.close();
  return { dir, dbPath };
}

/** A minimal valid Claude adapter row. */
function claudeRow(overrides = {}) {
  return {
    timestamp: new Date().toISOString(),
    provider: 'claude-code',
    model: 'claude-opus-4-8',
    process: 'token-adapter-claude',
    subscription: 'unknown',
    input_tokens: 100,
    output_tokens: 20,
    total_tokens: 120,
    latency_ms: 0,
    prompt_preview: '',
    tokens_estimated: 0,
    user_hash: ADAPTER_USER_HASH_CLAUDE,
    model_raw: 'claude-opus-4-8',
    overhead_ms: null,
    agent: 'claude',
    task_id: '',
    tool_call_id: 't1',
    parent_call_id: '',
    granularity_tier: 'per-turn',
    reasoning_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    ...overrides,
  };
}

function countRows(db, userHash, toolCallId) {
  return db
    .prepare(
      'SELECT COUNT(*) AS n FROM token_usage WHERE user_hash = ? AND tool_call_id = ?',
    )
    .get(userHash, toolCallId).n;
}

function readRow(db, userHash, toolCallId) {
  return db
    .prepare(
      'SELECT cache_read_tokens, cache_write_tokens, reasoning_tokens FROM token_usage WHERE user_hash = ? AND tool_call_id = ?',
    )
    .get(userHash, toolCallId);
}

test('positive: dedup HIT on a cache-less row enriches it in place (single row, return true)', () => {
  const { dir, dbPath } = makeTempDb();
  const db = openTokenDb(dbPath);
  try {
    // Seed a cache-less row (a tap/transcript row that arrived first without cache).
    assert.equal(
      insertTokenRowDeduped(
        db,
        claudeRow({ tool_call_id: 't1', cache_read_tokens: 0, cache_write_tokens: 0, reasoning_tokens: 0 }),
      ),
      true,
    );

    // Incoming same-key row carries cache + reasoning → merge in place.
    const merged = insertTokenRowDeduped(
      db,
      claudeRow({ tool_call_id: 't1', cache_read_tokens: 11, cache_write_tokens: 22, reasoning_tokens: 3 }),
    );
    assert.equal(merged, true);

    // Exactly ONE row for the key, updated in place (not a second row).
    assert.equal(countRows(db, ADAPTER_USER_HASH_CLAUDE, 't1'), 1);
    const row = readRow(db, ADAPTER_USER_HASH_CLAUDE, 't1');
    assert.equal(row.cache_read_tokens, 11);
    assert.equal(row.cache_write_tokens, 22);
    assert.equal(row.reasoning_tokens, 3);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('negative: dedup HIT on an already-cached row drops the incoming row (return false, unchanged)', () => {
  const { dir, dbPath } = makeTempDb();
  const db = openTokenDb(dbPath);
  try {
    // Seed a row already carrying cache.
    assert.equal(
      insertTokenRowDeduped(
        db,
        claudeRow({ tool_call_id: 't1', cache_read_tokens: 5, cache_write_tokens: 7, reasoning_tokens: 2 }),
      ),
      true,
    );

    // Incoming same-key row → genuine duplicate, dropped.
    const dropped = insertTokenRowDeduped(
      db,
      claudeRow({ tool_call_id: 't1', cache_read_tokens: 99, cache_write_tokens: 99, reasoning_tokens: 99 }),
    );
    assert.equal(dropped, false);

    // Still exactly one row and the pre-existing cache value is unchanged.
    assert.equal(countRows(db, ADAPTER_USER_HASH_CLAUDE, 't1'), 1);
    const row = readRow(db, ADAPTER_USER_HASH_CLAUDE, 't1');
    assert.equal(row.cache_read_tokens, 5);
    assert.equal(row.cache_write_tokens, 7);
    assert.equal(row.reasoning_tokens, 2);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('empty tool_call_id skips dedup and inserts directly (no merge path)', () => {
  const { dir, dbPath } = makeTempDb();
  const db = openTokenDb(dbPath);
  try {
    // Two empty-key rows must both insert (skip-dedup) — never collapse/merge.
    assert.equal(insertTokenRowDeduped(db, claudeRow({ tool_call_id: '' })), true);
    assert.equal(insertTokenRowDeduped(db, claudeRow({ tool_call_id: '' })), true);

    assert.equal(countRows(db, ADAPTER_USER_HASH_CLAUDE, ''), 2);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('reasoning preservation: cache-bearing merge with reasoning=0 keeps the earlier reasoning count (MAX)', () => {
  const { dir, dbPath } = makeTempDb();
  const db = openTokenDb(dbPath);
  try {
    // Transcript-first: reasoning=5, cache=0.
    assert.equal(
      insertTokenRowDeduped(
        db,
        claudeRow({ tool_call_id: 't1', reasoning_tokens: 5, cache_read_tokens: 0, cache_write_tokens: 0 }),
      ),
      true,
    );

    // Tap arrives second: cache_read=10, reasoning=0 → merge, but MAX preserves 5.
    const merged = insertTokenRowDeduped(
      db,
      claudeRow({ tool_call_id: 't1', reasoning_tokens: 0, cache_read_tokens: 10, cache_write_tokens: 0 }),
    );
    assert.equal(merged, true);

    assert.equal(countRows(db, ADAPTER_USER_HASH_CLAUDE, 't1'), 1);
    const row = readRow(db, ADAPTER_USER_HASH_CLAUDE, 't1');
    assert.equal(row.cache_read_tokens, 10);
    assert.equal(row.reasoning_tokens, 5); // NOT zeroed by the overwrite.
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
