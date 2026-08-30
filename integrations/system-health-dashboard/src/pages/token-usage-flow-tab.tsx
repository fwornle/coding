import { useEffect, useMemo, useState } from 'react'
import { getProviderColor, normalizeProvider } from '@/lib/providers'
import { normalizeModel } from '@/components/performance/models'
import {
  DecisionLadder, LADDER_HEADER, ladderHeight, rungCenterY,
} from '@/components/llm-routing/decision-ladder'
import type { LadderRung } from '@/components/llm-routing/decision-ladder'
import { GATES, RUNG_OFFLOADED, describeTargets, evaluateOffload } from '@/components/llm-routing/offload-gates'
import type { OffloadPolicy } from '@/components/llm-routing/offload-gates'

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
 * somewhere the routes do not send it — the state the system is in whenever
 * Copilot's quota is exhausted, and which the route tables cannot show.
 *
 * WHAT THIS DIAGRAM CANNOT DO, and used to imply it could: the traffic behind an
 * edge is a per-ACCOUNT total, so it says where calls landed, never why. It
 * cannot attribute a call to the route that produced it, cannot separate a
 * fallback from a route change, and cannot distinguish a provider the config
 * never offered from one it offered that was unreachable. Those are recorded per
 * call now — Token Usage → Routing reads them back. Keep this as the shape of
 * the config; go there for what actually happened.
 *
 * Rendered in two places (the Settings dialog and the Routing tab) so the
 * picture cannot drift between them.
 */

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface ProviderInfo {
  id: string
  account: string
  description: string
  enabled: boolean
  tools: boolean
  fgCapable: boolean
  availableModels?: string[]
  models: Partial<Record<'small' | 'medium' | 'high', string>>
}

interface RouteEntry { provider: string; complexity: string; offload?: boolean }
interface FallbackCandidate { provider: string; when: { network?: string[] } | null }

export interface FlowData {
  providers: ProviderInfo[]
  routes: Record<string, RouteEntry>
  defaults: Record<string, RouteEntry>
  fallback: { chains: Record<string, FallbackCandidate[]> }
  runtime: { network: string; availableImpls: string[] }
  /**
   * The offload policy the gate column evaluates. Optional so a caller that
   * predates it still renders — the ladder then reports the policy as off, which
   * is what a proxy without the block does anyway.
   */
  semanticRouting?: OffloadPolicy | null
}

/**
 * Recorded counts and selection, supplied by a caller that has traffic.
 *
 * Absent, the ladder counts ROUTES from the config alone, which is all the
 * settings dialog can know. The unit is carried alongside the numbers rather
 * than inferred, because it is the thing that changes between the two.
 */
export interface GateOverlay {
  rungs: LadderRung[]
  unit: 'routes' | 'calls'
  activeRung?: number | null
  selectedRung?: number | null
  onSelectRung?: (r: number | null) => void
  unclassified?: { count: number } | null
}

interface UsageRow {
  provider: string; model: string; calls: number; total_tokens: number
  /** Optional: absent on a proxy that predates the cache columns, and 0 there. */
  cache_read_tokens?: number; cache_write_tokens?: number
}

interface Props {
  data: FlowData
  proxyBase: string
  /** Hours of traffic to weight the edges by. Mirrors the page's own selector. */
  hours: number
  /** Recorded counts and selection. Omitted, the ladder counts config routes. */
  gates?: GateOverlay
}

// ── Geometry ─────────────────────────────────────────────────────────────────

/**
 * One table, so the columns are readable as a budget rather than as eight
 * unrelated literals that have to be added up by hand to see they still fit.
 *
 *   caller    16 →  216     (200)
 *   lane A   216 →  264     ( 48)   caller edge to the rung that decided it
 *   gate     264 →  694     (430)
 *   lane B   694 →  742     ( 48)   rung exit to the account that served it
 *   account  742 → 1022     (280)
 *   gutter  1022 → 1120     ( 98)   fallback chains bow out here
 *
 * ── How wide the gate column has to be, measured rather than budgeted ───────
 * The gate column is carved out of the 368-unit dead band the decorative hub sat
 * in (x=396..546, three lines of static text). That band was NOT enough on its
 * own: the longest rung label is 55 characters at 10.5px (~300 units) and the
 * longest detail line 57 at 9px mono (~308), which with the 28-unit rung indent
 * and the ~70-unit count slot needs ~406. Given 276 the labels ran straight
 * through the lane and into the account cards.
 *
 * So W grows — but by 90 units, not the ~290 a naive fit would take. That
 * distinction is the whole point of the original constraint: the settings dialog
 * has a ~1104px content box, so W=1030 renders at 1.07x and W=1320 would render
 * at 0.84x, taking every 9.5px sub-label to an effective 7.9px. W=1120 renders
 * at 0.99x — 9.5px stays 9.4px, which is not a legibility change at all. The
 * caller and account columns give up 16 units each to keep the growth that
 * small; both still fit their longest label at 11px.
 */
