// Pure cost/budget logic for the Token Usage page (Cost tab and the €/$ view of
// every other tab). No React here.
//
// Data flows in from GET /api/token-usage/cost (raw token sums grouped by
// month × provider × model × process), the summary's opt-in `cells`, and the
// `cost` block of GET /api/llm/settings (operator-editable prices/budgets). This
// module turns token counts into money and derives budget/burn-rate/optimization
// outputs.
//
// Every row is billed to an ACCOUNT (normalizeProvider — the same identity the
// rest of the page groups by), and the account's KIND decides how it is priced:
//   - copilot  ← gh-copilot (copilot / github-copilot)  GitHub's per-model rates
//                (lib/cost/copilot-pricing.mjs), × the contract discount
//   - flat     ← claude-code-max (anthropic / claude-code)  notional API-list cost
//   - local    ← own hardware (qwen-*, any offload target)  zero per token
//   - metered  ← anything else (anthropic-api, openai, groq)  API list price
//
// Money: token dollars × discount[account] → USD; ÷ usdPerEur → EUR. An
// organisation buying Copilot through a cloud contract states its rule exactly
// that way — token $ × its discount ÷ its FX — so both are data, not code: the
// proxy's settings in coding, glass's per-target cost-defaults.json.
import { normalizeProvider, accountLabel } from '@/lib/providers'
import { SITE_LOCAL_PROVIDERS } from '@/lib/provider-site'
// The Copilot rate tables live with every other reader of them (glass's status
// line, the calibration script) — one copy, see the module header.
import {
  CALIBRATED_COPILOT_PRICES, COPILOT_RATE_CARD, copilotRate,
} from '../../../../../lib/cost/copilot-pricing.mjs'

export { CALIBRATED_COPILOT_PRICES, COPILOT_RATE_CARD }

export interface CostRow {
  month: string            // 'YYYY-MM'
  provider: string
  model: string
  process: string
  subscription: string
  /**
   * Which side of the foreground/background split this row is on, derived
   * server-side from user_hash (see FOREGROUND_USER_HASHES in the proxy).
   * Optional so a proxy that predates it degrades to "unattributed" rather
   * than silently counting everything as one side.
   */
  scope?: 'fg' | 'bg'
  calls: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  estimated_calls: number
}

export interface ModelPrice { in: number; out: number; cacheRead: number; cacheWrite: number }

/** What a money figure is shown in. Tokens are not a currency; see TokenUsageUnit. */
export type Currency = 'EUR' | 'USD'

export interface CostConfig {
  /**
   * `usdPerEur` is the FX the euro figure divides by. `usdToEur`
   * is the pre-2026-10 multiplier (0.92), still present in saved settings —
   * read only when `usdPerEur` is absent, see mergeCostConfig.
   */
  currency: { display: string; usdPerEur: number; usdToEur?: number }
  /** List (vendor API) prices — flat-subscription and metered accounts. */
  modelPrices: Record<string, ModelPrice>
  /**
   * GitHub Copilot's own per-model rates, USD/MTok, fitted by
   * scripts/cost/calibrate-copilot-prices.mjs against the itemized consumption
   * sheet. Exact model ids only — an uncalibrated model falls back to its list
   * row rather than to a sibling's calibrated rate, because Copilot's rates do
   * not follow the family (Sonnet 5 bills at n× list, Sonnet 5.5 at ~n×).
   */
  copilotPrices: Record<string, ModelPrice>
  /**
   * Contract discount per budget key, applied to token dollars (0.8 = 20%
   * off). None by default: it is an organisation's contract, set in its
   * settings / glass's cost-defaults.json, never in code.
   */
  discount: Record<string, number>
  /** What the discount is called on screen, per budget key ("contract discount" when absent). */
  discountLabel?: Record<string, string>
  providerScale: Record<string, number>
  copilot: { plan: string; includedCreditsUsd: number; creditUsd: number; overagePrices: string }
  budgets: Record<string, BudgetConfig>
}

/**
 * A subscription's budget.
 *
 * `monthlyEur` is the standing cap. `monthlyEurByMonth` overrides it for named
 * months ('YYYY-MM' -> euros), because a cap is not a constant: this one went
 * step by step during 2026-08 as extensions were approved. Without the
 * history a single editable number would retroactively re-judge every past
 * month against a budget it never had — reporting July as "over" on a cap that
 * did not exist yet, which is worse than not showing a verdict at all.
 *
 * In-month changes are deliberately NOT modelled: the tab's unit is the
 * calendar month, and the number that matters for "did we stay inside it" is
 * the cap in force at month end. A mid-month raise is recorded by setting that
 * month's entry to the new value.
 */
