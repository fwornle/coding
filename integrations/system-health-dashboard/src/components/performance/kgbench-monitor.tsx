import { useEffect, useRef, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useAppSelector, useAppDispatch } from '@/store'
import {
  fetchKgbenchStatus,
  fetchKgbenchRuns,
  cancelKgbenchRun,
  setKgbenchActiveRunId,
  selectKgbenchActiveRunId,
  selectKgbenchStatus,
  selectKgbenchStatusError,
  selectKgbenchCancelPending,
  type KgbenchStatusCell,
} from '@/store/slices/kgbenchSlice'

// Live monitor for a kgbench matrix. Same interaction model as the experiment Run monitor —
// 5s poll, header state + done/total, cancel, dismiss, self-gates on there being a run — but
// it reads a DIFFERENT thing, and the difference is the reason this is a separate component
// rather than a prop on the existing one.
//
// The experiment monitor renders progress.json verbatim: the runner writes it, and every cell
// has a state the runner assigned. kgbench has no progress file. Its runner appends one JSON
// object per COMPLETED cell to results.jsonl and its supervisor writes a one-line status; the
// server derives progress from those two. So a kgbench cell has no "running" state to render —
// a cell is either in the file or it is not — and the grid is per arm×agent×model with a
// count, not per variant×repeat with a chip. Reusing the experiment monitor would have meant
// synthesising per-cell states that nothing observed.

const TERMINAL = new Set(['complete', 'failed', 'abandoned', 'cancelled'])

function overallVariant(overall: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (overall === 'complete') return 'default'
  if (overall === 'running') return 'secondary'
  if (overall === 'failed' || overall === 'abandoned') return 'destructive'
  // 'resuming' is the supervisor doing its job after a signal death, and 'pending' is a run
  // that has not written its first cell. Neither is an error, so neither is red.
  return 'outline'
}

function pct(done: number, total: number | null): number | null {
  if (total == null || total <= 0) return null
  return Math.min(100, Math.round((done / total) * 100))
}

/**
 * The supervisor log tail. Polled only while the panel is open, because a run that is not
 * producing cells is exactly when you need it and never otherwise: a preflight refusal (a down
 * MCP backend, a missing agent binary) looks identical in the grid to a slow first cell — the
 * run just sits at zero. The log is the only place that distinguishes them.
 */
function SupervisorLog({ runId }: { runId: string }) {
  const [text, setText] = useState('')
  const [offset, setOffset] = useState(0)
  const boxRef = useRef<HTMLPreElement | null>(null)

  useEffect(() => {
    setText('')
    setOffset(0)
  }, [runId])

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const r = await fetch(`/api/kgbench/log/${encodeURIComponent(runId)}?offset=${offset}`)
        if (!r.ok) return
        const d = await r.json()
        if (cancelled || !d.chunk) return
        // Keep the tail bounded: a full matrix's log is tens of thousands of lines and the
        // browser does not need the beginning of it to answer "what is it doing now".
        setText((prev) => (prev + d.chunk).slice(-20_000))
        setOffset(d.offset)
      } catch { /* a failed poll is not worth surfacing — the next one will do */ }
    }
    tick()
    const id = setInterval(tick, 4000)
    return () => { cancelled = true; clearInterval(id) }
  }, [runId, offset])

  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight
  }, [text])

  return (
    <pre
      ref={boxRef}
      data-testid="kgb-supervisor-log"
      className="max-h-56 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-xs leading-relaxed"
    >
      {text || 'No supervisor output yet…'}
    </pre>
  )
}

