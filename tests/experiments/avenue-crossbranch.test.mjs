// tests/experiments/avenue-crossbranch.test.mjs
//
// Phase 87, Plan 87-03, Task 3 (AVN-06 + AVN-09) — the TOP-RISK integration gate
// for the phase's riskiest guarantee: an avenue's measurement span writes to the
// MAIN token_usage.db under the avenue's UNIQUE task_id, with NO double-count vs the
// origin and NO cross-avenue collision, and the data SURVIVES a branch prune.
//
// This exercises the REAL identity code (not mocks):
//   • aggregateByTaskId  (lib/experiments/token-aggregate.mjs — WHERE task_id=?, readonly:true)
//   • insertTokenRowDeduped (lib/lsl/token/token-db.mjs — merge-on-cache, keyed (user_hash, tool_call_id))
//   • pruneAvenueBranch  (lib/experiments/avenue-branch.mjs — Plan 01 branch teardown)
//
// DUAL-WRITER note (RESEARCH §5): aggregateByTaskId opens the SAME token-usage.db
// `{ readonly:true }` while insertTokenRowDeduped opens a SECOND writer handle. The
// test reconciles the two — it inserts via the writer, closes it, then aggregates via
// the readonly path — so no two handles hold a write lock simultaneously.
//
// Behaviors (PLAN Task 3):
//   1. per-task_id DISJOINT aggregation — origin vs two avenues; no bleed (AVN-06, Pitfall 2).
//   2. merge-on-cache dedup = NO second row (no double-count); a distinct tool_call_id = new row.
//   3. post-prune SURVIVAL — after pruneAvenueBranch, aggregateByTaskId(avenue) still returns
//      the avenue totals from the untouched MAIN db (AVN-09 crossover).
//   4. Pitfall-1 negative — an avenue whose span was (wrongly) opened against a SANDBOX data dir
//      yields an EMPTY/0-token aggregate under its task_id (documented failure mode).
//
// Run: node --test tests/experiments/avenue-crossbranch.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

import { aggregateByTaskId } from '../../lib/experiments/token-aggregate.mjs';
import {
  openTokenDb,
  insertTokenRowDeduped,
  ADAPTER_USER_HASH_CLAUDE,
} from '../../lib/lsl/token/token-db.mjs';
import {
  createAvenueBranch,
  commitAvenueWorktree,
  pruneAvenueBranch,
  avenueWorktreePath,
} from '../../lib/experiments/avenue-branch.mjs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

/**
 * The full Phase-68 token_usage shape PLUS the cache/reasoning columns the adapter
 * merge path reads. Mirrors tests/token-adapters/token-db-dedup-merge.test.js so
 * openTokenDb's ensureCacheColumns is a no-op and the composite PK (user_hash, id)
 * matches production. This is a MAIN-store fixture (one token-usage.db under .data/llm-proxy/).
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

/** Build a fresh MAIN token-usage.db under a temp .data/llm-proxy dir; return {dir, dbPath}. */
function makeMainTokenDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avenue-crossbranch-'));
  const dbDir = path.join(dir, '.data', 'llm-proxy');
  fs.mkdirSync(dbDir, { recursive: true });
  const dbPath = path.join(dbDir, 'token-usage.db');
  const seed = new Database(dbPath);
  seed.pragma('journal_mode = wal');
  seed.exec(CREATE_TABLE_SQL);
  seed.close();
  return { dir, dbPath };
}

/** A minimal valid Claude adapter row for a given task_id + tool_call_id. */
function row(taskId, toolCallId, overrides = {}) {
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
    task_id: taskId,
    tool_call_id: toolCallId,
    parent_call_id: '',
    granularity_tier: 'turn',
    reasoning_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    ...overrides,
  };
}

