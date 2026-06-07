// Per-state stroke + edge style contract (UI-SPEC § Color State + § Color Edges).
// If the visual contract drifts in UI-SPEC, this file MUST update too.

import { describe, test, expect } from 'vitest'
import { nodeStrokeForState, edgeStateForRelation } from './node-renderer'

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