export function KgbenchMonitor() {
  const dispatch = useAppDispatch()
  const activeRunId = useAppSelector(selectKgbenchActiveRunId)
  const status = useAppSelector(selectKgbenchStatus)
  const error = useAppSelector(selectKgbenchStatusError)
  const cancelPending = useAppSelector(selectKgbenchCancelPending)
  const [showLog, setShowLog] = useState(false)

  useEffect(() => {
    if (!activeRunId) return
    dispatch(fetchKgbenchStatus(activeRunId))
    const t = setInterval(() => dispatch(fetchKgbenchStatus(activeRunId)), 5000)
    return () => clearInterval(t)
  }, [dispatch, activeRunId])

  // Refresh the runs list once when this run reaches a terminal state, so a just-finished run
  // appears in the results picker without a page reload — the same gap the experiment monitor
  // closed after a completed run stayed invisible until someone hit refresh.
  const overall = activeRunId ? (status?.overall ?? 'unknown') : 'unknown'
  const refreshedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!activeRunId || !TERMINAL.has(overall)) return
    if (refreshedFor.current === activeRunId) return
    refreshedFor.current = activeRunId
    dispatch(fetchKgbenchRuns())
  }, [dispatch, activeRunId, overall])

  if (!activeRunId) return null

  const cells: KgbenchStatusCell[] = status?.cells ?? []
  const done = status?.done ?? 0
  const total = status?.total ?? null
  const progress = pct(done, total)

  return (
    <Card data-testid="kgbench-monitor">
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          Benchmark monitor
          <Badge variant={overallVariant(overall)} data-testid="kgb-overall-state">{overall}</Badge>
          <span className="text-sm text-muted-foreground">
            {done}
            {total != null ? `/${total}` : ''} cells{progress != null ? ` · ${progress}%` : ''}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">run_id:</span>
            <span className="font-mono" data-testid="kgb-monitor-run-id">{status?.run_id ?? activeRunId}</span>
            {status?.set && (
              <>
                <span className="text-muted-foreground">set:</span>
                <span className="font-mono">{status.set}</span>
              </>
            )}
            {status?.commit && (
              <>
                <span className="text-muted-foreground">commit:</span>
                <span className="font-mono">{status.commit}</span>
              </>
            )}
            <div className="ml-auto flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowLog((v) => !v)} data-testid="kgb-toggle-log">
                {showLog ? 'Hide log' : 'Supervisor log'}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={TERMINAL.has(overall) || cancelPending}
                onClick={() => dispatch(cancelKgbenchRun(activeRunId))}
                data-testid="kgb-cancel-run"
              >
                {cancelPending ? 'Cancelling…' : 'Cancel'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => dispatch(setKgbenchActiveRunId(null))}
                data-testid="kgb-dismiss-monitor"
              >
                Dismiss
              </Button>
            </div>
          </div>

          {/* The supervisor's own status line, verbatim. It carries the detail the overall
              badge cannot — which pass is running, which signal it died on, which attempt of
              how many a resume is. Never paraphrased. */}
          {status?.status && (
            <p className="text-xs text-muted-foreground" data-testid="kgb-supervisor-status">
              <span className="font-mono">{status.status}</span>
            </p>
          )}

          {progress != null && (
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
            </div>
          )}

          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

          {cells.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No cells recorded yet — the first cell restores a worktree snapshot before it answers.
              Open the supervisor log if this does not move.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="kgb-cell-grid">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-1 pr-3 font-medium">Arm</th>
                    <th className="py-1 pr-3 font-medium">Agent</th>
                    <th className="py-1 pr-3 font-medium">Model</th>
                    <th className="py-1 pr-3 text-right font-medium">Cells</th>
                    <th className="py-1 pr-3 text-right font-medium">Questions</th>
                    <th className="py-1 pr-3 text-right font-medium">Hard fails</th>
                    <th className="py-1 pr-3 text-right font-medium">Mean score</th>
                    <th className="py-1 pr-3 font-medium">Last cell</th>
                  </tr>
                </thead>
                <tbody>
                  {cells.map((c) => (
                    <tr key={`${c.arm}|${c.agent}|${c.model}`} className="border-b last:border-0">
                      <td className="py-1 pr-3 font-mono text-xs">{c.arm}</td>
                      <td className="py-1 pr-3">{c.agent}</td>
                      <td className="py-1 pr-3 font-mono text-xs text-muted-foreground">{c.model ?? '—'}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">{c.done}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">{c.questions}</td>
                      <td className={`py-1 pr-3 text-right tabular-nums ${c.failed > 0 ? 'text-destructive' : ''}`}>{c.failed}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">
                        {c.mean_score == null ? '—' : c.mean_score.toFixed(2)}
                      </td>
                      <td className="py-1 pr-3 text-xs text-muted-foreground">
                        {c.last_at ? new Date(c.last_at).toLocaleTimeString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {showLog && <SupervisorLog runId={activeRunId} />}
        </div>
      </CardContent>
    </Card>
  )
}
