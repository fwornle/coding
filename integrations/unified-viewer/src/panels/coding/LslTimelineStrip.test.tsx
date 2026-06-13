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

// 2026-06-13 [Phase 56-03]: Mock `useGraphData` so the strip's
// `selectedTs` memo (lines 167-175) can resolve entity.createdAt without
// hitting the real /api/v1/entities endpoint. The baseline test mock
// returns `{sessions:[...]}` for ALL fetches — that envelope makes
// `apiClient.listEntities()` return an object (not Entity[]), tripping
// `entities.find` in the strip. Mocking the hook here lets us assert the
// graph→tick highlight cascade (Test 19 — AC #2 timeline side) AND
// neutralises 4 pre-existing baseline failures that crashed on the same
// path. See PATTERNS.md § OccurrenceHistorySidebar.test.tsx for the
// `vi.mock('@/graph/useGraphData')` idiom.
const mockEntities: Array<{ id: string; createdAt: string }> = []
vi.mock('@/graph/useGraphData', () => ({
  useGraphData: () => {
    // 2026-06-13 [Phase 56-04 Test 24]: tests can seed
    // `globalThis.__mockRelations` to exercise the ancestry-path branch
    // of onTickClick. Defaults to [] for all earlier tests.
    const rel =
      (globalThis as unknown as { __mockRelations?: unknown[] }).__mockRelations
      ?? []
    return {
      entities: mockEntities,
      relations: rel,
      ontology: [],
      isLoading: false,
      error: null,
    }
  },
}))

