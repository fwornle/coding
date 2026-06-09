// PATTERN SOURCE: 45-03-PLAN.md Task 2 NavBar behavior tests
//
//   Test 1: Three Link components with SYSTEM_LABELS, active link styled
//           with font-bold + accent underline.
//   Test 2: Theme-toggle IconButton has aria-label='Toggle theme';
//           clicking toggles `theme` in the store.
//   Test 3: Keyboard-help IconButton has aria-label='Show keyboard shortcuts'
//           and calls onOpenHelpDialog.

import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useViewerStore } from '@/store/viewer-store'
import { NavBar } from './NavBar'

function renderAt(path: string, onOpenHelpDialog = vi.fn()) {
  return render(
    <TooltipProvider delayDuration={0}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/viewer/:system"
            element={<NavBar onOpenHelpDialog={onOpenHelpDialog} />}
          />
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  )
}

describe('NavBar', () => {
  beforeEach(() => {
    useViewerStore.setState({ theme: 'light' })
    cleanup()
  })

  test('Test 1: renders two NavLinks Coding/OKB; active matches :system (Phase 55)', () => {
    // Phase 55: 2-system viewer (CAP dropped per D-55-01b).
    renderAt('/viewer/okb')
    expect(screen.getByTestId('nav-link-coding')).toHaveTextContent('Coding')
    expect(screen.getByTestId('nav-link-okb')).toHaveTextContent('OKB')
    // CAP nav link is gone.
    expect(screen.queryByTestId('nav-link-cap')).toBeNull()
    expect(screen.getByTestId('nav-link-okb')).toHaveAttribute('data-active', 'true')
    expect(screen.getByTestId('nav-link-coding')).toHaveAttribute('data-active', 'false')
    // Active link styled with font-bold + accent underline per UI-SPEC § Typography
    expect(screen.getByTestId('nav-link-okb').className).toMatch(/font-bold/)
    expect(screen.getByTestId('nav-link-okb').className).toMatch(/underline/)
  })

  test('Test 2: Theme-toggle IconButton has aria-label "Toggle theme" and toggles store', () => {
    renderAt('/viewer/coding')
    const btn = screen.getByRole('button', { name: 'Toggle theme' })
    expect(btn).toBeInTheDocument()
    expect(useViewerStore.getState().theme).toBe('light')
    fireEvent.click(btn)
    expect(useViewerStore.getState().theme).toBe('dark')
    fireEvent.click(btn)
    expect(useViewerStore.getState().theme).toBe('light')
  })

  test('Test 3: Keyboard-help IconButton aria-label "Show keyboard shortcuts" + opens dialog binding', () => {
    const onOpenHelpDialog = vi.fn()
    renderAt('/viewer/coding', onOpenHelpDialog)
    const btn = screen.getByRole('button', { name: 'Show keyboard shortcuts' })
    expect(btn).toBeInTheDocument()
    fireEvent.click(btn)
    expect(onOpenHelpDialog).toHaveBeenCalledTimes(1)
  })

  test('Wordmark "Unified Viewer" present per UI-SPEC § Layout Contract row 1', () => {
    renderAt('/viewer/coding')
    expect(screen.getByTestId('viewer-wordmark')).toHaveTextContent('Unified Viewer')
  })
})
