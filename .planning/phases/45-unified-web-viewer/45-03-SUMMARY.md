---
phase: 45-unified-web-viewer
plan: 03
subsystem: viewer-chrome
type: execute
status: complete
date: 2026-06-07
tags:
  - filter-rail
  - entity-detail-panel
  - nav-bar
  - side-panel
  - keyboard-shortcuts
  - state-contract
  - logger
  - a11y

depends_on:
  - 45-01
  - 45-02

provides:
  - panels/FilterRail
  - panels/EntityDetailPanel
  - panels/NavBar
  - panels/SidePanel
  - panels/Footer
  - components/IconButton
  - components/KeyboardHelpDialog
  - hooks/useKeyboardShortcuts
  - lib-domain/states (8 surfaces)
  - lib-domain/markdown-text (lightweight, XSS-safe)
  - lib/logging/Logger (VOKB-style — port from /Users/Q284340/Agentic/_work/rapid-automations/integrations/operational-knowledge-management/viewer/src/utils/logging/)

affects:
  - routes/UnifiedViewer.tsx (rewritten — composes the full chrome)
  - graph/SigmaCanvas.tsx (ZoomControls cluster now uses IconButton)
  - graph/types.ts (added Phase-39 DATA-02 fields + index signature)
  - test-setup.ts (jsdom localStorage polyfill)

tech-stack:
  added:
    - "@radix-ui/react-tooltip (already in deps; first use here)"
    - "@radix-ui/react-tabs (already in deps; first use here)"
    - "@radix-ui/react-collapsible (already in deps; first use here)"
  patterns:
    - "Composition primitive: IconButton = Button(variant=ghost,size=icon) + Tooltip + non-optional ariaLabel"
    - "Document-level keydown listener with skip-when-input-focused discipline (UI-SPEC § Keyboard)"
    - "Verbatim VOKB Logger port with localStorage persistence and category/level filters"
    - "Mutually-exclusive State Contract components (8 named states; copy strings VERBATIM from UI-SPEC § Copywriting)"
    - "Side-panel system gating (Markdown tab iff system='okb'; RCA tab iff system='cap')"

key-files:
  created:
    - integrations/unified-viewer/src/lib/logging/Logger.ts
    - integrations/unified-viewer/src/lib/logging/Logger.test.ts
    - integrations/unified-viewer/src/lib/logging/index.ts
    - integrations/unified-viewer/src/lib/logging/config/loggingConfig.ts
    - integrations/unified-viewer/src/lib/logging/config/loggingColors.ts
    - integrations/unified-viewer/src/components/IconButton.tsx
    - integrations/unified-viewer/src/components/IconButton.a11y.test.tsx
    - integrations/unified-viewer/src/components/KeyboardHelpDialog.tsx
    - integrations/unified-viewer/src/hooks/useKeyboardShortcuts.ts
    - integrations/unified-viewer/src/hooks/useKeyboardShortcuts.test.tsx
    - integrations/unified-viewer/src/lib-domain/states.tsx
    - integrations/unified-viewer/src/lib-domain/states.test.tsx
    - integrations/unified-viewer/src/lib-domain/markdown-text.tsx
    - integrations/unified-viewer/src/lib-domain/markdown-text.test.tsx
    - integrations/unified-viewer/src/panels/FilterRail.tsx
    - integrations/unified-viewer/src/panels/FilterRail.test.tsx
    - integrations/unified-viewer/src/panels/EntityDetailPanel.tsx
    - integrations/unified-viewer/src/panels/EntityDetailPanel.test.tsx
    - integrations/unified-viewer/src/panels/NavBar.tsx
    - integrations/unified-viewer/src/panels/NavBar.test.tsx
    - integrations/unified-viewer/src/panels/SidePanel.tsx
    - integrations/unified-viewer/src/panels/SidePanel.test.tsx
    - integrations/unified-viewer/src/panels/Footer.tsx
    - integrations/unified-viewer/src/panels/Footer.test.tsx
    - .planning/phases/45-unified-web-viewer/45-FOLLOWUPS.md
  modified:
    - integrations/unified-viewer/src/routes/UnifiedViewer.tsx (rewritten)
    - integrations/unified-viewer/src/routes/UnifiedViewer.test.tsx (updated for new chrome)
    - integrations/unified-viewer/src/graph/SigmaCanvas.tsx (ZoomControls → IconButton)
    - integrations/unified-viewer/src/graph/types.ts (DATA-02 fields + index signature)
    - integrations/unified-viewer/src/test-setup.ts (jsdom localStorage polyfill)

