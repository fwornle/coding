// PATTERN SOURCE: 45-02-PLAN.md <interfaces> block (verbatim port)
//
// Graph-domain types for the SigmaCanvas + useGraphData pipeline.
//
// These shapes match the Plan 01 ApiClient surface
// (integrations/unified-viewer/src/api/ApiClient.ts) but are re-exported
// here under the `graph/` namespace so renderer modules don't reach
// across into `api/`. Keeping them duplicated-but-aligned is the price
// for keeping graph/ dependency-free for fast vitest runs.

export interface Entity {
  id: string
  name: string
  ontologyClass: string
  level?: 0 | 1 | 2 | 3
  description?: string
  metadata?: Record<string, unknown>
}

export interface Relation {
  from: string
  to: string
  type: string
}

export interface OntologyClass {
  name: string
  level?: number
  parent?: string
  display?: {
    color?: string
    icon?: string
    shape?: 'circle' | 'square' | 'diamond'
  }
}

export interface NeighborhoodPayload {
  entities: Entity[]
  relations: Relation[]
}

/**
 * Per-node render state — drives the nodeReducer overlay table in
 * UI-SPEC § Color State color overlays (lines 142-152).
 */
export type NodeState =
  | 'default'
  | 'hover'
  | 'selected'
  | 'search-match'
  | 'filter-dimmed'
  | 'filter-hidden'
