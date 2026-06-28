// PATTERN SOURCE: 45-01-PLAN.md Task 2 <behavior> Test 3
//
// useViewerStore.getState().reset() clears in-system selection + search + selectedClasses,
// but DOES NOT clear visibleLevels (filter defaults persist across in-system reset by
// design — cross-system reset is the remount).
//
// PHASE 56.1 (Plan 01 Task 2) — the Phase 56 single-selection slice has been
// promoted to many-to-many (selectedNodeIds: ReadonlySet<string> + focalNodeId
// + selectedBucketKeys: ReadonlySet<string> + focalBucketKey). The Phase 56
// describe-block at the bottom of this file has been REWRITTEN to assert the
// multi-set shape + audit-locked reference-stability invariants (56-PATTERNS
// Locked Contract #3 + 56.1-PATTERNS §1 invariants table). Phase 45 + Phase 55
// describe-blocks are preserved verbatim — only the field references in their
// beforeEach() seed snapshots are updated (selectedNodeId → selectedNodeIds).
import { describe, test, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { useViewerStore, type ViewerState } from './viewer-store'

// Alias for the few tests that call getInitialState() via a generic cast — we
// want the real `ViewerState` typing while skirting the StoreApi generic.
type ViewerStateAny = ViewerState

describe('useViewerStore', () => {
  beforeEach(() => {
    // Restore fresh defaults before each test (Phase 56.1 multi-set shape).
    useViewerStore.setState({
      selectedNodeIds: new Set<string>(),
      focalNodeId: null,
      selectedEdgeId: null,
      searchQuery: '',
      visibleLevels: new Set([0, 1, 2, 3]),
      selectedClasses: new Set<string>(),
      theme: 'light',
      filterRailCollapsed: false,
    })
  })

  test('reset() clears focalNodeId (via setSelectedNode), selectedEdgeId, searchQuery, selectedClasses', () => {
    const store = useViewerStore.getState()
    store.setSelectedNode('n1')
    store.setSelectedEdge('e1')
    store.setSearch('foo')
    store.toggleClass('Observation')

    expect(useViewerStore.getState().focalNodeId).toBe('n1')
    expect(useViewerStore.getState().selectedNodeIds.has('n1')).toBe(true)
    expect(useViewerStore.getState().selectedEdgeId).toBe('e1')
    expect(useViewerStore.getState().searchQuery).toBe('foo')
    expect(useViewerStore.getState().selectedClasses.has('Observation')).toBe(true)

    useViewerStore.getState().reset()
    const s = useViewerStore.getState()
    expect(s.focalNodeId).toBeNull()
    expect(s.selectedNodeIds.size).toBe(0)
    expect(s.selectedEdgeId).toBeNull()
    expect(s.searchQuery).toBe('')
    expect(s.selectedClasses.size).toBe(0)
  })

  test('reset() does NOT touch visibleLevels (filter defaults persist for in-system clear)', () => {
    useViewerStore.getState().toggleLevel(0) // remove level 0
    expect(useViewerStore.getState().visibleLevels.has(0)).toBe(false)

    useViewerStore.getState().reset()
    // visibleLevels should remain whatever the user chose; reset() does not touch it
    expect(useViewerStore.getState().visibleLevels.has(0)).toBe(false)
    expect(useViewerStore.getState().visibleLevels.has(1)).toBe(true)
    expect(useViewerStore.getState().visibleLevels.has(2)).toBe(true)
    expect(useViewerStore.getState().visibleLevels.has(3)).toBe(true)
  })

  test('reset() does NOT touch theme (UI pref persists)', () => {
    useViewerStore.getState().setTheme('dark')
    expect(useViewerStore.getState().theme).toBe('dark')
    useViewerStore.getState().reset()
    expect(useViewerStore.getState().theme).toBe('dark')
  })

  test('toggleClass adds then removes', () => {
    useViewerStore.getState().toggleClass('Insight')
    expect(useViewerStore.getState().selectedClasses.has('Insight')).toBe(true)
    useViewerStore.getState().toggleClass('Insight')
    expect(useViewerStore.getState().selectedClasses.has('Insight')).toBe(false)
  })

  test('toggleLevel adds then removes', () => {
    useViewerStore.getState().toggleLevel(2)
    // 2 was present in defaults; first toggle removes it
    expect(useViewerStore.getState().visibleLevels.has(2)).toBe(false)
    useViewerStore.getState().toggleLevel(2)
    expect(useViewerStore.getState().visibleLevels.has(2)).toBe(true)
  })
})

// ----------------------------------------------------------------------------
// Phase 55 Plan 04 — VOKB feature-parity slice extensions
//
// PATTERN SOURCE: 55-04-PLAN.md Task 1+2 <behavior> + 55-PATTERNS.md § viewer-store.ts (EXTEND).
// VOKB Redux filtersSlice parity: action names mirror
// _work/.../viewer/src/store/slices/filtersSlice.ts (`toggleLayer`, `toggleDomain`,
// `toggleOntologyClass`, `setSelectedOntologyClasses`, `toggleShow*`, etc.).
//
// Empty-array semantic (`selectedLayers === []` = "all visible") is a VOKB
// invariant per UI-SPEC §10 and is preserved here. Consumers interpret
// emptiness; the store stores the literal selection.
//
// `selectedClasses` (Phase 45 `Set<string>`) is retained as a Phase 45 BC shim
// to keep downstream FilterRail / SigmaCanvas / UnifiedViewer wave-2+ consumers
// compiling. The NEW canonical field is `selectedOntologyClasses: string[]`
// per 55-PATTERNS.md (URL-serializable). Plan 55-08 retires the BC shim when
// it replaces FilterRail's flat ClassList with OntologyFilter.
// ----------------------------------------------------------------------------

describe('useViewerStore — Phase 55 initial state (Task 1)', () => {
  // PATTERN: Zustand v5 exposes `getInitialState()` on the store hook (vanilla.d.ts:12).
  // We assert against the FRESH store factory snapshot — NOT against any
  // `setState` we (or another test) might have written. This is the only way
  // to guarantee that the new slices are actually wired into the store
  // creator rather than being silently accepted as untyped setState keys.
  const initial = () =>
    (useViewerStore as unknown as { getInitialState: () => ViewerStateAny }).getInitialState()

  test('initial state: selectedLayers === [] (empty = all visible per UI-SPEC §10)', () => {
    expect(initial().selectedLayers).toEqual([])
  })

  test('initial state: selectedDomains === []', () => {
    expect(initial().selectedDomains).toEqual([])
  })

  test('initial state: selectedOntologyClasses === [] (replaces Phase 45 selectedClasses Set)', () => {
    expect(initial().selectedOntologyClasses).toEqual([])
  })

  test('initial state: hideDocNodes false', () => {
    const s = initial()
    expect(s.hideDocNodes).toBe(false)
  })

  test("initial state: mode === 'kg'", () => {
    expect(initial().mode).toBe('kg')
  })

  test('initial state: trendingPatterns === []', () => {
    expect(initial().trendingPatterns).toEqual([])
  })

  test('initial state: etmObservations === [] (ring-buffer empty)', () => {
    const s = initial()
    expect(s.etmObservations).toEqual([])
    expect(s.etmObservations.length).toBe(0)
  })

  test('initial state: etmStreamConnected === false', () => {
    expect(initial().etmStreamConnected).toBe(false)
  })

  test('initial state: etmSheetOpen === false', () => {
    expect(initial().etmSheetOpen).toBe(false)
  })

  test('initial state: hierarchySubtreeFilter === null', () => {
    expect(initial().hierarchySubtreeFilter).toBeNull()
  })

  test('initial state: lslSessionFilter === []', () => {
    expect(initial().lslSessionFilter).toEqual([])
  })

  test('BC: Phase 45 fields still present with their original initial values (selectedNodeIds replaces selectedNodeId per Phase 56.1)', () => {
    const s = initial()
    // Phase 56.1: selectedNodeId is GONE — replaced by selectedNodeIds (empty Set) + focalNodeId (null).
    expect(s.selectedNodeIds).toBeInstanceOf(Set)
    expect(s.selectedNodeIds.size).toBe(0)
    expect(s.focalNodeId).toBeNull()
    expect(s.selectedEdgeId).toBeNull()
    expect(s.searchQuery).toBe('')
    expect(s.visibleLevels.has(0)).toBe(true)
    expect(s.visibleLevels.has(1)).toBe(true)
    expect(s.visibleLevels.has(2)).toBe(true)
    expect(s.visibleLevels.has(3)).toBe(true)
    expect(s.theme === 'light' || s.theme === 'dark').toBe(true)
    expect(s.filterRailCollapsed).toBe(false)
  })

  test('BC shim: selectedClasses (legacy Set) is still present so wave-2+ consumers compile', () => {
    // Plan note: the 55-04-PLAN.md <behavior> NEGATIVE case ("selectedClasses is
    // NOT on state") was REVERSED to a BC-shim assertion. Removing the field
    // outright would break 7+ files outside this plan's files_modified scope
    // (FilterRail.tsx, UnifiedViewer.tsx, graph-builder.ts, SigmaCanvas.test.tsx,
    // and their tests) and violate the plan-level `tsc --noEmit → exit 0` gate.
    // The shim is removed by Plan 55-08 (OntologyFilter takeover). Tracked as
    // Rule 3 deviation in 55-04-SUMMARY.md.
    expect(initial().selectedClasses).toBeInstanceOf(Set)
  })
})

describe('useViewerStore — Phase 55 action setters (Task 2)', () => {
  beforeEach(() => {
    useViewerStore.setState({
      selectedNodeIds: new Set<string>(),
      focalNodeId: null,
      selectedEdgeId: null,
      searchQuery: '',
      visibleLevels: new Set([0, 1, 2, 3]),
      selectedClasses: new Set<string>(),
      selectedLayers: [],
      selectedDomains: [],
      selectedOntologyClasses: [],
      hideDocNodes: false,
      mode: 'kg',
      trendingPatterns: [],
      etmObservations: [],
      etmStreamConnected: false,
      etmSheetOpen: false,
      hierarchySubtreeFilter: null,
      lslSessionFilter: [],
      theme: 'light',
      filterRailCollapsed: false,
    })
  })

  // Empty-array "all visible" sentinel (2026-06-12 fix): [] means every option
  // is checked, so the FIRST click on an option unchecks just that one — it
  // does NOT collapse the selection to the single clicked option (which would
  // visually deselect all the others). ALL_LAYERS = ['evidence', 'pattern'].
  test("toggleLayer('evidence') from the empty='all visible' sentinel unchecks just that one", () => {
    useViewerStore.getState().toggleLayer('evidence')
    expect(useViewerStore.getState().selectedLayers).toEqual(['pattern'])
  })

  test("toggleLayer down to nothing yields the ['__none__'] none-visible sentinel", () => {
    useViewerStore.getState().toggleLayer('evidence') // → ['pattern']
    useViewerStore.getState().toggleLayer('pattern') // last one off → none visible
    expect(useViewerStore.getState().selectedLayers).toEqual(['__none__'])
  })

  // Same sentinel semantics for domains. ALL_DOMAINS = ['raas','kpifw','general'].
  test('toggleDomain respects the empty="all visible" sentinel', () => {
    useViewerStore.getState().toggleDomain('raas') // uncheck raas
    expect(useViewerStore.getState().selectedDomains).toEqual(['kpifw', 'general'])
    useViewerStore.getState().toggleDomain('kpifw') // uncheck kpifw
    expect(useViewerStore.getState().selectedDomains).toEqual(['general'])
    useViewerStore.getState().toggleDomain('raas') // re-check raas
    expect(useViewerStore.getState().selectedDomains).toEqual(['general', 'raas'])
  })

  test('setSelectedOntologyClasses replaces, toggleOntologyClass adds/removes', () => {
    useViewerStore.getState().setSelectedOntologyClasses(['Component', 'Service'])
    expect(useViewerStore.getState().selectedOntologyClasses).toEqual(['Component', 'Service'])

    useViewerStore.getState().toggleOntologyClass('File')
    expect(useViewerStore.getState().selectedOntologyClasses).toEqual([
      'Component',
      'Service',
      'File',
    ])

    useViewerStore.getState().toggleOntologyClass('Component')
    expect(useViewerStore.getState().selectedOntologyClasses).toEqual(['Service', 'File'])
  })

  test('toggleHideDocNodes flips boolean', () => {
    expect(useViewerStore.getState().hideDocNodes).toBe(false)
    useViewerStore.getState().toggleHideDocNodes()
    expect(useViewerStore.getState().hideDocNodes).toBe(true)
    useViewerStore.getState().toggleHideDocNodes()
    expect(useViewerStore.getState().hideDocNodes).toBe(false)
  })

  test("setMode('triage') updates mode; setMode('kg') reverts", () => {
    useViewerStore.getState().setMode('triage')
    expect(useViewerStore.getState().mode).toBe('triage')
    useViewerStore.getState().setMode('kg')
    expect(useViewerStore.getState().mode).toBe('kg')
  })

  test('setTrendingPatterns replaces the cached list', () => {
    const tp = [
      {
        nodeId: 'n1',
        entity: { id: 'n1', name: 'A', entityType: 'Component' },
        trendScore: 0.9,
        trends: { last7Days: 10, last30Days: 20, last90Days: 40 },
      },
    ]
    useViewerStore.getState().setTrendingPatterns(tp)
    expect(useViewerStore.getState().trendingPatterns).toEqual(tp)
  })

  test('pushObservation ring-buffer: after 105 pushes length === 100 and head is newest', () => {
    for (let i = 0; i < 105; i++) {
      useViewerStore.getState().pushObservation({
        id: `o${i}`,
        agent: 'claude',
        project: 'coding',
        content: `obs ${i}`,
        artifacts: [],
        timestamp: new Date().toISOString(),
      })
    }
    const buf = useViewerStore.getState().etmObservations
    expect(buf.length).toBe(100)
    // Newest-first ordering: the most recently pushed observation is at index 0.
    expect(buf[0].id).toBe('o104')
    // The oldest survivors are #5..#104 (we dropped o0..o4).
    expect(buf[buf.length - 1].id).toBe('o5')
  })

  test('setEtmStreamConnected / setEtmSheetOpen update booleans', () => {
    useViewerStore.getState().setEtmStreamConnected(true)
    expect(useViewerStore.getState().etmStreamConnected).toBe(true)
    useViewerStore.getState().setEtmSheetOpen(true)
    expect(useViewerStore.getState().etmSheetOpen).toBe(true)
  })

  test('setHierarchySubtreeFilter updates the root id (null clears)', () => {
    useViewerStore.getState().setHierarchySubtreeFilter('root-42')
    expect(useViewerStore.getState().hierarchySubtreeFilter).toBe('root-42')
    useViewerStore.getState().setHierarchySubtreeFilter(null)
    expect(useViewerStore.getState().hierarchySubtreeFilter).toBeNull()
  })

  test("addLslSessionFilter('abc') from empty → ['abc']; re-adding is a no-op (no dup)", () => {
    useViewerStore.getState().addLslSessionFilter('abc')
    expect(useViewerStore.getState().lslSessionFilter).toEqual(['abc'])
    useViewerStore.getState().addLslSessionFilter('abc')
    expect(useViewerStore.getState().lslSessionFilter).toEqual(['abc'])
  })

  test("setLslSessionFilter(['x','y']) replaces; clearLslSessionFilter() → []", () => {
    useViewerStore.getState().addLslSessionFilter('abc')
    useViewerStore.getState().setLslSessionFilter(['x', 'y'])
    expect(useViewerStore.getState().lslSessionFilter).toEqual(['x', 'y'])
    useViewerStore.getState().clearLslSessionFilter()
    expect(useViewerStore.getState().lslSessionFilter).toEqual([])
  })

  test('BC: Phase 45 actions setSelectedNode / setSelectedEdge / setSearch still work (multi-set semantics via Phase 56.1 imperative API)', () => {
    useViewerStore.getState().setSelectedNode('node-1')
    useViewerStore.getState().setSelectedEdge('edge-1')
    useViewerStore.getState().setSearch('hello')
    const s = useViewerStore.getState()
    // Phase 56.1 imperative shim: id=string → singleton Set + focal=id.
    expect(s.selectedNodeIds.has('node-1')).toBe(true)
    expect(s.selectedNodeIds.size).toBe(1)
    expect(s.focalNodeId).toBe('node-1')
    expect(s.selectedEdgeId).toBe('edge-1')
    expect(s.searchQuery).toBe('hello')
  })

  test('BC: Phase 45 toggleClass + setSelectedClasses (Set semantics) still work as legacy shim', () => {
    useViewerStore.getState().toggleClass('Observation')
    expect(useViewerStore.getState().selectedClasses.has('Observation')).toBe(true)
    useViewerStore.getState().toggleClass('Observation')
    expect(useViewerStore.getState().selectedClasses.has('Observation')).toBe(false)

    useViewerStore.getState().setSelectedClasses(new Set(['A', 'B']))
    expect(useViewerStore.getState().selectedClasses.has('A')).toBe(true)
    expect(useViewerStore.getState().selectedClasses.has('B')).toBe(true)
  })
})

// ----------------------------------------------------------------------------
// Phase 56.1 Plan 01 — many-to-many cross-pane selection sync
//
// PATTERN SOURCE:
//   - 56.1-01-PLAN.md Task 1+2 <behavior>
//   - 56.1-PATTERNS.md §1 (REFACTOR pattern: 56.1 schema delta + focal-
//     derivation rule + AUDIT-LOCKED invariants table)
//   - 56.1-CONTEXT.md §D-1 (data model), §D-7 (contract evolution)
//   - 56-PATTERNS.md §Locked Contract #3 (viewport stability — dep-list
//     invariant + sameSetMembership guard)
//
// EVOLUTION FROM PHASE 56:
//   - selectedNodeId: string|null            → selectedNodeIds: ReadonlySet<string>
//                                            + focalNodeId: string|null
//   - selectedSessionId: string|null         → selectedBucketKeys: ReadonlySet<string>
//   - selectedSessionStartAt: string|null    + focalBucketKey: string|null
//
// setSelection now accepts multi-set inputs (Set | string[]) for both axes,
// derives focal from insertion order, and preserves Set references on
// identical-content writes via sameSetMembership (the same audit-locked
// guard that already wraps lslFilterEntityIds in Phase 56).
//
// AUDIT-LOCKED INVARIANTS asserted here:
//   - #2/#3 (viewport stability): identical-content writes to selectedNodeIds
//     and selectedBucketKeys preserve the existing Set reference
//   - #4 (clearSelection coverage): all 4 selection fields + LSL slice +
//     pathToSelected cleared
//   - #5 (WR-04 — reset coverage): reset() matches clearSelection() coverage
//
// Source-grep sentinel at the bottom asserts the four new field names are
// present in viewer-store.ts so a silent refactor cannot pass tsc.
// ----------------------------------------------------------------------------

describe('useViewerStore — Phase 56.1 multi-selection', () => {
  const initial = () =>
    (useViewerStore as unknown as { getInitialState: () => ViewerState }).getInitialState()

  beforeEach(() => {
    useViewerStore.setState({
      selectionSource: null,
      highlightedRowKey: null,
      selectedNodeIds: new Set<string>(),
      focalNodeId: null,
      selectedBucketKeys: new Set<string>(),
      focalBucketKey: null,
      selectedEdgeId: null,
      pathToSelected: new Set<string>(),
      lslSessionFilter: [],
      lslFilterEntityIds: null,
    })
  })

  // -------------------- Initial state --------------------

  test('initial state: selectedNodeIds is a Set with size 0', () => {
    const s = initial()
    expect(s.selectedNodeIds).toBeInstanceOf(Set)
    expect(s.selectedNodeIds.size).toBe(0)
  })

  test('initial state: focalNodeId === null', () => {
    expect(initial().focalNodeId).toBeNull()
  })

  test('initial state: selectedBucketKeys is a Set with size 0', () => {
    const s = initial()
    expect(s.selectedBucketKeys).toBeInstanceOf(Set)
    expect(s.selectedBucketKeys.size).toBe(0)
  })

  test('initial state: focalBucketKey === null', () => {
    expect(initial().focalBucketKey).toBeNull()
  })

  // -------------------- setSelection multi-set writes --------------------

  test('setSelection({ nodeIds: ["a","b","c"], source: "graph" }) — selectedNodeIds size 3, focalNodeId === "c" (last in insertion order)', () => {
    useViewerStore.getState().setSelection({ nodeIds: ['a', 'b', 'c'], source: 'graph' })
    const s = useViewerStore.getState()
    expect(s.selectedNodeIds.size).toBe(3)
    expect(s.selectedNodeIds.has('a')).toBe(true)
    expect(s.selectedNodeIds.has('b')).toBe(true)
    expect(s.selectedNodeIds.has('c')).toBe(true)
    // Insertion-order derivation: last in iteration order = 'c'.
    expect(s.focalNodeId).toBe('c')
    expect(s.selectionSource).toBe('graph')
  })

  test('setSelection({ nodeIds: ["a","b"], focal: { nodeId: "a" }, source: "graph" }) — explicit focal override wins', () => {
    useViewerStore
      .getState()
      .setSelection({ nodeIds: ['a', 'b'], focal: { nodeId: 'a' }, source: 'graph' })
    const s = useViewerStore.getState()
    expect(s.selectedNodeIds.size).toBe(2)
    expect(s.focalNodeId).toBe('a')
  })

  test('setSelection({ nodeIds: new Set(), source: "graph" }) — empty Set empties selectedNodeIds and focal becomes null', () => {
    // Pre-seed
    useViewerStore.getState().setSelection({ nodeIds: ['x', 'y'], source: 'graph' })
    expect(useViewerStore.getState().selectedNodeIds.size).toBe(2)
    // Now empty
    useViewerStore.getState().setSelection({ nodeIds: new Set<string>(), source: 'graph' })
    const s = useViewerStore.getState()
    expect(s.selectedNodeIds.size).toBe(0)
    expect(s.focalNodeId).toBeNull()
  })

  test('setSelection({ bucketKeys: ["sess-A|2026","sess-B|2026"], source: "timeline" }) — selectedBucketKeys.size === 2, focalBucketKey === last inserted', () => {
    useViewerStore.getState().setSelection({
      bucketKeys: ['sess-A|2026', 'sess-B|2026'],
      source: 'timeline',
    })
    const s = useViewerStore.getState()
    expect(s.selectedBucketKeys.size).toBe(2)
    expect(s.focalBucketKey).toBe('sess-B|2026')
    expect(s.selectionSource).toBe('timeline')
  })

  // ------ Reference-stability (AUDIT-LOCKED invariant — viewport stability) ------

  test('setSelection preserves selectedNodeIds reference on identical-content writes (audit invariant — viewport stability)', () => {
    useViewerStore.getState().setSelection({ nodeIds: ['a'], source: 'graph' })
    const ref1 = useViewerStore.getState().selectedNodeIds
    // Second write with IDENTICAL content (array, same single member).
    useViewerStore.getState().setSelection({ nodeIds: ['a'], source: 'graph' })
    const ref2 = useViewerStore.getState().selectedNodeIds
    // Reference MUST be preserved so downstream useMemo (visibleEntities) deps
    // do not invalidate — 56-PATTERNS Locked Contract #3.
    expect(ref2).toBe(ref1)
  })

  test('setSelection preserves selectedBucketKeys reference on identical-content writes (audit invariant — same as Sets axis)', () => {
    useViewerStore.getState().setSelection({ bucketKeys: ['k1'], source: 'timeline' })
    const ref1 = useViewerStore.getState().selectedBucketKeys
    useViewerStore.getState().setSelection({ bucketKeys: ['k1'], source: 'timeline' })
    const ref2 = useViewerStore.getState().selectedBucketKeys
    expect(ref2).toBe(ref1)
  })

  test('setSelection writes a fresh selectedNodeIds reference when content differs', () => {
    useViewerStore.getState().setSelection({ nodeIds: ['a', 'b'], source: 'graph' })
    const ref1 = useViewerStore.getState().selectedNodeIds
    useViewerStore.getState().setSelection({ nodeIds: ['a', 'b', 'c'], source: 'graph' })
    const ref2 = useViewerStore.getState().selectedNodeIds
    expect(ref2).not.toBe(ref1)
    expect(ref2.has('c')).toBe(true)
  })

  // ------ CR-01 regression (56.1-REVIEW): deriveFocal must not clobber on no-op writes ------

  test('CR-01: setSelection({ nodeIds: SAME_SET, source }) without explicit focal preserves focalNodeId (no stale-prev clobber)', () => {
    // Seed multi-set with focal === 'b' (explicit). Use array form so the
    // store builds the Set internally — that way the second write's array
    // input is content-equal but reference-different at the asSet() seam.
    useViewerStore
      .getState()
      .setSelection({ nodeIds: ['a', 'b', 'c'], focal: { nodeId: 'b' }, source: 'graph' })
    const seeded = useViewerStore.getState()
    expect(seeded.focalNodeId).toBe('b')
    expect(seeded.selectedNodeIds.size).toBe(3)
    // Second write — identical content, NO explicit focal. Pre-CR-01-fix
    // this called deriveFocal(prevRef, prevRef, undefined) which short-
    // circuited to the last iteration-order element ('c') and silently
    // clobbered the user-meaningful focal.
    useViewerStore.getState().setSelection({ nodeIds: ['a', 'b', 'c'], source: 'graph' })
    expect(useViewerStore.getState().focalNodeId).toBe('b')
  })

  test('CR-01: setSelection({ bucketKeys: SAME_SET, source }) without explicit focal preserves focalBucketKey', () => {
    useViewerStore.getState().setSelection({
      bucketKeys: ['k1', 'k2', 'k3'],
      focal: { bucketKey: 'k1' },
      source: 'timeline',
    })
    expect(useViewerStore.getState().focalBucketKey).toBe('k1')
    useViewerStore
      .getState()
      .setSelection({ bucketKeys: ['k1', 'k2', 'k3'], source: 'timeline' })
    expect(useViewerStore.getState().focalBucketKey).toBe('k1')
  })

  test('CR-01: explicit focal: { nodeId: null } still wins (override-with-null path still works)', () => {
    useViewerStore.getState().setSelection({ nodeIds: ['a', 'b'], source: 'graph' })
    expect(useViewerStore.getState().focalNodeId).toBe('b')
    useViewerStore
      .getState()
      .setSelection({ nodeIds: ['a', 'b'], focal: { nodeId: null }, source: 'graph' })
    expect(useViewerStore.getState().focalNodeId).toBeNull()
  })

  // ------ Preserve-on-omit semantics ------

  test('setSelection({ source: "graph" }) — no node/bucket args — preserves prior state (referential equality on both Sets)', () => {
    // Seed both axes.
    useViewerStore
      .getState()
      .setSelection({ nodeIds: ['a', 'b'], bucketKeys: ['k1'], source: 'graph' })
    const prevNodes = useViewerStore.getState().selectedNodeIds
    const prevBuckets = useViewerStore.getState().selectedBucketKeys
    const prevFocalNode = useViewerStore.getState().focalNodeId
    const prevFocalBucket = useViewerStore.getState().focalBucketKey
    // Source-only write — no axis args.
    useViewerStore.getState().setSelection({ source: 'graph' })
    const s = useViewerStore.getState()
    expect(s.selectedNodeIds).toBe(prevNodes)
    expect(s.selectedBucketKeys).toBe(prevBuckets)
    expect(s.focalNodeId).toBe(prevFocalNode)
    expect(s.focalBucketKey).toBe(prevFocalBucket)
  })

  // ------ WR-04 regression: addToSelection atomic additive write ------

  test('WR-04: addToSelection unions nodeIds with the existing selectedNodeIds', () => {
    useViewerStore.getState().setSelection({ nodeIds: ['a', 'b'], source: 'graph' })
    useViewerStore.getState().addToSelection({ nodeIds: ['c', 'd'], source: 'timeline' })
    const s = useViewerStore.getState()
    expect(s.selectedNodeIds.size).toBe(4)
    expect(s.selectedNodeIds.has('a')).toBe(true)
    expect(s.selectedNodeIds.has('b')).toBe(true)
    expect(s.selectedNodeIds.has('c')).toBe(true)
    expect(s.selectedNodeIds.has('d')).toBe(true)
    expect(s.selectionSource).toBe('timeline')
  })

  test('WR-04: addToSelection unions bucketKeys with the existing selectedBucketKeys', () => {
    useViewerStore.getState().setSelection({ bucketKeys: ['k1'], source: 'timeline' })
    useViewerStore.getState().addToSelection({ bucketKeys: ['k2'], source: 'timeline' })
    const s = useViewerStore.getState()
    expect(s.selectedBucketKeys.size).toBe(2)
    expect(s.selectedBucketKeys.has('k1')).toBe(true)
    expect(s.selectedBucketKeys.has('k2')).toBe(true)
  })

  test('WR-04: addToSelection unions lslFilterEntityIds with current set (treating null as empty)', () => {
    // Seed lslFilterEntityIds via setSelection.
    useViewerStore.getState().setSelection({
      source: 'timeline',
      lslFilterEntityIds: new Set<string>(['e1', 'e2']),
    })
    useViewerStore.getState().addToSelection({
      source: 'timeline',
      lslFilterEntityIds: new Set<string>(['e2', 'e3']),
    })
    const s = useViewerStore.getState()
    expect(s.lslFilterEntityIds).not.toBeNull()
    expect(s.lslFilterEntityIds!.size).toBe(3)
    expect(s.lslFilterEntityIds!.has('e1')).toBe(true)
    expect(s.lslFilterEntityIds!.has('e3')).toBe(true)
  })

  test('WR-04: addToSelection preserves selectedNodeIds reference when union has identical membership (no-op write)', () => {
    useViewerStore.getState().setSelection({ nodeIds: ['a', 'b', 'c'], source: 'graph' })
    const ref1 = useViewerStore.getState().selectedNodeIds
    // Re-add a subset — union is identical to current => reference preserved.
    useViewerStore.getState().addToSelection({ nodeIds: ['a', 'b'], source: 'graph' })
    const ref2 = useViewerStore.getState().selectedNodeIds
    expect(ref2).toBe(ref1)
  })

  test('WR-04: addToSelection({ nodeIds }) without explicit focal preserves focalNodeId on no-op union', () => {
    useViewerStore.getState().setSelection({
      nodeIds: ['a', 'b'],
      focal: { nodeId: 'a' },
      source: 'graph',
    })
    useViewerStore.getState().addToSelection({ nodeIds: ['a'], source: 'graph' })
    expect(useViewerStore.getState().focalNodeId).toBe('a')
  })

  test('WR-04: addToSelection({ lslSessionFilter }) dedups when appending an already-present session id', () => {
    useViewerStore.setState({ lslSessionFilter: ['sess-1'] })
    useViewerStore.getState().addToSelection({
      source: 'timeline',
      lslSessionFilter: ['sess-1', 'sess-2'],
    })
    const s = useViewerStore.getState()
    expect(s.lslSessionFilter).toEqual(['sess-1', 'sess-2'])
  })

  test('setSelection accepts both Set<string> and string[] for nodeIds (normalises to Set internally)', () => {
    useViewerStore.getState().setSelection({ nodeIds: new Set(['x', 'y']), source: 'graph' })
    const s1 = useViewerStore.getState()
    expect(s1.selectedNodeIds).toBeInstanceOf(Set)
    expect(s1.selectedNodeIds.size).toBe(2)
    useViewerStore.getState().setSelection({ nodeIds: ['p', 'q', 'r'], source: 'graph' })
    const s2 = useViewerStore.getState()
    expect(s2.selectedNodeIds).toBeInstanceOf(Set)
    expect(s2.selectedNodeIds.size).toBe(3)
    expect(s2.selectedNodeIds.has('q')).toBe(true)
  })

  test('setSelection accepts both Set<string> and string[] for bucketKeys', () => {
    useViewerStore
      .getState()
      .setSelection({ bucketKeys: new Set(['k1', 'k2']), source: 'timeline' })
    expect(useViewerStore.getState().selectedBucketKeys.size).toBe(2)
    useViewerStore.getState().setSelection({ bucketKeys: ['k3'], source: 'timeline' })
    expect(useViewerStore.getState().selectedBucketKeys.size).toBe(1)
    expect(useViewerStore.getState().selectedBucketKeys.has('k3')).toBe(true)
  })

  test('setSelection({ nodeIds, source, pathToSelected }) honors explicit pathToSelected', () => {
    const path = new Set<string>(['n', 'sys'])
    useViewerStore
      .getState()
      .setSelection({ nodeIds: ['n'], source: 'graph', pathToSelected: path })
    const s = useViewerStore.getState()
    expect(s.focalNodeId).toBe('n')
    expect(Array.from(s.pathToSelected).sort()).toEqual(['n', 'sys'])
  })

  test('setSelection({ nodeIds, source }) without explicit path resets pathToSelected to empty Set', () => {
    useViewerStore.setState({ pathToSelected: new Set<string>(['old1', 'old2']) })
    useViewerStore.getState().setSelection({ nodeIds: ['e1'], source: 'graph' })
    expect(useViewerStore.getState().pathToSelected.size).toBe(0)
  })

  // ------ clearSelection (invariant #4) ------

  test('clearSelection() empties all 4 selection fields + pathToSelected + lslSessionFilter ([]) + lslFilterEntityIds (null) + selectedEdgeId', () => {
    useViewerStore.setState({
      selectedEdgeId: 'e',
      selectionSource: 'graph',
      highlightedRowKey: 'r',
      selectedNodeIds: new Set<string>(['n1', 'n2']),
      focalNodeId: 'n2',
      selectedBucketKeys: new Set<string>(['k1']),
      focalBucketKey: 'k1',
      pathToSelected: new Set<string>(['a', 'b']),
      lslSessionFilter: ['sess1'],
      lslFilterEntityIds: new Set<string>(['x']),
    })
    useViewerStore.getState().clearSelection()
    const s = useViewerStore.getState()
    expect(s.selectedEdgeId).toBeNull()
    expect(s.selectionSource).toBeNull()
    expect(s.highlightedRowKey).toBeNull()
    // Set fields cleared to fresh empty Set (NOT null).
    expect(s.selectedNodeIds).toBeInstanceOf(Set)
    expect(s.selectedNodeIds.size).toBe(0)
    expect(s.focalNodeId).toBeNull()
    expect(s.selectedBucketKeys).toBeInstanceOf(Set)
    expect(s.selectedBucketKeys.size).toBe(0)
    expect(s.focalBucketKey).toBeNull()
    expect(s.pathToSelected.size).toBe(0)
    expect(s.lslSessionFilter).toEqual([])
    expect(s.lslFilterEntityIds).toBeNull()
  })

  test('clearSelection() does NOT touch searchQuery, selectedClasses, visibleLevels', () => {
    useViewerStore.setState({
      searchQuery: 'docker',
      selectedClasses: new Set<string>(['Component']),
      visibleLevels: new Set([1, 2]),
      selectedNodeIds: new Set<string>(['n']),
      focalNodeId: 'n',
    })
    useViewerStore.getState().clearSelection()
    const s = useViewerStore.getState()
    expect(s.searchQuery).toBe('docker')
    expect(s.selectedClasses.has('Component')).toBe(true)
    expect(s.visibleLevels.has(1)).toBe(true)
    expect(s.visibleLevels.has(2)).toBe(true)
  })

  // ------ reset() WR-04 closure (invariant #5) ------

  test('reset() clears LSL slice + pathToSelected (WR-04 closure)', () => {
    // Phase 56's reset() left lslSessionFilter, lslFilterEntityIds, and
    // pathToSelected untouched — the gap surfaced as WR-04 in the Phase 56
    // review and is closed here. This test guards the closure.
    useViewerStore.setState({
      selectedNodeIds: new Set<string>(['n']),
      focalNodeId: 'n',
      lslSessionFilter: ['sess-a', 'sess-b'],
      lslFilterEntityIds: new Set<string>(['e1', 'e2']),
      pathToSelected: new Set<string>(['p1', 'p2']),
    })
    useViewerStore.getState().reset()
    const s = useViewerStore.getState()
    expect(s.lslSessionFilter).toEqual([])
    expect(s.lslFilterEntityIds).toBeNull()
    expect(s.pathToSelected.size).toBe(0)
    // And the selection slice is cleared too.
    expect(s.selectedNodeIds.size).toBe(0)
    expect(s.focalNodeId).toBeNull()
    expect(s.selectedBucketKeys.size).toBe(0)
    expect(s.focalBucketKey).toBeNull()
  })

  // ------ Phase 56 LSL guard still holds (carried-forward audit invariant #3) ------

  test('T-C [audit §4.4 R3 — carried forward]: setLslFilterEntityIds with identical content preserves the existing Set reference', () => {
    const first = new Set<string>(['a', 'b', 'c'])
    useViewerStore.getState().setLslFilterEntityIds(first)
    const after1 = useViewerStore.getState().lslFilterEntityIds
    expect(after1).toBe(first)
    useViewerStore.getState().setLslFilterEntityIds(new Set<string>(['c', 'a', 'b']))
    const after2 = useViewerStore.getState().lslFilterEntityIds
    expect(after2).toBe(after1)
  })

  test('T-C [audit §4.4 R3 — carried forward]: setLslFilterEntityIds with DIFFERENT content writes a fresh reference', () => {
    useViewerStore.getState().setLslFilterEntityIds(new Set<string>(['a', 'b']))
    const ref1 = useViewerStore.getState().lslFilterEntityIds
    useViewerStore.getState().setLslFilterEntityIds(new Set<string>(['a', 'b', 'c']))
    const ref2 = useViewerStore.getState().lslFilterEntityIds
    expect(ref2).not.toBe(ref1)
    expect(ref2).toBeInstanceOf(Set)
    expect((ref2 as Set<string>).has('c')).toBe(true)
  })

  test('T-C [audit §4.4 R3 — carried forward]: setLslFilterEntityIds(null) when current is null preserves null (no spurious write)', () => {
    useViewerStore.getState().setLslFilterEntityIds(null)
    useViewerStore.getState().setLslFilterEntityIds(null)
    expect(useViewerStore.getState().lslFilterEntityIds).toBeNull()
  })

  test('T-C [audit §4.4 R3 — carried forward]: setLslFilterEntityIds(null) when current is a Set writes null', () => {
    useViewerStore.getState().setLslFilterEntityIds(new Set<string>(['a']))
    useViewerStore.getState().setLslFilterEntityIds(null)
    expect(useViewerStore.getState().lslFilterEntityIds).toBeNull()
  })

  // ------ Source-grep sentinels (structural lock) ------

  test('56.1 selection slice: required field names present in source', () => {
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/store/viewer-store.ts'),
      'utf8',
    )
    // The four NEW Phase 56.1 selection-slice field names MUST appear in the
    // store source so a silent rename in a future refactor cannot pass tsc.
    expect(src).toMatch(/\bselectedNodeIds\b/)
    expect(src).toMatch(/\bfocalNodeId\b/)
    expect(src).toMatch(/\bselectedBucketKeys\b/)
    expect(src).toMatch(/\bfocalBucketKey\b/)
    // And the action surface stays named.
    expect(src).toMatch(/\bsetSelection\b/)
    expect(src).toMatch(/\bclearSelection\b/)
    expect(src).toMatch(/\bselectionSource\b/)
    expect(src).toMatch(/\bhighlightedRowKey\b/)
  })

  test('56.1 selection slice: three Phase 56 single-selection field names are gone from active source', () => {
    // Comment-only mentions (the historical "Promotes Phase 56's one-to-one
    // selection (selectedNodeId)" comment) are allowed; active source paths
    // MUST NOT contain the deleted names.
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/store/viewer-store.ts'),
      'utf8',
    )
    const nonCommentLines = src
      .split('\n')
      .filter((line) => !/^\s*\/\//.test(line))
      .join('\n')
    // selectedNodeId (without trailing 's') MUST NOT appear in active source.
    // Use look-behind/look-ahead to exclude the new `selectedNodeIds`.
    const stripped = nonCommentLines.replace(/selectedNodeIds/g, '')
    expect(stripped).not.toMatch(/\bselectedNodeId\b/)
    expect(stripped).not.toMatch(/\bselectedSessionId\b/)
    expect(stripped).not.toMatch(/\bselectedSessionStartAt\b/)
  })

  test('Logger discipline: viewer-store.ts source has no raw console.* call', () => {
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/store/viewer-store.ts'),
      'utf8',
    )
    expect(src).not.toMatch(/console\.(log|warn|error|info|debug|trace)/)
  })
})

