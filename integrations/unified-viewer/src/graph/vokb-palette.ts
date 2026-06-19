// PORT-SPEC: VOKB GraphVisualization.tsx:31-176 + NodeDetails.tsx:{636-640,219-228,232-241}
//
// Source-of-truth shared module for VOKB semantic palette (UI-SPEC §4).
// Consumed by:
//   - graph renderer (55-05)         — nodeFill / nodeStroke / nodeStrokeWidth / nodeStrokeDasharray / EDGE_STYLES
//   - LegendPanel + StatsBar (55-07) — FAILURE_MODEL_CLASSES / BUSINESS_CLASSES / LAYER_BADGE_CLASS / nodeFill
//   - EntityDetailPanel (55-09)      — LAYER_BADGE_CLASS / CONFIDENCE_COLOR / RUN_COLORS
//   - IssueTriageView (55-10)        — CONFIDENCE_COLOR (via shared module)
//
// D-55-02a (verbatim VOKB port rule): hex values, Tailwind classes, and
// dark-mode modifiers below are copied LITERALLY from the VOKB source. Do
// NOT round or translate. The snapshot tests in `vokb-palette.test.ts`
// guard against drift in either direction.

/**
 * Source-authority classification — tracks where an entity's data originated
 * (mirrors the VOKB `SourceAuthority` literal union; verbatim from
 * `viewer/src/api/okbClient.ts`). Drives stroke color/width/dasharray so
 * higher-authority sources stand out visually.
 */
export type SourceAuthority =
  | 'official_doc'
  | 'team_knowledge'
  | 'user_input'
  | 'automated_rca'

// Failure-model ontology classes get lighter tints to visually separate them
// from execution-model classes within the same layer (GraphVisualization.tsx:60-62).
export const FAILURE_MODEL_CLASSES: ReadonlySet<string> = new Set([
  'FailurePattern', 'Incident', 'Resolution', 'RootCause', 'Symptom',
])

// Business ontology classes get a distinct green palette to separate
// documentation-sourced entities from operational/RCA entities
// (GraphVisualization.tsx:66-68).
export const BUSINESS_CLASSES: ReadonlySet<string> = new Set([
  'Decision', 'Requirement', 'Risk', 'ActionItem', 'DocumentSource',
])

/**
 * Fill color for a node — verbatim from GraphVisualization.tsx:70-85.
 *
 * - Business ontology classes → emerald scale (lighter for higher layers).
 * - Failure-model classes → lighter tint within their layer's palette.
 * - Default → standard blue (evidence) / amber (pattern) / gray (else).
 */
export function nodeFill(layer: string, ontologyClass?: string): string {
  const isFailure = ontologyClass && FAILURE_MODEL_CLASSES.has(ontologyClass)
  const isBusiness = ontologyClass && BUSINESS_CLASSES.has(ontologyClass)
  if (isBusiness) {
    switch (layer) {
      case 'evidence': return '#10b981' // emerald-500
      case 'pattern':  return '#34d399' // emerald-400
      default:         return '#6ee7b7' // emerald-300
    }
  }
  switch (layer) {
    case 'evidence': return isFailure ? '#93c5fd' : '#3b82f6' // blue-300 / blue-500
    case 'pattern':  return isFailure ? '#fdba74' : '#f59e0b' // orange-300 / amber-500
    default:         return '#6b7280' // gray-500
  }
}

/**
 * Stroke color for a node — verbatim from GraphVisualization.tsx:87-110.
 *
 * Business classes always get green stroke; source-authority overrides
 * layer-based stroke for non-business entities; failure-model classes
 * get lighter strokes within their default layer palette.
 */
export function nodeStroke(
  layer: string,
  ontologyClass?: string,
  sourceAuthority?: SourceAuthority,
): string {
  // Business ontology classes always get green stroke to match their fill
  const isBusiness = ontologyClass && BUSINESS_CLASSES.has(ontologyClass)
  if (isBusiness) {
    switch (layer) {
      case 'evidence': return '#059669' // emerald-600
      case 'pattern':  return '#10b981' // emerald-500
      default:         return '#34d399' // emerald-400
    }
  }
  // Source authority overrides default layer-based stroke for non-business entities
  switch (sourceAuthority) {
    case 'official_doc':   return '#10b981' // emerald-500 — trusted documentation
    case 'team_knowledge': return '#14b8a6' // teal-500    — team-curated knowledge
    case 'user_input':     return '#a78bfa' // violet-400  — ad-hoc user input
    // 'automated_rca' and undefined fall through to default layer-based colors
  }
  const isFailure = ontologyClass && FAILURE_MODEL_CLASSES.has(ontologyClass)
  switch (layer) {
    case 'evidence': return isFailure ? '#60a5fa' : '#2563eb' // blue-400 / blue-600
    case 'pattern':  return isFailure ? '#fb923c' : '#d97706' // orange-400 / amber-600
    default:         return '#4b5563' // gray-600
  }
}

