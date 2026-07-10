import type { ReactNode } from 'react'
import { Repeat } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip'
import { useAppDispatch } from '@/store'
import {
  openTurnModal,
  type ContextTurnRow,
} from '@/store/slices/performanceSlice'
import { ContextBand } from './context-band'

// ---------------------------------------------------------------------------
// TurnRow (Phase 86 — Timeline v2, D-01/D-03/D-04/D-09)
// ---------------------------------------------------------------------------
// The v2 compact turn row. Evolves the timeline.tsx ParentRow card scaffold
// (`rounded-md border`, `flex items-center justify-between gap-3 px-3 py-2`,
// `data-testid="timeline-row"`) into a single scannable line (UI-SPEC §1):
//
//   role/tier  ·  1-line prompt excerpt  ·  tool-name chips ("+N" overflow)  ·
//   font-mono token/cache summary  ·  <ContextBand variant="mini"/>  ·  advisory
//   loop badge (when loopFlags[i]).
//
// The WHOLE row is a cursor-pointer click target → dispatches
// openTurnModal({taskId,index}) (D-01, the drill-down modal is turn-modal.tsx).
//
// Honesty (D-03): the row shows tool NAMES only (never raw args — that's the
// modal's job, gated on capture_raw_bodies). Cache-write N/A honesty rides in
// the ContextBand itself (branches on usage.cache_write === null → CACHE_WRITE_NA,
// never a fabricated 0).
//
// DASH-02 regression anchor: the caller passes a `tierBadge` slot so the row
// preserves the existing <TierBadge data-testid="granularity-tier-badge">.

// Byte formatter for the compact summary — nulls render an em-dash (mirrors
// timeline.tsx tokens()).
function num(v: number | null | undefined): ReactNode {
  return v == null ? <span className="text-muted-foreground">—</span> : v.toLocaleString()
}

// The tool names invoked in this turn, in order, de-duped for the chip row.
function toolNames(turn: ContextTurnRow): string[] {
  const msgs = Array.isArray(turn.messages) ? turn.messages : []
  const names: string[] = []
  for (const m of msgs) {
    const name = m?.tool?.name
    if (typeof name === 'string' && name.trim()) names.push(name.trim())
  }
  return names
}

// The 1-line prompt excerpt (last user preview) — plain text, React-escaped.
function promptExcerpt(turn: ContextTurnRow): string {
  const msgs = Array.isArray(turn.messages) ? turn.messages : []
  let lastUser = ''
  for (const m of msgs) if (m?.role === 'user' && typeof m.preview === 'string') lastUser = m.preview
  return lastUser.trim()
}

const MAX_CHIPS = 4

export interface TurnRowProps {
  taskId: string
  index: number
  turn: ContextTurnRow
  // Advisory loop flag for THIS turn (loopFlags(contextTurns)[index]).
  loopFlag?: boolean
  // The preserved DASH-02 tier badge + role swatch, rendered by the caller so
  // this component never re-derives granularity_tier from the wire row.
  tierBadge?: ReactNode
}

/**
 * The v2 compact turn row (chips + mini band + advisory loop badge). Opens the
 * single-turn drill-down modal (turn-modal.tsx) on click via openTurnModal.
 */
export function TurnRow({ taskId, index, turn, loopFlag, tierBadge }: TurnRowProps) {
  const dispatch = useAppDispatch()
  const names = toolNames(turn)
  const shown = names.slice(0, MAX_CHIPS)
  const overflow = names.length - shown.length
  const excerpt = promptExcerpt(turn)
  const totalIn = turn.usage?.input ?? null
  const totalOut = turn.usage?.output ?? null
  const cacheRead = turn.usage?.cache_read ?? null

  const open = () => dispatch(openTurnModal({ taskId, index }))
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() }
  }

  return (
    <div
      className="cursor-pointer rounded-md border transition-colors hover:bg-muted/40"
      data-testid="timeline-row"
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={onKey}
    >
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        {/* Left: tier badge (DASH-02) + turn label + prompt excerpt + tool chips */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {tierBadge}
          <span className="shrink-0 text-sm font-medium">Turn {index + 1}</span>
          {excerpt && (
            <span className="min-w-0 flex-1 truncate text-sm text-foreground" title={excerpt}>
              {excerpt}
            </span>
          )}
          <div className="flex shrink-0 flex-wrap items-center gap-1" data-testid="turn-tool-chips">
            {shown.map((name, i) => (
              <Badge key={`${name}-${i}`} variant="secondary" className="text-xs">{name}</Badge>
            ))}
            {overflow > 0 && (
              <Badge variant="secondary" className="text-xs" title={names.slice(MAX_CHIPS).join(', ')}>
                +{overflow}
              </Badge>
            )}
          </div>
        </div>

        {/* Right: token/cache summary + mini band + advisory loop badge */}
        <div className="flex shrink-0 items-center gap-3">
          <span className="font-mono text-sm" title="Fresh input + output tokens for this turn (cache split shown separately).">
            {num(totalIn)}<span className="text-muted-foreground">in</span>{' '}
            {num(totalOut)}<span className="text-muted-foreground">out</span>
            {cacheRead != null && cacheRead > 0 && (
              <span className="ml-1 text-xs text-muted-foreground">· {cacheRead.toLocaleString()} cache r</span>
            )}
          </span>
          <div className="w-24">
            <ContextBand variant="mini" turn={turn} />
          </div>
          {loopFlag && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant="outline"
                    className="gap-1 border-status-warning-line text-status-warning"
                    data-testid="turn-loop-badge"
                  >
                    <Repeat className="h-3 w-3" aria-hidden />
                    possible loop
                  </Badge>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  possible loop — this turn repeats a recent tool signature; args are matched
                  fuzzily, so this is a hint, not a fact.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>
    </div>
  )
}
