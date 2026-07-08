// tests/context-turns/openai-wire.test.mjs
//
// Behavior (RESEARCH Test Map): OpenAI-wire line marks cache_write as
// provider-none (the N/A discriminator — OpenAI /api/complete has no cache
// breakpoint concept). Implemented in 84-04.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFixture } from './_helpers.mjs';
import { buildOpenAILine } from '../../../_work/rapid-llm-proxy/proxy-bridge/context-turns.mjs';

const openaiBody = loadFixture('openai-complete-body.json');

test('OpenAI-wire line marks cache_write as provider-none (N/A discriminator)', () => {
  const line = buildOpenAILine({
    internalBody: openaiBody.internalBody,
    taskId: openaiBody.task_id,
    agent: openaiBody.agent,
    requestId: 'shim-xyz',
    model: openaiBody.internalBody.model,
    usage: { input: 40, output: 10, cache_read: 0 },
    categories: [],
  });

  assert.equal(line.wire, 'openai', 'wire discriminator is openai');
  assert.equal(line.agent, 'copilot', 'agent carried from the fixture');
  // D-12: cache_write is the provider-none sentinel null (NOT 0, NOT folded) so
  // the UI renders "N/A (provider reports no cache-creation)".
  assert.strictEqual(line.usage.cache_write, null, 'cache_write is null (provider-none)');
  assert.notStrictEqual(line.usage.cache_write, 0, 'cache_write is NOT 0');
  // The other split fields are still real numbers, separate from any total.
  assert.equal(typeof line.usage.input, 'number');
  assert.equal(typeof line.usage.output, 'number');
  assert.equal(typeof line.usage.cache_read, 'number');
  assert.ok(!('total' in line.usage), 'no folded total on the openai-wire line');
  // No cache_control on the OpenAI wire → no breakpoint indices.
  assert.deepEqual(line.cache_breakpoints, []);
});
