import { useMemo, useState } from 'react'
import { getOutcomeColor, getProviderColor } from '@/lib/providers'
import { normalizeModel } from '@/components/performance/models'

/**
 * The Models tab drawn as flow: agent → the model it chose → the account that
 * answered. The same visual language as the dashboard's Token Usage → Flow, minus
 * its middle column: glass decides nothing by default, so every edge is the
 * agent's own choice. Drawn from the rows the Models table already shows
 * (/api/models).
 *
 * With an offload endpoint configured, it is an account node too — dashed while
 * it has no calls in the window or offload is off — and the one clickable node:
 * a click opens a small card with its state, the switch and the settings. Not a
 * toggle on click: a canvas click is easy to misfire, and a silent change of
 * where calls go is the worst outcome of a misfire. With none configured, a dashed
 * "Your endpoint — not set up" node stands in its place and opens the settings, so
 * the feature can be found where its traffic would show.
 *
 * Callers come in two kinds, each with its own faint card colour: coding agents
 * (top) and, with coding installed, its background services (bottom, named by
 * process). There can be dozens of the latter, so they start folded into one
 * "background services" node; a click on it unfolds them, and on its header
 * folds them again. A switch above the flow orders the column by class (agents,
 * then services) or by contribution (tokens, mixed); both choices are remembered
 * per viewer.
 */

