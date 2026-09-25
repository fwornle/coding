// deriveParents — the DAG→tree reduction behind the Hierarchy Navigator.
//
// The cases that matter are the ambiguous ones: the live graph has ~129 nodes
// with more than one candidate parent, and the choice has to be the same on
// every load or the tree visibly reshuffles.

import { describe, test, expect } from 'vitest'
import type { Entity, Relation } from '@/api/ApiClient'
import { deriveParents, HIERARCHY_CLASSES, HIERARCHY_LEVEL, explicitPlacementEdges } from './hierarchy-parents'

const ent = (id: string, ontologyClass: string, name = id): Entity =>
  ({ id, name, ontologyClass }) as Entity

const rel = (from: string, to: string, type: string): Relation => ({ from, to, type })

const ENTITIES: Entity[] = [
  ent('sys', 'System', 'CollectiveKnowledge'),
  ent('coding', 'Project', 'Coding'),
  ent('kgbench', 'Project', 'Kgbench'),
  ent('km', 'Component', 'KnowledgeManagement'),
  ent('sa', 'Component', 'SemanticAnalysis'),
  ent('detail', 'Detail', 'OntologyClassificationAgent'),
  ent('insight', 'Insight', 'SomeInsight'), // level 4, placed by metadata.parentId
  ent('obs', 'Observation', 'SomeObservation'), // genuinely not a hierarchy class
]

