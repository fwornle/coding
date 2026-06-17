// PATTERN SOURCE: 45-03-PLAN.md Task 2 + 55-08-PLAN.md Task 3
//
// Phase 45 baseline tests (search / level toggle / collapse / aria-label /
// search ref registration) are preserved verbatim — Phase 55 retains all of
// the Phase 45 BC contracts (search, level, collapse).
//
// Phase 55 additions:
//   - Verify the new VOKB-shape filter components are mounted in UI-SPEC §6
//     order: Search → LayerFilter → DomainFilter → OntologyFilter → GraphToggles
//   - The Phase 45 flat ClassList is REMOVED (negative assertion)
//   - Lazy mounts for TrendingPanel (always) + HierarchyNavigator (coding only)
//     are pinned here by Plan 55-08; downstream plans 55-10/55-11 OVERWRITE the
//     placeholder modules but do NOT edit FilterRail.tsx
//   - On system === 'coding', OntologyFilter takes the API-driven L1->L2 path
//     (Phase 60 60-05: no groupingSchema prop; was CODING_SCHEMA pre-60)
//   - On system === 'okb', OntologyFilter is pinned to VOKB_SCHEMA (legacy
//     hardcoded path preserved per W-1)
//   - On system === 'okb', the HierarchyNavigator slot is absent (negative)

import { describe, test, expect, vi, beforeEach } from 'vitest'
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useViewerStore } from '@/store/viewer-store'
import { FilterRail } from './FilterRail'
import type { ApiClient } from '@/api/ApiClient'
import type { Entity } from '@/api/ApiClient'

function makeApiClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    base: 'http://test.local',
    listOntologyClasses: vi
      .fn()
      .mockResolvedValue([
        { name: 'Observation' },
        { name: 'Insight' },
        { name: 'Digest' },
      ]),
    ...overrides,
  } as unknown as ApiClient
}

const DEFAULT_ENTITIES: Entity[] = [
  { id: 'a', name: 'A', ontologyClass: 'Observation' } as Entity,
  { id: 'b', name: 'B', ontologyClass: 'Insight' } as Entity,
  { id: 'c', name: 'C', ontologyClass: 'Digest' } as Entity,
]

