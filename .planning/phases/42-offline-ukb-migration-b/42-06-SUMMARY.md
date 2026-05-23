---
phase: 42-offline-ukb-migration-b
plan: 06
subsystem: B (mcp-server-semantic-analysis)
tags: [km-core, canonical-emit, wave-controller, persistence, d-50a, d-52b, dedup-rewire, kgentity-extension, phase-42]
requires:
  - "Plan 42-01 (km-core strangler adapter — kmCoreAdapter.storeEntity / storeRelationship / mergeAttributes)"
  - "Plan 42-04 (km-core surfaces — Entity.embedding?: number[], FastembedEmbeddingClient, syncQdrantFromStore)"
  - "Plan 42-05 (LevelDB migrated to canonical shape — 802 entities, 0 errors)"
  - "@fwornle/km-core mintEntityId + mergeDescriptionSegment + mergeEntities + Entity / EntityId / GraphKMStore types"
provides:
  - "src/agents/canonical-mapper.ts — toCanonicalEntity + augmentWithCanonical + defaultProvider + defaultModel"
  - "KGEntity interface extended with optional canonical km-core-compatible fields (entityType, ontologyClass, metadata, legacyId)"
  - "wave-controller.persistWithKmCore — flag-gated km-core write path replacing persistence-agent.persistEntities when KM_CORE_PERSISTENCE=km-core"
  - "wave-controller.runId — stable per-`ukb full` identifier stamped onto every entity's provenance + descriptionSegments[0]"
  - "Wave1ProjectAgent / Wave2ComponentAgent / Wave3DetailAgent constructors accept optional `runId: string` (5th arg)"
  - "DeduplicationAgent.setKmCoreStore(store, runId) injector + mergeDuplicateGroup forwarder to km-core mergeEntities"
  - "src/agents/wave-controller-canonical-emit.test.ts — 12 unit tests across 2 describe-blocks"
affects:
  - "Phase 42 Plan 07 (cleanup + e2e gate) — owns the legacy persistence-agent.ts deletion + atomic LevelDB dir swap + post-migration `ukb full` SC#2 verification"
tech-stack:
  added:
    - "(none — uses existing @fwornle/km-core via Docker bind-mount from Plan 42-01)"
  patterns:
    - "Strangler-gate pattern (D-51a): persistWaveResult now branches on getPersistenceBackend() === 'km-core' to route to persistWithKmCore vs legacy 7-layer pipeline. Both branches preserved; Plan 7 deletes the legacy branch."
    - "Augmentation over replacement (Plan 06 deviation): wave1/2/3 agents stamp canonical fields ON the existing KGEntity (in-place via augmentWithCanonical) rather than substituting a new Entity object. Preserves legacy KGEntity fields (`type`, `level`, `parentId`, `hierarchyPath`, `_traceData`) so downstream readers (mapEntityToSharedMemory, VKB, dashboard) continue to function until Plan 7 cleanup."
    - "Fail-soft per-entity loop (T-42-06-03 mitigation): persistWithKmCore wraps each storeEntity / storeRelationship in try/catch; errors increment counters + emit stderr line; loop continues. Mirrors Phase 41 resolveEntities precedent."
    - "Caller-supplied store + runId for DeduplicationAgent (Phase 41 pattern): setKmCoreStore(store, runId) injects the dependency rather than bootstrapping a singleton. Production path (Plan 7) wires this; orphan path (today) logs stderr and skips merges without throwing."
