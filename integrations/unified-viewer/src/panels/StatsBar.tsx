// PATTERN SOURCE: 55-PATTERNS.md § StatsBar.tsx
//   + 55-07-PLAN.md Task 1
//   + integrations/system-health-dashboard/src/lib/healthRefreshMiddleware.ts:102-144
//     (SSE EventSource state pattern)
//
// CONTRACT: 55-UI-SPEC.md § 7 row 1 (Header stats bar) + § 6 (Layout map row 2)
//   + § 12 (LIVE indicator semantics — fixed bg-emerald-500 carve-out)
//   + § 16 row 1 (loading state copy "Connecting…", numbers as "—")
//
// Stats endpoint: GET /api/v1/stats (composed by obs-api Plan 55-06).
// SSE endpoint:   GET /api/v1/stream (OPTIONAL — falls back to 30s polling
//                 if the handshake fails per UI-SPEC § 12).
//
// The LIVE pulse uses a fixed semantic-green Tailwind token (`bg-emerald-500`),
// which is a UI-SPEC § 3.5 carve-out (item 5) from the primary-accent rule:
// the LIVE indicator MUST be visually distinct from the primary brand accent.

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ApiClient } from '@/api/ApiClient'
import { Logger } from '@/lib/logging'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

export interface ViewerStats {
  nodeCount: number
  edgeCount: number
  evidenceCount: number
  patternCount: number
  orphanCount: number
  componentCount: number
  connectivity: number
  lastUpdated: string
  activeSnapshot: { hash: string; message: string; date: string } | null
}

export interface StatsBarProps {
  apiClient: ApiClient
  system: 'coding' | 'okb'
}

type ChipState = 'live' | 'polling' | 'connecting'

// Exponential backoff schedule per UI-SPEC § 12 — 1s, 2s, 4s, 8s, 16s, capped.
const BACKOFF_SCHEDULE_MS: ReadonlyArray<number> = [1000, 2000, 4000, 8000, 16000]
export function backoffDelay(attempt: number): number {
  if (attempt < 0) return BACKOFF_SCHEDULE_MS[0]
  return BACKOFF_SCHEDULE_MS[Math.min(attempt, BACKOFF_SCHEDULE_MS.length - 1)]
}

interface MetricSlot {
  id: string
  label: string
  icon?: string
  /** Tooltip shown on hover (UI-SPEC § 10 hover semantics). */
  tooltip?: string
  formatter: (s: ViewerStats) => string
}

const METRICS: ReadonlyArray<MetricSlot> = [
  { id: 'nodes',        label: 'nodes',        icon: '📊', formatter: (s) => String(s.nodeCount) },
  { id: 'edges',        label: 'edges',        icon: '🔗', formatter: (s) => String(s.edgeCount) },
  { id: 'evidence',     label: 'evidence',     icon: '📑', formatter: (s) => String(s.evidenceCount) },
  { id: 'patterns',     label: 'patterns',     icon: '🔁', formatter: (s) => String(s.patternCount) },
  { id: 'orphans',      label: 'orphans',      icon: '🔸', formatter: (s) => String(s.orphanCount) },
  {
    id: 'connectivity',
    label: 'connectivity',
    icon: '⚙',
    tooltip: 'Largest connected component as fraction of all nodes',
    formatter: (s) => `${Math.round(s.connectivity * 100)}%`,
  },
]

interface FetchStatsArgs {
  apiClient: ApiClient
  signal?: AbortSignal
}

interface ApiEnvelope<T> {
  success: boolean
  data?: T
  error?: string
}

async function fetchStats({ apiClient, signal }: FetchStatsArgs): Promise<ViewerStats> {
  const url = `${apiClient.base}/api/v1/stats`
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal })
  if (!res.ok) {
    throw new Error(`${url} → HTTP ${res.status}`)
  }
  const body = (await res.json()) as ApiEnvelope<ViewerStats>
  if (!body.success || !body.data) {
    throw new Error(body.error || 'malformed /api/v1/stats response')
  }
  return body.data
}

