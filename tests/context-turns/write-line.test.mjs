// tests/context-turns/write-line.test.mjs
//
// Behavior (RESEARCH Test Map): logContextTurn writes one valid JSONL line per
// request. Implemented in 84-04.
//
// Drives the SHARED pure line-builder + appender that server.mjs's write sites
// use (proxy-bridge/context-turns.mjs — imported cross-repo so we exercise the
// real production assembly without booting the proxy HTTP server).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFixture, mkTmpMeasurementsDir, readJsonl } from './_helpers.mjs';
import {
  buildAnthropicLine,
  appendContextTurn,
} from '../../../_work/rapid-llm-proxy/proxy-bridge/context-turns.mjs';

const anthropicBody = loadFixture('anthropic-messages-body.json');

test('logContextTurn writes exactly one valid JSONL line per request', () => {
  const tmp = mkTmpMeasurementsDir();
  try {
    const dir = tmp.withTaskId('84-write-line-r0');
    const line = buildAnthropicLine({
      reqJson: anthropicBody,
      taskId: '84-write-line-r0',
      agent: 'claude',
      requestId: 'req-abc',
      model: anthropicBody.model,
      usage: { input: 12, output: 34, cache_read: 56, cache_write: 78 },
      categories: [{ key: 'sys', label: 'System Instructions', bytes: 60 }],
    });

    appendContextTurn(dir, line);

    const rows = readJsonl(`${dir}/context-turns.jsonl`);
    assert.equal(rows.length, 1, 'exactly one line appended');

    const row = rows[0];
    // Every required top-level key of the pinned line contract is present.
    for (const key of [
      'ts', 'task_id', 'agent', 'wire', 'request_id', 'model',
      'usage', 'cache_breakpoints', 'categories', 'messages', 'observation_ref',
    ]) {
      assert.ok(key in row, `line carries required key: ${key}`);
    }
    assert.equal(row.wire, 'anthropic');
    assert.equal(row.task_id, '84-write-line-r0');
    assert.equal(row.observation_ref, null, 'observation_ref is null (enriched at span close)');
    assert.ok(Array.isArray(row.messages) && row.messages.length === anthropicBody.messages.length);
  } finally {
    tmp.cleanup();
  }
});
