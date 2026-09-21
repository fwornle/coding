#!/usr/bin/env node
/**
 * repoint-capturedby-anchors.mjs — make `capturedBy` say who captured it.
 *
 * WHAT IT FIXES. All 1,244 `capturedBy` edges terminate on the single
 * `LiveLoggingSystem` Component. One distinct target means the edge answers
 * nothing: "captured by" is a provenance name on what is really an
 * anti-orphan tether. This repoints each edge onto the subsystem that
 * actually wrote the row.
 *
 *     Observation  ->  ObservationWriter          (exists already)
 *     Insight      ->  ObservationConsolidator    (minted by this script)
 *     Digest       ->  ObservationConsolidator
 *
 * WHY entityType AND NOT runId. Measured over all 1,244 sources, the split is
 * total: every Observation carried an `obs-writer` runId, every Insight a
 * consolidation one (`obs-consolidator`, or `insight-resynthesize` — the same
 * subsystem re-running one row). Nothing crossed over. That also settles the
 * 67 Insights written before run-stamping existed (2026-05-14..06-04), which
 * would otherwise have no attributable run at all.
 *
 * WHY NOT ONE NODE PER RUN. `_runId` regenerates in the writer's constructor,
 * so a node per run mints one on every service restart, forever: 500 runs
 * already describe 2,398 entities, and 401 of them cover three rows or fewer.
 * The exact run stays on `metadata.provenance`, queryable via
 * `/api/v1/graph/runs` and `/api/v1/entities?runId=`. An edge is the wrong
 * place for an unbounded key; a bounded one is what makes the edge readable.
 *
 * ORDER. The writer must be deployed BEFORE this runs, or new rows keep
 * anchoring to `LiveLoggingSystem` behind you. `ANCHOR_FOR_KIND` in
 * ObservationWriter.js is the matching half of the table above.
 *
 * ADD-THEN-DELETE, never the reverse: the new edge is created and verified
 * before the old one is removed, so a failure mid-way leaves a row with two
 * anchors (harmless, re-runnable) rather than none (an orphan).
 *
 * DRY RUN BY DEFAULT.
 *
 * Usage:
 *   node scripts/repoint-capturedby-anchors.mjs            # report
 *   node scripts/repoint-capturedby-anchors.mjs --apply
 */

const OBS_API = process.env.OBS_API_URL || 'http://127.0.0.1:12436';
const APPLY = process.argv.includes('--apply');

const ANCHOR_ROOT = 'LiveLoggingSystem';
const ANCHOR_FOR_TYPE = {
  Observation: 'ObservationWriter',
  Digest: 'ObservationConsolidator',
  OnlineDigest: 'ObservationConsolidator',
  Insight: 'ObservationConsolidator',
  OnlineInsight: 'ObservationConsolidator',
};

// Minted only if absent. A SubComponent of LiveLoggingSystem, because that is
// what it is — the consolidation half of the live-logging system — and because
// the tether has to land on something that is itself attached, or the rows it
// anchors become an island instead of orphans.
const MINT = {
  ObservationConsolidator: {
    entityType: 'SubComponent',
    description:
      'Consolidation half of the live-logging system: rolls observations into '
      + 'daily digests and synthesises insights from them. Anchor target for the '
      + 'capturedBy edges of every Digest and Insight it writes.',
  },
};

const out = (m = '') => process.stdout.write(`${m}\n`);
const die = (m) => { process.stderr.write(`${m}\n`); process.exit(1); };

