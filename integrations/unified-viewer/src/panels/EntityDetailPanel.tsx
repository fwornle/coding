// PATTERN SOURCE: 45-UI-SPEC.md § Panel Contracts — Entity Detail Panel
//                  55-PATTERNS.md § EntityDetailPanel.tsx (EXTEND)
//                  VOKB NodeDetails.tsx :71-74 / :94-128 / :165-213 / :243-296
//                  :349-380 / :622 / :893-935 / :938-1142+
// CONTRACT: 55-09-PLAN.md Task 2 + UI-SPEC §8 + §10 + §11 + §16
//
// Phase 45 contract preserved (Default sub-tab):
//   - Empty state when no selection (states.tsx EmptyNodeDetailState).
//   - 5 sections in order: Description / Identity / Provenance / Neighbors / Raw.
//   - Description uses the lightweight ported markdown-text renderer
//     (T-45-03-01 mitigation — no raw-HTML injection anywhere).
//   - Provenance reads canonical camelCase wire fields per Plan 44-16 lock.
//   - Neighbors click → setSelectedNode(neighbor.id).
//   - Raw is <Collapsible defaultOpen={false}>.
//
// Phase 55 additions:
//   - EntityIdentityHeader (shared with MarkdownViewerPanel) replaces the
//     inline Identity block.
//   - 4 sub-tabs (Default / Evolution / Confidence / Timeline) with the
//     visibility predicate locked verbatim from UI-SPEC §8.
//   - Relationships breakdown — groupedRelations by edge type with EDGE_LABELS
//     + EDGE_DOT_COLORS (defined inline; TODO: hoist to vokb-palette).
//   - Sources & Evidence section — sourceRefs grouped by EvidenceLinkType
//     using EVIDENCE_TYPE_ICONS + EVIDENCE_TYPE_LABELS + evidenceAgeBadge
//     (55-03 shared module). External links carry rel="noopener noreferrer"
//     target="_blank" (T-55-09-02).
//   - Occurrence History section — entity.metadata.occurrences[] with
//     relative timestamps.
//   - Keyboard shortcuts 1/2/3/4 cycle visible sub-tabs.
//   - descViewMode is LOCAL component state (UI-SPEC §8), reset on
//     selectedNodeId change.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'
import type { ApiClient, ConfidencePayload } from '@/api/ApiClient'
import type { System } from '@/config/system-endpoints'
import { useGraphData } from '@/graph/useGraphData'
import { useViewerStore } from '@/store/viewer-store'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { MarkdownText } from '@/lib-domain/markdown-text'
import { EmptyNodeDetailState } from '@/lib-domain/states'
import { Logger } from '@/lib/logging'
import { EntityIdentityHeader } from './EntityIdentityHeader'
import { InsightDocumentModal } from './InsightDocumentModal'
import {
  CONFIDENCE_COLOR,
  RUN_COLORS,
} from '@/graph/vokb-palette'
import {
  EVIDENCE_TYPE_ICONS,
  EVIDENCE_TYPE_LABELS,
  evidenceAgeBadge,
  type EvidenceLinkType,
} from '@/lib-domain/evidence-types'

// =============================================================================
// Local constants — TODO: hoist EDGE_LABELS / EDGE_DOT_COLORS to vokb-palette
// (the 55-03 SUMMARY notes vokb-palette already carries EDGE_STYLES; the human-
// readable LABELS + DOT colors live here inline for now per 55-09-PLAN.md
// Task 2 <action> "if absent, declare them inline ... with a TODO comment").
// =============================================================================

const EDGE_LABELS: Record<string, string> = {
  DERIVED_FROM: 'Derived from',
  PART_OF: 'Part of',
  CONTAINS: 'Contains',
  HAS_TYPE: 'Has type',
  HAS_VERSION: 'Has version',
  CAUSED_BY: 'Caused by',
  CAUSED: 'Caused',
  HAS_ROOT_CAUSE: 'Root cause',
  HAS_SYMPTOM: 'Symptom',
  INDICATES: 'Indicates',
  OBSERVED_IN: 'Observed in',
  LOCATED_IN: 'Located in',
  DEPLOYED_ON: 'Deployed on',
  RUNS_ON: 'Runs on',
  RUNS_IN: 'Runs in',
  MANAGED_BY: 'Managed by',
  READS: 'Reads',
  PROCESSES: 'Processes',
  CONSUMED_BY: 'Consumed by',
  STORED_IN: 'Stored in',
  USES: 'Uses',
  RESOLVES: 'Resolves',
  MITIGATES: 'Mitigates',
  APPLIED_TO: 'Applied to',
  APPLIES_TO: 'Applies to',
  MATCHES: 'Matches',
  CORRELATED_WITH: 'Correlated with',
  DEPENDS_ON: 'Depends on',
  AFFECTS: 'Affects',
  RELATES_TO: 'Related',
}

