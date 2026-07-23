// tests/experiments/cell-injection.test.mjs
//
// kb-on cell injection: retrieve gated knowledge and inject via the agent's native channel.
// node --test (matches the other tests/experiments/*.test.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { injectCellKnowledge, retrieveCellKnowledge } from '../../lib/experiments/cell-injection.mjs';

// A fake /api/retrieve response.
const okResp = (markdown, results_count = markdown ? 3 : 0) => ({
  ok: true,
  json: async () => ({ markdown, meta: { results_count } }),
});

test('claude: non-empty retrieval → --append-system-prompt argv', async () => {
  const fetchImpl = async () => okResp('## Insights\n\n**ETM stall reclaim**\n');
  const r = await injectCellKnowledge(
    { agent: 'claude', goal: 'fix the ETM stall', taskId: 'exp--claude--r0', worktree: '/tmp/wt' },
    { fetchImpl },
  );
  assert.deepEqual(r.argvExtra, ['--append-system-prompt', '## Insights\n\n**ETM stall reclaim**\n']);
  assert.equal(r.target, 'append-system-prompt');
  assert.ok(r.injectedChars > 0);
});

test('claude: empty retrieval (results_count 0) → nothing injected (fizzbuzz case)', async () => {
  const fetchImpl = async () => okResp('', 0);
  const r = await injectCellKnowledge(
    { agent: 'claude', goal: 'write fizzbuzz', taskId: 'compare-fizzbuzz--claude--r0', worktree: '/tmp/wt' },
    { fetchImpl },
  );
  assert.deepEqual(r.argvExtra, []);
  assert.equal(r.injectedChars, 0);
  assert.equal(r.target, null);
});

test('opencode: non-empty retrieval → writes .opencode/knowledge-context.md, no argv', async () => {
  const fetchImpl = async () => okResp('## Insights\n\n**Opencode headless**\n');
  const writes = [];
  const mkdirs = [];
  const r = await injectCellKnowledge(
    { agent: 'opencode', goal: 'fix opencode', taskId: 'exp--opencode--r0', worktree: '/tmp/wt' },
    { fetchImpl, writeFileImpl: (p, c) => writes.push([p, c]), mkdirImpl: (d) => mkdirs.push(d) },
  );
  assert.deepEqual(r.argvExtra, []);
  assert.equal(r.target, '.opencode/knowledge-context.md');
  assert.equal(writes.length, 1);
  assert.ok(writes[0][0].endsWith('/tmp/wt/.opencode/knowledge-context.md'.replace('/tmp/wt', '/tmp/wt')));
  assert.match(writes[0][1], /Opencode headless/);
  assert.equal(mkdirs.length, 1);
});

test('copilot: writes .github/copilot-instructions.md', async () => {
  const fetchImpl = async () => okResp('## Insights\n\n**Copilot BYOK**\n');
  const writes = [];
  const r = await injectCellKnowledge(
    { agent: 'copilot', goal: 'fix copilot', taskId: 'exp--copilot--r0', worktree: '/tmp/wt' },
    { fetchImpl, writeFileImpl: (p, c) => writes.push([p, c]), mkdirImpl: () => {} },
  );
  assert.equal(r.target, '.github/copilot-instructions.md');
  assert.equal(writes.length, 1);
});

test('FAIL-OPEN: retrieval throws → nothing injected, no throw', async () => {
  const fetchImpl = async () => { throw new Error('obs-api down'); };
  const writes = [];
  const r = await injectCellKnowledge(
    { agent: 'opencode', goal: 'x', taskId: 'exp--opencode--r0', worktree: '/tmp/wt' },
    { fetchImpl, writeFileImpl: (p, c) => writes.push([p, c]), mkdirImpl: () => {} },
  );
  assert.deepEqual(r.argvExtra, []);
  assert.equal(r.injectedChars, 0);
  assert.equal(writes.length, 0);
});

test('retrieveCellKnowledge: non-2xx → "" (fail-open)', async () => {
  const fetchImpl = async () => ({ ok: false, json: async () => ({}) });
  const md = await retrieveCellKnowledge(
    { goal: 'x', taskId: 'exp--claude--r0', agent: 'claude', worktree: '/tmp/wt' },
    { fetchImpl },
  );
  assert.equal(md, '');
});
