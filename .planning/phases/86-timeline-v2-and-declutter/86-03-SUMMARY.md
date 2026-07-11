---
phase: 86-timeline-v2-and-declutter
plan: 03
subsystem: ui
tags: [react, react-router, radix-dialog, dashboard, playwright, timeline, performance]

# Dependency graph
requires:
  - phase: 86-01
    provides: loopFlags(turns) pure loop-heuristic (per-turn advisory badge signal)
  - phase: 86-02
    provides: ContextBand (mini|cumulative) + ContextBandLegend, exported scrubSecrets/CACHE_WRITE_NA, slice open-state (openTurnModal/closeTurnModal/selectModalTurn) + fetchReconciliation
provides:
  - v2 compact turn row (turn-row.tsx) — tool-name chips (+N overflow), mini context band, advisory loop badge, font-mono token/cache summary, whole-row click → single-turn modal
  - single-turn drill-down modal (turn-modal.tsx) — Radix Dialog, full per-message list, D-03 semantic-first intent lines, cache-breakpoint markers, per-message bytes, scrubSecrets on every rendered string, no dangerouslySetInnerHTML, cache_write===null → CACHE_WRITE_NA
  - fullscreen route /performance/timeline/:taskId (timeline-fullscreen.tsx) — whole-run cumulative context band + legend, verbatim canonical_model (null → italic unmeasured), reconciliation note, keyboard nav (↑/↓/Enter/Esc)
  - Timeline v2 evolution of timeline.tsx — v2 TurnRow per turn when context-turns present, DASH-02 tier badge + reasoning sub-bands preserved, D-06 v1 fallback + "no per-turn context captured" note
  - extended e2e coverage (performance.spec.ts) — modal-open, fullscreen route, DASH-02 survival, D-06 note
affects: [86-05, timeline, performance-dashboard, declutter]

# Tech tracking
tech-stack:
  added: []  # no new packages — Radix Dialog + react-router already present (T-86-03-SC honored)
  patterns:
    - "v2 TurnRow extracted from inline ParentRow scaffold; timeline.tsx evolved in place (anchors preserved, not rewritten)"
    - "Single-turn modal mirrors KbDetailDialog shell driven by slice open-state (selectModalTurn/openTurnModal/closeTurnModal)"
    - "Untrusted-text discipline: every preview/intent/arg through scrubSecrets, React default escaping, zero dangerouslySetInnerHTML"
    - "Honesty gate: cache_write===null → CACHE_WRITE_NA verbatim, never 0"

key-files:
  created:
    - integrations/system-health-dashboard/src/components/performance/turn-row.tsx
    - integrations/system-health-dashboard/src/components/performance/turn-modal.tsx
    - integrations/system-health-dashboard/src/components/performance/timeline-fullscreen.tsx
  modified:
    - integrations/system-health-dashboard/src/components/performance/timeline.tsx
    - integrations/system-health-dashboard/src/App.tsx
    - tests/e2e/dashboard/performance.spec.ts

key-decisions:
  - "v2 TurnRow extracted from the inline ParentRow card scaffold; timeline.tsx evolved in place (TierBadge/SubBand/ParentRow/isExperimentCell/canonical-model anchors preserved, never rewritten) — DASH-02 regression anchor held"
  - "Task 1 was tdd=true but the dashboard has no component-unit harness (no jsdom/vitest/testing-library); adding one is a package install (excluded per Rule 3). Behavioral RED/GREEN evidence lands as the Playwright e2e flows added in Task 2; verify is the npm run build typecheck gate"
  - "No packages installed — Radix Dialog + react-router already present (threat T-86-03-SC honored)"

patterns-established:
  - "Pattern 1: v2 row = ParentRow scaffold + left→right v2 additions (chips, mini band, loop badge), TierBadge + role swatch preserved"
  - "Pattern 2: single-turn modal driven by Redux open-state, mirrors KbDetailDialog, all strings scrubbed"
  - "Pattern 3: fullscreen route reads :taskId, renders same v2 TurnRow list + cumulative band, canonical_model verbatim"

requirements-completed: [DASH-02, VALID-01, ATTR-02]

# Metrics
duration: ~15min
completed: 2026-07-11
---

# Phase 86 Plan 03: Timeline v2 & Single-Turn Drill-Down Summary

