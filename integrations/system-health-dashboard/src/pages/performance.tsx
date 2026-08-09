import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useAppSelector, useAppDispatch } from '@/store'
import {
  fetchRuns,
  fetchActiveRun,
  setActiveRunId,
  selectActiveRunId,
  setIncludePending,
  selectIncludePending,
  selectVisibleRuns,
  selectQuarantinedCount,
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
import { AvenuePanel } from '@/components/performance/avenue-panel'
import { ExperimentLauncher } from '@/components/performance/experiment-launcher'
import { RunMonitor } from '@/components/performance/run-monitor'
import { ComparisonMatrix } from '@/components/performance/comparison-matrix'
import { KgbenchLauncher } from '@/components/performance/kgbench-launcher'
import { KgbenchMonitor } from '@/components/performance/kgbench-monitor'
import { KgbenchResults } from '@/components/performance/kgbench-results'
import {
  fetchKgbenchActiveRun,
  setKgbenchActiveRunId,
  selectKgbenchActiveRunId,
} from '@/store/slices/kgbenchSlice'

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
// header, WITH a live count — "Show quarantined (N)". There is no
// `run.quarantined` field; `pending` is the quarantine flag (Run.pending).
//
// The count previously read over the already-fetched rows while the fetch itself
// asked the server to EXCLUDE pending runs — so N was structurally always 0 (the
// fetched set contained none), even with 21 quarantined runs on the server, and
// the checkbox looked inert. fetchRuns now always pulls them and the toggle
// filters client-side (selectVisibleRuns), so the count is real and toggling is
// instant — no refetch.
function QuarantineHeaderToggle() {
  const dispatch = useAppDispatch()
  const includePending = useAppSelector(selectIncludePending)
  const quarantinedCount = useAppSelector(selectQuarantinedCount)

  // The Checkbox sits BESIDE the <label>, not inside it. Wrapping a Radix checkbox
  // in `<label htmlFor>` pointing at itself makes it impossible to UNCHECK by
  // clicking the tick: once checked, the indicator <svg> is the topmost element at
  // the control's centre, so the click targets a descendant rather than the labeled
  // control — the label's activation behaviour then forwards a second click and the
  // two toggles cancel. Checking worked only because an unchecked box renders no
  // indicator. Side by side, the control handles its own clicks and the label
  // forwards exactly once from the text.
  return (
    <div className="flex items-center gap-2 text-sm" data-testid="include-pending-row">
      <Checkbox
        id="include-pending"
        data-testid="include-pending-toggle"
        checked={includePending}
        disabled={quarantinedCount === 0}
        onCheckedChange={(checked) => dispatch(setIncludePending(checked === true))}
      />
      <label htmlFor="include-pending" className="cursor-pointer truncate">
        Show quarantined ({quarantinedCount})
      </label>
    </div>
  )
}

export function PerformancePage() {
  const dispatch = useAppDispatch()
  // Visible = fetched minus quarantined unless the operator opted in. Quarantined
  // runs must not silently inflate the summary cards.
  const runs = useAppSelector(selectVisibleRuns)
  const loading = useAppSelector(selectRunsLoading)
  const error = useAppSelector(selectRunsError)
  const filtered = useAppSelector(selectFilteredRuns)
  const includePending = useAppSelector(selectIncludePending)

  // D-08: the body Tabs are CONTROLLED so the runs-table "Compare selected (2)"
  // CTA can switch to the Compare tab (which mounts the DifferenceViewer).
  const [activeTab, setActiveTab] = useState('runs')

  // The Performance page now hosts TWO measurement surfaces, and this is the switch between
  // them. Experiments measure one agent turn against a spec's variants; Benchmarks (kgbench)
  // measure retrieval arms against a graded question set. They share this page because they
  // answer the same operator question — "which way of working is better, and what did it
  // cost" — and share nothing else: different runners, different servers, different run
  // identities. Sub-tabs rather than a second top-level nav entry, per the agreed scope.
  const [surface, setSurface] = useState('experiments')

  // Fetch on mount AND poll every 30s. Mount-only left runs completed by ANY source
  // OTHER than the in-UI launcher (a CLI `experiment-run.mjs`, the coordinator, or a
  // run finished while this tab sat open) invisible until a manual reload — the exact
  // "my experiment doesn't appear" gap. Re-fetch honors the current quarantine toggle.
  useEffect(() => {
    dispatch(fetchRuns())
    const id = setInterval(() => dispatch(fetchRuns()), 30_000)
    return () => clearInterval(id)
  }, [dispatch])

  // AUTO-ATTACH: poll for the newest in-progress run and adopt it as the active run
  // when this tab isn't already watching one — so a matrix launched from the CLI or the
  // /experiment skill (not this tab's Launch button) still surfaces the live mini-terminal
  // grid here. Only adopts when activeRunId is null, so it never yanks a run the operator
  // deliberately dismissed away from them mid-view (Dismiss sets activeRunId null AND the
  // run reaches a terminal overall shortly after, so it won't be re-adopted).
  const activeRunId = useAppSelector(selectActiveRunId)
  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      if (cancelled || activeRunId) return
      const res = await dispatch(fetchActiveRun())
      if (!cancelled && fetchActiveRun.fulfilled.match(res) && res.payload.runId) {
        dispatch(setActiveRunId(res.payload.runId))
      }
    }
    tick()
    const id = setInterval(tick, 5_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [dispatch, activeRunId])

  // The same auto-attach for kgbench: a matrix launched from the CLI or the /kgbench skill
  // must surface in the Benchmarks monitor, not only one launched from this tab. Polled at
  // 15s rather than the experiments' 5s — a kgbench cell is a whole agent session (tens of
  // seconds at best), so a faster poll would only add requests, not information.
  const kgbenchRunId = useAppSelector(selectKgbenchActiveRunId)
  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      if (cancelled || kgbenchRunId) return
      const res = await dispatch(fetchKgbenchActiveRun())
      if (!cancelled && fetchKgbenchActiveRun.fulfilled.match(res) && res.payload.runId) {
        dispatch(setKgbenchActiveRunId(res.payload.runId))
      }
    }
    tick()
    const id = setInterval(tick, 15_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [dispatch, kgbenchRunId])

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

      {/* Surface switch: Experiments (specs × variants × agents) | Benchmarks (kgbench). */}
      <Tabs value={surface} onValueChange={setSurface}>
        <TabsList>
          <TabsTrigger value="experiments" data-testid="experiments-surface-tab">Experiments</TabsTrigger>
          <TabsTrigger value="benchmarks" data-testid="benchmarks-surface-tab">Benchmarks</TabsTrigger>
        </TabsList>

        <TabsContent value="experiments" className="mt-4 space-y-6">

      {/* Summary cards — the visual focal point — with the D-10 quarantine
          control re-homed here (out of the sidebar) with a live count. */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <SummaryCards runs={runs} />
        </div>
        <div className="pt-2">
          <QuarantineHeaderToggle />
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
          <TabsTrigger value="avenues" data-testid="avenues-tab">Avenues</TabsTrigger>
          <TabsTrigger value="compare" data-testid="compare-tab">Compare</TabsTrigger>
          <TabsTrigger value="reports" data-testid="reports-tab">Reports</TabsTrigger>
        </TabsList>
        <TabsContent value="runs" className="mt-4">
          {/* min-w-0 on the content column: a grid 1fr track defaults to
              min-width:auto, so the wide runs table / timeline would force the
              whole grid (and page) to scroll horizontally. min-w-0 lets the
              track shrink so each child's own overflow-x-auto scrolls in-box. */}
          <div className="grid min-w-0 grid-cols-[260px_1fr] gap-6">
            <FacetedSidebar />
            <div className="min-w-0 space-y-6">
              <RunsTable onCompare={() => setActiveTab('compare')} />
              <PerformanceTimeline />
            </div>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {filtered.length} of {runs.length} runs shown
          </p>
        </TabsContent>
        {/* AVN-07 origin-grouped N-way ranked panel — the primary Phase-87 screen.
            Select 2 avenue rows → "Compare selected (2)" dispatches setCompareA/B
            and switches to the Compare tab where the EXISTING DifferenceViewer
            renders (86-05 wiring; we do NOT rebuild trajectory diffing). */}
        <TabsContent value="avenues" className="mt-4">
          <AvenuePanel onCompare={() => setActiveTab('compare')} />
        </TabsContent>
        {/* Consolidated Compare tab: the previously-separate "Compare" (manual 2-run
            A/B) and "Comparison" (experiment variant matrix) tabs were confusingly
            named and split. Merged into ONE tab, each a clearly-labelled section.
            A/B stays first so the "Compare selected (2)" CTA (from Runs / Avenues,
            which switches here) still lands on the difference viewer. */}
        <TabsContent value="compare" className="mt-4 space-y-8">
          <section className="space-y-6">
            <div>
              <h2 className="text-base font-semibold">Two-run comparison</h2>
              <p className="text-sm text-muted-foreground">
                Pick any two runs (or use the "Compare selected (2)" button on Runs / Avenues)
                to see their metric diff and divergence points side by side.
              </p>
            </div>
            <RunCompare />
            <DifferenceViewer />
          </section>
          {/* CMP-04 (Phase 80): the variant-comparison matrix — fed live by
              GET /api/experiments/comparison via fetchComparison, keyed by the
              selected experiment's task_hash (D-01/D-03). */}
          <section className="space-y-4 border-t pt-8">
            <div>
              <h2 className="text-base font-semibold">Experiment variant comparison</h2>
              <p className="text-sm text-muted-foreground">
                The ranked variant matrix for one experiment (task_hash) — every variant's cost,
                route quality, and outcome, grouped into ranked / failed / ungated.
              </p>
            </div>
            <ComparisonMatrix />
          </section>
        </TabsContent>
        <TabsContent value="reports" className="mt-4">
          <ReportsSubview />
        </TabsContent>
      </Tabs>

        </TabsContent>

        {/* Benchmarks — kgbench. Launcher, live monitor, and results, in the order an
            operator uses them. The monitor self-gates on there being an active run, so a
            first visit shows the launcher and the results picker and nothing dead. */}
        <TabsContent value="benchmarks" className="mt-4 space-y-6">
          <div>
            <h2 className="text-base font-semibold">Code-retrieval benchmark (kgbench)</h2>
            <p className="text-sm text-muted-foreground">
              Retrieval arms — grep, graphify, codegraph, hybrid — answering a graded question set,
              across agents and models. Runs detached and resumable; launch it here or with{' '}
              <span className="font-mono">/kgbench</span>.
            </p>
          </div>
          <KgbenchLauncher />
          <KgbenchMonitor />
          <KgbenchResults />
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
