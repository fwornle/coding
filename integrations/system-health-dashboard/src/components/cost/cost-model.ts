// Pure cost/budget logic for the Token Usage → Cost tab. No React here.
//
// Data flows in from GET /api/token-usage/cost (raw token sums grouped by
// month × provider × model × process) and the `cost` block of
// GET /api/llm/settings (operator-editable prices/budgets). This module turns
// token counts into €/$ and derives budget/burn-rate/optimization outputs.
//
// Two canonical budget buckets = the two real subscriptions the user pays for:
//   - `copilot`     ← copilot / github-copilot   (usage-based credits, real cap)
//   - `claude-max`  ← anthropic / claude-code     (flat subscription, notional)

export interface CostRow {
  month: string            // 'YYYY-MM'
  provider: string
  model: string
  process: string
  subscription: string
  calls: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  estimated_calls: number
}

export interface ModelPrice { in: number; out: number; cacheRead: number; cacheWrite: number }

export interface CostConfig {
  currency: { display: string; usdToEur: number }
  modelPrices: Record<string, ModelPrice>
  providerScale: Record<string, number>
  copilot: { plan: string; includedCreditsUsd: number; creditUsd: number; overagePrices: string }
  budgets: Record<string, { monthlyEur: number | null; enforce: boolean; budgetBasis: string }>
}

export const DEFAULT_COST_CONFIG: CostConfig = {
  currency: { display: 'EUR', usdToEur: 0.92 },
  modelPrices: {
    'claude-haiku-4.5':  { in: 1,   out: 5,   cacheRead: 0.10,  cacheWrite: 1.25 },
    'claude-sonnet-4.6': { in: 3,   out: 15,  cacheRead: 0.30,  cacheWrite: 3.75 },
    'claude-opus-4.8':   { in: 5,   out: 25,  cacheRead: 0.50,  cacheWrite: 6.25 },
    'claude-fable-5':    { in: 10,  out: 50,  cacheRead: 1.00,  cacheWrite: 12.50 },
    'gpt-4o':            { in: 2.5, out: 10,  cacheRead: 1.25,  cacheWrite: 0 },
    'gpt-4o-mini':       { in: 0.15, out: 0.6, cacheRead: 0.075, cacheWrite: 0 },
    'gpt-5':             { in: 1.25, out: 10, cacheRead: 0.125, cacheWrite: 0 },
  },
  providerScale: { copilot: 1.0, 'claude-max': 1.0 },
  copilot: { plan: 'business', includedCreditsUsd: 19, creditUsd: 0.01, overagePrices: 'sameAsModelPrices' },
  budgets: {
    copilot:      { monthlyEur: 300,  enforce: true,  budgetBasis: 'gross' },
    'claude-max': { monthlyEur: null, enforce: false, budgetBasis: 'gross' },
  },
}

// ---- Synthetic / test-row filtering -------------------------------------
// The DB carries a handful of demo/probe rows (fake-peer provider, synthetic
// models). They must never enter cost math or they pollute totals.
const SYNTHETIC_MODELS = new Set(['synthetic', '<synthetic>', 'fake-model'])
const SYNTHETIC_PROVIDERS = new Set(['fake-peer'])
export function isSynthetic(r: CostRow): boolean {
  const m = (r.model || '').toLowerCase()
  if (SYNTHETIC_MODELS.has(m)) return true
  if (SYNTHETIC_PROVIDERS.has((r.provider || '').toLowerCase())) return true
  if (m.startsWith('fake') || m.startsWith('demo')) return true
  return false
}

