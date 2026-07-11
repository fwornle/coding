---
phase: 86-timeline-v2-and-declutter
reviewed: 2026-07-11T02:54:21Z
depth: standard
files_reviewed: 15
files_reviewed_list:
  - integrations/system-health-dashboard/src/components/performance/run-align.ts
  - integrations/system-health-dashboard/src/components/performance/loop-heuristic.ts
  - integrations/system-health-dashboard/src/components/performance/context-band.tsx
  - integrations/system-health-dashboard/src/components/performance/context-cache-explainer.tsx
  - integrations/system-health-dashboard/src/components/performance/difference-viewer.tsx
  - integrations/system-health-dashboard/src/components/performance/reconciliation-badge.tsx
  - integrations/system-health-dashboard/src/components/performance/runs-table.tsx
  - integrations/system-health-dashboard/src/components/performance/timeline.tsx
  - integrations/system-health-dashboard/src/components/performance/timeline-fullscreen.tsx
  - integrations/system-health-dashboard/src/components/performance/turn-modal.tsx
  - integrations/system-health-dashboard/src/components/performance/turn-row.tsx
  - integrations/system-health-dashboard/src/components/performance/faceted-sidebar.tsx
  - integrations/system-health-dashboard/src/pages/performance.tsx
  - integrations/system-health-dashboard/src/store/slices/performanceSlice.ts
  - integrations/system-health-dashboard/src/App.tsx
findings:
  critical: 1
  warning: 3
  info: 2
  total: 6
status: issues_found
---

# Phase 86: Code Review Report

**Reviewed:** 2026-07-11T02:54:21Z
**Depth:** standard
**Files Reviewed:** 15
**Status:** issues_found

## Summary

Reviewed the Timeline v2 + declutter surface: the pure alignment/loop modules (`run-align.ts`,
`loop-heuristic.ts`), the honesty-gated context-band/explainer/modal chain, the diff viewer, the
reconciliation badge, the runs-table inline score editing, and the shared `performanceSlice.ts`
contract.

The honesty gates called out in the review brief hold up under inspection: `cache_write === null`
is branched explicitly everywhere it's rendered (`context-band.tsx`, `context-cache-explainer.tsx`,
`turn-modal.tsx`), never coerced to a fabricated `0`; `canonical_model` is read verbatim in
`difference-viewer.tsx`/`timeline-fullscreen.tsx`/`runs-table.tsx` with no per-surface recompute;
`scrubSecrets` is applied to every rendered preview/intent string in `context-cache-explainer.tsx`,
`difference-viewer.tsx`, and `turn-modal.tsx`. `run-align.ts`/`loop-heuristic.ts` are pure,
dependency-free, and verified correct on empty-array/identical/reconverging-tail edge cases (the
root-level Jest suite at `test/performance/{run-align,loop-heuristic}.test.js` covers the documented
D-07/D-09 validation rows).

The one BLOCKER is a real index-misalignment bug: `PerformanceTimeline`'s v2 turn list indexes the
unfiltered `contextTurns` array by the position within the role-*filtered* `visibleRows` array,
so toggling any role-filter chip (a default-visible, always-available control) desyncs the rendered
per-turn band/tool-chips from the timeline row it's attached to, and corrupts the turn index handed
to `openTurnModal`, opening the wrong turn's detail (or `undefined`) in the drill-down modal.

## Critical Issues

### CR-01: Role-filtering desyncs `contextTurns[i]` from the filtered timeline row (and corrupts the turn-modal index)

**File:** `integrations/system-health-dashboard/src/components/performance/timeline.tsx:565,727-737`
**Issue:**
`visibleRows` is a role-filtered subset of `rows` (`rows.filter((r) => !hiddenRoles.has(...))`,
line 565). The v2 render loop then maps over `visibleRows` and indexes the **unfiltered**
`contextTurns` array (and `turnLoopFlags`, itself computed over the unfiltered `contextTurns`) by
the position `i` within `visibleRows`:

```tsx
{visibleRows.map((row, i) => (
  <TurnRowWithChildren
    key={row.tool_call_id ?? i}
    timelineRow={row}
    contextTurn={contextTurns[i]}   // i indexes visibleRows, not rows/contextTurns
    taskId={taskId}
    index={i}                        // also becomes the turn-modal index
    loopFlag={turnLoopFlags[i] ?? false}
  />
))}
```

As soon as an operator unchecks any role-filter chip (`timeline-role-filters`, on by default and
always interactive — this is not a rare path), `visibleRows.length < rows.length` and the
per-position mapping breaks: row N's rendered `ContextBand`, tool chips, token/cache summary, and
loop badge now come from `contextTurns[N]` — a **different turn** than the one the row actually
represents. Clicking the row calls `TurnRow`'s `open = () => dispatch(openTurnModal({ taskId,
index }))` (`turn-row.tsx:88`) with that same misaligned `index`; `TurnModal` reads
`turns[index]` from the full unfiltered `selectContextTurnsFor(taskId)` (`turn-modal.tsx:117`), so
the drill-down modal shows the wrong turn's message list, cache split, and cache-breakpoint
markers — or `undefined` (empty state) once `index >= contextTurns.length` for a heavily filtered
run. This directly undermines the phase's own honesty contract: the UI now attributes one turn's
real measured bytes/cache-split to a different turn's row, silently.

`TimelineFullscreen` (`timeline-fullscreen.tsx:154-162`) does not have this bug — it maps
`contextTurns` directly with no filtering, so `i` is always the correct index there. The gate is
isolated to `PerformanceTimeline`'s role-filtered v2 branch.

**Fix:** Index `contextTurns`/`turnLoopFlags` by the row's position in the **unfiltered** `rows`
array, not by its position in `visibleRows`. E.g. compute the original index up front and pass it
through:

```tsx
{rows.map((row, origIndex) => {
  if (hiddenRoles.has(roleForProcess(row.process, run))) return null
  return (
    <TurnRowWithChildren
      key={row.tool_call_id ?? origIndex}
      timelineRow={row}
      contextTurn={contextTurns[origIndex]}
      taskId={taskId}
      index={origIndex}
      loopFlag={turnLoopFlags[origIndex] ?? false}
    />
  )
})}
```
(or precompute `rows.map((row, i) => ({ row, i })).filter(...)` and map over that, preserving the
original `i` through the filter instead of re-deriving a fresh one).

## Warnings

### WR-01: `ScoreCell` inline edit can commit stale draft text after Escape-cancel

**File:** `integrations/system-health-dashboard/src/components/performance/runs-table.tsx:207-224`
**Issue:** The editable `<Input>` binds `onBlur={commit}` and, on `Escape`, calls
`cancelEdit()` (synchronously sets `editing=false`, `draft=''`) without any guard against the
native `blur` event the browser fires on an input that unmounts while focused. Because
`cancelEdit()` triggers React to unmount the `<Input>` (swapping to the non-editing view), the
still-attached `onBlur` handler from the render where `editing` was still `true` can fire with
the **pre-cancel** `draft` closure value (the text the user was trying to discard), potentially
issuing an unwanted `saveOverride` PATCH for a value the operator explicitly cancelled. This is
timing/browser-dependent and hasn't been reproduced live, but the code has no defense against it
(no ref-guard, no `e.preventDefault()`-then-blur suppression, no `relatedTarget` check).
**Fix:** Guard `commit` against having already been cancelled, e.g. track an `editingRef` and
bail in `commit()` if it's false, or call `inputRef.current?.blur()` inside `cancelEdit` in a way
that lets you distinguish a deliberate cancel from a genuine blur-to-save:

```tsx
const skipBlurRef = useRef(false)
const cancelEdit = () => {
  skipBlurRef.current = true
  setEditing(false)
  setDraft('')
}
const commit = async () => {
  if (skipBlurRef.current) { skipBlurRef.current = false; return }
  // ...existing logic
}
```

### WR-02: `saveOverride` thunk loses partial-success state on a mid-batch PATCH failure

**File:** `integrations/system-health-dashboard/src/store/slices/performanceSlice.ts:693-719`
**Issue:** `saveOverride` PATCHes each edit in `edits` sequentially and returns
`rejectWithValue` on the **first** failure, short-circuiting the loop. Any edits before the
failing one have already been persisted server-side (the PATCH calls are not transactional), but
because the thunk overall rejects, the `fulfilled` reducer (which applies the optimistic
corrected-wins patch to `state.runs`) never runs for **any** of the edits — including the ones
that did succeed. The client now silently under-represents server state until the next
`fetchRuns()` reconciles it (which, per the comment at line 711-716, is not automatically
re-dispatched after a save). Today's only caller (`runs-table.tsx` `ScoreCell.commit`) always
passes a single-element `edits` array so this isn't exercised yet, but the thunk is a documented
shared contract ("consumed by multiple components" — score-drawer also calls it with potentially
multi-dimension edits) and will silently drop a partially-applied save the next time a multi-edit
caller hits a failure partway through.
**Fix:** Either (a) return which edits succeeded alongside the rejection so the reducer can apply
partial optimistic state, or (b) track per-edit results and let the fulfilled path apply whatever
succeeded even when the batch as a whole doesn't complete, or (c) document explicitly that
multi-edit callers must not rely on partial-success semantics and add a client-side warning.

### WR-03: `sizeBucket`/`turnSignature` and `loopFlags` have no test coverage for the empty-run input

**File:** `integrations/system-health-dashboard/src/components/performance/run-align.ts`,
`integrations/system-health-dashboard/src/components/performance/loop-heuristic.ts`
**Issue:** `test/performance/run-align.test.js` and `test/performance/loop-heuristic.test.js`
cover identical/rerun/reconverging-tail and in-window/out-of-window/reasoning-ignore cases well,
but neither suite exercises `alignRuns([], [])` or `loopFlags([])` (both trivially correct by
inspection — confirmed manually during this review — but not asserted). Given these are the two
explicitly-called-out "pure, dependency-free... edge case" modules for this phase, an empty-run
pair (e.g. comparing against a run with zero captured context-turns) is a realistic input from
`DifferenceViewer` (`aTurns`/`bTurns` default to `[]` before `fetchContextTurns` resolves) and
should be locked in with an explicit assertion rather than left to accidental correctness.
**Fix:** Add `expect(alignRuns([], [])).toEqual({ prefixLen: 0, firstDivergence: null, pairs: [] })`
and `expect(loopFlags([])).toEqual([])` to the respective suites.

## Info

### IN-01: `firstWrite` computed in `summarize()` but never consumed

**File:** `integrations/system-health-dashboard/src/components/performance/context-cache-explainer.tsx:260,277`
**Issue:** `const firstWrite = data.find((d) => d.write > 0)?.write ?? 0` is computed and
returned on the `summarize()` result object (`s.firstWrite`), but no caller in this file reads
`s.firstWrite`. Dead computation.
**Fix:** Remove the field, or wire it into the "Biggest turn" / stat-card section if it was
intended to surface the first cache-write turn.

### IN-02: `ContextBand` cumulative height comment claims `h-3/h-4`, code always uses `h-4`

**File:** `integrations/system-health-dashboard/src/components/performance/context-band.tsx:17,142-143`
**Issue:** The module header comment and the inline comment both say cumulative renders at
"h-3/h-4 in modal / fullscreen", but `heightClass` is a fixed ternary (`variant === 'mini' ? 'h-2'
: 'h-4'`) with no `h-3` branch anywhere. Either stale documentation or a missing modal-specific
height variant.
**Fix:** Update the comment to match the single `h-4` cumulative height, or add the documented
`h-3` variant if the modal was meant to render shorter than the fullscreen band.

---

_Reviewed: 2026-07-11T02:54:21Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
