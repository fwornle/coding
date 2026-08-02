import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { CostSettingsDialog } from './CostSettingsDialog'
import {
  CostRow, CostConfig, DEFAULT_COST_CONFIG, PivotDim,
  BUDGET_PROVIDER_LABEL, BudgetProvider, budgetProvider, isSynthetic, cellCostUsd, usdToEur,
  formatEur, monthlySeries, pivotForMonth, copilotBilling, projectBurn, budgetStatus,
  buildSuggestions, Suggestion,
} from './cost-model'

interface Props { proxyBase: string }

interface CadenceCfg { enabled: boolean; checkIntervalMinutes: number; undigestedThreshold: number }

const PROVIDER_BAR_COLOR: Record<string, string> = {
  'GitHub Copilot': '#2563eb',
  'Claude Max': '#d97706',
}
const MODEL_PALETTE = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#84cc16', '#a855f7', '#14b8a6']
const STATUS_CLASS: Record<string, string> = {
  ok: 'text-emerald-600 border-emerald-200',
  warn: 'text-amber-600 border-amber-300',
  over: 'text-red-600 border-red-300',
}
const STATUS_BAR: Record<string, string> = { ok: 'bg-emerald-500', warn: 'bg-amber-500', over: 'bg-red-500' }
const fmtTok = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : `${n}`

