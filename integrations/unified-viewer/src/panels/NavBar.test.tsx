// PATTERN SOURCE: 45-03-PLAN.md Task 2 NavBar behavior tests
//   + 55-07-PLAN.md Task 2 (NavBar Mode toggle)
//
//   Test 1: Three Link components with SYSTEM_LABELS, active link styled
//           with font-bold + accent underline.
//   Test 2: Theme-toggle IconButton has aria-label='Toggle theme';
//           clicking toggles `theme` in the store.
//   Test 3: Keyboard-help IconButton has aria-label='Show keyboard shortcuts'
//           and calls onOpenHelpDialog.
//
// Phase 55:
//   Mode toggle: center-cluster <ToggleGroup type="single"> with items
//   Knowledge Graph / Issue Triage. Hidden when entities.length === 0;
//   Triage item hidden when entity set lacks Incident/FailureIncident
//   types. Click flips Zustand mode via setMode.

import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useViewerStore } from '@/store/viewer-store'
import type { Entity } from '@/api/ApiClient'
import { NavBar } from './NavBar'

function renderAt(
  path: string,
  onOpenHelpDialog = vi.fn(),
  entities: ReadonlyArray<Entity> = [],
) {
  return render(
    <TooltipProvider delayDuration={0}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/viewer/:system"
            element={
              <NavBar onOpenHelpDialog={onOpenHelpDialog} entities={entities} />
            }
          />
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  )
}

function ent(id: string, ontologyClass: string, entityType?: string): Entity {
  return {
    id,
    name: id,
    ontologyClass,
    entityType: entityType ?? ontologyClass,
  } as Entity
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

  // ------------------------- Phase 55 Mode toggle -------------------------

  test('Phase 55: Mode ToggleGroup is HIDDEN when entities.length === 0', () => {
    renderAt('/viewer/coding', vi.fn(), [])
    expect(screen.queryByTestId('viewer-mode-toggle')).toBeNull()
  })

  test('Phase 55: Mode ToggleGroup renders Knowledge Graph + Issue Triage items when incidents exist', () => {
    const entities: Entity[] = [
      ent('e1', 'Component'),
      ent('inc1', 'Incident', 'Incident'),
    ]
    renderAt('/viewer/coding', vi.fn(), entities)
    const toggle = screen.getByTestId('viewer-mode-toggle')
    expect(toggle).toBeInTheDocument()
    expect(screen.getByTestId('mode-item-kg')).toHaveTextContent('Knowledge Graph')
    expect(screen.getByTestId('mode-item-triage')).toHaveTextContent('Issue Triage')
  })

  test('Phase 55: Issue Triage item is OMITTED when entities lack Incident/FailureIncident types', () => {
    const entities: Entity[] = [
      ent('e1', 'Component'),
      ent('e2', 'SubComponent'),
      ent('e3', 'Observation'),
    ]
    renderAt('/viewer/coding', vi.fn(), entities)
    // ToggleGroup renders because entities.length > 0; only KG item is shown.
    expect(screen.getByTestId('viewer-mode-toggle')).toBeInTheDocument()
    expect(screen.getByTestId('mode-item-kg')).toBeInTheDocument()
    expect(screen.queryByTestId('mode-item-triage')).toBeNull()
  })

  test('Phase 55: clicking Issue Triage calls setMode("triage"), Knowledge Graph reverts to setMode("kg")', () => {
    const entities: Entity[] = [
      ent('e1', 'Component'),
      ent('inc1', 'Incident', 'Incident'),
    ]
    useViewerStore.setState({ mode: 'kg' })
    renderAt('/viewer/coding', vi.fn(), entities)
    fireEvent.click(screen.getByTestId('mode-item-triage'))
    expect(useViewerStore.getState().mode).toBe('triage')
    fireEvent.click(screen.getByTestId('mode-item-kg'))
    expect(useViewerStore.getState().mode).toBe('kg')
  })

  test('Phase 55: Mode items expose aria-label per UI-SPEC §15', () => {
    const entities: Entity[] = [
      ent('e1', 'Component'),
      ent('inc1', 'FailureIncident', 'FailureIncident'),
    ]
    renderAt('/viewer/coding', vi.fn(), entities)
    expect(screen.getByLabelText('Knowledge Graph mode')).toBeInTheDocument()
    expect(screen.getByLabelText('Issue Triage mode')).toBeInTheDocument()
  })
})
