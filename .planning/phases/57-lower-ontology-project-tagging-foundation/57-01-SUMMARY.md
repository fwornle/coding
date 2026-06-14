---
phase: 57-lower-ontology-project-tagging-foundation
plan: 01
plan_id: 57-01
subsystem: shared/km-core
tags: [km-core, types, branded-type, project-registry, phase-57, foundation]
requires: []
provides:
  - "@fwornle/km-core: PROJECTS const tuple, Project literal-union type, isProject runtime typeguard"
  - "Single source of truth for the closed-set project vocabulary ('coding'|'okm'|'cap') consumed by Phase 57 Plans 03 (writer stamping), 04 (classifier emission), 05 (backfill), 06 (viewer filter fallback)"
affects:
  - lib/km-core/src/types/project.ts (new)
  - lib/km-core/src/types/index.ts (per-module barrel re-export)
  - lib/km-core/src/index.ts (root barrel re-export)
  - lib/km-core/tests/unit/project.test.ts (new — 17 it() blocks)
tech-stack:
  added: []
  patterns:
    - "Literal-union closed-set vocabulary via `as const` tuple + `typeof[number]` derived type (mirrors `Layer = 'evidence' | 'pattern'` in src/types/entity.ts:27)"
    - "Runtime typeguard alongside compile-time literal-union (combines branded-scalar pattern from src/ids/branded.ts with the closed-set pattern)"
    - "Per-module + root barrel re-export of the new value+type surface (mirrors EntityId precedent at src/index.ts:31)"
key-files:
  created:
    - "lib/km-core/src/types/project.ts (51 LoC — JSDoc + 3 exports)"
    - "lib/km-core/tests/unit/project.test.ts (143 LoC — 17 it() blocks across 5 describe blocks)"
  modified:
    - "lib/km-core/src/types/index.ts (24→27 lines; +3 lines for value + type re-export)"
    - "lib/km-core/src/index.ts (279→289 lines; +10 lines for value + type re-export with JSDoc)"
decisions:
  - "Skipped optional MetadataWithProject helper type per PATTERNS.md — `Entity.metadata: Record<string, unknown>` is the locked shape; one more import per writer outweighs the compile-time benefit while Phase 57 ships."
  - "Test imports the module file directly (src/types/project.js) in Task 1 to keep RED/GREEN self-contained; Task 2 appends a separate barrel-reachability describe block that imports from `src/index.js` AND `src/types/index.js`. Cleaner per-task TDD discipline than coupling Task 1's GREEN gate to Task 2's barrel wiring."
  - "Root-barrel re-export placed adjacent to EntityId (line 31 region) to group identity-related primitives. JSDoc header cites Phase 57 D-03 and lists the writer paths that depend on the registry."
  - "No package.json `exports` map entry added — `./types` sub-path was already exposed; D-03 anchors the registry at the root barrel for ergonomic writer import."
metrics:
  duration_min: 6
  total_tasks: 2
  completed_date: 2026-06-14
  tests_added: 17
  tests_baseline: 334
  tests_final: 352
  net_test_delta: 18
  full_suite_status: green
---

# Phase 57 Plan 01: Lower-Ontology + Project-Tagging Foundation — Project Type Registry

**One-liner:** Ships the closed-set Project type registry (`PROJECTS`/`Project`/`isProject`) in km-core as the single source of truth every Phase 57 writer + reader imports.

## What Shipped

The foundational primitive every downstream Phase 57 plan depends on:

```typescript
// lib/km-core/src/types/project.ts
export const PROJECTS = ['coding', 'okm', 'cap'] as const;
export type Project = typeof PROJECTS[number];
export function isProject(x: unknown): x is Project {
  return typeof x === 'string' && (PROJECTS as readonly string[]).includes(x);
}
```

Reachable via two import paths:

```typescript
// Root barrel (preferred for writers — single import point):
import { PROJECTS, isProject, type Project } from '@fwornle/km-core';

// Per-module sub-path (for consumers that already use the ./types sub-path):
import { PROJECTS, isProject, type Project } from '@fwornle/km-core/types';
```

## Tasks Executed

### Task 1: Create km-core Project type module + unit tests (TDD)

- **RED commit (submodule):** `b67800e` — `test(57-01): add failing tests for Project type registry (D-03)`. 15 it() blocks covering tuple shape, accept-list, reject-list (case variants, empty string, null, undefined, number, object, array), and compile-time literal-union witness. Tests failed with `TypeError: isProject is not a function` as expected.
- **GREEN commit (submodule):** `f092829` — `feat(57-01): implement Project type registry (PROJECTS / Project / isProject)`. Module created with JSDoc citing D-03 + the "adding a new project = code change" contract. 15 it() blocks pass.
- **Parent-repo pointer bump:** `f84164414`.

