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
import { CostConfig, DEFAULT_COST_CONFIG, ModelPrice } from './cost-model'

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
      .then(d => setDraft({ ...clone(DEFAULT_COST_CONFIG), ...(d.settings?.cost || {}) }))
      .catch(e => setError(`Failed to load: ${e.message}`))
      .finally(() => setLoading(false))
  }, [open, proxyBase])

  const setPrice = (model: string, field: keyof ModelPrice, value: number) => {
    setDraft(d => ({ ...d, modelPrices: { ...d.modelPrices, [model]: { ...d.modelPrices[model], [field]: value } } }))
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
            Prices are USD per 1M tokens (public provider rates). Version variants resolve by family
            (any <code>*opus*</code> → the Opus row). Budgets are per subscription, in EUR.
          </DialogDescription>
        </DialogHeader>

        {error && <div className="text-sm text-red-600 border border-red-200 rounded p-2">{error}</div>}
        {loading ? (
          <div className="py-8 text-center text-muted-foreground text-sm">Loading…</div>
        ) : (
          <div className="overflow-y-auto flex-1 space-y-6 pr-1">
            {/* Currency */}
            <section>
              <h3 className="text-sm font-semibold mb-2">Currency</h3>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">1 USD =</span>
                <Input type="number" step="0.01" className="w-24 h-8"
                  value={draft.currency.usdToEur}
                  onChange={e => setDraft(d => ({ ...d, currency: { ...d.currency, usdToEur: num(e.target.value, 0.92) } }))} />
                <span className="text-muted-foreground">EUR</span>
              </div>
            </section>

            {/* Model prices */}
            <section>
              <h3 className="text-sm font-semibold mb-2">Model prices — USD / 1M tokens</h3>
              <div className="text-xs text-muted-foreground mb-2">
                Opus 4.8 seeded at $5 / $25 — confirm against your actual model tier.
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
                              value={p[f]} onChange={e => setPrice(model, f, num(e.target.value))} />
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
