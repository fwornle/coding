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

  // 2026-09-26: `getNeighbors` and `supportsServerNeighbors` are gone, and
  // their tests with them. Both are worth remembering as a pair of shapes to
  // distrust. The getNeighbors test asserted the URL the client BUILT — it
  // passed for as long as the method existed, and would have passed just the
  // same if no server had ever mounted that path, which is exactly what was
  // true. And supportsServerNeighbors answered a CAPABILITY question from a
  // VERSION number: `apiVersion === 'v1'`. It returned true for coding for a
  // year while the route 404'd. A capability check that never touches the
  // thing it describes can only restate its own input.
})

// ---------------------------------------------------------------------------
// updateEntityMetadata — the two bugs that shipped, and what stops them
// ---------------------------------------------------------------------------
//
// 1. DESTRUCTIVE PAYLOAD. `mergeAttributes` merges top-level attributes, so
//    `{metadata:{parentId}}` REPLACES the metadata object. Sending only the
//    changed field deleted 14 of 15 keys on a live entity — provenance,
//    ontology, parentEntityName, all of it.
// 2. SILENT SUCCESS. The handler answers 200 for an id it does not hold, and a
//    merge that dropped the patch looked exactly like one that applied it. The
//    UI reported placing 11 rows while placing none.
describe('ApiClient.updateEntityMetadata', () => {
  const ENTITY = {
    id: 'e1',
    metadata: { parentEntityName: 'Comp', provenance: { confirmationCount: 2 }, team: 'coding' },
  }

  function mockFetch(putResponder: (body: Record<string, unknown>) => unknown) {
    return vi.fn(async (url: string, init?: RequestInit) => {
      if (!init || init.method !== 'PUT') {
        return { ok: true, status: 200, json: async () => ({ success: true, data: ENTITY }) }
      }
      const sent = JSON.parse(String(init.body)) as Record<string, unknown>
      return { ok: true, status: 200, json: async () => putResponder(sent) }
    })
  }

  test('PRESERVES existing metadata — sends the union, not just the patch', async () => {
    let sentMetadata: Record<string, unknown> = {}
    const f = mockFetch((sent) => {
      sentMetadata = (sent.metadata ?? {}) as Record<string, unknown>
      return { success: true, data: { id: 'e1', metadata: sentMetadata } }
    })
    vi.stubGlobal('fetch', f)
    const client = new ApiClient('http://test.local')
    await client.updateEntityMetadata('e1', { parentId: 'p1' })
    // The whole point: the keys that were there are still there.
    expect(sentMetadata.parentId).toBe('p1')
    expect(sentMetadata.parentEntityName).toBe('Comp')
    expect(sentMetadata.team).toBe('coding')
    expect(sentMetadata.provenance).toEqual({ confirmationCount: 2 })
    vi.unstubAllGlobals()
  })

  test('THROWS when the server accepts the write but the field did not change', async () => {
    // A 200 that changed nothing is the one outcome a caller must not read as
    // success — it is what let the panel claim 11 placements and make none.
    vi.stubGlobal('fetch', mockFetch(() => ({ success: true, data: { id: 'e1', metadata: {} } })))
    const client = new ApiClient('http://test.local')
    await expect(client.updateEntityMetadata('e1', { parentId: 'p1' })).rejects.toThrow(/did not change/)
    vi.unstubAllGlobals()
  })

  test('THROWS when the id does not exist (handler answers 200 + data:null)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, json: async () => ({ success: true, data: null }),
    })))
    const client = new ApiClient('http://test.local')
    await expect(client.updateEntityMetadata('nope', { parentId: 'p1' })).rejects.toThrow(/nothing was written/)
    vi.unstubAllGlobals()
  })

  test('marks a 503 transient so the caller can say "still starting up"', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) =>
      init?.method === 'PUT'
        ? { ok: false, status: 503, json: async () => ({}) }
        : { ok: true, status: 200, json: async () => ({ success: true, data: ENTITY }) }))
    const client = new ApiClient('http://test.local')
    await expect(client.updateEntityMetadata('e1', { parentId: 'p1' }))
      .rejects.toMatchObject({ transient: true })
    vi.unstubAllGlobals()
  })
})
