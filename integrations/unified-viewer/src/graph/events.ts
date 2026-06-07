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
import type { ApiClient } from '@/api/ApiClient'
import type { Entity, OntologyClass, Relation } from './types'
import type { ViewerState } from '@/store/viewer-store'
import { mergeIntoGraph } from './graph-builder'

export interface EventHandlerDeps {
  apiClient: Pick<ApiClient, 'getNeighbors'>
  graph: Graph
  /** Returns the ontology list (kept as a getter so it can be fresh after queries refetch). */
  getOntology: () => ReadonlyArray<OntologyClass>
  /** Returns the current theme (light|dark) — read at fire time, not bound at construction. */
  getTheme: () => 'light' | 'dark'
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

function isValidLevel(n: number | undefined): n is 0 | 1 | 2 | 3 {
  return n === 0 || n === 1 || n === 2 || n === 3
}

/**
 * Build a bundle of event handlers from explicit deps. Each handler is
 * a pure function over its closure — no module-scoped mutable state.
 */
export function makeEventHandlers(deps: EventHandlerDeps): EventHandlers {
  return {
    handleClickNode(nodeId: string) {
      deps.setStore({ selectedNodeId: nodeId })
    },

    handleClickStage() {
      deps.setStore({ selectedNodeId: null })
    },

    async handleDoubleClickNode(nodeId: string): Promise<number> {
      // Pitfall T-45-02-04: re-clicking the same node must be idempotent.
      // mergeIntoGraph uses Graphology's merge ops — no-ops on existing ids.
      const payload = await deps.apiClient.getNeighbors(nodeId, 1)
      // Coerce ApiClient.Entity (where `level?: number`) into graph-domain
      // Entity (where `level?: 0|1|2|3`). Only values 0..3 carry meaning;
      // anything else is dropped to undefined.
      const entities: Entity[] = (payload.neighbors ?? []).map((e) => ({
        id: e.id,
        name: e.name,
        ontologyClass: e.ontologyClass,
        description: e.description ?? undefined,
        level: isValidLevel(e.level) ? e.level : undefined,
      }))
      const relations: Relation[] = (payload.relations ?? []).map((r) => ({
        from: r.from,
        to: r.to,
        type: r.type ?? 'related',
      }))
      const added = mergeIntoGraph(
        deps.graph,
        { entities, relations },
        deps.getOntology(),
        deps.getTheme(),
      )
      if (added > 0) deps.onGraphMutated?.(added)
      return added
    },

    handleEnterNode(nodeId: string) {
      deps.setHoveredNode(nodeId)
    },

    handleLeaveNode() {
      deps.setHoveredNode(null)
    },
  }
}
