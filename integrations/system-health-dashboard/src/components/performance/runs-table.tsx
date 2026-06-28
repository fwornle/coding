import type { ReactNode } from 'react'
import { Pencil } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip'
import { useAppSelector, useAppDispatch } from '@/store'
import {
  selectFilteredRuns,
  selectRuns,
  selectSelectedTaskId,
  setSelectedTaskId,
  setOverrideTaskId,
  type Run,
} from '@/store/slices/performanceSlice'
import { effective, isEdited, judged, SCORE_DIMENSIONS } from './corrected-wins'

// D-01/D-03 runs table. Reads the FILTERED set from selectFilteredRuns. Row click
// dispatches setSelectedTaskId — this drives ONLY the inline Timeline panel (so the
// timeline is viewable without a modal overlay). The score-override drawer is opened
// by an explicit per-row "Edit scores" button (setOverrideTaskId), decoupled from
// row selection. Score cells use the shared corrected-wins helper: corrected value
// as effective with an amber "edited" marker + judged value on hover; null → `—`.

// Per-dimension header metadata: short label, which direction is "good", and a
// plain-language description (surfaced as a header tooltip + a ↑/↓ direction glyph)
// so a bare "1.00" is self-explanatory and the mixed direction is visible.
const DIM_META: Record<string, { label: string; better: 'higher' | 'lower'; desc: string }> = {
  goal_achieved: { label: 'Goal', better: 'higher', desc: 'Goal achieved — did the run accomplish its stated goal? Scale 0–1; higher is better (1 = fully achieved).' },
  code_quality: { label: 'Quality', better: 'higher', desc: 'Code quality of the result. Scale 0–1; higher is better.' },
  test_coverage: { label: 'Coverage', better: 'higher', desc: 'Test coverage of the change. Scale 0–1; higher is better.' },
  regressions: { label: 'Regress.', better: 'lower', desc: 'Regressions introduced. 0 or 1; lower is better (0 = none).' },
  spec_drift: { label: 'Drift', better: 'lower', desc: 'Drift from the spec/intent. Scale 0–1; lower is better (0 = on-spec).' },
}

// Render a single number (or em-dash for null). NEVER coerce null to 0.
function num(v: number | null): ReactNode {
  return v == null ? <span className="text-muted-foreground">—</span> : v.toFixed(2)
}

function ScoreCell({ dim, run }: { dim: string; run: Run }) {
  const eff = effective(dim, run.score)
  const edited = isEdited(dim, run.score)
  const judgedVal = judged(dim, run.score)

  if (!edited) {
    return <span className="font-mono">{num(eff)}</span>
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1">
            <span className="font-mono">{num(eff)}</span>
            <Badge
              variant="outline"
              className="gap-1 border-yellow-200 bg-yellow-50 text-yellow-700"
            >
              <Pencil className="size-3.5" />
              edited
            </Badge>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          Judged: {judgedVal == null ? '—' : judgedVal.toFixed(2)}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export function RunsTable() {
  const dispatch = useAppDispatch()
  const filtered = useAppSelector(selectFilteredRuns)
  const allRuns = useAppSelector(selectRuns)
  const selectedTaskId = useAppSelector(selectSelectedTaskId)

  // Empty states (UI-SPEC Copywriting): distinguish "no runs at all" from
  // "filters exclude everything".
  if (filtered.length === 0) {
    if (allRuns.length === 0) {
      return (
        <div className="py-12 text-center">
          <h3 className="text-base font-semibold">No runs recorded yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Runs appear here once a measurement span is closed. Start one with the measurement CLI, then return.
          </p>
        </div>
      )
    }
    return (
      <div className="py-12 text-center">
        <h3 className="text-base font-semibold">No runs match these filters</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Loosen a facet in the sidebar or clear filters to see more runs.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Task</TableHead>
            <TableHead>Class</TableHead>
            <TableHead>Agent</TableHead>
            <TableHead>Model</TableHead>
            {SCORE_DIMENSIONS.map((dim) => {
              const m = DIM_META[dim]
              return (
                <TableHead key={dim} className="text-right">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex cursor-help items-center gap-0.5">
                          {m.label}
                          <span className="text-muted-foreground" aria-label={m.better === 'higher' ? 'higher is better' : 'lower is better'}>
                            {m.better === 'higher' ? '↑' : '↓'}
                          </span>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">{m.desc}</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </TableHead>
              )
            })}
            <TableHead className="text-right">Tokens</TableHead>
            <TableHead className="text-right sr-only">Edit</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((run) => {
            const isSelected = run.task_id === selectedTaskId
            return (
              <TableRow
                key={run.task_id}
                data-testid="run-row"
                data-task-id={run.task_id}
                onClick={() => dispatch(setSelectedTaskId(run.task_id))}
                className={`cursor-pointer ${isSelected ? 'bg-muted' : ''}`}
              >
                <TableCell className="max-w-[200px] truncate font-mono text-sm" title={run.task_id}>
                  {run.task_id}
                </TableCell>
                <TableCell className="text-sm">
                  {run.task_class ?? <span className="text-muted-foreground">unclassified</span>}
                </TableCell>
                <TableCell className="text-sm">
                  {run.agent ?? <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {run.model ?? <span className="text-muted-foreground">—</span>}
                </TableCell>
                {SCORE_DIMENSIONS.map((dim) => (
                  <TableCell key={dim} className="text-right">
                    <ScoreCell dim={dim} run={run} />
                  </TableCell>
                ))}
                <TableCell className="text-right font-mono text-sm">
                  {run.outcome?.totalTokens == null
                    ? <span className="text-muted-foreground">—</span>
                    : run.outcome.totalTokens.toLocaleString()}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid="edit-scores"
                    aria-label={`Edit scores for ${run.task_id}`}
                    onClick={(e) => {
                      // Don't let the click bubble to the row (which drives the timeline).
                      e.stopPropagation()
                      dispatch(setOverrideTaskId(run.task_id))
                    }}
                  >
                    <Pencil className="size-3.5" />
                    Edit scores
                  </Button>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      <p className="border-t px-3 py-2 text-sm text-muted-foreground">
        Scores are 0–1 rubric values. <span aria-hidden>↑</span> higher is better (Goal, Quality, Coverage);{' '}
        <span aria-hidden>↓</span> lower is better (Regress., Drift). Hover a column header for details. An
        amber “edited” marker means an operator override; hover it to see the original judged value.
      </p>
    </div>
  )
}
