import { useEffect } from 'react'
import { RefreshCw } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useAppSelector, useAppDispatch } from '@/store'
import {
  fetchRuns,
  selectRuns,
  selectRunsLoading,
  selectRunsError,
  selectFilteredRuns,
  scoreStateOf,
  type Run,
} from '@/store/slices/performanceSlice'
import { FacetedSidebar } from '@/components/performance/faceted-sidebar'
import { RunsTable } from '@/components/performance/runs-table'
import { PerformanceTimeline } from '@/components/performance/timeline'
import { ScoreDrawer } from '@/components/performance/score-drawer'
import { ReportsSubview } from '@/components/performance/reports-subview'
import { MeasurementControl } from '@/components/performance/measurement-control'
import { RunCompare } from '@/components/performance/run-compare'

// DASH-01/DASH-02 Performance page. Layout mirrors token-usage.tsx (header +
// summary Card focal point + Tabs body) but ALL shared state lives in the
// `performance` Redux slice — runs/facets/selectedRun/timeline are read via
// useAppSelector and mutated via dispatched thunks/actions. No page-local
// useState holds shared state; no fetch() lives in this component.

function median(values: number[]): number | null {
  const nums = values.filter((v): v is number => v != null)
  if (nums.length === 0) return null
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function formatTokens(n: number | null): string {
  if (n == null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function SummaryCards({ runs }: { runs: Run[] }) {
  const total = runs.length
  const scored = runs.filter((r) => scoreStateOf(r) === 'scored').length
  const totalTokens = runs.reduce((sum, r) => sum + (r.outcome?.totalTokens ?? 0), 0)
  const medWallclock = median(
    runs.map((r) => (typeof r.wallclock_per_step === 'number' ? r.wallclock_per_step : NaN)).filter((n) => !Number.isNaN(n))
  )

  return (
    <div className="grid grid-cols-4 gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Total runs</CardDescription>
          <CardTitle className="text-3xl">{total}</CardTitle>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Scored runs</CardDescription>
          <CardTitle className="text-3xl">{scored}</CardTitle>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Total tokens</CardDescription>
          <CardTitle className="text-3xl">{formatTokens(totalTokens)}</CardTitle>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Median wallclock / step</CardDescription>
          <CardTitle className="text-3xl">
            {medWallclock == null ? '—' : `${medWallclock.toFixed(1)}s`}
          </CardTitle>
        </CardHeader>
      </Card>
    </div>
  )
}

export function PerformancePage() {
  const dispatch = useAppDispatch()
  const runs = useAppSelector(selectRuns)
  const loading = useAppSelector(selectRunsLoading)
  const error = useAppSelector(selectRunsError)
  const filtered = useAppSelector(selectFilteredRuns)

  useEffect(() => {
    dispatch(fetchRuns())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (loading && runs.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error && runs.length === 0) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertDescription>
            Failed to load performance data. Check that the experiment API (vkb-server) is reachable.
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Performance</h1>
        <p className="text-sm text-muted-foreground">
          Task-anchored query over experiment runs — cost, route quality, and outcome scores
        </p>
      </div>

      {/* Summary cards — the visual focal point */}
      <SummaryCards runs={runs} />

      {/* Measurement lifecycle control (start/stop the active span) */}
      <MeasurementControl />

      {/* Body — Tabs with a Runs view + a Reports sub-view (D-05: a second Tabs
          value INSIDE Performance, NOT a top-level nav tab). */}
      <Tabs defaultValue="runs">
        <TabsList>
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="compare" data-testid="compare-tab">Compare</TabsTrigger>
          <TabsTrigger value="reports" data-testid="reports-tab">Reports</TabsTrigger>
        </TabsList>
        <TabsContent value="runs" className="mt-4">
          <div className="grid grid-cols-[260px_1fr] gap-6">
            <FacetedSidebar />
            <div className="space-y-6">
              <RunsTable />
              <PerformanceTimeline />
            </div>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {filtered.length} of {runs.length} runs shown
          </p>
        </TabsContent>
        <TabsContent value="compare" className="mt-4">
          <RunCompare />
        </TabsContent>
        <TabsContent value="reports" className="mt-4">
          <ReportsSubview />
        </TabsContent>
      </Tabs>

      {/* Score-override drawer — driven by slice overrideTaskId (no page-local open
          flag). Mounted once; opens via a row's "Edit scores" button. Decoupled from
          row selection so the inline Timeline panel is viewable without this overlay. */}
      <ScoreDrawer />
    </div>
  )
}
