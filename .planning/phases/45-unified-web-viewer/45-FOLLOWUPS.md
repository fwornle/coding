# Phase 45 — Follow-ups

Items deferred during execution. Each entry must record the plan that deferred it, the
condition under which a later plan should pick it up, and a pointer to the relevant
reference material.

## LoggingControl UI surface (deferred from 45-03 Task 0)

**Deferred during:** Plan 45-03 Task 0 (Logger port).
**Reason:** Task 0 spec marked the UI surface as "optional / defer to a later plan if
time tight". The Logger backend + tests + audit grep gate are landed; what remains is a
user-facing dialog to toggle active levels and categories at runtime.

**What to build:**

- A `LoggingControl.tsx` component (Radix `<Dialog>` + shadcn primitives, **NOT** the
  Mantine variant VOKB ships) that mirrors VOKB's surface at
  `_work/rapid-automations/integrations/operational-knowledge-management/viewer/src/components/LoggingControl.tsx`.
- Display two grids: one of level checkboxes (ERROR / WARN / INFO / DEBUG / TRACE) and
  one of category checkboxes (ROUTING / API / STORE / GRAPH / FILTERS / PANELS / LOGGER /
  DEFAULT). Wire each via `Logger.enableCategory` / `Logger.disableCategory` and
  `Logger.setActiveLevels`.
- Open via a new "Logging" entry in the existing Keyboard Help Dialog (rendered from
  Plan 45-03) — pressing `?` opens the help dialog, which contains a link / button
  labelled "Logging settings" that swaps to the LoggingControl dialog. Alternatively a
  dedicated `IconButton aria-label="Logging settings"` in the NavBar right-side cluster.
- Add a one-line entry in 45-UI-SPEC.md § Icon-only controls if a NavBar icon is chosen.

**When to land:** Plan 45-04 or 45-05 is a good candidate (both already touch the side
panel + tab shell that Plan 45-03 wires). If neither plan picks it up, a tiny standalone
plan in a Phase 45 follow-up wave is fine.

**Acceptance gate (when implemented):**

- Pressing the entry-point control opens the dialog with current level / category state
  preloaded from `Logger.getActiveLevels()` and `Logger.getActiveCategories()`.
- Toggling a checkbox persists via the existing localStorage keys
  (`unifiedViewer_activeLog*`).
- Closing + reopening the page restores the toggled state.
- A Vitest sidecar asserts the dialog renders the 5 levels and 8 categories and that
  click → toggle calls Logger.* methods.

## Insight ring / badge on nodes with insights (deferred from 45-03 round 2)

**Deferred during:** Plan 45-03 checkpoint round 2 (operator feedback on visual styling).
**Reason:** VOKB renders a ring/border on nodes that have insights attached. The
unified-viewer needs the same affordance, but the km-core /api/v1/entities payload
doesn't currently expose an `insightCount` / `hasInsight` field. Adding the affordance
without the data would require a second fetch per node, which doesn't scale to the
~1000-node coding graph.

**What to build:**

- Backend (Phase 44 amendment OR Plan 45-04 if it touches the entity reshape):
  add `insightCount: number` to the canonical entity payload at
  `lib/km-core/src/adapters/observation-view.ts`. Source: count insights whose
  `entityId` matches.
- Frontend (later plan, likely 45-04 or 45-05): in `graph-builder.ts`, set
  `borderColor: '#f59e0b'` (amber-500) + `borderSize: 2` when `entity.insightCount > 0`.
  In `node-renderer.ts`, expose a new state `'has-insight'` that the nodeReducer can
  return for nodes whose default state would otherwise be `'default'` but the
  insight badge needs to fire.

**Acceptance gate:** A node with at least one insight in the live data shows an amber
ring at default zoom on `/viewer/coding`.

## Auto-fit camera on filter change (deferred from 45-03 round 2)

**Deferred during:** Plan 45-03 checkpoint round 2.
**Reason:** When the operator filters down to a small subset (e.g. selects only
Insight + Digest classes), the camera stays zoomed out on the full graph's
bounding box. The visible cluster ends up in a corner. VOKB auto-recenters on the
visible subset after filter changes.

**What to build:**

- In `SigmaCanvas.tsx`, subscribe to the `(visibleLevels, selectedClasses, searchQuery)`
  tuple. After a settle delay (200ms debounce), iterate `graph.nodes()` filtering by
  the visible predicate, compute the bbox of `(x, y)` for the visible subset, and
  call `sigma.getCamera().animate({ x: cx, y: cy, ratio: r }, { duration: 400 })`.
- Skip the animation if the visible-set size is 0 (operator's filter eliminated
  everything) — the EmptyFilterState fires for that case.

**Acceptance gate:** Selecting only "Insight" on `/viewer/coding` re-centers the
camera on the cluster of insight nodes within 500ms.

## Backend wiring for OKB / CAP systems (deferred from 45-03 round 2)

**Deferred during:** Plan 45-03 checkpoint round 2 (operator noted OKB / CAP show
only CORS errors).
**Reason:** `/viewer/okb` points to `:3848` which is the semantic-analysis SSE
workflow port, not a REST API — there is no `/api/v1/entities` endpoint there. CAP
points to `https://okm.cc.bmwgroup.net` which is BMW corporate network only and
CORS-locked from a localhost origin. Both are outside Phase 45's scope.

**What to build:**

- Phase 44 amendment OR a new "Phase 46 / Per-system REST" plan: stand up a typed-
  views REST endpoint that surfaces B-system (semantic-analysis) and C-system
  (OKM) entities through the same `/api/v1/*` envelope contract. Could be a thin
  proxy in obs-api that fans out to the underlying graph stores.
- Operator UX: until the backends exist, the ErrorCorsState / ErrorUnreachableState
  components correctly inform the operator. Consider a "Backend not configured"
  variant that's friendlier than "CORS blocked".

## Backend has 0 relations even though it has 1000 entities (Plan 03 round 3)

**Surfaced during:** Plan 45-03 round 3 operator checkpoint ("no edges visible ever").

**Diagnosis:** `curl http://localhost:12436/api/v1/entities` returns 1000 entities;
`curl http://localhost:12436/api/v1/relations` returns `{"success":true,"data":[]}`
— empty array. The relations store is genuinely empty, not a query bug. The
frontend's graph-builder + edge reducer are wired correctly; with no input data
there is nothing for sigma to draw.

**Historical context (per `.planning/memory` notes):** the wave-analysis pipeline
has at times produced ~178 relations, but those are not currently surfaced via the
REST API or the underlying GraphKMStore. The discrepancy may be due to:
- wave-analysis writing to a different store than what km-core's `findRelations`
  reads from (e.g. Memgraph vs LevelDB).
- The Phase 42.2 LSL re-keying never resurfacing the relation triples on the
  current store.
- A persistence path that drops relations during dedup / merge.

**Where to dig:**
- `lib/km-core/src/store/GraphKMStore.ts:583` — `addRelation()` write path.
- `lib/km-core/src/store/GraphKMStore.ts:609` — `findRelations()` query path.
- `integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts` —
  does the wave controller actually call `addRelation` or only `addEntity`?
- `.data/knowledge-graph/leveldb/` — LevelDB sublevels for relation keys (look for
  `r:` or `rel:` prefixes).

**What Phase 45 does (mitigation):** graph-builder + node-renderer now use hex
colors throughout so as soon as the data backfills, edges will render visibly
(slate at opacity 0.6 default, blue at opacity 1.0 incident-on-selected).
