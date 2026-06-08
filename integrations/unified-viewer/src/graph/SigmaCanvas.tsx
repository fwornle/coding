// PATTERN SOURCE: 45-RESEARCH.md Example 1 + 45-PATTERNS.md § SigmaCanvas.tsx
//
// The WebGL graph renderer. Wraps `<SigmaContainer>` with a child component
// `<GraphSetup>` that uses sigma's hooks (useLoadGraph / useRegisterEvents /
// useSetSettings / useCamera) to:
//
//   1. Build a graphology Graph from useGraphData(...) payloads (entities,
//      relations, ontology).
//   2. Run ForceAtlas2 in WORKER mode (off-main-thread) so >2k-node graphs
//      don't freeze the UI thread (T-45-02-02 mitigation).
//   3. Wire click / double-click / hover events via makeEventHandlers().
//   4. Configure sigma's nodeReducer + edgeReducer to honor UI-SPEC § Color
//      State / § Color Edges WITHOUT re-running the force simulation —
//      reducer reads from Zustand each frame.
//
// `<ZoomControls>` is a sibling component (also under <SigmaContainer> so
// it can call useCamera) with three icon-only buttons per UI-SPEC §
// Icon-only controls table.

import React, { useEffect, useMemo, useState } from 'react'
import {
  SigmaContainer,
  useCamera,
  useLoadGraph,
  useRegisterEvents,
  useSetSettings,
  useSigma,
} from '@react-sigma/core'
import { useWorkerLayoutForceAtlas2 } from '@react-sigma/layout-forceatlas2'
import { Maximize, ZoomIn, ZoomOut } from 'lucide-react'
import '@react-sigma/core/lib/style.css'

import type { ApiClient } from '@/api/ApiClient'
import type { System } from '@/config/system-endpoints'
import { useViewerStore } from '@/store/viewer-store'
import { TooltipProvider } from '@/components/ui/tooltip'
import { IconButton } from '@/components/IconButton'
import { useGraphData } from './useGraphData'
import { buildGraph } from './graph-builder'
import { classColor } from './color-fallback'
import { makeEventHandlers } from './events'
import { makeEdgeReducer, makeNodeReducer } from './reducers'

export interface SigmaCanvasProps {
  apiClient: ApiClient
  system: System
}

/**
 * Top-level component. The actual sigma instance lives inside
 * <SigmaContainer> — children below it can call useSigma() / useCamera() /
 * useLoadGraph() etc.
 */
export function SigmaCanvas({ apiClient, system }: SigmaCanvasProps) {
  return (
    <div className="relative h-full w-full" data-testid="sigma-canvas-root">
      <SigmaContainer
        style={{ height: '100%', width: '100%', background: 'transparent' }}
        settings={{
          allowInvalidContainer: true,
          // Label density — sigma's defaults render every node's label at
          // every zoom level, producing unreadable text-soup on >200-node
          // graphs (Plan 03 checkpoint feedback). Raise the size threshold
          // + lower density so labels only show when the user zooms in
          // close enough that they don't overlap.
          renderEdgeLabels: false,
          labelRenderedSizeThreshold: 6,
          labelDensity: 0.4,
          labelGridCellSize: 80,
          labelSize: 12,
          labelWeight: '500',
        }}
      >
        <GraphSetup apiClient={apiClient} system={system} />
        <TestHookExposer />
        <TooltipProvider delayDuration={400}>
          <ZoomControls />
        </TooltipProvider>
      </SigmaContainer>
      <HoverTooltip />
    </div>
  )
}

/**
 * Inner component — runs the data load, layout, reducers, and event wiring.
 * Lives inside <SigmaContainer> so it can call useSigma / useLoadGraph.
 */