decisions:
  - "Logger port keeps the VOKB public surface verbatim (Logger.error/warn/info/debug/trace, setActive*, get*, enableCategory, disableCategory, Levels, Categories). Categories adapted to this app (Routing/Api/Store/Graph/Filters/Panels/Logger/Default). localStorage keys rebadged unifiedViewer_*."
  - "LoggingControl UI surface deferred to a follow-up (45-FOLLOWUPS.md) — backend + tests + audit gate are landed; the UI dialog is a small standalone item Plan 04 or 05 will pick up."
  - "Entity type widened with an [k:string]:unknown index signature so EntityDetailPanel can read camelCase DATA-02 fields without TS-strict breaks. No prod logic change — Phase 39 already stamps these fields."
  - "UnifiedViewer.test.tsx updated to assert active nav-link state instead of the old wordmark-contains-system pattern. The wordmark is now the static \"Unified Viewer\" per UI-SPEC § Layout Contract row 1; system identity surfaces via the active NavLink (font-bold + accent underline)."
  - "useKeyboardShortcuts skips its / ? f handlers when an <input> or <textarea> has focus (T-45-03-04 mitigation). Esc ALWAYS fires (escape hatch — UI-SPEC override)."

metrics:
  duration_minutes: ~120
  completed_date: 2026-06-07
  test_files_added: 9
  test_count_baseline: 77
  test_count_final: 143
  test_count_delta: 66
  commits: 3
---

# Phase 45 Plan 03: Unified Viewer Chrome Summary

A complete user-facing chrome layer for the unified-viewer — Logger port (rule from mid-execution), IconButton + keyboard shortcuts + State Contract surfaces, then FilterRail + EntityDetailPanel + NavBar + SidePanel + Footer wired into a `ViewerCore` that routes between graph-canvas and state surfaces. Cross-system selection-reset still hinges on Plan 02's `<UnifiedViewer key={system}/>` remount.

## What was built

### Task 0 (prepended mid-execution): Logger port

The user added a project-wide rule mid-execution (captured in `~/.claude/projects/-Users-Q284340-Agentic-coding/memory/feedback_logger_class.md`): all frontend code in the unified-viewer must use a VOKB-style structured `Logger` class instead of raw `console.*`. The Logger gives per-category and per-level filters that persist in `localStorage` and can be toggled at runtime.

- **Source:** `src/lib/logging/Logger.ts` — verbatim VOKB port with `unifiedViewer_*` localStorage keys (was `vokb_*`).
- **Config:** `src/lib/logging/config/loggingConfig.ts` — app-specific categories (Routing / Api / Store / Graph / Filters / Panels / Logger / Default). Levels unchanged (ERROR / WARN / INFO / DEBUG / TRACE; defaults: ERROR + WARN + INFO).
- **Public surface:** `src/lib/logging/index.ts` re-exports `Logger`, `LogLevels`, `LogCategories`, `loggingColors`.
- **Audit gate:** `grep -rn 'console\.' integrations/unified-viewer/src` returns zero matches outside `src/lib/logging/Logger.ts`.
- **Tests:** 11 (level filter, category filter, localStorage round-trip, TRACE→info fallback, invalid-name rejection, enable/disable persistence).

### Task 1: IconButton primitive + keyboard model + States + markdown-text port

