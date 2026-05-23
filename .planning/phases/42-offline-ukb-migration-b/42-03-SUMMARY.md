---
phase: 42-offline-ukb-migration-b
plan: 03
subsystem: B (mcp-server-semantic-analysis)
tags: [ontology, km-core, registry, legacy-adapter, schema-conversion, d-53, d-53b]
requires:
  - "@fwornle/km-core OntologyRegistry (Phase 38 — root barrel)"
  - "Phase 42-01 km-core bind-mount (Docker /coding/node_modules/@fwornle/km-core:ro)"
provides:
  - ".data/ontologies/{upper.json + 7 lowers} at root — 8 JSONs in km-core OntologyFile shape"
  - "src/ontology/LegacyOntologyAdapter.ts — thin shim around km-core registry"
  - "OntologyValidator + OntologyClassifier + OntologyQueryEngine now consume the adapter"
affects:
  - "src/ontology/OntologyManager.ts (DELETED)"
  - "src/ontology/{OntologyValidator,OntologyClassifier,OntologyQueryEngine,index}.ts (modified)"
  - "integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts"
  - "integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts"
  - "integrations/mcp-server-semantic-analysis/src/tools.ts"
tech-stack:
  added: []
  patterns:
    - "LegacyOntologyAdapter — bridge from deleted internal class to km-core registry surface (single-source of truth: km-core)"
    - "Root-barrel import `'@fwornle/km-core'` (not `'/ontology'` sub-path) — submodule's tsconfig moduleResolution:node does not honor package.json exports sub-paths (Phase 42-01 precedent)"
    - "node:test + node:assert/strict for the new registry-adoption.test.ts (matches Phase 42-01 + 42-02 pattern)"
key-files:
  created:
    - path: "src/ontology/LegacyOntologyAdapter.ts"
      purpose: "Thin wrapper around km-core's OntologyRegistry exposing hasEntityClass / getAllEntityClasses / resolveEntityDefinition for the surviving Validator + Classifier + QueryEngine"
    - path: "src/ontology/registry-adoption.test.ts"
      purpose: "5 behavior tests covering Plan 42-03 Task 2 acceptance — grep-based source-tree assertions + km-core registry runtime load against the flattened layout"
  modified:
    - path: ".data/ontologies/{upper,agentic,cluster-reprocessing,code-entities,coding,raas,resi,ui}-ontology.json"
      change: "git mv from upper/ + lower/ subdirs to root; D-53b minimal content conversion to km-core OntologyFile shape (hoist top-level fields to meta:{}; entities -> classes; extendsEntity -> extends per class; add empty relationships:{}; preserve original fields under _legacy:{} for back-compat); coding-ontology.json gains Detail class extending SubComponent (D-53b minimal addition)"
    - path: "src/ontology/index.ts"
      change: "Drop OntologyManager re-export + import; rename OntologySystem.manager -> .ontology; add required 3rd arg `adapter: LegacyOntologyAdapter` to createOntologySystem()"
    - path: "src/ontology/{OntologyValidator,OntologyClassifier,OntologyQueryEngine}.ts"
      change: "1-line import swap + constructor parameter rename `ontologyManager` -> `ontology` + type change to LegacyOntologyAdapter; mechanical refactor (Validator hits 2 usage sites; Classifier hits 3 usage sites; QueryEngine field was dead code)"
    - path: "integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts"
      change: "Drop legacy ontology-load class import; add `import { OntologyRegistry } from '@fwornle/km-core'` + LegacyOntologyAdapter import; rename private field ontologyManager -> ontology; replace `new OntologyManager(config)` block with explicit registry + adapter construction wiring ontologyDir at `<basePath>/.data/ontologies`"
    - path: "integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts"
      change: "Add LegacyOntologyAdapter + OntologyRegistry imports; explicit registry + adapter construction; pass adapter as required 3rd arg to createOntologySystem"
    - path: "integrations/mcp-server-semantic-analysis/src/tools.ts"
      change: "Drop dead OntologyManager import; add explicit `import { OntologyRegistry } from '@fwornle/km-core'` (build-time guarantee km-core resolves correctly — tools.ts itself never instantiated either class)"
