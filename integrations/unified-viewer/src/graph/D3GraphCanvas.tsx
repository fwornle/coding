// D3GraphCanvas — port of memory-visualizer's GraphVisualization.tsx
// (the original VKB component), adapted to the unified-viewer's data
// hook (useGraphData) and Zustand store (useViewerStore).
//
// Why this exists: every attempt to reproduce VKB's force-directed look
// with sigma + graphology-layout-* drifted further from the reference.
// VKB ships d3.forceSimulation with d3.forceLink(150) + d3.forceManyBody
// (-500) on an SVG canvas — that combination is what produces the
// organic clusters / radial fan-out the user wants. Lifting it gives
// pixel-near parity without compounding port-and-tune iterations.
//
// SOURCE: integrations/memory-visualizer/src/components/KnowledgeGraph/
//         GraphVisualization.tsx (D3 + Redux variant). Redux deps
//         replaced with useViewerStore reads; data hook replaced with
//         useGraphData; rendering loop + force settings kept verbatim.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as d3 from 'd3'

import type { ApiClient } from '@/api/ApiClient'
import type { System } from '@/config/system-endpoints'
import { useViewerStore } from '@/store/viewer-store'
import type { SelectionSource } from '@/store/viewer-store'
import { useGraphData } from './useGraphData'
import type { Entity, Relation } from './types'
// 2026-06-13 (Phase 56-04): computeAncestryPath extracted to a shared
// module so LslTimelineStrip's onTickClick can reuse it for the central-
// trace render when its tick click resolves a focal entity. The original
// inline implementation at lines 62-126 was bit-identical to this
// import — extraction is a pure code-move, no behaviour change here.
//
// 2026-06-13 (Phase 56-04 continuation 2 SPEC CHANGE): the previous version
// of this file also defined a centering useEffect that panned the SVG
// viewport when `selectionSource !== 'graph'` AND `selectedNodeId` changed.
// The operator's second-smoke feedback retracted that contract: "Maybe the
// zoom is not a good idea and you should just select the chosen node in
// the main graph (red circle) plus trace to CK plus sidebar text." AC #3
// is now fulfilled by the existing `applySelectionStyling` (ring + ancestry
// trace) + the EntityDetailPanel mount that already fires on selectedNodeId
// !== null. The viewport is intentionally untouched on non-graph selection.
// The `selectionSource` subscription, the `d3NodesRef` (used to read mutated
// x/y for centering), and the centering useEffect itself are all removed.
// See `docs(56-04): retract pan/zoom centering from AC #3 …` for the spec
// audit trail.
import { computeAncestryPath, type AncestryPathResult } from './ancestry'
// 2026-06-13 (Phase 56-04 round 4 — phantom-id resolution): the LSL
// timeline strip needs the same visibility predicate D3GraphCanvas uses
// so it can resolve bucket entity ids to graph-visible ancestors before
// writing `selectedNodeId`. Extracting the predicate as a pure function
// shared between D3GraphCanvas (here) and `useVisibleEntityIds` (the
// strip's source-of-truth hook) closes the round-4 phantom-id bug
// without forcing the strip to subscribe to all 10 store fields the
// memo here depends on. Predicate is bit-identical to the prior inline
// body — G1-G5 + G9-G13 source-grep gates continue to pass.
import { isEntityVisible } from './visibility-predicate'
// 2026-06-13 (Phase 56.1 Plan 05 — D-2 reverse direction): graph node
// click reads the pre-built reverse-lookup index to populate the
// `selectedBucketKeys` halo atomically with the node selection. The hook
// returns a ReadonlyMap<nodeId, ReadonlySet<bucketKey>> rebuilt only when
// sessions / visibleIds / relations change (Contract #7 pre-index
// integrity). No per-click bucket scan — O(1) lookup inside the click
// handler. Same shape as `useVisibleEntityIds` the canvas already consumes.
import { useNodeToBucketsIndex } from './useNodeToBucketsIndex'

// 2026-06-13 (state-flow audit `b29bdb34c` §6.4 / §6.6): when the store's
// `pathToSelected` is non-empty, derive the `{ edges, nodeDepths,
// pathLength }` triple `applySelectionStyling` needs FROM the store's
// node-id set rather than re-running the BFS inline. This keeps the D3
// path's membership in sync with the sigma path (which reads the same
// store field) without losing the visual depth gradient (the inline BFS
// is still the producer; we just constrain its output to the
// authoritative node set the writer recorded).
//
// Implementation: run the same BFS as `computeAncestryPath`, then PRUNE
// the result to the intersection of the BFS-derived set and the store's
// `pathToSelected` membership. If a node is in the store's set but not
// reachable in the current `visibleRelations` (e.g. a filter dropped
// some intermediate ancestor between the writer's click and this
// render), it still gets membership but no depth (depth = pathLength,
// i.e. dimmest end of the visible gradient). This matches the audit's
// "single source of truth" intent — the writer's word stands — without
// breaking the gradient when filters change mid-flight.
function deriveAncestryFromStorePath(
  selectedId: string,
  storePath: ReadonlySet<string>,
  relations: readonly { from: string; to: string; type: string }[],
): AncestryPathResult {
  const inline = computeAncestryPath(selectedId, relations)
  // Fast path: the inline BFS already agrees with the store. No work.
  if (inline.nodeDepths.size === storePath.size) {
    let allMatch = true
    for (const id of inline.nodeDepths.keys()) {
      if (!storePath.has(id)) {
        allMatch = false
        break
      }
    }
    if (allMatch) return inline
  }
  // Slow path: prune the inline BFS's result to the store's authoritative
  // membership. Nodes the store says are "in path" but the inline BFS
  // didn't reach get a max-depth slot so they still render dimly in the
  // trace gradient. Nodes the inline BFS reached but the store DIDN'T
  // tag are dropped — the writer's intent wins.
  const prunedNodeDepths = new Map<string, number>()
  let maxDepth = inline.pathLength
  for (const id of storePath) {
    const d = inline.nodeDepths.get(id)
    if (d !== undefined) {
      prunedNodeDepths.set(id, d)
      if (d > maxDepth) maxDepth = d
    } else {
      // The writer included this node but it's not in the inline BFS
      // (filters may have changed). Mark it at the dimmest end so it
      // still renders within the trace but doesn't dominate.
      prunedNodeDepths.set(id, maxDepth)
    }
  }
  // Edges: keep only the inline-derived edges whose endpoints are both
  // in the store's set.
  const prunedEdges = new Set<string>()
  for (const e of inline.edges) {
    const [a, b] = e.split('||')
    if (storePath.has(a) && storePath.has(b)) {
      prunedEdges.add(e)
    }
  }
  return {
    edges: prunedEdges,
    nodeDepths: prunedNodeDepths,
    pathLength: maxDepth,
  }
}

