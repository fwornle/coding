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

const PALETTE = {
  // Hierarchy — blue scale (darker = closer to root)
  System: '#1e3a8a',       // navy-900
  Project: '#1d4ed8',      // blue-700
  Component: '#3b82f6',    // blue-500
  SubComponent: '#60a5fa', // blue-400
  Detail: '#93c5fd',       // blue-300

  // Container / structural metadata — teal scale
  Container: '#0d9488',    // teal-600
  Config: '#0891b2',       // cyan-600
  File: '#06b6d4',         // cyan-500
  Port: '#22d3ee',         // cyan-400

  // Behavior / runtime — amber scale
  Feature: '#d97706',      // amber-600
  Fault: '#dc2626',        // red-600

  // Typed-views (LSL pipeline outputs) — amber scale
  Observation: '#f59e0b',     // amber-500
  Digest: '#b45309',          // amber-700
  Insight: '#7c2d12',         // orange-900
  LearningArtifact: '#854d0e', // amber-800

  // Knowledge meta
  Knowledge: '#7c3aed',    // violet-600

  // Default — neutral slate
  __default__: '#94a3b8',  // slate-400
} as const

export function classColor(className: string, _theme: 'light' | 'dark'): string {
  // Theme is reserved for future variants but the palette is theme-
  // independent today — both dark and light tokens read the same hex
  // because the canvas background is `bg-background` and hex sits on top.
  const c = (PALETTE as Record<string, string>)[className]
  return c ?? PALETTE.__default__
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
