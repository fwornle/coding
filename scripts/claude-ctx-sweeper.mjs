#!/usr/bin/env node
/**
 * Age-based sweeper for the status line's temp files.
 *
 * WHAT ACCUMULATES
 * ----------------
 * Three families land in the system temp directory and nothing ever removed them:
 *
 *   claude-ctx-<sessionId>.json          gsd-statusline.js writes it on every render;
 *                                        it is the bridge the tmux context gauge reads
 *                                        (lib/statusline/context-gauge.cjs).
 *   claude-ctx-<sessionId>-warned.json   GSD's context-monitor hook, tracking whether it
 *                                        has already warned about this session.
 *   claude-tmux-session-<name>.json      scripts/claude-statusline.cjs records which Claude
 *                                        session owns a tmux session, so the gauge draws
 *                                        for the right one.
 *
 * Each is ~100 bytes, so this is hygiene rather than a disk problem — but one file is left
 * behind per session forever, and Windows never reclaims %TEMP% on its own.
 *
 * WHY THE FILE'S OWN MTIME, AND NOT THE TRANSCRIPT'S
 * -------------------------------------------------
 * The tempting rule — "is ~/.claude/projects/<...>/<sessionId>.jsonl still being written?"
 * — is wrong, and measurably so. Transcript mtimes are bulk-touched: three transcripts in
 * three different projects were observed sharing an mtime to the second, and one session's
 * transcript was touched minutes ago while its ctx file had not moved in three days. That
 * is the same trap already documented for LSL activity detection — a transcript's mtime is
 * not evidence that its session is alive.
 *
 * These files have no such contamination. Only the render loop writes them, so mtime means
 * exactly "when this session last drew its status line": live sessions are seconds old,
 * finished ones hours to days. Measured on a real temp dir:
 *
 *     09-01 17:43  claude-ctx-8e716331…   dead, 3 days
 *     09-04 08:52  claude-ctx-71145877…   live, seconds
 *
 * Deleting one wrongly costs a blank gauge in that pane until its next render, which
 * rewrites the file — seconds, and self-healing. That is why a simple age rule is enough
 * and no liveness lookup (coordinator, tmux, process table) is warranted.
 *
 * SCOPE IS DELIBERATELY NARROW
 * ----------------------------
 * Only the three prefixes above, matched exactly. The temp directory is shared with the
 * rest of the OS and with other parts of this repo (vkb-server.pid, kgbench-needles-*,
 * the copilot KB stash); a sweeper that deleted by wildcard there would be a footgun
 * pointed at other people's files.
 *
 * NEVER THROW
 * -----------
 * Same contract as scripts/context-turns-sweeper-job.sh: a missing or unreadable temp
 * directory, a file that vanishes mid-sweep, a permission error — none of them abort the
 * run, and the exit status is always 0. This is invoked from the agent launch path
 * (bin/coding), where a non-zero exit or a thrown error would be a launch failure over
 * housekeeping.
 *
 * Usage:
 *   node scripts/claude-ctx-sweeper.mjs [--dry-run] [--retention-days=N]
 *                                       [--if-older-than=SECONDS] [--quiet]
 *
 * Env:
 *   CLAUDE_CTX_RETENTION_DAYS  age in days before a file is eligible (default 2)
 *   CLAUDE_CTX_SWEEP_TMPDIR    directory to sweep (default os.tmpdir()); the test seam,
 *                              so tests never touch the real temp dir
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Default retention.
 *
 * Two days is far longer than any gap between renders of a session that is still open —
 * Claude Code redraws its status line on essentially every UI event — while still bounding
 * the directory. Erring long is cheap here: an extra file costs 100 bytes, and the only
 * cost of erring short is one blank gauge until the next render.
 */
const DEFAULT_RETENTION_DAYS = 2;

/**
 * The exact prefixes this sweeper owns. Anything else in the temp directory belongs to
 * somebody else — see the scope note in the header.
 */
const PREFIXES = ['claude-ctx-', 'claude-tmux-session-'];