// ---- Model → family (for version-tolerant price fallback) ---------------
export type ModelFamily = 'haiku' | 'sonnet' | 'opus' | 'fable' | 'gpt-4o-mini' | 'gpt-4o' | 'gpt-5' | 'other'
export function modelFamily(model: string): ModelFamily {
  const m = (model || '').toLowerCase()
  if (m.includes('haiku')) return 'haiku'
  if (m.includes('sonnet')) return 'sonnet'
  if (m.includes('opus')) return 'opus'
  if (m.includes('fable')) return 'fable'
  if (m.includes('gpt-4o-mini') || m.includes('4o-mini')) return 'gpt-4o-mini'
  if (m.includes('gpt-4o') || m.includes('4o')) return 'gpt-4o'
  if (m.includes('gpt-5') || m.includes('gpt5')) return 'gpt-5'
  return 'other'
}

// One representative modelPrices key per family — used for the fallback when
// an exact model key is absent (e.g. claude-opus-4-8 → the opus row).
const FAMILY_REPRESENTATIVE: Record<ModelFamily, string[]> = {
  haiku: ['claude-haiku-4.5'],
  sonnet: ['claude-sonnet-4.6'],
  opus: ['claude-opus-4.8', 'claude-opus-4.6'],
  fable: ['claude-fable-5'],
  'gpt-4o-mini': ['gpt-4o-mini'],
  'gpt-4o': ['gpt-4o'],
  'gpt-5': ['gpt-5'],
  other: [],
}

export interface ResolvedPrice { price: ModelPrice; priced: boolean; source: 'exact' | 'family' | 'none' }
export function priceForModel(model: string, prices: Record<string, ModelPrice>): ResolvedPrice {
  const normalized = model
  if (prices[normalized]) return { price: prices[normalized], priced: true, source: 'exact' }
  // family fallback: first the representative keys, then any key that matches the family
  const fam = modelFamily(model)
  for (const key of FAMILY_REPRESENTATIVE[fam]) {
    if (prices[key]) return { price: prices[key], priced: true, source: 'family' }
  }
  if (fam !== 'other') {
    const hit = Object.keys(prices).find(k => modelFamily(k) === fam)
    if (hit) return { price: prices[hit], priced: true, source: 'family' }
  }
  return { price: { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 }, priced: false, source: 'none' }
}

// ---- Provider → budget bucket -------------------------------------------
export type BudgetProvider = 'copilot' | 'claude-max'
export function budgetProvider(provider: string): BudgetProvider {
  const p = (provider || '').toLowerCase()
  if (p.includes('copilot') || p === 'github') return 'copilot'
  return 'claude-max' // anthropic, claude-code, max-oauth-passthrough
}
export const BUDGET_PROVIDER_LABEL: Record<BudgetProvider, string> = {
  copilot: 'GitHub Copilot',
  'claude-max': 'Claude Max',
}

// ---- Per-cell cost (USD) ------------------------------------------------
export function cellCostUsd(r: CostRow, cfg: CostConfig): number {
  const { price } = priceForModel(r.model, cfg.modelPrices)
  const scale = cfg.providerScale?.[budgetProvider(r.provider)] ?? 1
  const usd = (
    (r.input_tokens / 1e6) * price.in +
    (r.output_tokens / 1e6) * price.out +
    (r.cache_read_tokens / 1e6) * price.cacheRead +
    (r.cache_write_tokens / 1e6) * price.cacheWrite
  )
  return usd * scale
}
export const usdToEur = (usd: number, cfg: CostConfig): number => usd * (cfg.currency?.usdToEur ?? 0.92)

export function formatEur(eur: number): string {
  if (!isFinite(eur)) return '—'
  if (eur === 0) return '€0.00'
  if (Math.abs(eur) < 0.01) return '<€0.01'
  if (Math.abs(eur) >= 1000) return `€${(eur / 1000).toFixed(2)}k`
  return `€${eur.toFixed(2)}`
}

// ---- Aggregations -------------------------------------------------------
export type PivotDim = 'provider' | 'model' | 'process'
function dimKey(r: CostRow, dim: PivotDim): string {
  if (dim === 'provider') return BUDGET_PROVIDER_LABEL[budgetProvider(r.provider)]
  if (dim === 'model') return r.model
  return r.process
}