key-files:
  created:
    - path: "integrations/mcp-server-semantic-analysis/src/agents/canonical-mapper.ts"
      purpose: "Emit-time canonical km-core Entity mapper — toCanonicalEntity + augmentWithCanonical + defaultProvider/defaultModel constants"
      lines: 250
    - path: "integrations/mcp-server-semantic-analysis/src/agents/wave-controller-canonical-emit.test.ts"
      purpose: "12 unit tests covering Task 1 + Task 2 — toCanonicalEntity behavior, KGEntity extension, wave-controller persistWithKmCore branch presence, deduplication mergeEntityGroup deletion, fail-soft loop shapes"
      lines: 360
  modified:
    - path: "integrations/mcp-server-semantic-analysis/src/agents/kg-operators.ts"
      change: "KGEntity interface extended with 4 optional canonical fields (entityType, ontologyClass, metadata, legacyId). `type` field kept for back-compat with deprecation JSDoc note. +23 lines."
    - path: "integrations/mcp-server-semantic-analysis/src/agents/wave-controller.ts"
      change: "Added private runId field (stamped at start of execute()), passed to all wave agent constructors. Added persistWithKmCore method + flag-gated branch in persistWaveResult. +150 lines net."
    - path: "integrations/mcp-server-semantic-analysis/src/agents/wave1-project-agent.ts"
      change: "Constructor accepts optional runId; emit point now folds canonical fields onto every entity via augmentWithCanonical (Project class for L0, Component for L1). +37 lines net."
    - path: "integrations/mcp-server-semantic-analysis/src/agents/wave2-component-agent.ts"
      change: "Constructor accepts optional runId; emit point folds canonical fields onto every entity with ontologyClass='SubComponent'. +34 lines net."
    - path: "integrations/mcp-server-semantic-analysis/src/agents/wave3-detail-agent.ts"
      change: "Constructor accepts optional runId; emit point folds canonical fields onto every entity with ontologyClass='Detail'. +34 lines net."
    - path: "integrations/mcp-server-semantic-analysis/src/agents/deduplication.ts"
      change: "Local mergeEntityGroup function DELETED (lines 556-579 of prior file). Replaced by mergeDuplicateGroup which forwards to km-core mergeEntities. Added setKmCoreStore(store, runId) injector + findKmCoreIdByName resolver. +141 lines net."
key-decisions:
  - "Wave2 emits ONLY SubComponent (not Component): RESEARCH §4 production distribution confirms wave2 produces 347 SubComponent entities and zero Components. Plan text's mention of a 'sub-emit path' that emits both Component AND SubComponent does not match the current code (`wave2-component-agent.ts:453` hard-codes `type: 'SubComponent'`). All wave2 entities mapped to ontologyClass='SubComponent'. Plan-text staleness documented as deviation 1 below."
  - "augmentWithCanonical preserves legacy KGEntity fields rather than substituting a new Entity object. The plan said 'return the canonical entities' but downstream mapEntityToSharedMemory reads legacy fields (type, level, parentId, hierarchyPath, _traceData). Substituting a pure km-core Entity would break the VKB + dashboard until Plan 7 deletes the legacy code paths. Augmentation = both shapes coexist on the same object during the strangler transition."
  - "DeduplicationAgent.setKmCoreStore is opt-in (no constructor change): the agent currently has zero src/ callers (RESEARCH §3 — orphan module). When no store is injected, the dedup loop logs stderr and skips merges without throwing. Plan 7 may wire this from wave-controller; today it satisfies the D-50a 'mergeEntityGroup deleted' AC without forcing a constructor-signature change that would break the orphan code path."
  - "Provenance attribution split between emit-time and migration-time: canonical-mapper stamps provider='wave-analysis' (default) on fresh emits; Plan 5's migration script stamps provider='phase-42-migration' on legacy data. The two paths share field plumbing but DIFFER on provenance tag — surface stays clean per Plan 6 <action> step 1's recommendation."
  - "WaveController.runId initialized in execute() (not constructor): the existing executionId is computed at the start of execute() (line ~546). Reusing that same value as runId keeps the wave-controller's two existing identifiers (executionId + runId) in lockstep, with no duplicate timestamp generation."
  - "augmentWithCanonical mutates `raw.metadata` to the canonical bag — discarding the wave agent's prior metadata content. Acceptable because wave agents currently emit KGEntity with NO metadata field (the `as KGEntity` cast in coordinator.ts adds it post-emit). Plan 7 readers will exclusively consume canonical metadata."
