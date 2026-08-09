import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useAppSelector, useAppDispatch } from '@/store'
import {
  fetchKgbenchRuns,
  fetchKgbenchPublished,
  fetchKgbenchReport,
  setKgbenchActiveRunId,
  selectKgbenchRuns,
  selectKgbenchRunsLoading,
  selectKgbenchPublished,
  selectKgbenchReport,
  selectKgbenchReportRunId,
  selectKgbenchReportIsPublished,
  selectKgbenchReportLoading,
  selectKgbenchReportError,
  type KgbenchArmReport,
  type KgbenchStats,
} from '@/store/slices/kgbenchSlice'

// Benchmark results — the numbers lib/kgbench/report.mjs produces, rendered as served.
//
// NOTHING IS COMPUTED HERE. Every mean, median, p95, rate and winner arrives from the server,
// which calls the same `aggregate()` the published CLI report calls. That is not laziness: the
// coding-v1 benchmark spent a week finding four separate grading defects, and the fix for each
// one landed in that module. A TypeScript reimplementation would be a fifth place for the
// aggregation to be subtly different, and a dashboard that quietly disagrees with the README
// it illustrates is worse than no dashboard.
//
// The two sources are kept apart on purpose. A LIVE report is what a run's rows say right now.
// A PUBLISHED report is the committed artefact under docs/benchmarks/, which the README's
// prose was written around. They can legitimately differ — a regrade changes the live numbers
// and not the document — and showing which one you are looking at is the difference between
// "the docs are stale" and "someone is wrong".