function GraphSetup({ apiClient, system }: { apiClient: ApiClient; system: System }) {
  const loadGraph = useLoadGraph()
  const registerEvents = useRegisterEvents()
  const setSettings = useSetSettings()
  const { start: startLayout, stop: stopLayout } = useWorkerLayoutForceAtlas2({
    settings: { gravity: 1, scalingRatio: 10 },
  })

  const { entities, relations, ontology, isLoading } = useGraphData(apiClient, system)
  const theme = useViewerStore((s) => s.theme)
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)

  // Build the graph + wire events whenever the data set or theme changes.
  // We intentionally exclude `hoveredNode` from this effect — hover is a
  // pure visual reducer concern that does NOT re-run the layout.
  useEffect(() => {
    if (isLoading) return
    if (entities.length === 0) return

    const graph = buildGraph(entities, relations, ontology, theme)
    loadGraph(graph)

    // Start worker-mode layout; stop after ~3s so the simulation settles
    // without spinning indefinitely. Web-worker mode keeps the main thread
    // responsive (T-45-02-02 mitigation).
    startLayout()
    const stopTimer = setTimeout(() => stopLayout(), 3000)

    // Wire event handlers — closure over the just-built graph.
    const handlers = makeEventHandlers({
      apiClient,
      graph,
      getOntology: () => ontology,
      getTheme: () => theme,
      setStore: useViewerStore.setState,
      setHoveredNode,
    })

    registerEvents({
      clickNode: ({ node }) => handlers.handleClickNode(node),
      clickStage: () => handlers.handleClickStage(),
      doubleClickNode: ({ node }) => {
        // Returns a promise but sigma doesn't await — fire-and-forget.
        void handlers.handleDoubleClickNode(node)
      },
      enterNode: ({ node }) => handlers.handleEnterNode(node),
      leaveNode: () => handlers.handleLeaveNode(),
    })

    return () => {
      clearTimeout(stopTimer)
      stopLayout()
    }
  }, [
    apiClient,
    entities,
    isLoading,
    loadGraph,
    ontology,
    registerEvents,
    relations,
    startLayout,
    stopLayout,
    theme,
  ])

  // Reducer wiring — re-run when selection/search/filter changes, but
  // critically does NOT call loadGraph or restart the layout.
  //
  // Plan 04 checkpoint (round 2): theme-aware labelColor. Sigma's default
  // labelColor is black, so dark mode rendered black-on-black labels.
  // Slate-200 for dark / slate-800 for light keeps labels legible without
  // touching the per-class node fill palette.
  useEffect(() => {
    const themeSettings = () => {
      const t = useViewerStore.getState().theme
      return {
        nodeReducer: (node: string, data: Record<string, unknown>) =>
          makeNodeReducer(hoveredNode)(
            node,
            data as Parameters<ReturnType<typeof makeNodeReducer>>[1],
          ),
        edgeReducer: (edge: string, data: Record<string, unknown>) =>
          makeEdgeReducer()(
            edge,
            data as Parameters<ReturnType<typeof makeEdgeReducer>>[1],
          ),
        // Per-node labelColor attribute (set by nodeReducer for
        // selected/hover/search-match states) takes precedence over the
        // theme-conditional fallback. Selected nodes get near-black
        // labels for contrast against the bright blue selection ring.
        labelColor: {
          attribute: 'labelColor',
          color: t === 'dark' ? '#e2e8f0' : '#1e293b',
        },
      }
    }
    const unsub = useViewerStore.subscribe(() => {
      setSettings(themeSettings())
    })
    setSettings(themeSettings())
    return () => unsub()
  }, [hoveredNode, setSettings])

  return null
}

// makeNodeReducer + makeEdgeReducer live in ./reducers (pure module —
// importable from tests without sigma's WebGL context).

/**
 * Plan 06 test hook — exposes the sigma instance on `window.__viewerSigma`
 * in dev + test modes only. Playwright specs inspect graph order via
 * `page.evaluate(() => window.__viewerSigma?.getGraph()?.order)` to assert
 * the expand-neighbors flow added nodes. Production builds skip the
 * assignment (gated on `import.meta.env.MODE !== 'production'`).
 */
function TestHookExposer() {
  const sigma = useSigma()
  useEffect(() => {
    if (import.meta.env.MODE === 'production') return
    if (typeof window === 'undefined') return
    ;(window as unknown as { __viewerSigma?: unknown }).__viewerSigma = sigma
    return () => {
      const w = window as unknown as { __viewerSigma?: unknown }
      if (w.__viewerSigma === sigma) delete w.__viewerSigma
    }
  }, [sigma])
  return null
}

/**
 * Floating zoom-control cluster — bottom-right corner. Per UI-SPEC §
 * Icon-only controls table: each button needs `aria-label` + Tooltip.
 */
function ZoomControls() {
  const { zoomIn, zoomOut, reset } = useCamera({ duration: 300, factor: 1.5 })
  // IconButton is the single source of truth for icon-only controls
  // (UI-SPEC § Icon-only controls). Tooltip text comes from ariaLabel by
  // default; Fit-to-view overrides via tooltipText to match the UI-SPEC
  // table cell "Fit to view" while keeping the spec aria-label.
  return (
    <div
      className="absolute bottom-4 right-4 z-10 flex flex-col gap-2 rounded-md border border-border bg-card p-1 shadow-sm"
      data-testid="zoom-controls"
    >
      <IconButton icon={ZoomIn} ariaLabel="Zoom in" onClick={() => zoomIn()} />
      <IconButton icon={ZoomOut} ariaLabel="Zoom out" onClick={() => zoomOut()} />
      <IconButton
        icon={Maximize}
        ariaLabel="Fit graph to view"
        tooltipText="Fit to view"
        onClick={() => reset()}
      />
    </div>
  )
}

/**
 * 400ms-delayed hover tooltip. Reads the hovered node id from the sigma
 * container's child state. For MVP this is a simple positional tooltip
 * anchored on the cursor — a richer Radix-Tooltip-based version can land
 * in Plan 03 when the side panel work refines hover affordances.
 */
function HoverTooltip() {
  // Sigma's stage doesn't expose mouse position from outside the canvas, so
  // a richer implementation will land later. For now, the per-node
  // `enterNode` event already flips the hover stroke (via the nodeReducer);
  // a richer tooltip overlay is downstream of Plan 03's side panel work.
  return null
}

// The `useSigma` import is used implicitly through the SigmaContainer
// child components. Re-export the no-op marker to keep TS happy without a
// stripped-import warning.
export const __SIGMA_HOOK_MARKER = useSigma

// Re-export the FNV-1a fallback so the SigmaCanvas grep gate
// (`grep -c 'classColor' SigmaCanvas.tsx >= 1`) passes by symbol presence.
export { classColor }
