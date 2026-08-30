/**
 * Where each rung sits, once the gates nothing reached are folded away.
 *
 * ── Why this is not internal to the ladder ──────────────────────────────────
 * Collapsing changes every y below the fold, and the flow diagram lands each
 * caller's edge on the rung that decided it. If the ladder kept the collapse
 * state to itself, the edges would keep pointing at the rows the gates USED to
 * occupy — the diagram would still draw, just wrong, and nothing would say so.
 * So the layout is computed once by the caller that owns both, and handed to the
 * renderer.
 *
 * Pure, so the rules below are testable without a DOM.
 */

import { GATES, RUNG_OFFLOADED } from './offload-gates'
import type { LadderRung } from './decision-ladder'

export const RUNG_H = 34
export const LADDER_HEADER = 30
/** A folded run is one line, not one rung. */
export const COLLAPSED_H = 22

export interface LadderRow {
  /** Rungs this row stands for: one when `kind` is 'rung', two or more when folded. */
  rungs: number[]
  kind: 'rung' | 'collapsed' | 'expanded-header'
  /** Top of the row, relative to the ladder's own y. */
  top: number
  height: number
  /** The run this row belongs to, keyed by its first rung. Null for ordinary rungs. */
  runId: number | null
}

export interface LadderLayout {
  rows: LadderRow[]
  height: number
  /** Vertical centre of the row that REPRESENTS this rung — folded or not. */
  centerFor: (rung: number) => number
  /** True when this rung is inside a folded run, so it has no row of its own. */
  isFolded: (rung: number) => boolean
}

export interface LayoutOptions {
  /**
   * Rungs that must keep their own row whatever their count.
   *
   * The caller passes the rung a selected call stopped at, and the rung the
   * operator clicked. Folding either would hide the thing being pointed at: the
   * scrubber would highlight a row that is not on screen, which reads as the
   * highlight being broken rather than as the row being hidden.
   */
  pinned?: Iterable<number>
  /** Runs the operator has opened, keyed by first rung. */
  expanded?: Iterable<number>
}

/**
 * A gate may fold only if nothing reached it AND it is not the answer.
 *
 * `RUNG_OFFLOADED` is excluded unconditionally. It is not a gate — it is the
 * outcome, and on this diagram the outcome being zero is the single most
 * important thing on screen: "offloaded to the local target — 0 routes" IS the
 * finding whenever the offload is misconfigured. Folding the answer away because
 * the answer is "none" would hide precisely the state the whole card exists to
 * make visible.
 */
function foldable(rungs: LadderRung[], i: number, pinned: Set<number>): boolean {
  return i !== RUNG_OFFLOADED && !pinned.has(i) && (rungs[i]?.count ?? 0) === 0
}

export function layoutLadder(rungs: LadderRung[], opts: LayoutOptions = {}): LadderLayout {
  const pinned = new Set(opts.pinned ?? [])
  const expanded = new Set(opts.expanded ?? [])
  const rows: LadderRow[] = []
  let top = LADDER_HEADER

  const push = (row: Omit<LadderRow, 'top'>) => {
    rows.push({ ...row, top })
    top += row.height
  }

  for (let i = 0; i < GATES.length;) {
    if (!foldable(rungs, i, pinned)) {
      push({ rungs: [i], kind: 'rung', height: RUNG_H, runId: null })
      i++
      continue
    }

    // Maximal run of foldable gates starting here.
    let j = i
    while (j < GATES.length && foldable(rungs, j, pinned)) j++
    const run = Array.from({ length: j - i }, (_, k) => i + k)

    // A run of one saves nothing: "1 gate nothing reached" is the same height as
    // the gate, so folding it trades a real label for a placeholder. Dimming
    // already carries "nothing reached this" for the single case.
    if (run.length < 2) {
      push({ rungs: [i], kind: 'rung', height: RUNG_H, runId: null })
      i = j
      continue
    }

    if (expanded.has(i)) {
      push({ rungs: run, kind: 'expanded-header', height: 16, runId: i })
      for (const r of run) push({ rungs: [r], kind: 'rung', height: RUNG_H, runId: i })
    } else {
      push({ rungs: run, kind: 'collapsed', height: COLLAPSED_H, runId: i })
    }
    i = j
  }

  const rowOf = new Map<number, LadderRow>()
  for (const row of rows) {
    if (row.kind === 'expanded-header') continue
    for (const r of row.rungs) if (!rowOf.has(r)) rowOf.set(r, row)
  }

  const height = top + 8

  return {
    rows,
    height,
    centerFor: (rung: number) => {
      const row = rowOf.get(rung)
      // A rung with no row cannot happen — every gate is either its own row or
      // inside a folded one — but falling back to the ladder's middle keeps a
      // future gate from throwing an edge to y=NaN.
      if (!row) return height / 2
      return row.top + row.height / 2
    },
    isFolded: (rung: number) => rowOf.get(rung)?.kind === 'collapsed',
  }
}
