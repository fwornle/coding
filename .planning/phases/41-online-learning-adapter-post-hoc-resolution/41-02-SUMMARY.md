---
phase: 41-online-learning-adapter-post-hoc-resolution
plan: 02
subsystem: km-core-adapter
tags: [km-core, online-learning, adapter, mapper, ontology, INT-01]

# Dependency graph
requires:
  - phase: 37-km-core-foundation
    provides: Entity / Relation types (entity.ts); GraphKMStore primitives
  - phase: 38-ontology-registry
    provides: OntologyRegistry auto-discovery; class-walk via extends
  - phase: 39-entity-data-model
    provides: CF-D37 top-level Entity.legacyId placement; backfill resolver pattern
  - phase: 41-online-learning-adapter-post-hoc-resolution-plan-01
    provides: learning-artifacts ontology classes (Observation, Digest, Insight)

provides:
  - Pure mapObservationRow / mapDigestRow / mapInsightRow functions
  - ObservationRow / DigestRow / InsightRow type interfaces
  - Fixture rows under tests/fixtures/online-export/ (4 obs, 2 digests, 1 insight)
  - Canonical top-level legacyId stamping pattern for A subsystem (system='A', metadata.subsystem='online')

affects:
  - 41-03 (reproject library function — consumes mappers)
  - 41-04 (reproject implementation — uses mappers + legacyId resolver)
  - 41-07 (integration test — exercises mappers via reproject→resolve→merge)

# Tech tracking
tech-stack:
  added: []  # zero npm installs — pure-TS module addition
  patterns:
    - "Pure-function adapter (mirrors src/segments/merge.ts shape)"
    - "Top-level Entity.legacyId placement per CF-D37 (NOT in metadata)"
    - "Subsystem discriminator as separate metadata key, not folded into legacyId.system"
    - "Mapper omits id; reproject mints/resolves via legacyId on trusted path"

key-files:
  created:
    - /Users/Q284340/Agentic/km-core/src/adapters/online/mapper.ts
    - /Users/Q284340/Agentic/km-core/tests/unit/adapters/online-mapper.test.ts
    - /Users/Q284340/Agentic/km-core/tests/fixtures/online-export/observations.json
    - /Users/Q284340/Agentic/km-core/tests/fixtures/online-export/digests.json
    - /Users/Q284340/Agentic/km-core/tests/fixtures/online-export/insights.json
  modified: []

key-decisions:
  - "Top-level entity.legacyId.system = 'A' (narrow Phase 39 union) — NOT widened to 'online'"
  - "Subsystem discriminator lives at entity.metadata.subsystem = 'online' (separate from legacyId)"
  - "Mapper omits id; Plan 04 reproject owns id minting via legacyId resolver"
  - "Null-handling: modifiedFiles → []; llm/digestedAt key omitted from metadata when null"
  - "Name derivation: Observation first non-empty line ≤120 chars; Digest theme; Insight topic; '(empty)' fallback"
  - "Layer assignment: Observation/Digest → 'evidence'; Insight → 'pattern' (matches ontology defaultLayer)"
  - "Fixtures use synthetic 'coding-test' project + 'test-agent' agent (T-41-02-01 mitigation)"

patterns-established:
  - "Adapter mapper module: pure-function transform, no I/O, no store coupling, type-only Entity import"
  - "Per-row optional metadata: nullable source fields collapse to [] for arrays, omit key for scalars"
  - "Synthetic fixture data over verbatim live-export copy for committed test artifacts"

requirements-completed: [INT-01]

# Metrics
duration: 14min
completed: 2026-05-22
---

# Phase 41 Plan 02: Online-Learning Adapter Mappers Summary

**Pure row-to-Entity mappers (Observation / Digest / Insight) for A's online-learning JSON exports — canonical top-level Entity.legacyId placement, separate metadata.subsystem discriminator, zero I/O dependency.**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-05-22T17:34:00Z
- **Completed:** 2026-05-22T17:38:00Z
- **Tasks:** 2
- **Files created:** 5 (1 source, 1 test, 3 fixtures)

