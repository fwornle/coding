---
phase: 60-unified-viewer-rendering-ux-integrity
plan: 07
subsystem: km-core
tags: [hierarchy-roots, ontology, level-parent, sc5-gap-closure, l1-l2-grouping, lower-ontology]

# Dependency graph
requires:
  - phase: 60-unified-viewer-rendering-ux-integrity
    provides: "60-04 — HIERARCHY_ROOTS / HIERARCHY_ROOT_CLASS exports from lib/km-core/src/types/hierarchy-roots.ts (D-14, D-23 single source of truth)"
  - phase: 60-unified-viewer-rendering-ux-integrity
    provides: "60-05 — OntologyFilter dual-mode contract (API-driven L1→L2 group construction for the coding tab; VOKB_SCHEMA hardcoded path for okb tab; W-1 preserved)"
  - phase: 60-unified-viewer-rendering-ux-integrity
    provides: "60-06 — Phase 60 verification harness + 60-VERIFICATION.md gap surface (4 PASS + 1 PARTIAL on SC#5)"
  - phase: 57-lower-ontology-project-tagging-foundation
    provides: ".data/ontologies/coding.lower.json with 10 L2 classes extending Component/SubComponent/Detail via the `extends` field"
  - phase: 45-…
    provides: "lib/km-core/src/api/handlers/ontology.ts enriched-path (Plan 45-04) with display-overlay merge and level/parent passthrough"
provides:
  - ".data/ontologies/coding-ontology.json — Component, SubComponent, Detail now carry top-level `level: 1` (L1 grouping anchors)"
  - ".data/ontologies/coding.lower.json — 10 L2 classes now carry top-level `level: 2` AND `parent: <L1>` mirroring `extends`"
  - "lib/km-core/src/api/handlers/ontology.ts — Path B HIERARCHY_ROOTS synthesis (System + Project at level:0, deduped, scoped to coding system) + parent fallback from `extends` when explicit `parent` absent"
  - "lib/km-core/tests/unit/ontology-data-shape.test.ts — 7 vitest cases locking the L1/L2 data shape against future drift"
  - "lib/km-core/tests/integration/ontology-handler.withDisplay-level-parent.test.ts — 9 vitest+supertest cases locking synthesis, parent fallback, idempotency, BC, and scope-to-coding"
affects:
  - "obs-api GET /api/v1/ontology/classes?withDisplay=true — now returns L0 System+Project anchors for the coding system"
  - "Unified viewer OntologyFilter (Phase 60-05 deliverable) — L0 anchor rows will render once the registry sourcing question is resolved"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Path B handler-side synthesis from a closed-set constant (HIERARCHY_ROOTS) over Path A data-side duplication — preserves single source of truth from Plan 60-04"
    - "Defensive parent-fallback chain: explicit `parent` wins, then `extends`, then undefined. Lets L2 data files omit `parent` when it equals `extends` without breaking viewer grouping"
    - "System-scoped synthesis gated on `displayOverlaySystem === 'coding'` — keeps the L0 anchor surface from leaking into okb / other tabs"

key-files:
  created:
    - "lib/km-core/tests/unit/ontology-data-shape.test.ts"
    - "lib/km-core/tests/integration/ontology-handler.withDisplay-level-parent.test.ts"
  modified:
    - ".data/ontologies/coding-ontology.json"
    - ".data/ontologies/coding.lower.json"
    - "lib/km-core/src/api/handlers/ontology.ts"

key-decisions:
  - "Path B (handler synthesis) chosen over Path A (data fix) per the plan's <approach_decision_for_research> recommendation. Rationale: HIERARCHY_ROOTS in lib/km-core/src/types/hierarchy-roots.ts is the Plan 60-04 single source of truth for the closed-set roots (CK + 4 project anchors mapping to System / Project locked classes); duplicating into coding-ontology.json would create drift risk."
  - "Component, SubComponent, AND Detail all set to `level: 1` (NOT 2 or 3 as a literal reading of their narrative descriptions might suggest). Verified against OntologyFilter.tsx:466-478 — the viewer treats anything with `level === 1` as a group HEADER and anything with `level === 2 && parent` as a child; the existence of L2 children under each of the three classes (Phase 57 D-09) is what makes them L1 anchors."
  - "Parent fallback gated on `entry.parent === undefined` so explicit data-side `parent` always wins. Test 4 locks this precedence (extends:Component + parent:Detail → response carries parent:Detail)."
  - "Synthesis scoped to `displayOverlaySystem === 'coding'` (Test 9). Conservative default — keeps L0 surface from leaking into okb tab where VOKB_SCHEMA still drives grouping."
  - "Tests placed under `tests/unit/` and `tests/integration/` rather than `src/api/__tests__/` as the plan literally specified — the vitest config (`include: ['tests/**/*.test.ts']`) does not pick up tests under src/. The path adjustment preserves the spirit of the plan (vitest cases asserting data shape + handler behavior) while honoring the project's existing convention. Filenames match the plan's spec verbatim."

