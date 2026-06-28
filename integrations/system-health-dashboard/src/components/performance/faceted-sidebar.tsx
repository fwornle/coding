import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { useAppSelector, useAppDispatch } from '@/store'
import {
  setFacet,
  clearFilters,
  selectFacetState,
  selectFacetCounts,
  selectFacetOptions,
  type FacetKey,
} from '@/store/slices/performanceSlice'

// D-01 faceted filter rail. 260px fixed (the page sets the grid column). Reads
// facetState + live counts via selectors and dispatches setFacet / clearFilters.
// Facet groups are the locked set (task_class, agent, model, framework) plus the
// permitted addition `score state` (UI-SPEC §Interaction Contracts item 1).
// task_id (high-cardinality identity) and the date-window facet are surfaced in
// the page header / table, not as a checkbox group here, to keep the rail
// readable — Claude's-discretion clause: a per-value checkbox list over every
// task_id would not fit the 260px rail without wrapping, which UI-SPEC's 260px
// width was explicitly chosen to avoid.

// label, key, and whether this group renders score-state's friendly labels.
const FACET_GROUPS: Array<{ key: FacetKey; label: string }> = [
  { key: 'task_class', label: 'Task class' },
  { key: 'scoreState', label: 'Score state' },
  { key: 'agent', label: 'Agent' },
  { key: 'model', label: 'Model' },
  { key: 'framework', label: 'Framework' },
]

const SCORE_STATE_LABELS: Record<string, string> = {
  scored: 'Scored',
  pending: 'Pending',
  not_scored: 'Not scored',
}

function FacetGroup({ groupKey, label }: { groupKey: FacetKey; label: string }) {
  const dispatch = useAppDispatch()
  const facetState = useAppSelector(selectFacetState)
  const counts = useAppSelector(selectFacetCounts)
  const options = useAppSelector(selectFacetOptions)
  const [open, setOpen] = useState(true) // expanded by default (UI-SPEC)

  const values = (options as Record<string, string[]>)[groupKey] ?? []
  const countMap = (counts as unknown as Record<string, Record<string, number>>)[groupKey] ?? {}
  const selected = facetState[groupKey] as string[]

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 py-1 text-sm font-semibold">
        <ChevronRight className={`h-4 w-4 transition-transform ${open ? 'rotate-90' : ''}`} />
        {label}
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-1 pb-2 pl-6">
        {values.length === 0 && (
          <p className="text-sm text-muted-foreground">No values</p>
        )}
        {values.map((value) => {
          const id = `facet-${groupKey}-${value}`
          const display = groupKey === 'scoreState' ? SCORE_STATE_LABELS[value] ?? value : value
          return (
            <label key={value} htmlFor={id} className="flex cursor-pointer items-center gap-2 py-1">
              <Checkbox
                id={id}
                checked={selected.includes(value)}
                onCheckedChange={() => dispatch(setFacet({ key: groupKey, value }))}
              />
              <span className="flex-1 truncate text-sm">{display}</span>
              <Badge variant="secondary" className="text-sm text-muted-foreground">
                {countMap[value] ?? 0}
              </Badge>
            </label>
          )
        })}
      </CollapsibleContent>
    </Collapsible>
  )
}

export function FacetedSidebar() {
  const dispatch = useAppDispatch()
  const facetState = useAppSelector(selectFacetState)

  const hasActiveFilters =
    facetState.task_id.length > 0 ||
    facetState.task_class.length > 0 ||
    facetState.agent.length > 0 ||
    facetState.model.length > 0 ||
    facetState.framework.length > 0 ||
    facetState.scoreState.length > 0 ||
    facetState.startedAfter != null ||
    facetState.startedBefore != null

  return (
    <Card className="h-fit">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base">Filters</CardTitle>
        <Button
          variant="outline"
          size="sm"
          disabled={!hasActiveFilters}
          onClick={() => dispatch(clearFilters())}
        >
          Clear filters
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[calc(100vh-16rem)]">
          <div className="space-y-1 px-4 pb-4">
            {FACET_GROUPS.map((g, i) => (
              <div key={g.key}>
                <FacetGroup groupKey={g.key} label={g.label} />
                {i < FACET_GROUPS.length - 1 && <Separator className="my-1" />}
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
