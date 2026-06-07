// PATTERN SOURCE: 45-03-PLAN.md Task 2 SidePanel behavior tests
//
//   Test 1: system='coding' → only Entity tab; 'okb' → Entity+Markdown;
//           'cap' → Entity+RCA.
//   Test 2: Markdown / RCA tabs render placeholder content (Plan 04/05
//           land the real implementations).
//
// We mock EntityDetailPanel + useGraphData to keep the test scoped to
// the tab shell itself.

import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { useViewerStore } from '@/store/viewer-store'

vi.mock('@/graph/useGraphData', () => ({
  useGraphData: () => ({
    entities: [],
    relations: [],
    ontology: [],
    isLoading: false,
    error: null,
  }),
}))

import { SidePanel } from './SidePanel'
import type { ApiClient } from '@/api/ApiClient'

function renderPanel(system: 'coding' | 'okb' | 'cap') {
  const apiClient = { base: 'http://test.local' } as ApiClient
  return render(<SidePanel apiClient={apiClient} system={system} />)
}

describe('SidePanel', () => {
  beforeEach(() => {
    useViewerStore.setState({ selectedNodeId: null })
    cleanup()
  })

  test('Test 1a: system="coding" — only the Entity tab is rendered', () => {
    renderPanel('coding')
    expect(screen.getByTestId('tab-entity')).toBeInTheDocument()
    expect(screen.queryByTestId('tab-markdown')).toBeNull()
    expect(screen.queryByTestId('tab-rca')).toBeNull()
  })

  test('Test 1b: system="okb" — Entity + Markdown tabs both rendered', () => {
    renderPanel('okb')
    expect(screen.getByTestId('tab-entity')).toBeInTheDocument()
    expect(screen.getByTestId('tab-markdown')).toBeInTheDocument()
    expect(screen.queryByTestId('tab-rca')).toBeNull()
  })

  test('Test 1c: system="cap" — Entity + RCA tabs both rendered', () => {
    renderPanel('cap')
    expect(screen.getByTestId('tab-entity')).toBeInTheDocument()
    expect(screen.queryByTestId('tab-markdown')).toBeNull()
    expect(screen.getByTestId('tab-rca')).toBeInTheDocument()
  })

  test('Test 2a: switching to Markdown tab (okb) renders the Plan 04 placeholder', () => {
    renderPanel('okb')
    const trigger = screen.getByTestId('tab-markdown')
    // Radix Tabs use a mouse-down + click pair internally; mousedown
    // is what flips data-state to active.
    fireEvent.pointerDown(trigger, { pointerType: 'mouse', button: 0 })
    fireEvent.mouseDown(trigger)
    fireEvent.click(trigger)
    expect(screen.getByTestId('tab-markdown-placeholder')).toHaveTextContent(
      'Markdown panel — landing in Plan 04',
    )
  })

  test('Test 2b: switching to RCA tab (cap) renders the Plan 05 placeholder', () => {
    renderPanel('cap')
    const trigger = screen.getByTestId('tab-rca')
    fireEvent.pointerDown(trigger, { pointerType: 'mouse', button: 0 })
    fireEvent.mouseDown(trigger)
    fireEvent.click(trigger)
    expect(screen.getByTestId('tab-rca-placeholder')).toHaveTextContent(
      'RCA panel — landing in Plan 05',
    )
  })
})
