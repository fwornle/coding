import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import { RefreshCw, Zap, TrendingUp, Clock, ArrowUpDown, Settings } from 'lucide-react'
import { normalizeProvider, getProviderColor, accountLabel } from '@/lib/providers'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, Treemap, AreaChart, Area, Brush
} from 'recharts'
import { normalizeModel } from '@/components/performance/models'
import {
  CostConfig, Currency, DEFAULT_COST_CONFIG, SummaryCell, CellSplitter,
  fetchCostSettings, setLocalProviders, withCurrency, formatMoney,
  cellCostUsd, fromUsd, costSeries, costBy, cellCostParts,
} from '@/components/cost/cost-model'

// Loaded on first render only: glass's build shows neither the dialog nor the
// Routing tab (tabs / settings props), and the Cost tab only when opened — none
// belongs in the main chunk; here they cost one fetch.
const TokenUsageSettingsDialog = lazy(() => import('./token-usage-settings-dialog').then((m) => ({ default: m.TokenUsageSettingsDialog })))
const TokenUsageRoutingTab = lazy(() => import('./token-usage-routing-tab').then((m) => ({ default: m.TokenUsageRoutingTab })))
const CostTab = lazy(() => import('@/components/cost/CostTab').then((m) => ({ default: m.CostTab })))
import { AccountsDialog } from '@/components/cost/AccountsDialog'
import { fetchAccountSelection, type AccountSelection, type SourcesControl } from '@/components/cost/account-selection'

/**
 * What every figure on the page is measured in. Tokens are what was consumed;
 * € and $ are what it cost — the same rows priced per account (see
 * cost-model.ts): Copilot at GitHub's per-model rates × any contract discount,
 * € additionally ÷ FX. Remembered per browser: it is a reading preference.
 */
export type TokenUsageUnit = 'tokens' | Currency
const UNIT_STORAGE_KEY = 'token-usage.unit'
function storedUnit(): TokenUsageUnit {
  try {
    const v = localStorage.getItem(UNIT_STORAGE_KEY)
    return v === 'EUR' || v === 'USD' ? v : 'tokens'
  } catch { return 'tokens' }
}

/**
 * The tab a link asked for: `?tab=cost` in the query (the dashboard's routes) or
 * in the hash's query (glass's `#/token-usage?tab=cost`, which its status-line
 * cost field opens). Only a tab this page actually shows counts.
 */
function linkedTab(tabs: TokenUsageTab[]): TokenUsageTab | null {
  const fromSearch = new URLSearchParams(window.location.search).get('tab')
  const hashQuery = window.location.hash.split('?')[1] || ''
  const want = fromSearch || new URLSearchParams(hashQuery).get('tab')
  return want && (tabs as string[]).includes(want) ? want as TokenUsageTab : null
}

const PROXY_PORT = '12435'
const PROXY_BASE = `http://localhost:${PROXY_PORT}`
const REFRESH_INTERVAL = 30_000

/** One Evolution bucket: `hour` plus a number per series key. */
type EvoRow = Record<string, number | string>

/**
 * Hours back to the 1st (UTC) of the month a `windowHours` window starts in —
 * the span month-to-date needs. One hour over: the API takes whole hours, and
 * the partial hour before the 1st falls outside the month and is dropped.
 */
function monthToDateHours(windowHours: number): number {
  const start = new Date(Date.now() - windowHours * 3600_000)
  const first = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)
  return Math.ceil((Date.now() - first) / 3600_000) + 1
}

// Window options for the time-range selector. `value` is what we send as
// ?hours= (the literal string 'all' is a backend sentinel for "everything").
const WINDOW_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '1',   label: 'Last 1h' },
  { value: '24',  label: 'Last 24h' },
  { value: '48',  label: 'Last 48h' },
  { value: '168', label: 'Last 7 days' },
  { value: '720', label: 'Last 30 days' },
  { value: 'all', label: 'All time' },
]


// Stable color palette for the stacked-area Evolution chart. Cycles when
// the number of stacked series exceeds the palette length.
const EVOLUTION_PALETTE = [
  '#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444',
  '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#a855f7',
  '#14b8a6', '#eab308',
]

// Colors for process categories
const PROCESS_COLORS: Record<string, string> = {
  'observation-writer': '#3b82f6',     // blue
  'observation-classifier': '#60a5fa', // lighter blue
  'digest-consolidator': '#8b5cf6',    // purple
  'insight-synthesizer': '#a78bfa',    // lighter purple
  'wave1-project-agent': '#f59e0b',    // amber
  'wave1-topic-agent': '#fbbf24',      // lighter amber
  'content-validation': '#ef4444',     // red
  'entity-refresh': '#f87171',         // lighter red
  'backfill-raw': '#10b981',           // emerald
  'general': '#6b7280',               // gray
  'unknown': '#94a3b8',               // slate — distinct from PROCESS gray and from EVOLUTION_PALETTE[0] blue
  // Process names actually emitted by the live pipeline (the *-consolidator
  // / *-synthesizer entries above are older naming we keep for back-compat
  // with any historical rows still surfacing). Stable colors here so the
  // hash-fallback can't collide on the small SAFE_EVOLUTION_PALETTE.
  'consolidator-digest':  '#8b5cf6',   // purple
  'consolidator-insight': '#ec4899',   // pink
  'health-coordinator':   '#f43f5e',   // rose — distinct from consolidator-digest purple
  'reproject-online':     '#06b6d4',   // cyan
}

// Human-readable label + one-line "what is this" for each token `process` id (the
// cognitive-pipeline stage / agent / adapter that issued the LLM call). The raw ids
// (`consolidator-mentions`, `opencode`, `token-adapter-copilot`…) are opaque; this
// makes the Token-Consumption treemap self-explanatory. Unmapped ids fall back to a
// title-cased id + generic note (processMeta below), and `token-adapter-*` is handled
// by rule so new agents need no map edit.
const PROCESS_META: Record<string, { label: string; desc: string }> = {
  'consolidator-mentions':  { label: 'Consolidator · @mentions', desc: 'Background knowledge consolidation triggered by @mentions in sessions — typically the heaviest consumer.' },
  'consolidator-insight':   { label: 'Consolidator · insights',  desc: 'Synthesizes recurring patterns from observations into KB insight entities.' },
  'consolidator-digest':    { label: 'Consolidator · digests',   desc: 'Rolls session activity up into per-day digests.' },
  'observation-writer':     { label: 'Observation writer',       desc: 'ETM: turns live session transcripts into structured observations.' },
  'observation-resolution': { label: 'Observation resolution',   desc: 'Backfills pronoun/reference antecedents in stored observations (LSL sweep).' },
  'auto-measure-class':     { label: 'Auto-measure · classify',  desc: 'Classifies each measured run into a task class (bugfix / refactor / …).' },
  'auto-measure-title':     { label: 'Auto-measure · title',     desc: 'Generates a short human title for a measured run.' },
  'kb-relevance-judge':     { label: 'KB relevance judge',       desc: 'Injection gate — scores whether KB snippets are relevant before injecting them.' },
  'route-judge':            { label: 'Route judge',              desc: 'Scores agent routing / outcome for the Performance dashboard.' },
  'experiment-preflight':   { label: 'Experiment preflight',     desc: 'Validates model/agent availability before an experiment cell runs.' },
  'health-coordinator':     { label: 'Health coordinator',       desc: 'Periodic system-health probe LLM calls.' },
  // The two the user flagged as opaque: these are FOREGROUND AGENT sessions, not a
  // pipeline stage — and yes, they include /experiment cells run under that agent.
  'opencode':               { label: 'OpenCode agent (fg)',      desc: 'Foreground OpenCode coding sessions — includes experiment cells run under OpenCode.' },
  'copilot':                { label: 'Copilot agent (fg)',       desc: 'Foreground GitHub Copilot coding sessions — includes experiment cells run under Copilot.' },
  'claude':                 { label: 'Claude agent (fg)',        desc: 'Foreground Claude Code sessions — includes experiment cells run under Claude.' },
}
function processMeta(id: string): { label: string; desc: string } {
  if (PROCESS_META[id]) return PROCESS_META[id]
  // token-adapter-<agent>[-variant]: the per-agent foreground token-capture path.
  const adapter = /^token-adapter-(.+)$/.exec(id)
  if (adapter) {
    const who = adapter[1].replace(/-/g, ' ')
    return { label: `Token adapter · ${who}`, desc: `Captures the foreground token usage of ${who} agent calls (file-adapter / BYOK capture path).` }
  }
  return { label: id.replace(/-/g, ' '), desc: 'Cognitive-pipeline process.' }
}