// 2026-06-14 — Plan 06 gap-closure Decision 1: selection-history stack.
// Operator UX contract: Esc / X is a one-step-back action (Layer 2 → Layer 1)
// when a drill happened; otherwise falls through to clearSelection (Layer 1 → Layer 0).
// The stack is one-deep only — no chain — to avoid browser-back-button-style
// ambiguity on a graph viewer.
describe('useViewerStore — Plan 06 Decision 1 selection-history stack', () => {
  beforeEach(() => {
    useViewerStore.getState().clearSelection()
  })

  test('initial state: selectionHistory is null at fresh mount', () => {
    expect(useViewerStore.getState().selectionHistory).toBeNull()
  })

  test('setSelection without pushHistory does NOT touch selectionHistory', () => {
    useViewerStore.getState().setSelection({
      nodeIds: new Set<string>(['n1']),
      source: 'timeline',
    })
    expect(useViewerStore.getState().selectionHistory).toBeNull()
  })

  test('setSelection with pushHistory: true on empty selection (Layer 0 → Layer 1) does NOT push — nothing meaningful to remember', () => {
    // shouldPush guard: pushHistory && (selectedNodeIds.size > 0 || selectedBucketKeys.size > 0).
    // Both pre-write sets are empty here so the guard rejects the push.
    useViewerStore.getState().setSelection({
      nodeIds: new Set<string>(['n1']),
      source: 'graph',
      pushHistory: true,
    })
    expect(useViewerStore.getState().selectionHistory).toBeNull()
  })

  test('setSelection with pushHistory: true on Layer 1 (selection populated) captures pre-write snapshot', () => {
    // Establish Layer 1 first (without push).
    useViewerStore.getState().setSelection({
      nodeIds: new Set<string>(['n1', 'n2']),
      bucketKeys: new Set<string>(['b1|2026-06-14T00:00:00Z']),
      focal: { nodeId: 'n1', bucketKey: 'b1|2026-06-14T00:00:00Z' },
      source: 'timeline',
    })
    expect(useViewerStore.getState().selectionHistory).toBeNull()
    // Drill: Layer 1 → Layer 2.
    useViewerStore.getState().setSelection({
      nodeIds: new Set<string>(['n3']),
      bucketKeys: new Set<string>(),
      focal: { nodeId: 'n3', bucketKey: null },
      source: 'history',
      pushHistory: true,
    })
    const s = useViewerStore.getState()
    expect(s.selectionHistory).not.toBeNull()
    expect(s.selectionHistory?.selectedNodeIds.has('n1')).toBe(true)
    expect(s.selectionHistory?.selectedNodeIds.has('n2')).toBe(true)
    expect(s.selectionHistory?.focalNodeId).toBe('n1')
    expect(s.selectionHistory?.selectedBucketKeys.has('b1|2026-06-14T00:00:00Z')).toBe(true)
    expect(s.selectionHistory?.selectionSource).toBe('timeline')
    // Post-drill state.
    expect(s.focalNodeId).toBe('n3')
    expect(s.selectionSource).toBe('history')
  })

  test('popSelection on Layer 2 restores Layer 1 EXACTLY and clears history (one-deep stack)', () => {
    // Layer 1 setup.
    const l1NodeIds = new Set<string>(['n1', 'n2'])
    const l1BucketKeys = new Set<string>(['b1|t1'])
    const l1LslIds = new Set<string>(['raw-1', 'raw-2'])
    useViewerStore.getState().setSelection({
      nodeIds: l1NodeIds,
      bucketKeys: l1BucketKeys,
      focal: { nodeId: 'n1', bucketKey: 'b1|t1' },
      source: 'timeline',
      lslSessionFilter: ['b1'],
      lslFilterEntityIds: l1LslIds,
    })
    // Drill to Layer 2.
    useViewerStore.getState().setSelection({
      nodeIds: new Set<string>(['n3']),
      bucketKeys: new Set<string>(),
      focal: { nodeId: 'n3', bucketKey: null },
      source: 'history',
      pushHistory: true,
    })
    // Pop.
    const popped = useViewerStore.getState().popSelection()
    expect(popped).toBe(true)
    const s = useViewerStore.getState()
    // Layer 1 restored EXACTLY — same Set references (reference-stable
    // restore matters for downstream useMemo deps).
    expect(s.selectedNodeIds).toBe(l1NodeIds)
    expect(s.selectedBucketKeys).toBe(l1BucketKeys)
    expect(s.lslFilterEntityIds).toBe(l1LslIds)
    expect(s.focalNodeId).toBe('n1')
    expect(s.focalBucketKey).toBe('b1|t1')
    expect(s.selectionSource).toBe('timeline')
    expect(s.lslSessionFilter).toEqual(['b1'])
    // Stack drained: history cleared.
    expect(s.selectionHistory).toBeNull()
  })

  test('WR-05: popSelection on Layer 1 (no history) returns false WITHOUT mutating state — caller calls clearSelection', () => {
    // 2026-06-14 (WR-05 fix — 56.1-REVIEW): popSelection now only pops.
    // The caller (Esc handler / X-button) gates on the return value and
    // calls clearSelection() itself when popSelection returns false.
    useViewerStore.getState().setSelection({
      nodeIds: new Set<string>(['n1']),
      source: 'graph',
    })
    expect(useViewerStore.getState().selectionHistory).toBeNull()
    const popped = useViewerStore.getState().popSelection()
    expect(popped).toBe(false)
    // State PRESERVED — pop was a no-op. The Esc/X handler is responsible
    // for the L1 → L0 transition via an explicit clearSelection() call.
    const s = useViewerStore.getState()
    expect(s.selectedNodeIds.size).toBe(1)
    expect(s.focalNodeId).toBe('n1')
    expect(s.selectionSource).toBe('graph')
  })

  test('WR-05: popSelection on Layer 0 (already clear) returns false and is a safe no-op', () => {
    // No selection, no history.
    expect(useViewerStore.getState().selectionHistory).toBeNull()
    expect(useViewerStore.getState().focalNodeId).toBeNull()
    const popped = useViewerStore.getState().popSelection()
    expect(popped).toBe(false)
    // Still cleared, no error thrown.
    expect(useViewerStore.getState().focalNodeId).toBeNull()
  })

  test('clearSelection() always drains selectionHistory too (full-clear semantic)', () => {
    // Layer 1 → Layer 2 drill, then full clear.
    useViewerStore.getState().setSelection({
      nodeIds: new Set<string>(['n1']),
      source: 'timeline',
    })
    useViewerStore.getState().setSelection({
      nodeIds: new Set<string>(['n2']),
      source: 'history',
      pushHistory: true,
    })
    expect(useViewerStore.getState().selectionHistory).not.toBeNull()
    useViewerStore.getState().clearSelection()
    expect(useViewerStore.getState().selectionHistory).toBeNull()
  })

  test('reset() drains selectionHistory too (mirrors clearSelection coverage — WR-04 invariant)', () => {
    useViewerStore.getState().setSelection({
      nodeIds: new Set<string>(['n1']),
      source: 'timeline',
    })
    useViewerStore.getState().setSelection({
      nodeIds: new Set<string>(['n2']),
      source: 'history',
      pushHistory: true,
    })
    expect(useViewerStore.getState().selectionHistory).not.toBeNull()
    useViewerStore.getState().reset()
    expect(useViewerStore.getState().selectionHistory).toBeNull()
  })

  test('stack is one-deep: drilling twice in a row does NOT chain — second drill captures the FIRST drill state (overwriting any prior history)', () => {
    // Layer 1.
    useViewerStore.getState().setSelection({
      nodeIds: new Set<string>(['n1']),
      bucketKeys: new Set<string>(['b1|t1']),
      source: 'timeline',
    })
    // First drill.
    useViewerStore.getState().setSelection({
      nodeIds: new Set<string>(['n2']),
      source: 'history',
      pushHistory: true,
    })
    const firstHistory = useViewerStore.getState().selectionHistory
    expect(firstHistory?.selectedNodeIds.has('n1')).toBe(true)
    // Second drill (e.g., user clicks another card directly from the drill view).
    useViewerStore.getState().setSelection({
      nodeIds: new Set<string>(['n3']),
      source: 'history',
      pushHistory: true,
    })
    const secondHistory = useViewerStore.getState().selectionHistory
    // History was overwritten with the FIRST drill's state, NOT chained
    // beneath the original Layer 1. One-deep semantic.
    expect(secondHistory).not.toBe(firstHistory)
    expect(secondHistory?.selectedNodeIds.has('n2')).toBe(true)
    expect(secondHistory?.selectedNodeIds.has('n1')).toBe(false)
    // Pop → restores the SECOND drill's source, not Layer 1.
    useViewerStore.getState().popSelection()
    const s = useViewerStore.getState()
    expect(s.focalNodeId).toBe('n2')
    expect(s.selectionHistory).toBeNull()
  })
})