### Task 2: Wire barrel re-exports + km-core build + patch verification

- **Barrels wired:** `src/types/index.ts` (per-module) + `src/index.ts` (root) both re-export `PROJECTS`, `isProject` (value) and `Project` (type), grouped with the existing `EntityId` re-export.
- **`tests/unit/project.test.ts` extended** with 2 root-barrel reachability assertions (one for `@fwornle/km-core`, one for `@fwornle/km-core/types`) that assert reference-identical resolution via both paths.
- **`cd lib/km-core && npm run build`:** clean (tsc, no errors). `dist/types/project.{js,d.ts}` produced; `dist/index.d.ts` re-exports the trio.
- **Runtime barrel witness (matches plan `<verification>` block):**
  ```bash
  node --input-type=module -e \
    'import("@fwornle/km-core").then(km => console.log(km.PROJECTS, km.isProject("coding")))'
  → ["coding","okm","cap"] true
  ```
- **Submodule commit:** `a75acf8`. **Parent-repo pointer bump:** `843fc2be4`.

## Acceptance Criteria — Result Matrix

| AC                                                            | Expected | Actual                                                  | Status |
| ------------------------------------------------------------- | -------- | ------------------------------------------------------- | ------ |
| Task 1 — `src/types/project.ts` exports trio                  | 3        | 3 (`export const PROJECTS`, `export type Project`, `export function isProject`) | PASS   |
| Task 1 — `project.test.ts` it() blocks                        | ≥ 10     | 17 (15 Task-1 + 2 Task-2 barrel)                        | PASS   |
| Task 1 — `npm test -- project.test.ts` exit code              | 0        | 0 (17/17 + 12 collateral in adapters-online passing)    | PASS   |
| Task 1 — no TODO/FIXME in test                                | 0        | 0                                                       | PASS   |
| Task 2 — `from './project` in `src/types/index.ts`            | ≥ 1      | 2 (one value re-export, one type re-export)             | PASS   |
| Task 2 — `project` mentions in `src/index.ts`                 | ≥ 1      | 12 (re-exports + JSDoc)                                 | PASS   |
| Task 2 — `dist/types/project.d.ts` exists post-build          | yes      | yes (1009 bytes)                                        | PASS   |
| Task 2 — `dist/types/project.d.ts` carries the trio           | ≥ 3      | 6                                                       | PASS   |
| Task 2 — full km-core suite                                   | green    | 352/352 passing in 2.88s                                | PASS   |
| Task 2 — root-barrel runtime import works                     | yes      | `{PROJECTS:['coding','okm','cap'], isProject: function}` | PASS   |

## Test Count Delta

| Metric                          | Baseline (pre-plan) | Final (post-plan) | Delta |
| ------------------------------- | ------------------- | ----------------- | ----- |
| `lib/km-core` total tests       | 334                 | 352               | +18   |
| `lib/km-core` test files        | 36                  | 37                | +1    |
| `lib/km-core` test runtime (full) | 2.98s wall-clock  | 2.88s wall-clock  | -0.1s |

17 it() blocks ship in `project.test.ts`; +1 collateral collection difference comes from vitest's file-discovery counting.

## Self-Check: PASSED

Files created (verified `[ -f ... ]`):

- `lib/km-core/src/types/project.ts` — FOUND
- `lib/km-core/tests/unit/project.test.ts` — FOUND

Files modified (verified `grep` markers present):

- `lib/km-core/src/types/index.ts` — `from './project.js'` FOUND (2 matches: value + type)
- `lib/km-core/src/index.ts` — `from './types/project.js'` FOUND (2 matches: value + type)

Commits verified (`git log --oneline | grep -q <hash>`):

- Submodule `b67800e` (RED) — FOUND
- Submodule `f092829` (GREEN) — FOUND
- Submodule `a75acf8` (Task 2 barrels) — FOUND
- Parent `f84164414` (pointer-bump Task 1) — FOUND
- Parent `843fc2be4` (pointer-bump Task 2) — FOUND

Build artifact (verified `ls -la`):

- `lib/km-core/dist/types/project.d.ts` — FOUND (1009 bytes)
- `lib/km-core/dist/types/project.js` — FOUND (2150 bytes)

## TDD Gate Compliance

