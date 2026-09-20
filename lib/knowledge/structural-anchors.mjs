// The structural-anchor invariant, in one place.
//
// THE RULE: every knowledge row carries at least one STRUCTURAL edge
// (`contains` / `parent-child` / `has_insight` / `includes`). Provenance edges
// do NOT count.
//
// WHY PROVENANCE DOES NOT COUNT
//
// `capturedBy` (~13k) and `mentions` (~11k) are 89% of this graph's edges and
// are hidden by default in the viewer, because drawing them makes the canvas
// unreadable. A row whose only edges are provenance is therefore connected in
// the data and a floating dot on screen. "Orphan" (degree 0) does not describe
// what an operator sees: the header could honestly report 14 orphans over a
// picture showing ~81 stranded nodes. `stranded` below is that second number.
//
// Shared by:
//   - scripts/anchor-unstructured-entities.mjs  (repair + --check CLI)
//   - scripts/health-coordinator.js             (graph_integrity slice)
// so the guard and the repair can never disagree about what a violation is.

export const STRUCTURAL_EDGE_TYPES = Object.freeze(
  new Set(['contains', 'parent-child', 'has_insight', 'includes']),
);

/**
 * Classes subject to the invariant. Observations are deliberately absent —
 * they are raw stream, shielded from the canvas, and `capturedBy` IS their
 * real relationship. Holding them to this rule would report ~13k permanent
 * violations and make the guard useless.
 */
export const ANCHORED_CLASSES = Object.freeze(
  new Set(['Insight', 'OnlineInsight', 'Digest', 'OnlineDigest', 'Detail', 'SubComponent', 'Component']),
);

/** The read API spells edges source/target; the write API spells them from/to. */
export const edgeFrom = (r) => r.from ?? r.source;
export const edgeTo = (r) => r.to ?? r.target;
export const edgeType = (r) => r.type ?? r.attributes?.type;
export const classOf = (e) => e.ontologyClass ?? e.entityType;

/**
 * Project ENTITIES are CamelCase (`A2aXpr`); `metadata.project` is the slug
 * (`a2a-xpr`). A lowercase compare silently missed 136 rows on the first
 * repair run and reported them as "project does not resolve" when the project
 * was right there. Fold both sides to alphanumerics.
 */
export const projectSlug = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Which project owns this row, for anchoring purposes.
 *
 * `metadata.project` first, then `metadata.team`. The fallback is not a guess:
 * the two fields carry the same value space here — the viewer's Teams/Views
 * rail lists `Coding` and `UI` under PROJECTS, and the visibility predicate
 * already reads `metadata.team ?? 'coding'` for its Teams filter. Rows written
 * by the wave-analysis extraction set `team` and leave `project` null, which
 * is why 34 rows were reported as "project does not resolve" when the owner
 * was sitting in the next field.
 *
 * Returns null when neither is present — callers must report, never invent.
 */
export function resolveProjectKey(entity) {
  const m = entity?.metadata ?? {};
  return m.project ?? m.team ?? entity?.project ?? null;
}

/**
 * Audit the invariant over an already-fetched graph.
 *
 * Pure: no I/O, so the coordinator can feed it whatever it already has and the
 * CLI can feed it a fresh read, and both get the same verdict.
 *
 * @returns {{total:number, unanchored:number, orphans:number, stranded:number,
 *            byClass:Record<string,number>, rows:Array<object>}}
 *   `orphans` are degree-0; `stranded` carry only non-structural edges. The two
 *   are disjoint and sum to `unanchored`.
 */
export function auditStructuralAnchors(entities, relations) {
  // Anchors are DIRECTIONAL: what counts is something CONTAINING this row, not
  // merely touching it.
  //
  // This counted both directions at first, and that was wrong in a way that
  // hid the bug it was written to catch. A SubComponent that `contains` two
  // Details, but that nothing contains, scored as anchored — while being
  // exactly the dead end that strands its own subtree: hide it, and its
  // children have no ladder up because their parent has no parent. Three
  // stranded nodes in the rendered view traced to precisely that
  // (FileWatchManager, SpecstoryIntegration) while the guard read 0
  // violations.
  //
  // `anyDegree` stays undirected — for the orphan/stranded split it genuinely
  // does not matter which way an edge points.
  const structuralInbound = new Map();
  const anyDegree = new Map();
  for (const r of relations) {
    const structural = STRUCTURAL_EDGE_TYPES.has(edgeType(r));
    const from = edgeFrom(r);
    const to = edgeTo(r);
    for (const v of [from, to]) {
      if (v === undefined || v === null) continue;
      anyDegree.set(v, (anyDegree.get(v) ?? 0) + 1);
    }
    // A self-edge would let a node anchor itself.
    if (structural && to !== undefined && to !== null && to !== from) {
      structuralInbound.set(to, (structuralInbound.get(to) ?? 0) + 1);
    }
  }
  const structuralDegree = structuralInbound;

  const rows = [];
  const byClass = {};
  let orphans = 0;
  for (const e of entities) {
    const cls = classOf(e);
    if (!ANCHORED_CLASSES.has(cls)) continue;
    // `[Raw] …` rows are LLM-failure placeholders, not knowledge. The viewer's
    // visibility predicate drops them by name before any other rule, so they
    // can never be the floating dot this invariant exists to prevent. Holding
    // them to it would report a violation nobody can see and nobody should
    // fix by anchoring — the repair for a raw stub is deletion.
    if (typeof e.name === 'string' && e.name.startsWith('[Raw]')) continue;
    if ((structuralDegree.get(e.id) ?? 0) > 0) continue;
    const isOrphan = (anyDegree.get(e.id) ?? 0) === 0;
    if (isOrphan) orphans += 1;
    byClass[cls] = (byClass[cls] ?? 0) + 1;
    rows.push({ id: e.id, name: e.name, ontologyClass: cls, isOrphan, project: e.metadata?.project ?? e.project });
  }

  return {
    total: entities.length,
    unanchored: rows.length,
    orphans,
    stranded: rows.length - orphans,
    byClass,
    rows,
  };
}

