---
phase: 56-unified-viewer-bidirectional-selection-timeline-scale
plan: 03
subsystem: unified-viewer
tags: [lsl-timeline, timestamp-scale, selection-sync, atomic-setstate, vitest-tdd, react-memo]
dependency_graph:
  requires:
    - "Phase 56-01 selection-sync slice (selectionSource / highlightedRowKey / selectedSessionId / setSelection / clearSelection)"
    - "LslTimelineStrip onTickClick atomic-setState pattern (Phase 55-11 baseline lines 287-330)"
    - "pctOfWindow tick-position helper (LslTimelineStrip lines 103-119)"
    - "useGraphData hook for selectedTs reverse-mapping (lines 167-175)"
  provides:
    - "formatScaleLabel(ms, windowMs) named export — duration-adapted format ladder (HH:MM:SS / HH:MM / Mon DD)"
    - "scaleTicks memo + scale row render (7 absolutely-positioned labels with data-testid='lsl-scale-label-N%')"
    - "Container height bump h-8 -> h-12 (Phase 55 UI-SPEC §7 surface change)"
    - "7-field onTickClick atomic write (plain + Cmd/Ctrl branches) — adds highlightedRowKey + selectionSource:'timeline' + selectedSessionId"
    - "Test 19 selection→tick highlight regression lock (graph→timeline AC #2)"
  affects:
    - "HistorySidebar / OccurrenceHistorySidebar (Plan 02 consumes highlightedRowKey for row highlight + scroll)"
    - "Playwright AC #4 + AC #6 e2e checks (Plan 04 — 'timeline tick click cascades to graph + history')"
    - "Plan 04 Phase 55 visual-parity diff capture (h-8 -> h-12 outer container)"
tech-stack:
  added: []
  patterns:
    - "Hand-rolled duration-adapted formatter (no d3-time-format dep) — pattern mirrors fmtLocalTs pad() style"
    - "useMemo-derived scale tick array sharing pctOfWindow with the tick render — single-sourced positioning math"
    - "Atomic 7-field useViewerStore.setState({...}) (LslTimelineStrip.tsx:287-330 idiom — Phase 55 baseline + Phase 56 extension)"
    - "Module-level vi.mock('@/graph/useGraphData') in panel tests — matches OccurrenceHistorySidebar.test.tsx pattern"
    - "data-testid='lsl-scale-label-${pct.toFixed(0)}' — pct-based test ids let tests enumerate without coupling to text labels"
key-files:
  created: []
  modified:
    - "integrations/unified-viewer/src/panels/coding/LslTimelineStrip.tsx"
    - "integrations/unified-viewer/src/panels/coding/LslTimelineStrip.test.tsx"
    - ".planning/phases/56-unified-viewer-bidirectional-selection-timeline-scale/deferred-items.md"
decisions:
  - "Hand-rolled formatScaleLabel — Intl.DateTimeFormat for multi-day branch only (vetted locale string per threat_model T-56-03-03); HH:MM and HH:MM:SS use pad() to match the existing fmtLocalTs style"
  - "7 evenly-spaced labels (midpoint of the 5-8 target from CONTEXT.md D-05) — gives readable spacing at default viewport widths without overlap"
  - "Container bumped to h-12 (h-4 scale + h-6 ticks + 2px breathing room) — minimal regression to Phase 55 §7 surfaces; Plan 04 captures the visual diff"
  - "Modifier-key (Cmd/Ctrl) branch also writes selectionSource/selectedSessionId/highlightedRowKey — first-id-of-union as highlightedRowKey, consistent with plain-click branch; otherwise the additive flow would leave selection state stale"
  - "Tasks 1 and 2 ship as a single GREEN feat commit instead of two — both touch the same useState block + same render JSX + share the same test infrastructure, so splitting would force a half-committed intermediate state where Test 18 fails. RED commit explicitly covers both tasks."
  - "[Rule 3 — Blocking] vi.mock('@/graph/useGraphData') added at test module level — required for Test 19 (graph→tick cascade lock) AND neutralises 3 pre-existing baseline crashes (Tests 2/6/9). Test 7 fails for a different latent issue (deselect effect), logged to deferred-items.md."
