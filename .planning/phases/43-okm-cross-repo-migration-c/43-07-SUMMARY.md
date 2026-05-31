---
phase: 43-okm-cross-repo-migration-c
plan: 07
subsystem: migration
tags: [okm, migration, json-replay, km-core, d-g4.1, legacy-id]

requires:
  - phase: 43-okm-cross-repo-migration-c
    provides: Plans 01-06 — km-core consumed by OKM (ontology+maintenance), REST contract baseline locked
  - phase: 42-offline-ukb-migration-b
    provides: Plan 5 D-54 migration template (structure / flag set / error budget / provenance stamping pattern)
  - phase: 41-online-learning-adapter-post-hoc-resolution
    provides: km-core GraphKMStore + trusted-path (skipOntologyCheck: true) putEntity semantics
  - phase: 38-ontology-registry
    provides: OntologyRegistry constructor (used for store ontology validator)

provides:
  - One-shot operator-driven migration script (.mjs, executable)
  - Production .data/leveldb-kmcore/ populated with 1665 entities + 18958 relations
  - 100% legacyId.system='C' stamping on migrated entities
  - 5-case integration test exercising happy path + idempotence + legacyId + error budget + per-domain bucketing
  - sibling .data/leveldb-kmcore.exports/ JSON exports (Plan 08 swaps both atomically)

affects: [43-08-storage-cutover, 43-09-embedding-rehydration, 43-10-post-cutover-verification]

tech-stack:
  added: []
  patterns:
    - "JSON-replay migration: reads OKM's Graphology export JSONs (the AUTHORITATIVE source per OKM's KB Persistence Rules — fresh environments restore from JSON, not LevelDB), maps each node to km-core Entity shape, writes via GraphKMStore.batch() with skipOntologyCheck: true. Same approach as Phase 42 Plan 5 but with JSON-source vs LevelDB-source."
    - "ID preservation via legacyId: { system: 'C', id: <okm-uuid> }. The OKM UUID becomes BOTH the canonical km-core id AND the legacyId.id (km-core accepts non-UUIDv7 ids on the trusted path via Phase 39 CR-01 widening). Plan 08's grep gate verifies every entity has the stamp."
    - "Per-target sibling exports dir (`${targetDir}.exports`): keeps km-core's auto-export JSON next to its LevelDB so Plan 08's atomic swap moves both together AND test runs don't share state through a hardcoded global exportDir."

key-files:
  created:
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/scripts/migrate-okm-json-to-kmcore.mjs (485 lines, +x — flag parsing, km-core construction per CLAUDE.md, per-file domain inference, entity mapping with legacyId stamp, edge mapping with layer:prefix strip, --resume idempotency, 5% error budget abort, JSON summary line on stdout)
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/tests/integration/migrate-json-replay.test.ts (273 lines — 5 vitest cases spawning the script via child_process)
  modified: []
  produced-but-not-committed:
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/.data/leveldb-kmcore/ (12 MB LevelDB — 7 files: 000005.ldb + 000006.log + CURRENT + LOCK + LOG + LOG.old + MANIFEST-000004; Plan 08 atomically swaps this with .data/leveldb/)
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/.data/leveldb-kmcore.exports/ (15 MB JSON exports — general/kpifw/raas per-domain; Plan 08 swaps this with .data/exports/)

key-decisions:
  - "Preserve OKM's existing UUIDs verbatim instead of fresh-minting UUIDv7. The plan explicitly says 'PRESERVE OKM's existing UUID (do NOT mint a new one — that breaks legacyId integrity)'. km-core's strict path rejects non-UUIDv7 ids via parseEntityId; the trusted path (`skipOntologyCheck: true`) widens to bypass BOTH ontology validation AND parseEntityId (Phase 39 CR-01). Production migration verified 1665/1665 entities round-trip via store.iterate() afterwards."
  - "Per-file domain inference (filename stem → metadata.subsystem) instead of a CLI flag table. OKM's three exports (general.json / kpifw.json / raas.json) directly map filename → domain bucket; inferring from path.basename is cleaner than maintaining a flag table or env var. Custom source paths via --source=<comma-separated> still infer from filename stem (the test fixtures use general.json / kpifw.json / raas.json names to exercise per-domain bucketing)."
  - "Sibling exports dir (`${targetDir}.exports`) instead of a fixed `.data/exports-kmcore`. Initial draft hardcoded `path.resolve(okmRoot, '.data/exports-kmcore')` — this leaked state across test runs (test 3 saw 15-27 entities instead of 4 because the script's exports dir accumulated 11-23 entities from tests 1+2). Deriving exportDir from --target scopes state per-target. Production migration uses `.data/leveldb-kmcore.exports/` next to `.data/leveldb-kmcore/`."
  - "exportDir fallback for vendor tarballs without config/ontology. The CLAUDE.md ontologyDir-resolver block walks up to km-core's package root then expects `config/ontology/`. The vendor-tarball install used here doesn't ship `config/ontology/` at runtime; fall back to OKM's local `ontology/` dir which is what the running OKM uses (src/index.ts:91-92 does the same)."
  - "5-case integration test mirrors Phase 42 Plan 5's test discipline but spawns the script via child_process.spawn (not in-process import). Rationale: tests THE script as operators invoke it (subprocess + CLI flags + stdout JSON summary). Adds ~3 s of process-spawn overhead per test, balanced by accurate behavioral coverage. Per-test timeout bumped to 30000 ms (vitest config default is 10000)."

