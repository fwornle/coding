// tests/measurement/foreground-sessions.test.mjs
//
// Contract tests for the per-agent foreground-session detectors. The file-system
// detectors (claude/copilot/opencode) read live machine state, so here we only
// pin the deterministic parts of the contract: the mastra stub, the dispatcher's
// unknown-agent behavior, the shared return shape, and the reconciler agent list.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  detectMastra,
  detectForegroundSession,
  AUTO_MEASURE_AGENTS,
} from '../../lib/measurement/foreground-sessions.mjs';

test('mastra is stubbed (always null — retiring agent)', () => {
  assert.equal(detectMastra(), null);
  assert.equal(detectForegroundSession('mastra'), null);
});

test('unknown agents return null rather than throwing', () => {
  assert.equal(detectForegroundSession('nope'), null);
  assert.equal(detectForegroundSession(undefined), null);
});

test('AUTO_MEASURE_AGENTS covers the three real agents, excludes mastra', () => {
  assert.deepEqual(AUTO_MEASURE_AGENTS, ['claude', 'opencode', 'copilot']);
  assert.ok(!AUTO_MEASURE_AGENTS.includes('mastra'));
});

test('detectors honor the {agent, sessionId, lastActivityMs} shape or null', () => {
  for (const agent of AUTO_MEASURE_AGENTS) {
    const got = detectForegroundSession(agent);
    if (got === null) continue;
    assert.equal(got.agent, agent);
    assert.equal(typeof got.sessionId, 'string');
    assert.ok(got.sessionId.length > 0);
    assert.equal(typeof got.lastActivityMs, 'number');
    assert.ok(Number.isFinite(got.lastActivityMs));
  }
});