function renderRail(
  apiClient: ApiClient,
  register = vi.fn(),
  classOptions: readonly string[] = ['Observation', 'Insight', 'Digest'],
  system: 'coding' | 'okb' = 'coding',
  entities: readonly Entity[] = DEFAULT_ENTITIES,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={0}>
        <FilterRail
          apiClient={apiClient}
          classOptions={classOptions}
          registerSearchInputRef={register}
          system={system}
          entities={entities}
        />
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

describe('FilterRail', () => {
  beforeEach(() => {
    useViewerStore.setState({
      // 2026-06-13 (Phase 56.1 Plan 05): selectedNodeId is gone — multi-set
      // + derived focal. setSelectedNode(null) clears both consistently.
      focalNodeId: null,
      selectedNodeIds: new Set<string>(),
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
      theme: 'light',
      filterRailCollapsed: false,
    })
    cleanup()
  })

  // ------------------------------------------------------------------
  // Phase 45 BC contracts (preserved verbatim from 45-03-PLAN.md Task 2)
  // ------------------------------------------------------------------

  test('Test 1 (BC): typing in search input calls setSearch on the store', () => {
    renderRail(makeApiClient())
    const input = screen.getByTestId('filter-search') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'foo' } })
    expect(useViewerStore.getState().searchQuery).toBe('foo')
  })

  test('Test 3 (BC): unchecking L2 calls toggleLevel(2)', () => {
    renderRail(makeApiClient())
    expect(useViewerStore.getState().visibleLevels.has(2)).toBe(true)
    const wrapper = screen.getByTestId('filter-level-2')
    const cb = wrapper.querySelector('button[role="checkbox"]') as HTMLElement
    fireEvent.click(cb)
    expect(useViewerStore.getState().visibleLevels.has(2)).toBe(false)
  })

  test('Test 5a (BC): collapsed=false renders w-64 expanded rail', () => {
    renderRail(makeApiClient())
    const expanded = screen.getByTestId('viewer-filter-rail')
    expect(expanded.className).toMatch(/w-64/)
  })

  test('Test 5b (BC): collapsed=true renders w-12 icon strip', () => {
    useViewerStore.setState({ filterRailCollapsed: true })
    renderRail(makeApiClient())
    const collapsed = screen.getByTestId('viewer-filter-rail')
    expect(collapsed.className).toMatch(/w-12/)
  })

  test('Test 6 (BC): collapse toggle aria-label is state-dependent', () => {
    renderRail(makeApiClient())
    expect(
      screen.getByRole('button', { name: 'Hide filters' }),
    ).toBeInTheDocument()
    cleanup()
    useViewerStore.setState({ filterRailCollapsed: true })
    renderRail(makeApiClient())
    expect(
      screen.getByRole('button', { name: 'Show filters' }),
    ).toBeInTheDocument()
  })

  test('Test 7 (BC): registerSearchInputRef receives the search <input> on mount', async () => {
    const register = vi.fn()
    renderRail(makeApiClient(), register)
    await screen.findByTestId('filter-search')
    const inputArg = register.mock.calls.find(
      (c) => c[0] instanceof HTMLInputElement,
    )
    expect(inputArg).toBeDefined()
  })

  // ------------------------------------------------------------------
  // Phase 55-08 NEW contracts
  // ------------------------------------------------------------------

  test('Phase 55-08: mounts LayerFilter (Evidence + Pattern visible)', () => {
    renderRail(makeApiClient())
    expect(screen.getByText('Evidence')).toBeInTheDocument()
    expect(screen.getByText('Pattern')).toBeInTheDocument()
  })

  test('Phase 55-08: mounts DomainFilter (group header Domain visible)', () => {
    renderRail(makeApiClient())
    expect(screen.getByText('Domain')).toBeInTheDocument()
  })

  test('Phase 55-08: mounts OntologyFilter (group header Ontology Class visible)', async () => {
    // Phase 60 (60-05): coding tab takes the API-driven path. The "Ontology
    // Class" group header only renders after the fetch resolves and the
    // available-class intersection is non-empty. Wait for the fetch.
    renderRail(makeApiClient())
    expect(await screen.findByText('Ontology Class')).toBeInTheDocument()
  })

  test('Phase 55-08: mounts GraphToggles (4 toggle labels visible)', () => {
    renderRail(makeApiClient())
    expect(screen.getByLabelText('Show All Relations')).toBeInTheDocument()
    expect(screen.getByLabelText('Show Clusters')).toBeInTheDocument()
    expect(screen.getByLabelText('Merged Only')).toBeInTheDocument()
    expect(screen.getByLabelText('Hide Documentation')).toBeInTheDocument()
  })

  test('Phase 55-08: Phase 45 flat ClassList section is REMOVED', () => {
    renderRail(makeApiClient())
    // The Phase 45 flat list lived under data-testid="filter-class-section"
    // and exposed `filter-class-Observation` etc. Both are gone in Phase 55.
    expect(screen.queryByTestId('filter-class-section')).toBeNull()
    expect(screen.queryByTestId('filter-class-Observation')).toBeNull()
    expect(screen.queryByTestId('filter-class-list')).toBeNull()
  })

  test('Phase 60 (60-05): on system === "coding", OntologyFilter takes API-driven path (no Typed Views; legacy CODING_SCHEMA dropped)', async () => {
    const entities: Entity[] = [
      { id: 'a', name: 'A', ontologyClass: 'Project' } as Entity,
      { id: 'b', name: 'B', ontologyClass: 'Observation' } as Entity,
    ]
    // listOntologyClasses is called on the coding tab (API-driven path).
    const apiClient = makeApiClient()
    renderRail(apiClient, vi.fn(), [], 'coding', entities)
    await waitFor(() => {
      expect(apiClient.listOntologyClasses).toHaveBeenCalled()
    })
    // Legacy CODING_SCHEMA group headers MUST be gone (D-16).
    expect(screen.queryByText('Typed Views')).toBeNull()
    expect(screen.queryByText('LSL Pipeline')).toBeNull()
  })

  test('Phase 55-08: on system === "okb", OntologyFilter uses VOKB_SCHEMA (Upper + Lower)', () => {
    const entities: Entity[] = [
      { id: 'a', name: 'A', ontologyClass: 'Component' } as Entity,
      { id: 'b', name: 'B', ontologyClass: 'RPU' } as Entity,
    ]
    renderRail(makeApiClient(), vi.fn(), [], 'okb', entities)
    expect(screen.getByText('Upper Ontology')).toBeInTheDocument()
    expect(screen.getByText('Lower Ontology')).toBeInTheDocument()
  })

  test('Phase 55-08: TrendingPanel lazy mount is present (real component or fallback)', async () => {
    renderRail(makeApiClient())
    // 55-10 shipped the real TrendingPanel component (overwriting the
    // 55-08 placeholder). The Suspense fallback may render briefly; once
    // the lazy chunk resolves, the real `trending-panel` testid appears.
    // (The 55-08 `trending-panel-placeholder` testid is gone.) Accept
    // either the fallback or the real testid as proof the slot is mounted.
    await waitFor(() => {
      const fallback = screen.queryByTestId('trending-panel-fallback')
      const real = screen.queryByTestId('trending-panel')
      expect(fallback || real).not.toBeNull()
    })
  })

  test('Phase 55-08: HierarchyNavigator lazy mount is PRESENT on coding', async () => {
    renderRail(makeApiClient(), vi.fn(), [], 'coding')
    await waitFor(() => {
      // 55-11 overwrote the 55-08 placeholder with the real HierarchyNavigator
      // (testid="hierarchy-navigator"). The fallback can also win briefly under
      // jsdom test conditions — accept either as proof the slot is mounted.
      const fallback = screen.queryByTestId('hierarchy-navigator-fallback')
      const real = screen.queryByTestId('hierarchy-navigator')
      expect(fallback || real).not.toBeNull()
    })
  })

  test('Phase 55-08: HierarchyNavigator lazy mount is ABSENT on okb (coding-only gate)', async () => {
    renderRail(makeApiClient(), vi.fn(), [], 'okb')
    // Give Suspense a tick to resolve — the slot should NOT be rendered at all
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByTestId('hierarchy-navigator-fallback')).toBeNull()
    expect(screen.queryByTestId('hierarchy-navigator-placeholder')).toBeNull()
  })
})
