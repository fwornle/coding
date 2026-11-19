import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, Cpu, Server, Boxes, Radio, X } from 'lucide-react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { cn } from '@/lib/utils'
import { useIsDark } from '@/lib/colors'
import { RoutingHistory, useEscape, useRouting, type CardCategory, type JobCard, type RoutingRow } from './routing'

/**
 * The Cluster page: a GPU cluster's nodes at a glance — /api/cluster (lib/glass/cluster.mjs,
 * served by glass's daemon, or by coding's observations API). Each tile is one node: its
 * gateway, the models it serves, its GPUs, its CPU and RAM, and the job on them. A clicked
 * tile opens over the grid with its charts at full size. The side panel is the history: the
 * routing decisions and the cluster's jobs, tinted by what each is; a call a node's gateway
 * answered lights that node.
 */

interface Gpu { index: number | null; name: string; utilPct: number | null; memUsedMib: number | null; memTotalMib: number | null; tempC: number | null }
interface Host { cpuCount: number | null; cpuPct: number | null; load: (number | null)[] | null; memTotalMib: number | null; memUsedMib: number | null; memAvailableMib: number | null }
interface Job { id: string; name: string; image: string; status: string; started: string | null; gpu: string | null; kind?: 'llm' | 'other' | null }
interface Sample { ts: string; up: boolean; utilPct: number | null; memPct: number | null; cpuPct?: number | null; ramPct?: number | null; latencyMs: number | null }
interface NodeView {
  name: string
  host: string
  up: boolean | null
  lastSeen: string | null
  gateway: { endpoint: string; reachable: boolean; healthy: boolean; status: string; backends: Record<string, boolean>; latencyMs: number | null; error: string } | null
  models: { ids: string[]; adapters?: string[]; error: string } | null
  status: { state: 'ok' | 'absent' | 'unauthorized' | 'error' | 'no-key'; error: string; ts: string | null; gpus: Gpu[]; host?: Host | null; jobs: Job[]; endpoints: { port: number; process: string }[] } | null
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
  reach?: 'reachable' | 'nodes-down' | 'unreachable' | null
  lastReachedAt?: string | null
  jobLog?: JobCard[]
  summary?: { nodes: number; up: number; down: number; gateways?: number; gatewaysHealthy: number; gpus: number; gpusBusy: number; jobs: number; statusServices: number }
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

type Health = 'ok' | 'degraded' | 'nogateway' | 'down' | 'unknown'
const healthOf = (n: NodeView): Health => {
  if (n.up == null) return 'unknown'
  if (!n.up) return 'down'
  // Up through its status service alone: a node that runs no gateway, not a failing one.
  if (!n.gateway?.reachable) return 'nogateway'
  return n.gateway.healthy ? 'ok' : 'degraded'
}
const DOT: Record<Health, string> = {
  ok: 'bg-status-success shadow-[0_0_6px_var(--st-success-fg)]',
  degraded: 'bg-status-warning',
  nogateway: 'bg-status-info',
  down: 'bg-status-error',
  unknown: 'bg-muted-foreground/50',
}
const HEALTH_LABEL: Record<Health, string> = { ok: 'gateway healthy', degraded: 'up, no live backend', nogateway: 'no gateway', down: 'not reachable', unknown: 'not polled yet' }

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
  const host = n.status?.state === 'ok' ? n.status.host ?? null : null
  const jobs = n.status?.state === 'ok' ? n.status.jobs : []
  // The trace: GPU utilisation, else the host's CPU (a node without a driver), else gateway latency.
  const gpuTrace = n.history.map((s) => (s.up ? s.utilPct : null))
  const cpuTrace = n.history.map((s) => (s.up ? s.cpuPct ?? null : null))
  const traceOf = gpuTrace.some((v) => v != null) ? 'GPU utilisation' : cpuTrace.some((v) => v != null) ? 'CPU load' : null
  const trace = traceOf === 'GPU utilisation' ? gpuTrace : cpuTrace
  const hasUtil = traceOf != null
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
          <div className="truncate font-mono text-[10px] text-muted-foreground">{health === 'nogateway' ? n.host : n.gateway?.endpoint ?? n.host}</div>
        </div>
      </div>

