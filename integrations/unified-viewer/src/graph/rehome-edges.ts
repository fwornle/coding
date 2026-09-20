// Re-homing: keep every rendered node reachable when the filters cut its link.
//
// THE PROBLEM
//
// The structural-anchor invariant guarantees every row has a parent IN THE
// DATA (the health coordinator's graph_integrity slice enforces it and reads 0
// orphans). That is not the same as being attached in a FILTERED VIEW. Hiding
// an intermediate level detaches everything below it:
//
//   Component          visible
//     SubComponent     HIDDEN by "Collapse sub-components"
//       Detail         visible — and now floating
//
// THREE THINGS THIS HAD TO LEARN, EACH FROM A MEASUREMENT
//
//  1. Per-node "has a drawn edge?" is not enough. A PAIR referencing only each
//     other (CopiIntegration <-> CopiCliWrapper) has degree 1 apiece and still
//     floats. Work on connected COMPONENTS, not nodes.
//
//  2. `deriveParents` is the wrong input. It maps a child to ONE parent, only
//     across {parent-child, contains, includes}, and only when BOTH ends are
//     hierarchy classes. Four strays had no entry in it at all, because the
//     edge that anchors them is `has_insight` from their Project — a
//     structural anchor the invariant explicitly counts and that map ignores.
//
//  3. Walking one chain dead-ends. Three more strays had a parent whose own
//     chain was entirely hidden, so a single-parent walk found nothing while a
//     perfectly good Project anchor sat one edge away on a different branch.
//
// So this walks the REAL structural edges — the same set the invariant is
// stated over — breadth-first and multi-parent, and attaches at the nearest
// visible node outside the component. Nothing is invented: every synthetic
// edge stands for a real chain of containment that the filters interrupted.

/** The structural edge types — the same set the anchor invariant is stated
 *  over (lib/knowledge/structural-anchors.mjs). Provenance is NOT here: those
 *  edges are hidden by default and say nothing about containment. */
export const ANCHOR_EDGE_TYPES: ReadonlySet<string> = new Set([
  'contains', 'parent-child', 'includes', 'has_insight',
])

export interface RehomeEdgeInput {
  from: string
  to: string
  type?: string
}

export interface RehomeEdge {
  from: string
  to: string
  type: string
  synthetic: true
  /** How many anchor hops were skipped to reach a visible ancestor. 1 means
   *  the real parent was simply hidden; more means a chain was. Keeps the
   *  substitution auditable rather than invisible. */
  hops: number
}

/**
 * @param visibleIds   ids currently rendered
 * @param drawnEdges   the REAL edges rendered between them (defines components)
 * @param anchorEdges  ALL structural edges, hidden endpoints included — this
 *                     is the ladder out of a stray component
 * @returns one synthetic edge per stray component. A component with no visible
 *   anchor anywhere above it gets nothing: there is no honest edge to draw,
 *   and inventing one would misstate the hierarchy.
 */
export function buildRehomeEdges(
  visibleIds: ReadonlySet<string>,
  drawnEdges: readonly RehomeEdgeInput[],
  anchorEdges: readonly RehomeEdgeInput[],
): RehomeEdge[] {
  if (visibleIds.size === 0) return []

  // ── 1. Connected components of the rendered subgraph ────────────────────
  const adjacency = new Map<string, string[]>()
  for (const id of visibleIds) adjacency.set(id, [])
  for (const e of drawnEdges) {
    const a = adjacency.get(e.from)
    const b = adjacency.get(e.to)
    if (a === undefined || b === undefined) continue // edge to a hidden node
    a.push(e.to)
    b.push(e.from)
  }

  const componentOf = new Map<string, number>()
  const components: string[][] = []
  for (const start of visibleIds) {
    if (componentOf.has(start)) continue
    const index = components.length
    const members: string[] = []
    const stack = [start]
    componentOf.set(start, index)
    while (stack.length > 0) {
      const node = stack.pop() as string
      members.push(node)
      for (const next of adjacency.get(node) ?? []) {
        if (componentOf.has(next)) continue
        componentOf.set(next, index)
        stack.push(next)
      }
    }
    components.push(members)
  }
  if (components.length <= 1) return []

  // ── 2. Upward index: node -> the things that structurally contain it ────
  const anchorsOf = new Map<string, string[]>()
  for (const e of anchorEdges) {
    if (e.type !== undefined && !ANCHOR_EDGE_TYPES.has(e.type)) continue
    if (e.from === e.to) continue
    const list = anchorsOf.get(e.to)
    if (list === undefined) anchorsOf.set(e.to, [e.from])
    else list.push(e.from)
  }

  // ── 3. The main component is what everything else attaches to ───────────
  // Ranked by: contains a hierarchy ROOT (a node nothing contains), then size,
  // then lowest member id.
  //
  // Size alone is not enough. Two components of equal size tie, and breaking
  // that alphabetically can elect an ISLAND as the main one and leave the
  // component holding the actual root as the stray — which then has nothing
  // above it to attach to, so nothing is emitted and both stay adrift.
  // Preferring the component with a root settles it the way the hierarchy
  // means it. The id is the last resort, so the choice is stable across
  // renders instead of dependent on iteration order.
  const hasRoot = (members: readonly string[]) =>
    members.some((m) => (anchorsOf.get(m)?.length ?? 0) === 0)
  let mainIndex = 0
  for (let i = 1; i < components.length; i += 1) {
    const a = components[i]
    const b = components[mainIndex]
    const rootDelta = Number(hasRoot(a)) - Number(hasRoot(b))
    const better = rootDelta > 0
      || (rootDelta === 0 && a.length > b.length)
      || (rootDelta === 0 && a.length === b.length && minId(a) < minId(b))
    if (better) mainIndex = i
  }

  // ── 4. Attach each stray at its NEAREST visible external anchor ─────────
  const out: RehomeEdge[] = []
  for (let i = 0; i < components.length; i += 1) {
    if (i === mainIndex) continue
    const memberSet = new Set(components[i])

    // Breadth-first upward from every member at once, so the first hit is the
    // shortest real chain out of the component — attaching at the closest true
    // containment rather than whichever member happened to be visited first.
    const seen = new Set<string>(memberSet)
    let frontier: { node: string; origin: string; hops: number }[] =
      [...memberSet].sort().map((m) => ({ node: m, origin: m, hops: 0 }))
    let attached: RehomeEdge | null = null

    while (frontier.length > 0 && attached === null) {
      const next: typeof frontier = []
      for (const { node, origin, hops } of frontier) {
        for (const parent of (anchorsOf.get(node) ?? []).slice().sort()) {
          if (seen.has(parent)) continue
          if (visibleIds.has(parent)) {
            attached = { from: parent, to: origin, type: 'contains', synthetic: true, hops: hops + 1 }
            break
          }
          seen.add(parent)
          next.push({ node: parent, origin, hops: hops + 1 })
        }
        if (attached !== null) break
      }
      frontier = next
    }
    if (attached !== null) out.push(attached)
  }
  // Stable output: components are discovered in visibleIds iteration order,
  // which a Set does not promise to keep across renders. Sorting by the node
  // being re-homed makes the result depend on the graph, not on traversal.
  out.sort((a, b) => (a.to < b.to ? -1 : a.to > b.to ? 1 : 0))
  return out
}

function minId(ids: readonly string[]): string {
  let min = ids[0]
  for (const id of ids) if (id < min) min = id
  return min
}
