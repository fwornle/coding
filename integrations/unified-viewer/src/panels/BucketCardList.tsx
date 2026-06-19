// PATTERN SOURCE: 56.1-PATTERNS.md §6 (BucketCardList NEW — clone HistorySidebar
//                  card rhythm at HistorySidebar.tsx:181-214 + onClick at :117-132)
//                  + §A (atomic multi-field store writes via setSelection)
//                  + §C (Logger discipline) + §D (Locked Contract #5)
// CONTRACT:       56.1-04-PLAN.md Task 1 <behavior> + <action> steps 1-6
//                 CONTEXT.md D-4 (sidebar visual: bucket-card list for multi-mode)
//                          + D-5 (drill collapse: card click → single-focal)
//                          + <discretion> #4 (selectionSource interpretation):
//                              - 'timeline' + selectedBucketKeys.size > 0 → cards
//                                from union of bucket entityIds (proxied via
//                                lslFilterEntityIds, populated by the timeline
//                                strip's plain-click cascade)
//                              - 'graph'    + selectedNodeIds.size > 1     → cards
//                                from selectedNodeIds (one card per multi-selected
//                                graph node; Plan 05 may upgrade to "buckets
//                                touching focal" when useNodeToBucketsIndex ships)
//
// Multi-mode sidebar — renders a History-style card list (cloned visual rhythm
// from HistorySidebar.tsx) when the selection slice is in multi-mode. The
// parent SidePanel.tsx owns the three-way mode-switch (BucketCardList /
// EntityDetailPanel / HistorySidebar) — this component renders an empty-state
// placeholder defensively when SidePanel mounts it in single-focal mode.
//
// Card click semantics (D-5 drill collapse):
//   - selectedNodeIds collapses to new Set([cardId])
//   - selectedBucketKeys empties (clears the timeline halo)
//   - focalNodeId becomes cardId
//   - selectionSource flips to 'history'
//   - LSL session-filter scope clears so the D3 graph stops narrowing to
//     the previous bucket's entities (audit-contract-#5 cascade-clear)
//
// All cross-pane writes route through the canonical `setSelection` store
// action — Locked Contract #5 (zero inline store setState calls on the
// production path; every cross-pane write funnels through setSelection).

import { useMemo } from 'react'
import type { ApiClient } from '@/api/ApiClient'
import type { System } from '@/config/system-endpoints'
import { useViewerStore } from '@/store/viewer-store'
import { useGraphData } from '@/graph/useGraphData'
import { useVisibleEntityIds } from '@/graph/useVisibleEntityIds'
import { Logger } from '@/lib/logging'

export interface BucketCardListProps {
  apiClient: ApiClient
  system: System
}

interface BucketCardItem {
  id: string
  name: string
  entityType: string
  source: 'auto' | 'manual'
  createdAt: string
  team: string
}

