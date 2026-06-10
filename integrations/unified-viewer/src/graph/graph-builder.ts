// Pure builders for graphology Graph construction + per-node state derivation.
// Lives separately from SigmaCanvas.tsx so unit tests can run without
// the @react-sigma context (which needs WebGL — unavailable under jsdom).
//
// PATTERN SOURCES:
//   - 45-PATTERNS.md § SigmaCanvas.tsx (graph build excerpt)
//   - 45-UI-SPEC.md § Color State (state transitions)

import Graph from 'graphology'
import {
  borderStyleFallback,
  classColor,
  pulseRuleFallback,
  shapeFallback,
} from './color-fallback'
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

  // Plan 55-05 (UI-SPEC §14 rule #4): orphan-on-current-view rule is
  // applied AT BUILD TIME. Pre-compute "has any relation in the current
  // view" per node id BEFORE stamping nodes, so each node carries the
  // correct `borderStyle` attribute when it lands in the graph. Only
  // count relations whose BOTH endpoints exist in `entities` — relations
  // pointing at non-existent ids are skipped at edge-merge time below.
  const entityIds = new Set<string>(entities.map((e) => e.id))
  const hasRelationsById = new Set<string>()
  for (const r of relations) {
    if (entityIds.has(r.from) && entityIds.has(r.to)) {
      hasRelationsById.add(r.from)
      hasRelationsById.add(r.to)
    }
  }

  for (const e of entities) {
    const cls = ontology.find((c) => c.name === e.ontologyClass)
    const color = cls?.display?.color ?? classColor(e.ontologyClass, theme)
    // Backend payloads omit `level` — derive it from the well-known
    // ontology hierarchy so FilterRail's L0/L1/L2/L3 toggles actually
    // exclude nodes. Falls back to `e.level` when the backend ever
    // populates the field directly.
    const level = e.level ?? deriveLevel(e.ontologyClass)

    // Plan 55-05 (UI-SPEC §14 rules #2, #4, #5): the fallback chain.
    //   shape:       overlay → shapeFallback(class) → 'circle'
    //   borderStyle: overlay==='dashed' → dashed
    //                else hasRelations? solid : dashed
    //                (orphan rule wins over overlay's solid; overlay
    //                 'dashed' wins over the orphan check via the first
    //                 branch — i.e. an entity overlay-marked dashed
    //                 stays dashed even with relations)
    //   pulseRule:   overlay → pulseRuleFallback (null)
    const shape = cls?.display?.shape ?? shapeFallback(e.ontologyClass)
    const hasRelations = hasRelationsById.has(e.id)
    const overlayBorder = cls?.display?.borderStyle
    const borderStyle: 'solid' | 'dashed' =
      overlayBorder === 'dashed'
        ? 'dashed'
        : borderStyleFallback(e.ontologyClass, hasRelations)
    // pulseRule overlay can be `null` (explicit "no pulse") OR `undefined`
    // (overlay didn't specify). Both fall back to pulseRuleFallback (null).
    // We surface the chosen rule string (or null) so the per-frame reducer
    // can evaluate it against the entity's updatedAt / metadata.
    const pulseRule: string | null =
      cls?.display?.pulseRule ?? pulseRuleFallback(e.ontologyClass)

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
      // Plan 55-05 visual encoding attrs (consumed by the reducer +
      // sigma node program registered in SigmaCanvas).
      shape,
      borderStyle,
      pulseRule,
      // Pulse evaluator needs these; thread through verbatim so the
      // reducer can call evaluatePulseRule(rule, attrs as Entity).
      updatedAt: (e as { updatedAt?: string }).updatedAt,
      metadata: e.metadata,
    })
  }
  for (const r of relations) {
    if (!graph.hasNode(r.from) || !graph.hasNode(r.to)) continue
    // mergeEdge is idempotent on undirected (key) edges.
    // Plan 03 checkpoint round 2: CSS-var color `hsl(var(--border))`
    // is not parseable by sigma's WebGL renderer and was rendering
    // invisible. Use a fixed slate hex with a slightly larger size
    // so relations are actually visible against the canvas background.
    //
    // CRITICAL: Sigma reserves the `type` attribute as the edge-program
    // selector ("arrow", "curve", etc.). Passing a relation type like
    // "includes" / "parent-child" / "related_to" through it crashes the
    // WebGL renderer ("could not find a suitable program for edge type X").
    // We stash the actual relation type under `relationType` for downstream
    // consumers (tooltips, filters) and leave `type` unset so Sigma uses
    // its default program.
    graph.mergeEdge(r.from, r.to, { size: 1.5, color: '#cbd5e1', relationType: r.type })
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
  // For incremental merges we cannot trivially recompute the orphan rule
  // for every PRE-EXISTING node (that would require a full graph scan on
  // every neighbor expand). Strategy:
  //   - For the NEW nodes in this payload, compute "has relation in this
  //     payload's relation set" — same as buildGraph does for the full
  //     payload.
  //   - For nodes that GAIN a relation through this merge, flip their
  //     `borderStyle` to 'solid' if currently 'dashed' AND they didn't
  //     come in with an explicit overlay 'dashed' (we can't easily tell
  //     after the fact, so we re-derive from current ontology overlay).
  //     This keeps the visual contract correct over time.
  for (const e of payload.entities) {
    const cls = ontology.find((c) => c.name === e.ontologyClass)
    const color = cls?.display?.color ?? classColor(e.ontologyClass, theme)
    // Plan 55-05 attrs — derive at merge time. For the brand-new node
    // path, hasRelations is computed from the payload's relations.
    const shape = cls?.display?.shape ?? shapeFallback(e.ontologyClass)
    const hasRelationsInPayload = payload.relations.some(
      (r) => r.from === e.id || r.to === e.id,
    )
    const overlayBorder = cls?.display?.borderStyle
    const borderStyle: 'solid' | 'dashed' =
      overlayBorder === 'dashed'
        ? 'dashed'
        : borderStyleFallback(e.ontologyClass, hasRelationsInPayload)
    const pulseRule: string | null =
      cls?.display?.pulseRule ?? pulseRuleFallback(e.ontologyClass)

    if (graph.hasNode(e.id)) {
      // Idempotent attribute merge — extends existing node without re-creating.
      // For existing nodes, only flip `borderStyle` from 'dashed' to 'solid'
      // if THIS merge introduces a relation that makes it non-orphan
      // (and the overlay doesn't say 'dashed').
      const existingBorder = graph.getNodeAttribute(e.id, 'borderStyle') as
        | 'solid'
        | 'dashed'
        | undefined
      const nextBorder: 'solid' | 'dashed' =
        overlayBorder === 'dashed'
          ? 'dashed'
          : hasRelationsInPayload || existingBorder === 'solid'
            ? 'solid'
            : (existingBorder ?? 'dashed')
      graph.mergeNodeAttributes(e.id, {
        label: e.name,
        color,
        ontologyClass: e.ontologyClass,
        level: e.level,
        description: e.description,
        shape,
        borderStyle: nextBorder,
        pulseRule,
        updatedAt: (e as { updatedAt?: string }).updatedAt,
        metadata: e.metadata,
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
        shape,
        borderStyle,
        pulseRule,
        updatedAt: (e as { updatedAt?: string }).updatedAt,
        metadata: e.metadata,
      })
    }
  }
  for (const r of payload.relations) {
    if (!graph.hasNode(r.from) || !graph.hasNode(r.to)) continue
    // See buildGraph note — fixed hex edges so sigma's WebGL renderer
    // actually shows them. `type` is Sigma's program selector, so the
    // actual relation type lives under `relationType`.
    graph.mergeEdge(r.from, r.to, { size: 1.5, color: '#cbd5e1', relationType: r.type })
    // Flip endpoints' borderStyle from 'dashed' → 'solid' on edge add
    // UNLESS their ontology overlay opts into 'dashed' explicitly. We
    // don't have ontology lookup here, so optimistically clear the
    // orphan flag — subsequent ontology overlay refreshes can re-apply.
    for (const endpoint of [r.from, r.to]) {
      const cur = graph.getNodeAttribute(endpoint, 'borderStyle')
      if (cur === 'dashed') {
        const cls = graph.getNodeAttribute(endpoint, 'ontologyClass') as
          | string
          | undefined
        const overlay = ontology.find((c) => c.name === cls)?.display
          ?.borderStyle
        if (overlay !== 'dashed') {
          graph.setNodeAttribute(endpoint, 'borderStyle', 'solid')
        }
      }
    }
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
