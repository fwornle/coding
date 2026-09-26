// Tests for the resolver behind the entity panel's Parent / Level rows.
//
// The case that matters is the FIRST one: an entity shaped like a real row —
// no `parent`, no `level`, because no writer sets either — must still resolve
// both. That is the shape 2801 of 2801 live entities have, and the shape no
// existing test used, which is why the two dead rows shipped.

import { describe, test, expect } from 'vitest'
import { resolveHierarchyIdentity, nameLookup } from './hierarchy-identity'

const entities = [
  { id: 'sys', name: 'CollectiveKnowledge' },
  { id: 'proj', name: 'Coding' },
  { id: 'comp', name: 'LiveLoggingSystem' },
  { id: 'sub', name: 'SpecstoryAdapter' },
  { id: 'leaf', name: 'SpecstoryAdapterInterface' },
]
const nameOf = nameLookup(entities)

// The chain the walkthrough documents, as the store holds it.
const hierarchyParents = new Map<string, string>([
  ['leaf', 'sub'],
  ['sub', 'comp'],
  ['comp', 'proj'],
  ['proj', 'sys'],
])

describe('resolveHierarchyIdentity', () => {
  test('a real-shaped row (no .parent, no .level) resolves both from the store', () => {
    const r = resolveHierarchyIdentity({
      entityId: 'sub',
      ontologyClass: 'SubComponent',
      hierarchyParents,
      nameOf,
    })
    expect(r).toEqual({ parentName: 'LiveLoggingSystem', level: 3 })
  })

  test('level is ontology depth, System 0 through Detail 4', () => {
    const depth = (ontologyClass: string) =>
      resolveHierarchyIdentity({ entityId: 'x', ontologyClass, hierarchyParents, nameOf }).level
    expect(depth('System')).toBe(0)
    expect(depth('Project')).toBe(1)
    expect(depth('Component')).toBe(2)
    expect(depth('SubComponent')).toBe(3)
    expect(depth('Detail')).toBe(4)
    // Insight sits at Detail's level — a SubComponent's child, not a Detail's.
    expect(depth('Insight')).toBe(4)
  })

  test('a class outside the ladder has no depth, rather than a wrong one', () => {
    for (const cls of ['Observation', 'Digest', 'Pattern', 'Unclassified']) {
      expect(
        resolveHierarchyIdentity({ entityId: 'leaf', ontologyClass: cls, hierarchyParents, nameOf })
          .level,
      ).toBeNull()
    }
    expect(
      resolveHierarchyIdentity({
        entityId: 'leaf',
        ontologyClass: undefined,
        hierarchyParents,
        nameOf,
      }).level,
    ).toBeNull()
  })

  test('a root has no parent', () => {
    expect(
      resolveHierarchyIdentity({
        entityId: 'sys',
        ontologyClass: 'System',
        hierarchyParents,
        nameOf,
      }).parentName,
    ).toBeNull()
  })

  test('a parent that is not in the store shows its id, NOT the no-parent dash', () => {
    // The `danglingRef` category: the placing edge points at an entity the
    // store does not have. `—` would read as "this is a root", which is the
    // opposite of what is wrong with it.
    const dangling = new Map([['orphan', 'missing-entity-id']])
    const r = resolveHierarchyIdentity({
      entityId: 'orphan',
      ontologyClass: 'Detail',
      hierarchyParents: dangling,
      nameOf,
    })
    expect(r.parentName).toBe('missing-entity-id')
    expect(r.parentName).not.toBeNull()
  })

  test('an empty store resolves no parent rather than throwing', () => {
    const r = resolveHierarchyIdentity({
      entityId: 'leaf',
      ontologyClass: 'Detail',
      hierarchyParents: new Map(),
      nameOf: nameLookup([]),
    })
    expect(r).toEqual({ parentName: null, level: 4 })
  })
})

describe('nameLookup', () => {
  test('maps id to name and returns undefined for an unknown id', () => {
    expect(nameOf('comp')).toBe('LiveLoggingSystem')
    expect(nameOf('nope')).toBeUndefined()
  })

  test('an entity with no name is skipped rather than mapped to empty string', () => {
    const lookup = nameLookup([{ id: 'a' }, { id: 'b', name: 'B' }])
    expect(lookup('a')).toBeUndefined()
    expect(lookup('b')).toBe('B')
  })
})
