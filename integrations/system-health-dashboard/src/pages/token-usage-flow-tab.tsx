import { useEffect, useMemo, useState } from 'react'
import { getProviderColor, normalizeProvider } from '@/lib/providers'
import { normalizeModel } from '@/components/performance/models'

/**
 * Flow — the routing config drawn as the data flow it actually is.
 *
 * The Routing and Fallback tabs are correct but they are tables: to answer "what
 * goes where" you have to hold 35 route rows and 5 chains in your head at once.
 * This tab draws the same data — nothing here is a second source of truth, it is
 * all the payload the dialog already fetched from GET /api/llm/routing.
 *
 * Two things are deliberately kept visually distinct, because conflating them is
 * how the old dashboard misled:
 *
 *   CONFIG   — where a call is DECLARED to go. Solid edges, always drawn, even
 *              for a provider that has served nothing.
 *   TRAFFIC  — where calls ACTUALLY went in the selected window, from
 *              token_usage. Edge thickness and the per-account token counts.
 *
 * A thick edge to a provider the config does not name means traffic is arriving
 * by fallback, not by route — which is exactly the state the system has been in
 * while Copilot's quota is exhausted, and which no table on the other two tabs
 * makes visible.
 */

// ── Shapes ───────────────────────────────────────────────────────────────────

interface ProviderInfo {
  id: string
  account: string
  description: string
  enabled: boolean
  tools: boolean
  fgCapable: boolean
  availableModels?: string[]
  models: Partial<Record<'small' | 'medium' | 'high', string>>
}

interface RouteEntry { provider: string; complexity: string }
interface FallbackCandidate { provider: string; when: { network?: string[] } | null }

interface FlowData {
  providers: ProviderInfo[]
  routes: Record<string, RouteEntry>
  defaults: Record<string, RouteEntry>
  fallback: { chains: Record<string, FallbackCandidate[]> }
  runtime: { network: string; availableImpls: string[] }
}

interface UsageRow { provider: string; model: string; calls: number; total_tokens: number }

interface Props {
  data: FlowData
  proxyBase: string
  /** Hours of traffic to weight the edges by. Mirrors the page's own selector. */
  hours: number
}

// ── Geometry ─────────────────────────────────────────────────────────────────

// The canvas is wider than the account column ends (COL_ACCT + ACCT_W = 940)
// because the fallback chains bow out to the RIGHT of the accounts; that gutter
// is theirs. Shrink it and the chains clip at the viewBox edge.
const W = 1030
const COL_CALLER = 20
const CALLER_W = 232
const COL_HUB = 396
const HUB_W = 150
const COL_ACCT = 620
const ACCT_W = 320
const ROW_H = 46
const NODE_H = 36
const TOP = 56

/** Model a (provider, band) pair resolves to — mirrors the proxy's resolveRoute(). */
function modelFor(providers: ProviderInfo[], id: string, band: string): string {
  const p = providers.find(x => x.id === id)
  if (!p) return '—'
  if (band === 'from-caller') return 'per call'
  return p.models[band as 'small' | 'medium' | 'high']
    || (['small', 'medium', 'high'] as const).map(b => p.models[b]).find(Boolean)
    || '—'
}

function fmtTokens(n: number): string {
  if (!n) return '0'
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return String(n)
}

