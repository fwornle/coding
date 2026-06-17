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
    // Phase 60 Plan 03 (G3): required field. Defaults to false (architecture-
    // bleed shield ON) so Layer-rule tests stay focused on layer semantics.
    showDebugEntityTypes: false,
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

// ----------------------------------------------------------------------------
// Phase 60 Plan 03 (G3) — Observation/Digest hard-exclusion gated by
// `showDebugEntityTypes`.
//
// PATTERN SOURCE: 60-03-PLAN.md Task 1 <behavior> Predicate tests 1-5.
//
// Decisions:
//   - D-09: default keeps the hard-exclude. With showDebugEntityTypes=true the
//           Observation/Digest branch is skipped and those types reach the
//           graph (subject to the rest of the pipeline).
//   - W-2 (defensive read): predicate reads `filters.showDebugEntityTypes
//           !== true` so an undefined runtime value (half-deployed call site)
//           behaves identically to false — no Observation/Digest leak.
// ----------------------------------------------------------------------------

describe('isEntityVisible — showDebugEntityTypes gate (Phase 60-03 G3)', () => {
  // selectedClasses must include the entity types we are exercising so the
  // class predicate (line 112) does not knock them out before we reach the
  // showDebugEntityTypes branch.
  function gateFilters(overrides: Partial<VisibilityFilters> = {}): VisibilityFilters {
    return {
      searchQueryLowered: '',
      selectedTeams: new Set<string>(),
      learningSource: 'combined',
      selectedLayers: [],
      hideDocNodes: false,
      selectedClasses: new Set<string>(['Component', 'Detail', 'Observation', 'Digest']),
      visibleLevels: new Set<0 | 1 | 2 | 3>([0, 1, 2, 3]),
      lslFilterEntityIds: null,
      showDebugEntityTypes: false,
      ...overrides,
    }
  }

  // Build an entity with the runtime `entityType` shape the predicate checks.
  function obsEntity(entityType: string): Entity {
    return {
      id: `obs-${entityType}-1`,
      name: 'an entity',
      ontologyClass: 'Detail',
      entityType,
    } as unknown as Entity
  }

  test('Predicate test 1 (D-09 default): Observation entity is EXCLUDED when showDebugEntityTypes=false', () => {
    const e = obsEntity('Observation')
    expect(isEntityVisible(e, gateFilters({ showDebugEntityTypes: false }))).toBe(false)
  })

  test('Predicate test 2 (toggle ON unhides): Observation entity is VISIBLE when showDebugEntityTypes=true', () => {
    const e = obsEntity('Observation')
    expect(isEntityVisible(e, gateFilters({ showDebugEntityTypes: true }))).toBe(true)
  })

  test('Predicate test 3 (Digest mirrors Observation): Digest hidden by default, visible when ON', () => {
    const e = obsEntity('Digest')
    expect(isEntityVisible(e, gateFilters({ showDebugEntityTypes: false }))).toBe(false)
    expect(isEntityVisible(e, gateFilters({ showDebugEntityTypes: true }))).toBe(true)
  })

  test('Predicate test 4 (other entity types unaffected): Component visible regardless of showDebugEntityTypes', () => {
    const e: Entity = {
      id: 'c-1',
      name: 'Component A',
      ontologyClass: 'Component',
      entityType: 'Component',
    } as unknown as Entity
    expect(isEntityVisible(e, gateFilters({ showDebugEntityTypes: false }))).toBe(true)
    expect(isEntityVisible(e, gateFilters({ showDebugEntityTypes: true }))).toBe(true)
  })

  test('Predicate test 5 (W-2 defensive read): undefined showDebugEntityTypes treated identically to false — Observation still hidden', () => {
    // Simulate a half-deployed call site that did NOT pass the field. The
    // predicate reads `!== true` so undefined/null behave like false: the
    // Observation must STILL be excluded. This is the architecture-bleed
    // shield invariant.
    const e = obsEntity('Observation')
    // Strip the required field via Partial → cast to satisfy isEntityVisible's
    // signature. At runtime `filters.showDebugEntityTypes` is undefined.
    const partial = gateFilters() as Partial<VisibilityFilters>
    delete (partial as { showDebugEntityTypes?: boolean }).showDebugEntityTypes
    expect(
      isEntityVisible(e, partial as VisibilityFilters),
    ).toBe(false)
  })
})