patterns-established:
  - "Vitest 4 deprecates `describe(name, fn, opts)` and `it(name, fn, opts)` — options block moves to the SECOND argument: `it(name, { timeout: 30000 }, async () => {...})`. Worth surfacing because the codebase's existing tests use vitest 3 syntax silently."
  - "Spawning the migration subprocess works for vitest integration tests when stdout-only JSON summary + exit code suffice for assertions. Use child_process.spawn (NOT execSync) so stderr can be inspected separately for diagnostic content (Test 4 asserts `stderr.contains('aborted')`)."

requirements-completed: [INT-03]

duration: 60min
completed: 2026-05-31
---

# Phase 43 Plan 07: JSON-replay migration (OKM → km-core)

**One-shot operator-runnable script + 5-case integration test. Production .data/leveldb-kmcore/ now holds 1665 entities + 18958 relations from OKM's three JSON exports, every entity stamped with legacyId.system='C'. Plan 08 owns the atomic swap; .data/leveldb/ (legacy) is UNTOUCHED.**

## Performance

- **Duration:** ~60 min (10 min Phase 42 template review + endpoint enumeration, 25 min script authoring, 10 min test authoring + vitest 4 syntax fix, 5 min production migration run, 10 min commits + SUMMARY)
- **Completed:** 2026-05-31T13:20Z
- **Files created in OKM:** 2 (script 485 lines, test 273 lines = 758 LoC additive only)
- **Production migration elapsed:** 19059 ms (under 20 s wall-clock for 1665 entities + 18958 relations)

## Dry-Run Summary (production exports, pre-write validation)

```json
{
  "status": "ok",
  "runId": "okm-mig-1780225845827",
  "dryRun": true,
  "totalSourceFiles": 3,
  "totalEntities": 1665,
  "entitiesMigrated": 1665,
  "entitiesSkipped": 0,
  "entityErrors": 0,
  "totalRelations": 18958,
  "relationsMigrated": 18958,
  "relationErrors": 0,
  "errorBudget": 0,
  "elapsedMs": 87
}
```

Per-source breakdown:
- general.json: 382 entities + 1512 relations
- kpifw.json: 300 entities + 3722 relations
- raas.json: 983 entities + 13724 relations

## Production Migration Summary

```json
{
  "status": "ok",
  "runId": "phase-43-prod-20260531T111731Z",
  "targetDir": "/Users/<USER>/.../operational-knowledge-management/.data/leveldb-kmcore",
  "dryRun": false,
  "totalSourceFiles": 3,
  "totalEntities": 1665,
  "entitiesMigrated": 1665,
  "entitiesSkipped": 0,
  "entityErrors": 0,
  "totalRelations": 18958,
  "relationsMigrated": 18958,
  "relationErrors": 0,
  "errorBudget": 0,
  "elapsedMs": 19059,
  "provenance": {
    "provider": "phase-43-migration",
    "model": "okm-to-km-core",
    "runId": "phase-43-prod-20260531T111731Z",
    "timestamp": "2026-05-31T11:17:31.225Z"
  }
}
```

## Post-Migration Verification

Inline km-core read against `.data/leveldb-kmcore/` immediately after the migration:

```json
{
  "count": 1665,
  "withLegacyC": 1665,
  "bySubsystem": {
    "general": 382,
    "kpifw": 300,
    "raas": 983
  }
}
```

