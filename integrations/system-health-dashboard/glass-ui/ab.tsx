import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

// `glass ab` experiments (lib/glass/ab.mjs): the list, one experiment's
// comparison per variant, and its trials, each linking to its session.
// Read-only: experiments are started from the terminal (`glass ab run`).

const POLL_MS = 5_000

interface VariantSpec { label: string; provider: string; model: string }

interface Summary {
  id: string
  label: string
  agent: string
  status: string
  created_at: string
  finished_at: string | null
  repeats: number
  check: boolean
  before_trial?: boolean
  variants: VariantSpec[]
  trials: number
  planned: number
}

interface VariantRow extends VariantSpec {
  models: string[]
  trials: number
  planned: number
  agent_failures: number
  unmeasured: number
  checked: number
  passed: number
  pass_rate: number | null
  wall_ms: { mean: number | null; sd: number | null }
  latency_ms: { p50: number | null; p95: number | null }
  ttft_ms: { p50: number | null; n: number }
  per_trial: Record<'input' | 'output' | 'reasoning' | 'cache_read' | 'calls' | 'tool_calls' | 'turns', number | null>
}

interface Trial {
  n: number
  round: number
  variant: string
  task_id: string | null
  started_at: string | null
  wall_ms: number | null
  agent_exit: number | null
  timed_out: boolean
  error: string | null
  agent_failed: boolean
  before_trial?: { exit: number | null; wall_ms: number | null; timed_out: boolean; passed: boolean } | null
  check: { exit: number | null; passed: boolean; timed_out: boolean } | null
  calls: number
  models: string[]
  input: number
  output: number
  reasoning: number
  tool_calls: number | null
  latency_p50_ms: number | null
  ttft_p50_ms: number | null
}

interface Report {
  id: string
  label: string
  agent: string
  prompt: string
  check: string | null
  before_trial?: string | null
  repo: string
  repeats: number
  seed: number
  status: string
  created_at: string
  variants: VariantRow[]
  trials: Trial[]
}

