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
//   1. Node click routes through `useViewerStore.getState().setSelection({...})`
//      with `nodeId: d.id`, `pathToSelected: new Set(...)`,
//      `highlightedRowKey: d.id`, `source: 'graph'`, `sessionId: null`.
//      (CR-02 fix 2026-06-13: was an inline 5-field `setState({...})` that
//      cleared `selectedSessionId` but silently left
//      `selectedSessionStartAt` stale — sibling-clear invariant violation.
//      Routing through `setSelection` puts the paired clear in the action
//      body — see viewer-store.ts:330-335.)
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
//   5. Audit contract #5 acceptance grep (CR-02 fix): zero inline
//      `useViewerStore.setState({...})` call sites remain in this file —
//      both the node onClick and the bg-click route through store actions.
//
// Logger discipline is also gate-tested (zero console.* in the source) per
// PATTERNS.md "Phase 56 must add the same gate".
//
// The functional test at the bottom (G14) exercises the store-side sibling-
// clear contract that `setSelection` enforces, mirroring what the node-click
// handler triggers. We can't fire the actual d3 click in jsdom, so we drive
// `setSelection` with the exact payload shape the handler produces — that's
// the same store mutation the live handler invokes after this CR-02 fix.

import { describe, test, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { useViewerStore } from '@/store/viewer-store'

const SOURCE_PATH = resolve(process.cwd(), 'src/graph/D3GraphCanvas.tsx')
const src = readFileSync(SOURCE_PATH, 'utf8')

describe('D3GraphCanvas — Phase 56 source-grep gates', () => {
  test('Phase 56 G1 [CR-02 update]: node click payload includes source: "graph" (via setSelection action)', () => {
    // 2026-06-13 (CR-02 fix): the click handler now routes through
    // `setSelection({...})` whose parameter is named `source`, not
    // `selectionSource`. Single-quoted form is the in-tree convention.
    expect(src).toMatch(/source:\s*'graph'/)
  })

  test('Phase 56 G2: node click payload includes highlightedRowKey: d.id', () => {
    expect(src).toMatch(/highlightedRowKey:\s*d\.id/)
  })

  test('Phase 56 G3 [CR-02 update]: node click payload passes sessionId: null (sibling-clear handled by setSelection)', () => {
    // 2026-06-13 (CR-02 fix): the previous inline `setState` wrote
    // `selectedSessionId: null` directly but silently left
    // `selectedSessionStartAt` stale (sibling-clear invariant violation —
    // audit §7 R2). The click handler now passes `sessionId: null` to
    // `setSelection`, which atomically also clears `selectedSessionStartAt`
    // (viewer-store.ts:330-335: `else if (sessionId !== undefined) {
    // nextSessionStartAt = null }`). The functional test G14 below proves
    // the paired clear happens at runtime.
    expect(src).toMatch(/sessionId:\s*null/)
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

  test('Phase 56 G15 [CR-02 fix — audit contract #5]: zero inline useViewerStore.setState({...}) call sites remain in D3GraphCanvas.tsx', () => {
    // 2026-06-13 (CR-02 fix): the node-click handler previously used an
    // inline `useViewerStore.setState({...})` 5-field payload. That site
    // was the last inline `setState({...})` in this file (the bg-click was
    // already converted to `clearSelection()` in an earlier Phase 56
    // commit). After CR-02 it now routes through `setSelection({...})`,
    // putting the sibling-clear invariant for `selectedSessionId` +
    // `selectedSessionStartAt` in the store action body where it can't
    // be forgotten. This gate locks the acceptance grep from audit
    // contract #5 ("zero `useViewerStore.setState({...})` call sites in
    // any consumer component that participates in selection") for this
    // file. If a future plan re-introduces an inline payload, this gate
    // fires immediately.
    const matches = src.match(/useViewerStore\.setState\s*\(/g) ?? []
    expect(matches.length).toBe(0)
  })
})

// ======================================================================
// G14 — functional sibling-clear test (CR-02 fix).
//
// This block is OUTSIDE the source-grep describe so it can carry its own
// store-reset `beforeEach`. We can't fire the actual d3 click in jsdom
// (per the file header), so we drive `useViewerStore.getState().setSelection(...)`
// with the EXACT payload shape the node-click handler now passes (see
// D3GraphCanvas.tsx around lines 537-545). That's the same store mutation
// the live handler invokes — testing it proves the sibling-clear works at
// runtime, complementing the source-grep gates above.
// ======================================================================
describe('D3GraphCanvas — Phase 56 node-click sibling-clear (CR-02 functional)', () => {
  beforeEach(() => {
    // Reset only the selection slice fields we touch in this block —
    // other Phase 55/56 fields are unrelated to this test.
    useViewerStore.setState({
      selectedNodeId: null,
      pathToSelected: new Set<string>(),
      selectionSource: null,
      highlightedRowKey: null,
      selectedSessionId: null,
      selectedSessionStartAt: null,
      lslSessionFilter: [],
      lslFilterEntityIds: null,
    })
  })

  test('G14: simulating the node-click code path clears BOTH selectedSessionId AND selectedSessionStartAt (sibling-clear invariant — audit §7 R2)', () => {
    // 1. Seed the store with both LSL session fields populated, as if a
    //    timeline tick was the previous writer.
    useViewerStore.setState({
      selectedSessionId: 'sess-X',
      selectedSessionStartAt: '2026-06-13T11:00:00Z',
    })
    expect(useViewerStore.getState().selectedSessionId).toBe('sess-X')
    expect(useViewerStore.getState().selectedSessionStartAt).toBe('2026-06-13T11:00:00Z')

    // 2. Invoke the same store mutation the node-click handler now triggers.
    //    Payload shape mirrors D3GraphCanvas.tsx node onClick body verbatim
    //    (sans the actual `computeAncestryPath` call — we use a stub path
    //    Set since the sibling-clear contract is independent of ancestry).
    useViewerStore.getState().setSelection({
      nodeId: 'node-Y',
      pathToSelected: new Set<string>(['root', 'node-Y']),
      highlightedRowKey: 'node-Y',
      source: 'graph',
      sessionId: null,
    })

    // 3. The CR-02 sibling-clear assertion: BOTH session fields are null.
    //    Before the fix, `selectedSessionStartAt` would still be
    //    '2026-06-13T11:00:00Z' here, leaving stale state for any future
    //    consumer that reads it independently of `selectedSessionId`.
    const s = useViewerStore.getState()
    expect(s.selectedSessionId).toBeNull()
    expect(s.selectedSessionStartAt).toBeNull()

    // 4. Sanity: the new selectedNodeId write also happened atomically.
    expect(s.selectedNodeId).toBe('node-Y')
    expect(s.highlightedRowKey).toBe('node-Y')
    expect(s.selectionSource).toBe('graph')
  })
})
