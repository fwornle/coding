#!/usr/bin/env node
/**
 * Phase 52 D-10 — Zero-unknown acceptance gate.
 *
 * Queries the rapid-llm-proxy's `.data/llm-proxy/token-usage.db` and asserts
 * that no LLM call after a given anchor timestamp landed with
 * `process='unknown'`. Used as the final acceptance gate for Phase 52 Plan 01
 * after a fresh wave-analysis production run — if a wave-1/2/3/4 or
 * ontology-classify call site slipped through without a process tag, this
 * script catches it and prints the offending (provider, model) breakdown.
 *
 * Usage:
 *   node scripts/verify-zero-unknown.mjs --anchor <ISO-8601 timestamp>
 *   node scripts/verify-zero-unknown.mjs                # loose: last 1 hour
 *
 * Exit codes:
 *   0  success — zero unknown rows in the post-anchor window
 *   1  failure — at least one row has process='unknown' since the anchor;
 *      forensic breakdown is printed to stderr
 *   2  bad CLI args / DB-schema mismatch
 *
 * Env:
 *   TOKEN_USAGE_DB  default ./.data/llm-proxy/token-usage.db
 *
 * Output:
 *   - On success: a single line to stdout
 *       [verify-zero-unknown] PASS: 0 unknown rows since <anchor>
 *   - On failure: a line to stderr + a per-(provider, model) breakdown table
 *       [verify-zero-unknown] FAIL: <n> unknown rows since <anchor>
 *       provider     model                  n
 *       ...
 *
 * No `console.*` — all output goes through `process.stdout.write` /
 * `process.stderr.write` per CLAUDE.md `no-console-log` constraint.
 *
 * Implementation notes:
 *   - Opens the DB via `better-sqlite3` (already a project dep, see
 *     `package.json: "better-sqlite3": "^11.7.0"`). Mirrors
 *     `scripts/backfill-raw-observations.mjs:30` for the require pattern.
 *   - Hardcoded SELECT projection — never reads `prompt_preview` or any
 *     PII column (T-52-01-02 mitigation).
 *   - Throws when the `token_usage` table or required columns are missing
 *     (treated as a Phase 52 schema-mismatch bug, not a routine failure).
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const args = process.argv.slice(2);
const ANCHOR = parseStrArg(args, '--anchor');
const DB_PATH = process.env.TOKEN_USAGE_DB
  || path.resolve('.data/llm-proxy/token-usage.db');

function parseStrArg(argv, flag) {
  const i = argv.indexOf(flag);
  if (i < 0) return null;
  return argv[i + 1] || null;
}

function writeStdout(line) {
  process.stdout.write(line.endsWith('\n') ? line : line + '\n');
}

function writeStderr(line) {
  process.stderr.write(line.endsWith('\n') ? line : line + '\n');
}

function pad(s, width) {
  s = String(s);
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

function main() {
  if (!fs.existsSync(DB_PATH)) {
    writeStderr(`[verify-zero-unknown] ERROR: token-usage DB not found at ${DB_PATH}`);
    writeStderr(`  set TOKEN_USAGE_DB env var to override.`);
    process.exit(2);
  }

  // Resolve the anchor — explicit ISO timestamp, or fall back to "1 hour ago".
  // The fallback exists so an operator can run this script ad-hoc without
  // having captured a pre-run timestamp, but the Phase 52 acceptance gate
  // ALWAYS passes --anchor with the pre-run capture.
  let anchorClause;
  let anchorDisplay;
  if (ANCHOR) {
    anchorClause = '?';
    anchorDisplay = ANCHOR;
  } else {
    anchorClause = `datetime('now', '-1 hour')`;
    anchorDisplay = `<loose: ${anchorClause}>`;
  }

  let db;
  try {
    db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  } catch (err) {
    writeStderr(`[verify-zero-unknown] ERROR: failed to open ${DB_PATH}: ${err.message}`);
    process.exit(2);
  }

  try {
    // Schema-mismatch guard — throws if the columns we read have moved.
    const columns = db.pragma('table_info(token_usage)');
    const colNames = new Set(columns.map((c) => c.name));
    for (const required of ['process', 'provider', 'model', 'timestamp']) {
      if (!colNames.has(required)) {
        throw new Error(
          `token_usage table missing required column '${required}' — schema may have changed`,
        );
      }
    }

    const countSql =
      `SELECT COUNT(*) AS n FROM token_usage ` +
      `WHERE process = 'unknown' AND timestamp > ${anchorClause}`;
    const breakdownSql =
      `SELECT provider, model, COUNT(*) AS n FROM token_usage ` +
      `WHERE process = 'unknown' AND timestamp > ${anchorClause} ` +
      `GROUP BY provider, model ORDER BY n DESC`;

    const params = ANCHOR ? [ANCHOR] : [];
    const countRow = db.prepare(countSql).get(...params);
    const n = countRow && typeof countRow.n === 'number' ? countRow.n : 0;

    if (n === 0) {
      writeStdout(`[verify-zero-unknown] PASS: 0 unknown rows since ${anchorDisplay}`);
      process.exit(0);
    }

    writeStderr(`[verify-zero-unknown] FAIL: ${n} unknown rows since ${anchorDisplay}`);
    writeStderr('');
    writeStderr(`${pad('provider', 16)}${pad('model', 32)}n`);
    writeStderr(`${pad('--------', 16)}${pad('-----', 32)}-`);

    const breakdown = db.prepare(breakdownSql).all(...params);
    for (const row of breakdown) {
      writeStderr(
        `${pad(row.provider ?? '(null)', 16)}${pad(row.model ?? '(null)', 32)}${row.n}`,
      );
    }
    process.exit(1);
  } catch (err) {
    writeStderr(`[verify-zero-unknown] ERROR: ${err.message}`);
    process.exit(2);
  } finally {
    try { db.close(); } catch { /* best-effort */ }
  }
}

main();
