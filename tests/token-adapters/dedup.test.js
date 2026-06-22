/**
 * tests/token-adapters/dedup.test.js
 *
 * Phase 69, Plan 69-05, Task 2 — completed-session sweep emission dedup +
 * reused timestamp-join backfill.
 *
 * Covers:
 *   1. Live/sweep dedup (Pitfall 4): build rows from the Wave-0 fixture, insert
 *      them once (simulating live capture), then run the sweep emission path
 *      (build → dedup probe `(user_hash, tool_call_id)` → insert) over the SAME
 *      fixture into the SAME temp DB. The total row count does NOT increase —
 *      every tool_call_id appears exactly once.
 *   2. Dedup-key precondition (OQ-3): every dedup-fixture assistant record
 *      yields a NON-EMPTY tool_call_id (requestId `req_<...>`, or the
 *      `?? uuid ?? ''` fallback) — so the `(user_hash, tool_call_id)` dedup key
 *      is never the empty string for a real turn. An empty key fails the test
 *      rather than silently collapsing all turns into one dedup bucket.
 *   3. Reused backfill: runSweep (imported from backfill-task-id-by-timestamp,
 *      NOT re-implemented) against a temp DB with one archived span stamps the
 *      adapter rows' task_id for in-window timestamps and leaves out-of-window
 *      rows at ''.
 *
 * The emission path mirrors sweep-sub-agents.mjs verbatim: build rows, set the
 * adapter user_hash + task_id='', dedup via the parameterized
 * `SELECT 1 ... LIMIT 1` probe, insert each survivor; then runSweep stamps.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'claude-session-sample.jsonl');

const { buildClaudeTokenRows } = await import(
  '../../lib/lsl/token/claude-token-rows.mjs'
);
const { openTokenDb, insertTokenRow, ADAPTER_USER_HASH_CLAUDE } = await import(
  '../../lib/lsl/token/token-db.mjs'
);
const { runSweep, loadArchivedSpans } = await import(
  '../../scripts/backfill-task-id-by-timestamp.mjs'
);

/** The full 21-column Phase-68 token_usage shape (order load-bearing). */
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

function makeTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dedup-db-'));
  const dbPath = path.join(dir, 'token-usage.db');
  const seed = new Database(dbPath);
  seed.pragma('journal_mode = wal');
  seed.exec(CREATE_TABLE_SQL);
  seed.close();
  return { dir, dbPath };
}

function ownedFixtureCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dedup-fx-'));
  const dst = path.join(dir, 'session.jsonl');
  fs.copyFileSync(FIXTURE, dst);
  return { dir, dst };
}

/**
 * The sweep emission path under test — mirrors
 * emitClaudeCompletedSessionTokenRows in scripts/sweep-sub-agents.mjs:
 * build → set user_hash + task_id='' → dedup probe → insert each survivor.
 * Returns { emitted, skipped }.
 */
function sweepEmit(db, jsonlPath) {
  const existsStmt = db.prepare(
    'SELECT 1 FROM token_usage WHERE user_hash = ? AND tool_call_id = ? LIMIT 1',
  );
  const rows = buildClaudeTokenRows(jsonlPath);
  let emitted = 0;
  let skipped = 0;
  for (const tokenRow of rows) {
    tokenRow.user_hash = ADAPTER_USER_HASH_CLAUDE;
    tokenRow.task_id = '';
    const hit = existsStmt.get(tokenRow.user_hash, tokenRow.tool_call_id);
    if (hit) {
      skipped += 1;
      continue;
    }
    if (insertTokenRow(db, tokenRow)) emitted += 1;
  }
  return { emitted, skipped };
}

