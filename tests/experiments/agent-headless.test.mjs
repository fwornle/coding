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
  preflightAgent,
} from '../../lib/experiments/agent-headless.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AGENTS_DIR = path.resolve(__dirname, '..', '..', 'config', 'agents');

const GOAL = 'add a feature and update the changelog';
const MODEL = 'claude-sonnet-4';

// argvForAgent appends a uniform EXECUTION directive to EVERY agent's prompt (see
// the source: headless copilot/opencode otherwise narrate and exit without editing).
// These expectations previously omitted it and so had been failing for all four
// agents — asserting a contract the function had deliberately stopped honouring.
// Deriving the expected string from the ACTUAL argv would assert nothing, so it is
// spelled out here and the goal-prefix is checked explicitly.
const EXECUTION_DIRECTIVE =
  ' \n\nIMPORTANT — EXECUTION, NOT ANALYSIS: Use your file-editing tools to implement this'
  + ' change directly on disk right now. Do NOT merely describe, plan, or explain what you'
  + ' would do. Keep working (reading, editing, verifying) until the change is actually made;'
  + ' the task is complete ONLY once the edits exist on disk.';
const EXEC = (goal) => `${goal}${EXECUTION_DIRECTIVE}`;

const allStrings = (argv) =>
  Array.isArray(argv) && argv.every((a) => typeof a === 'string');

test('argvForAgent(claude) → -p goal --model --permission-mode acceptEdits', () => {
  const argv = argvForAgent('claude', GOAL, { model: MODEL });
  assert.deepEqual(argv, [
    '-p', EXEC(GOAL), '--model', MODEL, '--permission-mode', 'acceptEdits',
  ]);
  assert.ok(argv[1].startsWith(GOAL), 'the goal is the prefix of the augmented prompt');
});

test('argvForAgent(opencode) → run goal -m model --dangerously-skip-permissions', () => {
  const argv = argvForAgent('opencode', GOAL, { model: MODEL });
  assert.deepEqual(argv, ['run', EXEC(GOAL), '-m', MODEL, '--dangerously-skip-permissions']);
});

test('argvForAgent(pi) → -p goal --provider rapid-proxy-pi --model model --approve', () => {
  const argv = argvForAgent('pi', GOAL, { model: MODEL });
  // --approve is what keeps a headless pi from hanging on its project-trust prompt.
  assert.deepEqual(argv, [
    '-p', EXEC(GOAL), '--provider', 'rapid-proxy-pi', '--model', MODEL, '--approve',
  ]);
});

test('argvForAgent(copilot) → -p goal --allow-all-tools --mode autopilot --model model', () => {
  const argv = argvForAgent('copilot', GOAL, { model: MODEL });
  assert.deepEqual(argv, [
    '-p', EXEC(GOAL), '--allow-all-tools', '--no-ask-user',
    '--mode', 'autopilot', '--max-autopilot-continues', '20', '--model', MODEL,
  ]);
});

test('every returned argv is an array of strings; goal stays a single element even with spaces', () => {
  const spacey = 'do X   and   then Y with a "quoted" phrase';
  for (const agent of ['claude', 'opencode', 'pi', 'copilot']) {
    const argv = argvForAgent(agent, spacey, { model: MODEL });
    assert.ok(allStrings(argv), `${agent} argv must be all strings`);
    // the goal is passed as ONE argv element (no shell splitting) — as the prefix of
    // the execution-directive-augmented prompt.
    assert.ok(argv.includes(EXEC(spacey)), `${agent} must carry goal as a single element`);
    assert.equal(
      argv.filter((a) => a.startsWith(spacey)).length,
      1,
      `${agent} must carry goal exactly once`,
    );
  }
});

test('argvForAgent throws on an unknown agent', () => {
  assert.throws(() => argvForAgent('bogus', GOAL, { model: MODEL }));
});

