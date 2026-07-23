import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAppSelector, useAppDispatch } from '@/store'
import {
  fetchTimeline,
  selectRuns,
  selectTimelineFor,
  setCompareA,
  setCompareB,
  selectCompareA,
  selectCompareB,
  type Run,
} from '@/store/slices/performanceSlice'
import { normalizeModel } from './models'
import { ROLE_META, ROLE_ORDER, summarizeByRole, type Role, type RoleStat } from './roles'
import { effective, isExperimentCell, EXPERIMENT_DRIFT_NOTE, SCORE_DIMENSIONS } from './corrected-wins'

// C: side-by-side run comparison. Picks two runs (e.g. the same task with a
// different foreground model) and contrasts them by ROLE — foreground vs
// knowledge-capture vs infrastructure turns/tokens — plus outcome scores, total
// tokens, and wallclock/step. Deltas are B − A so "what changed when I varied the
// parameter" reads left-to-right. Reuses the shared summarizeByRole so the role
// math is identical to the timeline.

const DIM_LABEL: Record<string, string> = {
  goal_achieved: 'Goal',
  code_quality: 'Quality',
  test_coverage: 'Coverage',
  regressions: 'Regressions',
  spec_drift: 'Spec drift',
}

// Direction of "good" per metric — drives the delta colour. Lower-is-better for
// tokens/regressions/drift/wallclock; higher-is-better for the positive scores.
type Better = 'higher' | 'lower' | 'neutral'

function fmtNum(v: number | null | undefined, digits = 0): string {
  if (v == null || Number.isNaN(v)) return '—'
  return digits > 0 ? v.toFixed(digits) : Math.round(v).toLocaleString()
}

function Delta({ a, b, better, digits = 0 }: { a: number | null; b: number | null; better: Better; digits?: number }) {
  if (a == null || b == null || Number.isNaN(a) || Number.isNaN(b)) {
    return <span className="text-muted-foreground">—</span>
  }
  const d = b - a
  if (d === 0) return <span className="text-muted-foreground">0</span>
  const sign = d > 0 ? '+' : '−'
  const mag = Math.abs(d)
  const pct = a !== 0 ? ` (${d > 0 ? '+' : '−'}${Math.abs((d / a) * 100).toFixed(0)}%)` : ''
  const isGood = better === 'neutral' ? null : (better === 'higher' ? d > 0 : d < 0)
  const color = isGood == null ? 'text-muted-foreground' : isGood ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
  return (
    <span className={`font-mono ${color}`}>
      {sign}{digits > 0 ? mag.toFixed(digits) : Math.round(mag).toLocaleString()}{pct}
    </span>
  )
}

interface MetricRow {
  label: string
  a: number | null
  b: number | null
  better: Better
  digits?: number
  group?: boolean
  // Redundant for this pairing (Drift when BOTH runs are experiment cells) — the
  // row renders muted with an explanatory title so it does not read as signal.
  muted?: boolean
}

