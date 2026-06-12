// PATTERN SOURCE: 45-UI-SPEC.md § Color State color overlays table (lines 142-152, verbatim)
// + 45-UI-SPEC.md § Color Edges (line 152, verbatim).
//
// Per-state stroke / opacity / glow decisions live HERE — the SigmaCanvas
// nodeReducer reads these values and translates them onto sigma's
// NodeDisplayData. Keeping the decision table out of the React component
// keeps it testable in isolation (no sigma context required).

import type { Entity, NodeState, Relation } from './types'

export interface StrokeStyle {
  width: number
  color: string
  opacity: number
  glow?: { color: string; size: number }
  // Plan 55-05 (UI-SPEC §14 rule #4): 'solid' default; 'dashed' for
  // orphan-on-current-view OR overlay-specified dashed. SigmaCanvas
  // custom node program reads this to draw the border with a dash
  // pattern.
  borderStyle?: 'solid' | 'dashed'
  // Plan 55-05 (UI-SPEC §12): per-frame pulse halo descriptor. `phase`
  // is the 0..1 position in the 1500ms cycle; SigmaCanvas reads this in
  // its per-frame reducer to draw the SVG ring. Undefined = no halo.
  halo?: { color: string; phase: number }
}

/**
 * Per-state node stroke + opacity. `null` means "do not render" — caller
 * sets sigma's `hidden: true` flag for that node.
 *
 * Table source: UI-SPEC § Color State color overlays (lines 142-152).
 *
 * Plan 55-05 (UI-SPEC §14 + §12): two optional extension params layer
 * on top of the existing per-state base:
 *   - `borderStyle` ('solid'|'dashed') — applied to all renderable states.
 *     Defaults to 'solid' (BC: existing call sites that pass only `state`
 *     get the prior shape PLUS an explicit `borderStyle:'solid'` marker).
 *   - `pulseRuleResult` (boolean) — when true, the returned StrokeStyle
 *     carries a `halo` descriptor. SigmaCanvas's per-frame node program
 *     reads `halo` to render the SVG ring overlay (animated, or static
 *     when `prefers-reduced-motion: reduce` is set).
 *
 * Both extension params are silently ignored for `filter-hidden` (the
 * function still returns `null` — no visual rendering at all).
 */
export function nodeStrokeForState(
  state: NodeState,
  borderStyle?: 'solid' | 'dashed',
  pulseRuleResult?: boolean,
): StrokeStyle | null {
  // Plan 04 checkpoint (round 2): the prior CSS-var stroke colors
  // (`hsl(var(--*))`) were unparseable by sigma's WebGL renderer and
  // silently fell back to white. The white halo around selected nodes
  // then collided with the (also light) dark-mode label color,
  // making selected-node labels unreadable. All stroke colors are now
  // explicit hex matching the rest of the Plan 03 round-2 palette:
  //   default:      slate-300  (#cbd5e1) — subtle border on both themes
  //   hover:        blue-400   (#60a5fa)
  //   selected:     blue-500   (#3b82f6) + glow #3b82f64d (0.3 alpha)
  //   search-match: amber-500  (#f59e0b)  was hsl(45,100%,50%) — same-ish hue, hex form
  //   filter-dimmed/-hidden: unchanged in shape (opacity / null)
  let base: StrokeStyle | null
  switch (state) {
    case 'default':
      base = { width: 1, color: '#cbd5e1', opacity: 1.0 }
      break
    case 'hover':
      base = { width: 2, color: '#60a5fa', opacity: 1.0 }
      break
    case 'selected':
      base = {
        width: 3,
        color: '#3b82f6',
        opacity: 1.0,
        glow: { color: '#3b82f64d', size: 4 },
      }
      break
    case 'search-match':
      base = { width: 2, color: '#f59e0b', opacity: 1.0 }
      break
    case 'filter-dimmed':
      base = { width: 1, color: '#cbd5e1', opacity: 0.25 }
      break
    case 'filter-hidden':
      return null
  }
  // Plan 55-05 overlays — applied ONLY when the caller passes the
  // extension parameters, so existing Phase 45 call sites that invoke
  // `nodeStrokeForState(state)` continue to see the prior literal shape
  // (BC). The graph-builder + reducers (Task 3) thread the per-node
  // `borderStyle` + `pulseRuleResult` through from node attributes; both
  // are present when the renderer needs to honor them.
  //
  // halo.color tracks the per-state base color; the SigmaCanvas program
  // applies the 50%-alpha tween at render time (UI-SPEC §12).
  const out: StrokeStyle = { ...base }
  if (borderStyle !== undefined) {
    out.borderStyle = borderStyle
  }
  if (pulseRuleResult === true) {
    out.halo = { color: base.color, phase: (Date.now() % 1500) / 1500 }
  }
  return out
}

// -----------------------------------------------------------------------
// Plan 55-05 (UI-SPEC §12): pulse rule evaluator.
//
// Pure over (rule string, entity). Tested via node-renderer.test.ts.
// Supported v1 rules:
//   - null                       → no pulse
//   - 'lastUpdatedWithin:60s'    → updatedAt within 60s of now
//   - 'lastUpdatedWithin:5m'     → updatedAt within 5m of now
//   - 'recentlyMerged:1h'        → any occurrence timestamp within 1h
//   - any unknown rule           → false (T-55-05-02 mitigation)
// -----------------------------------------------------------------------

