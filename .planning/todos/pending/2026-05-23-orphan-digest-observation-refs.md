---
created: 2026-05-23T00:00:00.000Z
title: 8 digests reference observations missing from both live SQLite and cold-store export
area: observability / data-integrity
surfaced_by: Phase 41 Plan 41-07 human-verify (reproject-online.mjs --resolve-dry-run)
files:
  - src/live-logging/ObservationWriter.js (cold-store writer)
  - .planning/phases/35-observation-digest-retention-with-json-cold-store-fallback/CONTEXT.md
  - .data/observation-export/digests.json
  - .data/observation-export/observations.json
  - .observations/observations.db (live SQLite, 302 rows at survey time)
---

## Problem

`reprojectFromOnlineStore` against `.data/observation-export/*.json` surfaces 8
warnings of the form:

```
orphan-edge-ref: digest <digest-id> references unknown observation <obs-id>
```

Confirmed: the 8 observation IDs are absent from BOTH
`.data/observation-export/observations.json` (the cold-store JSON, per the
Phase 35 retention design) AND `.observations/observations.db` (the live
SQLite hot tier).

Per `docs/puml/obs-retention-flow.puml`, `.data/observation-export/*.json` IS
the cold-store — there is no separate retention storage. So these observations
are genuinely gone from both tiers, but the digests still cite them.

## Hypothesis

The most likely cause is a race between `ObservationPruner` (runs every 1h,
deletes from SQLite when `created_at < retentionBoundary`) and the cold-store
export writer. If the export was taken from a snapshot that omitted these
rows (export written before the rows were ingested, or after they were
pruned but before the next export run), the digest's `obs_ids[]` keeps
referencing the now-unreachable IDs.

A secondary hypothesis: digests may have been generated against in-memory
observation IDs that never made it to the writer due to crash / shutdown
mid-write.

## Sample orphan refs (from 2026-05-22 verify run)

| digest                                  | missing observation                       |
|-----------------------------------------|-------------------------------------------|
| 81ed116f-95ab-4503-915a-9653581d54a1    | b27d69d9-743c-4657-ad4f-f666f250f3ba      |
| 81ed116f-95ab-4503-915a-9653581d54a1    | 967b98b0-60c4-4d9e-bf74-f3e3964ceb28      |
| e9b83828-d81c-4bfa-a2f5-fae7f08a7b57    | 1ec0166d-61c8-4f1c-a40c-fe2cc1cfd3bd      |
| 62b6e23f-1117-4fb6-9e3a-b0719be7c924    | 9f0f49fd-2c30-4bcb-9c43-cf4e7df48827      |
| 9cf10c19-2572-4c2b-a5a1-9581086e5677    | 6faf05b1-17b0-4fb3-949a-89d9c70c3179      |
| fd077132-fad0-4667-8b48-c32c2f77a128    | cbb738f4-03b7-42bd-b080-8fca6232ada8      |
| 2d2866d3-f170-495d-b796-6b3a70f11756    | 0065524f-1f84-47ed-bed7-4175cb3f8115      |
| dbb4c7cd-d50a-4fbf-a9ac-4dcd0fba8712    | d8efb420-058d-46d0-81e4-bec112ef45d2      |

## Impact

Low: `reprojectFromOnlineStore` already handles orphan refs gracefully — the
edge is skipped and the warning is surfaced via the documented `warnings[]`
array. The KM-Core graph stays consistent (no dangling relations).

But: a janitorial fix is desirable to keep the digest payloads honest. If
left unresolved, the orphan ratio will grow each retention cycle.

## Remediation options

1. **Janitor pass** — periodic job that scans digests for orphan refs, drops
   the reference, and rewrites the digest. Runs alongside `ObservationPruner`.
2. **Pruner co-update** — when `ObservationPruner` deletes an observation,
   also scan all digests that cite it and drop the ref atomically.
3. **Export-time scrub** — when the cold-store writer rolls
   `.data/observation-export/digests.json`, filter `obs_ids[]` to those still
   present in `observations.json`. Cheapest, but writes lossy history.
4. **Audit-only** — leave the orphans, add a CI check that fails when count
   exceeds a threshold. Surfaces drift without changing data.

Recommend a `/gsd-plan-phase` to break these down once the v7.1 milestone
(Phases 41–46) closes. Not blocking for KM unification.
