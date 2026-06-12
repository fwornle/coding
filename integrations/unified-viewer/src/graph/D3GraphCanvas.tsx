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
import { useGraphData } from './useGraphData'
import type { Entity, Relation } from './types'

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

interface AncestryPathResult {
  /** Edge keys in both directions ("A||B" and "B||A") to match either-direction d3 links. */
  edges: Set<string>
  nodeDepths: Map<string, number>
  pathLength: number
}

/** ID-only ancestry walk (no name aliasing — IDs are canonical in km-core). */
function computeAncestryPath(
  selectedId: string,
  relations: readonly Relation[],
): AncestryPathResult {
  const edges = new Set<string>()
  const nodeDepths = new Map<string, number>()
  const HIERARCHY_TYPES = new Set([
    'contains', 'includes', 'parent-child', 'has_insight', 'capturedBy',
  ])
  const childToParents = new Map<string, string[]>()
  for (const r of relations) {
    if (!HIERARCHY_TYPES.has(r.type)) continue
    const list = childToParents.get(r.to) ?? []
    list.push(r.from)
    childToParents.set(r.to, list)
  }
  const visited = new Set<string>([selectedId])
  const queue: string[] = [selectedId]
  const parentOf = new Map<string, string>()
  while (queue.length) {
    const cur = queue.shift() as string
    const parents = childToParents.get(cur) ?? []
    for (const p of parents) {
      if (visited.has(p)) continue
      visited.add(p)
      if (!parentOf.has(cur)) parentOf.set(cur, p)
      queue.push(p)
    }
  }
  let node = selectedId
  let depth = 0
  nodeDepths.set(node, depth)
  while (parentOf.has(node)) {
    const parent = parentOf.get(node) as string
    edges.add(`${parent}||${node}`)
    edges.add(`${node}||${parent}`)
    depth++
    nodeDepths.set(parent, depth)
    node = parent
  }
  // 2026-06-12: when the selected node has NO ancestor chain via the
  // HIERARCHY_TYPES (orphan Detail / floating Insight), fall back to a
  // 1-hop neighborhood so the user still sees connected nodes/edges
  // highlighted. Without this, history-sidebar selection on an orphan
  // node leaves the graph looking unchanged — the red ring is on a tiny
  // dot and every neighbor stays at full opacity (`pathLength === 0`
  // forced opacity=1 for the selected node and 0.12 for everyone else,
  // so no "trace" was visible). Walks BOTH directions across ALL
  // relation types — this is purely a visual aid, not semantic ancestry.
  if (depth === 0) {
    for (const r of relations) {
      if (r.from === selectedId) {
        edges.add(`${r.from}||${r.to}`)
        edges.add(`${r.to}||${r.from}`)
        if (!nodeDepths.has(r.to)) nodeDepths.set(r.to, 1)
      } else if (r.to === selectedId) {
        edges.add(`${r.from}||${r.to}`)
        edges.add(`${r.to}||${r.from}`)
        if (!nodeDepths.has(r.from)) nodeDepths.set(r.from, 1)
      }
    }
    if (nodeDepths.size > 1) depth = 1
  }
  return { edges, nodeDepths, pathLength: depth }
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

  const { entities, relations, isLoading } = useGraphData(apiClient, system)
  const theme = useViewerStore((s) => s.theme)
  const selectedNodeId = useViewerStore((s) => s.selectedNodeId)
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

  // Apply the same filter pipeline the sigma reducer applied so the two
  // viewers honour the FilterRail consistently. Done client-side here
  // because d3's data binding wants pre-filtered arrays.
  const visibleEntities = useMemo<Entity[]>(() => {
    const q = searchQuery.trim().toLowerCase()
    return entities.filter((e) => {
      // 2026-06-12: hide `[Raw] 2 messages (...)` placeholder observations
      // that the LLM summary pipeline emits on failure — they're not real
      // knowledge, just transcript-stub rows.
      if (typeof e.name === 'string' && e.name.startsWith('[Raw]')) return false
      // 2026-06-12: the viewer is for SYNTHESISED knowledge (Insights +
      // structural backbone). Raw stream rows — Observation, Digest —
      // pollute the graph with one node per session exchange. Hide them.
      // Note: this checks the canonical `entityType` (Observation/Digest)
      // because the ontology classifier often re-labels these as
      // ontologyClass=Detail, which would let them slip through.
      const etype = (e as unknown as { entityType?: string }).entityType
      if (etype === 'Observation' || etype === 'Digest') return false
      const meta = (e.metadata as { team?: string; source?: string; layer?: string; doc?: boolean } | undefined) ?? {}

      // Teams predicate. Structural backbone (System/Project/Component)
      // is EXEMPT — same convention as the LearningSource filter. Without
      // this, unchecking a team (e.g. Coding) hides the structural anchors
      // and every cross-team child (e.g. General-team Insights tied to a
      // Coding-team Component via `has_insight`) loses its parent and
      // floats as a visible orphan.
      if (selectedTeams.size > 0) {
        if (selectedTeams.has('__none__')) return false
        const ocls = e.ontologyClass
        const isStructural = ocls === 'System' || ocls === 'Project' || ocls === 'Component'
        if (!isStructural) {
          const team = meta.team ?? 'coding'
          if (!selectedTeams.has(team)) return false
        }
      }

      // Learning Source predicate. Structural backbone (System/Project/
      // Component) is exempt — same exception graph-builder applies.
      if (learningSource && learningSource !== 'combined') {
        const ocls = e.ontologyClass
        const isStructural = ocls === 'System' || ocls === 'Project' || ocls === 'Component'
        if (!isStructural) {
          const isAuto = meta.source === 'auto' || meta.source === 'online'
          if (learningSource === 'online' && !isAuto) return false
          if (learningSource === 'batch' && isAuto) return false
        }
      }

      // Layer predicate. Empty array = "all visible" sentinel; the special
      // ['__none__'] entry means "none visible" — emitted by toggleLayer
      // when the user empties the array, to keep the empty-array sentinel
      // from collapsing back to "all visible".
      if (selectedLayers.includes('__none__')) return false
      if (selectedLayers.length > 0) {
        const layer = (meta as { layer?: string }).layer
          ?? ((e as unknown as { layer?: string }).layer)
        // Fall back to ontology hint: Insight/Pattern → 'pattern', else 'evidence'.
        const inferred = layer
          ?? (e.ontologyClass === 'Insight' || e.ontologyClass === 'Pattern' ? 'pattern' : 'evidence')
        if (!selectedLayers.includes(inferred)) return false
      }

      // Doc-nodes hide toggle.
      if (hideDocNodes) {
        const isDoc = (meta as { doc?: boolean }).doc === true
          || e.ontologyClass === 'Documentation'
        if (isDoc) return false
      }

      // Class predicate (empty Set = nothing visible — same convention).
      const cls = e.ontologyClass as string | undefined
      if (typeof cls !== 'string' || !selectedClasses.has(cls)) return false

      // Level predicate.
      const lvl = e.level as 0 | 1 | 2 | 3 | undefined
      if (typeof lvl === 'number' && !visibleLevels.has(lvl)) return false

      // Text filter — substring over name + description (case-insensitive).
      if (q.length > 0) {
        const name = (e.name ?? '').toLowerCase()
        const desc = ((e as unknown as { description?: string }).description ?? '').toLowerCase()
        if (!name.includes(q) && !desc.includes(q)) return false
      }

      // 2026-06-12: LSL timeline session filter — when the user clicks a
      // tick we narrow the graph to entities created during that session.
      // Structural backbone (System/Project/Component) is exempt so the
      // session anchors aren't ripped out of context.
      if (lslFilterEntityIds && lslFilterEntityIds.size > 0) {
        const ocls = e.ontologyClass
        const isStructural = ocls === 'System' || ocls === 'Project' || ocls === 'Component'
        if (!isStructural && !lslFilterEntityIds.has(e.id)) return false
      }

      return true
    })
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
      svg.selectAll<SVGCircleElement, D3Node>('.selection-ring').attr('opacity', 0)
      if (!selectedNodeId) {
        svg.selectAll<SVGPathElement, D3Link>('.graph-link')
          .attr('stroke', theme === 'dark' ? '#475569' : '#999')
          .attr('stroke-opacity', theme === 'dark' ? 0.4 : 0.6)
          .attr('stroke-width', 1)
        svg.selectAll<SVGGElement, D3Node>('.node').attr('opacity', 1)
        svg.selectAll<SVGTextElement, D3Node>('.node-label').attr('opacity', 1)
        return
      }
      svg.selectAll<SVGGElement, D3Node>('.node')
        .filter((d) => d.id === selectedNodeId)
        .select<SVGCircleElement>('.selection-ring')
        .attr('opacity', 1)
      const ancestry = computeAncestryPath(selectedNodeId, visibleRelations)
      const { edges: pathEdges, nodeDepths, pathLength } = ancestry
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
    [selectedNodeId, visibleRelations, theme],
  )

  // Lightweight selection effect — runs when selection changes without
  // a data rebuild. Main render also calls applySelectionStyling at its
  // tail so a filter change doesn't drop the highlight.
  useEffect(() => {
    if (!svgRef.current) return
    applySelectionStyling(d3.select(svgRef.current))
  }, [applySelectionStyling])

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
    svg.on('click', (event) => {
      if (event.target === svgRef.current) {
        useViewerStore.setState({ selectedNodeId: null, pathToSelected: new Set() })
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
        useViewerStore.setState({
          selectedNodeId: d.id,
          pathToSelected: new Set(path.nodeDepths.keys()),
        })
        event.stopPropagation()
      })

    node.append('circle')
      .attr('class', 'selection-ring')
      .attr('r', 18)
      .attr('fill', 'none')
      .attr('stroke', '#ff0000')
      .attr('stroke-width', 4)
      .attr('opacity', (d) => (selectedNodeId === d.id ? 1 : 0))

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
    // CRITICAL: the dep list intentionally OMITS `selectedNodeId`. Listing
    // it here makes every click rebuild the entire SVG + restart the force
    // simulation + clobber whatever the selection useEffect just painted.
    // The initial selection-ring visibility is set once at mount-time from
    // the current `selectedNodeId` value (closure capture); subsequent
    // selection changes are handled exclusively by the selection useEffect
    // above, which mutates ring + path styling in place on the LIVE DOM.
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
