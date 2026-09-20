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
  const structuralDegree = new Map();
  const anyDegree = new Map();
  for (const r of relations) {
    const structural = STRUCTURAL_EDGE_TYPES.has(edgeType(r));
    for (const v of [edgeFrom(r), edgeTo(r)]) {
      if (v === undefined || v === null) continue;
      anyDegree.set(v, (anyDegree.get(v) ?? 0) + 1);
      if (structural) structuralDegree.set(v, (structuralDegree.get(v) ?? 0) + 1);
    }
  }

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

/** Fetch the graph and audit it. Throws on a non-OK response — callers decide
 *  what an unreachable store means for their status. */
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
  return auditStructuralAnchors(entities, relations);
}
