// How far an intent reaches into the code — the two derivations that turn
// "why is it like this" into "and here is where it lives".
//
// WHY THIS IS NOT IN intent-spine.ts
//
// `intent-spine.ts` builds the tree: Intent ─aggregates→ Insight, one edge type,
// nothing else. This module answers two questions ABOUT that tree using data
// from outside it — the canvas's parent map, and each Insight's own verification
// record. Keeping them apart means the spine stays revertible by dropping one
// edge type, which is the property that made it safe to write.
//
// THE TWO LEVELS, AND WHY NEITHER IS A CLASSIFICATION
//
// 1. groupByComponent — which part of the code a goal's lessons were learned in.
//    Derived by walking the SAME `hierarchyParents` map the canvas lays out by.
//    Stage 2 already placed every Insight, so this costs nothing new.
//
// 2. filesTouched — the files themselves, from `codeVerification.referencedFiles`,
//    written by the claim verifier and never read by the viewer until now.
//
// WHY NOT metadata.codeEvidence, WHICH ALREADY EXISTS
//
// Because it disagrees with the tree it would be rendered in. The stored field
// was written by the intent-spine derivation, whose `componentOf` walks
// `metadata.parentId` then the containment parent with NO ranking; the viewer's
// `deriveParents` ranks by level-distance, then edge type, then depth. On the
// largest intent they differ on four of seven components (SemanticAnalysis 26 vs
// 25, DockerizedServices 21 vs 23, CodingPatterns 4 vs 8), and the stored version
// silently omits the 19 insights that reach no Component at all. Two derivations
// of one join, one of them invisible — so this derives it once, from the map the
// canvas actually draws, and the rail cannot contradict the tree beneath it.

/** Structurally minimal insight — the fields this module reads, and no others. */
export interface ReachInsight {
  id: string
  name: string
  metadata?: Record<string, unknown>
}

/** One Component an intent's lessons were learned in. */
export interface ComponentGroup {
  /** Component entity id, or {@link NOT_PLACED_ID} for the residue bucket. */
  id: string
  name: string
  insights: ReachInsight[]
}

/** One file, and the lessons that named it. */
export interface TouchedFile {
  path: string
  /** Lessons naming this file — `lessonIds.length`, kept explicit for display. */
  count: number
  lessonIds: string[]
}

/**
 * The bucket for lessons that reach no Component.
 *
 * They are not dropped. 19 of the largest intent's 96 lessons hang off their
 * Project by `has_insight` alone and have never been placed in the code tree;
 * the stored `codeEvidence` omits them, so its component counts sum to 77 and
 * the row says 96 with no account of the difference. A visible bucket is the
 * same choice the code tree already makes with `Unparented` — the gap is data
 * to be closed, not something to round away.
 */
export const NOT_PLACED_ID = '__intent_not_placed__'
export const NOT_PLACED_NAME = 'Not placed in code'

/** Synthetic focus-root prefix for a file. See the note in {@link fileFocusId}. */
const FILE_FOCUS_PREFIX = 'file:'

/**
 * The focus-root id for a file.
 *
 * Files are not entities, so a file focus has no row id to name itself with. It
 * borrows the hierarchy focus triple rather than introducing a second one — the
 * canvas can only be focused on one thing, and two focus fields would have to
 * define what their intersection means. The prefix keeps it distinguishable from
 * a real entity id, which is a UUID and can never collide.
 */
export function fileFocusId(path: string): string {
  return `${FILE_FOCUS_PREFIX}${path}`
}

/** Whether a focus root names a file rather than a hierarchy row. */
export function isFileFocusId(id: string): boolean {
  return id.startsWith(FILE_FOCUS_PREFIX)
}

/**
 * Extensions that make a reference a file.
 *
 * `referencedFiles` is the verifier's PATH-typed claims, and a claim is
 * whatever the insight's prose looked like — so the array carries config keys
 * (`mcp.tools`, `mcp.url`), field references (`row.id`, `legacyId.id`), git refs
 * (`origin/main`) and outright noise (`0/0`) alongside real paths. An extension
 * allow-list is the only test that separates them without guessing: 67 of the
 * top intent's 236 entries fail it, and every one of those 67 is a directory or
 * a non-file.
 */
const CODE_EXTENSION =
  /\.(js|mjs|cjs|ts|tsx|jsx|py|sh|bash|zsh|rb|go|rs|java|json|ya?ml|toml|md|css|scss|html|sql|db|conf|ini|plist|env|lock|txt)$/i

function basename(p: string): string {
  const cut = p.lastIndexOf('/')
  return cut === -1 ? p : p.slice(cut + 1)
}

function looksLikeFile(raw: string): boolean {
  // A trailing slash is a directory, stated as one. `.codegraph/`, `.data/` and
  // `docs/benchmarks/coding-v1/` are all real — they are just not files, and a
  // list that mixes them cannot be ranked by "how many lessons named this file".
  if (raw.endsWith('/')) return false
  return CODE_EXTENSION.test(basename(raw))
}

