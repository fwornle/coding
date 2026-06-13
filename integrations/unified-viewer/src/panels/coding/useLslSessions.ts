// PATTERN SOURCE: 56.1-05-PLAN.md Task 1 step 1 + 56.1-PATTERNS.md §3
//
// Phase 56.1 Plan 05 — unconditional extraction of the LSL sessions
// TanStack Query hook out of LslTimelineStrip. Both LslTimelineStrip AND
// useNodeToBucketsIndex consume this hook; the strip's prior inline
// useQuery({ queryKey: ['lsl-sessions', ...], ... }) block is removed.
//
// Contract preserved from the inline strip implementation:
//   - queryKey: ['lsl-sessions', apiClient.base, windowKey]
//   - queryFn: fetchSessions(apiClient, WINDOW_MS[windowKey])
//   - refetchOnWindowFocus: false
//   - staleTime: 30_000
//
// The window-key indirection lets the strip keep its 24h/7d/30d/all
// toggle in local component state while still sharing the canonical
// query body with downstream consumers (useNodeToBucketsIndex). Callers
// that don't care about windowing (the pre-index hook) pass the strip's
// default 7d so the query cache is shared with the strip's first render.

import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/ApiClient'

export type LslWindow = '24h' | '7d' | '30d' | 'all'

// Re-exported from this module so consumers don't have to chase the
// constant across the strip file. Single source of truth for the window
// duration ladder used by both the strip toggle AND the pre-index rebuild
// trigger (sessions cache is partitioned by windowKey via queryKey).
export const WINDOW_MS: Record<LslWindow, number> = {
  '24h': 24 * 3600_000,
  '7d': 7 * 24 * 3600_000,
  '30d': 30 * 24 * 3600_000,
  'all': 365 * 24 * 3600_000,
}

export interface LslSession {
  id: string
  startAt: string // ISO
  endAt: string | null
  observationCount: number
  entityIds: string[]
}

async function fetchSessions(
  apiClient: ApiClient,
  windowMs: number,
): Promise<LslSession[]> {
  const since = new Date(Date.now() - windowMs).toISOString()
  const url = `${apiClient.base}/api/coding/lsl/sessions?since=${encodeURIComponent(since)}&limit=200`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) {
    throw new Error(`${url} → HTTP ${res.status}`)
  }
  const body = (await res.json()) as
    | { success: true; data: { sessions: LslSession[] } | LslSession[] }
    | { success: false; error: string }
  if (!body.success) {
    throw new Error(body.error || 'malformed /api/coding/lsl/sessions response')
  }
  const data = body.data
  if (Array.isArray(data)) return data
  return data?.sessions ?? []
}

/**
 * Phase 56.1 Plan 05 — TanStack Query hook for the LSL sessions cache.
 *
 * Consumed by:
 *   - LslTimelineStrip (the strip's render loop + tick render)
 *   - useNodeToBucketsIndex (the reverse-lookup pre-index)
 *
 * The default `windowKey === '7d'` matches the strip's initial mount so
 * a downstream consumer that doesn't manage its own window selector
 * shares the same cache entry as the strip's first render.
 */
export function useLslSessions(apiClient: ApiClient, windowKey: LslWindow = '7d') {
  return useQuery({
    queryKey: ['lsl-sessions', apiClient.base, windowKey],
    queryFn: () => fetchSessions(apiClient, WINDOW_MS[windowKey]),
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  })
}
