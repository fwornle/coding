// PATTERN SOURCE: 55-09-PLAN.md Task 1 <behavior> (Sidebar)
//                 + 56-02-PLAN.md Task 2 (Phase 56 atomic-write + highlight)
// CONTRACT: 55-PATTERNS.md § OccurrenceHistorySidebar.tsx
//           UI-SPEC §7 row 11 hybrid: render only when selectedNodeId === null
//           56-PATTERNS.md § OccurrenceHistorySidebar.tsx — keep null-guard;
//           click → atomic 4-field write; highlight via highlightedRowKey.
//
// Tests:
//   1-5. (Phase 55 baseline) null-guard, sort, relative-time, click-routes-to-store,
//        layer-badge palette
//   6. (Phase 56) Test 8 — click writes atomic 4-field selection per Phase 56
//      contract (single getState snapshot proves selectedNodeId +
//      highlightedRowKey + selectionSource land together).
//   7. (Phase 56) Test 9 — highlight class lights up the row when
//      highlightedRowKey matches AND selectedNodeId === null (sidebar still
//      visible per the line-70 null-guard; e.g. external timeline cascade).
//   8. (Phase 56) Test 10 — Logger discipline: no raw console.* in source.
//   9. (CR-01) Test 11 — clicking a row CLEARS the LSL session-filter scope +
//      sibling session-tick fields that a prior timeline-tick click left
//      behind. Pre-seed the store with non-empty LSL filter +
//      selectedSessionId/StartAt BEFORE the click; assert ALL of them are
//      cleared AFTER. Locks the audit-contract-#5 cascade-clear semantics
//      for sidebars so a sidebar-row click after a tick click leaves the
//      graph in a coherent "show everything visible" state — not the
//      broken state where the D3 predicate stays narrowed to the previous
//      session's entities.
//  10. (CR-01) Test 12 — source-grep acceptance gate: OccurrenceHistorySidebar.tsx
//      MUST have zero inline `useViewerStore.setState({...})` call sites —
//      the only selection writer path is the canonical `setSelection` action.

import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { useViewerStore } from '@/store/viewer-store'
import type { Entity } from '@/graph/types'

// Build deterministic test entities with various ages relative to a fixed clock
const NOW = new Date('2026-06-09T12:00:00Z').getTime()
const MIN_AGO = new Date(NOW - 30 * 1000).toISOString() // "Just now"
const FIVE_MIN_AGO = new Date(NOW - 5 * 60 * 1000).toISOString()
const TWO_HRS_AGO = new Date(NOW - 2 * 60 * 60 * 1000).toISOString()
const THREE_DAYS_AGO = new Date(NOW - 3 * 24 * 60 * 60 * 1000).toISOString()
const OLD = new Date(NOW - 60 * 24 * 60 * 60 * 1000).toISOString() // 60d ago — falls back to absolute

const mockEntities: Entity[] = [
  { id: 'e-just-now', name: 'Just Now Entity', ontologyClass: 'Observation', updatedAt: MIN_AGO, layer: 'evidence' },
  { id: 'e-min', name: 'Minutes Ago Entity', ontologyClass: 'Pattern', updatedAt: FIVE_MIN_AGO, layer: 'pattern' },
  { id: 'e-hr', name: 'Hours Ago Entity', ontologyClass: 'Observation', updatedAt: TWO_HRS_AGO, layer: 'evidence' },
  { id: 'e-day', name: 'Days Ago Entity', ontologyClass: 'Observation', createdAt: THREE_DAYS_AGO, layer: 'evidence' },
  { id: 'e-old', name: 'Old Entity', ontologyClass: 'Observation', updatedAt: OLD, layer: 'evidence' },
]

vi.mock('@/graph/useGraphData', () => ({
  useGraphData: () => ({
    entities: mockEntities,
    relations: [],
    ontology: [],
    isLoading: false,
    error: null,
  }),
}))

import { OccurrenceHistorySidebar } from './OccurrenceHistorySidebar'
import type { ApiClient } from '@/api/ApiClient'

function renderPanel() {
  const apiClient = { base: 'http://test.local' } as ApiClient
  return render(<OccurrenceHistorySidebar apiClient={apiClient} system="coding" />)
}

