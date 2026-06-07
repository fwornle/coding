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

  test('default state — returns 1px border with full opacity, hidden:false', () => {
    const reducer = makeNodeReducer(null)
    const result = reducer('a', { name: 'Alpha', label: 'Alpha', color: '#ff0000', size: 8, ontologyClass: 'Observation', level: 3 })
    expect(result.hidden).toBe(false)
    expect((result as { borderColor?: string }).borderColor).toBe('hsl(var(--border))')
    expect((result as { borderSize?: number }).borderSize).toBe(1)
    expect((result as { opacity?: number }).opacity).toBe(1.0)
  })

  test('hover state — 2px ring stroke', () => {
    const reducer = makeNodeReducer('a')
    const result = reducer('a', { name: 'Alpha', label: 'Alpha', color: '#ff0000', size: 8, ontologyClass: 'Observation', level: 3 })
    expect((result as { borderColor?: string }).borderColor).toBe('hsl(var(--ring))')
    expect((result as { borderSize?: number }).borderSize).toBe(2)
  })

  test('selected state — 3px primary stroke + glow', () => {
    useViewerStore.setState({ selectedNodeId: 'a' })
    const reducer = makeNodeReducer(null)
    const result = reducer('a', { name: 'Alpha', label: 'Alpha', color: '#ff0000', size: 8, ontologyClass: 'Observation', level: 3 })
    expect((result as { borderColor?: string }).borderColor).toBe('hsl(var(--primary))')
    expect((result as { borderSize?: number }).borderSize).toBe(3)
    expect((result as { glow?: { size: number } }).glow?.size).toBe(4)
  })

  test('search-match state — 2px amber stroke', () => {
    useViewerStore.setState({ searchQuery: 'alp' })
    const reducer = makeNodeReducer(null)
    const result = reducer('a', { name: 'Alpha', label: 'Alpha', color: '#ff0000', size: 8, ontologyClass: 'Observation', level: 3 })
    expect((result as { borderColor?: string }).borderColor).toBe('hsl(45, 100%, 50%)')
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

  test('default — hsl(var(--border)), opacity 0.5', () => {
    const reducer = makeEdgeReducer()
    const result = reducer('e1', { source: 'a', target: 'b', color: '#000', size: 1 })
    expect((result as { color?: string }).color).toBe('hsl(var(--border))')
    expect((result as { opacity?: number }).opacity).toBe(0.5)
  })

  test('incident on selected — primary at opacity 1.0', () => {
    useViewerStore.setState({ selectedNodeId: 'a' })
    const reducer = makeEdgeReducer()
    const result = reducer('e1', { source: 'a', target: 'b', color: '#000', size: 1 })
    expect((result as { color?: string }).color).toBe('hsl(var(--primary)/0.6)')
    expect((result as { opacity?: number }).opacity).toBe(1.0)
  })
})