export interface MonthTotal { month: string; costEur: number; byKey: Record<string, number> }
// Cost per month, split by the chosen dimension. Returns months ascending.
export function monthlySeries(rows: CostRow[], cfg: CostConfig, dim: PivotDim): MonthTotal[] {
  const byMonth = new Map<string, MonthTotal>()
  for (const r of rows) {
    if (isSynthetic(r)) continue
    const eur = usdToEur(cellCostUsd(r, cfg), cfg)
    if (!byMonth.has(r.month)) byMonth.set(r.month, { month: r.month, costEur: 0, byKey: {} })
    const m = byMonth.get(r.month)!
    m.costEur += eur
    const k = dimKey(r, dim)
    m.byKey[k] = (m.byKey[k] || 0) + eur
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month))
}

export interface PivotCell {
  key: string
  costEur: number
  calls: number
  inTok: number
  outTok: number
  cacheReadTok: number
  estimated: boolean
  share: number
}
// Flat ranked pivot for a single month (or all months when month is null).
export function pivotForMonth(rows: CostRow[], cfg: CostConfig, dim: PivotDim, month: string | null): PivotCell[] {
  const agg = new Map<string, PivotCell>()
  let total = 0
  for (const r of rows) {
    if (isSynthetic(r)) continue
    if (month && r.month !== month) continue
    const eur = usdToEur(cellCostUsd(r, cfg), cfg)
    total += eur
    const k = dimKey(r, dim)
    if (!agg.has(k)) agg.set(k, { key: k, costEur: 0, calls: 0, inTok: 0, outTok: 0, cacheReadTok: 0, estimated: false, share: 0 })
    const c = agg.get(k)!
    c.costEur += eur
    c.calls += r.calls
    c.inTok += r.input_tokens
    c.outTok += r.output_tokens
    c.cacheReadTok += r.cache_read_tokens
    if (r.estimated_calls > 0) c.estimated = true
  }
  const out = [...agg.values()].sort((a, b) => b.costEur - a.costEur)
  for (const c of out) c.share = total > 0 ? c.costEur / total : 0
  return out
}

// ---- Copilot real billing (Business tier) -------------------------------
export interface CopilotBilling { grossEur: number; includedEur: number; overageEur: number }
export function copilotBilling(rows: CostRow[], cfg: CostConfig, month: string): CopilotBilling {
  let grossUsd = 0
  for (const r of rows) {
    if (isSynthetic(r)) continue
    if (r.month !== month) continue
    if (budgetProvider(r.provider) !== 'copilot') continue
    grossUsd += cellCostUsd(r, cfg)
  }
  const grossEur = usdToEur(grossUsd, cfg)
  const includedEur = usdToEur(cfg.copilot?.includedCreditsUsd ?? 0, cfg)
  return { grossEur, includedEur, overageEur: Math.max(0, grossEur - includedEur) }
}

// ---- Burn-rate projection -----------------------------------------------
export interface BurnProjection {
  spendEur: number
  projectedEur: number
  daysElapsed: number
  daysInMonth: number
  dailyRateEur: number
}
export function projectBurn(spendEur: number, now: Date): BurnProjection {
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  // include the current (partial) day so early-month projections aren't wild
  const daysElapsed = Math.max(1, now.getDate())
  const dailyRateEur = spendEur / daysElapsed
  return { spendEur, projectedEur: dailyRateEur * daysInMonth, daysElapsed, daysInMonth, dailyRateEur }
}

// ---- Budget status ------------------------------------------------------
export type BudgetStatus = 'ok' | 'warn' | 'over'
export function budgetStatus(projectedEur: number, budgetEur: number | null): BudgetStatus {
  if (budgetEur == null) return 'ok'
  if (projectedEur >= budgetEur) return 'over'
  if (projectedEur >= budgetEur * 0.8) return 'warn'
  return 'ok'
}

