// PATTERN SOURCE: 55-08-PLAN.md Task 3 + 55-PATTERNS.md § GraphToggles
//
// 2026-06-19: the four no-op toggles (Show All Relations / Labels / Show
// Clusters / Merged Only) were removed — none were consumed by the canvas. Only
// the two FUNCTIONAL toggles remain: Hide Documentation (hideDocNodes) and Show
// debug entity types (showDebugEntityTypes).

import { describe, test, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { useViewerStore } from '@/store/viewer-store'
import { GraphToggles } from './GraphToggles'

describe('GraphToggles', () => {
  beforeEach(() => {
    useViewerStore.setState({ hideDocNodes: false })
    cleanup()
  })

  test('renders only the two functional toggles (no dead no-op rows)', () => {
    render(<GraphToggles />)
    expect(screen.getByLabelText('Hide Documentation')).toBeInTheDocument()
    expect(screen.getByLabelText('Show debug entity types')).toBeInTheDocument()
    // Removed no-ops must NOT render.
    expect(screen.queryByLabelText('Show All Relations')).toBeNull()
    expect(screen.queryByLabelText('Show Clusters')).toBeNull()
    expect(screen.queryByLabelText('Merged Only')).toBeNull()
    expect(screen.queryByLabelText('Labels')).toBeNull()
  })

  test('clicking Hide Documentation calls toggleHideDocNodes', () => {
    render(<GraphToggles />)
    const wrapper = screen.getByTestId('graph-toggle-hide-doc')
    const cb = wrapper.querySelector('button[role="checkbox"]') as HTMLElement
    fireEvent.click(cb)
    expect(useViewerStore.getState().hideDocNodes).toBe(true)
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
// ----------------------------------------------------------------------------

describe('GraphToggles — Phase 60-03 Show debug entity types row', () => {
  beforeEach(() => {
    useViewerStore.setState({ hideDocNodes: false, showDebugEntityTypes: false })
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
    useViewerStore.setState({ showDebugEntityTypes: true })
    render(<GraphToggles />)
    const hint = screen.getByTestId('graph-toggle-debug-hint')
    expect(hint.textContent).toBe(
      'Architecture-bleed shield: these types should not appear in production VKB. Toggle ON only for debugging.',
    )
    expect(hint.className).toMatch(/text-\[10px\]/)
    expect(hint.className).toMatch(/ml-6/)
    expect(hint.className).toMatch(/leading-tight/)
    expect(hint.className).toMatch(/italic/)
  })

  test('Test 4 (D-11 no persistence — surface proxy): rendered DOM carries no data-persist attribute', () => {
    useViewerStore.setState({ showDebugEntityTypes: true })
    render(<GraphToggles />)
    const wrapper = screen.getByTestId('graph-toggle-debug-entity-types')
    expect(wrapper.getAttribute('data-persist')).toBeNull()
    expect(wrapper.outerHTML).not.toMatch(/localStorage/i)
  })
})
