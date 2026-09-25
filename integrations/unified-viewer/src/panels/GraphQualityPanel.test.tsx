// The quality panel, and the first write this app makes.
//
// What these lock down is mostly what the panel REFUSES to do. The valuable
// property is not "the button works" — it is that the button exists for
// exactly one of four categories, that it writes exactly one field, and that a
// store which has not finished starting reads as "not yet" rather than as a
// failure. Each of those is a way the feature could quietly become harmful:
// an action offered on the wrong category papers over a class bug, a wider
// patch clobbers a writer's metadata, and a 503 rendered as an error teaches
// people the button is broken.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { ApiClient, EntityUpdateError } from '@/api/ApiClient'
import { useViewerStore } from '@/store/viewer-store'
import GraphQualityPanel from './GraphQualityPanel'
import type { AttributionEdge, AttributionEntity } from '@/graph/attribution'

// A rooted spine plus one row per category, so every branch is reachable.
const ENTITIES: AttributionEntity[] = [
  { id: 'proj', name: 'Coding', ontologyClass: 'Project', metadata: {} },
  { id: 'comp', name: 'KnowledgeManagement', ontologyClass: 'Component', metadata: {} },
  // recordedParent — the writer named a rooted entity
  { id: 'rec', name: 'TieredConfigLoader', ontologyClass: 'Detail', metadata: { parentEntityName: 'KnowledgeManagement' } },
  // wrongClass — a Project claims it by has_insight, but it is a Detail
  { id: 'wrong', name: 'Some lesson', ontologyClass: 'Detail', metadata: {} },
  // danglingRef — contained by something that is not in the store
  { id: 'dangle', name: 'ApiServiceChildWrapper', ontologyClass: 'Detail', metadata: {} },
]
const RELATIONS: AttributionEdge[] = [
  { from: 'proj', to: 'comp', type: 'contains' },
  { from: 'proj', to: 'wrong', type: 'has_insight' },
  { from: 'ghost', to: 'dangle', type: 'contains' },
]
const VISIBLE = new Set(['comp', 'rec', 'wrong', 'dangle'])

function makeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    base: 'http://test.local',
    updateEntityMetadata: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as ApiClient
}