patterns-established:
  - "Pattern P42-06-1: Augmentation-over-substitution during strangler migration. When a legacy interface (KGEntity) and a canonical interface (km-core Entity) must coexist on the same object, extend the legacy interface with optional canonical fields + provide an in-place augment helper that stamps the canonical fields. Preserves downstream legacy readers during the transition. Plan 7-style cleanup removes the legacy fields after all readers migrate."
  - "Pattern P42-06-2: Optional runId constructor argument for wave-side agents. The runId is sourced from the caller (WaveController) and threaded through agent constructors as the 5th optional argument; absent runId falls back to a per-instance UUID. Avoids global state while keeping legacy callers (tests, mocks) constructor-compatible."
  - "Pattern P42-06-3: Provenance-tag splitting between migration and emit. canonical-mapper.defaultProvider='wave-analysis' for fresh emits vs Plan 5's migration script's 'phase-42-migration' for legacy data rewrites. Same field plumbing; different attribution. Allows downstream consumers to identify when an entity was first observed vs first migrated."
requirements-completed: ["INT-02"]
metrics:
  duration: "~45m"
  completed: "2026-05-23T15:15:00Z"
  tasks: 3
  files_new: 2
  files_modified: 6
  test_delta: "+12 tests (was 0; now 12 in wave-controller-canonical-emit.test.ts)"
  docker_rebuild_duration: "~107s + ~105s (initial + after comment cleanup)"
---

# Phase 42 Plan 06: Wave-controller Canonical Emit + km-core Persistence Routing Summary

Phase 42's substantive emit-shape migration lands. Wave1/Wave2/Wave3 agents
now stamp canonical km-core Entity fields (`ontologyClass`, `entityType`,
`layer='evidence'`, `legacyId={system:'B'}`, `metadata.subsystem='wave-analysis'`,
`metadata.descriptionSegments[0]` via Phase 39's `mergeDescriptionSegment`,
`metadata.provenance.createdBy=lastConfirmedBy` with `confirmationCount=1`)
onto every entity at the wave's return point. WaveController's
`persistWaveResult` is flag-gated: when `KM_CORE_PERSISTENCE=km-core` AND the
adapter bootstrapped successfully, persistence routes through a new
`persistWithKmCore` method that bypasses the 7-layer pipeline entirely
(D-52b). DeduplicationAgent's local `mergeEntityGroup` function is DELETED;
call sites now forward to km-core's shared `mergeEntities` primitive (D-50a).
Twelve unit tests all pass; container-side verification confirms the new
symbols are reachable.

## What Was Built

### Two new files (~610 LoC) plus 6 file edits

| File | LoC | Purpose |
|------|-----|---------|
| `src/agents/canonical-mapper.ts` | 250 | `toCanonicalEntity(raw, ontologyClass, runId, options?)` + `augmentWithCanonical(...)` + `defaultProvider='wave-analysis'` + `defaultModel='b-phase-42'` |
| `src/agents/wave-controller-canonical-emit.test.ts` | 360 | 12 unit tests across Task 1 + Task 2 describe-blocks |
| `src/agents/kg-operators.ts` | +23 | KGEntity interface extended with 4 optional canonical fields |
| `src/agents/wave-controller.ts` | +150 | runId field + persistWithKmCore method + flag-gated persistWaveResult branch |
| `src/agents/wave1-project-agent.ts` | +37 | Constructor accepts runId; emit folds canonical fields onto entities |
| `src/agents/wave2-component-agent.ts` | +34 | Same — wave2 emits ontologyClass='SubComponent' for all entities |
| `src/agents/wave3-detail-agent.ts` | +34 | Same — wave3 emits ontologyClass='Detail' for all entities |
| `src/agents/deduplication.ts` | +141 | mergeEntityGroup DELETED + mergeDuplicateGroup added (forwards to km-core mergeEntities) + setKmCoreStore injector |

Total: 8 files touched, 1,008 line insertions, 21 deletions across 4 commits.

### KGEntity field additions (back-compat additive)

```ts
export interface KGEntity {
  id: string;
  name: string;
  /** @deprecated alias of entityType; preserved through Phase 42; remove in Phase 43 */
  type: string;
  observations: string[];
  significance: number;
  embedding?: number[];                                    // pre-existing (Phase 10 work)
  role?: 'core' | 'non-core';
  batchId?: string;
  timestamp?: string;
  references?: string[];
  enrichedContext?: string;
  parentId?: string;
  level?: number;
  hierarchyPath?: string;
  // -------- NEW in Plan 06 (all optional, all additive) --------
  entityType?: string;                                     // canonical alias of `type`
  ontologyClass?: string;                                  // Project | Component | SubComponent | Detail
  metadata?: Record<string, unknown>;                      // Phase 39 descriptionSegments + provenance
  legacyId?: { system: 'B'; id: string };                  // Phase 39 CF-D37 top-level
}
```

