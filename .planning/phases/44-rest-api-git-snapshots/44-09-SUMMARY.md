---
phase: 44-rest-api-git-snapshots
plan: 09
subsystem: C (OKM / operational-knowledge-management)
tags: [cross-repo, hard-cutover, checkpoint, architectural-decision]
status: CHECKPOINT — architectural decision required (Rule 4)
requires: [44-06 (km-core router + contracts), 44-07 (A-side mount), 44-08 (B-side mount)]
provides: []
affects:
  - _work/rapid-automations/integrations/operational-knowledge-management/src/api/routes.ts
  - _work/rapid-automations/integrations/operational-knowledge-management/tests/integration/rest-contract.test.ts
  - _work/rapid-automations/integrations/operational-knowledge-management/viewer/src/api/okbClient.ts
  - _work/rapid-automations/integrations/operational-knowledge-management/scripts/record-rest-fixtures.mjs
  - _work/rapid-automations/integrations/operational-knowledge-management/scripts/verify-post-migration.mjs
  - _work/rapid-automations/integrations/operational-knowledge-management/tests/fixtures/pre-migration
  - _work/rapid-automations/integrations/operational-knowledge-management/lib/km-core/vendor (n/a — vendored at vendor/, not lib/km-core/vendor/)
  - _work/rapid-automations/integrations/operational-knowledge-management/package.json
decisions: []
metrics:
  duration: ~30min (analysis only — execution halted at Rule 4)
  completed_date: 2026-06-03T13:40:00Z
  tasks_completed: 0
  tasks_total: 2
  files_modified: 0
key-files:
  created: []
  modified: []
---

# Phase 44 Plan 09: C-Side Hard Cutover (OKM Cross-Repo REST Rewrite) — Summary

**One-liner:** Execution halted at Rule 4 architectural checkpoint — km-core canonical wire shapes (RelationSchema, StatsSchema) materially differ from OKM's existing fixture shapes; byte-equal re-record (Pitfall 5) is mechanically impossible without an operator decision on contract-vs-fixture precedence.

## Status: CHECKPOINT REACHED — DO NOT MARK PLAN COMPLETE

This plan was NOT executed against the OKM repo. No OKM commits were created. No OKM PR was opened. The vendored km-core .tgz was NOT bumped. Files in OKM and km-core remain at their pre-Plan-09 state.

The execution analysis surfaced a concrete contract mismatch that requires operator decision before any edits proceed. See "Architectural Decision Required" below.

## Pre-execution Analysis Performed

