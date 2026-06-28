// Operator feedback (Plan 03 checkpoint round 2): the FNV-1a HSL randomized
// hue scheme produced a "children's drawing book" look. Replace with a
// monochrome blue scale keyed off ontology hierarchy depth — VOKB-style
// professional palette where shade carries semantic meaning (depth in
// the hierarchy).
//
// Hierarchy classes (System / Project / Component / SubComponent /
// Detail) get progressively-lighter blues. Typed-views classes
// (Observation / Digest / Insight / LearningArtifact) get an amber
// scale by depth-of-meta. Unknown classes get neutral slate.
//
// Output is hex (#rrggbb) — Sigma's WebGL color parser rejects hsl()
// strings; hex is universal.

// 2026-06-11: palette aligned with the VKB reference
// (integrations/memory-visualizer/src/components/KnowledgeGraph/index.tsx
// :112-130) per user request "the viewer distinguishes between batch mode
// learned (via the waves, shades of blue) and online learned nodes
// (shades of light-red)".
//
// Two orthogonal axes drive node fill:
//   1. ontologyClass: hierarchy depth (Project=darkest → Detail=lightest)
//   2. metadata.source: 'auto' (online-learned by ETM/consolidator) → red
//      shades; everything else → blue shades.
//
// Free-form entityType (Process, Container, File, Port, Config, Fault,
// etc.) is NO LONGER painted as a distinct color — those were the
// "aboriginal dot-art" palette the user objected to. With `ontologyClass`
// normalized to one of the 4 canonical classes (Phase-2026-06-11 patch),
// the hierarchy palette covers every entity.
const BATCH_PALETTE = {
  Project:      '#00897b',  // teal/green (VKB reference)
  Component:    '#1565c0',  // dark blue
  SubComponent: '#42a5f5',  // medium blue
  Detail:       '#90caf9',  // light blue
  // System sits above Project; reuse Project's teal so the root node stays
  // recognisable.
  System:       '#00695c',  // teal-800
} as const

// Online (source='auto') uses light-red shades by hierarchy. Most online
// entities are Insights (which collapse to ontologyClass='Detail') so the
// lightest red dominates; deeper-than-Detail isn't used in practice.
const ONLINE_PALETTE = {
  Project:      '#e57373',  // red-300
  Component:    '#ef5350',  // red-400
  SubComponent: '#f48fb1',  // pink-200
  Detail:       '#ffb6c1',  // light-pink — VKB reference Online/Auto value
  System:       '#c62828',  // red-800
} as const

const DEFAULT_BATCH = '#94a3b8' // slate-400 — non-hierarchy classes
const DEFAULT_ONLINE = '#ffb6c1' // light-pink

/**
 * Per-class fill. `source` is the per-entity learning provenance:
 *   - 'auto'   → online-learned (ObservationWriter / consolidator output) → red
 *   - else     → batch / manual / migration-imported → blue
 *
 * Third argument is theme; reserved for future variants. The palette today
 * is theme-independent because the canvas background is `bg-background` and
 * hex sits on top.
 */
export function classColor(
  className: string,
  _theme: 'light' | 'dark',
  source?: string,
): string {
  // Online-learned = source ∈ {'auto','online'} — the SAME predicate the
  // visibility filter uses (visibility-predicate.ts:115). The data stamps
  // ETM/consolidator output as 'online' far more often than 'auto', so the
  // prior `=== 'auto'` check left most online-learned nodes painted in the
  // blue/grey batch palette instead of the requested light-red. (2026-06-28)
  const isOnline = source === 'auto' || source === 'online'
  const palette = isOnline ? ONLINE_PALETTE : BATCH_PALETTE
  const fallback = isOnline ? DEFAULT_ONLINE : DEFAULT_BATCH
  const c = (palette as Record<string, string>)[className]
  return c ?? fallback
}