export interface BudgetConfig {
  monthlyEur: number | null
  monthlyEurByMonth?: Record<string, number | null>
  enforce: boolean
  budgetBasis: string
}

/**
 * The budget in force for a given month: the month's own override if it has
 * one, otherwise the standing cap. An explicit `null` override is honoured — it
 * means "no cap that month", which is different from "not recorded".
 */
export function budgetForMonth(b: BudgetConfig | undefined, month: string): number | null {
  if (!b) return null
  const byMonth = b.monthlyEurByMonth
  if (byMonth && Object.prototype.hasOwnProperty.call(byMonth, month)) return byMonth[month] ?? null
  return b.monthlyEur ?? null
}

export const DEFAULT_COST_CONFIG: CostConfig = {
  currency: { display: 'EUR', usdPerEur: 1.18 },
  modelPrices: {
    'claude-haiku-4.5':  { in: 1,   out: 5,   cacheRead: 0.10,  cacheWrite: 1.25 },
    'claude-sonnet-5':   { in: 3,   out: 15,  cacheRead: 0.30,  cacheWrite: 3.75 },
    'claude-sonnet-4.6': { in: 3,   out: 15,  cacheRead: 0.30,  cacheWrite: 3.75 },
    'claude-opus-5':     { in: 5,   out: 25,  cacheRead: 0.50,  cacheWrite: 6.25 },
    'claude-opus-4.8':   { in: 5,   out: 25,  cacheRead: 0.50,  cacheWrite: 6.25 },
    'claude-fable-5':    { in: 10,  out: 50,  cacheRead: 1.00,  cacheWrite: 12.50 },
    'gpt-4o':            { in: 2.5, out: 10,  cacheRead: 1.25,  cacheWrite: 0 },
    'gpt-4o-mini':       { in: 0.15, out: 0.6, cacheRead: 0.075, cacheWrite: 0 },
    'gpt-5':             { in: 1.25, out: 10, cacheRead: 0.125, cacheWrite: 0 },
  },
  copilotPrices: CALIBRATED_COPILOT_PRICES,
  discount: {},
  providerScale: { copilot: 1.0, 'claude-max': 1.0 },
  copilot: { plan: 'business', includedCreditsUsd: 19, creditUsd: 0.01, overagePrices: 'sameAsModelPrices' },
  budgets: {
    // No cap by default: a budget is someone's own (Prices & Budgets / saved
    // settings). A default number here would judge every user against it.
    copilot:      { monthlyEur: null, enforce: true,  budgetBasis: 'gross' },
    'claude-max': { monthlyEur: null, enforce: false, budgetBasis: 'gross' },
  },
}

/**
 * Saved settings over the defaults.
 *
 * The on-disk `cost` block predates `usdPerEur`, `discount` and
 * `copilotPrices`, and the proxy merges it over its own defaults only
 * shallowly — so a block saved last month arrives carrying `currency:
 * { usdToEur: 0.92 }` and no calibrated table. Taking it verbatim would silently
 * undo the calibration on every machine that ever pressed Save.
 *
 * - `copilotPrices`: calibrated defaults, then any saved row (an operator's
 *   edit of one model wins; a model the sheet added later still arrives).
 * - `currency.usdPerEur`: saved if present, else the default. The legacy
 *   `usdToEur` is NOT converted: 0.92 was an untuned placeholder, and inverting
 *   it (1.087) would replace a stated FX with a guess.
 * - `discount`: per key, saved over default.
 */
export function mergeCostConfig(saved: Partial<CostConfig> | null | undefined): CostConfig {
  const s = (saved && typeof saved === 'object') ? saved : {}
  const base = DEFAULT_COST_CONFIG
  return {
    ...base,
    ...s,
    currency: {
      ...base.currency,
      ...(s.currency || {}),
      usdPerEur: Number(s.currency?.usdPerEur) > 0 ? Number(s.currency!.usdPerEur) : base.currency.usdPerEur,
    },
    modelPrices: { ...base.modelPrices, ...(s.modelPrices || {}) },
    copilotPrices: { ...base.copilotPrices, ...(s.copilotPrices || {}) },
    discount: { ...base.discount, ...(s.discount || {}) },
    discountLabel: { ...(base.discountLabel || {}), ...(s.discountLabel || {}) },
    providerScale: { ...base.providerScale, ...(s.providerScale || {}) },
    copilot: { ...base.copilot, ...(s.copilot || {}) },
    budgets: { ...base.budgets, ...(s.budgets || {}) },
  }
}

