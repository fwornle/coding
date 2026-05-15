---
phase: 35-observation-digest-retention-with-json-cold-store-fallback
plan: 07
subsystem: observations-api
tags: [pagination, cold-store, merge, full-union, follow-up]
dependency-graph:
  requires: [35-04, 35-06]
  provides: [full-union-pagination]
  affects: [obs-api /observations + /digests, dashboard scrollback past retention]
tech-stack:
  added: []
  patterns:
    - "full-union pagination: when a paginated endpoint federates two ranged sources, fetch the full slice of each (no SQL LIMIT/OFFSET on the SQL side), let the merge module sort+dedup the union, and slice [offset, offset+limit) inside the merge. The total reported is the dedup'd union size — what pagination actually walks."
key-files:
  created:
    - .planning/phases/35-observation-digest-retention-with-json-cold-store-fallback/35-07-PLAN.md
    - .planning/phases/35-observation-digest-retention-with-json-cold-store-fallback/35-07-SUMMARY.md
  modified:
    - scripts/observations-api-merge.mjs
    - scripts/observations-api-server.mjs
    - tests/scripts/observations-api-server.merge.test.js
decisions:
  - "Approach (b): fetch the FULL SQLite-in-range slice (no LIMIT/OFFSET) when From crosses the retention boundary. Both SQLite-in-range and cold-in-range live fully in memory; the merge module owns sort+slice. Chosen over approach (a) — passing a page slice plus a separate SQLite total — because cold-store already returns the entire matching range and the merge module needs the full sqlite tail to correctly produce a page that contains cold rows mixed with sqlite rows by timestamp. Memory bound is modest (~1170 cold rows + a few thousand sqlite in a 45-day window ≈ 5MB)."
  - "opts.sqliteTotalInRange is accepted-but-ignored under the new contract. Existing 35-06 callers that still pass it work without modification; the field is not removed from the signature so that the back-compat surface stays additive."
  - "_metadata.coldOnFirstPageOnly is now set to `false` under the new contract. Field name retained for back-compat; frontends should not rely on it."
metrics:
  duration: ~5min
  completed: 2026-05-15
---

# Phase 35 Plan 07: Full-union pagination over SQLite + cold-store — Summary

Removed Phase 35-04's "Option B" offset==0-only-cold contract from the obs-api `/api/observations` and `/api/digests` handlers and replaced it with full-union pagination so widening the dashboard's date range past the retention boundary actually surfaces cold rows on every page — not only the first. The user's residual UX issue (1170 cold rows in a 45-day window unreachable through normal pagination) is resolved at the API layer; the dashboard frontend is unchanged because the per-row Snowflake icon shipped in 35-05 already reads `_origin === 'cold'` which still tags every cold row.

## What changed

### `scripts/observations-api-merge.mjs`

Both `_mergeObservations` and `_mergeDigests` rewritten under the new contract:

- Caller passes FULL SQLite-in-range rows and full cold-in-range rows. Inputs may be unbounded; the merge module slices.
- Filter cold to strictly older than `retentionBoundary`, dedup via the LOAD-BEARING `sqliteIds` Set, tag each row with `_origin`, sort by timestamp DESC (digests sort key: `date + 'T' + createdAt`), slice to `[offset, offset+limit)`.
- `total` returned is the dedup'd union size (what pagination actually walks). When `opts` is absent (legacy 3-arg callers), the legacy 2-field shape `{ data, _metadata }` is returned unchanged.
- `_metadata.coldOnFirstPageOnly` is now `false` under both helpers (contract change).
- `opts.sqliteTotalInRange` is accepted-but-ignored — kept in the signature so 35-06 callers continue to compile.

The LOAD-BEARING `sqliteIds = new Set(sqliteRows.map(r => r.id))` filter is preserved verbatim in both helpers, including the JSDoc and inline comment blocks referencing PLAN.md invariant #5.

### `scripts/observations-api-server.mjs`

Both `/api/observations` and `/api/digests`:

