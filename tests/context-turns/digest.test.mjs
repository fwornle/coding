// tests/context-turns/digest.test.mjs
//
// Behavior (RESEARCH Test Map): preview fallback always present (~120 char cap)
// + tool name/size captured from tool_use / tool_result blocks. Implemented in 84-04.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFixture } from './_helpers.mjs';
import { buildAnthropicLine } from '../../../_work/rapid-llm-proxy/proxy-bridge/context-turns.mjs';

const anthropicBody = loadFixture('anthropic-messages-body.json');

test('preview fallback (~120 char cap) present and tool name/size captured', () => {
  const line = buildAnthropicLine({
    reqJson: anthropicBody,
    taskId: '84-digest-r0',
    agent: 'claude',
    requestId: 'req-digest',
    model: anthropicBody.model,
    usage: { input: 1, output: 1, cache_read: 0, cache_write: 0 },
    categories: [],
  });

  // Every message carries a string preview capped at 120 chars.
  for (const m of line.messages) {
    assert.equal(typeof m.preview, 'string', `message ${m.i} has a string preview`);
    assert.ok(m.preview.length <= 120, `message ${m.i} preview <= 120 chars (was ${m.preview.length})`);
    assert.equal(typeof m.bytes, 'number', `message ${m.i} has a numeric byte size`);
  }

  // The tool_use message (assistant calling read_file) yields tool:{name,size}.
  const toolUse = line.messages.find((m) => m.tool && m.tool.name === 'read_file');
  assert.ok(toolUse, 'a message digest exposes the read_file tool_use');
  assert.equal(typeof toolUse.tool.name, 'string');
  assert.equal(toolUse.tool.name, 'read_file');
  assert.equal(typeof toolUse.tool.size, 'number');
  assert.ok(toolUse.tool.size > 0, 'tool_use size is a positive byte count');

  // The tool_result message (user returning the file body) is also captured.
  const toolResult = line.messages.find((m) => m.tool && m.tool.name === 'tool_result');
  assert.ok(toolResult, 'a message digest exposes the tool_result');
  assert.equal(typeof toolResult.tool.size, 'number');

  // A plain text message has no tool metadata (null, not an empty object).
  const plain = line.messages.find((m) => m.role === 'assistant' && !m.tool);
  assert.ok(plain, 'a plain assistant message has tool === null');
  assert.equal(plain.tool, null);
});
