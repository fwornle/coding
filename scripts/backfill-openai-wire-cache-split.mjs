#!/usr/bin/env node
/**
 * One-shot repair of `input_tokens` / `total_tokens` on OpenAI-wire rows.
 *
 * THE DEFECT. `token_usage` carries one `input_tokens` column that meant two
 * different things depending on who answered the call:
 *
 *   Anthropic wire  — `input_tokens` is FRESH input; `cache_read_input_tokens`
 *                     is a separate, additive counter.
 *   OpenAI wire     — `prompt_tokens` is EVERYTHING sent, cache hits included;
 *                     `cached_tokens` is a breakdown of it, not an addition.
 *
 * The proxy recorded each provider's number verbatim, so the column could not
 * be summed or compared across providers. Measured 2026-08-29 over 24h: the
 * background mentions classifier showed 51.9M tokens (23.3K of every 23.8K-token
 * row was a cache hit, counted in full) while intensively-used foreground
 * Opus-5 showed 726K (its 320.8M of cache reads excluded entirely) — a ~450x
 * understatement that inverted which of the two dominated.
 *
 * `openAIFreshInputTokens` in the proxy fixes this at the parse boundary for
 * every NEW row. This script makes the existing rows agree, so the dashboard is
 * not reading two conventions at once.
 *
 * WHAT IT TOUCHES, AND WHAT IT DELIBERATELY DOES NOT. Only providers whose rows
 * come from the proxy's OpenAI HTTP path — the exact path the code fix changed.
 * Verified on this database as 100% nested-convention, with no additive row to
 * misread. The file-adapter providers (`github-copilot`/`token-adapter-opencode`,
 * `claude-code`, `anthropic`) are LEFT ALONE: their rows are Anthropic-convention
 * and already correct, and `token-adapter-opencode` in particular carries both
 * shapes within one process, so no per-row rule could separate them safely. A
 * row is only rewritten when `input_tokens >= cache_read_tokens > 0`, which is
 * the arithmetic signature of the nested convention; anything else is skipped
 * even inside a targeted provider.
 *
 * IDEMPOTENCY IS ENFORCED BY A MARKER, NOT BY THE DATA. The tempting assumption
 * — "after correction a touched row has input_tokens < cache_read_tokens, so it
 * stops matching" — is FALSE, and was in this script's first version. A row with
 * 10,000 prompt tokens of which 2,000 were cached corrects to 8,000 fresh input
 * and still satisfies `input_tokens >= cache_read_tokens`; on this database 865
 * of 25,455 corrected rows (3.4%) stayed selectable, and a second `--apply`
 * would have silently subtracted a further 10.2M tokens from already-correct
 * rows. Nothing about the arithmetic distinguishes a corrected row from an
 * uncorrected one, so the fact of having run is recorded explicitly in
 * `token_usage_migrations` and a second run refuses.
 *
 * Usage:
 *   node scripts/backfill-openai-wire-cache-split.mjs            # dry run (default)
 *   node scripts/backfill-openai-wire-cache-split.mjs --apply
 *   node scripts/backfill-openai-wire-cache-split.mjs --db=PATH
 *   node scripts/backfill-openai-wire-cache-split.mjs --apply --force   # re-run anyway
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as process from 'node:process';
import { DatabaseSync } from 'node:sqlite';

/**
 * Providers served by the proxy's OpenAI-compatible HTTP leg.
 *
 * Named explicitly rather than derived from the routing config: this is a
 * statement about how HISTORICAL rows were captured, and today's config says
 * nothing about a provider that has since been renamed or retired. `copilot` is
 * the pre-2026-08 spelling of `gh-copilot` and is included for that reason.
 */
const OPENAI_WIRE_PROVIDERS = ['gh-copilot', 'copilot', 'qwen-laptop', 'groq', 'openai', 'qwen-local'];

/** Marker recorded once this migration has been applied to a database. */
const MIGRATION_NAME = 'openai-wire-cache-split-2026-08-29';

function parseArgs(argv) {
  const args = {
    apply: false,
    force: false,
    db: path.resolve(process.cwd(), '.data/llm-proxy/token-usage.db'),
  };
  for (const a of argv) {
    if (a === '--apply') args.apply = true;
    else if (a === '--force') args.force = true;
    else if (a.startsWith('--db=')) args.db = path.resolve(a.slice('--db='.length));
  }
  return args;
}

