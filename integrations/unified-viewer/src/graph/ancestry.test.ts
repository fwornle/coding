// Phase 56 Plan 04 continuation 4 — phantom-id resolution unit tests.
//
// Direct tests for `resolveToVisibleAncestor` + `pickFirstResolvable`,
// the helpers that close the round-4 phantom-id bug. These are pure
// functions so jsdom is not needed; vitest's default node env is fine.
//
// Context: the D3 graph filters Observations/Digests/Details out of the
// rendered set. A non-graph writer (timeline tick, sidebar row) that
// holds a phantom (filtered) entity id MUST resolve up the hierarchy to
// the closest graph-visible ancestor BEFORE writing `selectedNodeId`.
// Locked in 56-PATTERNS.md contract #6.

import { describe, test, expect } from 'vitest'
import {
  resolveToVisibleAncestor,
  pickFirstResolvable,
  pickAllResolvable,
  computeAncestryPath,
} from './ancestry'
import type { Relation } from './types'

// Local helper — matches the inline `{ from, to, type }` literal style the
// existing Phase 56 tests use, just packaged for terseness.
function makeRel(from: string, to: string, type: string): Relation {
  return { from, to, type }
}

describe('resolveToVisibleAncestor — round-4 phantom-id resolution', () => {
  test('returns the entity id when it is already in the visible set', () => {
    const relations: Relation[] = []
    const visible = new Set<string>(['e1', 'e2'])
    expect(resolveToVisibleAncestor('e1', visible, relations)).toBe('e1')
  })

  test('walks one hop up to the closest visible ancestor', () => {
    const relations: Relation[] = [
      { from: 'parent', to: 'child', type: 'contains' },
    ]
    const visible = new Set<string>(['parent'])
    expect(resolveToVisibleAncestor('child', visible, relations)).toBe('parent')
  })

  test('walks multiple hops up — picks the deepest (closest) visible ancestor', () => {
    // Chain: root ← mid ← leaf. visible = {root, mid} — both ancestors
    // are visible. Must pick `mid` (closer) NOT `root`.
    const relations: Relation[] = [
      { from: 'mid', to: 'leaf', type: 'contains' },
      { from: 'root', to: 'mid', type: 'contains' },
    ]
    const visible = new Set<string>(['root', 'mid'])
    expect(resolveToVisibleAncestor('leaf', visible, relations)).toBe('mid')
  })

  test('returns null when no ancestor (and not the entity itself) is in the visible set', () => {
    const relations: Relation[] = [
      { from: 'parent', to: 'child', type: 'contains' },
    ]
    const visible = new Set<string>(['unrelated'])
    expect(resolveToVisibleAncestor('child', visible, relations)).toBeNull()
  })

  test('returns null when the entity has no relations and is not visible itself', () => {
    const relations: Relation[] = []
    const visible = new Set<string>(['something-else'])
    expect(resolveToVisibleAncestor('orphan', visible, relations)).toBeNull()
  })
})

describe('pickFirstResolvable — bucket walk → first resolvable wins', () => {
  test('returns the first entity that resolves to a visible ancestor', () => {
    const relations: Relation[] = [
      { from: 'parent-a', to: 'e1', type: 'contains' },
    ]
    const visible = new Set<string>(['parent-a'])
    // e1 resolves up to parent-a; e2 has no relations so does not resolve.
    expect(pickFirstResolvable(['e1', 'e2'], visible, relations)).toBe('parent-a')
  })

  test('skips entities that do not resolve and falls through to the next', () => {
    const relations: Relation[] = [
      { from: 'parent-b', to: 'e2', type: 'contains' },
    ]
    const visible = new Set<string>(['parent-b'])
    // e1 has no parent → not resolvable. e2 has parent-b → resolves.
    expect(pickFirstResolvable(['e1', 'e2'], visible, relations)).toBe('parent-b')
  })

  test('returns null when no entity in the bucket has any visible ancestor', () => {
    const relations: Relation[] = []
    const visible = new Set<string>(['unrelated'])
    expect(pickFirstResolvable(['orphan-1', 'orphan-2'], visible, relations)).toBeNull()
  })

  test('returns null on empty bucket (no entities to walk)', () => {
    const relations: Relation[] = []
    const visible = new Set<string>(['anything'])
    expect(pickFirstResolvable([], visible, relations)).toBeNull()
  })

  test('passes through a directly-visible entity without walking ancestors', () => {
    const relations: Relation[] = [
      { from: 'parent', to: 'e1', type: 'contains' },
    ]
    const visible = new Set<string>(['e1', 'parent'])
    // e1 is visible — must return e1, NOT walk up to parent.
    expect(pickFirstResolvable(['e1'], visible, relations)).toBe('e1')
  })
})