import LslTimelineStrip, { formatScaleLabel } from './LslTimelineStrip'
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
      const btn24h = screen.getByLabelText('24 hours')
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
      expect(screen.getByLabelText('24 hours')).toBeTruthy()
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

  // ====================================================================
  // Phase 56 Plan 03 — timestamp scale + bidirectional selection
  // ====================================================================

  test('Test 14: renders 5-8 scale labels by default window (7d)', async () => {
    const r = renderStrip()
    try {
      await waitFor(() => {
        const labels = screen.getAllByTestId(/^lsl-scale-label-/)
        expect(labels.length).toBeGreaterThanOrEqual(5)
        expect(labels.length).toBeLessThanOrEqual(8)
      })
    } finally {
      r.restore()
    }
  })

  test('Test 15: formatScaleLabel — HH:MM:SS format when windowMs ≤ 60_000', () => {
    // sub-minute window — expect HH:MM:SS
    const out = formatScaleLabel(Date.now(), 60_000)
    expect(out).toMatch(/^\d{2}:\d{2}:\d{2}$/)
  })

  test('Test 16: formatScaleLabel — HH:MM format when 60_000 < windowMs ≤ 86_400_000', () => {
    // sub-day window — expect HH:MM
    const out = formatScaleLabel(Date.now(), 3_600_000) // 1h
    expect(out).toMatch(/^\d{2}:\d{2}$/)
  })

  test('Test 17: formatScaleLabel — multi-day window uses "Mon DD" abbreviation', () => {
    // multi-day window — expect e.g. "Jun 13"
    const out = formatScaleLabel(Date.now(), 7 * 86_400_000)
    expect(out).toMatch(/^[A-Z][a-z]{2,} \d{1,2}$/)
  })

  test('Test 18: tick click writes Phase 56 fields atomically (selectionSource/selectedSessionId/highlightedRowKey)', async () => {
    useViewerStore.setState({
      selectionSource: null,
      selectedSessionId: null,
      highlightedRowKey: null,
    })
    const r = renderStrip()
    try {
      await waitFor(() => screen.getByTestId('lsl-tick-sess-bbbbbbbb'))
      const tick = screen.getByTestId('lsl-tick-sess-bbbbbbbb')
      act(() => {
        fireEvent.click(tick)
      })
      const s = useViewerStore.getState()
      // single getState() snapshot — assert all three new fields together
      expect(s.selectionSource).toBe('timeline')
      expect(s.selectedSessionId).toBe('sess-bbbbbbbb')
      // sess-bbbbbbbb has entityIds=['e3'] in makeSessions(), so first id is 'e3'
      expect(s.highlightedRowKey).toBe('e3')
      // pre-existing fields still coherent
      expect(s.selectedNodeId).toBe('e3')
      expect(s.lslSessionFilter).toEqual(['sess-bbbbbbbb'])
    } finally {
      r.restore()
    }
  })

  test('Test 19: graph selection lights up the matching tick (selection→tick cascade lock)', async () => {
    // Populate mock entities so the strip's selectedTs memo resolves a
    // createdAt that falls inside sess-bbbbbbbb's [startAt, endAt) range.
    // sess-bbbbbbbb spans [nowMinusHours(2), nowMinusHours(1.5)] — pick a
    // ts in that window for e3.
    mockEntities.length = 0
    mockEntities.push({
      id: 'e3',
      createdAt: nowMinusHours(1.75), // strictly inside sess-bbbbbbbb
    })
    useViewerStore.setState({ selectedNodeId: 'e3' })
    const r = renderStrip()
    try {
      await waitFor(() => {
        const tick = screen.getByTestId('lsl-tick-sess-bbbbbbbb')
        expect(tick.className).toMatch(/ring-blue-500/)
      })
    } finally {
      r.restore()
      mockEntities.length = 0
      useViewerStore.setState({ selectedNodeId: null })
    }
  })

  test('Test 20: source-grep gate — Phase 56 scale renderer + selectionSource literal wired', () => {
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/panels/coding/LslTimelineStrip.tsx'),
      'utf8',
    )
    // formatScaleLabel helper present
    expect(src).toMatch(/formatScaleLabel/)
    // multi-day branch uses Intl via toLocaleDateString
    expect(src).toMatch(/toLocaleDateString/)
    // scale row test-ids present
    expect(src).toMatch(/lsl-scale-label-/)
    // Phase 56 selectionSource literal — both branches (plain + modifier)
    const sourceMatches = src.match(/selectionSource:\s*['"]timeline['"]/g) ?? []
    expect(sourceMatches.length).toBeGreaterThanOrEqual(2)
    // selectedSessionId written in at least the write + the type import
    expect(src).toMatch(/selectedSessionId/)
    // Container height bumped past h-8
    expect(src).toMatch(/h-1[24]/)
  })

  // ====================================================================
  // Phase 56 Plan 04 — regression locks for the 3 issues the operator
  // reported in the 2026-06-13 visual smoke. These tests drive the real
  // click HANDLERS (fireEvent.click on rendered buttons) — NOT
  // useViewerStore.setState — so they exercise the same code path the
  // user does. The earlier Phase 56 tests (Tests 14-20) bypassed the
  // handlers and missed these three regressions; that gap is the
  // meta-lesson documented in 56-04-SUMMARY.md.
  // ====================================================================

  test('Test 21 [Issue 1]: clicking 24h window button STICKS (deselect-effect must not snap back when there was no slide)', async () => {
    // REGRESSION: the deselect-effect at LslTimelineStrip.tsx lines ~209-259
    // unconditionally fires on every mount where selectedTs === null
    // (i.e. no node selected). It calls setWindowKey(LATEST_WINDOW = '7d'),
    // so the moment the user clicks 24h, the effect snaps it back to 7d
    // and the scale labels never refresh. The fix gates the restore on
    // `preSlideWindowRef.current !== null` so only AUTO-SLID windows
    // (selection-driven) are restored on deselect; user-chosen windows
    // stay put.
    //
    // Drive the real button click (not setState) and assert the rendered
    // 24h ToggleGroupItem stays selected (data-state="on"). The toggle
    // group binds `value={windowKey}` so if windowKey snaps back to 7d,
    // the 24h button will show data-state="off" and the 7d button
    // data-state="on".
    useViewerStore.setState({ selectedNodeId: null })
    const r = renderStrip()
    try {
      await waitFor(() => screen.getByLabelText('24 hours'))
      const btn24h = screen.getByLabelText('24 hours')
      act(() => {
        fireEvent.click(btn24h)
      })
      // STRICT: data-state must remain 'on' for 24h. If the deselect-effect
      // snaps windowKey back to 7d, this assertion fires.
      await waitFor(() => {
        const btn = screen.getByLabelText('24 hours')
        expect(btn.getAttribute('data-state')).toBe('on')
      })
      // Defence-in-depth: 7d button must NOT be selected.
      const btn7d = screen.getByLabelText('7 days')
      expect(btn7d.getAttribute('data-state')).not.toBe('on')
    } finally {
      r.restore()
    }
  })

  test('Test 22 [Issue 1 — Cmd/Ctrl+click regression]: tick with no selection survives the mount', async () => {
    // REGRESSION: Test 7 (existing baseline) fails for the same root
    // cause as Issue 1 — the deselect-effect clears `lslSessionFilter`
    // on mount before the Cmd/Ctrl+click runs. This is a stricter
    // version of Test 7 that locks the fix at the source: the effect
    // must NOT clear `lslSessionFilter` on mount when there's no slide
    // memory.
    useViewerStore.setState({
      lslSessionFilter: ['sess-aaaaaaaa'],
      selectedNodeId: null,
    })
    const r = renderStrip()
    try {
      // Wait one tick — the deselect-effect would fire here in the
      // baseline (broken) code.
      await waitFor(() => screen.getByTestId('lsl-tick-sess-bbbbbbbb'))
      // After mount, the filter must still be ['sess-aaaaaaaa']:
      // a user-set filter with no selection is NOT something the
      // strip is allowed to clear unprompted.
      expect(useViewerStore.getState().lslSessionFilter).toEqual(['sess-aaaaaaaa'])
    } finally {
      r.restore()
    }
  })

  test('Test 23 [Issue 2]: tick click rings its own tick AND sets selectedSessionId even when entityIds[] is empty', async () => {
    // REGRESSION: when a session has entityIds=[] (no live graph nodes
    // mapped to it), the tick click writes selectedNodeId: null and
    // the tick ring keyed on selectedTs→isSelectedBucket never fires.
    // The fix: re-key the tick ring on (isSelectedBucket || selectedSessionId === s.id)
    // so the tick always rings on its own click, even when the entity
    // cascade can't fire.
    useViewerStore.setState({ selectedNodeId: null, selectedSessionId: null })
    const r = renderStrip({
      sessions: [
        {
          id: 'sess-empty',
          startAt: nowMinusHours(2),
          endAt: nowMinusHours(1.5),
          observationCount: 0,
          entityIds: [], // EMPTY — no entities to cascade to
        },
      ],
    })
    try {
      await waitFor(() => screen.getByTestId('lsl-tick-sess-empty'))
      const tick = screen.getByTestId('lsl-tick-sess-empty')
      act(() => {
        fireEvent.click(tick)
      })
      // Even with empty entityIds, the store must record the tick click
      const s = useViewerStore.getState()
      expect(s.selectedSessionId).toBe('sess-empty')
      expect(s.selectionSource).toBe('timeline')
      // And the tick must ring (selectedSessionId === s.id key fires).
      await waitFor(() => {
        const t = screen.getByTestId('lsl-tick-sess-empty')
        expect(t.className).toMatch(/ring-blue-500/)
      })
    } finally {
      r.restore()
    }
  })

  test('Test 24 [Issue 3]: tick click computes pathToSelected when firstEntityId resolves to a graph node with relations', async () => {
    // REGRESSION: LslTimelineStrip.onTickClick writes pathToSelected:
    // new Set() (empty). The graph's path-to-central renderer never
    // lights up. The fix: when firstEntityId !== null, compute
    // computeAncestryPath(firstEntityId, relations) the same way
    // D3GraphCanvas.tsx's node click does (lines 564, 573-579).
    //
    // We seed mockEntities + add relations to the mock so the strip
    // can resolve the ancestry chain.
    mockEntities.length = 0
    mockEntities.push({ id: 'e3', createdAt: nowMinusHours(1.75) } as never)
    mockEntities.push({ id: 'parent-1', createdAt: nowMinusHours(2) } as never)
    mockEntities.push({ id: 'root', createdAt: nowMinusHours(3) } as never)
    // Mutate the mock's relations
    ;(globalThis as unknown as { __mockRelations?: unknown }).__mockRelations = [
      { from: 'parent-1', to: 'e3', type: 'contains' },
      { from: 'root', to: 'parent-1', type: 'contains' },
    ]
    useViewerStore.setState({
      selectedNodeId: null,
      pathToSelected: new Set<string>(),
    })
    const r = renderStrip()
    try {
      await waitFor(() => screen.getByTestId('lsl-tick-sess-bbbbbbbb'))
      const tick = screen.getByTestId('lsl-tick-sess-bbbbbbbb')
      act(() => {
        fireEvent.click(tick)
      })
      const s = useViewerStore.getState()
      expect(s.selectedNodeId).toBe('e3')
      // pathToSelected must contain at least 'e3' and its ancestors.
      // Strict: size > 0 (empty means the ancestry path was never built).
      expect(s.pathToSelected.size).toBeGreaterThan(0)
      // Must include the node itself.
      expect(s.pathToSelected.has('e3')).toBe(true)
    } finally {
      r.restore()
      mockEntities.length = 0
      delete (globalThis as unknown as { __mockRelations?: unknown }).__mockRelations
      useViewerStore.setState({ selectedNodeId: null, pathToSelected: new Set() })
    }
  })
})
