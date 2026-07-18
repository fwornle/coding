import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { Pencil, Layers, Trash2, RotateCcw, GitCompare, GitBranch, Radio } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
  setLauncherPrefill,
  selectSpecList,
  fetchSpecList,
  saveOverride,
  setCompareA,
  setCompareB,
  selectSaveOverridePending,
  buildForkPrefill,
  DEFAULT_OVERRIDDEN_BY,
  type Run,
  type ExperimentOverrides,
  type VariantOverride,
  type SpecSummary,
} from '@/store/slices/performanceSlice'
import { effective, isEdited, judged, SCORE_DIMENSIONS } from './corrected-wins'
import { distinctModels, normalizeModel } from './models'
import { ReconciliationBadge } from './reconciliation-badge'

// D-11 Re-run guard: a Re-run button is only meaningful on a COMPLETED experiment
// run. A run is an experiment if it carries variant/base_variant provenance (only
// the experiment runner stamps these — an interactive/ad-hoc measurement has
// neither), and it's completed once terminal_state === 'complete' (D-04 enum
// persisted by run-write.mjs). These fields ride on the Run index signature
// (`[key: string]: unknown`) from readRuns — read them defensively as strings.
function runStr(run: Run, key: string): string | null {
  const v = run[key]
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

// A run is an EXPERIMENT (a spec-driven cell) iff it carries variant/base_variant
// provenance — only the experiment runner stamps these. An ambient auto-measured
// session (opencode/claude/…) carries neither, so it can't be re-run or forked.
function isExperimentRun(run: Run): boolean {
  return runStr(run, 'variant') !== null || runStr(run, 'base_variant') !== null
}

function isCompletedExperimentRun(run: Run): boolean {
  return isExperimentRun(run) && runStr(run, 'terminal_state') === 'complete'
}

// Newest-first sort key: prefer when the run ENDED, falling back to when it
// started, then any generic timestamp. ISO-8601 strings sort lexicographically,
// so a plain string compare is a valid chronological compare. Empty ('') sorts
// last under a descending compare (undated legacy rows sink to the bottom).
function runSortTs(run: Run): string {
  return runStr(run, 'ended_at') ?? runStr(run, 'started_at') ?? runStr(run, 'timestamp') ?? ''
}

// How many runs to reveal per "Show more" step (and the initial page size).
const RUNS_PAGE_SIZE = 15

// Derive the spec FILE for a re-run (85-06): the Run row carries no `spec` field
// (run-write never stamped one), so join the run to the server-listed spec whose
// goal_sentence is IDENTICAL — the goal is the task_hash anchor (D-05: same goal
// → same task_hash), so an exact-goal match IS the comparable spec. Returns ''
// when no listed spec matches (the launcher then opens with rerun_of set but the
// operator picks the spec manually).
function deriveSpecFile(run: Run, specs: SpecSummary[]): string {
  const direct = runStr(run, 'spec')
  if (direct) return direct
  const goal = runStr(run, 'goal_sentence')
  if (!goal) return ''
  const match = specs.find((s) => !s.error && s.goal_sentence === goal)
  return match?.file ?? ''
}

// Build the D-11 re-run pre-fill from a completed experiment run. Same spec +
// snapshot_id, rerun_of = the original run's task_id. When the run was itself a
// single-variant cell we seed a variantOverrides entry keyed by the ORIGINAL
// variant name (base_variant when present, else variant) so the launcher opens
// pre-filled with the same model/agent (cross-plan contract field name).
function buildRerunPrefill(run: Run, specs: SpecSummary[]): {
  spec: string
  snapshot_id: string | null
  rerun_of: string
  overrides: ExperimentOverrides
} {
  const originalVariant = runStr(run, 'base_variant') ?? runStr(run, 'variant')
  const overrides: ExperimentOverrides = {}
  if (originalVariant) {
    const ov: VariantOverride = {}
    const model = runStr(run, 'canonical_model') ?? runStr(run, 'model')
    const agent = runStr(run, 'canonical_agent') ?? runStr(run, 'agent')
    if (model) ov.model = model
    if (agent) ov.agent = agent
    if (ov.model || ov.agent) overrides.variantOverrides = { [originalVariant]: ov }
  }
  return {
    spec: deriveSpecFile(run, specs),
    snapshot_id: runStr(run, 'snapshot_id'),
    rerun_of: run.task_id,
    overrides,
  }
}

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

// D-11 client-side range mirror of api-routes.js:441-453 (score-drawer L63-73).
// regressions is binary; the other four are continuous [0,1]. UX-only — the
// server re-validates and is authoritative. Returns an error string or null.
function validateDim(dim: string, raw: string): string | null {
  if (raw.trim() === '') return 'Enter a value'
  const value = Number(raw)
  if (Number.isNaN(value)) return 'Must be a number'
  if (dim === 'regressions') {
    if (value !== 0 && value !== 1) return 'Regressions must be 0 or 1'
  } else if (value < 0 || value > 1) {
    return 'Must be between 0 and 1'
  }
  return null
}

// D-11 inline-editable score cell. The value shows as before (effective +
// "edited" yellow badge + judged tooltip); click/focus swaps it for a numeric
// Input. On blur/Enter it autosaves via the EXISTING server-authoritative
// `saveOverride` PATCH thunk (server re-validates ranges + writes corrected_*;
// the fulfilled reducer applies an optimistic corrected-wins patch). The client
// range mirror (validateDim) blocks obviously-bad values before the round-trip,
// but the server is authoritative: a non-2xx PATCH reverts the optimistic value
// and surfaces 400 (server message) vs 404 ("reopen the run") inline. The cell
// stops click propagation so editing never triggers the row's setSelectedTaskId.
function ScoreCell({ dim, run }: { dim: string; run: Run }) {
  const dispatch = useAppDispatch()
  const savePending = useAppSelector(selectSaveOverridePending)
  const eff = effective(dim, run.score)
  const edited = isEdited(dim, run.score)
  const judgedVal = judged(dim, run.score)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  // Inline error message shown UNDER the cell after a rejected PATCH (or a
  // failed client range check). Cleared when a fresh edit starts.
  const [inlineError, setInlineError] = useState<string | null>(null)

  const beginEdit = () => {
    setDraft(eff == null ? '' : String(eff))
    setInlineError(null)
    setEditing(true)
  }

  const cancelEdit = () => {
    setEditing(false)
    setDraft('')
  }

  const commit = async () => {
    // No change → just exit edit mode (the optimistic value stays what it was).
    if (eff != null && draft.trim() === String(eff)) {
      cancelEdit()
      return
    }
    const clientErr = validateDim(dim, draft)
    if (clientErr) {
      // Block obviously-bad values before the round-trip (UX-only); keep editing.
      setInlineError(clientErr)
      return
    }
    const value = Number(draft)
    const result = await dispatch(
      saveOverride({ taskId: run.task_id, edits: [{ dimension: dim, value }], overridden_by: DEFAULT_OVERRIDDEN_BY }),
    )
    if (saveOverride.rejected.match(result)) {
      // Server is authoritative — REVERT the optimistic value (the fulfilled
      // reducer never ran, so run.score is unchanged) and surface the reason.
      const status = result.payload?.status
      setInlineError(
        status === 404
          ? 'This score changed on the server — reopen the run to edit.'
          : (result.payload?.message ?? 'Could not save — the value was rejected.'),
      )
      return
    }
    // Fulfilled: the reducer applied the optimistic corrected-wins patch.
    cancelEdit()
  }

  if (editing) {
    return (
      <span onClick={(e) => e.stopPropagation()}>
        <Input
          autoFocus
          inputMode="decimal"
          data-testid="inline-score-input"
          aria-label={`Edit ${dim} score for ${run.task_id}`}
          className="ml-auto w-16 text-sm font-mono"
          value={draft}
          disabled={savePending}
          onChange={(e) => { setDraft(e.target.value); setInlineError(null) }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); void commit() }
            else if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
          }}
        />
        {inlineError && (
          <p className="mt-1 text-xs text-status-error" role="alert">{inlineError}</p>
        )}
      </span>
    )
  }

  // Non-editing view: value + (when overridden) the retained yellow "edited"
  // badge with the judged tooltip. Click/focus enters edit mode.
  const view = (
    <span
      role="button"
      tabIndex={0}
      className="inline-flex cursor-text items-center gap-1"
      onClick={(e) => { e.stopPropagation(); beginEdit() }}
      onFocus={beginEdit}
    >
      <span className="font-mono">{num(eff)}</span>
      {edited && (
        <Badge
          variant="outline"
          className="gap-1 border-yellow-200 bg-yellow-50 text-yellow-700"
        >
          <Pencil className="size-3.5" />
          edited
        </Badge>
      )}
    </span>
  )

  return (
    <span onClick={(e) => e.stopPropagation()}>
      {edited ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>{view}</TooltipTrigger>
            <TooltipContent>
              Judged: {judgedVal == null ? '—' : judgedVal.toFixed(2)}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : view}
      {inlineError && !editing && (
        <p className="mt-1 text-xs text-status-error" role="alert">{inlineError}</p>
      )}
    </span>
  )
}

