// PATTERN SOURCE: 45-01-PLAN.md Task 2 <behavior> Test 2
//
// ApiClient should:
//   - Issue GET to `${baseUrl}/api/v1/entities` with `Accept: application/json`
//   - Unwrap the `{success: true, data: ...}` envelope
//   - Throw on non-2xx responses
//
// We stub global.fetch since this runs in jsdom (no MSW dependency added).
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { ApiClient } from './ApiClient'

describe('ApiClient', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('listEntities issues GET to /api/v1/entities with JSON Accept header', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const client = new ApiClient('http://localhost:12436')
    const result = await client.listEntities()
    expect(result).toEqual([])
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    // The v1 branch carries the `?limit=1000000` clip opt-out (entities.js:64
    // default 1000-clip workaround — see listEntities doc comment).
    expect(url).toBe('http://localhost:12436/api/v1/entities?limit=1000000')
    expect((init.headers as Record<string, string>).Accept).toBe('application/json')
  })

  test('throws when response is non-2xx', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('Internal Server Error', { status: 500 }),
    )
    const client = new ApiClient('http://localhost:12436')
    await expect(client.listEntities()).rejects.toThrow(/HTTP 500/)
  })

  test('throws when envelope reports success:false', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false, error: 'no can do' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const client = new ApiClient('http://localhost:12436')
    await expect(client.listEntities()).rejects.toThrow('no can do')
  })

  test('listOntologyClasses falls back when server returns string[]', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: true, data: ['Observation', 'Digest', 'Insight'] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    const client = new ApiClient('http://localhost:12436')
    const result = await client.listOntologyClasses()
    expect(result).toEqual([
      { name: 'Observation' },
      { name: 'Digest' },
      { name: 'Insight' },
    ])
    const [url] = fetchSpy.mock.calls[0] as [string]
    expect(url).toBe('http://localhost:12436/api/v1/ontology/classes?withDisplay=true')
  })

  test('listOntologyClasses passes objects through when server returns the Plan-04 shape', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: [
            { name: 'Observation', level: 3, parent: 'Detail', display: { color: '#3b82f6' } },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    const client = new ApiClient('http://localhost:12436')
    const result = await client.listOntologyClasses()
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      name: 'Observation',
      level: 3,
      parent: 'Detail',
      display: { color: '#3b82f6' },
    })
  })

  test('getNeighbors encodes the id and depth', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          data: { entity: { id: 'a/b', name: 'x', ontologyClass: 'Observation' }, neighbors: [], relations: [] },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    const client = new ApiClient('http://localhost:12436')
    await client.getNeighbors('a/b', 2)
    const [url] = fetchSpy.mock.calls[0] as [string]
    expect(url).toBe('http://localhost:12436/api/v1/entities/a%2Fb/neighbors?depth=2')
  })

  // ── Phase 61-02 — okb-scoped apiVersion path-rewrite + relation cap ──

  test('apiVersion defaults to v1 — apiPath leaves /api/v1/ paths unchanged', () => {
    const client = new ApiClient('http://localhost:12436')
    expect(client.apiPath('/api/v1/entities')).toBe('/api/v1/entities')
  })

  test('legacy apiVersion rewrites /api/v1/ → /api/', () => {
    const client = new ApiClient('http://localhost:8090', 'legacy')
    expect(client.apiPath('/api/v1/entities')).toBe('/api/entities')
    expect(client.apiPath('/api/v1/relations')).toBe('/api/relations')
    expect(client.apiPath('/api/v1/ontology/classes?withDisplay=true')).toBe(
      '/api/ontology/classes?withDisplay=true',
    )
  })

  test('v1 listEntities keeps the ?limit=1000000 clip opt-out', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const client = new ApiClient('http://localhost:12436', 'v1')
    await client.listEntities()
    const [url] = fetchSpy.mock.calls[0] as [string]
    expect(url).toBe('http://localhost:12436/api/v1/entities?limit=1000000')
  })

  test('legacy listEntities requests plain /api/entities (no ?limit param)', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const client = new ApiClient('http://localhost:8090', 'legacy')
    await client.listEntities()
    const [url] = fetchSpy.mock.calls[0] as [string]
    expect(url).toBe('http://localhost:8090/api/entities')
  })

  test('v1 listRelations returns { relations, total } with NO drop and NO cap', async () => {
    const edges = [
      { source: 'a', target: 'b', attributes: { type: 'derives_from' } },
      { source: 'b', target: 'c', attributes: { type: 'correlated_with' } },
      { source: 'c', target: 'd', attributes: { type: 'related' } },
    ]
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, data: edges }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const client = new ApiClient('http://localhost:12436', 'v1')
    const { relations, total } = await client.listRelations()
    expect(relations).toHaveLength(3)
    expect(total).toBe(3) // total always equals relations.length on v1
    const [url] = fetchSpy.mock.calls[0] as [string]
    expect(url).toBe('http://localhost:12436/api/v1/relations')
  })

  test('legacy listRelations drops CORRELATED_WITH then caps at 2000, total = post-drop pre-cap count', async () => {
    // 3 real edges + 2 CORRELATED_WITH edges. After drop: 3 relations, total=3.
    const edges = [
      { source: 'a', target: 'b', attributes: { type: 'derives_from' } },
      { source: 'b', target: 'c', attributes: { type: 'CORRELATED_WITH' } },
      { source: 'c', target: 'd', attributes: { type: 'related' } },
      { source: 'd', target: 'e', attributes: { type: 'correlated_with' } },
      { source: 'e', target: 'f', attributes: { type: 'depends_on' } },
    ]
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, data: edges }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const client = new ApiClient('http://localhost:8090', 'legacy')
    const { relations, total } = await client.listRelations()
    expect(total).toBe(3) // CORRELATED_WITH (both casings) dropped first
    expect(relations).toHaveLength(3)
    expect(relations.some((r) => r.type === 'CORRELATED_WITH')).toBe(false)
    const [url] = fetchSpy.mock.calls[0] as [string]
    expect(url).toBe('http://localhost:8090/api/relations')
  })

  test('legacy listRelations caps relations at OKB_RELATION_CAP (2000) while total keeps the pre-cap count', async () => {
    const edges = Array.from({ length: 2500 }, (_, i) => ({
      source: `n${i}`,
      target: `n${i + 1}`,
      attributes: { type: 'related' },
    }))
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, data: edges }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const client = new ApiClient('http://localhost:8090', 'legacy')
    const { relations, total } = await client.listRelations()
    expect(relations).toHaveLength(2000) // capped
    expect(total).toBe(2500) // pre-cap (post-drop) count preserved for the honesty indicator
  })

  test('supportsServerNeighbors is true for v1, false for legacy', () => {
    expect(new ApiClient('http://localhost:12436').supportsServerNeighbors()).toBe(true)
    expect(new ApiClient('http://localhost:12436', 'v1').supportsServerNeighbors()).toBe(true)
    expect(new ApiClient('http://localhost:8090', 'legacy').supportsServerNeighbors()).toBe(false)
  })
})
