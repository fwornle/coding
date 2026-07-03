---
phase: 76-measurement-validity-fixes-prerequisite
plan: 01
subsystem: measurement
tags: [attribution, canonical-model, route-recompute, token-aggregate, experiments]

# Dependency graph
requires:
  - phase: 75-measurement-attribution-accuracy
    provides: "canonical foreground/background token split (isForegroundGroup) + measurement-stop.mjs canonical model selection (D-01)"
provides:
  - "experiments-recompute-route.mjs aligned to the canonical fg-not-dominant model selection — the last residual read-path (D-03) that still fell back to the dominant-by-count group is closed"
  - "recompute now threads canonical_model/canonical_agent/background_models through the tags object writeRun reads, so an idempotent re-close preserves the corrected model instead of regressing it to null"
affects: [76-04, cross-agent-comparison-runner, VALID-01]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Canonical model selection mirrored (not re-derived) from measurement-stop.mjs across every read-path: persisted canonical_model -> foreground-not-subagent group -> null, NEVER byAgentModel[0]"

key-files:
  created:
    - .planning/phases/76-measurement-validity-fixes-prerequisite/76-01-SUMMARY.md
  modified:
    - scripts/experiments-recompute-route.mjs

key-decisions:
  - "Threaded canonical fields via the tags object (not totals): run-write.mjs reads t.canonical_model where t = tags, so the plan's 'via totals.canonical_model' note was a mechanism inaccuracy — corrected to match what writeRun actually reads."
  - "canonical_model stays null when the current token DB has no foreground group for the task (D-05: unmeasured is never guessed and never coerced to the dominant haiku daemon)."

patterns-established:
  - "Every recompute/backfill CLI reuses isForegroundGroup from token-aggregate.mjs rather than re-deriving fg/bg classification."

requirements-completed: [VALID-01]

# Metrics
duration: 8min
completed: 2026-07-03
---

# Phase 76 Plan 01: Close the Residual Route-Recompute Model Read-Path Summary

**`experiments-recompute-route.mjs` no longer falls back to the dominant-by-count token group (`byAgentModel[0]`) — it now selects the canonical foreground-not-subagent model exactly as the stop path does, and threads `canonical_model` through `writeRun` so a re-close can never re-stamp a measured Opus run as the haiku daemon.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-07-03
- **Completed:** 2026-07-03
- **Tasks:** 1
- **Files modified:** 1 (source) + 1 (summary)

## Accomplishments
- Removed the `const dominant = byAgentModel[0]` by-count selector and both `?? dominant.model` / `?? dominant.agent` fallbacks (the finding-B bug: a 1.24M-token haiku daemon out-massed the Opus foreground and re-stamped the Run as haiku on every recompute).
- Installed the canonical fallback chain in exact precedence: (1) the Run's already-persisted `run.metadata.canonical_model` when non-null → (2) the foreground group that is NOT a captured sub-agent (`isForegroundGroup` filter, falling back to `fgGroups[0]`) → (3) `null`. Never `byAgentModel[0]`.
- Threaded `canonical_model` / `canonical_agent` / `background_models` into the `tags` object `writeRun` persists (run-write.mjs reads them off `tags`), fixing a latent regression where recompute would have re-nulled a Run's canonical attribution.
- Surfaced `canonical_model` in the dry-run diagnostic line so the Wave-2 regression anchor (76-04) can read the before/after model directly.

## Task Commits

1. **Task 1: Replace the dominant.model fallback with canonical fg-not-dominant selection** - `30e681209` (fix)

**Plan metadata:** committed with STATE/ROADMAP update (docs).

## Files Created/Modified
- `scripts/experiments-recompute-route.mjs` - Imports `isForegroundGroup`; canonical selection chain replaces the dominant-by-count fallback; canonical fields threaded through `tags` into `writeRun`; dry-run line now prints `canonical_model`.

## Decisions Made
- **Canonical fields threaded via `tags`, not `totals`.** The plan directed threading "via `totals.canonical_model` per run-write.mjs §118-119", but run-write binds `const t = tags` and reads `t.canonical_model` at §119 — `totals` is bound separately as `tot` and never carries canonical fields. Threading via `totals` would have been a silent no-op (canonical_model would persist as `null`). Set the canonical fields on the `tags` object to match what `writeRun` actually reads. Documented below as a Rule 1 deviation.
- **`declaredAgent` agent-only fallback** mirrors measurement-stop's `span.agent ?? span.meta?.agent` for the Anthropic-direct bypass (no fg group captured) — model stays null, agent is attributed to the declared foreground actor.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected the canonical-threading mechanism (tags, not totals)**
- **Found during:** Task 1
- **Issue:** The plan said to thread the resolved `canonical_model` "via `totals.canonical_model` per run-write.mjs §118-119". Reading run-write.mjs confirmed it binds `const t = tags ?? {}` and `const tot = totals ?? {}`, and §119 reads `t.canonical_model` (i.e. from `tags`). Setting `totals.canonical_model` would never be read — a re-close would still regress `canonical_model` to null, defeating the fix's purpose.
- **Fix:** Set `canonical_model` / `canonical_agent` / `background_models` on the `tags` object passed to `writeRun`. Verified against run-write.mjs §119-121 which reads all three off `t` (= tags).
- **Files modified:** scripts/experiments-recompute-route.mjs
- **Verification:** `node --check` passes; dry-run runs clean and prints `agent=claude canonical_model=null` (Claude/Opus lineage, never haiku).
- **Committed in:** `30e681209` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug — mechanism correction to make the fix actually persist).
**Impact on plan:** Necessary for correctness — without it the canonical value would never reach the store. No scope creep; still scoped to the single file per D-03.

## Issues Encountered
- The dry-run against the archived `exp-dash-start-control-claude-opus-4-8` span currently prints `canonical_model=null` because the live token DB has no foreground group rows for that task_id anymore. This is correct behavior (D-05: null persists as "unmeasured", never coerced to the dominant haiku daemon) and the critical bug — re-stamping as haiku — is fixed: the printed agent line is `claude`, not haiku. The full before/after Opus model assertion on real pilot data is the explicit Wave-2 regression anchor (76-04) per the plan's `<verification>`.

## Verification
- Acceptance grep: zero occurrences of `dominant.model` / `dominant.agent` (comments excluded) — PASS.
- `grep isForegroundGroup` present; `grep canonical_model` present — PASS.
- `node --check scripts/experiments-recompute-route.mjs` — PASS.
- No `console.log` introduced (only the pre-existing `no-console-log` doc-comment string matches) — stderr/stdout-only diagnostics preserved.
- `node scripts/experiments-recompute-route.mjs exp-dash-start-control-claude-opus-4-8 --dry-run` — exit 0, prints agent/steps line, `agent=claude` (Claude/Opus lineage, NOT `claude-haiku-4.5`).

## Next Phase Readiness
- D-03 (the one residual read-path) is closed. The route-recompute path now matches the stop path and `backfill-run-attribution.mjs`.
- Wave-2 (76-04) owns the full before/after model assertion on the archived pilot span (Opus, plausible per-step time, non-null rubric dims).
- No blockers.

## Self-Check: PASSED

- `scripts/experiments-recompute-route.mjs` — FOUND
- `.planning/phases/76-measurement-validity-fixes-prerequisite/76-01-SUMMARY.md` — FOUND
- Commit `30e681209` — FOUND

---
*Phase: 76-measurement-validity-fixes-prerequisite*
*Completed: 2026-07-03*
