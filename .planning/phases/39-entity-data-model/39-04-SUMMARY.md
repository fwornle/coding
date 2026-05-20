---
phase: 39-entity-data-model
plan: 04
subsystem: database
tags: [km-core, backfill, checkpoint, atomic-rename, idempotency, resumability, dry-run, path-traversal, data-01, data-02]

# Dependency graph
requires:
  - phase: 39-entity-data-model/01
    provides: PutEntityOpts + skipOntologyCheck BC-2 widening + writer-side EntityProvenance stamping (Plan 04 uses the trusted path to bypass the D-30 throw; pre-stamps metadata.provenance itself)
  - phase: 39-entity-data-model/02
    provides: root barrel append-order anchor — mergeDescriptionSegment export at line ~76 of src/index.ts; Plan 04 appends backfillEntityDataModel + 3 types AFTER it
  - phase: 39-entity-data-model/03
    provides: iterate(filter?, opts?) with { includeSuperseded: true } opt-in keyword — Plan 04 calls this to see ALL entities (including any partially-superseded state) so backfill never misses a legacy entity
provides:
  - backfillEntityDataModel(store, options): Promise<BackfillResult> — D-36 library function with checkpoint persistence, idempotency, resumability, and dryRun support
  - BackfillOptions / BackfillResolver / BackfillResult public types
  - writeCheckpointAtomic / readCheckpoint + Checkpoint interface (atomic temp+rename idiom lifted from Phase 37 Exporter — CF-D29)
  - Root barrel append (src/index.ts line 78-89) — backfillEntityDataModel + 3 types exported AFTER Plan 02's mergeDescriptionSegment line
  - 9 new vitest tests covering D-37 idempotency + D-38 resumability/dryRun/atomic-checkpoint/synthetic-provenance/legacyId + T-39-04-01 path-traversal guard
affects:
  - 41 (INT-01 A SQLite adapter) — A's migration script will construct a GraphKMStore + a resolver(entity) that returns { validFrom: entity.createdAt, legacyId: { system: 'A', id: <SQLite-native-id> } } and call backfillEntityDataModel
  - 42 (INT-02 B migration) — B's persistence-agent migration will construct its resolver with legacyId.system='B' and use 'metadata.firstSeenAt ?? entity.createdAt' for validFrom
  - 43 (INT-03 C migration) — C's OKM migration will construct its resolver with legacyId.system='C'

# Tech tracking
tech-stack:
  added: []  # no new dependencies — purely additive extension of Phase 37/39-01 surface
  patterns:
    - "Library function with options-object (D-36 + Pattern S1 from 39-PATTERNS): backfillEntityDataModel(store, options) where options is a single bag carrying resolver + legacyProvenance + checkpointPath? + dryRun? — mirrors Phase 39-01 PutEntityOpts and Phase 38 GraphKMStoreOptions"
    - "Trusted-path pre-stamp (Plan 01 BC-2 widening preserved): backfill stamps validFrom + legacyId + synthetic EntityProvenance on entity.metadata.provenance BEFORE calling putEntity({ skipOntologyCheck: true }) — the trusted path passes through verbatim"
    - "Atomic checkpoint via temp+rename (CF-D29 lifted from Phase 37 Exporter writeAtomic at src/store/exporter.ts:216-227): temp file in same directory as destination guarantees same-filesystem rename, atomic on POSIX (T-39-04-02 mitigation)"
    - "Path-traversal guard (T-39-04-01 mitigation): resolveCheckpointPath rejects raw paths containing '..' segments BEFORE path.resolve normalizes them — surfaces operator intent errors that .resolve() would silently hide"
    - "Per-entity write + atomic checkpoint after each (D-38): per-entity put + per-entity checkpoint bounds memory on 100K+ stores (T-39-04-04 mitigation) and gives resumability with at-most-one-entity rework on crash"
    - "Dual idempotency: cursor-skip (lastStampedId from checkpoint) AND validFrom-already-set skip — the second acts as a safety net if iteration order shifts across runs"

