// Sigma per-frame reducer factories. Pure functions over (node, attrs,
// store-snapshot). Extracted from SigmaCanvas.tsx so unit tests can run
// without pulling in sigma's top-level WebGL2RenderingContext check
// (which jsdom lacks).
//
// PATTERN SOURCE: 45-UI-SPEC.md § Color State + § Color Edges (the
// state-to-style translation contract).

import { computeNodeState, type NodeAttrs } from './graph-builder'
import {
  edgeStateForRelation,
  evaluatePulseRule,
  nodeStrokeForState,
} from './node-renderer'
import type { Entity } from './types'
import { useViewerStore } from '@/store/viewer-store'

// Plan 55-05 (UI-SPEC §14): nodeProgramClasses registration map. Sigma
// reads this on container construction to dispatch each node to the
// right WebGL program based on `attributes.type`. The graph-builder
// stamps `shape` on each node; the SigmaCanvas wires `attributes.type
// = attributes.shape` via setSettings so the dispatch lands correctly.
//
// IMPORTANT: All five shapes map to sigma's built-in NodeCircleProgram
// for v1 — drawing actual diamonds/squares/triangles/hexagons would
// require shipping custom WebGL shaders, which is out of scope for
// Plan 55-05. The registration map is in place so a future plan can
// swap each value to a real custom-shape program without changing
// SigmaCanvas wiring. Until then, the 5-shape visual encoding lives
// in the (still-distinct) class colors + the dashed/halo overlays
// rendered by the per-frame reducer.
//
// Exporting as a value (not a default) so unit tests can assert the
// map's keys (5 shapes) and value typeof (function/constructor).
import { NodeCircleProgram } from 'sigma/rendering'

type NodeProgramConstructor = typeof NodeCircleProgram

export const SHAPE_NODE_PROGRAMS: Readonly<Record<string, NodeProgramConstructor>> = {
  circle: NodeCircleProgram,
  diamond: NodeCircleProgram, // TODO: ship custom diamond program in a follow-up plan
  square: NodeCircleProgram, // TODO: ship custom square program in a follow-up plan
  triangle: NodeCircleProgram, // TODO: ship custom triangle program in a follow-up plan
  hexagon: NodeCircleProgram, // TODO: ship custom hexagon program in a follow-up plan
} as const

/**
 * Read `prefers-reduced-motion: reduce` synchronously. Cached at module
 * scope so the per-frame reducer doesn't re-query the MediaQueryList for
 * every node; the SigmaCanvas component invalidates this on media-query
 * change via `setReducedMotion(...)`.
 *
 * jsdom under vitest: window.matchMedia exists but returns matches=false
 * by default; the SigmaCanvas test overrides it with a stub before
 * invoking the reducer.
 */
let _reducedMotion: boolean = (() => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches === true
  } catch {
    return false
  }
})()

export function setReducedMotion(reduced: boolean): void {
  _reducedMotion = reduced
}

/**
 * Test helper — re-read the media query (for vitest stubs that patch
 * window.matchMedia mid-test). Not exported in production code paths.
 */
function readReducedMotionLive(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return _reducedMotion
  }
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches === true
  } catch {
    return _reducedMotion
  }
}

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
    data: NodeAttrs & {
      color?: string
      label?: string
      size?: number
      // Plan 55-05 attrs threaded by graph-builder onto each node:
      borderStyle?: 'solid' | 'dashed'
      pulseRule?: string | null
      updatedAt?: string
      // metadata is on NodeAttrs via the index signature
    },
  ) {
    const store = useViewerStore.getState()
    const state = computeNodeState(node, data, store, hoveredNode)

    // Plan 55-05: pulse-rule evaluation per frame. Reads pulseRule +
    // updatedAt + metadata from node attrs (stamped by graph-builder).
    // Unknown rules / missing data silently return false (T-55-05-02).
    const pulseRule = (data.pulseRule ?? null) as string | null
    const pulseRuleResult = evaluatePulseRule(pulseRule, data as unknown as Entity)

    const borderStyle = data.borderStyle
    const stroke = nodeStrokeForState(state, borderStyle, pulseRuleResult)
    if (!stroke) {
      return { ...data, hidden: true }
    }

    // Reduced-motion handling (UI-SPEC §12 + §15): when the user prefers
    // reduced motion, the halo phase is pinned to 0.5 (mid-cycle peak
    // opacity) so the SigmaCanvas program renders a static 50%-opacity
    // ring instead of animating. Read live so vitest stubs that patch
    // window.matchMedia mid-test see the override.
    let halo = stroke.halo
    if (halo && readReducedMotionLive()) {
      halo = { ...halo, phase: 0.5 }
    }

    return {
      ...data,
      hidden: false,
      borderColor: stroke.color,
      borderSize: stroke.width,
      opacity: stroke.opacity,
      glow: stroke.glow,
      // Plan 55-05 visual overlays:
      ...(stroke.borderStyle !== undefined
        ? { borderStyle: stroke.borderStyle }
        : {}),
      ...(halo !== undefined ? { halo } : {}),
      // sigma's per-program dispatch: read `type` from `shape` so the
      // nodeProgramClasses map (SHAPE_NODE_PROGRAMS) routes each node
      // to its WebGL program (v1: all five share NodeCircleProgram).
      ...(data.shape !== undefined ? { type: data.shape as string } : {}),
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
