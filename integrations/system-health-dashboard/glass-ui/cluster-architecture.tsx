import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import type { ClusterView, NodeView } from './cluster'
import { hostOf, useOffload } from './offload'

/**
 * The Cluster page's architecture view: how the processes on this machine reach the cluster,
 * which credential each connection carries, and what answers on the far side. Drawn from what
 * glass observes — cluster.json, each gateway's /health (its backends), the status services,
 * the offload settings and the routing history — so it shows the cluster as it is, not as
 * a deployment intended it.
 */

type Tone = 'ok' | 'warn' | 'bad' | 'off'
const STROKE: Record<Tone, string> = {
  ok: 'text-status-success',
  warn: 'text-status-warning',
  bad: 'text-status-error',
  off: 'text-muted-foreground/60',
}

interface Gateway { node: NodeView; healthy: boolean; refused: boolean; backends: { url: string; name: string; ok: boolean }[] }

const W = 1100
const HOST_X = 16
const HOST_W = 270
const BOX_H = 62
const NET_X = 318
const NET_W = 110
const GW_X = 460
const GW_W = 260
const BE_X = 790
const BE_W = 290

/** A box with a title and a line under it; dashed when it is outside glass or not seen. */
function Box({ x, y, w, h = BOX_H, title, sub, tone = 'off', dashed, testId }: {
  x: number; y: number; w: number; h?: number; title: string; sub?: string; tone?: Tone; dashed?: boolean; testId?: string
}) {
  return (
    <g data-testid={testId}>
      <rect x={x} y={y} width={w} height={h} rx={8} className={cn('fill-card stroke-current', STROKE[tone])} strokeWidth={1.5} strokeDasharray={dashed ? '5 4' : undefined} />
      <text x={x + 12} y={y + 24} className="fill-foreground text-[13px] font-semibold">{title}</text>
      {sub && <text x={x + 12} y={y + 44} className="fill-muted-foreground text-[11px]">{sub}</text>}
    </g>
  )
}

/** A connection from a source's right edge to a target's left edge, its credential on the wire. */
function Wire({ from, to, label, tone, dashed, at = 0.5 }: {
  from: [number, number]; to: [number, number]; label: string; tone: Tone; dashed?: boolean; at?: number
}) {
  const [x1, y1] = from
  const [x2, y2] = to
  const dx = (x2 - x1) / 2
  const d = `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`
  // The label sits on the curve: a cubic's point at t, close enough with the control points above.
  const t = at
  const bx = (1 - t) ** 3 * x1 + 3 * (1 - t) ** 2 * t * (x1 + dx) + 3 * (1 - t) * t ** 2 * (x2 - dx) + t ** 3 * x2
  const by = (1 - t) ** 3 * y1 + 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t ** 2 * y2 + t ** 3 * y2
  const lw = label.length * 6.4 + 12
  return (
    <g className={STROKE[tone]}>
      <path d={d} fill="none" className="stroke-current" strokeWidth={1.75} strokeDasharray={dashed ? '5 4' : undefined} markerEnd={`url(#arch-arrow-${tone})`} />
      <rect x={bx - lw / 2} y={by - 9} width={lw} height={18} rx={9} className="fill-background stroke-current" strokeWidth={1} />
      <text x={bx} y={by + 4} textAnchor="middle" className="fill-foreground font-mono text-[10.5px]">{label}</text>
    </g>
  )
}

const gatewayTone = (g: Gateway): Tone => (g.refused ? 'bad' : g.healthy ? 'ok' : 'warn')
const gatewayNote = (g: Gateway) => (g.refused ? 'refuses cluster.key' : g.healthy ? 'healthy' : 'up, no live backend')

