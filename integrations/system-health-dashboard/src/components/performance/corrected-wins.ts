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
