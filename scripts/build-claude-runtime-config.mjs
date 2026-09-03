#!/usr/bin/env node
/**
 * Build the per-launch Claude configuration for a WRAPPER-SCOPED install.
 *
 * WHY THIS EXISTS
 * ---------------
 * Installing this project must not change how a bare `claude` behaves. The
 * capabilities it adds — constraint checking, tool-interaction capture for live
 * session logging, and knowledge injection — are delivered by hooks, and hooks
 * normally live in ~/.claude/settings.json, which every claude session in every
 * project reads. Writing there is exactly the impact we are avoiding.
 *
 * So instead of mutating the user's file, we DERIVE one: read their settings
 * (read-only), deep-merge our hooks into a copy, and write the copy inside the
 * repo. bin/coding passes it with `--settings`, so the hooks apply to sessions
 * launched through the wrapper and to nothing else.
 *
 * Deriving rather than relying on `--settings` merge semantics is deliberate.
 * `--settings` is documented as loading "additional" settings, but the exact
 * merge behaviour for the `hooks` key (replace the array? concatenate?) is not
 * specified. Getting that wrong would silently disable the user's own hooks —
 * a bad failure, because it is invisible. Merging ourselves is correct under
 * either interpretation.
 *
 * Writes:
 *   <repo>/.coding/runtime/claude-settings.json   (derived settings)
 *   <repo>/.coding/claude-plugin/                 (slash commands as a plugin)
 *
 * Both live inside the repo, are regenerated on every launch, and are removed
 * when the repo is deleted. Prints the two paths, one per line, for the shell
 * to consume.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, readdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

const repo = process.env.CODING_REPO || process.cwd();
const home = homedir();

/** The hooks this project contributes. Single source of truth for both scopes. */
function codingHooks(repoPath) {
  const preTool = `node ${repoPath}/integrations/constraint-monitor/src/hooks/pre-tool-hook-wrapper.js`;
  const postTool = `node ${repoPath}/scripts/tool-interaction-hook-wrapper.js`;
  const prompt = `node ${repoPath}/scripts/health-prompt-hook.js`;
  return {
    PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: preTool }] }],
    PostToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: postTool }] }],
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: prompt, timeout: 5 }] }],
  };
}

/**
 * Merge our hooks into the user's, per event, WITHOUT dropping theirs.
 *
 * Entries are matched by the hook SCRIPT NAME, not the full command string, so
 * that re-running is idempotent even when the path has moved. Matching on the
 * whole command was a latent bug: any relocation of a wrapper (the
 * `integrations/mcp-constraint-monitor` -> `integrations/constraint-monitor`
 * rename being the case that surfaced it) left the stale entry in place and
 * appended the new one, so the hook ran twice per tool call. `install.sh` has
 * always stripped by script name for the same reason; this matches it.
 */
function hookScriptName(command) {
  const match = /([\w.-]+\.(?:js|mjs|cjs))\b/.exec(command || '');
  return match ? match[1] : command;
}

function mergeHooks(userHooks = {}, ours) {
  const out = { ...userHooks };
  for (const [event, ourEntries] of Object.entries(ours)) {
    const theirs = Array.isArray(out[event]) ? out[event] : [];
    const ourScripts = new Set(
      ourEntries.flatMap((e) => (e.hooks || []).map((h) => hookScriptName(h.command))),
    );
    // Drop any previous copy of OUR hooks (identified by script name, so old
    // paths are replaced rather than duplicated), keep theirs.
    const kept = theirs.filter(
      (entry) => !(entry.hooks || []).some((h) => ourScripts.has(hookScriptName(h.command))),
    );
    out[event] = [...kept, ...ourEntries];
  }
  return out;
}

function readJsonIfPresent(path) {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    // A malformed user settings file is theirs to fix; do not fail the launch.
    process.stderr.write(`[claude-runtime] warning: ${path} is not valid JSON — ignoring it\n`);
    return {};
  }
}

// ── 1. derived settings ──────────────────────────────────────────────────────
const userSettingsPath = join(home, '.claude', 'settings.json');
const userSettings = readJsonIfPresent(userSettingsPath);

const derived = {
  ...userSettings,
  hooks: mergeHooks(userSettings.hooks, codingHooks(repo)),
};

