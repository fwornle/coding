// Sigma per-frame reducer factories. Pure functions over (node, attrs,
// store-snapshot). Extracted from SigmaCanvas.tsx so unit tests can run
// without pulling in sigma's top-level WebGL2RenderingContext check
// (which jsdom lacks).
//
// PATTERN SOURCE: 45-UI-SPEC.md § Color State + § Color Edges (the
// state-to-style translation contract).

import { computeNodeState, type NodeAttrs } from './graph-builder'
import { edgeStateForRelation, nodeStrokeForState } from './node-renderer'
import { useViewerStore } from '@/store/viewer-store'

/**
 * Build the per-frame node reducer. Reads the current Zustand snapshot
 * at call time so selection/search/filter changes flow through without
 * re-mounting the sigma instance.
 */
export function makeNodeReducer(hoveredNode: string | null) {
  return function nodeReducer(
    node: string,
    data: NodeAttrs & { color?: string; label?: string; size?: number },
  ) {
    const store = useViewerStore.getState()
    const state = computeNodeState(node, data, store, hoveredNode)
    const stroke = nodeStrokeForState(state)
    if (!stroke) {
      return { ...data, hidden: true }
    }
    return {
      ...data,
      hidden: false,
      borderColor: stroke.color,
      borderSize: stroke.width,
      opacity: stroke.opacity,
      glow: stroke.glow,
    }
  }
}

/**
 * Build the per-frame edge reducer. Reads selectedNodeId from Zustand
 * to drive the primary-incident highlight.
 */
export function makeEdgeReducer() {
  return function edgeReducer(
    _edge: string,
    data: { source?: string; target?: string; color?: string; size?: number },
  ) {
    const store = useViewerStore.getState()
    const from = (data.source ?? '') as string
    const to = (data.target ?? '') as string
    const style = edgeStateForRelation({ from, to }, store.selectedNodeId)
    return {
      ...data,
      color: style.color,
      opacity: style.opacity,
    }
  }
}