interface D3Node {
  id: string
  name: string
  entityType?: string
  metadata?: Record<string, unknown>
  // D3 mutates these.
  x?: number
  y?: number
  vx?: number
  vy?: number
  fx?: number | null
  fy?: number | null
  index?: number
}

interface D3Link {
  source: string | D3Node
  target: string | D3Node
  type: string
}

interface Bounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

function calculateGraphBounds(nodes: readonly D3Node[]): Bounds | null {
  if (nodes.length === 0) return null
  const xs: number[] = []
  const ys: number[] = []
  for (const n of nodes) {
    if (typeof n.x === 'number') xs.push(n.x)
    if (typeof n.y === 'number') ys.push(n.y)
  }
  if (xs.length === 0 || ys.length === 0) return null
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  }
}

function calculateCenterTransform(
  bounds: Bounds,
  dim: { width: number; height: number },
  padding = 50,
): { x: number; y: number; scale: number } {
  const w = Math.max(bounds.maxX - bounds.minX, 1)
  const h = Math.max(bounds.maxY - bounds.minY, 1)
  const scale = Math.min(
    (dim.width - padding * 2) / w,
    (dim.height - padding * 2) / h,
    1,
  )
  const cx = (bounds.minX + bounds.maxX) / 2
  const cy = (bounds.minY + bounds.maxY) / 2
  return {
    x: dim.width / 2 - cx * scale,
    y: dim.height / 2 - cy * scale,
    scale,
  }
}

export interface D3GraphCanvasProps {
  apiClient: ApiClient
  system: System
}

