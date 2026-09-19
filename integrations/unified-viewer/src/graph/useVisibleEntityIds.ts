// Phase 56 Plan 04 round 4 — graph-visible entity-id hook.
//
// Purpose: the D3 graph filters Observations/Digests/Details out of the
// rendered set. The LSL timeline strip needs to know which entity ids the
// graph WOULD render so its `onTickClick` handler can resolve bucket
// entities to the closest graph-visible ancestor (round-4 phantom-id fix).
//
// This hook returns the ids of the entities the D3 canvas renders, as a
// `ReadonlySet<string>`. It does NOT decide visibility itself: it calls
// `useGraphVisibility()`, the same bound predicate D3GraphCanvas filters
// with, so "what the strip thinks is on screen" and "what is on screen"
// are the same computation rather than two that agree by maintenance.
//
// It used to build the `VisibilityFilters` literal itself, and that copy
// had drifted: it omitted `hiddenNodeTypes`. Switching an ontologyClass
// off in the legend removed those nodes from the canvas while this hook
// kept reporting them visible, so `onTickClick` resolved bucket entities
// to ancestors that were no longer rendered — the phantom-id class of bug
// this hook exists to prevent, reintroduced through the back door.
//
// Why this still returns ids rather than reusing the canvas's array:
//   - D3GraphCanvas.visibleEntities returns `Entity[]` for D3 data binding
//     and must stay reference-stable across identical-content writes or the
//     force simulation restarts and the viewport jumps (PATTERNS Locked
//     Contract #3, gates G9/G13). Sharing that array would couple this
//     consumer's reference stability to the canvas's.
//   - The strip only needs the id Set. Deriving it in a separate memo off
//     the SHARED predicate gives both the same rules and each its own
//     independent reference stability.
//
// Contract:
//   useVisibleEntityIds(apiClient, system): ReadonlySet<string>
//     - Visibility decided by useGraphVisibility() — identical to the canvas
//     - Returns a Set of entity ids the D3 graph WOULD render
//     - Reference-stable across renders with identical content (cheap to
//       use as a dep)

import { useMemo } from 'react'

import type { ApiClient } from '@/api/ApiClient'
import type { System } from '@/config/system-endpoints'
import { useGraphData } from './useGraphData'
import { useGraphVisibility } from './useGraphVisibility'

export function useVisibleEntityIds(apiClient: ApiClient, system: System): ReadonlySet<string> {
  const { entities } = useGraphData(apiClient, system)
  const isVisible = useGraphVisibility()

  return useMemo<ReadonlySet<string>>(() => {
    const ids = new Set<string>()
    for (const e of entities) {
      if (isVisible(e)) ids.add(e.id)
    }
    return ids
  }, [entities, isVisible])
}
