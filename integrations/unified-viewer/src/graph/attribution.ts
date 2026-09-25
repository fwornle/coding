// Why a rendered row belongs to no project — and which of those are fixable.
//
// `countUnanchored` (unanchored.ts) answers HOW MANY. That number was read as
// "rows nobody has placed yet", and for most of them it was wrong. Measured
// against the live store (2,763 entities / 18,812 relations), of the 98 rows
// that can reach a canvas with no Project/System ancestor:
//
//   18  the writer RECORDED a parent — `metadata.parentEntityName` names a
//       real, rooted entity — and nothing reads the field.
//   56  carry `has_insight` from their Project but are classed `Detail`.
//       `deriveParents` refuses that pair on purpose (hierarchy-parents.ts:156:
//       `has_insight` places an Insight and nothing else), so the Project
//       claims them and the tree still cannot hold them.
//    5  carry a structural edge whose OTHER END IS NOT IN THE STORE.
//   19  nothing claims them at all — every one an `Intent`, i.e. the intent
//       spine's own roots, which the code spine now gates out entirely.
//
// WHY THE CATEGORIES MATTER MORE THAN THE TOTAL. They need four different
// actions, and only one of them is a UI action. Showing a single
// "17 unattributed" chip invites the obvious gesture — drag it onto a project —
// which for three of the four categories writes a second, redundant placement
// on top of a class bug or a dangling reference and makes the graph look fixed
// while the cause stays. There is no category here where a human must INVENT a
// placement, so there is nothing for a drag to decide.
//
// PURE, AND SHARED WITH THE CLI. `scripts/assert-graph-density.ts` imports this
// rather than keeping its own walk. Two implementations of one question is the
// exact failure `useGraphVisibility.ts` exists to prevent — its header records
// the canvas and the footer disagreeing five different ways — and this file
// starts life with two consumers, so it starts life shared.

/** Classes that count as a root. Same set as `unanchored.ts:36`. */
export const ROOT_CLASSES: ReadonlySet<string> = new Set(['Project', 'System'])

/** Structural edge types — the set the anchor invariant is stated over.
 *  Same list as `rehome-edges.ts` ANCHOR_EDGE_TYPES; kept separate because
 *  that one is about DRAWING an edge and this one is about explaining its
 *  absence, and merging them would couple a renderer to a diagnostic. */
export const STRUCTURAL_EDGE_TYPES: ReadonlySet<string> = new Set([
  'contains', 'parent-child', 'includes', 'has_insight',
])

export interface AttributionEntity {
  id: string
  name?: string
  ontologyClass?: string
  metadata?: Record<string, unknown>
}

export interface AttributionEdge {
  from: string
  to: string
  type?: string
}

/** Why one row has no Project/System ancestor.
 *
 *  Ordered by how actionable it is, most first — the panel renders them in
 *  this order and the first is the only one that offers a write. */
export type AttributionCategory =
  /** `metadata.parentEntityName` names a real, rooted entity. One field write
   *  (`metadata.parentId`) roots the row, using the writer's own answer. */
  | 'recordedParent'
  /** Claimed by a Project via `has_insight` but not classed `Insight`, so
   *  `deriveParents` refuses the edge. Fixing it is an ontology decision —
   *  reclass the row, or widen the guard — not a per-row UI action. */
  | 'wrongClass'
  /** A structural edge whose other end is not in the store. Placing the child
   *  would hide a referential break rather than repair it. */
  | 'danglingRef'
  /** Nothing claims it by edge or by name. The only category where a human
   *  would have to decide, and it is empty in the code spine. */
  | 'unclaimed'

export interface AttributionFinding {
  id: string
  name: string
  ontologyClass: string
  category: AttributionCategory
  /** For `recordedParent` only: the entity the writer named, resolved. */
  suggestedParentId?: string
  suggestedParentName?: string
}

export interface AttributionReport {
  findings: AttributionFinding[]
  byCategory: Record<AttributionCategory, AttributionFinding[]>
  /** Rows with no Project/System ancestor, whatever the reason. */
  total: number
}

const EMPTY_REPORT = (): AttributionReport => ({
  findings: [],
  byCategory: { recordedParent: [], wrongClass: [], danglingRef: [], unclaimed: [] },
  total: 0,
})

/**
 * Walk to the Project/System above `id`, or null.
 *
 * Replaces the private `rootOf` in assert-graph-density.ts:181-194 — same walk,
 * same cycle guard, one copy.
 */
export function rootOf(
  id: string,
  parents: ReadonlyMap<string, string>,
  classOf: (id: string) => string | undefined,
): string | null {
  const seen = new Set<string>()
  let cur = id
  for (;;) {
    if (ROOT_CLASSES.has(classOf(cur) ?? '')) return cur
    const next = parents.get(cur)
    if (next === undefined || seen.has(next)) return null
    seen.add(next)
    cur = next
  }
}

