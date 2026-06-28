// PATTERN SOURCE: 55-08-PLAN.md Task 1 + 55-PATTERNS.md § LayerFilter
//
// VOKB analog: _work/.../viewer/src/components/Filters/LayerFilter.tsx
//
// Verifies:
//   - Renders Evidence + Pattern checkboxes (verbatim VOKB labels)
//   - text-xs labels + text-[10px] count badges (micro-type exception)
//   - Empty selectedLayers = "all visible" semantic (isSelected returns true)
//   - Clicking Evidence calls store toggleLayer('evidence')
//   - Count badges derive from entities prop
//   - No raw console.* (Logger.info(FILTERS, ...) only)

import { describe, test, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { useViewerStore } from '@/store/viewer-store'
import type { Entity } from '@/api/ApiClient'
import { LayerFilter } from './LayerFilter'

describe('LayerFilter', () => {
  beforeEach(() => {
    // Reset store to known baseline
    useViewerStore.setState({
      selectedLayers: [],
    })
    cleanup()
  })

  test('renders Evidence and Pattern checkboxes with verbatim VOKB labels', () => {
    render(<LayerFilter entities={[]} />)
    expect(screen.getByText('Evidence')).toBeInTheDocument()
    expect(screen.getByText('Pattern')).toBeInTheDocument()
  })

  test('renders Layer group header', () => {
    render(<LayerFilter entities={[]} />)
    expect(screen.getByText('Layer')).toBeInTheDocument()
  })

  // 2026-06-12 store semantic (toggleLayer): empty selectedLayers === "all
  // visible". The first toggle materialises the full set ['evidence','pattern']
  // then removes the clicked layer — so unchecking Evidence leaves ['pattern'].
  test('clicking Evidence (from all-visible) unchecks it → selectedLayers === ["pattern"]', () => {
    render(<LayerFilter entities={[]} />)
    const wrapper = screen.getByTestId('filter-layer-evidence')
    const cb = wrapper.querySelector('button[role="checkbox"]') as HTMLElement
    fireEvent.click(cb)
    expect(useViewerStore.getState().selectedLayers).not.toContain('evidence')
    expect(useViewerStore.getState().selectedLayers).toContain('pattern')
  })

  test('clicking Pattern (from all-visible) unchecks it → selectedLayers === ["evidence"]', () => {
    render(<LayerFilter entities={[]} />)
    const wrapper = screen.getByTestId('filter-layer-pattern')
    const cb = wrapper.querySelector('button[role="checkbox"]') as HTMLElement
    fireEvent.click(cb)
    expect(useViewerStore.getState().selectedLayers).not.toContain('pattern')
    expect(useViewerStore.getState().selectedLayers).toContain('evidence')
  })

  test('empty selectedLayers === [] → isSelected("evidence") is true (all-visible semantic)', () => {
    render(<LayerFilter entities={[]} />)
    // With empty selection, both checkboxes show as checked
    const ev = screen.getByTestId('filter-layer-evidence')
    const evCb = ev.querySelector('button[role="checkbox"]') as HTMLElement
    expect(evCb.getAttribute('data-state')).toBe('checked')
    const pa = screen.getByTestId('filter-layer-pattern')
    const paCb = pa.querySelector('button[role="checkbox"]') as HTMLElement
    expect(paCb.getAttribute('data-state')).toBe('checked')
  })

  test('count badges derive from entities array (evidence:2, pattern:1)', () => {
    const entities = [
      { id: 'a', name: 'A', ontologyClass: 'X', layer: 'evidence' },
      { id: 'b', name: 'B', ontologyClass: 'X', layer: 'evidence' },
      { id: 'c', name: 'C', ontologyClass: 'X', layer: 'pattern' },
    ] as unknown as Entity[]
    render(<LayerFilter entities={entities} />)
    const evBadge = screen.getByTestId('filter-layer-count-evidence')
    expect(evBadge.textContent).toBe('2')
    const paBadge = screen.getByTestId('filter-layer-count-pattern')
    expect(paBadge.textContent).toBe('1')
    // micro-type exception preserved
    expect(evBadge.className).toMatch(/text-\[10px\]/)
  })

  test('label uses text-xs class (UI-SPEC §3 base body type)', () => {
    render(<LayerFilter entities={[]} />)
    const ev = screen.getByText('Evidence')
    expect(ev.className).toMatch(/text-xs/)
  })

  test('entities without explicit layer default to evidence (VOKB semantic)', () => {
    const entities = [
      { id: 'a', name: 'A', ontologyClass: 'X' }, // no layer field → evidence
      { id: 'b', name: 'B', ontologyClass: 'X', layer: 'pattern' },
    ] as unknown as Entity[]
    render(<LayerFilter entities={entities} />)
    expect(screen.getByTestId('filter-layer-count-evidence').textContent).toBe('1')
    expect(screen.getByTestId('filter-layer-count-pattern').textContent).toBe('1')
  })

  // ---- Phase 60 Plan 01 (G1) — deriveLayer-driven count badges ----

  test('count badges use deriveLayer with registry — Phase 57 L2 OnlineInsight counts as pattern', () => {
    const entities = [
      { id: 'a', name: 'A', ontologyClass: 'Component' },
      { id: 'b', name: 'B', ontologyClass: 'Pattern' },
      { id: 'c', name: 'C', ontologyClass: 'OnlineInsight' },
    ] as unknown as Entity[]
    const registry = [
      { name: 'OnlineInsight', parent: 'Insight' },
      { name: 'Insight', parent: null },
      { name: 'Pattern', parent: null },
      { name: 'Component', parent: null },
    ]
    render(<LayerFilter entities={entities} ontologyRegistry={registry} />)
    expect(screen.getByTestId('filter-layer-count-evidence').textContent).toBe('1')
    expect(screen.getByTestId('filter-layer-count-pattern').textContent).toBe('2')
  })

  test('explicit metadata.layer overrides ontologyClass inference (D-03)', () => {
    const entities = [
      // Pattern by class, but writer stamped layer=evidence — must count as evidence
      { id: 'a', name: 'A', ontologyClass: 'Pattern', metadata: { layer: 'evidence' } },
      { id: 'b', name: 'B', ontologyClass: 'Pattern' },
    ] as unknown as Entity[]
    render(<LayerFilter entities={entities} />)
    expect(screen.getByTestId('filter-layer-count-evidence').textContent).toBe('1')
    expect(screen.getByTestId('filter-layer-count-pattern').textContent).toBe('1')
  })

  test('LayerFilter count badges agree with visibility-predicate output (Evidence-OFF symmetry, VKBUI-01 regression)', async () => {
    // The badge and the predicate share deriveLayer — both should classify
    // these three entities the same way under registry-aware inference.
    const { deriveLayer } = await import('@/graph/layer')
    const { isEntityVisible } = await import('@/graph/visibility-predicate')
    const registry = [
      { name: 'OnlineInsight', parent: 'Insight' },
      { name: 'Insight', parent: null },
      { name: 'Pattern', parent: null },
      { name: 'Component', parent: null },
    ]
    const entities = [
      { id: 'a', name: 'A', ontologyClass: 'Component' },
      { id: 'b', name: 'B', ontologyClass: 'Pattern' },
      { id: 'c', name: 'C', ontologyClass: 'OnlineInsight' },
    ] as unknown as Entity[]
    // Render LayerFilter so the count badges run through deriveLayer.
    render(<LayerFilter entities={entities} ontologyRegistry={registry} />)
    const evCount = Number(screen.getByTestId('filter-layer-count-evidence').textContent)
    const paCount = Number(screen.getByTestId('filter-layer-count-pattern').textContent)
    // Independently classify via deriveLayer (badge source of truth).
    const evBadge = entities.filter((e) => deriveLayer(e as object, registry) === 'evidence').length
    const paBadge = entities.filter((e) => deriveLayer(e as object, registry) === 'pattern').length
    expect(evCount).toBe(evBadge)
    expect(paCount).toBe(paBadge)
    // Independently classify via the predicate (rendered-graph source of truth).
    const predicateFilters = (layer: 'evidence' | 'pattern') => ({
      searchQueryLowered: '',
      selectedTeams: new Set<string>(),
      learningSource: 'combined' as const,
      selectedLayers: [layer],
      hideDocNodes: false,
      selectedClasses: new Set<string>(['Component', 'Pattern', 'OnlineInsight']),
      visibleLevels: new Set<0 | 1 | 2 | 3>([0, 1, 2, 3]),
      lslFilterEntityIds: null,
      ontologyRegistry: registry,
      // Phase 60 Plan 03 (G3): VisibilityFilters now requires this flag.
      // Default false keeps the architecture-bleed shield ON.
      showDebugEntityTypes: false,
    })
    // Cast through unknown — the two Entity types diverge in `level`
    // (ApiClient: number; graph/types: 0|1|2|3). The fixtures above omit
    // `level` so both are structurally compatible at runtime.
    const evPredicate = entities.filter((e) =>
      isEntityVisible(e as unknown as import('@/graph/types').Entity, predicateFilters('evidence')),
    ).length
    const paPredicate = entities.filter((e) =>
      isEntityVisible(e as unknown as import('@/graph/types').Entity, predicateFilters('pattern')),
    ).length
    // The promise of VKBUI-01: badge counts === predicate-visible counts.
    expect(evPredicate).toBe(evBadge)
    expect(paPredicate).toBe(paBadge)
  })
})
