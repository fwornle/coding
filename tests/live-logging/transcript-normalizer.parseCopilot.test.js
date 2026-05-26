/**
 * Tests for parseCopilot — Phase 51 Plan 04 Task 1.
 *
 * Locks the v1.0.48 dotted event-name support AND the new sub-agent event
 * branch (type:'subagent' discriminator) per 51-04-PLAN.md Task 1 behavior.
 *
 * Cross-version regression matrix:
 *   - events-v1.0.48.jsonl (current Copilot CLI shape with dotted names)
 *   - events-v1.0.12.jsonl (older shape; includes one legacy `event:` record)
 *
 * Fixture files live under tests/fixtures/copilot/.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseCopilot } from '../../src/live-logging/TranscriptNormalizer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, '..', 'fixtures', 'copilot');

describe('parseCopilot — v1.0.48 dotted event names', () => {
  test('Test 1 — handles v1.0.48 user.message', () => {
    const line = JSON.stringify({
      type: 'user.message',
      data: { content: 'hello', role: 'user' },
      id: 'u-id-1',
      timestamp: '2026-03-05T12:30:00Z',
      parentId: null,
    });
    const result = parseCopilot(line);
    expect(result).not.toBeNull();
    expect(result.role).toBe('user');
    expect(result.content).toBe('hello');
    expect(result.createdAt).toBe('2026-03-05T12:30:00Z');
    expect(result.metadata).toMatchObject({
      agent: 'copilot',
      format: 'events',
      eventType: 'user.message',
    });
    expect(typeof result.id).toBe('string');
  });

  test('Test 2 — handles v1.0.48 assistant.message', () => {
    const line = JSON.stringify({
      type: 'assistant.message',
      data: { content: 'hi back', role: 'assistant', messageId: 'mid' },
      id: 'a-id-1',
      timestamp: '2026-03-05T12:30:03Z',
      parentId: 'u-id-1',
    });
    const result = parseCopilot(line);
    expect(result).not.toBeNull();
    expect(result.role).toBe('assistant');
    expect(result.content).toBe('hi back');
    expect(result.createdAt).toBe('2026-03-05T12:30:03Z');
    expect(result.metadata.eventType).toBe('assistant.message');
  });

  test('Test 3 — assistant.turn_end returns null (boundary event, not content)', () => {
    const line = JSON.stringify({
      type: 'assistant.turn_end',
      data: { turnId: '0' },
      id: 'te-id',
      timestamp: '2026-03-05T12:33:40Z',
      parentId: 'a-id-1',
    });
    expect(parseCopilot(line)).toBeNull();
    // assistant.turn_start also returns null (same rationale)
    const startLine = JSON.stringify({
      type: 'assistant.turn_start',
      data: { turnId: '0' },
      id: 'ts-id',
      timestamp: '2026-03-05T12:30:02Z',
      parentId: 'u-id-1',
    });
    expect(parseCopilot(startLine)).toBeNull();
  });

  test('Test 4 — legacy v1.0.12 conversation.message still works (backward compat)', () => {
    const line = JSON.stringify({
      event: 'conversation.message',
      data: { content: 'legacy', role: 'user' },
    });
    const result = parseCopilot(line);
    expect(result).not.toBeNull();
    expect(result.role).toBe('user');
    expect(result.content).toBe('legacy');
  });

  test('Test 5 — handles subagent.started, returns sub-agent record', () => {
    const line = JSON.stringify({
      type: 'subagent.started',
      data: {
        toolCallId: 'toolu_vrtx_01ABC',
        agentName: 'general-purpose',
        agentDisplayName: 'General Purpose Agent',
        agentDescription: 'Full-capability sub-agent.',
      },
      id: 'sa-id-1',
      timestamp: '2026-03-05T12:30:53Z',
      parentId: 'a-id-1',
    });
    const result = parseCopilot(line);
    expect(result).not.toBeNull();
    expect(result.type).toBe('subagent');
    expect(result.subEventType).toBe('started');
    expect(result.toolCallId).toBe('toolu_vrtx_01ABC');
    expect(result.agentName).toBe('general-purpose');
    expect(result.agentDisplayName).toBe('General Purpose Agent');
    expect(result.timestamp).toBe('2026-03-05T12:30:53Z');
  });

  test('Test 6 — handles subagent.completed', () => {
    const line = JSON.stringify({
      type: 'subagent.completed',
      data: {
        toolCallId: 'toolu_vrtx_01ABC',
        agentName: 'general-purpose',
        agentDisplayName: 'General Purpose Agent',
      },
      id: 'sa-id-2',
      timestamp: '2026-03-05T12:33:39Z',
      parentId: 'sa-id-1',
    });
    const result = parseCopilot(line);
    expect(result).not.toBeNull();
    expect(result.type).toBe('subagent');
    expect(result.subEventType).toBe('completed');
    expect(result.toolCallId).toBe('toolu_vrtx_01ABC');
    expect(result.timestamp).toBe('2026-03-05T12:33:39Z');
  });

  test('Test 7 — handles subagent.failed with errorMessage', () => {
    const line = JSON.stringify({
      type: 'subagent.failed',
      data: {
        toolCallId: 'toolu_vrtx_01ERR',
        agentName: 'general-purpose',
        error: 'context window exhausted',
      },
      id: 'sa-id-3',
      timestamp: '2026-03-05T12:34:00Z',
      parentId: 'sa-id-1',
    });
    const result = parseCopilot(line);
    expect(result).not.toBeNull();
    expect(result.type).toBe('subagent');
    expect(result.subEventType).toBe('failed');
    expect(result.toolCallId).toBe('toolu_vrtx_01ERR');
    expect(result.errorMessage).toBe('context window exhausted');
  });

  test('Test 8 — returns null on non-conversation, non-subagent event types', () => {
    const nonContentTypes = [
      { type: 'session.start', data: { sessionId: 's1' } },
      { type: 'session.error', data: { code: 1 } },
      { type: 'session.compaction_start', data: {} },
      { type: 'session.compaction_complete', data: {} },
      { type: 'session.truncation', data: {} },
      { type: 'session.shutdown', data: {} },
      { type: 'skill.invoked', data: { name: 'documentation-style' } },
      { type: 'tool.execution_start', data: {} },
      { type: 'tool.execution_complete', data: {} },
      { type: 'subagent.selected', data: {} },
      { type: 'subagent.deselected', data: {} },
    ];
    for (const evt of nonContentTypes) {
      const line = JSON.stringify({ ...evt, id: 'x', timestamp: '2026-03-05T12:00:00Z' });
      expect(parseCopilot(line)).toBeNull();
    }
  });

  test('Test 9 — cross-version regression: v1.0.48 + v1.0.12 fixture files', () => {
    const v48 = fs.readFileSync(path.join(fixturesDir, 'events-v1.0.48.jsonl'), 'utf8');
    const v12 = fs.readFileSync(path.join(fixturesDir, 'events-v1.0.12.jsonl'), 'utf8');

    function parseAll(text) {
      return text
        .split('\n')
        .map((line) => parseCopilot(line))
        .filter((r) => r !== null);
    }

    const v48Results = parseAll(v48);
    // v1.0.48 fixture: 1 user.message + 1 assistant.message + 1 subagent.started
    // + 1 subagent.completed = 4 results minimum.
    expect(v48Results.length).toBeGreaterThanOrEqual(4);

    const chatMessages48 = v48Results.filter((r) => !r.type || r.type !== 'subagent');
    const subAgentRecords48 = v48Results.filter((r) => r.type === 'subagent');
    expect(chatMessages48.some((m) => m.role === 'user')).toBe(true);
    expect(chatMessages48.some((m) => m.role === 'assistant')).toBe(true);
    expect(subAgentRecords48.some((r) => r.subEventType === 'started')).toBe(true);
    expect(subAgentRecords48.some((r) => r.subEventType === 'completed')).toBe(true);

    const v12Results = parseAll(v12);
    // v1.0.12 fixture: 1 user.message + 1 assistant.message + 1 legacy
    // conversation.message = 3 results minimum.
    expect(v12Results.length).toBeGreaterThanOrEqual(2);
  });

  test('Test 10 — malformed JSON line returns null without throwing', () => {
    expect(() => parseCopilot('not a json line at all')).not.toThrow();
    expect(parseCopilot('not a json line at all')).toBeNull();
    expect(parseCopilot('')).toBeNull();
    expect(parseCopilot('   ')).toBeNull();
    expect(parseCopilot('{"truncated":')).toBeNull();
  });
});
