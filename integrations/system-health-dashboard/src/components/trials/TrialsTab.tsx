/**
 * Token Usage → Trials: a cheaper model run beside the one a background process
 * uses, on its real calls, judged blind — the evidence to read before a process
 * is switched (rapid-llm-proxy proxy-bridge/model-trials.mjs, /api/trials).
 *
 * A trial tries one model, or — Automatic, the default — several, cheapest
 * first, and reports the cheapest that does the job as well (the winner).
 *
 * Coding's dashboard can start, stop, reject and accept a trial; accepting
 * writes the chosen candidate into the process's route (llm-routing.yaml: its
 * band, or a model pin). glass shows the same trials read-only — its daemon
 * serves a coding machine's store.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FlaskConical, Check, X, Square, ChevronLeft, ChevronRight } from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  cellCostUsd, fetchCostSettings, formatMoney, fromUsd, CostConfig, CostRow, DEFAULT_COST_CONFIG,
  catalogueFromRouting, trialCandidates, autoTrialCandidates, failedTrialModels, setLocalProviders,
  type ModelCatalogue, type TrialCandidate,
} from '@/components/cost/cost-model'
import { RefreshButton } from '@/components/ui/refresh-button'

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
  /** The first candidate (in the trial's order) that passed. Absent on a proxy before candidate lists. */
  winner?: number | null
  /** The winner, or the candidate doing best so far — what the top-level figures describe. */
  lead?: number
  candidates?: CandidateSummary[]
}
type CandidateState = 'active' | 'passed' | 'failed' | 'out' | 'skipped' | 'short'
interface CandidateSummary extends Omit<Summary, 'status' | 'verdict' | 'winner' | 'lead' | 'candidates'> {
  index: number
  candidate: Side
  state: CandidateState
  pending: number
}
export interface Trial {
  id: string
  process: string
  routeKey: string
  mode?: 'auto' | 'single'
  incumbent: Side
  /** Trials from before candidate lists. */
  candidate?: Side
  candidates?: Side[]
  acceptedCandidate?: number
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
  /** Which of the trial's candidates answered; absent = the only one. */
  candidateIndex?: number
  /** The sampled call: every candidate's answer to the same request shares it. */
  requestId?: string
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

/** A trial's candidates in its order of preference. */
const candidatesOf = (t: Trial): Side[] => (t.candidates?.length ? t.candidates : t.candidate ? [t.candidate] : [])

const STATE_LABEL: Record<CandidateState, string> = {
  active: 'being tried', passed: 'passes', failed: 'fails', out: 'cannot pass', skipped: 'not needed', short: 'too few pairs',
}
const STATE_CLASS: Record<CandidateState, string> = {
  active: 'text-muted-foreground', passed: 'text-emerald-700 dark:text-emerald-400', failed: 'text-red-700 dark:text-red-400',
  out: 'text-red-700 dark:text-red-400', skipped: 'text-muted-foreground', short: 'text-amber-700 dark:text-amber-400',
}

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
  // `choice`: 'auto', or the index of one candidate in the process's list. Days left
  // blank: the proxy's default (3).
  const [form, setForm] = useState({ process: '', choice: 'auto', samplePct: '25', days: '', maxSamples: '40' })
  // What a trial can try for each process: the Cost tab's candidates, from the
  // same rows and the proxy's routing catalogue.
  const [costRows, setCostRows] = useState<CostRow[]>([])
  const [catalogue, setCatalogue] = useState<ModelCatalogue | null>(null)

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
  useEffect(() => {
    if (!canWrite) return
    void Promise.all([
      fetch(`${proxyBase}/api/token-usage/cost?months=1&by=day`).then(r => (r.ok ? r.json() : null)).catch(() => null),
      fetch(`${proxyBase}/api/llm/routing`).then(r => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([cost, routing]) => {
      setLocalProviders(cost?.local_providers)
      setCostRows(cost?.rows || [])
      setCatalogue(catalogueFromRouting(routing))
    })
  }, [canWrite, proxyBase])
  const processCandidates = useMemo(() => {
    const now = new Date()
    return trialCandidates(costRows, cfg, catalogue, now.toISOString().slice(0, 7), now)
  }, [costRows, cfg, catalogue])
  // The proxy runs one trial per process at a time; a process that has one is
  // offered again once it ends, so the next trial goes to a different process.
  const runningProcesses = useMemo(
    () => new Set((trials || []).filter(t => t.status === 'running').map(t => t.process)),
    [trials],
  )
  const formCandidates = processCandidates.find(p => p.process === form.process) || null
  const formAuto = useMemo(
    () => (formCandidates ? autoTrialCandidates(formCandidates, failedTrialModels(trials || [], formCandidates.process)) : []),
    [formCandidates, trials],
  )
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

  const act = async (path: string, body: object, ok: string, onDone?: () => void) => {
    setBusy(true)
    try {
      const r = await fetch(`${proxyBase}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setNotice(ok)
      onDone?.()
      await loadList()
      const id = j.trial?.id || selected
      if (id) { setSelected(id); await loadDetail(id) }
    } catch (e: unknown) {
      setNotice(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  const start = () => {
    const chosen: TrialCandidate[] = form.choice === 'auto' ? formAuto : [formCandidates!.candidates[Number(form.choice)]]
    return act('/api/trials', {
      process: form.process, mode: form.choice === 'auto' && chosen.length > 1 ? 'auto' : 'single',
      candidates: chosen.map(c => ({ provider: c.provider, model: c.model })),
      samplePct: Number(form.samplePct) / 100, maxSamples: Number(form.maxSamples),
      ...(form.days.trim() ? { days: Number(form.days) } : {}),
    }, `Trial started for ${form.process}: ${chosen.map(c => c.model).join(', ')}`,
    // Clear the process so the form reads as ready for the next trial, not as
    // the one just started (the rates stay: they are the user's own defaults).
    () => setForm(f => ({ ...f, process: '', choice: 'auto' })))
  }

  /** The sampled calls' cost on a candidate against the incumbent's on the same calls. */
  const costOf = useCallback((cand: Side, tokens: Summary['tokens']) => {
    if (!detail) return null
    const day = new Date().toISOString().slice(0, 10)
    const inc = sideCost(cfg, detail.trial.incumbent, tokens.incumbent, day)
    const c = sideCost(cfg, cand, tokens.candidate, day)
    return { inc, cand: c, ratio: inc > 0 ? c / inc : null }
  }, [detail, cfg])
  const detailCandidates = detail ? candidatesOf(detail.trial) : []
  const lead = detail ? detailCandidates[detail.summary.lead ?? 0] : null
  const winner = detail && detail.summary.winner != null ? detailCandidates[detail.summary.winner] : null
  const cost = useMemo(() => (detail && lead ? costOf(lead, detail.summary.tokens) : null), [detail, lead, costOf])
  const multi = detailCandidates.length > 1

  const sample = detail?.samples.find(s => s.sampleId === sampleId) || null
  // Pairs by sampled call, newest first: each call's candidates in the trial's order.
  const calls = useMemo(() => {
    const by = new Map<string, Sample[]>()
    for (const s of detail?.samples || []) {
      const k = s.requestId || s.sampleId
      by.set(k, [...(by.get(k) || []), s])
    }
    return [...by.values()].map(g => g.sort((a, b) => (a.candidateIndex ?? 0) - (b.candidateIndex ?? 0))).reverse()
  }, [detail])
  const call = sample ? calls.find(g => g.some(s => s.sampleId === sample.sampleId)) || [sample] : null

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
                <div className="text-xs text-muted-foreground truncate">{t.incumbent.model} → {candidatesOf(t).length > 1 ? `automatic: ${candidatesOf(t).map(c => c.model).join(', ')}` : candidatesOf(t)[0]?.model}</div>
                <div className="text-xs text-muted-foreground">{t.status} · {t.summary?.judged ?? 0} judged of {t.summary?.samples ?? 0} · started {t.createdAt.slice(0, 10)}</div>
              </button>
            ))}
            {canWrite && (
              <div className="border-t pt-3 mt-2 space-y-2">
                <div className="text-sm font-medium">Start a trial</div>
                <label className="text-xs text-muted-foreground space-y-1 block">Process
                  <Select value={form.process} onValueChange={v => setForm(f => ({ ...f, process: v, choice: 'auto' }))}>
                    <SelectTrigger id="trial-process" className="h-8 text-xs font-mono"><SelectValue placeholder="a background process" /></SelectTrigger>
                    <SelectContent>
                      {processCandidates.map(p => (
                        <SelectItem key={p.process} value={p.process} disabled={runningProcesses.has(p.process)} className="font-mono text-xs">
                          {p.process} · {runningProcesses.has(p.process) ? 'trial running' : `${money(p.monthlyEur)}/mo`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                {processCandidates.length === 0 && <div className="text-xs text-muted-foreground">No background process has a cheaper model to try (judged by the last 7 days).</div>}
                {formCandidates && (
                  <label className="text-xs text-muted-foreground space-y-1 block">Candidates
                    <Select value={form.choice} onValueChange={v => setForm(f => ({ ...f, choice: v }))}>
                      <SelectTrigger id="trial-candidates" className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {formAuto.length > 1 && <SelectItem value="auto" className="text-xs">Automatic — the cheapest that does the job ({formAuto.length} models)</SelectItem>}
                        {formCandidates.candidates.map((c, i) => (
                          <SelectItem key={`${c.provider}/${c.model}`} value={String(i)} className="text-xs">
                            {c.model} · {c.provider} · {c.local ? 'own hardware' : `≈ ${money(c.monthlyEur)}/mo${c.estimate ? ' (est.)' : ''}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                )}
                {formCandidates && form.choice === 'auto' && formAuto.length > 1 && (
                  <div className="text-xs text-muted-foreground">
                    Every sampled call goes to {formAuto.map(c => c.model).join(', ')} beside {formCandidates.incumbent.model} ({formAuto.length} extra calls each); a model that cannot pass drops out, and the cheapest that passes wins.
                  </div>
                )}
                <div className="grid grid-cols-3 gap-2">
                  <label className="text-xs text-muted-foreground space-y-1">Share of calls %
                    <Input id="trial-pct" value={form.samplePct} onChange={e => setForm(f => ({ ...f, samplePct: e.target.value }))} className="h-8 text-xs" inputMode="numeric" />
                  </label>
                  <label className="text-xs text-muted-foreground space-y-1">Days, at most
                    <Input id="trial-days" value={form.days} placeholder="3" onChange={e => setForm(f => ({ ...f, days: e.target.value }))} className="h-8 text-xs" inputMode="decimal" />
                  </label>
                  <label className="text-xs text-muted-foreground space-y-1">Pairs per model
                    <Input id="trial-max" value={form.maxSamples} onChange={e => setForm(f => ({ ...f, maxSamples: e.target.value }))} className="h-8 text-xs" inputMode="numeric" />
                  </label>
                </div>
                <Button size="sm" className="w-full" disabled={busy || !formCandidates || runningProcesses.has(form.process) || (form.choice === 'auto' && !formAuto.length)} onClick={() => void start()}>Start trial</Button>
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
                      {' '}→ {multi ? `automatic, cheapest first: ${detailCandidates.map(c => c.model).join(', ')}` : <>{detailCandidates[0]?.provider}/{detailCandidates[0]?.model} <span className="text-muted-foreground">({detailCandidates[0]?.complexity})</span></>}
                      {' '}· {Math.round(detail.trial.samplePct * 100)}% of calls · until {detail.trial.endsAt.slice(0, 16).replace('T', ' ')} UTC or {detail.trial.maxSamples} pairs{multi ? ' per model' : ''}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={VERDICT_CLASS[detail.summary.verdict]}>{VERDICT_LABEL[detail.summary.verdict]}</Badge>
                    <Badge variant="outline">{detail.trial.status}</Badge>
                    <RefreshButton variant="ghost" iconOnly iconClassName="h-3.5 w-3.5" onRefresh={() => Promise.all([loadList(), loadDetail(detail.trial.id)])} />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {multi && detail.summary.candidates && (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Candidate</TableHead>
                          <TableHead>State</TableHead>
                          <TableHead className="text-right">Judged</TableHead>
                          <TableHead className="text-right">At least as good</TableHead>
                          <TableHead className="text-right">Details kept</TableHead>
                          <TableHead className="text-right">Cost</TableHead>
                          {canWrite && <TableHead />}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detail.summary.candidates.map(c => {
                          const cc = costOf(c.candidate, c.tokens)
                          return (
                            <TableRow key={c.index} className={detail.summary.winner === c.index ? 'bg-emerald-50/60 dark:bg-emerald-950/30' : ''}>
                              <TableCell className="text-xs"><span className="font-mono">{c.candidate.model}</span> <span className="text-muted-foreground">· {c.candidate.provider}</span>{detail.summary.winner === c.index && <Badge variant="outline" className={`ml-2 text-[10px] ${VERDICT_CLASS.pass}`}>winner</Badge>}</TableCell>
                              <TableCell className={`text-xs ${STATE_CLASS[c.state]}`}>{c.state === 'active' && detail.trial.status !== 'running' ? `${detail.trial.status}, undecided` : STATE_LABEL[c.state]}</TableCell>
                              <TableCell className="text-right text-xs">{c.judged} / {detail.trial.thresholds.minSamples}{c.pending ? ` (+${c.pending})` : ''}</TableCell>
                              <TableCell className="text-right text-xs">{pct(c.okRate)}</TableCell>
                              <TableCell className="text-right text-xs">{pct(c.meanRetention)}</TableCell>
                              <TableCell className="text-right text-xs" title={cc ? `${money(cc.cand)} vs ${money(cc.inc)} on the sampled calls` : ''}>{cc?.ratio == null ? '—' : pct(cc.ratio)}</TableCell>
                              {canWrite && (
                                <TableCell className="text-right">
                                  {c.state === 'passed' && ['running', 'complete'].includes(detail.trial.status) && (
                                    <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy}
                                      onClick={() => void act(`/api/trials/${detail.trial.id}/accept`, { candidate: c.index }, `Accepted: ${detail.trial.routeKey} now runs on ${c.candidate.model}`)}>Accept</Button>
                                  )}
                                </TableCell>
                              )}
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                    <div className="text-xs text-muted-foreground mt-1">The figures below are {winner ? `the winner's, ${winner.model}` : `those of the model doing best so far, ${lead?.model}`}. Cost: the candidate's share of what the current model cost on the same calls.</div>
                  </div>
                )}
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
                    {winner ? (
                      <Button size="sm" disabled={busy} onClick={() => void act(`/api/trials/${detail.trial.id}/accept`, { candidate: detail.summary.winner }, `Accepted: ${detail.trial.routeKey} now runs on ${winner.model}`)}>
                        <Check className="h-3.5 w-3.5 mr-1" />Accept: switch to {winner.model}
                      </Button>
                    ) : detail.summary.verdict === 'pass' && lead ? (
                      // A proxy before candidate lists: the verdict is the one candidate's.
                      <Button size="sm" disabled={busy} onClick={() => void act(`/api/trials/${detail.trial.id}/accept`, {}, `Accepted: ${detail.trial.routeKey} now runs on ${lead.model}`)}>
                        <Check className="h-3.5 w-3.5 mr-1" />Accept: switch to {lead.model}
                      </Button>
                    ) : confirmForce && lead ? (
                      <>
                        <span className="text-sm">{lead.model} has not passed. Switch anyway?</span>
                        <Button size="sm" variant="destructive" disabled={busy} onClick={() => void act(`/api/trials/${detail.trial.id}/accept`, { candidate: detail.summary.lead ?? 0, force: true }, `Accepted without a pass: ${detail.trial.routeKey} now runs on ${lead.model}`)}>Switch anyway</Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirmForce(false)}>Cancel</Button>
                      </>
                    ) : (
                      <Button size="sm" variant="outline" disabled={busy || !lead} onClick={() => setConfirmForce(true)}>Accept {multi && lead ? `${lead.model} ` : ''}anyway…</Button>
                    )}
                    {detail.trial.status === 'running' && (
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(`/api/trials/${detail.trial.id}/stop`, {}, 'Trial stopped')}><Square className="h-3.5 w-3.5 mr-1" />Stop collecting</Button>
                    )}
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(`/api/trials/${detail.trial.id}/reject`, {}, 'Trial rejected — the process keeps its model')}>Reject</Button>
                    <span className="text-xs text-muted-foreground">Accept writes the model into route {detail.trial.routeKey} — its band, or a model pin when it is no band's model.</span>
                  </div>
                )}

