import { useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { useAppSelector, useAppDispatch } from '@/store'
import {
  fetchReports,
  saveReport,
  refreshReport,
  setActiveReportId,
  selectReports,
  selectReportsLoading,
  selectActiveReport,
  selectActiveReportId,
  selectSaveReportPending,
  selectIsRefreshPending,
  selectFacetState,
  selectFilteredRuns,
  type Report,
  type Run,
} from '@/store/slices/performanceSlice'
import { effective, isExperimentCell, EXPERIMENT_DRIFT_NOTE, SCORE_DIMENSIONS } from './corrected-wins'

// D-04 / D-05 / DASH-03 Saved Reports sub-view. Lives as a "Reports" TabsContent
// INSIDE the Performance tab (NOT a top-level nav tab). ALL state comes from the
// slice via useAppSelector; the fetch lives inside the thunks (no direct fetch
// here). Save report freezes the current facet-state + the currently-filtered
// rows. Opening a report renders its FROZEN snapshot verbatim from slice state —
// DASH-03: NEVER re-query on view. Refresh snapshot re-runs the saved query
// server-side then re-pulls the list (new frozen-at).

const DIM_LABELS: Record<string, string> = {
  goal_achieved: 'Goal',
  code_quality: 'Quality',
  test_coverage: 'Coverage',
  regressions: 'Regress.',
  spec_drift: 'Drift',
}

// Relative-time formatter for the staleness note. Best-effort, no extra dep.
function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'unknown'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'unknown'
  const deltaSec = Math.round((Date.now() - then) / 1000)
  if (deltaSec < 60) return 'just now'
  const min = Math.round(deltaSec / 60)
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`
  const day = Math.round(hr / 24)
  return `${day} day${day === 1 ? '' : 's'} ago`
}

function num(v: number | null): string {
  return v == null ? '—' : v.toFixed(2)
}

// Read-only frozen snapshot table (renders Report.snapshot verbatim).
function SnapshotTable({ rows }: { rows: Run[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">This snapshot is empty.</p>
  }
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Task</TableHead>
            <TableHead>Class</TableHead>
            {SCORE_DIMENSIONS.map((dim) => (
              <TableHead key={dim} className="text-right">{DIM_LABELS[dim]}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((run, i) => (
            <TableRow key={run.task_id ?? i} data-testid="snapshot-row">
              <TableCell className="max-w-[200px] truncate font-mono text-sm" title={run.task_id}>
                {run.task_id}
              </TableCell>
              <TableCell className="text-sm">
                {run.task_class ?? <span className="text-muted-foreground">unclassified</span>}
              </TableCell>
              {SCORE_DIMENSIONS.map((dim) => {
                // Drift is redundant with Goal for experiment cells (freeform goal,
                // no PLAN.md) — mute it so it reads as a demoted, non-independent value.
                const redundant = dim === 'spec_drift' && isExperimentCell(run)
                return (
                  <TableCell
                    key={dim}
                    className={`text-right font-mono text-sm ${redundant ? 'italic text-muted-foreground/60' : ''}`}
                    title={redundant ? EXPERIMENT_DRIFT_NOTE : undefined}
                  >
                    {num(effective(dim, run.score))}
                  </TableCell>
                )
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function ReportCard({ report }: { report: Report }) {
  const dispatch = useAppDispatch()
  const activeId = useAppSelector(selectActiveReportId)
  const refreshing = useAppSelector(selectIsRefreshPending(report.reportId))
  const isActive = report.reportId === activeId

  return (
    <Card data-testid="report-row" className={isActive ? 'border-primary' : ''}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <button
          type="button"
          className="text-left"
          onClick={() => dispatch(setActiveReportId(report.reportId))}
        >
          <CardTitle className="text-base">{report.title}</CardTitle>
        </button>
        <Button
          variant="outline"
          size="sm"
          disabled={refreshing}
          onClick={() => dispatch(refreshReport(report.reportId))}
        >
          {refreshing ? 'Refreshing…' : 'Refresh snapshot'}
        </Button>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Snapshot frozen {relativeTime(report.snapshotFrozenAt)}. Refresh snapshot to re-run the saved query.
        </p>
      </CardContent>
    </Card>
  )
}

export function ReportsSubview() {
  const dispatch = useAppDispatch()
  const reports = useAppSelector(selectReports)
  const loading = useAppSelector(selectReportsLoading)
  const activeReport = useAppSelector(selectActiveReport)
  const savePending = useAppSelector(selectSaveReportPending)
  const facetState = useAppSelector(selectFacetState)
  const filtered = useAppSelector(selectFilteredRuns)

  useEffect(() => {
    dispatch(fetchReports())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSave = () => {
    // Title derives from the current time so repeated saves are distinguishable;
    // the server mints a stable slug. No delete/export affordance (out of scope).
    const title = `Report ${new Date().toLocaleString()}`
    dispatch(saveReport({ title, facetState, snapshotRows: filtered }))
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Freeze the current query as a shareable snapshot you can return to.
        </p>
        <Button onClick={handleSave} disabled={savePending} data-testid="save-report">
          {savePending ? 'Saving…' : 'Save report'}
        </Button>
      </div>

      <div className="grid grid-cols-[320px_1fr] gap-6">
        {/* List of saved reports */}
        <div className="space-y-3">
          {loading && reports.length === 0 ? (
            <p className="text-sm text-muted-foreground">Loading reports…</p>
          ) : reports.length === 0 ? (
            <div className="py-12 text-center">
              <h3 className="text-base font-semibold">No saved reports yet</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Build a query in the sidebar, then Save report to freeze a snapshot you can return to.
              </p>
            </div>
          ) : (
            reports.map((r) => <ReportCard key={r.reportId} report={r} />)
          )}
        </div>

        {/* Frozen snapshot view (render-from-slice, NEVER re-query — DASH-03) */}
        <div>
          {activeReport ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{activeReport.title}</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Snapshot frozen {relativeTime(activeReport.snapshotFrozenAt)}. Refresh snapshot to re-run the saved query.
                </p>
              </CardHeader>
              <CardContent>
                <SnapshotTable rows={activeReport.snapshot ?? []} />
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                Select a saved report to view its frozen snapshot.
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
