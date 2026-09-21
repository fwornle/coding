#!/usr/bin/env node
/**
 * repair-duplicate-provenance-edges.mjs — collapse duplicate edges to one.
 *
 * WHAT IT FIXES. km-core's `addRelation` is not idempotent on the
 * (from, to, type) triple. `ObservationWriter._emitMentionsEdges` has always
 * probed with `findRelations` before writing; its sibling `_anchorEntity` did
 * not, so EVERY re-write of an entity added another identical `capturedBy`
 * edge to the same anchor. Measured 2026-09-21:
 *
 *     capturedBy   13,675 edges   1,219 distinct (src,tgt)   91% duplicates
 *     contains      2,324 edges   1,747 distinct              25%
 *     mentions     12,615 edges  12,176 distinct               3%   <- probes
 *     has_insight   1,086 edges   1,086 distinct               0%
 *
 * The worst single Insight carried 194 identical anchors — one per
 * consolidation that re-wrote it.
 *
 * WHAT IT KEEPS. One edge per (source, target, type): the OLDEST by
 * `createdAt`, so the original provenance timestamp survives and only the
 * re-write noise is removed. Edges with no `createdAt` sort last and are kept
 * only when nothing else exists for that triple.
 *
 * NOT A SUBSTITUTE FOR THE WRITER FIX. The anchor path now probes before
 * writing (the same guard `_emitMentionsEdges` uses), so this is a one-off
 * collapse rather than a sweep. Run it AFTER the writer is deployed, or it
 * refills behind you.
 *
 * DRY RUN BY DEFAULT.
 *
 * Usage:
 *   node scripts/repair-duplicate-provenance-edges.mjs                   # report
 *   node scripts/repair-duplicate-provenance-edges.mjs --type=capturedBy # scope
 *   node scripts/repair-duplicate-provenance-edges.mjs --apply
 */

const OBS_API = process.env.OBS_API_URL || 'http://127.0.0.1:12436';
const APPLY = process.argv.includes('--apply');
const TYPE_ARG = process.argv.find((a) => a.startsWith('--type='));
const ONLY_TYPE = TYPE_ARG ? TYPE_ARG.split('=')[1] : null;

const out = (m = '') => process.stdout.write(`${m}\n`);
const die = (m) => { process.stderr.write(`${m}\n`); process.exit(1); };

const keyOf = (source, target, type) => JSON.stringify([source, target, type]);

out('\n=== duplicate provenance edge repair ===');
out(`obs-api : ${OBS_API}`);
out(`scope   : ${ONLY_TYPE ?? 'every relation type'}`);
out(`mode    : ${APPLY ? 'APPLY — deletes duplicates' : 'DRY RUN — deletes nothing'}\n`);

async function getJson(path) {
  const res = await fetch(`${OBS_API}${path}`);
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return res.json();
}

let relations;
try {
  const r = await getJson('/api/v1/relations?limit=60000');
  relations = r.relations ?? r.data ?? r;
} catch (err) {
  die(`cannot read relations: ${err.message}\nIs obs-api running? curl ${OBS_API}/health`);
}

// Group by (source, target, type). Within a group, keep the oldest.
const groups = new Map();
for (const r of relations) {
  const type = r.attributes?.type ?? '(untyped)';
  if (ONLY_TYPE && type !== ONLY_TYPE) continue;
  const k = keyOf(r.source, r.target, type);
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(r);
}

const doomed = [];
const perType = new Map();
for (const [, edges] of groups) {
  if (edges.length < 2) continue;
  edges.sort((a, b) => {
    const ta = a.attributes?.createdAt ?? '￿';
    const tb = b.attributes?.createdAt ?? '￿';
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });
  for (const e of edges.slice(1)) {
    doomed.push(e);
    const t = e.attributes?.type ?? '(untyped)';
    perType.set(t, (perType.get(t) ?? 0) + 1);
  }
}

out(`relations scanned : ${relations.length}`);
out(`distinct triples  : ${groups.size}`);
out(`duplicates        : ${doomed.length}\n`);

if (doomed.length === 0) {
  out('Nothing to repair — no duplicate edges.\n');
  process.exit(0);
}

for (const [t, n] of [...perType].sort((a, b) => b[1] - a[1])) {
  out(`  ${String(n).padStart(6)}  ${t}`);
}

const unaddressable = doomed.filter((r) => !r.key);
if (unaddressable.length > 0) {
  out(`\n  ${unaddressable.length} carry no edge key and cannot be deleted by this route.`);
}

if (!APPLY) {
  out(`\nDRY RUN — nothing deleted. Re-run with --apply to remove ${doomed.length}.\n`);
  process.exit(0);
}

let deleted = 0; let failed = 0;
for (const r of doomed) {
  if (!r.key) { failed += 1; continue; }
  try {
    const res = await fetch(`${OBS_API}/api/v1/relations/${encodeURIComponent(r.key)}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    deleted += 1;
    if (deleted % 2000 === 0) out(`  … ${deleted}/${doomed.length}`);
  } catch (err) {
    failed += 1;
    if (failed <= 5) process.stderr.write(`[repair] ${r.key}: ${err.message}\n`);
  }
}

out(`\ndeleted : ${deleted}`);
out(`failed  : ${failed}`);

// Read back. NOTE: this is the same process that performed the writes, so it
// proves the in-memory state only — the durability check is a restart, which
// is how the self-edge repair's first run was caught silently failing.
const after = await getJson('/api/v1/relations?limit=60000');
const rels2 = after.relations ?? after.data ?? after;
const seen = new Set(); let stillDup = 0;
for (const r of rels2) {
  const t = r.attributes?.type ?? '(untyped)';
  if (ONLY_TYPE && t !== ONLY_TYPE) continue;
  const k = keyOf(r.source, r.target, t);
  if (seen.has(k)) stillDup += 1; else seen.add(k);
}
out(`remaining duplicates (in-memory read-back): ${stillDup}`);
out('\nRe-check after an obs-api restart before believing this.\n');
