import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronRight, Maximize2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip'
import { useAppSelector, useAppDispatch } from '@/store'
import {
  fetchTimeline,
  fetchContextTurns,
  fetchRunNarrative,
  fetchRunDigests,
  selectSelectedTaskId,
  selectSelectedRun,
  selectTimelineFor,
  selectAmbientFor,
  selectContextTurnsFor,
  selectTimelineLoading,
  selectNarrativeFor,
  selectNarrativeLoadingId,
  selectDigestsFor,
  selectDigestLoadingId,
  type Run,
  type TimelineRow,
  type AmbientRow,
  type ContextTurnRow,
  type NarrativeItem,
  type DigestItem,
} from '@/store/slices/performanceSlice'
import { distinctModels, normalizeModel } from './models'
import {
  ROLE_META, ROLE_ORDER, processMeta, roleForProcess, summarizeByRole,
  type Role, type RoleStat,
} from './roles'
import { loopFlags } from './loop-heuristic'
import { TurnRow } from './turn-row'
import { TurnModal } from './turn-modal'

// D-06 collapsible timeline, re-cast as a role-aware narrative. Each turn is
// classified into a role (foreground development / knowledge capture /
// infrastructure) with a plain-English process label + glossary so a reader can
// follow what the run did. A per-run story summary (turns + tokens + models per
// role) makes two runs comparable at a glance. Per-reasoning-step sub-bands and
// the granularity_tier honesty badge are preserved.

function tokens(v: number | null | undefined): ReactNode {
  return v == null ? <span className="text-muted-foreground">—</span> : v.toLocaleString()
}

