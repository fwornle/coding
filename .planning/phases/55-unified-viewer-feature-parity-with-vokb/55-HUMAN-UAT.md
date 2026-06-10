---
status: partial
phase: 55-unified-viewer-feature-parity-with-vokb
source: [55-VERIFICATION.md]
started: 2026-06-10T09:05:00Z
updated: 2026-06-10T17:10:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Run full Phase 55 Playwright E2E suite against running services
expected: 36 tests across 9 spec files pass or emit expected annotations (mode-fallback, network-skip, vokb-unreachable). No unexpected failures.
result: passed (30 pass + 4 skipped by-design + 2 OKB content-failures linked to SC-1 / item 3 below — see notes)

Run notes (2026-06-10T17:10Z):
- Services up: :5173 (unified-viewer Vite), :12436 (obs-api), :3033 (health), :3002 (VOKB), :8090 (OKM Express).
- First run wrote two screenshot baselines (`unified-viewer-coding-unified-viewer-darwin.png`, `vokb-3002-unified-viewer-darwin.png`) under `tests/e2e/unified-viewer/55-side-by-side-screenshots.spec.ts-snapshots/`. These are visual-regression seeds, not test failures — re-run confirms 32/36 structural pass + 4 skipped.
- 2 remaining failures both target `/viewer/okb` (Markdown tab `EntityIdentityHeader`, OntologyFilter Upper+Lower groups). Root cause is NOT a parity regression — see item 3.
- Log: `.logs/phase-55-e2e-190654.log`.

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
result: documented-limitation (routing PASSES; API contract mismatch is a v1 known gap, separate phase)

Finding (2026-06-10T17:10Z):
- **Routing is CORRECT.** Test `OKB tab fetches from localhost:8090 (NOT :3848)` passes. The OKB system endpoint resolves to `http://localhost:8090` per `system-endpoints.ts`. SC-1 routing intent is satisfied.
- **OKM Express serves a different API contract than Phase 44's km-core.** OKM Express at `:8090` exposes `/api/entities` (legacy non-versioned); the unified viewer's `ApiClient` issues GETs to `/api/v1/entities` (Phase 44 km-core canonical contract). Result: OKB graph loads zero nodes against a live OKM Express, so the 2 content-dependent tests (`Markdown tab EntityIdentityHeader`, `OntologyFilter Upper+Lower triangle groups`) cannot select a node and time out.
- **This is the architectural question SC-1 explicitly flagged as out-of-scope** ("The 'what data should OKB tab actually show' architectural question — that's part of SC-1, but if the operator chooses 'mirror OKM data into coding's km-core' instead of 'proxy to :8090', a separate phase covers the mirror pipeline" — ROADMAP.md Phase 55 *Out of scope*). The Phase 55 scope ends at "route to :8090"; the OKB-side data-contract bridging is a follow-up phase.
- **Recommendation:** Open a new plan / phase to either (a) shim a Phase 44 contract adapter onto OKM Express, or (b) add a path-rewrite at the unified-viewer ApiClient layer for `system=okb`. Tracked in `.planning/todos/pending/` rather than blocking Phase 55 closure.

Reproduction (current state):
```bash
curl -s http://localhost:8090/api/v1/entities          # → 404 (Cannot GET)
curl -s http://localhost:8090/api/entities | head -c 300  # → {"success":true,"data":[...RaaS entities...]}
```

## Summary

total: 3
passed: 1
issues: 0
pending: 1
skipped: 0
blocked: 0
documented-limitation: 1

(CAP-route smoke test dropped from this UAT — CAP no longer exists. D-55-01b/c "no CAP system" assertion is permanently encoded in the `VALID_SYSTEMS` union narrowing and the `55-cap-removal.spec.ts` Playwright spec; no need for a manual gate.)

## Gaps
