// PATTERN SOURCE: 45-03-PLAN.md Task 2 EntityDetailPanel behavior tests
//
// Mocks useGraphData to inject a fixed entity + relations list. The panel
// is a pure render-from-store component so the test scope is small:
//
//   Test 1: selectedNodeId === null → renders EmptyNodeDetailState
//   Test 2: with a selected entity, shows the name + class badge with
//           classColor borderColor (via inline style)
//   Test 3: Description section uses markdown-text — <script> escaped
//   Test 4: Provenance reads createdBy/confirmationCount/lastConfirmedBy
//           camelCase; missing fields render `—`
//   Test 5: Clicking a neighbor button calls setSelectedNode(neighborId)
//   Test 6: Raw section collapsed by default; expanding shows the JSON

import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { useViewerStore } from '@/store/viewer-store'

// Mock useGraphData BEFORE importing EntityDetailPanel — vi.mock is hoisted.
vi.mock('@/graph/useGraphData', () => ({
  useGraphData: () => ({
    entities: [
      {
        id: 'e1',
        name: 'Selected Entity',
        ontologyClass: 'Observation',
        description: '**Hello** world',
        level: 2,
        parent: 'parent-1',
        createdBy: 'agent-coordinator',
        confirmationCount: 4,
        lastConfirmedBy: 'agent-verifier',
        lastSegment: 'seg-42',
      },
      { id: 'e2', name: 'Neighbor Two', ontologyClass: 'Insight' },
      { id: 'e3', name: 'Neighbor Three', ontologyClass: 'Insight' },
      {
        id: 'legacy',
        name: 'Pre-Phase39 Entity',
        ontologyClass: 'Observation',
        description: '',
      },
      {
        id: 'xss',
        name: 'XSS sample',
        ontologyClass: 'Observation',
        description: '<script>alert(1)</script>',
      },
    ],
    relations: [
      { from: 'e1', to: 'e2', type: 'related' },
      { from: 'e3', to: 'e1', type: 'cites' },
    ],
    ontology: [],
    isLoading: false,
    error: null,
  }),
}))

import { EntityDetailPanel } from './EntityDetailPanel'
import type { ApiClient } from '@/api/ApiClient'

function renderPanel() {
  const apiClient = { base: 'http://test.local' } as ApiClient
  return render(<EntityDetailPanel apiClient={apiClient} system="coding" />)
}

describe('EntityDetailPanel', () => {
  beforeEach(() => {
    useViewerStore.setState({
      selectedNodeId: null,
      searchQuery: '',
      visibleLevels: new Set([0, 1, 2, 3]),
      selectedClasses: new Set<string>(),
      theme: 'light',
      filterRailCollapsed: false,
    })
    cleanup()
  })

  test('Test 1: selectedNodeId === null → renders EmptyNodeDetailState', () => {
    renderPanel()
    expect(screen.getByTestId('state-empty-node-detail')).toBeInTheDocument()
    expect(screen.getByText('Click any node to see its details.')).toBeInTheDocument()
  })

  test('Test 2: with a selected entity, shows name + class badge with borderColor', () => {
    useViewerStore.setState({ selectedNodeId: 'e1' })
    renderPanel()
    expect(screen.getByTestId('entity-name').textContent).toBe('Selected Entity')
    const badge = screen.getByTestId('entity-class-badge')
    expect(badge.textContent).toBe('Observation')
    // Verify inline borderColor style is non-empty
    expect(badge.getAttribute('style') ?? '').toMatch(/border-color/i)
  })

  test('Test 3: Description section escapes <script> via markdown-text renderer (T-45-03-01)', () => {
    useViewerStore.setState({ selectedNodeId: 'xss' })
    const { container } = renderPanel()
    // No DOM <script> element should ever exist in the panel tree.
    expect(container.querySelectorAll('script').length).toBe(0)
    // Verbatim escaped text present in DOM
    expect(container.textContent).toContain('<script>alert(1)</script>')
  })

  test('Test 4: Provenance reads camelCase fields; pre-Phase-39 entities render `—`', () => {
    useViewerStore.setState({ selectedNodeId: 'e1' })
    renderPanel()
    const prov = screen.getByTestId('entity-section-provenance')
    expect(prov.textContent).toContain('agent-coordinator')
    expect(prov.textContent).toContain('4')
    expect(prov.textContent).toContain('agent-verifier')
    expect(prov.textContent).toContain('seg-42')
  })

  test('Test 4b: Pre-Phase-39 entity (no createdBy / confirmationCount) renders `—`', () => {
    useViewerStore.setState({ selectedNodeId: 'legacy' })
    renderPanel()
    const prov = screen.getByTestId('entity-section-provenance')
    // All four rows must show the em-dash placeholder
    const matches = prov.textContent?.match(/—/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(4)
  })

  test('Test 5: clicking a neighbor calls setSelectedNode(neighborId)', () => {
    useViewerStore.setState({ selectedNodeId: 'e1' })
    renderPanel()
    const neighbor = screen.getByTestId('neighbor-e2')
    fireEvent.click(neighbor)
    expect(useViewerStore.getState().selectedNodeId).toBe('e2')
  })

  test('Test 5b: incoming relations also list — clicking the source neighbor selects it', () => {
    useViewerStore.setState({ selectedNodeId: 'e1' })
    renderPanel()
    // e3 → e1 (cites) is INCOMING to e1; clicking the e3 neighbor selects e3.
    const incoming = screen.getByTestId('neighbor-e3')
    fireEvent.click(incoming)
    expect(useViewerStore.getState().selectedNodeId).toBe('e3')
  })

  test('Test 6: Raw section is collapsed by default — JSON not in DOM until toggle', () => {
    useViewerStore.setState({ selectedNodeId: 'e1' })
    renderPanel()
    // The Collapsible renders content into the DOM but Radix hides it via
    // CSS / attribute when closed; the toggle button is present.
    const toggle = screen.getByTestId('entity-raw-toggle')
    expect(toggle).toBeInTheDocument()
    // No <pre> with the JSON visible yet
    expect(screen.queryByTestId('entity-raw-json')).toBeNull()
    fireEvent.click(toggle)
    expect(screen.getByTestId('entity-raw-json')).toBeInTheDocument()
    expect(screen.getByTestId('entity-raw-json').textContent).toContain('"id": "e1"')
  })
})