/** Insert rows via the REAL dedup writer, then close the writer handle (dual-writer discipline). */
function seedRows(dbPath, rows) {
  const db = openTokenDb(dbPath);
  try {
    for (const r of rows) insertTokenRowDeduped(db, r);
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Behavior 1: per-task_id DISJOINT aggregation — no cross-task bleed (AVN-06, Pitfall 2)
// ---------------------------------------------------------------------------

test('AVN-06: aggregateByTaskId returns DISJOINT sums for origin + two avenues (no bleed, Pitfall 2)', () => {
  const { dir, dbPath } = makeMainTokenDb();
  try {
    const ORIGIN = 'exp-abc--claude-sonnet-straight-kb-on--r0';
    const AVENUE_1 = 'exp-abc--claude-opus-straight-kb-on--r0';   // unique task_id per avenue (composeTaskId)
    const AVENUE_2 = 'exp-abc--opencode-default-tdd-kb-off--r0';

    seedRows(dbPath, [
      // ORIGIN: 2 rows → 120 + 300 = 420
      row(ORIGIN, 'o-tc-1', { total_tokens: 120 }),
      row(ORIGIN, 'o-tc-2', { total_tokens: 300 }),
      // AVENUE_1: 1 row → 500
      row(AVENUE_1, 'a1-tc-1', { total_tokens: 500 }),
      // AVENUE_2: 3 rows → 10 + 20 + 30 = 60
      row(AVENUE_2, 'a2-tc-1', { total_tokens: 10 }),
      row(AVENUE_2, 'a2-tc-2', { total_tokens: 20 }),
      row(AVENUE_2, 'a2-tc-3', { total_tokens: 30 }),
    ]);

    const origin = aggregateByTaskId(ORIGIN, dbPath);
    const av1 = aggregateByTaskId(AVENUE_1, dbPath);
    const av2 = aggregateByTaskId(AVENUE_2, dbPath);

    assert.equal(origin.totals.total_tokens, 420, 'origin sum is disjoint — no avenue tokens bleed in');
    assert.equal(origin.totals.calls, 2, 'origin call count is only its own rows');
    assert.equal(av1.totals.total_tokens, 500, 'avenue-1 sum is only its own rows');
    assert.equal(av1.totals.calls, 1);
    assert.equal(av2.totals.total_tokens, 60, 'avenue-2 sum is only its own rows');
    assert.equal(av2.totals.calls, 3);

    // No cross-avenue collision: the three totals are mutually distinct and sum to the grand total.
    assert.equal(
      origin.totals.total_tokens + av1.totals.total_tokens + av2.totals.total_tokens,
      420 + 500 + 60,
      'disjoint partition — the three task_ids never share a row',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Behavior 2: merge-on-cache dedup = NO second row (no double-count); distinct id = new row
// ---------------------------------------------------------------------------

test('AVN-06: insertTokenRowDeduped merge-on-cache enriches in place — no double-count (Pitfall 2)', () => {
  const { dir, dbPath } = makeMainTokenDb();
  try {
    const TASK = 'exp-dedup--claude-opus-straight-kb-on--r0';
    const db = openTokenDb(dbPath);
    try {
      // First: a cache-LESS row for (cladpt, tc-1).
      const first = insertTokenRowDeduped(db, row(TASK, 'tc-1', { cache_read_tokens: 0, cache_write_tokens: 0 }));
      assert.equal(first, true, 'first insert lands');
      // Second: the SAME (user_hash, tool_call_id) but now cache-bearing → enrich in place, NOT a new row.
      const second = insertTokenRowDeduped(db, row(TASK, 'tc-1', { cache_read_tokens: 111, cache_write_tokens: 222 }));
      assert.equal(second, true, 'merge-on-cache returns true (enriched, not dropped)');

      // Exactly ONE row for tc-1 with the enriched cache split — no double-count.
      const rows = db.prepare(
        'SELECT cache_read_tokens, cache_write_tokens FROM token_usage WHERE user_hash = ? AND tool_call_id = ?',
      ).all(ADAPTER_USER_HASH_CLAUDE, 'tc-1');
      assert.equal(rows.length, 1, 'still exactly ONE row after the merge (no second row)');
      assert.equal(rows[0].cache_read_tokens, 111, 'cache_read enriched in place');
      assert.equal(rows[0].cache_write_tokens, 222, 'cache_write enriched in place');

      // A DISTINCT tool_call_id creates a distinct row.
      insertTokenRowDeduped(db, row(TASK, 'tc-2', { total_tokens: 999 }));
      const distinct = db.prepare(
        'SELECT COUNT(*) AS c FROM token_usage WHERE task_id = ?',
      ).get(TASK).c;
      assert.equal(distinct, 2, 'distinct tool_call_id → distinct row (tc-1 + tc-2)');
    } finally {
      db.close();
    }

    // And the aggregate reflects exactly the merged rows (120 + 999), never a doubled 120.
    const agg = aggregateByTaskId(TASK, dbPath);
    assert.equal(agg.totals.calls, 2, 'aggregate sees exactly two rows — the merge did not double-count');
    assert.equal(agg.totals.total_tokens, 120 + 999, 'summed totals reflect the two distinct rows only');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Behavior 3: post-prune SURVIVAL — measurement data outlives the branch (AVN-09)
// ---------------------------------------------------------------------------

test('AVN-06 + AVN-09: aggregate survives pruneAvenueBranch — measurement data outlives the branch', () => {
  const { dir, dbPath } = makeMainTokenDb();
  // A throwaway git repo so pruneAvenueBranch acts on a REAL worktree/branch (Plan 01).
  const repoRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'avenue-survive-repo-')));
  const git = (args, cwd = repoRoot) => spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 60_000 });
  try {
    git(['init', '--quiet']);
    git(['config', 'user.email', 'test@example.com']);
    git(['config', 'user.name', 'Avenue Test']);
    git(['config', 'commit.gpgsign', 'false']);
    fs.writeFileSync(path.join(repoRoot, 'README.md'), '# fixture\n');
    git(['add', 'README.md']);
    git(['commit', '--quiet', '-m', 'initial']);
    const sha = git(['rev-parse', 'HEAD']).stdout.trim();

    const AVENUE = 'exp-survive--claude-opus-straight-kb-on--r0';

    // The avenue's measurement rows land in the MAIN db (spanEnv → mainDataDir).
    seedRows(dbPath, [
      row(AVENUE, 's-tc-1', { total_tokens: 250 }),
      row(AVENUE, 's-tc-2', { total_tokens: 250 }),
    ]);

    // Create the avenue branch worktree, make a real code change, commit it onto the branch (D-04).
    const { worktree } = createAvenueBranch({ taskId: AVENUE, sha, repoRoot });
    fs.writeFileSync(path.join(worktree, 'avenue-change.txt'), 'avenue code change\n');
    commitAvenueWorktree({ worktree, message: `avenue: ${AVENUE}` });

    // Pre-prune aggregate.
    const before = aggregateByTaskId(AVENUE, dbPath);
    assert.equal(before.totals.total_tokens, 500, 'avenue totals present before prune');

    // Prune the avenue worktree + branch (AVN-09 on-demand teardown).
    const pruned = pruneAvenueBranch({ taskId: AVENUE, repoRoot });
    assert.equal(pruned.removed, true, 'worktree + branch removed');
    assert.ok(!fs.existsSync(avenueWorktreePath(AVENUE, repoRoot)), 'avenue worktree gone');

    // SURVIVAL: the MAIN token-usage.db is untouched by the prune (it touches ONLY the avenue
    // worktree/branch) — the avenue's totals are STILL fully aggregatable.
    const after = aggregateByTaskId(AVENUE, dbPath);
    assert.equal(after.totals.total_tokens, 500, 'AVN-09: measurement data outlives the pruned branch');
    assert.equal(after.totals.calls, 2, 'both avenue rows survive the prune');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Behavior 4: Pitfall-1 NEGATIVE — a sandbox-scoped span yields 0 tokens under its task_id
// ---------------------------------------------------------------------------

test('AVN-06: Pitfall-1 negative — an avenue span (wrongly) opened on a SANDBOX data dir aggregates to 0 tokens', () => {
  const { dir, dbPath } = makeMainTokenDb();
  // A SEPARATE sandbox data dir — the failure mode where the span was mis-pointed at the
  // sandbox .data (the pre-fix 0-token bug). Rows written there NEVER reach the MAIN db.
  const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avenue-sandbox-'));
  const sandboxDbDir = path.join(sandboxDir, '.data', 'llm-proxy');
  fs.mkdirSync(sandboxDbDir, { recursive: true });
  const sandboxDbPath = path.join(sandboxDbDir, 'token-usage.db');
  const s = new Database(sandboxDbPath);
  s.pragma('journal_mode = wal');
  s.exec(CREATE_TABLE_SQL);
  s.close();
  try {
    const AVENUE = 'exp-sandbox-bug--claude-opus-straight-kb-on--r0';

    // The BUG: the span's rows were written into the SANDBOX db, not MAIN.
    seedRows(sandboxDbPath, [
      row(AVENUE, 'bug-tc-1', { total_tokens: 777 }),
      row(AVENUE, 'bug-tc-2', { total_tokens: 777 }),
    ]);

    // Aggregating from MAIN (the store the dashboard/reconciliation actually read) → 0 tokens.
    // This is the documented, CAUGHT failure mode: a sandbox-scoped span is invisible to MAIN.
    const mainAgg = aggregateByTaskId(AVENUE, dbPath);
    assert.equal(mainAgg.totals.total_tokens, 0, 'Pitfall 1: sandbox-scoped span → 0 tokens under its task_id in MAIN');
    assert.equal(mainAgg.totals.calls, 0, 'no rows visible in MAIN — the negative that a regression would flip');
    assert.deepEqual(mainAgg.byAgentModel, [], 'no attribution groups from MAIN for a sandbox-scoped span');

    // Sanity: the rows DO exist — in the wrong (sandbox) db — so the assertion is about
    // WHERE the span wrote, not whether the writer works.
    const sandboxAgg = aggregateByTaskId(AVENUE, sandboxDbPath);
    assert.equal(sandboxAgg.totals.total_tokens, 1554, 'the rows landed in the sandbox db (the bug), proving the negative is real');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(sandboxDir, { recursive: true, force: true });
  }
});
