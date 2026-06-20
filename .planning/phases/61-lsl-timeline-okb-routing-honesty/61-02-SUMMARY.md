---
phase: 61-lsl-timeline-okb-routing-honesty
plan: 02
subsystem: ui
tags: [react, tanstack-query, playwright, vitest, okm-express, unified-viewer, graphology]

# Dependency graph
requires:
  - phase: 55-unified-viewer-feature-parity-with-vokb
    provides: "okb retargeted to OKM Express :8090 (system-endpoints.ts), multi-base ApiClient, StatsBar/Footer chrome"
  - phase: 45-unified-viewer-routing-layer
    provides: "ApiClient class, useGraphData hook, makeEventHandlers factory, system-endpoints routing"
provides:
  - "okb-scoped ApiClient apiVersion path-rewrite (/api/v1/ -> /api/) for OKM Express legacy routes"
  - "Uniform listRelations { relations, total } return shape on both branches"
  - "OKB relation cap (2000) with CORRELATED_WITH dropped first + pre-cap total for honesty indicator"
  - "Client-side 1-hop node-expand for okb (OKM has no neighbors endpoint)"
  - "Footer 'showing N of M relations' honesty caption (okb-only)"
  - "Extended OKB E2E spec: legacy path, real entities, hard mirror absence, truthful :8090 unreachable"
affects: [61-03, unified-viewer, okb, okm-express]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "apiVersion-scoped path-rewrite: one ApiClient class serves both km-core /api/v1 and OKM /api legacy via a derived-from-slug flag (never user input)"
    - "Uniform object return ({ relations, total }) on both runtime branches because TS cannot branch a return type on a runtime flag"
    - "Honesty indicator reads pre-cap total off the SAME [RELATIONS_KEY, system] React Query cache entry (no second fetch)"
    - "Client-side 1-hop neighborhood from loaded relations when the backend lacks a neighbors endpoint"

key-files:
  created: []
  modified:
    - "integrations/unified-viewer/src/api/ApiClient.ts - apiVersion param, apiPath() helper, supportsServerNeighbors(), { relations, total } + OKB_RELATION_CAP cap logic"
    - "integrations/unified-viewer/src/graph/useGraphData.ts - unwrap .relations from the new uniform shape"
    - "integrations/unified-viewer/src/graph/events.ts - okb client-side 1-hop expand via getLoadedRelations()"
    - "integrations/unified-viewer/src/graph/SigmaCanvas.tsx - thread getLoadedRelations into makeEventHandlers"
    - "integrations/unified-viewer/src/routes/UnifiedViewer.tsx - construct ApiClient with 'legacy' for okb, relation-cap honesty wiring"
    - "integrations/unified-viewer/src/panels/Footer.tsx - relationTotal prop + 'showing N of M relations' caption"
    - "tests/e2e/unified-viewer/55-okb-routing.spec.ts - OKBROUTE-01/02 + hard SC#5 mirror absence + :8090 unreachable"

key-decisions:
  - "Compare CORRELATED_WITH case-insensitively (toUpperCase) because canonicalizeRelationType only folds space-containing phrases, so both CORRELATED_WITH and correlated_with survive unchanged"
  - "SC#5 E2E forces OKM-down via route.fulfill(503) (NOT abort) because an aborted fetch throws 'Failed to fetch' which isCorsError() classifies as the CORS banner, not the unreachable banner"
  - "Honesty indicator reads total off the shared React Query cache entry rather than threading it through useGraphData's public return (keeps useGraphData shape-compatible for coding)"

patterns-established:
  - "apiVersion path-rewrite: derive the backend dialect from the System slug enum, route every hard-coded path through a single apiPath() helper"
  - "Uniform { relations, total } object return lets one method serve a capped (okb) and uncapped (coding) consumer without a TS return-type union"

requirements-completed: [OKBROUTE-01, OKBROUTE-02]

# Metrics
duration: ~40min
completed: 2026-06-20
---

# Phase 61 Plan 02: OKB Routing Honesty Summary

**okb-scoped ApiClient path-rewrite (/api/v1/ -> /api/) bridging the unified viewer to OKM Express's legacy /api/entities contract on :8090, with a 2000-edge relation cap (CORRELATED_WITH dropped first) surfaced via a 'showing N of M relations' honesty caption, client-side 1-hop node-expand, and a truthful :8090 unreachable banner — never the coding-KG mirror.**

## Performance

- **Duration:** ~40 min
- **Started:** 2026-06-20T17:10:00Z (approx)
- **Completed:** 2026-06-20T17:50:00Z (approx)
- **Tasks:** 3
- **Files modified:** 7 (+ 1 deferred-items tracking file)

## Accomplishments

