import { useEffect, useState, type KeyboardEvent } from 'react'
import type { FeatureId, FeatureState } from '@/store/slices/featuresSlice'

/**
 * Feature map: the same switches as the list on the Features page, drawn as the
 * system they compose. Clicking a box toggles that feature in the page's DRAFT
 * (nothing is saved until "Save & apply"), and clicking a family's title
 * toggles every feature in it.
 *
 * Dependencies are honoured exactly as in the list, which mirrors the resolver
 * (lib/features/resolve.cjs): a feature whose dependency is off cannot be
 * switched on, and switching a dependency off takes its dependents with it. A
 * dependency is NEVER switched on for you. That would undo an explicit choice,
 * so a blocked click explains what is missing instead.
 *
 * The layout is hand-placed: twelve boxes do not need a layout engine, and a
 * fixed picture reads the same every time. A feature the catalogue gains later
 * and this map does not place yet is listed under the drawing rather than
 * dropped (display surfaces fail open).
 */

type NodeId = FeatureId | 'labelling'
type FamilyId = 'learning' | 'llm' | 'guard' | 'monitoring'

const NW = 150
const NH = 46

const POS: Record<NodeId, { x: number; y: number }> = {
  lsl: { x: 26, y: 140 },
  'lsl-redirect': { x: 194, y: 140 },
  observations: { x: 26, y: 226 },
  teams: { x: 194, y: 226 },
  knowledge: { x: 26, y: 312 },
  cluster: { x: 194, y: 312 },
  'llm-proxy': { x: 392, y: 140 },
  labelling: { x: 392, y: 226 },
  performance: { x: 392, y: 312 },
  constraints: { x: 587, y: 140 },
  codegraph: { x: 587, y: 226 },
  health: { x: 26, y: 428 },
  statusline: { x: 194, y: 428 },
}

/** Short names: the catalogue labels are too long for a 150px box. */
const SHORT: Record<NodeId, string> = {
  lsl: 'Session logging',
  'lsl-redirect': 'LSL redirect',
  observations: 'Observations',
  knowledge: 'Knowledge base',
  teams: 'Teams',
  cluster: 'Cluster',
  'llm-proxy': 'LLM proxy',
  labelling: 'Job-class labels',
  performance: 'Performance',
  constraints: 'Constraints',
  codegraph: 'Code graph',
  health: 'Health',
  statusline: 'Status line',
}

const FAMILIES: { id: FamilyId; title: string; box: [number, number, number, number]; members: FeatureId[] }[] = [
  { id: 'learning', title: 'Learning', box: [10, 100, 350, 276], members: ['lsl', 'lsl-redirect', 'observations', 'teams', 'knowledge', 'cluster'] },
  { id: 'llm', title: 'LLM & measurement', box: [376, 100, 182, 276], members: ['llm-proxy', 'performance'] },
  { id: 'guard', title: 'Guardrails & code', box: [574, 100, 176, 276], members: ['constraints', 'codegraph'] },
  { id: 'monitoring', title: 'Monitoring', box: [10, 392, 740, 96], members: ['health', 'statusline'] },
]

/**
 * "Needed by" edges: dependency → dependent. Every `requires` in the catalogue
 * plus labelling, which is a sub-switch of the proxy. A requirement that has no
 * edge here still blocks the click; it only goes undrawn.
 */
const REQUIRES_EDGES: { from: NodeId; to: NodeId; d: string }[] = [
  { from: 'lsl', to: 'lsl-redirect', d: 'M176 163 L192 163' },
  { from: 'lsl', to: 'observations', d: 'M101 186 L101 224' },
  { from: 'lsl', to: 'teams', d: 'M150 186 C150 206 269 204 269 224' },
  { from: 'observations', to: 'knowledge', d: 'M101 272 L101 310' },
  { from: 'observations', to: 'cluster', d: 'M150 272 C150 292 269 290 269 310' },
  { from: 'llm-proxy', to: 'labelling', d: 'M467 186 L467 224' },
  { from: 'llm-proxy', to: 'performance', d: 'M542 163 C572 163 572 335 544 335' },
]

export interface LabellingNode {
  /** Null when the proxy cannot be asked (absent, or too old for the switch). */
  value: boolean | null
  dirty: boolean
  onToggle: () => void
}

export interface FeatureMapProps {
  features: Partial<Record<FeatureId, FeatureState>>
  /** What would run if the draft were saved (the page's fixed-point cascade). */
  effective: Record<string, boolean>
  /** The switch position per feature, draft first, then saved. */
  valueOf: (id: FeatureId) => boolean
  draft: Record<string, boolean>
  saving: boolean
  onToggle: (id: FeatureId, value: boolean) => void
  labelling: LabellingNode
  /** "agent box", "this machine", … and the offered agents, for the core box. */
  runLabel: string
  agents: string[]
}

