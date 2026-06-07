// PATTERN SOURCE: 45-05-PLAN.md Task 2 <behavior>
//   11 panel tests for RcaOpsPanel.
//
// We mock OkmRcaClient entirely so the panel never hits a real fetch /
// EventSource. The mocked subscribeProgress() exposes the latest cb so
// individual tests can drive SSE events synchronously.
//
// We also mock SYSTEM_ENDPOINTS so RcaOpsPanel reads a deterministic
// base URL inside the panel constructor.

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TooltipProvider } from '@/components/ui/tooltip'

import type { ApiClient } from '@/api/ApiClient'
import type { Pipeline, RcaDirGroups, PipelineEvent, IngestStartResponse } from '@/api/OkmRcaClient'

// ---------- Mock harness ------------------------------------------------
// One module-level mock object that the test mutates between runs. The
// vi.mock factory returns an OkmRcaClient class that proxies to this
// harness — so each test can swap in fresh listDirs / rcaIngest stubs
// and trigger SSE events via harness.emitProgress(...).

interface MockHarness {
  listDirs: ReturnType<typeof vi.fn<[], Promise<RcaDirGroups>>>
  getStatus: ReturnType<typeof vi.fn<[], Promise<unknown>>>
  rcaIngest: ReturnType<typeof vi.fn<[Pipeline, string, { force?: boolean }?], Promise<IngestStartResponse>>>
  /** Capture the cb passed to subscribeProgress so tests can emit events. */
  subscribeCb: ((event: PipelineEvent) => void) | null
  /** Mock EventSource close-counter — verifies cleanup discipline. */
  esCloseCount: number
}

const harness: MockHarness = {
  listDirs: vi.fn(),
  getStatus: vi.fn(),
  rcaIngest: vi.fn(),
  subscribeCb: null,
  esCloseCount: 0,
}

class MockEventSource {
  url: string
  closed = false
  constructor(url: string) {
    this.url = url
  }
  close(): void {
    if (!this.closed) {
      harness.esCloseCount += 1
      this.closed = true
    }
  }
}

vi.mock('@/api/OkmRcaClient', async () => {
  // We re-export the type definitions verbatim — the panel imports them.
  const actual = await vi.importActual<typeof import('@/api/OkmRcaClient')>('@/api/OkmRcaClient')
  class MockClient {
    constructor(_baseUrl: string) {}
    listDirs() {
      return harness.listDirs()
    }
    getStatus() {
      return harness.getStatus()
    }
    rcaIngest(pipeline: Pipeline, dirPath: string, opts?: { force?: boolean }) {
      return harness.rcaIngest(pipeline, dirPath, opts)
    }
    subscribeProgress(cb: (ev: PipelineEvent) => void) {
      harness.subscribeCb = cb
      return new MockEventSource('mock://progress') as unknown as EventSource
    }
  }
  return {
    ...actual,
    OkmRcaClient: MockClient,
  }
})

vi.mock('@/config/system-endpoints', async () => {
  const actual = await vi.importActual<typeof import('@/config/system-endpoints')>(
    '@/config/system-endpoints',
  )
  return {
    ...actual,
    SYSTEM_ENDPOINTS: {
      coding: 'http://test/coding',
      okb: 'http://test/okb',
      cap: 'http://test/cap',
    },
  }
})

import { RcaOpsPanel } from './RcaOpsPanel'

const EMPTY_DIRS: RcaDirGroups = { kpifw: [], raas: [], e2e: [] }

const POPULATED_DIRS: RcaDirGroups = {
  kpifw: [
    { path: '/data/kpifw/run-a', timestamp: '2026-06-07T01:00:00Z', findingCount: 5 },
    { path: '/data/kpifw/run-b', timestamp: '2026-06-07T02:00:00Z', findingCount: 7 },
  ],
  raas: [
    { path: '/data/raas/run-x', timestamp: '2026-06-07T03:00:00Z', findingCount: 2 },
  ],
  e2e: [],
}

