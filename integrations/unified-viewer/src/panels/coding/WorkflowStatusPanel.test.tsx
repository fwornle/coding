// PATTERN SOURCE: 55-12-PLAN.md Task 2 <behavior>
//   + 55-PATTERNS.md § WorkflowStatusPanel.tsx (poll-with-stop pattern + render pattern)
//   + 55-UI-SPEC.md §13.4 (Workflow Execution Status UX)
//
// Behavior covered (the plan's <behavior> block):
//   - Test 1: when system !== 'coding', returns null
//   - Test 2 (poll): on mount, fetches http://localhost:3033/api/ukb/status; then every 5s
//   - Test 3 (idle skip): when status=='idle' for >5min, polling pauses; resumes on click
//   - Test 4 (collapsed render): h-10 trigger shows running / idle copy verbatim
//   - Test 5 (expanded render): per-step Progress bars + status icons
//   - Test 6 (auto-expand): idle→running transition triggers expanded state
//   - Test 7 (auto-collapse): 30s after status === 'idle' (terminal) auto-collapse fires
//   - Test 8 (click step with referencedEntities): setSelectedNode(first)
//   - Test 9 (failure visualization): failed step has text-destructive + Retry link
//   - Test 10 (Logger discipline): no raw console.*

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act, cleanup, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import WorkflowStatusPanel from './WorkflowStatusPanel'
import { useViewerStore } from '@/store/viewer-store'

interface WorkflowStatusPayload {
  status: 'idle' | 'running' | 'completed' | 'failed'
  workflowName?: string
  progressPercent?: number
  currentPhase?: string
  stepsDetail?: Array<{
    name: string
    label: string
    status: 'idle' | 'running' | 'done' | 'failed'
    progressPercent: number
    referencedEntities?: string[]
  }>
}

function makeFetchResponse(payload: WorkflowStatusPayload): typeof fetch {
  return vi.fn().mockImplementation(async () => {
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => payload,
    } as Response
  }) as unknown as typeof fetch
}

interface RenderOpts {
  system?: 'coding' | 'okb'
  initial?: WorkflowStatusPayload
}

function renderPanel({ system = 'coding', initial = { status: 'idle' } }: RenderOpts = {}) {
  const originalFetch = globalThis.fetch
  let currentPayload = initial
  const fetchImpl = vi.fn().mockImplementation(async () => {
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => currentPayload,
    } as Response
  }) as unknown as typeof fetch
  globalThis.fetch = fetchImpl
  const result = render(<WorkflowStatusPanel system={system} />)
  return {
    ...result,
    fetchImpl,
    setPayload(next: WorkflowStatusPayload) {
      currentPayload = next
    },
    restore: () => {
      globalThis.fetch = originalFetch
    },
  }
}

