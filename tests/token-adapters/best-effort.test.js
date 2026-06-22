/**
 * tests/token-adapters/best-effort.test.js
 *
 * Phase 69, Plan 69-06, Task 2 — the cross-adapter failure-isolation gate
 * (ROADMAP / VALIDATION final task). A single test file that certifies the D-08
 * best-effort guarantee END-TO-END across BOTH adapters: no malformed input,
 * locked DB, or broken dist path ever throws out of token ingestion.
 *
 * Four no-throw assertions:
 *   (a) buildClaudeTokenRows over a fixture containing a deliberately malformed
 *       JSONL line skips the bad line and still returns the good rows (no throw).
 *   (b) buildCopilotTokenRows over a malformed events line does the same.
 *   (c) insertTokenRow against a CLOSED/locked db returns false and does not
 *       throw.
 *   (d) resolveLiveTaskIdSafe against a broken dist path returns '' and does not
 *       throw.
 *
 * Together these prove that every failure path in the Phase-69 ingestion chain
 * (parse → resolve → insert) is fail-soft (best-effort), satisfying T-69-dos and
 * the locked D-08 discipline.
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

/**
 * Copy a fixture into an owned temp dir (uid gate passes) with a deliberately
 * malformed JSONL line injected after the first line.
 */
function ownedCopyWithMalformedLine(srcPath, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'best-effort-'));
  const dst = path.join(dir, name);
  const lines = fs.readFileSync(srcPath, 'utf8').split('\n').filter((l) => l.trim());
  // Inject a malformed (un-parseable) line in the middle of the good content.
  const injected = [lines[0], '{ this is not valid json at all ]]', ...lines.slice(1)];
  fs.writeFileSync(dst, injected.join('\n') + '\n', 'utf8');
  return { dir, dst };
}

test('(a) buildClaudeTokenRows skips a malformed JSONL line and returns good rows', async () => {
  const { buildClaudeTokenRows } = await import(
    '../../lib/lsl/token/claude-token-rows.mjs'
  );
  const { dir, dst } = ownedCopyWithMalformedLine(CLAUDE_FIXTURE, 'session.jsonl');
  try {
    let rows;
    expect(() => {
      rows = buildClaudeTokenRows(dst);
    }).not.toThrow();
    // The good assistant turns still produce rows despite the bad line.
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('(b) buildCopilotTokenRows skips a malformed events line and returns good rows', async () => {
  const { buildCopilotTokenRows } = await import(
    '../../lib/lsl/token/copilot-token-rows.mjs'
  );
  const { dir, dst } = ownedCopyWithMalformedLine(COPILOT_FIXTURE, 'events.jsonl');
  try {
    let rows;
    expect(() => {
      rows = buildCopilotTokenRows(dst);
    }).not.toThrow();
    // The session.shutdown aggregate (two models) survives the bad line.
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBe(2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('(c) insertTokenRow against a closed db returns false and does not throw', async () => {
  const { openTokenDb, insertTokenRow, ADAPTER_USER_HASH_COPILOT } = await import(
    '../../lib/lsl/token/token-db.mjs'
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'best-effort-db-'));
  const dbPath = path.join(dir, 'token-usage.db');
  const seed = new Database(dbPath);
  seed.pragma('journal_mode = wal');
  seed.exec(CREATE_TABLE_SQL);
  seed.close();

  const db = openTokenDb(dbPath);
  // Close the handle so any prepare/run on it fails — best-effort must catch.
  db.close();

  const row = {
    timestamp: '2026-06-22T11:02:00.000Z',
    agent: 'copilot',
    provider: 'copilot',
    process: 'token-adapter-copilot',
    model: 'claude-opus-4.6',
    model_raw: 'claude-opus-4.6',
    input_tokens: 100,
    output_tokens: 10,
    total_tokens: 110,
    latency_ms: 0,
    overhead_ms: null,
    prompt_preview: '',
    tokens_estimated: 0,
    reasoning_tokens: 0,
    user_hash: ADAPTER_USER_HASH_COPILOT,
    task_id: '',
    tool_call_id: 'claude-opus-4.6',
    parent_call_id: '',
    granularity_tier: 'per-session-aggregate',
  };

  try {
    let result;
    expect(() => {
      result = insertTokenRow(db, row);
    }).not.toThrow();
    expect(result).toBe(false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('(d) resolveLiveTaskIdSafe against a broken dist path returns "" and does not throw', async () => {
  const { resolveLiveTaskIdSafe } = await import('../../lib/lsl/token/task-id.mjs');
  const origDistDir = process.env.LLM_PROXY_DIST_DIR;
  // Point at a non-existent dist dir so the import fails — wrapper must catch.
  process.env.LLM_PROXY_DIST_DIR = path.join(
    os.tmpdir(),
    `nonexistent-dist-${Date.now()}`,
  );
  try {
    let value;
    await expect(
      (async () => {
        value = await resolveLiveTaskIdSafe();
      })(),
    ).resolves.toBeUndefined();
    expect(value).toBe('');
  } finally {
    if (origDistDir === undefined) delete process.env.LLM_PROXY_DIST_DIR;
    else process.env.LLM_PROXY_DIST_DIR = origDistDir;
  }
});
