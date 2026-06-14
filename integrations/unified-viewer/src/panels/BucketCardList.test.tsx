// PATTERN SOURCE: 56.1-PATTERNS.md §6 (BucketCardList NEW) + §E (test boilerplate)
//                  + HistorySidebar.test.tsx (vi.mock useGraphData + beforeEach + cleanup)
// CONTRACT: 56.1-04-PLAN.md Task 1 <behavior> + <action> steps 1-8
//           CONTEXT.md D-4 (sidebar visual) + D-5 (drill collapse) + <discretion> #4
//           Locked Contract #5 — no inline useViewerStore.setState({ in production
//
// Tests (≥7):
//   1. renders empty state when isMultiMode but no derived items
//   2. renders cards in timeline mode from lslFilterEntityIds
//   3. renders cards in graph multi mode from selectedNodeIds (>1)
//   4. card click drills via setSelection (nodeIds=Set([id]) + bucketKeys empty
//      + focal=id + source='history' + lslSessionFilter=[] + lslFilterEntityIds=null)
//   5. Logger discipline — no raw console.* in BucketCardList.tsx
//   6. Locked Contract #5 — no inline useViewerStore.setState({ in BucketCardList.tsx
//   7. source-grep: data-testid markers present (outer container + per-card)

import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { useViewerStore } from '@/store/viewer-store'
import type { Entity } from '@/graph/types'

// Deterministic timestamps for sort stability (clone HistorySidebar.test.tsx).
const NOW = new Date('2026-06-13T12:00:00Z').getTime()
const MIN_AGO = new Date(NOW - 30_000).toISOString()
const FIVE_MIN_AGO = new Date(NOW - 5 * 60_000).toISOString()
const TWO_HRS_AGO = new Date(NOW - 2 * 60 * 60_000).toISOString()

