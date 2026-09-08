import { describe, it, expect } from 'vitest'
import { canonicalizeRelationType, PROVENANCE_RELATION_TYPES } from './relation-types'

describe('canonicalizeRelationType', () => {
  it('folds space-separated LLM phrases into snake_case', () => {
    expect(canonicalizeRelationType('implemented in')).toBe('implemented_in')
    expect(canonicalizeRelationType('contributes to')).toBe('contributes_to')
    expect(canonicalizeRelationType('originally developed in')).toBe('originally_developed_in')
  })

  it('merges a free-text phrase with its existing snake_case twin', () => {
    // The whole point of #7: both must collapse to one key.
    expect(canonicalizeRelationType('implemented in')).toBe(canonicalizeRelationType('implemented_in'))
    expect(canonicalizeRelationType('contributes to')).toBe(canonicalizeRelationType('contributes_to'))
  })

  it('leaves established camelCase types untouched', () => {
    expect(canonicalizeRelationType('capturedBy')).toBe('capturedBy')
    expect(canonicalizeRelationType('derivedFrom')).toBe('derivedFrom')
  })

  it('leaves snake_case / single-word / hyphenated types untouched', () => {
    expect(canonicalizeRelationType('has_insight')).toBe('has_insight')
    expect(canonicalizeRelationType('related_to')).toBe('related_to')
    expect(canonicalizeRelationType('contains')).toBe('contains')
    expect(canonicalizeRelationType('mentions')).toBe('mentions')
    // parent-child is the writer's canonical hierarchy type — NOT a duplicate.
    expect(canonicalizeRelationType('parent-child')).toBe('parent-child')
  })

  it('handles trailing/leading whitespace and mixed case in phrases', () => {
    expect(canonicalizeRelationType('  Implemented In  ')).toBe('implemented_in')
  })

  it('is null/empty safe', () => {
    expect(canonicalizeRelationType(null)).toBe('')
    expect(canonicalizeRelationType(undefined)).toBe('')
    expect(canonicalizeRelationType('')).toBe('')
  })

  it('is idempotent', () => {
    const once = canonicalizeRelationType('implemented in')
    expect(canonicalizeRelationType(once)).toBe(once)
  })
})

describe('PROVENANCE_RELATION_TYPES', () => {
  it('names the two edge types that are 88% of the coding graph', () => {
    // 13,090 capturedBy + 9,284 mentions of 25,468 edges, measured 2026-09-08.
    // Widening this set is a real decision — every addition removes structure
    // from the default view — so the contents are locked here rather than left
    // to drift.
    expect([...PROVENANCE_RELATION_TYPES].sort()).toEqual(['capturedBy', 'mentions'])
  })

  it('holds types canonicalizeRelationType leaves alone', () => {
    // The store seeds `hiddenRelationTypes` with these, and the canvas matches
    // them against CANONICALIZED edge types. A member that canonicalized to
    // something else would hide nothing at all, silently.
    for (const t of PROVENANCE_RELATION_TYPES) {
      expect(canonicalizeRelationType(t)).toBe(t)
    }
  })
})
