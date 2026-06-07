// PATTERN SOURCE: 45-05-PLAN.md Task 1 <behavior>
//   8 tests covering OkmRcaClient REST + SSE surface.
//
// The client is a verbatim port of VOKB's okbClient.ts:474-497 surface
// (listDirs / getStatus / rcaIngest / subscribeProgress). Endpoints live at
// /api/okm/rca/* (NOT /api/v1/*) — see 45-RESEARCH.md § Summary line 115.
//
// We stub global.fetch like the ApiClient suite does (no MSW dep added),
// and stub the global EventSource constructor so subscribeProgress() can be
// driven synchronously inside jsdom.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { OkmRcaClient, type PipelineEvent } from './OkmRcaClient'

// ---------- TestEventSource ---------------------------------------------
// Minimal EventSource stub: tests can call .__emit(payloadString) or
// .__emitError() to simulate server-pushed messages. The real EventSource
// sends a `message` event whose `data` is a string; we mirror that.
class TestEventSource {
  static instances: TestEventSource[] = []
  url: string
  onmessage: ((ev: MessageEvent) => void) | null = null
  onerror: ((ev: Event) => void) | null = null
  onopen: ((ev: Event) => void) | null = null
  closeCallCount = 0
  readyState = 1 // OPEN

  constructor(url: string) {
    this.url = url
    TestEventSource.instances.push(this)
  }

  close(): void {
    this.closeCallCount += 1
    this.readyState = 2 // CLOSED
  }

  __emit(data: string): void {
    if (this.onmessage) {
      this.onmessage({ data } as MessageEvent)
    }
  }

  __emitError(): void {
    if (this.onerror) {
      this.onerror({} as Event)
    }
  }
}

describe('OkmRcaClient', () => {
  let fetchSpy: ReturnType<typeof vi.fn>
  const BASE = 'https://okm.cc.bmwgroup.net'

  beforeEach(() => {
    fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    TestEventSource.instances = []
    vi.stubGlobal('EventSource', TestEventSource as unknown as typeof EventSource)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // Test 1 -----------------------------------------------------------------
  test('listDirs() issues GET /api/okm/rca/dirs with credentials:"include" and returns RcaDirGroups', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          kpifw: [{ path: '/data/kpifw/run-1', timestamp: '2026-06-07T01:00:00Z', findingCount: 3 }],
          raas: [],
          e2e: [{ path: '/data/e2e/run-x', timestamp: '2026-06-07T01:05:00Z', findingCount: 1 }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    const client = new OkmRcaClient(BASE)
    const result = await client.listDirs()

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/api/okm/rca/dirs`)
    expect(init.credentials).toBe('include')
    expect((init.headers as Record<string, string>).Accept).toBe('application/json')

    expect(result.kpifw).toHaveLength(1)
    expect(result.raas).toHaveLength(0)
    expect(result.e2e).toHaveLength(1)
    expect(result.kpifw[0].findingCount).toBe(3)
  })

  // Test 2 -----------------------------------------------------------------
  test('rcaIngest("raas", "/path", {force:true}) POSTs JSON body with force flag', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: true, runId: 'abc-123' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    const client = new OkmRcaClient(BASE)
    const result = await client.rcaIngest('raas', '/path/to/dir', { force: true })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/api/okm/rca/ingest`)
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body).toEqual({ pipeline: 'raas', dirPath: '/path/to/dir', force: true })
    expect(result).toEqual({ success: true, runId: 'abc-123' })
  })

  // Test 3 -----------------------------------------------------------------
  test('rcaIngest without opts defaults force:false', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ success: true, runId: 'def-456' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    const client = new OkmRcaClient(BASE)
    await client.rcaIngest('kpifw', '/path/x')
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.force).toBe(false)
  })

  // Test 4 -----------------------------------------------------------------
  test('subscribeProgress returns an EventSource and parses JSON onmessage to invoke cb', () => {
    const client = new OkmRcaClient(BASE)
    const received: PipelineEvent[] = []
    const es = client.subscribeProgress((ev) => received.push(ev))

    expect(es).toBeInstanceOf(TestEventSource)
    expect((es as unknown as TestEventSource).url).toBe(`${BASE}/api/okm/ingest/progress`)

    // Simulate a stage event.
    ;(es as unknown as TestEventSource).__emit(
      JSON.stringify({ type: 'stage', stage: 'dedup', timestamp: '2026-06-07T01:01:00Z' }),
    )
    expect(received).toHaveLength(1)
    expect(received[0].type).toBe('stage')
    expect(received[0].stage).toBe('dedup')
  })

  // Test 5 -----------------------------------------------------------------
  test('a "connected" event triggers cb({type:"connected"}) — VOKB bootstrap path', () => {
    const client = new OkmRcaClient(BASE)
    const received: PipelineEvent[] = []
    const es = client.subscribeProgress((ev) => received.push(ev))

    ;(es as unknown as TestEventSource).__emit(JSON.stringify({ type: 'connected' }))

    expect(received).toHaveLength(1)
    expect(received[0].type).toBe('connected')
  })

  // Test 6 -----------------------------------------------------------------
  test('a malformed SSE message does NOT throw — cb receives {type:"error"} and EventSource stays open', () => {
    const client = new OkmRcaClient(BASE)
    const received: PipelineEvent[] = []
    const es = client.subscribeProgress((ev) => received.push(ev))
    const tes = es as unknown as TestEventSource

    expect(() => tes.__emit('this is not JSON {{{')).not.toThrow()
    expect(received).toHaveLength(1)
    expect(received[0].type).toBe('error')
    expect(received[0].message).toBeDefined()
    expect(tes.readyState).toBe(1) // still OPEN — close() not called
  })

  // Test 7 -----------------------------------------------------------------
  test('getStatus() issues GET /api/okm/rca/status and returns IngestionStatus shape', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          active: true,
          pipeline: 'raas',
          dirPath: '/data/raas/run-7',
          currentStage: 'store',
          progress: 42,
          startedAt: '2026-06-07T01:00:00Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    const client = new OkmRcaClient(BASE)
    const status = await client.getStatus()

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/api/okm/rca/status`)
    expect(init.credentials).toBe('include')

    expect(status.active).toBe(true)
    expect(status.pipeline).toBe('raas')
    expect(status.currentStage).toBe('store')
    expect(status.progress).toBe(42)
  })

  // Test 8 -----------------------------------------------------------------
  test('non-2xx responses throw Error containing the request path', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('Service Unavailable', { status: 503 }))
    const client = new OkmRcaClient(BASE)
    await expect(client.listDirs()).rejects.toThrow(/\/api\/okm\/rca\/dirs/)
  })
})
