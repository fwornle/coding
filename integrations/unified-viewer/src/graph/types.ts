// PATTERN SOURCE: 45-02-PLAN.md <interfaces> block (verbatim port)
//
// Graph-domain types for the SigmaCanvas + useGraphData pipeline.
//
// These shapes match the Plan 01 ApiClient surface
// (integrations/unified-viewer/src/api/ApiClient.ts) but are re-exported
// here under the `graph/` namespace so renderer modules don't reach
// across into `api/`. Keeping them duplicated-but-aligned is the price
// for keeping graph/ dependency-free for fast vitest runs.

/**
 * What `/api/v1/entities` actually sends.
 *
 * MIRRORS km-core's `EntityWireSchema` (lib/km-core/src/api/contracts.ts:157) —
 * nine keys, and provenance lives INSIDE `metadata.provenance`. That is not an
 * accident of the serializer: `entityToWire()`
 * (lib/km-core/src/adapters/wire-serializers.ts:68) strips every other
 * top-level field and FOLDS a top-level `createdBy` into `metadata.provenance`.
 * contracts.ts:148-153 states the contract in so many words.
 *
 * WHY THIS IS WRITTEN OUT RATHER THAN LOOSE. Until 2026-09-26 this interface
 * declared seven fields the wire has never carried — `level`, `parent`,
 * `createdBy`, `confirmationCount`, `lastConfirmedAt`, `lastConfirmedBy`,
 * `lastSegment` — and omitted three it does. Four separate defects shipped on
 * the strength of it: the identity header and IDENTITY block printed `—` for
 * every row, `mergeIntoGraph` stamped `level: undefined` and the renderer hid
 * everything it added, the Provenance block printed `—` for 96% of rows whose
 * provenance was sitting in `metadata`, and `last confirmed` was `—` on every
 * entity in both side panels. None of them could produce an error anywhere.
 *
 * THE INDEX SIGNATURE IS DELIBERATELY ABSENT. `[k: string]: unknown` used to
 * sit here "so the Raw section can render additional server-side fields", and
 * it is what made all four defects typecheck: with it, `entity.anythingAtAll`
 * is legal. The Raw section reads `metadata`, which is already an open record,
 * so the signature bought nothing the type did not already have — it only
 * disabled the compiler on the one shape that most needed it. A genuinely
 * untyped read should cast at its own call site and say why, rather than
 * reopening this type for every reader.
 */
export interface Entity {
  id: string
  name: string
  entityType?: string
  ontologyClass: string
  layer?: 'evidence' | 'pattern'
  description?: string
  createdAt?: string
  updatedAt?: string
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
