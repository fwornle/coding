---
phase: 44
slug: rest-api-git-snapshots
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-03
---

# Phase 44 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Sourced from `44-RESEARCH.md` § Validation Architecture. Planner fills the Per-Task Verification Map after waves are assigned.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework (km-core)** | vitest 4.x |
| **Framework (OKM)** | vitest 4.x |
| **Framework (coding root)** | Jest 29.x |
| **Config files** | `lib/km-core/vitest.config.ts`, `_work/rapid-automations/integrations/operational-knowledge-management/vitest.config.ts`, `package.json` jest config (coding) |
| **Quick run command (km-core)** | `cd lib/km-core && npx vitest run <file> -t '<name>'` |
| **Quick run command (OKM)** | `cd _work/rapid-automations/integrations/operational-knowledge-management && npx vitest run <file> -t '<name>'` |
| **Quick run command (coding)** | `npm test -- <pattern>` |
| **Full suite (km-core)** | `cd lib/km-core && npm test` |
| **Full suite (OKM)** | `cd _work/.../okm && npm test` |
| **Full suite (coding)** | `npm test` |
| **Estimated quick runtime** | ~30s unit / ~60s integration |
| **Estimated full runtime** | ~3 min per system |

---

## Sampling Rate

- **After every task commit:** Run the touched test file via the system-specific quick command (sub-30s for unit, ~60s for integration).
- **After every plan wave:** Run the touching system's full suite (`cd <system> && npm test`).
- **Before `/gsd-verify-work`:** All three full suites green + `tests/integration/cross-system-parity.mjs` green + dashboard Playwright smoke green.
- **Max feedback latency:** 60 seconds per task; ≤5 min for wave gate.

---

## Per-Task Verification Map

> Planner fills this section per plan after wave assignment. Template row:

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 44-NN-NN | NN | W | API-0X | T-44-XX / — | {expected behavior} | unit/integration/e2e | `{command}` | ✅ / ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Coverage requirements (from research):**

| Req ID | Behavior | Test Type | Command |
|--------|----------|-----------|---------|
| API-01 | km-core router factory mounts and serves 15 canonical endpoints | integration | `cd lib/km-core && npx vitest run tests/integration/api-router.test.ts` |
| API-01 | Zod schemas in km-core parse OKM fixtures byte-for-byte | unit | `cd lib/km-core && npx vitest run tests/unit/contracts.test.ts` |
| API-01 | Shape-identical responses across A/B/C (fixtures-diff) | integration | `cd _work/.../okm && npx vitest run tests/integration/rest-contract.test.ts` |
| API-01 | A's typed views return legacy-shaped observations from km-core entities | integration | `npm test -- typed-views` |
| API-01 (SC-3) | Dashboard renders observations correctly after A-2 migration | e2e (Playwright) | `npx playwright test tests/e2e/dashboard-observations.spec.ts` |
| API-02 | Snapshot create produces `chore(snapshot)` commit + `snapshot/*` tag | integration | `cd lib/km-core && npx vitest run tests/integration/snapshot-roundtrip.test.ts` |
| API-02 | Restore round-trip: snapshot → mutate → restore → graph equals snapshot state | integration | same file as above |
| API-02 (SC-4) | OKB-baseline guard allows snapshot commits with `OKB_SNAPSHOT=1`; rejects without | shell | `bash tests/integration/okb-guard-snapshot-bypass.sh` |
| API-01 (cross-system) | Same request body returns same JSON on A, B, C | integration | `node tests/integration/cross-system-parity.mjs` |

---

## Wave 0 Requirements

Wave 0 (test infrastructure scaffolding — runs before any feature task) installs:

- [ ] `lib/km-core/tests/integration/api-router.test.ts` — supertest harness; verifies `createKmCoreRouter` mounts the 15 canonical endpoints
- [ ] `lib/km-core/tests/unit/contracts.test.ts` — Zod accept-good / reject-bad payload suite
- [ ] `lib/km-core/tests/integration/snapshot-roundtrip.test.ts` — create → mutate → restore → assert equal (with temp git repo fixture)
- [ ] `lib/km-core/tests/integration/observation-view.test.ts` — `observationToLegacy` round-trip (km-core entity ↔ legacy obs shape)
- [ ] `tests/integration/cross-system-parity.mjs` (coding side) — drives all three running services with supertest, normalizes timestamps/IDs, diffs JSON
- [ ] `tests/integration/typed-views.test.js` (coding side) — A's `/api/coding/observations|digests|insights` shape lock
- [ ] `tests/e2e/dashboard-observations.spec.ts` (Playwright) — dashboard smoke; verifies non-empty cells after migration
- [ ] `tests/integration/okb-guard-snapshot-bypass.sh` (coding side) — shell test for `OKB_SNAPSHOT=1` bypass

> All Wave 0 stubs MUST be authored as red tests (assertions present, expected to fail until the feature lands). No skip/xfail in Wave 0.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Restore on B via `docker-compose restart coding-services` actually picks up restored JSONs | API-02 (SC-4) | Container lifecycle outside test-process scope | After integration test sets `restartRequired:true`, manually run `cd docker && docker-compose restart coding-services`, then `curl http://localhost:3848/api/v1/stats` and verify entity count matches snapshot |
| Restore on A via `launchctl kickstart` repopulates LevelDB from JSONs | API-02 (SC-4) | launchd is system-process; not unit-testable cleanly | Run `launchctl kickstart -k gui/$(id -u) com.coding.obs-api`, wait for health endpoint, `curl http://localhost:12436/api/v1/stats` |
| VOKB viewer renders unchanged after `/api/` → `/api/v1/` rewrite | API-01 (SC-1) | Browser rendering | Load OKM viewer, verify graph, search, cluster, snapshot list all render |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (8 stubs listed above)
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s per task; ≤ 5 min per wave gate
- [ ] `nyquist_compliant: true` set in frontmatter once planner fills Per-Task Map

**Approval:** pending
