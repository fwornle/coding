// PATTERN SOURCE: 45-PATTERNS.md § SidePanel.tsx, AMENDED by 55-01-PLAN.md Task 2
// AMENDED again by 55-09-PLAN.md Task 3 — width harmonization (UI-SPEC §11)
//
// CONTRACT: 45-UI-SPEC.md § Layout Contract row 4
//   - default w-96; expands to w-[30rem] on the harmonized predicate:
//       (tab === 'markdown' && entity.metadata.markdown_url)
//       || (entity.description.length > 800)
//       || (tab === 'entity' && subTab is 'evolution' or 'timeline')
//   - Transition: transition-[width] duration-150 (UI-SPEC §11)
//   - Entity tab always present; Markdown only on system='okb'
//   - Phase 55 D-55-01b: cap system dropped → side-panel tab inventory is
//     entity + (markdown when okb).
//
// Width state subscribes to selectedNodeId + the entity payload via
// useGraphData so we don't need to plumb a callback through EntityDetailPanel.
// The subTab axis lives LOCALLY in EntityDetailPanel (UI-SPEC §8); the only
// observable signal we have at the SidePanel level for evolution/timeline is
// the entity's metadata — when descriptionSegments or occurrences>1 is true,
// the user is likely on Evolution/Timeline. We approximate by treating
// "entity has expansion-eligible metadata" + "Entity tab active" as the
// trigger (UI-SPEC §11 accepts this approximation per the "OR" predicate —
// a sufficient condition is enough).

import { useMemo, useState } from 'react'
import type { ApiClient } from '@/api/ApiClient'
import type { System } from '@/config/system-endpoints'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useGraphData } from '@/graph/useGraphData'
import { useViewerStore } from '@/store/viewer-store'
import { BucketCardList } from './BucketCardList'
import { EntityDetailPanel } from './EntityDetailPanel'
import { HistorySidebar } from './HistorySidebar'
import { MarkdownViewerPanel } from './MarkdownViewerPanel'
import { Logger } from '@/lib/logging'

export interface SidePanelProps {
  apiClient: ApiClient
  system: System
}

type TabValue = 'entity' | 'markdown'

