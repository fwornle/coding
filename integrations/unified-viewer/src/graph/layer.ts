// Phase 60 Plan 01 (G1) — shared deriveLayer helper.
//
// Single source of truth for the Evidence/Pattern layer classification used by
// both LayerFilter.tsx (count badges) and visibility-predicate.ts (filter
// predicate). Closes VKBUI-01 — see 60-CONTEXT.md §G1 D-01..D-03.
//
// Precedence (high → low):
//   D-03  explicit `metadata.layer` literal on the entity wins (writer-side
//         stamping experiments). Top-level `entity.layer` also honored for
//         the same reason.
//   D-02  ontology extends-walk: a class is 'pattern' iff it (or any
//         ancestor up the registry `parent`/extends chain) matches
//         'Insight' or 'Pattern' (case-sensitive). Walk is cycle-safe via a
//         `seen` Set. Phase 57 L2 classes (OnlineInsight, OnlineDigest, …)
//         auto-classify through this rule.
//   default → 'evidence'.
//
// When `registry` is undefined (graceful pre-fetch state) we fall back to
// the direct-class match (Pattern/Insight) only — same behaviour as the
// pre-Phase-60 inline rule in visibility-predicate.ts:81-85. New L2
// classes won't classify as pattern until the registry is supplied, which
// is the intended degraded mode (callers should thread the registry once
// the API response lands).
//
// This module is a PURE function module — zero runtime imports. Keep it
// dependency-free so future graph-layer tooling can import it without
// triggering React / ApiClient bundle weight.

export type Layer = 'evidence' | 'pattern'

/** Subset of `OntologyClass` from ApiClient — kept local so this module
 *  carries zero runtime imports. The full ApiClient shape carries display
 *  metadata we don't need here. */
export interface OntologyRegistryClass {
  name: string
  parent?: string | null
}

interface LayerCandidateEntity {
  ontologyClass?: string
  metadata?: { layer?: string }
  layer?: string
}

const PATTERN_ROOTS = new Set<string>(['Insight', 'Pattern'])

function isLayerLiteral(v: unknown): v is Layer {
  return v === 'evidence' || v === 'pattern'
}

export function deriveLayer(
  entity: LayerCandidateEntity,
  registry: readonly OntologyRegistryClass[] | undefined,
): Layer {
  // D-03 (1): explicit metadata.layer wins.
  const metaLayer = entity.metadata?.layer
  if (isLayerLiteral(metaLayer)) return metaLayer

  // D-03 (2): top-level layer field (writer-side stamping experiments).
  const topLayer = entity.layer
  if (isLayerLiteral(topLayer)) return topLayer

  // D-02 (3): no ontologyClass → can't infer, default evidence.
  const cls = entity.ontologyClass
  if (typeof cls !== 'string' || cls.length === 0) return 'evidence'

  // D-02 (4): registry absent → graceful direct-class fallback.
  if (!registry) {
    return PATTERN_ROOTS.has(cls) ? 'pattern' : 'evidence'
  }

  // D-02 (5): extends-chain walk with cycle-safe seen-set.
  const byName = new Map<string, OntologyRegistryClass>()
  for (const c of registry) byName.set(c.name, c)

  const seen = new Set<string>()
  let current: string | null | undefined = cls
  while (typeof current === 'string' && current.length > 0 && !seen.has(current)) {
    if (PATTERN_ROOTS.has(current)) return 'pattern'
    seen.add(current)
    const node = byName.get(current)
    if (!node) break
    current = node.parent ?? null
  }
  return 'evidence'
}
