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

// 2026-06-13 (Phase 56-04 round 4 — phantom-id resolution).
//
// The D3 graph in the Coding tab deliberately filters
// Observation/Digest/Detail-level entities out of the rendered set
// (D3GraphCanvas.tsx `visibleEntities` useMemo). The LSL timeline strip
// generates ticks whose `entityIds[]` are almost always Detail-level
// (per `scripts/observations-api-server.mjs` TYPE_RANK sort), so the
// strip's `onTickClick` would have written a `selectedNodeId` that does
// not match any rendered D3 node — a phantom id. The cascade then:
//
//   1. applySelectionStyling found no `.node` with `.id === phantom` →
//      no red ring rendered
//   2. The trace LINE between the phantom Detail and its visible
//      ancestor couldn't render because the Detail isn't a D3 node
//   3. The sidebar showed the phantom Detail's text — disagreeing with
//      the highlighted-via-pathToSelected node in the graph
//
// Operator decision (2026-06-13, post 4th smoke): resolve to the closest
// graph-visible ancestor in `onTickClick`. The bucket's entities[] is
// walked, and each entity's ancestry is walked, until a graph-visible
// entity is found. That ancestor's id becomes `selectedNodeId`. Sidebar
// shows the ancestor's text. Bucket's raw entities still feed
// `lslFilterEntityIds` for the LSL fade (a separate concern from the
// graph selection target).
//
// Locked in 56-PATTERNS.md contract #6. Predicate:
//   visibleIds.has(resolvedId) MUST be true for any non-null
//   selectedNodeId write originating outside D3GraphCanvas.

/**
 * Resolve an entity id to the closest graph-visible ancestor.
 *
 *  - If `entityId` is itself in `visibleIds`, return it unchanged.
 *  - Otherwise walk the hierarchy (parents-of-entityId, parents-of-parents,
 *    …) and return the FIRST ancestor encountered that is in `visibleIds`.
 *    "First" here means closest-to-the-entity — `computeAncestryPath`'s
 *    `nodeDepths` map iterates in BFS-insertion order, so the closer the
 *    ancestor sits to the original entity, the earlier it appears.
 *  - If no ancestor (and not the entity itself) is in `visibleIds`,
 *    return `null`.
 *
 * Uses `computeAncestryPath` for the walk so the predicate of "what
 * counts as an ancestor" stays identical to the trace-rendering code
 * (HIERARCHY_TYPES edge subset).
 */
export function resolveToVisibleAncestor(
  entityId: string,
  visibleIds: ReadonlySet<string>,
  relations: readonly Relation[],
): string | null {
  if (visibleIds.has(entityId)) return entityId
  const path = computeAncestryPath(entityId, relations)
  // `nodeDepths` is keyed by entity id. The selected entity is depth 0;
  // its immediate parent is depth 1; grandparent is depth 2; and so on.
  // BFS-insertion order keeps the iteration deepest-first-after-self,
  // so the first id we hit (after skipping the entity itself) that is
  // in the visible set is the closest visible ancestor.
  for (const ancestorId of path.nodeDepths.keys()) {
    if (ancestorId === entityId) continue
    if (visibleIds.has(ancestorId)) return ancestorId
  }
  return null
}

/**
 * Walk a bucket's `entityIds[]` and return the first id (or its closest
 * visible ancestor) that lands in the graph's visible set.
 *
 *  - For each id in `entityIds`, calls `resolveToVisibleAncestor`.
 *  - Returns the FIRST non-null resolution.
 *  - Returns `null` when no id in the bucket has any visible ancestor —
 *    the sidebar-only mode the timeline strip uses to render the bucket
 *    selection without a graph target.
 */
export function pickFirstResolvable(
  entityIds: readonly string[],
  visibleIds: ReadonlySet<string>,
  relations: readonly Relation[],
): string | null {
  for (const id of entityIds) {
    const resolved = resolveToVisibleAncestor(id, visibleIds, relations)
    if (resolved !== null) return resolved
  }
  return null
}