const GEOM = {
  W: 1120,
  COL_CALLER: 16,
  CALLER_W: 200,
  COL_GATE: 264,
  GATE_W: 430,
  COL_ACCT: 742,
  ACCT_W: 280,
  ROW_H: 46,
  NODE_H: 36,
  TOP: 56,
} as const

const { W, COL_CALLER, CALLER_W, COL_GATE, GATE_W, COL_ACCT, ACCT_W, ROW_H, NODE_H, TOP } = GEOM

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

export function FlowTab({ data, proxyBase, hours, gates }: Props) {
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
      // Consumption, cache included. Edge thickness here is meant to show where
      // the volume actually goes; on total_tokens alone the account serving the
      // foreground work drew as a hairline against a background classifier,
      // because an Anthropic-wire prompt arrives almost entirely as cache reads.
      const rowTokens = (r.total_tokens || 0) + (r.cache_read_tokens || 0) + (r.cache_write_tokens || 0)
      const cur = byProvider.get(id) ?? { tokens: 0, calls: 0 }
      cur.tokens += rowTokens
      cur.calls += r.calls || 0
      byProvider.set(id, cur)
      const model = normalizeModel(r.model) || r.model
      byPair.set(`${id}/${model}`, (byPair.get(`${id}/${model}`) ?? 0) + rowTokens)
    }
    const max = Math.max(1, ...[...byProvider.values()].map(v => v.tokens))
    return { byProvider, byPair, max }
  }, [usage])

  // ── The offload verdict, per route ──
  // The gate column is not decoration in place of decoration: it decides which
  // account each caller actually reaches, so it has to be computed before the
  // caller nodes are grouped.
  const policy = data.semanticRouting ?? null

  const fgCapable = useMemo(() => {
    const set = new Set(data.providers.filter(p => p.fgCapable).map(p => p.id))
    return (id: string) => set.has(id)
  }, [data.providers])

  /**
   * The band a route resolves to.
   *
   * `from-caller` is not a band — it means the caller declares one per turn, and
   * when it declares nothing the proxy falls to the class default. Treating the
   * literal string as a band would put every from-caller route on the "band is
   * eligible" rung for a band that does not exist.
   */
  const bandOf = useMemo(() => (entry: RouteEntry, key: string): string => {
    if (entry.complexity !== 'from-caller') return entry.complexity
    const cls = key.startsWith('fg-') ? 'fg-chat' : 'background'
    return data.defaults[cls]?.complexity ?? 'high'
  }, [data.defaults])

  const verdictOf = useMemo(() => (key: string, entry: RouteEntry) =>
    evaluateOffload(policy, entry, key, bandOf(entry, key), data.runtime.network, fgCapable),
  [policy, bandOf, data.runtime.network, fgCapable])

  // ── Caller nodes ──
  // Foreground routes stay individual: there are four and the agent identity is
  // the whole point of the route key. Background routes are collapsed by their
  // OUTCOME — 31 rows arriving at three destinations is a fan-in, and drawing 31
  // near-identical nodes would hide that rather than show it.
  //
  // The collapse key is the resolved outcome (rung, final provider, band), NOT
  // the declared (provider, complexity) pair it used to be. Once the gate column
  // exists those two are different keys: `bg-kgbench-judge` and its neighbours
  // declare the same provider and band and leave the ladder at different rungs,
  // because `offload: false` pins the model that answers. Grouped by the declared
  // pair they would share one node and one edge, and the diagram would show them
  // exiting somewhere one of them does not.
  const callers = useMemo(() => {
    const fg = Object.keys(data.routes)
      .filter(k => k.startsWith('fg-'))
      .sort()
      .map(k => ({
        id: k,
        label: k,
        sub: 'foreground',
        entry: data.routes[k],
        verdict: verdictOf(k, data.routes[k]),
        members: [k],
        kind: 'fg' as const,
      }))

    const bgKeys = Object.keys(data.routes).filter(k => !k.startsWith('fg-')).sort()
    const groups = new Map<string, string[]>()
    for (const k of bgKeys) {
      const v = verdictOf(k, data.routes[k])
      const key = `${v.rung}|${v.provider}|${data.routes[k].complexity}`
      groups.set(key, [...(groups.get(key) ?? []), k])
    }
    const bg = [...groups.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([key, members]) => {
        const complexity = key.split('|')[2]
        const entry = data.routes[members[0]]
        return {
          id: `bg:${key}`,
          label: `${members.length} background service${members.length === 1 ? '' : 's'}`,
          sub: complexity,
          entry,
          verdict: verdictOf(members[0], entry),
          members,
          kind: 'bg' as const,
        }
      })

    const defs = Object.keys(data.defaults).sort().map(cls => ({
      id: `default:${cls}`,
      label: `default · ${cls}`,
      sub: 'anything not named',
      entry: data.defaults[cls],
      verdict: verdictOf(`defaults.${cls}`, data.defaults[cls]),
      members: [],
      kind: 'default' as const,
    }))

    return [...fg, ...bg, ...defs]
  }, [data, verdictOf])

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
    () => new Set(callers.map(c => c.verdict.provider)), [callers])

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
  // The ladder can now be the tallest element, so it is part of the height
  // budget rather than something assumed to fit between the two columns.
  const colH = Math.max(callers.length, accounts.length) * ROW_H
  const height = Math.max(colH, ladderHeight() + 8) + TOP + 40
  const ladderY = TOP + Math.max(0, (colH - ladderHeight())) / 2
  /** Absolute y of a rung's centre — where its edges attach. */
  const rungY = (i: number) => ladderY + rungCenterY(i)

  // Config-mode rung counts are ROUTES, not nodes: a collapsed background node
  // stands for however many route keys it holds, and counting nodes would report
  // 3 where the config has 31.
  const configRungs = useMemo<LadderRung[]>(() => {
    const counts = new Array(GATES.length).fill(0)
    for (const c of callers) counts[c.verdict.rung] += Math.max(c.members.length, 1)
    return GATES.map((_, i) => {
      let detail: string | undefined
      if (i === 1) {
        const pinned = callers.flatMap(c => (c.verdict.rung === 1 ? c.members : []))
        detail = pinned.length ? pinned.join(', ') : undefined
      } else if (i === 2 && policy) {
        detail = `offload_bands: ${policy.offloadBands.join(', ') || 'none'}`
      } else if (i === 3 && policy) {
        detail = describeTargets(policy)
      } else if (i === RUNG_OFFLOADED) {
        const moved = callers.find(c => c.verdict.rung === RUNG_OFFLOADED)
        detail = moved ? `→ ${moved.verdict.provider}` : undefined
      }
      return { count: counts[i], detail }
    })
  }, [callers, policy])

  const ladderRungs = gates?.rungs ?? configRungs
  const ladderUnit = gates?.unit ?? 'routes'

  /**
   * Rung exit → account, deduped by (rung, account) and weighted by traffic.
   *
   * Nine caller edges collapse to a handful of outgoing bundles this way. Drawing
   * one per caller would put every crossing back that routing them through the
   * ladder removed.
   */
  const exitEdges = useMemo(() => {
    const seen = new Map<string, { rung: number; provider: string }>()
    for (const c of callers) {
      const k = `${c.verdict.rung}|${c.verdict.provider}`
      if (!seen.has(k)) seen.set(k, { rung: c.verdict.rung, provider: c.verdict.provider })
    }
    return [...seen.values()]
  }, [callers])

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
        The routing config drawn as flow. <strong>Solid</strong> edges are
        declared routes; <strong>dashed</strong> are fallback chains. Edge thickness and the token
        counts are real traffic from the last {hours}h, aggregated per ACCOUNT — so a thick dashed
        edge means work is landing on a provider this config does not route to. Which route sent it,
        and whether it arrived by fallback, is recorded per call on the Routing tab; this diagram
        cannot tell you that.
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
          <text x={COL_GATE} y={26} className="fill-muted-foreground" fontSize={11} fontWeight={600}>
            rapid-llm-proxy — what it decides
          </text>
          <text x={COL_ACCT} y={26} className="fill-muted-foreground" fontSize={11} fontWeight={600}>
            ACCOUNTS — who gets billed
          </text>

          {/* ── Edges: caller → the rung that decided it ──
              Not caller → one hub. Landing each edge on its own rung is what
              makes "this caller's answer is this gate" a single saccade, and it
              is the only thing the gate column adds over the box it replaced. */}
          {callers.map((c, i) => {
            const y = callerY(i) + NODE_H / 2
            const x1 = COL_CALLER + CALLER_W
            const x2 = COL_GATE
            const mid = (x1 + x2) / 2
            const ry = rungY(c.verdict.rung)
            return (
              <path
                key={`e-in-${c.id}`}
                d={`M ${x1} ${y} C ${mid} ${y}, ${mid} ${ry}, ${x2} ${ry}`}
                fill="none"
                stroke={getProviderColor(c.verdict.provider)}
                strokeWidth={1.25}
                opacity={dim(c.id) ? 0.12 : 0.45}
              />
            )
          })}

          {/* ── Edges: rung exit → account ── */}
          {exitEdges.map(e => {
            const ai = acctIndex.get(e.provider)
            if (ai === undefined) return null
            const y = acctY(ai) + NODE_H / 2
            const x1 = COL_GATE + GATE_W
            const x2 = COL_ACCT
            const mid = (x1 + x2) / 2
            const ry = rungY(e.rung)
            const color = getProviderColor(e.provider)
            // The PASS rung is the only one that means the offload MOVED the
            // call, so it is the only exit drawn as anything other than "stayed
            // where the route said".
            const moved = e.rung === RUNG_OFFLOADED
            return (
              <path
                key={`e-out-${e.rung}-${e.provider}`}
                d={`M ${x1} ${ry} C ${mid} ${ry}, ${mid} ${y}, ${x2} ${y}`}
                fill="none"
                stroke={color}
                strokeWidth={moved ? Math.max(2, weight(e.provider)) : weight(e.provider)}
                opacity={dim(e.provider) ? 0.15 : 0.9}
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

          {/* ── The gate column ──
              This replaces a box that said `rapid-llm-proxy` over three lines of
              static text. Every question worth asking happened inside it, and
              none of them were drawn. Same component the standalone card uses, so
              the ladder cannot say two different things in two places. */}
          <DecisionLadder
            x={COL_GATE} y={ladderY} width={GATE_W}
            rungs={ladderRungs}
            unit={ladderUnit}
            activeRung={gates?.activeRung ?? null}
            selectedRung={gates?.selectedRung ?? null}
            onSelectRung={gates?.onSelectRung}
            unclassified={gates?.unclassified ?? null}
          />
          {/* Right-aligned into the ladder's own header row. Centred under the
              title it sat on top of it — the header is one line, not two. */}
          <text x={COL_GATE + GATE_W - 12} y={ladderY + 19} textAnchor="end"
            className="fill-muted-foreground" fontSize={9} fontFamily="ui-monospace, monospace">
            network: {data.runtime.network}
          </text>

          {/* ── Caller nodes ── */}
          {callers.map((c, i) => {
            // Coloured by where the call ACTUALLY ends up. An offloaded route
            // painted with the account it declared would put the stripe of a paid
            // subscription on a node whose work is served free and locally.
            const y = callerY(i)
            const color = getProviderColor(c.verdict.provider)
            const moved = c.verdict.offloadedFrom
            return (
              <g key={c.id}
                onMouseEnter={() => setHover(c.id)}
                onMouseLeave={() => setHover(null)}
                style={{ cursor: c.members.length > 1 ? 'help' : 'default' }}
                opacity={dim(c.id) ? 0.35 : 1}
              >
                <title>
                  {c.members.length > 1 ? `${c.members.join('\n')}\n\n` : ''}
                  {`declared: ${c.entry.provider} / ${c.entry.complexity}`}
                  {moved
                    ? `\noffloaded: → ${c.verdict.provider} (${c.entry.provider} becomes the first fallback)`
                    : `\ngate ${c.verdict.rung}: ${GATES[c.verdict.rung].label}`}
                  {c.verdict.reason ? `\n${c.verdict.reason}` : ''}
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
                  {c.sub} → {modelFor(data.providers, c.verdict.provider, c.entry.complexity)}
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
