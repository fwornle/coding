// PORT-SPEC: VOKB IssueTriage.tsx
//   (_work/rapid-automations/integrations/operational-knowledge-management/
//    viewer/src/components/KnowledgeGraph/IssueTriage.tsx — full file)
//
// PATTERN SOURCE: 55-10-PLAN.md Task 2
//   + 55-PATTERNS.md § IssueTriageView.tsx (full block — BFS pattern,
//     SECTION_ORDER, SECTION_META, RCA_EDGE_TYPES locked set)
//   + 55-UI-SPEC.md §5 (Triage state copy) + §6 (layout map) + §9 (mode
//     switching predicate) + §10 (Triage click semantics rows)
//
// This is the Mode B canvas for UnifiedViewer (mode === 'triage'). Plan
// 55-10 Task 2 swaps the lazy import in UnifiedViewer.tsx from the
// TriagePlaceholder stub (shipped by 55-07 Task 2) to this real view.
//
// REDUX → ZUSTAND TRANSLATION:
//   VOKB uses `useAppDispatch + useAppSelector` for entities / edges /
//   trendingPatterns + selection + setActiveView. Phase 55 reads
//   entities/relations as PROPS (passed in by UnifiedViewer.tsx — the
//   useGraphData result lives there already), and selection/mode flow
//   through `useViewerStore` (Plan 55-04 slices).
//
// ENTITY SHAPE: Phase 55 Entity (graph/types.ts) uses `id` (not `key`)
//   and `entityType` lives on the `[k: string]: unknown` index signature.
//   Relations use `from`/`to` (VOKB had `source`/`target`).
//
// BFS IMPLEMENTATION: matches VOKB IssueTriage.tsx:97-182 verbatim —
//   2-hop walk filtered by RCA_EDGE_TYPES at depth > 0, depth-1
//   RootCause/Symptom/FailurePattern get extended to depth 2.
//
// SOURCES & EVIDENCE: imports EVIDENCE_TYPE_ICONS / EVIDENCE_TYPE_LABELS
//   from `@/lib-domain/evidence-types` (Plan 55-03 — single source of
//   truth) instead of redeclaring locally (which was the VOKB duplicate
//   Phase 55 is consolidating per UI-SPEC §7 row 10).

import { useMemo, useState } from 'react'
import { useViewerStore } from '@/store/viewer-store'
import { Logger } from '@/lib/logging'
import {
  EVIDENCE_TYPE_ICONS,
  EVIDENCE_TYPE_LABELS,
  type EvidenceLinkType,
} from '@/lib-domain/evidence-types'
import type { Entity, Relation } from '@/graph/types'

/* ------------------------------------------------------------------ */
/* RCA-chain edge types — verbatim from VOKB IssueTriage.tsx:64-68    */
/* ------------------------------------------------------------------ */
const RCA_EDGE_TYPES = new Set([
  'HAS_SYMPTOM', 'HAS_ROOT_CAUSE', 'CAUSED', 'CAUSED_BY',
  'INDICATES', 'MITIGATED_BY', 'MITIGATES', 'ADDRESSES',
  'MATCHES', 'DERIVED_FROM', 'AFFECTS', 'APPLIED_TO',
])

/* Entity types we group into the RCA chain sections — verbatim from VOKB:71-72 */
const SECTION_ORDER = [
  'Symptom',
  'FailurePattern',
  'RootCause',
  'Resolution',
  'Risk',
  'Decision',
] as const
type SectionType = (typeof SECTION_ORDER)[number]

/* Section display metadata — verbatim from VOKB IssueTriage.tsx:74-81 */
const SECTION_META: Record<SectionType, { label: string; color: string; icon: string }> = {
  Symptom:        { label: 'Symptoms',         color: '#ef4444', icon: '🔴' },
  FailurePattern: { label: 'Failure Patterns', color: '#f59e0b', icon: '🟡' },
  RootCause:      { label: 'Root Causes',      color: '#8b5cf6', icon: '🟣' },
  Resolution:     { label: 'Resolutions',      color: '#10b981', icon: '🟢' },
  Risk:           { label: 'Risks',            color: '#f97316', icon: '🟠' },
  Decision:       { label: 'Decisions',        color: '#3b82f6', icon: '🔵' },
}

