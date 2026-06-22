/**
 * tests/token-adapters/copilot-wiring.test.js
 *
 * Phase 69, Plan 69-06, Task 1 — Copilot live session.shutdown token-row wiring.
 *
 * Proves the live-tail wiring contract (copilot-events-tail session.shutdown
 * branch → sub-agent-live-copilot supervisor onTokenRow): on a session.shutdown
 * event, build the per-session-aggregate rows from the session's events.jsonl
 * via buildCopilotTokenRows, stamp each row's task_id via the SINGLE span reader
 * (resolveLiveTaskIdSafe, D-03), set the distinct adapter user_hash
 * (ADAPTER_USER_HASH_COPILOT='copadt'), and insert into token-usage.db.
 *
 * Covers:
 *   1. With LLM_PROXY_DIST_DIR pointed at a stub exporting
 *      `resolveLiveTaskId: () => 'task-cop-1'`, the Wave-0 fixture's
 *      session.shutdown (two models in modelMetrics) yields TWO
 *      `per-session-aggregate` rows, each with `task_id === 'task-cop-1'`,
 *      `user_hash === 'copadt'`, `granularity_tier === 'per-session-aggregate'`.
 *   2. With the stub returning '' (no open span), every inserted row reads back
 *      with `task_id === ''` (out-of-window / no-span resolution rule).
 *
 * The emission path under test mirrors the supervisor's onTokenRow body in
 * scripts/sub-agent-live-copilot.mjs verbatim (build → stamp via
 * resolveLiveTaskIdSafe → set adapter user_hash → insert each, all inside
 * try/catch).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { jest } from '@jest/globals';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, 'fixtures', 'copilot-events-sample.jsonl');

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

/** Build a fresh temp DB with the token_usage shape. */
function makeTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-wiring-db-'));
  const dbPath = path.join(dir, 'token-usage.db');
  const seed = new Database(dbPath);
  seed.pragma('journal_mode = wal');
  seed.exec(CREATE_TABLE_SQL);
  seed.close();
  return { dir, dbPath };
}

/** Copy the fixture into an owned temp dir so the uid-check gate passes. */
function ownedFixtureCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-wiring-fx-'));
  const dst = path.join(dir, 'events.jsonl');
  fs.copyFileSync(FIXTURE, dst);
  return { dir, dst };
}

/** Write a temp dist dir whose measurement-span.js exports the given body. */
function makeStubDist(spanJs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-wiring-dist-'));
  fs.writeFileSync(path.join(dir, 'measurement-span.js'), spanJs, 'utf8');
  return dir;
}

/**
 * The onTokenRow emission path under test — mirrors the supervisor body in
 * scripts/sub-agent-live-copilot.mjs (build → stamp via resolveLiveTaskIdSafe →
 * set adapter user_hash → insert each), wrapped in try/catch so a thrown insert
 * never propagates.
 */
async function emitTokenRows({
  eventsPath,
  tokenDb,
  buildCopilotTokenRows,
  insertTokenRow,
  resolveLiveTaskIdSafe,
  ADAPTER_USER_HASH_COPILOT,
}) {
  try {
    const rows = buildCopilotTokenRows(eventsPath);
    if (!rows || rows.length === 0) return;
    const liveTaskId = await resolveLiveTaskIdSafe();
    for (const row of rows) {
      row.task_id = liveTaskId;
      row.user_hash = ADAPTER_USER_HASH_COPILOT;
      insertTokenRow(tokenDb, row);
    }
  } catch (err) {
    process.stderr.write(
      `[test] onTokenRow failed (non-fatal): ${err.message}\n`,
    );
  }
}

const origDistDir = process.env.LLM_PROXY_DIST_DIR;

afterEach(() => {
  if (origDistDir === undefined) delete process.env.LLM_PROXY_DIST_DIR;
  else process.env.LLM_PROXY_DIST_DIR = origDistDir;
});

test('session.shutdown emits two aggregate rows stamped with the live task_id', async () => {
  jest.resetModules();
  const distDir = makeStubDist(
    "module.exports = { resolveLiveTaskId: () => 'task-cop-1' };\n",
  );
  process.env.LLM_PROXY_DIST_DIR = distDir;
  const { dir: fxDir, dst } = ownedFixtureCopy();
  const { dir: dbDir, dbPath } = makeTempDb();

  const { buildCopilotTokenRows } = await import(
    '../../lib/lsl/token/copilot-token-rows.mjs'
  );
  const { openTokenDb, insertTokenRow, ADAPTER_USER_HASH_COPILOT } = await import(
    '../../lib/lsl/token/token-db.mjs'
  );
  const { resolveLiveTaskIdSafe } = await import('../../lib/lsl/token/task-id.mjs');

  const tokenDb = openTokenDb(dbPath);
  try {
    await emitTokenRows({
      eventsPath: dst,
      tokenDb,
      buildCopilotTokenRows,
      insertTokenRow,
      resolveLiveTaskIdSafe,
      ADAPTER_USER_HASH_COPILOT,
    });

    const rows = tokenDb
      .prepare(
        'SELECT task_id, user_hash, granularity_tier FROM token_usage WHERE user_hash = ?',
      )
      .all(ADAPTER_USER_HASH_COPILOT);

    // session.shutdown.modelMetrics has exactly two models → two aggregate rows.
    expect(rows.length).toBe(2);
    for (const r of rows) {
      expect(r.task_id).toBe('task-cop-1');
      expect(r.user_hash).toBe('copadt');
      expect(r.granularity_tier).toBe('per-session-aggregate');
    }
  } finally {
    tokenDb.close();
    fs.rmSync(distDir, { recursive: true, force: true });
    fs.rmSync(fxDir, { recursive: true, force: true });
    fs.rmSync(dbDir, { recursive: true, force: true });
  }
});

test('aggregate rows carry task_id="" when no span is open (reader returns "")', async () => {
  jest.resetModules();
  const distDir = makeStubDist(
    "module.exports = { resolveLiveTaskId: () => '' };\n",
  );
  process.env.LLM_PROXY_DIST_DIR = distDir;
  const { dir: fxDir, dst } = ownedFixtureCopy();
  const { dir: dbDir, dbPath } = makeTempDb();

  const { buildCopilotTokenRows } = await import(
    '../../lib/lsl/token/copilot-token-rows.mjs'
  );
  const { openTokenDb, insertTokenRow, ADAPTER_USER_HASH_COPILOT } = await import(
    '../../lib/lsl/token/token-db.mjs'
  );
  const { resolveLiveTaskIdSafe } = await import('../../lib/lsl/token/task-id.mjs');

  const tokenDb = openTokenDb(dbPath);
  try {
    await emitTokenRows({
      eventsPath: dst,
      tokenDb,
      buildCopilotTokenRows,
      insertTokenRow,
      resolveLiveTaskIdSafe,
      ADAPTER_USER_HASH_COPILOT,
    });

    const rows = tokenDb
      .prepare('SELECT task_id FROM token_usage WHERE user_hash = ?')
      .all(ADAPTER_USER_HASH_COPILOT);

    expect(rows.length).toBe(2);
    for (const r of rows) {
      expect(r.task_id).toBe('');
    }
  } finally {
    tokenDb.close();
    fs.rmSync(distDir, { recursive: true, force: true });
    fs.rmSync(fxDir, { recursive: true, force: true });
    fs.rmSync(dbDir, { recursive: true, force: true });
  }
});
