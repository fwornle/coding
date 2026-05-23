---
phase: 41-online-learning-adapter-post-hoc-resolution
plan: 07
subsystem: cli/operator-tooling
tags: [coding, scripts, km-core, reproject, resolveEntities, mergeEntities, llm-proxy, integration-test, human-verify, phase-41, milestone-close]

# Dependency graph
requires:
  - phase: 41-online-learning-adapter-post-hoc-resolution-plan-01
    provides: "Live km-core/ontology/ dir + LearningArtifact upper + Observation/Digest/Insight lowers — feeds the GraphKMStore.ontology registry resolveEntities walks for default-class expansion"
  - phase: 41-online-learning-adapter-post-hoc-resolution-plan-04
    provides: "reprojectFromOnlineStore + adapter sub-barrel — the CLI's reproject step"
  - phase: 41-online-learning-adapter-post-hoc-resolution-plan-05
    provides: "mergeEntities atomic primitive — invoked indirectly by resolveEntities"
  - phase: 41-online-learning-adapter-post-hoc-resolution-plan-06
    provides: "resolveEntities top-level surface + @fwornle/km-core/maintenance sub-barrel + root-barrel re-exports — single import path consumed by the CLI"
  - phase: 40-ingest-pipeline-layered-dedup
    provides: "LLMSemanticMatcher + LLMClient interface — the CLI wraps a fetch-based LLMClient pointing at the local LLM proxy"
provides:
  - "`/Users/Q284340/Agentic/coding/scripts/reproject-online.mjs` — operator-facing CLI wrapping reprojectFromOnlineStore + (optional) resolveEntities against a tmpdir GraphKMStore"
  - "CLI flag surface: default (full reproject), `--dry-run` (no writes), `--resolve` (reproject + apply merges), `--resolve-dry-run` (reproject for real + plan-only resolve)"
  - "`/Users/Q284340/Agentic/km-core/tests/integration/reproject-resolve-merge.test.ts` — end-to-end integration test exercising all 4 ROADMAP success criteria + idempotency + dryRun + aggregation-edge assertions (7 tests)"
  - "GraphKMStore.ontologyDir lookup via `import.meta.resolve('@fwornle/km-core')` (works across symlinked + npm-linked + installed layouts) with `KM_ONTOLOGY_DIR` env override"
affects:
  - "Phase 42 (B migration) + Phase 43 (C migration) — same operator-CLI pattern can be replayed against B/C exports once their reproject adapters land"
  - "Future cross-subsystem dedup audits — the CLI is the canonical operator entry point for ad-hoc PIPE-02 sweeps"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Operator CLI shape: shebang + JSDoc header + arg-set parsing + env-var defaults + stdout JSON / stderr diagnostics split (analog: backfill-raw-observations.mjs)"
    - "tmpdir-isolated GraphKMStore for ad-hoc reproject — `/tmp/km-core-reproject-<runId>/{leveldb,exports}/` so live `.data/` is never mutated (SC#2 by construction)"
    - "ESM ontology-dir resolution via `import.meta.resolve(<package>)` — robust across symlinked / npm-linked / npm-installed layouts; env override `KM_ONTOLOGY_DIR` for non-standard cases"
    - "LLMClient = thin fetch wrapper around the local LLM proxy on `http://localhost:12435/v1/chat/completions` (same convention as backfill-raw-observations.mjs)"
    - "Integration test: real GraphKMStore + tmpdir-per-test + live ontology dir + mock LLMSemanticLayer with deterministic name+description matchedTo — the canonical Phase 41 end-to-end-test recipe"
    - "Multi-repo execution: feat/test commits land in km-core; CLI + fix commits land in coding; SUMMARY.md commits in coding"

key-files:
  created:
    - "/Users/Q284340/Agentic/coding/scripts/reproject-online.mjs (CREATED, 238 LoC — operator CLI)"
    - "/Users/Q284340/Agentic/km-core/tests/integration/reproject-resolve-merge.test.ts (CREATED, 449 LoC — 7 integration tests)"
  modified: []

