// PATTERN SOURCE: D3GraphCanvas.tsx lines 62-126 (original location).
//
// 2026-06-13 (Phase 56-04): extracted from D3GraphCanvas.tsx so the
// timeline-strip can reuse the same ancestry-path computation when its
// onTickClick handler resolves a focal entity. Without this shared
// helper, the strip would either (a) duplicate the BFS code (drift risk
// the moment HIERARCHY_TYPES gets a new edge type) or (b) write
// `pathToSelected: new Set()` and break the central-trace render — the
// AC #2 partial-success regression the operator caught in the Phase 56
// visual smoke.
//
// Contract: ID-only walk over the hierarchy edge subset. Returns the
// edge set in both directions ("A||B" + "B||A" for cheap d3-link tests),
// the depth map (selected → 0, immediate parent → 1, …) and the chain
// length. When the selected node has no parent chain at all, we fall
// back to a 1-hop neighborhood walk so the visual trace still has
// SOMETHING to highlight (orphan Insight / Detail case).
//
// HIERARCHY_TYPES is exported for tests + the strip + the graph's
// inline reference at line 68 — we re-export it from the original
// inline location for source-grep compatibility.

import type { Relation } from './types'

export interface AncestryPathResult {
  /** Edge keys in both directions ("A||B" and "B||A") to match either-direction d3 links. */
  edges: Set<string>
  nodeDepths: Map<string, number>
  pathLength: number
}

export const HIERARCHY_TYPES: ReadonlySet<string> = new Set([
  'contains', 'includes', 'parent-child', 'has_insight', 'capturedBy',
])

/** ID-only ancestry walk (no name aliasing — IDs are canonical in km-core). */
export function computeAncestryPath(
  selectedId: string,
  relations: readonly Relation[],
): AncestryPathResult {
  const edges = new Set<string>()
  const nodeDepths = new Map<string, number>()
  const childToParents = new Map<string, string[]>()
  for (const r of relations) {
    if (!HIERARCHY_TYPES.has(r.type)) continue
    const list = childToParents.get(r.to) ?? []
    list.push(r.from)
    childToParents.set(r.to, list)
  }
  const visited = new Set<string>([selectedId])
  const queue: string[] = [selectedId]
  const parentOf = new Map<string, string>()
  while (queue.length) {
    const cur = queue.shift() as string
    const parents = childToParents.get(cur) ?? []
    for (const p of parents) {
      if (visited.has(p)) continue
      visited.add(p)
      if (!parentOf.has(cur)) parentOf.set(cur, p)
      queue.push(p)
    }
  }
  let node = selectedId
  let depth = 0
  nodeDepths.set(node, depth)
  while (parentOf.has(node)) {
    const parent = parentOf.get(node) as string
    edges.add(`${parent}||${node}`)
    edges.add(`${node}||${parent}`)
    depth++
    nodeDepths.set(parent, depth)
    node = parent
  }
  // 2026-06-12: when the selected node has NO ancestor chain via the
  // HIERARCHY_TYPES (orphan Detail / floating Insight), fall back to a
  // 1-hop neighborhood so the user still sees connected nodes/edges
  // highlighted. Without this, history-sidebar selection on an orphan
  // node leaves the graph looking unchanged — the red ring is on a tiny
  // dot and every neighbor stays at full opacity (`pathLength === 0`
  // forced opacity=1 for the selected node and 0.12 for everyone else,
  // so no "trace" was visible). Walks BOTH directions across ALL
  // relation types — this is purely a visual aid, not semantic ancestry.
  if (depth === 0) {
    for (const r of relations) {
      if (r.from === selectedId) {
        edges.add(`${r.from}||${r.to}`)
        edges.add(`${r.to}||${r.from}`)
        if (!nodeDepths.has(r.to)) nodeDepths.set(r.to, 1)
      } else if (r.to === selectedId) {
        edges.add(`${r.from}||${r.to}`)
        edges.add(`${r.to}||${r.from}`)
        if (!nodeDepths.has(r.from)) nodeDepths.set(r.from, 1)
      }
    }
    if (nodeDepths.size > 1) depth = 1
  }
  return { edges, nodeDepths, pathLength: depth }
}
