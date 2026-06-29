---
phase: 75-measurement-attribution-accuracy-observation-linkage
plan: 04
subsystem: measurement-stop-orchestration
tags: [measurement-stop, canonical-attribution, foreground-capture, background-segregation, bypass-guard, attr-01, attr-02, attr-03, wave-3]

# Dependency graph
requires:
  - phase: 75-measurement-attribution-accuracy-observation-linkage
    plan: 02
    provides: "isForegroundGroup (fg/bg classifier) + writeRun canonical_model/canonical_agent/background_models metadata fields"
  - phase: 75-measurement-attribution-accuracy-observation-linkage
    plan: 03
    provides: "captureForegroundTokens(span, opts) + STOP_ADAPTERS per-agent registry (claude transcript; copilot/opencode/mastra stamp-only)"
provides:
  - "Stop orchestrator captures foreground tokens BEFORE aggregation (cladpt rows exist at sum time)"
  - "Canonical = fgGroups[0] (foreground chat agent) or null — the finding-B dominant=byAgentModel[0] selector is deleted"
  - "background_models[] (segregated non-foreground daemons) passed into writeRun tags/metadata on every real close"
  - "A1 Anthropic-direct bypass-guard: non-fatal stderr WARN when an in-scope agent has neither proxy nor adapter rows"
affects: [75-06-dashboard-two-column]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Capture-then-sum ordering: captureForegroundTokens runs BEFORE aggregateByTaskId so the proxy-bypassing foreground (claude) is in token_usage when the fg/bg breakdown sums"
    - "Canonical-from-foreground-only: canonical derived from the first isForegroundGroup match (or null), never the dominant-by-count row — null is meaningful, not a dominant fallback (D-05)"
    - "Best-effort-on-the-close: foreground capture wrapped in try/catch → process.stderr.write, matching the (4.5) score path; the close never hard-blocks (T-75-42)"
    - "Repudiation-visibility guard: A1 emits ONE stderr warning so uncaptured-on-bypass tokens are visible rather than silently lost (T-75-43)"

key-files:
  created: []
  modified:
    - scripts/measurement-stop.mjs

key-decisions:
  - "foregroundAgent = span.agent ?? span.meta?.agent ?? 'claude' — the interactive Claude session is the default foreground; capture dispatches via STOP_ADAPTERS (claude→transcript, others→stamp-only no-op)"
  - "The finding-B canonical bug (dominant = byAgentModel[0]) plus the now-unused normAgent were deleted; buildTraceSeam/buildNormalizedTrace are fed canonicalAgent (the foreground family) where they previously consumed normAgent — the time-window Claude locator is still valid"
  - "Bypass-guard scoped to an explicit IN_SCOPE_AGENTS set {claude,copilot,opencode,mastra}; fires only when BOTH byAgentModel and fgGroups are empty (neither proxy nor adapter rows), reusing already-computed data — no new query"

requirements-completed: [ATTR-01, ATTR-02, ATTR-03]

# Metrics
duration: 4min
completed: 2026-06-29
---

# Phase 75 Plan 04: Measurement-Stop Canonical/Background Wiring Summary

**Wires Plan 02's fg/bg derivation and Plan 03's foreground capture into `measurement-stop.mjs` — the single close convergence point — so every newly-closed Run captures foreground tokens first, derives canonical from the foreground chat agent (never the dominant daemon), segregates background models, and warns on a possible Anthropic-direct proxy bypass; the finding-B `dominant = byAgentModel[0]` selector is removed.**

## Performance
- **Duration:** ~4 min
- **Completed:** 2026-06-29
- **Tasks:** 2
- **Files modified:** 1 (0 created, 1 modified)

