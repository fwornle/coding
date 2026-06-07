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
/**
 * Per-state label color. Plan 04 round 2 operator feedback: bright
 * blue selected/hover rings + the global theme-conditional label
 * color (light gray in dark mode, dark slate in light mode) collide
 * on selected/hovered nodes — light-on-bright is hard to read. The
 * reducer returns an override on selected/hover/search-match so the
 * label always renders in near-black on the bright ring backdrop;
 * other states fall through to sigma's `labelColor.color` global
 * theme fallback (configured in SigmaCanvas).
 */
function labelColorForState(
  state: ReturnType<typeof computeNodeState>,
): string | undefined {
  switch (state) {
    case 'selected':
    case 'hover':
    case 'search-match':
      return '#0a0a0a'
    default:
      return undefined
  }
}

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
      labelColor: labelColorForState(state),
      // forceLabel so selected/hovered/search-match labels render even
      // when they'd be filtered by labelRenderedSizeThreshold (operator
      // round 2: "I want to see what I picked").
      forceLabel:
        state === 'selected' || state === 'hover' || state === 'search-match',
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
