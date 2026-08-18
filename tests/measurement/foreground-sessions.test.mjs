// tests/measurement/foreground-sessions.test.mjs
//
// Contract tests for the per-agent foreground-session detectors. The file-system
// detectors (claude/copilot/opencode) read live machine state, so here we only
// pin the deterministic parts of the contract: pi's detector against a temp dir
// it fully controls, the dispatcher's unknown-agent behavior, the shared return
// shape, and the reconciler agent list.
import test from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  detectPi,
  detectForegroundSession,
  AUTO_MEASURE_AGENTS,
} from '../../lib/measurement/foreground-sessions.mjs';

// detectPi REPLACES detectMastra, which was a hardcoded `return null` because
// mastracode had no readable session state. pi persists its own sessions, so
// unlike the others this detector can be pinned deterministically: point it at a
// temp dir and assert on what it finds.
test('pi detects the newest session and takes its id from the filename', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-sessions-'));
  const prev = process.env.PI_CODING_AGENT_SESSION_DIR;
  process.env.PI_CODING_AGENT_SESSION_DIR = dir;
  try {
    fs.writeFileSync(path.join(dir, '2026-08-18T09-00-00-000Z_11111111-1111-4111-8111-111111111111.jsonl'), '{}\n');
    const newer = path.join(dir, '2026-08-18T10-00-00-000Z_22222222-2222-4222-8222-222222222222.jsonl');
    fs.writeFileSync(newer, '{}\n');
    // Make the intent explicit rather than relying on write order.
    const now = Date.now();
    fs.utimesSync(path.join(dir, '2026-08-18T09-00-00-000Z_11111111-1111-4111-8111-111111111111.jsonl'), now / 1000 - 60, now / 1000 - 60);
    fs.utimesSync(newer, now / 1000, now / 1000);

    const got = detectPi();
    assert.equal(got?.agent, 'pi');
    assert.equal(got?.sessionId, '22222222-2222-4222-8222-222222222222');
    assert.ok(typeof got?.lastActivityMs === 'number');
    // The dispatcher must route 'pi' to the same detector.
    assert.equal(detectForegroundSession('pi')?.sessionId, got.sessionId);
  } finally {
    if (prev === undefined) delete process.env.PI_CODING_AGENT_SESSION_DIR;
    else process.env.PI_CODING_AGENT_SESSION_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('pi returns null when the session dir has no .jsonl', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-empty-'));
  const prev = process.env.PI_CODING_AGENT_SESSION_DIR;
  process.env.PI_CODING_AGENT_SESSION_DIR = dir;
  try {
    fs.writeFileSync(path.join(dir, 'notes.md'), 'not a session\n');
    assert.equal(detectPi(), null);
  } finally {
    if (prev === undefined) delete process.env.PI_CODING_AGENT_SESSION_DIR;
    else process.env.PI_CODING_AGENT_SESSION_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('unknown agents return null rather than throwing', () => {
  assert.equal(detectForegroundSession('nope'), null);
  assert.equal(detectForegroundSession(undefined), null);
});

test('AUTO_MEASURE_AGENTS covers all four agents, including pi', () => {
  // pi is INCLUDED where mastra was excluded: mastra's detector was a stub, so
  // binding it would have been a no-op. pi has a real one.
  assert.deepEqual(AUTO_MEASURE_AGENTS, ['claude', 'opencode', 'copilot', 'pi']);
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
