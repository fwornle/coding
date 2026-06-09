// Per-state stroke + edge style contract (UI-SPEC § Color State + § Color Edges).
// If the visual contract drifts in UI-SPEC, this file MUST update too.

import { describe, test, expect } from 'vitest'
import {
  nodeStrokeForState,
  edgeStateForRelation,
  evaluatePulseRule,
} from './node-renderer'
import type { Entity } from './types'

describe('nodeStrokeForState — Plan 04 round 2: hex palette (sigma WebGL cannot parse hsl(var(--*)))', () => {
  test('Test 1: default → 1px slate-300 border, opacity 1.0', () => {
    expect(nodeStrokeForState('default')).toEqual({
      width: 1,
      color: '#cbd5e1',
      opacity: 1.0,
    })
  })

  test('Test 2: selected → 3px blue-500 stroke, opacity 1.0, + 4px outer glow', () => {
    const stroke = nodeStrokeForState('selected')
    expect(stroke).toEqual({
      width: 3,
      color: '#3b82f6',
      opacity: 1.0,
      glow: { color: '#3b82f64d', size: 4 },
    })
  })

  test('Test 3: search-match → 2px amber-500 stroke', () => {
    expect(nodeStrokeForState('search-match')).toEqual({
      width: 2,
      color: '#f59e0b',
      opacity: 1.0,
    })
  })

  test('Test 4: filter-dimmed → opacity 0.25', () => {
    const stroke = nodeStrokeForState('filter-dimmed')
    expect(stroke?.opacity).toBe(0.25)
    expect(stroke?.width).toBe(1)
    expect(stroke?.color).toBe('#cbd5e1')
  })

  test('Test 5: filter-hidden → null (caller decodes "do not render")', () => {
    expect(nodeStrokeForState('filter-hidden')).toBeNull()
  })
})

describe('edgeStateForRelation — Plan 03 round 2 hex palette (sigma WebGL cannot parse hsl(var(--*)))', () => {
  test('Test 6a: incident on selected node → primary blue, opacity 1.0', () => {
    const s = edgeStateForRelation({ from: 'a', to: 'b' }, 'a')
    expect(s).toEqual({ color: '#3b82f6', opacity: 1.0 })

    const s2 = edgeStateForRelation({ from: 'a', to: 'b' }, 'b')
    expect(s2).toEqual({ color: '#3b82f6', opacity: 1.0 })
  })

  test('Test 6b: non-incident (selected=c) → default slate, opacity 0.6', () => {
    const s = edgeStateForRelation({ from: 'a', to: 'b' }, 'c')
    expect(s).toEqual({ color: '#cbd5e1', opacity: 0.6 })
  })

  test('Test 6c: both endpoints dimmed → near-invisible slate, opacity 0.15', () => {
    const dimmed = new Set(['a', 'b'])
    const s = edgeStateForRelation({ from: 'a', to: 'b' }, null, dimmed)
    expect(s).toEqual({ color: '#cbd5e1', opacity: 0.15 })
  })

  test('Test 6d: only one endpoint dimmed → default slate', () => {
    const dimmed = new Set(['a'])
    const s = edgeStateForRelation({ from: 'a', to: 'b' }, null, dimmed)
    expect(s).toEqual({ color: '#cbd5e1', opacity: 0.6 })
  })

  test('Test 6e: null selectedNodeId, no dimmed set → default slate', () => {
    const s = edgeStateForRelation({ from: 'a', to: 'b' }, null)
    expect(s).toEqual({ color: '#cbd5e1', opacity: 0.6 })
  })
})

// -----------------------------------------------------------------------
// Plan 55-05: borderStyle + halo extensions to StrokeStyle, plus the
// `evaluatePulseRule` pure function. UI-SPEC §12 + §14.
// -----------------------------------------------------------------------