/**
 * The cost settings a page prices with: the proxy's saved `cost` block where
 * the host has coding's settings API, otherwise glass's /api/cost-defaults
 * (its build's and user's cost files), otherwise the defaults. `settingsApi`
 * says whether the first one answered — the controls that WRITE settings are
 * offered only then.
 */
export async function fetchCostSettings(proxyBase: string): Promise<{
  cfg: CostConfig
  settingsApi: boolean
  settings: Record<string, unknown> | null
}> {
  const get = async (path: string) => {
    try {
      const r = await fetch(`${proxyBase}${path}`)
      return r.ok ? await r.json() : null
    } catch { return null }
  }
  const s = await get('/api/llm/settings')
  if (s?.settings) return { cfg: mergeCostConfig(s.settings.cost), settingsApi: true, settings: s.settings }
  const defaults = await get('/api/cost-defaults')
  return { cfg: mergeCostConfig(defaults), settingsApi: false, settings: null }
}

// ---- Synthetic / test-row filtering -------------------------------------
// The DB carries a handful of demo/probe rows (fake-peer provider, synthetic
// models). They must never enter cost math or they pollute totals.
const SYNTHETIC_MODELS = new Set(['synthetic', '<synthetic>', 'fake-model'])
const SYNTHETIC_PROVIDERS = new Set(['fake-peer'])
export function isSynthetic(r: { model: string; provider: string }): boolean {
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
  haiku: ['claude-haiku-5.5', 'claude-haiku-4.5'],
  sonnet: ['claude-sonnet-5', 'claude-sonnet-4.6'],
  opus: ['claude-opus-5', 'claude-opus-4.8', 'claude-opus-4.6'],
  fable: ['claude-fable-5'],
  'gpt-4o-mini': ['gpt-4o-mini'],
  'gpt-4o': ['gpt-4o'],
  'gpt-5': ['gpt-5'],
  other: [],
}

// ---- Fast mode ----------------------------------------------------------
// The proxy records a fast-mode turn under its own model id, suffixed `-fast`
// (`claude-opus-4.8-fast`). Fast mode is the SAME model at up to 2.5x output
// throughput and premium pricing, so it must not be priced at the standard
// rate: `claude-opus-5` is $5/$25 per MTok, fast mode $10/$50 — exactly 2x.
//
// It is a RULE rather than two more rows because the suffix is orthogonal to
// the model: every current and future fast-capable model would otherwise need
// a hand-maintained twin, and a missing twin fails SILENTLY (the family
// fallback happily prices `…-fast` at the standard rate, `priced: true`, no
// warning). Multiplying the base row cannot go stale that way.
//
// $10/$50 is verified for Claude Opus 5. Opus 4.8 is the only other fast-mode
// model and carries identical standard pricing, so the same 2x is assumed
// rather than documented — if the two tiers ever diverge, give the divergent
// one an explicit `<model>-fast` row, which wins on the exact-match path below.
const FAST_MODE_SUFFIX = '-fast'
const FAST_MODE_MULTIPLIER = 2

function scalePrice(p: ModelPrice, factor: number): ModelPrice {
  return {
    in: p.in * factor,
    out: p.out * factor,
    cacheRead: p.cacheRead * factor,
    cacheWrite: p.cacheWrite * factor,
  }
}