/**
 * Parse a window token like `'60s'` / `'5m'` / `'1h'` into milliseconds.
 * Unknown units (or unparseable numbers) return `Number.POSITIVE_INFINITY`
 * so the caller's `now - then < window` comparator yields true for any
 * finite age — BUT we ALSO sentinel-reject by combining with a finite
 * threshold check in the caller so unknown rules silently evaluate to
 * `false` per UI-SPEC §12.
 *
 * Strategy: return `NaN` for unparseable input. The caller compares
 * `age < ms`; `age < NaN` is always `false`, which is the safe answer.
 */
function parseWindow(token: string | undefined): number {
  if (!token) return Number.NaN
  const m = /^(\d+)([smh])$/.exec(token)
  if (!m) return Number.NaN
  const n = Number.parseInt(m[1], 10)
  switch (m[2]) {
    case 's':
      return n * 1_000
    case 'm':
      return n * 60_000
    case 'h':
      return n * 3_600_000
    default:
      return Number.NaN
  }
}

/**
 * Evaluate a pulseRule expression against an entity. Returns true when
 * the rule matches; returns false for null, unknown rules, missing
 * required fields, or unparseable window tokens.
 *
 * The renderer (SigmaCanvas) calls this PER FRAME — keep it pure +
 * allocation-free. The wider 60fps cap comes from Sigma's reducer hook
 * (T-55-05-01 mitigation).
 */
export function evaluatePulseRule(
  rule: string | null,
  entity: Entity,
): boolean {
  if (rule === null || rule === undefined) return false

  if (rule.startsWith('lastUpdatedWithin:')) {
    const ms = parseWindow(rule.slice('lastUpdatedWithin:'.length))
    if (!Number.isFinite(ms)) return false
    const updatedAt = (entity as { updatedAt?: string }).updatedAt
    if (typeof updatedAt !== 'string' || updatedAt.length === 0) return false
    const then = new Date(updatedAt).getTime()
    if (!Number.isFinite(then)) return false
    return Date.now() - then < ms
  }

  if (rule.startsWith('recentlyMerged:')) {
    const ms = parseWindow(rule.slice('recentlyMerged:'.length))
    if (!Number.isFinite(ms)) return false
    const meta = entity.metadata as
      | { occurrences?: ReadonlyArray<{ timestamp?: string }> }
      | undefined
    const occ = meta?.occurrences ?? []
    if (occ.length === 0) return false
    const now = Date.now()
    for (const o of occ) {
      if (typeof o?.timestamp !== 'string') continue
      const t = new Date(o.timestamp).getTime()
      if (!Number.isFinite(t)) continue
      if (now - t < ms) return true
    }
    return false
  }

  // Unknown rule — silently false per T-55-05-02. Do NOT throw; the
  // renderer must not crash on overlay drift.
  return false
}

export interface EdgeStyle {
  color: string
  opacity: number
}

/**
 * Edge state derivation. UI-SPEC § Color Edges (line 152):
 *   - default:                    hsl(var(--border)), opacity 0.5
 *   - incident on selected node:  hsl(var(--primary)/0.6), opacity 1.0
 *   - incident only on dimmed:    hsl(var(--border)), opacity 0.1
 *
 * `dimmedNodeIds` is the set of nodes the level/class filter would
 * dim. When BOTH endpoints of the edge are in that set, the edge is
 * "incident only on dimmed".
 */
export function edgeStateForRelation(
  edge: Pick<Relation, 'from' | 'to'>,
  selectedNodeId: string | null,
  dimmedNodeIds?: ReadonlySet<string>,
  theme: 'light' | 'dark' = 'light',
): EdgeStyle {
  // 2026-06-11: theme-aware edge color. The previous fixed `#cbd5e1`
  // (slate-300) was tuned for light backgrounds — on the dark theme it
  // rendered as a bright haze that dominated the canvas. In dark mode
  // we want edges to recede; slate-700/600 at low opacity gives the
  // VKB-style faint hairline look against the slate-900 background.
  //   light default:  #cbd5e1 (slate-300) at opacity 0.35
  //   dark default:   #334155 (slate-700) at opacity 0.5
  //   incident:       #3b82f6 (blue-500) at opacity 1.0 — same both themes
  //   dimmed:         theme-aware base at opacity 0.08 (nearly invisible)
  const baseColor = theme === 'dark' ? '#334155' : '#cbd5e1'
  if (selectedNodeId !== null && (edge.from === selectedNodeId || edge.to === selectedNodeId)) {
    return { color: '#3b82f6', opacity: 1.0 }
  }
  if (dimmedNodeIds && dimmedNodeIds.has(edge.from) && dimmedNodeIds.has(edge.to)) {
    return { color: baseColor, opacity: 0.08 }
  }
  return { color: baseColor, opacity: theme === 'dark' ? 0.5 : 0.35 }
}
