// PATTERN SOURCE: 56.1-05-PLAN.md Task 1 steps 2-3 + 56.1-PATTERNS.md §3
//   + useVisibleEntityIds.ts (scaffold: store/data subscriptions + useMemo)
//
// Phase 56.1 Plan 05 — reverse-lookup pre-index for graph node →
// touching buckets. Per CONTEXT.md D-3, clicking a graph node must light
// up every bucket whose entityIds resolve (via pickAllResolvable) to that
// node. Instead of scanning all buckets on each click, we pre-build the
// reverse map once per data-load and read from it in O(1) inside the
// graph click handler.
//
// Rebuild triggers (useMemo dep list):
//   - sessions (initial fetch or refetch from useLslSessions)
//   - visibleIds (filter changes — class / level / layer / learningSource)
//   - relations (graph refetch from useGraphData)
//
// Memory budget (CONTEXT.md D-3): ~50 visible nodes × ~3 touching buckets
// per node = ~150 entries, well under 1MB. Even at ~1000 visible nodes
// with deep ancestry we stay in O(sessions × ancestry-depth) per rebuild
// — sessions stay cached so rebuilds are rare.
//
// PATTERNS Locked Contract #7 (pre-index integrity) — this hook is one
// of the only TWO non-test callsites of `pickAllResolvable` (the other is
// LslTimelineStrip.onTickClick forward direction). Any third callsite from
// inside a click handler is a smell. Acceptance grep documented in
// 56.1-05-PLAN.md `<verify>` block.

import { useMemo } from 'react'

import type { ApiClient } from '@/api/ApiClient'
import type { System } from '@/config/system-endpoints'
import { useGraphData } from './useGraphData'
import { useVisibleEntityIds } from './useVisibleEntityIds'
import { pickAllResolvable } from './ancestry'
import { useLslSessions } from '@/panels/coding/useLslSessions'

/**
 * Reverse-lookup map: graph node id → Set of `${bucket.id}|${bucket.startAt}`
 * composite keys for every bucket that touches the node.
 *
 * A bucket "touches" a node iff `pickAllResolvable(bucket.entityIds, visibleIds,
 * relations)` includes the node id (i.e. at least one of the bucket's raw
 * entities resolves up the hierarchy to the node).
 */
export function useNodeToBucketsIndex(
  apiClient: ApiClient,
  system: System,
): ReadonlyMap<string, ReadonlySet<string>> {
  const visibleIds = useVisibleEntityIds(apiClient, system)
  const { relations } = useGraphData(apiClient, system)
  const { data: sessions } = useLslSessions(apiClient)

  // PATTERNS Locked Contract #7: this useMemo body is the ONLY callsite of
  // pickAllResolvable inside this hook. The forward-direction click handler
  // in LslTimelineStrip is the only other legal caller (D-2 exception). Any
  // additional call from inside a click handler would re-walk every bucket's
  // ancestry on every click — the regression the pre-index exists to prevent.
  return useMemo<ReadonlyMap<string, ReadonlySet<string>>>(() => {
    const map = new Map<string, Set<string>>()
    const list = sessions ?? []
    for (const bucket of list) {
      if (typeof bucket.startAt !== 'string') continue
      const bucketKey = `${bucket.id}|${bucket.startAt}`
      const touched = pickAllResolvable(bucket.entityIds ?? [], visibleIds, relations)
      for (const nodeId of touched) {
        let existing = map.get(nodeId)
        if (!existing) {
          existing = new Set<string>()
          map.set(nodeId, existing)
        }
        existing.add(bucketKey)
      }
    }
    return map
  }, [sessions, visibleIds, relations])
}
