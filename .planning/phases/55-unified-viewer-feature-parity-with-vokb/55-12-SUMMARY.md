---
phase: 55-unified-viewer-feature-parity-with-vokb
plan: 12
subsystem: ui
tags: [react, zustand, sse, eventsource, shadcn, sheet, coding-only, ukb-ops, etm-live-tail, workflow-status, lazy-import-overwrite, additive-mount]

# Dependency graph
requires:
  - phase: 55-unified-viewer-feature-parity-with-vokb
    plan: 04
    provides: "Zustand store slices — etmObservations ring buffer (max 100), etmStreamConnected, etmSheetOpen, pushObservation, setEtmSheetOpen, setEtmStreamConnected"
  - phase: 55-unified-viewer-feature-parity-with-vokb
    plan: 06
    provides: "Backend SSE endpoint GET /api/coding/observations/stream + ObservationWriter module-level event bus that fans observations to all connected SSE clients"
  - phase: 55-unified-viewer-feature-parity-with-vokb
    plan: 07
    provides: "NavBar 2-system shell with Mode ToggleGroup; the 55-12 ETM trigger slots into the right-side controls cluster without touching the mode-toggle code path"
  - phase: 55-unified-viewer-feature-parity-with-vokb
    plan: 10
    provides: "UnifiedViewer.tsx additive-edit pattern (IssueTriageView lazy import swap); 55-12 preserves the swap intact"
  - phase: 55-unified-viewer-feature-parity-with-vokb
    plan: 11
    provides: "UnifiedViewer.tsx LslTimelineStrip mount (coding-only between content row and Footer); 55-12 preserves it intact and adds the WorkflowStatusPanel BELOW Footer + EtmTailSheet as a portaled overlay"
provides:
  - "EtmTailSheet.tsx — Surface #15 — coding-only SSE-consuming Live Tail Sheet with 1s/2s/4s/8s/16s exponential backoff reconnect, ring-buffer-capped observation list, agent color map (claude=violet, copilot=blue, opencode=teal, mastra=amber), burst debounce (>2 obs → 250ms batched flush), aria-live='polite' body, keyboard 't' toggle"
  - "WorkflowStatusPanel.tsx — Surface #16 — coding-only inline UKB-Ops status panel polling http://localhost:3033/api/ukb/status every 5s with idle-skip after 5 min, auto-expand on idle→running, auto-collapse 30s after terminal state, per-step Progress bars + failure visualization with Retry link to dashboard"
  - "components/ui/sheet.tsx — shadcn 'new-york' preset Sheet primitive built on Radix Dialog (no new npm packages)"
  - "NavBar.tsx — 📡 (lucide Radio) ETM tail trigger with dynamic aria-label, unread-count badge driven by lastSeenObsId snapshot + 30s recency window"
  - "UnifiedViewer.tsx — additive mounts: EtmTailSheet (coding-only overlay) + WorkflowStatusPanel (coding-only below Footer)"
  - "test-setup.ts — EventSource stub (no-op constructor with onopen/onmessage/onerror/close) so other tests that incidentally mount the live UnifiedViewer don't crash"
  - "Exported reconnectDelay(attempt: number): number pure helper from EtmTailSheet for deterministic backoff-schedule assertions"
affects:
  - "55-13 (LSL session multi-select composer — UnifiedViewer.tsx is now structurally minimal again after 55-12's additive edits; 55-13's additions will merge cleanly)"

# Tech tracking
tech-stack:
  added: []  # no new npm packages — Radix Dialog umbrella + lucide-react already present
  patterns:
    - "Burst debounce via accumulator ref + setTimeout(flush, 250ms): pendingObsRef accumulates; flush is no-debounce when ≤1 item (zero-overhead common case) and 250ms-debounced when ≥2 items"
    - "Exponential reconnect schedule as a pure exported helper (`reconnectDelay`) — matches Plan 55-07 StatsBar's backoffDelay export pattern and replaces fake-timers integration testing with deterministic unit assertions on the schedule itself"
    - "Defense-in-depth coding-only gating: BOTH component-level (`if (system !== 'coding') return null`) AND mount-level (`system === 'coding' && <X />` in UnifiedViewer JSX) — same pattern Plan 55-11 established for HierarchyNavigator / LslTimelineStrip"
    - "Optional-prop-with-store-fallback on the badge derivation: NavBar reads etmObservations from the store but the badge logic uses a `lastSeenObsId` snapshot recorded on the etmSheetOpen edge transition (not the etmObservations slice), so the badge count is meaningful 'unread since last open' rather than 'total in ring buffer'"
    - "shadcn primitive author-from-preset: src/components/ui/sheet.tsx authored verbatim from the 'new-york' preset (built on Radix Dialog via the radix-ui umbrella), matching the dialog.tsx forwardRef pattern + the four primitives 55-07 added (popover/toggle/toggle-group/skeleton)"
    - "Global EventSource stub at the test-setup layer (parallel to ResizeObserver/WebGLRenderingContext stubs) — jsdom doesn't ship EventSource, so the stub keeps integration-style tests that incidentally mount EtmTailSheet from crashing while leaving SSE-state assertions to MockEventSource in EtmTailSheet.test.tsx itself"

