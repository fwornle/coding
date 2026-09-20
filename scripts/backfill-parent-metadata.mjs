#!/usr/bin/env node
/**
 * backfill-parent-metadata — restore `metadata.parentEntityName` /
 * `hierarchyLevel` / `isScaffoldNode` to hierarchy rows that lost them.
 *
 * WHY THESE ROWS ARE EMPTY. km-core's `putEntity` ends in Graphology's
 * `graph.mergeNode` (GraphKMStore.ts:508), a SHALLOW attribute merge: handing
 * it a `metadata` object REPLACES the stored one rather than merging into it.
 * Wave 4's insight stamp (wave-controller.ts) passed only
 * `{validated_file_path, has_insight_document}`, so every entity that earned an
 * insight document had the metadata waves 1-3 wrote silently erased. Measured
 * on 2026-09-20 across Component/SubComponent/Detail: 181 rows carried the
 * insight stamp and NOT ONE of them still had `parentEntityName`, against 487
 * that kept it because no insight document was ever generated for them.
 *
 * The write path is fixed (km-core-adapter.storeEntity now seeds from the
 * existing entity, making it a read-modify-write). This script repairs the rows
 * already damaged.
 *
 * WHERE THE LOST VALUE COMES BACK FROM. The clobber took the metadata and left
 * the EDGES intact — `LiveLoggingSystem --contains--> MultiUserFileManager` is
 * still there, which is why the viewer still draws these nodes in the right
 * place (it derives parentage from edges and never reads parentEntityName).
 * So the parent is recoverable exactly, not guessed.
 *
 * Parent CHOICE mirrors integrations/unified-viewer/src/graph/hierarchy-parents.ts
 * so the metadata agrees with the tree a user actually sees.
 *
 * ⚠ LEVEL NUMBERING — two vocabularies exist and mixing them is silent damage:
 *   - the VIEWER's display depth:  System 0, Project 1, Component 2, SubComponent 3, Detail 4
 *   - the WRITER's hierarchy level: Project 0, Component 1, SubComponent 2, Detail 3
 * `metadata.hierarchyLevel` is the WRITER's (wave-controller getHierarchyLevelName),
 * and `isScaffoldNode = level < 3` depends on it. This script writes the
 * WRITER's numbering. Confirmed against a live run: a Component is level 1,
 * isScaffoldNode true.
 *
 * Usage:
 *   node scripts/backfill-parent-metadata.mjs             # dry run (default)
 *   node scripts/backfill-parent-metadata.mjs --apply     # write
 *   node scripts/backfill-parent-metadata.mjs --all       # widen past the clobbered cohort
 *
 * Default scope is the CLOBBERED cohort only — rows carrying
 * `has_insight_document` but no `parentEntityName`, i.e. those that demonstrably
 * had the field and lost it. `--all` additionally repairs hierarchy rows that
 * never had it stamped, wherever a parent edge makes the value recoverable.
 *
 * obs-api owns the km-core store single-writer, so this goes over HTTP and must
 * NOT be run while a wave-analysis run is in flight — both would be writing the
 * same rows. The script refuses to --apply if a run is active.
 */

const OBS_API = process.env.OBS_API_URL || 'http://localhost:12436';
const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');

const out = (m = '') => process.stdout.write(`${m}\n`);

