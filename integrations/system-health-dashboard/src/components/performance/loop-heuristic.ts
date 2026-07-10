// loop-heuristic.ts — windowed fuzzy repeat detector (D-09).
//
// A turn earns an ADVISORY "possible loop" flag when its (fuzzy, log2-size-bucketed) signature
// repeats a signature seen within the prior LOOP_WINDOW turns. Deliberately DISTINCT from the
// backend strict `loopCount` route heuristic (strict-adjacent + exact inputs_digest + persisted).
// This one is NON-ADJACENT, FUZZY, UI-advisory, and NEVER persisted — do NOT merge the two.
//
// Shares the single `turnSignature` detector with run-align.ts (the phase key_link) so alignment
// and loop-flagging agree on what "the same turn" means. Dependency-free otherwise.

import { turnSignature, type TurnLike } from './run-align'

/**
 * Look-back window (in turns) for the repeat check. Exported as a tunable const (86-RESEARCH
 * Pitfall 3) so it can be calibrated against real rerun fixtures without an API change: a tool
 * used once at turn 2 and again at turn 40 (> LOOP_WINDOW apart) is NOT a loop.
 */
export const LOOP_WINDOW = 6

/**
 * Returns a boolean[] the same length as `turns`; `turns[i]` is true iff its signature
 * (a) is NOT a pure-reasoning `R|` signature (reasoning turns are never flagged), and
 * (b) equals a signature within the prior LOOP_WINDOW turns.
 */
export function loopFlags(turns: TurnLike[]): boolean[] {
  const sigs = turns.map(turnSignature)
  return sigs.map((sig, i) => {
    if (sig.startsWith('R|')) return false // never flag pure-reasoning turns as loops
    for (let j = Math.max(0, i - LOOP_WINDOW); j < i; j++) {
      if (sigs[j] === sig) return true
    }
    return false
  })
}
