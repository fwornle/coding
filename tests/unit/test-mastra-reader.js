/**
 * Unit tests for MastraTranscriptReader
 *
 * Activated by Plan 21-03 -- validates the interface contract for the
 * mastracode transcript reader and hook NDJSON parsing.
 */

import assert from 'node:assert';
import { describe, it } from 'node:test';
import MastraTranscriptReader from '../../src/live-logging/MastraTranscriptReader.js';

describe('MastraTranscriptReader', () => {
  it('should export a MastraTranscriptReader class', () => {
    assert.ok(MastraTranscriptReader, 'MastraTranscriptReader should be exported');
    assert.strictEqual(typeof MastraTranscriptReader, 'function');
  });

  it('should be constructable with a transcript path', () => {
    const reader = new MastraTranscriptReader('/tmp/test-transcripts');
    assert.ok(reader, 'Reader should be instantiated');
    assert.strictEqual(reader.transcriptDir, '/tmp/test-transcripts');
  });

  it('should have start and stop methods', () => {
    const reader = new MastraTranscriptReader('/tmp/test-transcripts');
    assert.strictEqual(typeof reader.start, 'function');
    assert.strictEqual(typeof reader.stop, 'function');
  });

  it('should have a static extractExchangesFromBatch method', () => {
    assert.strictEqual(typeof MastraTranscriptReader.extractExchangesFromBatch, 'function');
  });
});

describe('MastraTranscriptReader.extractExchangesFromBatch', () => {
  it('should extract a user->assistant exchange', () => {
    const events = [
      { type: 'message', role: 'user', content: 'fix the bug', timestamp: '2026-04-02T10:00:00Z' },
      { type: 'message', role: 'assistant', content: 'I will fix it', timestamp: '2026-04-02T10:00:05Z' }
    ];
    const exchanges = MastraTranscriptReader.extractExchangesFromBatch(events);
    assert.strictEqual(exchanges.length, 1);
    assert.strictEqual(exchanges[0].humanMessage, 'fix the bug');
    assert.strictEqual(exchanges[0].assistantMessage, 'I will fix it');
    assert.strictEqual(exchanges[0].metadata.agent, 'mastra');
  });

  it('should handle onStepFinish as assistant response', () => {
    const events = [
      { type: 'message', role: 'user', content: 'run tests', timestamp: '2026-04-02T10:00:00Z' },
      { type: 'onStepFinish', output: 'All 5 tests passed', timestamp: '2026-04-02T10:00:10Z' }
    ];
    const exchanges = MastraTranscriptReader.extractExchangesFromBatch(events);
    assert.strictEqual(exchanges.length, 1);
    assert.strictEqual(exchanges[0].assistantMessage, 'All 5 tests passed');
  });

  it('should accumulate tool calls within an exchange', () => {
    const events = [
      { type: 'message', role: 'user', content: 'read the file', timestamp: '2026-04-02T10:00:00Z' },
      { type: 'onToolCall', tool: 'read_file', input: { path: '/tmp/test.js' }, timestamp: '2026-04-02T10:00:02Z' },
      { type: 'message', role: 'assistant', content: 'Here is the file content', timestamp: '2026-04-02T10:00:05Z' }
    ];
    const exchanges = MastraTranscriptReader.extractExchangesFromBatch(events);
    assert.strictEqual(exchanges.length, 1);
    assert.strictEqual(exchanges[0].toolCalls.length, 1);
    assert.strictEqual(exchanges[0].toolCalls[0].name, 'read_file');
  });

  it('should handle multiple exchanges', () => {
    const events = [
      { type: 'message', role: 'user', content: 'first question', timestamp: '2026-04-02T10:00:00Z' },
      { type: 'message', role: 'assistant', content: 'first answer', timestamp: '2026-04-02T10:00:05Z' },
      { type: 'message', role: 'user', content: 'second question', timestamp: '2026-04-02T10:01:00Z' },
      { type: 'message', role: 'assistant', content: 'second answer', timestamp: '2026-04-02T10:01:05Z' }
    ];
    const exchanges = MastraTranscriptReader.extractExchangesFromBatch(events);
    assert.strictEqual(exchanges.length, 2);
  });

  it('should skip session_start and session_end events', () => {
    const events = [
      { type: 'session_start', sessionId: 'abc-123' },
      { type: 'message', role: 'user', content: 'hello', timestamp: '2026-04-02T10:00:00Z' },
      { type: 'message', role: 'assistant', content: 'hi', timestamp: '2026-04-02T10:00:01Z' },
      { type: 'session_end', sessionId: 'abc-123' }
    ];
    const exchanges = MastraTranscriptReader.extractExchangesFromBatch(events);
    assert.strictEqual(exchanges.length, 1);
  });

  it('should return empty array for empty input', () => {
    const exchanges = MastraTranscriptReader.extractExchangesFromBatch([]);
    assert.strictEqual(exchanges.length, 0);
  });
});

describe('Hook NDJSON parsing', () => {
  it('should parse a single NDJSON line into a hook event', () => {
    const input = '{"type":"message","role":"assistant","content":"Hello"}';
    const parsed = JSON.parse(input);
    assert.strictEqual(parsed.type, 'message');
    assert.strictEqual(parsed.role, 'assistant');
    assert.strictEqual(parsed.content, 'Hello');
  });

  it('should handle multi-line NDJSON stream', () => {
    const lines = [
      '{"type":"session_start","sessionId":"abc-123"}',
      '{"type":"message","role":"user","content":"fix the bug"}',
      '{"type":"message","role":"assistant","content":"I will fix it"}',
      '{"type":"session_end","sessionId":"abc-123"}',
    ];
    const events = lines.map((l) => JSON.parse(l));
    assert.strictEqual(events.length, 4);
    assert.strictEqual(events[0].type, 'session_start');
    assert.strictEqual(events[3].type, 'session_end');
  });

  it('should reject malformed NDJSON lines gracefully', () => {
    const badLine = '{"type":"message", broken json';
    assert.throws(() => JSON.parse(badLine), SyntaxError);
  });
});