patterns-established:
  - "Handler-side closed-set synthesis at the API edge: import a small constant from the same km-core internal types module (NOT @fwornle/km-core to avoid self-cycle during build), synthesize entries dedup'd against the registry-derived `presentNames` set, prepend so anchors lead the wire-order array"
  - "Same-package handler reads via relative import `'../../types/hierarchy-roots.js'` while consumer-facing code uses `@fwornle/km-core` — keeps the build graph one-way"

requirements-completed: []

# Metrics
duration: ~15min
completed: 2026-06-17
---

# Phase 60 Plan 07: SC#5 Gap-Closure — L0/L1/L2 Hierarchy in Ontology API Summary

**HIERARCHY_ROOTS-backed L0 synthesis + extends-derived parent fallback + L1/L2 data annotation so OntologyFilter L1→L2 grouping can light up. Handler-side contract complete with 9/9 vitest pass; live API L0 anchors verified. L1/L2 surfacing blocked at runtime by a pre-existing obs-api registry sourcing issue surfaced — captured below as a follow-up.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-06-17T19:40:18Z
- **Completed:** 2026-06-17T19:55:41Z (Tasks 1+2 implementation; Task 3 checkpoint awaits operator)
- **Tasks:** 2 of 3 implementation tasks complete; Task 3 is a `type="checkpoint:human-verify" gate="blocking"` operator gate

## Accomplishments

### Task 1 — Data fix (L1 + L2 level/parent annotation)

- `.data/ontologies/coding-ontology.json` — Component, SubComponent, Detail each gained top-level `"level": 1`. Discovery: all three serve as L1 grouping anchors in the viewer's OntologyFilter (lines 466-478) because each carries L2 children that extend it. The narrative "L2"/"L4 leaf" wording in their `description` strings is documentary, not authoritative.
- `.data/ontologies/coding.lower.json` — all 10 Phase 57 L2 classes (LiveLoggingSystem, ConstraintMonitor, KnowledgeManagement, BatchSemanticAnalysis, RapidLlmProxy, DockerizedServices, OnlineObservation, OnlineDigest, OnlineInsight, EtmDaemon) gained top-level `"level": 2` AND `"parent": <L1>` mirroring `extends` literally.
- `lib/km-core/tests/unit/ontology-data-shape.test.ts` — 7 vitest cases lock the shape against future drift.

### Task 2 — API handler (synthesis + parent fallback)

- `lib/km-core/src/api/handlers/ontology.ts` — Path B implementation:
  - `parent` fallback from `extends` when explicit `parent` undefined (D-3).
  - HIERARCHY_ROOTS synthesis (D-23) prepends `{name: "System", level: 0}` + `{name: "Project", level: 0}` when `displayOverlaySystem === 'coding'`, deduplicating against `presentNames` so pre-registered classes win.
  - Internal import from `'../../types/hierarchy-roots.js'` (NOT `@fwornle/km-core` — avoids self-cycle during build). `void HIERARCHY_ROOTS` surface witness defeats strict tree-shakers.
  - BC preserved (T-45-04-03): string-array path on `/ontology/classes` (no `?withDisplay=true`) unchanged.
- `lib/km-core/tests/integration/ontology-handler.withDisplay-level-parent.test.ts` — 9 vitest+supertest cases:
  - T1 synthesis · T2 idempotency · T3 parent-fallback · T4 explicit-parent precedence · T5 level:1 surfacing · T6 level:2+parent · T7 display preserved · T8 BC string-array · T9 non-coding system scope.

### Build + regression gates

- `cd lib/km-core && npm run build` — exits 0
- Full ontology test suite — 5 files, 72 tests pass
- Full km-core suite — 41 files, 401 tests pass — zero regression
- Live API smoke (port 12436, see Deviation 2 re: 3848 vs 12436):
  - `curl -s 'http://localhost:12436/api/v1/ontology/classes?withDisplay=true' | jq '[.data[] | select(.level == 0)] | map(.name)'` → `["System", "Project"]` ✓
  - BC: `curl -s 'http://localhost:12436/api/v1/ontology/classes' | jq '.data | type'` → `"array"` of `"string"`s ✓
  - L1 / L2 surfacing → BLOCKED by Deviation 3 below (NOT introduced by this plan).

