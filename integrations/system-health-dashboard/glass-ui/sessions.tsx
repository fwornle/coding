import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAppDispatch, useAppSelector } from '@/store'
import {
  fetchRuns,
  setExplainTaskId,
  setSelectedTaskId,
  selectSelectedTaskId,
  type Run,
} from '@/store/slices/performanceSlice'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PerformanceTimeline } from '@/components/performance/timeline'
import { ContextCacheExplainer, type Topology } from '@/components/performance/context-cache-explainer'
import { normalizeModel } from '@/components/performance/models'
import { cn } from '@/lib/utils'

const POLL_MS = 10_000

// glass has no background services and no routing: one agent, the daemon, the
// provider the agent itself chose.
const GLASS_TOPOLOGY: Topology = {
  background: null,
  seam: { title: 'glass daemon', lines: [`:${window.location.port || '12445'} · base URL / HTTPS_PROXY`, "meters every call of this session"], tag: 'single metering seam' },
  backend: { title: "the agent's provider", lines: ['Anthropic / Copilot / OpenAI', 'matches prefix → cache_read'], tag: 'cache lives HERE' },
}

const fmtTokens = (n: number | null | undefined) => {
  const v = typeof n === 'number' ? n : 0
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`
  return String(v)
}

const fmtDuration = (from?: string | null, to?: string | null) => {
  if (!from) return '—'
  const ms = (to ? Date.parse(to) : Date.now()) - Date.parse(from)
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const m = Math.round(ms / 60_000)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`
}

/**
 * Every `glass <agent>` run: one row each, newest first; a row opens its timeline.
 * `?task=<id>` selects a session and `&explain=1` opens its context explainer —
 * the status line's links (lib/glass/statusline.mjs uiLinks).
 */
export function SessionsPage() {
  const dispatch = useAppDispatch()
  const runs = useAppSelector((s) => s.performance.runs) as Run[]
  const loading = useAppSelector((s) => s.performance.runsLoading)
  const selected = useAppSelector(selectSelectedTaskId)
  const [params] = useSearchParams()
  const linked = useRef<string | null>(null)

  useEffect(() => {
    dispatch(fetchRuns())
    const t = setInterval(() => dispatch(fetchRuns()), POLL_MS)
    return () => clearInterval(t)
  }, [dispatch])

  // Apply the deep link once, after the linked session is in the list (the
  // explainer reads the run's window from it).
  useEffect(() => {
    const task = params.get('task')
    if (!task || linked.current === task || !runs.some((r) => r.task_id === task)) return
    linked.current = task
    dispatch(setSelectedTaskId(task))
    if (params.get('explain') === '1') dispatch(setExplainTaskId(task))
  }, [params, runs, dispatch])

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Sessions</h1>
        <p className="text-sm text-muted-foreground">
          One row per <span className="font-mono">glass &lt;agent&gt;</span> run. Select a row for its turns; Context explains what filled the window.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Measured sessions</CardTitle>
          <CardDescription>{runs.length} session{runs.length === 1 ? '' : 's'}{loading ? ' · loading…' : ''}</CardDescription>
        </CardHeader>
        <CardContent>
          {runs.length === 0 && !loading ? (
            <p className="text-sm text-muted-foreground" data-testid="sessions-empty">
              No sessions yet. Run <span className="font-mono">glass claude</span> (or copilot, opencode, pi) and come back.
            </p>
          ) : (
            <Table data-testid="sessions-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Started</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead className="text-right">Calls</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((r) => {
                  const live = !r.ended_at
                  const model = r.canonical_model ?? r.model
                  return (
                    <TableRow
                      key={r.task_id}
                      data-task-id={r.task_id}
                      className={cn('cursor-pointer', selected === r.task_id && 'bg-muted/50 shadow-[inset_3px_0_0_hsl(var(--primary))]')}
                      onClick={() => dispatch(setSelectedTaskId(selected === r.task_id ? null : r.task_id))}
                    >
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {r.started_at ? new Date(r.started_at).toLocaleString() : '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs">{r.canonical_agent ?? r.agent ?? '—'}</Badge>
                        {live && <Badge className="ml-1 text-xs bg-emerald-600 hover:bg-emerald-600">live</Badge>}
                      </TableCell>
                      <TableCell className="text-xs">{String(r.project ?? '') || '—'}</TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground">{model ? normalizeModel(model) : '—'}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{r.outcome?.calls ?? 0}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{fmtTokens(r.outcome?.totalTokens)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{fmtDuration(r.started_at, r.ended_at)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          data-testid="explain"
                          onClick={(e) => { e.stopPropagation(); dispatch(setExplainTaskId(r.task_id)) }}
                        >
                          Context
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {selected && <PerformanceTimeline />}
      <ContextCacheExplainer topology={GLASS_TOPOLOGY} />
    </div>
  )
}
