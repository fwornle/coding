#!/usr/bin/env node
'use strict';
/**
 * Claude Code's status line for sessions launched through this repo.
 *
 * It runs the user's real status-line command (GSD's, normally) and removes ONE
 * thing from the output: the context-window meter. That meter now lives in the
 * tmux status bar — see lib/statusline/context-gauge.cjs — where every agent
 * gets one instead of only Claude. Without this, a Claude pane would show two
 * gauges reporting the same number.
 *
 * WHY A FILTER AND NOT AN EDIT TO gsd-statusline.js
 * -------------------------------------------------
 * ~/.claude/hooks/gsd-statusline.js is GSD-managed — it is listed in
 * ~/.claude/gsd-file-manifest.json, so `/gsd:update` reinstalls it and would
 * silently undo any edit, bringing the second gauge back with no obvious cause.
 * Filtering its output leaves that file untouched and keeps the change where
 * this repo can actually own it.
 *
 * Two consequences worth knowing:
 *   • gsd-statusline.js still writes $TMPDIR/claude-ctx-<session>.json, which
 *     GSD's own context-monitor hook depends on AND which the tmux gauge reads
 *     for Claude. Suppressing the render but keeping the bridge is exactly what
 *     is wanted; editing the source would have risked losing both.
 *   • This is wired in via the per-launch derived settings
 *     (scripts/build-claude-runtime-config.mjs), so it applies to sessions
 *     started through `coding` / `claude-mcp` only. A bare `claude` in any other
 *     terminal keeps its own status line untouched, which is the same wrapper
 *     scoping the hooks and MCP config already follow.
 *
 * Failure policy: if anything goes wrong — the upstream command is missing,
 * crashes, or its output does not match — pass the output through unchanged.
 * A duplicated gauge is a cosmetic annoyance; a blank status line is not.
 */

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Required by path, and tolerant of a moved repo, for the same reason
// resolveUpstream() is defensive: a globally-installed shim must still render.
// A missing gate means "on", which keeps the historical behaviour.
let statuslineEnabled = () => true;
try {
  ({ statuslineEnabled } = require(
    path.join(process.env.CODING_REPO || path.join(__dirname, '..'),
      'lib', 'statusline', 'feature-gate.cjs'),
  ));
} catch { /* no gate reachable — render, as this file always has */ }

/**
 * The context meter as gsd-statusline.js emits it: a colour SGR, an optional
 * 💀 for the critical band, exactly ten block glyphs, the percentage, and a
 * reset. Anchored on that structure rather than on a specific colour so a
 * retuned threshold does not quietly stop matching.
 *
 * The leading space is part of the segment (the meter is appended as
 * ` \x1b[32m…`), so it is consumed too — otherwise removing the meter would
 * leave a trailing space before the line ends.
 *
 * IMPORTANT — what must NOT match: GSD's milestone progress bar, which uses the
 * same ten glyphs and a percentage ("v7.6 [█████████░] 95% · executing"). The
 * discriminator is structural and reliable: the milestone bar is wrapped in
 * literal square brackets, so the character following the SGR is '[' and never a
 * block glyph, while the context meter's glyphs start immediately after it.
 * Requiring [█░] directly after the SGR is therefore what keeps the two apart —
 * do not relax that adjacency.
 */
