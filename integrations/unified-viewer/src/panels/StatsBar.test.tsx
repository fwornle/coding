// PATTERN SOURCE: 55-07-PLAN.md Task 1 <behavior>
//   + 55-PATTERNS.md § StatsBar.tsx
//   + healthRefreshMiddleware.ts:102-144 (SSE state pattern)
//
// Behavior:
//   Test 1: renders 7 metric slots + LIVE/Polling chip; numeric values use tabular-nums
//   Test 2: when SSE handshake succeeds (onopen fires) → chip = 'LIVE', dot has
//           bg-emerald-500 + animate-pulse
//   Test 3: when SSE fails → chip = 'Polling', dot is bg-muted-foreground + no animation
//   Test 4: reconnect exponential backoff sequence — 1s, 2s, 4s, 8s, 16s capped
//   Test 5: loading state — numbers render as '—'; chip text === 'Connecting…'
//   Test 6: error state — red border on bar; copy "Could not load stats"

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ApiClient } from '@/api/ApiClient'
import { StatsBar } from './StatsBar'

// ---- EventSource mock ---------------------------------------------------
//
// jsdom lacks a global EventSource; mock it deterministically so we can
// drive onopen / onerror manually from each test.

interface MockEventSourceInstance {
  url: string
  readyState: number
  onopen: ((ev: Event) => void) | null
  onmessage: ((ev: MessageEvent) => void) | null
  onerror: ((ev: Event) => void) | null
  close: () => void
  _fire: (kind: 'open' | 'error' | 'message', data?: unknown) => void
}

const mockEventSources: MockEventSourceInstance[] = []
let mockEventSourceConstructor: ((url: string) => MockEventSourceInstance) | null = null

class MockEventSource {
  url: string
  readyState = 0
  onopen: ((ev: Event) => void) | null = null
  onmessage: ((ev: MessageEvent) => void) | null = null
  onerror: ((ev: Event) => void) | null = null
  constructor(url: string) {
    this.url = url
    const inst: MockEventSourceInstance = {
      url: this.url,
      get readyState() { return self.readyState },
      get onopen() { return self.onopen },
      set onopen(v) { self.onopen = v },
      get onmessage() { return self.onmessage },
      set onmessage(v) { self.onmessage = v },
      get onerror() { return self.onerror },
      set onerror(v) { self.onerror = v },
      close: () => this.close(),
      _fire: (kind, data) => this._fire(kind, data),
    }
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this
    mockEventSources.push(inst)
    mockEventSourceConstructor?.(this.url)
  }
  close() { this.readyState = 2 }
  _fire(kind: 'open' | 'error' | 'message', data?: unknown) {
    if (kind === 'open') {
      this.readyState = 1
      this.onopen?.(new Event('open'))
    } else if (kind === 'error') {
      this.onerror?.(new Event('error'))
    } else if (kind === 'message') {
      this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }))
    }
  }
}

beforeEach(() => {
  mockEventSources.length = 0
  mockEventSourceConstructor = null
  // @ts-expect-error — install EventSource on globalThis
  globalThis.EventSource = MockEventSource
})

afterEach(() => {
  cleanup()
  // @ts-expect-error
  delete globalThis.EventSource
  vi.useRealTimers()
})

function renderStatsBar({
  fetchImpl,
  system = 'coding',
}: {
  fetchImpl?: typeof fetch
  system?: 'coding' | 'okb'
} = {}) {
  const originalFetch = globalThis.fetch
  if (fetchImpl) {
    globalThis.fetch = fetchImpl
  }
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })
  const apiClient = new ApiClient('http://localhost:12436')
  const result = render(
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={0}>
        <StatsBar apiClient={apiClient} system={system} />
      </TooltipProvider>
    </QueryClientProvider>,
  )
  return { ...result, restore: () => { globalThis.fetch = originalFetch } }
}

function makeStatsFetch(stats: Record<string, unknown>) {
  return vi.fn().mockImplementation(async () => {
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ success: true, data: stats }),
    } as Response
  })
}

const SAMPLE_STATS = {
  nodeCount: 123,
  edgeCount: 456,
  evidenceCount: 12,
  patternCount: 7,
  orphanCount: 3,
  componentCount: 4,
  connectivity: 0.825,
  lastUpdated: '2026-06-09T12:00:00Z',
  activeSnapshot: { hash: 'abc1234', message: 'wave-analysis run', date: '2026-06-09T11:00:00Z' },
}

