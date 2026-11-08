'use client'

import React, { useEffect, useState } from 'react'
import { Activity } from 'lucide-react'
import HealthStatusCard from './health-status-card'
import { buildTrafficView, type TrafficCall, type TrafficView } from '@/lib/llm-traffic'

// "LLM Traffic": who is answering LLM calls, how fast, and whether calls reach
// their first-choice provider. The rules live in src/lib/llm-traffic.ts (and
// why it replaced the "LLM Pool Overhead" tile).
//
// Same-origin `/api/token-usage/recent` — server.js reverse-proxies it to the
// LLM proxy; the :3032 page is container-served and must not call the proxy's
// host:port itself. The feed answers at most 500 rows, newest first.

const REFRESH_INTERVAL = 30_000
const RECENT_LIMIT = 500

export default function LlmTrafficTile({ disabledReason }: { disabledReason?: string }) {
  const [view, setView] = useState<TrafficView | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (disabledReason) return
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch(`/api/token-usage/recent?limit=${RECENT_LIMIT}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = (await res.json()) as { data?: TrafficCall[] }
        if (cancelled) return
        setView(buildTrafficView(body?.data || [], Date.now(), RECENT_LIMIT))
        setError(null)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    }
    load()
    const timer = setInterval(load, REFRESH_INTERVAL)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [disabledReason])

  const items = error
    ? [{
        name: 'Recent calls',
        status: 'error' as const,
        description: `unavailable (${error})`,
        tooltip: 'The dashboard could not read the LLM proxy\'s recent-calls feed.',
      }]
    : view?.items ?? [{ name: 'Recent calls', status: 'unknown' as const, description: 'loading…' }]

  return (
    <HealthStatusCard
      title="LLM Traffic"
      icon={<Activity className="h-5 w-5 text-amber-500" />}
      items={items}
      footer={!error && view?.basis ? `Based on ${view.basis}` : undefined}
      disabledReason={disabledReason}
    />
  )
}
