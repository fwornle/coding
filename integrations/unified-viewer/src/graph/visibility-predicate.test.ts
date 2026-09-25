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
    hideRolledUp: false,
    showStale: true,
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
      hideRolledUp: false,
      showStale: true,
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

describe('isEntityVisible — archived rows: rolled-up vs stale', () => {
  // `metadata.archivedAt` marks TWO unrelated populations and one flag used to
  // hide both under a label naming only the first. Rolled-up rows have a parent
  // standing in for them on the canvas; stale rows (archived because their code
  // no longer exists) have nothing. Hiding the second under a checkbox that
  // says "rolled-up" is how a row disappears and nobody goes looking for it.
  function f(overrides: Partial<VisibilityFilters> = {}): VisibilityFilters {
    return {
      searchQueryLowered: '',
      selectedTeams: new Set<string>(),
      learningSource: 'combined',
      selectedLayers: [],
      hideDocNodes: false,
      hideRolledUp: false,
      showStale: true,
      selectedClasses: new Set<string>(['Insight']),
      visibleLevels: new Set<0 | 1 | 2 | 3>([0, 1, 2, 3]),
      lslFilterEntityIds: null,
      showDebugEntityTypes: false,
      ...overrides,
    }
  }

  /** A roll-up CHILD: archived, with a parent that represents it. */
  function rolledUp(archivedAt: string | null): Entity {
    return {
      id: `ins-rolled-${archivedAt ?? 'live'}`,
      name: 'an insight',
      ontologyClass: 'Insight',
      entityType: 'Insight',
      metadata: { archivedAt, rolledUpInto: 'parent-1' },
    } as unknown as Entity
  }

  /** A STALE row: archived by the ratio=0 sweep, nothing stands in for it. */
  function stale(): Entity {
    return {
      id: 'ins-stale',
      name: 'an insight whose code is gone',
      ontologyClass: 'Insight',
      entityType: 'Insight',
      metadata: {
        archivedAt: '2026-08-20T10:00:00Z',
        archiveReason: 'stuck at verificationRatio=0 for 35 days',
      },
    } as unknown as Entity
  }

  /** A roll-up PARENT — carries neither key. */
  function parent(): Entity {
    return {
      id: 'ins-parent',
      name: 'a roll-up parent',
      ontologyClass: 'Insight',
      entityType: 'Insight',
      metadata: { archivedAt: null, rollUpOf: ['a', 'b'] },
    } as unknown as Entity
  }

  it('shows rolled-up children when hideRolledUp is OFF', () => {
    expect(isEntityVisible(rolledUp('2026-09-19T10:00:00Z'), f())).toBe(true)
  })

  it('hides rolled-up children when hideRolledUp is ON', () => {
    expect(
      isEntityVisible(rolledUp('2026-09-19T10:00:00Z'), f({ hideRolledUp: true })),
    ).toBe(false)
  })

  it('keeps roll-up PARENTS visible when hideRolledUp is ON', () => {
    // The parent is what should remain on the canvas — the whole point of the
    // condensed view.
    expect(isEntityVisible(parent(), f({ hideRolledUp: true }))).toBe(true)
  })

  it('treats an empty-string archivedAt as not archived', () => {
    expect(isEntityVisible(rolledUp(''), f({ hideRolledUp: true }))).toBe(true)
  })

  it('SPLIT: hideRolledUp does NOT hide a stale row', () => {
    // The regression this split exists to prevent. A stale row has no parent
    // representing it, so the roll-up switch must not silently remove it.
    expect(isEntityVisible(stale(), f({ hideRolledUp: true, showStale: true }))).toBe(true)
  })

  it('SPLIT: showStale=false hides a stale row even with hideRolledUp OFF', () => {
    expect(isEntityVisible(stale(), f({ hideRolledUp: false, showStale: false }))).toBe(false)
  })

  it('SPLIT: showStale=false does NOT hide a rolled-up child', () => {
    // The mirror of the above — the two switches must be independent in BOTH
    // directions, or one of them is just the old flag under a new name.
    expect(
      isEntityVisible(rolledUp('2026-09-19T10:00:00Z'), f({ hideRolledUp: false, showStale: false })),
    ).toBe(true)
  })
})

