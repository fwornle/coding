---
phase: 38-ontology-registry
plan: 03
subsystem: km-core
tags: [km-core, ontology, registry, reload, collision-warning, sub-barrel, exports-map]

# Dependency graph
requires:
  - phase: 38-01
    provides: "OntologyFile / OntologyClass / OntologyProperty / ResolvedClass type surface; loadOntologyFile sync JSON reader"
provides:
  - "OntologyRegistry class (src/ontology/registry.ts) with 5 deltas vs OKM analog: constructor injection, async atomic reload, stderr warn + strict mode, collision warning, provenance + parent-chain accessors"
  - "src/ontology/index.ts sub-barrel — single import point for OntologyRegistry + types"
  - "Root barrel src/index.ts re-exports the full registry surface (class, options, loader, 4 public types)"
  - "package.json `exports` map extended with ./ontology sub-path so '@fwornle/km-core/ontology' resolves for external consumers (FLAG-1 option a)"
affects: [38-04, 38-05, 38-06, 42-okb-migration, 43-okm-migration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Atomic-before-swap reload (D-29): build new Map+Set in local vars, then two adjacent assignment statements; relies on JS single-threaded execution, no Mutex"
    - "Options-object constructor with `strict?: boolean` opt-in (D-28 + Pattern S3) — no env-var pickup buried in helpers"
    - "process.stderr.write for ALL diagnostics (no-console-log preserved per CLAUDE.md mandate carried from Phase 37)"
    - "Single-shared registerClasses(target, file, source) signature — internal map passed explicitly so loadFromDisk and reload share the algorithm without code duplication or shared mutable state"
    - "Sub-path package exports map entry for module-scoped imports (FLAG-1 option a)"

key-files:
  created:
    - "/Users/Q284340/Agentic/km-core/src/ontology/registry.ts (249 lines)"
    - "/Users/Q284340/Agentic/km-core/src/ontology/index.ts (21 lines)"
  modified:
    - "/Users/Q284340/Agentic/km-core/src/index.ts (47 → 62 lines; +15 for Phase 38 block — append-only, no existing exports moved or removed)"
    - "/Users/Q284340/Agentic/km-core/package.json (extend `exports` map with ./ontology sub-path; FLAG-1 option a from 38-PLAN-CHECK)"

key-decisions:
  - "FLAG-1 (package.json sub-path exports map): chose option (a) — added a 4-line ./ontology entry to package.json. External-consumer smoke compile in a tmpdir with @types/node + NodeNext resolution confirms both `import { OntologyRegistry } from '@fwornle/km-core'` and `import { OntologyRegistry } from '@fwornle/km-core/ontology'` resolve cleanly. Option (b) — document and rely on root only — explicitly rejected per 38-PLAN-CHECK guidance."
  - "Atomic reload contract (D-29): `loadFromDisk` mutates `this.classes`/`this.loadedDomains` directly (constructor-only path; no observers exist yet); `reload()` builds `newClasses`/`newDomains` locally and assigns in two adjacent statements at the end. Both paths share the algorithm via the new `registerClasses(target, file, source)` signature — passing the target map explicitly avoids both code duplication and the pre-swap shared-state hazard."
  - "Collision warning text VERBATIM per D-27 spec: `[km-core/ontology-registry] class '\\${name}' redefined: \\${prev.source} → \\${source} (last-loaded wins; see D-27 in 38-CONTEXT.md)\\n` — grep-asserted character-for-character; Plan 06 will assert via vi.spyOn(process.stderr, 'write')."
  - "Malformed-file warning prefix: `[km-core/ontology-registry] skipping malformed ontology file '\\${file}': \\${msg}\\n` — same prefix tag for grep-ability; strict-mode rethrows via `if (this.strict) throw err`."
  - "Preserved verbatim from OKM (PATTERNS.md mandate): all 6 public lookup methods (isValidClass / getClass / getAllClassNames / getDefaultLayer / getValidRelationships / getLoadedDomains) plus the LLM-context formatter `getClassesForPrompt()`. ONTO-02 extends-merging body (`{ ...classDef, relationships: { ...parent.relationships, ...classDef.relationships }, properties: { ...parent.properties, ...classDef.properties } }`) is copied verbatim."
  - "Alphabetical lower-file sort preserved (`files.sort()` x2, one in loadFromDisk + one in reload) — D-27 deterministic-load-order contract."
  - "No new dependencies (`node:fs` + `node:path` only) per PATTERNS.md cross-cutting reminder #5."

patterns-established:
  - "Two-method internal layout (loadFromDisk vs reload) sharing a `registerClasses(target, ...)` signature with explicit target argument — DRY without the shared-mutable-state hazard during atomic swap."
  - "Async public surface over sync internal reads (Pattern S4 carried through from Phase 37) — `reload()` is `async` for surface symmetry; underlying `readFileSync` stays sync because Pattern S4 explicitly rejects async-via-IIFE."
  - "Two-statement atomic swap idiom: `this.classes = newClasses; this.loadedDomains = newDomains;` — single-threaded JS makes adjacency the synchronization point. Documented in registry.ts JSDoc and 38-PATTERNS § DELTA #2."
  - "package.json exports map sub-path pattern: every module getting a sub-barrel (currently `types/`, now `ontology/`) lands its own ./types or ./ontology entry alongside `.` so external consumers can take a focused surface import."

requirements-completed:
  - ONTO-01
  - ONTO-02

# Metrics
duration: ~4min
completed: 2026-05-20
---

# Phase 38 Plan 03: OntologyRegistry Class + Barrels Summary

**The OntologyRegistry lands inside @fwornle/km-core with the full Phase 38 surface — 249-line class adopting OKM's 86-line analog with the 5 D-26..D-29 deltas applied, a sub-barrel src/ontology/index.ts, root-barrel re-exports for the registry + 4 public types, and a package.json `exports` map extension so external consumers can take either `@fwornle/km-core` or `@fwornle/km-core/ontology`. Closes ONTO-01 + ONTO-02 at the library layer; Plans 04 (factory) + 05 (store wiring) + 06 (tests) consume this surface.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-05-20T09:57:56Z
- **Completed:** 2026-05-20T10:01:10Z
- **Tasks:** 2
- **Files modified:** 4 (2 created + 2 modified)

## Accomplishments

- `src/ontology/registry.ts` (249 lines) exports `OntologyRegistry` class + `OntologyRegistryOptions` interface with all 5 PATTERNS deltas applied vs OKM's 86-line analog:
  - **Delta 1 (D-28):** options-object constructor `new OntologyRegistry({ ontologyDir, strict? })` replaces OKM's free `.load(dir)` method. Constructor calls `loadFromDisk()` synchronously; no env-var pickup, no cwd resolution.
  - **Delta 2 (D-29):** `async reload(): Promise<void>` rebuilds the catalog atomically — local `newClasses` Map + `newDomains` Set are populated fully before the two-statement swap `this.classes = newClasses; this.loadedDomains = newDomains;`. A concurrent `isValidClass()` either sees the old map or the new map, never a half-built one.
  - **Delta 3 (D-27 + no-console-log):** silent OKM `catch {}` replaced with `process.stderr.write('[km-core/ontology-registry] skipping malformed ontology file ...')` plus `if (this.strict) throw err` rethrow. Missing `upper.json` propagates through the loader (registry does not swallow it).
  - **Delta 4 (D-27):** collision warning fires before `target.set(name, ...)` when `prev.source !== source` — text verbatim per CONTEXT.md spec, including the `last-loaded wins; see D-27 in 38-CONTEXT.md` pointer.
  - **Delta 5:** `parentChainOf(className)`, `provenanceOf(className)`, `get classCatalog(): ReadonlyMap`, `get domains(): ReadonlySet` accessors added. All preserve internal state immutability via TypeScript widening (no defensive copies needed).
- OKM's 6 public lookup methods (`isValidClass`, `getClass`, `getAllClassNames`, `getDefaultLayer`, `getValidRelationships`, `getLoadedDomains`) plus `getClassesForPrompt()` preserved verbatim — Phase 40/42 consumers depend on these signatures.
- `src/ontology/index.ts` (21 lines) sub-barrel mirrors the shape of `src/types/index.ts`: `export {...}` for runtime values, `export type {...}` for types, NodeNext `.js` extensions on every internal import.
- Root barrel `src/index.ts` (47 → 62 lines) appends a Phase 38 block AFTER the existing `noopOntologyValidator` line (line 46). Append-only — `export { GraphKMStore }`, `export { mintEntityId }`, all existing exports are intact. New Phase 38 comment header matches the existing comment-block-per-category style (D-19 / CORE-02 / etc.).
- `package.json` extended with `./ontology` exports map entry — FLAG-1 option (a). External-consumer smoke compile in a tmpdir with proper `@types/node` + NodeNext config compiles both root and sub-path imports cleanly (`tsc --noEmit` exits 0).
- TypeScript compiles clean (`npx tsc --noEmit` exits 0); `npm run build` exits 0; `dist/ontology/registry.js` + `dist/ontology/index.js` both present.
- Zero `console.*` in `src/ontology/registry.ts` (no-console-log preserved); 3 `process.stderr.write` call sites (2 for malformed-file warnings in `loadFromDisk` + `reload`, 1 for the collision warning in `registerClasses`).
- All 33 Phase 37 vitest tests still pass — zero regression.

## Task Commits

Each task was committed atomically inside the km-core repo on `main`:

1. **Task 1: Create src/ontology/registry.ts (OntologyRegistry class with 5 deltas vs OKM)** — `5651142` (feat: 249 lines; verified by `npx tsc --noEmit` + grep gates for `last-loaded wins; see D-27 in 38-CONTEXT.md` + `async reload(): Promise<void>` + zero `console.*` in non-comment lines)
2. **Task 2: Create src/ontology/index.ts sub-barrel + update src/index.ts root barrel + extend package.json exports map** — `f006e91` (feat: 3 files; sub-barrel created, root barrel append-only; `./ontology` exports entry added; full `npm run build` clean; external smoke compile clean for both root and sub-path imports)

km-core HEAD before plan: `972bd3a` (Plan 38-02's last commit — `feat(38-02): add synthetic coding-ontology.json B-shape fixture`).
km-core HEAD after plan: `f006e91`.

**Plan metadata (coding repo):** committed separately with this SUMMARY + STATE.md + ROADMAP.md update.

## Files Created/Modified

- `/Users/Q284340/Agentic/km-core/src/ontology/registry.ts` — Created (249 lines). Exports `interface OntologyRegistryOptions { ontologyDir: string; strict?: boolean; }` and `class OntologyRegistry` with: constructor calling `loadFromDisk()`; `async reload(): Promise<void>` with atomic swap; private `loadFromDisk()` and `registerClasses(target, file, source)`; 6 verbatim-OKM public lookup methods + `getClassesForPrompt()`; `parentChainOf()`, `provenanceOf()`, `get classCatalog`, `get domains` accessors.
- `/Users/Q284340/Agentic/km-core/src/ontology/index.ts` — Created (21 lines). Sub-barrel: `export { OntologyRegistry }`, `export type { OntologyRegistryOptions }`, `export { loadOntologyFile }`, `export type { OntologyFile, OntologyClass, OntologyProperty, ResolvedClass }`.
- `/Users/Q284340/Agentic/km-core/src/index.ts` — Modified (47 → 62 lines). Appended Phase 38 block after the `noopOntologyValidator` line: `OntologyRegistry`, `OntologyRegistryOptions`, `loadOntologyFile`, and the 4 public ontology types. Pure additive — no existing exports modified.
- `/Users/Q284340/Agentic/km-core/package.json` — Modified. Extended `exports` map with `"./ontology": { "types": "./dist/ontology/index.d.ts", "import": "./dist/ontology/index.js" }`. FLAG-1 option (a) from 38-PLAN-CHECK.

## Decisions Made

- **FLAG-1 disposition: chose option (a) — extend the exports map.** The 4-line addition to `package.json` allows external consumers to take `import { OntologyRegistry } from '@fwornle/km-core/ontology'` directly. Option (b) — relying only on the root import — was explicitly rejected per 38-PLAN-CHECK guidance ("Do not silently take option (b) and call done"). External-consumer smoke verified by creating a tmpdir, `npm install /Users/Q284340/Agentic/km-core @types/node@22 typescript@5`, and compiling a 5-line `.ts` file that imports `OntologyRegistry` from both `'@fwornle/km-core'` and `'@fwornle/km-core/ontology'` with NodeNext+ES2022 — `tsc --noEmit` exits 0.
- **Single shared `registerClasses(target, file, source)` signature.** OKM's analog has `registerClasses(file, source)` operating on the implicit `this.classes`. Phase 38's `reload()` cannot mutate `this.classes` until the atomic swap, so the new signature takes an explicit `target: Map<string, ResolvedClass>` argument. Both `loadFromDisk()` and `reload()` invoke it with their respective target maps (`this.classes` for the constructor path; the local `newClasses` for reload). This is a refactor required by the D-29 atomicity contract — the alternative (duplicating the loop body) would diverge over time.
- **Atomic swap idiom over locks.** PATTERNS.md and 38-PLAN-CHECK explicitly call out that the right idiom is two-statement assignment relying on JS single-threaded execution — no Mutex, no async-aware atomicity. The JSDoc on `reload()` documents this explicitly so future maintainers don't mistake it for missing synchronization.
- **Collision warning text VERBATIM** — character-for-character per the D-27 spec from CONTEXT.md §Specific Ideas. Plan 06 will grep-assert via `vi.spyOn(process.stderr, 'write')` for substrings `redefined` and `last-loaded wins`. No paraphrasing; the doc-pointer in the warning text is the operator-self-service mechanism.
- **JSDoc prose only; no fenced code blocks containing `console.*`** — per 38-PLAN-CHECK FLAG-3. The no-console-log grep filter strips only single-line and JSDoc-asterisk-continuation comments; multi-line `/* ... */` block comments containing `console.warn` would trip the gate falsely. Verified by reading the file (`grep -v '^\s*//\|^\s*\*' src/ontology/registry.ts | grep -cE 'console\\.(log|warn|error|info|debug)' = 0`).
- **No env-var pickup** — D-28 final paragraph forbids it. Consumers wiring `process.env.KM_ONTOLOGY_DIR` happens at the call site.
- **No-watcher (D-29)** — `reload()` is the only mechanism; no `fs.watch`, no `chokidar`. Out of scope.
- **No new dependencies** — only `node:fs` + `node:path` in registry.ts; no `package.json` `dependencies` change.

## Deviations from Plan

None — plan executed exactly as written. Both tasks' acceptance criteria pass on the documented `<verify><automated>` commands:

- **Task 1:** `cd /Users/Q284340/Agentic/km-core && npx tsc --noEmit && grep -qF "last-loaded wins; see D-27 in 38-CONTEXT.md" src/ontology/registry.ts && grep -qE "async reload\(\): Promise<void>" src/ontology/registry.ts && test "$(grep -v '^\s*//\|^\s*\*' src/ontology/registry.ts | grep -cE 'console\.(log|warn|error|info|debug)')" -eq 0 && echo OK` → `OK`. All grep counts pass (export class:1, export interface:1, stderr.write:3, redefined:1, skipping malformed:2, sort:2, line count:249); all 7 public methods present.
- **Task 2:** `cd /Users/Q284340/Agentic/km-core && npx tsc --noEmit && npm run build && test -f dist/ontology/registry.js && test -f dist/ontology/index.js && grep -qF "export { OntologyRegistry }" src/index.ts && grep -qF "export { GraphKMStore }" src/index.ts && echo OK` → `OK`. `dist/ontology/{registry,loader,index}.{js,d.ts,js.map,d.ts.map}` all generated. Sub-barrel has 3 `OntologyRegistry` matches (runtime + type + comment-mention). Root barrel has 3 `OntologyRegistry` matches.

Bonus (beyond plan's required `<verify><automated>`): external-consumer smoke compile in a tmpdir verifies `@fwornle/km-core/ontology` sub-path resolution works with the new exports map entry; all 33 Phase 37 vitest tests still pass on `npx vitest run`.

## Authentication Gates Encountered

None — no external services, no auth tokens, no MCP calls during execution. All work was filesystem + git inside two local repos (`/Users/Q284340/Agentic/km-core` + `/Users/Q284340/Agentic/coding`).

## Issues Encountered

None.

## TDD Gate Compliance

Plan 38-03 type is `execute` (not `tdd`). No RED→GREEN→REFACTOR gate sequence required. Tests for the registry land in Plan 38-06 (the dedicated test plan in Wave 3) per the phase's 6-plan layout.

## Threat Flags

None new. The plan's `<threat_model>` register dispositions are all honored:

- **T-38-03-01 (malformed lower-ontology JSON)** mitigated — default skip+warn via stderr, strict-mode rethrow on `strict: true`.
- **T-38-03-02 (colliding class names)** mitigated — stderr warning with full provenance (prev source → new source) + "last-loaded wins" pointer.
- **T-38-03-03 (concurrent reload during lookup)** mitigated — atomic two-statement swap idiom; single-threaded JS makes adjacency the synchronization point.
- **T-38-03-04..06** accepted dispositions (info-leak in stderr / large dir DoS / multi-process race) — all out of scope for v0.1; documented in plan threat model.

No new security-relevant surface was introduced beyond what the plan's threat register already anticipated.

## User Setup Required

None — pure library-level changes inside km-core. No environment variables, no dashboard configuration, no external services touched.

## Next Phase Readiness

- **Plan 38-04 (registryBackedValidator factory)** — Ready. Imports `OntologyRegistry` (type-only) from `'../ontology/registry.js'` and exports a factory returning the OntologyValidator interface. After 38-04 lands, the root barrel will also re-export `registryBackedValidator`. 38-04 frontmatter `depends_on: [38-01, 38-03]` (per 38-PLAN-CHECK BLOCK-1 resolution) is satisfied — Plan 38-03 is now on `main`.
- **Plan 38-05 (GraphKMStore wiring)** — Ready. Will add `ontologyDir?` + `ontologyStrict?` to `GraphKMStoreOptions`, instantiate the registry internally when set, expose `store.ontology` getter, and auto-wire `registryBackedValidator(this.registry)` into the existing validator resolution chain (most-specific wins: explicit > auto-wired > noop). 38-05 depends on 38-03 (this plan) + 38-04.
- **Plan 38-06 (tests)** — Ready. The fixture directory from Plan 38-02 (`~/Agentic/km-core/tests/fixtures/ontology/`) + the registry class from this plan are both durably available. The 6 test describe-blocks (auto-discovery / extends+merging / public API / collision-D-27 / reload-D-29 / coding-fixture-SC#3) will execute against these artifacts.
- **No blockers.** km-core compiles clean; all 33 Phase 37 vitest tests still green; both `@fwornle/km-core` and `@fwornle/km-core/ontology` import paths verified via external smoke compile.

## Self-Check: PASSED

- `/Users/Q284340/Agentic/km-core/src/ontology/registry.ts` — FOUND (`test -f` true, 249 lines)
- `/Users/Q284340/Agentic/km-core/src/ontology/index.ts` — FOUND (`test -f` true, 21 lines)
- `/Users/Q284340/Agentic/km-core/src/index.ts` — MODIFIED (47 → 62 lines; Phase 38 block appended; existing exports intact)
- `/Users/Q284340/Agentic/km-core/package.json` — MODIFIED (`exports` map extended with `./ontology` entry)
- km-core commit `5651142` — FOUND in `git log --oneline -3` (`feat(38-03): add OntologyRegistry class with 5 deltas vs OKM (ONTO-01/02)`)
- km-core commit `f006e91` — FOUND in `git log --oneline -3` (`feat(38-03): add ontology sub-barrel + root re-exports + exports map (ONTO-01/02)`)
- `cd /Users/Q284340/Agentic/km-core && npx tsc --noEmit` — exits 0
- `cd /Users/Q284340/Agentic/km-core && npm run build` — exits 0; `dist/ontology/{registry,loader,index}.{js,d.ts}` all present
- `cd /Users/Q284340/Agentic/km-core && npx vitest run` — 6 files / 33 tests / 33 passed (zero Phase 37 regression)
- External-consumer smoke compile (tmpdir + `@types/node@22` + NodeNext) — `tsc --noEmit` exits 0 for both root and sub-path imports

---
*Phase: 38-ontology-registry*
*Completed: 2026-05-20*
