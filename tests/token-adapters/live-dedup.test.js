/**
 * tests/token-adapters/live-dedup.test.js
 *
 * Phase 69 code-review fix regression suite (CR-01 + CR-02).
 *
 * CR-01 — Claude live path inserted O(n²) duplicate rows. The live
 *   `onTokenRow({fullPath})` hook calls `buildClaudeTokenRows(fullPath)`, which
 *   re-reads the WHOLE JSONL and returns ALL rows, but the hook fires once per
 *   paired exchange. Without dedup, exchange 1's rows get re-inserted on every
 *   later exchange. The fix routes the live insert through the shared
 *   `insertTokenRowDeduped` (parameterized `(user_hash, tool_call_id)` probe).
 *   This test fires the live insert path 3+ times over the same growing fixture
 *   and asserts each distinct tool_call_id appears EXACTLY once.
 *
 *   IN-03 degeneracy guard: the fixture's assistant records all carry a
 *   non-empty requestId, so every tool_call_id is non-empty — the dedup key
 *   never collapses unrelated turns into one bucket. The test asserts this
 *   precondition explicitly.
 *
 * CR-02 — Copilot dedup key was not session-scoped: `tool_call_id = <model>`
 *   (bare model name), so the sweep dedup probe `WHERE user_hash='copadt' AND
 *   tool_call_id='<model>'` silently dropped every session after the first that
 *   used a given model. The fix makes the key `<sessionUuid>:<model>`. This test
 *   builds rows from TWO sessions (same model, different sessionId) and asserts
 *   BOTH survive the sweep dedup — two distinct (copadt, tool_call_id) rows.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLAUDE_FIXTURE = path.join(__dirname, 'fixtures', 'claude-session-sample.jsonl');
const COPILOT_FIXTURE = path.join(__dirname, 'fixtures', 'copilot-events-sample.jsonl');

const { buildClaudeTokenRows } = await import(
  '../../lib/lsl/token/claude-token-rows.mjs'
);
const { buildCopilotTokenRows } = await import(
  '../../lib/lsl/token/copilot-token-rows.mjs'
);
const {
  openTokenDb,
  insertTokenRow,
  insertTokenRowDeduped,
  ADAPTER_USER_HASH_CLAUDE,
  ADAPTER_USER_HASH_COPILOT,
} = await import('../../lib/lsl/token/token-db.mjs');

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-dedup-db-'));
  const dbPath = path.join(dir, 'token-usage.db');
  const seed = new Database(dbPath);
  seed.pragma('journal_mode = wal');
  seed.exec(CREATE_TABLE_SQL);
  seed.close();
  return { dir, dbPath };
}

function ownedCopy(srcPath, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-dedup-fx-'));
  const dst = path.join(dir, name);
  fs.copyFileSync(srcPath, dst);
  return { dir, dst };
}

/**
 * The live insert path under test — mirrors the onTokenRow hook in
 * sub-agent-live-claude.mjs: build ALL rows from the (re-read) file, stamp the
 * adapter user_hash + a live task_id, and insert each via the DEDUPED helper.
 */
function liveEmitClaude(db, jsonlPath, taskId) {
  const rows = buildClaudeTokenRows(jsonlPath);
  for (const row of rows) {
    row.task_id = taskId;
    row.user_hash = ADAPTER_USER_HASH_CLAUDE;
    insertTokenRowDeduped(db, row);
  }
  return rows.length;
}

