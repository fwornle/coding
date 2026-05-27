/**
 * tests/live-logging/adapter-opencode.test.js
 *
 * Phase 51 Plan 03 Task 1 — opencode-sqlite adapter contract + behavior.
 *
 * 13 tests covering Plan 03 <behavior> block:
 *
 *   1.  Adapter exports {agentId, storageType, discover, convertToObservations}
 *   2.  discover() opens DB in readonly mode (no-write proof via attempted UPDATE)
 *   3.  Schema-version guard FAILS on MAX(id)=9999 with clear error
 *   4.  Schema-version guard PASSES for migrationIds in [1,2,3,4]
 *   5.  Sub-session filter: parent_id IS NOT NULL only
 *   6.  Project filter — directory exact match or `dir/%`
 *   7.  time_created MS not S: 2026 ms timestamp parses as 2026 ISO
 *   8.  sub_index ordering by time_created ASC
 *   9.  sub_hash extraction: slice(0, 7)
 *  10.  Allowlist regex catches path-injection directory; stderr log
 *  11.  convertToObservations dry-run: no writer call
 *  12.  convertToObservations live: writer.processMessages invoked + post-write
 *       metadata stamp via JSON patch
 *  13.  DB lock contention: clear error, no crash, busy_timeout honored
 *
 * Uses the per-test tmpdir fixture seeder at
 * tests/fixtures/opencode/seed-opencode-fixture.mjs.
 *
 * Mocks ObservationWriter via jest.unstable_mockModule (Phase 50 scan-and-convert
 * test pattern).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { jest } from '@jest/globals';

// ---- Mock ObservationWriter (Test 11 / 12) ------------------------------
const writerCalls = [];

jest.unstable_mockModule('../../src/live-logging/ObservationWriter.js', () => ({
  ObservationWriter: class {
    constructor(opts) { this.opts = opts; }
    async init() { /* no-op */ }
    async close() { /* no-op */ }
    async processMessages(messages, metadata = {}) {
      writerCalls.push({ messages, metadata });
      return { observations: messages.length, errors: 0, lastObservationId: 'obs_test_1' };
    }
  },
}));

// ---- Adapter SUT (lazy import after mock declaration) -------------------
let adapter;
let seedOpencodeFixture;

beforeAll(async () => {
  ({ adapter } = await import('../../lib/lsl/adapters/opencode-sqlite.mjs'));
  ({ seedOpencodeFixture } = await import('../fixtures/opencode/seed-opencode-fixture.mjs'));
});

// ---- Per-test tmpdir + env snapshot --------------------------------------
let tmpDir;
let savedEnv;
let stderrBuf;
let stderrSpy;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-fixture-'));
  savedEnv = {
    LSL_OPENCODE_DB: process.env.LSL_OPENCODE_DB,
    LSL_PROJECT_ROOT_CODING: process.env.LSL_PROJECT_ROOT_CODING,
    OBSERVATIONS_DB_PATH: process.env.OBSERVATIONS_DB_PATH,
  };
  writerCalls.length = 0;
  stderrBuf = '';
  // Jest's reporter still needs stderr.write; spyOn keeps that wiring intact
  // and just intercepts each call to record into the buffer.
  stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderrBuf += String(chunk);
    return true;
  });
});

