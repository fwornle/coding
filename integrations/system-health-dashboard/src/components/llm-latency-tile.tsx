'use client'

import React, { useState, useEffect, useRef } from 'react'
import { Zap } from 'lucide-react'
import HealthStatusCard from './health-status-card'

// Phase 66-02: headline per-model median (p50) latency tile for the :3032
// system-health dashboard tile grid. This is the GLANCEABLE surface of the
// BOTH-surfaces requirement (D-01) — the Token Usage page by-model table is the
// drill-down. The median rides on the existing token-usage summary response
// (Plan 66-01 added by_model[].p50_latency_ms; no new endpoint).
//
// Data-source caveat (66-PATTERNS Redux note): the main dashboard reads Redux
// (state.healthReport) but the median is NOT in the health report, so this tile
// owns its own data via useState+useEffect+fetch. It fetches the dashboard
// SAME-ORIGIN proxy `/api/token-usage/*` (server.js forwards to the proxy over
// host.docker.internal), NOT the proxy host:port directly — the :3032 page is
// container-served and must ride server.js's reverse proxy.
//
// 66-02 ENHANCEMENT (post-checkpoint, user-directed deviation from D-05):
// the headline tile uses a 1-HOUR rolling window (hours=1), NOT the D-05
// rolling-24h. Rationale: a 24h median is dominated by stale pre-worker-pool
// history and reads red even when warm calls are ≤3s; 1h reflects current
// warm-pool health and goes green as history ages out. The Token Usage
// drill-down TABLE (token-usage.tsx) STAYS 24h — only this tile changes.
// A per-model latency TREND sparkline (median-per-bucket over the last 1h) lets
// an operator SEE how the assessment arose (climbing = regressing) rather than
// trusting one number. The sparkline is bucketed CLIENT-SIDE from the existing
// /api/token-usage/recent feed (rows carry timestamp+model+latency_ms) — NO
// proxy change (cheapest data source per the enhancement priority order 4a).

const REFRESH_INTERVAL = 30_000
const WINDOW_HOURS = 1
const WINDOW_MS = WINDOW_HOURS * 60 * 60 * 1000
// Number of equal time buckets across the window for the trend sparkline.
const SPARK_BUCKETS = 12
// Pull a generous page of recent calls (proxy caps at 500) and window them
// client-side. Heavy traffic may not span a full hour at 500 rows — the
// sparkline degrades gracefully to whatever in-window points it has.
const RECENT_LIMIT = 500

interface ModelRow {
  model: string
  calls: number
  total_tokens: number
  avg_latency?: number
  p50_latency_ms?: number
}

interface SummaryShape {
  by_model?: ModelRow[]
}

interface RecentCall {
  timestamp: string
  model: string
  latency_ms: number
}

interface RecentShape {
  data?: RecentCall[]
}

type ItemStatus = 'operational' | 'warning' | 'error' | 'offline' | 'reference'

interface TileItem {
  name: string
  status: ItemStatus
  description: string
  tooltip?: string
  badgeLabel?: string
  // Per-bucket median latency (ms) over the last 1h, oldest→newest. Drives the
  // inline trend sparkline. Empty/short arrays degrade to the number alone.
  spark?: number[]
}

