/**
 * One sentence saying what the offload is doing right now.
 *
 * The ladder below it is a set of gates and counts, and reading it is deduction:
 * you find the rung with the traffic, read its detail line, remember which
 * network you are on, and conclude. This says the conclusion, so everything
 * under it reads as confirmation.
 *
 * ── Why the count is in the sentence ────────────────────────────────────────
 * "The offload is not firing here" is a configuration statement and provokes a
 * shrug. "…so 4.2K calls stayed on a paid account" is the same fact with its
 * consequence attached, and that is the version that gets acted on. Where no
 * traffic was recorded the clause is dropped rather than printed as zero — a
 * window with nothing in it is not evidence that the policy costs nothing.
 */

import { GATES, RUNG_OFFLOADED, pickTarget } from './offload-gates'
import type { OffloadPolicy } from './offload-gates'

export interface HeadlineInput {
  policy: OffloadPolicy | null
  network: string
  /** Calls per rung in the window, RUNG_OFFLOADED holding those that moved. */
  callsByRung: number[]
  windowHours: number
  /** True when the policy is an unsaved edit, which changes the tense. */
  preview: boolean
}

export interface Headline {
  text: string
  tone: 'ok' | 'warn' | 'off'
}

const fmt = (n: number): string => (
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K`
      : String(n)
)

/** "small", or "small and medium", or "small, medium and high". */
function bandList(bands: string[]): string {
  if (bands.length === 0) return 'no'
  if (bands.length === 1) return bands[0]
  return `${bands.slice(0, -1).join(', ')} and ${bands[bands.length - 1]}`
}

export function composeHeadline({
  policy, network, callsByRung, windowHours, preview,
}: HeadlineInput): Headline {
  const would = preview ? 'would be' : 'is'
  const stayed = preview ? 'would have stayed' : 'stayed'

  if (!policy?.enabled) {
    return {
      tone: 'off',
      text: `The semantic offload ${preview ? 'would be' : 'is'} switched off, so every call goes to the account its route names.`,
    }
  }

  const bands = bandList(policy.offloadBands)
  const target = pickTarget(policy, network)

  // The consequence clause. Which rung "stopped" the work depends on the story,
  // so each branch names its own rung rather than summing the failures — a total
  // across rungs would count a route blocked by band alongside one blocked by
  // scope and describe neither.
  const consequence = (rung: number): string => {
    const n = callsByRung[rung] ?? 0
    if (n <= 0) return ''
    return ` ${fmt(n)} call${n === 1 ? '' : 's'} in the last ${windowHours}h ${stayed} on a paid account as a result.`
  }

  if (!target) {
    const declaredHere = (policy.targets ?? [])
      .filter(t => !t.requireNetwork || t.requireNetwork === network)
    // "Nothing is declared for this network" and "the thing declared for this
    // network is switched off" are one gate in the proxy and two entirely
    // different fixes for the reader — one is a YAML edit, one is a checkbox.
    if (declaredHere.length > 0) {
      const names = declaredHere.map(t => t.provider).join(' and ')
      return {
        tone: 'warn',
        text: `Right now, ${bands}-band work ${would} offloaded to nothing — the only target for ${network} is ${names}, and it is switched off.${consequence(3)}`,
      }
    }
    return {
      tone: 'warn',
      text: `Right now, ${bands}-band work ${would} offloaded to nothing — no target is declared for ${network}.${consequence(3)}`,
    }
  }

  const scope = target.scope ?? ['fg', 'bg']
  if (scope.length === 1) {
    const only = scope[0] === 'fg' ? 'foreground' : 'background'
    const other = scope[0] === 'fg' ? 'background' : 'foreground'
    return {
      tone: 'warn',
      text: `On ${network}, ${bands}-band ${only} work ${would} offloaded to ${target.provider}; ${other} work stays on its declared account because that target is scoped ${scope[0]}-only.${consequence(4)}`,
    }
  }

  const moved = callsByRung[RUNG_OFFLOADED] ?? 0
  return {
    tone: 'ok',
    text: `On ${network}, ${bands}-band work ${would} offloaded to ${target.provider}.`
      + (moved > 0
        ? ` ${fmt(moved)} call${moved === 1 ? '' : 's'} in the last ${windowHours}h ${preview ? 'would have moved' : 'moved'} off a paid account.`
        : ''),
  }
}

export function OffloadHeadline(props: HeadlineInput) {
  const { text, tone } = composeHeadline(props)
  const cls = tone === 'warn'
    ? 'text-amber-600 dark:text-amber-500'
    : tone === 'off' ? 'text-muted-foreground' : 'text-foreground'
  return (
    <p className={`text-sm leading-snug ${cls}`}>
      {text}
      {props.preview && (
        <span className="ml-2 align-middle text-[10px] font-mono uppercase tracking-wider text-amber-600 dark:text-amber-500 border border-amber-500/40 rounded px-1 py-px">
          unsaved
        </span>
      )}
    </p>
  )
}

/** Exported for the ladder's rung labels, so both name the gates identically. */
export const GATE_LABELS = GATES.map(g => g.label)