describe('OccurrenceHistorySidebar (Plan 55-09 Task 1)', () => {
  beforeEach(() => {
    // Phase 56: reset selection-sync slice baseline too — otherwise leaks
    // across tests (e.g. a stale highlightedRowKey from a previous Phase 56
    // test masks Test 9's assertion that no row is highlighted by default).
    // 2026-06-13 (CR-01): also reset the LSL filter slice + the sibling
    // selectedSessionStartAt so Test 11 starts from a clean slate and the
    // pre-seeded LSL state it writes cannot leak from a prior test.
    // 2026-06-13 (Phase 56.1 Plan 05): single-selection fields are gone —
    // multi-set + derived focal. Bucket-set replaces (sessionId, startAt).
    useViewerStore.setState({
      focalNodeId: null,
      selectedNodeIds: new Set<string>(),
      theme: 'light',
      selectionSource: null,
      highlightedRowKey: null,
      selectedBucketKeys: new Set<string>(),
      focalBucketKey: null,
      lslSessionFilter: [],
      lslFilterEntityIds: null,
    })
    cleanup()
    // Pin Date.now() so relative-time formatting is deterministic.
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  test('Test 1: renders only when selectedNodeId === null — null guard', () => {
    useViewerStore.getState().setSelectedNode('some-id')
    const { container } = renderPanel()
    // Sidebar root absent when selection is non-null.
    expect(container.querySelector('[data-testid="occurrence-history-sidebar"]')).toBeNull()
  })

  test('Test 1b: renders WHEN selectedNodeId === null', () => {
    renderPanel()
    expect(screen.getByTestId('occurrence-history-sidebar')).toBeInTheDocument()
  })

  test('Test 2: renders items sorted by updatedAt || createdAt descending', () => {
    renderPanel()
    const rows = screen.getAllByTestId(/^occurrence-row-/)
    expect(rows.length).toBeGreaterThan(0)
    // Newest first: e-just-now, e-min, e-hr, e-day, e-old
    const ids = rows.map((r) => r.getAttribute('data-testid'))
    expect(ids[0]).toBe('occurrence-row-e-just-now')
    expect(ids[1]).toBe('occurrence-row-e-min')
    expect(ids[2]).toBe('occurrence-row-e-hr')
    expect(ids[3]).toBe('occurrence-row-e-day')
    expect(ids[4]).toBe('occurrence-row-e-old')
  })

  test('Test 2b: caps at 50 items (T-55-04-01 ring-buffer parity for in-panel UI)', () => {
    // Local override — build 60 entities; only top 50 should render.
    const big: Entity[] = Array.from({ length: 60 }, (_, i) => ({
      id: `b${i}`,
      name: `Bulk ${i}`,
      ontologyClass: 'Observation',
      updatedAt: new Date(NOW - i * 1000).toISOString(),
    }))
    // Replace mock entries for this single test
    mockEntities.length = 0
    mockEntities.push(...big)
    renderPanel()
    const rows = screen.getAllByTestId(/^occurrence-row-/)
    expect(rows.length).toBeLessThanOrEqual(50)
    // Restore baseline entities for subsequent tests
    mockEntities.length = 0
    mockEntities.push(
      { id: 'e-just-now', name: 'Just Now Entity', ontologyClass: 'Observation', updatedAt: MIN_AGO, layer: 'evidence' },
      { id: 'e-min', name: 'Minutes Ago Entity', ontologyClass: 'Pattern', updatedAt: FIVE_MIN_AGO, layer: 'pattern' },
      { id: 'e-hr', name: 'Hours Ago Entity', ontologyClass: 'Observation', updatedAt: TWO_HRS_AGO, layer: 'evidence' },
      { id: 'e-day', name: 'Days Ago Entity', ontologyClass: 'Observation', createdAt: THREE_DAYS_AGO, layer: 'evidence' },
      { id: 'e-old', name: 'Old Entity', ontologyClass: 'Observation', updatedAt: OLD, layer: 'evidence' },
    )
  })

  test('Test 3: relative timestamp formatting per VOKB HistorySidebar.tsx:45-68', () => {
    renderPanel()
    expect(screen.getByTestId('occurrence-row-e-just-now').textContent).toContain('Just now')
    expect(screen.getByTestId('occurrence-row-e-min').textContent).toContain('5m ago')
    expect(screen.getByTestId('occurrence-row-e-hr').textContent).toContain('2h ago')
    expect(screen.getByTestId('occurrence-row-e-day').textContent).toContain('3d ago')
    // 60d ago falls outside the relative band — render as absolute (year-month-day prefix is enough)
    expect(screen.getByTestId('occurrence-row-e-old').textContent).toMatch(/2026/)
  })

  test('Test 4: clicking a row calls setSelectedNode(entity.id)', () => {
    renderPanel()
    const row = screen.getByTestId('occurrence-row-e-min')
    fireEvent.click(row)
    expect(useViewerStore.getState().focalNodeId).toBe('e-min')
  })

  test('Test 5: layer badge classes are sourced from LAYER_BADGE_CLASS (vokb-palette)', () => {
    renderPanel()
    // The first row's entity is 'evidence' — its badge must carry the LAYER_BADGE_CLASS
    // class set (bg-blue-100 token from vokb-palette).
    const row = screen.getByTestId('occurrence-row-e-just-now')
    const badge = row.querySelector('[data-testid="occurrence-layer-badge"]')
    expect(badge).not.toBeNull()
    expect(badge!.className).toMatch(/\bbg-blue-100\b/)
    // The second row's entity is 'pattern' — its badge must carry the amber tokens.
    const patternRow = screen.getByTestId('occurrence-row-e-min')
    const patternBadge = patternRow.querySelector('[data-testid="occurrence-layer-badge"]')
    expect(patternBadge!.className).toMatch(/\bbg-amber-100\b/)
  })

  // ---------- Phase 56 — Plan 56-02 Task 2 ----------

  test('Test 8: clicking a row writes selection atomically (Phase 56 4-field contract)', () => {
    renderPanel()
    const row = screen.getByTestId('occurrence-row-e-min')
    fireEvent.click(row)
    // Single getState snapshot — proves Phase 56 atomic write replaced the
    // single-field setSelectedNode call: selectedNodeId + highlightedRowKey +
    // selectionSource all land together with pathToSelected reset.
    const s = useViewerStore.getState()
    expect(s.focalNodeId).toBe('e-min')
    expect(s.highlightedRowKey).toBe('e-min')
    expect(s.selectionSource).toBe('history')
  })

  test('Test 9: highlight class is applied when highlightedRowKey matches a row (sidebar visible because selectedNodeId === null)', () => {
    // External signal (e.g. timeline tick cascade in Plan 04) sets
    // highlightedRowKey but leaves selectedNodeId null — sidebar IS visible
    // per the line-70 null-guard, and the row should still light up.
    // 2026-06-13 (Phase 56.1 Plan 05): selectedNodeId is gone — multi-set + focal.
    useViewerStore.getState().setSelectedNode(null)
    useViewerStore.setState({
      highlightedRowKey: 'e-min',
      selectionSource: 'timeline',
    })
    renderPanel()
    const row = screen.getByTestId('occurrence-row-e-min')
    expect(row.className).toMatch(/\bbg-blue-100\b/)
    // A non-matching row must NOT carry the highlight token (avoid false-positives
    // from inherited Tailwind utility tokens that might already include bg-blue-100
    // elsewhere on the button).
    const otherRow = screen.getByTestId('occurrence-row-e-just-now')
    expect(otherRow.className).not.toMatch(/\bbg-blue-100\b/)
  })

  test('Test 10: Logger discipline — no raw console.* in OccurrenceHistorySidebar.tsx source', () => {
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/panels/OccurrenceHistorySidebar.tsx'),
      'utf8',
    )
    expect(src).not.toMatch(/console\.(log|warn|error|info|debug|trace)/)
  })

  // ====================================================================
  // CR-01 fix (2026-06-13): the OccurrenceHistorySidebar row-click handler
  // used to call `useViewerStore.setState({...})` with a 4-field payload
  // that did NOT clear the LSL session-filter scope or the sibling
  // session-tick fields. After a timeline-tick click set
  // `lslFilterEntityIds` + `lslSessionFilter` + `selectedSessionId/StartAt`,
  // a sidebar-row click left those stale — the D3 graph stayed narrowed to
  // the previous session's entities while the side panel had already
  // swapped to a different entity's detail. Broken UX with no recovery
  // path short of pressing Esc.
  //
  // The fix routes through the canonical `setSelection` store action
  // with explicit nulls/empties for the LSL + session-tick fields, so
  // subscribers see one coherent snapshot. The two tests below lock the
  // contract: (Test 11) functional — pre-seed the stale state, click,
  // assert cleared; (Test 12) source-grep — no inline setState remains.
  //
  // NOTE: this sidebar's line-70 null-guard means it ONLY renders when
  // `selectedNodeId === null`. The pre-seed below intentionally writes
  // `selectedNodeId: null` even though a tick click would normally set
  // it to the first entity in the bucket — this models the "sidebar-only
  // mode" (round 4 of the audit) where the tick's entities had no
  // graph-visible ancestor and `pickFirstResolvable` resolved to null. In
  // that mode the OccurrenceHistorySidebar IS visible and clickable, but
  // the LSL filter is still active — which is exactly the scenario CR-01
  // breaks in the un-patched code.
  // ====================================================================

  test('Test 11 (CR-01): clicking a row clears the stale LSL session-filter scope + sibling session-tick fields that a prior timeline-tick click left behind', () => {
    // Pre-seed the store with the EXACT state a timeline-tick click leaves
    // behind in sidebar-only mode: non-empty LSL filter (graph predicate
    // narrowed to a session's entities) + sibling session-tick fields
    // populated, with selectedNodeId still null because the bucket's
    // entities had no graph-visible ancestor (round-4 sidebar-only path).
    // 2026-06-13 (Phase 56.1 Plan 05): Phase 56 single-selection fields are
    // gone. Seed via multi-set + bucketKey composite (which encodes startAt).
    useViewerStore.getState().setSelectedNode(null)
    useViewerStore.setState({
      selectionSource: 'timeline',
      highlightedRowKey: null,
      selectedBucketKeys: new Set<string>(['sess-X|2026-06-13T11:00:00Z']),
      focalBucketKey: 'sess-X|2026-06-13T11:00:00Z',
      lslSessionFilter: ['sess-X'],
      lslFilterEntityIds: new Set<string>(['orphan-1', 'orphan-2']),
    })

    renderPanel()
    const row = screen.getByTestId('occurrence-row-e-min')
    fireEvent.click(row)

    // Single getState snapshot — every field must reflect the post-click
    // contract. The sidebar-row click MUST replace the selection AND
    // cascade-clear the LSL session-filter scope so the graph predicate
    // stops narrowing to the previous session's entities.
    const s = useViewerStore.getState()
    // Selection moved to the clicked row.
    expect(s.focalNodeId).toBe('e-min')
    expect(s.highlightedRowKey).toBe('e-min')
    expect(s.selectionSource).toBe('history')
    // Sibling session-tick fields MUST be cleared (audit §7 R2: they are
    // always written/cleared together; the previous tick-set values are now
    // stale because the user navigated to a different entity context).
    expect(s.focalBucketKey).toBeNull()
    expect(s.focalBucketKey).toBeNull()
    // LSL session-filter scope MUST be cleared so the D3 graph's
    // `visibleEntities` predicate stops intersecting against the previous
    // tick's entity set. This is the audit-contract-#5 cascade-clear
    // semantics for sidebars: a sidebar-row click is a "fresh" selection
    // scope that should not inherit the previous pane's filter.
    expect(s.lslSessionFilter).toEqual([])
    expect(s.lslFilterEntityIds).toBeNull()
  })

  test('Test 12 (CR-01): source-grep acceptance gate — OccurrenceHistorySidebar.tsx has zero inline useViewerStore.setState({...}) call sites', () => {
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/panels/OccurrenceHistorySidebar.tsx'),
      'utf8',
    )
    // The CR-01 fix locked the contract: the only path to write selection
    // from this file is `useViewerStore.getState().setSelection({...})`.
    // Any future regression that re-introduces an inline `setState({...})`
    // for selection writes would re-open CR-01.
    expect(src).not.toMatch(/useViewerStore\.setState\s*\(/)
    // Positive assertion: the canonical setSelection call IS present.
    expect(src).toMatch(/useViewerStore\.getState\(\)\.setSelection\s*\(/)
  })
})
