/**
 * tests/live-logging/live-opencode-sqlite-poll.test.js
 *
 * Phase 51 Plan 08 Task 1 - OpenCode Path A (live) watcher tests.
 * 13 tests covering Plan 08 <behavior> block.
 * Pure ESM (Phase 50 D-Primitives convention).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { jest } from '@jest/globals';

const writerCalls = [];
jest.unstable_mockModule('../../src/live-logging/ObservationWriter.js', () => ({
  ObservationWriter: class {
    constructor(opts) { this.opts = opts; }
    async init() { /* no-op */ }
    async close() { /* no-op */ }
    async processMessages(messages, metadata = {}) {
      writerCalls.push({ messages, metadata });
      return { observations: messages.length, errors: 0 };
    }
  },
}));

let startOpencodeWatcher;
let stopOpencodeWatcher;
let seedOpencodeFixture;
let FIXTURE_PROJECT_ROOT;
let openWriterDb;
let insertSubSessionRow;
let bumpSessionUpdate;
let appendMessageRow;
let insertTaskCompletionRow;
let createRegistry;
let SUPPORTED_MIGRATIONS;
let checkSchemaVersion;
let projectFromOpencodeRow;
let buildSubAgentRow;

beforeAll(async () => {
  ({ startOpencodeWatcher, stopOpencodeWatcher } = await import(
    '../../lib/lsl/live/opencode-sqlite-poll.mjs'
  ));
  ({
    seedOpencodeFixture,
    FIXTURE_PROJECT_ROOT,
    openWriterDb,
    insertSubSessionRow,
    bumpSessionUpdate,
    appendMessageRow,
    insertTaskCompletionRow,
  } = await import('../fixtures/opencode/seed-opencode-fixture.mjs'));
  ({ createRegistry } = await import('../../lib/lsl/registry.mjs'));
  ({
    SUPPORTED_MIGRATIONS,
    checkSchemaVersion,
    projectFromOpencodeRow,
    buildSubAgentRow,
  } = await import('../../lib/lsl/adapters/opencode-sqlite.mjs'));
});

let tmpDir;
let savedEnv;
let stderrBuf;
let stderrSpy;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-poll-'));
  savedEnv = {
    LSL_OPENCODE_DB: process.env.LSL_OPENCODE_DB,
    LSL_PROJECT_ROOT_CODING: process.env.LSL_PROJECT_ROOT_CODING,
    OBSERVATIONS_DB_PATH: process.env.OBSERVATIONS_DB_PATH,
  };
  writerCalls.length = 0;
  stderrBuf = '';
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

function dbAt(name = 'opencode.db') {
  return path.join(tmpDir, name);
}

function seed(opts = {}) {
  const p = dbAt();
  seedOpencodeFixture(p, opts);
  return p;
}

function makeObservationWriterStub() {
  return {
    init: async () => {},
    close: async () => {},
    async processMessages(messages, metadata = {}) {
      writerCalls.push({ messages, metadata });
      return { observations: messages.length, errors: 0 };
    },
  };
}

describe('opencode poll watcher - surface', () => {
  test('Test 1: exports startOpencodeWatcher and stopOpencodeWatcher', () => {
    expect(typeof startOpencodeWatcher).toBe('function');
    expect(typeof stopOpencodeWatcher).toBe('function');
  });

  test('Test 2: startOpencodeWatcher returns a handle with stop and getStats', async () => {
    const dbPath = seed({ numSubSessions: 0 });
    const registry = createRegistry();
    const writer = makeObservationWriterStub();
    const handle = await startOpencodeWatcher({
      dbPath,
      registry,
      observationWriter: writer,
      projectRoot: FIXTURE_PROJECT_ROOT,
      pollIntervalMs: 10000,
    });
    try {
      expect(typeof handle.stop).toBe('function');
      expect(typeof handle.getStats).toBe('function');
      const stats = handle.getStats();
      expect(stats).toEqual(
        expect.objectContaining({
          polls: expect.any(Number),
          registered: expect.any(Number),
          last_poll_at: expect.anything(),
          errors: expect.any(Number),
        }),
      );
    } finally {
      await handle.stop();
    }
  });
});

