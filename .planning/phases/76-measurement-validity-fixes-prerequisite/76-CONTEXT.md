# Phase 76: Measurement Validity Fixes [PREREQUISITE] - Context

**Gathered:** 2026-07-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the three attribution/route/score correctness gaps the `exp-dash-start-control` pilot (2026-06-29) exposed actually hold on current code, so a cross-variant A/B comparison (the v7.5 runner) produces trustworthy numbers. Scope is the three requirements VALID-01/02/03 — **corrections to already-shipped v7.4 code**, not new measurement features. This phase is the prerequisite gate: it must land and verify before the runner phases (77–80) are trusted.

Explicitly NOT in scope: the experiment spec, the runner, the comparison report, the dashboard variant columns (Phases 77–80). No new measurement dimensions.

</domain>

<decisions>
## Implementation Decisions

### VALID-01 — Model attribution (verify + close residual read-paths)
- **D-01:** The canonical=foreground-not-dominant fix is treated as **already implemented** in `scripts/measurement-stop.mjs:335-345` (Phase 75). Do NOT re-implement it. This phase VERIFIES it and closes the remaining read-paths that still diverge.
- **D-02:** The dashboard is **already correct** — `runs-table.tsx`, `timeline.tsx`, and `run-compare.tsx` all render `run.canonical_model` with an `'unmeasured'` fallback (never dominant). No dashboard change required.
- **D-03:** The **one residual read-path to fix** is `scripts/experiments-recompute-route.mjs:111` — `model: m.model ?? dominant.model ?? null` still falls back to `dominant` (`byAgentModel[0]`, the by-count winner = the finding-B bug). Align it with the stop-path canonical logic: never fall back to the dominant-by-count group; prefer the run's already-persisted `canonical_model`, else the foreground-not-dominant group, else null.
- **D-04:** Acceptance is a **live verification** on a fresh measured Opus session (per `feedback_perf_measurement_requirements` / `feedback_e2e_verify` — never DB-only): the runs table, score drawer, and timeline must all show Opus (not `claude-haiku-4.5`). Fix only what this verification proves still broken.

### VALID-02 — Route time math (exclude idle)
- **D-05:** Redefine `wallclockPerStep` (`lib/experiments/route-heuristics.mjs:82`) from the naïve `(lastTerminal − firstStart) / count` to a **sum of active inter-event gaps ÷ step count**, excluding operator-thinking/AFK pauses. This kills the ~28,000 s/step artifact over long interactive windows.
- **D-06:** The idle threshold is **configurable, default 5 minutes** (a named constant with an env override). Inter-event gaps longer than the threshold are idle → excluded from active time. 5 min matches the AskUserQuestion/steering boundary and the repo's existing ETM/health idle heuristics. No separate per-step outlier cap — excluding idle is sufficient.
- **D-07:** Metric stays deterministic and pure (no LLM). Preserve the single-event and empty-trace edge cases already handled.

### VALID-03 — Non-GSD rubric coverage (derive from diff + run task test cmd)
- **D-08:** Extend `lib/experiments/evidence-harness.mjs` so that when GSD artifacts (`VERIFICATION.md`/`REVIEW.md`) are absent, it derives the missing dimensions from: (a) the working-tree **diff** (already read via `git diff --stat`) → `code_quality` signal (churn/size/file-count); (b) **running the task's test command** → `test_coverage`/`regressions` from exit code + pass/fail counts.
- **D-09:** The test command comes from an optional **run-metadata `test_command` field** (settable at `measurement-start`, and later by the Phase-77 experiment spec); if absent, **fall back to the repo's `package.json` `"test"` script**. This is forward-compatible with Phase 77's SPEC and works today.
- **D-10:** Test execution follows the harness's existing exec idiom — **fixed-argv `spawnSync`, fail-soft** (never a shell string; a failed/missing test run yields null for that dim, NEVER a guessed 0, preserving the D-01 strict-null-calibration the harness already documents).
- **D-11:** A dimension stays **null only when genuinely no signal exists** (no diff AND no runnable test) — not merely because GSD files are absent.