- `components/IconButton.tsx` — composition of shadcn `Button(variant=ghost,size=icon)` + Radix Tooltip with **non-optional** `ariaLabel: string`. Omitting `ariaLabel` is a compile error (proven by a `@ts-expect-error` test). Refactored Plan 02's ZoomControls cluster to consume `IconButton` (single source of truth — UI-SPEC § Icon-only controls).
- `components/KeyboardHelpDialog.tsx` — Radix Dialog with header "Keyboard shortcuts" (UI-SPEC verbatim) + 7-row shortcut table; close button labelled "Close".
- `hooks/useKeyboardShortcuts.ts` — document-level keydown listener. `/` `?` `f` skip when an `<input>` or `<textarea>` has focus (T-45-03-04 mitigation); `Esc` always fires. `Esc` cascade: blur search → close help dialog → deselect node. `/` focuses the search input via the `registerSearchInputRef` callback FilterRail hands over.
- `lib-domain/states.tsx` — 8 named State Contract surfaces (`InitialLoadingState`, `EmptyNoDataState`, `EmptyFilterState`, `EmptySearchState`, `EmptyNodeDetailState`, `ErrorUnreachableState`, `ErrorCorsState`, `ErrorOntologyFetchState`). All copy strings VERBATIM from UI-SPEC § Copywriting; the destructive banner classes are byte-identical to `integrations/system-health-dashboard/src/pages/digests.tsx:304-308` per UI-SPEC § State Contract.
- `lib-domain/markdown-text.tsx` — verbatim port from `integrations/system-health-dashboard/src/components/markdown-text.tsx` (135-line lightweight inline renderer). No raw-HTML injection anywhere (T-45-03-01 mitigation): a `<script>` token renders as escaped text, verified by the sidecar test.

Total Task 1 tests: 29 (IconButton.a11y × 6, states × 8, markdown-text × 7, useKeyboardShortcuts × 8).

### Task 2: Panels + ViewerCore wiring

- `panels/FilterRail.tsx` — left rail; `w-64` expanded, `w-12` icon strip when collapsed. Search input (placeholder `Search entities...` verbatim from UI-SPEC), Level checkboxes L0–L3, Class multi-select sourced from `/api/v1/ontology/classes` via TanStack Query. Empty `selectedClasses` Set = "all classes visible" (T-45-03-03 semantics). Hands the search input ref to `useKeyboardShortcuts` via `registerSearchInputRef`.
- `panels/EntityDetailPanel.tsx` — right side default tab. Empty state via `<EmptyNodeDetailState/>` when no selection. Header: entity name + outline Badge with `style={{borderColor: classColor(...)}}`. 5 sections in order:
  1. **Description** via `<MarkdownText/>` (T-45-03-01 XSS escape verified by test).
  2. **Identity** (Class / Level / Parent / Created / Last confirmed).
  3. **Provenance** reads camelCase fields `createdBy` / `confirmationCount` / `lastConfirmedBy` / `lastSegment` per Plan 44-16 lock; legacy entities render `—`.
  4. **Neighbors** — filtered incident relations; clicking a neighbor calls `setSelectedNode(neighborId)`.
  5. **Raw** — `<Collapsible defaultOpen={false}>` with `<pre class="font-mono text-xs">{JSON.stringify(...)}</pre>`.
- `panels/NavBar.tsx` — sticky h-16 with static wordmark "Unified Viewer", three `<NavLink>`s, theme-toggle + keyboard-help `IconButton`s. Active link styled with `font-bold` + accent underline (the sole display-weight exception per UI-SPEC § Typography). Theme toggle writes to Zustand store + persists to `localStorage` + flips `document.documentElement.classList.toggle('dark', …)`.
- `panels/SidePanel.tsx` — Radix Tabs shell. Entity tab always present; Markdown tab iff `system==='okb'`; RCA tab iff `system==='cap'`. Width `w-96` default, `w-[30rem]` when Markdown or RCA is active. Markdown + RCA tabs render placeholder content until Plans 04 / 05.
- `panels/Footer.tsx` — h-8 bottom strip with verbatim `Showing {visible} of {total} nodes · {edges} edges` (4 `tabular-nums` spans for stable width).
- `routes/UnifiedViewer.tsx` (rewrite) — composes the full chrome. Routes between 5 mutually-exclusive states (initial-load / empty-no-data / empty-search / empty-filter / error-cors / error-unreachable / happy-path-Canvas). Mounts `KeyboardHelpDialog` + `useKeyboardShortcuts` once per ViewerCore (key={system} remount tears them down on system swap).

