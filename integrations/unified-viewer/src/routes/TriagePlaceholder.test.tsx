// PATTERN SOURCE: 55-07-PLAN.md Task 2 <behavior>
//
// TriagePlaceholder is the importable stub used by UnifiedViewer's lazy import
// while Wave 3 ships. Plan 55-10 OVERWRITES this file (or the lazy import
// path) once IssueTriageView lands.

import { describe, test, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import TriagePlaceholder from './TriagePlaceholder'

afterEach(() => cleanup())

describe('TriagePlaceholder', () => {
  test('renders a single div with data-testid="triage-mode-placeholder" + loading copy', () => {
    render(<TriagePlaceholder />)
    const el = screen.getByTestId('triage-mode-placeholder')
    expect(el).toBeInTheDocument()
    expect(el.textContent).toMatch(/Triage view loading/i)
  })

  test('lives at integrations/unified-viewer/src/routes/TriagePlaceholder.tsx so 55-10 can lazy-import', async () => {
    const { readFileSync, existsSync } = await import('node:fs')
    const path = await import('node:path')
    const filePath = path.resolve(process.cwd(), 'src/routes/TriagePlaceholder.tsx')
    expect(existsSync(filePath)).toBe(true)
    const src = readFileSync(filePath, 'utf8')
    // default-export contract — 55-10 task 2 will swap the lazy import path,
    // not the export shape.
    expect(src).toMatch(/export\s+default/)
  })
})
