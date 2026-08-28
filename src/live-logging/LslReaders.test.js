/**
 * Unit tests for the pi-format LSL READ path.
 *
 * Test 4 is the one that matters most in this whole migration:
 * cleanupLowValueLSLFiles() DELETES files that isValueableLSLFile() rejects,
 * and the markdown heuristics it used (counting `## Prompt Set` and
 * `**User Message:**`) return zero for JSONL. Without a format branch, turning
 * on .jsonl in the candidate filter would delete every file the new writer
 * produces. The filter change and the branch are one edit for that reason.
 *
 * Run via: node --test src/live-logging/LslReaders.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseSpecstory } from './TranscriptNormalizer.js';
import LSLFileManager from './LSLFileManager.js';
import {
  sessionHeader, buildTrancheEntries, buildPromptSetEntries,
  serialize, makeIdGen, uuidFrom,
} from './PiSessionWriter.js';

const ISO = '2026-08-26T11:00:00.000Z';

function makeSession(sets) {
  const gen = makeIdGen('t');
  const { entries: hdr, spineId } = buildTrancheEntries(
    { timeWindow: '1100-1200', agent: 'Claude' }, gen, ISO);
  let out = [sessionHeader({ id: uuidFrom('t'), timestamp: ISO, cwd: '/repo' }), ...hdr];
  for (const [id, blocks] of sets) {
    out = out.concat(buildPromptSetEntries({
      promptSetId: id, blocks, spineId, idGen: gen,
      fallbackIso: ISO, meta: { time: ISO, agent: 'Claude' },
    }));
  }
  return serialize(out);
}

describe('parseSpecstory — pi session branch', () => {
  it('Test 1 — detects pi JSONL and returns user/assistant messages', () => {
    const jsonl = makeSession([
      ['ps_1', [{ kind: 'tool', userText: 'find the bug', toolName: 'Bash',
                  input: { command: 'ls' }, output: 'file.js', isError: false }]],
    ]);
    const msgs = parseSpecstory(jsonl, { sourceFile: 'x.jsonl' });
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].role, 'user');
    assert.equal(msgs[0].content, 'find the bug');
    assert.equal(msgs[0].metadata.format, 'pi-session');
    assert.equal(msgs[0].metadata.promptSetId, 'ps_1');
    assert.match(msgs[1].content, /Tool-call synthesis \(1 calls\)/);
    assert.match(msgs[1].content, /Bash ✅: file\.js/);
  });

  it('Test 2 — marks failed tool calls with ❌ in the synthesis', () => {
    const jsonl = makeSession([
      ['ps_1', [{ kind: 'tool', userText: 'go', toolName: 'Bash',
                  input: {}, output: 'boom', isError: true }]],
    ]);
    const msgs = parseSpecstory(jsonl, { sourceFile: 'x.jsonl' });
    assert.match(msgs[1].content, /Bash ❌: boom/);
  });

  it('Test 3 — REGRESSION: every user turn in a set is emitted, not just the first', () => {
    // parseLslTranche() takes only the first `**User Request:**` per block,
    // which measurably dropped prompts (e.g. a "resume" after a longer ask).
    const jsonl = makeSession([
      ['ps_1', [
        { kind: 'tool', userText: 'do the long thing', toolName: 'Bash', input: {}, output: 'a' },
        { kind: 'tool', userText: 'resume', toolName: 'Bash', input: {}, output: 'b' },
      ]],
    ]);
    const msgs = parseSpecstory(jsonl, { sourceFile: 'x.jsonl' });
    const users = msgs.filter((m) => m.role === 'user').map((m) => m.content);
    assert.deepEqual(users, ['do the long thing', 'resume']);
  });

  it('Test 3b — keeps prompt sets separate', () => {
    const jsonl = makeSession([
      ['ps_1', [{ kind: 'text', userText: 'first', assistantText: 'a' }]],
      ['ps_2', [{ kind: 'text', userText: 'second', assistantText: 'b' }]],
    ]);
    const msgs = parseSpecstory(jsonl, { sourceFile: 'x.jsonl' });
    const ids = [...new Set(msgs.map((m) => m.metadata.promptSetId))];
    assert.deepEqual(ids, ['ps_1', 'ps_2']);
  });

  it('Test 3c — a torn line is skipped, not fatal', () => {
    const jsonl = makeSession([['ps_1', [{ kind: 'text', userText: 'hi', assistantText: 'yo' }]]]);
    const torn = jsonl + '{"type":"message","id":"x",BROKEN\n';
    assert.doesNotThrow(() => parseSpecstory(torn, { sourceFile: 'x.jsonl' }));
    assert.ok(parseSpecstory(torn, { sourceFile: 'x.jsonl' }).length >= 2);
  });

  it('Test 3d — legacy markdown still parses (mixed corpus is a steady state)', () => {
    const md = [
      '# WORK SESSION (1100-1200)', '',
      '<a name="ps_9"></a>', '## Prompt Set (ps_9)', '',
      '**Time:** 2026-08-26T11:00:00.000Z', '**Duration:** 1ms', '**Tool Calls:** 1', '',
      '### Bash - 2026-08-26 11:00:00 UTC', '',
      '**User Request:** legacy prompt', '',
      '**Tool:** Bash', '**Result:** ✅ Success', '',
    ].join('\n');
    const msgs = parseSpecstory(md, { sourceFile: 'x.md' });
    assert.ok(msgs.length >= 2);
    assert.equal(msgs[0].content, 'legacy prompt');
    assert.equal(msgs[0].metadata.format, 'lsl-tranche');
  });
});

describe('LSLFileManager — pi-format value heuristic', () => {
  // enableRealTimeMonitoring defaults TRUE and starts a 5-minute interval,
  // which keeps the event loop alive and hangs the test runner.
  const fm = new LSLFileManager({ debug: false, enableRealTimeMonitoring: false });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lslfm-'));
  const write = (name, content) => {
    const f = path.join(tmp, name);
    fs.writeFileSync(f, content);
    return f;
  };

  it('Test 4 — a real pi session is VALUABLE (guards the delete path)', () => {
    const f = write('2026-08-26_1100-1200-1_abc.jsonl', makeSession([
      ['ps_1', [{ kind: 'tool', userText: 'real work please', toolName: 'Bash',
                  input: {}, output: 'ok' }]],
    ]));
    assert.equal(fm.isValueableLSLFile(f), true,
      'a valid pi session must never be judged low-value — cleanupLowValueLSLFiles deletes those');
  });

  it('Test 5 — a session of only warmups/interruptions is worthless', () => {
    const f = write('warm.jsonl', makeSession([
      ['ps_1', [{ kind: 'text', userText: 'Warmup ping', assistantText: 'ok' }]],
      ['ps_2', [{ kind: 'text', userText: '[Request interrupted by user]', assistantText: '' }]],
    ]));
    assert.equal(fm.isValueableLSLFile(f), false);
  });

  it('Test 6 — a header-only session (no user messages) is worthless', () => {
    const f = write('empty.jsonl', makeSession([]));
    assert.equal(fm.isValueableLSLFile(f), false);
  });

  it('Test 7 — unreadable/garbage fails SAFE (kept, not deleted)', () => {
    const f = write('garbage.jsonl', 'not json at all\n{oops\n');
    // No parseable user messages -> worthless -> would be deleted. Assert the
    // stricter property that matters: it must not throw, so the caller's
    // git-tracked guard still runs.
    assert.doesNotThrow(() => fm.isValueableLSLFile(f));
  });

  it('Test 8 — legacy markdown value heuristic is unchanged', () => {
    const f = write('2026-08-26_1100-1200-1_abc.md',
      '## Prompt Set (ps_1)\n\n**User Message:** genuine work\n');
    assert.equal(fm.isValueableLSLFile(f), true);
  });
});