Total Task 2 tests: 26 (FilterRail × 7, EntityDetailPanel × 8, NavBar × 4, SidePanel × 5, Footer × 2).

## Verification

### Plan grep gates (all passing)

| Gate                                                         | Expected | Actual |
| ------------------------------------------------------------ | -------: | -----: |
| `grep -c "ariaLabel: string;" IconButton.tsx`                | 1        | 1      |
| `grep -c '"Search entities..."' FilterRail.tsx`              | 1        | 1      |
| `grep -c "Click any node to see its details" states.tsx`     | ≥1       | 2      |
| `grep -rE "dangerouslySetInnerHTML" src/`                    | 0        | 0      |
| `grep -c "tabular-nums" Footer.tsx`                          | ≥1       | 4      |
| audit grep `console\.` outside `Logger.ts`                   | 0        | 0      |

### Test counts

- Files: 21 (was 11 at the 45-02 tip; +10 new test files in Plan 03).
- Tests: **143 passed** (was 77; +66 new).
- Build: `npm run build` (tsc --noEmit + vite build) is clean.

### Visual smoke (gsd-browser, against live obs-api on `http://localhost:12436`)

- `/viewer/coding` renders all 3 panes + NavBar + Footer. Footer shows `Showing 1000 of 1000 nodes · 0 edges`.
- `?` keystroke opens the Keyboard Shortcuts dialog with all 7 rows; `Esc`/Close closes it.
- `/` keystroke focuses the search input (verified via `document.activeElement?.dataset.testid === 'filter-search'`).
- Theme toggle flips `<html class="dark">` and re-paints the entire chrome (dark mode screenshot captured at `/tmp/viewer-dark.png` for the verifier).
- ZoomControls bottom-right has the 3 IconButtons (zoom in / zoom out / fit to view) with proper Tooltip on hover.

Full operator checkpoint (Task 3) — the 15-step manual sweep including click-a-neighbour, level-checkbox flip, class multi-select, stop-obs-api-to-see-ErrorUnreachable retry flow — is deferred to the operator (Task 3 is a `checkpoint:human-verify` gate per the plan).

## Deviations from Plan

### Rule 2 — auto-added critical functionality

**1. [Rule 2 — Test infrastructure] jsdom localStorage polyfill in `test-setup.ts`**

- **Found during:** Task 0 (Logger persistence tests)
- **Issue:** jsdom 25 in this project exposes `window.localStorage` as a plain object with NO Storage methods (`setItem`/`getItem`/`removeItem` are `undefined`). The Logger's `_load/_saveSetting` calls silently swallow the resulting `TypeError`s and fall back to defaults, so the Logger persistence-round-trip tests would never see state survive a `_reloadFromStorage()`.
- **Fix:** Added a minimal in-memory polyfill in `src/test-setup.ts` that runs before Logger.* tests touch localStorage. Polyfill only installs when the test env shows a broken Storage; production code is untouched.
- **Files modified:** `integrations/unified-viewer/src/test-setup.ts`
- **Commit:** `1fbcdedba`

**2. [Rule 2 — Test scaffolding] `UnifiedViewer.test.tsx` updated for new chrome**

- **Found during:** Task 2 (ViewerCore rewrite)
- **Issue:** Plan 01's `viewer-wordmark` testid carried the system label ("Coding"); the new NavBar wordmark is the static "Unified Viewer" string with system identity in the active NavLink. The existing 7 tests would have failed on the new markup.
- **Fix:** Updated the routing tests to assert against `data-active="true"` on `nav-link-{system}` instead of the old wordmark-contains-system pattern. Also added `QueryClientProvider` wrap + `useGraphData` mock (FilterRail uses `useQuery`).
- **Files modified:** `integrations/unified-viewer/src/routes/UnifiedViewer.test.tsx`
- **Commit:** `11649b259`

**3. [Rule 2 — Type widening] `graph/types.ts` Entity widened with DATA-02 fields + index signature**

