// Pure builders for graphology Graph construction + per-node state derivation.
// Lives separately from SigmaCanvas.tsx so unit tests can run without
// the @react-sigma context (which needs WebGL — unavailable under jsdom).
//
// PATTERN SOURCES:
//   - 45-PATTERNS.md § SigmaCanvas.tsx (graph build excerpt)
//   - 45-UI-SPEC.md § Color State (state transitions)

import Graph from 'graphology'
import { classColor } from './color-fallback'
import type { Entity, NodeState, OntologyClass, Relation } from './types'
import type { ViewerState } from '@/store/viewer-store'

/**
 * Build a graphology Graph from API payloads. Random initial positions —
 * ForceAtlas2 settles them in the SigmaCanvas effect.
 *
 * Idempotent on node ids: re-adding the same id is a no-op via mergeNode
 * (Pitfall T-45-02-04 mitigation — double-click expand can hand us the
 * same node twice).
 */
export function buildGraph(
  entities: ReadonlyArray<Entity>,
  relations: ReadonlyArray<Relation>,
  ontology: ReadonlyArray<OntologyClass>,
  theme: 'light' | 'dark',
): Graph {
  const graph = new Graph({ multi: false, allowSelfLoops: true, type: 'undirected' })
  for (const e of entities) {
    const cls = ontology.find((c) => c.name === e.ontologyClass)
    const color = cls?.display?.color ?? classColor(e.ontologyClass, theme)
    // mergeNode (not addNode) is idempotent — re-applying the same id with
    // the same attributes is a no-op rather than a throw.
    graph.mergeNode(e.id, {
      x: Math.random(),
      y: Math.random(),
      size: 8,
      label: e.name,
      color,
      ontologyClass: e.ontologyClass,
      level: e.level,
      description: e.description,
    })
  }
  for (const r of relations) {
    if (!graph.hasNode(r.from) || !graph.hasNode(r.to)) continue
    // mergeEdge is idempotent on undirected (key) edges
    graph.mergeEdge(r.from, r.to, { size: 1, color: 'hsl(var(--border))', type: r.type })
  }
  return graph
}

/**
 * Merge new entities + relations into an existing graphology Graph
 * idempotently. Returns the count of newly-added nodes (for caller's
 * "did anything actually expand?" decision).
 *
 * T-45-02-04 mitigation: double-clicking the same node twice MUST NOT
 * grow `graph.order` — verified by node-renderer tests.
 */
export function mergeIntoGraph(
  graph: Graph,
  payload: { entities: ReadonlyArray<Entity>; relations: ReadonlyArray<Relation> },
  ontology: ReadonlyArray<OntologyClass>,
  theme: 'light' | 'dark',
): number {
  const before = graph.order
  for (const e of payload.entities) {
    const cls = ontology.find((c) => c.name === e.ontologyClass)
    const color = cls?.display?.color ?? classColor(e.ontologyClass, theme)
    if (graph.hasNode(e.id)) {
      // Idempotent attribute merge — extends existing node without re-creating.
      graph.mergeNodeAttributes(e.id, {
        label: e.name,
        color,
        ontologyClass: e.ontologyClass,
        level: e.level,
        description: e.description,
      })
    } else {
      graph.addNode(e.id, {
        x: Math.random(),
        y: Math.random(),
        size: 8,
        label: e.name,
        color,
        ontologyClass: e.ontologyClass,
        level: e.level,
        description: e.description,
      })
    }
  }
  for (const r of payload.relations) {
    if (!graph.hasNode(r.from) || !graph.hasNode(r.to)) continue
    graph.mergeEdge(r.from, r.to, { size: 1, color: 'hsl(var(--border))', type: r.type })
  }
  return graph.order - before
}

/**
 * Resolve the rendering state for a single node, given the current
 * Zustand store snapshot. Implements UI-SPEC § Color State table —
 * the precedence ordering matters:
 *
 *   1. hover (handled in SigmaCanvas via local state, not here)
 *   2. selected
 *   3. search-match  — when searchQuery is non-empty AND name/description matches
 *   4. filter-hidden — when level/class filter excludes AND search is inactive
 *   5. filter-dimmed — when level/class filter excludes AND search IS active
 *                      AND the node matches the search
 *   6. default
 */
export interface NodeAttrs {
  name?: string
  label?: string
  description?: string
  ontologyClass?: string
  level?: number
  [k: string]: unknown
}

export function computeNodeState(
  nodeId: string,
  attrs: NodeAttrs,
  store: Pick<ViewerState, 'selectedNodeId' | 'searchQuery' | 'visibleLevels' | 'selectedClasses'>,
  hoveredNodeId: string | null = null,
): NodeState {
  // 1. hover wins over everything except selected
  // (selected stroke is wider, but UI-SPEC keeps selected above hover)
  if (store.selectedNodeId === nodeId) return 'selected'
  if (hoveredNodeId === nodeId) return 'hover'

  const q = store.searchQuery.trim().toLowerCase()
  const labelText = ((attrs.label ?? attrs.name ?? '') as string).toLowerCase()
  const descText = ((attrs.description ?? '') as string).toLowerCase()
  const isSearchActive = q.length > 0
  const isSearchMatch = isSearchActive && (labelText.includes(q) || descText.includes(q))

  // Filter exclusion check
  const levelOk = attrs.level === undefined ||
    store.visibleLevels.has(attrs.level as 0 | 1 | 2 | 3)
  const classOk = store.selectedClasses.size === 0 ||
    (typeof attrs.ontologyClass === 'string' && store.selectedClasses.has(attrs.ontologyClass))
  const filterExcludes = !(levelOk && classOk)

  if (isSearchActive) {
    // Search dominates filter — matches dim if excluded, else default-search-match
    if (isSearchMatch) {
      return filterExcludes ? 'filter-dimmed' : 'search-match'
    }
    // Search active, not a match → dimmed (graceful overlap)
    return 'filter-dimmed'
  }

  // No search → filter excludes hides the node entirely
  if (filterExcludes) return 'filter-hidden'

  return 'default'
}
