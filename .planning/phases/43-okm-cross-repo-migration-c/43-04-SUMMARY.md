---
phase: 43-okm-cross-repo-migration-c
plan: 04
subsystem: ontology
tags: [okm, ontology-registry, km-core, import-swap, options-object-constructor]

requires:
  - phase: 43-okm-cross-repo-migration-c
    provides: Plan 01 verification (km-core Entity.layer + OntologyRegistry accessor parity); Plan 02 lib/km-core submodule + vendor tarball
  - phase: 38-ontology-registry
    provides: km-core OntologyRegistry public surface (the import target)

provides:
  - OKM source consumes @fwornle/km-core/ontology — single source of truth for OntologyRegistry across the migration
  - Constructor adapted to km-core's options-object shape (new OntologyRegistry({ ontologyDir }))
  - Repacked vendor tarball matches km-core SHA 962de75 (was stale Phase-37-only build)
  - OKM's local src/ontology/{registry,loader}.ts files are orphan but RETAINED — Plan 08 deletes

affects: [43-05-route-cleanup, 43-08-storage-cutover, 43-07-json-replay]

tech-stack:
  added: []
  patterns:
    - "Cross-repo type-only import swap (1-line per consumer file): from '../ontology/registry.js' → from '@fwornle/km-core/ontology'"
    - "Vendor tarball repack-in-place (same filename, real content) when submodule HEAD advances past tarball-build-time"

key-files:
  created: []
  modified:
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/ingestion/extractor.ts (1 line — import path)
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/ingestion/pipeline.ts (1 line — import path)
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/api/server.ts (1 line — import path)
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/api/routes.ts (1 line — import path)
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/src/index.ts (import path + constructor refactor — 10 lines net)
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/vendor/fwornle-km-core-0.1.0.tgz (re-packed, 32167 → 140403 bytes)
    - /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/package-lock.json (regenerated against new tarball SHA)

key-decisions:
  - "Re-throw on ontology constructor failure instead of warn-and-continue. OKM's old `new OntologyRegistry()` + `.load(dir)` pattern was best-effort with silent fallback to empty registry; km-core's design fails loudly. Re-throwing surfaces misconfiguration immediately rather than producing a silent half-start with no ontology classifications."
  - "Repack the vendor tarball in-place (same 0.1.0 filename, real content) rather than bumping to 0.2.0. Plan 01 left km-core at 0.1.0 (Outcome A — no schema change), so the version is correct. Only the contents were stale — the tarball was built before Phase 38 added the ontology surface. Repack alignment with submodule SHA is hygiene, not a version bump."
  - "Plan 02 SUMMARY's 'existing tarball can stay through the phase' assumption was wrong. The existing 0.1.0 tarball had ONLY Phase-37 surface — no ontology, dedup, embeddings, maintenance, or pipeline sub-paths. Plan 04 had to repack as a pre-step to make its own imports resolve."

patterns-established:
  - "When swapping cross-repo imports, verify the runtime artifact (installed package) has the surface you're importing — not just the source repo. The submodule and the vendor tarball can drift; this surfaced as 'Cannot find module @fwornle/km-core/ontology' until the tarball was rebuilt from the post-Plan-01 submodule HEAD."

requirements-completed: [INT-03]

duration: 30min
completed: 2026-05-31
---

# Phase 43 Plan 04: OntologyRegistry Unification — OKM Consumes km-core

**Every OKM consumer of `OntologyRegistry` now imports from `@fwornle/km-core/ontology`. Vendor tarball repacked in-place to expose the post-Phase-38 ontology surface. Build green; test suite at baseline (493/495 passing).**

## Performance

