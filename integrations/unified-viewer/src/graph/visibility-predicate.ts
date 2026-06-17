// Phase 56 Plan 04 round 4 — pure visibility predicate.
//
// Extracted from D3GraphCanvas.tsx `visibleEntities` useMemo body
// (lines 244-337) so the predicate can be shared between the D3 canvas
// and the new `useVisibleEntityIds` hook (the LSL strip's source of truth
// for round-4 phantom-id resolution).
//
// Behaviour is bit-identical to the prior inline predicate. Tests:
//   - D3GraphCanvas test gates G1-G5 + G9-G13 (source-grep) continue to
//     pass — D3GraphCanvas still computes its `visibleEntities` memo via
//     this predicate; the dep list shape is preserved.
//   - Round-4 RED tests T-F/T-G/T-H (LslTimelineStrip.test.tsx) drive
//     the strip's onTickClick path through `useVisibleEntityIds`, which
//     calls this predicate.

import type { Entity } from './types'
import { deriveLayer } from './layer'

export interface VisibilityFilters {
  /** Already-lowercased search query for case-insensitive substring match. */
  searchQueryLowered: string
  selectedTeams: ReadonlySet<string>
  learningSource: 'combined' | 'online' | 'batch' | string
  selectedLayers: readonly string[]
  hideDocNodes: boolean
  selectedClasses: ReadonlySet<string>
  visibleLevels: ReadonlySet<0 | 1 | 2 | 3>
  lslFilterEntityIds: ReadonlySet<string> | null
  /**
   * Phase 60 Plan 01 (G1): ontology registry (subset shape — `name` +
   * extends-chain `parent`) consumed by `deriveLayer` for L2 inference.
   * Optional so existing call sites compile until the registry is threaded
   * through (`useVisibleEntityIds`, `D3GraphCanvas.visibleEntities`,
   * `LayerFilter`). When undefined, `deriveLayer` falls back to the
   * direct-class rule (Pattern/Insight → pattern) — same behaviour as the
   * pre-Phase-60 inline rule.
   */
  ontologyRegistry?: readonly { name: string; parent?: string | null }[]
  /**
   * Phase 60 Plan 03 (G3) — D-09..D-11: when `true`, the predicate skips the
   * Observation/Digest hard-exclusion branch so operators can debug those
   * types in the rendered graph. Default `false` (architecture-bleed shield
   * ON). Required field (no `?`) per checker W-2: forces every call site to
   * pass the flag explicitly so the project-wide `tsc --noEmit` gate surfaces
   * any half-deployed site that could otherwise leak Observation/Digest.
   *
   * The predicate body reads `filters.showDebugEntityTypes !== true` (not a
   * direct boolean check). That intentional `!== true` means a runtime
   * `undefined` (e.g., a partial mock in a test, or a transient store-init
   * race) still causes the exclusion to fire — the safer default for a
   * security-shaped shield.
   */
  showDebugEntityTypes: boolean
}

/**
 * Returns true when the entity should render in the D3 graph (and in
 * any consumer that wants the SAME predicate the D3 canvas uses).
 *
 * Mirror of `D3GraphCanvas.tsx:244-337` — see comments there for the
 * rationale of each filter step (structural-exemption rules for teams /
 * learningSource / LSL filter, the `[Raw]` stub exclusion, the
 * Observation/Digest hard exclusion gated by `filters.showDebugEntityTypes`
 * — Phase 60 Plan 03 — layer inference fallback, etc.).
 *
 * Phase 60 Plan 03 (G3 — D-09..D-11): the Observation/Digest hard-exclusion
 * is the default architecture-bleed shield. Operators can flip
 * `filters.showDebugEntityTypes = true` (wired via `GraphToggles`) to
 * unhide those types. The flag is read defensively (`!== true`) so an
 * undefined runtime value behaves identically to false.
 */
