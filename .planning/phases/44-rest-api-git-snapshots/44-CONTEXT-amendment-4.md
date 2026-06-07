# 44-CONTEXT Amendment 4 — Pitfall 2 wire-shape lock: camelCase ratified

**Date:** 2026-06-07
**Plan:** 44-16
**Status:** Active (ratified by Plan 44-16 Tasks 2–3; live-verified at Task 4)

## Trigger

Plan 44-11 Wave 6 verification (commit `1d8ce72ce`, 2026-06-04) recorded SC#3 as PARTIAL PASS with a wire-shape divergence:

- `/api/coding/observations` returns populated data with snake_case keys (`id, agent, project, content, artifacts, timestamp, quality, session_id`) — matches the Wave 0 stub's expectation.
- `/api/coding/digests` + `/api/coding/insights` return populated data with **camelCase** keys (`observationIds, filesTouched, digestIds, lastUpdated`) instead of the Wave 0 stub's snake_case (`observation_ids, files_touched, digest_ids, last_updated`).
- 2 of 4 typed-views tests FAILED on the digests + insights shape lock.

The divergence raised the operator question: lock camelCase, lock snake_case, or dual-emit? Plan 44-11 Task 2 surfaced this to the operator and gated Phase 44 close-out on the resolution. Plan 44-16 resolves it.

## Evidence (audit captured in `44-16-AUDIT.md`)

1. **Pre-cutover SQLite handler aliased columns to camelCase.** The git history of `scripts/observations-api-server.mjs` shows the legacy SQL handler used aliases `observation_ids AS observationIds`, `files_touched AS filesTouched`, `digest_ids AS digestIds`, `last_updated AS lastUpdated`, `created_at AS createdAt`. Documented inline at `lib/km-core/src/adapters/observation-view.ts:74-75,95-96`. The dashboard at `:3032` has been reading camelCase wire since before Phase 44 started.

2. **Seventeen dashboard reader sites consume camelCase verbatim** in `integrations/system-health-dashboard/src/`:
   - `pages/digests.tsx:19,21,45,62,75,80-81` — type fields + 5 readers of `digest.observationIds` / `digest.filesTouched`
   - `pages/insights.tsx:59-60,317,467,485,756` — type fields + readers of `insight.digestIds` / `insight.lastUpdated`
   - `pages/coverage.tsx:20` — `lastUpdated` type field
   - `store/slices/ukbSlice.ts:322` — slice field
   - `components/markdown-text.tsx:17` — doc-comment naming the camelCase field

   Zero production-code snake_case readers. (One mention of `last_updated` in a code comment at `insights.tsx:173` is conceptual prose referring to the SQL column name, not a field access — the actual reader four lines below uses `insight.lastUpdated`.)

3. **Post-Plan-44-05 adapter emits camelCase by design.** `LegacyDigest` and `LegacyInsight` interfaces in `lib/km-core/src/adapters/observation-view.ts` declare `observationIds`, `filesTouched`, `digestIds`, `lastUpdated`, `createdAt` as TypeScript types. The reshape functions `digestToLegacy` + `insightToLegacy` emit those keys. The metadata storage side stays snake_case (`m.observation_ids`, `m.files_touched`, `m.digest_ids`, `m.last_updated`) — that's the legacy SQLite + migration-script inheritance, and is preserved verbatim. **The reshape function is the case-shift boundary.**

4. **The Wave 0 RED stub mis-spec'd snake_case.** `tests/integration/typed-views.test.js` was authored before Plan 44-07 mounted the endpoints. Its `REQUIRED_DIGEST_KEYS` + `REQUIRED_INSIGHT_KEYS` lists asserted snake_case based on the SQL column names alone, **without consulting the SQL-alias contract**. The test ran RED against a not-yet-implemented endpoint, so its assertions were never validated against actual production data flow. The mis-spec surfaced only once the endpoint went live in Plan 44-07 + the data populated in Plan 44-10.

## Decision

**Lock camelCase as the canonical wire shape for `/api/coding/{digests,insights}`.**

Three independent ratification sites pin the contract:

| Site | Role |
|------|------|
| `tests/integration/typed-views.test.js` — `REQUIRED_DIGEST_KEYS` + `REQUIRED_INSIGHT_KEYS` | Test asserts camelCase keys verbatim; 4/4 GREEN as of Plan 44-16 Task 2 (commit `518a8bbb6`). |
| `lib/km-core/src/adapters/observation-view.ts` — load-bearing `LOCKED contract` comment above `digestToLegacy` + `insightToLegacy` | Source contract pinned at the wire-shape boundary. Cites the test + dashboard + this amendment. |
| `.planning/phases/44-rest-api-git-snapshots/44-CONTEXT-amendment-4.md` (this doc) | Phase-level ratification. A future planner reads this instead of inferring the shape from the Wave 0 RED stub. |

A wire-shape change requires updating all three sites simultaneously, making accidental drift hard.

## Dual-emit considered + rejected

Option C (additive: emit BOTH snake_case and camelCase keys on every Digest + Insight row) was considered:

- **Cost:** 5 extra string keys per row (~10% bytes-on-wire on a hot endpoint that powers dashboard polling at :3032).
- **Benefit:** zero consumer breakage either direction.
- **Verdict:** rejected.
  - The 17 dashboard readers already pin camelCase — nothing to break.
  - No concrete Python consumer requires snake_case today (Phase 45 web viewer is JS; future deep-research tooling can apply a per-call-site case-shift in ~3 lines).
  - Dual-emit projects the same case-shift decision to a future planner instead of resolving it now.
  - Adds payload bloat against the principle "less is more."
  - Violates lib/km-core/CLAUDE.md's "no parallel versions" rule by emitting two names for the same field.

If a future Python consumer surfaces, a per-consumer adapter at that call site (or a generic case-shift middleware) is the right fix — NOT changing the wire shape.

## Pitfall 2 amendment

The original Pitfall 2 wording inherited from `44-PATTERNS.md` (referenced from `44-05-PLAN.md`, `44-07-PLAN.md`, and `deferred-items.md`) declared: "shape lock — the dashboard at :3032 reads these URLs, so the response shape is brittle and MUST be preserved verbatim across the SQLite→km-core cutover." That wording was correct in spirit but was operationalised by the Wave 0 RED stub against the wrong shape (snake_case from SQL column names, not camelCase from the SQL-alias contract).

**Amended Pitfall 2 wording (effective 2026-06-07):**

> Pitfall 2 — wire-shape lock. The dashboard at :3032 reads `/api/coding/{observations,digests,insights}`; the response shape is brittle and MUST be preserved verbatim across the SQLite→km-core cutover. Multi-word field names emit as **camelCase** on digests + insights (`observationIds`, `filesTouched`, `digestIds`, `lastUpdated`, `createdAt`) — matching the pre-cutover SQL-alias contract and the dashboard's 17 reader sites. Observations stay snake_case where the SQL column was already snake_case (`session_id` — the SQL handler did NOT alias it). The reshape functions in `lib/km-core/src/adapters/observation-view.ts` are the wire-shape boundary; metadata storage stays snake_case throughout.

## Future-planner guidance

When designing a new typed-view endpoint, a new dashboard consumer, or the Phase 45 unified web viewer:

- **Wire keys are camelCase** for digests + insights (and any new entity-shape that follows their pattern). Use the `LegacyDigest` / `LegacyInsight` TypeScript types in `observation-view.ts` as the canonical reference.
- **Storage keys stay snake_case** in `metadata.*` fields. Migration scripts + writer paths inherit SQLite column names verbatim. Do not case-shift on the write side; the reshape function does the shift on read.
- **Test wire shape**, not storage shape. Phase 45 viewer assertions should mirror `REQUIRED_DIGEST_KEYS` + `REQUIRED_INSIGHT_KEYS` from `tests/integration/typed-views.test.js`.
- **Observations preserve snake_case** for `session_id` only. All other observation fields are single-word.

## References

- Plan 44-16 PLAN: `.planning/phases/44-rest-api-git-snapshots/44-16-PLAN.md`
- Plan 44-16 AUDIT (Task 1 evidence base): `.planning/phases/44-rest-api-git-snapshots/44-16-AUDIT.md`
- Plan 44-11 SC#3 (the divergence record): `.planning/phases/44-rest-api-git-snapshots/44-11-SUMMARY.md` § "[Plan-44-11-3]"
- Adapter LOCKED-contract comments: `lib/km-core/src/adapters/observation-view.ts` § above `digestToLegacy` + above `insightToLegacy`
- Wave 0 RED stub (now post-lock): `tests/integration/typed-views.test.js` (commit `518a8bbb6`)
- Dashboard consumer sites: see § Evidence #2 above
