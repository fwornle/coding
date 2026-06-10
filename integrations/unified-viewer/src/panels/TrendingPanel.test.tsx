// PATTERN SOURCE: 55-10-PLAN.md Task 1 <behavior>
//   + 55-PATTERNS.md § TrendingPanel.tsx (verbatim VOKB port)
//   + 55-UI-SPEC.md §5 empty state copy + §10 click semantics row 7 + §18 row 5
//
// Behavior covered (the plan's <behavior> block):
//   Test 1: when API returns 3 patterns, renders 3 rows; each row has score-coded dot
//           + name + score badge + 7d/30d/90d trend counts
//   Test 2: all numeric values use `tabular-nums` className
//   Test 3: empty state copy matches UI-SPEC §5 verbatim
//   Test 4: click on a row calls setSelectedNodeId(pattern.nodeId) AND switches
//           mode from triage → kg first
//   Test 5: error state — `Could not load trends — retry` chip
//   Test 6: 60s polling cadence (refetchInterval) — assert via TanStack Query options
//   Test 7: import smoke — default export is a function (overwrites 55-08 placeholder)
//   Test 8: Logger.info(PANELS) fires on row click, no raw console.*
//
// Logger discipline test asserts the file source contains no raw console.* calls.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useViewerStore } from '@/store/viewer-store'
import { ApiClient } from '@/api/ApiClient'
import TrendingPanel from './TrendingPanel'

// ---- Fixtures -----------------------------------------------------------

const TRENDING_FIXTURE = {
  patterns: [
    {
      nodeId: 'node-1',
      entity: { id: 'node-1', name: 'High-temp throttle', entityType: 'FailurePattern' },
      trendScore: 2.4,
      trends: { last7Days: 3, last30Days: 8, last90Days: 12 },
    },
    {
      nodeId: 'node-2',
      entity: { id: 'node-2', name: 'OOM kill loop', entityType: 'FailurePattern' },
      trendScore: 1.2,
      trends: { last7Days: 1, last30Days: 4, last90Days: 5 },
    },
    {
      nodeId: 'node-3',
      entity: { id: 'node-3', name: 'Stale lease cache', entityType: 'FailurePattern' },
      trendScore: 0.5,
      trends: { last7Days: 0, last30Days: 1, last90Days: 2 },
    },
  ],
}

function makeFetchResponse(stats: unknown) {
  return vi.fn().mockImplementation(async () => {
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ success: true, data: stats }),
    } as Response
  })
}

function renderTrendingPanel({
  fetchImpl,
}: {
  fetchImpl?: typeof fetch
} = {}) {
  const originalFetch = globalThis.fetch
  if (fetchImpl) {
    globalThis.fetch = fetchImpl
  }
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })
  const apiClient = new ApiClient('http://localhost:12436')
  const result = render(
    <QueryClientProvider client={client}>
      <TrendingPanel apiClient={apiClient} />
    </QueryClientProvider>,
  )
  return { ...result, restore: () => { globalThis.fetch = originalFetch }, client }
}