// ---- Optimization suggestions -------------------------------------------
export interface RouteAction { type: 'route'; process: string; provider: string; model: string }
export interface CadenceAction { type: 'cadence' }
export interface Suggestion {
  id: string
  title: string
  detail: string
  estSavingsEur: number
  action?: RouteAction | CadenceAction
}

// Foreground agent sessions are the user's own interactive work — never a
// routing target. Everything else is a background/pipeline process we can pin
// to a cheaper model via processOverrides.
function isRoutableBackground(process: string): boolean {
  if (!process) return false
  if (process.startsWith('token-adapter-')) return false
  if (['claude', 'opencode', 'copilot', 'unknown'].includes(process)) return false
  return true
}

export function buildSuggestions(rows: CostRow[], cfg: CostConfig, month: string): Suggestion[] {
  const suggestions: Suggestion[] = []
  const haiku = cfg.modelPrices['claude-haiku-4.5'] || DEFAULT_COST_CONFIG.modelPrices['claude-haiku-4.5']

  // 1) Background processes running on an expensive (non-haiku) model this month.
  //    Savings = current cost − cost if the same tokens ran on haiku.
  const perProcess = new Map<string, { costEur: number; haikuEur: number; provider: string; model: string; tokens: number }>()
  for (const r of rows) {
    if (isSynthetic(r) || r.month !== month) continue
    if (!isRoutableBackground(r.process)) continue
    const fam = modelFamily(r.model)
    if (fam === 'haiku') continue // already cheap
    const curEur = usdToEur(cellCostUsd(r, cfg), cfg)
    const haikuUsd = (r.input_tokens / 1e6) * haiku.in + (r.output_tokens / 1e6) * haiku.out +
      (r.cache_read_tokens / 1e6) * haiku.cacheRead + (r.cache_write_tokens / 1e6) * haiku.cacheWrite
    const haikuEur = usdToEur(haikuUsd, cfg)
    const key = r.process
    if (!perProcess.has(key)) perProcess.set(key, { costEur: 0, haikuEur: 0, provider: r.provider, model: r.model, tokens: 0 })
    const p = perProcess.get(key)!
    p.costEur += curEur
    p.haikuEur += haikuEur
    p.tokens += r.input_tokens + r.output_tokens
  }
  for (const [proc, p] of perProcess) {
    const savings = p.costEur - p.haikuEur
    if (savings < 0.5) continue // ignore sub-€0.50 noise
    suggestions.push({
      id: `route-haiku-${proc}`,
      title: `Route "${proc}" to Haiku`,
      detail: `${proc} spent ${formatEur(p.costEur)} this month on ${modelFamily(p.model)}. Same tokens on Haiku 4.5 ≈ ${formatEur(p.haikuEur)}.`,
      estSavingsEur: savings,
      action: { type: 'route', process: proc, provider: 'copilot', model: 'claude-haiku-4.5' },
    })
  }

  // 2) Consolidation is a big share → offer cadence throttling.
  const consolidationEur = suggestions
    .filter(s => s.id.includes('consolidator'))
    .reduce((a, s) => a + s.estSavingsEur, 0)
  const consolTotal = [...perProcess.entries()]
    .filter(([k]) => k.startsWith('consolidator'))
    .reduce((a, [, p]) => a + p.costEur, 0)
  if (consolTotal > 2) {
    suggestions.push({
      id: 'cadence-consolidation',
      title: 'Throttle consolidation cadence',
      detail: `Consolidation processes cost ${formatEur(consolTotal)} this month. Increasing the check interval or the undigested threshold reduces how often they run.`,
      estSavingsEur: consolidationEur > 0 ? consolidationEur * 0.3 : consolTotal * 0.2,
      action: { type: 'cadence' },
    })
  }

  return suggestions.sort((a, b) => b.estSavingsEur - a.estSavingsEur)
}
