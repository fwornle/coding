import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { useAppSelector, useAppDispatch } from '@/store'
import {
  fetchTimeline,
  selectSelectedTaskId,
  selectTimelineFor,
  selectTimelineLoading,
  type TimelineRow,
} from '@/store/slices/performanceSlice'

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

function isEstimated(row: TimelineRow): boolean {
  return row.estimated === true || row.tokens_estimated === 1
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
          <span className="text-sm text-muted-foreground">estimated</span>
        )}
      </div>
      <span className="font-mono text-sm">{tokens(row.total_tokens)}</span>
    </div>
  )
}

function TurnLabel({ index, model }: { index: number; model?: string | null }) {
  // Identifies each turn so a row is never just an empty badge + a far-right number.
  return (
    <>
      <span className="text-sm font-medium">Turn {index + 1}</span>
      {model && <span className="text-sm text-muted-foreground">{model}</span>}
    </>
  )
}

function ParentRow({ row, index }: { row: TimelineRow; index: number }) {
  const [open, setOpen] = useState(false) // collapsed by default (D-06)
  const children = row.children ?? []
  const isAggregate = String(row.granularity_tier) === 'per-session-aggregate'
  const hasChildren = children.length > 0 && !isAggregate

  // per-session-aggregate (copilot) or any tier-less single turn: one band, no expand.
  if (!hasChildren) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
        <div className="flex items-center gap-2">
          {/* spacer to align with expandable rows' chevron column */}
          <span className="inline-block w-4" />
          <TurnLabel index={index} model={row.model} />
          <TierBadge tier={String(row.granularity_tier)} />
          {isEstimated(row) && (
            <span className="text-sm text-muted-foreground">estimated</span>
          )}
        </div>
        <span className="font-mono text-sm">{tokens(row.total_tokens)}</span>
      </div>
    )
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-md border">
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <CollapsibleTrigger className="flex flex-1 items-center gap-2 text-left" data-testid="timeline-turn">
          <ChevronRight className={`h-4 w-4 transition-transform ${open ? 'rotate-90' : ''}`} />
          <TurnLabel index={index} model={row.model} />
          {/* tier badge sits OUTSIDE CollapsibleContent — always visible */}
          <TierBadge tier={String(row.granularity_tier)} />
          {isEstimated(row) && (
            <span className="text-sm text-muted-foreground">estimated</span>
          )}
        </CollapsibleTrigger>
        <span className="font-mono text-sm">{tokens(row.total_tokens)}</span>
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
  const rows = useAppSelector(selectTimelineFor(taskId))
  const loading = useAppSelector(selectTimelineLoading)

  useEffect(() => {
    if (taskId) dispatch(fetchTimeline(taskId))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId])

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
      </CardHeader>
      <CardContent>
        {loading && rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Loading timeline…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No per-turn telemetry recorded for this run.
          </p>
        ) : (
          <div className="space-y-2">
            {rows.map((row, i) => (
              <ParentRow key={row.tool_call_id ?? i} row={row} index={i} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