const mockEntities: Entity[] = [
  {
    id: 'e1',
    name: 'Entity One',
    entityType: 'Insight',
    ontologyClass: 'Insight',
    createdAt: MIN_AGO,
    metadata: { source: 'auto', team: 'coding' },
  } as unknown as Entity,
  {
    id: 'e2',
    name: 'Entity Two',
    entityType: 'Observation',
    ontologyClass: 'Observation',
    createdAt: FIVE_MIN_AGO,
    metadata: { source: 'manual', team: 'coding' },
  } as unknown as Entity,
  {
    id: 'e3',
    name: 'Entity Three',
    entityType: 'Digest',
    ontologyClass: 'Digest',
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

import { BucketCardList } from './BucketCardList'
import type { ApiClient } from '@/api/ApiClient'

function renderPanel() {
  const apiClient = { base: 'http://test.local' } as ApiClient
  return render(<BucketCardList apiClient={apiClient} system="coding" />)
}

// Phase 56.1 selection-slice baseline reset. Mirrors the Plan 01 multi-set
// shape — every test starts from a fully cleared slice so cross-test leak
// is impossible (beforeEach pattern from PATTERNS §E).
function resetSlice() {
  useViewerStore.setState({
    selectedNodeIds: new Set<string>(),
    focalNodeId: null,
    selectedBucketKeys: new Set<string>(),
    focalBucketKey: null,
    selectedEdgeId: null,
    pathToSelected: new Set<string>(),
    selectionSource: null,
    highlightedRowKey: null,
    lslSessionFilter: [],
    lslFilterEntityIds: null,
  })
}

describe('BucketCardList (Plan 56.1-04 Task 1)', () => {
  beforeEach(() => {
    resetSlice()
    cleanup()
  })

  test('Test 1: renders empty state when isMultiMode but no derived items', () => {
    // Timeline mode with a selected bucket but lslFilterEntityIds = empty Set
    // (zero entities resolve to the bucket). Mode is multi (selectedBucketKeys
    // is non-empty) so the component MOUNTS but renders the empty placeholder.
    useViewerStore.setState({
      selectionSource: 'timeline',
      selectedBucketKeys: new Set<string>(['sess-X|2026-06-13T11:00:00Z']),
      lslFilterEntityIds: new Set<string>(),
    })
    renderPanel()
    const list = document.querySelector('[data-testid="bucket-card-list"]')
    expect(list).not.toBeNull()
    // No per-card buttons rendered.
    const cards = document.querySelectorAll('[data-testid^="bucket-card-"]')
    // The outer container itself matches "bucket-card-" prefix — exclude it.
    const perCard = Array.from(cards).filter(
      (el) => el.getAttribute('data-testid') !== 'bucket-card-list',
    )
    expect(perCard.length).toBe(0)
    // Empty-state copy present somewhere in the rendered tree.
    expect(list!.textContent ?? '').toMatch(/no.*(cards|insights|items)/i)
  })

  test('Test 2: renders cards in timeline mode from lslFilterEntityIds', () => {
    useViewerStore.setState({
      selectionSource: 'timeline',
      selectedBucketKeys: new Set<string>(['sess-X|2026-06-13T11:00:00Z']),
      lslFilterEntityIds: new Set<string>(['e1', 'e2']),
    })
    renderPanel()
    expect(document.querySelector('[data-testid="bucket-card-e1"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="bucket-card-e2"]')).not.toBeNull()
    // e3 is in mockEntities but NOT in lslFilterEntityIds → excluded.
    expect(document.querySelector('[data-testid="bucket-card-e3"]')).toBeNull()
  })

  test('Test 3: renders cards in graph multi mode from selectedNodeIds (>1)', () => {
    useViewerStore.setState({
      selectionSource: 'graph',
      selectedNodeIds: new Set<string>(['e1', 'e2', 'e3']),
      focalNodeId: 'e3',
    })
    renderPanel()
    expect(document.querySelector('[data-testid="bucket-card-e1"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="bucket-card-e2"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="bucket-card-e3"]')).not.toBeNull()
  })

  test('Test 4: card click drills via setSelection (nodeIds=Set([id]) + bucketKeys empty + focal=id + source=history)', () => {
    useViewerStore.setState({
      selectionSource: 'timeline',
      selectedBucketKeys: new Set<string>(['sess-X|2026-06-13T11:00:00Z']),
      lslFilterEntityIds: new Set<string>(['e1', 'e2']),
    })
    renderPanel()
    const card = document.querySelector('[data-testid="bucket-card-e1"]') as HTMLElement
    expect(card).not.toBeNull()
    fireEvent.click(card)

    // Single getState snapshot proves the drill-collapse contract atomically.
    const s = useViewerStore.getState()
    // selectedNodeIds collapses to Set([e1])
    expect(s.selectedNodeIds).toBeInstanceOf(Set)
    expect(s.selectedNodeIds.size).toBe(1)
    expect(s.selectedNodeIds.has('e1')).toBe(true)
    // selectedBucketKeys empties
    expect(s.selectedBucketKeys.size).toBe(0)
    // focal = e1
    expect(s.focalNodeId).toBe('e1')
    expect(s.focalBucketKey).toBeNull()
    // source = 'history'
    expect(s.selectionSource).toBe('history')
    // LSL slice fully cleared (drill is a fresh selection scope)
    expect(s.lslSessionFilter).toEqual([])
    expect(s.lslFilterEntityIds).toBeNull()
    // pathToSelected reset
    expect(s.pathToSelected.size).toBe(0)
    // highlightedRowKey = e1
    expect(s.highlightedRowKey).toBe('e1')
  })

  test('Test 5: Logger discipline — no raw console.* in BucketCardList.tsx source', () => {
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/panels/BucketCardList.tsx'),
      'utf8',
    )
    expect(src).not.toMatch(/console\.(log|warn|error|info|debug|trace)/)
  })

  test('Test 6 (Locked Contract #5): zero inline useViewerStore.setState({ in BucketCardList.tsx', () => {
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/panels/BucketCardList.tsx'),
      'utf8',
    )
    // Locked Contract #5 — the only path to write selection from this file
    // is the canonical setSelection action. Any future inline setState
    // regression would re-open the contract.
    expect(src).not.toMatch(/useViewerStore\.setState\s*\(\s*\{/)
    // Positive assertion: the canonical setSelection call IS present.
    expect(src).toMatch(/useViewerStore\.getState\(\)\.setSelection\s*\(/)
  })

  test('Test 7: source-grep — data-testid markers present (outer + per-card)', () => {
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/panels/BucketCardList.tsx'),
      'utf8',
    )
    // Outer container marker.
    expect(src).toMatch(/data-testid=["']bucket-card-list["']/)
    // Per-card marker (template literal form `bucket-card-${...}`).
    expect(src).toMatch(/data-testid=\{`bucket-card-\$\{/)
  })
})