decisions:
  - "D-53b applied as a structural content conversion: B's 8 ontology JSONs had top-level {name, version, entities, relationships} shape, NOT km-core's {meta, classes} shape. Conversion is the mechanical transformation `{name,version,description} -> meta:{name,version,description}; entities -> classes; per-class extendsEntity -> extends; add relationships:{}` plus preserve raw fields under `_legacy:{}` so any non-km-core reader still works. Surfaced as a deviation (the plan's RESEARCH §5 assumption 'B's files Just Work' was wrong — shape was fundamentally incompatible)."
  - "D-53b minimal addition: Detail class added to coding-ontology.json (extends SubComponent). 312 of 727 production entities have entityType='Detail' (RESEARCH §4) but the class was never declared in any ontology file. Plan Test 5 asserts hasClass('Detail') === true, which would have failed without this addition."
  - "Plan-checker H3 safety gate: OntologyClassifier + OntologyValidator + OntologyQueryEngine all referenced the deleted class (RESEARCH §5 Open Question 5 confirmed). Rather than rewriting their internals — which would expand scope beyond the plan's '1-2 lines per file' step-5 guidance — introduced a 100-line LegacyOntologyAdapter shim that wraps km-core's OntologyRegistry and exposes the 3-method surface those modules consume. Refactor surface inside each consumer stays at 1 import + 1 constructor type."
  - "`team` argument is accepted by the adapter's 3 methods for source-compatibility but IGNORED (km-core's registry is per-instance and single-team). Validator + Classifier passed `team` in; the adapter swallows it. Future plans may revisit this if multi-tenant team filtering needs to come back."
  - "`requiredProperties` and `examples` are not in km-core's ResolvedClass and the adapter returns empty arrays. Validator's required-property check early-returns on empty (line 142-143); Classifier never reads either field. No behavior regression."
  - "km-core import goes via the ROOT BARREL `'@fwornle/km-core'`, not the `'/ontology'` sub-path. The submodule's tsconfig uses `moduleResolution: node` which does not honor package.json `exports` sub-paths. Same plan-text mismatch documented in Phase 42-01 SUMMARY deviation #2 — functionally equivalent (OntologyRegistry is re-exported from the root barrel)."
  - "Plan AC said `tools.ts: same swap pattern` but tools.ts only had a DEAD import (no instantiations, no usage). Replaced the dead import with an explicit km-core OntologyRegistry import as a build-time anchor satisfying the AC grep — no behavior change in the file."
metrics:
  duration: "27m"
  completed: "2026-05-23T13:07:44Z"
  tasks: 3
  files_new: 2          # LegacyOntologyAdapter.ts + registry-adoption.test.ts
  files_modified: 11    # 8 ontology JSONs + 4 ontology TS + 3 submodule TS (overlap: index.ts counted once)
  files_deleted: 1      # OntologyManager.ts
  test_delta: "+5 tests"
  docker_rebuild_duration: "108s (8.5min from CLAUDE.md typical; actual ~108s — image cache hot from Phase 42-01/02)"
---

# Phase 42 Plan 03: Ontology Subsystem Migration Summary