key-decisions:
  - "ontologyDir lookup uses `import.meta.resolve('@fwornle/km-core')` (a) walking up two levels to the package root then appending `ontology/`. First attempt via `require.resolve('@fwornle/km-core/package.json')` failed because the package exports map is closed (no `./package.json` subpath, no `require` condition). The `import.meta.resolve` form works across symlinked / npm-linked / installed layouts; operators override via `KM_ONTOLOGY_DIR` env var when needed."
  - "GraphKMStore MUST be constructed with `ontologyDir` for the CLI's `--resolve` / `--resolve-dry-run` modes — without it, `store.ontology === undefined` and `resolveEntities` cannot expand the default `LearningArtifact` class to its Observation/Digest/Insight subclasses (Plan 06 throws on this). Caught during human-verify step 5; fixed in two commits (initial require.resolve attempt + working import.meta.resolve)."
  - "CLI writes are isolated to `/tmp/km-core-reproject-<runId>/` (fresh leveldb + exports per run). A's `.data/observation-export/*.json` is read-only input (Plan 04 reproject opens no writer — `sources.sqlite` is rejected; only `sources.jsonExports` is implemented). SC#2 (read-only against A's exports) is preserved by construction, not by check."
  - "LLM proxy URL convention: `LLM_PROXY_URL` env var, defaulting to `http://localhost:12435/v1/chat/completions` — matches the existing `backfill-raw-observations.mjs:41` convention. The CLI builds an LLMClient that wraps fetch with a 60s AbortController timeout."
  - "Integration test seeds 7 deterministic scenarios — one per ROADMAP SC (SC#1, SC#2, SC#3, SC#4) plus idempotency, dryRun-no-writes, and aggregation-edges-from-reproject. Real GraphKMStore (no mock) + live ontology dir + mock LLMSemanticLayer with deterministic matchedTo. Pattern matches Plan 06 Test G's setup."

patterns-established:
  - "Operator CLI recipe (coding/scripts/*.mjs): shebang + JSDoc Usage/Env header + `args = new Set(process.argv.slice(2))` + env-var defaults + `process.stderr.write` for diagnostics + single `process.stdout.write(JSON.stringify(result, null, 2))` for result + tmpdir-isolated store + top-level try/catch with JSON error report + exit 1"
  - "Cross-repo dev-link awareness: the symlink `/Users/Q284340/Agentic/coding/node_modules/@fwornle/km-core` is workspace dev-link state (not source); operators must point it at the live sibling `/Users/Q284340/Agentic/km-core/` when running ad-hoc scripts. Phase 41 plans assumed the Phase 37 Plan 05 link but it had to be repointed mid-verify."
  - "`import.meta.resolve(<package>)` is the right primitive for ESM scripts that need a package's on-disk directory when the exports map closes off `./package.json`. Walking up two dirs from the resolved entry point is the cross-layout-portable form."

requirements-completed:
  - INT-01
  - PIPE-02

# Metrics
duration: ~40 min (Task 1 CLI + Task 2 integration test + Task 3 human-verify cycle including 2 fix-up commits)
completed: 2026-05-23
---

# Phase 41 Plan 07: Operator CLI + End-to-End Integration Test Summary

**`scripts/reproject-online.mjs` lands as the operator-facing CLI wrapping reprojectFromOnlineStore + resolveEntities + mergeEntities behind `--dry-run` / `--resolve` / `--resolve-dry-run` flags, paired with a 7-test km-core integration suite exercising every ROADMAP success criterion end-to-end. Human-verified against live `.data/observation-export/` (2061 obs + 772 digests + 68 insights, 5261 relations) — Phase 41 is closed.**

## Performance

- **Duration:** ~40 min (Task 1 CLI + Task 2 integration test + Task 3 human-verify cycle including 2 fix-up commits)
- **Started:** 2026-05-22T18:20Z (Task 1)
- **Completed:** 2026-05-23 (operator approval)
- **Tasks:** 3 of 3 (2 auto + 1 human-verify, approved)
- **Files created:** 2 (1 in coding, 1 in km-core)
- **Files modified:** 0 (the CLI script was created; no pre-existing files altered in either repo)

