// Detail Level — one control for the question four checkboxes used to ask.
//
// `hideRolledUp`, `collapseSubComponents` and `aggregatesOnly` are all answers
// to "how much detail?", and until now the rail exposed them as three unrelated
// switches with two opposite polarities (two HIDE-something, one SHOW-only-
// something) sitting next to a fourth, `hideDocNodes`, that looks identical and
// means something else entirely. Nobody could predict which combination
// produced which view, so in practice nobody moved them.
//
// Measured on the 2026-09-24 corpus, worst project (Coding), using the same
// seeding as scripts/assert-aggregated-node-budget.ts:
//
//   full      198 nodes   every row, nothing folded
//   overview   25 nodes   rolled-up hidden + sub-components collapsed
//   summary    10 nodes   roll-up parents + architecture backbone only
//
// Those are the ≤40 and ≤10 targets, reached by COMPOSING flags that already
// existed — not by a second roll-up pass. (A level-2 roll-up was measured at
// 90 -> 72 rows, moving Coding 25 -> ~22: a full LLM pass over the corpus for
// a 12% improvement, against ~132 rows that render unrooted for want of a
// structural edge. Placement is the better lever by roughly 40x.)
//
// WHY A SEGMENTED CONTROL AND NOT A SLIDER. The three positions are named,
// discrete and non-linear — "Summary" is not "more Overview". A slider track
// implies a continuum and needs its labels underneath, costing the vertical
// space this redesign exists to reclaim.

import { useViewerStore, deriveDetailLevel, type DetailLevel } from '@/store/viewer-store'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Logger } from '@/lib/logging'

const LEVELS: ReadonlyArray<{
  value: Exclude<DetailLevel, 'custom'>
  label: string
  sub: string
  hint: string
}> = [
  {
    value: 'full',
    label: 'Full',
    sub: 'detail',
    hint: 'Every row, nothing folded. The audit view — slow to read, complete.',
  },
  {
    value: 'overview',
    label: 'Overview',
    sub: '≤40',
    hint: 'Rolled-up rows hidden and sub-components collapsed. The default.',
  },
  {
    value: 'summary',
    label: 'Summary',
    sub: '≤10',
    hint: 'Roll-up parents plus the architecture backbone only.',
  },
]

export interface DetailLevelProps {
  /** Nodes currently rendered — from the same predicate the canvas uses. */
  visibleCount?: number
  /**
   * Rendered rows with no Project/System root above them. Surfaced because it
   * is the half of the node budget that fails silently: the gate checks
   * `worst.nodes > BUDGET || unrooted > 0`, and a run once reported "PASS,
   * Coding at 11" while 43 rows rendered under no project at all.
   */
  unanchoredCount?: number
}

export function DetailLevel({ visibleCount, unanchoredCount }: DetailLevelProps) {
  const hideRolledUp = useViewerStore((s) => s.hideRolledUp)
  const collapseSubComponents = useViewerStore((s) => s.collapseSubComponents)
  const aggregatesOnly = useViewerStore((s) => s.aggregatesOnly)
  const setDetailLevel = useViewerStore((s) => s.setDetailLevel)

  // Derived, never stored. A stored copy would go stale the moment someone
  // moved one of the three flags in Advanced, and the control would then claim
  // a level the canvas is not showing.
  const level = deriveDetailLevel({ hideRolledUp, collapseSubComponents, aggregatesOnly })

  return (
    <div className="space-y-1.5" data-testid="detail-level">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium">Detail level</span>
        {level === 'custom' && (
          <span
            className="text-[10px] text-muted-foreground italic"
            data-testid="detail-level-custom"
            title="The Advanced switches are set to a combination no preset produces. Pick a level to return to one."
          >
            custom
          </span>
        )}
      </div>

      <ToggleGroup
        type="single"
        value={level === 'custom' ? '' : level}
        onValueChange={(v) => {
          // Radix clears the value when the active item is clicked again.
          // Re-selecting the current level is a no-op, not a jump to nothing.
          if (!v) return
          setDetailLevel(v as Exclude<DetailLevel, 'custom'>)
          Logger.info(Logger.Categories.FILTERS, `DetailLevel: ${v}`)
        }}
        variant="outline"
        size="sm"
        className="w-full"
        data-testid="detail-level-toggle"
        aria-label="Graph detail level"
      >
        {LEVELS.map((l) => (
          <ToggleGroupItem
            key={l.value}
            value={l.value}
            aria-label={`${l.label} (${l.sub})`}
            title={l.hint}
            data-testid={`detail-level-${l.value}`}
            className="flex-1 flex-col gap-0 h-auto py-1"
          >
            <span className="text-[11px] leading-tight">{l.label}</span>
            <span className="text-[9px] leading-tight opacity-70">{l.sub}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {typeof visibleCount === 'number' && (
        <p className="text-[10px] text-muted-foreground" data-testid="detail-level-readout">
          {visibleCount.toLocaleString()} nodes
          {typeof unanchoredCount === 'number' && unanchoredCount > 0 && (
            <>
              {' · '}
              <span
                className="text-amber-600 dark:text-amber-500"
                title="Rendered rows with no Project/System above them. They carry no structural edge, so no filter can anchor them — they need placing in the data."
                data-testid="detail-level-unanchored"
              >
                {unanchoredCount.toLocaleString()} unanchored
              </span>
            </>
          )}
        </p>
      )}
    </div>
  )
}

export default DetailLevel
