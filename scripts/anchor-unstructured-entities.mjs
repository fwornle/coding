#!/usr/bin/env node

/**
 * Enforce the structural-anchor invariant: every knowledge row carries at
 * least one STRUCTURAL edge (`contains` / `parent-child` / `has_insight` /
 * `includes`).
 *
 * WHY THIS IS THE RULE THAT MATTERS
 *
 * "Orphan" (degree 0) is the wrong metric for what an operator actually sees.
 * Provenance edges — `capturedBy` (13038) and `mentions` (11410) — are 89% of
 * this graph and are hidden by default in the viewer, because drawing them
 * makes the canvas unreadable. A row whose ONLY edges are provenance is
 * therefore connected in the data and a floating dot on screen. That gap is
 * why the header can honestly say "orphans 14" over a picture showing ~81
 * stranded nodes.
 *
 * Measured before this script first ran:
 *   Detail 314, Digest 140, Insight 65, SubComponent 8  = 527 unanchored
 *   of which 13 were true orphans and 514 were provenance-only.
 *
 * THE ANCHOR
 *
 * Every row knows its project (`metadata.project`), and every project is an
 * entity. Insights get `has_insight` — the same edge the consolidator already
 * writes for insights it mints — everything else gets `contains`. Both are
 * structural and drawn by default, so an anchored row can never strand under
 * default filters.
 *
 * Rows whose project does not resolve to a Project entity are REPORTED, not
 * invented: a wrong parent is worse than a visible gap.
 *
 * Usage:
 *   node scripts/anchor-unstructured-entities.mjs             # dry run
 *   node scripts/anchor-unstructured-entities.mjs --apply
 *   node scripts/anchor-unstructured-entities.mjs --check     # exit 1 if any
 *
 * `--check` is the guard: wire it into a health check and the invariant stops
 * silently rotting between releases.
 */

const OBS_API = process.env.OBS_API_URL || 'http://localhost:12436';
const APPLY = process.argv.includes('--apply');
const CHECK = process.argv.includes('--check');
const STRUCTURAL = new Set(['contains', 'parent-child', 'has_insight', 'includes']);
/** Classes that must be anchored. Observations are deliberately excluded —
 *  they are raw stream, shielded from the canvas, and `capturedBy` is their
 *  real relationship. */
const ANCHORED_CLASSES = new Set([
  'Insight', 'OnlineInsight', 'Digest', 'OnlineDigest', 'Detail', 'SubComponent', 'Component',
]);
const out = (m = '') => process.stdout.write(`${m}\n`);

const get = async (path) => {
  const r = await fetch(`${OBS_API}${path}`, { signal: AbortSignal.timeout(300_000) });
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status}`);
  return (await r.json()).data;
};

const entities = await get('/api/v1/entities?limit=10000');
const relations = await get('/api/v1/relations?limit=100000');

// Read API spells edges source/target; write API spells them from/to.
const eFrom = (r) => r.from ?? r.source;
const eTo = (r) => r.to ?? r.target;
const eType = (r) => r.type ?? r.attributes?.type;
const clsOf = (e) => e.ontologyClass ?? e.entityType;

const structDeg = new Map();
const anyDeg = new Map();
for (const r of relations) {
  const structural = STRUCTURAL.has(eType(r));
  for (const v of [eFrom(r), eTo(r)]) {
    anyDeg.set(v, (anyDeg.get(v) ?? 0) + 1);
    if (structural) structDeg.set(v, (structDeg.get(v) ?? 0) + 1);
  }
}

/**
 * Project entities are CamelCase (`A2aXpr`, `SecondBrainPrivate`) while
 * `metadata.project` is the slug (`a2a-xpr`, `second-brain-private`). A plain
 * lowercase compare misses every multi-word project — 136 rows on the first
 * run, reported as "project does not resolve" when the project was right
 * there. Fold both to alphanumerics before comparing.
 */
const slug = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const projectsByName = new Map();
for (const e of entities) {
  if (clsOf(e) === 'Project') projectsByName.set(slug(e.name), e);
}

const unanchored = entities.filter(
  (e) => ANCHORED_CLASSES.has(clsOf(e)) && (structDeg.get(e.id) ?? 0) === 0,
);
const strandedNow = unanchored.filter((e) => (anyDeg.get(e.id) ?? 0) > 0).length;

out(`unanchored (no structural edge): ${unanchored.length}`);
out(`  true orphans (degree 0)      : ${unanchored.length - strandedNow}`);
out(`  stranded (provenance only)   : ${strandedNow}`);
const byClass = {};
for (const e of unanchored) byClass[clsOf(e)] = (byClass[clsOf(e)] ?? 0) + 1;
out(`  by class: ${JSON.stringify(byClass)}`);

if (CHECK) {
  out('');
  if (unanchored.length === 0) { out('OK — structural-anchor invariant holds.'); process.exit(0); }
  out(`FAIL — ${unanchored.length} row(s) carry no structural edge.`);
  process.exit(1);
}

let written = 0; const unresolved = {};
for (const e of unanchored) {
  const projectName = (e.metadata ?? {}).project ?? e.project;
  const project = projectsByName.get(slug(projectName));
  if (!project) {
    unresolved[String(projectName)] = (unresolved[String(projectName)] ?? 0) + 1;
    continue;
  }
  const type = clsOf(e).endsWith('Insight') ? 'has_insight' : 'contains';
  if (!APPLY) { written++; continue; }
  const r = await fetch(`${OBS_API}/api/v1/relations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: project.id, to: e.id, type,
      metadata: { source: 'anchor-unstructured-entities', confidence: 1.0 },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (r.ok) written++;
  else out(`  FAILED ${type} -> ${(e.name ?? '').slice(0, 40)}: ${r.status}`);
}

out('');
out(`${APPLY ? 'edges written' : 'edges that WOULD be written'}: ${written}`);
if (Object.keys(unresolved).length > 0) {
  out(`left alone — project does not resolve to an entity: ${JSON.stringify(unresolved)}`);
  out('  (a wrong parent is worse than a visible gap — fix the project entity, then re-run)');
}
if (!APPLY) out('\nDry run. Re-run with --apply.');
