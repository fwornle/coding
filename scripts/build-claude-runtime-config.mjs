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
  const preTool = `node ${repoPath}/integrations/mcp-constraint-monitor/src/hooks/pre-tool-hook-wrapper.js`;
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
 * Entries are matched by the command string so re-running is idempotent and
 * never accumulates duplicates.
 */
function mergeHooks(userHooks = {}, ours) {
  const out = { ...userHooks };
  for (const [event, ourEntries] of Object.entries(ours)) {
    const theirs = Array.isArray(out[event]) ? out[event] : [];
    const ourCommands = new Set(
      ourEntries.flatMap((e) => (e.hooks || []).map((h) => h.command)),
    );
    // Drop any previous copy of OUR hooks (identified by command), keep theirs.
    const kept = theirs.filter(
      (entry) => !(entry.hooks || []).some((h) => ourCommands.has(h.command)),
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

const runtimeDir = join(repo, '.coding', 'runtime');
mkdirSync(runtimeDir, { recursive: true });
const settingsOut = join(runtimeDir, 'claude-settings.json');
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
