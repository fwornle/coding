// PATTERN SOURCE: 45-03-PLAN.md Task 2 SidePanel behavior tests
//   (updated by 45-05-PLAN.md Task 2 — RCA tab now hosts the real RcaOpsPanel)
//
//   Test 1: system='coding' → only Entity tab; 'okb' → Entity+Markdown;
//           'cap' → Entity+RCA.
//   Test 2a: Markdown tab renders Plan 04's MarkdownViewerPanel empty state.
//   Test 2b: RCA tab renders Plan 05's RcaOpsPanel empty state ("No RCA
//            pipeline runs available.") when listDirs returns empty groups.
//
// We mock EntityDetailPanel + useGraphData to keep the test scoped to the
// tab shell itself, and mock OkmRcaClient so the RCA tab's useQuery resolves
// synchronously with empty groups instead of opening a real fetch / SSE.

import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
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

// Plan 05 wires the real RcaOpsPanel; mock OkmRcaClient so the cap tab renders
// the panel's empty state without hitting fetch or opening an EventSource.
vi.mock('@/api/OkmRcaClient', async () => {
  const actual = await vi.importActual<typeof import('@/api/OkmRcaClient')>('@/api/OkmRcaClient')
  class MockClient {
    constructor(_baseUrl: string) {}
    listDirs() {
      return Promise.resolve({ kpifw: [], raas: [], e2e: [] })
    }
    getStatus() {
      return Promise.resolve({ active: false })
    }
    rcaIngest() {
      return Promise.resolve({ success: true })
    }
    subscribeProgress() {
      return { close: () => undefined } as unknown as EventSource
    }
  }
  return { ...actual, OkmRcaClient: MockClient }
})

import { SidePanel } from './SidePanel'
import type { ApiClient } from '@/api/ApiClient'

function renderPanel(system: 'coding' | 'okb' | 'cap') {
  const apiClient = { base: 'http://test.local' } as ApiClient
  // QueryClientProvider is required because the okb Markdown tab now hosts
  // MarkdownViewerPanel, which uses TanStack Query to fetch markdown_url
  // content. The cap branch's RCA panel placeholder doesn't need it but
  // wrapping all renders is harmless.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={0}>
        <SidePanel apiClient={apiClient} system={system} />
      </TooltipProvider>
    </QueryClientProvider>,
  )
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

  test('Test 2a: switching to Markdown tab (okb) renders the Plan 04 MarkdownViewerPanel empty state', () => {
    renderPanel('okb')
    const trigger = screen.getByTestId('tab-markdown')
    // Radix Tabs use a mouse-down + click pair internally; mousedown
    // is what flips data-state to active.
    fireEvent.pointerDown(trigger, { pointerType: 'mouse', button: 0 })
    fireEvent.mouseDown(trigger)
    fireEvent.click(trigger)
    // Plan 04 replaced the placeholder with the real MarkdownViewerPanel.
    // Since selectedNodeId is null in beforeEach, the panel renders its
    // empty state (data-testid="markdown-empty").
    expect(screen.getByTestId('markdown-empty')).toHaveTextContent(
      'Select a node with a description to view its markdown.',
    )
  })

  test('Test 2b: switching to RCA tab (cap) renders the Plan 05 RcaOpsPanel empty state', async () => {
    renderPanel('cap')
    const trigger = screen.getByTestId('tab-rca')
    fireEvent.pointerDown(trigger, { pointerType: 'mouse', button: 0 })
    fireEvent.mouseDown(trigger)
    fireEvent.click(trigger)
    // Plan 05 swapped the placeholder for the real RcaOpsPanel. Mocked
    // listDirs returns empty groups → the verbatim empty-state copy.
    await waitFor(() => {
      expect(screen.getByText('No RCA pipeline runs available.')).toBeInTheDocument()
    })
  })
})
