import { useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip'
import { useAppSelector, useAppDispatch } from '@/store'
import {
  fetchComparison,
  selectComparisonFor,
  selectSelectedTaskHash,
  type ComparisonReport,
  type VariantEntry,
  type MetricStat,
} from '@/store/slices/performanceSlice'

// CMP-04 (Phase 80): the variant-comparison matrix. Variants render as COLUMNS,
// metrics/variance/gate as ROWS (transposed vs runs-table), ranked best-first
// (D-02). The four Phase-79 groups are the HONESTY SPINE — `ranked` first, then
// the visibly-separated `failed`/`ungated`/`unscored` "not ranked" region, each
// carrying its `.reason`. A variant with no successful runs shows in `failed` as
// "no successful runs", NEVER a cheap winner. Fed live by GET
// /api/experiments/comparison via the fetchComparison thunk keyed by task_hash —
// this component holds NO fetch and NO shared useState (project_dashboard_redux_state).

// ── formatting ──────────────────────────────────────────────────────────────
function fmtNum(v: number | null | undefined, digits = 0): string {
  if (v == null || Number.isNaN(v)) return '—'
  return digits > 0 ? v.toFixed(digits) : Math.round(v).toLocaleString()
}

// The surfaced metric rows, in the frozen Phase-79 order. `digits` controls the
// precision (rubric dims are 0–1 fractions → 2dp; token/step counts are integers).
const METRIC_ROWS: { key: string; label: string; digits: number }[] = [
  { key: 'totalTokens', label: 'Total tokens', digits: 0 },
  { key: 'wallclock', label: 'Wallclock (s)', digits: 1 },
  { key: 'wallclock_per_step', label: 'Wallclock / step (s)', digits: 1 },
  { key: 'rubric_score', label: 'Rubric score', digits: 2 },
  { key: 'loop_count', label: 'Loop count', digits: 0 },
  { key: 'edit_revert_count', label: 'Edit reverts', digits: 0 },
  { key: 'redundant_read_count', label: 'Redundant reads', digits: 0 },
  { key: 'abandoned_tool_count', label: 'Abandoned tools', digits: 0 },
  { key: 'total_step_count', label: 'Total steps', digits: 0 },
  { key: 'goal_achieved', label: 'Goal achieved', digits: 2 },
  { key: 'code_quality', label: 'Code quality', digits: 2 },
  { key: 'test_coverage', label: 'Test coverage', digits: 2 },
  { key: 'regressions', label: 'Regressions', digits: 2 },
  { key: 'spec_drift', label: 'Spec drift', digits: 2 },
]

// A single metric cell: `mean ± stddev`, with median/min/max/n on hover. Renders
// report strings/numbers as React text children ONLY — no dangerouslySetInnerHTML
// (T-80-03-03 XSS discipline).
function MetricCell({ stat, digits }: { stat: MetricStat | undefined; digits: number }) {
  if (!stat || stat.mean == null) {
    return <span className="text-muted-foreground">—</span>
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help font-mono">
          {fmtNum(stat.mean, digits)}
          <span className="text-muted-foreground"> ± {fmtNum(stat.stddev, digits)}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <div className="font-mono text-xs">
          <div>median {fmtNum(stat.median, digits)}</div>
          <div>min {fmtNum(stat.min, digits)} · max {fmtNum(stat.max, digits)}</div>
          <div>n = {stat.n}</div>
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

const GATE_VARIANT: Record<VariantEntry['gate_outcome'], 'default' | 'destructive' | 'secondary' | 'outline'> = {
  passed: 'default',
  failed: 'destructive',
  ungated: 'secondary',
  unscored: 'outline',
}

function GateBadge({ outcome }: { outcome: VariantEntry['gate_outcome'] }) {
  return <Badge variant={GATE_VARIANT[outcome]}>{outcome}</Badge>
}

// The transposed matrix for one group of variants (variants across columns, metrics
// down rows). `ranked` adds the rank + composite header rows; the other groups add
// a `reason` row instead.
function VariantsMatrix({ entries, ranked }: { entries: VariantEntry[]; ranked: boolean }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-48">Metric</TableHead>
            {entries.map((e) => (
              <TableHead key={e.variant} data-testid="comparison-variant-col" className="text-right font-mono">
                {ranked && e.rank != null ? <span className="mr-1 font-bold">#{e.rank}</span> : null}
                <span title={e.variant}>{e.variant}</span>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {/* gate_outcome row */}
          <TableRow>
            <TableCell className="text-muted-foreground">Gate outcome</TableCell>
            {entries.map((e) => (
              <TableCell key={e.variant} className="text-right">
                <GateBadge outcome={e.gate_outcome} />
              </TableCell>
            ))}
          </TableRow>
          {/* n row */}
          <TableRow>
            <TableCell className="text-muted-foreground">n (repeats)</TableCell>
            {entries.map((e) => (
              <TableCell key={e.variant} className="text-right font-mono">{e.n}</TableCell>
            ))}
          </TableRow>
          {/* composite (ranked only) or reason (not-ranked groups) */}
          {ranked ? (
            <TableRow className="border-t-2">
              <TableCell className="text-muted-foreground">Composite</TableCell>
              {entries.map((e) => (
                <TableCell key={e.variant} className="text-right font-mono">{fmtNum(e.composite, 3)}</TableCell>
              ))}
            </TableRow>
          ) : (
            <TableRow className="border-t-2">
              <TableCell className="text-muted-foreground">Reason</TableCell>
              {entries.map((e) => (
                <TableCell key={e.variant} className="text-right text-sm text-muted-foreground">{e.reason ?? '—'}</TableCell>
              ))}
            </TableRow>
          )}
          {/* metric rows */}
          {METRIC_ROWS.map((m) => (
            <TableRow key={m.key}>
              <TableCell className="text-muted-foreground">{m.label}</TableCell>
              {entries.map((e) => (
                <TableCell key={e.variant} className="text-right">
                  <MetricCell stat={e.metrics[m.key]} digits={m.digits} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

// A labelled honesty-spine group section. Renders the matrix when non-empty, or an
// explicit empty-state (never a fabricated winner) when the group has no variants.
function GroupSection({
  testid, title, subtitle, entries, ranked,
}: {
  testid: string
  title: string
  subtitle: string
  entries: VariantEntry[]
  ranked: boolean
}) {
  return (
    <div data-testid={testid} className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">— none —</p>
      ) : (
        <VariantsMatrix entries={entries} ranked={ranked} />
      )}
    </div>
  )
}

export function ComparisonMatrix() {
  const dispatch = useAppDispatch()
  const taskHash = useAppSelector(selectSelectedTaskHash) // D-03: the experiment identity
  const report = useAppSelector((s) => selectComparisonFor(s, taskHash)) as ComparisonReport | null

  useEffect(() => {
    if (taskHash) dispatch(fetchComparison({ taskHash }))
  }, [dispatch, taskHash])

  if (!taskHash) {
    return (
      <Card data-testid="comparison-matrix">
        <CardContent className="py-8 text-sm text-muted-foreground">
          No experiment selected — select a run to compare its variants.
        </CardContent>
      </Card>
    )
  }

  return (
    <TooltipProvider>
      <Card data-testid="comparison-matrix">
        <CardHeader>
          <CardTitle className="text-base">Variant comparison</CardTitle>
          <p className="text-sm text-muted-foreground">
            Variants as columns, metrics ± variance as rows. Ranked best-first;
            failed / ungated / unscored variants are shown separately and are never
            ranked as a winner (task_hash <span className="font-mono">{taskHash.slice(0, 12)}…</span>).
          </p>
        </CardHeader>
        <CardContent className="space-y-8">
          {report == null ? (
            <p className="text-sm text-muted-foreground">
              No comparison available for this task_hash yet.
            </p>
          ) : (
            <>
              <GroupSection
                testid="comparison-group-ranked"
                title="RANKED"
                subtitle="Successful, gated & scored — sorted best composite first."
                entries={report.ranked}
                ranked
              />
              <GroupSection
                testid="comparison-group-failed"
                title="FAILED (no successful runs)"
                subtitle="Gate failed or timeout/abort — never a cheap winner."
                entries={report.failed}
                ranked={false}
              />
              <GroupSection
                testid="comparison-group-ungated"
                title="UNGATED"
                subtitle="No test_command — shown, not ranked."
                entries={report.ungated}
                ranked={false}
              />
              <GroupSection
                testid="comparison-group-unscored"
                title="UNSCORED"
                subtitle="Successful & gated but null/zero rubric — shown, not ranked."
                entries={report.unscored}
                ranked={false}
              />
            </>
          )}
        </CardContent>
      </Card>
    </TooltipProvider>
  )
}
