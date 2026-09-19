#!/usr/bin/env node

/**
 * Backfill — anchor roll-up parents that were written before the roll-up
 * learned to mirror its children's structural edges.
 *
 * WHY: `rollUpInsights` created the parent entity and archived its children,
 * but wrote no relations. The children keep their `contains` / `parent-child`
 * / `has_insight` anchors; the parent had none. With the condensed view ON
 * (children hidden) each such parent renders as an orphan — a summary node
 * attached to nothing, and the subsystem it summarises no longer links to it.
 *
 * Parents written earlier had edges only because the background
 * MentionsClassifier and the consolidator's has_insight pass had since run
 * over them. That is why the orphan count drifted (14 -> 59 -> 42) rather than
 * staying put: it was a race with unrelated background work.
 *
 * The roll-up now does this at write time. This script repairs the ones
 * already on disk, using the same rule: for each parent, take the union of
 * (source, type) over every structural edge pointing INTO one of its children
 * from a non-sibling, and create that edge to the parent. Idempotent — probes
 * before every write.
 *
 * Usage:
 *   node scripts/anchor-rollup-parents.mjs            # dry run
 *   node scripts/anchor-rollup-parents.mjs --apply
 */

const OBS_API = process.env.OBS_API_URL || 'http://localhost:12436';
const APPLY = process.argv.includes('--apply');
const STRUCTURAL = new Set(['contains', 'parent-child', 'has_insight']);
const out = (m = '') => process.stdout.write(`${m}\n`);

const get = async (path) => {
  const r = await fetch(`${OBS_API}${path}`, { signal: AbortSignal.timeout(300_000) });
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status}`);
  return (await r.json()).data;
};

const entities = await get('/api/v1/entities?limit=10000');
const relations = await get('/api/v1/relations?limit=100000');

// The read API spells edges source/target; the write API spells them from/to.
const edgeFrom = (r) => r.from ?? r.source;
const edgeTo = (r) => r.to ?? r.target;
const edgeType = (r) => r.type ?? r.attributes?.type;

const byId = new Map(entities.map((e) => [e.id, e]));
const inboundByTo = new Map();
const degree = new Map();
for (const r of relations) {
  const to = edgeTo(r); const from = edgeFrom(r);
  degree.set(to, (degree.get(to) ?? 0) + 1);
  degree.set(from, (degree.get(from) ?? 0) + 1);
  if (!STRUCTURAL.has(edgeType(r))) continue;
  if (!inboundByTo.has(to)) inboundByTo.set(to, []);
  inboundByTo.get(to).push(r);
}

const parents = entities.filter((e) => (e.metadata ?? {}).rollUpOf);
const edgeless = parents.filter((e) => (degree.get(e.id) ?? 0) === 0);
out(`roll-up parents: ${parents.length} — edgeless (orphans): ${edgeless.length}`);

// Children are recorded as legacyId-or-id; index both so either resolves.
const childIndex = new Map();
for (const e of entities) {
  childIndex.set(e.id, e);
  const legacy = (e.metadata ?? {}).legacyId;
  if (legacy) childIndex.set(legacy, e);
}

let planned = 0; let written = 0; let stillOrphan = 0;
for (const p of parents) {
  if ((degree.get(p.id) ?? 0) > 0) continue;
  const kids = ((p.metadata ?? {}).rollUpOf ?? [])
    .map((k) => childIndex.get(k)).filter(Boolean);
  const kidIds = new Set(kids.map((k) => k.id));
  const anchors = new Map();
  for (const k of kids) {
    for (const r of inboundByTo.get(k.id) ?? []) {
      const from = edgeFrom(r);
      if (kidIds.has(from)) continue;
      anchors.set(`${from}|${edgeType(r)}`, { from, type: edgeType(r) });
    }
  }
  if (anchors.size === 0) {
    // Fallback: anchor to the project. Digest-sourced parents land here —
    // digests were never linked into the hierarchy, so their children have
    // nothing to inherit. `has_insight` from the Project is the same anchor
    // the consolidator gives every insight it writes, so the parent at least
    // hangs off something rather than floating as a permanent orphan.
    const projectName = (p.metadata ?? {}).project ?? p.project;
    const project = entities.find(
      (e) => (e.ontologyClass ?? e.entityType) === 'Project'
        && (e.name ?? '').toLowerCase() === String(projectName ?? '').toLowerCase(),
    );
    if (!project) {
      stillOrphan++;
      out(`  NO ANCHOR  ${(p.name ?? '').slice(0, 58)} (project "${projectName}" not found)`);
      continue;
    }
    anchors.set(`${project.id}|has_insight`, { from: project.id, type: 'has_insight' });
  }
  planned += anchors.size;
  const src = [...anchors.values()]
    .map((a) => `${a.type}<-${(byId.get(a.from)?.name ?? a.from).slice(0, 22)}`).join(', ');
  out(`  ${APPLY ? 'anchor' : 'would'} ${String(anchors.size).padStart(2)}  ${(p.name ?? '').slice(0, 44)}  [${src.slice(0, 80)}]`);

  if (!APPLY) continue;
  for (const a of anchors.values()) {
    const r = await fetch(`${OBS_API}/api/v1/relations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: a.from, to: p.id, type: a.type,
        metadata: { source: 'anchor-rollup-parents-backfill', mirroredFromChildren: true },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (r.ok) written++;
    else out(`     FAILED ${a.type} ${r.status} ${(await r.text()).slice(0, 120)}`);
  }
}

out('');
out(`${APPLY ? 'edges written' : 'edges that WOULD be written'}: ${APPLY ? written : planned}`);
if (stillOrphan) out(`parents with no resolvable anchor: ${stillOrphan} (children carry no structural edge either)`);
if (!APPLY) out('\nDry run. Re-run with --apply.');
