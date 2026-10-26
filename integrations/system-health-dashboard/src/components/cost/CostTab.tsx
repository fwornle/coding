import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePolledFetch } from '@/hooks/usePolledFetch'
import { Settings, TrendingUp, Lightbulb, ArrowRight, Gauge, AlertTriangle, RefreshCw } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { getProviderColor } from '@/lib/providers'
import { CostSettingsDialog } from './CostSettingsDialog'
import { SeriesTooltip } from './series-tooltip'
import {
  CostRow, CostConfig, Currency, DEFAULT_COST_CONFIG, PivotDim, AccountKind,
  accountKind, accountName, costAccount, configKey, isSynthetic, cellCostUsd, fromUsd, fromEur, rowAt, copilotDiscountAt, usdPerEurAt,
  formatMoney, fetchCostSettings, setLocalProviders, withCurrency,
  monthlySeries, pivotForMonth, copilotBilling, projectBurn, budgetStatus,
  buildSuggestions, budgetForMonth, splitByScope, ScopeSplit, localSavings, LocalSavings,
  copilotSeatCredit, recentDailyRate, type RouteAction,
} from './cost-model'

/** The part of a model trial this tab shows (TrialsTab has the whole shape). */
interface TrialRef {
  id: string
  process: string
  status: string
  summary?: { verdict: 'pending' | 'pass' | 'fail' | 'insufficient'; judged: number }
}
const TRIAL_VERDICT: Record<string, string> = { pass: 'passed', fail: 'failed', pending: 'collecting', insufficient: 'too few pairs' }

interface Props {
  proxyBase: string
  /** €/$ — chosen once for the whole Token Usage page. */
  currency: Currency
  /** Sets the page's unit. The page-wide switch sits above the tabs, out of
   *  view once this tab is scrolled, so the tab offers €/$ in its own toolbar. */
  onCurrency?: (c: Currency) => void
  /** What these figures cover, when that is less than the whole account — glass
   *  sees only the calls of the sessions it launched, while GitHub's Copilot
   *  budget counts every use of the login (IDE plugin, other tools, other
   *  machines). Without saying so, a small figure against a budget GitHub says
   *  is a third used reads as a bug. */
  coverage?: { short: string; long: string }
  /** Changes when the account selection is saved: reload with the new filter. */
  accountsRev?: number
  /** Opens the Trials tab, on a trial when given. Absent where there is no Trials tab. */
  onTrials?: (trialId?: string) => void
  /** How many accounts the selection leaves out, for the toolbar button. */
  hiddenAccounts?: number
  /** Opens the page's Accounts dialog (absent on a proxy without a selection). */
  onAccounts?: () => void
}

interface CadenceCfg { enabled: boolean; checkIntervalMinutes: number; undigestedThreshold: number }

/** glass's read of GitHub's month-to-date count for the Copilot account (lib/glass/copilot-quota.mjs). */
interface CopilotQuotaView {
  enabled: boolean
  host: string
  fetchedAt: string | null
  error: string
  quota: null | {
    plan: string; creditsUsed: number; entitlement: number; usedUsd: number
    percentUsed: number | null; resetDate: string; asOf: string
  }
}

const MODEL_PALETTE = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#84cc16', '#a855f7', '#14b8a6']
const STATUS_CLASS: Record<string, string> = {
  ok: 'text-emerald-600 border-emerald-200',
  warn: 'text-amber-600 border-amber-300',
  over: 'text-red-600 border-red-300',
}
const STATUS_BAR: Record<string, string> = { ok: 'bg-emerald-500', warn: 'bg-amber-500', over: 'bg-red-500' }
const fmtTok = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : `${n}`

/** Tile order: what the reader pays for first, then what is notional or free. */
const KIND_ORDER: Record<AccountKind, number> = { copilot: 0, metered: 1, flat: 2, local: 3 }

interface AccountTile {
  account: string
  kind: AccountKind
  label: string
  spend: number
  projected: number
  budget: number | null
  status: string
  /** Whether month-end runs at the last 7 days' rate or the month's average. */
  projectionBasis: 'recent' | 'month'
  /** Copilot: a promotion's extra included credits taken off this month (display currency). */
  seatCredit: number
  /** What a human waited on vs what ran on its own — the discretionary half. */
  split: ScopeSplit
  /** Own hardware only: the same work priced on GitHub Copilot. */
  savings?: LocalSavings
}