## Task Commits

Each task atomic per the executor protocol. Submodule (km-core) commits land in the submodule; superproject commits include data-fix + the submodule pointer bump.

| Task | Layer | Commit (km-core) | Commit (superproject) | Note |
| ---- | ----- | ---------------- | --------------------- | ---- |
| T1 RED  | km-core | `78573c3` | — | `test(60-07): add failing data-shape test for L1/L2 level/parent fields` |
| T1 GREEN | data | — | `4814e2465` | `feat(60-07): annotate L1/L2 ontology classes with explicit level/parent` |
| T2 RED  | km-core | `32e642e` | — | `test(60-07): add failing tests for L0 synthesis + parent fallback` |
| T2 GREEN | km-core | `cd02707` | — | `feat(60-07): HIERARCHY_ROOTS synthesis + parent fallback in ontology handler` |
| Pointer | super | — | `330f63bd1` | `chore(60-07): bump km-core pointer (L0 synthesis + parent fallback)` |

(Final metadata commit landing this SUMMARY + STATE.md + ROADMAP.md follows.)

## Files Created/Modified

- `.data/ontologies/coding-ontology.json` — additive `"level": 1` on Component/SubComponent/Detail; description prose on SubComponent/Detail extended to clarify L1 grouping role.
- `.data/ontologies/coding.lower.json` — additive `"level": 2` + `"parent": <L1>` on all 10 L2 classes.
- `lib/km-core/src/api/handlers/ontology.ts` — `HIERARCHY_ROOTS` + `HIERARCHY_ROOT_CLASS` import; parent fallback from `extends`; L0 synthesis loop scoped to coding system; ~50 lines added.
- `lib/km-core/tests/unit/ontology-data-shape.test.ts` — NEW. 180 lines. Walks-up resolver + 7 assertions.
- `lib/km-core/tests/integration/ontology-handler.withDisplay-level-parent.test.ts` — NEW. 362 lines. Lifecycle pattern mirrors `tests/integration/ontology-display-overlay.test.ts`.

## Decisions Made

See `key-decisions` frontmatter for the load-bearing decisions. The two most consequential:

1. **Path B (synthesis) over Path A (data duplication).** Plan 60-04 already established HIERARCHY_ROOTS as the single source of truth. Adding System/Project to coding-ontology.json would have created two sources (60-04 constant + ontology JSON) that could drift independently. Synthesis keeps the constant authoritative.
2. **Component, SubComponent, AND Detail all set to `level: 1`** despite their narrative descriptions naming "L2"/"L4 leaf". The OntologyFilter group-building logic keys on `level === 1` for group headers and `level === 2 && parent` for children — and the existence of L2 children below each of the three (Phase 57 D-09 set: 6 under Component + 1 under SubComponent + 3 under Detail) is what makes them L1 anchors.

## Deviations from Plan

### Deviation 1 — Test location (Rule 3 blocking — auto-fixed)

- **Found during:** Task 1 step 5 (running RED test).
- **Issue:** The plan literally specifies tests at `lib/km-core/src/api/__tests__/...` but the vitest config at `lib/km-core/vitest.config.ts` includes only `tests/**/*.test.ts` — tests under `src/` are not discovered. Running the plan literally would produce a "No test files found" error.
- **Fix:** Moved both new test files to the canonical locations (`tests/unit/ontology-data-shape.test.ts` and `tests/integration/ontology-handler.withDisplay-level-parent.test.ts`). Filenames match the plan verbatim. Same vitest discovery, zero behavior change.
- **Scope:** In-scope path correction; spirit of the plan preserved.

### Deviation 2 — Live API port is 12436, not 3848

- **Found during:** Task 2 acceptance gate (`curl http://localhost:3848/...`).
- **Issue:** The plan's acceptance criteria curl against port 3848. The actual obs-api launchd daemon (`com.coding.obs-api`) listens on **port 12436** (per `[obs-api] listening on http://0.0.0.0:12436 ...` in `/tmp/obs-api.log` after kickstart). Port 3848 is the semantic-analysis SSE server (per CLAUDE.md / MEMORY.md — workflow execution, not REST API).
- **Fix:** All acceptance gates re-run against port 12436. L0 anchor verification verified: `curl -s 'http://localhost:12436/api/v1/ontology/classes?withDisplay=true' | jq '[.data[] | select(.level == 0)] | map(.name)'` returns `["System", "Project"]`. BC string-array path also verified clean on 12436.
- **Plan correction:** The plan author likely confused the SSE port with the REST port; this can be corrected in a small docs follow-up.