## Accomplishments

- Landed `mapObservationRow` / `mapDigestRow` / `mapInsightRow` as pure functions under `km-core/src/adapters/online/mapper.ts` (244 lines including JSDoc + interfaces)
- Established the canonical CF-D37 top-level `Entity.legacyId = { system: 'A', id: <row.id> }` stamp pattern for A's online subsystem
- Kept the `Entity.legacyId.system` union narrow (`'A' | 'B' | 'C'`) — the `'online'` discriminator lives at `entity.metadata.subsystem`, NOT inside legacyId
- 17 passing tests cover happy-path + null-handling + name-derivation + top-level legacyId stamping + purity (plan required ≥10)
- Full vitest suite stays green (177 tests across 20 files; was 160/19 before this plan)
- TypeScript strict build clean (`tsc --noEmit` exits 0)
- Fixture rows mirror A's real export shape but use synthetic `coding-test` project + `test-agent` agent name (T-41-02-01 information-disclosure mitigation)

## Task Commits

Each task was committed atomically to `/Users/Q284340/Agentic/km-core` (separate sibling repo per CF-D04):

1. **Task 1: Capture minimal fixture rows** — `6d49e14` (test)
   - 3 JSON fixture files; cross-references between observations/digests/insights intact; null-handling sentinels (modifiedFiles=null + llm=null) present in 2/4 observation rows
2. **Task 2 (RED): Failing tests for online-mapper** — `1c3382f` (test)
   - 17 vitest tests; fail with module-not-found until mapper.ts lands (TDD RED gate)
3. **Task 2 (GREEN): Pure mappers implementation** — `d071df0` (feat)
   - mapper.ts with 3 mappers + 3 interfaces; all 17 tests pass; full suite (177 tests) green; `tsc --noEmit` clean

**Plan metadata commit (SUMMARY.md):** committed in `/Users/Q284340/Agentic/coding` per orchestrator instructions.

_Note: TDD task 2 split into a RED (failing-test) commit and a GREEN (implementation) commit per execute-plan TDD flow._

## Files Created/Modified

**In `/Users/Q284340/Agentic/km-core/` (sibling repo):**

- `src/adapters/online/mapper.ts` (CREATED, 244 LoC) — pure row-to-Entity mappers + exported row interfaces
- `tests/unit/adapters/online-mapper.test.ts` (CREATED, 199 LoC) — 17 vitest tests covering Tests A-J from the plan
- `tests/fixtures/online-export/observations.json` (CREATED) — 4 fixture rows (2 with null sentinels, 2 with near-duplicate summaries)
- `tests/fixtures/online-export/digests.json` (CREATED) — 2 fixture rows referencing observation ids
- `tests/fixtures/online-export/insights.json` (CREATED) — 1 fixture row referencing both digest ids

**In `/Users/Q284340/Agentic/coding/` (this repo):**

- `.planning/phases/41-online-learning-adapter-post-hoc-resolution/41-02-SUMMARY.md` (CREATED, this file)

## Decisions Made

