---
phase: 73-semantic-route-judge-success-scoring
plan: 02
subsystem: database
tags: [km-core, experiment-ontology, score, idempotent-write, override-preservation, leveldb]

# Dependency graph
requires:
  - phase: 71-experiment-kb-foundation
    provides: openExperimentStore() factory + run-write.mjs (the idempotent writeRun template) + experiment-ontology.json
  - phase: 72-syntactic-route-quality
    provides: route-heuristics.mjs (null-not-zero tri-state contract) + RouteEvent[] shape
provides:
  - Score ontology class + Run--scored-->Score relation (D-05)
  - writeScore(store,{span,judgment}) — idempotent, override-preserving Score writer
  - applyOverride(store,{taskId,dimension,value,by}) — single corrected_* slot writer for the PATCH endpoint (73-06)
  - the judgment object contract (goal_aligned_ratio + 5-dim rubric + event_labels + rationales + pending/not_scored)
affects: [73-04 judge, 73-05 close orchestrator, 73-06 PATCH override endpoint]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Idempotent km-core write (lookup-by-task_id → mint-or-reuse → strict putEntity + stable-key edge) extended with override-preservation"
    - "Tri-state degradation markers in metadata: null (no evidence) / pending (judge failed) / not_scored:'trivial'"

key-files:
  created:
    - lib/experiments/score-write.mjs
    - tests/experiments/score-write.test.mjs
  modified:
    - .data/ontologies-experiment/experiment-ontology.json

key-decisions:
  - "Score id minted via mintEntityId() (never span.task_id — parseEntityId requires UUIDv7); idempotency keyed on metadata.run_task_id"
  - "corrected_*/overridden_by/overridden_at ride in metadata, NOT declared ontology properties (mirrors run-write heuristics-in-metadata pattern)"
  - "applyOverride spreads existing metadata and overrides one slot — guarantees judged fields survive; unknown dimension throws"
  - "scored edge uses stable key ${runId}:scored:${scoreId} so N re-judges dedupe to ONE edge"
  - "meta.version bumped 1.0.0 → 1.1.0 for the Score class addition"

patterns-established:
  - "Override-preserving re-write: on every writeScore, carry forward existing corrected_* from e.metadata; judged fields refreshed, corrections never clobbered (D-06)"
  - "Trivial/pending guards write null judged fields + a distinguishing marker rather than coercing to 0"

requirements-completed: [SCORE-01, SCORE-02]

# Metrics
duration: 18min
completed: 2026-06-28
---

# Phase 73 Plan 02: Score Storage (writeScore + applyOverride) Summary

**Idempotent, override-preserving `Score` km-core write path — adds the `Score` ontology class + `Run--scored-->Score` relation and clones `run-write.mjs` into `score-write.mjs` (writeScore + applyOverride), defining the judgment object contract the judge (73-04) produces and the close orchestrator (73-05) consumes.**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-06-28T14:17Z (approx)
- **Completed:** 2026-06-28
- **Tasks:** 3
- **Files modified:** 3 (1 modified, 2 created)

## Accomplishments
- Added the `Score` class (extends Contract, 6 judged rubric properties) + `scored` relation on `Run` to the experiment ontology; `meta.version` 1.0.0 → 1.1.0.
- Implemented `writeScore(store,{span,judgment})`: idempotent lookup by `run_task_id`, strict-path `putEntity`, stable-key `scored` edge, null-not-zero judged fields, and D-06 carry-forward of `corrected_*`/`overridden_by`/`overridden_at`.
- Implemented `applyOverride(store,{taskId,dimension,value,by})`: sets one `corrected_<dim>` + stamps while preserving all judged fields; rejects unknown dimensions.
- 5-group test suite proving idempotency (ONE node + ONE edge), re-judge overwrite of judged fields, override-preservation across re-judge, tri-state markers, and the unknown-dimension throw — all against an isolated tmpdir store.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add Score class + Run.scored relation to experiment ontology** - `ebfb7020b` (feat)
2. **Task 2: score-write.mjs — idempotent writeScore + applyOverride** - `51e3a47d4` (feat)
3. **Task 3: score-write idempotency + override + tri-state test** - `54ffff19b` (test)

## Files Created/Modified
- `.data/ontologies-experiment/experiment-ontology.json` - Added `Score` class (goalAlignedRatio + goalAchieved/codeQuality/testCoverage/regressions/specDrift) and `scored:["Score"]` on `Run.relationships`; version bump.
- `lib/experiments/score-write.mjs` - `writeScore` (idempotent, override-preserving, `scored` edge) + `applyOverride` (single corrected_* slot writer); the judgment contract documented in the header/JSDoc.
- `tests/experiments/score-write.test.mjs` - node:test + node:assert/strict suite, 5 groups, isolated `openExperimentStore({repoRoot})` store.

## Decisions Made
None beyond the plan — followed the run-write.mjs template and 73-PATTERNS.md §score-write.mjs exactly. Key choices (id minting, metadata-resident corrected_* fields, stable edge key, version bump) are recorded in frontmatter `key-decisions`.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Two Bash commits were initially denied because the command string contained a `console.` literal (in a verification grep), which trips the no-console-log command-string guard. Resolved by removing the literal from the command and committing in smaller steps — no code change needed.

## Known Stubs
None — `writeScore`/`applyOverride` are fully wired against the live experiment store; the consuming judge (73-04) and orchestrator wiring (73-05) and PATCH endpoint (73-06) are intentionally out of this plan's scope (Wave 1 storage half only).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The judgment object contract is now concrete (header + JSDoc in `score-write.mjs`): `goal_aligned_ratio`, `event_labels[]`, `ratio_rationale`, `rubric{5 dims}`, `rubric_rationale`, `pending`, `not_scored`.
- 73-04 (judge) can produce judgments matching this shape; 73-05 (close orchestrator) can call `writeScore`; 73-06 (PATCH endpoint) can call `applyOverride`.
- No blockers.

## Self-Check: PASSED

All created/modified files exist on disk (`score-write.mjs`, `score-write.test.mjs`, `experiment-ontology.json`, `73-02-SUMMARY.md`) and all three task commits are in the log (`ebfb7020b`, `51e3a47d4`, `54ffff19b`).

---
*Phase: 73-semantic-route-judge-success-scoring*
*Completed: 2026-06-28*