      {gpus.length > 0 ? (
        <div className="space-y-1">
          {gpus.map((g, i) => (
            <div key={i} className="space-y-0.5">
              <Bar pct={g.utilPct} label="gpu" tone={(g.utilPct ?? 0) >= 10 ? 'bg-status-success' : 'bg-muted-foreground/60'} />
              <Bar pct={g.memUsedMib != null && g.memTotalMib ? (100 * g.memUsedMib) / g.memTotalMib : null} label="vram" tone="bg-status-info" />
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

      {host && (
        <div className="space-y-0.5" data-testid={`cluster-host-${n.name}`}>
          <Bar pct={host.cpuPct} label="cpu" tone="bg-status-success" />
          <Bar pct={host.memUsedMib != null && host.memTotalMib ? (100 * host.memUsedMib) / host.memTotalMib : null} label="ram" tone="bg-status-info" />
          <div className="flex justify-between gap-2 text-[10px] text-muted-foreground">
            <span className="truncate">{host.cpuCount != null ? `${host.cpuCount} cores` : 'CPU'}{host.load?.[0] != null ? ` · load ${host.load[0].toFixed(1)}` : ''}</span>
            <span className="shrink-0 tabular-nums" title={host.memAvailableMib != null ? `${Math.round(host.memAvailableMib / 1024)} GiB available` : undefined}>
              {host.memTotalMib ? `${Math.round((host.memUsedMib ?? 0) / 1024)}/${Math.round(host.memTotalMib / 1024)} GiB` : ''}
            </span>
          </div>
        </div>
      )}

      <div className="flex items-center gap-1.5">
        <Activity className="h-3 w-3 shrink-0 text-muted-foreground" />
        {hasUtil
          ? <Sparkline values={trace} className="h-5 flex-1 text-status-success" />
          : <Sparkline values={latency} max={maxLatency} className="h-5 flex-1 text-status-info" />}
        <span className="w-12 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground" title={traceOf ?? 'gateway latency'}>
          {n.gateway?.latencyMs != null ? `${n.gateway.latencyMs} ms` : '—'}
        </span>
      </div>

      <div className="flex flex-wrap gap-1">
        {(n.models?.ids ?? []).map((m) => (
          <span key={m} className="max-w-full truncate rounded border px-1 font-mono text-[10px]">{m}</span>
        ))}
        {/* Without the gateway key the page's banner says it once; a tile names only its own trouble —
            and a node with no gateway has no models to fail, so its footer says it once. */}
        {n.models && n.models.ids.length === 0 && n.up && health !== 'nogateway' && n.models.error !== 'no gateway key' &&<span className="text-[10px] text-muted-foreground">{n.models.error || 'no models'}</span>}
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

// Seconds while the window is short: minute ticks would repeat one another.
const timeTick = (spanMs: number) => (ms: number) => new Date(ms).toLocaleTimeString([], spanMs < 15 * 60_000
  ? { hour: '2-digit', minute: '2-digit', second: '2-digit' } : { hour: '2-digit', minute: '2-digit' })

/** One metric over the node's history, with a time axis and a labelled value axis. */
function NodeChart({ title, points, unit, max, color, testId }: {
  title: string; points: { t: number; v: number | null }[]; unit: string; max?: number; color: string; testId: string
}) {
  const isDark = useIsDark()
  const axis = { grid: isDark ? '#2f2f2c' : '#e7e7e4', tick: isDark ? '#9c9c96' : '#6b6b66', surface: isDark ? '#1a1a19' : '#ffffff' }
  const has = points.some((p) => p.v != null)
  const spanMs = points.length > 1 ? points[points.length - 1].t - points[0].t : 0
  return (
    <div className="rounded-lg border bg-card p-3" data-testid={testId}>
      <div className="mb-1 text-xs font-medium">{title}</div>
      {has ? (
        <ResponsiveContainer width="100%" height={190}>
          <LineChart data={points} margin={{ top: 4, right: 12, bottom: 18, left: 4 }}>
            <CartesianGrid stroke={axis.grid} strokeDasharray="3 3" />
            <XAxis
              dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={timeTick(spanMs)} minTickGap={48}
              tick={{ fill: axis.tick, fontSize: 10 }} tickLine={false} axisLine={{ stroke: axis.grid }}
              label={{ value: 'time', position: 'insideBottom', offset: -12, fill: axis.tick, fontSize: 10 }}
            />
            <YAxis
              domain={max != null ? [0, max] : [0, 'auto']} width={52}
              tick={{ fill: axis.tick, fontSize: 10 }} tickLine={false} axisLine={{ stroke: axis.grid }}
              label={{ value: unit, angle: -90, position: 'insideLeft', offset: 10, fill: axis.tick, fontSize: 10 }}
            />
            <Tooltip
              contentStyle={{ background: axis.surface, border: `1px solid ${axis.grid}`, fontSize: 11 }}
              labelFormatter={(t) => new Date(Number(t)).toLocaleTimeString()}
              formatter={(v) => [`${v} ${unit}`, title]}
            />
            {/* Straight segments between samples: a smoothed curve would draw values never measured. */}
            <Line type="linear" dataKey="v" stroke={color} strokeWidth={1.75} dot={false} isAnimationActive={false} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex h-[190px] items-center justify-center text-xs text-muted-foreground">no samples yet</div>
      )}
    </div>
  )
}

/** A clicked node, over the grid: what it is, its charts at full size, its jobs and ports. */
function NodeDetail({ n, onClose }: { n: NodeView; onClose: () => void }) {
  const health = healthOf(n)
  const st = n.status?.state === 'ok' ? n.status : null
  const at = (s: Sample) => Date.parse(s.ts)
  const series = (pick: (s: Sample) => number | null | undefined) => n.history.map((s) => ({ t: at(s), v: s.up ? pick(s) ?? null : null }))
  const hasGpu = (st?.gpus.length ?? 0) > 0 || n.history.some((s) => s.utilPct != null)
  const span = n.history.length > 1 ? Math.round((at(n.history[n.history.length - 1]) - at(n.history[0])) / 60_000) : 0
  const adapters = new Set(n.models?.adapters ?? [])
  return (
    <section className="space-y-3 rounded-lg border bg-card p-4" data-testid={`cluster-detail-${n.name}`}>
      <div className="flex items-start gap-3">
        <span className={cn('mt-2 h-2.5 w-2.5 shrink-0 rounded-full', DOT[health])} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h2 className="font-mono text-lg font-semibold">{n.name}</h2>
            <span className="font-mono text-xs text-muted-foreground">{n.host}</span>
            <span className="text-xs text-muted-foreground">{health === 'down' ? (n.gateway?.error || 'not reachable') : HEALTH_LABEL[health]} · seen {ago(n.lastSeen)}</span>
          </div>
          <div className="text-[11px] text-muted-foreground">
            {span > 0 ? `the last ${span} min, sampled every 15 s while this page is open` : 'collecting samples — every 15 s while this page is open'}
          </div>
        </div>
        <button onClick={onClose} className="flex items-center gap-1 rounded border px-2 py-1 text-xs text-muted-foreground hover:bg-muted" data-testid="cluster-detail-close">
          <X className="h-3.5 w-3.5" />all nodes
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {hasGpu && <NodeChart testId="chart-gpu" title="GPU utilisation" unit="%" max={100} color="#22c55e" points={series((s) => s.utilPct)} />}
        {hasGpu && <NodeChart testId="chart-vram" title="GPU memory used" unit="%" max={100} color="#3b82f6" points={series((s) => s.memPct)} />}
        <NodeChart testId="chart-cpu" title="CPU busy" unit="%" max={100} color="#f59e0b" points={series((s) => s.cpuPct)} />
        <NodeChart testId="chart-ram" title="RAM used" unit="%" max={100} color="#a855f7" points={series((s) => s.ramPct)} />
        {(n.gateway?.reachable || n.history.some((s) => s.latencyMs != null)) && (
          <NodeChart testId="chart-latency" title="Gateway /health latency" unit="ms" color="#06b6d4" points={series((s) => s.latencyMs)} />
        )}
      </div>

      <div className="grid gap-3 text-xs md:grid-cols-3">
        <div className="space-y-1 rounded-md border p-2.5">
          <div className="font-medium">Hardware</div>
          {(st?.gpus ?? []).map((g, i) => (
            <div key={i} className="text-muted-foreground">
              {g.name || `GPU ${g.index ?? i}`} · {g.memTotalMib ? `${Math.round((g.memUsedMib ?? 0) / 1024)}/${Math.round(g.memTotalMib / 1024)} GiB` : '—'}{g.tempC != null ? ` · ${Math.round(g.tempC)}°C` : ''}
            </div>
          ))}
          {st?.host && (
            <div className="text-muted-foreground">
              {st.host.cpuCount ?? '?'} cores · load {st.host.load?.map((l) => (l == null ? '—' : l.toFixed(1))).join(' / ')} · RAM {Math.round((st.host.memUsedMib ?? 0) / 1024)}/{Math.round((st.host.memTotalMib ?? 0) / 1024)} GiB
            </div>
          )}
          {!st && <div className="text-muted-foreground">{n.status ? STATUS_NOTE[n.status.state] ?? n.status.error : 'no status yet'}</div>}
        </div>
        <div className="space-y-1 rounded-md border p-2.5">
          <div className="font-medium">Gateway {n.gateway?.reachable ? <span className="font-mono font-normal text-muted-foreground">{n.gateway.endpoint}</span> : null}</div>
          {!n.gateway?.reachable && <div className="text-muted-foreground">no gateway on this node</div>}
          {Object.entries(n.gateway?.backends ?? {}).map(([u, ok]) => (
            <div key={u} className="flex items-center gap-1.5 font-mono text-[11px]">
              <span className={cn('h-1.5 w-1.5 rounded-full', ok ? 'bg-status-success' : 'bg-status-error')} />{u}
            </div>
          ))}
          <div className="flex flex-wrap gap-1 pt-1">
            {(n.models?.ids ?? []).map((m) => (
              <span key={m} className={cn('rounded border px-1 font-mono text-[10px]', adapters.has(m) && 'border-dashed border-indigo-400/70')} title={adapters.has(m) ? 'adapter' : 'base model'}>{m}</span>
            ))}
          </div>
        </div>
        <div className="space-y-1 rounded-md border p-2.5">
          <div className="font-medium">Jobs</div>
          {(st?.jobs ?? []).length === 0 && <div className="text-muted-foreground">none reported</div>}
          {(st?.jobs ?? []).map((j) => (
            <div key={j.id || j.name} className="text-muted-foreground">
              <span className="font-medium text-foreground">{j.name || j.id}</span> · {j.status}{j.gpu != null ? ` · GPU ${j.gpu}` : ''}{j.started ? ` · ${ago(j.started)}` : ''}
            </div>
          ))}
          {(st?.endpoints ?? []).length > 0 && (
            <div className="pt-1 text-[11px] text-muted-foreground">listening: {st!.endpoints.map((e) => `${e.port}${e.process && e.process !== 'unknown' ? ` (${e.process})` : ''}`).join(', ')}</div>
          )}
        </div>
      </div>
    </section>
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
  const closeNode = useCallback(() => setSelected(null), [])
  useEscape(selected !== null, closeNode)
  const nodes = useMemo(() => view?.nodes ?? [], [view])
  const byHost = useMemo(() => new Map(nodes.map((n) => [n.host, n.name])), [nodes])
  const served = useMemo(() => servedByHost(routing.view?.rows ?? []), [routing.view])
  const s = view?.summary
  const beat = useMemo(() => heartbeat(nodes), [nodes])
  const offNet = view?.reach === 'unreachable'
  const detail = selected ? nodes.find((n) => n.host === selected) ?? null : null
  const adapters = useMemo(() => new Set(nodes.flatMap((n) => n.models?.adapters ?? [])), [nodes])
  // A card is cluster work when a node's gateway answered it: offloaded by the router, else an
  // agent configured with a cluster model; either may be served by an adapter.
  const categoryOf = useCallback((r: RoutingRow): CardCategory | null => {
    if (!r.host || !byHost.has(r.host)) return null
    return { kind: r.outcome === 'offloaded' ? 'offload' : 'agent', adapter: adapters.has(r.model) }
  }, [byHost, adapters])

  if (view && !view.configured) {
    return (
      <div className="p-6 space-y-2" data-testid="cluster-tab">
        <h1 className="text-2xl font-bold">Cluster</h1>
        <p className="text-sm text-muted-foreground">No cluster is configured on this machine: the page reads the node list from <code>~/.glass/cluster.json</code> (and, optionally, the keys <code>cluster.key</code> and <code>cluster-status.key</code> beside it).</p>
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
            Every node&apos;s gateway, the models it serves, its GPUs, CPU, RAM and jobs — read over HTTP every {Math.round((view?.intervalMs ?? POLL_MS) / 1000)} s while this page is open.
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
          {!view.statusKeySet && !view.statusKeyProblem && <div>No <code>cluster-status.key</code>: GPUs, CPU, RAM, jobs and endpoints are not read.</div>}
        </div>
      )}
      {view?.problems?.map((p) => <div key={p} className="text-xs text-status-warning">cluster.json: {p}</div>)}

      {/* From outside the cluster's network every tile would only repeat stale facts: say so once instead. */}
      {offNet && (
        <div className="rounded-lg border border-status-warning-line bg-status-warning-subtle px-4 py-3 text-sm" data-testid="cluster-unreachable">
          <div className="font-medium text-status-warning">The cluster is not reachable from this machine</div>
          <p className="mt-1 text-xs text-muted-foreground">
            None of the {s?.nodes ?? nodes.length} nodes answered and none refused a connection: no request found a route. The cluster is on a private
            network — it is reachable only from inside that network or over VPN. Connect, and this page fills in on its next poll.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {view?.lastReachedAt ? <>Last reached {ago(view.lastReachedAt)}.</> : <>Not reached since glass started.</>} Checking again every {Math.round((view?.intervalMs ?? POLL_MS) / 1000)} s.
          </p>
        </div>
      )}
      {view?.reach === 'nodes-down' && (
        <div className="rounded-md border border-status-error-line bg-status-error-subtle px-3 py-2 text-xs text-status-error" data-testid="cluster-nodes-down">
          The cluster&apos;s network is reachable, but no node answers on its gateway or status port.
        </div>
      )}

      {s && !offNet && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <Stat icon={Server} label="Nodes up" value={s.up} of={s.nodes} tone={s.down ? 'text-status-warning' : 'text-status-success'} />
          <Stat icon={Activity} label="Gateways healthy" value={s.gatewaysHealthy} of={s.gateways ?? s.nodes} />
          <Stat icon={Cpu} label="GPUs busy" value={s.gpusBusy} of={s.gpus} />
          <Stat icon={Boxes} label="Active jobs" value={s.jobs} />
          <Stat icon={Radio} label="Status services" value={s.statusServices} of={s.nodes} />
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="grid content-start gap-3 [grid-template-columns:repeat(auto-fill,minmax(210px,1fr))]">
          {!view && !error && <div className="text-sm text-muted-foreground">Polling the nodes…</div>}
          {!offNet && detail && <div className="col-span-full"><NodeDetail n={detail} onClose={() => setSelected(null)} /></div>}
          {!offNet && !detail && nodes.map((n) => (
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
            categoryOf={categoryOf}
            jobs={offNet ? [] : view?.jobLog}
          />
        </aside>
      </div>
    </div>
  )
}
