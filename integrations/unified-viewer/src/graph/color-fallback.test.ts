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
import {
  classColor,
  _classHue,
  shapeFallback,
  borderStyleFallback,
  pulseRuleFallback,
} from './color-fallback'

describe('classColor — ontology palette', () => {
  test('hierarchy classes use the VKB-reference teal/blue palette (2026-06-11)', () => {
    // BATCH_PALETTE in color-fallback.ts — Project=teal, descending blue
    // shades by hierarchy depth, System=teal-800.
    expect(classColor('System', 'dark')).toBe('#00695c')
    expect(classColor('Project', 'dark')).toBe('#00897b')
    expect(classColor('Component', 'dark')).toBe('#1565c0')
    expect(classColor('SubComponent', 'dark')).toBe('#42a5f5')
    expect(classColor('Detail', 'dark')).toBe('#90caf9')
  })

  test('typed-views classes fall back to slate (amber scale removed 2026-06-11)', () => {
    // The amber typed-views scale was removed; non-hierarchy classes now
    // fall back to DEFAULT_BATCH (slate-400).
    expect(classColor('Observation', 'light')).toBe('#94a3b8')
    expect(classColor('Digest', 'light')).toBe('#94a3b8')
    expect(classColor('Insight', 'light')).toBe('#94a3b8')
    expect(classColor('LearningArtifact', 'light')).toBe('#94a3b8')
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

// -----------------------------------------------------------------------
// Plan 55-05: shape / borderStyle / pulseRule fallback helpers (UI-SPEC §14).
//
// These mirror `classColor` — they consult an internal palette keyed on
// ontology class name; unknown classes fall back to the documented default.
// The full 16-class table from UI-SPEC §14 must be honored verbatim.
// -----------------------------------------------------------------------

describe('shapeFallback — Plan 55-05 (UI-SPEC §14 table verbatim)', () => {
  test('hierarchy classes map to their UI-SPEC §14 shapes', () => {
    // Project=hexagon, Component=square, SubComponent=square, Detail=circle
    expect(shapeFallback('Project')).toBe('hexagon')
    expect(shapeFallback('Component')).toBe('square')
    expect(shapeFallback('SubComponent')).toBe('square')
    expect(shapeFallback('Detail')).toBe('circle')
  })

  test('typed-views classes map to their UI-SPEC §14 shapes', () => {
    expect(shapeFallback('Observation')).toBe('circle')
    expect(shapeFallback('Digest')).toBe('diamond')
    expect(shapeFallback('Insight')).toBe('diamond')
    expect(shapeFallback('LearningArtifact')).toBe('diamond')
    expect(shapeFallback('Pattern')).toBe('diamond')
  })

  test('infrastructure + business classes map to their UI-SPEC §14 shapes', () => {
    expect(shapeFallback('Service')).toBe('square')
    expect(shapeFallback('File')).toBe('square')
    expect(shapeFallback('Feature')).toBe('hexagon')
    expect(shapeFallback('Contract')).toBe('square')
    expect(shapeFallback('RuntimeDiagnostics')).toBe('triangle')
    expect(shapeFallback('System')).toBe('hexagon')
    expect(shapeFallback('Knowledge')).toBe('circle')
  })

  test('unknown classes fall back to circle (UI-SPEC §14 rule 2)', () => {
    expect(shapeFallback('UnknownClass')).toBe('circle')
    expect(shapeFallback('')).toBe('circle')
    expect(shapeFallback('SomeFutureType')).toBe('circle')
  })
})

describe('borderStyleFallback — Plan 55-05 (UI-SPEC §14 rule 4)', () => {
  test('node WITH relations → solid border', () => {
    expect(borderStyleFallback('Component', true)).toBe('solid')
    expect(borderStyleFallback('Observation', true)).toBe('solid')
    // Class name is irrelevant — only the hasRelations flag matters.
    expect(borderStyleFallback('UnknownClass', true)).toBe('solid')
  })

  test('orphan node (zero relations) → dashed border', () => {
    expect(borderStyleFallback('Component', false)).toBe('dashed')
    expect(borderStyleFallback('Observation', false)).toBe('dashed')
    expect(borderStyleFallback('UnknownClass', false)).toBe('dashed')
  })
})

describe('pulseRuleFallback — Plan 55-05 (UI-SPEC §14 rule 5)', () => {
  test('returns null for every known class — pulse is overlay-driven only', () => {
    // The fallback path means "no overlay was provided" — by spec, no
    // pulse rule unless the overlay opts in.
    expect(pulseRuleFallback('Observation')).toBeNull()
    expect(pulseRuleFallback('RuntimeDiagnostics')).toBeNull()
    expect(pulseRuleFallback('Component')).toBeNull()
  })

  test('returns null for unknown classes too', () => {
    expect(pulseRuleFallback('UnknownClass')).toBeNull()
    expect(pulseRuleFallback('')).toBeNull()
  })
})
