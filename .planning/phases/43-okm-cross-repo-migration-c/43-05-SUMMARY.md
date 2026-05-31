---
phase: 43-okm-cross-repo-migration-c
plan: 05
subsystem: api
tags: [okm, resolve-entities, km-core, maintenance, rest-contract, deduplicator]

requires:
  - phase: 43-okm-cross-repo-migration-c
    provides: Plan 04 verification (OKM consumes @fwornle/km-core/ontology; vendor tarball repacked); Plan 02 vendor tarball
  - phase: 41-online-learning-adapter-post-hoc-resolution
    provides: km-core's resolveEntities maintenance op (D-50, originally ported from OKM's impl)
  - phase: 40-layered-dedup
    provides: km-core's LLMSemanticMatcher (D-44 / Plan 40-04)

provides:
  - POST /api/cleanup/resolve-entities now routes through km-core's resolveEntities (single source of truth for post-hoc entity resolution)
  - OKM's parallel impl deleted: pipeline.resolveEntities, deduplicator.resolveEntities, batchLLMResolution, migrateEdges (~339 lines from deduplicator.ts)
  - REST response shape preserved byte-identical (D-G5.1 contract lock-in via Plan 06 fixtures-diff)

affects: [43-06-rest-fixtures-lock, 43-07-json-replay, 43-08-storage-cutover]

tech-stack:
  added: []
  patterns:
    - "Cross-repo function delegation: OKM route handler instantiates km-core's LLMSemanticMatcher with OKM's @rapid/llm-proxy LLMService (structurally compatible) + calls @fwornle/km-core/maintenance resolveEntities"
    - "REST contract preservation by reshape: helper transforms km-core's merge rows (raw EntityIds + confidence) back to OKM's REST contract (${layer}:${id} survivorId/duplicateId + no confidence) via a pre-resolve id->layer snapshot"
    - "Interim adapter mirror (Plan 08 removes): km-core mutates kmStore directly; route helper observes 'merge' log events and mirrors deletions + survivor refreshes to the IGraphStore adapter's in-memory graph so subsequent OKM read paths see a consistent view"

