/**
 * lib/agents/box-sessions.cjs — which observations ran in the agent box.
 *
 * The host launcher (scripts/agent-box.mjs) records each box run; session
 * logging asks runtimeOf() for 'box' | 'strict' | 'host' (or null) and the
 * dashboard shows it on every observation.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { readBoxSessions, recordBoxEvent, runtimeOf, boxSessionsFile, transcriptStartMs } = require('../../lib/agents/box-sessions.cjs');

const REPO = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const T0 = Date.parse('2026-11-12T10:00:00Z');
const min = 60_000;
const lines = (...events) => events.map((e) => JSON.stringify(e)).join('\n');
const alive = () => true;

function runs(...events) {
  return readBoxSessions({ text: lines(...events), alive, now: T0 + 600 * min });
}

describe('readBoxSessions', () => {
  test('a start and its end make one run; recording began at the first line', () => {
    const r = runs(
      { event: 'start', name: 'b1', agent: 'pi', workspace: '/p', mode: 'box', pid: 1, at: T0 },
      { event: 'end', name: 'b1', at: T0 + 5 * min },
    );
    assert.equal(r.length, 1);
    assert.deepEqual({ ...r[0] }, { name: 'b1', agent: 'pi', workspace: '/p', mode: 'box', sessionId: null, pid: 1, startedAt: T0, endedAt: T0 + 5 * min });
    assert.equal(r.trackedSince, T0);
  });

  test('a run whose launcher is gone without an end line is closed, not left open forever', () => {
    const r = readBoxSessions({
      text: lines({ event: 'start', name: 'b1', agent: 'pi', workspace: '/p', pid: 999999, at: T0 }),
      alive: () => false,
    });
    assert.equal(r[0].endedAt, T0);
  });

  test('a live launcher keeps its run open', () => {
    const r = runs({ event: 'start', name: 'b1', agent: 'pi', workspace: '/p', pid: 1, at: T0 });
    assert.equal(r[0].endedAt, null);
  });

  test('no registry → no runs and no tracking start; junk lines are skipped', () => {
    const empty = readBoxSessions({ env: { CODING_BOX_SESSIONS_FILE: '/nonexistent/x.jsonl' } });
    assert.deepEqual([...empty], []);
    assert.equal(empty.trackedSince, undefined);
    assert.equal(runs({ nope: 1 }).length, 0);
  });

  test('recordBoxEvent appends to the registry file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'box-sessions-'));
    const env = { CODING_BOX_SESSIONS_FILE: path.join(dir, 'sub', 'sessions.jsonl') };
    assert.equal(recordBoxEvent({ event: 'start', name: 'b1', agent: 'claude', workspace: '/p', pid: process.pid }, { env }), true);
    assert.equal(recordBoxEvent({ event: 'end', name: 'b1' }, { env }), true);
    const r = readBoxSessions({ env });
    assert.equal(r.length, 1);
    assert.ok(r[0].endedAt >= r[0].startedAt);
    assert.equal(boxSessionsFile({ env }), env.CODING_BOX_SESSIONS_FILE);
  });
});

describe('runtimeOf', () => {
  const boxDb = '/h/.coding/box/opencode/opencode.db';

  test('opencode: the store decides, with or without a registry', () => {
    const none = readBoxSessions({ text: '', alive });
    assert.equal(runtimeOf({ agent: 'opencode', opencodeDb: boxDb, boxOpencodeDb: boxDb, runs: none, atMs: T0 }), 'box');
    assert.equal(runtimeOf({ agent: 'opencode', opencodeDb: '/h/.local/share/opencode/opencode.db', boxOpencodeDb: boxDb, runs: none, atMs: T0 }), 'host');
    const strict = runs({ event: 'start', name: 'b', agent: 'opencode', workspace: '/p', mode: 'strict', pid: 1, at: T0 });
    assert.equal(runtimeOf({ agent: 'opencode', projectPath: '/p', opencodeDb: boxDb, boxOpencodeDb: boxDb, runs: strict, atMs: T0 + min }), 'strict');
  });

  test('claude: matched by its pinned session id, not by time', () => {
    const r = runs({ event: 'start', name: 'b', agent: 'claude', workspace: '/p', mode: 'box', sessionId: 'aaa', pid: 1, at: T0 });
    assert.equal(runtimeOf({ agent: 'claude', projectPath: '/p', sessionId: 'aaa', atMs: T0 + min, runs: r }), 'box');
    // a host claude in the same project at the same time is NOT the boxed one
    assert.equal(runtimeOf({ agent: 'claude', projectPath: '/p', sessionId: 'bbb', atMs: T0 + min, runs: r }), 'host');
  });

  test('claude whose id could not be pinned (--continue) falls back to the window', () => {
    const r = runs({ event: 'start', name: 'b', agent: 'claude', workspace: '/p', mode: 'box', pid: 1, at: T0 });
    assert.equal(runtimeOf({ agent: 'claude', projectPath: '/p', sessionId: 'zzz', atMs: T0 + min, runs: r }), 'box');
  });

  test('copilot / pi: a box run of the same agent in the same project, live at that time', () => {
    const r = runs(
      { event: 'start', name: 'b', agent: 'copilot', workspace: '/p', mode: 'box', pid: 1, at: T0 },
      { event: 'end', name: 'b', at: T0 + 10 * min },
    );
    assert.equal(runtimeOf({ agent: 'copilot', projectPath: '/p', atMs: T0 + 5 * min, runs: r }), 'box');
    assert.equal(runtimeOf({ agent: 'copilot', projectPath: '/p/sub', atMs: T0 + 5 * min, runs: r }), 'box', 'a subdirectory of the workspace');
    assert.equal(runtimeOf({ agent: 'copilot', projectPath: '/p', atMs: T0 + 20 * min, runs: r }), 'host', 'after the run ended');
    assert.equal(runtimeOf({ agent: 'copilot', projectPath: '/other', atMs: T0 + 5 * min, runs: r }), 'host', 'another project');
    assert.equal(runtimeOf({ agent: 'pi', projectPath: '/p', atMs: T0 + 5 * min, runs: r }), 'host', 'another agent');
  });

  test('before recording began, or with no registry, a non-opencode observation is unmarked', () => {
    const r = runs({ event: 'start', name: 'b', agent: 'pi', workspace: '/p', pid: 1, at: T0 });
    assert.equal(runtimeOf({ agent: 'pi', projectPath: '/p', atMs: T0 - min, runs: r }), null);
    assert.equal(runtimeOf({ agent: 'pi', projectPath: '/p', atMs: T0, runs: readBoxSessions({ text: '', alive }) }), null);
  });
});

describe('a session launched before recording began', () => {
  const r = runs({ event: 'start', name: 'b', agent: 'pi', workspace: '/other', pid: 1, at: T0 });

  test('is unmarked even when it observes after recording began — never "host"', () => {
    assert.equal(runtimeOf({ agent: 'claude', projectPath: '/p', sessionId: 'old', sessionStartMs: T0 - 60 * min, atMs: T0 + 30 * min, runs: r }), null);
    assert.equal(runtimeOf({ agent: 'pi', projectPath: '/p', sessionStartMs: T0 - min, atMs: T0 + 30 * min, runs: r }), null);
  });

  test('one launched after it with no box run is host', () => {
    assert.equal(runtimeOf({ agent: 'claude', projectPath: '/p', sessionId: 'new', sessionStartMs: T0 + min, atMs: T0 + 30 * min, runs: r }), 'host');
  });

  test('a box match still wins over an old start (a --continue resumed in the box)', () => {
    const boxed = runs({ event: 'start', name: 'b', agent: 'claude', workspace: '/p', mode: 'box', pid: 1, at: T0 });
    assert.equal(runtimeOf({ agent: 'claude', projectPath: '/p', sessionId: 'old', sessionStartMs: T0 - 60 * min, atMs: T0 + min, runs: boxed }), 'box');
  });

  test('transcriptStartMs: the first timestamp in the transcript', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'box-sessions-'));
    const f = path.join(dir, 's.jsonl');
    fs.writeFileSync(f, `{"type":"summary"}\n{"type":"user","timestamp":"2026-11-10T08:00:00.000Z"}\n{"timestamp":"2026-11-11T08:00:00.000Z"}\n`);
    assert.equal(transcriptStartMs(f), Date.parse('2026-11-10T08:00:00.000Z'));
    fs.writeFileSync(f, '{"timestamp":1762848000000}\n');
    assert.equal(transcriptStartMs(f), 1762848000000);
    assert.equal(transcriptStartMs(path.join(dir, 'absent.jsonl')), undefined);
  });
});

describe('wiring', () => {
  const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');

  test('the host launcher records the start and, in its finally, the end of every box run', () => {
    const src = read('scripts/agent-box.mjs');
    assert.match(src, /recordBoxEvent\(\{\s*event: 'start', name, agent, workspace, mode: strict \? 'strict' : 'box'/);
    assert.match(src, /\} finally \{[\s\S]{0,80}recordBoxEvent\(\{ event: 'end', name \}\)/);
  });

  test('runtime travels ETM metadata → export row → /api/coding/observations', () => {
    assert.match(read('scripts/enhanced-transcript-monitor.js'), /runtime: this\._observationRuntime\(exchanges\)/);
    assert.match(read('scripts/enhanced-transcript-monitor.js'), /sessionStartMs: this\._transcriptStartMs\(tp\)/);
    assert.match(read('src/live-logging/ObservationExporter.js'), /runtime: m\.runtime \|\| null/);
    assert.match(read('scripts/observations-api-server.mjs'), /runtime: typeof r\.runtime === 'string' \? r\.runtime : null/);
    assert.match(read('integrations/system-health-dashboard/src/components/observation-card.tsx'), /<RuntimeBadge runtime=\{observation\.runtime\} \/>/);
  });
});
