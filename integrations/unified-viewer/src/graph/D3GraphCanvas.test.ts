// D3GraphCanvas Phase 56.1 source-grep gates.
//
// We do NOT render D3GraphCanvas in jsdom — d3.forceSimulation + the
// zoomBehavior pan-to-node primitive require a real SVG layout engine that
// jsdom doesn't ship (Layout, getBoundingClientRect, getCTM are all stubs).
// Per 56-PATTERNS.md the in-tree gate idiom for this file is a **source
// readFileSync + regex** assertion (mirrors LslTimelineStrip.test.tsx:271-277
// Logger-discipline gate), which is exactly what locks the Phase 56 + 56.1
// invariants on D3GraphCanvas:
//
//   1. Node click routes through `useViewerStore.getState().setSelection({...})`
//      with `nodeIds: new Set([d.id])`, `bucketKeys: new Set()`,
//      `focal: { nodeId: d.id, bucketKey: null }`, `pathToSelected: new Set(...)`,
//      `highlightedRowKey: d.id`, `source: 'graph'`.
//      (Phase 56.1 D-5 drill collapse: ALWAYS shrinks any prior halo to
//      single-focal mode and clears the timeline halo. Routing through the
//      action keeps the sibling-field clears + reference-stability guards
//      where they can't be forgotten — viewer-store.ts:399-490.)
//   2. Background click goes through useViewerStore.getState().clearSelection()
//      (single store action — no partial setState).
//   3. 2026-06-13 (Phase 56-04 continuation 2 SPEC CHANGE): the AC #3 visual
//      contract is fulfilled by applySelectionStyling (selection ring +
//      ancestry trace), NOT by a viewport pan. The centering useEffect
//      (originally committed in 989c04558) is REMOVED. The grep gates
//      assert ABSENCE of the centering signature (G6/G7/G8 inverted) and
//      PRESENCE of the applySelectionStyling primitive that carries the
//      new contract.
//   4. The MAIN useEffect dep list at lines ~660-672 OMITS every Phase 56.1
//      selection field — selectedNodeIds, focalNodeId, selectedBucketKeys,
//      focalBucketKey (and the carried-forward Phase 56 pathToSelected) —
//      listing any of them there would rebuild the SVG + restart the force
//      simulation on every click (the comment-block invariant the file has
//      carried since Phase 45; Phase 56-PATTERNS Locked Contract #3).
//   5. Audit contract #5 acceptance grep (CR-02 fix carried forward): zero
//      inline `useViewerStore.setState({...})` call sites remain in this
//      file — both the node onClick and the bg-click route through store
//      actions (setSelection / clearSelection).
//   6. Phase 56.1 two-tier render: source contains both halo (#60a5fa) and
//      focal (#ff0000) stroke colors + data-focal + data-halo markers.
//   7. Phase 56.1 trace-from-focal-only: ancestry computation reads
//      focalNodeId (not selectedNodeIds or the obsolete selectedNodeId).
//   8. Phase 56.1 useCallback dep list for applySelectionStyling renames the
//      Phase 56 [selectedNodeId, ...] to [selectedNodeIds, focalNodeId, ...].
//
// Logger discipline is also gate-tested (zero console.* in the source) per
// PATTERNS.md "Phase 56 must add the same gate".
//
// Phase 56's G14 functional sibling-clear test (selectedSessionId /
// selectedSessionStartAt) is REMOVED — Plan 01 removed those two fields
// from the store schema (replaced by selectedBucketKeys + focalBucketKey).
// The sibling-clear concern is now built into the deriveFocal helper inside
// setSelection (verified by viewer-store.test.ts's 28-test Phase 56.1
// multi-selection describe block, not here). G14 is repurposed as a
// source-grep gate for the new no-selection guard predicate.

