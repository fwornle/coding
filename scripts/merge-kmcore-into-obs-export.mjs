#!/usr/bin/env node
/**
 * Merge km-core Observation/Digest/Insight entities into the JSON cold-store
 * (.data/observation-export/*.json).
 *
 * Why: Plan 44-18 archived `.observations/observations.db` on 2026-06-05 and
 * switched ObservationWriter to km-core, but the dashboard's
 * `/api/coding/observations` still reads from ColdStoreReader, which is
 * populated by ObservationExporter — which still queries the now-archived
 * SQLite. So new observations (Jun 11+) live in km-core but never reach the
 * dashboard.
 *
 * This script bridges the gap: pull recent typed entities from km-core, map
 * them to the export schema, and merge into the JSON files. Idempotent —
 * existing IDs are preserved, new ones appended.
 *
 * Usage:
 *   node scripts/merge-kmcore-into-obs-export.mjs                    # default: last 30 days
 *   node scripts/merge-kmcore-into-obs-export.mjs --since 2026-06-05 # explicit cutoff
 *   node scripts/merge-kmcore-into-obs-export.mjs --dry-run          # show counts only
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SINCE = (() => {
  const i = args.indexOf('--since');
  if (i >= 0) return args[i + 1];
  return new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
})();

const OBS_API = process.env.OBS_API_URL || 'http://localhost:12436';
const EXPORT_DIR = path.resolve('.data/observation-export');

async function fetchAll(limit = 2000) {
  // The /api/v1/entities endpoint doesn't honor entityType filters, so we
  // pull a wide slice and bucket client-side.
  const r = await fetch(`${OBS_API}/api/v1/entities?limit=${limit}`);
  if (!r.ok) throw new Error(`${OBS_API}/api/v1/entities → HTTP ${r.status}`);
  const body = await r.json();
  return body.data || [];
}

function mapObservation(e) {
  const m = e.metadata || {};
  return {
    id: e.id,
    summary: e.description || e.name || '',
    agent: m.agent || 'unknown',
    project: m.project || 'coding',
    source: m.source || null,
    quality: m.quality || 'normal',
    createdAt: e.createdAt,
    digestedAt: m.digestedAt || null,
    llm: m.llmModel ? { model: m.llmModel, provider: m.llmProvider || null } : null,
    modifiedFiles: Array.isArray(m.modifiedFiles) ? m.modifiedFiles : null,
  };
}

function mapDigest(e) {
  const m = e.metadata || {};
  return {
    id: e.id,
    date: (e.createdAt || '').slice(0, 10),
    theme: m.theme || e.name || '',
    summary: e.description || '',
    observationIds: Array.isArray(m.observationIds) ? m.observationIds : [],
    agents: Array.isArray(m.agents) ? m.agents : [],
    filesTouched: Array.isArray(m.filesTouched) ? m.filesTouched : [],
    quality: m.quality || 'normal',
    createdAt: e.createdAt,
    metadata: m,
    project: m.project || 'coding',
  };
}

function mapInsight(e) {
  const m = e.metadata || {};
  return {
    id: e.id,
    topic: e.name || m.topic || '',
    summary: e.description || '',
    confidence: typeof m.confidence === 'number' ? m.confidence : 0.5,
    digestIds: Array.isArray(m.digestIds) ? m.digestIds : [],
    lastUpdated: e.updatedAt || e.createdAt,
    createdAt: e.createdAt,
    metadata: m,
    project: m.project || 'coding',
  };
}

function mergeById(existing, incoming) {
  const byId = new Map();
  for (const r of existing) if (r && r.id) byId.set(r.id, r);
  let added = 0;
  for (const r of incoming) {
    if (!r || !r.id) continue;
    if (!byId.has(r.id)) {
      byId.set(r.id, r);
      added++;
    }
  }
  return { merged: Array.from(byId.values()), added };
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(path.join(EXPORT_DIR, file), 'utf-8')); }
  catch { return []; }
}

function writeJson(file, data) {
  const p = path.join(EXPORT_DIR, file);
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

async function main() {
  process.stderr.write(`[merge] cutoff: ${SINCE}\n`);
  const all = await fetchAll();
  const recent = all.filter((e) => (e.createdAt || '') >= SINCE);
  const buckets = { Observation: [], Digest: [], Insight: [] };
  for (const e of recent) {
    if (buckets[e.entityType]) buckets[e.entityType].push(e);
  }
  process.stderr.write(
    `[merge] km-core recent (>=${SINCE}): obs=${buckets.Observation.length} dig=${buckets.Digest.length} ins=${buckets.Insight.length}\n`,
  );

  const obsExisting = readJson('observations.json');
  const digExisting = readJson('digests.json');
  const insExisting = readJson('insights.json');

  const obsMapped = buckets.Observation.map(mapObservation);
  const digMapped = buckets.Digest.map(mapDigest);
  const insMapped = buckets.Insight.map(mapInsight);

  const obsResult = mergeById(obsExisting, obsMapped);
  const digResult = mergeById(digExisting, digMapped);
  const insResult = mergeById(insExisting, insMapped);

  process.stderr.write(
    `[merge] new vs export: obs +${obsResult.added} (total ${obsResult.merged.length}), dig +${digResult.added} (total ${digResult.merged.length}), ins +${insResult.added} (total ${insResult.merged.length})\n`,
  );

  if (DRY_RUN) {
    process.stderr.write('[merge] dry-run, no files written\n');
    return;
  }

  obsResult.merged.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  digResult.merged.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  insResult.merged.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

  writeJson('observations.json', obsResult.merged);
  writeJson('digests.json', digResult.merged);
  writeJson('insights.json', insResult.merged);
  writeJson('metadata.json', {
    exportedAt: new Date().toISOString(),
    counts: {
      observations: obsResult.merged.length,
      digests: digResult.merged.length,
      insights: insResult.merged.length,
    },
    source: 'km-core (via merge-kmcore-into-obs-export.mjs)',
  });
  process.stderr.write('[merge] wrote 4 files\n');
}

main().catch((err) => {
  process.stderr.write(`[merge] failed: ${err.message}\n`);
  process.exit(1);
});
