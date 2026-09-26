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
    // No `level` / `parent`: the panel reads neither (2026-09-26 — nothing has
    // ever written them), and no test here asserted them. The IDENTITY block's
    // two rows are pinned against the derived hierarchy instead.
    //
    // Provenance is in `metadata.provenance`, which is where the wire puts it
    // (km-core entityToWire). This fixture used to carry top-level
    // `createdBy` / `confirmationCount` / `lastConfirmedBy` / `lastSegment` /
    // `lastConfirmedAt` — a shape the store has never produced — and Test 4
    // passed on the strength of it while all four rows rendered `—` against
    // real data. A stamp carries all four fields or does not exist.
    createdAt: '2026-01-02',
    metadata: {
      provenance: {
        createdBy: {
          provider: 'observation-writer', model: 'live-pipeline',
          runId: 'run-create-1', timestamp: '2026-01-02',
        },
        lastConfirmedBy: {
          provider: 'phase-42-migration', model: 'b-to-km-core',
          runId: 'run-confirm-9', timestamp: '2026-02-03',
        },
        confirmationCount: 4,
      },
    },
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
    // Carries a stamp (so Timeline's pill shows) but nothing dated to list and
    // no createdAt, which is the exact shape that produced a blank tab body.
    id: 'legacyStamped',
    name: 'Stamped But Undated',
    ontologyClass: 'Observation',
    description: '',
    metadata: {
      provenance: {
        createdBy: { provider: 'observation-writer', model: 'live-pipeline', runId: 'r1', timestamp: '' },
        lastConfirmedBy: { provider: 'observation-writer', model: 'live-pipeline', runId: 'r1', timestamp: '' },
        confirmationCount: 1,
      },
    },
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
    // 2026-06-13 (Phase 56.1 Plan 05): selectedNodeId is gone — multi-set + focal.
    useViewerStore.setState({
      focalNodeId: null,
      selectedNodeIds: new Set<string>(),
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
    useViewerStore.getState().setSelectedNode('e1')
    renderPanel()
    // Phase 55 — EntityIdentityHeader is the new source of identity rendering
    expect(screen.getByTestId('identity-name').textContent).toBe('Selected Entity')
    const badge = screen.getByTestId('identity-class-badge')
    expect(badge.textContent).toBe('Observation')
    expect(badge.getAttribute('style') ?? '').toMatch(/border-color/i)
  })

  test('Test 3: Description section escapes <script> via markdown-text renderer (T-45-03-01)', () => {
    useViewerStore.getState().setSelectedNode('xss')
    const { container } = renderPanel()
    expect(container.querySelectorAll('script').length).toBe(0)
    expect(container.textContent).toContain('<script>alert(1)</script>')
  })

  test('Test 4: Provenance renders the stamp as provider/model, from metadata.provenance', () => {
    useViewerStore.getState().setSelectedNode('e1')
    renderPanel()
    const prov = screen.getByTestId('entity-section-provenance')
    // `<provider>/<model>` — a bare model name does not identify what wrote a
    // row, because provider names are ACCOUNTS rather than companies.
    expect(prov.textContent).toContain('observation-writer/live-pipeline')
    expect(prov.textContent).toContain('phase-42-migration/b-to-km-core')
    expect(prov.textContent).toContain('4')
    // "Last run" replaces the old "Last segment": no wire field has ever
    // carried a segment id, so the row names the run that last confirmed it.
    expect(prov.textContent).toContain('run-confirm-9')
  })

  test('Test 4a: the Identity block dates the row from the confirming stamp', () => {
    useViewerStore.getState().setSelectedNode('e1')
    renderPanel()
    // Was `entity.lastConfirmedAt`, which nothing writes — so this row read
    // `—` for every entity ever selected.
    const identity = screen.getByTestId('entity-section-identity')
    expect(identity.textContent).toContain('2026-02-03')
  })

  test('Test 4b: Pre-Phase-39 entity → all four provenance rows show `—`', () => {
    useViewerStore.getState().setSelectedNode('legacy')
    renderPanel()
    const prov = screen.getByTestId('entity-section-provenance')
    const matches = prov.textContent?.match(/—/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(4)
  })

  test('Test 5: clicking a neighbor calls setSelectedNode(neighborId)', () => {
    useViewerStore.getState().setSelectedNode('e1')
    renderPanel()
    // Phase 55 — Neighbors are inside Relationships breakdown; expand the
    // DERIVED_FROM group first (which contains e2 + e3 outgoing).
    fireEvent.click(screen.getByTestId('relationship-group-header-DERIVED_FROM'))
    const neighbor = screen.getByTestId('neighbor-e2')
    fireEvent.click(neighbor)
    expect(useViewerStore.getState().focalNodeId).toBe('e2')
  })

  test('Test 5b: incoming relations also list — clicking the source neighbor selects it', () => {
    useViewerStore.getState().setSelectedNode('e1')
    renderPanel()
    // Phase 55 — Incoming relations land in their own group (CAUSED_BY) which
    // we must expand to reach neighbor-e3.
    fireEvent.click(screen.getByTestId('relationship-group-header-CAUSED_BY'))
    const incoming = screen.getByTestId('neighbor-e3')
    fireEvent.click(incoming)
    expect(useViewerStore.getState().focalNodeId).toBe('e3')
  })

  test('Test 6: Raw section is collapsed by default — JSON not in DOM until toggle', () => {
    useViewerStore.getState().setSelectedNode('e1')
    renderPanel()
    const toggle = screen.getByTestId('entity-raw-toggle')
    expect(toggle).toBeInTheDocument()
    expect(screen.queryByTestId('entity-raw-json')).toBeNull()
    fireEvent.click(toggle)
    expect(screen.getByTestId('entity-raw-json')).toBeInTheDocument()
    expect(screen.getByTestId('entity-raw-json').textContent).toContain('"id": "e1"')
  })

  // ===== Phase 55 sub-tabs =====

  test('Test 7a: pill bar — Default always present; Evolution/Timeline hidden for a plain entity', () => {
    // Retargeted from e1 to `legacy` on 2026-09-26. e1 now carries a real
    // `metadata.provenance` (it must, to pin the Provenance section against
    // the shape the wire actually sends), and a row with a confirmation count
    // and a creation stamp is NOT a plain row — Evolution and Timeline are
    // correctly visible for it. `legacy` has no metadata at all, which is what
    // this test was always describing.
    useViewerStore.getState().setSelectedNode('legacy')
    renderPanel()
    expect(screen.getByTestId('subtab-default')).toBeInTheDocument()
    expect(screen.queryByTestId('subtab-evolution')).toBeNull()
    expect(screen.queryByTestId('subtab-timeline')).toBeNull()
    // Confidence is ALWAYS visible per UI-SPEC §8.
    expect(screen.getByTestId('subtab-confidence')).toBeInTheDocument()
  })

  test('Test 7a2: a row WITH provenance shows Evolution + Timeline', () => {
    // The other half of the retarget above: provenance alone is enough to make
    // both tabs meaningful, and e1 is the fixture that carries it.
    useViewerStore.getState().setSelectedNode('e1')
    renderPanel()
    expect(screen.getByTestId('subtab-evolution')).toBeInTheDocument()
    expect(screen.getByTestId('subtab-timeline')).toBeInTheDocument()
  })

  test('Test 7b: pill bar — Evolution + Timeline visible when predicate matches (evo entity)', () => {
    useViewerStore.getState().setSelectedNode('evo')
    renderPanel()
    expect(screen.getByTestId('subtab-default')).toBeInTheDocument()
    expect(screen.getByTestId('subtab-evolution')).toBeInTheDocument()
    expect(screen.getByTestId('subtab-confidence')).toBeInTheDocument()
    expect(screen.getByTestId('subtab-timeline')).toBeInTheDocument()
  })

  test('Test 8: Default sub-tab shows Phase 45 sections', () => {
    useViewerStore.getState().setSelectedNode('e1')
    renderPanel()
    expect(screen.getByTestId('entity-section-description')).toBeInTheDocument()
    expect(screen.getByTestId('entity-section-identity')).toBeInTheDocument()
    expect(screen.getByTestId('entity-section-provenance')).toBeInTheDocument()
    expect(screen.getByTestId('entity-section-raw')).toBeInTheDocument()
  })

  test('Test 9: Evolution sub-tab renders descriptionSegments with RUN_COLORS', () => {
    useViewerStore.getState().setSelectedNode('evo')
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
    useViewerStore.getState().setSelectedNode('evo')
    renderPanel()
    fireEvent.click(screen.getByTestId('subtab-evolution'))
    const banner = screen.queryByTestId('evolution-merge-banner')
    expect(banner).not.toBeNull()
  })

  // THE TEST THAT USED TO BE HERE COULD NOT FAIL.
  //
  // It mocked `getEntityConfidence` with `{overall:{score,label}, segments:
  // [{runId,score,label}]}` — the shape the frontend WISHED the server sent —
  // and asserted `/High|Moderate|Low/`, a regex that never touches the number.
  // The server has always sent `{overall: <float>, bands, segments:
  // [{segmentId, confidence}]}`, so the panel rendered "· NaN%" on every
  // entity while this test stayed green for months. A mock of your own
  // assumption tests the assumption, not the contract.
  //
  // The fixtures below are transcribed from the REAL handler
  // (scripts/observations-api-server.mjs:2946-3001) and match the shape
  // asserted by tests/integration/obs-api.v1-confidence.test.js:147
  // (`typeof body.data.overall === 'number'`) — the assertion that contradicted
  // the client type in plain sight. And the number is asserted, explicitly,
  // including that it is not NaN.
  test('Test 10: Confidence renders a real percentage from the SERVER wire shape', async () => {
    useViewerStore.getState().setSelectedNode('evo')
    const apiClient = {
      base: 'http://test.local',
      getEntityConfidence: vi.fn().mockResolvedValue({
        overall: 0.7,
        bands: { high: 0, moderate: 1, low: 0 },
        segments: [],
      }),
    } as unknown as ApiClient
    renderPanel(apiClient)
    fireEvent.click(screen.getByTestId('subtab-confidence'))
    await waitFor(() => {
      expect(screen.getByTestId('confidence-overall').textContent).toBe('Moderate · 70%')
    })
    expect(screen.getByTestId('subtab-content-confidence').textContent).not.toMatch(/NaN/)
  })

  test('Test 10a: per-segment rows label each scalar confidence', async () => {
    useViewerStore.getState().setSelectedNode('evo')
    const apiClient = {
      base: 'http://test.local',
      getEntityConfidence: vi.fn().mockResolvedValue({
        overall: 0.85,
        bands: { high: 1, moderate: 1, low: 0 },
        segments: [
          { segmentId: 'seg-0', confidence: 0.9, source: 'run-A' },
          { segmentId: 'seg-1', confidence: 0.62 },
        ],
      }),
    } as unknown as ApiClient
    renderPanel(apiClient)
    fireEvent.click(screen.getByTestId('subtab-confidence'))
    await waitFor(() => {
      expect(screen.getByTestId('confidence-overall').textContent).toBe('High · 85%')
    })
    const text = screen.getByTestId('subtab-content-confidence').textContent ?? ''
    expect(text).toContain('High · 90%')
    expect(text).toContain('Moderate · 62%')
    expect(text).not.toMatch(/NaN/)
  })

  test('Test 10b: Confidence 404 falls back to client heuristic — never throws', async () => {
    useViewerStore.getState().setSelectedNode('evo')
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
    useViewerStore.getState().setSelectedNode('evo')
    renderPanel()
    fireEvent.click(screen.getByTestId('subtab-timeline'))
    const tl = screen.getByTestId('subtab-content-timeline')
    expect(tl).toBeInTheDocument()
    const events = tl.querySelectorAll('[data-testid^="timeline-event-"]')
    expect(events.length).toBeGreaterThan(0)
  })

  test('Test 12: Relationships breakdown — grouped by edge type with count badges', () => {
    useViewerStore.getState().setSelectedNode('e1')
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
    useViewerStore.getState().setSelectedNode('e1')
    renderPanel()
    const derivedHeader = screen.getByTestId('relationship-group-header-DERIVED_FROM')
    fireEvent.click(derivedHeader)
    const neighbor = screen.getByTestId('neighbor-e2')
    fireEvent.click(neighbor)
    expect(useViewerStore.getState().focalNodeId).toBe('e2')
  })

  test('Test 13: Sources & Evidence — sourceRefs grouped, link has noopener noreferrer', () => {
    useViewerStore.getState().setSelectedNode('evo')
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
    useViewerStore.getState().setSelectedNode('evo')
    renderPanel()
    const occ = screen.getByTestId('entity-section-occurrences')
    expect(occ).toBeInTheDocument()
    // evo has 3 occurrences
    const rows = occ.querySelectorAll('[data-testid^="occurrence-item-"]')
    expect(rows.length).toBe(3)
  })

  test('Test 15: selecting a different entity resets descViewMode to default', () => {
    useViewerStore.getState().setSelectedNode('evo')
    const { rerender } = renderPanel()
    fireEvent.click(screen.getByTestId('subtab-evolution'))
    // Active sub-tab is evolution
    expect(screen.getByTestId('subtab-evolution').getAttribute('aria-selected')).toBe('true')
    // Now select a different entity — switching to plain e1 must reset.
    useViewerStore.getState().setSelectedNode('e1')
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <EntityDetailPanel apiClient={{ base: 'http://test.local' } as ApiClient} system="coding" />
      </QueryClientProvider>,
    )
    // Default is the only required tab now (evolution gone) — confirm aria-selected on default.
    expect(screen.getByTestId('subtab-default').getAttribute('aria-selected')).toBe('true')
  })

  test('Test 16: Keyboard 1/2/3/4 cycles to default/evolution/confidence/timeline (only when visible)', () => {
    useViewerStore.getState().setSelectedNode('evo')
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

  test('Test 16b: Keyboard 2/4 are NO-OP when Evolution/Timeline are hidden (plain row)', () => {
    // Retargeted from e1 for the same reason as Test 7a.
    useViewerStore.getState().setSelectedNode('legacy')
    renderPanel()
    // Pressing 2 when Evolution is hidden should not change the active sub-tab.
    fireEvent.keyDown(document.body, { key: '2' })
    expect(screen.getByTestId('subtab-default').getAttribute('aria-selected')).toBe('true')
  })

  // -------------------------------------------------------------------------
  // 2026-09-26 — a shown tab must say something.
  // -------------------------------------------------------------------------

  test('Timeline with a stamp but no dated events renders empty-state copy, not a blank tab', () => {
    // e1 has provenance (so the pill shows) and no segments / occurrences /
    // sourceRefs. It DOES have a createdAt, so it gets a creation row; the
    // regression guarded here is the blank <ul> that used to render when the
    // event list came out empty — pill present, tab body entirely empty.
    useViewerStore.getState().setSelectedNode('legacyStamped')
    renderPanel()
    fireEvent.click(screen.getByTestId('subtab-timeline'))
    const tl = screen.getByTestId('subtab-content-timeline')
    expect(tl.textContent?.trim().length ?? 0).toBeGreaterThan(0)
    expect(screen.getByTestId('timeline-events-empty')).toBeInTheDocument()
  })

  test('Confidence distinguishes "nothing to score" from a measured 0%', () => {
    // `legacy` has no segments, no occurrences and no confirmations. The old
    // renderer painted `Low · 0%` over an empty list, which reads as a verdict.
    useViewerStore.getState().setSelectedNode('legacy')
    renderPanel()
    fireEvent.click(screen.getByTestId('subtab-confidence'))
    expect(screen.getByTestId('confidence-unmeasurable')).toBeInTheDocument()
    expect(screen.queryByTestId('confidence-overall')).toBeNull()
  })

  test('Test 17: EntityDetailPanel imports EntityIdentityHeader (refactor)', () => {
    useViewerStore.getState().setSelectedNode('e1')
    renderPanel()
    // The identity header carries its own test-id (rendered by EntityIdentityHeader).
    expect(screen.getByTestId('entity-identity-header')).toBeInTheDocument()
  })
})
