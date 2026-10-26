/**
 * Token Usage → Trials: a cheaper model run beside the one a background process
 * uses, on its real calls, judged blind — the evidence to read before a process
 * is switched (rapid-llm-proxy proxy-bridge/model-trials.mjs, /api/trials).
 *
 * Coding's dashboard can start, stop, reject and accept a trial; accepting
 * writes the candidate's band into the process's route (llm-routing.yaml). glass
 * shows the same trials read-only — its daemon serves a coding machine's store.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FlaskConical, RefreshCw, Check, X, Square, ChevronRight } from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cellCostUsd, fetchCostSettings, formatMoney, fromUsd, CostConfig, DEFAULT_COST_CONFIG } from '@/components/cost/cost-model'

interface Side { provider: string; complexity?: string; model: string }
interface Summary {
  status: string
  samples: number
  judged: number
  counts: Record<'candidate-better' | 'equivalent' | 'worse' | 'inconsistent', number>
  okRate: number | null
  meanRetention: number | null
  formatMatchRate: number | null
  meanUnitRecall: number | null
  tokens: { incumbent: { input: number; output: number }; candidate: { input: number; output: number } }
  verdict: 'pending' | 'pass' | 'fail' | 'insufficient'
  reasons: string[]
}
export interface Trial {
  id: string
  process: string
  routeKey: string
  incumbent: Side
  candidate: Side
  samplePct: number
  days: number
  maxSamples: number
  thresholds: { minSamples: number; passRate: number; minRetention: number }
  status: string
  createdAt: string
  endsAt: string
  summary?: Summary
}
interface Oriented {
  winner: 'incumbent' | 'candidate' | 'equal'
  retention: number | null
  missingFromCandidate: string[]
  missingFromIncumbent: string[]
  reason: string
}
interface Judgement { order: 'ic' | 'ci'; ok: boolean; judge?: string; oriented?: Oriented; error?: string }
interface Unit { title: string; body: string }
interface Sample {
  sampleId: string
  at: string
  project?: string
  request: string
  incumbent: { model: string; content: string; tokens: { input: number; output: number }; latencyMs: number }
  candidate: { model: string; content: string; tokens: { input: number; output: number }; latencyMs: number }
  structure: {
    formatIncumbent: string; formatCandidate: string; formatMatch: boolean
    unitsIncumbent: number; unitsCandidate: number; unitRecall: number; lengthRatio: number
    pairs: { incumbent: number | null; candidate: number | null }[]
    unitsA: Unit[]; unitsB: Unit[]
  }
  judgements: Judgement[]
}
interface Detail { trial: Trial; summary: Summary; samples: Sample[] }

const pct = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : `${Math.round(v * 100)}%`)

const VERDICT_CLASS: Record<string, string> = {
  pass: 'text-emerald-700 border-emerald-300 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-950/40 dark:border-emerald-800',
  fail: 'text-red-700 border-red-300 bg-red-50 dark:text-red-400 dark:bg-red-950/40 dark:border-red-800',
  pending: 'text-muted-foreground',
  insufficient: 'text-amber-700 border-amber-300 bg-amber-50 dark:text-amber-400 dark:bg-amber-950/40 dark:border-amber-800',
}
const VERDICT_LABEL: Record<string, string> = { pass: 'passes', fail: 'fails', pending: 'collecting', insufficient: 'too few pairs' }

function pairVerdict(js: Judgement[]): string | null {
  const w = js.filter(j => j.ok && j.oriented).map(j => j.oriented!.winner)
  if (!w.length) return null
  if (w.every(x => x === 'candidate')) return 'candidate-better'
  if (w.every(x => x !== 'incumbent')) return 'equivalent'
  if (w.every(x => x === 'incumbent')) return 'worse'
  return 'inconsistent'
}
const PAIR_LABEL: Record<string, string> = { 'candidate-better': 'better', equivalent: 'equivalent', worse: 'worse', inconsistent: 'judge disagrees with itself' }
const PAIR_CLASS: Record<string, string> = {
  'candidate-better': 'text-emerald-700 dark:text-emerald-400', equivalent: 'text-emerald-700 dark:text-emerald-400',
  worse: 'text-red-700 dark:text-red-400', inconsistent: 'text-amber-700 dark:text-amber-400',
}

/** What the sampled calls cost on each side, priced like the Cost tab prices them. */
function sideCost(cfg: CostConfig, side: Side, tokens: { input: number; output: number }, day: string): number {
  return fromUsd(cellCostUsd({
    provider: side.provider, model: side.model, day, month: day.slice(0, 7),
    input_tokens: tokens.input, output_tokens: tokens.output, cache_read_tokens: 0, cache_write_tokens: 0,
  }, cfg), cfg, day)
}

