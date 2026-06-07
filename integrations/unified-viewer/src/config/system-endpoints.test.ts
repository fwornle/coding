// PATTERN SOURCE: 45-01-PLAN.md Task 2 <behavior> Test 1
//
// Type-guard narrows accepted strings; everything else returns false.
import { describe, test, expect } from 'vitest'
import { isValidSystem, SYSTEM_ENDPOINTS, SYSTEM_LABELS, VALID_SYSTEMS } from './system-endpoints'

describe('isValidSystem type-guard', () => {
  test('accepts "coding"', () => {
    expect(isValidSystem('coding')).toBe(true)
  })

  test('accepts "okb"', () => {
    expect(isValidSystem('okb')).toBe(true)
  })

  test('accepts "cap"', () => {
    expect(isValidSystem('cap')).toBe(true)
  })

  test('rejects unknown slugs', () => {
    expect(isValidSystem('foo')).toBe(false)
    expect(isValidSystem('CODING')).toBe(false)
    expect(isValidSystem('')).toBe(false)
    expect(isValidSystem(undefined)).toBe(false)
  })

  test('SYSTEM_ENDPOINTS has an entry for each valid system', () => {
    for (const slug of VALID_SYSTEMS) {
      expect(SYSTEM_ENDPOINTS[slug]).toMatch(/^https?:\/\//)
    }
  })

  test('SYSTEM_LABELS has a label for each valid system', () => {
    expect(SYSTEM_LABELS.coding).toBe('Coding')
    expect(SYSTEM_LABELS.okb).toBe('OKB')
    expect(SYSTEM_LABELS.cap).toBe('CAP')
  })
})
