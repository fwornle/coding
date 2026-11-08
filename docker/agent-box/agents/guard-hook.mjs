/**
 * Runs the constraint hook for an agent's guard plugin (opencode, pi) — the
 * same hook Claude Code runs from /etc/claude-code/managed-settings.json.
 *
 * The hook's whole environment is fixed HERE, in root-owned code, and nothing
 * is inherited: the agent controls the environment of whatever it starts, and
 * a nested agent started with NODE_OPTIONS=--require <file> would run that
 * file inside the hook (lib/redteam/attacks.mjs probes exactly this).
 *
 * Fail-closed: anything but a clean exit 0 blocks the call.
 * Plan: coding/.planning/guardrail-hardening.md (Phase 1, item 5).
 */

import { spawn } from 'node:child_process';

const NODE = '/usr/local/bin/node';
const HOOKS = {
  pre: '/opt/coding-guard/integrations/constraint-monitor/src/hooks/pre-tool-hook-wrapper.js',
  // Phase 2: judge what the call left on disk, undo violating files.
  post: '/opt/coding-guard/integrations/constraint-monitor/src/hooks/post-tool-hook.js',
};
const FIXED_ENV = {
  HOME: '/home/agent',
  PATH: '/usr/local/bin:/usr/bin:/bin',
  CODING_GUARD_MODE: 'box',
  CODING_GUARD_KEYS: '/etc/coding-guard',
  CONSTRAINT_CONFIG_PATH: '/opt/coding-guard/config/constraints/constraint-monitor.yaml',
};
const TIMEOUT_MS = 30_000;

/**
 * @param {string} agent  'opencode' | 'pi'
 * @param {{ tool_name: string, tool_input: object, tool_use_id?: string, session_id?: string, cwd?: string }} call
 * @param {'pre'|'post'} phase  pre: may the call run? post: what did it leave?
 * @returns {Promise<{ allow: boolean, message: string }>}  post: allow=false means files were undone
 */
export function checkCall(agent, call, phase = 'pre') {
  return new Promise((resolve) => {
    let stderr = '';
    let settled = false;
    const done = (allow, message) => {
      if (!settled) { settled = true; resolve({ allow, message }); }
    };
    let child;
    try {
      child = spawn(NODE, [HOOKS[phase]], {
        env: { ...FIXED_ENV, CODING_GUARD_AGENT: agent },
        stdio: ['pipe', 'ignore', 'pipe'],
      });
    } catch (err) {
      done(false, `🔴 Constraint guard could not start (${err.message}) — blocked (fail-closed).`);
      return;
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      done(false, '🔴 Constraint guard timed out — blocked (fail-closed).');
    }, TIMEOUT_MS);
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => done(false, `🔴 Constraint guard failed (${err.message}) — blocked (fail-closed).`));
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) done(true, '');
      else done(false, stderr.trim() || `🔴 Constraint guard exited ${code} — blocked (fail-closed).`);
    });
    child.stdin.end(JSON.stringify({ agent, ...call }));
  });
}
