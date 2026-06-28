import type { ReactNode } from 'react'
import { Pencil } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
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
  type Run,
} from '@/store/slices/performanceSlice'
import { effective, isEdited, judged, SCORE_DIMENSIONS } from './corrected-wins'

// D-01/D-03 runs table. Reads the FILTERED set from selectFilteredRuns; row click
// dispatches setSelectedTaskId (drives the Plan 06 drawer + the timeline panel).
// Score cells use the shared corrected-wins helper: corrected value as effective
// with an amber "edited" marker + judged value on hover; null → `—`, never 0.

const DIM_LABELS: Record<string, string> = {
  goal_achieved: 'Goal',
  code_quality: 'Quality',
  test_coverage: 'Coverage',
  regressions: 'Regress.',
  spec_drift: 'Drift',
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
            {SCORE_DIMENSIONS.map((dim) => (
              <TableHead key={dim} className="text-right">{DIM_LABELS[dim]}</TableHead>
            ))}
            <TableHead className="text-right">Tokens</TableHead>
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
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