export function FeatureMap({
  features, effective, valueOf, draft, saving, onToggle, labelling, runLabel, agents,
}: FeatureMapProps) {
  const [hover, setHover] = useState<NodeId | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // Discard, Save or a profile empties the draft; a "Not saved yet." left
  // standing after that would describe a change that no longer exists.
  const clean = Object.keys(draft).length === 0 && !labelling.dirty
  useEffect(() => { if (clean) setNotice(null) }, [clean])

  const known = (id: FeatureId) => features[id] !== undefined
  const label = (id: FeatureId) => features[id]?.label ?? id
  const blockedBy = (id: FeatureId) => (features[id]?.requires ?? []).filter(dep => effective[dep] === false)
  const isOn = (id: NodeId): boolean => id === 'labelling'
    ? effective['llm-proxy'] !== false && labelling.value === true
    : known(id) && effective[id] !== false && valueOf(id)

  const clickFeature = (id: FeatureId) => {
    if (saving) return
    const blocked = blockedBy(id)
    if (blocked.length) {
      setNotice(`${label(id)} needs ${blocked.map(label).join(', ')}. Switch that on first.`)
      return
    }
    const next = !valueOf(id)
    // The whole cascade, not one level: lsl off takes knowledge with observations.
    const dependents: FeatureId[] = []
    const queue: FeatureId[] = [id]
    while (queue.length) {
      const cur = queue.shift() as FeatureId
      for (const o of Object.keys(features) as FeatureId[]) {
        if (features[o]?.requires?.includes(cur) && effective[o] !== false && !dependents.includes(o)) {
          dependents.push(o)
          queue.push(o)
        }
      }
    }
    setNotice(!next && dependents.length
      ? `${label(id)} off, which also switches off ${dependents.map(label).join(', ')}. Not saved yet.`
      : `${label(id)} ${next ? 'on' : 'off'}. Not saved yet.`)
    onToggle(id, next)
  }

  const clickLabelling = () => {
    if (saving) return
    if (effective['llm-proxy'] === false) { setNotice('Job-class labelling needs LLM Proxy. Switch that on first.'); return }
    if (labelling.value === null) { setNotice('Job-class labelling cannot be switched here: the proxy is unreachable or too old.'); return }
    labelling.onToggle()
    setNotice(`Job-class labelling ${labelling.value ? 'off' : 'on'}. Not saved yet.`)
  }

  /**
   * A family title switches its members together: all off when any is on,
   * otherwise all on. Switching on goes through the same dependency rule as a
   * single click, judged against the family switched on as a whole. A member
   * whose dependency lives outside the family and is off stays off, and the
   * notice says so.
   */
  const clickFamily = (fam: typeof FAMILIES[number]) => {
    if (saving) return
    const members = fam.members.filter(known)
    const anyOn = members.some(id => isOn(id))
    if (anyOn) {
      for (const id of members) if (valueOf(id)) onToggle(id, false)
      setNotice(`${fam.title}: all off. Not saved yet.`)
      return
    }
    const after: Record<string, boolean> = { ...effective }
    for (const id of members) after[id] = true
    const skipped: FeatureId[] = []
    for (const id of members) {
      const missing = (features[id]?.requires ?? []).filter(dep => after[dep] === false)
      if (missing.length) skipped.push(id)
      else if (!valueOf(id)) onToggle(id, true)
    }
    setNotice(skipped.length
      ? `${fam.title}: on, except ${skipped.map(label).join(', ')} (needs ${[...new Set(skipped.flatMap(blockedBy))].map(label).join(', ')}). Not saved yet.`
      : `${fam.title}: all on. Not saved yet.`)
  }

  const onKey = (e: KeyboardEvent, act: () => void) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act() }
  }

  const edgeLit = (from: NodeId, to: NodeId) => isOn(from) && isOn(to)
  const touches = (from: NodeId, to: NodeId) => hover !== null && (hover === from || hover === to)

  const node = (id: NodeId) => {
    if (id !== 'labelling' && !known(id)) return null
    const { x, y } = POS[id]
    const on = isOn(id)
    const blocked = id === 'labelling'
      ? (effective['llm-proxy'] === false ? ['llm-proxy' as FeatureId] : [])
      : blockedBy(id)
    const unavailable = id === 'labelling' && labelling.value === null && blocked.length === 0
    const dirty = id === 'labelling' ? labelling.dirty : draft[id] !== undefined
    const f = id === 'labelling' ? undefined : features[id]
    const sub = blocked.length
      ? `needs ${blocked.map(b => SHORT[b] ?? b).join(', ').toLowerCase()}`
      : unavailable ? 'not switchable here'
      : [id === 'labelling' ? 'live' : id, f?.needsDocker ? 'docker' : null].filter(Boolean).join(' · ')
    const title = id === 'labelling'
      ? 'Job-class labelling: label each turn with its job class (Token Usage → Classes). Saved on the proxy, live.'
      : `${f?.label}: ${f?.description}${blocked.length ? `\nNeeds ${blocked.map(label).join(', ')}.` : ''}`

    return (
      <g
        key={id}
        role="switch"
        aria-checked={on}
        aria-label={id === 'labelling' ? 'Job-class labelling' : label(id)}
        aria-disabled={saving || blocked.length > 0 || unavailable}
        tabIndex={0}
        data-testid={`feature-map-node-${id}`}
        data-state={on ? 'on' : blocked.length ? 'blocked' : 'off'}
        onClick={() => (id === 'labelling' ? clickLabelling() : clickFeature(id))}
        onKeyDown={e => onKey(e, () => (id === 'labelling' ? clickLabelling() : clickFeature(id)))}
        onMouseEnter={() => setHover(id)}
        onMouseLeave={() => setHover(null)}
        className={`outline-none [&:focus-visible>rect.frame]:stroke-ring [&:focus-visible>rect.frame]:[stroke-width:2.5]
          ${blocked.length || unavailable || saving ? 'cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <title>{title}</title>
        <rect
          className={`frame transition-colors ${on
            ? 'fill-primary/10 stroke-primary'
            : blocked.length ? 'fill-muted/40 stroke-amber-500' : 'fill-background stroke-border hover:stroke-muted-foreground'}`}
          x={x} y={y} width={NW} height={NH} rx={8}
          strokeWidth={hover === id ? 2 : 1.25}
          strokeDasharray={blocked.length ? '4 3' : undefined}
        />
        <circle cx={x + 14} cy={y + 17} r={4.5}
          className={on ? 'fill-primary' : blocked.length ? 'fill-amber-500' : 'fill-muted-foreground/40'} />
        <text x={x + 26} y={y + 21} className={`text-[12px] font-medium ${on ? 'fill-foreground' : 'fill-muted-foreground'}`}>
          {SHORT[id]}
        </text>
        <text x={x + 14} y={y + 37}
          className={`text-[10px] ${blocked.length ? 'fill-amber-600 dark:fill-amber-500' : 'fill-muted-foreground'}`}>
          {sub}
        </text>
        {dirty && (
          <g>
            <title>Unsaved change</title>
            <circle cx={x + NW - 10} cy={y + 10} r={4} className="fill-amber-500" />
          </g>
        )}
      </g>
    )
  }

  const unplaced = (Object.keys(features) as FeatureId[]).filter(id => !(id in POS))
  const learningIn = isOn('lsl')
  const llmIn = isOn('llm-proxy')
  const guardIn = isOn('constraints') || isOn('codegraph')

  return (
    <div data-testid="feature-map">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <div className="text-sm font-medium">How the parts fit</div>
        <div className="text-xs text-muted-foreground">Click a box to switch it, a family title for the whole family.</div>
      </div>
      <div className="rounded-md border border-border bg-card p-2">
        <svg viewBox="0 0 760 498" className="w-full h-auto select-none" role="group" aria-label="Feature map">
          <defs>
            {(['on', 'off', 'flow'] as const).map(k => (
              <marker key={k} id={`fm-arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5"
                markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0 0 L10 5 L0 10 z"
                  className={k === 'on' ? 'fill-primary' : 'fill-muted-foreground/50'} />
              </marker>
            ))}
          </defs>

          {/* Core: not a feature, always there */}
          <g data-testid="feature-map-core">
            <title>The coding launcher and your agents. Always on, not a feature.</title>
            <rect x={230} y={14} width={300} height={54} rx={10} className="fill-muted/50 stroke-foreground/40" strokeWidth={1.25} />
            <text x={380} y={36} textAnchor="middle" className="text-[13px] font-semibold fill-foreground">coding launcher + agents</text>
            <text x={380} y={54} textAnchor="middle" className="text-[10px] fill-muted-foreground">
              runs in: {runLabel} · {agents.length ? agents.join(', ') : 'no agent offered'}
            </text>
          </g>

          {/* Families */}
          {FAMILIES.map(fam => {
            const [x, y, w, h] = fam.box
            const members = fam.members.filter(known)
            const onCount = members.filter(id => isOn(id)).length
            return (
              <g key={fam.id}>
                <rect x={x} y={y} width={w} height={h} rx={12}
                  className="fill-muted/20 stroke-border" strokeDasharray="2 3" />
                <g
                  role="button"
                  tabIndex={0}
                  aria-label={`${fam.title}: switch all ${onCount ? 'off' : 'on'}`}
                  data-testid={`feature-map-family-${fam.id}`}
                  onClick={() => clickFamily(fam)}
                  onKeyDown={e => onKey(e, () => clickFamily(fam))}
                  className={`outline-none [&:focus-visible>text]:underline ${saving ? 'cursor-not-allowed' : 'cursor-pointer'} [&:hover>text]:fill-foreground`}
                >
                  <title>{`${fam.title}: click to switch all ${onCount ? 'off' : 'on'}`}</title>
                  <rect x={x + 6} y={y + 6} width={Math.min(w - 12, 200)} height={22} className="fill-transparent" />
                  <text x={x + 14} y={y + 21} className="text-[11px] font-semibold fill-muted-foreground">
                    {fam.title}
                  </text>
                  <text x={x + w - 12} y={y + h - 10} textAnchor="end" className="text-[10px] fill-muted-foreground">
                    {onCount}/{members.length} on
                  </text>
                </g>
              </g>
            )
          })}

          {/* How the core talks to each family (interaction, not dependency) */}
          <g className="text-[10px]">
            <path d="M300 68 L190 98" fill="none" strokeDasharray="4 3" markerEnd="url(#fm-arrow-flow)"
              className={learningIn ? 'stroke-muted-foreground' : 'stroke-muted-foreground/30'} />
            <text x={238} y={80} textAnchor="end" className="fill-muted-foreground">transcripts</text>
            <path d="M430 68 L462 98" fill="none" strokeDasharray="4 3" markerEnd="url(#fm-arrow-flow)"
              className={llmIn ? 'stroke-muted-foreground' : 'stroke-muted-foreground/30'} />
            <text x={460} y={78} className="fill-muted-foreground">LLM calls</text>
            <path d="M662 100 C662 74 600 41 532 41" fill="none" strokeDasharray="4 3" markerEnd="url(#fm-arrow-flow)"
              className={guardIn ? 'stroke-muted-foreground' : 'stroke-muted-foreground/30'} />
            <text x={566} y={32} className="fill-muted-foreground">guards · MCP</text>
          </g>

          {/* Dependencies */}
          {REQUIRES_EDGES.filter(e => (e.from === 'labelling' || known(e.from as FeatureId)) && (e.to === 'labelling' || known(e.to as FeatureId))).map(e => {
            const lit = edgeLit(e.from, e.to)
            return (
              <path key={`${e.from}-${e.to}`} d={e.d} fill="none"
                strokeWidth={touches(e.from, e.to) ? 2.25 : 1.5}
                markerEnd={`url(#fm-arrow-${lit ? 'on' : 'off'})`}
                className={lit ? 'stroke-primary' : 'stroke-muted-foreground/40'}
                data-testid={`feature-map-edge-${e.from}-${e.to}`} />
            )
          })}

          {(Object.keys(POS) as NodeId[]).map(node)}

          <text x={370} y={436} className="text-[10px] fill-muted-foreground">Health watches every service above and serves this dashboard.</text>
          <text x={370} y={452} className="text-[10px] fill-muted-foreground">The status line shows their state in each agent session.</text>
          <text x={370} y={468} className="text-[10px] fill-muted-foreground">Switching Health off stops this page; you are asked first.</text>
        </svg>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <svg width="26" height="8" aria-hidden><path d="M1 4 L20 4" className="stroke-primary" strokeWidth={1.5} /><path d="M18 0 L26 4 L18 8 z" className="fill-primary" /></svg>
          needed by (off cascades along it)
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="26" height="8" aria-hidden><path d="M1 4 L25 4" className="stroke-muted-foreground" strokeDasharray="4 3" /></svg>
          talks to
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="14" height="12" aria-hidden><rect x="1" y="1" width="12" height="10" rx="2" className="fill-none stroke-amber-500" strokeDasharray="3 2" /></svg>
          blocked by a dependency
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="10" height="10" aria-hidden><circle cx="5" cy="5" r="4" className="fill-amber-500" /></svg>
          unsaved
        </span>
      </div>

      <div className="mt-2 min-h-[1.25rem] text-xs" data-testid="feature-map-notice" aria-live="polite">
        {notice}
      </div>

      {unplaced.length > 0 && (
        <div className="mt-2 text-xs text-muted-foreground" data-testid="feature-map-unplaced">
          Not drawn yet: {unplaced.map((id, i) => (
            <span key={id}>{i > 0 ? ', ' : null}
              <button type="button" className="underline hover:text-foreground" onClick={() => clickFeature(id)}>
                {label(id)} ({isOn(id) ? 'on' : 'off'})
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
