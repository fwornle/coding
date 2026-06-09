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
