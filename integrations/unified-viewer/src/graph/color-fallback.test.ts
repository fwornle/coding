// Pinning test for the FNV-1a → HSL → hex fallback formula.
// Drift in the FNV hash MUST fail this test — node identity color depends on
// byte-identical hue derivation across releases (D-45-03 fallback).
//
// Output format is hex (#rrggbb) — Sigma's WebGL color parser silently
// rejects `hsl(...)` strings, so the UI-SPEC § Color HSL contract is honored
// perceptually via hslToHex conversion while the test pins the upstream hue.

import { describe, test, expect } from 'vitest'
import { classColor, _classHue } from './color-fallback'

// Re-derive the expected hue inline (matches UI-SPEC § Color lines 122-137).
function expectedHue(name: string): number {
  let h = 2166136261
  for (let i = 0; i < name.length; i++) {
    h = (h ^ name.charCodeAt(i)) * 16777619
    h = h >>> 0
  }
  return h % 360
}

// hslToHex mirrors the implementation — keep in sync.
function hslToHexExpected(h: number, s: number, l: number): string {
  const sn = s / 100
  const ln = l / 100
  const a = sn * Math.min(ln, 1 - ln)
  const f = (n: number): number => {
    const k = (n + h / 30) % 12
    const c = ln - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))
    return Math.round(c * 255)
  }
  const toHex = (x: number): string => x.toString(16).padStart(2, '0')
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`
}

describe('classColor — FNV-1a → hex fallback (UI-SPEC § Color lines 122-137)', () => {
  test('Test 1: Observation dark → hslToHex(<H>, 65%, 60%)', () => {
    const expected = hslToHexExpected(expectedHue('Observation'), 65, 60)
    expect(classColor('Observation', 'dark')).toBe(expected)
  })

  test('Test 2: Observation light → hslToHex(<H>, 55%, 45%) — same H, different S/L', () => {
    const expected = hslToHexExpected(expectedHue('Observation'), 55, 45)
    expect(classColor('Observation', 'light')).toBe(expected)
  })

  test('Test 3: distinct class names produce distinct hues (and therefore distinct hex)', () => {
    const names = ['Observation', 'Digest', 'Insight', 'Pattern', 'RootCause']
    const hues = new Set(names.map((n) => _classHue(n)))
    expect(hues.size).toBeGreaterThan(1)
    for (const n of names) {
      expect(classColor(n, 'dark')).toBe(hslToHexExpected(_classHue(n), 65, 60))
    }
  })

  test('Test 4: empty string does not throw, returns valid hex', () => {
    expect(() => classColor('', 'dark')).not.toThrow()
    expect(classColor('', 'dark')).toBe(hslToHexExpected(_classHue(''), 65, 60))
  })

  test('Test 5: output format matches /^#[0-9a-f]{6}$/', () => {
    const rx = /^#[0-9a-f]{6}$/
    for (const name of ['Observation', 'Digest', 'X', '', 'AVeryLongClassNameThatExercisesTheLoop']) {
      expect(classColor(name, 'dark')).toMatch(rx)
      expect(classColor(name, 'light')).toMatch(rx)
    }
  })
})
