import type { ReactNode } from 'react'
import { Fragment, useEffect, useMemo, useState } from 'react'
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
  fetchContextTurns,
  selectExplainTaskId,
  selectExplainRun,
  selectTimelineFor,
  selectContextTurnsFor,
  selectTimelineLoading,
  setExplainTaskId,
  type TimelineRow,
  type ContextTurnRow,
  type ContextTurnMessage,
  type CategoryDetail,
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
export interface Segment {
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
export const SEGMENTS: Segment[] = [
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

// Build a scaled context-window band from a real per-category byte map. Each
// PRESENT category (bytes > 0) is floored to a visible sliver (≥1.2%) so a
// tiny-but-real segment doesn't vanish, then renormalised so widths sum to 100.
// The dashed prefix boundary is everything except the fresh 'user' tail. Returns
// null when there is no real size to draw. Shared by the context-turns band
// (Phase 84 — real per-request categories) and the /api/context-breakdown band.
export function scaledBand(byKey: Record<string, number>, totalBytes: number): { view: Segment[]; prefixPct: number } | null {
  if (totalBytes <= 0) return null
  const raw = SEGMENTS.map((seg) => ({ seg, bytes: byKey[seg.key] ?? 0 })).filter((r) => r.bytes > 0)
  if (raw.length === 0) return null
  const floored = raw.map((r) => ({ ...r, w: Math.max(1.2, (r.bytes / totalBytes) * 100) }))
  const sum = floored.reduce((a, r) => a + r.w, 0)
  const view = floored.map((r) => ({ ...r.seg, w: (r.w / sum) * 100 }))
  const prefixW = view.filter((v) => v.key !== 'user').reduce((a, v) => a + v.w, 0)
  return { view, prefixPct: Math.min(100, prefixW) }
}

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
  categories: { key: string; label: string; bytes: number; detail?: CategoryDetail }[]
  // Provenance (identity-mismatch fallback): 'exact' = the proxy had a capture
  // under this run's own id; 'window' = the dashboard server matched a capture
  // recorded during this run's wall-clock window with a compatible model and
  // agent-class, because the proxy's span id differs from the runs-table id.
  matched_by?: 'exact' | 'window'
  matched_capture_id?: string
  matched_captured_at?: string
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
  // Wire discriminator (Plan 84-08) — carried through so the per-turn cache-write
  // render can branch: OpenAI-wire has no cache-creation counter (D-12).
  wire?: 'anthropic' | 'openai'
  // True when this turn's cache_write is null (OpenAI wire) — render N/A, not 0.
  writeNA?: boolean
  // "What this turn is actually doing" (D-07). Primary = the correlated ETM
  // observation's intent; fallback = the fresh user-input preview for the turn.
  note?: string
  // Source of `note` so the UI can label it honestly (observation vs preview).
  noteSource?: 'observation' | 'preview'
  // Bytes of the fresh (last-user) input this turn — the part that's new.
  freshBytes?: number
}

// Belt-and-suspenders client-side scrub for the per-turn narrative. Context-turns
// message previews are unredacted digests at the source (Plan 84-04 T-84-04-04:
// the redacted channel is raw-bodies.jsonl). Since we now surface a preview in the
// UI, mask the common secret shapes so a real secret in a prompt never renders on
// the dashboard. (The observation-intent path is already redacted upstream.)
const SECRET_SCRUBS: [RegExp, string][] = [
  [/sk-[A-Za-z0-9-]{6,}/g, 'sk-***'],
  [/ghp_[A-Za-z0-9]{6,}/g, 'ghp_***'],
  [/eyJ[A-Za-z0-9._-]{10,}/g, 'eyJ***'],
  [/\bBearer\s+[A-Za-z0-9._-]{6,}/gi, 'Bearer ***'],
  [/\bAKIA[0-9A-Z]{12,}/g, 'AKIA***'],
  // Corporate staff ID (q + 6 alphanumerics, at least one digit — the digit
  // lookahead avoids matching plain words like "quality"/"queried"). Mirrors the
  // canonical corporate_user_ids rule in .specstory/config/redaction-patterns.json.
  // Context-turns previews carry raw filesystem paths (e.g. /Users/Q284340/…), so
  // this masks the staff number that would otherwise render in the timeline/modal.
  [/\bq(?=[0-9a-z]{6}\b)(?=[0-9a-z]*\d)[0-9a-z]{6}\b/gi, '<USER_ID_REDACTED>'],
]
export function scrubSecrets(s: string): string {
  let out = s
  for (const [re, rep] of SECRET_SCRUBS) out = out.replace(re, rep)
  return out
}

// Pull the "what's happening" note for a turn (D-07 order of preference):
// correlated ETM observation intent first, else the fresh user-input preview.
function turnNote(t: ContextTurnRow): { note: string; noteSource: 'observation' | 'preview' } {
  const ref = t.observation_ref
  if (ref && typeof ref === 'object' && typeof ref.intent === 'string' && ref.intent.trim()) {
    return { note: scrubSecrets(ref.intent.trim()), noteSource: 'observation' }
  }
  if (typeof ref === 'string' && ref.trim()) {
    return { note: scrubSecrets(ref.trim()), noteSource: 'observation' }
  }
  const msgs = Array.isArray(t.messages) ? t.messages : []
  let lastUser: ContextTurnMessage | null = null
  for (const m of msgs) if (m?.role === 'user') lastUser = m
  const preview = (lastUser?.preview ?? '').trim()
  return { note: scrubSecrets(preview), noteSource: 'preview' }
}

// The exact honesty string for OpenAI-wire cache-write (D-12). OpenAI-wire
// providers (copilot/opencode) report cache reads but NO cache-creation counter,
// so a 0 would falsely imply "we tried to cache and wrote nothing". This string
// is load-bearing — the plan's acceptance greps for it verbatim.
export const CACHE_WRITE_NA = 'N/A (provider reports no cache-creation)'

/**
 * Flatten per-turn rows into chart data + totals. Prefers the REAL per-request
 * wire values from context-turns (Plan 84-08) when present — those carry the
 * honest cache split straight from the proxy tap, including the OpenAI-wire
 * `cache_write: null` (→ N/A, D-12). Falls back to the timeline rows (bytes/4
 * estimate) for runs with no captured context-turns.
 */
function summarize(timeline: TimelineRow[], contextTurns: ContextTurnRow[] = []) {
  const useWire = contextTurns.length > 0

  let data: TurnDatum[]
  let anyOpenAiWire = false
  let anyAnthropicWire = false

  if (useWire) {
    const turns = contextTurns
      .slice()
      .sort((a, b) => String(a.ts ?? '').localeCompare(String(b.ts ?? '')))
    data = turns.map((t, i) => {
      if (t.wire === 'openai') anyOpenAiWire = true
      if (t.wire === 'anthropic') anyAnthropicWire = true
      const writeNA = t.usage?.cache_write == null // null ONLY on the OpenAI wire (D-12)
      const { note, noteSource } = turnNote(t)
      // Fresh input this turn = bytes of the User Input category (the new tail).
      const freshBytes = (Array.isArray(t.categories) ? t.categories : [])
        .filter((c) => c.key === 'user')
        .reduce((a, c) => a + num(c.bytes), 0)
      return {
        turn: `T${i + 1}`,
        read: num(t.usage?.cache_read),
        // Never infer a cache-write value: OpenAI-wire is null → plot 0 height but
        // flag writeNA so the numeric render is replaced by the N/A string.
        write: writeNA ? 0 : num(t.usage?.cache_write),
        input: num(t.usage?.input),
        output: num(t.usage?.output),
        wire: t.wire,
        writeNA,
        note,
        noteSource,
        freshBytes,
      }
    })
  } else {
    const turns = timeline
      .filter((r) => (r.granularity_tier ?? '') !== 'per-session-aggregate')
      .slice()
      .sort((a, b) => String(a.timestamp ?? '').localeCompare(String(b.timestamp ?? '')))
    data = turns.map((t, i) => ({
      turn: `T${i + 1}`,
      read: num(t.cache_read_tokens),
      write: num(t.cache_write_tokens),
      input: num(t.input_tokens),
      output: num(t.output_tokens),
    }))
  }

  // Run-level cache-write honesty: a PURE OpenAI-wire run (copilot/opencode) has
  // no cache-creation counter at all, so the aggregate Cache-write must render as
  // N/A, never a summed 0 (D-12). A run with ANY Anthropic-wire turn keeps the
  // real number.
  const writeIsNA = useWire && anyOpenAiWire && !anyAnthropicWire

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
    turnCount: data.length,
    caches: totalRead > 0,
    // Plan 84-08: honest wire provenance for the render layer.
    usingWire: useWire,
    writeIsNA,
  }
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  // Long honesty strings (e.g. the OpenAI-wire N/A note) shrink so they stay
  // legible inside the card instead of overflowing the fixed-size number slot.
  const long = value.length > 12
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={`mt-1 font-semibold ${long ? 'font-sans text-xs leading-snug' : 'font-mono text-lg'}`}
        style={color ? { color } : undefined}
      >
        {value}
      </p>
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

// Phase B: one structured item from the retrieval capture (/api/retrieve-capture),
// carrying the scores that never survive markdown flattening. `rrfScore` is the
// final fused relevance-to-this-prompt; `score` the raw Qdrant cosine.
interface KbCaptureItem {
  id: string | number | null
  tier: string // insights | digests | kg_entities | observations
  rrfScore: number | null
  score: number | null
  payload: {
    topic?: string; theme?: string; entityType?: string; agent?: string
    project?: string; date?: string; hierarchyLevel?: string | number
    confidence?: number; quality?: number; summary_preview?: string
  }
}
// Map a KB section name → the capture's tier key. Working Memory has no structured
// items (it's flattened state), so it's absent here and stays a markdown blob.
const SECTION_TIER: Record<string, string> = {
  Insights: 'insights',
  Digests: 'digests',
  Entities: 'kg_entities',
  Observations: 'observations',
}

// The 5 canonical KB sections. Item bodies can themselves contain `##` sub-headers
// (e.g. an Insight's "## Purpose"), so we split the captured block ONLY on these
// known top-level names — never on a bare `##`.
interface KbSection { name: string; body: string; items: string[] }
function parseKnowledgeSections(text?: string | null): Record<string, KbSection> {
  const out: Record<string, KbSection> = {}
  if (!text || !text.trim()) return out
  const headerRe = /^##\s+(Working Memory|Insights|Digests|Entities|Observations)\s*$/
  let cur: KbSection | null = null
  for (const ln of text.split(/\r?\n/)) {
    const m = ln.match(headerRe)
    if (m) { cur = { name: m[1], body: '', items: [] }; out[m[1]] = cur; continue }
    if (cur) cur.body += (cur.body ? '\n' : '') + ln
  }
  for (const k of Object.keys(out)) {
    const body = out[k].body.trim()
    out[k].body = body
    // Working Memory is structured state, not a ranked list — keep it whole.
    out[k].items = k === 'Working Memory'
      ? (body ? [body] : [])
      : body.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)
  }
  return out
}