export function CostTab({ proxyBase, currency, onCurrency, coverage, accountsRev = 0, hiddenAccounts = 0, onAccounts, onTrials }: Props) {
  const [rows, setRows] = useState<CostRow[]>([])
  const [savedCfg, setSavedCfg] = useState<CostConfig>(DEFAULT_COST_CONFIG)
  // glass's daemon has no /api/llm/settings: prices stay the calibrated
  // defaults there, and the controls that write coding's routing / cadence
  // settings are not offered at all rather than failing on click.
  const [settingsApi, setSettingsApi] = useState(false)
  // Model trials, newest first (rapid-llm-proxy /api/trials): what a suggestion
  // to move a process to a cheaper model has to pass before anything switches.
  const [trials, setTrials] = useState<TrialRef[]>([])
  const [cadence, setCadence] = useState<CadenceCfg>({ enabled: true, checkIntervalMinutes: 30, undigestedThreshold: 10 })
  const [months, setMonths] = useState(6)
  const [pivotDim, setPivotDim] = useState<PivotDim>('process')
  const [chartDim, setChartDim] = useState<'provider' | 'model'>('provider')
  // Linear hides a cent-sized model next to a €100 one. Log cannot stack — a
  // stack encodes value as band height, which log does not preserve — so log
  // draws the bars side by side.
  const [chartLog, setChartLog] = useState(false)
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  // Only glass's daemon serves it; elsewhere the request 404s and the tile shows
  // what it always did.
  const [quota, setQuota] = useState<CopilotQuotaView | null>(null)

  // Every figure on this tab is in the page's currency; budgets are stored in
  // EUR and converted with the same FX.
  const cfg = useMemo(() => withCurrency(savedCfg, currency), [savedCfg, currency])
  const money = useCallback((v: number) => formatMoney(v, currency), [currency])

  const load = useCallback(async (isAuto = false) => {
    // No spinner on an automatic refresh: the data is already on screen and
    // replacing it with a loading state every 30s is worse than a brief stale
    // frame. Same isAuto convention token-usage.tsx's fetchData uses.
    if (!isAuto) setLoading(true)
    setError(null)
    try {
      const [costRes, cs, quotaView, trialList] = await Promise.all([
        // by=day: a billing rule can change mid-month; a proxy that predates it
        // ignores the parameter and its monthly rows price on the month's first day.
        fetch(`${proxyBase}/api/token-usage/cost?months=${months}&by=day`),
        fetchCostSettings(proxyBase),
        fetch(`${proxyBase}/api/glass/copilot-quota${isAuto ? '' : '?refresh=1'}`)
          .then(r => (r.ok ? r.json() as Promise<CopilotQuotaView> : null))
          .catch(() => null),
        fetch(`${proxyBase}/api/trials`)
          .then(r => (r.ok ? r.json() as Promise<{ trials: TrialRef[] }> : null))
          .catch(() => null),
      ])
      setQuota(quotaView)
      setTrials(trialList?.trials || [])
      if (!costRes.ok) throw new Error(`cost HTTP ${costRes.status}`)
      const costJson = await costRes.json()
      setLocalProviders(costJson.local_providers)
      setRows(costJson.rows || [])
      setSettingsApi(cs.settingsApi)
      setSavedCfg(cs.cfg)
      if (cs.settings?.consolidationCadence) setCadence(cs.settings.consolidationCadence as CadenceCfg)
    } catch (e: any) {
      setError(`Failed to load cost data: ${e.message}. Check that the LLM proxy is running at ${proxyBase || window.location.origin}.`)
    } finally { setLoading(false) }
  }, [proxyBase, months])

  // accountsRev: the account selection was saved — reload under the new filter.
  useEffect(() => { void load(false) }, [load, accountsRev])

  // Cost is a running total, so a tab left open under-reports indefinitely.
  // Paused while the settings dialog is open: that dialog edits the very
  // `cost` / `processOverrides` settings this fetch adopts from the server, and
  // refreshing underneath it would revert an operator's half-finished edit.
  usePolledFetch(load, { intervalMs: 30_000, enabled: !settingsOpen })

  // Months present, newest first; default the pivot/tiles to the newest.
  const monthsPresent = useMemo(() => {
    const set = new Set(rows.filter(r => !isSynthetic(r)).map(r => r.month))
    return [...set].sort().reverse()
  }, [rows])
  const activeMonth = selectedMonth || monthsPresent[0] || null

  // Chart data: cost per month stacked by account or model.
  const { chartData, chartKeys, keyColor } = useMemo(() => {
    const series = monthlySeries(rows, cfg, chartDim)
    const keys = new Set<string>()
    const data = series.map(m => {
      const row: Record<string, any> = { month: m.month }
      for (const [k, v] of Object.entries(m.byKey)) { row[k] = Number(v.toFixed(2)); keys.add(k) }
      return row
    })
    // Rank keys by total so the biggest consumers stack at the bottom / show first.
    const totals = new Map<string, number>()
    for (const d of data) for (const k of keys) totals.set(k, (totals.get(k) || 0) + (d[k] || 0))
    const ordered = [...keys].sort((a, b) => (totals.get(b) || 0) - (totals.get(a) || 0)).slice(0, 12)
    // Account series wear the account's colour everywhere on the page.
    const colors = new Map<string, string>()
    if (chartDim === 'provider') {
      for (const r of rows) colors.set(accountName(costAccount(r.provider)), getProviderColor(costAccount(r.provider)))
    }
    return { chartData: data, chartKeys: ordered, keyColor: colors }
  }, [rows, cfg, chartDim])
  // log(0) is undefined: a zero (or sub-cent) month draws no bar rather than a
  // floor value that would read as "a little spend".
  const chartDataLog = useMemo(() => chartData.map(row => {
    const out: Record<string, number | string | null> = {}
    for (const [k, v] of Object.entries(row)) out[k] = typeof v === 'number' && v < 0.01 ? null : v
    return out
  }), [chartData])

  const pivot = useMemo(() => pivotForMonth(rows, cfg, pivotDim, activeMonth), [rows, cfg, pivotDim, activeMonth])
  const now = useMemo(() => new Date(), [])
  const suggestions = useMemo(
    () => (activeMonth ? buildSuggestions(rows, cfg, activeMonth, now) : []),
    [rows, cfg, activeMonth, now],
  )

  // One tile per account used in the selected month — at work that is usually
  // GitHub Copilot alone, sometimes with own hardware next to it; a machine with
  // Claude Max shows that too. An account idle that month has nothing to say
  // and gets no tile (the monthly chart still shows its history).
  const isCurrentCalendarMonth = activeMonth === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const tiles = useMemo(() => {
    const accounts = new Set<string>()
    for (const r of rows) if (!isSynthetic(r) && r.month === activeMonth) accounts.add(costAccount(r.provider))
    const out: AccountTile[] = []
    for (const account of accounts) {
      const kind = accountKind(account)
      const monthRows = rows.filter(r => !isSynthetic(r) && r.month === activeMonth && costAccount(r.provider) === account)
      const gross = monthRows.reduce((s, r) => s + fromUsd(cellCostUsd(r, cfg), cfg, rowAt(r)), 0)
      const seatCredit = kind === 'copilot' && activeMonth ? Math.min(gross, copilotSeatCredit(cfg, activeMonth)) : 0
      const spend = gross - seatCredit
      const key = configKey(account)
      const budgetCfg = cfg.budgets[key]
      // The cap IN FORCE THAT MONTH, not today's: judging an earlier month
      // against a cap raised since would report it as comfortably inside a
      // budget that did not exist yet.
      const budgetEur = budgetForMonth(budgetCfg, activeMonth || '')
      const budget = budgetEur == null ? null : fromEur(budgetEur, cfg)
      // Only project forward for the live calendar month; past months are final.
      const burn = projectBurn(spend, now, recentDailyRate(rows, cfg, now, r => costAccount(r.provider) === account))
      const projected = isCurrentCalendarMonth ? burn.projectedEur : spend
      const cop = kind === 'copilot' && activeMonth ? copilotBilling(rows, cfg, activeMonth) : undefined
      const compareVal = kind === 'copilot' && budgetCfg?.budgetBasis === 'overage' && cop
        ? (isCurrentCalendarMonth ? projectBurn(cop.overageEur, now).projectedEur : cop.overageEur)
        : projected
      out.push({
        account, kind, label: accountName(account), spend, projected, budget,
        status: budgetCfg?.enforce ? budgetStatus(compareVal, budget) : 'ok',
        projectionBasis: burn.basis,
        seatCredit,
        split: splitByScope(monthRows, cfg),
        // Priced at the `small`-band Copilot model — the only band the
        // semantic offload moves, and the call it actually displaces.
        savings: kind === 'local' ? localSavings(monthRows, cfg, 'claude-haiku-5.5') : undefined,
      })
    }
    return out.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.spend - a.spend)
  }, [rows, cfg, activeMonth, isCurrentCalendarMonth, now])

  const overBudget = tiles.filter(t => t.status === 'over' || t.status === 'warn')

  // ---- Actions -----------------------------------------------------------
  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 4000) }

  // A process moves to a cheaper model only through a trial: the candidate runs
  // beside it on real calls and a judge compares the answers; accepting the
  // trial is what writes the route. (The old button wrote `processOverrides`,
  // which the proxy stopped routing on when routing moved to llm-routing.yaml —
  // it reported "routed" and changed nothing.)
  const trialFor = (process: string) => trials.find(t => t.process === process) || null
  const startTrial = async (process: string, complexity: string) => {
    try {
      const res = await fetch(`${proxyBase}/api/trials`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ process, candidateComplexity: complexity }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`)
      flash(`Trial started: ${j.trial.candidate.model} runs beside ${j.trial.incumbent.model} on ${process}`)
      await load(true)
      onTrials?.(j.trial.id)
    } catch (e: unknown) { flash(`Trial not started: ${e instanceof Error ? e.message : String(e)}`) }
  }

  const saveCadence = async (patch: Partial<CadenceCfg>) => {
    const next = { ...cadence, ...patch }
    setCadence(next)
    try {
      const res = await fetch(`${proxyBase}/api/llm/settings`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consolidationCadence: next }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      flash('Consolidation cadence saved')
    } catch (e: any) { flash(`Cadence save failed: ${e.message}`) }
  }

  if (loading) return <div className="py-16 text-center text-muted-foreground">Loading cost data…</div>
  if (error) return <Alert variant="destructive" className="mt-4"><AlertDescription>{error}</AlertDescription></Alert>

  // What the header states: the account-wide rule in force on the month shown
  // (today's for the current one). Dated model and family rules price their rows
  // all the same; the header says that they exist.
  const ruleDay = activeMonth && !isCurrentCalendarMonth ? activeMonth : undefined
  const copilotDiscount = copilotDiscountAt(cfg, ruleDay)
  const fxShown = usdPerEurAt(cfg, ruleDay)
  const datedRules = (cfg.periods || []).length
  const tileGrid = tiles.length >= 3 ? 'md:grid-cols-2 xl:grid-cols-3' : 'md:grid-cols-2'

  return (
    <div className="mt-4 space-y-4">
      {/* Header controls */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Select value={String(months)} onValueChange={v => setMonths(parseInt(v, 10))}>
            <SelectTrigger className="w-32 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[3, 6, 12, 24].map(m => <SelectItem key={m} value={String(m)}>Last {m} months</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={activeMonth || ''} onValueChange={v => setSelectedMonth(v)}>
            <SelectTrigger className="w-36 h-9"><SelectValue placeholder="Month" /></SelectTrigger>
            <SelectContent>
              {monthsPresent.map(m => <SelectItem key={m} value={m}>{m}{m === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}` ? ' (current)' : ''}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          {onAccounts && (
            <Button
              variant="outline"
              size="sm"
              onClick={onAccounts}
              className={hiddenAccounts ? 'border-amber-400 text-amber-700' : ''}
              title="Which accounts count"
            >Accounts{hiddenAccounts ? ` · ${hiddenAccounts} hidden` : ''}</Button>
          )}
          {onCurrency && (
            <div className="flex items-center rounded border h-9 p-0.5 text-xs" role="radiogroup" aria-label="Currency">
              {(['EUR', 'USD'] as Currency[]).map(c => (
                <button
                  key={c}
                  role="radio"
                  aria-checked={currency === c}
                  onClick={() => onCurrency(c)}
                  title={c === 'EUR' ? 'Cost in EUR — token $ × contract discount ÷ FX' : 'Cost in USD — token $ × contract discount (no FX)'}
                  className={`px-2.5 h-full rounded-sm ${currency === c ? 'bg-muted font-medium' : 'text-muted-foreground hover:text-foreground'}`}
                >{c === 'EUR' ? '€' : '$'}</button>
              ))}
            </div>
          )}
          {toast && <span className="text-xs text-muted-foreground">{toast}</span>}
          {/* Wrapped, not passed directly: onClick hands the handler a
              MouseEvent, which as `isAuto` is truthy and would suppress the
              spinner on the one path that should always show it. */}
          <Button variant="outline" size="sm" onClick={() => void load(false)}><RefreshCw className="h-4 w-4 mr-1" />Refresh</Button>
          {settingsApi && (
            <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}><Settings className="h-4 w-4 mr-1" />Prices & Budgets</Button>
          )}
        </div>
      </div>

      {/* How a figure becomes money — one line, because the euro amount is only
          as trustworthy as the reader's knowledge of what went into it. */}
      <div className="text-xs text-muted-foreground">
        GitHub Copilot: GitHub's per-model rates (cache reads and writes priced separately)
        {copilotDiscount !== 1 && <> × {cfg.discountLabel?.copilot || 'contract discount'} {Math.round((1 - copilotDiscount) * 100)}%</>}
        {currency === 'EUR' && <> ÷ FX {fxShown} USD/EUR</>}
        {datedRules > 0 && <span title="Each row is priced with the discount, Copilot rate and FX in force on its day (the cost file's periods)"> · {datedRules} dated rule{datedRules === 1 ? '' : 's'}</span>}. Claude Max: API list price
        (notional). Own hardware: free per token.
        {coverage && <div className="mt-1">{coverage.long}</div>}
      </div>

      {/* Burn-rate warning banner */}
      {overBudget.map(t => (
        <Alert key={t.account} variant={t.status === 'over' ? 'destructive' : 'default'}
          className={t.status === 'warn' ? 'border-amber-300' : ''}>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <strong>{t.label}:</strong> {isCurrentCalendarMonth ? 'projected' : 'total'} {money(t.projected)} for {activeMonth}
            {t.budget != null && <> vs {money(t.budget)} budget — {t.status === 'over' ? 'over budget' : 'on track to exceed 80%'}.</>}
            {t.status === 'over' && settingsApi && ' Consider the optimization suggestions below.'}
          </AlertDescription>
        </Alert>
      ))}

      {/* Account tiles */}
      {tiles.length === 0 ? (
        <div className="text-sm text-muted-foreground">No LLM calls recorded in {activeMonth ?? `the last ${months} months`}.</div>
      ) : (
        <div className={`grid grid-cols-1 ${tileGrid} gap-4`}>
          {tiles.map(t => {
            const pct = t.budget ? Math.min(100, (t.projected / t.budget) * 100) : 0
            return (
              <Card key={t.account} className={`border ${STATUS_CLASS[t.status]}`}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: getProviderColor(t.account) }} />
                      {t.label}
                    </span>
                    {t.kind === 'flat' && <Badge variant="outline" className="text-xs font-normal">notional · flat sub</Badge>}
                    {t.kind === 'local' && <Badge variant="outline" className="text-xs font-normal">own hardware</Badge>}
                    {(t.kind === 'copilot' || t.kind === 'metered') && (
                      <Badge variant="outline" className={`text-xs font-normal ${STATUS_CLASS[t.status]}`}>
                        {t.budget == null ? 'metered' : t.status === 'over' ? 'over budget' : t.status === 'warn' ? 'approaching' : 'on track'}
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold">{money(t.spend)}</span>
                    <span className="text-sm text-muted-foreground">{t.kind === 'copilot' ? 'at list price' : 'spent'} {activeMonth}</span>
                    {coverage && <span className="text-xs text-muted-foreground" title={coverage.long}>· {coverage.short}</span>}
                  </div>
                  {/* Where included credits are pooled and equal the licence fees, a
                      pool that runs out every month makes the bill the list price of
                      everyone's use — so each person's list-price use is their share.
                      The billing report's per-person "net" only says who used credits
                      after the pool ran out. See the docs, "List price and your share". */}
                  {t.kind === 'copilot' && (
                    <div className="text-xs text-muted-foreground" data-testid="copilot-list-price-note">
                      GitHub's rates × your discount ÷ FX — your share of the bill while the included credits run out each month
                    </div>
                  )}
                  {t.seatCredit > 0 && (
                    <div className="text-xs text-muted-foreground" data-testid="copilot-seat-credit">
                      less a promotion's extra included credits: −{money(t.seatCredit)}
                    </div>
                  )}
                  {t.kind === 'copilot' && isCurrentCalendarMonth && quota?.enabled && (
                    <CopilotReported quota={quota} measured={t.spend + t.seatCredit} toDisplay={usd => fromUsd(usd * copilotDiscountAt(cfg), cfg)} money={money} />
                  )}
                  {isCurrentCalendarMonth && t.kind !== 'local' && (
                    <div className="text-sm text-muted-foreground">
                      projected month-end: <span className="font-medium text-foreground">{money(t.projected)}</span>
                      {t.projectionBasis === 'recent' && <span className="text-xs"> at the last 7 days' rate</span>}
                      {t.budget != null && <> / {money(t.budget)} budget</>}
                    </div>
                  )}
                  {t.budget != null && (
                    <div className="h-2 w-full bg-muted rounded overflow-hidden">
                      <div className={`h-full ${STATUS_BAR[t.status]}`} style={{ width: `${pct}%` }} />
                    </div>
                  )}
                  {/* Own hardware: what the same work would have cost on Copilot.
                      Shown even at zero — "the local model served nothing this
                      month" is a real answer. */}
                  {t.savings && (
                    <div className="space-y-1 pt-1">
                      <div className="text-sm">
                        <Gauge className="h-3.5 w-3.5 inline mr-1 -mt-0.5" />
                        saved <span className="font-semibold text-emerald-600 dark:text-emerald-500">{money(t.savings.eur)}</span>
                        <span className="text-muted-foreground"> vs GitHub Copilot · {t.savings.calls.toLocaleString()} call{t.savings.calls === 1 ? '' : 's'} · {fmtTok(t.savings.tokens)} tokens</span>
                      </div>
                      {t.savings.byProcess.slice(0, 4).map(p => (
                        <div key={p.process} className="flex justify-between text-xs">
                          <span className="font-mono text-muted-foreground truncate mr-2">{p.process}</span>
                          <span className="tabular-nums">{money(p.eur)} <span className="text-muted-foreground">· {p.calls} calls</span></span>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Foreground vs background. The only actionable split on this
                      tile: background spend is discretionary — re-route it,
                      re-band it, cache it, switch it off — while foreground spend
                      is the cost of the work itself. */}
                  {t.kind !== 'local' && (t.split.fgEur > 0 || t.split.bgEur > 0 || t.split.unattributedEur > 0) && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs pt-1">
                      <span title="Turns a human was waiting on.">
                        <span className="inline-block w-2 h-2 rounded-full bg-sky-500 mr-1" />
                        foreground <span className="font-medium text-foreground">{money(t.split.fgEur)}</span>
                      </span>
                      <span title="Work that ran on its own: consolidation, observation writing, titles, judges. This is the half you can act on without anyone noticing.">
                        <span className="inline-block w-2 h-2 rounded-full bg-violet-500 mr-1" />
                        background <span className="font-medium text-foreground">{money(t.split.bgEur)}</span>
                        {t.split.totalEur > 0 && <span className="text-muted-foreground"> ({Math.round(100 * t.split.bgEur / t.split.totalEur)}%)</span>}
                      </span>
                      {t.split.unattributedEur > 0 && (
                        <span
                          className="text-muted-foreground"
                          title="Rows written before the proxy recorded which side of the split they were on. Shown rather than folded into one side, because guessing would make the split look complete when it is not."
                        >
                          unattributed {money(t.split.unattributedEur)}
                        </span>
                      )}
                    </div>
                  )}
                  {t.kind === 'flat' && (
                    <div className="text-xs text-muted-foreground pt-1">API-equivalent cost — a flat subscription, not metered.</div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Monthly cost chart */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4" />Cost by month</CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => setChartLog(v => !v)}
                title={chartLog ? 'Back to a linear axis (stacked)' : 'Log axis — reads cent-sized series next to large ones; bars side by side'}
              >{chartLog ? 'Log' : 'Linear'}</Button>
              <Select value={chartDim} onValueChange={v => setChartDim(v as 'provider' | 'model')}>
                <SelectTrigger className="w-40 h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="provider">By account</SelectItem>
                  <SelectItem value="model">By model</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <CardDescription>{chartLog ? 'Side by side, log axis' : 'Stacked'} {currency === 'USD' ? '$' : '€'}-cost per calendar month. Estimated-token rows included.</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={chartLog ? chartDataLog : chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" opacity={0.4} />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis
                tick={{ fontSize: 12 }}
                scale={chartLog ? 'log' : 'auto'}
                domain={chartLog ? ['auto', 'auto'] : [0, 'auto']}
                allowDataOverflow={chartLog}
                tickFormatter={(v) => `${currency === 'USD' ? '$' : '€'}${v}`}
              />
              <Tooltip content={<SeriesTooltip format={money} />} wrapperStyle={{ zIndex: 10 }} cursor={{ fill: 'rgba(148,163,184,0.15)' }} />
              {/* Padded like Evolution's: unpadded, a legend that wraps to two lines sat on
                  the month labels ("2026-" with the month hidden under it). */}
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} />
              {chartKeys.map((k, i) => (
                <Bar key={k} dataKey={k} stackId={chartLog ? undefined : 'cost'}
                  fill={keyColor.get(k) || MODEL_PALETTE[i % MODEL_PALETTE.length]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Optimization suggestions — shown everywhere; their actions write coding's
          routing, so where there is no settings API (glass) each says where to make
          the change instead of offering a button. */}
      {suggestions.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Lightbulb className="h-4 w-4" />Optimization suggestions — {activeMonth}</CardTitle>
            <CardDescription>
              Ranked by estimated monthly saving, judged by the last 7 days.
              {settingsApi
                ? ' A trial runs the cheaper model beside the current one on real calls before anything switches.'
                : ' Each says where to make the change.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {suggestions.map(s => (
              <div key={s.id} className="flex items-center justify-between gap-3 border rounded-lg p-3">
                <div className="min-w-0">
                  <div className="font-medium text-sm">{s.title} <span className="text-emerald-600">· save ~{money(s.estSavingsEur)}/mo</span></div>
                  <div className="text-xs text-muted-foreground">{s.detail}</div>
                  {!settingsApi && s.howTo && <div className="text-xs mt-0.5">{s.howTo}</div>}
                </div>
                {s.action?.type === 'route' && (() => {
                  const route = s.action as RouteAction
                  const t = trialFor(route.process)
                  if (t && ['running', 'complete'].includes(t.status)) {
                    return (
                      <Button size="sm" variant="outline" className="flex-shrink-0" disabled={!onTrials} onClick={() => onTrials?.(t.id)}>
                        Trial {t.status === 'running' ? `running · ${t.summary?.judged ?? 0} judged` : TRIAL_VERDICT[t.summary?.verdict || 'pending']} <ArrowRight className="h-3 w-3 ml-1" />
                      </Button>
                    )
                  }
                  return settingsApi ? (
                    <Button size="sm" variant="outline" className="flex-shrink-0" onClick={() => void startTrial(route.process, route.complexity)}>
                      Start trial <ArrowRight className="h-3 w-3 ml-1" />
                    </Button>
                  ) : null
                })()}
                {settingsApi && s.action?.type === 'cadence' && (
                  <Badge variant="outline" className="flex-shrink-0">see cadence control ↓</Badge>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Pivot table */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Cost breakdown — {activeMonth}</CardTitle>
            <Select value={pivotDim} onValueChange={v => setPivotDim(v as PivotDim)}>
              <SelectTrigger className="w-36 h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="process">By task / process</SelectItem>
                <SelectItem value="model">By model</SelectItem>
                <SelectItem value="provider">By account</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{pivotDim === 'process' ? 'Task / process' : pivotDim === 'model' ? 'Model' : 'Account'}</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Calls</TableHead>
                <TableHead className="text-right">Tokens (in/out/cached)</TableHead>
                <TableHead className="w-40">Share</TableHead>
                {pivotDim === 'process' && settingsApi && <TableHead className="text-right">Action</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pivot.slice(0, 30).map(c => (
                <TableRow key={c.key}>
                  <TableCell className="font-mono text-xs">
                    {c.key}
                    {c.estimated && <Badge variant="outline" className="ml-2 text-[10px]">est.</Badge>}
                    {trialFor(c.key) && ['running', 'complete'].includes(trialFor(c.key)!.status) && (
                      <Badge variant="outline" className="ml-2 text-[10px]">trial {trialFor(c.key)!.status === 'running' ? 'running' : TRIAL_VERDICT[trialFor(c.key)!.summary?.verdict || 'pending']}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-medium">{money(c.costEur)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{c.calls.toLocaleString()}</TableCell>
                  <TableCell className="text-right text-muted-foreground text-xs">{fmtTok(c.inTok)} / {fmtTok(c.outTok)} / {fmtTok(c.cacheReadTok)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 bg-muted rounded overflow-hidden">
                        <div className="h-full bg-blue-500" style={{ width: `${(c.share * 100).toFixed(1)}%` }} />
                      </div>
                      <span className="text-xs text-muted-foreground w-10 text-right">{(c.share * 100).toFixed(1)}%</span>
                    </div>
                  </TableCell>
                  {pivotDim === 'process' && settingsApi && (
                    <TableCell className="text-right">
                      {c.key && !c.key.startsWith('token-adapter-') && !['claude', 'opencode', 'copilot', 'unknown'].includes(c.key) && (
                        !(trialFor(c.key) && ['running', 'complete'].includes(trialFor(c.key)!.status)) && (
                          <Button size="sm" variant="ghost" className="h-7 text-xs"
                            onClick={() => void startTrial(c.key, 'small')}>Trial cheaper</Button>
                        )
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Cadence control (part D) — coding's consolidation daemon only. */}
      {settingsApi && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Gauge className="h-4 w-4" />Consolidation cadence</CardTitle>
            <CardDescription>
              How often the auto-consolidation daemon rolls observations into digests/insights. Lower frequency = fewer background LLM calls.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <label className="flex items-center gap-2">
                <Checkbox checked={cadence.enabled} onCheckedChange={c => saveCadence({ enabled: !!c })} />
                <span>Enabled</span>
              </label>
              <label className="flex items-center gap-2">
                <span className="text-muted-foreground">Check every</span>
                <Input type="number" min={1} className="w-20 h-8" value={cadence.checkIntervalMinutes}
                  onChange={e => setCadence({ ...cadence, checkIntervalMinutes: parseInt(e.target.value || '30', 10) })}
                  onBlur={() => saveCadence({})} />
                <span className="text-muted-foreground">min</span>
              </label>
              <label className="flex items-center gap-2">
                <span className="text-muted-foreground">Undigested threshold</span>
                <Input type="number" min={1} className="w-20 h-8" value={cadence.undigestedThreshold}
                  onChange={e => setCadence({ ...cadence, undigestedThreshold: parseInt(e.target.value || '10', 10) })}
                  onBlur={() => saveCadence({})} />
              </label>
            </div>
          </CardContent>
        </Card>
      )}

      {settingsApi && (
        <CostSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} proxyBase={proxyBase}
          onSaved={(c) => { setSavedCfg(c); flash('Prices & budgets saved') }} />
      )}
    </div>
  )
}

/**
 * GitHub's own month-to-date figure for the Copilot account next to what was
 * measured here. GitHub's covers every client of the login — github.com, other
 * machines, anything glass never saw — so the difference is the part this
 * machine's figures miss. Measured above GitHub's means the per-model rates run
 * high, and says so instead of showing a negative "not seen".
 */
function CopilotReported({ quota, measured, toDisplay, money }: {
  quota: CopilotQuotaView
  measured: number
  toDisplay: (usd: number) => number
  money: (v: number) => string
}) {
  const q = quota.quota
  if (!q) {
    return (
      <div className="text-xs text-muted-foreground" title={quota.host ? `GitHub host: ${quota.host}` : undefined}>
        GitHub's own figure unavailable{quota.error ? `: ${quota.error}` : ''}
      </div>
    )
  }
  const reported = toDisplay(q.usedUsd)
  const gap = reported - measured
  const asOf = q.asOf ? new Date(q.asOf).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
  return (
    <div className="space-y-0.5" data-testid="copilot-reported">
      <div className="text-sm">
        GitHub reports <span className="font-semibold">{money(reported)}</span>
        <span className="text-muted-foreground">
          {' '}· {q.creditsUsed.toLocaleString()} of {q.entitlement.toLocaleString()} credits
          {q.percentUsed != null && <> ({q.percentUsed}%)</>}
          {asOf && <> · {asOf}</>}
        </span>
      </div>
      <div
        className="text-xs text-muted-foreground"
        title={`GitHub's count for the ${q.plan || 'Copilot'} account on ${quota.host}, every client included; resets ${q.resetDate}.`}
      >
        {gap >= 0
          ? <>not measured here: <span className="font-medium text-foreground">{money(gap)}</span>{reported > 0 && <> ({Math.round(100 * gap / reported)}%)</>} — other machines, github.com, tools glass does not see</>
          : <>measured is {money(-gap)} above GitHub's figure — the per-model rates run high</>}
      </div>
    </div>
  )
}
