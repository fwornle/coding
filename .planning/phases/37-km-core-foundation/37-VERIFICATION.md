---
phase: 37-km-core-foundation
verified: 2026-05-20T08:00:00Z
status: human_needed
score: 9/10
overrides_applied: 0
human_verification:
  - test: "Docker rebuild + container smoke for km-core"
    expected: "docker-compose build coding-services exits 0; container starts; lib/km-core/dist/index.js importable from inside container"
    why_human: "Deferred by design (approved-skip-docker per Plan 05). Docker builds take 3-5 min. Dockerfile/compose parse-clean but in-container classic-level native rebuild not exercised yet."
---

# Phase 37: km-core-foundation Verification Report

**Phase Goal:** Establish `@fwornle/km-core` as a standalone library with canonical types, UUIDv7-stamped entity IDs, and a GraphKMStore that is a true parity store for both B's `coding.json` and C's per-domain exports; wire it into the `coding/` repo as a git submodule with BC symlink migration and Docker scaffolding.
**Verified:** 2026-05-20T08:00:00Z
**Status:** human_needed (9/10 automated checks VERIFIED; 1 item awaits human Docker test)
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `npm install && npm run build` exits 0; `dist/index.js` exists with documented public surface | VERIFIED | Build ran cleanly; `dist/index.js` and `dist/index.d.ts` present with all exported symbols |
| 2 | All 6 test files GREEN, 33/33 tests pass; `bash tests/integration/symlink-bc.sh` exits 0 | VERIFIED | `npm test` output: "6 passed (6) / 33 passed (33)" — confirmed live |
| 3 | Cross-repo TS import smoke: `tsc --noEmit` with `coding/.data/.km-core-smoke-verify.ts` exits 0 | VERIFIED | Probe ran and exited 0; `node_modules/@fwornle/km-core` symlink resolves to `../../lib/km-core` |
| 4 | CORE-02 round-trip parity — 4 frozen fixtures pass byte-equal canonical round-trip via `restore()` | VERIFIED | `round-trip.test.ts` GREEN; normalize step documented and scoped to orphan-edge fixture quirks |
| 5 | CORE-03 UUIDv7 enforcement — `mintEntityId()` returns v7-shaped; `parseEntityId` rejects non-v7; plain `putEntity` path strict | VERIFIED | ids.test.ts 5/5 GREEN; `parseEntityId` uses `UUID.parse + charAt(14) === '7'` check; graph-store test "invalid id throws SyntaxError" GREEN |
| 6 | SC#4 OKB-baseline-guard — KB-only commit ALLOW (exit 0); mixed commit BLOCK (exit 1) | VERIFIED | Plan 05 Step 2a + 2b evidence confirmed; live hook (`/coding/.git/hooks/pre-commit`) implements correct smart rule |
| 7 | Symlink BC migration — `.data/knowledge-export/coding.json` is a symlink to `../exports/coding.json`; both readable | VERIFIED | `lrwxr-xr-x ... coding.json -> ../exports/coding.json`; canonical file 1,175,889 bytes; `symlink-bc.sh` passes |
| 8 | Submodule mount — `.gitmodules` has km-core entry; `lib/km-core/` checked out at `7dfcec8`; `dist/` populated | VERIFIED | `.gitmodules` has `[submodule "lib/km-core"]`; `git submodule status` shows `7dfcec823dc...`; `dist/index.js` present |
| 9 | Docker Dockerfile + compose wiring in place (3 RUN lines + 1 bind-mount); parse-clean | VERIFIED | `grep -c lib/km-core Dockerfile.coding-services` = 3; bind-mount line present; `docker-compose config` exits 0 |
| 10 | Docker rebuild executed + container smoke | HUMAN NEEDED | Deferred per `approved-skip-docker` in Plan 05. In-container execution not yet verified. |

**Score:** 9/10 truths verified (1 awaits human Docker test)

