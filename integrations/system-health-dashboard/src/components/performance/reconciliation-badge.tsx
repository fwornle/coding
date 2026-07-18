import { useEffect } from 'react'
import { AlertTriangle, FileText, Check } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip'
import { useAppSelector, useAppDispatch } from '@/store'
import {
  fetchReconciliation,
  selectReconciliationFor,
  type ReconciliationSummary,
} from '@/store/slices/performanceSlice'

// D-12 per-run reconciliation badge. On mount it dispatches the frozen Plan-02
// `fetchReconciliation(taskId)` thunk (graceful-empty, verbatim) and reads
// `selectReconciliationFor(taskId)` → `ReconciliationSummary | null`. The badge
// maps that VERBATIM summary to the UI-SPEC-pinned status vocabulary (status-*
// token + a lucide icon per state — never colour alone). The counts are read as
// stored; nothing is recomputed client-side (Phase-83 owns the semantics —
// T-86-05-02). reconciliation === null → NO badge (D-06 honesty): we never
// fabricate a "reconciled" status for a run that simply has no reconciliation
// file. The tooltip holds the detail summary read verbatim from the same object.

// Map the summary to one of the three pinned states, in priority order
// (UI-SPEC status-badge table): a flagged discrepancy dominates, then a
// transcript fallback, then a clean match. Returns null when nothing applies
// (e.g. an all-zero summary) so we never assert a green ✓ without evidence.
type ReconState = {
  tokenClass: string
  Icon: typeof AlertTriangle
  label: string
  // Plain-language meaning of THIS state, shown in the tooltip above the raw
  // counts so a reader doesn't have to know what "reconciliation" is.
  explain: string
} | null

function classifyReconciliation(r: ReconciliationSummary): ReconState {
  if (r.flaggedCount > 0) {
    return {
      tokenClass: 'border-status-warning-line text-status-warning', Icon: AlertTriangle, label: '⚠ Δ discrepancy',
      explain: 'The proxy wire tokens and the agent transcript disagree for some turns — treat this run’s token count with caution.',
    }
  }
  if (r.fallback > 0) {
    return {
      tokenClass: 'text-muted-foreground', Icon: FileText, label: 'transcript-fallback',
      explain: 'No proxy wire rows for this run, so tokens were counted from the agent’s own transcript instead of the wire.',
    }
  }
  if (r.matched > 0) {
    return {
      tokenClass: 'border-status-success-line text-status-success', Icon: Check, label: '✓ reconciled',
      explain: 'The proxy wire tokens were cross-checked against the agent transcript and agree — the token count is trustworthy.',
    }
  }
  return null
}

// Render the verbatim summary counts as the tooltip detail — never recomputed.
function tooltipDetail(r: ReconciliationSummary): string {
  return [
    `matched: ${r.matched}`,
    `flagged: ${r.flaggedCount}`,
    `fallback: ${r.fallback}`,
    `unmatched (wire): ${r.unmatched_wire}`,
    `unmatched (transcript): ${r.unmatched_transcript}`,
  ].join(' · ')
}

export function ReconciliationBadge({ taskId }: { taskId: string }) {
  const dispatch = useAppDispatch()
  const reconciliation = useAppSelector(selectReconciliationFor(taskId))

  useEffect(() => {
    if (taskId) dispatch(fetchReconciliation(taskId))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId])

  // D-06 honesty: no reconciliation data → NO badge (never a fabricated status).
  if (reconciliation === null) return null

  const state = classifyReconciliation(reconciliation)
  if (state === null) return null

  const { tokenClass, Icon, label, explain } = state

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className={`gap-1 ${tokenClass}`}
            data-testid="reconciliation-badge"
          >
            <Icon className="size-3.5" />
            {label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs space-y-1">
          <p className="font-medium">Token reconciliation</p>
          <p>{explain}</p>
          <p className="text-muted-foreground">{tooltipDetail(reconciliation)}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