// Palette slots that don't collide with any canonical PROCESS_COLORS value.
// evoColorFor() prefers this subset when hashing non-canonical keys so an
// unknown process can never accidentally render in the same color as a
// known one (e.g. blue observation-writer vs. blue unknown at 1h window).
const CANONICAL_PROCESS_COLOR_SET = new Set(Object.values(PROCESS_COLORS))
const SAFE_EVOLUTION_PALETTE = EVOLUTION_PALETTE.filter(c => !CANONICAL_PROCESS_COLOR_SET.has(c))

// Stable string-to-int hash (djb2-style). Used by evoColorFor so a given
// key always lands on the same palette slot across re-renders.
function hashKey(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h)
}

// Account identity — normalizeProvider, PROVIDER_COLORS, getProviderColor — now
// lives in lib/providers, so this page and the routing dialog's Flow tab group
// and colour an account identically. The wire has carried several names for the
// same account over time, and one name for two DIFFERENT accounts; that file has
// the mapping and the note on why `anthropic` resolves to Max.
//
// The mapping used to collapse to the COMPANY instead — `copilot` → `github`,
// and `claude-code` → `anthropic`. That second one was the damaging mapping: it
// merged personal Max-subscription traffic with metered anthropic-api traffic
// under a single "anthropic" label, so the By Provider pie could read
// "anthropic 100%" while telling you nothing about which account your tokens
// actually came out of — the two have completely different cost consequences.

interface TokenSummary {
  total_calls: number
  total_input: number
  total_output: number
  /**
   * Fresh input + output only. NOT what a window cost.
   *
   * `input_tokens` counts uncached prompt tokens; everything served from a
   * prompt cache lives in the two cache columns. For a foreground Claude Code
   * turn that is almost the entire prompt — measured 2026-08-29, 320.8M cache
   * reads against 57K of fresh input — so ranking or headlining on this field
   * alone understated intensive Opus-5 work by ~450x and put a background
   * classifier at the top of the treemap. Use `allTokens()` for anything the
   * reader will interpret as "how much did this consume".
   */
  total_tokens: number
  total_cache_read?: number
  total_cache_write?: number
  avg_latency_ms: number
  by_process: Array<{
    process: string
    calls: number
    input_tokens: number
    output_tokens: number
    total_tokens: number
    cache_read_tokens?: number
    cache_write_tokens?: number
    avg_latency: number
  }>
  by_provider: Array<{
    provider: string
    calls: number
    input_tokens: number
    output_tokens: number
    total_tokens: number
    cache_read_tokens?: number
    cache_write_tokens?: number
  }>
  // Same aggregate split by the ACCOUNT that served it. Present on proxies that
  // ship the (provider, model) grouping; absent on older ones, which is why the
  // By Model table falls back to `by_model`.
  by_provider_model?: Array<{
    provider: string
    model: string
    calls: number
    total_tokens: number
    cache_read_tokens?: number
    cache_write_tokens?: number
    avg_latency?: number
  }>
  by_model: Array<{
    model: string
    calls: number
    total_tokens: number
    cache_read_tokens?: number
    cache_write_tokens?: number
    avg_latency?: number
    // Phase 66-01 piggyback: per-model median latency over the rolling 24h
    // window. Rides on the existing `summary` response — no new fetch needed.
    p50_latency_ms?: number
    // Phase 66-04: per-model median worker-pool SPAWN/QUEUE overhead (66-03).
    // Numeric for claude-code pool models (sonnet/opus); ABSENT for a model with
    // no non-null overhead rows (haiku direct path, or no recent pool calls).
    // This is the pool-health component PERF-03 grades; p50_latency_ms is kept
    // as total-latency forensic context.
    p50_overhead_ms?: number
  }>
  by_subscription: Array<{
    subscription: string
    calls: number
    total_tokens: number
    cache_read_tokens?: number
    cache_write_tokens?: number
  }>
  by_hour: Array<{
    hour: string
    calls: number
    input_tokens: number
    output_tokens: number
    /** Optional: absent on a proxy that predates per-bucket cache columns. */
    cache_read_tokens?: number
    cache_write_tokens?: number
  }>
  // New in Phase 36 follow-up: pivoted stacked series for the Evolution tab.
  // Each row is one time bucket; each non-`hour` key is a process/model name
  // mapped to its total tokens in that bucket. process_keys / model_keys
  // give the column order (ranked by total tokens descending).
  hours?: number
  bucket_minutes?: number
  /** Opt-in (`?cells=1`): the priceable breakdown the €/$ view is built from. */
  cells?: SummaryCell[]
  local_providers?: string[]
  process_keys?: string[]
  model_keys?: string[]
  provider_keys?: string[]
  by_process_hour?: Array<Record<string, number | string>>
  by_model_hour?: Array<Record<string, number | string>>
  by_provider_hour?: Array<Record<string, number | string>>
}

interface RecentCall {
  id: number
  timestamp: string
  provider: string
  model: string
  process: string
  input_tokens: number
  output_tokens: number
  total_tokens: number
  latency_ms: number
  subscription: string
  prompt_preview: string
  cache_read_tokens?: number
  cache_write_tokens?: number
}