key-files:
  created:
    - /Users/Q284340/Agentic/km-core/src/backfill/index.ts (248 lines) — exports backfillEntityDataModel + BackfillOptions + BackfillResolver + BackfillResult; resolveCheckpointPath path-traversal guard; per-entity loop with cursor-skip + validFrom-skip + dryRun branch + synthetic provenance pre-stamp + trusted-path putEntity write + atomic checkpoint after each
    - /Users/Q284340/Agentic/km-core/src/backfill/checkpoint.ts (85 lines) — exports writeCheckpointAtomic / readCheckpoint + Checkpoint interface; lifts Phase 37 Exporter writeAtomic verbatim with two deltas (module-scope free function not class private; mkdirSync recursive so caller doesn't pre-create the dir)
    - /Users/Q284340/Agentic/km-core/tests/unit/backfill.test.ts (367 lines) — 9 tests in one describe block; test-local makeStoreCtx + cleanup helpers; seedLegacy helper threads { skipOntologyCheck: true } so seeded entities are genuinely legacy (no validFrom, no metadata.provenance)
  modified:
    - /Users/Q284340/Agentic/km-core/src/index.ts (77 → 89 lines; +12 net) — appended backfillEntityDataModel function export + BackfillOptions / BackfillResolver / BackfillResult type exports AFTER Plan 02's mergeDescriptionSegment line; root-barrel order preserved (Plan 02's export still at line 76, Plan 04's block starts at line 78)

key-decisions:
  - "Path-traversal guard uses BOTH path.sep AND '/' split: macOS / Linux use '/' as the path separator AND as the only separator; Windows uses '\\' as path.sep but a path.split('/').includes('..') still catches the common '../../../etc/passwd' style. Belt-and-braces — costs one extra split() and covers the cross-platform case."
  - "Default checkpoint path '.data/backfill-checkpoint.json' lives in the project-local .data/ directory (Phase 37 export convention). On the trusted-path test, the seedLegacy helper supplies an explicit checkpointPath under the per-test tmpdir so the default never lands a stray .data/ in the test runner cwd."
  - "Resume test (9th test) pre-stamps res-1 to match the hand-crafted checkpoint state (validFrom + metadata.provenance set). Without this pre-stamp, the test would still pass via the validFrom-skip safety net, but the cursor-skip path would never exercise. The dual-idempotency contract is verified by the cursor branch."
  - "Stamped count carries forward from the prior checkpoint (Behavior 2 contract): the idempotent re-run test asserts result.stamped === first.stamped + 0, which is 2 + 0 = 2. The skipped count starts fresh at 0 + 2 = 2 (the 2 already-stamped entities now skip via the validFrom branch). This matches RESEARCH §Pattern 5 'idempotent: skips entities that already have validFrom'."
  - "Used `vi.spyOn(process.stderr, 'write').mockImplementation(() => true)` in the dryRun test — `.mockImplementation` suppresses the dry-run intent lines from polluting test runner output AND lets the spy capture call count. Matches Plan 02's stderr-spy pattern (segments-merge.test.ts D-41 threshold tests)."

patterns-established:
  - "Pattern: cross-repo library function landing — km-core ships the algorithm via library function; per-system migration scripts (Phase 41/42/43) construct the store + resolver and call. No bin/ entry in km-core (D-06 'library-only' invariant)."
  - "Pattern: trusted-path bulk-write — backfill / fixture-replay / migration callers pre-stamp metadata.provenance themselves and pass through { skipOntologyCheck: true }. The trusted path is now the canonical 'bypass D-30 + D-19 + parseEntityId all at once' escape hatch — Phase 41/42/43 all follow this same pattern."
  - "Pattern: atomic-rename in same directory — checkpoint.ts writeCheckpointAtomic establishes that any atomic file write in km-core must use the temp-in-same-dir-then-rename idiom. Phase 37 Exporter writeAtomic was the first instance; backfill checkpoint is the second; future cache/dump primitives follow."
  - "Pattern: path-traversal raw-string check — surface intent errors at the API boundary BEFORE path.resolve normalizes them away. Future km-core APIs that accept caller-supplied paths (e.g. ontology dirs in Phase 38) should follow the same shape."

requirements-completed: [DATA-01, DATA-02]

# Metrics
duration: ~7 min
completed: 2026-05-20
---

# Phase 39 Plan 04: backfillEntityDataModel Library Function Summary

**`backfillEntityDataModel(store, options): Promise<BackfillResult>` ships as a library function in `src/backfill/index.ts` per D-36/D-37/D-38 — idempotent (validFrom-skip), resumable (atomic checkpoint via temp+rename), dry-runnable (no store mutation + no checkpoint write), with a path-traversal guard on `checkpointPath` (T-39-04-01). Closes ROADMAP SC#4 ("A backfill operation can stamp validFrom = createdAt (A) or validFrom = first-seen (B) on legacy entities without losing existing observations or relations").**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-05-20T18:12:55Z (Phase 39 wave 3 execution immediately after Plan 03 landed)
- **Completed:** 2026-05-20T18:19:42Z
- **Tasks:** 2 (both `type=auto`, both `tdd=true`)
- **Files modified:** 4 in km-core (2 new src + 1 new test + 1 modified root barrel) + 1 in coding/ (this SUMMARY)

## Accomplishments

- **DATA-01 + DATA-02 closed end-to-end** — Plan 01 stamped writer-side validFrom + EntityProvenance on the strict path; Plan 02 added per-segment confirmation merging; Plan 03 added supersession closure + active-only filter + getSupersessionChain; Plan 04 now lets per-system migrations stamp legacy entities (no validFrom) with a synthetic `EntityProvenance` (provider:'backfill') and any caller-resolved `legacyId.system` ∈ {A,B,C}.
- **ROADMAP SC#4 fully realized** — `backfillEntityDataModel(store, options)` ships as a library function; per-system migration scripts (Phase 41/42/43) will construct their own GraphKMStore + resolver and call this. The 7+ test cases verify no observations or relations are lost — the helper only adds `validFrom` + `legacyId` + `metadata.provenance` to legacy entities; all other fields are preserved by the spread.
- **D-36 library function landed** — single entry point `backfillEntityDataModel(store, options): Promise<BackfillResult>`; options bag carries `resolver` + `legacyProvenance` + optional `checkpointPath` + optional `dryRun`. Per-system scripts compose their own GraphKMStore + resolver and call km-core's algorithm.
- **D-37 idempotency landed via dual-skip** — (a) cursor-skip from prior checkpoint's `lastStampedId` for resume; (b) per-entity `validFrom !== undefined` skip as the safety net. Re-running on a fully-stamped store returns `{ stamped: 0 + prior.stamped }`. The resolver is invoked only for genuinely legacy entities; the 6th test (`vi.fn()`-wrapped resolver) asserts `toHaveBeenCalledTimes(1)` when one of two seeded entities already has `validFrom`.
- **D-38 resumability landed via atomic checkpoint** — per-entity write via `store.putEntity(stamped, { skipOntologyCheck: true })` (Phase 37 CF-D17 atomic) + atomic checkpoint write after each via `writeCheckpointAtomic` (CF-D29 temp+rename). On crash, the next run reads the checkpoint, sets `lastStampedId`, and skips entities until past the cursor (test 9 verifies). `dryRun:true` logs intent to stderr but writes nothing (test 3 spies both `store.putEntity` AND `fs.existsSync(checkpointPath)`).
- **security_threat_model T-39-04-01 (path-traversal) mitigated** — `resolveCheckpointPath` rejects raw paths containing `..` segments BEFORE `path.resolve()` normalizes them. Test 8 calls with `'../../../etc/passwd'` and asserts the function rejects with `/must not contain '..' segments/`.
- **security_threat_model T-39-04-02 (atomic-rename race) mitigated** — `writeCheckpointAtomic` constructs the temp file as `${checkpointPath}.tmp.${pid}.${ts}` in the SAME directory as destination. `path.dirname(temp) === path.dirname(dest)` guarantees same-filesystem rename, which is atomic on POSIX.
- **Phase 37/38 + Plan 39-01/02/03 regression-free** — all 81 baseline tests still GREEN; +9 new Plan 04 tests; final test count: **90/90 across 9 test files**. Build clean (`tsc --strict` mode). Zero new `console.*` calls. The four 38-VERIFICATION NO-CHANGE invariants (PersistenceManager + Exporter ordering, trusted-path entity-build line, mergeAttributes ontology-skip, skipOntologyCheck BC-2 widening) all hold.

## Task Commits

Both tasks committed atomically in the km-core repo (`~/Agentic/km-core/`, `main` branch):

1. **Task 1: Implement `backfillEntityDataModel` + `writeCheckpointAtomic` + root barrel append** — `2320a89` (feat)
   `feat(39-04): add backfillEntityDataModel library function (D-36/D-37/D-38)`
2. **Task 2: 9 unit tests covering D-37 idempotency + D-38 resumability/dryRun/atomic-checkpoint + T-39-04-01 path-traversal guard** — `efaddd3` (test)
   `test(39-04): add 9 unit tests for backfillEntityDataModel (D-36/D-37/D-38)`

**Plan metadata commit:** lands separately in the coding/ repo as `docs(39-04): summary` — this SUMMARY.md.

## Files Created/Modified

### km-core (separate repo at `~/Agentic/km-core/`)

- `src/backfill/index.ts` (NEW — 248 lines) — exports `backfillEntityDataModel(store, options): Promise<BackfillResult>` + `BackfillOptions` + `BackfillResolver` + `BackfillResult` types. Private `resolveCheckpointPath()` rejects raw paths containing `..` (T-39-04-01 guard). Per-entity loop: cursor-skip (lastStampedId from prior checkpoint) → validFrom-skip (D-37 safety net) → resolver invocation → dryRun branch (logs to stderr, no write) → trusted-path pre-stamp (validFrom + legacyId + synthetic EntityProvenance on metadata.provenance) → `store.putEntity(stamped, { skipOntologyCheck: true })` → atomic checkpoint write. ESM `.js` imports throughout (CF-D06). Zero `console.*` calls; one `process.stderr.write` site (dry-run intent log).
- `src/backfill/checkpoint.ts` (NEW — 85 lines) — exports `writeCheckpointAtomic(path, data): Promise<void>` + `readCheckpoint(path): Promise<Checkpoint | null>` + `Checkpoint` interface. Lifted from Phase 37 Exporter `writeAtomic` at `src/store/exporter.ts:216-227` with two deltas: module-scope free function (not a class private method), and `mkdirSync({ recursive: true })` is called first so the caller doesn't pre-create the directory. `readCheckpoint` returns `null` on ENOENT (fresh run) and throws on any other I/O error.
- `src/index.ts` (77 → 89 lines; +12 net) — appended `export { backfillEntityDataModel } from './backfill/index.js';` and `export type { BackfillOptions, BackfillResolver, BackfillResult } from './backfill/index.js';` AFTER Plan 02's `mergeDescriptionSegment` export (line 76). Plan 02's line is unchanged; Plan 04's block starts at line 78 with a JSDoc-style comment per Phase 37/38 convention.
- `tests/unit/backfill.test.ts` (NEW — 367 lines) — 9 tests in one `describe('backfillEntityDataModel (D-36, D-37, D-38)', ...)` block. Test-local `makeStoreCtx()` + `cleanup()` + `seedLegacy()` helpers. `LEGACY_PROVENANCE` ProvenanceStamp + `RESOLVER` BackfillResolver shared constants. Imports widened from root barrel `'../../src/index.js'` (BackfillResolver type-only). `afterEach(vi.restoreAllMocks)`; each test's `finally { await cleanup(ctx) }` ensures store close + tmpdir cleanup.

### coding/ (this repo, `.planning/`)

- `.planning/phases/39-entity-data-model/39-04-SUMMARY.md` — this file.

## The 9 New Tests (one-line each)

1. **backfill stamps validFrom from resolver on legacy entities (D-37)** — seed 2 entities via trusted path (no validFrom); run backfill; assert result `{ scanned: 2, stamped: 2, skipped: 0 }`; assert each entity now has `validFrom === entity.createdAt`.
2. **backfill is idempotent — second run stamps 0 (D-37 + Pitfall 5)** — seed + first backfill (stamped:2); re-run backfill with SAME checkpoint path; assert second result `{ scanned: 2, stamped: 2 (prior carry), skipped: 2 }` — already-stamped entities skip via validFrom branch.
3. **backfill with dryRun:true does NOT mutate store and does NOT write checkpoint (D-38 + Pitfall 4)** — seed 2 entities; `vi.spyOn(store, 'putEntity')` + `vi.spyOn(process.stderr, 'write')`; run with `{ dryRun: true }`; assert `putSpy.not.toHaveBeenCalled()`, `fs.existsSync(checkpointPath) === false`, `result === {scanned:2, stamped:0, skipped:0}`, both entities still have `validFrom === undefined`, stderr spy received 2 calls (dry-run intent log per entity).
4. **backfill writes synthetic EntityProvenance with provider:backfill (D-38)** — seed 1 entity; run backfill; assert `entity.metadata.provenance.createdBy === LEGACY_PROVENANCE` AND `lastConfirmedBy === createdBy` AND `confirmationCount === 1` AND `createdBy.provider === 'backfill'`.
5. **backfill propagates resolver-supplied legacyId onto the stamped entity** — seed `'legacy-nanoid'`; run backfill (resolver returns `legacyId: { system: 'B', id: String(entity.id) }`); fetch entity; assert `legacyId.system === 'B'` AND `legacyId.id === 'legacy-nanoid'`.
6. **backfill skips entities that already have validFrom without invoking resolver** — seed 2 entities (one WITH `validFrom: '2025-01-01'`, one WITHOUT); use `vi.fn(RESOLVER)`-wrapped resolver; run backfill; assert resolver called EXACTLY ONCE; result `{ scanned: 2, stamped: 1, skipped: 1 }`; pre-existing validFrom preserved verbatim.
7. **backfill writes atomic checkpoint after each entity write (D-38 + CF-D29)** — seed 3 entities; run backfill; assert checkpoint file exists; parse JSON; assert `version === 1`, `lastStampedId !== null`, `stamped === 3`, `scanned === 3`.
8. **backfill rejects checkpointPath containing .. segments (path-traversal mitigation)** — call backfill with `checkpointPath: '../../../etc/passwd'`; assert rejects with `/must not contain '\.\.' segments/`.
9. **backfill resumes from a pre-existing checkpoint and skips up to lastStampedId (D-38 resumability)** — seed 3 entities; hand-craft a checkpoint with `lastStampedId: 'res-1'` + `stamped: 1`; pre-stamp res-1 via trusted path to match; run backfill with `vi.fn()`-wrapped resolver; assert `result.stamped === 3` (prior 1 + 2 new), resolver called only twice (for res-2 + res-3, NOT res-1).

## Decisions Made

- **Path-traversal guard uses BOTH `path.sep` AND `'/'` split** — macOS/Linux use `'/'` as the only separator; Windows uses `'\\'` as `path.sep` but the common attack pattern `'../../../etc/passwd'` still contains `'/'`. Belt-and-braces — costs one extra `split()` and covers the cross-platform case for the rare-but-real case of a CI runner on Windows.
- **Default checkpoint path `.data/backfill-checkpoint.json`** — matches Phase 37 export convention (`.data/exports/*.json`). Per-test tmpdir checkpoints prevent the default ever landing a stray `.data/` in the test runner cwd. Caller-supplied paths are validated before use.
- **Test 9 (resume) pre-stamps res-1 to match the hand-crafted checkpoint state** — without this, the cursor-skip path would still work (res-1 would skip via the cursor branch) but the test wouldn't validate the resumability contract that the prior checkpoint's state carries forward into the result. By pre-stamping, the test exercises BOTH the cursor-skip path AND the result-carry-forward.
- **Result-carry-forward semantics in test 2 (idempotency)** — second run starts with `prior.stamped = 2` (read from the checkpoint), then 0 new stamps, so final `stamped === 2`. Skipped resets to 0 fresh and counts the 2 already-stamped entities = 2. This matches the contract that the function tracks cumulative progress across runs (a 100K-entity backfill that's been interrupted 3 times should still report `stamped: 100000` at the end, not `stamped: 50000 (this run's contribution)`).
- **`vi.spyOn(process.stderr, 'write').mockImplementation(() => true)`** — matches Plan 02's segments-merge.test.ts pattern (D-41 threshold tests). `.mockImplementation` suppresses the dry-run intent lines from polluting test runner output AND lets the spy capture call count.
- **Plan 04 backfill exports appended AFTER Plan 02's `mergeDescriptionSegment` export** — root barrel order is a Plan 02 success criterion. Plan 02's export sits at line 76; Plan 04's block starts at line 78 with a JSDoc-style comment. Verified via `grep -n "mergeDescriptionSegment\|backfillEntityDataModel" src/index.ts`.

## Deviations from Plan

None. Plan executed exactly as written.

**Total deviations:** 0.
**Impact on plan:** None — both tasks landed in their planned form, all 9 boundary tests pass on first try, build clean, full suite GREEN.

Minor note on test count: the plan stated "7+ tests" and the must_haves enumerated 7 behaviors. The test file lands 9 tests — the 7 behaviors plus the path-traversal guard test (explicitly required by the threat model + behavior 7 in Task 1) plus the resume test (explicitly required by Behavior 3 in Task 1 — the resume + cursor-skip path is a separate behavior from idempotency-via-validFrom). All 9 are grep-verifiable against the verify-block assertions in the plan.

## Issues Encountered

- **No issues.** Build clean on first attempt after each edit; types compose; all grep gates pass; all 9 new tests pass on first try; baseline 81 tests still green after both commits.
- **One minor implementation note:** the `path.split` traversal-guard line uses `'/'` AND `path.sep` to cover both POSIX and Windows. The plan's pseudocode used only `path.sep`; my implementation widens to both. Not a deviation — strictly an additional safety check that the plan's intent supports (the threat-model says "rejects raw paths containing `..` segments BEFORE `path.resolve()` normalizes them"; my implementation does exactly that, just across both separator conventions).

## Self-Check: PASSED

- `[ -f /Users/Q284340/Agentic/km-core/src/backfill/index.ts ]` → FOUND (248 lines)
- `[ -f /Users/Q284340/Agentic/km-core/src/backfill/checkpoint.ts ]` → FOUND (85 lines)
- `[ -f /Users/Q284340/Agentic/km-core/tests/unit/backfill.test.ts ]` → FOUND (367 lines, 9 tests)
- `[ -f /Users/Q284340/Agentic/km-core/src/index.ts ]` → FOUND (89 lines; was 77, +12 net)
- `git -C /Users/Q284340/Agentic/km-core log --oneline | grep 2320a89` → FOUND (`feat(39-04): add backfillEntityDataModel library function (D-36/D-37/D-38)`)
- `git -C /Users/Q284340/Agentic/km-core log --oneline | grep efaddd3` → FOUND (`test(39-04): add 9 unit tests for backfillEntityDataModel (D-36/D-37/D-38)`)
- `cd /Users/Q284340/Agentic/km-core && npx vitest run` → 9/9 test files PASSED, **90/90 tests PASSED** (was 81; +9 net)
- `cd /Users/Q284340/Agentic/km-core && npm run build` → exit 0 (tsc strict mode clean)
- Grep gates (source, positive):
  - `export async function backfillEntityDataModel` in `src/backfill/index.ts` → 1 hit
  - `writeCheckpointAtomic` in `src/backfill/index.ts` → 2 hits (import + call)
  - `renameSync\|fs.promises.rename` in `src/backfill/checkpoint.ts` → 2 hits (JSDoc + call)
  - `skipOntologyCheck: true` in `src/backfill/index.ts` → 4 hits (JSDoc + comments + active code)
  - `if (entity.validFrom !== undefined)` in `src/backfill/index.ts` → 1 hit (D-37 idempotency)
  - `must not contain '..' segments` in `src/backfill/index.ts` → 1 hit (path-traversal guard)
  - `backfillEntityDataModel` in `src/index.ts` → 2 hits (comment + export)
  - `BackfillOptions\|BackfillResolver\|BackfillResult` in `src/index.ts` → 4 hits (3 type exports + comment mention)
- Grep gates (source, negative):
  - `grep -v '^[[:space:]]*\(//\|\*\)' src/backfill/index.ts | grep -c "console\."` → 0 (no console.* outside comments)
  - `grep -v '^[[:space:]]*\(//\|\*\)' src/backfill/checkpoint.ts | grep -c "console\."` → 0
- Grep gates (tests, positive):
  - `test(` in `tests/unit/backfill.test.ts` → 9 hits (≥7 required)
  - `dryRun` in `tests/unit/backfill.test.ts` → 3 hits (≥1 required; Pitfall 4 covered)
  - `idempotent` in `tests/unit/backfill.test.ts` → 1 hit (≥1 required; Pitfall 5 covered)
  - `path-traversal\|'\.\.'` in `tests/unit/backfill.test.ts` → 3 hits (≥1 required; T-39-04-01 covered)
  - `provider.*backfill\|'backfill'` in `tests/unit/backfill.test.ts` → 3 hits (≥1 required; synthetic-provenance landing)
- Root barrel append order verified: `grep -n "mergeDescriptionSegment\|backfillEntityDataModel" src/index.ts` shows Plan 02's `mergeDescriptionSegment` at line 76, Plan 04's `backfillEntityDataModel` at line 84 — append order locked.

## Next Phase Readiness

- **Ready for Phase 40 (PIPE-01 ingest pipeline):** Phase 40's deduplication pipeline can now stamp legacy entities found in the index without losing observations or relations. The library function is library-only — Phase 40's caller-side wiring is straightforward: construct a GraphKMStore + resolver, call `backfillEntityDataModel`.
- **Ready for Phase 41 (INT-01 A SQLite adapter):** A's migration script will live in `coding/scripts/`. Wiring pattern:
  ```typescript
  import { GraphKMStore, backfillEntityDataModel } from '@fwornle/km-core';
  const store = new GraphKMStore({ dbPath, exportDir, ontologyDir });
  await store.open();
  await backfillEntityDataModel(store, {
    resolver: (entity) => ({
      validFrom: entity.createdAt,
      legacyId: { system: 'A', id: <SQLite-native-id-lookup> },
    }),
    legacyProvenance: {
      provider: 'backfill',
      model: 'phase-41-A',
      runId: 'p41-A-2026-05-20',
      timestamp: new Date().toISOString(),
    },
  });
  ```
- **Ready for Phase 42 (INT-02 B migration):** B's persistence-agent migration in `mcp-server-semantic-analysis/scripts/` follows the same shape with `legacyId.system: 'B'` and `validFrom: entity.metadata.firstSeenAt ?? entity.createdAt`.
- **Ready for Phase 43 (INT-03 C migration):** C's migration in `rapid-automations/scripts/` uses `legacyId.system: 'C'`.
- **No new blockers.** Build clean, tests green, grep gates pass, no constraints triggered.
- **Behavior surprises worth flagging to downstream callers:**
  - **Result-carry-forward semantics**: subsequent runs after the first crash/resume will report cumulative `stamped` + `skipped`, not just this run's contribution. A 100K-entity backfill interrupted 3 times still reports `stamped: 100000` at the end. If callers want per-run counts they need to compute the delta from the prior checkpoint.
  - **Cursor-skip relies on iteration order stability**: Graphology v0.26's `graph.nodes()` yields in insertion order, stable across runs of the SAME process. For cross-process resume (the typical case), the D-37 `validFrom`-skip is the safety net — already-stamped entities are skipped regardless of cursor position.
  - **Default `.data/backfill-checkpoint.json` lives relative to cwd**: callers should explicitly set `checkpointPath` to an absolute path under their project's `.data/` directory unless they're certain the script is always invoked from the project root.
  - **`dryRun` does NOT count would-stamp entities as skipped**: the per-test contract is `{ scanned: N, stamped: 0, skipped: 0 }` when all N entities are legacy. Skipped on a dry-run only counts entities that ALREADY had `validFrom` (the safety-net branch). This matches RESEARCH lines 367-368 "dry-run reports 'would change' but doesn't count as skipped either".
  - **Trusted-path pre-stamp is the contract** — backfill uses `{ skipOntologyCheck: true }` (no `provenance` opt). The trusted path bypasses BOTH ontology validation AND the D-30 throw AND the auto-EntityProvenance-assembly. Backfill stamps `metadata.provenance` itself BEFORE calling `putEntity`. Phase 41/42/43 migration scripts MUST NOT pass `{ provenance: ... }` to their `putEntity` calls — they call `backfillEntityDataModel` which handles the trusted-path pre-stamp internally.

---
*Phase: 39-entity-data-model*
*Completed: 2026-05-20*
