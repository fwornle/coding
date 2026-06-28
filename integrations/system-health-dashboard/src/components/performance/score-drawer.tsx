import { useEffect, useState } from 'react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { useAppSelector, useAppDispatch } from '@/store'
import {
  setOverrideTaskId,
  saveOverride,
  selectOverrideRun,
  selectOverrideTaskId,
  selectSaveOverridePending,
  selectSaveOverrideError,
  selectSaveOverrideStatus,
  selectSaveOverrideSuccessAt,
  DEFAULT_OVERRIDDEN_BY,
  type OverrideEdit,
  type Run,
} from '@/store/slices/performanceSlice'
import { SCORE_DIMENSIONS, judged } from './corrected-wins'

// D-02 / SCORE-02 score-override drawer. Opens when the slice's overrideTaskId is
// non-null (set by the runs-table per-row "Edit scores" button — decoupled from
// row selection so the inline Timeline panel is viewable without this modal's
// dimming overlay). Shows 5 rubric rows: the judged value (read-only, muted) + an
// editable corrected_* Input (LOCAL useState form state) + the dimension rationale.
// Save dispatches the saveOverride thunk which issues one EXISTING PATCH
// /api/experiments/scores/:taskId per edited dimension (no applyOverride
// re-implementation — server authoritative) and then re-dispatches fetchRuns so
// corrected-wins refreshes. The client mirrors the server ranges (regressions 0|1,
// others [0,1]) to block obviously-bad saves, but the server re-validates. Closing
// dispatches setOverrideTaskId(null).

const DIM_LABELS: Record<string, string> = {
  goal_achieved: 'Goal achieved',
  code_quality: 'Code quality',
  test_coverage: 'Test coverage',
  regressions: 'Regressions',
  spec_drift: 'Spec drift',
}

// Rationale source: the Score may carry a per-dimension rationale string under
// `rationale_<dim>` or a shared `rationale`. Best-effort, read-only display.
function rationaleFor(dim: string, run: Run | null): string | null {
  const s = run?.score
  if (!s) return null
  const perDim = s[`rationale_${dim}`]
  if (typeof perDim === 'string' && perDim.trim()) return perDim
  const shared = s['rationale']
  if (typeof shared === 'string' && shared.trim()) return shared
  return null
}

// Client-side range validation mirroring api-routes.js:441-453. regressions is
// binary; the other four are continuous [0,1]. Returns an error string or null.
function validateDim(dim: string, raw: string): string | null {
  if (raw.trim() === '') return null // empty = no edit on this row
  const value = Number(raw)
  if (Number.isNaN(value)) return 'Must be a number'
  if (dim === 'regressions') {
    if (value !== 0 && value !== 1) return 'Regressions must be 0 or 1'
  } else if (value < 0 || value > 1) {
    return 'Must be between 0 and 1'
  }
  return null
}

export function ScoreDrawer() {
  const dispatch = useAppDispatch()
  const taskId = useAppSelector(selectOverrideTaskId)
  const run = useAppSelector(selectOverrideRun)
  const pending = useAppSelector(selectSaveOverridePending)
  const saveError = useAppSelector(selectSaveOverrideError)
  const saveStatus = useAppSelector(selectSaveOverrideStatus)
  const successAt = useAppSelector(selectSaveOverrideSuccessAt)

  // IN-PROGRESS corrected_* edits are LOCAL form state (idiomatic), keyed by
  // dimension. Reset whenever the selected run changes.
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  useEffect(() => {
    setDrafts({})
  }, [taskId])

  const open = taskId != null

  const close = () => dispatch(setOverrideTaskId(null))

  // Per-row client validation over the current drafts.
  const rowErrors: Record<string, string | null> = {}
  for (const dim of SCORE_DIMENSIONS) {
    rowErrors[dim] = validateDim(dim, drafts[dim] ?? '')
  }
  const hasClientError = Object.values(rowErrors).some((e) => e != null)

  // Collect the edited dimensions (non-empty, valid drafts) into PATCH edits.
  const edits: OverrideEdit[] = SCORE_DIMENSIONS.flatMap((dim) => {
    const raw = drafts[dim]
    if (raw == null || raw.trim() === '' || rowErrors[dim] != null) return []
    return [{ dimension: dim, value: Number(raw) }]
  })

  const handleSave = async () => {
    if (!taskId || edits.length === 0 || hasClientError) return
    const result = await dispatch(
      saveOverride({ taskId, edits, overridden_by: DEFAULT_OVERRIDDEN_BY })
    )
    // On fulfilled, close + abandon drafts; the success banner is transient slice
    // state surfaced in the table region via the runs refresh.
    if (saveOverride.fulfilled.match(result)) {
      close()
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) close() }}>
      <SheetContent side="right" className="sm:max-w-md overflow-y-auto" data-testid="run-detail-drawer">
        <SheetHeader>
          <SheetTitle>Score override</SheetTitle>
          <SheetDescription>
            {run?.task_id ?? taskId}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-3">
          {SCORE_DIMENSIONS.map((dim, i) => {
            const judgedVal = judged(dim, run?.score ?? null)
            const correctedVal = run?.score?.[`corrected_${dim}`]
            const placeholder =
              typeof correctedVal === 'number'
                ? String(correctedVal)
                : judgedVal == null
                  ? '—'
                  : String(judgedVal)
            const rationale = rationaleFor(dim, run)
            const err = rowErrors[dim]
            return (
              <div key={dim} data-testid={`score-row-${dim}`}>
                {i > 0 && <Separator className="mb-3" />}
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor={`corrected-${dim}`} className="text-sm font-semibold">
                    {DIM_LABELS[dim]}
                  </label>
                  <span className="text-sm text-muted-foreground" title="Judged value (read-only)">
                    Judged: {judgedVal == null ? '—' : judgedVal.toFixed(2)}
                  </span>
                </div>
                <Input
                  id={`corrected-${dim}`}
                  data-testid={`corrected-input-${dim}`}
                  className="mt-1 font-mono"
                  inputMode="decimal"
                  placeholder={placeholder}
                  value={drafts[dim] ?? ''}
                  aria-invalid={err != null}
                  onChange={(e) =>
                    setDrafts((d) => ({ ...d, [dim]: e.target.value }))
                  }
                />
                {err && (
                  <p className="mt-1 text-sm text-destructive" role="alert">{err}</p>
                )}
                {rationale && (
                  <p className="mt-1 text-sm text-muted-foreground">{rationale}</p>
                )}
              </div>
            )
          })}
        </div>

        {saveStatus === 404 && (
          <p className="mt-3 text-sm text-destructive" role="alert">
            Couldn’t save the override. The score may have changed — reopen the run and try again.
          </p>
        )}
        {saveStatus === 400 && saveError && (
          <p className="mt-3 text-sm text-destructive" role="alert">{saveError}</p>
        )}
        {successAt != null && (
          <p className="mt-3 text-sm text-muted-foreground">Override saved</p>
        )}

        <SheetFooter className="mt-6">
          <Button variant="ghost" onClick={close} disabled={pending}>
            Discard changes
          </Button>
          <Button
            onClick={handleSave}
            disabled={pending || edits.length === 0 || hasClientError}
            data-testid="save-override"
          >
            {pending ? 'Saving…' : 'Save override'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