// ESC (U+001B) is the thing being matched — this pattern's whole job is to
// recognise an ANSI-styled segment in another program's terminal output.
// Matching on the visible glyphs alone would leave the orphaned colour codes
// behind, and those would then tint the rest of the line.
// eslint-disable-next-line no-control-regex
const CTX_SEGMENT_RE = /\s*\x1b\[(?:\d+;)*\d+m(?:💀\s*)?[█░]{10}\s+\d{1,3}%\x1b\[0m/g;

/**
 * Locate the status-line command this shim wraps.
 *
 * Order matters: an explicit override wins, then the user's own configured
 * command read from ~/.claude/settings.json (so a user who has replaced GSD's
 * status line still gets THEIR line, not GSD's), then GSD's as the default.
 * Reading settings.json is what stops this shim from silently pinning everyone
 * to gsd-statusline.js forever.
 */
function resolveUpstream() {
  if (process.env.CODING_UPSTREAM_STATUSLINE) {
    return process.env.CODING_UPSTREAM_STATUSLINE;
  }
  try {
    const p = path.join(os.homedir(), '.claude', 'settings.json');
    const cmd = JSON.parse(fs.readFileSync(p, 'utf8'))?.statusLine?.command;
    // Guard against pointing at ourselves — that would fork-bomb the pane.
    if (cmd && !cmd.includes('claude-statusline.cjs')) return cmd;
  } catch {
    /* fall through to the default */
  }
  return `node "${path.join(os.homedir(), '.claude', 'hooks', 'gsd-statusline.js')}"`;
}

/**
 * Record which Claude session is running here, for the tmux context gauge.
 *
 * This shim is the ONLY place in the system that sees Claude Code's own session
 * id and the tmux session together, which is why the recording lives here rather
 * than in either renderer. The gauge previously had to guess the id from
 * project-keyed state, and on a fresh session guessed the session the user had
 * just left — see the long note in lib/statusline/context-gauge.cjs.
 *
 * The tmux session name has to be resolved rather than read: tmux exports
 * TMUX_PANE to programs started in a pane, not the session name, and the
 * renderers get the name (as TMUX_SESSION_NAME) from `#{session_name}` in the
 * status-right format string. `display-message` is the seam that turns one into
 * the other — measured at 10ms, against the ~40ms node spawn this function's
 * caller is already paying for the upstream status line.
 *
 * Everything here is best-effort by design. Not under tmux, no tmux binary, a
 * payload without a session id, an unwritable temp dir: skip the recording and
 * let the gauge fall back to what it did before. The status line is the job.
 */
function recordSessionForGauge(raw) {
  try {
    const pane = process.env.TMUX_PANE;
    if (!pane || !process.env.TMUX) return;

    const data = JSON.parse(raw);
    if (!data?.session_id) return;

    const tmuxSession = execFileSync(
      'tmux', ['display-message', '-p', '-t', pane, '#{session_name}'],
      { encoding: 'utf8', timeout: 1000, stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
    if (!tmuxSession) return;

    // Required lazily: a globally-installed shim whose coding repo has moved
    // must still render a status line, and this is the only import that can fail.
    require(path.join(__dirname, '..', 'lib', 'statusline', 'context-gauge.cjs'))
      .recordClaudeSession({
        tmuxSession,
        sessionId: data.session_id,
        cwd: data.workspace?.current_dir || null,
      });
  } catch {
    /* the gauge falls back on its own */
  }
}

let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { stdin += c; });
process.stdin.on('end', () => {
  // The `statusline` feature, off: no line, and no upstream spawn to produce
  // one. stdin is consumed first regardless — Claude Code writes the session
  // payload into this process, and exiting before the pipe drains would give it
  // an EPIPE on a path the user asked to be quiet.
  //
  // Known consequence, stated rather than hidden: the upstream we wrap
  // (~/.claude/hooks/gsd-statusline.js) is also what writes
  // $TMPDIR/claude-ctx-<session>.json, which GSD's own context-monitor hook
  // reads. Not spawning it stops that bridge too. The tmux gauge is the other
  // reader and it is off by the same switch, so nothing in THIS repo is left
  // half-fed — but GSD's monitor is, and turning the feature back on restores it.
  if (!statuslineEnabled()) {
    process.stdout.write('');
    process.exit(0);
  }

  recordSessionForGauge(stdin);

  const child = spawn(resolveUpstream(), {
    shell: true,
    stdio: ['pipe', 'pipe', 'inherit'],
  });

  let out = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (c) => { out += c; });

  // Never leave the pane without a status line because the upstream command is
  // missing or unexecutable.
  child.on('error', () => process.exit(0));

  child.on('close', () => {
    process.stdout.write(out.replace(CTX_SEGMENT_RE, ''));
    process.exit(0);
  });

  child.stdin.end(stdin);
});
