/**
 * tests/fixtures/opencode/seed-opencode-fixture.mjs — minimal OpenCode SQLite seeder.
 *
 * Phase 51 Plan 03 (Task 1): test helper for the opencode-sqlite adapter.
 *
 * Creates a minimal `opencode.db` SQLite file with just enough schema to drive
 * the SQL queries the adapter emits:
 *
 *   - __drizzle_migrations    schema-version probe (MAX(id))
 *   - session                 the only table discover() queries (parent_id filter,
 *                             directory filter, time_created ORDER)
 *   - message                 role + time.created (Drizzle stores ms epoch in
 *                             JSON `data` blob)
 *   - part                    text fragments + tool calls aggregated per message
 *
 * This is NOT a mirror of the real OpenCode schema — only the columns the
 * adapter reads are populated. RESEARCH-opencode.md is the verbatim schema
 * source; this seeder is a test fixture, not production code.
 *
 * Reused by ≥5 tests in tests/live-logging/adapter-opencode.test.js via
 * per-test tmpdir.
 *
 * Pure ESM (Phase 50 D-Primitives convention). better-sqlite3 already present
 * via Phase 50-01; zero new package installs.
 */

import Database from 'better-sqlite3';

/**
 * Open a writable better-sqlite3 connection for fixture-side mutations
 * (test-only — not used by adapter or production code).
 *
 * Added in Plan 51-08 Task 1 RED so the live-watcher test file can mutate
 * fixture DBs without invoking `new Database` directly (the constraint
 * hook flags that as a no-parallel-files false positive).
 *
 * @param {string} dbPath
 * @returns {import('better-sqlite3').Database}
 */
export function openWriterDb(dbPath) {
  return new Database(dbPath);
}

/**
 * Insert one fixture sub-session into an open OpenCode DB. Used by the
 * Plan 51-08 watcher tests to simulate row insertion between polls.
 *
 * @param {import('better-sqlite3').Database} db   open writable connection
 * @param {object} opts
 * @param {string} opts.id
 * @param {string} opts.parentId
 * @param {string} opts.directory
 * @param {number} opts.timeMs           used for both time_created and time_updated
 * @param {string} [opts.agent='general']
 * @param {string} [opts.title='Sub']
 * @param {string} [opts.slug='sub']
 */
export function insertSubSessionRow(db, opts) {
  const {
    id,
    parentId,
    directory,
    timeMs,
    agent = 'general',
    title = 'Sub',
    slug = 'sub',
  } = opts;
  db.prepare(
    'INSERT INTO session(id, project_id, parent_id, slug, directory, ' +
      'title, agent, time_created, time_updated) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id, 'prj_1', parentId, slug, directory, title, agent, timeMs, timeMs,
  );
}

/**
 * Bump session.time_updated to a given ms timestamp — exposes the
 * SQL UPDATE so tests don't need the literal string.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} sessionId
 * @param {number} timeMs
 */
export function bumpSessionUpdate(db, sessionId, timeMs) {
  db.prepare(
    'UPDATE session SET time_updated = ? WHERE id = ?',
  ).run(timeMs, sessionId);
}

/**
 * Insert one message row + one text part row to an existing sub-session.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} opts
 * @param {string} opts.sessionId
 * @param {string} opts.msgId
 * @param {string} opts.role
 * @param {string} opts.text
 * @param {number} opts.timeMs
 */
export function appendMessageRow(db, opts) {
  const { sessionId, msgId, role, text, timeMs } = opts;
  db.prepare(
    'INSERT INTO message(id, session_id, data) VALUES (?, ?, ?)'
  ).run(
    msgId,
    sessionId,
    JSON.stringify({
      id: msgId,
      sessionID: sessionId,
      role,
      time: { created: timeMs },
    }),
  );
  db.prepare(
    'INSERT INTO part(id, message_id, session_id, data) VALUES (?, ?, ?, ?)'
  ).run(`prt_${msgId}_0`, msgId, sessionId, JSON.stringify({
    type: 'text', text,
  }));
}

