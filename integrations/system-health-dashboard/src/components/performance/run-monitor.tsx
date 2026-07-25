import { useEffect, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useAppSelector, useAppDispatch } from '@/store'
import { CellTerminalGrid } from './cell-terminal-grid'
import {
  fetchRuns,
  fetchRunStatus,
  cancelRun,
  clearLaunchError,
  setActiveRunId,
  setSelectedTaskId,
  selectActiveRunId,
  selectRunStatus,
  selectRunStatusError,
  type RunProgressCell,
} from '@/store/slices/performanceSlice'

// Run monitor (D-10) — a STRAIGHT render of progress.json (no log-tail). Polls
// GET /api/experiments/run-status/:runId every 5s, renders the run header (overall
// state + done/total) and a variant×repeat cell grid with per-cell state chips +
// abort/skip reason text. A Cancel button dispatches cancelRun and acts immediately
// (D-08 — no graceful-after-cell latency). Completed cells link back into the runs
// table / timeline via setSelectedTaskId.

// Terminal states after which the run is done winding down.
const TERMINAL = new Set(['complete', 'timeout', 'abort', 'skipped', 'cancelled', 'failed'])

// Map a cell state to a Badge variant so the grid is glanceable.
function badgeVariant(state: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (state === 'complete') return 'default'
  if (state === 'running' || state === 'restoring' || state === 'scoring') return 'secondary'
  if (state === 'timeout' || state === 'abort') return 'destructive'
  return 'outline' // pending / skipped / unknown
}

export function RunMonitor() {
  const dispatch = useAppDispatch()
  const activeRunId = useAppSelector(selectActiveRunId)
  const status = useAppSelector(selectRunStatus)
  const error = useAppSelector(selectRunStatusError)

  // 5s poll of the active run's progress.json (guard: no run → no poll).
  useEffect(() => {
    if (!activeRunId) return
    dispatch(fetchRunStatus(activeRunId))
    const t = setInterval(() => dispatch(fetchRunStatus(activeRunId)), 5000)
    return () => clearInterval(t)
  }, [dispatch, activeRunId])

  // On the poll observing a TERMINAL overall (85-06 live-gate feedback):
  //   (1) refresh the runs table — the Run row is written at span close, and the
  //       mount-time fetchRuns() never re-fires, so a freshly completed run was
  //       invisible ("No runs recorded yet") until a page reload;
  //   (2) clear a stale launchError — a 409 captured while the run held the slot
  //       otherwise renders forever, reading as "the slot never freed".
  const overallNow = activeRunId ? (status?.overall ?? 'unknown') : 'unknown'
  const refreshedForRun = useRef<string | null>(null)
  useEffect(() => {
    if (!activeRunId || !TERMINAL.has(overallNow)) return
    if (refreshedForRun.current === activeRunId) return
    refreshedForRun.current = activeRunId
    dispatch(fetchRuns())
    dispatch(clearLaunchError())
  }, [dispatch, activeRunId, overallNow])

  if (!activeRunId) return null

  const cells: RunProgressCell[] = status?.cells ?? []
  const overall = status?.overall ?? 'unknown'
  const done = status?.done ?? 0
  const total = status?.total ?? cells.length
  const runId = status?.run_id ?? status?.runId ?? activeRunId

  const onCancel = () => {
    // D-08: acts immediately (host group-kill). run_dir is derived server-side
    // from run.json when omitted.
    dispatch(cancelRun({ run_id: activeRunId }))
  }

  return (
    <Card data-testid="run-monitor">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          Run monitor
          <Badge variant={badgeVariant(overall)} data-testid="run-overall-state">{overall}</Badge>
          <span className="text-sm text-muted-foreground">
            {done}/{total} cells
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">run_id:</span>
            <span className="font-mono">{runId}</span>
            {status?.snapshot_id && (
              <>
                <span className="text-muted-foreground">snapshot:</span>
                <span className="font-mono">{status.snapshot_id}</span>
              </>
            )}
            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="destructive"
                size="sm"
                onClick={onCancel}
                disabled={TERMINAL.has(overall)}
                data-testid="cancel-run"
              >
                Cancel
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => dispatch(setActiveRunId(null))}
                data-testid="dismiss-monitor"
              >
                Dismiss
              </Button>
            </div>
          </div>

          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

          {/* Live mini-terminal grid — each cell is a scaled-down terminal streaming its own
              per-cell log (<runDir>/cells/<taskId>.log); click zooms with a FLIP animation.
              Replaces the former badge grid; all content still renders as React text
              (auto-escaped) — never dangerouslySetInnerHTML (T-85-05-03). */}
          {status?.execution_mode === 'parallel' && (
            <p className="text-xs text-muted-foreground" data-testid="parallel-mode-note">
              Parallel run: cells execute concurrently — background service activity is recorded
              once, overlaid on every cell's timeline, and cannot be attributed to any single cell.
            </p>
          )}
          {cells.length === 0 ? (
            <p className="text-sm text-muted-foreground">No cells reported yet…</p>
          ) : (
            <CellTerminalGrid
              runId={activeRunId}
              cells={cells}
              parallelMode={status?.execution_mode === 'parallel'}
            />
          )}
        </div>
      </CardContent>
    </Card>
  )
}
