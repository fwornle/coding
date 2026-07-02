import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { useAppSelector, useAppDispatch } from '@/store'
import {
  fetchTimeline,
  selectSelectedTaskId,
  selectSelectedRun,
  selectTimelineFor,
  selectTimelineLoading,
  type Run,
  type TimelineRow,
} from '@/store/slices/performanceSlice'
import { distinctModels, normalizeModel } from './models'

// Known background-service process families — a fallback for classifying a
// timeline row when the run's background_models set is empty (e.g. legacy runs).
// The AUTHORITATIVE source is the run's background_models[].process set, computed
// at measurement-stop; this regex only supplements it.
const KNOWN_SERVICE_RE = /^(health-coordinator|observation-writer|consolidator|token-adapter|wave-analysis|llm-proxy|kg-|persistence-)/

function serviceProcessSet(run: Run | null): Set<string> {
  return new Set((run?.background_models ?? []).map((b) => b.process).filter(Boolean))
}

// The FOREGROUND process of a run — the main chat. It is the run's own task
// process (and, as a secondary signal, the canonical agent). The foreground
// process must ALWAYS render as main-chat, even if the backend attribution leaked
// it into background_models (the myrepro case): a run cannot be a background
// service of itself.
function isForegroundProcess(proc: string | null | undefined, run: Run | null): boolean {
  if (!proc || !run) return false
  if (proc === run.task_id) return true
  if (run.canonical_agent && proc === run.canonical_agent) return true
  return false
}

// A timeline row is a background SERVICE turn (not part of the main chat) when its
// process was segregated into the run's background_models, or matches a known
// service family — UNLESS it is the run's own foreground process. Rows with no
// process, or the foreground chat, are main-chat turns.
function rowIsService(proc: string | null | undefined, serviceSet: Set<string>, run: Run | null): boolean {
  if (!proc || proc.trim() === '') return false
  if (isForegroundProcess(proc, run)) return false
  if (serviceSet.has(proc)) return true
  return KNOWN_SERVICE_RE.test(proc)
}

// D-06 collapsible timeline. When a run is selected (selectedTaskId in the
// slice) the component dispatches fetchTimeline(taskId) and reads the rows via
// selectTimelineFor. Each per-turn parent is collapsed by default with an
// always-visible granularity_tier badge (honesty signal — informational
// `variant="secondary"`, NEVER pass/fail color, rendered OUTSIDE the collapsible
// body so it stays visible in both states). Expanding reveals per-reasoning-step
// sub-bands. A copilot per-session-aggregate row renders a single band with no
// expand affordance. Numbers use font-mono; null → `—`, never 0.

function tokens(v: number | null | undefined): ReactNode {
  return v == null ? <span className="text-muted-foreground">—</span> : v.toLocaleString()
}

