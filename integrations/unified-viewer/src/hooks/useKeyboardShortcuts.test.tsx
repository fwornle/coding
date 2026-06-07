// PATTERN SOURCE: 45-03-PLAN.md Task 1 Keyboard Test 1-5 + T-45-03-04 mitigation
//
// Test scaffolding renders a tiny harness component:
//   - mounts useKeyboardShortcuts with mockable bindings
//   - registers a search <input> ref so `/` has a target
//   - fires document keydown events via fireEvent.keyDown
//
// Then asserts on:
//   - searchInput.focus() called (or preventDefault asserted)
//   - bindings.onOpenHelpDialog() called
//   - bindings.onCloseHelpDialog() called when Esc inside an open dialog
//   - Zustand store mutations (setSelectedNode(null), setFilterRailCollapsed flip)
//   - Skip-when-input-focused: `/` typed INTO a focused input does NOT preventDefault.

import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, act } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { useKeyboardShortcuts } from './useKeyboardShortcuts'
import { useViewerStore } from '@/store/viewer-store'

interface HarnessProps {
  onOpenHelpDialog?: () => void
  onCloseHelpDialog?: () => boolean
  inputFocused?: boolean
}

function Harness({
  onOpenHelpDialog = vi.fn(),
  onCloseHelpDialog = vi.fn(() => false),
  inputFocused,
}: HarnessProps) {
  const { registerSearchInputRef } = useKeyboardShortcuts({
    onOpenHelpDialog,
    onCloseHelpDialog,
  })
  const [inputRef, setInputRef] = useState<HTMLInputElement | null>(null)
  useEffect(() => {
    registerSearchInputRef(inputRef)
  }, [inputRef, registerSearchInputRef])
  useEffect(() => {
    if (inputFocused && inputRef) inputRef.focus()
  }, [inputFocused, inputRef])
  return <input ref={setInputRef} data-testid="search-input" />
}

describe('useKeyboardShortcuts', () => {
  beforeEach(() => {
    useViewerStore.setState({
      selectedNodeId: null,
      selectedEdgeId: null,
      searchQuery: '',
      visibleLevels: new Set([0, 1, 2, 3]),
      selectedClasses: new Set<string>(),
      theme: 'light',
      filterRailCollapsed: false,
    })
  })

  test('Test 1: `/` while no input focused → search input gets focused, preventDefault asserted', () => {
    const { getByTestId } = render(<Harness />)
    const input = getByTestId('search-input') as HTMLInputElement
    expect(document.activeElement).not.toBe(input)
    const event = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true })
    act(() => {
      document.dispatchEvent(event)
    })
    expect(document.activeElement).toBe(input)
    expect(event.defaultPrevented).toBe(true)
  })

  test('Test 2: `/` while an INPUT is focused does NOT preventDefault (user typing slashes works)', () => {
    const { getByTestId } = render(<Harness inputFocused />)
    const input = getByTestId('search-input') as HTMLInputElement
    expect(document.activeElement).toBe(input)
    const event = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true })
    act(() => {
      input.dispatchEvent(event)
    })
    expect(event.defaultPrevented).toBe(false)
  })

  test('Test 3: Esc with no dialog open and no search focus clears selectedNodeId', () => {
    useViewerStore.setState({ selectedNodeId: 'node-42' })
    render(<Harness />)
    expect(useViewerStore.getState().selectedNodeId).toBe('node-42')
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    act(() => {
      document.dispatchEvent(event)
    })
    expect(useViewerStore.getState().selectedNodeId).toBeNull()
  })

  test('Test 3b: Esc consults onCloseHelpDialog FIRST (before deselecting)', () => {
    useViewerStore.setState({ selectedNodeId: 'node-42' })
    const onCloseHelpDialog = vi.fn(() => true)
    render(<Harness onCloseHelpDialog={onCloseHelpDialog} />)
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    act(() => {
      document.dispatchEvent(event)
    })
    expect(onCloseHelpDialog).toHaveBeenCalled()
    // selected node UNCHANGED because the dialog claim was made first
    expect(useViewerStore.getState().selectedNodeId).toBe('node-42')
  })

  test('Test 4: `?` opens KeyboardHelpDialog (binding called) with preventDefault', () => {
    const onOpenHelpDialog = vi.fn()
    render(<Harness onOpenHelpDialog={onOpenHelpDialog} />)
    const event = new KeyboardEvent('keydown', { key: '?', bubbles: true, cancelable: true })
    act(() => {
      document.dispatchEvent(event)
    })
    expect(onOpenHelpDialog).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
  })

  test('Test 5: `f` toggles filterRailCollapsed in the store', () => {
    render(<Harness />)
    expect(useViewerStore.getState().filterRailCollapsed).toBe(false)
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }))
    })
    expect(useViewerStore.getState().filterRailCollapsed).toBe(true)
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }))
    })
    expect(useViewerStore.getState().filterRailCollapsed).toBe(false)
  })

  test('Test 5b: `f` typed inside an input does NOT toggle (skip-when-input-focused)', () => {
    const { getByTestId } = render(<Harness inputFocused />)
    const input = getByTestId('search-input') as HTMLInputElement
    expect(document.activeElement).toBe(input)
    expect(useViewerStore.getState().filterRailCollapsed).toBe(false)
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }))
    })
    expect(useViewerStore.getState().filterRailCollapsed).toBe(false)
  })

  test('Test 6: Esc blurs focused search input (does NOT clear node selection on first press)', () => {
    useViewerStore.setState({ selectedNodeId: 'node-99' })
    const { getByTestId } = render(<Harness inputFocused />)
    const input = getByTestId('search-input') as HTMLInputElement
    expect(document.activeElement).toBe(input)
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
    expect(document.activeElement).not.toBe(input)
    // selected node NOT cleared on this first Esc — only on the next one
    expect(useViewerStore.getState().selectedNodeId).toBe('node-99')
  })
})
