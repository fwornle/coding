// tests/experiments/agent-headless.test.mjs
// RUN-02 / RUN-04 proof for lib/experiments/agent-headless.mjs.
//
// Task 1: argvForAgent emits the confirmed fixed-argv headless invocation per agent
//         (always an array of strings, goal a single element), and resolveAgentBinary
//         re-exposes the AGENT_COMMAND regex parse while overriding claude's registry
//         binary (bin/claude-mcp) to the raw `claude` binary for the -p headless path.
// Task 2: probeCopilotHeadless is a trivial one-turn, fail-soft, injectable capability
//         check — true only on status 0 & no error, false on non-zero / spawn error,
//         never throws, with a fixed ['-p', <prompt>, '--allow-all-tools'] argv.
//
// Pure unit suite — no real agent binary is ever spawned: resolveAgentBinary reads the
// real config/agents/*.sh registry files (on disk) and the probe's spawn seam is faked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  argvForAgent,
  resolveAgentBinary,
  probeCopilotHeadless,
} from '../../lib/experiments/agent-headless.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AGENTS_DIR = path.resolve(__dirname, '..', '..', 'config', 'agents');

const GOAL = 'add a feature and update the changelog';
const MODEL = 'claude-sonnet-4';

const allStrings = (argv) =>
  Array.isArray(argv) && argv.every((a) => typeof a === 'string');

test('argvForAgent(claude) → -p goal --model --permission-mode acceptEdits', () => {
  const argv = argvForAgent('claude', GOAL, { model: MODEL });
  assert.deepEqual(argv, [
    '-p', GOAL, '--model', MODEL, '--permission-mode', 'acceptEdits',
  ]);
});

test('argvForAgent(opencode) → run goal -m model --dangerously-skip-permissions', () => {
  const argv = argvForAgent('opencode', GOAL, { model: MODEL });
  assert.deepEqual(argv, ['run', GOAL, '-m', MODEL, '--dangerously-skip-permissions']);
});

test('argvForAgent(mastracode) → --prompt goal -m model', () => {
  const argv = argvForAgent('mastracode', GOAL, { model: MODEL });
  assert.deepEqual(argv, ['--prompt', GOAL, '-m', MODEL]);
});

test('argvForAgent(copilot) → -p goal --allow-all-tools --model model', () => {
  const argv = argvForAgent('copilot', GOAL, { model: MODEL });
  assert.deepEqual(argv, ['-p', GOAL, '--allow-all-tools', '--model', MODEL]);
});

test('every returned argv is an array of strings; goal stays a single element even with spaces', () => {
  const spacey = 'do X   and   then Y with a "quoted" phrase';
  for (const agent of ['claude', 'opencode', 'mastracode', 'copilot']) {
    const argv = argvForAgent(agent, spacey, { model: MODEL });
    assert.ok(allStrings(argv), `${agent} argv must be all strings`);
    // the goal is passed as ONE argv element (no shell splitting)
    assert.ok(argv.includes(spacey), `${agent} must carry goal as a single element`);
    assert.equal(
      argv.filter((a) => a === spacey).length,
      1,
      `${agent} must carry goal exactly once`,
    );
  }
});

test('argvForAgent throws on an unknown agent', () => {
  assert.throws(() => argvForAgent('bogus', GOAL, { model: MODEL }));
});

test('WR-03: argvForAgent fails fast when model is missing (never pushes undefined into argv)', () => {
  for (const agent of ['claude', 'opencode', 'mastracode', 'copilot']) {
    // No opts.model → must THROW a clear error (routed through the D-12 record path),
    // NOT push `undefined` into the fixed argv (which spawn rejects with a raw TypeError).
    assert.throws(
      () => argvForAgent(agent, GOAL),
      /model required/,
      `${agent}: missing model must throw a clear error`,
    );
    // And prove no undefined ever reaches an argv element in the accidental-empty-string case.
    assert.throws(() => argvForAgent(agent, GOAL, { model: '' }), /model required/, `${agent}: empty model rejected`);
  }
});

