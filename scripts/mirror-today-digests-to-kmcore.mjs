#!/usr/bin/env node
/**
 * One-shot mirror: copy 2026-06-05 SQLite digests + referenced observations
 * into km-core so they become visible at /api/coding/digests post Plan 44-17.
 *
 * The 6 SQLite digests were created BEFORE the consolidator cutover landed
 * (commits 13876e204 .. 34bc0e5db). The cutover writes go to km-core only,
 * so these pre-cutover SQLite rows are stranded. Their referenced
 * observations are also SQLite-only (Phase 44 transition window obs that
 * predate the writer's km-core cutover for those specific rows).
 *
 * This script:
 *   1. reads digests + transitively-referenced observations from SQLite
 *   2. mirrors observations first (digests reference them via legacy ID)
 *   3. mirrors digests via the same legacyDigestToEntity adapter the
 *      post-cutover consolidator uses, so entity shape matches identically
 *
 * IMPORTANT: km-core's LevelDB is single-writer. obs-api MUST be stopped
 * before running this script. After the script completes, restart obs-api.
 *
 *   launchctl bootout "gui/$(id -u)/com.coding.obs-api"
 *   node scripts/mirror-today-digests-to-kmcore.mjs
 *   launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.coding.obs-api.plist
 *
 * Throwaway: once executed, this script can be deleted. Future days don't
 * have this divergence because the consolidator now writes to km-core
 * natively.
 */

import Database from 'better-sqlite3';
import { GraphKMStore, defaultOntologyDir } from '@fwornle/km-core';
import { legacyObservationToEntity, legacyDigestToEntity } from '@fwornle/km-core/adapters/legacy-ingest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SQLITE_DB = path.join(REPO_ROOT, '.observations', 'observations.db');
const KG_DB_PATH = path.join(REPO_ROOT, '.data', 'knowledge-graph', 'leveldb');
const KG_EXPORT_DIR = path.join(REPO_ROOT, '.data', 'knowledge-graph', 'exports');

const TARGET_DATE = process.argv[2] || '2026-06-05';
const DRY_RUN = process.argv.includes('--dry-run');
const runId = `mirror-${TARGET_DATE}-${Date.now()}`;
const now = new Date().toISOString();

function log(msg) { process.stderr.write(`[mirror] ${msg}\n`); }

log(`target date: ${TARGET_DATE}${DRY_RUN ? ' (dry-run)' : ''}`);

const sql = new Database(SQLITE_DB, { readonly: true });

const digestRows = sql.prepare(
  `SELECT id, date, theme, summary, observation_ids, agents, files_touched,
          quality, created_at, metadata, project
     FROM digests WHERE date = ?`
).all(TARGET_DATE);

const obsIds = new Set();
for (const d of digestRows) {
  let ids = [];
  try { ids = JSON.parse(d.observation_ids || '[]'); } catch { ids = []; }
  for (const id of ids) obsIds.add(id);
}

let obsRows = [];
if (obsIds.size > 0) {
  const placeholders = [...obsIds].map(() => '?').join(',');
  obsRows = sql.prepare(
    `SELECT id, summary, messages, agent, session_id, source_file,
            created_at, metadata, content_hash, quality, digested_at
       FROM observations WHERE id IN (${placeholders})`
  ).all(...obsIds);
}

sql.close();

log(`source rows: ${digestRows.length} digests, ${obsRows.length}/${obsIds.size} referenced observations resolved in SQLite`);

if (DRY_RUN) {
  for (const d of digestRows) log(`  digest ${d.id} | ${d.project} | ${d.theme}`);
  for (const o of obsRows) log(`  obs    ${o.id} | ${o.agent}`);
  log('dry-run complete; no writes');
  process.exit(0);
}

const kmStore = new GraphKMStore({
  dbPath: KG_DB_PATH,
  exportDir: KG_EXPORT_DIR,
  ontologyDir: defaultOntologyDir(),
});
await kmStore.open();
log('km-core GraphKMStore opened');

let obsCreated = 0, obsExisted = 0;
for (const row of obsRows) {
  const existing = await kmStore.findByLegacyId({ system: 'A', id: row.id });
  if (existing) { obsExisted++; continue; }
  const entity = legacyObservationToEntity(row, runId, row.created_at || now);
  await kmStore.putEntity(entity, { skipOntologyCheck: true });
  obsCreated++;
}
log(`observations: +${obsCreated} created, ${obsExisted} already existed`);

let digestCreated = 0, digestExisted = 0;
for (const row of digestRows) {
  const existing = await kmStore.findByLegacyId({ system: 'A', id: row.id });
  if (existing) { digestExisted++; continue; }
  const entity = legacyDigestToEntity(row, runId, row.created_at || now);
  await kmStore.putEntity(entity, { skipOntologyCheck: true });
  digestCreated++;
}
log(`digests: +${digestCreated} created, ${digestExisted} already existed`);

await kmStore.close();
log('done');