/** Stroke width by source authority — verbatim GraphVisualization.tsx:113-120. */
export function nodeStrokeWidth(sourceAuthority?: SourceAuthority): number {
  switch (sourceAuthority) {
    case 'official_doc':   return 3
    case 'team_knowledge': return 2.5
    case 'user_input':     return 2.5
    default:               return 2
  }
}

/** Dashed stroke for user_input to signal lower authority — verbatim GraphVisualization.tsx:123-125. */
export function nodeStrokeDasharray(sourceAuthority?: SourceAuthority): string {
  return sourceAuthority === 'user_input' ? '4,2' : ''
}

/**
 * Edge style by relationship type — verbatim from GraphVisualization.tsx:135-173.
 *
 * Semantic groups:
 *   Structural (gray):     DERIVED_FROM, PART_OF, CONTAINS, HAS_TYPE, HAS_VERSION
 *   Causal (red/orange):   CAUSED_BY, CAUSED, HAS_ROOT_CAUSE, HAS_SYMPTOM, INDICATES
 *   Operational (blue):    OBSERVED_IN, LOCATED_IN, DEPLOYED_ON, RUNS_ON, RUNS_IN, MANAGED_BY
 *   Data-flow (green):     READS, PROCESSES, CONSUMED_BY, STORED_IN, USES
 *   Resolution (teal):     RESOLVES, MITIGATES, APPLIED_TO, APPLIES_TO, MATCHES
 *   Association (purple):  CORRELATED_WITH, DEPENDS_ON, AFFECTS
 *   Default (light gray):  RELATES_TO and unknown types
 */
export const EDGE_STYLES: Record<string, { color: string; dasharray: string }> = {
  // Structural — gray
  DERIVED_FROM:     { color: '#9ca3af', dasharray: '' },
  PART_OF:          { color: '#6b7280', dasharray: '' },
  CONTAINS:         { color: '#6b7280', dasharray: '' },
  HAS_TYPE:         { color: '#9ca3af', dasharray: '3,3' },
  HAS_VERSION:      { color: '#9ca3af', dasharray: '3,3' },
  // Causal — red/orange
  CAUSED_BY:        { color: '#ef4444', dasharray: '' },
  CAUSED:           { color: '#dc2626', dasharray: '' },
  HAS_ROOT_CAUSE:   { color: '#f97316', dasharray: '' },
  HAS_SYMPTOM:      { color: '#fb923c', dasharray: '' },
  INDICATES:        { color: '#ea580c', dasharray: '5,3' },
  // Operational — blue
  OBSERVED_IN:      { color: '#3b82f6', dasharray: '' },
  LOCATED_IN:       { color: '#2563eb', dasharray: '' },
  DEPLOYED_ON:      { color: '#60a5fa', dasharray: '' },
  RUNS_ON:          { color: '#60a5fa', dasharray: '' },
  RUNS_IN:          { color: '#60a5fa', dasharray: '' },
  MANAGED_BY:       { color: '#93c5fd', dasharray: '5,3' },
  // Data-flow — green
  READS:            { color: '#22c55e', dasharray: '' },
  PROCESSES:        { color: '#16a34a', dasharray: '' },
  CONSUMED_BY:      { color: '#4ade80', dasharray: '' },
  STORED_IN:        { color: '#86efac', dasharray: '' },
  USES:             { color: '#22c55e', dasharray: '5,3' },
  // Resolution — teal
  RESOLVES:         { color: '#14b8a6', dasharray: '' },
  MITIGATES:        { color: '#2dd4bf', dasharray: '' },
  APPLIED_TO:       { color: '#5eead4', dasharray: '' },
  APPLIES_TO:       { color: '#5eead4', dasharray: '' },
  MATCHES:          { color: '#0d9488', dasharray: '5,3' },
  // Association — purple
  CORRELATED_WITH:  { color: '#a855f7', dasharray: '5,5' },
  DEPENDS_ON:       { color: '#8b5cf6', dasharray: '' },
  AFFECTS:          { color: '#c084fc', dasharray: '' },
  // ── VKB (coding KG) relation types ──────────────────────────────────────
  // The OKB/RCA keys above are UPPER_SNAKE, but the coding online-learning
  // pipeline emits lowercase/camelCase types (contains, capturedBy, …). With
  // no matching key every VKB edge fell through to the gray RELATES_TO default
  // — so the Legend RELATIONSHIPS section rendered every relationship as the
  // SAME gray solid line and the canvas drew uniform gray edges (operator
  // request 2026-06-19: "use the different styles in the graph, or drop them
  // from the legend"). Distinct color+dash per type, grouped by meaning:
  //   hierarchy=gray · provenance=blue · derivation=green · insight=amber ·
  //   code/semantic=teal · association=purple · mention=faint.
  contains:                  { color: '#6b7280', dasharray: '' },
  'parent-child':            { color: '#4b5563', dasharray: '' },
  derivedFrom:               { color: '#22c55e', dasharray: '' },
  has_insight:               { color: '#f59e0b', dasharray: '' },
  capturedBy:                { color: '#60a5fa', dasharray: '4,3' },
  related_to:                { color: '#a855f7', dasharray: '5,5' },
  implemented_in:            { color: '#14b8a6', dasharray: '' },
  contributes_to:            { color: '#5eead4', dasharray: '5,3' },
  originally_developed_in:   { color: '#f97316', dasharray: '5,3' },
  mentions:                  { color: '#cbd5e1', dasharray: '2,2' },
  // Default fallback
  RELATES_TO:       { color: '#d1d5db', dasharray: '' },
}