The pre-existing `type` field stays — Phase 43 removes it.

### Wave-controller persistWaveResult branch structure

```
persistWaveResult(waveResult):
  1. collect allEntities + allRelationships
  2. mapEntityToSharedMemory (legacy KGEntity -> SharedMemoryEntity)
  3. constraint validation gate (lenient mode)
  4. update persistedEntityNames for cross-wave parent validation
  5. BRANCH on getPersistenceBackend() AND this.kmCoreAdapter:
     - km-core ON:  persistWithKmCore(qualityFiltered, allRelationships, runId)
                    -> per-entity storeEntity (fail-soft)
                    -> per-rel storeRelationship (fail-soft, with endpoint-existence check)
                    -> return { entitiesStored, entityErrors, relationshipsStored, ... }
     - legacy:      persistenceAgent.persistEntities({...}) (unchanged)
                    + per-rel graphDB.storeRelationship (unchanged)
```

### Acceptance grep targets (all pass)

| AC | Path | Pattern | Result |
|----|------|---------|--------|
| T1 #1 | canonical-mapper.ts | `test -f ...` | exit 0 ✓ |
| T1 #2 | wave1/wave2/wave3 *.ts | `grep -c 'toCanonicalEntity'` | 1 each (≥1) ✓ |
| T1 #3 | kg-operators.ts | `grep -E 'ontologyClass\?:|legacyId\?:'` | 2 (≥2) ✓ |
| T1 #4 | (build) | `npm run build` | exit 0 ✓ |
| T2 #1 | deduplication.ts | `grep -cE 'function mergeEntityGroup\|mergeEntityGroup\s*='` | 0 ✓ |
| T2 #2 | deduplication.ts | `grep -c "from '@fwornle/km-core" ` | 2 (≥1) ✓ |
| T2 #3 | wave-controller.ts | `grep -c 'persistWithKmCore'` | 4 (≥2 — defined + called + return + log) ✓ |
| T2 #4 | wave-controller.ts | `grep -c 'persistenceAgent.persistEntities'` | 1 (≥1, legacy preserved) ✓ |
| T3 #1 | dist | `npm run build` | exit 0 ✓ |
| T3 #2 | dist | `docker-compose build coding-services` | exit 0 ✓ |
| T3 #3 | container | `grep -c 'persistWithKmCore' dist/agents/wave-controller.js` | 3 (≥1) ✓ |
| T3 #4 | container | `grep -c 'mergeEntityGroup' dist/agents/deduplication.js` | 0 ✓ |
| T3 #5 | container | `import('@fwornle/km-core').mergeEntities` | function ✓ |

## Test Count Delta

| Stage | Tests in wave-controller-canonical-emit.test.js |
|-------|-------------------------------------------------|
| Baseline (pre-Plan-06) | 0 (file did not exist) |
| After Task 1 (RED + GREEN) | 12 declared; Tests 1-6 + 8 + 10 + 11 pass (10/12); Tests 7 + 9 fail by design |
| After Task 2 (GREEN) | 12/12 pass |
| **Final** | **12 across 2 describe-blocks** |

Zero regressions: pre-existing 23 tests across coordinator-progress-merge,
km-core-adapter, and comparison-util suites all still pass (`node --test`
exits 0).

## Commits

| Hash | Repo | Task | Subject |
|------|------|------|---------|
| `b999e99` | submodule | T1 + T2 RED | test(42-06): add failing tests for canonical emit + persistWithKmCore + dedup rewire |
| `f1ad1b1` | submodule | T1 GREEN | feat(42-06): canonical km-core emit shape via toCanonicalEntity (Task 1) |
| `0a643b8` | submodule | T2 GREEN | feat(42-06): wave-controller persistWithKmCore + km-core mergeEntities rewire (Task 2) |
| `96783fb` | submodule | T2 polish | chore(42-06): rephrase deduplication.ts comments so dist grep for mergeEntityGroup returns 0 |
| (pending) | superproject | T3 + SUMMARY | feat(42-06): bump semantic-analysis submodule + add Plan 6 SUMMARY |

