---
phase: 86
slug: timeline-v2-and-declutter
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-10
---

# Phase 86 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `86-RESEARCH.md` § Validation Architecture. The two pure algorithm
> modules (`run-align`, `loop-heuristic`) are the Nyquist test seams; all UI
> behavior is verified via Playwright + gsd-browser visual check on `:3032`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Root **Jest 29.7 + ts-jest 29.4 (ESM)** for pure-TS modules; **Playwright 1.58** at `tests/e2e/` for UI. Dashboard package has no unit runner of its own — Wave 0 decision (A5/OQ2): reuse root Jest, or add a minimal `vitest.config.ts` to the dashboard if root Jest can't import the dashboard TS cleanly. |
| **Config file** | Root Jest via `package.json` `test` (`NODE_OPTIONS='--experimental-vm-modules' jest`); E2E `tests/e2e/` (`npx playwright test`) |
| **Quick run command** | `npm test -- run-align loop-heuristic` |
| **Full suite command** | `npm test` + `npx playwright test tests/e2e/dashboard/performance*.spec.ts` |
| **Estimated runtime** | ~5s quick (pure modules) · ~2–4 min full (incl. e2e) |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- run-align loop-heuristic` + `npm run build` in the dashboard (tsc typecheck).
- **After every plan wave:** Run `npm test` + `npx playwright test tests/e2e/dashboard/performance*.spec.ts`.
- **Before `/gsd-verify-work`:** Full suite green **AND** gsd-browser visual verification on `:3032` (CLAUDE.md mandate — never claim "works" from DB/unit alone; feedback_e2e_verify, feedback_dashboard_screenshots_gsd_browser).
- **Max feedback latency:** ~5 seconds (quick), ~4 min (full).

---

## Per-Task Verification Map

> Task IDs are placeholders until the planner assigns them; Requirement column
> uses the CONTEXT decision IDs (D-01..D-12) + the requirements the phase
> satisfies (DASH-02, VALID-01/ATTR-02). Planner MUST map each row to real task IDs.

| Task (planner-assigned) | Wave | Requirement | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|-------------|-----------------|-----------|-------------------|-------------|--------|
| align-module | 0/1 | D-07 | `alignRuns` returns correct `prefixLen`/`firstDivergence` for a fixture rerun-pair | unit | `npm test -- run-align` | ❌ W0 | ⬜ pending |
| align-identical | 0/1 | D-07 | Identical runs → `firstDivergence === null`, full prefix collapse | unit | `npm test -- run-align` | ❌ W0 | ⬜ pending |
| align-resync | 0/1 | D-07 | LCS re-syncs a re-converging tail (insert in B, then match) | unit | `npm test -- run-align` | ❌ W0 | ⬜ pending |
| loop-module | 0/1 | D-09 | `loopFlags` flags a non-adjacent windowed repeat, ignores out-of-window + pure-reasoning turns | unit | `npm test -- loop-heuristic` | ❌ W0 | ⬜ pending |
| turn-modal | 2 | D-01/D-02 | Turn row opens modal; fullscreen route renders whole timeline | e2e | `npx playwright test tests/e2e/dashboard/performance.spec.ts` | ⚠ extend | ⬜ pending |
| compare-select | 2 | D-08 | Multi-select 2 runs → "Compare selected" opens diff viewer | e2e | `npx playwright test tests/e2e/dashboard/performance-compare.spec.ts` | ⚠ extend | ⬜ pending |
| inline-score | 2 | D-11 | Inline score edit issues PATCH; server-invalid value rejected (contract preserved) | e2e | `npx playwright test tests/e2e/dashboard/performance.spec.ts` | ⚠ extend | ⬜ pending |
| recon-badge | 2 | D-12 | Reconciliation badge renders reconciled/discrepancy/fallback; absent → no badge | e2e | `npx playwright test tests/e2e/dashboard/performance.spec.ts` | ⚠ extend | ⬜ pending |
| cache-honest | 2 | D-05 | OpenAI-wire turn renders `CACHE_WRITE_NA`, not 0, in the band overlay | e2e (visual+text) | gsd-browser screenshot + grep string | ⚠ new | ⬜ pending |
| tier-survives | 2 | DASH-02 | Tier badge + reasoning sub-bands survive the v2 evolution | e2e | `npx playwright test` (assert `granularity-tier-badge`, `timeline-reasoning-step`) | ⚠ extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `run-align.ts` — pure alignment module (normalized tool-call signature + prefix walk + LCS pairs), dependency-free
- [ ] `loop-heuristic.ts` — pure windowed fuzzy repeat detector, shares `turnSignature` with `run-align`
- [ ] Test home decision: confirm root Jest can import the two `.ts` modules, OR add a minimal `vitest.config.ts` to the dashboard (resolve A5/OQ2 first)
- [ ] Fixture run-pairs as `ContextTurnRow[]` JSON: (a) identical runs, (b) rerun that diverges at turn N then re-converges, (c) a known-looping run
- [ ] Verify one real `context-turns.jsonl` granularity vs timeline parent count (resolve A3/OQ1) before locking align granularity
- [ ] Extend `tests/e2e/dashboard/performance.spec.ts` + `performance-compare.spec.ts` for D-01/D-02/D-08/D-11/D-12

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Cumulative context-growth band tells the "why did this run cost more" story legibly | D-04 | Visual legibility / storytelling judgement not assertable | gsd-browser screenshot of fullscreen band on a long run at `:3032`; confirm category segments + cache overlay read cleanly |
| Difference viewer's collapsed identical-prefix + first-divergence highlight is comprehensible | D-07 | Aggregate UX judgement across a real rerun pair | gsd-browser: open two paired runs, confirm prefix collapsed and divergence visually obvious |
| Loop badge is advisory (helpful, not crying wolf) on real runs | D-09 | Precision/recall tuning judgement on live data | gsd-browser: inspect a known-looping run + a clean run; badge present on former, absent on latter |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (the two pure modules + fixtures)
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s (quick) / < 4 min (full)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