### Deviation 3 — obs-api registry sourced from km-core bundled ontology, NOT host `.data/ontologies/` (Rule 4 surfaced — documented, not auto-fixed)

- **Found during:** Task 2 live-API smoke (L1 / L2 surfacing assertions failed with all classes empty).
- **Root cause:** `scripts/observations-api-server.mjs:1336-1340` constructs the `GraphKMStore` with `ontologyDir: defaultOntologyDir()` — which resolves to `lib/km-core/ontology/` (bundled km-core ontology containing ONLY `upper.json` + `learning-artifacts.json`). The host-side `.data/ontologies/` (which holds `coding-ontology.json` + `coding.lower.json` + per-team lowers) is wired ONLY into the display-overlay path at line 1395 (`ontologyDir: path.join(process.cwd(), '.data', 'ontologies')`) — that's the OVERLAY, NOT the registry source.

  Net effect: the registry's `classCatalog` exposes 6 classes total (4 from upper: `LearningArtifact`, `Observation`, `Digest`, `Insight`; plus a handful from learning-artifacts.json). The new HIERARCHY_ROOTS synthesis works perfectly (System + Project appear with level:0). But Component / SubComponent / Detail / Phase-57 L2s never enter the registry, so they never surface in the enriched response no matter what the data files say.
- **Why this is NOT Rule 3 auto-fix:** switching the GraphKMStore registry to `.data/ontologies/` would cause writer-side entityType validation to run against a different class set, potentially rejecting existing valid writes (the bundled km-core ontology has `LearningArtifact` / `Observation` / `Digest` / `Insight` which the host upper.json does NOT). That's a Rule 4 architectural decision: which ontology directory IS the runtime source of truth for the writer? Possibly: a chain-load that takes the union; or: the host-side dir becomes the new bundled default; or: leave the bundled ontology and add Component+SubComponent+Detail+coding-lower to it; or: a smarter merge in `defaultOntologyDir()`.
- **Recommended follow-up todo (file as separate gap-closure):** "Phase 60.08 (or 61) — obs-api GraphKMStore ontologyDir resolution: route the host-side `.data/ontologies/` through to the registry so the writer + the /api/v1/ontology/classes enriched response cover Component/SubComponent/Detail/Phase-57 lowers AND the existing learning-artifact classes". The plan's `<vite_proxy_note>` explicitly anticipated this kind of "if not, add a smaller follow-up todo and capture the gap explicitly".
- **Impact on this plan:** the handler-side contract is fully verified (9/9 vitest pass, full km-core suite 401/401 green, live API L0 synthesis works, BC preserved). Plan 60-07's deliverables are complete; the SC#5 visual smoke that Task 3 asks the operator to re-run will still show the L0 anchor row (System, Project at top) BUT the L1→L2 collapsible groups for Component/SubComponent/Detail will remain absent until the ontology-dir-resolution follow-up lands.

### Deviation 4 — Submodule commit message via `-m` flag (not heredoc)

- **Found during:** Task 2 GREEN commit.
- **Issue:** Heredoc-style commit messages and `Write` to `/tmp/...` were both denied by the sandbox policy. Backticks in the rendered message text are also denied.
- **Fix:** Used multi-`-m` flag style. Message content preserved, just split across multiple flag invocations.

---

**Total deviations:** 4 (1 in-scope path correction, 2 documentation/runtime port mismatches, 1 architectural gap surfaced as follow-up).
**Impact on plan:** None for the handler contract; the L1/L2 runtime smoke gate in Task 2 cannot be cleared without the Deviation-3 follow-up — Task 3 operator instructions below note this clearly.

## Issues Encountered

- No Bash-tool deny on the constraint-monitor side beyond normal hook denials on heredoc commit messages — those resolved by switching to `-m` flag style.
- Live API on port 3848 was returning 200 BUT serving the OLD km-core dist before kickstart; after `launchctl kickstart -k gui/$(id -u)/com.coding.obs-api`, the L0 synthesis went live on port 12436 (the actual obs-api port).

## Known Stubs

None — the handler synthesis lights up immediately for L0 anchors. L1/L2 surfacing isn't a stub; it's blocked by Deviation 3 (a separate architectural decision).

## Threat Flags