// First non-empty line of a block, for the abbreviated preview in the KB modal.
function kbFirstLine(s: string, max = 150): string {
  const ln = (s.split(/\r?\n/).find((l) => l.trim()) ?? '').trim()
  return ln.length > max ? ln.slice(0, max - 1) + '…' : ln
}

// One structured (scored) item card. `rrfScore` is the relevance-to-this-prompt;
// confidence/quality are the item's own intrinsic score where the tier carries one.
function KbScoredCard({ item }: { item: KbCaptureItem }): ReactNode {
  const p = item.payload || {}
  const title = p.topic || p.theme || p.entityType || (p.agent ? `${p.agent}${p.date ? ` · ${p.date}` : ''}` : 'item')
  const intrinsic = typeof p.confidence === 'number'
    ? `confidence ${p.confidence}`
    : typeof p.quality === 'number' ? `quality ${p.quality}`
    : (p.hierarchyLevel != null ? `level ${p.hierarchyLevel}` : (p.date || ''))
  return (
    <div className="rounded border p-2" data-testid="kb-item-card">
      <div className="mb-1 flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{title}</p>
        <div className="flex shrink-0 items-center gap-1">
          {intrinsic && <Badge variant="outline" className="text-[10px]">{intrinsic}</Badge>}
          {typeof item.rrfScore === 'number' && (
            <Badge variant="secondary" className="font-mono text-[10px]" title="RRF relevance to this prompt">
              rel {item.rrfScore.toFixed(3)}
            </Badge>
          )}
        </div>
      </div>
      {p.summary_preview && (
        <p className="whitespace-pre-wrap text-[11px] leading-snug text-muted-foreground">{p.summary_preview}</p>
      )}
    </div>
  )
}

