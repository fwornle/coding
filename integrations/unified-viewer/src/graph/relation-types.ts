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

// ---------------------------------------------------------------------------
// Provenance edges — hidden by default (2026-09-08)
// ---------------------------------------------------------------------------
//
// Two edge types are 88% of the coding graph: `capturedBy` (13,090 edges, 51%)
// and `mentions` (9,284, 36%). They record WHERE a fact came from — which
// observation captured an insight, which entity a digest names — so every node
// carries a bundle of them, and drawn all at once they are a grey wall with the
// structure somewhere underneath. Measured on the live graph: rendering all of
// them puts 24,997 paths on the canvas; without them, 3,189.
//
// The remaining ~2,900 edges ARE the knowledge structure — `contains`,
// `has_insight`, `parent-child`, `includes`, `derivedFrom`, `related_to` — and
// that is what a knowledge-graph viewer is for. So the default is structure,
// and provenance is one click away in the Legend's RELATIONSHIPS section
// (its "all" link clears the hidden set, including these).
//
// This is a DEFAULT, not a filter: the edges are loaded, counted in the stats
// bar, and listed in the Legend as hidden rows. Nothing is silently dropped —
// ApiClient.listRelations's OKB cap is the one place edges actually go away,
// and that one reports its own pre-cap total for exactly this reason.
export const PROVENANCE_RELATION_TYPES: readonly string[] = ['capturedBy', 'mentions']
