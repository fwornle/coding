#!/usr/bin/env node
/**
 * One-shot migration: bucket the legacy monolithic
 *   .data/llm-proxy-export/token-usage.json
 * into per-(date, window, user) files under
 *   .data/llm-proxy-export/YYYY/MM/YYYY-MM-DD_HHMM-HHMM_<hash6>.json
 * mirroring the LSL convention. Deletes the monolith on completion.
 *
 * Idempotent: re-running after the monolith is gone exits cleanly with
 *   "[migrate-token-usage] monolith already removed — nothing to do".
 *
 * Phase 36, Plan 36-05. Companion to Plans 36-03 (writer) + 36-04
 * (composite-PK schema + always-on hydrateFromExports). After this
 * script runs the proxy boots, hydrate walks the new per-hour files,
 * and INSERT OR IGNORE deduplicates against the composite PK
 * (user_hash, id) — so the round-trip is lossless.
 *
 * Usage:
 *   node scripts/migrate-token-usage-export.mjs              # live run
 *   node scripts/migrate-token-usage-export.mjs --dry-run    # plan only, no writes / deletes
 *   node scripts/migrate-token-usage-export.mjs --verbose    # log each per-hour file written
 *   node scripts/migrate-token-usage-export.mjs --help       # this message
 *
 * VERBOSE mode logs target filenames + row counts only — NEVER row contents
 * (prompt_preview can be sensitive). All logs go to stderr; stdout stays
 * empty so the script is safely chainable.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTimeWindow, utcToLocalTime } from './timezone-utils.js';
import { dateSubdirFromFilename } from './lsl-paths.js';
import UserHashGenerator from './user-hash-generator.js';

// ---------- CLI args ----------

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');
const HELP = args.includes('--help') || args.includes('-h');

if (HELP) {
  process.stdout.write(
    'Usage: node scripts/migrate-token-usage-export.mjs [--dry-run] [--verbose] [--help]\n' +
    '\n' +
    '  --dry-run   Print the bucketing plan to stderr. Writes no files, deletes nothing.\n' +
    '  --verbose   Log each per-hour file written (target path + row count). No row contents.\n' +
    '  --help, -h  Show this message and exit.\n' +
    '\n' +
    'Reads .data/llm-proxy-export/token-usage.json (legacy monolithic export)\n' +
    'and writes per-(date, window, user) files under\n' +
    '  .data/llm-proxy-export/YYYY/MM/YYYY-MM-DD_HHMM-HHMM_<hash6>.json\n' +
    'Deletes the monolith on completion. Idempotent: re-runs are no-ops.\n'
  );
  process.exit(0);
}

// ---------- Paths ----------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const EXPORT_DIR = path.join(ROOT, '.data', 'llm-proxy-export');
const MONO_PATH = path.join(EXPORT_DIR, 'token-usage.json');

// ---------- Hash validation (T-36-32) ----------

const HASH_RE = /^[a-z][a-z0-9]{5}$/;

function isValidHash(s) {
  return typeof s === 'string' && HASH_RE.test(s);
}

// ---------- Main ----------

function main() {
  // Idempotency guard (PATTERNS.md §6 risk #5). Re-running after the
  // monolith is gone is a clean no-op so the operator can re-invoke
  // without harm.
  if (!fs.existsSync(MONO_PATH)) {
    process.stderr.write('[migrate-token-usage] monolith already removed — nothing to do\n');
    process.exit(0);
  }

  // Compute current user's hash. Validate the shape — guards against
  // a broken hash generator silently producing 'fallback-user'-like
  // output (T-36-32).
  const userHash = UserHashGenerator.generateHash();
  if (!isValidHash(userHash)) {
    process.stderr.write(
      `[migrate-token-usage] generated hash "${userHash}" does not match /^[a-z][a-z0-9]{5}$/ — aborting\n`
    );
    process.exit(1);
  }
  process.stderr.write(`[migrate-token-usage] user_hash=${userHash}\n`);
  process.stderr.write(`[migrate-token-usage] reading ${MONO_PATH}\n`);

  // Read + parse monolith. On parse / shape failure we exit 1 WITHOUT
  // deleting the file (T-36-25).
  let rows;
  try {
    rows = JSON.parse(fs.readFileSync(MONO_PATH, 'utf-8'));
  } catch (err) {
    process.stderr.write(
      `[migrate-token-usage] failed to read ${MONO_PATH}: ${err.message}\n`
    );
    process.exit(1);
  }
  if (!Array.isArray(rows)) {
    process.stderr.write(
      `[migrate-token-usage] expected JSON array at ${MONO_PATH}, got ${typeof rows} — aborting\n`
    );
    process.exit(1);
  }

  // ---------- Bucket loop ----------

  const buckets = new Map(); // key='YYYY-MM-DD_HHMM-HHMM_<hash>' → row[]
  for (const row of rows) {
    if (!row || typeof row.timestamp !== 'string') {
      process.stderr.write(
        `[migrate-token-usage] skipping row without timestamp: ${JSON.stringify(row).slice(0, 120)}\n`
      );
      continue;
    }
    // PATTERNS.md §6 risk #3: pass the ISO string, not new Date(...) —
    // utcToLocalTime uses Intl.DateTimeFormat with the project tz so
    // it doesn't depend on the launchd TZ leaking into the process.
    const local = utcToLocalTime(row.timestamp);
    const y = local.getFullYear();
    const m = String(local.getMonth() + 1).padStart(2, '0');
    const d = String(local.getDate()).padStart(2, '0');
    const windowStr = getTimeWindow(local); // 'HHMM-HHMM'

    // Per-row user_hash: keep if the row already carries a valid hash;
    // else stamp the current contributor (we know who is running the
    // migration). PATTERNS.md §6 risk #1: do NOT default to 'unknown'.
    const rowHash = isValidHash(row.user_hash) ? row.user_hash : userHash;

    const key = `${y}-${m}-${d}_${windowStr}_${rowHash}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
    }
    // Always emit with a user_hash field set so the proxy hydrate path
    // can pick it up directly without falling back to filename parsing.
    bucket.push({ ...row, user_hash: rowHash });
  }

  process.stderr.write(
    `[migrate-token-usage] ${rows.length} rows → ${buckets.size} (date, window, user) buckets\n`
  );

  // ---------- Write loop ----------

  let totalWritten = 0;
  let totalMergedFiles = 0;
  for (const [key, bucketRows] of buckets) {
    const fname = `${key}.json`;
    const sub = dateSubdirFromFilename(fname); // 'YYYY/MM' or null
    const targetDir = sub ? path.join(EXPORT_DIR, sub) : EXPORT_DIR;
    const target = path.join(targetDir, fname);

    if (DRY_RUN) {
      process.stderr.write(`  [dry] ${target} ← ${bucketRows.length} rows\n`);
      continue;
    }

    // Defensive merge (step 11). If the proxy already wrote a per-hour
    // file for this same (date, window, user) — e.g. it ran briefly
    // between Plan 36-03 landing and this migration — merge by
    // (user_hash, id), keep existing rows + add only new ones, sort by
    // id ascending. The composite-PK rebuild from 36-04 means each
    // (user_hash, id) pair is globally unique.
    let merged = bucketRows;
    if (fs.existsSync(target)) {
      try {
        const existing = JSON.parse(fs.readFileSync(target, 'utf-8'));
        if (Array.isArray(existing)) {
          const seen = new Set(
            existing.map((r) => `${r.user_hash ?? ''}:${r.id}`)
          );
          const additions = bucketRows.filter(
            (r) => !seen.has(`${r.user_hash}:${r.id}`)
          );
          merged = [...existing, ...additions].sort(
            (a, b) => (a.id ?? 0) - (b.id ?? 0)
          );
          totalMergedFiles += 1;
          process.stderr.write(
            `[migrate-token-usage] merged with pre-existing ${path.relative(ROOT, target)} ` +
              `(kept ${existing.length} existing, added ${additions.length} new)\n`
          );
        }
      } catch (err) {
        process.stderr.write(
          `[migrate-token-usage] could not parse pre-existing ${target} — overwriting: ${err.message}\n`
        );
      }
    }

    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(target, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
    totalWritten += 1;
    if (VERBOSE) {
      process.stderr.write(
        `[migrate-token-usage] wrote ${path.relative(ROOT, target)} (${merged.length} rows)\n`
      );
    }
  }

  // ---------- Delete monolith (atomic-via-same-commit) ----------

  if (DRY_RUN) {
    process.stderr.write(
      `[migrate-token-usage] dry-run complete: would write ${buckets.size} files, ` +
        `would delete ${path.relative(ROOT, MONO_PATH)}\n`
    );
    process.exit(0);
  }

  fs.unlinkSync(MONO_PATH);
  process.stderr.write(
    `[migrate-token-usage] wrote ${totalWritten} files ` +
      `(${totalMergedFiles} merged with pre-existing), deleted ${MONO_PATH}\n`
  );
  process.exit(0);
}

main();
