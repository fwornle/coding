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

import { isEnabled } from '../lib/features/index.mjs';

const repo = process.env.CODING_REPO || process.cwd();
const home = homedir();

/**
 * The hooks this project contributes, filtered by feature. Single source of
 * truth for both scopes.
 *
 * Each hook IS a feature's entry point into an agent session, so a disabled
 * feature must not install one:
 *
 *   PreToolUse        constraints  — the guardrail check itself
 *   PostToolUse       lsl          — tool-interaction capture, which is how a
 *                                    foreground session reaches live session
 *                                    logging AND token accounting
 *   UserPromptSubmit  health       — the health verification prompt hook
 *
 * Filtering here rather than at the two call sites is what keeps wrapper scope
 * and --install-global from drifting: one hook list, one decision, both scopes.
 *
 * `isEnabled` resolves closed on a broken config, but a broken config never
 * reaches here — the launcher's _resolve_features aborts first — so the
 * fail-closed default only applies to someone running this script by hand.
 */
function allCodingHooks(repoPath) {
  const preTool = `node ${repoPath}/integrations/constraint-monitor/src/hooks/pre-tool-hook-wrapper.js`;
  const postTool = `node ${repoPath}/scripts/tool-interaction-hook-wrapper.js`;
  const prompt = `node ${repoPath}/scripts/health-prompt-hook.js`;
  return {
    PreToolUse: { feature: 'constraints', entries: [{ matcher: '*', hooks: [{ type: 'command', command: preTool }] }] },
    PostToolUse: { feature: 'lsl', entries: [{ matcher: '*', hooks: [{ type: 'command', command: postTool }] }] },
    UserPromptSubmit: { feature: 'health', entries: [{ hooks: [{ type: 'command', command: prompt, timeout: 5 }] }] },
  };
}

/** Just the hooks whose feature is currently on. */
function codingHooks(repoPath) {
  const out = {};
  for (const [event, { feature, entries }] of Object.entries(allCodingHooks(repoPath))) {
    if (isEnabled(feature)) out[event] = entries;
  }
  return out;
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

/**
 * @param {object} userHooks  the user's own hooks, preserved
 * @param {object} ours       {event: entries[]} — what to install NOW
 * @param {object} all        {event: {feature, entries}} — everything we could
 *   install. The strip pass runs over ALL of them, not just `ours`: switching a
 *   feature off has to REMOVE the hook it installed on an earlier launch, and a
 *   strip driven by `ours` alone would leave it behind, running a disabled
 *   feature's code on every tool call.
 */
function mergeHooks(userHooks = {}, ours, all) {
  const out = { ...userHooks };
  for (const [event, { entries: everEntries }] of Object.entries(all)) {
    const theirs = Array.isArray(out[event]) ? out[event] : [];
    const ourScripts = new Set(
      everEntries.flatMap((e) => (e.hooks || []).map((h) => hookScriptName(h.command))),
    );
    // Drop any previous copy of OUR hooks (identified by script name, so old
    // paths are replaced rather than duplicated), keep theirs.
    const kept = theirs.filter(
      (entry) => !(entry.hooks || []).some((h) => ourScripts.has(hookScriptName(h.command))),
    );
    const ourEntries = ours[event] || [];
    // Leave the key out entirely when neither side contributes, rather than
    // writing an empty array the user never had.
    if (kept.length || ourEntries.length) out[event] = [...kept, ...ourEntries];
    else delete out[event];
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
  hooks: mergeHooks(userSettings.hooks, codingHooks(repo), allCodingHooks(repo)),
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
const statusLineWrapper = `${repo}/scripts/claude-statusline.cjs`;

/**
 * The command our wrapper should run, given whatever is configured today.
 *
 * Wrapping is NOT idempotent unless this exists. In global scope the wrapper is
 * itself the command in settings.json, so re-asserting would wrap the wrapper:
 * `CODING_UPSTREAM_STATUSLINE="CODING_UPSTREAM_STATUSLINE=..." node shim`,
 * nesting one level deeper on every launch. Recovering the ORIGINAL upstream
 * makes repeated assertion a no-op, which is what lets the launcher call this on
 * every start to undo a GSD reinstall.
 *
 * @returns the command to wrap, or null when it is already wrapped and the
 *   original cannot be recovered — in which case the caller must leave the
 *   user's setting untouched rather than guess.
 */
function upstreamStatusLineCommand(cmd) {
  if (!cmd.includes('claude-statusline.cjs')) return cmd;
  const m = cmd.match(/^CODING_UPSTREAM_STATUSLINE=("(?:[^"\\]|\\.)*")\s+node\s/);
  if (m) {
    try { return JSON.parse(m[1]); } catch { /* fall through */ }
  }
  return null;
}

if (userSettings.statusLine?.type === 'command' && userSettings.statusLine.command) {
  const upstream = upstreamStatusLineCommand(userSettings.statusLine.command);
  if (upstream !== null) {
    derived.statusLine = {
      ...userSettings.statusLine,
      // Pin the command being wrapped rather than letting the shim rediscover
      // it. In global scope the shim IS the command in settings.json, so a shim
      // that re-read that file would find itself; naming the upstream here keeps
      // the wrapper honest in both scopes and makes the chain readable to anyone
      // who opens the settings file.
      command: `CODING_UPSTREAM_STATUSLINE=${JSON.stringify(upstream)} node ${statusLineWrapper}`,
    };
  }
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
// Safe to call on EVERY launch, which is what makes the global install
// self-healing: reinstalling or updating GSD rewrites ~/.claude/settings.json's
// statusLine back to gsd-statusline.js, and the duplicated context meter would
// come back with it. Re-asserting at launch means the next `coding --claude`
// repairs that, rather than the user having to re-run the installer.
//
// Two properties make per-launch invocation acceptable:
//   • idempotent — writes nothing when the merged result already matches disk,
//     so the common case is a read;
//   • ONE backup, ever — a timestamped copy per launch would litter the user's
//     .claude directory. install.sh takes the same one-time-original approach
//     with its .coding-orig file.
if (process.argv.includes('--install-global')) {
  const next = `${JSON.stringify(derived, null, 2)}\n`;
  const current = existsSync(userSettingsPath)
    ? readFileSync(userSettingsPath, 'utf8')
    : null;

  if (current === next) {
    process.stderr.write('[claude-runtime] global scope: settings already current\n');
  } else {
    const backup = `${userSettingsPath}.coding-pre-global`;
    if (current !== null && !existsSync(backup)) {
      writeFileSync(backup, current);
      process.stderr.write(`[claude-runtime] saved a one-time original: ${backup}\n`);
    }
    writeFileSync(userSettingsPath, next);
    process.stderr.write(
      `[claude-runtime] global scope: coding hooks + status line asserted in ${userSettingsPath}\n`,
    );
  }
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