const dash = '—'
const fmtMs = (ms: number | null | undefined) =>
  ms === null || ms === undefined ? dash : ms >= 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`
const fmtN = (x: number | null | undefined, digits = 0) =>
  x === null || x === undefined ? dash : x.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits })
const fmtPct = (x: number | null) => (x === null ? dash : `${Math.round(x * 100)} %`)
const target = (v: VariantSpec) => `${v.provider ? `${v.provider}/` : ''}${v.model}`

function StatusBadge({ status }: { status: string }) {
  const tone = status === 'running' ? 'default' : status === 'done' ? 'secondary' : 'outline'
  return <Badge variant={tone} className="text-xs">{status}</Badge>
}

const METRICS: Array<{ name: string; value: (v: VariantRow) => number | null; show: (v: VariantRow) => string; better?: 'lower' | 'higher'; hint?: string }> = [
  { name: 'pass rate', value: (v) => v.pass_rate, show: (v) => (v.checked ? `${fmtPct(v.pass_rate)} (${v.passed}/${v.checked})` : dash), better: 'higher', hint: 'the --check command’s exit code; no LLM judge' },
  { name: 'agent failures', value: (v) => v.agent_failures, show: (v) => String(v.agent_failures), better: 'lower', hint: 'non-zero exit, timeout or an agent that did not start' },
  { name: 'wall time', value: (v) => v.wall_ms.mean, show: (v) => (v.wall_ms.mean === null ? dash : `${fmtMs(v.wall_ms.mean)}${v.wall_ms.sd === null ? '' : ` ± ${fmtMs(v.wall_ms.sd)}`}`), better: 'lower', hint: 'mean ± sd of the agent run, per trial' },
  { name: 'call latency p50', value: (v) => v.latency_ms.p50, show: (v) => fmtMs(v.latency_ms.p50), better: 'lower', hint: 'request to last byte, over all calls' },
  { name: 'call latency p95', value: (v) => v.latency_ms.p95, show: (v) => fmtMs(v.latency_ms.p95), better: 'lower' },
  { name: 'time to first token p50', value: (v) => v.ttft_ms.p50, show: (v) => (v.ttft_ms.n ? fmtMs(v.ttft_ms.p50) : dash), better: 'lower', hint: 'streamed calls only' },
  { name: 'tokens in / trial', value: (v) => v.per_trial.input, show: (v) => fmtN(v.per_trial.input), better: 'lower', hint: 'fresh input; cache reads below' },
  { name: 'cache read / trial', value: (v) => v.per_trial.cache_read, show: (v) => fmtN(v.per_trial.cache_read) },
  { name: 'tokens out / trial', value: (v) => v.per_trial.output, show: (v) => fmtN(v.per_trial.output), better: 'lower' },
  { name: 'of which reasoning', value: (v) => v.per_trial.reasoning, show: (v) => fmtN(v.per_trial.reasoning), hint: 'as the server reports it; 0 where it does not (llama.cpp)' },
  { name: 'calls / trial', value: (v) => v.per_trial.calls, show: (v) => fmtN(v.per_trial.calls, 1), better: 'lower' },
  { name: 'tool calls / trial', value: (v) => v.per_trial.tool_calls, show: (v) => fmtN(v.per_trial.tool_calls, 1) },
  { name: 'turns / trial', value: (v) => v.per_trial.turns, show: (v) => fmtN(v.per_trial.turns, 1), better: 'lower', hint: 'calls of the agent’s own loop (with tools)' },
]

// Metric rows of the comparison. The best value is emphasised only where "better"
// has a direction and every variant has a value that is not all the same.
function best(variants: VariantRow[], m: (typeof METRICS)[number]): number | null {
  const vals = variants.map(m.value)
  if (!m.better || variants.length < 2 || vals.some((x) => x === null)) return null
  const nums = vals as number[]
  if (new Set(nums).size === 1) return null
  return m.better === 'higher' ? Math.max(...nums) : Math.min(...nums)
}

function Comparison({ report }: { report: Report }) {
  return (
    <Table data-testid="ab-comparison">
      <TableHeader>
        <TableRow>
          <TableHead />
          {report.variants.map((v) => (
            <TableHead key={v.label} className="text-right">
              <div className="font-medium text-foreground">{v.label}</div>
              <div className="font-mono text-xs text-muted-foreground">{target(v)}</div>
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell className="text-xs text-muted-foreground" title="the model the calls' rows name — does each variant really run where you pointed it?">answered by</TableCell>
          {report.variants.map((v) => (
            <TableCell key={v.label} className={cn('text-right font-mono text-xs', v.models.length > 1 && 'text-destructive')}>
              {v.models.length ? v.models.join(', ') : dash}
            </TableCell>
          ))}
        </TableRow>
        <TableRow>
          <TableCell className="text-xs text-muted-foreground">trials</TableCell>
          {report.variants.map((v) => (
            <TableCell key={v.label} className="text-right font-mono text-xs">
              {v.trials}{v.trials < v.planned ? ` of ${v.planned}` : ''}
              {v.unmeasured ? <span className="text-destructive" title="trials with no measured call"> · {v.unmeasured} unmeasured</span> : null}
            </TableCell>
          ))}
        </TableRow>
        {METRICS.map((m) => {
          const top = best(report.variants, m)
          return (
            <TableRow key={m.name}>
              <TableCell className="text-xs text-muted-foreground" title={m.hint}>{m.name}</TableCell>
              {report.variants.map((v) => (
                <TableCell key={v.label} className={cn('text-right font-mono text-xs', top !== null && m.value(v) === top && 'font-semibold text-foreground')}>
                  {m.show(v)}
                </TableCell>
              ))}
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

function agentCell(t: Trial) {
  if (t.before_trial && !t.before_trial.passed) return <span className="text-destructive" title={t.error ?? 'before-trial failed'}>skipped</span>
  if (t.error) return <span className="text-destructive" title={t.error}>error</span>
  if (t.timed_out) return <span className="text-destructive">timeout</span>
  if (t.agent_exit === null) return dash
  return <span className={cn(t.agent_exit !== 0 && 'text-destructive')}>exit {t.agent_exit}</span>
}

function checkCell(t: Trial) {
  if (!t.check) return dash
  if (t.check.passed) return <Badge variant="secondary" className="text-xs">pass</Badge>
  return <Badge variant="destructive" className="text-xs">{t.check.timed_out ? 'timeout' : `fail ${t.check.exit ?? ''}`}</Badge>
}

function Trials({ report }: { report: Report }) {
  return (
    <Table data-testid="ab-trials">
      <TableHeader>
        <TableRow>
          <TableHead>#</TableHead>
          <TableHead>Round</TableHead>
          <TableHead>Variant</TableHead>
          <TableHead>Agent</TableHead>
          <TableHead>Check</TableHead>
          <TableHead className="text-right">Wall</TableHead>
          <TableHead className="text-right">Calls</TableHead>
          <TableHead className="text-right">In</TableHead>
          <TableHead className="text-right">Out</TableHead>
          <TableHead className="text-right">Tools</TableHead>
          <TableHead className="text-right">TTFT p50</TableHead>
          <TableHead>Session</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {report.trials.map((t) => (
          <TableRow key={t.n} data-trial={t.n}>
            <TableCell className="font-mono text-xs">{t.n}</TableCell>
            <TableCell className="font-mono text-xs text-muted-foreground">{t.round}</TableCell>
            <TableCell className="text-xs">{t.variant}</TableCell>
            <TableCell className="text-xs">{agentCell(t)}</TableCell>
            <TableCell className="text-xs">{checkCell(t)}</TableCell>
            <TableCell className="text-right font-mono text-xs">{fmtMs(t.wall_ms)}</TableCell>
            <TableCell className={cn('text-right font-mono text-xs', !t.calls && 'text-destructive')}>{t.calls}</TableCell>
            <TableCell className="text-right font-mono text-xs">{fmtN(t.input)}</TableCell>
            <TableCell className="text-right font-mono text-xs">{fmtN(t.output)}</TableCell>
            <TableCell className="text-right font-mono text-xs">{t.tool_calls ?? dash}</TableCell>
            <TableCell className="text-right font-mono text-xs">{fmtMs(t.ttft_p50_ms)}</TableCell>
            <TableCell className="text-xs">
              {t.task_id
                ? <Link to={`/sessions?task=${encodeURIComponent(t.task_id)}`} className="font-mono text-primary hover:underline underline-offset-4">{t.task_id}</Link>
                : dash}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function useJson<T>(url: string | null, poll: boolean): { data: T | null; error: string | null } {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!url) { setData(null); return }
    let live = true
    const load = () => fetch(url)
      .then(async (r) => { const j = await r.json().catch(() => null); if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`); return j as T })
      .then((j) => { if (live) { setData(j); setError(null) } })
      .catch((e: Error) => { if (live) setError(e.message) })
    load()
    const t = poll ? setInterval(load, POLL_MS) : null
    return () => { live = false; if (t) clearInterval(t) }
  }, [url, poll])
  return { data, error }
}

