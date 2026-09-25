// Graph density check — verdict row 10 of the KB audit.
//
// NOT A BUDGET IN THE COST SENSE. This repo has real budgets — tokens and
// money, under Token Usage -> Cost — and this file used to be called
// `assert-aggregated-node-budget.ts`, which put it in the same vocabulary as
// them while measuring something entirely different. The unit here is NODES ON
// SCREEN: how many rows one project's aggregated view draws. Nothing about it
// touches tokens, money or time. Renamed 2026-09-25 for exactly that reason;
// the env knobs went with it (`GRAPH_MAX_NODES_PER_PROJECT`,
// `GRAPH_DETAIL_LEVEL`).
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
// Run:  npx vite-node scripts/assert-graph-density.ts
//       OBS_API=http://127.0.0.1:12436 npx vite-node scripts/... --json
// Exits 1 when over budget, so CI and the health check can gate on it.

import { isEntityVisible, type VisibilityFilters } from '@/graph/visibility-predicate'
import { DETAIL_LEVEL_FLAGS } from '@/store/viewer-store'
import { deriveParents } from '@/graph/hierarchy-parents'
import { PROVENANCE_RELATION_TYPES } from '@/graph/relation-types'
import { rootOf, categoriseUnattributed, CATEGORY_LABEL } from '@/graph/attribution'

const OBS_API = process.env.OBS_API ?? 'http://127.0.0.1:12436'
const BUDGET = Number(process.env.GRAPH_MAX_NODES_PER_PROJECT ?? 40)
// Which detail level to measure. The rail offers three and they have different
// targets (overview <=40, summary <=10), so the gate has to be able to ask
// about each rather than only the default.
const LEVEL = (process.env.GRAPH_DETAIL_LEVEL ?? 'overview') as keyof typeof DETAIL_LEVEL_FLAGS
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
  // Seeded from the app's own preset table rather than by hand, so this script
  // cannot drift from the default view it claims to measure. It did drift once
  // already: when `hideArchived` was split into `hideRolledUp` + `showStale`
  // (2026-09-25) this line still set the old key, leaving `hideRolledUp`
  // undefined — nothing was hidden and the gate reported Coding 157 over
  // budget. `npm run build` runs `tsc --noEmit 2>/dev/null`, so the type error
  // that would have caught it was swallowed.
  ...DETAIL_LEVEL_FLAGS[
    (process.env.GRAPH_DETAIL_LEVEL as keyof typeof DETAIL_LEVEL_FLAGS) ?? 'overview'
  ],
  // Stale rows are out of the default view at every level.
  showStale: false,
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
  expandedComponentIds: new Set<string>(),
  hierarchyParents: parents,
  hierarchyClassOf: (id: string) => hierarchyClasses.get(id),
  showDebugEntityTypes: false,
  // The rail's default tree, so the gate measures the default view. The
  // predicate reads `!== 'intent'`, so omitting this would still gate Intents
  // out — but only by accident, and this file is exactly where an accident
  // survives: `scripts/` is not in tsconfig's `include`, so the required field
  // that made tsc name every other call site cannot name this one.
  hierarchySpine: 'code',
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

// The Project/System a node hangs under, or null. Null is NOT folded into a
// pseudo-project: doing that reported "1/202 projects over budget", where 201
// of those "projects" were single unparented rows. They are counted separately
// below, because an unrooted node is its own finding — it is on the canvas
// under no project at all, which is the free-floating-dots problem the audit
// describes.
//
// Imported, not re-implemented (2026-09-25). This file used to carry its own
// copy of the walk while `countUnanchored` carried a second one and the panel
// would have made a third. One question, three walks, is how the canvas and
// the footer came to disagree in five different ways — see the header of
// useGraphVisibility.ts. The shared module also carries the CATEGORIES, which
// is what turns this script's bare `unrooted` number into something a person
// can act on.
const rootOfNode = (id: string): string | null =>
  rootOf(id, parents, (nodeId) => classOf.get(nodeId))

const perProject = new Map<string, number>()
let unrooted = 0
for (const e of visible) {
  const id = (e as unknown as ApiEntity).id
  const root = rootOfNode(id)
  if (root === null) {
    unrooted += 1
    continue
  }
  perProject.set(root, (perProject.get(root) ?? 0) + 1)
}
// Categorise the unrooted rows. `visible` is the right candidate set: this
// script measures what the canvas draws, so it must explain the rows a person
// would actually see, not every row in the store.
const attribution = categoriseUnattributed(
  visible as unknown as Parameters<typeof categoriseUnattributed>[0],
  forPredicate as unknown as Parameters<typeof categoriseUnattributed>[1],
  relations.map((r) => ({ from: r.source, to: r.target, type: r.attributes?.type })),
  parents,
  (id: string) => classOf.get(id),
)

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
  unrootedByCategory: Object.fromEntries(
    (['recordedParent', 'wrongClass', 'danglingRef', 'unclaimed'] as const)
      .map((k) => [k, attribution.byCategory[k].length]),
  ),
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
  w('\n=== graph density check ===')
  w(`obs-api  : ${OBS_API}`)
  w(`in store : ${report.storeNodeCount} entities`)
  w(`rendered : ${report.renderedNodeCount} nodes, ${report.renderedEdgeCount} edges (all projects)`)
  w(`limit    : ${BUDGET} nodes per project`)
  w('')
  w('  nodes  project')
  for (const r of report.perProject) {
    w(`  ${String(r.nodes).padStart(5)}  ${r.name}${r.nodes > BUDGET ? '   <- over' : ''}`)
  }
  w(`  ${String(unrooted).padStart(5)}  (no project root)`)
  w('')
  // WHY those rows have no project, not just how many. The bare count was read
  // as "rows nobody has placed yet" and for most of them that is wrong — they
  // are placed, by a field or an edge the tree refuses to use. Same module the
  // viewer's Graph quality panel renders from, so the two cannot disagree.
  if (attribution.total > 0) {
    w('  why they have no project')
    for (const key of ['recordedParent', 'wrongClass', 'danglingRef', 'unclaimed'] as const) {
      const n = attribution.byCategory[key].length
      if (n === 0) continue
      w(`  ${String(n).padStart(5)}  ${CATEGORY_LABEL[key].title}`)
      w(`         ${CATEGORY_LABEL[key].cause}`)
    }
    w('')
  }
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
