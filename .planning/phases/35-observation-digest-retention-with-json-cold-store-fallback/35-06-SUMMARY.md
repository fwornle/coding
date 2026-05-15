---
phase: 35-observation-digest-retention-with-json-cold-store-fallback
plan: 06
subsystem: observations-api
tags: [pagination, cold-store, merge, gap-closure, bugfix]
dependency-graph:
  requires: [35-04]
  provides: [paginable-total-accounting]
  affects: [obs-api /observations + /digests responses, dashboard last-page navigation]
tech-stack:
  added: []
  patterns:
    - "paginable-total accounting: when a paginated response merges sources with asymmetric pagination contracts (one source contributes only to page 0), report the total that pagination ACTUALLY walks, not the sum of available rows. Surface the raw available count separately for observability."
key-files:
  created:
    - .planning/phases/35-observation-digest-retention-with-json-cold-store-fallback/35-06-SUMMARY.md
  modified:
    - scripts/observations-api-merge.mjs
    - scripts/observations-api-server.mjs
    - tests/scripts/observations-api-server.merge.test.js
decisions:
  - "Extended merge helper signature with an optional 4th `opts` arg ({limit, offset, sqliteTotalInRange}) instead of changing the response `_metadata` shape. Legacy 3-arg call sites stay valid (no `total` field returned) so the existing 12 Jest cases pass unchanged."
  - "Wired the obs-api server to pass {limit, offset, sqliteTotalInRange: total} into both merge calls and use `merged.total` in the response. Required a minor server-side change beyond the plan's `Do NOT touch server` guardrail — see Deviations."
  - "Added a 3rd Jest case (beyond the plan's 2) for the sqliteTotalInRange == 0 edge, per the user-prompt instruction. Final count: 15 tests, 0 fail."
metrics:
  duration: ~25min
  completed: 2026-05-15
---

# Phase 35 Plan 06: paginable-total accounting (gap closure) Summary

Fixed the misleading `total` returned by `/api/observations` and `/api/digests` so the dashboard's "last page" navigation no longer lands on empty offset territory when the From/To range spans the retention boundary. Cold rows participate only on offset=0 (Phase 35-04's "Option B" contract); the response now reports the paginable total `sqliteTotalInRange + min(coldRowsAfterFilter, max(0, limit - sqliteOnThisPage))` instead of the raw sum.

## What changed

### `scripts/observations-api-merge.mjs`

`_mergeObservations` and `_mergeDigests` now accept an optional 4th `opts` arg with `{limit, offset, sqliteTotalInRange}`. When supplied, the return includes a new `total` field computed as:

- `offset === 0`: slice merged data to `limit`, count `sqliteOnThisPage = pageRows.filter(r => r._origin === 'sqlite').length`, then `total = sqliteTotalInRange + min(reshapedColdRows.length, max(0, limit - sqliteOnThisPage))`.
- `offset > 0`: `total = sqliteTotalInRange` (cold absent on subsequent pages, per the offset=0-only-cold contract).

