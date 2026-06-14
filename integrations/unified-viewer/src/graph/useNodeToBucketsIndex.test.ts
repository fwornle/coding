// PATTERN SOURCE: 56.1-05-PLAN.md Task 1 step 4 + 56.1-PATTERNS.md §3
//   + useGraphData.test.ts (renderHook + QueryClientProvider scaffold)
//
// Phase 56.1 Plan 05 — reverse-lookup pre-index hook tests.
//
// Hook contract under test (PATTERNS §3):
//   useNodeToBucketsIndex(apiClient, system): ReadonlyMap<string, ReadonlySet<string>>
//     - Keys: visible node ids
//     - Values: Set of `${bucket.id}|${bucket.startAt}` composite keys
//     - Rebuild triggers (useMemo dep list): [sessions, visibleIds, relations]
//     - Reference-stable across renders with identical content
//
// Pre-index integrity (PATTERNS Locked Contract #7): pickAllResolvable is
// called from the hook body — never from a click handler. The 4 tests below
// exercise the FORWARD pre-index build path; the reverse lookup (node click
// reading from the index) is tested in D3GraphCanvas.test.ts (Plan 03/05 G-gates).

import { describe, test, expect, beforeEach, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import React from 'react'

// Mock the dependency hooks — useNodeToBucketsIndex composes
// useGraphData (for relations), useVisibleEntityIds (for the visible id set),
// and useLslSessions (for the sessions cache). The hook is a pure derivation
// over those three inputs; mocking lets us drive each input independently
// without dragging fetch or store wiring into the test.
vi.mock('./useGraphData', () => ({
  useGraphData: () => {
    const rel = (globalThis as unknown as { __mockRelations?: unknown[] }).__mockRelations ?? []
    return {
      entities: [],
      relations: rel,
      ontology: [],
      isLoading: false,
      error: null,
    }
  },
}))

vi.mock('./useVisibleEntityIds', () => ({
  useVisibleEntityIds: () => {
    const ids = (globalThis as unknown as { __mockVisibleIds?: ReadonlySet<string> })
      .__mockVisibleIds
    return ids ?? new Set<string>()
  },
}))

vi.mock('@/panels/coding/useLslSessions', () => ({
  useLslSessions: () => {
    const sessions =
      (globalThis as unknown as { __mockSessions?: unknown[] }).__mockSessions ?? []
    return { data: sessions, isLoading: false, error: null }
  },
}))

import { useNodeToBucketsIndex } from './useNodeToBucketsIndex'
import { ApiClient } from '@/api/ApiClient'

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client }, children)
  }
}

function seed(args: {
  sessions?: Array<{ id: string; startAt: string; entityIds: string[] }>
  visibleIds?: ReadonlySet<string>
  relations?: Array<{ from: string; to: string; type: string }>
}) {
  ;(globalThis as unknown as { __mockSessions?: unknown[] }).__mockSessions =
    args.sessions ?? []
  ;(globalThis as unknown as { __mockVisibleIds?: ReadonlySet<string> }).__mockVisibleIds =
    args.visibleIds ?? new Set<string>()
  ;(globalThis as unknown as { __mockRelations?: unknown[] }).__mockRelations =
    args.relations ?? []
}

function cleanupGlobals() {
  delete (globalThis as unknown as { __mockSessions?: unknown }).__mockSessions
  delete (globalThis as unknown as { __mockVisibleIds?: unknown }).__mockVisibleIds
  delete (globalThis as unknown as { __mockRelations?: unknown }).__mockRelations
}

describe('useNodeToBucketsIndex (Phase 56.1 D-3 + Contract #7)', () => {
  let queryClient: QueryClient
  let apiClient: ApiClient

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    apiClient = new ApiClient('http://example.invalid')
    cleanupGlobals()
  })

  test('Test 1: returns empty Map when sessions is empty', () => {
    seed({ sessions: [], visibleIds: new Set(['e1']), relations: [] })
    const { result } = renderHook(() => useNodeToBucketsIndex(apiClient, 'coding'), {
      wrapper: makeWrapper(queryClient),
    })
    expect(result.current).toBeInstanceOf(Map)
    expect(result.current.size).toBe(0)
    cleanupGlobals()
  })

  test('Test 2: maps touched node to bucket key — single session, single visible entity', () => {
    seed({
      sessions: [{ id: 'sess-a', startAt: '2026-06-13T10:00:00Z', entityIds: ['e1'] }],
      visibleIds: new Set(['e1']),
      relations: [],
    })
    const { result } = renderHook(() => useNodeToBucketsIndex(apiClient, 'coding'), {
      wrapper: makeWrapper(queryClient),
    })
    const expected = 'sess-a|2026-06-13T10:00:00Z'
    expect(result.current.get('e1')).toBeInstanceOf(Set)
    expect(result.current.get('e1')!.has(expected)).toBe(true)
    expect(result.current.get('e1')!.size).toBe(1)
    cleanupGlobals()
  })

  test('Test 3: accumulates multiple buckets touching the same node', () => {
    seed({
      sessions: [
        { id: 'sess-a', startAt: '2026-06-13T10:00:00Z', entityIds: ['e1'] },
        { id: 'sess-b', startAt: '2026-06-13T11:00:00Z', entityIds: ['e1'] },
      ],
      visibleIds: new Set(['e1']),
      relations: [],
    })
    const { result } = renderHook(() => useNodeToBucketsIndex(apiClient, 'coding'), {
      wrapper: makeWrapper(queryClient),
    })
    const set = result.current.get('e1')
    expect(set).toBeInstanceOf(Set)
    expect(set!.size).toBe(2)
    expect(set!.has('sess-a|2026-06-13T10:00:00Z')).toBe(true)
    expect(set!.has('sess-b|2026-06-13T11:00:00Z')).toBe(true)
    cleanupGlobals()
  })

  test('Test 4: multiple touched nodes per bucket → parallel reverse entries', () => {
    seed({
      sessions: [
        { id: 'sess-a', startAt: '2026-06-13T10:00:00Z', entityIds: ['e1', 'e2'] },
      ],
      visibleIds: new Set(['e1', 'e2']),
      relations: [],
    })
    const { result } = renderHook(() => useNodeToBucketsIndex(apiClient, 'coding'), {
      wrapper: makeWrapper(queryClient),
    })
    const bucketKey = 'sess-a|2026-06-13T10:00:00Z'
    expect(result.current.get('e1')?.has(bucketKey)).toBe(true)
    expect(result.current.get('e2')?.has(bucketKey)).toBe(true)
    expect(result.current.size).toBe(2)
    cleanupGlobals()
  })

  test('Test 5: bucket with no visible-ancestor resolutions contributes no entries', () => {
    // Entity 'orphan' is not in the visible set AND has no ancestry —
    // pickAllResolvable returns empty Set; the map gains no entries.
    seed({
      sessions: [
        { id: 'sess-empty', startAt: '2026-06-13T10:00:00Z', entityIds: ['orphan'] },
      ],
      visibleIds: new Set(['unrelated']),
      relations: [],
    })
    const { result } = renderHook(() => useNodeToBucketsIndex(apiClient, 'coding'), {
      wrapper: makeWrapper(queryClient),
    })
    expect(result.current.size).toBe(0)
    cleanupGlobals()
  })
})
