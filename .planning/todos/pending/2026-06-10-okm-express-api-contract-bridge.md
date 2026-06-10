---
created: 2026-06-10T17:10:00.000Z
title: OKM Express ↔ unified-viewer API contract mismatch (/api/entities vs /api/v1/entities)
area: cross-system / km-core
relates_to_phase: 55 (SC-1 follow-up — explicitly out-of-scope of Phase 55 per ROADMAP "Out of scope")
files:
  - integrations/unified-viewer/src/api/ApiClient.ts
  - integrations/unified-viewer/src/lib/system-endpoints.ts
  - _work/okm/  (OKM Express server — confirm path)
  - tests/e2e/unified-viewer/55-okb-routing.spec.ts
  - tests/e2e/unified-viewer/55-entity-sub-tabs.spec.ts (okb test cases)
  - tests/e2e/unified-viewer/55-filters-parity.spec.ts (okb test cases)
---

## Problem

Phase 55 routes `/viewer/okb` to OKM Express on `localhost:8090` (SC-1: route to actual OKM data source). The routing is verified — `OKB tab fetches from localhost:8090 (NOT :3848)` test passes.

However, the unified-viewer's `ApiClient` issues GET requests to `/api/v1/entities` (the Phase 44 km-core canonical contract), while OKM Express at `:8090` serves the legacy non-versioned path `/api/entities`. Concrete state on 2026-06-10:

```
GET http://localhost:8090/api/v1/entities  → 404 "Cannot GET /api/v1/entities"
GET http://localhost:8090/api/entities     → 200 {"success":true,"data":[...RaaS entities...]}
```

Result: the OKB graph loads zero nodes against a live OKM Express, so OKB-side feature tests can't select a node and the structural-but-data-dependent assertions time out. 2 of the 36 Phase 55 E2E tests fail purely for this reason:

- `55-entity-sub-tabs.spec.ts:168` — `/viewer/okb: Markdown tab renders EntityIdentityHeader`
- `55-filters-parity.spec.ts:51` — `/viewer/okb: OntologyFilter shows Upper + Lower triangle groups`

## Why this isn't a Phase 55 regression

Phase 55's ROADMAP block explicitly carves this out under *Out of scope*:

> The "what data should OKB tab actually show" architectural question — that's part of SC-1, but if the operator chooses "mirror OKM data into coding's km-core" instead of "proxy to :8090", a separate phase covers the mirror pipeline.

Phase 55 ships the route. The contract reconciliation is the follow-up.

## Two viable approaches

**Option A — ApiClient path-rewrite for `system=okb`.** When the active system is `okb`, rewrite `/api/v1/entities[/...]` → `/api/entities[/...]` at the ApiClient layer (or via system-endpoints overlay). Low touch on the unified viewer; OKM Express stays untouched. Risk: drift between km-core's canonical shape and OKM Express's response shape (e.g. envelope `{success, data}` vs flat array) — needs a response adapter too.

**Option B — Add Phase 44 contract adapter to OKM Express.** Mount `/api/v1/entities` etc. on OKM Express, internally delegating to the legacy `/api/entities` handler with shape normalization to Phase 44's `KmCoreEntity` shape. Closer to "one canonical km-core contract everywhere"; aligns OKM Express with the rest of v7.1 KM-Core Unification.

**Option C (deferred per ROADMAP):** Mirror OKM data into coding's km-core. Heavier; only attractive if the operator wants OKB tab queryable offline.

Option B is the strategic choice if the v7.1 milestone closes with "one km-core contract"; Option A is the tactical close if OKM Express is on its way out.

## Suggested first step

1. Read OKM Express routes + response shape (path: likely `_work/okm/` or `rapid-automations/OKM`).
2. Diff the `/api/entities` response shape against `KmCoreEntity` in `integrations/unified-viewer/src/api/ApiClient.ts:19`.
3. Pick Option A vs Option B based on shape distance + OKM Express ownership.
4. Implement, then re-run `npx playwright test tests/e2e/unified-viewer/55-{entity-sub-tabs,filters-parity}.spec.ts -g "okb"` — both should pass without spec edits.

## Why this matters

Without this bridge, the OKB tab in the unified viewer renders an empty graph against live OKM data, which is what SC-1 was meant to prevent at the UX level. Phase 55's structural work is done; this is the data wiring that makes "OKB users can migrate without losing functionality" actually true.