export function CostTab({ proxyBase }: Props) {
  const [rows, setRows] = useState<CostRow[]>([])
  const [cfg, setCfg] = useState<CostConfig>(DEFAULT_COST_CONFIG)
  const [overrides, setOverrides] = useState<Record<string, { provider?: string; model?: string }>>({})
  const [cadence, setCadence] = useState<CadenceCfg>({ enabled: true, checkIntervalMinutes: 30, undigestedThreshold: 10 })
  const [months, setMonths] = useState(6)
  const [pivotDim, setPivotDim] = useState<PivotDim>('process')
  const [chartDim, setChartDim] = useState<'provider' | 'model'>('provider')
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [costRes, setRes] = await Promise.all([
        fetch(`${proxyBase}/api/token-usage/cost?months=${months}`),
        fetch(`${proxyBase}/api/llm/settings`),
      ])
      if (!costRes.ok) throw new Error(`cost HTTP ${costRes.status}`)
      const costJson = await costRes.json()
      setRows(costJson.rows || [])
      if (setRes.ok) {
        const s = await setRes.json()
        setCfg({ ...DEFAULT_COST_CONFIG, ...(s.settings?.cost || {}) })
        setOverrides(s.settings?.processOverrides || {})
        if (s.settings?.consolidationCadence) setCadence(s.settings.consolidationCadence)
      }
    } catch (e: any) {
      setError(`Failed to load cost data: ${e.message}. Check the LLM proxy on port 12435.`)
    } finally { setLoading(false) }
  }, [proxyBase, months])

  useEffect(() => { load() }, [load])

  // Months present, newest first; default the pivot/tiles to the newest.
  const monthsPresent = useMemo(() => {
    const set = new Set(rows.filter(r => !isSynthetic(r)).map(r => r.month))
    return [...set].sort().reverse()
  }, [rows])
  const activeMonth = selectedMonth || monthsPresent[0] || null

  // Chart data: cost per month stacked by provider or model.
  const { chartData, chartKeys } = useMemo(() => {
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
    return { chartData: data, chartKeys: ordered }
  }, [rows, cfg, chartDim])

  const pivot = useMemo(() => pivotForMonth(rows, cfg, pivotDim, activeMonth), [rows, cfg, pivotDim, activeMonth])
  const suggestions = useMemo(() => activeMonth ? buildSuggestions(rows, cfg, activeMonth) : [], [rows, cfg, activeMonth])

  // Per-subscription budget tiles for the active month.
  const now = useMemo(() => new Date(), [])
  const isCurrentCalendarMonth = activeMonth === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const tiles = useMemo(() => {
    const out: Array<{
      provider: BudgetProvider; label: string; spendEur: number; projectedEur: number;
      budgetEur: number | null; status: string; notional: boolean; copilot?: { includedEur: number; overageEur: number }
    }> = []
    for (const bp of ['copilot', 'claude-max'] as BudgetProvider[]) {
      let spendUsd = 0
      for (const r of rows) {
        if (isSynthetic(r) || r.month !== activeMonth) continue
        if (budgetProvider(r.provider) !== bp) continue
        spendUsd += cellCostUsd(r, cfg)
      }
      const spendEur = usdToEur(spendUsd, cfg)
      const budget = cfg.budgets[bp]
      // Only project forward for the live calendar month; past months are final.
      const proj = isCurrentCalendarMonth ? projectBurn(spendEur, now) : { projectedEur: spendEur } as any
      const basis = budget?.budgetBasis || 'gross'
      const cop = bp === 'copilot' && activeMonth ? copilotBilling(rows, cfg, activeMonth) : undefined
      const compareVal = bp === 'copilot' && basis === 'overage' && cop
        ? (isCurrentCalendarMonth ? projectBurn(cop.overageEur, now).projectedEur : cop.overageEur)
        : proj.projectedEur
      out.push({
        provider: bp, label: BUDGET_PROVIDER_LABEL[bp], spendEur, projectedEur: proj.projectedEur,
        budgetEur: budget?.monthlyEur ?? null,
        status: budget?.enforce ? budgetStatus(compareVal, budget?.monthlyEur ?? null) : 'ok',
        notional: bp === 'claude-max',
        copilot: cop,
      })
    }
    return out
  }, [rows, cfg, activeMonth, isCurrentCalendarMonth, now])

  const overBudget = tiles.filter(t => t.status === 'over' || t.status === 'warn')

  // ---- Actions -----------------------------------------------------------
  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 4000) }

  const applyRoute = async (process: string, provider: string, model: string) => {
    try {
      const nextOverrides = { ...overrides, [process]: { provider, model } }
      const res = await fetch(`${proxyBase}/api/llm/settings`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ processOverrides: nextOverrides }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setOverrides(nextOverrides)
      flash(`Routed "${process}" → ${provider}/${model} (effective next call)`)
    } catch (e: any) { flash(`Route failed: ${e.message}`) }
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
          {toast && <span className="text-xs text-muted-foreground">{toast}</span>}
          <Button variant="outline" size="sm" onClick={load}><RefreshCw className="h-4 w-4 mr-1" />Refresh</Button>
          <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}><Settings className="h-4 w-4 mr-1" />Prices & Budgets</Button>
        </div>
      </div>

      {/* Burn-rate warning banner */}
      {overBudget.map(t => (
        <Alert key={t.provider} variant={t.status === 'over' ? 'destructive' : 'default'}
          className={t.status === 'warn' ? 'border-amber-300' : ''}>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <strong>{t.label}:</strong> {isCurrentCalendarMonth ? 'projected' : 'total'} {formatEur(t.projectedEur)} for {activeMonth}
            {t.budgetEur != null && <> vs {formatEur(t.budgetEur)} budget — {t.status === 'over' ? 'over budget' : 'on track to exceed 80%'}.</>}
            {t.status === 'over' && ' Consider the optimization suggestions below.'}
          </AlertDescription>
        </Alert>
      ))}

      {/* Budget tiles */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {tiles.map(t => {
          const pct = t.budgetEur ? Math.min(100, (t.projectedEur / t.budgetEur) * 100) : 0
          return (
            <Card key={t.provider} className={`border ${STATUS_CLASS[t.status]}`}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center justify-between">
                  <span>{t.label}</span>
                  {t.notional
                    ? <Badge variant="outline" className="text-xs font-normal">notional · flat sub</Badge>
                    : <Badge variant="outline" className={`text-xs font-normal ${STATUS_CLASS[t.status]}`}>{t.status === 'over' ? 'over budget' : t.status === 'warn' ? 'approaching' : 'on track'}</Badge>}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold">{formatEur(t.spendEur)}</span>
                  <span className="text-sm text-muted-foreground">spent {activeMonth}</span>
                </div>
                {isCurrentCalendarMonth && (
                  <div className="text-sm text-muted-foreground">
                    projected month-end: <span className="font-medium text-foreground">{formatEur(t.projectedEur)}</span>
                    {t.budgetEur != null && <> / {formatEur(t.budgetEur)} budget</>}
                  </div>
                )}
                {t.budgetEur != null && (
                  <div className="h-2 w-full bg-muted rounded overflow-hidden">
                    <div className={`h-full ${STATUS_BAR[t.status]}`} style={{ width: `${pct}%` }} />
                  </div>
                )}
                {t.copilot && (
                  <div className="text-xs text-muted-foreground pt-1">
                    incl. allowance {formatEur(t.copilot.includedEur)} · overage {formatEur(t.copilot.overageEur)}
                  </div>
                )}
                {t.notional && (
                  <div className="text-xs text-muted-foreground pt-1">API-equivalent cost — Claude Max is a flat subscription, not metered.</div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Monthly cost chart */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4" />Cost by month</CardTitle>
            <Select value={chartDim} onValueChange={v => setChartDim(v as 'provider' | 'model')}>
              <SelectTrigger className="w-40 h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="provider">By subscription</SelectItem>
                <SelectItem value="model">By model</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <CardDescription>Stacked €-cost per calendar month. Estimated-token rows included.</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" opacity={0.4} />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `€${v}`} />
              <Tooltip formatter={(v: any) => formatEur(Number(v))} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {chartKeys.map((k, i) => (
                <Bar key={k} dataKey={k} stackId="cost"
                  fill={PROVIDER_BAR_COLOR[k] || MODEL_PALETTE[i % MODEL_PALETTE.length]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Optimization suggestions */}
      {suggestions.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Lightbulb className="h-4 w-4" />Optimization suggestions — {activeMonth}</CardTitle>
            <CardDescription>Ranked by estimated monthly saving. Actions take effect on the next call (no restart).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {suggestions.map(s => (
              <div key={s.id} className="flex items-center justify-between gap-3 border rounded-lg p-3">
                <div className="min-w-0">
                  <div className="font-medium text-sm">{s.title} <span className="text-emerald-600">· save ~{formatEur(s.estSavingsEur)}/mo</span></div>
                  <div className="text-xs text-muted-foreground">{s.detail}</div>
                </div>
                {s.action?.type === 'route' && (
                  <Button size="sm" variant="outline" className="flex-shrink-0"
                    onClick={() => applyRoute((s.action as any).process, (s.action as any).provider, (s.action as any).model)}>
                    Route to Haiku <ArrowRight className="h-3 w-3 ml-1" />
                  </Button>
                )}
                {s.action?.type === 'cadence' && (
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
                <SelectItem value="provider">By subscription</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{pivotDim === 'process' ? 'Task / process' : pivotDim === 'model' ? 'Model' : 'Subscription'}</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Calls</TableHead>
                <TableHead className="text-right">Tokens (in/out)</TableHead>
                <TableHead className="w-40">Share</TableHead>
                {pivotDim === 'process' && <TableHead className="text-right">Action</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pivot.slice(0, 30).map(c => (
                <TableRow key={c.key}>
                  <TableCell className="font-mono text-xs">
                    {c.key}
                    {c.estimated && <Badge variant="outline" className="ml-2 text-[10px]">est.</Badge>}
                    {overrides[c.key] && <Badge variant="outline" className="ml-2 text-[10px] text-emerald-600 border-emerald-200">routed</Badge>}
                  </TableCell>
                  <TableCell className="text-right font-medium">{formatEur(c.costEur)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{c.calls.toLocaleString()}</TableCell>
                  <TableCell className="text-right text-muted-foreground text-xs">{fmtTok(c.inTok)} / {fmtTok(c.outTok)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 bg-muted rounded overflow-hidden">
                        <div className="h-full bg-blue-500" style={{ width: `${(c.share * 100).toFixed(1)}%` }} />
                      </div>
                      <span className="text-xs text-muted-foreground w-10 text-right">{(c.share * 100).toFixed(1)}%</span>
                    </div>
                  </TableCell>
                  {pivotDim === 'process' && (
                    <TableCell className="text-right">
                      {c.key && !c.key.startsWith('token-adapter-') && !['claude', 'opencode', 'copilot', 'unknown'].includes(c.key) && (
                        <Button size="sm" variant="ghost" className="h-7 text-xs"
                          onClick={() => applyRoute(c.key, 'copilot', 'claude-haiku-4.5')}>→ Haiku</Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Cadence control (part D) */}
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

      <CostSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} proxyBase={proxyBase}
        onSaved={(c) => { setCfg(c); flash('Prices & budgets saved') }} />
    </div>
  )
}
