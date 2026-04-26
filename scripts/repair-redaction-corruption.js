#!/usr/bin/env node
/**
 * Repair `<AWS_SECRET_REDACTED>` corruption in observations/digests.
 *
 * The aws_secret_standalone regex used to be `[a-zA-Z0-9+/]{40}` (no
 * boundary anchors), which ate the leading 40 chars of any sufficiently
 * long path. Example:
 *   /Users/Q284340/Agentic/coding/scripts/migrate-add-project-column.js
 * became:
 *   <AWS_SECRET_REDACTED>rate-add-project-column.js
 *
 * The fragment AFTER the token is always intact. We use it as a unique
 * suffix and search `git ls-files` for the original file. When exactly
 * one repo file's path ends with that fragment, we substitute the
 * canonical full path back into the corrupted text.
 *
 * Ambiguous cases (0 or >1 match) are reported and left untouched.
 *
 * Usage:
 *   node scripts/repair-redaction-corruption.js --dry-run
 *   node scripts/repair-redaction-corruption.js --execute
 */

import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../src/live-logging/SafeDatabase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(REPO_ROOT, '.observations', 'observations.db');

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--execute');
const VERBOSE = args.includes('--verbose');

function log(msg) { process.stderr.write(`[repair-redaction] ${msg}\n`); }

const TOKEN = '<AWS_SECRET_REDACTED>';
// Capture the path-like fragment that follows the redaction token.
// Stops at the first character that can't appear in a path/filename.
const FRAGMENT_RX = /<AWS_SECRET_REDACTED>([A-Za-z0-9._/+\-]+)/g;

/**
 * Build a suffix -> [paths] index from `git ls-files`. Each repo path
 * indexes itself plus several length-N suffixes so we can do fast
 * substring lookups without re-scanning the corpus per match.
 */
