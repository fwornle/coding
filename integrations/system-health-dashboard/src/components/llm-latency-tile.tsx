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
// SAME-ORIGIN proxy `/api/token-usage/summary?hours=24` (server.js forwards to
// the proxy over host.docker.internal), NOT the proxy host:port directly — the
// :3032 page is container-served and must ride server.js's reverse proxy.

const REFRESH_INTERVAL = 30_000

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

type ItemStatus = 'operational' | 'warning' | 'error' | 'offline' | 'reference'

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

export default function LlmLatencyTile() {
  const [items, setItems] = useState<Array<{ name: string; status: ItemStatus; description: string; tooltip?: string; badgeLabel?: string }>>([])
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    let cancelled = false

    const fetchData = async () => {
      try {
        // SAME-ORIGIN proxy — rides server.js's reverse proxy (66-PATTERNS Redux caveat).
        const res = await fetch('/api/token-usage/summary?hours=24')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data: SummaryShape = await res.json()
        if (cancelled) return

        const rows = (data.by_model || [])
          .filter((m) => isReportableModel(m.model) && m.p50_latency_ms != null)
          // Reportable models, claude-code fallback ranked by worst median first.
          .sort((a, b) => (b.p50_latency_ms ?? 0) - (a.p50_latency_ms ?? 0))

        const built = rows.map((m) => {
          const p50 = m.p50_latency_ms as number
          const haiku = isHaikuModel(m.model)
          const status: ItemStatus = haiku ? 'reference' : latencyStatus(p50)
          return {
            name: m.model,
            // Haiku → neutral 'reference' status (muted "reference" label, no
            // pass/fail badge) so it reads as the direct-path baseline, NOT a
            // down/error state (D-04). sonnet/opus → green/amber/red threshold.
            status,
            description: haiku
              ? `${formatLatency(p50)} median (reference)`
              : `${formatLatency(p50)} median`,
            // Latency-specific badge text (OK/Elevated/Regressed) so the red
            // state reads as a latency regression, not a service fault (D-03).
            badgeLabel: haiku ? 'reference' : latencyBadgeLabel(status),
            tooltip: haiku
              ? 'Direct OAuth path — reference baseline, not a pool-health signal'
              : `Median (p50) latency over the last 24h — green ≤3s, red toward ~14s`,
          }
        })

        setItems(built.length > 0 ? built : [{
          name: 'No fallback traffic',
          status: 'offline' as ItemStatus,
          description: 'No claude-code median in the last 24h',
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

  return (
    <HealthStatusCard
      title="LLM Latency"
      icon={<Zap className="h-5 w-5 text-amber-500" />}
      items={items}
    />
  )
}