describe('nodeStrokeForState — Plan 55-05 borderStyle + halo extensions', () => {
  test('default + borderStyle=dashed → stroke carries borderStyle:dashed', () => {
    const stroke = nodeStrokeForState('default', 'dashed')
    expect(stroke).not.toBeNull()
    expect(stroke?.borderStyle).toBe('dashed')
    // Base style preserved (UI-SPEC §14 rule #4 is a border-style overlay,
    // not a color/width overlay)
    expect(stroke?.color).toBe('#cbd5e1')
    expect(stroke?.width).toBe(1)
  })

  test('default with no extension params → borderStyle defaults to solid (BC)', () => {
    const stroke = nodeStrokeForState('default')
    expect(stroke).not.toBeNull()
    // Default = solid (UI-SPEC §14 rule #4: 'solid' unless overlay or
    // orphan flips it)
    expect(stroke?.borderStyle).toBe('solid')
    expect(stroke?.halo).toBeUndefined()
  })

  test('pulseRuleResult=true → stroke carries halo with phase 0..1', () => {
    const stroke = nodeStrokeForState('default', 'solid', true)
    expect(stroke).not.toBeNull()
    expect(stroke?.halo).toBeDefined()
    // halo.color tracks the per-state base color (UI-SPEC §12: "node fill at 50% alpha"
    // is wired in SigmaCanvas via the color; node-renderer hands it the base color).
    expect(stroke?.halo?.color).toBe('#cbd5e1')
    // phase = (Date.now() % 1500) / 1500 — bound to [0, 1)
    expect(stroke?.halo?.phase).toBeGreaterThanOrEqual(0)
    expect(stroke?.halo?.phase).toBeLessThan(1)
  })

  test('pulseRuleResult=false → no halo', () => {
    const stroke = nodeStrokeForState('selected', 'solid', false)
    expect(stroke?.halo).toBeUndefined()
  })

  test('filter-hidden state remains null regardless of borderStyle/halo', () => {
    expect(nodeStrokeForState('filter-hidden', 'dashed', true)).toBeNull()
  })
})

describe('evaluatePulseRule — Plan 55-05 (UI-SPEC §12)', () => {
  // Minimal entity factory — the helper only reads `updatedAt` and
  // `metadata.occurrences[].timestamp`.
  function mkEntity(over: Partial<Entity>): Entity {
    return {
      id: 'e',
      name: 'Eve',
      ontologyClass: 'Observation',
      ...over,
    } as Entity
  }

  test('null rule → false (no pulse)', () => {
    expect(evaluatePulseRule(null, mkEntity({}))).toBe(false)
  })

  test('lastUpdatedWithin:60s — updatedAt 30s ago → true', () => {
    const e = mkEntity({ updatedAt: new Date(Date.now() - 30_000).toISOString() })
    expect(evaluatePulseRule('lastUpdatedWithin:60s', e)).toBe(true)
  })

  test('lastUpdatedWithin:60s — updatedAt 61s ago → false', () => {
    const e = mkEntity({ updatedAt: new Date(Date.now() - 61_000).toISOString() })
    expect(evaluatePulseRule('lastUpdatedWithin:60s', e)).toBe(false)
  })

  test('lastUpdatedWithin:5m — parses 5m correctly (300_000ms)', () => {
    // 4m59s ago → within 5m
    const eIn = mkEntity({ updatedAt: new Date(Date.now() - 299_000).toISOString() })
    expect(evaluatePulseRule('lastUpdatedWithin:5m', eIn)).toBe(true)
    // 5m01s ago → outside 5m
    const eOut = mkEntity({ updatedAt: new Date(Date.now() - 301_000).toISOString() })
    expect(evaluatePulseRule('lastUpdatedWithin:5m', eOut)).toBe(false)
  })

  test('recentlyMerged:1h — occurrence 1s ago → true', () => {
    const e = mkEntity({
      metadata: {
        occurrences: [
          { timestamp: new Date(Date.now() - 1_000).toISOString() },
        ],
      },
    })
    expect(evaluatePulseRule('recentlyMerged:1h', e)).toBe(true)
  })

  test('recentlyMerged:1h — occurrence 2h ago → false', () => {
    const e = mkEntity({
      metadata: {
        occurrences: [
          { timestamp: new Date(Date.now() - 2 * 3_600_000).toISOString() },
        ],
      },
    })
    expect(evaluatePulseRule('recentlyMerged:1h', e)).toBe(false)
  })

  test('recentlyMerged:1h — empty / missing occurrences → false', () => {
    expect(evaluatePulseRule('recentlyMerged:1h', mkEntity({}))).toBe(false)
    expect(
      evaluatePulseRule(
        'recentlyMerged:1h',
        mkEntity({ metadata: { occurrences: [] } }),
      ),
    ).toBe(false)
  })

  test('unknown rule → false (silently, no throw — T-55-05-02 mitigation)', () => {
    expect(evaluatePulseRule('unknownRule', mkEntity({}))).toBe(false)
    expect(evaluatePulseRule('lastUpdatedWithin:42y', mkEntity({}))).toBe(false)
  })

  test('missing updatedAt → false (no spurious true from 1970 epoch math)', () => {
    // If updatedAt is absent, "now - 0" would be > any window — we must
    // guard against that. False is the safe choice.
    const e = mkEntity({})
    expect(evaluatePulseRule('lastUpdatedWithin:60s', e)).toBe(false)
  })
})