describe('isEntityVisible — hiddenNodeTypes (legend click-to-toggle)', () => {
  // This rule used to live OUTSIDE the predicate, as a
  // `&& !hiddenNodeTypes.has(e.ontologyClass)` tacked onto each call site.
  // Two of the three call sites remembered it; useVisibleEntityIds did not,
  // so the LSL strip and the bucket list resolved clicks to nodes the canvas
  // had already removed. Folding it in makes omission impossible.
  const f = (overrides: Partial<VisibilityFilters> = {}) => baseFilters(overrides)
  const node = entity({ id: 'i1', name: 'An insight', ontologyClass: 'Insight' })

  it('hides an entity whose ontologyClass is switched off in the legend', () => {
    expect(isEntityVisible(node, f({ hiddenNodeTypes: new Set(['Insight']) }))).toBe(false)
  })

  it('leaves other classes visible', () => {
    const comp = entity({ id: 'c1', name: 'A component', ontologyClass: 'Component' })
    expect(isEntityVisible(comp, f({ hiddenNodeTypes: new Set(['Insight']) }))).toBe(true)
  })

  it('an empty set hides nothing (store default)', () => {
    expect(isEntityVisible(node, f({ hiddenNodeTypes: new Set<string>() }))).toBe(true)
  })

  it('an omitted set hides nothing — partial filters stay backward-compatible', () => {
    expect(isEntityVisible(node, f())).toBe(true)
  })
})

describe('isEntityVisible — aggregatesOnly (the roll-up layer alone)', () => {
  // Roll-up parents carry ontologyClass 'Insight' like any other insight, so
  // no class/level/team filter can isolate them. metadata.rollUpOf is the only
  // thing that distinguishes an aggregate from a row nobody has rolled up.
  const f = (o: Partial<VisibilityFilters> = {}) => baseFilters({ aggregatesOnly: true, ...o })
  const parent = { id: 'p1', name: 'KnowledgeManagement — consolidated', ontologyClass: 'Insight',
    metadata: { rollUpOf: ['c1', 'c2', 'c3'] } } as unknown as Entity
  const plain = { id: 'i1', name: 'An ordinary insight', ontologyClass: 'Insight',
    metadata: {} } as unknown as Entity

  it('keeps a roll-up parent', () => {
    expect(isEntityVisible(parent, f())).toBe(true)
  })

  it('hides an insight that was never rolled up', () => {
    expect(isEntityVisible(plain, f())).toBe(false)
  })

  it('keeps the structural backbone so parents hang off the architecture', () => {
    for (const cls of ['System', 'Project', 'Component']) {
      const node = { id: `s-${cls}`, name: cls, ontologyClass: cls, metadata: {} } as unknown as Entity
      expect(isEntityVisible(node, f({ selectedClasses: new Set([cls]) }))).toBe(true)
    }
  })

  it('hides SubComponent — it is scaffolding, not an aggregate', () => {
    const sub = { id: 'sc1', name: 'LoggingModule', ontologyClass: 'SubComponent',
      metadata: {} } as unknown as Entity
    expect(isEntityVisible(sub, f({ selectedClasses: new Set(['SubComponent']) }))).toBe(false)
  })

  it('an empty rollUpOf is not an aggregate', () => {
    const empty = { id: 'e1', name: 'x', ontologyClass: 'Insight',
      metadata: { rollUpOf: [] } } as unknown as Entity
    expect(isEntityVisible(empty, f())).toBe(false)
  })

  it('OFF changes nothing — a plain insight stays visible', () => {
    expect(isEntityVisible(plain, baseFilters())).toBe(true)
  })
})

