// useGraphData hook tests — verifies the three query keys are partitioned
// by [dataset, system] so cross-system switches don't leak cached data.

import { describe, test, expect, beforeEach, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import React from 'react'
import { ENTITIES_KEY, ONTOLOGY_KEY, RELATIONS_KEY, useGraphData } from './useGraphData'
import { ApiClient } from '@/api/ApiClient'

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client }, children)
  }
}

describe('useGraphData', () => {
  let queryClient: QueryClient
  let apiClient: ApiClient
  let listEntitiesSpy: ReturnType<typeof vi.fn>
  let listRelationsSpy: ReturnType<typeof vi.fn>
  let listOntologyClassesSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    apiClient = new ApiClient('http://example.invalid')
    listEntitiesSpy = vi.fn().mockResolvedValue([
      { id: 'a', name: 'Alpha', ontologyClass: 'Observation' },
    ])
    listRelationsSpy = vi.fn().mockResolvedValue([
      { from: 'a', to: 'b', type: 'derives_from' },
    ])
    listOntologyClassesSpy = vi.fn().mockResolvedValue([{ name: 'Observation' }])
    apiClient.listEntities = listEntitiesSpy as unknown as typeof apiClient.listEntities
    apiClient.listRelations = listRelationsSpy as unknown as typeof apiClient.listRelations
    apiClient.listOntologyClasses = listOntologyClassesSpy as unknown as typeof apiClient.listOntologyClasses
  })

  test('Test 1: issues exactly three queries with keys [entities|relations|ontology, system]', async () => {
    const { result } = renderHook(() => useGraphData(apiClient, 'coding'), {
      wrapper: makeWrapper(queryClient),
    })
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    // Verify the keys ended up in the QueryClient cache exactly as specced
    const keys = queryClient
      .getQueryCache()
      .getAll()
      .map((q) => q.queryKey)
    expect(keys).toContainEqual([ENTITIES_KEY, 'coding'])
    expect(keys).toContainEqual([RELATIONS_KEY, 'coding'])
    expect(keys).toContainEqual([ONTOLOGY_KEY, 'coding'])
    expect(keys.length).toBe(3)

    expect(listEntitiesSpy).toHaveBeenCalledTimes(1)
    expect(listRelationsSpy).toHaveBeenCalledTimes(1)
    expect(listOntologyClassesSpy).toHaveBeenCalledTimes(1)
  })

  test('keys differ between systems — switching systems partitions the cache', async () => {
    // Use the same shared cache to demonstrate partition
    const { result: codingResult, unmount: unmountCoding } = renderHook(
      () => useGraphData(apiClient, 'coding'),
      { wrapper: makeWrapper(queryClient) },
    )
    await waitFor(() => {
      expect(codingResult.current.isLoading).toBe(false)
    })
    unmountCoding()

    const { result: okbResult } = renderHook(() => useGraphData(apiClient, 'okb'), {
      wrapper: makeWrapper(queryClient),
    })
    await waitFor(() => {
      expect(okbResult.current.isLoading).toBe(false)
    })

    const keys = queryClient
      .getQueryCache()
      .getAll()
      .map((q) => q.queryKey)
    // BOTH systems' keys are present — they did not collide
    expect(keys).toContainEqual([ENTITIES_KEY, 'coding'])
    expect(keys).toContainEqual([ENTITIES_KEY, 'okb'])
    expect(listEntitiesSpy).toHaveBeenCalledTimes(2) // once per system
  })

  test('isLoading true while any underlying query is pending', () => {
    const { result } = renderHook(() => useGraphData(apiClient, 'coding'), {
      wrapper: makeWrapper(queryClient),
    })
    // Synchronously immediate — at first render, queries are pending
    expect(result.current.isLoading).toBe(true)
    expect(result.current.entities).toEqual([])
    expect(result.current.relations).toEqual([])
    expect(result.current.ontology).toEqual([])
  })
})