export function D3GraphCanvas({ apiClient, system }: D3GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const transformRef = useRef<d3.ZoomTransform>(d3.zoomIdentity)
  const simulationRef = useRef<d3.Simulation<D3Node, D3Link> | null>(null)
  // 2026-06-14 (Plan 06 gap-closure — Decision 2 multi-set fit-to-bounds):
  // RESTORED. The previous-plan note from Phase 56-04 continuation 2 said
  // "if a future plan needs to read the simulation's mutated positions,
  // restore this ref" — Decision 2 IS that plan. The fit-to-bounds
  // useEffect reads node positions from this ref to compute the bounding
  // box over `selectedNodeIds ∪ pathToSelected` for a one-shot zoom
  // transform on Layer 0 → Layer 1 transitions. The OLD centering
  // useEffect that used this ref is NOT restored — its retraction stands;
  // viewport panning on a single-node history/timeline click remains
  // forbidden. Decision 2 fits ONLY at the multi-set entry transition,
  // never on drill (Layer 1 → Layer 2) or pop (Layer 2 → Layer 1).
  const d3NodesRef = useRef<D3Node[] | null>(null)

  const { entities, relations, isLoading } = useGraphData(apiClient, system)
  const theme = useViewerStore((s) => s.theme)
  // 2026-06-13 (Phase 56.1 D-1 + D-4): single-selection `selectedNodeId` is
  // GONE — promoted to a multi-set `selectedNodeIds` + derived `focalNodeId`
  // singleton (see viewer-store.ts after Plan 01). `applySelectionStyling`
  // below renders two-tier rings: red focal on `focalNodeId`, lighter-blue
  // halo on every other member of `selectedNodeIds`. The ancestry trace is
  // drawn from `focalNodeId` only (D-4 + discretion #2 — drawing it from
  // every halo node would be O(N×depth) visual lines, chaotic at N≥5).
  const selectedNodeIds = useViewerStore((s) => s.selectedNodeIds)
  const focalNodeId = useViewerStore((s) => s.focalNodeId)
  // 2026-06-13 (state-flow audit `b29bdb34c` §6.4 / §6.6): `pathToSelected`
  // is the store's canonical ancestry trace. Every writer of
  // `selectedNodeId` (graph click, history click, timeline tick) also
  // writes the trace into the store. The D3 path previously RE-COMPUTED
  // `computeAncestryPath` inline at every `applySelectionStyling` call
  // (audit finding S3 — duplicated source-of-truth). With the store-side
  // trace read here, the D3 render path agrees with the sigma path that
  // also reads from the store (graph-builder.ts:461,487). When the store
  // trace is empty but a node is selected (e.g. first paint before any
  // writer attaches one), fall back to inline computation so the legacy
  // mount-time render still produces a visible trace — audit §6.6.
  const pathToSelected = useViewerStore((s) => s.pathToSelected)
  // 2026-06-14 (Plan 06 gap-closure — Decision 2 multi-set fit-to-bounds):
  // we re-introduce the `selectionSource` subscription that was retracted
  // in Phase 56-04 continuation 2 — but ONLY for the narrow purpose of
  // detecting Layer 0 → Layer 1 transitions (null → non-null) so the
  // multi-set fit-to-bounds useEffect (defined below) can run a one-shot
  // zoom transform fitting `selectedNodeIds ∪ pathToSelected` into view.
  //
  // The audit-locked dep-list invariant (Locked Contract #3) is NOT
  // violated: this subscription does NOT enter the main render useEffect's
  // dep list (lines ~767-790 below) — it only feeds the new fit-to-bounds
  // useEffect. The main render still rebuilds ONLY on visibleEntities /
  // visibleRelations / theme / isLoading changes; clicks do not rebuild
  // the SVG or restart the force simulation. See PATTERNS-LOCK.md
  // Contract #3 amendment shipped alongside this change.
  const selectionSource = useViewerStore((s) => s.selectionSource)
  const selectedTeams = useViewerStore((s) => s.selectedTeams)
  const visibleLevels = useViewerStore((s) => s.visibleLevels)
  const selectedClasses = useViewerStore((s) => s.selectedClasses)
  // 2026-06-11: full filter set — user reported text + learningSource
  // didn't affect the D3 canvas because the predicate omitted them.
  const searchQuery = useViewerStore((s) => s.searchQuery)
  const learningSource = useViewerStore((s) => s.learningSource)
  const selectedLayers = useViewerStore((s) => s.selectedLayers)
  const hideDocNodes = useViewerStore((s) => s.hideDocNodes)
  // 2026-06-12: LSL timeline tick produces this — when non-null, the
  // graph dims to only those entities (plus 1-hop neighbors so the
  // session's anchor still shows context). null = no filter.
  const lslFilterEntityIds = useViewerStore((s) => s.lslFilterEntityIds)

  // 2026-06-13 (Phase 56.1 Plan 05 — D-2 reverse direction): pre-built
  // `nodeId → Set<bucketKey>` reverse lookup map. The graph click handler
  // reads `nodeToBuckets.get(d.id)` to populate `selectedBucketKeys` halo
  // atomically with the node selection (PATTERNS.md §5 Option A). Hook is
  // memoised on [sessions, visibleIds, relations] — rebuilds rare in
  // practice. Same subscription shape as `useVisibleEntityIds` we already
  // consume; adding this does not alter the existing dep lists.
  const nodeToBuckets = useNodeToBucketsIndex(apiClient, system)

  // 2026-06-14 (Plan 06 gap-closure — Bug 2 fix): the d3 `.on('click', ...)`
  // handler is registered INSIDE the main render `useEffect` whose dep list
  // is locked to `[visibleEntities, visibleRelations, theme, isLoading]`
  // (Locked Contract #3 — viewport stability). The handler captures
  // `nodeToBuckets` via JS closure at the time the effect runs. When
  // `nodeToBuckets` rebuilds LATER (sessions data arrives after first paint,
  // or `visibleIds` changes), the click handler is NOT re-registered — so it
  // keeps the STALE map.
  //
  // Operator visual smoke (2026-06-14) showed every graph node click
  // producing `bucketKeys: empty Set` (no halo / focal styling on any
  // tick — AC #2 failure). Root cause: the initial main render captured
  // an empty `new Map()` because `useLslSessions` was still pending; that
  // empty map remained the click handler's value forever.
  //
  // Fix: track the latest `nodeToBuckets` in a ref + sync it on every
  // render. The click handler reads `nodeToBucketsRef.current` so it
  // always sees the freshest reverse-index. Adding `nodeToBuckets` to the
  // main render dep list would force an SVG rebuild on every sessions
  // refetch, violating Locked Contract #3 (viewport stability).
  const nodeToBucketsRef = useRef<ReadonlyMap<string, ReadonlySet<string>>>(nodeToBuckets)
  useEffect(() => {
    nodeToBucketsRef.current = nodeToBuckets
  }, [nodeToBuckets])

  // Apply the same filter pipeline the sigma reducer applied so the two
  // viewers honour the FilterRail consistently. Done client-side here
  // because d3's data binding wants pre-filtered arrays.
  //
  // 2026-06-13 (Phase 56-04 round 4): the predicate body is now in
  // `visibility-predicate.ts` so the LSL strip's `useVisibleEntityIds`
  // hook can share it. The memo's dep list is unchanged — viewport
  // stability contract (G9 + G13 source-grep gates) preserved verbatim.
  const visibleEntities = useMemo<Entity[]>(() => {
    const q = searchQuery.trim().toLowerCase()
    return entities.filter((e) => isEntityVisible(e, {
      searchQueryLowered: q,
      selectedTeams,
      learningSource,
      selectedLayers,
      hideDocNodes,
      selectedClasses,
      visibleLevels,
      lslFilterEntityIds,
    }))
  }, [entities, selectedTeams, selectedClasses, visibleLevels, searchQuery, learningSource, selectedLayers, hideDocNodes, lslFilterEntityIds])

  const visibleIds = useMemo(() => {
    const s = new Set<string>()
    for (const e of visibleEntities) s.add(e.id)
    return s
  }, [visibleEntities])

  const visibleRelations = useMemo<Relation[]>(() => {
    return relations.filter((r) => visibleIds.has(r.from) && visibleIds.has(r.to))
  }, [relations, visibleIds])

  // Dimensions — watch the container, no Redux involvement.
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const apply = () => {
      const { width, height } = el.getBoundingClientRect()
      if (width > 0 && height > 0) {
        svgRef.current?.setAttribute('width', `${width}`)
        svgRef.current?.setAttribute('height', `${height}`)
        svgRef.current?.setAttribute('viewBox', `0 0 ${width} ${height}`)
      }
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Selection / ancestry path overlay — re-runs on selectedNodeId only.
  // 2026-06-12: extracted into a callable so the MAIN render effect can
  // re-apply selection styling at its TAIL (post-data-bind). Previously
  // the selection useEffect ran before the main render's SVG rebuild
  // when filter changes fired both — the rebuild wiped the styling and
  // the path-trace looked broken.
  const applySelectionStyling = useCallback(
    (svg: d3.Selection<SVGSVGElement, unknown, null, undefined>) => {
      // 2026-06-13 (Phase 56.1 D-4): two-tier ring rendering. Halo ring
      // (selectedNodeIds members other than focal) uses `#60a5fa` at 60%
      // opacity, narrower stroke. Focal ring (focalNodeId) keeps the
      // Phase 56 red treatment (`#ff0000`, opacity 1, stroke-width 4).
      // Reset every ring first so .each() below can paint the per-node
      // tier without leaking state from a prior render.
      svg.selectAll<SVGCircleElement, D3Node>('.selection-ring').attr('opacity', 0)
      // 2026-06-13 (Phase 56.1 D-1): the "no selection" branch fires when
      // BOTH the multi-set and the focal singleton are empty/null. With
      // the store guaranteeing focalNodeId === null iff selectedNodeIds is
      // empty (deriveFocal invariant), checking both is belt-and-braces.
      if (focalNodeId === null && selectedNodeIds.size === 0) {
        svg.selectAll<SVGPathElement, D3Link>('.graph-link')
          .attr('stroke', theme === 'dark' ? '#475569' : '#999')
          .attr('stroke-opacity', theme === 'dark' ? 0.4 : 0.6)
          .attr('stroke-width', 1)
        svg.selectAll<SVGGElement, D3Node>('.node')
          .attr('opacity', 1)
          .attr('data-focal', null)
          .attr('data-halo', null)
        svg.selectAll<SVGTextElement, D3Node>('.node-label').attr('opacity', 1)
        return
      }
      // 2026-06-13 (Phase 56.1 D-4): two-tier per-node selection. ONE
      // `.selection-ring` circle per node (initialised once at lines
      // ~559-565 — DO NOT add a sibling circle; that would break the d3
      // data-bind). The stroke + opacity + stroke-width vary by predicate.
      // data-focal / data-halo attrs on the parent .node <g> are the
      // observable markers the E2E spec (Plan 06) asserts against.
      svg.selectAll<SVGGElement, D3Node>('.node').each(function (d) {
        const nodeSel = d3.select(this)
        const ring = nodeSel.select<SVGCircleElement>('.selection-ring')
        if (d.id === focalNodeId) {
          ring.attr('stroke', '#ff0000').attr('opacity', 1).attr('stroke-width', 4)
          nodeSel.attr('data-focal', 'true').attr('data-halo', null)
        } else if (selectedNodeIds.has(d.id)) {
          ring.attr('stroke', '#60a5fa').attr('opacity', 0.6).attr('stroke-width', 2)
          nodeSel.attr('data-halo', 'true').attr('data-focal', null)
        } else {
          ring.attr('opacity', 0)
          nodeSel.attr('data-focal', null).attr('data-halo', null)
        }
      })
      // 2026-06-13 (audit §6.4 / §6.6 + Phase 56.1 D-4): prefer the
      // store-provided trace. The writer that selected this node (graph
      // click, history click, timeline tick) already computed the ancestry
      // and wrote it to `pathToSelected`. Re-computing here would duplicate
      // the work AND bind ancestry trace correctness to the local
      // `visibleRelations` memo — which is per-render-effect-pass and may
      // not reflect the writer's intent if filters changed between the
      // click and this render. Inline computation is the FALLBACK for the
      // edge case where the store trace is empty (e.g. the mount-time
      // first paint before any writer attaches one).
      //
      // Phase 56.1 D-4: the trace is keyed on `focalNodeId` ONLY (not
      // every halo node in `selectedNodeIds`). When no focal exists, the
      // trace is empty — halo-only state (rare; usually paired with focal).
      let pathEdges: ReadonlySet<string>
      let nodeDepths: ReadonlyMap<string, number>
      let pathLength: number
      if (focalNodeId !== null) {
        const ancestry =
          pathToSelected.size > 0
            ? deriveAncestryFromStorePath(focalNodeId, pathToSelected, visibleRelations)
            : computeAncestryPath(focalNodeId, visibleRelations)
        pathEdges = ancestry.edges
        nodeDepths = ancestry.nodeDepths
        pathLength = ancestry.pathLength
      } else {
        pathEdges = new Set<string>()
        nodeDepths = new Map<string, number>()
        pathLength = 0
      }
      const pathNodeOpacity = (id: string): number => {
        const d = nodeDepths.get(id)
        if (d === undefined) return 0.12
        if (pathLength === 0) return 1
        return 1.0 - (d / pathLength) * 0.5
      }
      svg.selectAll<SVGGElement, D3Node>('.node').attr('opacity', (d) => pathNodeOpacity(d.id))
      svg.selectAll<SVGTextElement, D3Node>('.node-label')
        .attr('opacity', (d) => (nodeDepths.has(d.id) ? 1 : 0.12))
      const isPathEdge = (d: D3Link): boolean => {
        const sId = typeof d.source === 'string' ? d.source : d.source.id
        const tId = typeof d.target === 'string' ? d.target : d.target.id
        return pathEdges.has(`${sId}||${tId}`)
      }
      svg.selectAll<SVGPathElement, D3Link>('.graph-link')
        .attr('stroke', (d) => isPathEdge(d) ? '#0d47a1' : (theme === 'dark' ? '#475569' : '#999'))
        .attr('stroke-opacity', (d) => isPathEdge(d) ? 1 : 0.08)
        .attr('stroke-width', (d) => isPathEdge(d) ? 3 : 1)
    },
    // 2026-06-13 (audit §6.4 / §6.6 + Phase 56.1 D-1): selectedNodeIds and
    // focalNodeId are now read inside this callback, so they must appear
    // in the dep list (renames Phase 56's `selectedNodeId` entry). The
    // lightweight selection useEffect below depends on
    // `applySelectionStyling`, so it will fire when the store fields
    // change — same response cadence as Phase 56.
    [selectedNodeIds, focalNodeId, pathToSelected, visibleRelations, theme],
  )

  // Lightweight selection effect — runs when selection changes without
  // a data rebuild. Main render also calls applySelectionStyling at its
  // tail so a filter change doesn't drop the highlight.
  useEffect(() => {
    if (!svgRef.current) return
    applySelectionStyling(d3.select(svgRef.current))
  }, [applySelectionStyling])

  // 2026-06-14 (Plan 06 gap-closure — Decision 2 multi-set fit-to-bounds):
  //
  // CONTRACT EVOLUTION — see PATTERNS-LOCK.md Contract #3 amendment.
  //
  // The original audit-locked Contract #3 said "viewport never animates on
  // non-graph selection." That contract was earned when selection was
  // single-focal (Phase 56) — lighting one ring doesn't justify moving the
  // viewport. The Phase 56.1 multi-set case is genuinely different: if 5
  // halo nodes land off-screen the multi-set rendering is useless.
  //
  // The amendment: viewport MAY animate ONCE on the Layer 0 → Layer 1
  // transition (selectionSource null → non-null AND selectedNodeIds.size
  // >= 1), to fit `selectedNodeIds ∪ pathToSelected` into the viewport.
  // The transition is a one-shot zoom transform via the EXISTING
  // zoomBehaviorRef primitive `fitToScreen` already uses — NOT an SVG
  // rebuild, NOT a force-simulation restart. The main render dep list
  // STAYS verbatim `[visibleEntities, visibleRelations, theme, isLoading]`.
  //
  // Transitions that do NOT trigger this:
  //   - Layer 1 → Layer 2 drill (selectionSource non-null on both sides
  //     of the transition; the multi-set is collapsing, not entering).
  //   - Layer 2 → Layer 1 pop (same predicate — Esc/X restores from
  //     selectionHistory; selectionSource transitions between non-null
  //     values, never crosses the null threshold).
  //   - Layer 1 → Layer 1 re-selection (e.g. additive Cmd-click adding
  //     to selectedBucketKeys; selectionSource stays === current value).
  //
  // Per-transition fit ensures the user sees the halo set as soon as they
  // pick a tick or graph node, and drill behaviour (Decision 3) preserves
  // the fitted viewport so the focal + path-trace render legibly without
  // a viewport reset.
  const prevSelectionSourceRef = useRef<SelectionSource>(null)
  useEffect(() => {
    const prevSource = prevSelectionSourceRef.current
    const enteredLayer1 =
      prevSource === null
      && selectionSource !== null
      && selectedNodeIds.size >= 1
    prevSelectionSourceRef.current = selectionSource
    if (!enteredLayer1) return

    const svgEl = svgRef.current
    const containerEl = containerRef.current
    const zoom = zoomBehaviorRef.current
    const d3Nodes = d3NodesRef.current
    if (!svgEl || !containerEl || !zoom || !d3Nodes) return

    // Bounds over `selectedNodeIds ∪ pathToSelected`. We include
    // pathToSelected so the central-trace ancestor chain stays in the
    // viewport too — fitting ONLY to selectedNodeIds would let the trace
    // dangle off-screen on long chains.
    const targetIds = new Set<string>()
    for (const id of selectedNodeIds) targetIds.add(id)
    for (const id of pathToSelected) targetIds.add(id)
    const targetNodes = d3Nodes.filter(
      (n) => targetIds.has(n.id)
        && typeof n.x === 'number'
        && typeof n.y === 'number',
    )
    if (targetNodes.length === 0) return

    const bounds = calculateGraphBounds(targetNodes)
    if (!bounds) return

    const { width, height } = containerEl.getBoundingClientRect()
    if (width <= 0 || height <= 0) return

    // Pad the bounds a touch so halo nodes don't sit right at the viewport
    // edge — feels cramped otherwise. 80px padding (vs the default 50px
    // calculateCenterTransform uses) gives nodes breathing room AND keeps
    // their labels readable.
    const { x, y, scale } = calculateCenterTransform(
      bounds,
      { width, height },
      80,
    )
    const transform = d3.zoomIdentity.translate(x, y).scale(scale)
    const svg = d3.select(svgEl)
    svg.transition().duration(500).call(zoom.transform, transform)
  }, [selectionSource, selectedNodeIds, pathToSelected])

  // Main render — rebuild on filtered data or theme change.
  useEffect(() => {
    if (isLoading) return
    if (!svgRef.current || !containerRef.current) return
    const { width, height } = containerRef.current.getBoundingClientRect()
    if (width <= 0 || height <= 0) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    if (visibleEntities.length === 0) return

    // Transform to D3 shape with PLAIN OBJECTS (no Zustand freeze, but be
    // safe regardless — D3 mutates these in place).
    const d3Nodes: D3Node[] = visibleEntities.map((e) => ({
      id: e.id,
      name: e.name,
      // 2026-06-11: ontologyClass can disagree with the canonical
      // `entityType` field — the classifier put `CollectiveKnowledge`
      // under `ontologyClass: Detail` while the raw entityType is
      // `System`. The color rules below key off `entityType` (VKB's
      // contract), so thread that through and only fall back to
      // ontologyClass when entityType is missing.
      entityType: ((e as unknown as { entityType?: string }).entityType
        ?? e.ontologyClass),
      metadata: e.metadata as Record<string, unknown> | undefined,
      x: undefined,
      y: undefined,
      vx: undefined,
      vy: undefined,
      fx: null,
      fy: null,
    }))
    // 2026-06-14 (Plan 06 gap-closure — Decision 2 multi-set fit-to-bounds):
    // RESTORED. The fit-to-bounds useEffect (defined below) reads the
    // mutated x/y coordinates from this ref to compute a bounding box
    // over the selected node set on Layer 0 → Layer 1 transitions. d3
    // mutates `d3Nodes[i].x` / `.y` in place during the force simulation,
    // so the ref always points at the same array the simulation is
    // updating — no extra bookkeeping needed.
    d3NodesRef.current = d3Nodes
    const d3Links: D3Link[] = visibleRelations.map((r) => ({
      source: r.from,
      target: r.to,
      type: r.type,
    }))

    const g = svg.append('g')

    const zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
      .extent([[0, 0], [width, height]])
      .scaleExtent([0.1, 8])
      .on('zoom', (event) => {
        g.attr('transform', event.transform)
        transformRef.current = event.transform
      })
    zoomBehaviorRef.current = zoomBehavior
    svg.call(zoomBehavior)

    // Background click deselects.
    // 2026-06-13 (Phase 56): route through the canonical clearSelection()
    // store action so the cascade fires identically to the Esc key path
    // (useKeyboardShortcuts:Esc -> clearSelection). The action clears the
    // entire Phase 56 selection slice + the LSL filter slice in one set(),
    // matching CONTEXT.md D-04 ("Esc + click-background clears in all
    // three panes simultaneously. Implementation must go through the
    // store, not per-pane handlers").
    svg.on('click', (event) => {
      if (event.target === svgRef.current) {
        useViewerStore.getState().clearSelection()
      }
    })

    const simulation = d3.forceSimulation<D3Node>(d3Nodes)
      .force(
        'link',
        d3.forceLink<D3Node, D3Link>(d3Links).id((d) => d.id).distance(150),
      )
      .force('charge', d3.forceManyBody<D3Node>().strength(-500))
      .force('center', d3.forceCenter<D3Node>(width / 2, height / 2))
      .force('x', d3.forceX<D3Node>())
      .force('y', d3.forceY<D3Node>())
    simulationRef.current = simulation

    const linkBaseStroke = theme === 'dark' ? '#475569' : '#999'
    const linkBaseOpacity = theme === 'dark' ? 0.4 : 0.6

    // Links as curved paths (matches VKB's arc rendering).
    const link = g.append('g')
      .selectAll<SVGPathElement, D3Link>('path')
      .data(d3Links)
      .join('path')
      .attr('class', 'graph-link')
      .attr('stroke', linkBaseStroke)
      .attr('stroke-opacity', linkBaseOpacity)
      .attr('stroke-width', 1)
      .attr('fill', 'none')

    // Aggregate same-pair links into combined labels (verbatim from VKB).
    const linkGroupsMap = new Map<string, { links: D3Link[]; types: Set<string> }>()
    for (const l of d3Links) {
      const sId = typeof l.source === 'string' ? l.source : l.source.id
      const tId = typeof l.target === 'string' ? l.target : l.target.id
      const key = [sId, tId].sort().join('||')
      let group = linkGroupsMap.get(key)
      if (!group) {
        group = { links: [], types: new Set() }
        linkGroupsMap.set(key, group)
      }
      group.links.push(l)
      group.types.add(l.type)
    }
    const aggregatedLabels = Array.from(linkGroupsMap.values()).map((grp) => ({
      representativeLink: grp.links[0],
      label: Array.from(grp.types).join(', '),
    }))
    const linkText = g.append('g')
      .selectAll<SVGTextElement, { representativeLink: D3Link; label: string }>('text')
      .data(aggregatedLabels)
      .join('text')
      .text((d) => d.label)
      .attr('font-size', 10)
      .attr('text-anchor', 'middle')
      .attr('dy', -5)
      .attr('fill', theme === 'dark' ? '#94a3b8' : '#666')

    // Nodes with selection ring + colored fill + label.
    const node = g.append('g')
      .selectAll<SVGGElement, D3Node>('.node')
      .data(d3Nodes)
      .join('g')
      .attr('class', 'node')
      .call(makeDrag(simulation))
      .on('click', (event: MouseEvent, d) => {
        const path = computeAncestryPath(d.id, visibleRelations)
        // 2026-06-13 (Phase 56.1 D-5 — drill collapse): a graph click
        // ALWAYS collapses to single-focal mode regardless of whether the
        // clicked node was already part of a halo selection:
        //   - selectedNodeIds becomes `new Set([d.id])` (any prior halo is dropped)
        //   - selectedBucketKeys becomes empty (clears the timeline halo)
        //   - focalNodeId = d.id (explicit focal override)
        //   - selectionSource = 'graph'
        //
        // Routing through the canonical `setSelection` action (NOT inline
        // `setState`) preserves:
        //   - Audit contract #5 (single source of truth for selection writes)
        //   - Phase 56.1 D-1 + invariant #4: sibling-field clears live in
        //     the action body where they can't be forgotten
        //   - The `sameSetMembership` reference-stability guard for
        //     selectedNodeIds + selectedBucketKeys + lslFilterEntityIds
        //     (audit-locked viewport-stability invariant carries forward)
        // 2026-06-13 (Phase 56.1 Plan 05 — D-2 reverse direction):
        // populate `selectedBucketKeys` from the pre-built reverse index
        // (nodeToBuckets.get(d.id)) so every bucket where d.id was touched
        // gets a halo ring on the timeline strip. Empty Set when the node
        // has no touching buckets (the index is sparse — only nodes with
        // at least one resolved bucket get an entry). `focal.bucketKey`
        // stays null on graph click — the graph nominates a node focal,
        // not a bucket focal; the timeline strip's render predicate keys
        // halo on `selectedBucketKeys.has(...) && !focalBucket`.
        //
        // 2026-06-14 (Plan 06 gap-closure — Bug 2 fix): read from
        // `nodeToBucketsRef.current` (synced via useEffect above), NOT the
        // closure-captured `nodeToBuckets`. The main render effect's dep
        // list omits `nodeToBuckets` (Locked Contract #3 — viewport
        // stability), so the click handler's JS closure froze on whatever
        // value `nodeToBuckets` had at first mount — typically empty
        // because sessions data hadn't arrived. The ref hop sees the
        // CURRENT value at click time without re-registering the handler.
        const touchedBuckets = nodeToBucketsRef.current.get(d.id) ?? new Set<string>()
        // 2026-06-14 (Plan 06 gap-closure — Decision 1 selection-history stack):
        // pass `pushHistory: true` on every graph click. The store's
        // setSelection guard (`shouldPush = pushHistory && (size > 0 || size > 0)`)
        // only captures a snapshot when there's actually a pre-click
        // selection to remember — Layer 0 → Layer 1 entry clicks pass
        // through without polluting the history slot, while halo-node-click
        // drills (Layer 1 → Layer 2) push the multi-set so Esc/X restores
        // the halo state instead of dropping to Layer 0.
        useViewerStore.getState().setSelection({
          nodeIds: new Set<string>([d.id]),
          bucketKeys: touchedBuckets,
          focal: { nodeId: d.id, bucketKey: null },
          pathToSelected: new Set<string>(path.nodeDepths.keys()),
          highlightedRowKey: d.id,
          source: 'graph',
          pushHistory: true,
        })
        // event.stopPropagation() is CRITICAL — without it the SVG
        // background click handler below fires next and immediately
        // clears the selection we just wrote.
        event.stopPropagation()
      })

    // 2026-06-13 (Phase 56.1 D-4): the .selection-ring circle starts with
    // opacity 0 + the default red stroke. `applySelectionStyling` (called
    // immediately after the d3 mount, just below) paints the correct tier
    // (red focal, lighter-blue halo, or invisible) per node based on the
    // CURRENT store snapshot. We don't try to compute the per-node tier
    // here at mount time because applySelectionStyling has the canonical
    // logic (deciding focal vs halo from `focalNodeId` + `selectedNodeIds`
    // closure capture) — duplicating it would risk drift.
    node.append('circle')
      .attr('class', 'selection-ring')
      .attr('r', 18)
      .attr('fill', 'none')
      .attr('stroke', '#ff0000')
      .attr('stroke-width', 4)
      .attr('opacity', 0)

    node.append('circle')
      .attr('class', 'node-circle')
      .attr('r', 10)
      .attr('fill', (d) => {
        if (d.entityType === 'System') return '#3cb371'
        const source = (d.metadata as { source?: string } | undefined)?.source
        if (source === 'online' || source === 'auto') return '#FFB6C1'
        // Hierarchy gradient — matches VKB's NodeDetails palette exactly.
        if (d.entityType === 'Project') return '#00897b'
        if (d.entityType === 'Component') return '#1565c0'
        if (d.entityType === 'SubComponent') return '#42a5f5'
        return '#90caf9'
      })
      .attr('stroke', (d) => {
        // Insight-doc border: same predicate as InsightDocumentModal.
        const name = d.name ?? ''
        const hasInsightDoc =
          name.length > 0 && name.length <= 60 && !/[\s:()/?#]/.test(name)
        return hasInsightDoc ? '#1565c0' : (theme === 'dark' ? '#0f172a' : '#fff')
      })
      .attr('stroke-width', (d) => {
        const name = d.name ?? ''
        const hasInsightDoc =
          name.length > 0 && name.length <= 60 && !/[\s:()/?#]/.test(name)
        return hasInsightDoc ? 3 : 2
      })

    node.append('text')
      .attr('class', 'node-label')
      .text((d) => d.name)
      .attr('x', 15)
      .attr('y', 5)
      .attr('font-size', 12)
      .attr('fill', theme === 'dark' ? '#e2e8f0' : '#333')

    node.append('title').text((d) => `${d.name} (${d.entityType ?? ''})`)

    // Auto-fit once layout stabilises.
    let hasAutoFit = false
    let tickCount = 0
    const fitToScreen = () => {
      if (hasAutoFit) return
      const bounds = calculateGraphBounds(d3Nodes)
      if (bounds && zoomBehaviorRef.current) {
        hasAutoFit = true
        const { x, y, scale } = calculateCenterTransform(bounds, { width, height })
        const transform = d3.zoomIdentity.translate(x, y).scale(scale)
        svg.transition().duration(500).call(zoomBehaviorRef.current.transform, transform)
      }
    }

    simulation.on('tick', () => {
      link.attr('d', (d) => {
        const s = d.source as D3Node
        const t = d.target as D3Node
        if (s.x == null || s.y == null || t.x == null || t.y == null) return ''
        const dx = t.x - s.x
        const dy = t.y - s.y
        const dr = Math.sqrt(dx * dx + dy * dy)
        return `M${s.x},${s.y}A${dr},${dr} 0 0,1 ${t.x},${t.y}`
      })
      linkText.attr('x', (d) => {
        const l = d.representativeLink
        const s = typeof l.source === 'object' ? l.source.x ?? 0 : 0
        const t = typeof l.target === 'object' ? l.target.x ?? 0 : 0
        return (s + t) / 2
      })
      linkText.attr('y', (d) => {
        const l = d.representativeLink
        const s = typeof l.source === 'object' ? l.source.y ?? 0 : 0
        const t = typeof l.target === 'object' ? l.target.y ?? 0 : 0
        return (s + t) / 2
      })
      node.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`)
      tickCount++
      if (tickCount === 120) fitToScreen()
    })
    simulation.on('end', fitToScreen)

    // 2026-06-12: re-apply selection styling NOW that the DOM has been
    // rebuilt. The selection useEffect ran with stale DOM refs before
    // this rebuild, so its work was clobbered when we d3.selectAll('*')
    // .remove()'d above. Calling here restores the path-trace highlight
    // after any filter / data change.
    applySelectionStyling(svg)

    return () => {
      simulation.stop()
    }
    // CRITICAL: the dep list intentionally OMITS every selection field —
    // Phase 56.1 evolution: `selectedNodeIds`, `focalNodeId`,
    // `selectedBucketKeys`, `focalBucketKey` (and the carried-forward
    // Phase 56 `pathToSelected`). Listing any of them here makes every
    // click rebuild the entire SVG + restart the force simulation + clobber
    // whatever `applySelectionStyling` just painted. This is the load-bearing
    // viewport-stability invariant (Phase 56-PATTERNS Locked Contract #3 /
    // Phase 45 G9). The initial selection-ring opacity is 0 at mount-time;
    // `applySelectionStyling(svg)` is called at the TAIL of this effect
    // (just above) which paints the correct per-node tier from the current
    // store snapshot. Subsequent selection changes are handled exclusively
    // by the lightweight selection useEffect above, which mutates ring +
    // path styling in place on the LIVE DOM without an SVG rebuild.
  }, [visibleEntities, visibleRelations, theme, isLoading])

  return (
    <div
      ref={containerRef}
      data-testid="d3-graph-canvas-root"
      className="relative h-full w-full"
    >
      <svg
        ref={svgRef}
        className="h-full w-full"
        style={{ background: 'transparent' }}
      />
    </div>
  )
}

/* ── d3 drag binding ────────────────────────────────────────────────── */

function makeDrag(simulation: d3.Simulation<D3Node, D3Link>) {
  function dragstarted(event: d3.D3DragEvent<SVGGElement, D3Node, D3Node>) {
    if (!event.active) simulation.alphaTarget(0.3).restart()
    event.subject.fx = event.subject.x ?? null
    event.subject.fy = event.subject.y ?? null
  }
  function dragged(event: d3.D3DragEvent<SVGGElement, D3Node, D3Node>) {
    event.subject.fx = event.x
    event.subject.fy = event.y
  }
  function dragended(event: d3.D3DragEvent<SVGGElement, D3Node, D3Node>) {
    if (!event.active) simulation.alphaTarget(0)
    event.subject.fx = null
    event.subject.fy = null
  }
  return d3.drag<SVGGElement, D3Node>()
    .on('start', dragstarted)
    .on('drag', dragged)
    .on('end', dragended)
}