test('resolveAgentBinary(claude) parses AGENT_COMMAND yet overrides to `claude` (never bin/claude-mcp)', () => {
  const bin = resolveAgentBinary('claude', AGENTS_DIR);
  assert.equal(bin, 'claude');
  assert.ok(!/claude-mcp/.test(bin), 'claude must NOT resolve to the interactive bin/claude-mcp wrapper');
});

test('resolveAgentBinary reads the registry AGENT_COMMAND for non-overridden agents', () => {
  assert.equal(resolveAgentBinary('mastracode', AGENTS_DIR), 'mastracode');
  assert.equal(resolveAgentBinary('copilot', AGENTS_DIR), 'copilot');
});

// 85-06 A2: opencode is PATH-ambiguous — the bare `opencode` resolves to a `-m`-incapable
// homebrew Cobra build under the launchd runner. resolveAgentBinary pins the canonical
// `~/.opencode/bin/opencode` (the `-m`-capable v1.15.x build) WHEN it exists on the host,
// falling back to the registry binary otherwise. Assert whichever branch applies on this host.
test('resolveAgentBinary(opencode) pins the canonical ~/.opencode/bin/opencode when present, else the registry binary (A2)', () => {
  const canonical = path.join(os.homedir(), '.opencode', 'bin', 'opencode');
  const bin = resolveAgentBinary('opencode', AGENTS_DIR);
  let canonicalExecutable = false;
  try { fs.accessSync(canonical, fs.constants.X_OK); canonicalExecutable = true; } catch { /* absent */ }
  if (canonicalExecutable) {
    assert.equal(bin, canonical, 'canonical opencode present → the absolute path is pinned (never the PATH-ambiguous bare name)');
  } else {
    assert.equal(bin, 'opencode', 'no canonical build → falls back to the registry AGENT_COMMAND');
  }
});

// --- Task 2: probeCopilotHeadless (RUN-04) ------------------------------------------

const fakeExit0 = () => ({ status: 0, error: undefined });
const fakeNonZero = () => ({ status: 3, error: undefined });
const fakeError = () => ({ status: null, error: new Error('spawn ENOENT') });

test('probeCopilotHeadless returns true on status 0 & no error', () => {
  assert.equal(probeCopilotHeadless({ spawn: fakeExit0 }), true);
});

test('probeCopilotHeadless returns false on non-zero exit', () => {
  assert.equal(probeCopilotHeadless({ spawn: fakeNonZero }), false);
});

test('probeCopilotHeadless returns false (never throws) when res.error is set', () => {
  let out;
  assert.doesNotThrow(() => { out = probeCopilotHeadless({ spawn: fakeError }); });
  assert.equal(out, false);
});

test('probe argv is exactly [-p, <trivial prompt>, --allow-all-tools] — fixed argv, no shell string', () => {
  let seen;
  const capture = (cmd, args, opts) => {
    seen = { cmd, args, opts };
    return { status: 0, error: undefined };
  };
  probeCopilotHeadless({ spawn: capture });
  assert.equal(seen.cmd, 'copilot');
  assert.ok(Array.isArray(seen.args), 'args must be an argv array');
  assert.equal(seen.args[0], '-p');
  assert.equal(typeof seen.args[1], 'string', 'the one-turn prompt is a single argv element');
  assert.ok(seen.args[1].length > 0, 'prompt must be non-empty');
  assert.equal(seen.args[2], '--allow-all-tools');
  assert.equal(seen.args.length, 3, 'trivial one-turn check — exactly three argv elements');
  // never a shell string
  assert.ok(!seen.opts || seen.opts.shell !== true, 'shell:true must never be set');
  // bounded timeout so a hung probe cannot block the matrix (T-78-02-03)
  assert.equal(typeof seen.opts.timeout, 'number');
  assert.ok(seen.opts.timeout > 0);
});
