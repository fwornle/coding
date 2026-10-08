// tests/integration/tmux-routing-env.test.mjs
//
// The agent → proxy routing env must reach an agent the launcher starts in a NEW
// tmux session exactly as the launcher computed it. A new session starts from
// the tmux server's environment, so before the fix the routing vars either
// never arrived (ANTHROPIC_BASE_URL, ANTHROPIC_CUSTOM_HEADERS, COPILOT_PROVIDER_*,
// CODING_PROJECT_ID were not in the wrapper's pass-through list) or arrived
// stale from whatever the server held (an ANTHROPIC_API_KEY the claude wiring
// had removed, an old task's x-task-id header).
//
// Runs scripts/tmux-session-wrapper.sh for real against an isolated tmux server
// (TMUX_TMPDIR in a sandbox) whose global env holds stale values, with an agent
// command that dumps its env. Skipped where tmux is not installed.
//
// Runner: node --test tests/integration/tmux-routing-env.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROUTING_ENV_VARS } from '../../lib/agents/proxy-routing.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const WRAPPER = path.join(REPO_ROOT, 'scripts', 'tmux-session-wrapper.sh');
const hasTmux = spawnSync('tmux', ['-V']).status === 0;

test('the wrapper passes exactly the routing vars proxy-routing.mjs may set', () => {
  const src = fs.readFileSync(WRAPPER, 'utf8');
  const list = src.split('local routing_vars=(')[1].split(')')[0].split(/\s+/).filter(Boolean);
  assert.deepEqual([...list].sort(), [...ROUTING_ENV_VARS].sort());
});

test('a new tmux session gets the launcher routing env, not the server\'s stale one', { skip: !hasTmux && 'tmux not installed' }, async () => {
  const box = fs.mkdtempSync(path.join(os.tmpdir(), 'tmux-routing-'));
  const tmuxDir = path.join(box, 't');
  fs.mkdirSync(tmuxDir);
  const out = path.join(box, 'agent-env.txt');
  const agentCmd = path.join(box, 'agent.sh');
  fs.writeFileSync(agentCmd, `#!/bin/sh\nenv > '${out}.tmp' && mv '${out}.tmp' '${out}'\n`, { mode: 0o755 });
  const env = {
    PATH: process.env.PATH, HOME: box, TERM: 'xterm', TMUX_TMPDIR: tmuxDir,
    CODING_REPO: path.join(box, 'coding'), CODING_AGENT: 'claude',
    HEALTH_COORDINATOR_URL: 'http://127.0.0.1:9',
  };
  const tmux = (...args) => spawnSync('tmux', ['-f', '/dev/null', ...args], { env, encoding: 'utf8' });
  try {
    // A server left over from an earlier launch, holding that launch's values.
    tmux('new-session', '-d', '-s', 'earlier', 'sleep 60');
    tmux('set-environment', '-g', 'ANTHROPIC_API_KEY', 'sk-stale');
    tmux('set-environment', '-g', 'ANTHROPIC_CUSTOM_HEADERS', 'x-task-id: old-task');
    tmux('set-environment', '-g', 'COPILOT_PROVIDER_BASE_URL', 'http://dead/v1');

    // The routing state the claude wiring leaves: base URL + headers, keys removed.
    const script = `
source "${WRAPPER}"
export ANTHROPIC_BASE_URL='http://127.0.0.1:12435'
export ANTHROPIC_CUSTOM_HEADERS='x-task-id: new-task
x-project: glass'
export CODING_PROJECT_ID='glass'
unset ANTHROPIC_API_KEY COPILOT_PROVIDER_BASE_URL
tmux_session_wrapper "${agentCmd}" </dev/null >/dev/null 2>&1 || true
`;
    // Without a TTY the wrapper does not return once the session exists, so it
    // runs in its own process group and is killed once the agent has reported.
    const launcher = spawn('bash', ['--norc', '--noprofile', '-c', script], { env, detached: true, stdio: 'ignore' });
    for (let i = 0; i < 150 && !fs.existsSync(out); i++) await new Promise((r) => setTimeout(r, 100));
    try { process.kill(-launcher.pid, 'SIGKILL'); } catch { /* already gone */ }
    const got = fs.readFileSync(out, 'utf8');
    const vars = Object.fromEntries(got.split(/\n(?=[A-Za-z_][A-Za-z0-9_]*=)/).map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1).replace(/\n$/, '')];
    }));
    assert.equal(vars.ANTHROPIC_BASE_URL, 'http://127.0.0.1:12435');
    assert.equal(vars.ANTHROPIC_CUSTOM_HEADERS, 'x-task-id: new-task\nx-project: glass');
    assert.equal(vars.CODING_PROJECT_ID, 'glass');
    assert.equal(vars.ANTHROPIC_API_KEY, undefined, 'the stale key from the tmux server must not reach the agent');
    assert.equal(vars.COPILOT_PROVIDER_BASE_URL, undefined);
  } finally {
    tmux('kill-server');
    fs.rmSync(box, { recursive: true, force: true });
  }
});