- ApiClient now serves both km-core `/api/v1/` (coding) and OKM Express legacy `/api/` (okb) from one class via an `apiVersion` flag derived solely from the System slug — okb's live `:8090/api/v1/entities -> 404 -> empty graph` failure is fixed by the path-rewrite.
- The 18,958-edge OKM scale is handled honestly: CORRELATED_WITH (13,737 edges) dropped first, remainder capped at `OKB_RELATION_CAP = 2000`, pre-cap count surfaced as `total` so the Footer renders "showing N of M relations" instead of silently truncating.
- okb node double-click computes a 1-hop neighborhood client-side from the loaded relation set (OKM has no neighbors endpoint) — a visible selection expansion, never a silent no-op.
- The Pitfall-1 / D-13 truthful-failure guard is preserved and proven: no swallow-to-empty fallback was introduced; OKM-down renders `ErrorUnreachableState` (mentions :8090), validated by a new E2E case that fulfills :8090 with 503.
- E2E spec extended and validated against the actual 61-02 code (worktree Vite on :5174 with OKM Express live on :8090): all 6 okb-routing tests pass, including the real-entity SC#4 check actually executing.

## Task Commits

1. **Task 1: okb apiVersion path-rewrite + relation cap in ApiClient (TDD)** - `82b181f91` (feat)
2. **Task 2: wire okb legacy apiVersion + client-side 1-hop expand + relation-cap honesty indicator** - `3b5c7878b` (feat)
3. **Task 3: extend OKB E2E — legacy path, real entities, mirror absence, :8090 unreachable** - `71e502ea2` (test)

_Task 1 is a TDD task: failing tests were written and confirmed RED (8 new failing cases) before the implementation turned them GREEN; both committed together._

## Files Created/Modified

- `integrations/unified-viewer/src/api/ApiClient.ts` - `apiVersion` constructor param (default 'v1'), public `apiPath()` rewrite helper, `supportsServerNeighbors()`, `OKB_RELATION_CAP`, uniform `{ relations, total }` return with okb CORRELATED_WITH-drop + 2000 cap; all paths routed through `apiPath()`
- `integrations/unified-viewer/src/graph/useGraphData.ts` - unwrap `relationsQ.data?.relations` from the new uniform shape (coding graph stays byte-identical)
- `integrations/unified-viewer/src/graph/events.ts` - `handleDoubleClickNode` branches on `supportsServerNeighbors()`; okb path computes 1-hop neighbors from `getLoadedRelations()`
- `integrations/unified-viewer/src/graph/SigmaCanvas.tsx` - threads `getLoadedRelations: () => relations` into `makeEventHandlers`
- `integrations/unified-viewer/src/routes/UnifiedViewer.tsx` - `new ApiClient(SYSTEM_ENDPOINTS[system], system === 'okb' ? 'legacy' : 'v1')`; okb-only relation-cap query reading `total` off the shared cache; passes `relationTotal` to Footer
- `integrations/unified-viewer/src/routes/UnifiedViewer.test.tsx` - mock fixed to re-export `RELATIONS_KEY` via `importOriginal`
- `integrations/unified-viewer/src/panels/Footer.tsx` - optional `relationTotal` prop + amber "showing N of M relations" caption when `relationTotal > edges`
- `tests/e2e/unified-viewer/55-okb-routing.spec.ts` - OKBROUTE-01 (legacy path), OKBROUTE-02/SC#4 (real entities, skip-gated on `okmIsUp()`), hard SC#5 mirror absence, SC#5 :8090 unreachable banner

## Decisions Made

- **Case-insensitive CORRELATED_WITH drop:** `canonicalizeRelationType` only folds space-containing phrases, so both `CORRELATED_WITH` and `correlated_with` survive unchanged. The drop predicate compares `.toUpperCase()` to catch every casing OKM emits.
- **SC#5 forces OKM-down via `route.fulfill(503)`, not `route.abort()`:** an aborted fetch throws `TypeError: Failed to fetch`, which `isCorsError()` keys on -> renders the CORS banner, not the unreachable banner. A 503 makes `ApiClient.get` throw `<url> -> HTTP 503` (no "Failed to fetch"), deterministically routing to `ErrorUnreachableState`. Both banners mention :8090, but SC#5 specifically requires the unreachable one.
- **`total` read off the shared React Query cache, not threaded through useGraphData:** keeps `useGraphData`'s public return shape-compatible for coding (plan constraint) while giving the okb honesty indicator the pre-cap count with zero extra network round-trips.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] CORRELATED_WITH case-sensitivity in the relation-cap drop**
- **Found during:** Task 1 (ApiClient cap logic)
- **Issue:** The plan's text said "drop edges whose `type` canonicalizes to `CORRELATED_WITH`", but `canonicalizeRelationType` only lowercases space-containing phrases — `correlated_with` (OKM's likely casing) would NOT canonicalize to `CORRELATED_WITH`, leaking those edges past the drop.
- **Fix:** Compare `(r.type ?? '').toUpperCase() !== 'CORRELATED_WITH'` so every casing is dropped.
- **Files modified:** `integrations/unified-viewer/src/api/ApiClient.ts`
- **Verification:** vitest case with mixed `CORRELATED_WITH` + `correlated_with` asserts both dropped (total = post-drop count).
- **Committed in:** `82b181f91` (Task 1 commit)

