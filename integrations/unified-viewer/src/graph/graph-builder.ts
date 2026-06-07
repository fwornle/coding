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
import type { Level, ViewerState } from '@/store/viewer-store'

/**
 * Backend entities (Phase 44 /api/v1/entities) ship `entityType` but not
 * `level`. Map the well-known hierarchy class names to filter levels so
 * the Level checkboxes in FilterRail have a visible effect. Mapping
 * derived from .planning memory notes: Project = L0, Component = L1,
 * SubComponent = L2, Detail = L3. System / root nodes pin to L0.
 */
export function deriveLevel(ontologyClass: string | undefined): Level {
  // Plan 03 checkpoint round 2: unknown classes previously returned
  // undefined → fell through every level filter unconditionally. They
  // now pin to L0 so toggling L0 actually hides them, matching the
  // operator's mental model.
  switch (ontologyClass) {
    case 'Component':
    case 'Container':
    case 'Config':
    case 'Knowledge':
      return 1
    case 'SubComponent':
    case 'Feature':
    case 'File':
    case 'Observation':
      return 2
    case 'Detail':
    case 'Port':
    case 'Fault':
    case 'Digest':
    case 'Insight':
    case 'LearningArtifact':
      return 3
    // 'System' / 'Project' + every unknown class → L0
    default:
      return 0
  }
}

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
    // Backend payloads omit `level` — derive it from the well-known
    // ontology hierarchy so FilterRail's L0/L1/L2/L3 toggles actually
    // exclude nodes. Falls back to `e.level` when the backend ever
    // populates the field directly.
    const level = e.level ?? deriveLevel(e.ontologyClass)
    // mergeNode (not addNode) is idempotent — re-applying the same id with
    // the same attributes is a no-op rather than a throw.
    graph.mergeNode(e.id, {
      x: Math.random(),
      y: Math.random(),
      size: 8,
      label: e.name,
      color,
      ontologyClass: e.ontologyClass,
      level,
      description: e.description,
    })
  }
  for (const r of relations) {
    if (!graph.hasNode(r.from) || !graph.hasNode(r.to)) continue
    // mergeEdge is idempotent on undirected (key) edges.
    // Plan 03 checkpoint round 2: CSS-var color `hsl(var(--border))`
    // is not parseable by sigma's WebGL renderer and was rendering
    // invisible. Use a fixed slate hex with a slightly larger size
    // so relations are actually visible against the canvas background.
    graph.mergeEdge(r.from, r.to, { size: 1.5, color: '#cbd5e1', type: r.type })
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
    // See buildGraph note — fixed hex edges so sigma's WebGL renderer
    // actually shows them.
    graph.mergeEdge(r.from, r.to, { size: 1.5, color: '#cbd5e1', type: r.type })
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
  // Plan 03 checkpoint round 2 — semantic rewrite:
  //   "what's checked is what's visible"
  //   - visibleLevels: Set of levels currently visible. Empty = nothing.
  //   - selectedClasses: Set of classes currently visible. Empty = nothing.
  //   - Search hides non-matches outright (the prior `filter-dimmed`
  //     opacity overlay is invisible in sigma's WebGL renderer).
  // The caller (UnifiedViewer) auto-populates selectedClasses with
  // every class present in the data on first load so the default
  // experience is "all visible".

  if (store.selectedNodeId === nodeId) return 'selected'
  if (hoveredNodeId === nodeId) return 'hover'

  // Level predicate — entities always have a derived level (deriveLevel
  // pins unknown classes to L0), so the Set membership is authoritative.
  const level = attrs.level as 0 | 1 | 2 | 3 | undefined
  const levelOk = level !== undefined && store.visibleLevels.has(level)
  if (!levelOk) return 'filter-hidden'

  // Class predicate — explicit Set membership; empty Set = nothing.
  const cls = attrs.ontologyClass as string | undefined
  const classOk =
    typeof cls === 'string' && store.selectedClasses.has(cls)
  if (!classOk) return 'filter-hidden'

  // Search predicate — hide non-matches (no dim because sigma can't render opacity).
  const q = store.searchQuery.trim().toLowerCase()
  if (q.length > 0) {
    const labelText = ((attrs.label ?? attrs.name ?? '') as string).toLowerCase()
    const descText = ((attrs.description ?? '') as string).toLowerCase()
    const isMatch = labelText.includes(q) || descText.includes(q)
    return isMatch ? 'search-match' : 'filter-hidden'
  }

  return 'default'
}