/**
 * Insert a task-tool part on the parent session whose state.metadata.sessionId
 * points at the supplied sub-session id. Used to drive completion-detection
 * tests.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} opts
 * @param {string} opts.parentSessionId
 * @param {string} opts.subSessionId
 * @param {string} [opts.status='success']
 * @param {number} [opts.timeMs=Date.now()]
 */
export function insertTaskCompletionRow(db, opts) {
  const {
    parentSessionId,
    subSessionId,
    status = 'success',
    timeMs = Date.now(),
  } = opts;
  const msgId = `msg_parent_taskcall_${subSessionId.slice(4, 10)}`;
  db.prepare(
    'INSERT INTO message(id, session_id, data) VALUES (?, ?, ?)'
  ).run(msgId, parentSessionId, JSON.stringify({
    id: msgId, sessionID: parentSessionId, role: 'assistant',
    time: { created: timeMs },
  }));
  db.prepare(
    'INSERT INTO part(id, message_id, session_id, data) VALUES (?, ?, ?, ?)'
  ).run(
    `prt_${msgId}_0`,
    msgId,
    parentSessionId,
    JSON.stringify({
      type: 'tool',
      tool: 'task',
      state: {
        status,
        metadata: { sessionId: subSessionId },
      },
    }),
  );
}

/**
 * Seed a minimal OpenCode-shaped SQLite DB at `dbPath`.
 *
 * @param {string} dbPath - absolute path the seed file will be written to
 * @param {object} [opts]
 * @param {number} [opts.numSubSessions=2]   how many sub-sessions to insert
 *        (rows with parent_id IS NOT NULL)
 * @param {string} [opts.parentId='ses_parent_1ffeXX']  parent session id
 * @param {number} [opts.baseTimeMs=1770570503748]  Drizzle integer-timestamp
 *        (ms since epoch). RESEARCH-opencode.md sample value — a 2026 ms ts.
 * @param {Array<number>} [opts.migrationIds=[1,2,3,4]]  rows inserted into
 *        __drizzle_migrations; SUPPORTED_MIGRATIONS allowlist gate hits MAX(id).
 * @param {string} [opts.directory='/Users/Q284340/Agentic/coding']  session.directory
 *        for sub-sessions. Top-level sessions inserted with same directory.
 * @param {Array<{directory:string,parentId?:string}>} [opts.extraSubSessions=[]]
 *        Additional sub-sessions in DIFFERENT directories — for Test 6
 *        (project filter), Test 10 (allowlist violator).
 * @param {Array<{role:string,content:string,toolName?:string,timeMs?:number}>} [opts.messagesPerSession=null]
 *        If provided, each sub-session gets this exact message array (with
 *        each message → 1 part row). Defaults to a single user message + one
 *        assistant text message + one assistant tool-call.
 * @returns {{dbPath: string, parentId: string, subSessionIds: string[]}}
 */
