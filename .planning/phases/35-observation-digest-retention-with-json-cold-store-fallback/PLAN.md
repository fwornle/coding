---
phase: 35-observation-digest-retention-with-json-cold-store-fallback
type: index
phase_number: 35
plans: 5
waves: 3
autonomous: true
---

# Phase 35: Observation & Digest Retention with JSON Cold-Store Fallback — Plan Index

## Phase goal (restated)

Cap the SQLite `observations` and `digests` tables to a configurable retention window (default **7 days**, matching the dashboard's default date picker spread) by pruning rows older than the window every hour. Serve dashboard queries that extend past the retention boundary by transparently merging recent rows from SQLite with older rows streamed from the existing JSON exports under `.data/observation-export/` (already maintained by `ObservationExporter` on a 10s debounced timer — and which already preserves pruned rows via its `_mergeWithExisting` safety net at `ObservationExporter.js:109-135`). Leave the `insights` table untouched — it is the long-term memory consumed by the prompt-injection hook (Phase 30/30.1/31). Bounded SQLite growth (currently 1,667 obs / 623 digests, exported counts at `.data/observation-export/metadata.json:3-7`) without sacrificing the dashboard's ability to time-travel further back, and without changing the JSON export schema or 10s cadence.

## Plan inventory

| Plan | Goal (one-liner) | Files touched | Wave |
|------|------------------|---------------|------|
| **35-01** | Add `retentionDays` to `.observations/config.json`; plumb it into `ObservationWriter`; enforce the dedup-floor invariant (>4h) at load time. | 2 (`config.json`, `ObservationWriter.js`) | 1 |
| **35-02** | Create `ObservationPruner.js` + Jest unit test. Deletes from `observations` and `digests` only; insights table must be untouchable from this module's code. | 2 (`ObservationPruner.js` + test) | 2 |
| **35-03** | Create `ColdStoreReader.js` + Jest unit test. Parses `.data/observation-export/{observations,digests}.json`, LRU-by-day cache (16 entries), returns rows for `[from, to)`. Read-only — no `fs.writeFile`. | 2 (`ColdStoreReader.js` + test) | 1 |
| **35-04** | Wire `obs_api` (`scripts/observations-api-server.mjs`): start the pruner on a 1h interval at boot, add range-merge logic to `GET /api/observations` and `GET /api/digests` that combines SQLite + ColdStoreReader, filtering cold-store rows by `created_at < retention_boundary` to avoid double-counting, cold rows only contributed on `offset=0` page. | 1 (`scripts/observations-api-server.mjs`) | 2 |
| **35-05** | Dashboard backend pass-through (`integrations/system-health-dashboard/server.js`): byte-pipe forwarder preserved; add defensive JSON.parse tap to log `[Dashboard:ColdStore]` line on cold-store responses without re-stringifying the body. Container rebuild + supervisorctl restart in verification steps. | 1 (`server.js`) | 3 |

## Wave / sequence table

| Wave | Plans (parallel inside the wave) | Blocked by |
|------|----------------------------------|------------|
| 1 | 35-01, 35-03 (parallel; disjoint files) | — |
| 2 | 35-02, 35-04 — 35-02 must precede 35-04 within the wave, but 35-04 can begin reading 35-03's module from Wave 1 | 35-01 (for 35-02), 35-02+35-03 (for 35-04) |
| 3 | 35-05 | 35-04 |

**Note on wave structure (revised per checker review):** the 35-03 → 35-01 dependency edge is conceptual, not code-level. 35-03's `ColdStoreReader` does not import anything from `ObservationWriter` and does not read `retentionDays` itself — the filtering happens in 35-04's merge helper. So 35-03 can ship in Wave 1 alongside 35-01. To keep 35-04 simple to schedule, we still place 35-02 in Wave 2 (it imports 35-01's `ObservationWriter` for the test's invariant assertion message). Actual edge: 35-04 depends on 35-02 + 35-03; 35-02 depends on 35-01.

- **Wave 1 (parallel):** `35-01` lays the config + invariant guard; `35-03` creates the cold-store reader. Zero file overlap.
- **Wave 2:** `35-02` (depends on 35-01) creates the pruner module + test. `35-04` (depends on 35-02 + 35-03) wires both into obs_api. Within the wave, 35-02 must complete before 35-04 begins — they are NOT parallel-safe because 35-04 imports 35-02.
- **Wave 3 (single plan, requires container restart):** `35-05` adds the defensive cold-store log tap to the dashboard backend's byte-pipe forwarder (bind-mounted; FUSE-cache caveat applies — `docker-compose restart coding-services`). Cannot start until 35-04 is live on the host.

## Cross-plan dependencies (explicit)

| Edge | Reason |
|------|--------|
| 35-02 depends on 35-01 | Pruner test imports `ObservationWriter` for cross-checking the invariant error-message string. Pruner code itself only needs the open DB handle. |
| 35-04 depends on 35-02 | obs_api imports `ObservationPruner` and starts the 1h interval. |
| 35-04 depends on 35-03 | obs_api imports `ColdStoreReader` and wires it into `/api/observations` + `/api/digests`. |
| 35-05 depends on 35-04 | Dashboard backend forwards range queries; cold-store indicator is read out of the response payload's `_metadata` field added in 35-04. |

## Phase-level verification gate criteria

The phase is **DONE** when **all** of the following hold:

1. **Dashboard renders 30d window without duplicates on the first page.** With `From = 30d ago`, `To = today` in the dashboard date pickers (`localhost:3032`) AND the first page of results (`offset=0`, `limit=200`), the result list has zero duplicate `id` values. The merged-set pagination policy (WARNING 1 resolution **Option B**) is: **cold-store rows are contributed only on `offset=0`**; subsequent pages (`offset>0`) return SQLite-only data. The response's `_metadata.coldOnFirstPageOnly: true` signals this contract to the frontend. Verify: `curl -s "http://localhost:12436/api/observations?from=$(date -u -v-30d +%Y-%m-%dT%H:%M:%SZ)&to=$(date -u +%Y-%m-%dT%H:%M:%SZ)&limit=200&offset=0" | jq '.data | map(.id) | length as $n | (length == ($n | . - (. - (unique | length))))'` returns `true`.
2. **Cold-store path is exercised.** Same query above includes a `_metadata.fromColdStore: true` field (added in 35-04). Verify: `curl -s "http://localhost:12436/api/observations?from=$(date -u -v-30d +%Y-%m-%dT%H:%M:%SZ)&offset=0" | jq '._metadata.fromColdStore'` returns `true`. AND `_metadata.coldOnFirstPageOnly` is also `true` for the same response.
3. **24h SQLite size soak.** After running `du -h .observations/observations.db` once at phase-completion T+0 and again at T+24h (with the pruner running on its 1h interval), the size must be **non-increasing** ± 2 MB (allows for WAL noise). Record both numbers in the SUMMARY.
4. **Insights untouched.** `sqlite3 .observations/observations.db "SELECT COUNT(*) FROM insights"` at T+0 and T+24h returns the same number (no pruner-caused decrease). At the source level: `grep -F 'insights' src/live-logging/ObservationPruner.js | wc -l` returns `0` (the test in 35-02 asserts this; this is the operational double-check).
5. **Dedup floor invariant test passes.** `npm test -- tests/live-logging/ObservationWriter.retention-floor.test.js` exits 0.
6. **Pruner + ColdStoreReader unit tests pass.** `npm test -- tests/live-logging/ObservationPruner.test.js tests/live-logging/ColdStoreReader.test.js` exits 0.
7. **No regression on the existing obs-api surface.** All existing endpoints (`/api/observations`, `/api/digests`, `/api/insights`, `/api/consolidation/status`) return the same shape they did before this phase — except `/api/observations` and `/api/digests` now optionally carry the `_metadata` field. No removed fields.

## Container / launchd restart checklist for the rollout

After all 5 plans are committed and merged to `main`:

```bash
# 1. Rebuild obs-api (host launchd job — owns 35-02, 35-03, 35-04 changes)
#    The 35-01 config change does NOT need a restart for ObservationWriter to pick up
#    (config is read at every writer init), but obs_api caches the writer instance, so
#    a kickstart is the cleanest way to pick up retentionDays.
launchctl kickstart -k gui/$(id -u)/com.coding.obs-api

# 2. Verify obs-api is healthy + pruner interval is running
curl -fs http://localhost:12436/health | jq '.status'   # expect "ok"
# Wait 65s, then check the obs-api stderr for the pruner heartbeat:
log show --predicate 'process == "node" AND eventMessage CONTAINS "[Pruner]"' --last 2m | tail -5

# 3. Rebuild dashboard backend (bind-mounted into coding-services; FUSE cache stale-file bug applies)
cd /Users/Q284340/Agentic/coding/docker && docker-compose restart coding-services

# 4. Verify dashboard is healthy + forwarding the new _metadata field
curl -fs http://localhost:3032/api/health | jq '.status'
curl -fs "http://localhost:3032/api/observations?from=$(date -u -v-30d +%Y-%m-%dT%H:%M:%SZ)&limit=10&offset=0" | jq '._metadata'
```

If step (2) shows no `[Pruner]` heartbeat within 65s, check `launchctl print gui/$(id -u)/com.coding.obs-api | grep -i state` and the obs-api launchd stderr log path. If step (3) returns a SyntaxError mid-line on a JS file, that's the documented FUSE cache bug from the project CLAUDE.md — `docker-compose restart coding-services` (full container restart, NOT `supervisorctl restart`) is the workaround.

## Invariants threaded through every plan

These come from `CONTEXT.md:49-56` and must be enforced *operationally* (i.e. each is backed by a test or a verifiable command, not just prose):

1. **Retention floor > 4h.** `ObservationWriter` clamps `retentionDays < 1` → throws or warns at load time. Backed by 35-01 Task 2 test.
2. **`insights` immutability.** Pruner code path NEVER references the `insights` table. Backed by 35-02 Task 2 test: `grep -F 'insights' src/live-logging/ObservationPruner.js` returns no matches (the string check is asserted in the test source itself).
3. **Cold-store reader is read-only.** `ColdStoreReader.js` MUST NOT contain any `fs.writeFile`, `fs.appendFile`, `fs.writeFileSync`, or `fs.appendFileSync` call against the export paths. Backed by 35-03 Task 2 test: scans the module source for these patterns.
4. **Dedup duplicates avoided (first-page contract).** Cold-store rows in range-merge responses are filtered to `created_at < retention_boundary` AND contributed only when `offset === 0`. The response's `_metadata.coldOnFirstPageOnly: true` documents this. Backed by 35-04 Task 2 test: seeds an in-memory cold-store fixture plus an in-memory SQLite, queries `/api/observations` programmatically at `offset=0` and again at `offset=limit`, asserts no `id` appears twice across either page and that the second page is SQLite-only.
5. **Merge-helper Set-based dedup is load-bearing.** The `const sqliteIds = new Set(sqliteRows.map(r => r.id)); coldRows.filter(r => !sqliteIds.has(r.id))` filter in `_mergeObservations` is the in-process safety net against any straggler from the cold tier whose `createdAt` happens to land on the boundary. **This Set MUST be preserved across future refactors of the merge helper.** Documented as a code comment in 35-04 and asserted by Test case 3 (invariant #4) in 35-04's integration test.
6. **launchctl kickstart command for rollout:** `launchctl kickstart -k gui/$(id -u)/com.coding.obs-api`. Quoted in 35-04 verification and in the rollout checklist above.

## Operator notes

- **Qdrant vectors survive pruning — intentional.** When `ObservationPruner` deletes a row from the SQLite `observations` table, the corresponding embedding vector in Qdrant (the `coding_observations` collection populated by `QdrantSync`) is **not** removed. This is by design: the LTM prompt-injection hook (Phase 30/30.1/31) re-injects historical context based on semantic similarity to vectors that may correspond to pruned rows. The JSON cold-store at `.data/observation-export/observations.json` carries the canonical row text, so the retrieval pipeline can re-hydrate the summary from the cold tier when a vector hit references a pruned row. If a future phase decides to also prune Qdrant vectors, that requires a separate decision — for Phase 35, vector retention is unbounded.
- **Pruner concurrency.** See 35-02's "Concurrency model" subsection. The pruner does NOT acquire `ObservationWriter._writeLock` and relies on better-sqlite3's transaction atomicity. Safe because the 4h dedup window is well inside the 24h retention floor — i.e. the pruner only operates on rows the writer has long-since stopped reading.

## Open questions / things the planner did NOT resolve

## Resolutions during execute-phase wrap-up (2026-05-15)

- **Frontend cold-store indicator UX (G6) — RESOLVED: row icon.** Each row whose origin is the cold store gets a small icon (e.g. snowflake/archive glyph) inline with the timestamp, scoped per row. No footer chip, no date-picker tooltip. Server-side, each merged response item gains an `_origin: 'cold' | 'sqlite'` field set during `_mergeObservations` / `_mergeDigests` (cold rows tagged `'cold'`, SQLite rows tagged `'sqlite'`). Frontend renders the icon when `_origin === 'cold'`. This work belongs in 35-05 — append it as Task 3 (frontend tweak) under the existing dashboard restart checklist; the rebuild + supervisor restart commands from CLAUDE.md still apply.
- **End-of-history affordance on `coldOnFirstPageOnly` pages — RESOLVED: none for v1.** The per-row icon from G6 already conveys "this is from cold storage". No additional footer text, no separator. Scope creep avoided.
- **Pruner observability hook — RESOLVED: deferred.** Stderr line is sufficient for the operator during the 24h soak; no `/api/pruner/status` endpoint.

## Original (now closed) open questions for reference

- **Frontend cold-store indicator UX (G6).** The plans surface `_metadata.fromColdStore: true` (and `_metadata.coldOnFirstPageOnly: true`) in the API response, and 35-05 forwards it. Where to display it in the React frontend (a footer chip, a row-level icon, a tooltip on the date picker) is left to the executor of 35-05 — or deferred entirely. The functional capability is shipped regardless. Frontend rebuild is `npm run build` under `integrations/system-health-dashboard/` followed by `docker exec coding-services supervisorctl restart web-services:health-dashboard-frontend` (per CLAUDE.md).
- **`ObservationExporter._mergeWithExisting` interaction.** After the pruner deletes rows from SQLite, the next `exportObservations()` call will detect `existing.length > dbRecords.length` and PRESERVE the pruned rows in JSON via `ObservationExporter.js:109-135` — this is the bridge that makes the cold-store strategy work without any new export logic. Documented in 35-02's task notes; no code change required, but if the executor sees the safety-merge stderr line spam (`[ObservationExporter] Safety merge for observations.json: kept N historic + M current = ...`) after the first prune, that's expected and indicates the cold tier is being populated correctly.
- **Pruner observability hook.** No `/api/pruner/status` endpoint is added in this phase. If the dashboard needs to surface "last pruned at X, removed N rows" later, that's a follow-up — for now the pruner just writes a stderr line on each run that the operator can `log show` against.
- **Merged-set pagination semantics (deferred to a follow-up phase).** WARNING 1 from the checker was resolved via **Option B**: cold rows contribute only on `offset=0`. If a future caller needs true server-side pagination over the merged set (correct counts on every page, mixed SQLite+cold rows interleaved by timestamp), that requires either a JOIN against an ATTACH'd JSON or a full pre-merge sort+slice with stable count — both materially larger changes. Out of scope for Phase 35.

---

**Total plans:** 5
**Files created:** 4 (`ObservationPruner.js`, `ObservationPruner.test.js`, `ColdStoreReader.js`, `ColdStoreReader.test.js`) — all tests live under `tests/live-logging/` per the project's existing convention.
**Files modified:** 4 (`config.json`, `ObservationWriter.js`, `observations-api-server.mjs`, `server.js`)
**New tests:** 3 Jest unit-test files plus an integration assertion in 35-04 (4 test suites total)
