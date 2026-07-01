/**
 * Central color config — the single source of truth for workflow-graph colors.
 *
 * Mirrors the DynArch `js/config/colors.js` pattern (one module every consumer
 * imports, no scattered literals) and adds the piece DynArch didn't need:
 * light/dark parity. Every palette carries a `light` and a `dark` variant, and
 * `useWorkflowColors()` selects the active one from the current theme.
 *
 * WHY a JS module rather than pure CSS variables: the workflow SVGs apply color
 * through `fill=`/`stroke=` *presentation attributes*, and those do NOT resolve
 * `var(--x)` — only the CSS `fill`/`stroke` *properties* (via `style`/class) do.
 * A theme-selected JS palette works with plain attributes, so nodes, substep
 * arcs, and edges recolor correctly in both themes with zero per-value `.dark`
 * CSS overrides. This retires the interim `.dark .fill-* { … }` block in
 * index.css that was patching these one hue at a time.
 *
 * The color VALUES below are the canonical definitions. `components/workflow/
 * constants.ts` re-exports the light variants (NODE_STATUS_COLORS, etc.) for
 * backward compatibility with any consumer that still reads the static objects.
 */

import { useEffect, useState } from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Filled-surface color triple used by the main agent nodes. */
export interface SurfaceColor {
  /** Node/background fill. */
  bg: string
  /** Outline stroke. */
  border: string
  /** Label / icon text color. */
  text: string
}

/** Two-part color used by substep arcs and other stroked SVG shapes. */
export interface ArcColor {
  fill: string
  stroke: string
}

export type NodeStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'retry'
  | 'inactive'
  | 'paused'

export type SubstepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'skipped'
  | 'retry'
  | 'selected'

export type EdgeType = 'control' | 'retry' | 'dataflow' | 'dependency' | 'self'

export type ConfidenceLevel = 'high' | 'mid' | 'low'

export interface WorkflowPalette {
  /** Main hub-and-spoke agent node surfaces. */
  node: Record<NodeStatus, SurfaceColor>
  /** Substep ring arcs. */
  substep: Record<SubstepStatus, ArcColor>
  /** Edge line colors by semantic type. */
  edge: Record<EdgeType, string>
  /** Confidence badge fills (ukb graph). */
  confidence: Record<ConfidenceLevel, ArcColor>
  /** One-off decorative / structural colors used inside the SVGs. */
  chrome: {
    /** Legend panel background (was fill="white"). */
    legendBg: string
    /** Legend panel border (was #e2e8f0). */
    legendBorder: string
    /** Legend heading text (was fill-slate-700). */
    legendText: string
    /** Legend row labels (was fill-slate-600). */
    legendSubtext: string
    /** Legend hint line (was fill-slate-500 / text-slate-400). */
    legendHint: string
    /** Orchestrator ring stroke (was #6366f1). */
    orchestratorRing: string
    /** Step-count badge fill (indigo-500). */
    stepBadge: string
    /** Text on colored badges / arcs (white). */
    onBadge: string
    /** Inactive / "not yet run" dashed stroke (was #94a3b8). */
    inactiveStroke: string
    /** Purple dataflow accent used by the ukb graph (#8b5cf6). */
    dataflowAccent: string
    /** Amber accent used for pause / warning arcs (#f59e0b). */
    amberAccent: string
    /** Running-node glow (drop-shadow rgba). */
    glowRunning: string
    /** Retry-node glow (drop-shadow rgba). */
    glowRetry: string
    /** Completed-arc glow (drop-shadow rgba). */
    glowCompleted: string
  }
}

// ---------------------------------------------------------------------------
// Light palette — canonical values (mirror the pre-refactor hardcoded hex)
// ---------------------------------------------------------------------------

