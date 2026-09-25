// One query key and one fetcher for `/api/v1/stats`.
//
// Two surfaces read this endpoint now — the StatsBar across the top and the
// Graph quality panel in the rail. They must never show different numbers for
// the same metric, and the cheapest guarantee of that is not "be careful" but
// a shared react-query key: the second consumer hits the cache, so there is
// one fetch, one cached payload, one answer.
//
// WHAT IS DELIBERATELY *NOT* HERE. StatsBar also holds an SSE override
// (`/api/v1/stream`) that pushes fresher stats between polls, along with the
// live/polling/connecting chip. That stays in StatsBar: it owns the chip, the
// backoff schedule and the reconnect lifecycle, and hoisting it here to serve
// a panel that is collapsed by default would move a socket's lifetime out of
// the component that displays its state. The panel is content with the 30s
// poll — nothing it shows changes second to second.

import { useQuery } from '@tanstack/react-query'

import type { ApiClient } from '@/api/ApiClient'
import type { ViewerStats } from './StatsBar'

interface ApiEnvelope<T> {
  success: boolean
  data?: T
  error?: string
}

/** The shared cache key. Both consumers must pass the same one or they fetch
 *  twice and can disagree — which is the whole point of exporting it. */
export function statsQueryKey(system: string, base: string): readonly unknown[] {
  return ['stats', system, base]
}

export async function fetchViewerStats(
  apiClient: ApiClient,
  signal?: AbortSignal,
): Promise<ViewerStats> {
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

/** Poll-only view of the stats payload, for consumers that do not own the SSE. */
export function useViewerStats(apiClient: ApiClient, system: string) {
  return useQuery({
    queryKey: statsQueryKey(system, apiClient.base),
    queryFn: ({ signal }) => fetchViewerStats(apiClient, signal),
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
    staleTime: 15_000,
  })
}