- **Found during:** Task 2 (EntityDetailPanel — Provenance + Identity sections)
- **Issue:** The graph-domain `Entity` type was a closed shape with only `id / name / ontologyClass / level / description / metadata`. The wire-layer `ApiClient.Entity` carries the camelCase Phase 39 fields (`createdBy`, `confirmationCount`, …) via its `[k: string]: unknown` index signature, but the graph-domain `Entity` blocked the EntityDetailPanel from reading them under TS-strict.
- **Fix:** Added optional camelCase fields + a top-level index signature to the graph-domain `Entity`. No prod logic change — Phase 39 already stamps these on every entity write. The Raw JSON section also benefits from the index signature so it can stringify any extra server-side field.
- **Files modified:** `integrations/unified-viewer/src/graph/types.ts`
- **Commit:** `11649b259`

### Followup — LoggingControl UI surface (deferred)

The plan's Task 0 description noted "Optional UI surface (defer to a later plan if time tight)" for a `LoggingControl` dialog that exposes the Logger's level / category toggles at runtime. The backend + tests + audit grep gate landed in Task 0; the UI dialog is deferred and tracked in `.planning/phases/45-unified-web-viewer/45-FOLLOWUPS.md`. Plan 04 or 05 (both already touch the side panel + tab shell) is the natural home. Acceptance gate: dialog opens via either a NavBar "Logging settings" `IconButton` or a button inside the existing Keyboard Help Dialog; toggling persists via `unifiedViewer_activeLog*` keys; a Vitest sidecar verifies the wiring.

## Known Stubs

- `panels/SidePanel.tsx` Markdown tab renders the placeholder "Markdown panel — landing in Plan 04" until Plan 04 ports the `react-markdown + remark-gfm + rehype-highlight` panel from `integrations/memory-visualizer/src/components/MarkdownViewer.tsx`.
- `panels/SidePanel.tsx` RCA tab renders the placeholder "RCA panel — landing in Plan 05" until Plan 05 ports the VOKB ingestion-ops panel (or builds the alternative selected-node RCA walk per UI-SPEC § Panel Contracts Option A vs Option B).
- `Footer.tsx` reads `relations.length` for the edges count; this matches the wire response from `/api/v1/relations` directly. In the live smoke against coding's obs-api the count rendered as `0 edges` — this is upstream data (the coding KG simply has no inter-class relations stored at the moment), not a Plan 03 stub.

Both placeholders are intentional and documented; the plan slate (45-04 / 45-05) explicitly owns each.

## Threat surface scan

No new threat surface introduced beyond what the plan's `<threat_model>` already enumerates. T-45-03-01 / T-45-03-02 / T-45-03-03 / T-45-03-04 / T-45-03-05 are all mitigated and covered by the new test suites. No flags.

## Self-Check: PASSED

- All listed files exist on disk under the worktree:
  - `integrations/unified-viewer/src/lib/logging/{Logger.ts,Logger.test.ts,index.ts,config/loggingConfig.ts,config/loggingColors.ts}`
  - `integrations/unified-viewer/src/components/{IconButton.tsx,IconButton.a11y.test.tsx,KeyboardHelpDialog.tsx}`
  - `integrations/unified-viewer/src/hooks/{useKeyboardShortcuts.ts,useKeyboardShortcuts.test.tsx}`
  - `integrations/unified-viewer/src/lib-domain/{states.tsx,states.test.tsx,markdown-text.tsx,markdown-text.test.tsx}`
  - `integrations/unified-viewer/src/panels/{FilterRail,EntityDetailPanel,NavBar,SidePanel,Footer}.tsx` + matching tests
  - `.planning/phases/45-unified-web-viewer/45-FOLLOWUPS.md`
- All commits present in git log:
  - `1fbcdedba` feat(45-03): port VOKB Logger — categorized, level-filtered, localStorage-persisted
  - `6b33b67f7` feat(45-03): IconButton primitive + keyboard shortcuts + states + markdown-text port
  - `11649b259` feat(45-03): FilterRail + EntityDetailPanel + NavBar + SidePanel + Footer — wire into ViewerCore
- `npx vitest run` → 143/143 GREEN.
- `npm run build` → clean.
- All plan grep gates pass.
- Audit gate `grep -rn 'console\.' src/ | grep -v Logger` → 0 matches.
- gsd-browser smoke confirms `/viewer/coding` renders the full chrome and the `?` `/` `theme-toggle` paths work end-to-end.
