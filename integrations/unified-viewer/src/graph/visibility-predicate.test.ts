// Phase 60 Plan 01 (G1) — visibility-predicate Layer rule symmetry tests.
//
// Verifies the predicate's Layer branch consults the shared `deriveLayer`
// helper (single source of truth with LayerFilter count badges), specifically
// covering the Phase 57 L2 extends-walk that the inline pre-Phase-60 rule
// missed:
//   - `OnlineInsight` should classify as 'pattern' via registry → Insight
//     ancestor walk, so selectedLayers=['pattern'] keeps it visible.
//   - selectedLayers=['evidence'] should hide an OnlineInsight node.
//   - Existing direct-class behaviour (Insight, Pattern → pattern) is
//     preserved when no registry is supplied (graceful fallback per D-02).

import { describe, test, expect } from 'vitest'
import { isEntityVisible, type VisibilityFilters } from './visibility-predicate'
import type { Entity } from './types'

function baseFilters(overrides: Partial<VisibilityFilters> = {}): VisibilityFilters {
  return {
    searchQueryLowered: '',
    selectedTeams: new Set<string>(),
    learningSource: 'combined',
    selectedLayers: [],
    hideDocNodes: false,
    selectedClasses: new Set<string>(['Insight', 'Pattern', 'OnlineInsight', 'Component']),
    visibleLevels: new Set<0 | 1 | 2 | 3>([0, 1, 2, 3]),
    lslFilterEntityIds: null,
    ...overrides,
  }
}

function entity(partial: Partial<Entity> & { id: string; name: string; ontologyClass: string }): Entity {
  return { ...partial } as Entity
}

describe('isEntityVisible — Layer rule (Phase 60-01 G1)', () => {
  const registry = [
    { name: 'OnlineInsight', parent: 'Insight' },
    { name: 'Insight', parent: null },
    { name: 'Pattern', parent: null },
    { name: 'Component', parent: null },
  ]

  test('selectedLayers=["pattern"] + OnlineInsight + registry → visible (extends-walk pattern)', () => {
    const e = entity({ id: 'oi-1', name: 'X', ontologyClass: 'OnlineInsight' })
    expect(isEntityVisible(e, baseFilters({
      selectedLayers: ['pattern'],
      ontologyRegistry: registry,
    }))).toBe(true)
  })

  test('selectedLayers=["evidence"] + OnlineInsight + registry → hidden', () => {
    const e = entity({ id: 'oi-1', name: 'X', ontologyClass: 'OnlineInsight' })
    expect(isEntityVisible(e, baseFilters({
      selectedLayers: ['evidence'],
      ontologyRegistry: registry,
    }))).toBe(false)
  })

  test('selectedLayers=["pattern"] + Pattern direct class (no registry) → visible (graceful fallback)', () => {
    const e = entity({ id: 'p-1', name: 'P', ontologyClass: 'Pattern' })
    expect(isEntityVisible(e, baseFilters({
      selectedLayers: ['pattern'],
    }))).toBe(true)
  })

  test('selectedLayers=["evidence"] + Component → visible', () => {
    const e = entity({ id: 'c-1', name: 'C', ontologyClass: 'Component' })
    expect(isEntityVisible(e, baseFilters({
      selectedLayers: ['evidence'],
      ontologyRegistry: registry,
    }))).toBe(true)
  })

  test('selectedLayers=["pattern"] + Component → hidden (Evidence-OFF symmetry)', () => {
    const e = entity({ id: 'c-1', name: 'C', ontologyClass: 'Component' })
    expect(isEntityVisible(e, baseFilters({
      selectedLayers: ['pattern'],
      ontologyRegistry: registry,
    }))).toBe(false)
  })

  test('explicit metadata.layer="evidence" overrides ontologyClass="Pattern" (D-03)', () => {
    const e = entity({
      id: 'p-2',
      name: 'P',
      ontologyClass: 'Pattern',
      metadata: { layer: 'evidence' },
    })
    expect(isEntityVisible(e, baseFilters({
      selectedLayers: ['evidence'],
      ontologyRegistry: registry,
    }))).toBe(true)
    expect(isEntityVisible(e, baseFilters({
      selectedLayers: ['pattern'],
      ontologyRegistry: registry,
    }))).toBe(false)
  })

  test('selectedLayers=["__none__"] short-circuits to false BEFORE deriveLayer is called', () => {
    const e = entity({ id: 'p-3', name: 'P', ontologyClass: 'Pattern' })
    expect(isEntityVisible(e, baseFilters({
      selectedLayers: ['__none__'],
    }))).toBe(false)
  })
})
