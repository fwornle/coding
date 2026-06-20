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
    case 'OnlineObservation':
      return 2
    case 'Detail':
    case 'Port':
    case 'Fault':
    case 'Digest':
    case 'Insight':
    case 'LearningArtifact':
    case 'OnlineDigest':
    case 'OnlineInsight':
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

  // 2026-06-11 (tenth iteration): HIERARCHICAL ISLAND LAYOUT.
  // User feedback: "I want the layout to show those islands — round
  // around each project, projects around the central node". The single
  // ring (ninth iteration) flattened all topology and made it impossible
  // to read the System → Project → Component → … structure.
  //
  // Strategy:
  //   1. System (CollectiveKnowledge) pinned at (0, 0).
  //   2. Projects (Coding, Normalisa, Timeline, DynArch) on a ring
  //      around System at PROJECT_R.
  //   3. For each Project, BFS down through hierarchy edges
  //      (parent-child / contains / has_insight) to claim its descendant
  //      subtree. Each node belongs to AT MOST one project (first claim
  //      wins, deterministic by Project iteration order).
  //   4. Each Project's subtree is packed into a disc around its
  //      Project node, disc radius proportional to sqrt(subtree size).
  //   5. Unowned entities (Observations / Digests pointing at System
  //      via capturedBy, or true orphans) scatter on an outer ring.
  //
  // This produces VKB's "islands of related nodes around projects" look
  // and gives the path-trace visible blue lines: the click handler walks
  // parent-child edges back to System, and those edges now span sensible
  // distances across the canvas.
  const HIERARCHY_REL = new Set(['parent-child', 'contains', 'has_insight'])
  const systemEnt = entities.find((e) => e.ontologyClass === 'System')
  const projectEnts = entities.filter((e) => e.ontologyClass === 'Project')

  // BFS from each project to claim its subtree. Hierarchy edges are
  // directional but ownership should follow either direction (some
  // legacy data has the edge reversed) — treat them as undirected for
  // ownership only.
  const ownerOf = new Map<string, string>() // entityId → projectId
  if (systemEnt) ownerOf.set(systemEnt.id, systemEnt.id)
  for (const p of projectEnts) {
    if (ownerOf.has(p.id)) continue
    ownerOf.set(p.id, p.id)
    const queue: string[] = [p.id]
    while (queue.length) {
      const cur = queue.shift() as string
      for (const r of relations) {
        if (!HIERARCHY_REL.has(r.type)) continue
        const next = r.from === cur ? r.to : r.to === cur ? r.from : null
        if (!next) continue
        if (ownerOf.has(next)) continue
        if (next === systemEnt?.id) continue
        ownerOf.set(next, p.id)
        queue.push(next)
      }
    }
  }

  // Compute project positions on a ring around System.
  const PROJECT_R = 1400
  const projectPos = new Map<string, { x: number; y: number }>()
  projectEnts.forEach((p, i) => {
    const angle = (i / Math.max(projectEnts.length, 1)) * 2 * Math.PI - Math.PI / 2
    projectPos.set(p.id, {
      x: PROJECT_R * Math.cos(angle),
      y: PROJECT_R * Math.sin(angle),
    })
  })

  // Bucket children by project so each disc can be sized to its content.
  const childrenByProject = new Map<string, string[]>()
  for (const [entId, pId] of ownerOf) {
    if (entId === pId) continue
    if (!childrenByProject.has(pId)) childrenByProject.set(pId, [])
    childrenByProject.get(pId)!.push(entId)
  }

  // Place each subtree node inside its project's disc. Random angle +
  // varying radius distributes them through the disc (not a hard ring).
  const positionFor = new Map<string, { x: number; y: number }>()
  childrenByProject.forEach((kids, pId) => {
    const pPos = projectPos.get(pId)
    if (!pPos) return
    const discR = Math.max(180, Math.sqrt(kids.length) * 32)
    kids.forEach((kid) => {
      const angle = Math.random() * 2 * Math.PI
      const r = discR * Math.sqrt(Math.random()) // uniform in disc
      positionFor.set(kid, {
        x: pPos.x + r * Math.cos(angle),
        y: pPos.y + r * Math.sin(angle),
      })
    })
  })

  // Unowned (no path back to a Project via hierarchy edges) scatter on
  // a wide outer ring well clear of the project discs.
  const ORPHAN_RING = PROJECT_R * 2.2
  for (const e of entities) {
    const cls = ontology.find((c) => c.name === e.ontologyClass)
    // 2026-06-11: pass entity source (auto vs manual) into classColor so
    // online-learned nodes render in the red palette instead of the blue
    // hierarchy. The overlay (ontology.display.color) still wins when
    // present.
    const entSource = (e.metadata as { source?: string } | undefined)?.source
    const color = cls?.display?.color ?? classColor(e.ontologyClass, theme, entSource)
    // Backend payloads omit `level` — derive it from the well-known
    // ontology hierarchy so FilterRail's L0/L1/L2/L3 toggles actually
    // exclude nodes. Falls back to `e.level` when the backend ever
    // populates the field directly.
    const level = e.level ?? deriveLevel(e.ontologyClass)
    // 2026-06-11 (tenth iteration): hierarchical seed lookups.
    //   1. System → origin
    //   2. Project → pre-computed ring position
    //   3. Owned child → pre-computed disc position around its Project
    //   4. Unowned → outer scatter ring
    let seedX: number
    let seedY: number
    if (systemEnt && e.id === systemEnt.id) {
      seedX = 0
      seedY = 0
    } else if (projectPos.has(e.id)) {
      const p = projectPos.get(e.id) as { x: number; y: number }
      seedX = p.x
      seedY = p.y
    } else if (positionFor.has(e.id)) {
      const p = positionFor.get(e.id) as { x: number; y: number }
      seedX = p.x
      seedY = p.y
    } else {
      // Unowned: outer ring scatter so they're visible but separate.
      const angle = Math.random() * 2 * Math.PI
      const r = ORPHAN_RING * (0.85 + Math.random() * 0.3)
      seedX = r * Math.cos(angle)
      seedY = r * Math.sin(angle)
    }

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
    //
    // size:4 matches the VKB reference node radius — the old `size:8`
    // produced "mega-dot" nodes that occluded each other after collapse.
    // Position is the circular seed computed above.
    // 2026-06-11: VKB-style "Has Insight Doc" indicator. Any entity whose
    // name COULD have a markdown insight document under
    // knowledge-management/insights/ gets the border. The same predicate
    // used by the "View Insight Document" link in EntityDetailPanel: short
    // PascalCase identifier (no spaces / punctuation, <=60 chars). This
    // matches the legend chip in the VKB reference and the bordered nodes
    // VKB shows for Components/SubComponents with attached docs — not just
    // Insight-type entities.
    const nameStr = (e.name as string) || ''
    const hasInsightDoc =
      nameStr.length > 0 && nameStr.length <= 60 && !/[\s:()/?#]/.test(nameStr)
    graph.mergeNode(e.id, {
      x: seedX,
      y: seedY,
      // 2026-06-11: VKB-parity bump 2 → 5. The previous size:2 was a
      // "mega-dot" overcorrection from earlier in the day — VKB nodes
      // are visibly chunky (~5-6 px) and the user wants the same.
      size: 5,
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
      hasInsightDoc,
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
    // 2026-06-11: weight `capturedBy` low so FA2 doesn't drag every
    // Insight into a tight cluster around LiveLoggingSystem (the anchor
    // hub). ObservationWriter adds these edges to keep new entities from
    // becoming orphans, but they're structural plumbing, not semantic
    // relations — they shouldn't dominate the force layout. Edge weight
    // 0.05 (vs default 1.0 for real relations) makes them invisible to
    // FA2's attraction while still keeping them in the graph for
    // click/navigation. FA2's `edgeWeightInfluence: 1` setting (default)
    // reads this attribute.
    const layoutWeight = r.type === 'capturedBy' ? 0.05 : 1.0
    // 2026-06-11: edge thickness dropped from 1.5 → 0.5 to match VKB's
    // thin hairline edges. With 1300+ edges in the graph the old 1.5
    // size painted a uniform gray haze that obscured the nodes.
    graph.mergeEdge(r.from, r.to, {
      size: 0.5,
      color: '#cbd5e1',
      relationType: r.type,
      weight: layoutWeight,
    })
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
    const entSource = (e.metadata as { source?: string } | undefined)?.source
    const color = cls?.display?.color ?? classColor(e.ontologyClass, theme, entSource)
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
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: 2,
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
  // `pathToSelected` is optional so existing test fixtures don't need
  // updating; the runtime check below tolerates `undefined`. (Path
  // highlight was added 2026-06-11 as a VKB-reference feature.)
  // 2026-06-13 (Phase 56.1 Plan 05): the deleted Phase 56 `selectedNodeId`
  // is replaced by the derived `focalNodeId` singleton — the sigma node
  // "selected" predicate keys on the focal entity.
  store: Pick<ViewerState, 'focalNodeId' | 'searchQuery' | 'visibleLevels' | 'selectedClasses'> & {
    pathToSelected?: ReadonlySet<string>
    learningSource?: 'batch' | 'online' | 'combined'
    selectedTeams?: ReadonlySet<string>
  },
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

  if (store.focalNodeId === nodeId) return 'selected'
  if (hoveredNodeId === nodeId) return 'hover'

  // 2026-06-11: ancestry path highlight (VKB reference). When a node is
  // selected, the click handler computes the ancestor chain via
  // contains/parent-child edges and stores it in `pathToSelected`. Nodes
  // outside the path get the dimmed style so the hierarchy trace stands
  // out. When nothing is selected the path is empty → this branch is a
  // no-op.
  if (store.pathToSelected && store.pathToSelected.size > 0 && !store.pathToSelected.has(nodeId)) {
    return 'filter-dimmed'
  }

  // 2026-06-11: Learning Source predicate. 'combined' (default) lets
  // everything through. 'batch' shows only entities whose
  // metadata.source !== 'auto' (i.e. manual / migration / wave-analysis).
  // 'online' shows the opposite. EXCEPTION: System / Project /
  // Component nodes are structural backbone — they ALWAYS render
  // regardless of source so the hierarchy stays anchored even when the
  // user is filtering to online-only or batch-only. VKB reference
  // behaviour: the green System node + dark-blue Components stay put;
  // only Detail/SubComponent/leaf nodes follow the source filter.
  if (store.learningSource && store.learningSource !== 'combined') {
    const ocls = attrs.ontologyClass as string | undefined
    const isStructural = ocls === 'System' || ocls === 'Project' || ocls === 'Component'
    if (!isStructural) {
      const meta = attrs.metadata as { source?: string } | undefined
      const isAuto = (meta?.source) === 'auto'
      if (store.learningSource === 'online' && !isAuto) return 'filter-hidden'
      if (store.learningSource === 'batch' && isAuto) return 'filter-hidden'
    }
  }

  // 2026-06-11: Teams predicate. Empty set = "all visible" (same convention
  // as LayerFilter / OntologyFilter). The sentinel `__none__` means "none
  // visible" — emitted by the TeamsFilter "None" button.
  if (store.selectedTeams && store.selectedTeams.size > 0) {
    if (store.selectedTeams.has('__none__')) return 'filter-hidden'
    const meta = attrs.metadata as { team?: string; project?: string } | undefined
    // Phase 57 D-11 transitional read — prefer metadata.project (new writers,
    // Plan 03 onwards) over metadata.team (legacy). selectedTeams (the Set
    // name) is INTENTIONALLY NOT renamed in this phase; Phase 60 owns the
    // rename + filter-UI rework per LOWERONTO-03.
    const team = meta?.project ?? meta?.team ?? 'coding'
    if (!store.selectedTeams.has(team)) return 'filter-hidden'
  }

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
