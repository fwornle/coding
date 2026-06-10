---
status: partial
phase: 55-unified-viewer-feature-parity-with-vokb
source: [55-VERIFICATION.md]
started: 2026-06-10T09:05:00Z
updated: 2026-06-10T09:12:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Run full Phase 55 Playwright E2E suite against running services
expected: 36 tests across 9 spec files pass or emit expected annotations (mode-fallback, network-skip, vokb-unreachable). No unexpected failures.
result: [pending]

Reproduction:
```bash
# Start required services first
cd /Users/Q284340/Agentic/coding/integrations/unified-viewer && npm run dev &   # :5173
# Coding services on :12436 / :3033 should already be up via coding --claude
# Optionally start VOKB on :3002 if testing the side-by-side spec
cd /Users/Q284340/Agentic/coding
npx playwright test tests/e2e/unified-viewer/55-*.spec.ts
npx playwright show-report
```

### 2. Side-by-side visual parity review (UI-SPEC §17 — operator gate from Plan 55-13 Task 4)
expected: All 16 UI-SPEC §7 surfaces in the unified viewer match VOKB visually for ported surfaces; coding-additions (HierarchyNavigator, LslTimelineStrip, EtmTailSheet, WorkflowStatusPanel) render correctly under `system=coding` gating only.
result: [pending — operator approved deferred review on 2026-06-10; this is the post-merge inspection]

Reproduction:
- Open `http://localhost:5173/viewer/coding` and `http://localhost:5173/viewer/okb` side-by-side with `http://localhost:3002` (VOKB)
- Walk each of the 16 surfaces in UI-SPEC §7 (StatsBar, FilterRail panels, Entity sub-tabs, TrendingPanel, IssueTriageView, coding panels)
- Capture screenshot pairs into `tests/e2e/unified-viewer/55-fixtures/expected-vokb-screenshots/` per the README there

### 3. OKB data verification (SC-1 — operator-driven feature-parity requirement)
expected: When OKM Express is running on `:8090`, the OKB tab shows OKM entities (RaaS / KPI-FW / business entities) — NOT `CodeAnalyzer` / `PersistenceAgent` (coding KG mirror).
result: [pending]

Reproduction:
- Confirm OKM Express is running on `localhost:8090`
- Navigate to `http://localhost:5173/viewer/okb`
- Inspect graph node labels; assert they are OKM-shaped, not coding-shaped
- DevTools Network tab: confirm requests target `http://localhost:8090`, not `:3848`

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

(CAP-route smoke test dropped from this UAT — CAP no longer exists. D-55-01b/c "no CAP system" assertion is permanently encoded in the `VALID_SYSTEMS` union narrowing and the `55-cap-removal.spec.ts` Playwright spec; no need for a manual gate.)

## Gaps
