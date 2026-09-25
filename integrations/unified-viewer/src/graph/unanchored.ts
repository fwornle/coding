// How many rendered rows hang under no Project/System.
//
// This is the half of the aggregated-node budget that fails silently. The gate
// in scripts/assert-aggregated-node-budget.ts is
// `worst.nodes > BUDGET || unrooted > 0`, and its header records a run that
// reported "PASS, Coding at 11" while 43 rows rendered under no project at all.
// A count that only a CI script computes is a count nobody looks at, so the
// rail shows it next to the detail level.
//
// WHY IT CANNOT BE FIXED BY FILTERING. `buildRehomeEdges` already re-attaches a
// stray component to its nearest VISIBLE ancestor, walking the anchor ladder
// through hidden endpoints — so changing detail level does not strand a row
// that has a structural home. What lands here is the other population: rows
// with no structural ancestor anywhere (456 of 1,707 live rows carry zero
// inbound structural edge). No arrangement of filters can anchor those; they
// need placing in the data. Surfacing the number is how that work gets asked
// for instead of being absorbed as "the graph looks messy".

/** Classes that count as a root. Mirrors the budget script's walk. */
const ROOT_CLASSES = new Set(['Project', 'System'])

/**
 * Count visible ids with no Project/System ancestor.
 *
 * @param visibleIds ids currently rendered
 * @param parents    child -> parent, from `deriveParents`
 * @param classOf    ontologyClass lookup for an id
 *
 * Cycle-safe: `deriveParents` breaks cycles already, but this runs per render
 * and a cycle here would hang the tab rather than misreport a number.
 */
export function countUnanchored(
  visibleIds: Iterable<string>,
  parents: ReadonlyMap<string, string>,
  classOf: (id: string) => string | undefined,
): number {
  let unanchored = 0
  for (const id of visibleIds) {
    if (ROOT_CLASSES.has(classOf(id) ?? '')) continue
    const seen = new Set<string>()
    let rooted = false
    for (let cur: string | undefined = parents.get(id); cur && !seen.has(cur); cur = parents.get(cur)) {
      seen.add(cur)
      if (ROOT_CLASSES.has(classOf(cur) ?? '')) {
        rooted = true
        break
      }
    }
    if (!rooted) unanchored += 1
  }
  return unanchored
}
