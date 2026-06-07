// PATTERN SOURCE: 45-PATTERNS.md § SidePanel.tsx
// CONTRACT: 45-UI-SPEC.md § Layout Contract row 4
//   - default w-96; w-[30rem] when Markdown OR RCA tab is active
//   - Entity tab always present; Markdown only on system='okb'; RCA only on system='cap'
//   - Plan 03 wires the SHELL; Plan 04 ports MarkdownViewer; Plan 05 ports RCA panel.

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

type TabValue = 'entity' | 'markdown' | 'rca'

export function SidePanel({ apiClient, system }: SidePanelProps) {
  const [tab, setTab] = useState<TabValue>('entity')

  const showMarkdown = system === 'okb'
  const showRca = system === 'cap'

  // Width contract — w-96 default, w-[30rem] when Markdown or RCA active.
  const widthClass =
    (tab === 'markdown' && showMarkdown) || (tab === 'rca' && showRca)
      ? 'w-[30rem]'
      : 'w-96'

  return (
    <aside
      data-testid="viewer-side-panel"
      className={`${widthClass} bg-card border-l border-border overflow-y-auto`}
    >
      <Tabs
        value={tab}
        onValueChange={(next) => {
          setTab(next as TabValue)
          Logger.info(Logger.Categories.PANELS, `SidePanel tab → ${next}`)
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
          {showRca && (
            <TabsTrigger value="rca" data-testid="tab-rca">
              RCA
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

        {showRca && (
          <TabsContent value="rca" className="px-4 pb-4">
            <div
              data-testid="tab-rca-placeholder"
              className="p-md text-sm text-muted-foreground"
            >
              RCA panel — landing in Plan 05
            </div>
          </TabsContent>
        )}
      </Tabs>
    </aside>
  )
}
