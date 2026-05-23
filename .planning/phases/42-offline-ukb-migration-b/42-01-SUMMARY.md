---
phase: 42-offline-ukb-migration-b
plan: 01
subsystem: B (mcp-server-semantic-analysis)
tags: [km-core, strangler-adapter, phase-10-fix, feature-flag, persistence, wave-controller]
requires:
  - "@fwornle/km-core (Phase 37/38/39/40/41 surfaces)"
  - "GraphKMStore.mergeAttributes (km-core line 854)"
  - "GraphKMStore.putEntity / iterate / addRelation / batch / findByOntologyClass"
provides:
  - "src/storage/km-core-adapter.ts — strangler adapter exposing B's hot-path GraphDatabaseService surface against km-core"
  - "src/config/persistence-flag.ts — KM_CORE_PERSISTENCE env-var gate"
  - "wave-controller bypass write (line ~1417) now flag-gated; km-core path delegates to GraphKMStore.mergeAttributes"
affects:
  - "integrations/mcp-server-semantic-analysis/src/agents/wave-controller.ts"
  - "docker/docker-compose.yml (bind-mount km-core into container)"
tech-stack:
  added:
    - "@fwornle/km-core (peer dependency via Docker bind mount until Plan 7 cleanup)"
  patterns:
    - "Strangler-pattern feature flag (D-51a) — KM_CORE_PERSISTENCE=km-core flips the switch; legacy default preserved"
    - "Dynamic import (await import('@fwornle/km-core')) gated behind getPersistenceBackend() === 'km-core' — legacy runs do not load km-core"
    - "node:test + node:assert/strict (matches project's existing test pattern)"
key-files:
  created:
    - path: "integrations/mcp-server-semantic-analysis/src/config/persistence-flag.ts"
      purpose: "D-51a feature flag — strict literal env-var match"
    - path: "integrations/mcp-server-semantic-analysis/src/storage/km-core-adapter.ts"
      purpose: "Strangler adapter — hot-path surface against km-core GraphKMStore"
    - path: "integrations/mcp-server-semantic-analysis/src/storage/km-core-adapter.test.ts"
      purpose: "10 unit tests (5 Task 1 + 3 Task 2 bypass + 2 mergeAttributes behavior)"
  modified:
    - path: "integrations/mcp-server-semantic-analysis/src/agents/wave-controller.ts"
      change: "import km-core-adapter + persistence-flag, add kmCoreAdapter field, bootstrap in initialize() when flag is on, flag-gate the bypass mergeAttributes call (Phase 10 fix anchor)"
    - path: "docker/docker-compose.yml"
      change: "bind-mount ${HOME}/Agentic/km-core → /coding/node_modules/@fwornle/km-core (read-only) so dynamic import resolves in the container"
decisions:
  - "D-51a literal env-var match: only KM_CORE_PERSISTENCE='km-core' (strict equality) flips the switch — any other value, typo, or wrong casing falls back to 'legacy'. Defensive default."
  - "Adapter resolves entity names via store.iterate() scan, not store.findByName (km-core 0.1.0 has no findByName surface). O(n) is acceptable for B's <1000-entity hot-path bypass loop; Plan 5+ can add a name index if profiling warrants."
  - "storeEntity translates B's SharedMemoryEntity → canonical Entity per D-54 with the embedding/role/enrichedContext riding on metadata until Plan 5 teaches consumers to read them from top-level Entity (Phase 39 schema extension D-52 lands in Plan 6)."
  - "Bootstrap is in WaveController.initialize() (not the constructor) because the GraphKMStore.open() call is async and the constructor must stay sync. Bootstrap failure is non-fatal: falls back to legacy and logs a warning."
  - "km-core injected into Docker via bind-mount (not package.json dependency) — matches the project's existing strangler pattern of bind-mounting semantic-analysis/dist; avoids a permanent dependency change that would have to be reverted in Phase 42's final cleanup plan."
metrics:
  duration: "16m"
  completed: "2026-05-23T12:04:51Z"
  tasks: 3
  files_new: 3
  files_modified: 2
  test_delta: "+10 tests"
  docker_rebuild_duration: "418s (~7min)"
  container_restart_duration: "18s"
