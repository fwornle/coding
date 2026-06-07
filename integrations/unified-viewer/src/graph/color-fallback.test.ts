// Pinning test for the ontology→color palette.
//
// Plan 03 checkpoint replaced the randomized FNV-1a hue scheme with a
// curated hierarchy palette (blue for structural hierarchy, amber for
// typed-views / runtime, slate for unknown). The test asserts:
//   1. Known classes map to specific hex values (drift breaks color
//      contract; intentional palette changes update the test too).
//   2. Unknown classes fall back to slate-400.
//   3. All outputs match /^#[0-9a-f]{6}$/.

import { describe, test, expect } from 'vitest'
import { classColor, _classHue } from './color-fallback'

describe('classColor — ontology palette', () => {
  test('hierarchy classes get progressively-lighter blues', () => {
    expect(classColor('System', 'dark')).toBe('#1e3a8a')
    expect(classColor('Project', 'dark')).toBe('#1d4ed8')
    expect(classColor('Component', 'dark')).toBe('#3b82f6')
    expect(classColor('SubComponent', 'dark')).toBe('#60a5fa')
    expect(classColor('Detail', 'dark')).toBe('#93c5fd')
  })

  test('typed-views classes get an amber scale', () => {
    expect(classColor('Observation', 'light')).toBe('#f59e0b')
    expect(classColor('Digest', 'light')).toBe('#b45309')
    expect(classColor('Insight', 'light')).toBe('#7c2d12')
    expect(classColor('LearningArtifact', 'light')).toBe('#854d0e')
  })

  test('unknown classes fall back to slate-400', () => {
    expect(classColor('WhateverNewClassName', 'dark')).toBe('#94a3b8')
    expect(classColor('', 'light')).toBe('#94a3b8')
  })

  test('theme is reserved but does not affect output today', () => {
    expect(classColor('Component', 'dark')).toBe(classColor('Component', 'light'))
  })

  test('output format is /^#[0-9a-f]{6}$/', () => {
    const rx = /^#[0-9a-f]{6}$/
    for (const name of ['System', 'Component', 'Observation', 'Unknown', '']) {
      expect(classColor(name, 'dark')).toMatch(rx)
      expect(classColor(name, 'light')).toMatch(rx)
    }
  })

  test('_classHue helper remains deterministic (FNV-1a 32-bit % 360)', () => {
    expect(_classHue('Observation')).toBe(_classHue('Observation'))
    expect(_classHue('A')).not.toBe(_classHue('B'))
  })
})
