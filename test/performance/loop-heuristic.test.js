// Unit coverage for loop-heuristic.ts (D-09) — the windowed fuzzy repeat detector.
//   in-window flag   : loopingRun fixture flags the repeated later turns
//   out-of-window     : a repeat >LOOP_WINDOW apart is NOT flagged
//   R|-turn ignore    : a pure-reasoning repeat is NEVER flagged

import {
  loopFlags,
  LOOP_WINDOW,
} from '../../integrations/system-health-dashboard/src/components/performance/loop-heuristic.ts'
import { loopingRun, toolTurn, reasoningTurn } from './fixtures/context-turns-fixtures.js'

describe('LOOP_WINDOW', () => {
  test('is an exported tunable constant (default 6)', () => {
    expect(LOOP_WINDOW).toBe(6)
  })
})

describe('loopFlags — in-window repeat (D-09)', () => {
  test('loopingRun: flags the repeated later Read/Bash turns, not their first occurrence', () => {
    const flags = loopFlags(loopingRun)
    // loopingRun = Read, Bash, Read, Bash, Read, Bash  (all within a 6-turn window)
    expect(flags).toHaveLength(6)
    expect(flags[0]).toBe(false) // first Read
    expect(flags[1]).toBe(false) // first Bash
    expect(flags[2]).toBe(true) // Read repeats index 0
    expect(flags[3]).toBe(true) // Bash repeats index 1
    expect(flags[4]).toBe(true) // Read repeats index 0/2
    expect(flags[5]).toBe(true) // Bash repeats index 1/3
  })

  test('adjacent in-window repeat is flagged (turns 5,6,7 pattern)', () => {
    // Bash at 3 adjacent positions → the 2nd and 3rd are flagged.
    const turns = [toolTurn('Read', 256), toolTurn('Bash', 1024), toolTurn('Bash', 1024), toolTurn('Bash', 1024)]
    const flags = loopFlags(turns)
    expect(flags).toEqual([false, false, true, true])
  })
})

describe('loopFlags — out-of-window ignore (D-09)', () => {
  test('a tool at turn 0 and again at turn > LOOP_WINDOW apart is NOT flagged', () => {
    // Read at index 0, then LOOP_WINDOW filler Bash-variant turns (distinct signatures so
    // they do not self-match), then Read again beyond the window → NOT a loop.
    const turns = [toolTurn('Read', 256)]
    // 7 distinct-signature filler turns (Fill:bucket varies via size) → index 8 Read is 8 apart.
    const sizes = [64, 128, 512, 2048, 8192, 32768, 131072]
    for (const s of sizes) turns.push(toolTurn('Fill', s))
    turns.push(toolTurn('Read', 256)) // index 8, > LOOP_WINDOW(6) from index 0
    const flags = loopFlags(turns)
    expect(flags[8]).toBe(false)
    // sanity: the fillers are all distinct signatures → none flagged
    expect(flags.slice(1, 8).every((f) => f === false)).toBe(true)
  })
})

describe('loopFlags — pure-reasoning ignore (D-09)', () => {
  test('a repeated pure-reasoning (R|) turn is NEVER flagged', () => {
    // Two identical-size reasoning turns → same R| signature, but reasoning turns are never loops.
    const turns = [reasoningTurn(1024), reasoningTurn(1024), reasoningTurn(1024)]
    const flags = loopFlags(turns)
    expect(flags).toEqual([false, false, false])
  })
})