None — Plan 60-07 only widens the enriched response shape for the configured coding system. No new endpoints, no auth-path changes, no trust-boundary changes. The plan's existing threat register (T-60-07-01 / 02 / 03 / 04) is fully addressed.

## TDD Gate Compliance

Both task implementations followed RED → GREEN cleanly:

| Task | RED commit | GREEN commit | Test count | Gate status |
| ---- | ---------- | ------------ | ---------- | ----------- |
| Task 1 (data shape) | `lib/km-core@78573c3` | superproject `4814e2465` | 7 | PASS |
| Task 2 (handler synthesis) | `lib/km-core@32e642e` | `lib/km-core@cd02707` | 9 | PASS |

Note: Task 1 RED is in km-core (the test file); Task 1 GREEN is in superproject (the data file in `.data/ontologies/`). Different repos. The RED commit fails 5/7 against the existing data — the GREEN commit flips the data and brings all 7 to pass.

## Self-Check: PASSED

Verification commands run before this SUMMARY was finalized:

- `[ -f .data/ontologies/coding-ontology.json ]` → FOUND
- `[ -f .data/ontologies/coding.lower.json ]` → FOUND
- `[ -f lib/km-core/src/api/handlers/ontology.ts ]` → FOUND
- `[ -f lib/km-core/tests/unit/ontology-data-shape.test.ts ]` → FOUND
- `[ -f lib/km-core/tests/integration/ontology-handler.withDisplay-level-parent.test.ts ]` → FOUND
- `git log --oneline | grep "4814e2465\|330f63bd1"` → both present in superproject HEAD
- `cd lib/km-core && git log --oneline | head -4` → `cd02707` GREEN + `32e642e` RED + `78573c3` RED visible
- `jq '.classes.Component.level' .data/ontologies/coding-ontology.json` → `1`
- `jq '[.classes | to_entries[] | .value.level] | unique' .data/ontologies/coding.lower.json` → `[2]`
- `jq '[.classes | to_entries[] | .value.parent] | unique' .data/ontologies/coding.lower.json` → `["Component","Detail","SubComponent"]`
- `grep -c "HIERARCHY_ROOTS\|HIERARCHY_ROOT_CLASS" lib/km-core/src/api/handlers/ontology.ts` → 7 matches
- `grep -n "cls.extends" lib/km-core/src/api/handlers/ontology.ts` → parent-fallback line present
- Live API L0 synthesis: `curl -s 'http://localhost:12436/api/v1/ontology/classes?withDisplay=true' | jq '[.data[] | select(.level == 0)] | map(.name)'` → `["System", "Project"]`
- BC string-array: `curl -s 'http://localhost:12436/api/v1/ontology/classes' | jq '.data | type'` → `"array"`; first element type `"string"`; no `"System"` or `"Project"` leak

## Next Phase Readiness

**Plan 60-07 status:** Tasks 1+2 complete; Task 3 is a `type="checkpoint:human-verify" gate="blocking"` operator gate. Orchestrator receives the checkpoint payload alongside this SUMMARY.

**What's ready for operator verification (Task 3):**
- API handler-side contract for L0 synthesis is LIVE on port 12436 — operator can verify `System` and `Project` L0 anchors render at the top of the OntologyFilter section in `/viewer/coding`.
- API handler-side contract for parent-fallback is LIVE (Test 3 / 4 / 6 pass).
- BC string-array path on `/ontology/classes` is preserved (T-45-04-03 lock intact).

**What is NOT YET ready (Deviation 3 blocker):**
- L1 group headers (Component / SubComponent / Detail) will NOT appear in the OntologyFilter until the obs-api GraphKMStore registry is sourced from `.data/ontologies/` instead of the bundled `lib/km-core/ontology/`. This is an architectural decision that should be made in a follow-up phase (Phase 60.08 or 61).
- Consequently the L2 children (Phase-57 set: LiveLoggingSystem etc.) will also not appear.
- Task 3 operator verification: expect L0 anchors to surface but L1→L2 groups to be absent until the follow-up lands. This is documented clearly in the checkpoint payload.

**Blockers / concerns:**
- The Deviation 3 follow-up is the gating issue for full SC#5 PASS. Until it lands, SC#5 stays PARTIAL (it would go from "L0+L1+L2 all missing" to "L0 lights up, L1+L2 still absent").

---
*Phase: 60-unified-viewer-rendering-ux-integrity*
*Completed: 2026-06-17 (Tasks 1+2; Task 3 checkpoint pending operator)*