key-files:
  created:
    - "integrations/unified-viewer/src/panels/coding/EtmTailSheet.tsx (~270 LOC)"
    - "integrations/unified-viewer/src/panels/coding/EtmTailSheet.test.tsx (16 cases)"
    - "integrations/unified-viewer/src/panels/coding/WorkflowStatusPanel.tsx (~240 LOC)"
    - "integrations/unified-viewer/src/panels/coding/WorkflowStatusPanel.test.tsx (13 cases)"
    - "integrations/unified-viewer/src/components/ui/sheet.tsx (~155 LOC; shadcn 'new-york' preset)"
  modified:
    - "integrations/unified-viewer/src/panels/NavBar.tsx (additive: Radio import + ETM trigger block + unread-count derivation; all Phase 55-07 Mode toggle code preserved verbatim)"
    - "integrations/unified-viewer/src/panels/NavBar.test.tsx (+5 Phase 55-12 cases for ETM trigger; all prior cases preserved)"
    - "integrations/unified-viewer/src/routes/UnifiedViewer.tsx (additive: 2 import lines + 2 coding-gated JSX mounts; all 55-07/55-10/55-11 wiring preserved)"
    - "integrations/unified-viewer/src/routes/UnifiedViewer.test.tsx (+1 source-grep audit case)"
    - "integrations/unified-viewer/src/test-setup.ts (+EventSource stub)"

key-decisions:
  - "Mapped the plan's `Logger.Categories.NETWORK` reference to `Logger.Categories.API` because no NETWORK category exists in the unified-viewer's logging config (config/loggingConfig.ts ships only ROUTING/API/STORE/GRAPH/FILTERS/PANELS/LOGGER/DEFAULT). Plan 55-07 StatsBar.tsx — the first SSE-consuming component in this phase — already used API for SSE state changes; aligning with that convention keeps category semantics consistent across Phase 55 surfaces. Documented as a Rule 3 deviation."
  - "Burst debounce semantic: single-message path uses setTimeout(flush, 0) so the common case has near-zero lag while still draining via the flush ref (consistent code path). When the accumulator reaches 2+ items the debounce kicks in at 250ms per UI-SPEC §13.3. This is simpler than maintaining two separate flush paths and matches the spirit of '>10 obs/sec coalesced into 250ms batches' without imposing 250ms on every solo message."
  - "Exported reconnectDelay(attempt) as a pure helper so the backoff schedule is asserted directly (Test 5 walks attempts 0/1/2 → 1s/2s/4s + verifies new EventSource instances are scheduled). Same rationale as Plan 55-07's backoffDelay export — deterministic unit assertions, no scheduler races."
  - "EtmTailSheet click-row also closes the sheet on small screens (window.innerWidth < 768) per UI-SPEC §13.3 — desktop layouts keep the sheet open for context, mobile/narrow layouts dismiss it so the user can see the canvas-side selection."
  - "WorkflowStatusPanel uses a local `WorkflowStatusPayload` interface mirroring the dashboard's ukb-workflow-modal shape rather than importing from `@/integrations/system-health-dashboard/...` — avoids cross-module coupling per Plan 55-12 Task 2 <action> guidance. If the wire shape ever drifts, the local interface fails type-check at the fetch call site and the operator can update both sides independently."
  - "Failed step in WorkflowStatusPanel renders the row with `text-destructive` AND a small 'Retry' anchor link pointing at http://localhost:3032/ukb (the dashboard's UKB-Ops view). Per UI-SPEC §13.4, there is NO in-viewer retry affordance — the anchor stops event propagation so clicking Retry doesn't trigger the row's setSelectedNode side effect."
  - "NavBar unread-count badge uses `lastSeenObsId` snapshot recorded on the etmSheetOpen=true edge transition, with a fallback to a 30s-recency filter for the initial pre-open state. This avoids the alternative of 'just count etmObservations.length' (which would always show the ring buffer cap) and also avoids needing additional per-observation `seenBy` metadata. When the snapshot scrolls off the 100-item buffer, the badge counts all observations — a corner case that means 'you missed everything in the buffer' which is exactly the UX the user wants."
  - "EtmTailSheet mounted alongside WorkflowStatusPanel in UnifiedViewer.tsx as TWO separate coding-gated JSX blocks (rather than one combined gate). The plan's `<interfaces>` block specifies the mounts explicitly as two separate lines, and keeping them split makes the source-grep audit `system === 'coding'[^]*EtmTailSheet` AND `system === 'coding'[^]*WorkflowStatusPanel` both pass cleanly."
  - "Added a global EventSource stub to test-setup.ts (parallel to the existing ResizeObserver/WebGLRenderingContext stubs) instead of mocking EventSource per test file. The reason: now that EtmTailSheet is mounted by the live UnifiedViewer under coding system, ANY test that mounts the routing layer at `/viewer/coding` would crash with `ReferenceError: EventSource is not defined`. The setup-layer stub fixes the entire class of failures with a single change. EtmTailSheet's own tests still install a richer MockEventSource locally because they need to drive onopen/onmessage/onerror events directly — the global stub is the fallback for unrelated tests."