// Phase 56.1 D-2 — multi-resolution sibling of pickFirstResolvable.
//
// `pickAllResolvable` accumulates ALL ancestor resolutions into a Set
// (instead of stopping at the first non-null). Used as the touched-node
// predicate by the timeline strip's onTickClick (forward direction) and
// by useNodeToBucketsIndex (reverse-index pre-build).
describe('pickAllResolvable (Phase 56.1 D-2)', () => {
  test('returns set of visible-ancestor resolutions across multiple entityIds', () => {
    // Two inputs that BOTH resolve to visible ids:
    //   - 'a-visible' is itself visible → resolves to 'a-visible'
    //   - 'b-child'   has visible parent 'c' → resolves to 'c'
    const relations: Relation[] = [
      makeRel('c', 'b-child', 'contains'),
    ]
    const visible = new Set<string>(['a-visible', 'c'])
    const result = pickAllResolvable(['a-visible', 'b-child'], visible, relations)
    expect(result).toBeInstanceOf(Set)
    expect(result.size).toBe(2)
    expect(result.has('a-visible')).toBe(true)
    expect(result.has('c')).toBe(true)
  })

  test('dedup-collapses two entityIds that resolve to the same ancestor', () => {
    // Two children of the same parent — both resolve to 'parent'. Set
    // semantics collapse the duplicate.
    const relations: Relation[] = [
      makeRel('parent', 'child-1', 'contains'),
      makeRel('parent', 'child-2', 'contains'),
    ]
    const visible = new Set<string>(['parent'])
    const result = pickAllResolvable(['child-1', 'child-2'], visible, relations)
    expect(result.size).toBe(1)
    expect(result.has('parent')).toBe(true)
  })

  test('returns empty Set when no entityIds resolve', () => {
    // Two ids, neither visible, neither has a visible ancestor.
    const relations: Relation[] = []
    const visible = new Set<string>(['unrelated'])
    const result = pickAllResolvable(['orphan-1', 'orphan-2'], visible, relations)
    expect(result).toBeInstanceOf(Set)
    expect(result.size).toBe(0)
  })

  test('is order-independent (membership identical for any input permutation)', () => {
    const relations: Relation[] = [
      makeRel('p1', 'a', 'contains'),
      makeRel('p2', 'b', 'contains'),
    ]
    const visible = new Set<string>(['p1', 'p2'])
    const forward = pickAllResolvable(['a', 'b'], visible, relations)
    const reverse = pickAllResolvable(['b', 'a'], visible, relations)
    expect([...forward].sort()).toEqual([...reverse].sort())
    expect(forward.size).toBe(2)
  })

  // 2026-06-14 — Plan 06 gap-closure Decision C: LLS-suppression.
  describe('noiseAncestors suppression (Plan 06 Decision C — LLS)', () => {
    test('drops a noise ancestor from the result when the unsuppressed result has size >= 2', () => {
      const relations: Relation[] = [
        makeRel('lls', 'obs-1', 'capturedBy'), // Plan 06 — capturedBy direction
        makeRel('insight-1', 'obs-1', 'contains'),
      ]
      const visible = new Set<string>(['lls', 'insight-1'])
      const unsuppressed = pickAllResolvable(['obs-1'], visible, relations)
      // BFS-up from obs-1 via `contains` reaches insight-1. The fallback may
      // also reach lls (depending on whether BFS-up reached anything visible;
      // the WR-02 BFS now records every parent so lls also resolves via the
      // capturedBy edge when treated as a forward HIERARCHY edge). Both end
      // up in the result either way.
      expect(unsuppressed.size).toBeGreaterThanOrEqual(1)
      // With LLS in noiseAncestors AND unsuppressed.size >= 2, LLS is dropped.
      const relationsMulti: Relation[] = [
        makeRel('lls', 'obs-1', 'capturedBy'),
        makeRel('insight-1', 'obs-2', 'contains'),
      ]
      const visibleMulti = new Set<string>(['lls', 'insight-1'])
      const result = pickAllResolvable(
        ['obs-1', 'obs-2'],
        visibleMulti,
        relationsMulti,
        new Set<string>(['lls']),
      )
      // insight-1 stays; lls dropped because size >= 2 fires suppression.
      expect(result.has('insight-1')).toBe(true)
      expect(result.has('lls')).toBe(false)
    })

    test('preserves a noise ancestor when it is the ONLY resolved id (LLS-only buckets per Q1 option iii)', () => {
      const relations: Relation[] = [
        makeRel('lls', 'obs-1', 'capturedBy'),
      ]
      const visible = new Set<string>(['lls'])
      const result = pickAllResolvable(
        ['obs-1'],
        visible,
        relations,
        new Set<string>(['lls']),
      )
      // Suppression is gated on size >= 2; size === 1 keeps lls so the
      // bucket still produces a visible focal (Q1 operator decision).
      expect(result.has('lls')).toBe(true)
      expect(result.size).toBe(1)
    })

    test('undefined noiseAncestors is a no-op (backward compat with pre-Decision-C callers)', () => {
      const relations: Relation[] = [
        makeRel('lls', 'obs-1', 'capturedBy'),
        makeRel('insight-1', 'obs-2', 'contains'),
      ]
      const visible = new Set<string>(['lls', 'insight-1'])
      const result = pickAllResolvable(['obs-1', 'obs-2'], visible, relations)
      // No noiseAncestors → no suppression → both ids land in the result.
      expect(result.has('lls')).toBe(true)
      expect(result.has('insight-1')).toBe(true)
    })

    test('empty noiseAncestors set is also a no-op (size guard short-circuits)', () => {
      const relations: Relation[] = [
        makeRel('lls', 'obs-1', 'capturedBy'),
        makeRel('insight-1', 'obs-2', 'contains'),
      ]
      const visible = new Set<string>(['lls', 'insight-1'])
      const result = pickAllResolvable(
        ['obs-1', 'obs-2'],
        visible,
        relations,
        new Set<string>(),
      )
      expect(result.has('lls')).toBe(true)
      expect(result.has('insight-1')).toBe(true)
    })

    test('does NOT drop all members when every result id is in noiseAncestors (belt-and-braces guard)', () => {
      // Hypothetical: every resolved ancestor is in the noise set.
      // The inner `out.size >= 2` re-check inside the loop prevents the
      // result from collapsing to empty. At minimum one id survives.
      const relations: Relation[] = [
        makeRel('lls-a', 'obs-1', 'capturedBy'),
        makeRel('lls-b', 'obs-2', 'capturedBy'),
      ]
      const visible = new Set<string>(['lls-a', 'lls-b'])
      const noise = new Set<string>(['lls-a', 'lls-b'])
      const result = pickAllResolvable(['obs-1', 'obs-2'], visible, relations, noise)
      // First-iter suppression drops one (size goes 2→1); inner guard
      // refuses the second drop. Survives with exactly 1 element.
      expect(result.size).toBe(1)
    })
  })
})

