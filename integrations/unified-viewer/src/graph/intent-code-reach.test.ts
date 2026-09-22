// How far an intent reaches into the code.
//
// What these tests exist to prevent, in order:
//
//  - a lesson that reaches no Component being silently dropped, which is what
//    the stored `codeEvidence` does and why its counts do not sum to the row's;
//  - the component grouping drifting away from the map the canvas draws with,
//    which would put two contradicting numbers on one row;
//  - a bare basename being folded into a path when more than one path could
//    have been meant, which would invent a fact the data does not carry;
//  - directories and non-file claims (`mcp.tools`, `row.id`, `0/0`) being
//    ranked as if they were files.

import { describe, it, expect } from 'vitest'
import {
  filesTouched,
  fileFocusId,
  groupByComponent,
  isFileFocusId,
  verifiedAt,
  NOT_PLACED_ID,
  NOT_PLACED_NAME,
  type ReachInsight,
} from './intent-code-reach'

const insight = (id: string, name: string, files?: string[], at = '2026-09-19T11:35:05Z'): ReachInsight => ({
  id,
  name,
  metadata: files ? { codeVerification: { verifiedAt: at, referencedFiles: files } } : {},
})

// c1 ─ sc1 ─ i1, i2      c2 ─ i3      (i4 hangs off p1 — never placed)
const PARENTS = new Map<string, string>([
  ['c1', 'p1'],
  ['c2', 'p1'],
  ['sc1', 'c1'],
  ['i1', 'sc1'],
  ['i2', 'sc1'],
  ['i3', 'c2'],
  ['i4', 'p1'],
])
const CLASSES = new Map<string, string>([
  ['p1', 'Project'],
  ['c1', 'Component'],
  ['c2', 'Component'],
  ['sc1', 'SubComponent'],
])
const NAMES = new Map<string, string>([
  ['c1', 'SemanticAnalysis'],
  ['c2', 'LLMAbstraction'],
])

describe('groupByComponent', () => {
  it('walks past a SubComponent to the Component the canvas placed the lesson under', () => {
    const groups = groupByComponent(
      [insight('i1', 'A'), insight('i2', 'B')],
      PARENTS,
      CLASSES,
      NAMES,
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].id).toBe('c1')
    expect(groups[0].name).toBe('SemanticAnalysis')
    expect(groups[0].insights.map((i) => i.id)).toEqual(['i1', 'i2'])
  })

  it('a lesson that reaches no Component is bucketed, never dropped', () => {
    const groups = groupByComponent(
      [insight('i1', 'A'), insight('i4', 'D')],
      PARENTS,
      CLASSES,
      NAMES,
    )
    // The whole point: counts must still sum to what the intent row claims.
    const total = groups.reduce((n, g) => n + g.insights.length, 0)
    expect(total).toBe(2)
    const bucket = groups.find((g) => g.id === NOT_PLACED_ID)
    expect(bucket?.name).toBe(NOT_PLACED_NAME)
    expect(bucket?.insights.map((i) => i.id)).toEqual(['i4'])
  })

  it('orders heaviest first and always sinks the not-placed bucket', () => {
    const groups = groupByComponent(
      [insight('i4', 'D'), insight('i3', 'C'), insight('i1', 'A'), insight('i2', 'B')],
      PARENTS,
      CLASSES,
      NAMES,
    )
    expect(groups.map((g) => g.id)).toEqual(['c1', 'c2', NOT_PLACED_ID])
  })

  it('a parent cycle terminates instead of hanging the tab', () => {
    const cyclic = new Map<string, string>([
      ['i9', 'x'],
      ['x', 'y'],
      ['y', 'x'],
    ])
    const groups = groupByComponent([insight('i9', 'Z')], cyclic, new Map(), new Map())
    expect(groups[0].id).toBe(NOT_PLACED_ID)
  })

  it('names a Component by id when the name map has no entry for it', () => {
    const groups = groupByComponent([insight('i3', 'C')], PARENTS, CLASSES, new Map())
    expect(groups[0].name).toBe('c2')
  })
})

