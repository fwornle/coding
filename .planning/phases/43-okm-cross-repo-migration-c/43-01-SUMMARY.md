---
phase: 43-okm-cross-repo-migration-c
plan: 01
subsystem: km-core
tags: [km-core, ontology, entity-schema, cross-repo, vendor-tarball]

requires:
  - phase: 42-offline-ukb-migration-b
    provides: D-52 optional first-class Entity field pattern; D-52c fastembed/AllMiniLM/384-dim model lock
  - phase: 38-ontology-registry
    provides: OntologyRegistry public surface (isValidClass, getClass, getAllClassNames, getClassesForPrompt, getDefaultLayer, getValidRelationships, getLoadedDomains)
  - phase: 37-km-core-foundation
    provides: Canonical Entity type + GraphKMStore + exportJson contract

provides:
  - Stable km-core HEAD (SHA 962de7555d3db237b55372a3952e587c15a68b6d, tag v0.1.0-phase43-verified) for Plan 43-02 vendor-tarball pin
  - Round-trip test contract locking Entity.layer ('evidence' | 'pattern') across putEntity → getEntity → iterate → exportJson
  - Documented call-site adaptation for Plan 43-04 (OKM `new OntologyRegistry()` + `.load(dir)` → km-core `new OntologyRegistry({ ontologyDir })`)

affects: [43-02-okm-submodule, 43-04-ontology-unification, 43-08-storage-cutover]

tech-stack:
  added: []
  patterns:
    - "Cross-repo pre-req verification with no source change"
    - "Outcome A/B decision branching in pre-req plans (avoid unilateral breaking changes)"

key-files:
  created:
    - /Users/Q284340/Agentic/km-core/tests/unit/entity-layer-field.test.ts
    - /Users/Q284340/Agentic/km-core/CHANGELOG.md
  modified: []

key-decisions:
  - "Outcome A on both responsibilities: no src/ change in km-core. Schema already supports OKM's evidence/pattern split."
  - "Stay at version 0.1.0 (tests + CHANGELOG only — no public surface change). Tag v0.1.0-phase43-verified pins HEAD for Plan 43-02."
  - "OKM's `.load(dir)` two-step is NOT a km-core gap — Plan 43-04 adapts the OKM call site to km-core's constructor idiom."

patterns-established:
  - "Cross-repo pre-req verification: read source, decide Outcome A (no change) vs Outcome B (BLOCKED — surface for operator), prefer A; never make unilateral breaking changes across repo boundaries."
  - "Verification tag (v0.1.0-phase43-verified) instead of version bump when no public-surface change shipped."

requirements-completed: [INT-03]

duration: 12min
completed: 2026-05-31
---

# Phase 43 Plan 01: km-core Pre-req Verification

**No-schema-change verification + 3 round-trip tests + verification tag — km-core is ready for OKM's Plan 43-02 vendor pin at SHA `962de7555d3db237b55372a3952e587c15a68b6d`.**

## Performance

- **Duration:** ~12 min
- **Completed:** 2026-05-31T09:50Z
- **Tasks:** 3 (all completed)
- **Files created in km-core:** 2 (CHANGELOG.md, tests/unit/entity-layer-field.test.ts)

## Accomplishments

- **Outcome A on D-G4.2** — verified `Entity.layer: 'evidence' | 'pattern'` is already REQUIRED on the canonical Entity (`src/types/entity.ts:27,120`). No schema change shipped to km-core. D-G4.2's "add `layer?`" wording reflected OKM-local perspective; km-core has supported the OKM-style evidence/pattern split since Phase 37.
- **Outcome A on OntologyRegistry parity** — grep against `src/ontology/registry.ts` returned 10 matches for the 6 OKM-required accessors (`isValidClass`, `getClass`, `getAllClassNames`, `getClassesForPrompt`, `getDefaultLayer`, `getLoadedDomains`). All present at lines 173, 177, 181, 189, 201, 211. Plus `getValidRelationships` (line 205). No accessors added.
- **Round-trip tests** covering `layer:'evidence'`, `layer:'pattern'`, and `exportJson` JSON-export round-trip in `tests/unit/entity-layer-field.test.ts`. Locks the contract so OKM consumers (Plan 04+) cannot regress silently.
- **Verification tag** `v0.1.0-phase43-verified` cut on HEAD `962de7555d3db237b55372a3952e587c15a68b6d`. Plan 43-02 pins this SHA via OKM's vendor tarball.
- **Test suite green**: km-core baseline 242 → 245 passing (28 → 29 files). Zero regression.

## Task Commits

km-core repo (separate from coding repo):

1. **Tasks 1–3 combined** — `962de7555d3db237b55372a3952e587c15a68b6d` (chore(43-01))
   - Added `tests/unit/entity-layer-field.test.ts` (3 tests, all green)
   - Added `CHANGELOG.md` documenting verification outcome + Plan 43-04 adaptation note
   - Tag: `v0.1.0-phase43-verified`

Per the plan, Tasks 1–3 were committed atomically — Task 1 added the test, Task 2 was a no-op grep verification, Task 3 added the CHANGELOG + tag. A single commit captures the verification fact.

## Files Created/Modified

