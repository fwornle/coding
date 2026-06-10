// PATTERN SOURCE: 55-12-PLAN.md Task 1 <behavior>
//   + 55-PATTERNS.md § EtmTailSheet.tsx (SSE pattern with backoff + Sheet pattern)
//   + 55-UI-SPEC.md §13.3 (ETM Live Tail Sheet UX), §15 (aria-live)
//
// Behavior covered (the plan's <behavior> block):
//   - Test 1: when system !== 'coding', returns null
//   - Test 2 (SSE connect): on mount, opens EventSource at /api/coding/observations/stream
//   - Test 3 (SSE onopen): calls setEtmStreamConnected(true)
//   - Test 4 (SSE onmessage): valid JSON observation → pushObservation
//   - Test 5 (SSE error + backoff): on error sets setEtmStreamConnected(false), closes sse,
//                                   schedules reconnect with 1s, 2s, 4s, 8s, 16s capped delays
//   - Test 6 (cleanup): on unmount, sse.close() is called (no leak)
//   - Test 7 (render): Sheet opens when etmSheetOpen === true; header shows "ETM Live Tail"
//   - Test 8 (LIVE dot): when connected, dot has bg-emerald-500 animate-pulse;
//                       when disconnected, bg-muted-foreground (no animation)
//   - Test 9 (aria-live): body has aria-live="polite" aria-atomic="false"
//   - Test 10 (row render): timestamp + agent tag + 1-line summary
//   - Test 11 (agent color): claude=violet, copilot=blue, opencode=teal, mastra=amber
//   - Test 12 (click row): observation.referencedEntities[0] → setSelectedNode
//   - Test 13 (burst debounce): 25 messages within 100ms → batched into the store
//   - Test 14 (keyboard `t`): toggles etmSheetOpen
//   - Test 15 (Logger): no raw console.* in source

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act, cleanup, waitFor } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import EtmTailSheet from './EtmTailSheet'
import { useViewerStore } from '@/store/viewer-store'
import { _resetSequenceRegistryForTests, useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { ApiClient } from '@/api/ApiClient'

// --- Mock EventSource ------------------------------------------------------

interface MockEventSourceLike {
  url: string
  readyState: number
  onopen: ((ev: Event) => void) | null
  onmessage: ((ev: MessageEvent) => void) | null
  onerror: ((ev: Event) => void) | null
  close: () => void
}

let activeEventSources: MockEventSourceLike[] = []

class MockEventSource implements MockEventSourceLike {
  static OPEN = 1
  static CLOSED = 2
  url: string
  readyState = 0
  onopen: ((ev: Event) => void) | null = null
  onmessage: ((ev: MessageEvent) => void) | null = null
  onerror: ((ev: Event) => void) | null = null
  closed = false
  constructor(url: string) {
    this.url = url
    activeEventSources.push(this)
  }
  close(): void {
    this.closed = true
    this.readyState = MockEventSource.CLOSED
  }
}

function lastEventSource(): MockEventSource {
  return activeEventSources[activeEventSources.length - 1] as MockEventSource
}

// --- Test harness ----------------------------------------------------------

function HostWithKeyboard({
  system = 'coding',
  apiClient,
}: {
  system?: 'coding' | 'okb'
  apiClient: ApiClient
}) {
  // Mount useKeyboardShortcuts so registerSequence(/etc.) is available for
  // any sequence-based shortcuts the EtmTailSheet may need. The `t` shortcut
  // is single-key and lives inside EtmTailSheet itself; we still mount the
  // hook so the document keydown listener is the same in tests as in prod.
  useKeyboardShortcuts({ onOpenHelpDialog: () => {}, onCloseHelpDialog: () => false })
  return (
    <TooltipProvider>
      <EtmTailSheet system={system} apiClient={apiClient} />
    </TooltipProvider>
  )
}

function renderSheet({
  system = 'coding',
}: {
  system?: 'coding' | 'okb'
} = {}) {
  const originalES = (globalThis as { EventSource?: unknown }).EventSource
  ;(globalThis as { EventSource: unknown }).EventSource = MockEventSource
  const apiClient = new ApiClient('http://localhost:12436')
  const result = render(<HostWithKeyboard system={system} apiClient={apiClient} />)
  return {
    ...result,
    apiClient,
    restore: () => {
      ;(globalThis as { EventSource?: unknown }).EventSource = originalES
      activeEventSources = []
    },
  }
}

beforeEach(() => {
  activeEventSources = []
  _resetSequenceRegistryForTests()
  useViewerStore.setState({
    etmObservations: [],
    etmStreamConnected: false,
    etmSheetOpen: false,
    selectedNodeId: null,
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('EtmTailSheet', () => {
  test('Test 1: returns null when system !== "coding"', () => {
    const r = renderSheet({ system: 'okb' })
    try {
      expect(r.container.textContent ?? '').toBe('')
      expect(activeEventSources.length).toBe(0)
    } finally {
      r.restore()
    }
  })

  test('Test 2: opens EventSource at /api/coding/observations/stream on mount', () => {
    const r = renderSheet()
    try {
      expect(activeEventSources.length).toBe(1)
      expect(lastEventSource().url).toBe(
        'http://localhost:12436/api/coding/observations/stream',
      )
    } finally {
      r.restore()
    }
  })

  test('Test 3: SSE onopen sets etmStreamConnected to true', () => {
    const r = renderSheet()
    try {
      const sse = lastEventSource()
      act(() => {
        sse.onopen?.(new Event('open'))
      })
      expect(useViewerStore.getState().etmStreamConnected).toBe(true)
    } finally {
      r.restore()
    }
  })

  test('Test 4: SSE onmessage with valid Observation JSON pushes to ring buffer', async () => {
    const r = renderSheet()
    try {
      const sse = lastEventSource()
      const obs = {
        id: 'obs-1',
        agent: 'claude',
        project: 'coding',
        content: 'first observation summary',
        artifacts: [],
        timestamp: new Date().toISOString(),
      }
      act(() => {
        sse.onmessage?.(new MessageEvent('message', { data: JSON.stringify(obs) }))
      })
      // Burst debounce: single message is flushed without delay (no batching when <2 items)
      await waitFor(() => {
        expect(useViewerStore.getState().etmObservations.length).toBe(1)
      })
      expect(useViewerStore.getState().etmObservations[0].id).toBe('obs-1')
    } finally {
      r.restore()
    }
  })

  test('Test 5: SSE onerror sets disconnected, closes sse, schedules reconnect with exp backoff', () => {
    vi.useFakeTimers()
    const r = renderSheet()
    try {
      const first = lastEventSource()
      // open first, then error
      act(() => {
        first.onopen?.(new Event('open'))
      })
      expect(useViewerStore.getState().etmStreamConnected).toBe(true)
      act(() => {
        first.onerror?.(new Event('error'))
      })
      expect(useViewerStore.getState().etmStreamConnected).toBe(false)
      expect(first.closed).toBe(true)

      // First retry at 1s
      const beforeFirstRetry = activeEventSources.length
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      expect(activeEventSources.length).toBe(beforeFirstRetry + 1)
      const second = lastEventSource()
      // error again → reconnect at 2s
      act(() => {
        second.onerror?.(new Event('error'))
      })
      const beforeSecondRetry = activeEventSources.length
      act(() => {
        vi.advanceTimersByTime(2000)
      })
      expect(activeEventSources.length).toBe(beforeSecondRetry + 1)
      const third = lastEventSource()
      // error → 4s
      act(() => {
        third.onerror?.(new Event('error'))
      })
      const beforeThirdRetry = activeEventSources.length
      act(() => {
        vi.advanceTimersByTime(4000)
      })
      expect(activeEventSources.length).toBe(beforeThirdRetry + 1)
    } finally {
      r.restore()
      vi.useRealTimers()
    }
  })

  test('Test 6: unmount closes the EventSource (no leak)', () => {
    const r = renderSheet()
    try {
      const sse = lastEventSource()
      expect(sse.closed).toBe(false)
      r.unmount()
      expect(sse.closed).toBe(true)
    } finally {
      r.restore()
    }
  })

  test('Test 7: sheet opens when etmSheetOpen === true, header shows "ETM Live Tail"', async () => {
    const r = renderSheet()
    try {
      act(() => {
        useViewerStore.setState({ etmSheetOpen: true })
      })
      await waitFor(() => {
        expect(screen.getByText(/ETM Live Tail/i)).toBeTruthy()
      })
    } finally {
      r.restore()
    }
  })

  test('Test 8: LIVE indicator dot — emerald + pulse when connected; muted when not', async () => {
    const r = renderSheet()
    try {
      act(() => {
        useViewerStore.setState({ etmSheetOpen: true, etmStreamConnected: false })
      })
      await waitFor(() => screen.getByTestId('etm-live-indicator-dot'))
      let dot = screen.getByTestId('etm-live-indicator-dot')
      expect(dot.className).not.toMatch(/bg-emerald-500/)
      expect(dot.className).toMatch(/bg-muted-foreground/)
      expect(dot.className).not.toMatch(/animate-pulse/)

      act(() => {
        useViewerStore.setState({ etmStreamConnected: true })
      })
      await waitFor(() => {
        dot = screen.getByTestId('etm-live-indicator-dot')
        expect(dot.className).toMatch(/bg-emerald-500/)
        expect(dot.className).toMatch(/animate-pulse/)
      })
    } finally {
      r.restore()
    }
  })

  test('Test 9: body has aria-live="polite" aria-atomic="false"', async () => {
    const r = renderSheet()
    try {
      act(() => {
        useViewerStore.setState({ etmSheetOpen: true })
      })
      await waitFor(() => screen.getByTestId('etm-observations-body'))
      const body = screen.getByTestId('etm-observations-body')
      expect(body.getAttribute('aria-live')).toBe('polite')
      expect(body.getAttribute('aria-atomic')).toBe('false')
    } finally {
      r.restore()
    }
  })

  test('Test 10: row renders timestamp (tabular-nums) + agent tag + 1-line summary', async () => {
    useViewerStore.setState({
      etmObservations: [
        {
          id: 'obs-x',
          agent: 'claude',
          project: 'coding',
          content: 'short summary',
          artifacts: [],
          timestamp: '2026-06-10T10:00:00.000Z',
        },
      ],
      etmSheetOpen: true,
    })
    const r = renderSheet()
    try {
      await waitFor(() => screen.getByTestId('etm-row-obs-x'))
      const row = screen.getByTestId('etm-row-obs-x')
      const ts = row.querySelector('[data-testid="etm-row-obs-x-timestamp"]')
      expect(ts).toBeTruthy()
      expect(ts!.className).toMatch(/tabular-nums/)
      expect(row.querySelector('[data-testid="etm-row-obs-x-agent"]')).toBeTruthy()
      expect(row.querySelector('[data-testid="etm-row-obs-x-summary"]')).toBeTruthy()
    } finally {
      r.restore()
    }
  })

  test('Test 11: agent color map — claude=violet, copilot=blue, opencode=teal, mastra=amber', async () => {
    useViewerStore.setState({
      etmObservations: [
        { id: 'c', agent: 'claude', project: 'p', content: 'c1', artifacts: [], timestamp: '' },
        { id: 'p', agent: 'copilot', project: 'p', content: 'p1', artifacts: [], timestamp: '' },
        { id: 'o', agent: 'opencode', project: 'p', content: 'o1', artifacts: [], timestamp: '' },
        { id: 'm', agent: 'mastra', project: 'p', content: 'm1', artifacts: [], timestamp: '' },
      ],
      etmSheetOpen: true,
    })
    const r = renderSheet()
    try {
      await waitFor(() => screen.getByTestId('etm-row-c'))
      expect(screen.getByTestId('etm-row-c-agent').className).toMatch(/text-violet-500/)
      expect(screen.getByTestId('etm-row-p-agent').className).toMatch(/text-blue-500/)
      expect(screen.getByTestId('etm-row-o-agent').className).toMatch(/text-teal-500/)
      expect(screen.getByTestId('etm-row-m-agent').className).toMatch(/text-amber-500/)
    } finally {
      r.restore()
    }
  })

  test('Test 12: click row with referencedEntities[0] calls setSelectedNode', async () => {
    useViewerStore.setState({
      etmObservations: [
        {
          id: 'obs-ref',
          agent: 'claude',
          project: 'coding',
          content: 'click me',
          artifacts: [],
          timestamp: '2026-06-10T10:00:00.000Z',
          referencedEntities: ['entity-7'],
        },
      ],
      etmSheetOpen: true,
    })
    const r = renderSheet()
    try {
      await waitFor(() => screen.getByTestId('etm-row-obs-ref'))
      const row = screen.getByTestId('etm-row-obs-ref')
      act(() => {
        fireEvent.click(row)
      })
      expect(useViewerStore.getState().selectedNodeId).toBe('entity-7')
    } finally {
      r.restore()
    }
  })

  test('Test 13: burst debounce — 25 messages within 100ms batched into the store within 250ms', async () => {
    vi.useFakeTimers()
    const r = renderSheet()
    try {
      const sse = lastEventSource()
      act(() => {
        for (let i = 0; i < 25; i++) {
          sse.onmessage?.(
            new MessageEvent('message', {
              data: JSON.stringify({
                id: `obs-batch-${i}`,
                agent: 'claude',
                project: 'p',
                content: `msg ${i}`,
                artifacts: [],
                timestamp: '',
              }),
            }),
          )
        }
      })
      // Within the 250ms debounce window, the observations should still be
      // pending (not yet flushed) — but at least some may have arrived
      // depending on implementation. After 250ms tick, all should be present.
      act(() => {
        vi.advanceTimersByTime(260)
      })
      expect(useViewerStore.getState().etmObservations.length).toBe(25)
    } finally {
      r.restore()
      vi.useRealTimers()
    }
  })

  test('Test 14: keyboard `t` toggles etmSheetOpen', () => {
    const r = renderSheet()
    try {
      expect(useViewerStore.getState().etmSheetOpen).toBe(false)
      act(() => {
        fireEvent.keyDown(document, { key: 't' })
      })
      expect(useViewerStore.getState().etmSheetOpen).toBe(true)
      act(() => {
        fireEvent.keyDown(document, { key: 't' })
      })
      expect(useViewerStore.getState().etmSheetOpen).toBe(false)
    } finally {
      r.restore()
    }
  })

  test('Test 15: Logger discipline — no raw console.* in source', () => {
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/panels/coding/EtmTailSheet.tsx'),
      'utf8',
    )
    expect(src).not.toMatch(/console\.(log|warn|error|info|debug|trace)/)
  })

  test('Test 16: source-grep gates (≥5 of 5 tokens)', () => {
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/panels/coding/EtmTailSheet.tsx'),
      'utf8',
    )
    const tokens = [
      /EventSource/,
      /aria-live/,
      /bg-emerald-500/,
      /setEtmSheetOpen/,
      /pushObservation/,
    ]
    const hits = tokens.filter((t) => t.test(src)).length
    expect(hits).toBeGreaterThanOrEqual(5)
  })
})
