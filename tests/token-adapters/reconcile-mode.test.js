/**
 * tests/token-adapters/reconcile-mode.test.js
 *
 * Phase 83, Plan 83-04, Task 1 — unit tests for the reconcile branch of
 * `captureForegroundTokens` (lib/lsl/token/stop-adapter-registry.mjs).
 *
 * The reconcile branch (D-01) is the no-double-count contract in action: on a
 * MEASURED span (opts.reconcile === true) the blind `insertTokenRowDeduped` loop
 * is replaced by match-then-enrich-or-fallback via the Plan-03 matcher
 * (reconcile.mjs `reconcileRow`). The interactive Stop/sweep path (no reconcile)
 * keeps today's transcript + dedup-merge behavior BYTE-IDENTICALLY.
 *
 * Covers (matches PLAN <behavior> 1-7):
 *   1. dispatch          — reconcile:true → report OBJECT via reconcileRow;
 *                          no reconcile → insert count (NUMBER) via the old loop.
 *   2. match no-double   — a transcript row whose tool_call_id matches a wire row
 *                          enriches IN PLACE (zero net rows), report.matched===1.
 *   3. fallback          — a no-match transcript row inserts exactly ONE fallback
 *                          row tagged with a DISTINCT provenance marker; counts.
 *   4. :reason: always   — a :reason:N row inserts unconditionally (wire state
 *                          irrelevant — wire never carries a reasoning split).
 *   5. report shape      — { matched, unmatched_wire, unmatched_transcript,
 *                          fallback, perRequest:[{tool_call_id,method,deltas,
 *                          flagged}], flaggedCount }.
 *   6. stamp-only        — opencode/mastra still return 0 (guard preserved).
 *   7. unmatched_wire    — a span-window wire row with NO transcript counterpart
 *                          is counted via the POST-LOOP DB query; all-matched → 0.
 *
 * Plus a copilot D-04 cache-merge check (session-state split → matched wire row
 * still lacking cache, gap-fill only, never overwrite).
 *
 * Run: node --test tests/token-adapters/reconcile-mode.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const { captureForegroundTokens } = await import(
  '../../lib/lsl/token/stop-adapter-registry.mjs'
);

/** The span window every fixture / wire row is timestamped inside. */
const STARTED_AT = '2026-06-29T05:29:00.000Z';
const ENDED_AT = '2026-06-29T05:35:00.000Z';
const IN_WINDOW_TS = '2026-06-29T05:31:00.000Z';

/**
 * token_usage shape (token-db.mjs INSERT_SQL columns) INCLUDING the two cache
 * columns so wire rows can be pre-seeded with a known cache split. openTokenDb's
 * ensureCacheColumns re-adds them idempotently (duplicate-column swallowed).
 */