                {/* Pairs: one row per sampled call; with several candidates, one column each. */}
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>When</TableHead>
                        {multi ? detailCandidates.map((c, i) => <TableHead key={i} className="font-mono text-xs">{c.model}</TableHead>) : (
                          <>
                            <TableHead>Judge</TableHead>
                            <TableHead className="text-right">Details kept</TableHead>
                            <TableHead className="text-right">Length</TableHead>
                            <TableHead className="text-right">Units</TableHead>
                          </>
                        )}
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {calls.length === 0 && (
                        <TableRow><TableCell colSpan={multi ? detailCandidates.length + 2 : 6} className="text-sm text-muted-foreground">No pairs yet: they arrive as {detail.trial.process} runs.</TableCell></TableRow>
                      )}
                      {calls.map(g => {
                        const open = g.some(s => s.sampleId === sampleId)
                        const verdictCell = (s: Sample | undefined, key: number) => {
                          if (!s) return <TableCell key={key} className="text-xs text-muted-foreground">—</TableCell>
                          const v = pairVerdict(s.judgements)
                          const ret = s.judgements.filter(j => j.ok && j.oriented?.retention != null).map(j => j.oriented!.retention as number)
                          return (
                            <TableCell key={key} className={`text-xs ${v ? PAIR_CLASS[v] : 'text-muted-foreground'} ${sampleId === s.sampleId ? 'underline underline-offset-4' : ''}`}
                              onClick={e => { e.stopPropagation(); setSampleId(s.sampleId) }}>
                              {v ? PAIR_LABEL[v] : 'waiting'}{ret.length ? ` · ${pct(ret.reduce((a, b) => a + b, 0) / ret.length)}` : ''}
                            </TableCell>
                          )
                        }
                        const s0 = g[0]
                        const v0 = pairVerdict(s0.judgements)
                        const ret0 = s0.judgements.filter(j => j.ok && j.oriented?.retention != null).map(j => j.oriented!.retention as number)
                        return (
                          <TableRow key={s0.requestId || s0.sampleId} className={`cursor-pointer ${open ? 'bg-muted/60' : ''}`} onClick={() => setSampleId(s0.sampleId)}>
                            <TableCell className="text-xs whitespace-nowrap">{s0.at.slice(5, 16).replace('T', ' ')}</TableCell>
                            {multi ? detailCandidates.map((_, i) => verdictCell(g.find(s => (s.candidateIndex ?? 0) === i), i)) : (
                              <>
                                <TableCell className={`text-xs ${v0 ? PAIR_CLASS[v0] : 'text-muted-foreground'}`}>{v0 ? PAIR_LABEL[v0] : 'waiting for the judge'}</TableCell>
                                <TableCell className="text-right text-xs">{ret0.length ? pct(ret0.reduce((a, b) => a + b, 0) / ret0.length) : '—'}</TableCell>
                                <TableCell className="text-right text-xs">{pct(s0.structure.lengthRatio)}</TableCell>
                                <TableCell className="text-right text-xs">{s0.structure.unitsCandidate} / {s0.structure.unitsIncumbent}{s0.structure.formatMatch ? '' : ' · other format'}</TableCell>
                              </>
                            )}
                            <TableCell className="text-right"><ChevronRight className="h-3.5 w-3.5 inline text-muted-foreground" /></TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                  {multi && <div className="text-xs text-muted-foreground mt-1">Each row is one sampled call, answered by every model still being tried (judge's verdict · details kept). Click a cell to open that model's answer.</div>}
                </div>
              </CardContent>
            </Card>
          )}

          {sample && detail && call && <SampleView sample={sample} call={call} onPick={setSampleId} trial={detail.trial} />}
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

/**
 * One pair side by side: units aligned by title where both answers have them, the
 * judge's reading below. Column 2 switches between the candidates that answered
 * the same sampled call (`call`).
 */
function SampleView({ sample, call, onPick, trial }: { sample: Sample; call: Sample[]; onPick: (sampleId: string) => void; trial: Trial }) {
  const st = sample.structure
  const at = call.findIndex(s => s.sampleId === sample.sampleId)
  const step = (d: number) => { const n = call[(at + d + call.length) % call.length]; if (n) onPick(n.sampleId) }
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
                Judge{j.judge ? ` (${j.judge})` : ''}, read {j.order === 'ic' ? `${trial.incumbent.model} first` : `${sample.candidate.model} first`}
              </div>
              {j.ok && j.oriented ? (
                <>
                  <div><span className="font-medium">{j.oriented.winner === 'equal' ? 'Equivalent' : j.oriented.winner === 'candidate' ? `${sample.candidate.model} better` : `${trial.incumbent.model} better`}</span>
                    {j.oriented.retention != null && <span className="text-muted-foreground"> · keeps {pct(j.oriented.retention)} of the details</span>}</div>
                  <div className="text-muted-foreground">{j.oriented.reason}</div>
                  {j.oriented.missingFromCandidate.length > 0 && (
                    <div><span className="text-xs font-medium">Missing from {sample.candidate.model}:</span>
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
          {call.length > 1 ? (
            <div className="flex items-center gap-1 flex-wrap min-w-0" role="group" aria-label="Candidate answering this call">
              <button className="p-0.5 rounded hover:bg-muted" onClick={() => step(-1)} aria-label="Previous candidate"><ChevronLeft className="h-3.5 w-3.5" /></button>
              {call.map(s => {
                const v = pairVerdict(s.judgements)
                return (
                  <button key={s.sampleId} onClick={() => onPick(s.sampleId)}
                    className={`px-1.5 py-0.5 rounded border font-mono ${s.sampleId === sample.sampleId ? 'bg-primary text-primary-foreground border-primary' : `hover:bg-muted ${v ? PAIR_CLASS[v] : ''}`}`}
                    title={v ? PAIR_LABEL[v] : 'waiting for the judge'}>{s.candidate.model}</button>
                )
              })}
              <button className="p-0.5 rounded hover:bg-muted" onClick={() => step(1)} aria-label="Next candidate"><ChevronRight className="h-3.5 w-3.5" /></button>
              <span className="text-muted-foreground font-normal">({at + 1} of {call.length})</span>
            </div>
          ) : (
            <div>{sample.candidate.model} <span className="text-muted-foreground font-normal">(candidate)</span></div>
          )}
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
          <summary className="cursor-pointer text-muted-foreground">The request {call.length > 1 ? `all ${call.length + 1} models` : 'both models'} answered</summary>
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