export interface ResolvedPrice { price: ModelPrice; priced: boolean; source: 'exact' | 'family' | 'fast' | 'none' }
export function priceForModel(model: string, prices: Record<string, ModelPrice>): ResolvedPrice {
  const normalized = model
  if (prices[normalized]) return { price: prices[normalized], priced: true, source: 'exact' }
  // Fast mode, before the family fallback: strip the suffix, price the base
  // model by the normal rules, then apply the premium. Checked after the exact
  // match so an explicit `<model>-fast` row still overrides the rule.
  if (normalized.toLowerCase().endsWith(FAST_MODE_SUFFIX)) {
    const base = normalized.slice(0, -FAST_MODE_SUFFIX.length)
    const resolved = priceForModel(base, prices)
    if (resolved.priced) {
      return {
        price: scalePrice(resolved.price, FAST_MODE_MULTIPLIER),
        priced: true,
        source: 'fast',
      }
    }
  }
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

// ---- Provider → billing account -----------------------------------------
/**
 * How an account is charged. Decides the price table and whether a budget,
 * a projection or a "notional" badge means anything for it.
 */
export type AccountKind = 'copilot' | 'flat' | 'local' | 'metered'

/**
 * Providers that cost nothing per token because the hardware is ours — this
 * installation's own (provider-site.ts, empty in glass's build), plus any
 * offload target the read reports in `local_providers` (setLocalProviders).
 * Distinct from a flat subscription like Claude Max, which has a real (if
 * notional per-token) price.
 */
const ZERO_COST_PROVIDERS = new Set(SITE_LOCAL_PROVIDERS)
let reportedLocal = new Set<string>()

/**
 * Accounts the proxy saw serving an offloaded call (`local_providers` on the
 * cost / cells reads). glass names its offload target after the user's own
 * label, so a fixed list cannot recognise it; the data can.
 */
export function setLocalProviders(ids: string[] | undefined): void {
  if (ids) reportedLocal = new Set(ids.map(id => normalizeProvider(id)))
}

/** The account a row is billed to — the page-wide identity (lib/providers). */
export function costAccount(provider: string): string {
  return normalizeProvider(provider) || 'unknown'
}

export function accountKind(account: string): AccountKind {
  const a = normalizeProvider(account)
  if (a === 'gh-copilot') return 'copilot'
  if (a === 'claude-code-max') return 'flat'
  if (ZERO_COST_PROVIDERS.has(a) || reportedLocal.has(a)) return 'local'
  return 'metered'
}

export function isZeroCostProvider(provider: string): boolean {
  return accountKind(provider) === 'local'
}

/**
 * The key an account's budget, discount and scale are stored under. The two
 * original buckets keep their historic keys (`copilot`, `claude-max`) so saved
 * budgets carry over; every other account is keyed by its own id.
 */
export function configKey(account: string): string {
  const a = normalizeProvider(account)
  if (a === 'gh-copilot') return 'copilot'
  if (a === 'claude-code-max') return 'claude-max'
  return a
}

export function accountName(account: string): string {
  return accountLabel(account)
}

// ---- Wire protocol → input-token semantics -------------------------------
// The proxy taps two wire protocols with DIFFERENT cache-accounting semantics
// (see rapid-llm-proxy/src/usage-cache.ts):
//
//   - Anthropic wire (claude-code-max / anthropic): usage.input_tokens EXCLUDES
//     cached tokens — cache_read_input_tokens / cache_creation_input_tokens are
//     genuinely separate counters alongside it.
//   - OpenAI wire (copilot / gh-copilot / opencode / pi-via-copilot):
//     usage.prompt_tokens_details.cached_tokens is a SUBSET of usage.prompt_tokens
//     — cache reads are already included in input_tokens, not additive.
//
// Which wire a provider speaks. No longer needed for pricing — the row shape is
// uniform now (see freshInputTokens) — but kept because the distinction is real
// and the next person to need it should not re-derive it from provider strings.
export function isOpenAIWireProvider(provider: string): boolean {
  const p = (provider || '').toLowerCase()
  return p.includes('copilot') || p === 'github' || p === 'opencode'
}
/**
 * Input tokens to bill at the full (non-cached) rate.
 *
 * Now the identity — `input_tokens` is fresh input on every provider, and this
 * function is kept as the single named place that says so.
 *
 * It used to subtract `cache_read_tokens` for OpenAI-wire rows, correctly:
 * `prompt_tokens` there INCLUDED cache hits, so pricing all of it at the full
 * input rate double-billed the cached share. That compensation is now WRONG,
 * because the proxy subtracts at the parse boundary (openAIFreshInputTokens)
 * and scripts/backfill-openai-wire-cache-split.mjs corrected the historical
 * rows. Subtracting a second time zeroes the fresh input of exactly the rows
 * the fix repaired — a real corrected row reads input=135, cache_read=23,264,
 * and the old expression returned max(0, 135 - 23264) = 0.
 *
 * A compensation for a defect must be removed when the defect is; leaving it in
 * is how one fix becomes two bugs. If a provider ever reports the nested shape
 * again, fix it at the parse boundary, not here.
 */
export function freshInputTokens(r: { input_tokens: number }): number {
  return r.input_tokens
}

// ---- Per-cell cost (USD) ------------------------------------------------

/** Anything with an account, a model and the four token kinds. */
export interface PriceableRow {
  provider: string
  model: string
  /** YYYY-MM of a monthly row: a past month is priced at what GitHub charged then. */
  month?: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
}

/**
 * The price a row is charged at, by account kind.
 *
 * Copilot: GitHub's rate for the model (copilotRate — calibrated table, then
 * the rate card, exact ids). A model GitHub's rate is unknown for falls through
 * to list pricing below.
 */
export function rowPrice(r: { provider: string; model: string; month?: string }, cfg: CostConfig): ResolvedPrice {
  const kind = accountKind(costAccount(r.provider))
  if (kind === 'local') return { price: { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 }, priced: true, source: 'exact' }
  if (kind === 'copilot') {
    const rate = copilotRate(r.model, cfg.copilotPrices, r.month)
    if (rate) return { price: rate, priced: true, source: 'exact' }
  }
  return priceForModel(r.model, cfg.modelPrices)
}

/**
 * Token dollars after the account's contract discount and scale — the USD the
 * account actually costs. Prompt-cache traffic is priced per kind: reads at the
 * cache-read rate (~0.1x input), writes at the write rate (~1.25x); see
 * freshInputTokens for why `input_tokens` is fresh input on every wire.
 */
export function cellCostUsd(r: PriceableRow, cfg: CostConfig): number {
  const p = cellCostParts(r, cfg)
  return p.input + p.output + p.cacheRead + p.cacheWrite
}

/** The same USD, split by token kind — what the in / out / cache views show. */
export interface CostParts { input: number; output: number; cacheRead: number; cacheWrite: number }
export function cellCostParts(r: PriceableRow, cfg: CostConfig): CostParts {
  const { price } = rowPrice(r, cfg)
  const key = configKey(costAccount(r.provider))
  const f = (cfg.discount?.[key] ?? 1) * (cfg.providerScale?.[key] ?? 1) / 1e6
  return {
    input: freshInputTokens(r) * price.in * f,
    output: r.output_tokens * price.out * f,
    cacheRead: r.cache_read_tokens * price.cacheRead * f,
    cacheWrite: r.cache_write_tokens * price.cacheWrite * f,
  }
}

/** USD → the configured display currency (EUR: ÷ usdPerEur; USD: as is). */
export function fromUsd(usd: number, cfg: CostConfig): number {
  if (cfg.currency?.display === 'USD') return usd
  return usd / (cfg.currency?.usdPerEur || 1.18)
}
/** EUR (budgets are kept in EUR) → the display currency. */
export function fromEur(eur: number, cfg: CostConfig): number {
  if (cfg.currency?.display === 'USD') return eur * (cfg.currency?.usdPerEur || 1.18)
  return eur
}

/** The same config, displaying in another currency. */
export function withCurrency(cfg: CostConfig, currency: Currency): CostConfig {
  return cfg.currency?.display === currency ? cfg : { ...cfg, currency: { ...cfg.currency, display: currency } }
}

export function formatMoney(amount: number, currency: Currency | string = 'EUR'): string {
  const sym = currency === 'USD' ? '$' : '€'
  if (!isFinite(amount)) return '—'
  if (amount === 0) return `${sym}0.00`
  if (Math.abs(amount) < 0.01) return `<${sym}0.01`
  if (Math.abs(amount) >= 1000) return `${sym}${(amount / 1000).toFixed(2)}k`
  return `${sym}${amount.toFixed(2)}`
}

// ---- Aggregations -------------------------------------------------------
export type PivotDim = 'provider' | 'model' | 'process'
function dimKey(r: CostRow, dim: PivotDim): string {
  if (dim === 'provider') return accountLabel(costAccount(r.provider))
  if (dim === 'model') return r.model
  return r.process
}

export interface MonthTotal { month: string; costEur: number; byKey: Record<string, number> }
// Cost per month, split by the chosen dimension. Returns months ascending.
export function monthlySeries(rows: CostRow[], cfg: CostConfig, dim: PivotDim): MonthTotal[] {
  const byMonth = new Map<string, MonthTotal>()
  for (const r of rows) {
    if (isSynthetic(r)) continue
    const eur = fromUsd(cellCostUsd(r, cfg), cfg)
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
    const eur = fromUsd(cellCostUsd(r, cfg), cfg)
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
    if (accountKind(costAccount(r.provider)) !== 'copilot') continue
    grossUsd += cellCostUsd(r, cfg)
  }
  const grossEur = fromUsd(grossUsd, cfg)
  // The allowance is credits, so it is discounted like the usage it offsets.
  const includedEur = fromUsd((cfg.copilot?.includedCreditsUsd ?? 0) * (cfg.discount?.copilot ?? 1), cfg)
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

  // 1) Background processes running on an expensive (non-haiku) model this month.
  //    Savings = current cost − cost if the same tokens ran on Haiku 5.5 on
  //    Copilot, which is where the route action sends them — priced at that
  //    account's calibrated rate, not the list rate.
  const perProcess = new Map<string, { costEur: number; haikuEur: number; provider: string; model: string; tokens: number }>()
  for (const r of rows) {
    if (isSynthetic(r) || r.month !== month) continue
    if (!isRoutableBackground(r.process)) continue
    const fam = modelFamily(r.model)
    if (fam === 'haiku') continue // already cheap
    if (accountKind(costAccount(r.provider)) === 'local') continue // already free
    const curEur = fromUsd(cellCostUsd(r, cfg), cfg)
    const haikuEur = fromUsd(cellCostUsd({ ...r, provider: 'gh-copilot', model: 'claude-haiku-5.5' }, cfg), cfg)
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
      detail: `${proc} spent ${formatMoney(p.costEur, cfg.currency.display)} this month on ${modelFamily(p.model)}. Same tokens on Haiku 5.5 (Copilot) ≈ ${formatMoney(p.haikuEur, cfg.currency.display)}.`,
      estSavingsEur: savings,
      action: { type: 'route', process: proc, provider: 'copilot', model: 'claude-haiku-5.5' },
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
      detail: `Consolidation processes cost ${formatMoney(consolTotal, cfg.currency.display)} this month. Increasing the check interval or the undigested threshold reduces how often they run.`,
      estSavingsEur: consolidationEur > 0 ? consolidationEur * 0.3 : consolTotal * 0.2,
      action: { type: 'cadence' },
    })
  }

  return suggestions.sort((a, b) => b.estSavingsEur - a.estSavingsEur)
}

