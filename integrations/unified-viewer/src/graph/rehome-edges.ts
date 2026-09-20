// Re-homing: keep a rendered node attached when its real parent is filtered out.
//
// THE PROBLEM
//
// The structural-anchor invariant guarantees every knowledge row has a parent
// IN THE DATA (health coordinator's graph_integrity slice enforces it, and it
// reads 0 orphans). That is not the same as being attached in a FILTERED VIEW.
// Hiding an intermediate level strands everything below it:
//
//   Component          visible
//     SubComponent     HIDDEN by "Collapse sub-components"
//       Detail         visible — and now floating
//
// Measured on the condensed default view: 181 nodes, 7 of them with no visible
// neighbour. Six were Details whose only `contains` parent was a collapsed
// SubComponent; the seventh was a Project whose every child had been archived
// by the roll-up. Every one of them was correctly anchored in the data.
//
// THE RULE
//
// A collapse should RE-PARENT what it hides, not strand it. When a node's
// structural parent is not rendered, walk up the hierarchy until a rendered
// ancestor is found and draw the edge there instead. That is what "collapse"
// means everywhere else: the children of a folded branch attach to the fold.
//
// Synthetic edges are marked `synthetic: true` and typed `contains` so they
// render as the containment they stand for, and so nothing downstream has to
// learn a new edge type to lay them out.

export interface RehomeNode {
  id: string
  ontologyClass?: string
}

export interface RehomeEdge {
  from: string
  to: string
  type: string
  synthetic: true
  /** The real parent this edge stands in for — useful in a tooltip, and it
   *  makes the substitution auditable rather than invisible. */
  rehomedFrom: string
}

/**
 * @param visibleIds        ids currently rendered
 * @param connectedIds      ids that already have at least one DRAWN edge
 * @param hierarchyParents  child id → parent id (graph/hierarchy-parents)
 * @returns one synthetic edge per stranded node that has a visible ancestor.
 *   A node with no visible ancestor gets nothing — there is no honest edge to
 *   draw, and inventing one would misstate the hierarchy.
 */
export function buildRehomeEdges(
  visibleIds: ReadonlySet<string>,
  connectedIds: ReadonlySet<string>,
  hierarchyParents: ReadonlyMap<string, string>,
): RehomeEdge[] {
  const out: RehomeEdge[] = []
  for (const id of visibleIds) {
    if (connectedIds.has(id)) continue

    const realParent = hierarchyParents.get(id)
    if (realParent === undefined) continue // nothing claims it — leave it honest

    // Walk up until a rendered ancestor appears. `seen` guards the cycle that
    // a DAG-derived parent map can still produce: deriveParents picks one
    // parent per node but does not prove the result is acyclic, and an
    // unguarded walk would hang the render rather than drop one edge.
    const seen = new Set<string>([id])
    let cursor: string | undefined = realParent
    while (cursor !== undefined && !seen.has(cursor)) {
      if (visibleIds.has(cursor)) {
        out.push({ from: cursor, to: id, type: 'contains', synthetic: true, rehomedFrom: realParent })
        break
      }
      seen.add(cursor)
      cursor = hierarchyParents.get(cursor)
    }
  }
  return out
}
