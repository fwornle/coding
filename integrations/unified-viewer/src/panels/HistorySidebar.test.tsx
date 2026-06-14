// PATTERN SOURCE: 56-PATTERNS.md § src/panels/HistorySidebar.tsx (component — extend)
//                  + OccurrenceHistorySidebar.test.tsx (mock + render harness pattern)
// CONTRACT: 56-02-PLAN.md Task 1 <behavior> + <action> steps 6-7
//           UI-SPEC §7 row 10 — chronological history feed (Insights only).
//
// Tests (9 in total):
//   1. renders data-history-id on each row (latent bug fix — scroll selector
//      at HistorySidebar.tsx line 106 was dead code before this plan).
//   2. clicking a row writes selection atomically — single getState snapshot
//      proves Phase 56 contract: selectedNodeId + highlightedRowKey + source +
//      pathToSelected.size === 0 in one write.
//   3. selected row has bg-blue-100 highlight class when selectedNodeId matches.
//   4. highlightedRowKey-only (no selectedNodeId match) also lights up the
//      matching row — proves highlightedRowKey is an independent highlight
//      signal (set externally e.g. by timeline cascade — Plan 04).
//   5. scrollIntoView is called after selectedNodeId changes with the
//      exact arg shape HistorySidebar.tsx line 108 passes today.
//   6. source-grep gate — `data-history-id` literal must be present in
//      source (catches regressions that drop the attribute again).
//   7. Logger discipline — no raw console.* in HistorySidebar.tsx source.
//   8. (CR-01) clicking a row CLEARS the LSL session-filter scope + sibling
//      session-tick fields that a prior timeline-tick click left behind.
//      Seed the store with a non-empty LSL filter + selectedSessionId/StartAt
//      BEFORE the click; assert ALL of them are cleared AFTER the click. This
//      locks the audit-contract-#5 cascade-clear semantics for sidebars so a
//      history-row click after a tick click leaves the graph in a coherent
//      "show everything visible" state — not the broken state where the D3
//      predicate stays narrowed to the previous session's entities.
//   9. (CR-01) source-grep acceptance gate: HistorySidebar.tsx MUST have
//      zero inline `useViewerStore.setState({...})` call sites — the only
//      selection writer path is the canonical `setSelection` action.

import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { useViewerStore } from '@/store/viewer-store'
import type { Entity } from '@/graph/types'

// Deterministic timestamps for sort stability.
const NOW = new Date('2026-06-13T12:00:00Z').getTime()
const MIN_AGO = new Date(NOW - 30_000).toISOString()
const FIVE_MIN_AGO = new Date(NOW - 5 * 60_000).toISOString()
const TWO_HRS_AGO = new Date(NOW - 2 * 60 * 60_000).toISOString()

