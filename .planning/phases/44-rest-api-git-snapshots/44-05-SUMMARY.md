---
phase: 44-rest-api-git-snapshots
plan: 05
subsystem: api
tags: [observation-view, adapter, typed-view, km-core, a-4, pure-functions, reshape, typescript, esm]

# Dependency graph
requires:
  - phase: 44-01
    provides: Wave 0 RED stub (tests/integration/observation-view.test.ts) — flipped to GREEN here
  - phase: 41
    provides: legacyId origin-system bridge ({system:'A'|'B'|'C', id:string}); src/adapters/online/mapper.ts (REVERSE-direction template)
  - phase: 39
    provides: Entity field shape (validFrom + top-level legacyId per CF-D37)
  - phase: 37
    provides: canonical Entity type from src/types/entity.ts (type-only import target)
provides:
  - "observationToLegacy(entity) — pure Entity → LegacyObservation reshape"
  - "digestToLegacy(entity) — pure Entity → LegacyDigest reshape"
  - "insightToLegacy(entity) — pure Entity → LegacyInsight reshape"
  - "LegacyObservation / LegacyDigest / LegacyInsight TypeScript interfaces (match scripts/observations-api-server.mjs SELECT projections)"
  - "legacyId.id-preferred-over-entity.id identity contract (preserves A-2 SQLite-rowid through the migration)"
  - "Uniform fallback semantics across all three reshape fns (summary→content→description; metadata.createdAt→entity.validFrom; metadata.{agent,project} default 'unknown'; quality default 'normal')"
affects: [44-06, 44-07, 44-08, 44-09, 45]

# Tech tracking
tech-stack:
  added: []  # zero new packages; type-only Entity import + Node stdlib only
  patterns:
    - "Reverse-direction reshape adapter — mirrors src/adapters/online/mapper.ts file layout (Phase 41 INT-01) but transforms Entity → legacy row instead of row → Entity"
    - "Type-only import of Entity (`import type { Entity } from '../types/entity.js'`) — erases at compile time, zero runtime coupling to entity.ts"
    - "Pure synchronous functions — no I/O, no await, no console.log; diagnostic emission lives in the caller (Plan 44-07 A obs-api handler)"
    - "legacyId.id-over-entity.id preference applied uniformly across all three reshapes (CF-D37 canonical placement; A-2 migration idempotency)"
    - "Type-guarded metadata reads via `typeof x === 'string'` / `Array.isArray()` — robust to the loose Record<string, unknown> shape of Entity.metadata"
    - "Snake_case keys on Legacy{Digest,Insight} interfaces — deliberate WIRE-shape preservation per Pitfall 2 (A's dashboard at :3032 is brittle to field-name drift)"

key-files:
  created:
    - "lib/km-core/src/adapters/observation-view.ts"
  modified: []  # package.json + src/index.ts deliberately untouched
decisions:
  - "Followed plan exactly: NOT exported from src/index.ts (Plan 44-06 owns the root barrel update mounting createKmCoreRouter alongside this re-export)"
  - "NO new package.json subpath export added — Plan 44-03 pre-added ./api / ./api/contracts / ./snapshots; observation-view will ship through the root barrel via Plan 44-06"
  - "Snake_case legacy field names (observation_ids, files_touched, digest_ids, last_updated) per plan frontmatter behavior — matches the SQLite column names directly; Pitfall 2 (Pitfall avoidance: A's dashboard reads exact field names)"
  - "Type-guard metadata reads with `typeof === 'string'` and `Array.isArray()` instead of `metadata.foo ?? default` — the looser nullish-coalesce would let non-string values (numbers, objects) leak into the legacy shape and break the dashboard renderer"
  - "Filename EXACTLY `observation-view.ts` per km-core no-evolutionary-names rule (no -v2 / -enhanced / -new variants)"
metrics:
  duration: ~3 min
  completed: 2026-06-03

---

# Phase 44 Plan 05: Observation-View Adapter (A-4 Typed-View Reshape) Summary

