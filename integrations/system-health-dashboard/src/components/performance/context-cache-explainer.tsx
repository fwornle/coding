import { useEffect, useMemo, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer, Legend,
} from 'recharts'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'
import { useAppSelector, useAppDispatch } from '@/store'
import {
  fetchTimeline,
  selectExplainTaskId,
  selectExplainRun,
  selectTimelineFor,
  selectTimelineLoading,
  setExplainTaskId,
  type TimelineRow,
} from '@/store/slices/performanceSlice'
import { normalizeModel } from './models'

// ---------------------------------------------------------------------------
// ContextCacheExplainer (Phase 78 — "what is claude caching that opencode isn't?")
// ---------------------------------------------------------------------------
// A one-page, per-run pop-up that makes the counter-intuitive token numbers
// legible. Honesty tiers:
//   1. TOPOLOGY (static, real): agent → proxy :12435 → Docker services + backend.
//   2. CONTEXT WINDOW BAND (conceptual anatomy): the segmented composition of the
//      prompt (system / tools / retrieved-knowledge / history / tool-outputs /
//      user-input). Proportions are ILLUSTRATIVE — the proxy DB stores no
//      per-category byte split — EXCEPT the Retrieved-Knowledge segment, whose
//      real ~1,000-token injection budget we DO know (hover/click for detail).
//      A cache breakpoint overlays which part is the reusable prefix.
//   3. MEASURED (real, per-turn): cache_read / cache_write / fresh input / output,
//      straight from the timeline endpoint. This is where the claude-vs-opencode
//      asymmetry shows up as data.
//
// Opened by the runs-table "Explain" button (setExplainTaskId); closes via the
// Dialog overlay / X. Mirrors the ScoreDrawer pattern.

// Cache-behavior palette (recharts <Bar fill> needs literal colors — CSS var()
// does not resolve in SVG fill).
const C_READ = '#22c55e' // cache HIT — reused from provider cache (cheap)
const C_WRITE = '#f59e0b' // cache creation — written to cache once
const C_INPUT = '#3b82f6' // fresh input — re-sent full context
const C_OUTPUT = '#8b5cf6' // model output

// Context-window category palette — matches the reference anatomy diagram.
interface Segment {
  key: string
  label: string
  fill: string
  stroke: string
  w: number // illustrative width %
  cached: boolean // part of the reusable prefix?
  real?: boolean // do we have a real measured size for this segment?
}
// Prompt-assembly order (left→right). The stable prefix (system → history) is
// cacheable; the fresh tail (latest tool outputs + user input) is new each turn.
const SEGMENTS: Segment[] = [
  { key: 'sys', label: 'System Instructions', fill: '#d9f99d', stroke: '#84cc16', w: 14, cached: true },
  { key: 'tools', label: 'Tool Descriptions', fill: '#cffafe', stroke: '#06b6d4', w: 12, cached: true },
  { key: 'know', label: 'Retrieved Knowledge', fill: '#e9d5ff', stroke: '#a855f7', w: 14, cached: true, real: true },
  { key: 'hist', label: 'Conversation History', fill: '#fecaca', stroke: '#ef4444', w: 32, cached: true },
  { key: 'tout', label: 'Tool Outputs', fill: '#fed7aa', stroke: '#f97316', w: 14, cached: false },
  { key: 'user', label: 'User Input', fill: '#bfdbfe', stroke: '#3b82f6', w: 14, cached: false },
]
const PREFIX_PCT = SEGMENTS.filter((s) => s.cached).reduce((a, s) => a + s.w, 0) // 72

