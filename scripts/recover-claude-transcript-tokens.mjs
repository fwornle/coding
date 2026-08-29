#!/usr/bin/env node
/**
 * Recover foreground Claude token rows from session transcripts.
 *
 * WHY THIS IS NEEDED. Foreground Claude turns reach `token_usage` through the
 * file adapter (`buildClaudeTokenRows`), which is driven by hooks and daemons
 * that the `coding` wrapper installs PER LAUNCH. A session started with a bare
 * `claude` therefore produces no token rows at all: the transcript is written
 * normally, but nothing reads it, and the work is invisible to every board that
 * reports tokens or cost.
 *
 * That is not a small gap. On 2026-08-29 a bare-claude session ran from 06:16Z
 * to 09:44Z and accounted for 174.9M tokens — more than everything else on the
 * machine in the same window put together — while the dashboard showed a flat
 * line and reported the day as background-dominated.
 *
 * The transcript is the same artefact the live adapter reads, so nothing about
 * the recovery is reconstructive: it replays the exact rows the adapter would
 * have written, through the same builder and the same deduped insert.
 *
 * SAFE TO RE-RUN. `token_usage` carries a UNIQUE index on
 * `(user_hash, tool_call_id)`, and insertTokenRowDeduped honours it — a row
 * already present is skipped, and a cache-less existing row is enriched in
 * place rather than duplicated. Running this over a session the adapter already
 * captured adds nothing.
 *
 * Usage:
 *   node scripts/recover-claude-transcript-tokens.mjs                 # dry run, all sessions
 *   node scripts/recover-claude-transcript-tokens.mjs --apply
 *   node scripts/recover-claude-transcript-tokens.mjs --session=<uuid> --apply
 *   node scripts/recover-claude-transcript-tokens.mjs --since=2026-08-29 --apply
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as process from 'node:process';

import { buildClaudeTokenRows } from '../lib/lsl/token/claude-token-rows.mjs';
import { openTokenDb, insertTokenRowDeduped, ADAPTER_USER_HASH_CLAUDE } from '../lib/lsl/token/token-db.mjs';

/** A bare session UUID — the main-session transcripts. Sub-agent files live in a subdir. */
const SESSION_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

function parseArgs(argv) {
  const args = { apply: false, session: null, since: null, db: null, projectDir: null };
  for (const a of argv) {
    if (a === '--apply') args.apply = true;
    else if (a.startsWith('--session=')) args.session = a.slice('--session='.length);
    else if (a.startsWith('--since=')) args.since = a.slice('--since='.length);
    else if (a.startsWith('--db=')) args.db = path.resolve(a.slice('--db='.length));
    else if (a.startsWith('--project-dir=')) args.projectDir = path.resolve(a.slice('--project-dir='.length));
  }
  return args;
}

/**
 * Claude stores transcripts under ~/.claude/projects/<cwd with / and . as ->.
 * Derived rather than hardcoded so this works from any checkout.
 */
function defaultProjectDir() {
  const encoded = process.cwd().replace(/[/.]/g, '-');
  return path.join(os.homedir(), '.claude', 'projects', encoded);
}

function defaultDbPath() {
  return path.join(process.cwd(), '.data', 'llm-proxy', 'token-usage.db');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectDir = args.projectDir || defaultProjectDir();
  const dbPath = args.db || defaultDbPath();

  if (!fs.existsSync(projectDir)) {
    process.stderr.write(`FATAL: no transcript directory at ${projectDir}\n`);
    process.exit(2);
  }
  if (!fs.existsSync(dbPath)) {
    process.stderr.write(`FATAL: no token DB at ${dbPath}\n`);
    process.exit(2);
  }

  const files = fs.readdirSync(projectDir)
    .map((name) => ({ name, m: SESSION_RE.exec(name) }))
    .filter((e) => e.m)
    .map((e) => ({ sid: e.m[1], full: path.join(projectDir, e.name) }))
    .filter((e) => !args.session || e.sid === args.session);

  if (files.length === 0) {
    process.stderr.write(`no matching session transcripts in ${projectDir}\n`);
    return;
  }

  const db = openTokenDb(dbPath);
  process.stderr.write(`${args.apply ? 'APPLYING' : 'DRY RUN'} · ${files.length} transcript(s) · db=${dbPath}\n\n`);

  let grandNew = 0; let grandSeen = 0; let grandTokens = 0;
  for (const f of files) {
    let rows = [];
    try {
      rows = buildClaudeTokenRows(f.full) || [];
    } catch (err) {
      process.stderr.write(`  ${f.sid}  SKIPPED (parse failed: ${err.message})\n`);
      continue;
    }
    if (args.since) rows = rows.filter((r) => String(r.timestamp || '') >= args.since);
    if (rows.length === 0) continue;

    // Count how many of these the DB already has, using the same key its UNIQUE
    // index does. Reported separately from what is inserted so a run over an
    // already-captured session reads as "nothing to do" rather than as a no-op
    // that might have silently failed.
    let already = 0;
    for (const r of rows) {
      if (!r.tool_call_id) continue;
      const hit = db.prepare(
        'SELECT 1 FROM token_usage WHERE user_hash = ? AND tool_call_id = ? LIMIT 1',
      ).get(ADAPTER_USER_HASH_CLAUDE, r.tool_call_id);
      if (hit) already += 1;
    }
    const missing = rows.length - already;
    const tokens = rows.reduce(
      (a, r) => a + (r.input_tokens || 0) + (r.output_tokens || 0)
        + (r.cache_read_tokens || 0) + (r.cache_write_tokens || 0), 0,
    );

    process.stderr.write(
      `  ${f.sid}  ${String(rows.length).padStart(5)} rows  ${String(missing).padStart(5)} missing  `
      + `${tokens.toLocaleString().padStart(14)} tokens  ${rows[0].timestamp} → ${rows[rows.length - 1].timestamp}\n`,
    );

    if (args.apply && missing > 0) {
      for (const r of rows) {
        // task_id is the session uuid: that is what makes the row an AMBIENT
        // foreground session for auto-measure-foreground's claudePass, which
        // gates on a bare-UUID task_id.
        r.task_id = f.sid;
        r.user_hash = ADAPTER_USER_HASH_CLAUDE;
        insertTokenRowDeduped(db, r);
      }
    }
    grandNew += missing; grandSeen += already; grandTokens += tokens;
  }

  process.stderr.write(
    `\n  TOTAL ${grandNew.toLocaleString()} missing rows, ${grandSeen.toLocaleString()} already captured, `
    + `${grandTokens.toLocaleString()} tokens across the matched transcripts\n`,
  );
  if (!args.apply) process.stderr.write('\ndry run — nothing written. Re-run with --apply.\n');
  try { db.close?.(); } catch { /* noop */ }
}

main();
