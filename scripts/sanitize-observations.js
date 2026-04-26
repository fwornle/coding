#!/usr/bin/env node
/**
 * Run ObservationSanitizer across the observations DB.
 *
 * Recovers `<AWS_SECRET_REDACTED>frag` corruption AND dedupes file lists.
 * Prefers in-context recovery (other fields/entries in the same row) over
 * repo-wide search.
 *
 * Usage:
 *   node scripts/sanitize-observations.js --dry-run
 *   node scripts/sanitize-observations.js --execute
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../src/live-logging/SafeDatabase.js';
import { ObservationSanitizer, REDACTION_TOKEN } from '../src/live-logging/ObservationSanitizer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(REPO_ROOT, '.observations', 'observations.db');

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--execute');

function log(msg) { process.stderr.write(`[sanitize-obs] ${msg}\n`); }

function processObservations(db, sanitizer) {
  const rows = db.prepare(`
    SELECT id, summary, metadata FROM observations
    WHERE summary LIKE '%${REDACTION_TOKEN}%' OR metadata LIKE '%${REDACTION_TOKEN}%'
  `).all();
  log(`observations: ${rows.length} rows with corruption`);

  const update = db.prepare('UPDATE observations SET summary = ?, metadata = ? WHERE id = ?');
  const stats = { fixed: 0, deduped: 0, rows_updated: 0 };

  const txn = db.transaction((items) => {
    for (const r of items) update.run(r.summary, r.metadata, r.id);
  });

  const updates = [];
  for (const r of rows) {
    // Use the OTHER field as context for each: summary -> metadata as context, metadata -> summary
    const sumOut = sanitizer.sanitizeText(r.summary || '', [r.metadata || '']);
    const metaOut = sanitizer.sanitizeMetadata(r.metadata || '{}', [r.summary || '']);

    const newSum = sumOut.text;
    const newMeta = typeof metaOut.result === 'string' ? metaOut.result : JSON.stringify(metaOut.result);

    const hasRealChange = sumOut.fixed > 0 || metaOut.fixed > 0 || metaOut.deduped > 0;
    if (hasRealChange && (newSum !== r.summary || newMeta !== r.metadata)) {
      stats.rows_updated++;
      stats.fixed += sumOut.fixed + metaOut.fixed;
      stats.deduped += metaOut.deduped;
      updates.push({ id: r.id, summary: newSum, metadata: newMeta });
    }
  }
  if (!DRY_RUN && updates.length > 0) txn(updates);
  log(`  fixed=${stats.fixed} deduped=${stats.deduped} rows_updated=${stats.rows_updated}`);
  return stats;
}

function processDigests(db, sanitizer) {
  // Pick up rows that need repair OR rows whose files_touched list might be
  // dedupable even without corruption.
  const rows = db.prepare(`
    SELECT id, summary, files_touched, metadata FROM digests
  `).all();

  const update = db.prepare(
    'UPDATE digests SET summary = ?, files_touched = ?, metadata = ? WHERE id = ?'
  );
  const stats = { fixed: 0, deduped: 0, rows_updated: 0 };

  const txn = db.transaction((items) => {
    for (const r of items) update.run(r.summary, r.files_touched, r.metadata, r.id);
  });

  const updates = [];
  for (const r of rows) {
    const sumOut = sanitizer.sanitizeText(r.summary || '', [r.files_touched || '', r.metadata || '']);
    const filesOut = sanitizer.sanitizeFileList(r.files_touched || '[]', [r.summary || '', r.metadata || '']);
    const metaOut = sanitizer.sanitizeMetadata(r.metadata || '{}', [r.summary || '', r.files_touched || '']);

    const newSum = sumOut.text;
    const newFiles = typeof filesOut.result === 'string' ? filesOut.result : JSON.stringify(filesOut.result);
    const newMeta = typeof metaOut.result === 'string' ? metaOut.result : JSON.stringify(metaOut.result);

    const hasRealChange = sumOut.fixed > 0 || filesOut.fixed > 0 || metaOut.fixed > 0
      || filesOut.deduped > 0 || metaOut.deduped > 0;
    if (hasRealChange && (newSum !== r.summary || newFiles !== r.files_touched || newMeta !== r.metadata)) {
      stats.rows_updated++;
      stats.fixed += sumOut.fixed + filesOut.fixed + metaOut.fixed;
      stats.deduped += filesOut.deduped + metaOut.deduped;
      updates.push({ id: r.id, summary: newSum, files_touched: newFiles, metadata: newMeta });
    }
  }
  if (!DRY_RUN && updates.length > 0) txn(updates);
  log(`digests: fixed=${stats.fixed} deduped=${stats.deduped} rows_updated=${stats.rows_updated}`);
  return stats;
}

function processInsights(db, sanitizer) {
  const rows = db.prepare('SELECT id, summary, metadata FROM insights').all();
  const update = db.prepare('UPDATE insights SET summary = ?, metadata = ? WHERE id = ?');
  const stats = { fixed: 0, deduped: 0, rows_updated: 0 };

  const txn = db.transaction((items) => {
    for (const r of items) update.run(r.summary, r.metadata, r.id);
  });

  const updates = [];
  for (const r of rows) {
    const sumOut = sanitizer.sanitizeText(r.summary || '', [r.metadata || '']);
    const metaOut = sanitizer.sanitizeMetadata(r.metadata || '{}', [r.summary || '']);

    const newSum = sumOut.text;
    const newMeta = typeof metaOut.result === 'string' ? metaOut.result : JSON.stringify(metaOut.result);

    const hasRealChange = sumOut.fixed > 0 || metaOut.fixed > 0 || metaOut.deduped > 0;
    if (hasRealChange && (newSum !== r.summary || newMeta !== r.metadata)) {
      stats.rows_updated++;
      stats.fixed += sumOut.fixed + metaOut.fixed;
      stats.deduped += metaOut.deduped;
      updates.push({ id: r.id, summary: newSum, metadata: newMeta });
    }
  }
  if (!DRY_RUN && updates.length > 0) txn(updates);
  log(`insights: fixed=${stats.fixed} deduped=${stats.deduped} rows_updated=${stats.rows_updated}`);
  return stats;
}

function main() {
  log(`mode: ${DRY_RUN ? 'DRY RUN' : 'EXECUTE'}`);
  if (!fs.existsSync(DB_PATH)) {
    log(`DB not found at ${DB_PATH}`);
    process.exit(1);
  }
  const repoPaths = ObservationSanitizer.loadRepoPaths(REPO_ROOT);
  log(`indexed ${repoPaths.length} repo paths for fallback`);
  const sanitizer = new ObservationSanitizer({ repoPaths });

  const db = openDatabase(DB_PATH);
  const o = processObservations(db, sanitizer);
  const d = processDigests(db, sanitizer);
  const i = processInsights(db, sanitizer);
  if (!DRY_RUN) db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();
  log(`\nGRAND: fixed=${o.fixed + d.fixed + i.fixed} deduped=${o.deduped + d.deduped + i.deduped} rows_updated=${o.rows_updated + d.rows_updated + i.rows_updated}`);
}

main();
