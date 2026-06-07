// PATTERN SOURCE: 45-01-PLAN.md Task 2 <behavior> Test 3
//
// useViewerStore.getState().reset() clears in-system selection + search + selectedClasses,
// but DOES NOT clear visibleLevels (filter defaults persist across in-system reset by
// design — cross-system reset is the remount).
import { describe, test, expect, beforeEach } from 'vitest'
import { useViewerStore } from './viewer-store'

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