patterns-established:
  - "EventSource SSE consumer with exponential reconnect: useRef-pinned sse instance + attempt counter + reconnect timer + cleanup tied to useEffect return; backoff schedule exposed as a pure exported helper. Future SSE consumers (e.g., a hypothetical /api/v1/stream stats stream) should follow this same shape."
  - "Burst debounce via accumulator ref + scheduled flush: applicable to any incoming-event stream where ring-buffer pushes could thrash the React tree under load. Threshold of 2 items skips the debounce in the normal case."
  - "Defense-in-depth coding-only gating at both component AND mount level: established by 55-11, continued by 55-12 for both EtmTailSheet (overlay) and WorkflowStatusPanel (below Footer). Either gate alone is sufficient; both together survive future renaming of the parent gate without leaking the coding-only surface to OKB."
  - "shadcn primitive author-from-preset (continued from 55-07): Sheet built directly on Radix Dialog via the radix-ui umbrella, no `npx shadcn add` invocation (which requires an interactive prompt unavailable in the executor). All four primitives 55-07 added (popover/toggle/toggle-group/skeleton) plus 55-12's sheet follow the same forwardRef + radix-ui re-export shape as the existing dialog.tsx."
  - "Global test-setup stubs for browser APIs jsdom doesn't ship: ResizeObserver (55-11), EventSource (55-12). Convention is to add a no-op class with the surface methods the consumer touches, attach to both globalThis and window, and document the consumer pattern in the stub's leading comment."

requirements-completed: [UI-02]

# Metrics
duration: ~25min
completed: 2026-06-10
---

# Phase 55 Plan 12: EtmTailSheet + WorkflowStatusPanel + NavBar/UnifiedViewer Wiring Summary

