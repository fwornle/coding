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
import { resolveToVisibleAncestor, pickFirstResolvable } from './ancestry'
import type { Relation } from './types'

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
