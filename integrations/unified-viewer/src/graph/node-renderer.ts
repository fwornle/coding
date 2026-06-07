// PATTERN SOURCE: 45-UI-SPEC.md § Color State color overlays table (lines 142-152, verbatim)
// + 45-UI-SPEC.md § Color Edges (line 152, verbatim).
//
// Per-state stroke / opacity / glow decisions live HERE — the SigmaCanvas
// nodeReducer reads these values and translates them onto sigma's
// NodeDisplayData. Keeping the decision table out of the React component
// keeps it testable in isolation (no sigma context required).

import type { NodeState, Relation } from './types'

export interface StrokeStyle {
  width: number
  color: string
  opacity: number
  glow?: { color: string; size: number }
}

/**
 * Per-state node stroke + opacity. `null` means "do not render" — caller
 * sets sigma's `hidden: true` flag for that node.
 *
 * Table source: UI-SPEC § Color State color overlays (lines 142-152).
 */
export function nodeStrokeForState(state: NodeState): StrokeStyle | null {
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
  switch (state) {
    case 'default':
      return { width: 1, color: '#cbd5e1', opacity: 1.0 }
    case 'hover':
      return { width: 2, color: '#60a5fa', opacity: 1.0 }
    case 'selected':
      return {
        width: 3,
        color: '#3b82f6',
        opacity: 1.0,
        glow: { color: '#3b82f64d', size: 4 },
      }
    case 'search-match':
      return { width: 2, color: '#f59e0b', opacity: 1.0 }
    case 'filter-dimmed':
      return { width: 1, color: '#cbd5e1', opacity: 0.25 }
    case 'filter-hidden':
      return null
  }
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
): EdgeStyle {
  // Plan 03 round 2 (cont'd from black-nodes fix): sigma's WebGL color
  // parser silently rejects `hsl(var(--*))` CSS-var strings and falls
  // back to invisible. Use fixed hex values so edges actually render —
  // theme-aware variants land when SigmaCanvas wires a theme-conditional
  // settings hook. Colors picked from the Plan 03 round 2 slate scale:
  //   default:  #cbd5e1 (slate-300) at opacity 0.6
  //   incident: #3b82f6 (blue-500)  at opacity 1.0 — matches selected stroke
  //   dimmed:   #cbd5e1 at opacity 0.15 (mostly invisible)
  if (selectedNodeId !== null && (edge.from === selectedNodeId || edge.to === selectedNodeId)) {
    return { color: '#3b82f6', opacity: 1.0 }
  }
  if (dimmedNodeIds && dimmedNodeIds.has(edge.from) && dimmedNodeIds.has(edge.to)) {
    return { color: '#cbd5e1', opacity: 0.15 }
  }
  return { color: '#cbd5e1', opacity: 0.6 }
}
