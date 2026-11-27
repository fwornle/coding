#!/usr/bin/env node
/**
 * Remove coding's own hooks from a project's `.claude/settings.local.json`.
 *
 * coding's hooks are injected per launch through `--settings`
 * (scripts/build-claude-runtime-config.mjs), filtered by feature. A copy in the
 * project's settings.local.json bypasses that: it runs even with the feature
 * off, runs the guard a second time per tool call, and — once a wrapper moves —
 * fails on every prompt and every tool call. Old installs wrote exactly such a
 * block (`integrations/mcp-constraint-monitor/src/hooks/pre-*-hook-wrapper.js`),
 * and since the file is gitignored, the rename of 2026-08-28 never reached it:
 * a host (`--no-box`) session then printed "Cannot find module" on every call.
 *
 * A hook is coding's when it names one of coding's hook scripts (matched by
 * script name, like the runtime config's merge, so a moved path is still
 * recognised) or runs from the constraint monitor. Everything else —
 * permissions, the user's own hooks — is left untouched, and the file is only
 * rewritten when something was removed.
 *
 *   node scripts/strip-project-hooks.mjs <settings.local.json>
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Hook scripts coding has ever registered, current and retired. */
export const CODING_HOOK_SCRIPTS = new Set([
  'pre-tool-hook-wrapper.js',
  'pre-prompt-hook-wrapper.js',
  'tool-interaction-hook-wrapper.js',
  'health-prompt-hook.js',
]);

function scriptName(command) {
  const match = /([\w.-]+\.(?:js|mjs|cjs))\b/.exec(command || '');
  return match ? match[1] : null;
}

/** True when this hook command is one of coding's. */
export function isCodingHook(command) {
  if (typeof command !== 'string') return false;
  if (/\/integrations\/(mcp-)?constraint-monitor\//.test(command)) return true;
  return CODING_HOOK_SCRIPTS.has(scriptName(command));
}

/**
 * @returns {{settings: object, removed: string[]}} the settings without
 *   coding's hooks (empty entries, events and `hooks` dropped), and the
 *   commands that were removed.
 */
export function stripCodingHooks(settings) {
  const removed = [];
  if (!settings || typeof settings.hooks !== 'object' || settings.hooks === null) {
    return { settings, removed };
  }
  const hooks = {};
  for (const [event, entries] of Object.entries(settings.hooks)) {
    if (!Array.isArray(entries)) { hooks[event] = entries; continue; }
    const kept = [];
    for (const entry of entries) {
      if (!entry || !Array.isArray(entry.hooks)) { kept.push(entry); continue; }
      const inner = entry.hooks.filter((h) => {
        if (isCodingHook(h?.command)) { removed.push(h.command); return false; }
        return true;
      });
      if (inner.length) kept.push({ ...entry, hooks: inner });
    }
    if (kept.length) hooks[event] = kept;
  }
  if (!removed.length) return { settings, removed };
  const out = { ...settings };
  if (Object.keys(hooks).length) out.hooks = hooks;
  else delete out.hooks;
  return { settings: out, removed };
}

function main([file]) {
  if (!file || !existsSync(file)) return 0;
  let settings;
  try {
    settings = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    // Not ours to repair: Claude Code reports a broken settings file itself.
    process.stderr.write(`strip-project-hooks: ${file} is not valid JSON, left alone (${err.message})\n`);
    return 0;
  }
  const { settings: out, removed } = stripCodingHooks(settings);
  if (!removed.length) return 0;
  writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
  process.stdout.write(`Removed ${removed.length} stale coding hook(s) from ${file}:\n`);
  for (const c of removed) process.stdout.write(`  ${c}\n`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