import { describe, test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SOURCE_PATH = resolve(process.cwd(), 'src/graph/D3GraphCanvas.tsx')
const src = readFileSync(SOURCE_PATH, 'utf8')

describe('D3GraphCanvas — Phase 56.1 source-grep gates', () => {
  test('Phase 56.1 G1: node click payload includes source: "graph" (via setSelection action)', () => {
    // Single-quoted form is the in-tree convention.
    expect(src).toMatch(/source:\s*'graph'/)
  })

  test('Phase 56.1 G2: node click payload includes highlightedRowKey: d.id', () => {
    expect(src).toMatch(/highlightedRowKey:\s*d\.id/)
  })

  test('Phase 56.1 G3 [D-2 reverse direction + D-5 drill collapse]: node click writes nodeIds: new Set([d.id]) AND bucketKeys from the nodeToBuckets pre-index', () => {
    // Phase 56.1 D-5: a graph click collapses the GRAPH halo to single-focal
    // mode (nodeIds = new Set([d.id]) — any prior multi-node halo is dropped).
    // Phase 56.1 D-2 reverse direction (Plan 05): the SAME click ALSO writes
    // bucketKeys = nodeToBuckets.get(d.id) — every bucket that touched d.id
    // now lights up on the timeline strip (halo rings). The previous Plan 03
    // payload of `bucketKeys: new Set<string>()` (always-empty) regressed
    // the reverse cascade; Plan 05's `nodeToBuckets.get(d.id) ?? new Set()`
    // is the correct atomic write per PATTERNS.md §5 Option A.
    expect(src).toMatch(/nodeIds:\s*new Set<string>\(\[d\.id\]\)/)
    // bucketKeys is now sourced from the pre-index — either the .get() result
    // or an empty Set fallback when the node has no touching buckets.
    expect(src).toMatch(/bucketKeys:\s*touchedBuckets|bucketKeys:\s*nodeToBuckets\.get\(d\.id\)/)
    // The pre-index hook must be consumed in this file at component scope.
    expect(src).toMatch(/useNodeToBucketsIndex\s*\(\s*apiClient\s*,\s*system\s*\)/)
  })

  test('Phase 56.1 G4: bg-click handler invokes useViewerStore.getState().clearSelection()', () => {
    expect(src).toMatch(/useViewerStore\.getState\(\)\.clearSelection\(\)/)
  })

  test('Phase 56.1 G5: bg-click handler does NOT contain a direct setState payload', () => {
    // The Phase 45 baseline at lines 427-431 wrote:
    //   useViewerStore.setState({ selectedNodeId: null, pathToSelected: new Set() })
    // INSIDE the `if (event.target === svgRef.current)` branch. Phase 56
    // converted that to clearSelection(); Phase 56.1 preserves the routing.
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
    // effect with the original triple-deps signature (or its Phase 56.1
    // rename to [focalNodeId, selectionSource, visibleEntities]), this
    // gate fires.
    expect(src).not.toMatch(/\}, \[selectedNodeId, selectionSource, visibleEntities\]\)/)
    expect(src).not.toMatch(/\}, \[focalNodeId, selectionSource, visibleEntities\]\)/)
  })

  test('Phase 56 G7 [retracted — spec change 2026-06-13]: no "selectionSource === \'graph\'" early-bail (only present in the retracted centering effect)', () => {
    // 2026-06-13 (continuation 2 SPEC CHANGE): the only consumer of
    // `selectionSource === 'graph'` in this file was the centering
    // effect's loop-safety bail. With the effect gone, the comparison
    // should not appear in the source. (Other uses of selectionSource —
    // e.g. as the literal value written on node click `source: 'graph'`
    // — match a DIFFERENT regex and are covered by G1.)
    expect(src).not.toMatch(/selectionSource\s*===\s*'graph'/)
  })

  test('Phase 56 G8 [amended 2026-06-14 — Plan 06 Decision 2 multi-set fit]: TWO transition().duration(500) sites — original force-simulation auto-fit + new multi-set Layer 0 → Layer 1 fit-to-bounds', () => {
    // 2026-06-13 (continuation 2 SPEC CHANGE): the original G8 asserted
    // ≥2 matches because the centering effect duplicated the fitToScreen
    // idiom. The centering effect was retracted → G8 was tightened to
    // exactly ONE site (the force-simulation auto-fit).
    //
    // 2026-06-14 (Plan 06 gap-closure — Decision 2): a NEW callsite is
    // ADDED — the multi-set fit-to-bounds useEffect fires once when the
    // user enters Layer 1 (selectionSource transitions null → non-null)
    // and animates the zoom transform to fit `selectedNodeIds ∪
    // pathToSelected`. This is the operator-requested UX: halo nodes are
    // useless if they're off-screen. Distinct from the retracted
    // centering effect (which fired on EVERY selection change with no
    // multi-set predicate); the new effect fires ONCE per Layer 0 →
    // Layer 1 transition.
    //
    // Gate now asserts === 2:
    //   1. force-simulation auto-fit (line ~720 fitToScreen)
    //   2. multi-set fit on Layer 0 → Layer 1 transition (new useEffect)
    //
    // If a future plan re-adds a viewport-pan on every selection change
    // (the retracted behaviour), this count drifts to ≥3 and the gate
    // fires. The Layer 0 → Layer 1 ONLY guard is enforced separately by
    // G22 (new — see below).
    const matches = src.match(/transition\(\)\.duration\(500\)/g) ?? []
    expect(matches.length).toBe(2)
  })

  test('Phase 56.1 G9 [audit-locked viewport stability]: MAIN useEffect dep list OMITS every selection field (selectedNodeIds, focalNodeId, selectedBucketKeys, focalBucketKey, pathToSelected) AND the obsolete selectedNodeId / selectedSessionId / selectedSessionStartAt', () => {
    // The main effect's dep list signature starts with `[visibleEntities,
    // visibleRelations` — matches the exact regex the PLAN.md verification
    // node oneliner uses. If ANY selection field ever drifts into that
    // list the whole SVG rebuilds + the force simulation restarts on every
    // click — Phase 56-PATTERNS Locked Contract #3 / Phase 45 G9 viewport
    // stability invariant.
    //
    // Phase 56.1 obligation: lock the exact verbatim dep list as the
    // single canonical form, then assert the Phase 56.1 selection field
    // names + the deleted Phase 56 names + pathToSelected are all absent.
    expect(src).toMatch(/}, \[visibleEntities, visibleRelations, theme, isLoading\]/)
    const mainBlocks = src.match(/}, \[visibleEntities, visibleRelations[^\]]+\]\)/g)
    expect(mainBlocks).not.toBeNull()
    expect(mainBlocks!.length).toBeGreaterThanOrEqual(1)
    for (const block of mainBlocks!) {
      // Phase 56.1 new field names — MUST NOT appear:
      expect(block).not.toMatch(/\bselectedNodeIds\b/)
      expect(block).not.toMatch(/\bfocalNodeId\b/)
      expect(block).not.toMatch(/\bselectedBucketKeys\b/)
      expect(block).not.toMatch(/\bfocalBucketKey\b/)
      // Carried-forward Phase 56 invariant — MUST NOT appear:
      expect(block).not.toMatch(/\bpathToSelected\b/)
      // Deleted Phase 56 field names — MUST NOT re-appear:
      expect(block).not.toMatch(/\bselectedNodeId\b/)
      expect(block).not.toMatch(/\bselectedSessionId\b/)
      expect(block).not.toMatch(/\bselectedSessionStartAt\b/)
    }
  })

  test('Phase 56 G10: Logger discipline — no raw console.* in D3GraphCanvas.tsx', () => {
    expect(src).not.toMatch(/console\.(log|warn|error|info|debug|trace)/)
  })

  test('Phase 56 G11 [amended 2026-06-14 — Plan 06 Decision 2 multi-set fit]: selectionSource subscription IS now required for the multi-set fit-to-bounds transition detector', () => {
    // 2026-06-13 (continuation 2 SPEC CHANGE): the original G11 locked the
    // selectionSource subscription that re-ran the retracted centering
    // effect. With the centering effect removed, the subscription was
    // unused → gate asserted ABSENCE.
    //
    // 2026-06-14 (Plan 06 gap-closure — Decision 2): the new multi-set
    // fit-to-bounds useEffect needs `selectionSource` in its dep list to
    // detect Layer 0 → Layer 1 transitions (null → non-null). The
    // subscription is RESTORED for this narrow purpose. Inverted assertion:
    // the subscription IS present. The dep list of the new useEffect is
    // verified by G22 below.
    expect(src).toMatch(/useViewerStore\(\(s\)\s*=>\s*s\.selectionSource\)/)
  })

  test('Phase 56 G12 [audit §6.4 / §6.6]: applySelectionStyling reads pathToSelected from the store (not exclusively inline)', () => {
    // After Commit 5: the file must contain a subscription/read of the
    // store field. Match a Zustand read using either subscription idiom or
    // `useViewerStore.getState().pathToSelected`.
    const hasSubscription = /useViewerStore\(\(s\)\s*=>\s*s\.pathToSelected\)/.test(src)
    const hasGetStateRead = /useViewerStore\.getState\(\)\.pathToSelected/.test(src)
    expect(hasSubscription || hasGetStateRead).toBe(true)
  })

  test('Phase 56.1 G13 [Contract #5 — single source of truth]: zero inline useViewerStore.setState({...}) call sites remain in D3GraphCanvas.tsx', () => {
    // Phase 56's CR-02 fix removed the last inline setState({...}) site
    // (node-click handler). Phase 56.1 D-5 drill-collapse refactor keeps
    // the same routing through the canonical setSelection action — passing
    // the new multi-set fields (nodeIds, bucketKeys, focal) instead of the
    // deleted single-selection fields. This gate locks the acceptance grep
    // from audit contract #5 for this file. If a future plan re-introduces
    // an inline payload, this gate fires immediately.
    const matches = src.match(/useViewerStore\.setState\s*\(/g) ?? []
    expect(matches.length).toBe(0)
  })

  // ====================================================================
  // Phase 56.1 NEW gates G14-G20 — locks the two-tier render contract,
  // the drill-collapse click payload, the trace-from-focal-only contract,
  // and the renamed useCallback dep list. Each gate maps directly to a
  // CONTEXT.md decision or PATTERNS.md §4 invariant.
  // ====================================================================

  test('Phase 56.1 G14 [D-1 + D-4]: applySelectionStyling no-selection guard uses (focalNodeId === null && selectedNodeIds.size === 0)', () => {
    // The Phase 56 guard was `if (!selectedNodeId)`. Phase 56.1 replaces
    // it with a two-condition predicate: NO focal AND NO halo. With the
    // store's deriveFocal invariant (focalNodeId === null iff
    // selectedNodeIds.size === 0) this is belt-and-braces but it documents
    // the contract intent for any future reader.
    expect(src).toMatch(/focalNodeId === null && selectedNodeIds\.size === 0/)
  })

  test('Phase 56.1 G15 [D-4]: two-tier ring colors present in source (#60a5fa halo + #ff0000 focal)', () => {
    // Phase 56.1 D-4: halo uses the lighter blue (#60a5fa, opacity 0.6,
    // stroke-width 2); focal preserves the Phase 56 red (#ff0000, opacity
    // 1, stroke-width 4). Both strokes must appear in the source.
    expect(src).toContain('#60a5fa')
    expect(src).toContain('#ff0000')
  })

  test('Phase 56.1 G16 [D-4 + E2E observability]: data-focal + data-halo markers present on .node <g> writes', () => {
    // Phase 56.1 D-4: in addition to the inline stroke (which an E2E spec
    // would have to assert against by reading SVG attrs and color-matching),
    // applySelectionStyling writes `data-focal="true"` on the focal node's
    // parent <g> and `data-halo="true"` on each halo node's parent <g>.
    // Plan 06's E2E assertions select by these data-attrs.
    expect(src).toMatch(/data-focal/)
    expect(src).toMatch(/data-halo/)
  })

  test('Phase 56.1 G17 [D-5 drill collapse]: graph click routes through setSelection action (not inline setState)', () => {
    // The click handler must use `useViewerStore.getState().setSelection({...`
    // with `nodeIds: new Set(...)`. Multi-line regex catches the action
    // call followed by the nodeIds key on the next line.
    expect(src).toMatch(
      /useViewerStore\.getState\(\)\.setSelection\(\{[\s\S]*?nodeIds:\s*new Set/,
    )
    // Bonus: count inline setState occurrences (G13 already does this but
    // we re-assert here so a single removed gate doesn't open the door).
    const inlineSetState = src.match(/useViewerStore\.setState\s*\(\s*\{/g) ?? []
    expect(inlineSetState.length).toBe(0)
  })

  test('Phase 56.1 G18 [Contract #5]: background click routes through clearSelection()', () => {
    // Lockstep with G4 (positive assertion) + G5 (negative assertion of
    // inline setState inside the bg-click branch). This gate adds an
    // extra check that the routing literally uses the action form.
    expect(src).toMatch(/useViewerStore\.getState\(\)\.clearSelection\(\)/)
  })

  test('Phase 56.1 G19 [D-4 trace from focal only]: pathToSelected trace reads focalNodeId, not selectedNodeIds or the obsolete selectedNodeId', () => {
    // Phase 56.1 D-4: drawing the central-CK trace from every halo node
    // would be O(N×depth) visual noise at N>=5. The trace is keyed on
    // focalNodeId only. The applySelectionStyling closure must therefore
    // call computeAncestryPath / deriveAncestryFromStorePath with
    // focalNodeId as the entry point.
    // Positive: either inline computation or store-path derivation
    // references focalNodeId in the ancestry call.
    expect(src).toMatch(/computeAncestryPath\(focalNodeId,/)
    expect(src).toMatch(/deriveAncestryFromStorePath\(focalNodeId,/)
    // Negative: no leftover call using the deleted Phase 56 single-id name.
    expect(src).not.toMatch(/computeAncestryPath\(selectedNodeId,/)
    expect(src).not.toMatch(/deriveAncestryFromStorePath\(selectedNodeId,/)
    // Negative: trace must NOT iterate over selectedNodeIds for ancestry
    // computation (multi-trace would be the discretion-overridden form).
    expect(src).not.toMatch(/computeAncestryPath\(selectedNodeIds/)
  })

  test('Phase 56.1 G20 [D-1 useCallback dep list rename]: applySelectionStyling useCallback dep list contains selectedNodeIds AND focalNodeId AND pathToSelected AND visibleRelations AND theme', () => {
    // Phase 56's dep list was [selectedNodeId, pathToSelected, visibleRelations, theme].
    // Phase 56.1 renames the first entry to selectedNodeIds and ADDS focalNodeId.
    // Match the useCallback's tail dep-list line for applySelectionStyling.
    expect(src).toMatch(
      /useCallback\([\s\S]*?\[selectedNodeIds,\s*focalNodeId,\s*pathToSelected,\s*visibleRelations,\s*theme\][\s\S]*?\)/,
    )
    // Negative: the deleted Phase 56 dep-list form must not appear.
    expect(src).not.toMatch(
      /\[selectedNodeId,\s*pathToSelected,\s*visibleRelations,\s*theme\]/,
    )
  })

  test('Phase 56.1 G21 [Plan 06 gap-closure — Bug 2 regression]: d3 click handler reads from nodeToBucketsRef.current (NOT the closure-captured nodeToBuckets), and a separate useEffect syncs the ref on every nodeToBuckets change', () => {
    // 2026-06-14 (Plan 06 gap-closure — Bug 2 fix regression gate):
    //
    // Operator visual smoke caught a stale-closure regression: the d3
    // `.on('click', ...)` handler is registered INSIDE the main render
    // `useEffect` whose dep list is locked to `[visibleEntities,
    // visibleRelations, theme, isLoading]` (Locked Contract #3 — viewport
    // stability). When `nodeToBuckets` rebuilt AFTER first paint (sessions
    // loaded asynchronously, or visibleIds changed via filter toggle), the
    // d3 click handler kept the STALE `nodeToBuckets` value its closure
    // captured at registration time — typically an empty Map.
    //
    // Every node click then wrote `bucketKeys: empty Set` → no halo ticks.
    //
    // Fix: introduce `nodeToBucketsRef` synced from a lightweight
    // `useEffect([nodeToBuckets])` and have the click handler read
    // `nodeToBucketsRef.current` so it always sees the freshest reverse
    // index. Adding `nodeToBuckets` to the main render dep list would
    // violate Locked Contract #3.
    //
    // This gate locks the two-part fix at the source level:
    //   1. The click handler reads `nodeToBucketsRef.current.get(d.id)`,
    //      NOT the closure-captured `nodeToBuckets.get(d.id)`.
    //   2. A useRef + a separate useEffect that syncs the ref on
    //      `[nodeToBuckets]` change live in the component body.
    //   3. The closure-captured form (`nodeToBuckets.get(d.id)`) must
    //      NOT re-appear in the click handler.
    //
    // If any future refactor drops the ref hop and goes back to reading
    // the closure-captured value, this gate fires immediately.
    expect(src).toMatch(/const nodeToBucketsRef = useRef/)
    expect(src).toMatch(/nodeToBucketsRef\.current\s*=\s*nodeToBuckets/)
    expect(src).toMatch(/nodeToBucketsRef\.current\.get\(d\.id\)/)
    // Negative: the click handler must NOT use the closure-captured form
    // in EXECUTABLE code. Strip comment lines first (the .get(d.id)
    // reference text appears in two comment blocks describing the
    // pre-index hook + the D-2 reverse-direction wiring — those are
    // documentation, not callsites).
    const stripped = src
      .split('\n')
      .filter((ln) => !ln.trim().startsWith('//') && !ln.trim().startsWith('*'))
      .join('\n')
    const stale = stripped.match(/\bnodeToBuckets\.get\(d\.id\)/g) ?? []
    expect(
      stale.length,
      'D3 click handler must read from nodeToBucketsRef.current.get(d.id), not nodeToBuckets.get(d.id) — the latter captures a stale closure (Plan 06 gap-closure Bug 2 regression).',
    ).toBe(0)
  })

  test('Phase 56.1 G22 [Plan 06 Decision 2 — multi-set fit-to-bounds]: a separate useEffect detects Layer 0 → Layer 1 transitions (prev selectionSource null → non-null AND selectedNodeIds.size >= 1) and fits the zoom transform via the existing zoomBehaviorRef primitive', () => {
    // 2026-06-14 (Plan 06 Decision 2): the new multi-set fit-to-bounds
    // useEffect is bounded by THREE invariants this gate locks:
    //
    //   1. It tracks the PREVIOUS selectionSource via a useRef
    //      (`prevSelectionSourceRef`) so the transition predicate
    //      (null → non-null) can fire ONCE per Layer 0 → Layer 1 entry.
    //      Without the ref, the effect would either re-fit on every
    //      `selectedNodeIds` change (annoying) or fit only on first
    //      mount (broken across multiple selections).
    //
    //   2. The effect's dep list is `[selectionSource, selectedNodeIds,
    //      pathToSelected]` — NOT the main render's dep list. The main
    //      render still locks to `[visibleEntities, visibleRelations,
    //      theme, isLoading]` (G9 unchanged), preserving Locked Contract #3
    //      against SVG rebuilds / force-simulation restarts on every click.
    //
    //   3. The effect reads node positions from `d3NodesRef.current` to
    //      compute bounds — the same ref the (now-restored) main render
    //      assigns at the top of its body. d3's force simulation mutates
    //      `d3Nodes[i].x` / `.y` in place, so the ref always points at
    //      live coordinates.
    expect(src).toMatch(/const prevSelectionSourceRef\s*=\s*useRef<SelectionSource>/)
    // Transition predicate present (the load-bearing one-shot guard).
    expect(src).toMatch(/prevSource\s*===\s*null/)
    expect(src).toMatch(/selectionSource\s*!==\s*null/)
    expect(src).toMatch(/selectedNodeIds\.size\s*>=\s*1/)
    // d3NodesRef restored (the future-plan note in the file said this).
    expect(src).toMatch(/const d3NodesRef\s*=\s*useRef</)
    expect(src).toMatch(/d3NodesRef\.current\s*=\s*d3Nodes/)
    // Dep list of the new effect must include all three reactive inputs.
    expect(src).toMatch(/\}, \[selectionSource, selectedNodeIds, pathToSelected\]\)/)
  })
})