interface ChainItem {
  entity: Entity
  edgeType: string
  direction: 'outgoing' | 'incoming'
}

interface SourceRef {
  type: EvidenceLinkType
  url: string
  label?: string
  addedAt?: string
}

export interface IssueTriageViewProps {
  entities: readonly Entity[]
  relations: readonly Relation[]
}

/** Read a typed string field from an Entity, falling back across two casings. */
function readType(e: Entity): string {
  return String((e as { entityType?: unknown }).entityType ?? e.ontologyClass ?? '')
}

function readDomain(e: Entity): string | undefined {
  const v = (e as { domain?: unknown }).domain
  return typeof v === 'string' ? v : undefined
}

function readDescription(e: Entity): string {
  const md = (e.metadata ?? {}) as Record<string, unknown>
  if (typeof md.description === 'string') return md.description
  if (typeof md.insight === 'string') return md.insight
  if (typeof e.description === 'string') return e.description
  return ''
}

function readLastSeen(e: Entity): string | undefined {
  const md = (e.metadata ?? {}) as Record<string, unknown>
  if (typeof md.lastSeen === 'string') return md.lastSeen
  if (typeof e.lastConfirmedAt === 'string') return e.lastConfirmedAt
  if (typeof e.createdAt === 'string') return e.createdAt
  return undefined
}

function readSourceRefs(e: Entity): SourceRef[] {
  const md = (e.metadata ?? {}) as Record<string, unknown>
  const refs = (md.sourceRefs ?? md.source_refs) as unknown
  if (!Array.isArray(refs)) return []
  return refs.filter(
    (r): r is SourceRef => typeof r === 'object' && r !== null && typeof (r as { url?: unknown }).url === 'string',
  )
}

function formatDate(d?: string): string {
  if (!d) return ''
  const date = new Date(d)
  const now = new Date()
  const diffH = Math.floor((now.getTime() - date.getTime()) / 3_600_000)
  if (diffH < 1) return 'just now'
  if (diffH < 24) return `${diffH}h ago`
  const diffD = Math.floor(diffH / 24)
  if (diffD < 7) return `${diffD}d ago`
  return date.toLocaleDateString()
}

