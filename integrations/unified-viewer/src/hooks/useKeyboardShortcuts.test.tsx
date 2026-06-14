// PATTERN SOURCE: 45-03-PLAN.md Task 1 Keyboard Test 1-5 + T-45-03-04 mitigation
//   + 55-11-PLAN.md Task 1 <behavior> (hook extension: registerSequence)
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
//
// Phase 55-11 extension (Task 1):
//   - registerSequence('g','h', handler) fires handler within 800ms window
//   - sequence does NOT fire when interval > 800ms
//   - sequence does NOT fire when a third key intercedes
//   - sequence is SKIPPED when input is focused (typing 'github' safe)
//   - unregister fn removes the binding

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { useKeyboardShortcuts, _resetSequenceRegistryForTests } from './useKeyboardShortcuts'
import { useViewerStore } from '@/store/viewer-store'

interface HarnessProps {
  onOpenHelpDialog?: () => void
  onCloseHelpDialog?: () => boolean
  inputFocused?: boolean
  onReady?: (handle: ReturnType<typeof useKeyboardShortcuts>) => void
}

function Harness({
  onOpenHelpDialog = vi.fn(),
  onCloseHelpDialog = vi.fn(() => false),
  inputFocused,
  onReady,
}: HarnessProps) {
  const handle = useKeyboardShortcuts({
    onOpenHelpDialog,
    onCloseHelpDialog,
  })
  const { registerSearchInputRef } = handle
  const [inputRef, setInputRef] = useState<HTMLInputElement | null>(null)
  useEffect(() => {
    registerSearchInputRef(inputRef)
  }, [inputRef, registerSearchInputRef])
  useEffect(() => {
    if (inputFocused && inputRef) inputRef.focus()
  }, [inputFocused, inputRef])
  useEffect(() => {
    onReady?.(handle)
    // We only want this to run once with the stable handle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <input ref={setInputRef} data-testid="search-input" />
}

describe('useKeyboardShortcuts', () => {
  beforeEach(() => {
    _resetSequenceRegistryForTests()
    // 2026-06-13 (Phase 56.1 Plan 05): selectedNodeId is gone — multi-set.
    useViewerStore.setState({
      focalNodeId: null,
      selectedNodeIds: new Set<string>(),
      selectedEdgeId: null,
      searchQuery: '',
      visibleLevels: new Set([0, 1, 2, 3]),
      selectedClasses: new Set<string>(),
      theme: 'light',
      filterRailCollapsed: false,
    })
  })

  afterEach(() => {
    _resetSequenceRegistryForTests()
    vi.useRealTimers()
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
    useViewerStore.getState().setSelectedNode('node-42')
    render(<Harness />)
    expect(useViewerStore.getState().focalNodeId).toBe('node-42')
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    act(() => {
      document.dispatchEvent(event)
    })
    expect(useViewerStore.getState().focalNodeId).toBeNull()
  })

  test('Test 3b: Esc consults onCloseHelpDialog FIRST (before deselecting)', () => {
    useViewerStore.getState().setSelectedNode('node-42')
    const onCloseHelpDialog = vi.fn(() => true)
    render(<Harness onCloseHelpDialog={onCloseHelpDialog} />)
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    act(() => {
      document.dispatchEvent(event)
    })
    expect(onCloseHelpDialog).toHaveBeenCalled()
    // selected node UNCHANGED because the dialog claim was made first
    expect(useViewerStore.getState().focalNodeId).toBe('node-42')
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
    useViewerStore.getState().setSelectedNode('node-99')
    const { getByTestId } = render(<Harness inputFocused />)
    const input = getByTestId('search-input') as HTMLInputElement
    expect(document.activeElement).toBe(input)
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
    expect(document.activeElement).not.toBe(input)
    // selected node NOT cleared on this first Esc — only on the next one
    expect(useViewerStore.getState().focalNodeId).toBe('node-99')
  })

  // ---- Phase 55-11 Task 1: registerSequence two-key sequence support ----

  test('Test 7 (Phase 55-11): registerSequence(g, h) fires handler when g then h pressed within 800ms', () => {
    vi.useFakeTimers()
    const handler = vi.fn()
    let unregister: (() => void) | undefined
    render(
      <Harness
        onReady={(h) => {
          unregister = h.registerSequence('g', 'h', handler)
        }}
      />,
    )
    expect(handler).not.toHaveBeenCalled()
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true }))
    })
    expect(handler).not.toHaveBeenCalled()
    // advance a bit but stay inside the window
    act(() => {
      vi.advanceTimersByTime(200)
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }))
    })
    expect(handler).toHaveBeenCalledTimes(1)
    unregister?.()
  })

  test('Test 8 (Phase 55-11): registerSequence does NOT fire when interval > 800ms', () => {
    vi.useFakeTimers()
    const handler = vi.fn()
    render(
      <Harness
        onReady={(h) => {
          h.registerSequence('g', 'h', handler)
        }}
      />,
    )
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true }))
    })
    act(() => {
      vi.advanceTimersByTime(1000)
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }))
    })
    expect(handler).not.toHaveBeenCalled()
  })

  test('Test 9 (Phase 55-11): registerSequence does NOT fire when third key intercedes', () => {
    vi.useFakeTimers()
    const handler = vi.fn()
    render(
      <Harness
        onReady={(h) => {
          h.registerSequence('g', 'h', handler)
        }}
      />,
    )
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true }))
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }))
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }))
    })
    expect(handler).not.toHaveBeenCalled()
  })

  test('Test 10 (Phase 55-11): registerSequence input-focus guard — typing "gh" into search input does NOT fire', () => {
    const handler = vi.fn()
    const { getByTestId } = render(
      <Harness
        inputFocused
        onReady={(h) => {
          h.registerSequence('g', 'h', handler)
        }}
      />,
    )
    const input = getByTestId('search-input') as HTMLInputElement
    expect(document.activeElement).toBe(input)
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }))
    })
    expect(handler).not.toHaveBeenCalled()
  })

  test('Test 11 (Phase 55-11): unregister fn removes the binding', () => {
    vi.useFakeTimers()
    const handler = vi.fn()
    let unregister: (() => void) | undefined
    render(
      <Harness
        onReady={(h) => {
          unregister = h.registerSequence('g', 'h', handler)
        }}
      />,
    )
    // First sequence should fire
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true }))
      vi.advanceTimersByTime(100)
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }))
    })
    expect(handler).toHaveBeenCalledTimes(1)
    // Unregister, then sequence should NOT fire again
    unregister?.()
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true }))
      vi.advanceTimersByTime(100)
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }))
    })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  // ---- Phase 56 Task 2: Esc routes through clearSelection() ----
  //
  // CONTEXT.md decision: "Esc + click-background clears selection in all three
  // panes simultaneously. Implementation must go through the store, not
  // per-pane handlers." Test 12 asserts the cascade — selecting a node AND
  // setting an LSL filter, then pressing Esc, leaves BOTH cleared. Pre-
  // Phase-56 the Esc handler only called setSelectedNode(null) and the LSL
  // filter survived; Phase 56 routes through clearSelection() so the entire
  // selection slice + LSL filter clear together.

  test('Test 12 (Phase 56): Esc with selectedNodeId + lslSessionFilter set → BOTH cleared (cascade through clearSelection)', () => {
    // 2026-06-13 (Phase 56.1 Plan 05): single-selection fields are gone.
    useViewerStore.getState().setSelectedNode('node-42')
    useViewerStore.setState({
      lslSessionFilter: ['sess-keep'],
      lslFilterEntityIds: new Set<string>(['x', 'y']),
      selectionSource: 'graph',
      highlightedRowKey: 'row-42',
      selectedBucketKeys: new Set<string>(['sess-42|2026-06-13T11:00:00Z']),
      focalBucketKey: 'sess-42|2026-06-13T11:00:00Z',
    })
    render(<Harness />)
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      )
    })
    const s = useViewerStore.getState()
    expect(s.focalNodeId).toBeNull()
    expect(s.lslSessionFilter).toEqual([])
    expect(s.lslFilterEntityIds).toBeNull()
    expect(s.selectionSource).toBeNull()
    expect(s.highlightedRowKey).toBeNull()
    expect(s.focalBucketKey).toBeNull()
  })

  test('Test 13 (Phase 56, CR-03 review fix): Esc with no selection at all: clearSelection() NOT called (guard preserved)', () => {
    // The "Esc on already-cleared state is a no-op" semantic (no Logger
    // spam, no preventDefault) must survive the CR-03 widening. After CR-03
    // the guard checks selectedNodeId / selectedSessionId / selectedEdgeId /
    // lslSessionFilter / lslFilterEntityIds — Esc only fires clearSelection()
    // when AT LEAST ONE of these is non-null/non-empty. With everything
    // cleared, clearSelection() must not fire. We verify by inspecting that
    // the dispatched Escape event was NOT defaultPrevented (the handler's
    // `event.preventDefault()` lives inside the `if (hasSelection)` arm).
    // 2026-06-13 (Phase 56.1 Plan 05): single-selection fields are gone.
    useViewerStore.getState().setSelectedNode(null)
    useViewerStore.setState({
      selectedEdgeId: null,
      selectedBucketKeys: new Set<string>(),
      focalBucketKey: null,
      lslSessionFilter: [],
      lslFilterEntityIds: null,
    })
    render(<Harness />)
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    act(() => {
      document.dispatchEvent(event)
    })
    // Guard skipped the clear, so preventDefault was never called.
    expect(event.defaultPrevented).toBe(false)
    // Sanity: state still fully empty (clearSelection did not fire).
    const s = useViewerStore.getState()
    expect(s.focalNodeId).toBeNull()
    expect(s.lslSessionFilter).toEqual([])
    expect(s.lslFilterEntityIds).toBeNull()
  })

  test('Test 14 (Phase 56): Esc inside focused search input: clears focus first, does NOT clear selection (BC preserved)', () => {
    // 2026-06-13 (Phase 56.1 Plan 05): selectedNodeId is gone — multi-set.
    useViewerStore.getState().setSelectedNode('node-99')
    useViewerStore.setState({
      lslSessionFilter: ['preserve-me'],
    })
    const { getByTestId } = render(<Harness inputFocused />)
    const input = getByTestId('search-input') as HTMLInputElement
    expect(document.activeElement).toBe(input)
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      )
    })
    // Input blurred (Phase 55 behaviour)
    expect(document.activeElement).not.toBe(input)
    // Selection slice + LSL filter unchanged on first Esc
    expect(useViewerStore.getState().focalNodeId).toBe('node-99')
    expect(useViewerStore.getState().lslSessionFilter).toEqual(['preserve-me'])
  })

  // ---- CR-03 review fix: sidebar-only mode (Phase 56-04 round 4) ----
  //
  // When a user clicks a timeline tick whose entities have NO graph-visible
  // ancestor, the strip writes selectedSessionId / selectedSessionStartAt /
  // lslFilterEntityIds / lslSessionFilter but leaves `selectedNodeId === null`
  // (no graph node to focus). Pre-CR-03 the Esc handler guarded only on
  // `selectedNodeId !== null` so Esc was a no-op in this mode — the user was
  // stuck in the filtered state with no keyboard escape. The widened guard
  // now also checks selectedSessionId / selectedEdgeId / lslSessionFilter /
  // lslFilterEntityIds; Esc must clear every field via clearSelection().

  test('Test 15 (CR-03 review fix): Esc in sidebar-only mode (selectedNodeId=null, session+LSL fields set) clears EVERYTHING', () => {
    // 2026-06-13 (Phase 56.1 Plan 05): single-selection fields are gone.
    // Seed the bucketKey composite to model the sidebar-only mode.
    useViewerStore.getState().setSelectedNode(null)
    useViewerStore.setState({
      selectedBucketKeys: new Set<string>(['sess-X|2026-06-13T11:00:00Z']),
      focalBucketKey: 'sess-X|2026-06-13T11:00:00Z',
      lslFilterEntityIds: new Set<string>(['e1', 'e2']),
      lslSessionFilter: ['sess-X'],
    })
    render(<Harness />)
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    act(() => {
      document.dispatchEvent(event)
    })
    // Esc fired the clear path even though selectedNodeId was already null.
    expect(event.defaultPrevented).toBe(true)
    const s = useViewerStore.getState()
    // clearSelection() empties every field per viewer-store.ts:373-385.
    expect(s.focalNodeId).toBeNull()
    expect(s.focalBucketKey).toBeNull()
    expect(s.focalBucketKey).toBeNull()
    expect(s.lslSessionFilter).toEqual([])
    expect(s.lslFilterEntityIds).toBeNull()
  })
})