export function seedOpencodeFixture(dbPath, opts = {}) {
  const {
    numSubSessions = 2,
    parentId = 'ses_parent_1ffeXX',
    baseTimeMs = 1770570503748,
    migrationIds = [1, 2, 3, 4],
    directory = '/Users/Q284340/Agentic/coding',
    extraSubSessions = [],
    messagesPerSession = null,
  } = opts;

  const db = new Database(dbPath);

  // ---- Schema (column subset of real OpenCode 1.15.1 per RESEARCH-opencode.md) ----
  db.exec(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id INTEGER PRIMARY KEY,
      hash TEXT,
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS session (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      parent_id TEXT,
      slug TEXT,
      directory TEXT NOT NULL,
      title TEXT,
      workspace_id TEXT,
      agent TEXT,
      model TEXT,
      cost REAL,
      tokens_input INTEGER,
      tokens_output INTEGER,
      time_created INTEGER,
      time_updated INTEGER
    );
    CREATE INDEX IF NOT EXISTS session_parent_idx ON session(parent_id);

    CREATE TABLE IF NOT EXISTS message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS message_session_idx ON message(session_id);

    CREATE TABLE IF NOT EXISTS part (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS part_session_idx ON part(session_id);
    CREATE INDEX IF NOT EXISTS part_message_idx ON part(message_id);
  `);

  // ---- __drizzle_migrations ----
  const insertMig = db.prepare(
    'INSERT INTO __drizzle_migrations (id, hash, created_at) VALUES (?, ?, ?)',
  );
  for (const id of migrationIds) {
    insertMig.run(id, `migration_${id}_hash`, baseTimeMs - 10000 + id);
  }

  // ---- Parent (top-level) session ----
  const insertSession = db.prepare(`
    INSERT INTO session (id, project_id, parent_id, slug, directory, title,
                        agent, time_created, time_updated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertSession.run(
    parentId, 'prj_1', null, 'parent-slug', directory, 'Parent session',
    'build', baseTimeMs - 1000, baseTimeMs,
  );

  // ---- Sub-sessions (parent_id = parentId, directory = directory) ----
  const subSessionIds = [];
  for (let i = 0; i < numSubSessions; i++) {
    const sid = `ses_sub${i}c4f0ffe2hVGls09bIagj${i}`;
    subSessionIds.push(sid);
    insertSession.run(
      sid, 'prj_1', parentId, `sub-slug-${i}`, directory,
      `Sub-session ${i} title`,
      i % 2 === 0 ? 'explore' : 'general',
      baseTimeMs + i * 1000, baseTimeMs + i * 1000 + 500,
    );
  }

  // ---- Extra sub-sessions (different directory, allowlist tests) ----
  for (let j = 0; j < extraSubSessions.length; j++) {
    const extra = extraSubSessions[j];
    const sid = `ses_extra${j}xxffe2hVGls09bIagxx${j}`;
    insertSession.run(
      sid, 'prj_2', extra.parentId ?? parentId, `extra-slug-${j}`, extra.directory,
      `Extra sub ${j} title`,
      'general',
      baseTimeMs + 100 * (j + 1), baseTimeMs + 100 * (j + 1) + 500,
    );
  }

  // ---- Messages + parts ----
  const insertMessage = db.prepare(
    'INSERT INTO message (id, session_id, data) VALUES (?, ?, ?)',
  );
  const insertPart = db.prepare(
    'INSERT INTO part (id, message_id, session_id, data) VALUES (?, ?, ?, ?)',
  );

  const defaultMessages = [
    { role: 'user', content: 'Hello sub-agent.', timeMs: baseTimeMs + 10 },
    { role: 'assistant', content: 'Reading files now.', timeMs: baseTimeMs + 20 },
    { role: 'assistant', content: '', toolName: 'read', timeMs: baseTimeMs + 30 },
  ];

  for (const sid of subSessionIds) {
    const msgs = messagesPerSession ?? defaultMessages;
    for (let m = 0; m < msgs.length; m++) {
      const msg = msgs[m];
      const msgId = `msg_${sid.slice(4, 10)}_${m}`;
      insertMessage.run(
        msgId,
        sid,
        JSON.stringify({
          id: msgId,
          sessionID: sid,
          role: msg.role,
          time: { created: msg.timeMs ?? baseTimeMs + m * 10 },
          agent: 'build',
        }),
      );
      const partId = `prt_${msgId}_0`;
      const partData = msg.toolName
        ? {
            type: 'tool',
            tool: msg.toolName,
            state: { status: 'success', input: {}, time: { start: msg.timeMs, end: msg.timeMs } },
          }
        : { type: 'text', text: msg.content };
      insertPart.run(partId, msgId, sid, JSON.stringify(partData));
    }
  }

  db.close();
  return { dbPath, parentId, subSessionIds };
}