// ---- Foreground / background split --------------------------------------

/**
 * Split a set of rows' cost into the half a human was waiting on and the half
 * that ran on its own.
 *
 * The distinction is the one operational question this page cannot otherwise
 * answer: background work is discretionary — it can be re-routed, re-banded,
 * cached or switched off without anyone noticing — while foreground spend is
 * the cost of the work itself. A single euro figure hides which lever exists.
 *
 * Rows from a proxy that predates the `scope` column count as `unattributed`
 * rather than being assigned to a side. Guessing would make the split look
 * complete when it is not, and the whole point is to decide where to act.
 */
export interface ScopeSplit { fgEur: number; bgEur: number; unattributedEur: number; totalEur: number }

export function splitByScope(rows: CostRow[], cfg: CostConfig): ScopeSplit {
  let fgEur = 0; let bgEur = 0; let unattributedEur = 0
  for (const r of rows) {
    if (isSynthetic(r)) continue
    const eur = fromUsd(cellCostUsd(r, cfg), cfg)
    if (r.scope === 'fg') fgEur += eur
    else if (r.scope === 'bg') bgEur += eur
    else unattributedEur += eur
  }
  return { fgEur, bgEur, unattributedEur, totalEur: fgEur + bgEur + unattributedEur }
}

// ---- Local-hardware savings ---------------------------------------------