---

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | rapid-automations/ half of CORE-01 cross-repo import | Phase 43 | Plan 05 SUMMARY §"This closes the cross-repo half of CORE-01"; REQUIREMENTS Out-of-Scope for Phase 37; Phase 43 owns INT-03 |

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `km-core/dist/index.js` | Compiled public barrel | VERIFIED | 736 bytes; exports GraphKMStore, mintEntityId, parseEntityId, noopOntologyValidator + type re-exports |
| `km-core/dist/index.d.ts` | Type declarations | VERIFIED | All 5 CORE-01 types present (Entity, Relation, Layer, EntityId, SerializedGraph) + event/store types |
| `km-core/src/store/GraphKMStore.ts` | 455-line composition class | VERIFIED | 520 lines; putEntity/getEntity/deleteEntity/findByOntologyClass/addRelation/findRelations/batch/iterate/exportJson/mergeAttributes/restore/open/close all present |
| `km-core/src/ids/mint.ts` | `mintEntityId()` UUIDv7 factory | VERIFIED | Present; wraps uuidv7 package |
| `km-core/src/ids/parse.ts` | `parseEntityId()` with v7 check | VERIFIED | Present; `UUID.parse + charAt(14) === '7'` defensive variant check |
| `km-core/src/ids/branded.ts` | Branded `EntityId` type | VERIFIED | Present; `string & { readonly __brand: 'EntityId' }` |
| `km-core/src/types/entity.ts` | Entity/Relation/Layer + 5 provenance subtypes | VERIFIED | Confirmed via Plan 02 OKM verbatim preservation audit |
| `km-core/src/store/persistence.ts` | PersistenceManager 317 lines | VERIFIED | 12,463 bytes; hydrate/persistGraph/exportJson/close present |
| `km-core/src/store/exporter.ts` | Exporter 228 lines | VERIFIED | 8,869 bytes; scheduleExport/flush/exportJson present |
| `coding/.gitmodules` | km-core submodule entry | VERIFIED | `[submodule "lib/km-core"]` block present |
| `coding/lib/km-core/dist/index.js` | Submodule dist populated | VERIFIED | 736 bytes; host-side build artifact present |
| `coding/.data/exports/coding.json` | Canonical 1.18 MB file | VERIFIED | 1,175,889 bytes |
| `coding/.data/knowledge-export/coding.json` | Symlink to `../exports/coding.json` | VERIFIED | `lrwxr-xr-x` mode 120000 |
| `coding/scripts/migrate-exports-to-symlinks.mjs` | Idempotent migration script | VERIFIED | 105 lines, executable |
| `coding/docker/Dockerfile.coding-services` | 3 km-core RUN lines | VERIFIED | install + rebuild + build; `grep -c` = 3 |
| `coding/docker/docker-compose.yml` | km-core dist bind-mount | VERIFIED | `lib/km-core/dist:/coding/lib/km-core/dist:ro` |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/index.ts` | `GraphKMStore`, `mintEntityId`, `parseEntityId`, type exports | barrel re-exports | VERIFIED | All symbols present in `dist/index.d.ts` |
| `GraphKMStore` | `PersistenceManager` | `new PersistenceManager(...)` in constructor | VERIFIED | Import at line 67; composed in constructor |
| `GraphKMStore` | `Exporter` | `new Exporter(...)` in constructor | VERIFIED | Import at line 68; composed in constructor |
| `GraphKMStore` | EventEmitter | `extends EventEmitter` | VERIFIED | `emit('entity:put')`, `emit('entity:delete')`, `emit('relation:added')`, `emit('relation:removed')` present |
| `GraphKMStore.putEntity` | `parseEntityId` | strict path | VERIFIED | `parseEntityId(e.id)` called when `!trusted` and id present |
| `GraphKMStore.putEntity` | `mintEntityId` | stamp path | VERIFIED | `mintEntityId()` called when no id supplied |
| `lib/km-core` submodule | km-core remote | `.gitmodules` url + SHA | VERIFIED | URL `git@github.com:fwornle/km-core.git`; pinned at `7dfcec823dc8f8a71697d8dc76d9743f4f929832` |
| `coding/.git/hooks/pre-commit` | `.data/(knowledge-export|exports)/*.json` | KB_PATTERN grep | VERIFIED | Live hook: KB-only allows, mixed blocks. Pattern identical to file-based hook. |

---

### Data-Flow Trace (Level 4)

Phase 37 delivers a library and infrastructure (no UI rendering). Level 4 data-flow trace is not applicable — no JSX/TSX components render dynamic data.

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Build exits 0 | `cd ~/Agentic/km-core && npm run build` | "tsc" — exit 0 | PASS |
| 33 tests green | `cd ~/Agentic/km-core && npm test` | "6 passed (6) / 33 passed (33)" | PASS |
| Shell symlink test green | `bash tests/integration/symlink-bc.sh` | "PASS: KB_PATTERN matches 2 staged path(s)" — exit 0 | PASS |
| Cross-repo tsc smoke | `tsc --noEmit` on probe file in coding/.data/ | exit 0 (no diagnostics) | PASS |
| docker-compose parse-clean | `docker-compose -f docker/docker-compose.yml config` | exit 0 | PASS |
| Zero live console.* in src | `grep -rE 'console\.(log|...)' km-core/src/` | 0 live code hits (3 in comments only) | PASS |
| Symlink mode | `ls -la .data/knowledge-export/coding.json` | `lrwxr-xr-x ... -> ../exports/coding.json` | PASS |

---

### Probe Execution

No `scripts/*/tests/probe-*.sh` probes were declared for Phase 37. The `tests/integration/symlink-bc.sh` probe was run directly above.

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| `km-core/tests/integration/symlink-bc.sh` | `bash tests/integration/symlink-bc.sh` | exit 0 / "PASS: KB_PATTERN matches 2 staged path(s)" | PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| CORE-01 | Plans 02, 05 | Canonical type surface exported (Entity, Relation, Layer, EntityId, SerializedGraph) | VERIFIED | dist/index.d.ts exports all 5 types; cross-repo tsc smoke exit 0 |
| CORE-02 | Plans 03, 04 | GraphKMStore is parity store for B + C; 4 fixtures round-trip byte-equal | VERIFIED | round-trip.test.ts 4/4 GREEN; normalize step scoped to fixture-quirks |
| CORE-03 | Plans 02, 04 | UUIDv7-stamped branded EntityId on every write | VERIFIED | ids.test.ts 5/5; graph-store "invalid id throws SyntaxError" GREEN; 100-ID k-sort test GREEN |
| SC#4 | Plan 05 | .data/knowledge-export/coding.json + .data/exports/*.json load via KM-Core without breaking OKB-guard hygiene | VERIFIED | Symlink in place; live hook tested 2a (allow) + 2b (block) |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/store/persistence.ts` | 20, 21, 195 | `console.info` mention | INFO | In code COMMENTS only (documenting the OKM delta). No live `console.*` call. Not a violation. |
| `src/store/exporter.ts` | 31 | `console.*` mention | INFO | In comment only (`NO console.* — use process.stderr.write`). Not a violation. |

