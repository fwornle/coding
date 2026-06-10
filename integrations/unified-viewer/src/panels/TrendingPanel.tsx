// PORT-SPEC: VOKB TrendingPanel.tsx
//   (_work/rapid-automations/integrations/operational-knowledge-management/
//    viewer/src/components/KnowledgeGraph/TrendingPanel.tsx — full file)
//
// PATTERN SOURCE: 55-10-PLAN.md Task 1
//   + 55-PATTERNS.md § TrendingPanel.tsx (verbatim VOKB port)
//   + 55-UI-SPEC.md §5 empty-state copy + §6 layout map + §10 click semantics
//     row 7 + §16 row 5 error chip + §18 row 5 (60s polling)
//
// This file OVERWRITES the placeholder shipped by 55-08 Task 3. The lazy
// import line in FilterRail.tsx (`lazy(() => import('./TrendingPanel'))`)
// is untouched — only the file contents at that import path change. The
// default export contract is preserved so the lazy() call still resolves.
//
// DATA FLOW:
//   GET /api/v1/trends?top=20 (Plan 55-06) → TrendingPattern[]
//   TanStack Query polls every 60s per UI-SPEC §18 row 5. Polling is the
//   single update mechanism; SSE wiring is out of scope for trends per
//   55-PATTERNS.md (no VOKB SSE source either).
//
// ROW CLICK SEMANTICS (UI-SPEC §10 row 7):
//   setSelectedNodeId(pattern.nodeId). If the viewer is currently in
//   Triage mode, ALSO call setMode('kg') first so the selection lands on
//   the KG canvas (a Triage-mode selection has no visual target).
//
// The Sources-and-Evidence shape is NOT used here — that's an IssueTriage
// concern in Plan 55-10 Task 2. This panel renders ONLY the sparkline-row
// grid in the FilterRail.

import { useQuery } from '@tanstack/react-query'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { ChevronDown } from 'lucide-react'
import { Logger } from '@/lib/logging'
import { useViewerStore, type TrendingPattern } from '@/store/viewer-store'
import type { ApiClient } from '@/api/ApiClient'

/** Score-coded dot color — verbatim from VOKB TrendingPanel.tsx:14-18. */
function scoreColor(score: number): string {
  if (score > 1.5) return 'bg-green-500'
  if (score > 1.0) return 'bg-amber-400'
  return 'bg-gray-300'
}

/** Score-coded badge background — verbatim from VOKB TrendingPanel.tsx:20-24. */
function scoreBadgeClass(score: number): string {
  if (score > 1.5)
    return 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
  if (score > 1.0)
    return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
  return 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
}

/** Pure-function fetcher; throws on non-2xx or success=false envelope. */
async function fetchTrends(apiClient: ApiClient): Promise<TrendingPattern[]> {
  const url = `${apiClient.base}/api/v1/trends?top=20`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) {
    throw new Error(`${url} → HTTP ${res.status}`)
  }
  const body = (await res.json()) as
    | { success: true; data: { patterns: TrendingPattern[] } }
    | { success: false; error: string }
  if (!body.success) {
    throw new Error(body.error || 'malformed /api/v1/trends response')
  }
  return body.data?.patterns ?? []
}

export interface TrendingPanelProps {
  apiClient: ApiClient
}

/**
 * Inline SVG sparkline. Three data points (7d, 30d, 90d) projected onto a
 * 32×12 grid. VOKB doesn't bundle a chart library — this matches its
 * "render as raw SVG segments" approach (55-PATTERNS.md).
 */
function Sparkline({
  testid,
  trends,
}: {
  testid: string
  trends: { last7Days: number; last30Days: number; last90Days: number }
}) {
  const values = [trends.last7Days, trends.last30Days, trends.last90Days]
  const max = Math.max(1, ...values)
  // Newest-first → render the line right-to-left so the "now" point is on the right.
  const points = values.map((v, i) => ({
    x: 32 - (i / (values.length - 1)) * 32,
    y: 12 - (v / max) * 10 - 1,
  }))
  return (
    <svg
      data-testid={testid}
      width={32}
      height={12}
      viewBox="0 0 32 12"
      className="text-muted-foreground/60"
      aria-hidden
    >
      {points.slice(1).map((p, i) => {
        const prev = points[i]
        return (
          <line
            key={i}
            x1={prev.x}
            y1={prev.y}
            x2={p.x}
            y2={p.y}
            stroke="currentColor"
            strokeWidth={1}
          />
        )
      })}
    </svg>
  )
}

