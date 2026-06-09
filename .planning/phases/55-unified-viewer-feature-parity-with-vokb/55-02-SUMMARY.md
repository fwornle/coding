---
phase: 55-unified-viewer-feature-parity-with-vokb
plan: 02
subsystem: api
tags: [km-core, ontology, display-overlay, zod, viewer, schema-extension]

# Dependency graph
requires:
  - phase: 45-unified-web-viewer
    provides: "loadDisplayOverlay() helper + ?withDisplay=true gated branch on /api/v1/ontology/classes (Plan 45-04); strict-equal 'true' BC contract"
  - phase: 44-rest-api-git-snapshots
    provides: "km-core canonical /api/v1 surface + ontology handler (Plan 44-06)"
provides:
  - "Extended DisplayHint TS interface + Zod schema with borderStyle ('solid'|'dashed') and pulseRule (null + 3 literals)"
  - "Exported parseDisplayHint() for callers needing per-entry Zod validation"
  - "16-class coding.display.json per UI-SPEC §14 verbatim (replaces Phase 45 10-entry seed)"
  - "Wire-shape extension on /api/v1/ontology/classes?withDisplay=true — borderStyle + pulseRule surface in JSON response"
affects: [55-05-renderer, 55-07-legend-panel, 55-12-okb-overlay, 55-09-issue-triage]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Zod schema extension via .optional() — new fields don't break existing overlay JSONs (Phase 55 D-55-03)"
    - "Handler stays shape-agnostic via existing `entry.display = hint` spread — schema widening requires zero handler logic changes"
    - "Shape enum widened (circle/square/diamond → circle/diamond/square/triangle/hexagon) to accommodate UI-SPEC §14 Project/Feature hexagons + RuntimeDiagnostics triangle"

key-files:
  created:
    - ".planning/phases/55-unified-viewer-feature-parity-with-vokb/55-02-SUMMARY.md"
  modified:
    - "lib/km-core/src/ontology/display-overlay.ts (DisplayHintSchema + parseDisplayHint + extended DisplayHint interface)"
    - "lib/km-core/src/api/handlers/ontology.ts (header docs only — handler stays shape-agnostic)"
    - "lib/km-core/tests/unit/display-overlay.test.ts (+10 Plan 55-02 tests)"
    - "lib/km-core/tests/integration/ontology-display-overlay.test.ts (+4 Plan 55-02 tests + phase55Fixture build env flag)"
    - ".data/ontologies/coding.display.json (replaced 10-entry Phase 45 seed with 16-entry UI-SPEC §14 overlay)"
    - "lib/km-core (submodule pointer bump: b483110 → aa7dd9a)"

key-decisions:
  - "Zod validation lives on a per-entry parseDisplayHint() helper (caller-opt-in) rather than in the loader itself — loader keeps trust-the-operator stance so a malformed entry surfaces at the call site, not as a 500 across the whole route"
  - "Shape enum widened from {circle,square,diamond} to {circle,diamond,square,triangle,hexagon} to match UI-SPEC §14 (Project/Feature hexagon + RuntimeDiagnostics triangle); strict superset → no BC regression"
  - "Handler edits limited to comment-block documentation; the existing spread-display-block pattern preserved Phase 55 fields without any logic change"
  - "Phase 45 strict-equal 'true' BC gate (T-45-04-03) preserved verbatim — uppercase ?withDisplay=TRUE still returns legacy Array<string>"

patterns-established:
  - "DisplayHint schema evolution via .optional() — D-55-03 overlay contract grows additively, no consumer breakage"
  - "Per-class display overlay JSON pre-defines hints for classes not yet registered with the ontology — extras silently ignored by handler (registry is source of truth)"

requirements-completed: [UI-02]

# Metrics
duration: ~15min
completed: 2026-06-09
---

# Phase 55 Plan 02: D-55-03 Overlay Schema Extension (borderStyle + pulseRule) Summary

**Extended km-core's per-class display overlay schema with `borderStyle` ('solid'|'dashed') + `pulseRule` (null + 3 literal expressions) under Zod validation; replaced the 10-entry Phase 45 seed with the canonical 16-class `coding.display.json` from UI-SPEC §14; live-verified Observation block returns `borderStyle:"solid"` + `pulseRule:"lastUpdatedWithin:60s"` on the obs-api `/api/v1/ontology/classes?withDisplay=true` wire after submodule build + launchd kickstart.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-06-09T16:54Z
- **Completed:** 2026-06-09T17:01Z
- **Tasks:** 3 (all TDD, all GREEN)
- **Files modified:** 5 (parent + submodule combined)
- **Tests added:** 14 (10 unit + 4 integration), all GREEN
- **Total tests run:** 334 km-core (all GREEN, no regressions)