---

# Phase 42 Plan 01: km-Core Strangler Adapter Summary

JWT auth? No — this plan lands the **strangler-pattern km-core adapter** that replaces B's broken bypass-write path (Phase 10 bug — `wave-controller.ts:1373` calling `graphDB.mergeAttributes` whose pre-existing implementation silently dropped the embedding write somewhere in its multi-layer call chain), gated behind `KM_CORE_PERSISTENCE=km-core`. The km-core path delegates to `GraphKMStore.mergeAttributes` at km-core line 854, which calls Graphology's `mergeNodeAttributes` directly with no 7-layer pipeline to swallow the field.

## What Was Built

### Three new files (~430 LoC) plus two edits

| File | LoC | Purpose |
|------|-----|---------|
| `src/config/persistence-flag.ts` | ~25 | `getPersistenceBackend(): 'legacy' \| 'km-core'` — strict env-var literal match |
| `src/storage/km-core-adapter.ts` | ~310 | `createKmCoreAdapter({ store, team })` factory + 6 hot-path methods + 3 cold-path NotImplementedError stubs |
| `src/storage/km-core-adapter.test.ts` | ~345 | 10 tests (Tests 1–5 Task 1, Tests 6–8 Task 2, 2 bonus mergeAttributes behavior tests) |
| `src/agents/wave-controller.ts` | edit | Added import + private `kmCoreAdapter?: KmCoreAdapter` field + bootstrap in `initialize()` + flag-gated branch at line ~1417 |
| `docker/docker-compose.yml` | edit | Read-only bind mount: `${HOME}/Agentic/km-core → /coding/node_modules/@fwornle/km-core` |

### Wave-controller line ranges touched

| Range | Change |
|-------|--------|
| Lines 22–24 | New imports for `createKmCoreAdapter`, `KmCoreAdapter`, `getPersistenceBackend` |
| Lines 87–91 | New private field `kmCoreAdapter?: KmCoreAdapter` (with JSDoc) |
| Lines 484–518 | New bootstrap block inside `initialize()`'s `try` block, immediately after `await this.graphDB.initialize()`. Constructs `GraphKMStore` via dynamic import gated behind the flag; bootstrap failure falls back to legacy. |
| Lines 1411–1428 | Bypass-write call site (originally line 1373) — added flag-gated branch: `if (this.kmCoreAdapter) await this.kmCoreAdapter.mergeAttributes(...); else await this.graphDB.mergeAttributes(...);` Surrounding logging + counters preserved verbatim. |

### Hot-path surface implemented (RESEARCH §3 caller heat map)

| Method | Callers in src/ | Adapter behavior |
|--------|-----------------|------------------|
| `mergeAttributes(nodeId, attrs)` | wave-controller (Phase 10 anchor) | Resolves `${team}:${name}` via `iterate()` scan → calls `store.mergeAttributes(id, attrs)` (km-core line 854) |
| `queryEntities(options)` | 13 | Fast path via `findByOntologyClass` when only class filter set; otherwise iterate + filter |
| `storeEntity(entity, opts)` | 6 | D-54 translation (SharedMemoryEntity → canonical Entity), `putEntity` mints EntityId |
| `storeRelationship(from, to, type)` | 4 | Name→Entity resolution + `store.addRelation` |
| `getEntity(name, team)` | 4 | `iterate()` scan by name |
| `deleteEntity(name, team, opts)` | 6 | `store.batch([{ type: 'deleteEntity', id }])` |

### Cold-path stubs (zero callers in src/)

`queryRelations`, `queryByOntologyClass`, `findRelated` — all three throw `NotImplementedError: km-core-adapter.<method> — no callers in src/, fill in when needed`. Verified by Test 5.

## Test Count Delta

- **Before:** 3 test files in `dist/` (`workflow-state-machine.test.js`, `workflow-sse-broadcaster.test.js`, `utils/comparison-util.test.js`)
- **After:** 4 test files. New: `dist/storage/km-core-adapter.test.js` with 10 tests across 4 describe blocks.
- **Regressions:** Zero. All 3 pre-existing test files still pass.