/**
 * What the work served by our own hardware WOULD have cost on GitHub Copilot.
 *
 * Priced with the Copilot model at the band the work actually used, because
 * that is the counterfactual: semantic offload displaces a `gh-copilot` call,
 * and the route's own provider is what sits first in its fallback chain. Using
 * the local model's own (zero) price would say nothing, and using the most
 * expensive model would flatter the number.
 *
 * `model` maps through the same family fallback as everything else, so a local
 * `qwen3.8-27b-local` serving the `small` band is priced against the Copilot
 * model that band would otherwise have used — passed in by the caller rather
 * than guessed here, since the band-to-model mapping lives in llm-routing.yaml
 * and this module must not grow a second copy of it.
 *
 * Returns zero, not a negative or a NaN, when nothing ran locally — an honest
 * "no savings yet" rather than an absent tile.
 */
export interface LocalSavings {
  eur: number
  calls: number
  tokens: number
  /** Rows that produced it, so the UI can say WHICH work was displaced. */
  byProcess: Array<{ process: string; eur: number; calls: number }>
}

export function localSavings(
  rows: CostRow[],
  cfg: CostConfig,
  counterfactualModel: string,
): LocalSavings {
  const byProcess = new Map<string, { process: string; eur: number; calls: number }>()
  let eur = 0; let calls = 0; let tokens = 0
  for (const r of rows) {
    if (isSynthetic(r) || !isZeroCostProvider(r.provider)) continue
    // Same row, priced as if gh-copilot had served it.
    const asCopilot: CostRow = { ...r, provider: 'gh-copilot', model: counterfactualModel }
    const rowEur = fromUsd(cellCostUsd(asCopilot, cfg), cfg)
    eur += rowEur
    calls += r.calls
    tokens += r.input_tokens + r.output_tokens + r.cache_read_tokens + r.cache_write_tokens
    const cur = byProcess.get(r.process)
    if (cur) { cur.eur += rowEur; cur.calls += r.calls }
    else byProcess.set(r.process, { process: r.process, eur: rowEur, calls: r.calls })
  }
  return {
    eur, calls, tokens,
    byProcess: Array.from(byProcess.values()).sort((a, b) => b.eur - a.eur),
  }
}

