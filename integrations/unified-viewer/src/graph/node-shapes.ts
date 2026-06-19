// Plan 60-08 Task 1 (Gap C) — shape-variant node rendering for D3GraphCanvas.
//
// LegendPanel declares a shape per ontology class via SHAPE_PALETTE
// (Project/System=hexagon, Component/SubComponent=square, Insight/Digest=diamond,
// RuntimeDiagnostics=triangle, Detail/Observation=circle), but D3GraphCanvas
// historically appended a `<circle>` for every node regardless of class — so the
// Legend described shapes the canvas could not draw. This module renders the
// SAME shape vocabulary the Legend uses, keyed off the SAME class field.
//
// Class resolution mirrors D3GraphCanvas's existing color contract
// (D3GraphCanvas.tsx:649-659): prefer `entityType`, fall back to `ontologyClass`.
// This is deliberate — e.g. CollectiveKnowledge carries `ontologyClass: Detail`
// but `entityType: System`, and must render as a System hexagon, not a Detail
// circle. Keying off ontologyClass alone would mis-shape it.

import type { Selection } from 'd3'
import { SHAPE_PALETTE, shapeFallback, type ShapeKind } from './color-fallback'

// d3 selection of a node's <g> container; the appended shape inherits it.
type GSelection = Selection<SVGGElement, unknown, null, undefined>
type ShapeSelection = Selection<SVGElement, unknown, null, undefined>

// Path-data generators sized so the shape's bounding circle has radius `r`
// (matches the legacy `.node-circle` r=10 so layout collision math is unchanged).

/** Pointy-top hexagon: 6 vertices at 60° increments starting from the top. */
export const HEXAGON_PATH = (r: number): string => {
  const pts: string[] = []
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 2
    pts.push(`${(r * Math.cos(angle)).toFixed(3)},${(r * Math.sin(angle)).toFixed(3)}`)
  }
  return `M${pts.join('L')}Z`
}

/** Diamond (square rotated 45°): top, right, bottom, left. */
export const DIAMOND_PATH = (r: number): string =>
  `M0,${-r} L${r},0 L0,${r} L${-r},0 Z`

/** Upward equilateral-ish triangle inscribed in radius `r`. */
export const TRIANGLE_PATH = (r: number): string => {
  const pts: string[] = []
  for (let i = 0; i < 3; i++) {
    const angle = (2 * Math.PI / 3) * i - Math.PI / 2
    pts.push(`${(r * Math.cos(angle)).toFixed(3)},${(r * Math.sin(angle)).toFixed(3)}`)
  }
  return `M${pts.join('L')}Z`
}

export type ShapeAppender = (sel: GSelection, r: number) => ShapeSelection

// One appender per ShapeKind. Each returns the appended sub-selection so the
// caller can chain fill/stroke styling (as the legacy circle append did).
export const SHAPE_RENDERERS: Record<ShapeKind, ShapeAppender> = {
  circle: (sel, r) => sel.append('circle').attr('r', r) as unknown as ShapeSelection,
  square: (sel, r) =>
    sel
      .append('rect')
      .attr('x', -r)
      .attr('y', -r)
      .attr('width', r * 2)
      .attr('height', r * 2) as unknown as ShapeSelection,
  diamond: (sel, r) => sel.append('path').attr('d', DIAMOND_PATH(r)) as unknown as ShapeSelection,
  hexagon: (sel, r) => sel.append('path').attr('d', HEXAGON_PATH(r)) as unknown as ShapeSelection,
  triangle: (sel, r) => sel.append('path').attr('d', TRIANGLE_PATH(r)) as unknown as ShapeSelection,
}

/**
 * Append the class-appropriate SVG shape to a node's <g> selection and return
 * it (with `class="node-shape"`) for further styling. Unknown / missing class
 * falls back to a circle via `shapeFallback` — matching the existing
 * color-fallback defensive pattern (UI-SPEC §14 rule #2).
 *
 * @param entity node datum carrying `entityType` and/or `ontologyClass`
 * @param sel    the node's <g> d3 selection
 * @param r      node radius (legacy `.node-circle` used 10)
 */
export function renderNodeShape(
  entity: { entityType?: string; ontologyClass?: string },
  sel: GSelection,
  r: number,
): ShapeSelection {
  const cls = entity.entityType ?? entity.ontologyClass
  const kind: ShapeKind = shapeFallback(cls ?? '')
  const renderer = SHAPE_RENDERERS[kind] ?? SHAPE_RENDERERS.circle
  return renderer(sel, r).attr('class', 'node-shape')
}