beforeEach(() => {
  // Reset store to known baseline.
  useViewerStore.setState({
    selectedNodeId: null,
    mode: 'kg',
  })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('TrendingPanel', () => {
  test('Test 1: renders 3 rows when API returns 3 patterns; each row has dot + name + score badge + trend counts', async () => {
    const fetchImpl = makeFetchResponse(TRENDING_FIXTURE)
    const { restore } = renderTrendingPanel({ fetchImpl })
    try {
      // The collapsible may need to be expanded to show content. The panel
      // defaults to expanded so rows render once data arrives.
      await waitFor(() => {
        expect(screen.getByText('High-temp throttle')).toBeInTheDocument()
      })
      expect(screen.getByText('OOM kill loop')).toBeInTheDocument()
      expect(screen.getByText('Stale lease cache')).toBeInTheDocument()

      // Each row carries a score-coded dot. The row's own testid is exactly
      // `trending-row-<nodeId>` — sub-elements use suffixes (`-dot`,
      // `-sparkline`, etc.) so filter to the row-level testid only.
      const allRowMatches = screen.getAllByTestId(/^trending-row-/)
      const rows = allRowMatches.filter((el) => {
        const tid = el.getAttribute('data-testid') || ''
        // Row testid matches `trending-row-<id>` with NO further `-suffix`.
        return /^trending-row-[^-]+(?:-[^-]+)*$/.test(tid)
          && !/-dot$|-sparkline$|-score-badge$|-trend-counts$/.test(tid)
      })
      expect(rows).toHaveLength(3)
      for (const row of rows) {
        expect(row.querySelector('[data-testid$="-dot"]')).not.toBeNull()
        expect(row.querySelector('[data-testid$="-score-badge"]')).not.toBeNull()
        expect(row.querySelector('[data-testid$="-trend-counts"]')).not.toBeNull()
      }
    } finally {
      restore()
    }
  })

  test('Test 2: numeric values use tabular-nums className', async () => {
    const fetchImpl = makeFetchResponse(TRENDING_FIXTURE)
    const { restore } = renderTrendingPanel({ fetchImpl })
    try {
      await waitFor(() => {
        expect(screen.getByText('High-temp throttle')).toBeInTheDocument()
      })
      const counts = screen.getAllByTestId(/-trend-counts$/)
      expect(counts.length).toBeGreaterThan(0)
      for (const c of counts) {
        expect(c.className).toMatch(/tabular-nums/)
      }
      const badges = screen.getAllByTestId(/-score-badge$/)
      for (const b of badges) {
        expect(b.className).toMatch(/tabular-nums/)
      }
    } finally {
      restore()
    }
  })

  test('Test 3: empty state copy matches UI-SPEC §5 verbatim', async () => {
    const fetchImpl = makeFetchResponse({ patterns: [] })
    const { restore } = renderTrendingPanel({ fetchImpl })
    try {
      await waitFor(() => {
        expect(screen.getByTestId('trending-empty')).toBeInTheDocument()
      })
      // Verbatim from 55-10 PLAN.md must_have:
      expect(screen.getByText('No recurring patterns detected yet.')).toBeInTheDocument()
      expect(
        screen.getByText(/Patterns appear here when the same failure modes are ingested multiple times\. Run more analyses to build occurrence data\./),
      ).toBeInTheDocument()
    } finally {
      restore()
    }
  })

  test('Test 4: click on row calls setSelectedNodeId AND switches mode from triage → kg', async () => {
    const fetchImpl = makeFetchResponse(TRENDING_FIXTURE)
    const { restore } = renderTrendingPanel({ fetchImpl })
    try {
      // Pre-condition: simulate user in triage mode
      useViewerStore.setState({ mode: 'triage', selectedNodeId: null })

      await waitFor(() => {
        expect(screen.getByText('High-temp throttle')).toBeInTheDocument()
      })
      const row = screen.getByTestId('trending-row-node-1')
      fireEvent.click(row)

      expect(useViewerStore.getState().selectedNodeId).toBe('node-1')
      expect(useViewerStore.getState().mode).toBe('kg')
    } finally {
      restore()
    }
  })

  test('Test 4b: click on row in kg mode does NOT alter mode', async () => {
    const fetchImpl = makeFetchResponse(TRENDING_FIXTURE)
    const { restore } = renderTrendingPanel({ fetchImpl })
    try {
      useViewerStore.setState({ mode: 'kg', selectedNodeId: null })
      await waitFor(() => {
        expect(screen.getByText('OOM kill loop')).toBeInTheDocument()
      })
      const row = screen.getByTestId('trending-row-node-2')
      fireEvent.click(row)
      expect(useViewerStore.getState().selectedNodeId).toBe('node-2')
      expect(useViewerStore.getState().mode).toBe('kg')
    } finally {
      restore()
    }
  })

  test('Test 5: error state renders the "Could not load trends — retry" chip', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch
    const { restore } = renderTrendingPanel({ fetchImpl })
    try {
      await waitFor(() => {
        expect(screen.getByTestId('trending-error')).toBeInTheDocument()
      })
      expect(screen.getByText(/Could not load trends/i)).toBeInTheDocument()
      expect(screen.getByText(/retry/i)).toBeInTheDocument()
    } finally {
      restore()
    }
  })

  test('Test 6: TanStack Query is configured with 60s refetchInterval', async () => {
    const fetchImpl = makeFetchResponse(TRENDING_FIXTURE)
    const { restore, client } = renderTrendingPanel({ fetchImpl })
    try {
      // Render must mount; then inspect the QueryCache for the registered
      // refetchInterval option on the trends query.
      await waitFor(() => {
        expect(screen.getByText('High-temp throttle')).toBeInTheDocument()
      })
      const queries = client.getQueryCache().findAll()
      const trendsQ = queries.find((q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'trends')
      expect(trendsQ).toBeDefined()
      const options = trendsQ!.options as { refetchInterval?: number }
      expect(options.refetchInterval).toBe(60_000)
    } finally {
      restore()
    }
  })

  test('Test 7: default export is a function (the lazy import in FilterRail resolves)', async () => {
    const mod = await import('./TrendingPanel')
    expect(typeof mod.default).toBe('function')
    // Placeholder is gone — the new component is NOT TrendingPanelPlaceholder.
    expect(mod.default.name).not.toBe('TrendingPanelPlaceholder')
  })

  test('Test 8: clicking a row calls Logger.info on PANELS category (no raw console.*)', async () => {
    const fetchImpl = makeFetchResponse(TRENDING_FIXTURE)
    const { restore } = renderTrendingPanel({ fetchImpl })
    try {
      const { Logger } = await import('@/lib/logging')
      const spy = vi.spyOn(Logger, 'info')
      await waitFor(() => {
        expect(screen.getByText('Stale lease cache')).toBeInTheDocument()
      })
      const row = screen.getByTestId('trending-row-node-3')
      fireEvent.click(row)
      expect(spy).toHaveBeenCalled()
      // At least one call used the PANELS category
      const calls = spy.mock.calls as unknown as [string, ...unknown[]][]
      expect(calls.some((c) => c[0] === Logger.Categories.PANELS)).toBe(true)
      spy.mockRestore()
    } finally {
      restore()
    }
  })

  test('Test 9: rows render sparkline SVG segments (no chart library — inline SVG <line>)', async () => {
    const fetchImpl = makeFetchResponse(TRENDING_FIXTURE)
    const { restore } = renderTrendingPanel({ fetchImpl })
    try {
      await waitFor(() => {
        expect(screen.getByText('High-temp throttle')).toBeInTheDocument()
      })
      const sparks = document.querySelectorAll('[data-testid$="-sparkline"]')
      expect(sparks.length).toBeGreaterThan(0)
      // Inline SVG with at least one <line> element per row
      const lines = document.querySelectorAll('[data-testid$="-sparkline"] line')
      expect(lines.length).toBeGreaterThan(0)
    } finally {
      restore()
    }
  })
})

// Logger discipline — source-level audit.
describe('TrendingPanel — Logger discipline', () => {
  test('ZERO raw console.* in TrendingPanel.tsx', async () => {
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const filePath = path.resolve(process.cwd(), 'src/panels/TrendingPanel.tsx')
    const src = readFileSync(filePath, 'utf8')
    expect(src).not.toMatch(/console\.(log|warn|error|info|debug)/)
  })

  test('uses scoreColor + scoreBadgeClass helpers and key store actions', async () => {
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const filePath = path.resolve(process.cwd(), 'src/panels/TrendingPanel.tsx')
    const src = readFileSync(filePath, 'utf8')
    expect(src).toMatch(/scoreColor/)
    expect(src).toMatch(/scoreBadgeClass/)
    expect(src).toMatch(/setSelectedNodeId|setSelectedNode/)
    expect(src).toMatch(/refetchInterval/)
    expect(src).toMatch(/tabular-nums/)
  })

  test('overwrites 55-08 placeholder — no placeholder testid remains', async () => {
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const filePath = path.resolve(process.cwd(), 'src/panels/TrendingPanel.tsx')
    const src = readFileSync(filePath, 'utf8')
    expect(src).not.toMatch(/trending-panel-placeholder/)
    expect(src).not.toMatch(/TrendingPanelPlaceholder/)
  })

  test('default export present (single occurrence)', async () => {
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const filePath = path.resolve(process.cwd(), 'src/panels/TrendingPanel.tsx')
    const src = readFileSync(filePath, 'utf8')
    const matches = src.match(/export default/g) || []
    expect(matches.length).toBe(1)
  })

  test('FilterRail lazy import path unchanged (55-08 mount intact)', async () => {
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const filePath = path.resolve(process.cwd(), 'src/panels/FilterRail.tsx')
    const src = readFileSync(filePath, 'utf8')
    expect(src).toMatch(/lazy\(\(\) => import\('\.\/TrendingPanel'\)\)/)
  })
})
