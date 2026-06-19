import { describe, it, expect } from 'vitest'
import { canonicalizeRelationType } from './relation-types'

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
