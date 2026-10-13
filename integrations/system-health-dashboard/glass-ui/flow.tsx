import { useMemo, useState } from 'react'
import { getProviderColor } from '@/lib/providers'
import { normalizeModel } from '@/components/performance/models'

/**
 * The Models tab drawn as flow: agent → the model it chose → the account that
 * answered. The same visual language as the dashboard's Token Usage → Flow, minus
 * its middle column: coding's proxy decides where a call goes, glass decides
 * nothing, so there is no decision to draw — every edge is the agent's own choice.
 * Read-only, from the rows the Models table already shows (/api/models).
 */

export interface FlowGroup {
  agent: string
  model: string
  provider: string
  upstream: string
  call_kind: string
  calls: number
  input: number
  output: number
  cache_read: number
  cache_write: number
}

interface Props {
  groups: FlowGroup[]
  /** The account's display name — the Models table's "Answered by". */
  answeredBy: (provider: string) => string
}

const W = 1120
const COL_AGENT = 16
const AGENT_W = 220
const COL_MODEL = 450
const MODEL_W = 240
const COL_ACCT = 860
const ACCT_W = 244
const ROW_H = 46
const NODE_H = 36
const TOP = 56

const tokensOf = (r: FlowGroup) => r.input + r.output + r.cache_read + r.cache_write

function fmtTokens(n: number): string {
  if (!n) return '0'
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return String(n)
}

// SVG text does not ellipsize; a host name or model id that runs into the next
// column reads as part of it.
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s)

interface Node { id: string; label: string; sub: string; tokens: number; color: string }
interface Edge { from: string; to: string; tokens: number; side: boolean; color: string }

function addTo<K>(m: Map<K, number>, k: K, v: number) { m.set(k, (m.get(k) ?? 0) + v) }

