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

// 2026-06-13 [Phase 56-04 round 4 — Tests T-F/T-G/T-H]: Mock the new
// `useVisibleEntityIds` hook so the strip's onTickClick handler can
// resolve a tick's entityIds to the closest graph-visible ancestor. The
// D3 graph filters Observations/Digests/Details out of the rendered set,
// but the timeline's bucket entityIds are usually Detail-level. The
// resolution helper walks bucket→ancestry→visible-set. Tests seed
// `globalThis.__mockVisibleIds` to a Set<string> capturing exactly which
// node ids the graph would render.
//
// DEFAULT (when `__mockVisibleIds` is unset): return an "everything is
// visible" Set-like proxy whose `.has()` always returns `true`. This
// preserves the happy-path semantics of every PRE-round-4 test in this
// file (Tests 18/19/24/26/28 — all assume the bucket's first entity is
// directly visible in the graph), without dragging fixture updates into
// 5+ unrelated tests. The round-4 tests (T-F/T-G/T-H) seed the global
// explicitly to a real Set, so they exercise the round-4 contract.
const ALL_VISIBLE: ReadonlySet<string> = {
  has: () => true,
  get size() { return Number.POSITIVE_INFINITY },
  keys: () => [].values(),
  values: () => [].values(),
  entries: () => [].values(),
  forEach: () => {},
  [Symbol.iterator]: () => [].values(),
} as unknown as ReadonlySet<string>

