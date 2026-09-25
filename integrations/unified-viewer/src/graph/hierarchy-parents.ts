// Deriving the hierarchy's parent pointers from the graph's edges.
//
// WHY THIS EXISTS
//
// HierarchyNavigator used to read `metadata.parent` off each entity. No writer
// has ever set that field — the live graph has it on 0 of 2441 entities — so
// every hierarchy node fell through to the roots array and the "project tree"
// rendered as ~1341 siblings. The hierarchy is real, it just lives in edges:
// `contains` (~1100), `parent-child` (~50) and `includes` (~23).
//
// WHY IT NEEDS A RULE RATHER THAN A LOOKUP
//
// Those edges describe a DAG, not a tree. ~129 nodes have more than one
// candidate parent — SemanticAnalysis is `contains`ed by KnowledgeManagement
// (a Component, its sibling level) and `parent-child`ed by Coding (the Project
// above it). Rendering needs one parent, chosen the same way every time, or the
// tree reshuffles between loads.
//
// The ranking, in order:
//   1. a parent exactly one ontology level up beats any other — this is what
//      picks Coding over KnowledgeManagement above;
//   2. then edge type: parent-child (explicit) > contains > includes;
//   3. then the shallower parent, then name — pure tie-breaks, for stability.

/**
 * Structurally minimal inputs. The viewer has two `Relation` shapes in play —
 * `api/ApiClient` (open index signature) and `graph/types` (closed {from,to,type})
 * — and this module is called with both. Naming only the fields it reads lets
 * either satisfy it without a cast at the call site.
 */
export interface HierarchyNode {
  id: string
  name: string
  ontologyClass: string
  /** Stage 4's explicit placement. Read for `parentId` only — see the
   *  metadata.parentId note in the ranking below. */
  metadata?: { parentId?: string } | Record<string, unknown>
}

export interface HierarchyEdge {
  from: string
  to: string
  type?: string
}

/**
 * Ontology depth. `System` is included so CollectiveKnowledge can be the single
 * root the Projects hang from; without it every Project is a root and the top
 * of the tree is 26 wide.
 */
export const HIERARCHY_LEVEL: Readonly<Record<string, number>> = {
  System: 0,
  Project: 1,
  Component: 2,
  SubComponent: 3,
  Detail: 4,
  // `Insight` sits at Detail's level, as a SubComponent's child.
  //
  // It was absent until 2026-09-21, which meant `deriveParents` never emitted
  // a parent for one and the entire online-learning population — 975 Insights,
  // 742 of them under Coding — could not participate in the hierarchy at all.
  // They are not unparented in the data: each hangs off its Project by
  // `has_insight`, and 147 carry an explicit `metadata.parentId` naming a
  // SubComponent. The tree simply could not see either.
  //
  // Level 4 is not a choice made here: stage 4's backfill already derives an
  // Insight's `hierarchyLevel` as its parent's + 1, and a SubComponent is 3.
  Insight: 4,
}

export const HIERARCHY_CLASSES: ReadonlySet<string> = new Set(Object.keys(HIERARCHY_LEVEL))

/** Edge types that mean containment, best first. Anything else is not a parent edge. */
const PARENT_EDGE_RANK: Readonly<Record<string, number>> = {
  'parent-child': 0,
  contains: 1,
  includes: 2,
  // Last resort, and only because the alternative is worse. `has_insight` is
  // ownership rather than position — stage 2 kept Insights out of `contains`
  // precisely to preserve that distinction — but it is the ONLY attachment
  // 828 of the 975 Insights have. Ranked below every containment edge and
  // below `metadata.parentId`, so it never displaces a real placement; it
  // just means an unplaced Insight hangs off its Project instead of falling
  // out of the tree entirely and rendering as an unattributable dot.
  has_insight: 3,
}

/**
 * `metadata.parentId` outranks every edge.
 *
 * It is the only signal that states a PLACEMENT. The edge an Insight actually
 * carries is `has_insight` from its Project, and that is an ownership tether,
 * not a position — the same double duty `capturedBy` was doing before it was
 * repointed. Stage 2 deliberately kept Insights out of `contains` so the
 * hierarchy-member / learning-artifact partition stayed exact, and stage 4
 * therefore wrote the placement to a field instead of an edge. Stage 5's
 * synthesis already reads both sources when it rolls a parent up; this makes
 * the tree agree with the roll-up that is computed over it.
 *
 * Ranked above `parent-child` rather than merged into the table because it is
 * not an edge type: nothing can out-rank an explicit statement of where a row
 * belongs.
 */
const EXPLICIT_PLACEMENT_RANK = -1

function levelOf(e: HierarchyNode | undefined): number {
  if (!e) return Number.MAX_SAFE_INTEGER
  return HIERARCHY_LEVEL[e.ontologyClass] ?? Number.MAX_SAFE_INTEGER
}

/**
 * Choose one parent per hierarchy entity.
 *
 * @returns entity id → parent entity id. An entity with no candidate is absent
 *   from the map (the caller decides what a parentless node means); entities
 *   outside {@link HIERARCHY_CLASSES} are never keys or values.
 */