export default function IssueTriageView({ entities, relations }: IssueTriageViewProps) {
  const setSelectedNode = useViewerStore((s) => s.setSelectedNode)
  const setMode = useViewerStore((s) => s.setMode)

  const [searchTerm, setSearchTerm] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  /* ---- Adjacency index (built once when relations change) ---- */
  const adjacency = useMemo(() => {
    const adj: Record<
      string,
      Array<{ neighborId: string; edgeType: string; direction: 'outgoing' | 'incoming' }>
    > = {}
    for (const r of relations) {
      const t = r.type || 'related'
      if (!adj[r.from]) adj[r.from] = []
      if (!adj[r.to]) adj[r.to] = []
      adj[r.from].push({ neighborId: r.to, edgeType: t, direction: 'outgoing' })
      adj[r.to].push({ neighborId: r.from, edgeType: t, direction: 'incoming' })
    }
    return adj
  }, [relations])

  /* ---- Entity index keyed by id (Phase 55: id replaces VOKB's `key`) ---- */
  const entityById = useMemo(() => {
    const m = new Map<string, Entity>()
    for (const e of entities) m.set(e.id, e)
    return m
  }, [entities])

  /* ---- Incidents: entities with entityType ∈ {Incident, FailureIncident} ---- */
  const incidents = useMemo(() => {
    return entities
      .filter((e) => {
        const t = readType(e).toLowerCase()
        return t === 'incident' || t === 'failureincident'
      })
      .slice()
      .sort((a, b) => {
        const da = readLastSeen(a) ?? ''
        const db = readLastSeen(b) ?? ''
        return db.localeCompare(da)
      })
  }, [entities])

  /* ---- Filter by search ---- */
  const filtered = useMemo(() => {
    if (!searchTerm) return incidents
    const q = searchTerm.toLowerCase()
    return incidents.filter((e) => {
      return (
        (e.name || '').toLowerCase().includes(q) ||
        readDescription(e).toLowerCase().includes(q) ||
        (readDomain(e) ?? '').toLowerCase().includes(q)
      )
    })
  }, [incidents, searchTerm])

  /* ---- RCA chain BFS (verbatim VOKB:97-182, adapted to id keys) ---- */
  const rcaChain = useMemo((): Map<SectionType, ChainItem[]> => {
    const sections = new Map<SectionType, ChainItem[]>()
    if (!selectedKey) return sections

    const visited = new Set<string>([selectedKey])
    const queue: Array<{ nodeKey: string; depth: number }> = [
      { nodeKey: selectedKey, depth: 0 },
    ]

    while (queue.length > 0) {
      const { nodeKey, depth } = queue.shift()!
      if (depth >= 2) continue

      const neighbors = adjacency[nodeKey] || []
      for (const { neighborId, edgeType, direction } of neighbors) {
        if (visited.has(neighborId)) continue
        // Only follow RCA-relevant edges (or all edges from the incident itself)
        if (depth > 0 && !RCA_EDGE_TYPES.has(edgeType)) continue

        const neighbor = entityById.get(neighborId)
        if (!neighbor) continue
        visited.add(neighborId)

        const neighborType = readType(neighbor)
        const section = SECTION_ORDER.find(
          (s) => neighborType.toLowerCase() === s.toLowerCase(),
        )
        if (section) {
          if (!sections.has(section)) sections.set(section, [])
          sections.get(section)!.push({ entity: neighbor, edgeType, direction })
        }

        // Continue BFS through RootCause / Symptom / FailurePattern to depth 2
        if (
          section === 'RootCause' ||
          section === 'Symptom' ||
          section === 'FailurePattern'
        ) {
          queue.push({ nodeKey: neighborId, depth: depth + 1 })
        }
      }
    }
    return sections
  }, [selectedKey, adjacency, entityById])

  const selectedEntity = selectedKey ? entityById.get(selectedKey) : undefined

  /* ---- Evidence links: BFS 3 hops, ALL edge types, collect sourceRefs ---- */
  const evidenceLinks = useMemo((): Map<EvidenceLinkType, SourceRef[]> => {
    const grouped = new Map<EvidenceLinkType, SourceRef[]>()
    if (!selectedKey) return grouped

    const seen = new Set<string>()
    const visited = new Set<string>([selectedKey])
    const queue: Array<{ key: string; depth: number }> = [{ key: selectedKey, depth: 0 }]

    const collect = (ent: Entity) => {
      for (const ref of readSourceRefs(ent)) {
        if (!ref.url || seen.has(ref.url)) continue
        seen.add(ref.url)
        const t = (ref.type || 'other') as EvidenceLinkType
        if (!grouped.has(t)) grouped.set(t, [])
        grouped.get(t)!.push(ref)
      }
    }

    while (queue.length > 0) {
      const { key, depth } = queue.shift()!
      const ent = entityById.get(key)
      if (ent) collect(ent)
      if (depth >= 3) continue
      for (const { neighborId } of (adjacency[key] || [])) {
        if (visited.has(neighborId)) continue
        visited.add(neighborId)
        queue.push({ key: neighborId, depth: depth + 1 })
      }
    }
    return grouped
  }, [selectedKey, entityById, adjacency])

  const connectionCount = (id: string) => (adjacency[id] || []).length

  const handleIncidentSelect = (id: string) => {
    setSelectedKey(id)
    setSelectedNode(id)
    Logger.info(
      Logger.Categories.PANELS,
      `IssueTriageView incident selected: ${id}`,
    )
  }

  const handleChainItemClick = (entity: Entity) => {
    setSelectedNode(entity.id)
    Logger.info(
      Logger.Categories.PANELS,
      `IssueTriageView chain item clicked: ${entity.id}`,
    )
  }

  const handleViewInGraph = () => {
    // Mode flip — per UI-SPEC §10 row "Click on chain item in Triage right
    // panel": setMode('kg'); selectedNodeId is already set by chain-item /
    // incident clicks above.
    setMode('kg')
    Logger.info(
      Logger.Categories.PANELS,
      'IssueTriageView View in Graph CTA clicked',
    )
  }

  /* ================================================================ */
  return (
    <div
      data-testid="issue-triage-view"
      className="absolute inset-0 overflow-hidden flex bg-background text-foreground"
    >
      {/* ---- LEFT PANE: incident list + search ---- */}
      <div
        data-testid="triage-left-pane"
        className="w-[380px] flex-shrink-0 border-r border-border flex flex-col bg-card"
      >
        {/* Search */}
        <div className="p-3 border-b border-border">
          <input
            type="text"
            data-testid="triage-incident-search"
            placeholder="Search incidents..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 outline-none"
          />
          <p className="text-xs text-muted-foreground mt-1 tabular-nums">
            {filtered.length} of {incidents.length} incidents
          </p>
        </div>

        {/* Incident list */}
        <div
          data-testid="triage-incident-list"
          className="flex-1 overflow-y-auto"
        >
          {incidents.length === 0 ? (
            <div
              data-testid="triage-no-incidents"
              className="p-6 text-center text-sm text-muted-foreground italic"
            >
              No incidents in knowledge base. Ingest data to populate.
            </div>
          ) : filtered.length === 0 ? (
            <div
              data-testid="triage-no-matches"
              className="p-6 text-center text-sm text-muted-foreground italic"
            >
              No incidents match your search.
            </div>
          ) : (
            filtered.map((inc) => {
              const conns = connectionCount(inc.id)
              const desc = readDescription(inc)
              const lastSeen = readLastSeen(inc)
              return (
                <button
                  key={`inc-${inc.id}`}
                  type="button"
                  data-testid={`triage-incident-${inc.id}`}
                  onClick={() => handleIncidentSelect(inc.id)}
                  className={`w-full text-left p-3 border-b border-border/50 hover:bg-accent transition-colors ${
                    selectedKey === inc.id ? 'bg-accent border-l-2 border-l-primary' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium text-foreground leading-tight">
                      {inc.name}
                    </span>
                    {lastSeen && (
                      <span className="text-xs text-muted-foreground flex-shrink-0 whitespace-nowrap">
                        {formatDate(lastSeen)}
                      </span>
                    )}
                  </div>
                  {desc && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
                      {desc.slice(0, 120)}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground tabular-nums">
                      {conns} connections
                    </span>
                    {readDomain(inc) && (
                      <span className="text-xs text-muted-foreground">{readDomain(inc)}</span>
                    )}
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* ---- RIGHT PANE: RCA chain + Sources & Evidence ---- */}
      <div
        data-testid="triage-right-pane"
        className="flex-1 overflow-y-auto bg-muted/30 p-6"
      >
        {!selectedEntity ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center max-w-md">
              <svg
                className="w-16 h-16 mx-auto mb-4 opacity-30"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <p className="text-lg font-medium">Select an incident to investigate.</p>
              <p className="text-sm mt-1 text-muted-foreground italic">
                Each incident shows its RCA chain: symptoms, root causes, and known resolutions.
              </p>
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto">
            {/* Incident header */}
            <div className="bg-card rounded-lg shadow-sm p-5 mb-6">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <h2 className="text-lg font-semibold text-foreground">
                    {selectedEntity.name}
                  </h2>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-destructive/10 text-destructive font-medium">
                      {readType(selectedEntity)}
                    </span>
                    {readDomain(selectedEntity) && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                        {readDomain(selectedEntity)}
                      </span>
                    )}
                    {readLastSeen(selectedEntity) && (
                      <span className="text-xs text-muted-foreground">
                        {formatDate(readLastSeen(selectedEntity))}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  data-testid="view-in-graph"
                  onClick={handleViewInGraph}
                  className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors flex-shrink-0 ml-3"
                  aria-label="View this incident in the knowledge graph"
                >
                  View in Graph
                </button>
              </div>
              {readDescription(selectedEntity) && (
                <p className="mt-3 text-sm text-foreground/80 leading-relaxed">
                  {readDescription(selectedEntity)}
                </p>
              )}
            </div>

            {/* RCA Chain sections (rendered in SECTION_ORDER) */}
            {rcaChain.size === 0 ? (
              <div className="text-center text-muted-foreground py-12">
                <p className="text-sm">No RCA chain found for this incident.</p>
                <p className="text-xs mt-1 italic">
                  This incident may not have connected symptoms, root causes, or resolutions yet.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {SECTION_ORDER.map((section) => {
                  const items = rcaChain.get(section)
                  if (!items || items.length === 0) return null
                  const meta = SECTION_META[section]
                  return (
                    <div
                      key={section}
                      data-testid={`rca-section-${section}`}
                    >
                      <h3
                        className="text-xs font-semibold uppercase tracking-wider mb-3 flex items-center gap-2"
                        style={{ color: meta.color }}
                      >
                        <span>{meta.icon}</span>
                        <span>{meta.label}</span>
                        <span className="text-muted-foreground font-normal tabular-nums">
                          ({items.length})
                        </span>
                      </h3>
                      <div className="space-y-2">
                        {items.map((item, i) => {
                          const desc = readDescription(item.entity)
                          return (
                            <button
                              type="button"
                              key={`${section}-${item.entity.id}-${i}`}
                              data-testid={`rca-chain-item-${item.entity.id}`}
                              className="w-full text-left bg-card rounded-lg shadow-sm p-4 border-l-4 hover:shadow-md transition-shadow cursor-pointer group"
                              style={{ borderLeftColor: meta.color }}
                              onClick={() => handleChainItemClick(item.entity)}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <span className="text-sm font-medium text-foreground">
                                    {item.entity.name}
                                  </span>
                                  <span className="text-xs text-muted-foreground ml-2 font-mono">
                                    {item.edgeType.replace(/_/g, ' ').toLowerCase()}
                                  </span>
                                </div>
                                <span className="text-xs text-primary opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                                  view in graph →
                                </span>
                              </div>
                              {desc && (
                                <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed line-clamp-3">
                                  {desc.slice(0, 300)}
                                </p>
                              )}
                              {readDomain(item.entity) && (
                                <span className="inline-block text-xs text-muted-foreground mt-1.5">
                                  {readDomain(item.entity)}
                                </span>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Sources & Evidence (imports icons + labels from 55-03 shared module) */}
            {evidenceLinks.size > 0 && (
              <div className="mt-6" data-testid="triage-sources-evidence">
                <h3 className="text-xs font-semibold uppercase tracking-wider mb-3 text-muted-foreground flex items-center gap-2">
                  <span>🔗</span>
                  <span>Sources &amp; Evidence</span>
                  <span className="text-muted-foreground font-normal tabular-nums">
                    ({Array.from(evidenceLinks.values()).reduce((s, a) => s + a.length, 0)})
                  </span>
                </h3>
                <div className="bg-card rounded-lg shadow-sm p-4 space-y-4">
                  {Array.from(evidenceLinks.entries())
                    .sort(([a], [b]) => {
                      const OP: EvidenceLinkType[] = [
                        'argo_workflow', 'argo_logs', 'raas_job',
                        'grafana', 'cloudwatch', 's3', 'github',
                      ]
                      const aIdx = OP.indexOf(a)
                      const bIdx = OP.indexOf(b)
                      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx
                      if (aIdx !== -1) return -1
                      if (bIdx !== -1) return 1
                      return 0
                    })
                    .map(([type, refs]) => (
                      <div key={type}>
                        <div className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
                          <span>{EVIDENCE_TYPE_ICONS[type] || '🔹'}</span>
                          <span>{EVIDENCE_TYPE_LABELS[type] || type}</span>
                          <span className="text-muted-foreground tabular-nums">
                            ({refs.length})
                          </span>
                        </div>
                        <div className="space-y-1 ml-5">
                          {refs.map((ref, i) => (
                            <a
                              key={`ev-${type}-${i}`}
                              href={ref.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block text-xs text-primary hover:underline truncate"
                              title={ref.url}
                            >
                              {ref.label || ref.url.replace(/^https?:\/\//, '').slice(0, 80)}
                            </a>
                          ))}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