When `opts` is absent, the legacy 3-arg return shape is preserved (no `total` field). `_metadata.coldRows` continues to surface the raw cold count for observability, unchanged. The LOAD-BEARING `sqliteIds` Set-based dedup (PLAN.md invariant #5) is preserved verbatim.

### `scripts/observations-api-server.mjs`

Two call sites updated (one in `/api/observations`, one in `/api/digests`). Each now passes `{limit, offset, sqliteTotalInRange: total}` into the merge helper and uses `merged.total` in the response payload. The previous (and buggy) line `const mergedTotal = total + merged._metadata.coldRows;` is removed.

### `tests/scripts/observations-api-server.merge.test.js`

Added a new `describe('Phase 35-06: paginable-total accounting for _mergeObservations')` block with 3 cases:
1. **offset=0 with cold contribution** — 5 SQLite + 100 cold @ limit=10 → `total = 10` (not 105).
2. **offset>0 subsequent page** — 10 SQLite-page-slice + 100 cold @ offset=10 → `total = 50` (sqliteTotalInRange).
3. **Edge: sqliteTotalInRange == 0** — range entirely older than retention; page 0 fills with 10 cold rows → `total = 10` (= `min(coldRows, limit)`).

All cases also assert `_metadata.coldRows` continues to report the raw cold count (100), and the legacy 3-arg call still returns no `total` field.

## Verification

```
NODE_OPTIONS='--experimental-vm-modules --no-warnings' npx jest tests/scripts/observations-api-server.merge.test.js --no-coverage
```

PASS line (15 tests, 0 fail):

```
Test Suites: 1 passed, 1 total
Tests:       15 passed, 15 total
```

New test names visible in the PASS output:
- `Phase 35-06: paginable total reflects offset=0 cold contribution, not raw cold count`
- `Phase 35-06: paginable total = sqliteTotal when offset > 0 (cold absent on subsequent pages)`
- `Phase 35-06 edge: paginable total = min(coldRows, limit) when sqliteTotalInRange == 0 (range entirely older than retention)`

## Deviations from Plan

### Rule 3 (auto-fix blocking) — server wiring change beyond `Do NOT touch server` guardrail

**Found during:** Task 1 implementation.

**Issue:** The plan's `must_haves.truths` say `_mergeObservations` returns `total = sqliteTotalInRange + min(...)`, AND `Task 1`'s prescribed code uses `limit` and `pageRows` inside the merge module — both of which require inputs the merge module did not previously receive. Simultaneously, the plan's scope guardrails state `Do NOT touch scripts/observations-api-server.mjs - the merge module's exported function signature is unchanged.` These two constraints are mutually exclusive: the merge module cannot compute paginable total without `limit` and `sqliteTotalInRange`, and the server cannot consume a new `total` field from the merge response without being touched.

**Fix:** Implemented the prescribed paginable-total math (Task 1) by adding an **optional 4th `opts` arg** to both merge helpers — additive, non-breaking. Existing 3-arg call sites (all current tests + any future caller that doesn't need paginable total) still work. The minimal server change is restricted to swapping the 2 buggy `total + coldRows` computations for `{limit, offset, sqliteTotalInRange: total}` → `merged.total`. No route handlers, pagination math, or merge algorithm changed.

**Files modified:** `scripts/observations-api-server.mjs` (one new opts object passed at each of 2 call sites; one variable name change `mergedTotal` → `merged.total`).

**Commit:** `5de48c65f`.

**Rationale:** This honors the spirit of the guardrail (no architectural / pagination-math / merge-algorithm change in the server) while making the prescribed code actually work. The plan author's intent was clearly to limit server-side scope creep, not to require an impossible feature.

### Edge-case Jest test added (3rd case beyond plan's 2)

Per the user prompt's instruction: `Add a Jest case for this edge if it isn't already covered by the existing tests.` (Edge: `sqliteTotalInRange == 0` → range entirely older than retention.) Final test count: 15 (12 existing + 3 new) instead of 14.

## Authentication / external gates

None.

## Operator rollout step (`autonomous: false`)

After this plan merges to main, the operator must reload the obs-api process for the new merge module to take effect:

```bash
launchctl kickstart -k gui/$(id -u)/com.coding.obs-api
```

The dashboard backend forwards transparently (35-05's byte-pipe), so no `docker-compose restart` is needed for the frontend to pick up the corrected `total`. Frontend bundle is unaffected.

After kickstart, a probe like:

```bash
FROM_18D=$(date -u -d '18 days ago' +%Y-%m-%dT%H:%M:%SZ)
RESPONSE=$(curl -fs "http://localhost:3032/api/observations?from=${FROM_18D}&limit=50&offset=0")
TOTAL=$(echo "$RESPONSE" | jq -r '.total')
LAST_OFFSET=$(( (TOTAL / 50) * 50 ))
[ "$LAST_OFFSET" -ge "$TOTAL" ] && LAST_OFFSET=$(( LAST_OFFSET - 50 ))
curl -fs "http://localhost:3032/api/observations?from=${FROM_18D}&limit=50&offset=${LAST_OFFSET}" | jq '.data | length'
```

must return `> 0` (non-empty last page).

## Known Stubs

None.

## Self-Check: PASSED

- `scripts/observations-api-merge.mjs` — FOUND, modified (paginable-total accounting added).
- `scripts/observations-api-server.mjs` — FOUND, modified (2 call sites wired).
- `tests/scripts/observations-api-server.merge.test.js` — FOUND, modified (3 new tests added).
- Commit `5de48c65f` (fix) — FOUND in git log.
- Commit `89c4e6cb4` (test) — FOUND in git log.
- Test verification: 15/15 PASS.