**D-55-02b coding-only surface set complete. EtmTailSheet (Surface #15) consumes Plan 55-06's `/api/coding/observations/stream` SSE with exponential backoff + burst debounce; WorkflowStatusPanel (Surface #16) polls the Health API's UKB status with idle-skip + auto-expand/collapse. NavBar gains the 📡 ETM trigger with dynamic aria-label + unread-count badge. UnifiedViewer mounts both surfaces additively with defense-in-depth coding gates. Full vitest suite 519/519 GREEN; tsc clean; vite build clean; ZERO raw `console.*`.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-06-10T08:15:00Z
- **Completed:** 2026-06-10T08:40:00Z
- **Tasks:** 3 (all TDD: RED + GREEN per `tdd="true"`)
- **Commits:** 6 (RED+GREEN per task)
- **Files created:** 5
- **Files modified:** 5

## Accomplishments

- **`EtmTailSheet.tsx`** (Surface #15 — coding-only SSE Live Tail Sheet):
  - Defense-in-depth coding-only gate (component + mount)
  - `EventSource` consumer at `${apiClient.base}/api/coding/observations/stream`
  - Lifecycle:
    - `onopen` → `setEtmStreamConnected(true)` + reset attempt counter + Logger.info(API)
    - `onmessage` → JSON.parse → burst-debounced flush into `pushObservation`
    - `onerror` → `setEtmStreamConnected(false)` + `sse.close()` + schedule reconnect with `reconnectDelay(attempt)`
    - unmount → `sse.close()` (no leak; verified by Test 6)
  - **Exponential backoff schedule**: 1s, 2s, 4s, 8s, 16s, then capped at 16s — exposed as `export function reconnectDelay(attempt)` for deterministic testing (Test 5 walks attempts 0/1/2 → 1s/2s/4s)
  - **Burst debounce**: `pendingObsRef` accumulator + `setTimeout(flush, 250ms)`; single-message path bypasses the debounce window (≤1 item flushes via `setTimeout(flush, 0)`) so the common case is zero-overhead; 25 messages within 100ms all land in the store within 250ms (asserted by Test 13)
  - **Sheet UI**: shadcn `<Sheet side="right" className="w-96 sm:w-[480px]">` with sticky header showing the 📡 Radio icon + "ETM Live Tail" title + LIVE/Connecting dot + status label; sheet description (sr-only) silences the Radix "Missing Description" warning
  - **LIVE indicator dot**: `bg-emerald-500 animate-pulse` when connected; `bg-muted-foreground` (no animation) otherwise — UI-SPEC §3.5 carve-out item 5 honored
  - **Observation body**: `aria-live="polite" aria-atomic="false"` per UI-SPEC §15
  - **Row layout**: timestamp (HH:MM:SS in `tabular-nums`) + agent tag (color-coded by AGENT_COLOR map) + 1-line summary truncated at 80 chars
  - **Agent color map**: claude → text-violet-500, copilot → text-blue-500, opencode → text-teal-500, mastra → text-amber-500
  - **Click row**: if `observation.referencedEntities[0]` exists, `setSelectedNode(that)`; on small screens (`window.innerWidth < 768`) also closes the sheet
  - **Keyboard `t`**: document-level keydown handler toggles `etmSheetOpen` (skipped when input focused or modifier held)

- **`WorkflowStatusPanel.tsx`** (Surface #16 — coding-only inline UKB-Ops status):
  - Defense-in-depth coding-only gate
  - **Polling**: `fetch('http://localhost:3033/api/ukb/status')` on mount + every 5s via `setInterval(POLL_INTERVAL_MS=5000)`
  - **Idle-skip**: `idleSinceRef` tracks when status hit 'idle'; if continuously idle for >5min, polling is paused until the user clicks the trigger (which resets `idleSinceRef` to 0)
  - **Collapsed trigger**: h-10 row with verbatim UI-SPEC §5 copy — "No workflows running." (idle) or "{workflowName} {progressPercent}% — {currentPhase}" (running)
  - **Expanded body**: shadcn `<Card><CardContent>` with per-step rows:
    - StatusIcon (Loader2/CheckCircle2/XCircle/Circle for running/done/failed/idle)
    - Step label + truncate
    - shadcn `<Progress value={progressPercent} className="w-32 h-1.5">` bar
    - Percent in tabular-nums
    - Failed steps: `text-destructive` on the row + small "Retry" anchor linking to http://localhost:3032/ukb (stops event propagation so it doesn't trigger the row's setSelectedNode)
  - **Auto-expand**: any non-running → running transition calls `setExpanded(true)`
  - **Auto-collapse**: 30s after status transitions from 'running' to 'idle' or 'completed', `setTimeout(setExpanded(false), AUTO_COLLAPSE_DELAY_MS=30000)`
  - **Step click**: if `step.referencedEntities[0]` exists, `setSelectedNode(that)`

- **`components/ui/sheet.tsx`** (shadcn 'new-york' preset Sheet primitive):
  - Built directly on Radix Dialog via the radix-ui umbrella
  - Side variants: top / right / bottom / left with appropriate slide animations
  - Matches the forwardRef + radix-ui re-export pattern from dialog.tsx
  - No new npm packages

- **`NavBar.tsx`** additions (preserves all Phase 55-07 functionality):
  - lucide `Radio` icon imported
  - ETM tail trigger IconButton inside the right-side controls cluster, gated on `currentSystem === 'coding'`
  - aria-label dynamically flips between 'Open observation stream' (sheet closed) and 'Close observation stream' (sheet open)
  - Tooltip text "Observation stream (t)" exposes the keyboard shortcut
  - Click toggles `etmSheetOpen` + Logger.info(PANELS)
  - **Unread-count badge** (emerald, absolute-positioned top-right of the icon button):
    - `lastSeenObsId` state recorded on the `etmSheetOpen=true` edge transition
    - When sheet is closed: count = `etmObservations.findIndex(o => o.id === lastSeenObsId)` (i.e., observations newer than the snapshot)
    - Initial pre-open state: count = observations whose timestamp is within the last 30s
    - When the snapshot scrolls off the 100-item ring buffer: count = `etmObservations.length`
    - Badge hidden when `etmSheetOpen` OR `unreadCount === 0`

- **`UnifiedViewer.tsx`** additions (preserves all 55-07/55-10/55-11 wiring):
  - 2 additive imports: `EtmTailSheet`, `WorkflowStatusPanel`
  - `WorkflowStatusPanel` mounted BELOW the Footer per UI-SPEC §13.4 (coding-gated)
  - `EtmTailSheet` mounted inside the layout root (coding-gated); Radix Dialog portals it so the sheet is layout-neutral when closed

- **`test-setup.ts`** EventSource stub:
  - No-op EventSource class with `url`, `readyState`, `onopen`, `onmessage`, `onerror`, `close`, and the event-target methods
  - Attached to both `globalThis` and `window`
  - Solves the `ReferenceError: EventSource is not defined` failure mode for OTHER tests that incidentally mount the live UnifiedViewer at `/viewer/coding` (which now mounts EtmTailSheet)
  - EtmTailSheet.test.tsx still installs a richer MockEventSource locally for SSE-state assertions

- **29 new vitest cases** (across 4 test files):
  - 16 EtmTailSheet cases (gate, SSE lifecycle, backoff, ring-buffer push, burst debounce, render, LIVE dot, aria-live, row layout, agent colors, row click, keyboard `t`, Logger discipline, source-grep gates)
  - 13 WorkflowStatusPanel cases (gate, fetch URL, 5s polling, collapsed render copy verbatim, expanded render + step rows, auto-expand on idle→running, step click → setSelectedNode, failure styling + Retry link, root testid, Logger discipline, source-grep gates, default export)
  - 5 NavBar Phase 55-12 cases (coding-only trigger, okb-gate negative, dynamic aria-label, click toggles store, unread badge with 30s recency)
  - 1 UnifiedViewer source-grep audit (EtmTailSheet + WorkflowStatusPanel both imported + both coding-gated)

- **TypeScript clean**: `npx tsc --noEmit` exit 0 across the entire `integrations/unified-viewer` package

- **Vite build clean**: `npx vite build` exit 0 in 4.51s; lazy chunks unchanged from Plan 55-11 baseline (EtmTailSheet + WorkflowStatusPanel are statically imported as coding-only surfaces — their bundle impact is in the main index chunk)

## Task Commits

Each task committed atomically as a RED + GREEN pair (TDD `tdd="true"`):

1. **Task 1 RED** — `1a974bb01` (test) — 16 failing tests for EtmTailSheet + add shadcn Sheet primitive
2. **Task 1 GREEN** — `1075e9fb5` (feat) — EtmTailSheet implementation; 16/16 GREEN
3. **Task 2 RED** — `f14ed83b5` (test) — 13 failing tests for WorkflowStatusPanel
4. **Task 2 GREEN** — `d499f35d7` (feat) — WorkflowStatusPanel implementation; 13/13 GREEN
5. **Task 3 RED** — `3c8c9f894` (test) — 5 failing NavBar ETM-trigger cases + 1 UnifiedViewer source-grep audit
6. **Task 3 GREEN** — `ddcc6fafd` (feat) — NavBar ETM trigger + UnifiedViewer additive mounts + EventSource stub; 14/14 NavBar + 13/13 UnifiedViewer + 519/519 full suite GREEN

REFACTOR phase: skipped — code is structurally clean after each GREEN (SSE/poll lifecycle effects grouped by concern, helpers extracted at the top, comments cite UI-SPEC sections and 55-PATTERNS.md guidance).

## Files Created/Modified

See `key-files` block in the frontmatter for the structured list. Summary:

**Created (5):**
- `panels/coding/EtmTailSheet.tsx` (~270 LOC)
- `panels/coding/EtmTailSheet.test.tsx` (16 cases)
- `panels/coding/WorkflowStatusPanel.tsx` (~240 LOC)
- `panels/coding/WorkflowStatusPanel.test.tsx` (13 cases)
- `components/ui/sheet.tsx` (~155 LOC; shadcn 'new-york' preset)

**Modified (5):**
- `panels/NavBar.tsx` — additive: Radio import + ETM trigger block + unread-count derivation
- `panels/NavBar.test.tsx` — +5 Phase 55-12 cases
- `routes/UnifiedViewer.tsx` — additive: 2 import lines + 2 coding-gated JSX mounts
- `routes/UnifiedViewer.test.tsx` — +1 source-grep audit case
- `test-setup.ts` — +EventSource stub

## Decisions Made

See `key-decisions` block in the frontmatter for the structured list. Highlights:

1. **Logger category mapping NETWORK → API.** The plan's `<read_first>` and `<behavior>` blocks reference `Logger.Categories.NETWORK`. The unified-viewer's `loggingConfig.ts` (Phase 45 baseline) ships only 8 categories: DEFAULT/ROUTING/API/STORE/GRAPH/FILTERS/PANELS/LOGGER — no NETWORK. Plan 55-07's StatsBar (the first SSE consumer in this phase) already used API for SSE-state changes. Aligning EtmTailSheet + WorkflowStatusPanel with API keeps the category semantics consistent across Phase 55 surfaces. Documented as Rule 3 deviation.
2. **Burst debounce two-path collapsed into single helper.** Single-message path uses `setTimeout(flush, 0)` so the common case has near-zero lag while still draining via the same flush ref. When the accumulator reaches 2+ items, the debounce kicks in at 250ms per UI-SPEC §13.3. Avoids maintaining two separate flush paths.
3. **`reconnectDelay(attempt)` exported as a pure helper.** Same pattern as Plan 55-07's `backoffDelay` export — Test 5 walks attempts 0/1/2 → 1s/2s/4s deterministically without driving TanStack Query's scheduler.
4. **Small-screen auto-close on row click.** Desktop layouts keep the sheet open for context; mobile/narrow layouts (window.innerWidth < 768) dismiss so the user can see the canvas-side selection.
5. **Local WorkflowStatusPayload interface (no dashboard import).** Avoids cross-module coupling; if the wire shape drifts, the local interface fails type-check at the fetch call site.
6. **Failed step Retry link stops event propagation.** Per UI-SPEC §13.4 there is NO in-viewer retry — the Retry anchor opens the dashboard's UKB-Ops view at http://localhost:3032/ukb in a new tab.
7. **NavBar unread-count badge uses lastSeenObsId snapshot.** Records the newest observation id on the etmSheetOpen=true edge; counts observations newer than that. Falls back to 30s-recency for the initial pre-open state. When the snapshot scrolls off the 100-item buffer, counts all observations.
8. **Two separate coding-gated JSX blocks in UnifiedViewer.** Matches the plan's `<interfaces>` block literally and makes the source-grep audit `system === 'coding'[^]*X` pass cleanly for both surfaces.
9. **Global EventSource stub in test-setup.ts.** Since EtmTailSheet now mounts under the live UnifiedViewer at `/viewer/coding`, any test that mounts the routing layer would crash with `ReferenceError: EventSource is not defined`. Setup-layer stub fixes the entire class of failures with one change.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking issue] Mapped `Logger.Categories.NETWORK` → `Logger.Categories.API`**

- **Found during:** Task 1 GREEN implementation; first attempt to use `Logger.info(Logger.Categories.NETWORK, …)` failed TypeScript with "Property 'NETWORK' does not exist on type ...".
- **Issue:** The plan's `<read_first>` and `<behavior>` blocks for both tasks reference `Logger.Categories.NETWORK`. The unified-viewer's `lib/logging/config/loggingConfig.ts` (Phase 45 baseline) defines only 8 categories: DEFAULT/ROUTING/API/STORE/GRAPH/FILTERS/PANELS/LOGGER. NETWORK does not exist.
- **Fix:** Used `Logger.Categories.API` for SSE state transitions and polling errors in both EtmTailSheet.tsx and WorkflowStatusPanel.tsx. This matches Plan 55-07 StatsBar.tsx — the first SSE-consuming component in this phase, which already established `API` as the convention for SSE state changes. Adding a NETWORK category in this plan would have been a cross-cutting infrastructure change outside the plan's `files_modified` scope (would require editing loggingConfig.ts, loggingColors.ts, and possibly Logger.test.ts).
- **Files modified:** `panels/coding/EtmTailSheet.tsx`, `panels/coding/WorkflowStatusPanel.tsx` (used API instead of NETWORK)
- **Verification:** All 29 plan-targeted tests GREEN; full suite 519/519 GREEN; tsc clean. Logger output during test runs confirms `[API]` category prefix on SSE / polling messages.
- **Committed in:** `1075e9fb5` (Task 1 GREEN), `d499f35d7` (Task 2 GREEN)

**2. [Rule 3 — Blocking issue] Added global EventSource stub to test-setup.ts**

- **Found during:** Task 3 GREEN; first run of `npx vitest run src/routes/UnifiedViewer.test.tsx` (which now mounts EtmTailSheet under the live coding tab) crashed with 6 unhandled `ReferenceError: EventSource is not defined`.
- **Issue:** jsdom does not implement the EventSource interface. EtmTailSheet.test.tsx installs its own `MockEventSource` locally because it needs to drive onopen/onmessage/onerror events directly. But the live UnifiedViewer routing tests (`/viewer/coding`) now mount EtmTailSheet incidentally — and they have no SSE mock — so the constructor call crashes the React commit phase.
- **Fix:** Added a no-op `EventSource` stub at the bottom of `src/test-setup.ts` (parallel to the existing `ResizeObserver`, `WebGLRenderingContext` stubs). The stub class has a `url` property, the `readyState`, `onopen`, `onmessage`, `onerror` handlers, a `close()` method, and the event-target methods. Attached to both `globalThis` and `window` to cover both code paths. EtmTailSheet's own tests still install MockEventSource locally because they need richer assertion-driven behavior; the global stub is the fallback for unrelated tests.
- **Files modified:** `src/test-setup.ts`
- **Verification:** UnifiedViewer routing tests went from 7 failing / 6 passing to 13/13 GREEN. No regression on EtmTailSheet's own SSE tests (the MockEventSource local install shadows the stub).
- **Committed in:** `ddcc6fafd` (Task 3 GREEN — part of the same iteration since the stub is a direct consequence of mounting EtmTailSheet under the live route).

**3. [Rule 2 — Missing critical functionality] Added `SheetDescription` (sr-only) to silence the Radix "Missing Description" warning**

- **Found during:** Task 1 GREEN test run; vitest output included Radix UI's warning `Warning: Missing 'Description' or 'aria-describedby={undefined}' for {DialogContent}`.
- **Issue:** Radix Dialog requires a `<DialogDescription>` (or an `aria-describedby` reference) for assistive-tech compliance. The warning fires once per render at production-runtime AND in the test environment. The plan's `<action>` block did not specify a description, so the first GREEN implementation omitted it.
- **Fix:** Added `<SheetDescription className="sr-only">Streaming observations from the ETM observation writer.</SheetDescription>` inside `<SheetHeader>`. The `sr-only` Tailwind class hides the text visually but keeps it accessible to screen readers per the shadcn convention. This is a Rule 2 missing-critical-functionality fix — assistive-tech support is a correctness concern under UI-SPEC §15 (a11y baseline).
- **Files modified:** `src/panels/coding/EtmTailSheet.tsx`
- **Verification:** Warning eliminated from vitest output; sheet still renders and behaves identically for sighted users; all 16 tests still GREEN.
- **Committed in:** `1075e9fb5` (Task 1 GREEN — part of the same iteration since the description add is a polish-pass on the sheet structure).

---

**Total deviations:** 3 auto-fixed (2 Rule 3 blocking, 1 Rule 2 missing critical functionality)

**Impact on plan:** None changes plan intent.
- The Logger.NETWORK → API mapping preserves the plan's discipline (zero raw console, all events categorized) and aligns with the already-established Phase 55 convention.
- The EventSource stub is test-infrastructure-only; production code uses the browser-native EventSource unchanged.
- The SheetDescription add strengthens a11y compliance without changing the plan's UX surface.

## Issues Encountered

- **Worktree HEAD initial drift.** Worktree spawned at `a4f832dbc` (a Phase 46 tip) instead of the expected Phase 55 base `dd6c4e373`. Resolved via `git reset --hard dd6c4e37390c001ab0b7d00d19f3372df1d8a4ce` per the orchestrator's `<worktree_branch_check>` protocol. No commits before the reset.
- **Worktree `node_modules` missing.** Standard recurring pattern — symlinked the main repo's `integrations/unified-viewer/node_modules` into the worktree via `node -e require('fs').symlinkSync(...)`. Gitignored, so no commit risk. Documented in Plans 55-04 / 55-07 / 55-08 / 55-10 / 55-11 SUMMARYs.
- **No code-level issues.** Both surfaces landed cleanly after the standard RED → GREEN cycle (modulo the 3 auto-fix deviations above, all of which were internal tightening). Full vitest suite never dropped below GREEN for more than one iteration per task.

## Verification

- **Test gate** — all targeted cases + full project regression GREEN:
  ```
  npx vitest run src/panels/coding/EtmTailSheet.test.tsx \
                 src/panels/coding/WorkflowStatusPanel.test.tsx \
                 src/panels/NavBar.test.tsx \
                 src/routes/UnifiedViewer.test.tsx --reporter=basic
  # → 4 files, 56 tests, all GREEN

  npx vitest run
  # → Test Files 42 passed (42); Tests 519 passed (519)
  ```
- **TSC gate**: `npx tsc --noEmit` → exit 0 (empty output).
- **Vite build gate**: `npx vite build` → exit 0 in 4.51s. Lazy chunks unchanged from 55-11 baseline (HierarchyNavigator-*.js, TrendingPanel-*.js, IssueTriageView-*.js); EtmTailSheet + WorkflowStatusPanel ship in the main bundle as statically-imported coding-only surfaces.
- **Logger discipline**:
  ```
  grep -rnE "console\.(log|warn|error|info|debug)" \
       src/panels/coding/EtmTailSheet.tsx \
       src/panels/coding/WorkflowStatusPanel.tsx
  # → 0 matches
  ```
- **Plan grep gates** (all PASS):
  - EtmTailSheet acceptance grep `EventSource|aria-live|bg-emerald-500|setEtmSheetOpen|pushObservation` (need ≥5): **11**
  - WorkflowStatusPanel acceptance grep `localhost:3033/api/ukb/status|idleSinceRef|Collapsible|Progress` (need ≥4): **21**
  - UnifiedViewer `EtmTailSheet|WorkflowStatusPanel` (need ≥2): **6**
  - NavBar `Radio|"Open observation stream"` (need ≥2): **3**
  - UnifiedViewer source-grep `system === 'coding'[^]*EtmTailSheet`: PASS
  - UnifiedViewer source-grep `system === 'coding'[^]*WorkflowStatusPanel`: PASS
  - Zero raw `console.*` in EtmTailSheet.tsx + WorkflowStatusPanel.tsx

## User Setup Required

None — pure frontend extension. No new npm packages, no new environment variables, no new external service configuration. The two backend endpoints these surfaces consume are already live:

- **`/api/coding/observations/stream`** — shipped by Plan 55-06; live on obs-api (`launchctl list | grep com.coding.obs-api`).
- **`/api/ukb/status`** — long-standing Health API endpoint on port 3033 (the dashboard's ukb-workflow-modal consumes the same).

After merging this plan back to main, the operator's standard `launchctl kickstart` cycle (which routinely runs to pick up obs-api code changes) needs no special action for Phase 55-12 — both endpoints were already in production.

## Manual Verification Steps (Operator)

The plan's `<done>` blocks include gsd-browser visual smoke screenshots. The executor cannot reliably spin up the Vite dev server in the worktree (shares the main repo's `node_modules` but not its dev-server lifecycle). To complete the visual smoke:

1. From a session with `coding-services` running: `cd integrations/unified-viewer && npm run dev` → http://localhost:5173/viewer/coding
2. `gsd-browser navigate http://localhost:5173/viewer/coding && gsd-browser screenshot /tmp/55-12-coding-full.png` — expect: NavBar with the 📡 ETM icon in the right cluster, StatsBar, FilterRail (all sections), main canvas, LslTimelineStrip, Footer, WorkflowStatusPanel (collapsed "No workflows running." chip when idle).
3. `gsd-browser click "[aria-label='Open observation stream']" && gsd-browser screenshot /tmp/55-12-etm-open.png` — expect: right-side Sheet open with "ETM Live Tail" header + LIVE/Connecting indicator + observation rows (or "No observations received yet." if the stream is quiet).
4. With obs-api emitting observations (e.g., during an active `ukb` workflow), the LIVE dot should pulse and rows should stream in with violet/blue/teal/amber agent tags.
5. `gsd-browser navigate http://localhost:5173/viewer/okb && gsd-browser screenshot /tmp/55-12-okb-full.png` — expect: NavBar WITHOUT the ETM icon, no LslTimelineStrip below the canvas, no WorkflowStatusPanel below the Footer (coding-only gating works).
6. Press `t` (no input focused) — expect the ETM sheet to toggle open/closed.
7. If a UKB workflow is running (start via `ukb` per the MCP tool), the WorkflowStatusPanel chip should auto-expand into the per-step Progress card showing step rows; 30s after the workflow completes, the panel auto-collapses back to the chip.

## Next Phase Readiness

- **Plan 55-13 (LSL session multi-select composer) UNBLOCKED.** UnifiedViewer.tsx's structurally-minimal additive pattern continues — 55-13's edits (likely an additional FilterRail composer + a multi-select chip row above the canvas) will merge cleanly without touching any 55-07/55-10/55-11/55-12 wiring.
- **Phase 55 D-55-02b coding-only surface set is COMPLETE.** 4 of 4 surfaces delivered across Plans 55-11 (HierarchyNavigator #13 + LslTimelineStrip #14) and 55-12 (EtmTailSheet #15 + WorkflowStatusPanel #16).
- **The shadcn Sheet primitive at `components/ui/sheet.tsx`** is reusable for any future plan that needs a slide-out panel (e.g., a mobile SidePanel drawer per UI-SPEC §11 row 8 deferred). The forwardRef + radix-ui re-export pattern matches the rest of the shadcn UI library here.
- **The `reconnectDelay(attempt)` helper exported from EtmTailSheet.tsx** is a general utility for any future SSE consumer that needs the 1s/2s/4s/8s/16s capped backoff schedule (mirrors Plan 55-07's `backoffDelay` for StatsBar).
- **Deferred (out of scope, documented for follow-up):**
  - The plan mentioned `_kmStore` and `mountV1RoutesForTest` infrastructure in Plan 55-06 — not touched here; this plan is purely frontend.
  - The 30s recency-window threshold for the unread badge is a magic number; a future polish-pass could parameterize it via the store or a constant.
  - The `referencedEntities` field on Observation is currently untyped in `api/schemas.ts` (Zod schema doesn't include it). EtmTailSheet's row-click handler reads it via an `unknown` cast. When a future plan widens the ObservationSchema to include `referencedEntities?: string[]`, the cast can be removed.

## Known Stubs

None. Both surfaces ship complete, end-to-end, against live backend endpoints:
- EtmTailSheet consumes `/api/coding/observations/stream` (Plan 55-06 SSE, live).
- WorkflowStatusPanel polls `http://localhost:3033/api/ukb/status` (long-standing Health API).

The badge-count derivation gracefully handles the empty state (returns 0 / hidden) so there's no rendering quirk when the observation buffer is empty.

## Threat Flags

None — the plan strictly preserves Phase 55's trust boundary. Per the plan's threat register:

- **T-55-12-01** (Cross-system data leak): mitigated via defense-in-depth — both component-level `if (system !== 'coding') return null` AND parent-level `system === 'coding' && <X />` (verified by NavBar Test "ETM tail trigger is NOT rendered on okb tab" + UnifiedViewer source-grep audit + EtmTailSheet Test 1 + WorkflowStatusPanel Test 1).
- **T-55-12-02** (XSS via observation summary): mitigated via React text-node escaping; no `dangerouslySetInnerHTML` used (verified by `grep -c "dangerouslySetInnerHTML" src/panels/coding/EtmTailSheet.tsx` → 0).
- **T-55-12-03** (Infinite SSE reconnect loop): mitigated via the exponential backoff capped at 16s (verified by Test 5's attempts 0/1/2 → 1s/2s/4s schedule + `reconnectDelay(attempt >= 5)` returning 16000).
- **T-55-12-04** (Runaway polling): mitigated via the idleSinceRef sentinel (>5min idle pauses polling; user click resumes).
- **T-55-12-05** (LIVE indicator timing): accepted per plan — localhost-only Health API trust class.

**Package legitimacy:** No new npm packages added. `lucide-react` (Radio icon) and `radix-ui` (Dialog umbrella → Sheet) are Phase 45 dependencies; no `npm install` invoked.

## Self-Check: PASSED

Verifying claims before returning to orchestrator:

**Files created (verified via Read tool):**
- `integrations/unified-viewer/src/panels/coding/EtmTailSheet.tsx` — FOUND
- `integrations/unified-viewer/src/panels/coding/EtmTailSheet.test.tsx` — FOUND
- `integrations/unified-viewer/src/panels/coding/WorkflowStatusPanel.tsx` — FOUND
- `integrations/unified-viewer/src/panels/coding/WorkflowStatusPanel.test.tsx` — FOUND
- `integrations/unified-viewer/src/components/ui/sheet.tsx` — FOUND

**Files modified (verified):**
- `integrations/unified-viewer/src/panels/NavBar.tsx` — FOUND (additive)
- `integrations/unified-viewer/src/panels/NavBar.test.tsx` — FOUND (additive)
- `integrations/unified-viewer/src/routes/UnifiedViewer.tsx` — FOUND (additive)
- `integrations/unified-viewer/src/routes/UnifiedViewer.test.tsx` — FOUND (additive)
- `integrations/unified-viewer/src/test-setup.ts` — FOUND (additive)

**Commits exist on `worktree-agent-ab87794ded57ac5b5`:**
- `1a974bb01` test(55-12): RED — failing tests for EtmTailSheet (SSE consumer + Sheet) — FOUND
- `1075e9fb5` feat(55-12): GREEN — EtmTailSheet SSE consumer + shadcn Sheet (Surface #15) — FOUND
- `f14ed83b5` test(55-12): RED — failing tests for WorkflowStatusPanel (Surface #16) — FOUND
- `d499f35d7` feat(55-12): GREEN — WorkflowStatusPanel inline UKB-Ops status (Surface #16) — FOUND
- `3c8c9f894` test(55-12): RED — NavBar ETM trigger + UnifiedViewer EtmTailSheet/WorkflowStatusPanel mount audit — FOUND
- `ddcc6fafd` feat(55-12): GREEN — wire NavBar ETM trigger + UnifiedViewer mounts — FOUND

**Verification gates re-run:**
- `npx vitest run` (full project suite) → **519/519 GREEN across 42 files**
- `npx vitest run` (targeted 4 files: EtmTailSheet + WorkflowStatusPanel + NavBar + UnifiedViewer) → **56/56 GREEN**
- `npx tsc --noEmit` → exit 0 (empty output)
- `npx vite build` → exit 0 in 4.51s
- Console-call gate: 0 matches across EtmTailSheet.tsx + WorkflowStatusPanel.tsx
- All 6 plan grep gates PASS

**TDD gate compliance:**
- Task 1 RED gate: `1a974bb01` (test) precedes GREEN `1075e9fb5` ✓
- Task 1 GREEN gate: `1075e9fb5` (feat) lands after RED ✓
- Task 2 RED gate: `f14ed83b5` (test) precedes GREEN `d499f35d7` ✓
- Task 2 GREEN gate: `d499f35d7` (feat) lands after RED ✓
- Task 3 RED gate: `3c8c9f894` (test) precedes GREEN `ddcc6fafd` ✓
- Task 3 GREEN gate: `ddcc6fafd` (feat) lands after RED ✓
- REFACTOR phase: skipped — code structurally clean after each GREEN.

---
*Phase: 55-unified-viewer-feature-parity-with-vokb*
*Plan: 12*
*Completed: 2026-06-10*