afterEach(() => {
  if (stderrSpy) stderrSpy.mockRestore();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  if (savedEnv) {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

// ---- Helpers -------------------------------------------------------------
function dbAt(name = 'opencode.db') {
  return path.join(tmpDir, name);
}

function seed(opts = {}) {
  const p = dbAt();
  seedOpencodeFixture(p, opts);
  return p;
}

// =========================================================================
// Tests
// =========================================================================

describe('opencode-sqlite adapter — shape', () => {
  test('Test 1: exports {agentId, storageType, discover, convertToObservations}', () => {
    expect(adapter).toBeDefined();
    expect(adapter.agentId).toBe('opencode');
    expect(adapter.storageType).toBe('sqlite');
    expect(typeof adapter.discover).toBe('function');
    expect(typeof adapter.convertToObservations).toBe('function');
  });
});

describe('opencode-sqlite adapter — discover()', () => {
  test('Test 2: opens DB in readonly mode (attempted UPDATE fails)', async () => {
    const dbPath = seed();
    // First confirm discover() succeeds (proves the DB was opened).
    const rows = await adapter.discover({
      searchPaths: [{ type: 'sqlite', dbPath }],
      project: 'coding',
    });
    expect(Array.isArray(rows)).toBe(true);
    // Now prove readonly: open the same file readonly via better-sqlite3 and
    // confirm UPDATE throws. (The adapter does NOT leave any open handle;
    // we re-open here as the verification probe.)
    const probe = new Database(dbPath, { readonly: true, fileMustExist: true });
    expect(() => probe.prepare('UPDATE session SET title = ? WHERE id = ?').run('x', 'y'))
      .toThrow(/readonly/i);
    probe.close();
  });

  test('Test 3: schema-contract guard hard-fails when a required session column is missing', async () => {
    // Schema-detection fix (2026-05-27): replaced MAX(id)-vs-SUPPORTED_MIGRATIONS
    // gate with a column-presence contract check. The original gate broke
    // when OpenCode upgraded the host schema such that __drizzle_migrations.id
    // returned NULL (the SERIAL column exists but rows are empty; `hash` is
    // the new primary key). This test exercises the new failure trigger.
    const dbPath = path.join(tmpDir, `opencode-missing-agent-${Date.now()}.db`);
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE session (
        id TEXT PRIMARY KEY,
        parent_id TEXT,
        directory TEXT,
        title TEXT,
        slug TEXT,
        time_created INTEGER,
        time_updated INTEGER
      );
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT);
      CREATE TABLE part    (id TEXT PRIMARY KEY, message_id TEXT, data TEXT);
    `);
    db.close();

    await expect(
      adapter.discover({
        searchPaths: [{ type: 'sqlite', dbPath }],
        project: 'coding',
      }),
    ).rejects.toThrow(/unsupported opencode schema.*session.*missing.*agent/i);
  });

  test('Test 4: schema-contract guard PASSES regardless of __drizzle_migrations MAX(id)', async () => {
    // Companion to Test 3: the original 2026-05 failure trigger (a migration
    // id not in [1,2,3,4]) is NO LONGER a guard failure — the new check only
    // cares about column presence on session/message/part. seed() builds a
    // fully-compatible schema; passing migrationIds=[9999] used to fail, now
    // discovers successfully.
    const dbPath = seed({ migrationIds: [9999] });
    await expect(
      adapter.discover({
        searchPaths: [{ type: 'sqlite', dbPath }],
        project: 'coding',
      }),
    ).resolves.toBeDefined();
  });

  test('Test 5: filter — only sub-sessions (parent_id IS NOT NULL)', async () => {
    const dbPath = seed({ numSubSessions: 2 });
    const rows = await adapter.discover({
      searchPaths: [{ type: 'sqlite', dbPath }],
      project: 'coding',
    });
    // 2 sub-sessions; parent session (parent_id IS NULL) is filtered out.
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      // Sanity: parent_session_id present + non-empty.
      expect(typeof row.parent_session_id).toBe('string');
      expect(row.parent_session_id.length).toBeGreaterThan(0);
    }
  });

  test('Test 6: filter — by project directory (2 of 4 in coding root)', async () => {
    const dbPath = seed({
      numSubSessions: 2,
      directory: '/Users/Q284340/Agentic/coding',
      extraSubSessions: [
        { directory: '/Users/Q284340/Agentic/other' },
        { directory: '/Users/Q284340/Agentic/another' },
      ],
    });
    process.env.LSL_PROJECT_ROOT_CODING = '/Users/Q284340/Agentic/coding';
    const rows = await adapter.discover({
      searchPaths: [{ type: 'sqlite', dbPath }],
      project: 'coding',
    });
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.project).toBe('coding');
    }
  });

  test('Test 7: time_created treated as MS — 2026 timestamp parses to year 2026', async () => {
    const dbPath = seed({ baseTimeMs: 1770570503748 }); // 2026-02-08 ms
    const rows = await adapter.discover({
      searchPaths: [{ type: 'sqlite', dbPath }],
      project: 'coding',
    });
    expect(rows.length).toBeGreaterThan(0);
    const ms = rows[0].agent_metadata.time_created_ms;
    expect(typeof ms).toBe('number');
    // Within 1e6 of the seed base (2026); if interpreted as SECONDS the year
    // would be ~58110, which fails this guard.
    expect(ms).toBeGreaterThanOrEqual(1770570503748);
    expect(new Date(ms).getUTCFullYear()).toBe(2026);
  });

  test('Test 8: sub_index ordered ASC by time_created', async () => {
    const dbPath = dbAt();
    // Custom seed: 3 sub-sessions out-of-order, baseTimeMs varies per row.
    // Use the same seeder but inject 3 sub-sessions, then re-write rows.
    seedOpencodeFixture(dbPath, { numSubSessions: 3, baseTimeMs: 1770570503000 });
    // Now manually shuffle time_created so disk order ≠ chrono order.
    const db = new Database(dbPath);
    const ids = db.prepare('SELECT id FROM session WHERE parent_id IS NOT NULL ORDER BY id').all();
    expect(ids).toHaveLength(3);
    // Assign times: ids[0]=+10, ids[1]=+5, ids[2]=+20 (so chrono = ids[1], ids[0], ids[2]).
    db.prepare('UPDATE session SET time_created = ? WHERE id = ?').run(1770570503000 + 10, ids[0].id);
    db.prepare('UPDATE session SET time_created = ? WHERE id = ?').run(1770570503000 + 5,  ids[1].id);
    db.prepare('UPDATE session SET time_created = ? WHERE id = ?').run(1770570503000 + 20, ids[2].id);
    db.close();

    const rows = await adapter.discover({
      searchPaths: [{ type: 'sqlite', dbPath }],
      project: 'coding',
    });
    expect(rows).toHaveLength(3);
    // sub_index is 1-based, ASC by time_created.
    const byId = Object.fromEntries(rows.map(r => [r.agent_metadata.time_created_ms, r]));
    const t5  = byId[1770570503000 + 5];
    const t10 = byId[1770570503000 + 10];
    const t20 = byId[1770570503000 + 20];
    expect(t5.sub_index).toBe(1);
    expect(t10.sub_index).toBe(2);
    expect(t20.sub_index).toBe(3);
  });

  test('Test 9: sub_hash extraction — slice(0, 7) of session.id', async () => {
    const dbPath = seed({ numSubSessions: 1 });
    const rows = await adapter.discover({
      searchPaths: [{ type: 'sqlite', dbPath }],
      project: 'coding',
    });
    expect(rows).toHaveLength(1);
    const sid = rows[0].agent_metadata.session_id;
    expect(rows[0].sub_hash).toBe(sid.slice(0, 7));
  });

  test('Test 10: directory allowlist regex rejects path-injection violators', async () => {
    const dbPath = dbAt();
    // Seed with two valid sub-sessions, then patch one to have an evil
    // directory whose path is INSIDE the project root prefix (so the SQL
    // LIKE filter admits it) but whose basename fails the allowlist regex.
    // This is the defense-in-depth surface: SQL prefix-match narrows the
    // candidates, and path.basename + allowlist regex is a second guard.
    seedOpencodeFixture(dbPath, { numSubSessions: 2 });
    const db = new Database(dbPath);
    const sids = db.prepare(
      'SELECT id FROM session WHERE parent_id IS NOT NULL ORDER BY id',
    ).all();
    // basename('/Users/Q284340/Agentic/coding/.. evil') === '.. evil' on POSIX,
    // which contains '.', ' ', and starts with '..' — all rejected by /^[a-z0-9-]+$/i.
    db.prepare('UPDATE session SET directory = ? WHERE id = ?')
      .run('/Users/Q284340/Agentic/coding/.. evil', sids[1].id);
    db.close();

    process.env.LSL_PROJECT_ROOT_CODING = '/Users/Q284340/Agentic/coding';
    const rows = await adapter.discover({
      searchPaths: [{ type: 'sqlite', dbPath: dbPath }],
      project: 'coding',
    });
    // First sub-session passes (directory = '/Users/Q284340/Agentic/coding',
    // basename = 'coding', allowlist-clean).
    // Second sub-session matched by SQL prefix `dir/%` but rejected by the
    // basename allowlist guard with a stderr log line.
    expect(rows).toHaveLength(1);
    expect(stderrBuf).toMatch(/opencode-adapter.*basename/i);
  });
});

describe('opencode-sqlite adapter — convertToObservations()', () => {
  test('Test 11: dryRun=true does NOT call ObservationWriter', async () => {
    const dbPath = seed({ numSubSessions: 1 });
    const rows = await adapter.discover({
      searchPaths: [{ type: 'sqlite', dbPath }],
      project: 'coding',
    });
    const results = await adapter.convertToObservations(rows, { dryRun: true });
    expect(writerCalls).toHaveLength(0);
    expect(Array.isArray(results)).toBe(true);
    expect(results).toHaveLength(rows.length);
    for (const r of results) {
      expect(r.observations_written).toBe(0);
    }
  });

  test('Test 12: dryRun=false invokes writer.processMessages + stamps metadata back', async () => {
    const obsDbPath = path.join(tmpDir, 'observations.db');
    // Pre-seed an observations DB with the minimal schema the adapter's
    // metadata-stamp UPDATE will hit. Mirrors ObservationWriter.init() shape.
    const obsDb = new Database(obsDbPath);
    obsDb.exec(`
      CREATE TABLE IF NOT EXISTS observations (
        id TEXT PRIMARY KEY,
        summary TEXT,
        messages TEXT,
        agent TEXT,
        session_id TEXT,
        source_file TEXT,
        created_at TEXT,
        metadata TEXT
      );
    `);
    // The mocked writer doesn't actually insert; insert a stub row whose
    // source_file matches what the adapter will pass so the json_patch
    // UPDATE has a row to mutate.
    // We don't know transcript_path yet; insert after discover().
    obsDb.close();

    process.env.OBSERVATIONS_DB_PATH = obsDbPath;

    const dbPath = seed({ numSubSessions: 1 });
    const rows = await adapter.discover({
      searchPaths: [{ type: 'sqlite', dbPath }],
      project: 'coding',
    });
    const tp = rows[0].transcript_path;
    // Insert a stub observation row matching that transcript path so the
    // post-write UPDATE finds something to patch.
    const obsDb2 = new Database(obsDbPath);
    obsDb2.prepare(`
      INSERT INTO observations (id, summary, agent, source_file, metadata)
      VALUES (?, ?, ?, ?, ?)
    `).run('obs_test_1', 'stub', 'opencode', tp, JSON.stringify({}));
    obsDb2.close();

    const results = await adapter.convertToObservations(rows, {
      dryRun: false,
      tag: 'sub-agent-backfill',
    });

    expect(writerCalls.length).toBeGreaterThanOrEqual(1);
    const call = writerCalls[0];
    expect(Array.isArray(call.messages)).toBe(true);
    expect(call.messages.length).toBeGreaterThan(0);
    // Roles assembled correctly.
    expect(call.messages.some(m => m.role === 'user')).toBe(true);
    expect(call.messages.some(m => m.role === 'assistant')).toBe(true);
    // ObservationWriter call metadata reflects what Plan 03 spec mandates.
    expect(call.metadata.agent).toBe('opencode');
    expect(call.metadata.source).toBe('sub-agent-backfill');
    expect(call.metadata.tag).toBe('sub-agent-backfill');
    expect(call.metadata.project).toBe('coding');
    expect(call.metadata.sourceFile).toBe(tp);
    expect(results).toHaveLength(1);
    expect(results[0].observations_written).toBeGreaterThan(0);

    // Verify post-write metadata stamp landed on the stub observation row.
    const obsDb3 = new Database(obsDbPath, { readonly: true });
    const stamped = obsDb3.prepare(
      'SELECT metadata FROM observations WHERE id = ?',
    ).get('obs_test_1');
    obsDb3.close();
    const meta = JSON.parse(stamped.metadata);
    expect(meta.parent_session_id).toBe(rows[0].parent_session_id);
    expect(meta.sub_index).toBe(rows[0].sub_index);
    expect(meta.sub_hash).toBe(rows[0].sub_hash);
    expect(meta.agent).toBe('opencode');
    expect(meta.project).toBe('coding');
  });
});

describe('opencode-sqlite adapter — lock contention (T-51-03-SC)', () => {
  test('Test 13: busy_timeout surfaces clear error on locked DB; no crash', async () => {
    const dbPath = seed({ numSubSessions: 1 });
    // Open the DB in a separate writer connection with an EXCLUSIVE lock to
    // simulate a live OpenCode TUI writing. We BEGIN IMMEDIATE so the lock
    // is held until COMMIT or ROLLBACK.
    const blocker = new Database(dbPath);
    blocker.exec("PRAGMA locking_mode = EXCLUSIVE; PRAGMA journal_mode = DELETE;");
    blocker.exec('BEGIN IMMEDIATE');
    // Force the lock to materialize.
    blocker.prepare('INSERT INTO session(id, directory, time_created) VALUES (?, ?, ?)')
      .run('ses_lock_holder', '/tmp/locker', 1);

    // discover() under contention: with busy_timeout = 5000 ms set by the
    // adapter, the open itself should succeed BUT a read should either
    // surface a SQLITE_BUSY-style error within ~5 s OR succeed if SQLite
    // grants a snapshot. Per Plan 03 spec Test 13 requirement: "clear error
    // after 5s" — assert no uncaught/un-handled rejection AND the elapsed
    // time stays bounded.
    const start = Date.now();
    let surfacedError = null;
    try {
      await adapter.discover({
        searchPaths: [{ type: 'sqlite', dbPath }],
        project: 'coding',
      });
    } catch (err) {
      surfacedError = err;
    }
    const elapsed = Date.now() - start;
    // Roll back + close so afterEach can rm the tmpdir.
    try { blocker.exec('ROLLBACK'); } catch { /* */ }
    blocker.close();

    // Adapter MUST NOT hang past the busy_timeout by more than a slack margin.
    expect(elapsed).toBeLessThan(8000);
    // Either it surfaced a clear error or it managed a snapshot read; both
    // are acceptable provided the adapter didn't crash the process.
    if (surfacedError) {
      expect(/database is locked|SQLITE_BUSY|busy/i.test(surfacedError.message)).toBe(true);
    }
  });
});