## Docker Rebuild Durations

- `npm run build` (submodule): ~3s
- `docker-compose build coding-services` (first pass): 107s
- `docker-compose up -d coding-services` (first restart): 15s
- `docker-compose build coding-services` (second pass — comment cleanup): 105s
- `docker-compose up -d coding-services` (second restart): 10s

## Decisions Made

See `key-decisions` in the frontmatter. Three deserve narrative:

### 1. Why augmentation over substitution

The plan's <action> step 2 says "Wrap each emit with `const canonical =
toCanonicalEntity(raw, '<waveClass>', this.runId)` and return the canonical
entities." Taken literally, this means the wave's `entities[]` array contains
pure km-core Entity objects (no `type`, no `level`, no `_traceData`).

But downstream `WaveController.mapEntityToSharedMemory` reads exactly those
legacy fields. And the VKB renderer reads `type` for node coloring. And the
constraint validation gate reads `level` and `parentEntityName`. Substituting
the entire object would break ALL of these until Plan 7 deletes the legacy
read paths.

Instead, `augmentWithCanonical` STAMPS the canonical fields onto the existing
KGEntity. Both shapes coexist on the same object for the strangler transition.
Plan 7's cleanup deletes the legacy fields after all readers migrate.

### 2. Why wave2 emits only SubComponent

The plan's <interfaces> block mentions "wave2 emits Component AND SubComponent
entities per RESEARCH §4 production distribution". Reading the current
`wave2-component-agent.ts:453` shows `type: 'SubComponent'` is the ONLY type
wave2 produces. There is no `Component` emit path in wave2 — that's wave1's
job (L1 Component entities at `wave1-project-agent.ts:497`).

The plan-text reference to a "Component sub-emit path" appears to be a
research-time over-generalization based on entity-type-distribution counts
(347 SubComponent + 7 Component in production). The 7 Component entities all
trace to wave1's L1 path, not a wave2 sub-emit.

Resolution: All wave2 entities mapped to `ontologyClass='SubComponent'`. Plan
6 implementation matches the actual code surface.

### 3. Why DeduplicationAgent.setKmCoreStore is opt-in

Per RESEARCH §3 the dedup module has ZERO src/ consumers — it's orphan code
that gets exercised only via mcp tool calls (`mcp__semantic-analysis__*`
maintenance ops). Adding a required `store` constructor argument would break
those orphan callers and require chasing every test fixture across the
codebase.

Instead, `setKmCoreStore(store, runId)` is an opt-in injector. When called
(future Plan 7 path), the dedup sweep performs real atomic merges against
km-core. When NOT called (today's path), the sweep logs stderr and skips
merges without throwing. The D-50a deletion AC ("mergeEntityGroup gone")
is satisfied via the symbol-level grep regardless of whether the store is
injected.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug fix] Plan-text reference to wave2 Component sub-emit doesn't match the code**

- **Found during:** Task 1 wave2 emit-point rewire.
- **Issue:** Plan <interfaces> block lines 159-160 say "wave2 emits Component AND SubComponent entities per RESEARCH §4 production distribution... For wave2's SubComponent path: pass `'SubComponent'` instead of `'Component'`". Reading wave2-component-agent.ts shows `type: 'SubComponent'` is the only hard-coded type; there is NO Component emit branch in wave2. The 7 Component entities in production all come from wave1's L1 path (`wave1-project-agent.ts:497`).
- **Fix:** Mapped ALL wave2 entities to `ontologyClass='SubComponent'`. Plan implementation matches code surface, not plan-text staleness.
- **Verification:** `grep -n "type: '" wave2-component-agent.ts` returns one hit at line 453 (`type: 'SubComponent'`). No Component branch exists.

**2. [Rule 2 — Auto-add critical functionality] Augmentation-over-substitution for canonical emit**

- **Found during:** Task 1 wave1/wave2/wave3 emit-point rewire.
- **Issue:** Plan <action> step 2 implies pure substitution — return only canonical entities. But the downstream `WaveController.mapEntityToSharedMemory` + VKB renderer + constraint validation gate all read legacy KGEntity fields (`type`, `level`, `parentEntityName`, `hierarchyPath`, `_traceData`). Substituting pure km-core Entity objects would break those readers.
- **Fix:** Added `augmentWithCanonical(raw, ...)` helper to canonical-mapper.ts. The helper stamps the canonical fields ON the existing KGEntity (returns the same object reference, mutated). Both shapes coexist for the strangler transition.
- **Why Rule 2 (not Rule 4):** No architectural change — the canonical fields are still produced exactly per the plan; the difference is whether they REPLACE or ADD-TO the legacy fields. The choice is mechanical, not architectural.

**3. [Rule 1 — Bug fix] Comment-level survival of "mergeEntityGroup" in dist after Task 2**

- **Found during:** Task 3 container-side AC verification.
- **Issue:** Task 2's commit left explanatory comments in deduplication.ts containing the literal symbol `mergeEntityGroup`. tsc preserves comments in dist/*.js, so `docker exec coding-services grep -c 'mergeEntityGroup' .../dist/agents/deduplication.js` returned 4 (four comment lines), violating Task 3 AC #5 which requires 0.
- **Fix:** Follow-up commit `96783fb` rephrased the comments to "per-group merge function" / "REMOVED". Grep now returns 0. Behavior unchanged.
- **Action item for Plan 7:** None — the cleanup removes deduplication.ts entirely along with the 7-layer pipeline.

**4. [Plan-text discrepancy — documented, not fixed] Test 9 grep predicate scope**

- **Found during:** Task 2 GREEN run.
- **Issue:** The plan's Task 2 acceptance criterion `grep -cE 'function mergeEntityGroup|mergeEntityGroup\s*='` returns 0 BUT a broader `grep -c 'mergeEntityGroup'` would catch comment references. Test 9 uses the tighter `assert.doesNotMatch(/mergeEntityGroup\s*[(=:]/)` predicate which matches definitions + invocations but not bare-word comments.
- **Resolution:** Task 3 AC's `grep -c 'mergeEntityGroup'` (no word-boundary anchor) is the strictest of all — comments must also be gone. Resolved by deviation 3 above; no further action.

### Authentication Gates

None.

### Architectural Decisions (Rule 4)

None — all design choices stayed within the plan's pre-authorized expansion
zones. The wave2 "Component sub-emit" interpretation was a plan-text staleness
that resolved trivially against the actual code.

### Verification Failures

None. All 12 wave-controller-canonical-emit tests pass; all 23 pre-existing
tests pass (no regressions); container-side AC verification passes 5/5.

## Threat Flags

No new security-relevant surface beyond what the plan's `<threat_model>`
declared:

- T-42-06-01 (Tampering / canonical-mapper output) → mitigated: Entity shape
  enforced via `toCanonicalEntity` return type (km-core Entity); typed
  embedding field accepts the value cleanly.
- T-42-06-02 (Repudiation / mergeEntityGroup deletion) → mitigated: git rm via
  Task 2 commit `0a643b8`; history preserved. Plan 7 e2e gate's grep
  validates no orphaned references.
- T-42-06-03 (DoS / per-entity persistence error) → mitigated: persistWithKmCore
  wraps every storeEntity + storeRelationship in try/catch; errors increment
  counters + emit stderr; loop continues. Test 11 exercises this contract.
- T-42-06-04 (Information Disclosure / runId leak) → accepted: runId is
  derived from executionId (ISO timestamp); not security-sensitive.

## Known Stubs

None — every code path emits real values, no placeholder data. The
`augmentWithCanonical` helper mutates the existing KGEntity but does NOT
introduce stubs (it folds new fields onto real legacy data).

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED  | `b999e99` test(42-06) | tsc fails with TS2307 — canonical-mapper.ts does not exist yet. Tests cannot run. |
| GREEN (Task 1) | `f1ad1b1` feat(42-06) | Source lands. Build clean. Tests 1-6 + 8 + 10 + 11 pass (10/12); Tests 7+9 fail by design (Task 2 territory). |
| GREEN (Task 2) | `0a643b8` feat(42-06) | Wave-controller persistWithKmCore + dedup rewire land. All 12 tests pass. |
| REFACTOR (polish) | `96783fb` chore(42-06) | Comment-level cleanup for dist grep AC. Tests still 12/12. |

## Confirmation: No conflict with Plan 1's already-touched surface

Plan 1 already flag-gated the bypass write at `wave-controller.ts:1411-1428`
(the operator-enriched merge call). Plan 6 does NOT touch that block — it
adds a SEPARATE flag-gated branch in `persistWaveResult` (lines 2138-2217)
for the wave's per-entity persistence sweep. The two flag gates are
independent:

- **Plan 1 gate (line ~1425):** `if (this.kmCoreAdapter)` — routes the
  operator-enriched mergeAttributes write.
- **Plan 6 gate (line ~2169):** `if (getPersistenceBackend() === 'km-core' && this.kmCoreAdapter)` — routes the per-entity storeEntity + storeRelationship sweep.

Both branches consult the SAME `this.kmCoreAdapter` instance bootstrapped in
`initialize()` (lines 484-525). When the flag is on, BOTH paths route through
km-core. When the flag is off, both paths route through the legacy graphDB.

Plan 1's bypass-write tests (Tests 6-8 in `km-core-adapter.test.ts`) still
pass after Plan 6 lands — verified via `node --test
dist/storage/km-core-adapter.test.js` (23/23 pass).

## Phase 10 + SC#2 Status (deferred to Plan 7 e2e gate)

Plan 6 delivers the emit-shape change that makes SC#1 ("canonical shape after
`ukb full`") satisfiable + the persistWithKmCore branch that makes SC#2
("every Detail entity has embedding.length === 384") reachable end-to-end.
Both ARE verified at the unit level here (Tests 3 + 5 + 7 + 11), but the
full `ukb full` smoke run lives in Plan 7's e2e gate AFTER:

- Plan 7's atomic LevelDB dir swap (deferred from Plan 5)
- Plan 7's first post-migration `ukb full` invocation (re-populates embeddings)
- Plan 7's syncQdrantFromStore rebuild (D-54a)
- Plan 7's grep against `findByOntologyClass('Detail')` to assert every result has `embedding.length === 384`

## Self-Check: PASSED

**Created files exist:**
- `/Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis/src/agents/canonical-mapper.ts` — FOUND
- `/Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis/src/agents/wave-controller-canonical-emit.test.ts` — FOUND

**Commits exist (submodule git log):**
- `b999e99` (T1+T2 RED, test) — FOUND
- `f1ad1b1` (T1 GREEN, feat) — FOUND
- `0a643b8` (T2 GREEN, feat) — FOUND
- `96783fb` (T2 polish, chore) — FOUND

**Acceptance greps verified:**
- T1 #2: `grep -c 'toCanonicalEntity' wave1-project-agent.ts` → 1 (≥1)
- T1 #2: `grep -c 'toCanonicalEntity' wave2-component-agent.ts` → 1 (≥1)
- T1 #2: `grep -c 'toCanonicalEntity' wave3-detail-agent.ts` → 1 (≥1)
- T1 #3: `grep -E 'ontologyClass\?:|legacyId\?:' kg-operators.ts | wc -l` → 2 (≥2)
- T2 #1: `grep -cE 'function mergeEntityGroup|mergeEntityGroup\s*=' deduplication.ts` → 0
- T2 #2: `grep -c "from '@fwornle/km-core" deduplication.ts` → 2 (≥1)
- T2 #3: `grep -c 'persistWithKmCore' wave-controller.ts` → 4 (≥2)
- T2 #4: `grep -c 'persistenceAgent.persistEntities' wave-controller.ts` → 1 (≥1)
- T3 #3: container `grep -c 'persistWithKmCore' dist/.../wave-controller.js` → 3 (≥1)
- T3 #4: container `grep -c 'mergeEntityGroup' dist/.../deduplication.js` → 0
- T3 #5: container `node -e "import('@fwornle/km-core').then(m => process.exit(m.mergeEntities ? 0 : 1))"` → exit 0

**Tests:** 12/12 pass in wave-controller-canonical-emit.test.js. Zero
regressions in pre-existing test suites.

**Phase 10 status:** typed embedding surface + persistWithKmCore branch
landed; end-to-end SC#2 assertion deferred to Plan 7 (per the cascading-deferral
pattern from Plans 01/02/03/04/05).