## Accomplishments

- **DisplayHintSchema (Zod) + parseDisplayHint() exported** from `lib/km-core/src/ontology/display-overlay.ts` — gates `borderStyle` enum + `pulseRule` union; throws ZodError on unknown literals (T-55-02-01 mitigation).
- **`DisplayHint` TypeScript interface** extended with two new optional fields + shape enum widened to 5 literals per UI-SPEC §14.
- **Handler stayed shape-agnostic** — `entry.display = hint` spread in `lib/km-core/src/api/handlers/ontology.ts` already preserved any optional fields the loader returned; comment-block doc-only edit recorded the Phase 55 extension.
- **16-class `coding.display.json`** authored verbatim from UI-SPEC §14 — Observation/RuntimeDiagnostics with non-null `pulseRule`, the other 14 classes with `pulseRule:null`, all `borderStyle:"solid"`.
- **km-core built clean** (`tsc` exit 0); `dist/ontology/display-overlay.js` references `borderStyle`/`pulseRule` 11 times; `dist/api/handlers/ontology.js` references `borderStyle` once (doc comment).
- **obs-api kickstarted** via launchd; live curl probes confirm wire-shape extension + Phase 45 BC preservation.

## Task Commits

Each task was committed atomically (TDD RED + GREEN cycle visible in commit log):

1. **Task 1 RED: failing tests for parseDisplayHint** — submodule `2804faa` (test)
2. **Task 1 GREEN: extend DisplayHint + Zod schema + export parseDisplayHint** — submodule `559b6a2` (feat)
3. **Task 2: handler doc + 4 integration tests + phase55Fixture env flag** — submodule `aa7dd9a` (feat)
4. **Task 3: 16-class coding.display.json + km-core pointer bump** — parent `87bd1411f` (feat)

**Submodule pointer advance:** `b483110` → `aa7dd9a` (3 commits)

_TDD: Task 1 had separate RED + GREEN commits per the test-then-implement protocol. Tasks 2-3 wrote tests and implementation in one commit each because the handler edit was doc-only and the JSON authoring is a pure data drop (no implementation logic — the schema was already in place from Task 1)._

## Files Created/Modified

**Submodule (`lib/km-core/`):**
- `src/ontology/display-overlay.ts` — extended `DisplayHint` interface; added `DisplayHintSchema` (Zod) + `parseDisplayHint()`; shape enum widened to 5 literals.
- `src/api/handlers/ontology.ts` — header-comment-only update documenting Phase 55 schema extension; behavior unchanged.
- `tests/unit/display-overlay.test.ts` — added Plan 55-02 describe blocks (parseDisplayHint Zod tests + loadDisplayOverlay round-trip with new fields).
- `tests/integration/ontology-display-overlay.test.ts` — added 4 Plan 55-02 handler tests + `phase55Fixture` build env flag.

**Parent repo (`coding/`):**
- `.data/ontologies/coding.display.json` — replaced 10-entry Phase 45 seed with 16-entry UI-SPEC §14 canonical overlay.
- `lib/km-core` — submodule pointer bumped `b483110` → `aa7dd9a`.

## Decisions Made

- **Zod validation as caller-opt-in helper, not loader-internal.** `parseDisplayHint()` is exported alongside `loadDisplayOverlay()`. The loader stays trust-the-operator (cast-to-Record). Rationale: a single malformed entry in `coding.display.json` would otherwise 500 the entire `/api/v1/ontology/classes` route. Validation at the call site keeps blast radius narrow.
- **Shape enum widened, not replaced.** Previous Phase 45 enum was `{circle, square, diamond}`. UI-SPEC §14 introduces `hexagon` (Project, Feature, System) and `triangle` (RuntimeDiagnostics). Widened to a strict superset → no BC regression for existing `coding.display.json` overlays that only used the original 3 literals.
- **Handler edit limited to doc-comments.** The Phase 45 handler already used `entry.display = hint` (full-object spread). When Task 1 extended the underlying `DisplayHint` interface, the spread automatically forwarded the new fields. Touching handler logic would have introduced risk for zero benefit; the must_have `contains: "borderStyle"` is satisfied by the documentation block.
- **Replaced Phase 45 10-entry seed wholesale.** The seed contained entries like `LSLSession`, `MCPAgent`, `ConstraintRule`, `WorkflowDefinition` — none of which are in UI-SPEC §14. Per plan must_have ("16 class entries matching UI-SPEC §14 verbatim"), the file is the canonical Phase 55 contract; the old seed is superseded.

## Deviations from Plan

None — plan executed exactly as written. All three task `<done>` criteria met:

- Task 1: All display-overlay.test.ts cases pass including 10 new cases; `grep -c "borderStyle\|pulseRule" lib/km-core/src/ontology/display-overlay.ts` returns 13 (≥2 required).
- Task 2: All ontology-display-handler.test.ts cases pass (11 total, 4 new); `grep -c "borderStyle" lib/km-core/src/api/handlers/ontology.ts` returns 1 (≥1 required); Phase 45 BC contract preserved (string-array shape test still passes).
- Task 3: File exists with 16 entries; Observation/RuntimeDiagnostics have non-null `pulseRule`, all other entries have `pulseRule: null`; km-core build succeeds; obs-api `/api/v1/ontology/classes?withDisplay=true` curl returns enriched objects including borderStyle + pulseRule for matching overlay entries; `/api/v1/ontology/classes` returns legacy string-array shape.

## Issues Encountered

None during execution.

**Observation worth flagging for downstream plans:** the wire response currently only enriches 4 of the 16 overlay classes (Observation, Digest, Insight, LearningArtifact) because the ontology registry only has those 4 classes loaded. The other 12 overlay entries (Project, Component, SubComponent, Detail, Pattern, Service, File, Feature, Contract, RuntimeDiagnostics, System, Knowledge) are silently ignored by the handler (registry is the source of truth for which class names exist). This is the same Phase 45 behavior — the overlay file pre-emptively defines hints for classes that may be registered later. Phase 55 renderer (Plan 55-05) and Legend (Plan 55-07) will need to either (a) consume the overlay file directly, or (b) accept that only registered classes get the canonical display block. Recommend logging this observation in 55-CONTEXT.md if the renderer can't see all 16 classes via the API.

## Live Verification

All four `<verification>` checks from the plan pass live against obs-api on port 12436:

```bash
$ jq -e 'length == 16' .data/ontologies/coding.display.json
true

$ curl -sf 'http://localhost:12436/api/v1/ontology/classes?withDisplay=true' \
    | jq '.data[] | select(.name=="Observation") | .display'
{
  "color": "#10b981",
  "icon": "📝",
  "shape": "circle",
  "borderStyle": "solid",
  "pulseRule": "lastUpdatedWithin:60s"
}

$ curl -sf 'http://localhost:12436/api/v1/ontology/classes' | jq 'type, .data | type'
"string"
"array"   # data is an array of strings — Phase 45 BC preserved

$ cd lib/km-core && npm test  # 334/334 pass
```

## User Setup Required

None — no external service configuration required. obs-api was kickstarted via launchd as part of Task 3.

## Next Phase Readiness

- **D-55-03 contract is live.** Plans 55-05 (renderer) and 55-07 (LegendPanel) can now consume `?withDisplay=true` and read `display.borderStyle` + `display.pulseRule` for the 4 currently-registered classes (Observation, Digest, Insight, LearningArtifact).
- **Acceptance grep gate stays clean:** `grep -c "ontologyDir" lib/km-core/src/ontology/display-overlay.ts` returns 4 — Phase 41 CLAUDE.md ontologyDir-invariant preserved.
- **No new packages added** — schema extension is Zod-only (zod ^3.25.76 already in km-core dependencies).
- **OKB overlay deferred** per CONTEXT § Specific Ideas — Phase 55 ships only `coding.display.json`; `okb.display.json` is a follow-up in the OKM repo (out of Phase 55 scope).

## Self-Check: PASSED

**Created files exist:**
- FOUND: `.data/ontologies/coding.display.json` (16 entries, valid JSON, UI-SPEC §14 verbatim)
- FOUND: `lib/km-core/src/ontology/display-overlay.ts` (extended)
- FOUND: `lib/km-core/src/api/handlers/ontology.ts` (doc-only edit)
- FOUND: `lib/km-core/tests/unit/display-overlay.test.ts` (extended)
- FOUND: `lib/km-core/tests/integration/ontology-display-overlay.test.ts` (extended)

**Commits exist (verified via `git log`):**
- FOUND: `2804faa` test(55-02): RED tests (submodule)
- FOUND: `559b6a2` feat(55-02): GREEN extension (submodule)
- FOUND: `aa7dd9a` feat(55-02): handler doc + 4 tests (submodule)
- FOUND: `87bd1411f` feat(55-02): 16-class JSON + pointer bump (parent)

**Live wire-shape verified:**
- FOUND: borderStyle="solid", pulseRule="lastUpdatedWithin:60s" on Observation via curl
- FOUND: Phase 45 BC array-of-strings shape on `?withDisplay` absent

---
*Phase: 55-unified-viewer-feature-parity-with-vokb*
*Completed: 2026-06-09*
