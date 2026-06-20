// PATTERN SOURCE: 45-UI-SPEC.md § Layout Contract row 5 (h-8 bottom strip)
//   + § Copywriting Contract row "Footer status"
//
// Renders verbatim: `Showing {visible} of {total} nodes · {edges} edges`
// with `tabular-nums` on every numeric span so width is stable as counts change.
//
// The footer takes pre-computed counts as props — the visible-count predicate
// (search + level + class filter) is computed by the caller (ViewerCore)
// where the full entity list + viewer-store snapshot are both in scope.

export interface FooterProps {
  total: number
  visible: number
  edges: number
  /**
   * Phase 61-02 — okb relation-cap honesty: the pre-cap relation count (post
   * CORRELATED_WITH-drop). When it exceeds the rendered `edges` count, the
   * footer surfaces a "showing N of M relations" caption so the operator is
   * never deceived into thinking they see the full 18,958-edge OKM graph.
   * Omitted (or ≤ edges) for coding/VKB, where no cap applies.
   */
  relationTotal?: number
}

export function Footer({ total, visible, edges, relationTotal }: FooterProps) {
  const showRelationCap =
    typeof relationTotal === 'number' && relationTotal > edges
  return (
    <footer
      data-testid="viewer-footer"
      className="h-8 border-t border-border bg-muted/30 flex items-center px-4 text-xs text-muted-foreground"
    >
      <span data-testid="footer-status">
        Showing <span className="tabular-nums">{visible}</span> of{' '}
        <span className="tabular-nums">{total}</span> nodes ·{' '}
        <span className="tabular-nums">{edges}</span> edges
      </span>
      {showRelationCap && (
        <span
          data-testid="footer-relation-cap"
          className="ml-3 text-amber-600 dark:text-amber-400"
          title="OKM has more relations than the viewer renders; CORRELATED_WITH edges are dropped first, then the remainder is capped."
        >
          showing <span className="tabular-nums">{edges}</span> of{' '}
          <span className="tabular-nums">{relationTotal}</span> relations
        </span>
      )}
    </footer>
  )
}
