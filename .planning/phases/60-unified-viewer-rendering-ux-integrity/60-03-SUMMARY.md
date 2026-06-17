---
phase: 60-unified-viewer-rendering-ux-integrity
plan: 03
subsystem: unified-viewer
tags: [vkb, debug-toggle, observation, digest, architecture-bleed, vkbui-03]
requires:
  - phase: 60-unified-viewer-rendering-ux-integrity (Plan 01)
    provides: "VisibilityFilters.ontologyRegistry? optional field + deriveLayer wiring"
provides:
  - "viewer-store: showDebugEntityTypes boolean (default false, non-persistent) + toggleShowDebugEntityTypes action"
  - "visibility-predicate: Observation/Digest hard-exclusion gated on filters.showDebugEntityTypes !== true (W-2 defensive read)"
  - "VisibilityFilters: showDebugEntityTypes is now REQUIRED (no `?`) — W-2 tsc gate forces every call site to thread it"
  - "GraphToggles: new 'Show debug entity types (Observation, Digest)' row with verbatim D-10 Architecture-bleed tooltip"
affects:
  - "Any future phase adding new isEntityVisible call sites must pass showDebugEntityTypes explicitly (W-2 contract)"
tech-stack:
  added: []
  patterns:
    - "Defensive `!== true` comparison for security-shaped boolean shields"
    - "Required (no `?`) VisibilityFilters fields enforced via project-wide `tsc --noEmit` gate"
    - "Non-persistent UI toggle (no localStorage / persist middleware) — D-11 pattern reuse"
key-files:
  created: []
  modified:
    - integrations/unified-viewer/src/store/viewer-store.ts
    - integrations/unified-viewer/src/store/viewer-store.test.ts
    - integrations/unified-viewer/src/graph/visibility-predicate.ts
    - integrations/unified-viewer/src/graph/visibility-predicate.test.ts
    - integrations/unified-viewer/src/graph/useVisibleEntityIds.ts
    - integrations/unified-viewer/src/graph/D3GraphCanvas.tsx
    - integrations/unified-viewer/src/panels/filters/GraphToggles.tsx
    - integrations/unified-viewer/src/panels/filters/GraphToggles.test.tsx
    - integrations/unified-viewer/src/panels/filters/LayerFilter.test.tsx
key-decisions:
  - "Required (not optional) showDebugEntityTypes field on VisibilityFilters — enforces W-2 tsc-gate compliance across every call site"
  - "Defensive `!== true` (not `=== false` and not direct boolean) — undefined / null / false all collapse to 'exclude Observation/Digest' so a half-deployed call site cannot leak architecture-bleed types"
  - "Non-persistent (D-11) — no Zustand persist / partialize / localStorage wiring; the operator must consciously re-enable each session"
  - "Visible test ordering: gate-test selectedClasses must include 'Observation'/'Digest' so the class predicate at line 112 does NOT knock out test entities before they reach the showDebugEntityTypes branch"
patterns-established:
  - "Architecture-bleed shield: default-hide for raw-stream types (Observation/Digest); runtime toggle via UI; never persist; defensive readback"
  - "W-2 tsc gate: marking a flag REQUIRED on the predicate filter interface guarantees every consumer pays the type-check cost — silent leaks become compile errors"
requirements-completed: [VKBUI-03]
duration: ~20 min
completed: 2026-06-17
---

# Phase 60 Plan 03: showDebugEntityTypes Toggle (VKBUI-03) Summary

**Runtime toggle that lets operators re-enable Observation/Digest visibility in the unified-viewer graph without code edits, while keeping the architecture-bleed shield ON by default. Predicate read is defensive (`!== true`) so undefined call-site state cannot leak.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-06-17T13:48:00Z (approx — branch checkout to RED commit)
- **Completed:** 2026-06-17T14:08:00Z
- **Tasks:** 2 (each TDD — RED + GREEN, no REFACTOR needed)
- **Files modified:** 9 (3 production source + 1 production UI + 1 graph hook + 1 D3 canvas + 3 test files)

## Accomplishments