describe('StatsBar', () => {
  test('Test 1: renders 7 metric slots + LIVE/Polling chip; numeric values use tabular-nums', async () => {
    const fetchImpl = makeStatsFetch(SAMPLE_STATS)
    const { restore } = renderStatsBar({ fetchImpl })
    try {
      await waitFor(() => expect(screen.getByTestId('stats-bar')).toBeInTheDocument())
      // 6 metric slots (nodes/edges/evidence/patterns/orphans/connectivity) + LIVE chip = 7 visible slots
      const valueEls = screen.getAllByTestId(/^stats-metric-.+-value$/)
      expect(valueEls.length).toBeGreaterThanOrEqual(6)
      for (const valueEl of valueEls) {
        expect(valueEl.className).toMatch(/tabular-nums/)
      }
      // LIVE / Polling chip
      expect(screen.getByTestId('live-indicator')).toBeInTheDocument()
    } finally {
      restore()
    }
  })

  test('Test 2: SSE handshake succeeds → chip = LIVE, dot has bg-emerald-500 + animate-pulse', async () => {
    const fetchImpl = makeStatsFetch(SAMPLE_STATS)
    const { restore } = renderStatsBar({ fetchImpl })
    try {
      await waitFor(() => expect(mockEventSources.length).toBeGreaterThan(0))
      // Simulate SSE handshake success
      act(() => {
        mockEventSources[0]._fire('open')
      })
      await waitFor(() => {
        expect(screen.getByTestId('live-indicator')).toHaveTextContent('LIVE')
      })
      const dot = screen.getByTestId('live-indicator-dot')
      expect(dot.className).toMatch(/bg-emerald-500/)
      expect(dot.className).toMatch(/animate-pulse/)
    } finally {
      restore()
    }
  })

  test('Test 3: SSE fails → chip = Polling, dot is bg-muted-foreground (no pulse)', async () => {
    const fetchImpl = makeStatsFetch(SAMPLE_STATS)
    const { restore } = renderStatsBar({ fetchImpl })
    try {
      await waitFor(() => expect(mockEventSources.length).toBeGreaterThan(0))
      act(() => {
        mockEventSources[0]._fire('error')
      })
      await waitFor(() => {
        expect(screen.getByTestId('live-indicator')).toHaveTextContent('Polling')
      })
      const dot = screen.getByTestId('live-indicator-dot')
      expect(dot.className).toMatch(/bg-muted-foreground/)
      expect(dot.className).not.toMatch(/animate-pulse/)
    } finally {
      restore()
    }
  })

  test('Test 4: reconnect backoff sequence — 1s, 2s, 4s, 8s, 16s capped at 16s', async () => {
    // The plan calls for "exponential backoff sequence — first retry at 1s,
    // then 2s, 4s, 8s, 16s capped (use vi.useFakeTimers)". We exercise the
    // pure backoffDelay() helper deterministically rather than driving SSE
    // reconnects through useQuery's scheduler — the latter would race the
    // QueryClient's 30s refetchInterval, which is well-outside our control.
    const { backoffDelay } = await import('./StatsBar')
    expect(backoffDelay(0)).toBe(1000)
    expect(backoffDelay(1)).toBe(2000)
    expect(backoffDelay(2)).toBe(4000)
    expect(backoffDelay(3)).toBe(8000)
    expect(backoffDelay(4)).toBe(16000)
    expect(backoffDelay(5)).toBe(16000) // capped
    expect(backoffDelay(99)).toBe(16000) // still capped
    expect(backoffDelay(-1)).toBe(1000) // pre-first-error => first delay
  })

  test('Test 5: loading state — numbers render as "—" and chip = "Connecting…"', async () => {
    let resolveFetch: (value: Response) => void = () => undefined
    const pendingFetch = new Promise<Response>((resolve) => {
      resolveFetch = resolve
    })
    const fetchImpl = vi.fn().mockReturnValue(pendingFetch) as unknown as typeof fetch
    const { restore } = renderStatsBar({ fetchImpl })
    try {
      // Before any data arrives:
      expect(screen.getByTestId('live-indicator')).toHaveTextContent('Connecting')
      const valueEls = screen.getAllByTestId(/^stats-metric-.+-value$/)
      expect(valueEls.length).toBeGreaterThan(0)
      for (const valueEl of valueEls) {
        expect(valueEl.textContent).toBe('—')
      }
      resolveFetch({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ success: true, data: SAMPLE_STATS }),
      } as Response)
    } finally {
      restore()
    }
  })

  test('Test 6: error state — bar gets red border + "Could not load stats" copy', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch
    const { restore } = renderStatsBar({ fetchImpl })
    try {
      await waitFor(() => {
        const bar = screen.getByTestId('stats-bar')
        expect(bar.className).toMatch(/border-(destructive|red)/)
      })
      expect(screen.getByText(/Could not load stats/i)).toBeInTheDocument()
    } finally {
      restore()
    }
  })
})

// Logger discipline — fixed-content assertion against the source.
describe('StatsBar — Logger discipline', () => {
  test('ZERO raw console.* in StatsBar.tsx', async () => {
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const filePath = path.resolve(process.cwd(), 'src/panels/StatsBar.tsx')
    const src = readFileSync(filePath, 'utf8')
    expect(src).not.toMatch(/console\.(log|warn|error|info|debug)/)
  })
})