const num = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? x : 0)
const fmt = (n: number): string => n.toLocaleString()
const kb = (bytes: number): string => (bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`)

// Real wire-buffer breakdown as returned by GET /api/context-breakdown (proxy).
interface RealBreakdown {
  capturedAt: string
  model: string
  task_id: string | null
  total_bytes: number
  est_tokens: number
  cacheable_prefix_bytes: number
  fresh_input_bytes?: number
  cache_breakpoints: number
  message_count: number
  tool_count: number
  knowledge_text?: string | null
  knowledge_occurrences?: number
  knowledge_cadence?: string
  categories: { key: string; label: string; bytes: number }[]
}

// Known per-model context-window ceilings — used only for the "% of window"
// hint. Returns null when we can't defensibly claim a ceiling (don't guess).
// Opus 4.x runs here with the 1M-token window; Sonnet/Haiku default to 200k.
function modelContextMax(model?: string | null): number | null {
  const m = (model ?? '').toLowerCase()
  if (/\b1m\b|\[1m\]/.test(m)) return 1_000_000 // explicit 1M variant marker
  if (/opus/.test(m)) return 1_000_000
  if (/sonnet|haiku/.test(m)) return 200_000
  return null // unknown/unverified provider → no ceiling claimed
}

interface TurnDatum {
  turn: string
  read: number
  write: number
  input: number
  output: number
}

/** Flatten the timeline's top-level per-turn rows into chart data + totals. */
function summarize(timeline: TimelineRow[]) {
  const turns = timeline
    .filter((r) => (r.granularity_tier ?? '') !== 'per-session-aggregate')
    .slice()
    .sort((a, b) => String(a.timestamp ?? '').localeCompare(String(b.timestamp ?? '')))

  const data: TurnDatum[] = turns.map((t, i) => ({
    turn: `T${i + 1}`,
    read: num(t.cache_read_tokens),
    write: num(t.cache_write_tokens),
    input: num(t.input_tokens),
    output: num(t.output_tokens),
  }))

  const totalRead = data.reduce((s, d) => s + d.read, 0)
  const totalWrite = data.reduce((s, d) => s + d.write, 0)
  const totalInput = data.reduce((s, d) => s + d.input, 0)
  const totalOutput = data.reduce((s, d) => s + d.output, 0)

  const promptTokens = totalRead + totalWrite + totalInput
  const reusePct = promptTokens > 0 ? totalRead / promptTokens : 0
  const firstWrite = data.find((d) => d.write > 0)?.write ?? 0

  // The single turn with the largest context window (read+write+input) — the
  // representative "one prompt sent to the backend" for the measured bar.
  let maxSeg = { read: 0, write: 0, input: 0, total: 0 }
  for (const d of data) {
    const total = d.read + d.write + d.input
    if (total > maxSeg.total) maxSeg = { read: d.read, write: d.write, input: d.input, total }
  }

  return {
    data,
    totalRead,
    totalWrite,
    totalInput,
    totalOutput,
    reusePct,
    firstWrite,
    maxSeg,
    turnCount: turns.length,
    caches: totalRead > 0,
  }
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-lg font-semibold" style={color ? { color } : undefined}>{value}</p>
    </div>
  )
}

/** Topology (static, real). Both the foreground chat AND the Docker background
 * services are PARALLEL clients of the proxy — the bg services are NOT downstream
 * of the chat's request; they call the LLM backend on their own, through the same
 * metering proxy. Corrected per operator feedback. */
function TopologyStrip({ agent }: { agent: string }) {
  const Box = ({ title, lines, accent, tag }: { title: string; lines: string[]; accent?: string; tag?: string }) => (
    <div className="relative w-full rounded-md border bg-background p-2.5 text-center" style={accent ? { borderColor: accent } : undefined}>
      {tag && (
        <span className="absolute -top-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border bg-background px-1.5 text-[10px]" style={accent ? { color: accent, borderColor: accent } : undefined}>
          {tag}
        </span>
      )}
      <p className="text-sm font-semibold">{title}</p>
      {lines.map((l) => (
        <p key={l} className="text-xs text-muted-foreground">{l}</p>
      ))}
    </div>
  )
  const Arrow = () => <div className="self-center px-1 text-lg text-muted-foreground" aria-hidden>→</div>
  return (
    <div className="flex items-stretch gap-1">
      {/* Two parallel proxy CLIENTS, stacked. */}
      <div className="flex w-[34%] flex-col justify-center gap-1.5">
        <Box title={`${agent || 'agent'} — foreground chat`} lines={['assembles the FULL', 'context every turn']} accent={C_INPUT} tag="proxy client" />
        <Box title="Docker background services" lines={['ETM · obs-api · constraint', 'consolidators — use proxy in parallel']} accent="#64748b" tag="proxy client" />
      </div>
      <Arrow />
      <div className="flex w-[30%] items-stretch">
        <Box title="rapid-llm-proxy" lines={[':12435 · /api/complete', 'meters EVERY call (fg + bg)']} accent={C_WRITE} tag="single metering seam" />
      </div>
      <Arrow />
      <div className="flex w-[30%] items-stretch">
        <Box title="backend LLM" lines={['Anthropic / gateway', 'matches prefix → cache_read']} accent={C_READ} tag="cache lives HERE" />
      </div>
    </div>
  )
}

// The real facts behind the Retrieved-Knowledge segment (Phase 78 dig).
const KB_SECTIONS = [
  { name: 'Working Memory', budget: '≤300 tok', src: 'STATE.md + VKB /api/entities', detail: 'Project, milestone, status, current phase, known issues.' },
  { name: 'Insights', budget: '≤4 items', src: 'Qdrant · insights', detail: 'Highest-confidence learned patterns, RRF-ranked to the prompt.' },
  { name: 'Digests', budget: '≤3 items', src: 'Qdrant · digests', detail: 'Consolidated multi-observation summaries of past sessions.' },
  { name: 'Entities', budget: '≤3 items', src: 'Qdrant · kg_entities', detail: 'Knowledge-graph components/subcomponents relevant to the prompt.' },
  { name: 'Observations', budget: '≤3 items', src: 'Qdrant · observations', detail: 'Individual past intents/approaches matching the query.' },
]

/** Nested pop-up: the deep detail for the Retrieved-Knowledge injection. */
function KbDetailDialog({ open, onClose, real }: { open: boolean; onClose: () => void; real: RealBreakdown | null }) {
  const injected = real?.knowledge_text?.trim() || null
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-[760px] w-[90vw] max-h-[85vh] overflow-y-auto" data-testid="kb-detail-dialog">
        <DialogHeader>
          <DialogTitle>Retrieved Knowledge — the injected context block</DialogTitle>
          <DialogDescription>
            A ~1,000-token block prepended to every prompt by the <span className="font-mono">knowledge-injection</span> hook
            (UserPromptSubmit → <span className="font-mono">POST /api/retrieve</span>). This is retrieval-augmented context —
            not something you typed. It’s injected <span className="font-medium text-foreground">per prompt</span> (once per user
            submission), then rides in history across that prompt’s agentic turns.
          </DialogDescription>
        </DialogHeader>

        {/* The ACTUAL injected block, extracted from this run's captured buffer. */}
        {injected ? (
          <div className="rounded-md border p-3" data-testid="kb-real-content">
            <div className="mb-1 flex items-center justify-between">
              <p className="text-sm font-semibold">What actually got injected</p>
              {typeof real?.knowledge_occurrences === 'number' && (
                <span className="text-xs text-muted-foreground">{real.knowledge_occurrences} injection{real.knowledge_occurrences === 1 ? '' : 's'} in this buffer</span>
              )}
            </div>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2 text-[11px] leading-snug">{injected}</pre>
            <p className="mt-1 text-xs text-muted-foreground">Verbatim from this run’s captured request (most-recent injection, capped). This is the real retrieved content — not the schema.</p>
          </div>
        ) : (
          <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground" data-testid="kb-no-content">
            No captured buffer for this run, so the exact injected text isn’t available (it predates the capture tap, or the agent
            has no proxy seam). Re-run the comparison to record it. The schema below shows what the block is composed of.
          </div>
        )}

        <div className="mt-3 rounded-md border p-3">
          <p className="text-sm font-semibold">Budget: 1,000 tokens</p>
          <div className="mt-2 flex h-4 w-full overflow-hidden rounded" title="300 Working Memory + 700 semantic">
            <div className="flex items-center justify-center text-[10px] text-white" style={{ width: '30%', background: '#a855f7' }}>300 WM</div>
            <div className="flex items-center justify-center text-[10px] text-white" style={{ width: '70%', background: '#7c3aed' }}>700 semantic</div>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            300 tok Working Memory + 700 tok semantic retrieval. Overflows are truncated per-item; the hook output is
            hard-capped at 9,500 chars.
          </p>
        </div>

        <div className="mt-3 space-y-1.5">
          {KB_SECTIONS.map((s) => (
            <div key={s.name} className="flex items-start justify-between gap-3 rounded border px-3 py-2">
              <div>
                <p className="text-sm font-medium">{s.name} <span className="ml-1 font-mono text-xs text-muted-foreground">{s.budget}</span></p>
                <p className="text-xs text-muted-foreground">{s.detail}</p>
              </div>
              <Badge variant="outline" className="shrink-0 font-mono text-[10px]">{s.src}</Badge>
            </div>
          ))}
        </div>

        <div className="mt-3 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">Pipeline:</span> the hook embeds your prompt → semantic search over
          four Qdrant collections + SQLite FTS5 keyword search → Reciprocal-Rank-Fusion → per-tier caps → budget-truncated
          markdown. Working Memory is always first; semantic tiers follow in order (Insights, Digests, Entities, Observations).
          Because it sits at the <em>front</em> of the prompt and rarely changes within a session, it becomes part of the
          <span style={{ color: C_READ }}> cacheable prefix</span>.
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function ContextCacheExplainer() {
  const dispatch = useAppDispatch()
  const taskId = useAppSelector(selectExplainTaskId)
  const run = useAppSelector(selectExplainRun)
  const timeline = useAppSelector(selectTimelineFor(taskId))
  const loading = useAppSelector(selectTimelineLoading)
  const [kbOpen, setKbOpen] = useState(false)
  const [real, setReal] = useState<RealBreakdown | null>(null)

  const open = taskId != null
  const close = () => dispatch(setExplainTaskId(null))

  useEffect(() => {
    if (taskId && timeline.length === 0) dispatch(fetchTimeline(taskId))
  }, [taskId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Real wire-buffer breakdown — PER RUN. We ask the proxy for THIS run's own
  // captured buffer (keyed by its measurement task_id). A measured run of any
  // proxy-routed agent (claude, opencode) persists its own snapshot, so the band
  // shows that agent's real, scaled sizes — never another agent's. Runs captured
  // before this tap existed (or copilot, which has no proxy seam) return 404 →
  // the clearly-illustrative conceptual band, with a "re-run to capture" note.
  useEffect(() => {
    if (!open || !taskId) { setReal(null); return }
    let cancelled = false
    setReal(null)
    fetch(`/api/context-breakdown?task_id=${encodeURIComponent(taskId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d && Array.isArray(d.categories) && d.total_bytes > 0) setReal(d as RealBreakdown) })
      .catch(() => { /* no per-run capture — fall back to illustrative */ })
    return () => { cancelled = true }
  }, [open, taskId])

  const s = useMemo(() => summarize(timeline), [timeline])

  // `real` is already THIS run's own capture (fetched by task_id), so it is
  // safe to use directly — no cross-run leakage possible.
  const activeReal = real

  // Effective band segments: real byte proportions when this run has a capture,
  // else the illustrative widths. Same 6 keys either way.
  const { segView, prefixPct, realByKey } = useMemo(() => {
    const real = activeReal
    const byKey: Record<string, number> = {}
    if (real) for (const c of real.categories) byKey[c.key] = c.bytes
    if (real && real.total_bytes > 0) {
      // Floor each present category to a visible sliver (≥1.2%) so a tiny-but-real
      // segment (e.g. 0.3 KB of fresh User Input in a 3 MB buffer) doesn't vanish;
      // renormalise so widths still sum to 100. The banner shows exact bytes.
      const raw = SEGMENTS.map((seg) => ({ seg, bytes: byKey[seg.key] ?? 0 }))
        .filter((r) => r.bytes > 0)
      const floored = raw.map((r) => ({ ...r, w: Math.max(1.2, (r.bytes / real.total_bytes) * 100) }))
      const sum = floored.reduce((a, r) => a + r.w, 0)
      const view = floored.map((r) => ({ ...r.seg, w: (r.w / sum) * 100 }))
      // Prefix boundary in the SAME floored coordinate space (everything except
      // the fresh 'user' tail).
      const prefixW = view.filter((v) => v.key !== 'user').reduce((a, v) => a + v.w, 0)
      return { segView: view, prefixPct: Math.min(100, prefixW), realByKey: byKey }
    }
    return { segView: SEGMENTS, prefixPct: PREFIX_PCT, realByKey: byKey }
  }, [activeReal])

  const agent = run?.canonical_agent ?? run?.agent ?? ''
  const model = run?.canonical_model ? normalizeModel(run.canonical_model) : null
  const ctxMax = modelContextMax(run?.canonical_model)
  const windowPct = ctxMax ? Math.min(1, s.maxSeg.total / ctxMax) : null

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close() }}>
      <DialogContent
        className="max-w-[1120px] w-[94vw] max-h-[92vh] overflow-y-auto"
        data-testid="context-cache-explainer"
      >
        <DialogHeader>
          <DialogTitle>Context &amp; caching — what actually gets sent to the LLM</DialogTitle>
          <DialogDescription>
            <span className="font-mono">{run?.task_id ?? taskId}</span>
            {' · '}{agent || 'agent'}{' · '}
            {model ? <span className="font-mono">{model}</span> : <span className="italic">unmeasured</span>}
          </DialogDescription>
          {run?.goal_sentence && (
            <p className="text-sm" data-testid="explainer-goal">
              <span className="text-muted-foreground">Goal:</span> {run.goal_sentence}
            </p>
          )}
        </DialogHeader>

        {/* 1. Topology (static, real) */}
        <TopologyStrip agent={agent} />

        {/* Headline verdict — data-driven */}
        <div
          className="rounded-md border p-3"
          style={{ borderColor: s.caches ? C_READ : C_WRITE, background: (s.caches ? C_READ : C_WRITE) + '14' }}
          data-testid="cache-verdict"
        >
          {s.turnCount === 0 ? (
            <p className="text-sm text-muted-foreground">
              {loading ? 'Loading timeline…' : 'No per-turn token timeline recorded for this run.'}
            </p>
          ) : s.caches ? (
            <p className="text-sm">
              <span className="font-semibold" style={{ color: C_READ }}>This run reuses its context via prompt caching.</span>{' '}
              {fmt(s.totalRead)} tokens were read back from cache across {s.turnCount} turns —{' '}
              <span className="font-semibold">{(s.reusePct * 100).toFixed(0)}%</span> of all prompt tokens served from cache
              instead of re-sent.
            </p>
          ) : (
            <p className="text-sm">
              <span className="font-semibold" style={{ color: C_WRITE }}>This run does not reuse a prompt cache.</span>{' '}
              Across {s.turnCount} turns, <span className="font-semibold">0%</span> of prompt tokens came from cache — every
              turn re-sent the full context as fresh input ({fmt(s.totalInput)} tokens).
            </p>
          )}
        </div>

        {/* 2. Context Window band (conceptual anatomy + real cache breakpoint) */}
        <div className="rounded-md border p-4">
          <div className="mb-2 flex items-baseline justify-between">
            <p className="text-sm font-semibold">Anatomy of the context window</p>
            <p className="text-xs text-muted-foreground">
              {activeReal
                ? <>proportions <span className="font-medium text-foreground">measured</span> from this run’s captured buffer · cache boundary is the real <span className="font-mono">cache_control</span> offset</>
                : <>proportions illustrative · this run’s real cache split is shown below</>}
            </p>
          </div>

          {/* Per-run wire capture — this run's OWN buffer (fetched by task_id).
              Absent for runs that predate the tap, or copilot (no proxy seam). */}
          {activeReal && (
            <div className="mb-2 rounded-md border px-3 py-1.5 text-xs" style={{ borderColor: C_READ, background: C_READ + '10' }} data-testid="real-capture-banner">
              <span className="font-medium" style={{ color: C_READ }}>Measured wire capture ({agent || 'agent'})</span>{' '}
              — this run’s actual request buffer:{' '}
              <span className="font-mono">{kb(activeReal.total_bytes)}</span> (~{fmt(activeReal.est_tokens)} tok est.) across{' '}
              {activeReal.message_count} messages + {activeReal.tool_count} tools. Only{' '}
              <span className="font-mono" style={{ color: C_INPUT }}>{kb(activeReal.fresh_input_bytes ?? 0)}</span> is{' '}
              <span style={{ color: C_INPUT }}>new this turn</span> — the other{' '}
              <span className="font-mono" style={{ color: C_READ }}>{kb(activeReal.cacheable_prefix_bytes)}</span>{' '}
              (<span style={{ color: C_READ }}>{((activeReal.cacheable_prefix_bytes / activeReal.total_bytes) * 100).toFixed(1)}%</span>) is
              re-sent but recognised by the provider’s cache, so it is re-read instead of re-processed.{' '}
              {activeReal.cache_breakpoints} <span className="font-mono">cache_control</span>{' '}
              {activeReal.cache_breakpoints === 1 ? 'breakpoint' : 'breakpoints'}.
            </div>
          )}
          {!activeReal && (
            <div className="mb-2 rounded-md border border-dashed px-3 py-1.5 text-xs text-muted-foreground" data-testid="no-real-capture-note">
              The band below is <span className="font-medium text-foreground">illustrative</span> — this run has no per-category
              wire capture. It predates the capture tap{run?.agent === 'copilot' ? ' (and copilot has no proxy seam to measure)' : ''};
              <span className="font-medium text-foreground"> re-run the comparison</span> to record each agent’s real buffer. This
              run’s measured cache split (read/write, per-turn) is still shown below.
            </div>
          )}

          {/* brace label */}
          <p className="mb-1 text-center text-xs font-medium text-muted-foreground">◜ Context Window sent to the model each turn ◝</p>

          {/* One CONTIGUOUS token buffer (messages array) — no gaps. Blocks are
              colour-only; labels live in the legend so nothing is unreadable. */}
          <TooltipProvider delayDuration={100}>
            <div className="relative flex w-full overflow-hidden rounded-md border" style={{ height: 44 }}>
              {segView.map((seg, i) => {
                const divider = i > 0 ? '1px solid rgba(0,0,0,0.28)' : undefined
                if (seg.key !== 'know') {
                  return (
                    <div
                      key={seg.key}
                      className="h-full"
                      title={seg.label}
                      style={{ width: `${seg.w}%`, background: seg.fill, borderLeft: divider }}
                    />
                  )
                }
                // Retrieved Knowledge — interactive (hover detail + click deep modal)
                return (
                  <Tooltip key={seg.key}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => setKbOpen(true)}
                        data-testid="kb-segment"
                        className="flex h-full cursor-pointer items-center justify-center p-0 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        style={{ width: `${seg.w}%`, background: seg.fill, borderLeft: divider }}
                        aria-label="Retrieved Knowledge — click for detail"
                      >
                        <span className="rounded-full bg-white/80 px-1.5 text-xs font-bold text-purple-800" title="Retrieved Knowledge — click for detail">ⓘ</span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-xs">
                      <p className="font-semibold">Retrieved Knowledge — the injected KB block</p>
                      <p className="mt-1 text-xs">
                        ~1,000 tokens prepended every prompt: 300 Working Memory (project/milestone/state) + 700 semantic
                        (Insights ≤4 · Digests ≤3 · Entities ≤3 · Observations ≤3) via Qdrant RRF from the
                        observations/digests/insights DB. <span className="underline">Click for full detail.</span>
                      </p>
                    </TooltipContent>
                  </Tooltip>
                )
              })}

              {/* cache breakpoint line at the prefix boundary */}
              <div
                className="pointer-events-none absolute top-0 bottom-0 border-l-2 border-dashed"
                style={{ left: `${prefixPct}%`, borderColor: C_READ }}
                aria-hidden
              />
            </div>
          </TooltipProvider>

          {/* prefix / fresh brackets */}
          <div className="mt-1 flex w-full text-[11px]">
            <div className="text-center" style={{ width: `${prefixPct}%` }}>
              <span className="font-medium" style={{ color: C_READ }}>◀ cacheable prefix — reused from provider cache</span>
            </div>
            <div className="text-center" style={{ width: `${100 - prefixPct}%` }}>
              <span className="font-medium" style={{ color: C_INPUT }}>new this turn ▶</span>
            </div>
          </div>

          {/* legend — real per-category bytes when a live capture exists */}
          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
            {SEGMENTS.map((seg) => (
              <div key={seg.key} className="flex items-center gap-2 text-xs">
                <span className="inline-block h-3 w-3 rounded-sm border" style={{ background: seg.fill, borderColor: seg.stroke }} />
                <span>{seg.label}</span>
                {activeReal
                  ? <span className="font-mono text-muted-foreground">{kb(realByKey[seg.key] ?? 0)}</span>
                  : seg.real && <span className="text-muted-foreground">(real ~1k tok · click)</span>}
              </div>
            ))}
          </div>

          {/* Honesty note — accurate to whether we measured the buffer or not. */}
          <p className="mt-3 border-t pt-2 text-xs text-muted-foreground">
            {activeReal ? (
              <>
                Sizes above are <span className="font-medium text-foreground">exact UTF-8 bytes</span> from the real
                <span className="font-mono"> /v1/messages</span> buffer (token figures are a ~bytes/4 estimate); the dashed line
                is the true <span className="font-mono">cache_control</span> prefix boundary. It’s still one contiguous buffer —
                categories are inferred by walking <span className="font-mono">system</span> → <span className="font-mono">tools</span>
                {' '}→ <span className="font-mono">messages</span> (tool outputs &amp; user turns are interleaved in the history,
                shown grouped here for legibility).
              </>
            ) : (
              <>
                This is a <span className="font-medium text-foreground">conceptual</span> ordering of one contiguous token buffer
                (the provider <span className="font-mono">messages</span> array), left→right in roughly the order it’s assembled —
                not a measured layout. Category sizes are illustrative because this run has no captured buffer (it predates the
                tap). <span className="font-medium text-foreground">Re-run the comparison</span> and each measured agent’s real,
                scaled sizes appear here. The measured quantities already shown are the{' '}
                <span style={{ color: C_READ }}>cache split</span> (from the timeline, below) and the ~1,000-token{' '}
                <span style={{ color: '#a855f7' }}>knowledge-injection</span> budget.
              </>
            )}
          </p>
        </div>

        {/* 3. Measured — what THIS run actually sent (real per-turn), + where the cache lives */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-md border p-3">
            <p className="text-sm font-semibold">Biggest turn — how its tokens were billed</p>
            <p className="mb-2 text-xs text-muted-foreground">
              Real measurement for this run’s largest turn. All of these tokens were <em>transmitted</em>; the colour is how the
              provider <em>billed &amp; (re)computed</em> them. <span style={{ color: C_READ }}>Green</span> = matched the cached
              prefix (re-read, ~0.1×), <span style={{ color: C_WRITE }}>amber</span> = written into cache this turn (~1.25×),{' '}
              <span style={{ color: C_INPUT }}>blue</span> = uncached fresh input (1×).
            </p>
            {s.maxSeg.total === 0 ? (
              <div className="flex h-16 items-center justify-center text-sm text-muted-foreground">
                {loading ? 'Loading…' : 'No timeline data.'}
              </div>
            ) : (
              <>
                <div className="flex h-8 w-full overflow-hidden rounded border">
                  {s.maxSeg.read > 0 && <div style={{ width: `${(s.maxSeg.read / s.maxSeg.total) * 100}%`, background: C_READ }} title={`cache read ${fmt(s.maxSeg.read)}`} />}
                  {s.maxSeg.write > 0 && <div style={{ width: `${(s.maxSeg.write / s.maxSeg.total) * 100}%`, background: C_WRITE }} title={`cache write ${fmt(s.maxSeg.write)}`} />}
                  {s.maxSeg.input > 0 && <div style={{ width: `${(s.maxSeg.input / s.maxSeg.total) * 100}%`, background: C_INPUT }} title={`fresh input ${fmt(s.maxSeg.input)}`} />}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {fmt(s.maxSeg.total)} tokens in that prompt
                  {windowPct != null && <> · {(windowPct * 100).toFixed(1)}% of the ~{Math.round((ctxMax as number) / 1000)}k window</>}
                  {' · '}
                  {s.maxSeg.read > 0
                    ? <span style={{ color: C_READ }}>{((s.maxSeg.read / s.maxSeg.total) * 100).toFixed(0)}% from cache</span>
                    : <span style={{ color: C_INPUT }}>0% from cache — full context re-sent</span>}
                </p>
              </>
            )}
          </div>

          {/* Where does the cache live? — resolves the "sent vs cached" paradox */}
          <div className="rounded-md border bg-muted/30 p-3">
            <p className="text-sm font-semibold">Sent every turn, yet cached — how?</p>
            <p className="mt-1 text-xs text-muted-foreground">
              The API is <span className="font-medium text-foreground">stateless</span>: the agent re-transmits the{' '}
              <em>whole</em> context over the wire <em>every</em> turn — nothing is “kept” client-side. What’s cached is the{' '}
              <span className="font-medium text-foreground">computation</span>, and it lives{' '}
              <span className="font-medium text-foreground">at the provider</span> (Anthropic) — not in the agent or the proxy.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              On each request the provider hashes the prefix marked by the <span className="font-mono">cache_control</span>{' '}
              breakpoints. If that hash matches a warm entry (TTL ≈ 5 min / 1 h), it reuses the stored attention state for those
              tokens instead of re-running the model over them — billing them as <span style={{ color: C_READ }}>cache_read</span>{' '}
              (~0.1×). So the bytes still cross the wire; caching cuts <em>re-computation &amp; cost</em>, not transmission.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              That’s why a long claude run is dominated by <span style={{ color: C_READ }}>cache_read</span>, while an{' '}
              <span className="font-medium text-foreground">opencode</span> run (whose provider path doesn’t set{' '}
              <span className="font-mono">cache_control</span>) makes the provider re-process the whole prefix as fresh{' '}
              <span style={{ color: C_INPUT }}>input</span> each turn.
            </p>
          </div>
        </div>

        {/* 4. Per-turn chart + stat cards (real) */}
        <div className="rounded-md border p-3">
          <p className="text-sm font-semibold">Per-turn tokens — transmitted, split by cache billing</p>
          <p className="mb-2 text-xs text-muted-foreground">
            Every bar is the tokens transmitted that turn, coloured by provider billing:{' '}
            <span style={{ color: C_READ }}>green</span> = cache read (re-used prefix), <span style={{ color: C_WRITE }}>amber</span> = cache
            write, <span style={{ color: C_INPUT }}>blue</span> = fresh input, <span style={{ color: C_OUTPUT }}>purple</span> = output.
          </p>
          {s.turnCount === 0 ? (
            <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
              {loading ? 'Loading…' : 'No timeline data.'}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={s.data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="turn" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
                <RTooltip formatter={(val, name) => [fmt(num(val)), String(name)]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="read" stackId="tok" name="cache read" fill={C_READ} />
                <Bar dataKey="write" stackId="tok" name="cache write" fill={C_WRITE} />
                <Bar dataKey="input" stackId="tok" name="fresh input" fill={C_INPUT} />
                <Bar dataKey="output" stackId="tok" name="output" fill={C_OUTPUT} />
              </BarChart>
            </ResponsiveContainer>
          )}
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatCard label="Cache read" value={fmt(s.totalRead)} color={C_READ} />
            <StatCard label="Cache write" value={fmt(s.totalWrite)} color={C_WRITE} />
            <StatCard label="Fresh input" value={fmt(s.totalInput)} color={C_INPUT} />
            <StatCard label="Output" value={fmt(s.totalOutput)} color={C_OUTPUT} />
          </div>
        </div>

        <KbDetailDialog open={kbOpen} onClose={() => setKbOpen(false)} real={activeReal} />
      </DialogContent>
    </Dialog>
  )
}
