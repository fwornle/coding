// PATTERN SOURCE: 56-PATTERNS.md § src/panels/HistorySidebar.tsx (component — extend)
//                  + OccurrenceHistorySidebar.test.tsx (mock + render harness pattern)
// CONTRACT: 56-02-PLAN.md Task 1 <behavior> + <action> steps 6-7
//           UI-SPEC §7 row 10 — chronological history feed (Insights only).
//
// Tests (7 in total):
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
    useViewerStore.setState({
      selectedNodeId: null,
      selectedEdgeId: null,
      pathToSelected: new Set<string>(),
      selectionSource: null,
      highlightedRowKey: null,
      selectedSessionId: null,
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
    expect(s.selectedNodeId).toBe('i-min')
    expect(s.highlightedRowKey).toBe('i-min')
    expect(s.selectionSource).toBe('history')
    expect(s.pathToSelected.size).toBe(0)
  })

  test('Test 3: selected row has bg-blue-100 highlight class when selectedNodeId matches', () => {
    // Pre-set selection BEFORE render so the conditional className renders correctly.
    useViewerStore.setState({ selectedNodeId: 'i-min', highlightedRowKey: 'i-min', selectionSource: 'graph' })
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
    useViewerStore.setState({ selectedNodeId: null, highlightedRowKey: 'i-hr', selectionSource: 'timeline' })
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
        useViewerStore.setState({ selectedNodeId: 'i-just-now' })
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
})