No TBD, FIXME, XXX markers found in km-core source or coding-repo files modified by Phase 37.

---

### Human Verification Required

#### 1. Docker Rebuild + Container Smoke

**Test:** Run `cd /Users/Q284340/Agentic/coding/docker && docker-compose build coding-services && docker-compose up -d coding-services`, then exec into the container and verify `node -e "require('/coding/lib/km-core/dist/index.js')"` exits 0.
**Expected:** Build succeeds (including `RUN cd lib/km-core && npm run build`); container starts; `dist/index.js` importable. `npm rebuild classic-level` inside container completes without error.
**Why human:** Docker builds take 3-5 minutes; requires a live Docker daemon; `approved-skip-docker` was declared in Plan 05 for exactly this reason. The Dockerfile and compose config are parse-clean and structurally correct, but the native binding rebuild (`npm rebuild classic-level`) and in-container ESM import path have not been exercised end-to-end.

---

### Boundary Cases (Not Failures — Call-outs)

**BC-1: `restore()` is a new public API method not in the original PLAN.md.**

`restore(serialized: SerializedGraph): Promise<void>` was added in Plan 04 Deviation #1 (Rule 2 — missing critical functionality). It is tested: `round-trip.test.ts` calls `store.restore(...)` for all 4 fixtures. However it is **NOT documented in `README.md`**. The README's "Public API" section lists `GraphKMStore` but does not enumerate `restore()` or describe the trusted-bulk-import pattern.

