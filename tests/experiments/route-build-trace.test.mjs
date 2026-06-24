// tests/experiments/route-build-trace.test.mjs
//
// Phase 72, Plan 72-04 (Wave 3) — OpenCode read-only SQLite route reader +
// the `buildNormalizedTrace` dispatcher suite (ROUTE-02).
//
//   - buildOpenCodeRouteTrace(dbPath) emits the Plan-01 `RouteEvent[]` contract
//     from the `part` table type:'tool' rows, read-only, epoch-ms→ISO (Pitfall 6),
//     with outcome incl. 'abandoned' for non-terminal parts.
//   - buildNormalizedTrace(span, { dominantAgent }) picks a reader by dominant
//     agent, scopes events to the span time-window (Pitfall 7), and returns null
//     (NOT []) when no trace FILE is located (Pitfall 4 / D-02).
//
// Convention: node:test + node:assert/strict (the tests/experiments/ pattern —
// NOT jest globals). Output via process.stderr.write only (no console.*).
//
// The OpenCode reader test seeds a THROWAWAY sqlite db from the JSON fixture
// (an own-uid temp file so the uid-check gate passes), creating the minimal
// session/message/part schema `checkSchemaVersion` requires. The dispatcher
// tests inject a hermetic `locate`/`read` seam so no real ~/.claude, ~/.copilot
// or ~/.local/share/opencode path is touched.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

import { buildOpenCodeRouteTrace } from '../../lib/lsl/route/opencode-route-trace.mjs';
import { buildNormalizedTrace } from '../../lib/lsl/route/build-trace.mjs';
import { inputsDigest } from '../../lib/lsl/route/route-event.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'route');

/**
 * Seed a throwaway opencode.db (own-uid temp file → uid gate passes) from a
 * JSON array of part.data rows. Creates the minimal schema `checkSchemaVersion`
 * requires (session/message/part with their REQUIRED_SCHEMA_COLUMNS) and inserts
 * each part row's `data` as JSON. Returns { dir, dbPath }.
 */