function fmt(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toFixed(digits)
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${(n * 100).toFixed(1)}%`
}

function fmtTokens(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(Math.round(n))
}

function stat(metrics: Record<string, KgbenchStats> | undefined, key: string): KgbenchStats | null {
  return metrics?.[key] ?? null
}

/**
 * One row per arm (or per arm×agent). Median rather than mean for the headline score, matching
 * what the CLI report leads with — a single hard failure drags a mean of 48 cells visibly, and
 * the failure is reported separately as a rate rather than smuggled into the score.
 */
function ArmTable({ rows, label, keyLabel }: { rows: [string, KgbenchArmReport][]; label: string; keyLabel: string }) {
  if (rows.length === 0) return null
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{label}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-1 pr-3 font-medium">{keyLabel}</th>
              <th className="py-1 pr-3 text-right font-medium">Cells</th>
              <th className="py-1 pr-3 text-right font-medium">Ranked</th>
              <th className="py-1 pr-3 text-right font-medium">Score (median)</th>
              <th className="py-1 pr-3 text-right font-medium">Hard fail</th>
              <th className="py-1 pr-3 text-right font-medium">Halluc.</th>
              <th className="py-1 pr-3 text-right font-medium">Content tokens</th>
              <th className="py-1 pr-3 text-right font-medium">Wall (s)</th>
              <th className="py-1 pr-3 font-medium">Enforcement</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([key, r]) => {
              const score = stat(r.metrics, 'score')
              const content = stat(r.metrics, 'content_tokens')
              const wall = stat(r.metrics, 'wall_s')
              return (
                <tr key={key} className="border-b last:border-0">
                  <td className="py-1 pr-3 font-mono text-xs">{key}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{r.runs}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{r.ranked}</td>
                  <td className="py-1 pr-3 text-right tabular-nums font-medium">{fmt(score?.median)}</td>
                  <td className={`py-1 pr-3 text-right tabular-nums ${(r.hard_fail_rate ?? 0) > 0.1 ? 'text-destructive' : ''}`}>
                    {fmtPct(r.hard_fail_rate)}
                  </td>
                  <td className={`py-1 pr-3 text-right tabular-nums ${(r.hallucination_rate ?? 0) > 0 ? 'text-destructive' : ''}`}>
                    {fmtPct(r.hallucination_rate)}
                  </td>
                  <td className="py-1 pr-3 text-right tabular-nums">{fmtTokens(content?.median)}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{fmt(wall?.median, 1)}</td>
                  <td className="py-1 pr-3">
                    {/* The partial-enforcement marker the plan requires. Only claude gates
                        built-in tools; on copilot and opencode an arm's MCP restriction holds
                        but Read/Grep/Glob stay open. A row whose tool surface was NOT enforced
                        must never sit in a table that implies it was. */}
                    {r.provenance?.builtins_enforced
                      ? <Badge variant="default">builtins enforced</Badge>
                      : <Badge variant="secondary" title={(r.provenance?.builtins_states ?? []).join(', ')}>
                          partial — builtins {(r.provenance?.builtins_states ?? ['ungated']).join('/')}
                        </Badge>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ClassTable({ byClass, arms }: { byClass: NonNullable<import('@/store/slices/kgbenchSlice').KgbenchReport['byClass']>; arms: string[] }) {
  const classes = Object.keys(byClass)
  if (classes.length === 0) return null
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">Score by question class</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-1 pr-3 font-medium">Class</th>
              {arms.map((a) => <th key={a} className="py-1 pr-3 text-right font-medium">{a}</th>)}
              <th className="py-1 pr-3 font-medium">Winner</th>
            </tr>
          </thead>
          <tbody>
            {classes.map((cls) => {
              const entry = byClass[cls]
              return (
                <tr key={cls} className="border-b last:border-0">
                  <td className="py-1 pr-3 font-mono text-xs">{cls}</td>
                  {arms.map((a) => (
                    <td key={a} className="py-1 pr-3 text-right tabular-nums">
                      {fmt(entry.scores?.[a]?.median)}
                      <span className="ml-1 text-xs text-muted-foreground">n={entry.scores?.[a]?.n ?? 0}</span>
                    </td>
                  ))}
                  <td className="py-1 pr-3 text-xs">
                    {/* The winner is the report's own verdict, reason included. A tie is
                        reported as a tie with its ratio — never resolved into a false leader
                        by rounding, which is how a 1.00x difference becomes a headline. */}
                    {entry.winner?.winner
                      ? <><span className="font-medium">{entry.winner.winner}</span>{' '}
                          <span className="text-muted-foreground">({entry.winner.reason})</span></>
                      : <span className="text-muted-foreground">{entry.winner?.reason ?? '—'}</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function KgbenchResults() {
  const dispatch = useAppDispatch()
  const runs = useAppSelector(selectKgbenchRuns)
  const runsLoading = useAppSelector(selectKgbenchRunsLoading)
  const published = useAppSelector(selectKgbenchPublished)
  const report = useAppSelector(selectKgbenchReport)
  const reportRunId = useAppSelector(selectKgbenchReportRunId)
  const isPublished = useAppSelector(selectKgbenchReportIsPublished)
  const loading = useAppSelector(selectKgbenchReportLoading)
  const error = useAppSelector(selectKgbenchReportError)

  const [pick, setPick] = useState('')

  useEffect(() => {
    dispatch(fetchKgbenchRuns())
    dispatch(fetchKgbenchPublished())
  }, [dispatch])

  const onPick = (value: string) => {
    setPick(value)
    if (!value) return
    const [kind, id] = value.split(':')
    dispatch(fetchKgbenchReport({ runId: id, published: kind === 'pub' }))
  }

  const armRows = useMemo<[string, KgbenchArmReport][]>(
    () => Object.entries(report?.byArm ?? {}),
    [report]
  )
  const armAgentRows = useMemo<[string, KgbenchArmReport][]>(
    () => Object.entries(report?.byArmAgent ?? {}),
    [report]
  )
  const armIds = useMemo(() => armRows.map(([id]) => id), [armRows])

  return (
    <div className="space-y-6">
      <Card data-testid="kgbench-results">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Benchmark results</CardTitle>
          <CardDescription>
            Aggregated by <span className="font-mono">lib/kgbench/report.mjs</span> — the same function that
            renders the published report. Nothing on this page is recomputed in the browser.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm text-muted-foreground" htmlFor="kgb-report-pick">Report:</label>
            <select
              id="kgb-report-pick"
              data-testid="kgb-report-pick"
              aria-label="benchmark report"
              className="h-9 min-w-[24rem] rounded-md border bg-background px-2 text-sm"
              value={pick}
              onChange={(e) => onPick(e.target.value)}
            >
              <option value="">{runsLoading ? 'Loading runs…' : 'Choose a run or published report…'}</option>
              {published.length > 0 && (
                <optgroup label="Published (docs/benchmarks)">
                  {published.map((p) => (
                    <option key={`pub:${p.name}`} value={`pub:${p.name}`}>
                      {p.name} — {p.set ?? '?'} · {p.questionCount ?? '?'} questions · {p.commit ?? '?'}
                    </option>
                  ))}
                </optgroup>
              )}
              {runs.length > 0 && (
                <optgroup label="Runs (.data/kgbench/runs)">
                  {runs.map((r) => (
                    <option key={`run:${r.runId}`} value={`run:${r.runId}`} disabled={r.cells === 0}>
                      {r.runId} — {r.cells} cells{r.status ? ` · ${r.status}` : ''}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>

            {reportRunId && (
              <Badge variant={isPublished ? 'default' : 'secondary'} data-testid="kgb-report-source">
                {isPublished ? 'published artefact' : 'live aggregate'}
              </Badge>
            )}

            {reportRunId && !isPublished && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => dispatch(setKgbenchActiveRunId(reportRunId))}
                data-testid="kgb-watch-run"
              >
                Watch this run
              </Button>
            )}
          </div>

          {loading && <p className="mt-3 text-sm text-muted-foreground">Aggregating…</p>}
          {error && (
            <Alert variant="destructive" className="mt-3">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {report && (
        <>
          {/* Provenance first, not last. Every one of this benchmark's grading defects was
              invisible in the score table and visible here — a token source, an elicitation
              mode, an enforcement state. Putting it below the results is how it goes unread. */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Provenance</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <div>
                  <span className="text-muted-foreground">Set / run: </span>
                  <span className="font-mono">{String((report.meta as any)?.set ?? '—')}</span>
                  {' / '}
                  <span className="font-mono">{String((report.meta as any)?.runId ?? reportRunId ?? '—')}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Commit: </span>
                  <span className="font-mono">{String((report.meta as any)?.commit ?? '—')}</span>
                  {(report.meta as any)?.dirty ? <Badge variant="secondary" className="ml-2">tree dirty</Badge> : null}
                </div>
                <div>
                  <span className="text-muted-foreground">Agents: </span>
                  <span className="font-mono">{(report.agents ?? report.provenance?.agents ?? []).join(', ') || '—'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Elicitation: </span>
                  <span className="font-mono">{(report.provenance?.elicitations ?? []).join(', ') || '—'}</span>
                </div>
                <div className="sm:col-span-2">
                  <span className="text-muted-foreground">Token sources: </span>
                  {Object.entries(report.provenance?.token_sources ?? {}).map(([src, n]) => (
                    <Badge key={src} variant="outline" className="mr-1 font-mono">{src}: {n}</Badge>
                  ))}
                  {report.provenance?.ambiguous_token_rows
                    ? <Badge variant="destructive" className="ml-1">{report.provenance.ambiguous_token_rows} ambiguous</Badge>
                    : null}
                </div>
                {report._source && (
                  <div className="sm:col-span-2 text-xs text-muted-foreground">
                    {report._source.rows} of {report._source.rowsTotal} rows aggregated
                    {report._source.retiredQuestions.length > 0 && (
                      <> · excluded as retired: <span className="font-mono">{report._source.retiredQuestions.join(', ')}</span></>
                    )}
                  </div>
                )}
              </div>

              {/* Cross-agent numbers are not uniformly comparable, and the plan requires that
                  to appear WHERE THE NUMBERS ARE, not only in a document. */}
              {(report.agents ?? []).length > 1 && (
                <Alert className="mt-3">
                  <AlertDescription className="text-xs">
                    This run spans multiple agents. Correctness and wall-clock compare cleanly across
                    them; <span className="font-medium">retrieval strategy does not.</span> Only claude
                    can be held to an arm's tool surface — on copilot and opencode the MCP restriction
                    holds but built-in file tools stay open, so an arm defined by withholding search is
                    not the same experiment there. Rows carry their enforcement state in the tables below.
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">By arm</CardTitle></CardHeader>
            <CardContent className="space-y-6">
              <ArmTable rows={armRows} label="Pooled across agents" keyLabel="Arm" />
              {armAgentRows.length > 0 && (
                <ArmTable rows={armAgentRows} label="Split by agent" keyLabel="Arm @ agent" />
              )}
              {report.byClass && <ClassTable byClass={report.byClass} arms={armIds} />}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Grader disagreements
                <Badge variant={(report.disagreements ?? []).length > 0 ? 'secondary' : 'outline'} className="ml-2">
                  {(report.disagreements ?? []).length}
                </Badge>
              </CardTitle>
              <CardDescription>
                Cells where the checklist and the LLM judge scored differently. A disagreement is a
                pointer to something being wrong — <span className="font-medium">and it is usually not
                the question</span>. Every time this benchmark's detector fired, the cause was a judge
                rubric, a false answer key, a matcher, or a shared match token. It cannot see a wrong
                key at all: both graders read it, so they agree and it stays silent.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {(report.disagreements ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No disagreements. That is not proof the keys are right — a wrong key produces exactly this.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="kgb-disagreements">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="py-1 pr-3 font-medium">Question</th>
                        <th className="py-1 pr-3 font-medium">Arm</th>
                        <th className="py-1 pr-3 text-right font-medium">Checklist</th>
                        <th className="py-1 pr-3 text-right font-medium">Judge</th>
                        <th className="py-1 pr-3 font-medium">Kind</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(report.disagreements ?? []).map((d, i) => (
                        <tr key={`${d.id}|${d.arm}|${i}`} className="border-b last:border-0">
                          <td className="py-1 pr-3 font-mono text-xs">{d.id}</td>
                          <td className="py-1 pr-3 font-mono text-xs">{d.arm}</td>
                          <td className="py-1 pr-3 text-right tabular-nums">{fmt(d.checklist)}</td>
                          <td className="py-1 pr-3 text-right tabular-nums">{fmt(d.judge)}</td>
                          <td className="py-1 pr-3 text-xs">{d.kind}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
