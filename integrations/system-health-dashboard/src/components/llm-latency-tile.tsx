'use client'

import React, { useState, useEffect, useRef } from 'react'
import { Zap } from 'lucide-react'
import HealthStatusCard from './health-status-card'

// Phase 66-02: headline per-model median (p50) latency tile for the :3032
// system-health dashboard tile grid. This is the GLANCEABLE surface of the
// BOTH-surfaces requirement (D-01) — the Token Usage page by-model table is the
// drill-down.
//
// Data-source caveat (66-PATTERNS Redux note): the main dashboard reads Redux
// (state.healthReport) but the median is NOT in the health report, so this tile
// owns its own data via useState+useEffect+fetch. It fetches the dashboard
// SAME-ORIGIN proxy `/api/token-usage/*` (server.js forwards to the proxy over
// host.docker.internal), NOT the proxy host:port directly — the :3032 page is
// container-served and must ride server.js's reverse proxy.
//
// 66-02 ENHANCEMENT v4 (post-checkpoint, operator-directed redesign — supersedes
// the 1h-window iteration): the tile is now LAST-N-CALLS + ALWAYS-KEEP-ROWS.
// Why the change: the 1h `summary?hours=1` window DROPPED the sonnet/opus rows
// entirely whenever there were no claude-code fallback calls in the last hour
// (the tile went blank except for haiku — "no more sonnet?"). The fix:
//   1. SINGLE data source = the `/api/token-usage/recent` feed. BOTH the headline
//      median AND the sparkline derive from the same recent calls, so they can no
//      longer contradict (the old headline came from `summary?hours=1` while the
//      sparkline came from `/recent`). We no longer fetch `summary` in this tile.
//   2. Per-model median over the LAST ~50 calls of that model (filter by family,
//      newest-first, slice 50, lower-mid median — same convention as 66-01).
//   3. ALWAYS render fixed rows for the claude-code fallback families (sonnet,
//      opus) plus the haiku reference, matched by FAMILY KEYWORD so a version bump
//      (claude-sonnet-4.6 → 4.x) doesn't drop the row. A family with zero recent
//      calls renders a muted "no recent calls" placeholder instead of vanishing.
// Threshold + reference semantics (D-03/D-04) are unchanged: sonnet/opus green
// ≤3s / amber 3–5s / red >5s; haiku is the no-threshold direct-path reference.
//
// 66-04 RE-POINT (PERF-03 UAT gap closure): the graded VALUE is swapped from
// total end-to-end `latency_ms` to the worker-pool SPAWN/QUEUE `overhead_ms`
// that Plan 66-03 added to the /recent feed. Total sonnet latency (~123s,
// generation-dominated) could never go green and hid pool regressions; the
// overhead component (warm reuse ≈ 0; cold spawn ~10–14s) is exactly what the
// pool affects, so the proven ≤3s/amber/red envelope, sparkline, and
// always-keep-rows UX are UNCHANGED — only the value the tile grades changed.

const REFRESH_INTERVAL = 30_000
// How many most-recent calls per model the median + sparkline ride on.
const SAMPLE_SIZE = 50
// Pull a generous page so each tracked family can accumulate up to SAMPLE_SIZE
// samples even when one busy model dominates the feed. Bounded — never unbounded.
const RECENT_LIMIT = 1000

// Tracked model families, in display order. Matched by keyword (case-insensitive)
// so a version bump doesn't break the row set. `reference` families carry no
// pass/fail threshold (haiku direct-path baseline, D-04).
const TRACKED_FAMILIES: Array<{ family: string; label: string; reference: boolean }> = [
  { family: 'sonnet', label: 'sonnet', reference: false },
  { family: 'opus', label: 'opus', reference: false },
  { family: 'haiku', label: 'haiku', reference: true },
]

interface RecentCall {
  timestamp: string
  model: string
  latency_ms: number
  // Phase 66-04: per-call worker-pool SPAWN/QUEUE overhead (ms). 66-03 added
  // this on the /recent feed: numeric for claude-code pool calls (dispatch-start
  // → first-stdout, EXCLUDES generation), null for the direct-OAuth path (haiku),
  // execFile-overflow calls, and pre-66-03 legacy rows. The tile now GRADES this
  // component — not total latency_ms — because it is what the worker pool actually
  // affects (warm reuse ≈ 0; cold spawn climbing toward the ~14s baseline).
  overhead_ms: number | null
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
  // Per-call worker-pool overhead (ms) over the last ~50 calls for this family,
  // oldest→newest. Drives the inline trend sparkline. Empty/short arrays degrade
  // to the number.
  spark?: number[]
  // True when the family had NO recent calls — render a muted placeholder row
  // (no badge, no sparkline) instead of dropping it.
  empty?: boolean
}

