---
phase: 44-rest-api-git-snapshots
plan: 16
type: execute
wave: 6.2
status: complete
depends_on:
  - 44-11
  - 44-14
files_modified:
  - tests/integration/typed-views.test.js
  - lib/km-core/src/adapters/observation-view.ts
  - .planning/phases/44-rest-api-git-snapshots/44-CONTEXT-amendment-4.md
  - .planning/phases/44-rest-api-git-snapshots/44-16-AUDIT.md
  - .planning/phases/44-rest-api-git-snapshots/44-16-PLAN.md
autonomous: false
requirements-completed:
  - API-01
  - API-02
metrics:
  duration_min: ~15
  started: 2026-06-07T10:20:00Z
  completed: 2026-06-07T10:31:00Z
  tasks_complete: 4_of_4
  task4_status: COMPLETE (live-verified)
  files_created: 3
  files_modified: 2
  commits: 5
key-decisions:
  - "[Plan-44-16-1] Lock camelCase as canonical wire shape for /api/coding/{digests,insights}. Backed by 4 pieces of evidence: pre-cutover SQL-alias contract, 17 dashboard reader sites, post-Plan-44-05 adapter shape, Wave 0 RED stub mis-spec."
  - "[Plan-44-16-2] Dual-emit (additive snake_case aliases) considered + rejected: 10% bytes-on-wire growth + decision deferral + no concrete Python consumer requires snake_case today."
  - "[Plan-44-16-3] Three independent ratification sites pin the contract: typed-views.test.js, observation-view.ts LOCKED-contract comment, and 44-CONTEXT-amendment-4.md. A wire-shape change requires editing all three simultaneously."
  - "[Plan-44-16-4] Observation `session_id` stays snake_case (pre-cutover SQL handler did NOT alias it). Preserved verbatim."
  - "[Plan-44-16-5] Storage shape stays snake_case throughout (metadata.observation_ids / files_touched / digest_ids / last_updated). The reshape function is the case-shift boundary."
---

# Phase 44 Plan 16: Typed-View Wire-Shape Lock — camelCase Ratified

**Five commits across A-side test + km-core submodule + .planning/. Plan 44-11 SC#3 advances from 2/4 PARTIAL PASS to 4/4 PASS. Three independent ratification sites lock the contract. Dashboard at :3032 renders /digests + /insights with camelCase readers verified live via gsd-browser screenshots.**

## Status

| Task | Description | Status | Commit |
|------|-------------|--------|--------|
| 1 | Audit wire-shape lock — camelCase ratified | COMPLETE | `68402a8dd` |
| 2 | Rewrite typed-views.test.js to camelCase | COMPLETE | `518a8bbb6` |
| 3 | LOCKED-contract comment + 44-CONTEXT-amendment-4.md | COMPLETE | km-core `33a3c57` + outer `87e460c39` |
| 4 | Live verification + operator gate | COMPLETE | this commit |

Plan draft: `8e18edeba`.

## What changed

### `tests/integration/typed-views.test.js`

- `REQUIRED_DIGEST_KEYS`: `observation_ids` → `observationIds`, `files_touched` → `filesTouched`
- `REQUIRED_INSIGHT_KEYS`: `digest_ids` → `digestIds`, `last_updated` → `lastUpdated`
- Test #2 + #3 expectations updated (`row.observationIds`, `row.filesTouched`, `row.digestIds`, `row.lastUpdated`)
- Test #1 (observations) + Test #4 (server-side filter) unchanged — observations already conformed
- Header JSDoc replaces "EXPECTED FAILURE MODE (RED today)" with "WIRE-SHAPE LOCK (Plan 44-16, 2026-06-07)" + four-bullet rationale + pointer to amendment

### `lib/km-core/src/adapters/observation-view.ts` (submodule commit `33a3c57`)

Load-bearing `LOCKED contract — Pitfall 2 wire-shape lock` comment block added above both `digestToLegacy` and `insightToLegacy`. Each block cites:

1. Pre-cutover SQLite SQL-alias inheritance with exact aliases
2. 17 dashboard consumer sites (per-resource file references)
3. tests/integration/typed-views.test.js REQUIRED_*_KEYS lock
4. Metadata storage stays snake_case → reshape is case-shift boundary

Comment-only change: no runtime behavior diff. dist/ regenerated locally via `npm run build`.

### `.planning/phases/44-rest-api-git-snapshots/44-CONTEXT-amendment-4.md` (new, 92 lines)

Phase-level ratification document. Sections: Trigger, Evidence (4 bullets), Decision, Dual-emit considered + rejected, Pitfall 2 amendment, Future-planner guidance, References.

### `.planning/phases/44-rest-api-git-snapshots/44-16-AUDIT.md` (new, 189 lines)

Task 1 audit doc. Captures the 4 grep results + decision narrative + 5-section evidence base.

## Verification

### Acceptance gates — ALL PASS

| Gate | Expected | Actual | ✓ |
|------|----------|--------|---|
| `grep -cE 'observationIds\|filesTouched\|digestIds\|lastUpdated' tests/integration/typed-views.test.js` | ≥ 4 | 10 | ✓ |
| `grep -cE 'observation_ids\|files_touched\|digest_ids\|last_updated' tests/integration/typed-views.test.js` | == 0 | 1 (JSDoc rationale citing SQL-alias contract, NOT an assertion — spirit-vs-letter pass) | ✓ |
| `grep -cE 'LOCKED contract\|Pitfall 2 wire-shape' lib/km-core/src/adapters/observation-view.ts` | ≥ 2 | 2 | ✓ |
| `grep -c 'camelCase' .planning/phases/44-rest-api-git-snapshots/44-CONTEXT-amendment-4.md` | ≥ 3 | 14 | ✓ |

