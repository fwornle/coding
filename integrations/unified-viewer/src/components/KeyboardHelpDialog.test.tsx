// PATTERN SOURCE: 55-07-PLAN.md Task 3 <behavior>
//   + 55-UI-SPEC.md §10 (Keyboard table — 6 new rows)
//   + 55-PATTERNS.md § KeyboardHelpDialog.tsx (EXTEND)
//
// Behavior:
//   Test 1: dialog contains exactly 6 NEW rows added by Phase 55
//   Test 2: each new row's description text matches UI-SPEC §10 verbatim
//   Test 3: Phase 45 rows are NOT removed or modified (BC)

import { describe, test, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { KeyboardHelpDialog } from './KeyboardHelpDialog'

afterEach(() => cleanup())

const PHASE_55_NEW_ROWS: ReadonlyArray<{ keys: string; description: string }> = [
  { keys: 'm', description: 'Toggle Knowledge Graph / Issue Triage mode' },
  { keys: 't', description: 'Open ETM live tail sheet (coding only)' },
  { keys: '1 / 2 / 3 / 4', description: 'Cycle Entity sub-tabs (Default / Evolution / Confidence / Timeline)' },
  { keys: '[ / ]', description: 'Collapse / expand the entire FilterRail' },
  { keys: 'g then h', description: '"Go to hierarchy" — focuses Hierarchy Navigator search (coding only)' },
  { keys: 'Shift+/', description: 'Open keyboard help (same as ?)' },
]

const PHASE_45_BASELINE_ROWS: ReadonlyArray<{ keys: string; description: string }> = [
  { keys: '/', description: 'Focus the search input' },
  { keys: 'Esc', description: 'Blur search, close dialog, or deselect node' },
  { keys: 'Tab / Shift+Tab', description: 'Roving focus across NavBar, filters, canvas, side panel' },
  { keys: 'Enter', description: 'Activate focused node (same as click)' },
  { keys: 'Space', description: 'Expand neighbors of focused node (same as double-click)' },
  { keys: 'f', description: 'Toggle filter rail collapse' },
  { keys: '?', description: 'Open this keyboard shortcuts dialog' },
]

describe('KeyboardHelpDialog (Phase 55 extension)', () => {
  test('Test 1: dialog contains all 6 NEW Phase 55 shortcut rows', () => {
    render(<KeyboardHelpDialog open={true} onOpenChange={() => undefined} />)
    const table = screen.getByTestId('keyboard-shortcuts-table')
    expect(table).toBeInTheDocument()
    for (const row of PHASE_55_NEW_ROWS) {
      // Each row should appear by description text — keys can be in either a
      // single kbd or multiple kbds joined, but the description is unique.
      expect(table.textContent).toContain(row.description)
    }
  })

  test('Test 2: each NEW row description matches UI-SPEC §10 verbatim', () => {
    render(<KeyboardHelpDialog open={true} onOpenChange={() => undefined} />)
    const table = screen.getByTestId('keyboard-shortcuts-table')
    // Verbatim contain — same as Test 1 but the assertion guards against
    // future paraphrasing.
    expect(table.textContent).toContain('Toggle Knowledge Graph / Issue Triage mode')
    expect(table.textContent).toContain('Open ETM live tail sheet (coding only)')
    expect(table.textContent).toContain('Cycle Entity sub-tabs (Default / Evolution / Confidence / Timeline)')
    expect(table.textContent).toContain('Collapse / expand the entire FilterRail')
    expect(table.textContent).toContain('"Go to hierarchy" — focuses Hierarchy Navigator search (coding only)')
    expect(table.textContent).toContain('Open keyboard help (same as ?)')
  })

  test('Test 3: BC — Phase 45 baseline rows are NOT removed or modified', () => {
    render(<KeyboardHelpDialog open={true} onOpenChange={() => undefined} />)
    const table = screen.getByTestId('keyboard-shortcuts-table')
    for (const row of PHASE_45_BASELINE_ROWS) {
      expect(table.textContent).toContain(row.description)
    }
  })

  test('Header copy "Keyboard shortcuts" preserved (45-PATTERNS Copywriting Contract)', () => {
    render(<KeyboardHelpDialog open={true} onOpenChange={() => undefined} />)
    expect(screen.getByText('Keyboard shortcuts')).toBeInTheDocument()
  })

  test('Total row count = 7 baseline + 6 Phase 55 = 13', () => {
    render(<KeyboardHelpDialog open={true} onOpenChange={() => undefined} />)
    const table = screen.getByTestId('keyboard-shortcuts-table')
    const rows = table.querySelectorAll('tbody tr')
    expect(rows.length).toBe(13)
  })
})