One-liner: Pure reverse-direction reshape primitives (`observationToLegacy` / `digestToLegacy` / `insightToLegacy`) land in km-core — A's obs-api server will consume these in Plan 44-07 to turn km-core entities back into the legacy SQLite row shapes A's dashboard at :3032 expects, completing the A-4 typed-view mandate from `44-CONTEXT.md`.

## What This Plan Delivered

**Single new file:** `lib/km-core/src/adapters/observation-view.ts` (223 lines).

- **Three exported pure functions** — `observationToLegacy(entity)`, `digestToLegacy(entity)`, `insightToLegacy(entity)`. Each consumes a km-core `Entity` (type-only import from `../types/entity.js`) and returns the corresponding legacy SQLite row shape. Zero I/O, zero `await`, zero `console.log`, zero side effects.
- **Three exported interfaces** — `LegacyObservation`, `LegacyDigest`, `LegacyInsight`. Field sets mirror the EXACT SELECT projections from `scripts/observations-api-server.mjs:466-549` (observations), `:630-687` (digests), `:705-751` (insights). Snake_case keys on digest/insight interfaces match A's pre-Phase-44 wire format (Pitfall 2: A's dashboard at :3032 is brittle to field-name drift).
- **Uniform legacyId precedence** — `entity.legacyId?.id ?? entity.id` applied across all three reshapes. Preserves A-2 SQLite-rowid identity through the migration (km-core entities created from `migrate-sqlite-to-kmcore.mjs` will surface back to A's dashboard under their original SQLite ids).
- **Type-guarded fallback chains** —
  - `content` (observation) = `metadata.summary` → `metadata.content` → `entity.description` → `''`
  - `summary` (digest/insight) = `metadata.summary` → `entity.description` → `''`
  - `artifacts` / `observation_ids` / `agents` / `files_touched` / `digest_ids` = array passthrough or `[]`
  - `timestamp` / `date` / `last_updated` = `metadata.{createdAt,date,last_updated}` → `entity.validFrom` → `''`
  - `agent` / `project` default `'unknown'`; `quality` defaults `'normal'`; `confidence` defaults `0`; `topic` falls back to `entity.name`.
- **Robust type guards** — metadata reads use `typeof === 'string'` and `Array.isArray()` instead of `??` so non-string / non-array values can't leak into the wire shape and crash the dashboard renderer.

## Test Result

```
PASS  tests/integration/observation-view.test.ts
  observationToLegacy — entity → LegacyObservation
    ✓ maps a fully populated entity with legacyId preference
    ✓ falls back: summary absent → content; content absent → entity.description
    ✓ when legacyId absent, uses entity.id
  digestToLegacy + insightToLegacy — analogous reshape
    ✓ digestToLegacy reshape smoke
    ✓ insightToLegacy reshape smoke

Test Files  1 passed (1)
     Tests  5 passed (5)
```

(The plan frontmatter mentioned "4 test blocks"; the test file has 5 `test()` blocks across the two `describe()` suites. All 5 GREEN.)

## Wave 0 km-core Test Status After This Plan

| Test file | Status | Owning plan |
|---|---|---|
| `tests/unit/contracts.test.ts` | GREEN (6/6) | Plan 44-03 (Zod contracts) |
| `tests/integration/observation-view.test.ts` | **GREEN (5/5) — flipped this plan** | Plan 44-05 (this plan) |
| `tests/integration/api-router.test.ts` | RED (6/6 fail) | Plan 44-06 (createKmCoreRouter — pending) |
| `tests/integration/snapshot-roundtrip.test.ts` | RED (import fail) | Plan 44-04 (SnapshotManager — pending in Wave 1) |

## Wave 1 km-core Deliverables Status

This plan completes the third Wave 1 km-core leaf:

| Wave 1 plan | km-core deliverable | Status |
|---|---|---|
| 44-03 | Zod contracts + `./api/contracts` subpath export | DONE (committed `d0bca0d` / `ecb4edb`) |
| 44-04 | `SnapshotManager` git-backed snapshot/restore + `./snapshots` subpath | pending (not in this wave's execution slice) |
| 44-05 | **`observation-view` adapter** | **DONE (this plan)** |

Plan 44-06 (`createKmCoreRouter` factory + root-barrel updates) will then bundle Plans 03/04/05 deliverables under a single mountable Express router and re-export `observationToLegacy` / `digestToLegacy` / `insightToLegacy` from the root barrel for A's obs-api server (Plan 44-07) to import as `from '@fwornle/km-core'`.

## Confirmation: Root Barrel Export Deferred to Plan 06

Per plan instructions, `src/index.ts` was **not** modified in this plan:

```bash
$ cd lib/km-core && grep -n "observation-view" src/index.ts
(no match — as expected)
```

Plan 44-06 owns the root barrel update (44-PATTERNS.md §`lib/km-core/src/index.ts` lines 542-567). A's obs-api server (Plan 44-07) will import via:

```typescript
import { observationToLegacy, digestToLegacy, insightToLegacy } from '@fwornle/km-core';
```

once Plan 44-06 re-exports them through the root barrel.

## Confirmation: No New Subpath Exports Added

Per plan instructions, `package.json` was **not** modified:

```bash
$ cd lib/km-core && git diff package.json
(empty)
```

Plan 44-03 pre-added `./api`, `./api/contracts`, and `./snapshots` subpath exports. The `observation-view` adapter intentionally ships through the root barrel (via Plan 44-06), NOT under a new `./adapters/observation-view` subpath — minimizing the surface for the cross-system contract.

## Build & Acceptance Verification

| Acceptance criterion | Result |
|---|---|
| `test -f lib/km-core/src/adapters/observation-view.ts` | PASS |
| `wc -l` >= 100 | PASS (223 lines) |
| `grep -c "export function observationToLegacy"` == 1 | PASS |
| `grep -c "export function digestToLegacy"` == 1 | PASS |
| `grep -c "export function insightToLegacy"` == 1 | PASS |
| `grep -c "export interface LegacyObservation"` == 1 | PASS |
| `grep -c "export interface LegacyDigest"` == 1 | PASS |
| `grep -c "export interface LegacyInsight"` == 1 | PASS |
| `grep -c "import type { Entity }"` == 1 | PASS |
| `grep -cE "console\.(log|error|warn|info|debug)"` == 0 | PASS |
| `grep -cE "\bawait\b"` == 0 | PASS |
| `npm run build` zero TS errors | PASS (clean tsc) |
| Single observation-view file (no -v2 / -enhanced variants) | PASS (`find` → 1) |
| Plan 44-01 observation-view.test.ts: GREEN | PASS (5/5) |

## Deviations from Plan

None — plan executed exactly as written. Zero Rule 1/2/3 auto-fixes triggered.

The plan listed "4 test blocks" but the test file actually contains 5 `test()` calls (3 in the `observationToLegacy` `describe` + 2 in the digest/insight `describe`). All 5 pass. This is a documentation count nit in the plan; no functional deviation.

## Commits

- **Submodule (lib/km-core):** `12cdfd2` — `feat(44-05): observation-view adapter — Entity → legacy reshape (A-4)` (1 file changed, 223 insertions)
- **Outer (coding):** `154c31d74` — `feat(44-05): bump km-core to 12cdfd2 (observation-view A-4 adapter)` (submodule pointer bump)

## Self-Check: PASSED

- **File exists:** `lib/km-core/src/adapters/observation-view.ts` — FOUND
- **Submodule commit 12cdfd2:** `git -C lib/km-core log --oneline | grep 12cdfd2` — FOUND
- **Outer commit 154c31d74:** `git log --oneline | grep 154c31d74` — FOUND
- **Target test GREEN:** observation-view.test.ts 5/5 passed — VERIFIED
- **Build clean:** `npm run build` zero TS errors — VERIFIED
- **package.json untouched:** `git diff package.json` empty — VERIFIED
- **src/index.ts untouched:** no `observation-view` grep hit — VERIFIED

---

*Phase: 44-rest-api-git-snapshots, Plan: 05 (Wave 1 km-core, A-4 typed-view adapter)*
*Completed: 2026-06-03*