- Added `showDebugEntityTypes: boolean` + `toggleShowDebugEntityTypes()` to viewer-store with default `false`, no persistence (D-11).
- Made `VisibilityFilters.showDebugEntityTypes` REQUIRED (per checker W-2) so the project-wide `tsc --noEmit` gate surfaces any half-deployed call site that would otherwise silently leak Observation/Digest.
- Gated `visibility-predicate.ts` Observation/Digest hard-exclusion on `filters.showDebugEntityTypes !== true` — defensive read so `undefined`/`null` behave identically to `false`.
- Threaded the flag through both production call sites (`useVisibleEntityIds.ts`, `D3GraphCanvas.tsx`) including dep-array entries so React recomputes the visible set when the operator flips the toggle.
- Added a new row to `GraphToggles.tsx` with verbatim D-10 label and D-21 micro-type Tailwind tokens. Hint paragraph carries the verbatim CONTEXT.md "Architecture-bleed shield..." copy.
- 13 new tests landed (4 store + 5 predicate + 4 GraphToggles), all passing. 9 pre-existing predicate tests still pass.

## Task Commits

Each task followed the TDD RED → GREEN cycle:

1. **Task 1 RED: failing tests for showDebugEntityTypes gate** — `5e4be3503` (test)
2. **Task 1 GREEN: showDebugEntityTypes gate for Observation/Digest** — `6a4473794` (feat)
3. **Task 2 RED: failing tests for GraphToggles debug-entity-types row** — `26e72afc0` (test)
4. **Task 2 GREEN: GraphToggles "Show debug entity types" row** — `9d7c00073` (feat)

No REFACTOR commits — the implementations were minimal and clean on first pass.

## Files Created/Modified

- `integrations/unified-viewer/src/store/viewer-store.ts` — declaration (line 309) + default (line 889) + toggle action (line 976) for `showDebugEntityTypes`.
- `integrations/unified-viewer/src/store/viewer-store.test.ts` — appended a 4-test `describe` block for the new field (default, toggle, no-persistence source-grep, Phase 56.1 D-1 invariant).
- `integrations/unified-viewer/src/graph/visibility-predicate.ts` — added REQUIRED `showDebugEntityTypes: boolean` to `VisibilityFilters` (lines 40-54); gated Observation/Digest exclusion on `filters.showDebugEntityTypes !== true` (lines 79-89); updated JSDoc on `isEntityVisible`.
- `integrations/unified-viewer/src/graph/visibility-predicate.test.ts` — added `showDebugEntityTypes: false` to baseFilters helper; appended a 5-test `describe` block for the gate (default-exclude, toggle-on-unhide, Digest mirror, Component unaffected, W-2 defensive undefined).
- `integrations/unified-viewer/src/graph/useVisibleEntityIds.ts` — subscription + isEntityVisible call object + dep-array entry for the new flag.
- `integrations/unified-viewer/src/graph/D3GraphCanvas.tsx` — same pattern as useVisibleEntityIds (subscription + call-object field + dep-array entry).
- `integrations/unified-viewer/src/panels/filters/GraphToggles.tsx` — subscription + new label + hint paragraph row mirroring the surrounding pattern verbatim (D-10 label + D-21 micro-type).
- `integrations/unified-viewer/src/panels/filters/GraphToggles.test.tsx` — appended a 4-test `describe` block for the new row.
- `integrations/unified-viewer/src/panels/filters/LayerFilter.test.tsx` — added `showDebugEntityTypes: false` to the `predicateFilters` helper so the existing regression test still compiles after the field became required.

## Decisions Made

- **`!== true` defensive comparison.** Even though the field is typed as required, the predicate reads `!== true` so runtime `undefined` / `null` / `false` all converge to "exclude Observation/Digest." For a security-shaped shield (architecture-bleed) this is the only safe default — a positive read would invert under partial mocks or store-init races. Documented in the JSDoc and re-asserted by Predicate test 5.
- **Required field.** The plan explicitly chose REQUIRED (no `?`) over OPTIONAL — the `tsc --noEmit` gate is the canonical W-2 enforcement: any new call site that forgets the flag becomes a compile error. The graceful runtime fallback (the `!== true` comparison) is defence-in-depth; the type system is the primary line.
- **Non-persistent.** D-11 says reset on every page load; verified by a source-grep test that strips comments before scanning for `persist(` / `partialize` / `localStorage` — comments in the codebase (including mine) mention those terms because they explain WHY the field is non-persistent, so naive substring matches false-positive.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocker] Worktree missing node_modules**

- **Found during:** Task 1 RED test run setup.
- **Issue:** `npx vitest run` cannot resolve `@vitejs/plugin-react` or `vitest` because `git worktree add` does not copy `node_modules/`. Plan 60-01 hit the same blocker.
- **Fix:** Created a symlink `node_modules` → `/Users/Q284340/Agentic/coding/integrations/unified-viewer/node_modules` (main repo) via Node's `fs.symlinkSync`. Same fix as Plan 60-01 SUMMARY § Deviation 1. The symlink is `.gitignore`'d so it stays local to the worktree.
- **Files modified:** none (symlink not tracked).
- **Verification:** `npx vitest run` resolves dependencies; `npx tsc --noEmit` resolves `@/` aliases.
- **Committed in:** N/A (environment fix only).