export function SidePanel({ apiClient, system }: SidePanelProps) {
  const [tab, setTab] = useState<TabValue>('entity')
  const { entities } = useGraphData(apiClient, system)
  // Phase 56.1: subscription migrated from selectedNodeId → focalNodeId
  // (Plan 01 deleted the scalar field; focal is the derived "currently in
  // detail" id). Multi-mode subscriptions added for the three-way
  // mode-switch predicate below.
  const focalNodeId = useViewerStore((s) => s.focalNodeId)
  const selectedNodeIds = useViewerStore((s) => s.selectedNodeIds)
  const selectedBucketKeys = useViewerStore((s) => s.selectedBucketKeys)
  // 2026-06-19 (Gap F): the mode predicate must agree with BucketCardList's
  // OWN candidate-resolution conditions, which key off selectionSource +
  // lslFilterEntityIds — otherwise a single graph-drilled node (which carries
  // a non-empty selectedBucketKeys as a *timeline halo*, not a card selection)
  // lands in BucketCardList with zero resolvable candidates → "0 items".
  const selectionSource = useViewerStore((s) => s.selectionSource)
  const lslFilterEntityIds = useViewerStore((s) => s.lslFilterEntityIds)

  const showMarkdown = system === 'okb'

  const entity = useMemo(() => {
    if (!focalNodeId) return null
    return entities.find((e) => e.id === focalNodeId) ?? null
  }, [entities, focalNodeId])

  // Phase 56.1 mode-switch predicate (CONTEXT.md <specifics> + D-4):
  //   - isSingleFocalMode: exactly one node selected AND no timeline-bucket
  //                  halo → EntityDetailPanel for the focal entity. Held
  //                  by: card-click drill from Layer 1 (BucketCardList.
  //                  onCardClick clears bucketKeys), halo-node-click drill
  //                  (D3GraphCanvas writes single-id nodeIds + empty bucketKeys),
  //                  AND auto-drill from a single-resolution tick (Plan 06
  //                  gap-closure 2026-06-14 — LslTimelineStrip.onTickClick
  //                  writes `source: 'history' + bucketKeys: empty` when
  //                  `resolvedNodeIds.size === 1` post-LLS-suppression).
  //                  This restores the original predicate `size === 1 &&
  //                  bucketKeys.size === 0` that the (now-removed) UX
  //                  shortcut over-broadened. Operator decision 2026-06-14:
  //                  "I want the list of selections in the sidebar (so...
  //                  revert!), but if there is only one card in the
  //                  selection, then go straight to the content."
  //   - isMultiMode: more than one node selected OR a multi-bucket halo →
  //                  BucketCardList renders cards for the active set.
  //                  Covers multi-resolution timeline ticks (source=
  //                  'timeline', bucketKeys populated, size>=2) AND
  //                  multi-node graph selection. Sidebar-only buckets
  //                  (size===0 resolutions) also flow here so the operator
  //                  sees SOMETHING for the bucket-only selection.
  //   - Otherwise (no selection): HistorySidebar default.
  // 2026-06-19 (Gap F fix): isMultiMode must match the EXACT conditions
  // BucketCardList uses to build its card items (BucketCardList.tsx:100-108):
  //   - timeline source with a populated lslFilterEntityIds set, OR
  //   - graph source with MORE THAN ONE selected node.
  // Keying off `selectedBucketKeys.size > 0` (the old rule) wrongly routed a
  // single graph-drilled node — which carries a non-empty selectedBucketKeys as
  // a timeline halo — into an empty BucketCardList ("0 items / No cards to
  // show"). The node is focal, so it must render its EntityDetailPanel instead.
  const isMultiMode =
    (selectionSource === 'timeline'
      && selectedBucketKeys.size > 0
      && lslFilterEntityIds !== null
      && lslFilterEntityIds.size > 0)
    || (selectionSource === 'graph' && selectedNodeIds.size > 1)
  const isSingleFocalMode =
    !isMultiMode && (selectedNodeIds.size === 1 || focalNodeId !== null)

  // Width predicate per UI-SPEC §11 (verbatim from 55-09-PLAN <interfaces>).
  const widthClass = useMemo(() => {
    if (!entity) return 'w-96'
    const metadata = (entity.metadata as Record<string, unknown> | undefined) ?? {}
    const markdownUrl = (metadata.markdown_url as string | undefined) ?? null
    const description = (entity.description as string | undefined) ?? ''
    const descriptionSegments =
      (metadata.descriptionSegments as unknown[] | undefined) ?? []
    const occurrences = (metadata.occurrences as unknown[] | undefined) ?? []
    if (tab === 'markdown' && markdownUrl) return 'w-[30rem]'
    if (description.length > 800) return 'w-[30rem]'
    if (
      tab === 'entity' &&
      (descriptionSegments.length > 0 || occurrences.length > 0)
    ) {
      // Approximates "Evolution/Timeline sub-tab likely active" — sub-tab
      // state itself is local to EntityDetailPanel (UI-SPEC §8), but this
      // predicate-level overlap is the UI-SPEC §11 approximation contract.
      return 'w-[30rem]'
    }
    return 'w-96'
  }, [tab, entity])

  return (
    <aside
      data-testid="viewer-side-panel"
      className={`${widthClass} bg-card border-l border-border overflow-y-auto transition-[width] duration-150`}
    >
      <Tabs
        value={tab}
        onValueChange={(next) => {
          // Defensive: narrow whatever Radix hands us back to a known TabValue.
          // The UI cannot produce 'rca' (no trigger renders one), but a
          // future regression would silently render unknown content if we
          // skipped this guard.
          if (next === 'entity' || next === 'markdown') {
            setTab(next)
            Logger.info(Logger.Categories.PANELS, `SidePanel tab → ${next}`)
          } else {
            Logger.warn(Logger.Categories.PANELS, `Unknown SidePanel tab "${next}" — ignored`)
          }
        }}
        className="h-full"
      >
        <div className="flex items-center justify-between m-2">
          <TabsList data-testid="side-panel-tabs-list">
            <TabsTrigger value="entity" data-testid="tab-entity">
              Entity
            </TabsTrigger>
            {showMarkdown && (
              <TabsTrigger value="markdown" data-testid="tab-markdown">
                Markdown
              </TabsTrigger>
            )}
          </TabsList>
          {/* 2026-06-11: close button — VKB has one + ESC. ESC alone isn't
              discoverable. Routes through the canonical store action
              (Locked Contract #5: no inline store setState outside the store).
              2026-06-14 (Plan 06 gap-closure — Decision 1 selection-history
              stack): X is a one-step-back action (mirrors Esc). From Layer 2
              (drill / EntityDetailPanel mounted via this branch when
              `entity` resolves) it pops to Layer 1 — the pre-drill
              multi-set (halo nodes + bucket card list) is restored. From
              Layer 1 (no drill, `selectionHistory === null`) it falls
              through to `clearSelection()` so X still reaches Layer 0 in
              one extra click. */}
          {entity && (
            <button
              type="button"
              onClick={() => {
                // 2026-06-14 (WR-05 fix — 56.1-REVIEW): popSelection now
                // ONLY pops (no internal fallthrough to clearSelection).
                // Gate the clearSelection fallback here so the X button
                // still reaches Layer 0 from the no-history case.
                const store = useViewerStore.getState()
                const popped = store.popSelection()
                if (!popped) store.clearSelection()
              }}
              className="h-7 w-7 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground flex items-center justify-center"
              aria-label="Close details panel"
              data-testid="side-panel-close"
            >
              <span aria-hidden className="text-base leading-none">×</span>
            </button>
          )}
        </div>

        <TabsContent value="entity" className="px-4 pb-4">
          {/* Phase 56.1 D-4 three-way mode-switch (CONTEXT.md <specifics>):
              - isMultiMode (selectedBucketKeys>0 OR selectedNodeIds>1):
                BucketCardList shows the card list for the active
                selection set (timeline-bucket entities OR multi-selected
                graph nodes — bucket-driven content branch wired by
                Plan 05's useNodeToBucketsIndex when that hook ships).
              - isSingleFocalMode (single node, no buckets): the existing
                EntityDetailPanel renders the focal entity's detail view.
              - Otherwise (no selection): HistorySidebar default —
                preserves the 2026-06-11 VKB-style empty-state feed. */}
          {isMultiMode ? (
            <BucketCardList apiClient={apiClient} system={system} />
          ) : isSingleFocalMode && entity ? (
            <EntityDetailPanel apiClient={apiClient} system={system} />
          ) : (
            <HistorySidebar apiClient={apiClient} system={system} />
          )}
        </TabsContent>

        {showMarkdown && (
          <TabsContent value="markdown" className="px-4 pb-4 h-[calc(100vh-8rem)]">
            <MarkdownViewerPanel apiClient={apiClient} system={system} />
          </TabsContent>
        )}
      </Tabs>
    </aside>
  )
}