// 3rd-level sub-modal: the FULL captured content of one KB section. Prefers the
// structured (scored) capture when present, else falls back to the markdown blocks
// parsed from the injected text. Stacks on top of KbDetailDialog (Radix nesting).
function KbCategoryDialog({ name, section, structured, onClose }: {
  name: string | null
  section: KbSection | null
  structured: KbCaptureItem[]
  onClose: () => void
}) {
  const meta = KB_SECTIONS.find((s) => s.name === name) || null
  const hasScored = structured.length > 0
  return (
    <Dialog open={name != null} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-[760px] w-[90vw] max-h-[85vh] overflow-y-auto" data-testid="kb-category-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {name} — what was retrieved
            {meta && <Badge variant="outline" className="font-mono text-[10px]">{meta.src}</Badge>}
          </DialogTitle>
          <DialogDescription>
            {meta?.detail} The exact content injected for this run
            {hasScored ? ', each with its relevance score to this prompt.' : ', verbatim from its captured buffer.'}
          </DialogDescription>
        </DialogHeader>
        {hasScored ? (
          <div className="space-y-2" data-testid="kb-category-items">
            {structured.map((it, i) => <KbScoredCard key={it.id != null ? String(it.id) : i} item={it} />)}
          </div>
        ) : section && section.items.length > 0 ? (
          <div className="space-y-2" data-testid="kb-category-items">
            {section.items.map((it, i) => (
              <div key={i} className="rounded border p-2" data-testid="kb-item-card">
                <pre className="whitespace-pre-wrap text-[11px] leading-snug">{it}</pre>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            This section is empty in the captured block for this run.
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Nested pop-up: the deep detail for the Retrieved-Knowledge injection. */
function KbDetailDialog({ open, onClose, real, agent, kbItems }: { open: boolean; onClose: () => void; real: RealBreakdown | null; agent?: string | null; kbItems?: KbCaptureItem[] | null }) {
  const injected = real?.knowledge_text?.trim() || null
  const sections = useMemo(() => parseKnowledgeSections(injected), [injected])
  const [openSection, setOpenSection] = useState<string | null>(null)
  const structuredFor = (nm: string | null): KbCaptureItem[] => {
    const tier = nm ? SECTION_TIER[nm] : undefined
    return tier && kbItems ? kbItems.filter((i) => i.tier === tier) : []
  }
  // Claude (UserPromptSubmit hook) and OpenCode (chat.messages.transform plugin)
  // inject the KB block per prompt. Copilot exposes no per-prompt hook API, so it
  // genuinely can't — its empty-state must say so rather than a misleading "re-run".
  const agentInjectsKb = !agent || /claude|opencode/i.test(agent)
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

        {/* Header line: real content lights up the per-category rows below; the
            two empty cases are distinguished honestly (agent-vs-capture). */}
        {injected ? (
          <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground" data-testid="kb-real-content">
            <span className="font-semibold text-foreground">The real retrieved content</span> for this run is broken out per
            category below — click any category for its full captured text.
            {typeof real?.knowledge_occurrences === 'number' && (
              <> This buffer carried <span className="font-medium text-foreground">{real.knowledge_occurrences} injection{real.knowledge_occurrences === 1 ? '' : 's'}</span> (most-recent shown).</>
            )}
            {real?.matched_by === 'window' && (
              <> Capture matched by time window (proxy span <span className="font-mono">{real.matched_capture_id}</span>).</>
            )}
          </div>
        ) : !agentInjectsKb ? (
          <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground" data-testid="kb-no-content">
            <span className="font-medium text-foreground">{agent || 'This agent'}</span> does receive KB via its
            <span className="font-mono"> postToolUse</span> hook (per-turn, when Copilot file-hooks are enabled), but Copilot runs
            don’t route through the proxy tap this modal reads — so their injected context isn’t captured here. Open a
            <span className="font-medium text-foreground"> Claude</span> or <span className="font-medium text-foreground">OpenCode</span>
            run to see the captured retrieved knowledge. The schema below shows what the block is composed of.
          </div>
        ) : (
          <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground" data-testid="kb-no-content">
            No captured buffer for this run, so the exact injected text isn’t available (it predates the capture tap). Claude and
            OpenCode inject the block per prompt — re-run it to record the content. The schema below shows what the block is
            composed of.
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
          {KB_SECTIONS.map((s) => {
            const sec = sections[s.name]
            const hasContent = !!sec && sec.items.length > 0
            const preview = hasContent ? kbFirstLine(sec.body) : s.detail
            const inner = (
              <>
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {s.name} <span className="ml-1 font-mono text-xs text-muted-foreground">{s.budget}</span>
                    {hasContent && s.name !== 'Working Memory' && (
                      <span className="ml-2 text-xs text-muted-foreground">· {sec.items.length} item{sec.items.length === 1 ? '' : 's'}</span>
                    )}
                  </p>
                  <p className={'truncate text-xs ' + (hasContent ? 'text-foreground/80' : 'text-muted-foreground')}>{preview}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="outline" className="font-mono text-[10px]">{s.src}</Badge>
                  {hasContent && <span className="text-muted-foreground" aria-hidden>›</span>}
                </div>
              </>
            )
            const testId = `kb-section-${s.name.toLowerCase().replace(/\s+/g, '-')}`
            return hasContent ? (
              <button
                key={s.name}
                type="button"
                onClick={() => setOpenSection(s.name)}
                data-testid={testId}
                className="flex w-full cursor-pointer items-start justify-between gap-3 rounded border px-3 py-2 text-left transition-colors hover:bg-muted/50"
              >
                {inner}
              </button>
            ) : (
              <div key={s.name} data-testid={testId} className="flex items-start justify-between gap-3 rounded border px-3 py-2">
                {inner}
              </div>
            )
          })}
        </div>

        <KbCategoryDialog
          name={openSection}
          section={openSection ? (sections[openSection] ?? null) : null}
          structured={structuredFor(openSection)}
          onClose={() => setOpenSection(null)}
        />

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

// Generic per-category descriptions — shown in the drill-down sub-modal when a run
// has no captured wire buffer (illustrative runs), so a click is still informative.
const CATEGORY_EXPLAIN: Record<string, string> = {
  sys: 'System Instructions — the base system prompt / persona and operating rules prepended to every turn (AGENTS.md, tool-use policy, safety and formatting rules).',
  tools: 'Tool Descriptions — the JSON tool definitions (name, description, input schema) the model may call, serialized into every request.',
  know: 'Retrieved Knowledge — the ~1k-token KB block injected each prompt (Working Memory + semantic Insights/Digests/Entities/Observations via Qdrant RRF).',
  hist: 'Conversation History — the accumulated prior user/assistant turns re-transmitted every request (the stateless API keeps nothing server-side).',
  tout: 'Tool Outputs — results returned from tool calls (file reads, command output, search results) fed back into the context.',
  user: 'User Input — the current turn’s user message.',
}

// Generic per-category drill-down sub-modal. Opened by clicking any context-window
// band/legend entry (except `know`, which keeps its richer KbDetailDialog). Renders
// the CONCRETE thing sent to the LLM for that category, sourced from the proxy's
// buildCategoryDetails() (real wire buffer) — tool definitions for `tools`, the
// memoized system-prompt summary for `sys`, and bounded content samples otherwise.
function CategoryDetailModal({
  segKey,
  onClose,
  detail,
  bytes,
}: {
  segKey: string | null
  onClose: () => void
  detail: CategoryDetail | null
  bytes: number | null
}) {
  const seg = SEGMENTS.find((s) => s.key === segKey) || null
  const fmtB = (b?: number | null) => (typeof b === 'number' ? `${(b / 1024).toFixed(b < 1024 ? 2 : 1)} KB` : '—')
  return (
    <Dialog open={segKey != null} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-[760px] w-[90vw] max-h-[85vh] overflow-y-auto" data-testid="category-detail-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {seg && <span className="inline-block h-3 w-3 rounded-sm" style={{ background: seg.fill, border: `1px solid ${seg.stroke}` }} />}
            {seg?.label || segKey} — what was sent
          </DialogTitle>
          <DialogDescription>
            The concrete content the LLM received for this category, extracted from this run’s captured wire buffer
            {typeof bytes === 'number' && <> (<span className="font-mono">{fmtB(bytes)}</span> on the wire)</>}.
          </DialogDescription>
        </DialogHeader>

        {!detail ? (
          <div className="space-y-2" data-testid="cat-no-detail">
            <p className="text-sm text-muted-foreground">{CATEGORY_EXPLAIN[segKey ?? ''] ?? 'A slice of the context window sent to the model.'}</p>
            <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              This run has no captured wire buffer for this category — it predates the drill-down capture tap,
              or the agent has no proxy seam. Re-run the comparison to record the concrete content that was sent.
            </div>
          </div>
        ) : detail._error ? (
          <div className="rounded-md border border-dashed border-red-400/50 p-3 text-xs text-red-500">
            Detail construction failed: <span className="font-mono">{detail._error}</span>
          </div>
        ) : segKey === 'tools' ? (
          <div data-testid="cat-tools">
            <p className="mb-2 text-sm">
              <span className="font-semibold">{detail.count ?? detail.items?.length ?? 0}</span> tool definition
              {(detail.count ?? 0) === 1 ? '' : 's'} sent to the model:
            </p>
            <div className="space-y-2">
              {(detail.items || []).map((t, i) => (
                <div key={`${t.name}-${i}`} className="rounded border p-2">
                  <div className="flex items-center justify-between">
                    <p className="font-mono text-sm font-semibold">{t.name}</p>
                    <Badge variant="outline" className="font-mono text-[10px]">{fmtB(t.bytes)}</Badge>
                  </div>
                  {t.description && <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{t.description}</p>}
                  {t.input_schema_keys && t.input_schema_keys.length > 0 && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      params: {t.input_schema_keys.map((k) => <span key={k} className="mr-1 font-mono">{k}</span>)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : segKey === 'sys' ? (
          <div data-testid="cat-sys">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="outline" className="font-mono">{detail.block_count ?? 0} block{(detail.block_count ?? 0) === 1 ? '' : 's'}</Badge>
              <Badge variant="outline" className="font-mono">{detail.total_chars?.toLocaleString() ?? '—'} chars</Badge>
              {detail.hash && <Badge variant="outline" className="font-mono">#{detail.hash}</Badge>}
              {detail.cached && <Badge className="bg-emerald-600 font-mono text-[10px]">cached summary</Badge>}
            </div>
            {detail.section_headers && detail.section_headers.length > 0 && (
              <div className="mb-2 rounded border p-2">
                <p className="mb-1 text-xs font-semibold">Sections ({detail.section_headers.length})</p>
                <ul className="space-y-0.5">
                  {detail.section_headers.map((h, i) => (
                    <li key={i} className="truncate font-mono text-[11px] text-muted-foreground">{h}</li>
                  ))}
                </ul>
              </div>
            )}
            {detail.preview && (
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2 text-[11px] leading-snug">{detail.preview}</pre>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              Summary is memoized by content hash — the system prompt is stable across turns, so it’s computed once per unique hash and reused.
            </p>
          </div>
        ) : (
          <div data-testid="cat-samples">
            <p className="mb-2 text-sm">
              <span className="font-semibold">{detail.count ?? detail.items?.length ?? 0}</span> block
              {(detail.count ?? 0) === 1 ? '' : 's'} in this category:
            </p>
            <div className="space-y-2">
              {(detail.items || []).map((m, i) => (
                <div key={i} className="rounded border p-2">
                  <div className="mb-1 flex items-center justify-between">
                    {m.role && <span className="font-mono text-xs font-semibold">{m.role}</span>}
                    <Badge variant="outline" className="font-mono text-[10px]">{fmtB(m.bytes)}</Badge>
                  </div>
                  {m.preview && <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2 text-[11px] leading-snug">{m.preview}</pre>}
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function ContextCacheExplainer() {
  const dispatch = useAppDispatch()
  const taskId = useAppSelector(selectExplainTaskId)
  const run = useAppSelector(selectExplainRun)
  const timeline = useAppSelector(selectTimelineFor(taskId))
  const contextTurns = useAppSelector(selectContextTurnsFor(taskId))
  const loading = useAppSelector(selectTimelineLoading)
  const [kbOpen, setKbOpen] = useState(false)
  const [catOpen, setCatOpen] = useState<string | null>(null)
  const [real, setReal] = useState<RealBreakdown | null>(null)
  // Phase B: structured per-item KB capture for THIS run (scored cards in the KB
  // drill-down). Forward-only — populated once the run went through the retrieval
  // hook with its task_id after Phase B shipped; null/[] otherwise (Phase-A markdown
  // fallback still renders the content).
  const [kbItems, setKbItems] = useState<KbCaptureItem[] | null>(null)

  const open = taskId != null
  const close = () => dispatch(setExplainTaskId(null))

  useEffect(() => {
    if (taskId && timeline.length === 0) dispatch(fetchTimeline(taskId))
    // Plan 84-08: also pull the real per-request context-turns for honest wire
    // values (sent/cached/fresh + OpenAI-wire N/A cache-write).
    if (taskId && contextTurns.length === 0) dispatch(fetchContextTurns(taskId))
  }, [taskId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Real wire-buffer breakdown — PER RUN. We ask the proxy for THIS run's own
  // captured buffer (keyed by its measurement task_id). When the exact id has
  // no capture (the proxy keys captures by its OWN span id, which often differs
  // from the runs-table id), we also send the run's wall-clock window + model +
  // agent so the server can match the capture recorded DURING this run — the
  // response carries matched_by:'window' provenance in that case. Only when
  // neither exists does the band fall back to the clearly-illustrative one.
  useEffect(() => {
    if (!open || !taskId) { setReal(null); return }
    let cancelled = false
    setReal(null)
    const params = new URLSearchParams({ task_id: taskId })
    const winStart = run?.started_at
    const winEnd = run?.ended_at
    const runModel = run?.canonical_model ?? run?.model
    const runAgent = run?.canonical_agent ?? run?.agent
    if (winStart) params.set('window_start', winStart)
    if (winEnd) params.set('window_end', winEnd)
    if (runModel) params.set('model', runModel)
    if (runAgent) params.set('agent', runAgent)
    fetch(`/api/context-breakdown?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d && Array.isArray(d.categories) && d.total_bytes > 0) setReal(d as RealBreakdown) })
      .catch(() => { /* no per-run capture — fall back to illustrative */ })
    return () => { cancelled = true }
  }, [open, taskId, run?.started_at, run?.ended_at]) // eslint-disable-line react-hooks/exhaustive-deps

  // Phase B: the structured per-item KB capture for this run (scored cards).
  useEffect(() => {
    if (!open || !taskId) { setKbItems(null); return }
    let cancelled = false
    setKbItems(null)
    fetch(`/api/retrieve-capture?task_id=${encodeURIComponent(taskId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d && Array.isArray(d.items)) setKbItems(d.items as KbCaptureItem[]) })
      .catch(() => { /* no structured capture — markdown parse still renders content */ })
    return () => { cancelled = true }
  }, [open, taskId])

  const s = useMemo(() => summarize(timeline, contextTurns), [timeline, contextTurns])

  // Rows the raw token-usage timeline would show for this task (same filter
  // summarize uses). When it exceeds the measured per-request context-turns count,
  // the difference is concurrent foreground/background traffic swept into the
  // task's wall-clock window (Phase-75) — surfaced in the reconciliation note.
  const timelineTurnCount = useMemo(
    () => timeline.filter((r) => (r.granularity_tier ?? '') !== 'per-session-aggregate').length,
    [timeline],
  )

  // `real` is already THIS run's own capture (fetched by task_id), so it is
  // safe to use directly — no cross-run leakage possible.
  const activeReal = real

  // Effective band segments — the real make-up of the context window, size-scaled,
  // with actual per-category bytes surfaced in the legend. Source precedence:
  //   1. THIS PHASE's per-request context-turns (Plan 84): the representative
  //      (largest) turn carries a real `categories[].bytes` split straight from
  //      the proxy write hook — the honest, always-captured make-up for any
  //      measured run of any wire (anthropic OR openai).
  //   2. The older /api/context-breakdown per-run buffer capture (activeReal).
  //   3. Illustrative fixed widths, only when neither real source exists.
  const { segView, prefixPct, realByKey, detailByKey, bandSource, bandTotalBytes, bandMsgCount } = useMemo(() => {
    // 1) Per-request context-turns — pick the turn with the largest total
    //    context (the representative "one full prompt sent to the backend").
    if (contextTurns.length > 0) {
      let best: ContextTurnRow | null = null
      let bestTotal = -1
      for (const t of contextTurns) {
        const cats = Array.isArray(t.categories) ? t.categories : []
        const total = cats.reduce((a, c) => a + num(c.bytes), 0)
        if (total > bestTotal) { bestTotal = total; best = t }
      }
      if (best && bestTotal > 0) {
        const byKey: Record<string, number> = {}
        const detByKey: Record<string, CategoryDetail | undefined> = {}
        for (const c of best.categories) { byKey[c.key] = num(c.bytes); detByKey[c.key] = c.detail }
        const band = scaledBand(byKey, bestTotal)
        if (band) {
          return {
            segView: band.view,
            prefixPct: band.prefixPct,
            realByKey: byKey,
            detailByKey: detByKey,
            bandSource: 'turns' as const,
            bandTotalBytes: bestTotal,
            bandMsgCount: Array.isArray(best.messages) ? best.messages.length : 0,
          }
        }
      }
    }
    // 2) /api/context-breakdown capture.
    const real = activeReal
    const byKey: Record<string, number> = {}
    const detByKey: Record<string, CategoryDetail | undefined> = {}
    if (real) for (const c of real.categories) { byKey[c.key] = c.bytes; detByKey[c.key] = c.detail }
    if (real && real.total_bytes > 0) {
      const band = scaledBand(byKey, real.total_bytes)
      if (band) {
        return {
          segView: band.view,
          prefixPct: band.prefixPct,
          realByKey: byKey,
          detailByKey: detByKey,
          bandSource: 'real' as const,
          bandTotalBytes: real.total_bytes,
          bandMsgCount: real.message_count,
        }
      }
    }
    // 3) Illustrative.
    return { segView: SEGMENTS, prefixPct: PREFIX_PCT, realByKey: byKey, detailByKey: detByKey, bandSource: 'illustrative' as const, bandTotalBytes: 0, bandMsgCount: 0 }
  }, [activeReal, contextTurns])

  // True whenever the band is drawn from a real size source (either context-turns
  // or the /api/context-breakdown capture) — controls the "measured" copy + the
  // per-category byte sizes in the legend.
  const bandMeasured = bandSource !== 'illustrative'

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
              {bandSource === 'turns'
                ? <>proportions <span className="font-medium text-foreground">measured</span> from this run’s per-request context-turns (largest turn) · exact UTF-8 bytes per category</>
                : bandSource === 'real'
                  ? <>proportions <span className="font-medium text-foreground">measured</span> from this run’s captured buffer · cache boundary is the real <span className="font-mono">cache_control</span> offset</>
                  : <>proportions illustrative · this run’s real cache split is shown below</>}
            </p>
          </div>

          {/* Per-request context-turns make-up (Plan 84) — the representative
              (largest) turn's real per-category byte split. Always captured for a
              measured run, so this is the primary "real make-up" banner. */}
          {bandSource === 'turns' && (
            <div className="mb-2 rounded-md border px-3 py-1.5 text-xs" style={{ borderColor: C_READ, background: C_READ + '10' }} data-testid="turns-capture-banner">
              <span className="font-medium" style={{ color: C_READ }}>Measured context make-up ({agent || 'agent'})</span>{' '}
              — this run’s largest turn assembled{' '}
              <span className="font-mono">{kb(bandTotalBytes)}</span> across {bandMsgCount} message{bandMsgCount === 1 ? '' : 's'};
              the band + legend below are <span className="font-medium text-foreground">exact UTF-8 bytes per category</span> from the
              per-request context-turns. Only the <span style={{ color: C_INPUT }}>User Input</span> tail is fresh each turn — the
              cacheable prefix (everything to its left) is what a provider cache can re-read.
            </div>
          )}

          {/* Per-run wire capture — this run's OWN buffer (fetched by task_id).
              Absent for runs that predate the tap, or copilot (no proxy seam). */}
          {bandSource === 'real' && activeReal && (
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
              {activeReal.matched_by === 'window' && (
                <span className="text-muted-foreground" data-testid="window-match-provenance">
                  {' '}Capture matched by time window — the proxy recorded it during this run under span{' '}
                  <span className="font-mono">{activeReal.matched_capture_id}</span>
                  {activeReal.matched_captured_at ? <> at {new Date(activeReal.matched_captured_at).toLocaleTimeString()}</> : null}.
                </span>
              )}
            </div>
          )}
          {bandSource === 'illustrative' && (
            <div className="mb-2 rounded-md border border-dashed px-3 py-1.5 text-xs text-muted-foreground" data-testid="no-real-capture-note">
              The band below is <span className="font-medium text-foreground">illustrative</span> — this run has no per-category
              wire capture under its own id, and no compatible capture was recorded during its time window
              {run?.agent === 'copilot' ? ' (interactive copilot does not route through the proxy seam)' : ''};
              <span className="font-medium text-foreground"> re-run the comparison</span> to record each agent’s real buffer. This
              run’s measured cache split (read/write, per-turn) is still shown below.
            </div>
          )}

          {/* brace label */}
          <p className="mb-1 text-center text-xs font-medium text-muted-foreground">◜ Context Window sent to the model each turn ◝</p>

          {/* One CONTIGUOUS token buffer (messages array) — no gaps. Blocks are
              colour-only; labels live in the legend so nothing is unreadable. The
              band and its prefix/fresh label row share ONE relative wrapper so the
              cache-boundary divider can span BOTH — visually connecting the split
              in the band to the labels beneath it (operator refinement #1). */}
          <TooltipProvider delayDuration={100}>
            <div className="relative">
              <div className="relative flex w-full overflow-hidden rounded-md border" style={{ height: 44 }}>
                {segView.map((seg, i) => {
                  const divider = i > 0 ? '1px solid rgba(0,0,0,0.28)' : undefined
                  if (seg.key !== 'know') {
                    // Every category is ALWAYS clickable — opens a per-category
                    // sub-modal. When this run has a captured wire buffer the modal
                    // shows the concrete content; otherwise it explains the category
                    // and notes the capture is absent (predates the tap / no proxy seam).
                    return (
                      <button
                        key={seg.key}
                        type="button"
                        onClick={() => setCatOpen(seg.key)}
                        data-testid={`cat-segment-${seg.key}`}
                        className="h-full cursor-pointer p-0 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        title={`${seg.label} — click for detail`}
                        style={{ width: `${seg.w}%`, background: seg.fill, borderLeft: divider }}
                        aria-label={`${seg.label} — click for detail`}
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
              </div>

              {/* prefix / fresh brackets */}
              <div className="mt-1 flex w-full text-[11px]">
                <div className="text-center" style={{ width: `${prefixPct}%` }}>
                  <span className="font-medium" style={{ color: C_READ }}>◀ cacheable prefix — reused from provider cache</span>
                </div>
                <div className="text-center" style={{ width: `${100 - prefixPct}%` }}>
                  <span className="font-medium" style={{ color: C_INPUT }}>new this turn ▶</span>
                </div>
              </div>

              {/* Cache-boundary divider — the cacheable-prefix ↔ new-this-turn split.
                  It spans the band AND the label row (this shared relative wrapper),
                  aligned to prefixPct, so it visually connects the boundary in the
                  band down to the two labels beneath it. Bold (3px) + theme-aware
                  border-foreground for clear visibility in light AND dark mode —
                  replaces the faint 2px green line (operator refinement #1). */}
              <div
                className="pointer-events-none absolute top-0 bottom-0 z-10 border-l-[3px] border-dashed border-foreground"
                style={{ left: `${prefixPct}%`, marginLeft: -1.5 }}
                aria-hidden
              />
            </div>
          </TooltipProvider>

          {/* legend — real per-category bytes when a live capture exists */}
          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
            {SEGMENTS.map((seg) => {
              const clickable = seg.key !== 'know'
              const onClick = seg.key === 'know' ? () => setKbOpen(true) : clickable ? () => setCatOpen(seg.key) : undefined
              return (
                <div
                  key={seg.key}
                  className={`flex items-center gap-2 text-xs ${onClick ? 'cursor-pointer hover:underline' : ''}`}
                  onClick={onClick}
                  data-testid={onClick ? `cat-legend-${seg.key}` : undefined}
                >
                  <span className="inline-block h-3 w-3 rounded-sm border" style={{ background: seg.fill, borderColor: seg.stroke }} />
                  <span>{seg.label}</span>
                  {bandMeasured
                    ? <span className="font-mono text-muted-foreground">{kb(realByKey[seg.key] ?? 0)}</span>
                    : seg.real && <span className="text-muted-foreground">(real ~1k tok · click)</span>}
                </div>
              )
            })}
          </div>

          {/* Honesty note — accurate to whether we measured the buffer or not. */}
          <p className="mt-3 border-t pt-2 text-xs text-muted-foreground">
            {bandSource === 'turns' ? (
              <>
                Sizes above are <span className="font-medium text-foreground">exact UTF-8 bytes per category</span> from this run’s
                <span className="font-mono"> per-request context-turns</span> (the largest turn shown). The dashed line is the
                cacheable-prefix boundary — everything before the fresh <span style={{ color: C_INPUT }}>User Input</span> tail. It’s
                one contiguous buffer; categories are attributed by walking <span className="font-mono">system</span> →{' '}
                <span className="font-mono">tools</span> → <span className="font-mono">messages</span>.{' '}
                {s.usingWire ? (
                  <>The per-turn <span className="font-medium text-foreground">token</span> split below is the{' '}
                  <span className="font-medium text-foreground">real usage-reported count</span> from each request’s wire response.</>
                ) : null}
              </>
            ) : bandSource === 'real' ? (
              <>
                Sizes above are <span className="font-medium text-foreground">exact UTF-8 bytes</span> from the real
                <span className="font-mono"> /v1/messages</span> buffer; the dashed line is the true{' '}
                <span className="font-mono">cache_control</span> prefix boundary. It’s still one contiguous buffer —
                categories are inferred by walking <span className="font-mono">system</span> → <span className="font-mono">tools</span>
                {' '}→ <span className="font-mono">messages</span> (tool outputs &amp; user turns are interleaved in the history,
                shown grouped here for legibility).{' '}
                {s.usingWire ? (
                  <>The per-turn <span className="font-medium text-foreground">token</span> split below is now the{' '}
                  <span className="font-medium text-foreground">real usage-reported count</span> from each request’s wire
                  response — not a ~bytes/4 estimate.</>
                ) : (
                  <>Per-turn token figures below are a ~bytes/4 estimate (no captured context-turns for this run yet).</>
                )}
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
              On each request the provider hashes the stable prefix and, if that hash matches a warm entry (TTL ≈ 5 min / 1 h),
              reuses the stored attention state for those tokens instead of re-running the model over them — billing them as{' '}
              <span style={{ color: C_READ }}>cache_read</span> (~0.1×). So the bytes still cross the wire; caching cuts{' '}
              <em>re-computation &amp; cost</em>, not transmission.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Which prefix gets cached depends on the wire.</span> On the{' '}
              <span className="font-medium" style={{ color: C_READ }}>Anthropic wire</span> (claude / claude-code / anthropic) it’s{' '}
              <em>explicit</em>: a <span className="font-mono">cache_control</span> breakpoint marks the boundary — the proxy now
              injects those breakpoints on its native paths, so those runs both <span style={{ color: C_WRITE }}>write</span> and{' '}
              <span style={{ color: C_READ }}>read</span> the cache. On the{' '}
              <span className="font-medium" style={{ color: C_INPUT }}>OpenAI wire</span> (copilot / opencode) it’s{' '}
              <em>implicit</em>: the gateway auto-detects a repeated prefix and returns <span className="font-mono">cached_tokens</span>{' '}
              on its own — no <span className="font-mono">cache_control</span>, and <span className="font-medium text-foreground">no
              write counter exists at all</span> (so cache-write reads <span className="font-medium text-foreground">N/A</span>, never 0).
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              That implicit prefix is also why an opencode/copilot run still shows a green{' '}
              <span style={{ color: C_READ }}>cache_read</span> floor with <em>zero</em> writes: the static head (system + tools +
              knowledge) stays byte-identical every turn, so it keeps matching a warm entry. The floor rises above that baseline
              when recent conversation history is <em>also</em> still warm within the TTL, and drops back after a gap longer than
              the TTL expires the entry — leaving only the static head cached.
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
            <StatCard label="Cache write" value={s.writeIsNA ? CACHE_WRITE_NA : fmt(s.totalWrite)} color={C_WRITE} />
            <StatCard label="Fresh input" value={fmt(s.totalInput)} color={C_INPUT} />
            <StatCard label="Output" value={fmt(s.totalOutput)} color={C_OUTPUT} />
          </div>

          {/* Reconciliation (Plan 84-09): give an explicit measured grand total so
              it reconciles against a raw token-usage timeline, AND explain why the
              timeline may show MORE rows/tokens than this modal — the timeline is a
              wall-clock correlation that also attributes concurrent foreground/
              background proxy traffic to the task window (Phase-75), whereas these
              per-request context-turns count ONLY the measured requests. */}
          {s.usingWire && s.turnCount > 0 && (
            <p className="mt-2 rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground" data-testid="reconciliation-note">
              <span className="font-medium text-foreground">{fmt(s.totalRead + s.totalWrite + s.totalInput + s.totalOutput)} tokens</span>{' '}
              transmitted across <span className="font-medium text-foreground">{s.turnCount}</span> measured
              request{s.turnCount === 1 ? '' : 's'} (cache read {fmt(s.totalRead)} + cache write{' '}
              {s.writeIsNA ? 'N/A' : fmt(s.totalWrite)} + fresh input {fmt(s.totalInput)} + output {fmt(s.totalOutput)}).
              {timelineTurnCount > s.turnCount ? (
                <>
                  {' '}A raw token-usage timeline for this task may list{' '}
                  <span className="font-medium text-foreground">{timelineTurnCount}</span> rows — the extra{' '}
                  <span className="font-medium text-foreground">{timelineTurnCount - s.turnCount}</span> are turns the
                  context-turns write hook never sees (e.g. <span className="font-mono">claude-code</span> CLI adapter
                  turns), plus concurrent foreground/background proxy calls attributed to this task’s wall-clock window
                  (Phase-75 time-window attribution) — measured via the token-usage source but{' '}
                  <span className="font-medium text-foreground">not</span> part of these proxy-wire requests. This modal
                  counts only the measured requests, so those rows — and any large{' '}
                  <span style={{ color: C_READ }}>cache_read</span> they carry — are deliberately excluded here. Two
                  capture surfaces, not a discrepancy; we don’t invent per-turn rows for turns that were never logged.
                </>
              ) : (
                <>
                  {' '}The multi-agent Timeline may show additional turns — e.g.{' '}
                  <span className="font-mono">claude-code</span> CLI adapter turns — measured via the token-usage source
                  but <span className="font-medium text-foreground">not logged by the context-turns write hook</span>, so
                  they don’t appear as rows here. Two capture surfaces, not a discrepancy; we don’t invent per-turn rows
                  for turns that were never logged.
                </>
              )}
            </p>
          )}

          {/* Per-turn honest split (Plan 84-08) — real wire values, one row per
              measured request. cache-write branches on the turn's wire: an
              Anthropic-wire turn shows the real number; an OpenAI-wire turn
              (copilot/opencode) shows the N/A string, NEVER 0 (D-12). */}
          {s.usingWire && s.turnCount > 0 && (
            <div className="mt-3 overflow-x-auto rounded-md border" data-testid="per-turn-wire-table">
              <p className="border-b bg-muted/20 px-2 py-1 text-left text-[11px] text-muted-foreground">
                Each turn: <span className="font-medium text-foreground">what it was doing</span> (the correlated ETM
                observation’s intent, or the fresh user-input preview when no observation correlated) + the real transmitted
                token split.
              </p>
              <table className="w-full text-right text-xs">
                <thead>
                  <tr className="border-b bg-muted/40 text-muted-foreground">
                    <th className="px-2 py-1 text-left font-medium">Turn</th>
                    <th className="px-2 py-1 text-left font-medium">Wire</th>
                    <th className="px-2 py-1 font-medium" style={{ color: C_READ }}>cache read</th>
                    <th className="px-2 py-1 font-medium" style={{ color: C_WRITE }}>cache write</th>
                    <th className="px-2 py-1 font-medium" style={{ color: C_INPUT }}>fresh input</th>
                    <th className="px-2 py-1 font-medium" style={{ color: C_OUTPUT }}>output</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {s.data.map((d) => (
                    <Fragment key={d.turn}>
                      <tr className="border-b border-dashed last:border-0">
                        <td className="px-2 pt-1 text-left align-top">{d.turn}</td>
                        <td className="px-2 pt-1 text-left align-top font-sans">
                          <Badge variant="outline" className="text-[10px]">{d.wire ?? 'unknown'}</Badge>
                        </td>
                        <td className="px-2 pt-1 align-top" style={{ color: C_READ }}>{fmt(d.read)}</td>
                        <td className="px-2 pt-1 align-top" style={{ color: C_WRITE }}>
                          {d.writeNA
                            ? <span className="font-sans text-[10px] text-muted-foreground" title={CACHE_WRITE_NA}>{CACHE_WRITE_NA}</span>
                            : fmt(d.write)}
                        </td>
                        <td className="px-2 pt-1 align-top" style={{ color: C_INPUT }}>{fmt(d.input)}</td>
                        <td className="px-2 pt-1 align-top" style={{ color: C_OUTPUT }}>{fmt(d.output)}</td>
                      </tr>
                      {/* What this turn is actually doing (D-07) — full-width narrative row. */}
                      <tr className="border-b last:border-0">
                        <td />
                        <td colSpan={5} className="px-2 pb-1.5 text-left font-sans">
                          {d.note ? (
                            <span className="text-[11px] leading-snug text-muted-foreground">
                              <Badge variant="outline" className="mr-1.5 align-middle text-[9px]">
                                {d.noteSource === 'observation' ? 'observation' : 'user input'}
                              </Badge>
                              <span className="text-foreground/80">{d.note}</span>
                            </span>
                          ) : (
                            <span className="text-[11px] italic text-muted-foreground">no observation correlated and no preview captured for this turn</span>
                          )}
                        </td>
                      </tr>
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 5. How prompt caching ACTUALLY works — the Anthropic-wire vs OpenAI-wire
            asymmetry that makes cache-write N/A honest, not a bug (D-12). */}
        <div className="rounded-md border bg-muted/30 p-4" data-testid="caching-explainer-copy">
          <p className="text-sm font-semibold">How prompt caching actually works — every wire, in one place</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Prompt caching is a <span className="font-medium text-foreground">provider-side</span> optimisation: the model host
            hashes the stable prefix of your prompt and, on a later request with the same prefix, reuses the already-computed
            attention state instead of re-running the model over those tokens. The bytes still cross the wire every turn — caching
            cuts <em>re-computation &amp; cost</em>, not transmission. What differs is <span className="font-medium text-foreground">who
            decides the prefix</span> and <span className="font-medium text-foreground">what the provider reports back</span>, and
            that is entirely a function of the wire the request takes:
          </p>
          <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">
            <li>
              <span className="font-medium" style={{ color: C_READ }}>Anthropic wire — explicit caching</span> (claude /
              claude-code / anthropic, via <span className="font-mono">/v1/messages</span>). The client marks the reusable prefix
              with a <span className="font-mono">cache_control</span> breakpoint; the response exposes BOTH a{' '}
              <span className="font-mono">cache_read</span> and a dedicated <span className="font-mono">cache-creation</span> (write)
              counter. The first request that warms a prefix is billed as <span style={{ color: C_WRITE }}>cache write</span>{' '}
              (~1.25×); every subsequent hit is <span style={{ color: C_READ }}>cache read</span> (~0.1×). The proxy now injects
              those breakpoints on its Anthropic-native paths (system + last message), so these runs actively write and re-read the
              cache — here we show the <span className="font-medium text-foreground">real</span> read and write numbers.
            </li>
            <li>
              <span className="font-medium" style={{ color: C_INPUT }}>OpenAI wire — implicit caching</span> (copilot / opencode,
              via the Copilot gateway’s OpenAI-compatible endpoint). There is <span className="font-medium text-foreground">no{' '}
              <span className="font-mono">cache_control</span></span> on this wire — the gateway auto-detects a repeated prefix and
              returns <span className="font-mono">cached_tokens</span> (which we surface as{' '}
              <span style={{ color: C_READ }}>cache read</span>) entirely on its own. But the OpenAI usage schema has{' '}
              <span className="font-medium text-foreground">no cache-creation field at all</span>, so cache-write renders as{' '}
              <span className="font-medium text-foreground">{CACHE_WRITE_NA}</span> rather than <span className="font-mono">0</span>:
              a zero would falsely imply the run tried to cache and wrote nothing, when in truth the provider simply never reports
              that figure. This is why a copilot/opencode run shows a green cache-read floor with no writes — that green is the
              gateway’s implicit prefix reuse, not a write you can see or control.
            </li>
            <li>
              <span className="font-medium text-foreground">No proxy seam — no measurement</span> (e.g. a raw copilot run that
              never traversed the metering proxy, or a run predating the capture tap). We record neither read nor write and fall
              back to the illustrative band above. Re-run the comparison through the proxy to capture real numbers.
            </li>
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">The one-line rule:</span> green (<span style={{ color: C_READ }}>cache
            read</span>) can appear on <em>both</em> wires; amber (<span style={{ color: C_WRITE }}>cache write</span>) is only
            ever a real number on the Anthropic wire, and is honestly <span className="font-medium text-foreground">N/A</span> —
            not zero — on the OpenAI wire. Honest measurement over inference (D-12).
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Still fuzzy on <em>wire</em>, <em>breakpoint</em>, or why Claude, opencode and Copilot differ? See the full
            illustrated walkthrough:{' '}
            <a
              href="https://fwornle.github.io/coding/measurement/prompt-caching/"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-foreground underline underline-offset-2"
            >
              Prompt Caching, End to End →
            </a>
          </p>
        </div>

        <KbDetailDialog open={kbOpen} onClose={() => setKbOpen(false)} real={activeReal} agent={agent} kbItems={kbItems} />
        <CategoryDetailModal
          segKey={catOpen}
          onClose={() => setCatOpen(null)}
          detail={catOpen ? (detailByKey[catOpen] ?? null) : null}
          bytes={catOpen ? (realByKey[catOpen] ?? null) : null}
        />
      </DialogContent>
    </Dialog>
  )
}
