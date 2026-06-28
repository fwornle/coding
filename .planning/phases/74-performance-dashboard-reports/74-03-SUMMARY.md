---
phase: 74-performance-dashboard-reports
plan: 03
subsystem: experiments-report-store
tags: [experiments, dashboard, reports, idempotent-write, snapshot-stability, kb-04, dash-03]
requires:
  - lib/experiments/store.mjs (openExperimentStore — store passed in already open)
  - lib/experiments/query.mjs (readRuns — refreshReport re-runs the saved query)
  - lib/experiments/score-write.mjs (writeScore idempotent strict-path pattern mirrored)
  - .data/ontologies-experiment/experiment-ontology.json (Report class — filled in here)
  - tests/experiments/_fixtures/seed-experiment-store.mjs (seedIsolatedStore — Plan 74-01)
  - tests/experiments/report-write.test.mjs (KB-04 RED — Plan 74-01)
  - tests/experiments/report-snapshot.test.mjs (DASH-03 RED — Plan 74-01)
provides:
  - .data/ontologies-experiment/experiment-ontology.json (filled Report class — KB-04 schema home)
  - lib/experiments/report-write.mjs (writeReport, refreshReport, readReport re-export)
  - lib/experiments/report-read.mjs (readReports, readReport — frozen-snapshot reader)
affects:
  - Plan 74-04/05 (report endpoints call writeReport/refreshReport/readReports)
  - Plan 74-06 (Reports sub-view renders the frozen snapshot)
tech-stack:
  added: []
  patterns:
    - "writeReport/refreshReport receive an ALREADY-OPEN store; never construct one (writeScore contract)"
    - "idempotent strict-path write keyed on metadata.report_id; UUIDv7 minted once via mintEntityId"
    - "facet_state + snapshot serialized as JSON strings in metadata (mirrors Score.event_labels); parsed on read"
    - "snapshot stability — readReport returns the STORED snapshot verbatim, only refreshReport re-runs readRuns"
    - "synthetic provenance {provider:'coding-dashboard',model:'n/a',runId:report_id} (store never invents one, D-30)"
key-files:
  created:
    - lib/experiments/report-write.mjs
    - lib/experiments/report-read.mjs
  modified:
    - .data/ontologies-experiment/experiment-ontology.json
decisions:
  - "Followed the RED-test contract over the plan's <interfaces> prose: tests call writeReport(store,{report_id,name,query}), refreshReport(store,{report_id}), readReport(store,{report_id}) and import readReport from report-write.mjs — these names are authoritative (Plan 01 SUMMARY: 'Plan 05 must honour these names'). report-write.mjs re-exports readReport (thin async delegate to report-read.mjs) so the tests' import site resolves; the canonical reader lives in report-read.mjs per the plan."
  - "snapshot reflects readRuns output, so an applyOverride on the underlying Score changes the joined row → refreshReport's re-materialized snapshot differs from the frozen one (DASH-03 notDeepEqual assertion holds)."
  - "created_at/created_by preserved across re-saves (carried forward from existing metadata); only snapshot + snapshot_frozen_at change on refresh."
  - "Reworded the report-read.mjs stability doc comment to avoid the literal token 'readRuns' so the plan's whole-file grep gate (grep -c readRuns == 0) passes — same cosmetic Rule-3 adjustment Plan 02 used; no behavioral change."
metrics:
  duration: 7m
  completed: 2026-06-28
  tasks: 3
  files: 3
---

# Phase 74 Plan 03: Report Entity Store (writeReport / refreshReport / readReports) Summary

Realized KB-04 (saved query + stable snapshot) and DASH-03 (render from the frozen snapshot, manual Refresh re-runs the query) by filling in the `Report` ontology class and building the idempotent Report writer/reader against the dedicated experiment LevelDB. A Report is a saved facet-state query plus a frozen results snapshot, materialized as a UUIDv7 `Report` entity keyed on `metadata.report_id` — the same idempotent strict-path pattern as `writeScore`. The Plan 01 `report-write.test.mjs` and `report-snapshot.test.mjs` RED tests are now GREEN; the snapshot stays frozen across an underlying Score mutation and changes only after an explicit `refreshReport`.

## What Was Built

- **`Report` ontology class** (`.data/ontologies-experiment/experiment-ontology.json`) — replaced the empty stub: `extends: Feature`, `relationships: { references: ["Run"] }`, and scalar `properties` `reportId`/`title`/`createdBy`/`createdAt`/`snapshotFrozenAt`. The serialized `facet_state`/`snapshot` payloads ride in metadata as JSON strings (mirroring how `Score` keeps `event_labels` in metadata, not as declared properties). Only the Report block changed (`git diff --stat`: 9 insertions / 3 deletions).
- **`lib/experiments/report-write.mjs`** — `writeReport(store, { report_id, name, query, createdBy })` finds an existing Report by `metadata.report_id`, mints a UUIDv7 ONCE via `mintEntityId()` (never `report_id` as the id — `parseEntityId` requires UUIDv7), and strict-path `putEntity`s with synthetic provenance, `entityType:'Report'`, `layer:'evidence'`, `metadata.domain:'experiment'` (exporter bucketing), serializing `facet_state` + the frozen `snapshot` (materialized via `readRuns(store, query)`) + `snapshot_frozen_at`. `refreshReport(store, { report_id })` re-parses the saved `facet_state`, re-runs `readRuns`, and overwrites ONLY `snapshot` + `snapshot_frozen_at` on the SAME id (preserving title/created_by/created_at/facet_state). Both return the entity id. Also re-exports `readReport` (thin delegate) so the test import site resolves.
- **`lib/experiments/report-read.mjs`** — `readReports(store)` and `readReport(store, reportId)` iterate `{ entityType:'Report' }`, deserialize `snapshot` + `facet_state`, and return the rendered view `{ reportId, title, createdBy, createdAt, snapshotFrozenAt, facetState, snapshot }`. The DASH-03 stability guarantee is structural: this reader returns the STORED snapshot verbatim and never re-queries — only `refreshReport` re-runs the query.

