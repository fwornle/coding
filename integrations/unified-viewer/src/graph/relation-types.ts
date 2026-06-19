// Relation-type canonicalization for the rendered graph + legend.
//
// 2026-06-19: the coding KG carries near-duplicate relation types that are the
// SAME relation written two ways — the LLM observation/insight generators emit
// free-text phrases ("implemented in", "contributes to", "originally developed
// in") alongside the canonical snake_case twins ("implemented_in",
// "contributes_to"). Rendered verbatim, the graph draws two distinct edge
// classes for one relation and the (rendered-derived) Legend RELATIONSHIPS
// section lists both — operator-visible duplication (#7).
//
// The fix folds ONLY space-containing free-text phrases into snake_case so they
// merge with their canonical twins. It deliberately leaves untouched:
//   - established camelCase types: `capturedBy`, `derivedFrom`
//   - snake_case types:           `has_insight`, `related_to`, `parent_child`
//   - single-word types:          `contains`, `mentions`
//   - the intentional hyphenated hierarchy type `parent-child` (the writer
//     compares `=== 'parent-child'`, so it is canonical, not a duplicate)
// A blanket lowercase would mangle those, so the transform is intentionally
// narrow: spaces are the unambiguous signature of an un-normalized LLM phrase.
export function canonicalizeRelationType(type: string | null | undefined): string {
  if (typeof type !== 'string' || type.length === 0) return type ?? ''
  if (type.includes(' ')) {
    return type.trim().toLowerCase().replace(/\s+/g, '_')
  }
  return type
}