test('OQ-3: every dedup-fixture assistant record yields a non-empty tool_call_id', () => {
  const { dir, dst } = ownedFixtureCopy();
  try {
    const rows = buildClaudeTokenRows(dst);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      // requestId (req_<...>) or the uuid fallback — never the empty string,
      // so the (user_hash, tool_call_id) dedup key never collapses turns.
      expect(typeof r.tool_call_id).toBe('string');
      expect(r.tool_call_id.length).toBeGreaterThan(0);
    }
    // The per-turn rows specifically carry the requestId verbatim.
    const perTurn = rows.filter((r) => r.granularity_tier === 'per-turn');
    expect(perTurn.map((r) => r.tool_call_id).sort()).toEqual([
      'req_TEST0001',
      'req_TEST0002',
      'req_TEST0003',
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a re-swept requestId is not double-inserted (live/sweep dedup, Pitfall 4)', () => {
  const { dir: fxDir, dst } = ownedFixtureCopy();
  const { dir: dbDir, dbPath } = makeTempDb();
  const db = openTokenDb(dbPath);
  try {
    // Simulate LIVE capture: insert every fixture row once.
    const liveRows = buildClaudeTokenRows(dst);
    for (const r of liveRows) {
      r.user_hash = ADAPTER_USER_HASH_CLAUDE;
      r.task_id = 'task-live';
      insertTokenRow(db, r);
    }
    const countAfterLive = db
      .prepare('SELECT COUNT(*) AS n FROM token_usage WHERE user_hash = ?')
      .get(ADAPTER_USER_HASH_CLAUDE).n;
    expect(countAfterLive).toBe(liveRows.length);

    // Now the SWEEP runs over the SAME session — every row is a dedup hit.
    const { emitted, skipped } = sweepEmit(db, dst);
    expect(emitted).toBe(0);
    expect(skipped).toBe(liveRows.length);

    const countAfterSweep = db
      .prepare('SELECT COUNT(*) AS n FROM token_usage WHERE user_hash = ?')
      .get(ADAPTER_USER_HASH_CLAUDE).n;
    expect(countAfterSweep).toBe(countAfterLive); // no increase

    // Each tool_call_id appears exactly once.
    const dupes = db
      .prepare(
        'SELECT tool_call_id, COUNT(*) AS n FROM token_usage WHERE user_hash = ? GROUP BY tool_call_id HAVING n > 1',
      )
      .all(ADAPTER_USER_HASH_CLAUDE);
    expect(dupes).toEqual([]);
  } finally {
    db.close();
    fs.rmSync(fxDir, { recursive: true, force: true });
    fs.rmSync(dbDir, { recursive: true, force: true });
  }
});

test('a never-before-seen session inserts all rows (dedup probe lets new keys through)', () => {
  const { dir: fxDir, dst } = ownedFixtureCopy();
  const { dir: dbDir, dbPath } = makeTempDb();
  const db = openTokenDb(dbPath);
  try {
    const expected = buildClaudeTokenRows(dst).length;
    const { emitted, skipped } = sweepEmit(db, dst);
    expect(emitted).toBe(expected);
    expect(skipped).toBe(0);
  } finally {
    db.close();
    fs.rmSync(fxDir, { recursive: true, force: true });
    fs.rmSync(dbDir, { recursive: true, force: true });
  }
});

test('reused runSweep stamps in-window task_id and leaves out-of-window rows at ""', () => {
  const { dir: fxDir, dst } = ownedFixtureCopy();
  const { dir: dbDir, dbPath } = makeTempDb();
  const db = openTokenDb(dbPath);
  try {
    // Emit completed-session rows with task_id='' (the sweep contract).
    sweepEmit(db, dst);

    // Insert one out-of-window adapter row at task_id='' to prove the join
    // leaves it untouched.
    const outOfWindow = {
      timestamp: '2026-06-22T23:59:00.000Z',
      provider: 'claude-code',
      model: 'claude-opus-4-8',
      model_raw: 'claude-opus-4-8',
      process: 'token-adapter-claude',
      subscription: '',
      input_tokens: 1,
      output_tokens: 1,
      total_tokens: 2,
      latency_ms: 0,
      prompt_preview: '',
      tokens_estimated: 0,
      reasoning_tokens: 0,
      overhead_ms: null,
      user_hash: ADAPTER_USER_HASH_CLAUDE,
      agent: 'claude',
      task_id: '',
      tool_call_id: 'req_OUTOFWINDOW',
      parent_call_id: '',
      granularity_tier: 'per-turn',
    };
    insertTokenRow(db, outOfWindow);

    // An archived span covering the fixture's window (10:00 — 10:03) but NOT
    // the 23:59 out-of-window row.
    const measurementsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dedup-spans-'));
    fs.writeFileSync(
      path.join(measurementsDir, 'span-A.json'),
      JSON.stringify({
        task_id: 'archived-span-A',
        started_at: '2026-06-22T09:30:00.000Z',
        ended_at: '2026-06-22T10:05:00.000Z',
      }),
    );

    try {
      const spans = loadArchivedSpans(measurementsDir);
      expect(spans.length).toBe(1);
      const { total } = runSweep(db, spans, false);
      expect(total).toBeGreaterThanOrEqual(3); // the in-window fixture rows

      // In-window rows now carry the span task_id.
      const inWindow = db
        .prepare(
          "SELECT DISTINCT task_id FROM token_usage WHERE user_hash = ? AND tool_call_id LIKE 'req_TEST%'",
        )
        .all(ADAPTER_USER_HASH_CLAUDE)
        .map((r) => r.task_id);
      expect(inWindow).toEqual(['archived-span-A']);

      // The out-of-window row is left unattributed.
      const ooW = db
        .prepare('SELECT task_id FROM token_usage WHERE tool_call_id = ?')
        .get('req_OUTOFWINDOW').task_id;
      expect(ooW).toBe('');
    } finally {
      fs.rmSync(measurementsDir, { recursive: true, force: true });
    }
  } finally {
    db.close();
    fs.rmSync(fxDir, { recursive: true, force: true });
    fs.rmSync(dbDir, { recursive: true, force: true });
  }
});