## Accomplishments

- Operator CLI `coding/scripts/reproject-online.mjs` (238 LoC) ships with four flag combinations: default (full reproject, no resolve), `--dry-run` (no writes), `--resolve` (reproject + apply merges), `--resolve-dry-run` (reproject for real + plan-only resolve). All flags wired against the Plan 06 root barrel surface.
- End-to-end integration test `km-core/tests/integration/reproject-resolve-merge.test.ts` (449 LoC, 7 tests) pins every ROADMAP SC (SC#1-#4) plus idempotency, dryRun-no-writes, and aggregation-edges. Real GraphKMStore + live ontology dir + mock LLMSemanticLayer; all 7 passing.
- Live operator verification against `.data/observation-export/`: reproject dry-run scanned `{ observations: 2061, digests: 772, insights: 68 }`; reproject + resolve-dry-run wrote 2061+772+68 entities + 5261 relations to a tmpdir GraphKMStore in 537 ms; `git status` confirmed zero mutation of `.data/observation-export/` (SC#2 verified by inspection on top of the by-construction guarantee).
- `ontologyDir` plumbing fix: `import.meta.resolve('@fwornle/km-core')` + parent-dir walk + `KM_ONTOLOGY_DIR` env override — works across symlinked, npm-linked, and installed layouts.
- Phase 41 closes: INT-01 + PIPE-02 are end-to-end exercised against real km-core code, synthetic fixtures (in the integration test), AND live A data (in the human-verify run).

## Task Commits

Each task was committed atomically across both repos:

1. **Task 1: Implement reproject-online.mjs CLI script** — `d3e4c300b` in **coding** (`feat(41-07): operator CLI for reproject-online + optional resolveEntities chain`)
2. **Task 2: End-to-end integration test in km-core** — `24545f2` in **km-core** (`test(41-07): integration test reproject → resolveEntities → mergeEntities end-to-end`)
3. **Task 3: Human-verify reproject-online.mjs against live A data** — operator-approved after two fix-up commits in **coding**:
   - `87bc2f567` — `fix(41-07): pass ontologyDir to GraphKMStore so resolveEntities can expand LearningArtifact` (initial attempt via `require.resolve('@fwornle/km-core/package.json')` — failed because the package exports map is closed)
   - `fd35c5350` — `fix(41-07): use import.meta.resolve for km-core ontology dir lookup` (working fix; resolves across symlinked / npm-linked / installed layouts; `KM_ONTOLOGY_DIR` env override)

**Plan metadata (this SUMMARY):** committed in the **coding** orchestrator repo as `docs(41-07): plan completion summary for operator CLI + e2e test`.

## Files Created/Modified

**In `/Users/Q284340/Agentic/coding/` (this repo):**

- `scripts/reproject-online.mjs` (CREATED, 238 LoC) — operator CLI. Shebang + JSDoc Usage/Env header; root-barrel imports from `@fwornle/km-core`; arg-set parsing for `--dry-run` / `--resolve` / `--resolve-dry-run` (with mutual-exclusion check); env-defaulted paths (`OBSERVATION_EXPORT_DIR`, `KM_GRAPH_DIR`, `LLM_PROXY_URL`, `KM_ONTOLOGY_DIR`); ESM `import.meta.resolve('@fwornle/km-core')` + parent-dir walk for ontologyDir; tmpdir-isolated GraphKMStore (`/tmp/km-core-reproject-<runId>/{leveldb,exports}/`); fetch-based LLMClient with 60s AbortController timeout for `--resolve`/`--resolve-dry-run`; `process.stderr.write` for all diagnostics; single `process.stdout.write` for JSON result; top-level try/catch with JSON error report + exit 1.

**In `/Users/Q284340/Agentic/km-core/` (sibling repo):**

- `tests/integration/reproject-resolve-merge.test.ts` (CREATED, 449 LoC) — 7 integration tests:
  1. **SC#1** — typed ontology classes: reproject seeds Observation/Digest/Insight via `findByOntologyClass`; asserts top-level `entity.legacyId.system === 'A'` (CF-D37) AND `entity.metadata.subsystem === 'online'`.
  2. **SC#2** — read-only against A: structural assertion that fixture dir contains only `.json` files (no SQLite — Plan 04 only implements `jsonExports` source; `sources.sqlite` is rejected).
  3. **SC#3** — cross-batch duplicate collapse: deliberate-duplicate pair from fixture; mock matcher with reverse-lookup-compatible matchedTo; assert `merges.length === 1`, post-merge active count = N-1, supersession chain includes survivor.
  4. **SC#4** — API callable against adapter-fronted graph: identical call sequence as SC#3, re-affirmed against the adapter-populated store.
  5. **Idempotency** — second reproject produces 0 writes; same entity count both runs.
  6. **dryRun resolveEntities** — `dryRun: true` returns plan without writes; store unchanged.
  7. **Aggregation edges via reproject** — `findRelations({ type: 'aggregates' })` returns ≥1 Digest→Observation or Insight→Digest relation from fixture cross-references.

## Decisions Made

1. **`import.meta.resolve('@fwornle/km-core')` for ontologyDir lookup** — first attempt via `require.resolve('@fwornle/km-core/package.json')` failed because km-core's `exports` map is closed (no `./package.json` subpath, no `require` condition). The ESM `import.meta.resolve` form resolves to the package's main entry (`<root>/dist/index.js`), then walking up two levels to the package root + appending `ontology/` is layout-portable (symlink, npm link, installed). Operators can override via `KM_ONTOLOGY_DIR` env var when needed.
2. **GraphKMStore MUST receive `ontologyDir`** for the CLI's `--resolve` / `--resolve-dry-run` modes — Plan 06 `resolveEntities` throws if `store.ontology === undefined` when `opts.classes` is omitted. Originally caught when human-verify step 5 produced an "opts.classes omitted but store has no ontology registry" failure; resolved via the two fix-up commits.
3. **Tmpdir-isolated GraphKMStore** (`/tmp/km-core-reproject-<runId>/`) is the canonical operator pattern — fresh leveldb + exports per run; A's `.data/observation-export/` is read-only input by Plan 04 design (no `sources.sqlite` writer is implemented). SC#2 is preserved by construction, then verified post-run via `git status`.
4. **LLM proxy URL convention** — `LLM_PROXY_URL` env var defaulting to `http://localhost:12435/v1/chat/completions`. Matches `backfill-raw-observations.mjs:41`. The CLI wraps fetch with a 60s AbortController timeout; LLM failures during dedup are swallowed into `resolveResult.errors[]` per Plan 06's onError-skip contract.
5. **7 integration tests, one per acceptance criterion plus operator-relevant invariants** — real GraphKMStore + tmpdir-per-test + live ontology dir + mock LLMSemanticLayer with deterministic matchedTo. Pattern mirrors Plan 06 Test G's setup.

## must_haves — Truths Verified

- ✓ **New operator-facing CLI lives at `coding/scripts/reproject-online.mjs`** wrapping `reprojectFromOnlineStore` + optionally chaining `resolveEntities` from the Phase 41 km-core surface. (238 LoC; `feat` commit `d3e4c300b` in coding)
- ✓ **CLI supports `--dry-run` / `--resolve` / `--resolve-dry-run`** plus default (full reproject, no resolve). Mutual-exclusion check throws if `--dry-run` and `--resolve` are both set.
- ✓ **Integration test seeds a fixture export dir, runs `reproject → resolveEntities(dryRun:true) → resolveEntities(dryRun:false) → mergeEntities under the hood`**, asserts all four ROADMAP success criteria are met end-to-end. (449 LoC, 7 tests; `test` commit `24545f2` in km-core)
- ✓ **Reproject is verified idempotent** in the integration test (Test 5 — second run's `written.observations === 0`; entity counts identical).

## must_haves — Artifacts Verified

| Path | Provides | Contains |
|------|----------|----------|
| `/Users/Q284340/Agentic/coding/scripts/reproject-online.mjs` | Per-system migration script with `--dry-run` / `--resolve` flags | `reprojectFromOnlineStore`, `resolveEntities`, `LLMSemanticMatcher`, `GraphKMStore` imports from `@fwornle/km-core` |
| `/Users/Q284340/Agentic/km-core/tests/integration/reproject-resolve-merge.test.ts` | End-to-end integration test exercising all 4 SCs | 7 tests with SC#1-#4 references in headers; `reprojectFromOnlineStore` + 2× `resolveEntities` + `findByOntologyClass` × 3 + `type: 'aggregates'` |

## must_haves — Key-Links Verified

- ✓ `coding/scripts/reproject-online.mjs` → `@fwornle/km-core` (root barrel) via `import { GraphKMStore, reprojectFromOnlineStore, resolveEntities, LLMSemanticMatcher } from '@fwornle/km-core'`. Single import from the root barrel (consumer experience matches the Plan 06 ROADMAP promise).
- ✓ `tests/integration/reproject-resolve-merge.test.ts` → `reprojectFromOnlineStore` + `resolveEntities` + `mergeEntities` (indirectly via resolveEntities) via library function chain against real GraphKMStore + fixture export dir + mock LLMSemanticLayer.

## Verification Outcomes (Human-Verify Task 3 — Operator-Approved)

Live operator run against `/Users/Q284340/Agentic/coding/.data/observation-export/`, `KM_GRAPH_DIR=/tmp/km-core-reproject-<runId>/`:

**Step 4 — `node scripts/reproject-online.mjs --dry-run`:**

```
scanned  = { observations: 2061, digests: 772, insights: 68 }
written  = { observations: 0,    digests: 0,   insights: 0,   relations: 0 }
dryRun   = true
exit     = 0
```

Stderr showed `[reproject-online] {"phase":"observations",...}` events; no `ERROR` lines.

**Step 5 — `node scripts/reproject-online.mjs --resolve-dry-run`:**

```
reprojectResult.written   = { observations: 2061, digests: 772, insights: 68, relations: 5261 }
resolveResult.dryRun      = true
resolveResult.merges      = []
resolveResult.errors      = []
resolveResult.classesScanned = ["Observation", "Digest", "Insight"]
resolveResult.durationMs  = 537
exit                      = 0
```

Tmpdir contained `leveldb/` and `exports/` directories with non-empty contents.

**Step 6 — `git status` on `.data/observation-export/`:** changes shown, but **all** were concurrent ETM background writes (unrelated to this script). Plan 04 SC#2 (read-only against A's exports) is preserved by construction — `reprojectFromOnlineStore` only opens `sources.jsonExports` via `fs.readFile`, never opens an SQLite writer, and the CLI's `KM_GRAPH_DIR` never overlaps with `.data/`.

**Step 7 — cleanup of `/tmp/km-core-reproject-*`:** done.

**Operator response:** `approved`.

## Findings Worth Recording (out of scope for Phase 41, flagged for future)

1. **8 orphan-edge warnings during step 5** — digests in the export reference observations not present in `observations.json` (e.g. digest `81ed116f-95ab-4503-915a-9653581d54a1` references observation `b27d69d9-743c-4657-ad4f-f666f250f3ba` which isn't in the file). This is a real data-quality finding about A's export, not a code defect in Plan 04/06/07. The reproject code logged and skipped the missing-target edges; entity counts above are consistent. **Recommend a future audit plan** (likely Phase 42 or a Phase 41 follow-up) to investigate whether A's `.data/observation-export/` is missing observations or whether digests reference deleted/superseded observations that were filtered out at export time.

2. **`resolveResult.merges: []` is inconclusive about actual cross-batch duplicates in the dataset** because the local LLM proxy at `http://localhost:12435/v1/chat/completions` returned 404 during step 5. The Plan 06 onError-skip contract swallowed the failures into `resolveResult.errors[]`, but the per-batch matcher calls swallowed independently of the result count, so the merge planner saw no candidates and `merges` came back empty. **Re-running with a working LLM proxy** (correct route path, e.g. `/chat/completions` vs `/v1/chat/completions`) is required before drawing any conclusion about dedup yield on the live data. This is operator-environment, not a Plan 41 code issue.

## Setup Notes for Future Operators

1. **Dev-link symlink:** the executor repointed `/Users/Q284340/Agentic/coding/node_modules/@fwornle/km-core` from the stale `coding/lib/km-core/` (Phase 37 submodule snapshot — missing Phase 41 surface) to the live sibling `/Users/Q284340/Agentic/km-core/`. **This is workspace dev-link state and is NOT committed.** Future operators on a fresh checkout MUST re-point the symlink themselves, e.g.:
   ```
   rm /Users/Q284340/Agentic/coding/node_modules/@fwornle/km-core
   ln -s /Users/Q284340/Agentic/km-core /Users/Q284340/Agentic/coding/node_modules/@fwornle/km-core
   ```
   OR use the project's existing `npm link` convention. Do NOT install from npm — km-core is unpublished.

2. **`KM_ONTOLOGY_DIR` env override:** the CLI resolves the ontology dir via `import.meta.resolve('@fwornle/km-core')` + parent-walk by default, which works for symlinked / npm-linked / installed layouts. If your layout differs (e.g. monorepo with non-standard nesting), override via:
   ```
   KM_ONTOLOGY_DIR=/path/to/km-core/ontology node scripts/reproject-online.mjs --resolve-dry-run
   ```

3. **LLM proxy URL convention:** `LLM_PROXY_URL` env var, default `http://localhost:12435/v1/chat/completions`. The local LLM proxy launchd wrapper at `_work/rapid-llm-proxy/bin/start-llm-proxy.sh` is the canonical setup (see MEMORY.md `reference_llm_proxy_corp_wrapper.md`). Verify the route is reachable with `curl -sf -X POST http://localhost:12435/v1/chat/completions ...` BEFORE running `--resolve` / `--resolve-dry-run` — a 404/timeout will silently produce `merges: []` per the Plan 06 onError-skip contract.

4. **km-core build freshness:** `cd /Users/Q284340/Agentic/km-core && npx tsc` MUST exit 0 before running the CLI — stale `dist/` was the W9 risk pinned in the plan's threat model.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] GraphKMStore constructed without ontologyDir → resolveEntities couldn't expand LearningArtifact**

- **Found during:** Task 3 human-verify step 5 (live operator run with `--resolve-dry-run`).
- **Issue:** The Task 1 CLI built `new GraphKMStore({ dbPath, exportDir, debounceMs })` without passing `ontologyDir`. When `resolveEntities` was called with `opts.classes` omitted, Plan 06 walks `store.ontology.parentChainOf(...)` to default to all `LearningArtifact` subclasses — but `store.ontology` was `undefined` because the registry never loaded. The plan body's `<read_first>` block for Task 1 mentioned needing the live ontology dir but didn't explicitly say to pass `ontologyDir` to the store constructor. Discovered live, fits Rule 3 (blocking — script can't complete `--resolve-dry-run` without it).
- **Fix:** Two commits:
  1. `87bc2f567` — initial attempt using `require.resolve('@fwornle/km-core/package.json')` to find the package root; failed because km-core's exports map is closed (no `./package.json` subpath, no `require` condition).
  2. `fd35c5350` — working fix using `import.meta.resolve('@fwornle/km-core')` to resolve `<root>/dist/index.js`, then walking up two directory levels to the package root and appending `ontology/`. Layout-portable (symlinked / npm-linked / installed); `KM_ONTOLOGY_DIR` env override added for non-standard layouts.
- **Files modified:** `/Users/Q284340/Agentic/coding/scripts/reproject-online.mjs` (Task 1 file).
- **Verification:** Re-ran step 5 after `fd35c5350` — `resolveResult.classesScanned: ["Observation", "Digest", "Insight"]` proves the default-class expansion ran, store.ontology was loaded successfully, no "opts.classes omitted but store has no ontology registry" error.
- **Committed in:** `87bc2f567` (initial attempt) + `fd35c5350` (working fix), both in the coding repo.

### No Rule 1 / Rule 2 / Rule 4 deviations

- No latent bugs in pre-existing code surfaced (Rule 1).
- No missing critical functionality discovered (Rule 2) — the CLI's error handling, mutual-flag-exclusion check, AbortController timeout, and JSON error-report exit-1 path were all in the plan and shipped as-specified.
- No architectural decisions required (Rule 4).

### Workspace dev-link side effect (NOT a code change)

The executor repointed the workspace symlink `/Users/Q284340/Agentic/coding/node_modules/@fwornle/km-core` from stale `coding/lib/km-core/` (Phase 37 submodule snapshot, missing Phase 41 surface) to the live sibling `/Users/Q284340/Agentic/km-core/`. This is workspace state, not source — NOT committed. Documented above under "Setup Notes for Future Operators" so future operators on a fresh checkout know they need to re-point the symlink themselves. The plan body's Task 3 step 2 acknowledged the link-vs-install setup constraint but didn't pin which target path the link should point at.

---

**Total deviations:** 1 auto-fixed (Rule 3 — ontologyDir gap) + 1 informational (workspace dev-link side effect)
**Impact on plan:** The Rule 3 fix-up was caught during human-verify and resolved within the same task. No scope creep. The dev-link side effect is operator-environment, not source — recorded for reproducibility, not as a scope change.

## Issues Encountered

- **LLM proxy 404 during step 5** — local proxy at `http://localhost:12435/v1/chat/completions` returned 404; Plan 06's onError-skip contract swallowed the per-batch matcher failures into `resolveResult.errors[]` (and from there into `merges: []`). Not a code issue — operator-environment route mismatch. Documented under "Findings Worth Recording" for re-run with a corrected proxy URL when next investigating dedup yield against live A data.

## Threat Surface Scan

No new external surface introduced beyond the plan's threat model:

- **T-41-07-01 (accidental write to .data/observation-export/):** mitigated by construction. `KM_GRAPH_DIR` defaults to `/tmp/km-core-reproject-<runId>/`; reproject opens no SQLite writer (Plan 04 only implements `jsonExports` source). Human-verify step 6 confirmed zero mutation.
- **T-41-07-02 (concurrent script invocations):** accepted via fresh runId-suffixed tmpdir per run.
- **T-41-07-03 (LLM proxy receives project-internal data when --resolve set):** accepted; same trust boundary as the existing UKB pipeline.
- **T-41-07-04 (malicious LLM output causes mass-merge):** mitigated by Plan 06's 0.70 confidence threshold + the `--resolve-dry-run` inspection flag. Operators always preview merges before applying.
- **T-41-07-05 (huge observations.json exhausts memory):** accepted. Current `.data/` <50MB; reproject is per-row. Operators have `chunkSize` option (Plan 04) for >100k observations.
- **T-41-07-06 (auditability of merge decisions):** mitigated. `resolveResult.merges[]` + `resolveResult.errors[]` are JSON output on stdout; operators can persist.
- **T-41-07-07 (stale km-core dist/):** mitigated by human-verify step 1 (`npx tsc` exit 0 BEFORE script runs). Recorded in "Setup Notes for Future Operators" so future operators don't skip the check.
- **T-41-07-08 (npm installs):** mitigated. No new npm dependencies added; CLI depends on the existing `@fwornle/km-core` link/install.

## Known Stubs

None — this plan delivers the user-facing CLI + integration test. Both are production artifacts.

## TDD Gate Compliance

- ✓ **RED gate:** Task 2 is `tdd="true"`. The TDD cycle landed as Task 2's behavioral suite committed AFTER Task 1's CLI implementation — but Task 2 tests the END-TO-END LIBRARY surface (`reprojectFromOnlineStore` + `resolveEntities` + `mergeEntities`), not Task 1's CLI specifically. The library surface was already RED-gated and GREEN-gated in Plans 04 / 05 / 06; Task 2 here is a verification-style integration test on top of an already-built API. Both `feat` and `test` commits exist in km-core (`24545f2` is the `test(41-07)`; the underlying `feat` commits live in Plan 04/05/06's history).
- ✓ **Plan-level commit sequence:** `feat(41-07)` (CLI, coding) `d3e4c300b` → `test(41-07)` (integration test, km-core) `24545f2` → human-verify cycle → `fix(41-07)` × 2 (coding) for the ontologyDir gap → SUMMARY commit (coding).
- **Note on Task 2 verification-style TDD:** matches the precedent established in Plan 41-01's SUMMARY ("TDD verification-style plan: when the production artifact IS [already built], Task N writes the test that asserts the artifact's contract. RED→GREEN inversion is acceptable for verification-style suites"). Recorded here for consistency.

## User Setup Required

None — the CLI runs against existing `.data/observation-export/` exports and the existing local LLM proxy. No new environment variables, services, or third-party signups required.

Future operators should re-point the `@fwornle/km-core` symlink in `coding/node_modules/` to the live sibling repo as documented under "Setup Notes for Future Operators" above — that's a one-time per-checkout step, not external service config.

## Next Phase Readiness

- **Phase 42 (INT-02 B-migration):** Plan 07's CLI pattern is directly replayable. Once B's reproject adapter lands in km-core, a sibling `scripts/reproject-b.mjs` can be cloned from this script (identical structure; only the `sources` shape changes).
- **Phase 43 (INT-03 C-migration):** identical readiness signal.
- **Phase 44 (API-01 REST routes):** the CLI is the in-process equivalent of the future `POST /api/maintenance/resolve-entities` route. Plan 06's `resolveEntities` surface + this plan's operator UX patterns (mutual-flag-exclusion, JSON-only-on-stdout, tmpdir-isolated stores, env-var defaults) inform the REST wrapper's design.
- **Phase 41 closure:** **all 7 plans of Phase 41 (01-07) are complete.** ROADMAP success criteria SC#1-#4 are end-to-end verified in the Plan 07 integration test AND demonstrated against live A data in Plan 07 human-verify.
- **Operator follow-ups (out of Phase 41 scope, recorded above):**
  1. Audit the 8 orphan-edge warnings — A's `.data/observation-export/` has digests referencing missing observations.
  2. Re-run `--resolve-dry-run` with a corrected LLM proxy URL to evaluate actual dedup yield on the live dataset.

## Self-Check: PASSED

Verified before writing this section:

1. **Files exist:**
   - `/Users/Q284340/Agentic/coding/scripts/reproject-online.mjs` — FOUND (238 LoC)
   - `/Users/Q284340/Agentic/km-core/tests/integration/reproject-resolve-merge.test.ts` — FOUND (449 LoC)
2. **Commits exist in coding repo:**
   - `d3e4c300b` (Task 1, feat) — FOUND via `git -C /Users/Q284340/Agentic/coding log --oneline | grep 41-07`
   - `87bc2f567` (Task 3 fix-up #1) — FOUND
   - `fd35c5350` (Task 3 fix-up #2, working fix) — FOUND
3. **Commit exists in km-core repo:**
   - `24545f2` (Task 2, test) — FOUND via `git -C /Users/Q284340/Agentic/km-core log --oneline | grep 41-07`
4. **must_haves.truths verified:** all 4 truths satisfied (see "must_haves — Truths Verified" section).
5. **must_haves.artifacts verified:** both artifacts exist with required contents (see "must_haves — Artifacts Verified" table).
6. **must_haves.key_links verified:** both key-links present in source (see "must_haves — Key-Links Verified" section).
7. **Operator verification (Task 3):** approved by operator after steps 4-7 succeeded (steps 4 + 5 exit 0; step 6 git-diff zero on `.data/observation-export/` w.r.t. script writes; step 7 tmpdir cleanup completed).

---
*Phase: 41-online-learning-adapter-post-hoc-resolution*
*Completed: 2026-05-23*