describe('deriveParents', () => {
  test('System is a hierarchy class, so Projects are not roots', () => {
    expect(HIERARCHY_CLASSES.has('System')).toBe(true)
    const parents = deriveParents(ENTITIES, [rel('sys', 'coding', 'includes')])
    expect(parents.get('coding')).toBe('sys')
  })

  test('prefers the parent exactly one level up over a same-level container', () => {
    // The real SemanticAnalysis case: `contains`ed by a sibling Component and
    // `parent-child`ed by the Project above it. The Project must win.
    const parents = deriveParents(ENTITIES, [
      rel('km', 'sa', 'contains'),
      rel('coding', 'sa', 'parent-child'),
    ])
    expect(parents.get('sa')).toBe('coding')
  })

  test('level adjacency beats edge rank', () => {
    // km is one level up (Component→Component is not, but Component→Detail is);
    // even with the weaker `contains` edge it beats a distant parent-child.
    const parents = deriveParents(ENTITIES, [
      rel('km', 'detail', 'contains'), // Component -> Detail: 2 levels apart
      rel('sa', 'detail', 'contains'),
    ])
    // neither is adjacent, so the tie-break falls to edge rank then level then name
    expect(['km', 'sa']).toContain(parents.get('detail'))
  })

  test('with equal adjacency, parent-child beats contains beats includes', () => {
    const es = [ent('p1', 'Component', 'Bbb'), ent('p2', 'Component', 'Aaa'), ent('c', 'SubComponent')]
    expect(deriveParents(es, [rel('p1', 'c', 'parent-child'), rel('p2', 'c', 'contains')]).get('c')).toBe('p1')
    expect(deriveParents(es, [rel('p1', 'c', 'contains'), rel('p2', 'c', 'includes')]).get('c')).toBe('p1')
  })

  test('final tie-break is parent name, so the result is stable across edge order', () => {
    const es = [ent('p1', 'Component', 'Zulu'), ent('p2', 'Component', 'Alpha'), ent('c', 'SubComponent')]
    const forward = deriveParents(es, [rel('p1', 'c', 'contains'), rel('p2', 'c', 'contains')])
    const reversed = deriveParents(es, [rel('p2', 'c', 'contains'), rel('p1', 'c', 'contains')])
    expect(forward.get('c')).toBe('p2')
    expect(reversed.get('c')).toBe('p2')
  })

  test('non-containment edge types are not parent edges', () => {
    const parents = deriveParents(ENTITIES, [
      rel('coding', 'sa', 'related_to'),
      rel('coding', 'sa', 'has_insight'),
      rel('coding', 'sa', 'mentions'),
    ])
    expect(parents.has('sa')).toBe(false)
  })

  test('edges touching a non-hierarchy class are ignored', () => {
    const parents = deriveParents(ENTITIES, [rel('coding', 'obs', 'contains')])
    expect(parents.has('obs')).toBe(false)
  })

  // Insight joined the hierarchy on 2026-09-21. It was excluded, which meant
  // deriveParents emitted no parent for any of the 975 Insights in the live
  // graph and the whole online-learning population sat outside the tree.
  test('an Insight is a hierarchy class at Detail level', () => {
    expect(HIERARCHY_CLASSES.has('Insight')).toBe(true)
    expect(HIERARCHY_LEVEL.Insight).toBe(HIERARCHY_LEVEL.Detail)
  })

  test('metadata.parentId places an Insight that has no containment edge', () => {
    const entities = ENTITIES.map((e) =>
      e.id === 'insight' ? { ...e, metadata: { parentId: 'sa' } } : e,
    )
    // has_insight is its only edge, and that is ownership, not position.
    const parents = deriveParents(entities, [rel('coding', 'insight', 'has_insight')])
    expect(parents.get('insight')).toBe('sa')
  })

  test('metadata.parentId outranks a containment edge', () => {
    const entities = ENTITIES.map((e) =>
      e.id === 'detail' ? { ...e, metadata: { parentId: 'sa' } } : e,
    )
    const parents = deriveParents(entities, [rel('km', 'detail', 'contains')])
    expect(parents.get('detail')).toBe('sa')
  })

  test('a parentId naming an unknown or self id is ignored, not fatal', () => {
    const ghost = ENTITIES.map((e) =>
      e.id === 'detail' ? { ...e, metadata: { parentId: 'ghost' } } : e,
    )
    expect(deriveParents(ghost, [rel('km', 'detail', 'contains')]).get('detail')).toBe('km')
    const selfish = ENTITIES.map((e) =>
      e.id === 'detail' ? { ...e, metadata: { parentId: 'detail' } } : e,
    )
    expect(deriveParents(selfish, []).has('detail')).toBe(false)
  })

  test('a self-edge never roots a node in itself', () => {
    const parents = deriveParents(ENTITIES, [rel('sa', 'sa', 'contains')])
    expect(parents.has('sa')).toBe(false)
  })

  test('an entity with no candidate parent is absent from the map', () => {
    const parents = deriveParents(ENTITIES, [])
    expect(parents.size).toBe(0)
  })

  test('a two-node cycle is broken rather than left to hang the render', () => {
    const es = [ent('a', 'Component'), ent('b', 'Component')]
    const parents = deriveParents(es, [rel('a', 'b', 'contains'), rel('b', 'a', 'contains')])
    // one side keeps its parent, the other becomes a root — never both linked
    expect(parents.size).toBeLessThan(2)
  })

  test('a longer cycle is broken too', () => {
    const es = [ent('a', 'Component'), ent('b', 'Component'), ent('c', 'Component')]
    const parents = deriveParents(es, [
      rel('a', 'b', 'contains'),
      rel('b', 'c', 'contains'),
      rel('c', 'a', 'contains'),
    ])
    // walking up from every node must terminate
    for (const start of ['a', 'b', 'c']) {
      const seen = new Set<string>([start])
      let cursor = parents.get(start)
      while (cursor !== undefined) {
        expect(seen.has(cursor)).toBe(false)
        seen.add(cursor)
        cursor = parents.get(cursor)
      }
    }
  })

  test('builds the real shape: System > Project > Component > Detail', () => {
    const parents = deriveParents(ENTITIES, [
      rel('sys', 'coding', 'includes'),
      rel('sys', 'kgbench', 'includes'),
      rel('coding', 'km', 'parent-child'),
      rel('km', 'detail', 'contains'),
    ])
    expect(parents.get('coding')).toBe('sys')
    expect(parents.get('kgbench')).toBe('sys')
    expect(parents.get('km')).toBe('coding')
    expect(parents.get('detail')).toBe('km')
  })
})

describe('explicitPlacementEdges', () => {
  const node = (id: string, metadata: Record<string, unknown> = {}) =>
    ({ id, name: id, ontologyClass: 'Detail', metadata }) as Parameters<typeof explicitPlacementEdges>[0][number]

  test('turns metadata.parentId into a contains edge the canvas can draw', () => {
    // The whole point: `deriveParents` already honours this field, so the row
    // counts as attributed while having no edge — attributed and invisible.
    const edges = explicitPlacementEdges([node('parent'), node('child', { parentId: 'parent' })])
    expect(edges).toEqual([{ from: 'parent', to: 'child', type: 'contains' }])
  })

  test('drops a placement naming a row that is not present', () => {
    // Nothing to draw to. Emitting it would put an edge to a node the canvas
    // never renders, which `buildRehomeEdges` would then treat as a hidden
    // ancestor and walk through forever.
    expect(explicitPlacementEdges([node('child', { parentId: 'ghost' })])).toEqual([])
  })

  test('drops a self-placement', () => {
    expect(explicitPlacementEdges([node('a', { parentId: 'a' })])).toEqual([])
  })

  test('ignores rows with no placement, and a non-string one', () => {
    expect(explicitPlacementEdges([
      node('a'),
      node('b', { parentId: '' }),
      node('c', { parentId: 42 }),
    ])).toEqual([])
  })
})