function RunPicker({ value, onChange, runs, label, exclude }: {
  value: string | null
  onChange: (v: string) => void
  runs: Run[]
  label: string
  exclude?: string | null
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm text-muted-foreground">{label}</span>
      <Select value={value ?? undefined} onValueChange={onChange}>
        <SelectTrigger className="w-[280px]" data-testid={`compare-picker-${label}`}>
          <SelectValue placeholder="Select a run…" />
        </SelectTrigger>
        <SelectContent>
          {runs.map((r) => (
            <SelectItem key={r.task_id} value={r.task_id} disabled={r.task_id === exclude} data-testid={`compare-option-${r.task_id}`}>
              {r.task_id}
              {r.canonical_model ? ` · ${normalizeModel(r.canonical_model)}` : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function statOf(stats: RoleStat[], role: Role): RoleStat {
  return stats.find((s) => s.role === role) ?? { role, turns: 0, totalTokens: 0, cacheRead: 0, cacheWrite: 0, models: [] }
}

function metaLine(run: Run | null, stats: RoleStat[]): ReactNode {
  if (!run) return <span className="text-muted-foreground">—</span>
  const fg = statOf(stats, 'foreground')
  return (
    <div className="text-sm">
      <div className="font-mono">{run.canonical_model ? normalizeModel(run.canonical_model) : 'unmeasured'}</div>
      <div className="text-muted-foreground">
        {run.agent ?? '—'} · fg models: {fg.models.length ? fg.models.join(', ') : '—'}
      </div>
      {/* Goal sentence (Run.description), if recorded — lets the operator confirm
          both runs pursued the same goal before trusting the Δ. */}
      {run.goal_sentence && (
        <div className="mt-0.5 text-muted-foreground">Goal: {run.goal_sentence}</div>
      )}
    </div>
  )
}

export function RunCompare() {
  const dispatch = useAppDispatch()
  const runs = useAppSelector(selectRuns)
  const aId = useAppSelector(selectCompareA)
  const bId = useAppSelector(selectCompareB)
  const aRows = useAppSelector(selectTimelineFor(aId))
  const bRows = useAppSelector(selectTimelineFor(bId))

  useEffect(() => { if (aId) dispatch(fetchTimeline(aId)) }, [aId, dispatch])
  useEffect(() => { if (bId) dispatch(fetchTimeline(bId)) }, [bId, dispatch])

  const runA = runs.find((r) => r.task_id === aId) ?? null
  const runB = runs.find((r) => r.task_id === bId) ?? null
  const statsA = summarizeByRole(aRows, runA)
  const statsB = summarizeByRole(bRows, runB)

  const scoreVal = (run: Run | null, dim: string) => (run ? effective(dim, run.score) : null)
  // Drift is redundant with Goal only when BOTH sides are experiment cells (freeform
  // goals). If either run is a GSD/interactive run with a real PLAN.md, keep it lit.
  const driftRedundant = isExperimentCell(runA) && isExperimentCell(runB)

  const rows: MetricRow[] = [
    ...ROLE_ORDER.flatMap((role): MetricRow[] => [
      { label: `${ROLE_META[role].label} — turns`, a: statOf(statsA, role).turns, b: statOf(statsB, role).turns, better: role === 'foreground' ? 'neutral' : 'lower', group: true },
      { label: `${ROLE_META[role].label} — tokens (in+out)`, a: statOf(statsA, role).totalTokens, b: statOf(statsB, role).totalTokens, better: role === 'foreground' ? 'neutral' : 'lower' },
      // Cache tokens shown SEPARATELY from the in+out total — a heavily-cached run (claude) is
      // dominated by these; without them its total looks implausibly small vs a fresh-read run.
      { label: `${ROLE_META[role].label} — cache read`, a: statOf(statsA, role).cacheRead, b: statOf(statsB, role).cacheRead, better: 'neutral' },
      { label: `${ROLE_META[role].label} — cache write`, a: statOf(statsA, role).cacheWrite, b: statOf(statsB, role).cacheWrite, better: 'neutral' },
    ]),
    { label: 'Total tokens', a: runA?.outcome?.totalTokens ?? null, b: runB?.outcome?.totalTokens ?? null, better: 'lower', group: true },
    { label: 'Wallclock / step (s)', a: runA?.wallclock_per_step ?? null, b: runB?.wallclock_per_step ?? null, better: 'lower', digits: 1 },
    ...SCORE_DIMENSIONS.map((dim): MetricRow => ({
      label: DIM_LABEL[dim] ?? dim,
      a: scoreVal(runA, dim),
      b: scoreVal(runB, dim),
      better: (dim === 'regressions' || dim === 'spec_drift') ? 'lower' : 'higher',
      digits: 2,
      group: dim === 'goal_achieved',
      muted: dim === 'spec_drift' && driftRedundant,
    })),
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Compare runs</CardTitle>
        <p className="text-sm text-muted-foreground">
          Contrast two runs by role — e.g. the same task with a different foreground model. Δ is B − A;
          green means B improved on that metric (lower tokens/regressions/drift/wallclock, higher scores).
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-6">
          <RunPicker label="Run A" value={aId} onChange={(v) => dispatch(setCompareA(v))} runs={runs} exclude={bId} />
          <RunPicker label="Run B" value={bId} onChange={(v) => dispatch(setCompareB(v))} runs={runs} exclude={aId} />
        </div>

        {!runA || !runB ? (
          <p className="text-sm text-muted-foreground">Pick two runs to compare.</p>
        ) : (
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm" data-testid="compare-table">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="px-3 py-2 text-left font-medium">Metric</th>
                  <th className="px-3 py-2 text-right font-medium">
                    <div className="truncate font-mono" title={aId ?? ''}>{aId}</div>
                    {metaLine(runA, statsA)}
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    <div className="truncate font-mono" title={bId ?? ''}>{bId}</div>
                    {metaLine(runB, statsB)}
                  </th>
                  <th className="px-3 py-2 text-right font-medium">Δ (B−A)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr
                    key={i}
                    className={`border-b last:border-0 ${row.group ? 'border-t-2 border-t-muted' : ''} ${row.muted ? 'opacity-60' : ''}`}
                    title={row.muted ? EXPERIMENT_DRIFT_NOTE : undefined}
                  >
                    <td className="px-3 py-1.5 text-muted-foreground">{row.muted ? <span className="italic">{row.label} <span className="text-xs">(redundant)</span></span> : row.label}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{fmtNum(row.a, row.digits)}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{fmtNum(row.b, row.digits)}</td>
                    <td className="px-3 py-1.5 text-right"><Delta a={row.a} b={row.b} better={row.better} digits={row.digits} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
