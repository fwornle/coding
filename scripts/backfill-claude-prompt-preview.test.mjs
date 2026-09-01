/**
 * Unit suite for `scripts/backfill-claude-prompt-preview.mjs`.
 *
 * The script recovers a caption for ~63k rows that were logged without one, by
 * joining `token_usage.tool_call_id` to the `requestId` Claude Code stamps on
 * each assistant entry in its own transcripts. The join is exact, so the risk is
 * not "did we find a row" but "did we attach the RIGHT prompt to it". Three
 * things decide that, and each has a way of being wrong that looks fine:
 *
 *   1. A tool reply arrives on this wire as a `role: 'user'` message. Treated as
 *      a prompt, it becomes the caption — so a turn gets labelled with tool
 *      output, which is both useless and a far larger disclosure than the
 *      question.
 *   2. The caption must be the prompt of the TURN the request belongs to, not
 *      the session's opening prompt and not a later one.
 *   3. `req_x:reason:0` and `req_x` are the same API call; a per-reasoning-step
 *      row must resolve to the same prompt as its parent turn.
 *
 * The extractor itself is the proxy's own `turnPromptText`, imported by both the
 * script and this suite rather than restated, so a live caption and a backfilled
 * one cannot drift.
 *
 * Run: node --test scripts/backfill-claude-prompt-preview.test.mjs
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  parseArgs,
  baseRequestId,
  indexTranscripts,
  transcriptFiles,
} from './backfill-claude-prompt-preview.mjs';

const PROXY = path.resolve(import.meta.dirname, '..', '..', '_work', 'rapid-llm-proxy');
const { turnPromptText } = await import(
  path.join(PROXY, 'proxy-bridge', 'turn-identity.mjs'));

/** Write a transcript from entry objects and return its path. */
function writeTranscript(dir, name, entries) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
  return p;
}

const userText = (text) => ({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } });
const toolResult = (id, out) => ({
  type: 'user',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: out }] },
});
const assistant = (requestId) => ({
  type: 'assistant', requestId,
  message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
});

describe('baseRequestId collapses a reasoning-step id onto its call', () => {
  test('a :reason: suffix is stripped', () => {
    assert.equal(baseRequestId('req_abc:reason:0'), 'req_abc');
    assert.equal(baseRequestId('req_abc:reason:12'), 'req_abc');
  });
  test('a plain id is unchanged', () => {
    assert.equal(baseRequestId('req_abc'), 'req_abc');
    assert.equal(baseRequestId(''), '');
  });
});

describe('parseArgs', () => {
  test('dry run is the default — writing requires --apply', () => {
    assert.equal(parseArgs([]).apply, false);
    assert.equal(parseArgs(['--apply']).apply, true);
  });
  test('paths and limit are honoured', () => {
    const a = parseArgs(['--db=/tmp/x.db', '--transcripts=/tmp/t', '--limit=5', '-v']);
    assert.equal(a.db, '/tmp/x.db');
    assert.equal(a.transcripts, '/tmp/t');
    assert.equal(a.limit, 5);
    assert.equal(a.verbose, true);
  });
});

describe('indexTranscripts attaches the right prompt to each requestId', () => {
  test('a tool_result never becomes the caption', async () => {
    // THE case. A naive "last user message" would caption req_2 with the tool
    // output, because on this wire a tool reply IS a role:'user' message.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bfpp-'));
    writeTranscript(dir, 'a.jsonl', [
      userText('what is this repo about?'),
      assistant('req_1'),
      toolResult('t1', 'SENSITIVE TOOL OUTPUT README.md src/'),
      assistant('req_2'),
    ]);
    const { byRequestId } = await indexTranscripts(transcriptFiles(dir), turnPromptText);
    assert.equal(byRequestId.get('req_1'), 'what is this repo about?');
    assert.equal(byRequestId.get('req_2'), 'what is this repo about?');
  });

  test('each turn keeps its own prompt, not the session opener', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bfpp-'));
    writeTranscript(dir, 'a.jsonl', [
      userText('first question'),
      assistant('req_1'),
      userText('second question'),
      assistant('req_2'),
      toolResult('t1', 'output'),
      assistant('req_3'),
    ]);
    const { byRequestId } = await indexTranscripts(transcriptFiles(dir), turnPromptText);
    assert.equal(byRequestId.get('req_1'), 'first question');
    // req_2 and req_3 are both calls of turn 2 — same caption.
    assert.equal(byRequestId.get('req_2'), 'second question');
    assert.equal(byRequestId.get('req_3'), 'second question');
  });

  test('a requestId repeated across streamed entries keeps its first turn', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bfpp-'));
    writeTranscript(dir, 'a.jsonl', [
      userText('the real prompt'),
      assistant('req_1'),
      assistant('req_1'),
    ]);
    const { byRequestId } = await indexTranscripts(transcriptFiles(dir), turnPromptText);
    assert.equal(byRequestId.get('req_1'), 'the real prompt');
  });

  test('an assistant entry before any prompt claims nothing', async () => {
    // Better to leave a row empty than to caption it with the next session's
    // question — the whole point of an exact join is not inventing text.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bfpp-'));
    writeTranscript(dir, 'a.jsonl', [assistant('req_orphan'), userText('later')]);
    const { byRequestId } = await indexTranscripts(transcriptFiles(dir), turnPromptText);
    assert.equal(byRequestId.has('req_orphan'), false);
  });

  test('sessions do not leak prompts into each other', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bfpp-'));
    writeTranscript(dir, 'a.jsonl', [userText('session A prompt'), assistant('req_a')]);
    writeTranscript(dir, 'b.jsonl', [assistant('req_b_orphan'), userText('session B prompt'), assistant('req_b')]);
    const { byRequestId, scanned } = await indexTranscripts(transcriptFiles(dir), turnPromptText);
    assert.equal(scanned, 2);
    assert.equal(byRequestId.get('req_a'), 'session A prompt');
    assert.equal(byRequestId.get('req_b'), 'session B prompt');
    // `current` must reset per file, or A's prompt would caption B's orphan.
    assert.equal(byRequestId.has('req_b_orphan'), false);
  });

  test('plain-string content and nested subdirectories both work', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bfpp-'));
    const sub = path.join(dir, '-Users-x-project');
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(sub, 'notes.txt'), 'ignored — not a transcript');
    writeTranscript(sub, 'c.jsonl', [
      { type: 'user', message: { role: 'user', content: 'a plain string prompt' } },
      assistant('req_c'),
    ]);
    const { byRequestId } = await indexTranscripts(transcriptFiles(dir), turnPromptText);
    assert.equal(byRequestId.get('req_c'), 'a plain string prompt');
  });

  test('malformed lines and non-message entries are skipped, not fatal', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bfpp-'));
    const p = writeTranscript(dir, 'a.jsonl', [userText('good prompt'), assistant('req_1')]);
    // Real transcripts carry many bookkeeping types (mode, ai-title, …) plus the
    // occasional truncated line from a killed process.
    fs.appendFileSync(p, '{not json\n\n{"type":"ai-title"}\n' + JSON.stringify(assistant('req_2')) + '\n');
    const { byRequestId } = await indexTranscripts(transcriptFiles(dir), turnPromptText);
    assert.equal(byRequestId.get('req_1'), 'good prompt');
    assert.equal(byRequestId.get('req_2'), 'good prompt');
  });

  test('a missing transcripts directory yields nothing rather than throwing', async () => {
    const { byRequestId, scanned } = await indexTranscripts(
      transcriptFiles('/nonexistent/path/xyz'), turnPromptText);
    assert.equal(scanned, 0);
    assert.equal(byRequestId.size, 0);
  });
});
