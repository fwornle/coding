/**
 * tests/token-adapters/reconcile-matcher.test.js
 *
 * Phase 83, Plan 83-03 — the shared unit suite for the reconcile matcher.
 *
 * Task 1 (token-db primitives, D-04):
 *   - probeWireRowByRequestId: a request-id probe keyed on `tool_call_id` ALONE
 *     (NOT the (user_hash, tool_call_id) dedup key) returns the wire row's
 *     reconciled columns REGARDLESS of user_hash — wire rows and transcript rows
 *     carry DIFFERENT user_hash by design, so the join must cross that boundary.
 *   - reconcileGapFill: fills ONLY the wire-empty gap fields (reasoning /
 *     granularity_tier / parent_call_id / cache split when wire cache sum is 0);
 *     a wire row that already carries a nonzero count is left untouched — the
 *     wire is authoritative and its counts NEVER decrease/overwrite.
 *
 * Task 2 (reconcile.mjs matcher, D-04/D-05):
 *   - matchWireRow: request-id first, then a bounded fuzzy (model + timestamp)
 *     fallback; ties broken by nearest timestamp then lowest id.
 *   - computeDeltas: every nonzero per-field delta recorded; flagged when a delta
 *     exceeds max(2% of the larger value, 50 tokens).
 *   - reconcileRow: match → fill-gaps-only enrich → deltas → tolerance flag;
 *     a `:reason:N` tool_call_id bypasses matching (always-insert); never throws.
 *
 * Run: node --test tests/token-adapters/reconcile-matcher.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const {
  openTokenDb,
  probeWireRowByRequestId,
  reconcileGapFill,
} = await import('../../lib/lsl/token/token-db.mjs');

/**
 * The full token_usage shape (Phase-68 base + cache columns). Mirrors the
 * production schema so the primitives run against a realistic table.
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

const WIRE_INSERT_SQL = `INSERT INTO token_usage (
  id, timestamp, provider, model, process, subscription,
  input_tokens, output_tokens, total_tokens, latency_ms,
  prompt_preview, tokens_estimated, user_hash, model_raw, overhead_ms,
  agent, task_id, tool_call_id, parent_call_id, granularity_tier, reasoning_tokens,
  cache_read_tokens, cache_write_tokens
) VALUES (@id, @timestamp, @provider, @model, @process, @subscription,
  @input_tokens, @output_tokens, @total_tokens, @latency_ms,
  @prompt_preview, @tokens_estimated, @user_hash, @model_raw, @overhead_ms,
  @agent, @task_id, @tool_call_id, @parent_call_id, @granularity_tier, @reasoning_tokens,
  @cache_read_tokens, @cache_write_tokens)`;

/** Build a fresh temp DB file with the token_usage shape; return its path + dir. */
function makeTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-matcher-test-'));
  const dbPath = path.join(dir, 'token-usage.db');
  const seed = new Database(dbPath);
  seed.pragma('journal_mode = wal');
  seed.exec(CREATE_TABLE_SQL);
  seed.close();
  return { dir, dbPath };
}

/**
 * Insert a wire row with an ARBITRARY user_hash (the proxy tap hash — NOT the
 * cladpt/copadt adapter hash), exercising the cross-user_hash join.
 */
function insertWireRow(db, overrides = {}) {
  const row = {
    id: 1,
    timestamp: new Date().toISOString(),
    provider: 'anthropic',
    model: 'claude-opus-4-8',
    process: 'proxy-tap',
    subscription: 'unknown',
    input_tokens: 100,
    output_tokens: 20,
    total_tokens: 120,
    latency_ms: 0,
    prompt_preview: '',
    tokens_estimated: 0,
    user_hash: 'proxy1', // wire hash, distinct from any adapter hash
    model_raw: 'claude-opus-4-8',
    overhead_ms: null,
    agent: 'claude',
    task_id: 't-abc',
    tool_call_id: 'req1',
    parent_call_id: '',
    granularity_tier: '',
    reasoning_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    ...overrides,
  };
  db.prepare(WIRE_INSERT_SQL).run(row);
  return row;
}

// ---------------------------------------------------------------------------
// Task 1 — token-db primitives (D-04)
// ---------------------------------------------------------------------------

