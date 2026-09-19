// Single source of truth for "is this entity on the canvas right now?".
//
// Three consumers need that answer and all three used to compute it
// themselves — each subscribing to the same eleven store fields, each
// assembling the same `VisibilityFilters` literal by hand:
//
//   1. D3GraphCanvas.visibleEntities  — the graph itself (the authority)
//   2. UnifiedViewer.visibleCount     — the "Showing N of M nodes" footer
//   3. useVisibleEntityIds            — the LSL strip, bucket list, and the
//                                       nodeToBuckets reverse index
//
// Three hand-built copies of one rule set is three chances to drift, and
// they did drift. The footer had diverged in five ways (see the
// UnifiedViewer note) and this hook in a sixth: it never applied
// `hiddenNodeTypes`, so switching an ontologyClass off in the legend
// removed it from the graph while the strip and the bucket list carried on
// resolving clicks to nodes that were no longer rendered.
//
// The fix is structural rather than another copy of the guard: the store
// reads and the filter literal live here once, `hiddenNodeTypes` moved
// INSIDE `VisibilityFilters` (so it cannot be omitted by a call site that
// forgets to append `&& !hidden.has(...)`), and every consumer takes the
// same `isVisible` callback.
//
// Reference stability — load-bearing, not incidental. D3GraphCanvas's
// `visibleEntities` memo must keep its reference across identical-content
// writes or the force simulation restarts and the viewport jumps (PATTERNS
// Locked Contract #3, gates G9/G13). `isVisible` is memoised on the same
// eleven fields the canvas memo used to list directly, so it changes
// exactly when they change — the canvas recomputes on precisely the same
// cadence as before, no more and no less.

import { useMemo } from 'react'

import { useViewerStore } from '@/store/viewer-store'
import type { Entity } from './types'
import { isEntityVisible } from './visibility-predicate'

export type VisibilityPredicate = (e: Entity) => boolean

/**
 * Returns the predicate the D3 canvas renders by, bound to the current
 * filter state. Callers pass entities; nobody passes filters.
 */
export function useGraphVisibility(): VisibilityPredicate {
  const selectedTeams = useViewerStore((s) => s.selectedTeams)
  const visibleLevels = useViewerStore((s) => s.visibleLevels)
  const selectedClasses = useViewerStore((s) => s.selectedClasses)
  const searchQuery = useViewerStore((s) => s.searchQuery)
  const learningSource = useViewerStore((s) => s.learningSource)
  const selectedLayers = useViewerStore((s) => s.selectedLayers)
  const hideDocNodes = useViewerStore((s) => s.hideDocNodes)
  const hideArchived = useViewerStore((s) => s.hideArchived)
  const lslFilterEntityIds = useViewerStore((s) => s.lslFilterEntityIds)
  // Phase 60 Plan 03 (G3 — D-09..D-11): when ON, the predicate skips the
  // Observation/Digest hard-exclusion branch so those types re-appear.
  // Default OFF (architecture-bleed shield).
  const showDebugEntityTypes = useViewerStore((s) => s.showDebugEntityTypes)
  const hiddenNodeTypes = useViewerStore((s) => s.hiddenNodeTypes)
  // Aggregates-only: roll-up parents + architecture backbone. See the
  // VisibilityFilters doc for why no existing filter could express this.
  const aggregatesOnly = useViewerStore((s) => s.aggregatesOnly)
  // SubComponent collapse — the rule needs a parent lookup the predicate
  // cannot do itself, so the resolved map rides along with the flags.
  const collapseSubComponents = useViewerStore((s) => s.collapseSubComponents)
  const expandedComponentIds = useViewerStore((s) => s.expandedComponentIds)
  const hierarchyParents = useViewerStore((s) => s.hierarchyParents)

  return useMemo<VisibilityPredicate>(() => {
    const filters = {
      searchQueryLowered: searchQuery.trim().toLowerCase(),
      selectedTeams,
      learningSource,
      selectedLayers,
      hideDocNodes,
      hideArchived,
      selectedClasses,
      visibleLevels,
      lslFilterEntityIds,
      showDebugEntityTypes,
      hiddenNodeTypes,
      aggregatesOnly,
      collapseSubComponents,
      expandedComponentIds,
      hierarchyParents,
    }
    return (e: Entity) => isEntityVisible(e, filters)
  }, [
    selectedTeams,
    visibleLevels,
    selectedClasses,
    searchQuery,
    learningSource,
    selectedLayers,
    hideDocNodes,
    hideArchived,
    lslFilterEntityIds,
    showDebugEntityTypes,
    hiddenNodeTypes,
    aggregatesOnly,
    collapseSubComponents,
    expandedComponentIds,
    hierarchyParents,
  ])
}
