/**
 * scripts/bridge-obs-from-kmcore.mjs
 *
 * One-shot recovery: read km-core Observation entities and INSERT any
 * that are missing from the legacy `.observations/observations.db`
 * SQLite store, so the legacy ObservationConsolidator (still SQLite-
 * backed pending its own km-core cutover in a future Plan 44-1X) can
 * pick them up on its next pass.
 *
 * Context: Plan 44-13 (commit b58616713) cut ObservationWriter's write
 * path to km-core only — no more SQLite INSERT. The consolidator was
 * NOT yet cut over, so any observation written after Plan 44-13 land
 * is invisible to digest/insight pipelines. Today's gap-recovery
 * backfill (commit df4622b87) added 44 obs to km-core that this
 * divergence hides from the dashboard's digests + insights tabs.
 *
 * This script is a bridge for the gap period; once the consolidator
 * cutover plan lands, this script becomes obsolete and should be
 * deleted.
 *
 * Usage:
 *   node scripts/bridge-obs-from-kmcore.mjs              # mirror all missing
 *   node scripts/bridge-obs-from-kmcore.mjs --since '2026-06-04' # only since date
 *   node scripts/bridge-obs-from-kmcore.mjs --dry-run    # show what would insert
 */

import Database from 'better-sqlite3';
import path from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const sinceIdx = args.indexOf('--since');
const since = sinceIdx >= 0 && sinceIdx + 1 < args.length ? args[sinceIdx + 1] : null;

const KMCORE_BASE = process.env.OBS_API_URL || 'http://localhost:12436';
const DB_PATH = path.resolve('.observations/observations.db');

function log(msg) { process.stderr.write(`[bridge] ${msg}\n`); }

async function fetchKmCoreObservations() {
  let all = [];
  let offset = 0;
  const limit = 2000;
  while (true) {
    const url = `${KMCORE_BASE}/api/v1/entities?ontologyClass=Observation&limit=${limit}&offset=${offset}`;
    const res = await fetch(url);
    if (!res.ok) throw new(Error)(`km-core fetch failed: ${res.status} ${res.statusText}`);
    const body = await res.json();
    const items = body.data || [];
    all = all.concat(items);
    if (items.length < limit) break;
    offset += limit;
  }
  return all;
}

function toRowSchema(entity) {
  const meta = entity.metadata || {};
  const contentHash = meta.content_hash || meta.contentHash || null;
  const sessionId = meta.session_id || meta.sessionId || null;
  return {
    id: entity.id,
    summary: entity.description || meta.summary || '',
    messages: meta.messages ? JSON.stringify(meta.messages) : '[]',
    agent: meta.agent || 'claude',
    session_id: sessionId,
    source_file: meta.sourceFile || meta.source_file || null,
    created_at: entity.createdAt || (new(Date)()).toISOString(),
    metadata: JSON.stringify(meta),
    content_hash: contentHash,
    quality: meta.quality || 'normal',
    digested_at: null,
  };
}

async function main() {
  log(`source: ${KMCORE_BASE}`);
  log(`target: ${DB_PATH}`);
  if (isDryRun) log('dry-run: no INSERTs will be issued');
  if (since) log(`filter: only entities with createdAt >= ${since}`);

  log('reading km-core ...');
  const entities = await fetchKmCoreObservations();
  log(`fetched ${entities.length} Observation entities from km-core`);

  const filtered = since
    ? entities.filter(e => (e.createdAt || '') >= since)
    : entities;
  log(`after --since filter: ${filtered.length}`);

  log('opening SQLite ...');
  const db = new(Database)(DB_PATH);
  const existingIds = new(Set)(
    db.prepare('SELECT id FROM observations').all().map(r => r.id),
  );
  log(`SQLite already has ${existingIds.size} observations`);

  const missing = filtered.filter(e => !existingIds.has(e.id));
  log(`missing in SQLite: ${missing.length}`);

  if (missing.length === 0) {
    log('nothing to mirror — exiting');
    db.close();
    return;
  }

  if (isDryRun) {
    log('--- dry-run preview (first 5) ---');
    for (const e of missing.slice(0, 5)) {
      log(`  ${e.createdAt} ${e.id.slice(0, 8)} ${(e.name || '').slice(0, 60)}`);
    }
    db.close();
    return;
  }

  const stmt = db.prepare(`
    INSERT INTO observations
      (id, summary, messages, agent, session_id, source_file, created_at, metadata, content_hash, quality, digested_at)
    VALUES
      (@id, @summary, @messages, @agent, @session_id, @source_file, @created_at, @metadata, @content_hash, @quality, @digested_at)
  `);

  const insertMany = db.transaction((rows) => {
    let n = 0;
    for (const row of rows) {
      try {
        stmt.run(row);
        n++;
      } catch (err) {
        log(`  skip ${row.id.slice(0, 8)}: ${err.message}`);
      }
    }
    return n;
  });

  const rows = missing.map(toRowSchema);
  const inserted = insertMany(rows);
  log(`INSERTed ${inserted} rows`);
  db.close();
  log('done');
}

main().catch(err => {
  log(`FATAL: ${err.message}`);
  process.exit(1);
});