const get = async (path) => {
  const r = await fetch(`${OBS_API}${path}`, { signal: AbortSignal.timeout(300_000) });
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status}`);
  return (await r.json()).data;
};

// Writer's hierarchy level — NOT the viewer's display depth. See the header.
const WRITER_LEVEL = { Project: 0, Component: 1, SubComponent: 2, Detail: 3 };
// Viewer's display depth, used ONLY to rank candidate parents the same way the
// rendered tree does.
const VIEW_LEVEL = { System: 0, Project: 1, Component: 2, SubComponent: 3, Detail: 4 };
const PARENT_EDGE_RANK = { 'parent-child': 0, contains: 1, includes: 2 };
// Rows this script will repair. Project/System are roots and have no parent;
// Insight/Digest come from the online path, which has no hierarchy notion.
const REPAIRABLE = new Set(['Component', 'SubComponent', 'Detail']);

const classOf = (e) => e.ontologyClass ?? e.entityType;
const edgeFrom = (r) => r.from ?? r.source;
const edgeTo = (r) => r.to ?? r.target;
const edgeType = (r) => r.type ?? r.attributes?.type;

const cmp = (a, b) => {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
};

// --- refuse to write underneath a live run -----------------------------------
if (APPLY) {
  try {
    const st = await get('/api/workflows/wave-analysis/status');
    if (st?.running) {
      out('REFUSING to apply: a wave-analysis run is in flight.');
      out('It writes these same rows; wait for it to finish, then re-run.');
      process.exit(2);
    }
  } catch {
    out('WARNING: could not read wave-analysis status; proceeding.');
  }
}

const entities = await get('/api/v1/entities?limit=10000');
const relations = await get('/api/v1/relations?limit=100000');

const byId = new Map();
for (const e of entities) if (VIEW_LEVEL[classOf(e)] !== undefined) byId.set(e.id, e);

// child id -> best parent, ranked exactly as hierarchy-parents.ts does.
const best = new Map();
for (const r of relations) {
  const rank = PARENT_EDGE_RANK[edgeType(r) ?? ''];
  if (rank === undefined) continue;
  const from = edgeFrom(r);
  const to = edgeTo(r);
  if (from === to) continue; // a self-edge would root the node in itself
  const parent = byId.get(from);
  const child = byId.get(to);
  if (!parent || !child) continue;
  const pLevel = VIEW_LEVEL[classOf(parent)] ?? Number.MAX_SAFE_INTEGER;
  const cLevel = VIEW_LEVEL[classOf(child)] ?? Number.MAX_SAFE_INTEGER;
  const key = [pLevel === cLevel - 1 ? 0 : 1, rank, pLevel, parent.name];
  const cur = best.get(child.id);
  if (!cur || cmp(key, cur.key) < 0) best.set(child.id, { key, parent });
}

const clobbered = [];
const neverStamped = [];
const unrecoverable = [];

for (const e of entities) {
  const cls = classOf(e);
  if (!REPAIRABLE.has(cls)) continue;
  if (typeof e.name === 'string' && e.name.startsWith('[Raw]')) continue;
  const md = e.metadata ?? {};
  if (typeof md.parentEntityName === 'string' && md.parentEntityName.length > 0) continue;

  const pick = best.get(e.id);
  const bucket = md.has_insight_document ? clobbered : neverStamped;
  if (!pick) {
    unrecoverable.push(e);
    continue;
  }
  bucket.push({ entity: e, parent: pick.parent });
}

const targets = ALL ? [...clobbered, ...neverStamped] : clobbered;

out(`scope: ${ALL ? 'ALL recoverable hierarchy rows' : 'clobbered cohort (insight-stamped, parent erased)'}`);
out(`  clobbered, parent recoverable from edges : ${clobbered.length}`);
out(`  never stamped, parent recoverable        : ${neverStamped.length}${ALL ? '' : '  (use --all)'}`);
out(`  no parent edge — NOT recoverable here    : ${unrecoverable.length}`);
out('');

let repaired = 0;
let failed = 0;
for (const { entity: e, parent } of targets) {
  const cls = classOf(e);
  const level = WRITER_LEVEL[cls];
  const md = e.metadata ?? {};
  const next = {
    ...md,
    parentEntityName: parent.name,
    ...(level !== undefined ? { hierarchyLevel: level, isScaffoldNode: level < 3 } : {}),
    parentBackfilledAt: new Date().toISOString(),
    parentBackfilledFrom: 'structural-edge',
  };

  out(`  ${APPLY ? 'repair' : 'would repair'}  ${String(e.name).padEnd(34).slice(0, 34)} ${String(cls).padEnd(13)} parent=${parent.name}`);
  if (!APPLY) { repaired++; continue; }

  // FULL metadata, deliberately: the PUT lands in the same shallow mergeNode
  // that caused this bug. Sending a partial object here would repeat it.
  const r = await fetch(`${OBS_API}/api/v1/entities/${e.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ metadata: next }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) {
    out(`    FAILED ${r.status} ${(await r.text()).slice(0, 140)}`);
    failed++;
    continue;
  }
  repaired++;
}

out('');
out(`${APPLY ? 'repaired' : 'would repair'}: ${repaired}${failed ? `, failed: ${failed}` : ''}`);
if (unrecoverable.length > 0) {
  out(`no structural parent edge (left alone): ${unrecoverable.length}`);
  for (const e of unrecoverable.slice(0, 10)) out(`  - ${e.name} (${classOf(e)})`);
  if (unrecoverable.length > 10) out(`  … and ${unrecoverable.length - 10} more`);
  out('  These need an anchor edge first: scripts/anchor-unstructured-entities.mjs --apply');
}
if (!APPLY) out('\nDry run. Re-run with --apply.');
