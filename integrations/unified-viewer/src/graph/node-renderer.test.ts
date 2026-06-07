// Per-state stroke + edge style contract (UI-SPEC § Color State + § Color Edges).
// If the visual contract drifts in UI-SPEC, this file MUST update too.

import { describe, test, expect } from 'vitest'
import { nodeStrokeForState, edgeStateForRelation } from './node-renderer'

describe('nodeStrokeForState — UI-SPEC § Color State color overlays (lines 142-152)', () => {
  test('Test 1: default → 1px border, opacity 1.0', () => {
    expect(nodeStrokeForState('default')).toEqual({
      width: 1,
      color: 'hsl(var(--border))',
      opacity: 1.0,
    })
  })

  test('Test 2: selected → 3px primary, opacity 1.0, + 4px outer glow at 0.3 alpha', () => {
    const stroke = nodeStrokeForState('selected')
    expect(stroke).toEqual({
      width: 3,
      color: 'hsl(var(--primary))',
      opacity: 1.0,
      glow: { color: 'hsl(var(--primary)/0.3)', size: 4 },
    })
  })

  test('Test 3: search-match → 2px amber hsl(45, 100%, 50%) — the hardcoded non-token color', () => {
    expect(nodeStrokeForState('search-match')).toEqual({
      width: 2,
      color: 'hsl(45, 100%, 50%)',
      opacity: 1.0,
    })
  })

  test('Test 4: filter-dimmed → opacity 0.25', () => {
    const stroke = nodeStrokeForState('filter-dimmed')
    expect(stroke?.opacity).toBe(0.25)
    expect(stroke?.width).toBe(1)
    expect(stroke?.color).toBe('hsl(var(--border))')
  })

  test('Test 5: filter-hidden → null (caller decodes "do not render")', () => {
    expect(nodeStrokeForState('filter-hidden')).toBeNull()
  })
})

describe('edgeStateForRelation — UI-SPEC § Color Edges (line 152)', () => {
  test('Test 6a: incident on selected node → primary-incident style', () => {
    const s = edgeStateForRelation({ from: 'a', to: 'b' }, 'a')
    expect(s).toEqual({ color: 'hsl(var(--primary)/0.6)', opacity: 1.0 })

    const s2 = edgeStateForRelation({ from: 'a', to: 'b' }, 'b')
    expect(s2).toEqual({ color: 'hsl(var(--primary)/0.6)', opacity: 1.0 })
  })

  test('Test 6b: non-incident (selected=c) → default style', () => {
    const s = edgeStateForRelation({ from: 'a', to: 'b' }, 'c')
    expect(s).toEqual({ color: 'hsl(var(--border))', opacity: 0.5 })
  })

  test('Test 6c: both endpoints dimmed → dim-incident style', () => {
    const dimmed = new Set(['a', 'b'])
    const s = edgeStateForRelation({ from: 'a', to: 'b' }, null, dimmed)
    expect(s).toEqual({ color: 'hsl(var(--border))', opacity: 0.1 })
  })

  test('Test 6d: only one endpoint dimmed → default style', () => {
    const dimmed = new Set(['a'])
    const s = edgeStateForRelation({ from: 'a', to: 'b' }, null, dimmed)
    expect(s).toEqual({ color: 'hsl(var(--border))', opacity: 0.5 })
  })

  test('Test 6e: null selectedNodeId, no dimmed set → default style', () => {
    const s = edgeStateForRelation({ from: 'a', to: 'b' }, null)
    expect(s).toEqual({ color: 'hsl(var(--border))', opacity: 0.5 })
  })
})