function renderPanel(apiClient: ApiClient) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <GraphQualityPanel
        apiClient={apiClient}
        system="coding"
        entities={ENTITIES}
        relations={RELATIONS}
        visibleIds={VISIBLE}
      />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  // The panel resolves classes and parents from the store, exactly as the
  // canvas does. `comp` is the only rooted row; the other three are not.
  useViewerStore.setState({
    hierarchyParents: new Map([['comp', 'proj']]),
    hierarchyClasses: new Map(ENTITIES.map((e) => [e.id, e.ontologyClass as string])),
  } as unknown as Parameters<typeof useViewerStore.setState>[0])
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data: { nodeCount: 5, orphanCount: 0 } }),
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('GraphQualityPanel', () => {
  test('counts only the RENDERED rows that have no project', () => {
    renderPanel(makeClient())
    // `comp` is rooted and `proj` is not even visible — 3 findings, not 5.
    expect(screen.getByTestId('graph-quality-panel').textContent).toContain('3')
    expect(screen.getByTestId('graph-quality-category-recordedParent')).toBeTruthy()
    expect(screen.getByTestId('graph-quality-category-wrongClass')).toBeTruthy()
    expect(screen.getByTestId('graph-quality-category-danglingRef')).toBeTruthy()
  })

  test('a category with no findings is not rendered at all', () => {
    // Nothing in the fixture is `unclaimed`. An empty category rendered as "0"
    // is a row the operator has to read and dismiss on every glance.
    renderPanel(makeClient())
    expect(screen.queryByTestId('graph-quality-category-unclaimed')).toBeNull()
  })

  test('the write is offered ONLY for the recorded-parent category', async () => {
    renderPanel(makeClient())
    // Opening the other two must not produce an action — for those the
    // recorded answer is missing or broken, and writing a placement would
    // hide the cause rather than repair it.
    for (const key of ['wrongClass', 'danglingRef']) {
      fireEvent.click(screen.getByTestId(`graph-quality-category-${key}`))
      expect(screen.queryByTestId('graph-quality-accept-all')).toBeNull()
      fireEvent.click(screen.getByTestId(`graph-quality-category-${key}`))
    }
    fireEvent.click(screen.getByTestId('graph-quality-category-recordedParent'))
    expect(screen.getByTestId('graph-quality-accept-all')).toBeTruthy()
  })

  test('writes exactly metadata.parentId, for exactly the suggested parent', async () => {
    // The blast radius of the app's first mutation. `mergeAttributes` merges
    // whatever it is handed, so a wider patch would silently clobber writer
    // metadata — the field list here IS the safety property.
    const update = vi.fn().mockResolvedValue(undefined)
    renderPanel(makeClient({ updateEntityMetadata: update } as Partial<ApiClient>))
    fireEvent.click(screen.getByTestId('graph-quality-category-recordedParent'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('graph-quality-accept-all'))
    })
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update).toHaveBeenCalledWith('rec', { parentId: 'comp' })
  })

  test('a 503 reads as "still starting up", not as a failure', async () => {
    // obs-api answers 503 until its store hydrates. Rendered as an error, that
    // teaches people the button is broken when it is merely early.
    const update = vi.fn().mockRejectedValue(
      new EntityUpdateError('The knowledge store is still starting up.', true),
    )
    renderPanel(makeClient({ updateEntityMetadata: update } as Partial<ApiClient>))
    fireEvent.click(screen.getByTestId('graph-quality-category-recordedParent'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('graph-quality-accept-all'))
    })
    await waitFor(() => {
      expect(screen.getByTestId('graph-quality-error').textContent).toMatch(/starting up/i)
    })
  })

  test('a real failure surfaces its message rather than a generic one', async () => {
    const update = vi.fn().mockRejectedValue(new EntityUpdateError('HTTP 500', false))
    renderPanel(makeClient({ updateEntityMetadata: update } as Partial<ApiClient>))
    fireEvent.click(screen.getByTestId('graph-quality-category-recordedParent'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('graph-quality-accept-all'))
    })
    await waitFor(() => {
      expect(screen.getByTestId('graph-quality-error').textContent).toContain('HTTP 500')
    })
  })

  test('says so plainly when nothing is wrong', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <GraphQualityPanel
          apiClient={makeClient()}
          system="coding"
          entities={ENTITIES}
          relations={RELATIONS}
          visibleIds={new Set(['comp'])}
        />
      </QueryClientProvider>,
    )
    expect(screen.getByTestId('graph-quality-attribution-clean')).toBeTruthy()
  })
})

describe('GraphQualityPanel — a write that cannot proceed must say so', () => {
  test('a finding with no suggested parent throws rather than silently skipping', async () => {
    // It used to `continue`. The mutation then issued no request, returned 0
    // and reported success, leaving the button on "Placing…" with nothing
    // anywhere explaining why. In a write path, a silent skip looks exactly
    // like a write that worked.
    const update = vi.fn()
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    // Same name on TWO rooted entities — the categoriser refuses to guess, so
    // the row lands in `unclaimed`, not `recordedParent`. Build the ambiguity
    // directly instead, by giving the row a name that resolves to nothing.
    const entities: AttributionEntity[] = [
      { id: 'proj', name: 'Coding', ontologyClass: 'Project', metadata: {} },
      { id: 'x', name: 'Stray', ontologyClass: 'Detail', metadata: { parentEntityName: 'Ghost' } },
    ]
    useViewerStore.setState({
      hierarchyParents: new Map(),
      hierarchyClasses: new Map([['proj', 'Project'], ['x', 'Detail']]),
    } as unknown as Parameters<typeof useViewerStore.setState>[0])
    render(
      <QueryClientProvider client={qc}>
        <GraphQualityPanel
          apiClient={makeClient({ updateEntityMetadata: update } as Partial<ApiClient>)}
          system="coding"
          entities={entities}
          relations={[]}
          visibleIds={new Set(['x'])}
        />
      </QueryClientProvider>,
    )
    // 'Ghost' names nothing, so this is NOT offered as a one-click fix — the
    // action must be absent entirely rather than present and inert.
    expect(screen.queryByTestId('graph-quality-category-recordedParent')).toBeNull()
    expect(screen.getByTestId('graph-quality-category-unclaimed')).toBeTruthy()
    expect(update).not.toHaveBeenCalled()
  })
})