- Cold-store gate condition simplified from `from && offset === 0 && _writer?.retentionDays` to `from && _writer?.retentionDays`. The `offset === 0` clause is removed.
- When the gate fires, the handler issues the SELECT query WITHOUT `LIMIT @limit OFFSET @offset` — pulling the entire range that matches the WHERE clause.
- The full SQLite range plus the full cold range are passed to the merge helper as `(fullData, coldRows, retentionBoundary, { limit, offset })`. The merge returns the sliced page in `merged.data` and the union size in `merged.total`.
- The previous `SELECT COUNT(*)` for `total` is no longer needed in this branch because the merge module computes the union size. The COUNT remains in the paged-only branch (the common case where From is within retention).

The non-cold-store paged branch is preserved unchanged — when From is recent or absent, the handler still does the standard `LIMIT/OFFSET` SQL query.

### `tests/scripts/observations-api-server.merge.test.js`

19 tests, 0 fail. Breakdown:

Updated existing cases:
- `case 2`: `_metadata.coldOnFirstPageOnly` now `false`.
- `case 5` (digests analog): same.
- `Phase 35-06: paginable total reflects offset=0 cold contribution` → rewritten as `Phase 35-07: page 0 contains sqlite-then-cold; total = full union size`.
- `Phase 35-06: paginable total = sqliteTotal when offset > 0` → rewritten: total stays at full union (150), data is a 10-row window.
- `Phase 35-06 edge: paginable total = min(coldRows, limit) when sqliteTotalInRange == 0` → rewritten: total = 100 (full cold count), page 0 holds 10 newest cold rows.
- `case 7: offset === 0 gate is present in both server handlers` → rewritten as `Phase 35-07 contract: offset===0 gate has been removed`, asserts the gate text is gone AND the new `from && _writer?.retentionDays` shape is present at least twice.

Three NEW cases:
- **(A)** page past the SQLite tail still contains cold rows — 5 sqlite + 20 cold, offset=10, every row on page 1 is cold.
- **(B)** total reports dedup'd union size — colliding ids counted once. 5 sqlite + 5 cold (2 collisions) → total = 8, sqlite wins for colliding ids.
- **(C)** concatenating every page yields the full dedup'd union — 15 sqlite + 20 cold across 4 pages of 10, set of ids over the concat = 35, no drops.

## Verification

```
NODE_OPTIONS='--experimental-vm-modules --no-warnings' npx jest tests/scripts/observations-api-server.merge.test.js --no-coverage
```

PASS line:

```
Test Suites: 1 passed, 1 total
Tests:       19 passed, 19 total
```

New / renamed test names visible in the PASS output:

- `Phase 35-04: _mergeObservations > case 2 (35-07 contract): pure cold path returns reshaped cold rows with fromColdStore:true and coldOnFirstPageOnly:false`
- `Phase 35-07: full-union pagination for _mergeObservations > Phase 35-07: page 0 contains sqlite-then-cold; total = full union size; data sliced to limit`
- `Phase 35-07: full-union pagination for _mergeObservations > Phase 35-07: page at offset>0 returns a window into the union; total stays at union size`
- `Phase 35-07: full-union pagination for _mergeObservations > Phase 35-07 edge: range entirely older than retention — total = cold count, page 0 holds the 10 newest cold rows`
- `Phase 35-07: full-union pagination for _mergeObservations > Phase 35-07 (NEW A): page past the SQLite tail still contains cold rows`
- `Phase 35-07: full-union pagination for _mergeObservations > Phase 35-07 (NEW B): total reports dedup'd union size — colliding ids counted once`
- `Phase 35-07: full-union pagination for _mergeObservations > Phase 35-07 (NEW C): concatenating every page yields the full dedup'd union, no rows dropped`
- `Phase 35-04: _mergeDigests > case 5 (35-07 contract): digests analog - keyed on date, Set-based dedup, _origin tagging, coldOnFirstPageOnly:false`
- `Phase 35-07: source-level invariants > Phase 35-07 contract: offset===0 gate has been removed from cold-store branch in both handlers`
- `Phase 35-07: source-level invariants > Phase 35-07: merge module sets coldOnFirstPageOnly to false (contract change)`

## Design choice (full SQLite range in memory vs. paged SQLite + count)

**Approach (b) — full SQLite range in memory** was chosen.

