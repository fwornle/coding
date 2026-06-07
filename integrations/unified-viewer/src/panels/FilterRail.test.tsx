// PATTERN SOURCE: 45-03-PLAN.md Task 2 FilterRail behavior tests
//
// Verifies:
//   Test 1: Typing in search calls setSearch on the Zustand store.
//   Test 2: Empty selectedClasses Set = "all classes visible" semantics
//           (T-45-03-03 mitigation); toggling a class adds it.
//   Test 3: Unchecking a level checkbox removes the level from visibleLevels.
//   Test 4: (deferred to keyboard hook test — Esc behaviour is shared).
//   Test 5: collapsed=true renders the w-12 icon strip; collapsed=false
//           renders the full w-64 rail.

import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useViewerStore } from '@/store/viewer-store'
import { FilterRail } from './FilterRail'
import type { ApiClient } from '@/api/ApiClient'

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

function renderRail(
  apiClient: ApiClient,
  register = vi.fn(),
  classOptions: readonly string[] = ['Observation', 'Insight', 'Digest'],
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
        />
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

describe('FilterRail', () => {
  beforeEach(() => {
    useViewerStore.setState({
      selectedNodeId: null,
      selectedEdgeId: null,
      searchQuery: '',
      visibleLevels: new Set([0, 1, 2, 3]),
      selectedClasses: new Set<string>(),
      theme: 'light',
      filterRailCollapsed: false,
    })
    cleanup()
  })

  test('Test 1: typing in search input calls setSearch on the store', () => {
    renderRail(makeApiClient())
    const input = screen.getByTestId('filter-search') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'foo' } })
    expect(useViewerStore.getState().searchQuery).toBe('foo')
  })

  test('Test 2: empty selectedClasses Set = all classes conceptually visible; toggling one adds it', async () => {
    renderRail(makeApiClient())
    expect(useViewerStore.getState().selectedClasses.size).toBe(0)
    // Wait for the class list to render (TanStack Query resolves)
    const obsCheckbox = await screen.findByTestId('filter-class-Observation')
    expect(obsCheckbox).toBeInTheDocument()
    const cb = obsCheckbox.querySelector('button[role="checkbox"]') as HTMLElement
    fireEvent.click(cb)
    expect(useViewerStore.getState().selectedClasses.has('Observation')).toBe(true)
    expect(useViewerStore.getState().selectedClasses.size).toBe(1)
  })

  test('Test 3: unchecking L2 calls toggleLevel(2) — visibleLevels no longer has 2', () => {
    renderRail(makeApiClient())
    expect(useViewerStore.getState().visibleLevels.has(2)).toBe(true)
    const wrapper = screen.getByTestId('filter-level-2')
    const cb = wrapper.querySelector('button[role="checkbox"]') as HTMLElement
    fireEvent.click(cb)
    expect(useViewerStore.getState().visibleLevels.has(2)).toBe(false)
  })

  test('Test 5a: collapsed=false renders w-64 expanded rail', () => {
    renderRail(makeApiClient())
    const expanded = screen.getByTestId('viewer-filter-rail')
    expect(expanded.className).toMatch(/w-64/)
  })

  test('Test 5b: collapsed=true renders w-12 icon strip', () => {
    useViewerStore.setState({ filterRailCollapsed: true })
    renderRail(makeApiClient())
    const collapsed = screen.getByTestId('viewer-filter-rail')
    expect(collapsed.className).toMatch(/w-12/)
  })

  test('Test 6: collapse toggle IconButton aria-label is state-dependent (Show / Hide filters)', () => {
    // Expanded shows "Hide filters" aria-label
    renderRail(makeApiClient())
    expect(
      screen.getByRole('button', { name: 'Hide filters' }),
    ).toBeInTheDocument()
    cleanup()
    // Collapsed shows "Show filters"
    useViewerStore.setState({ filterRailCollapsed: true })
    renderRail(makeApiClient())
    expect(
      screen.getByRole('button', { name: 'Show filters' }),
    ).toBeInTheDocument()
  })

  test('Test 7: registerSearchInputRef receives the search <input> on mount', async () => {
    const register = vi.fn()
    renderRail(makeApiClient(), register)
    // The effect runs after mount — wait a tick.
    await screen.findByTestId('filter-search')
    // The register callback was called with a real <input> element.
    const inputArg = register.mock.calls.find((c) => c[0] instanceof HTMLInputElement)
    expect(inputArg).toBeDefined()
  })
})