vi.mock('@/graph/useVisibleEntityIds', () => ({
  useVisibleEntityIds: () => {
    const ids =
      (globalThis as unknown as { __mockVisibleIds?: ReadonlySet<string> })
        .__mockVisibleIds
    return ids ?? ALL_VISIBLE
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
  // Phase 61 Plan 03: provenance discriminator (blue=batch, pink=online).
  source?: 'online' | 'batch'
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
  // 2026-06-13 (Phase 56.1 Plan 05): seed selectedClasses so the WR-03
  // race-window guard (onTickClick early-exit on selectedClasses.size === 0)
  // does not no-op every click in tests. The production code auto-seeds
  // this from the ontology fetch; tests that need the click handler to
  // actually fire must seed the class set explicitly. Tests that exercise
  // the WR-03 race exception explicitly clear it back to an empty Set.
  useViewerStore.setState({
    lslSessionFilter: [],
    selectedClasses: new Set<string>(['__test__']),
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

  test('Test 2: default window is 7d; fetches /api/coding/lsl/sessions?since=now-7d&limit=500', async () => {
    const r = renderStrip()
    try {
      await waitFor(() => {
        expect(r.fetchImpl).toHaveBeenCalled()
      })
      const url = (r.fetchImpl as unknown as { mock: { calls: [string][] } }).mock.calls[0][0]
      // Phase 61 Plan 03 (D-03): client cap raised 200 -> 500 (backend LSL_MAX_LIMIT).
      expect(url).toMatch(/\/api\/coding\/lsl\/sessions\?since=.+&limit=500/)
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

  test('Test 6 [amended 2026-06-14 — auto-drill]: click a tick whose pickAllResolvable returns size===1 writes Layer 2 (drill) payload — source=history, bucketKeys empty, focalBucketKey set via explicit focal override', async () => {
    // 2026-06-14 (Plan 06 gap-closure — auto-drill on single-resolution):
    // sess-bbbbbbbb has entityIds=['e3'] and ALL_VISIBLE mock returns true
    // for everything, so pickAllResolvable resolves to {e3} (size 1) →
    // the writer takes the auto-drill branch:
    //   - source: 'history' (NOT 'timeline' — matches BucketCardList drill)
    //   - bucketKeys: empty Set (drill semantics, no timeline halo)
    //   - focal.bucketKey explicit so focalBucketKey is set (focal-tick
    //     ring still renders via Locked Contract #1)
    //   - selectionHistory NOT pushed (Layer 0 → Layer 2 with no Layer 1
    //     to remember; Esc → Layer 0)
    // Locked LSL slice still updated since the strip is still the writer.
    useViewerStore.setState({ lslSessionFilter: ['stale'] })
    const r = renderStrip()
    try {
      await waitFor(() => screen.getByTestId('lsl-tick-sess-bbbbbbbb'))
      const tick = screen.getByTestId('lsl-tick-sess-bbbbbbbb')
      act(() => {
        fireEvent.click(tick)
      })
      const s = useViewerStore.getState()
      // Phase 56 LSL slice still updated.
      expect(s.lslSessionFilter).toEqual(['sess-bbbbbbbb'])
      // Auto-drill contract: source=history, bucketKeys empty.
      expect(s.selectionSource).toBe('history')
      expect(s.selectedBucketKeys).toBeInstanceOf(Set)
      expect(s.selectedBucketKeys.size).toBe(0)
      // focalBucketKey set via explicit focal.bucketKey override so the
      // focal-tick ring (Locked Contract #1) still renders.
      expect(s.focalBucketKey).not.toBeNull()
      expect(s.focalBucketKey?.startsWith('sess-bbbbbbbb|')).toBe(true)
      // selectedNodeIds = {e3} singleton, focal = e3.
      expect(s.selectedNodeIds).toBeInstanceOf(Set)
      expect(s.selectedNodeIds.size).toBe(1)
      expect(s.focalNodeId).toBe('e3')
      // Layer 0 → Layer 2 auto-drill: no history pushed (Esc → Layer 0).
      expect(s.selectionHistory).toBeNull()
    } finally {
      r.restore()
    }
  })

  test('Test 6b [2026-06-20 — operator feedback]: a tick whose SOLE resolution is a noise ancestor (LiveLoggingSystem) does NOT auto-drill — it writes the timeline payload so SidePanel renders the session card list, not the generic LLS detail', async () => {
    // Nearly every LSL session is made of Observation/Digest entities that are
    // graph-hidden, so resolveToVisibleAncestor collapses them all up to the
    // single visible ancestor LiveLoggingSystem. Pre-fix, `resolvedNodeIds ===
    // {LLS}` (size 1) took the auto-drill branch → opened the generic
    // LiveLoggingSystem EntityDetailPanel for almost every tick (useless).
    // Fix: when the sole resolution is a noise ancestor, fall through to the
    // Layer-1 timeline path (source='timeline', bucketKeys populated,
    // lslFilterEntityIds carries the raw session ids) so SidePanel.isMultiMode
    // routes to BucketCardList — the session's OWN entities.
    mockEntities.push({
      id: 'lls-noise',
      name: 'LiveLoggingSystem',
      createdAt: nowMinusHours(100),
    } as unknown as { id: string; createdAt: string })
    try {
      const r = renderStrip({
        sessions: [
          {
            id: 'sess-llsonly',
            startAt: nowMinusHours(2),
            endAt: nowMinusHours(1.5),
            observationCount: 4,
            entityIds: ['lls-noise'],
          },
        ],
      })
      try {
        await waitFor(() => screen.getByTestId('lsl-tick-sess-llsonly'))
        act(() => {
          fireEvent.click(screen.getByTestId('lsl-tick-sess-llsonly'))
        })
        const s = useViewerStore.getState()
        // NOT the auto-drill branch (that sets source='history' + empty
        // bucketKeys). Must be the timeline/card-list path.
        expect(s.selectionSource).toBe('timeline')
        expect(s.selectedBucketKeys.size).toBeGreaterThan(0)
        expect(s.lslSessionFilter).toEqual(['sess-llsonly'])
        // lslFilterEntityIds carries the raw session id so BucketCardList can
        // build the session's entity cards.
        expect(s.lslFilterEntityIds?.has('lls-noise')).toBe(true)
      } finally {
        r.restore()
      }
    } finally {
      const i = mockEntities.findIndex((e) => e.id === 'lls-noise')
      if (i >= 0) mockEntities.splice(i, 1)
    }
  })

  test('Test 7: Cmd/Ctrl+click UNIONs into lslSessionFilter AND extends selectedBucketKeys (Phase 56.1 additive multi-set)', async () => {
    useViewerStore.setState({ lslSessionFilter: ['sess-aaaaaaaa'] })
    const r = renderStrip()
    try {
      await waitFor(() => screen.getByTestId('lsl-tick-sess-bbbbbbbb'))
      const tick = screen.getByTestId('lsl-tick-sess-bbbbbbbb')
      act(() => {
        fireEvent.click(tick, { metaKey: true })
      })
      const s = useViewerStore.getState()
      // LSL slice union — Phase 56 additive behaviour preserved.
      expect(s.lslSessionFilter).toContain('sess-aaaaaaaa')
      expect(s.lslSessionFilter).toContain('sess-bbbbbbbb')
      // Phase 56.1 extension — bucketKey union as well (single bucket here
      // because the prior fixture only set lslSessionFilter, not bucketKeys).
      expect(s.selectedBucketKeys.size).toBeGreaterThanOrEqual(1)
      expect(s.focalBucketKey).not.toBeNull()
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

  test('Test 18 [amended 2026-06-14 — auto-drill]: tick click on single-resolution bucket writes Layer 2 payload (source=history, bucketKeys empty, focalBucketKey set explicitly, history not pushed)', async () => {
    // 2026-06-14 (Plan 06 gap-closure — auto-drill on single-resolution):
    // sess-bbbbbbbb has entityIds=['e3'] → ALL_VISIBLE mock makes
    // pickAllResolvable return {e3} (size 1) → writer takes auto-drill
    // branch. Layer 2 contract: source=history, bucketKeys empty,
    // selectionHistory unchanged (was already null).
    useViewerStore.setState({
      selectionSource: null,
      selectedBucketKeys: new Set<string>(),
      focalBucketKey: null,
      highlightedRowKey: null,
      selectedNodeIds: new Set<string>(),
      focalNodeId: null,
      selectionHistory: null,
      // selectedClasses seeded by global beforeEach (WR-03 race gate).
    })
    const r = renderStrip()
    try {
      await waitFor(() => screen.getByTestId('lsl-tick-sess-bbbbbbbb'))
      const tick = screen.getByTestId('lsl-tick-sess-bbbbbbbb')
      act(() => {
        fireEvent.click(tick)
      })
      const s = useViewerStore.getState()
      // Auto-drill Layer 2 contract.
      expect(s.selectionSource).toBe('history')
      expect(s.selectedBucketKeys.size).toBe(0)
      // focalBucketKey set via explicit focal.bucketKey override (Locked
      // Contract #1 — focal-tick ring renders from focalBucketKey, even
      // when selectedBucketKeys is empty in the drill state).
      expect(s.focalBucketKey).not.toBeNull()
      expect(s.focalBucketKey?.startsWith('sess-bbbbbbbb|')).toBe(true)
      // sess-bbbbbbbb has entityIds=['e3'] — ALL_VISIBLE proxy resolves it
      // so the halo + focal both get 'e3'.
      expect(s.highlightedRowKey).toBe('e3')
      expect(s.focalNodeId).toBe('e3')
      expect(s.selectedNodeIds.has('e3')).toBe(true)
      expect(s.lslSessionFilter).toEqual(['sess-bbbbbbbb'])
      // Auto-drill does NOT push history (Layer 0 → Layer 2 directly).
      expect(s.selectionHistory).toBeNull()
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
    // Phase 56.1: route through the multi-set imperative shim so focalNodeId
    // is set (the strip's selectedTs memo keys on focalNodeId now, not the
    // deleted Phase 56 selectedNodeId field).
    useViewerStore.getState().setSelectedNode('e3')
    const r = renderStrip()
    try {
      await waitFor(() => {
        const tick = screen.getByTestId('lsl-tick-sess-bbbbbbbb')
        expect(tick.className).toMatch(/ring-blue-500/)
      })
    } finally {
      r.restore()
      mockEntities.length = 0
      useViewerStore.getState().setSelectedNode(null)
    }
  })

  test('Test 20: source-grep gate — Phase 56.1 multi-set fields + WR-03 + Locked Contract #4 + Contract #7', () => {
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
    // Phase 56.1: timeline-source literal — written via `setSelection({ source: 'timeline' })`.
    // >=2 branches: plain + modifier (Cmd/Ctrl additive) + empty-tick.
    const sourceMatches = src.match(/source:\s*['"]timeline['"]/g) ?? []
    expect(sourceMatches.length).toBeGreaterThanOrEqual(2)
    // Phase 56.1 D-2 forward direction — pickAllResolvable IS called from
    // the strip's onTickClick (the only allowed exception per Contract #7).
    expect(src).toMatch(/pickAllResolvable/)
    // Phase 56.1 D-4 — store subscriptions for two-tier render.
    expect(src).toMatch(/selectedBucketKeys/)
    expect(src).toMatch(/focalBucketKey/)
    // Phase 56.1 WR-03 closure — gate on selectedClasses empty.
    expect(src).toMatch(/selectedClasses\.size\s*===\s*0/)
    // Phase 56.1 D-7 contract-4 / Locked Contract #4 — 0-obs grey-out
    // classes preserved verbatim in tick render block.
    expect(src).toMatch(/opacity-40[^']*pointer-events-none/)
    // Phase 56.1 Plan 05 extraction — useLslSessions import.
    expect(src).toMatch(/useLslSessions/)
    // Phase 56.1: the deleted Phase 56 single-selection fields must not
    // appear as STORE SUBSCRIPTIONS anywhere in this file. Allow the
    // strings as comment references (header migration notes) but not as
    // active `useViewerStore((s) => s.<field>)` reads. Use a negative gate
    // on the subscription pattern.
    expect(src).not.toMatch(/useViewerStore\(\(s\)\s*=>\s*s\.selectedSessionId/)
    expect(src).not.toMatch(/useViewerStore\(\(s\)\s*=>\s*s\.selectedSessionStartAt/)
    expect(src).not.toMatch(/useViewerStore\(\(s\)\s*=>\s*s\.selectedNodeId\b(?!s)/)
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
    // Phase 56.1: clear via the imperative shim (single-selection setter
    // wraps the multi-set fields). selectedNodeId field is gone.
    useViewerStore.getState().setSelectedNode(null)
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
    })
    useViewerStore.getState().setSelectedNode(null)
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

  test('Test 23 [Issue 2 — SUPERSEDED by audit §5.4 option B]: 0-obs ticks are NOT selectable (the previous "always ring on own click" contract is retracted)', async () => {
    // SPEC CHANGE: 2026-06-13 state-flow audit `b29bdb34c` §5.4 option B
    // locks the new policy: 0-obs ticks render greyed-out + pointer-events-
    // none AND are early-exited at the click handler. They still RENDER so
    // the operator sees "I had a session" but cannot be selected. The prior
    // contract — "tick always rings on its own click, even when the entity
    // cascade can't fire" — is retracted because that mode is exactly the
    // multi-tick leak Issue 2 surfaced through. Buckets with no
    // observations cannot be a meaningful selection target.
    //
    // This test now asserts the inverted contract: a 0-obs tick click is
    // a no-op AND the tick is visually greyed-out + aria-disabled.
    useViewerStore.setState({
      selectedBucketKeys: new Set<string>(),
      focalBucketKey: null,
      selectedNodeIds: new Set<string>(),
      focalNodeId: null,
      selectionSource: null,
    })
    const r = renderStrip({
      sessions: [
        {
          id: 'sess-empty',
          startAt: nowMinusHours(2),
          endAt: nowMinusHours(1.5),
          observationCount: 0,
          entityIds: [],
        },
      ],
    })
    try {
      await waitFor(() => screen.getByTestId('lsl-tick-sess-empty'))
      const tick = screen.getByTestId('lsl-tick-sess-empty')
      // Visual + ARIA gate (D-7 contract-4 / Locked Contract #4 preserved).
      expect(tick.className).toMatch(/opacity-40/)
      expect(tick.className).toMatch(/pointer-events-none/)
      expect(tick.getAttribute('aria-disabled')).toBe('true')
      // Click is a no-op — store stays at the pre-click snapshot.
      act(() => {
        fireEvent.click(tick)
      })
      const s = useViewerStore.getState()
      // Phase 56.1 multi-set: bucket-set + selectionSource stay empty/null.
      expect(s.selectedBucketKeys.size).toBe(0)
      expect(s.focalBucketKey).toBeNull()
      expect(s.selectionSource).toBeNull()
      // No ring on the tick.
      expect(tick.className).not.toMatch(/ring-blue-500/)
    } finally {
      r.restore()
    }
  })

  // ====================================================================
   // Phase 56 Plan 04 continuation 2 — regression locks for the 4 issues
   // the operator reported in the SECOND visual smoke (2026-06-13).
   //
   // Issue A: clicking a tick with empty entityIds triggered a spurious
   //          D3 re-render via `lslFilterEntityIds: new Set()` reference
   //          changes — annoying for the user. Fix: when ids[] is empty,
   //          do NOT touch `lslFilterEntityIds`/`selectedNodeId`/
   //          `pathToSelected`; only write the minimal session-scope
   //          fields the operator's "tick was clicked" intent requires.
   //
   // Issue B: ticks with non-empty entityIds set `selectedNodeId` but the
   //          graph node ring + ancestry trace didn't visibly fire because
   //          the spurious centering useEffect (now removed in Issue C
   //          fix) panned the SVG so the visual cascade was off-screen.
   //          Assert at the store level that the writes are correct;
   //          visual gate is in D3GraphCanvas.test.ts G7 + Playwright.
   //
   // Issue D: the tick ring fired on EVERY tranche of the same session id
   //          (the dedup composite key is `id|startAt`, but the previous
   //          fix's `isSelectedSession = selectedSessionId === s.id`
   //          predicate matched all tranches of the same session). Fix:
   //          track the clicked tick's `(id, startAt)` bucket via local
   //          component state so only THAT specific tick rings on direct
   //          click. The `isSelectedBucket` (timestamp range) predicate
   //          continues to handle the graph→timeline cascade.
   // ====================================================================

  test('Test 25 [Issue A — SUPERSEDED by audit §5.4 option B]: 0-obs tick is unclickable so pre-existing store fields are PRESERVED (the click handler early-exits before any write)', async () => {
    // SPEC CHANGE: 2026-06-13 state-flow audit `b29bdb34c` §5.4 option B —
    // 0-obs ticks render greyed-out + pointer-events-none + early-exit at
    // the handler. The contract is no longer "minimal selectedSessionId
    // write"; it's "no write at all". The pre-existing store fields stay
    // intact (the audit's intent — Issue A's reference-stability concern
    // is moot when nothing is written).
    //
    // For tick-clicks with NON-empty entityIds (the live case after the
    // audit), reference stability is guaranteed by Commit 4's deep-equal
    // guard on `setLslFilterEntityIds`.
    const preSeededPath = new Set<string>(['pre-seeded'])
    const preSeededLslIds = new Set<string>(['pre-seeded-1', 'pre-seeded-2'])
    useViewerStore.setState({
      pathToSelected: preSeededPath,
      lslFilterEntityIds: preSeededLslIds,
      selectedBucketKeys: new Set<string>(),
      focalBucketKey: null,
      selectionSource: null,
    })
    useViewerStore.getState().setSelectedNode('pre-existing-node')
    // setSelectedNode wipes pathToSelected via the multi-set semantics —
    // re-seed it AFTER the setSelectedNode call so the regression assertion
    // below (path preservation across the 0-obs no-op) is meaningful.
    useViewerStore.setState({
      pathToSelected: preSeededPath,
      lslFilterEntityIds: preSeededLslIds,
    })
    const r = renderStrip({
      sessions: [
        {
          id: 'sess-empty',
          startAt: nowMinusHours(2),
          endAt: nowMinusHours(1.5),
          observationCount: 0,
          entityIds: [],
        },
      ],
    })
    try {
      await waitFor(() => screen.getByTestId('lsl-tick-sess-empty'))
      const tick = screen.getByTestId('lsl-tick-sess-empty')
      act(() => {
        fireEvent.click(tick)
      })
      const s = useViewerStore.getState()
      // No write — bucket-set stays empty (early-exit).
      expect(s.selectedBucketKeys.size).toBe(0)
      expect(s.focalBucketKey).toBeNull()
      expect(s.selectionSource).toBeNull()
      // CRITICAL: pre-existing fields are PRESERVED — same reference.
      expect(s.focalNodeId).toBe('pre-existing-node')
      expect(s.pathToSelected).toBe(preSeededPath)
      expect(s.lslFilterEntityIds).toBe(preSeededLslIds)
    } finally {
      r.restore()
      useViewerStore.getState().setSelectedNode(null)
      useViewerStore.setState({
        pathToSelected: new Set(),
        lslFilterEntityIds: null,
        selectedBucketKeys: new Set<string>(),
        focalBucketKey: null,
        selectionSource: null,
      })
    }
  })

  test('Test 26 [Issue B]: tick click with non-empty entityIds writes focalNodeId as the bare entity id the graph expects', async () => {
    // The graph's d3Nodes are keyed off `e.id` directly (D3GraphCanvas.tsx
    // line 380) and applySelectionStyling filters on `.id === focalNodeId`
    // (Phase 56.1 D-4). The strip MUST write the BARE entity id (no prefix,
    // no envelope) so the graph's selection styling fires.
    useViewerStore.setState({
      selectedNodeIds: new Set<string>(),
      focalNodeId: null,
      pathToSelected: new Set(),
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
      // sess-bbbbbbbb.entityIds === ['e3'] — bare id, no prefix.
      expect(s.focalNodeId).toBe('e3')
      expect(s.selectedNodeIds.has('e3')).toBe(true)
      // highlightedRowKey must also be bare id — the HistorySidebar
      // matches on `data-history-id={entity.id}` directly.
      expect(s.highlightedRowKey).toBe('e3')
    } finally {
      r.restore()
      useViewerStore.getState().setSelectedNode(null)
      useViewerStore.setState({ pathToSelected: new Set() })
    }
  })

  test('Test 28 [Issue D]: clicking ONE tranche of a session leaves SIBLING tranches of the SAME session WITHOUT the ring-blue-500 class (single-bucket semantics)', async () => {
    // REGRESSION (operator second-smoke 2026-06-13): "you marked all
    // nodes in the timeline as selected (upon selecting one that actually
    // brings up text)". Root cause: the previous fix's predicate
    // `isSelectedSession = selectedSessionId === s.id` matched EVERY
    // tranche of the same session. In the live LSL data, a single
    // long-running session is sliced into many `LslSession` objects with
    // a shared `id` but distinct `startAt` values — so every tranche
    // of the clicked session rang blue.
    //
    // Fix: ring the clicked TRANCHE (identified by the composite `(id,
    // startAt)` key the React render uses) — not every tranche of the
    // same session id. The component tracks the clicked bucket via local
    // state.
    //
    // Test fixture: two tranches of the SAME session id `sess-multi`
    // (distinct `startAt` values so the dedup keeps both). Clicking
    // tranche-1 must NOT ring tranche-2.
    mockEntities.length = 0
    useViewerStore.setState({
      selectedNodeIds: new Set<string>(),
      focalNodeId: null,
      selectedBucketKeys: new Set<string>(),
      focalBucketKey: null,
    })
    const r = renderStrip({
      sessions: [
        {
          id: 'sess-multi',
          startAt: nowMinusHours(3),
          endAt: nowMinusHours(2.5),
          observationCount: 5,
          entityIds: [],
        },
        {
          id: 'sess-multi',
          startAt: nowMinusHours(1),
          endAt: nowMinusHours(0.5),
          observationCount: 3,
          entityIds: [],
        },
      ],
    })
    try {
      // Both tranches share `data-testid="lsl-tick-sess-multi"` — narrow
      // by the data-session-id attribute (also `sess-multi`) AND fetch
      // both via getAllByTestId.
      await waitFor(() => {
        const ticks = screen.getAllByTestId('lsl-tick-sess-multi')
        expect(ticks.length).toBe(2)
      })
      const ticks = screen.getAllByTestId('lsl-tick-sess-multi')
      const tranche1 = ticks[0]
      const tranche2 = ticks[1]
      // Click tranche 1
      act(() => {
        fireEvent.click(tranche1)
      })
      // Tranche 1 rings — direct click feedback.
      await waitFor(() => {
        const refreshed = screen.getAllByTestId('lsl-tick-sess-multi')
        expect(refreshed[0].className).toMatch(/ring-blue-500/)
      })
      // Tranche 2 MUST NOT ring (different bucket, even though same
      // session id). The OLD predicate would have lit BOTH.
      const refreshedAfter = screen.getAllByTestId('lsl-tick-sess-multi')
      expect(refreshedAfter[1].className).not.toMatch(/ring-blue-500/)
      // Defence-in-depth: cross-check via DOM order — only ONE node has
      // ring-blue-500 across the whole strip.
      const allRingedTicks = document.querySelectorAll(
        '[data-testid^="lsl-tick-"].ring-blue-500',
      )
      expect(allRingedTicks.length).toBe(1)
      // Same DOM element as tranche1.
      expect(allRingedTicks[0]).toBe(refreshedAfter[0])
      // Bonus reference check for Test 28b: clicking tranche 2 should
      // move the ring AWAY from tranche 1 (not keep both ringed).
      act(() => {
        fireEvent.click(refreshedAfter[1])
      })
      await waitFor(() => {
        const ticksNow = screen.getAllByTestId('lsl-tick-sess-multi')
        expect(ticksNow[1].className).toMatch(/ring-blue-500/)
        expect(ticksNow[0].className).not.toMatch(/ring-blue-500/)
      })
    } finally {
      r.restore()
      mockEntities.length = 0
      useViewerStore.getState().setSelectedNode(null)
      useViewerStore.setState({
        selectedBucketKeys: new Set<string>(),
        focalBucketKey: null,
      })
    }
  })

  // ====================================================================
  // Phase 56 Plan 04 continuation 3 — state-flow audit b29bdb34c regression
  // locks. These RED-first tests are the audit-prescribed gates that
  // identify the actual root causes of the operator's 3 round-3 issues.
  // Mapping (per resume_instructions):
  //   - T-A (Test 30): same-session two-tranche selection cleanliness (R1)
  //   - T-B (Test 31): clear cascade does not leak the ring one render (R1)
  //   - T-E (Test 32): 0-obs tick is greyed + pointer-events-none + unclickable
  //                    (audit §5.4 option B; risk R6)
  //
  // Note: T-C lives in viewer-store.test.ts (reference equality on
  // setLslFilterEntityIds — audit §4.4); T-D lives in D3GraphCanvas.test.ts
  // (source-grep gate G12+G13 for store-read of pathToSelected — §6.4/§6.6
  // — adapted from a viewport-stability runtime test because jsdom can't
  // host the d3 SVG layout).
  // ====================================================================

  test('Test 30 [audit §6.5 R1 — T-A]: click tranche A then tranche A\' of SAME session id — only A\' rings, A does not (composite bucket key)', async () => {
    // Two tranches of the SAME session id `sess-X` with distinct startAt.
    // Click tranche-1, then tranche-2: only tranche-2 must ring. The
    // local-state bug (deleted in Commit 3) caused a one-render flash where
    // BOTH rang because clickedTickKey cleared one render late. The
    // store-derived predicate fixes this — every render reads the same
    // composite key.
    mockEntities.length = 0
    useViewerStore.setState({
      selectedNodeIds: new Set<string>(),
      focalNodeId: null,
      selectedBucketKeys: new Set<string>(),
      focalBucketKey: null,
    })
    const r = renderStrip({
      sessions: [
        {
          id: 'sess-X',
          startAt: nowMinusHours(3),
          endAt: nowMinusHours(2.5),
          observationCount: 4,
          entityIds: [],
        },
        {
          id: 'sess-X',
          startAt: nowMinusHours(1),
          endAt: nowMinusHours(0.5),
          observationCount: 3,
          entityIds: [],
        },
      ],
    })
    try {
      await waitFor(() => {
        const ticks = screen.getAllByTestId('lsl-tick-sess-X')
        expect(ticks.length).toBe(2)
      })
      const ticks0 = screen.getAllByTestId('lsl-tick-sess-X')
      // Click tranche A (first)
      act(() => {
        fireEvent.click(ticks0[0])
      })
      await waitFor(() => {
        const ticksNow = screen.getAllByTestId('lsl-tick-sess-X')
        expect(ticksNow[0].className).toMatch(/ring-blue-500/)
      })
      // Click tranche A' (second)
      const ticks1 = screen.getAllByTestId('lsl-tick-sess-X')
      act(() => {
        fireEvent.click(ticks1[1])
      })
      // After: tranche A' rings; tranche A does NOT.
      await waitFor(() => {
        const ticksAfter = screen.getAllByTestId('lsl-tick-sess-X')
        expect(ticksAfter[1].className).toMatch(/ring-blue-500/)
        expect(ticksAfter[0].className).not.toMatch(/ring-blue-500/)
      })
      // Defence-in-depth: only ONE element across the whole strip rings.
      const allRinged = document.querySelectorAll(
        '[data-testid^="lsl-tick-"].ring-blue-500',
      )
      expect(allRinged.length).toBe(1)
    } finally {
      r.restore()
      useViewerStore.getState().setSelectedNode(null)
      useViewerStore.setState({
        selectedBucketKeys: new Set<string>(),
        focalBucketKey: null,
      })
    }
  })

  test('Test 31 [audit §6.5 R1 — T-B]: clearing the selection (Phase 56.1 multi-set cleared) leaves NO tick ringed in the immediate next render (no one-render leak)', async () => {
    // After clicking a tick, the store has selectedBucketKeys + focalBucketKey.
    // Then someone (a graph node click, or Esc) writes both back to empty/null.
    // The next render MUST show no ring on any tick — no one-render flash
    // from local state lagging the store.
    mockEntities.length = 0
    useViewerStore.setState({
      selectedNodeIds: new Set<string>(),
      focalNodeId: null,
      selectedBucketKeys: new Set<string>(),
      focalBucketKey: null,
    })
    const r = renderStrip()
    try {
      await waitFor(() => screen.getByTestId('lsl-tick-sess-bbbbbbbb'))
      const tickB = screen.getByTestId('lsl-tick-sess-bbbbbbbb')
      // Click tick to ring it (mockEntities is empty so entityIds=['e3']
      // resolves to selectedNodeId='e3' but nothing else cascades — that's
      // fine for this test).
      act(() => {
        fireEvent.click(tickB)
      })
      await waitFor(() => {
        expect(screen.getByTestId('lsl-tick-sess-bbbbbbbb').className).toMatch(/ring-blue-500/)
      })
      // Simulate clearSelection cascade — Phase 56.1 multi-set cleared atomically.
      act(() => {
        useViewerStore.setState({
          selectedBucketKeys: new Set<string>(),
          focalBucketKey: null,
          selectedNodeIds: new Set<string>(),
          focalNodeId: null,
        })
      })
      // IMMEDIATE NEXT RENDER (no waitFor): no tick rings.
      const allRinged = document.querySelectorAll(
        '[data-testid^="lsl-tick-"].ring-blue-500',
      )
      expect(allRinged.length).toBe(0)
    } finally {
      r.restore()
      useViewerStore.setState({
        selectedNodeIds: new Set<string>(),
        focalNodeId: null,
        selectedBucketKeys: new Set<string>(),
        focalBucketKey: null,
      })
    }
  })

  test('Test 32 [audit §5.4 option B R6 — T-E / D-7 contract-4]: 0-obs ticks render greyed-out (opacity-40 + pointer-events-none) and clicks are no-op', async () => {
    // 0-obs/0-entities ticks must still render (operator sees "I had a
    // session at X o'clock") but cannot be clicked. The strip renders
    // them with opacity-40 + pointer-events-none + aria-disabled.
    mockEntities.length = 0
    useViewerStore.setState({
      selectedNodeIds: new Set<string>(),
      focalNodeId: null,
      selectedBucketKeys: new Set<string>(),
      focalBucketKey: null,
      selectionSource: null,
      highlightedRowKey: null,
    })
    const r = renderStrip({
      sessions: [
        {
          id: 'sess-zero',
          startAt: nowMinusHours(2),
          endAt: nowMinusHours(1.5),
          observationCount: 0, // <-- key: 0-obs
          entityIds: [],
        },
      ],
    })
    try {
      await waitFor(() => screen.getByTestId('lsl-tick-sess-zero'))
      const tick = screen.getByTestId('lsl-tick-sess-zero')
      // Visual gate — both classes present
      expect(tick.className).toMatch(/opacity-40/)
      expect(tick.className).toMatch(/pointer-events-none/)
      // ARIA gate
      expect(tick.getAttribute('aria-disabled')).toBe('true')
      // Click MUST be a no-op — selectedSessionId stays null even after the
      // click is dispatched.
      act(() => {
        fireEvent.click(tick)
      })
      // Settle pending state changes.
      await waitFor(() => {
        // Use a microtask boundary; nothing should have changed.
        const s = useViewerStore.getState()
        expect(s.selectedBucketKeys.size).toBe(0)
        expect(s.focalBucketKey).toBeNull()
        expect(s.selectionSource).toBeNull()
      })
    } finally {
      r.restore()
      useViewerStore.setState({
        selectedNodeIds: new Set<string>(),
        focalNodeId: null,
        selectedBucketKeys: new Set<string>(),
        focalBucketKey: null,
      })
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
      selectedNodeIds: new Set<string>(),
      focalNodeId: null,
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
      // Phase 56.1: focal entity is 'e3' (bucket's first resolvable id).
      expect(s.focalNodeId).toBe('e3')
      expect(s.selectedNodeIds.has('e3')).toBe(true)
      // pathToSelected must contain at least 'e3' and its ancestors.
      expect(s.pathToSelected.size).toBeGreaterThan(0)
      expect(s.pathToSelected.has('e3')).toBe(true)
    } finally {
      r.restore()
      mockEntities.length = 0
      delete (globalThis as unknown as { __mockRelations?: unknown }).__mockRelations
      useViewerStore.getState().setSelectedNode(null)
      useViewerStore.setState({ pathToSelected: new Set() })
    }
  })

  // ====================================================================
  // Phase 56 Plan 04 continuation 4 — phantom-id resolution (round 4).
  //
  // Operator's 4th smoke (post state-flow audit refactor) surfaced a
  // scope-level mismatch: the D3 graph deliberately filters Observations/
  // Digests/Details out of the rendered set, but `LslTimelineStrip.
  // onTickClick` writes `bucket.entities[0].id` to `selectedNodeId`
  // unconditionally. When that id is not a rendered D3 node:
  //   - applySelectionStyling finds no `.node` → no red ring
  //   - pathToSelected resolves to a higher ancestor → those nodes
  //     stay visible but disagree with the sidebar text
  //   - the trace LINE between phantom-Intent and its visible ancestor
  //     can't render because phantom-Intent isn't a D3 node
  //
  // Operator decision (locked): resolve to the closest graph-visible
  // ancestor in onTickClick. The bucket's entities[] is walked, and each
  // entity's ancestry is walked, until a graph-visible entity is found.
  // That ancestor's id becomes `selectedNodeId`. Sidebar shows the
  // ancestor's text. Bucket's raw entities still feed `lslFilterEntityIds`
  // for the LSL fade.
  //
  // Tests T-F/T-G/T-H lock the contract: phantom-id ticks never write a
  // non-graph-visible `selectedNodeId`. The new `useVisibleEntityIds`
  // hook is mocked at module scope (line ~50); each test seeds
  // `globalThis.__mockVisibleIds` to control which ids the graph would
  // render.
  // ====================================================================

  test('Test 33 [T-F — phantom-id resolves to closest visible ancestor]: tick whose entities[0] is a Detail with a Component ancestor IN the visible set writes the component id (NOT the Detail id)', async () => {
    // Fixture:
    //   - bucket.entityIds === ['detail-1']
    //   - ancestry chain: detail-1 ← component-1 ← root-1
    //   - graph visible set: { component-1, root-1 } — Detail filtered out
    //
    // Expected post-click:
    //   selectedNodeId === 'component-1'         (NOT 'detail-1')
    //   selectedSessionStartAt === s.startAt
    //   pathToSelected contains: detail-1 + component-1 + root-1
    //                             (raw entity kept for cross-pane provenance,
    //                              plus the resolved chain for trace render)
    mockEntities.length = 0
    mockEntities.push({ id: 'detail-1', createdAt: nowMinusHours(1.75) } as never)
    ;(globalThis as unknown as { __mockRelations?: unknown }).__mockRelations = [
      { from: 'component-1', to: 'detail-1', type: 'contains' },
      { from: 'root-1', to: 'component-1', type: 'contains' },
    ]
    // Visible set EXCLUDES the Detail (the bug scenario)
    ;(globalThis as unknown as { __mockVisibleIds?: ReadonlySet<string> }).__mockVisibleIds =
      new Set<string>(['component-1', 'root-1'])
    useViewerStore.setState({
      selectedNodeIds: new Set<string>(),
      focalNodeId: null,
      pathToSelected: new Set<string>(),
      selectedBucketKeys: new Set<string>(),
      focalBucketKey: null,
    })
    // Capture session startAt once so test assertion compares the exact
    // same ISO string (nowMinusHours uses Date.now() — distinct calls
    // produce ISOs that differ by a few ms, breaking strict toBe).
    const sessionStartAt = nowMinusHours(2)
    const r = renderStrip({
      sessions: [
        {
          id: 'sess-phantom',
          startAt: sessionStartAt,
          endAt: nowMinusHours(1.5),
          observationCount: 5,
          entityIds: ['detail-1'],
        },
      ],
    })
    try {
      await waitFor(() => screen.getByTestId('lsl-tick-sess-phantom'))
      const tick = screen.getByTestId('lsl-tick-sess-phantom')
      act(() => {
        fireEvent.click(tick)
      })
      const s = useViewerStore.getState()
      // The fix: focal is the resolved ancestor, NOT the phantom Detail.
      expect(s.focalNodeId).toBe('component-1')
      expect(s.selectedNodeIds.has('component-1')).toBe(true)
      // Phase 56.1: bucketKey composite encodes the bucket's startAt.
      expect(s.focalBucketKey).toBe(`sess-phantom|${sessionStartAt}`)
      // pathToSelected includes the resolved ancestor + its parent.
      expect(s.pathToSelected.has('component-1')).toBe(true)
      expect(s.pathToSelected.has('root-1')).toBe(true)
      // Bucket's raw entities still feed the LSL fade.
      expect(s.lslFilterEntityIds?.has('detail-1')).toBe(true)
    } finally {
      r.restore()
      mockEntities.length = 0
      delete (globalThis as unknown as { __mockRelations?: unknown }).__mockRelations
      delete (globalThis as unknown as { __mockVisibleIds?: unknown }).__mockVisibleIds
      useViewerStore.getState().setSelectedNode(null)
      useViewerStore.setState({
        pathToSelected: new Set(),
        selectedBucketKeys: new Set<string>(),
        focalBucketKey: null,
        lslFilterEntityIds: null,
      })
    }
  })

  test('Test 34 [T-G — no visible ancestor → sidebar-only mode]: tick whose entities have NO graph-visible ancestor writes focalNodeId=null but still cascades bucket + LSL fade', async () => {
    // Fixture:
    //   - bucket.entityIds === ['orphan-detail']
    //   - ancestry chain: orphan-detail has no edges
    //   - graph visible set: { unrelated-1, unrelated-2 } — nothing in the
    //     bucket's ancestry is visible
    //
    // Expected post-click:
    //   selectedNodeId === null                     (sidebar-only mode)
    //   selectedSessionId === s.id                  (LSL bucket still selected)
    //   selectedSessionStartAt === s.startAt
    //   lslFilterEntityIds has 'orphan-detail'      (fade still works)
    //   pathToSelected === Set()                    (no trace to render)
    mockEntities.length = 0
    mockEntities.push({ id: 'orphan-detail', createdAt: nowMinusHours(1.75) } as never)
    // Relations EXCLUDE the orphan — no ancestry to resolve.
    ;(globalThis as unknown as { __mockRelations?: unknown }).__mockRelations = [
      { from: 'unrelated-1', to: 'unrelated-2', type: 'contains' },
    ]
    // Visible set has unrelated nodes but nothing in bucket's tree.
    ;(globalThis as unknown as { __mockVisibleIds?: ReadonlySet<string> }).__mockVisibleIds =
      new Set<string>(['unrelated-1', 'unrelated-2'])
    useViewerStore.setState({
      selectedNodeIds: new Set<string>(),
      focalNodeId: null,
      pathToSelected: new Set<string>(),
      selectedBucketKeys: new Set<string>(),
      focalBucketKey: null,
      lslFilterEntityIds: null,
    })
    const sessionStartAt = nowMinusHours(2)
    const r = renderStrip({
      sessions: [
        {
          id: 'sess-orphan',
          startAt: sessionStartAt,
          endAt: nowMinusHours(1.5),
          observationCount: 1,
          entityIds: ['orphan-detail'],
        },
      ],
    })
    try {
      await waitFor(() => screen.getByTestId('lsl-tick-sess-orphan'))
      const tick = screen.getByTestId('lsl-tick-sess-orphan')
      act(() => {
        fireEvent.click(tick)
      })
      const s = useViewerStore.getState()
      // Sidebar-only mode: no graph selection.
      expect(s.focalNodeId).toBeNull()
      expect(s.selectedNodeIds.size).toBe(0)
      // Bucket key is still selected so the timeline tick rings.
      expect(s.focalBucketKey).toBe(`sess-orphan|${sessionStartAt}`)
      expect(s.selectedBucketKeys.has(`sess-orphan|${sessionStartAt}`)).toBe(true)
      // LSL fade still works — bucket's raw entities populate the filter.
      expect(s.lslFilterEntityIds?.has('orphan-detail')).toBe(true)
      // No trace to render.
      expect(s.pathToSelected.size).toBe(0)
    } finally {
      r.restore()
      mockEntities.length = 0
      delete (globalThis as unknown as { __mockRelations?: unknown }).__mockRelations
      delete (globalThis as unknown as { __mockVisibleIds?: unknown }).__mockVisibleIds
      useViewerStore.getState().setSelectedNode(null)
      useViewerStore.setState({
        pathToSelected: new Set(),
        selectedBucketKeys: new Set<string>(),
        focalBucketKey: null,
        lslFilterEntityIds: null,
      })
    }
  })

  test('Test 35 [T-H — visible entity passes through unchanged]: tick whose entities[0] IS already in the visible set writes that exact id (regression lock for happy path)', async () => {
    // Fixture:
    //   - bucket.entityIds === ['component-2']
    //   - ancestry chain: component-2 ← root-2
    //   - graph visible set: { component-2, root-2 } — component-2 IS rendered
    //
    // Expected post-click:
    //   selectedNodeId === 'component-2'           (no change vs pre-fix)
    //   selectedSessionStartAt === s.startAt
    //   pathToSelected contains: component-2 + root-2
    //                             (full cascade fires unchanged)
    mockEntities.length = 0
    mockEntities.push({ id: 'component-2', createdAt: nowMinusHours(1.75) } as never)
    ;(globalThis as unknown as { __mockRelations?: unknown }).__mockRelations = [
      { from: 'root-2', to: 'component-2', type: 'contains' },
    ]
    ;(globalThis as unknown as { __mockVisibleIds?: ReadonlySet<string> }).__mockVisibleIds =
      new Set<string>(['component-2', 'root-2'])
    useViewerStore.setState({
      selectedNodeIds: new Set<string>(),
      focalNodeId: null,
      pathToSelected: new Set<string>(),
      selectedBucketKeys: new Set<string>(),
      focalBucketKey: null,
    })
    const sessionStartAt = nowMinusHours(2)
    const r = renderStrip({
      sessions: [
        {
          id: 'sess-happy',
          startAt: sessionStartAt,
          endAt: nowMinusHours(1.5),
          observationCount: 3,
          entityIds: ['component-2'],
        },
      ],
    })
    try {
      await waitFor(() => screen.getByTestId('lsl-tick-sess-happy'))
      const tick = screen.getByTestId('lsl-tick-sess-happy')
      act(() => {
        fireEvent.click(tick)
      })
      const s = useViewerStore.getState()
      // Identity: the bucket's first entity IS visible → write it as-is.
      expect(s.focalNodeId).toBe('component-2')
      expect(s.selectedNodeIds.has('component-2')).toBe(true)
      expect(s.focalBucketKey).toBe(`sess-happy|${sessionStartAt}`)
      // Trace includes the visible ancestry.
      expect(s.pathToSelected.has('component-2')).toBe(true)
      expect(s.pathToSelected.has('root-2')).toBe(true)
    } finally {
      r.restore()
      mockEntities.length = 0
      delete (globalThis as unknown as { __mockRelations?: unknown }).__mockRelations
      delete (globalThis as unknown as { __mockVisibleIds?: unknown }).__mockVisibleIds
      useViewerStore.getState().setSelectedNode(null)
      useViewerStore.setState({
        pathToSelected: new Set(),
        selectedBucketKeys: new Set<string>(),
        focalBucketKey: null,
        lslFilterEntityIds: null,
      })
    }
  })

  test('Test 36 [Phase 56.1 acceptance grep]: LslTimelineStrip.tsx calls pickAllResolvable + pickFirstResolvable from onTickClick', () => {
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/panels/coding/LslTimelineStrip.tsx'),
      'utf8',
    )
    // The phantom-id fix routes the bucket's entityIds through the shared
    // helper before any setSelection write. Source-grep gate locks the
    // wiring at the file level even if a future refactor moves the call.
    expect(src).toMatch(/pickFirstResolvable/)
    // Phase 56.1 D-2 forward direction — the strip's onTickClick computes
    // the FULL halo via pickAllResolvable. Contract #7 lets the strip be
    // the ONLY non-pre-index callsite of this function.
    expect(src).toMatch(/pickAllResolvable/)
    // The helper module is the canonical home; the file imports it from
    // @/graph/ancestry (audit §6.4 extraction site).
    expect(src).toMatch(/from\s+['"]@\/graph\/ancestry['"]/)
  })

  test('Test 37 [Plan 06 gap-closure — Bug 1 regression]: tick click writes lslFilterEntityIds containing BOTH the raw bucket entityIds AND the resolved halo ancestors (so the visibility predicate keeps halo nodes mounted)', async () => {
    // 2026-06-14 (Plan 06 gap-closure — Bug 1 fix regression gate):
    //
    // Operator visual smoke caught a regression where `onTickClick` wrote
    // `lslFilterEntityIds: new Set<string>(ids)` (raw bucket entityIds
    // only, typically all Observation/Digest entityType). The visibility
    // predicate (visibility-predicate.ts:113-117) then culled every
    // non-structural halo ancestor (Insights, SubComponents, Details)
    // because they were neither structural nor in the filter set →
    // halo nodes disappeared from `visibleEntities` → D3 never mounted
    // .node elements for them → applySelectionStyling's
    // `selectedNodeIds.has(d.id)` branch ran against DOM that no longer
    // contained any halo node → no halo rings rendered.
    //
    // Operator observation: only the focal Component (LiveLoggingSystem)
    // + 1 path edge to Project (Coding) rendered; every Insight /
    // SubComponent / Detail halo node was missing.
    //
    // Fix: union resolvedNodeIds INTO lslFilterEntityIds on BOTH the
    // plain-click branch AND the Cmd/Ctrl additive branch so the halo
    // ancestors stay visible alongside the structural backbone.
    //
    // This unit test re-uses the Test 33 fixture (Detail bucket entity
    // resolving via `contains` to component-1) and asserts BOTH
    // 'detail-1' (raw) AND 'component-1' (resolved ancestor) are in
    // lslFilterEntityIds post-click. Pre-fix: only 'detail-1' would be
    // present. Post-fix: both.
    mockEntities.length = 0
    mockEntities.push({ id: 'detail-1', createdAt: nowMinusHours(1.75) } as never)
    ;(globalThis as unknown as { __mockRelations?: unknown }).__mockRelations = [
      { from: 'component-1', to: 'detail-1', type: 'contains' },
      { from: 'root-1', to: 'component-1', type: 'contains' },
    ]
    ;(globalThis as unknown as { __mockVisibleIds?: ReadonlySet<string> }).__mockVisibleIds =
      new Set<string>(['component-1', 'root-1'])
    useViewerStore.setState({
      selectedNodeIds: new Set<string>(),
      focalNodeId: null,
      pathToSelected: new Set<string>(),
      selectedBucketKeys: new Set<string>(),
      focalBucketKey: null,
      lslFilterEntityIds: null,
    })
    const sessionStartAt = nowMinusHours(2)
    const r = renderStrip({
      sessions: [
        {
          id: 'sess-bug1',
          startAt: sessionStartAt,
          endAt: nowMinusHours(1.5),
          observationCount: 5,
          entityIds: ['detail-1'],
        },
      ],
    })
    try {
      await waitFor(() => screen.getByTestId('lsl-tick-sess-bug1'))
      const tick = screen.getByTestId('lsl-tick-sess-bug1')
      act(() => {
        fireEvent.click(tick)
      })
      const s = useViewerStore.getState()
      // Pre-fix assertion (preserved — phantom-id resolution still works):
      expect(s.focalNodeId).toBe('component-1')
      expect(s.selectedNodeIds.has('component-1')).toBe(true)
      expect(s.lslFilterEntityIds?.has('detail-1')).toBe(true)
      // Post-fix assertion (Plan 06 gap-closure — Bug 1):
      // the RESOLVED ancestor must also be in the filter so the
      // visibility predicate keeps the halo node mounted in D3.
      expect(
        s.lslFilterEntityIds?.has('component-1'),
        'lslFilterEntityIds must include the resolved halo ancestor (component-1) — otherwise the visibility predicate culls the halo node from the D3 graph and the halo ring never renders (Plan 06 gap-closure Bug 1 regression).',
      ).toBe(true)
      // Strict size check: filter must contain raw (detail-1) + resolved (component-1) = 2.
      // Plus: root-1 is NOT in the union (it's in pathToSelected but not in
      // selectedNodeIds / lslFilterEntityIds — the trace render uses it
      // separately).
      expect(s.lslFilterEntityIds?.size).toBe(2)
    } finally {
      r.restore()
      mockEntities.length = 0
      delete (globalThis as unknown as { __mockRelations?: unknown }).__mockRelations
      delete (globalThis as unknown as { __mockVisibleIds?: unknown }).__mockVisibleIds
      useViewerStore.getState().setSelectedNode(null)
      useViewerStore.setState({
        pathToSelected: new Set(),
        selectedBucketKeys: new Set<string>(),
        focalBucketKey: null,
        lslFilterEntityIds: null,
      })
    }
  })

  // ====================================================================
  // Phase 56.1 Plan 05 — NEW tests for the WR-03 race-window closure +
  // two-tier bucket render (focal + halo).
  // ====================================================================

  test('Test WR-03: tick click no-ops when selectedClasses is empty (race-window close)', async () => {
    // The strip's onTickClick early-exits with a Logger.warn when the
    // ontology class set hasn't been seeded yet (1-render race after data
    // load). Without the gate, a click during that window enters
    // sidebar-only mode with an empty class filter — wrong contract.
    useViewerStore.setState({
      selectedClasses: new Set<string>(), // EMPTY — overrides global beforeEach.
      selectedNodeIds: new Set<string>(),
      focalNodeId: null,
      selectedBucketKeys: new Set<string>(),
      focalBucketKey: null,
    })
    const r = renderStrip()
    try {
      await waitFor(() => screen.getByTestId('lsl-tick-sess-bbbbbbbb'))
      const tick = screen.getByTestId('lsl-tick-sess-bbbbbbbb')
      act(() => {
        fireEvent.click(tick)
      })
      const s = useViewerStore.getState()
      // No mutation — bucket-set + node-set stayed empty.
      expect(s.selectedNodeIds.size).toBe(0)
      expect(s.selectedBucketKeys.size).toBe(0)
      expect(s.focalNodeId).toBeNull()
      expect(s.focalBucketKey).toBeNull()
    } finally {
      r.restore()
    }
  })

  test('Test 56.1-T1: focal bucket renders with ring-blue-500', async () => {
    // Set the multi-set so the rendered tick for sess-bbbbbbbb is the
    // focal — predicate `focalBucketKey === tickKey`. Use a deferred
    // setState so the strip renders AFTER the sessions arrive and we know
    // the real startAt of the rendered tick. We then read it from the
    // DOM and seed the store before reading the className.
    const r = renderStrip()
    try {
      await waitFor(() => screen.getByTestId('lsl-tick-sess-bbbbbbbb'))
      // Find the actual startAt by reading the strip's rendered tick. The
      // makeSessions() fixture re-computes `nowMinusHours(2)` each call;
      // we capture the bucket key by parsing the DOM's data attrs.
      // Simpler: click the tick to populate focalBucketKey, then assert
      // the style. (This exercises the write→render flow end-to-end.)
      const tick = screen.getByTestId('lsl-tick-sess-bbbbbbbb')
      act(() => {
        fireEvent.click(tick)
      })
      await waitFor(() => {
        const refreshed = screen.getByTestId('lsl-tick-sess-bbbbbbbb')
        expect(refreshed.className).toMatch(/ring-blue-500/)
      })
    } finally {
      r.restore()
      useViewerStore.setState({
        selectedNodeIds: new Set<string>(),
        focalNodeId: null,
        selectedBucketKeys: new Set<string>(),
        focalBucketKey: null,
      })
    }
  })

  test('Test 56.1-T2: halo bucket (in selectedBucketKeys, not focal) renders with ring-blue-300/60 + bg-blue-200/40', async () => {
    // Render two ticks of the same session id with distinct startAts.
    // Click one (focal); seed the OTHER's bucket key into selectedBucketKeys
    // without setting it as focal; assert it gets the halo classes.
    mockEntities.length = 0
    useViewerStore.setState({
      selectedNodeIds: new Set<string>(),
      focalNodeId: null,
      selectedBucketKeys: new Set<string>(),
      focalBucketKey: null,
    })
    const tickAStartAt = nowMinusHours(3)
    const tickBStartAt = nowMinusHours(1)
    const r = renderStrip({
      sessions: [
        {
          id: 'sess-halo',
          startAt: tickAStartAt,
          endAt: nowMinusHours(2.5),
          observationCount: 4,
          entityIds: [],
        },
        {
          id: 'sess-halo',
          startAt: tickBStartAt,
          endAt: nowMinusHours(0.5),
          observationCount: 3,
          entityIds: [],
        },
      ],
    })
    try {
      await waitFor(() => {
        expect(screen.getAllByTestId('lsl-tick-sess-halo').length).toBe(2)
      })
      // Manually inject the store snapshot — focal on tick A, halo includes
      // tick B (so tick B is in the set but NOT focal).
      const tickAKey = `sess-halo|${tickAStartAt}`
      const tickBKey = `sess-halo|${tickBStartAt}`
      act(() => {
        useViewerStore.setState({
          selectedBucketKeys: new Set<string>([tickAKey, tickBKey]),
          focalBucketKey: tickAKey,
        })
      })
      await waitFor(() => {
        const ticks = screen.getAllByTestId('lsl-tick-sess-halo')
        // The two render order depends on sort by startAt — tickA (3h ago)
        // is OLDER, so it renders first in the sorted array (left in time).
        const tickAEl = ticks[0]
        const tickBEl = ticks[1]
        expect(tickAEl.className).toMatch(/ring-blue-500/)
        expect(tickBEl.className).toMatch(/ring-blue-300\/60/)
        expect(tickBEl.className).toMatch(/bg-blue-200\/40/)
      })
    } finally {
      r.restore()
      useViewerStore.setState({
        selectedBucketKeys: new Set<string>(),
        focalBucketKey: null,
      })
    }
  })

  // Plan 06 gap-closure (2026-06-14) — timeline scale-selector regression.
  // Operator visual smoke surfaced two coupled symptoms after Decision C
  // (f3c0de774) auto-drill collapsed the focal to LiveLoggingSystem (LLS):
  //   1. Clicking a recent tick auto-snapped the window selector to 'all'
  //      because LLS's createdAt is days/weeks old → ageMs > WINDOW_MS[7d]
  //      → auto-slide jumps to 'all'.
  //   2. After the auto-snap, clicking 24h / 7d / 30d had no effect because
  //      the auto-slide useEffect dep list includes windowKey: each manual
  //      setWindowKey re-fired the effect, which re-ran the same ageMs
  //      check against the still-old selectedTs and re-applied 'all'.
  // Root cause: a single effect (LslTimelineStrip.tsx ~line 296-346) where
  // the selection-active branch fired on every windowKey change, not only
  // on selectedTs changes. Fix gates the branch on a real selectedTs
  // transition (prevSelectedTsRef.current !== selectedTs).

  test('Test 38 [Plan 06 — scale stability]: tick click does NOT auto-switch the window when focal is recent (within 7d default)', async () => {
    // Baseline happy path: tick → focal with a RECENT createdAt → no
    // auto-slide. Default windowKey='7d' must stick.
    mockEntities.length = 0
    mockEntities.push({
      id: 'e3',
      createdAt: nowMinusHours(1.75), // very recent → ageMs << WINDOW_MS[7d]
    })
    useViewerStore.setState({
      selectionSource: null,
      selectedBucketKeys: new Set<string>(),
      focalBucketKey: null,
      selectedNodeIds: new Set<string>(),
      focalNodeId: null,
      selectionHistory: null,
    })
    const r = renderStrip()
    try {
      await waitFor(() => screen.getByTestId('lsl-tick-sess-bbbbbbbb'))
      // Default window=7d → 7d button is selected pre-click.
      const btn7dBefore = screen.getByLabelText('7 days')
      expect(btn7dBefore.getAttribute('data-state')).toBe('on')
      const tick = screen.getByTestId('lsl-tick-sess-bbbbbbbb')
      act(() => {
        fireEvent.click(tick)
      })
      // Wait for the click cascade to settle (focal write triggers a re-render).
      await waitFor(() => {
        expect(useViewerStore.getState().focalNodeId).toBe('e3')
      })
      // CRITICAL: window must NOT auto-slide. 7d stays selected.
      const btn7d = screen.getByLabelText('7 days')
      const btnAll = screen.getByLabelText('1 year')
      expect(btn7d.getAttribute('data-state')).toBe('on')
      expect(btnAll.getAttribute('data-state')).not.toBe('on')
    } finally {
      r.restore()
      mockEntities.length = 0
      useViewerStore.setState({
        selectedNodeIds: new Set<string>(),
        focalNodeId: null,
        selectedBucketKeys: new Set<string>(),
        focalBucketKey: null,
      })
    }
  })

  test('Test 39 [Plan 06 — scale stability]: tick click whose focal resolves to an OLD entity (Decision C auto-drill to LLS) does NOT auto-slide the window — source is timeline/history so the slide is skipped', async () => {
    // Symptom 1 from the 2026-06-14 visual smoke. Decision C auto-drill
    // collapses the focal to a long-lived ancestor (LiveLoggingSystem)
    // whose createdAt is days/weeks old. Pre-fix, the auto-slide effect
    // read selectedTs = LLS.createdAt and jumped the window to 'all',
    // even though the user clicked a tick that's clearly inside the
    // current window (the user wouldn't have been able to click an
    // off-window tick — the strip only renders tick-buttons for
    // sessions inside the active window).
    //
    // Fix: when selectionSource is 'timeline' or 'history', the
    // auto-slide branch returns early. Both sources cover tick-
    // originated clicks (auto-drill writes 'history'; multi-resolve
    // writes 'timeline').
    mockEntities.length = 0
    mockEntities.push({
      id: 'e3',
      // 400 days ago — would land on 'all' under the bug.
      createdAt: new Date(Date.now() - 400 * 24 * 3600_000).toISOString(),
    })
    useViewerStore.setState({
      selectionSource: null,
      selectedBucketKeys: new Set<string>(),
      focalBucketKey: null,
      selectedNodeIds: new Set<string>(),
      focalNodeId: null,
      selectionHistory: null,
    })
    const r = renderStrip()
    try {
      await waitFor(() => screen.getByTestId('lsl-tick-sess-bbbbbbbb'))
      // Default window = 7d.
      const btn7dPre = screen.getByLabelText('7 days')
      expect(btn7dPre.getAttribute('data-state')).toBe('on')
      const tick = screen.getByTestId('lsl-tick-sess-bbbbbbbb')
      act(() => {
        fireEvent.click(tick)
      })
      // Wait for the click cascade (selectionSource set + focalNodeId set).
      await waitFor(() => {
        const s = useViewerStore.getState()
        expect(s.focalNodeId).toBe('e3')
        // sess-bbbbbbbb has entityIds=['e3'] → Decision C auto-drill
        // writes selectionSource = 'history' (Layer 2 payload).
        expect(s.selectionSource).toBe('history')
      })
      // CRITICAL: window must NOT auto-slide to 'all'. 7d stays selected.
      const btn7d = screen.getByLabelText('7 days')
      const btnAll = screen.getByLabelText('1 year')
      expect(btn7d.getAttribute('data-state')).toBe('on')
      expect(btnAll.getAttribute('data-state')).not.toBe('on')
    } finally {
      r.restore()
      mockEntities.length = 0
      useViewerStore.setState({
        selectedNodeIds: new Set<string>(),
        focalNodeId: null,
        selectedBucketKeys: new Set<string>(),
        focalBucketKey: null,
        selectionSource: null,
      })
    }
  })

  test('Test 40 [Plan 06 — scale stability]: after a graph-originated auto-slide to "all", the user can manually pick 24h / 30d / 7d and the choice STICKS (selectedTs-change gate, not just selectionSource)', async () => {
    // Coverage for the dep-list re-trigger bug independent of the
    // source-skip guard. Simulate a graph-side selection of an old
    // entity (selectionSource='graph') — the auto-slide fires on the
    // FIRST render because focal is genuinely off-window. The user
    // then manually picks 24h: the auto-slide effect re-runs because
    // windowKey is in its dep list, but the isNewSelection gate
    // (prevSelectedTsRef.current === selectedTs) short-circuits before
    // the ageMs comparison and the manual choice sticks.
    //
    // This is the symptom-2 regression probe; graph-side selection
    // exercises the path that's still allowed to auto-slide.
    mockEntities.length = 0
    mockEntities.push({
      id: 'e3',
      createdAt: new Date(Date.now() - 400 * 24 * 3600_000).toISOString(),
    })
    useViewerStore.setState({
      selectionSource: null,
      selectedBucketKeys: new Set<string>(),
      focalBucketKey: null,
      selectedNodeIds: new Set<string>(),
      focalNodeId: null,
      selectionHistory: null,
    })
    const r = renderStrip()
    try {
      await waitFor(() => screen.getByTestId('lsl-tick-sess-bbbbbbbb'))
      // Simulate a graph-side click: set focal directly via setSelection
      // with source='graph' so the auto-slide takes the slide branch.
      act(() => {
        useViewerStore.getState().setSelection({
          nodeIds: new Set<string>(['e3']),
          bucketKeys: new Set<string>(),
          focal: { nodeId: 'e3', bucketKey: null },
          source: 'graph',
        })
      })
      // Auto-slide fires for graph-source selection with old focal.
      await waitFor(() => {
        const btnAll = screen.getByLabelText('1 year')
        expect(btnAll.getAttribute('data-state')).toBe('on')
      })
      // Symptom 2 probe: manually click 24h. Pre-fix, the auto-slide
      // re-fires (windowKey is in the dep list) and snaps back to 'all'
      // because selectedTs is still the old e3 ts. Post-fix, the
      // isNewSelection gate returns before the ageMs check.
      const btn24h = screen.getByLabelText('24 hours')
      act(() => {
        fireEvent.click(btn24h)
      })
      await waitFor(() => {
        expect(screen.getByLabelText('24 hours').getAttribute('data-state')).toBe('on')
      })
      expect(screen.getByLabelText('1 year').getAttribute('data-state')).not.toBe('on')
      // 30d also works.
      const btn30d = screen.getByLabelText('30 days')
      act(() => {
        fireEvent.click(btn30d)
      })
      await waitFor(() => {
        expect(screen.getByLabelText('30 days').getAttribute('data-state')).toBe('on')
      })
      expect(screen.getByLabelText('1 year').getAttribute('data-state')).not.toBe('on')
      // 7d also works.
      const btn7d = screen.getByLabelText('7 days')
      act(() => {
        fireEvent.click(btn7d)
      })
      await waitFor(() => {
        expect(screen.getByLabelText('7 days').getAttribute('data-state')).toBe('on')
      })
      expect(screen.getByLabelText('1 year').getAttribute('data-state')).not.toBe('on')
    } finally {
      r.restore()
      mockEntities.length = 0
      useViewerStore.setState({
        selectedNodeIds: new Set<string>(),
        focalNodeId: null,
        selectedBucketKeys: new Set<string>(),
        focalBucketKey: null,
        selectionSource: null,
      })
    }
  })

  // ---------------------------------------------------------------------
  // Phase 61 Plan 03 (LSLTIME-01/02/03): N-of-M honesty badge, 1y ladder,
  // bi-source tick color. Local render helper so we can inject a custom
  // envelope payload ({ sessions, total }) — the shared renderStrip only
  // wires { sessions } with no `total`.
  // ---------------------------------------------------------------------

  function renderStripWithPayload(payload: {
    sessions: LslSession[]
    total?: number
  }) {
    const originalFetch = globalThis.fetch
    const fetchImpl = makeFetchResponse(payload)
    globalThis.fetch = fetchImpl
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
    })
    const apiClient = new ApiClient('http://localhost:12436')
    const result = render(
      <QueryClientProvider client={client}>
        <LslTimelineStrip system="coding" apiClient={apiClient} />
      </QueryClientProvider>,
    )
    return {
      ...result,
      restore: () => {
        globalThis.fetch = originalFetch
      },
    }
  }

  test('Test 41 [Plan 03 — LSLTIME-02]: window ladder renders a 1y item and NO "all" / "All time" item', async () => {
    const r = renderStrip()
    try {
      await waitFor(() => screen.getByLabelText('1 year'))
      // The honest 1y label is present.
      expect(screen.getByLabelText('1 year')).toBeTruthy()
      expect(screen.getByText('1y')).toBeTruthy()
      // The deceptive 'all' / 'All time' label is gone.
      expect(screen.queryByLabelText('All time')).toBeNull()
      expect(screen.queryByText('all')).toBeNull()
    } finally {
      r.restore()
    }
  })

  test('Test 42 [Plan 03 — LSLTIME-01]: N-of-M badge renders when total > rendered ticks, with the honest "showing N of M" text', async () => {
    // 3 sessions rendered, backend reports 7 total → badge "showing 3 of 7".
    const r = renderStripWithPayload({ sessions: makeSessions(), total: 7 })
    try {
      await waitFor(() => screen.getByTestId('lsl-nofm-badge'))
      const badge = screen.getByTestId('lsl-nofm-badge')
      expect(badge.textContent).toMatch(/showing\s+3\s+of\s+7/)
    } finally {
      r.restore()
    }
  })

  test('Test 43 [Plan 03 — LSLTIME-01]: N-of-M badge is ABSENT when total === rendered ticks (nothing hidden)', async () => {
    const r = renderStripWithPayload({ sessions: makeSessions(), total: 3 })
    try {
      await waitFor(() => screen.getAllByTestId(/^lsl-tick-/))
      expect(screen.queryByTestId('lsl-nofm-badge')).toBeNull()
    } finally {
      r.restore()
    }
  })

  test('Test 44 [Plan 03 — LSLTIME-01]: N-of-M badge is ABSENT when the backend omits total (no honesty claim possible)', async () => {
    // The shared renderStrip wires { sessions } with NO total — badge must
    // not render (typeof total !== 'number').
    const r = renderStrip()
    try {
      await waitFor(() => screen.getAllByTestId(/^lsl-tick-/))
      expect(screen.queryByTestId('lsl-nofm-badge')).toBeNull()
    } finally {
      r.restore()
    }
  })

  test('Test 45 [Plan 03 — LSLTIME-03]: a batch session tick is blue while an online session tick is pink', async () => {
    // Two sessions, one per provenance class. Halo/selection is inactive
    // (no selection), so fillClass falls through to the source branch.
    const sessions: LslSession[] = [
      {
        id: 'sess-batch01',
        startAt: nowMinusHours(1),
        endAt: nowMinusHours(0.5),
        observationCount: 4,
        entityIds: ['eb'],
        source: 'batch',
      },
      {
        id: 'sess-online1',
        startAt: nowMinusHours(2),
        endAt: nowMinusHours(1.5),
        observationCount: 6,
        entityIds: ['eo'],
        source: 'online',
      },
    ]
    const r = renderStripWithPayload({ sessions })
    try {
      await waitFor(() => screen.getByTestId('lsl-tick-sess-batch01'))
      const batchTick = screen.getByTestId('lsl-tick-sess-batch01')
      const onlineTick = screen.getByTestId('lsl-tick-sess-online1')
      // batch → blue (graph BATCH convention); online → pink. Distinguishable at a glance.
      expect(batchTick.className).toMatch(/bg-blue-700/)
      expect(batchTick.className).not.toMatch(/bg-pink-300/)
      expect(onlineTick.className).toMatch(/bg-pink-300/)
      expect(onlineTick.className).not.toMatch(/bg-blue-700/)
    } finally {
      r.restore()
    }
  })

  test('Test 46 [Plan 03 — LSLTIME-03]: a session with no source defaults to pink (online convention)', async () => {
    const sessions: LslSession[] = [
      {
        id: 'sess-nosrc01',
        startAt: nowMinusHours(1),
        endAt: nowMinusHours(0.5),
        observationCount: 3,
        entityIds: ['en'],
        // source omitted
      },
    ]
    const r = renderStripWithPayload({ sessions })
    try {
      await waitFor(() => screen.getByTestId('lsl-tick-sess-nosrc01'))
      const tick = screen.getByTestId('lsl-tick-sess-nosrc01')
      expect(tick.className).toMatch(/bg-pink-300/)
      expect(tick.className).not.toMatch(/bg-blue-700/)
    } finally {
      r.restore()
    }
  })
})