async function getJson(path) {
  const res = await fetch(`${OBS_API}${path}`);
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return res.json();
}
async function send(method, path, body) {
  const res = await fetch(`${OBS_API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}
const unwrap = (r, ...keys) => {
  for (const k of keys) if (Array.isArray(r?.[k])) return r[k];
  return Array.isArray(r) ? r : [];
};

out('\n=== capturedBy anchor repoint ===');
out(`obs-api : ${OBS_API}`);
out(`mode    : ${APPLY ? 'APPLY — mints and repoints' : 'DRY RUN — writes nothing'}\n`);

const entities = unwrap(await getJson('/api/v1/entities?limit=60000'), 'entities', 'data');
const relations = unwrap(await getJson('/api/v1/relations?limit=60000'), 'relations', 'data');
const byId = new Map(entities.map((e) => [e.id, e]));
const byName = new Map();
for (const e of entities) if (!byName.has(e.name)) byName.set(e.name, e);

const root = byName.get(ANCHOR_ROOT);
if (!root) die(`${ANCHOR_ROOT} not found — nothing to repoint from.`);

// ---- 1. anchors ----
const anchorId = new Map([[ANCHOR_ROOT, root.id]]);
for (const name of new Set(Object.values(ANCHOR_FOR_TYPE))) {
  const found = byName.get(name);
  if (found) { anchorId.set(name, found.id); out(`anchor  : ${name} — exists (${found.entityType})`); continue; }
  const spec = MINT[name];
  if (!spec) die(`anchor '${name}' is missing and this script has no spec to mint it.`);
  out(`anchor  : ${name} — MINT as ${spec.entityType} under ${ANCHOR_ROOT}`);
  if (APPLY) {
    const r = await send('POST', '/api/v1/entities', {
      name, entityType: spec.entityType, ontologyClass: spec.entityType,
      layer: 'architecture', description: spec.description,
      metadata: { mintedBy: 'repoint-capturedby-anchors', mintedAt: new Date().toISOString() },
    });
    const id = r?.data?.id ?? r?.id;
    if (!id) die(`mint of ${name} returned no id`);
    anchorId.set(name, id);
    // Attach it, or the anchor is itself an orphan and the tether hangs off nothing.
    await send('POST', '/api/v1/relations', {
      from: root.id, to: id, relationType: 'contains',
      metadata: { source: 'repoint-capturedby-anchors' },
    });
    out(`          minted ${id} and attached via contains`);
  }
}

// ---- 2. plan ----
const cap = relations.filter((r) => (r.attributes || {}).type === 'capturedBy');
const plan = [];
const skipped = new Map();
for (const r of cap) {
  const src = byId.get(r.source);
  if (!src) { skipped.set('source missing', (skipped.get('source missing') || 0) + 1); continue; }
  const want = ANCHOR_FOR_TYPE[src.entityType];
  if (!want) { skipped.set(`unmapped entityType ${src.entityType}`, (skipped.get(`unmapped entityType ${src.entityType}`) || 0) + 1); continue; }
  const wantId = anchorId.get(want);
  if (!wantId) { skipped.set(`anchor ${want} absent (dry run)`, (skipped.get(`anchor ${want} absent (dry run)`) || 0) + 1); continue; }
  if (r.target === wantId) { skipped.set('already correct', (skipped.get('already correct') || 0) + 1); continue; }
  plan.push({ key: r.key, from: r.source, to: wantId, want, attrs: r.attributes || {} });
}

const byTarget = new Map();
for (const p of plan) byTarget.set(p.want, (byTarget.get(p.want) || 0) + 1);
out(`\ncapturedBy edges : ${cap.length}`);
out(`to repoint       : ${plan.length}`);
for (const [k, v] of [...byTarget].sort((a, b) => b[1] - a[1])) out(`   ${String(v).padStart(5)}  -> ${k}`);
for (const [k, v] of skipped) out(`   ${String(v).padStart(5)}  skipped: ${k}`);

if (!APPLY) { out('\nDRY RUN — nothing written. Re-run with --apply.'); process.exit(0); }

// ---- 3. apply: add the new edge, verify, then drop the old ----
let moved = 0, failed = 0;
for (const p of plan) {
  try {
    await send('POST', '/api/v1/relations', {
      from: p.from, to: p.to, relationType: 'capturedBy',
      createdAt: p.attrs.createdAt,
      metadata: {
        ...(p.attrs.metadata || {}),
        repointedFrom: ANCHOR_ROOT,
        repointedAt: new Date().toISOString(),
      },
    });
    await send('DELETE', `/api/v1/relations/${encodeURIComponent(p.key)}`);
    moved += 1;
  } catch (err) {
    failed += 1;
    process.stderr.write(`repoint ${p.from} -> ${p.want} failed: ${err.message}\n`);
  }
}
out(`\nrepointed : ${moved}`);
out(`failed    : ${failed}`);

const after = unwrap(await getJson('/api/v1/relations?limit=60000'), 'relations', 'data')
  .filter((r) => (r.attributes || {}).type === 'capturedBy');
const tgts = new Map();
for (const r of after) {
  const e = byId.get(r.target) || entities.find((x) => x.id === r.target);
  tgts.set(e ? e.name : r.target, (tgts.get(e ? e.name : r.target) || 0) + 1);
}
out(`\ncapturedBy targets now (in-memory read-back):`);
for (const [k, v] of [...tgts].sort((a, b) => b[1] - a[1])) out(`   ${String(v).padStart(5)}  ${k}`);
out('\nRe-check after an obs-api restart before believing this.');