**In `~/Agentic/km-core/`:**
- `tests/unit/entity-layer-field.test.ts` (123 lines) — 3 round-trip tests for `Entity.layer` covering both `'evidence'` and `'pattern'` values via `putEntity → getEntity`, `iterate`, and `exportJson` (with regex matcher for pretty-printed JSON output)
- `CHANGELOG.md` (44 lines) — Keep-a-Changelog format. Documents Phase 43 pre-req verification, what was NOT changed (schema, registry surface), and the Plan 43-04 call-site adaptation OKM must do (its own `load(dir)` two-step → km-core's constructor `{ ontologyDir }` idiom).

**Untouched (despite plan suggesting they MIGHT need edits):**
- `src/types/entity.ts` — no change (Outcome A)
- `src/ontology/registry.ts` — no change (all accessors present)
- `package.json` — version stays at `0.1.0` (no `src/` change shipped)

## Decisions Made

- **Stay at version 0.1.0**, do NOT bump to 0.2.0. The plan's bump rule is "any source change → bump"; since neither Task 1 nor Task 2 touched `src/`, the version is unchanged. The verification tag `v0.1.0-phase43-verified` provides Plan 43-02's pinpoint without inflating the version number.
- **Use regex matcher (`/\"layer\"\s*:\s*\"pattern\"/`) instead of literal substring in the JSON-export test.** km-core's exporter pretty-prints with 2-space indent (`"layer": "pattern"` with a space), so the plan's suggested `'"layer":"pattern"'` literal substring would have failed. The regex preserves the assertion's intent (the literal value survives serialization) while matching either spacing style.
- **Do NOT add a `load(ontologyDir)` shim to km-core.** OKM's `ontologyRegistry.load(dir)` call site at `_work/.../okm/src/index.ts:89` is the only difference; adding a shim would inflate km-core's public surface for a single OKM-specific concession. Plan 43-04 swaps the OKM call site to km-core's constructor idiom — cleaner adaptation that respects km-core's existing design (D-28 options-object constructor).

## Deviations from Plan

**1. JSON-export assertion: literal substring → regex matcher**
- **Found during:** Task 1 (first test run after writing entity-layer-field.test.ts)
- **Issue:** Plan suggested asserting `raw.contains('"layer":"pattern"')`. Actual exporter output is `"layer": "pattern"` (pretty-printed with space).
- **Fix:** Changed matcher to `expect(raw).toMatch(/"layer"\s*:\s*"pattern"/)`.
- **Files modified:** `~/Agentic/km-core/tests/unit/entity-layer-field.test.ts`
- **Verification:** Test goes from FAIL → PASS; all 3 tests green; full suite still 245/245.
- **Committed in:** `962de7555` (part of the combined Task 1–3 commit)
- **Impact on plan:** Zero. The intent (verify `pattern` value survives serialization) is preserved.

**2. Task 3 version bump: 0.2.0 → 0.1.0**
- **Found during:** Pre-commit review (Task 3 setup)
- **Issue:** Plan task 3 step 1 says "If Task 1 took Outcome A AND Task 2 found all accessors already present → NO source code changed in km-core; version stays at 0.1.0". Both conditions matched. The 0.2.0 bump path is for the inverse case.
- **Fix:** Stayed at 0.1.0, cut tag `v0.1.0-phase43-verified` (the plan's suggested tag name for this branch).
- **Files modified:** None (package.json unchanged).
- **Committed in:** N/A — non-action.
- **Impact on plan:** This is the plan's expected path, not a deviation. Documenting for clarity.

**Total deviations:** 1 actual auto-fix (JSON-export matcher) + 1 non-deviation noted for clarity. No scope creep; no security implications.

## Issues Encountered

- **Test baseline figure was stale in the plan.** Plan acceptance criterion expected ≥59 tests after Task 1 (56 baseline + 3 new), citing Phase 38-06 SUMMARY. The actual current km-core baseline is 242 tests (Phase 42 added many embeddings + maintenance tests). Final count: 245 (= 242 + 3). Acceptance criterion's intent — "regression-free addition" — is satisfied; the absolute floor is just out of date.

## User Setup Required

None — no external service configuration touched. Plan 43-02 will set up the OKM-side vendor tarball pipeline; that's where any submodule-bootstrap user setup lands.

## Next Phase Readiness

**Plan 43-02 unblocked.** Pin point ready:

- **SHA:** `962de7555d3db237b55372a3952e587c15a68b6d`
- **Tag:** `v0.1.0-phase43-verified`
- **Branch:** `main` (km-core repo)

**Plan 43-04 head's-up:** When swapping OKM's `src/ontology/registry.ts` import to `@fwornle/km-core/ontology`, also rewrite the call site at OKM `src/index.ts:88-89`:

```ts
// Before (OKM idiom):
const ontologyRegistry = new OntologyRegistry();
ontologyRegistry.load(ontologyDir);

// After (km-core idiom):
const ontologyRegistry = new OntologyRegistry({ ontologyDir });
```

This is the only call-site adaptation needed — the 6 lookup methods (`isValidClass`, `getClass`, `getAllClassNames`, `getClassesForPrompt`, `getDefaultLayer`, `getValidRelationships`) all have identical signatures.

**Test contract for OKM consumers:** the 3 round-trip tests in `tests/unit/entity-layer-field.test.ts` are the regression guard. If a future km-core PR breaks `layer:'pattern'` round-trip, OKM's Plan 43-08 cutover would fail — these tests catch it pre-merge.

---
*Phase: 43-okm-cross-repo-migration-c*
*Plan: 01 (Wave 1)*
*Completed: 2026-05-31*