const LIGHT: WorkflowPalette = {
  node: {
    pending:   { bg: '#f3f4f6', border: '#d1d5db', text: '#6b7280' },  // gray-100/300/500
    running:   { bg: '#dbeafe', border: '#3b82f6', text: '#1d4ed8' },  // blue-100/500/700
    completed: { bg: '#dcfce7', border: '#22c55e', text: '#15803d' },  // green-100/500/700
    failed:    { bg: '#fee2e2', border: '#ef4444', text: '#b91c1c' },  // red-100/500/700
    skipped:   { bg: '#f9fafb', border: '#e5e7eb', text: '#9ca3af' },  // gray-50/200/400
    retry:     { bg: '#fff7ed', border: '#f97316', text: '#c2410c' },  // orange-50/500/700
    inactive:  { bg: '#f8fafc', border: '#e2e8f0', text: '#cbd5e1' },  // slate-50/200/300
    paused:    { bg: '#fef3c7', border: '#f59e0b', text: '#92400e' },  // amber-100/500/800
  },
  substep: {
    pending:   { fill: '#93c5fd', stroke: '#60a5fa' },  // blue-300/400
    running:   { fill: '#1d4ed8', stroke: '#ffffff' },  // blue-700 + white glow
    completed: { fill: '#22c55e', stroke: '#16a34a' },  // green-500/600
    skipped:   { fill: '#d1d5db', stroke: '#9ca3af' },  // gray-300/400
    retry:     { fill: '#f97316', stroke: '#ffffff' },  // orange-500 + white glow
    selected:  { fill: '#60a5fa', stroke: '#3b82f6' },  // blue-400/500
  },
  edge: {
    control:    '#6366f1',  // indigo
    retry:      '#f59e0b',  // amber
    dataflow:   '#10b981',  // emerald
    dependency: '#64748b',  // slate
    self:       '#8b5cf6',  // purple
  },
  confidence: {
    high: { fill: '#22c55e', stroke: '#16a34a' },  // green-500/600
    mid:  { fill: '#f59e0b', stroke: '#d97706' },  // amber-500/600
    low:  { fill: '#ef4444', stroke: '#dc2626' },  // red-500/600
  },
  chrome: {
    legendBg:        '#ffffff',
    legendBorder:    '#e2e8f0',  // slate-200
    legendText:      '#334155',  // slate-700
    legendSubtext:   '#475569',  // slate-600
    legendHint:      '#64748b',  // slate-500
    orchestratorRing:'#6366f1',  // indigo-500
    stepBadge:       '#6366f1',  // indigo-500
    onBadge:         '#ffffff',
    inactiveStroke:  '#94a3b8',  // slate-400
    dataflowAccent:  '#8b5cf6',  // purple-500
    amberAccent:     '#f59e0b',  // amber-500
    glowRunning:     'rgba(59, 130, 246, 0.6)',
    glowRetry:       'rgba(249, 115, 22, 0.6)',
    glowCompleted:   'rgba(34, 197, 94, 0.5)',
  },
}

// ---------------------------------------------------------------------------
// Dark palette — toned for a dark canvas
//
// Design rules (carried over from the interim .dark override decisions):
//   - Node surfaces: light -100 fills → the hue at ~0.2 alpha (a tint, not a
//     glaring block); strokes stay bright -500 for definition; text lightens
//     to the -300 range so it reads on the tint.
//   - Neon status green tones one shade deeper (green-600) to kill the glow.
//   - Legend chrome flips to the dark card surface + light text.
// ---------------------------------------------------------------------------

