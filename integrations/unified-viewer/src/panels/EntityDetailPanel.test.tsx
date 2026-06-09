// PATTERN SOURCE: 45-03-PLAN.md Task 2 + 55-09-PLAN.md Task 2 <behavior>
//
// Phase 45 baseline (5 tests, preserved):
//   1. selectedNodeId === null → renders EmptyNodeDetailState
//   2. selected entity shows name + class badge with borderColor
//   3. Description escapes <script> via markdown-text
//   4. Provenance reads camelCase fields; pre-Phase-39 → '—'
//   4b. Pre-Phase-39 entity → all four provenance rows show '—'
//   5. Clicking neighbor → setSelectedNode(neighborId)
//   5b. Incoming relations also click-selectable
//   6. Raw section collapsed by default
//
// Phase 55 additions (Task 2 <behavior>):
//   7.  Pill bar — Default always; Evolution/Confidence/Timeline visible per predicate
//   8.  Default sub-tab content = Phase 45 sections
//   9.  Evolution sub-tab renders descriptionSegments w/ RUN_COLORS coding
//   10. Confidence sub-tab — lazy fetch (200 → bands), 404 → client heuristic
//   11. Timeline sub-tab — chronological events with type-coded icons
//   12. Relationships breakdown — grouped by edge type with badge/dot/chevron
//   13. Sources & Evidence — sourceRefs grouped by evidence type w/ external-link safety
//   14. Occurrence History section (in-panel) — relative timestamps
//   15. sub-tab reset on entity change
//   16. Keyboard 1/2/3/4 cycles visible sub-tabs
//   17. Imports EntityIdentityHeader from Task 1

import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useViewerStore } from '@/store/viewer-store'

// ---- Mock useGraphData -----------------------------------------------------
const mockEntities = [
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
    createdAt: '2026-01-02',
    lastConfirmedAt: '2026-02-03',
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
  // Evolution-enabled entity: multiple descriptionSegments + occurrences > 1
  {
    id: 'evo',
    name: 'Evolved Entity',
    ontologyClass: 'Observation',
    description: 'current',
    metadata: {
      descriptionSegments: [
        { runId: 'run-A', author: 'agent-A', timestamp: '2026-01-01', text: 'first version' },
        { runId: 'run-B', author: 'agent-B', timestamp: '2026-02-01', text: 'second version' },
        { runId: 'run-A', author: 'agent-A', timestamp: '2026-03-01', text: 'rev again' },
      ],
      occurrences: [
        { timestamp: '2026-01-01' },
        { timestamp: '2026-02-01' },
        { timestamp: '2026-03-01' },
      ],
      provenance: { confirmationCount: 2, createdBy: 'agent-A' },
      sourceRefs: [
        { type: 'github', url: 'https://github.com/x/y', addedAt: '2026-05-01' },
        { type: 'confluence', url: 'https://conf.example/p/1', addedAt: '2025-10-01' }, // ~old
      ],
      resolutionHistory: [
        { timestamp: '2026-02-15', summary: 'Resolved by patch X' },
      ],
    },
  },
  // Timeline-only entity: provenance.createdBy without descriptionSegments
  {
    id: 'timeline',
    name: 'Timeline Entity',
    ontologyClass: 'Observation',
    metadata: {
      provenance: { createdBy: 'agent-T', createdAt: '2026-01-01' },
      occurrences: [{ timestamp: '2026-04-01' }],
    },
  },
]

const mockRelations = [
  { from: 'e1', to: 'e2', type: 'DERIVED_FROM' },
  { from: 'e3', to: 'e1', type: 'CAUSED_BY' },
  // Same edge type as the first — exercises grouping by type
  { from: 'e1', to: 'e3', type: 'DERIVED_FROM' },
]

vi.mock('@/graph/useGraphData', () => ({
  useGraphData: () => ({
    entities: mockEntities,
    relations: mockRelations,
    ontology: [],
    isLoading: false,
    error: null,
  }),
}))

import { EntityDetailPanel } from './EntityDetailPanel'
import type { ApiClient } from '@/api/ApiClient'

