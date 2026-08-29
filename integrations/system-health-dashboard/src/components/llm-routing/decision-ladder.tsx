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
  /** 'routes' in Configuration mode, 'calls' in Recorded. Always rendered. */
  unit: 'routes' | 'calls'
  /** The rung a selected recorded call stopped at, if one is selected. */
  activeRung?: number | null
  selectedRung?: number | null
  onSelectRung?: (rung: number | null) => void
  /** An `offloadSkips` reason the mirror could not place — shown, never folded away. */
  unclassified?: { count: number } | null
}

const RUNG_H = 34
export const LADDER_HEADER = 30

export function ladderHeight(): number {
  return LADDER_HEADER + GATES.length * RUNG_H + 8
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1e3).toFixed(1)}K`
  return String(n)
}

export function DecisionLadder({
  x, y, width, rungs, unit, activeRung = null, selectedRung = null, onSelectRung, unclassified = null,
}: Props) {
  return (
    <g>
      <rect
        x={x} y={y} width={width} height={ladderHeight()} rx={8}
        className="fill-background stroke-border" strokeWidth={1}
      />
      <text x={x + 12} y={y + 19} className="fill-muted-foreground" fontSize={9.5}
        style={{ letterSpacing: '.09em', textTransform: 'uppercase' }}>
        Decision — does the offload move it?
      </text>

      {GATES.map((gate, i) => {
        const top = y + LADDER_HEADER + i * RUNG_H
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
              <rect x={x + 4} y={top - 2} width={width - 8} height={RUNG_H - 2} rx={5}
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
              {r.detail ?? gate.hint}
            </text>
            {/* Unit always printed — see the header note. */}
            <text x={x + width - 12} y={top + 12} fontSize={9.5} textAnchor="end"
              className="fill-muted-foreground" fontFamily="ui-monospace, monospace">
              {fmt(r.count)} {unit === 'routes' ? (r.count === 1 ? 'route' : 'routes') : (r.count === 1 ? 'call' : 'calls')}
            </text>
          </g>
        )
      })}

      {/* A reason string the mirror could not place gets its own visible row. A
          newer proxy growing a new reason must surface as an unexplained bucket,
          never be rounded into a neighbouring gate. */}
      {unclassified && unclassified.count > 0 && (
        <text x={x + 12} y={y + ladderHeight() - 2} fontSize={9}
          className="fill-amber-600 dark:fill-amber-400" fontFamily="ui-monospace, monospace">
          ⚠ {fmt(unclassified.count)} {unit} stopped for a reason this view does not know
        </text>
      )}
    </g>
  )
}