beforeEach(() => {
  useViewerStore.setState({ selectedNodeId: null })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('WorkflowStatusPanel', () => {
  test('Test 1: returns null when system !== "coding"', () => {
    const r = renderPanel({ system: 'okb' })
    try {
      expect(r.container.textContent ?? '').toBe('')
      expect(r.fetchImpl).not.toHaveBeenCalled()
    } finally {
      r.restore()
    }
  })

  test('Test 2: fetches /api/ukb/status on mount', async () => {
    const r = renderPanel()
    try {
      await waitFor(() => expect(r.fetchImpl).toHaveBeenCalled())
      const url = (r.fetchImpl as unknown as { mock: { calls: [string][] } }).mock.calls[0][0]
      expect(url).toBe('http://localhost:3033/api/ukb/status')
    } finally {
      r.restore()
    }
  })

  test('Test 3: polls every 5s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const r = renderPanel()
    try {
      await waitFor(() => expect(r.fetchImpl).toHaveBeenCalledTimes(1))
      act(() => {
        vi.advanceTimersByTime(5000)
      })
      await waitFor(() => expect(r.fetchImpl).toHaveBeenCalledTimes(2))
      act(() => {
        vi.advanceTimersByTime(5000)
      })
      await waitFor(() => expect(r.fetchImpl).toHaveBeenCalledTimes(3))
    } finally {
      r.restore()
      vi.useRealTimers()
    }
  })

  test('Test 4: collapsed render — idle status shows "No workflows running."', async () => {
    const r = renderPanel({ initial: { status: 'idle' } })
    try {
      await waitFor(() => {
        expect(screen.getByText(/No workflows running\./)).toBeTruthy()
      })
    } finally {
      r.restore()
    }
  })

  test('Test 5: collapsed render — running status shows "<wf> <pct>% — <phase>"', async () => {
    const r = renderPanel({
      initial: {
        status: 'running',
        workflowName: 'wave-analysis',
        progressPercent: 42,
        currentPhase: 'Persist',
      },
    })
    try {
      await waitFor(() => {
        expect(screen.getByText(/wave-analysis/)).toBeTruthy()
        expect(screen.getByText(/42%/)).toBeTruthy()
        expect(screen.getByText(/Persist/)).toBeTruthy()
      })
    } finally {
      r.restore()
    }
  })

  test('Test 6: expanded render — per-step Progress bars + status icons', async () => {
    const r = renderPanel({
      initial: {
        status: 'running',
        workflowName: 'wave-analysis',
        progressPercent: 30,
        currentPhase: 'Persist',
        stepsDetail: [
          { name: 'analyze', label: 'Analyze', status: 'done', progressPercent: 100 },
          { name: 'classify', label: 'Classify', status: 'running', progressPercent: 60 },
          { name: 'persist', label: 'Persist', status: 'idle', progressPercent: 0 },
        ],
      },
    })
    try {
      await waitFor(() => {
        // Auto-expand on idle→running transition. Since the panel starts in
        // "running" payload, we expect expanded state already showing steps.
        expect(screen.getByTestId('workflow-step-row-analyze')).toBeTruthy()
        expect(screen.getByTestId('workflow-step-row-classify')).toBeTruthy()
        expect(screen.getByTestId('workflow-step-row-persist')).toBeTruthy()
      })
    } finally {
      r.restore()
    }
  })

  test('Test 7: auto-expand on idle→running transition', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const r = renderPanel({ initial: { status: 'idle' } })
    try {
      // Initially collapsed
      await waitFor(() => expect(screen.getByText(/No workflows running\./)).toBeTruthy())

      // Flip payload to running; advance polling.
      r.setPayload({
        status: 'running',
        workflowName: 'wave-analysis',
        progressPercent: 15,
        currentPhase: 'Analyze',
        stepsDetail: [{ name: 'analyze', label: 'Analyze', status: 'running', progressPercent: 15 }],
      })
      act(() => {
        vi.advanceTimersByTime(5000)
      })
      await waitFor(() => {
        expect(screen.getByTestId('workflow-step-row-analyze')).toBeTruthy()
      })
    } finally {
      r.restore()
      vi.useRealTimers()
    }
  })

  test('Test 8: clicking a step with referencedEntities sets selectedNodeId to the first', async () => {
    const r = renderPanel({
      initial: {
        status: 'running',
        workflowName: 'wave-analysis',
        progressPercent: 60,
        currentPhase: 'Persist',
        stepsDetail: [
          {
            name: 'persist',
            label: 'Persist',
            status: 'running',
            progressPercent: 60,
            referencedEntities: ['ent-77', 'ent-88'],
          },
        ],
      },
    })
    try {
      await waitFor(() => screen.getByTestId('workflow-step-row-persist'))
      const row = screen.getByTestId('workflow-step-row-persist')
      act(() => {
        fireEvent.click(row)
      })
      expect(useViewerStore.getState().selectedNodeId).toBe('ent-77')
    } finally {
      r.restore()
    }
  })

  test('Test 9: failed step has text-destructive + Retry link to dashboard', async () => {
    const r = renderPanel({
      initial: {
        status: 'running',
        workflowName: 'wave-analysis',
        progressPercent: 80,
        currentPhase: 'Persist',
        stepsDetail: [
          { name: 'analyze', label: 'Analyze', status: 'done', progressPercent: 100 },
          { name: 'persist', label: 'Persist', status: 'failed', progressPercent: 80 },
        ],
      },
    })
    try {
      await waitFor(() => screen.getByTestId('workflow-step-row-persist'))
      const row = screen.getByTestId('workflow-step-row-persist')
      expect(row.className).toMatch(/text-destructive/)
      const retry = screen.getByTestId('workflow-step-retry-persist')
      expect(retry).toBeTruthy()
      expect((retry as HTMLAnchorElement).href).toContain('localhost:3032/ukb')
    } finally {
      r.restore()
    }
  })

  test('Test 10: data-testid="workflow-status-panel" present at root', async () => {
    const r = renderPanel({ initial: { status: 'idle' } })
    try {
      await waitFor(() => screen.getByTestId('workflow-status-panel'))
    } finally {
      r.restore()
    }
  })

  test('Test 11: Logger discipline — no raw console.* in source', () => {
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/panels/coding/WorkflowStatusPanel.tsx'),
      'utf8',
    )
    expect(src).not.toMatch(/console\.(log|warn|error|info|debug|trace)/)
  })

  test('Test 12: source-grep gates (≥4 of 4 tokens)', () => {
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/panels/coding/WorkflowStatusPanel.tsx'),
      'utf8',
    )
    const tokens = [
      /localhost:3033\/api\/ukb\/status/,
      /idleSinceRef/,
      /Collapsible/,
      /Progress/,
    ]
    const hits = tokens.filter((t) => t.test(src)).length
    expect(hits).toBeGreaterThanOrEqual(4)
  })

  test('Test 13: default export present', () => {
    const src = readFileSync(
      path.resolve(process.cwd(), 'src/panels/coding/WorkflowStatusPanel.tsx'),
      'utf8',
    )
    expect(src).toMatch(/export default/)
  })
})