**Timeline v2 — compact turn rows (tool chips + mini context band + advisory loop badge) that open a scrubbed Radix single-turn drill-down modal, plus a routed fullscreen whole-run view with the cumulative context-growth band + keyboard nav; DASH-02 tier badge + reasoning sub-bands and the D-06 v1 fallback preserved.**

## Performance

- **Duration:** ~15 min (autonomous Tasks 1-2 + checkpoint verification + finalization)
- **Tasks:** 3 (2 autonomous + 1 blocking human-verify checkpoint)
- **Files modified:** 6 (3 created, 3 modified)

## Accomplishments
- **v2 compact turn row** (`turn-row.tsx`, `TurnRow`) — TierBadge (preserved) + role swatch + truncated prompt excerpt + tool-name chips (`Badge variant="secondary"`, "+N" overflow) + font-mono token/cache summary + `<ContextBand variant="mini">` + advisory `Repeat` loop badge when `loopFlags[i]` with the mandatory tooltip; whole row is `cursor-pointer` and dispatches `openTurnModal({taskId,index})`. DASH-02 `granularity-tier-badge` slot carried through a `tierBadge` prop.
- **single-turn drill-down modal** (`turn-modal.tsx`, `TurnModal`) — Radix Dialog (`data-testid="turn-modal"`, mirrors `KbDetailDialog`) driven by `selectModalTurn`/`closeTurnModal`; full per-message list with per-message bytes (font-mono), tool name+size, D-03 semantic-first intent line, cache-breakpoint markers, cumulative context band; every preview/intent scrubbed via `scrubSecrets`, no `dangerouslySetInnerHTML`; raw arg text only behind `capture_raw_bodies`; `cache_write===null → CACHE_WRITE_NA`.
- **fullscreen route** `/performance/timeline/:taskId` (`timeline-fullscreen.tsx`, `TimelineFullscreen`) — reads `:taskId` from the router; cumulative context band + legend, `text-2xl` run title, verbatim `canonical_model` (null → italic "unmeasured", ATTR-02 anchor), verbatim reconciliation note (D-12), keyboard nav (↑/↓ focus, Enter opens modal, Esc/back exits). Registered in `App.tsx`.
- **Timeline v2 evolution** (`timeline.tsx`) — renders the v2 `TurnRow` per turn when the run has context-turns; preserves the DASH-02 `TierBadge` + collapsible per-reasoning-step `SubBand` sub-bands (`timeline-reasoning-step`) via `TurnRowWithChildren`; D-06 v1 fallback + "no per-turn context captured" note for runs without context-turns; `Maximize2` fullscreen affordance in the header; `isExperimentCell` narrative guard intact; `TurnModal` mounted once.
- **extended e2e** (`performance.spec.ts`) — 4 new v2 flows (modal open, fullscreen route, DASH-02 survival, D-06 note) with data-presence skip guards.

## Task Commits

Each autonomous task was committed atomically:

1. **Task 1: turn-row.tsx + turn-modal.tsx — v2 row + drill-down (D-01/D-03/D-04/D-09)** — `8708bc150` (feat)
2. **Task 2: Timeline v2 evolution + fullscreen route + App.tsx + e2e (D-02/D-06/DASH-02)** — `baf336522` (feat)
3. **Task 3: Human-verify Timeline v2 on :3032** — blocking human-verify checkpoint, **approved** (no code change)

**Plan metadata:** this docs commit (SUMMARY + STATE + ROADMAP).

## Files Created/Modified
- `integrations/system-health-dashboard/src/components/performance/turn-row.tsx` (created, 160 lines) — v2 compact turn row (chips + mini band + loop badge), opens modal
- `integrations/system-health-dashboard/src/components/performance/turn-modal.tsx` (created, 193 lines) — Radix single-turn drill-down (D-01/D-03), scrubbed
- `integrations/system-health-dashboard/src/components/performance/timeline-fullscreen.tsx` (created, 178 lines) — routed whole-run timeline with cumulative band + keyboard nav (D-02)
- `integrations/system-health-dashboard/src/components/performance/timeline.tsx` (modified, +163/-9) — v2 row rendering, DASH-02 preservation, D-06 fallback, fullscreen affordance
- `integrations/system-health-dashboard/src/App.tsx` (modified, +3) — `/performance/timeline/:taskId` route
- `tests/e2e/dashboard/performance.spec.ts` (modified, +95) — 4 new v2 flows

