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
  detectClaude,
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

test('detectors honor the {agent, sessionId, lastActivityMs, runnerUpMs} shape or null', () => {
  for (const agent of AUTO_MEASURE_AGENTS) {
    const got = detectForegroundSession(agent);
    if (got === null) continue;
    assert.equal(got.agent, agent);
    assert.equal(typeof got.sessionId, 'string');
    assert.ok(got.sessionId.length > 0);
    assert.equal(typeof got.lastActivityMs, 'number');
    assert.ok(Number.isFinite(got.lastActivityMs));
    assert.ok(got.runnerUpMs === null || Number.isFinite(got.runnerUpMs));
    if (got.runnerUpMs !== null) assert.ok(got.runnerUpMs <= got.lastActivityMs);
  }
});

test('pi reports the runner-up session, or null when it is alone', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-two-'));
  const prev = process.env.PI_CODING_AGENT_SESSION_DIR;
  process.env.PI_CODING_AGENT_SESSION_DIR = dir;
  try {
    const now = Date.now() / 1000;
    const a = path.join(dir, '2026-10-03T09-00-00-000Z_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jsonl');
    fs.writeFileSync(a, '{}\n');
    fs.utimesSync(a, now - 30, now - 30);
    assert.equal(detectPi()?.runnerUpMs, null);

    const b = path.join(dir, '2026-10-03T09-05-00-000Z_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jsonl');
    fs.writeFileSync(b, '{}\n');
    fs.utimesSync(b, now, now);
    const got = detectPi();
    assert.equal(got?.sessionId, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    assert.equal(Math.round(got?.runnerUpMs / 1000), Math.round(now - 30));
  } finally {
    if (prev === undefined) delete process.env.PI_CODING_AGENT_SESSION_DIR;
    else process.env.PI_CODING_AGENT_SESSION_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('claude: top-level sessions only — a busy sub-agent never wins', () => {
  // A recursive walk reached <session>/subagents/agent-<id>.jsonl, and a sub-agent
  // writing faster than its parent then bound the slot to `agent-<id>`, a task_id
  // no Run carries. Its parent is the session; sub-agents are not rivals either.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-projects-'));
  const prev = process.env.LSL_CLAUDE_PROJECTS_DIR;
  process.env.LSL_CLAUDE_PROJECTS_DIR = root;
  try {
    const now = Date.now() / 1000;
    const proj = path.join(root, '-Users-me-proj');
    const parent = path.join(proj, '11111111-1111-4111-8111-111111111111.jsonl');
    const sub = path.join(proj, '11111111-1111-4111-8111-111111111111', 'subagents', 'agent-abc.jsonl');
    fs.mkdirSync(path.dirname(sub), { recursive: true });
    fs.writeFileSync(parent, '{}\n');
    fs.writeFileSync(sub, '{}\n');
    fs.utimesSync(parent, now - 20, now - 20);
    fs.utimesSync(sub, now, now);

    const got = detectClaude();
    assert.equal(got?.sessionId, '11111111-1111-4111-8111-111111111111');
    assert.equal(got?.runnerUpMs, null);

    const other = path.join(root, '-Users-me-other', '22222222-2222-4222-8222-222222222222.jsonl');
    fs.mkdirSync(path.dirname(other), { recursive: true });
    fs.writeFileSync(other, '{}\n');
    fs.utimesSync(other, now - 5, now - 5);
    const both = detectClaude();
    assert.equal(both?.sessionId, '22222222-2222-4222-8222-222222222222');
    assert.equal(Math.round(both?.runnerUpMs / 1000), Math.round(now - 20));
  } finally {
    if (prev === undefined) delete process.env.LSL_CLAUDE_PROJECTS_DIR;
    else process.env.LSL_CLAUDE_PROJECTS_DIR = prev;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
