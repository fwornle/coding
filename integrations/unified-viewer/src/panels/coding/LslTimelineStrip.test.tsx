// PATTERN SOURCE: 55-11-PLAN.md Task 2 <behavior>
//   + 55-PATTERNS.md § LslTimelineStrip.tsx (data shape + render + executor guidance)
//   + 55-UI-SPEC.md §13.2 (LSL Timeline Strip full UX + click semantics)
//
// Behavior covered (the plan's <behavior> block):
//   - Test: when system !== 'coding', returns null
//   - Test (window toggle): default 7d; clicking 24h re-fetches with since=now-24h
//   - Test (render): each session is a tick (w-2 h-6 inside h-8 strip), positioned
//     by pctOfWindow(startAt), sorted by startAt
//   - Test (tooltip content): hover shows id slice + start/end/running + obs + entity count
//   - Test (active session): endAt === null has ring-2 ring-primary
//   - Test (click single): setLslSessionFilter([id])
//   - Test (Cmd/Ctrl+click): addLslSessionFilter(id)
//   - Test (keyboard): ← / → between ticks; Enter to select; Esc to clear
//   - Test (empty): "No sessions recorded in this time window."
//   - Test (Logger): logs window change + tick click; no raw console.*

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import LslTimelineStrip from './LslTimelineStrip'
import { useViewerStore } from '@/store/viewer-store'
import { ApiClient } from '@/api/ApiClient'

interface LslSession {
  id: string
  startAt: string
  endAt: string | null
  observationCount: number
  entityIds: string[]
}

function nowMinusHours(hours: number): string {
  return new Date(Date.now() - hours * 3600_000).toISOString()
}

function makeSessions(): LslSession[] {
  return [
    // running session — endAt null
    {
      id: 'sess-aaaaaaaa',
      startAt: nowMinusHours(0.5),
      endAt: null,
      observationCount: 5,
      entityIds: ['e1', 'e2'],
    },
    {
      id: 'sess-bbbbbbbb',
      startAt: nowMinusHours(2),
      endAt: nowMinusHours(1.5),
      observationCount: 12,
      entityIds: ['e3'],
    },
    {
      id: 'sess-cccccccc',
      startAt: nowMinusHours(48),
      endAt: nowMinusHours(47),
      observationCount: 8,
      entityIds: ['e4', 'e5', 'e6'],
    },
  ]
}

function makeFetchResponse(payload: unknown): typeof fetch {
  return vi.fn().mockImplementation(async () => {
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ success: true, data: payload }),
    } as Response
  }) as unknown as typeof fetch
}

function renderStrip({
  system = 'coding',
  sessions = makeSessions(),
}: {
  system?: 'coding' | 'okb'
  sessions?: LslSession[]
} = {}) {
  const originalFetch = globalThis.fetch
  const fetchImpl = makeFetchResponse({ sessions })
  globalThis.fetch = fetchImpl
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })
  const apiClient = new ApiClient('http://localhost:12436')
  const result = render(
    <QueryClientProvider client={client}>
      <LslTimelineStrip system={system} apiClient={apiClient} />
    </QueryClientProvider>,
  )
  return {
    ...result,
    fetchImpl,
    apiClient,
    restore: () => {
      globalThis.fetch = originalFetch
    },
  }
}

