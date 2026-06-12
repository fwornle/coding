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
// 2026-06-11: Stock NodeCircleProgram ignores borderColor/borderSize —
// our reducer's per-frame borderColor writes were silently dropped. Use
// @sigma/node-border's factory to build a program that paints a 2px
// border ring driven by the `borderColor` node attribute, on top of a
// `color`-filled inner. Non-insight nodes get borderColor = transparent
// (default), so they look identical to the plain circle program. The
// reducer overrides borderColor to dark-blue for hasInsightDoc nodes,
// which materialises as the VKB "Has Insight Doc" ring.
import { createNodeBorderProgram } from '@sigma/node-border'

const NodeCircleWithBorderProgram = createNodeBorderProgram({
  borders: [
    {
      color: { attribute: 'borderColor', defaultValue: 'rgba(0,0,0,0)' },
      size: { value: 2, mode: 'pixels' },
    },
    {
      color: { attribute: 'color' },
      size: { fill: true },
    },
  ],
})

type NodeProgramConstructor = typeof NodeCircleProgram

export const SHAPE_NODE_PROGRAMS: Readonly<Record<string, NodeProgramConstructor>> = {
  circle: NodeCircleWithBorderProgram as unknown as NodeProgramConstructor,
  diamond: NodeCircleWithBorderProgram as unknown as NodeProgramConstructor,
  square: NodeCircleWithBorderProgram as unknown as NodeProgramConstructor,
  triangle: NodeCircleWithBorderProgram as unknown as NodeProgramConstructor,
  hexagon: NodeCircleWithBorderProgram as unknown as NodeProgramConstructor,
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

    // 2026-06-11: VKB-style "Has Insight Doc" indicator. When the entity
    // has an attached insight (graph-builder set hasInsightDoc on Insight-
    // type entities), override the default-state stroke to a 2px dark-blue
    // ring so the user can spot them at a glance. Hover/selected states
    // still win — the user's interaction signal takes precedence.
    const hasInsightDoc = (data as { hasInsightDoc?: boolean }).hasInsightDoc === true
    const finalStroke = hasInsightDoc && state === 'default'
      ? { ...stroke, color: '#1565c0', width: 2 }
      : stroke

    return {
      ...data,
      hidden: false,
      borderColor: finalStroke.color,
      borderSize: finalStroke.width,
      opacity: stroke.opacity,
      glow: stroke.glow,
      // Plan 55-05 visual overlays:
      ...(stroke.borderStyle !== undefined
        ? { borderStyle: stroke.borderStyle }
        : {}),
      ...(halo !== undefined ? { halo } : {}),
      // 2026-06-11 ROLLBACK: restore the per-node `type: shape` forward.
      // I'd removed it thinking React-Sigma's settings HMR was dropping
      // nodeProgramClasses, but the real cause was an invalid
      // `zoomToSizeRatioFunction` I'd added that made the whole settings
      // object fail validation silently (SHAPE_NODE_PROGRAMS never got
      // through, so 'circle' itself wasn't registered). Without `type`
      // here Sigma needed `defaultNodeType: 'circle'` to resolve — but
      // that hit the same dropped-settings code path. Both rollbacks
      // were done together.
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
    const theme = store.theme
    const from = (data.source ?? '') as string
    const to = (data.target ?? '') as string
    // Pick a theme-aware base for the dimmed off-path edges below.
    const dimBase = theme === 'dark' ? '#334155' : '#cbd5e1'
    // 2026-06-11: when both endpoints are on the ancestry path, paint the
    // edge in the VKB blue so the user can trace System → Project →
    // Component → SubComponent → Detail visually. Otherwise fall through
    // to the existing primary-incident logic.
    const path = store.pathToSelected
    if (path && path.size > 0) {
      if (path.has(from) && path.has(to)) {
        // Path edges are slightly thicker than baseline 0.5 so the trace
        // reads against the muted hairlines, but still thin (VKB style).
        return { ...data, color: '#1565c0', opacity: 1.0, size: 1.2 }
      }
      // Edges outside the path get dimmed to match the dimmed nodes.
      return { ...data, color: dimBase, opacity: 0.08 }
    }
    const style = edgeStateForRelation({ from, to }, store.selectedNodeId, undefined, theme)
    return {
      ...data,
      color: style.color,
      opacity: style.opacity,
    }
  }
}
