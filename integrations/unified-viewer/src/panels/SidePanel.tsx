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
  const selectedNodeId = useViewerStore((s) => s.selectedNodeId)

  const showMarkdown = system === 'okb'

  const entity = useMemo(() => {
    if (!selectedNodeId) return null
    return entities.find((e) => e.id === selectedNodeId) ?? null
  }, [entities, selectedNodeId])

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
              discoverable. Clicking clears selection AND ancestry path so
              the dim-overlay drops too. */}
          {entity && (
            <button
              type="button"
              onClick={() => {
                useViewerStore.setState({ selectedNodeId: null, pathToSelected: new Set() })
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
          {/* 2026-06-11: when no node is selected the SidePanel shows the
              VKB-style History feed instead of EntityDetailPanel's empty
              state. Mirrors integrations/memory-visualizer's
              HistorySidebar contract. */}
          {entity ? (
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