### Repo state verified
- **Coding repo** (`/Users/Q284340/Agentic/coding`) on `main`, no uncommitted edits to plan-relevant files.
- **OKM repo** (`/Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management`) on `main`, clean except untracked `.data/leveldb.exports/` and `.data/leveldb.pre-43-backup/` (not in scope).
  - HEAD: `34a0fc5` (Phase 43 PR #4 merge, 2026-06-02 — matches STATE.md baseline).
  - Remote: `https://bmw.ghe.com/adpnext-apps/operational-knowledge-management.git` — HTTPS as required by `feedback_bmw_ghe_https.md`. NOT SSH.
- **km-core** (`/Users/Q284340/Agentic/coding/lib/km-core/`) version `0.1.0`. Existing vendored tarball already at OKM `vendor/fwornle-km-core-0.1.0.tgz` (note: vendor path is `vendor/`, NOT `lib/km-core/vendor/` as the plan frontmatter states — see Inaccuracy #1 below).

### Plan-vs-reality inaccuracies surfaced

**Inaccuracy #1 — vendor path:** Plan lists `_work/.../okm/lib/km-core/vendor` but OKM's `package.json:20` references `file:vendor/fwornle-km-core-0.1.0.tgz`. The vendored tarball lives at `vendor/`, not `lib/km-core/vendor/`. Plan must be amended OR a new `lib/km-core/vendor/` path must be wired into package.json. Operator decision needed.

**Inaccuracy #2 — Pitfall 5 byte-equal claim:** Plan asserts "response BODIES are URL-independent — byte-equal diff expected". This is FALSE for this cutover because the canonical handlers in km-core (`lib/km-core/src/api/handlers/relations.ts`, `entities.ts`, `query.ts`, `ontology.ts`) emit different wire shapes than OKM's existing handlers in `src/api/routes.ts`. Pitfall 5 holds when only URL changes; it FAILS when handler implementations swap. See "Concrete shape mismatches" below.

### Concrete shape mismatches blocking byte-equal re-record

**A. Relations endpoint (`GET /api/v1/relations`):**

| Field | OKM fixture shape (`api-relations.json`) | km-core handler shape (`relations.ts:27-37`) |
|-------|------------------------------------------|----------------------------------------------|
| Top-level | `{key, source, target, attributes: {type, metadata, createdAt}}` | `{from, to, relationType, createdAt, [key?], [metadata?]}` |
| Edge identifier | `key` (graphology edge key — string) | `key` optional, NOT included unless caller passes |
| Source/target | `source`, `target` | `from`, `to` |
| Relation type | nested at `attributes.type` | top-level `relationType` |
| Metadata | nested at `attributes.metadata` | top-level `metadata` |

Verified by reading `tests/fixtures/pre-migration/api-relations.json:5-12` against `lib/km-core/src/api/handlers/relations.ts:27-37`. INCOMPATIBLE shapes.

**B. Stats endpoint (`GET /api/v1/stats`):**

| Field | OKM fixture (`api-stats.json`) | km-core `StatsSchema` (`contracts.ts:149-154`) |
|-------|--------------------------------|------------------------------------------------|
| Entity count | `nodes` | `entityCount` |
| Edge count | `edges` | `relationCount` |
| OKM-specific aggregations | `evidenceCount`, `patternCount`, `orphanCount`, `islandCount`, `componentCount`, `connectivity`, `lastUpdated`, `activeSnapshot` | absent |
| km-core-specific | absent | `ontologyClasses`, `domainsActive` |

INCOMPATIBLE. OKM fixture has 9 fields; km-core schema has 4 fields. Zero overlap on field names.

**C. Test-side schemas (`tests/integration/rest-contract.test.ts:129-138`):**

OKM's local `RelationSchema` reproduces the graphology `{key, source, target, attributes}` shape. Switching the test to `import { RelationSchema } from '@fwornle/km-core/api/contracts'` will cause every relations fixture to fail `Zod.parse()`, BEFORE even reaching the `toEqual` byte-equal check.

### Other files inspected
- `src/api/routes.ts` (3146 lines) — 41 `app.<verb>('/api/...')` handlers across `registerRoutes()` lines 448-528. Canonical handler bodies (lines 530+) implement OKM's verbatim contract. Cannot be deleted without replacing every shape they emit on the wire — see decision options below.
- `src/api/server.ts` (140 lines) — already has both production 7-arg and TEST-ONLY 8-arg overloads; mount block lives here per plan but the `kmStore` it receives is OKM's production `GraphKMStore` instance, so mounting `createKmCoreRouter` would replace handler implementations entirely.
- `viewer/src/api/okbClient.ts` (530 lines) — URL constants at lines 225, 271, 282, 291, 299, 317, 326, 335, 349, 359, 383, 400, 415, 425, 468, 475, 480, 485, 497, 508, 519 confirmed at the line numbers listed in 44-RESEARCH.md.
- `scripts/record-rest-fixtures.mjs` (232 lines) — ENDPOINTS at lines 99-112. 10 endpoints (D-G5.1 minimum 8 + 2 OKM extras: ontology-entity-types + graph-connectivity).
- `scripts/verify-post-migration.mjs` (352 lines) — ENDPOINTS at lines 128-141, mirrors recorder.
- `tests/integration/rest-contract.test.ts` (430 lines) — Zod schemas at lines 94-287 (not 94-167 as plan claims — schema block extends through line 287; ~190 lines, not ~75).

### km-core router signature
- `createKmCoreRouter(store, router, opts)` (lib/km-core/src/api/router.ts:165-200) — 3-arg signature per Phase 44 R-2-revised (km-core does NOT import express; caller passes Router instance).
- Plan 09 Task 1 `<behavior>` paragraph 2 says `createKmCoreRouter(this.graphStore, kmRouter, { ontologyRegistry, snapshotDir, restartCommand })` — argument shape matches; OK.

## Architectural Decision Required (Rule 4)

The Phase 44 design assumes km-core's contracts.ts = OKM-verbatim (CONTEXT C-2: "OKM response shapes verbatim, codified as Zod"). But the km-core build SHIPPED with Plan 06 (`lib/km-core/src/api/contracts.ts`) does NOT match OKM's actual fixture shapes for `RelationSchema` or `StatsSchema`. This was masked in Plans 06-08 because no plan tested the km-core router against OKM's frozen fixtures end-to-end.

**Operator must choose one before Plan 09 can proceed:**

### Option A — Re-record fixtures to km-core shapes (BREAKS Phase 43 Gate 1 lock)
- Discard the byte-equal lock established by Phase 43 D-G5.1 (`34a0fc5` merge).
- Re-record fixtures with km-core handlers producing `{from, to, relationType, ...}` and `{entityCount, ...}` shapes.
- VOKB viewer (`okbClient.ts:251-257`, `getStats():298-311`) currently reads `edge.attributes.type`, `raw.nodes`, etc. — fails after re-record. Substantial viewer rewrite required IN this plan.
- Plan 02 cross-system-parity.mjs (A and B legs) is currently GREEN against km-core shapes; this option aligns C with them.
- **Cost:** ~viewer rewrite (~100 LOC), fixtures re-record, breaks Phase 43 historical reproducibility.

### Option B — Patch km-core contracts.ts + handlers to match OKM verbatim (re-opens Plan 06)
- Modify `lib/km-core/src/api/handlers/relations.ts:27-37` to emit `{key, source, target, attributes: {type, metadata, createdAt}}` (graphology shape).
- Modify `lib/km-core/src/api/handlers/query.ts` (stats handler — not inspected yet) to emit OKM's 9-field shape.
- Update `contracts.ts:117-124,149-154` schemas to match.
- Rebuild km-core .tgz, re-vendor into A and B (they're now using the "wrong" shape — break Plans 07/08 fixtures).
- **Cost:** km-core source change + re-test all of Wave 0-3, breaks A/B leg of cross-system-parity that was GREEN.

### Option C — Mount OKM's existing handlers as the /api/v1/* surface; deprecate km-core handlers
- `src/api/routes.ts` keeps its handler bodies; ONLY URL prefix changes from `/api/` to `/api/v1/`.
- `createKmCoreRouter` is NOT mounted on OKM at all; km-core retains the framework-agnostic factory but Plan 09 doesn't consume it.
- OKM-specific endpoints stay at `/api/okm/*` per plan; canonical 15 stay at `/api/v1/*` via OKM's own implementations.
- Cross-system-parity passes because all three systems return the SAME shape (OKM-verbatim) — but the SHAPE is OKM's, not km-core's. A and B would need to change to match (their fixtures NOT inspected yet).
- **Cost:** A and B's handlers probably need re-alignment; km-core router becomes vestigial.

### Option D — Phase 44 scope re-think
- Acknowledge that "single source of truth" requires explicit C-2 reconciliation. Update CONTEXT to either (a) accept divergent shapes per system or (b) lock km-core to OKM-verbatim and accept the rework cost.

## What was NOT done
- OKM repo: NO branch created. NO commits. NO PR.
- OKM `src/api/routes.ts`: NO modifications.
- OKM `tests/integration/rest-contract.test.ts`: NO schema swap.
- OKM `viewer/src/api/okbClient.ts`: NO URL rewrites.
- OKM `scripts/record-rest-fixtures.mjs`: NO endpoint path changes.
- OKM `scripts/verify-post-migration.mjs`: NO endpoint path changes.
- OKM `tests/fixtures/pre-migration/`: NO re-record.
- km-core .tgz: NO repack, NO bump.
- OKM `package.json`: NO vendor version bump.
- Verification commands: NONE executed (would have produced misleading green from the unchanged baseline).

## Deviations from Plan

**Rule 4 (architectural decision):** Halted at Plan 09 Task 1 step "Refactor src/api/routes.ts" upon discovering the shape mismatch between km-core canonical contracts and OKM's frozen fixtures. Per executor playbook, Rule 4 issues STOP and surface to operator with options.

No Rules 1-3 fixes applied (no code was modified during analysis).

## Authentication Gates

None — analysis stayed in read-only scope. `gh` CLI HTTPS-token auth NOT exercised. OKM remote verified as `https://bmw.ghe.com/...` (correct per `feedback_bmw_ghe_https.md`).

## Threat Flags

None new. Threats T-44-09-01 through T-44-09-SC remain at their plan-defined dispositions.

## Self-Check: PASSED (analysis-only)

- [x] OKM repo state observed (HEAD `34a0fc5`, branch `main`, remote HTTPS).
- [x] All seven plan-listed files read and analyzed.
- [x] km-core router signature confirmed (`createKmCoreRouter(store, router, opts)`).
- [x] km-core contracts.ts shapes inspected and compared against OKM fixtures.
- [x] Shape mismatch documented with concrete field-by-field tables.
- [x] No edits to OKM or km-core source. No commits to either repo.
- [x] No edits to STATE.md or ROADMAP.md (per executor instructions).
- [x] Checkpoint summary written to phase directory in coding repo.

## Resume Signal

Operator selects Option A / B / C / D above (or proposes a fifth) and re-runs `/gsd-execute-phase 44 --plan 09` with the decision recorded in 44-CONTEXT.md or a new 44-CONTEXT-amendment.md. Until then, Plan 09 stays at "checkpoint reached — pending operator decision".
