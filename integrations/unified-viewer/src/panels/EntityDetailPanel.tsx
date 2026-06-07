// PATTERN SOURCE: 45-UI-SPEC.md § Panel Contracts — Entity Detail Panel
// CONTRACT:
//   - Empty state when no selection (states.tsx EmptyNodeDetailState).
//   - Header: name + ontology-class badge using classColor borderColor.
//   - 5 sections in order: Description / Identity / Provenance / Neighbors / Raw.
//   - Description uses the lightweight ported markdown-text renderer
//     (T-45-03-01 mitigation — no raw-HTML injection anywhere).
//   - Provenance reads canonical camelCase wire fields per Plan 44-16 lock.
//   - Neighbors click → setSelectedNode(neighbor.id).
//   - Raw is <Collapsible defaultOpen={false}>.

import { useMemo } from 'react'
import { ChevronRight } from 'lucide-react'
import type { ApiClient } from '@/api/ApiClient'
import type { System } from '@/config/system-endpoints'
import { useGraphData } from '@/graph/useGraphData'
import { classColor } from '@/graph/color-fallback'
import { useViewerStore } from '@/store/viewer-store'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { MarkdownText } from '@/lib-domain/markdown-text'
import { EmptyNodeDetailState } from '@/lib-domain/states'
import { Logger } from '@/lib/logging'

export interface EntityDetailPanelProps {
  apiClient: ApiClient
  system: System
}

export function EntityDetailPanel({ apiClient, system }: EntityDetailPanelProps) {
  const { entities, relations } = useGraphData(apiClient, system)
  const selectedNodeId = useViewerStore((s) => s.selectedNodeId)
  const setSelectedNode = useViewerStore((s) => s.setSelectedNode)
  const theme = useViewerStore((s) => s.theme)

  const entity = useMemo(() => {
    if (!selectedNodeId) return null
    return entities.find((e) => e.id === selectedNodeId) ?? null
  }, [entities, selectedNodeId])

  const incidentRelations = useMemo(() => {
    if (!selectedNodeId) return []
    return relations.filter(
      (r) => r.from === selectedNodeId || r.to === selectedNodeId,
    )
  }, [relations, selectedNodeId])

  const entityById = useMemo(() => {
    const map = new Map<string, (typeof entities)[number]>()
    for (const e of entities) map.set(e.id, e)
    return map
  }, [entities])

  if (!entity) {
    return <EmptyNodeDetailState />
  }

  const className = entity.ontologyClass ?? 'Unclassified'
  const borderColor = classColor(className, theme)
  const description = (entity.description as string | null | undefined) ?? ''

  // Provenance fields per Plan 44-16 camelCase lock. Fall back to `—` for
  // pre-Phase-39 entities that don't carry these fields.
  const createdBy = (entity.createdBy as string | undefined) ?? '—'
  const confirmationCount =
    typeof entity.confirmationCount === 'number'
      ? String(entity.confirmationCount)
      : '—'
  const lastConfirmedBy = (entity.lastConfirmedBy as string | undefined) ?? '—'
  const lastSegment = (entity.lastSegment as string | undefined) ?? '—'

  return (
    <div data-testid="entity-detail-panel" className="space-y-6 py-2">
      <header className="space-y-2">
        <h2 className="text-xl font-semibold text-foreground" data-testid="entity-name">
          {entity.name}
        </h2>
        <Badge
          variant="outline"
          style={{ borderColor }}
          data-testid="entity-class-badge"
        >
          {className}
        </Badge>
      </header>

      <Section title="Description" testId="entity-section-description">
        {description.length > 0 ? (
          <MarkdownText text={description} />
        ) : (
          <p className="text-sm text-muted-foreground italic">No description.</p>
        )}
      </Section>

      <Section title="Identity" testId="entity-section-identity">
        <Kv label="Class" value={className} valueMono />
        <Kv label="Level" value={String(entity.level ?? '—')} />
        <Kv label="Parent" value={(entity.parent as string | undefined) ?? '—'} valueMono />
        <Kv label="Created" value={(entity.createdAt as string | undefined) ?? '—'} tabularNums />
        <Kv
          label="Last confirmed"
          value={(entity.lastConfirmedAt as string | undefined) ?? '—'}
          tabularNums
        />
      </Section>

      <Section title="Provenance" testId="entity-section-provenance">
        <Kv label="Created by" value={createdBy} valueMono />
        <Kv label="Confirmation count" value={confirmationCount} tabularNums />
        <Kv label="Last confirmed by" value={lastConfirmedBy} valueMono />
        <Kv label="Last segment" value={lastSegment} valueMono />
      </Section>

      <Section title="Neighbors" testId="entity-section-neighbors">
        {incidentRelations.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No relations.</p>
        ) : (
          <ul
            className="max-h-60 overflow-y-auto space-y-1 text-sm"
            data-testid="entity-neighbors-list"
          >
            {incidentRelations.map((r, idx) => {
              const isOutgoing = r.from === selectedNodeId
              const neighborId = isOutgoing ? r.to : r.from
              const neighbor = entityById.get(neighborId)
              const name = neighbor?.name ?? neighborId
              const arrow = isOutgoing ? '→' : '←'
              return (
                <li key={`${r.from}-${r.to}-${idx}`}>
                  <button
                    type="button"
                    data-testid={`neighbor-${neighborId}`}
                    onClick={() => {
                      setSelectedNode(neighborId)
                      Logger.info(
                        Logger.Categories.PANELS,
                        `Neighbor click → ${neighborId}`,
                      )
                    }}
                    className="flex w-full items-baseline gap-2 rounded-md px-2 py-1 text-left hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <span className="text-muted-foreground">{arrow}</span>
                    <span className="flex-1 truncate">{name}</span>
                    <span className="text-xs text-muted-foreground">
                      ({r.type ?? 'related'})
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </Section>

      <Section title="Raw" testId="entity-section-raw">
        <Collapsible defaultOpen={false}>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1"
              data-testid="entity-raw-toggle"
            >
              <ChevronRight className="h-3 w-3 transition-transform data-[state=open]:rotate-90" />
              Show raw JSON
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre
              data-testid="entity-raw-json"
              className="mt-2 max-h-96 overflow-auto rounded-md bg-muted p-3 font-mono text-xs"
            >
              {JSON.stringify(entity, null, 2)}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      </Section>
    </div>
  )
}

interface SectionProps {
  title: string
  testId: string
  children: React.ReactNode
}

function Section({ title, testId, children }: SectionProps) {
  return (
    <section data-testid={testId} className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <div>{children}</div>
    </section>
  )
}

interface KvProps {
  label: string
  value: string
  valueMono?: boolean
  tabularNums?: boolean
}

function Kv({ label, value, valueMono, tabularNums }: KvProps) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={
          'text-right ' +
          (valueMono ? 'font-mono text-xs ' : '') +
          (tabularNums ? 'tabular-nums ' : '')
        }
      >
        {value}
      </span>
    </div>
  )
}
