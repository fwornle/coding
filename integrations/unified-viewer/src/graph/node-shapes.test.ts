// Plan 60-08 Task 1 (Gap C) — renderNodeShape unit tests.
//
// Renders into a real <g> via d3 over jsdom (the project's vitest env), then
// asserts the appended element tag + attributes per ontology class.

import { describe, it, expect, beforeEach } from 'vitest'
import * as d3 from 'd3'
import { renderNodeShape, SHAPE_RENDERERS, HEXAGON_PATH, DIAMOND_PATH } from './node-shapes'

function makeG() {
  const svg = d3.create('svg')
  return svg.append('g') as unknown as Parameters<typeof renderNodeShape>[1]
}

describe('renderNodeShape', () => {
  let g: ReturnType<typeof makeG>

  beforeEach(() => {
    g = makeG()
  })

  it('Test 1: Project → <path> with hexagon d', () => {
    const el = renderNodeShape({ ontologyClass: 'Project' }, g, 10)
    expect(el.node()!.tagName.toLowerCase()).toBe('path')
    expect(el.attr('d')).toBe(HEXAGON_PATH(10))
  })

  it('Test 2: System → <path> with hexagon d', () => {
    const el = renderNodeShape({ ontologyClass: 'System' }, g, 10)
    expect(el.node()!.tagName.toLowerCase()).toBe('path')
    expect(el.attr('d')).toBe(HEXAGON_PATH(10))
  })

  it('Test 3: Component → <rect>', () => {
    const el = renderNodeShape({ ontologyClass: 'Component' }, g, 10)
    expect(el.node()!.tagName.toLowerCase()).toBe('rect')
    expect(el.attr('width')).toBe('20')
    expect(el.attr('height')).toBe('20')
  })

  it('Test 4: SubComponent → <rect> (same as Component)', () => {
    const el = renderNodeShape({ ontologyClass: 'SubComponent' }, g, 10)
    expect(el.node()!.tagName.toLowerCase()).toBe('rect')
  })

  it('Test 5: Detail → <circle>', () => {
    const el = renderNodeShape({ ontologyClass: 'Detail' }, g, 10)
    expect(el.node()!.tagName.toLowerCase()).toBe('circle')
    expect(el.attr('r')).toBe('10')
  })

  it('Test 6: Insight → <path> with diamond d', () => {
    const el = renderNodeShape({ ontologyClass: 'Insight' }, g, 10)
    expect(el.node()!.tagName.toLowerCase()).toBe('path')
    expect(el.attr('d')).toBe(DIAMOND_PATH(10))
  })

  it('Test 7: Digest → <path> with diamond d', () => {
    const el = renderNodeShape({ ontologyClass: 'Digest' }, g, 10)
    expect(el.node()!.tagName.toLowerCase()).toBe('path')
    expect(el.attr('d')).toBe(DIAMOND_PATH(10))
  })

  it('Test 8 (defensive): unknown class → <circle> fallback', () => {
    const el = renderNodeShape({ ontologyClass: 'UnknownClass' }, g, 10)
    expect(el.node()!.tagName.toLowerCase()).toBe('circle')
  })

  it('Test 9 (defensive): undefined class → <circle> fallback', () => {
    const el = renderNodeShape({}, g, 10)
    expect(el.node()!.tagName.toLowerCase()).toBe('circle')
  })

  it('Test 10 (size): shape geometry scales with radius r', () => {
    const small = renderNodeShape({ ontologyClass: 'Component' }, makeG(), 5)
    const big = renderNodeShape({ ontologyClass: 'Component' }, makeG(), 20)
    expect(small.attr('width')).toBe('10')
    expect(big.attr('width')).toBe('40')
    // hexagon path differs by r
    expect(HEXAGON_PATH(5)).not.toBe(HEXAGON_PATH(20))
  })

  it('Test 11 (class hook): rendered shape carries class="node-shape"', () => {
    const el = renderNodeShape({ ontologyClass: 'Project' }, g, 10)
    expect(el.attr('class')).toBe('node-shape')
  })

  it('Test 12 (contract): entityType takes precedence over ontologyClass', () => {
    // CollectiveKnowledge case: ontologyClass=Detail but entityType=System →
    // must render the System hexagon, not a Detail circle.
    const el = renderNodeShape({ entityType: 'System', ontologyClass: 'Detail' }, g, 10)
    expect(el.node()!.tagName.toLowerCase()).toBe('path')
    expect(el.attr('d')).toBe(HEXAGON_PATH(10))
  })

  it('SHAPE_RENDERERS covers every ShapeKind', () => {
    expect(Object.keys(SHAPE_RENDERERS).sort()).toEqual(
      ['circle', 'diamond', 'hexagon', 'square', 'triangle'].sort(),
    )
  })
})
