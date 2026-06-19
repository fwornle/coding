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

  test('Test 4: card click drills via setSelection (nodeIds=Set([id]) + bucketKeys empty + focal=id + source=history + LSL slice preserved + pre-drill snapshot pushed to selectionHistory)', () => {
    // 2026-06-14 (Plan 06 gap-closure — Decision 1 + Decision 3): drill
    // semantics evolved:
    //   - Decision 1: drill writers pass pushHistory: true so the pre-drill
    //                 Layer 1 state is captured into `selectionHistory` for
    //                 Esc/X to restore.
    //   - Decision 3: drill PRESERVES `lslFilterEntityIds` and
    //                 `lslSessionFilter` to keep `visibleEntities`
    //                 reference-stable so the D3 main render does NOT
    //                 rebuild + auto-fit (the "zoom all the way out, fade
    //                 everything" regression the operator caught).
    // Both invariants asserted below.
    const preBucketKeys = new Set<string>(['sess-X|2026-06-13T11:00:00Z'])
    const preLslIds = new Set<string>(['e1', 'e2'])
    const preLslSessionFilter = ['sess-X']
    useViewerStore.setState({
      selectionSource: 'timeline',
      selectedBucketKeys: preBucketKeys,
      focalBucketKey: 'sess-X|2026-06-13T11:00:00Z',
      lslFilterEntityIds: preLslIds,
      lslSessionFilter: preLslSessionFilter,
      // Layer 1 state must have at least one set populated for shouldPush
      // to fire; selectedBucketKeys above satisfies that.
      selectionHistory: null,
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
    // Decision 3: LSL slice PRESERVED at pre-drill values (NOT cleared).
    // This is the key contract change from Phase 56.1 Plan 04 — the drill
    // is purely a selection-slice mutation; the visibility-narrowing LSL
    // filter stays so the D3 graph does not rebuild / re-auto-fit.
    expect(s.lslSessionFilter).toEqual(preLslSessionFilter)
    expect(s.lslFilterEntityIds).toBe(preLslIds)
    // pathToSelected reset (selection changed, ancestry recomputes)
    expect(s.pathToSelected.size).toBe(0)
    // highlightedRowKey = e1
    expect(s.highlightedRowKey).toBe('e1')
    // Decision 1: pre-drill snapshot pushed to selectionHistory so Esc/X
    // can pop back to Layer 1.
    expect(s.selectionHistory).not.toBeNull()
    expect(s.selectionHistory?.selectionSource).toBe('timeline')
    expect(s.selectionHistory?.selectedBucketKeys).toBe(preBucketKeys)
    expect(s.selectionHistory?.lslFilterEntityIds).toBe(preLslIds)
  })

  test('Test 4b [Plan 06 Decision 1 selection-history stack — drill is reversible via popSelection]: after card-click drill, popSelection() restores the exact pre-drill multi-set state and clears selectionHistory', () => {
    // Acceptance gate for the one-step-back contract end-to-end through
    // BucketCardList: seed Layer 1 → drill via card → popSelection()
    // restores Layer 1. The store-level popSelection test in
    // viewer-store.test.ts covers the action in isolation; this test
    // proves the BucketCardList integration emits the right setSelection
    // payload (pushHistory: true) so the pop works in the live UI path.
    const preBucketKeys = new Set<string>(['sess-X|2026-06-13T11:00:00Z'])
    const preLslIds = new Set<string>(['e1', 'e2'])
    useViewerStore.setState({
      selectionSource: 'timeline',
      selectedBucketKeys: preBucketKeys,
      focalBucketKey: 'sess-X|2026-06-13T11:00:00Z',
      lslFilterEntityIds: preLslIds,
      lslSessionFilter: ['sess-X'],
      selectionHistory: null,
    })
    renderPanel()
    const card = document.querySelector('[data-testid="bucket-card-e1"]') as HTMLElement
    fireEvent.click(card)

    // Post-drill: history populated.
    expect(useViewerStore.getState().selectionHistory).not.toBeNull()
    expect(useViewerStore.getState().selectionSource).toBe('history')

    // Pop: restore Layer 1.
    const popped = useViewerStore.getState().popSelection()
    expect(popped).toBe(true)

    const s = useViewerStore.getState()
    // Restored exactly to Layer 1.
    expect(s.selectionSource).toBe('timeline')
    expect(s.selectedBucketKeys).toBe(preBucketKeys)
    expect(s.focalBucketKey).toBe('sess-X|2026-06-13T11:00:00Z')
    expect(s.lslFilterEntityIds).toBe(preLslIds)
    // Stack drained to one-deep: history slot cleared after pop.
    expect(s.selectionHistory).toBeNull()
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

  // ── Plan 60-08 Gap D — Selected-header visible/hidden breakdown ──────────
  // mockEntities: e1=Insight (visible), e2=Observation + e3=Digest (hidden by
  // the showDebugEntityTypes shield when OFF). Timeline mode selects via
  // lslFilterEntityIds. selectedClasses must be populated for the visibility
  // predicate to count anything visible (empty Set = nothing visible).
  function selectTimeline(ids: string[]) {
    useViewerStore.setState({
      selectionSource: 'timeline',
      selectedBucketKeys: new Set<string>(['sess-X|2026-06-13T11:00:00Z']),
      lslFilterEntityIds: new Set<string>(ids),
      selectedClasses: new Set<string>(['Insight', 'Observation', 'Digest']),
    })
  }

  function selectedCountText(): string {
    return document.querySelector('[data-testid="selected-count"]')?.textContent ?? ''
  }

  test('Gap D Test 1: breakdown when some selected are hidden (3 → 1 visible, 2 hidden)', () => {
    useViewerStore.setState({ showDebugEntityTypes: false })
    selectTimeline(['e1', 'e2', 'e3'])
    renderPanel()
    const txt = selectedCountText().replace(/\s+/g, ' ')
    expect(txt).toContain('3 items')
    expect(txt).toContain('1 visible')
    expect(txt).toContain('2 hidden by')
    expect(txt).toContain('Show debug entity types')
  })

  test('Gap D Test 2: no breakdown when all visible (debug toggle ON)', () => {
    useViewerStore.setState({ showDebugEntityTypes: true })
    selectTimeline(['e1', 'e2', 'e3'])
    renderPanel()
    const txt = selectedCountText().replace(/\s+/g, ' ').trim()
    expect(txt).toBe('3 items')
    expect(txt).not.toContain('hidden by')
  })

  test('Gap D Test 3: single visible item → "1 item", no breakdown', () => {
    useViewerStore.setState({ showDebugEntityTypes: false })
    selectTimeline(['e1'])
    renderPanel()
    const txt = selectedCountText().replace(/\s+/g, ' ').trim()
    expect(txt).toBe('1 item')
  })

  test('Gap D Test 4: all hidden → "0 visible · N hidden" AND all rows still render', () => {
    useViewerStore.setState({ showDebugEntityTypes: false })
    selectTimeline(['e2', 'e3']) // both Observation/Digest → hidden by shield
    renderPanel()
    const txt = selectedCountText().replace(/\s+/g, ' ')
    expect(txt).toContain('2 items')
    expect(txt).toContain('0 visible')
    expect(txt).toContain('2 hidden by')
    // We do NOT drop hidden rows — operator still needs to see them.
    expect(document.querySelector('[data-testid="bucket-card-e2"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="bucket-card-e3"]')).not.toBeNull()
  })

  test('Gap D Test 5: split recomputes when showDebugEntityTypes flips', () => {
    useViewerStore.setState({ showDebugEntityTypes: false })
    selectTimeline(['e1', 'e2', 'e3'])
    const { rerender } = renderPanel()
    expect(selectedCountText().replace(/\s+/g, ' ')).toContain('1 visible')
    useViewerStore.setState({ showDebugEntityTypes: true })
    const apiClient = { base: 'http://test.local' } as ApiClient
    rerender(<BucketCardList apiClient={apiClient} system="coding" />)
    expect(selectedCountText().replace(/\s+/g, ' ').trim()).toBe('3 items')
  })

  test('Gap D Test 6: source uses shared useVisibleEntityIds selector', () => {
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/panels/BucketCardList.tsx'),
      'utf8',
    )
    expect(src).toMatch(/useVisibleEntityIds/)
    expect(src).toMatch(/hidden by/)
  })

  // ── Plan 60-08 Gap E — row hover (sidebar → graph reciprocation) ─────────
  test('Gap E Test 1: row mouseenter sets hoveredNodeId; mouseleave clears it', () => {
    useViewerStore.setState({ showDebugEntityTypes: true })
    selectTimeline(['e1', 'e2', 'e3'])
    renderPanel()
    const row = document.querySelector('[data-testid="bucket-card-e1"]') as HTMLElement
    expect(row).not.toBeNull()
    fireEvent.mouseEnter(row)
    expect(useViewerStore.getState().hoveredNodeId).toBe('e1')
    fireEvent.mouseLeave(row)
    expect(useViewerStore.getState().hoveredNodeId).toBeNull()
  })

  test('Gap E Test 2: hovered row carries data-hovered="true"', () => {
    useViewerStore.setState({ showDebugEntityTypes: true, hoveredNodeId: 'e1' })
    selectTimeline(['e1', 'e2', 'e3'])
    renderPanel()
    const row = document.querySelector('[data-testid="bucket-card-e1"]') as HTMLElement
    expect(row.getAttribute('data-hovered')).toBe('true')
    // A non-hovered row has no data-hovered.
    const other = document.querySelector('[data-testid="bucket-card-e2"]') as HTMLElement
    expect(other.getAttribute('data-hovered')).toBeNull()
  })

  test('Gap E Test 3: hovering a row whose entity is hidden shows the inline hint', () => {
    // e2 = Observation → hidden by the shield when showDebugEntityTypes=false.
    useViewerStore.setState({ showDebugEntityTypes: false, hoveredNodeId: 'e2' })
    selectTimeline(['e1', 'e2', 'e3'])
    renderPanel()
    const hint = document.querySelector('[data-testid="bucket-card-hidden-hint-e2"]')
    expect(hint).not.toBeNull()
    expect(hint!.textContent).toMatch(/hidden — toggle Show debug entity types/)
  })

  test('Gap E Test 4: hovering a VISIBLE row shows NO hidden hint', () => {
    // e1 = Insight → visible. No hint even when hovered.
    useViewerStore.setState({ showDebugEntityTypes: false, hoveredNodeId: 'e1' })
    selectTimeline(['e1', 'e2', 'e3'])
    renderPanel()
    expect(document.querySelector('[data-testid="bucket-card-hidden-hint-e1"]')).toBeNull()
  })

  test('Gap E Test 5: row hover writes ONLY hoveredNodeId, leaves selection intact', () => {
    useViewerStore.setState({ showDebugEntityTypes: true })
    selectTimeline(['e1', 'e2', 'e3'])
    const preSelected = useViewerStore.getState().selectedNodeIds
    renderPanel()
    const row = document.querySelector('[data-testid="bucket-card-e1"]') as HTMLElement
    fireEvent.mouseEnter(row)
    // selection slice untouched (56.1 D-1).
    expect(useViewerStore.getState().selectedNodeIds).toBe(preSelected)
  })
})