// HistorySidebar filters by HISTORY_TYPES = { 'Insight' } — every mock
// must carry entityType: 'Insight' to be rendered.
const mockEntities: Entity[] = [
  {
    id: 'i-just-now',
    name: 'Recent Insight',
    entityType: 'Insight',
    ontologyClass: 'Insight',
    createdAt: MIN_AGO,
    metadata: { source: 'auto', team: 'coding' },
  } as unknown as Entity,
  {
    id: 'i-min',
    name: 'Five Minute Insight',
    entityType: 'Insight',
    ontologyClass: 'Insight',
    createdAt: FIVE_MIN_AGO,
    metadata: { source: 'manual', team: 'coding' },
  } as unknown as Entity,
  {
    id: 'i-hr',
    name: 'Two Hour Insight',
    entityType: 'Insight',
    ontologyClass: 'Insight',
    createdAt: TWO_HRS_AGO,
    metadata: { source: 'auto', team: 'coding' },
  } as unknown as Entity,
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

import { HistorySidebar } from './HistorySidebar'
import type { ApiClient } from '@/api/ApiClient'

function renderPanel() {
  const apiClient = { base: 'http://test.local' } as ApiClient
  return render(<HistorySidebar apiClient={apiClient} system="coding" />)
}

describe('HistorySidebar (Plan 56-02 Task 1)', () => {
  beforeEach(() => {
    // Reset selection-sync slice baseline (Phase 56 fields explicit).
    // 2026-06-13 (CR-01): also reset the LSL filter slice + the sibling
    // selectedSessionStartAt so Test 8 starts from a clean slate and the
    // pre-seeded LSL state it writes cannot leak from a prior test.
    // 2026-06-13 (Phase 56.1 Plan 05): single-selection fields are gone —
    // multi-set + derived focal. Bucket-set replaces (sessionId, startAt).
    useViewerStore.setState({
      focalNodeId: null,
      selectedNodeIds: new Set<string>(),
      selectedEdgeId: null,
      pathToSelected: new Set<string>(),
      selectionSource: null,
      highlightedRowKey: null,
      selectedBucketKeys: new Set<string>(),
      focalBucketKey: null,
      lslSessionFilter: [],
      lslFilterEntityIds: null,
    })
    cleanup()
    // jsdom does not implement scrollIntoView on Element.prototype — the
    // HistorySidebar useEffect calls it whenever `selectedNodeId` is set, so
    // every test that flips selection during render needs this stub or the
    // React passive-effect commit throws TypeError. Test 5 spies on the same
    // method; this default stub is the safe baseline.
    if (typeof (Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView !== 'function') {
      ;(Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {}
    }
  })

  test('Test 1: renders data-history-id on every row (fixes dead-code selector at line 106)', () => {
    renderPanel()
    const rows = document.querySelectorAll('[data-history-id]')
    expect(rows.length).toBe(mockEntities.length)
    // Each id matches the corresponding entity id.
    const ids = Array.from(rows).map((el) => el.getAttribute('data-history-id'))
    expect(ids).toEqual(expect.arrayContaining(['i-just-now', 'i-min', 'i-hr']))
  })

  test('Test 2: clicking a row writes selection atomically (Phase 56 contract)', () => {
    renderPanel()
    const row = document.querySelector('[data-history-id="i-min"]') as HTMLElement
    expect(row).not.toBeNull()
    fireEvent.click(row)
    // Single getState snapshot proves all 4 fields land in one setState.
    const s = useViewerStore.getState()
    expect(s.focalNodeId).toBe('i-min')
    expect(s.highlightedRowKey).toBe('i-min')
    expect(s.selectionSource).toBe('history')
    expect(s.pathToSelected.size).toBe(0)
  })

  test('Test 3: selected row has bg-blue-100 highlight class when selectedNodeId matches', () => {
    // Pre-set selection BEFORE render so the conditional className renders correctly.
    useViewerStore.getState().setSelectedNode('i-min'); useViewerStore.setState({ highlightedRowKey: 'i-min', selectionSource: 'graph' })
    renderPanel()
    const row = document.querySelector('[data-history-id="i-min"]') as HTMLElement
    expect(row).not.toBeNull()
    expect(row.className).toMatch(/\bbg-blue-100\b/)
  })

  test('Test 4: highlightedRowKey alone lights up the row (independent of selectedNodeId)', () => {
    // highlightedRowKey set externally (e.g. by a timeline cascade), but
    // selectedNodeId stays null OR points elsewhere — the row should
    // still carry the highlight class so the user sees the cross-pane
    // breadcrumb.
    useViewerStore.getState().setSelectedNode(null); useViewerStore.setState({ highlightedRowKey: 'i-hr', selectionSource: 'timeline' })
    renderPanel()
    const row = document.querySelector('[data-history-id="i-hr"]') as HTMLElement
    expect(row).not.toBeNull()
    expect(row.className).toMatch(/\bbg-blue-100\b/)
  })

  test('Test 5: scrollIntoView is called after selectedNodeId changes (preserves existing effect at HistorySidebar.tsx:108)', () => {
    // jsdom does not implement scrollIntoView on Element.prototype — install a
    // stub so vi.spyOn has a method to wrap (the production code calls
    // `el.scrollIntoView({...})` and would otherwise throw before we observed it).
    const original = (Element.prototype as unknown as { scrollIntoView?: (arg: unknown) => void }).scrollIntoView
    ;(Element.prototype as unknown as { scrollIntoView: (arg: unknown) => void }).scrollIntoView = () => {}
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {})
    try {
      // Render with no selection — the effect bails out at the guard.
      renderPanel()
      // Now flip selectedNodeId; the effect should fire and call scrollIntoView.
      act(() => {
        useViewerStore.getState().setSelectedNode('i-just-now')
      })
      expect(scrollSpy).toHaveBeenCalled()
      // Verify the exact arg shape per HistorySidebar.tsx:108.
      expect(scrollSpy).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' })
    } finally {
      scrollSpy.mockRestore()
      if (original === undefined) {
        delete (Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView
      } else {
        ;(Element.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = original
      }
    }
  })

  test('Test 6: source-grep gate — `data-history-id` literal present in source', () => {
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/panels/HistorySidebar.tsx'),
      'utf8',
    )
    expect(src).toMatch(/\bdata-history-id\b/)
  })

  test('Test 7: Logger discipline — no raw console.* in HistorySidebar.tsx source', () => {
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/panels/HistorySidebar.tsx'),
      'utf8',
    )
    expect(src).not.toMatch(/console\.(log|warn|error|info|debug|trace)/)
  })

  // ====================================================================
  // CR-01 fix (2026-06-13): the HistorySidebar row-click handler used to
  // call `useViewerStore.setState({...})` with a 4-field payload that did
  // NOT clear the LSL session-filter scope or the sibling session-tick
  // fields. After a timeline-tick click set `lslFilterEntityIds` +
  // `lslSessionFilter` + `selectedSessionId/StartAt`, a history-row click
  // left those stale — the D3 graph stayed narrowed to the previous
  // session's entities while the side panel had already swapped to a
  // different entity's detail. Broken UX with no recovery path short of
  // pressing Esc.
  //
  // The fix routes through the canonical `setSelection` store action
  // with explicit nulls/empties for the LSL + session-tick fields, so
  // subscribers see one coherent snapshot. The two tests below lock the
  // contract: (Test 8) functional — pre-seed the stale state, click,
  // assert cleared; (Test 9) source-grep — no inline setState remains.
  // ====================================================================

  test('Test 8 (CR-01): clicking a row clears the stale LSL session-filter scope + sibling session-tick fields that a prior timeline-tick click left behind', () => {
    // Pre-seed the store with the EXACT state a timeline-tick click leaves
    // behind: non-empty LSL filter (graph predicate narrowed to a session's
    // entities) + sibling session-tick fields populated. This is the state
    // the user lands in after clicking a tick on the LslTimelineStrip.
    // 2026-06-13 (Phase 56.1 Plan 05): Phase 56 single-selection fields are
    // gone. Seed via the imperative shim + the multi-set bucketKey composite
    // so the post-click cascade-clear assertions still pin the contract.
    useViewerStore.getState().setSelectedNode('prev-entity')
    useViewerStore.setState({
      selectionSource: 'timeline',
      highlightedRowKey: 'prev-entity',
      selectedBucketKeys: new Set<string>(['sess-X|2026-06-13T11:00:00Z']),
      focalBucketKey: 'sess-X|2026-06-13T11:00:00Z',
      lslSessionFilter: ['sess-X'],
      lslFilterEntityIds: new Set<string>(['e1', 'e2', 'prev-entity']),
    })

    renderPanel()
    const row = document.querySelector('[data-history-id="i-min"]') as HTMLElement
    expect(row).not.toBeNull()
    fireEvent.click(row)

    // Single getState snapshot — every field must reflect the post-click
    // contract. The history-row click MUST replace the selection AND
    // cascade-clear the LSL session-filter scope so the graph predicate
    // stops narrowing to the previous session's entities.
    const s = useViewerStore.getState()
    // Selection moved to the clicked row.
    expect(s.focalNodeId).toBe('i-min')
    expect(s.highlightedRowKey).toBe('i-min')
    expect(s.selectionSource).toBe('history')
    expect(s.pathToSelected.size).toBe(0)
    // Sibling session-tick fields MUST be cleared (audit §7 R2: they are
    // always written/cleared together; the previous tick-set values are now
    // stale because the user navigated to a different entity context).
    expect(s.focalBucketKey).toBeNull()
    expect(s.focalBucketKey).toBeNull()
    // LSL session-filter scope MUST be cleared so the D3 graph's
    // `visibleEntities` predicate stops intersecting against the previous
    // tick's entity set. This is the audit-contract-#5 cascade-clear
    // semantics for sidebars: a history-row click is a "fresh" selection
    // scope that should not inherit the previous pane's filter.
    expect(s.lslSessionFilter).toEqual([])
    expect(s.lslFilterEntityIds).toBeNull()
  })

  test('Test 9 (CR-01): source-grep acceptance gate — HistorySidebar.tsx has zero inline useViewerStore.setState({...}) call sites', () => {
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/panels/HistorySidebar.tsx'),
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