## Commits

| Hash | Task | Subject |
|------|------|---------|
| `be3d124` (submodule) | T1+T2 RED | test(42-01): add failing tests for km-core strangler adapter + persistence-flag |
| `5f76eae` (submodule) | T1 GREEN | feat(42-01): land km-core strangler adapter + persistence-flag (Task 1) |
| `b7015af` (submodule) | T2 GREEN | feat(42-01): rewire wave-controller bypass write through km-core adapter (Task 2) |
| `2f0caa9b8` (superproject) | T3 | feat(42-01): wire km-core into Docker + bump submodule (Task 3) |

## Docker Rebuild Durations

- `npm run build` (submodule): ~3s (clean, no errors)
- `docker-compose build coding-services`: **418s (~7min)** — full image rebuild
- `docker-compose up -d coding-services`: 18s (container recreate after bind-mount edit)

## Verification Results

All Task acceptance criteria pass:

**Task 1:**
- `grep -c "from '@fwornle/km-core" src/storage/km-core-adapter.ts` → **1** (≥1 required)
- `grep -c "process.env.KM_CORE_PERSISTENCE" src/config/persistence-flag.ts` → **1** (≥1)
- `grep -v '^//' src/storage/km-core-adapter.ts | grep -c 'mergeAttributes'` → **9** (≥2)
- 5 unit tests pass (Tests 1–5).
- Cold-path methods throw `NotImplementedError: km-core-adapter.<method>` (verified by Test 5).

**Task 2:**
- `grep -v '^[[:space:]]*//' src/agents/wave-controller.ts | grep -c 'kmCoreAdapter\.mergeAttributes'` → **1** (≥1)
- `grep -v '^[[:space:]]*//' src/agents/wave-controller.ts | grep -c 'this\.graphDB\.mergeAttributes'` → **1** (legacy branch preserved)
- 3 new wave-controller bypass tests pass (Tests 6–8).
- No pre-existing wave-controller test suite → no regression surface; all other dist tests still green.

**Task 3:**
- `cd integrations/mcp-server-semantic-analysis && npm run build` → **exit 0**
- `cd docker && docker-compose build coding-services` → **exit 0**
- `docker exec coding-services grep -c 'kmCoreAdapter' /coding/integrations/mcp-server-semantic-analysis/dist/agents/wave-controller.js` → **6** (≥1)
- `docker exec coding-services node -e "import('@fwornle/km-core').then(m => process.exit(m.GraphKMStore ? 0 : 1))"` → **exit 0** (km-core resolves via root barrel inside the container).

## Confirmation: KM_CORE_PERSISTENCE=legacy is the safe default

The flag is **off by default**. Verified:

1. `persistence-flag.ts:23` — `getPersistenceBackend()` returns `'legacy'` when `KM_CORE_PERSISTENCE` is unset, empty, or any value other than the literal string `'km-core'` (Tests 1 + 3).
2. `wave-controller.ts:493` — the km-core bootstrap block is guarded by `if (getPersistenceBackend() === 'km-core')`; when the flag is off, the dynamic `import('@fwornle/km-core')` never runs and `this.kmCoreAdapter` stays `undefined`.
3. `wave-controller.ts:1424` — the bypass branch reads `if (this.kmCoreAdapter)`. Undefined ⇒ the legacy `await this.graphDB.mergeAttributes(nodeId, enrichedAttrs)` call runs exactly as it did before this plan landed.
4. Container restart with no env var set: the dynamic import never fires; km-core is bind-mounted but unused by the legacy path.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — auto-add critical functionality] Docker bind-mount for km-core**
- **Found during:** Task 3 verification (acceptance criterion #4: `import('@fwornle/km-core')` inside the container).
- **Issue:** The semantic-analysis Docker image was built without `@fwornle/km-core` in its `node_modules`. The host project links km-core via a symlink in `/Users/Q284340/Agentic/coding/node_modules`, which does NOT propagate into the container. Without intervention, the dynamic `import('@fwornle/km-core')` inside `wave-controller.initialize()` would throw `ERR_MODULE_NOT_FOUND` when the flag is on — breaking Plan 2+ which depend on this resolution.
- **Fix:** Added a read-only bind mount in `docker/docker-compose.yml`: `${HOME}/Agentic/km-core:/coding/node_modules/@fwornle/km-core:ro`. This substitutes for the host symlink inside the container. Removed in Phase 42's final cleanup plan along with the rest of the strangler scaffolding.
- **Why Rule 2 (not Rule 4):** The plan's acceptance criterion #4 explicitly requires km-core to resolve inside the container ("the next plans depend on this"). The fix is mechanical (a single bind-mount line); no architectural change is needed.
- **Files modified:** `docker/docker-compose.yml`
- **Commit:** `2f0caa9b8`

**2. [Plan-text discrepancy — documented, not fixed] km-core `/store` sub-path not exported**
- **Found during:** Task 3 AC verification.
- **Issue:** The plan's acceptance criterion #4 wrote `import('@fwornle/km-core/store')` (with `/store` sub-path). km-core 0.1.0's `package.json` `exports` map exposes only `.`, `./adapters/online`, `./dedup`, `./maintenance`, `./ontology`, `./pipeline` — not `./store`. `GraphKMStore` is re-exported from the root barrel.
- **Fix:** Used `import('@fwornle/km-core')` (root barrel) in both the wave-controller source and the verify command. Functionally equivalent — `GraphKMStore` resolves from the root barrel. The plan text is a minor inaccuracy; the intent of the AC ("verify km-core resolves inside the container") is satisfied.
- **Action item:** No code change needed. Plan 2+ should use the root barrel as well, OR a future km-core minor version could add `./store` to its exports map if downstream consumers want sub-path granularity.

### Authentication Gates

None.

## Threat Flags

No new security-relevant surface introduced beyond what the plan's `<threat_model>` declared.

## Known Stubs

None of the new code uses placeholder data sources. The cold-path stubs (`queryRelations`, `queryByOntologyClass`, `findRelated`) throw `NotImplementedError` explicitly — they are documented placeholders, not data stubs, and are visible from any caller via the thrown error.

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED  | `be3d124` test(42-01) | Build failed with TS2307 — module not found for `../config/persistence-flag.js` + `./km-core-adapter.js`. Tests cannot run because source files do not exist. |
| GREEN (Task 1) | `5f76eae` feat(42-01) | Source files land. Build clean. 5 Task-1 tests pass. |
| GREEN (Task 2) | `b7015af` feat(42-01) | Wave-controller rewire lands. Build clean. 3 Task-2 tests pass (Tests 6–8). |
| REFACTOR | none | No cleanup needed — code is already focused; no duplication introduced. |

## Phase 10 Verification (deferred)

Per the plan's `<success_criteria>` #5: "Phase 10 fix verification deferred to Plan 7's end-to-end `ukb full` SC#2 check; build-time wiring verified here."

This plan delivers the **wiring** that makes the Phase 10 fix possible — the broken `graphDB.mergeAttributes` call is now flag-gated and the km-core path delegates to a method that DEFINITELY exists in km-core (verified at `GraphKMStore.ts:854`). The end-to-end assertion ("every entity returned by `findByOntologyClass('Detail')` after a `ukb full` run has `embedding.length === 384`") runs in Plan 7 after wave-controller emit shapes have migrated and the data has been in-place-migrated (Plan 4/5/6 sequence).

## Self-Check: PASSED

**Created files exist:**
- `/Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis/src/config/persistence-flag.ts` — FOUND
- `/Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis/src/storage/km-core-adapter.ts` — FOUND
- `/Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis/src/storage/km-core-adapter.test.ts` — FOUND

**Commits exist:**
- `be3d124` (submodule) — FOUND in submodule `git log --all`
- `5f76eae` (submodule) — FOUND in submodule `git log --all`
- `b7015af` (submodule) — FOUND in submodule `git log --all`
- `2f0caa9b8` (superproject) — FOUND in superproject `git log` (HEAD)
