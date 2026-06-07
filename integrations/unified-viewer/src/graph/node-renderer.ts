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
  switch (state) {
    case 'default':
      return { width: 1, color: 'hsl(var(--border))', opacity: 1.0 }
    case 'hover':
      return { width: 2, color: 'hsl(var(--ring))', opacity: 1.0 }
    case 'selected':
      return {
        width: 3,
        color: 'hsl(var(--primary))',
        opacity: 1.0,
        // UI-SPEC line 147: "4px outer glow 0 0 4px hsl(var(--primary)/0.3)"
        glow: { color: 'hsl(var(--primary)/0.3)', size: 4 },
      }
    case 'search-match':
      // UI-SPEC line 148 — the ONE hardcoded non-token color in the viewer.
      return { width: 2, color: 'hsl(45, 100%, 50%)', opacity: 1.0 }
    case 'filter-dimmed':
      return { width: 1, color: 'hsl(var(--border))', opacity: 0.25 }
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
  // Priority 1: incident on the selected node
  if (selectedNodeId !== null && (edge.from === selectedNodeId || edge.to === selectedNodeId)) {
    return { color: 'hsl(var(--primary)/0.6)', opacity: 1.0 }
  }
  // Priority 2: incident only on dimmed nodes (both endpoints dimmed)
  if (dimmedNodeIds && dimmedNodeIds.has(edge.from) && dimmedNodeIds.has(edge.to)) {
    return { color: 'hsl(var(--border))', opacity: 0.1 }
  }
  // Default
  return { color: 'hsl(var(--border))', opacity: 0.5 }
}