export default function TrendingPanel({ apiClient }: TrendingPanelProps) {
  const setSelectedNodeId = useViewerStore((s) => s.setSelectedNode)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['trends', apiClient.base],
    queryFn: () => fetchTrends(apiClient),
    // UI-SPEC §18 row 5 — 60s polling cadence.
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  })

  const patterns: TrendingPattern[] = data ?? []

  const handleRowClick = (pattern: TrendingPattern) => {
    // UI-SPEC §10 row 7 — if in triage mode, switch back to KG first so the
    // KG selection has a visual target.
    const currentMode = useViewerStore.getState().mode
    if (currentMode === 'triage') {
      useViewerStore.getState().setMode('kg')
    }
    setSelectedNodeId(pattern.nodeId)
    Logger.info(
      Logger.Categories.PANELS,
      `TrendingPanel row clicked: ${pattern.nodeId} (${pattern.entity?.name ?? '<unnamed>'})`,
    )
  }

  return (
    <Collapsible
      defaultOpen
      data-testid="trending-panel"
      className="space-y-1"
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="w-full flex items-center justify-between text-xs font-medium text-muted-foreground hover:text-foreground"
          aria-label="Toggle Trending Patterns section"
        >
          <span className="flex items-center gap-1">
            <span>Trending Patterns</span>
            {patterns.length > 0 && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 tabular-nums"
                data-testid="trending-count-badge"
              >
                {patterns.length}
              </span>
            )}
          </span>
          <ChevronDown className="h-3 w-3" aria-hidden />
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent className="space-y-1">
        {isLoading && (
          <div
            data-testid="trending-loading"
            className="text-[10px] text-muted-foreground italic px-1 py-1"
          >
            Loading trends…
          </div>
        )}

        {isError && (
          <div
            data-testid="trending-error"
            className="text-[10px] text-destructive px-1 py-1 flex items-center gap-2"
          >
            <span>Could not load trends</span>
            <span>—</span>
            <button
              type="button"
              className="underline hover:text-destructive/80"
              onClick={() => {
                // Click triggers a manual cache invalidation via a re-mount
                // hint; TanStack Query's refetchInterval otherwise drives
                // recovery. Keeping the affordance simple matches UI-SPEC §16
                // row 5 ("Could not load trends — retry" chip).
                Logger.info(
                  Logger.Categories.PANELS,
                  'TrendingPanel retry chip clicked',
                )
                window.location.reload()
              }}
            >
              retry
            </button>
          </div>
        )}

        {!isLoading && !isError && patterns.length === 0 && (
          <div
            data-testid="trending-empty"
            className="text-[10px] text-muted-foreground space-y-1 px-1 py-1"
          >
            <p>No recurring patterns detected yet.</p>
            <p className="italic text-muted-foreground/80">
              Patterns appear here when the same failure modes are ingested
              multiple times. Run more analyses to build occurrence data.
            </p>
          </div>
        )}

        {!isLoading && !isError && patterns.length > 0 && (
          <ul className="space-y-0.5" data-testid="trending-list">
            {patterns.map((pattern) => {
              const name = pattern.entity?.name ?? pattern.nodeId
              const trends = pattern.trends
              const dotTestId = `trending-row-${pattern.nodeId}-dot`
              const badgeTestId = `trending-row-${pattern.nodeId}-score-badge`
              const countsTestId = `trending-row-${pattern.nodeId}-trend-counts`
              const sparkTestId = `trending-row-${pattern.nodeId}-sparkline`
              const allZero =
                trends &&
                trends.last7Days === 0 &&
                trends.last30Days === 0 &&
                trends.last90Days === 0
              return (
                <li key={pattern.nodeId}>
                  <button
                    type="button"
                    data-testid={`trending-row-${pattern.nodeId}`}
                    onClick={() => handleRowClick(pattern)}
                    className="w-full flex items-center justify-between text-left px-1 py-0.5 rounded hover:bg-accent transition-colors"
                    title={name}
                  >
                    <span className="flex items-center gap-1.5 flex-1 min-w-0 mr-1">
                      <span
                        data-testid={dotTestId}
                        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${scoreColor(
                          pattern.trendScore,
                        )}`}
                        aria-hidden
                      />
                      <span className="text-xs text-foreground/80 truncate">
                        {name}
                      </span>
                    </span>
                    <span className="flex items-center gap-1 flex-shrink-0">
                      <Sparkline testid={sparkTestId} trends={trends} />
                      <span
                        data-testid={badgeTestId}
                        className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium tabular-nums ${scoreBadgeClass(
                          pattern.trendScore,
                        )}`}
                      >
                        {pattern.trendScore.toFixed(1)}
                      </span>
                      <span
                        data-testid={countsTestId}
                        className={`text-[10px] tabular-nums ${
                          allZero
                            ? 'text-muted-foreground/40'
                            : 'text-muted-foreground'
                        }`}
                        title={
                          allZero
                            ? 'No occurrences recorded yet — counts update on new ingestions (7d / 30d / 90d)'
                            : `Occurrences: ${trends.last7Days} in 7 days, ${trends.last30Days} in 30 days, ${trends.last90Days} in 90 days`
                        }
                      >
                        {trends.last7Days}/{trends.last30Days}/{trends.last90Days}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
