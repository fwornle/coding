// tests/retrieval/capture-store.test.mjs
//
// Per-turn KB retrieval capture (src/retrieval/capture-store.js).
//
// The behaviour under test is the fix for three concrete defects in the previous
// writer, which wrote `<task_id>.json` and OVERWROTE it on every retrieval:
//
//   1. a multi-turn session kept only its LAST turn (task_id is the session UUID),
//   2. a zero-item result was discarded entirely — so "nothing was injected, and
//      here is why" left no record at all,
//   3. an obs-api restart mid-session would have restarted turn numbering at 0.
//
// node:test + node:assert/strict (matching tests/context-turns house style).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  appendCapture,
  readCaptures,
  sanitizeCaptureId,
  _resetTurnCounters,
} from '../../src/retrieval/capture-store.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'retrieval-captures-'));
}

const result = (items, trace = null) => ({
  items,
  trace,
  meta: { query: 'q', budget: 1000, results_count: items.length },
});

const item = (id, tier = 'insights') => ({ id, tier, rrfScore: 0.3, score: 0.8, payload: { topic: id } });

test('appends one line per turn with an incrementing ordinal', () => {
  const dir = tmpDir();
  _resetTurnCounters();
  try {
    assert.equal(appendCapture({ dir, taskId: 'sess-1', result: result([item('a')]) }), 0);
    assert.equal(appendCapture({ dir, taskId: 'sess-1', result: result([item('b')]) }), 1);
    assert.equal(appendCapture({ dir, taskId: 'sess-1', result: result([item('c')]) }), 2);

    const turns = readCaptures({ dir, taskId: 'sess-1' });
    assert.equal(turns.length, 3, 'all three turns must survive — not just the last');
    assert.deepEqual(turns.map((t) => t.turn), [0, 1, 2]);
    assert.deepEqual(turns.map((t) => t.items[0].id), ['a', 'b', 'c']);
    assert.ok(turns[0].capturedAt, 'each turn carries its own capturedAt');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('records a zero-item result when a trace explains the silence', () => {
  const dir = tmpDir();
  _resetTurnCounters();
  try {
    const trace = { stages: [{ name: 'judge', in: 6, out: 0, dropped: ['x'] }] };
    assert.equal(appendCapture({ dir, taskId: 'sess-empty', result: result([], trace) }), 0);

    const turns = readCaptures({ dir, taskId: 'sess-empty' });
    assert.equal(turns.length, 1, 'a zero-item turn with a trace MUST be recorded');
    assert.deepEqual(turns[0].items, []);
    assert.deepEqual(turns[0].trace, trace);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('writes nothing when there is neither an item nor a trace', () => {
  const dir = tmpDir();
  _resetTurnCounters();
  try {
    assert.equal(appendCapture({ dir, taskId: 'sess-nil', result: result([]) }), null);
    assert.equal(appendCapture({ dir, taskId: '', result: result([item('a')]) }), null, 'no task id → no capture');
    assert.deepEqual(readCaptures({ dir, taskId: 'sess-nil' }), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('resumes turn numbering from disk after a process restart', () => {
  const dir = tmpDir();
  _resetTurnCounters();
  try {
    appendCapture({ dir, taskId: 'sess-r', result: result([item('a')]) });
    appendCapture({ dir, taskId: 'sess-r', result: result([item('b')]) });

    // Simulate an obs-api restart: in-process counters are gone, the file is not.
    _resetTurnCounters();
    assert.equal(
      appendCapture({ dir, taskId: 'sess-r', result: result([item('c')]) }),
      2,
      'must continue at 2, not collide back at 0',
    );
    assert.deepEqual(readCaptures({ dir, taskId: 'sess-r' }).map((t) => t.turn), [0, 1, 2]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a torn final line does not hide the turns before it', () => {
  const dir = tmpDir();
  _resetTurnCounters();
  try {
    appendCapture({ dir, taskId: 'sess-torn', result: result([item('a')]) });
    appendCapture({ dir, taskId: 'sess-torn', result: result([item('b')]) });
    // Crash mid-append leaves a truncated JSON line.
    fs.appendFileSync(path.join(dir, 'sess-torn.jsonl'), '{"task_id":"sess-torn","tu');

    const turns = readCaptures({ dir, taskId: 'sess-torn' });
    assert.equal(turns.length, 2, 'the two intact turns must still be readable');
    assert.deepEqual(turns.map((t) => t.items[0].id), ['a', 'b']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('falls back to a legacy single-turn .json when no .jsonl exists', () => {
  const dir = tmpDir();
  _resetTurnCounters();
  try {
    // 1402 of these exist in production; they are not migrated.
    fs.writeFileSync(
      path.join(dir, 'sess-legacy.json'),
      JSON.stringify({ task_id: 'sess-legacy', capturedAt: '2026-08-01T00:00:00.000Z', meta: {}, items: [item('old')] }),
    );
    const turns = readCaptures({ dir, taskId: 'sess-legacy' });
    assert.equal(turns.length, 1);
    assert.equal(turns[0].turn, 0);
    assert.equal(turns[0].legacy, true, 'legacy captures are flagged so the UI can say so');
    assert.equal(turns[0].items[0].id, 'old');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('.jsonl wins when both formats exist', () => {
  const dir = tmpDir();
  _resetTurnCounters();
  try {
    fs.writeFileSync(path.join(dir, 'sess-both.json'), JSON.stringify({ items: [item('legacy')] }));
    appendCapture({ dir, taskId: 'sess-both', result: result([item('current')]) });

    const turns = readCaptures({ dir, taskId: 'sess-both' });
    assert.equal(turns.length, 1);
    assert.equal(turns[0].items[0].id, 'current');
    assert.notEqual(turns[0].legacy, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('task ids are sanitized identically for read and write', () => {
  const dir = tmpDir();
  _resetTurnCounters();
  try {
    // Experiment cell ids ('<exp>--<variant>--rN') and path-traversal attempts alike.
    const nasty = '../../etc/passwd';
    assert.equal(sanitizeCaptureId(nasty), '.._.._etc_passwd');
    appendCapture({ dir, taskId: nasty, result: result([item('a')]) });
    assert.equal(fs.existsSync(path.join(dir, '.._.._etc_passwd.jsonl')), true);
    assert.equal(readCaptures({ dir, taskId: nasty }).length, 1, 'reader must resolve the same file');

    const cell = 'exp-x-abc--claude-sonnet-straight-kb-on--r0';
    appendCapture({ dir, taskId: cell, result: result([item('a')]) });
    assert.equal(readCaptures({ dir, taskId: cell }).length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('never throws on an unwritable directory', () => {
  const notes = [];
  // A path whose parent is a FILE — mkdirSync must fail.
  const dir = tmpDir();
  const blocked = path.join(dir, 'afile', 'sub');
  fs.writeFileSync(path.join(dir, 'afile'), 'x');
  try {
    assert.equal(
      appendCapture({ dir: blocked, taskId: 's', result: result([item('a')]), log: (m) => notes.push(m) }),
      null,
    );
    assert.equal(notes.length, 1, 'the failure is reported, not thrown');
    assert.match(notes[0], /append failed/);
    assert.deepEqual(readCaptures({ dir: blocked, taskId: 's' }), [], 'read degrades to empty');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
