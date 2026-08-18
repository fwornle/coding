/**
 * Unit tests for PiSessionReader
 *
 * Validates the interface contract for the pi session reader and the parsing of
 * pi's native session JSONL (docs/session-format.md, session version 3).
 *
 * Replaces test-mastra-reader.js. The fixture at tests/fixtures/pi/ is part real
 * and part synthetic, deliberately: its header/model_change/thinking_level_change
 * lines were captured from an actual `coding --pi` session, while the tool-using
 * turn is constructed from pi's documented block types because the provider
 * outage at the time made a live tool turn impossible to record. Anything
 * asserted about tool handling therefore tests our parser against the published
 * contract, not against an observed exchange.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PiSessionReader from '../../src/live-logging/PiSessionReader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, '..', 'fixtures', 'pi', 'pi-session-sample.jsonl');

function loadFixture() {
  return fs.readFileSync(FIXTURE, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

describe('PiSessionReader', () => {
  it('should export a PiSessionReader class', () => {
    assert.ok(PiSessionReader, 'PiSessionReader should be exported');
    assert.strictEqual(typeof PiSessionReader, 'function');
  });

  it('should be constructable with a session path', () => {
    const reader = new PiSessionReader('/tmp/test-pi-sessions');
    assert.ok(reader);
    assert.strictEqual(reader.transcriptDir, '/tmp/test-pi-sessions');
  });

  it('should have start and stop methods', () => {
    const reader = new PiSessionReader('/tmp/test-pi-sessions');
    assert.strictEqual(typeof reader.start, 'function');
    assert.strictEqual(typeof reader.stop, 'function');
  });

  it('should have a static extractExchangesFromBatch method', () => {
    assert.strictEqual(typeof PiSessionReader.extractExchangesFromBatch, 'function');
  });

  it('only treats .jsonl as a session file', () => {
    const reader = new PiSessionReader('/tmp/test-pi-sessions');
    assert.strictEqual(reader._isTranscriptFile('2026-08-18T09-59-04-455Z_uuid.jsonl'), true);
    // mastra's reader also accepted .ndjson; pi only ever writes .jsonl.
    assert.strictEqual(reader._isTranscriptFile('transcript.ndjson'), false);
    assert.strictEqual(reader._isTranscriptFile('notes.md'), false);
  });
});

describe('PiSessionReader entry normalization', () => {
  const reader = () => new PiSessionReader('/tmp/test-pi-sessions');

  it('extracts text from pi content BLOCKS, not a bare string', () => {
    const r = reader();
    const msgs = r._normalizeEntry({
      type: 'message',
      id: 'm1',
      timestamp: '2026-08-18T09:59:36.504Z',
      message: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    }, '/f.jsonl');
    assert.strictEqual(msgs.length, 1);
    assert.strictEqual(msgs[0].role, 'user');
    assert.strictEqual(msgs[0].content, 'hello');
    assert.strictEqual(msgs[0].metadata.agent, 'pi');
  });

  it('EXCLUDES thinking blocks from content', () => {
    const r = reader();
    const msgs = r._normalizeEntry({
      type: 'message',
      id: 'm2',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'internal reasoning the user never saw' },
          { type: 'text', text: 'the answer' },
        ],
      },
    }, '/f.jsonl');
    const assistant = msgs.find((m) => m.role === 'assistant');
    assert.strictEqual(assistant.content, 'the answer');
    assert.ok(!assistant.content.includes('internal reasoning'));
  });

  it('emits tool calls BEFORE the assistant text of the same entry', () => {
    // Ordering matters: _detectExchange closes the exchange on the assistant
    // message, so text-first would strand the tool calls after the flush.
    const r = reader();
    const msgs = r._normalizeEntry({
      type: 'message',
      id: 'm3',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'running it' },
          { type: 'toolCall', id: 'tc1', name: 'bash', arguments: { cmd: 'ls' } },
        ],
      },
    }, '/f.jsonl');
    assert.deepStrictEqual(msgs.map((m) => m.role), ['tool', 'assistant']);
    assert.strictEqual(msgs[0].metadata.tool, 'bash');
  });

  it('carries pi usage through on assistant messages', () => {
    // mastra reported no output tokens, which forced a zero-token special case
    // downstream. pi reports real usage, so this asserts it survives.
    const r = reader();
    const msgs = r._normalizeEntry({
      type: 'message',
      id: 'm4',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'done' }],
        model: 'claude-sonnet-5',
        provider: 'rapid-proxy-pi',
        usage: { input: 10, output: 5, totalTokens: 15 },
        stopReason: 'stop',
      },
    }, '/f.jsonl');
    const assistant = msgs.find((m) => m.role === 'assistant');
    assert.strictEqual(assistant.metadata.usage.output, 5);
    assert.strictEqual(assistant.metadata.model, 'claude-sonnet-5');
    assert.strictEqual(assistant.metadata.stopReason, 'stop');
  });

  it('maps the toolResult role (pi does not use "tool")', () => {
    const r = reader();
    const msgs = r._normalizeEntry({
      type: 'message',
      id: 'm5',
      message: {
        role: 'toolResult',
        toolCallId: 'tc1',
        toolName: 'bash',
        content: [{ type: 'text', text: 'output here' }],
        isError: false,
      },
    }, '/f.jsonl');
    assert.strictEqual(msgs.length, 1);
    assert.strictEqual(msgs[0].role, 'tool');
    assert.strictEqual(msgs[0].metadata.tool, 'bash');
    assert.strictEqual(msgs[0].metadata.isError, false);
  });

  it('ignores non-message entries', () => {
    const r = reader();
    assert.deepStrictEqual(r._normalizeEntry({ type: 'model_change', provider: 'x' }, '/f.jsonl'), []);
    assert.deepStrictEqual(r._normalizeEntry({ type: 'thinking_level_change' }, '/f.jsonl'), []);
    assert.deepStrictEqual(r._normalizeEntry(null, '/f.jsonl'), []);
  });
});

describe('PiSessionReader.extractExchangesFromBatch', () => {
  it('spans a tool round-trip in ONE exchange', () => {
    const exchanges = PiSessionReader.extractExchangesFromBatch(loadFixture());
    assert.strictEqual(exchanges.length, 1, 'the tool-call turn must not split the exchange');
    const [ex] = exchanges;
    assert.strictEqual(ex.humanMessage, 'Count the TODOs in src/');
    assert.strictEqual(ex.assistantMessage, 'There are 3 TODOs in src/.');
    assert.deepStrictEqual(ex.toolCalls.map((t) => t.type), ['toolCall', 'toolResult']);
    assert.strictEqual(ex.metadata.agent, 'pi');
  });

  it('takes the session id from the session header line', () => {
    const [ex] = PiSessionReader.extractExchangesFromBatch(loadFixture());
    // pi records the id ONLY in the header; message lines have none of their own.
    assert.ok(ex.metadata.sessionId, 'sessionId should be resolved from the header');
    assert.match(ex.metadata.sessionId, /^[0-9a-f-]{36}$/);
  });

  it('returns nothing for a session with no messages', () => {
    const headerOnly = [{ type: 'session', version: 3, id: 'abc', cwd: '/tmp' }];
    assert.deepStrictEqual(PiSessionReader.extractExchangesFromBatch(headerOnly), []);
  });
});
