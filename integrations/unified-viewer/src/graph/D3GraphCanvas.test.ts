// D3GraphCanvas Phase 56 source-grep gates.
//
// We do NOT render D3GraphCanvas in jsdom — d3.forceSimulation + the
// zoomBehavior pan-to-node primitive require a real SVG layout engine that
// jsdom doesn't ship (Layout, getBoundingClientRect, getCTM are all stubs).
// Per 56-PATTERNS.md the in-tree gate idiom for this file is a **source
// readFileSync + regex** assertion (mirrors LslTimelineStrip.test.tsx:271-277
// Logger-discipline gate), which is exactly what locks the four Phase 56
// invariants on D3GraphCanvas:
//
//   1. Node click writes the 5-field atomic Phase 56 payload (selectedNodeId,
//      pathToSelected reset, highlightedRowKey, selectionSource: 'graph',
//      selectedSessionId: null).
//   2. Background click goes through useViewerStore.getState().clearSelection()
//      (single store action — no partial setState).
//   3. A centering useEffect exists that pans on selectedNodeId change AND
//      bails when selectionSource === 'graph' (loop-safety).
//   4. The MAIN useEffect dep list at lines 599-606 still OMITS selectedNodeId
//      — listing it there would rebuild the SVG + restart the force simulation
//      on every click (the comment-block invariant the file has carried since
//      Phase 45).
//
// Logger discipline is also gate-tested (zero console.* in the source) per
// PATTERNS.md "Phase 56 must add the same gate".

import { describe, test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SOURCE_PATH = resolve(process.cwd(), 'src/graph/D3GraphCanvas.tsx')
const src = readFileSync(SOURCE_PATH, 'utf8')

describe('D3GraphCanvas — Phase 56 source-grep gates', () => {
  test('Phase 56 G1: node click payload includes selectionSource: "graph"', () => {
    // Single-quoted form is the in-tree convention (LslTimelineStrip.tsx
    // writes selectionSource: 'timeline' in plain quotes).
    expect(src).toMatch(/selectionSource:\s*'graph'/)
  })

  test('Phase 56 G2: node click payload includes highlightedRowKey: d.id', () => {
    expect(src).toMatch(/highlightedRowKey:\s*d\.id/)
  })

  test('Phase 56 G3: node click payload includes selectedSessionId: null (graph click is not session-scoped)', () => {
    // Match within the node onClick block (which writes selectedNodeId: d.id)
    // — selectedSessionId: null elsewhere would not be a hit because the only
    // other place null lands is clearSelection, and clearSelection is a store
    // action (declared in viewer-store.ts, not D3GraphCanvas.tsx).
    expect(src).toMatch(/selectedSessionId:\s*null/)
  })

  test('Phase 56 G4: bg-click handler invokes useViewerStore.getState().clearSelection()', () => {
    expect(src).toMatch(/useViewerStore\.getState\(\)\.clearSelection\(\)/)
  })

  test('Phase 56 G5: bg-click handler no longer writes the partial setState payload it had pre-Phase-56', () => {
    // The Phase 45 baseline at lines 427-431 wrote:
    //   useViewerStore.setState({ selectedNodeId: null, pathToSelected: new Set() })
    // INSIDE the `if (event.target === svgRef.current)` branch. After Phase
    // 56 that branch invokes clearSelection() instead. We assert the bg-click
    // route does NOT contain the old direct setState shape.
    // (The node onClick still uses setState({...}) for the 5-field payload —
    // that's a DIFFERENT setState call, in a different handler. We narrow by
    // checking the unique `event.target === svgRef.current` line is followed
    // by clearSelection, NOT setState.)
    const bgBlockMatch = src.match(
      /if\s*\(\s*event\.target\s*===\s*svgRef\.current\s*\)\s*\{?\s*([^}]+?)\}/,
    )
    expect(bgBlockMatch).not.toBeNull()
    const inside = bgBlockMatch![1]
    expect(inside).toMatch(/clearSelection\(\)/)
    expect(inside).not.toMatch(/setState\s*\(\s*\{/)
  })

  test('Phase 56 G6: centering useEffect subscribes to selectionSource and selectedNodeId', () => {
    // The new effect's dep list must include selectedNodeId AND selectionSource;
    // visibleEntities is also in the deps so the pan re-runs after the force
    // simulation settles a previously-undefined node. We assert via a deps
    // signature that contains all three identifiers and does NOT contain the
    // full main-effect prefix `visibleRelations, theme`.
    expect(src).toMatch(/\}, \[selectedNodeId, selectionSource, visibleEntities\]\)/)
  })

  test('Phase 56 G7: centering effect early-bails when selectionSource === "graph"', () => {
    // The self-originated guard prevents a feedback re-pan after the user
    // clicks a node. Pattern lives inside the centering effect.
    expect(src).toMatch(/selectionSource\s*===\s*'graph'/)
  })

  test('Phase 56 G8: centering effect uses the in-tree d3.zoomIdentity + transition().duration(500) idiom (same as fitToScreen)', () => {
    // Two distinct sites use this idiom now: fitToScreen (line ~557) and the
    // new centering effect. We expect AT LEAST 2 matches of duration(500).
    const matches = src.match(/transition\(\)\.duration\(500\)/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(2)
  })

  test('Phase 56 G9: MAIN useEffect dep list still OMITS selectedNodeId (critical Phase 45 invariant)', () => {
    // The main effect's dep list signature starts with `[visibleEntities,
    // visibleRelations` — matches the exact regex the PLAN.md verification
    // node oneliner uses. If selectedNodeId ever drifts into that list the
    // whole SVG rebuilds + the force simulation restarts on every click.
    const mainBlocks = src.match(/}, \[visibleEntities, visibleRelations[^\]]+\]\)/g)
    expect(mainBlocks).not.toBeNull()
    expect(mainBlocks!.length).toBeGreaterThanOrEqual(1)
    for (const block of mainBlocks!) {
      expect(block).not.toMatch(/\bselectedNodeId\b/)
    }
  })

  test('Phase 56 G10: Logger discipline — no raw console.* in D3GraphCanvas.tsx', () => {
    expect(src).not.toMatch(/console\.(log|warn|error|info|debug|trace)/)
  })

  test('Phase 56 G11: selectionSource subscription is present (so React re-runs the centering effect on change)', () => {
    // Use the in-tree subscribe idiom: useViewerStore((s) => s.selectionSource)
    expect(src).toMatch(/useViewerStore\(\(s\)\s*=>\s*s\.selectionSource\)/)
  })
})
