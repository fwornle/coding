#!/usr/bin/env node

/**
 * Phase 60 follow-up — Island repair: materialize the missing `Trajectory`
 * L2 subsystem node and attach the islands that declare it as parent.
 *
 * Root cause (diagnosed 2026-06-19): three 2-node islands
 *   - DynamicImporter  → contains → ModuleLoader
 *   - SpecstoryLogger  → contains → SpecstoryLoggerAdapter
 *   - DataAdapter      → contains → DataMapper
 * float disconnected from the main tree. Each island ROOT is a SubComponent
 * whose `metadata.parentEntityName === 'Trajectory'`, but the `Trajectory`
 * node — a legitimate L2 subsystem defined in `.data/ontologies/coding-ontology.json`
 * and named as parent by 19 nodes — was never instantiated in the graph.
 * With no parent node to hang off, the contains-chain has no route up to
 * Project `Coding` → System `CollectiveKnowledge`.
 *
 * Fix (mirrors the canonical L2 wiring of KnowledgeManagement / LiveLoggingSystem):
 *   1. Create `Trajectory` (entityType=Component, layer=evidence) if absent.
 *   2. Coding  --parent-child--> Trajectory   (attach L2 to the Project anchor)
 *   3. Trajectory --contains--> {island roots} (attach the islands to L2)
 *
 * Idempotent: existing Trajectory is reused; every edge is dedup-probed before
 * write. Targets BOTH graphs (obs-api :12436 = viewer source, sse-server :3848)
 * so the two stores stay consistent.
 *
 * Usage:  node scripts/repair-island-trajectory-parent.mjs [--dry-run]
 *         REST_BASES="http://localhost:12436,http://localhost:3848" (override)
 */

import process from 'node:process';

const REST_BASES = (process.env.REST_BASES ||
  'http://localhost:12436,http://localhost:3848')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const DRY_RUN = process.argv.includes('--dry-run');
const EDGE_SOURCE = 'repair-island-trajectory-parent';

// Fixed id so both graphs mint the SAME Trajectory node id (cross-store parity).
const TRAJECTORY_ID = '019e5559-0000-7c00-b000-c0d1ec700001';

const PROJECT_NAME = 'Coding';
// Island roots (SubComponents, hierarchyLevel 2) — ids are stable across stores.
const ISLAND_ROOTS = [
  { name: 'DynamicImporter', id: '019e5559-69d8-7dfb-b906-f5ec2afb5033' },
  { name: 'SpecstoryLogger', id: '019e5559-69e5-7b55-bc13-a9f3cd23b2f2' },
  { name: 'DataAdapter', id: '019e5559-69e5-7b55-bc13-aa0a7a0e1c01' },
];

function log(msg) {
  process.stderr.write('[island-repair] ' + msg + '\n');
}

async function findProjectAnchor(base, name) {
  const res = await fetch(`${base}/api/v1/entities?ontologyClass=Project&limit=100`);
  if (!res.ok) return null;
  const body = await res.json();
  const items = Array.isArray(body.data) ? body.data : [];
  const lowered = name.toLowerCase();
  return (
    items.find((p) => p.name === name) ||
    items.find((p) => (p.name || '').toLowerCase() === lowered) ||
    null
  );
}

async function findByName(base, ontologyClass, name) {
  const res = await fetch(
    `${base}/api/v1/entities?ontologyClass=${encodeURIComponent(ontologyClass)}&limit=500`,
  );
  if (!res.ok) return null;
  const body = await res.json();
  const items = Array.isArray(body.data) ? body.data : [];
  return items.find((e) => e.name === name) || null;
}