const CREATE_TABLE_SQL = `CREATE TABLE token_usage (
  id INTEGER NOT NULL,
  timestamp TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  process TEXT NOT NULL DEFAULT '',
  subscription TEXT NOT NULL DEFAULT '',
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  prompt_preview TEXT NOT NULL DEFAULT '',
  tokens_estimated INTEGER NOT NULL DEFAULT 0,
  user_hash TEXT NOT NULL DEFAULT '',
  model_raw TEXT NOT NULL DEFAULT '',
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

function newTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reconcile-mode-test-'));
  const dbPath = path.join(dir, 'token-usage.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = wal');
  db.exec(CREATE_TABLE_SQL);
  db.close();
  return { dir, dbPath };
}

/**
 * Seed one authoritative WIRE row (the proxy-tap row). The default user_hash is
 * `cladpt` — the PRODUCTION shape: for claude the proxy tap stamps the SAME hash
 * the transcript adapter uses (server.mjs:2217), so wire and transcript rows are
 * indistinguishable by user_hash OR process — only the PK separates them (CR-02).
 * The old default `wire01` (a hash the production tap never writes for claude)
 * MASKED CR-02 — the broken `user_hash != 'cladpt'` unmatched-wire query passed
 * vacuously. Callers may still override user_hash (e.g. copilot → wire02).
 */
function seedWireRow(dbPath, overrides = {}) {
  const db = new Database(dbPath);
  try {
    const userHash = overrides.user_hash ?? 'cladpt';
    const next = db
      .prepare('SELECT COALESCE(MAX(id),0)+1 AS n FROM token_usage WHERE user_hash = ?')
      .get(userHash).n;
    const row = {
      id: next,
      timestamp: IN_WINDOW_TS,
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      process: 'proxy-tap',
      subscription: '',
      input_tokens: 100,
      output_tokens: 20,
      total_tokens: 120,
      latency_ms: 0,
      prompt_preview: '',
      tokens_estimated: 0,
      user_hash: userHash,
      model_raw: 'claude-opus-4-8',
      overhead_ms: null,
      agent: 'claude',
      task_id: 'recon-task',
      tool_call_id: 'req-x',
      parent_call_id: '',
      granularity_tier: 'per-turn',
      reasoning_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      ...overrides,
    };
    db.prepare(
      `INSERT INTO token_usage (
        id, timestamp, provider, model, process, subscription,
        input_tokens, output_tokens, total_tokens, latency_ms,
        prompt_preview, tokens_estimated, user_hash, model_raw, overhead_ms,
        agent, task_id, tool_call_id, parent_call_id, granularity_tier,
        reasoning_tokens, cache_read_tokens, cache_write_tokens
      ) VALUES (@id,@timestamp,@provider,@model,@process,@subscription,
        @input_tokens,@output_tokens,@total_tokens,@latency_ms,
        @prompt_preview,@tokens_estimated,@user_hash,@model_raw,@overhead_ms,
        @agent,@task_id,@tool_call_id,@parent_call_id,@granularity_tier,
        @reasoning_tokens,@cache_read_tokens,@cache_write_tokens)`,
    ).run(row);
  } finally {
    db.close();
  }
}

/** Write a Claude session-JSONL fixture (buildClaudeTokenRows input). */
function writeClaudeFixture(dir, records) {
  const p = path.join(dir, `session-${Math.random().toString(36).slice(2)}.jsonl`);
  fs.writeFileSync(p, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return p;
}

/** A minimal Claude assistant turn record for a given requestId. */
function claudeTurn(requestId, usage = {}, content = []) {
  return {
    type: 'assistant',
    requestId,
    uuid: requestId,
    timestamp: IN_WINDOW_TS,
    message: {
      model: 'claude-opus-4-8',
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        ...usage,
      },
      content,
    },
  };
}

function claudeSpan(overrides = {}) {
  return {
    task_id: 'recon-task',
    agent: 'claude',
    started_at: STARTED_AT,
    ended_at: ENDED_AT,
    ...overrides,
  };
}

function readAll(dbPath) {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db
      .prepare(
        'SELECT user_hash, task_id, process, tool_call_id, cache_read_tokens, cache_write_tokens FROM token_usage',
      )
      .all();
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Test 1 — dispatch: reconcile → report object; no reconcile → insert count.
// ---------------------------------------------------------------------------
test('dispatch: reconcile:true returns a report object; no reconcile returns an insert count', async () => {
  // (a) Interactive path (no reconcile) — the old insertTokenRowDeduped loop,
  //     returns a NUMBER, inserts a cladpt row.
  {
    const { dir, dbPath } = newTempDb();
    try {
      const fixture = writeClaudeFixture(dir, [claudeTurn('req-x')]);
      const result = await captureForegroundTokens(claudeSpan(), {
        dbPath,
        mainSessionPath: fixture,
        resolveTaskId: async () => 'recon-task',
      });
      assert.equal(typeof result, 'number', 'interactive path returns an insert count');
      assert.equal(result, 1, 'one cladpt row inserted by the blind loop');
      const rows = readAll(dbPath);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].user_hash, 'cladpt');
      assert.equal(rows[0].process, 'token-adapter-claude', 'normal provenance, not a fallback tag');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  // (b) Measured path (reconcile:true) — routes through reconcileRow, returns a
  //     REPORT OBJECT.
  {
    const { dir, dbPath } = newTempDb();
    try {
      const fixture = writeClaudeFixture(dir, [claudeTurn('req-x')]);
      const report = await captureForegroundTokens(claudeSpan(), {
        dbPath,
        reconcile: true,
        mainSessionPath: fixture,
        resolveTaskId: async () => 'recon-task',
      });
      assert.equal(typeof report, 'object', 'reconcile path returns a report object');
      assert.ok(report && 'matched' in report, 'report carries a matched field');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

// ---------------------------------------------------------------------------
// Test 2 — match: enrich in place, ZERO net rows (no double-count).
// ---------------------------------------------------------------------------
test('match: a matched transcript row enriches the wire row in place (zero net rows, report.matched=1)', async () => {
  const { dir, dbPath } = newTempDb();
  try {
    // Wire row with NO cache; the transcript carries the cache split.
    seedWireRow(dbPath, { tool_call_id: 'req-match', cache_read_tokens: 0, cache_write_tokens: 0 });
    const fixture = writeClaudeFixture(dir, [
      claudeTurn('req-match', { cache_read_input_tokens: 11, cache_creation_input_tokens: 22 }),
    ]);

    const report = await captureForegroundTokens(claudeSpan(), {
      dbPath,
      reconcile: true,
      mainSessionPath: fixture,
      resolveTaskId: async () => 'recon-task',
    });

    const rows = readAll(dbPath);
    assert.equal(rows.length, 1, 'no second row inserted — the wire row was enriched in place');
    assert.equal(rows[0].tool_call_id, 'req-match');
    assert.equal(rows[0].cache_read_tokens, 11, 'wire-empty cache filled from the transcript (D-04)');
    assert.equal(rows[0].cache_write_tokens, 22);
    assert.equal(report.matched, 1);
    assert.equal(report.fallback, 0);
    assert.equal(report.unmatched_transcript, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 3 — fallback: no-match → one fallback row with DISTINCT provenance.
// ---------------------------------------------------------------------------
test('fallback: a no-match transcript row inserts one fallback row tagged with distinct provenance', async () => {
  const { dir, dbPath } = newTempDb();
  try {
    // No wire row for req-nomatch.
    const fixture = writeClaudeFixture(dir, [claudeTurn('req-nomatch')]);
    const report = await captureForegroundTokens(claudeSpan(), {
      dbPath,
      reconcile: true,
      mainSessionPath: fixture,
      resolveTaskId: async () => 'recon-task',
    });

    const rows = readAll(dbPath);
    assert.equal(rows.length, 1, 'exactly one fallback row inserted');
    assert.equal(rows[0].tool_call_id, 'req-nomatch');
    assert.equal(rows[0].user_hash, 'cladpt');
    assert.equal(
      rows[0].process,
      'token-adapter-claude-fallback',
      'fallback rows carry a DISTINCT provenance marker',
    );
    assert.notEqual(rows[0].process, 'token-adapter-claude', 'distinct from the normal adapter process');
    assert.equal(report.unmatched_transcript, 1);
    assert.equal(report.fallback, 1);
    assert.equal(report.matched, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 4 — :reason:N always inserts, regardless of wire state.
// ---------------------------------------------------------------------------
test(':reason:N row inserts unconditionally regardless of wire state', async () => {
  const { dir, dbPath } = newTempDb();
  try {
    // Seed a wire row that shares the reasoning-step tool_call_id — the reason
    // row must STILL insert its own cladpt row (wire never carries a reasoning
    // split, so it is an expected always-insert, not a match). Pin a DISTINCT
    // user_hash ('wire01') so the always-inserted cladpt reason row does NOT
    // dedup-collide with this seeded row — the two must be observable as 2 rows.
    // (In production the wire never carries a :reason: tool_call_id at all, so
    // this shared-id fixture is a deliberate "even if" isolation check.)
    seedWireRow(dbPath, { user_hash: 'wire01', tool_call_id: 'req-r:reason:0', cache_read_tokens: 9, cache_write_tokens: 9 });

    const fixture = writeClaudeFixture(dir, [
      claudeTurn('req-r', {}, [{ type: 'thinking', thinking: 'a genuinely long reasoning trace to estimate tokens from' }]),
    ]);
    await captureForegroundTokens(claudeSpan(), {
      dbPath,
      reconcile: true,
      mainSessionPath: fixture,
      resolveTaskId: async () => 'recon-task',
    });

    const rows = readAll(dbPath);
    const reasonRows = rows.filter((r) => r.tool_call_id === 'req-r:reason:0');
    // The seeded wire row (wire01) PLUS the always-inserted cladpt reason row.
    assert.ok(
      reasonRows.some((r) => r.user_hash === 'cladpt'),
      'the :reason:N row was inserted as its own cladpt row (always-insert)',
    );
    assert.equal(reasonRows.length, 2, 'wire row untouched + a new cladpt reason row');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 5 — report shape.
// ---------------------------------------------------------------------------
test('report shape: matched/unmatched_wire/unmatched_transcript/fallback/perRequest/flaggedCount', async () => {
  const { dir, dbPath } = newTempDb();
  try {
    seedWireRow(dbPath, { tool_call_id: 'req-match' });
    const fixture = writeClaudeFixture(dir, [
      claudeTurn('req-match'),
      claudeTurn('req-nomatch'),
    ]);
    const report = await captureForegroundTokens(claudeSpan(), {
      dbPath,
      reconcile: true,
      mainSessionPath: fixture,
      resolveTaskId: async () => 'recon-task',
    });

    for (const key of ['matched', 'unmatched_wire', 'unmatched_transcript', 'fallback', 'flaggedCount']) {
      assert.equal(typeof report[key], 'number', `report.${key} is a number`);
    }
    assert.ok(Array.isArray(report.perRequest), 'report.perRequest is an array');
    assert.equal(report.perRequest.length, 2, 'one entry per processed transcript row');
    for (const entry of report.perRequest) {
      assert.ok('tool_call_id' in entry, 'perRequest entry has tool_call_id');
      assert.ok('method' in entry, 'perRequest entry has method');
      assert.equal(typeof entry.deltas, 'object', 'perRequest entry has a deltas object');
      assert.equal(typeof entry.flagged, 'boolean', 'perRequest entry has a flagged boolean');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test 6 — stamp-only agents untouched (guard preserved) even with reconcile.
// ---------------------------------------------------------------------------
test('stamp-only: opencode/mastra return 0 even with reconcile:true (double-count guard preserved)', async () => {
  for (const agent of ['opencode', 'mastra']) {
    const { dir, dbPath } = newTempDb();
    try {
      const fixture = writeClaudeFixture(dir, [claudeTurn('req-x')]);
      const result = await captureForegroundTokens(claudeSpan({ agent }), {
        dbPath,
        reconcile: true,
        mainSessionPath: fixture,
        resolveTaskId: async () => 'recon-task',
      });
      assert.equal(result, 0, `${agent} does ZERO transcript work (proxy-routed)`);
      assert.equal(readAll(dbPath).length, 0, `${agent} inserted nothing`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

// ---------------------------------------------------------------------------
// Test 7 — unmatched_wire via POST-LOOP DB query (never defaulted to 0).
// ---------------------------------------------------------------------------
test('unmatched_wire: an orphan span-window wire row is counted; all-matched yields 0', async () => {
  // Scenario A: two wire rows, only req-a has a transcript counterpart → orphan.
  {
    const { dir, dbPath } = newTempDb();
    try {
      seedWireRow(dbPath, { tool_call_id: 'req-a' });
      seedWireRow(dbPath, { tool_call_id: 'req-b' });
      const fixture = writeClaudeFixture(dir, [claudeTurn('req-a')]);
      const report = await captureForegroundTokens(claudeSpan(), {
        dbPath,
        reconcile: true,
        mainSessionPath: fixture,
        resolveTaskId: async () => 'recon-task',
      });
      assert.equal(report.matched, 1);
      assert.equal(report.unmatched_wire, 1, 'req-b wire row has no transcript counterpart → counted');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  // Scenario B: every wire row matched → unmatched_wire === 0 (Plan-07 property 3).
  {
    const { dir, dbPath } = newTempDb();
    try {
      seedWireRow(dbPath, { tool_call_id: 'req-a' });
      seedWireRow(dbPath, { tool_call_id: 'req-b' });
      const fixture = writeClaudeFixture(dir, [claudeTurn('req-a'), claudeTurn('req-b')]);
      const report = await captureForegroundTokens(claudeSpan(), {
        dbPath,
        reconcile: true,
        mainSessionPath: fixture,
        resolveTaskId: async () => 'recon-task',
      });
      assert.equal(report.matched, 2);
      assert.equal(report.unmatched_wire, 0, 'every wire row matched → 0, not a silent default');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

// ---------------------------------------------------------------------------
// CR-02 (Plan 83-08) — unmatched_wire counts a PRODUCTION-shape cladpt orphan.
// The old query excluded user_hash='cladpt' (the exact hash the claude tap
// stamps), making unmatched_wire structurally 0. The PK-snapshot approach counts
// by row identity, so a genuine cladpt orphan wire row is now >= 1.
// ---------------------------------------------------------------------------
test('CR-02/unmatched_wire: a production-shape cladpt orphan wire row is counted (1); all-matched → 0', async () => {
  // Scenario A: two cladpt wire rows (production tap shape); only req-m has a
  // transcript counterpart → req-o is a genuine orphan.
  {
    const { dir, dbPath } = newTempDb();
    try {
      seedWireRow(dbPath, { user_hash: 'cladpt', tool_call_id: 'req-m' });
      seedWireRow(dbPath, { user_hash: 'cladpt', tool_call_id: 'req-o' });
      const fixture = writeClaudeFixture(dir, [claudeTurn('req-m')]);
      const report = await captureForegroundTokens(claudeSpan(), {
        dbPath,
        reconcile: true,
        mainSessionPath: fixture,
        resolveTaskId: async () => 'recon-task',
      });
      assert.equal(report.matched, 1);
      assert.equal(
        report.unmatched_wire,
        1,
        'cladpt orphan wire row counted by PK snapshot (not excluded by user_hash)',
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  // Scenario B: both cladpt wire rows matched → healthy span reports 0.
  {
    const { dir, dbPath } = newTempDb();
    try {
      seedWireRow(dbPath, { user_hash: 'cladpt', tool_call_id: 'req-m' });
      seedWireRow(dbPath, { user_hash: 'cladpt', tool_call_id: 'req-o' });
      const fixture = writeClaudeFixture(dir, [claudeTurn('req-m'), claudeTurn('req-o')]);
      const report = await captureForegroundTokens(claudeSpan(), {
        dbPath,
        reconcile: true,
        mainSessionPath: fixture,
        resolveTaskId: async () => 'recon-task',
      });
      assert.equal(report.matched, 2);
      assert.equal(report.unmatched_wire, 0, 'every cladpt wire row matched → 0, not vacuous');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

// ---------------------------------------------------------------------------
// CR-02b (Plan 83-08) — a cladpt FALLBACK row inserted DURING the loop is NOT
// miscounted as an orphan wire row (it post-dates the pre-loop snapshot).
// ---------------------------------------------------------------------------
test('CR-02/fallback-not-counted: a loop-inserted cladpt fallback row is not counted as unmatched wire', async () => {
  const { dir, dbPath } = newTempDb();
  try {
    // One matched cladpt wire row; the transcript also has a no-match turn whose
    // cladpt fallback row is inserted DURING the loop (post-snapshot). The no-match
    // turn uses a DISTINCT model so it cannot fuzzy-match the sole wire candidate.
    seedWireRow(dbPath, { user_hash: 'cladpt', tool_call_id: 'req-m' });
    const otherModelTurn = {
      type: 'assistant',
      requestId: 'req-fallback',
      uuid: 'req-fallback',
      timestamp: IN_WINDOW_TS,
      message: {
        model: 'some-other-model',
        usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        content: [],
      },
    };
    const fixture = writeClaudeFixture(dir, [claudeTurn('req-m'), otherModelTurn]);
    const report = await captureForegroundTokens(claudeSpan(), {
      dbPath,
      reconcile: true,
      mainSessionPath: fixture,
      resolveTaskId: async () => 'recon-task',
    });
    assert.equal(report.matched, 1);
    assert.equal(report.fallback, 1, 'the no-match turn inserted one cladpt fallback row');
    assert.equal(
      report.unmatched_wire,
      0,
      'the loop-inserted fallback cladpt row post-dates the snapshot → not an orphan wire row',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// CR-03 (Plan 83-08) — reconcile gap-fill backfills the span task_id onto a
// matched wire row whose task_id is '' (interactive-launch, blank x-task-id per
// D-08). A pre-bound (non-empty task_id) wire row is NEVER overwritten. This is a
// span-scoped stamp on an already-matched transcript row — NOT ambient inheritance.
// ---------------------------------------------------------------------------
test("CR-03/task_id gap-fill: a matched task_id='' wire row is stamped the span task_id; a pre-bound row is untouched", async () => {
  const { dir, dbPath } = newTempDb();
  try {
    // (a) production-shape cladpt wire row with a BLANK task_id (interactive launch).
    seedWireRow(dbPath, {
      user_hash: 'cladpt',
      tool_call_id: 'req-blank',
      task_id: '',
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      input_tokens: 111,
      output_tokens: 22,
    });
    // (b) a wire row ALREADY bound to a different task — must never be overwritten.
    seedWireRow(dbPath, {
      user_hash: 'cladpt',
      tool_call_id: 'req-bound',
      task_id: 'other-task',
      cache_read_tokens: 5,
      cache_write_tokens: 7,
      input_tokens: 200,
      output_tokens: 40,
    });

    const fixture = writeClaudeFixture(dir, [claudeTurn('req-blank'), claudeTurn('req-bound')]);
    await captureForegroundTokens(claudeSpan(), {
      dbPath,
      reconcile: true,
      mainSessionPath: fixture,
      resolveTaskId: async () => 'recon-task',
    });

    const db = new Database(dbPath, { readonly: true });
    try {
      const blank = db
        .prepare(
          'SELECT task_id, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens FROM token_usage WHERE tool_call_id = ?',
        )
        .get('req-blank');
      assert.equal(blank.task_id, 'recon-task', "blank task_id wire row stamped with the span task_id");
      // Wire token counts NOT altered by the task_id backfill.
      assert.equal(blank.input_tokens, 111, 'wire input_tokens unchanged by the task_id backfill');
      assert.equal(blank.output_tokens, 22);

      // aggregateByTaskId(span.task_id) now recovers the previously-blank wire row.
      const recovered = db
        .prepare('SELECT SUM(input_tokens) AS s FROM token_usage WHERE task_id = ?')
        .get('recon-task').s;
      assert.ok(recovered >= 111, 'foreground tokens recovered under the span task_id');

      const bound = db
        .prepare('SELECT task_id, cache_read_tokens, cache_write_tokens FROM token_usage WHERE tool_call_id = ?')
        .get('req-bound');
      assert.equal(bound.task_id, 'other-task', 'a pre-bound wire row keeps its task_id (never overwritten)');
      assert.equal(bound.cache_read_tokens, 5, 'wire cache unchanged by the task_id backfill');
      assert.equal(bound.cache_write_tokens, 7);
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// D-04 — copilot session-state cache split → matched wire row still lacking cache.
// ---------------------------------------------------------------------------
test('copilot D-04: injected session-state cache split fills a matched wire row lacking cache (gap-fill only)', async () => {
  const { dir, dbPath } = newTempDb();
  try {
    // A copilot per-session-aggregate row matches a wire row by request-id here
    // (tool_call_id shared for the test); the wire row is cache-less. Copilot
    // events.jsonl → one aggregate row via buildCopilotTokenRows.
    seedWireRow(dbPath, {
      tool_call_id: 'sess-1:claude-sonnet-4.6',
      user_hash: 'wire02',
      model: 'claude-sonnet-4.6',
      cache_read_tokens: 0,
      cache_write_tokens: 0,
    });
    // Also a wire row that ALREADY carries cache — must NOT be overwritten.
    seedWireRow(dbPath, {
      tool_call_id: 'sess-1:already-cached',
      user_hash: 'wire02',
      cache_read_tokens: 500,
      cache_write_tokens: 700,
    });

    const events = path.join(dir, 'events.jsonl');
    fs.writeFileSync(
      events,
      [
        { type: 'session.start', timestamp: '2026-06-29T05:30:00.000Z', data: { sessionId: 'sess-1' } },
        {
          type: 'session.shutdown',
          timestamp: IN_WINDOW_TS,
          data: { modelMetrics: { 'claude-sonnet-4.6': { usage: { inputTokens: 100, outputTokens: 20 } } } },
        },
      ].map((o) => JSON.stringify(o)).join('\n') + '\n',
    );

    const report = await captureForegroundTokens(
      { task_id: 'recon-task', agent: 'copilot', started_at: STARTED_AT, ended_at: ENDED_AT },
      {
        dbPath,
        reconcile: true,
        mainSessionPath: events,
        resolveTaskId: async () => 'recon-task',
        // Injected precise per-wire-row cache split (D-04). Applies gap-fill ONLY
        // to matched wire rows that are still cache-less.
        copilotCacheSplit: {
          'sess-1:claude-sonnet-4.6': { cache_read_tokens: 333, cache_write_tokens: 444 },
          'sess-1:already-cached': { cache_read_tokens: 999, cache_write_tokens: 999 },
        },
      },
    );

    assert.equal(typeof report, 'object', 'copilot reconcile returns a report');
    const db = new Database(dbPath, { readonly: true });
    try {
      const filled = db
        .prepare('SELECT cache_read_tokens, cache_write_tokens FROM token_usage WHERE tool_call_id = ? AND user_hash = ?')
        .get('sess-1:claude-sonnet-4.6', 'wire02');
      assert.equal(filled.cache_read_tokens, 333, 'cache-less matched wire row filled from session-state');
      assert.equal(filled.cache_write_tokens, 444);

      const untouched = db
        .prepare('SELECT cache_read_tokens, cache_write_tokens FROM token_usage WHERE tool_call_id = ? AND user_hash = ?')
        .get('sess-1:already-cached', 'wire02');
      assert.equal(untouched.cache_read_tokens, 500, 'already-cached wire row NEVER overwritten (D-04)');
      assert.equal(untouched.cache_write_tokens, 700);
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