/** Create the marker table if absent. Safe on every run, including dry ones. */
function ensureMigrationsTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS token_usage_migrations (
    name         TEXT PRIMARY KEY,
    applied_at   TEXT NOT NULL,
    rows_changed INTEGER NOT NULL DEFAULT 0
  )`);
}

/** The marker row for this migration, or null. */
function migrationRecord(db) {
  return db.prepare('SELECT name, applied_at, rows_changed FROM token_usage_migrations WHERE name = ?')
    .get(MIGRATION_NAME) ?? null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.db)) {
    process.stderr.write(`FATAL: no such database: ${args.db}\n`);
    process.exit(2);
  }
  const db = new DatabaseSync(args.db);
  ensureMigrationsTable(db);

  const already = migrationRecord(db);
  if (already && !args.force) {
    process.stderr.write(
      `already applied to this database on ${already.applied_at} `
      + `(${Number(already.rows_changed).toLocaleString()} rows).\n`
      + 'Re-running would subtract the cache split a SECOND time from rows that\n'
      + 'still satisfy input_tokens >= cache_read_tokens after correction, which\n'
      + 'is most of the large ones. Pass --force only if you know the previous\n'
      + 'run did not take effect.\n',
    );
    db.close();
    return;
  }
  const placeholders = OPENAI_WIRE_PROVIDERS.map(() => '?').join(', ');

  // The selection is the safety argument, so it is stated once and reused for
  // both the preview and the update — they cannot drift apart.
  const WHERE = `provider IN (${placeholders})
       AND cache_read_tokens > 0
       AND input_tokens >= cache_read_tokens`;

  const preview = db.prepare(
    `SELECT provider, COUNT(*) AS rows,
            SUM(input_tokens) AS input_before,
            SUM(input_tokens - cache_read_tokens) AS input_after,
            SUM(cache_read_tokens) AS cache_read
       FROM token_usage WHERE ${WHERE}
      GROUP BY provider ORDER BY rows DESC`,
  ).all(...OPENAI_WIRE_PROVIDERS);

  if (preview.length === 0) {
    process.stderr.write('nothing to do — no nested-convention rows found (already migrated?)\n');
    db.close();
    return;
  }

  process.stderr.write(`${args.apply ? 'APPLYING' : 'DRY RUN'} against ${args.db}\n\n`);
  let totRows = 0; let totBefore = 0; let totAfter = 0;
  for (const r of preview) {
    totRows += r.rows; totBefore += r.input_before; totAfter += r.input_after;
    process.stderr.write(
      `  ${String(r.provider).padEnd(14)} ${String(r.rows).padStart(7)} rows  `
      + `input ${Number(r.input_before).toLocaleString()} -> ${Number(r.input_after).toLocaleString()}  `
      + `(cache_read ${Number(r.cache_read).toLocaleString()} moves out of the total)\n`,
    );
  }
  process.stderr.write(
    `\n  TOTAL ${totRows.toLocaleString()} rows, `
    + `input ${totBefore.toLocaleString()} -> ${totAfter.toLocaleString()} `
    + `(${(totBefore - totAfter).toLocaleString()} tokens were cache hits counted as fresh input)\n`,
  );

  if (!args.apply) {
    process.stderr.write('\ndry run — nothing written. Re-run with --apply.\n');
    db.close();
    return;
  }

  // total_tokens is recomputed from the corrected input rather than decremented,
  // so a row whose stored total never equalled input+output is repaired too
  // instead of having an error carried forward.
  db.exec('BEGIN IMMEDIATE');
  try {
    const info = db.prepare(
      `UPDATE token_usage
          SET input_tokens = input_tokens - cache_read_tokens,
              total_tokens = (input_tokens - cache_read_tokens) + output_tokens
        WHERE ${WHERE}`,
    ).run(...OPENAI_WIRE_PROVIDERS);
    // Same transaction as the UPDATE: a committed correction without its marker
    // would invite exactly the double-application this marker exists to stop.
    db.prepare('INSERT OR REPLACE INTO token_usage_migrations (name, applied_at, rows_changed) VALUES (?, ?, ?)')
      .run(MIGRATION_NAME, new Date().toISOString(), Number(info.changes));
    db.exec('COMMIT');
    process.stderr.write(`\ncommitted: ${Number(info.changes).toLocaleString()} rows updated, migration marked\n`);
  } catch (e) {
    db.exec('ROLLBACK');
    process.stderr.write(`\nROLLED BACK: ${e.message}\n`);
    process.exitCode = 1;
  }

  db.close();
}

main();