### Claude's Discretion
- Exact `code_quality`-from-diff heuristic (which churn/size features, thresholds) — planner/executor choose, keeping it deterministic and documented.
- Whether the idle constant lives in `route-heuristics.mjs` or a shared config module — implementer's call, as long as it's a single named source with an env override.
- Test-output parsing specifics (which runners' pass/fail formats to recognize) — start with the repo's own (`node --test` / jest) and fail-soft on anything unrecognized.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Root-cause diagnosis (the pilot findings that define this phase)
- `.planning/v7.4-attribution-findings.md` — findings A–D from the `exp-dash-start-control` dogfood run; the source of O1/O2/O3. Read FIRST.
- `.data/experiments/exp-dash-start-control-claude-opus-4-8.log.md` — the pilot run log (observations O1–O5, the haiku-for-Opus evidence, the ~28k s/step artifact).

### Fix sites (current shipped code)
- `scripts/measurement-stop.mjs` §320-360 — canonical fg/bg-split model logic (VALID-01, already fixed here; the reference implementation to align the route path to).
- `scripts/experiments-recompute-route.mjs` §105-116 — the `dominant.model` fallback to fix (VALID-01, D-03).
- `lib/experiments/route-heuristics.mjs` §70-110 (`wallclockPerStep`) — VALID-02 fix site.
- `lib/experiments/evidence-harness.mjs` — VALID-03 fix site; note the existing fixed-argv `spawnSync('git', ['diff','--stat'])` fail-soft exec idiom (§147-192) to mirror for the test-command run.
- `lib/experiments/score-write.mjs` §42-140 — the 5 locked rubric dims + strict null-never-zero calibration the harness feeds.

### Requirements + comparison-key
- `.planning/REQUIREMENTS.md` — v7.5 block (VALID-01/02/03 acceptance text).
- `.planning/ROADMAP.md` — Phase 76 section (goal + success criteria).

### Standing constraints
- `CLAUDE.md` — no-console-log (harness uses `process.stderr.write` only, NOT to dodge the rule but because it's diagnostics), TypeScript strict, constraint-dodging forbidden.
- `memory/feedback_perf_measurement_requirements.md` — the hard deliverable contract (per-tool-call attribution, all agents).
- `memory/feedback_e2e_verify.md` — VALID-01 acceptance must be a live session, never a DB query alone.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `scripts/measurement-stop.mjs` canonical fg/bg-split — the exact model-selection logic the route recompute path must reuse (don't reinvent).
- `evidence-harness.mjs` fixed-argv `spawnSync` + fail-soft `readSoft` idioms — the pattern for adding a test-command run without a shell injection risk.
- Dashboard `normalizeModel()` + `canonical_model` rendering — already consumes the corrected field; no UI work.

### Established Patterns
- **Null, never zero/guess** (score-write.mjs D-01 calibration) — every VALID-03 dimension must honor this: no signal → null.
- **Pure deterministic route heuristics** (no LLM in route-heuristics.mjs) — VALID-02 must stay pure.
- **Fixed-argv exec only** (CLAUDE.md constraint-dodging + evidence-harness comment) — VALID-03's test run must not build a shell string.

### Integration Points
- `run-write.mjs` persists `canonical_model` + `wallclock_per_step` — the corrected values flow through here unchanged (schema already has the fields).
- `experiments-recompute-route.mjs` / `experiments-recompute-score.mjs` — the recompute CLIs are how existing Runs get re-derived after the fix; useful for regression-checking against the archived pilot span.

</code_context>

<specifics>
## Specific Ideas

- Regression anchor: re-run `experiments-recompute-route.mjs` / `-score.mjs` against the archived `exp-dash-start-control` span and confirm the corrected model (Opus, not haiku), a plausible per-step time, and non-null rubric dims — a concrete before/after on real pilot data.
- VALID-01 live check pairs naturally with the v7.5 work itself: this very session is a measured Opus interactive run — an honest fresh test case.

</specifics>

<deferred>
## Deferred Ideas

- Auto-routing / policy engine that consumes these corrected comparisons — reslotted to **v7.6** (`seeds/v74-policy-engine.md`).
- The experiment spec, runner, aggregation, and dashboard variant columns — Phases **77–80** (this phase deliberately only fixes measurement validity).
- Formal `/gsd-complete-milestone` close of v7.4 (also cleans the stale v7.4 traceability checkboxes) — separate housekeeping, not blocking Phase 76.

None of these are acted on in Phase 76.

</deferred>

---

*Phase: 76-measurement-validity-fixes-prerequisite*
*Context gathered: 2026-07-03*