export function StatsBar({ apiClient, system }: StatsBarProps) {
  const [chipState, setChipState] = useState<ChipState>('connecting')
  const sseRef = useRef<EventSource | null>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const attemptRef = useRef<number>(-1)
  // Latest SSE-pushed stats override the 30s poll until the next poll cycle.
  const [pushedStats, setPushedStats] = useState<ViewerStats | null>(null)

  // 30s polling fallback (always on — even when SSE is live, the poll
  // is a safety net per UI-SPEC § 12). When SSE pushes data, the
  // displayed value uses pushedStats; the poll just keeps the cache warm.
  const query = useQuery({
    queryKey: ['stats', system, apiClient.base],
    queryFn: ({ signal }) => fetchStats({ apiClient, signal }),
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
    staleTime: 15_000,
  })

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.EventSource !== 'function') {
      // SSE unavailable (server-side render or pre-EventSource environment).
      setChipState('polling')
      return
    }

    let cancelled = false

    const connect = () => {
      if (cancelled) return
      attemptRef.current += 1
      const url = `${apiClient.base}/api/v1/stream`
      const sse = new window.EventSource(url)
      sseRef.current = sse

      sse.onopen = () => {
        if (cancelled) return
        attemptRef.current = -1 // reset backoff after a successful handshake
        setChipState('live')
        Logger.info(Logger.Categories.API, `StatsBar SSE connection opened: ${url}`)
      }

      sse.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data) as ApiEnvelope<ViewerStats> | ViewerStats
          // Tolerate either the bare ViewerStats shape OR the {success,data}
          // envelope used by the obs-api.
          const stats = (parsed as ApiEnvelope<ViewerStats>).success !== undefined
            ? (parsed as ApiEnvelope<ViewerStats>).data ?? null
            : (parsed as ViewerStats)
          if (stats) setPushedStats(stats)
        } catch {
          // Ignore malformed frames — T-55-07-XX defensive parse.
        }
      }

      sse.onerror = () => {
        if (cancelled) return
        setChipState('polling')
        Logger.warn(Logger.Categories.API, `StatsBar SSE connection dropped (attempt #${attemptRef.current + 1})`)
        try { sse.close() } catch { /* ignore */ }
        sseRef.current = null
        const delay = backoffDelay(attemptRef.current)
        if (reconnectTimeoutRef.current !== null) {
          clearTimeout(reconnectTimeoutRef.current)
        }
        reconnectTimeoutRef.current = setTimeout(connect, delay)
      }
    }

    connect()

    return () => {
      cancelled = true
      if (reconnectTimeoutRef.current !== null) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }
      if (sseRef.current) {
        try { sseRef.current.close() } catch { /* ignore */ }
        sseRef.current = null
      }
    }
  }, [apiClient, system])

  const stats: ViewerStats | null = pushedStats ?? query.data ?? null
  const hasError = query.isError && !stats

  return (
    <div
      data-testid="stats-bar"
      className={
        'sticky top-16 z-19 h-10 bg-card flex items-center px-6 gap-6 text-xs ' +
        (hasError
          ? 'border-b border-destructive'
          : 'border-b border-border')
      }
    >
      {METRICS.map((m, i) => (
        <MetricCell key={m.id} metric={m} stats={stats} divider={i > 0} />
      ))}

      <div className="ml-auto flex items-center gap-2" data-testid="live-indicator">
        <ChipDot state={chipState} />
        <span className="text-xs">{chipLabel(chipState)}</span>
      </div>

      {hasError && (
        <span className="ml-2 text-destructive text-xs" data-testid="stats-bar-error">
          Could not load stats
        </span>
      )}
    </div>
  )
}

function chipLabel(state: ChipState): string {
  switch (state) {
    case 'live':       return 'LIVE'
    case 'polling':    return 'Polling'
    case 'connecting': return 'Connecting…'
  }
}

interface ChipDotProps {
  state: ChipState
}
function ChipDot({ state }: ChipDotProps) {
  // UI-SPEC §3.5 carve-out item 5: LIVE pulse uses bg-emerald-500
  // (NOT the primary accent token).
  if (state === 'live') {
    return (
      <div
        data-testid="live-indicator-dot"
        className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"
        aria-label="Live data stream"
      />
    )
  }
  return (
    <div
      data-testid="live-indicator-dot"
      className="w-2 h-2 rounded-full bg-muted-foreground"
      aria-label={state === 'connecting' ? 'Connecting to live stream' : 'Polling fallback'}
    />
  )
}

interface MetricCellProps {
  metric: MetricSlot
  stats: ViewerStats | null
  divider: boolean
}

function MetricCell({ metric, stats, divider }: MetricCellProps) {
  const value = stats ? metric.formatter(stats) : '—'
  const cell = (
    <span
      data-testid={`stats-metric-${metric.id}`}
      className="flex items-center gap-1 text-foreground/80"
    >
      {metric.icon && (
        <span aria-hidden className="text-muted-foreground">{metric.icon}</span>
      )}
      <span className="text-muted-foreground">{metric.label}</span>
      <span
        data-testid={`stats-metric-${metric.id}-value`}
        className="tabular-nums font-medium text-foreground"
      >
        {value}
      </span>
    </span>
  )

  const content = metric.tooltip ? (
    <Tooltip>
      <TooltipTrigger asChild>{cell}</TooltipTrigger>
      <TooltipContent>{metric.tooltip}</TooltipContent>
    </Tooltip>
  ) : (
    cell
  )

  return (
    <>
      {divider && <span aria-hidden className="text-muted-foreground/40">·</span>}
      {content}
    </>
  )
}
