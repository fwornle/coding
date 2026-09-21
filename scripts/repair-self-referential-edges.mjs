#!/usr/bin/env node
/**
 * repair-self-referential-edges.mjs — delete edges whose source is its target.
 *
 * WHAT IT FIXES. No entity contains, or relates to, itself. The live store
 * carried 49 such edges (28 `contains`, 21 `related_to`). They were invisible:
 * every one passed the store's own checks, and no health slice asserted
 * against them. They surfaced only because a stage-5 parent-description
 * readback could not distinguish a self-parent from a synthesis bug.
 *
 * PROVENANCE, established before deleting anything. All 49 carry
 * `metadata.backfilledFrom = 'legacy-pre-phase44'` and were written inside one
 * second on 2026-06-11 by `backfill-edges-from-legacy.mjs`, which faithfully
 * copied 51 name-level self-loops already present in the 2026-05-24 export.
 * So there is NO live producer to fix — the emitter is a retired one-off.
 *
 * LOSSLESS, and checked rather than assumed. That backfill resolves legacy
 * from/to NAMES to UUIDs, so a self-edge could also mean two distinct names
 * collapsing onto one entity — in which case the edge meant something and
 * deleting it loses a real relation. Verified against the legacy export: all
 * 49 correspond to relations that were from==to BY NAME in the source too.
 * Zero collapse cases. Nothing is lost.
 *
 * PREVENTION is separate and already in place: `GraphKMStore.addRelation`
 * refuses `from === to` (km-core), so this is cleanup, not a recurring sweep.
 *
 * DRY RUN BY DEFAULT, like every other repair here.
 *
 * Usage:
 *   node scripts/repair-self-referential-edges.mjs            # report only
 *   node scripts/repair-self-referential-edges.mjs --apply    # delete
 */

const OBS_API = process.env.OBS_API_URL || 'http://127.0.0.1:12436';
const APPLY = process.argv.includes('--apply');

const out = (m = '') => process.stdout.write(`${m}\n`);
const die = (m) => { process.stderr.write(`${m}\n`); process.exit(1); };

out('\n=== self-referential edge repair ===');
out(`obs-api : ${OBS_API}`);
out(`mode    : ${APPLY ? 'APPLY — deletes edges' : 'DRY RUN — deletes nothing'}\n`);

async function getJson(path) {
  const res = await fetch(`${OBS_API}${path}`);
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return res.json();
}

let entities; let relations;
try {
  const e = await getJson('/api/v1/entities?limit=10000');
  entities = e.entities ?? e.data ?? e;
  const r = await getJson('/api/v1/relations?limit=60000');
  relations = r.relations ?? r.data ?? r;
} catch (err) {
  die(`cannot read the graph: ${err.message}\nIs obs-api running? curl ${OBS_API}/health`);
}

const byId = new Map(entities.map((e) => [e.id, e]));
const selfEdges = relations.filter((r) => r.source === r.target);

out(`relations scanned : ${relations.length}`);
out(`self-referential  : ${selfEdges.length}\n`);

if (selfEdges.length === 0) {
  out('Nothing to repair — the graph holds no self-referential edges.\n');
  process.exit(0);
}

const byType = new Map();
for (const r of selfEdges) {
  const t = r.attributes?.type ?? '(untyped)';
  byType.set(t, (byType.get(t) ?? 0) + 1);
}
for (const [t, n] of [...byType].sort((a, b) => b[1] - a[1])) {
  out(`  ${String(n).padStart(3)}  ${t}`);
}

// A self-edge with no `key` cannot be addressed by the delete route; report
// rather than pretend it was handled.
const unaddressable = selfEdges.filter((r) => !r.key);
if (unaddressable.length > 0) {
  out(`\n  ${unaddressable.length} carry no edge key and cannot be deleted by this route.`);
}

out('\nAffected entities:');
for (const r of selfEdges.slice(0, 10)) {
  const e = byId.get(r.source);
  out(`  ${(e?.entityType ?? '?').padEnd(13)} ${e?.name ?? r.source}  —${r.attributes?.type}→ itself`);
}
if (selfEdges.length > 10) out(`  … and ${selfEdges.length - 10} more`);

if (!APPLY) {
  out(`\nDRY RUN — nothing deleted. Re-run with --apply to remove ${selfEdges.length}.\n`);
  process.exit(0);
}

let deleted = 0; let failed = 0;
for (const r of selfEdges) {
  if (!r.key) { failed += 1; continue; }
  try {
    const res = await fetch(`${OBS_API}/api/v1/relations/${encodeURIComponent(r.key)}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    deleted += 1;
  } catch (err) {
    failed += 1;
    process.stderr.write(`[repair] ${r.key}: ${err.message}\n`);
  }
}

out(`\ndeleted : ${deleted}`);
out(`failed  : ${failed}`);

// Read back rather than trusting the loop's own tally.
const after = await getJson('/api/v1/relations?limit=60000');
const remaining = (after.relations ?? after.data ?? after).filter((r) => r.source === r.target);
out(`remaining self-referential (read back): ${remaining.length}`);
out(remaining.length === 0 ? '\nClean.\n' : '\nStill some left — see above.\n');
