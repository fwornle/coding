# Phase 61: LSL Timeline & OKB Routing Honesty - Research

**Researched:** 2026-06-20
**Domain:** React/TanStack-Query frontend surgery (unified-viewer) + one additive obs-api endpoint field; cross-system REST contract bridging
**Confidence:** HIGH (all four unknowns resolved by reading live source + probing the running :8090 and :12436 servers)

## Summary

All four delegated unknowns (D-02, D-07/D-09, D-10/D-12, D-13) are resolved with live evidence. The phase is small, surgical, and almost entirely frontend; the only backend touch is two additive fields (`source` + a total count) on the obs-api `/api/coding/lsl/sessions` handler in `scripts/observations-api-server.mjs` (lines 2345-2468).

The biggest correction to the planning premise is **D-13**: the okb endpoint is ALREADY retargeted to `:8090` (commit `7b3cbf67e`, 2026-06-09), and the current `ApiClient`/`useGraphData`/`UnifiedViewer` error path ALREADY surfaces `ErrorUnreachableState` on a fetch failure. CodeAnalyzer/PersistenceAgent exist ONLY in coding-KG (`:12436`), NOT in OKM (`:8090`) — verified by probing both. So the "mirror entities appear" symptom describes a STALE pre-Phase-55 build; the CURRENT live failure mode is a **404 on `/api/v1/entities` → ErrorUnreachableState → empty graph** (the OKM-contract todo's actual 2026-06-10 finding). There is no silent-fallback code path to remove — the fix is the path-rewrite + adapter (D-10), and the truthful-failure UX (SC#5) is to ensure no fallback is *introduced* and that the error state fires on a genuine `:8090`-down.

The OKM Express entity shape is remarkably compatible: it already carries `id`, `name`, `ontologyClass`, `description` (the viewer's required `Entity` fields), shares the `{success, data}` envelope, and its `/api/relations` returns the EXACT graphology `{key, source, target, attributes:{type}}` shape km-core emits — so the existing `listRelations` normalizer works unchanged. The only adapter work is path-rewrite (`/api/v1/X` → `/api/X`) plus dropping OKM's extra fields (`embedding`, `metadata`, `legacyId`) which the viewer ignores anyway.

**Primary recommendation:** (1) obs-api adds `source` (derived from matched entities' `metadata.source`, any-`manual`→`batch` else `online`) and a `total` count field; (2) frontend reads both, adds the "N of M" badge, renames `'all'`→`'1y'` at 6 sites, and adds a second `fillClass` hue keyed on `session.source`; (3) ApiClient gets an `okb`-scoped path-rewrite (`/api/v1/`→`/api/`) — relations need NO new normalizer, entities need only field passthrough.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| True total count `M` for window | API / Backend (obs-api) | — | Count is over the filesystem walk the backend already does; client must not re-walk |
| Per-session `source` derivation | API / Backend (obs-api) | — | D-07 explicitly rejects client-side id-heuristic; backend owns `metadata.source` truth |
| "N of M" badge render | Frontend (strip) | — | Pure presentation of the two backend numbers |
| `'all'`→`'1y'` rename | Frontend (hook + strip) | — | Label/window-key concern, no backend window change (D-04) |
| Bi-source tick color | Frontend (strip) | — | `fillClass` branch on the new `session.source` field |
| OKM path-rewrite + adapter | Frontend (ApiClient) | — | D-10 locks the bridge at the ApiClient layer, okb-scoped; OKM Express untouched |
| OKB truthful-failure UX | Frontend (UnifiedViewer) | — | Existing `ErrorUnreachableState` already owns this; verify, don't rebuild |

## Standard Stack

No new packages. This phase is surgery on the existing stack.

### Core (already in repo)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @tanstack/react-query | (in-repo) | sessions + graph-data caching, queryKey partitioning | Already the viewer's data layer; `useLslSessions` + `useGraphData` use it |
| shadcn ToggleGroup | (in-repo) | window ladder UI (`LslTimelineStrip.tsx:819`) | Existing toggle control — just add/rename an item |
| Tailwind utility classes | (in-repo) | tick fill colors (`bg-pink-300`) | Existing `fillClass` composition idiom |
| express | (in-repo) | obs-api `/api/coding/lsl/sessions` route | Existing handler at `observations-api-server.mjs:2345` |

**Installation:** None. `[VERIFIED: codebase grep — no new deps]`

## Package Legitimacy Audit

Not applicable — this phase installs no external packages. `[VERIFIED: codebase — zero npm install]`

---

## Unknown 1 — D-02: cheapest mechanism for the true total `M`

**Finding `[VERIFIED: source read observations-api-server.mjs:2434-2463 + live probe :12436]`:**

The handler builds the FULL `sessions` array by walking the entire LSL history dir, parsing every filename, then sorts desc and slices to `limit` at the very end:

```js
const sessions = [];
for (const file of _walkLslDir(historyDir)) { ... sessions.push({...}); }
sessions.sort(...);
const sliced = sessions.slice(0, limit);            // line 2462
res.json({ success: true, data: { sessions: sliced } });   // line 2463
```

**`sessions.length` is the true total `M` for the window — already computed, currently discarded by the slice.** The cheapest possible mechanism: add one field to the envelope. No second query, no HEAD, no count endpoint.

**Recommended plumbing:**
- Backend: change line 2463 to
  `res.json({ success: true, data: { sessions: sliced, total: sessions.length, limit } })`
  (`total` = M before slice; `limit` echoes the applied cap so the client doesn't hard-code it).
- Client (`useLslSessions.ts` `fetchSessions`): the body type already allows `{ sessions: LslSession[] }`; widen it to `{ sessions: LslSession[]; total?: number; limit?: number }`. Return an object `{ sessions, total, limit }` from `fetchSessions` (or read `total` off the body), and surface it from the `useLslSessions` hook so the strip can compute `N = data.sessions.length`, `M = data.total`.
- Strip: render the badge when `M > N` (i.e. `data.total > data.sessions.length`). Copy e.g. "showing N of M sessions".

**Cap raise (D-03):** The backend cap is `LSL_DEFAULT_LIMIT = 200`, `LSL_MAX_LIMIT = 500` (lines 2291-2292). The client requests `limit=200` (`useLslSessions.ts:49`). Raising the client request to `limit=500` (the backend max) lets typical windows fit without the badge while keeping the perf ceiling. If the planner wants >500, raise `LSL_MAX_LIMIT` in lockstep — the client request is clamped server-side. Document the new cap meaning in the `useLslSessions` hook header (which currently documents the 56.1 contract, not the cap).

**Confidence:** HIGH — the total is a one-line additive change to an already-computed value.

---

## Unknown 2 — D-07/D-09: per-session `source` derivation

**Critical structural finding `[VERIFIED: source read observations-api-server.mjs:2390-2459]`:** Sessions are NOT built from observation records with a `metadata.source` field. They are built from **LSL filenames** (`_walkLslDir` + `_parseLslFilename`), and per-session entities are found by **range-matching km-core entity `createdAt`** against the file's `[startAt, endAt)` window (`aggregateForRange`, lines 2423-2432). There is no direct observation→session join carrying `metadata.source`.

Therefore `source` must be derived from the **matched km-core entities' `metadata.source`**, which the handler already enumerates in the `allEnts` scan (lines 2390-2408). That scan currently captures `{id, type, hidden, createdMs}` — it must additionally capture `source` from `attrs.metadata?.source ?? attrs.source`.

**Actual distinct `metadata.source` values in km-core `[VERIFIED: live count over .data/knowledge-graph/exports/general.json, 2026-06-20]`:**

| `metadata.source` | count | dominant entityTypes |
|-------------------|-------|----------------------|
| `manual` | 661 | SubComponent (326), Detail (312), TransferablePattern, Component — wave-analysis hierarchy |
| `auto` | 311 | Observation (232), Insight (79) — live LSL streaming |
| `online` | 90 | Insight (31), Process (16), Container (11), File, Config — live/online learning |
| `null`/absent | 99 | Digest (92), some Insight |
| `repair-island-trajectory-parent` | 1 | one Component (migration artifact) |

**Two-bucket mapping (D-08) — RECOMMENDED, deterministic:**

- **online/auto bucket** (pink, existing convention): `metadata.source ∈ {'auto', 'online'}`
- **manual/batch bucket** (second hue): `metadata.source === 'manual'` (and any non-online unknown value e.g. `repair-island-trajectory-parent`)
- **null/absent** (Digests): treat as the online/auto bucket by default — Digests are consolidation output of the online pipeline, not operator batch ingestion. (Alternatively treat null as "unknown" → falls into the default bucket; pick online/auto so a session of only Digests doesn't mislabel as batch.)

This aligns with the existing graph color machinery in `integrations/unified-viewer/src/graph/color-fallback.ts:69` which already partitions `source === 'auto' ? ONLINE : BATCH` — reuse the same mental model. `[VERIFIED: source read color-fallback.ts:44-73]`

**Mixed-source rule (D-09) — PINNED, deterministic:**

> A session's `source` is **`'batch'` if ANY matched entity has `metadata.source === 'manual'`, otherwise `'online'`.**

Rationale: a "batch" session is one the operator triggered (wave-analysis), which deterministically emits `manual`-tagged hierarchy entities (SubComponent/Detail). The presence of *any* `manual` entity in the window is the unambiguous signal of a batch run overlapping that session. Pure-online sessions (Observation/Insight/Digest, all `auto`/`online`/`null`) get `'online'`. This "any-batch → batch" rule is order-independent and needs no tie-break. (Dominant-source counting was considered but rejected: a single overlapping batch run can legitimately co-occur with many online ticks, and dominant-count would hide it — "any-batch" is the honest signal.)

**Recommended field values:** emit `source: 'online' | 'batch'` (two literal strings) on each session object. Empty-bucket sessions (`observationCount === 0`, no matched entities) → default `'online'` (they render greyed-out/disabled anyway, so the color is moot, but `'online'`=pink keeps them visually in the existing-disabled family).

**Frontend tick color (D-08):** the single branch point is `fillClass` at `LslTimelineStrip.tsx:919-921`:
```js
const fillClass = isHaloBucket
  ? 'bg-blue-200/40 hover:bg-blue-300/50'
  : 'bg-pink-300 hover:bg-pink-400'           // ← split this on s.source
```
Add a branch: `s.source === 'batch'` → a distinct hue. **Recommended: amber** (`bg-amber-300 hover:bg-amber-400`) — clearly distinct from pink at a glance, and from the blue selection/halo rings and the slate-ish disabled dim. The `disabledClass` (opacity-40) and `ringClass` (blue) compose on top unchanged. Avoid slate (`bg-slate-*`) — it reads too close to the `opacity-40` disabled state.

**Backend extension to the existing test:** `tests/integration/obs-api.coding-lsl-sessions.test.js` (which has ZERO `source` references today, header line 7 documents the pre-source contract) must add a `source` assertion and a fixture with mixed-source entities to lock the any-batch→batch rule.

**Confidence:** HIGH for the value enumeration and the rule; MEDIUM only on the null/Digest bucket choice (a defensible judgment call — documented above, easy to flip).

---

## Unknown 3 — D-10/D-12: OKM Express response-shape diff

**Live probe of `http://localhost:8090` `[VERIFIED: curl 2026-06-20]`:**

| Path | Status | Shape |
|------|--------|-------|
| `/api/entities` | 200 | `{success:true, data:[ ...entity... ]}` — 1,665 entities |
| `/api/v1/entities` | 404 | `Cannot GET /api/v1/entities` (HTML) |
| `/api/relations` | 200 | `{success:true, data:[ ...graphology edge... ]}` — **18,958 relations** |
| `/api/v1/relations` | (404, by inference from /api/v1/entities) | — |
| `/api/ontology/classes` | 200 | (200 — shape not field-mapped; viewer derives classes from entities anyway, see below) |
| `/api/v1/ontology/classes` | 404 | — |
| `/api/neighbors`, `/api/entities/:id/neighbors`, `/api/entity/:id` | 404 | OKM Express has **NO neighbors endpoint** |
| `/api/health`, `/api/stats` | 200 | available |

### Entity field map (OKM `/api/entities` → viewer `Entity`, `ApiClient.ts:21-28`)

| viewer `Entity` field | OKM field | match | note |
|-----------------------|-----------|-------|------|
| `id` | `id` (uuid) | ✅ exact | |
| `name` | `name` | ✅ exact | |
| `ontologyClass` | `ontologyClass` | ✅ exact | OKM carries it (= `entityType` in practice; identical values) |
| `description?` | `description` | ✅ exact | |
| `level?` | — | absent | viewer field is optional; no OKM `level` (verified: no entity has `level`). Viewer's level filter just won't apply — acceptable |
| `[k: string]` | `entityType`, `layer`, `createdAt`, `updatedAt`, `metadata`, `legacyId`, `validFrom`, `embedding` | passthrough | viewer's index signature absorbs extras; `embedding` (384-float array) is large but ignored by the renderer |

**Envelope `{success, data}` IS shared** — `ApiClient.get<T>` (lines 89-100) unwraps `body.data` identically for both systems. No envelope adapter needed.

**Verdict on entities:** the ONLY change needed is the path (`/api/v1/entities?limit=...` → `/api/entities`). The shape is already viewer-compatible. The `?limit=1000000` query param (added at `ApiClient.ts:112` to defeat km-core's 1000-clip) is harmless on OKM if it ignores unknown params; verify OKM doesn't 400 on it — if it does, drop the param for the okb branch.

### Relation field map (OKM `/api/relations` → viewer `Relation`)

OKM `/api/relations` returns the EXACT graphology envelope the existing `listRelations` normalizer already handles `[VERIFIED: curl + source read ApiClient.ts:115-137]`:
```json
{ "key":"geid_185_0", "source":"<uuid>", "target":"<uuid>",
  "attributes":{ "type":"DESCRIBES", "from":"...", "to":"...", "metadata":{}, "createdAt":"..." } }
```
The existing `listRelations` maps `{source,target,attributes.type}` → `{from,to,type}` via `canonicalizeRelationType`. **This works unchanged for OKM** — only the path differs (`/api/v1/relations` → `/api/relations`).

**SCALE LANDMINE:** OKM has **18,958 relations** (vs coding-KG's ~1,675) and **1,665 entities**. `CORRELATED_WITH` alone is 13,737 edges. Rendering 19k edges in the graph canvas will be a severe perf hazard and is far outside the viewer's tuned scale. The planner should consider whether the okb relations path needs a cap/filter (e.g. drop `CORRELATED_WITH`, or cap to the top-N most-connected). This is NOT in the locked decisions and may need a discuss-phase follow-up — flag it, do not silently render 19k edges. `[VERIFIED: live count]`

Also note one malformed type `CAUSED->Incident` (1 instance) and `CAUSED` (25) — `canonicalizeRelationType` should normalize these; verify it doesn't choke.

### Neighbors path

OKM Express has **no neighbors endpoint** (all variants 404). The viewer's `getNeighbors` (`ApiClient.ts:158`, called from `graph/events.ts:121` on node-expand) will 404 against OKM. For okb, either (a) skip the neighbors call (the full entity+relation graph is already loaded, so 1-hop expansion can be computed client-side from the loaded relations), or (b) accept that node-expand is a no-op on okb. Recommend (a) if the graph view exercises expand on okb; otherwise document the okb node-expand limitation. `[VERIFIED: live 404 on all neighbor path variants]`

### Ontology classes

OKM `/api/ontology/classes` returns 200 but its shape is unmapped here because the viewer **already derives class options from the fetched entities** (`UnifiedViewer.tsx:199-207`, `classOptions` useMemo) rather than trusting the ontology endpoint — the code comment (lines 191-198) explicitly says the km-core ontology endpoint is untrustworthy. So `listOntologyClasses` for okb can either hit `/api/ontology/classes` (path-rewritten) or be allowed to fail gracefully; the `useGraphData` ontology query failing would set `error` and trip ErrorUnreachableState, so the okb branch SHOULD path-rewrite `/api/v1/ontology/classes` → `/api/ontology/classes` to avoid a spurious 404. `[VERIFIED: source read + live 200]`

### Recommended adapter (follows existing idiom — D-10)

Branch in `ApiClient` (or a per-system path prefix) on the active system. Since `ApiClient` is constructed per-system at `UnifiedViewer.tsx:421` with `SYSTEM_ENDPOINTS[system]`, the cleanest scoping (D-11) is to pass the `System` slug (or an `apiPrefix`) into the `ApiClient` constructor and rewrite `/api/v1/` → `/api/` when `system === 'okb'`. The `coding` branch keeps `/api/v1/` unchanged.

Concrete sketch (planner refines):
```ts
// ApiClient constructor gains: constructor(baseUrl, private apiVersion: 'v1' | 'legacy' = 'v1')
// then every path that hard-codes '/api/v1/...' becomes:
//   this.apiVersion === 'legacy' ? '/api/...' : '/api/v1/...'
// UnifiedViewer: new ApiClient(SYSTEM_ENDPOINTS[system], system === 'okb' ? 'legacy' : 'v1')
```
Relations + entities need NO response adapter (shapes already match). This is strictly less work than the todo's "needs a response adapter too" worry — the OKM relation shape is graphology-identical.

**Confidence:** HIGH — both shapes probed live and diffed field-by-field.

---

## Unknown 4 — D-13: silent-fallback root cause

**Finding `[VERIFIED: source read ApiClient.ts:89-113 + useGraphData.ts + UnifiedViewer.tsx:304-326 + git log + live probe both servers]`:**

The CONTEXT premise ("CodeAnalyzer/PersistenceAgent appear despite `:8090`") describes a **stale state, not the current code**. Evidence:

1. **okb is already retargeted to `:8090`** — `system-endpoints.ts:24` `okb → http://localhost:8090`, committed `7b3cbf67e` on **2026-06-09** (before the OKM-contract todo dated 2026-06-10).
2. **ApiClient is per-system** — constructed at `UnifiedViewer.tsx:421` with `SYSTEM_ENDPOINTS[system]`. okb gets a clean `ApiClient('http://localhost:8090')`. No global base-URL, no shared default.
3. **No cross-system cache leak** — `useGraphData` queryKeys are `[ENTITIES_KEY, system]` / `[RELATIONS_KEY, system]` (`useGraphData.ts:38,44,50`), partitioned by system. coding's cached entities can't surface under okb.
4. **The error path is already truthful** — on a fetch failure `ApiClient.get` throws (`ApiClient.ts:92-94`), `useGraphData` surfaces it as `error` (lines 80-84), and `UnifiedViewer.tsx:306-322` renders `ErrorUnreachableState` (or `ErrorCorsState`). There is NO `?? defaultEntities` fallback, no try/catch swallowing.
5. **CodeAnalyzer/PersistenceAgent exist ONLY in coding-KG** — probe: present in `:12436/api/v1/entities` (`CodeAnalyzer:True, PersistenceAgent:True`), ABSENT in `:8090/api/entities` (`False/False`). OKM has zero `*Agent`/`*Analyzer` mirror names. So they literally cannot be served by `:8090`.
6. **No vite proxy rewrite** — `vite.config.ts` `server` block (lines 36-45) has no `proxy` entry; the browser hits `:8090` directly.

**Therefore the current live failure mode is NOT "shows mirror entities" — it is "okb hits `:8090/api/v1/entities` → 404 → ErrorUnreachableState → empty graph"** (exactly the OKM-contract todo's 2026-06-10 finding: "the OKB graph loads zero nodes").

**There is no silent-fallback code path to remove.** The D-13 deliverable reduces to:
- (a) Implement the path-rewrite (Unknown 3 / D-10) so okb fetches succeed against `:8090`.
- (b) For SC#5, VERIFY (via E2E) that when `:8090` is genuinely down, the existing `ErrorUnreachableState` fires — and ensure the path-rewrite work does NOT accidentally introduce a fallback (e.g. a try/catch that returns `[]`, which would render `EmptyNoDataState` "no data" instead of the truthful "unreachable" — note `entities.length === 0` → `EmptyNoDataState` at `UnifiedViewer.tsx:324`, so a swallowed error degrades the message).
- (c) Confirm `ErrorUnreachableState`'s copy mentions `:8090` / `apiClient.base` (it receives `baseUrl={apiClient.base}` at line 319) so the message is truthfully "OKM Express unreachable on :8090".

**Planner note:** The CONTEXT's "remove that silent-fallback path" instruction has no target in current code. Reframe SC#5 as "prove the truthful-failure path fires and is not regressed by the adapter," not "find and delete a fallback." If the operator genuinely still sees mirror entities, it is a **stale built bundle** — but the live env runs the Vite DEV server on `:5173` (PID confirmed), which transpiles source on the fly, so dev users get the current (correct) behavior. A production `dist/` rebuild may be the only place a stale okb→`:3848` bundle could linger; per CLAUDE.md the bind-mounted viewer needs a `npm run build` + restart to refresh `dist/`.

**Confidence:** HIGH — traced every link in the resolution chain against live source and both running servers.

---

## `'all'`-key consumer inventory (D-06) — every site the planner must update

All in `integrations/unified-viewer/src/panels/coding/`. Rename `'all'` → `'1y'` (label honesty for the unchanged 365-day value). `[VERIFIED: grep across unified-viewer/src 2026-06-20]`

**`useLslSessions.ts`:**
- L23 — `export type LslWindow = '24h' | '7d' | '30d' | 'all'` → `... | '1y'`
- L33 — `WINDOW_MS` record key `'all': 365 * 24 * 3600_000` → `'1y': ...` (value unchanged per D-04)

**`LslTimelineStrip.tsx`:**
- L211, L319, L331, L334-336, L387 — comments referencing `'all'` (update prose for clarity; non-functional)
- L402-405 — auto-slide ladder: `: 'all'` (the fall-through `next` value) → `'1y'`
- L452 — `if (windowKey !== 'all') return undefined` (allOriginMs guard) → `'1y'`
- L477 — `const isAll = windowKey === 'all'` → `'1y'`
- L479 — `endMs - WINDOW_MS['all']` → `WINDOW_MS['1y']`
- L488, L494 — further `WINDOW_MS[windowKey]` usages keyed indirectly (safe once the record key is renamed; no literal `'all'`)
- L497 — `onWindowChange` guard: `next === 'all'` → `'1y'`
- L819-831+ — `ToggleGroupItem value="..."` JSX: the toggle ladder UI. Add/rename the `'all'` item to `value="1y"` with label `1y`. (The visible options today are 24h/7d/30d + the all item — confirm the all `ToggleGroupItem` exists just past line 831 and rename it.)

**`useNodeToBucketsIndex`:** per the hook comments (`useLslSessions.ts:5,16,70`) this consumer shares the `useLslSessions` cache and passes the strip's default window; grep found NO literal `'all'` in a `useNodeToBucketsIndex.*` file — it inherits the type rename transparently. The planner should still open the hook file and confirm it doesn't hard-code `'all'` as a default arg. `[VERIFIED: grep — no 'all' literal outside the strip + hook type/record]`

**No other files** in `unified-viewer/src` reference `'all'` as an `LslWindow` (BucketCardList/SidePanel matches were `useNodeToBucketsIndex` prose, not the key). The constraint-monitor dashboard's `lslWindowSlice.ts` is a SEPARATE app (Next.js dashboard) — out of scope unless the planner wants parity.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Total count `M` | A separate count endpoint / HEAD probe | `sessions.length` before the `.slice()` (already computed) | The walk already produces the full list; counting is free |
| OKM relation normalization | A new okb-specific relation adapter | The existing `listRelations` map (`{source,target,attributes.type}`→`{from,to,type}`) | OKM `/api/relations` is byte-for-byte the same graphology shape |
| Per-session source inference | Client-side session-id heuristic | Backend `metadata.source` of matched entities | D-07 explicitly rejected client heuristic as fragile |
| Truthful-failure UX | A new error component | Existing `ErrorUnreachableState` (already wired, receives baseUrl) | It already renders on fetch-throw; just don't regress it |
| Tick second color | A new color system | A second `fillClass` branch | The strip's class-composition idiom slots a branch in cleanly |

**Key insight:** Almost every "new" capability this phase needs already exists in adjacent form (the count is computed-then-discarded; the relation adapter handles OKM unchanged; the error component is wired; the color machinery exists in `color-fallback.ts`). The work is wiring, not building.

## Common Pitfalls

### Pitfall 1: Swallowing the okb fetch error into an empty graph
**What goes wrong:** Wrapping the okb path-rewrite in a try/catch that returns `[]` turns a `:8090`-down into `EmptyNoDataState` ("no data") instead of `ErrorUnreachableState` ("unreachable") — violating SC#5's truthful-failure requirement.
**How to avoid:** Let `ApiClient.get` throw as it does today. Don't add fallback returns. E2E-assert the unreachable message when `:8090` is stopped.
**Warning signs:** Any `catch { return [] }` or `?? defaultEntities` added near the okb branch.

### Pitfall 2: Rendering 18,958 OKM relations
**What goes wrong:** OKM has ~19k edges (13.7k are `CORRELATED_WITH`); the canvas chokes far below this scale.
**How to avoid:** Discuss with the planner whether to cap/filter the okb relations (drop `CORRELATED_WITH`, or top-N by degree). NOT a locked decision — flag for a discuss-phase micro-decision.
**Warning signs:** okb tab hangs / browser tab pins a core on load.

### Pitfall 3: `metadata.source` location varies
**What goes wrong:** Some entities carry `source` at `attrs.source`, others at `attrs.metadata.source`. The `allEnts` scan currently reads neither for source.
**How to avoid:** Read `attrs.metadata?.source ?? attrs.source` (mirror the export-scan logic used in this research). Treat absent as the online/auto bucket.
**Warning signs:** All sessions colored as one bucket (source always undefined → always default).

### Pitfall 4: Forgetting the dev/build distinction
**What goes wrong:** Editing source but the operator views a stale `dist/` bundle.
**How to avoid:** Live env is the Vite dev server on `:5173` (PID 2775) — source edits are live. But per CLAUDE.md the bind-mounted production path needs `npm run build` + supervisor restart. Verify which surface the acceptance test targets.

## Runtime State Inventory

This is a UI/contract phase, not a rename/migration, but the source-bucketing touches stored data semantics — inventoried for completeness:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | km-core entities carry `metadata.source ∈ {manual, auto, online, null}` (661/311/90/99) — already present, read-only | None — read-only derivation; no migration |
| Live service config | obs-api `/api/coding/lsl/sessions` served by `observations-api-server.mjs` (launchd `com.coding.obs-api`, port 12436) | Code edit to handler; launchd auto-respawns on next restart |
| OS-registered state | None — verified: the session handler is in-process, no OS task references the window key or source | None |
| Secrets/env vars | `VITE_BACKEND_OKB_URL` (`.env.example` only; defaults to `:8090`) — no secret rename | None |
| Build artifacts | unified-viewer `dist/` (bind-mounted) may be stale; live surface is Vite dev `:5173` | `npm run build` only if targeting the production bind-mount, not dev |

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| obs-api (`:12436`) | sessions endpoint edits + verification | ✓ | running (PID 35946) | — |
| OKM Express (`:8090`) | OKB adapter probe + verification | ✓ | running (1665 ent / 18958 rel) | — for D-13 truthful-failure test, stop it deliberately |
| coding-KG (`:12436` `/api/v1`) | confirm mirror entities are coding-only | ✓ | running | — |
| Vite dev server (`:5173`) | live viewer surface | ✓ | running (PID 2775) | bind-mounted `dist/` |
| Playwright / gsd-browser | E2E SC#5 + tick-color verification | (per CLAUDE.md `gsd-browser` mandatory for visual smoke) | — | structured specs under `tests/e2e/unified-viewer/` |

**Missing dependencies with no fallback:** none — all servers up.

## Validation Architecture

`.planning/config.json` not separately read; treating nyquist as enabled (default). Test infra exists.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Jest (integration, `tests/integration/`) + Playwright (`tests/e2e/unified-viewer/`) + Vitest (unified-viewer `*.test.ts`) |
| Config file | `playwright.config.ts`; viewer vitest in unified-viewer |
| Quick run | `npx playwright test tests/e2e/unified-viewer/55-okb-routing.spec.ts` |
| Full suite | `npx playwright test tests/e2e/unified-viewer/` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LSLTIME-01 | "N of M" badge when M>N | unit (vitest) + e2e | viewer test on `useLslSessions`/strip | ❌ Wave 0 — new badge test |
| LSLTIME-01 | obs-api returns `total` | integration | extend `obs-api.coding-lsl-sessions.test.js` | ⚠️ exists, extend |
| LSLTIME-02 | `'1y'` rename, no `'all'` literal | unit + e2e | grep gate `'all'` absent in LslWindow; toggle shows 24h/7d/30d/1y | ❌ Wave 0 |
| LSLTIME-03 | bi-source tick color | unit + e2e | obs-api returns `source`; strip applies 2 fillClasses | ⚠️ extend obs test + new strip test |
| OKBROUTE-01 | okb path-rewrite hits `/api/entities` | e2e | `55-okb-routing.spec.ts` (assert `:8090/api/entities` request) | ⚠️ exists, extend assertion |
| OKBROUTE-02 | real RaaS entities, no mirror | e2e | assert `CodeAnalyzer`/`PersistenceAgent` ABSENT, RaaS present | ⚠️ `55-entity-sub-tabs`/`55-filters-parity` okb cases |
| SC#5 | `:8090` down → unreachable message | e2e | stop OKM, assert `ErrorUnreachableState` text incl `:8090` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** the relevant single spec (e.g. `55-okb-routing.spec.ts`) + the touched vitest file
- **Per wave merge:** full `tests/e2e/unified-viewer/` + `obs-api.coding-lsl-sessions.test.js`
- **Phase gate:** both suites green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] Extend `tests/integration/obs-api.coding-lsl-sessions.test.js` — assert `total` field + `source` field + mixed-source any-batch→batch fixture
- [ ] New/extended viewer test for "N of M" badge (fires when total > sessions.length)
- [ ] Grep gate / unit test: no `'all'` LslWindow literal remains; toggle renders `1y`
- [ ] Extend `55-okb-routing.spec.ts`: assert request path `/api/entities` (not `/api/v1/entities`)
- [ ] New SC#5 spec: OKM-down → `ErrorUnreachableState` with `:8090` in copy
- [ ] Decide (with planner) okb relation cap before any E2E that loads the full 18,958-edge graph

## Security Domain

`security_enforcement` not explicitly false; minimal surface for this phase.

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation | yes | obs-api `?since`/`?limit` already validated (NaN→default, never used as path — `observations-api-server.mjs:2347-2362`); new `total`/`source` are server-derived, no new input |
| V4 Access Control | no | localhost dev surfaces, no auth boundary changed |
| V6 Cryptography | no | none |

| Pattern | STRIDE | Mitigation |
|---------|--------|------------|
| `?since` as path component | Tampering | Already mitigated (T-55-06-03): parsed via `new Date`, never a path |
| OKM `embedding` payload bloat | DoS (client) | Consider stripping `embedding` in the okb entity adapter to cut payload size (1665 × 384 floats) |

## Project Constraints (from CLAUDE.md)

- **TypeScript strict** — viewer edits must type-check; don't loosen `LslWindow`/`Entity` types to dodge.
- **Submodule build pipeline** — unified-viewer is bind-mounted (no docker rebuild) but needs `npm run build` + `supervisorctl restart web-services:...` for the production `dist/` to refresh; live dev surface is Vite `:5173`. obs-api (`scripts/observations-api-server.mjs`) is NOT a submodule — restart via `launchctl kickstart -k gui/$(id -u)/com.coding.obs-api`.
- **Visual verification — `gsd-browser`** — any tick-color / badge / okb screenshot smoke against `:5173` MUST use `gsd-browser` (navigate/screenshot/click), NOT a hand-rolled Playwright script. Structured specs go under `tests/e2e/unified-viewer/`.
- **No box-drawing/ASCII-art in docs** — use prose/PlantUML (honored in this file).
- **`no-console-log`** — obs-api handler uses `process.stderr.write` for logging; keep that idiom (do NOT add `console.log`).
- **Constraint dodging forbidden** — fix underlying issues, don't pattern-match around regexes.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | null/Digest `metadata.source` → online/auto bucket (not batch) | Unknown 2 | Low — Digests render as the online color; flip to "unknown" if operator disputes. Easily changed. |
| A2 | Amber is the recommended second tick hue | Unknown 2 / D-08 | Cosmetic — Claude's discretion per D-08; planner/operator may prefer another distinct hue |
| A3 | okb should compute 1-hop expansion client-side (no OKM neighbors endpoint) | Unknown 3 | Medium — if the graph view hard-requires `getNeighbors`, node-expand is a no-op on okb until handled |
| A4 | The "mirror entities" symptom is a stale pre-Phase-55 build, not live behavior | Unknown 4 / D-13 | Medium — premise of D-13 reframed; if operator reproduces it live, re-investigate a stale `dist/` |
| A5 | Raising client `limit` to 500 (backend max) is the cap-raise (D-03) | Unknown 1 | Low — discretionary; planner may raise `LSL_MAX_LIMIT` too |

## Open Questions (RESOLVED)

All three open questions were resolved by the planner as delegated micro-decisions in plan 61-02 (Claude's discretion, consistent with the phase's "honesty about caps" theme).

1. **okb relation render scale (18,958 edges)** — RESOLVED: 61-02 Task 1 caps rendered okb relations at `OKB_RELATION_CAP = 2000`, dropping `CORRELATED_WITH` (13.7k) first, and surfaces a visible "showing N of M relations" indicator (same honesty principle as the LSL badge).
   - What we know: OKM serves ~19k relations, 13.7k of which are `CORRELATED_WITH`; viewer is tuned for ~1-2k.
   - What's unclear: whether to cap/filter, and how, for the okb view.
   - Recommendation: planner raises a micro-decision (cap or drop `CORRELATED_WITH`); NOT a locked decision, so confirm before E2E loads the full graph.

2. **okb node-expand (`getNeighbors` 404)** — RESOLVED: 61-02 Tasks 1–2 compute 1-hop expansion client-side from already-loaded relations, branched on `ApiClient.supportsServerNeighbors()` (never a silent no-op on click).
   - What we know: OKM has no neighbors endpoint.
   - What's unclear: whether the okb graph view exercises node-expand.
   - Recommendation: compute 1-hop client-side from loaded relations, or document okb expand as unsupported.

3. **`?limit=1000000` on OKM `/api/entities`** — RESOLVED: 61-02 Task 1 drops the `?limit=1000000` param on the legacy (okb) branch (probe-during-implementation; keep it only on the v1 branch).
   - What we know: viewer appends it to defeat km-core's 1000-clip.
   - What's unclear: whether OKM 400s on the unknown param.
   - Recommendation: probe with the param during implementation; drop it from the okb branch if it errors.

## Sources

### Primary (HIGH confidence)
- Live `curl http://localhost:8090/api/{entities,relations,ontology/classes,v1/entities,neighbors}` — 2026-06-20 (response shapes, counts, 404s)
- Live `curl http://localhost:12436/api/coding/lsl/sessions` + `/api/v1/entities` — 2026-06-20 (session contract, mirror-entity presence)
- `scripts/observations-api-server.mjs:2276-2468` — session handler (total/source plumbing)
- `integrations/unified-viewer/src/api/ApiClient.ts:17-191` — Entity/Relation shapes, envelope, normalizers
- `integrations/unified-viewer/src/config/system-endpoints.ts` — okb→:8090 mapping
- `integrations/unified-viewer/src/panels/coding/useLslSessions.ts` — WINDOW_MS, limit, LslWindow
- `integrations/unified-viewer/src/panels/coding/LslTimelineStrip.tsx:496-953` — fillClass, toggle, 'all' consumers
- `integrations/unified-viewer/src/graph/useGraphData.ts` + `routes/UnifiedViewer.tsx:120,304-326` — error path (D-13)
- `integrations/unified-viewer/src/graph/color-fallback.ts:44-73` — existing source→color convention
- `python3` count over `.data/knowledge-graph/exports/general.json` — metadata.source distribution
- `git log` on system-endpoints.ts / ApiClient.ts — okb retarget timing
- `tests/integration/obs-api.coding-lsl-sessions.test.js` — current session contract (no `source`)

### Secondary (MEDIUM confidence)
- `vite.config.ts` — confirmed no proxy rewrite

## Metadata

**Confidence breakdown:**
- D-02 (total M): HIGH — one-line additive on already-computed value
- D-07/D-09 (source): HIGH on enumeration + rule; MEDIUM on null-bucket choice
- D-10/D-12 (OKM shape): HIGH — probed and diffed field-by-field live
- D-13 (fallback): HIGH — traced every link; premise reframed with evidence
- 'all' inventory: HIGH — grep-verified across `unified-viewer/src`

**Research date:** 2026-06-20
**Valid until:** 2026-07-20 (stable; re-verify the :8090 relation count and metadata.source distribution if km-core/OKM data changes materially)
