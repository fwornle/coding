// PATTERN SOURCE: 55-09-PLAN.md Task 1 <behavior> (Sidebar)
// CONTRACT: 55-PATTERNS.md § OccurrenceHistorySidebar.tsx
//           UI-SPEC §7 row 11 hybrid: render only when selectedNodeId === null
//
// Tests:
//   1. renders only when selectedNodeId === null (guard)
//   2. renders up to 50 items, sorted by updatedAt || createdAt descending
//   3. relative timestamp formatting: Just now / Xm ago / Xh ago / Xd ago / absolute
//   4. clicking a row calls setSelectedNode(entity.id)
//   5. layer badge classes are sourced from LAYER_BADGE_CLASS in vokb-palette

import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
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
    useViewerStore.setState({ selectedNodeId: null, theme: 'light' })
    cleanup()
    // Pin Date.now() so relative-time formatting is deterministic.
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  test('Test 1: renders only when selectedNodeId === null — null guard', () => {
    useViewerStore.setState({ selectedNodeId: 'some-id' })
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
    expect(screen.getByTestId('occurrence-row-e-min').textContent).toMatch(/\b5m ago\b/)
    expect(screen.getByTestId('occurrence-row-e-hr').textContent).toMatch(/\b2h ago\b/)
    expect(screen.getByTestId('occurrence-row-e-day').textContent).toMatch(/\b3d ago\b/)
    // 60d ago falls outside the relative band — render as absolute (year-month-day prefix is enough)
    expect(screen.getByTestId('occurrence-row-e-old').textContent).toMatch(/2026/)
  })

  test('Test 4: clicking a row calls setSelectedNode(entity.id)', () => {
    renderPanel()
    const row = screen.getByTestId('occurrence-row-e-min')
    fireEvent.click(row)
    expect(useViewerStore.getState().selectedNodeId).toBe('e-min')
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
})
