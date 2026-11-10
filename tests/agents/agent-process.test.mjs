/**
 * Which pane processes the health coordinator counts as a live agent
 * (lib/agents/agent-process.mjs). A miss reads as a husk, and the reaper then
 * stops that session's LSL monitor: a red [LSL] badge on a working session.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { isAgentProcess } from '../../lib/agents/agent-process.mjs';

test('the agents themselves', () => {
  for (const cmd of ['claude', 'claude --mcp-config /x.json', '/opt/homebrew/bin/claude --resume', 'opencode', 'pi', '/usr/local/bin/copilot --banner']) {
    assert.ok(isAgentProcess(cmd), cmd);
  }
});

test('a boxed agent is visible only as its launcher — that counts', () => {
  // Boxed claude 2026-11-09: the pane held `node …/agent-box.mjs run claude --` and
  // its `docker run` child; the reaper stopped the ETM 5 s after every spawn.
  for (const cmd of [
    'node /Users/u/Agentic/coding/scripts/agent-box.mjs run claude --',
    '/opt/homebrew/bin/node /Users/u/coding/scripts/agent-box.mjs run pi -- --model x',
    'node scripts/agent-box.mjs run copilot',
  ]) {
    assert.ok(isAgentProcess(cmd), cmd);
  }
});

test('launchers, other box commands and look-alikes do not', () => {
  for (const cmd of [
    'bash /Users/u/coding/scripts/claude-mcp-launcher.sh',
    'node /Users/u/coding/scripts/agent-box.mjs build',
    'node /Users/u/coding/scripts/agent-box.mjs status',
    'docker run --rm -i --name coding-box-claude-1 coding-agent-box:latest claude',
    'node /x/claude-statusline.cjs',
    'pipx install foo',
    '', null, undefined,
  ]) {
    assert.ok(!isAgentProcess(cmd), String(cmd));
  }
});