/** Internal export — kept for tests that pin the hierarchy contract. */
export function _classHue(className: string): number {
  // Legacy FNV hue derivation, kept so the colorless contract test in
  // color-fallback.test.ts continues to discriminate distinct names.
  let h = 2166136261
  for (let i = 0; i < className.length; i++) {
    h = (h ^ className.charCodeAt(i)) * 16777619
    h = h >>> 0
  }
  return h % 360
}

// -----------------------------------------------------------------------
// Plan 55-05: shape / borderStyle / pulseRule fallback helpers.
//
// Mirrors the contract of `classColor` — these helpers are the "no
// overlay was provided" path. The renderer's fallback chain (UI-SPEC §14
// rules 1–5) is:
//
//   color:       display.color   || classColor(...)
//   shape:       display.shape   || shapeFallback(...) || 'circle'
//   borderStyle: display.borderStyle === 'dashed'
//                  || (entity has 0 relations → dashed)
//                  || solid
//   pulseRule:   display.pulseRule && evaluatePulseRule(rule, entity)
//
// The SHAPE_PALETTE below is the verbatim 16-class table from UI-SPEC
// §14 (the `coding.display.json` initial values). Drift breaks the
// renderer's visual contract — keep this table in sync with that spec.
// -----------------------------------------------------------------------

export type ShapeKind = 'circle' | 'diamond' | 'square' | 'triangle' | 'hexagon'

// Exported (Plan 60-02 G2) so LegendPanel.tsx can derive the registered-class
// set without re-listing every class name (which would re-introduce literal
// OKB seeds like 'RuntimeDiagnostics' the legend rewrite is meant to drop).
// shapeFallback() is the runtime accessor; SHAPE_PALETTE is the lookup table.
export const SHAPE_PALETTE: Readonly<Record<string, ShapeKind>> = {
  // Hierarchy
  Project: 'hexagon',
  Component: 'square',
  SubComponent: 'square',
  Detail: 'circle',
  // Typed views (LSL pipeline outputs)
  Observation: 'circle',
  Digest: 'diamond',
  Insight: 'diamond',
  LearningArtifact: 'diamond',
  Pattern: 'diamond',
  // Infrastructure / business
  Service: 'square',
  File: 'square',
  Feature: 'hexagon',
  Contract: 'square',
  RuntimeDiagnostics: 'triangle',
  System: 'hexagon',
  Knowledge: 'circle',
} as const

/**
 * UI-SPEC §14 fallback rule #2 — `display.shape || shapeFallback(...) || 'circle'`.
 * Unknown classes fall back to `'circle'` (per spec) so an overlay with
 * an unrecognized class name silently renders as a circle rather than
 * crashing the renderer (T-55-05-02 mitigation).
 */
export function shapeFallback(className: string): ShapeKind {
  return SHAPE_PALETTE[className] ?? 'circle'
}

/**
 * UI-SPEC §14 fallback rule #4 — orphan-on-current-view rule.
 *
 * The class name is intentionally unused: the rule is purely a function
 * of "does this entity have any relations in the current view?". Caller
 * (graph-builder) computes `hasRelations` from the built graphology
 * Graph BEFORE stamping the attribute, so the rule honors the live
 * filter state rather than a backend snapshot.
 *
 * The displayed border style is then overridden by `display.borderStyle
 * === 'dashed'` (overlay can opt into dashed even with relations) — this
 * fallback only kicks in when no overlay is present.
 */
export function borderStyleFallback(
  _className: string,
  hasRelations: boolean,
): 'solid' | 'dashed' {
  return hasRelations ? 'solid' : 'dashed'
}

/**
 * UI-SPEC §14 fallback rule #5 — pulse is overlay-driven only.
 *
 * No pulse without an explicit `display.pulseRule` from the overlay. The
 * class-name argument is unused but kept in the signature to mirror the
 * shape of the other two helpers (consistent caller idiom in
 * graph-builder.ts).
 */
export function pulseRuleFallback(_className: string): string | null {
  return null
}