Per the `tdd="true"` Task 1 contract:

1. **RED** — `test(57-01): add failing tests for Project type registry (D-03)` at commit `b67800e`. Verified to fail with `TypeError: isProject is not a function`.
2. **GREEN** — `feat(57-01): implement Project type registry (PROJECTS / Project / isProject)` at commit `f092829`. Same suite passes.
3. **REFACTOR** — skipped; the implementation is minimal (3 exports, 51 LoC including JSDoc) and no cleanup opportunity surfaced.

Gate sequence visible in `git log --oneline lib/km-core` for Phase 57:

```
a75acf8 feat(57-01): wire PROJECTS / isProject / Project barrel re-exports + Task 2 reachability gate
f092829 feat(57-01): implement Project type registry (PROJECTS / Project / isProject)
b67800e test(57-01): add failing tests for Project type registry (D-03)
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Test self-containment] Task 1 test imports adjusted to module file**

- **Found during:** Task 1 RED-to-GREEN transition.
- **Issue:** The plan's `<behavior>` block had the test import `PROJECTS`/`isProject`/`Project` from `'@fwornle/km-core'` (root barrel) — but Task 1's scope is the module + tests only; barrel wiring is Task 2 scope. Importing from the root barrel would have coupled Task 1's GREEN gate to Task 2's barrel wiring, violating per-task TDD discipline.
- **Fix:** Adjusted test imports to read from `../../src/types/project.js` directly in Task 1. Task 2 appends a separate `Project barrel re-exports` describe block (2 it() blocks) that imports via both `src/index.js` and `src/types/index.js` and asserts reference-identical resolution.
- **Files modified:** `lib/km-core/tests/unit/project.test.ts` lines 21-25 (Task 1) + lines 124-143 (Task 2 append).
- **Commits:** `f092829` (Task 1 GREEN, includes the import adjustment) + `a75acf8` (Task 2, adds barrel-reachability tests).
- **Rationale:** Mirrors the per-task TDD discipline used throughout v7.1 (Phase 37 Plan 02 and Phase 38 Plan 03 both keep RED/GREEN focused on the module under test, with later tasks adding cross-cutting reachability assertions).

**2. [Rule 1 — Verification command alignment] Root-barrel verification used ESM dynamic import**

- **Found during:** Task 2 `<verification>` block execution.
- **Issue:** The plan's verification line `node -e "const km = require('@fwornle/km-core'); console.log(typeof km.isProject, km.PROJECTS);"` fails with `ERR_PACKAGE_PATH_NOT_EXPORTED` because km-core is ESM-only (`"type": "module"` + `exports` map specifies `import` only, not `require`).
- **Fix:** Used `node --input-type=module -e 'import("@fwornle/km-core").then(km => console.log(km.PROJECTS, km.isProject("coding")))'` which is the ESM-correct invocation and produces the same proof.
- **Files modified:** none.
- **Result:** `["coding","okm","cap"] true` — matches plan expectations.

### Out-of-Scope Discovery: km-core local patch (CLAUDE.md hydrate() guard)

- **Found during:** Task 2 patch verification step.
- **Observation:** `grep -c "JSON has more nodes" lib/km-core/dist/store/persistence.js` returns 0. Source-side `src/store/persistence.ts` also has no equivalent guard.
- **Root cause:** Per CLAUDE.md, the patch is a host-only manual patch applied after `npm install` to `node_modules/@fwornle/km-core/dist/store/persistence.js`. In this repository, `node_modules/@fwornle/km-core` is a **symlink** to `lib/km-core/`, so the patch would need to live in source under VCS to survive `npm run build` — but `git log src/store/persistence.ts` shows only the original Phase 37-03 import commit (`c023a64`); the patch has never been landed under VCS in this submodule.
- **This plan's impact:** ZERO — Task 2 ran `npm run build` (tsc) which compiled current source unchanged. The patch was absent BEFORE this plan and remains absent AFTER. Plan 57-01 neither introduces nor removes the patch.
- **Operator action:** Per CLAUDE.md, the patch should be re-applied manually if relevant for the operator's workflow. Logged here so the operator can decide. NOT in scope for Phase 57 Plan 01 (Plan 57-01 ships the Project type registry; the persistence.js patch is an unrelated km-core internals fix).
- **Not logged as a deviation** because no plan action introduced or removed the condition; it's pre-existing host-only state observed during verification.

## Threat Flags

None — Plan 57-01 adds a closed-set type registry and a runtime typeguard. No new network endpoint, auth path, file access pattern, schema change, or trust boundary is introduced. The typeguard itself is a security-positive primitive (the entire Phase 57 writer chain will use it to reject upstream misspellings, narrowing rather than widening the metadata vocabulary).

## Requirement Tracking Notes

- **LOWERONTO-04 not yet marked complete in REQUIREMENTS.md** even though it appears in this plan's frontmatter. Rationale: LOWERONTO-04 reads "Every KG entity carries a `project` tag... unified viewer exposes a project-grouping mode in the filter sidebar." Plan 01 ships only the type-registry foundation; the "every entity carries the tag" portion is satisfied by Plan 03 (writer-path stamping) + Plan 05 (one-shot backfill); the viewer-side filter-rail portion lands in Plan 06 (transitional read) and Phase 60 (full UX rework per D-11). Marking it complete here would be premature. Plan 05 or Phase 57's verifier closes the checkbox.
- **Tooling note:** `gsd-sdk query requirements.mark-complete LOWERONTO-04` returned `not_found` for an unrelated reason: the handler's regex `\*\*${reqId}\*\*` expects `**LOWERONTO-04**` (no colon inside bold) but the actual REQUIREMENTS.md format is `**LOWERONTO-04:**` (colon inside bold). Pre-existing format/handler mismatch, out of scope for Plan 57-01. Logged as a deferred-items candidate for a future SDK-handler or REQUIREMENTS.md format alignment.

## Submodule Commit Topology

This plan modifies `lib/km-core/`, a git submodule:

| Commit | Repo | Branch | Hash | Subject |
| ------ | ---- | ------ | ---- | ------- |
| Task 1 RED | lib/km-core | main | `b67800e` | `test(57-01): add failing tests for Project type registry (D-03)` |
| Task 1 GREEN | lib/km-core | main | `f092829` | `feat(57-01): implement Project type registry (PROJECTS / Project / isProject)` |
| Task 1 pointer | outer (coding) | main | `f84164414` | `chore(57-01): bump lib/km-core pointer for Task 1 (Project type registry)` |
| Task 2 barrel + test | lib/km-core | main | `a75acf8` | `feat(57-01): wire PROJECTS / isProject / Project barrel re-exports + Task 2 reachability gate` |
| Task 2 pointer | outer (coding) | main | `843fc2be4` | `chore(57-01): bump lib/km-core pointer for Task 2 (barrel re-exports + build)` |
| Final docs + state | outer (coding) | main | (pending — final commit at end of plan) | `docs(57-01): complete Project type registry plan` |

`lib/km-core` runs in submodule mode; commits land on its own `main` branch with no parallel-version naming (compliance with km-core's `CLAUDE.md` no-parallel-versions rule). The outer-repo pointer-bump pair lands the new commit refs in the parent tree.

## Downstream Hand-off

Phase 57 plans 02-06 can now import the registry directly:

```typescript
import { PROJECTS, isProject, type Project } from '@fwornle/km-core';
```

- **Plan 02** (`coding.lower.json` ontology data) — independent of this plan; can land in parallel.
- **Plan 03** (writer-path stamping in canonical-mapper / km-core-adapter / wave agents) — calls `isProject(options.team)` before stamping `metadata.project`.
- **Plan 04** (classifier emission) — reads `PROJECTS` if the classifier ever needs to emit per-project hints (current scope only stamps; the registry is reference material).
- **Plan 05** (backfill script `scripts/backfill-project-tag.mjs`) — uses `PROJECTS` for the closed-set sanity check + the default-ambiguous-step value `'coding'` per D-05 step 4.
- **Plan 06** (viewer filter fallback in `graph-builder.ts:519-521`) — does not import the type module directly (the filter is string-based), but PROJECTS could optionally back a filter-rail dropdown in a follow-up phase.

## Operator Notes

1. **No Docker rebuild needed for this plan.** Downstream consumers re-resolve via the `node_modules/@fwornle/km-core` symlink to `lib/km-core/dist/` at next-task startup. The semantic-analysis container picks up the new types when Plan 03 triggers its own `cd integrations/mcp-server-semantic-analysis && npm run build && docker-compose build coding-services` rebuild per CLAUDE.md "Rebuilding After Code Changes".
2. **km-core local patch (CLAUDE.md):** If the operator workflow needs the JSON-export-preferred hydrate() guard, the patch must be re-applied per CLAUDE.md instructions. This plan did not touch persistence.js. See "Out-of-Scope Discovery" section above.

---

*Plan completed 2026-06-14, ~6 min wall-clock execution.*