describe('opencode poll watcher - discover (initial tick)', () => {
  test('Test 3: initial poll on seeded DB with 2 sub-sessions yields 2 registry.upsert calls', async () => {
    const dbPath = seed({ numSubSessions: 2 });
    const registry = createRegistry();
    const upsertSpy = jest.spyOn(registry, 'upsert');
    const writer = makeObservationWriterStub();
    const handle = await startOpencodeWatcher({
      dbPath,
      registry,
      observationWriter: writer,
      projectRoot: FIXTURE_PROJECT_ROOT,
      pollIntervalMs: 50,
    });
    try {
      await wait(200);
      expect(upsertSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
      const rows = registry.listByAgent('opencode');
      expect(rows).toHaveLength(2);
      for (const r of rows) {
        expect(r.agent).toBe('opencode');
        expect(r.detected_via).toBe('sqlite-poll');
      }
    } finally {
      await handle.stop();
    }
  });
});

describe('opencode poll watcher - schema-version guard', () => {
  test('Test 4: missing required session column triggers unsupported schema error', async () => {
    // Schema-detection fix (2026-05-27): the guard moved from
    // `MAX(id) FROM __drizzle_migrations` (which broke when OpenCode emptied
    // the id column on host upgrade) to column-presence validation on the
    // tables the adapter actually reads. This test exercises the new
    // contract — a session table missing a required column (`agent`)
    // must trigger the guard.
    const { default: Database } = await import('better-sqlite3');
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

    const registry = createRegistry();
    const writer = makeObservationWriterStub();
    await expect(
      startOpencodeWatcher({
        dbPath,
        registry,
        observationWriter: writer,
        projectRoot: FIXTURE_PROJECT_ROOT,
        pollIntervalMs: 100,
      }),
    ).rejects.toThrow(/unsupported opencode schema.*session.*missing.*agent/i);
  });

  test('Test 4a: legacy migration id outside historical SUPPORTED_MIGRATIONS no longer fails (column-contract check only)', async () => {
    // Companion to Test 4: confirms that an unfamiliar `MAX(id)` value
    // (the original 2026-05 failure trigger) is NO LONGER a schema-guard
    // failure under the post-2026-05-27 check. The host's OpenCode upgrade
    // emptied the migration id column entirely; we must NOT fail-closed on
    // anything other than the real read-contract invariant.
    const dbPath = seed({ migrationIds: [9999] });
    const registry = createRegistry();
    const writer = makeObservationWriterStub();
    const handle = await startOpencodeWatcher({
      dbPath,
      registry,
      observationWriter: writer,
      projectRoot: FIXTURE_PROJECT_ROOT,
      pollIntervalMs: 200,
    });
    try {
      // Watcher started cleanly — the legacy migration id did NOT block it.
      expect(typeof handle.stop).toBe('function');
    } finally {
      await handle.stop();
    }
  });
});

describe('opencode poll watcher - cadence', () => {
  test('Test 5: pollIntervalMs=50 yields at least 2 polls after 300 ms', async () => {
    const dbPath = seed({ numSubSessions: 0 });
    const registry = createRegistry();
    const writer = makeObservationWriterStub();
    const handle = await startOpencodeWatcher({
      dbPath,
      registry,
      observationWriter: writer,
      projectRoot: FIXTURE_PROJECT_ROOT,
      pollIntervalMs: 50,
    });
    try {
      await wait(320);
      const stats = handle.getStats();
      expect(stats.polls).toBeGreaterThanOrEqual(2);
    } finally {
      await handle.stop();
    }
  });
});

describe('opencode poll watcher - incremental detection', () => {
  test('Test 6: a row inserted between polls is upserted; existing rows are not re-upserted', async () => {
    const dbPath = seed({ numSubSessions: 1 });
    const registry = createRegistry();
    const writer = makeObservationWriterStub();
    const handle = await startOpencodeWatcher({
      dbPath,
      registry,
      observationWriter: writer,
      projectRoot: FIXTURE_PROJECT_ROOT,
      pollIntervalMs: 60,
    });
    try {
      await wait(140);
      const rowsInitial = registry.listByAgent('opencode');
      expect(rowsInitial).toHaveLength(1);

      const writerDb = openWriterDb(dbPath);
      const sid2 = 'ses_inserted_1ffe2hVGls09bIagjNN';
      const futureMs = Date.now() + 10000;
      insertSubSessionRow(writerDb, {
        id: sid2,
        parentId: 'ses_parent_1ffeXX',
        directory: FIXTURE_PROJECT_ROOT,
        timeMs: futureMs,
      });
      writerDb.close();

      await wait(240);
      const rows = registry.listByAgent('opencode');
      const inserted = rows.find((r) => r.agent_metadata?.session_id === sid2);
      expect(inserted).toBeDefined();
      expect(inserted.detected_via).toBe('sqlite-poll');
      expect(rows).toHaveLength(2);
    } finally {
      await handle.stop();
    }
  });
});

describe('opencode poll watcher - incremental message fetch', () => {
  test('Test 7: only added messages for the same session flow to writer', async () => {
    const dbPath = seed({
      numSubSessions: 1,
      messagesPerSession: [
        { role: 'user', content: 'first user', timeMs: Date.now() - 1000 },
        { role: 'assistant', content: 'first asst', timeMs: Date.now() - 900 },
      ],
    });
    const registry = createRegistry();
    const writer = makeObservationWriterStub();
    const handle = await startOpencodeWatcher({
      dbPath,
      registry,
      observationWriter: writer,
      projectRoot: FIXTURE_PROJECT_ROOT,
      pollIntervalMs: 60,
    });
    try {
      await wait(150);
      const initialCallCount = writerCalls.length;
      expect(initialCallCount).toBeGreaterThanOrEqual(1);

      const subSid = registry.listByAgent('opencode')[0]?.agent_metadata?.session_id;
      expect(subSid).toBeDefined();

      const writerDb = openWriterDb(dbPath);
      const incrementalMsgId = 'msg_zzz_incremental_1';
      appendMessageRow(writerDb, {
        sessionId: subSid,
        msgId: incrementalMsgId,
        role: 'user',
        text: 'second user incremental',
        timeMs: Date.now() + 100,
      });
      bumpSessionUpdate(writerDb, subSid, Date.now() + 20000);
      writerDb.close();

      await wait(260);

      const lastCall = writerCalls[writerCalls.length - 1];
      expect(lastCall).toBeDefined();
      const ids = lastCall.messages.map((m) => m.id);
      expect(ids).toContain(incrementalMsgId);
      const prior = ids.filter((id) => !id.startsWith('msg_zzz_'));
      expect(prior).toHaveLength(0);
    } finally {
      await handle.stop();
    }
  });
});

describe('opencode poll watcher - stats', () => {
  test('Test 8: getStats returns {polls, registered, last_poll_at, errors}', async () => {
    const dbPath = seed({ numSubSessions: 1 });
    const registry = createRegistry();
    const writer = makeObservationWriterStub();
    const handle = await startOpencodeWatcher({
      dbPath,
      registry,
      observationWriter: writer,
      projectRoot: FIXTURE_PROJECT_ROOT,
      pollIntervalMs: 50,
    });
    try {
      await wait(200);
      const stats = handle.getStats();
      expect(typeof stats.polls).toBe('number');
      expect(stats.polls).toBeGreaterThanOrEqual(1);
      expect(typeof stats.registered).toBe('number');
      expect(stats.registered).toBeGreaterThanOrEqual(1);
      expect(typeof stats.last_poll_at).toBe('string');
      expect(stats.last_poll_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(typeof stats.errors).toBe('number');
    } finally {
      await handle.stop();
    }
  });
});

describe('opencode poll watcher - graceful stop', () => {
  test('Test 9: stop() drains in-flight poll; polls do not increment after stop()', async () => {
    const dbPath = seed({ numSubSessions: 1 });
    const registry = createRegistry();
    const writer = makeObservationWriterStub();
    const handle = await startOpencodeWatcher({
      dbPath,
      registry,
      observationWriter: writer,
      projectRoot: FIXTURE_PROJECT_ROOT,
      pollIntervalMs: 50,
    });
    await wait(80);
    await handle.stop();
    const statsAtStop = handle.getStats();
    await wait(180);
    const statsLater = handle.getStats();
    expect(statsLater.polls).toBe(statsAtStop.polls);
  });
});

describe('opencode poll watcher - error resilience', () => {
  test('Test 10: per-poll errors fire onError; the loop continues', async () => {
    const dbPath = seed({ numSubSessions: 1 });
    const registry = createRegistry();
    const errors = [];
    const failingWriter = {
      init: async () => {},
      close: async () => {},
      processMessages: async () => {
        throw Object.assign(Error('simulated writer failure'), { code: 'FAIL' });
      },
    };
    const handle = await startOpencodeWatcher({
      dbPath,
      registry,
      observationWriter: failingWriter,
      projectRoot: FIXTURE_PROJECT_ROOT,
      pollIntervalMs: 50,
      onError: (err) => errors.push(err),
    });
    try {
      await wait(280);
      expect(errors.length).toBeGreaterThanOrEqual(1);
      const stats = handle.getStats();
      expect(stats.polls).toBeGreaterThanOrEqual(2);
    } finally {
      await handle.stop();
    }
  });
});

describe('opencode poll watcher - directory filter', () => {
  test('Test 11: only sub-sessions matching projectRoot or projectRoot/% are processed', async () => {
    const dbPath = seed({
      numSubSessions: 2,
      directory: FIXTURE_PROJECT_ROOT,
      extraSubSessions: [
        // Siblings of the project root — must be OUTSIDE it for the filter to reject
        // them, so they are derived from it rather than written as a parallel literal.
        { directory: path.join(path.dirname(FIXTURE_PROJECT_ROOT), 'other') },
        { directory: path.join(path.dirname(FIXTURE_PROJECT_ROOT), 'another') },
      ],
    });
    const registry = createRegistry();
    const writer = makeObservationWriterStub();
    const handle = await startOpencodeWatcher({
      dbPath,
      registry,
      observationWriter: writer,
      projectRoot: FIXTURE_PROJECT_ROOT,
      pollIntervalMs: 50,
    });
    try {
      await wait(200);
      const rows = registry.listByAgent('opencode');
      expect(rows).toHaveLength(2);
      for (const r of rows) {
        expect(r.project).toBe('coding');
      }
    } finally {
      await handle.stop();
    }
  });
});

describe('opencode poll watcher - completion detection', () => {
  test('Test 12: task-tool state.status=success triggers registry.markCompleted', async () => {
    const dbPath = seed({ numSubSessions: 1 });
    const writerDb = openWriterDb(dbPath);
    const sub = writerDb.prepare(
      'SELECT id, parent_id FROM session WHERE parent_id IS NOT NULL LIMIT 1',
    ).get();
    insertTaskCompletionRow(writerDb, {
      parentSessionId: sub.parent_id,
      subSessionId: sub.id,
      status: 'success',
    });
    writerDb.close();

    const registry = createRegistry();
    const markSpy = jest.spyOn(registry, 'markCompleted');
    const writer = makeObservationWriterStub();
    const handle = await startOpencodeWatcher({
      dbPath,
      registry,
      observationWriter: writer,
      projectRoot: FIXTURE_PROJECT_ROOT,
      pollIntervalMs: 50,
    });
    try {
      await wait(200);
      expect(markSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
      const completed = registry.listByAgent('opencode').filter(
        (r) => r.status === 'completed',
      );
      expect(completed.length).toBeGreaterThanOrEqual(1);
    } finally {
      await handle.stop();
    }
  });
});

describe('opencode poll watcher - Plan 03 cumulative gate', () => {
  test('Test 13: adapter exports SUPPORTED_MIGRATIONS, checkSchemaVersion, projectFromOpencodeRow, buildSubAgentRow', () => {
    expect(Array.isArray(SUPPORTED_MIGRATIONS)).toBe(true);
    expect(SUPPORTED_MIGRATIONS).toEqual([1, 2, 3, 4]);
    expect(typeof checkSchemaVersion).toBe('function');
    expect(typeof projectFromOpencodeRow).toBe('function');
    expect(typeof buildSubAgentRow).toBe('function');

    expect(
      projectFromOpencodeRow({ directory: FIXTURE_PROJECT_ROOT }),
    ).toBe('coding');
    expect(projectFromOpencodeRow({ directory: '/x/.. evil' })).toBe('unknown');
    expect(projectFromOpencodeRow({})).toBe('unknown');

    const row = buildSubAgentRow(
      {
        id: 'ses_abcdef0123456',
        parent_id: 'ses_parentXX',
        directory: FIXTURE_PROJECT_ROOT,
        agent: 'general',
        title: 'T',
        slug: 's',
        time_created: 1770570503748,
        time_updated: 1770570503950,
      },
      { dbPath: '/tmp/foo.db', detectedVia: 'sqlite-poll', subIndex: 1 },
    );
    expect(row.agent).toBe('opencode');
    expect(row.sub_hash).toBe('ses_abc');
    expect(row.parent_session_id).toBe('ses_parentXX');
    expect(row.sub_index).toBe(1);
    expect(row.project).toBe('coding');
    expect(row.detected_via).toBe('sqlite-poll');
    expect(row.transcript_path).toBe('sqlite:/tmp/foo.db#ses_abcdef0123456');
    expect(row.agent_metadata.opencode_agent_type).toBe('general');
    expect(row.agent_metadata.session_id).toBe('ses_abcdef0123456');
  });
});

describe('opencode poll watcher - resume cursor', () => {
  test('Test 14: getStats exposes a cursor carrying both high-water marks', async () => {
    const dbPath = seed({
      numSubSessions: 1,
      messagesPerSession: [
        { role: 'user', content: 'hello', timeMs: Date.now() - 1000 },
      ],
    });
    const registry = createRegistry();
    const handle = await startOpencodeWatcher({
      dbPath,
      registry,
      observationWriter: makeObservationWriterStub(),
      projectRoot: FIXTURE_PROJECT_ROOT,
      pollIntervalMs: 50,
    });
    try {
      await wait(200);
      const { cursor } = handle.getStats();
      expect(cursor).toBeDefined();
      expect(typeof cursor.last_poll_time).toBe('number');
      expect(cursor.last_poll_time).toBeGreaterThan(0);
      // The message high-water mark matters as much as the session one: without
      // it a resumed session re-sends its entire history (see Test 15).
      const sids = Object.keys(cursor.last_seen_message_id_by_session);
      expect(sids).toHaveLength(1);
      expect(typeof cursor.last_seen_message_id_by_session[sids[0]]).toBe('string');
    } finally {
      await handle.stop();
    }
  });

  test('Test 15: a watcher resumed from a cursor replays nothing', async () => {
    const dbPath = seed({
      numSubSessions: 2,
      messagesPerSession: [
        { role: 'user', content: 'first user', timeMs: Date.now() - 1000 },
        { role: 'assistant', content: 'first asst', timeMs: Date.now() - 900 },
      ],
    });

    // Run 1: cold start — does the full pass and hands back a cursor.
    const first = await startOpencodeWatcher({
      dbPath,
      registry: createRegistry(),
      observationWriter: makeObservationWriterStub(),
      projectRoot: FIXTURE_PROJECT_ROOT,
      pollIntervalMs: 50,
    });
    let cursor;
    try {
      await wait(200);
      expect(writerCalls.length).toBeGreaterThanOrEqual(1);
      cursor = first.getStats().cursor;
    } finally {
      await first.stop();
    }

    // Run 2: same unchanged DB, resumed. This is the restart case that used to
    // re-feed every historical sub-session to the observation writer.
    writerCalls.length = 0;
    const second = await startOpencodeWatcher({
      dbPath,
      registry: createRegistry(),
      observationWriter: makeObservationWriterStub(),
      projectRoot: FIXTURE_PROJECT_ROOT,
      pollIntervalMs: 50,
      cursor,
    });
    try {
      await wait(200);
      expect(writerCalls).toHaveLength(0);
    } finally {
      await second.stop();
    }
  });

  test('Test 16: a resumed session sends only its NEW messages', async () => {
    const dbPath = seed({
      numSubSessions: 1,
      messagesPerSession: [
        { role: 'user', content: 'first user', timeMs: Date.now() - 1000 },
      ],
    });

    const registry = createRegistry();
    const first = await startOpencodeWatcher({
      dbPath,
      registry,
      observationWriter: makeObservationWriterStub(),
      projectRoot: FIXTURE_PROJECT_ROOT,
      pollIntervalMs: 50,
    });
    let cursor;
    let subSid;
    try {
      await wait(200);
      subSid = registry.listByAgent('opencode')[0]?.agent_metadata?.session_id;
      expect(subSid).toBeDefined();
      cursor = first.getStats().cursor;
    } finally {
      await first.stop();
    }

    // The session advances while no watcher is running.
    const writerDb = openWriterDb(dbPath);
    appendMessageRow(writerDb, {
      sessionId: subSid,
      msgId: 'msg_zzz_after_restart',
      role: 'user',
      text: 'sent while the daemon was down',
      timeMs: Date.now() + 100,
    });
    bumpSessionUpdate(writerDb, subSid, Date.now() + 20000);
    writerDb.close();

    writerCalls.length = 0;
    const second = await startOpencodeWatcher({
      dbPath,
      registry: createRegistry(),
      observationWriter: makeObservationWriterStub(),
      projectRoot: FIXTURE_PROJECT_ROOT,
      pollIntervalMs: 50,
      cursor,
    });
    try {
      await wait(200);
      expect(writerCalls.length).toBeGreaterThanOrEqual(1);
      const ids = writerCalls.flatMap((c) => c.messages.map((m) => m.id));
      expect(ids).toContain('msg_zzz_after_restart');
      expect(ids.filter((id) => !id.startsWith('msg_zzz_'))).toHaveLength(0);
    } finally {
      await second.stop();
    }
  });

  test('Test 17: a missing or malformed cursor degrades to a cold start', async () => {
    const dbPath = seed({
      numSubSessions: 1,
      messagesPerSession: [
        { role: 'user', content: 'hello', timeMs: Date.now() - 1000 },
      ],
    });

    // Each of these must behave exactly like no cursor at all — never throw,
    // and never silently skip work.
    for (const bad of [undefined, null, 'nonsense', 42, {}, { last_poll_time: 'x' },
      { last_seen_message_id_by_session: [] }]) {
      writerCalls.length = 0;
      const handle = await startOpencodeWatcher({
        dbPath,
        registry: createRegistry(),
        observationWriter: makeObservationWriterStub(),
        projectRoot: FIXTURE_PROJECT_ROOT,
        pollIntervalMs: 50,
        cursor: bad,
      });
      try {
        await wait(150);
        expect(writerCalls.length).toBeGreaterThanOrEqual(1);
      } finally {
        await handle.stop();
      }
    }
  });
});