/**
 * Layer badge Tailwind classes — verbatim from NodeDetails.tsx:636-640.
 *
 * Used by EntityDetailPanel + LegendPanel to render the "evidence"/"pattern"
 * layer chip with light/dark mode support. Unknown layers fall back to gray
 * (handled at the call site, mirroring NodeDetails.tsx behavior).
 */
export const LAYER_BADGE_CLASS: Record<string, string> = {
  evidence: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  pattern:  'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
}

/**
 * Confidence-level badge palette — distilled from NodeDetails.tsx:219-228
 * (`confidenceColorClass` + `confidenceLabel`).
 *
 * The VOKB source returns one color class per score band; here it is
 * canonicalized into a `{ class, dot }` pair so EntityDetailPanel can render
 * both the chip background and a discrete dot indicator without duplicating
 * the band thresholds.
 */
export const CONFIDENCE_COLOR: Record<'High' | 'Moderate' | 'Low', { class: string; dot: string }> = {
  High:     { class: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',     dot: 'bg-green-500' },
  Moderate: { class: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300', dot: 'bg-yellow-500' },
  Low:      { class: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300', dot: 'bg-orange-500' },
}

/**
 * 8-color cycle for distinct ingestion runs — verbatim from NodeDetails.tsx:232-241.
 *
 * Run colors are assigned by order of appearance: runs[0] gets blue,
 * runs[1] emerald, runs[2] violet, etc. Wraps after 8 (mod-8 index at call site).
 */
export const RUN_COLORS: ReadonlyArray<{ bg: string; border: string; dot: string }> = [
  { bg: 'bg-blue-100 dark:bg-blue-900/40',       border: 'border-blue-400 dark:border-blue-600',       dot: 'bg-blue-500' },
  { bg: 'bg-emerald-100 dark:bg-emerald-900/40', border: 'border-emerald-400 dark:border-emerald-600', dot: 'bg-emerald-500' },
  { bg: 'bg-violet-100 dark:bg-violet-900/40',   border: 'border-violet-400 dark:border-violet-600',   dot: 'bg-violet-500' },
  { bg: 'bg-amber-100 dark:bg-amber-900/40',     border: 'border-amber-400 dark:border-amber-600',     dot: 'bg-amber-500' },
  { bg: 'bg-rose-100 dark:bg-rose-900/40',       border: 'border-rose-400 dark:border-rose-600',       dot: 'bg-rose-500' },
  { bg: 'bg-cyan-100 dark:bg-cyan-900/40',       border: 'border-cyan-400 dark:border-cyan-600',       dot: 'bg-cyan-500' },
  { bg: 'bg-pink-100 dark:bg-pink-900/40',       border: 'border-pink-400 dark:border-pink-600',       dot: 'bg-pink-500' },
  { bg: 'bg-lime-100 dark:bg-lime-900/40',       border: 'border-lime-400 dark:border-lime-600',       dot: 'bg-lime-500' },
]