const EDGE_DOT_COLORS: Record<string, string> = {
  DERIVED_FROM: 'bg-gray-400',
  PART_OF: 'bg-gray-500',
  CONTAINS: 'bg-gray-500',
  HAS_TYPE: 'bg-gray-400',
  HAS_VERSION: 'bg-gray-400',
  CAUSED_BY: 'bg-red-500',
  CAUSED: 'bg-red-600',
  HAS_ROOT_CAUSE: 'bg-orange-500',
  HAS_SYMPTOM: 'bg-orange-400',
  INDICATES: 'bg-orange-600',
  OBSERVED_IN: 'bg-blue-500',
  LOCATED_IN: 'bg-blue-600',
  DEPLOYED_ON: 'bg-blue-400',
  RUNS_ON: 'bg-blue-400',
  RUNS_IN: 'bg-blue-400',
  MANAGED_BY: 'bg-blue-300',
  READS: 'bg-green-500',
  PROCESSES: 'bg-green-600',
  CONSUMED_BY: 'bg-green-400',
  STORED_IN: 'bg-green-300',
  USES: 'bg-green-500',
  RESOLVES: 'bg-teal-500',
  MITIGATES: 'bg-teal-400',
  APPLIED_TO: 'bg-teal-300',
  APPLIES_TO: 'bg-teal-300',
  MATCHES: 'bg-teal-600',
  CORRELATED_WITH: 'bg-purple-500',
  DEPENDS_ON: 'bg-violet-500',
  AFFECTS: 'bg-fuchsia-400',
  RELATES_TO: 'bg-gray-300',
}

type SubTab = 'default' | 'evolution' | 'confidence' | 'timeline'

// =============================================================================
// Props
// =============================================================================

export interface EntityDetailPanelProps {
  apiClient: ApiClient
  system: System
}

// =============================================================================
// Helpers
// =============================================================================

/** Format an ISO timestamp into a short relative string. */
function relativeTime(iso: string | undefined): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return iso
  const ageMs = Date.now() - t
  if (ageMs < 60_000) return 'Just now'
  if (ageMs < 60 * 60_000) return `${Math.floor(ageMs / 60_000)}m ago`
  if (ageMs < 24 * 60 * 60_000) return `${Math.floor(ageMs / (60 * 60_000))}h ago`
  if (ageMs < 7 * 24 * 60 * 60_000) return `${Math.floor(ageMs / (24 * 60 * 60_000))}d ago`
  return new Date(t).toISOString().slice(0, 10)
}

/**
 * 2026-06-12: Render an ISO timestamp in the viewer-host's local timezone
 * instead of the raw UTC string. The user is on CEST (UTC+2) and seeing
 * `2026-06-12T05:28:07.593Z` in the right panel was confusing — the
 * "X minutes ago" reads correctly but the absolute time looked two hours
 * stale. Format as `YYYY-MM-DD HH:MM:SS` in LOCAL tz, fall back to the
 * raw value when un-parseable so we don't lose data.
 */