/**
 * Classes that carry a hierarchy and therefore a parent. Deliberately NOT
 * `ANCHORED_CLASSES`: measured on the live store, Insight (0/912), Digest
 * (0/176) and OnlineDigest (0/8) carry no `parentEntityName` at all. The online
 * consolidator path has no hierarchy notion — it anchors by `has_insight` /
 * `includes` edges instead. Holding those ~1096 rows to a metadata invariant
 * they were never written to satisfy would report a permanent non-violation and
 * drown the real signal, which is the same reasoning that already exempts
 * Observation from ANCHORED_CLASSES.
 *
 * Project and System fall out by construction: they are the roots, they have no
 * parent, and they are not in this set.
 */
export const HIERARCHY_CLASSES = Object.freeze(
  new Set(['Component', 'SubComponent', 'Detail']),
);

/**
 * Audit the PARENT-METADATA invariant: does a hierarchy row declare a
 * `metadata.parentEntityName`, and does a node by that name exist?
 *
 * This is a DIFFERENT invariant from auditStructuralAnchors. That one asks
 * "does anything contain this row" (edges); this one asks "does it declare a
 * parent that exists" (metadata). A row can satisfy either and fail the other,
 * so the counts are reported separately and must never be summed into
 * `unanchored` — doing so would redefine what a healthy graph means.
 *
 * LIMIT, stated rather than implied: `parentEntityName` holds a NAME, not an
 * EntityId (canonical-mapper writes `raw.parentId`, a name, and
 * storeRelationship resolves endpoints by name too). Set membership therefore
 * answers exactly "does a node by that name exist" and nothing more. It cannot
 * catch "resolves to the wrong duplicate" — and names are not unique in this
 * graph, which is why the adapter carries oldest-wins disambiguation at all.
 */
export function auditParentMetadata(entities) {
  const names = new Set(entities.map((e) => e.name));
  const rows = [];
  const byClass = {};
  let missingParent = 0;
  let danglingParent = 0;
  let checked = 0;
  for (const e of entities) {
    const cls = classOf(e);
    if (!HIERARCHY_CLASSES.has(cls)) continue;
    // Same rationale as the anchored audit: a raw stub's repair is deletion.
    if (typeof e.name === 'string' && e.name.startsWith('[Raw]')) continue;
    checked += 1;
    const parent = e.metadata?.parentEntityName;
    const hasParent = typeof parent === 'string' && parent.length > 0;
    let reason;
    if (!hasParent) {
      missingParent += 1;
      reason = 'missing';
    } else if (!names.has(parent)) {
      danglingParent += 1;
      reason = 'dangling';
    } else {
      continue;
    }
    byClass[cls] = (byClass[cls] ?? 0) + 1;
    rows.push({
      id: e.id,
      name: e.name,
      ontologyClass: cls,
      parentEntityName: hasParent ? parent : null,
      reason,
    });
  }
  return { checked, missingParent, danglingParent, byClass, rows };
}

/** Fetch the graph and audit it. Throws on a non-OK response — callers decide
 *  what an unreachable store means for their status.
 *
 *  Additive: every pre-existing key keeps its exact meaning, with the
 *  parent-metadata audit alongside under `parents`. */
export async function fetchAndAudit(obsApiUrl, { timeoutMs = 60_000 } = {}) {
  const get = async (p) => {
    const r = await fetch(`${obsApiUrl}${p}`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) throw new Error(`GET ${p} -> ${r.status}`);
    return (await r.json()).data;
  };
  const [entities, relations] = await Promise.all([
    get('/api/v1/entities?limit=10000'),
    get('/api/v1/relations?limit=100000'),
  ]);
  return {
    ...auditStructuralAnchors(entities, relations),
    parents: auditParentMetadata(entities),
  };
}