export interface FlowGroup {
  agent: string
  /** set when the caller is a background service (no agent; the job's process name) */
  process?: string
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

export interface FlowOffload {
  /** The endpoint's name — its account node's label. */
  label: string
  /** false: no endpoint URL yet — the node is a placeholder that opens the settings. */
  configured: boolean
  enabled: boolean
  status: { label: string; tone: 'off' | 'ok' | 'warn' }
  agentsOn: string[]
  /** Rejects when glass refused or could not be reached. */
  onToggle: () => Promise<void>
  onSettings: () => void
}

interface Props {
  groups: FlowGroup[]
  offload?: FlowOffload
  /** The account's display name — the Models table's "Answered by". */
  answeredBy: (provider: string) => string
  /** The agent's display name — the Models table's "Agent". */
  agentLabel: (agent: string) => string
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

const OFFLOADED = getOutcomeColor('offloaded', false)
// Faint card washes: which kind of caller a node is.
const WASH = { fg: '#0ea5e9', bg: '#a855f7' }
const WASH_OPACITY = 0.08
// The folded background services, and their header once unfolded.
const BG_ID = 'a:\u0000background'
const BG_OPEN_KEY = 'glass.models.flow.bgOpen'
// The agents column's order: by class (coding agents, then background services)
// or by contribution (tokens, the two kinds mixed).
type Order = 'class' | 'tokens'
const ORDER_KEY = 'glass.models.flow.order'

// Per-viewer conveniences: a blocked or empty storage reads as the default.
function readPref(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function writePref(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* a viewer convenience only */ }
}

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

interface Node {
  id: string; label: string; sub: string; tokens: number; color: string; ghost?: boolean
  /** which kind of caller (agents column only) */
  kind?: 'fg' | 'bg'
  /** the fold / unfold node of the background services */
  fold?: boolean
}
interface Edge { from: string; to: string; tokens: number; side: boolean; color: string }

function addTo<K>(m: Map<K, number>, k: K, v: number) { m.set(k, (m.get(k) ?? 0) + v) }

export function ModelFlow({ groups, answeredBy, agentLabel, offload }: Props) {
  const [hover, setHover] = useState<string | null>(null)
  const [card, setCard] = useState(false)
  const [toggle, setToggle] = useState<{ busy: boolean; error: string }>({ busy: false, error: '' })
  const [bgOpen, setBgOpen] = useState(() => readPref(BG_OPEN_KEY) === '1')
  const flipBg = () => setBgOpen((o) => { writePref(BG_OPEN_KEY, o ? '0' : '1'); return !o })
  const [order, setOrder] = useState<Order>(() => (readPref(ORDER_KEY) === 'tokens' ? 'tokens' : 'class'))
  const pickOrder = (o: Order) => { writePref(ORDER_KEY, o); setOrder(o) }

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

    const bgIds = new Set<string>()
    for (const r of groups) {
      const t = tokensOf(r)
      // Folded, every background service is the one BG_ID node.
      const agent = !r.process ? `a:${agentLabel(r.agent)}` : bgOpen ? `a:${r.process}` : BG_ID
      if (r.process) bgIds.add(`a:${r.process}`)
      const model = `m:${normalizeModel(r.model) || '—'}`
      // By the account that answered, not the provider spelling: rows say both
      // `github-copilot` and `gh-copilot` for one Copilot login.
      const acct = `p:${answeredBy(r.provider) || '—'}`
      const side = r.call_kind === 'side'
      // The endpoint's calls take coding's "offloaded" colour, not a grey unknown account.
      const color = offload && acct === `p:${offload.label}` ? OFFLOADED : getProviderColor(r.provider)
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
    const callsText = (n: number) => `${n} call${n === 1 ? '' : 's'}`
    const services = `${bgIds.size} background service${bgIds.size === 1 ? '' : 's'}`
    const callers: Node[] = byTokens(agentTok).map((id) => {
      const top = [...(agentAcct.get(id) ?? new Map()).entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
      const n = agentCalls.get(id) ?? 0
      const color = getProviderColor(top)
      if (id === BG_ID) {
        return { id, label: `▸ ${services}`, sub: `${callsText(n)} · click to show`, tokens: agentTok.get(id) ?? 0, color, kind: 'bg' as const, fold: true }
      }
      const kind = bgIds.has(id) ? 'bg' as const : 'fg' as const
      const on = kind === 'fg' && offload?.enabled && offload.agentsOn.includes(id.slice(2))
      return { id, label: id.slice(2), sub: `${callsText(n)}${on ? ' · offload on' : ''}`, tokens: agentTok.get(id) ?? 0, color, kind }
    })
    // Coding agents on top, background services below — each by tokens. Unfolded,
    // the services sit under a header that folds them again.
    const fg = callers.filter((n) => n.kind === 'fg')
    const bg = callers.filter((n) => n.kind === 'bg')
    const header: Node[] = bgOpen && bg.length
      ? [{ id: BG_ID, label: `▾ ${services}`, sub: 'click to fold', tokens: 0, color: getProviderColor(''), kind: 'bg', fold: true }]
      : []
    // By contribution the callers keep their token order; an unfolded header goes
    // just above the first background service.
    const firstBg = callers.findIndex((n) => n.kind === 'bg')
    const agents = order === 'class' ? [...fg, ...header, ...bg]
      : firstBg < 0 ? callers : [...callers.slice(0, firstBg), ...header, ...callers.slice(firstBg)]
    const models: Node[] = byTokens(modelTok).map((id) => {
      const c = modelCalls.get(id) ?? { main: 0, side: 0 }
      const parts = [c.main && `${c.main} loop`, c.side && `${c.side} side`].filter(Boolean)
      return { id, label: id.slice(2), sub: `${parts.join(' · ')} call${c.main + c.side === 1 ? '' : 's'}`, tokens: modelTok.get(id) ?? 0, color: '#64748b' }
    })
    const acctColor = new Map(groups.map((r) => {
      const id = `p:${answeredBy(r.provider) || '—'}`
      return [id, offload && id === `p:${offload.label}` ? OFFLOADED : getProviderColor(r.provider)]
    }))
    const accounts: Node[] = byTokens(acctTok).map((id) => ({
      id,
      label: id.slice(2),
      sub: [...(acctHosts.get(id) ?? [])].join(', ') || 'host not recorded',
      tokens: acctTok.get(id) ?? 0,
      color: acctColor.get(id) ?? getProviderColor(''),
      ghost: Boolean(offload && id.slice(2) === offload.label && !offload.enabled),
    }))
    // A configured endpoint with no calls in the window still gets its node: it is
    // where the switch is.
    if (offload && !accounts.some((a) => a.label === offload.label)) {
      const sub = offload.configured ? 'offload endpoint · no calls in this window' : 'not set up · click to add'
      accounts.push({ id: `p:${offload.label}`, label: offload.label, sub, tokens: 0, color: getProviderColor(''), ghost: true })
    }
    const max = Math.max(1, ...[...left.values()].map((e) => e.tokens))
    return { agents, models, accounts, left: [...left.values()], right: [...right.values()], max }
  }, [groups, answeredBy, agentLabel, offload, bgOpen, order])

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
    const isTarget = Boolean(offload && n.id === `p:${offload.label}`)
    const clickable = isTarget || Boolean(n.fold)
    return (
      <g key={n.id} data-node={n.id} data-offload-target={isTarget ? '1' : undefined}
        data-kind={n.kind} data-fold={n.fold ? (bgOpen ? 'open' : 'folded') : undefined}
        onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)}
        onClick={n.fold ? flipBg : !isTarget ? undefined : offload!.configured
          ? () => { setCard((c) => !c); setToggle({ busy: false, error: '' }) }
          : offload!.onSettings}
        style={{ cursor: clickable ? 'pointer' : 'default' }}
        opacity={hover === null || hover === n.id || g.left.concat(g.right).some((e) => touches(e) && (e.from === n.id || e.to === n.id)) ? 1 : 0.4}>
        {isTarget && <title>{offload!.configured
          ? `${n.label} — offload ${offload!.status.label}. Click to switch or change it.`
          : 'No offload endpoint set up. Click to add one: easy calls of opencode, pi and copilot can go to a model server of your own.'}</title>}
        {n.fold && <title>{bgOpen
          ? 'Click to fold the background services back into one node.'
          : 'Background services of coding (no agent asked; named by process). Click to show each one.'}</title>}
        {!n.fold && n.kind === 'bg' && <title>{`A background service of coding (process ${n.label}): no agent asked.`}</title>}
        <rect x={x} y={y} width={w} height={NODE_H} rx={5} className="fill-background stroke-border" strokeWidth={isTarget ? 1.5 : 1}
          strokeDasharray={n.ghost || (n.fold && bgOpen) ? '4 3' : undefined} />
        {n.kind && (
          <rect x={x} y={y} width={w} height={NODE_H} rx={5} fill={WASH[n.kind]} fillOpacity={WASH_OPACITY} pointerEvents="none" />
        )}
        {/* Selected (its card open): a faint wash of the offloaded colour marks which node the card belongs to. */}
        {isTarget && card && (
          <rect data-testid="offload-node-selected" x={x} y={y} width={w} height={NODE_H} rx={5}
            fill={OFFLOADED} fillOpacity={0.12} stroke={OFFLOADED} strokeOpacity={0.6} strokeWidth={1.5}
            strokeDasharray={n.ghost ? '4 3' : undefined} pointerEvents="none" />
        )}
        <rect x={x} y={y} width={3} height={NODE_H} rx={1.5} fill={n.color} />
        <text x={x + 10} y={y + 15} className="fill-foreground" fontSize={11} fontWeight={600}
          fontFamily={opts.mono ? 'ui-monospace, monospace' : undefined}>
          {clip(n.label, opts.total ? 26 : 30)}
        </text>
        <text x={x + 10} y={y + 28} className="fill-muted-foreground" fontSize={9.5}>{clip(n.sub, opts.total ? 34 : 40)}</text>
        {opts.total && n.tokens > 0 && (
          <text x={x + w - 10} y={y + 22} textAnchor="end" fontSize={10.5} fontWeight={600} fill={n.color}>{fmtTokens(n.tokens)}</text>
        )}
      </g>
    )
  }

  return (
    <div className="space-y-3" data-testid="models-flow">
      {g.agents.some((n) => n.kind === 'bg') && (
        <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground" data-testid="models-flow-order">
          <span>Order agents</span>
          <div className="inline-flex rounded-md border p-0.5">
            {([['class', 'by class'], ['tokens', 'by contribution']] as const).map(([o, label]) => (
              <button key={o} data-order={o} aria-pressed={order === o} onClick={() => pickOrder(o)}
                title={o === 'class' ? 'Coding agents on top, background services below' : 'By tokens, coding agents and background services mixed'}
                className={`rounded px-2 py-0.5 ${order === o ? 'bg-muted text-foreground font-medium' : 'hover:text-foreground'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="relative">
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
            <text x={COL_MODEL} y={26} className="fill-muted-foreground" fontSize={11} fontWeight={600}>MODELS — what the agent chose{offload?.configured ? ', or your endpoint\u2019s' : ''}</text>
            <text x={COL_ACCT} y={26} className="fill-muted-foreground" fontSize={11} fontWeight={600}>ACCOUNTS — who answered</text>
            {g.left.map((e) => edge(e, COL_AGENT + AGENT_W, COL_MODEL))}
            {g.right.map((e) => edge(e, COL_MODEL + MODEL_W, COL_ACCT))}
            {g.agents.map((n) => node(n, COL_AGENT, AGENT_W, { total: true }))}
            {g.models.map((n) => node(n, COL_MODEL, MODEL_W, { mono: true }))}
            {g.accounts.map((n) => node(n, COL_ACCT, ACCT_W, { total: true }))}
          </svg>
        </div>
        {card && offload?.configured && (() => {
          const y = ys.get(`p:${offload.label}`) ?? 0
          const dot = { off: 'bg-muted-foreground/40', ok: 'bg-emerald-500', warn: 'bg-amber-500' }[offload.status.tone]
          return (
            <div data-testid="offload-card" role="dialog" aria-label={`${offload.label} offload`}
              className="absolute z-10 w-72 rounded-md border bg-popover p-3 text-sm shadow-md"
              // Below the node, or above it when the node sits in the lower half.
              style={y > height / 2
                ? { right: 12, bottom: `${(1 - (y - 6) / height) * 100}%` }
                : { right: 12, top: `${((y + NODE_H + 6) / height) * 100}%` }}>
              <div className="flex items-center gap-2 font-medium">
                <span className={`h-2 w-2 rounded-full ${dot}`} />
                {offload.label}
                <button className="ml-auto text-muted-foreground hover:text-foreground" aria-label="Close" onClick={() => setCard(false)}>×</button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Offload {offload.status.label}.{' '}
                {offload.agentsOn.length ? `Easy calls of ${offload.agentsOn.join(', ')} go here; the rest, and anything it cannot answer in time, go to the agent's own provider.` : 'No agent is chosen yet.'}
              </p>
              {toggle.error && (
                <p data-testid="offload-card-error" className="mt-2 text-xs text-destructive">Could not switch: {toggle.error}</p>
              )}
              <div className="mt-3 flex gap-2">
                {/* Turning on with no agent chosen would change nothing: the button says so and opens the settings. */}
                {!offload.enabled && !offload.agentsOn.length ? (
                  <button data-testid="offload-card-toggle" onClick={() => { offload.onSettings(); setCard(false) }}
                    className="rounded-md border px-2.5 py-1 text-xs hover:bg-muted">
                    Choose agents…
                  </button>
                ) : (
                  <button data-testid="offload-card-toggle" disabled={toggle.busy}
                    onClick={() => {
                      setToggle({ busy: true, error: '' })
                      offload.onToggle()
                        .then(() => { setToggle({ busy: false, error: '' }); setCard(false) })
                        .catch((e) => setToggle({ busy: false, error: String(e?.message || e) }))
                    }}
                    className="rounded-md border px-2.5 py-1 text-xs hover:bg-muted disabled:opacity-50">
                    {toggle.busy ? 'Switching…' : offload.enabled ? 'Turn offload off' : 'Turn offload on'}
                  </button>
                )}
                <button onClick={() => { offload.onSettings(); setCard(false) }} className="rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted">
                  Settings…
                </button>
              </div>
            </div>
          )
        })()}
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
        {g.agents.some((n) => n.kind === 'bg') && (
          <span className="flex items-center gap-1.5">
            <svg width="12" height="10"><rect width="12" height="10" rx="2" fill={WASH.fg} fillOpacity={WASH_OPACITY * 2} /></svg>coding agents
            <svg width="12" height="10" className="ml-2"><rect width="12" height="10" rx="2" fill={WASH.bg} fillOpacity={WASH_OPACITY * 2} /></svg>background services
          </span>
        )}
        {offload && <span>{offload.configured
          ? 'dashed node = your offload endpoint while it is off or has no calls · click it to switch'
          : 'dashed node = an offload endpoint of your own, not set up yet · click it to add one'}</span>}
      </div>
    </div>
  )
}