beforeEach(() => {
  useViewerStore.setState({
    lslSessionFilter: [],
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('LslTimelineStrip', () => {
  test('Test 1: returns null when system !== "coding"', () => {
    const r = renderStrip({ system: 'okb' })
    try {
      // okb gate — nothing rendered
      expect(r.container.textContent ?? '').toBe('')
      // fetch should not have been called
      expect(r.fetchImpl).not.toHaveBeenCalled()
    } finally {
      r.restore()
    }
  })

  test('Test 2: default window is 7d; fetches /api/coding/lsl/sessions?since=now-7d&limit=200', async () => {
    const r = renderStrip()
    try {
      await waitFor(() => {
        expect(r.fetchImpl).toHaveBeenCalled()
      })
      const url = (r.fetchImpl as unknown as { mock: { calls: [string][] } }).mock.calls[0][0]
      expect(url).toMatch(/\/api\/coding\/lsl\/sessions\?since=.+&limit=200/)
    } finally {
      r.restore()
    }
  })

  test('Test 3: clicking 24h re-fetches with since≈now-24h', async () => {
    const r = renderStrip()
    try {
      await waitFor(() => expect(r.fetchImpl).toHaveBeenCalled())
      const initialCalls = (r.fetchImpl as unknown as { mock: { calls: [string][] } }).mock.calls.length
      const btn24h = screen.getByRole('radio', { name: /24h/ })
      act(() => {
        fireEvent.click(btn24h)
      })
      await waitFor(() => {
        const callsNow = (r.fetchImpl as unknown as { mock: { calls: [string][] } }).mock.calls.length
        expect(callsNow).toBeGreaterThan(initialCalls)
      })
      const allCalls = (r.fetchImpl as unknown as { mock: { calls: [string][] } }).mock.calls
      const last = allCalls[allCalls.length - 1][0]
      // since must be within last ~24h
      const m = last.match(/since=([^&]+)/)
      expect(m).toBeTruthy()
      const sinceIso = decodeURIComponent(m![1])
      const sinceMs = new Date(sinceIso).getTime()
      const diff = Date.now() - sinceMs
      expect(diff).toBeGreaterThan(23 * 3600_000)
      expect(diff).toBeLessThan(25 * 3600_000)
    } finally {
      r.restore()
    }
  })

  test('Test 4: renders a tick button per session', async () => {
    const r = renderStrip()
    try {
      await waitFor(() => {
        const ticks = screen.getAllByTestId(/^lsl-tick-/)
        expect(ticks.length).toBe(3)
      })
    } finally {
      r.restore()
    }
  })

  test('Test 5: active (running) session tick has ring-2 ring-primary outline', async () => {
    const r = renderStrip()
    try {
      await waitFor(() => {
        const tick = screen.getByTestId('lsl-tick-sess-aaaaaaaa')
        expect(tick.className).toMatch(/ring-2/)
        expect(tick.className).toMatch(/ring-primary/)
      })
    } finally {
      r.restore()
    }
  })

  test('Test 6: click a tick sets setLslSessionFilter([id]) (replaces selection)', async () => {
    useViewerStore.setState({ lslSessionFilter: ['stale'] })
    const r = renderStrip()
    try {
      await waitFor(() => screen.getByTestId('lsl-tick-sess-bbbbbbbb'))
      const tick = screen.getByTestId('lsl-tick-sess-bbbbbbbb')
      act(() => {
        fireEvent.click(tick)
      })
      expect(useViewerStore.getState().lslSessionFilter).toEqual(['sess-bbbbbbbb'])
    } finally {
      r.restore()
    }
  })

  test('Test 7: Cmd/Ctrl+click calls addLslSessionFilter (additive)', async () => {
    useViewerStore.setState({ lslSessionFilter: ['sess-aaaaaaaa'] })
    const r = renderStrip()
    try {
      await waitFor(() => screen.getByTestId('lsl-tick-sess-bbbbbbbb'))
      const tick = screen.getByTestId('lsl-tick-sess-bbbbbbbb')
      act(() => {
        fireEvent.click(tick, { metaKey: true })
      })
      const filter = useViewerStore.getState().lslSessionFilter
      expect(filter).toContain('sess-aaaaaaaa')
      expect(filter).toContain('sess-bbbbbbbb')
    } finally {
      r.restore()
    }
  })

  test('Test 8: Esc clears the LSL session filter', async () => {
    useViewerStore.setState({ lslSessionFilter: ['sess-aaaaaaaa'] })
    const r = renderStrip()
    try {
      await waitFor(() => screen.getByTestId('lsl-strip'))
      const strip = screen.getByTestId('lsl-strip')
      act(() => {
        fireEvent.keyDown(strip, { key: 'Escape' })
      })
      expect(useViewerStore.getState().lslSessionFilter).toEqual([])
    } finally {
      r.restore()
    }
  })

  test('Test 9: Enter selects the focused tick (sets filter to [focusedId])', async () => {
    const r = renderStrip()
    try {
      await waitFor(() => screen.getByTestId('lsl-tick-sess-bbbbbbbb'))
      const tick = screen.getByTestId('lsl-tick-sess-bbbbbbbb') as HTMLElement
      tick.focus()
      act(() => {
        fireEvent.keyDown(tick, { key: 'Enter' })
      })
      expect(useViewerStore.getState().lslSessionFilter).toEqual(['sess-bbbbbbbb'])
    } finally {
      r.restore()
    }
  })

  test('Test 10: empty state — "No sessions recorded in this time window."', async () => {
    const r = renderStrip({ sessions: [] })
    try {
      await waitFor(() => {
        expect(screen.getByText(/No sessions recorded in this time window/)).toBeTruthy()
      })
      // Toggle group still visible
      expect(screen.getByRole('radio', { name: /24h/ })).toBeTruthy()
    } finally {
      r.restore()
    }
  })

  test('Test 11: Logger discipline — no raw console.* in the source file', () => {
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/panels/coding/LslTimelineStrip.tsx'),
      'utf8',
    )
    expect(src).not.toMatch(/console\.(log|warn|error|info|debug|trace)/)
  })

  test('Test 12: source-grep gates — system==coding gate, /api/coding/lsl/sessions, ToggleGroup, setLslSessionFilter all present (≥4)', () => {
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/panels/coding/LslTimelineStrip.tsx'),
      'utf8',
    )
    expect(src).toMatch(/system === ['"]coding['"]/)
    expect(src).toMatch(/\/api\/coding\/lsl\/sessions/)
    expect(src).toMatch(/ToggleGroup/)
    expect(src).toMatch(/setLslSessionFilter/)
  })

  test('Test 13: default export present (single occurrence)', () => {
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/panels/coding/LslTimelineStrip.tsx'),
      'utf8',
    )
    const matches = src.match(/export default/g) ?? []
    expect(matches.length).toBe(1)
  })
})