| Approach | Server flow                                                                       | Merge module flow                                                                  | Cost                                                                                            |
| -------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| (a) paged SQLite + count | `SELECT COUNT(*)` for sqliteTotalInRange + paged `SELECT ... LIMIT/OFFSET` | Merge gets a partial sqlite page; cannot correctly interleave cold rows by timestamp across pages because it does not see the sqlite rows on other pages. | Smaller SQLite payload per request, but merge module cannot honor "cold rows can appear on any page" without re-querying SQLite. |
| (b) full SQLite range    | `SELECT ... ORDER BY ... DESC` (no LIMIT/OFFSET)                          | Merge has both sources in full, sorts+dedups+slices.                               | ~5MB per request for a 45-day window. Trivial for an in-process query path the dashboard hits once on user-driven pagination clicks. |

Approach (b) is the only correct one if cold rows must interleave with sqlite by timestamp across pages — which is exactly what the new contract requires.

## Deviations from Plan

None. The merge module rewrite, server handler simplification, and test suite update all landed as designed in `35-07-PLAN.md`.

## Authentication / external gates

None. No package installs, no auth steps.

## Preserved invariants

- **LOAD-BEARING `sqliteIds` Set** — preserved verbatim in both helpers with intact JSDoc + inline comment. Asserted by `LOAD-BEARING Set comment is present` and `Set-based dedup pattern is present in both merge helpers` source-level tests.
- **`_origin: 'cold' | 'sqlite'`** — every row in the response carries this tag. Frontend Snowflake icon (35-05) renders unchanged.
- **`ColdStoreReader` and `ObservationPruner` unchanged** — verified by `git status` (only merge, server, test, plan, summary are modified).
- **Dashboard never opens observations DB** — server-side change only; dashboard backend is a byte-pipe forwarder (35-05) and the frontend reads `_origin` per-row.
- **Insights table untouched** — out of scope for this plan; no edits anywhere near `insights`.

## Operator rollout (`autonomous: false`)

After this plan merges to main, the operator must reload the obs-api process for the new merge module and server handlers to take effect:

```bash
launchctl kickstart -k gui/$(id -u)/com.coding.obs-api
```

The dashboard backend forwards transparently (35-05's byte-pipe), so no `docker-compose restart` is needed for the frontend to pick up the new pagination behavior. Frontend bundle is unaffected.

After kickstart, a probe at 30d past the retention boundary should now return cold rows on pages 1, 2, 3, ... — not only page 0:

```bash
FROM_30D=$(date -u -d '30 days ago' +%Y-%m-%dT%H:%M:%SZ)
# Page 0
curl -fs "http://localhost:3032/api/observations?from=${FROM_30D}&limit=50&offset=0" | jq '.data | map(._origin) | group_by(.) | map({k: .[0], n: length})'
# Page 5 (offset=250) — under the OLD contract this was sqlite-only; under 35-07 it should contain cold rows once the sqlite tail is exhausted.
curl -fs "http://localhost:3032/api/observations?from=${FROM_30D}&limit=50&offset=250" | jq '.data | map(._origin) | group_by(.) | map({k: .[0], n: length})'
```

## Known Stubs

None.

## Self-Check: PASSED

- `scripts/observations-api-merge.mjs` — modified, full-union contract.
- `scripts/observations-api-server.mjs` — modified, offset==0 gate removed in both handlers.
- `tests/scripts/observations-api-server.merge.test.js` — modified, 19/19 PASS.
- `.planning/phases/35-observation-digest-retention-with-json-cold-store-fallback/35-07-PLAN.md` — created.
- `.planning/phases/35-observation-digest-retention-with-json-cold-store-fallback/35-07-SUMMARY.md` — created (this file).
- Commits: `5197c599d` (plan), `f2418f003` (merge rewrite), `a20853feb` (server handler), `e25302e3f` (tests) — all present in `git log`.
- LOAD-BEARING Set + dedup pattern still present in `observations-api-merge.mjs`.
- Test verification: 19/19 PASS via `NODE_OPTIONS='--experimental-vm-modules --no-warnings' npx jest tests/scripts/observations-api-server.merge.test.js --no-coverage`.
