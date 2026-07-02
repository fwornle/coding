import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
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
  fetchRunNarrative,
  selectSelectedTaskId,
  selectSelectedRun,
  selectTimelineFor,
  selectTimelineLoading,
  selectNarrativeFor,
  selectNarrativeLoadingId,
  type Run,
  type TimelineRow,
  type NarrativeItem,
} from '@/store/slices/performanceSlice'
import { distinctModels, normalizeModel } from './models'
import {
  ROLE_META, ROLE_ORDER, processMeta, roleForProcess, summarizeByRole,
  type Role, type RoleStat,
} from './roles'

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

function ParentRow({ row, index, run }: { row: TimelineRow; index: number; run: Run | null }) {
  const [open, setOpen] = useState(false)
  const children = row.children ?? []
  const isAggregate = String(row.granularity_tier) === 'per-session-aggregate'
  const hasChildren = children.length > 0 && !isAggregate
  const role = roleForProcess(row.process, run)
  const accent = `border-l-2 ${ROLE_META[role].stripe}`

  if (!hasChildren) {
    return (
      <div
        className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 ${accent}`}
        data-testid="timeline-row"
        data-role={role}
      >
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
    )
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={`rounded-md border ${accent}`} data-testid="timeline-row" data-role={role}>
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
      <CollapsibleContent className="space-y-1 px-3 pb-2">
        {children.map((child, i) => (
          <SubBand key={child.tool_call_id ?? i} row={child} />
        ))}
      </CollapsibleContent>
    </Collapsible>
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
  from = pad(from, -60_000)
  to = pad(to, 5 * 60_000)
  return { from, to }
}

function intentLine(content: string): string {
  const trimmed = content.replace(/^Intent:\s*/i, '').trim()
  const firstSentence = trimmed.split(/(?<=[.!?])\s|\n/)[0] ?? trimmed
  return firstSentence.length > 200 ? `${firstSentence.slice(0, 200)}…` : firstSentence
}

// The plain-language development story: the "Intent: …" observations written
// during the run's window, in order. Answers "what did the foreground actually
// do" without brittle per-turn matching. Collapsed by default.
function DevelopmentNarrative({ taskId, items, loading }: { taskId: string; items: NarrativeItem[]; loading: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mb-3 rounded-md border" data-testid="timeline-narrative">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium">
        <ChevronRight className={`h-4 w-4 transition-transform ${open ? 'rotate-90' : ''}`} />
        Development narrative
        <span className="font-normal text-muted-foreground">
          {loading ? 'loading…' : `${items.length} intent${items.length === 1 ? '' : 's'} in this run’s window`}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-1 px-3 pb-3">
        {!loading && items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No observations were recorded in this run’s time window (expected for smoke/replay runs — the narrative
            is populated by the knowledge pipeline during real coding sessions).
          </p>
        ) : (
          <ol className="space-y-1.5" data-testid="narrative-list" data-count={items.length}>
            {items.map((it) => (
              <li key={it.id} className="flex gap-2 border-l-2 border-l-primary/40 pl-3 text-sm">
                <span className="font-mono text-xs text-muted-foreground" title={it.timestamp ?? undefined}>
                  {fmtTime(it.timestamp) ?? '—'}
                </span>
                <span>
                  {intentLine(it.content)}
                  {Array.isArray(it.artifacts) && it.artifacts.length > 0 && (
                    <span className="ml-1 text-xs text-muted-foreground">· {it.artifacts.length} file(s)</span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        )}
        <p className="pt-1 text-xs text-muted-foreground">
          Joined from observations by time window + agent ({taskId}), best-effort — observations carry no run id.
        </p>
      </CollapsibleContent>
    </Collapsible>
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
  const [hiddenRoles, setHiddenRoles] = useState<Set<Role>>(new Set())

  useEffect(() => {
    if (taskId) dispatch(fetchTimeline(taskId))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId])

  // Once the timeline is loaded, derive the run window and fetch the narrative.
  const win = runWindow(rows, run)
  const winKey = win ? `${win.from}|${win.to}` : ''
  useEffect(() => {
    if (taskId && win) {
      dispatch(fetchRunNarrative({ taskId, from: win.from, to: win.to, agent: run?.agent ?? run?.canonical_agent ?? undefined }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, winKey])

  const stats = summarizeByRole(rows, run)
  const statByRole = Object.fromEntries(stats.map((s) => [s.role, s])) as Record<Role, RoleStat>
  const visibleRows = rows.filter((r) => !hiddenRoles.has(roleForProcess(r.process, run)))

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
        <CardTitle className="text-base">Timeline</CardTitle>
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

            <DevelopmentNarrative
              taskId={taskId}
              items={narrative}
              loading={narrativeLoadingId === taskId}
            />

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
            ) : (
              <div className="space-y-2">
                {visibleRows.map((row, i) => (
                  <ParentRow key={row.tool_call_id ?? i} row={row} index={i} run={run} />
                ))}
              </div>
            )}

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