// ----------------------------------------------------------------------------
// Phase 60 Plan 03 (G3) — showDebugEntityTypes toggle for Observation/Digest
// re-enable.
//
// PATTERN SOURCE: 60-03-PLAN.md Task 1 <behavior>
//
// Decisions:
//   - D-09: visibility-predicate.ts:46-47 hard-exclusion stays as default.
//           Predicate gates on filters.showDebugEntityTypes !== true.
//   - D-10: GraphToggles surfaces a "Show debug entity types" row.
//   - D-11: Non-persistent — resets to false every page load (no localStorage).
//
// Phase 56.1 D-1 invariant: selectedNodeIds / focalNodeId / selectedBucketKeys
// remain untouched — the new field is additive only.
// ----------------------------------------------------------------------------

describe('useViewerStore — Phase 60-03 showDebugEntityTypes (D-09..D-11)', () => {
  const initial = () =>
    (useViewerStore as unknown as { getInitialState: () => ViewerStateAny }).getInitialState()

  beforeEach(() => {
    useViewerStore.setState({
      showDebugEntityTypes: false,
    } as unknown as Partial<ViewerState>)
  })

  test('Store test 1 (D-11 default): showDebugEntityTypes === false on fresh init', () => {
    expect(initial().showDebugEntityTypes).toBe(false)
  })

  test('Store test 2: toggleShowDebugEntityTypes flips false → true → false', () => {
    expect(useViewerStore.getState().showDebugEntityTypes).toBe(false)
    useViewerStore.getState().toggleShowDebugEntityTypes()
    expect(useViewerStore.getState().showDebugEntityTypes).toBe(true)
    useViewerStore.getState().toggleShowDebugEntityTypes()
    expect(useViewerStore.getState().showDebugEntityTypes).toBe(false)
  })

  test('Store test 3 (D-11 no persistence): source has no persist/partialize wiring for the new field', () => {
    // Source-grep assertion — viewer-store.ts must NOT wrap showDebugEntityTypes
    // in any persist/partialize/localStorage middleware. Strip comments first
    // so the explanatory prose in JSDoc / `// ...` doesn't match (the comments
    // themselves mention "persist" and "localStorage" because they explain
    // WHY the field is non-persistent).
    const raw = readFileSync(path.join(__dirname, 'viewer-store.ts'), 'utf8')
    const code = raw
      // strip block comments /* ... */
      .replace(/\/\*[\s\S]*?\*\//g, '')
      // strip line comments // ...
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\/\/.*$/gm, '')
    // The Zustand persist middleware is invoked as `persist(...)`; partialize
    // appears as a property in the persist options object. localStorage either
    // appears directly or via `createJSONStorage(() => localStorage)`.
    expect(code.match(/\bpersist\s*\(/)).toBeNull()
    expect(code.match(/\bpartialize\b/)).toBeNull()
    expect(code.match(/\blocalStorage\b/)).toBeNull()
    // Defence-in-depth: even if a future persist() lands for some OTHER field,
    // showDebugEntityTypes must not appear in a partialize predicate.
    expect(code.match(/partialize[\s\S]{0,300}showDebugEntityTypes/)).toBeNull()
    expect(code.match(/showDebugEntityTypes[\s\S]{0,300}partialize/)).toBeNull()
  })

  test('Store test 4 (Phase 56.1 D-1 invariant): selectedNodeIds / focalNodeId / selectedBucketKeys untouched, additive only', () => {
    const s = initial()
    // Phase 56.1 multi-set shape still present.
    expect(s.selectedNodeIds).toBeInstanceOf(Set)
    expect(s.selectedNodeIds.size).toBe(0)
    expect(s.focalNodeId).toBeNull()
    expect(s.selectedBucketKeys).toBeInstanceOf(Set)
    expect(s.selectedBucketKeys.size).toBe(0)
    // New field is purely additive.
    expect(s.showDebugEntityTypes).toBe(false)
    expect(typeof s.toggleShowDebugEntityTypes).toBe('function')
  })
})

// ----------------------------------------------------------------------------
// Plan 60-08 Gap E — hoveredNodeId slice (bidirectional hover).
// Strictly additive; must NOT touch the Phase 56.1 D-1 multi-selection slice.
// ----------------------------------------------------------------------------
describe('useViewerStore — hoveredNodeId slice (Plan 60-08 Gap E)', () => {
  beforeEach(() => {
    useViewerStore.setState({ hoveredNodeId: null })
  })

  test('Test 1: default hoveredNodeId is null', () => {
    useViewerStore.getState().setHoveredNodeId(null)
    expect(useViewerStore.getState().hoveredNodeId).toBeNull()
  })

  test('Test 2: setHoveredNodeId sets then clears', () => {
    useViewerStore.getState().setHoveredNodeId('abc')
    expect(useViewerStore.getState().hoveredNodeId).toBe('abc')
    useViewerStore.getState().setHoveredNodeId(null)
    expect(useViewerStore.getState().hoveredNodeId).toBeNull()
  })

  test('Test 3: setHoveredNodeId does NOT touch the multi-selection slice (56.1 D-1)', () => {
    useViewerStore.setState({
      selectedNodeIds: new Set<string>(['keep']),
      focalNodeId: 'keep',
      selectedBucketKeys: new Set<string>(['bucket-1']),
    })
    useViewerStore.getState().setHoveredNodeId('hover-id')
    const s = useViewerStore.getState()
    expect(s.hoveredNodeId).toBe('hover-id')
    expect(s.selectedNodeIds.has('keep')).toBe(true)
    expect(s.focalNodeId).toBe('keep')
    expect(s.selectedBucketKeys.has('bucket-1')).toBe(true)
  })
})

describe('useViewerStore — legend click-to-toggle (2026-06-19)', () => {
  beforeEach(() => {
    useViewerStore.setState({ hiddenRelationTypes: new Set(), hiddenNodeTypes: new Set() })
  })
  it('toggleRelationType adds then removes a type', () => {
    useViewerStore.getState().toggleRelationType('contains')
    expect(useViewerStore.getState().hiddenRelationTypes.has('contains')).toBe(true)
    useViewerStore.getState().toggleRelationType('contains')
    expect(useViewerStore.getState().hiddenRelationTypes.has('contains')).toBe(false)
  })
  it('toggleNodeType adds then removes a type', () => {
    useViewerStore.getState().toggleNodeType('Component')
    expect(useViewerStore.getState().hiddenNodeTypes.has('Component')).toBe(true)
    useViewerStore.getState().toggleNodeType('Component')
    expect(useViewerStore.getState().hiddenNodeTypes.has('Component')).toBe(false)
  })
  it('emits a fresh Set reference each toggle (so memo consumers re-render)', () => {
    const before = useViewerStore.getState().hiddenRelationTypes
    useViewerStore.getState().toggleRelationType('mentions')
    expect(useViewerStore.getState().hiddenRelationTypes).not.toBe(before)
  })
  it('node-type and relation-type hidden sets are independent', () => {
    useViewerStore.getState().toggleNodeType('Detail')
    useViewerStore.getState().toggleRelationType('related_to')
    expect(useViewerStore.getState().hiddenNodeTypes.has('Detail')).toBe(true)
    expect(useViewerStore.getState().hiddenRelationTypes.has('related_to')).toBe(true)
    expect(useViewerStore.getState().hiddenNodeTypes.has('related_to')).toBe(false)
  })
})

describe('useViewerStore — legend select all/none (2026-06-19)', () => {
  beforeEach(() => {
    useViewerStore.setState({ hiddenRelationTypes: new Set(['x']), hiddenNodeTypes: new Set(['y']) })
  })
  it('setHiddenRelationTypes([]) shows all; full list hides all', () => {
    useViewerStore.getState().setHiddenRelationTypes([])
    expect(useViewerStore.getState().hiddenRelationTypes.size).toBe(0)
    useViewerStore.getState().setHiddenRelationTypes(['contains', 'mentions'])
    expect([...useViewerStore.getState().hiddenRelationTypes].sort()).toEqual(['contains', 'mentions'])
  })
  it('setHiddenNodeTypes([]) shows all; full list hides all', () => {
    useViewerStore.getState().setHiddenNodeTypes([])
    expect(useViewerStore.getState().hiddenNodeTypes.size).toBe(0)
    useViewerStore.getState().setHiddenNodeTypes(['Component', 'Detail'])
    expect(useViewerStore.getState().hiddenNodeTypes.size).toBe(2)
  })
  it('copies the input into a fresh Set (caller mutation does not leak)', () => {
    const src = ['a', 'b']
    useViewerStore.getState().setHiddenRelationTypes(src)
    src.push('c')
    expect(useViewerStore.getState().hiddenRelationTypes.has('c')).toBe(false)
  })
})
