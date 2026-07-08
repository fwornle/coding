// tests/context-turns/cache-split.test.mjs
//
// Behavior (RESEARCH Test Map): cache split carried separately
// (input/read/write/output), never folded into a single total. Implemented in 84-04.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFixture } from './_helpers.mjs';
import { buildAnthropicLine } from '../../../_work/rapid-llm-proxy/proxy-bridge/context-turns.mjs';

const anthropicBody = loadFixture('anthropic-messages-body.json');

test('cache split (input/read/write/output) is carried separately, never folded', () => {
  const line = buildAnthropicLine({
    reqJson: anthropicBody,
    taskId: '84-cache-split-r0',
    agent: 'claude',
    requestId: 'req-cache',
    model: anthropicBody.model,
    usage: { input: 100, output: 200, cache_read: 300, cache_write: 400 },
    categories: [],
  });

  // The four cache/token fields live SEPARATELY under usage.
  assert.deepEqual(line.usage, { input: 100, output: 200, cache_read: 300, cache_write: 400 });
  for (const k of ['input', 'output', 'cache_read', 'cache_write']) {
    assert.equal(typeof line.usage[k], 'number', `usage.${k} is a distinct number`);
  }

  // No folded `total` anywhere on the line or its usage object (D-09).
  assert.ok(!('total' in line.usage), 'usage has no folded total');
  assert.ok(!('total' in line), 'line has no folded total');
  assert.ok(!('total_tokens' in line.usage), 'usage has no total_tokens');

  // The >=2 ephemeral cache_control blocks in the fixture (system + first user
  // message) drive a non-empty message-index breakpoint list.
  assert.ok(Array.isArray(line.cache_breakpoints), 'cache_breakpoints is an array of indices');
  assert.ok(line.cache_breakpoints.length >= 1, 'non-empty cache breakpoint indices');
  assert.ok(line.cache_breakpoints.includes(0), 'first user message (index 0) is a breakpoint');
});
