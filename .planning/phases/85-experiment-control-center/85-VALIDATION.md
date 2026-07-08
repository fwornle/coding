---
phase: 85
slug: experiment-control-center
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-08
---

# Phase 85 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `85-RESEARCH.md` §Validation Architecture + the 6 committed plans.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node built-in test runner (`node:test` + `node:assert/strict`) for `tests/experiments/*.test.mjs`; Playwright for `tests/e2e/`; `npx tsc --noEmit` for dashboard TS |
| **Config file** | none for experiment tests (run via `node --test tests/experiments/`); `playwright.config` for e2e |
| **Quick run command** | `node --test <the touched experiment test file>` |
| **Full suite command** | `node --test tests/experiments/` |
| **Estimated runtime** | ~30 seconds (experiment suite); e2e spec ~60s |

> Existing experiment tests use `node:test` + `Object.create(ApiRoutes.prototype)` handler-isolation with an injected `experimentRepoRoot` (see `tests/experiments/runs-endpoint.test.mjs:29-31`). Seed fixture: `tests/experiments/_fixtures/seed-experiment-store.mjs`. New endpoint tests MUST follow this idiom.

---

## Sampling Rate

- **After every task commit:** Run `node --test <the touched experiment test file>` (dashboard tasks: `npx tsc --noEmit` scoped grep)
- **After every plan wave:** Run `node --test tests/experiments/`
- **Before `/gsd-verify-work`:** Full experiment suite green + Playwright e2e spec green + live `gsd-browser` :3032 launch→monitor→cancel click-through (feedback_e2e_verify: never claim UI works from DB queries)
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 85-01-01 | 01 | 1 | D-03/D-04 | plan-01 TM | never-throw emitter; atomic tmp+rename write | unit | `node --test tests/experiments/run-progress.test.mjs tests/experiments/experiment-runner.integration.test.mjs` | ❌ W0 (integration ✅ must stay green) | ⬜ pending |
| 85-01-02 | 01 | 1 | D-05/D-07 | plan-01 TM | null-preserved rerun_of/base_variant tags; task_hash constant | unit | `node --test tests/experiments/run-write.test.mjs tests/experiments/measurement-stop-tags.test.mjs` | ⚠️ extend existing | ⬜ pending |
| 85-01-03 | 01 | 1 | D-06/D-12 | plan-01 TM | capture_raw_bodies strict opt-in; salted run_id path-safe (≤12 salt) | unit | `node --test tests/experiments/measurement-start-variant.test.mjs` | ❌ W0 | ⬜ pending |
| 85-02-01 | 02 | 1 | D-01 | T: argv injection | fixed-argv detached spawn, no shell strings | unit | `node --test tests/experiments/run-launch.test.mjs` | ❌ W0 | ⬜ pending |
| 85-02-02 | 02 | 1 | D-08 | T: pid reuse | `process.kill(-pid)` group kill + pid-reuse sanity guard | unit | `node --test tests/experiments/run-launch.test.mjs` | ❌ W0 | ⬜ pending |
| 85-03-01 | 03 | 2 | D-01/D-02 | T: container→host EoP | executor endpoints validate run_id charset; spawn only listed specs | unit | `node --test tests/experiments/experiment-executor.test.mjs` | ❌ W0 | ⬜ pending |
| 85-03-02 | 03 | 2 | D-08 | T: cancel escape | cancel clears stale `active-measurement.json` (OQ3); terminal progress patch | unit | `node --test tests/experiments/experiment-executor.test.mjs` | ❌ W0 | ⬜ pending |
| 85-04-01 | 04 | 3 | D-02 | T: path traversal | 409 dual-source guard names holder; traversal 400; unlisted-spec 400 | unit | `node --test tests/experiments/run-endpoint.test.mjs` | ❌ W0 | ⬜ pending |
| 85-04-02 | 04 | 3 | D-04/D-09 | T: verbatim-serve leak | run-status graceful-ENOENT; spec-list resolveExperimentSpec preview | unit | `node --test tests/experiments/run-status-endpoint.test.mjs tests/experiments/spec-list-endpoint.test.mjs` | ❌ W0 | ⬜ pending |
| 85-05-01 | 05 | 4 | D-10 | — | typed thunks reject with holder message on 409 | type | `npx tsc --noEmit` (performanceSlice scope) | ✅ tsc exists | ⬜ pending |
| 85-05-02 | 05 | 4 | D-09/D-12 | — | launcher never edits specs; capture checkbox default OFF | type | `npx tsc --noEmit` (experiment-launcher scope) | ✅ tsc exists | ⬜ pending |
| 85-05-03 | 05 | 4 | D-10/D-11 | — | monitor grid + Re-run pre-fill | type | `npx tsc --noEmit` (run-monitor/runs-table scope) | ✅ tsc exists | ⬜ pending |
| 85-06-01 | 06 | 5 | D-09..D-12 | — | proxy passthrough curl-verified before edit; e2e structure spec | e2e | `npx playwright test tests/e2e/performance/experiment-control.spec.ts` | ❌ W0 | ⬜ pending |
| 85-06-02 | 06 | 5 | all | — | live launch→monitor→cancel→re-run→capture gate | manual (checkpoint) | human-verify gate via gsd-browser :3032 | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/experiments/run-progress.test.mjs` — atomic write + never-throw emitter (D-03/D-04)
- [ ] `tests/experiments/run-launch.test.mjs` — fixed-argv spawn, `process.kill(-pid)` group kill, pid-reuse guard (D-01/D-08)
- [ ] `tests/experiments/experiment-executor.test.mjs` — coordinator seam delegate + stale-span clear (D-01/D-02/D-08)
- [ ] `tests/experiments/run-endpoint.test.mjs` — 409 guard + delegate-spawn (mock host-executor seam) (D-02)
- [ ] `tests/experiments/run-status-endpoint.test.mjs` — verbatim serve + ENOENT + traversal guard (D-04)
- [ ] `tests/experiments/spec-list-endpoint.test.mjs` — resolveExperimentSpec preview (D-09)
- [ ] extend `tests/experiments/run-write.test.mjs` — rerun_of / base_variant tags (D-05/D-07)
- [ ] `tests/experiments/measurement-start-variant.test.mjs` — capture_raw_bodies + base_variant passthrough (D-06/D-12)
- [ ] `tests/e2e/performance/experiment-control.spec.ts` — launcher + monitor + Re-run (Playwright, `tests/e2e/<area>/` per CLAUDE.md)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live detached run survives vkb-server/coordinator restart; real agent cells execute | D-01 | Needs real agent CLIs + live proxy on host; implicitly exercises pending Phase-78 78-05 live gate | Plan 06 Task 2 checkpoint: launch from :3032 dashboard, restart vkb-server mid-run, verify monitor recovers; cancel a second run and verify group death + 409 slot frees |
| capture_raw_bodies produces `raw-bodies.jsonl.gz` for an experiment cell | D-12 | Requires live proxy write path | Launch with capture ON; after span close verify `.data/measurements/<task_id>/raw-bodies.jsonl.gz` exists and OFF-run has none |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
