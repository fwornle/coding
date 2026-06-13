// PATTERN SOURCE: 45-01-PLAN.md Task 2 <behavior> Test 3
//
// useViewerStore.getState().reset() clears in-system selection + search + selectedClasses,
// but DOES NOT clear visibleLevels (filter defaults persist across in-system reset by
// design — cross-system reset is the remount).
import { describe, test, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { useViewerStore, type ViewerState } from './viewer-store'

// Alias for the few tests that call getInitialState() via a generic cast — we
// want the real `ViewerState` typing while skirting the StoreApi generic.
type ViewerStateAny = ViewerState

describe('useViewerStore', () => {
  beforeEach(() => {
    // Restore fresh defaults before each test
    useViewerStore.setState({
      selectedNodeId: null,
      selectedEdgeId: null,
      searchQuery: '',
      visibleLevels: new Set([0, 1, 2, 3]),
      selectedClasses: new Set<string>(),
      theme: 'light',
      filterRailCollapsed: false,
    })
  })

  test('reset() clears selectedNodeId, selectedEdgeId, searchQuery, selectedClasses', () => {
    const store = useViewerStore.getState()
    store.setSelectedNode('n1')
    store.setSelectedEdge('e1')
    store.setSearch('foo')
    store.toggleClass('Observation')

    expect(useViewerStore.getState().selectedNodeId).toBe('n1')
    expect(useViewerStore.getState().selectedEdgeId).toBe('e1')
    expect(useViewerStore.getState().searchQuery).toBe('foo')
    expect(useViewerStore.getState().selectedClasses.has('Observation')).toBe(true)

    useViewerStore.getState().reset()
    const s = useViewerStore.getState()
    expect(s.selectedNodeId).toBeNull()
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

  test('initial state: show* booleans all false', () => {
    const s = initial()
    expect(s.showEdges).toBe(false)
    expect(s.showClusters).toBe(false)
    expect(s.showRelationLabels).toBe(false)
    expect(s.showMergedOnly).toBe(false)
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

  test('BC: Phase 45 fields still present with their original initial values', () => {
    const s = initial()
    expect(s.selectedNodeId).toBeNull()
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
      selectedNodeId: null,
      selectedEdgeId: null,
      searchQuery: '',
      visibleLevels: new Set([0, 1, 2, 3]),
      selectedClasses: new Set<string>(),
      selectedLayers: [],
      selectedDomains: [],
      selectedOntologyClasses: [],
      showEdges: false,
      showClusters: false,
      showRelationLabels: false,
      showMergedOnly: false,
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

  test("toggleLayer('evidence') from empty list adds it", () => {
    useViewerStore.getState().toggleLayer('evidence')
    expect(useViewerStore.getState().selectedLayers).toEqual(['evidence'])
  })

  test("toggleLayer('evidence') when already present removes it", () => {
    useViewerStore.getState().toggleLayer('evidence')
    useViewerStore.getState().toggleLayer('evidence')
    expect(useViewerStore.getState().selectedLayers).toEqual([])
  })

  test('toggleDomain adds and removes (VOKB parity)', () => {
    useViewerStore.getState().toggleDomain('raas')
    expect(useViewerStore.getState().selectedDomains).toEqual(['raas'])
    useViewerStore.getState().toggleDomain('kpifw')
    expect(useViewerStore.getState().selectedDomains).toEqual(['raas', 'kpifw'])
    useViewerStore.getState().toggleDomain('raas')
    expect(useViewerStore.getState().selectedDomains).toEqual(['kpifw'])
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

  test('toggleShowEdges flips boolean', () => {
    expect(useViewerStore.getState().showEdges).toBe(false)
    useViewerStore.getState().toggleShowEdges()
    expect(useViewerStore.getState().showEdges).toBe(true)
    useViewerStore.getState().toggleShowEdges()
    expect(useViewerStore.getState().showEdges).toBe(false)
  })

  test('toggleShowClusters / toggleShowRelationLabels / toggleShowMergedOnly / toggleHideDocNodes flip', () => {
    const s = useViewerStore.getState()
    s.toggleShowClusters()
    s.toggleShowRelationLabels()
    s.toggleShowMergedOnly()
    s.toggleHideDocNodes()
    const after = useViewerStore.getState()
    expect(after.showClusters).toBe(true)
    expect(after.showRelationLabels).toBe(true)
    expect(after.showMergedOnly).toBe(true)
    expect(after.hideDocNodes).toBe(true)
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

  test('BC: Phase 45 actions setSelectedNode / setSelectedEdge / setSearch still work identically', () => {
    useViewerStore.getState().setSelectedNode('node-1')
    useViewerStore.getState().setSelectedEdge('edge-1')
    useViewerStore.getState().setSearch('hello')
    const s = useViewerStore.getState()
    expect(s.selectedNodeId).toBe('node-1')
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
// Phase 56 Plan 01 — cross-pane selection sync
//
// PATTERN SOURCE: 56-01-PLAN.md Task 1 <behavior> + 56-PATTERNS.md § viewer-store.ts (EXTEND).
// CONTEXT.md decisions: shared state lives in viewer-store; no panel keeps a
// local selection; Esc + click-empty-bg cascades through ALL three panes via
// a single store action; selection scope covers both entity nodes AND
// aggregate LSL session selection.
//
// `setSelection({ ... })` is the atomic multi-field write that downstream
// Plans 02/03/04 use to keep subscribers consistent. `clearSelection()` is
// the cross-pane variant of `clearLslSessionFilter()` — it also clears LSL
// filter slices so Esc + bg-click leave the user in a fully cleared state.
//
// Source-grep gates assert the five selection-sync identifiers are present
// in the store source so a silent rename (e.g. `setSelection` → `applySelection`)
// cannot pass tsc and slip through review.
// ----------------------------------------------------------------------------

describe('useViewerStore — Phase 56 cross-pane selection sync', () => {
  const initial = () =>
    (useViewerStore as unknown as { getInitialState: () => ViewerState }).getInitialState()

  beforeEach(() => {
    useViewerStore.setState({
      selectionSource: null,
      highlightedRowKey: null,
      selectedSessionId: null,
      // 2026-06-13 (audit §6.2): the sibling field must be reset too so each
      // test starts from a clean slate.
      selectedSessionStartAt: null,
      selectedNodeId: null,
      selectedEdgeId: null,
      pathToSelected: new Set<string>(),
      lslSessionFilter: [],
      lslFilterEntityIds: null,
    })
  })

  test('initial state: selectionSource === null', () => {
    expect(initial().selectionSource).toBeNull()
  })

  test('initial state: highlightedRowKey === null', () => {
    expect(initial().highlightedRowKey).toBeNull()
  })

  test('initial state: selectedSessionId === null', () => {
    expect(initial().selectedSessionId).toBeNull()
  })

  test('initial state: selectedSessionStartAt === null (audit §6.2 — option A — additive sibling of selectedSessionId)', () => {
    expect(initial().selectedSessionStartAt).toBeNull()
  })

  test('setSelection({ nodeId, source: "graph" }) writes nodeId + source atomically and resets pathToSelected', () => {
    useViewerStore.setState({ pathToSelected: new Set<string>(['old1', 'old2']) })
    useViewerStore.getState().setSelection({ nodeId: 'e1', source: 'graph' })
    const s = useViewerStore.getState()
    expect(s.selectedNodeId).toBe('e1')
    expect(s.selectionSource).toBe('graph')
    // pathToSelected reset when nodeId changes and no explicit path provided
    expect(s.pathToSelected.size).toBe(0)
  })

  test('setSelection({ nodeId, source, pathToSelected }) honors the explicit path', () => {
    const path = new Set<string>(['e1', 'sys'])
    useViewerStore.getState().setSelection({ nodeId: 'e1', source: 'graph', pathToSelected: path })
    const s = useViewerStore.getState()
    expect(s.selectedNodeId).toBe('e1')
    expect(s.selectionSource).toBe('graph')
    expect(Array.from(s.pathToSelected).sort()).toEqual(['e1', 'sys'])
  })

  test('setSelection({ sessionId, source: "timeline" }) writes sessionId + source without touching selectedNodeId', () => {
    useViewerStore.setState({ selectedNodeId: 'keep-me' })
    useViewerStore.getState().setSelection({ sessionId: 'sess-x', source: 'timeline' })
    const s = useViewerStore.getState()
    expect(s.selectedNodeId).toBe('keep-me')
    expect(s.selectedSessionId).toBe('sess-x')
    expect(s.selectionSource).toBe('timeline')
  })

  test('setSelection({ sessionId, sessionStartAt, source: "timeline" }) writes BOTH session fields together (audit §6.2 + §7 R2 round-trip)', () => {
    useViewerStore.getState().setSelection({
      sessionId: 'sess-x',
      sessionStartAt: '2026-06-13T11:00:00Z',
      source: 'timeline',
    })
    const s = useViewerStore.getState()
    expect(s.selectedSessionId).toBe('sess-x')
    expect(s.selectedSessionStartAt).toBe('2026-06-13T11:00:00Z')
    expect(s.selectionSource).toBe('timeline')
  })

  test('setSelection({ sessionId, source }) without sessionStartAt resets sessionStartAt to null (audit §7 R2 — never leave the sibling stale)', () => {
    // Pre-seed both fields with a "previous tranche" snapshot — the analogue
    // of clicking tranche A of sess-X first (sets both id and startAt).
    useViewerStore.setState({
      selectedSessionId: 'sess-prev',
      selectedSessionStartAt: '2026-06-13T10:00:00Z',
    })
    // Now write only sessionId (no sessionStartAt). The action MUST null the
    // sibling — otherwise the (id, startAt) pair becomes inconsistent.
    useViewerStore.getState().setSelection({ sessionId: 'sess-new', source: 'timeline' })
    const s = useViewerStore.getState()
    expect(s.selectedSessionId).toBe('sess-new')
    expect(s.selectedSessionStartAt).toBeNull()
  })

  test('setSelection({ nodeId, source }) without sessionId preserves both session fields (audit §6.2 — only sibling-reset when sessionId is in args)', () => {
    useViewerStore.setState({
      selectedSessionId: 'sess-keep',
      selectedSessionStartAt: '2026-06-13T10:00:00Z',
    })
    useViewerStore.getState().setSelection({ nodeId: 'e1', source: 'graph' })
    const s = useViewerStore.getState()
    expect(s.selectedNodeId).toBe('e1')
    expect(s.selectedSessionId).toBe('sess-keep')
    expect(s.selectedSessionStartAt).toBe('2026-06-13T10:00:00Z')
  })

  test('setSelection({ nodeId, highlightedRowKey, source }) writes all three; getState snapshot is coherent', () => {
    useViewerStore.getState().setSelection({
      nodeId: 'e2',
      highlightedRowKey: 'row-e2',
      source: 'history',
    })
    const s = useViewerStore.getState()
    expect(s.selectedNodeId).toBe('e2')
    expect(s.highlightedRowKey).toBe('row-e2')
    expect(s.selectionSource).toBe('history')
  })

  test('clearSelection() nulls selectedNodeId, selectedEdgeId, selectionSource, highlightedRowKey, selectedSessionId, selectedSessionStartAt AND empties lslSessionFilter AND nulls lslFilterEntityIds AND resets pathToSelected', () => {
    useViewerStore.setState({
      selectedNodeId: 'n',
      selectedEdgeId: 'e',
      selectionSource: 'graph',
      highlightedRowKey: 'r',
      selectedSessionId: 's',
      selectedSessionStartAt: '2026-06-13T11:00:00Z',
      pathToSelected: new Set<string>(['a', 'b']),
      lslSessionFilter: ['sess1'],
      lslFilterEntityIds: new Set<string>(['x']),
    })
    useViewerStore.getState().clearSelection()
    const s = useViewerStore.getState()
    expect(s.selectedNodeId).toBeNull()
    expect(s.selectedEdgeId).toBeNull()
    expect(s.selectionSource).toBeNull()
    expect(s.highlightedRowKey).toBeNull()
    expect(s.selectedSessionId).toBeNull()
    // 2026-06-13 (audit §6.2 + §7 R2): paired clear with selectedSessionId.
    expect(s.selectedSessionStartAt).toBeNull()
    expect(s.pathToSelected.size).toBe(0)
    expect(s.lslSessionFilter).toEqual([])
    expect(s.lslFilterEntityIds).toBeNull()
  })

  test('clearSelection() does NOT touch searchQuery, selectedClasses, visibleLevels', () => {
    useViewerStore.setState({
      searchQuery: 'docker',
      selectedClasses: new Set<string>(['Component']),
      visibleLevels: new Set([1, 2]),
      selectedNodeId: 'n',
    })
    useViewerStore.getState().clearSelection()
    const s = useViewerStore.getState()
    expect(s.searchQuery).toBe('docker')
    expect(s.selectedClasses.has('Component')).toBe(true)
    expect(s.visibleLevels.has(1)).toBe(true)
    expect(s.visibleLevels.has(2)).toBe(true)
  })

  test('reset() also clears the four Phase 56 selection fields (incl. selectedSessionStartAt per audit §6.2)', () => {
    useViewerStore.setState({
      selectionSource: 'graph',
      highlightedRowKey: 'rk',
      selectedSessionId: 'sid',
      selectedSessionStartAt: '2026-06-13T11:00:00Z',
    })
    useViewerStore.getState().reset()
    const s = useViewerStore.getState()
    expect(s.selectionSource).toBeNull()
    expect(s.highlightedRowKey).toBeNull()
    expect(s.selectedSessionId).toBeNull()
    expect(s.selectedSessionStartAt).toBeNull()
  })

  test('source-grep gate: viewer-store.ts source contains the 6 Phase 56 identifiers (word-boundary regex) — incl. selectedSessionStartAt per audit §6.2', () => {
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/store/viewer-store.ts'),
      'utf8',
    )
    expect(src).toMatch(/\bsetSelection\b/)
    expect(src).toMatch(/\bclearSelection\b/)
    expect(src).toMatch(/\bselectionSource\b/)
    expect(src).toMatch(/\bhighlightedRowKey\b/)
    expect(src).toMatch(/\bselectedSessionId\b/)
    expect(src).toMatch(/\bselectedSessionStartAt\b/)
  })

  test('Logger discipline: viewer-store.ts source has no raw console.* call', () => {
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/store/viewer-store.ts'),
      'utf8',
    )
    expect(src).not.toMatch(/console\.(log|warn|error|info|debug|trace)/)
  })

  // ====================================================================
  // T-C [audit §4.4 R3]: setLslFilterEntityIds must preserve REFERENCE
  // equality when content does not change. The audit's diagnosis is:
  //   - The D3GraphCanvas main render effect deps include `visibleEntities`
  //   - `visibleEntities` is `useMemo([... lslFilterEntityIds])`
  //   - If `setLslFilterEntityIds(newSetWithSameContent)` produces a fresh
  //     `Set` reference, useMemo invalidates → SVG rebuilds + force restarts
  //   - This IS the "zoom feel" Issue 1 root cause (audit §4.3)
  // The fix lives in Commit 4. This test is RED at Commit 2.
  // ====================================================================
  test('T-C [audit §4.4 R3]: setLslFilterEntityIds with identical content preserves the existing Set reference (no spurious re-render)', () => {
    const first = new Set<string>(['a', 'b', 'c'])
    useViewerStore.getState().setLslFilterEntityIds(first)
    const after1 = useViewerStore.getState().lslFilterEntityIds
    expect(after1).toBe(first)
    // Now write a NEW Set with the SAME content. The reference MUST be
    // preserved (after2 === after1) so downstream useMemo deps don't
    // invalidate.
    useViewerStore.getState().setLslFilterEntityIds(new Set<string>(['c', 'a', 'b']))
    const after2 = useViewerStore.getState().lslFilterEntityIds
    expect(after2).toBe(after1)
  })

  test('T-C [audit §4.4 R3]: setLslFilterEntityIds with DIFFERENT content writes a fresh reference', () => {
    useViewerStore.getState().setLslFilterEntityIds(new Set<string>(['a', 'b']))
    const ref1 = useViewerStore.getState().lslFilterEntityIds
    useViewerStore.getState().setLslFilterEntityIds(new Set<string>(['a', 'b', 'c']))
    const ref2 = useViewerStore.getState().lslFilterEntityIds
    expect(ref2).not.toBe(ref1)
    // Content actually changed.
    expect(ref2).toBeInstanceOf(Set)
    expect((ref2 as Set<string>).has('c')).toBe(true)
  })

  test('T-C [audit §4.4 R3]: setLslFilterEntityIds(null) when current is null preserves null (no spurious write)', () => {
    useViewerStore.getState().setLslFilterEntityIds(null)
    useViewerStore.getState().setLslFilterEntityIds(null)
    expect(useViewerStore.getState().lslFilterEntityIds).toBeNull()
  })

  test('T-C [audit §4.4 R3]: setLslFilterEntityIds(null) when current is a Set writes null', () => {
    useViewerStore.getState().setLslFilterEntityIds(new Set<string>(['a']))
    useViewerStore.getState().setLslFilterEntityIds(null)
    expect(useViewerStore.getState().lslFilterEntityIds).toBeNull()
  })
})