// HH:MM:SS in the viewer's local timezone. Invalid/absent timestamps render nothing.
function fmtTime(ts: string | null | undefined): string | null {
  if (!ts) return null
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

function isEstimated(row: TimelineRow): boolean {
  return row.estimated === true || (row.tokens_estimated != null && row.tokens_estimated > 0)
}

function TierBadge({ tier }: { tier: string }) {
  const label = tier && tier.trim() !== '' ? tier : 'untagged'
  return (
    <Badge variant="secondary" className="text-sm text-muted-foreground" data-testid="granularity-tier-badge">
      {label}
    </Badge>
  )
}

function SubBand({ row }: { row: TimelineRow }) {
  return (
    <div className="flex items-center justify-between gap-3 border-l-2 border-muted py-1 pl-4 text-sm" data-testid="timeline-reasoning-step">
      <div className="flex items-center gap-2">
        <TierBadge tier={String(row.granularity_tier)} />
        {isEstimated(row) && (
          <span
            className="text-sm text-muted-foreground"
            title="Claude does not report reasoning tokens natively (thinking is folded into output tokens); this value is estimated from the thinking text."
          >
            estimated
          </span>
        )}
      </div>
      <span
        className="font-mono text-sm"
        title="Estimated reasoning tokens — a subset already counted in the turn's output, not additive."
      >
        {tokens(row.reasoning_tokens)} <span className="text-muted-foreground">reasoning</span>
      </span>
    </div>
  )
}

// The process pill, coloured by role and backed by a glossary tooltip so a reader
// can hover to learn what (e.g.) "token-adapter-claude" actually is.
function ProcessPill({ row, run }: { row: TimelineRow; run: Run | null }) {
  const meta = processMeta(row.process, run)
  const rm = ROLE_META[meta.role]
  const raw = typeof row.process === 'string' ? row.process.trim() : ''
  const showRaw = raw && raw !== meta.label
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex cursor-help items-center gap-1.5">
            <Badge variant="outline" className={`text-sm ${rm.badge}`} data-testid="timeline-process">
              {meta.label}
            </Badge>
            {showRaw && <span className="font-mono text-xs text-muted-foreground">{raw}</span>}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p className="font-medium">{rm.label}</p>
          <p className="mt-0.5 text-muted-foreground">{meta.blurb}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function TurnLabel({ index, row, run }: { index: number; row: TimelineRow; run: Run | null }) {
  const time = fmtTime(row.timestamp)
  const model = typeof row.model === 'string' && row.model.trim() !== '' ? normalizeModel(row.model) : null
  return (
    <>
      <span className="text-sm font-medium">Turn {index + 1}</span>
      {time && (
        <span className="font-mono text-sm text-muted-foreground" title={row.timestamp ?? undefined}>
          {time}
        </span>
      )}
      <ProcessPill row={row} run={run} />
      {model && <span className="text-sm text-muted-foreground">{model}</span>}
    </>
  )
}

// The plain-language "Intent: …" observation(s) the knowledge pipeline recorded for
// THIS turn — rendered directly under the turn so a generic "Turn 5 · token-adapter
// · 12k tok" gains a human sentence of what it actually did. `digestThemes` names the
// digest(s) those observations rolled up into, closing the turn → observation →
// digest chain the user follows the development along.
function TurnObservations({ items, digestThemes }: { items: NarrativeItem[]; digestThemes: string[] }) {
  return (
    <div className="mt-1 space-y-1 pl-8 pr-3 pb-2" data-testid="turn-observations">
      {items.map((it) => (
        <div key={it.id} className="flex gap-2 text-sm">
          <span className="select-none text-muted-foreground" aria-hidden>↳</span>
          <span className="text-foreground/90">
            {intentLine(it.content)}
            {Array.isArray(it.artifacts) && it.artifacts.length > 0 && (
              <span className="ml-1 text-xs text-muted-foreground">· {it.artifacts.length} file(s)</span>
            )}
          </span>
        </div>
      ))}
      {digestThemes.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 pl-5 pt-0.5" data-testid="turn-digest-themes">
          <span className="text-xs text-muted-foreground">rolled into digest:</span>
          {digestThemes.map((t) => (
            <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>
          ))}
        </div>
      )}
    </div>
  )
}

// A compact per-turn "what was done" line — the lead assistant text plus the
// sequence of tool actions, extracted from the agent's own session store. Turns
// the timeline from anonymous token counts into a readable narrative of the run.
function TurnActivity({ row }: { row: TimelineRow }) {
  const activity = typeof row.prompt_preview === 'string' ? row.prompt_preview.trim() : ''
  if (!activity) return null
  return (
    <div
      className="px-3 pb-2 pl-9 text-sm text-muted-foreground"
      data-testid="timeline-turn-activity"
      title={activity}
    >
      {activity}
    </div>
  )
}

function ParentRow({
  row, index, run, observations, digestThemes,
}: {
  row: TimelineRow; index: number; run: Run | null; observations: NarrativeItem[]; digestThemes: string[]
}) {
  const [open, setOpen] = useState(false)
  const children = row.children ?? []
  const isAggregate = String(row.granularity_tier) === 'per-session-aggregate'
  const hasChildren = children.length > 0 && !isAggregate
  const role = roleForProcess(row.process, run)
  const accent = `border-l-2 ${ROLE_META[role].stripe}`
  const obs = observations.length > 0
    ? <TurnObservations items={observations} digestThemes={digestThemes} />
    : null

  if (!hasChildren) {
    return (
      <div
        className={`rounded-md border ${accent}`}
        data-testid="timeline-row"
        data-role={role}
        data-has-observations={observations.length > 0 ? 'true' : 'false'}
      >
        <div className="flex items-center justify-between gap-3 px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="inline-block w-4" />
            <TurnLabel index={index} row={row} run={run} />
            <TierBadge tier={String(row.granularity_tier)} />
            {isEstimated(row) && <span className="text-sm text-muted-foreground">estimated</span>}
          </div>
          <span className="font-mono text-sm" title="Full turn tokens (input + output; thinking is folded into output).">
            {tokens(row.total_tokens)} <span className="text-muted-foreground">turn total</span>
          </span>
        </div>
        <TurnActivity row={row} />
        {obs}
      </div>
    )
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={`rounded-md border ${accent}`} data-testid="timeline-row" data-role={role} data-has-observations={observations.length > 0 ? 'true' : 'false'}>
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <CollapsibleTrigger className="flex flex-1 items-center gap-2 text-left" data-testid="timeline-turn">
          <ChevronRight className={`h-4 w-4 transition-transform ${open ? 'rotate-90' : ''}`} />
          <TurnLabel index={index} row={row} run={run} />
          <TierBadge tier={String(row.granularity_tier)} />
          {isEstimated(row) && <span className="text-sm text-muted-foreground">estimated</span>}
        </CollapsibleTrigger>
        <span className="font-mono text-sm" title="Full turn tokens (input + output; thinking is folded into output).">
          {tokens(row.total_tokens)} <span className="text-muted-foreground">turn total</span>
        </span>
      </div>
      <TurnActivity row={row} />
      {obs}
      <CollapsibleContent className="space-y-1 px-3 pb-2">
        {children.map((child, i) => (
          <SubBand key={child.tool_call_id ?? i} row={child} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}

// Assign each observation to the turn it describes. The observation-writer runs
// just AFTER a turn, so an observation belongs to the LATEST turn whose timestamp is
// at/before it (a small tolerance absorbs clock skew where the obs is stamped a hair
// early). Rows are already chronological. Observations before the first turn (or with
// no timestamp) stay `unmatched` and fall to the run-level narrative so nothing is
// lost. Keyed by the row OBJECT so role-filtering the rendered list never desyncs.
function assignObservationsToTurns(
  rows: TimelineRow[],
  items: NarrativeItem[],
): { byRow: Map<TimelineRow, NarrativeItem[]>; unmatched: NarrativeItem[] } {
  const byRow = new Map<TimelineRow, NarrativeItem[]>()
  const unmatched: NarrativeItem[] = []
  const TOL_MS = 60_000       // obs stamped a hair AFTER its turn (clock skew)
  const LEAD_MS = 5 * 60_000  // obs stamped at prompt-time, BEFORE the first turn
  const turnTs = rows.map((r) => (r.timestamp ? new Date(r.timestamp).getTime() : NaN))
  const firstValid = turnTs.findIndex((t) => !Number.isNaN(t))
  for (const it of items) {
    const t = it.timestamp ? new Date(it.timestamp).getTime() : NaN
    if (Number.isNaN(t)) { unmatched.push(it); continue }
    let best = -1
    for (let i = 0; i < turnTs.length; i++) {
      if (Number.isNaN(turnTs[i])) continue
      if (turnTs[i] <= t + TOL_MS) best = i
      else break // chronological — no later turn can qualify
    }
    // Prompt-time observations precede every turn: attach one that sits within
    // LEAD_MS before the first turn to that first turn (it kicked the run off).
    if (best === -1) {
      if (firstValid !== -1 && t >= turnTs[firstValid] - LEAD_MS) best = firstValid
      else { unmatched.push(it); continue }
    }
    const arr = byRow.get(rows[best]) ?? []
    arr.push(it)
    byRow.set(rows[best], arr)
  }
  return { byRow, unmatched }
}

// The digest(s) whose observationIds intersect this run's observations — the precise
// tie (not a time guess). Returns the linked digests plus a set of the observation
// ids they cover, so a turn can name the digest its observation rolled into.
function linkDigestsToRun(
  digests: DigestItem[],
  narrative: NarrativeItem[],
): { linked: DigestItem[]; themeByObsId: Map<string, string[]> } {
  const runObsIds = new Set(narrative.map((n) => n.id).filter(Boolean))
  const linked: DigestItem[] = []
  const themeByObsId = new Map<string, string[]>()
  for (const d of digests) {
    const hits = d.observationIds.filter((id) => runObsIds.has(id))
    if (hits.length === 0) continue
    linked.push(d)
    const theme = d.theme || d.summary.slice(0, 40) || 'digest'
    for (const id of hits) {
      const arr = themeByObsId.get(id) ?? []
      if (!arr.includes(theme)) arr.push(theme)
      themeByObsId.set(id, arr)
    }
  }
  return { linked, themeByObsId }
}

// OPTION 2 — Concurrent background activity that ran DURING this run's window but
// is NOT attributed to it (empty/foreign task_id). Honest, read-only surfacing of
// knowledge-capture + infrastructure token spend that the task_id-exact role stats
// (summarizeByRole) deliberately exclude. Never a claim of causation — just "this
// was happening at the same time".
function AmbientActivity({ rows }: { rows: AmbientRow[] }) {
  if (!rows.length) return null
  const total = rows.reduce((a, r) => a + (r.total_tokens ?? 0), 0)
  return (
    <details className="mb-3 rounded-md border border-dashed px-3 py-2" data-testid="timeline-ambient">
      <summary className="cursor-pointer text-sm text-muted-foreground">
        Concurrent background activity — {rows.length} process{rows.length === 1 ? '' : 'es'},{' '}
        <span className="font-mono">{total.toLocaleString()}</span> tok
        <span className="ml-1 text-xs">(in-window, not attributed to this run)</span>
      </summary>
      <table className="mt-2 w-full text-xs" data-testid="timeline-ambient-table">
        <thead className="text-muted-foreground">
          <tr className="text-left">
            <th className="py-1 pr-3 font-medium">process</th>
            <th className="py-1 pr-3 font-medium">role</th>
            <th className="py-1 pr-3 font-medium text-right">calls</th>
            <th className="py-1 pr-3 font-medium text-right">tokens</th>
            <th className="py-1 font-medium">models</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {rows.map((r) => {
            const rm = ROLE_META[r.role]
            return (
              <tr key={`${r.process}:${r.role}`} data-testid={`ambient-row-${r.process}`}>
                <td className="py-0.5 pr-3">{processMeta(r.process, null).label ?? r.process}</td>
                <td className="py-0.5 pr-3">
                  <span className={`mr-1 inline-block h-2.5 w-1 rounded-sm align-middle ${rm.swatch}`} />
                  {rm.label}
                </td>
                <td className="py-0.5 pr-3 text-right">{r.calls.toLocaleString()}</td>
                <td className="py-0.5 pr-3 text-right">{(r.total_tokens ?? 0).toLocaleString()}</td>
                <td className="max-w-[16rem] truncate py-0.5 text-muted-foreground" title={r.models.join(', ')}>
                  {r.models.length ? r.models.join(', ') : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </details>
  )
}

// The comparison-ready run story: one card per role with turns + tokens + models.
function StorySummary({ stats }: { stats: RoleStat[] }) {
  return (
    <div className="mb-3 grid gap-2 sm:grid-cols-3" data-testid="timeline-story-summary">
      {stats.map((s) => {
        const rm = ROLE_META[s.role]
        return (
          <div key={s.role} className={`rounded-md border border-l-2 ${rm.stripe} px-3 py-2`} data-testid={`story-role-${s.role}`}>
            <div className="flex items-center gap-1.5">
              <span className={`inline-block h-3 w-1 rounded-sm ${rm.swatch}`} />
              <span className="text-sm font-medium">{rm.label}</span>
            </div>
            <div className="mt-1 flex items-baseline gap-2 text-sm">
              <span className="font-mono">{s.turns}</span>
              <span className="text-muted-foreground">turns</span>
              <span className="font-mono">{s.totalTokens.toLocaleString()}</span>
              <span className="text-muted-foreground">tok</span>
            </div>
            {(s.cacheRead > 0 || s.cacheWrite > 0) && (
              <div className="mt-0.5 flex items-baseline gap-2 text-xs" title="Prompt-cache tokens (read = cache hit, write = cache creation) — separate from the in+out total above.">
                <span className="font-mono text-muted-foreground">{s.cacheRead.toLocaleString()}</span>
                <span className="text-muted-foreground">cache r</span>
                <span className="font-mono text-muted-foreground">{s.cacheWrite.toLocaleString()}</span>
                <span className="text-muted-foreground">cache w</span>
              </div>
            )}
            <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground" title={s.models.join(', ')}>
              {s.models.length ? s.models.join(', ') : '—'}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// The run's time window for the narrative join: prefer the timeline's own
// min/max turn timestamps (most precise), else the run's started/ended fields.
// The `to` bound is padded because observations are written just AFTER the turn
// they describe (the observation-writer runs post-turn).
function runWindow(rows: TimelineRow[], run: Run | null): { from: string; to: string } | null {
  const ts = rows.map((r) => r.timestamp).filter((t): t is string => !!t).sort()
  let from = ts[0] ?? run?.started_at ?? null
  let to = ts[ts.length - 1] ?? run?.ended_at ?? null
  if (!from || !to) return null
  const pad = (iso: string, ms: number) => {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return new Date(d.getTime() + ms).toISOString()
  }
  // Back-pad generously: an observation is stamped at USER-PROMPT time, which
  // precedes the turns it describes (the agent works after the prompt). So the
  // intent for turn 1 can sit a few minutes BEFORE the first captured turn.
  from = pad(from, -5 * 60_000)
  to = pad(to, 5 * 60_000)
  return { from, to }
}

function intentLine(content: string): string {
  const trimmed = content.replace(/^Intent:\s*/i, '').trim()
  const firstSentence = trimmed.split(/(?<=[.!?])\s|\n/)[0] ?? trimmed
  return firstSentence.length > 200 ? `${firstSentence.slice(0, 200)}…` : firstSentence
}

// The run-level story: the digest(s) this run's observations rolled up into (the
// consolidated summary), plus any "Intent: …" observations that did NOT tie to a
// specific turn. Per-turn intents now render inline against their turn, so this
// section is the higher-level view + the safety net for unmatched items. Collapsed
// by default.
function DevelopmentNarrative({
  taskId, digests, unmatched, matchedCount, obsLoading, digestLoading,
}: {
  taskId: string
  digests: DigestItem[]
  unmatched: NarrativeItem[]
  matchedCount: number
  obsLoading: boolean
  digestLoading: boolean
}) {
  const [open, setOpen] = useState(false)
  const loading = obsLoading || digestLoading
  const summary = loading
    ? 'loading…'
    : `${matchedCount} intent${matchedCount === 1 ? '' : 's'} linked to turns · ${digests.length} digest${digests.length === 1 ? '' : 's'}`
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mb-3 rounded-md border" data-testid="timeline-narrative">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium">
        <ChevronRight className={`h-4 w-4 transition-transform ${open ? 'rotate-90' : ''}`} />
        Development narrative
        <span className="font-normal text-muted-foreground">{summary}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 px-3 pb-3">
        {/* Digests: the consolidated summary this run's observations feed. */}
        <div data-testid="narrative-digests" data-count={digests.length}>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Digests</p>
          {digests.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No digest has consolidated this run’s observations yet (digests are written by the
              knowledge pipeline, usually a while after the work).
            </p>
          ) : (
            <ul className="space-y-1.5">
              {digests.map((d) => (
                <li key={d.id} className="border-l-2 border-l-primary/40 pl-3 text-sm">
                  <div className="flex items-center gap-2">
                    {d.theme && <Badge variant="secondary" className="text-xs">{d.theme}</Badge>}
                    <span className="font-mono text-xs text-muted-foreground">{d.date ?? fmtTime(d.createdAt) ?? ''}</span>
                  </div>
                  <p className="mt-0.5 text-foreground/90">{d.summary.length > 240 ? `${d.summary.slice(0, 240)}…` : d.summary}</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Unmatched intents — observations we could not tie to a specific turn. */}
        {unmatched.length > 0 && (
          <div data-testid="narrative-unmatched" data-count={unmatched.length}>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Other intents (not tied to a turn)
            </p>
            <ol className="space-y-1.5">
              {unmatched.map((it) => (
                <li key={it.id} className="flex gap-2 border-l-2 border-l-muted pl-3 text-sm">
                  <span className="font-mono text-xs text-muted-foreground" title={it.timestamp ?? undefined}>
                    {fmtTime(it.timestamp) ?? '—'}
                  </span>
                  <span>{intentLine(it.content)}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {!loading && matchedCount === 0 && digests.length === 0 && unmatched.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No observations were recorded in this run’s time window (expected for smoke/replay runs — the
            narrative is populated by the knowledge pipeline during real coding sessions).
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          Turn intents are joined from observations by time window + agent ({taskId}); digests are tied by
          shared observation ids — best-effort, since observations carry no run id.
        </p>
      </CollapsibleContent>
    </Collapsible>
  )
}

// The v2 turn: a compact TurnRow (chips + mini band + advisory loop badge, opens
// the drill-down modal) PLUS the preserved DASH-02 collapsible reasoning sub-bands.
// The TierBadge is passed to TurnRow as a slot (data-testid="granularity-tier-badge"
// survives); the children (per-reasoning-step sub-bands, data-testid=
// "timeline-reasoning-step") stay collapsible under the v2 row so DASH-02 does not
// regress. When the timeline row carries no children (or is a per-session-aggregate)
// only the v2 row shows.
function TurnRowWithChildren({
  timelineRow, contextTurn, taskId, index, loopFlag,
}: {
  timelineRow: TimelineRow
  contextTurn: ContextTurnRow | undefined
  taskId: string
  index: number
  loopFlag: boolean
}) {
  const [open, setOpen] = useState(false)
  const children = timelineRow.children ?? []
  const isAggregate = String(timelineRow.granularity_tier) === 'per-session-aggregate'
  const hasChildren = children.length > 0 && !isAggregate
  const tierBadge = <TierBadge tier={String(timelineRow.granularity_tier)} />

  // A run may have more timeline rows than captured context-turns (or vice
  // versa). When THIS row has no matching context-turn, fall back to the v1
  // ParentRow so nothing is dropped (defensive; the top-level gate already
  // requires ≥1 context-turn to enter the v2 branch).
  if (!contextTurn) {
    return (
      <ParentRow
        row={timelineRow}
        index={index}
        run={null}
        observations={[]}
        digestThemes={[]}
      />
    )
  }

  return (
    <div className="space-y-1">
      <TurnRow
        taskId={taskId}
        index={index}
        turn={contextTurn}
        loopFlag={loopFlag}
        tierBadge={tierBadge}
      />
      {hasChildren && (
        <Collapsible open={open} onOpenChange={setOpen} className="ml-4 rounded-md border" data-testid="timeline-turn-children">
          <CollapsibleTrigger
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-muted-foreground"
            data-testid="timeline-turn"
          >
            <ChevronRight className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`} />
            {children.length} reasoning step{children.length === 1 ? '' : 's'}
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-1 px-3 pb-2">
            {children.map((child, i) => (
              <SubBand key={child.tool_call_id ?? i} row={child} />
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}

export function PerformanceTimeline() {
  const dispatch = useAppDispatch()
  const taskId = useAppSelector(selectSelectedTaskId)
  const run = useAppSelector(selectSelectedRun)
  const rows = useAppSelector(selectTimelineFor(taskId))
  const loading = useAppSelector(selectTimelineLoading)
  const narrative = useAppSelector(selectNarrativeFor(taskId))
  const narrativeLoadingId = useAppSelector(selectNarrativeLoadingId)
  const digests = useAppSelector(selectDigestsFor(taskId))
  const digestLoadingId = useAppSelector(selectDigestLoadingId)
  const [hiddenRoles, setHiddenRoles] = useState<Set<Role>>(new Set())

  const contextTurns = useAppSelector(selectContextTurnsFor(taskId))
  // OPTION 2 — concurrent background (knowledge/infra) activity in the run window.
  const ambient = useAppSelector(selectAmbientFor(taskId))

  useEffect(() => {
    if (taskId) {
      dispatch(fetchTimeline(taskId))
      // Per-request context-turns power the v2 row (chips + band + loop badge +
      // drill-down modal). Graceful-empty: a run without captured context-turns
      // returns [] → the v1 fallback + "no per-turn context captured" note (D-06).
      dispatch(fetchContextTurns(taskId))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId])

  // Experiment-cell provenance (variant/base_variant ride the Run index signature).
  // A sandboxed experiment cell runs its agent in a THROWAWAY worktree — the ambient
  // observations in its time window belong to whatever interactive session was live
  // in the repo (85-06 live-gate: the orchestration session's "Approve the
  // checkpoint…" intents rendered against the cell's own turns). The knowledge
  // pipeline never observes the sandbox, so the honest narrative for a cell is its
  // goal_sentence — NEVER a time-window join against foreign sessions.
  const runUnknown = run as unknown as Record<string, unknown> | null
  const isExperimentCell = !!(
    runUnknown && (typeof runUnknown.variant === 'string' || typeof runUnknown.base_variant === 'string')
  )

  // Once the timeline is loaded, derive the run window and fetch the narrative
  // (SKIPPED for experiment cells — cross-session bleed, see above).
  const win = runWindow(rows, run)
  const winKey = win ? `${win.from}|${win.to}` : ''
  useEffect(() => {
    if (taskId && win && !isExperimentCell) {
      dispatch(fetchRunNarrative({ taskId, from: win.from, to: win.to, agent: run?.agent ?? run?.canonical_agent ?? undefined }))
      dispatch(fetchRunDigests({ taskId, from: win.from, to: win.to }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, winKey, isExperimentCell])

  const stats = summarizeByRole(rows, run)
  const statByRole = Object.fromEntries(stats.map((s) => [s.role, s])) as Record<Role, RoleStat>
  // Preserve each row's ORIGINAL position so the parallel `contextTurns` /
  // `turnLoopFlags` arrays stay aligned after a role filter hides some rows.
  // Indexing the unfiltered arrays by the filtered position desyncs every row's
  // band/chips/loop-badge and the drill-down modal (CR-01).
  const visibleRows = rows
    .map((row, originalIndex) => ({ row, originalIndex }))
    .filter(({ row }) => !hiddenRoles.has(roleForProcess(row.process, run)))

  // v2 gate (D-01/D-06): render the compact v2 TurnRow only when this run has
  // captured per-request context-turns. The advisory loop badge is computed ONCE
  // over the full context-turn sequence (fuzzy, non-persisted — distinct from the
  // backend strict loop_count). A run WITHOUT context-turns falls through to the
  // v1 ParentRow rendering + the "no per-turn context captured" note.
  const hasContextTurns = contextTurns.length > 0
  const turnLoopFlags = hasContextTurns ? loopFlags(contextTurns) : []
  // capture_raw_bodies rides the Run's overrides (span-level); full raw arg text
  // in the modal renders only when it was ON — else name+size+intent, never
  // fabricated. Read through the Run index signature (honest default: false).
  const captureRawBodies = !!(runUnknown && runUnknown.capture_raw_bodies === true)

  // Tie observations → turns and digests → this run, so each turn can show what it
  // did and which digest it fed. Computed over the FULL rows (role-filtering the
  // rendered list only hides, never remaps). For an experiment cell the narrative
  // is forced empty (defense-in-depth alongside the skipped fetch above) so a
  // stale slice entry can never re-introduce the cross-session bleed.
  const scopedNarrative = isExperimentCell ? [] : narrative
  const { byRow: obsByRow, unmatched } = assignObservationsToTurns(rows, scopedNarrative)
  const { linked: linkedDigests, themeByObsId } = linkDigestsToRun(digests, scopedNarrative)
  const matchedCount = scopedNarrative.length - unmatched.length
  const digestThemesForRow = (r: TimelineRow): string[] => {
    const themes = new Set<string>()
    for (const it of obsByRow.get(r) ?? []) for (const th of themeByObsId.get(it.id) ?? []) themes.add(th)
    return [...themes]
  }

  const toggleRole = (role: Role) => {
    setHiddenRoles((prev) => {
      const next = new Set(prev)
      if (next.has(role)) next.delete(role)
      else next.add(role)
      return next
    })
  }

  if (!taskId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Select a run to view its per-turn timeline.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">Timeline</CardTitle>
          {/* Fullscreen whole-run view (D-02) — routed child at
              /performance/timeline/:taskId. Icon button per the Copywriting
              contract (Maximize2 + aria-label + tooltip). */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  to={`/performance/timeline/${encodeURIComponent(taskId)}`}
                  aria-label="Open fullscreen timeline"
                  data-testid="timeline-fullscreen-link"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-muted"
                >
                  <Maximize2 className="h-4 w-4" />
                </Link>
              </TooltipTrigger>
              <TooltipContent>Fullscreen timeline</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        {/* The human-readable goal sentence (Run.description → goal_sentence),
            distinct from the goal_achieved score column. Hidden for legacy runs
            that recorded no goal. */}
        {run?.goal_sentence && (
          <p className="mt-0.5 text-sm" data-testid="timeline-goal">
            <span className="text-muted-foreground">Goal:</span> {run.goal_sentence}
          </p>
        )}
        {run?.session_summary && (
          <p className="mt-0.5 text-sm text-muted-foreground" data-testid="timeline-summary">
            <span className="text-muted-foreground">Summary:</span> {run.session_summary}
          </p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span data-testid="timeline-canonical-model">
            Chat model:{' '}
            {run?.canonical_model
              ? <span className="font-mono">{normalizeModel(run.canonical_model)}</span>
              : <span className="italic">unmeasured</span>}
          </span>
          <span data-testid="timeline-background-models">
            Background:{' '}
            {run?.background_models?.length
              ? <span className="font-mono">{distinctModels(run.background_models).join(', ')}</span>
              : <span>—</span>}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {loading && rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Loading timeline…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No per-turn telemetry recorded for this run.</p>
        ) : (
          <>
            <StorySummary stats={stats} />

            {isExperimentCell ? (
              /* 85-06: a sandboxed cell has no session observations of its own — show
                 the goal instead of a time-window join against foreign sessions. */
              <div className="mb-3 rounded-md border px-3 py-2 text-sm" data-testid="timeline-cell-goal">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Experiment cell
                </span>
                <p className="mt-0.5 text-muted-foreground">
                  {typeof runUnknown?.goal_sentence === 'string' && runUnknown.goal_sentence
                    ? String(runUnknown.goal_sentence)
                    : 'Sandboxed experiment run — ambient session observations are not attributed to cells.'}
                </p>
              </div>
            ) : (
              <DevelopmentNarrative
                taskId={taskId}
                digests={linkedDigests}
                unmatched={unmatched}
                matchedCount={matchedCount}
                obsLoading={narrativeLoadingId === taskId}
                digestLoading={digestLoadingId === taskId}
              />
            )}

            {/* Role filter chips — click to show/hide a whole role. Serves the
                "focus on just the development" need without losing the counts. */}
            <div className="mb-3 flex flex-wrap items-center gap-3" data-testid="timeline-role-filters">
              {ROLE_ORDER.map((role) => {
                const rm = ROLE_META[role]
                const active = !hiddenRoles.has(role)
                return (
                  <label
                    key={role}
                    className={`flex cursor-pointer items-center gap-1.5 text-sm ${active ? '' : 'opacity-40'}`}
                    data-testid={`role-filter-${role}`}
                  >
                    <Checkbox checked={active} onCheckedChange={() => toggleRole(role)} />
                    <span className={`inline-block h-3 w-1 rounded-sm ${rm.swatch}`} />
                    {rm.label}
                    <span className="text-muted-foreground">({statByRole[role]?.turns ?? 0})</span>
                  </label>
                )
              })}
            </div>

            {visibleRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                All roles are hidden. Re-enable a role above to see its turns.
              </p>
            ) : hasContextTurns ? (
              /* v2 (D-01): compact TurnRow per turn (chips + mini band + advisory
                 loop badge, opens the drill-down modal). The DASH-02 TierBadge is
                 passed as a slot; the collapsible reasoning sub-bands (children)
                 are preserved BELOW each v2 row so the tier badge + per-reasoning
                 -step sub-bands survive the evolution. */
              <div className="space-y-2">
                {visibleRows.map(({ row, originalIndex }) => (
                  <TurnRowWithChildren
                    key={row.tool_call_id ?? originalIndex}
                    timelineRow={row}
                    contextTurn={contextTurns[originalIndex]}
                    taskId={taskId}
                    index={originalIndex}
                    loopFlag={turnLoopFlags[originalIndex] ?? false}
                  />
                ))}
              </div>
            ) : (
              /* v1 fallback (D-06): no per-request context-turns for this run, so
                 render today's v1 ParentRow (turn label + tokens + observation
                 lines) with the v2 enrichments simply absent + the subtle note.
                 This is the DESIGNED degradation path — never an error. */
              <>
                <p className="mb-2 text-xs text-muted-foreground" data-testid="timeline-no-context-note">
                  no per-turn context captured
                </p>
                <div className="space-y-2">
                  {visibleRows.map(({ row, originalIndex }) => (
                    <ParentRow
                      key={row.tool_call_id ?? originalIndex}
                      row={row}
                      index={originalIndex}
                      run={run}
                      observations={obsByRow.get(row) ?? []}
                      digestThemes={digestThemesForRow(row)}
                    />
                  ))}
                </div>
              </>
            )}

            {/* Single-turn drill-down modal — mounted once, driven by the slice
                open-state (openTurnModal from the v2 rows / closeTurnModal). */}
            <TurnModal captureRawBodies={captureRawBodies} />

            <p className="mt-3 text-sm text-muted-foreground">
              Turns are chronological. Colours mark the role — foreground development, knowledge capture, or
              infrastructure; hover a process pill to see what it does. Reasoning steps are estimated (Claude folds
              thinking into output tokens) and are a subset already counted in the turn total.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
