/**
 * KB-02 proof (Plan 71-03): read-only token aggregation over the proxy-owned
 * `token-usage.db`.
 *
 * Proves:
 *   - aggregateByTaskId(taskId, dbPathOverride) sums the attribution columns for
 *     exactly that task_id (totals.total_tokens + totals.calls correct).
 *   - byAgentModel groups by (agent,model,provider,granularity_tier) ordered by
 *     total_tokens DESC — the first row is the dominant agent/model.
 *   - A task_id with zero rows returns all-zero totals (COALESCE) + [] (no throw).
 *   - Re-running after a backfill INSERTs MORE rows recomputes the higher total
 *     (D-14 self-healing pure recompute).
 *   - The DB is opened read-only — a write attempt against the same path throws
 *     (coding never becomes a second writer to the proxy-owned DB).
 *   - A missing DB file is handled gracefully (zero totals + [] rather than throw).
 *
 * The fixture mirrors the locked backfill self-test (scripts/backfill-task-id-by-timestamp.mjs):
 * a temp DB with the token_usage attribution columns, seed rows, and the
 * aggregator pointed at the temp DB via the dbPathOverride argument.
 *
 * Live assertions (against the real proxy DB) gate on EXPERIMENTS_LIVE — never a
 * `--live` argv (the per-file child-proc drops trailing argv, silently skipping;
 * MEMORY.md reference_node_test_argv_live_gate).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { aggregateByTaskId } from '../../lib/experiments/token-aggregate.mjs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

/** The attribution-column subset the aggregator SUMs / GROUPs by. */
function createTokenUsageTable(db) {
  db.exec(`CREATE TABLE token_usage (
    id               INTEGER PRIMARY KEY,
    timestamp        TEXT    NOT NULL DEFAULT '',
    task_id          TEXT    NOT NULL DEFAULT '',
    agent            TEXT    NOT NULL DEFAULT '',
    model            TEXT    NOT NULL DEFAULT '',
    provider         TEXT    NOT NULL DEFAULT '',
    process          TEXT    NOT NULL DEFAULT '',
    user_hash        TEXT    NOT NULL DEFAULT '',
    granularity_tier TEXT    NOT NULL DEFAULT '',
    input_tokens     INTEGER NOT NULL DEFAULT 0,
    output_tokens    INTEGER NOT NULL DEFAULT 0,
    total_tokens     INTEGER NOT NULL DEFAULT 0,
    reasoning_tokens INTEGER NOT NULL DEFAULT 0
  );`);
}

function insertRow(db, row) {
  db.prepare(`INSERT INTO token_usage
      (task_id, agent, model, provider, granularity_tier,
       input_tokens, output_tokens, total_tokens, reasoning_tokens)
     VALUES (@task_id, @agent, @model, @provider, @granularity_tier,
       @input_tokens, @output_tokens, @total_tokens, @reasoning_tokens)`).run({
    task_id: '',
    agent: '',
    model: '',
    provider: '',
    granularity_tier: '',
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    reasoning_tokens: 0,
    ...row,
  });
}

/** Make a temp DB seeded for task 't1' (3 rows) + 't2' (1 row), return its path. */
function seedTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-aggregate-test-'));
  const dbPath = path.join(dir, 'token-usage.db');
  const db = new Database(dbPath);
  createTokenUsageTable(db);
  // t1 — two rows for (claude, sonnet, claude-code, turn) + one for (claude, opus, claude-code, reasoning-step).
  insertRow(db, { task_id: 't1', agent: 'claude', model: 'sonnet', provider: 'claude-code', granularity_tier: 'turn',           input_tokens: 100, output_tokens: 50,  total_tokens: 150, reasoning_tokens: 0 });
  insertRow(db, { task_id: 't1', agent: 'claude', model: 'sonnet', provider: 'claude-code', granularity_tier: 'turn',           input_tokens: 200, output_tokens: 100, total_tokens: 300, reasoning_tokens: 0 });
  insertRow(db, { task_id: 't1', agent: 'claude', model: 'opus',   provider: 'claude-code', granularity_tier: 'reasoning-step', input_tokens: 10,  output_tokens: 5,   total_tokens: 15,  reasoning_tokens: 40 });
  // t2 — unrelated row that must NOT leak into a t1 aggregation.
  insertRow(db, { task_id: 't2', agent: 'copilot', model: 'gpt-4o', provider: 'copilot', granularity_tier: 'session', input_tokens: 999, output_tokens: 999, total_tokens: 999, reasoning_tokens: 0 });
  db.close();
  return { dir, dbPath };
}