async function ensureTrajectory(base) {
  // Already present (by fixed id or by name)?
  const byId = await fetch(`${base}/api/v1/entities/${TRAJECTORY_ID}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((b) => b?.data)
    .catch(() => null);
  if (byId) {
    log(`Trajectory already present by id ${TRAJECTORY_ID.slice(0, 12)}`);
    return byId.id;
  }
  const byName = await findByName(base, 'Component', 'Trajectory');
  if (byName) {
    log(`Trajectory already present by name (id ${byName.id.slice(0, 12)})`);
    return byName.id;
  }
  if (DRY_RUN) {
    log(`DRY-RUN would create Trajectory Component (id ${TRAJECTORY_ID.slice(0, 12)})`);
    return TRAJECTORY_ID;
  }
  const res = await fetch(`${base}/api/v1/entities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: TRAJECTORY_ID,
      name: 'Trajectory',
      entityType: 'Component',
      ontologyClass: 'Component',
      layer: 'evidence',
      description:
        'Trajectory subsystem — agent run/trajectory capture and session integration ' +
        '(Specstory logging, dynamic import, data adaptation). Materialized 2026-06-19 ' +
        'to anchor islands whose parentEntityName referenced this L2 subsystem.',
      metadata: {
        team: 'coding',
        subsystem: 'trajectory',
        hierarchyLevel: 1,
        parentEntityName: PROJECT_NAME,
        source: EDGE_SOURCE,
        createdAt: '2026-06-19',
      },
    }),
  });
  if (!res.ok) {
    log(`Trajectory create FAILED HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
    return null;
  }
  const body = await res.json();
  log(`Trajectory created (id ${body.data?.id?.slice(0, 12)})`);
  return body.data?.id ?? TRAJECTORY_ID;
}

async function relationExists(base, { from, to, type }) {
  try {
    const url = `${base}/api/v1/relations?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&type=${encodeURIComponent(type)}`;
    const res = await fetch(url);
    if (!res.ok) return false;
    const body = await res.json();
    return Array.isArray(body.data) && body.data.length > 0;
  } catch {
    return false;
  }
}

async function addRelation(base, { from, to, type, metadata }) {
  if (await relationExists(base, { from, to, type })) {
    log(`edge exists ${from.slice(0, 8)} -[${type}]-> ${to.slice(0, 8)} (skip)`);
    return 'exists';
  }
  if (DRY_RUN) {
    log(`DRY-RUN would addRelation ${from.slice(0, 8)} -[${type}]-> ${to.slice(0, 8)}`);
    return 'dry';
  }
  const res = await fetch(`${base}/api/v1/relations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, relationType: type, metadata }),
  });
  if (!res.ok) {
    log(`addRelation ${from.slice(0, 8)} -[${type}]-> ${to.slice(0, 8)} FAILED HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
    return 'fail';
  }
  log(`added ${from.slice(0, 8)} -[${type}]-> ${to.slice(0, 8)}`);
  return 'added';
}

async function repairBase(base) {
  log(`=== ${base} (${DRY_RUN ? 'DRY-RUN' : 'LIVE'}) ===`);

  // pre-flight
  const ok = await fetch(`${base}/api/v1/stats`).then((r) => r.ok).catch(() => false);
  if (!ok) {
    log(`pre-flight FAILED — ${base}/api/v1/stats unreachable; skipping`);
    return;
  }

  const project = await findProjectAnchor(base, PROJECT_NAME);
  if (!project) {
    log(`Project anchor "${PROJECT_NAME}" not found; skipping ${base}`);
    return;
  }

  const trajId = await ensureTrajectory(base);
  if (!trajId) {
    log(`could not ensure Trajectory; skipping edge wiring for ${base}`);
    return;
  }

  const meta = { source: EDGE_SOURCE, addedAt: '2026-06-19' };
  // L2 ← Project
  await addRelation(base, { from: project.id, to: trajId, type: 'parent-child', metadata: meta });
  // islands ← L2
  for (const root of ISLAND_ROOTS) {
    const exists = await fetch(`${base}/api/v1/entities/${root.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => b?.data)
      .catch(() => null);
    if (!exists) {
      log(`island root ${root.name} (${root.id.slice(0, 8)}) absent in ${base}; skipping`);
      continue;
    }
    await addRelation(base, { from: trajId, to: root.id, type: 'contains', metadata: meta });
  }

  const stats = await fetch(`${base}/api/v1/stats`)
    .then((r) => r.json())
    .then((b) => b.data)
    .catch(() => null);
  if (stats) {
    log(`post stats: nodes=${stats.nodeCount ?? stats.nodes} edges=${stats.edgeCount ?? stats.edges} orphans=${stats.orphanCount} islands=${stats.islandCount ?? '?'} connectivity=${stats.connectivity}`);
  }
}

async function main() {
  for (const base of REST_BASES) {
    await repairBase(base);
  }
}

main().catch((e) => {
  log(`FATAL: ${e.stack || e.message}`);
  process.exit(1);
});
