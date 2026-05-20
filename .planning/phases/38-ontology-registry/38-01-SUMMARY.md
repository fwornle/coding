---
phase: 38-ontology-registry
plan: 01
subsystem: km-core
tags: [km-core, ontology, types, loader, foundations, ESM, NodeNext]

# Dependency graph
requires:
  - phase: 37-km-core-foundation
    provides: "src/types/entity.ts Layer literal (single source of truth for 'evidence' | 'pattern')"
provides:
  - "OntologyFile / OntologyClass / OntologyProperty / ResolvedClass type surface"
  - "loadOntologyFile(path) sync JSON reader with shape validation + throw-on-malformed"
  - "src/ontology/ module directory (first source file in the new module)"
affects: [38-02, 38-03, 38-04, 38-05, 38-06, 42-okb-migration, 43-okm-migration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ESM with NodeNext .js import extensions on internal imports (CF-D06)"
    - "Sync registry + async store API (Pattern S4): file reads sync, registry sync, store API async"
    - "Layer import-and-reuse rather than literal inline (single source of truth)"

key-files:
  created:
    - "/Users/Q284340/Agentic/km-core/src/types/ontology.ts (55 lines, 4 exported interfaces)"
    - "/Users/Q284340/Agentic/km-core/src/ontology/loader.ts (30 lines, 1 exported function)"
  modified: []

key-decisions:
  - "Adopted OKM analog verbatim with one delta: import Layer from './entity.js' rather than inlining the 'evidence' | 'pattern' literal — preserves single source of truth established by Phase 37 Plan 02"
  - "Loader throws on shape error (missing meta / meta.name / classes); Plan 03 registry owns strict-mode policy (catch+rethrow OR warn+skip per D-29)"
  - "Loader stays synchronous despite store API being async — registry is in-memory map built once at construction and atomically swapped on reload() (Pattern S4)"
  - "No barrel changes — Plan 03 owns the atomic barrel update so the registry + types surface land together"

patterns-established:
  - "Pattern S2: NodeNext .js extension on internal imports (`from '../types/ontology.js'`) — non-negotiable per CF-D06"
  - "Pattern S4: sync reads in src/ontology/* underlying an async public store API"
  - "Two `extends?: string` fields with same key name but different semantic levels: ontology-level (OntologyFile.meta.extends, e.g. kpifw->upper) and per-class (OntologyClass.extends, e.g. KPIPipeline->Pipeline). Preserved per 38-PATTERNS landmines."

requirements-completed:
  - ONTO-01
  - ONTO-02

# Metrics
duration: 2min
completed: 2026-05-20
---

# Phase 38 Plan 01: Types + Loader Foundation Summary

**Type-only foundation for Phase 38: OntologyFile/OntologyClass/OntologyProperty/ResolvedClass interfaces + sync loadOntologyFile reader, both lifted verbatim from OKM's 29- and 13-line analogs with NodeNext `.js` extensions and Layer imported from `./entity.js`.**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-05-20T09:45:42Z
- **Completed:** 2026-05-20T09:47:21Z
- **Tasks:** 2
- **Files modified:** 2 (both created)

## Accomplishments

- `src/types/ontology.ts` exports 4 interfaces (`OntologyFile`, `OntologyClass`, `OntologyProperty`, `ResolvedClass`) matching OKM's analog verbatim with one delta: `defaultLayer?: Layer` rather than the inlined literal union. Single source of truth for the 'evidence' | 'pattern' set is now anchored in `src/types/entity.ts` from Phase 37.
- `src/ontology/loader.ts` exports `loadOntologyFile(path)` — sync `readFileSync(utf8)` → `JSON.parse` → shape validation (`!parsed.meta || !parsed.meta.name || !parsed.classes`) → throw on malformed input. Same shape OKM has run in production with files up to ~10KB (T-38-01-02 accepted disposition).
- Created the `src/ontology/` directory (first source file in this module — Plan 03 will populate it with registry.ts and a sub-barrel index.ts).
- TypeScript compiles clean (`npx tsc --noEmit` exits 0) after both commits. No `console.*` in either new file.
- No barrel changes — root `src/index.ts` is untouched. Plan 03 owns the atomic barrel update so the registry surface (class + types + factory) lands together.

## Task Commits

Each task was committed atomically inside the km-core repo on `main`:

1. **Task 1: Create src/types/ontology.ts** — `4bea298` (feat: 4 exported interfaces, Layer imported from './entity.js', NodeNext `.js` extension)
2. **Task 2: Create src/ontology/loader.ts** — `88dff82` (feat: sync JSON reader, throws on malformed, NodeNext `.js` import path; creates src/ontology/ directory)

km-core HEAD before plan: `18787e8` (fix(docs): replace br tags with newlines in Mermaid diagram for GitHub rendering).
km-core HEAD after plan: `88dff82`.

**Plan metadata (coding repo):** committed separately with this SUMMARY + STATE.md + ROADMAP.md update.

## Files Created/Modified

- `/Users/Q284340/Agentic/km-core/src/types/ontology.ts` — Created (55 lines). Type-only file declaring `OntologyProperty`, `OntologyClass` (with `extends?`, `description`, `relationships`, `properties?`, `defaultLayer?: Layer`), `OntologyFile` (with `meta: { name, version, extends?, description }` and `classes: Record<string, OntologyClass>`), and `ResolvedClass extends OntologyClass` (adds `name: string; source: string` for D-27 provenance and D-29 parent-chain traversal).
- `/Users/Q284340/Agentic/km-core/src/ontology/loader.ts` — Created (30 lines). `loadOntologyFile(path: string): OntologyFile` — sync read, JSON.parse with cast to `OntologyFile`, shape-validate, throw on malformed. Imports `OntologyFile` via `../types/ontology.js` (NodeNext).

## Decisions Made

- **Layer single-source-of-truth (PATTERNS landmine):** Imported `Layer` from `'./entity.js'` rather than inlining `'evidence' | 'pattern'`. If Phase 37 ever needs to extend the Layer union (e.g., add 'pattern-merged' or 'staged'), this file picks up the change automatically.
- **Two `extends?: string` fields preserved:** `OntologyFile.meta.extends?` (ontology-level inheritance) and `OntologyClass.extends?` (per-class chain). Same key name, different semantic levels — explicitly called out in both file comments and the plan's PATTERNS.md landmines.
- **No barrel touched** (Plan 03 contract): Plan 03 will atomically update `src/index.ts` to re-export `OntologyRegistry`, `OntologyRegistryOptions`, `loadOntologyFile`, `registryBackedValidator`, and the type surface together. Splitting that across plans would create an incoherent intermediate public surface.
- **Sync loader (Pattern S4):** Loader is intentionally sync — the registry's in-memory map is built once at construction and atomically swapped on `reload()`. Wrapping the file read in async would buy nothing and would force `loadFromDisk()` in the constructor to be async-via-IIFE, which Pattern S4 rejects.

## Deviations from Plan

None — plan executed exactly as written. Both tasks' acceptance criteria pass:

- Task 1 verify: `npx tsc --noEmit` exits 0 AND `grep -c '^export interface ' src/types/ontology.ts = 4` AND `import type { Layer } from './entity.js'` matches AND zero `console.*` matches.
- Task 2 verify: `npx tsc --noEmit` exits 0 AND `src/ontology/loader.ts` exists AND `from '../types/ontology.js'` matches AND `readFileSync(path, 'utf8')` matches AND `throw new Error(\`Invalid ontology file at` matches AND `export function loadOntologyFile(path: string): OntologyFile` matches exactly once AND zero `console.*` matches.

The acceptance criterion `grep -v "^//" src/types/ontology.ts | grep -c "defaultLayer\?:" = 1` is a basic-regex quirk on BSD grep (the literal `?:` doesn't match `\?:` in BRE without `-E`); the same pattern with ERE (`grep -cE "defaultLayer\?:"`) returns 1 as intended. The official `<verify><automated>` command (which does not use that grep) passes.

## Issues Encountered

None.

## TDD Gate Compliance

Plan 38-01 type is `execute` (not `tdd`). No RED→GREEN→REFACTOR gate sequence required. Tests for the registry + loader land in Plan 38-06 (the dedicated test plan), per the phase's 6-plan / 3-wave layout.

## Threat Flags

None — Plan 38-01 introduces only type declarations and a synchronous file reader. The threat surface declared by the plan's `<threat_model>` (filesystem -> loader boundary) is owned by Plan 03's registry, which catches `loadOntologyFile`'s thrown error and applies strict-mode policy (D-29). Loader's job is to throw cleanly; that contract is honored.

## User Setup Required

None — pure library-level changes inside km-core. No environment variables, no dashboard configuration, no external services touched.

## Next Phase Readiness

- **Plan 38-02 (test fixtures)** — Ready. The 4 verbatim OKM ontology JSONs and the synthetic `coding-ontology.json` will land in `tests/fixtures/ontology/`. No dependency on Plan 38-01 source — fixtures are pure data.
- **Plan 38-03 (registry)** — Ready. Imports `OntologyFile`, `ResolvedClass` from `../types/ontology.js` and `loadOntologyFile` from `./loader.js` — both shipped by this plan.
- **Plan 38-04 (registryBackedValidator factory)** — Indirectly ready; factory depends on `OntologyRegistry` (Plan 03) but the type surface for `OntologyClass` etc. is now available.
- **No blockers.** The km-core tree compiles clean; the directory layout matches the existing pattern (`src/store/`, `src/types/`, `src/validation/`, now `src/ontology/`).

## Self-Check: PASSED

- `/Users/Q284340/Agentic/km-core/src/types/ontology.ts` — FOUND (`test -f` returns true, line count 55)
- `/Users/Q284340/Agentic/km-core/src/ontology/loader.ts` — FOUND (`test -f` returns true, line count 30)
- km-core commit `4bea298` — FOUND in `git log --oneline -3` (`feat(38-01): add OntologyFile/OntologyClass/OntologyProperty/ResolvedClass types`)
- km-core commit `88dff82` — FOUND in `git log --oneline -3` (`feat(38-01): add loadOntologyFile sync JSON reader`)
- `cd /Users/Q284340/Agentic/km-core && npx tsc --noEmit` — exit 0
- `git diff 18787e8..HEAD --name-only` shows exactly the 2 intended files (no barrel leakage)

---
*Phase: 38-ontology-registry*
*Completed: 2026-05-20*
