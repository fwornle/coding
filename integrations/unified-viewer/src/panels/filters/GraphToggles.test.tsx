// PATTERN SOURCE: 55-08-PLAN.md Task 3 + 55-PATTERNS.md § GraphToggles
//
// VOKB analog: _work/.../viewer/src/components/Filters/LegendPanel.tsx:14-80
// (toggle block ONLY — not the legend body)
//
// Verifies:
//   - 4 top-level checkboxes with verbatim labels per UI-SPEC §5
//   - "Labels" nested sub-toggle appears only when showEdges is true
//   - Each toggle wires to the matching Zustand action
//   - Italic hint text uses text-[10px] ml-6 leading-tight (verbatim VOKB)

import { describe, test, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { useViewerStore } from '@/store/viewer-store'
import { GraphToggles } from './GraphToggles'

describe('GraphToggles', () => {
  beforeEach(() => {
    useViewerStore.setState({
      showEdges: false,
      showRelationLabels: false,
      showClusters: false,
      showMergedOnly: false,
      hideDocNodes: false,
    })
    cleanup()
  })

  test('renders 4 top-level checkboxes with verbatim VOKB labels (UI-SPEC §5)', () => {
    render(<GraphToggles />)
    expect(screen.getByLabelText('Show All Relations')).toBeInTheDocument()
    expect(screen.getByLabelText('Show Clusters')).toBeInTheDocument()
    expect(screen.getByLabelText('Merged Only')).toBeInTheDocument()
    expect(screen.getByLabelText('Hide Documentation')).toBeInTheDocument()
  })

  test('nested "Labels" sub-checkbox is HIDDEN when showEdges is false', () => {
    render(<GraphToggles />)
    expect(screen.queryByLabelText('Labels')).toBeNull()
  })

  test('nested "Labels" sub-checkbox APPEARS when showEdges is true', () => {
    useViewerStore.setState({ showEdges: true })
    render(<GraphToggles />)
    expect(screen.getByLabelText('Labels')).toBeInTheDocument()
  })

  test('clicking Show All Relations calls toggleShowEdges', () => {
    render(<GraphToggles />)
    expect(useViewerStore.getState().showEdges).toBe(false)
    const wrapper = screen.getByTestId('graph-toggle-show-edges')
    const cb = wrapper.querySelector('button[role="checkbox"]') as HTMLElement
    fireEvent.click(cb)
    expect(useViewerStore.getState().showEdges).toBe(true)
  })

  test('clicking Show Clusters calls toggleShowClusters', () => {
    render(<GraphToggles />)
    const wrapper = screen.getByTestId('graph-toggle-show-clusters')
    const cb = wrapper.querySelector('button[role="checkbox"]') as HTMLElement
    fireEvent.click(cb)
    expect(useViewerStore.getState().showClusters).toBe(true)
  })

  test('clicking Merged Only calls toggleShowMergedOnly', () => {
    render(<GraphToggles />)
    const wrapper = screen.getByTestId('graph-toggle-merged-only')
    const cb = wrapper.querySelector('button[role="checkbox"]') as HTMLElement
    fireEvent.click(cb)
    expect(useViewerStore.getState().showMergedOnly).toBe(true)
  })

  test('clicking Hide Documentation calls toggleHideDocNodes', () => {
    render(<GraphToggles />)
    const wrapper = screen.getByTestId('graph-toggle-hide-doc')
    const cb = wrapper.querySelector('button[role="checkbox"]') as HTMLElement
    fireEvent.click(cb)
    expect(useViewerStore.getState().hideDocNodes).toBe(true)
  })

  test('clicking nested Labels (with showEdges on) calls toggleShowRelationLabels', () => {
    useViewerStore.setState({ showEdges: true })
    render(<GraphToggles />)
    const wrapper = screen.getByTestId('graph-toggle-relation-labels')
    const cb = wrapper.querySelector('button[role="checkbox"]') as HTMLElement
    fireEvent.click(cb)
    expect(useViewerStore.getState().showRelationLabels).toBe(true)
  })

  test('italic hint under Show Clusters matches verbatim VOKB copy when showClusters is on', () => {
    useViewerStore.setState({ showClusters: true })
    render(<GraphToggles />)
    const hint = screen.getByTestId('graph-toggle-clusters-hint')
    expect(hint.textContent).toBe(
      'Halos = connectivity clusters (densely linked groups)',
    )
    // Tailwind hint must use text-[10px] ml-6 leading-tight (UI-SPEC §3)
    expect(hint.className).toMatch(/text-\[10px\]/)
    expect(hint.className).toMatch(/ml-6/)
    expect(hint.className).toMatch(/leading-tight/)
  })

  test('italic hint under Merged Only appears verbatim when showMergedOnly is on', () => {
    useViewerStore.setState({ showMergedOnly: true })
    render(<GraphToggles />)
    const hint = screen.getByTestId('graph-toggle-merged-hint')
    expect(hint.textContent).toBe(
      'Nodes with content from multiple ingestion runs',
    )
  })

  test('italic hint under Hide Documentation appears verbatim when hideDocNodes is on', () => {
    useViewerStore.setState({ hideDocNodes: true })
    render(<GraphToggles />)
    const hint = screen.getByTestId('graph-toggle-hide-doc-hint')
    expect(hint.textContent).toMatch(/business\/doc nodes/)
  })
})

// ----------------------------------------------------------------------------
// Phase 60 Plan 03 (G3) — "Show debug entity types" row.
//
// PATTERN SOURCE: 60-03-PLAN.md Task 2 <behavior>
//
// Decisions:
//   - D-09: visibility-predicate keeps Observation/Digest excluded by default.
//           Operator flips this toggle to re-enable for debugging.
//   - D-10: Row label `Show debug entity types (Observation, Digest)` with
//           italic hint copy `Architecture-bleed shield: these types should
//           not appear in production VKB. Toggle ON only for debugging.`
//   - D-11: NOT persisted (resets every page load).
//   - D-21: micro-type (text-[10px] / ml-6 / italic) preserved verbatim.
// ----------------------------------------------------------------------------

describe('GraphToggles — Phase 60-03 Show debug entity types row', () => {
  beforeEach(() => {
    useViewerStore.setState({
      showEdges: false,
      showRelationLabels: false,
      showClusters: false,
      showMergedOnly: false,
      hideDocNodes: false,
      showDebugEntityTypes: false,
    } as unknown as Partial<Parameters<typeof useViewerStore.setState>[0]>)
    cleanup()
  })

  test('Test 1: default render shows "Show debug entity types (Observation, Digest)" with unchecked checkbox', () => {
    render(<GraphToggles />)
    const wrapper = screen.getByTestId('graph-toggle-debug-entity-types')
    expect(wrapper).toBeInTheDocument()
    expect(wrapper.textContent).toContain('Show debug entity types (Observation, Digest)')
    const cb = wrapper.querySelector('button[role="checkbox"]') as HTMLElement
    expect(cb.getAttribute('aria-checked') === 'true').toBe(false)
  })

  test('Test 2: clicking the checkbox flips showDebugEntityTypes false → true', () => {
    render(<GraphToggles />)
    expect(useViewerStore.getState().showDebugEntityTypes).toBe(false)
    const wrapper = screen.getByTestId('graph-toggle-debug-entity-types')
    const cb = wrapper.querySelector('button[role="checkbox"]') as HTMLElement
    fireEvent.click(cb)
    expect(useViewerStore.getState().showDebugEntityTypes).toBe(true)
  })

  test('Test 3 (D-10 tooltip): hint paragraph appears when ON with verbatim Architecture-bleed copy', () => {
    useViewerStore.setState({ showDebugEntityTypes: true } as unknown as Partial<Parameters<typeof useViewerStore.setState>[0]>)
    render(<GraphToggles />)
    const hint = screen.getByTestId('graph-toggle-debug-hint')
    expect(hint.textContent).toBe(
      'Architecture-bleed shield: these types should not appear in production VKB. Toggle ON only for debugging.',
    )
    // D-21 micro-type — text-[10px] / ml-6 / italic preserved verbatim.
    expect(hint.className).toMatch(/text-\[10px\]/)
    expect(hint.className).toMatch(/ml-6/)
    expect(hint.className).toMatch(/leading-tight/)
    expect(hint.className).toMatch(/italic/)
  })

  test('Test 4 (D-11 no persistence — surface proxy): rendered DOM carries no data-persist attribute', () => {
    useViewerStore.setState({ showDebugEntityTypes: true } as unknown as Partial<Parameters<typeof useViewerStore.setState>[0]>)
    render(<GraphToggles />)
    const wrapper = screen.getByTestId('graph-toggle-debug-entity-types')
    // No localStorage wiring should leak into the rendered DOM.
    expect(wrapper.getAttribute('data-persist')).toBeNull()
    expect(wrapper.outerHTML).not.toMatch(/localStorage/i)
  })
})
