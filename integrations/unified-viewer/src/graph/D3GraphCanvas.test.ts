// D3GraphCanvas Phase 56 source-grep gates.
//
// We do NOT render D3GraphCanvas in jsdom — d3.forceSimulation + the
// zoomBehavior pan-to-node primitive require a real SVG layout engine that
// jsdom doesn't ship (Layout, getBoundingClientRect, getCTM are all stubs).
// Per 56-PATTERNS.md the in-tree gate idiom for this file is a **source
// readFileSync + regex** assertion (mirrors LslTimelineStrip.test.tsx:271-277
// Logger-discipline gate), which is exactly what locks the Phase 56
// invariants on D3GraphCanvas:
//
//   1. Node click writes the 5-field atomic Phase 56 payload (selectedNodeId,
//      pathToSelected reset, highlightedRowKey, selectionSource: 'graph',
//      selectedSessionId: null).
//   2. Background click goes through useViewerStore.getState().clearSelection()
//      (single store action — no partial setState).
//   3. 2026-06-13 (continuation 2 SPEC CHANGE): the AC #3 visual contract
//      is fulfilled by applySelectionStyling (selection ring + ancestry
//      trace), NOT by a viewport pan. The centering useEffect (originally
//      committed in 989c04558) is REMOVED. The grep gates assert ABSENCE
//      of the centering signature (G6/G7/G8 inverted) and PRESENCE of the
//      applySelectionStyling primitive that carries the new contract.
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

  test('Phase 56 G6 [retracted — spec change 2026-06-13]: no centering useEffect dep signature present', () => {
    // 2026-06-13 (continuation 2 SPEC CHANGE): the original G6 asserted
    // that the centering useEffect's dep list `[selectedNodeId,
    // selectionSource, visibleEntities]` was present. Per operator
    // second-smoke feedback ("Maybe the zoom is not a good idea …") the
    // centering effect is REMOVED. This inverted assertion is the source-
    // grep lock for the retraction: if a future plan re-adds a centering
    // effect with the original triple-deps signature, this gate fires.
    expect(src).not.toMatch(/\}, \[selectedNodeId, selectionSource, visibleEntities\]\)/)
  })

  test('Phase 56 G7 [retracted — spec change 2026-06-13]: no "selectionSource === \'graph\'" early-bail (only present in the retracted centering effect)', () => {
    // 2026-06-13 (continuation 2 SPEC CHANGE): the only consumer of
    // `selectionSource === 'graph'` in this file was the centering
    // effect's loop-safety bail. With the effect gone, the comparison
    // should not appear in the source. (Other uses of selectionSource —
    // e.g. as the literal value written on node click `selectionSource:
    // 'graph'` — match a DIFFERENT regex and are covered by G1.)
    expect(src).not.toMatch(/selectionSource\s*===\s*'graph'/)
  })

  test('Phase 56 G8 [retracted — spec change 2026-06-13]: only ONE transition().duration(500) site remains (fitToScreen)', () => {
    // 2026-06-13 (continuation 2 SPEC CHANGE): the original G8 asserted
    // ≥2 matches because the centering effect duplicated the fitToScreen
    // idiom. With the centering effect removed, exactly ONE site uses
    // `transition().duration(500)` — the one-shot auto-fit at the end of
    // the force simulation. If a future plan re-adds a viewport-pan call
    // on selection change (the retracted behaviour), this count drifts
    // above 1 and the gate fires.
    const matches = src.match(/transition\(\)\.duration\(500\)/g) ?? []
    expect(matches.length).toBe(1)
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

  test('Phase 56 G11 [retracted — spec change 2026-06-13]: selectionSource subscription no longer required', () => {
    // 2026-06-13 (continuation 2 SPEC CHANGE): the original G11 locked the
    // selectionSource subscription that re-ran the centering effect. With
    // the centering effect removed, the subscription is unused. The
    // selectionSource LITERAL is still WRITTEN on node click (G1) — that
    // payload doesn't require the file to subscribe to its own slice.
    // Keeping a dead subscription would add a spurious re-render on every
    // selectionSource transition, so we assert ABSENCE. If a future plan
    // re-introduces the centering effect (and therefore re-adds the
    // subscription), this gate fires.
    expect(src).not.toMatch(/useViewerStore\(\(s\)\s*=>\s*s\.selectionSource\)/)
  })

  // ====================================================================
  // T-D [audit §6.4 / §6.6]: `pathToSelected` is the store's single source
  // of truth for the ancestry trace. `applySelectionStyling` MUST read it
  // from the store INSTEAD of re-running `computeAncestryPath` inline as
  // its primary source. Source-grep adapt of the audit's runtime viewport-
  // stability test (jsdom can't host the d3 SVG layout, per file header).
  // The Commit-5 fix has the function read `pathToSelected` from the
  // store with `computeAncestryPath` only as a fallback.
  // ====================================================================
  test('Phase 56 G12 [audit §6.4 / §6.6 — T-D]: applySelectionStyling reads pathToSelected from the store (not exclusively inline)', () => {
    // After Commit 5: the file must contain a subscription/read of the
    // store field. Match a Zustand read using either subscription idiom or
    // `useViewerStore.getState().pathToSelected`.
    const hasSubscription = /useViewerStore\(\(s\)\s*=>\s*s\.pathToSelected\)/.test(src)
    const hasGetStateRead = /useViewerStore\.getState\(\)\.pathToSelected/.test(src)
    expect(hasSubscription || hasGetStateRead).toBe(true)
  })

  test('Phase 56 G13 [audit §6.7 — T-D viewport stability]: main render effect dep list still does NOT include selectedNodeId NOR pathToSelected NOR selectedSessionId', () => {
    // Viewport stability contract: a non-graph selection must NOT
    // invalidate visibleEntities/visibleRelations and therefore must not
    // restart the force simulation. The audit's §6.7 contract narrowed
    // by the audit's §4.3 root cause: only `visibleEntities` and
    // `visibleRelations` may invalidate the main effect; selection slice
    // fields must NOT appear in the dep list.
    const mainBlocks = src.match(/}, \[visibleEntities, visibleRelations[^\]]+\]\)/g)
    expect(mainBlocks).not.toBeNull()
    for (const block of mainBlocks!) {
      expect(block).not.toMatch(/\bselectedNodeId\b/)
      expect(block).not.toMatch(/\bpathToSelected\b/)
      expect(block).not.toMatch(/\bselectedSessionId\b/)
      expect(block).not.toMatch(/\bselectedSessionStartAt\b/)
    }
  })
})
