// Aggregated-view node budget — verdict row 10 of the KB audit.
//
// The target is "<= 40 nodes in a project's aggregated view". It has been
// failing at roughly 210, and the only thing that ever established that was
// somebody looking at a screenshot. This turns it into a number a health
// check can read, so a density regression fails something instead of waiting
// to be noticed.
//
// WHY IT LIVES IN THE VIEWER PACKAGE. The count has to be what the canvas
// actually draws, and that answer is `isEntityVisible` plus `deriveParents`,
// both of which live here. Recomputing it in obs-api would be a second copy
// of an eleven-field rule that has already drifted once in this codebase
// (the footer diverged from the canvas in five ways, and useGraphVisibility
// in a sixth — see the note at the top of useGraphVisibility.ts). This script
// imports the real predicate and feeds it the store's seeded defaults, so it
// can only disagree with the canvas if the canvas itself changed.
//
// Run:  npx vite-node scripts/assert-aggregated-node-budget.ts
//       OBS_API=http://127.0.0.1:12436 npx vite-node scripts/... --json
// Exits 1 when over budget, so CI and the health check can gate on it.

import { isEntityVisible, type VisibilityFilters } from '@/graph/visibility-predicate'
import { deriveParents } from '@/graph/hierarchy-parents'
import { PROVENANCE_RELATION_TYPES } from '@/graph/relation-types'

const OBS_API = process.env.OBS_API ?? 'http://127.0.0.1:12436'
const BUDGET = Number(process.env.AGGREGATED_NODE_BUDGET ?? 40)
const AS_JSON = process.argv.includes('--json')

interface ApiEntity {
  id: string
  name?: string
  entityType?: string
  ontologyClass?: string
  layer?: string
  metadata?: Record<string, unknown>
}
interface ApiRelation {
  source: string
  target: string
  attributes?: { type?: string }
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${OBS_API}${path}`)
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`)
  return (await res.json()) as T
}

const unwrap = <T,>(r: Record<string, unknown>, ...keys: string[]): T[] => {
  for (const k of keys) if (Array.isArray(r[k])) return r[k] as T[]
  return (Array.isArray(r) ? r : []) as T[]
}

const entRes = await getJson<Record<string, unknown>>('/api/v1/entities?limit=60000')
const relRes = await getJson<Record<string, unknown>>('/api/v1/relations?limit=60000')
const entities = unwrap<ApiEntity>(entRes, 'entities', 'data')
const relations = unwrap<ApiRelation>(relRes, 'relations', 'data')

// The predicate reads `ontologyClass`; the wire carries `entityType` too and
// the two disagree on some rows (the audit's "two vocabularies below that
// still disagree"). The canvas sees whatever /api/v1 hands it, so this does
// the same rather than reconciling them here.
const forPredicate = entities.map((e) => ({
  ...e,
  ontologyClass: e.ontologyClass ?? e.entityType ?? '',
})) as unknown as Parameters<typeof isEntityVisible>[0][]

const parents = deriveParents(
  forPredicate as unknown as {
    id: string; name: string; ontologyClass: string
    metadata?: { parentId?: string }
  }[],
  relations.map((r) => ({ from: r.source, to: r.target, type: r.attributes?.type })),
)
// The transitive collapse walks ancestors and needs their class; the app builds
// this in UnifiedViewer from the same entity list.
const hierarchyClasses = new Map<string, string>()
for (const e of forPredicate) {
  const a = e as unknown as ApiEntity
  if (a.ontologyClass) hierarchyClasses.set(a.id, a.ontologyClass)
}

// The store's seeded defaults, verbatim (viewer-store.ts ~519-973). A default
// that changes there and not here would make this assert against a view no
// operator ever sees.
const DEFAULT_FILTERS: VisibilityFilters = {
  searchQueryLowered: '',
  selectedTeams: new Set<string>(),
  learningSource: 'combined',
  selectedLayers: [],
  hideDocNodes: false,
  hideArchived: true,
  // NOT the store's seeded value. `selectedClasses` starts as an empty Set,
  // and this predicate reads an empty Set as "nothing visible" — the opposite
  // of the empty-means-all sentinel every other filter here uses. The app
  // resolves that by auto-populating it with every class in the data on first
  // load (UnifiedViewer.tsx:248-253), so "all classes present" IS the default
  // view. Copying the seeded empty Set instead made this script report 0
  // rendered nodes and PASS a budget of 40 — a green check for a canvas
  // nobody could see.
  selectedClasses: new Set<string>(
    forPredicate
      .map((e) => (e as unknown as ApiEntity).ontologyClass)
      .filter((c): c is string => typeof c === 'string' && c.length > 0),
  ),
  visibleLevels: new Set<0 | 1 | 2 | 3>([0, 1, 2, 3]),
  lslFilterEntityIds: null,
  hiddenNodeTypes: new Set<string>(),
  aggregatesOnly: false,
  collapseSubComponents: true,
  expandedComponentIds: new Set<string>(),
  hierarchyParents: parents,
  hierarchyClassOf: (id: string) => hierarchyClasses.get(id),
  showDebugEntityTypes: false,
}

const visible = forPredicate.filter((e) => isEntityVisible(e, DEFAULT_FILTERS))
const visibleIds = new Set(visible.map((e) => (e as unknown as ApiEntity).id))
// PROVENANCE_RELATION_TYPES is an iterable of names, not a Set — wrap it
// rather than assuming `.has`.
const hiddenRelationTypes = new Set<string>(PROVENANCE_RELATION_TYPES)
const visibleRelations = relations.filter(
  (r) =>
    visibleIds.has(r.source) &&
    visibleIds.has(r.target) &&
    !hiddenRelationTypes.has(r.attributes?.type ?? ''),
)

