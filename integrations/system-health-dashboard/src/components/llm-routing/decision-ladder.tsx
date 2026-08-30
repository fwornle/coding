/**
 * The offload decision, drawn as an ordered ladder.
 *
 * The flow diagram used to put a single box labelled `rapid-llm-proxy` between
 * the callers and the accounts — and every question worth asking happens inside
 * it. This is that box opened up: the gates in the order the proxy evaluates
 * them, each showing how much work it stopped.
 *
 * ── Why counts, and why they change unit between modes ──────────────────────
 * A gate labelled "band is eligible" is a rule. A gate labelled "band is
 * eligible — 449 calls stopped here" is a measurement, and it is the difference
 * between a diagram you read and a diagram you act on. So the rungs carry
 * numbers: routes in Configuration, calls in Recorded.
 *
 * Because the unit changes, it is ALWAYS printed. `15` in the same slot that
 * held `4.2K` a moment ago reads as the system changing rather than the question
 * changing, and that is a lie the diagram can tell silently.
 *
 * ── What is deliberately not here ───────────────────────────────────────────
 * The gates are POLICY: they do not vary per caller. Only where each caller
 * falls out varies. So this is one stack, not one per row — nine stacks would be
 * nine copies of the same rules and no more information.
 */

import { GATES, RUNG_OFFLOADED } from './offload-gates'
import { LADDER_HEADER } from './ladder-layout'
import type { LadderLayout } from './ladder-layout'

export interface LadderRung {
  /** How many routes (config) or calls (recorded) stopped at this gate. */
  count: number
  /** Config detail for the rung — the target list, the band set, the pinned routes. */
  detail?: string
}

interface Props {
  x: number
  y: number
  width: number
  rungs: LadderRung[]
  /**
   * Where each row sits. Computed by the caller, because the flow diagram has to
   * attach edges to the same rows this draws — see ladder-layout.ts.
   */
  layout: LadderLayout
  /** 'routes' in Configuration mode, 'calls' in Recorded. Always rendered. */
  unit: 'routes' | 'calls'
  /** The rung a selected recorded call stopped at, if one is selected. */
  activeRung?: number | null
  selectedRung?: number | null
  onSelectRung?: (rung: number | null) => void
  /** An `offloadSkips` reason the mirror could not place — shown, never folded away. */
  unclassified?: { count: number } | null
  /** Runs the operator has opened, and the toggle. Keyed by the run's first rung. */
  expandedRuns?: Set<number>
  onToggleRun?: (runId: number) => void
}

export { LADDER_HEADER, RUNG_H, layoutLadder } from './ladder-layout'
export type { LadderLayout, LadderRow } from './ladder-layout'

/**
 * SVG text does not wrap and does not clip, so an over-long detail line does not
 * overflow its box — it draws straight across whatever the next column is. The
 * ladder is rendered at two quite different widths (inside the flow diagram, and
 * wherever else it is embedded), so the budget is computed from the width it was
 * actually given rather than assumed.
 *
 * 0.60em per character is the measured average for this mono face at 9px; it
 * over-estimates slightly, which is the safe direction — a detail truncated one
 * character early is invisible, one character late is a line through the account
 * cards.
 */