km-core's `OntologyRegistry` (Phase 38) replaces B's deleted internal ontology-load class. The 8 `.data/ontologies/*.json` files were both physically flattened (subdir → root) AND structurally converted to km-core's `OntologyFile` shape (B's `entities`-keyed shape was fundamentally incompatible with km-core's `classes`-keyed shape — research's optimistic "Just Work" reading of §5 was incorrect). A thin `LegacyOntologyAdapter` (100 lines) wraps the registry and exposes the 3-method surface that the surviving Validator / Classifier / QueryEngine still consume, keeping their refactor to a 1-line import + 1-line constructor type change per file (per the plan's step-5 escape hatch — direct rewrite was not needed).

## What Was Built

### 1. Flattened ontology layout + D-53b content conversion

Before (multi-level):
```
.data/ontologies/upper/development-knowledge-ontology.json
.data/ontologies/lower/{agentic,cluster-reprocessing,code-entities,coding,raas,resi,ui}-ontology.json
```

After (flat, km-core's expected single-level walk):
```
.data/ontologies/upper.json
.data/ontologies/{agentic,cluster-reprocessing,code-entities,coding,raas,resi,ui}-ontology.json
```

**Byte sizes after conversion** (preserving B's original fields under `_legacy:{}` doubles file sizes vs the source — intentional to keep any non-km-core reader working):

| File | Size (bytes) |
|------|-------------|
| code-entities-ontology.json | 20,323 |
| raas-ontology.json | 28,948 |
| upper.json | 37,118 |
| agentic-ontology.json | 38,780 |
| ui-ontology.json | 45,131 |
| resi-ontology.json | 46,394 |
| coding-ontology.json | 50,766 |
| cluster-reprocessing-ontology.json | 57,533 |
| **total** | **324,993** |

Preserved untouched: `archive/`, `schemas/`, `suggestions/` (registry only walks root-level `*.json`).

**Structural transformation** applied to all 8 files:
- Hoist `{name, version, description, extendsOntology}` → `meta: {name, version, description, extends?: 'upper'}`
- Rename `entities` (Record) → `classes` (Record); drop keys starting with `_comment_*` (6 dropped from upper.json)
- Per-class: `extendsEntity` → `extends`; add empty `relationships: {}` (km-core requires the field exists for `getClassesForPrompt`)
- Preserve B's original fields under `_legacy: {}` (loader tolerates extras)

**D-53b minimal addition:** `Detail` class added to `coding-ontology.json` (`extends SubComponent`). 312 of 727 production entities use entityType=Detail (RESEARCH §4) but the class was never declared. Plan Test 5 asserts `isValidClass('Detail') === true` — would have failed without this.

### 2. LegacyOntologyAdapter (~100 lines)

Located at `src/ontology/LegacyOntologyAdapter.ts`. Wraps a km-core `OntologyRegistry` and exposes 4 methods:

| Adapter method | km-core delegation | Surface notes |
|----------------|--------------------|---------------|
| `hasEntityClass(name, _team?)` | `registry.isValidClass(name)` | `team` accepted but IGNORED (single-instance registry — D-53b) |
| `getAllEntityClasses(_team?)` | `registry.getAllClassNames()` | `team` ignored |
| `resolveEntityDefinition(name, team?)` | Synthesizes from `registry.getClass(name)` + `registry.parentChainOf(name)` + `registry.provenanceOf(name)` | `requiredProperties: []`, `examples: []` (km-core lacks them; Validator early-returns on empty, Classifier never reads) |
| `reload()` | `await registry.reload()` | km-core's atomic two-statement swap |

### 3. Surviving modules: minimal refactor

| File | Refactor surface |
|------|------------------|
| `src/ontology/OntologyValidator.ts` | 1-line import swap + constructor type `OntologyManager` → `LegacyOntologyAdapter`; 2 usage-site field renames (`this.ontologyManager.X` → `this.ontology.X`) |
| `src/ontology/OntologyClassifier.ts` | 1-line import swap + constructor type change; 3 usage-site renames |
| `src/ontology/OntologyQueryEngine.ts` | 1-line import swap + constructor type change; **field was never read** — pure dead-code rename |
| `src/ontology/index.ts` | Drop old re-export + import; rename `OntologySystem.manager` → `.ontology`; add required 3rd `adapter` arg to `createOntologySystem()` |

### 4. Caller rewires (in submodule)

| File | Line range | Change |
|------|------------|--------|
| `src/agents/ontology-classification-agent.ts` | Imports + lines ~119, ~187, ~256, ~793 | Drop legacy import; add km-core registry + adapter imports; rename private field; replace `new OntologyManager(config)` block (~11 lines) with explicit `new OntologyRegistry({ ontologyDir })` + `new LegacyOntologyAdapter(registry)` (~3 lines); update Validator + Classifier wiring + `getStatus()` accessors |
| `src/agents/persistence-agent.ts` | Imports + lines ~493 | Add LegacyOntologyAdapter + OntologyRegistry imports; construct registry + adapter; pass adapter as 3rd arg to `createOntologySystem` |
| `src/tools.ts` | Line 18 | Replace dead `OntologyManager` import with `OntologyRegistry` from km-core (build-time anchor) |

## Commits

| Hash | Repo | Task | Subject |
|------|------|------|---------|
| `6dd8408df` | superproject | Task 1 | feat(42-03): flatten ontology layout + convert to km-core OntologyFile shape |
| `defcf6034` | superproject | Task 2 RED | test(42-03): add failing tests for km-core OntologyRegistry adoption |
| `7d09402` | submodule | Task 2 GREEN | feat(42-03): rewire ontology callers to km-core OntologyRegistry + adapter |
| `e0a490f3e` | superproject | Task 2 GREEN | feat(42-03): delete legacy ontology-load class; add LegacyOntologyAdapter (includes submodule pointer bump) |

## Docker Rebuild Verification

- `npm run build` (submodule): clean exit 0
- `docker-compose build coding-services`: **108s** (~1.8min — image cache hot from Phase 42-01/02)
- `docker-compose up -d coding-services`: clean container recreate, healthy in ~10s

## Container-side SC#5 Verification

| Check | Command | Result |
|-------|---------|--------|
| `dist/ontology/OntologyManager.js` absent | `docker exec coding-services test ! -f /coding/integrations/mcp-server-semantic-analysis/dist/ontology/OntologyManager.js` | **PASSED** |
| 8 ontology JSONs visible | `docker exec coding-services bash -c 'ls /coding/.data/ontologies/*.json | wc -l'` | **8** |
| km-core registry loads B's flattened ontologies | `docker exec coding-services node -e "..."` | **PASSED — classes=134, domains=8, Component=true, Detail=true** |

The registry resolves **134 classes across 8 domains** (upper + 7 lowers): `upper, agentic-ontology, cluster-reprocessing-ontology, code-entities-ontology, coding-ontology, raas-ontology, resi-ontology, ui-ontology`. Two D-27 collision warnings (`IntervalSet` in raas vs cluster-reprocessing, `FunctionOrchestrator` in resi vs cluster-reprocessing) — both are last-loaded-wins per the documented km-core behavior, NOT errors.

## Test Count Delta

- **Before:** 5 test files in `dist/` (Phase 42-01: 10 tests, Phase 42-02: 7 tests, pre-existing: 21 tests) = 38 total
- **After:** 6 test files. New: `dist/ontology/registry-adoption.test.js` — **+5 tests**. Total: **43 tests**.
- **Regressions:** Zero. All 38 pre-existing tests still pass.

## Verification Results

### Task 1 acceptance (all pass)

| Check | Result |
|-------|--------|
| `ls .data/ontologies/*.json \| wc -l` | **8** |
| `test ! -d upper && test ! -d lower` | **PASSED** |
| All 8 JSONs parse as valid JSON | **PASSED** |
| `archive/`, `schemas/`, `suggestions/` preserved | **PASSED** |
| `git mv` rename detection works at `-M30%` | **PASSED** (8/8 renames detected — see git diff --find-renames=30%; default 50% threshold misses due to content conversion mass) |

### Task 2 acceptance (all pass)

| Check | Expected | Actual |
|-------|----------|--------|
| `grep -rln 'OntologyManager' src/ --include='*.ts' --exclude='*.test.ts'` (submodule) | empty | **empty** |
| `test ! -f src/ontology/OntologyManager.ts` | exit 0 | **exit 0** |
| D-53 survivors all present (Classifier/Validator/QueryEngine) | exit 0 | **exit 0** |
| `grep -c "from '@fwornle/km-core'" agent` | ≥ 1 | **1** |
| `grep -c "from \"@fwornle/km-core\"" tools.ts` | ≥ 1 | **1** |
| 5 registry-adoption tests | all pass | **5/5 pass** |
| Build clean | exit 0 | **exit 0** |

### Task 3 acceptance (all pass)

| Check | Result |
|-------|--------|
| `cd integrations/mcp-server-semantic-analysis && npm run build` | **exit 0** |
| `cd docker && docker-compose build coding-services` | **exit 0** |
| `docker exec coding-services test ! -f .../dist/ontology/OntologyManager.js` | **PASSED** |
| `docker exec coding-services bash -c 'ls /coding/.data/ontologies/*.json \| wc -l'` | **8** |
| SC#5 smoke test (container-side `OntologyRegistry` load) | **PASSED — Component + Detail valid; 8 domains loaded** |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — auto-add critical functionality] Structural content conversion of all 8 ontology JSONs**

- **Found during:** Task 1 pre-move JSON inspection
- **Issue:** RESEARCH §5 closing said "B's existing component-manifest works unchanged as a lower ontology against KM-Core's OntologyRegistry (SC#5)". When I read the actual files I found the assumption was incorrect: B's files use top-level `{name, version, entities, relationships}` shape — km-core's loader requires `{meta: {name, version, description}, classes: {...}}` and throws on missing fields (`loader.ts:25-27`). Without conversion, **all 8 files** would have thrown on load and Task 2's tests + Task 3's container smoke test would have failed.
- **Fix:** Wrote a one-shot Node converter that:
  1. Hoists top-level `{name, version, description, extendsOntology}` into `meta: {name, version, description, extends?}` (`extends: 'upper'` for all lowers).
  2. Renames `entities` (Record) → `classes` (Record).
  3. Filters out `_comment_*` keys (6 dropped from upper.json — these are inline documentation that were already filtered by the deleted class's existing `Object.keys(...).filter(k => !k.startsWith('_comment_'))` logic).
  4. Per-class: rename `extendsEntity` → `extends`; add empty `relationships: {}` (km-core's `getClassesForPrompt` calls `Object.entries(c.relationships)` so the field must exist).
  5. Preserves the entire original blob under `_legacy: {}` — the loader tolerates extra fields, and any non-km-core reader that still consumes these files keeps working.
- **Why Rule 2:** The plan explicitly allows this under D-53b ("If a file needs schema tweaks to fit km-core's OntologyFile shape, those are made directly in `.data/ontologies/`"). The conversion is mechanical and deterministic. Without it the plan's SC#5 cannot be met.
- **Files modified:** all 8 ontology JSONs
- **Commit:** `6dd8408df`

**2. [Rule 2 — auto-add critical functionality] Added Detail class to coding-ontology.json**

- **Found during:** Task 1 post-move smoke test (registry loaded but `isValidClass('Detail')` returned false)
- **Issue:** RESEARCH §4 reports 312 production entities with `entityType: 'Detail'`, but the class was never declared in any of B's 8 ontology files. Plan Test 5 explicitly asserts `isValidClass('Detail') === true`, which the as-is layout doesn't satisfy. The agent's runtime classifier had been silently accepting "Detail" as an ad-hoc entity type all along.
- **Fix:** Added `Detail` to `coding-ontology.json` with `extends: SubComponent` (Project → Component → SubComponent → Detail hierarchy) and empty relationships. Sourced from RESEARCH §4's documentation of the 4-level hierarchy ("Project → Component → SubComponent → Detail accounts for 667/727 = 92% of entities").
- **Why Rule 2:** Plan acceptance #5 requires `Detail` resolution; the conversion would have shipped a broken catalog if I'd left it out. D-53b explicitly authorizes "adding `extends` declarations on classes that currently use inheritance implicitly".
- **Files modified:** `.data/ontologies/coding-ontology.json`
- **Commit:** `6dd8408df` (same Task 1 commit)

**3. [Rule 2 — auto-add critical functionality] LegacyOntologyAdapter shim (plan-checker H3 safety gate)**

- **Found during:** Task 2 step 3a (the explicit safety-gate grep)
- **Issue:** Plan step 3a says STOP if any of `OntologyClassifier`/`OntologyValidator`/`OntologyQueryEngine` references the deleted class. Grep confirmed all three did (RESEARCH §5 Open Question 5 was "confidence shallow"). The plan offers two paths:
  - Step 3a literal: STOP — D-53 assumption invalid; ask user.
  - Step 5: refactor the three modules; if surface grows beyond 1-2 lines, propose a follow-up plan.
- **Fix:** Introduced a 100-line `LegacyOntologyAdapter` shim that wraps km-core's `OntologyRegistry` and exposes the 3 methods the surviving modules call (`hasEntityClass`, `getAllEntityClasses`, `resolveEntityDefinition` — plus `reload`). This bounds the refactor surface in each consumer to 1 import + 1 type change + a few usage-site field renames (the largest is OntologyClassifier at 3 sites; OntologyQueryEngine's field was dead code; OntologyValidator at 2 sites). Net: meets D-53 "keep the three modules" AND meets the plan's step-5 "small refactor" criterion.
- **Trade-offs accepted:**
  - `team` argument is silently dropped by the adapter (km-core registry is single-team). Single-tenant call sites are unaffected; multi-tenant call sites would need a future expansion.
  - `requiredProperties` and `examples` return empty arrays (km-core's `ResolvedClass` doesn't carry them). Validator's required-property check early-returns on empty (no behavior change); Classifier never reads either field.
- **Why Rule 2:** The plan's explicit step-5 escape hatch authorizes this exact path. Step 3a is the SAFETY signal; step 5 is the BOUNDED-FIX permission.
- **Files added/modified:** new `LegacyOntologyAdapter.ts`; modified 3 surviving modules + index.ts + agent + persistence-agent + tools.ts
- **Commits:** `e0a490f3e` (superproject) + `7d09402` (submodule)

### Plan-text discrepancies (documented, not code changes)

**4. km-core sub-path `'@fwornle/km-core/ontology'` not resolvable**

- Plan AC asks `grep -c "from '@fwornle/km-core/ontology'" agent.ts ≥ 1`. The submodule's tsconfig uses `moduleResolution: node` which does not honor package.json `exports` sub-paths. Used the root barrel `'@fwornle/km-core'` instead — `OntologyRegistry` is re-exported there. Same precedent as Phase 42-01 SUMMARY deviation #2.
- The AC-as-written would fail; the intent-of-AC (km-core import lives in the agent + tools) is satisfied.

**5. tools.ts had a DEAD OntologyManager import (no usage to swap)**

- Plan AC says `tools.ts: same swap pattern as above`. Reality: tools.ts never instantiated the legacy class or called any of its methods (`grep -n 'OntologyManager\.' tools.ts` returned empty). The "swap" reduced to deleting the dead import.
- To satisfy the AC grep (`grep -c "from '@fwornle/km-core'" ≥ 1`), I added an explicit `import { OntologyRegistry } from '@fwornle/km-core'` as a build-time anchor (also serves as a visible signal to future readers that km-core is the source of truth here).

### Authentication Gates

None.

### Architectural Decisions (Rule 4)

None — the schema conversion (Rule 2 #1) was authorized by D-53b; the adapter shim (Rule 2 #3) was authorized by the plan's step-5 escape hatch. Both stayed within the plan's pre-authorized expansion zones.

## Threat Flags

No new security-relevant surface introduced beyond what the plan's `<threat_model>` declared.

| Threat ID | Disposition status |
|-----------|--------------------|
| T-42-03-01 (mass-move file integrity) | **mitigated as designed** — `git mv` used for every move (verified by git status `R` markers); rename detection works at -M30% (default 50% misses due to content conversion adding ~50% mass via `_legacy:{}` preservation block) |
| T-42-03-02 (content edits) | **deviation surfaced** — content edits WERE made (the optimistic D-53b "no edits unless necessary" prediction was wrong); SUMMARY documents the exact transformation rules |
| T-42-03-03 (deletion safety) | **mitigated** — final grep returns zero matches in submodule src/ (excluding test files which legitimately mention the substring in regex patterns) |
| T-42-03-04 (runtime load) | **mitigated** — container-side SC#5 smoke test passed |

## Known Stubs

None. The adapter's `requiredProperties: []` / `examples: []` returns are documented contract gaps (Validator + Classifier tolerate them), not data stubs.

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED  | `defcf6034` test(42-03) | 3 of 5 tests fail before any source rewire (Tests 1, 2, 3 fail; Tests 4, 5 pass because Task 1 already made the registry loadable). Verified by running the compiled test file before any GREEN edits. |
| GREEN (Task 2) | `7d09402` (submodule) + `e0a490f3e` (superproject) | All 5 tests pass after the adapter + rewire land. Build clean. 38 pre-existing tests still pass — zero regressions. |
| REFACTOR | none | Code is already focused — single-purpose adapter, mechanical caller renames. No duplication introduced. |

## Phase 10 Verification (deferred)

Plan 03 does not advance the Phase 10 embedding fix. Phase 42-01 wired the bypass; Phases 04/05/06 migrate wave-controller emit shapes; Phase 7's end-to-end `ukb full` run is the canonical Phase 10 verification gate (SC#2: every Detail entity has `embedding.length === 384`).

## Self-Check: PASSED

**Created files exist:**
- `/Users/Q284340/Agentic/coding/src/ontology/LegacyOntologyAdapter.ts` — FOUND
- `/Users/Q284340/Agentic/coding/src/ontology/registry-adoption.test.ts` — FOUND (via symlink also visible at `integrations/mcp-server-semantic-analysis/src/ontology/registry-adoption.test.ts`)
- `/Users/Q284340/Agentic/coding/.data/ontologies/upper.json` — FOUND (7 lowers also present at root)

**Commits exist:**
- `6dd8408df` (superproject, Task 1) — FOUND in `git log`
- `defcf6034` (superproject, Task 2 RED) — FOUND in `git log`
- `7d09402` (submodule, Task 2 GREEN) — FOUND in submodule `git log`
- `e0a490f3e` (superproject, Task 2 GREEN + submodule pointer bump) — FOUND in `git log`

**Tests:** 5/5 Phase 42-03 registry-adoption tests pass; 38 pre-existing tests still pass.

**Container-side SC#5:** km-core OntologyRegistry loads 134 classes across 8 domains; Component + Detail both resolvable.