export function deriveParents(
  entities: readonly HierarchyNode[],
  relations: readonly HierarchyEdge[],
): Map<string, string> {
  const byId = new Map<string, HierarchyNode>()
  for (const e of entities) {
    if (HIERARCHY_CLASSES.has(e.ontologyClass)) byId.set(e.id, e)
  }

  // child id → best candidate so far, kept as a comparable tuple.
  const best = new Map<string, { key: [number, number, number, string]; parentId: string }>()

  // Explicit placements first, so an edge can only ever be a fallback.
  for (const child of byId.values()) {
    const pid = (child.metadata as { parentId?: string } | undefined)?.parentId
    if (!pid || pid === child.id) continue
    const parent = byId.get(pid)
    if (!parent) continue // names a row outside the hierarchy, or a dead id
    const key: [number, number, number, string] = [
      levelOf(parent) === levelOf(child) - 1 ? 0 : 1,
      EXPLICIT_PLACEMENT_RANK,
      levelOf(parent),
      parent.name,
    ]
    best.set(child.id, { key, parentId: parent.id })
  }

  for (const r of relations) {
    const rank = PARENT_EDGE_RANK[r.type ?? '']
    if (rank === undefined) continue
    if (r.from === r.to) continue // a self-edge would root the node in itself

    const parent = byId.get(r.from)
    const child = byId.get(r.to)
    if (!parent || !child) continue
    // `has_insight` places an INSIGHT and nothing else. It is a Project's
    // claim on a learning artifact, not a containment relation, so letting it
    // parent a Component would invent hierarchy out of ownership.
    if (r.type === 'has_insight' && child.ontologyClass !== 'Insight') continue

    const pLevel = levelOf(parent)
    const cLevel = levelOf(child)
    const key: [number, number, number, string] = [
      pLevel === cLevel - 1 ? 0 : 1,
      rank,
      pLevel,
      parent.name,
    ]

    const current = best.get(child.id)
    if (!current || compare(key, current.key) < 0) {
      best.set(child.id, { key, parentId: parent.id })
    }
  }

  const parents = new Map<string, string>()
  for (const [childId, { parentId }] of best) parents.set(childId, parentId)

  // A cycle would hang any ancestor walk and any recursive render. The data has
  // none today; a future writer emitting a `contains` both ways would introduce
  // one silently, so break them here rather than discover it as a frozen tab.
  // The deeper node loses its parent and becomes a root — visible, not fatal.
  for (const childId of [...parents.keys()]) {
    const seen = new Set<string>([childId])
    let cursor = parents.get(childId)
    while (cursor !== undefined) {
      if (seen.has(cursor)) {
        parents.delete(childId)
        break
      }
      seen.add(cursor)
      cursor = parents.get(cursor)
    }
  }

  return parents
}

function compare(
  a: readonly [number, number, number, string],
  b: readonly [number, number, number, string],
): number {
  if (a[0] !== b[0]) return a[0] - b[0]
  if (a[1] !== b[1]) return a[1] - b[1]
  if (a[2] !== b[2]) return a[2] - b[2]
  return a[3].localeCompare(b[3])
}

/**
 * `metadata.parentId` rendered as edges, so the CANVAS can see a placement the
 * TREE already honours.
 *
 * WHY THIS IS NEEDED AT ALL. `deriveParents` ranks an explicit `parentId`
 * above every edge (EXPLICIT_PLACEMENT_RANK), so placing a row by writing that
 * field is enough to give it a parent, a root, and a correct `countUnanchored`.
 * It is NOT enough to draw anything: a field is not an edge, so the canvas has
 * no line to render and `buildRehomeEdges` — which walks real containment
 * edges — cannot reach it either.
 *
 * Measured after placing 11 rows from their recorded parents: the unanchored
 * count fell 17 -> 6 exactly as intended, and 7 of those rows carried no edge
 * of any kind, so they went on rendering as free-floating dots. The number
 * improved and the picture did not, which is the failure this whole area keeps
 * producing.
 *
 * So the placement is surfaced as what it has always meant: an edge from the
 * parent to the child. Nothing is invented — `contains` is the same type
 * `buildRehomeEdges` already emits for a containment the filters interrupted,
 * and an EXPLICIT placement is a stronger warrant than the hidden chains it
 * already honours.
 *
 * Deliberately NOT merged into the real relation list: these are anchors, not
 * evidence. They go to `buildRehomeEdges` as part of the ladder it climbs, so
 * a row with a genuine edge still draws that edge and only a row with nothing
 * gets the synthetic one.
 *
 * @param entities rows to read `metadata.parentId` from.
 * @returns one `contains` edge per explicit placement. Self-references and
 *   placements naming a row outside `entities` are dropped — the first would
 *   root a node in itself, the second cannot be drawn.
 */
export function explicitPlacementEdges(
  entities: readonly HierarchyNode[],
): HierarchyEdge[] {
  const known = new Set<string>()
  for (const e of entities) known.add(e.id)
  const out: HierarchyEdge[] = []
  for (const e of entities) {
    const pid = (e.metadata as { parentId?: string } | undefined)?.parentId
    if (typeof pid !== 'string' || pid.length === 0) continue
    if (pid === e.id || !known.has(pid)) continue
    out.push({ from: pid, to: e.id, type: 'contains' })
  }
  return out
}