test('Task1/probe: request-id probe by tool_call_id ALONE returns the wire row regardless of user_hash', () => {
  const { dir, dbPath } = makeTempDb();
  const db = openTokenDb(dbPath);
  try {
    insertWireRow(db, {
      id: 1,
      user_hash: 'proxy1',
      tool_call_id: 'reqX',
      model: 'claude-opus-4-8',
      timestamp: '2026-07-06T10:00:00.000Z',
      input_tokens: 111,
      output_tokens: 22,
      reasoning_tokens: 7,
      cache_read_tokens: 5,
      cache_write_tokens: 9,
      parent_call_id: 'p-root',
      granularity_tier: 'per-turn',
    });

    // Probe keyed on tool_call_id ALONE — a caller with a DIFFERENT (adapter)
    // user_hash still locates the wire row.
    const wire = probeWireRowByRequestId(db, 'reqX');
    assert.ok(wire, 'probe must find the wire row across user_hash boundaries');
    assert.equal(wire.tool_call_id, 'reqX');
    assert.equal(wire.model, 'claude-opus-4-8');
    assert.equal(wire.timestamp, '2026-07-06T10:00:00.000Z');
    assert.equal(wire.input_tokens, 111);
    assert.equal(wire.output_tokens, 22);
    assert.equal(wire.reasoning_tokens, 7);
    assert.equal(wire.cache_read_tokens, 5);
    assert.equal(wire.cache_write_tokens, 9);
    assert.equal(wire.parent_call_id, 'p-root');
    assert.equal(wire.granularity_tier, 'per-turn');

    // A miss returns null (never throws).
    assert.equal(probeWireRowByRequestId(db, 'nope'), null);
    // Empty/degenerate id → null (never collapses the whole table).
    assert.equal(probeWireRowByRequestId(db, ''), null);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Task1/gap-fill: fills ONLY wire-empty gap fields; a wire row that already has cache is left untouched', () => {
  const { dir, dbPath } = makeTempDb();
  const db = openTokenDb(dbPath);
  try {
    // Wire row already carries cache (5/7) but lacks reasoning/granularity/parent.
    insertWireRow(db, {
      id: 1,
      tool_call_id: 'reqE',
      cache_read_tokens: 5,
      cache_write_tokens: 7,
      reasoning_tokens: 0,
      granularity_tier: '',
      parent_call_id: '',
    });

    const changed = reconcileGapFill(db, 'reqE', {
      reasoning_tokens: 3,
      granularity_tier: 'per-turn',
      parent_call_id: 'p1',
      cache_read_tokens: 11, // MUST be ignored — wire already has cache
      cache_write_tokens: 22,
    });
    assert.equal(changed, true);

    const row = probeWireRowByRequestId(db, 'reqE');
    // Cache untouched — wire is authoritative and already non-empty.
    assert.equal(row.cache_read_tokens, 5);
    assert.equal(row.cache_write_tokens, 7);
    // Wire-empty gaps filled from the transcript.
    assert.equal(row.reasoning_tokens, 3);
    assert.equal(row.granularity_tier, 'per-turn');
    assert.equal(row.parent_call_id, 'p1');
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Task1/gap-fill: fills the cache split ONLY when the wire cache sum is 0', () => {
  const { dir, dbPath } = makeTempDb();
  const db = openTokenDb(dbPath);
  try {
    // Cache-less wire row → the cache split should fill from the transcript.
    insertWireRow(db, {
      id: 1,
      tool_call_id: 'reqC',
      cache_read_tokens: 0,
      cache_write_tokens: 0,
    });

    reconcileGapFill(db, 'reqC', {
      reasoning_tokens: 0,
      granularity_tier: '',
      parent_call_id: '',
      cache_read_tokens: 40,
      cache_write_tokens: 60,
    });

    const row = probeWireRowByRequestId(db, 'reqC');
    assert.equal(row.cache_read_tokens, 40);
    assert.equal(row.cache_write_tokens, 60);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Task1/gap-fill: never lowers or overwrites a nonzero wire count field (MAX + cache-guard)', () => {
  const { dir, dbPath } = makeTempDb();
  const db = openTokenDb(dbPath);
  try {
    // Wire row with a HIGH reasoning count and existing cache.
    insertWireRow(db, {
      id: 1,
      tool_call_id: 'reqH',
      reasoning_tokens: 10,
      cache_read_tokens: 5,
      cache_write_tokens: 7,
    });

    // Transcript brings LOWER reasoning + a cache split → must not lower/overwrite.
    reconcileGapFill(db, 'reqH', {
      reasoning_tokens: 2,
      granularity_tier: '',
      parent_call_id: '',
      cache_read_tokens: 99,
      cache_write_tokens: 99,
    });

    const row = probeWireRowByRequestId(db, 'reqH');
    assert.equal(row.reasoning_tokens, 10); // MAX preserves the higher wire value
    assert.equal(row.cache_read_tokens, 5); // untouched (already had cache)
    assert.equal(row.cache_write_tokens, 7);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Task1/gap-fill: empty/degenerate tool_call_id is a safe no-op (never collapses the table)', () => {
  const { dir, dbPath } = makeTempDb();
  const db = openTokenDb(dbPath);
  try {
    insertWireRow(db, { id: 1, tool_call_id: 'reqK', cache_read_tokens: 1 });
    assert.equal(reconcileGapFill(db, '', { cache_read_tokens: 5 }), false);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