key-files:
  created: []
  modified:
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/api/routes.ts (+165 / -1 net; added runEntityResolution helper + km-core/LLMSemanticMatcher/GraphKMStoreAdapter imports + rewrote private resolveEntities route handler + swapped the RCA batch-ingestion caller)
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/ingestion/pipeline.ts (-14 net; deleted resolveEntities wrapper; made deduplicator field public readonly so the route handler can call synthesizeDescriptions)
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/ingestion/deduplicator.ts (-339 net; deleted resolveEntities + batchLLMResolution + migrateEdges — all three were a unit, the latter two only callable from resolveEntities)
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/store/km-store-adapter.ts (1 line — `private readonly kmStore` → `public readonly kmStore` so the route can hand the GraphKMStore to km-core's resolveEntities)

  unmodified-as-expected:
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/api/server.ts (D-G2.4 mount + kmStore createServer param were ALREADY ABSENT as of Plan 04's checkout state — the Phase 44 leak referenced in PATTERNS.md never landed in OKM-side baseline)
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/index.ts (no createServer trailing-arg drop needed since createServer never had the param)

key-decisions:
  - "Keep OKM-side description synthesis as a POST-step instead of dropping it. km-core's resolveEntities does NOT synthesize survivor descriptions — that's an OKM-specific behavior (collapses pipe-separated segments into a non-redundant single description via LLM). Dropping it would have meant losing real OKM functionality AND drifting the synthesizedCount field of the REST response to always zero. Decision: keep synthesize via pipeline.deduplicator.synthesizeDescriptions(adapter, survivorNodeIds) after km-core returns. Preserves behavior; preserves REST shape; aligns with the plan's 'OKM-specific bits before/after the call, not woven into the loop' guidance (even though synthesize is post-step, not pre-step, the spirit is the same)."
  - "Mirror km-core's kmStore mutations back to the IGraphStore adapter via observed merge events instead of full re-hydrate. km-core's resolveEntities mutates kmStore directly via mergeEntities; the IGraphStore adapter's in-memory graph would stale otherwise. Options were (a) full re-init via adapter.initialize() — O(N) cost, leaves stale node removals because initialize merges new state but doesn't delete absent nodes; (b) observe merge events via the resolve `log` callback and surgically mirror deletes + survivor updates. Chose (b). Cost is O(merges) not O(N), and deletes are correct. Plan 08 deletes the adapter entirely, removing the mirror step."
  - "Exposed GraphKMStoreAdapter.kmStore and IngestionPipeline.deduplicator as public readonly instead of adding new wiring through createServer / ApiRoutes constructor. The plan's Task 1 grep gate explicitly bans `kmStore?: GraphKMStore` in createServer signature, so threading kmStore through createServer was off-limits. The cleanest alternative was the public-field exposure pattern: the route handler can reach kmStore via `this.store instanceof GraphKMStoreAdapter ? this.store.kmStore : ...`. Plan 08 will replace this.store with the GraphKMStore directly, eliminating the cast."
  - "Lifted both in-tree callers (HTTP route handler + RCA batch ingestion's post-store entity-resolution step) into a single private helper `runEntityResolution(opts)`. The plan envisioned the route handler being the only caller; the RCA path (`routes.ts:2486` pre-edit → `2643` post-edit) also depended on pipeline.resolveEntities and its `{merges, synthesizedCount, errors}` shape. Factoring into one helper preserves both call sites with the same OKM-shape contract, avoids duplication, and leaves a single Plan 08 touch-point for the eventual IGraphStore removal."

patterns-established:
  - "Wrap caller-supplied LLMService into km-core's LLMSemanticMatcher (or any LLMClient-typed component) without an adapter class — OKM's @rapid/llm-proxy LLMService is structurally compatible with km-core's LLMClient (`complete(req): Promise<{content,...}>`). Pass it as `new LLMSemanticMatcher({ client: llmService, threshold: 0.70 })` and TypeScript's structural typing accepts the LLMService (its broader signature is a supertype of LLMClient's narrower one)."
  - "Snapshot id->layer BEFORE calling km-core ops that mutate a kmStore, so the response-shape translator can recover layer-qualified nodeIds for survivors AND duplicates after the duplicate entities are gone. The same snapshot doubles as the source-of-truth for adapter-mirror deletion targets."

requirements-completed: [INT-03]

duration: 45min
completed: 2026-05-31
---

# Phase 43 Plan 05: cleanup-resolve routing + /api/km revert

**POST /api/cleanup/resolve-entities now calls km-core's `resolveEntities` (from `@fwornle/km-core/maintenance`). OKM's parallel impl deleted (~339 lines from deduplicator.ts). REST response shape byte-identical via a reshape helper. /api/km mount + createServer's kmStore param were already gone, so D-G2.4 needed no edits.**

## Performance

- **Duration:** ~45 min (15 min route-handler design + 10 min impl + 5 min build/test + 10 min commits + 5 min SUMMARY)
- **Completed:** 2026-05-31T12:40Z
- **Tasks:** 3 explicit; Task 1 was a verify-only no-op (the leak this plan was reverting was already absent)
- **Files modified in OKM:** 4 (`src/api/routes.ts`, `src/ingestion/pipeline.ts`, `src/ingestion/deduplicator.ts`, `src/store/km-store-adapter.ts`)
- **Net LoC:** -196 (+165 routes, -14 pipeline, -339 deduplicator, +1/-1 adapter ⇒ -196 net)

## Accomplishments

- **D-G2.3 — Route /api/cleanup/resolve-entities to km-core:**
  - Route handler shrunk to a thin wrapper around `runEntityResolution({dryRun, classes, runId?})`.
  - Helper constructs km-core's `LLMSemanticMatcher({client: this.llmService, threshold: 0.70})`, calls `kmCoreResolveEntities(kmStore, {llmMatcher, provenance, classes, dryRun, concurrency: 3, batchSize: 30, log})`.
  - Concurrency=3, batchSize=30 preserved as literal constants (OKM's RESOLUTION_CONCURRENCY + BATCH_SIZE).
  - Provenance: `{provider: 'okm', model: 'cleanup', runId: opts.runId ?? `okm-cleanup-${Date.now()}`, timestamp}`.
- **OKM-side synthesis preserved:** After km-core returns, helper calls `this.pipeline.deduplicator.synthesizeDescriptions(adapter, survivorNodeIds)` on the merged survivors. `synthesizedCount` field in REST response stays meaningful (not zero).
- **REST contract preservation:**
  - Helper reshapes km-core's merge rows back to OKM's contract: prepends `${layer}:` to survivorId/duplicateId via a pre-resolve id->layer snapshot; drops `confidence` field.
  - HTTP response stays byte-identical: `{ dryRun, mergeCount, synthesizedCount, merges, errors }`.
- **Adapter mirror (interim shim):** km-core mutates kmStore directly; helper observes `merge` log events and mirrors deletions (`adapter.deleteEntity`) + survivor refreshes (`adapter.updateEntity` with `kmStore.getEntity()` payload) back to the IGraphStore adapter. Plan 08 will delete this adapter and the mirror step.
- **Single helper for both callers:** HTTP route at `routes.ts:624` (pre-edit `635` → post-edit ~`790`) AND RCA batch path at `routes.ts:2486` (post-edit `2643`) both call `runEntityResolution`. No code duplication.
- **D-G2.4 — Revert /api/km mount + drop kmStore createServer param:**
  - Verification only: the mount + kmStore param were ALREADY ABSENT from `src/api/server.ts` as of Plan 04's checkout state. The Phase 44 leak referenced in PATTERNS.md never landed in OKM-side baseline. All three Task 1 acceptance grep gates returned 0 without edits.
- **Deletions:**
  - `pipeline.resolveEntities` (was lines 353-367, pure delegation)
  - `deduplicator.resolveEntities` (was lines 620-824, ~205 lines)
  - `deduplicator.batchLLMResolution` (was lines 836-905, ~70 lines — only called by resolveEntities)
  - `deduplicator.migrateEdges` (was lines 910-933, ~24 lines — only called by resolveEntities)
  - Plus the section header comment at line 595.
- **Build clean** (`npm run build` exits 0).
- **Test suite at baseline** (493/495 passing — matches Plan 04 baseline; same 2 failures + 7 file-load errors that reference non-existent `src/llm/providers/`).

## Captured Pre-Edit REST Response Shape (D-G5.1 fixtures cross-reference)

The HTTP response from `POST /api/cleanup/resolve-entities` (post-`sendSuccess` wrap) is:

```json
{
  "success": true,
  "data": {
    "dryRun": boolean,
    "mergeCount": number,
    "synthesizedCount": number,
    "merges": [
      {
        "survivorId": "evidence:<uuid>" | "pattern:<uuid>",
        "survivorName": string,
        "duplicateId": "evidence:<uuid>" | "pattern:<uuid>",
        "duplicateName": string,
        "ontologyClass": string
      }
    ],
    "errors": [string]
  }
}
```

The new helper produces the same shape. **Differences from km-core's native shape (translated by the helper):**

| Field | km-core native | OKM REST (preserved) |
|-------|---------------|----------------------|
| `survivorId` | raw EntityId (UUID, no prefix) | `${layer}:${EntityId}` |
| `duplicateId` | raw EntityId (UUID, no prefix) | `${layer}:${EntityId}` |
| `confidence` | per-merge float | **dropped** |
| `synthesizedCount` | (absent) | OKM-side post-step result |
| `runId` | echo of opts.provenance.runId | (absent — not in OKM contract) |
| `classesScanned` | string[] (post-default resolution) | (absent — not in OKM contract) |
| `durationMs` | wall-clock | (absent — not in OKM contract) |
| Wrap | bare result object | `{success: true, data: {...}}` (OKM's sendSuccess) |

Plan 06 fixtures will record the OKM-shape payload exactly as above — no drift expected. If Plan 06 fixtures-diff surfaces drift, the helper's reshape function is the single touch-point.

## OKM-Specific Preprocessing Lifted

**None found / none lifted.** The OKM impl had no PII pre-scan or sourceAuthority filtering at the resolveEntities entry point (those concerns live earlier in the ingestion pipeline, not at the resolution boundary). The classes filter was the only pre-step — passed through directly as `opts.classes` to km-core.

The OKM-specific bit retained is the POST-step description synthesis (see "Accomplishments" above), kept OKM-side because km-core's maintenance scope deliberately stops at `mergeEntities` per Plan 41 D-50.

## Task Commits

**OKM inner repo** (`bmw.ghe.com/.../operational-knowledge-management`):

1. **`0f08980`** — `refactor(api): route /api/cleanup/resolve-entities to km-core; preserve OKM REST shape (Phase 43 D-G2.3, D-G2.4)`
   - 4 files changed, 167 insertions / 363 deletions

**Outer rapid-automations** (`bmw.ghe.com/.../rapid-automations`):

2. **`f827671`** — `chore: bump OKM submodule — Phase 43 Plan 05 (cleanup-resolve routing + /api/km revert)`
   - 1 file changed (gitlink bump `701574e → 0f08980`)

## Deviations from Plan

**1. Task 1 (D-G2.4) was a verify-only no-op — the leak it was reverting was already absent.**
- **Found during:** Initial pre-flight read of `src/api/server.ts`.
- **Discovery:** All three Task 1 acceptance grep gates returned 0 BEFORE any edit: no `app.use('/api/km', ...)`, no `createKMRouter` import, no `kmStore?: GraphKMStore` in the createServer signature. Last commit on server.ts was Plan 04's import swap (`701574e`).
- **Hypothesis:** The Phase 44 leak referenced in PATTERNS.md was likely scoped to a working tree / stash that never landed in OKM-side baseline. Plan 02's stash mentioned in Plan 04 SUMMARY may have contained the Phase 44 wiring without it actually being committed.
- **Impact on plan:** Task 1 acceptance verified by grep; no edits needed. SUMMARY documents the absence honestly.

**2. Description-synthesis post-step retained (not part of explicit plan text, but spirit-preserving).**
- **Found during:** Designing the route handler.
- **Issue:** km-core's resolveEntities does NOT synthesize survivor descriptions. The OKM impl did (the now-deleted resolveEntities called `synthesizeDescriptions` on survivors at line 814). Dropping it would have (a) lost real OKM behavior — accumulating pipe-separated segments on every merge with no collapse, and (b) drifted the `synthesizedCount` REST field to always zero, breaking byte-identical preservation.
- **Fix:** Helper invokes `this.pipeline.deduplicator.synthesizeDescriptions(adapter, survivorNodeIds)` AFTER km-core returns. Required exposing `IngestionPipeline.deduplicator` as `public readonly`.
- **Impact on plan:** Aligns with the plan's guidance ("OKM-specific bits applied before/after the call to km-core, not woven into the resolve loop"). Plan text mentioned PII / sourceAuthority as pre-step examples; synthesize is the post-step analogue.

**3. RCA batch-ingestion path (the second in-tree caller) was refactored to use the same helper.**
- **Found during:** TypeScript surface after deletion — `npx tsc --noEmit` flagged `routes.ts:2486` (pre-edit) as a second caller of the deleted `pipeline.resolveEntities`.
- **Issue:** The plan focused on the HTTP route handler; the RCA path also depended on the deleted method's `{merges, synthesizedCount, errors}` shape (it uses all three fields for logging and merge-count aggregation).
- **Fix:** Both callers go through `runEntityResolution({dryRun, classes?, runId?})`. RCA path uses `dryRun: false` (matches its prior `resolveEntities(false)` call).
- **Impact on plan:** No scope creep — the plan REQUIRED zero remaining `pipeline.resolveEntities` callers (Gate 2). The RCA path had to be updated regardless.

**4. Exposed kmStore + deduplicator as public-readonly fields instead of adding wiring through createServer / ApiRoutes constructor.**
- **Found during:** Designing the route handler's access to GraphKMStore.
- **Issue:** Plan Task 1's grep gate explicitly bans `kmStore?: GraphKMStore` in the createServer signature. Threading kmStore through createServer/ApiRoutes constructor was off-limits.
- **Fix:** GraphKMStoreAdapter exposes `public readonly kmStore`; route handler does `this.store instanceof GraphKMStoreAdapter ? this.store.kmStore : ...`. Similarly `IngestionPipeline.deduplicator` exposed as `public readonly` for the synthesize call.
- **Impact on plan:** Plan 08 will replace `this.store` with the GraphKMStore directly, eliminating the cast. The interim public exposure is intentional and documented; spec-grade encapsulation isn't a Phase 43 goal.

**5. Deleted batchLLMResolution + migrateEdges along with resolveEntities (transitively dead private helpers).**
- **Found during:** Post-deletion grep for unused helpers.
- **Issue:** Both private methods were only called from inside resolveEntities. After deleting resolveEntities, they became dead code (TypeScript doesn't warn on unused private methods by default).
- **Fix:** Deleted as a unit. Three-method spanned single contiguous sed-delete range (`595,933d`) — 339 lines total.
- **Impact on plan:** The plan said "delete resolveEntities entirely" — deleting its transitive dead helpers is the literal interpretation. No external consumer was affected.

**Total deviations:** 5 — 1 verify-only no-op (Task 1 leak already gone), 2 architectural choices (synthesize post-step + public-readonly exposure) that preserve plan spirit, 1 mechanical (RCA path's second caller), 1 transitive (dead helper cleanup). All documented; net LoC -196.

## Issues Encountered

- **The plan's threat-model claim that "km-core return value matches OKM shape by construction" was not quite accurate.** Shape differences (raw EntityId vs `${layer}:${id}`, `confidence` field present, `synthesizedCount` absent, `runId`/`classesScanned`/`durationMs` extra, no `sendSuccess` wrap) all required the helper's reshape function. The plan's "Plan 06 fixtures-diff catches drift" still holds — the reshape produces the OKM contract — but the per-field reconciliation was more work than a pure passthrough.

- **No integration test asserts on `/api/cleanup/resolve-entities`.** Grepped `tests/integration/` and `tests/unit/` for any reference — zero hits. The plan's "any integration test asserting internal call paths is updated" task item was a no-op. Plan 06 will be the first lock-in for this contract.

- **Test flake from Plan 04 didn't reproduce.** Ran `npm test` twice; both runs gave the stable baseline (493/495 + 7 file-load errors). No api-query flake this session.

## User Setup Required

None — Plan 05 is source code changes only. Operator can sanity-check by sending a no-op resolve:

```bash
curl -sS -X POST http://localhost:<port>/api/cleanup/resolve-entities \
  -H "Content-Type: application/json" \
  -d '{"dryRun": true, "classes": []}' | jq .data
# expected:
# {
#   "dryRun": true,
#   "mergeCount": 0,
#   "synthesizedCount": 0,
#   "merges": [],
#   "errors": []
# }
```

## Next Phase Readiness

**Plan 43-06 unblocked.** Plan 06 captures the REST fixtures (the D-G5.1 lock contract). The OKM REST contract has been preserved byte-identical — fixtures recorded against the Plan-05 implementation will match what pre-migration consumers saw. The captured-shape table above documents the field-level contract for cross-reference.

**Plan 43-07 (JSON replay)** has no dependency on this plan's deliverables — separate scope.

**Plan 43-08 (storage cutover)** is partially set up by this plan:
- The interim adapter-mirror step in `runEntityResolution` will be deleted when Plan 08 removes the IGraphStore adapter (the `this.store instanceof GraphKMStoreAdapter` cast goes away; `this.store: GraphKMStore` directly).
- `GraphKMStoreAdapter.kmStore` and `IngestionPipeline.deduplicator` public-readonly exposures should be reviewed in Plan 08's final-cleanup — the kmStore exposure can be removed entirely after the cutover; the deduplicator exposure stays if synthesize is still called from outside the pipeline.
- The orphan `src/ontology/{registry,loader}.ts` files from Plan 04 remain queued for Plan 08 final-cleanup.

**Test gap to address by Plan 06:** No integration test currently exercises `/api/cleanup/resolve-entities`. Plan 06's fixtures recording IS the first test for this contract. Recommend Plan 06 also include a dry-run smoke test + a real-run smoke test against a 3-entity fixture (2 duplicates + 1 unique).

---
*Phase: 43-okm-cross-repo-migration-c*
*Plan: 05 (Wave 2)*
*Completed: 2026-05-31*
