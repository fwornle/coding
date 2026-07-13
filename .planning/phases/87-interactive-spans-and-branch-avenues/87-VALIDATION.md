---
phase: 87
slug: interactive-spans-and-branch-avenues
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-11
---

# Phase 87 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Scoped to the gap-closure plans (87-07, 87-08). Plans 87-01..87-06 already
> shipped their own tests (avenue-branch: 12/12 live-git; runCell/synthesizeAvenueSpec
> unit tests; performance-compare.spec.ts collection-gated). Extracted from
> 87-RESEARCH.md §Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework (host lib)** | `node --test` (`.mjs` unit tests under `tests/experiments/`) |
| **Framework (dashboard)** | Vite `npm run build` typecheck + Playwright e2e (`performance.spec.ts`, `performance-compare.spec.ts`) + `gsd-browser` visual verify on `:3032`. No jsdom/component-unit harness (Wave 0 gap accepted — no package install). |
| **Config file** | `tests/` conventions; tests live under `tests/experiments/`, never `lib/**` |
| **Quick run command** | `node --test tests/experiments/*.test.mjs` |
| **Full suite command** | `node --test tests/experiments/*.test.mjs` + `cd integrations/system-health-dashboard && npm run build` (+ `npx playwright test` for e2e) |
| **Estimated runtime** | ~30–60 seconds (host `node --test`); dashboard build ~60–120s |

---

## Sampling Rate

- **After every task commit:** Run the touched module's `node --test` (host) OR `npm run build` (dashboard).
- **After every plan wave:** Full `node --test tests/experiments/*.test.mjs` + dashboard `npm run build`.
- **Before `/gsd-verify-work`:** Full suite green + `gsd-browser` visual verify of the origin-grouped Avenues panel in both themes.
- **Max feedback latency:** ~120 seconds.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 87-07-01 | 07 | 1 | AVN-01/02 | — | runMatrix threads `avenue`/`originSpanId`/`commitAvenue` into `runCell`; `experiment-run.mjs` parses `--avenue`/`--origin-span-id`; `run-launch.mjs buildRunArgv` passthrough | unit | `node --test tests/experiments/experiment-runner.test.mjs tests/experiments/run-launch.test.mjs` | ✅ | ⬜ pending |
| 87-07-02 | 07 | 1 | AVN-02/03 | — | `handleExperimentRun` reads `origin_span_id`+`forkAxes`, calls `synthesizeAvenueSpec`+persists spec; coordinator forwards origin-aware body | unit | `node --test $(grep -rl "handleExperimentRun\|experiments/run" tests)` | ✅ | ⬜ pending |
| 87-07-03 | 07 | 1 | AVN-03/07 | — | Client sends `forkAxes`/`sweep` in launch payload; `previewCellCount` server-resolved (axes-aware), not sourced from `selectedSpec.variantCount` | build typecheck | `cd integrations/system-health-dashboard && npm run build` | ✅ | ⬜ pending |
| 87-07-04 | 07 | 1 | AVN-01/07 | — | End-to-end thread assertion: an avenue-mode launch yields a Run row carrying a non-null `origin_span_id` that `selectAvenuesByOrigin` groups | integration | `node --test tests/experiments/avenue-fork-thread.test.mjs` | ❌ W0→created by task | ⬜ pending |
| 87-08-01 | 08 | 2 | AVN-01/02/03/07 | — | Both misleading comments corrected; REQUIREMENTS.md gains AVN-01..09 section | source assertion + build | `grep -cE "AVN-0[1-9]" .planning/REQUIREMENTS.md && ! grep -q "shape WHAT is forked" …/experiment-launcher.tsx && npm run build` | ✅ | ⬜ pending |
| 87-08-02 | 08 | 2 | AVN-01/02/03/07 | T-87-08-01 (Repudiation) | Live main-tree dashboard fork produces a ranked, origin-grouped avenue row with outcome score + git merge badge, verified via `gsd-browser` in both themes | e2e / manual gate | `gsd-browser` screenshots (BLOCKING checkpoint — DB-query claim forbidden) | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `tests/experiments/avenue-branch.test.mjs` — worktree create + prune primitives (AVN-05/09) — **already exists (12/12 live-git pass, Plan 87-01)**
- [x] Cross-branch double-count integration test — span→MAIN + task_id isolation (AVN-06) — **already exists (Plan 87-03)**
- [x] Injection-toggle env threading test (AVN-04) — **already exists (Plan 87-02)**
- [x] Merge-status git-compute unit test (AVN-08) — **already exists (Plan 87-04)**
- [ ] `tests/experiments/avenue-fork-thread.test.mjs` — end-to-end origin_span_id thread assertion (created by task 87-07-04; the gap-closure Wave 0 item)

*The five original Wave-0 items are satisfied by plans 87-01..87-06. The one new Wave-0 item is the end-to-end thread test that proves the CR-01/CR-02/CR-03 fix, created within task 87-07-04.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Origin-grouped ranked Avenues panel renders a real forked Run with outcome score + git merge badge, in both light and dark themes | AVN-07 (composite AVN-01/02/03) | Requires live e2e against a genuinely forked Run with real measurement data; the dashboard is bind-mounted from main-tree, so the fix must land on main + be rebuilt before the panel has data. No component-unit harness exists (accepted Wave-0 gap). | Rebuild dashboard (`npm run build` in `integrations/system-health-dashboard` → `docker exec coding-services supervisorctl restart web-services:health-dashboard-frontend`), navigate to Performance ▸ Avenues, fork a completed span with a non-default agent/model axis, wait for completion, confirm a ranked origin-grouped row appears with a non-em-dash outcome score + merge badge, in both themes. Capture `gsd-browser` screenshots. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (four pre-existing; one new fork-thread test created in 87-07-04)
- [x] No watch-mode flags
- [x] Feedback latency < 120s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