// HH:MM:SS in the viewer's local timezone — so a row reads "08:03:47" rather than
// being undated. Invalid/absent timestamps render nothing (caller guards).
function fmtTime(ts: string | null | undefined): string | null {
  if (!ts) return null
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

function isEstimated(row: TimelineRow): boolean {
  // IN-03: tokens_estimated is typed `number | null` — treat any positive count
  // as estimated, not only the exact value 1, so a future non-1 count still flags.
  return row.estimated === true || (row.tokens_estimated != null && row.tokens_estimated > 0)
}

function TierBadge({ tier }: { tier: string }) {
  // Tier is the honesty signal (D-06). Legacy rows carry an empty granularity_tier;
  // render "untagged" rather than a blank pill so the badge is never invisible.
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

function TurnLabel({ index, row, isService }: { index: number; row: TimelineRow; isService: boolean }) {
  // Identifies each turn so a row is never just an empty badge + a far-right number.
  // Renders, when available: the event time (HH:MM:SS), WHAT produced the row
  // (process — e.g. consolidator-insight / observation-writer / the foreground chat),
  // and the model. Background-service turns get a distinct muted-amber process pill;
  // main-chat turns get a filled primary pill, so the foreground chat stands out.
  const time = fmtTime(row.timestamp)
  const proc = typeof row.process === 'string' && row.process.trim() !== '' ? row.process : null
  const model = typeof row.model === 'string' && row.model.trim() !== '' ? normalizeModel(row.model) : null
  return (
    <>
      <span className="text-sm font-medium">Turn {index + 1}</span>
      {time && (
        <span className="font-mono text-sm text-muted-foreground" title={row.timestamp ?? undefined}>
          {time}
        </span>
      )}
      {proc && (
        <Badge
          variant={isService ? 'outline' : 'default'}
          className={
            isService
              ? 'text-sm border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400'
              : 'text-sm'
          }
          data-testid="timeline-process"
          title={isService ? 'Background service call (not part of the main chat)' : 'Main chat turn'}
        >
          {proc}
        </Badge>
      )}
      {model && <span className="text-sm text-muted-foreground">{model}</span>}
    </>
  )
}

function ParentRow({ row, index, isService }: { row: TimelineRow; index: number; isService: boolean }) {
  const [open, setOpen] = useState(false) // collapsed by default (D-06)
  const children = row.children ?? []
  const isAggregate = String(row.granularity_tier) === 'per-session-aggregate'
  const hasChildren = children.length > 0 && !isAggregate

  // A colored left-edge stripe segregates background-service rows (amber) from
  // main-chat turns (primary) at a glance, complementing the process pill color.
  const accent = isService
    ? 'border-l-2 border-l-amber-500/50'
    : 'border-l-2 border-l-primary'

  // per-session-aggregate (copilot) or any tier-less single turn: one band, no expand.
  if (!hasChildren) {
    return (
      <div
        className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 ${accent}`}
        data-testid="timeline-row"
        data-service={isService ? 'true' : 'false'}
      >
        <div className="flex items-center gap-2">
          {/* spacer to align with expandable rows' chevron column */}
          <span className="inline-block w-4" />
          <TurnLabel index={index} row={row} isService={isService} />
          <TierBadge tier={String(row.granularity_tier)} />
          {isEstimated(row) && (
            <span className="text-sm text-muted-foreground">estimated</span>
          )}
        </div>
        <span className="font-mono text-sm" title="Full turn tokens (input + output; thinking is folded into output).">
          {tokens(row.total_tokens)} <span className="text-muted-foreground">turn total</span>
        </span>
      </div>
    )
  }

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={`rounded-md border ${accent}`}
      data-testid="timeline-row"
      data-service={isService ? 'true' : 'false'}
    >
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <CollapsibleTrigger className="flex flex-1 items-center gap-2 text-left" data-testid="timeline-turn">
          <ChevronRight className={`h-4 w-4 transition-transform ${open ? 'rotate-90' : ''}`} />
          <TurnLabel index={index} row={row} isService={isService} />
          {/* tier badge sits OUTSIDE CollapsibleContent — always visible */}
          <TierBadge tier={String(row.granularity_tier)} />
          {isEstimated(row) && (
            <span className="text-sm text-muted-foreground">estimated</span>
          )}
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

export function PerformanceTimeline() {
  const dispatch = useAppDispatch()
  const taskId = useAppSelector(selectSelectedTaskId)
  const run = useAppSelector(selectSelectedRun)
  const rows = useAppSelector(selectTimelineFor(taskId))
  const loading = useAppSelector(selectTimelineLoading)
  const [hideServices, setHideServices] = useState(false)

  useEffect(() => {
    if (taskId) dispatch(fetchTimeline(taskId))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId])

  // The authoritative set of background-service processes for this run, plus the
  // filtered view. Rows are re-numbered AFTER filtering so the focused main-chat
  // view reads Turn 1..N over just the chat turns.
  const serviceSet = serviceProcessSet(run)
  const serviceCount = rows.filter((r) => rowIsService(r.process, serviceSet, run)).length
  const visibleRows = hideServices
    ? rows.filter((r) => !rowIsService(r.process, serviceSet, run))
    : rows

  if (!taskId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Select a run to view its per-turn timeline.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Timeline</CardTitle>
        {/* ATTR-02 Run-level summary: the canonical (foreground chat) model and the
            concurrent background-service models — READ from the persisted
            Run.metadata fields (no per-surface recompute, D-06), consistent with the
            runs-table row and the score drawer. Per-turn fg/bg distinction is kept
            below via row.process/row.model (finding-1). D-05 sentinels apply. */}
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
        {/* Focus control: hide concurrent background-service turns (health-coordinator,
            observation-writer, consolidator-*, token-adapter-* …) so only the main
            chat turns remain. Only shown when there is at least one service turn. */}
        {serviceCount > 0 && (
          <label className="mt-2 flex w-fit cursor-pointer items-center gap-2 text-sm text-muted-foreground" data-testid="timeline-hide-services">
            <Checkbox checked={hideServices} onCheckedChange={(v) => setHideServices(v)} />
            Hide service calls
            <span className="text-muted-foreground">({serviceCount})</span>
          </label>
        )}
      </CardHeader>
      <CardContent>
        {loading && rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Loading timeline…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No per-turn telemetry recorded for this run.
          </p>
        ) : visibleRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            All {rows.length} turns are background-service calls. Untick “Hide service calls” to see them.
          </p>
        ) : (
          <>
            {/* Color legend for the fg/bg segregation. */}
            <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-1 rounded-sm bg-primary" /> Main chat
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-3 w-1 rounded-sm bg-amber-500/60" /> Service call
              </span>
            </div>
            <div className="space-y-2">
              {visibleRows.map((row, i) => (
                <ParentRow
                  key={row.tool_call_id ?? i}
                  row={row}
                  index={i}
                  isService={rowIsService(row.process, serviceSet, run)}
                />
              ))}
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Per-turn rows show the full turn’s tokens. Reasoning steps are estimated (Claude folds thinking
              into output tokens) and are a subset already counted in the turn — they are not expected to sum
              to the turn total.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