function formatRelativeTime(iso: string): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  // Mirror HistorySidebar.tsx:38-54 — use performance.timeOrigin so identity
  // stays stable across re-renders (Date.now() would mutate every render).
  const now = performance.timeOrigin + performance.now()
  const diffMs = now - t
  if (diffMs < 60_000) return 'just now'
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`
  if (diffMs < 30 * 86_400_000) return `${Math.floor(diffMs / 86_400_000)}d ago`
  return iso.slice(0, 10)
}

export function BucketCardList({ apiClient, system }: BucketCardListProps) {
  // apiClient + system feed both useGraphData (the entities source) and
  // useVisibleEntityIds (the Gap-D visible/hidden split below).
  const { entities } = useGraphData(apiClient, system)

  const selectedNodeIds = useViewerStore((s) => s.selectedNodeIds)
  const selectedBucketKeys = useViewerStore((s) => s.selectedBucketKeys)
  const selectionSource = useViewerStore((s) => s.selectionSource)
  const lslFilterEntityIds = useViewerStore((s) => s.lslFilterEntityIds)
  // Plan 60-08 Gap E — bidirectional hover. Row hover publishes to the store
  // (sidebar → graph pulse); a row whose id matches the store value gets a
  // highlight + (if the entity is filtered off-canvas) an inline hint.
  const hoveredNodeId = useViewerStore((s) => s.hoveredNodeId)
  const setHoveredNodeId = useViewerStore((s) => s.setHoveredNodeId)
  // focalNodeId is subscribed for future "buckets touching focal" wiring
  // (Plan 05 via useNodeToBucketsIndex). Subscribing now keeps the hook
  // dep list stable so a Wave-3 refactor doesn't add a new subscription
  // that surprises tests.
  const focalNodeId = useViewerStore((s) => s.focalNodeId)
  void focalNodeId

  // Mode-driven card items. The parent SidePanel mode-switch only mounts
  // this component when isMultiMode predicate holds; the defensive empty
  // branch here covers the (rare) case where the store flips between
  // render commits.
  const items: BucketCardItem[] = useMemo(() => {
    // Build the candidate id-set per CONTEXT.md <discretion> #4.
    let candidateIds: ReadonlySet<string> | null = null
    if (
      selectionSource === 'timeline'
      && selectedBucketKeys.size > 0
      && lslFilterEntityIds !== null
    ) {
      candidateIds = lslFilterEntityIds
    } else if (selectionSource === 'graph' && selectedNodeIds.size > 1) {
      candidateIds = selectedNodeIds
    }

    if (candidateIds === null || candidateIds.size === 0) return []

    const out: BucketCardItem[] = []
    for (const e of entities) {
      if (!candidateIds.has(e.id)) continue
      const meta = (e.metadata as Record<string, unknown> | undefined) ?? {}
      const created = (e.createdAt as string | undefined)
        ?? (meta.createdAt as string | undefined)
        ?? ''
      // Default missing source to 'auto' (mirror HistorySidebar.tsx:81-82
      // — Observations/Digests from claude-code sessions omit the field
      // but are auto-captured by definition).
      const rawSource = meta.source as string | undefined
      const source: 'auto' | 'manual' = rawSource === 'manual' ? 'manual' : 'auto'
      // entityType label: prefer the explicit `entityType` carried by the
      // entity (HistorySidebar uses the same field via the index signature
      // on the Entity type); fall back to ontologyClass when absent.
      const entityType =
        (e.entityType as string | undefined)
        ?? (e.ontologyClass as string | undefined)
        ?? 'Entity'
      out.push({
        id: e.id,
        name: (e.name as string) || '(unnamed)',
        entityType,
        source,
        createdAt: created,
        team: (meta.team as string | undefined) ?? 'general',
      })
    }
    // Newest first — same sort idiom as HistorySidebar.tsx:92.
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }, [
    entities,
    selectionSource,
    selectedBucketKeys,
    selectedNodeIds,
    lslFilterEntityIds,
  ])

  // Plan 60-08 Gap D — visible-vs-hidden split for the Selected header.
  // Reuses the SAME predicate the canvas uses (useVisibleEntityIds) so the
  // "visible" count matches the halo count exactly. The difference is what the
  // showDebugEntityTypes shield (Observation/Digest hard-exclusion) suppresses.
  const visibleIds = useVisibleEntityIds(apiClient, system)
  const visibleSelectedCount = useMemo(
    () => items.reduce((n, i) => n + (visibleIds.has(i.id) ? 1 : 0), 0),
    [items, visibleIds],
  )
  const hiddenSelectedCount = items.length - visibleSelectedCount

  // D-5 drill-collapse card click handler. Routes through the canonical
  // setSelection action (Locked Contract #5) so all selection invariants
  // (focal derivation, sameSetMembership reference-stability guard, LSL
  // cascade-clear) live in ONE place (the store).
  //
  // 2026-06-14 (Plan 06 gap-closure — Decision 1 selection-history stack):
  // pass `pushHistory: true` so the pre-drill Layer 1 state (the bucket
  // halo + card list the user was browsing) is captured. Esc / X then
  // restores it via popSelection() instead of dropping straight to Layer 0.
  //
  // 2026-06-14 (Plan 06 gap-closure — Decision 3 viewport preservation):
  // DO NOT write `lslFilterEntityIds: null` or `lslSessionFilter: []` on
  // drill. The pre-fix code cleared both, which broadened `visibleEntities`
  // from the bucket-filtered subset (~14 nodes) back to the full set
  // (~808 nodes) → main render fires (visibleEntities ref changed) → SVG
  // rebuild + force-simulation restart + auto-fit ⇒ "zoom all the way
  // out, fade everything, focal lost in the dim sea." Preserving the LSL
  // filter slice keeps visibleEntities reference-stable so the drill is
  // purely a selection-slice mutation: applySelectionStyling repaints
  // (focal red, halos fade out of selectedNodeIds, pathToSelected stays
  // bright) but the SVG / force simulation / viewport all stay put.
  const onCardClick = (id: string) => {
    useViewerStore.getState().setSelection({
      nodeIds: new Set<string>([id]),
      bucketKeys: new Set<string>(),
      focal: { nodeId: id, bucketKey: null },
      pathToSelected: new Set<string>(),
      highlightedRowKey: id,
      source: 'history',
      // lslSessionFilter / lslFilterEntityIds INTENTIONALLY OMITTED —
      // setSelection preserves them at the current value (Decision 3).
      pushHistory: true,
    })
    Logger.info(Logger.Categories.PANELS, `BucketCardList drill → ${id}`)
  }

  return (
    <div
      data-testid="bucket-card-list"
      className="h-full overflow-y-auto px-3 py-3"
    >
      <div className="mb-2">
        <h2 className="text-base font-semibold text-foreground">Selected</h2>
        <p className="text-xs text-muted-foreground mt-0.5" data-testid="selected-count">
          {items.length} item{items.length === 1 ? '' : 's'}
          {/* Plan 60-08 Gap D: when the canvas filters some selected entities
              out of the rendered set (Observation/Digest hidden by the
              showDebugEntityTypes shield), surface the split so the operator
              knows WHY the halo count is lower than the selected count.
              Suppressed when nothing is hidden (no noise on the clean path). */}
          {hiddenSelectedCount > 0 && (
            <>
              {' · '}{visibleSelectedCount} visible{' · '}
              {hiddenSelectedCount} hidden by{' '}
              <span className="font-medium">&quot;Show debug entity types&quot;</span>
            </>
          )}
        </p>
      </div>

      {items.length === 0 ? (
        <div className="text-xs text-muted-foreground italic mt-6 text-center">
          No cards to show.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                data-testid={`bucket-card-${item.id}`}
                data-hovered={hoveredNodeId === item.id ? 'true' : undefined}
                onClick={() => onCardClick(item.id)}
                onMouseEnter={() => setHoveredNodeId(item.id)}
                onMouseLeave={() => setHoveredNodeId(null)}
                className={`w-full text-left px-2.5 py-2 rounded border bg-card transition-colors ${
                  hoveredNodeId === item.id
                    ? 'border-primary bg-accent'
                    : 'border-border hover:bg-accent'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span
                    className="text-sm font-medium text-foreground truncate flex-1"
                    title={item.name}
                  >
                    {item.name}
                  </span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${
                      item.source === 'auto'
                        ? 'bg-pink-100 text-pink-800 dark:bg-pink-900/40 dark:text-pink-200'
                        : 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200'
                    }`}
                  >
                    {item.source === 'auto' ? 'Auto' : 'Manual'}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-1 text-[11px] text-muted-foreground">
                  <span>{item.entityType}</span>
                  <span>
                    {formatRelativeTime(item.createdAt)} · {item.team}
                  </span>
                </div>
                {/* Plan 60-08 Gap E: when the operator hovers a row whose entity
                    is filtered OFF the canvas, the graph can't reciprocate the
                    pulse — tell them why instead of leaving a dead hover. */}
                {hoveredNodeId === item.id && !visibleIds.has(item.id) && (
                  <div
                    data-testid={`bucket-card-hidden-hint-${item.id}`}
                    className="mt-1 text-[10px] text-amber-600 dark:text-amber-400"
                  >
                    hidden — toggle Show debug entity types to reveal
                  </div>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