- ✅ Count matches dry-run + production migration (1665 / 1665 / 1665)
- ✅ 100% legacyId.system='C' stamping (1665 / 1665)
- ✅ Per-domain bucketing matches source-file breakdown
- ✅ Plan 08 target count for post-swap verification: **1665 entities** (exact match required; error budget is exhausted at this point — any drop is a regression).

## Integration Test Results

`tests/integration/migrate-json-replay.test.ts`: **5/5 pass**, ~870 ms total.

1. **Happy path** — 10 entities (5 evidence + 5 pattern) + 5 relations across 2 domains migrate cleanly; summary.entitiesMigrated=10, relationsMigrated=5, errorBudget=0.
2. **Idempotence** — First run: entitiesMigrated=6. Second run with `--resume`: entitiesSkipped=6, entitiesMigrated=0. ✓
3. **legacyId stamp** — Re-opens target km-core LevelDB after migration; verifies every entity has `legacyId.system === 'C'` AND `legacyId.id === entity.id`. 4/4 pass.
4. **Error budget** — 10 entities with 2 missing `name` field (20% error rate, > 5% threshold); script exits with code 1 and stderr contains `aborted` + `error-budget-exceeded`. ✓
5. **Per-domain bucketing** — 3 entities across general/kpifw/raas; verifies `entity.metadata.subsystem` equals the source filename stem for each. ✓

Full suite after Plan 07: 508/510 (= Plan 06 baseline 503/505 + 5 new). Same 2 pre-existing failures + 7 file-load errors (reference src/llm/providers/ which doesn't exist in OKM).

## Task Commits

**OKM inner repo** (`bmw.ghe.com/.../operational-knowledge-management`):

1. **`b9cd7bc`** — `feat(migration): JSON-replay one-shot migration script + integration test (Phase 43 D-G4.1)`
   - 2 files changed, 758 insertions / 0 deletions (additive only)

**Outer rapid-automations** (`bmw.ghe.com/.../rapid-automations`):

2. **`ec9e78b`** — `chore: bump OKM submodule — Phase 43 Plan 07 (JSON-replay migration)`
   - 1 file changed (gitlink bump `6be0114 → b9cd7bc`)

## Source Files UNTOUCHED Confirmation

```
git -C $OKM status -s .data/exports/   # → empty (no modified files)
git -C $OKM status -s .data/leveldb/   # → empty (legacy LevelDB untouched)
```

The script READS .data/exports/ only. Plan 08 owns:
- `mv .data/leveldb .data/leveldb.pre-43-backup`
- `mv .data/leveldb-kmcore .data/leveldb`
- `mv .data/exports .data/exports.pre-43-backup` (or keep separate?)
- `mv .data/leveldb-kmcore.exports .data/exports`
- Flip `OKB_STORE_BACKEND=km-core` (or similar — Plan 08's call)
- Restart + verify post-cutover REST contract via Plan 06's rest-contract.test.ts.

## Deviations from Plan

**1. exportDir was initially hardcoded to a shared OKM-relative path; caused test contamination.**
- **Found during:** Integration test debugging (test 3 saw 15-27 entities instead of 4).
- **Issue:** First-draft script used `const exportDir = path.resolve(okmRoot, '.data/exports-kmcore')` — a SINGLE shared directory across all script invocations. Each test run accumulated state there; when test 3 opened its IN-PROCESS km-core with its own per-test workDir paths, it round-tripped the LevelDB plus hydration weirdness leaked 11-23 prior-test entities into the count.
- **Fix:** Derive exportDir from --target: `const exportDir = ${targetDir}.exports;`. Each --target run scopes its export state next to its LevelDB; production gets `.data/leveldb-kmcore.exports/`; tests get `${workDir}/leveldb-kmcore.exports/` and clean afterEach.
- **Impact on plan:** Plan 08's atomic swap should move BOTH the LevelDB AND the sibling `.exports` dir together. Plan 08 SUMMARY should document this couple-swap.

**2. ontologyDir fallback for the vendor tarball install.**
- **Found during:** Initial script draft + dry-run.
- **Issue:** The CLAUDE.md ontologyDir-resolver block walks up to km-core's package root then expects `config/ontology/` subdir. The vendor-tarball install used here (Phase 43 Plan 02's vendor tarball) doesn't ship `config/ontology/` at runtime — only `dist/` and source artifacts.
- **Fix:** After the package-root resolution, fall back to OKM's local `ontology/` dir (the source-of-truth ontology OKM already uses; matches src/index.ts:91-92 behavior).
- **Impact on plan:** Plan 08 should verify the new LevelDB's ontology classes match OKM's local ontology dir, not km-core's bundled (which may differ).

**3. Vitest 4 syntax fix in the test file.**
- **Found during:** First test run after authoring.
- **Issue:** Initial draft used `describe(name, fn, { timeout: 30000 })` — vitest 4 deprecated this signature. The error is precise: "Signature `test(name, fn, { ... })` was deprecated in Vitest 3 and removed in Vitest 4. Please, provide options as a second argument instead."
- **Fix:** Move `{ timeout: 30000 }` to be the SECOND arg of each `it(...)` call: `it(name, { timeout: 30000 }, async () => {...})`. Bumped past vitest's 10000ms default because each test spawns a Node subprocess (km-core open + LevelDB writes take 100-500 ms each per case).
- **Impact on plan:** None on Plan 07 deliverable, but worth surfacing as a pattern note (rest of the OKM tests still use vitest 3 syntax silently — they only break if they pass an options object).

**4. exit codes for normal vs aborted runs.**
- **Found during:** Test 4 (error budget abort) wiring.
- **Issue:** Phase 42 template uses `process.exit(1)` for budget exceeded vs `process.exit(0)` for success. My script does the same but the test expected exit code 1, which matched. No actual deviation — just noting the pattern is preserved.
- **Fix:** None needed.
- **Impact on plan:** None.

**Total deviations:** 3 (architectural/mechanical) + 1 (false alarm).

## Issues Encountered

- **Initial determinism / state-leak debugging consumed ~10 min** because the test failure mode (count off by 11-23 instead of 0) didn't immediately point at a shared exportDir. Once spotted, the fix was a one-line sibling-derive.

- **No explicit relation between test entities and production migration verification.** The 5 integration test cases use synthetic 4-10-entity fixtures; the production run verifies 1665 entities. The link between them is the SCRIPT (single SUT), and the post-migration inline verification (count + legacyId + per-subsystem). Plan 10 will re-run Plan 06's `rest-contract.test.ts` against the cut-over store as the cross-system verification spine.

- **The orphan `src/ontology/{registry,loader}.ts` from Plan 04 remain queued for Plan 08's final-cleanup.** Plan 07 doesn't touch them. Plan 08's grep gate (zero local-ontology imports remaining) will surface them at that point.

## User Setup Required

After Plan 08's atomic swap takes effect, the operator can re-run the recorder (Plan 06's recorder script) against the cut-over store and verify the REST contract test still passes byte-equally. The production migration done here is the data side; Plan 08 wires the runtime to consume it.