export function ModelFlow({ groups, answeredBy }: Props) {
  const [hover, setHover] = useState<string | null>(null)

  const g = useMemo(() => {
    const agentTok = new Map<string, number>()
    const agentCalls = new Map<string, number>()
    const modelTok = new Map<string, number>()
    const modelCalls = new Map<string, { main: number; side: number }>()
    const acctTok = new Map<string, number>()
    const acctHosts = new Map<string, Set<string>>()
    // The account that carried most of an agent's tokens colours its node, as an
    // account colours a caller in the dashboard's flow.
    const agentAcct = new Map<string, Map<string, number>>()
    const left = new Map<string, Edge>()
    const right = new Map<string, Edge>()

    for (const r of groups) {
      const t = tokensOf(r)
      const agent = `a:${r.agent || '—'}`
      const model = `m:${normalizeModel(r.model) || '—'}`
      // By the account that answered, not the provider spelling: rows say both
      // `github-copilot` and `gh-copilot` for one Copilot login.
      const acct = `p:${answeredBy(r.provider) || '—'}`
      const side = r.call_kind === 'side'
      const color = getProviderColor(r.provider)
      addTo(agentTok, agent, t)
      addTo(agentCalls, agent, r.calls)
      addTo(modelTok, model, t)
      const mc = modelCalls.get(model) ?? { main: 0, side: 0 }
      mc[side ? 'side' : 'main'] += r.calls
      modelCalls.set(model, mc)
      addTo(acctTok, acct, t)
      if (r.upstream) acctHosts.set(acct, (acctHosts.get(acct) ?? new Set()).add(r.upstream))
      const aa = agentAcct.get(agent) ?? new Map<string, number>()
      addTo(aa, r.provider, t)
      agentAcct.set(agent, aa)
      for (const [m, from, to] of [[left, agent, model], [right, model, acct]] as const) {
        const k = `${from}|${to}|${r.provider}|${side}`
        const e = m.get(k) ?? { from, to, tokens: 0, side, color }
        e.tokens += t
        m.set(k, e)
      }
    }

    const byTokens = (m: Map<string, number>) => [...m.keys()].sort((a, b) => (m.get(b) ?? 0) - (m.get(a) ?? 0))
    const agents: Node[] = byTokens(agentTok).map((id) => {
      const top = [...(agentAcct.get(id) ?? new Map()).entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
      const n = agentCalls.get(id) ?? 0
      return { id, label: id.slice(2), sub: `${n} call${n === 1 ? '' : 's'}`, tokens: agentTok.get(id) ?? 0, color: getProviderColor(top) }
    })
    const models: Node[] = byTokens(modelTok).map((id) => {
      const c = modelCalls.get(id) ?? { main: 0, side: 0 }
      const parts = [c.main && `${c.main} loop`, c.side && `${c.side} side`].filter(Boolean)
      return { id, label: id.slice(2), sub: `${parts.join(' · ')} call${c.main + c.side === 1 ? '' : 's'}`, tokens: modelTok.get(id) ?? 0, color: '#64748b' }
    })
    const acctColor = new Map(groups.map((r) => [`p:${answeredBy(r.provider) || '—'}`, getProviderColor(r.provider)]))
    const accounts: Node[] = byTokens(acctTok).map((id) => ({
      id,
      label: id.slice(2),
      sub: [...(acctHosts.get(id) ?? [])].join(', ') || 'host not recorded',
      tokens: acctTok.get(id) ?? 0,
      color: acctColor.get(id) ?? getProviderColor(''),
    }))
    const max = Math.max(1, ...[...left.values()].map((e) => e.tokens))
    return { agents, models, accounts, left: [...left.values()], right: [...right.values()], max }
  }, [groups, answeredBy])

  if (!groups.length) return null

  const rows = Math.max(g.agents.length, g.models.length, g.accounts.length)
  const height = TOP + rows * ROW_H + 8
  // Shorter columns are centred against the tallest, so a fan-in reads as one.
  const yOf = (list: Node[]) => {
    const off = ((rows - list.length) * ROW_H) / 2
    return new Map(list.map((n, i) => [n.id, TOP + off + i * ROW_H]))
  }
  const ys = new Map([...yOf(g.agents), ...yOf(g.models), ...yOf(g.accounts)])
  const weight = (t: number) => 1.25 + 5.75 * Math.sqrt(t / g.max)
  const touches = (e: Edge) => hover === null || e.from === hover || e.to === hover
    // A hovered agent also lights its model → account edges that carry its traffic,
    // approximated by the model it reached; exact per-agent splits are in the table.
    || (hover.startsWith('a:') && g.left.some((l) => l.from === hover && l.to === e.from && l.color === e.color))
    || (hover.startsWith('p:') && g.right.some((r) => r.to === hover && r.from === e.to && r.color === e.color))

  const edge = (e: Edge, x1: number, x2: number) => {
    const y1 = (ys.get(e.from) ?? 0) + NODE_H / 2
    const y2 = (ys.get(e.to) ?? 0) + NODE_H / 2
    const mid = (x1 + x2) / 2
    return (
      <path
        key={`${e.from}|${e.to}|${e.color}|${e.side}`}
        data-edge={e.side ? 'side' : 'loop'}
        d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
        fill="none"
        stroke={e.color}
        strokeWidth={weight(e.tokens)}
        strokeDasharray={e.side ? '6 4' : undefined}
        opacity={touches(e) ? 0.85 : 0.12}
        markerEnd={x2 === COL_ACCT ? 'url(#glass-flow-arrow)' : undefined}
      >
        <title>{`${e.from.slice(2)} → ${e.to.slice(2)} · ${fmtTokens(e.tokens)} tokens${e.side ? ' · side calls' : ''}`}</title>
      </path>
    )
  }

  const node = (n: Node, x: number, w: number, opts: { mono?: boolean; total?: boolean }) => {
    const y = ys.get(n.id) ?? 0
    return (
      <g key={n.id} data-node={n.id} onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)} style={{ cursor: 'default' }}
        opacity={hover === null || hover === n.id || g.left.concat(g.right).some((e) => touches(e) && (e.from === n.id || e.to === n.id)) ? 1 : 0.4}>
        <rect x={x} y={y} width={w} height={NODE_H} rx={5} className="fill-background stroke-border" strokeWidth={1} />
        <rect x={x} y={y} width={3} height={NODE_H} rx={1.5} fill={n.color} />
        <text x={x + 10} y={y + 15} className="fill-foreground" fontSize={11} fontWeight={600}
          fontFamily={opts.mono ? 'ui-monospace, monospace' : undefined}>
          {clip(n.label, opts.total ? 26 : 30)}
        </text>
        <text x={x + 10} y={y + 28} className="fill-muted-foreground" fontSize={9.5}>{clip(n.sub, opts.total ? 34 : 40)}</text>
        {opts.total && (
          <text x={x + w - 10} y={y + 22} textAnchor="end" fontSize={10.5} fontWeight={600} fill={n.color}>{fmtTokens(n.tokens)}</text>
        )}
      </g>
    )
  }

  return (
    <div className="space-y-3" data-testid="models-flow">
      <div className="border rounded-md overflow-x-auto bg-muted/10">
        <svg viewBox={`0 0 ${W} ${height}`} width="100%" style={{ minWidth: 760, display: 'block' }}
          role="img" aria-label="Measured calls as flow: agents to the models they chose to the accounts that answered">
          <defs>
            {/* userSpaceOnUse: a head sized by strokeWidth would blot out the card on a thick edge. */}
            <marker id="glass-flow-arrow" viewBox="0 0 10 10" refX="8" refY="5"
              markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
              <path d="M 0 1 L 9 5 L 0 9 z" fill="context-stroke" />
            </marker>
          </defs>
          <text x={COL_AGENT} y={26} className="fill-muted-foreground" fontSize={11} fontWeight={600}>AGENTS — who asked</text>
          <text x={COL_MODEL} y={26} className="fill-muted-foreground" fontSize={11} fontWeight={600}>MODELS — what the agent chose</text>
          <text x={COL_ACCT} y={26} className="fill-muted-foreground" fontSize={11} fontWeight={600}>ACCOUNTS — who answered</text>
          {g.left.map((e) => edge(e, COL_AGENT + AGENT_W, COL_MODEL))}
          {g.right.map((e) => edge(e, COL_MODEL + MODEL_W, COL_ACCT))}
          {g.agents.map((n) => node(n, COL_AGENT, AGENT_W, { total: true }))}
          {g.models.map((n) => node(n, COL_MODEL, MODEL_W, { mono: true }))}
          {g.accounts.map((n) => node(n, COL_ACCT, ACCT_W, { total: true }))}
        </svg>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <svg width="26" height="8"><line x1="0" y1="4" x2="26" y2="4" stroke="currentColor" strokeWidth="3" /></svg>
          the agent&apos;s loop (main and sub-agent calls)
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="26" height="8"><line x1="0" y1="4" x2="26" y2="4" stroke="currentColor" strokeWidth="2" strokeDasharray="6 4" /></svg>
          side calls (titles, summaries — no tools)
        </span>
        <span>thickness = tokens · colour = the account that answered</span>
      </div>
    </div>
  )
}