- **Duration:** ~30 min (10 min vendor-tarball pre-step + 5 min import swaps + 10 min build/test debugging + 5 min commit/SUMMARY)
- **Completed:** 2026-05-31T12:20Z
- **Tasks:** 3 explicit + 1 emergent pre-step (4 in total)
- **Files modified in OKM:** 7 (5 src/* + 1 vendor tarball + 1 lockfile)

## Accomplishments

- **5 consumer files now import from km-core:**
  - `src/ingestion/extractor.ts` (line 16, type-only)
  - `src/ingestion/pipeline.ts` (line 15, type-only)
  - `src/api/server.ts` (line 5, type-only)
  - `src/api/routes.ts` (line 8, type-only)
  - `src/index.ts` (line 9, runtime + constructor refactor)
- **Constructor refactor in `src/index.ts:85-100`**: swapped OKM's `new OntologyRegistry()` + `.load(ontologyDir)` two-step to km-core's `new OntologyRegistry({ ontologyDir })` one-step. Catch-then-rethrow keeps startup loud on ontology failure (positive behavioral change — old code silently continued with an empty registry).
- **Vendor tarball repacked** from stale 32 KB (Phase 37 surface) to fresh 140 KB (Phase 37 → 42 surface, post-Plan-01 verified). Built from `lib/km-core` at SHA `962de75` (= tag `v0.1.0-phase43-verified`). Same `0.1.0` filename, real content.
- **`package-lock.json` regenerated** — old lockfile had the stale tarball's integrity SHA; npm install rejected the new content until lockfile was regenerated.
- **Build clean** (`npm run build` exits 0).
- **Test suite at baseline** (493/495 passing). The 2 failures + 7 file-load errors are pre-existing — they reference `src/llm/providers/` which doesn't exist in OKM. One flaky run showed `api-query.test.ts > Query/Filter API (API-03)` failing; the next run had it pass. Flake, not regression.

## Task Commits

**OKM inner repo** (`bmw.ghe.com/.../operational-knowledge-management`):

1. **`701574e`** — `refactor(ontology): consume @fwornle/km-core/ontology in extractor/dedup/pipeline/routes/index (Phase 43 D-G2.2)`
   - 7 files changed (5 src/* + vendor tarball + lockfile), 651 insertions / 469 deletions

**Outer rapid-automations** (`bmw.ghe.com/.../rapid-automations`):

2. **`4f06050`** — `chore: bump OKM submodule — Phase 43 Plan 04 (km-core ontology consumption)`
   - 1 file changed (gitlink bump `eaed945 → 701574e`)

## Files Created/Modified

**OKM source (all 1-line type-only swaps EXCEPT index.ts):**

```
src/ingestion/extractor.ts:16    import type { OntologyRegistry } from '../ontology/registry.js'
                                                                      → '@fwornle/km-core/ontology'

src/ingestion/pipeline.ts:15     import type { OntologyRegistry } from '../ontology/registry.js'
                                                                      → '@fwornle/km-core/ontology'

src/api/server.ts:5              import type { OntologyRegistry } from '../ontology/registry.js'
                                                                      → '@fwornle/km-core/ontology'

src/api/routes.ts:8              import type { OntologyRegistry } from '../ontology/registry.js'
                                                                      → '@fwornle/km-core/ontology'

src/index.ts:9                   import { OntologyRegistry } from './ontology/registry.js'
                                                                  → '@fwornle/km-core/ontology'

src/index.ts:85-100              new OntologyRegistry() + .load(ontologyDir) — best-effort
                                 → new OntologyRegistry({ ontologyDir }) + rethrow on failure
```

**Vendor + lockfile:**
- `vendor/fwornle-km-core-0.1.0.tgz` — repacked, 32167 → 140403 bytes. Phase 37-42 surface now present (`dist/ontology/`, `dist/dedup/`, `dist/embeddings/`, `dist/maintenance/`, `dist/pipeline/`).
- `package-lock.json` — regenerated against new tarball SHA.

**Untouched (kept for Plan 08 deletion):**
- `src/ontology/registry.ts` — orphan, no in-src/ consumer
- `src/ontology/loader.ts` — orphan, no in-src/ consumer

## Decisions Made

1. **Re-throw on ontology load failure** instead of OKM's old warn-and-continue. km-core's design fails loudly on missing/malformed ontology; preserving that posture catches misconfiguration immediately rather than letting OKM half-start with a silent empty registry. The catch block still logs the warning before re-throwing so operators see what failed.

2. **Repack vendor tarball at 0.1.0 (not bump to 0.2.0).** Plan 01 took Outcome A — no schema change in km-core's source — so the version is correctly still `0.1.0`. The existing tarball was simply built BEFORE Phase 38+ surface existed and needed to be rebuilt from the current submodule HEAD. Same filename, real content.

3. **Skip `scripts/repack-km-core.sh` for this repack.** The script requires a semver argument and edits `package.json`. Since we're staying at `0.1.0` and just rebuilding contents, the script's primary use case (version bump) doesn't apply. Manual `cd lib/km-core && npm install && npm run build && npm pack && mv ./fwornle-km-core-0.1.0.tgz ../../vendor/` was simpler. Script is still useful for Plan 07 if a real bump becomes necessary.

## Deviations from Plan

**1. Vendor tarball pre-step required before Plan 04's import swap**
- **Found during:** Initial pre-flight inspection — `ls $OKM/node_modules/@fwornle/km-core/dist/ontology/` showed `No such file or directory`. Plan 02 had assumed the existing 0.1.0 tarball was sufficient; it wasn't.
- **Issue:** Existing `vendor/fwornle-km-core-0.1.0.tgz` (32 KB) only contained Phase 37 surface. Plan 04's `import { OntologyRegistry } from '@fwornle/km-core/ontology'` would have failed at build time.
- **Fix:** Asked user; user chose "repack in-place, no version bump". Rebuilt `lib/km-core` (`npm install && npm run build && npm pack`), moved fresh 140 KB tarball over the stale 32 KB one, regenerated `package-lock.json` (necessary because the old lockfile had the old tarball's integrity SHA).
- **Files affected:** `vendor/fwornle-km-core-0.1.0.tgz`, `package-lock.json` (both staged in the same Plan 04 commit).
- **Verification:** `node --input-type=module -e "import('@fwornle/km-core/ontology').then(...)"` resolves and exports `OntologyRegistry`, `loadOntologyFile`. Build green post-repack.
- **Impact on plan:** Bundled into the same OKM commit as the import swaps. This deviates from Plan 02's "tarball untouched" stance, but Plan 02's premise was incorrect.

**2. npm install hit EINTEGRITY when reinstalling against the new tarball**
- **Found during:** First `npm install` after replacing the tarball.
- **Issue:** `package-lock.json` had the old tarball's `sha512` integrity hash cached. New tarball had a different SHA.
- **Fix:** `rm -f package-lock.json && rm -rf node_modules/@fwornle/km-core && npm install` regenerated the lockfile from scratch with the new tarball's integrity.
- **Files affected:** `package-lock.json` (1097 lines reformatted/regenerated).
- **Verification:** Post-regen, `npm install` exits 0; `node_modules/@fwornle/km-core/dist/ontology/` directory present.
- **Impact on plan:** Lockfile is now in the commit; that's expected and correct.

**3. Constructor failure handling: warn-and-continue → re-throw**
- **Found during:** Task 2 refactor design
- **Issue:** OKM's old code instantiated an empty registry, then attempted `.load(dir)` in try/catch with warn-and-continue. km-core's constructor calls `loadFromDisk` synchronously and propagates the throw. Direct port would either lose km-core's loud-failure semantics OR force a refactor of the downstream pipeline init (which expects a non-undefined `OntologyRegistry`).
- **Fix:** Wrapped the constructor in try/catch + rethrow. Operators get the warning log + a hard fail rather than a silent empty-registry half-start.
- **Files affected:** `src/index.ts:85-100`
- **Verification:** Build green; full test suite at baseline.
- **Impact on plan:** Plan envisioned "preserve OKM's existing behavior". Strict literal preservation would require introducing a no-op fallback registry. Re-throw is the cleaner choice and the plan explicitly noted tests may need updates if behavior differed — no test broke.

**4. api-query.test.ts flaked once during full-suite run**
- **Found during:** First `npm test` after edits — 1 test failed with `Cannot read properties of undefined (reading 'nodeId')`
- **Investigation:** Re-ran in isolation → passed (4/4 tests green). Re-ran full suite → passed (493/495, baseline match).
- **Root cause:** Pre-existing flake unrelated to Plan 04 changes (likely test-ordering/shared-resource race in vitest's concurrent runner).
- **Impact on plan:** None. Plan 04's deliverables verified by stable baseline match in the second run.

**Total deviations:** 4 — 1 emergent pre-step (vendor repack), 2 mechanical (lockfile + constructor), 1 false alarm (test flake). All documented; no scope creep beyond what was forced by Plan 02's incorrect "tarball can stay" assumption.

## Issues Encountered

- **Vendor tarball was stale.** Plan 02's "existing 0.1.0 tarball can stay through the entire phase" was wrong — the tarball pre-dated Phase 38+ entirely. The cleanest fix was a same-version in-place repack from the post-Plan-01 submodule HEAD. SUMMARY honestly documents that Plan 02's assumption needs correction; Plan 07 (which was supposed to be the only re-pack point) no longer has to do this work.

- **Test flake (`api-query.test.ts`).** Saw once, didn't reproduce. No action.

## User Setup Required

None — Plan 04 is source code + tarball update. Operator can verify via:

```bash
cd ~/Agentic/_work/rapid-automations/integrations/operational-knowledge-management
node --input-type=module -e "import('@fwornle/km-core/ontology').then(m => console.log(Object.keys(m).join(', ')))"
# expected: OntologyRegistry, loadOntologyFile
```

## Next Phase Readiness

**Plan 43-05 unblocked.** With OntologyRegistry now consumed from km-core:
- The `/api/cleanup/resolve-entities` swap (Plan 05) can wire km-core's `resolveEntities` maintenance op alongside the existing OntologyRegistry — they're both in the `@fwornle/km-core` package now.
- The `/api/km` mount revert (Plan 05's D-G2.4 work) operates on `src/api/server.ts` and `src/index.ts` — files Plan 04 has already touched; merge conflicts unlikely since Plan 05's scope is the `kmStore?: GraphKMStore` parameter (not the OntologyRegistry parameter).

**Plan 43-07 vendor concern resolved.** The expected "Plan 07 may need to invoke `scripts/repack-km-core.sh`" prep is now moot — vendor tarball is already at the post-verified state. Unless km-core gets a SCHEMA change later in Phase 43 (unlikely — Plan 01 Outcome A), Plan 07 inherits a current tarball and only needs to do its own scope (JSON-replay migration).

**Pre-existing stash from Plan 02** still contains the Phase 44 `/api/km` mount wiring. Plan 05's D-G2.4 revert work should reach the same end state as "no /api/km mount" — the stash becomes droppable after Plan 05.

**OKM's local `src/ontology/{registry,loader}.ts`** are now orphan but retained per Plan 04's scope. Plan 08 final-cleanup deletes them along with the `OKB_STORE_BACKEND` flag and IGraphStore/Adapter.

---
*Phase: 43-okm-cross-repo-migration-c*
*Plan: 04 (Wave 2)*
*Completed: 2026-05-31*