**2. [Rule 1 — Bug] Test 3 (D-11 no persistence) regex too greedy**

- **Found during:** Task 1 GREEN — first vitest run after implementation.
- **Issue:** The plan-specified regex `/persist[\s\S]*showDebugEntityTypes/` matched comments inside `viewer-store.ts` that legitimately mention both "persist" and "showDebugEntityTypes" (the explanatory JSDoc explaining WHY the field is non-persistent).
- **Fix:** Strip comments (`/* … */` and `// …`) from the source string before scanning. Replaced the greedy `[\s\S]*` patterns with bounded `[\s\S]{0,300}` plus narrow targets: `\bpersist\s*\(` (function call), `\bpartialize\b` (option), `\blocalStorage\b` (raw API). These are the actual Zustand persistence-middleware signatures.
- **Files modified:** `integrations/unified-viewer/src/store/viewer-store.test.ts` (Test 3 body).
- **Verification:** Test 3 now passes; all 4 store tests pass; `npx tsc --noEmit` still green.
- **Committed in:** `6a4473794` (folded into Task 1 GREEN).

**3. [Rule 2 — Missing Critical] `LayerFilter.test.tsx` predicateFilters helper missing showDebugEntityTypes**

- **Found during:** Task 1 RED preparation — the plan flagged this implicitly via "Update every other VisibilityFilters call site discovered via grep".
- **Issue:** The pre-existing `predicateFilters` helper inside `LayerFilter.test.tsx` constructs a `VisibilityFilters` literal. Making the new field required would have broken that test under `tsc --noEmit`.
- **Fix:** Added `showDebugEntityTypes: false` to the helper, keeping the test's intent (verify badge/predicate symmetry) untouched.
- **Files modified:** `integrations/unified-viewer/src/panels/filters/LayerFilter.test.tsx`.
- **Verification:** `npx tsc --noEmit` exits 0; LayerFilter tests still pass (except 2 pre-existing toggleLayer failures documented in 60-01-SUMMARY.md § Deferred Issues — unrelated).
- **Committed in:** `5e4be3503` (folded into Task 1 RED so the post-RED code change is type-clean).

---

**Total deviations:** 3 auto-fixed (1 Rule 3 environment blocker, 1 Rule 1 test-regex bug, 1 Rule 2 W-2 call-site update).
**Impact on plan:** All three were minor and required for correctness / passing acceptance gates. No scope creep — every change stayed inside the plan's `files_modified` list (deviation #3 modified LayerFilter.test.tsx which IS in the plan's grep-derived scope per the "Update every other VisibilityFilters call site" instruction).

## Issues Encountered

- The `LayerFilter` describe-block in `LayerFilter.test.tsx` still has 2 pre-existing `toggleLayer` test failures (lines around 52). These predate Plan 60-03 and are explicitly documented in `60-01-SUMMARY.md § Deferred Issues` as out-of-scope `toggleLayer` semantics drift. Verified the failures match the same assertion shape as the 60-01 baseline (`expected [pattern,evidence] to contain 'pattern'` etc.) — no Plan 60-03 regression.

## TDD Gate Compliance

- Task 1 RED: `5e4be3503` (test)
- Task 1 GREEN: `6a4473794` (feat) — RED → GREEN order verified.
- Task 2 RED: `26e72afc0` (test)
- Task 2 GREEN: `9d7c00073` (feat) — RED → GREEN order verified.
- No REFACTOR commits — both implementations were minimal/clean on first pass.

## Verification

- `cd integrations/unified-viewer && npx vitest run src/store/viewer-store.test.ts src/graph/visibility-predicate.test.ts src/panels/filters/GraphToggles.test.tsx src/graph/layer.test.ts` → 128 passed / 4 failed (the 4 are pre-existing `toggleLayer` failures from 60-01 deferred-items, NOT Plan 60-03 regressions).
- `cd integrations/unified-viewer && npx tsc --noEmit` → exit 0 (W-2 gate: every VisibilityFilters call site threads `showDebugEntityTypes`).
- `cd integrations/unified-viewer && npm run build` → exit 0 (vite production bundle succeeds).
- All Task 1 acceptance greps pass: declaration / toggle (2 refs) / default `false` / predicate refs (6) / required-field check / `!== true` defensive read (2 hits — comment + impl) / useVisibleEntityIds threading (3 refs: subscription + call-object + dep-array) / D3GraphCanvas threading (3 refs).
- All Task 2 acceptance greps pass: exact label string, Architecture-bleed copy, `data-testid="graph-toggle-debug-entity-types"`, `toggleShowDebugEntityTypes` (3 refs: subscription + onCheckedChange + Logger.info template).

