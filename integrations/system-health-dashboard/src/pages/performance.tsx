import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useAppSelector, useAppDispatch } from '@/store'
import {
  fetchRuns,
  setIncludePending,
  selectIncludePending,
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
import { ContextCacheExplainer } from '@/components/performance/context-cache-explainer'
import { ReportsSubview } from '@/components/performance/reports-subview'
import { MeasurementControl } from '@/components/performance/measurement-control'
import { RunCompare } from '@/components/performance/run-compare'
import { DifferenceViewer } from '@/components/performance/difference-viewer'
import { ExperimentLauncher } from '@/components/performance/experiment-launcher'
import { RunMonitor } from '@/components/performance/run-monitor'

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

// D-10: the quarantine control re-homed from the faceted sidebar to the page
// header, now WITH a live count — "Show quarantined (N)" where N is the number
// of quarantined (pending) runs among the already-fetched rows. Toggling it
// re-fetches with ?includePending=<next> (the fetch param is UNCHANGED from the
// old sidebar home). The count is a client-side filter over fetched rows — a
// low-value internal metric, never authoritative (T-86-05-03). There is no
// `run.quarantined` field; `pending` is the quarantine flag (Run.pending).
function QuarantineHeaderToggle({ runs }: { runs: Run[] }) {
  const dispatch = useAppDispatch()
  const includePending = useAppSelector(selectIncludePending)
  const quarantinedCount = runs.filter((r) => r.pending === true).length

  return (
    <label
      htmlFor="include-pending"
      className="flex cursor-pointer items-center gap-2 text-sm"
      data-testid="include-pending-row"
    >
      <Checkbox
        id="include-pending"
        data-testid="include-pending-toggle"
        checked={includePending}
        onCheckedChange={(checked) => {
          const next = checked === true
          dispatch(setIncludePending(next))
          dispatch(fetchRuns(next))
        }}
      />
      <span className="truncate">Show quarantined ({quarantinedCount})</span>
    </label>
  )
}

export function PerformancePage() {
  const dispatch = useAppDispatch()
  const runs = useAppSelector(selectRuns)
  const loading = useAppSelector(selectRunsLoading)
  const error = useAppSelector(selectRunsError)
  const filtered = useAppSelector(selectFilteredRuns)

  // D-08: the body Tabs are CONTROLLED so the runs-table "Compare selected (2)"
  // CTA can switch to the Compare tab (which mounts the DifferenceViewer).
  const [activeTab, setActiveTab] = useState('runs')

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

      {/* Summary cards — the visual focal point — with the D-10 quarantine
          control re-homed here (out of the sidebar) with a live count. */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <SummaryCards runs={runs} />
        </div>
        <div className="pt-2">
          <QuarantineHeaderToggle runs={runs} />
        </div>
      </div>

      {/* Measurement lifecycle control (start/stop the active span) beside the
          Experiment Launcher (spec picker + matrix preview + capture_raw_bodies
          + re-run pre-fill target). Two-column so the launcher renders next to
          Measurement Control per the Phase 85 control-center layout. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <MeasurementControl />
        <ExperimentLauncher />
      </div>

      {/* 5s-polling variant×repeat cell-grid monitor — self-gates on activeRunId
          (renders nothing until a run is launched, then polls run-status). */}
      <RunMonitor />

      {/* Body — Tabs with a Runs view + a Reports sub-view (D-05: a second Tabs
          value INSIDE Performance, NOT a top-level nav tab). */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="compare" data-testid="compare-tab">Compare</TabsTrigger>
          <TabsTrigger value="reports" data-testid="reports-tab">Reports</TabsTrigger>
        </TabsList>
        <TabsContent value="runs" className="mt-4">
          <div className="grid grid-cols-[260px_1fr] gap-6">
            <FacetedSidebar />
            <div className="space-y-6">
              <RunsTable onCompare={() => setActiveTab('compare')} />
              <PerformanceTimeline />
            </div>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {filtered.length} of {runs.length} runs shown
          </p>
        </TabsContent>
        <TabsContent value="compare" className="mt-4 space-y-6">
          {/* Metric compare stays (UI-SPEC Q1); the Plan-04 divergence-point
              difference viewer sits BESIDE it, self-reading the compare pair. */}
          <RunCompare />
          <DifferenceViewer />
        </TabsContent>
        <TabsContent value="reports" className="mt-4">
          <ReportsSubview />
        </TabsContent>
      </Tabs>

      {/* Score-override drawer — driven by slice overrideTaskId (no page-local open
          flag). Mounted once; opens via a row's "Edit scores" button. Decoupled from
          row selection so the inline Timeline panel is viewable without this overlay. */}
      <ScoreDrawer />

      {/* Context/caching explainer — driven by slice explainTaskId. Mounted once;
          opens via a row's "Explain" button. Read-only pop-up over the runs view. */}
      <ContextCacheExplainer />
    </div>
  )
}
