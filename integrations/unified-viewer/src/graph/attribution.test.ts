// Categorising WHY a row has no project — one fixture per category.
//
// The point of these is that the four categories stay distinct. A single
// "unattributed" count invites dragging the row onto a project, and for three
// of the four that writes a redundant placement over a class bug or a broken
// reference. So each test pins not just the count but the category, and the
// suggestion is asserted only where one is honest.

import { describe, test, expect } from 'vitest'
import {
  categoriseUnattributed,
  rootOf,
  type AttributionEntity,
  type AttributionEdge,
} from './attribution'

const ent = (
  id: string,
  ontologyClass: string,
  name = id,
  metadata: Record<string, unknown> = {},
): AttributionEntity => ({ id, name, ontologyClass, metadata })

const edge = (from: string, to: string, type: string): AttributionEdge => ({ from, to, type })

/** A rooted spine every fixture hangs off: Project -> Component. */
const SPINE = [ent('proj', 'Project', 'Coding'), ent('comp', 'Component', 'KnowledgeManagement')]
const SPINE_EDGES = [edge('proj', 'comp', 'contains')]
const SPINE_PARENTS = new Map([['comp', 'proj']])

function run(
  candidates: AttributionEntity[],
  extraEntities: AttributionEntity[] = [],
  extraEdges: AttributionEdge[] = [],
  extraParents: Array<[string, string]> = [],
) {
  const all = [...SPINE, ...extraEntities, ...candidates]
  const classOf = (id: string) => all.find((e) => e.id === id)?.ontologyClass
  return categoriseUnattributed(
    candidates,
    all,
    [...SPINE_EDGES, ...extraEdges],
    new Map([...SPINE_PARENTS, ...extraParents]),
    classOf,
  )
}

describe('categoriseUnattributed', () => {
  test('recordedParent — the writer named a rooted entity, so suggest it', () => {
    const row = ent('d1', 'Detail', 'TieredConfigLoader', { parentEntityName: 'KnowledgeManagement' })
    const r = run([row])
    expect(r.total).toBe(1)
    expect(r.byCategory.recordedParent).toHaveLength(1)
    expect(r.byCategory.recordedParent[0].suggestedParentId).toBe('comp')
    expect(r.byCategory.recordedParent[0].suggestedParentName).toBe('KnowledgeManagement')
  })

  test('a recorded name that resolves to TWO rooted entities is NOT a suggestion', () => {
    // Roll-up parents share their child's name — 40 of the live 98 have a
    // same-named twin. Picking one would be a coin flip presented as an answer.
    const twin = ent('comp2', 'Component', 'KnowledgeManagement')
    const row = ent('d1', 'Detail', 'X', { parentEntityName: 'KnowledgeManagement' })
    const r = run([row], [twin], [edge('proj', 'comp2', 'contains')], [['comp2', 'proj']])
    expect(r.byCategory.recordedParent).toHaveLength(0)
    expect(r.byCategory.unclaimed).toHaveLength(1)
  })

  test('a recorded name pointing at a NONEXISTENT entity is not a suggestion either', () => {
    const row = ent('d1', 'Detail', 'X', { parentEntityName: 'APIServiceWrapper' })
    const r = run([row])
    expect(r.byCategory.recordedParent).toHaveLength(0)
  })

  test('wrongClass — a Project claims it via has_insight but it is not an Insight', () => {
    // deriveParents refuses this pair on purpose (hierarchy-parents.ts:156), so
    // the row is claimed and unplaceable at the same time.
    const row = ent('d1', 'Detail', 'Some lesson')
    const r = run([row], [], [edge('proj', 'd1', 'has_insight')])
    expect(r.byCategory.wrongClass).toHaveLength(1)
    expect(r.byCategory.wrongClass[0].suggestedParentId).toBeUndefined()
  })

  test('danglingRef — the thing that contains it is not in the store', () => {
    const row = ent('d1', 'Detail', 'ApiServiceChildWrapper')
    const r = run([row], [], [edge('ghost', 'd1', 'contains')])
    expect(r.byCategory.danglingRef).toHaveLength(1)
  })

  test('unclaimed — no edge, no recorded name', () => {
    const r = run([ent('i1', 'Intent', 'Some goal')])
    expect(r.byCategory.unclaimed).toHaveLength(1)
  })

  test('a ROOTED row is not a finding at all', () => {
    const row = ent('d1', 'Detail')
    const r = run([row], [], [edge('comp', 'd1', 'contains')], [['d1', 'comp']])
    expect(r.total).toBe(0)
    expect(r.findings).toHaveLength(0)
  })

  test('Project and System are never findings — they ARE the roots', () => {
    const r = run([ent('p2', 'Project', 'Other'), ent('s1', 'System', 'CollectiveKnowledge')])
    expect(r.total).toBe(0)
  })

  test('categories are exclusive — every finding lands in exactly one bucket', () => {
    // A row with BOTH a recorded parent and a has_insight claim must not be
    // counted twice; the most actionable category wins.
    const row = ent('d1', 'Detail', 'X', { parentEntityName: 'KnowledgeManagement' })
    const r = run([row], [], [edge('proj', 'd1', 'has_insight')])
    expect(r.total).toBe(1)
    const sum = Object.values(r.byCategory).reduce((n, list) => n + list.length, 0)
    expect(sum).toBe(1)
    expect(r.byCategory.recordedParent).toHaveLength(1)
  })

  test('a parent cycle does not hang the walk', () => {
    const a = ent('a', 'Detail')
    const b = ent('b', 'Detail')
    const r = run([a, b], [], [], [['a', 'b'], ['b', 'a']])
    expect(r.total).toBe(2)
  })

  test('empty input returns an empty report rather than throwing', () => {
    const r = run([])
    expect(r.total).toBe(0)
    expect(r.byCategory.recordedParent).toEqual([])
  })
})

describe('rootOf', () => {
  const classOf = (id: string) =>
    ({ proj: 'Project', comp: 'Component', d1: 'Detail' } as Record<string, string>)[id]

  test('returns the Project above a row', () => {
    expect(rootOf('d1', new Map([['d1', 'comp'], ['comp', 'proj']]), classOf)).toBe('proj')
  })

  test('returns null when the chain runs out', () => {
    expect(rootOf('d1', new Map([['d1', 'comp']]), classOf)).toBe(null)
  })

  test('returns the node itself when it IS a root', () => {
    expect(rootOf('proj', new Map(), classOf)).toBe('proj')
  })

  test('is cycle-safe', () => {
    expect(rootOf('d1', new Map([['d1', 'comp'], ['comp', 'd1']]), classOf)).toBe(null)
  })
})