// recharts declares a tooltip formatter's value as `TValue | undefined` (a point
// can be missing), so a `(val: number)` handler is too narrow to satisfy it.
// Coerce once here rather than widening formatTokens, which every other caller
// invokes with a real number.
function toTokenCount(val: unknown): number {
  const n = typeof val === 'number' ? val : Number(val)
  return Number.isFinite(n) ? n : 0
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

// observation-writer (and similar callers) wrap prompts in XML-like tags
// (`<project>`, `<exchange>`, `<user>`, `<assistant>` …) so the LLM can parse
// structure. The tags are intentional in the prompt body but pure noise in the
// 200px-wide dashboard preview column. Strip simple tag tokens and collapse
// resulting whitespace — leave bracketed content like `[Image: ...]` intact.
function stripPromptPreview(s: string): string {
  if (!s) return ''
  return s.replace(/<\/?[a-zA-Z][a-zA-Z0-9-]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function formatLatency(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms)}ms`
}

// Phase 66-02 (D-04): haiku is served on the direct OAuth path, NOT the worker
// pool, so it is a reference baseline — never a pool-health pass/fail signal.
// The by_model rows are model-keyed (no provider on the row), so distinguish
// haiku by canonical model name.
function isHaikuModel(model: string): boolean {
  return /haiku/i.test(model)
}

// Phase 66-02 (D-03): regression threshold envelope for the claude-code fallback
// models (sonnet, opus). Green ≤3000ms (meets the PERF-01 warm bar from Phase 65);
// amber in the 3000<x≤5000 discretion band; red >5000ms (median climbing toward
// the ~14000ms pre-worker-pool baseline). Mirrors health-status-card's
// operational/warning/error idiom.
type LatencyStatus = 'operational' | 'warning' | 'error'
function latencyThresholdStatus(ms: number): LatencyStatus {
  if (ms <= 3000) return 'operational'
  if (ms <= 5000) return 'warning'
  return 'error'
}

// Canonical map first, then hash-based fallback into SAFE_EVOLUTION_PALETTE.
// Keeps Overview Treemap + Recent Calls border colors in sync with the
// Evolution chart legend (evoColorFor uses the same scheme inline).
function getProcessColor(process: string): string {
  const canonical = PROCESS_COLORS[process]
  if (canonical) return canonical
  const palette = SAFE_EVOLUTION_PALETTE.length > 0 ? SAFE_EVOLUTION_PALETTE : EVOLUTION_PALETTE
  return palette[hashKey(process) % palette.length]
}

// Merge by_provider rows that resolve to the same canonical provider (copilot +
// github-copilot, anthropic + claude-code), summing their token/call totals so
// each provider appears exactly once. Sorted by total tokens descending to keep
// the pie/legend ordering stable after the merge.
function mergeByProvider(rows: TokenSummary['by_provider']): TokenSummary['by_provider'] {
  const acc = new Map<string, TokenSummary['by_provider'][number]>()
  for (const r of rows) {
    const provider = normalizeProvider(r.provider)
    const cur = acc.get(provider)
    if (cur) {
      cur.calls += r.calls
      cur.input_tokens += r.input_tokens
      cur.output_tokens += r.output_tokens
      cur.total_tokens += r.total_tokens
      // Summed like every other counter. Dropping them here would reintroduce
      // the undercount downstream of the alias merge only — the subtlest
      // possible version of this bug.
      cur.cache_read_tokens = (cur.cache_read_tokens || 0) + (r.cache_read_tokens || 0)
      cur.cache_write_tokens = (cur.cache_write_tokens || 0) + (r.cache_write_tokens || 0)
    } else {
      acc.set(provider, { ...r, provider })
    }
  }
  return Array.from(acc.values()).sort((a, b) => b.total_tokens - a.total_tokens)
}

// Merge by_model rows whose names differ only in the version separator
// (claude-opus-4-8 vs claude-opus-4.8 — see normalizeModel) into one canonical
// model, summing token and call totals. Latency percentiles are dropped: the
// By Model list shows totals only, and re-weighting medians across the merged
// rows would be misleading here.
//
// Keyed by (provider, model), not model alone. A bare model name does not tell
// you what a call cost: claude-sonnet-5 on the corporate Copilot contract and
// the same model on a metered Anthropic key are entirely different money. Rows
// render as `<provider>/<model>` — the naming used in the routing config, the
// proxy logs and the docs, so the same call is called the same thing everywhere.
//
// Falls back to the older model-keyed `by_model` when the proxy predates
// `by_provider_model`, in which case the provider reads "unknown" rather than
// the table silently attributing tokens to an account that may not have served
// them.
type MergedModel = {
  key: string; provider: string; model: string; calls: number;
  total_tokens: number; cache_read_tokens: number; cache_write_tokens: number;
}

function mergeByModel(
  rows: TokenSummary['by_provider_model'] | TokenSummary['by_model']
): MergedModel[] {
  const acc = new Map<string, MergedModel>()
  for (const r of rows as Array<{
    provider?: string; model: string; calls: number; total_tokens: number;
    cache_read_tokens?: number; cache_write_tokens?: number;
  }>) {
    const model = normalizeModel(r.model) || r.model
    const provider = r.provider ? normalizeProvider(r.provider) : 'unknown'
    const key = `${provider}/${model}`
    const cur = acc.get(key)
    if (cur) {
      cur.calls += r.calls
      cur.total_tokens += r.total_tokens
      cur.cache_read_tokens += r.cache_read_tokens || 0
      cur.cache_write_tokens += r.cache_write_tokens || 0
    } else {
      acc.set(key, {
        key, provider, model, calls: r.calls, total_tokens: r.total_tokens,
        cache_read_tokens: r.cache_read_tokens || 0,
        cache_write_tokens: r.cache_write_tokens || 0,
      })
    }
  }
  // Ranked by CONSUMPTION. Sorting on total_tokens put claude-opus-5 fourth in
  // a window it dominated, because its prompt arrives as cache reads.
  return Array.from(acc.values()).sort((a, b) => allTokens(b) - allTokens(a))
}

/**
 * Everything a row consumed: fresh input + output + prompt-cache traffic.
 *
 * `total_tokens` is fresh input + output ONLY. That is the right number for
 * "what did we newly send and receive", and the wrong one for every question a
 * reader of this page is actually asking — which process dominates, which model
 * is doing the work, how big was this window. Prompt-cache reads are real
 * tokens: they are sent, they are charged (at a discount), and on the Anthropic
 * wire they are nearly the whole prompt.
 *
 * Measured 2026-08-29 over 24h, the difference between the two readings:
 *
 *   token-adapter-claude (foreground Opus-5)  726K by total_tokens   331M with cache
 *   consolidator-mentions (background)         1.4M by total_tokens    52M with cache
 *
 * Headlining `total_tokens` put a background classifier at the top of the
 * treemap and made the day's dominant consumer — intensive foreground Claude
 * Code — nearly invisible. Cache tokens are counted at full weight here because
 * this axis is consumption, not cost; the Cost tab prices them separately.
 *
 * Tolerant of a proxy that predates the cache columns: absent fields read as 0
 * and the result degrades to exactly the old number.
 */
function allTokens(row: { total_tokens: number; cache_read_tokens?: number; cache_write_tokens?: number }): number {
  return (row.total_tokens || 0) + (row.cache_read_tokens || 0) + (row.cache_write_tokens || 0)
}

// Custom treemap content for process breakdown
function TreemapContent(props: {
  x: number; y: number; width: number; height: number;
  name: string; value: number; fill: string; display?: string
}) {
  const { x, y, width, height, name, value, fill, display } = props
  if (width < 40 || height < 30) return null
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={fill} stroke="#1e1e2e" strokeWidth={2} rx={4} />
      {width > 60 && height > 40 && (
        <>
          <text x={x + 8} y={y + 18} fill="#fff" fontSize={12} fontWeight={600}>
            {processMeta(name).label}
          </text>
          <text x={x + 8} y={y + 34} fill="rgba(255,255,255,0.7)" fontSize={11}>
            {display ?? `${formatTokens(value)} tokens`}
          </text>
        </>
      )}
    </g>
  )
}

// Custom tooltip for the process treemap — shows process name + total + in/out split + calls + avg latency.
// Receives `{ active, payload }` from recharts; payload[0].payload is the original treemapData leaf.
function TreemapTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: any }> }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="bg-background border rounded-md shadow-md px-3 py-2 text-sm space-y-0.5 max-w-xs">
      <div className="font-semibold">{processMeta(d.name).label}</div>
      <div className="text-[11px] text-muted-foreground leading-snug">{processMeta(d.name).desc}</div>
      <div className="text-[10px] text-muted-foreground/70 font-mono">id: {d.name}</div>
      <div className="text-muted-foreground text-xs pt-0.5">
        {d.display ? <><span className="font-medium text-foreground">{d.display}</span> · {formatTokens(d.tokens)} tokens</> : <>{formatTokens(d.value)} tokens total</>}
      </div>
      <div className="text-xs">
        <span className="text-blue-500">{formatTokens(d.input ?? 0)} in</span>
        {' · '}
        <span className="text-green-500">{formatTokens(d.output ?? 0)} out</span>
      </div>
      <div className="text-muted-foreground text-xs">
        {d.calls} {d.calls === 1 ? 'call' : 'calls'}
        {typeof d.avgLatency === 'number' && (
          <> · avg {(d.avgLatency / 1000).toFixed(1)}s</>
        )}
      </div>
    </div>
  )
}

export type TokenUsageTab = 'overview' | 'evolution' | 'cost' | 'recent' | 'routing'
const ALL_TABS: TokenUsageTab[] = ['overview', 'evolution', 'cost', 'recent', 'routing']

/**
 * proxyBase: where the token-usage reads live — '' for same-origin (glass's daemon
 * serves the page itself). tabs / settings: glass shows a subset (no Routing
 * tab, no LLM Routing dialog). onSettings: the Settings button opens the caller's own dialog
 * instead of this proxy's LLM Routing one (glass: its offload settings).
 */
export function TokenUsagePage({ proxyBase = PROXY_BASE, tabs = ALL_TABS, settings = true, onSettings, coverage, sources, writeHeaders }: {
  proxyBase?: string
  tabs?: TokenUsageTab[]
  settings?: boolean
  onSettings?: () => void
  /** Passed to the Cost tab: what the figures cover when it is not the whole account. */
  coverage?: { short: string; long: string }
  /** Other tools' figures the caller can add (glass: coding's); shown in the Accounts dialog. */
  sources?: SourcesControl
  /** Extra headers on settings writes (glass's daemon wants its UI's). */
  writeHeaders?: Record<string, string>
} = {}) {
  const has = (tab: TokenUsageTab) => tabs.includes(tab)
  const [activeTab, setActiveTab] = useState<string>(() => linkedTab(tabs) ?? tabs[0])
  // glass re-uses an open UI tab and only changes its hash, so a click on the
  // status line's cost field must switch the tab of a page already showing.
  useEffect(() => {
    const onHash = () => { const t = linkedTab(tabs); if (t) setActiveTab(t) }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [tabs])
  const [summary, setSummary] = useState<TokenSummary | null>(null)
  const [recent, setRecent] = useState<RecentCall[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Which accounts count (saved per machine, applied by the proxy to every read).
  // Bumping accountsRev refetches this page and the Cost tab after a change.
  const [accountSel, setAccountSel] = useState<AccountSelection | null>(null)
  const [accountsOpen, setAccountsOpen] = useState(false)
  const [accountsRev, setAccountsRev] = useState(0)
  const hiddenAccounts = accountSel?.excluded.length ?? 0
  const [unit, setUnitState] = useState<TokenUsageUnit>(storedUnit)
  const setUnit = (u: TokenUsageUnit) => {
    setUnitState(u)
    try { localStorage.setItem(UNIT_STORAGE_KEY, u) } catch { /* a preference, not state */ }
  }
  const money = unit !== 'tokens'
  // Prices/discount/FX: the proxy's saved `cost` settings where it has them,
  // the calibrated defaults otherwise (glass has no settings API).
  const [costCfg, setCostCfg] = useState<CostConfig>(DEFAULT_COST_CONFIG)
  // Time window for the summary endpoint. '24'/'48'/'168'/'720' are hour
  // counts; 'all' is a backend sentinel that picks every retained row.
  const [hoursWindow, setHoursWindow] = useState<string>('24')
  /**
   * Which side of the foreground/background split to show. Both by default —
   * the page's job is to describe everything the machine spent.
   *
   * Applied SERVER-SIDE (`?scope=`), so the headline, the breakdowns and the
   * stacked series always describe the same rows. Filtering only the chart would
   * leave a total that disagrees with what is plotted under it, which is a
   * worse failure than not offering the filter.
   *
   * Unchecking both is treated as `both` rather than showing an empty page:
   * "show me nothing" is never the intent behind clearing two checkboxes.
   */
  const [showFg, setShowFg] = useState(true)
  const [showBg, setShowBg] = useState(true)
  const scopeParam = (showFg && showBg) || (!showFg && !showBg) ? 'both' : (showFg ? 'fg' : 'bg')
  // Evolution chart can stack tokens by process (purpose) or by model.
  const [evoGroupBy, setEvoGroupBy] = useState<'process' | 'model' | 'provider' | 'tokens'>('process')
  const [evoStackMode, setEvoStackMode] = useState<'stacked' | 'overlapping'>('stacked')
  // Linear hides anything small next to a big series: qwen-local's 75.3K against
  // claude-code-max's 400M is a third of a pixel. A log axis is the only way to
  // read KB and MB traffic on one chart.
  const [evoYScale, setEvoYScale] = useState<'linear' | 'log'>('linear')
  // Month-to-date: each series as a running total that restarts on the 1st (UTC,
  // the month the Cost tab and the bill use), so a provider's spend reads as a
  // rising line against its budget instead of a field of spikes.
  const [evoAccumulate, setEvoAccumulate] = useState(false)
  // The month's run-up for month-to-date: hourly buckets from the 1st (UTC) of
  // the window's first month. Hourly, not the window's 2-minute buckets — a
  // month of those is ~27MB per 30s refresh, and only the totals are used.
  // Tagged with the request it answers, so a run-up from another window,
  // scope or unit is never added to this one's buckets.
  const [mtd, setMtd] = useState<{ key: string; summary: TokenSummary } | null>(null)
  const mtdKey = `${hoursWindow}|${scopeParam}|${money ? 'cells' : 'tokens'}`
  const [evoHidden, setEvoHidden] = useState<Set<string>>(new Set())
  const toggleEvoSeries = (key: string) => {
    setEvoHidden(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchData = useCallback(async (isAuto = false) => {
    if (!isAuto) setLoading(true)
    setError(null)
    try {
      const mtdHours = evoAccumulate && hoursWindow !== 'all' ? monthToDateHours(Number(hoursWindow)) : 0
      const [sumRes, recRes, setRes, accRes, mtdRes] = await Promise.all([
        fetch(`${proxyBase}/api/token-usage/summary?hours=${encodeURIComponent(hoursWindow)}&scope=${scopeParam}${money ? '&cells=1' : ''}`),
        fetch(`${proxyBase}/api/token-usage/recent?limit=50`),
        money ? fetchCostSettings(proxyBase) : Promise.resolve(null),
        fetchAccountSelection(proxyBase),
        // Optional: without it the chart says it is a running total from the
        // window's edge rather than failing the page.
        mtdHours
          ? fetch(`${proxyBase}/api/token-usage/summary?hours=${mtdHours}&bucketMinutes=60&scope=${scopeParam}${money ? '&cells=1' : ''}`)
            .then(r => (r.ok ? r.json() as Promise<TokenSummary> : null)).catch(() => null)
          : Promise.resolve(null),
      ])
      if (!sumRes.ok || !recRes.ok) throw new Error(`HTTP ${sumRes.status}/${recRes.status}`)
      const sumData = await sumRes.json()
      const recData = await recRes.json()
      if (setRes) setCostCfg(setRes.cfg)
      setLocalProviders(sumData.local_providers)
      setSummary(sumData)
      setMtd(mtdRes ? { key: mtdKey, summary: mtdRes } : null)
      setAccountSel(accRes)
      setRecent(recData.data || [])
    } catch (err) {
      setError(`Failed to load token usage. Check that the LLM proxy is running at ${proxyBase || window.location.origin}.`)
    } finally {
      setLoading(false)
    }
  }, [hoursWindow, scopeParam, proxyBase, money, evoAccumulate, mtdKey, accountsRev])

  useEffect(() => {
    fetchData()
    intervalRef.current = setInterval(() => fetchData(true), REFRESH_INTERVAL)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [fetchData])

  if (loading && !summary) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error && !summary) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    )
  }

  if (!summary) return null

  // Canonicalized provider/model breakdowns: alias-merged providers and
  // punctuation-merged models, so the By Provider pie and By Model list count
  // each provider/model exactly once (see mergeByProvider / mergeByModel).
  const byProvider = mergeByProvider(summary.by_provider)
  const byModel = mergeByModel(summary.by_provider_model ?? summary.by_model)

  // ---- €/$ view -----------------------------------------------------------
  // Every money figure comes from the same `cells` the server derived from the
  // same rows as the token aggregates above, priced per account. `cells` is
  // absent for a frame after switching unit (the refetch is in flight) and on
  // a proxy that predates it; `priced` is false then and the page keeps
  // showing tokens rather than zeros.
  const cells = summary.cells
  const priced = money && Array.isArray(cells)
  const cfg = withCurrency(costCfg, unit === 'USD' ? 'USD' : 'EUR')
  const fmtMoney = (v: number) => formatMoney(v, unit === 'USD' ? 'USD' : 'EUR')
  const costByProcess = priced ? costBy(cells!, cfg, c => c.process) : null
  const costByAccount = priced ? costBy(cells!, cfg, c => normalizeProvider(c.provider)) : null
  const costByAccountModel = priced ? costBy(cells!, cfg, c => `${normalizeProvider(c.provider)}/${normalizeModel(c.model) || c.model}`) : null
  const costTotal = priced ? [...costByAccount!.values()].reduce((a, b) => a + b, 0) : 0
  const costKinds = priced ? cells!.reduce((acc, c) => {
    const p = cellCostParts(c, cfg)
    acc.input += fromUsd(p.input, cfg); acc.output += fromUsd(p.output, cfg)
    acc.cached += fromUsd(p.cacheRead + p.cacheWrite, cfg)
    return acc
  }, { input: 0, output: 0, cached: 0 }) : null
  // The page's one formatter for an axis value: money when priced, else tokens.
  const fmtValue = (v: number) => (priced ? fmtMoney(v) : formatTokens(v))
  const accountValue = (p: { provider: string; total_tokens: number; cache_read_tokens?: number; cache_write_tokens?: number }) =>
    priced ? (costByAccount!.get(p.provider) || 0) : allTokens(p)

  // Prepare treemap data for process breakdown
  const processValue = (p: TokenSummary['by_process'][number]) =>
    priced ? (costByProcess!.get(p.process) || 0) : allTokens(p)
  const treemapData = summary.by_process
    .filter(p => processValue(p) > 0)
    .sort((a, b) => processValue(b) - processValue(a))
    .map(p => ({
      name: p.process,
      // Area is total CONSUMPTION, cache included — see allTokens(). Sizing on
      // total_tokens alone made this chart say the opposite of the truth. In
      // the €/$ view it is cost, which is a different ranking: a cheap model's
      // big process can be a small rectangle.
      value: processValue(p),
      display: priced ? fmtMoney(processValue(p)) : undefined,
      tokens: allTokens(p),
      cacheRead: p.cache_read_tokens || 0,
      cacheWrite: p.cache_write_tokens || 0,
      fill: getProcessColor(p.process),
      calls: p.calls,
      avgLatency: p.avg_latency,
      input: p.input_tokens,
      output: p.output_tokens,
    }))

  // Sort process table
  // Evolution chart data. Picks process-stacked vs model-stacked from the
  // toggle. The backend's process_keys/model_keys include every value seen
  // in the window (incl. test/reap-* / fake-* outliers); restrict to the
  // "main consumers" — series contributing at least 0.5% of the window's
  // total tokens — so the legend and stacked area stay focused.
  const evoCanon = (key: string): string =>
    evoGroupBy === 'provider' ? normalizeProvider(key)
    : evoGroupBy === 'model' ? (normalizeModel(key) || key)
    : key
  // One summary's Evolution series for the current grouping and unit. A
  // function of the summary because month-to-date builds the run-up from the
  // 1st (a second, hourly summary) through exactly the same path.
  const evoSeriesOf = (s: TokenSummary): { keys: string[]; rows: EvoRow[] } => {
    let evoKeysSrc: string[] =
      evoGroupBy === 'process' ? (s.process_keys || [])
      : evoGroupBy === 'model' ? (s.model_keys || [])
      : evoGroupBy === 'provider' ? (s.provider_keys || [])
      // Three series, not two. Prompt-cache reads are the overwhelming majority
      // of what a foreground turn sends — 197M of a 205M window — and they are
      // billed, at a discount. Showing only input/output made the chart describe
      // a rounding error and said nothing about what the spend actually consists
      // of. Split out rather than folded into `input` because the three are
      // priced differently: cache reads ~10% of the input rate, cache writes ~125%.
      : ['input', 'output', 'cached', 'cacheWrite']
    let evoSeriesSrc: Array<Record<string, any>> =
      evoGroupBy === 'process' ? (s.by_process_hour || [])
      : evoGroupBy === 'model' ? (s.by_model_hour || [])
      : evoGroupBy === 'provider' ? (s.by_provider_hour || [])
      : (s.by_hour || []).map(h => ({
        hour: h.hour,
        input: h.input_tokens,
        output: h.output_tokens,
        cached: h.cache_read_tokens ?? 0,
        cacheWrite: h.cache_write_tokens ?? 0,
      }))
    // Canonicalize the Evolution series exactly like the Overview By Provider/By
    // Model breakdowns: provider aliases (copilot/github-copilot → github) and
    // model punctuation variants (claude-opus-4-8 → claude-opus-4.8) collapse into
    // ONE stacked series, summing each bucket's tokens. process/tokens grouping is
    // untouched (evoCanon is identity there).
    if (priced && Array.isArray(s.cells)) {
      const splitters: Record<typeof evoGroupBy, CellSplitter> = {
        process: (c, p) => [[c.process, p.input + p.output + p.cacheRead + p.cacheWrite]],
        model: (c, p) => [[c.model, p.input + p.output + p.cacheRead + p.cacheWrite]],
        provider: (c, p) => [[c.provider, p.input + p.output + p.cacheRead + p.cacheWrite]],
        tokens: (_c, p) => [['input', p.input], ['output', p.output], ['cached', p.cacheRead], ['cacheWrite', p.cacheWrite]],
      }
      const series = costSeries(s.cells!, cfg, (s.by_hour || []).map(h => String(h.hour)), splitters[evoGroupBy])
      evoKeysSrc = evoGroupBy === 'tokens' ? ['input', 'output', 'cached', 'cacheWrite'] : series.keys
      evoSeriesSrc = series.rows
    }
    const keys: string[] = Array.from(new Set(evoKeysSrc.map(evoCanon)))
    const rows: EvoRow[] = evoSeriesSrc.map(row => {
      const out: EvoRow = {}
      for (const [k, v] of Object.entries(row)) {
        if (typeof v !== 'number') { out[k] = v; continue }  // 'hour' + any stray metadata
        const ck = evoCanon(k)
        out[ck] = Number(out[ck] || 0) + v
      }
      return out
    })
    return { keys, rows }
  }
  const { keys: evoKeysRaw, rows: evoSeriesRaw } = evoSeriesOf(summary)
  // Month-to-date starts on the 1st, not at the window's left edge: summed from
  // the edge, a 24h window called "month-to-date" was just the last day. The
  // run-up — the 1st up to the edge — is month-from-the-1st minus the window's
  // own buckets of that month. Hourly buckets align with the 1st (00:00 UTC),
  // so the partial hour before it drops out exactly; subtracting totals rather
  // than matching buckets makes the window's partial first bucket a non-issue.
  // 'all' needs no run-up: nothing precedes the first row.
  const evoSeed = new Map<string, number>()
  let evoSeedMonth = ''
  const evoSeedOk = !evoAccumulate || hoursWindow === 'all'
    || (mtd?.key === mtdKey && (!priced || Array.isArray(mtd.summary.cells)))
  if (evoAccumulate && hoursWindow !== 'all' && evoSeedOk && evoSeriesRaw.length) {
    evoSeedMonth = String(evoSeriesRaw[0].hour).slice(0, 7)
    const add = (rows: EvoRow[], sign: number) => {
      for (const row of rows) {
        if (String(row.hour).slice(0, 7) !== evoSeedMonth) continue
        for (const [k, v] of Object.entries(row)) {
          if (typeof v === 'number') evoSeed.set(k, (evoSeed.get(k) || 0) + sign * v)
        }
      }
    }
    add(evoSeriesOf(mtd!.summary).rows, 1)
    add(evoSeriesRaw, -1)
    // Both sides are the same rows read twice a few ms apart; a call landing
    // in between, or float residue, must not draw a negative start.
    for (const [k, v] of evoSeed) evoSeed.set(k, Math.max(0, v))
  }
  // A series that spent earlier in the month but not inside the window still
  // has a month-to-date line: flat at what it spent.
  for (const [k, v] of evoSeed) if (v > 0 && !evoKeysRaw.includes(k)) evoKeysRaw.push(k)
  // Denominator for the "main consumer" threshold. The series it is compared
  // against are cache-inclusive (the server folds cache into the hourly
  // pivots), so this must be too — otherwise every share reads far above 100%
  // and the threshold stops excluding anything.
  const evoGrandTotal = (priced ? costTotal : allTokens({
    total_tokens: summary.total_tokens,
    cache_read_tokens: summary.total_cache_read,
    cache_write_tokens: summary.total_cache_write,
  })) || 1
  const evoKeyTotals = new Map<string, number>()
  for (const k of evoKeysRaw) {
    let t = 0
    for (const row of evoSeriesRaw) t += Number(row[k] || 0)
    evoKeyTotals.set(k, t)
  }
  // Every series is shown. There used to be a 0.5% "main consumer" threshold
  // here, to keep the legend short. It hid the things most worth seeing: it
  // dropped qwen-local, the free on-prem offload target, at 75.3K against 435.9M
  // (0.017%) — so the one provider whose ADOPTION you are trying to read could
  // never appear on the chart meant to show it, however much work it took on.
  // The page contradicted itself too: the Account card and the Total Calls
  // breakdown both listed On-prem Qwen while the chart said it did not exist.
  //
  // The legend it was protecting is not big: measured over 24h, 14 processes,
  // 4 models, 4 providers. Pair this with the log Y scale below — a small series
  // is unreadable on a linear axis next to a 400M one, which is the actual
  // problem the threshold was working around.
  const evoKeys = evoKeysRaw
    // Composition keeps its natural reading order (what we sent, what came
    // back, what was cached); everything else ranks by size.
    .sort((a, b) => (evoGroupBy === 'tokens'
      ? ['input', 'output', 'cached', 'cacheWrite'].indexOf(a) - ['input', 'output', 'cached', 'cacheWrite'].indexOf(b)
      : (evoKeyTotals.get(b) || 0) - (evoKeyTotals.get(a) || 0)))
  // Stacking and a log axis cannot both be true. A stack encodes a value as the
  // HEIGHT of a band, and height is not preserved under log — log(a+b) is not
  // log(a)+log(b) — so the bands would render as areas whose thickness means
  // nothing. Worse for the case that motivates log at all: a 75.3K series
  // stacked on top of a 400M one sits at the very top of the axis, exactly where
  // it is least readable. Overlapping draws every series from the axis floor, so
  // a small one is visible on its own terms. Log therefore forces overlap rather
  // than silently drawing a misleading stack.
  const evoStacked = evoStackMode === 'stacked' && evoYScale === 'linear'
  // Bucket label format adapts to window width — short windows show HH:MM,
  // multi-day windows show MM/DD HH:MM so the X-axis stays readable.
  const isMultiDay = (summary.hours ?? 24) > 36
  const running = new Map<string, number>(evoSeed)
  let runningMonth = evoSeedMonth
  const evoData = evoSeriesRaw.map(row => {
    const d = new Date(String(row.hour))
    const month = String(row.hour).slice(0, 7)
    if (evoAccumulate && month !== runningMonth) { running.clear(); runningMonth = month }
    const label = isMultiDay
      ? `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
      : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
    const out: Record<string, number | string | null> = { label }
    for (const k of evoKeys) {
      let v = Number(row[k] || 0)
      if (evoAccumulate) { v += running.get(k) || 0; running.set(k, v) }
      // log(0) is undefined, so a zero bucket cannot be plotted. null renders as
      // a gap, which is what it is — a bucket with no traffic. Substituting a
      // floor value instead would draw a continuous baseline that reads as
      // "always a little activity" and is a lie about a sparse series.
      // Money's log floor is a hundredth of a cent, tokens' is one token.
      out[k] = (evoYScale === 'log' && v <= (priced ? 0.0001 : 0)) ? null : v
    }
    return out
  })
  const evoColorFor = (key: string, _idx: number): string => {
    // Process colors are stable: canonical map first, then a hash of the
    // key into a "safe palette" that excludes any color already used by
    // PROCESS_COLORS. Hashing (instead of stack-index lookup) keeps a
    // given key's color identical across re-renders even when the set of
    // visible series changes — e.g. switching from 24h to 1h dropped
    // 'unknown' from EVOLUTION_PALETTE[4] to [0] and made it collide with
    // observation-writer. Models share the same logic so model series also
    // keep stable colors.
    if (evoGroupBy === 'tokens') {
      if (key === 'input')  return '#3b82f6'   // blue (matches former Timeline tab)
      if (key === 'output') return '#10b981'   // emerald
      // Violet, matching the "cached" figure in the Total Tokens card, so the
      // headline and the chart name the same quantity the same way.
      if (key === 'cached') return '#8b5cf6'
      if (key === 'cacheWrite') return '#c4b5fd' // paler violet — same family, smaller share
    }
    if (evoGroupBy === 'process') {
      const canonical = PROCESS_COLORS[key]
      if (canonical) return canonical
    }
    // Provider series share the Overview pie's palette so `github`/`anthropic`
    // read the same color in both places.
    if (evoGroupBy === 'provider') return getProviderColor(key)
    const palette = SAFE_EVOLUTION_PALETTE.length > 0 ? SAFE_EVOLUTION_PALETTE : EVOLUTION_PALETTE
    return palette[hashKey(key) % palette.length]
  }
  const windowLabel = WINDOW_OPTIONS.find(o => o.value === hoursWindow)?.label || hoursWindow

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Token Usage</h1>
          <p className="text-sm text-muted-foreground">
            LLM token consumption across all cognitive processes
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Foreground / background. Both on by default. The pair is the one
              operational question the rest of the page cannot answer: background
              work is discretionary — re-route it, re-band it, cache it, switch it
              off — while foreground spend is the cost of the work itself. */}
          <div className="flex items-center gap-3 rounded border px-2.5 h-9 text-xs">
            <label className="flex items-center gap-1.5 cursor-pointer" title="Turns a human was waiting on: the coding agents (claude, pi, opencode, copilot).">
              <input type="checkbox" className="accent-primary" checked={showFg} onChange={e => setShowFg(e.target.checked)} />
              foreground
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer" title="Everything that runs on its own: consolidation, observation writing, titles, judges, health probes.">
              <input type="checkbox" className="accent-primary" checked={showBg} onChange={e => setShowBg(e.target.checked)} />
              background
            </label>
            {!showFg && !showBg && (
              <span className="text-muted-foreground" title="Clearing both shows everything rather than nothing — 'show me no data' is not what clearing two checkboxes means.">showing both</span>
            )}
          </div>
          {/* Tokens / € / $ for every view on the page, the Cost tab included. */}
          <div className="flex items-center rounded border h-9 p-0.5 text-xs" role="radiogroup" aria-label="Unit">
            {([['tokens', 'Tokens'], ['EUR', '€'], ['USD', '$']] as Array<[TokenUsageUnit, string]>).map(([u, label]) => (
              <button
                key={u}
                role="radio"
                aria-checked={unit === u}
                onClick={() => setUnit(u)}
                title={u === 'tokens' ? 'Show token consumption'
                  : u === 'EUR' ? 'Show cost in EUR — GitHub Copilot: token $ × contract discount ÷ FX'
                  : 'Show cost in USD — GitHub Copilot: token $ × contract discount (no FX)'}
                className={`px-2.5 h-full rounded-sm ${unit === u ? 'bg-muted font-medium' : 'text-muted-foreground hover:text-foreground'}`}
              >{label}</button>
            ))}
          </div>
          <Select value={hoursWindow} onValueChange={setHoursWindow}>
            <SelectTrigger className="w-[140px] h-9" title="Time window">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WINDOW_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {accountSel && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAccountsOpen(true)}
              title={hiddenAccounts ? `${accountSel.excluded.join(', ')} left out of every figure on this page` : 'Which accounts count — all of them'}
              className={hiddenAccounts ? 'border-amber-400 text-amber-700' : ''}
            >
              Accounts{hiddenAccounts ? ` · ${hiddenAccounts} hidden` : ''}
            </Button>
          )}
          {(settings || onSettings) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => (onSettings ? onSettings() : setSettingsOpen(true))}
              title={onSettings ? 'Where calls go: offload easy calls to your own endpoint' : 'Provider/model routing per service'}
            >
              <Settings className="h-4 w-4 mr-2" />
              Settings
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchData()}
            disabled={loading}
            aria-busy={loading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </div>

      <AccountsDialog
        open={accountsOpen}
        onOpenChange={setAccountsOpen}
        proxyBase={proxyBase}
        selection={accountSel}
        onSaved={(next) => { setAccountSel(next); setAccountsRev(r => r + 1) }}
        sources={sources}
        writeHeaders={writeHeaders}
      />

      {settings && (
        <Suspense fallback={null}>
          <TokenUsageSettingsDialog
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            proxyBase={proxyBase}
            hours={Number(hoursWindow) || 24}
          />
        </Suspense>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            {/* The window in the title: these cards follow it, the Cost tab follows the
                calendar month — unlabelled, €2.30 (24h) over a €18.77 month read as a bug. */}
            <CardDescription>{priced ? 'Total Cost' : 'Total Tokens'} · {windowLabel}</CardDescription>
            <CardTitle className="text-3xl">
              {priced
                ? fmtMoney(costTotal)
                : formatTokens(summary.total_tokens + (summary.total_cache_read || 0) + (summary.total_cache_write || 0))}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* The split is shown because the headline is now dominated by cache
                reads on any day with heavy foreground work, and a reader who
                cannot see that will mistrust the number — rightly, since the
                three parts are priced very differently. */}
            {priced ? (
            <div className="text-xs text-muted-foreground flex gap-3 flex-wrap">
              <span className="text-blue-400">{fmtMoney(costKinds!.input)} in</span>
              <span className="text-emerald-400">{fmtMoney(costKinds!.output)} out</span>
              <span className="text-violet-400" title="Prompt-cache reads (~0.1x input) and writes (~1.25x input).">{fmtMoney(costKinds!.cached)} cached</span>
            </div>
            ) : (
            <div className="text-xs text-muted-foreground flex gap-3 flex-wrap">
              <span className="text-blue-400">{formatTokens(summary.total_input)} in</span>
              <span className="text-emerald-400">{formatTokens(summary.total_output)} out</span>
              {(summary.total_cache_read || 0) > 0 && (
                <span className="text-violet-400" title="Prompt-cache reads — tokens sent and charged, at a discount. On the Anthropic wire this is most of a foreground turn.">
                  {formatTokens(summary.total_cache_read || 0)} cached
                </span>
              )}
            </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Calls · {windowLabel}</CardDescription>
            <CardTitle className="text-3xl">{summary.total_calls}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-muted-foreground">
              {byProvider.map(p => (
                <span key={p.provider} className="mr-3">
                  <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ backgroundColor: getProviderColor(p.provider) }} />
                  {p.provider}: {p.calls}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Avg Latency</CardDescription>
            <CardTitle className="text-3xl">{formatLatency(summary.avg_latency_ms)}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              per LLM call
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Account · {windowLabel}</CardDescription>
            {/* Grouped by ACCOUNT, not by the `subscription` column. That column
                carries four spellings for Claude Max alone (max-oauth-passthrough,
                max-subscription, anthropic-subscription, and blank) and maps
                many-to-many to provider, so this card used to show one account as
                several rows — the same double-counting the provider aliases exist
                to prevent, in a column nobody had aliased. byProvider is already
                normalized and merged, so this now agrees with the pie beside it. */}
            <CardTitle className="text-lg">
              {byProvider.map(p => (
                <div key={p.provider} className="flex justify-between items-center">
                  <span className="text-sm flex items-center gap-1.5">
                    <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: getProviderColor(p.provider) }} />
                    {accountLabel(p.provider)}
                  </span>
                  {/* Consumption, cache included. Fresh-only made the account
                      carrying the foreground work — the largest consumer on the
                      machine — read as the smallest line in this card. */}
                  <Badge variant="secondary" className="text-xs">{fmtValue(accountValue(p))}</Badge>
                </div>
              ))}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Main content */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          {has('overview') && <TabsTrigger value="overview">Overview</TabsTrigger>}
          {has('evolution') && <TabsTrigger value="evolution">Evolution</TabsTrigger>}
          {has('cost') && <TabsTrigger value="cost">Cost</TabsTrigger>}
          {has('recent') && <TabsTrigger value="recent">Recent Calls</TabsTrigger>}
          {has('routing') && <TabsTrigger value="routing">Routing</TabsTrigger>}
        </TabsList>

        {/* Overview Tab - Treemap + Provider pie */}
        <TabsContent value="overview" className="mt-4">
          <div className="grid grid-cols-3 gap-4">
            {/* Treemap - biggest consumers */}
            <Card className="col-span-2">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Zap className="h-4 w-4" />
                  {priced ? 'Cost by Process' : 'Token Consumption by Process'}
                </CardTitle>
                <CardDescription>
                  {priced ? 'Larger area = more spent.' : 'Larger area = more tokens consumed.'} Hover for details.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={350}>
                  <Treemap
                    data={treemapData}
                    dataKey="value"
                    aspectRatio={4 / 3}
                    content={<TreemapContent x={0} y={0} width={0} height={0} name="" value={0} fill="" />}
                  >
                    <Tooltip content={<TreemapTooltip />} />
                  </Treemap>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Provider/Subscription pie */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">By Provider</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie
                      data={byProvider.map(p => ({
                        name: p.provider,
                        // Consumption, cache included — see allTokens(). On
                        // total_tokens alone the account carrying the foreground
                        // Claude work rendered as a 2% sliver of a window it
                        // actually dominated.
                        value: accountValue(p),
                        fill: getProviderColor(p.provider)
                      }))}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="40%"
                      outerRadius={55}
                      label={false}
                    >
                      {byProvider.map(p => (
                        <Cell key={p.provider} fill={getProviderColor(p.provider)} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(val) => fmtValue(toTokenCount(val))} />
                    <Legend
                      verticalAlign="bottom"
                      wrapperStyle={{ paddingTop: '12px' }}
                      formatter={(value, entry: any) => {
                        const item = byProvider.find(p => p.provider === value);
                        const total = byProvider.reduce((s, p) => s + accountValue(p), 0);
                        const pct = item && total ? ((accountValue(item) / total) * 100).toFixed(0) : '0';
                        return `${value} ${pct}%`;
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>

                <div className="mt-4">
                  <h4 className="text-sm font-medium mb-2">By Provider / Model</h4>
                  {(priced
                    ? [...byModel].sort((a, b) => (costByAccountModel!.get(b.key) || 0) - (costByAccountModel!.get(a.key) || 0))
                    : byModel)
                    .map(m => (
                      <div key={m.key} className="flex justify-between items-center text-sm py-1">
                        {/* The account is what determines cost, so it leads. The same
                            model on two accounts is two rows, not one — that distinction
                            is the whole point of naming the provider here. */}
                        <span className="truncate mr-2" title={m.key}>
                          <span
                            className="font-medium"
                            style={{ color: getProviderColor(m.provider) }}
                          >{m.provider}</span>
                          <span className="text-muted-foreground">/{m.model}</span>
                        </span>
                        <span
                          className="font-mono text-xs"
                          title={m.cache_read_tokens
                            ? `${formatTokens(m.total_tokens)} fresh + ${formatTokens(m.cache_read_tokens + m.cache_write_tokens)} prompt cache`
                            : undefined}
                        >{priced ? fmtMoney(costByAccountModel!.get(m.key) || 0) : formatTokens(allTokens(m))}</span>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Evolution Tab - stacked area chart over the selected window */}
        <TabsContent value="evolution" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" />
                    {priced ? 'Cost Evolution' : 'Consumption Evolution'}
                  </CardTitle>
                  <CardDescription>
                    {windowLabel} · {summary.bucket_minutes ?? '?'}-minute buckets ·
                    {evoAccumulate ? (evoSeedOk ? ' month-to-date ·' : ' running total from the window start ·') : ''}
                    {' '}{evoStacked ? 'stacked by' : 'overlapping by'} {
                      evoGroupBy === 'process' ? 'purpose'
                      : evoGroupBy === 'model' ? 'model'
                      : evoGroupBy === 'provider' ? 'provider'
                      : 'token type'
                    } ·
                    {' '}click legend to toggle · drag brush to zoom
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEvoStackMode(m => m === 'stacked' ? 'overlapping' : 'stacked')}
                    disabled={evoYScale === 'log'}
                    title={evoYScale === 'log'
                      ? 'A log axis cannot stack — a stack encodes value as band height, which log does not preserve. Overlapping while log is on.'
                      : evoStackMode === 'stacked' ? 'Switch to overlapping (translucent)' : 'Switch to stacked'}
                    className="h-9"
                  >
                    {evoStacked ? 'Stacked' : 'Overlap'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEvoAccumulate(v => !v)}
                    title={evoAccumulate
                      ? 'Back to the amount per bucket'
                      : 'Running total per series, restarting each calendar month — rising cost per provider'}
                    className="h-9"
                  >
                    {evoAccumulate ? 'Month-to-date' : 'Per bucket'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEvoYScale(v => v === 'linear' ? 'log' : 'linear')}
                    title={evoYScale === 'linear'
                      ? 'Switch to a log Y axis — reads KB and MB series on one chart. Forces overlapping.'
                      : 'Switch back to a linear Y axis'}
                    className="h-9"
                  >
                    {evoYScale === 'linear' ? 'Linear' : 'Log'}
                  </Button>
                  <Select
                    value={evoGroupBy}
                    onValueChange={(v) => setEvoGroupBy(v as 'process' | 'model' | 'provider' | 'tokens')}
                  >
                    <SelectTrigger className="w-[160px] h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="process">By Process</SelectItem>
                      <SelectItem value="model">By Model</SelectItem>
                      <SelectItem value="provider">By Provider</SelectItem>
                      <SelectItem value="tokens">Input / Output / Cache</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {evoData.length > 0 && evoKeys.length > 0 ? (
                <ResponsiveContainer width="100%" height={420}>
                  <AreaChart data={evoData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={24} />
                    <YAxis
                      tickFormatter={fmtValue}
                      tick={{ fontSize: 11 }}
                      scale={evoYScale}
                      // A log axis needs a positive floor; 1 token is the
                      // smallest real quantity, so it is the honest one. Linear
                      // keeps its 0 baseline. allowDataOverflow lets the floor
                      // hold rather than being widened back down to 0.
                      domain={evoYScale === 'log' ? [priced ? 0.0001 : 1, 'auto'] : [0, 'auto']}
                      allowDataOverflow={evoYScale === 'log'}
                    />
                    <Tooltip
                      formatter={(val, name) => [fmtValue(toTokenCount(val)), String(name)]}
                      labelStyle={{ color: '#999' }}
                      contentStyle={{ backgroundColor: '#1e1e2e', border: '1px solid #333' }}
                    />
                    <Legend
                      onClick={(e: any) => {
                        const key = e?.dataKey || e?.value
                        if (typeof key === 'string') toggleEvoSeries(key)
                      }}
                      formatter={(value: string) => (
                        <span
                          style={{
                            cursor: 'pointer',
                            opacity: evoHidden.has(value) ? 0.4 : 1,
                            textDecoration: evoHidden.has(value) ? 'line-through' : 'none',
                          }}
                        >
                          {value}
                        </span>
                      )}
                    />
                    {evoKeys.map((k, i) => (
                      <Area
                        key={k}
                        type="monotone"
                        dataKey={k}
                        stackId={evoStacked ? 'evo' : undefined}
                        stroke={evoColorFor(k, i)}
                        fill={evoColorFor(k, i)}
                        fillOpacity={evoStacked ? 0.7 : 0.35}
                        // Gaps are real (a bucket with no traffic); do not
                        // bridge them into a line that implies steady activity.
                        connectNulls={false}
                        name={k}
                        hide={evoHidden.has(k)}
                      />
                    ))}
                    <Brush dataKey="label" height={24} stroke="#888" travellerWidth={8} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-center text-muted-foreground py-12">
                  No data in this window. Pick a wider time range or wait for new LLM calls.
                </div>
              )}
            </CardContent>
          </Card>

          {/* Per-series rollup table — total tokens contributed by each stacked
              series in the window, so the user can see who the top consumers
              are at a glance without hovering through the chart. */}
          {evoKeys.length > 0 && (
            <Card className="mt-4">
              <CardHeader>
                <CardTitle className="text-base">
                  Top Consumers ({windowLabel})
                </CardTitle>
                <CardDescription>
                  Totals across the selected window, ranked by {priced ? 'cost' : 'token volume'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {(() => {
                  // Metadata lookup keyed by series name. by_process carries
                  // calls + avg_latency; by_model carries calls only; tokens
                  // mode (input/output) has no per-series metadata so those
                  // cells render as em-dash.
                  const meta = new Map<string, { calls?: number; avg_latency?: number; p50_latency_ms?: number; p50_overhead_ms?: number }>()
                  if (evoGroupBy === 'process') {
                    for (const p of (summary.by_process || [])) {
                      meta.set(p.process, { calls: p.calls, avg_latency: p.avg_latency })
                    }
                  } else if (evoGroupBy === 'provider') {
                    // by_provider carries calls (no latency), and the key must be
                    // canonicalized the same way evoKeys was — otherwise copilot/
                    // github-copilot merge into one series whose metadata lookup
                    // then misses. Calls sum across merged aliases.
                    for (const p of (summary.by_provider || [])) {
                      const pk = normalizeProvider(p.provider)
                      const prev = meta.get(pk)
                      meta.set(pk, { calls: (prev?.calls || 0) + (p.calls || 0) })
                    }
                  } else if (evoGroupBy === 'model') {
                    for (const m of (summary.by_model || [])) {
                      // Key by CANONICAL model so punctuation variants (claude-opus-4-8
                      // vs -4.8) share one row, matching the canonicalized evoKeys. Calls
                      // sum across merged variants; latency fields keep the first seen (the
                      // variants are the same model, so latency is effectively identical).
                      // Phase 66-01 piggyback: median (p50) rides on the by_model row.
                      // Phase 66-04: p50_overhead_ms (pool spawn overhead) rides alongside.
                      const mk = normalizeModel(m.model) || m.model
                      const prev = meta.get(mk)
                      meta.set(mk, {
                        calls: (prev?.calls ?? 0) + (m.calls ?? 0),
                        avg_latency: prev?.avg_latency ?? m.avg_latency,
                        p50_latency_ms: prev?.p50_latency_ms ?? m.p50_latency_ms,
                        p50_overhead_ms: prev?.p50_overhead_ms ?? m.p50_overhead_ms,
                      })
                    }
                  }
                  return (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{evoGroupBy === 'process' ? 'Process' : evoGroupBy === 'model' ? 'Model' : 'Token Type'}</TableHead>
                      <TableHead className="text-right">Calls</TableHead>
                      <TableHead className="text-right">{priced ? 'Cost' : 'Total Tokens'}</TableHead>
                      <TableHead className="text-right">Avg Latency</TableHead>
                      <TableHead className="text-right" title="Total end-to-end median latency (generation-dominated) — forensic context, NOT the worker-pool overhead the threshold grades. See Spawn Overhead.">Median Latency</TableHead>
                      {/* Phase 66-04: the threshold-graded pool-health column. */}
                      <TableHead className="text-right" title="Median worker-pool spawn/queue overhead (66-03): dispatch → first output, excludes generation. Warm reuse ≈ 0 (green ≤3s); cold-spawn regression climbs toward ~14s (red).">Spawn Overhead</TableHead>
                      <TableHead className="w-[240px]">Share</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {evoKeys
                      .map((k, i) => {
                        // From the raw buckets, not evoData: month-to-date
                        // values are running totals and would sum to nonsense.
                        const total = evoSeriesRaw.reduce((s, row) => s + Number(row[k] || 0), 0)
                        return { key: k, total, color: evoColorFor(k, i) }
                      })
                      .sort((a, b) => b.total - a.total)
                      .map(({ key, total, color }) => {
                        // Same denominator as the chart above it — the Top
                        // Consumers shares are of the same cache-inclusive total.
                        const grandTotal = evoGrandTotal
                        const pct = (total / grandTotal) * 100
                        const m = meta.get(key)
                        return (
                          <TableRow key={key}>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: color }} />
                                <span className="font-medium">{key}</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {m?.calls != null ? m.calls : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className="text-right font-mono font-semibold">{fmtValue(total)}</TableCell>
                            <TableCell className="text-right font-mono text-muted-foreground">
                              {m?.avg_latency != null ? formatLatency(m.avg_latency) : <span>—</span>}
                            </TableCell>
                            {/* Phase 66-04: total-latency median RETAINED as forensic
                                context (gap note) but the threshold BADGE moved to the
                                Spawn Overhead column — total latency is generation-dominated
                                and should NOT be graded against the ≤3s pool bar, so it now
                                renders muted/plain. */}
                            <TableCell className="text-right font-mono">
                              {m?.p50_latency_ms != null ? (
                                <span className="text-muted-foreground">{formatLatency(m.p50_latency_ms)}</span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            {/* Phase 66-04 (D-03/D-04): per-model worker-pool spawn overhead
                                with green ≤3s / amber / red threshold badge for claude-code
                                fallback models (sonnet, opus); haiku renders plain (direct
                                path — no pool overhead); absent overhead → muted dash. This
                                is the pool-health metric PERF-03 grades. */}
                            <TableCell className="text-right font-mono">
                              {m?.p50_overhead_ms != null ? (
                                evoGroupBy === 'model' && !isHaikuModel(key) ? (
                                  (() => {
                                    const status = latencyThresholdStatus(m.p50_overhead_ms)
                                    const cls = status === 'operational'
                                      ? 'bg-green-50 text-green-700 border-green-200'
                                      : status === 'warning'
                                        ? 'bg-yellow-50 text-yellow-700 border-yellow-200'
                                        : 'bg-red-50 text-red-700 border-red-200'
                                    return (
                                      <Badge variant="outline" className={cls}>
                                        {formatLatency(m.p50_overhead_ms)}
                                      </Badge>
                                    )
                                  })()
                                ) : (
                                  <span className="text-muted-foreground">{formatLatency(m.p50_overhead_ms)}</span>
                                )
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
                                  <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
                                </div>
                                <span className="text-xs text-muted-foreground w-12 text-right">{pct.toFixed(1)}%</span>
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                  </TableBody>
                </Table>
                  )
                })()}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Cost Tab - €/$ cost, budgets, burn-rate, optimization controls */}
        {has('cost') && (
          <TabsContent value="cost">
            <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading…</div>}>
              <CostTab proxyBase={proxyBase} currency={unit === 'USD' ? 'USD' : 'EUR'} onCurrency={setUnit} coverage={coverage} accountsRev={accountsRev} hiddenAccounts={hiddenAccounts} onAccounts={accountSel ? () => setAccountsOpen(true) : undefined} />
            </Suspense>
          </TabsContent>
        )}

        {/* Routing Tab — configuration AND observed behaviour, read-only.
            Editing stays in the Settings dialog: this is where you find out what
            the system is doing, that is where you change it. */}
        {has('routing') && (
          <TabsContent value="routing" className="mt-4">
            <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading…</div>}>
              <TokenUsageRoutingTab proxyBase={proxyBase} hours={hoursWindow} />
            </Suspense>
          </TabsContent>
        )}

        {/* Recent Calls Tab */}
        <TabsContent value="recent" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent LLM Calls</CardTitle>
              <CardDescription>Last 50 calls across all processes</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Process</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead className="text-right">In</TableHead>
                    <TableHead className="text-right">Out</TableHead>
                    {priced && <TableHead className="text-right">Cost</TableHead>}
                    <TableHead className="text-right">Latency</TableHead>
                    <TableHead>Preview</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recent.map(call => (
                    <TableRow key={call.id}>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(call.timestamp).toLocaleTimeString()}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className="text-xs"
                          style={{ borderLeft: `3px solid ${getProcessColor(call.process)}` }}
                        >
                          {call.process}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs" style={{ color: getProviderColor(call.provider) }}>
                          {call.provider}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{call.model}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-blue-400">{formatTokens(call.input_tokens)}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-emerald-400">{formatTokens(call.output_tokens)}</TableCell>
                      {priced && (
                        <TableCell className="text-right font-mono text-xs">
                          {fmtMoney(fromUsd(cellCostUsd({
                            provider: call.provider, model: call.model,
                            input_tokens: call.input_tokens, output_tokens: call.output_tokens,
                            cache_read_tokens: call.cache_read_tokens || 0, cache_write_tokens: call.cache_write_tokens || 0,
                          }, cfg), cfg))}
                        </TableCell>
                      )}
                      <TableCell className="text-right font-mono text-xs">{formatLatency(call.latency_ms)}</TableCell>
                      <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
                        {stripPromptPreview(call.prompt_preview)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
