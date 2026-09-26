// The hierarchy facts an entity panel shows: which row is above this one, and
// how deep it sits.
//
// WHY THIS EXISTS
//
// EntityIdentityHeader and EntityDetailPanel both rendered `entity.parent` and
// `entity.level` straight off the wire. Measured against the live store on
// 2026-09-26, `entity.parent` is set on 0 of 2801 entities and `entity.level`
// on 0 of 2801 — so both rows could only ever print `—`, for every row, in
// every session. `metadata.parentId` is set on 845.
//
// That is the same bug HierarchyNavigator had: it read `metadata.parent`, set
// on 0 of 2441 entities, and therefore rendered the project tree as ~1341
// siblings. The fix there was to stop reading a stored field and derive the
// parent from edges (see `hierarchy-parents.ts`). The panels were not migrated
// with it, so the defect survived in the two places an operator actually looks
// when asking "what is this row under?".
//
// WHY IT READS THE STORE'S MAP RATHER THAN DERIVING ITS OWN
//
// `deriveParents()` is already run once per load and its output kept in
// `viewer-store.hierarchyParents` precisely so there is ONE writer and every
// consumer reads the same map. A panel that re-derived would be a second copy
// of a ranking rule that has already drifted once in this codebase, and the
// failure mode is the worst kind: a detail panel confidently naming a parent
// the canvas does not draw an edge to.

import { HIERARCHY_LEVEL } from './hierarchy-parents'

export interface HierarchyIdentity {
  /**
   * Display value for the parent row. A NAME when the parent entity is known,
   * the raw parent id when it is not, and `null` only when the row genuinely
   * has no parent.
   *
   * The id fallback is deliberate: `—` means "nothing is above this row", and
   * "its parent is an id that is not in the store" is a different fact — it is
   * the `danglingRef` category the graph-quality panel counts separately (5
   * rows today). Collapsing the two would hide a broken reference behind a
   * placeholder that reads as "root".
   */
  parentName: string | null
  /**
   * Ontology depth: System 0, Project 1, Component 2, SubComponent 3,
   * Detail/Insight 4. `null` for a class outside the ladder (Observation,
   * Digest, Pattern…), which have no position in it.
   *
   * NOT `entity.level`. That field is the 0-3 LAYER the `visibleLevels` filter
   * works in, a different axis, and no writer sets it.
   */
  level: number | null
}

export interface ResolveHierarchyIdentityArgs {
  entityId: string
  ontologyClass: string | undefined
  /** `viewer-store.hierarchyParents` — child id -> parent id. */
  hierarchyParents: ReadonlyMap<string, string>
  /** Entity id -> display name. Undefined for an id not in the store. */
  nameOf: (id: string) => string | undefined
}

/**
 * Resolve the parent and depth to display for one entity.
 *
 * Pure: takes the map rather than reading the store, so it is callable from a
 * unit test without mounting anything.
 */
export function resolveHierarchyIdentity({
  entityId,
  ontologyClass,
  hierarchyParents,
  nameOf,
}: ResolveHierarchyIdentityArgs): HierarchyIdentity {
  const level = ontologyClass === undefined ? null : HIERARCHY_LEVEL[ontologyClass] ?? null

  const parentId = hierarchyParents.get(entityId)
  const parentName = parentId === undefined ? null : nameOf(parentId) ?? parentId

  return { parentName, level }
}

/**
 * Build the `nameOf` lookup from an entity list.
 *
 * Callers hold the list already (both panels take it from `useGraphData`), so
 * this exists only to keep the id->name shape in one place rather than have
 * each render site spell out its own Map build.
 */
export function nameLookup(
  entities: readonly { id: string; name?: string }[],
): (id: string) => string | undefined {
  const byId = new Map<string, string>()
  for (const e of entities) if (e.name) byId.set(e.id, e.name)
  return (id: string) => byId.get(id)
}