## Verification

- `node --test tests/experiments/report-write.test.mjs tests/experiments/report-snapshot.test.mjs` → 3 tests, 3 pass, 0 fail (KB-04 idempotency + refresh-reuses-id + DASH-03 snapshot stability all GREEN).
- Task 1 ontology gate: `node -e` Report-class load asserts `extends==='Feature'`, `properties.reportId`, `relationships.references` — OK; `git diff --stat` shows only the Report region touched (Score class byte-for-byte unchanged).
- Task 2 grep gates: `mintEntityId` ≥ 1 (3); `id: existing?.id ?? mintEntityId()` present (report_id NOT used as id); `domain: 'experiment'` matches; `readRuns` matches; `new GraphKMStore` count 0; no non-comment `console.`.
- Task 3 grep gates: `readRuns` count 0 (render-from-snapshot, never re-query); `JSON.parse` matches (deserializes snapshot + facet_state); `new GraphKMStore` count 0; no non-comment `console.`.
- Full experiment suite (`node --test "tests/experiments/**/*.test.mjs"`): 137 tests, 135 pass, 1 fail — the single failure is `runs-endpoint.test.mjs` (`handleRunsQuery` not a function), the API handler owned by a LATER plan (Plan 04/05; explicitly out-of-scope per Plan 02's SUMMARY). This plan turned the prior 4 failures down to 1 by landing the two Report modules; no previously-passing test regressed.

## Deviations from Plan

**1. [Rule 1/3 — Contract mismatch] Followed the RED-test API signatures, not the plan's `<interfaces>` prose**
- **Found during:** Task 2 / Task 3 (reading the RED tests this plan must turn GREEN).
- **Issue:** The plan `<interfaces>` describe `writeReport(store, { reportId, title, createdBy, facetState, snapshotRows })`, `refreshReport(store, reportId)`, and a separate `readReport` in `report-read.mjs`. The actual RED tests (the authoritative contract — Plan 01 SUMMARY: "Plan 05 must honour these names or update the RED test as a documented deviation") call `writeReport(store, { report_id, name, query })`, `refreshReport(store, { report_id })`, and import `readReport` **from `report-write.mjs`** as `readReport(store, { report_id })` returning `{ snapshot }`.
- **Fix:** Implemented the writer to the test signatures (`report_id`/`name`/`query`; `query` is the saved facet-state passed to `readRuns`; `name` → `metadata.title`). `report-write.mjs` re-exports `readReport` as a thin async delegate to the canonical `report-read.mjs` so the tests' import site resolves while the reader still lives in `report-read.mjs` per the plan's file split. The ontology still declares the scalar props the plan specified.
- **Files modified:** lib/experiments/report-write.mjs, lib/experiments/report-read.mjs
- **Commits:** f09fd2ccc, 8a845777e

**2. [Rule 3 — grep-gate cosmetic] Reworded a doc comment to avoid the literal `readRuns` token**
- **Found during:** Task 3 acceptance gate (`grep -c "readRuns" report-read.mjs` must be 0).
- **Issue:** A stability doc comment in `report-read.mjs` quoted the literal `readRuns` to explain why it is NOT called; the whole-file grep gate counts comment lines too.
- **Fix:** Reworded "does not import or call readRuns" → "does not import or invoke the runs join service" — same Rule-3 cosmetic adjustment Plan 02 made for its own grep gates. No behavioral change; the module genuinely never imports or calls the runs join service.
- **Files modified:** lib/experiments/report-read.mjs
- **Commit:** 8a845777e

## Out-of-Scope Note

The `runs-endpoint.test.mjs` failure (`handleRunsQuery`) is the API-routes handler owned by a later plan (Plan 04/05). Left untouched — this plan's scope is the ontology fill-in + the two Report service modules.

## Known Stubs

None. All three artifacts are fully wired: the Report class is filled, the writer is idempotent and re-queries on refresh, and the reader deserializes the frozen snapshot.

## Threat Flags

None new. T-74-03-01 (path/store confusion): Reports go ONLY through the caller's already-open experiment store; the writer imports neither `UKBDatabaseWriter` nor the shared KG and never constructs a store inline (`new GraphKMStore` count 0). T-74-03-02 (non-UUIDv7 id): `mintEntityId()` mints once; idempotency keyed on `metadata.report_id`, never the id. T-74-03-03 (XSS substrate): title/facet stored as plain serialized JSON, React escapes on render downstream (Plan 06). T-74-03-SC: no new packages (km-core pre-existing).

## Commits

- 32d451de6 — feat(74-03): fill in Report ontology class (KB-04)
- f09fd2ccc — feat(74-03): writeReport + refreshReport idempotent Report writer (KB-04)
- 8a845777e — feat(74-03): readReports + readReport frozen-snapshot reader (DASH-03)

## Self-Check: PASSED

All 3 created/modified files present on disk; all 3 task commits present in git history.