// Reuse the token-usage.tsx formatter idiom (≥1000ms → "N.Ns").
function formatLatency(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms)}ms`
}

// D-03 regression threshold envelope for claude-code fallback models
// (sonnet, opus). Phase 66-04: this now grades the worker-pool SPAWN OVERHEAD,
// which makes the bar MEANINGFUL — green ≤3000ms (warm pool reuse, near-zero
// overhead) → amber 3000<x≤5000 → red >5000ms (overhead climbing toward the
// ~14000ms cold-spawn baseline). Generation time is excluded from the metric.
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

// Lower-mid median (matches the proxy's even-count convention, 66-01).
function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor((sorted.length - 1) / 2)]
}

// The most-recent SAMPLE_SIZE calls for one family that carry a NON-NULL
// worker-pool overhead, NEWEST-FIRST. Phase 66-04: the graded sample is now the
// overhead component, so rows with a NULL overhead_ms (direct/haiku calls,
// execFile-overflow, or pre-66-03 legacy rows) are EXCLUDED — they have no pool
// overhead to grade and would otherwise poison the median or render NaN
// (T-66-04-02). The /recent feed is already ordered newest-first, but sort
// defensively so a feed ordering change can't silently skew the "last N" slice.
function recentSamplesForFamily(calls: RecentCall[], family: string): RecentCall[] {
  return calls
    .filter((c) => new RegExp(family, 'i').test(c.model) && Number.isFinite(c.overhead_ms))
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, SAMPLE_SIZE)
}

// Tiny inline SVG sparkline (no recharts dependency — keeps the tile cheap and
// avoids the recharts typing cluster noted in deferred-items.md). Renders the
// per-call overhead trend left→right (oldest→newest). Rising = pool regressing.
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
        // SAME-ORIGIN proxy — rides server.js's reverse proxy (66-PATTERNS Redux
        // caveat). SINGLE source of truth: the recent-calls feed drives BOTH the
        // headline median AND the sparkline, so they cannot contradict.
        const recRes = await fetch(`/api/token-usage/recent?limit=${RECENT_LIMIT}`)
        if (!recRes.ok) throw new Error(`HTTP ${recRes.status}`)
        const recData: RecentShape = await recRes.json()
        const recentCalls: RecentCall[] = recData.data || []
        if (cancelled) return

        // ALWAYS emit a row per tracked family (sonnet, opus, haiku) — never drop
        // a model when it's quiet. A family with no recent calls renders a muted
        // "no recent calls" placeholder instead of vanishing (operator's fix).
        const built: TileItem[] = TRACKED_FAMILIES.map(({ family, label, reference }) => {
          const samples = recentSamplesForFamily(recentCalls, family)
          // Best-known model name from the samples, else the family label.
          const name = samples.length > 0 ? samples[0].model : label

          if (samples.length === 0) {
            // Phase 66-04: zero non-null overhead samples. For haiku this is the
            // STEADY state — it rides the direct OAuth path with no worker-pool
            // overhead (D-04 spirit), so it renders as an explicit reference row.
            // For a graded family (sonnet/opus) it means no recent POOL calls in
            // the feed (all warm-direct/overflow/quiet) — render the muted
            // "no recent pool calls" placeholder instead of dropping the row.
            return {
              name,
              // Neutral — no pass/fail. A quiet model is not a fault.
              status: 'reference' as ItemStatus,
              description: reference
                ? 'direct path — no pool overhead'
                : 'no recent pool calls',
              badgeLabel: reference ? 'reference' : '—',
              tooltip: reference
                ? 'Direct-path OAuth — no worker-pool overhead (reference only).'
                : 'No recent worker-pool calls for this model in the overhead feed.',
              empty: true,
            }
          }

          // Median over the per-call OVERHEAD samples (filtered non-null above).
          const p50 = median(samples.map((c) => c.overhead_ms as number))
          // Sparkline rides the SAME overhead samples, oldest→newest so headline
          // + trend agree.
          const spark = samples.map((c) => c.overhead_ms as number).reverse()
          const status: ItemStatus = reference ? 'reference' : latencyStatus(p50)
          return {
            name,
            // Haiku → neutral 'reference' status (no pool overhead — direct path,
            // D-04). sonnet/opus → green/amber/red threshold against OVERHEAD.
            status,
            description: reference
              ? `${formatLatency(p50)} overhead median (reference) · last ~${samples.length} calls`
              : `${formatLatency(p50)} overhead median · last ~${samples.length} calls`,
            // Overhead-specific badge text (OK/Elevated/Regressed) so the red
            // state reads as a pool-overhead regression, not a service fault (D-03).
            badgeLabel: reference ? 'reference' : latencyBadgeLabel(status),
            // Hover tooltips explain the assessment (sample basis + threshold band).
            tooltip: reference
              ? 'Direct-path OAuth — no worker-pool overhead (reference only).'
              : 'Median spawn/queue overhead over the last ~50 calls. Warm reuse near 0; amber 3–5s; red >5s climbing toward the ~14s cold-spawn baseline. Excludes model generation time.',
            spark,
          }
        })

        setItems(built)
      } catch {
        if (!cancelled) {
          setItems([{
            name: 'LLM proxy',
            status: 'error' as ItemStatus,
            description: 'Overhead median unavailable (proxy unreachable)',
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

  // Strip tile-only fields before handing to HealthStatusCard (it owns name/
  // status/desc/tooltip/badge); render the sparkline ourselves underneath each
  // row so the operator sees the trend that produced the median.
  const cardItems = items.map(({ spark, empty, ...rest }) => rest)

  return (
    <div className="relative">
      <HealthStatusCard
        title="LLM Pool Overhead"
        icon={<Zap className="h-5 w-5 text-amber-500" />}
        items={cardItems}
      />
      {/* Subtitle/legend + per-model overhead trend sparklines overlaid under the
          card header. Kept muted/small, consistent with the card style. The legend
          makes the threshold (≤3s) and basis (last ~50 calls) visible at a glance. */}
      <div className="px-6 -mt-3 pb-3 space-y-1.5">
        <div className="text-[10px] text-muted-foreground">
          Per-model spawn overhead · warm target ≤3s · last ~50 calls
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
