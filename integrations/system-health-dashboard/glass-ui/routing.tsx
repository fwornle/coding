import { useCallback, useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { useOffload } from './offload'

/**
 * The routing history: what glass's offload router decided, call by call — the
 * daemon's /api/routing (lib/glass/routing.mjs). One component, two places: the
 * Routing tab (any machine with offload set up) and the Cluster page's side panel,
 * where a call served by a node's gateway lights that node.
 *
 * Adapted from coding's "Recent decisions" (src/pages/token-usage-routing-tab.tsx),
 * which reads coding's /api/llm/routing* and is swapped out of glass (omitted.tsx).
 * Kept: one row per call, the band and who chose it, the offloaded/fallback badge,
 * the expandable trail. Left out: per-route tables, policy drafts, turn grouping.
 */

export type Outcome = 'offloaded' | 'failed' | 'kept' | 'routed'

export interface RoutingRow {
  ts: string
  agent: string
  taskId: string
  routeKey: string
  band: string
  bandSource: string
  provider: string
  model: string
  upstream: string
  host: string
  outcome: Outcome
  from: string
  reason: string
  classifier: string
  attempts: { provider: string; model: string; error: string; ms: number | null }[]
  skipped: { provider: string; reason: string; kind: string }[]
  latencyMs: number | null
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }
}

export interface RoutingView {
  hours: number
  available: boolean
  truncated: boolean
  counts: Record<Outcome, number>
  rows: RoutingRow[]
}

export const ROUTING_WINDOWS: Array<{ hours: number; label: string }> = [
  { hours: 1, label: '1 h' },
  { hours: 24, label: '24 h' },
  { hours: 24 * 7, label: '7 days' },
  { hours: 24 * 30, label: '30 days' },
]

const POLL_MS = 10_000

export function useRouting(hours: number, enabled = true): { view: RoutingView | null; error: string } {
  const [view, setView] = useState<RoutingView | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!enabled) return undefined
    let alive = true
    const load = () => fetch(`/api/routing?hours=${hours}&limit=500`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: RoutingView) => { if (alive) { setView(d); setError('') } })
      .catch((e) => { if (alive) setError(String(e?.message || e)) })
    setView(null)
    load()
    const t = setInterval(load, POLL_MS)
    return () => { alive = false; clearInterval(t) }
  }, [hours, enabled])
  return { view, error }
}

/** Routing is worth a tab once offload has an endpoint (it runs then), or a cluster is configured. */
export function useRoutingAvailable(clusterConfigured: boolean): boolean {
  const { view } = useOffload()
  return clusterConfigured || Boolean(view?.config.target.url)
}

const fmtTokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n))
const fmtMs = (ms: number | null) => (ms == null ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`)
const clock = (iso: string) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const today = new Date().toDateString() === d.toDateString()
  return today ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
const totalTokens = (t: RoutingRow['tokens']) => t.input + t.output + t.cacheRead + t.cacheWrite

const OUTCOME: Record<Outcome, { label: string; cls: string; dot: string }> = {
  offloaded: { label: 'offloaded', cls: 'text-status-success border-status-success-line bg-status-success-subtle', dot: 'bg-status-success' },
  failed: { label: 'fell back', cls: 'text-status-warning border-status-warning-line bg-status-warning-subtle', dot: 'bg-status-warning' },
  kept: { label: 'kept', cls: 'text-muted-foreground border-border bg-muted/40', dot: 'bg-muted-foreground' },
  routed: { label: 'routed', cls: 'text-status-info border-status-info-line bg-status-info-subtle', dot: 'bg-status-info' },
}

/**
 * What a history card is on the cluster, given by the Cluster page (a card off the cluster has none):
 * LLM work in faint blues — offloaded calls, agents configured with a cluster model, LLM jobs —,
 * any other job in faint green; a call an adapter served keeps its colour and gets a dashed frame.
 */
export type CardKind = 'offload' | 'agent' | 'llm-job' | 'other-job'
export interface CardCategory { kind: CardKind; adapter: boolean }
// cls tints a card faintly; swatch is the same hue, strong enough to read in the legend.
export const CARD_KIND: Record<CardKind, { label: string; cls: string; swatch: string }> = {
  offload: { label: 'offload', cls: 'bg-sky-500/10', swatch: 'bg-sky-500/50' },
  agent: { label: 'agent model', cls: 'bg-indigo-500/10', swatch: 'bg-indigo-500/50' },
  'llm-job': { label: 'LLM job', cls: 'bg-blue-500/10', swatch: 'bg-blue-500/50' },
  'other-job': { label: 'non-LLM job', cls: 'bg-emerald-500/10', swatch: 'bg-emerald-500/50' },
}
const ADAPTER_FRAME = 'outline-dashed outline-1 -outline-offset-2 outline-indigo-400/70'
const cardCls = (c: CardCategory | null | undefined) => (c ? cn(CARD_KIND[c.kind].cls, c.adapter && ADAPTER_FRAME) : '')

/** A job the cluster's status services reported, as the job log keeps it. */
export interface JobCard {
  id: string; name: string; image: string; status: string; started: string | null; gpu: string | null
  kind: 'llm' | 'other' | null; node: string; host: string; firstSeen: string; lastSeen: string
}

function CardLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground" data-testid="card-legend">
      {(Object.keys(CARD_KIND) as CardKind[]).map((k) => (
        <span key={k} className="flex items-center gap-1"><span className={cn('h-2.5 w-3.5 rounded-sm', CARD_KIND[k].swatch)} />{CARD_KIND[k].label}</span>
      ))}
      <span className="flex items-center gap-1"><span className={cn('h-2.5 w-3.5 rounded-sm', ADAPTER_FRAME, 'outline-offset-0')} />with adapter</span>
    </div>
  )
}

export function OutcomeBadge({ outcome }: { outcome: Outcome }) {
  const o = OUTCOME[outcome]
  return <span className={cn('inline-flex items-center rounded border px-1.5 py-0 text-[10px] font-medium', o.cls)}>{o.label}</span>
}

/** One line of why: the router's reason, the endpoint's failure, or where the call came from. */
export function whyOf(r: RoutingRow): string {
  if (r.outcome === 'offloaded') return r.from ? `instead of ${r.from}` : ''
  if (r.outcome === 'failed') {
    const a = r.attempts[0]
    return a ? `${a.provider} failed: ${a.error}${a.ms != null ? ` after ${fmtMs(a.ms)}` : ''}` : ''
  }
  if (r.outcome === 'kept') return r.reason
  return r.skipped.map((s) => `${s.provider}: ${s.reason}`).join('; ')
}

type Filter = 'all' | 'offloaded' | 'not'

const rowId = (r: RoutingRow) => `${r.ts}-${r.taskId}-${r.routeKey}-${r.provider}`

/** A row's details, opened by a click: tokens, route key, the classifier's note, the trail. */
function Trail({ r }: { r: RoutingRow }) {
  return (
    <div className="mt-1 space-y-0.5 border-l-2 border-muted pl-2 font-mono text-[10px] text-muted-foreground">
      <div>in {fmtTokens(r.tokens.input)} · out {fmtTokens(r.tokens.output)}{r.tokens.cacheRead > 0 ? ` · cache read ${fmtTokens(r.tokens.cacheRead)}` : ''}</div>
      {r.routeKey && <div>route {r.routeKey}</div>}
      {r.upstream && <div>sent to {r.upstream}</div>}
      {r.classifier && <div className={/error|unreachable|timed? out/i.test(r.classifier) ? 'text-destructive' : ''}>judge: {r.classifier}</div>}
      {r.attempts.map((a, i) => <div key={i} className="text-status-warning">tried {a.provider}/{a.model} → {a.error}{a.ms != null ? ` (${a.ms} ms)` : ''}</div>)}
      {r.skipped.map((s, i) => <div key={`s${i}`}>skipped {s.provider}: {s.reason}</div>)}
    </div>
  )
}

export interface RoutingHistoryProps {
  hours: number
  onHours: (h: number) => void
  view: RoutingView | null
  error: string
  /** compact = the Cluster page's side panel */
  compact?: boolean
  /** a node name for an upstream host (the Cluster page) — shown instead of the host */
  nodeOf?: (host: string) => string | undefined
  /** the host of the row under the pointer, so the page can light its node */
  onHoverHost?: (host: string | null) => void
  /** only rows served by this host (a node tile clicked) */
  hostFilter?: string | null
  onClearHost?: () => void
  /** what each card is on the cluster (the Cluster page); without it cards are not tinted */
  categoryOf?: (r: RoutingRow) => CardCategory | null
  /** the cluster's jobs, merged into the compact list by when they were last seen */
  jobs?: JobCard[]
}

type Item = { at: string; row: RoutingRow; job?: undefined } | { at: string; job: JobCard; row?: undefined }

/**
 * ESC closes what is open while `active`. One press closes one thing: a `first` handler runs in
 * the capture phase and marks the key handled, so an expanded history card closes before the
 * node view around it. An open dialog keeps ESC for itself.
 */
export function useEscape(active: boolean, onEscape: () => void, first = false) {
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('[role="dialog"]')) return
      e.preventDefault()
      onEscape()
    }
    window.addEventListener('keydown', onKey, first)
    return () => window.removeEventListener('keydown', onKey, first)
  }, [active, onEscape, first])
}

export function RoutingHistory({ hours, onHours, view, error, compact, nodeOf, onHoverHost, hostFilter, onClearHost, categoryOf, jobs }: RoutingHistoryProps) {
  const [filter, setFilter] = useState<Filter>('all')
  const [open, setOpen] = useState<string | null>(null)
  const collapse = useCallback(() => setOpen(null), [])
  useEscape(open !== null, collapse, true)
  const rows = useMemo(() => (view?.rows ?? []).filter((r) => {
    if (hostFilter && r.host !== hostFilter) return false
    if (filter === 'offloaded') return r.outcome === 'offloaded'
    if (filter === 'not') return r.outcome !== 'offloaded'
    return true
  }), [view, filter, hostFilter])
  // Jobs are no routing decisions: only "All" shows them, between the calls by time.
  const items = useMemo<Item[]>(() => {
    const list: Item[] = rows.map((row) => ({ at: row.ts, row }))
    if (filter === 'all') for (const job of jobs ?? []) if (!hostFilter || job.host === hostFilter) list.push({ at: job.lastSeen, job })
    return list.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
  }, [rows, jobs, filter, hostFilter])
  const c = view?.counts
  const latency = useMemo(() => {
    const ms = (view?.rows ?? []).filter((r) => r.outcome === 'offloaded' && r.latencyMs != null).map((r) => r.latencyMs as number).sort((a, b) => a - b)
    return ms.length ? ms[Math.floor(ms.length / 2)] : null
  }, [view])

  return (
    <div className={cn('flex flex-col gap-3', compact && 'min-h-0')} data-testid="routing-history">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex rounded border overflow-hidden" role="group" aria-label="Time window">
          {ROUTING_WINDOWS.map((w) => (
            <button
              key={w.hours}
              onClick={() => onHours(w.hours)}
              className={cn('text-[11px] px-2 py-0.5', hours === w.hours ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-muted/60')}
            >{w.label}</button>
          ))}
        </div>
        <div className="flex rounded border overflow-hidden" role="group" aria-label="Outcome">
          {([['all', 'All'], ['offloaded', 'Offloaded'], ['not', 'Kept / fell back']] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={cn('text-[11px] px-2 py-0.5', filter === k ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-muted/60')}
            >{label}</button>
          ))}
        </div>
      </div>

      {c && (
        <div className="grid grid-cols-4 gap-2 text-center">
          {(['offloaded', 'failed', 'kept', 'routed'] as const).map((k) => (
            <div key={k} className="rounded-md border bg-muted/20 px-2 py-1.5">
              <div className="flex items-center justify-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                <span className={cn('h-1.5 w-1.5 rounded-full', OUTCOME[k].dot)} />{OUTCOME[k].label}
              </div>
              <div className="text-lg font-semibold tabular-nums">{c[k]}</div>
            </div>
          ))}
        </div>
      )}
      {compact && categoryOf && <CardLegend />}
      {latency != null && (
        <div className="text-[11px] text-muted-foreground">Median latency of offloaded calls: <span className="tabular-nums text-foreground">{fmtMs(latency)}</span></div>
      )}
      {hostFilter && (
        <div className="flex items-center gap-2 text-[11px]">
          <span className="rounded border px-1.5 py-0.5 font-mono">served by {nodeOf?.(hostFilter) ?? hostFilter}</span>
          <button className="text-muted-foreground hover:text-foreground underline underline-offset-2" onClick={onClearHost}>show all</button>
        </div>
      )}

      {error && <div className="text-xs text-destructive">Routing history unavailable: {error}</div>}
      {view && !view.available && (
        <div className="text-xs text-muted-foreground">This token database has no routing columns yet — decisions are recorded from the next offloaded call on.</div>
      )}
      {view?.available && items.length === 0 && (
        <div className="rounded-md border border-dashed p-4 text-xs text-muted-foreground">
          No routing decisions in this window{hostFilter ? ' for this node' : ''}. The router decides only for agents offload is switched on for (the Offload pill, top right).
        </div>
      )}
      {!view && !error && <div className="text-xs text-muted-foreground">Loading…</div>}

      {items.length > 0 && compact && (
        <ul className="max-h-[calc(100vh-22rem)] divide-y overflow-auto rounded-md border text-xs">
          {items.map(({ row: r, job }) => {
            if (job) {
              const c: CardCategory = { kind: job.kind === 'llm' ? 'llm-job' : 'other-job', adapter: false }
              return (
                <li
                  key={`job:${job.node}/${job.id || job.name}`}
                  data-testid="history-job"
                  data-kind={c.kind}
                  onMouseEnter={() => onHoverHost?.(job.host)}
                  onMouseLeave={() => onHoverHost?.(null)}
                  className={cn('space-y-0.5 px-2.5 py-2', cardCls(c))}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-muted-foreground">{clock(job.lastSeen)}</span>
                    <span className="rounded border px-1.5 text-[10px] font-medium">job</span>
                    <span className="truncate text-muted-foreground">{job.status}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">{CARD_KIND[c.kind].label}</span>
                  </div>
                  <div className="flex items-baseline gap-1.5 font-mono">
                    <span className="truncate">{job.name || job.id}</span>
                    <span className="text-muted-foreground">@</span>
                    <span className="font-medium">{job.node}</span>
                  </div>
                  <div className="flex gap-2 text-[10px] text-muted-foreground">
                    <span className="truncate font-mono">{job.image}</span>
                    <span className="ml-auto shrink-0">{job.gpu != null ? `GPU ${job.gpu} · ` : ''}seen since {clock(job.firstSeen)}</span>
                  </div>
                </li>
              )
            }
            const id = rowId(r)
            const node = r.host ? nodeOf?.(r.host) : undefined
            const why = whyOf(r)
            const expanded = open === id
            const c = categoryOf?.(r) ?? null
            return (
              <li
                key={id}
                data-testid="history-call"
                data-kind={c?.kind ?? ''}
                data-adapter={c?.adapter ? 'true' : undefined}
                onMouseEnter={() => onHoverHost?.(r.outcome === 'offloaded' ? r.host : null)}
                onMouseLeave={() => onHoverHost?.(null)}
                onClick={() => setOpen(expanded ? null : id)}
                className={cn('cursor-pointer space-y-0.5 px-2.5 py-2 hover:bg-muted/40', cardCls(c))}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-muted-foreground">{clock(r.ts)}</span>
                  <OutcomeBadge outcome={r.outcome} />
                  <span className="truncate text-muted-foreground">{r.agent}</span>
                  {c && <span className="text-[10px] text-muted-foreground">{CARD_KIND[c.kind].label}{c.adapter ? ' · adapter' : ''}</span>}
                  <span className="ml-auto tabular-nums">{fmtMs(r.latencyMs)}</span>
                </div>
                <div className="flex items-baseline gap-1.5 font-mono">
                  <span className="truncate">{r.model || '—'}</span>
                  <span className="text-muted-foreground">@</span>
                  {node ? <span className="font-medium text-status-success">{node}</span> : <span className="truncate text-muted-foreground">{r.upstream || r.provider}</span>}
                </div>
                {why && <div className={cn('text-[11px]', r.outcome === 'failed' ? 'text-status-warning' : 'text-muted-foreground')}>{why}</div>}
                <div className="flex gap-2 text-[10px] text-muted-foreground">
                  <span>band <span className="font-mono text-foreground">{r.band || '—'}</span>{r.bandSource ? ` (${r.bandSource})` : ''}</span>
                  <span className="ml-auto tabular-nums">{fmtTokens(totalTokens(r.tokens))} tokens</span>
                </div>
                {expanded && <Trail r={r} />}
              </li>
            )
          })}
        </ul>
      )}
      {rows.length > 0 && !compact && (
        <div className="max-h-[640px] overflow-auto rounded-md border">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground sticky top-0 z-10">
              <tr>
                <th className="text-left px-2 py-1.5 font-medium bg-muted border-b">Time</th>
                <th className="text-left px-2 py-1.5 font-medium bg-muted border-b">Agent</th>
                <th className="text-left px-2 py-1.5 font-medium bg-muted border-b">Decision</th>
                <th className="text-left px-2 py-1.5 font-medium bg-muted border-b">Band</th>
                <th className="text-left px-2 py-1.5 font-medium bg-muted border-b">Served by</th>
                <th className="text-left px-2 py-1.5 font-medium bg-muted border-b">Why</th>
                <th className="text-right px-2 py-1.5 font-medium bg-muted border-b">Latency</th>
                <th className="text-right px-2 py-1.5 font-medium bg-muted border-b">Tokens</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const id = rowId(r)
                const why = whyOf(r)
                const expanded = open === id
                return (
                  <tr key={id} onClick={() => setOpen(expanded ? null : id)} className="border-b last:border-b-0 align-top cursor-pointer hover:bg-muted/40">
                    <td className="px-2 py-1.5 font-mono text-muted-foreground whitespace-nowrap">{clock(r.ts)}</td>
                    <td className="px-2 py-1.5">{r.agent || '—'}</td>
                    <td className="px-2 py-1.5"><OutcomeBadge outcome={r.outcome} /></td>
                    <td className="px-2 py-1.5 font-mono whitespace-nowrap">
                      {r.band || '—'}{r.bandSource && <span className="text-muted-foreground"> · {r.bandSource}</span>}
                    </td>
                    <td className="px-2 py-1.5 font-mono">
                      <div>{r.model || '—'}</div>
                      <div className="text-[10px] text-muted-foreground">{r.provider}{r.upstream && ` · ${r.upstream}`}</div>
                    </td>
                    <td className={cn('px-2 py-1.5', r.outcome === 'failed' ? 'text-status-warning' : 'text-muted-foreground')}>
                      {why || '—'}
                      {expanded && <Trail r={r} />}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{fmtMs(r.latencyMs)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmtTokens(totalTokens(r.tokens))}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {view?.truncated && <div className="text-[11px] text-muted-foreground">Showing the newest {view.rows.length} decisions of this window.</div>}
    </div>
  )
}

/** The Routing tab: the history full width, for any machine with offload set up. */
export function RoutingPage() {
  const [hours, setHours] = useState(24)
  const { view, error } = useRouting(hours)
  return (
    <div className="p-6 space-y-4" data-testid="routing-tab">
      <div>
        <h1 className="text-2xl font-bold">Routing</h1>
        <p className="text-sm text-muted-foreground max-w-3xl">
          Every call the offload router looked at: whether your endpoint answered it, why it stayed with the
          agent&apos;s own provider, or how the endpoint failed before the call fell back. Click a row for its trail.
        </p>
      </div>
      <RoutingHistory hours={hours} onHours={setHours} view={view} error={error} />
    </div>
  )
}
