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
    // 2026-06-14 (Plan 06 Decision C — LLS-suppression test scaffolding):
    // entities are now read by useNodeToBucketsIndex for the LLS name
    // lookup that builds `noiseAncestors`. Default to empty array (no
    // suppression unless a test explicitly seeds LLS into __mockEntities).
    const ents =
      (globalThis as unknown as { __mockEntities?: unknown[] }).__mockEntities ?? []
    return {
      entities: ents,
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
  // Phase 61 Plan 03: useLslSessions's query data is now { sessions, total }
  // (the N-of-M honesty widen) — useNodeToBucketsIndex reads `data.sessions`.
  // The mock must wrap the seeded array in that shape, not return it bare.
  useLslSessions: () => {
    const sessions =
      (globalThis as unknown as { __mockSessions?: unknown[] }).__mockSessions ?? []
    return {
      data: { sessions, total: sessions.length },
      isLoading: false,
      error: null,
    }
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
  entities?: Array<{ id: string; name?: string }>
}) {
  ;(globalThis as unknown as { __mockSessions?: unknown[] }).__mockSessions =
    args.sessions ?? []
  ;(globalThis as unknown as { __mockVisibleIds?: ReadonlySet<string> }).__mockVisibleIds =
    args.visibleIds ?? new Set<string>()
  ;(globalThis as unknown as { __mockRelations?: unknown[] }).__mockRelations =
    args.relations ?? []
  ;(globalThis as unknown as { __mockEntities?: unknown[] }).__mockEntities =
    args.entities ?? []
}

function cleanupGlobals() {
  delete (globalThis as unknown as { __mockSessions?: unknown }).__mockSessions
  delete (globalThis as unknown as { __mockVisibleIds?: unknown }).__mockVisibleIds
  delete (globalThis as unknown as { __mockRelations?: unknown }).__mockRelations
  delete (globalThis as unknown as { __mockEntities?: unknown }).__mockEntities
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

  // 2026-06-14 — Plan 06 gap-closure Decision C: LLS-suppression
  // consistency between forward (strip) and reverse (this hook) directions.
  test('Test 6 [Plan 06 Decision C]: LLS is suppressed from the reverse index when the bucket has >=2 resolved ancestors — graph-click on LLS does NOT light up multi-resolution buckets', () => {
    // Fixture: each bucket has TWO different entity ids that resolve to
    // DIFFERENT ancestors. `pickAllResolvable` returns one ancestor per
    // entityId (deduplicated across ids); so two distinct entity ids each
    // hitting a different first-visible-ancestor yields a size-2 result.
    //   bucket-A: entityIds [obs-A1 → lls, obs-A2 → insight-A]
    //   bucket-B: entityIds [obs-B1 → lls, obs-B2 → insight-B]
    // Expected post-suppression reverse index:
    //   insight-A → {bucket-A}
    //   insight-B → {bucket-B}
    //   LLS → NOT in the map (suppressed from BOTH buckets — graph-click on
    //         LLS lights up zero ticks for these buckets, consistent with
    //         the forward direction never lighting LLS as a halo).
    seed({
      sessions: [
        { id: 'bucket-A', startAt: '2026-06-13T10:00:00Z', entityIds: ['obs-A1', 'obs-A2'] },
        { id: 'bucket-B', startAt: '2026-06-13T11:00:00Z', entityIds: ['obs-B1', 'obs-B2'] },
      ],
      visibleIds: new Set(['lls', 'insight-A', 'insight-B']),
      relations: [
        // obs-A1 only resolves to LLS (capturedBy 1-hop fallback).
        { from: 'lls', to: 'obs-A1', type: 'capturedBy' },
        // obs-A2 only resolves to insight-A.
        { from: 'insight-A', to: 'obs-A2', type: 'contains' },
        { from: 'lls', to: 'obs-B1', type: 'capturedBy' },
        { from: 'insight-B', to: 'obs-B2', type: 'contains' },
      ],
      entities: [{ id: 'lls', name: 'LiveLoggingSystem' }],
    })
    const { result } = renderHook(() => useNodeToBucketsIndex(apiClient, 'coding'), {
      wrapper: makeWrapper(queryClient),
    })
    expect(result.current.get('insight-A')?.has('bucket-A|2026-06-13T10:00:00Z')).toBe(true)
    expect(result.current.get('insight-B')?.has('bucket-B|2026-06-13T11:00:00Z')).toBe(true)
    // LLS suppressed from BOTH multi-resolution buckets.
    expect(result.current.has('lls')).toBe(false)
    cleanupGlobals()
  })

  test('Test 7 [Plan 06 Decision C — Q1 option iii]: LLS-only bucket (no other resolved ancestor) keeps LLS in the reverse index so graph-click on LLS still lights up these buckets', () => {
    // The seed has 49+ LLS-only buckets — every Observation resolves to LLS
    // via the capturedBy 1-hop fallback, and there's no other ancestor.
    // Suppressing LLS for these too would mean LLS-only buckets vanish
    // from BOTH forward and reverse views — operator loses observability
    // into ~65% of timeline activity. Q1 option iii: suppress only when
    // there's something better; keep LLS when it's the only result.
    seed({
      sessions: [
        { id: 'bucket-LLSonly', startAt: '2026-06-13T10:00:00Z', entityIds: ['obs-X'] },
      ],
      visibleIds: new Set(['lls']),
      relations: [
        { from: 'lls', to: 'obs-X', type: 'capturedBy' },
      ],
      entities: [{ id: 'lls', name: 'LiveLoggingSystem' }],
    })
    const { result } = renderHook(() => useNodeToBucketsIndex(apiClient, 'coding'), {
      wrapper: makeWrapper(queryClient),
    })
    // LLS-only bucket: LLS resolves (suppression skipped because size===1)
    // → LLS lights up via graph-click for this bucket.
    expect(result.current.get('lls')?.has('bucket-LLSonly|2026-06-13T10:00:00Z')).toBe(true)
    cleanupGlobals()
  })
})
