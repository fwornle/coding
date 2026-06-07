// Unit tests for the pure graph builder + state computation.

import { describe, test, expect } from 'vitest'
import { buildGraph, mergeIntoGraph, computeNodeState } from './graph-builder'
import type { Entity, OntologyClass, Relation } from './types'

const ontology: OntologyClass[] = [
  { name: 'Observation' },
  { name: 'Digest', display: { color: '#ff00ff' } },
  { name: 'Insight' },
]

const entities: Entity[] = [
  { id: 'a', name: 'Alpha', ontologyClass: 'Observation', level: 3 },
  { id: 'b', name: 'Beta', ontologyClass: 'Digest', level: 2 },
  { id: 'c', name: 'Gamma', ontologyClass: 'Insight', level: 1 },
]

const relations: Relation[] = [
  { from: 'a', to: 'b', type: 'derives_from' },
  { from: 'b', to: 'c', type: 'feeds' },
]

describe('buildGraph', () => {
  test('builds a graphology Graph with entities.length nodes', () => {
    const g = buildGraph(entities, relations, ontology, 'dark')
    expect(g.order).toBe(3)
    expect(g.size).toBe(2)
  })

  test('uses ontology.display.color when present', () => {
    const g = buildGraph(entities, [], ontology, 'dark')
    expect(g.getNodeAttribute('b', 'color')).toBe('#ff00ff')
  })

  test('falls back to FNV-1a hash color when ontology has no display.color', () => {
    const g = buildGraph(entities, [], ontology, 'dark')
    // No display.color for Observation → hash fallback. Output is hex
    // (#rrggbb) — Sigma's WebGL parser silently rejects hsl() strings, so
    // the FNV-derived hue is HSL→hex converted before storage. See
    // color-fallback.ts and color-fallback.test.ts for the hue contract.
    const colorA = g.getNodeAttribute('a', 'color')
    expect(typeof colorA).toBe('string')
    expect(colorA).toMatch(/^#[0-9a-f]{6}$/)
  })

  test('skips relations with missing endpoints', () => {
    const r = [{ from: 'a', to: 'z', type: 'unknown' }]
    const g = buildGraph(entities, r, ontology, 'dark')
    expect(g.size).toBe(0) // No edges added because 'z' doesn't exist
  })
})

describe('mergeIntoGraph — idempotency (T-45-02-04 mitigation)', () => {
  test('Test 4 (idempotency): re-merging the same node does NOT grow graph.order', () => {
    const g = buildGraph(entities, relations, ontology, 'dark')
    const orderBefore = g.order
    const added = mergeIntoGraph(g, { entities: [entities[0]], relations: [] }, ontology, 'dark')
    expect(added).toBe(0)
    expect(g.order).toBe(orderBefore)
  })

  test('merging genuinely-new nodes does grow graph.order', () => {
    const g = buildGraph(entities, relations, ontology, 'dark')
    const orderBefore = g.order
    const newEntity: Entity = { id: 'd', name: 'Delta', ontologyClass: 'Observation', level: 3 }
    const added = mergeIntoGraph(g, { entities: [newEntity], relations: [] }, ontology, 'dark')
    expect(added).toBe(1)
    expect(g.order).toBe(orderBefore + 1)
  })

  test('merging new edges between existing nodes is idempotent on edge keys', () => {
    const g = buildGraph(entities, relations, ontology, 'dark')
    const sizeBefore = g.size
    // Re-merge an existing edge — undirected merge is idempotent
    mergeIntoGraph(g, { entities: [], relations: [{ from: 'a', to: 'b', type: 'derives_from' }] }, ontology, 'dark')
    expect(g.size).toBe(sizeBefore)
  })
})

describe('computeNodeState — Plan 03 checkpoint round 2 semantics', () => {
  // Semantic: "what's checked is what's visible". Empty Set = nothing.
  // baseStore seeds selectedClasses with the canonical test class so the
  // default tests assert the "visible by default" path.
  const baseStore = {
    selectedNodeId: null,
    searchQuery: '',
    visibleLevels: new Set<0 | 1 | 2 | 3>([0, 1, 2, 3]),
    selectedClasses: new Set<string>(['Observation']),
  }

  test('default when no selection, no search, class+level checked', () => {
    const s = computeNodeState('a', { name: 'Alpha', ontologyClass: 'Observation', level: 3 }, baseStore)
    expect(s).toBe('default')
  })

  test('selected when id matches selectedNodeId', () => {
    const s = computeNodeState('a', { name: 'Alpha' }, { ...baseStore, selectedNodeId: 'a' })
    expect(s).toBe('selected')
  })

  test('hover when id matches hoveredNodeId (and not selected)', () => {
    const s = computeNodeState(
      'a',
      { name: 'Alpha', ontologyClass: 'Observation', level: 3 },
      baseStore,
      'a',
    )
    expect(s).toBe('hover')
  })

  test('search-match when class+level visible AND search query matches', () => {
    const s = computeNodeState(
      'a',
      { name: 'Alpha', ontologyClass: 'Observation', level: 3 },
      { ...baseStore, searchQuery: 'alp' },
    )
    expect(s).toBe('search-match')
  })

  test('filter-hidden when level not in visibleLevels (search inactive)', () => {
    const s = computeNodeState(
      'a',
      { name: 'Alpha', ontologyClass: 'Observation', level: 3 },
      { ...baseStore, visibleLevels: new Set([0, 1, 2]) },
    )
    expect(s).toBe('filter-hidden')
  })

  test('filter-hidden when search active and node does not match (regardless of class/level)', () => {
    // Plan 03 round 2: search now HIDES non-matches outright (the prior
    // filter-dimmed opacity overlay is invisible in sigma WebGL).
    const s = computeNodeState(
      'a',
      { name: 'Alpha', ontologyClass: 'Observation', level: 3 },
      { ...baseStore, searchQuery: 'zzz-no-match' },
    )
    expect(s).toBe('filter-hidden')
  })

  test('filter-hidden when ontologyClass NOT in selectedClasses Set', () => {
    const s = computeNodeState(
      'a',
      { name: 'Alpha', ontologyClass: 'Observation', level: 3 },
      { ...baseStore, selectedClasses: new Set(['Digest']) },
    )
    expect(s).toBe('filter-hidden')
  })

  test('filter-hidden when selectedClasses is empty Set (nothing visible)', () => {
    // Plan 03 round 2 flipped the semantic from "empty = all" to
    // "empty = nothing". UnifiedViewer auto-seeds the set on first
    // load so the default UX still shows everything.
    const s = computeNodeState(
      'a',
      { name: 'Alpha', ontologyClass: 'Observation', level: 3 },
      { ...baseStore, selectedClasses: new Set<string>() },
    )
    expect(s).toBe('filter-hidden')
  })

  test('selected class filter — class IN set → default', () => {
    const s = computeNodeState(
      'a',
      { name: 'Alpha', ontologyClass: 'Observation', level: 3 },
      { ...baseStore, selectedClasses: new Set(['Observation']) },
    )
    expect(s).toBe('default')
  })
})