## Accomplishments
- **Task 1 (ATTR-01/02/03 — D-03/D-05/D-06 wiring):** Imported `isForegroundGroup` (token-aggregate) and `captureForegroundTokens` (stop-adapter-registry) into the close orchestrator. Added a best-effort `await captureForegroundTokens(span, { agent: foregroundAgent })` BEFORE `aggregateByTaskId(span.task_id)` so the proxy-bypassing foreground (claude) is recorded as cladpt rows when the breakdown sums. After aggregation: `fgGroups = byAgentModel.filter(isForegroundGroup)`, `bgGroups = byAgentModel.filter(g => !isForegroundGroup(g))`, `canonical = fgGroups[0] ?? null`, `canonicalModel`, `canonicalAgent = canonical ? normalizeAgent(canonical) : null`, and `backgroundModels = bgGroups.map(...)`. **DELETED** the finding-B `const dominant = byAgentModel[0]` selector and the now-dead `normAgent`. The `tags` object now sets `agent: canonicalAgent`, `model: canonicalModel`, `framework: span.meta?.framework ?? canonicalAgent`, and ADDS `canonical_model`, `canonical_agent`, `background_models` — flowing through into `writeRun`'s Run.metadata (the Plan 02 fields). `buildTraceSeam`/`buildNormalizedTrace` are fed `canonicalAgent` where they previously consumed `normAgent`.
- **Task 2 (A1 bypass-guard):** After the fg/bg split, added a non-fatal stderr warning that fires ONLY when an in-scope agent (`{claude,copilot,opencode,mastra}`) ran with NEITHER proxy rows (`byAgentModel.length === 0`) NOR adapter rows (`fgGroups.length === 0`) — the network-dependent Anthropic-direct bypass case. Reuses already-computed `byAgentModel`/`fgGroups` (no new query); warning only, never blocks the close.

## Task Commits
1. **Task 1: capture-then-derive canonical/background at stop (D-03/D-05/D-06)** — `6cfeda9c4` (feat)
2. **Task 2: A1 Anthropic-direct bypass-guard warning at stop** — `4090922dc` (feat)

## Files Created/Modified
- `scripts/measurement-stop.mjs` — imports for `isForegroundGroup` + `captureForegroundTokens`; new (3.0) capture-before-sum block; (3.1) fg/bg split → canonical/backgroundModels; (3.2) A1 bypass-guard; `tags` carry the three canonical fields; `dominant`/`normAgent` removed; trace seam fed `canonicalAgent`.

## Decisions Made
- **Foreground agent default.** Per the plan action, `foregroundAgent = span.agent ?? span.meta?.agent ?? 'claude'` — an interactive Claude session is the default. `captureForegroundTokens` itself dispatches via `STOP_ADAPTERS`, so a stamp-only/unknown agent is a zero-work no-op (the D-04 double-count guard stays upstream).
- **Comment reword to honor the acceptance grep.** The Task-1 acceptance criterion `grep -n "byAgentModel\[0\]\|const dominant"` must return NOTHING. An explanatory comment originally contained the literal `byAgentModel[0]`; it was reworded to "the dominant-by-count row" so the grep gate reflects the real (deleted) selector. This is documentation precision, not constraint-dodging — the rejected selector is genuinely gone from the code.
- **Bypass-guard split into its own commit.** The guard code shares the fg/bg block computed in Task 1; to keep per-task atomic commits matching the plan structure, the guard was removed before the Task-1 commit and re-added for the Task-2 commit.

## Deviations from Plan
None — plan executed as written. (The comment reword above is acceptance-grep precision, documented under Decisions, not a behavioral deviation.)

## Threat Surface
No new trust boundaries. T-75-41 (canonical derived only from `isForegroundGroup`, denylist-guarded), T-75-42 (capture + score path both best-effort; close never hard-blocks), T-75-43 (A1 guard makes proxy-bypass token loss visible), T-75-SC (no new packages) all hold as designed.

## Known Stubs
None. The capture, fg/bg split, canonical derivation, and writeRun tag-passing are all wired to real data paths. A `null` canonical (no foreground group) is the intended D-05 "unmeasured" state, not a stub.

## Self-Check: PASSED
- Modified file exists: `scripts/measurement-stop.mjs` — present.
- Commits exist: `6cfeda9c4`, `4090922dc` — both in `git log`.
- Acceptance: `node --test tests/lsl/token/stop-adapter-registry.test.mjs tests/experiments/canonical-attribution.test.mjs` → 9 pass / 0 fail / 1 skipped (live-gated); `node --check scripts/measurement-stop.mjs` → valid; `grep "byAgentModel\[0\]\|const dominant"` → empty; `grep "Anthropic-direct bypass"` → present.

---
*Phase: 75-measurement-attribution-accuracy-observation-linkage*
*Completed: 2026-06-29*