function seedOpencodeDb(partFixtureName) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'route-opencode-'));
  const dbPath = path.join(dir, 'opencode.db');
  const parts = JSON.parse(
    fs.readFileSync(path.join(FIXTURE_DIR, partFixtureName), 'utf-8'),
  );

  const db = new Database(dbPath);
  // Minimal schema matching REQUIRED_SCHEMA_COLUMNS (opencode-sqlite.mjs).
  db.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY, parent_id TEXT, directory TEXT, agent TEXT,
      title TEXT, slug TEXT, time_created INTEGER, time_updated INTEGER
    );
    CREATE TABLE message (
      id TEXT PRIMARY KEY, session_id TEXT, data TEXT
    );
    CREATE TABLE part (
      id TEXT PRIMARY KEY, message_id TEXT, data TEXT
    );
  `);
  const insertMsg = db.prepare('INSERT INTO message (id, session_id, data) VALUES (?, ?, ?)');
  insertMsg.run('msg1', 'sess1', JSON.stringify({ role: 'assistant', time: { created: 1770570503700 } }));
  const insertPart = db.prepare('INSERT INTO part (id, message_id, data) VALUES (?, ?, ?)');
  parts.forEach((p, i) => {
    // Zero-pad the part id so ORDER BY p.id ASC matches fixture order.
    insertPart.run(`part${String(i).padStart(3, '0')}`, 'msg1', JSON.stringify(p));
  });
  db.close();
  return { dir, dbPath };
}

describe('buildOpenCodeRouteTrace — part type:\'tool\' → RouteEvent[]', () => {
  test('emits one RouteEvent per tool part with correct outcomes + ISO times', () => {
    const { dir, dbPath } = seedOpencodeDb('opencode-part-sample.json');
    try {
      const trace = buildOpenCodeRouteTrace(dbPath);

      // 4 tool parts (the 5th fixture row is type:'text' → filtered out).
      assert.equal(trace.length, 4, 'non-tool parts are filtered out');

      // seq 0-based ascending; every event agent='opencode'.
      trace.forEach((ev, i) => {
        assert.equal(ev.seq, i);
        assert.equal(ev.agent, 'opencode');
      });

      const byId = Object.fromEntries(trace.map((e) => [e.tool_call_id, e]));

      // Two completed → success, ISO timestamps converted from epoch ms.
      assert.equal(byId.oc_read1.outcome, 'success');
      assert.equal(byId.oc_read1.tool_name, 'read');
      assert.equal(byId.oc_read1.target_path, '/repo/a.txt');
      // 1770570503748 ms → 2026-02-08T... ISO (Pitfall 6: ms not seconds).
      assert.equal(byId.oc_read1.started_at, new Date(1770570503748).toISOString());
      assert.equal(byId.oc_read1.ended_at, new Date(1770570503901).toISOString());
      assert.ok(byId.oc_read1.started_at.startsWith('2026-'), 'ms→ISO yields a 2026 date');
      assert.equal(
        byId.oc_read1.inputs_digest,
        inputsDigest({ file_path: '/repo/a.txt' }),
      );

      assert.equal(byId.oc_edit1.outcome, 'success');
      assert.equal(byId.oc_edit1.target_path, '/repo/b.txt');

      // status:'error' → outcome 'error'.
      assert.equal(byId.oc_bash_err.outcome, 'error');
      assert.equal(byId.oc_bash_err.tool_name, 'bash');
      assert.equal(byId.oc_bash_err.target_path, null, 'bash has no file_path → null');

      // status:'running', no terminal time.end → 'abandoned', ended_at=null.
      assert.equal(byId.oc_abandoned.outcome, 'abandoned');
      assert.equal(byId.oc_abandoned.ended_at, null, 'abandoned has null ended_at');
      assert.ok(byId.oc_abandoned.started_at, 'abandoned still has a started_at');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('non-owned db (uid mismatch) → [] without opening', () => {
    // Point at a path that does not exist / is not own-uid. isOwnedByMe returns
    // false on a stat failure → []. (Real cross-uid files are not creatable in
    // a hermetic test, but the stat-fail branch exercises the same fail-closed
    // return path.)
    const trace = buildOpenCodeRouteTrace('/nonexistent/not-owned/opencode.db');
    assert.deepEqual(trace, []);
  });

  test('schema-contract failure → throws (checkSchemaVersion guard)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'route-opencode-bad-'));
    const dbPath = path.join(dir, 'opencode.db');
    try {
      // A db with NO part/session/message tables → checkSchemaVersion throws.
      const db = new Database(dbPath);
      db.exec('CREATE TABLE unrelated (x INTEGER)');
      db.close();
      assert.throws(
        () => buildOpenCodeRouteTrace(dbPath),
        /unsupported opencode schema/,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Dispatcher: buildNormalizedTrace(span, { dominantAgent }) — Task 2.
// ---------------------------------------------------------------------------

describe('buildNormalizedTrace — dominant-agent dispatch + span time-window', () => {
  // A hermetic seam: stub the per-agent locate (returns a path or null) and the
  // per-agent reader (returns RouteEvent[]). buildNormalizedTrace accepts these
  // via an injection hook so the test never touches a real home-dir path.
  const baseEvents = [
    { seq: 0, tool_call_id: 't0', tool_name: 'read', inputs_digest: 'd0', target_path: null, started_at: '2026-02-08T10:00:00.000Z', ended_at: '2026-02-08T10:00:01.000Z', outcome: 'success', agent: 'claude' },
    { seq: 1, tool_call_id: 't1', tool_name: 'edit', inputs_digest: 'd1', target_path: null, started_at: '2026-02-08T11:00:00.000Z', ended_at: '2026-02-08T11:00:01.000Z', outcome: 'success', agent: 'claude' },
    { seq: 2, tool_call_id: 't2', tool_name: 'bash', inputs_digest: 'd2', target_path: null, started_at: '2026-02-08T13:00:00.000Z', ended_at: null, outcome: 'abandoned', agent: 'claude' },
  ];

  const span = {
    task_id: 'task-x',
    started_at: '2026-02-08T10:30:00.000Z',
    ended_at: '2026-02-08T12:00:00.000Z',
  };

  test('routes to claude reader and applies the span time-window (inclusive)', async () => {
    const seam = {
      locate: { claude: () => '/owned/session.jsonl' },
      readers: { claude: () => baseEvents },
    };
    const trace = await buildNormalizedTrace(span, { dominantAgent: 'claude', __seam: seam });
    // t0 (10:00) is BEFORE the window start; t2 (13:00) is AFTER the window end;
    // only t1 (11:00) falls within [10:30, 12:00].
    assert.equal(trace.length, 1);
    assert.equal(trace[0].tool_call_id, 't1');
  });

  test("dominantAgent 'copilot' → copilot reader; 'opencode' → opencode reader", async () => {
    const seam = {
      locate: { copilot: () => '/owned/events.jsonl', opencode: () => '/owned/opencode.db' },
      readers: {
        copilot: () => [{ ...baseEvents[1], agent: 'copilot' }],
        opencode: () => [{ ...baseEvents[1], agent: 'opencode' }],
      },
    };
    const cop = await buildNormalizedTrace(span, { dominantAgent: 'copilot', __seam: seam });
    assert.equal(cop.length, 1);
    assert.equal(cop[0].agent, 'copilot');

    const oc = await buildNormalizedTrace(span, { dominantAgent: 'opencode', __seam: seam });
    assert.equal(oc.length, 1);
    assert.equal(oc[0].agent, 'opencode');
  });

  test('no trace FILE located → null (NOT [], Pitfall 4 / D-02)', async () => {
    const seam = {
      locate: { claude: () => null },
      readers: { claude: () => { throw new Error('reader must not run when no file'); } },
    };
    const trace = await buildNormalizedTrace(span, { dominantAgent: 'claude', __seam: seam });
    assert.equal(trace, null);
  });

  test('file located but zero in-window events → [] (genuinely empty, NOT null)', async () => {
    const seam = {
      locate: { claude: () => '/owned/session.jsonl' },
      // Only the out-of-window events (t0 before, t2 after).
      readers: { claude: () => [baseEvents[0], baseEvents[2]] },
    };
    const trace = await buildNormalizedTrace(span, { dominantAgent: 'claude', __seam: seam });
    assert.deepEqual(trace, []);
  });

  test('unknown / missing dominantAgent → null (no fabricated trace)', async () => {
    const seam = {
      locate: { claude: () => '/owned/session.jsonl' },
      readers: { claude: () => baseEvents },
    };
    assert.equal(await buildNormalizedTrace(span, { dominantAgent: 'gemini', __seam: seam }), null);
    assert.equal(await buildNormalizedTrace(span, { __seam: seam }), null);
  });
});
