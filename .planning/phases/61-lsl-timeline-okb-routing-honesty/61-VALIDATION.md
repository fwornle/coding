---
phase: 61
slug: lsl-timeline-okb-routing-honesty
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-20
---

# Phase 61 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from 61-RESEARCH.md § "Validation Architecture".

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Jest (integration, `tests/integration/`) + Playwright (`tests/e2e/unified-viewer/`) + Vitest (unified-viewer `*.test.ts`) |
| **Config file** | `playwright.config.ts`; unified-viewer Vitest config in `integrations/unified-viewer` |
| **Quick run command** | `npx playwright test tests/e2e/unified-viewer/55-okb-routing.spec.ts` |
| **Full suite command** | `npx playwright test tests/e2e/unified-viewer/` + `node --test tests/integration/obs-api.coding-lsl-sessions.test.js` |
| **Estimated runtime** | ~90 seconds |

---

## Sampling Rate

- **After every task commit:** Run the relevant single spec (e.g. `55-okb-routing.spec.ts`) + the touched Vitest file
- **After every plan wave:** Run full `tests/e2e/unified-viewer/` + `obs-api.coding-lsl-sessions.test.js`
- **Before `/gsd-verify-work`:** Both suites must be green
- **Max feedback latency:** ~90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 61-01-01 | 01 | 1 | LSLTIME-01, LSLTIME-03 | — | obs-api returns server-derived `total` + `source` (no new untrusted input) | integration | `node --test tests/integration/obs-api.coding-lsl-sessions.test.js` | ⚠️ exists, extend | ⬜ pending |
| 61-01-02 | 01 | 1 | LSLTIME-01, LSLTIME-03 | — | mixed-source any-`manual`→`batch` fixture asserted | integration | `node --test tests/integration/obs-api.coding-lsl-sessions.test.js` | ⚠️ exists, extend | ⬜ pending |
| 61-02-01 | 02 | 1 | OKBROUTE-01 | T-61-02 (SSRF→fixed endpoint) | okb requests `/api/entities` (legacy), not `/api/v1/`; relations capped at 2000 | e2e | `npx playwright test tests/e2e/unified-viewer/55-okb-routing.spec.ts` | ⚠️ exists, extend | ⬜ pending |
| 61-02-02 | 02 | 1 | OKBROUTE-02 | T-61-02 (XSS→React escaping) | no coding-KG mirror entities; client-side 1-hop expand, never silent no-op | e2e | `npx playwright test tests/e2e/unified-viewer/` | ⚠️ extend okb cases | ⬜ pending |
| 61-02-03 | 02 | 1 | OKBROUTE-01, OKBROUTE-02 | — | `:8090` down → `ErrorUnreachableState` text incl `:8090`; no `catch{return []}` | e2e | `npx playwright test tests/e2e/unified-viewer/` | ❌ Wave 0 (new SC#5 spec) | ⬜ pending |
| 61-03-01 | 03 | 2 | LSLTIME-01, LSLTIME-02 | — | `'1y'` rename, no `'all'` literal; hook returns `{ sessions, total }` | unit (vitest) | `cd integrations/unified-viewer && npx tsc --noEmit && npx vitest run` | ❌ Wave 0 | ⬜ pending |
| 61-03-02 | 03 | 2 | LSLTIME-01, LSLTIME-03 | — | "N of M" badge fires when `total > sessions.length`; amber/pink bi-source ticks | unit + e2e | viewer Vitest + `tests/e2e/unified-viewer/` | ❌ Wave 0 | ⬜ pending |
| 61-03-03 | 03 | 2 | LSLTIME-01, LSLTIME-02, LSLTIME-03 | — | manual checkpoint: two distinct tick hues visible via `gsd-browser` | manual | `gsd-browser navigate/screenshot` | N/A (checkpoint) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Extend `tests/integration/obs-api.coding-lsl-sessions.test.js` — assert `total` field + `source` field + mixed-source any-`manual`→`batch` fixture
- [ ] New/extended viewer Vitest for "N of M" badge (fires when `total > sessions.length`)
- [ ] Grep gate / unit test: no `'all'` `LslWindow` literal remains; toggle renders `24h / 7d / 30d / 1y`
- [ ] Extend `tests/e2e/unified-viewer/55-okb-routing.spec.ts`: assert request path `/api/entities` (not `/api/v1/entities`) + `CodeAnalyzer`/`PersistenceAgent` ABSENT + real RaaS/KPI-FW entity present
- [ ] New SC#5 spec: OKM-down → `ErrorUnreachableState` with `:8090` in copy
- [ ] okb relation cap (2000, drop `CORRELATED_WITH` first) resolved by planner (61-02 Task 1) before any E2E loads the full 18,958-edge graph

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Two distinct tick hues (amber=batch, pink=online) visibly distinguishable at a glance | LSLTIME-03 | Color perception / "at a glance" acceptance bar is inherently visual (SC#3) | `gsd-browser navigate http://localhost:5173/viewer/coding`, screenshot the LSL strip, confirm amber + pink ticks coexist with greyed 0-obs + blue selection rings |
| SC#4 real RaaS / KPI-FW entities render when `:8090` is up | OKBROUTE-02 | E2E real-entity assertion skip-gates on OKM Express availability; needs `:8090` running | Start OKM Express on `:8090`, `gsd-browser navigate http://localhost:5173/viewer/okb`, confirm real RaaS/KPI-FW entities present and no `CodeAnalyzer`/`PersistenceAgent` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
