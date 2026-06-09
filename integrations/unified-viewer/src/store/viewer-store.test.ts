// PATTERN SOURCE: 45-01-PLAN.md Task 2 <behavior> Test 3
//
// useViewerStore.getState().reset() clears in-system selection + search + selectedClasses,
// but DOES NOT clear visibleLevels (filter defaults persist across in-system reset by
// design — cross-system reset is the remount).
import { describe, test, expect, beforeEach } from 'vitest'
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
