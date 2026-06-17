// Phase 56 Plan 04 round 4 — graph-visible entity-id hook.
//
// Purpose: the D3 graph filters Observations/Digests/Details out of the
// rendered set. The LSL timeline strip needs to know which entity ids the
// graph WOULD render so its `onTickClick` handler can resolve bucket
// entities to the closest graph-visible ancestor (round-4 phantom-id fix).
//
// This hook computes the SAME filter the D3GraphCanvas `visibleEntities`
// useMemo computes (D3GraphCanvas.tsx:244-337), expressed as a pure
// predicate, and returns the result as a `ReadonlySet<string>` of ids.
// Co-locating the predicate here lets future consumers (sidebar deep-link,
// search-jump-to-node, etc.) reuse it without duplicating the filter
// chain.
//
// Why not lift the existing memo in D3GraphCanvas verbatim:
//   - The existing memo returns `Entity[]` (used downstream for D3 data
//     binding). The strip only needs the Set<string> of ids.
//   - The D3 memo's dep list has 10 inputs; sharing the array directly
//     means dragging all those subscriptions into the strip.
//   - The audit-locked contract (PATTERNS.md #3 viewport stability)
//     requires `visibleEntities` to be reference-stable on identical-
//     content writes. Splitting the predicate into a pure function lets
//     us derive a NEW memo here without coupling reference stability
//     across consumers — each useMemo independently preserves its own
//     reference on identical-content writes.
//
// Contract:
//   useVisibleEntityIds(apiClient, system): ReadonlySet<string>
//     - Reads the same store fields as D3GraphCanvas.visibleEntities
//     - Returns a Set of entity ids the D3 graph WOULD render
//     - Reference-stable across renders with identical content (cheap to
//       use as a dep)

import { useMemo } from 'react'

import type { ApiClient } from '@/api/ApiClient'
import type { System } from '@/config/system-endpoints'
import { useViewerStore } from '@/store/viewer-store'
import { useGraphData } from './useGraphData'
import { isEntityVisible } from './visibility-predicate'

export function useVisibleEntityIds(apiClient: ApiClient, system: System): ReadonlySet<string> {
  const { entities } = useGraphData(apiClient, system)
  const selectedTeams = useViewerStore((s) => s.selectedTeams)
  const visibleLevels = useViewerStore((s) => s.visibleLevels)
  const selectedClasses = useViewerStore((s) => s.selectedClasses)
  const searchQuery = useViewerStore((s) => s.searchQuery)
  const learningSource = useViewerStore((s) => s.learningSource)
  const selectedLayers = useViewerStore((s) => s.selectedLayers)
  const hideDocNodes = useViewerStore((s) => s.hideDocNodes)
  const lslFilterEntityIds = useViewerStore((s) => s.lslFilterEntityIds)
  // Phase 60 Plan 03 (G3 — D-09..D-11): when ON, the predicate skips the
  // Observation/Digest hard-exclusion branch so those types re-appear in
  // the graph. Default OFF (architecture-bleed shield).
  const showDebugEntityTypes = useViewerStore((s) => s.showDebugEntityTypes)

  return useMemo<ReadonlySet<string>>(() => {
    const ids = new Set<string>()
    const q = searchQuery.trim().toLowerCase()
    for (const e of entities) {
      if (isEntityVisible(e, {
        searchQueryLowered: q,
        selectedTeams,
        learningSource,
        selectedLayers,
        hideDocNodes,
        selectedClasses,
        visibleLevels,
        lslFilterEntityIds,
        showDebugEntityTypes,
      })) {
        ids.add(e.id)
      }
    }
    return ids
  }, [
    entities,
    selectedTeams,
    visibleLevels,
    selectedClasses,
    searchQuery,
    learningSource,
    selectedLayers,
    hideDocNodes,
    lslFilterEntityIds,
    showDebugEntityTypes,
  ])
}