describe('isEntityVisible — collapseSubComponents (architecture drill-down)', () => {
  // SubComponents are 63% of the condensed view and must NOT be rolled up —
  // they are structure, not knowledge. They collapse behind their Component
  // instead, which needs a parent lookup the predicate cannot do itself.
  const COMPONENT = 'comp-1'
  const parents = new Map([['sub-1', COMPONENT], ['sub-2', COMPONENT]])
  const f = (expanded: string[] = []) => baseFilters({
    collapseSubComponents: true,
    hierarchyParents: parents,
    expandedComponentIds: new Set(expanded),
    selectedClasses: new Set(['SubComponent', 'Component', 'Insight']),
  })
  const sub = (id: string) => ({ id, name: id, ontologyClass: 'SubComponent', metadata: {} }) as unknown as Entity

  it('hides a SubComponent while its Component is closed', () => {
    expect(isEntityVisible(sub('sub-1'), f())).toBe(false)
  })

  it('shows it once that Component is expanded', () => {
    expect(isEntityVisible(sub('sub-1'), f([COMPONENT]))).toBe(true)
  })

  it('expanding one Component does not open another', () => {
    const other = { id: 'sub-x', name: 'x', ontologyClass: 'SubComponent', metadata: {} } as unknown as Entity
    expect(isEntityVisible(other, f([COMPONENT]))).toBe(false)
  })

  it('hides a SubComponent with no resolvable parent — nothing could open it', () => {
    const orphan = { id: 'sub-orphan', name: 'ProgressFireTrigger', ontologyClass: 'SubComponent', metadata: {} } as unknown as Entity
    expect(isEntityVisible(orphan, f([COMPONENT]))).toBe(false)
  })

  it('leaves the Component itself alone', () => {
    const comp = { id: COMPONENT, name: 'LiveLoggingSystem', ontologyClass: 'Component', metadata: {} } as unknown as Entity
    expect(isEntityVisible(comp, f())).toBe(true)
  })

  it('OFF restores every SubComponent regardless of expansion', () => {
    expect(isEntityVisible(sub('sub-1'), baseFilters({
      collapseSubComponents: false,
      selectedClasses: new Set(['SubComponent']),
    }))).toBe(true)
  })
})

describe('isEntityVisible — hierarchy subtree focus', () => {
  const f = (ids: ReadonlySet<string> | null) =>
    baseFilters({
      hierarchySubtreeIds: ids,
      selectedClasses: new Set(['Insight', 'Component', 'Project', 'System']),
    })
  const ent = (id: string, ontologyClass: string) =>
    ({ id, name: id, ontologyClass, metadata: {} }) as unknown as Entity

  test('null admits everything — the filter is off, not empty', () => {
    expect(isEntityVisible(ent('anything', 'Insight'), f(null))).toBe(true)
  })

  test('a member is visible, a non-member is not', () => {
    const ids = new Set(['a', 'b'])
    expect(isEntityVisible(ent('a', 'Insight'), f(ids))).toBe(true)
    expect(isEntityVisible(ent('z', 'Insight'), f(ids))).toBe(false)
  })

  test('the structural backbone is NOT exempt', () => {
    // Every other id-set filter in this file exempts System/Project/Component
    // so the survivors stay anchored. This one must not: the anchors it wants
    // are already IN the set (the resolver walks them in), and exempting the
    // class would re-admit all 26 projects — the whole canvas the operator
    // just asked to narrow.
    const ids = new Set(['p-mine'])
    expect(isEntityVisible(ent('p-mine', 'Project'), f(ids))).toBe(true)
    expect(isEntityVisible(ent('p-other', 'Project'), f(ids))).toBe(false)
    expect(isEntityVisible(ent('c-other', 'Component'), f(ids))).toBe(false)
    expect(isEntityVisible(ent('s-other', 'System'), f(ids))).toBe(false)
  })

  test('an empty set hides everything rather than silently disabling itself', () => {
    // The store never writes one (a resolved set always holds the clicked row),
    // but "empty means everything" is the trap the LSL filter's `size > 0`
    // guard has — if an empty set ever arrives here it must not un-filter the
    // canvas behind the operator's back while the chip still says "focused".
    expect(isEntityVisible(ent('a', 'Insight'), f(new Set()))).toBe(false)
  })
})
