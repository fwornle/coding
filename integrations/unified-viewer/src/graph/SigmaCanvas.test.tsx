// Tests for the SigmaCanvas internal reducers (pure functions extracted
// for testability). Cannot mount the full SigmaContainer under jsdom
// because sigma needs WebGL — verified manually via gsd-browser + npm run
// dev for the live rendering path. The reducer functions ARE testable
// here because they're pure over (node, data, store-snapshot).

import { describe, test, expect, beforeEach } from 'vitest'
import { makeEdgeReducer, makeNodeReducer } from './reducers'
import { useViewerStore } from '@/store/viewer-store'

describe('makeNodeReducer — sigma per-frame state translation', () => {
  beforeEach(() => {
    // Reset store between tests. Plan 03 round 2 semantic: empty
    // selectedClasses = nothing visible, so seed with 'Observation' so
    // tests of the default-render path see a visible node.
    useViewerStore.setState({
      selectedNodeId: null,
      searchQuery: '',
      visibleLevels: new Set([0, 1, 2, 3]),
      selectedClasses: new Set(['Observation']),
    })
  })

  test('default state — returns 1px slate-300 border with full opacity, hidden:false', () => {
    const reducer = makeNodeReducer(null)
    const result = reducer('a', { name: 'Alpha', label: 'Alpha', color: '#ff0000', size: 8, ontologyClass: 'Observation', level: 3 })
    expect(result.hidden).toBe(false)
    expect((result as { borderColor?: string }).borderColor).toBe('#cbd5e1')
    expect((result as { borderSize?: number }).borderSize).toBe(1)
    expect((result as { opacity?: number }).opacity).toBe(1.0)
  })

  test('hover state — 2px blue-400 ring stroke', () => {
    const reducer = makeNodeReducer('a')
    const result = reducer('a', { name: 'Alpha', label: 'Alpha', color: '#ff0000', size: 8, ontologyClass: 'Observation', level: 3 })
    expect((result as { borderColor?: string }).borderColor).toBe('#60a5fa')
    expect((result as { borderSize?: number }).borderSize).toBe(2)
  })

  test('selected state — 3px blue-500 stroke + glow', () => {
    useViewerStore.setState({ selectedNodeId: 'a' })
    const reducer = makeNodeReducer(null)
    const result = reducer('a', { name: 'Alpha', label: 'Alpha', color: '#ff0000', size: 8, ontologyClass: 'Observation', level: 3 })
    expect((result as { borderColor?: string }).borderColor).toBe('#3b82f6')
    expect((result as { borderSize?: number }).borderSize).toBe(3)
    expect((result as { glow?: { size: number } }).glow?.size).toBe(4)
  })

  test('search-match state — 2px amber-500 stroke', () => {
    useViewerStore.setState({ searchQuery: 'alp' })
    const reducer = makeNodeReducer(null)
    const result = reducer('a', { name: 'Alpha', label: 'Alpha', color: '#ff0000', size: 8, ontologyClass: 'Observation', level: 3 })
    expect((result as { borderColor?: string }).borderColor).toBe('#f59e0b')
    expect((result as { borderSize?: number }).borderSize).toBe(2)
  })

  test('search hides non-match (Plan 03 round 2: search now HIDES, not dims)', () => {
    useViewerStore.setState({ searchQuery: 'zzz-no-match' })
    const reducer = makeNodeReducer(null)
    const result = reducer('a', {
      name: 'Alpha',
      label: 'Alpha',
      color: '#ff0000',
      size: 8,
      ontologyClass: 'Observation',
      level: 3,
    })
    expect(result.hidden).toBe(true)
  })

  test('filter-hidden state — hidden: true', () => {
    useViewerStore.setState({
      visibleLevels: new Set([0, 1, 2]),
    })
    const reducer = makeNodeReducer(null)
    const result = reducer('a', {
      name: 'Alpha',
      label: 'Alpha',
      color: '#ff0000',
      size: 8,
      ontologyClass: 'Observation',
      level: 3,
    })
    expect(result.hidden).toBe(true)
  })

  test('empty selectedClasses Set → all nodes hidden', () => {
    useViewerStore.setState({ selectedClasses: new Set<string>() })
    const reducer = makeNodeReducer(null)
    const result = reducer('a', {
      name: 'Alpha',
      label: 'Alpha',
      color: '#ff0000',
      size: 8,
      ontologyClass: 'Observation',
      level: 3,
    })
    expect(result.hidden).toBe(true)
  })
})

describe('makeEdgeReducer', () => {
  beforeEach(() => {
    useViewerStore.setState({
      selectedNodeId: null,
      searchQuery: '',
      visibleLevels: new Set([0, 1, 2, 3]),
      selectedClasses: new Set(),
    })
  })

  test('default — slate hex #cbd5e1 at opacity 0.6 (Plan 03 round 2: sigma WebGL needs hex)', () => {
    const reducer = makeEdgeReducer()
    const result = reducer('e1', { source: 'a', target: 'b', color: '#000', size: 1 })
    expect((result as { color?: string }).color).toBe('#cbd5e1')
    expect((result as { opacity?: number }).opacity).toBe(0.6)
  })

  test('incident on selected — primary blue #3b82f6 at opacity 1.0', () => {
    useViewerStore.setState({ selectedNodeId: 'a' })
    const reducer = makeEdgeReducer()
    const result = reducer('e1', { source: 'a', target: 'b', color: '#000', size: 1 })
    expect((result as { color?: string }).color).toBe('#3b82f6')
    expect((result as { opacity?: number }).opacity).toBe(1.0)
  })
})