describe('filesTouched', () => {
  it('ranks by how many lessons name each file, not how often it is mentioned', () => {
    const files = filesTouched([
      insight('i1', 'A', ['config/code-graph.json', 'lib/x.mjs']),
      insight('i2', 'B', ['config/code-graph.json']),
      insight('i3', 'C', ['config/code-graph.json']),
    ])
    expect(files[0]).toMatchObject({ path: 'config/code-graph.json', count: 3 })
    expect(files[0].lessonIds.sort()).toEqual(['i1', 'i2', 'i3'])
    expect(files[1]).toMatchObject({ path: 'lib/x.mjs', count: 1 })
  })

  it('folds a bare basename into the one path that shares it', () => {
    const files = filesTouched([
      insight('i1', 'A', ['lib/code-graph/registry.mjs']),
      insight('i2', 'B', ['registry.mjs']),
    ])
    // One file named two ways is one file. Leaving it split understates the
    // top of the ranking, which is the only thing the ranking is for.
    expect(files).toHaveLength(1)
    expect(files[0]).toMatchObject({ path: 'lib/code-graph/registry.mjs', count: 2 })
  })

  it('refuses to fold when two paths could have been meant', () => {
    const files = filesTouched([
      insight('i1', 'A', ['lib/a/registry.mjs']),
      insight('i2', 'B', ['lib/b/registry.mjs']),
      insight('i3', 'C', ['registry.mjs']),
    ])
    // Folding here would assign i3 to one of them on no evidence.
    expect(files.map((f) => f.path).sort()).toEqual([
      'lib/a/registry.mjs',
      'lib/b/registry.mjs',
      'registry.mjs',
    ])
  })

  it('keeps a bare basename that has no path sibling — it is the only form there is', () => {
    const files = filesTouched([insight('i1', 'A', ['ObservationWriter.js'])])
    expect(files).toHaveLength(1)
    expect(files[0].path).toBe('ObservationWriter.js')
  })

  it('rejects directories and claims that are not files at all', () => {
    const files = filesTouched([
      insight('i1', 'A', [
        '.codegraph/',
        'docs/benchmarks/coding-v1/',
        'mcp.tools',
        'row.id',
        'origin/main',
        '0/0',
        'lib/real.mjs',
      ]),
    ])
    expect(files.map((f) => f.path)).toEqual(['lib/real.mjs'])
  })

  it('counts a lesson once however many times it names the same file', () => {
    const files = filesTouched([insight('i1', 'A', ['a/b.ts', 'a/b.ts'])])
    expect(files[0].count).toBe(1)
  })

  it('an insight with no verification record contributes nothing and does not throw', () => {
    expect(filesTouched([insight('i1', 'A')])).toEqual([])
    expect(filesTouched([{ id: 'i2', name: 'B' }])).toEqual([])
    expect(filesTouched([{ id: 'i3', name: 'C', metadata: { codeVerification: 'nope' } }])).toEqual([])
  })
})

describe('verifiedAt', () => {
  it('reports the date when every reading agrees', () => {
    expect(verifiedAt([insight('i1', 'A', ['a.ts']), insight('i2', 'B', ['b.ts'])])).toBe('2026-09-19')
  })

  it('says nothing when the corpus was verified in more than one pass', () => {
    expect(
      verifiedAt([
        insight('i1', 'A', ['a.ts'], '2026-09-19T00:00:00Z'),
        insight('i2', 'B', ['b.ts'], '2026-08-01T00:00:00Z'),
      ]),
    ).toBeNull()
  })

  it('says nothing when there is nothing to report', () => {
    expect(verifiedAt([insight('i1', 'A')])).toBeNull()
  })
})

describe('fileFocusId', () => {
  it('round-trips and cannot be mistaken for an entity id', () => {
    const id = fileFocusId('lib/x.mjs')
    expect(isFileFocusId(id)).toBe(true)
    // Entity ids are UUIDs; nothing in the graph starts with the prefix.
    expect(isFileFocusId('019e5559-69cf-75e2-9e01-2be0315b0d86')).toBe(false)
  })
})