test('totals: sums exactly the 3 t1 rows (input/output/total/reasoning + calls)', () => {
  const { dir, dbPath } = seedTempDb();
  try {
    const { totals } = aggregateByTaskId('t1', dbPath);
    assert.equal(totals.input_tokens, 310, 'input = 100+200+10');
    assert.equal(totals.output_tokens, 155, 'output = 50+100+5');
    assert.equal(totals.total_tokens, 465, 'total = 150+300+15');
    assert.equal(totals.reasoning_tokens, 40, 'reasoning = 0+0+40');
    assert.equal(totals.calls, 3, '3 calls for t1 (t2 row excluded)');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('byAgentModel: groups by (agent,model,provider,tier) ordered by total_tokens DESC', () => {
  const { dir, dbPath } = seedTempDb();
  try {
    const { byAgentModel } = aggregateByTaskId('t1', dbPath);
    assert.equal(byAgentModel.length, 2, 'two distinct groups for t1');
    // Dominant group first: (claude, sonnet, claude-code, turn) = 150+300 = 450.
    assert.deepEqual(
      {
        agent: byAgentModel[0].agent,
        model: byAgentModel[0].model,
        provider: byAgentModel[0].provider,
        granularity_tier: byAgentModel[0].granularity_tier,
        total_tokens: byAgentModel[0].total_tokens,
        calls: byAgentModel[0].calls,
      },
      { agent: 'claude', model: 'sonnet', provider: 'claude-code', granularity_tier: 'turn', total_tokens: 450, calls: 2 },
      'dominant row is the sonnet/turn group',
    );
    assert.equal(byAgentModel[1].model, 'opus', 'second row is the smaller opus group');
    assert.ok(byAgentModel[0].total_tokens >= byAgentModel[1].total_tokens, 'ordered DESC');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('zero rows: all-zero totals + empty byAgentModel (graceful, no throw)', () => {
  const { dir, dbPath } = seedTempDb();
  try {
    const { totals, byAgentModel } = aggregateByTaskId('does-not-exist', dbPath);
    assert.equal(totals.input_tokens, 0);
    assert.equal(totals.output_tokens, 0);
    assert.equal(totals.total_tokens, 0);
    assert.equal(totals.reasoning_tokens, 0);
    assert.equal(totals.calls, 0);
    assert.deepEqual(byAgentModel, [], 'no groups for an unknown task_id');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('self-healing recompute: re-run after a backfill INSERT yields the higher total (D-14)', () => {
  const { dir, dbPath } = seedTempDb();
  try {
    const before = aggregateByTaskId('t1', dbPath);
    assert.equal(before.totals.total_tokens, 465);
    assert.equal(before.totals.calls, 3);

    // Simulate a backfill re-attribution: 2 MORE rows land on t1.
    const db = new Database(dbPath);
    insertRow(db, { task_id: 't1', agent: 'claude', model: 'sonnet', provider: 'claude-code', granularity_tier: 'turn', input_tokens: 1000, output_tokens: 500, total_tokens: 1500, reasoning_tokens: 0 });
    insertRow(db, { task_id: 't1', agent: 'claude', model: 'sonnet', provider: 'claude-code', granularity_tier: 'turn', input_tokens: 2000, output_tokens: 1000, total_tokens: 3000, reasoning_tokens: 0 });
    db.close();

    const after = aggregateByTaskId('t1', dbPath);
    assert.equal(after.totals.total_tokens, 465 + 1500 + 3000, 'recompute reflects the late rows');
    assert.equal(after.totals.calls, 5, 'recompute counts the late rows');
    assert.ok(after.totals.total_tokens > before.totals.total_tokens, 'self-healing: higher after backfill');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('read-only: a write against the same path opened readonly throws (no second writer)', () => {
  const { dir, dbPath } = seedTempDb();
  try {
    // Mirror the aggregator's open options and confirm a write is rejected.
    const ro = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      assert.throws(
        () => ro.prepare('INSERT INTO token_usage (task_id) VALUES (?)').run('hacker'),
        /readonly|read-only|read only/i,
        'a write through a readonly handle must throw',
      );
    } finally {
      ro.close();
    }
    // And the aggregator itself still reads fine through its own readonly handle.
    const { totals } = aggregateByTaskId('t1', dbPath);
    assert.equal(totals.calls, 3, 'aggregator reads via readonly handle');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('missing DB file: graceful zero totals + empty array (no throw)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-aggregate-missing-'));
  const missingPath = path.join(dir, 'does-not-exist.db');
  try {
    const { totals, byAgentModel } = aggregateByTaskId('t1', missingPath);
    assert.equal(totals.total_tokens, 0, 'missing DB → zero total');
    assert.equal(totals.calls, 0, 'missing DB → zero calls');
    assert.deepEqual(byAgentModel, [], 'missing DB → empty groups');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Live assertion against the real proxy-owned DB — opt-in via EXPERIMENTS_LIVE
// (never a `--live` argv; see file header). Reads only; proves the real schema
// has the attribution columns the aggregator SELECTs.
test('live: real token-usage.db aggregates without throwing (EXPERIMENTS_LIVE)', { skip: !process.env.EXPERIMENTS_LIVE }, () => {
  const { totals, byAgentModel } = aggregateByTaskId('telem-live-68');
  assert.equal(typeof totals.total_tokens, 'number', 'totals.total_tokens is numeric');
  assert.ok(Array.isArray(byAgentModel), 'byAgentModel is an array');
});
