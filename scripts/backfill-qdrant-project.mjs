#!/usr/bin/env node
/**
 * Make every Qdrant point filterable by project (T6 — injection's team filter).
 *
 *   1. A `project` keyword payload index on all four retrieval collections.
 *      ensureCollections() adds it to existing collections from now on; this
 *      does it without waiting for the next backfill.
 *   2. kg_entities points: `project` from the entity's own metadata
 *      (project, else team). The backfill used to stamp a literal "coding" on
 *      every one, so a team filter could only ever return all of them or none.
 *      Point ids are backfill's keyToUuid(node key); nodes come from every
 *      project's knowledge export, merged the way obs-api hydrates.
 *
 * The other tiers already carry their row's project. Idempotent.
 *
 *   node scripts/backfill-qdrant-project.mjs [--dry-run]
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

import { mergeGraphs } from '@fwornle/km-core';
import { kbLayout } from '../lib/kb/layout.mjs';
import { keyToUuid } from '../dist/embedding/point-id.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QDRANT = process.env.QDRANT_URL || 'http://localhost:6333';
const COLLECTIONS = ['observations', 'digests', 'insights', 'kg_entities'];
const dryRun = process.argv.includes('--dry-run');

async function q(method, url, body) {
  const r = await fetch(`${QDRANT}${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${url} → ${r.status} ${JSON.stringify(json.status ?? json)}`);
  return json.result;
}

async function main() {
  for (const c of COLLECTIONS) {
    const info = await q('GET', `/collections/${c}`);
    if (info.payload_schema?.project) { process.stdout.write(`index ${c}.project: present\n`); continue; }
    process.stdout.write(`index ${c}.project: ${dryRun ? 'would create' : 'creating'}\n`);
    if (!dryRun) await q('PUT', `/collections/${c}/index?wait=true`, { field_name: 'project', field_schema: 'keyword' });
  }

  const graphs = [];
  for (const f of kbLayout({ mode: 'local', codingRoot: ROOT }).sources()) {
    try { graphs.push(JSON.parse(fs.readFileSync(f, 'utf8'))); } catch { /* absent */ }
  }
  const { graph } = mergeGraphs(graphs);
  const byProject = new Map();
  for (const n of graph.nodes) {
    const m = n.attributes?.metadata || {};
    const project = m.project || m.team || null;
    const key = project ?? '\u0000none';
    if (!byProject.has(key)) byProject.set(key, []);
    byProject.get(key).push(keyToUuid(n.key));
  }

  // Only ids that exist as points: set_payload on a missing id fails the batch.
  const existing = new Set();
  let offset = null;
  do {
    const page = await q('POST', '/collections/kg_entities/points/scroll', { limit: 1000, offset, with_payload: false, with_vector: false });
    for (const p of page.points) existing.add(String(p.id));
    offset = page.next_page_offset ?? null;
  } while (offset !== null);

  let updated = 0;
  for (const [key, ids] of byProject) {
    const points = ids.filter((id) => existing.has(id));
    if (!points.length) continue;
    const project = key === '\u0000none' ? null : key;
    process.stdout.write(`kg_entities project=${project ?? '(none)'}: ${points.length} point(s)\n`);
    updated += points.length;
    if (dryRun) continue;
    for (let i = 0; i < points.length; i += 500) {
      await q('POST', '/collections/kg_entities/points/payload?wait=true', { payload: { project }, points: points.slice(i, i + 500) });
    }
  }
  process.stdout.write(`${dryRun ? 'would update' : 'updated'} ${updated} of ${existing.size} kg_entities point(s)\n`);
}

main().catch((err) => {
  process.stderr.write(`backfill-qdrant-project: ${err.message}\n`);
  process.exit(1);
});