/** Name of the rate-limit stamp, kept in the swept directory so it travels with it. */
const STAMP_NAME = '.claude-ctx-sweeper-stamp';

function parseArgs(argv) {
  const opts = {
    dryRun: false,
    quiet: false,
    retentionDays: null,
    ifOlderThanSecs: null,
  };
  for (const arg of argv) {
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--quiet') opts.quiet = true;
    else if (arg.startsWith('--retention-days=')) {
      opts.retentionDays = Number(arg.slice('--retention-days='.length));
    } else if (arg.startsWith('--if-older-than=')) {
      opts.ifOlderThanSecs = Number(arg.slice('--if-older-than='.length));
    }
  }
  return opts;
}

/**
 * A positive finite number, or the fallback.
 *
 * Malformed input counts as "not stated" rather than being coerced: `Number('')` is 0 and
 * `Number('abc')` is NaN, and either one silently turned into a retention of zero would
 * delete every file including live sessions'. Same reasoning as resolveRequestTimeout()
 * in the proxy bridge, which refuses malformed values rather than coercing them.
 */
function positiveOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function sweepDir() {
  return process.env.CLAUDE_CTX_SWEEP_TMPDIR || os.tmpdir();
}

/**
 * Whether a sweep ran recently enough to skip this one.
 *
 * Called from the launch path, so this runs once per agent start; without the gate a burst
 * of launches would each re-scan the directory. A missing, corrupt or future-dated stamp
 * means "run" — the failure mode of a bad stamp must be an extra sweep, never a sweep that
 * silently never happens again.
 */
function sweptRecently(dir, withinSecs) {
  if (!withinSecs) return false;
  try {
    const stamp = JSON.parse(fs.readFileSync(path.join(dir, STAMP_NAME), 'utf8'));
    const last = Number(stamp?.last_run_at) || 0;
    const ageSecs = (Date.now() - last) / 1000;
    return ageSecs >= 0 && ageSecs < withinSecs;
  } catch {
    return false;
  }
}

/** Write the stamp atomically, so a concurrent reader never sees a partial file. */
function writeStamp(dir) {
  const file = path.join(dir, STAMP_NAME);
  const tmpFile = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmpFile, JSON.stringify({ last_run_at: Date.now() }));
    fs.renameSync(tmpFile, file);
  } catch {
    try { fs.unlinkSync(tmpFile); } catch { /* nothing to clean up */ }
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const dir = sweepDir();
  const retentionDays = positiveOr(
    opts.retentionDays ?? process.env.CLAUDE_CTX_RETENTION_DAYS,
    DEFAULT_RETENTION_DAYS
  );
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const say = (msg) => { if (!opts.quiet) process.stdout.write(`${msg}\n`); };

  if (sweptRecently(dir, opts.ifOlderThanSecs)) return;

  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    // No temp dir, or not readable. Nothing to do, and not an error.
    return;
  }

  let removed = 0;
  let kept = 0;
  for (const name of entries) {
    if (!PREFIXES.some((p) => name.startsWith(p)) || !name.endsWith('.json')) continue;
    const file = path.join(dir, name);
    try {
      // Re-stat rather than trusting a cached listing: a session can start writing between
      // readdir and here, and deleting a file that just became live is the one outcome
      // worth spending a syscall to avoid.
      const { mtimeMs } = fs.statSync(file);
      if (mtimeMs >= cutoff) { kept++; continue; }
      if (!opts.dryRun) fs.unlinkSync(file);
      removed++;
      say(`${opts.dryRun ? 'would remove' : 'removed'} ${name}`);
    } catch {
      // Vanished mid-sweep, or unreadable. Either way it is not this run's problem.
    }
  }

  say(`claude-ctx-sweeper: ${opts.dryRun ? 'would remove' : 'removed'} ${removed}, kept ${kept} (retention ${retentionDays}d, ${dir})`);
  if (!opts.dryRun) writeStamp(dir);
}

try {
  main();
} catch {
  // The never-throw contract, belt and braces: nothing above should escape, but this is
  // called from a launch path and must not be able to fail one.
}
process.exit(0);