export function TrialsTab({ proxyBase, canWrite, focusId, currency = 'EUR' }: {
  proxyBase: string
  /** Coding's dashboard: start / stop / reject / accept. glass: read-only. */
  canWrite: boolean
  /** A trial to open, e.g. from a Cost-tab suggestion. */
  focusId?: string | null
  currency?: 'EUR' | 'USD'
}) {
  const [trials, setTrials] = useState<Trial[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(focusId ?? null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [sampleId, setSampleId] = useState<string | null>(null)
  const [cfg, setCfg] = useState<CostConfig>(DEFAULT_COST_CONFIG)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmForce, setConfirmForce] = useState(false)
  const [form, setForm] = useState({ process: '', band: 'small', samplePct: '25', days: '3', maxSamples: '40' })

  const money = useCallback((v: number) => formatMoney(v, currency), [currency])

  const loadList = useCallback(async () => {
    try {
      const r = await fetch(`${proxyBase}/api/trials`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      setTrials(j.trials || [])
      setError(null)
    } catch (e: unknown) {
      setError(`Trials are not available: ${e instanceof Error ? e.message : String(e)}`)
      setTrials([])
    }
  }, [proxyBase])

  const loadDetail = useCallback(async (id: string) => {
    try {
      const r = await fetch(`${proxyBase}/api/trials/${encodeURIComponent(id)}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setDetail(await r.json())
    } catch { setDetail(null) }
  }, [proxyBase])

  useEffect(() => { void loadList(); void fetchCostSettings(proxyBase).then(cs => setCfg({ ...cs.cfg, currency: { ...cs.cfg.currency, display: currency } })) }, [loadList, proxyBase, currency])
  useEffect(() => { if (focusId) setSelected(focusId) }, [focusId])
  useEffect(() => {
    if (!selected && trials?.length) setSelected(trials[0].id)
  }, [trials, selected])
  useEffect(() => { setSampleId(null); setConfirmForce(false); if (selected) void loadDetail(selected) }, [selected, loadDetail])
  // A trial collects for days: keep the open one current without a reload.
  useEffect(() => {
    const t = setInterval(() => { void loadList(); if (selected) void loadDetail(selected) }, 30_000)
    return () => clearInterval(t)
  }, [loadList, loadDetail, selected])

  const act = async (path: string, body: object, ok: string) => {
    setBusy(true)
    try {
      const r = await fetch(`${proxyBase}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setNotice(ok)
      await loadList()
      const id = j.trial?.id || selected
      if (id) { setSelected(id); await loadDetail(id) }
    } catch (e: unknown) {
      setNotice(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  const start = () => act('/api/trials', {
    process: form.process.trim(), candidateComplexity: form.band,
    samplePct: Number(form.samplePct) / 100, days: Number(form.days), maxSamples: Number(form.maxSamples),
  }, `Trial started for ${form.process.trim()}`)

  const cost = useMemo(() => {
    if (!detail) return null
    const day = new Date().toISOString().slice(0, 10)
    const inc = sideCost(cfg, detail.trial.incumbent, detail.summary.tokens.incumbent, day)
    const cand = sideCost(cfg, detail.trial.candidate, detail.summary.tokens.candidate, day)
    return { inc, cand, ratio: inc > 0 ? cand / inc : null }
  }, [detail, cfg])

  const sample = detail?.samples.find(s => s.sampleId === sampleId) || null

  if (trials === null) return <div className="p-6 text-sm text-muted-foreground">Loading trials…</div>

  return (
    <div className="space-y-4 mt-4">
      {error && <div className="text-sm text-muted-foreground">{error}</div>}
      {notice && (
        <div className="text-sm border rounded-md px-3 py-2 flex items-center justify-between gap-3">
          <span>{notice}</span>
          <button className="text-muted-foreground hover:text-foreground" onClick={() => setNotice(null)} aria-label="Dismiss"><X className="h-4 w-4" /></button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* Trial list */}
        <Card className="min-w-0">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><FlaskConical className="h-4 w-4" />Model trials</CardTitle>
            <CardDescription>
              A cheaper model runs beside the current one on a process's real calls; a judge compares each pair.
              {canWrite ? ' Nothing switches until you accept.' : ' Start and accept trials in coding\'s dashboard.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {trials.length === 0 && <div className="text-sm text-muted-foreground">No trials yet.{canWrite ? ' Start one below, or from a savings suggestion on the Cost tab.' : ''}</div>}
            {trials.map(t => (
              <button key={t.id} onClick={() => setSelected(t.id)}
                className={`w-full text-left border rounded-lg p-3 space-y-1 hover:bg-muted/50 ${selected === t.id ? 'ring-2 ring-primary/40' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs truncate">{t.process}</span>
                  {t.summary && <Badge variant="outline" className={`text-[10px] shrink-0 ${VERDICT_CLASS[t.summary.verdict]}`}>{VERDICT_LABEL[t.summary.verdict]}</Badge>}
                </div>
                <div className="text-xs text-muted-foreground truncate">{t.incumbent.model} → {t.candidate.model}</div>
                <div className="text-xs text-muted-foreground">{t.status} · {t.summary?.judged ?? 0} judged of {t.summary?.samples ?? 0} · started {t.createdAt.slice(0, 10)}</div>
              </button>
            ))}
            {canWrite && (
              <div className="border-t pt-3 mt-2 space-y-2">
                <div className="text-sm font-medium">Start a trial</div>
                <Input id="trial-process" placeholder="process, e.g. consolidator-insight" value={form.process} onChange={e => setForm(f => ({ ...f, process: e.target.value }))} className="h-8 text-xs font-mono" />
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs text-muted-foreground space-y-1">Candidate band
                    <Select value={form.band} onValueChange={v => setForm(f => ({ ...f, band: v }))}>
                      <SelectTrigger id="trial-band" className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="small">small</SelectItem>
                        <SelectItem value="medium">medium</SelectItem>
                        <SelectItem value="high">high</SelectItem>
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="text-xs text-muted-foreground space-y-1">Share of calls %
                    <Input id="trial-pct" value={form.samplePct} onChange={e => setForm(f => ({ ...f, samplePct: e.target.value }))} className="h-8 text-xs" inputMode="numeric" />
                  </label>
                  <label className="text-xs text-muted-foreground space-y-1">Days, at most
                    <Input id="trial-days" value={form.days} onChange={e => setForm(f => ({ ...f, days: e.target.value }))} className="h-8 text-xs" inputMode="decimal" />
                  </label>
                  <label className="text-xs text-muted-foreground space-y-1">Pairs, at most
                    <Input id="trial-max" value={form.maxSamples} onChange={e => setForm(f => ({ ...f, maxSamples: e.target.value }))} className="h-8 text-xs" inputMode="numeric" />
                  </label>
                </div>
                <Button size="sm" className="w-full" disabled={busy || !form.process.trim()} onClick={() => void start()}>Start trial</Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Selected trial */}
        <div className="space-y-4 min-w-0">
          {!detail && selected && <div className="p-6 text-sm text-muted-foreground">Loading trial…</div>}
          {detail && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="text-base font-mono break-all">{detail.trial.process}</CardTitle>
                    <CardDescription>
                      {detail.trial.incumbent.provider}/{detail.trial.incumbent.model} <span className="text-muted-foreground">({detail.trial.incumbent.complexity})</span>
                      {' '}→ {detail.trial.candidate.provider}/{detail.trial.candidate.model} <span className="text-muted-foreground">({detail.trial.candidate.complexity})</span>
                      {' '}· {Math.round(detail.trial.samplePct * 100)}% of calls · until {detail.trial.endsAt.slice(0, 16).replace('T', ' ')} UTC or {detail.trial.maxSamples} pairs
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={VERDICT_CLASS[detail.summary.verdict]}>{VERDICT_LABEL[detail.summary.verdict]}</Badge>
                    <Badge variant="outline">{detail.trial.status}</Badge>
                    <Button size="sm" variant="ghost" onClick={() => { void loadList(); void loadDetail(detail.trial.id) }} aria-label="Refresh"><RefreshCw className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
                  <Metric label="Judged pairs" value={`${detail.summary.judged} / ${detail.summary.samples}`} note={`needs ${detail.trial.thresholds.minSamples}`} />
                  <Metric label="At least as good" value={pct(detail.summary.okRate)} note={`needs ${pct(detail.trial.thresholds.passRate)}`} />
                  <Metric label="Details kept" value={pct(detail.summary.meanRetention)} note={`needs ${pct(detail.trial.thresholds.minRetention)}`} />
                  <Metric label="Same format" value={pct(detail.summary.formatMatchRate)} note="output shape" />
                  <Metric label="Units kept" value={pct(detail.summary.meanUnitRecall)} note="blocks / sections" />
                  <Metric label="Candidate cost" value={cost?.ratio == null ? '—' : pct(cost.ratio)} note={cost ? `${money(cost.cand)} vs ${money(cost.inc)} sampled` : ''} />
                </div>
                <div className="text-xs text-muted-foreground">
                  Pairs: {detail.summary.counts.equivalent} equivalent · {detail.summary.counts['candidate-better']} better · {detail.summary.counts.worse} worse · {detail.summary.counts.inconsistent} where the judge disagreed with itself
                </div>
                {detail.summary.reasons.length > 0 && (
                  <ul className="text-sm list-disc pl-5 space-y-0.5">
                    {detail.summary.reasons.map(r => <li key={r}>{r}</li>)}
                  </ul>
                )}
                {canWrite && ['running', 'complete'].includes(detail.trial.status) && (
                  <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                    {detail.summary.verdict === 'pass' ? (
                      <Button size="sm" disabled={busy} onClick={() => void act(`/api/trials/${detail.trial.id}/accept`, {}, `Accepted: ${detail.trial.routeKey} now runs on ${detail.trial.candidate.model}`)}>
                        <Check className="h-3.5 w-3.5 mr-1" />Accept: switch to {detail.trial.candidate.model}
                      </Button>
                    ) : confirmForce ? (
                      <>
                        <span className="text-sm">The trial has not passed. Switch anyway?</span>
                        <Button size="sm" variant="destructive" disabled={busy} onClick={() => void act(`/api/trials/${detail.trial.id}/accept`, { force: true }, `Accepted without a pass: ${detail.trial.routeKey} now runs on ${detail.trial.candidate.model}`)}>Switch anyway</Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirmForce(false)}>Cancel</Button>
                      </>
                    ) : (
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirmForce(true)}>Accept anyway…</Button>
                    )}
                    {detail.trial.status === 'running' && (
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(`/api/trials/${detail.trial.id}/stop`, {}, 'Trial stopped')}><Square className="h-3.5 w-3.5 mr-1" />Stop collecting</Button>
                    )}
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(`/api/trials/${detail.trial.id}/reject`, {}, 'Trial rejected — the process keeps its model')}>Reject</Button>
                    <span className="text-xs text-muted-foreground">Accept writes band "{detail.trial.candidate.complexity}" to route {detail.trial.routeKey}.</span>
                  </div>
                )}

                {/* Pairs */}
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>When</TableHead>
                        <TableHead>Judge</TableHead>
                        <TableHead className="text-right">Details kept</TableHead>
                        <TableHead className="text-right">Length</TableHead>
                        <TableHead className="text-right">Units</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.samples.length === 0 && (
                        <TableRow><TableCell colSpan={6} className="text-sm text-muted-foreground">No pairs yet: they arrive as {detail.trial.process} runs.</TableCell></TableRow>
                      )}
                      {[...detail.samples].reverse().map(s => {
                        const v = pairVerdict(s.judgements)
                        const ret = s.judgements.filter(j => j.ok && j.oriented?.retention != null).map(j => j.oriented!.retention as number)
                        return (
                          <TableRow key={s.sampleId} className={`cursor-pointer ${sampleId === s.sampleId ? 'bg-muted/60' : ''}`} onClick={() => setSampleId(s.sampleId)}>
                            <TableCell className="text-xs whitespace-nowrap">{s.at.slice(5, 16).replace('T', ' ')}</TableCell>
                            <TableCell className={`text-xs ${v ? PAIR_CLASS[v] : 'text-muted-foreground'}`}>{v ? PAIR_LABEL[v] : 'waiting for the judge'}</TableCell>
                            <TableCell className="text-right text-xs">{ret.length ? pct(ret.reduce((a, b) => a + b, 0) / ret.length) : '—'}</TableCell>
                            <TableCell className="text-right text-xs">{pct(s.structure.lengthRatio)}</TableCell>
                            <TableCell className="text-right text-xs">{s.structure.unitsCandidate} / {s.structure.unitsIncumbent}{s.structure.formatMatch ? '' : ' · other format'}</TableCell>
                            <TableCell className="text-right"><ChevronRight className="h-3.5 w-3.5 inline text-muted-foreground" /></TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {sample && detail && <SampleView sample={sample} trial={detail.trial} />}
        </div>
      </div>
    </div>
  )
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="border rounded-md p-2.5 min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      {note && <div className="text-[11px] text-muted-foreground truncate" title={note}>{note}</div>}
    </div>
  )
}

/** One pair side by side: units aligned by title where both answers have them, the judge's reading below. */
function SampleView({ sample, trial }: { sample: Sample; trial: Trial }) {
  const st = sample.structure
  const aligned = st.formatIncumbent !== 'text' && st.pairs?.length > 0
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Pair from {sample.at.slice(0, 16).replace('T', ' ')} UTC{sample.project ? ` · ${sample.project}` : ''}</CardTitle>
        <CardDescription>
          {sample.incumbent.model}: {sample.incumbent.tokens.output.toLocaleString()} output tokens, {(sample.incumbent.latencyMs / 1000).toFixed(1)}s ·
          {' '}{sample.candidate.model}: {sample.candidate.tokens.output.toLocaleString()} output tokens, {(sample.candidate.latencyMs / 1000).toFixed(1)}s
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          {sample.judgements.map((j, i) => (
            <div key={i} className="border rounded-md p-3 text-sm space-y-1 min-w-0">
              <div className="text-xs text-muted-foreground">
                Judge{j.judge ? ` (${j.judge})` : ''}, read {j.order === 'ic' ? `${trial.incumbent.model} first` : `${trial.candidate.model} first`}
              </div>
              {j.ok && j.oriented ? (
                <>
                  <div><span className="font-medium">{j.oriented.winner === 'equal' ? 'Equivalent' : j.oriented.winner === 'candidate' ? `${trial.candidate.model} better` : `${trial.incumbent.model} better`}</span>
                    {j.oriented.retention != null && <span className="text-muted-foreground"> · keeps {pct(j.oriented.retention)} of the details</span>}</div>
                  <div className="text-muted-foreground">{j.oriented.reason}</div>
                  {j.oriented.missingFromCandidate.length > 0 && (
                    <div><span className="text-xs font-medium">Missing from {trial.candidate.model}:</span>
                      <ul className="list-disc pl-5 text-xs">{j.oriented.missingFromCandidate.map(m => <li key={m}>{m}</li>)}</ul></div>
                  )}
                  {j.oriented.missingFromIncumbent.length > 0 && (
                    <div><span className="text-xs font-medium">Missing from {trial.incumbent.model}:</span>
                      <ul className="list-disc pl-5 text-xs">{j.oriented.missingFromIncumbent.map(m => <li key={m}>{m}</li>)}</ul></div>
                  )}
                </>
              ) : <div className="text-muted-foreground">No judgement: {j.error || 'unknown error'}</div>}
            </div>
          ))}
          {sample.judgements.length === 0 && <div className="text-sm text-muted-foreground">The judge has not read this pair yet.</div>}
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs font-medium">
          <div>{trial.incumbent.model} <span className="text-muted-foreground font-normal">(current)</span></div>
          <div>{trial.candidate.model} <span className="text-muted-foreground font-normal">(candidate)</span></div>
        </div>
        {aligned ? (
          <div className="space-y-2">
            {st.pairs.map((p, i) => {
              const a = p.incumbent != null ? st.unitsA[p.incumbent] : null
              const b = p.candidate != null ? st.unitsB[p.candidate] : null
              return (
                <div key={i} className="grid grid-cols-2 gap-3">
                  <UnitCell unit={a} missing="—" />
                  <UnitCell unit={b} missing="not in this answer" />
                </div>
              )
            })}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <pre className="text-xs whitespace-pre-wrap break-words border rounded-md p-3 max-h-[480px] overflow-auto">{sample.incumbent.content}</pre>
            <pre className="text-xs whitespace-pre-wrap break-words border rounded-md p-3 max-h-[480px] overflow-auto">{sample.candidate.content}</pre>
          </div>
        )}
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">The request both models answered</summary>
          <pre className="mt-2 whitespace-pre-wrap break-words border rounded-md p-3 max-h-[420px] overflow-auto">{sample.request}</pre>
        </details>
      </CardContent>
    </Card>
  )
}

function UnitCell({ unit, missing }: { unit: Unit | null; missing: string }) {
  if (!unit) return <div className="border border-dashed rounded-md p-3 text-xs text-muted-foreground">{missing}</div>
  return (
    <div className="border rounded-md p-3 min-w-0">
      {unit.title && <div className="text-xs font-semibold mb-1 break-words">{unit.title}</div>}
      <div className="text-xs whitespace-pre-wrap break-words max-h-[320px] overflow-auto">{unit.body}</div>
    </div>
  )
}