function readReferencedFiles(insight: ReachInsight): string[] {
  const cv = insight.metadata?.codeVerification
  if (!cv || typeof cv !== 'object') return []
  const raw = (cv as { referencedFiles?: unknown }).referencedFiles
  if (!Array.isArray(raw)) return []
  // Deduped per insight: one lesson naming a file twice is one lesson, and the
  // ranking is over lessons rather than mentions.
  const out = new Set<string>()
  for (const f of raw) if (typeof f === 'string' && f) out.add(f)
  return [...out]
}

/** The `verifiedAt` the claims were checked at, when every reading agrees. */
export function verifiedAt(insights: readonly ReachInsight[]): string | null {
  const seen = new Set<string>()
  for (const i of insights) {
    const cv = i.metadata?.codeVerification
    if (!cv || typeof cv !== 'object') continue
    const at = (cv as { verifiedAt?: unknown }).verifiedAt
    if (typeof at === 'string' && at) seen.add(at.slice(0, 10))
  }
  // Several dates means the corpus was verified in more than one pass and no
  // single date is true of it. Say nothing rather than pick one.
  return seen.size === 1 ? [...seen][0] : null
}

/**
 * Group an intent's lessons by the Component they were learned in.
 *
 * @param insights  the intent's aggregated Insights
 * @param parents   child id → parent id, the store's `hierarchyParents` — the
 *                  SAME map the canvas lays out by, so a group can never name a
 *                  Component the graph drew the lesson somewhere else from
 * @param classOf   entity id → ontologyClass, the store's `hierarchyClasses`,
 *                  built from the same entities as `parents`
 * @param nameOf    entity id → display name
 *
 * Ordered heaviest first, with the not-placed bucket always last — it is a gap
 * report, not a peer of the real components.
 */
export function groupByComponent(
  insights: readonly ReachInsight[],
  parents: ReadonlyMap<string, string>,
  classOf: ReadonlyMap<string, string>,
  nameOf: ReadonlyMap<string, string>,
): ComponentGroup[] {
  const groups = new Map<string, ComponentGroup>()

  for (const insight of insights) {
    // Walk to the Component ancestor. Cycle-guarded for the same reason
    // deriveParents is: this runs on a render, and a both-ways edge would
    // freeze the tab rather than misdraw it.
    let cursor = parents.get(insight.id)
    const seen = new Set<string>([insight.id])
    let componentId: string | null = null
    while (cursor !== undefined && !seen.has(cursor)) {
      seen.add(cursor)
      if (classOf.get(cursor) === 'Component') {
        componentId = cursor
        break
      }
      cursor = parents.get(cursor)
    }

    const id = componentId ?? NOT_PLACED_ID
    let group = groups.get(id)
    if (!group) {
      group = {
        id,
        name: componentId ? nameOf.get(componentId) ?? componentId : NOT_PLACED_NAME,
        insights: [],
      }
      groups.set(id, group)
    }
    group.insights.push(insight)
  }

  const out = [...groups.values()]
  for (const g of out) g.insights.sort((a, b) => a.name.localeCompare(b.name))
  out.sort((a, b) => {
    if (a.id === NOT_PLACED_ID) return 1
    if (b.id === NOT_PLACED_ID) return -1
    return b.insights.length - a.insights.length || a.name.localeCompare(b.name)
  })
  return out
}

/**
 * The files a set of lessons touches, ranked by how many of them name each.
 *
 * Bare basenames are folded into a full path when — and only when — exactly one
 * path in this same set shares the basename. `registry.mjs` (5 lessons) and
 * `lib/code-graph/registry.mjs` (16) are one file counted twice, and leaving
 * them split understates the top of the ranking. Two candidate paths means the
 * basename is genuinely ambiguous and folding it would invent a fact: corpus
 * wide, 205 basenames fold safely, 17 are ambiguous and stay split, and 415 have
 * no path sibling at all and stand as the only form the data has.
 */
export function filesTouched(insights: readonly ReachInsight[]): TouchedFile[] {
  const lessonsByRef = new Map<string, Set<string>>()
  for (const insight of insights) {
    for (const raw of readReferencedFiles(insight)) {
      if (!looksLikeFile(raw)) continue
      let set = lessonsByRef.get(raw)
      if (!set) lessonsByRef.set(raw, (set = new Set()))
      set.add(insight.id)
    }
  }

  // basename → the full paths in THIS set that end with it.
  const pathsByBase = new Map<string, string[]>()
  for (const ref of lessonsByRef.keys()) {
    if (!ref.includes('/')) continue
    const base = basename(ref)
    const list = pathsByBase.get(base)
    if (list) list.push(ref)
    else pathsByBase.set(base, [ref])
  }

  const merged = new Map<string, Set<string>>()
  for (const [ref, lessons] of lessonsByRef) {
    const candidates = ref.includes('/') ? undefined : pathsByBase.get(ref)
    const key = candidates?.length === 1 ? candidates[0] : ref
    let set = merged.get(key)
    if (!set) merged.set(key, (set = new Set()))
    for (const id of lessons) set.add(id)
  }

  const out: TouchedFile[] = []
  for (const [path, lessons] of merged) {
    out.push({ path, count: lessons.size, lessonIds: [...lessons] })
  }
  // Heaviest first; path breaks ties so the order is stable across loads.
  out.sort((a, b) => b.count - a.count || a.path.localeCompare(b.path))
  return out
}