function formatLocalTimestamp(iso: string | undefined): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return iso
  const d = new Date(t)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} `
    + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** Visibility predicate per UI-SPEC §8 + 55-09-PLAN <interfaces> (verbatim). */
function computeVisibility(entity: Record<string, unknown>) {
  const metadata = (entity.metadata as Record<string, unknown> | undefined) ?? {}
  const segments = (metadata.descriptionSegments as unknown[] | undefined) ?? []
  const occurrences = (metadata.occurrences as unknown[] | undefined) ?? []
  const provenance = (metadata.provenance as Record<string, unknown> | undefined) ?? {}
  const confirmationCount = (provenance.confirmationCount as number | undefined) ?? 0
  const createdByMeta = provenance.createdBy as string | undefined

  // VERBATIM per 55-09-PLAN <interfaces> — does NOT include top-level
  // entity.createdBy, only metadata.provenance.createdBy. This matters because
  // Phase 45 entities carry top-level createdBy without the metadata block;
  // expanding their Timeline sub-tab would render an empty event list.
  const showEvolution =
    segments.length > 0 || occurrences.length > 1 || confirmationCount > 0
  const showTimeline =
    !!createdByMeta || segments.length > 0 || occurrences.length > 0
  const showConfidence = true
  return { showEvolution, showTimeline, showConfidence }
}

/**
 * Client-heuristic confidence — fallback for 404 / network error on the
 * `/api/v1/entities/:id/confidence` endpoint. Mirrors VOKB
 * NodeDetails.tsx:165-213 (`computeSegmentConfidence`) — simple weighted blend
 * of segment count + confirmationCount + occurrence count.
 */
function clientHeuristicConfidence(
  entity: Record<string, unknown>,
): ConfidencePayload {
  const metadata = (entity.metadata as Record<string, unknown> | undefined) ?? {}
  const segments =
    (metadata.descriptionSegments as Array<Record<string, unknown>> | undefined) ?? []
  const occurrences = (metadata.occurrences as unknown[] | undefined) ?? []
  const provenance = (metadata.provenance as Record<string, unknown> | undefined) ?? {}
  const confirmationCount = (provenance.confirmationCount as number | undefined) ?? 0
  // Each signal contributes up to 0.33; cap overall at 1.0
  const signals =
    Math.min(segments.length / 3, 1) * 0.33 +
    Math.min(occurrences.length / 5, 1) * 0.33 +
    Math.min(confirmationCount / 3, 1) * 0.34
  const score = Math.min(signals, 1)
  const label: 'High' | 'Moderate' | 'Low' =
    score >= 0.7 ? 'High' : score >= 0.4 ? 'Moderate' : 'Low'
  const segOut = segments.map((seg, i) => {
    const runId = (seg.runId as string | undefined) ?? `seg-${i}`
    return { runId, score, label }
  })
  return { overall: { score, label }, segments: segOut }
}

// =============================================================================
// Sub-tab rendering helpers
// =============================================================================

function EvolutionContent({ entity }: { entity: Record<string, unknown> }) {
  const metadata = (entity.metadata as Record<string, unknown> | undefined) ?? {}
  const segments =
    (metadata.descriptionSegments as Array<Record<string, unknown>> | undefined) ?? []
  const provenance = (metadata.provenance as Record<string, unknown> | undefined) ?? {}
  const confirmationCount = (provenance.confirmationCount as number | undefined) ?? 0
  const resolutionHistory =
    (metadata.resolutionHistory as Array<Record<string, unknown>> | undefined) ?? []

  // Assign RUN_COLORS by order of first appearance per VOKB rule.
  const runIndex = new Map<string, number>()
  segments.forEach((seg) => {
    const runId = (seg.runId as string | undefined) ?? 'unknown'
    if (!runIndex.has(runId)) runIndex.set(runId, runIndex.size)
  })

  return (
    <div data-testid="subtab-content-evolution" className="space-y-3">
      {confirmationCount > 0 && (
        <div
          data-testid="evolution-merge-banner"
          className="rounded-md border border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/30 px-3 py-2 text-xs"
        >
          Merged from {confirmationCount} prior confirmation
          {confirmationCount > 1 ? 's' : ''}.
        </div>
      )}
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Description segments
      </h3>
      <ul className="space-y-2">
        {segments.map((seg, idx) => {
          const runId = (seg.runId as string | undefined) ?? 'unknown'
          const color = RUN_COLORS[(runIndex.get(runId) ?? 0) % RUN_COLORS.length]
          return (
            <li
              key={idx}
              data-run-id={runId}
              className={`rounded-md border ${color.border} ${color.bg} p-2 text-sm space-y-1`}
            >
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground tabular-nums">
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${color.dot}`} />
                <span>{runId}</span>
                <span>·</span>
                <span>{(seg.author as string | undefined) ?? '—'}</span>
                <span>·</span>
                <span>{(seg.timestamp as string | undefined) ?? '—'}</span>
              </div>
              <div>{(seg.text as string | undefined) ?? ''}</div>
            </li>
          )
        })}
      </ul>
      {resolutionHistory.length > 0 && (
        <>
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Resolution history
          </h3>
          <ul className="space-y-1 text-sm">
            {resolutionHistory.map((r, i) => (
              <li key={i} className="rounded-md bg-muted px-2 py-1">
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {(r.timestamp as string | undefined) ?? '—'}
                </span>{' '}
                {(r.summary as string | undefined) ?? ''}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function ConfidenceContent({
  entity,
  apiClient,
}: {
  entity: Record<string, unknown>
  apiClient: ApiClient
}) {
  const [payload, setPayload] = useState<ConfidencePayload | null>(null)
  const [loading, setLoading] = useState(true)
  const entityId = entity.id as string

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const fetcher = (apiClient as unknown as {
      getEntityConfidence?: (id: string) => Promise<ConfidencePayload>
    }).getEntityConfidence
    const run = async () => {
      try {
        if (typeof fetcher !== 'function') {
          throw new Error('endpoint unavailable')
        }
        const data = await fetcher.call(apiClient, entityId)
        if (!cancelled) setPayload(data)
      } catch (err) {
        // T-55-09-04 mitigation — cached by selectedNodeId via component remount;
        // any 404 / network / endpoint-absent falls back to client heuristic.
        Logger.warn(
          Logger.Categories.API,
          `Confidence fetch fell back to client heuristic for ${entityId}: ${(err as Error).message}`,
        )
        if (!cancelled) setPayload(clientHeuristicConfidence(entity))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [apiClient, entityId, entity])

  if (loading) {
    return (
      <div data-testid="subtab-content-confidence" className="text-sm text-muted-foreground">
        Loading confidence…
      </div>
    )
  }
  if (!payload) {
    return (
      <div data-testid="subtab-content-confidence" className="text-sm text-muted-foreground">
        Confidence unavailable.
      </div>
    )
  }
  // 2026-06-11: defensive fallback. CONFIDENCE_COLOR is keyed by the
  // literal label union 'High' | 'Moderate' | 'Low' — but the API or
  // heuristic can return anything (we've seen empty strings cause a
  // TypeError: "Cannot read properties of undefined (reading 'class')"
  // crash at EntityDetailPanel.tsx:345). Fall back to a neutral grey.
  const DEFAULT_CONFIDENCE_STYLE = {
    class: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    dot: 'bg-gray-400',
  }
  const overallStyle = CONFIDENCE_COLOR[payload.overall.label] ?? DEFAULT_CONFIDENCE_STYLE
  return (
    <div data-testid="subtab-content-confidence" className="space-y-3">
      <div className={`inline-flex items-center gap-2 rounded px-2 py-1 ${overallStyle.class}`}>
        <span className={`inline-block w-2 h-2 rounded-full ${overallStyle.dot}`} />
        <span className="text-sm font-medium">
          {payload.overall.label} · {Math.round(payload.overall.score * 100)}%
        </span>
      </div>
      <ul className="space-y-1">
        {payload.segments.map((seg, i) => {
          const s = CONFIDENCE_COLOR[seg.label] ?? DEFAULT_CONFIDENCE_STYLE
          return (
            <li key={i} className="flex items-center gap-2 text-xs">
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${s.dot}`} />
              <span className="font-mono">{seg.runId}</span>
              <span className={`rounded px-1.5 py-0.5 ${s.class}`}>
                {seg.label} · {Math.round(seg.score * 100)}%
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

interface TimelineEvent {
  type: 'creation' | 'segment' | 'confirmation' | 'merge' | 'resolution' | 'occurrence' | 'evidence'
  timestamp: string
  label: string
  icon: string
}

function TimelineContent({ entity }: { entity: Record<string, unknown> }) {
  const events: TimelineEvent[] = useMemo(() => {
    const metadata = (entity.metadata as Record<string, unknown> | undefined) ?? {}
    const out: TimelineEvent[] = []
    const createdAt = (entity.createdAt as string | undefined) ?? undefined
    if (createdAt) {
      out.push({
        type: 'creation',
        timestamp: createdAt,
        label: `Created by ${(entity.createdBy as string | undefined) ?? '—'}`,
        icon: '🟢',
      })
    }
    const segments =
      (metadata.descriptionSegments as Array<Record<string, unknown>> | undefined) ?? []
    for (const seg of segments) {
      const ts = (seg.timestamp as string | undefined) ?? ''
      if (ts) {
        out.push({
          type: 'segment',
          timestamp: ts,
          label: `Segment: ${(seg.runId as string | undefined) ?? '—'}`,
          icon: '📝',
        })
      }
    }
    const occurrences = (metadata.occurrences as Array<Record<string, unknown>> | undefined) ?? []
    for (const occ of occurrences) {
      const ts = (occ.timestamp as string | undefined) ?? ''
      if (ts) {
        out.push({ type: 'occurrence', timestamp: ts, label: 'Occurrence', icon: '🔁' })
      }
    }
    const sourceRefs =
      (metadata.sourceRefs as Array<Record<string, unknown>> | undefined) ?? []
    for (const ref of sourceRefs) {
      const ts = (ref.addedAt as string | undefined) ?? ''
      if (ts) {
        out.push({
          type: 'evidence',
          timestamp: ts,
          label: `Evidence: ${(ref.type as string | undefined) ?? 'other'}`,
          icon: '🔗',
        })
      }
    }
    const resolutionHistory =
      (metadata.resolutionHistory as Array<Record<string, unknown>> | undefined) ?? []
    for (const r of resolutionHistory) {
      const ts = (r.timestamp as string | undefined) ?? ''
      if (ts) {
        out.push({
          type: 'resolution',
          timestamp: ts,
          label: 'Resolution',
          icon: '✅',
        })
      }
    }
    // Sort chronologically (oldest first)
    return out.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  }, [entity])

  // Group-by-year-month when > 20 items (UI-SPEC §8 Timeline rule)
  const grouped = useMemo(() => {
    if (events.length <= 20) return null
    const m = new Map<string, TimelineEvent[]>()
    for (const ev of events) {
      const key = ev.timestamp.slice(0, 7) // YYYY-MM
      if (!m.has(key)) m.set(key, [])
      m.get(key)!.push(ev)
    }
    return m
  }, [events])

  return (
    <div data-testid="subtab-content-timeline" className="space-y-2">
      {grouped ? (
        Array.from(grouped.entries()).map(([yearMonth, items]) => (
          <details key={yearMonth} className="rounded-md border border-border p-2">
            <summary className="text-xs font-semibold cursor-pointer">
              {yearMonth} ({items.length})
            </summary>
            <ul className="mt-1 space-y-1">
              {items.map((ev, i) => (
                <li
                  key={i}
                  data-testid={`timeline-event-${ev.type}`}
                  className="flex items-center gap-2 text-xs"
                >
                  <span aria-hidden>{ev.icon}</span>
                  <span className="tabular-nums text-muted-foreground">{ev.timestamp}</span>
                  <span>{ev.label}</span>
                </li>
              ))}
            </ul>
          </details>
        ))
      ) : (
        <ul className="space-y-1">
          {events.map((ev, i) => (
            <li
              key={i}
              data-testid={`timeline-event-${ev.type}`}
              className="flex items-center gap-2 text-xs"
            >
              <span aria-hidden>{ev.icon}</span>
              <span className="tabular-nums text-muted-foreground">{ev.timestamp}</span>
              <span>{ev.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// =============================================================================
// Main component
// =============================================================================

export function EntityDetailPanel({ apiClient, system }: EntityDetailPanelProps) {
  const { entities, relations } = useGraphData(apiClient, system)
  // 2026-06-13 (Phase 56.1 Plan 05): selectedNodeId is gone — use focalNodeId
  // (the derived singleton from the multi-set slice). EntityDetailPanel mounts
  // in single-focal mode (selectedNodeIds.size === 1 && selectedBucketKeys.size === 0),
  // so the focal entity is the one to render.
  const selectedNodeId = useViewerStore((s) => s.focalNodeId)
  const setSelectedNode = useViewerStore((s) => s.setSelectedNode)
  const theme = useViewerStore((s) => s.theme)
  const [descViewMode, setDescViewMode] = useState<SubTab>('default')
  // Track which Relationship group is expanded (single-open accordion).
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)
  // 2026-06-11: InsightDocument modal open state.
  const [insightModalOpen, setInsightModalOpen] = useState(false)

  const entity = useMemo(() => {
    if (!selectedNodeId) return null
    return entities.find((e) => e.id === selectedNodeId) ?? null
  }, [entities, selectedNodeId])

  // Reset descViewMode on entity change (UI-SPEC §8).
  useEffect(() => {
    setDescViewMode('default')
    setExpandedGroup(null)
  }, [selectedNodeId])

  // Visibility predicate (UI-SPEC §8) — recomputed per entity.
  const visibility = useMemo(() => {
    if (!entity) return { showEvolution: false, showTimeline: false, showConfidence: false }
    return computeVisibility(entity as unknown as Record<string, unknown>)
  }, [entity])

  // Keyboard shortcuts 1/2/3/4 (UI-SPEC §10) — cycle visible sub-tabs only.
  // NOTE: This is a panel-local listener; the global useKeyboardShortcuts hook
  // owns `/` `?` `f` `Esc`. The number keys are panel-scoped per UI-SPEC §10.
  useEffect(() => {
    if (!entity) return
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      // Skip when an input/textarea has focus.
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      switch (event.key) {
        case '1':
          setDescViewMode('default')
          Logger.debug(Logger.Categories.PANELS, 'Sub-tab → default (key 1)')
          break
        case '2':
          if (visibility.showEvolution) {
            setDescViewMode('evolution')
            Logger.debug(Logger.Categories.PANELS, 'Sub-tab → evolution (key 2)')
          }
          break
        case '3':
          if (visibility.showConfidence) {
            setDescViewMode('confidence')
            Logger.debug(Logger.Categories.PANELS, 'Sub-tab → confidence (key 3)')
          }
          break
        case '4':
          if (visibility.showTimeline) {
            setDescViewMode('timeline')
            Logger.debug(Logger.Categories.PANELS, 'Sub-tab → timeline (key 4)')
          }
          break
        default:
          break
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [entity, visibility.showEvolution, visibility.showConfidence, visibility.showTimeline])

  // Group relations by edge type (NodeDetails.tsx:349-380 pattern).
  const groupedRelations = useMemo(() => {
    if (!selectedNodeId) return new Map<string, Array<{ neighborId: string; direction: 'outgoing' | 'incoming' }>>()
    const related = relations.filter(
      (r) => r.from === selectedNodeId || r.to === selectedNodeId,
    )
    const seen = new Set<string>()
    const deduped = related.filter((r) => {
      const k = `${r.type}|${r.from}|${r.to}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    const grouped = new Map<string, Array<{ neighborId: string; direction: 'outgoing' | 'incoming' }>>()
    for (const edge of deduped) {
      const type = edge.type ?? 'RELATES_TO'
      const neighborId = edge.from === selectedNodeId ? edge.to : edge.from
      const direction: 'outgoing' | 'incoming' =
        edge.from === selectedNodeId ? 'outgoing' : 'incoming'
      if (!grouped.has(type)) grouped.set(type, [])
      grouped.get(type)!.push({ neighborId, direction })
    }
    return grouped
  }, [relations, selectedNodeId])

  const entityById = useMemo(() => {
    const map = new Map<string, (typeof entities)[number]>()
    for (const e of entities) map.set(e.id, e)
    return map
  }, [entities])

  const onNeighborClick = useCallback(
    (neighborId: string) => {
      setSelectedNode(neighborId)
      Logger.info(Logger.Categories.PANELS, `Neighbor click → ${neighborId}`)
    },
    [setSelectedNode],
  )

  if (!entity) {
    return <EmptyNodeDetailState />
  }

  // Provenance fields per Plan 44-16 camelCase lock.
  const description = (entity.description as string | null | undefined) ?? ''
  const createdBy = (entity.createdBy as string | undefined) ?? '—'
  const confirmationCount =
    typeof entity.confirmationCount === 'number'
      ? String(entity.confirmationCount)
      : '—'
  const lastConfirmedBy = (entity.lastConfirmedBy as string | undefined) ?? '—'
  const lastSegment = (entity.lastSegment as string | undefined) ?? '—'
  const className = entity.ontologyClass ?? 'Unclassified'

  // Metadata-derived collections.
  const metadata = (entity.metadata as Record<string, unknown> | undefined) ?? {}
  const occurrences =
    (metadata.occurrences as Array<Record<string, unknown>> | undefined) ?? []
  const sourceRefs =
    (metadata.sourceRefs as Array<Record<string, unknown>> | undefined) ?? []

  // Pill bar — render the visible sub-tabs only.
  const tabs: Array<{ id: SubTab; label: string; visible: boolean }> = [
    { id: 'default', label: 'Default', visible: true },
    { id: 'evolution', label: 'Evolution', visible: visibility.showEvolution },
    { id: 'confidence', label: 'Confidence', visible: visibility.showConfidence },
    { id: 'timeline', label: 'Timeline', visible: visibility.showTimeline },
  ]

  // 2026-06-11: VKB-style "View Insight Document" link. Markdown files
  // under knowledge-management/insights/ are named after the entity's
  // SHORT PascalCase identifier (e.g. `ConfigurationManagement.md`). An
  // entity whose `name` contains spaces, colons, or is longer than ~60
  // chars is almost certainly an auto-generated Observation/Insight
  // description rather than a documented component — hide the link in
  // that case so the user doesn't click into a 404.
  const insightDocUrl = (() => {
    const name = (entity.name as string | undefined) || ''
    if (!name) return null
    // Reject names that look like a free-form intent / summary, not a
    // PascalCase component identifier.
    if (name.length > 60) return null
    if (/[\s:()/?#]/.test(name)) return null
    return `http://localhost:8080/knowledge-management/insights/${encodeURIComponent(name)}.md`
  })()

  return (
    <div data-testid="entity-detail-panel" className="space-y-6 py-2">
      {/* Phase 55 — shared identity header (Task 1) */}
      <EntityIdentityHeader entity={entity} theme={theme} />

      {/* 2026-06-11: VKB-style "View Insight Document" card. Opens an
          in-app modal that fetches the .md from VKB and renders it with
          react-markdown — same chain MarkdownViewerPanel uses for OKB.
          User feedback: "why don't you just re-use the code?!" — done. */}
      {insightDocUrl && (
        <>
          <button
            type="button"
            onClick={() => setInsightModalOpen(true)}
            data-testid="view-insight-document"
            className="flex items-center gap-2 rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900 hover:bg-green-100 transition-colors dark:bg-green-900/20 dark:border-green-800 dark:text-green-200 dark:hover:bg-green-900/30 w-full"
          >
            <span aria-hidden className="text-base">📄</span>
            <span className="font-medium underline decoration-dotted underline-offset-2">
              View Insight Document
            </span>
          </button>
          {insightModalOpen && (
            <InsightDocumentModal
              url={insightDocUrl}
              title={`${entity.name as string}.md`}
              onClose={() => setInsightModalOpen(false)}
            />
          )}
        </>
      )}

      {/* Pill bar (UI-SPEC §8 + NodeDetails.tsx:893-935 verbatim micro-type) */}
      <div className="flex gap-1" role="tablist" aria-label="Entity detail sub-tabs">
        {tabs
          .filter((t) => t.visible)
          .map((t) => {
            const active = descViewMode === t.id
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={active}
                data-testid={`subtab-${t.id}`}
                onClick={() => {
                  setDescViewMode(t.id)
                  Logger.info(Logger.Categories.PANELS, `Sub-tab click → ${t.id}`)
                }}
                className={
                  `text-[10px] rounded px-2 py-0.5 transition-colors ${
                    active
                      ? 'bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-100 font-semibold'
                      : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`
                }
              >
                {t.label}
              </button>
            )
          })}
      </div>

      {/* Sub-tab content */}
      {descViewMode === 'default' && (
        <>
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
            <Kv label="Created" value={formatLocalTimestamp(entity.createdAt as string | undefined)} tabularNums />
            <Kv
              label="Last confirmed"
              value={formatLocalTimestamp(entity.lastConfirmedAt as string | undefined)}
              tabularNums
            />
          </Section>

          <Section title="Provenance" testId="entity-section-provenance">
            <Kv label="Created by" value={createdBy} valueMono />
            <Kv label="Confirmation count" value={confirmationCount} tabularNums />
            <Kv label="Last confirmed by" value={lastConfirmedBy} valueMono />
            <Kv label="Last segment" value={lastSegment} valueMono />
          </Section>

          {/* Relationships breakdown (replaces Phase 45 flat Neighbors). */}
          <Section title="Relationships" testId="entity-section-relationships">
            {groupedRelations.size === 0 ? (
              <p className="text-sm text-muted-foreground italic">No relations.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {Array.from(groupedRelations.entries()).map(([edgeType, edges]) => {
                  const isOpen = expandedGroup === edgeType
                  const dotClass = EDGE_DOT_COLORS[edgeType] ?? 'bg-gray-300'
                  const label = EDGE_LABELS[edgeType] ?? edgeType
                  // Outgoing/incoming chevron — outgoing if ANY edge is outgoing.
                  const anyOutgoing = edges.some((e) => e.direction === 'outgoing')
                  return (
                    <li
                      key={edgeType}
                      data-testid={`relationship-group-${edgeType}`}
                      className="rounded-md border border-border"
                    >
                      <button
                        type="button"
                        data-testid={`relationship-group-header-${edgeType}`}
                        aria-expanded={isOpen}
                        className="flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-muted"
                        onClick={() =>
                          setExpandedGroup((prev) => (prev === edgeType ? null : edgeType))
                        }
                      >
                        {isOpen ? (
                          <ChevronDown className="h-3 w-3" aria-hidden />
                        ) : (
                          <ChevronRight className="h-3 w-3" aria-hidden />
                        )}
                        <span className={`inline-block w-2 h-2 rounded-full ${dotClass}`} />
                        <span className="flex-1">{label}</span>
                        <span className="text-muted-foreground">
                          {anyOutgoing ? '→' : '←'}
                        </span>
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] tabular-nums">
                          {edges.length}
                        </span>
                      </button>
                      {isOpen && (
                        <ul className="space-y-0.5 px-2 pb-2">
                          {edges.map((edge, idx) => {
                            const neighbor = entityById.get(edge.neighborId)
                            const name = neighbor?.name ?? edge.neighborId
                            const arrow = edge.direction === 'outgoing' ? '→' : '←'
                            return (
                              <li key={`${edge.neighborId}-${idx}`}>
                                <button
                                  type="button"
                                  data-testid={`neighbor-${edge.neighborId}`}
                                  onClick={() => onNeighborClick(edge.neighborId)}
                                  className="flex w-full items-baseline gap-2 rounded-md px-2 py-1 text-left hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                                >
                                  <span className="text-muted-foreground">{arrow}</span>
                                  <span className="flex-1 truncate">{name}</span>
                                </button>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </Section>

          {/* Sources & Evidence */}
          <Section title="Sources & Evidence" testId="entity-section-sources">
            {sourceRefs.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">No sources.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {(() => {
                  // Group by evidence type
                  const groups = new Map<EvidenceLinkType, Array<Record<string, unknown>>>()
                  for (const ref of sourceRefs) {
                    const rawType = (ref.type as string | undefined) ?? 'other'
                    const type = (rawType in EVIDENCE_TYPE_LABELS
                      ? rawType
                      : 'other') as EvidenceLinkType
                    if (!groups.has(type)) groups.set(type, [])
                    groups.get(type)!.push(ref)
                  }
                  return Array.from(groups.entries()).map(([type, refs]) => (
                    <li key={type} className="rounded-md border border-border p-2 space-y-1">
                      <div className="flex items-center gap-2 text-xs font-medium">
                        <span aria-hidden>{EVIDENCE_TYPE_ICONS[type]}</span>
                        <span>{EVIDENCE_TYPE_LABELS[type]}</span>
                      </div>
                      <ul className="space-y-0.5 pl-4">
                        {refs.map((ref, i) => {
                          const url = (ref.url as string | undefined) ?? '#'
                          const addedAt = (ref.addedAt as string | undefined) ?? ''
                          const badge = addedAt ? evidenceAgeBadge(addedAt) : null
                          return (
                            <li key={i} className="flex items-center gap-2">
                              <a
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary underline truncate flex-1"
                              >
                                {url}
                              </a>
                              {badge && (
                                <span className={`text-[10px] rounded px-1.5 py-0.5 ${badge.className}`}>
                                  {badge.label}
                                </span>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    </li>
                  ))
                })()}
              </ul>
            )}
          </Section>

          {/* Occurrence History — in-panel section (50-cap). */}
          <Section title="Occurrence History" testId="entity-section-occurrences">
            {occurrences.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">No occurrences.</p>
            ) : (
              <ul className="space-y-0.5 text-sm">
                {occurrences.slice(0, 50).map((occ, i) => (
                  <li
                    key={i}
                    data-testid={`occurrence-item-${i}`}
                    className="flex items-center gap-2"
                  >
                    <span className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">
                      {relativeTime((occ.timestamp as string | undefined))}
                    </span>
                    {(occ.sourceEvidenceId as string | undefined) && (
                      <span className="font-mono text-xs">
                        {occ.sourceEvidenceId as string}
                      </span>
                    )}
                  </li>
                ))}
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
        </>
      )}

      {descViewMode === 'evolution' && (
        <EvolutionContent entity={entity as unknown as Record<string, unknown>} />
      )}
      {descViewMode === 'confidence' && (
        <ConfidenceContent
          entity={entity as unknown as Record<string, unknown>}
          apiClient={apiClient}
        />
      )}
      {descViewMode === 'timeline' && (
        <TimelineContent entity={entity as unknown as Record<string, unknown>} />
      )}
    </div>
  )
}

// =============================================================================
// Section + Kv helpers (Phase 45 baseline preserved)
// =============================================================================

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
