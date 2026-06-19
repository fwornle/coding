// Plan 60-08 Gap E — D3GraphCanvas hover wiring source-grep gates.
//
// D3GraphCanvas is NOT rendered in jsdom (d3.forceSimulation + zoom need a real
// layout engine jsdom lacks — see D3GraphCanvas.test.ts header). The in-tree
// idiom for this file is a readFileSync + regex assertion. These gates lock the
// hover contract: data-node-id hook, mouseenter/mouseleave → setHoveredNodeId,
// the is-hovered class-toggle effect keyed ONLY on hoveredNodeId (so hover never
// triggers relayout/zoom — Phase 56 viewport-stability invariant), and the CSS
// pulse keyframes in the global stylesheet.

import { describe, test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const SRC = readFileSync(
  path.resolve(process.cwd(), 'src/graph/D3GraphCanvas.tsx'),
  'utf8',
)
const CSS = readFileSync(path.resolve(process.cwd(), 'src/index.css'), 'utf8')

describe('D3GraphCanvas — Gap E hover source-grep gates', () => {
  test('G-E1: node selection carries a data-node-id hook', () => {
    expect(SRC).toMatch(/\.attr\(\s*['"]data-node-id['"]\s*,\s*\(d\)\s*=>\s*d\.id\s*\)/)
  })

  test('G-E2: mouseenter publishes the hovered id via setHoveredNodeId(d.id)', () => {
    expect(SRC).toMatch(/\.on\(\s*['"]mouseenter['"]/)
    expect(SRC).toMatch(/setHoveredNodeId\(d\.id\)/)
  })

  test('G-E3: mouseleave clears the hovered id (setHoveredNodeId(null))', () => {
    expect(SRC).toMatch(/\.on\(\s*['"]mouseleave['"]/)
    expect(SRC).toMatch(/setHoveredNodeId\(null\)/)
  })

  test('G-E4: an effect toggles the is-hovered class on the matching .node-shape', () => {
    expect(SRC).toMatch(/classed\(\s*['"]is-hovered['"]/)
    expect(SRC).toMatch(/\.filter\(\(d\)\s*=>\s*d\.id\s*===\s*hoveredNodeId\)/)
  })

  test('G-E5: the hover effect is keyed ONLY on [hoveredNodeId] (no relayout/zoom)', () => {
    // The dependency array immediately following the is-hovered effect must be
    // exactly [hoveredNodeId] — listing data/selection fields would rebuild the
    // SVG on hover (Phase 56 viewport-stability invariant).
    expect(SRC).toMatch(/classed\('is-hovered', true\)[\s\S]*?\n\s*\}, \[hoveredNodeId\]\)/)
  })

  test('G-E6: hover handlers write ONLY via the setHoveredNodeId store action', () => {
    expect(SRC).toMatch(/useViewerStore\.getState\(\)\.setHoveredNodeId/)
  })

  test('G-E7: global CSS defines the node-pulse keyframes + .is-hovered rule', () => {
    expect(CSS).toMatch(/@keyframes\s+node-pulse/)
    expect(CSS).toMatch(/\.node-shape\.is-hovered/)
  })
})