If the operator wants to refresh `.data/leveldb-kmcore/` (e.g., after a new wave of ingestions into `.data/exports/`), re-run:

```bash
cd /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management
rm -rf .data/leveldb-kmcore .data/leveldb-kmcore.exports   # clean slate
node scripts/migrate-okm-json-to-kmcore.mjs --run-id="phase-43-prod-refresh-$(date -u +%Y%m%dT%H%M%SZ)"
```

`--resume` works for incremental refreshes (skips entities whose legacyId already exists in target).

## Next Phase Readiness

**Plan 43-08 (storage cutover) unblocked.** The new LevelDB + per-domain exports sit ready at `.data/leveldb-kmcore/` + `.data/leveldb-kmcore.exports/`. Plan 08 needs to:

1. Stop OKM (gracefully or kill the process — Plan 08 picks).
2. `mv .data/leveldb .data/leveldb.pre-43-backup`
3. `mv .data/leveldb-kmcore .data/leveldb`
4. **Couple the sibling exports dir too:** `mv .data/exports .data/exports.pre-43-backup` (or keep them separate — Plan 08's call); `mv .data/leveldb-kmcore.exports .data/exports`
5. Flip `OKB_STORE_BACKEND=km-core` in env or index.ts default.
6. Start OKM.
7. Verify via Plan 06's `rest-contract.test.ts`.

**Plan 43-09 (embedding rehydration)** can proceed concurrent with or after Plan 08. The migrated entities don't carry embeddings (OKM's exports don't include them); Plan 09 generates fresh embeddings using the km-core embedding pipeline.

**Plan 43-10 (post-cutover verification)** runs Plan 06's tests against the cut-over store. Pass = D-G5.1 SC#3 satisfied. Fail = the cutover changed a REST shape unexpectedly.

---
*Phase: 43-okm-cross-repo-migration-c*
*Plan: 07 (Wave 3)*
*Completed: 2026-05-31*
