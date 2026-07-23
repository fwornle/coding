// D-03 corrected-wins helpers (RESEARCH §Code Examples). Defined ONCE here and
// imported by runs-table (this plan) + the score drawer (Plan 06) so the
// effective-value / edited-marker logic never drifts between surfaces.
//
// effective(dim, score) = corrected_<dim> if non-null, else judged <dim>, else
// null. null means "no evidence / could not compute" and MUST render as `—`,
// NEVER 0 (RESEARCH Pitfall 4 / T-74-05-03).
import type { RunScore } from '@/store/slices/performanceSlice'

// The 5 rubric dimensions the override path covers.
export const SCORE_DIMENSIONS = [
  'goal_achieved',
  'code_quality',
  'test_coverage',
  'regressions',
  'spec_drift',
] as const

export type ScoreDimension = (typeof SCORE_DIMENSIONS)[number]

// A run is an EXPERIMENT CELL (a matrix cell produced by /experiment) iff it
// carries a `variant`. The interactive/ambient/GSD capture path (claudePass in
// scripts/auto-measure-foreground.mjs) NEVER sets one — its task_id is a bare
// session UUID, whereas an experiment cell's is '<expId>--<variant>--rN' (the `--`
// fallback is a belt-and-braces second signal). For such cells `spec_drift` is
// redundant with `goal_achieved`: the goal is freeform, there is no PLAN.md task
// list to diverge from, so the judge either returns null or scores against the
// goal sentence alone (≈ 1 − goal). Surfaces DEPRIORITIZE (mute) the Drift value
// for these rows so it does not read as an independent signal.
export function isExperimentCell(
  run: { variant?: string | null; task_id?: string | null } | null | undefined,
): boolean {
  if (!run) return false
  if (run.variant != null && String(run.variant).trim() !== '') return true
  return typeof run.task_id === 'string' && run.task_id.includes('--')
}

// The dimension muted for experiment cells, and the shared explanation surfaced in
// the header/label tooltip wherever the muting is applied (kept in ONE place so the
// three Performance surfaces word it identically).
export const EXPERIMENT_REDUNDANT_DIM: ScoreDimension = 'spec_drift'
export const EXPERIMENT_DRIFT_NOTE =
  'For experiment cells (freeform goals, no PLAN.md task list) Drift mirrors Goal — it is not an independent signal, so it is shown muted here.'

export function effective(dim: string, score: RunScore | null): number | null {
  if (!score) return null
  const corrected = score[`corrected_${dim}`]
  if (corrected != null && typeof corrected === 'number') return corrected
  const judged = score[dim]
  return judged != null && typeof judged === 'number' ? judged : null
}

export function isEdited(dim: string, score: RunScore | null): boolean {
  return !!score && score[`corrected_${dim}`] != null
}

// Judged (pre-override) value for the dimension, for the hover tooltip.
export function judged(dim: string, score: RunScore | null): number | null {
  if (!score) return null
  const v = score[dim]
  return v != null && typeof v === 'number' ? v : null
}