// -----------------------------------------------------------------------
// Plan 55-05: per-frame reducer threads borderStyle + halo from node
// attributes onto sigma's NodeDisplayData. The SHAPE_NODE_PROGRAMS map
// is exported separately for the SigmaContainer registration smoke test
// (cannot mount sigma under jsdom — WebGL is stubbed).
// -----------------------------------------------------------------------

import { SHAPE_NODE_PROGRAMS } from './reducers'

describe('SHAPE_NODE_PROGRAMS — Plan 55-05 (sigma nodeProgramClasses)', () => {
  test('exports a map keyed by the 5 supported shapes', () => {
    expect(Object.keys(SHAPE_NODE_PROGRAMS).sort()).toEqual(
      ['circle', 'diamond', 'hexagon', 'square', 'triangle'].sort(),
    )
  })

  test('every value is a constructor-like (function or class) — sigma rejects undefined values', () => {
    for (const [, prog] of Object.entries(SHAPE_NODE_PROGRAMS)) {
      // sigma's nodeProgramClasses values are NodeProgramConstructor — a
      // class/function. Non-function values silently disable the program.
      expect(typeof prog).toBe('function')
    }
  })
})

describe('makeNodeReducer — Plan 55-05 borderStyle + pulse halo threading', () => {
  beforeEach(() => {
    useViewerStore.setState({
      selectedNodeId: null,
      searchQuery: '',
      visibleLevels: new Set([0, 1, 2, 3]),
      selectedClasses: new Set(['Observation']),
    })
  })

  test('borderStyle from node attrs flows onto reducer output', () => {
    const reducer = makeNodeReducer(null)
    const result = reducer('a', {
      name: 'Alpha',
      label: 'Alpha',
      color: '#10b981',
      size: 8,
      ontologyClass: 'Observation',
      level: 3,
      borderStyle: 'dashed',
    })
    expect((result as { borderStyle?: string }).borderStyle).toBe('dashed')
  })

  test('pulseRule evaluates true (updatedAt within window) → halo present', () => {
    const reducer = makeNodeReducer(null)
    const updatedAt = new Date(Date.now() - 30_000).toISOString()
    const result = reducer('a', {
      name: 'Alpha',
      label: 'Alpha',
      color: '#10b981',
      size: 8,
      ontologyClass: 'Observation',
      level: 3,
      pulseRule: 'lastUpdatedWithin:60s',
      updatedAt,
    })
    const halo = (result as { halo?: { color: string; phase: number } }).halo
    expect(halo).toBeDefined()
    expect(typeof halo!.color).toBe('string')
    // phase ∈ [0, 1): in motion-on mode it cycles via Date.now()
    expect(halo!.phase).toBeGreaterThanOrEqual(0)
    expect(halo!.phase).toBeLessThan(1)
  })

  test('pulseRule evaluates false (stale updatedAt) → no halo', () => {
    const reducer = makeNodeReducer(null)
    const updatedAt = new Date(Date.now() - 61_000).toISOString()
    const result = reducer('a', {
      name: 'Alpha',
      label: 'Alpha',
      color: '#10b981',
      size: 8,
      ontologyClass: 'Observation',
      level: 3,
      pulseRule: 'lastUpdatedWithin:60s',
      updatedAt,
    })
    expect((result as { halo?: unknown }).halo).toBeUndefined()
  })

  test('prefers-reduced-motion: reduce → halo phase pinned to 0.5 (static peak ring)', () => {
    // Mock window.matchMedia to report reduced-motion=true.
    const realMatchMedia = window.matchMedia
    const mql = {
      matches: true,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }
    Object.defineProperty(window, 'matchMedia', {
      value: () => mql,
      writable: true,
      configurable: true,
    })

    try {
      const reducer = makeNodeReducer(null)
      const updatedAt = new Date(Date.now() - 30_000).toISOString()
      const result = reducer('a', {
        name: 'Alpha',
        label: 'Alpha',
        color: '#10b981',
        size: 8,
        ontologyClass: 'Observation',
        level: 3,
        pulseRule: 'lastUpdatedWithin:60s',
        updatedAt,
      })
      const halo = (result as { halo?: { phase: number } }).halo
      expect(halo).toBeDefined()
      // Static ring per UI-SPEC §12 + §15 — phase pinned so the SigmaCanvas
      // program draws a constant 50%-opacity ring instead of animating.
      expect(halo!.phase).toBe(0.5)
    } finally {
      Object.defineProperty(window, 'matchMedia', {
        value: realMatchMedia,
        writable: true,
        configurable: true,
      })
    }
  })

  test('no pulseRule attr → no halo (no spurious halo from undefined rule)', () => {
    const reducer = makeNodeReducer(null)
    const result = reducer('a', {
      name: 'Alpha',
      label: 'Alpha',
      color: '#10b981',
      size: 8,
      ontologyClass: 'Observation',
      level: 3,
      // pulseRule: undefined
    })
    expect((result as { halo?: unknown }).halo).toBeUndefined()
  })

  test('Phase 45 BC: no extension attrs → reducer output omits borderStyle/halo (does NOT break exact-shape tests)', () => {
    const reducer = makeNodeReducer(null)
    const result = reducer('a', {
      name: 'Alpha',
      label: 'Alpha',
      color: '#10b981',
      size: 8,
      ontologyClass: 'Observation',
      level: 3,
    })
    // borderStyle is allowed to be undefined here (the Phase 45 default-state
    // test asserts borderColor/borderSize/opacity equal to specific values
    // and doesn't check for missing borderStyle, but we want to confirm
    // we don't inject something unexpected).
    expect((result as { halo?: unknown }).halo).toBeUndefined()
  })
})
