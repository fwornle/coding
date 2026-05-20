---
phase: 38-ontology-registry
plan: 05
subsystem: km-core
tags: [km-core, ontology, graph-store, integration, options-extension, getter]

# Dependency graph
requires:
  - phase: 38-03
    provides: "OntologyRegistry class (constructor-injected ontologyDir; reload(); isValidClass(); domains/parentChainOf/provenanceOf accessors)"
  - phase: 38-04
    provides: "registryBackedValidator(registry) factory bridging OntologyValidator interface to the registry; verbatim error-text 'Unknown ontology class: ${entityType}'"
provides:
  - "GraphKMStore constructor accepts ontologyDir?: string + ontologyStrict?: boolean — instantiates OntologyRegistry internally and auto-wires the registry-backed validator (when ontologyDir is set)"
  - "Public store.ontology getter — returns OntologyRegistry | undefined; the consumer-facing handle for reload(), getAllClassNames(), parentChainOf(), domains"
  - "3-way validator resolution chain on GraphKMStore: explicit opts.ontologyValidator > auto-wired registryBackedValidator(registry) > noopOntologyValidator"
affects: [38-06, 41-int-01-pipe-02, 42-okb-migration, 43-okm-migration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Phase-37-preserving additive constructor extension: new option fields default to undefined, the new behavior only fires on opt-in (ontologyDir is set), and the default behavior when neither ontologyDir nor ontologyValidator is supplied is BYTE-IDENTICAL to Phase 37's noopOntologyValidator default — grep-verified by zero changes to the `validate` call sites"
    - "Validator resolution chain — explicit > auto-wired > default — implemented via nested nullish-coalescing on the validator assignment: `opts.ontologyValidator ?? (this.registry ? registryBackedValidator(this.registry) : noopOntologyValidator)`. Most-specific wins; test stubs continue to work; legacy callers unaffected"
    - "Read-only registry exposure via getter — the registry is the consumer-facing handle (Phase 39+ consumers call reload/getAllClassNames/parentChainOf); the validator stays private (internal plumbing only). Mirrors the patterns-established item from Phase 38-04 'factory wraps live state without owning it'"
    - "JSDoc prose only on the new option fields + getter — no console.* substrings in comments per 38-PLAN-CHECK FLAG-3 robustness note (the no-console-log grep gate scrubs comment-prefix lines but not block-comment internals)"

key-files:
  created: []
  modified:
    - "/Users/Q284340/Agentic/km-core/src/store/GraphKMStore.ts (519 → 575 lines; +56 for Phase 38 additions — pure additive extension)"

key-decisions:
  - "Validator resolution order most-specific wins. The 3-way chain — (1) explicit opts.ontologyValidator (test stubs), (2) auto-wired registryBackedValidator(this.registry) when ontologyDir set, (3) noopOntologyValidator default — preserves Phase 37 test-stub injection semantics verbatim. Consumers passing BOTH ontologyDir AND ontologyValidator get exactly what they asked for (explicit wins); this is documented behavior (threat T-38-05-03 'spoofing' disposition: accept — required for test isolation)."
  - "Registry instantiated only when ontologyDir is supplied — no default cwd-pickup, no env-var fallback inside km-core. D-28 final paragraph forbids env-var/cwd pickup buried in helper code; consumers wire defaults at the call site. The undefined branch keeps `this.registry = undefined` so the getter returns undefined and callers can branch on `store.ontology?.reload()` etc."
  - "Registry exposed via getter, validator kept private. The validator is internal plumbing; the registry is the consumer API surface. Mirrors PATTERNS.md landmine 'the validator field stays private — only the registry is exposed via the getter; the validator is internal plumbing'. Phase 39+ consumers will reach for store.ontology (not store.validator); the validator type is exported from the root barrel for those who want to construct a custom validator and inject it via opts.ontologyValidator."
  - "PersistenceManager + Exporter instantiation order PRESERVED — explicit grep+awk gate confirms `this.persistence = new PersistenceManager` appears at line 146 BEFORE `this.exporter = new Exporter` at line 149 (p<e). PATTERNS landmine 'Plan 03 of Phase 37 set this ordering deliberately' honored."
  - "Line 240-242 trusted-path BYTE-IDENTICAL — the existing `if (!trusted) { this.validator.validate(e.entityType); }` block is untouched. The auto-wired registry-backed validator implements the same OntologyValidator interface (Phase 38-04 contract), so the call site works unchanged. T-37-04-02 + T-37-04-06 accepted dispositions both preserved."
  - "skipOntologyCheck BC-2 widening NOT narrowed — the flag continues to bypass BOTH parseEntityId AND validator-validate when set. No separate `skipIdCheck` flag was introduced. Phase 37 VERIFICATION.md BC-2 boundary preserved verbatim. The new auto-wired path simply means a different validator is invoked on the non-trusted branch; the trusted branch never invokes ANY validator (including the registry-backed one)."
  - "mergeAttributes ontology-skip PRESERVED — T-37-04-06 accepted disposition stands. The `mergeAttributes` method does NOT re-run ontology validation against the new registry. PATTERNS.md 'Behavior surprises §6' explicit: Phase 38 ships WITHOUT revisiting this. A future phase can add a `validateOnMerge: true` option if consumers need it."
  - "No package.json changes. Plan 38-03 already added the `./ontology` sub-path; Plan 38-05's GraphKMStore change is reached via the existing `.` root export (consumers continue to use `import { GraphKMStore } from '@fwornle/km-core'`). The new `ontologyDir` field is part of GraphKMStoreOptions which already flows through the root barrel."

patterns-established:
  - "Additive option-fields with default-equivalent backward compatibility: when extending an existing constructor options interface, the new optional field's omitted-default branch MUST exactly match the prior behavior. Phase 38-05's `ontologyDir` undefined → `this.registry = undefined` → validator falls back to opts.ontologyValidator ?? noopOntologyValidator → IDENTICAL to Phase 37. This guarantees zero regression for existing callers (the 33-test green check is the gate)."
  - "Nullish-coalescing resolution chain for layered defaults: `explicit ?? (conditional-derived ?? simple-default)` — pattern used three times in km-core now (Phase 37 GraphKMStore validator, Plan 38-03 OntologyRegistry strict-mode default, Plan 38-05 GraphKMStore validator's expanded chain). Establishes the canonical idiom for 'most-specific wins' resolution in option-object constructors."
  - "Read-only getter on `OntologyRegistry | undefined` — consumer code branches on optional-chaining (`store.ontology?.reload()`) rather than null-check guards. Matches TypeScript's nominal-undefined idiom; avoids the temptation to introduce a 'NoopRegistry' sentinel that would have to be type-distinguishable from a real registry."

requirements-completed: []  # Plan 05 alone does not close ONTO-01 or ONTO-02; closure comes at the integration layer via Plan 38-06 (test plan) + downstream consumers Phase 41/42/43 that wire `ontologyDir` end-to-end.

# Metrics
duration: ~2min
completed: 2026-05-20
---

# Phase 38 Plan 05: GraphKMStore Integration Summary

**The Phase 38 OntologyRegistry is now constructor-injectable into GraphKMStore via the new `ontologyDir?: string` option. When set, the store instantiates an OntologyRegistry internally, exposes it through the new read-only `store.ontology` getter, and auto-wires Plan 04's `registryBackedValidator` into the validator-resolution chain (explicit > auto-wired > noop, most-specific wins). All four Phase 37 NO-CHANGE invariants are honored: PersistenceManager/Exporter ordering (p<e at lines 146,149), line 240-242 trusted-path byte-identical, mergeAttributes ontology-skip preserved, skipOntologyCheck BC-2 widening untouched. Pure additive edit — zero method signatures changed, all 33 Phase 37 vitest tests still green.**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-05-20T12:11:00Z (after Plan 38-04 commit 3f9522f)
- **Completed:** 2026-05-20T12:14:00Z
- **Tasks:** 1 (single integration task — 6 surgical edits in one file)
- **Files modified:** 1 (`src/store/GraphKMStore.ts`, 519 → 575 lines; +56)

## Accomplishments

- `src/store/GraphKMStore.ts` (519 → 575 lines) — pure additive edit applying the 6-edit set from PATTERNS.md §"src/store/GraphKMStore.ts":
  - **Edit 1 (imports):** Added `import { OntologyRegistry } from '../ontology/registry.js';` and merged `registryBackedValidator` into the existing `'../validation/ontology.js'` import. Both are runtime imports — Plan 03 exports `OntologyRegistry` as a class, Plan 04 exports `registryBackedValidator` as a function.
  - **Edit 2 (GraphKMStoreOptions interface):** Appended two optional fields after the existing `ontologyValidator?: OntologyValidator` field — `ontologyDir?: string` (D-28; full JSDoc explaining no env-var/cwd pickup) and `ontologyStrict?: boolean` (D-29 atomic-build semantics; forwarded to `OntologyRegistry({ strict })`).
  - **Edit 3 (class private field):** Added `private readonly registry: OntologyRegistry | undefined;` alongside the existing `graph`/`persistence`/`exporter`/`validator`/`initialized` field declarations.
  - **Edit 4 (constructor body):** After the `this.exporter = new Exporter(...)` line, inserted the registry instantiation block: `if (opts.ontologyDir !== undefined)` → `new OntologyRegistry({ ontologyDir, strict: opts.ontologyStrict ?? false })`, else → `this.registry = undefined`. Then replaced the single-line validator assignment with the 3-way resolution chain: `opts.ontologyValidator ?? (this.registry ? registryBackedValidator(this.registry) : noopOntologyValidator)`.
  - **Edit 5 (ontology getter):** Added `get ontology(): OntologyRegistry | undefined { return this.registry; }` immediately after the constructor body (before `open()`). JSDoc names Phase 39+ use cases — `reload()`, `getAllClassNames()`, `parentChainOf()`, `domains`. The validator stays private; the registry is the consumer surface.
  - **Edit 6 (NO-CHANGE preservation):** All Phase 37 invariants verified untouched via grep+awk — see verification table below.
- TypeScript compiles clean: `cd /Users/Q284340/Agentic/km-core && npx tsc --noEmit` exits 0.
- Build clean: `npm run build` exits 0; `dist/store/GraphKMStore.js` contains 3 `OntologyRegistry` references (grep verified).
- Phase 37 test regression check: full vitest suite `npx vitest run` → 6 files / 33 tests / 33 passed. Zero regression from this plan.
- No-console-log preserved: `grep -v '^\s*//\|^\s*\*' src/store/GraphKMStore.ts | grep -cE 'console\.(log|warn|error|info|debug)'` returns 0.

## NO-CHANGE Constraint Verification (4 Phase 37 invariants)

The plan's `<phase_37_invariants_protection>` section names 4 NO-CHANGE constraints. Each was verified by grep+awk against the post-edit file:

| Constraint | Source | Verification | Status |
|------------|--------|--------------|--------|
| PersistenceManager + Exporter ordering | PATTERNS.md landmine "Plan 03 set that order deliberately" | `awk '/this\.persistence = new PersistenceManager/{p=NR} /this\.exporter = new Exporter/{e=NR} END{exit !(p && e && p<e)}'` → exit 0; p=146, e=149, p<e | PRESERVED |
| Line 240-242 trusted-path | Phase 37 D-19 + BC-2 + CF-D19; PATTERNS.md "do NOT touch line 240-242" | `grep -F "if (!trusted)" src/store/GraphKMStore.ts` matches (1 occurrence at expected location); `grep -F "this.validator.validate(e.entityType)" src/store/GraphKMStore.ts` matches (1 occurrence — the existing call site untouched) | PRESERVED |
| mergeAttributes ontology-skip | T-37-04-06 accepted disposition; PATTERNS.md "Behavior surprises §6 — Phase 38 does NOT revisit" | The `mergeAttributes` method body at lines ~534-547 was NOT modified; no `validator.validate` call added; `graph.mergeNodeAttributes` + emit + scheduleExport remain the only operations | PRESERVED |
| skipOntologyCheck BC-2 widening | Phase 37 VERIFICATION.md BC-2 "skipOntologyCheck also bypasses parseEntityId"; plan instruction "DO NOT narrow it (do not add a separate skipIdCheck flag)" | No separate flag introduced; `opts?: { skipOntologyCheck?: boolean }` signature on `putEntity` unchanged; the trusted-path block at line 249-256 (the `if (trusted) { id = e.id ... } else { id = parseEntityId(...) }` branch) untouched | PRESERVED |

Bonus protections (also grep-verified):
- The auto-wired registry-backed validator implements the same `OntologyValidator` interface as `noopOntologyValidator` and the test-stub — the existing `this.validator.validate(e.entityType)` call site works unchanged.
- The plain (non-trusted) putEntity path remains strict-by-default per CORE-03; the new behavior only swaps the validator's implementation, not the call-site contract.
- The batch validator-call site at line ~395 (`this.validator.validate(op.entity.entityType)`) was NOT modified; batch remains strict-by-default per D-17 (no `skipOntologyCheck` opt-out at the batch level).

## Task Commits

Single atomic task — committed inside the km-core repo on `main`:

1. **Task 1: Extend GraphKMStore — add ontologyDir option, registry field, getter, validator resolution chain** — km-core `1094046` (`feat(38-05): wire OntologyRegistry into GraphKMStore constructor (ONTO-01/02)`). One file modified (`src/store/GraphKMStore.ts` 519 → 575 lines; +56 net additions). Verified by full automated gate: `npx tsc --noEmit && npm run build && npx vitest run` exits 0; grep `get ontology()` matches; grep `if (!trusted)` still matches; awk PersistenceManager/Exporter ordering p<e PASSES; no-console-log grep returns 0.

km-core HEAD before plan: `3f9522f` (Plan 38-04's last commit — `feat(38-04): re-export registryBackedValidator from root barrel (ONTO-01/02)`).
km-core HEAD after plan: `1094046`.

**Plan metadata (coding repo):** committed separately with this SUMMARY + STATE.md + ROADMAP.md update.

## Files Created/Modified

- `/Users/Q284340/Agentic/km-core/src/store/GraphKMStore.ts` — Modified (519 → 575 lines; +56 net additions). 6 surgical edits applied: (1) runtime import of `OntologyRegistry` from `'../ontology/registry.js'` and `registryBackedValidator` merged into the existing validation/ontology.js import; (2) two new optional fields `ontologyDir?: string` + `ontologyStrict?: boolean` on `GraphKMStoreOptions`, each with full JSDoc; (3) new `private readonly registry: OntologyRegistry | undefined` class field; (4) constructor body inserts registry instantiation between Exporter and validator assignment, and the validator is now a 3-way resolution chain; (5) new public `get ontology(): OntologyRegistry | undefined` getter with JSDoc; (6) NO changes to `putEntity` trusted-path, `mergeAttributes`, `addRelation`, batch validator-call site, or PersistenceManager/Exporter ordering.

## Decisions Made

- **Validator resolution order: most-specific wins** — `explicit opts.ontologyValidator ?? (this.registry ? registryBackedValidator(this.registry) : noopOntologyValidator)`. Implemented via nested nullish-coalescing on the single validator-assignment statement. Explicit beats auto-wired beats default. Required for test-stub injection: the existing Phase 37 graph-store.test.ts test at line 184-199 continues to work without modification (passes `ontologyValidator` directly; the new `ontologyDir` field is unset → registry is undefined → the explicit validator wins).
- **Registry instantiated ONLY when ontologyDir is supplied** — no default cwd-pickup, no env-var fallback inside km-core. D-28 final paragraph forbids env-var/cwd pickup buried in helper code; consumers wire defaults at the call site (e.g., `ontologyDir: process.env.KM_ONTOLOGY_DIR ?? './ontology'`). The undefined branch keeps `this.registry = undefined`, so `store.ontology?.reload()` short-circuits cleanly via optional chaining.
- **Registry exposed via getter; validator stays private** — the validator is internal plumbing; the registry is the consumer-facing API. Mirrors PATTERNS.md landmine: "the validator field stays private — only the registry is exposed via the getter; the validator is internal plumbing." Phase 39+ consumers reach for `store.ontology` (not `store.validator`); the `OntologyValidator` type is exported from the root barrel for those who want to construct a custom validator and inject it via the explicit `opts.ontologyValidator` field.
- **`ontologyStrict?: boolean` default false** — matches `OntologyRegistry`'s own default (Plan 38-03 D-29 atomic-build semantics: one bad lower-ontology file should NOT block the rest of the catalog). Production deployments that require partial-load-fatal opt in via `ontologyStrict: true`.
- **No package.json changes.** Plan 38-03 already added the `./ontology` sub-path exports entry for the registry surface; Plan 38-05's GraphKMStore extension is reached via the existing `.` root export. The new `ontologyDir` field is part of `GraphKMStoreOptions` which already flows through the root barrel — consumers continue to `import { GraphKMStore } from '@fwornle/km-core'` without change.
- **JSDoc prose only; no console.* substrings in comments** — per 38-PLAN-CHECK FLAG-3 robustness note. The `no-console-log` grep filter (`grep -v '^\s*//\|^\s*\*' | grep -cE 'console\.(log|warn|error|info|debug)'`) strips single-line comment-prefix lines and JSDoc-continuation asterisk lines; multi-line `/* ... */` block-comment internals that mention `console.warn` would trip the gate. All new JSDoc in this edit avoids the word `console` entirely (it does not need to — there is no warning emission in this code path; warnings are the registry's responsibility per Plan 38-03 D-27).

## Deviations from Plan

None — plan executed exactly as written. The single task's acceptance criteria pass on the documented `<verify><automated>` command:

`cd /Users/Q284340/Agentic/km-core && npx tsc --noEmit && npm run build && npx vitest run && grep -qF "get ontology()" src/store/GraphKMStore.ts && grep -qF "if (!trusted)" src/store/GraphKMStore.ts && awk '/this\.persistence = new PersistenceManager/{p=NR} /this\.exporter = new Exporter/{e=NR} END{exit !(p && e && p<e)}' src/store/GraphKMStore.ts && echo OK` → `OK`

Additional checks pass (Edit 1-5 grep gates):
- `grep -cF "import { OntologyRegistry } from '../ontology/registry.js';" src/store/GraphKMStore.ts` → 1
- `grep -cF "registryBackedValidator," src/store/GraphKMStore.ts` → 1 (merged into existing validation/ontology.js import)
- `grep -cF "ontologyDir?: string" src/store/GraphKMStore.ts` → 1
- `grep -cF "ontologyStrict?: boolean" src/store/GraphKMStore.ts` → 1
- `grep -cF "private readonly registry: OntologyRegistry | undefined" src/store/GraphKMStore.ts` → 1
- `grep -cE "get ontology\(\): OntologyRegistry \| undefined" src/store/GraphKMStore.ts` → 1
- `grep -cF "new OntologyRegistry({" src/store/GraphKMStore.ts` → 1
- `grep -cF "registryBackedValidator(this.registry)" src/store/GraphKMStore.ts` → 1

Bonus (beyond plan's required `<verify><automated>`): all 33 Phase 37 vitest tests still pass on `npx vitest run` (zero regression); dist/store/GraphKMStore.js contains 3 `OntologyRegistry` references after build.

## Authentication Gates Encountered

None — no external services, no auth tokens, no MCP calls during execution. All work was filesystem + git inside two local repos (`/Users/Q284340/Agentic/km-core` + `/Users/Q284340/Agentic/coding`).

## Issues Encountered

None.

## TDD Gate Compliance

Plan 38-05 type is `execute` (not `tdd`). No RED→GREEN→REFACTOR gate sequence required. The integration-level tests that exercise the new `ontologyDir` auto-wire path and the `store.ontology` getter land in Plan 38-06 (the dedicated test plan in Wave 3, executed after this plan).

## Threat Flags

None new. The plan's `<threat_model>` register dispositions are all honored:

- **T-38-05-01 (tampering — consumer supplies ontologyDir pointing at attacker-controlled directory):** accept — same posture as Phase 37 `dbPath`/`exportDir`. No path validation in km-core; consumer controls the directory.
- **T-38-05-02 (elevation — auto-wired registry-backed validator bypassed by skipOntologyCheck=true):** mitigate — same as Phase 37 BC-2 (accepted). `skipOntologyCheck: true` is the documented trusted-bulk-import flag; Phase 38 preserves the semantics verbatim. The trusted-path branch in `putEntity` (line 240-242) skips the `validator.validate` call entirely, so the registry never sees a trusted-bulk entity.
- **T-38-05-03 (spoofing — explicit opts.ontologyValidator alongside opts.ontologyDir bypasses the registry):** accept — documented behavior (validator resolution order #1 wins). Required for test-stub injection. Consumer who wires both gets exactly what they asked for.
- **T-38-05-04 (tampering — constructor error inside `new OntologyRegistry(...)` propagates out of `new GraphKMStore(...)`):** accept — standard JS behavior; consumer can wrap in try/catch. Phase 37 has the same posture for `PersistenceManager`/`Exporter` construction failures.

No new security-relevant surface was introduced beyond what the plan's threat register already anticipated.

## User Setup Required

None — pure library-level changes inside km-core. No environment variables, no dashboard configuration, no external services touched.

## Next Phase Readiness

- **Plan 38-06 (registry unit tests + graph-store integration tests)** — Unblocked. `depends_on: [38-02, 38-03, 38-05]` is now fully satisfied. The new `ontologyDir` option + `store.ontology` getter + auto-wired validator-resolution chain are all in place on `main` in km-core; Plan 38-06 can write `tests/unit/ontology-registry.test.ts` (6 describe-blocks) and append two new tests to `tests/unit/graph-store.test.ts` (ontologyDir auto-wiring + skipOntologyCheck BC-2 preservation) per the PATTERNS.md test-shape spec.
- **Phase 41/42/43 downstream consumers** — Ready. Will construct `new GraphKMStore({ ontologyDir: '/path/to/ontology' })` and reach the registry via `store.ontology` for `getAllClassNames()` (UI dropdowns), `parentChainOf()` (extension provenance), `reload()` (dashboard reload button), etc. No further km-core API surface is needed for the v7.1 integration story.
- **No blockers.** km-core compiles clean; `dist/` rebuilt with new symbols; all 33 Phase 37 vitest tests still green; both root and `./ontology` sub-path imports continue to resolve (Plan 38-03's package.json exports map covers the latter).

## Self-Check: PASSED

- `/Users/Q284340/Agentic/km-core/src/store/GraphKMStore.ts` — MODIFIED (519 → 575 lines; +56 for Phase 38 additions; all 6 edits applied per PATTERNS.md spec)
- km-core commit `1094046` — FOUND in `git log --oneline -3` (`feat(38-05): wire OntologyRegistry into GraphKMStore constructor (ONTO-01/02)`)
- `cd /Users/Q284340/Agentic/km-core && npx tsc --noEmit` — exits 0
- `cd /Users/Q284340/Agentic/km-core && npm run build` — exits 0; `dist/store/GraphKMStore.js` contains 3 `OntologyRegistry` references
- `cd /Users/Q284340/Agentic/km-core && npx vitest run` — 6 files / 33 tests / 33 passed (zero Phase 37 regression)
- All 8 Edit 1-5 grep gates: 1 match each (see Deviations section above)
- All 4 NO-CHANGE constraints verified (see "NO-CHANGE Constraint Verification" table)
- no-console-log: grep -v comment-lines | grep console.* returns 0
- awk PersistenceManager/Exporter ordering check: p=146, e=149, p<e → PASS

---
*Phase: 38-ontology-registry*
*Completed: 2026-05-20*