function buildPathIndex() {
  // git ls-files output can exceed the default 1MB exec buffer in this repo.
  // We also exclude obvious noise (node_modules, dist binaries, .specstory)
  // so the suffix lookup stays focused on real source files.
  const out = execSync('git ls-files', {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  const paths = out.split('\n').filter((p) => {
    if (!p) return false;
    if (p.startsWith('node_modules/') || p.includes('/node_modules/')) return false;
    if (p.startsWith('.specstory/')) return false;  // these are huge LSL transcripts
    if (p.endsWith('.png') || p.endsWith('.jpg') || p.endsWith('.gif')) return false;
    return true;
  });
  return paths.map((p) => `/${p}`);
}

const repoPaths = buildPathIndex();

const userIdRx = /\/Users\/(<USER_ID_REDACTED>|[A-Za-z0-9]+)\//;

/**
 * Find a unique repo path whose path ends with `fragment`. Returns null
 * if no match or more than one match.
 */
function findUniquePath(fragment) {
  if (!fragment || fragment.length < 4) return null;
  const matches = [];
  for (const p of repoPaths) {
    if (p.endsWith(fragment)) {
      matches.push(p.slice(1)); // drop the synthetic leading `/`
    }
  }
  if (matches.length === 1) return matches[0];
  return null;
}

/**
 * Replace every `<AWS_SECRET_REDACTED>frag` in `text` with the canonical
 * absolute path when the fragment uniquely identifies a repo file.
 *
 * Returns { text, stats } where stats counts replacements/ambiguities.
 */
function repairText(text) {
  if (!text || typeof text !== 'string' || !text.includes(TOKEN)) {
    return { text, stats: { fixed: 0, ambiguous: 0, unmatched: 0 } };
  }
  let fixed = 0, ambiguous = 0, unmatched = 0;
  const out = text.replace(FRAGMENT_RX, (whole, frag) => {
    // Try the longest plausible fragment (greedy regex already gave us that),
    // but if it has internal `/` we should also try ending substrings —
    // sometimes the trailing fragment captures more than just the path tail
    // (e.g. if the redaction was followed by a comma + another path).
    const candidates = [];
    candidates.push(frag);
    // Also try progressively shorter suffixes split on `/`
    let cur = frag;
    while (cur.includes('/')) {
      cur = cur.slice(cur.indexOf('/') + 1);
      if (cur.length >= 6) candidates.push('/' + cur);
    }

    for (const c of candidates) {
      const match = findUniquePath(c.startsWith('/') ? c : '/' + c);
      if (match) {
        fixed++;
        // Replace the corrupted span with the canonical absolute path.
        // We use Q284340-style absolute path; the redactor will replace
        // the user-id at write time per the user-ID rule.
        const fullPath = `/Users/<USER_ID_REDACTED>/Agentic/coding/${match}`;
        // If the original frag captured more than just the path tail,
        // append whatever wasn't part of the matched suffix.
        const usedSuffix = c.startsWith('/') ? c.slice(1) : c;
        const matchTail = match.endsWith(usedSuffix) ? usedSuffix : '';
        const trailing = frag.endsWith(matchTail) ? '' : frag.slice(frag.indexOf(matchTail) + matchTail.length);
        return fullPath + trailing;
      }
    }

    // Couldn't recover — leave the corruption in place
    if (frag.length < 4) unmatched++;
    else ambiguous++;
    return whole;
  });
  return { text: out, stats: { fixed, ambiguous, unmatched } };
}

function repairColumn(db, table, column, idCol = 'id') {
  const rows = db.prepare(
    `SELECT ${idCol} AS id, ${column} AS val FROM ${table} WHERE ${column} LIKE '%<AWS_SECRET_REDACTED>%'`
  ).all();
  log(`${table}.${column}: ${rows.length} corrupted rows`);

  const update = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${idCol} = ?`);
  const totals = { fixed: 0, ambiguous: 0, unmatched: 0, rows_updated: 0 };
  const txn = db.transaction((items) => {
    for (const r of items) {
      if (DRY_RUN) continue;
      update.run(r.newVal, r.id);
    }
  });

  const updates = [];
  for (const r of rows) {
    const { text, stats } = repairText(r.val);
    totals.fixed += stats.fixed;
    totals.ambiguous += stats.ambiguous;
    totals.unmatched += stats.unmatched;
    if (stats.fixed > 0 && text !== r.val) {
      totals.rows_updated++;
      updates.push({ id: r.id, newVal: text });
      if (VERBOSE) {
        log(`  ${table}.${column} id=${r.id}: fixed=${stats.fixed}`);
      }
    }
  }
  if (!DRY_RUN && updates.length > 0) txn(updates);
  log(`  totals: fixed=${totals.fixed} ambiguous=${totals.ambiguous} rows_updated=${totals.rows_updated}`);
  return totals;
}

function main() {
  log(`mode: ${DRY_RUN ? 'DRY RUN' : 'EXECUTE'}`);
  log(`indexed ${repoPaths.length} repo paths`);

  if (!fs.existsSync(DB_PATH)) {
    log(`DB not found at ${DB_PATH}`);
    process.exit(1);
  }

  const db = openDatabase(DB_PATH);

  const grand = { fixed: 0, ambiguous: 0, unmatched: 0, rows_updated: 0 };
  const targets = [
    ['observations', 'summary'],
    ['observations', 'metadata'],
    ['digests', 'summary'],
    ['digests', 'files_touched'],
    ['digests', 'metadata'],
    ['insights', 'summary'],
    ['insights', 'metadata'],
  ];

  for (const [table, col] of targets) {
    try {
      const t = repairColumn(db, table, col);
      grand.fixed += t.fixed;
      grand.ambiguous += t.ambiguous;
      grand.unmatched += t.unmatched;
      grand.rows_updated += t.rows_updated;
    } catch (err) {
      if (/no such (table|column)/i.test(err.message)) {
        log(`Skipping ${table}.${col}: ${err.message}`);
      } else {
        throw err;
      }
    }
  }

  if (!DRY_RUN) db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();

  log(`\nGRAND: fixed=${grand.fixed} ambiguous=${grand.ambiguous} unmatched=${grand.unmatched} rows_updated=${grand.rows_updated}`);
}

main();