test('CR-01: repeated live onTokenRow firings insert each tool_call_id exactly once (no O(n^2))', () => {
  const { dir: fxDir, dst } = ownedCopy(CLAUDE_FIXTURE, 'session.jsonl');
  const { dir: dbDir, dbPath } = makeTempDb();
  const db = openTokenDb(dbPath);
  try {
    // IN-03 precondition: every built row carries a non-empty tool_call_id, so
    // the dedup key never collapses unrelated turns into one empty bucket.
    const built = buildClaudeTokenRows(dst);
    expect(built.length).toBeGreaterThan(0);
    for (const r of built) {
      expect(typeof r.tool_call_id).toBe('string');
      expect(r.tool_call_id.length).toBeGreaterThan(0);
    }
    const distinctIds = new Set(built.map((r) => r.tool_call_id));

    // Simulate the live hook firing repeatedly over the SAME (growing) session.
    // Each firing re-reads the whole file and returns ALL rows — exactly the
    // condition that produced O(n^2) inflation before the dedup fix.
    liveEmitClaude(db, dst, 'task-live-1');
    liveEmitClaude(db, dst, 'task-live-2');
    liveEmitClaude(db, dst, 'task-live-3');
    liveEmitClaude(db, dst, 'task-live-4');

    // Total rows == number of distinct tool_call_ids (NOT 4x).
    const total = db
      .prepare('SELECT COUNT(*) AS n FROM token_usage WHERE user_hash = ?')
      .get(ADAPTER_USER_HASH_CLAUDE).n;
    expect(total).toBe(distinctIds.size);
    expect(total).toBe(built.length);

    // Each distinct tool_call_id appears EXACTLY once — no duplication.
    const dupes = db
      .prepare(
        'SELECT tool_call_id, COUNT(*) AS n FROM token_usage WHERE user_hash = ? GROUP BY tool_call_id HAVING n > 1',
      )
      .all(ADAPTER_USER_HASH_CLAUDE);
    expect(dupes).toEqual([]);

    // Per-turn (`base`) and per-reasoning-step (`base:reason:N`) rows are NOT
    // deduped against each other — both tiers survive.
    const tiers = db
      .prepare(
        'SELECT DISTINCT granularity_tier FROM token_usage WHERE user_hash = ? ORDER BY granularity_tier',
      )
      .all(ADAPTER_USER_HASH_CLAUDE)
      .map((r) => r.granularity_tier);
    expect(tiers).toContain('per-turn');
    expect(tiers).toContain('per-reasoning-step');
  } finally {
    db.close();
    fs.rmSync(fxDir, { recursive: true, force: true });
    fs.rmSync(dbDir, { recursive: true, force: true });
  }
});

test('CR-01: IN-03 empty tool_call_id rows are inserted, never collapsed by dedup', () => {
  const { dir: dbDir, dbPath } = makeTempDb();
  const db = openTokenDb(dbPath);
  try {
    const base = {
      timestamp: '2026-06-22T10:00:00.000Z',
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
      tool_call_id: '', // degenerate empty key (IN-03)
      parent_call_id: '',
      granularity_tier: 'per-turn',
    };
    // Two UNRELATED rows both with an empty tool_call_id must BOTH be inserted —
    // the dedup must NOT collapse them into one bucket.
    expect(insertTokenRowDeduped(db, { ...base })).toBe(true);
    expect(insertTokenRowDeduped(db, { ...base, input_tokens: 99 })).toBe(true);

    const n = db
      .prepare("SELECT COUNT(*) AS n FROM token_usage WHERE tool_call_id = ''")
      .get().n;
    expect(n).toBe(2);
  } finally {
    db.close();
    fs.rmSync(dbDir, { recursive: true, force: true });
  }
});

/**
 * The sweep emission path under test — mirrors emitCopilotCompletedSessionTokenRows
 * in scripts/sweep-sub-agents.mjs: build → set user_hash + task_id='' → dedup
 * probe `(user_hash, tool_call_id)` → insert each survivor.
 */
function sweepEmitCopilot(db, eventsPath) {
  const existsStmt = db.prepare(
    'SELECT 1 FROM token_usage WHERE user_hash = ? AND tool_call_id = ? LIMIT 1',
  );
  const rows = buildCopilotTokenRows(eventsPath);
  let emitted = 0;
  let skipped = 0;
  for (const tokenRow of rows) {
    tokenRow.user_hash = ADAPTER_USER_HASH_COPILOT;
    tokenRow.task_id = '';
    const hit = existsStmt.get(tokenRow.user_hash, tokenRow.tool_call_id);
    if (hit) {
      skipped += 1;
      continue;
    }
    if (insertTokenRow(db, tokenRow)) emitted += 1;
  }
  return { emitted, skipped, built: rows.length };
}