test('WR-03: argvForAgent fails fast when model is missing (never pushes undefined into argv)', () => {
  for (const agent of ['claude', 'opencode', 'pi', 'copilot']) {
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
  assert.equal(resolveAgentBinary('pi', AGENTS_DIR), 'pi');
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

// --- Task 1 (Phase 88-02): preflightAgent (PREFLIGHT-01 / SUPPRESS-01) --------------
// A bounded, fail-soft POST /api/complete round-trip that validates the proxy is reachable
// AND the RESOLVED model round-trips one token against the agent's target provider — with NO
// agent CLI session (so it creates no experiment Run and no ambient pass; its token_usage row
// lands process='experiment-preflight', task_id=''). The fetchImpl seam is injected so no live
// proxy is contacted here (live-proven 2026-07-22: copilot/auto→HTTP 500; copilot/claude-haiku-4-5→200).

// A 200 stub that CAPTURES the posted url/body for assertions.
function okFetch(capture) {
  return async (url, opts) => {
    capture.url = url;
    capture.opts = opts;
    capture.body = JSON.parse(opts.body);
    return { status: 200, ok: true, json: async () => ({ content: 'OK', tokens: { total: 18 } }) };
  };
}
// A 500 stub — the exact original copilot `auto` failure (live-proven).
const fetch500 = async () => ({ status: 500, ok: false, json: async () => ({ error: 'model not supported' }) });
// A rejecting stub — the network-unreachable / abort shape.
const fetchReject = async () => { throw new Error('ECONNREFUSED'); };

test('preflightAgent(copilot, resolved model) → ok on HTTP 200 with provider:copilot', async () => {
  const cap = {};
  const res = await preflightAgent('copilot', { model: 'claude-haiku-4-5', fetchImpl: okFetch(cap) });
  assert.deepEqual(res, { ok: true });
  assert.equal(cap.body.provider, 'copilot');
  assert.equal(cap.body.model, 'claude-haiku-4-5');
  assert.match(cap.url, /\/api\/complete$/, 'the round-trip target is /api/complete (NOT an agent CLI spawn)');
});

test('preflightAgent(copilot, auto) → not-ok with a diagnosable HTTP-500 reason', async () => {
  const res = await preflightAgent('copilot', { model: 'auto', fetchImpl: fetch500 });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'preflight:copilot-model-or-route (HTTP 500)');
});

test('preflightAgent(opencode) strips the rapid-proxy/ prefix and sends NO provider (auto-route)', async () => {
  const cap = {};
  const res = await preflightAgent('opencode', { model: 'rapid-proxy/claude-haiku-4.5', fetchImpl: okFetch(cap) });
  assert.deepEqual(res, { ok: true });
  assert.equal(cap.body.model, 'claude-haiku-4.5', 'prefix stripped to the bare catalog id');
  assert.ok(!('provider' in cap.body), 'opencode sends NO provider → the proxy auto-routes');
});

test('preflightAgent(claude) sends provider claude-code with the resolved model', async () => {
  const cap = {};
  const res = await preflightAgent('claude', { model: 'sonnet', fetchImpl: okFetch(cap) });
  assert.deepEqual(res, { ok: true });
  assert.equal(cap.body.provider, 'claude-code');
  assert.equal(cap.body.model, 'sonnet');
});

test('preflightAgent NEVER throws: a rejecting fetch → not-ok unreachable', async () => {
  let res;
  await assert.doesNotReject(async () => { res = await preflightAgent('copilot', { model: 'x', fetchImpl: fetchReject }); });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'preflight:copilot-unreachable');
});

test('preflightAgent posts process=experiment-preflight and NO task_id (neutral row → excluded from Runs)', async () => {
  const cap = {};
  await preflightAgent('claude', { model: 'sonnet', fetchImpl: okFetch(cap) });
  assert.equal(cap.body.process, 'experiment-preflight');
  assert.ok(!('task_id' in cap.body), 'no task_id → the row is neutral, excluded from Runs by construction');
  assert.equal(cap.opts.method, 'POST');
  assert.equal(cap.opts.headers['content-type'], 'application/json');
});

test('preflightAgent is bounded by an AbortController armed at timeoutMs (a hung round-trip skips, never hangs)', async () => {
  // A fetch that respects the abort signal: never resolves on its own, rejects when aborted.
  const abortableFetch = (_url, opts) => new Promise((_resolve, reject) => {
    opts.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  const res = await preflightAgent('copilot', { model: 'x', fetchImpl: abortableFetch, timeoutMs: 20 });
  assert.equal(res.ok, false);
  assert.match(res.reason, /unreachable/);
});

test('preflightAgent(unknown) is out of scope → ok without any round-trip', async () => {
  let called = false;
  const res = await preflightAgent('someunknownagent', {
    model: 'x',
    fetchImpl: async () => { called = true; return { status: 200 }; },
  });
  assert.deepEqual(res, { ok: true });
  assert.equal(called, false, 'no /api/complete call for an out-of-scope agent');
});