function fitDetail(text: string, width: number): string {
  const budget = Math.floor((width - 28 - 78) / (9 * 0.6))
  return text.length <= budget ? text : `${text.slice(0, Math.max(budget - 1, 4))}…`
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1e3).toFixed(1)}K`
  return String(n)
}

export function DecisionLadder({
  x, y, width, rungs, layout, unit, activeRung = null, selectedRung = null, onSelectRung,
  unclassified = null, expandedRuns, onToggleRun,
}: Props) {
  const unitWord = (n: number) => (unit === 'routes'
    ? (n === 1 ? 'route' : 'routes')
    : (n === 1 ? 'call' : 'calls'))

  return (
    <g>
      <rect
        x={x} y={y} width={width} height={layout.height} rx={8}
        className="fill-background stroke-border" strokeWidth={1}
      />
      <text x={x + 12} y={y + 19} className="fill-muted-foreground" fontSize={9.5}
        style={{ letterSpacing: '.09em', textTransform: 'uppercase' }}>
        Decision — does the offload move it?
      </text>

      {layout.rows.map(row => {
        const top = y + row.top

        // ── A folded run ──
        // Deliberately still a row rather than nothing. "These gates exist and
        // nothing reached them" and "these gates do not exist" are different
        // facts, and the second one is not true — rungs 3-5 are the ones that
        // explain both of the offload incidents this card was built after.
        if (row.kind === 'collapsed') {
          return (
            <g key={`fold-${row.runId}`}
              onClick={() => onToggleRun?.(row.runId!)}
              style={{ cursor: onToggleRun ? 'pointer' : 'default' }}
              opacity={0.55}
            >
              <title>{row.rungs.map(r => `${r} ${GATES[r].label}`).join('\n')}</title>
              <rect x={x + 4} y={top} width={width - 8} height={row.height - 3} rx={4}
                className="fill-muted/40" />
              <text x={x + 12} y={top + 14} fontSize={9.5} className="fill-muted-foreground"
                fontFamily="ui-monospace, monospace">
                ⌄ {row.rungs.length} gates nothing reached
              </text>
              <text x={x + width - 12} y={top + 14} fontSize={9} textAnchor="end"
                className="fill-muted-foreground" fontFamily="ui-monospace, monospace">
                {row.rungs.join(', ')}
              </text>
            </g>
          )
        }

        // ── The header that closes an opened run ──
        // Costs 16 units, and only in the state the operator asked for.
        if (row.kind === 'expanded-header') {
          return (
            <g key={`unfold-${row.runId}`}
              onClick={() => onToggleRun?.(row.runId!)}
              style={{ cursor: onToggleRun ? 'pointer' : 'default' }}
            >
              <text x={x + 12} y={top + 11} fontSize={9} className="fill-muted-foreground"
                fontFamily="ui-monospace, monospace">
                ⌃ {row.rungs.length} gates nothing reached — hide
              </text>
            </g>
          )
        }

        const i = row.rungs[0]
        const gate = GATES[i]
        const r = rungs[i] ?? { count: 0 }
        const isPass = i === RUNG_OFFLOADED
        const isActive = activeRung === i
        const isSelected = selectedRung === i
        // A gate nothing reached is dimmed rather than removed. Its absence is a
        // fact worth seeing — "nothing was ever blocked here" and "this gate does
        // not exist" are different, and only one of them is true.
        const dim = r.count === 0 && !isActive

        return (
          <g
            key={gate.id}
            onClick={() => onSelectRung?.(isSelected ? null : i)}
            style={{ cursor: onSelectRung ? 'pointer' : 'default' }}
            opacity={dim ? 0.42 : 1}
          >
            {(isActive || isSelected) && (
              <rect x={x + 4} y={top - 2} width={width - 8} height={row.height - 2} rx={5}
                className={isActive ? 'fill-primary/10' : 'fill-muted'} />
            )}
            <text x={x + 12} y={top + 12} fontSize={9.5}
              className={isPass ? 'fill-emerald-600 dark:fill-emerald-400' : 'fill-muted-foreground'}
              fontFamily="ui-monospace, monospace">
              {isPass ? '→' : i}
            </text>
            <text x={x + 28} y={top + 12} fontSize={10.5}
              className={isPass ? 'fill-emerald-700 dark:fill-emerald-300' : 'fill-foreground'}
              fontWeight={isPass ? 600 : 400}>
              {gate.label}
            </text>
            <text x={x + 28} y={top + 24} fontSize={9} className="fill-muted-foreground"
              fontFamily="ui-monospace, monospace">
              {fitDetail(r.detail ?? gate.hint, width)}
              {/* Full text on hover — truncation must never be the only copy. */}
              <title>{r.detail ?? gate.hint}</title>
            </text>
            {/* Unit always printed — see the header note. */}
            <text x={x + width - 12} y={top + 12} fontSize={9.5} textAnchor="end"
              className="fill-muted-foreground" fontFamily="ui-monospace, monospace">
              {fmt(r.count)} {unitWord(r.count)}
            </text>
          </g>
        )
      })}

      {/* A reason string the mirror could not place gets its own visible row. A
          newer proxy growing a new reason must surface as an unexplained bucket,
          never be rounded into a neighbouring gate. */}
      {unclassified && unclassified.count > 0 && (
        <text x={x + 12} y={y + layout.height - 2} fontSize={9}
          className="fill-amber-600 dark:fill-amber-400" fontFamily="ui-monospace, monospace">
          ⚠ {fmt(unclassified.count)} {unit} stopped for a reason this view does not know
        </text>
      )}
    </g>
  )
}
