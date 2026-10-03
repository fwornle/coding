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
// The window-key indirection lets the strip keep its 24h/7d/30d/1y
// toggle in local component state while still sharing the canonical
// query body with downstream consumers (useNodeToBucketsIndex). Callers
// that don't care about windowing (the pre-index hook) pass the strip's
// default 7d so the query cache is shared with the strip's first render.
//
// Phase 61 Plan 03 — honesty plumbing (LSLTIME-01/02/03):
//   - The client requests a BOUNDED cap of limit=500 (the backend
//     LSL_MAX_LIMIT). The fetch is never unbounded; if a window holds
//     more sessions than the cap, the array is silently sliced server-side.
//   - To make that bound honest, fetchSessions returns { sessions, total }
//     where `total` (M) is the full pre-slice count and sessions.length (N)
//     is what's actually rendered. The strip surfaces a "showing N of M"
//     badge whenever N < M so the operator can never be silently truncated.
//   - The '24h'/'7d'/'30d'/'1y' ladder is label-honest: '1y' replaces the
//     prior misnamed 'all' (which was always a 365-day cap, never "all").

import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/ApiClient'
import { useViewerStore } from '@/store/viewer-store'

export type LslWindow = '24h' | '7d' | '30d' | '1y'

// Re-exported from this module so consumers don't have to chase the
// constant across the strip file. Single source of truth for the window
// duration ladder used by both the strip toggle AND the pre-index rebuild
// trigger (sessions cache is partitioned by windowKey via queryKey).
export const WINDOW_MS: Record<LslWindow, number> = {
  '24h': 24 * 3600_000,
  '7d': 7 * 24 * 3600_000,
  '30d': 30 * 24 * 3600_000,
  '1y': 365 * 24 * 3600_000, // key renamed from 'all'; 365d value unchanged per D-04
}

export interface LslSession {
  id: string
  startAt: string // ISO
  endAt: string | null
  observationCount: number
  entityIds: string[]
  /** The repo's project the transcript belongs to (T6: one strip, every repo). */
  project?: string
  // Provenance discriminator from Plan 01's backend (D-07/D-09):
  // 'batch' = any matched entity tagged manual/wave-analysis; 'online' = auto.
  // Consumed by the strip's fillClass branch (amber=batch, pink=online).
  source?: 'online' | 'batch'
}

/**
 * The rail's selection as a `?teams=` value: '' for "all" (no filter). The
 * server expands team ids to their repos' projects (lib/teams/scope.mjs), and
 * filters BEFORE its 500-row cap — filtering here after the cap would show a
 * truncated strip for a small team. `__none__` sends a team that matches
 * nothing rather than skipping the request.
 */
export function teamsParam(selected: ReadonlySet<string>): string {
  if (selected.size === 0) return ''
  if (selected.has('__none__')) return '__none__'
  return [...selected].sort().join(',')
}

async function fetchSessions(
  apiClient: ApiClient,
  windowMs: number,
  teams = '',
): Promise<{ sessions: LslSession[]; total?: number }> {
  const since = new Date(Date.now() - windowMs).toISOString()
  // Bounded cap = backend LSL_MAX_LIMIT (500). Server slices to this; `total`
  // in the envelope is the full pre-slice M so the strip's N-of-M badge can
  // tell the operator the truth when N < M.
  const url = `${apiClient.base}/api/coding/lsl/sessions?since=${encodeURIComponent(since)}&limit=500`
    + (teams ? `&teams=${encodeURIComponent(teams)}` : '')
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) {
    throw new Error(`${url} → HTTP ${res.status}`)
  }
  const body = (await res.json()) as
    | {
        success: true
        data: { sessions: LslSession[]; total?: number; limit?: number } | LslSession[]
      }
    | { success: false; error: string }
  if (!body.success) {
    throw new Error(body.error || 'malformed /api/coding/lsl/sessions response')
  }
  const data = body.data
  if (Array.isArray(data)) return { sessions: data, total: data.length }
  return { sessions: data?.sessions ?? [], total: data?.total }
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
  const teams = teamsParam(useViewerStore((s) => s.selectedTeams))
  return useQuery({
    queryKey: ['lsl-sessions', apiClient.base, windowKey, teams],
    queryFn: () => fetchSessions(apiClient, WINDOW_MS[windowKey], teams),
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  })
}
