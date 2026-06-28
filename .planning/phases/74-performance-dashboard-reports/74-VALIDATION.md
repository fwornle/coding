---
phase: 74
slug: performance-dashboard-reports
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-28
---

# Phase 74 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from 74-RESEARCH.md §Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework (experiment lib)** | `node:test` + `node:assert/strict` (the `tests/experiments/*` convention — NOT the jest default in package.json) |
| **Framework (dashboard E2E)** | Playwright (`playwright.config.ts`, `tests/e2e/dashboard/*.spec.ts`) + `gsd-browser` CLI for visual smoke (CLAUDE.md E2E-verify rule) |
| **Config file** | `playwright.config.ts` (E2E); none for node:test (per-file) |
| **Quick run command** | `node --test tests/experiments/<file>.test.mjs` |
| **Full suite command** | `node --test tests/experiments/` |
| **E2E command** | `npx playwright test tests/e2e/dashboard/performance.spec.ts` |
| **Estimated runtime** | ~10s experiment suite; ~30–60s E2E |

---

## Sampling Rate

- **After every task commit:** Run `node --test tests/experiments/<touched>.test.mjs`
- **After every plan wave:** Run `node --test tests/experiments/` (full experiment suite green)
- **Before `/gsd-verify-work`:** experiment suite green + `performance.spec.ts` green + a `gsd-browser` visual pass against `localhost:3032/performance`
- **Max feedback latency:** ~10 seconds (experiment unit suite)

---

## Per-Task Verification Map

> Plan/task IDs are assigned by the planner; this maps requirements → behaviors → automated commands. The planner must attach each row to its concrete task.

| Requirement | Behavior | Test Type | Automated Command | File Exists |
|-------------|----------|-----------|-------------------|-------------|
| DASH-01 | `readRuns` returns Runs joined to Score/Outcome; pending excluded by default | unit | `node --test tests/experiments/run-read.test.mjs` | ❌ W0 |
| DASH-01 | `GET /api/experiments/runs` returns rows from an isolated store (`experimentRepoRoot`) | unit | `node --test tests/experiments/runs-endpoint.test.mjs` | ❌ W0 |
| DASH-02 | `readTimeline(taskId)` groups per-reasoning-step under per-turn; readonly DB; graceful empty on missing file | unit | `node --test tests/experiments/timeline-read.test.mjs` | ❌ W0 |
| KB-04 | `writeReport` idempotent on `report_id`; `refreshReport` re-runs query + updates snapshot, same id | unit | `node --test tests/experiments/report-write.test.mjs` | ❌ W0 |
| DASH-03 | Report read renders the FROZEN snapshot (stable across underlying Run changes until Refresh) | unit | `node --test tests/experiments/report-snapshot.test.mjs` | ❌ W0 |
| SC#5 / SCORE-02 | Drawer Save round-trips through existing PATCH; corrected-wins reflected in `readRuns` | unit (endpoint ✅) + E2E | existing `tests/experiments/score-override-endpoint.test.mjs` + new Playwright | partial |
| DASH-01/02/03 | Performance tab renders; facets narrow runs; drawer opens; timeline expands; report saves | E2E (visual) | `gsd-browser navigate http://localhost:3032/performance` + `npx playwright test tests/e2e/dashboard/performance.spec.ts` | ❌ W0 |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

### Load-bearing correctness properties (must have explicit tests)

- **Snapshot stability (DASH-03):** Seed a Report from a query → mutate an underlying Run/Score → re-read Report → snapshot UNCHANGED. Then `refreshReport` → snapshot reflects the mutation. Proves D-04 "stable until Refresh".
- **Override round-trip (D-02/D-03):** PATCH a `corrected_*` dimension → `readRuns` → effective value = corrected, judged preserved, "edited" derivable. Reuses the seeding helper at `score-override-endpoint.test.mjs:40-70`.

---

## Wave 0 Requirements

- [ ] `tests/experiments/run-read.test.mjs` — DASH-01 read/join
- [ ] `tests/experiments/runs-endpoint.test.mjs` — DASH-01 endpoint (use `experimentRepoRoot` isolation like score-override-endpoint test)
- [ ] `tests/experiments/timeline-read.test.mjs` — DASH-02 (seed a tmp `token-usage.db` or point `dbPathOverride` at a fixture)
- [ ] `tests/experiments/report-write.test.mjs` + `tests/experiments/report-snapshot.test.mjs` — KB-04 / DASH-03
- [ ] `tests/e2e/dashboard/performance.spec.ts` — Playwright UI flow
- [ ] Shared seed helper: factor `seedIsolatedStore` (currently in `score-override-endpoint.test.mjs:40`) into a reusable fixture

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Visual layout (faceted sidebar 260px, summary-card focal point, drawer side-panel, timeline collapse) matches UI-SPEC | DASH-01/02/03 | Visual fidelity not assertable in unit tests | `gsd-browser navigate http://localhost:3032/performance` + `screenshot`; compare against 74-UI-SPEC.md |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s (experiment suite)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
