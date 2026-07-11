import { useState } from 'react'
import { ArrowDown, ArrowUp, GitCompare, X } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { useAppSelector, useAppDispatch } from '@/store'
import {
  selectAvenuesByOrigin,
  selectMergeStatusFor,
  selectPromotePending,
  selectPrunePending,
  selectPromoteResultFor,
  selectAvenueErrorFor,
  setCompareA,
  setCompareB,
  promoteAvenue,
  pruneAvenue,
  clearAvenueError,
  rankAvenues,
  avenueOutcomeScore,
  type Run,
  type AvenueRankColumn,
  type AvenueSortDir,
} from '@/store/slices/performanceSlice'
import { normalizeModel } from './models'
import { MergeStatusBadge } from './merge-status-badge'

// AVN-07/AVN-08/AVN-09 — the origin-grouped N-way ranked comparison panel: the
// primary screen of Phase 87. Groups avenue Runs by `origin_span_id` (Plan 87-03)
// via `selectAvenuesByOrigin`, renders one Card per origin span containing a sortable
// `Table` (the ranked table is the PRIMARY visual anchor — UI-SPEC). Default sort =
// outcome score (Phase 73 corrected-wins), best first; secondary sortable columns
// (tokens/cost, route quality, wall-clock) are font-mono + right-aligned. Each row
// carries the git-computed merge-status badge, per-row Promote (conflict-blocked,
// confirm-gated) and Prune (destructive confirm; "measurement data stays"). Row
// selection is 2-of-N → a "Compare selected (2)" CTA that dispatches setCompareA/B
// and switches to the Compare tab where the EXISTING DifferenceViewer renders (the
// 86-05 wiring — we do NOT rebuild trajectory diffing / re-implement alignment).
//
// Honesty (Phases 82/83/86): null/unmeasured cells render as an em-dash, never 0 or
// a fabricated status; the merge badge renders NOTHING for unknown/pruned branches.

// ── numeric formatters (honesty: null → em-dash, never 0) ──

const EM_DASH = '—'

function fmtScore(v: number | null): string {
  return v == null ? EM_DASH : v.toFixed(2)
}