## Success Criteria (Plan-Level)

- [x] **VKBUI-03 SC#3 mechanics: default hide preserved.** Predicate test 1 (gate OFF → Observation excluded); Predicate test 5 (undefined OR missing field → still excluded).
- [x] **Runtime toggle re-enables.** Predicate tests 2 + 3 (gate ON → Observation and Digest become visible); GraphToggles test 2 (clicking the row flips the store).
- [x] **Tooltip surfaces the warning.** GraphToggles test 3 — verbatim `Architecture-bleed shield: these types should not appear in production VKB. Toggle ON only for debugging.` copy plus D-21 micro-type tokens.
- [x] **No localStorage persistence (D-11).** Store test 3 (comment-stripped source-grep for `persist(` / `partialize` / `localStorage` — all clean). GraphToggles test 4 (rendered DOM carries no `data-persist` attribute).
- [x] **Phase 56 viewport-stability.** The predicate gate is a single boolean check (`filters.showDebugEntityTypes !== true`); dep-array entries on the consumer memos are minimal additions, not contract changes. Tests for viewport-stability (D3 G9/G13 source-grep gates) were not touched, so the contract still holds. Visual smoke deferred — see Threat Flags below.

## Known Stubs

None. Every new field is wired end-to-end:
- Store field has default + toggle action + UI consumer.
- Predicate field is read defensively and gated.
- UI checkbox is bound to the store action via `onCheckedChange`.
- Logger.info instrumentation flows to FILTERS log channel.

## Threat Flags

None new. The plan's `<threat_model>` enumerated T-60-03-01 / T-60-03-02 / T-60-03-03; this implementation closes T-60-03-02 (non-persistent — verified by Store test 3) and T-60-03-03 (defensive `!== true` + REQUIRED field — verified by Predicate test 5 + `tsc --noEmit`). T-60-03-01 is `accept` per the plan.

## Self-Check: PASSED

All claimed file paths exist on disk in the worktree:
- `integrations/unified-viewer/src/store/viewer-store.ts` — present (`showDebugEntityTypes` and `toggleShowDebugEntityTypes` at lines 309/321/889/976).
- `integrations/unified-viewer/src/store/viewer-store.test.ts` — present (Phase 60-03 describe block at the end).
- `integrations/unified-viewer/src/graph/visibility-predicate.ts` — present (gate at line ~86, REQUIRED field at line ~53).
- `integrations/unified-viewer/src/graph/visibility-predicate.test.ts` — present (gate describe block at end).
- `integrations/unified-viewer/src/graph/useVisibleEntityIds.ts` — present (3 refs to `showDebugEntityTypes`).
- `integrations/unified-viewer/src/graph/D3GraphCanvas.tsx` — present (3 refs).
- `integrations/unified-viewer/src/panels/filters/GraphToggles.tsx` — present (label + tooltip at lines ~178/185).
- `integrations/unified-viewer/src/panels/filters/GraphToggles.test.tsx` — present (Phase 60-03 describe block at end).
- `integrations/unified-viewer/src/panels/filters/LayerFilter.test.tsx` — present (predicateFilters helper updated).

All claimed commits exist in `git log --oneline -8`:
- `5e4be3503` test(60-03): RED Task 1
- `6a4473794` feat(60-03): GREEN Task 1
- `26e72afc0` test(60-03): RED Task 2
- `9d7c00073` feat(60-03): GREEN Task 2

## Next Phase Readiness

- VKBUI-03 closed. The default architecture-bleed shield is preserved; operators have a one-click escape hatch with a clear in-UI warning about why the default is what it is.
- No follow-up work created. The plan's `<deferred_items>` line ("If operators end up flipping this constantly during debugging sessions, add localStorage + persistence in a follow-up") is documented in `60-CONTEXT.md` line 188 and stays deferred — not actionable until usage telemetry exists.

---
*Phase: 60-unified-viewer-rendering-ux-integrity*
*Plan: 03*
*Completed: 2026-06-17*
