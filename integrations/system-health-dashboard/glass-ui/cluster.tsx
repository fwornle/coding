import { useEffect, useMemo, useState } from 'react'
import { Activity, Cpu, Server, Boxes, Radio } from 'lucide-react'
import { cn } from '@/lib/utils'
import { RoutingHistory, useRouting, type RoutingRow } from './routing'

/**
 * The Cluster page: a GPU cluster's nodes at a glance — the daemon's /api/cluster
 * (lib/glass/cluster.mjs). Shown only when ~/.glass/cluster.json exists (the tab's
 * gate is useClusterConfigured). Each tile is one node: its gateway, the models it
 * serves, its GPUs and the job on them; the side panel is the routing history, and
 * a call a node's gateway answered lights that node.
 */

interface Gpu { index: number | null; name: string; utilPct: number | null; memUsedMib: number | null; memTotalMib: number | null; tempC: number | null }
interface Job { id: string; name: string; image: string; status: string; started: string | null; gpu: string | null }
interface Sample { ts: string; up: boolean; utilPct: number | null; memPct: number | null; latencyMs: number | null }
interface NodeView {
  name: string
  host: string
  up: boolean | null
  lastSeen: string | null
  gateway: { endpoint: string; reachable: boolean; healthy: boolean; status: string; backends: Record<string, boolean>; latencyMs: number | null; error: string } | null
  models: { ids: string[]; error: string } | null
  status: { state: 'ok' | 'absent' | 'unauthorized' | 'error' | 'no-key'; error: string; ts: string | null; gpus: Gpu[]; jobs: Job[]; endpoints: { port: number; process: string }[] } | null
  history: Sample[]
}
export interface ClusterView {
  configured: boolean
  problems?: string[]
  gatewayPort?: number
  statusPort?: number
  keySet?: boolean
  keyProblem?: string
  statusKeySet?: boolean
  statusKeyProblem?: string
  polledAt?: string | null
  intervalMs?: number
  summary?: { nodes: number; up: number; down: number; gatewaysHealthy: number; gpus: number; gpusBusy: number; jobs: number; statusServices: number }
  nodes?: NodeView[]
}

const POLL_MS = 15_000

/** Whether cluster.json configures a cluster — asks without starting the daemon's poller. */
export function useClusterConfigured(): boolean {
  const [on, setOn] = useState(false)
  useEffect(() => {
    let alive = true
    const ask = () => fetch('/api/cluster?peek=1').then((r) => (r.ok ? r.json() : { configured: false }))
      .then((j) => { if (alive) setOn(Boolean(j?.configured)) }).catch(() => { if (alive) setOn(false) })
    ask()
    // The devcontainer may write cluster.json after the page opened.
    const t = setInterval(ask, 60_000)
    return () => { alive = false; clearInterval(t) }
  }, [])
  return on
}

function useCluster(): { view: ClusterView | null; error: string } {
  const [view, setView] = useState<ClusterView | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    const load = () => fetch('/api/cluster')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: ClusterView) => { if (alive) { setView(d); setError('') } })
      .catch((e) => { if (alive) setError(String(e?.message || e)) })
    load()
    const t = setInterval(load, POLL_MS)
    return () => { alive = false; clearInterval(t) }
  }, [])
  return { view, error }
}

const ago = (iso: string | null | undefined) => {
  if (!iso) return 'never'
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  return `${Math.round(s / 3600)} h ago`
}

type Health = 'ok' | 'degraded' | 'down' | 'unknown'
const healthOf = (n: NodeView): Health => {
  if (n.up == null) return 'unknown'
  if (!n.up) return 'down'
  return n.gateway?.healthy ? 'ok' : 'degraded'
}
const DOT: Record<Health, string> = {
  ok: 'bg-status-success shadow-[0_0_6px_var(--st-success-fg)]',
  degraded: 'bg-status-warning',
  down: 'bg-status-error',
  unknown: 'bg-muted-foreground/50',
}
const HEALTH_LABEL: Record<Health, string> = { ok: 'gateway healthy', degraded: 'up, no live backend', down: 'not reachable', unknown: 'not polled yet' }