**2. [Rule 1 - Bug] Stale `listEntities` test assertion (pre-existing, in the file Task 1 owns)**
- **Found during:** Task 1 (running ApiClient.test.ts)
- **Issue:** `listEntities issues GET to /api/v1/entities` asserted the URL had no `?limit` param, but `listEntities` has always appended `?limit=1000000` (the documented clip opt-out). The test was already failing on the base commit (5 passed / 1 failed before any 61-02 edit).
- **Fix:** Updated the assertion to the documented `/api/v1/entities?limit=1000000`.
- **Files modified:** `integrations/unified-viewer/src/api/ApiClient.test.ts`
- **Verification:** 14/14 ApiClient tests green.
- **Committed in:** `82b181f91` (Task 1 commit)

**3. [Rule 3 - Blocking] `RELATIONS_KEY` import broke the `useGraphData` mock in UnifiedViewer.test.tsx**
- **Found during:** Task 2 (wiring the honesty indicator's cache read)
- **Issue:** ViewerCore now imports `RELATIONS_KEY` from `@/graph/useGraphData`, but `UnifiedViewer.test.tsx` mocks that module without re-exporting the constant, so vitest threw "No RELATIONS_KEY export is defined on the mock" — a regression I introduced.
- **Fix:** Changed the mock to `importOriginal` and spread the real exports, overriding only `useGraphData`.
- **Files modified:** `integrations/unified-viewer/src/routes/UnifiedViewer.test.tsx`
- **Verification:** the `RELATIONS_KEY` error cleared; that file went from 3 -> 9 passing.
- **Committed in:** `3b5c7878b` (Task 2 commit)

**4. [Rule 1 - Bug] SC#5 E2E route pattern + abort-vs-503 (in Task 3's own spec)**
- **Found during:** Task 3 (running the SC#5 unreachable case)
- **Issue:** Initial `page.route('**/localhost:8090/**', abort)` (a) didn't match the URL and (b) abort surfaces as "Failed to fetch" -> CORS banner, not the unreachable banner SC#5 requires.
- **Fix:** Switched to a regex route `/localhost:8090\/api\//` fulfilled with HTTP 503.
- **Files modified:** `tests/e2e/unified-viewer/55-okb-routing.spec.ts`
- **Verification:** SC#5 test passes against live :5173 (banner shows, mentions 8090, no EmptyNoDataState, no mirror).
- **Committed in:** `71e502ea2` (Task 3 commit)

---

**Total deviations:** 4 auto-fixed (3 bugs, 1 blocking). All within the files the respective tasks own.
**Impact on plan:** No scope creep — all fixes were necessary to make the planned behavior correct. Two pre-existing failures (tsc OntologyFilter.test.tsx, 4 stale VKB/VOKB label assertions in UnifiedViewer.test.tsx) were logged to `deferred-items.md` and NOT fixed (out of 61-02 scope — Phase 55/60 concerns).

## Issues Encountered

- **Worktree had no `node_modules`:** symlinked the main repo's `integrations/unified-viewer/node_modules` into the worktree (gitignored-adjacent; never staged).
- **Standing dev server on :5173 serves main-repo code, not the worktree:** so OKBROUTE-01/02 (which assert the 61-02 path-rewrite) failed against :5173 but were validated by spinning up a throwaway worktree Vite on :5174 + a throwaway Playwright config — both passed with OKM Express live on :8090. The :5174 server and throwaway config were torn down after verification.

## Known Stubs

None. All okb data paths are wired to OKM Express; no placeholder/empty-array data flows to the UI.

## Deferred Issues

- Pre-existing tsc errors in `OntologyFilter.test.tsx` (`level: null` vs `number | undefined`, 3 sites) — Phase 60 origin, not 61-02.
- Pre-existing stale label assertions in `UnifiedViewer.test.tsx` (4 tests assert `Coding`/`OKB` but labels are `VKB`/`VOKB` since Phase 55) — 61-02 reduced this file's failures 6 -> 4 by fixing the `RELATIONS_KEY` mock.

Both tracked in `.planning/phases/61-lsl-timeline-okb-routing-honesty/deferred-items.md`.

## User Setup Required

None - no external service configuration required. (OKM Express on :8090 is an existing operator-managed service; the okb tab degrades to a truthful `ErrorUnreachableState` when it is down.)

## Next Phase Readiness

- okb routing honesty is complete and SC-verified (SC#4 real-entity check actually executed and passed with OKM up; SC#5 truthful-unreachable proven).
- 61-03 (if it consumes okb routing) can rely on `ApiClient(apiVersion='legacy')`, the `{ relations, total }` shape, and `supportsServerNeighbors()`.
- Concern for the verifier: SC#4 real-entity verification is gated on OKM Express being up on :8090. A CI/verification run with :8090 down will skip-with-reason on the real-entity assertion only; that does NOT constitute SC#4 verification. The mirror-absence, path-rewrite, and unreachable-message assertions run unconditionally.

## Self-Check: PASSED

- `61-02-SUMMARY.md` exists.
- All task/metadata commits present in history: `82b181f91`, `3b5c7878b`, `71e502ea2`, `e6f7437d9`.

---
*Phase: 61-lsl-timeline-okb-routing-honesty*
*Completed: 2026-06-20*
