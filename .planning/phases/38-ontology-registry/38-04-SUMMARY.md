---
phase: 38-ontology-registry
plan: 04
subsystem: km-core
tags: [km-core, ontology, validator, factory, barrel, phase-37-bridge]

# Dependency graph
requires:
  - phase: 38-01
    provides: "OntologyFile / ResolvedClass types reachable via OntologyRegistry surface"
  - phase: 38-03
    provides: "OntologyRegistry class with isValidClass(className: string): boolean — the only method this factory invokes"
provides:
  - "registryBackedValidator(registry: OntologyRegistry): OntologyValidator factory in src/validation/ontology.ts — bridges Phase 37's pluggable-validator surface (D-19) to Phase 38's registry; thrown error preserves Phase 37 test regex /Unknown ontology class/"
  - "Type-only import of OntologyRegistry from '../ontology/registry.js' — TypeScript erases at compile time so the validator module has zero runtime registry dependency"
  - "Root barrel src/index.ts re-exports registryBackedValidator — reachable as `import { registryBackedValidator } from '@fwornle/km-core'`"
affects: [38-05, 38-06, 42-okb-migration, 43-okm-migration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Type-only TypeScript import (`import type { ... }`) — load-bearing for the validator-module / registry-module dependency direction: validator imports registry type; registry must NOT import validator (one-way contract, grep-verified)"
    - "Factory pattern over interface-implementation — OntologyRegistry does NOT implement OntologyValidator directly (would create the runtime circular reference); the factory wraps the registry instance, returning an inline object literal that conforms to OntologyValidator"
    - "Verbatim error-message text contract — `Unknown ontology class: ${entityType}` is the substring Phase 37 graph-store.test.ts:198 regex-matches; preserved character-for-character so Plan 38-05's auto-wired path is a drop-in replacement for the strict-stub used at lines 187-192"
    - "JSDoc prose only, no fenced console.* substrings — keeps the no-console-log grep filter (Plans 38-03/05/06 share the same gate) robust against false positives per 38-PLAN-CHECK FLAG-3"

key-files:
  created: []
  modified:
    - "/Users/Q284340/Agentic/km-core/src/validation/ontology.ts (27 → 75 lines; +48 for Phase 38 block — append-only after the existing noopOntologyValidator constant, plus a type-only import added after the existing comment block)"
    - "/Users/Q284340/Agentic/km-core/src/index.ts (62 → 68 lines; +6 for the registryBackedValidator export plus inline comment explaining the bridge)"

key-decisions:
  - "Type-only import (`import type { OntologyRegistry } from '../ontology/registry.js'`) is the documented design per CONTEXT.md D-04 boundary and 38-PLAN-CHECK carry-forward — TypeScript erases this at compile time, so validation/ontology.ts has zero runtime dependency on the registry. The factory body invokes `registry.isValidClass(entityType)` via the parameter's typed-but-erased reference; no module-level runtime cycle is possible."
  - "Error-message text VERBATIM per Phase 37 BC contract: `Unknown ontology class: ${entityType}`. Phase 37's tests/unit/graph-store.test.ts:198 grep-asserts the regex `/Unknown ontology class/`; the strict-validation stub at lines 187-192 throws the same shape. The factory is therefore drop-in compatible with the existing test contract — Plan 38-05's auto-wired path will replace the stub at the call-site level without altering test assertions."
  - "Factory returns a fresh object literal — `{ validate(entityType) { ... } }` — not a class instance and not a memoized singleton. Two reasons: (1) consumers managing multiple registries (test isolation) need independent validator instances; (2) the OntologyValidator interface has no shared state, so a class would only add a constructor without benefit. Matches the lightweight shape of the existing `noopOntologyValidator` constant."
  - "Root barrel placement: appended `export { registryBackedValidator } from './validation/ontology.js';` next to the existing `noopOntologyValidator` export rather than into the Plan 38-03 Phase 38 block. Rationale: group exports by source file (all `./validation/ontology.js` exports together) is the existing organizing principle of src/index.ts; the inline comment block names the Phase 38 cross-reference so readers see the bridge."
  - "No package.json changes. The validator factory is re-exported from the root barrel and inherits the existing `.` exports entry; no `./validation` sub-path is added — consumers reaching for the validator surface use the root import. (Plan 38-03 added the `./ontology` sub-path for the registry class; validation/ontology does not need the same since the surface is much smaller and root-only suffices.)"

patterns-established:
  - "Type-only import as runtime-cycle break: when module A needs module B's type but B (or anything B transitively imports) needs A's type, switch one direction to `import type` — TypeScript erases it so the runtime graph is one-way. Recorded here as the canonical pattern for km-core's validation ↔ ontology bridge."
  - "Factory wraps live state without owning it: `registryBackedValidator(registry)` does NOT take ownership of the registry's lifecycle — the consumer (or, in Plan 38-05's auto-wired path, the GraphKMStore constructor) constructs the registry, hands it to the factory, and disposes both when the store closes. The factory is a thin adapter; mutations to the registry (via reload()) are immediately observable through the validator."
  - "Verbatim-error-message contract preservation across Phase boundaries: when a downstream Phase N+1 replaces a Phase N stub, the thrown error message text remains identical so the existing tests in Phase N continue to pass without modification. Recorded as the Phase 37 BC-2 / Phase 38 Plan 04 pattern; expected to recur in Phase 39 (entity-shape stubs) and Phase 40 (dedup-stage stubs)."

requirements-completed: []  # Plan 04 alone does not close ONTO-01 or ONTO-02; Plan 38-03 (impl) + Plan 38-05 (store wiring) + Plan 38-06 (tests) close them collectively.

# Metrics
duration: ~3min
completed: 2026-05-20
---

# Phase 38 Plan 04: registryBackedValidator Factory Summary

**The Phase 37 pluggable-validator interface (D-19) gets its first non-noop implementation: `registryBackedValidator(registry: OntologyRegistry): OntologyValidator` is added as a pure-additive edit to src/validation/ontology.ts and re-exported from the root barrel. The factory's thrown error text matches the verbatim Phase 37 test regex `/Unknown ontology class/`, so when Plan 38-05 auto-wires this factory inside GraphKMStore the existing strict-validation test contract continues to hold without modification. Type-only import (`import type { OntologyRegistry }`) keeps validation/ontology.ts's runtime footprint zero, with a one-way dependency direction grep-verified against ontology/registry.ts.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-05-20T10:03:00Z (after Plan 38-03 commit f006e91)
- **Completed:** 2026-05-20T10:07:00Z
- **Tasks:** 2
- **Files modified:** 2 (zero created — pure additive edits in two existing barrel-adjacent files)

## Accomplishments

- `src/validation/ontology.ts` (27 → 75 lines) — pure additive edit:
  - **Type-only import** added after the existing comment block: `import type { OntologyRegistry } from '../ontology/registry.js'`. TypeScript erases at compile time; no runtime dependency on the registry module.
  - **registryBackedValidator factory** appended after the existing `noopOntologyValidator` constant. Signature: `export function registryBackedValidator(registry: OntologyRegistry): OntologyValidator`. Body returns a fresh object literal `{ validate(entityType): void { if (!registry.isValidClass(entityType)) throw new Error(\`Unknown ontology class: ${entityType}\`); } }`.
  - **JSDoc prose** above the factory naming Phase 38 / ONTO-01/ONTO-02, the error-message contract (Phase 37 test compatibility), Plan 38-05's auto-wire usage hint, and the BC-2 boundary preservation note.
  - **Existing exports unchanged**: `OntologyValidator` interface (lines 10-13) and `noopOntologyValidator` constant (lines 22-26) preserved character-for-character. The factory is purely additive.
- Root barrel `src/index.ts` (62 → 68 lines) — appended `export { registryBackedValidator } from './validation/ontology.js';` adjacent to the existing `noopOntologyValidator` export, plus a 5-line inline comment block naming the Phase 38 cross-reference. Existing Plan 38-03 Phase 38 block (OntologyRegistry, OntologyRegistryOptions, loadOntologyFile, 4 public types) untouched.
- TypeScript compiles clean: `cd /Users/Q284340/Agentic/km-core && npx tsc --noEmit` exits 0.
- Build clean: `npm run build` exits 0; `dist/index.js` contains `registryBackedValidator` (grep -F matches); `dist/validation/ontology.js` + `dist/validation/ontology.d.ts` both regenerated.
- Phase 37 test regression check: full vitest suite `npx vitest run` → 6 files / 33 tests / 33 passed. Zero regression from this plan.
- No-console-log preserved: `grep -v '^\s*//\|^\s*\*' src/validation/ontology.ts | grep -cE 'console\.(log|warn|error|info|debug)'` returns 0 (the JSDoc prose above the factory is asterisk-prefixed continuation lines, correctly stripped by the filter).
- Circular-import contract preserved: `grep -c "from '../validation/ontology" src/ontology/registry.ts` returns 0 — Plan 38-03's registry.ts has zero references to validation/ontology.ts. One-way dependency direction confirmed.

## Task Commits

Each task was committed atomically inside the km-core repo on `main`:

1. **Task 1: Append registryBackedValidator factory to src/validation/ontology.ts** — km-core `fe582ca` (`feat(38-04): add registryBackedValidator factory in src/validation/ontology.ts (ONTO-01/02)`). Pure additive: type-only import + factory function + JSDoc. 48 lines added; existing 27 lines preserved verbatim. Verified by `npx tsc --noEmit` + grep gates for the verbatim error-message substring + `^export function registryBackedValidator` + zero `console.*` in non-comment lines.
2. **Task 2: Append registryBackedValidator export to root barrel src/index.ts** — km-core `3f9522f` (`feat(38-04): re-export registryBackedValidator from root barrel (ONTO-01/02)`). 6 lines added (1 export + 5-line inline comment block). Existing 62 lines preserved. Verified by `npx tsc --noEmit` + `npm run build` + `grep -F 'registryBackedValidator' dist/index.js` + grep that existing GraphKMStore and noopOntologyValidator exports still match.

km-core HEAD before plan: `f006e91` (Plan 38-03's last commit — `feat(38-03): add ontology sub-barrel + root re-exports + exports map (ONTO-01/02)`).
km-core HEAD after plan: `3f9522f`.

**Plan metadata (coding repo):** committed separately with this SUMMARY + STATE.md + ROADMAP.md update.

## Files Created/Modified

- `/Users/Q284340/Agentic/km-core/src/validation/ontology.ts` — Modified (27 → 75 lines). Pure additive: type-only `import type { OntologyRegistry } from '../ontology/registry.js'` after the existing comment block; new exported function `registryBackedValidator(registry: OntologyRegistry): OntologyValidator` after `noopOntologyValidator`. JSDoc prose only (no console.* substrings in comments). Existing `OntologyValidator` interface and `noopOntologyValidator` constant unchanged.
- `/Users/Q284340/Agentic/km-core/src/index.ts` — Modified (62 → 68 lines). Appended `export { registryBackedValidator } from './validation/ontology.js';` adjacent to the existing `noopOntologyValidator` export plus a 5-line comment block naming the Phase 38 ONTO-01/02 cross-reference and the Plan 38-05 auto-wire path. All existing Plan 37 + Plan 38-03 exports preserved verbatim.

## Decisions Made

- **Type-only import on `../ontology/registry.js`** — documented as the design per CONTEXT.md D-04 boundary and 38-PLAN-CHECK carry-forward. The validator-module / registry-module pair has a one-way runtime dependency direction (validator → registry type, NOT the other way); the type-only import enforces that at the language level. Tested by `grep -c "from '../validation/ontology" src/ontology/registry.ts` returning 0 (registry has no references to the validator module).
- **Error-message text VERBATIM `Unknown ontology class: ${entityType}`** — load-bearing for Phase 37 test contract preservation. The Phase 37 strict-validation test at tests/unit/graph-store.test.ts:184-199 throws `Error(\`Unknown ontology class: ${cls}\`)` from the stub validator and asserts `rejects.toThrow(/Unknown ontology class/)`. Plan 38-05's auto-wired path will replace the stub with this factory; the verbatim text means the test assertion continues to hold without modification.
- **Factory returns fresh object literal**, not a class instance and not a memoized singleton. Two reasons: (1) test isolation — consumers managing multiple registries need independent validators; (2) the OntologyValidator interface has no shared state, so a class would only add ceremony.
- **Root barrel placement adjacent to existing noopOntologyValidator export** — group exports by source file is the existing organizing principle of src/index.ts (Phase 37 D-19 comment block contains the type + noop together). The Phase 38 cross-reference is captured in an inline 5-line comment block above the new export.
- **No package.json changes.** Plan 38-03 added the `./ontology` sub-path exports entry for the registry surface; the validator surface is small enough that root-only suffices (`@fwornle/km-core`). Adding a `./validation` sub-path would be premature scope creep — Phase 39+ can revisit if any consumer reaches for a validation-only sub-surface.
- **JSDoc prose only, no console.* substrings in comments** — per 38-PLAN-CHECK FLAG-3 robustness note. The no-console-log grep filter (`grep -v '^\s*//\|^\s*\*' | grep -cE 'console\.(log|warn|error|info|debug)'`) strips single-line comment-prefix lines and JSDoc-continuation asterisk lines; multi-line `/* ... */` block-comment internals that mention `console.warn` would trip the gate. The factory's JSDoc avoids the word `console` entirely (it does not need to — there is no warning emission in this factory; warnings are the registry's responsibility per Plan 38-03 D-27).

## Deviations from Plan

None — plan executed exactly as written. Both tasks' acceptance criteria pass on the documented `<verify><automated>` commands:

- **Task 1:** `cd /Users/Q284340/Agentic/km-core && npx tsc --noEmit && grep -qF "Unknown ontology class:" src/validation/ontology.ts && grep -qF "export const noopOntologyValidator" src/validation/ontology.ts && grep -qE "^export function registryBackedValidator" src/validation/ontology.ts && test "$(grep -v '^\s*//\|^\s*\*' src/validation/ontology.ts | grep -cE 'console\.(log|warn|error|info|debug)')" -eq 0 && echo OK` → `OK`. Additional checks pass: type-only import grep matches; isValidClass invocation present in factory body; circular-import grep on Plan 38-03's registry.ts returns 0.
- **Task 2:** `cd /Users/Q284340/Agentic/km-core && npx tsc --noEmit && npm run build && grep -qF "registryBackedValidator" dist/index.js && grep -qF "export { GraphKMStore }" src/index.ts && grep -qF "export { noopOntologyValidator }" src/index.ts && echo OK` → `OK`. `dist/validation/ontology.{js,d.ts,js.map,d.ts.map}` all regenerated. `dist/index.js` contains the new factory re-export.

Bonus (beyond plan's required `<verify><automated>`): all 33 Phase 37 vitest tests still pass on `npx vitest run` (zero regression).

## Authentication Gates Encountered

None — no external services, no auth tokens, no MCP calls during execution. All work was filesystem + git inside two local repos (`/Users/Q284340/Agentic/km-core` + `/Users/Q284340/Agentic/coding`).

## Issues Encountered

None.

## TDD Gate Compliance

Plan 38-04 type is `execute` (not `tdd`). No RED→GREEN→REFACTOR gate sequence required. Tests covering the factory's behavior — registry-backed validation pass/fail + skipOntologyCheck bypass — land in Plan 38-06 (the dedicated test plan in Wave 3) per the phase's 6-plan layout. Plan 38-05 will exercise the factory end-to-end via GraphKMStore.putEntity's validator-call site.

## Threat Flags

None new. The plan's `<threat_model>` register dispositions are all honored:

- **T-38-04-01 (spoofing — caller passes a not-in-registry entityType expecting validation pass)** mitigated — factory's validate() calls `registry.isValidClass(entityType)` and throws `Error(\`Unknown ontology class: ${entityType}\`)` on miss. The Phase 37 BC-2 `skipOntologyCheck: true` opt-out (preserved by Plan 38-05 at the GraphKMStore.putEntity call-site level) is the only bypass; non-bulk paths are strict by D-19.
- **T-38-04-02 (tampering — error-message tampering breaks Phase 37 test regex)** mitigated — acceptance criterion grep-asserts the exact substring `Unknown ontology class:`. Verbatim character-for-character match against Phase 37 graph-store.test.ts:198 regex.
- **T-38-04-03 (information disclosure — error message includes rejected entityType verbatim)** accept — same disposition as Phase 37 (the existing test stub at line 187 throws the same shape). Operator/developer diagnostic value > minor info-leak; entityType is consumer-supplied, not user-PII.
- **T-38-04-04 (tampering — circular import between validation/ontology.ts and ontology/registry.ts)** mitigated — type-only import (`import type`) in validation/ontology.ts erases at compile time; the registry has zero references to validation/ontology.ts (grep-verified, returns 0). The factory pattern (validator wraps registry) enforces the one-way dependency contract.

No new security-relevant surface was introduced beyond what the plan's threat register already anticipated.

## User Setup Required

None — pure library-level changes inside km-core. No environment variables, no dashboard configuration, no external services touched.

## Next Phase Readiness

- **Plan 38-05 (GraphKMStore wiring)** — Ready. The factory `registryBackedValidator` is now importable from the root barrel; Plan 38-05 will add `ontologyDir?` + `ontologyStrict?` to `GraphKMStoreOptions`, instantiate `OntologyRegistry` internally when set, expose the `store.ontology` getter, and auto-wire `registryBackedValidator(this.registry)` into the existing validator resolution chain (most-specific wins: explicit `opts.ontologyValidator` > auto-wired registry-backed > `noopOntologyValidator`). 38-05 frontmatter `depends_on: [38-03, 38-04]` is now fully satisfied — both prior plans are on `main` in km-core.
- **Plan 38-06 (tests)** — Ready (transitively, after Plan 38-05 lands). Will exercise the factory directly in `tests/unit/ontology-registry.test.ts` and indirectly via the new `ontologyDir` auto-wiring test in `tests/unit/graph-store.test.ts`. The verbatim error-message contract ensures the existing Phase 37 strict-validation assertion `rejects.toThrow(/Unknown ontology class/)` continues to hold against the registry-backed path.
- **No blockers.** km-core compiles clean; `dist/` rebuilt; all 33 Phase 37 vitest tests still green; both root and `./ontology` sub-path imports verified (Plan 38-03's external smoke compile still applies — Plan 38-04 added a root-only export, which the existing `.` exports entry covers).

## Self-Check: PASSED

- `/Users/Q284340/Agentic/km-core/src/validation/ontology.ts` — MODIFIED (27 → 75 lines; +48 for Phase 38 block; existing 27 lines preserved verbatim)
- `/Users/Q284340/Agentic/km-core/src/index.ts` — MODIFIED (62 → 68 lines; +6 for the registryBackedValidator export plus comment block; existing 62 lines preserved verbatim)
- km-core commit `fe582ca` — FOUND in `git log --oneline -3` (`feat(38-04): add registryBackedValidator factory in src/validation/ontology.ts (ONTO-01/02)`)
- km-core commit `3f9522f` — FOUND in `git log --oneline -3` (`feat(38-04): re-export registryBackedValidator from root barrel (ONTO-01/02)`)
- `cd /Users/Q284340/Agentic/km-core && npx tsc --noEmit` — exits 0
- `cd /Users/Q284340/Agentic/km-core && npm run build` — exits 0; `dist/index.js` contains `registryBackedValidator`; `dist/validation/ontology.{js,d.ts,js.map,d.ts.map}` all present
- `cd /Users/Q284340/Agentic/km-core && npx vitest run` — 6 files / 33 tests / 33 passed (zero Phase 37 regression)
- `grep -c "from '../validation/ontology" src/ontology/registry.ts` — returns 0 (one-way dependency direction confirmed; no circular import)
- `grep -F "Unknown ontology class:" src/validation/ontology.ts` — matches (error-message contract preserved verbatim for Phase 37 test compatibility)

---
*Phase: 38-ontology-registry*
*Completed: 2026-05-20*
