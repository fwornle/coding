#!/usr/bin/env node
/**
 * Clean up "useless" rows from the observations DB — entries that survived the
 * write pipeline but carry no information value:
 *
 *   1. "[Raw] N messages (...). LLM summary unavailable."
 *      ObservationWriter's _fallbackSummary() output when /api/complete failed
 *      and the row was persisted with quality='low' so the dashboard still
 *      shows *something*. Once backfill has had its pass at re-summarizing
 *      these and given up (LLM returned scaffold / "No actionable content"),
 *      they are dead weight.
 *
 *   2. Placeholder-leakage rows where the LLM echoed the prompt template's
 *      bracketed slot text instead of filling it in, e.g.
 *      "Intent: [what the developer actually asked or requested ...]"
 *      Common with very short user messages (system reminders, "yes",
 *      "/clear" invocations) where the model fails to obey the template
 *      and just regurgitates the scaffold.
 *
 * Safety:
 *   - Backs up matching rows to .observations/exports/useless-cleanup-<ts>.json
 *     before deleting (mkdir -p the directory if needed — the ad-hoc heredoc
 *     version of this on 2026-05-20 failed silently when the directory was
 *     missing).
 *   - Skips rows where digested_at is set, because digests.observation_ids
 *     references those rows by id (no FK constraint enforces it, but a dangling
 *     reference is still a corruption signal).
 *   - --dry-run prints what would be deleted without writing anything.
 *
 * Usage:
 *   node scripts/cleanup-useless-observations.mjs                 # delete (with backup)
 *   node scripts/cleanup-useless-observations.mjs --dry-run       # preview only
 *   node scripts/cleanup-useless-observations.mjs --since <ISO>   # only rows newer than ISO timestamp
 *
 * Env:
 *   OBSERVATIONS_DB     default ./.observations/observations.db
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SINCE = parseStrArg(args, '--since');

const DB_PATH = process.env.OBSERVATIONS_DB
  || path.resolve('.observations/observations.db');
const BACKUP_DIR = path.resolve('.observations/exports');

function parseStrArg(argv, flag) {
  const i = argv.indexOf(flag);
  if (i < 0) return null;
  return argv[i + 1] || null;
}

function out(msg) { process.stdout.write(`${msg}\n`); }
function err(msg) { process.stderr.write(`${msg}\n`); }

// Predicates encoded in SQL so the count and the delete see the exact same row set.
// Each pattern matches a category of "useless" rows; the digested_at guard prevents
// deleting rows that have been absorbed into a digest (the digest stores the id
// in its observation_ids JSON column and dropping the underlying row would leave
// the digest with a dangling reference).
const PATTERN_CLAUSES = [
  "summary LIKE '[Raw]%'",                                         // fallback rows
  "summary LIKE '%[what the developer actually asked%'",           // placeholder leakage (Intent slot)
  "summary LIKE '%[architectural decisions, solution strategy%'",  // placeholder leakage (Approach slot)
  "summary LIKE '%[the concrete solution or outcome%'",            // placeholder leakage (Result slot)
];

function buildWhere(extraClauses = []) {
  const patternMatch = `(${PATTERN_CLAUSES.join(' OR ')})`;
  const notDigested = `(digested_at IS NULL OR digested_at = '')`;
  const clauses = [patternMatch, notDigested, ...extraClauses];
  return clauses.join(' AND ');
}

function tsForFilename() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

function main() {
  if (!fs.existsSync(DB_PATH)) {
    err(`[cleanup] DB not found: ${DB_PATH}`);
    process.exit(1);
  }
  const db = new Database(DB_PATH);

  const extra = [];
  const params = [];
  if (SINCE) {
    extra.push('created_at >= ?');
    params.push(SINCE);
  }
  const where = buildWhere(extra);

  const total = db.prepare('SELECT COUNT(*) AS n FROM observations').get().n;
  const candidates = db.prepare(`SELECT COUNT(*) AS n FROM observations WHERE ${where}`).get(...params).n;
  const protectedRows = db.prepare(
    `SELECT COUNT(*) AS n FROM observations
     WHERE (${PATTERN_CLAUSES.join(' OR ')})
       AND digested_at IS NOT NULL AND digested_at != ''
     ${SINCE ? 'AND created_at >= ?' : ''}`
  ).get(...(SINCE ? [SINCE] : [])).n;

  out(`[cleanup] DB: ${DB_PATH}`);
  out(`[cleanup] total observations:       ${total}`);
  out(`[cleanup] matched (deletable):      ${candidates}`);
  out(`[cleanup] matched (digested, kept): ${protectedRows}`);
  if (SINCE) out(`[cleanup] filter: created_at >= ${SINCE}`);

  if (candidates === 0) {
    out('[cleanup] nothing to do.');
    db.close();
    return;
  }

  const rows = db.prepare(`SELECT * FROM observations WHERE ${where}`).all(...params);

  if (DRY_RUN) {
    out('[cleanup] DRY-RUN — sample of what would be deleted:');
    for (const r of rows.slice(0, 5)) {
      out(`  ${r.created_at}  ${r.agent}  ${(r.summary || '').slice(0, 80)}…`);
    }
    if (rows.length > 5) out(`  … and ${rows.length - 5} more`);
    db.close();
    return;
  }

  // Backup BEFORE delete. mkdir -p so a missing exports/ dir doesn't drop the
  // backup on the floor (the bug that motivated this script).
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const backupPath = path.join(BACKUP_DIR, `useless-cleanup-${tsForFilename()}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(rows, null, 2));
  out(`[cleanup] backup written: ${backupPath} (${rows.length} rows, ${fs.statSync(backupPath).size} bytes)`);

  // Delete in a single transaction; the AFTER DELETE trigger on observations
  // keeps observations_fts in sync.
  const before = db.prepare('SELECT COUNT(*) AS n FROM observations').get().n;
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM observations WHERE ${where}`).run(...params);
  });
  tx();
  const after = db.prepare('SELECT COUNT(*) AS n FROM observations').get().n;
  const ftsCount = db.prepare('SELECT COUNT(*) AS n FROM observations_fts').get().n;

  out(`[cleanup] deleted: ${before - after} rows (${before} → ${after})`);
  out(`[cleanup] FTS index in sync: observations=${after} fts=${ftsCount}${after === ftsCount ? ' ✓' : ' ✗ MISMATCH'}`);

  db.close();
}

main();