function renderPanel(apiClient?: ApiClient) {
  const client =
    apiClient ?? ({ base: 'http://test.local' } as ApiClient)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <EntityDetailPanel apiClient={client} system="coding" />
    </QueryClientProvider>,
  )
}

describe('EntityDetailPanel — Phase 45 baseline preserved + Phase 55 sub-tabs', () => {
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

  // ===== Phase 45 baseline =====

  test('Test 1: selectedNodeId === null → renders EmptyNodeDetailState', () => {
    renderPanel()
    expect(screen.getByTestId('state-empty-node-detail')).toBeInTheDocument()
    expect(screen.getByText('Click any node to see its details.')).toBeInTheDocument()
  })

  test('Test 2: with a selected entity, shows name + class badge with borderColor (via EntityIdentityHeader)', () => {
    useViewerStore.setState({ selectedNodeId: 'e1' })
    renderPanel()
    // Phase 55 — EntityIdentityHeader is the new source of identity rendering
    expect(screen.getByTestId('identity-name').textContent).toBe('Selected Entity')
    const badge = screen.getByTestId('identity-class-badge')
    expect(badge.textContent).toBe('Observation')
    expect(badge.getAttribute('style') ?? '').toMatch(/border-color/i)
  })

  test('Test 3: Description section escapes <script> via markdown-text renderer (T-45-03-01)', () => {
    useViewerStore.setState({ selectedNodeId: 'xss' })
    const { container } = renderPanel()
    expect(container.querySelectorAll('script').length).toBe(0)
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

  test('Test 4b: Pre-Phase-39 entity → all four provenance rows show `—`', () => {
    useViewerStore.setState({ selectedNodeId: 'legacy' })
    renderPanel()
    const prov = screen.getByTestId('entity-section-provenance')
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
    const incoming = screen.getByTestId('neighbor-e3')
    fireEvent.click(incoming)
    expect(useViewerStore.getState().selectedNodeId).toBe('e3')
  })

  test('Test 6: Raw section is collapsed by default — JSON not in DOM until toggle', () => {
    useViewerStore.setState({ selectedNodeId: 'e1' })
    renderPanel()
    const toggle = screen.getByTestId('entity-raw-toggle')
    expect(toggle).toBeInTheDocument()
    expect(screen.queryByTestId('entity-raw-json')).toBeNull()
    fireEvent.click(toggle)
    expect(screen.getByTestId('entity-raw-json')).toBeInTheDocument()
    expect(screen.getByTestId('entity-raw-json').textContent).toContain('"id": "e1"')
  })

  // ===== Phase 55 sub-tabs =====

  test('Test 7a: pill bar — Default always present; Evolution/Timeline hidden for plain entity (e1)', () => {
    useViewerStore.setState({ selectedNodeId: 'e1' })
    renderPanel()
    expect(screen.getByTestId('subtab-default')).toBeInTheDocument()
    // e1 has no descriptionSegments / occurrences / confirmationCount metadata,
    // so Evolution + Timeline are not visible.
    expect(screen.queryByTestId('subtab-evolution')).toBeNull()
    expect(screen.queryByTestId('subtab-timeline')).toBeNull()
    // Confidence is ALWAYS visible per UI-SPEC §8.
    expect(screen.getByTestId('subtab-confidence')).toBeInTheDocument()
  })

  test('Test 7b: pill bar — Evolution + Timeline visible when predicate matches (evo entity)', () => {
    useViewerStore.setState({ selectedNodeId: 'evo' })
    renderPanel()
    expect(screen.getByTestId('subtab-default')).toBeInTheDocument()
    expect(screen.getByTestId('subtab-evolution')).toBeInTheDocument()
    expect(screen.getByTestId('subtab-confidence')).toBeInTheDocument()
    expect(screen.getByTestId('subtab-timeline')).toBeInTheDocument()
  })

  test('Test 8: Default sub-tab shows Phase 45 sections', () => {
    useViewerStore.setState({ selectedNodeId: 'e1' })
    renderPanel()
    expect(screen.getByTestId('entity-section-description')).toBeInTheDocument()
    expect(screen.getByTestId('entity-section-identity')).toBeInTheDocument()
    expect(screen.getByTestId('entity-section-provenance')).toBeInTheDocument()
    expect(screen.getByTestId('entity-section-raw')).toBeInTheDocument()
  })

  test('Test 9: Evolution sub-tab renders descriptionSegments with RUN_COLORS', () => {
    useViewerStore.setState({ selectedNodeId: 'evo' })
    renderPanel()
    fireEvent.click(screen.getByTestId('subtab-evolution'))
    const evo = screen.getByTestId('subtab-content-evolution')
    expect(evo).toBeInTheDocument()
    // 3 segments listed
    expect(evo.textContent).toContain('first version')
    expect(evo.textContent).toContain('second version')
    expect(evo.textContent).toContain('rev again')
    // run-A appears twice (color-coded by index 0)
    const blueElements = evo.querySelectorAll('[data-run-id="run-A"]')
    expect(blueElements.length).toBeGreaterThanOrEqual(2)
  })

  test('Test 9b: Evolution sub-tab shows merge banner when confirmationCount > 0', () => {
    useViewerStore.setState({ selectedNodeId: 'evo' })
    renderPanel()
    fireEvent.click(screen.getByTestId('subtab-evolution'))
    const banner = screen.queryByTestId('evolution-merge-banner')
    expect(banner).not.toBeNull()
  })

  test('Test 10: Confidence sub-tab — on 200, renders fetched bands; on 404, client heuristic', async () => {
    useViewerStore.setState({ selectedNodeId: 'evo' })
    const apiClient = {
      base: 'http://test.local',
      getEntityConfidence: vi.fn().mockResolvedValue({
        overall: { score: 0.82, label: 'High' },
        segments: [
          { runId: 'run-A', score: 0.9, label: 'High' },
          { runId: 'run-B', score: 0.7, label: 'Moderate' },
        ],
      }),
    } as unknown as ApiClient
    renderPanel(apiClient)
    fireEvent.click(screen.getByTestId('subtab-confidence'))
    await waitFor(() => {
      const c = screen.getByTestId('subtab-content-confidence')
      expect(c.textContent).toMatch(/High|Moderate|Low/)
    })
  })

  test('Test 10b: Confidence 404 falls back to client heuristic — never throws', async () => {
    useViewerStore.setState({ selectedNodeId: 'evo' })
    const apiClient = {
      base: 'http://test.local',
      getEntityConfidence: vi.fn().mockRejectedValue(new Error('HTTP 404')),
    } as unknown as ApiClient
    renderPanel(apiClient)
    fireEvent.click(screen.getByTestId('subtab-confidence'))
    // Heuristic computed from metadata — must render SOMETHING, never empty.
    await waitFor(() => {
      const c = screen.getByTestId('subtab-content-confidence')
      expect(c.textContent?.length ?? 0).toBeGreaterThan(0)
    })
  })

  test('Test 11: Timeline sub-tab renders chronological event list', () => {
    useViewerStore.setState({ selectedNodeId: 'evo' })
    renderPanel()
    fireEvent.click(screen.getByTestId('subtab-timeline'))
    const tl = screen.getByTestId('subtab-content-timeline')
    expect(tl).toBeInTheDocument()
    const events = tl.querySelectorAll('[data-testid^="timeline-event-"]')
    expect(events.length).toBeGreaterThan(0)
  })

  test('Test 12: Relationships breakdown — grouped by edge type with count badges', () => {
    useViewerStore.setState({ selectedNodeId: 'e1' })
    renderPanel()
    const rel = screen.getByTestId('entity-section-relationships')
    expect(rel).toBeInTheDocument()
    // 2 distinct edge types: DERIVED_FROM (×2) + CAUSED_BY (×1)
    const derived = screen.getByTestId('relationship-group-DERIVED_FROM')
    const caused = screen.getByTestId('relationship-group-CAUSED_BY')
    expect(derived).toBeInTheDocument()
    expect(caused).toBeInTheDocument()
    // Count badges
    expect(derived.textContent).toContain('2')
    expect(caused.textContent).toContain('1')
  })

  test('Test 12b: Relationships group expands to neighbor list; clicking neighbor → setSelectedNode', () => {
    useViewerStore.setState({ selectedNodeId: 'e1' })
    renderPanel()
    const derivedHeader = screen.getByTestId('relationship-group-header-DERIVED_FROM')
    fireEvent.click(derivedHeader)
    const neighbor = screen.getByTestId('neighbor-e2')
    fireEvent.click(neighbor)
    expect(useViewerStore.getState().selectedNodeId).toBe('e2')
  })

  test('Test 13: Sources & Evidence — sourceRefs grouped, link has noopener noreferrer', () => {
    useViewerStore.setState({ selectedNodeId: 'evo' })
    renderPanel()
    const src = screen.getByTestId('entity-section-sources')
    expect(src).toBeInTheDocument()
    expect(src.textContent).toContain('GitHub') // EVIDENCE_TYPE_LABELS.github
    expect(src.textContent).toContain('Confluence')
    // External-link safety (T-55-09-02)
    const link = src.querySelector('a[href="https://github.com/x/y"]')
    expect(link).not.toBeNull()
    expect(link!.getAttribute('target')).toBe('_blank')
    expect(link!.getAttribute('rel')).toBe('noopener noreferrer')
  })

  test('Test 14: Occurrence History section under Entity tab lists occurrences', () => {
    useViewerStore.setState({ selectedNodeId: 'evo' })
    renderPanel()
    const occ = screen.getByTestId('entity-section-occurrences')
    expect(occ).toBeInTheDocument()
    // evo has 3 occurrences
    const rows = occ.querySelectorAll('[data-testid^="occurrence-item-"]')
    expect(rows.length).toBe(3)
  })

  test('Test 15: selecting a different entity resets descViewMode to default', () => {
    useViewerStore.setState({ selectedNodeId: 'evo' })
    const { rerender } = renderPanel()
    fireEvent.click(screen.getByTestId('subtab-evolution'))
    // Active sub-tab is evolution
    expect(screen.getByTestId('subtab-evolution').getAttribute('aria-selected')).toBe('true')
    // Now select a different entity — switching to plain e1 must reset.
    useViewerStore.setState({ selectedNodeId: 'e1' })
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <EntityDetailPanel apiClient={{ base: 'http://test.local' } as ApiClient} system="coding" />
      </QueryClientProvider>,
    )
    // Default is the only required tab now (evolution gone) — confirm aria-selected on default.
    expect(screen.getByTestId('subtab-default').getAttribute('aria-selected')).toBe('true')
  })

  test('Test 16: Keyboard 1/2/3/4 cycles to default/evolution/confidence/timeline (only when visible)', () => {
    useViewerStore.setState({ selectedNodeId: 'evo' })
    renderPanel()
    // Press 2 → Evolution
    fireEvent.keyDown(document.body, { key: '2' })
    expect(screen.getByTestId('subtab-evolution').getAttribute('aria-selected')).toBe('true')
    // Press 3 → Confidence
    fireEvent.keyDown(document.body, { key: '3' })
    expect(screen.getByTestId('subtab-confidence').getAttribute('aria-selected')).toBe('true')
    // Press 4 → Timeline
    fireEvent.keyDown(document.body, { key: '4' })
    expect(screen.getByTestId('subtab-timeline').getAttribute('aria-selected')).toBe('true')
    // Press 1 → Default
    fireEvent.keyDown(document.body, { key: '1' })
    expect(screen.getByTestId('subtab-default').getAttribute('aria-selected')).toBe('true')
  })

  test('Test 16b: Keyboard 2/4 are NO-OP when Evolution/Timeline are hidden (plain e1)', () => {
    useViewerStore.setState({ selectedNodeId: 'e1' })
    renderPanel()
    // Pressing 2 when Evolution is hidden should not change the active sub-tab.
    fireEvent.keyDown(document.body, { key: '2' })
    expect(screen.getByTestId('subtab-default').getAttribute('aria-selected')).toBe('true')
  })

  test('Test 17: EntityDetailPanel imports EntityIdentityHeader (refactor)', () => {
    useViewerStore.setState({ selectedNodeId: 'e1' })
    renderPanel()
    // The identity header carries its own test-id (rendered by EntityIdentityHeader).
    expect(screen.getByTestId('entity-identity-header')).toBeInTheDocument()
  })
})