## Checkpoint: Human-Verify Approval (Task 3)

**Type:** checkpoint:human-verify (gate="blocking"). **Operator response: "approved".**

Live visual verification was performed on `:3032` via gsd-browser (frontend rebuilt + `web-services:health-dashboard-frontend` restarted per CLAUDE.md VirtioFS caching):

- **v2 turn rows** — tool-name chips + mini context bands + role chips render correctly on a run with context-turns.
- **single-turn drill-down modal** — opens on row click; shows token counts, a segmented context band with the hatched cache-read overlay, and the per-message list with tool intent lines.
- **fullscreen route** `/performance/timeline/:taskId` — renders the cumulative growth band + legend + tool-chipped turn rows; reads legibly.
- **DASH-02 tier badges preserved** after the v2 evolution.
- **Cache-write honesty** — cache-write shown verbatim (e.g. "cache w: 263"), never fabricated 0.
- **Build** — vite build clean, no new TS errors.

## Decisions Made
- **v2 TurnRow extracted from inline ParentRow scaffold; timeline.tsx evolved in place.** The DASH-02 anchors (TierBadge, SubBand `timeline-reasoning-step`, ParentRow collapsible, `isExperimentCell` guard, canonical-model header) were preserved verbatim rather than rewritten — this is the DASH-02 regression anchor and it held.
- **TDD-harness note (Task 1 was `tdd="true"`).** The dashboard has no component-unit harness (no jsdom/vitest/testing-library). Adding one is a package install, which is excluded from auto-fix (Rule 3 package-install exclusion) and would breach threat T-86-03-SC. Task 1's verification is therefore the `npm run build` typecheck gate; behavioral RED/GREEN evidence lands as the Playwright e2e flows added in Task 2 (modal-open, fullscreen, DASH-02 survival, D-06 note). No new packages were installed.

## Deviations from Plan

None — plan executed exactly as written. No packages installed (T-86-03-SC honored); no `dangerouslySetInnerHTML`; `isExperimentCell` guard preserved; `cache_write===null → CACHE_WRITE_NA`.

## Issues Encountered
None during planned work.

## Deferred / Honest Caveat

**D-06 v1 fallback — live visual confirmation deferred.** The D-06 path (a run WITHOUT context-turns showing the v1 row + "no per-turn context captured" note instead of an error) was NOT visually reproduced during the checkpoint — no context-turns-free run was available in the current dataset. It remains covered by:
- the acceptance grep (`grep -v '^\s*//' timeline.tsx | grep -c "no per-turn context captured"` ≥ 1 — present, non-comment), and
- the extended e2e spec (the D-06 note assertion with a data-presence skip guard).

Live visual confirmation of the D-06 fallback is deferred until a context-turns-free measured run is available. This does not block the plan — the fallback code and its automated coverage are in place; only the on-screen reproduction is outstanding.

## User Setup Required
None — no external service configuration required.

## Next Phase Readiness
- Timeline v2 (row + modal + fullscreen) is shipped and human-verified on :3032; DASH-02 + ATTR-02 anchors preserved.
- Ready for the remaining Wave-2/3 declutter work (Plan 86-05) which consumes the same frozen band + slice contract.
- Outstanding (non-blocking): D-06 v1-fallback live visual reproduction once a context-turns-free run exists.

## Self-Check: PASSED

Created files verified present on disk:
- `integrations/system-health-dashboard/src/components/performance/turn-row.tsx` — FOUND
- `integrations/system-health-dashboard/src/components/performance/turn-modal.tsx` — FOUND
- `integrations/system-health-dashboard/src/components/performance/timeline-fullscreen.tsx` — FOUND

Modified files verified present:
- `integrations/system-health-dashboard/src/components/performance/timeline.tsx` — FOUND
- `integrations/system-health-dashboard/src/App.tsx` — FOUND
- `tests/e2e/dashboard/performance.spec.ts` — FOUND

Commits verified in git log:
- `8708bc150` (Task 1) — FOUND
- `baf336522` (Task 2) — FOUND

---
*Phase: 86-timeline-v2-and-declutter*
*Completed: 2026-07-11*
