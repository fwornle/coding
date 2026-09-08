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
}

export const HIERARCHY_CLASSES: ReadonlySet<string> = new Set(Object.keys(HIERARCHY_LEVEL))

/** Edge types that mean containment, best first. Anything else is not a parent edge. */
const PARENT_EDGE_RANK: Readonly<Record<string, number>> = {
  'parent-child': 0,
  contains: 1,
  includes: 2,
}

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

  for (const r of relations) {
    const rank = PARENT_EDGE_RANK[r.type ?? '']
    if (rank === undefined) continue
    if (r.from === r.to) continue // a self-edge would root the node in itself

    const parent = byId.get(r.from)
    const child = byId.get(r.to)
    if (!parent || !child) continue

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
