// Pinning test for the FNV-1a → HSL fallback formula.
// Drift in the formula MUST fail this test — operator color identity depends
// on byte-identical output across releases (D-45-03 fallback).

import { describe, test, expect } from 'vitest'
import { classColor } from './color-fallback'

// Re-derive the expected hue inline so the test catches accidental formula
// drift WITHOUT hardcoding magic numbers (which would re-derive the test
// from the implementation it's meant to police).
function expectedHue(name: string): number {
  let h = 2166136261
  for (let i = 0; i < name.length; i++) {
    h = (h ^ name.charCodeAt(i)) * 16777619
    h = h >>> 0
  }
  return h % 360
}

describe('classColor — FNV-1a HSL fallback (UI-SPEC § Color lines 122-137)', () => {
  test('Test 1: Observation dark → hsl(<H>, 65%, 60%) using FNV-1a', () => {
    const expected = `hsl(${expectedHue('Observation')}, 65%, 60%)`
    expect(classColor('Observation', 'dark')).toBe(expected)
  })

  test('Test 2: Observation light → hsl(<H>, 55%, 45%) — same H, different S/L', () => {
    const expected = `hsl(${expectedHue('Observation')}, 55%, 45%)`
    expect(classColor('Observation', 'light')).toBe(expected)
  })

  test('Test 3: distinct class names produce distinct hues', () => {
    // 5 canonical class names. They MUST NOT all collide; FNV-1a + mod-360
    // gives uniform distribution (collisions allowed but vanishingly rare here).
    const names = ['Observation', 'Digest', 'Insight', 'Pattern', 'RootCause']
    const hues = new Set(names.map((n) => expectedHue(n)))
    expect(hues.size).toBeGreaterThan(1)
    // Cross-check the function output matches the inline derivation
    for (const n of names) {
      expect(classColor(n, 'dark')).toBe(`hsl(${expectedHue(n)}, 65%, 60%)`)
    }
  })

  test('Test 4: empty string does not throw, returns valid hsl(0, 65%, 60%)', () => {
    // Empty input → FNV-1a offset basis (2166136261) % 360 = ?
    // We re-derive inline rather than hardcode the actual hue.
    const expected = `hsl(${expectedHue('')}, 65%, 60%)`
    expect(() => classColor('', 'dark')).not.toThrow()
    expect(classColor('', 'dark')).toBe(expected)
  })

  test('Test 5: output format matches /^hsl\\(\\d{1,3}, \\d{1,3}%, \\d{1,3}%\\)$/', () => {
    const rx = /^hsl\(\d{1,3}, \d{1,3}%, \d{1,3}%\)$/
    for (const name of ['Observation', 'Digest', 'X', '', 'AVeryLongClassNameThatExercisesTheLoop']) {
      expect(classColor(name, 'dark')).toMatch(rx)
      expect(classColor(name, 'light')).toMatch(rx)
    }
  })
})
