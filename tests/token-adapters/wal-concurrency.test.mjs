#!/usr/bin/env node
/**
 * WAL-concurrency acceptance test (Phase 69, Plan 69-01, Task 1 — D-07 guardrail).
 *
 * The Phase-69 token adapters are a SECOND writer to the proxy-owned
 * `.data/llm-proxy/token-usage.db`. CONTEXT.md D-07 makes the SQLite WAL /
 * single-writer concurrency story a permanent, reproducible acceptance
 * criterion: a second-process INSERT alongside the live proxy daemon MUST
 * complete with ZERO SQLITE_BUSY. This file captures that as a node:test fixture.
 *
 * Two test bodies:
 *
 *   (A) CI-portable — builds a fresh temp DB with the full 21-column Phase-68
 *       token_usage shape, sets `journal_mode = wal` + `busy_timeout = 5000`,
 *       holds one connection open while a SECOND `better-sqlite3` connection
 *       INSERTs N=50 rows, allocating each id via
 *       `SELECT COALESCE(MAX(id),0)+1 FROM token_usage WHERE user_hash = ?`.
 *       PASS = ok===50 && busy===0 && rowsReadBack===50 && cleanup===50.
 *
 *   (B) Live-coexistence — gated on `LLM_PROXY_LIVE=1` (the node --test argv-drop
 *       gotcha: a per-file child process can drop a trailing `--live` flag, so we
 *       gate on an env var instead). Opens the REAL `.data/llm-proxy/token-usage.db`
 *       with `fileMustExist:true` + `busy_timeout=5000`, INSERTs 50 sentinel rows
 *       under `agent='__waltest__'` + a distinct sentinel `user_hash` so they never
 *       collide with real proxy/adapter rows, asserts busy===0, reads them back, and
 *       DELETEs every sentinel row in a `finally` so the live DB is left pristine.
 *
 * Sentinels:
 *   - agent      = '__waltest__'  (so the rows are trivially identifiable + deletable)
 *   - user_hash  = 'waltst'       (matches /^[a-z][a-z0-9]{5}$/ — distinct id-space)
 *
 * Forensic output uses `process.stderr.write` (no raw stdout logging — CLAUDE.md).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const N = 50;
const SENTINEL_AGENT = '__waltest__';
const SENTINEL_USER_HASH = 'waltst'; // /^[a-z][a-z0-9]{5}$/

// repoRoot = two dirs up from tests/token-adapters/.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

const warn = (s) => process.stderr.write(s + '\n');

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

/** The exact 21-column INSERT order (token-usage.ts:574-581 — load-bearing). */
const INSERT_SQL = `INSERT INTO token_usage (
  id, timestamp, provider, model, process, subscription,
  input_tokens, output_tokens, total_tokens, latency_ms,
  prompt_preview, tokens_estimated, user_hash, model_raw, overhead_ms,
  agent, task_id, tool_call_id, parent_call_id, granularity_tier, reasoning_tokens
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/** Bind a sentinel row's positional values for INSERT_SQL (id supplied per call). */
function sentinelValues(id, i) {
  return [
    id,
    new Date().toISOString(),
    'claude-code',
    'claude-opus-4-8',
    'token-adapter-waltest',
    'unknown',
    100 + i, // input_tokens
    10 + i, // output_tokens
    110 + 2 * i, // total_tokens
    0, // latency_ms
    '', // prompt_preview
    0, // tokens_estimated
    SENTINEL_USER_HASH,
    'claude-opus-4-8',
    null, // overhead_ms
    SENTINEL_AGENT,
    '', // task_id
    `waltest-${i}`, // tool_call_id
    '', // parent_call_id
    'per-turn',
    0, // reasoning_tokens
  ];
}

/**
 * Run N second-writer INSERTs under the sentinel user_hash on `writer`. When a
 * `holder` connection is supplied, it is first touched so the DB is genuinely
 * open on two connections. Counts SQLITE_BUSY. Caller owns cleanup decision.
 * Returns { ok, busy, rowsReadBack }.
 */
function runConcurrentInserts(writer, holder) {
  if (holder) holder.prepare('SELECT COUNT(*) AS c FROM token_usage').get();

  const nextId = writer.prepare(
    `SELECT COALESCE(MAX(id), 0) + 1 AS n FROM token_usage WHERE user_hash = ?`,
  );
  const ins = writer.prepare(INSERT_SQL);

  let ok = 0;
  let busy = 0;
  for (let i = 0; i < N; i++) {
    try {
      const id = nextId.get(SENTINEL_USER_HASH).n;
      ins.run(...sentinelValues(id, i));
      ok++;
    } catch (err) {
      if (err && err.code === 'SQLITE_BUSY') busy++;
      else throw err;
    }
  }

  const rowsReadBack = writer
    .prepare(
      `SELECT COUNT(*) AS c FROM token_usage WHERE agent = ? AND user_hash = ?`,
    )
    .get(SENTINEL_AGENT, SENTINEL_USER_HASH).c;

  return { ok, busy, rowsReadBack };
}

function deleteSentinels(writer) {
  return writer
    .prepare(`DELETE FROM token_usage WHERE agent = ? AND user_hash = ?`)
    .run(SENTINEL_AGENT, SENTINEL_USER_HASH).changes;
}

// ── (A) CI-portable: temp DB, two connections, N concurrent second-writer INSERTs ──
test('WAL coexistence (temp DB): second writer INSERTs N rows with zero SQLITE_BUSY', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wal-concurrency-'));
  const dbPath = path.join(dir, 'token-usage.db');
  let holder = null;
  let writer = null;
  try {
    // Connection #1 (holder) creates the table + enables WAL.
    holder = new Database(dbPath);
    holder.pragma('journal_mode = wal');
    holder.pragma('busy_timeout = 5000');
    holder.exec(CREATE_TABLE_SQL);

    // Connection #2 (writer) — the SECOND writer, mirrors the adapter open path.
    writer = new Database(dbPath, { fileMustExist: true });
    writer.pragma('busy_timeout = 5000');

    const r = runConcurrentInserts(writer, holder);
    const cleanup = deleteSentinels(writer);
    warn(
      `[wal-test:temp] ok=${r.ok} busy=${r.busy} rowsReadBack=${r.rowsReadBack} cleanup=${cleanup}`,
    );

    assert.equal(r.ok, N, `all ${N} inserts succeed`);
    assert.equal(r.busy, 0, 'zero SQLITE_BUSY under second-writer concurrency');
    assert.equal(r.rowsReadBack, N, `all ${N} sentinel rows readable`);
    assert.equal(cleanup, N, `all ${N} sentinel rows deleted (DB left pristine)`);
  } finally {
    if (writer) writer.close();
    if (holder) holder.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── (B) Live-coexistence: gated on LLM_PROXY_LIVE=1, against the real proxy DB ──
test(
  'WAL coexistence (live DB): second writer alongside the proxy daemon, zero SQLITE_BUSY',
  {
    skip:
      process.env.LLM_PROXY_LIVE === '1'
        ? false
        : 'set LLM_PROXY_LIVE=1 to run the live-coexistence body',
  },
  () => {
    const dataDir = process.env.LLM_PROXY_DATA_DIR ?? path.join(repoRoot, '.data');
    const dbPath = path.join(dataDir, 'llm-proxy', 'token-usage.db');

    let writer = null;
    try {
      // Open the REAL DB as a second writer (the proxy daemon is writer #1).
      writer = new Database(dbPath, { fileMustExist: true });
      writer.pragma('busy_timeout = 5000');

      const r = runConcurrentInserts(writer, null);
      warn(
        `[wal-test:live] ok=${r.ok} busy=${r.busy} rowsReadBack=${r.rowsReadBack}`,
      );

      assert.equal(r.busy, 0, 'zero SQLITE_BUSY alongside the live proxy daemon');
      assert.equal(r.ok, N, `all ${N} live inserts succeed`);
      assert.equal(r.rowsReadBack, N, `all ${N} live sentinel rows readable`);
    } finally {
      // ALWAYS delete every sentinel row so the live DB is left pristine.
      if (writer) {
        try {
          const cleanup = deleteSentinels(writer);
          warn(`[wal-test:live] cleanup=${cleanup}`);
        } catch (err) {
          warn(`[wal-test:live] cleanup failed (non-fatal): ${err.message}`);
        }
        writer.close();
      }
    }
  },
);
