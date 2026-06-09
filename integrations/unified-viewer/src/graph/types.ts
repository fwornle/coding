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
  // Phase 39 DATA-02 provenance + identity fields (Plan 44-16 camelCase lock).
  // Marked optional + present in the index signature because pre-Phase-39
  // entities don't carry them.
  parent?: string
  createdAt?: string
  createdBy?: string
  confirmationCount?: number
  lastConfirmedAt?: string
  lastConfirmedBy?: string
  lastSegment?: string
  /** Index signature lets the EntityDetailPanel Raw section render any
   *  additional server-side fields without a TS-strict break. */
  [k: string]: unknown
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
    // Plan 55-05 (UI-SPEC §14): extended shape union from 3 → 5 values.
    // 'triangle' + 'hexagon' added for RuntimeDiagnostics + Project/System/Feature.
    shape?: 'circle' | 'square' | 'diamond' | 'triangle' | 'hexagon'
    // Plan 55-05 (UI-SPEC §14): NEW. Defaults to 'solid'; 'dashed' means
    // "render with a dash pattern" (orphan-on-current-view OR overlay opt-in).
    borderStyle?: 'solid' | 'dashed'
    // Plan 55-05 (UI-SPEC §14): NEW. Per-class pulse expression. Null
    // means no pulse. Evaluated per-entity by evaluatePulseRule.
    pulseRule?: string | null
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