/**
 * Build a two-session Copilot events.jsonl pair from the fixture: same model
 * usage, but DIFFERENT session.start data.sessionId. Each gets its own
 * `<sessionId>/events.jsonl` layout so the dir-name fallback would also work.
 */
function makeCopilotSession(sessionId) {
  const raw = fs.readFileSync(COPILOT_FIXTURE, 'utf-8');
  const lines = raw.trim().split('\n').map((l) => JSON.parse(l));
  for (const evt of lines) {
    if (evt.type === 'session.start' && evt.data) {
      evt.data.sessionId = sessionId;
    }
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live-dedup-cop-'));
  const sessionDir = path.join(root, sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });
  const eventsPath = path.join(sessionDir, 'events.jsonl');
  fs.writeFileSync(eventsPath, lines.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return { root, eventsPath };
}

test('CR-02: two Copilot sessions on the same model both survive sweep dedup', () => {
  const SID_A = '11111111-1111-4000-a000-000000000001';
  const SID_B = '22222222-2222-4000-a000-000000000002';
  const a = makeCopilotSession(SID_A);
  const b = makeCopilotSession(SID_B);
  const { dir: dbDir, dbPath } = makeTempDb();
  const db = openTokenDb(dbPath);
  try {
    // Session A completes → sweep inserts its rows.
    const resA = sweepEmitCopilot(db, a.eventsPath);
    expect(resA.built).toBeGreaterThan(0);
    expect(resA.emitted).toBe(resA.built);
    expect(resA.skipped).toBe(0);

    // Session B (SAME model, DIFFERENT sessionId) completes → must NOT be dropped
    // by the dedup probe. Before the CR-02 fix the bare-model key collided and
    // every row of session B was skipped.
    const resB = sweepEmitCopilot(db, b.eventsPath);
    expect(resB.emitted).toBe(resB.built);
    expect(resB.skipped).toBe(0);

    // Both sessions' aggregate rows coexist: distinct (copadt, tool_call_id) keys.
    const total = db
      .prepare('SELECT COUNT(*) AS n FROM token_usage WHERE user_hash = ?')
      .get(ADAPTER_USER_HASH_COPILOT).n;
    expect(total).toBe(resA.built + resB.built);

    // The tool_call_ids are session-scoped: `<sessionUuid>:<model>`.
    const ids = db
      .prepare('SELECT DISTINCT tool_call_id FROM token_usage WHERE user_hash = ? ORDER BY tool_call_id')
      .all(ADAPTER_USER_HASH_COPILOT)
      .map((r) => r.tool_call_id);
    expect(ids.some((id) => id.startsWith(`${SID_A}:`))).toBe(true);
    expect(ids.some((id) => id.startsWith(`${SID_B}:`))).toBe(true);
    // No bare-model key leaked through.
    expect(ids.every((id) => id.includes(':'))).toBe(true);
  } finally {
    db.close();
    fs.rmSync(a.root, { recursive: true, force: true });
    fs.rmSync(b.root, { recursive: true, force: true });
    fs.rmSync(dbDir, { recursive: true, force: true });
  }
});

test('CR-02: sessionId falls back to the events-path parent dir when session.start is absent', () => {
  // Strip the session.start line to exercise the dir-name fallback.
  const raw = fs.readFileSync(COPILOT_FIXTURE, 'utf-8').trim().split('\n');
  const noStart = raw.filter((l) => !l.includes('"session.start"'));
  const SID = '33333333-3333-4000-a000-000000000003';
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live-dedup-cop-nostart-'));
  const sessionDir = path.join(root, SID);
  fs.mkdirSync(sessionDir, { recursive: true });
  const eventsPath = path.join(sessionDir, 'events.jsonl');
  fs.writeFileSync(eventsPath, noStart.join('\n') + '\n');
  try {
    const rows = buildCopilotTokenRows(eventsPath);
    expect(rows.length).toBeGreaterThan(0);
    // The dir-name (sessionId) is used for the natural key.
    for (const r of rows) {
      expect(r.tool_call_id.startsWith(`${SID}:`)).toBe(true);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
