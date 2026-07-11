import { useEffect } from 'react'
import { AlertTriangle, Check, GitBranch } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip'
import { useAppSelector, useAppDispatch } from '@/store'
import {
  fetchMergeStatus,
  selectMergeStatusFor,
  type AvenueMergeStatus,
} from '@/store/slices/performanceSlice'

// AVN-08 per-avenue merge-status badge (D-04). On mount it dispatches the Plan-04
// `fetchMergeStatus(taskId)` thunk (git-computed HOST-SIDE, served VERBATIM) and
// reads `selectMergeStatusFor(taskId)` → `AvenueMergeStatus | null`. The badge maps
// that VERBATIM status to the UI-SPEC-pinned vocabulary (status-* token + lucide
// icon — never colour alone). Nothing is recomputed client-side (the primitive owns
// the git semantics — T-87-06-03). status === null OR state === 'unknown' → NO badge
// (honesty): we never fabricate a merge state for a branch that was never created or
// was pruned. The tooltip carries the verbatim git detail read from the same object.

// Map the four pinned states to a token class + lucide icon + label. Returns null for
// `unknown` (absent branch) so no badge renders — mirrors reconciliation-badge.
type MergeBadgeState = {
  tokenClass: string
  Icon: typeof Check
  label: string
} | null

function classifyMergeStatus(status: AvenueMergeStatus): MergeBadgeState {
  switch (status.state) {
    case 'merged':
      return { tokenClass: 'border-status-success-line text-status-success', Icon: Check, label: 'merged' }
    case 'conflicts':
      return { tokenClass: 'border-status-warning-line text-status-warning', Icon: AlertTriangle, label: 'conflicts' }
    case 'unmerged':
      return { tokenClass: 'text-muted-foreground', Icon: GitBranch, label: 'unmerged' }
    case 'unknown':
    default:
      return null // honesty: never a fabricated merge state
  }
}

// The verbatim git-computed detail as the tooltip — read AS STORED, never recomputed.
// UI-SPEC: `branch: avenue/{task_id} · ahead {n} · behind {m} · {conflicts} conflicting files`.
function tooltipDetail(status: AvenueMergeStatus): string {
  return [
    `branch: ${status.branch}`,
    `ahead ${status.ahead}`,
    `behind ${status.behind}`,
    `${status.conflicts} conflicting files`,
  ].join(' · ')
}

export function MergeStatusBadge({ taskId }: { taskId: string }) {
  const dispatch = useAppDispatch()
  const status = useAppSelector(selectMergeStatusFor(taskId))

  useEffect(() => {
    if (taskId) dispatch(fetchMergeStatus(taskId))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId])

  // Honesty: no status OR unknown/pruned branch → NO badge (never a fabricated state).
  if (status === null) return null

  const state = classifyMergeStatus(status)
  if (state === null) return null

  const { tokenClass, Icon, label } = state

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className={`gap-1 ${tokenClass}`}
            data-testid="merge-status-badge"
          >
            <Icon className="size-3.5" />
            {label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>{tooltipDetail(status)}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