function fmtTokens(n: number | null | undefined): string {
  if (n == null) return EM_DASH
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function fmtRoute(n: number | null | undefined): string {
  return n == null ? EM_DASH : String(n)
}

function fmtWallclock(n: number | null | undefined): string {
  return n == null ? EM_DASH : `${n.toFixed(1)}s`
}

// A compact machine-readable avenue label: agent · model · framework (font-mono where
// the value is machine-generated). Reads canonical_* VERBATIM (never recomputed).
function avenueLabel(run: Run): { agent: string; model: string; framework: string } {
  const agent = (run.canonical_agent ?? run.agent) ?? null
  const model = normalizeModel(run.canonical_model ?? run.model) ?? null
  const framework = run.framework ?? null
  return {
    agent: agent ?? EM_DASH,
    model: model ?? EM_DASH,
    framework: framework ?? 'none',
  }
}

// ── sortable column header ──

function SortHeader({
  label,
  column,
  active,
  dir,
  onSort,
  numeric,
}: {
  label: string
  column: AvenueRankColumn
  active: boolean
  dir: AvenueSortDir
  onSort: (c: AvenueRankColumn) => void
  numeric?: boolean
}) {
  return (
    <TableHead className={numeric ? 'text-right' : undefined}>
      <button
        type="button"
        className={`inline-flex items-center gap-1 ${numeric ? 'flex-row-reverse' : ''} ${active ? 'text-foreground' : 'text-muted-foreground'} hover:text-foreground`}
        onClick={() => onSort(column)}
        data-testid={`avenue-sort-${column}`}
      >
        {label}
        {active && (dir === 'desc' ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
      </button>
    </TableHead>
  )
}

// ── per-row action cell (Promote + Prune, each confirm-gated) ──

function AvenueRowActions({ run }: { run: Run }) {
  const dispatch = useAppDispatch()
  const taskId = run.task_id
  const status = useAppSelector(selectMergeStatusFor(taskId))
  const promotePending = useAppSelector(selectPromotePending(taskId))
  const prunePending = useAppSelector(selectPrunePending(taskId))
  const promoteResult = useAppSelector(selectPromoteResultFor(taskId))
  const error = useAppSelector(selectAvenueErrorFor(taskId))

  const [promoteConfirm, setPromoteConfirm] = useState(false)
  const [pruneConfirm, setPruneConfirm] = useState(false)

  const hasConflicts = status?.state === 'conflicts'
  const conflictRefused = promoteResult?.promoted === false && promoteResult?.reason === 'conflicts'

  return (
    <div className="flex flex-col items-end gap-1" data-testid="avenue-row-actions">
      <div className="flex items-center gap-2">
        {/* Promote — conflict-blocked (UI mirror of the server guard) + confirm-gated. */}
        {hasConflicts ? (
          <span className="text-[11px] text-status-warning" data-testid="avenue-promote-blocked">
            avenue/{taskId} has conflicts with main — resolve them before promoting.
          </span>
        ) : (
          <Button
            variant="outline"
            size="sm"
            data-testid="avenue-promote"
            disabled={promotePending}
            onClick={() => setPromoteConfirm(true)}
          >
            {promotePending ? 'Promoting…' : 'Promote to main'}
          </Button>
        )}
        <Button
          variant="destructive"
          size="sm"
          data-testid="avenue-prune"
          disabled={prunePending}
          onClick={() => setPruneConfirm(true)}
        >
          {prunePending ? 'Pruning…' : 'Prune'}
        </Button>
      </div>

      {/* Promote confirm (state-changing, not destructive: variant=default). */}
      {promoteConfirm && !hasConflicts && (
        <div
          className="flex flex-col gap-2 rounded-md border bg-muted/40 px-3 py-2 text-[11px]"
          role="alertdialog"
          data-testid="avenue-promote-confirm"
        >
          <span>
            Promote avenue/{taskId} to main? This merges the winning avenue's code changes into main.
          </span>
          <div className="flex items-center gap-2 self-end">
            <Button variant="ghost" size="sm" onClick={() => setPromoteConfirm(false)}>Cancel</Button>
            <Button
              size="sm"
              data-testid="avenue-promote-confirm-btn"
              onClick={() => { dispatch(promoteAvenue(taskId)); setPromoteConfirm(false) }}
            >
              Promote to main
            </Button>
          </div>
        </div>
      )}

      {/* Prune confirm — inline destructive bar (cloned from runs-table:395). The
          "measurement data stays" reassurance is MANDATORY (D-05 guarantee). */}
      {pruneConfirm && (
        <div
          className="flex flex-col gap-2 rounded-md bg-destructive/10 px-3 py-2 text-[11px]"
          role="alertdialog"
          data-testid="avenue-prune-confirm"
        >
          <span>
            Prune branch avenue/{taskId}? Measurement data stays in .data — only the branch is removed. This cannot be undone.
          </span>
          <div className="flex items-center gap-2 self-end">
            <Button variant="ghost" size="sm" onClick={() => setPruneConfirm(false)}>Cancel</Button>
            <Button
              variant="destructive"
              size="sm"
              data-testid="avenue-prune-confirm-btn"
              onClick={() => { dispatch(pruneAvenue(taskId)); setPruneConfirm(false) }}
            >
              Prune
            </Button>
          </div>
        </div>
      )}

      {/* A conflict-refused promote (server said no) — honesty, never silent. */}
      {conflictRefused && (
        <span className="text-[11px] text-status-warning" data-testid="avenue-promote-refused">
          avenue/{taskId} has conflicts with main — resolve them before promoting.
        </span>
      )}

      {/* Dismissible inline op error (D-09). */}
      {error && (
        <div className="flex items-center gap-1 text-[11px] text-destructive" role="alert" data-testid="avenue-op-error">
          <span>Could not complete: {error}.</span>
          <button
            type="button"
            aria-label="Dismiss error"
            data-testid="avenue-op-error-dismiss"
            onClick={() => dispatch(clearAvenueError(taskId))}
          >
            <X className="size-3" />
          </button>
        </div>
      )}
    </div>
  )
}

// ── one origin-group Card (ranked table) ──

function OriginGroupCard({
  originSpanId,
  avenues,
  onCompare,
}: {
  originSpanId: string
  avenues: Run[]
  onCompare?: () => void
}) {
  const dispatch = useAppDispatch()
  const [column, setColumn] = useState<AvenueRankColumn>('outcome')
  const [dir, setDir] = useState<AvenueSortDir>('desc')
  const [selected, setSelected] = useState<string[]>([])

  const ranked = rankAvenues(avenues, column, dir)
  const bestScore = ranked.length ? avenueOutcomeScore(ranked[0]) : null

  function onSort(c: AvenueRankColumn) {
    if (c === column) {
      setDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setColumn(c)
      setDir('desc')
    }
  }

  function toggleSelected(taskId: string) {
    setSelected((prev) => {
      if (prev.includes(taskId)) return prev.filter((x) => x !== taskId)
      if (prev.length >= 2) return [prev[1], taskId] // keep the 2 most recent (2-of-N)
      return [...prev, taskId]
    })
  }

  const canCompare = selected.length === 2

  if (avenues.length === 0) {
    // Span was forked but no completed avenues yet.
    return (
      <Card data-testid="avenue-origin-card">
        <CardHeader>
          <CardTitle className="text-base font-mono">{originSpanId}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground" data-testid="avenue-empty-running">
            Avenues are running… no results to rank yet.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card data-testid="avenue-origin-card">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-base">
          Avenues of <span className="font-mono">{originSpanId}</span>
          <span className="ml-2 text-xs text-muted-foreground">({avenues.length})</span>
        </CardTitle>
        <Button
          size="sm"
          data-testid="avenue-compare-selected"
          disabled={!canCompare}
          onClick={() => {
            if (!canCompare) return
            dispatch(setCompareA(selected[0]))
            dispatch(setCompareB(selected[1]))
            onCompare?.()
          }}
        >
          <GitCompare className="size-3.5" />
          Compare selected ({selected.length})
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Avenue</TableHead>
              <SortHeader label="Outcome" column="outcome" active={column === 'outcome'} dir={dir} onSort={onSort} numeric />
              <SortHeader label="Tokens" column="tokens" active={column === 'tokens'} dir={dir} onSort={onSort} numeric />
              <SortHeader label="Route" column="route" active={column === 'route'} dir={dir} onSort={onSort} numeric />
              <SortHeader label="Wall-clock" column="wallclock" active={column === 'wallclock'} dir={dir} onSort={onSort} numeric />
              <TableHead>Merge</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ranked.map((run) => {
              const label = avenueLabel(run)
              const score = avenueOutcomeScore(run)
              const isSelected = selected.includes(run.task_id)
              // The best-ranked row (top outcome score) gets a subtle success accent
              // (UI-SPEC: never colour whole rows — a left accent only).
              const isBest = column === 'outcome' && dir === 'desc' && bestScore != null && score === bestScore
              return (
                <TableRow
                  key={run.task_id}
                  data-testid="avenue-row"
                  className={`${isSelected ? 'bg-primary/10 ring-1 ring-primary' : ''} ${isBest ? 'border-l-2 border-status-success-line' : ''}`}
                >
                  <TableCell>
                    <input
                      type="checkbox"
                      aria-label={`Select avenue ${run.task_id} for compare`}
                      data-testid="avenue-select"
                      className="cursor-pointer"
                      checked={isSelected}
                      onChange={() => toggleSelected(run.task_id)}
                    />
                  </TableCell>
                  <TableCell className="max-w-[220px]">
                    <div className="flex flex-col gap-0.5">
                      <span className="truncate font-mono text-sm" title={run.task_id}>{run.task_id}</span>
                      <span className="truncate text-[11px] text-muted-foreground font-mono">
                        {label.agent} · {label.model} · {label.framework}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">{fmtScore(score)}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{fmtTokens(run.outcome?.totalTokens)}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{fmtRoute(run.loop_count)}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{fmtWallclock(run.wallclock_per_step)}</TableCell>
                  <TableCell>
                    <MergeStatusBadge taskId={run.task_id} />
                  </TableCell>
                  <TableCell className="text-right">
                    <AvenueRowActions run={run} />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

// ── the panel: one Card per origin group, or the empty state ──

export function AvenuePanel({ onCompare }: { onCompare?: () => void }) {
  const groups = useAppSelector(selectAvenuesByOrigin)

  if (groups.length === 0) {
    return (
      <Card data-testid="avenue-panel-empty">
        <CardHeader>
          <CardTitle className="text-base">No avenues yet</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            This span hasn't been forked. Use "Fork into avenues" to run the same prompt across
            agents, models, frameworks, or with knowledge injection on vs off.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6" data-testid="avenue-panel">
      {groups.map((g) => (
        <OriginGroupCard
          key={g.originSpanId}
          originSpanId={g.originSpanId}
          avenues={g.avenues}
          onCompare={onCompare}
        />
      ))}
    </div>
  )
}
