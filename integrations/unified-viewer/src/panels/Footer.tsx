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
}

export function Footer({ total, visible, edges }: FooterProps) {
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
    </footer>
  )
}
