/**
 * Phase 75 Plan 01 (Wave 0) — RED unit test for canonical-model derivation +
 * foreground/background segregation (ATTR-01 / ATTR-02 / D-05).
 *
 * This is the acceptance shape Plan 02 must satisfy. It is RED today because:
 *   - `isForegroundGroup` does NOT yet exist in lib/experiments/token-aggregate.mjs
 *     (Plan 02 adds it), so the import resolves `undefined` and the first
 *     `isForegroundGroup(...)` call throws `is not a function`.
 *   - `aggregateByTaskId`'s `byAgentModel` rows do NOT yet carry `user_hash` /
 *     `process` (Plan 02 adds them to the SELECT/GROUP BY), so the fg/bg
 *     classification cannot run against today's shape.
 *
 * What it locks (the finding-B / finding-C fix):
 *   (a) `isForegroundGroup` returns true for the cladpt non-denylisted group and
 *       false for every c197ef / denylisted background-daemon group.
 *   (b) the canonical model (computed from the first foreground group) equals the
 *       cladpt foreground model, and is NEVER `byAgentModel[0]` when a haiku
 *       daemon group dominates by token count (the exact mis-measure from the
 *       `exp-dash-start-control` run: 1.24M haiku tokens out-massed the Opus
 *       foreground).
 *   (c) the background list carries the daemon (model, process, total_tokens)
 *       entries — segregated, not dropped (D-02).
 *
 * Live assertions gate on the EXPERIMENTS_LIVE env var, NEVER a `--live` argv
 * (the per-file child-proc drops trailing argv, silently skipping; MEMORY.md
 * reference_node_test_argv_live_gate). This file's only live touch is a
 * read-only smoke that the helper exists and runs without throwing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { aggregateByTaskId, isForegroundGroup } from '../../lib/experiments/token-aggregate.mjs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

/**
 * The attribution-column subset Plan 02's `byAgentModel` SELECTs/GROUPs by.
 * EXTENDS the token-aggregate.test.mjs fixture with `user_hash` + `process`
 * (the two columns the fg/bg classifier keys off — already present in the real
 * proxy-owned token_usage schema, see token-db.mjs).
 */
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
      (task_id, agent, model, provider, process, user_hash, granularity_tier,
       input_tokens, output_tokens, total_tokens, reasoning_tokens)
     VALUES (@task_id, @agent, @model, @provider, @process, @user_hash, @granularity_tier,
       @input_tokens, @output_tokens, @total_tokens, @reasoning_tokens)`).run({
    task_id: '',
    agent: '',
    model: '',
    provider: '',
    process: '',
    user_hash: '',
    granularity_tier: '',
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    reasoning_tokens: 0,
    ...row,
  });
}

/**
 * Seed the `exp-dash-start-control` shape: a small cladpt FOREGROUND Opus group
 * (the measured session) and a HUGE c197ef BACKGROUND haiku consolidator group
 * (concurrent daemon traffic). The background group dominates by token count —
 * so `byAgentModel[0]` is the haiku daemon, which is exactly the wrong canonical
 * that D-05 forbids.
 */
function seedTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canonical-attribution-test-'));
  const dbPath = path.join(dir, 'token-usage.db');
  const db = new Database(dbPath);
  createTokenUsageTable(db);

  // FOREGROUND — the measured Opus session, captured as the cladpt adapter
  // (ATTR-03). Small token count relative to the daemon flood.
  insertRow(db, { task_id: 'm1', agent: 'claude', model: 'claude-opus-4-8', provider: 'claude-code', process: 'gsd-execute', user_hash: 'cladpt', granularity_tier: 'per-turn', input_tokens: 4000, output_tokens: 2000, total_tokens: 6000, reasoning_tokens: 0 });
  insertRow(db, { task_id: 'm1', agent: 'claude', model: 'claude-opus-4-8', provider: 'claude-code', process: 'gsd-execute', user_hash: 'cladpt', granularity_tier: 'per-turn', input_tokens: 3000, output_tokens: 1500, total_tokens: 4500, reasoning_tokens: 0 });

  // BACKGROUND — concurrent daemon/consolidator traffic stamped with the same
  // measurement task_id by the old in-window blanket rule. c197ef user_hash,
  // denylisted process names, haiku model. DOMINATES by token count.
  insertRow(db, { task_id: 'm1', agent: 'claude', model: 'haiku',  provider: 'claude-code', process: 'consolidator-mentions', user_hash: 'c197ef', granularity_tier: 'session', input_tokens: 600000, output_tokens: 400000, total_tokens: 1000000, reasoning_tokens: 0 });
  insertRow(db, { task_id: 'm1', agent: 'claude', model: 'sonnet', provider: 'claude-code', process: 'health-coordinator',   user_hash: 'c197ef', granularity_tier: 'session', input_tokens: 120000, output_tokens: 80000,  total_tokens: 200000,  reasoning_tokens: 0 });
  insertRow(db, { task_id: 'm1', agent: 'claude', model: 'haiku',  provider: 'claude-code', process: 'observation-writer',    user_hash: 'c197ef', granularity_tier: 'session', input_tokens: 30000,  output_tokens: 10000,  total_tokens: 40000,   reasoning_tokens: 0 });

  db.close();
  return { dir, dbPath };
}

test('isForegroundGroup: true for the cladpt non-denylisted group', () => {
  const { dir, dbPath } = seedTempDb();
  try {
    const { byAgentModel } = aggregateByTaskId('m1', dbPath);
    const fg = byAgentModel.find((g) => g.user_hash === 'cladpt');
    assert.ok(fg, 'cladpt group present (byAgentModel carries user_hash)');
    assert.equal(isForegroundGroup(fg), true, 'cladpt + gsd-execute is foreground');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('isForegroundGroup: false for every c197ef / denylisted daemon group', () => {
  const { dir, dbPath } = seedTempDb();
  try {
    const { byAgentModel } = aggregateByTaskId('m1', dbPath);
    const bgGroups = byAgentModel.filter((g) => g.user_hash === 'c197ef');
    assert.equal(bgGroups.length, 3, 'three distinct background daemon groups');
    for (const g of bgGroups) {
      assert.equal(
        isForegroundGroup(g),
        false,
        `${g.process} (${g.user_hash}) must classify as background`,
      );
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('canonical = cladpt foreground model, NEVER byAgentModel[0] (finding B)', () => {
  const { dir, dbPath } = seedTempDb();
  try {
    const { byAgentModel } = aggregateByTaskId('m1', dbPath);

    // The dominant-by-count row is the haiku daemon — the WRONG canonical.
    assert.equal(byAgentModel[0].model, 'haiku', 'dominant-by-count is the haiku daemon');
    assert.equal(byAgentModel[0].user_hash, 'c197ef', 'dominant row is a background row');

    // D-05 canonical: the first FOREGROUND group, not the dominant group.
    const fgGroups = byAgentModel.filter(isForegroundGroup);
    const canonical = fgGroups[0] ?? null;
    assert.ok(canonical, 'a foreground group exists');
    assert.equal(canonical.model, 'claude-opus-4-8', 'canonical is the Opus foreground model');
    assert.notEqual(canonical.model, byAgentModel[0].model, 'canonical != dominant-by-count');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('background list carries the segregated daemon (model, process, total_tokens) entries', () => {
  const { dir, dbPath } = seedTempDb();
  try {
    const { byAgentModel } = aggregateByTaskId('m1', dbPath);
    const bgGroups = byAgentModel.filter((g) => !isForegroundGroup(g));
    const backgroundModels = bgGroups.map((g) => ({
      model: g.model,
      process: g.process,
      total_tokens: g.total_tokens,
    }));
    // Nothing dropped — the operator can still see what ran concurrently (D-02).
    assert.ok(
      backgroundModels.some((b) => b.process === 'consolidator-mentions' && b.model === 'haiku'),
      'consolidator-mentions/haiku is present in the background list',
    );
    assert.ok(
      backgroundModels.every((b) => typeof b.total_tokens === 'number' && b.total_tokens > 0),
      'every background entry carries a positive token total',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Live smoke — opt-in via EXPERIMENTS_LIVE (never a `--live` argv; see header).
// Proves the Plan 02 helper exists and the real schema carries user_hash/process.
test('live: isForegroundGroup classifies real byAgentModel rows (EXPERIMENTS_LIVE)', { skip: !process.env.EXPERIMENTS_LIVE }, () => {
  const { byAgentModel } = aggregateByTaskId('telem-live-75');
  assert.ok(Array.isArray(byAgentModel), 'byAgentModel is an array');
  for (const g of byAgentModel) {
    assert.equal(typeof isForegroundGroup(g), 'boolean', 'classifier returns a boolean');
  }
});