metrics:
  duration_min: 12
  completed_date: 2026-06-13
  tasks_completed: 2
  files_created: 0
  files_modified: 3
  commits: 2
requirements_completed: []
---

# Phase 56 Plan 03: LSL Timestamp Scale + Timeline→Graph/History Atomic Cascade Summary

**One-liner:** Hand-rolled timestamp scale row (7 adaptive HH:MM:SS / HH:MM / Mon DD labels) above the existing tick layer of LslTimelineStrip, container bumped h-8→h-12, plus a 7-field atomic onTickClick write that adds `selectionSource: 'timeline'` + `selectedSessionId` + `highlightedRowKey` to both plain and Cmd/Ctrl-click branches — closes AC #1 (readable scale), AC #4 store side (timeline→graph + history cascade), regression-locks AC #2 timeline side (selection→tick highlight via Test 19), and partially advances AC #6 (aggregate `selectedSessionId` now populated).

## Performance

- **Duration:** 12 min
- **Started:** 2026-06-13T07:03:00Z (after worktree base-reset)
- **Completed:** 2026-06-13T07:15:32Z
- **Tasks:** 2 (both TDD)
- **Files modified:** 3 (source + test + deferred-items)

## Outcome

| Acceptance Criterion (from PLAN.md) | Status | Evidence |
|---|---|---|
| AC #1 — readable timestamp scale row | PASS | scaleTicks memo + 7 absolutely-positioned spans with `data-testid="lsl-scale-label-N%"`; Test 14 asserts 5–8 labels rendered (actual: 7) |
| AC #4 (store side) — timeline tick click writes Phase 56 fields atomically | PASS | Test 18 asserts single getState() snapshot with selectionSource='timeline' + selectedSessionId='sess-bbbbbbbb' + highlightedRowKey='e3' + selectedNodeId='e3' + lslSessionFilter=['sess-bbbbbbbb'] |
| AC #2 (timeline side) — graph selection lights up matching tick | PASS (regression-locked) | Test 19 GREEN — selectedNodeId='e3' produces ring-blue-500 on lsl-tick-sess-bbbbbbbb via the unchanged selectedTs→isSelectedBucket cascade |
| AC #6 — aggregate selection field populated | PARTIAL | selectedSessionId now written on every tick click (plain + Cmd/Ctrl); future plan (Plan 02 sibling, then Plan 04 e2e) consumes it for the history-sidebar aggregate scroll path |
| Container height bump does not regress Phase 55 §7 surfaces | PASS | Source grep `h-12` matches; outer container is the only Phase 55 surface touched; existing Test 5 (running-session ring) still GREEN against the inner `h-6` tick row |
| Source-grep gate (formatScaleLabel + selectionSource:'timeline' + selectedSessionId) | PASS | Test 20: formatScaleLabel/lsl-scale-label- = 3, selectionSource:'timeline' = 2 (plain + modifier), selectedSessionId = 4 |
| vitest GREEN for LslTimelineStrip.test.tsx | PASS (with 1 pre-existing baseline failure logged) | 19/20 — Tests 14/15/16/17/18/19/20 all GREEN; Test 7 fails for a baseline reason unrelated to Plan 03 (logged in deferred-items.md) |
| tsc --noEmit clean | PASS | exit 0 after final GREEN commit |

## Accomplishments

- AC #1 closed: the LSL strip now shows a readable timestamp scale that adapts its format to the active window (sub-min → HH:MM:SS, sub-day → HH:MM, multi-day → "Mon DD") and snaps tick labels to evenly-spaced positions across the strip width
- AC #4 store side closed: every tick click — plain OR modifier-key — now writes a coherent 7-field snapshot via a single `useViewerStore.setState({...})`, including the three Phase 56 cross-pane fields the sidebars and graph subscribe to
- AC #2 timeline side regression-locked: Test 19 will fail if a future refactor accidentally removes or breaks the `selectedTs` → `isSelectedBucket` cascade at lines 167-175 + 422-435
- AC #6 partially advanced: `selectedSessionId` is now populated on tick click, giving the LSL session aggregate signal the rest of Phase 56 needs

## Task Commits

Each task was committed atomically per TDD convention:

1. **Task 1 + 2 RED (combined): timestamp scale + atomic write tests** — `16215efc6` (test)
   - 7 new vitest cases (Tests 14-20): scale render, formatScaleLabel ladder, Phase 56 atomic write, graph→tick cascade lock, source-grep gate
   - Module-level `vi.mock('@/graph/useGraphData')` (Rule 3 — neutralises baseline `entities.find` crash for Tests 2/6/9 as a side-effect of being required for Test 19)
   - RED verified: 7 new fails, 13 existing tests pass (the `vi.mock` flipped 3 pre-existing baseline failures to GREEN, leaving only Test 7's latent baseline failure)
2. **Task 1 + 2 GREEN (combined): scale row + helper + atomic write** — `191a1fac0` (feat)
   - Added `formatScaleLabel(ms, windowMs)` named export with the D-05 format ladder
   - Added `scaleTicks` useMemo producing 7 `{ ms, pct, label }` entries
   - Rendered scale row inside a new flex-col wrapper above the existing tick row (which kept its `relative h-6` for unchanged tick math)
   - Bumped outer container `h-8` → `h-12`
   - Extended both plain-click and Cmd/Ctrl-click branches of `onTickClick` to write `highlightedRowKey` + `selectionSource: 'timeline'` + `selectedSessionId` alongside the pre-existing 4 fields
   - GREEN verified: 19/20 vitest cases pass; tsc --noEmit clean; all grep gates pass

**Note:** Tasks 1 and 2 ship as one RED + one GREEN commit (instead of RED1 → GREEN1 → RED2 → GREEN2) — see Deviations below for rationale.

## Files Modified

- `integrations/unified-viewer/src/panels/coding/LslTimelineStrip.tsx` — added `formatScaleLabel` named export, `scaleTicks` memo, scale row inside flex-col wrapper, container h-12 bump, 3 new keys in plain-click `setState`, 3 new keys in modifier-click `setState`
- `integrations/unified-viewer/src/panels/coding/LslTimelineStrip.test.tsx` — added `vi.mock('@/graph/useGraphData')`, `mockEntities` module-level fixture, imported `formatScaleLabel` named export, added Tests 14-20 (scale render + ladder + atomic write + cascade lock + grep gate)
- `.planning/phases/56-unified-viewer-bidirectional-selection-timeline-scale/deferred-items.md` — appended pre-existing Test 7 baseline failure analysis (latent deselect-effect bug; not caused by Plan 03)

## Decisions Made

- **Hand-rolled formatter over d3-time-format** — keeps the file's existing pad() idiom (LslTimelineStrip.tsx:124-132); avoids supply-chain considerations from a fresh dep (threat_model T-56-03-03 / CLAUDE.md package-install hygiene). Multi-day branch uses native `Intl.DateTimeFormat` which is already available in the test runner and produces locale-respecting "Mon DD" strings.
- **7 labels (midpoint of 5–8 from CONTEXT.md D-05)** — gives consistent spacing across all window keys without overlap at the typical viewport widths the unified viewer targets. The pct positions are computed via `pctOfWindow` (same math as ticks) so positioning stays single-sourced.
- **Container h-8 → h-12 (not h-14)** — h-4 scale + h-6 ticks + 2px breathing room fits in h-12. h-14 was kept as a fallback in the test gate (`/h-1[24]/`) in case Plan 04's visual-diff finds the labels still feel cramped; if so the Phase 55 owner can bump to h-14 without touching tests.
- **Modifier-key branch also writes the three Phase 56 fields** — without this, Cmd/Ctrl-click would update `lslSessionFilter` but leave selectionSource/highlightedRowKey/selectedSessionId stale from a prior interaction, which would silently violate the "selection source is always coherent with selection" invariant that the next plan (sibling Plan 02) relies on.
- **One RED + one GREEN commit for both tasks** — both tasks touch the same useState block, the same JSX wrapper, and the same test file. Splitting RED1→GREEN1 would either (a) leave the source file mid-GREEN where Test 18 was failing for a non-implementation reason (the test was added then), or (b) require re-ordering tests so the Task 1 tests came first physically AND chronologically, which would have meant rewriting the test file order. The plan's `<verify>` block treats both tasks' artifacts as a single grep gate already (`formatScaleLabel` + `selectionSource:'timeline'`), reinforcing that they ship together. RED commit message explicitly enumerates Tests 14-20.
- **vi.mock('@/graph/useGraphData') at module level** — required by Test 19 (graph→tick cascade lock needs deterministic `entity.createdAt` values to compute `selectedTs`). The side-effect of fixing 3 pre-existing baseline failures (Tests 2/6/9 which crashed on `entities.find is not a function` because the existing fetch mock returned a sessions envelope to `apiClient.listEntities()`) is treated as net-positive: same mock, fewer red lines, no scope creep into the strip's data-flow.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] node_modules missing in worktree**
- **Found during:** baseline vitest invocation
- **Issue:** Claude Code worktree at `.claude/worktrees/agent-afcbd530a615461b4/integrations/unified-viewer/` has no `node_modules/` so `npx vitest` errors with "Cannot find package 'vitest'"
- **Fix:** Created Python `os.symlink` to the main repo's `integrations/unified-viewer/node_modules`. This is the standard worktree dev workflow for this project; `npm install` is never run inside a worktree
- **Files affected:** worktree filesystem only — symlink not committed (transient to this worktree; gitignored)
- **Why Rule 3 (not Rule 4):** environment setup, not architectural change. Same fix as 56-01-SUMMARY.md noted

**2. [Rule 3 — Blocking] vi.mock('@/graph/useGraphData') required for Test 19 + neutralised baseline crash for Tests 2/6/9**
- **Found during:** Task 1 RED commit drafting
- **Issue:** Test 19's selection→tick cascade lock requires the strip's `selectedTs` memo (line 167) to resolve `entity.createdAt`. In the test runtime, `useGraphData(apiClient, 'coding')` calls `apiClient.listEntities()` which hits `globalThis.fetch` — and the test mock returns `{ success: true, data: { sessions: [...] } }` for ALL fetches, so entities is the object `{ sessions: [...] }` (not Entity[]) and `entities.find` throws
- **Fix:** Added `vi.mock('@/graph/useGraphData', () => ({ useGraphData: () => ({ entities: mockEntities, ... }) }))` at module level. `mockEntities` is mutable so Test 19 can seed it with the specific `{ id: 'e3', createdAt: ... }` payload it needs
- **Files affected:** `integrations/unified-viewer/src/panels/coding/LslTimelineStrip.test.tsx`
- **Side effect (net-positive):** Tests 2/6/9 — previously crashed on `entities.find is not a function` in baseline — now pass. The pre-existing baseline (commit `0b08451`) had 9/13 passing; after this mock the count is 13/13 (then 19/20 with the 7 new Phase 56 tests minus Test 7's distinct baseline failure)
- **Why Rule 3:** required to write Test 19; the mock side-effect on baseline is a happy coincidence, not the motivation. Documented in test-file comment block.

### Not auto-fixed (logged to deferred-items.md)

**Pre-existing baseline failure: Test 7 (Cmd/Ctrl+click)**
- Surfaced (no longer masked by the `entities.find` crash) by the Rule 3 mock above
- Root cause: the strip's deselect effect at lines 187-211 unconditionally clears `lslSessionFilter` on every mount where `selectedNodeId === null` — including the first mount, when the test has just seeded `lslSessionFilter: ['sess-aaaaaaaa']`. The meta-click then writes `[sessionId]` over an empty array
- Scope: pre-existing latent bug in the Phase 55 deselect-effect (lines 187-211 were added during Phase 55 Plans 06/11 per the inline comment block at those lines); not introduced or worsened by Plan 03
- Tracked: `.planning/phases/56-unified-viewer-bidirectional-selection-timeline-scale/deferred-items.md` with two suggested fix paths

### Tasks 1+2 combined into one RED + one GREEN commit (planning deviation, not a Rule deviation)

Documented in **Decisions Made** above. The PLAN.md `<verify>` block already treats both tasks' artifacts as a single grep gate; the RED commit message enumerates Tests 14-20 covering both tasks; the GREEN commit message enumerates the AC #1 + AC #4 deliverables in distinct paragraphs. Both task `<done>` predicates are satisfied by the GREEN commit.

---

**Total deviations:** 2 Rule 3 auto-fixes, 1 planning-pragma (combined commits), 1 deferred (pre-existing). Plan 03 ships exactly what it set out to ship.

**Impact on plan:** No scope creep; no source-file changes outside the two declared in `files_modified`. Two pre-existing baseline failures (Test 7, plus the Phase 55 toggleLayer pair that 56-01-SUMMARY already logged) remain Phase 55-owned debt.

## Threat Surface Scan

No new threat surface beyond what PLAN.md's `threat_model` declared:

- T-56-03-01 (Tampering on 7-field atomic setState): `mitigate` — single-shot `set({...})` in both plain and modifier branches; Test 18 asserts post-snapshot coherence
- T-56-03-02 (Information Disclosure via timestamp labels): `accept` — labels render session-boundary timestamps which the user explicitly asked for (AC #1)
- T-56-03-03 (XSS via Intl output): `accept` — `toLocaleDateString` is a vetted locale-controlled string, not user-supplied; React text rendering escapes it
- T-56-03-04 (DoS via scaleTicks recompute): `accept` — O(1) 7-element build, memo deps `[windowKey, allOriginMs]` only
- T-56-03-05 (Repudiation): `accept` — existing Logger.info on tick click is preserved verbatim

No new endpoints, no new auth paths, no new schema changes. No `threat_flag` to surface.

## Self-Check: PASSED

Per-claim verification (all asserted files / commits exist):

```
FOUND: integrations/unified-viewer/src/panels/coding/LslTimelineStrip.tsx
FOUND: integrations/unified-viewer/src/panels/coding/LslTimelineStrip.test.tsx
FOUND: .planning/phases/56-unified-viewer-bidirectional-selection-timeline-scale/deferred-items.md

FOUND: 16215efc6 test(56-03): add RED tests for timestamp scale + Phase 56 atomic write
FOUND: 191a1fac0 feat(56-03): add timestamp scale row + Phase 56 atomic write to LslTimelineStrip
```

Source-grep gates (asserted by Test 20):

```
formatScaleLabel | lsl-scale-label-       : 3 matches (>=2)
selectionSource:.*'timeline'              : 2 matches (plain + modifier branch)
selectedSessionId                          : 4 matches (write + write + interface)
h-1[24] container bump                     : 1 match (h-12)
toLocaleDateString                         : 1 match (formatScaleLabel multi-day branch)
```

## Known Stubs

None. The scale row renders real data on every render; the atomic write produces a coherent 7-field snapshot; no UI surface ships a placeholder.

## TDD Gate Compliance

Tasks 1 and 2 both carry `tdd="true"` per PLAN.md. The RED → GREEN cycle was respected, but combined into one RED + one GREEN commit covering both tasks (see Decisions Made for rationale). Gate sequence in git log:

- RED: `16215efc6 test(56-03): add RED tests for timestamp scale + Phase 56 atomic write` — 7 new tests added, all failing
- GREEN: `191a1fac0 feat(56-03): add timestamp scale row + Phase 56 atomic write to LslTimelineStrip` — 7 new tests passing

No REFACTOR commit — implementations are clean (the scale row reuses the existing `pctOfWindow` math; the atomic write reuses the existing single-setState idiom from Phase 55).

## Next Plan Readiness

- Plan 02 (sibling — `HistorySidebar.tsx` + `OccurrenceHistorySidebar.tsx`) consumes `highlightedRowKey` for the row highlight + scroll. Plan 03 ships the write path; Plan 02 ships the read path. No coordination needed beyond the store contract Plan 01 already established
- Plan 04 (Playwright e2e) can now click a timeline tick and assert (a) the store reflects `selectionSource === 'timeline'` + `selectedSessionId !== null` + `highlightedRowKey !== null`, (b) the history-sidebar row matching `highlightedRowKey` is in the DOM and scrolled into view, (c) the `lsl-scale-label-*` test ids are visible above the tick row
- The selection→tick cascade (AC #2 timeline side, locked by Test 19) is verified GREEN even without further work — no follow-up needed

---
*Phase: 56-unified-viewer-bidirectional-selection-timeline-scale*
*Completed: 2026-06-13*
