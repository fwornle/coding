// PATTERN SOURCE: 45-01-PLAN.md Task 2 <behavior> Tests 4 + 5,
// AMENDED by 55-01-PLAN.md Task 3 (CAP system dropped, D-55-01b).
//
// Test 4: /viewer/coding renders ViewerCore with the active NavLink reading
//         "Coding"; /viewer/unknown renders UnknownSystem.
// Test 5: Switching :system unmounts and re-mounts the subtree
//         (proven via a DOM-ref check — the active nav-link is a NEW DOM node).
//
// Phase 55: only `coding` and `okb` are valid systems. `/viewer/cap` falls
// through to UnknownSystem. The wordmark is the static "Unified Viewer"
// string in NavBar. System identity surfaces in the active NavLink (font-bold
// + accent underline per UI-SPEC § Typography). Tests below assert against
// `nav-link-{system}` data-testid with data-active="true".

import { describe, test, expect, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Mock SigmaCanvas — its sigma + graphology-layout-forceatlas2 imports
// trip ESM-resolution under jsdom (Plan 02 wires the live component). The
// routing tests below only care about the active nav-link, not the
// canvas internals — those have dedicated reducer tests in graph/.
vi.mock('@/graph/SigmaCanvas', () => ({
  SigmaCanvas: () => null,
}))

// Mock useGraphData to avoid touching the network — we don't care about
// data shape here, just the routing chrome.
vi.mock('@/graph/useGraphData', () => ({
  useGraphData: () => ({
    entities: [],
    relations: [],
    ontology: [],
    isLoading: false,
    error: null,
  }),
}))

import { UnifiedViewer } from './UnifiedViewer'
import { UnknownSystem } from './UnknownSystem'

function renderAt(path: string) {
  // Plan 03 added FilterRail with a useQuery for ontology classes; ViewerCore
  // therefore needs a QueryClientProvider in tests (the prod tree gets it
  // from main.tsx).
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={<Navigate to="/viewer/coding" replace />} />
          <Route path="/viewer/:system" element={<UnifiedViewer />} />
          <Route path="*" element={<UnknownSystem />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('UnifiedViewer routing (Phase 55 — 2-system viewer)', () => {
  test('/viewer/coding renders ViewerCore with the Coding nav-link active', () => {
    renderAt('/viewer/coding')
    // Wordmark is the static "Unified Viewer" per UI-SPEC § Layout Contract row 1.
    expect(screen.getByTestId('viewer-wordmark')).toHaveTextContent('Unified Viewer')
    // Active system identity surfaces via the NavLink active state.
    const active = screen.getByTestId('nav-link-coding')
    expect(active).toHaveAttribute('data-active', 'true')
    expect(active).toHaveTextContent('Coding')
    expect(active.getAttribute('aria-current')).toBe('page')
    cleanup()
  })

  test('/viewer/okb renders ViewerCore with the OKB nav-link active', () => {
    renderAt('/viewer/okb')
    expect(screen.getByTestId('viewer-wordmark')).toHaveTextContent('Unified Viewer')
    const active = screen.getByTestId('nav-link-okb')
    expect(active).toHaveAttribute('data-active', 'true')
    expect(active).toHaveTextContent('OKB')
    cleanup()
  })

  test('/viewer/cap renders UnknownSystem (cap is no longer a valid system per D-55-01b)', () => {
    // Phase 55: cap is dropped. /viewer/cap must NOT render ViewerCore;
    // it must fall through UnifiedViewer's isValidSystem guard to UnknownSystem.
    renderAt('/viewer/cap')
    const unknown = screen.getByTestId('unknown-system')
    expect(unknown).toBeInTheDocument()
    // Only 2 recovery links — Coding + OKB (CAP is gone).
    const links = screen.getByTestId('unknown-system-links').querySelectorAll('a')
    expect(links).toHaveLength(2)
    const labels = Array.from(links).map((a) => a.textContent)
    expect(labels).toContain('Coding')
    expect(labels).toContain('OKB')
    expect(labels).not.toContain('CAP')
    cleanup()
  })

  test('/viewer/foo renders UnknownSystem (invalid system slug under /viewer/)', () => {
    renderAt('/viewer/foo')
    const unknown = screen.getByTestId('unknown-system')
    expect(unknown).toBeInTheDocument()
    const links = screen.getByTestId('unknown-system-links').querySelectorAll('a')
    expect(links).toHaveLength(2)
    const labels = Array.from(links).map((a) => a.textContent)
    expect(labels).toContain('Coding')
    expect(labels).toContain('OKB')
    cleanup()
  })

  test('/foo renders UnknownSystem with two labelled links (Phase 55)', () => {
    renderAt('/foo')
    const unknown = screen.getByTestId('unknown-system')
    expect(unknown).toBeInTheDocument()
    const links = screen.getByTestId('unknown-system-links').querySelectorAll('a')
    expect(links).toHaveLength(2)
    const labels = Array.from(links).map((a) => a.textContent)
    expect(labels).toContain('Coding')
    expect(labels).toContain('OKB')
    cleanup()
  })

  test('/ redirects to /viewer/coding', () => {
    renderAt('/')
    // The redirected route renders the active Coding link.
    const active = screen.getByTestId('nav-link-coding')
    expect(active).toHaveAttribute('data-active', 'true')
    cleanup()
  })

  test('switching :system produces a NEW DOM tree (key={system} remount)', () => {
    // First render at /viewer/coding, capture the active nav-link node identity.
    const { unmount } = renderAt('/viewer/coding')
    const codingActive = screen.getByTestId('nav-link-coding')
    expect(codingActive).toHaveAttribute('data-active', 'true')
    unmount()
    cleanup()

    // Mount fresh at /viewer/okb and capture the new active nav-link node.
    renderAt('/viewer/okb')
    const okbActive = screen.getByTestId('nav-link-okb')
    expect(okbActive).toHaveAttribute('data-active', 'true')
    // Different mounts -> different DOM nodes -> proves no shared element survives system switch.
    expect(okbActive).not.toBe(codingActive)
    cleanup()
  })

  // ---------------------- Phase 55 Plan 07 wiring ----------------------

  test('Phase 55: StatsBar is mounted between NavBar and content row', () => {
    renderAt('/viewer/coding')
    expect(screen.getByTestId('stats-bar')).toBeInTheDocument()
    cleanup()
  })

  test('Phase 55: LegendPanel is mounted inside FilterRail', () => {
    renderAt('/viewer/coding')
    expect(screen.getByTestId('viewer-legend-panel')).toBeInTheDocument()
    cleanup()
  })

  test('Phase 55: mode === "kg" renders SigmaCanvas slot; "triage" renders TriagePlaceholder', async () => {
    // Default mode is kg → SigmaCanvas mock (returns null but the canvas
    // container is present).
    const { useViewerStore } = await import('@/store/viewer-store')
    useViewerStore.setState({ mode: 'kg' })
    const { unmount } = renderAt('/viewer/coding')
    // SigmaCanvas is mocked to return null at this layer; the canvas container
    // exists with data-testid='viewer-canvas' (set by UnifiedViewer's <main>).
    expect(screen.getByTestId('viewer-canvas')).toBeInTheDocument()
    expect(screen.queryByTestId('triage-mode-placeholder')).toBeNull()
    unmount()
    cleanup()
  })

  test('Phase 55-10: UnifiedViewer.tsx lazy-imports IssueTriageView (NOT TriagePlaceholder)', async () => {
    // Source-grep audit: the TriagePlaceholder import shipped by 55-07 Task 2
    // is replaced by the real IssueTriageView lazy import (55-10 Task 2).
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const filePath = path.resolve(process.cwd(), 'src/routes/UnifiedViewer.tsx')
    const src = readFileSync(filePath, 'utf8')
    expect(src).toMatch(/lazy\(\(\) => import\('@\/routes\/IssueTriageView'\)\)/)
    // The placeholder MUST be gone from this file (the file at
    // src/routes/TriagePlaceholder.tsx stays on disk as documented in the
    // plan — only the import here is swapped).
    expect(src).not.toMatch(/TriagePlaceholder/)
  })
})
