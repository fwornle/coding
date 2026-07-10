// Unit coverage for run-align.ts (D-07) — the three §2 VALIDATION rows:
//   align-module    : alignRuns returns correct prefixLen/firstDivergence for a rerun-pair
//   align-identical : identical runs → firstDivergence === null, full prefix collapse
//   align-resync    : LCS re-syncs a re-converging tail (insert in B, then match)

import {
  sizeBucket,
  turnSignature,
  alignRuns,
} from '../../integrations/system-health-dashboard/src/components/performance/run-align.ts'
import {
  identicalPair,
  divergeReconverge,
  toolTurn,
} from './fixtures/context-turns-fixtures.js'

describe('sizeBucket', () => {
  test('bytes <= 0 → "z"', () => {
    expect(sizeBucket(0)).toBe('z')
    expect(sizeBucket(-5)).toBe('z')
  })

  test('log2 floor bucket: 256B and 300B collide; 256B and 4KB do not', () => {
    expect(sizeBucket(256)).toBe(sizeBucket(300)) // floor(log2(256))=8 === floor(log2(300))=8
    expect(sizeBucket(256)).not.toBe(sizeBucket(4096)) // 8 !== 12
    expect(sizeBucket(1024)).toBe('10')
  })
})

describe('turnSignature', () => {
  test('tool-bearing turn → T|name:bucket', () => {
    expect(turnSignature(toolTurn('Read', 256))).toBe('T|Read:8')
  })

  test('pure-reasoning turn → R|bucket over summed message bytes', () => {
    const t = {
      messages: [
        { i: 0, role: 'assistant', bytes: 1024, tool: null, preview: '' },
        { i: 1, role: 'assistant', bytes: 1024, tool: null, preview: '' },
      ],
    }
    // summed bytes 2048 → floor(log2(2048)) = 11
    expect(turnSignature(t)).toBe('R|11')
  })
})

describe('alignRuns — align-module (D-07)', () => {
  test('rerun-pair: prefixLen + firstDivergence at the first differing signature', () => {
    const { prefixLen, firstDivergence, pairs } = alignRuns(divergeReconverge.a, divergeReconverge.b)
    // shared prefix Read, Bash (indices 0,1); A[2]=Test:12 vs B[2]=Bash:9 differ at 2
    expect(prefixLen).toBe(2)
    expect(firstDivergence).toBe(2)
    expect(Array.isArray(pairs)).toBe(true)
  })
})

describe('alignRuns — align-identical (D-07)', () => {
  test('identical runs → firstDivergence null, full prefix, empty tail pairs', () => {
    const { prefixLen, firstDivergence, pairs } = alignRuns(identicalPair.a, identicalPair.b)
    expect(prefixLen).toBe(3)
    expect(firstDivergence).toBeNull()
    expect(pairs).toEqual([])
  })
})

describe('alignRuns — align-resync (D-07)', () => {
  test('re-converging tail: LCS pairs the re-converged Test turns; inserted B turn is one-sided', () => {
    const { prefixLen, firstDivergence, pairs } = alignRuns(divergeReconverge.a, divergeReconverge.b)
    expect(prefixLen).toBe(2)
    expect(firstDivergence).toBe(2)
    // Tail: A = [Test(idx2)], B = [Bash(idx2), Test(idx3)].
    // LCS must pair the re-converged Test turns (abs A idx 2 ↔ abs B idx 3) and mark
    // the inserted B Bash (abs idx 2) as one-sided { a: null, b: 2 }.
    const paired = pairs.find((p) => p.a === 2 && p.b === 3)
    expect(paired).toBeDefined()
    const insertedB = pairs.find((p) => p.a === null && p.b === 2)
    expect(insertedB).toBeDefined()
    // No pair should reference a non-existent index.
    for (const p of pairs) {
      if (p.a !== null) expect(p.a).toBeGreaterThanOrEqual(2)
      if (p.b !== null) expect(p.b).toBeGreaterThanOrEqual(2)
    }
  })
})