export function ClusterArchitecture({ view, agentHosts }: { view: ClusterView; agentHosts: Set<string> }) {
  const { view: offload } = useOffload()
  const nodes = useMemo(() => view.nodes ?? [], [view])
  const gatewayPort = view.gatewayPort ?? 8000
  const statusPort = view.statusPort ?? 8099
  const nameOf = useMemo(() => new Map(nodes.map((n) => [n.host, n.name])), [nodes])

  const gateways: Gateway[] = useMemo(() => nodes.filter((n) => n.gateway?.reachable).map((n) => ({
    node: n,
    healthy: Boolean(n.gateway?.healthy),
    refused: /refused/.test(n.models?.error ?? ''),
    backends: Object.entries(n.gateway?.backends ?? {}).map(([url, ok]) => {
      const host = hostOf(url)
      const bare = host.replace(/:\d+$/, '')
      return { url, name: `${nameOf.get(bare) ?? bare}${host.slice(bare.length)}`, ok }
    }),
  })), [nodes, nameOf])

  const statusUp = nodes.filter((n) => n.status?.state === 'ok').length
  const sshd = nodes.filter((n) => n.status?.state === 'ok' && n.status.endpoints.some((e) => e.port === 22)).length
  const jobs = nodes.reduce((k, n) => k + (n.status?.state === 'ok' ? n.status.jobs.length : 0), 0)

  // Offload: its target is a gateway glass already polls, or an endpoint outside cluster.json.
  const oc = offload?.config
  const offloadOn = Boolean(oc?.enabled)
  const targetHost = oc?.target.url ? hostOf(oc.target.url) : ''
  const targetGw = gateways.find((g) => g.node.gateway?.endpoint === targetHost)
  const offloadAgents = oc ? Object.entries(oc.agents).filter(([, on]) => on).map(([a]) => a) : []
  const offloadTone: Tone = !offloadOn ? 'off' : offload?.health.reachable ? 'ok' : 'bad'
  // Offload to a cluster gateway uses cluster.key (offload-store.mjs); offload.key is only for an endpoint outside it.
  const offloadKey = offload?.keyFile ?? 'offload.key'

  // Right column, top to bottom: gateways (as tall as their backend lists), an offload target
  // outside the cluster, the status services, SSH.
  const rows: { key: string; y: number; h: number }[] = []
  let y = 56
  for (const g of gateways) {
    const h = Math.max(BOX_H, 30 + g.backends.length * 26)
    rows.push({ key: g.node.name, y, h })
    y += h + 18
  }
  const extTarget = offloadOn && targetHost && !targetGw
  const extY = y
  if (extTarget) y += BOX_H + 18
  const statusY = y
  const sshY = statusY + BOX_H + 18
  const H = sshY + BOX_H + 28
  const mid = (r: { y: number; h: number }) => r.y + r.h / 2
  const rowOf = (name: string) => rows.find((r) => r.key === name)!

  // Left column, spread over the same height.
  const hostSlots = 4
  const hostGap = (H - 56 - 28 - hostSlots * BOX_H) / (hostSlots - 1)
  const hostY = (i: number) => 56 + i * (BOX_H + hostGap)
  const out = (i: number): [number, number] => [HOST_X + HOST_W, hostY(i) + BOX_H / 2]

  const agentGws = gateways.filter((g) => agentHosts.has(g.node.host))

  return (
    <div className="space-y-4" data-testid="cluster-architecture">
      <div className="overflow-x-auto rounded-lg border bg-card p-3">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[860px]" role="img" aria-label="How this machine's processes reach the cluster">
          <defs>
            {/* One arrowhead per tone: a marker takes its colour from where it is defined, not from the path using it. */}
            {(Object.keys(STROKE) as Tone[]).map((t) => (
              <marker key={t} id={`arch-arrow-${t}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" className={cn('fill-current', STROKE[t])} />
              </marker>
            ))}
          </defs>

          {/* The three regions. */}
          <rect x={4} y={8} width={HOST_W + 24} height={H - 16} rx={10} className="fill-muted/30 stroke-border" />
          <text x={16} y={34} className="fill-foreground text-[12px] font-semibold uppercase tracking-wide">This machine</text>
          <rect x={NET_X} y={8} width={NET_W} height={H - 16} rx={10} className="fill-none stroke-border" strokeDasharray="4 4" />
          <text x={NET_X + NET_W / 2} y={30} textAnchor="middle" className="fill-muted-foreground text-[10.5px]">private network</text>
          <text x={NET_X + NET_W / 2} y={44} textAnchor="middle" className="fill-muted-foreground text-[10.5px]">LAN or VPN</text>
          <text x={NET_X + NET_W / 2} y={H - 22} textAnchor="middle" className={cn('text-[10.5px] font-medium',
            view.reach === 'reachable' ? 'fill-status-success' : view.reach ? 'fill-status-error' : 'fill-muted-foreground')}>
            {view.reach === 'reachable' ? 'reachable' : view.reach === 'nodes-down' ? 'nodes down' : view.reach === 'unreachable' ? 'no route' : 'not polled'}
          </text>
          <rect x={GW_X - 20} y={8} width={W - GW_X + 16} height={H - 16} rx={10} className="fill-muted/30 stroke-border" />
          <text x={GW_X - 6} y={34} className="fill-foreground text-[12px] font-semibold uppercase tracking-wide">Cluster · {nodes.length} nodes</text>
          <text x={BE_X} y={34} className="fill-muted-foreground text-[11px]">backends, from each gateway&apos;s /health</text>

          {/* This machine. */}
          <Box testId="arch-offload" x={HOST_X} y={hostY(0)} w={HOST_W} tone={offloadTone} dashed={!offloadOn}
            title="glass proxy · offload"
            sub={offloadOn ? `${offloadAgents.join(', ') || 'no agent'} · ${oc!.bands.join(', ')} band${oc!.bands.length === 1 ? '' : 's'}` : 'offload is off'} />
          <Box testId="arch-agents" x={HOST_X} y={hostY(1)} w={HOST_W} tone={agentGws.length ? 'ok' : 'off'} dashed={!agentGws.length}
            title="agents with a cluster provider"
            sub={agentGws.length ? 'call a gateway directly, no proxy' : 'none seen in the routing window'} />
          <Box testId="arch-poller" x={HOST_X} y={hostY(2)} w={HOST_W} tone={view.reach === 'reachable' ? 'ok' : 'warn'}
            title="glass · Cluster page"
            sub={`polls every ${Math.round((view.intervalMs ?? 15000) / 1000)} s while open`} />
          <Box testId="arch-ssh-client" x={HOST_X} y={hostY(3)} w={HOST_W} dashed
            title="job submitters (outside glass)"
            sub="log in over SSH, start a container" />

          {/* The cluster. */}
          {gateways.length === 0 && (
            <text x={GW_X} y={80} className="fill-muted-foreground text-[12px]">No gateway answers on :{gatewayPort}.</text>
          )}
          {gateways.map((g) => {
            const r = rowOf(g.node.name)
            return (
              <g key={g.node.name} data-testid={`arch-gateway-${g.node.name}`}>
                <Box x={GW_X} y={r.y} w={GW_W} h={r.h} tone={gatewayTone(g)}
                  title={`${g.node.name} · gateway :${gatewayPort}`} sub={`${gatewayNote(g)} · ${g.node.models?.ids.length ?? 0} models`} />
                {g.backends.length === 0 && (
                  <text x={BE_X} y={mid(r) + 4} className="fill-muted-foreground text-[11px]">its /health names no backend</text>
                )}
                {g.backends.map((b, i) => {
                  const by = r.y + 15 + i * 26
                  return (
                    <g key={b.url} className={STROKE[b.ok ? 'ok' : 'bad']}>
                      <path d={`M${GW_X + GW_W},${mid(r)} C${GW_X + GW_W + 35},${mid(r)} ${BE_X - 35},${by + 10} ${BE_X},${by + 10}`}
                        fill="none" className="stroke-current" strokeWidth={1.25} markerEnd={`url(#arch-arrow-${b.ok ? 'ok' : 'bad'})`} />
                      <rect x={BE_X} y={by} width={BE_W - 16} height={20} rx={10} className="fill-card stroke-current" strokeWidth={1.25} />
                      <text x={BE_X + 10} y={by + 14} className="fill-foreground font-mono text-[11px]">{b.name}</text>
                      <text x={BE_X + BE_W - 26} y={by + 14} textAnchor="end" className="fill-muted-foreground text-[10.5px]">{b.ok ? 'up' : 'down'}</text>
                    </g>
                  )
                })}
              </g>
            )
          })}
          {extTarget && (
            <Box testId="arch-offload-target" x={GW_X} y={extY} w={GW_W} tone={offloadTone}
              title={`offload endpoint · ${oc!.target.name || 'target'}`} sub={`${targetHost} — not in cluster.json`} />
          )}
          <Box testId="arch-status" x={GW_X} y={statusY} w={GW_W} tone={statusUp ? 'ok' : view.statusKeySet ? 'warn' : 'off'}
            title={`status service :${statusPort}`} sub={`answers on ${statusUp} of ${nodes.length} nodes · read-only`} />
          <Box testId="arch-sshd" x={GW_X} y={sshY} w={GW_W} dashed
            title="sshd :22" sub={`listening on ${sshd} of ${statusUp} nodes with status · ${jobs} jobs`} />
          <text x={BE_X} y={statusY + 26} className="fill-muted-foreground text-[11px]">GPUs, CPU, RAM, jobs and ports</text>
          <text x={BE_X} y={statusY + 42} className="fill-muted-foreground text-[11px]">of the node it runs on</text>
          <text x={BE_X} y={sshY + 26} className="fill-muted-foreground text-[11px]">jobs show up here through the status</text>
          <text x={BE_X} y={sshY + 42} className="fill-muted-foreground text-[11px]">service — glass itself never logs in</text>

          {/* The wires, each labelled with the credential it carries. */}
          {offloadOn && targetGw && <Wire from={out(0)} to={[GW_X, mid(rowOf(targetGw.node.name)) - 10]} label={offloadKey} tone={offloadTone} at={0.22} />}
          {extTarget && <Wire from={out(0)} to={[GW_X, extY + BOX_H / 2]} label={offloadKey} tone={offloadTone} at={0.22} />}
          {agentGws.map((g) => (
            <Wire key={g.node.name} from={out(1)} to={[GW_X, mid(rowOf(g.node.name))]} label="gateway key" tone="ok" at={0.5} />
          ))}
          {gateways.map((g) => (
            <Wire key={g.node.name} from={out(2)} to={[GW_X, mid(rowOf(g.node.name)) + 10]}
              label="cluster.key" tone={!view.keySet ? 'off' : g.refused ? 'bad' : 'ok'} dashed={!view.keySet} at={0.7} />
          ))}
          <Wire from={out(2)} to={[GW_X, statusY + BOX_H / 2]} label="cluster-status.key"
            tone={!view.statusKeySet ? 'off' : statusUp ? 'ok' : 'warn'} dashed={!view.statusKeySet} at={0.62} />
          <Wire from={out(3)} to={[GW_X, sshY + BOX_H / 2]} label="SSH login" tone="off" dashed at={0.5} />
        </svg>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="rounded-lg border bg-card p-3">
          <h3 className="mb-2 text-sm font-semibold">What each connection carries</h3>
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr><th className="py-1 pr-3 font-medium">Credential</th><th className="py-1 pr-3 font-medium">Sent by</th><th className="py-1 pr-3 font-medium">To</th><th className="py-1 font-medium">Here</th></tr>
            </thead>
            <tbody className="align-top [&_td]:py-1 [&_td]:pr-3">
              <tr className="border-t"><td className="font-mono">{offloadKey}</td><td>the proxy, for an offloaded call</td><td className="font-mono">{targetHost || '—'} /chat/completions</td><td>{offload?.keySet ? 'set' : 'not set'}</td></tr>
              <tr className="border-t"><td className="font-mono">cluster.key</td><td>the Cluster page{offloadKey === 'cluster.key' ? ', and offload' : ''}</td><td className="font-mono">each gateway&apos;s /v1/models</td><td>{view.keySet ? 'set' : 'not set'}</td></tr>
              <tr className="border-t"><td className="font-mono">—</td><td>the Cluster page</td><td className="font-mono">each gateway&apos;s /health</td><td>no key</td></tr>
              <tr className="border-t"><td className="font-mono">cluster-status.key</td><td>the Cluster page</td><td className="font-mono">:{statusPort}/status on every node</td><td>{view.statusKeySet ? 'set' : 'not set'}</td></tr>
              <tr className="border-t"><td>the gateway key</td><td>agents configured with the cluster as a provider</td><td className="font-mono">a gateway&apos;s /v1/*</td><td>in that agent&apos;s config</td></tr>
              <tr className="border-t"><td>an SSH login</td><td>job submitters, outside glass</td><td className="font-mono">sshd :22</td><td>—</td></tr>
            </tbody>
          </table>
        </div>
        <div className="space-y-2 rounded-lg border bg-card p-3 text-xs">
          <h3 className="text-sm font-semibold">Reading it</h3>
          <p className="text-muted-foreground">A gateway is the cluster&apos;s only door for model calls; it checks one key and forwards to its backends. The status service is a separate, read-only door with its own key, so a status viewer holds nothing that can run inference.</p>
          {offload?.keyProblem && (
            <p className="rounded-md border border-status-warning-line bg-status-warning-subtle px-2 py-1.5 text-status-warning" data-testid="arch-key-problem">{offload.keyProblem}</p>
          )}
          {gateways.filter((g) => g.refused).map((g) => (
            <p key={g.node.name} className="rounded-md border border-status-error-line bg-status-error-subtle px-2 py-1.5 text-status-error">
              {g.node.name}&apos;s gateway refuses <span className="font-mono">cluster.key</span>: it was deployed with another key.
            </p>
          ))}
          {offloadOn && targetGw && gateways.length > 1 && (
            <p className="text-muted-foreground">Offload calls {targetGw.node.name} directly, not the other gateway{gateways.length > 2 ? 's' : ''} glass sees.</p>
          )}
        </div>
      </div>
    </div>
  )
}
