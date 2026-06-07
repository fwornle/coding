// PATTERN SOURCE: 45-RESEARCH.md Pattern 2 (TanStack Query keyed by [dataset, system])
//                 + 45-PATTERNS.md § useGraphData.ts
//
// Three useQuery hooks (entities / relations / ontology) combined into a
// single hook return. All keyed by `[<dataset>, system]` so swapping
// systems via /viewer/:system param cleanly partitions the cache —
// Pitfall 2 mitigation (no cross-system data leak).
//
// staleTime 30s matches main.tsx QueryClient default. refetchOnWindowFocus
// stays at the QueryClient default (true) so the viewer picks up new
// entities written by the backend while the user keeps the tab open.

import { useQuery } from '@tanstack/react-query'
import type { ApiClient, Entity as ApiEntity, OntologyClass as ApiOntologyClass, Relation as ApiRelation } from '@/api/ApiClient'
import type { System } from '@/config/system-endpoints'
import type { Entity, OntologyClass, Relation } from './types'

/** Cache keys — exported for test introspection. */
export const ENTITIES_KEY = 'entities' as const
export const RELATIONS_KEY = 'relations' as const
export const ONTOLOGY_KEY = 'ontology' as const

export interface GraphDataResult {
  entities: Entity[]
  relations: Relation[]
  ontology: OntologyClass[]
  isLoading: boolean
  error: Error | null
}

/**
 * Combined hook. Three queries fire in parallel; isLoading is true while
 * any one of them is still pending. error reports the first non-null.
 */
export function useGraphData(apiClient: ApiClient, system: System): GraphDataResult {
  const entitiesQ = useQuery({
    queryKey: [ENTITIES_KEY, system],
    queryFn: () => apiClient.listEntities(),
    staleTime: 30_000,
  })

  const relationsQ = useQuery({
    queryKey: [RELATIONS_KEY, system],
    queryFn: () => apiClient.listRelations(),
    staleTime: 30_000,
  })

  const ontologyQ = useQuery({
    queryKey: [ONTOLOGY_KEY, system],
    queryFn: () => apiClient.listOntologyClasses(),
    staleTime: 30_000,
  })

  return {
    entities: (entitiesQ.data ?? []) as Entity[],
    relations: ((relationsQ.data ?? []) as ApiRelation[]).map(
      // ApiRelation has optional `type`; our domain Relation requires it.
      (r) => ({ from: r.from, to: r.to, type: r.type ?? 'related' }) as Relation,
    ),
    ontology: (ontologyQ.data ?? []) as OntologyClass[],
    isLoading: entitiesQ.isLoading || relationsQ.isLoading || ontologyQ.isLoading,
    error:
      (entitiesQ.error as Error | null) ??
      (relationsQ.error as Error | null) ??
      (ontologyQ.error as Error | null),
  }
}

// Unused-import shim: keep ApiEntity import live without TS6133 warnings
// (we re-export the wire shape from `@/api/ApiClient` for callers but the
// hook's return type is the graph-domain shape from `./types`).
export type { ApiEntity, ApiOntologyClass }