export function RunsTable({ onCompare }: { onCompare?: () => void } = {}) {
  const dispatch = useAppDispatch()
  const filtered = useAppSelector(selectFilteredRuns)
  const allRuns = useAppSelector(selectRuns)
  const selectedTaskId = useAppSelector(selectSelectedTaskId)
  const selectedRunIds = useAppSelector(selectSelectedRunIds)
  const deletePending = useAppSelector(selectDeleteRunsPending)
  // 85-06: the server-listed specs (fetched by the launcher on mount) — the re-run
  // prefill derives the spec file from them by exact goal_sentence match.
  const specList = useAppSelector(selectSpecList)
  const [confirmOpen, setConfirmOpen] = useState(false)
  // Pagination: reveal RUNS_PAGE_SIZE rows at a time (newest first). "Show more"
  // grows the window by a page; "Show all" reveals the rest. Reset back to the
  // first page whenever the filtered set changes size (a new facet selection
  // shouldn't leave the operator scrolled deep into a stale window).
  const [visibleCount, setVisibleCount] = useState(RUNS_PAGE_SIZE)

  // 85-06 DEFECT B: the re-run prefill derives the spec file from the server-listed specs by
  // exact goal_sentence match. The launcher normally fetches them on mount, but a defensive
  // fetch here guarantees specList is populated even if a user reaches the runs table before the
  // launcher's fetch resolves — otherwise deriveSpecFile returns '' and the spec does NOT
  // pre-select (the Re-run then opens rerun_of-only, reading as a partial no-op).
  useEffect(() => {
    if (specList.length === 0) dispatch(fetchSpecList())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Newest-first ordering (see runSortTs). Sort a COPY — the selector's array is
  // frozen/shared state. Then slice to the current page window.
  const sortedRuns = [...filtered].sort((a, b) => runSortTs(b).localeCompare(runSortTs(a)))
  const visibleRuns = sortedRuns.slice(0, visibleCount)
  const remaining = sortedRuns.length - visibleRuns.length

  // Snap the window back to the first page when the filtered set size changes.
  useEffect(() => {
    setVisibleCount(RUNS_PAGE_SIZE)
  }, [filtered.length])

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
            {/* D-08 Compare-from-selection: enabled ONLY when exactly 2 runs are
                selected. Sets the compare pair and asks the page to switch to the
                Compare tab (which mounts the Plan-04 DifferenceViewer). */}
            {(() => {
              const canCompare = selectedRunIds.length === 2
              return (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <Button
                          size="sm"
                          data-testid="compare-selected"
                          disabled={!canCompare}
                          onClick={() => {
                            if (!canCompare) return
                            dispatch(setCompareA(selectedRunIds[0]))
                            dispatch(setCompareB(selectedRunIds[1]))
                            onCompare?.()
                          }}
                        >
                          <GitCompare className="size-3.5" />
                          Compare selected ({selectedRunIds.length})
                        </Button>
                      </span>
                    </TooltipTrigger>
                    {!canCompare && (
                      <TooltipContent>Select two runs to compare.</TooltipContent>
                    )}
                  </Tooltip>
                </TooltipProvider>
              )
            })()}
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
            <TableHead>Run</TableHead>
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
            <TableHead>Reconciliation</TableHead>
            <TableHead className="text-right sr-only">Edit</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleRuns.map((run) => {
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
                <TableCell className="max-w-[240px]" title={runStr(run, 'goal_sentence') || run.task_id}>
                  {runStr(run, 'goal_sentence')
                    ? (
                      <div className="flex flex-col">
                        <span className="truncate text-sm font-medium">{runStr(run, 'goal_sentence')}</span>
                        <span className="truncate font-mono text-xs text-muted-foreground">{run.task_id}</span>
                      </div>
                    )
                    : <span className="truncate font-mono text-sm">{run.task_id}</span>}
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
                {/* D-12 per-run reconciliation badge — renders one of the three
                    pinned states from VERBATIM Plan-02 summary data; absent (no
                    badge) when the run has no reconciliation file (D-06 honesty). */}
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <ReconciliationBadge taskId={run.task_id} />
                </TableCell>
                <TableCell className="text-right">
                  {/* Rich hover copy on each action so a reader knows what it does.
                      Re-run / Fork appear ONLY on completed experiment runs (they
                      need a spec+snapshot to reproduce), so ambient auto-measured
                      sessions correctly show just Explain + Edit scores. */}
                  <TooltipProvider>
                    <div className="flex items-center justify-end gap-1">
                      {/* Ambient-session hint — an ambient run has no Re-run/Fork (there's
                          no spec/snapshot to reproduce). A muted "session" tag explains the
                          otherwise-empty action space the operator noticed. */}
                      {!isExperimentRun(run) && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span
                              className="inline-flex cursor-help items-center gap-1 rounded border border-dashed px-1.5 py-0.5 text-xs text-muted-foreground"
                              data-testid="ambient-session-hint"
                            >
                              <Radio className="size-3" />
                              session
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            Ambient session — auto-measured from the live agent session, not a
                            spec-driven experiment cell. There’s no snapshot to reproduce, so it
                            can’t be re-run or forked into avenues.
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {/* D-11: Re-run — only on COMPLETED experiment runs. Opens the
                          launcher pre-filled (same spec + snapshot, rerun_of set, plus
                          the per-variant model/agent seed). */}
                      {isCompletedExperimentRun(run) && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              data-testid="rerun-experiment"
                              aria-label={`Re-run experiment ${run.task_id}`}
                              onClick={(e) => {
                                // Don't bubble to the row (which drives the timeline).
                                e.stopPropagation()
                                dispatch(setLauncherPrefill(buildRerunPrefill(run, specList)))
                                // 85-06 DEFECT B: the launcher card sits at the TOP of the page while
                                // this button is far down the runs table, so the pre-fill happened
                                // OFF-SCREEN and the click read as dead. Bring the launcher INTO VIEW
                                // so the operator sees the rerun banner + pre-selected spec. The
                                // launcher's own useEffect applies a transient highlight on consume.
                                document
                                  .getElementById('experiment-launcher')
                                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                              }}
                            >
                              <RotateCcw className="size-3.5" />
                              Re-run
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            Re-run this experiment — reopens the launcher pre-filled with the same spec,
                            snapshot and variant, so a fresh run is directly comparable (same task_hash).
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {/* AVN-02 (D-01/D-03): Fork into avenues — SAME completed-span
                          guard as Re-run. Pre-fills the launcher's four-axis picker
                          (buildForkPrefill seeds it from this span + carries the
                          origin_span_id link) and scrolls it into view with the
                          transient ring-2 ring-primary highlight. The fork does NOT
                          add a new API path — launch reuses launchExperiment; the
                          avenue-spec synthesis is Plan 87-03's synthesizeAvenueSpec
                          invoked server-side via the existing run bridge. */}
                      {isCompletedExperimentRun(run) && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              data-testid="fork-into-avenues"
                              aria-label={`Fork span ${run.task_id} into avenues`}
                              onClick={(e) => {
                                // Don't bubble to the row (which drives the timeline).
                                e.stopPropagation()
                                dispatch(setLauncherPrefill(buildForkPrefill(run)))
                                document
                                  .getElementById('experiment-launcher')
                                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                              }}
                            >
                              <GitBranch className="size-3.5" />
                              Fork into avenues
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            Fork this run into avenues — seed a new sweep from this span across the
                            agent / model / framework / knowledge-injection axes, each avenue running
                            in its own isolated worktree.
                          </TooltipContent>
                        </Tooltip>
                      )}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            data-testid="explain-context"
                            aria-label={`Explain context and caching for ${run.task_id}`}
                            onClick={(e) => {
                              // Don't let the click bubble to the row (which drives the timeline).
                              e.stopPropagation()
                              dispatch(setExplainTaskId(run.task_id))
                            }}
                          >
                            <Layers className="size-3.5" />
                            Explain
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          Explain context &amp; caching — open a breakdown of this run’s context window:
                          what filled it, what was cached, and the per-segment token cost.
                        </TooltipContent>
                      </Tooltip>
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
                  </TooltipProvider>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      {remaining > 0 && (
        <div
          className="flex items-center justify-center gap-3 border-t px-3 py-2"
          data-testid="runs-pagination"
        >
          <span className="text-sm text-muted-foreground">
            Showing <span className="font-semibold">{visibleRuns.length}</span> of{' '}
            <span className="font-semibold">{sortedRuns.length}</span> runs
          </span>
          <Button
            variant="outline"
            size="sm"
            data-testid="runs-show-more"
            onClick={() => setVisibleCount((n) => n + RUNS_PAGE_SIZE)}
          >
            Show {Math.min(RUNS_PAGE_SIZE, remaining)} more
          </Button>
          <Button
            variant="ghost"
            size="sm"
            data-testid="runs-show-all"
            onClick={() => setVisibleCount(sortedRuns.length)}
          >
            Show all ({sortedRuns.length})
          </Button>
        </div>
      )}
      <p className="border-t px-3 py-2 text-sm text-muted-foreground">
        Scores are 0–1 rubric values. <span aria-hidden>↑</span> higher is better (Goal, Quality, Coverage);{' '}
        <span aria-hidden>↓</span> lower is better (Regress., Drift). Hover a column header for details. An
        amber “edited” marker means an operator override; hover it to see the original judged value.
      </p>
    </div>
  )
}
