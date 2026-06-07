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
    expect(url).toBe('http://localhost:12436/api/v1/entities')
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
})