function renderPanel() {
  const apiClient = { base: 'http://test.local' } as ApiClient
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={0}>
        <RcaOpsPanel apiClient={apiClient} system="cap" />
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

/** Drive an SSE event into the panel via the captured cb. */
function emit(event: PipelineEvent) {
  act(() => {
    if (harness.subscribeCb) {
      harness.subscribeCb(event)
    }
  })
}

describe('RcaOpsPanel (Plan 45-05 Task 2)', () => {
  beforeEach(() => {
    cleanup()
    harness.listDirs.mockReset()
    harness.getStatus.mockReset()
    harness.rcaIngest.mockReset()
    harness.subscribeCb = null
    harness.esCloseCount = 0
    // Default ingest response — tests that don't override get OK.
    harness.rcaIngest.mockResolvedValue({ success: true, runId: 'r1' })
    harness.getStatus.mockResolvedValue({ active: false })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // Panel Test 1 -----------------------------------------------------------
  test('Test 1: empty groups render the verbatim empty-state copy', async () => {
    harness.listDirs.mockResolvedValue(EMPTY_DIRS)
    renderPanel()
    expect(
      await screen.findByText('No RCA pipeline runs available.'),
    ).toBeInTheDocument()
  })

  // Panel Test 2 -----------------------------------------------------------
  test('Test 2: 2 kpifw + 1 raas + 0 e2e dirs render the expected row counts with Ingest buttons', async () => {
    harness.listDirs.mockResolvedValue(POPULATED_DIRS)
    renderPanel()
    // Wait for at least one row.
    await screen.findByTestId('rca-row-kpifw-0')

    const kpifwRows = screen.getAllByTestId(/^rca-row-kpifw-/)
    const raasRows = screen.getAllByTestId(/^rca-row-raas-/)
    const e2eRows = screen.queryAllByTestId(/^rca-row-e2e-/)
    expect(kpifwRows).toHaveLength(2)
    expect(raasRows).toHaveLength(1)
    expect(e2eRows).toHaveLength(0)

    // Each kpifw / raas row has an Ingest button.
    expect(screen.getAllByRole('button', { name: /^Ingest$/ })).toHaveLength(3)
  })

  // Panel Test 3 -----------------------------------------------------------
  test('Test 3: clicking Ingest calls rcaIngest exactly once and disables that button (T-45-05-05)', async () => {
    harness.listDirs.mockResolvedValue(POPULATED_DIRS)
    // Pause the ingest so we can observe the disabled state in the
    // interim (otherwise the resolve clears runningPipeline immediately).
    let resolveIngest: (v: IngestStartResponse) => void
    harness.rcaIngest.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveIngest = resolve
        }),
    )

    renderPanel()
    await screen.findByTestId('rca-row-kpifw-0')

    const firstIngest = screen.getAllByRole('button', { name: /^Ingest$/ })[0]
    fireEvent.click(firstIngest)

    expect(harness.rcaIngest).toHaveBeenCalledTimes(1)
    expect(harness.rcaIngest).toHaveBeenCalledWith('kpifw', '/data/kpifw/run-a', {
      force: false,
    })
    // Button itself disables (T-45-05-05 — no double-click race).
    expect(firstIngest).toBeDisabled()

    // Resolve to clean up — otherwise React warns about pending updates.
    await act(async () => {
      resolveIngest!({ success: true, runId: 'r1' })
    })
  })

  // Panel Test 4 -----------------------------------------------------------
  test('Test 4: while runningPipeline !== null, ALL Ingest buttons are disabled', async () => {
    harness.listDirs.mockResolvedValue(POPULATED_DIRS)
    let resolveIngest: (v: IngestStartResponse) => void
    harness.rcaIngest.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveIngest = resolve
        }),
    )

    renderPanel()
    await screen.findByTestId('rca-row-kpifw-0')

    const buttons = screen.getAllByRole('button', { name: /^Ingest$/ })
    fireEvent.click(buttons[0])

    // ALL Ingest buttons disabled while pipeline runs.
    for (const b of buttons) {
      expect(b).toBeDisabled()
    }

    await act(async () => {
      resolveIngest!({ success: true, runId: 'r1' })
    })
  })

  // Panel Test 5 -----------------------------------------------------------
  test('Test 5: SSE stage:"dedup" event marks Dedup active and Extract done', async () => {
    harness.listDirs.mockResolvedValue(POPULATED_DIRS)
    renderPanel()
    await screen.findByTestId('rca-row-kpifw-0')

    // Trigger an Ingest so a runningPipeline is set (otherwise stage events
    // are ignored — VOKB behaviour).
    fireEvent.click(screen.getAllByRole('button', { name: /^Ingest$/ })[0])

    emit({ type: 'stage', stage: 'dedup' })

    const dedupPill = screen.getByTestId('stage-pill-dedup')
    expect(dedupPill.className).toContain('bg-primary')
    expect(dedupPill.className).toContain('animate-pulse')

    const extractPill = screen.getByTestId('stage-pill-extract')
    expect(extractPill.className).toContain('bg-muted')
    expect(extractPill.className).not.toContain('animate-pulse')
  })

  // Panel Test 6 -----------------------------------------------------------
  test('Test 6: SSE progress:47 sets <Progress value={47}>', async () => {
    harness.listDirs.mockResolvedValue(POPULATED_DIRS)
    renderPanel()
    await screen.findByTestId('rca-row-kpifw-0')

    fireEvent.click(screen.getAllByRole('button', { name: /^Ingest$/ })[0])
    emit({ type: 'progress', progress: 47 })

    const progress = screen.getByTestId('rca-progress')
    // Radix Progress sets aria-valuenow when value is provided.
    expect(progress.getAttribute('aria-valuenow')).toBe('47')
  })

  // Panel Test 7 -----------------------------------------------------------
  test('Test 7: SSE "complete" clears runningPipeline + shows success Card (border-l-emerald-500)', async () => {
    harness.listDirs.mockResolvedValue(POPULATED_DIRS)
    renderPanel()
    await screen.findByTestId('rca-row-kpifw-0')

    fireEvent.click(screen.getAllByRole('button', { name: /^Ingest$/ })[0])
    emit({ type: 'complete', message: 'all done' })

    // Buttons re-enable.
    for (const b of screen.getAllByRole('button', { name: /^Ingest$/ })) {
      expect(b).not.toBeDisabled()
    }
    const completion = screen.getByTestId('rca-completion-card')
    expect(completion.className).toContain('border-l-emerald-500')
    expect(completion.textContent).toContain('all done')
  })

  // Panel Test 8 -----------------------------------------------------------
  test('Test 8: SSE "error" shows destructive Card (border-l-destructive)', async () => {
    harness.listDirs.mockResolvedValue(POPULATED_DIRS)
    renderPanel()
    await screen.findByTestId('rca-row-kpifw-0')

    fireEvent.click(screen.getAllByRole('button', { name: /^Ingest$/ })[0])
    emit({ type: 'error', message: 'boom' })

    const completion = screen.getByTestId('rca-completion-card')
    expect(completion.className).toContain('border-l-destructive')
    expect(completion.textContent).toContain('boom')
  })

  // Panel Test 9 -----------------------------------------------------------
  test('Test 9 (watchdog T-45-05-02): no SSE message for 120s → STALE error card auto-clears runningPipeline', async () => {
    vi.useFakeTimers()
    harness.listDirs.mockResolvedValue(POPULATED_DIRS)
    renderPanel()
    // findByTestId uses real timers internally — switch back briefly.
    vi.useRealTimers()
    await screen.findByTestId('rca-row-kpifw-0')
    vi.useFakeTimers()

    fireEvent.click(screen.getAllByRole('button', { name: /^Ingest$/ })[0])
    // Emit one event to seed lastEventAt to "now".
    emit({ type: 'stage', stage: 'extract' })

    // Advance 121s past the watchdog window. The watchdog effect ticks at
    // an internal interval (≤30s) and detects staleness once threshold passes.
    await act(async () => {
      vi.advanceTimersByTime(121_000)
    })

    const completion = screen.getByTestId('rca-completion-card')
    expect(completion.className).toContain('border-l-destructive')
    expect(completion.textContent?.toLowerCase()).toMatch(/stale|timed out|no progress/)

    // Ingest buttons re-enabled (runningPipeline cleared).
    for (const b of screen.getAllByRole('button', { name: /^Ingest$/ })) {
      expect(b).not.toBeDisabled()
    }
  })

  // Panel Test 10 ----------------------------------------------------------
  test('Test 10 (cleanup T-45-05-02): unmounting calls EventSource.close exactly once', async () => {
    harness.listDirs.mockResolvedValue(POPULATED_DIRS)
    const { unmount } = renderPanel()
    await screen.findByTestId('rca-row-kpifw-0')

    expect(harness.esCloseCount).toBe(0)
    unmount()
    expect(harness.esCloseCount).toBe(1)
  })

  // Panel Test 11 ----------------------------------------------------------
  test('Test 11: force-reingest checkbox toggles and propagates force:true to rcaIngest', async () => {
    harness.listDirs.mockResolvedValue(POPULATED_DIRS)
    renderPanel()
    await screen.findByTestId('rca-row-kpifw-0')

    const checkbox = screen.getByTestId('rca-force-checkbox')
    fireEvent.click(checkbox)
    // Radix Checkbox exposes state via data-state — checked after click.
    expect(checkbox.getAttribute('data-state')).toBe('checked')

    fireEvent.click(screen.getAllByRole('button', { name: /^Ingest$/ })[0])

    expect(harness.rcaIngest).toHaveBeenCalledTimes(1)
    expect(harness.rcaIngest).toHaveBeenCalledWith('kpifw', '/data/kpifw/run-a', {
      force: true,
    })
  })
})
