// PATTERN SOURCE: 45-RESEARCH.md Example 1 + 45-PATTERNS.md § events.ts
//
// Event handler factories for the SigmaCanvas. Extracted from the React
// component shell so the click / double-click / hover semantics are
// testable without spinning up sigma + WebGL.
//
// The component glues these via `useRegisterEvents()`:
//
//   const events = makeEventHandlers({ apiClient, graph, ontology, theme,
//                                       store: useViewerStore.getState })
//   registerEvents({
//     clickNode: ({ node }) => events.handleClickNode(node),
//     clickStage: () => events.handleClickStage(),
//     doubleClickNode: ({ node }) => events.handleDoubleClickNode(node),
//     enterNode: ({ node }) => events.handleEnterNode(node),
//     leaveNode: () => events.handleLeaveNode(),
//   })

import type Graph from 'graphology'
import type { Relation } from './types'
import type { ViewerState } from '@/store/viewer-store'

export interface EventHandlerDeps {
  graph: Graph
  /**
   * Returns the currently-loaded relation set — the ONLY source the
   * double-click expand reads. A getter so it stays fresh after refetches.
   *
   * 2026-09-26: no longer optional-in-spirit. It used to be threaded only by
   * the okb branch, because coding was believed to expand via a server fetch.
   * That endpoint does not exist on either backend, so both paths read this.
   */
  getLoadedRelations?: () => ReadonlyArray<Relation>
  /** Zustand store mutator — usually `useViewerStore.setState`. */
  setStore: (partial: Partial<ViewerState>) => void
  /** Hover-tracking state setter (local React state, not Zustand). */
  setHoveredNode: (id: string | null) => void
  /** Optional callback fired when expand-neighbors actually adds new nodes. */
  onGraphMutated?: (addedCount: number) => void
}

export interface EventHandlers {
  handleClickNode(nodeId: string): void
  handleClickStage(): void
  handleDoubleClickNode(nodeId: string): Promise<number>
  handleEnterNode(nodeId: string): void
  handleLeaveNode(): void
}

/**
 * Client-side 1-hop expand — the ONE expand path, for every backend.
 *
 * Phase 61-02 introduced this for okb alone, having found that OKM Express has
 * no neighbors endpoint (404 on every variant), and left coding on a server
 * fetch that was assumed to work. It does not: `/api/v1/entities/:id/neighbors`
 * is mounted by no backend — 404 from obs-api, absent from km-core's canonical
 * route list — and SigmaCanvas fires the handler as `void handle...(node)`, so
 * the rejection was unhandled and a double-click on coding did nothing at all,
 * silently. The two branches are now one.
 *
 * Reading the loaded set is not a fallback, it is the correct source: the
 * viewer loads the WHOLE graph up front (`?limit=1000000` — 2809 entities,
 * 18753 relations) and rebuilds wholesale when it changes, so a server round
 * trip could only ever return a subset of what is already in memory.
 *
 * "Expand" means: gather every loaded relation incident to
 * `nodeId`, collect the opposite endpoints as the 1-hop neighborhood, and drive
 * the same selection/highlight the server payload would (focal node + its
 * neighbors pinned as the selected set). This is a VISIBLE expansion of the
 * selection — never a silent no-op. When the loaded set has no incident edge
 * for the node, we still select the node alone so the click registers visibly.
 *
 * Returns the neighbor count (0 when the node has no neighbors in the loaded
 * set) so the caller's contract (Promise<number>) is preserved.
 */
function expandFromLoadedRelations(
  deps: EventHandlerDeps,
  nodeId: string,
): number {
  const loaded = deps.getLoadedRelations?.() ?? []
  const neighborIds = new Set<string>()
  for (const r of loaded) {
    if (r.from === nodeId) neighborIds.add(r.to)
    else if (r.to === nodeId) neighborIds.add(r.from)
  }
  // Only keep neighbors that actually exist as nodes in the loaded graph.
  const present = new Set<string>([nodeId])
  for (const id of neighborIds) {
    if (deps.graph.hasNode(id)) present.add(id)
  }
  deps.setStore({
    selectedNodeIds: present,
    focalNodeId: nodeId,
    pathToSelected: present,
  })
  const added = present.size - 1 // exclude the focal node itself
  if (added > 0) deps.onGraphMutated?.(added)
  return added
}

/**
 * Build a bundle of event handlers from explicit deps. Each handler is
 * a pure function over its closure — no module-scoped mutable state.
 */
export function makeEventHandlers(deps: EventHandlerDeps): EventHandlers {
  return {
    handleClickNode(nodeId: string) {
      // 2026-06-11: compute ancestry path back to a root via incoming
      // `contains` / `parent-child` edges and pin it on the store. The
      // reducer dims everything outside the path so the user sees the
      // hierarchy trace from the clicked node up to its System / Project
      // ancestor (VKB reference behaviour: "path from CollectiveKnowledge
      // (green) to project (dark blue), to component, sub-component
      // until the selected node").
      const path = new Set<string>([nodeId])
      const graph = deps.graph
      let cursor: string | null = nodeId
      // Cap traversal at 8 hops — defensive against accidental cycles in
      // the hierarchy data (a properly-modelled graph is at most 5 deep:
      // System → Project → Component → SubComponent → Detail).
      // 2026-06-11: traverse a broader set of "this node lives under that
      // parent" relations. `contains` and `parent-child` are the canonical
      // hierarchy edges; `capturedBy` is what ObservationWriter stamps on
      // every Observation/Digest/Insight pointing at LiveLoggingSystem;
      // `has_insight` is the symmetric edge from Components to their
      // Insight nodes. Without these, clicking an Observation / Insight
      // node finds no parent and the path stays at size 1 → no visible
      // trace.
      const HIERARCHY_REL: ReadonlySet<string> = new Set([
        'contains', 'parent-child', 'capturedBy', 'has_insight',
      ])
      for (let i = 0; cursor && i < 8; i++) {
        let parent: string | null = null
        try {
          graph.forEachInEdge(cursor, (_edgeId, attrs, source) => {
            if (parent) return
            const t = (attrs as { relationType?: string }).relationType
            if (t && HIERARCHY_REL.has(t)) parent = source
          })
        } catch {
          // Node missing — bail out cleanly.
          break
        }
        if (!parent || path.has(parent)) break
        path.add(parent)
        cursor = parent
      }
      // 2026-06-13 (Phase 56.1 Plan 05): the deleted Phase 56 single-selection
      // `selectedNodeId` field is replaced by the multi-set `selectedNodeIds`
      // + derived `focalNodeId`. Write both to keep the selection coherent.
      deps.setStore({
        selectedNodeIds: new Set<string>([nodeId]),
        focalNodeId: nodeId,
        pathToSelected: path,
      })
    },

    handleClickStage() {
      deps.setStore({
        selectedNodeIds: new Set<string>(),
        focalNodeId: null,
        pathToSelected: new Set<string>(),
      })
    },

    // Idempotent by construction (Pitfall T-45-02-04): the expand derives a
    // selection set from the loaded relations, so re-clicking the same node
    // recomputes the same set rather than accumulating anything.
    //
    // Still `async` returning Promise<number>: SigmaCanvas calls it as
    // `void handlers.handleDoubleClickNode(node)` and the signature is part of
    // the EventHandlers contract. It no longer awaits anything.
    async handleDoubleClickNode(nodeId: string): Promise<number> {
      return expandFromLoadedRelations(deps, nodeId)
    },

    handleEnterNode(nodeId: string) {
      deps.setHoveredNode(nodeId)
    },

    handleLeaveNode() {
      deps.setHoveredNode(null)
    },
  }
}