/** A small SVG trace of values 0–100 (null = a gap). */
function Sparkline({ values, className, max = 100 }: { values: (number | null)[]; className?: string; max?: number }) {
  const w = 100
  const h = 24
  if (values.length < 2) return <svg viewBox={`0 0 ${w} ${h}`} className={className} aria-hidden />
  const step = w / (values.length - 1)
  const segs: string[] = []
  let cur = ''
  values.forEach((v, i) => {
    if (v == null) { if (cur) segs.push(cur); cur = ''; return }
    const y = h - 1 - (Math.min(v, max) / max) * (h - 2)
    cur += `${cur ? 'L' : 'M'}${(i * step).toFixed(1)},${y.toFixed(1)}`
  })
  if (cur) segs.push(cur)
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={className} aria-hidden>
      {segs.map((d, i) => <path key={i} d={d} fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />)}
    </svg>
  )
}

function Bar({ pct, label, tone }: { pct: number | null; label: string; tone: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px]">
      <span className="w-8 shrink-0 text-muted-foreground">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full transition-all', tone)} style={{ width: `${Math.max(0, Math.min(100, pct ?? 0))}%` }} />
      </div>
      <span className="w-8 shrink-0 text-right tabular-nums">{pct == null ? '—' : `${Math.round(pct)}%`}</span>
    </div>
  )
}

const STATUS_NOTE: Record<string, string> = {
  absent: 'no status service',
  unauthorized: 'status service refused its key',
  error: 'status service error',
  'no-key': 'no status key',
}

