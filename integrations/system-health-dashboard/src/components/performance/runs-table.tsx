import type { ReactNode } from 'react'
import { useState } from 'react'
import { Pencil, Layers, Trash2 } from 'lucide-react'
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
  setExplainTaskId,
  toggleRunSelected,
  setRunsSelected,
  clearRunSelection,
  deleteSelectedRuns,
  selectSelectedRunIds,
  selectDeleteRunsPending,
  type Run,
} from '@/store/slices/performanceSlice'
import { effective, isEdited, judged, SCORE_DIMENSIONS } from './corrected-wins'
import { distinctModels, normalizeModel } from './models'

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
  const selectedRunIds = useAppSelector(selectSelectedRunIds)
  const deletePending = useAppSelector(selectDeleteRunsPending)
  const [confirmOpen, setConfirmOpen] = useState(false)

  // Multi-select over the CURRENTLY-FILTERED set. "All" selects every visible
  // row; "None" clears. The header checkbox reflects all/some/none.
  const filteredIds = filtered.map((r) => r.task_id)
  const selectedSet = new Set(selectedRunIds)
  const visibleSelected = filteredIds.filter((id) => selectedSet.has(id))
  const allSelected = filteredIds.length > 0 && visibleSelected.length === filteredIds.length
  const someSelected = visibleSelected.length > 0 && !allSelected
  const toggleAll = () => {
    if (allSelected) dispatch(setRunsSelected([]))
    else dispatch(setRunsSelected(filteredIds))
  }
  const doDelete = async () => {
    setConfirmOpen(false)
    if (selectedRunIds.length === 0) return
    await dispatch(deleteSelectedRuns(selectedRunIds))
  }

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
    <div className="rounded-md border" data-testid="runs-table">
      {/* Bulk-selection toolbar — visible whenever ≥1 run is selected. */}
      {selectedRunIds.length > 0 && (
        <div className="flex items-center justify-between gap-3 border-b bg-muted/40 px-3 py-2" data-testid="runs-bulk-toolbar">
          <span className="text-sm">
            <span className="font-semibold">{selectedRunIds.length}</span> run{selectedRunIds.length === 1 ? '' : 's'} selected
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => dispatch(clearRunSelection())} disabled={deletePending}>
              Clear
            </Button>
            <Button
              variant="destructive"
              size="sm"
              data-testid="delete-selected-runs"
              onClick={() => setConfirmOpen(true)}
              disabled={deletePending}
            >
              <Trash2 className="size-3.5" />
              {deletePending ? 'Deleting…' : `Delete ${selectedRunIds.length}`}
            </Button>
          </div>
        </div>
      )}
      {confirmOpen && (
        <div className="flex items-center justify-between gap-3 border-b bg-destructive/10 px-3 py-2" data-testid="delete-confirm-bar" role="alertdialog">
          <span className="text-sm">
            Permanently delete <span className="font-semibold">{selectedRunIds.length}</span> run{selectedRunIds.length === 1 ? '' : 's'} and their scores? This cannot be undone.
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button variant="destructive" size="sm" data-testid="confirm-delete-runs" onClick={doDelete}>Delete</Button>
          </div>
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8">
              <input
                type="checkbox"
                aria-label="Select all runs"
                data-testid="select-all-runs"
                className="cursor-pointer"
                checked={allSelected}
                ref={(el) => { if (el) el.indeterminate = someSelected }}
                onChange={toggleAll}
              />
            </TableHead>
            <TableHead>Task</TableHead>
            <TableHead>Class</TableHead>
            <TableHead>Agent</TableHead>
            {/* ATTR-02 two-column model display: the canonical (foreground chat)
                model and the concurrent background-service models. Both READ the
                persisted Run.metadata fields — no per-surface recompute (D-06). */}
            <TableHead data-testid="runs-col-canonical-model">Chat model</TableHead>
            <TableHead data-testid="runs-col-background-models">Background models</TableHead>
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
                <TableCell className="w-8" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label={`Select run ${run.task_id}`}
                    data-testid="select-run"
                    className="cursor-pointer"
                    checked={selectedSet.has(run.task_id)}
                    onChange={() => dispatch(toggleRunSelected(run.task_id))}
                  />
                </TableCell>
                <TableCell className="max-w-[200px] truncate font-mono text-sm" title={run.task_id}>
                  {run.task_id}
                </TableCell>
                <TableCell className="text-sm">
                  {run.task_class ?? <span className="text-muted-foreground">unclassified</span>}
                </TableCell>
                <TableCell className="text-sm">
                  {run.agent ?? <span className="text-muted-foreground">—</span>}
                </TableCell>
                {/* Canonical (foreground chat) model — read-only from the persisted
                    field. D-05: empty canonical renders the "unmeasured" sentinel,
                    NEVER a dominant-by-count fallback. */}
                <TableCell className="text-sm text-muted-foreground" data-testid="run-canonical-model">
                  {run.canonical_model
                    ? <span className="font-mono">{normalizeModel(run.canonical_model)}</span>
                    : <span className="text-muted-foreground italic">unmeasured</span>}
                </TableCell>
                {/* Background-service models — the segregated concurrent daemons,
                    shown as the DISTINCT set of models (one entry per background
                    process would otherwise repeat the same model many times).
                    Empty → em-dash (reusing the null-not-zero convention). */}
                <TableCell className="text-sm text-muted-foreground" data-testid="run-background-models">
                  {run.background_models?.length
                    ? <span className="font-mono">{distinctModels(run.background_models).join(', ')}</span>
                    : <span className="text-muted-foreground">—</span>}
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
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      data-testid="explain-context"
                      aria-label={`Explain context and caching for ${run.task_id}`}
                      title="Explain context & caching"
                      onClick={(e) => {
                        // Don't let the click bubble to the row (which drives the timeline).
                        e.stopPropagation()
                        dispatch(setExplainTaskId(run.task_id))
                      }}
                    >
                      <Layers className="size-3.5" />
                      Explain
                    </Button>
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
                  </div>
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
