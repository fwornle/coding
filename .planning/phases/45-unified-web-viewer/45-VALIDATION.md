---
phase: 45
slug: unified-web-viewer
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-07
source: 45-RESEARCH.md § "Validation Architecture"
---

# Phase 45 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Distilled from `45-RESEARCH.md` § Validation Architecture; planner uses this to attach concrete test commands to each task.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 1.x (matches the Vite-based packages — same major as `system-health-dashboard`); Playwright for E2E flows. |
| **Config file** | `integrations/unified-viewer/vitest.config.ts` (NEW — created in Wave 0); existing `playwright.config.ts` at repo root for E2E scenarios. |
| **Quick run command** | `cd integrations/unified-viewer && npx vitest run --reporter=verbose` |
| **Full suite command** | `npx playwright test --project=unified-viewer && cd integrations/unified-viewer && npm run test` |
| **Estimated runtime** | ~60–90 seconds (Vitest unit + component: ~15s; Playwright E2E with system-routing + expand + entity-detail + RCA: ~60s) |

---

## Sampling Rate

- **After every task commit:** Run `cd integrations/unified-viewer && npx vitest run --reporter=verbose` (≤15 s)
- **After every plan wave:** Run the full suite above
- **Before `/gsd-verify-work`:** Full suite must be GREEN against all three backends (A live on :12436; B live on :3848; C either reachable from operator's BMW network or mocked per the OQ#5 fallback)
- **Max feedback latency:** 90 seconds (full-suite ceiling)

---

## Per-Task Verification Map

Distilled from `45-RESEARCH.md`. Planner expands these rows when attaching each task; rows can split or merge during plan-phase.

| Req ID | Behavior | Test Type | Automated Command | File Exists | Status |
|--------|----------|-----------|-------------------|-------------|--------|
| UI-01 | Viewer mounts against all 3 backends — `/viewer/coding`, `/viewer/okb`, `/viewer/cap` — without errors | E2E (Playwright) | `npx playwright test tests/e2e/unified-viewer/system-routing.spec.ts` | no (Wave 0) | pending |
| UI-01 | Wire-shape lock — `digest.observationIds` exists, `digest.observation_ids` does NOT (mirrors `tests/integration/typed-views.test.js`) | Unit (Vitest) | `npx vitest run integrations/unified-viewer/src/api/shape-lock.test.ts` | no (Wave 0) | pending |
| UI-01 | System switch (`/viewer/coding → /viewer/okb`) fully resets store — no leaked `selectedNodeId`, no leaked filters | Component test | `npx vitest run integrations/unified-viewer/src/routes/UnifiedViewer.test.tsx` | no (Wave 0) | pending |
| UI-01 | Click → entity-detail panel populates with canonical wire keys | E2E | `npx playwright test tests/e2e/unified-viewer/entity-detail.spec.ts` | no (Wave 0) | pending |
| UI-01 | Double-click → expand neighbors fetches `/api/v1/entities/:id/neighbors` and merges | E2E | `npx playwright test tests/e2e/unified-viewer/expand-neighbors.spec.ts` | no (Wave 0) | pending |
| UI-01 | Search input filters visible entities (substring on name + description) | Component test | `npx vitest run integrations/unified-viewer/src/panels/FilterRail.test.tsx` | no (Wave 0) | pending |
| UI-01 | Level checkboxes (L0–L3) filter by ontology level | Component test | `npx vitest run integrations/unified-viewer/src/panels/FilterRail.test.tsx` | no (Wave 0) | pending |
| UI-01 | Ontology-class filter multi-select drives node visibility | Component test | `npx vitest run integrations/unified-viewer/src/panels/FilterRail.test.tsx` | no (Wave 0) | pending |
| UI-01 | Ontology-driven node colors apply `display.color` when present; FNV-1a hash fallback otherwise; theme-conditional S/L | Unit + visual-regression snapshot | `npx vitest run integrations/unified-viewer/src/graph/color-fallback.test.ts` | no (Wave 0) | pending |
| UI-01 | MarkdownViewer renders `entity.description` with anchors + image relative-path resolution; Mermaid hook stripped | Component test | `npx vitest run integrations/unified-viewer/src/panels/MarkdownViewerPanel.test.tsx` | no (Wave 0) | pending |
| UI-01 | RCA Ops panel triggers `POST /api/okm/rca/ingest` on Ingest click; SSE streams progress (Option A — verbatim port) | E2E (against C dev backend or mock SSE) | `npx playwright test tests/e2e/unified-viewer/rca-ingestion.spec.ts` | no (Wave 0) | pending |
| UI-01 | CORS / unreachable / 5xx → error banner displays with copy + retry from UI-SPEC | Component test | `npx vitest run integrations/unified-viewer/src/lib-domain/states.test.tsx` | no (Wave 0) | pending |
| UI-01 | Icon-only controls carry `aria-label` + Radix `<Tooltip>` (UI-SPEC § Icon-only controls FLAG remediation) | Component test (testing-library `getByRole('button', {name: ...})`) | `npx vitest run integrations/unified-viewer/src/components/IconButton.a11y.test.tsx` | no (Wave 0) | pending |

---

## Wave 0 — Operator Probes (LOW-confidence research items)

These items the researcher could not verify autonomously; the operator runs them in Wave 0 before the rest of Phase 45's plans execute.

| Probe | What to verify | Command / action | Fallback if RED |
|-------|----------------|------------------|-----------------|
| C-system CORS | `okm.cc.bmwgroup.net` allows cross-origin requests from `localhost:5173` | From BMW corporate laptop: `curl -i -H "Origin: http://localhost:5173" https://okm.cc.bmwgroup.net/api/okm/health` | Tier 2: backend proxy via A. Tier 3: backend proxy via B. Adds ~2 days plan work each. |
| C-system SSE | `okm.cc.bmwgroup.net/api/okm/ingest/progress` streams SSE events | `curl -N https://okm.cc.bmwgroup.net/api/okm/ingest/progress` from BMW network | RCA Ops panel mocks SSE in MVP; real-stream verification deferred to Phase 45.1 |
| lucide-react icon completeness | All UI-SPEC-referenced icons exist in `lucide-react@^0.544.0` (pinned per RESEARCH.md A6) | `node -e "const l=require('lucide-react'); ['ZoomIn','ZoomOut','Maximize','Search','Filter','ChevronLeft','ChevronRight','HelpCircle','Sun','Moon'].forEach(i=>console.log(i, typeof l[i]))"` | Substitute icon names with available alternates and update UI-SPEC § Icon-only controls table |
| Display-overlay query param | Operator confirms preference: `?withDisplay=true` gated extension (researcher rec) vs always-rich shape (would bump OKM contract) | Operator decision | If always-rich preferred, OKM `rest-contract.test.ts:257` needs cross-repo update — adds 1 day |

---

## Sign-off

- [ ] All test files exist
- [ ] All commands GREEN against A backend (live `:12436`)
- [ ] All commands GREEN against B backend (live `:3848`)
- [ ] All commands GREEN against C backend (live `okm.cc.bmwgroup.net` OR documented mock path per OQ#5 fallback)
- [ ] Wave 0 operator probes resolved (4 rows above)
- [ ] `nyquist_compliant: true` set in frontmatter
- [ ] `wave_0_complete: true` set in frontmatter
