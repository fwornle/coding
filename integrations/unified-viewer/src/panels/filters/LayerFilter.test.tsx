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

  test('clicking Evidence calls store.toggleLayer with "evidence"', () => {
    render(<LayerFilter entities={[]} />)
    const wrapper = screen.getByTestId('filter-layer-evidence')
    const cb = wrapper.querySelector('button[role="checkbox"]') as HTMLElement
    fireEvent.click(cb)
    expect(useViewerStore.getState().selectedLayers).toContain('evidence')
  })

  test('clicking Pattern calls store.toggleLayer with "pattern"', () => {
    render(<LayerFilter entities={[]} />)
    const wrapper = screen.getByTestId('filter-layer-pattern')
    const cb = wrapper.querySelector('button[role="checkbox"]') as HTMLElement
    fireEvent.click(cb)
    expect(useViewerStore.getState().selectedLayers).toContain('pattern')
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
})
