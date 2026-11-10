#!/usr/bin/env node
/**
 * coding agent box — runs the coding project's own Claude hooks.
 *
 * On the host, build-claude-runtime-config.mjs adds these hooks to a Claude
 * session. In the box, only the managed policy's hooks load
 * (allowManagedHooksOnly), so managed-settings.json calls this script instead:
 *
 *   coding-hook.mjs tool-interaction   PostToolUse       feature lsl
 *   coding-hook.mjs health-prompt      UserPromptSubmit  feature health
 *
 * The scripts come from the coding repo mounted in the box (CODING_REPO), so
 * they are the same version the host runs. The launcher sets CODING_BOX_HOOKS
 * to the hooks whose feature is on for the host, and this script runs only
 * those. Unlike the guard, these hooks enforce nothing: they record tool calls
 * and add a health line to the prompt. So they keep the session's environment,
 * which carries the per-launch CODING_REPO and HEALTH_COORDINATOR_URL, and only
 * NODE_OPTIONS is dropped. They always exit 0, so a failure never blocks the
 * agent.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const HOOK_SCRIPTS = {
  'tool-interaction': 'scripts/tool-interaction-hook-wrapper.js',
  'health-prompt': 'scripts/health-prompt-hook.js',
};

/** The script to run for `name`, or null when it is off, unknown or missing. */
export function hookScript(name, env = process.env, exists = fs.existsSync) {
  const rel = Object.hasOwn(HOOK_SCRIPTS, name) ? HOOK_SCRIPTS[name] : null;
  if (!rel || !env.CODING_REPO || !path.isAbsolute(env.CODING_REPO)) return null;
  const enabled = String(env.CODING_BOX_HOOKS || '').split(',').map((s) => s.trim());
  if (!enabled.includes(name)) return null;
  const script = path.join(env.CODING_REPO, rel);
  return exists(script) ? script : null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const script = hookScript(process.argv[2]);
  if (!script) process.exit(0);
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  const child = spawn(process.execPath, [script], { env, stdio: 'inherit' });
  child.on('error', () => process.exit(0));
  child.on('exit', () => process.exit(0));
}