// PER PROJECT, not store-wide. The verdict is "<= 40 nodes in A PROJECT's
// aggregated view" and this store holds 21 Project nodes, so a store-wide
// total answers a question nobody asked — and would drift with the number of
// projects rather than with density. Each visible node is walked up the same
// `parents` map the canvas collapses by, and attributed to the Project (or
// System) it lands under; the budget is checked against the WORST project,
// because one blown project is a failure even when the average is fine.
const classOf = new Map<string, string>()
for (const e of forPredicate) {
  const a = e as unknown as ApiEntity
  classOf.set(a.id, a.ontologyClass ?? '')
}
const nameOf = new Map<string, string>()
for (const e of forPredicate) {
  const a = e as unknown as ApiEntity
  nameOf.set(a.id, a.name ?? a.id)
}

// Returns the Project/System this node hangs under, or null when the walk
// runs out of parents first. Null is NOT folded into a pseudo-project: doing
// that reported "1/202 projects over budget", where 201 of those "projects"
// were single unparented rows. They are counted separately below, because an
// unrooted node is its own finding — it is on the canvas under no project at
// all, which is the free-floating-dots problem the audit describes.
const rootOf = (id: string): string | null => {
  const seen = new Set<string>()
  let cur = id
  while (true) {
    const cls = classOf.get(cur)
    if (cls === 'Project' || cls === 'System') return cur
    const next = parents.get(cur)
    if (!next || seen.has(next)) return null
    seen.add(next)
    cur = next
  }
}

const perProject = new Map<string, number>()
let unrooted = 0
for (const e of visible) {
  const id = (e as unknown as ApiEntity).id
  const root = rootOf(id)
  if (root === null) {
    unrooted += 1
    continue
  }
  perProject.set(root, (perProject.get(root) ?? 0) + 1)
}
const projectRows = [...perProject]
  .map(([id, n]) => ({ id, name: nameOf.get(id) ?? id, nodes: n }))
  .sort((a, b) => b.nodes - a.nodes)
const worst = projectRows[0] ?? { id: '-', name: '(empty)', nodes: 0 }

const byClass = new Map<string, number>()
for (const e of visible) {
  const c = (e as unknown as ApiEntity).ontologyClass ?? '(none)'
  byClass.set(c, (byClass.get(c) ?? 0) + 1)
}

// Unrooted rows count against the budget too — they are ON the canvas, and a
// check that ignores them can be satisfied by making rows unattributable
// rather than by making the view smaller. That is not hypothetical: the first
// run of the level-keyed collapse reported "PASS, Coding at 11" while 43 rows
// rendered under no project at all, because an Insight whose placement
// heuristic found no parent got no parent in the tree either and dropped out
// of every project's total. The budget is per project; a row belonging to no
// project is a failure of the hierarchy, not an exemption from it.
const overBudget = worst.nodes > BUDGET || unrooted > 0
const report = {
  worstProject: worst.name,
  worstProjectNodeCount: worst.nodes,
  budget: BUDGET,
  overBudget,
  overBy: Math.max(0, worst.nodes - BUDGET),
  projectsOverBudget: projectRows.filter((r) => r.nodes > BUDGET).length,
  projectCount: projectRows.length,
  unrootedNodeCount: unrooted,
  renderedNodeCount: visible.length,
  renderedEdgeCount: visibleRelations.length,
  storeNodeCount: entities.length,
  perProject: projectRows.slice(0, 12),
  byClass: Object.fromEntries([...byClass].sort((a, b) => b[1] - a[1])),
}

if (AS_JSON) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
} else {
  const w = (m: string) => process.stdout.write(`${m}\n`)
  w('\n=== aggregated-view node budget ===')
  w(`obs-api  : ${OBS_API}`)
  w(`in store : ${report.storeNodeCount} entities`)
  w(`rendered : ${report.renderedNodeCount} nodes, ${report.renderedEdgeCount} edges (all projects)`)
  w(`budget   : ${BUDGET} per project`)
  w('')
  w('  nodes  project')
  for (const r of report.perProject) {
    w(`  ${String(r.nodes).padStart(5)}  ${r.name}${r.nodes > BUDGET ? '   <- over' : ''}`)
  }
  w(`  ${String(unrooted).padStart(5)}  (no project root)`)
  w('')
  w('  by class (all projects)')
  for (const [cls, n] of Object.entries(report.byClass)) w(`  ${String(n).padStart(5)}  ${cls}`)
  w('')
  w(
    overBudget
      ? [
          worst.nodes > BUDGET
            ? `FAIL — worst project "${worst.name}" is ${report.overBy} over a budget of ${BUDGET} (${report.projectsOverBudget}/${report.projectCount} projects over)`
            : `FAIL — every project is within ${BUDGET} (worst "${worst.name}" at ${worst.nodes})`,
          unrooted > 0 ? `     — but ${unrooted} rendered rows belong to no project` : '',
        ].filter(Boolean).join('\n')
      : `PASS — worst project "${worst.name}" at ${worst.nodes} of ${BUDGET}, 0 rows unrooted`,
  )
}

process.exit(overBudget ? 1 : 0)