export function FlowTab({ data, proxyBase, hours }: Props) {
  const [usage, setUsage] = useState<UsageRow[] | null>(null)
  const [usageError, setUsageError] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)

  // Traffic is fetched separately from config on purpose: if token_usage is
  // unreachable the graph still draws the configuration, just without weights.
  // A flow diagram that renders nothing because a metrics call failed would be
  // worse than one that renders the config alone.
  useEffect(() => {
    let cancelled = false
    setUsageError(null)
    fetch(`${proxyBase}/api/token-usage/summary?hours=${encodeURIComponent(hours)}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(j => { if (!cancelled) setUsage(j.by_provider_model ?? j.by_model ?? []) })
      .catch(e => { if (!cancelled) { setUsage([]); setUsageError(e.message) } })
    return () => { cancelled = true }
  }, [proxyBase, hours])

  // ── Traffic, folded onto account ids ──
  const traffic = useMemo(() => {
    const byProvider = new Map<string, { tokens: number; calls: number }>()
    const byPair = new Map<string, number>()
    for (const r of usage ?? []) {
      const id = r.provider ? normalizeProvider(r.provider) : 'unknown'
      const cur = byProvider.get(id) ?? { tokens: 0, calls: 0 }
      cur.tokens += r.total_tokens || 0
      cur.calls += r.calls || 0
      byProvider.set(id, cur)
      const model = normalizeModel(r.model) || r.model
      byPair.set(`${id}/${model}`, (byPair.get(`${id}/${model}`) ?? 0) + (r.total_tokens || 0))
    }
    const max = Math.max(1, ...[...byProvider.values()].map(v => v.tokens))
    return { byProvider, byPair, max }
  }, [usage])

  // ── Caller nodes ──
  // Foreground routes stay individual: there are four and the agent identity is
  // the whole point of the route key. Background routes are collapsed by their
  // TARGET — 31 rows all pointing at three (provider, band) pairs is a fan-in,
  // and drawing 31 near-identical nodes would hide that rather than show it.
  const callers = useMemo(() => {
    const fg = Object.keys(data.routes)
      .filter(k => k.startsWith('fg-'))
      .sort()
      .map(k => ({
        id: k,
        label: k,
        sub: 'foreground',
        entry: data.routes[k],
        members: [k],
        kind: 'fg' as const,
      }))

    const bgKeys = Object.keys(data.routes).filter(k => !k.startsWith('fg-')).sort()
    const groups = new Map<string, string[]>()
    for (const k of bgKeys) {
      const e = data.routes[k]
      const key = `${e.provider}|${e.complexity}`
      groups.set(key, [...(groups.get(key) ?? []), k])
    }
    const bg = [...groups.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([key, members]) => {
        const [provider, complexity] = key.split('|')
        return {
          id: `bg:${key}`,
          label: `${members.length} background service${members.length === 1 ? '' : 's'}`,
          sub: complexity,
          entry: { provider, complexity },
          members,
          kind: 'bg' as const,
        }
      })

    const defs = Object.keys(data.defaults).sort().map(cls => ({
      id: `default:${cls}`,
      label: `default · ${cls}`,
      sub: 'anything not named',
      entry: data.defaults[cls],
      members: [],
      kind: 'default' as const,
    }))

    return [...fg, ...bg, ...defs]
  }, [data])

  // ── Account nodes ──
  // Ordered subscriptions first, then metered keys, then disabled — the same
  // grouping the config file uses, and the one that answers "who is paying".
  const accounts = useMemo(() => {
    const rank = (p: ProviderInfo) =>
      !p.enabled ? 2 : p.account.includes('subscription') ? 0 : 1
    return [...data.providers].sort((a, b) =>
      rank(a) - rank(b) || a.id.localeCompare(b.id))
  }, [data.providers])

  const reachable = (p: ProviderInfo) =>
    data.runtime.availableImpls.some(i => i === p.id || p.id.includes(i) || i.includes(p.id))

  // ── Edge sets ──
  const routedProviders = useMemo(
    () => new Set(callers.map(c => c.entry.provider)), [callers])

  // A provider is a fallback target if some chain names it. Drawn dashed, and
  // only from the chain head — a chain is flat, so B's own chain is not consulted.
  const fallbackEdges = useMemo(() => {
    const out: Array<{ from: string; to: string; guarded: boolean }> = []
    for (const [head, list] of Object.entries(data.fallback.chains)) {
      for (const c of list) out.push({ from: head, to: c.provider, guarded: !!c.when })
    }
    return out
  }, [data.fallback.chains])

  const callerY = (i: number) => TOP + i * ROW_H
  const acctY = (i: number) => TOP + i * ROW_H
  const height = Math.max(callers.length, accounts.length) * ROW_H + TOP + 40
  const hubY = TOP + (Math.max(callers.length, accounts.length) - 1) * ROW_H / 2

  const acctIndex = new Map(accounts.map((p, i) => [p.id, i]))

  // Stroke width from live traffic. Config-only edges keep a visible floor so a
  // declared-but-silent route never disappears — absence of traffic is a fact
  // worth seeing, not a reason to hide the edge.
  const weight = (providerId: string) => {
    const t = traffic.byProvider.get(providerId)?.tokens ?? 0
    return 1.25 + 5.75 * Math.sqrt(t / traffic.max)
  }

  const dim = (id: string) => hover !== null && hover !== id

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        The same routing config as the other two tabs, drawn as flow. <strong>Solid</strong> edges are
        declared routes; <strong>dashed</strong> are fallback chains. Edge thickness and the token
        counts are real traffic from the last {hours}h — so a thick dashed edge means work is landing
        somewhere the config never sent it.
        {usageError && (
          <span className="block mt-1 text-amber-600 dark:text-amber-500">
            Traffic unavailable ({usageError}) — showing configuration only.
          </span>
        )}
      </p>

      <div className="border rounded-md overflow-x-auto bg-muted/10">
        <svg
          viewBox={`0 0 ${W} ${height}`}
          width="100%"
          style={{ minWidth: 760, display: 'block' }}
          role="img"
          aria-label="LLM routing data flow: callers to proxy to provider accounts"
        >
          <defs>
            {/* markerUnits="userSpaceOnUse" is load-bearing: the default is
                strokeWidth, so an arrowhead on a traffic-weighted 7px edge would
                render seven times the size of one on a 1px edge — which it did,
                as a black blob covering the account card. context-stroke paints
                the head in the edge's own account colour instead of black. */}
            <marker id="flow-arrow" viewBox="0 0 10 10" refX="8" refY="5"
              markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9"
              orient="auto-start-reverse">
              <path d="M 0 1 L 9 5 L 0 9 z" fill="context-stroke" />
            </marker>
          </defs>

          {/* Column headings */}
          <text x={COL_CALLER} y={26} className="fill-muted-foreground" fontSize={11} fontWeight={600}>
            CALLERS — what asks for an LLM
          </text>
          <text x={COL_HUB} y={26} className="fill-muted-foreground" fontSize={11} fontWeight={600}>
            PROXY
          </text>
          <text x={COL_ACCT} y={26} className="fill-muted-foreground" fontSize={11} fontWeight={600}>
            ACCOUNTS — who gets billed
          </text>

          {/* ── Edges: caller → hub ── */}
          {callers.map((c, i) => {
            const y = callerY(i) + NODE_H / 2
            const x1 = COL_CALLER + CALLER_W
            const x2 = COL_HUB
            const mid = (x1 + x2) / 2
            return (
              <path
                key={`e-in-${c.id}`}
                d={`M ${x1} ${y} C ${mid} ${y}, ${mid} ${hubY + NODE_H / 2}, ${x2} ${hubY + NODE_H / 2}`}
                fill="none"
                stroke={getProviderColor(c.entry.provider)}
                strokeWidth={1.25}
                opacity={dim(c.id) ? 0.12 : 0.45}
              />
            )
          })}

          {/* ── Edges: hub → account (declared routes) ── */}
          {accounts.map((p, i) => {
            if (!routedProviders.has(p.id)) return null
            const y = acctY(i) + NODE_H / 2
            const x1 = COL_HUB + HUB_W
            const x2 = COL_ACCT
            const mid = (x1 + x2) / 2
            const color = getProviderColor(p.id)
            return (
              <path
                key={`e-out-${p.id}`}
                d={`M ${x1} ${hubY + NODE_H / 2} C ${mid} ${hubY + NODE_H / 2}, ${mid} ${y}, ${x2} ${y}`}
                fill="none"
                stroke={color}
                strokeWidth={weight(p.id)}
                opacity={dim(p.id) ? 0.15 : 0.9}
                markerEnd="url(#flow-arrow)"
              />
            )
          })}

          {/* ── Edges: fallback chains (account → account) ── */}
          {fallbackEdges.map((e, n) => {
            const fi = acctIndex.get(e.from)
            const ti = acctIndex.get(e.to)
            if (fi === undefined || ti === undefined) return null
            const y1 = acctY(fi) + NODE_H / 2
            const y2 = acctY(ti) + NODE_H / 2
            // Bow out to the right of the account column so chains never cross
            // the account cards they connect.
            const x = COL_ACCT + ACCT_W
            const bow = x + 22 + (n % 3) * 12
            return (
              <path
                key={`fb-${e.from}-${e.to}`}
                d={`M ${x} ${y1} C ${bow} ${y1}, ${bow} ${y2}, ${x} ${y2}`}
                fill="none"
                stroke={getProviderColor(e.to)}
                strokeWidth={Math.min(3, weight(e.to))}
                strokeDasharray={e.guarded ? '2 4' : '6 4'}
                opacity={dim(e.from) && dim(e.to) ? 0.12 : 0.65}
                markerEnd="url(#flow-arrow)"
              />
            )
          })}

          {/* ── Hub ── */}
          <g>
            <rect
              x={COL_HUB} y={hubY} width={HUB_W} height={NODE_H + 26} rx={6}
              className="fill-background stroke-border" strokeWidth={1.5}
            />
            <text x={COL_HUB + HUB_W / 2} y={hubY + 16} textAnchor="middle"
              className="fill-foreground" fontSize={12} fontWeight={600}>
              rapid-llm-proxy
            </text>
            <text x={COL_HUB + HUB_W / 2} y={hubY + 32} textAnchor="middle"
              className="fill-muted-foreground" fontSize={9.5}>
              route → band → model
            </text>
            <text x={COL_HUB + HUB_W / 2} y={hubY + 48} textAnchor="middle"
              className="fill-muted-foreground" fontSize={9.5}>
              network: {data.runtime.network}
            </text>
          </g>

          {/* ── Caller nodes ── */}
          {callers.map((c, i) => {
            const y = callerY(i)
            const color = getProviderColor(c.entry.provider)
            return (
              <g key={c.id}
                onMouseEnter={() => setHover(c.id)}
                onMouseLeave={() => setHover(null)}
                style={{ cursor: c.members.length > 1 ? 'help' : 'default' }}
                opacity={dim(c.id) ? 0.35 : 1}
              >
                <title>
                  {c.members.length > 1
                    ? `${c.members.join('\n')}\n\n→ ${c.entry.provider} / ${c.entry.complexity}`
                    : `${c.label} → ${c.entry.provider} / ${c.entry.complexity}`}
                </title>
                <rect x={COL_CALLER} y={y} width={CALLER_W} height={NODE_H} rx={5}
                  className="fill-background stroke-border" strokeWidth={1} />
                <rect x={COL_CALLER} y={y} width={3} height={NODE_H} rx={1.5} fill={color} />
                <text x={COL_CALLER + 10} y={y + 15} className="fill-foreground"
                  fontSize={11} fontWeight={c.kind === 'default' ? 400 : 600}
                  fontFamily={c.kind === 'fg' ? 'ui-monospace, monospace' : undefined}>
                  {c.label}
                </text>
                <text x={COL_CALLER + 10} y={y + 28} className="fill-muted-foreground" fontSize={9.5}>
                  {c.sub} → {modelFor(data.providers, c.entry.provider, c.entry.complexity)}
                </text>
              </g>
            )
          })}

          {/* ── Account nodes ── */}
          {accounts.map((p, i) => {
            const y = acctY(i)
            const color = getProviderColor(p.id)
            const t = traffic.byProvider.get(p.id)
            const off = !p.enabled
            const unreachable = p.enabled && !reachable(p)
            const routed = routedProviders.has(p.id)
            return (
              <g key={p.id}
                onMouseEnter={() => setHover(p.id)}
                onMouseLeave={() => setHover(null)}
                opacity={dim(p.id) ? 0.35 : 1}
                style={{ cursor: 'help' }}
              >
                <title>
                  {`${p.id} — ${p.account}`}
                  {p.description ? `\n${p.description}` : ''}
                  {`\n\nbands: ${(['small', 'medium', 'high'] as const)
                    .map(b => p.models[b] ? `${b}=${p.models[b]}` : null).filter(Boolean).join(', ') || 'none'}`}
                  {p.availableModels?.length ? `\ncan serve: ${p.availableModels.join(', ')}` : ''}
                  {`\ntools: ${p.tools ? 'yes' : 'no'}`}
                  {t ? `\n\nlast ${hours}h: ${t.calls} calls, ${fmtTokens(t.tokens)} tokens` : `\n\nlast ${hours}h: no traffic`}
                  {!routed ? '\n\nNot named by any route — reachable only via a fallback chain.' : ''}
                </title>
                <rect x={COL_ACCT} y={y} width={ACCT_W} height={NODE_H} rx={5}
                  className="fill-background stroke-border" strokeWidth={1}
                  strokeDasharray={off ? '4 3' : undefined} />
                <rect x={COL_ACCT} y={y} width={3} height={NODE_H} rx={1.5}
                  fill={color} opacity={off ? 0.4 : 1} />
                <text x={COL_ACCT + 10} y={y + 15} className="fill-foreground"
                  fontSize={11} fontWeight={600} opacity={off ? 0.55 : 1}>
                  {p.id}
                  {off && <tspan className="fill-muted-foreground" fontWeight={400} fontSize={9.5}>  disabled</tspan>}
                  {unreachable && <tspan className="fill-muted-foreground" fontWeight={400} fontSize={9.5}>  unreachable</tspan>}
                  {!routed && !off && <tspan className="fill-muted-foreground" fontWeight={400} fontSize={9.5}>  fallback only</tspan>}
                </text>
                <text x={COL_ACCT + 10} y={y + 28} className="fill-muted-foreground" fontSize={9.5}>
                  {p.account}{p.tools ? ' · tools' : ''}
                </text>
                <text x={COL_ACCT + ACCT_W - 10} y={y + 22} textAnchor="end"
                  fontSize={10.5} fontWeight={600}
                  fill={t?.tokens ? color : undefined}
                  className={t?.tokens ? undefined : 'fill-muted-foreground'}>
                  {t?.tokens ? fmtTokens(t.tokens) : '—'}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      {/* Legend — spelled out because thickness and dash carry meaning here. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <svg width="26" height="8"><line x1="0" y1="4" x2="26" y2="4" stroke="currentColor" strokeWidth="3" /></svg>
          declared route (thickness = tokens in window)
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="26" height="8"><line x1="0" y1="4" x2="26" y2="4" stroke="currentColor" strokeWidth="2" strokeDasharray="6 4" /></svg>
          fallback chain
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="26" height="8"><line x1="0" y1="4" x2="26" y2="4" stroke="currentColor" strokeWidth="2" strokeDasharray="2 4" /></svg>
          fallback with a guard
        </span>
        <span>hover a node to isolate it · hover for the full member list</span>
      </div>
    </div>
  )
}
