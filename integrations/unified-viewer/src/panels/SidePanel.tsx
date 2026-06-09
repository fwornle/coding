// PATTERN SOURCE: 45-PATTERNS.md § SidePanel.tsx, AMENDED by 55-01-PLAN.md Task 2
// CONTRACT: 45-UI-SPEC.md § Layout Contract row 4
//   - default w-96; w-[30rem] when Markdown tab is active
//   - Entity tab always present; Markdown only on system='okb'
//   - Phase 55 D-55-01b: cap system dropped → side-panel tab inventory is
//     entity + (markdown when okb). The RCA tab and its panel are gone.

import { useState } from 'react'
import type { ApiClient } from '@/api/ApiClient'
import type { System } from '@/config/system-endpoints'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EntityDetailPanel } from './EntityDetailPanel'
import { MarkdownViewerPanel } from './MarkdownViewerPanel'
import { Logger } from '@/lib/logging'

export interface SidePanelProps {
  apiClient: ApiClient
  system: System
}

type TabValue = 'entity' | 'markdown'

export function SidePanel({ apiClient, system }: SidePanelProps) {
  const [tab, setTab] = useState<TabValue>('entity')

  const showMarkdown = system === 'okb'

  // Width contract — w-96 default, w-[30rem] when Markdown active.
  const widthClass = tab === 'markdown' && showMarkdown ? 'w-[30rem]' : 'w-96'

  return (
    <aside
      data-testid="viewer-side-panel"
      className={`${widthClass} bg-card border-l border-border overflow-y-auto`}
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
        <TabsList className="m-2" data-testid="side-panel-tabs-list">
          <TabsTrigger value="entity" data-testid="tab-entity">
            Entity
          </TabsTrigger>
          {showMarkdown && (
            <TabsTrigger value="markdown" data-testid="tab-markdown">
              Markdown
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="entity" className="px-4 pb-4">
          <EntityDetailPanel apiClient={apiClient} system={system} />
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
