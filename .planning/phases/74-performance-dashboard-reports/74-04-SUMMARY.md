---
phase: 74-performance-dashboard-reports
plan: 04
subsystem: experiments-rest-endpoints
tags: [dashboard, experiments, rest-api, reverse-proxy, transient-store, two-store-boundary, dash-01, dash-02, dash-03, kb-04]
requires:
  - lib/vkb-server/api-routes.js (registerRoutes + handleScoreOverride transient-store idiom — pre-existing)
  - lib/experiments/query.mjs (readRuns — Plan 74-02)
  - lib/experiments/timeline-read.mjs (readTimeline — Plan 74-02)
  - lib/experiments/report-write.mjs (writeReport, refreshReport — Plan 74-03)
  - lib/experiments/report-read.mjs (readReports — Plan 74-03)
  - lib/experiments/store.mjs (openExperimentStore — pre-existing)
  - tests/experiments/runs-endpoint.test.mjs (DASH-01 RED — Plan 74-01)
  - integrations/system-health-dashboard/server.js (token-usage proxy idiom — pre-existing)
provides:
  - lib/vkb-server/api-routes.js (handleRunsQuery, handleTimeline, handleReportsQuery, handleSaveReport, handleRefreshReport + 5 route registrations)
  - integrations/system-health-dashboard/server.js (/api/experiments/* same-origin reverse proxy to host.docker.internal:8080)
  - docker/docker-compose.yml (lib/experiments ro bind-mount into coding-services)
affects:
  - Plan 74-05/06 (Performance page + Reports sub-view fetch same-origin /api/experiments/...)
tech-stack:
  added: []
  patterns:
    - "transient experiment-store access per handler: openExperimentStore -> operate -> store.close() in finally (mirrors handleScoreOverride)"
    - "this.experimentRepoRoot honored in every store handler (null in prod -> resolves CODING_REPO; tests inject an isolated tmp root)"
    - "two-store boundary: handleTimeline reads token-usage.db via readTimeline and NEVER opens the experiment LevelDB"
    - "same-origin reverse proxy via app.use('/api/experiments', ...) forwarding method + query + body to host.docker.internal:8080 (mirrors the token-usage proxy + the km-core /api/km wildcard)"
    - "dynamic import('../experiments/*.mjs') inside handlers keeps server boot decoupled from km-core"
key-files:
  created: []
  modified:
    - lib/vkb-server/api-routes.js
    - integrations/system-health-dashboard/server.js
    - docker/docker-compose.yml
decisions:
  - "Returned { rows } (not the plan's { runs }) from handleRunsQuery because the authoritative RED test (runs-endpoint.test.mjs) asserts res.body.rows — same RED-test-over-plan-prose precedence Plans 02/03 set. handleRunsQuery also calls res.status(200).json(...) because the test's mock res.json does not set statusCode and the test asserts res.statusCode === 200."
  - "handleSaveReport adapts the plan's body shape ({title, facetState, snapshotRows}) onto the Plan 03 writer signature writeReport(store, {report_id, name, query, createdBy}): title->name, facetState->query (the saved readRuns options the writer re-runs on refresh). A reportId slug is accepted; if absent, a stable slug is minted from the title."
  - "handleTimeline calls readTimeline(req.params.taskId) with NO store — readTimeline reads the proxy-owned token-usage.db read-only with task_id bound as ? (two-store boundary + T-74-04-01)."
  - "Added a docker-compose ro bind-mount for lib/experiments (Rule 3): the in-container vkb-server (port 8080 is published from coding-services) dynamic-imports ../experiments/*.mjs, but only lib/vkb-server was mounted — so the live endpoints 500'd with module-not-found until lib/experiments was mounted too."
metrics:
  duration: 18m
  completed: 2026-06-28
  tasks: 2
  files: 3
---

# Phase 74 Plan 04: Experiment REST Endpoints + Same-Origin Proxy Summary

Exposed the Plan 02/03 read/write layers over REST and wired same-origin connectivity for the container-served Performance page. Added five experiment endpoints to `lib/vkb-server/api-routes.js` (runs query, timeline, reports list/save/refresh) using the MANDATORY transient open->operate->close-in-finally store pattern, and added a `/api/experiments/*` reverse-proxy block to the dashboard `server.js` forwarding to `host.docker.internal:8080`. The Plan 01 `runs-endpoint.test.mjs` RED test is now GREEN and the full experiment suite is GREEN. Live-verified end to end through both `:8080` (vkb-server) and the same-origin `:3033` proxy after a full container recreate.

## What Was Built

- **Five experiment REST handlers + route registration** (`lib/vkb-server/api-routes.js`) — registered immediately after the existing PATCH `/api/experiments/scores/:taskId`:
  - `handleRunsQuery` (GET `/api/experiments/runs`): transient `openExperimentStore` -> `readRuns(store, { includePending: req.query.includePending === 'true' })` -> `res.status(200).json({ rows })`, `store.close()` in finally; 500 on error. Returns `rows` (not `runs`) per the RED-test contract.
  - `handleTimeline` (GET `/api/experiments/runs/:taskId/timeline`): does NOT open the experiment store — calls `readTimeline(req.params.taskId)` which reads the proxy-owned `token-usage.db` read-only; `res.status(200).json({ timeline })`; graceful empty array on a missing DB; 400 if taskId is missing.
  - `handleReportsQuery` (GET `/api/experiments/reports`): transient store -> `readReports(store)` -> `{ reports }`.
  - `handleSaveReport` (POST `/api/experiments/reports`): validates `title` (non-empty, <=256), `facetState` (object), `snapshotRows` (array) BEFORE any write; derives/accepts a `reportId` slug; transient store -> `writeReport(store, { report_id, name: title, query: facetState, createdBy })` -> `res.status(201).json({ reportId })`; 400 on bad input.
  - `handleRefreshReport` (POST `/api/experiments/reports/:id/refresh`): transient store -> `refreshReport(store, { report_id: req.params.id })`; maps the writer's "no Report found" Error to 404; else `res.status(200).json({ reportId, refreshedAt })`.
  - Every store handler uses the close-in-finally transient pattern verbatim, honors `this.experimentRepoRoot`, dynamic-imports the service modules, and logs via the in-scope `logger` (no `console.`). Runs are NEVER routed through `/api/entities` (RESEARCH Pitfall 1).

- **Same-origin `/api/experiments/*` reverse proxy** (`integrations/system-health-dashboard/server.js`) — `app.use('/api/experiments', ...)` wildcard forwarding ALL methods + query + body to `http://host.docker.internal:8080/api/experiments<subpath>`, mirroring the token-usage proxy block. On fetch failure it returns `res.status(502).json({ error: 'experiment API (vkb-server) unreachable', details: err.message })` (matches UI-SPEC error copy). Upstream status + JSON are piped back. No `console.` added.

- **`lib/experiments` container bind-mount** (`docker/docker-compose.yml`) — added a read-only mount mirroring the existing `lib/vkb-server` mount so the in-container vkb-server can resolve the `../experiments/*.mjs` dynamic imports at runtime.

## Verification

- `node --test tests/experiments/runs-endpoint.test.mjs` -> 1 test, 1 pass, 0 fail (DASH-01 GREEN).
- `node --test "tests/experiments/**/*.test.mjs"` -> 137 tests, 136 pass, 0 fail, 1 skipped (pre-existing intentional skip). No remaining RED; no regression.
- Task 1 grep gates: `/api/experiments/` count = 12 (>=6); `openExperimentStore` count = 11 (>=4); `store.close()` count = 5 (>=4); `this.experimentRepoRoot` count = 8; `console.` count = 0; `handleTimeline` block contains 0 `openExperimentStore`.
- Task 2 grep gates: `node --check integrations/system-health-dashboard/server.js` passes; `host.docker.internal:8080` count = 1 (>=1); `experiment API (vkb-server) unreachable` present; `'/api/experiments'` route present; no `console.` added (diff-checked).
- **Live (after `cd docker && docker-compose up -d coding-services` — full recreate, required because the volume set changed):**
  - `curl :8080/api/experiments/runs` -> HTTP 200 with real rows (`task_id: verify-headless-...`).
  - `curl :8080/api/experiments/reports` -> 200 `{"reports":[]}`.
  - `curl :8080/api/experiments/runs/nonexistent-task/timeline` -> 200 `{"timeline":[]}` (graceful empty).
  - `curl :3033/api/experiments/runs` (same-origin proxy) -> 200 forwarding the same JSON. NOT an HTML 404.

## Rebuild / Restart Requirement (MUST READ)

`integrations/system-health-dashboard/server.js` is a BACKEND change on a bind-mounted file. Docker Desktop's VirtioFS caches bind-mounted files, so a supervisor-only restart re-reads the STALE cached file. The correct apply path for the `server.js` proxy change is a FULL container restart:

```bash
cd docker && docker-compose restart coding-services
```

The `docker/docker-compose.yml` bind-mount addition (`lib/experiments`) is a VOLUME-SET change, which `restart` does NOT apply — it requires a recreate:

```bash
cd docker && docker-compose up -d coding-services
```

Both were performed during this plan; the live verification above ran against the recreated container.

## Deviations from Plan

### Auto-fixed / Contract-aligned Issues

**1. [Rule 1/3 - Contract mismatch] handleRunsQuery returns `{ rows }` and sets status 200 explicitly**
- **Found during:** Task 1 (reading the RED test this handler must turn GREEN).
- **Issue:** The plan `<action>` says `res.json({ runs })`, but the authoritative RED test (`runs-endpoint.test.mjs`) asserts `res.body.rows` AND `res.statusCode === 200`. The test's mock `res.json` does not set `statusCode`.
- **Fix:** Return `res.status(200).json({ rows })`. Same RED-test-over-plan-prose precedence Plans 02/03 documented ("Plan must honour these names or update the RED test").
- **Files modified:** lib/vkb-server/api-routes.js
- **Commit:** d9cb38c84

**2. [Rule 3 - Blocking infrastructure] Added lib/experiments bind-mount to docker-compose.yml**
- **Found during:** Task 2 live verification (the plan's behavior assertion: `curl :3033/api/experiments/runs` returns JSON, not HTML 404).
- **Issue:** vkb-server runs INSIDE coding-services (port 8080 is published from the container). The new handlers dynamic-import `../experiments/*.mjs`, but `docker-compose.yml` mounted only `lib/vkb-server`, not `lib/experiments` — so live calls 500'd with `Cannot find module '/coding/lib/experiments/store.mjs'`. This blocked the plan's own live success criterion.
- **Fix:** Added a read-only `lib/experiments` bind-mount mirroring the existing `lib/vkb-server` mount. `.data` (experiment LevelDB + `ontologies-experiment`) was already mounted, so no further change was needed. Obviously-correct, mirrors an existing mount, no new dependency — treated as Rule 3 (blocking) rather than Rule 4 (architectural).
- **Files modified:** docker/docker-compose.yml
- **Commit:** 84591611a

**3. [Plan-shape adaptation] handleSaveReport body shape mapped onto the Plan 03 writer signature**
- **Found during:** Task 1 (wiring the writer).
- **Issue:** The plan body shape is `{ title, facetState, snapshotRows }`; the Plan 03 writer (built to its RED tests) is `writeReport(store, { report_id, name, query, createdBy })`.
- **Fix:** Mapped `title -> name`, `facetState -> query` (the saved readRuns options the writer re-runs on refresh). `snapshotRows` is validated as required input per the plan/threat-model (T-74-04-02) though the writer materializes its own frozen snapshot from the query. A `reportId` slug is accepted; if absent, a stable slug is minted from the title.
- **Files modified:** lib/vkb-server/api-routes.js
- **Commit:** d9cb38c84

## Known Stubs

None. All five endpoints are fully wired and live-verified against real data.

## Threat Flags

None new. The handlers preserve the threat-model dispositions: T-74-04-01 (timeline binds task_id as `?` via readTimeline, never builds SQL); T-74-04-02 (handleSaveReport validates title/facetState/snapshotRows before writeReport); T-74-04-03 (readRuns/readReports surface only Run/Score/Outcome/Report fields); T-74-04-04 (every store handler uses transient open->close-in-finally; no module-level open); T-74-04-05 (handlers use openExperimentStore only, never UKBDatabaseWriter); T-74-04-SC (no new packages — express/km-core/better-sqlite3 pre-existing). The docker-compose bind-mount is read-only (`:ro`) and mirrors an existing mount — no new trust boundary.

## Commits

- d9cb38c84 — feat(74-04): five experiment REST handlers + route registration
- ce4876237 — feat(74-04): same-origin /api/experiments/* reverse proxy in server.js
- 84591611a — fix(74-04): bind-mount lib/experiments into coding-services

## Self-Check: PASSED

All three modified files present on disk; all three task commits present in git history; runs-endpoint test GREEN; full experiment suite GREEN; live endpoints return 200 JSON through both :8080 and the :3033 same-origin proxy.
