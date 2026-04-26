#!/usr/bin/env node
/**
 * Phase A: Attribute digests + insights to projects.
 *
 * Steps (all idempotent, all gated by --execute):
 *   1. ALTER TABLE digests ADD COLUMN project TEXT
 *   2. ALTER TABLE insights ADD COLUMN project TEXT
 *   3. For each observation with null project metadata, run the LSL
 *      ReliableCodingClassifier on its summary and tag as 'coding' or
 *      'unknown'. (Confidently classifiable only — fail open to 'unknown'.)
 *   4. For each digest, set project = majority-vote of underlying
 *      observation_ids' projects. Ties or all-unknown -> 'unknown'.
 *   5. For each insight, set project = majority-vote of underlying
 *      digest_ids' projects.
 *   6. Update Qdrant payloads to include `project` for digests + insights.
 *
 * Usage:
 *   node scripts/migrate-add-project-column.js --dry-run
 *   node scripts/migrate-add-project-column.js --execute
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../src/live-logging/SafeDatabase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.join(REPO_ROOT, '.observations', 'observations.db');
const QDRANT_BASE = process.env.QDRANT_URL || 'http://localhost:6333';

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--execute');

function log(msg) {
  process.stderr.write(`[migrate-project] ${msg}\n`);
}

function parseJson(s, fallback = []) {
  try { return JSON.parse(s || JSON.stringify(fallback)); } catch { return fallback; }
}

function projectFromMetadata(metadataJson) {
  if (!metadataJson) return null;
  try {
    const m = JSON.parse(metadataJson);
    return m.project || null;
  } catch {
    return null;
  }
}

function majority(values) {
  const counts = new Map();
  let best = null, bestN = 0;
  for (const v of values) {
    if (!v || v === 'unknown') continue;
    const n = (counts.get(v) || 0) + 1;
    counts.set(v, n);
    if (n > bestN) { best = v; bestN = n; }
  }
  return best || 'unknown';
}

async function classifyNullProjectObservations(db, classifier) {
  const nulls = db.prepare(`
    SELECT id, summary, agent, metadata FROM observations
    WHERE json_extract(metadata, '$.project') IS NULL
  `).all();

  log(`Found ${nulls.length} observations with null project`);
  if (nulls.length === 0) return { classified: 0, unknown: 0 };

  let classified = 0, unknown = 0;
  const update = db.prepare(`
    UPDATE observations
    SET metadata = json_set(COALESCE(metadata, '{}'), '$.project', ?)
    WHERE id = ?
  `);

  for (const obs of nulls) {
    let project = 'unknown';
    if (classifier) {
      try {
        const result = await classifier.classify({
          userMessage: obs.summary,
          timestamp: new Date().toISOString(),
        });
        // The classifier only returns isCoding / not isCoding — there's no
        // per-other-project signal here. Per design point 2(a): if isCoding,
        // set 'coding'; otherwise mark 'unknown' so we don't bleed into
        // arbitrary buckets.
        if (result?.isCoding) {
          project = 'coding';
          classified++;
        } else {
          unknown++;
        }
      } catch (err) {
        unknown++;
      }
    } else {
      unknown++;
    }
    if (!DRY_RUN) update.run(project, obs.id);
  }

  log(`  classified -> coding: ${classified}, marked unknown: ${unknown}`);
  return { classified, unknown };
}

function backfillDigests(db) {
  // Pull all digests with their constituent observation projects
  const rows = db.prepare(`
    SELECT id, observation_ids, json_extract(metadata, '$.project') AS existing_project
    FROM digests
  `).all();

  const update = db.prepare('UPDATE digests SET project = ? WHERE id = ?');
  const counts = { coding: 0, 'rapid-automations': 0, 'onboarding-repro': 0, unknown: 0, other: 0 };

  for (const d of rows) {
    if (d.existing_project) continue; // skip if already attributed elsewhere
    const obsIds = parseJson(d.observation_ids);
    if (obsIds.length === 0) {
      if (!DRY_RUN) update.run('unknown', d.id);
      counts.unknown++;
      continue;
    }
    const placeholders = obsIds.map(() => '?').join(',');
    const projects = db.prepare(`
      SELECT json_extract(metadata, '$.project') AS project
      FROM observations WHERE id IN (${placeholders})
    `).all(...obsIds).map((r) => r.project);

    const proj = majority(projects);
    if (!DRY_RUN) update.run(proj, d.id);
    counts[proj] = (counts[proj] || 0) + 1;
    if (!['coding', 'rapid-automations', 'onboarding-repro', 'unknown'].includes(proj)) counts.other++;
  }

  log(`Digest backfill: ${JSON.stringify(counts)}`);
  return counts;
}

function backfillInsights(db) {
  const rows = db.prepare('SELECT id, digest_ids FROM insights').all();
  const update = db.prepare('UPDATE insights SET project = ? WHERE id = ?');
  const counts = { coding: 0, 'rapid-automations': 0, 'onboarding-repro': 0, unknown: 0, other: 0 };

  for (const ins of rows) {
    const digestIds = parseJson(ins.digest_ids);
    if (digestIds.length === 0) {
      if (!DRY_RUN) update.run('unknown', ins.id);
      counts.unknown++;
      continue;
    }
    const placeholders = digestIds.map(() => '?').join(',');
    const projects = db.prepare(
      `SELECT project FROM digests WHERE id IN (${placeholders})`
    ).all(...digestIds).map((r) => r.project);

    const proj = majority(projects);
    if (!DRY_RUN) update.run(proj, ins.id);
    counts[proj] = (counts[proj] || 0) + 1;
    if (!['coding', 'rapid-automations', 'onboarding-repro', 'unknown'].includes(proj)) counts.other++;
  }

  log(`Insight backfill: ${JSON.stringify(counts)}`);
  return counts;
}

async function updateQdrantPayloads(db, collection, idColumn = 'id') {
  const table = collection === 'digests' ? 'digests' : 'insights';
  const rows = db.prepare(`SELECT ${idColumn}, project FROM ${table} WHERE project IS NOT NULL`).all();
  log(`Updating ${rows.length} Qdrant payloads for ${collection}`);
  if (rows.length === 0) return;

  // Batch in groups of 100 for Qdrant payload set
  const batches = [];
  for (let i = 0; i < rows.length; i += 100) batches.push(rows.slice(i, i + 100));

  for (const batch of batches) {
    // Group by project value to minimize requests
    const byProject = new Map();
    for (const r of batch) {
      if (!byProject.has(r.project)) byProject.set(r.project, []);
      byProject.get(r.project).push(r[idColumn]);
    }
    for (const [project, ids] of byProject) {
      try {
        const res = await fetch(`${QDRANT_BASE}/collections/${collection}/points/payload?wait=true`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payload: { project }, points: ids }),
        });
        if (!res.ok) {
          log(`  WARN: payload set failed for ${collection}/${project}: ${res.status}`);
        }
      } catch (err) {
        log(`  WARN: payload set error for ${collection}: ${err.message}`);
      }
    }
  }
  log(`  Qdrant ${collection} payloads updated.`);
}

async function main() {
  log(`mode: ${DRY_RUN ? 'DRY RUN' : 'EXECUTE'}`);

  if (!fs.existsSync(DB_PATH)) {
    log(`DB not found at ${DB_PATH}`);
    process.exit(1);
  }

  const db = openDatabase(DB_PATH);

  // Step 1+2: Schema migration (idempotent — try add, swallow "duplicate column" error)
  for (const table of ['digests', 'insights']) {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN project TEXT`);
      log(`Added project column to ${table}`);
    } catch (err) {
      if (!/duplicate column/i.test(err.message)) throw err;
      log(`${table}.project already exists`);
    }
  }
  if (!DRY_RUN) {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_digests_project ON digests(project)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_insights_project ON insights(project)`);
  }

  // Step 3: Classify null-project observations
  let classifier = null;
  try {
    const Mod = await import('../src/live-logging/ReliableCodingClassifier.js');
    const Cls = Mod.default || Mod.ReliableCodingClassifier;
    if (Cls) {
      classifier = new Cls({ projectPath: REPO_ROOT });
      // The classifier has lazy init; call its classify which awaits internally.
      // No explicit init() needed — see ReliableCodingClassifier.classify().
    }
  } catch (err) {
    log(`Classifier unavailable, all null-project observations will be 'unknown': ${err.message}`);
  }
  await classifyNullProjectObservations(db, classifier);

  // Step 4: digest backfill
  backfillDigests(db);

  // Step 5: insight backfill
  backfillInsights(db);

  if (!DRY_RUN) {
    db.pragma('wal_checkpoint(TRUNCATE)');
  }

  // Step 6: Qdrant payload sync
  if (!DRY_RUN) {
    await updateQdrantPayloads(db, 'digests');
    await updateQdrantPayloads(db, 'insights');
  } else {
    log('(dry-run) Skipping Qdrant payload updates');
  }

  db.close();
  log('Done.');
}

main().catch((err) => {
  process.stderr.write(`[migrate-project] FATAL: ${err.stack || err.message}\n`);
  process.exit(1);
});