function NodeTile({ n, served, lit, selected, onSelect }: { n: NodeView; served: number; lit: boolean; selected: boolean; onSelect: () => void }) {
  const health = healthOf(n)
  const gpus = n.status?.state === 'ok' ? n.status.gpus : []
  const jobs = n.status?.state === 'ok' ? n.status.jobs : []
  const trace = n.history.map((s) => (s.up ? s.utilPct : null))
  const hasUtil = trace.some((v) => v != null)
  const latency = n.history.map((s) => (s.up ? s.latencyMs : null))
  const maxLatency = Math.max(50, ...latency.filter((v): v is number => v != null))
  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid={`cluster-node-${n.name}`}
      className={cn(
        'group flex flex-col gap-2 rounded-lg border bg-card p-3 text-left transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        health === 'down' && 'opacity-70',
        lit && 'ring-2 ring-status-success',
        selected && 'ring-2 ring-primary',
      )}
    >
      <div className="flex items-start gap-2">
        <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', DOT[health])} title={HEALTH_LABEL[health]} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-sm font-semibold">{n.name}</span>
            {served > 0 && <span className="rounded bg-status-success-subtle px-1.5 text-[10px] font-medium text-status-success" title="calls this node's gateway answered in the routing window">{served} routed</span>}
          </div>
          <div className="truncate font-mono text-[10px] text-muted-foreground">{n.gateway?.endpoint ?? n.host}</div>
        </div>
      </div>

      {gpus.length > 0 ? (
        <div className="space-y-1">
          {gpus.map((g, i) => (
            <div key={i} className="space-y-0.5">
              <Bar pct={g.utilPct} label="util" tone={(g.utilPct ?? 0) >= 10 ? 'bg-status-success' : 'bg-muted-foreground/60'} />
              <Bar pct={g.memUsedMib != null && g.memTotalMib ? (100 * g.memUsedMib) / g.memTotalMib : null} label="mem" tone="bg-status-info" />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span className="truncate">{g.name || `GPU ${g.index ?? i}`}</span>
                <span className="tabular-nums">{g.memTotalMib ? `${Math.round((g.memUsedMib ?? 0) / 1024)}/${Math.round(g.memTotalMib / 1024)} GiB` : ''}{g.tempC != null ? ` · ${Math.round(g.tempC)}°C` : ''}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-[10px] text-muted-foreground">{n.up && n.status ? STATUS_NOTE[n.status.state] ?? '' : ''}</div>
      )}

      <div className="flex items-center gap-1.5">
        <Activity className="h-3 w-3 shrink-0 text-muted-foreground" />
        {hasUtil
          ? <Sparkline values={trace} className="h-5 flex-1 text-status-success" />
          : <Sparkline values={latency} max={maxLatency} className="h-5 flex-1 text-status-info" />}
        <span className="w-12 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground" title={hasUtil ? 'GPU utilisation' : 'gateway latency'}>
          {n.gateway?.latencyMs != null ? `${n.gateway.latencyMs} ms` : '—'}
        </span>
      </div>

      <div className="flex flex-wrap gap-1">
        {(n.models?.ids ?? []).map((m) => (
          <span key={m} className="max-w-full truncate rounded border px-1 font-mono text-[10px]">{m}</span>
        ))}
        {/* Without the gateway key the page's banner says it once; a tile names only its own trouble. */}
        {n.models && n.models.ids.length === 0 && n.up && n.models.error !== 'no gateway key' && <span className="text-[10px] text-muted-foreground">{n.models.error || 'no models'}</span>}
      </div>

      {jobs.length > 0 && (
        <div className="rounded bg-muted/40 px-1.5 py-1 text-[10px]">
          <span className="font-medium">{jobs[0].name || jobs[0].id}</span>
          <span className="text-muted-foreground"> · {jobs[0].status}{jobs[0].started ? ` · ${ago(jobs[0].started)}` : ''}</span>
          {jobs.length > 1 && <span className="text-muted-foreground"> · +{jobs.length - 1} more</span>}
        </div>
      )}

      <div className="mt-auto flex justify-between text-[10px] text-muted-foreground">
        <span>{health === 'down' ? (n.gateway?.error || 'not reachable') : HEALTH_LABEL[health]}</span>
        <span>seen {ago(n.lastSeen)}</span>
      </div>
    </button>
  )
}

function Stat({ icon: Icon, label, value, of, tone }: { icon: typeof Server; label: string; value: number; of?: number; tone?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2">
      <Icon className={cn('h-4 w-4 text-muted-foreground', tone)} />
      <div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="text-lg font-semibold tabular-nums leading-tight">
          {value}{of != null && <span className="text-sm font-normal text-muted-foreground"> / {of}</span>}
        </div>
      </div>
    </div>
  )
}

/** Nodes up per poll, across the history the daemon keeps — the cluster's heartbeat. */
function heartbeat(nodes: NodeView[]): (number | null)[] {
  const len = Math.max(0, ...nodes.map((n) => n.history.length))
  const out: (number | null)[] = []
  for (let i = 0; i < len; i++) {
    let up = 0
    for (const n of nodes) {
      const s = n.history[n.history.length - len + i]
      if (s?.up) up++
    }
    out.push(nodes.length ? (100 * up) / nodes.length : null)
  }
  return out
}

/** Calls each node's gateway answered, by host — the row's upstream host is the node's. */
function servedByHost(rows: RoutingRow[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of rows) if (r.outcome === 'offloaded' && r.host) m.set(r.host, (m.get(r.host) ?? 0) + 1)
  return m
}

export function ClusterPage() {
  const { view, error } = useCluster()
  const [hours, setHours] = useState(24)
  const routing = useRouting(hours)
  const [hoverHost, setHoverHost] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const nodes = useMemo(() => view?.nodes ?? [], [view])
  const byHost = useMemo(() => new Map(nodes.map((n) => [n.host, n.name])), [nodes])
  const served = useMemo(() => servedByHost(routing.view?.rows ?? []), [routing.view])
  const s = view?.summary
  const beat = useMemo(() => heartbeat(nodes), [nodes])

  if (view && !view.configured) {
    return (
      <div className="p-6 space-y-2" data-testid="cluster-tab">
        <h1 className="text-2xl font-bold">Cluster</h1>
        <p className="text-sm text-muted-foreground">No cluster is configured: glass reads <code>~/.glass/cluster.json</code> (and, optionally, <code>cluster.key</code> and <code>cluster-status.key</code>).</p>
        {view.problems?.map((p) => <p key={p} className="text-sm text-destructive">{p}</p>)}
      </div>
    )
  }

  return (
    <div className="p-6 space-y-4" data-testid="cluster-tab">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Cluster</h1>
          <p className="text-sm text-muted-foreground">
            Every node&apos;s gateway, the models it serves, its GPUs and jobs — read over HTTP every {Math.round((view?.intervalMs ?? POLL_MS) / 1000)} s while this page is open.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2" title="Nodes up per poll">
          <Radio className={cn('h-4 w-4', s && s.up === s.nodes ? 'text-status-success' : s && s.up > 0 ? 'text-status-warning' : 'text-status-error')} />
          <Sparkline values={beat} className="h-6 w-40 text-status-success" />
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">polled {ago(view?.polledAt)}</span>
        </div>
      </div>

      {error && <div className="text-sm text-destructive">The cluster view is unavailable: {error}</div>}
      {[view?.keyProblem, view?.statusKeyProblem].filter(Boolean).map((p) => (
        <div key={p} className="rounded-md border border-status-warning-line bg-status-warning-subtle px-3 py-2 text-xs text-status-warning">{p}</div>
      ))}
      {view?.configured && ((!view.keySet && !view.keyProblem) || (!view.statusKeySet && !view.statusKeyProblem)) && (
        <div className="rounded-md border px-3 py-2 text-xs text-muted-foreground">
          {!view.keySet && !view.keyProblem && <div>No <code>cluster.key</code>: the gateways&apos; models are not read.</div>}
          {!view.statusKeySet && !view.statusKeyProblem && <div>No <code>cluster-status.key</code>: GPUs, jobs and endpoints are not read.</div>}
        </div>
      )}
      {view?.problems?.map((p) => <div key={p} className="text-xs text-status-warning">cluster.json: {p}</div>)}

      {s && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <Stat icon={Server} label="Nodes up" value={s.up} of={s.nodes} tone={s.down ? 'text-status-warning' : 'text-status-success'} />
          <Stat icon={Activity} label="Gateways healthy" value={s.gatewaysHealthy} of={s.nodes} />
          <Stat icon={Cpu} label="GPUs busy" value={s.gpusBusy} of={s.gpus} />
          <Stat icon={Boxes} label="Active jobs" value={s.jobs} />
          <Stat icon={Radio} label="Status services" value={s.statusServices} of={s.nodes} />
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="grid content-start gap-3 [grid-template-columns:repeat(auto-fill,minmax(210px,1fr))]">
          {!view && !error && <div className="text-sm text-muted-foreground">Polling the nodes…</div>}
          {nodes.map((n) => (
            <NodeTile
              key={n.name}
              n={n}
              served={served.get(n.host) ?? 0}
              lit={hoverHost === n.host}
              selected={selected === n.host}
              onSelect={() => setSelected(selected === n.host ? null : n.host)}
            />
          ))}
        </div>
        <aside className="space-y-2 rounded-lg border bg-card p-3 xl:sticky xl:top-4 xl:self-start">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">Routing</h2>
            <span className="text-[10px] text-muted-foreground">click a node to filter</span>
          </div>
          <RoutingHistory
            compact
            hours={hours}
            onHours={setHours}
            view={routing.view}
            error={routing.error}
            nodeOf={(h) => byHost.get(h)}
            onHoverHost={setHoverHost}
            hostFilter={selected}
            onClearHost={() => setSelected(null)}
          />
        </aside>
      </div>
    </div>
  )
}