- **Top-level legacyId placement is canonical (CF-D37):** Mappers stamp `entity.legacyId = { system: 'A', id: row.id }` at the TOP LEVEL of the returned Entity, matching `entity.ts:147` and `backfill/index.ts:238`. The `41-PATTERNS.md` "Option B (system+subsystem on metadata)" note is explicitly superseded by this canonical placement (the patterns file even calls itself out as superseded — Cross-Cutting note section).
- **Narrow legacyId.system union preserved:** `'A' | 'B' | 'C'` stays as-is. The subsystem discriminator (`'online'`) goes on `metadata.subsystem`, not into the typed legacyId union, so future B/C migrations don't require widening the type.
- **id omitted from mapper output:** Plan 04 (reproject) mints/resolves the canonical EntityId via the legacyId resolver. Mappers return a partial entity (cast to `Entity`); the trusted-path `putEntity({ skipOntologyCheck: true })` will accept it and stamp the id. Documented in JSDoc on each mapper.
- **Layer assignment:** Observation/Digest get `layer: 'evidence'`; Insight gets `layer: 'pattern'`. Matches `ontology/learning-artifacts.json` `defaultLayer` declarations from Plan 41-01.
- **Null-handling convention:** `modifiedFiles` collapses to `[]` (consumers can iterate without guards); `llm` and `digestedAt` keys are omitted from metadata entirely when null (cleaner than `undefined` key sentinels).
- **Synthetic fixture identifiers:** Project `coding-test`, agent `test-agent`, ids prefixed `fixture-obs-` / `fixture-dig-` / `fixture-ins-` — none of A's real export rows copied verbatim (T-41-02-01).

## Deviations from Plan

None — plan executed exactly as written.

The plan required ≥10 tests; the test file lands 17 (the extra 7 cover the positive/non-null branch of the null-handling tests, the `'(empty)'` fallback, and the per-row purity assertions for digest + insight). All required acceptance-criteria greps return the expected counts (3 export functions, 3 export interfaces, 0 console.*, 0 metadata.legacyId placements, 4 top-level `legacyId: { system: 'A'` occurrences against the spec's ≥3, 4 `subsystem: 'online'` occurrences against the spec's ≥3).

## Issues Encountered

None.

The test file initially exposed a subtle expectation: `entity.legacyId?.system` (optional chaining) was used in the test grep but the spec's acceptance grep listed only `entity.legacyId.system`. Both styles appear in the test file (Tests C/G/H all use `?.system`), and the spec's grep regex matches both via the `\\.legacyId\\.system` alternative — 5 occurrences observed against the spec's ≥3.

## User Setup Required

None — pure library-level addition. No external services, no npm installs, no environment variables.

## Next Phase Readiness

**Plan 41-03 (next-wave) unblocked:**
- Typed `ObservationRow` / `DigestRow` / `InsightRow` interfaces are exported and consumable
- Canonical top-level legacyId placement is locked, so the reproject function's idempotency scan can hash on `entity.legacyId.id` directly
- Mappers are pure — reproject can call them in any order without state contamination

**Plan 41-07 (integration test) unblocked:**
- Fixture files at `tests/fixtures/online-export/` contain the deliberate duplicate-pair (observations 0001 + 0002 differ only in trailing whitespace) that `resolveEntities` integration test needs

**No blockers or concerns** — the Phase 39 CF-D37 canonical placement carries forward cleanly without type widening; Phase 42 + 43 (B + C migrations) can adopt the same pattern with `system: 'B'` + `metadata.subsystem: '<discriminator>'`.

## Self-Check: PASSED

- `/Users/Q284340/Agentic/km-core/src/adapters/online/mapper.ts` — FOUND
- `/Users/Q284340/Agentic/km-core/tests/unit/adapters/online-mapper.test.ts` — FOUND
- `/Users/Q284340/Agentic/km-core/tests/fixtures/online-export/observations.json` — FOUND
- `/Users/Q284340/Agentic/km-core/tests/fixtures/online-export/digests.json` — FOUND
- `/Users/Q284340/Agentic/km-core/tests/fixtures/online-export/insights.json` — FOUND
- Commit `6d49e14` (km-core: test fixtures) — FOUND
- Commit `1c3382f` (km-core: RED mapper tests) — FOUND
- Commit `d071df0` (km-core: GREEN mapper impl) — FOUND
- `npx tsc --noEmit` in km-core — exit 0 (PASS)
- `npx vitest run` in km-core — 177 passed across 20 files (PASS)

---
*Phase: 41-online-learning-adapter-post-hoc-resolution*
*Completed: 2026-05-22*
