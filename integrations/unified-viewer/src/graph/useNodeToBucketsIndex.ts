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
import { NOISE_ANCESTOR_NAMES, pickAllResolvable } from './ancestry'
import { useLslSessions } from '@/panels/coding/useLslSessions'
import { Logger } from '@/lib/logging'

/**
 * Reverse-lookup map: graph node id → Set of `${bucket.id}|${bucket.startAt}`
 * composite keys for every bucket that touches the node.
 *
 * A bucket "touches" a node iff `pickAllResolvable(bucket.entityIds, visibleIds,
 * relations)` includes the node id (i.e. at least one of the bucket's raw
 * entities resolves up the hierarchy to the node).
 *
 * 2026-06-14 (Plan 06 gap-closure — Decision C / Q3 LLS-suppression
 * consistency): the reverse index applies the SAME LLS-suppression rule as
 * `LslTimelineStrip.onTickClick`. Operator decision Q3 explicitly: "I also
 * want to see the noisy selection on the timeline (consistency between
 * graph selection and timeline ticks)" — but the consistency runs THROUGH
 * the suppression rule, not around it. After suppression: LLS-only buckets
 * (~49 of 75 in the seed) STILL resolve to {LLS} because suppression only
 * fires when size >= 2 (preserves the focal). Multi-resolution buckets
 * drop LLS from the reverse index, so graph-click on LLS lights up ONLY
 * the ticks where LLS was the SOLE resolution (still ~49 buckets). Ticks
 * where LLS was incidental noise alongside e.g. an Insight stop lighting
 * up — preventing LLS-on-graph-click from highlighting the ENTIRE timeline.
 *
 * The strip computes its `noiseAncestors` Set via name lookup against
 * `entities` (Decision Q2 — name-based for robustness across seed
 * regenerations). This hook needs the same Set to keep the suppression
 * predicate identical. Rather than recomputing it here (which would
 * duplicate the LLS-id derivation and risk drift), we accept it via the
 * existing `useGraphData` entities — name lookup stays local.
 */
export function useNodeToBucketsIndex(
  apiClient: ApiClient,
  system: System,
): ReadonlyMap<string, ReadonlySet<string>> {
  const visibleIds = useVisibleEntityIds(apiClient, system)
  const { entities, relations } = useGraphData(apiClient, system)
  const { data: sessions } = useLslSessions(apiClient)

  // Memoised LLS-id Set — name-based (Q2). Identical derivation idiom to
  // `LslTimelineStrip.tsx noiseAncestors` so the two callsites of
  // pickAllResolvable see the same suppression set. Re-deriving here
  // rather than passing through props keeps the contract local to each
  // pickAllResolvable callsite per PATTERNS Contract #7 (no cross-callsite
  // coupling).
  //
  // 2026-06-14 (WR-02 fix — 56.1-REVIEW): the name list is imported from
  // `NOISE_ANCESTOR_NAMES` (a single source of truth) so an ontology
  // rename can't silently leave this site in lock-step with the strip's
  // (formerly literal) `'LiveLoggingSystem'` check. Observability: if the
  // derived set comes out empty when `entities.length > 0`, emit a
  // Logger.warn — that's the canary for "name lookup matched nothing".
  const noiseAncestors = useMemo<ReadonlySet<string>>(() => {
    const out = new Set<string>()
    for (const e of entities) {
      if (NOISE_ANCESTOR_NAMES.has(e.name)) out.add(e.id)
    }
    if (entities.length > 0 && out.size === 0) {
      Logger.warn(
        Logger.Categories.PANELS,
        `useNodeToBucketsIndex: noiseAncestors empty — NOISE_ANCESTOR_NAMES did not match any entity (entities.length=${entities.length}). Suspect an ontology rename.`,
      )
    }
    return out
  }, [entities])

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
      const touched = pickAllResolvable(
        bucket.entityIds ?? [],
        visibleIds,
        relations,
        noiseAncestors,
      )
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
  }, [sessions, visibleIds, relations, noiseAncestors])
}