function Experiment({ id }: { id: string }) {
  const [running, setRunning] = useState(true)
  const { data, error } = useJson<{ report: Report }>(`/api/ab/${encodeURIComponent(id)}`, running)
  const report = data?.report
  useEffect(() => { if (report) setRunning(report.status === 'running') }, [report])
  if (error && !report) return <p className="text-sm text-destructive">{error}</p>
  if (!report) return <p className="text-sm text-muted-foreground">loading…</p>
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <span className="font-mono">{report.id}</span>
            {report.label ? <span className="text-muted-foreground font-normal">· {report.label}</span> : null}
            <StatusBadge status={report.status} />
          </CardTitle>
          <CardDescription className="space-y-1">
            <span className="block">
              <Badge variant="outline" className="text-xs mr-2">{report.agent}</Badge>
              {report.repeats} round{report.repeats === 1 ? '' : 's'}, seed {report.seed} · {report.repo}
            </span>
            <span className="block text-xs">prompt: <span className="font-mono">{report.prompt}</span></span>
            <span className="block text-xs">check: <span className="font-mono">{report.check || 'none — no pass rate'}</span></span>
            {report.before_trial ? (
              <span className="block text-xs" data-testid="ab-before-trial">before each trial: <span className="font-mono">{report.before_trial}</span></span>
            ) : null}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Comparison report={report} />
          <p className="mt-3 text-xs text-muted-foreground">
            Quality is the <span className="font-mono">--check</span> command&apos;s exit code only — glass has no LLM judge.
            Means are per trial; latency and time to first token over all calls. With few trials, a difference smaller
            than the ± spread is noise.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Trials</CardTitle>
          <CardDescription>In the order they ran; each round runs every variant once, shuffled. A session opens its calls and context.</CardDescription>
        </CardHeader>
        <CardContent><Trials report={report} /></CardContent>
      </Card>
    </>
  )
}

/** `#/ab` lists experiments; `#/ab?id=<id>` (glass ab run prints it) opens one. */
export function AbPage() {
  const [params, setParams] = useSearchParams()
  const id = params.get('id')
  const { data, error } = useJson<{ experiments: Summary[] }>('/api/ab', true)
  const experiments = data?.experiments ?? []
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">A/B</h1>
        <p className="text-sm text-muted-foreground">
          One agent, one prompt, two or more models — run with <span className="font-mono">glass ab run</span>, interleaved and repeated.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Experiments</CardTitle>
          <CardDescription>{error ? <span className="text-destructive">{error}</span> : `${experiments.length} experiment${experiments.length === 1 ? '' : 's'}`}</CardDescription>
        </CardHeader>
        <CardContent>
          {experiments.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="ab-empty">
              None yet. For example:{' '}
              <span className="font-mono">glass ab run --agent pi --variant base=local-llama/&lt;model&gt; --variant tuned=&lt;provider&gt;/&lt;adapter&gt; --prompt &quot;…&quot; --check &quot;…&quot; --repeats 3</span>
            </p>
          ) : (
            <Table data-testid="ab-list">
              <TableHeader>
                <TableRow>
                  <TableHead>Started</TableHead>
                  <TableHead>Experiment</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Variants</TableHead>
                  <TableHead className="text-right">Trials</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {experiments.map((e) => (
                  <TableRow
                    key={e.id}
                    data-ab-id={e.id}
                    className={cn('cursor-pointer', id === e.id && 'bg-muted/50 shadow-[inset_3px_0_0_hsl(var(--primary))]')}
                    onClick={() => setParams(id === e.id ? {} : { id: e.id })}
                  >
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{new Date(e.created_at).toLocaleString()}</TableCell>
                    <TableCell className="text-xs"><span className="font-mono">{e.id}</span>{e.label ? <span className="text-muted-foreground"> · {e.label}</span> : null}</TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{e.agent}</Badge></TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">{e.variants.map((v) => `${v.label}=${target(v)}`).join('  vs  ')}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{e.trials}/{e.planned}</TableCell>
                    <TableCell><StatusBadge status={e.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {id && <Experiment key={id} id={id} />}
    </div>
  )
}