const DARK: WorkflowPalette = {
  node: {
    pending:   { bg: 'rgba(148, 163, 184, 0.15)', border: '#475569', text: '#94a3b8' },  // slate tint / slate-600 / slate-400
    running:   { bg: 'rgba(59, 130, 246, 0.20)',  border: '#3b82f6', text: '#93c5fd' },  // blue tint / blue-500 / blue-300
    completed: { bg: 'rgba(34, 197, 94, 0.20)',   border: '#22c55e', text: '#86efac' },  // green tint / green-500 / green-300
    failed:    { bg: 'rgba(239, 68, 68, 0.20)',   border: '#ef4444', text: '#fca5a5' },  // red tint / red-500 / red-300
    skipped:   { bg: '#1e293b',                   border: '#334155', text: '#64748b' },  // slate-800 / slate-700 / slate-500
    retry:     { bg: 'rgba(249, 115, 22, 0.20)',  border: '#f97316', text: '#fdba74' },  // orange tint / orange-500 / orange-300
    inactive:  { bg: '#1e293b',                   border: '#334155', text: '#64748b' },  // slate-800 / slate-700 / slate-500
    paused:    { bg: 'rgba(245, 158, 11, 0.20)',  border: '#f59e0b', text: '#fcd34d' },  // amber tint / amber-500 / amber-300
  },
  substep: {
    pending:   { fill: '#3b82f6', stroke: '#60a5fa' },  // blue-500/400 (deeper than light so it reads on dark)
    running:   { fill: '#2563eb', stroke: '#ffffff' },  // blue-600 + white glow
    completed: { fill: '#16a34a', stroke: '#4ade80' },  // green-600 fill (less glare) / green-400 stroke
    skipped:   { fill: '#334155', stroke: '#475569' },  // slate-700/600
    retry:     { fill: '#ea580c', stroke: '#ffffff' },  // orange-600 + white glow
    selected:  { fill: '#3b82f6', stroke: '#60a5fa' },  // blue-500/400
  },
  edge: {
    // Mid-tone edge hues read acceptably on both themes; nudge the darkest
    // (dependency slate) lighter so it doesn't vanish on the dark canvas.
    control:    '#818cf8',  // indigo-400
    retry:      '#fbbf24',  // amber-400
    dataflow:   '#34d399',  // emerald-400
    dependency: '#94a3b8',  // slate-400
    self:       '#a78bfa',  // purple-400
  },
  confidence: {
    high: { fill: '#16a34a', stroke: '#4ade80' },  // green-600/400
    mid:  { fill: '#d97706', stroke: '#fbbf24' },  // amber-600/400
    low:  { fill: '#dc2626', stroke: '#f87171' },  // red-600/400
  },
  chrome: {
    legendBg:        '#0f172a',  // slate-900 (matches dark card)
    legendBorder:    '#334155',  // slate-700
    legendText:      '#cbd5e1',  // slate-300
    legendSubtext:   '#94a3b8',  // slate-400
    legendHint:      '#64748b',  // slate-500
    orchestratorRing:'#818cf8',  // indigo-400
    stepBadge:       '#6366f1',  // indigo-500 (still reads on dark)
    onBadge:         '#ffffff',
    inactiveStroke:  '#475569',  // slate-600
    dataflowAccent:  '#a78bfa',  // purple-400
    amberAccent:     '#fbbf24',  // amber-400
    glowRunning:     'rgba(96, 165, 250, 0.7)',
    glowRetry:       'rgba(251, 146, 60, 0.7)',
    glowCompleted:   'rgba(74, 222, 128, 0.6)',
  },
}

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

/** Pure selector for non-React contexts (SSR-safe: defaults to light). */
export function getWorkflowColors(isDark: boolean): WorkflowPalette {
  return isDark ? DARK : LIGHT
}

/** The canonical light/dark palette objects, for direct/static access. */
export const WORKFLOW_COLORS = { light: LIGHT, dark: DARK } as const

/** True when the current document is in dark mode (`.dark` on <html>). */
function isDarkSnapshot(): boolean {
  return typeof document !== 'undefined'
    && document.documentElement.classList.contains('dark')
}

/**
 * Subscribe to the active theme. lib/theme.ts drives all theme changes —
 * explicit toggle AND OS-preference change — through a single `.dark` class
 * toggle on <html>, so observing that class attribute catches every change.
 */
export function useIsDark(): boolean {
  const [dark, setDark] = useState<boolean>(isDarkSnapshot)
  useEffect(() => {
    const el = document.documentElement
    const update = () => setDark(el.classList.contains('dark'))
    update()  // sync in case the class changed between render and effect
    const observer = new MutationObserver(update)
    observer.observe(el, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  return dark
}

/** The active workflow palette, reactive to theme changes. */
export function useWorkflowColors(): WorkflowPalette {
  return getWorkflowColors(useIsDark())
}
