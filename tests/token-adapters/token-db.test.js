/**
 * tests/token-adapters/token-db.test.js
 *
 * Phase 69, Plan 69-02, Task 1 — unit tests for the host-side best-effort
 * token-usage.db INSERT helper (`lib/lsl/token/token-db.mjs`).
 *
 * Covers:
 *   1.  ADAPTER_USER_HASH_CLAUDE / ADAPTER_USER_HASH_COPILOT are the locked
 *       'cladpt' / 'copadt' constants and both match /^[a-z][a-z0-9]{5}$/.
 *   2.  insertTokenRow inserts a row that reads back under the distinct adapter
 *       user_hash (id-space isolation, D-06).
 *   3.  Two sequential inserts allocate incrementing ids within the adapter's
 *       user_hash space (MAX(id)+1 seed, D-06).
 *   4.  A row with `undefined` numeric fields coalesces to 0 (no NaN/null in
 *       NOT-NULL columns, V5 / T-69-nan).
 *   5.  insertTokenRow returns false and does NOT throw when handed a closed db
 *       (best-effort, never throws out of ingestion, D-08 / T-69-dos).
 *
 * The fixture builds a temp DB with the Wave-0 21-column Phase-68 token_usage
 * shape (mirrors wal-concurrency.test.mjs CREATE_TABLE_SQL).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const {
  openTokenDb,
  insertTokenRow,
  ADAPTER_USER_HASH_CLAUDE,
  ADAPTER_USER_HASH_COPILOT,
} = await import('../../lib/lsl/token/token-db.mjs');

/** The full 21-column Phase-68 token_usage shape (order is load-bearing). */
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
  PRIMARY KEY (user_hash, id)
);`;

/** Build a fresh temp DB file with the token_usage shape; return its path + dir. */
function makeTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-db-test-'));
  const dbPath = path.join(dir, 'token-usage.db');
  const seed = new Database(dbPath);
  seed.pragma('journal_mode = wal');
  seed.exec(CREATE_TABLE_SQL);
  seed.close();
  return { dir, dbPath };
}

/** A minimal valid Claude per-turn row. */
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
    tool_call_id: 'req-abc',
    parent_call_id: '',
    granularity_tier: 'per-turn',
    reasoning_tokens: 0,
    ...overrides,
  };
}

test('adapter user_hash constants are locked and match the proxy charset regex', () => {
  expect(ADAPTER_USER_HASH_CLAUDE).toBe('cladpt');
  expect(ADAPTER_USER_HASH_COPILOT).toBe('copadt');
  const re = /^[a-z][a-z0-9]{5}$/;
  expect(re.test(ADAPTER_USER_HASH_CLAUDE)).toBe(true);
  expect(re.test(ADAPTER_USER_HASH_COPILOT)).toBe(true);
  // distinct id-spaces
  expect(ADAPTER_USER_HASH_CLAUDE).not.toBe(ADAPTER_USER_HASH_COPILOT);
});

test('insertTokenRow inserts a row that reads back under the distinct adapter user_hash', () => {
  const { dir, dbPath } = makeTempDb();
  const db = openTokenDb(dbPath);
  try {
    expect(insertTokenRow(db, claudeRow())).toBe(true);

    const read = db
      .prepare(
        'SELECT user_hash, agent, model, input_tokens, output_tokens, tool_call_id, granularity_tier FROM token_usage WHERE user_hash = ?',
      )
      .get(ADAPTER_USER_HASH_CLAUDE);

    expect(read).toBeTruthy();
    expect(read.user_hash).toBe(ADAPTER_USER_HASH_CLAUDE);
    expect(read.agent).toBe('claude');
    expect(read.model).toBe('claude-opus-4-8');
    expect(read.input_tokens).toBe(100);
    expect(read.output_tokens).toBe(20);
    expect(read.tool_call_id).toBe('req-abc');
    expect(read.granularity_tier).toBe('per-turn');
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('two sequential inserts get incrementing ids within the adapter user_hash space', () => {
  const { dir, dbPath } = makeTempDb();
  const db = openTokenDb(dbPath);
  try {
    insertTokenRow(db, claudeRow({ tool_call_id: 'req-1' }));
    insertTokenRow(db, claudeRow({ tool_call_id: 'req-2' }));

    const ids = db
      .prepare(
        'SELECT id FROM token_usage WHERE user_hash = ? ORDER BY id ASC',
      )
      .all(ADAPTER_USER_HASH_CLAUDE)
      .map((r) => r.id);

    expect(ids.length).toBe(2);
    expect(ids[1]).toBe(ids[0] + 1);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('copilot rows use a distinct id-space from claude rows', () => {
  const { dir, dbPath } = makeTempDb();
  const db = openTokenDb(dbPath);
  try {
    // Seed one claude row to advance the claude id-space.
    insertTokenRow(db, claudeRow({ tool_call_id: 'c-1' }));
    // First copilot row must start at id=1 in its OWN user_hash space.
    insertTokenRow(
      db,
      claudeRow({
        user_hash: ADAPTER_USER_HASH_COPILOT,
        agent: 'copilot',
        provider: 'copilot',
        tool_call_id: 'cop-1',
        granularity_tier: 'per-session-aggregate',
      }),
    );

    const copilotId = db
      .prepare('SELECT id FROM token_usage WHERE user_hash = ?')
      .get(ADAPTER_USER_HASH_COPILOT).id;
    expect(copilotId).toBe(1);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('undefined numeric fields coalesce to 0 (no NaN/null in NOT-NULL columns)', () => {
  const { dir, dbPath } = makeTempDb();
  const db = openTokenDb(dbPath);
  try {
    const row = claudeRow({
      input_tokens: undefined,
      output_tokens: undefined,
      total_tokens: undefined,
      latency_ms: undefined,
      tokens_estimated: undefined,
      reasoning_tokens: undefined,
      prompt_preview: undefined,
      model_raw: undefined,
      tool_call_id: 'req-coalesce',
    });
    expect(insertTokenRow(db, row)).toBe(true);

    const read = db
      .prepare(
        'SELECT input_tokens, output_tokens, total_tokens, latency_ms, tokens_estimated, reasoning_tokens, prompt_preview, model_raw FROM token_usage WHERE tool_call_id = ?',
      )
      .get('req-coalesce');

    expect(read.input_tokens).toBe(0);
    expect(read.output_tokens).toBe(0);
    expect(read.total_tokens).toBe(0);
    expect(read.latency_ms).toBe(0);
    expect(read.tokens_estimated).toBe(0);
    expect(read.reasoning_tokens).toBe(0);
    expect(read.prompt_preview).toBe('');
    // model_raw falls back to model when omitted.
    expect(typeof read.model_raw).toBe('string');
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('insertTokenRow returns false and does NOT throw on a closed/locked db', () => {
  const { dir, dbPath } = makeTempDb();
  const db = openTokenDb(dbPath);
  db.close(); // force every prepare/run to fail

  let result;
  expect(() => {
    result = insertTokenRow(db, claudeRow({ tool_call_id: 'req-closed' }));
  }).not.toThrow();
  expect(result).toBe(false);

  fs.rmSync(dir, { recursive: true, force: true });
});