// Phase 56.1 WR-02 — diamond/multi-parent hierarchy fix in computeAncestryPath.
//
// BEFORE the fix: `parentOf: Map<string, string>` (first-parent-wins) +
// linear walk along the first-parent chain. Secondary parent edges were
// hidden from `edges`, secondary ancestors hidden from `nodeDepths`,
// and `resolveToVisibleAncestor` returned null when only the secondary
// parent led to a visible ancestor.
//
// AFTER the fix: BFS records EVERY parent edge during the walk and
// depth-tracks every BFS-visited node. Diamond children expose both
// parent edges in the trace, and resolveToVisibleAncestor reaches
// secondary-parent ancestors transparently.
describe('computeAncestryPath WR-02 diamond fix', () => {
  test('records both parent edges in a diamond hierarchy', () => {
    // Diamond: P1 and P2 both contain N.
    const relations: Relation[] = [
      makeRel('P1', 'N', 'contains'),
      makeRel('P2', 'N', 'contains'),
    ]
    const result = computeAncestryPath('N', relations)
    // Both parent->child AND child->parent keys (each direction).
    expect(result.edges.has('P1||N')).toBe(true)
    expect(result.edges.has('N||P1')).toBe(true)
    expect(result.edges.has('P2||N')).toBe(true)
    expect(result.edges.has('N||P2')).toBe(true)
  })

  test('BFS visits all parents (diamond — nodeDepths includes P1 and P2)', () => {
    const relations: Relation[] = [
      makeRel('P1', 'N', 'contains'),
      makeRel('P2', 'N', 'contains'),
    ]
    const result = computeAncestryPath('N', relations)
    expect(result.nodeDepths.has('P1')).toBe(true)
    expect(result.nodeDepths.has('P2')).toBe(true)
    // Selected node is depth 0; both parents depth 1.
    expect(result.nodeDepths.get('N')).toBe(0)
    expect(result.nodeDepths.get('P1')).toBe(1)
    expect(result.nodeDepths.get('P2')).toBe(1)
    expect(result.pathLength).toBe(1)
  })

  test('resolveToVisibleAncestor reaches diamond ancestor via secondary parent (WR-02 regression)', () => {
    // Diamond: P1 and P2 both contain N. Only P2 is visible.
    // Pre-fix: linear walk chose first parent (insertion order — P1) and
    // the function returned null because P1 isn't visible. Post-fix:
    // BFS visits both P1 and P2; P2 is visible so we return 'P2'.
    const relations: Relation[] = [
      makeRel('P1', 'N', 'contains'),
      makeRel('P2', 'N', 'contains'),
    ]
    const visible = new Set<string>(['P2'])
    expect(resolveToVisibleAncestor('N', visible, relations)).toBe('P2')
  })
})

// Phase 56.1 — 1-hop fallback regression. The orphan-node branch at
// ancestry.ts (post-fix line numbering: ~89-102) must STILL fire when
// pathLength === 0. The fix renamed the local `depth` accumulator to
// `pathLength` for return-shape consistency; this test guards the rename.
describe('computeAncestryPath 1-hop fallback (Phase 56-04 regression)', () => {
  test('1-hop neighborhood fallback fires when no HIERARCHY_TYPES ancestor exists', () => {
    // 'X' has only a non-HIERARCHY edge ('related_to' is NOT in
    // HIERARCHY_TYPES). pathLength should fall through the hierarchy BFS
    // (still 0 after) and trigger the 1-hop fallback.
    const relations: Relation[] = [
      makeRel('X', 'Y', 'related_to'),
    ]
    const result = computeAncestryPath('X', relations)
    expect(result.pathLength).toBe(1)
    expect(result.nodeDepths.size).toBeGreaterThan(1)
    expect(result.nodeDepths.has('Y')).toBe(true)
    expect(result.edges.has('X||Y')).toBe(true)
    expect(result.edges.has('Y||X')).toBe(true)
  })
})