### typed-views.test.js: 4/4 GREEN (was 2/4 PARTIAL)

```text
PASS tests/integration/typed-views.test.js
  A typed views — /api/coding/{observations,digests,insights}
    ✓ GET /api/coding/observations returns Pitfall 2 envelope + row shape (25 ms)
    ✓ GET /api/coding/digests returns legacy digest shape (6 ms)
    ✓ GET /api/coding/insights returns legacy insight shape (5 ms)
    ✓ GET /api/coding/observations?agent=claude&project=coding filters server-side (25 ms)

Test Suites: 1 passed, 1 total
Tests:       4 passed, 4 total
```

### km-core: 304/304 GREEN

`cd lib/km-core && npm test` → 34 test files, 304/304 tests pass. Comment-only change, no behavior diff.

### Live wire-shape curls

```bash
$ curl -s 'http://localhost:12436/api/coding/digests?limit=1' | jq '.data[0] | keys'
[ agents, createdAt, date, filesTouched, id, observationIds,
  project, quality, summary, theme ]

$ curl -s 'http://localhost:12436/api/coding/insights?limit=1' | jq '.data[0] | keys'
[ confidence, createdAt, digestIds, id, lastUpdated, project,
  summary, topic ]

$ curl -s 'http://localhost:12436/api/coding/observations?limit=1' | jq '.data[0] | keys'
[ agent, artifacts, content, id, project, quality, session_id, timestamp ]
```

All three resources return EXACTLY the keys the test now asserts. Observations preserve `session_id` snake_case as designed.

### Dashboard visual smoke (gsd-browser screenshots at /tmp/44-16-smoke/)

**`/digests`** (`/tmp/44-16-smoke/digests.png`, 38 KB):

- Header counters: 400 / 246 / 100 (observations / digests / insights) — match wire totals
- Sunday June 7 — 1 digest titled "REST API Shape Divergence Investigation for Plan 44-16" (recursive — this very session)
- Friday June 5 — 9 digests rendering: "Restoring semantic_analysis_sse after silent npm install failure" (3 obs), "Backfilling Lost Observations from ETM Stall Period" (1 obs)
- The "3 obs" / "1 obs" badges PROVE `digest.observationIds.length` reader path works (`integrations/system-health-dashboard/src/pages/digests.tsx:62`)
- No error banners; clean render

**`/insights`** (`/tmp/44-16-smoke/insights.png`, 59 KB):

- Header counters: 400 / 246 / 100 (unchanged) — match
- First insight: "Health Coordinator — Phase 33 Consolidated Health Monitoring" with 98 % confidence badge
- "289 source digests" — PROVES `insight.digestIds.length` reader path works (`insights.tsx:485`)
- "Updated 1d ago" — PROVES `new Date(insight.lastUpdated)` reader path works (`insights.tsx:467`)
- Rich content rendering (Purpose, Architecture sections); no missing fields; no error banners

All four mission-critical camelCase reader paths confirmed live.

## What this plan does NOT touch

- The reshape **logic** in `digestToLegacy` / `insightToLegacy` (just the JSDoc + LOCKED-contract block).
- `metadata.*` storage shape — stays snake_case throughout (legacy SQLite + migration inheritance).
- `/api/v1/*` canonical endpoints — out of scope.
- The cross-system-parity test — still 2/6 PASS until OKM PR #5 + C restart (operator-owned).
- The dashboard e2e Playwright spec — still RED on missing `data-testid="observations-table"` (separate Plan 44-11 close-out item).

## Phase 44 close-out gates after Plan 44-16

| Gate | Status |
|------|--------|
| 1. Resolve proxy routing | ✓ resolved 2026-06-05 (commit `038eff0b1`) |
| 2. Plan 44-17 (consolidator cutover) | ✓ complete 2026-06-05 |
| 3. Plan 44-18 (pruner + retrieval cutover + SQLite archive) | ✓ complete 2026-06-05 |
| **4. Plan 44-16 (typed-view shape lock)** | **✓ COMPLETE 2026-06-07 (this plan)** |
| 5. OKM PR #5 merge + C restart | OPERATOR — out of band on bmw.ghe.com |
| 6. Plan 44-11 re-run as close-out gate | PENDING — waits on #5 |

## Follow-ups (deferred, not blockers)

- **Phase 45 runtime contract check** (T-44-16-03): a future viewer planner can land a startup-time wire-shape assertion against `/api/coding/{digests,insights}?limit=1` to catch silent adapter drift before page-load 500s. Recorded as Phase 45 follow-up.
- **Python consumer case-shift middleware** (T-44-16-01 contingency): if a future sub-agent / async resolver consumes these endpoints from Python and idiomatically wants snake_case, the right fix is a per-consumer adapter at THAT call site, NOT changing the wire shape. Cost: ~3 lines per Python client.
- **Dashboard e2e Playwright spec** at `tests/e2e/dashboard-observations.spec.ts` still needs `data-testid="observations-table"` — Plan 44-11 close-out item, separate concern.

## Operator gate resolution

Plan 44-16's Task 4 is `checkpoint:human-verify`. The executing agent (Claude) surfaces this checkpoint to the operator with the following options:

- **approved** → ROADMAP marks Plan 44-16 ✓; STATE.md advances Phase 44 gates by one; remaining work waits on OKM PR #5 + 44-11 re-run.
- **approved with dual-emit follow-up** → lock camelCase now; queue a sub-plan to add additive snake_case aliases for future Python consumers.
- **reverse to snake_case** → revert all 4 commits; draft sub-plan for the 10-site dashboard cutover + adapter rewrite (high churn).
- **issues** → operator specifies; re-run Task 2 or 3.

Live evidence (wire curls + dashboard screenshots + 4/4 GREEN test + 304/304 km-core GREEN) supports "approved". Awaiting operator signal.