Recommended follow-up for Phase 38+: Add `restore()` to the README's API reference and document the trusted-caller semantics (no validation, no events, no debounced export — caller follows with `await store.exportJson()` if flush needed).

**BC-2: `skipOntologyCheck: true` also bypasses `parseEntityId` — widened trusted-caller boundary.**

Plan 04 Deviation #2 extended `skipOntologyCheck` from "bypass ontology validation" to "bypass both ontology validation AND parseEntityId AND default-stamping". The SUMMARY documents the rationale clearly (fixture replay + Phase 39 backfill of legacy layer-prefixed keys need non-v7 ids verbatim). The threat model (T-37-02, prototype-pollution defense) is NOT violated because:
- `GraphKMStore` is the prototype-pollution boundary at the `Exporter`/`PersistenceManager` write paths
- `restore()` (not `putEntity(skipOntologyCheck: true)`) is the primary bulk-import API; `restore()` uses `graph.addNode` directly and is clearly flagged in source comments as "no validation"
- The threat model note in `GraphKMStore.ts` (lines 50-54) documents the trusted-caller semantics

Risk that remains: `putEntity({ ..., id: <untrusted-non-v7> }, { skipOntologyCheck: true })` bypasses the parseEntityId firewall. This is intentional for fixture replay but could be misused. The `restore()` method is the safer API for bulk import. Recommended follow-up: add a lint rule or code comment warning that `skipOntologyCheck: true` must only be used in migration / fixture-replay contexts.

**BC-3: `scripts/hooks/pre-commit-okb-guard.sh` (56-line file) is stale vs. the live hook (48-line `/.git/hooks/pre-commit`).**

The key difference:
- **File-based hook** (stale): always exits 1 whenever any KB file is staged, regardless of whether non-KB files are also staged. This would BLOCK KB-only commits.
- **Live hook** (correct): KB-only commits ALLOWED (exit 0); mixed (KB + other) BLOCKED (exit 1).

Both hooks share the **same `KB_PATTERN` value**, so `tests/integration/symlink-bc.sh` (which reads `KB_PATTERN` from the file-based hook) correctly tests pattern matching. But the actual commit behavior tested in Plan 05 Step 2 exercised the LIVE hook, not the file. The file-based hook is documented as stale in Plan 05 Deviation #1.

Impact on Phase 37: **NOT a blocker.** The live hook is correct and was end-to-end verified. The stale file is a documentation-drift artifact.

Recommended follow-up for Phase 38+ (not blocking): Sync `scripts/hooks/pre-commit-okb-guard.sh` with the live hook. Consider adding a CI step that validates `scripts/hooks/pre-commit-okb-guard.sh` matches `.git/hooks/pre-commit` (or make the `.git/hooks/pre-commit` a symlink to the script).

---

### Gaps Summary

No hard FAIL items were found. All 9 automatically-verifiable must-haves are VERIFIED. The single outstanding item (Docker rebuild) is deferred by design with explicit `approved-skip-docker` documentation in Plan 05 and will be exercised in Phase 42 when B's persistence-agent is wired to GraphKMStore.

---

## Verification Summary

**Phase 37 goal is substantively achieved.** The km-core library is feature-complete:

- `@fwornle/km-core` v0.1 is a standalone, built, tested TypeScript library with a clean public surface
- All 33 tests pass (6 test files including 4 frozen-fixture round-trip parity tests)
- The coding/ submodule mount, BC symlink migration, and Docker scaffolding are in place
- The OKB-baseline-guard hook continues to function correctly under the new `.data/exports/` path layout

The `human_needed` status is set only because the Docker rebuild + container smoke was deferred by design. Once the human Docker test passes, Phase 37 can be closed as complete.

---

_Verified: 2026-05-20T08:00:00Z_
_Verifier: Claude (gsd-verifier)_
