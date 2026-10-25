import { useEffect, useState } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { CostConfig, DEFAULT_COST_CONFIG, ModelPrice, mergeCostConfig } from './cost-model'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  proxyBase: string
  onSaved: (cost: CostConfig) => void
}

// Deep-ish clone so the draft never mutates the live config.
const clone = (c: CostConfig): CostConfig => JSON.parse(JSON.stringify(c))

export function CostSettingsDialog({ open, onOpenChange, proxyBase, onSaved }: Props) {
  const [draft, setDraft] = useState<CostConfig>(clone(DEFAULT_COST_CONFIG))
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setLoading(true); setError(null)
    fetch(`${proxyBase}/api/llm/settings`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(d => setDraft(clone(mergeCostConfig(d.settings?.cost))))
      .catch(e => setError(`Failed to load: ${e.message}`))
      .finally(() => setLoading(false))
  }, [open, proxyBase])

  const setPrice = (table: 'modelPrices' | 'copilotPrices', model: string, field: keyof ModelPrice, value: number) => {
    setDraft(d => ({ ...d, [table]: { ...d[table], [model]: { ...d[table][model], [field]: value } } }))
  }
  const num = (v: string, fallback = 0) => { const n = parseFloat(v); return isNaN(n) ? fallback : n }

  const save = async () => {
    setSaving(true); setError(null)
    try {
      const res = await fetch(`${proxyBase}/api/llm/settings`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cost: draft }),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        throw new Error(b.error || `HTTP ${res.status}`)
      }
      onSaved(draft)
      onOpenChange(false)
    } catch (e: any) { setError(`Save failed: ${e.message}`) }
    finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl flex flex-col max-h-[88vh]">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>Cost & Budget Settings</DialogTitle>
          <DialogDescription>
            Prices are USD per 1M tokens. GitHub Copilot uses its measured rates where the cost settings have them, else GitHub's rate card; every other
            account uses the public list rates, where version variants resolve by family (any{' '}
            <code>*opus*</code> → the Opus row). Budgets are per account, in EUR.
          </DialogDescription>
        </DialogHeader>

        {error && <div className="text-sm text-red-600 border border-red-200 rounded p-2">{error}</div>}
        {loading ? (
          <div className="py-8 text-center text-muted-foreground text-sm">Loading…</div>
        ) : (
          <div className="overflow-y-auto flex-1 space-y-6 pr-1">
            {/* Currency + contract discount: Copilot cost bought through a cloud
                contract is token $ × the contract's discount factor ÷ FX. */}
            <section>
              <h3 className="text-sm font-semibold mb-2">Currency & discount</h3>
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <span className="text-muted-foreground">FX</span>
                  <Input type="number" step="0.01" className="w-24 h-8"
                    value={draft.currency.usdPerEur}
                    onChange={e => setDraft(d => ({ ...d, currency: { ...d.currency, usdPerEur: num(e.target.value, 1.18) } }))} />
                  <span className="text-muted-foreground">USD per EUR</span>
                </label>
                <label className="flex items-center gap-2">
                  <span className="text-muted-foreground">GitHub Copilot discount factor</span>
                  <Input type="number" step="0.01" className="w-24 h-8"
                    value={draft.discount.copilot ?? 1}
                    onChange={e => setDraft(d => ({ ...d, discount: { ...d.discount, copilot: num(e.target.value, 1) } }))} />
                  <span className="text-xs text-muted-foreground">1 = no discount · 0.8 = 20% off</span>
                </label>
              </div>
              <div className="text-xs text-muted-foreground mt-2">
                These are the standing values. Discounts that start and end, apply to one model or a
                model family, dated Copilot rates and FX are <code>periods</code> in the cost settings
                (see the token usage docs); each row is priced with the rules in force on its day.
              </div>
              {(draft.periods || []).length > 0 && (
                <ul className="text-xs mt-2 space-y-1" aria-label="Dated billing rules">
                  {(draft.periods || []).map((p, i) => (
                    <li key={i} className="font-mono">
                      {p.from || '…'} → {p.to || '…'} · {p.account || 'copilot'}
                      {p.discount !== undefined && <> · ×{p.discount}</>}
                      {Object.entries(p.families || {}).map(([k, v]) => <span key={`f${k}`}> · {k}* ×{v}</span>)}
                      {Object.entries(p.models || {}).map(([k, v]) => <span key={`m${k}`}> · {k} ×{v}</span>)}
                      {Object.keys(p.prices || {}).length > 0 && <> · rates for {Object.keys(p.prices || {}).join(', ')}</>}
                      {p.usdPerEur !== undefined && <> · FX {p.usdPerEur}</>}
                      {p.note && <span className="font-sans text-muted-foreground"> — {p.note}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Calibrated Copilot rates */}
            <section>
              <h3 className="text-sm font-semibold mb-2">GitHub Copilot rates — USD / 1M tokens (measured)</h3>
              <div className="text-xs text-muted-foreground mb-2">
                Fitted per model from your own Copilot usage sheet by{' '}
                <code>scripts/cost/calibrate-copilot-prices.mjs</code>; re-run it on a new sheet rather
                than editing by hand. Models not listed here price from GitHub's rate card. An input rate above list carries the cache-write premium the
                OpenAI wire does not report separately.
                {Object.keys(draft.copilotPrices).length === 0 && <> None set: every model prices from the rate card.</>}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b">
                      <th className="py-1 pr-2">Model</th>
                      <th className="py-1 px-2">Input</th>
                      <th className="py-1 px-2">Output</th>
                      <th className="py-1 px-2">Cache read</th>
                      <th className="py-1 px-2">Cache write</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(draft.copilotPrices).map(([model, p]) => (
                      <tr key={model} className="border-b border-muted/40">
                        <td className="py-1 pr-2 font-mono text-xs">{model}</td>
                        {(['in', 'out', 'cacheRead', 'cacheWrite'] as (keyof ModelPrice)[]).map(f => (
                          <td key={f} className="py-1 px-2">
                            <Input type="number" step="0.01" className="w-24 h-8"
                              value={p[f]} onChange={e => setPrice('copilotPrices', model, f, num(e.target.value))} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Model prices */}
            <section>
              <h3 className="text-sm font-semibold mb-2">List prices — USD / 1M tokens</h3>
              <div className="text-xs text-muted-foreground mb-2">
                Seeded at published rates — Opus $5 / $25, Sonnet $3 / $15. A <code>-fast</code>{' '}
                model id has no row of its own: it prices at 2&times; its base model, so{' '}
                <code>claude-opus-5-fast</code> is $10 / $50. Confirm against your actual model tier.
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground border-b">
                      <th className="py-1 pr-2">Model</th>
                      <th className="py-1 px-2">Input</th>
                      <th className="py-1 px-2">Output</th>
                      <th className="py-1 px-2">Cache read</th>
                      <th className="py-1 px-2">Cache write</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(draft.modelPrices).map(([model, p]) => (
                      <tr key={model} className="border-b border-muted/40">
                        <td className="py-1 pr-2 font-mono text-xs">{model}</td>
                        {(['in', 'out', 'cacheRead', 'cacheWrite'] as (keyof ModelPrice)[]).map(f => (
                          <td key={f} className="py-1 px-2">
                            <Input type="number" step="0.01" className="w-24 h-8"
                              value={p[f]} onChange={e => setPrice('modelPrices', model, f, num(e.target.value))} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Copilot billing */}
            <section>
              <h3 className="text-sm font-semibold mb-2">GitHub Copilot billing</h3>
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <span className="text-muted-foreground">Plan</span>
                  <span className="font-mono text-xs px-2 py-1 bg-muted rounded">{draft.copilot.plan}</span>
                </label>
                <label className="flex items-center gap-2">
                  <span className="text-muted-foreground">Included allowance (USD/mo)</span>
                  <Input type="number" step="1" className="w-24 h-8"
                    value={draft.copilot.includedCreditsUsd}
                    onChange={e => setDraft(d => ({ ...d, copilot: { ...d.copilot, includedCreditsUsd: num(e.target.value, 19) } }))} />
                </label>
                <span className="text-xs text-muted-foreground">Business = $19 (1,900 credits · $0.01 each)</span>
              </div>
            </section>

            {/* Budgets */}
            <section>
              <h3 className="text-sm font-semibold mb-2">Monthly budgets (EUR)</h3>
              <div className="space-y-3">
                {/* Copilot budget */}
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="w-28 font-medium">GitHub Copilot</span>
                  <Input type="number" step="10" className="w-28 h-8"
                    value={draft.budgets.copilot.monthlyEur ?? ''}
                    placeholder="none"
                    onChange={e => setDraft(d => ({ ...d, budgets: { ...d.budgets, copilot: { ...d.budgets.copilot, monthlyEur: e.target.value === '' ? null : num(e.target.value, 300) } } }))} />
                  <Select value={draft.budgets.copilot.budgetBasis}
                    onValueChange={v => setDraft(d => ({ ...d, budgets: { ...d.budgets, copilot: { ...d.budgets.copilot, budgetBasis: v } } }))}>
                    <SelectTrigger className="w-40 h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gross">vs gross usage</SelectItem>
                      <SelectItem value="overage">vs overage only</SelectItem>
                    </SelectContent>
                  </Select>
                  <label className="flex items-center gap-1.5">
                    <Checkbox checked={draft.budgets.copilot.enforce}
                      onCheckedChange={c => setDraft(d => ({ ...d, budgets: { ...d.budgets, copilot: { ...d.budgets.copilot, enforce: !!c } } }))} />
                    <span className="text-muted-foreground">warn</span>
                  </label>
                </div>
                {/* Per-month overrides. A cap is not a constant: it can be raised
                    several times in one month as extensions are approved,
                    and without a history a single number would retroactively
                    re-judge every past month against a budget it never had. The
                    standing value above applies to any month with no entry here. */}
                <div className="pl-2 border-l-2 border-muted ml-1 space-y-2">
                  <div className="text-xs text-muted-foreground">
                    Per-month overrides — for months where an extension was approved. Months not
                    listed use the standing budget above.
                  </div>
                  {Object.entries(draft.budgets.copilot.monthlyEurByMonth ?? {})
                    .sort(([a], [b]) => b.localeCompare(a))
                    .map(([month, eur]) => (
                      <div key={month} className="flex items-center gap-2 text-sm">
                        <Input
                          className="w-28 h-8 font-mono"
                          value={month}
                          placeholder="YYYY-MM"
                          onChange={e => setDraft(d => {
                            const next = { ...(d.budgets.copilot.monthlyEurByMonth ?? {}) }
                            delete next[month]
                            next[e.target.value] = eur
                            return { ...d, budgets: { ...d.budgets, copilot: { ...d.budgets.copilot, monthlyEurByMonth: next } } }
                          })} />
                        <Input
                          type="number" step="10" className="w-28 h-8"
                          value={eur ?? ''}
                          placeholder="no cap"
                          onChange={e => setDraft(d => ({
                            ...d,
                            budgets: {
                              ...d.budgets,
                              copilot: {
                                ...d.budgets.copilot,
                                monthlyEurByMonth: {
                                  ...(d.budgets.copilot.monthlyEurByMonth ?? {}),
                                  [month]: e.target.value === '' ? null : num(e.target.value, 0),
                                },
                              },
                            },
                          }))} />
                        <Button
                          variant="ghost" size="sm" className="h-8 px-2 text-muted-foreground"
                          onClick={() => setDraft(d => {
                            const next = { ...(d.budgets.copilot.monthlyEurByMonth ?? {}) }
                            delete next[month]
                            return { ...d, budgets: { ...d.budgets, copilot: { ...d.budgets.copilot, monthlyEurByMonth: next } } }
                          })}
                        >remove</Button>
                      </div>
                    ))}
                  <Button
                    variant="outline" size="sm" className="h-8"
                    onClick={() => setDraft(d => {
                      const now = new Date()
                      const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
                      const cur = d.budgets.copilot.monthlyEurByMonth ?? {}
                      // Defaults to the CURRENT month and the standing value —
                      // the overwhelmingly common case is "this month got raised".
                      if (Object.prototype.hasOwnProperty.call(cur, key)) return d
                      return {
                        ...d,
                        budgets: {
                          ...d.budgets,
                          copilot: {
                            ...d.budgets.copilot,
                            monthlyEurByMonth: { ...cur, [key]: d.budgets.copilot.monthlyEur ?? 0 },
                          },
                        },
                      }
                    })}
                  >+ add month</Button>
                </div>

                {/* Claude Max budget */}
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="w-28 font-medium">Claude Max</span>
                  <Input type="number" step="10" className="w-28 h-8"
                    value={draft.budgets['claude-max'].monthlyEur ?? ''}
                    placeholder="none (flat sub)"
                    onChange={e => setDraft(d => ({ ...d, budgets: { ...d.budgets, 'claude-max': { ...d.budgets['claude-max'], monthlyEur: e.target.value === '' ? null : num(e.target.value) } } }))} />
                  <span className="text-xs text-muted-foreground">flat subscription — cost shown is notional (API-equivalent)</span>
                </div>
              </div>
            </section>
          </div>
        )}

        <DialogFooter className="flex-shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || loading}>{saving ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