// Wrap the user's own status-line command so the context meter is rendered once,
// in the tmux status bar, instead of twice. scripts/claude-statusline.cjs runs
// whatever they had configured and strips only that one segment; it reads the
// original command out of their settings.json itself, so this stays a wrapper
// rather than a replacement. Wrapper-scoped like everything else here — a bare
// `claude` elsewhere is untouched.
//
// Conditional on them HAVING a command-type status line. With no status line
// configured there is no second gauge to remove, and installing the wrapper
// anyway would replace Claude Code's own default with the output of a command
// that has nothing to wrap — trading a duplicate gauge for a blank status line.
if (userSettings.statusLine?.type === 'command' && userSettings.statusLine.command) {
  const upstream = userSettings.statusLine.command;
  derived.statusLine = {
    ...userSettings.statusLine,
    // Pin the command being wrapped rather than letting the shim rediscover it.
    // In global scope the shim IS the command in settings.json, so a shim that
    // re-read that file would find itself; naming the upstream here keeps the
    // wrapper honest in both scopes and makes the chain readable to anyone who
    // opens the settings file.
    command: `CODING_UPSTREAM_STATUSLINE=${JSON.stringify(upstream)} node ${repo}/scripts/claude-statusline.cjs`,
  };
}

// ── 1b. global scope: write the same merged settings to the user's own file ──
//
// `--install-global` is what `CODING_AGENT_SCOPE=global` needs. In that scope
// bin/coding passes no --settings, so the derived file below is never read and
// the project's three hooks (constraint monitor, tool-interaction capture,
// health prompt) would simply not run — silently. Tool-interaction capture is
// how a foreground Claude session reaches token accounting, so losing it looks
// like a dashboard that has gone flat rather than like a misconfiguration.
//
// It writes the SAME object the wrapper path derives, so the two scopes cannot
// drift: one mergeHooks(), one hook list, one status-line decision. install.sh's
// install_constraint_monitor_hooks() installs the same three hooks with the same
// dedup-by-script-name semantics; running either leaves the same state.
if (process.argv.includes('--install-global')) {
  const backup = `${userSettingsPath}.pre-global-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  if (existsSync(userSettingsPath)) copyFileSync(userSettingsPath, backup);
  writeFileSync(userSettingsPath, `${JSON.stringify(derived, null, 2)}\n`);
  process.stderr.write(
    `[claude-runtime] global scope: merged coding hooks into ${userSettingsPath}\n`
    + `[claude-runtime] previous settings saved to ${backup}\n`,
  );
}

const runtimeDir = join(repo, '.coding', 'runtime');
mkdirSync(runtimeDir, { recursive: true });
const settingsOut = join(repo, '.coding', 'runtime', 'claude-settings.json');
writeFileSync(settingsOut, `${JSON.stringify(derived, null, 2)}\n`);

// ── 2. slash commands as a session-scoped plugin ─────────────────────────────
// `--plugin-dir` loads commands for one session only, so the repo's commands
// stay live instead of going stale as copies in ~/.claude/commands.
const pluginDir = join(repo, '.coding', 'claude-plugin');
const pluginCommands = join(pluginDir, 'commands');
const manifestDir = join(pluginDir, '.claude-plugin');
rmSync(pluginDir, { recursive: true, force: true });
mkdirSync(manifestDir, { recursive: true });
mkdirSync(pluginCommands, { recursive: true });
writeFileSync(
  join(manifestDir, 'plugin.json'),
  `${JSON.stringify({ name: 'coding-skills', description: "This project's slash commands", version: '1.0.0' }, null, 2)}\n`,
);

const srcCommands = join(repo, '.claude', 'commands');
let commandCount = 0;
if (existsSync(srcCommands)) {
  for (const f of readdirSync(srcCommands)) {
    if (!f.endsWith('.md')) continue;
    copyFileSync(join(srcCommands, f), join(pluginCommands, f));
    commandCount += 1;
  }
}

process.stderr.write(
  `[claude-runtime] derived settings (${Object.keys(derived.hooks).length} hook events, user's own preserved) + ${commandCount} slash commands\n`,
);

// stdout contract: settings path on line 1, plugin dir on line 2.
process.stdout.write(`${settingsOut}\n${pluginDir}\n`);