// Reuse the token-usage.tsx formatter idiom (≥1000ms → "N.Ns").
function formatLatency(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms)}ms`
}

// D-04: haiku is the direct-path reference baseline — never a pool-health
// pass/fail signal. by_model rows carry no provider, so key on the model name.
function isHaikuModel(model: string): boolean {
  return /haiku/i.test(model)
}

// D-03 regression threshold envelope for claude-code fallback models
// (sonnet, opus): green ≤3000ms (PERF-01 warm bar) → amber 3000<x≤5000 → red
// >5000ms (median climbing toward the ~14000ms pre-worker-pool baseline).
function latencyStatus(ms: number): ItemStatus {
  if (ms <= 3000) return 'operational'
  if (ms <= 5000) return 'warning'
  return 'error'
}

// Latency-specific badge LABELS (not service-health words). The color still
// comes from the status (green/amber/red), but the text describes LATENCY so
// it doesn't read as a service outage next to the "Healthy" header (D-03):
//   green  → "OK"        (≤3s warm bar)
//   amber  → "Elevated"  (drifting up in the discretion band)
//   red    → "Regressed" (median climbing toward the ~14s baseline)
function latencyBadgeLabel(status: ItemStatus): string | undefined {
  switch (status) {
    case 'operational':
      return 'OK'
    case 'warning':
      return 'Elevated'
    case 'error':
      return 'Regressed'
    default:
      return undefined
  }
}

// Only surface the claude-code fallback models (sonnet, opus) plus the haiku
// reference row — the tile is about pool latency, not every model ever logged.
function isReportableModel(model: string): boolean {
  return /sonnet|opus|haiku/i.test(model)
}

// Lower-mid median (matches the proxy's even-count convention, 66-01).
function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor((sorted.length - 1) / 2)]
}

// Bucket the last-1h recent calls for one model into SPARK_BUCKETS equal time
// slices and compute the per-bucket median latency. Empty buckets are dropped
// (so a sparse stream still draws a line through the points it has) rather than
// forced to 0, which would draw a misleading dip to the axis.
function buildSparkline(calls: RecentCall[], model: string, now: number): number[] {
  const cutoff = now - WINDOW_MS
  const buckets: number[][] = Array.from({ length: SPARK_BUCKETS }, () => [])
  for (const c of calls) {
    if (c.model !== model) continue
    const t = Date.parse(c.timestamp)
    if (!Number.isFinite(t) || t < cutoff) continue
    let idx = Math.floor(((t - cutoff) / WINDOW_MS) * SPARK_BUCKETS)
    if (idx < 0) idx = 0
    if (idx >= SPARK_BUCKETS) idx = SPARK_BUCKETS - 1
    buckets[idx].push(c.latency_ms)
  }
  return buckets
    .map((b) => (b.length > 0 ? median(b) : null))
    .filter((v): v is number => v != null)
}

// Tiny inline SVG sparkline (no recharts dependency — keeps the tile cheap and
// avoids the recharts typing cluster noted in deferred-items.md). Renders the
// per-bucket median trend left→right (oldest→newest). Rising = regressing.
function Sparkline({ points, color }: { points: number[]; color: string }) {
  if (points.length < 2) return null
  const W = 88
  const H = 18
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const stepX = W / (points.length - 1)
  const path = points
    .map((v, i) => {
      const x = i * stepX
      // Invert Y so higher latency is higher on screen.
      const y = H - ((v - min) / span) * H
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      className="overflow-visible"
      aria-hidden="true"
    >
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

// Sparkline stroke color matches the status semantics so the trend reads in the
// same green/amber/red language as the badge.
function sparkColor(status: ItemStatus): string {
  switch (status) {
    case 'operational':
      return '#22c55e'
    case 'warning':
      return '#eab308'
    case 'error':
      return '#ef4444'
    default:
      return '#9ca3af'
  }
}

export default function LlmLatencyTile() {
  const [items, setItems] = useState<TileItem[]>([])
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    let cancelled = false

    const fetchData = async () => {
      try {
        // SAME-ORIGIN proxy — rides server.js's reverse proxy (66-PATTERNS Redux caveat).
        // 1h window (tile-scoped deviation from D-05) for the headline number;
        // recent feed (full rows) for the client-side trend sparkline.
        const [sumRes, recRes] = await Promise.all([
          fetch(`/api/token-usage/summary?hours=${WINDOW_HOURS}`),
          fetch(`/api/token-usage/recent?limit=${RECENT_LIMIT}`),
        ])
        if (!sumRes.ok) throw new Error(`HTTP ${sumRes.status}`)
        const data: SummaryShape = await sumRes.json()
        // Recent is best-effort: if it fails, the tile still renders the number,
        // just without a sparkline (degrade gracefully on sparse/missing data).
        let recentCalls: RecentCall[] = []
        if (recRes.ok) {
          const recData: RecentShape = await recRes.json()
          recentCalls = recData.data || []
        }
        if (cancelled) return

        const now = Date.now()
        const rows = (data.by_model || [])
          .filter((m) => isReportableModel(m.model) && m.p50_latency_ms != null)
          // Reportable models, claude-code fallback ranked by worst median first.
          .sort((a, b) => (b.p50_latency_ms ?? 0) - (a.p50_latency_ms ?? 0))

        const built: TileItem[] = rows.map((m) => {
          const p50 = m.p50_latency_ms as number
          const haiku = isHaikuModel(m.model)
          const status: ItemStatus = haiku ? 'reference' : latencyStatus(p50)
          const spark = buildSparkline(recentCalls, m.model, now)
          return {
            name: m.model,
            // Haiku → neutral 'reference' status (muted "reference" label, no
            // pass/fail badge) so it reads as the direct-path baseline, NOT a
            // down/error state (D-04). sonnet/opus → green/amber/red threshold.
            status,
            description: haiku
              ? `${formatLatency(p50)} median (reference) · last 1h`
              : `${formatLatency(p50)} median · last 1h`,
            // Latency-specific badge text (OK/Elevated/Regressed) so the red
            // state reads as a latency regression, not a service fault (D-03).
            badgeLabel: haiku ? 'reference' : latencyBadgeLabel(status),
            // Hover tooltips explain the assessment (window + threshold band).
            tooltip: haiku
              ? 'Direct-path OAuth baseline — not pool-graded (reference only).'
              : 'Median latency over last 1h. Warm target ≤3s; amber 3–5s; red >5s climbing toward the ~14s pre-pool baseline.',
            spark,
          }
        })

        setItems(built.length > 0 ? built : [{
          name: 'No fallback traffic',
          status: 'offline' as ItemStatus,
          description: 'No claude-code median in the last 1h',
        }])
      } catch {
        if (!cancelled) {
          setItems([{
            name: 'LLM proxy',
            status: 'error' as ItemStatus,
            description: 'Median unavailable (proxy unreachable)',
          }])
        }
      }
    }

    fetchData()
    intervalRef.current = setInterval(fetchData, REFRESH_INTERVAL)
    return () => {
      cancelled = true
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  // Strip spark before handing to HealthStatusCard (it owns name/status/desc/
  // tooltip/badge); render the sparkline ourselves underneath each row so the
  // operator sees the trend that produced the median.
  const cardItems = items.map(({ spark, ...rest }) => rest)

  return (
    <div className="relative">
      <HealthStatusCard
        title="LLM Latency"
        icon={<Zap className="h-5 w-5 text-amber-500" />}
        items={cardItems}
      />
      {/* Subtitle/legend + per-model trend sparklines overlaid under the card
          header. Kept muted/small, consistent with the card style. The legend
          makes the threshold (≤3s) and window (last 1h) visible at a glance. */}
      <div className="px-6 -mt-3 pb-3 space-y-1.5">
        <div className="text-[10px] text-muted-foreground">
          Per-model median · warm target ≤3s · last 1h
        </div>
        {items.some((i) => i.spark && i.spark.length >= 2) && (
          <div className="space-y-1 pt-1">
            {items
              .filter((i) => i.spark && i.spark.length >= 2)
              .map((i) => (
                <div key={i.name} className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-muted-foreground truncate">{i.name}</span>
                  <Sparkline points={i.spark as number[]} color={sparkColor(i.status)} />
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  )
}