/**
 * Categorise every entity in `candidates` that has no Project/System ancestor.
 *
 * @param candidates  the rows to judge — the CALLER decides which population
 *   that is. The panel passes what is rendered; the CLI passes the same. Raw
 *   stream rows (Observation/Digest) never reach a canvas and must be excluded
 *   upstream, or they dominate the count with 580 rows nobody can act on.
 * @param allEntities every entity, for resolving `parentEntityName` and for
 *   detecting an edge whose far end does not exist. NOT the same set as
 *   `candidates`: a dangling reference is only detectable against the whole
 *   store.
 * @param edges       every relation, hidden endpoints included.
 */
export function categoriseUnattributed(
  candidates: readonly AttributionEntity[],
  allEntities: readonly AttributionEntity[],
  edges: readonly AttributionEdge[],
  parents: ReadonlyMap<string, string>,
  classOf: (id: string) => string | undefined,
): AttributionReport {
  if (candidates.length === 0) return EMPTY_REPORT()

  const byId = new Map<string, AttributionEntity>()
  for (const e of allEntities) byId.set(e.id, e)

  // Name -> entities. Ambiguity is real (roll-up parents share their child's
  // name — 40 of the 98 have a same-named twin), so a name that resolves to
  // more than one ROOTED entity is not a suggestion, it is a coin flip. Those
  // fall through to a less actionable category rather than guessing.
  const byName = new Map<string, AttributionEntity[]>()
  for (const e of allEntities) {
    const n = e.name
    if (typeof n !== 'string' || n.length === 0) continue
    const list = byName.get(n)
    if (list === undefined) byName.set(n, [e])
    else list.push(e)
  }

  // Inbound structural edges, keyed by child.
  const inbound = new Map<string, AttributionEdge[]>()
  for (const e of edges) {
    if (e.type !== undefined && !STRUCTURAL_EDGE_TYPES.has(e.type)) continue
    if (e.from === e.to) continue
    const list = inbound.get(e.to)
    if (list === undefined) inbound.set(e.to, [e])
    else list.push(e)
  }

  const isRooted = (id: string) =>
    ROOT_CLASSES.has(classOf(id) ?? '') || rootOf(id, parents, classOf) !== null

  const report = EMPTY_REPORT()

  for (const entity of candidates) {
    const cls = entity.ontologyClass ?? classOf(entity.id) ?? ''
    if (ROOT_CLASSES.has(cls)) continue
    if (rootOf(entity.id, parents, classOf) !== null) continue

    report.total += 1
    const meta = entity.metadata ?? {}
    const edgesIn = inbound.get(entity.id) ?? []

    let category: AttributionCategory = 'unclaimed'
    let suggestedParentId: string | undefined
    let suggestedParentName: string | undefined

    // 1. The writer already answered. Only when the name resolves to exactly
    //    one rooted entity — see the ambiguity note above.
    const named = meta.parentEntityName
    if (typeof named === 'string' && named.length > 0) {
      const rooted = (byName.get(named) ?? []).filter((c) => c.id !== entity.id && isRooted(c.id))
      if (rooted.length === 1) {
        category = 'recordedParent'
        suggestedParentId = rooted[0].id
        suggestedParentName = rooted[0].name
      }
    }

    if (category === 'unclaimed') {
      // 2. A Project claims it by `has_insight`, but the class blocks it.
      const claimedByProject = edgesIn.some(
        (e) => e.type === 'has_insight' && ROOT_CLASSES.has(classOf(e.from) ?? ''),
      )
      if (claimedByProject) category = 'wrongClass'
      // 3. An edge points at something that is not there.
      else if (edgesIn.some((e) => !byId.has(e.from))) category = 'danglingRef'
      // 4. A parent that exists but is itself unrooted is NOT this row's
      //    problem — the break is upstream, so the row is reported under
      //    whichever category its ancestor falls into, and this one stays
      //    'unclaimed' only when nothing at all refers to it.
      else if (edgesIn.length > 0) category = 'danglingRef'
    }

    const finding: AttributionFinding = {
      id: entity.id,
      name: entity.name ?? entity.id,
      ontologyClass: cls,
      category,
      ...(suggestedParentId !== undefined ? { suggestedParentId, suggestedParentName } : {}),
    }
    report.findings.push(finding)
    report.byCategory[category].push(finding)
  }

  return report
}

/** One-line cause per category, for the panel. Written for somebody deciding
 *  what to do next, not describing the code. */
export const CATEGORY_LABEL: Record<AttributionCategory, { title: string; cause: string }> = {
  recordedParent: {
    title: 'Parent recorded but unused',
    cause: 'The writer named a parent in metadata and nothing reads it. One click places these.',
  },
  wrongClass: {
    title: 'Claimed by a project, wrong class',
    cause: 'A Project claims these via has_insight, but they are not classed Insight, so the tree refuses the edge. Needs an ontology decision, not a placement.',
  },
  danglingRef: {
    title: 'Broken reference',
    cause: 'The edge that should place these points at an entity that is not in the store. Placing the child would hide the break.',
  },
  unclaimed: {
    title: 'Nothing claims these',
    cause: 'No edge and no recorded parent. Somebody has to decide where they belong.',
  },
}