// ---- Money view of the token summary -------------------------------------

/**
 * One row of the summary's opt-in `cells` (GET /api/token-usage/summary?cells=1):
 * a time bucket × process × provider × model with the four token kinds apart.
 */
export interface SummaryCell extends PriceableRow {
  hour: string
  process: string
  calls: number
}

/**
 * Split a cell's cost into named series. Returns [seriesKey, displayAmount]
 * pairs — one per series the cell contributes to (one for process/model/
 * account, four for the token-kind view).
 */
export type CellSplitter = (c: SummaryCell, parts: CostParts) => Array<[string, number]>

/**
 * Re-pivot cells into a zero-filled per-bucket series in the display currency,
 * the same shape as the summary's token pivots (`{ hour, <key>: value }`), so
 * the Evolution chart renders money with the code that renders tokens.
 *
 * `hours` is the summary's own bucket list (by_hour) — the cells only carry
 * populated buckets, and a chart whose x-axis skipped the empty ones would
 * draw a busy afternoon and a silent night as adjacent points.
 */
export function costSeries(
  cells: SummaryCell[], cfg: CostConfig, hours: string[], split: CellSplitter,
): { keys: string[]; rows: Array<Record<string, number | string>> } {
  const byHour = new Map<string, Record<string, number>>()
  const totals = new Map<string, number>()
  for (const c of cells) {
    if (isSynthetic(c)) continue
    const p = cellCostParts(c, cfg)
    const parts: CostParts = {
      input: fromUsd(p.input, cfg), output: fromUsd(p.output, cfg),
      cacheRead: fromUsd(p.cacheRead, cfg), cacheWrite: fromUsd(p.cacheWrite, cfg),
    }
    let slot = byHour.get(c.hour)
    if (!slot) { slot = {}; byHour.set(c.hour, slot) }
    for (const [k, v] of split(c, parts)) {
      slot[k] = (slot[k] || 0) + v
      totals.set(k, (totals.get(k) || 0) + v)
    }
  }
  const keys = [...totals.keys()].sort((a, b) => (totals.get(b) || 0) - (totals.get(a) || 0))
  const rows = hours.map(hour => {
    const slot = byHour.get(hour) || {}
    const row: Record<string, number | string> = { hour }
    for (const k of keys) row[k] = slot[k] || 0
    return row
  })
  return { keys, rows }
}

/** Display-currency totals of a set of cells, grouped by an arbitrary key. */
export function costBy(cells: SummaryCell[], cfg: CostConfig, keyOf: (c: SummaryCell) => string): Map<string, number> {
  const out = new Map<string, number>()
  for (const c of cells) {
    if (isSynthetic(c)) continue
    const k = keyOf(c)
    out.set(k, (out.get(k) || 0) + fromUsd(cellCostUsd(c, cfg), cfg))
  }
  return out
}