export function isEntityVisible(e: Entity, filters: VisibilityFilters): boolean {
  // Hide raw-stub placeholders (LLM-failure transcript rows).
  if (typeof e.name === 'string' && e.name.startsWith('[Raw]')) return false

  // Phase 60 Plan 03 (G3 — D-09..D-11): Hide raw stream rows
  // (Observation / Digest) UNLESS the operator has flipped the
  // showDebugEntityTypes shield. The classifier may have re-labeled the
  // entity as ontologyClass=Detail, so we check the canonical `entityType`
  // field here.
  //
  // Defensive `!== true` comparison (per checker W-2): even though the
  // field is typed as required, a runtime `undefined` (partial mock in a
  // test, transient store-init race) must still cause the exclusion to
  // fire — the safer default for a security-shaped shield.
  if (filters.showDebugEntityTypes !== true) {
    const etype = (e as unknown as { entityType?: string }).entityType
    if (etype === 'Observation' || etype === 'Digest') return false
  }

  const meta = (e.metadata as {
    team?: string
    source?: string
    layer?: string
    doc?: boolean
  } | undefined) ?? {}

  // Teams predicate — structural backbone (System/Project/Component) exempt.
  if (filters.selectedTeams.size > 0) {
    if (filters.selectedTeams.has('__none__')) return false
    const ocls = e.ontologyClass
    const isStructural = ocls === 'System' || ocls === 'Project' || ocls === 'Component'
    if (!isStructural) {
      const team = meta.team ?? 'coding'
      if (!filters.selectedTeams.has(team)) return false
    }
  }

  // Learning Source predicate — structural backbone exempt.
  if (filters.learningSource && filters.learningSource !== 'combined') {
    const ocls = e.ontologyClass
    const isStructural = ocls === 'System' || ocls === 'Project' || ocls === 'Component'
    if (!isStructural) {
      const isAuto = meta.source === 'auto' || meta.source === 'online'
      if (filters.learningSource === 'online' && !isAuto) return false
      if (filters.learningSource === 'batch' && isAuto) return false
    }
  }

  // Layer predicate — empty array = "all visible", `__none__` = "none visible".
  if (filters.selectedLayers.includes('__none__')) return false
  if (filters.selectedLayers.length > 0) {
    // Phase 60 Plan 01 (G1): single source of truth — `deriveLayer` resolves
    // the layer literal via the D-03 → D-02 precedence chain (explicit
    // metadata wins, else ontology extends-walk, else evidence). The
    // pre-Phase-60 inline rule lived here; see `layer.ts` for the helper.
    const inferred = deriveLayer(
      e as unknown as { ontologyClass?: string; metadata?: { layer?: string }; layer?: string },
      filters.ontologyRegistry,
    )
    if (!filters.selectedLayers.includes(inferred)) return false
  }

  // Doc-nodes hide toggle.
  if (filters.hideDocNodes) {
    const isDoc = (meta as { doc?: boolean }).doc === true
      || e.ontologyClass === 'Documentation'
    if (isDoc) return false
  }

  // Class predicate (empty Set = nothing visible).
  const cls = e.ontologyClass as string | undefined
  if (typeof cls !== 'string' || !filters.selectedClasses.has(cls)) return false

  // Level predicate.
  const lvl = e.level as 0 | 1 | 2 | 3 | undefined
  if (typeof lvl === 'number' && !filters.visibleLevels.has(lvl)) return false

  // Text filter (substring over name + description, lower-cased).
  if (filters.searchQueryLowered.length > 0) {
    const name = (e.name ?? '').toLowerCase()
    const desc = ((e as unknown as { description?: string }).description ?? '').toLowerCase()
    if (!name.includes(filters.searchQueryLowered) && !desc.includes(filters.searchQueryLowered)) {
      return false
    }
  }

  // LSL session filter — structural backbone exempt so anchors stay visible.
  if (filters.lslFilterEntityIds && filters.lslFilterEntityIds.size > 0) {
    const ocls = e.ontologyClass
    const isStructural = ocls === 'System' || ocls === 'Project' || ocls === 'Component'
    if (!isStructural && !filters.lslFilterEntityIds.has(e.id)) return false
  }

  return true
}
