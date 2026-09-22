// Resolving a clicked hierarchy row to the set of entities the canvas should
// keep.
//
// WHY A MODULE AND NOT A PREDICATE RULE
//
// `isEntityVisible` is handed one entity and knows nothing about edges, so it
// cannot answer "is this row under the row I clicked". Every other filter in
// that file is a property test on the entity itself; this one is a reachability
// question over the hierarchy. The same split the LSL session filter already
// makes — the producer resolves ids, the predicate does a membership test —
// applies here, and for the same reason.
//
// WHAT A SUBTREE MEANS, AND WHY THE ANCESTORS COME TOO
//
// The members are the clicked row, everything under it, AND the code-tree
// ancestors of every one of those. Descendants alone would answer "what is
// under this row", but they would land on the canvas as a detached island: the
// edges that explain where the branch sits would all point at nodes that had
// just been filtered out. Walking up re-attaches the branch to the spine it
// came from, which costs a handful of structural nodes and is the difference
// between a focused view and a floating fragment.
//
// THAT ONE RULE COVERS BOTH SPINES
//
// For the code tree the ancestor walk adds the chain above the clicked row and
// nothing else (a descendant's ancestors are already inside the subtree).
//
// For the intent tree it is what makes the filter mean anything at all: an
// Intent's children are Insights, and an Insight's parent chain is its CODE
// placement. So "show me this goal" resolves to the goal, the lessons that
// served it, and the parts of the code they were learned in — which is the
// same join the intent row already names in its evidence subtitle, followed
// through to the canvas instead of only described in the rail.

/** Structurally minimal tree row — satisfied by both spines' node types. */
export interface SubtreeNode {
  id: string
  children: readonly SubtreeNode[]
}

/**
 * The entity ids a subtree filter rooted at `node` should admit.
 *
 * @param node    the clicked row, with its children already built
 * @param parents child id → parent id, the SAME map the canvas lays out by
 *                (`hierarchyParents` in the store). An empty map degrades the
 *                result to "the subtree, unanchored" rather than failing.
 */
export function resolveSubtreeMembers(
  node: SubtreeNode,
  parents: ReadonlyMap<string, string>,
): Set<string> {
  const members = new Set<string>()

  // Descend. Guarded against a cycle for the same reason deriveParents is: this
  // runs on a click, and a writer that emitted a both-ways `contains` would
  // freeze the tab rather than misdraw it.
  const stack: SubtreeNode[] = [node]
  const walked = new Set<string>()
  while (stack.length > 0) {
    const cur = stack.pop()!
    if (walked.has(cur.id)) continue
    walked.add(cur.id)
    members.add(cur.id)
    for (const child of cur.children) stack.push(child)
  }

  // Ascend from every member, so the branch stays attached to its spine.
  for (const id of [...members]) {
    const seen = new Set<string>([id])
    let cursor = parents.get(id)
    while (cursor !== undefined && !seen.has(cursor)) {
      seen.add(cursor)
      members.add(cursor)
      cursor = parents.get(cursor)
    }
  }

  return members
}
