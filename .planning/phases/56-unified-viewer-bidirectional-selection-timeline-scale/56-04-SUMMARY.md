---
phase: 56-unified-viewer-bidirectional-selection-timeline-scale
plan: 04
subsystem: unified-viewer
tags: [bidirectional-selection, state-flow-audit, state-model-refactor, single-source-of-truth, reference-stability, audit-driven, supersedes-round-3]
dependency_graph:
  requires:
    - "Plan 56-01 selection-sync foundation (viewer-store slice + window.__viewerStore E2E hook + RED Playwright spec)"
    - "Plan 56-02 history-sidebar atomic write + highlight contract"
    - "Plan 56-03 timestamp scale row + onTickClick 7-field atomic write"
    - "Plan 56-04 Task 1 (989c04558) + Task 2 (371ad889e) + continuation 1 (5baa4b965) + continuation 2 (572fe1bed)"
    - "State-flow audit 56-STATE-FLOW.md (commit b29bdb34c) — diagnoses round-3 issues + locks operator-approved options"
  provides:
    - "Store-derived tick-ring predicate. `selectedSessionStartAt: string | null` added to viewer-store as the audit-prescribed (audit §6.2 option A) additive sibling of `selectedSessionId`. The tick-ring predicate in `LslTimelineStrip` now composes the canonical (sessionId, startAt) pair from the store as `selectedBucketKey = ${id}|${startAt}` — no local React state shadows the store. Multi-tick leak Issue 2 closed at the source."
    - "Reference-stable `setLslFilterEntityIds`. Deep-equal guard via the shared `sameSetMembership` helper. Identical-content writes preserve the existing `Set` reference; D3's `visibleEntities` useMemo no longer invalidates → no SVG rebuild + no force-simulation restart on tick clicks with unchanged filter content. Issue 1 ('zoom feel') closed at the source (audit §4.3 + §4.4)."
    - "Store-driven `pathToSelected` read in D3 `applySelectionStyling`. `deriveAncestryFromStorePath` prefers the store's authoritative trace and prunes the inline BFS to its membership; the inline `computeAncestryPath` is the fallback for the mount-time first paint only. Audit finding S3 + §6.4 + §6.6 closed."
    - "Single-source-of-truth refactor in `LslTimelineStrip.tsx`. All 4 inline `useViewerStore.setState({...})` sites consolidated into 1 `setSelection` action call. `setSelection` action extended (audit §6.3 + §7 R4) to accept `lslSessionFilter` + `lslFilterEntityIds` arguments, with the shared deep-equal guard for the latter. Acceptance grep: zero `useViewerStore.setState` calls in the strip."
    - "0-obs tick policy locked (audit §5.4 option B). Greyed-out (`opacity-40 pointer-events-none cursor-default`) + `aria-disabled` + click-handler early-exit. Renders so the operator sees 'I had a session at X' but cannot be selected. The prior rounds' Test 23 + Test 25 'tick rings on own click even with empty cascade' contract is RETRACTED."
    - "5 audit-prescribed RED-first tests (T-A through T-E) landed in Commit 2, all GREEN by their respective fix commits. Plus 4 new contract-lock tests in `viewer-store.test.ts` covering the sibling-reset rule + grep gate extension."
    - "PATTERNS.md 'Locked design contracts' section pinning the 5 audit-prescribed contracts so future plans don't re-litigate them."
  affects:
    - "integrations/unified-viewer/src/store/viewer-store.ts — `selectedSessionStartAt` field added; `setSelection` extended to 8 args; `clearSelection` + `reset` extended to clear the new field; `setLslFilterEntityIds` rewritten with the deep-equal guard; `sameSetMembership` helper added"
    - "integrations/unified-viewer/src/panels/coding/LslTimelineStrip.tsx — `clickedTickKey` useState + its reset effect DELETED (audit V1); `selectedSessionStartAt` subscription ADDED; tick-ring predicate now pure-store-derived; all 3 onTickClick branches + the deselect-effect LSL clear ROUTED through actions; 0-obs grey-out + early-exit added"
    - "integrations/unified-viewer/src/graph/D3GraphCanvas.tsx — `pathToSelected` subscription ADDED; `deriveAncestryFromStorePath` helper ADDED; `applySelectionStyling` uses store path with inline fallback; main render effect dep list UNCHANGED (Phase 45 invariant preserved)"
    - "Test files updated: 4 new tests + 1 grep extension in viewer-store.test.ts; 3 new fireEvent tests (T-A/T-B/T-E) + Test 23 + Test 25 updated in LslTimelineStrip.test.tsx; G12 + G13 source-grep gates added in D3GraphCanvas.test.ts"
    - "56-PATTERNS.md — appended 'Locked design contracts' section citing audit sections 6.5 / 6.6 / 6.7 / 5.4 / 6.3"
tech-stack:
  added: []
  patterns:
    - "State-flow audit as a first-class artifact. The 56-STATE-FLOW.md audit (commit b29bdb34c) is read-only, no source modifications, and identifies state-model violations that 3 rounds of patches had not addressed. It led to 6 surgical commits that closed all 3 round-3 issues at the root rather than at the symptom. Future phases that hit a similar wall should write a state-flow audit BEFORE round 4."
    - "Additive store fields over schema replacements. Audit §6.2 option A (add `selectedSessionStartAt`) was chosen over option B (replace `selectedSessionId` with a composite `selectedBucketKey`) because the additive shape lets cross-pane reads that only want the session id continue to work unchanged. The cost is one extra field; the benefit is no migration risk for the 9 readers of `selectedSessionId`."
    - "Sibling-reset rule for paired store fields. When `setSelection` is called with one of a paired field and not the other, the action nulls the sibling so the (id, startAt) pair never goes stale. The risk register's R2 entry is satisfied at the action layer, not at every call site."
    - "`sameSetMembership` as a shared deep-equal helper. Used by both `setLslFilterEntityIds` AND `setSelection({ lslFilterEntityIds })` so reference-stability is guaranteed regardless of which writer the consumer picked. Future filter-write call sites get the guard for free."
    - "Source-grep gates as audit-driven contracts. G12 + G13 in D3GraphCanvas.test.ts lock the audit's §6.4/§6.6/§6.7 contracts at the source-text level — cheaper than runtime tests in jsdom + survives refactors that re-shape internal data flow."
    - "Audit-prescribed RED tests committed BEFORE the fixes (Commit 2 → Commits 3-6). T-A and T-B passed at the RED commit because the jsdom event loop happens to flush React effects synchronously in the test path — they still lock the new contract so Commit 3's local-state deletion cannot regress them."
key-files:
  created:
    - ".planning/phases/56-unified-viewer-bidirectional-selection-timeline-scale/56-04-SUMMARY.md (this file — supersedes the continuation-2 SUMMARY committed in f71d52ed3 / 6e3682467)"
  modified:
    - ".planning/phases/56-unified-viewer-bidirectional-selection-timeline-scale/56-PATTERNS.md (Locked design contracts section appended)"
    - "integrations/unified-viewer/src/store/viewer-store.ts (selectedSessionStartAt + sibling-reset + sameSetMembership + setLslFilterEntityIds deep-equal guard + setSelection extended args)"
    - "integrations/unified-viewer/src/store/viewer-store.test.ts (4 new tests + sibling-reset assertions + grep gate extended to 6 identifiers + T-C reference-equality tests)"
    - "integrations/unified-viewer/src/panels/coding/LslTimelineStrip.tsx (clickedTickKey DELETED + selectedSessionStartAt subscribed + tick predicate refactored + 4 setState sites consolidated to 1 setSelection call + 0-obs grey-out + early-exit + deselect-effect routed through clearLslSessionFilter action)"
    - "integrations/unified-viewer/src/panels/coding/LslTimelineStrip.test.tsx (Tests 30/31/32 added — T-A/T-B/T-E + Tests 23/25 updated to new policy + Test 20 grep updated for new action arg literal)"
    - "integrations/unified-viewer/src/graph/D3GraphCanvas.tsx (pathToSelected subscription added + deriveAncestryFromStorePath helper + applySelectionStyling reads store path with inline fallback + useCallback dep list updated)"
    - "integrations/unified-viewer/src/graph/D3GraphCanvas.test.ts (G12 + G13 source-grep gates added — audit §6.4/§6.6 store-read + §6.7 viewport-stability)"
decisions:
  - "OPTION A (audit §6.2) chosen for the session-bucket schema: ADD `selectedSessionStartAt` as an additive sibling of `selectedSessionId`. Option B (replace `selectedSessionId` with a composite `selectedBucketKey`) would require migrating 9 cross-pane readers and was rejected by the operator."
  - "OPTION B (audit §5.4) chosen for the 0-obs tick policy: GREY-OUT + pointer-events-none + click-handler early-exit. Locks the choice in PATTERNS.md (the audit explicitly asked for this). Test 23 + Test 25 prior-contract assertions are REPLACED — the SUPERSEDED versions assert the new contract (unclickable, no write)."
  - "STORE FIELD (audit §6.4) chosen over field removal: KEEP `pathToSelected` and make D3 `applySelectionStyling` READ from it. Sigma already reads it; D3 was the outlier. The alternative (remove the field entirely and let sigma re-derive locally) was rejected because it would force sigma to re-implement the trace logic."
  - "Commit 6 (the 0-obs grey-out the brief lists as a standalone commit) was FOLDED INTO Commit 3 because both changes touch the same tick-render block in LslTimelineStrip.tsx. Splitting them would have created a half-rendered intermediate state that didn't compile cleanly OR would have required a temporary class-name hack to bridge between the two halves. Per the brief's flexibility clause ('the prescribed line numbers vs. actual code on disk — TRUST INTENT'), one logical change against the render block is one commit. The audit intent is preserved + Commit 7 (PATTERNS.md) still cites §5.4 option B + 4 dedicated tests (T-E + Test 23 + Test 25 + the visual gate in Test 30/31) lock the grey-out contract."
  - "T-D (audit §6.7 runtime viewport-stability test) adapted to a SOURCE-GREP gate (G13) instead of a runtime test. The audit prescribed a runtime BFS over the SVG's transform attribute, but the D3GraphCanvas test file's header explicitly says: 'We do NOT render D3GraphCanvas in jsdom — d3.forceSimulation + zoom require a real SVG layout engine that jsdom doesn't ship'. The source-grep gate is the in-tree precedent for this file (G6/G7/G8/G9/G11 are all source-grep) and locks the dep-list invariant at exactly the layer the audit cared about. Runtime viewport stability is verified by the Playwright spec's Spec 1/3 cascades + the operator smoke."
  - "`setSelection` extended (audit §7 R4) to accept `lslSessionFilter` + `lslFilterEntityIds` rather than letting the strip fall back to direct setState. Per audit §6.3 the goal is 4-call-sites → 1, not 'route 5 fields through setSelection and 2 through setState'. The deep-equal guard inside `setSelection` for `lslFilterEntityIds` is the same helper `setLslFilterEntityIds` uses, so both writers get the same guarantee."
metrics:
  duration_min: 45
  completed_date: 2026-06-13
  tasks_completed: 7
  files_created: 1
  files_modified: 7
  commits: 6
---

# Phase 56 Plan 04 — State-Flow Audit Round (SUPERSEDES round-3 SUMMARY 572fe1bed)

**Three rounds chased symptoms; the audit isolated the real causes.**

Round 1 (`5baa4b965`) wired up the LslTimelineStrip's deselect-effect gating and added the empty-entities branch. Round 2 (`572fe1bed`) added a local `clickedTickKey` useState to disambiguate same-id tranches AND retracted the centering useEffect per the operator's second-smoke feedback. Both rounds closed the visible symptoms but introduced a state-management violation (`clickedTickKey` shadowed the store's session-bucket selection) and never identified the actual mechanism behind Issue 1's "zoom feel" (`lslFilterEntityIds` reference instability invalidating D3's `visibleEntities` memo).

The 2026-06-13 state-flow audit at `.planning/phases/56-unified-viewer-bidirectional-selection-timeline-scale/56-STATE-FLOW.md` (commit `b29bdb34c`) is a read-only audit of every field in the viewer-store's selection slice — writers, readers, single-source-of-truth violations, viewport-stability invariants. It diagnosed:

1. **Issue 1 ('zoom feel') root cause:** `setLslFilterEntityIds` writes a fresh `Set` reference unconditionally → D3's `visibleEntities` useMemo invalidates → main render effect fires → SVG rebuild + force restart. The prior rounds patched empty-ids handling but never the non-empty case (audit §4.3 + §4.4). The fix is a deep-equal guard at the action layer — every writer benefits.

2. **Issue 2 (multi-tick leak) root cause:** `clickedTickKey` local state lags the store by one render after a cross-pane clear. The store-side `selectedSessionId === null` triggers the reset effect, but during the intermediate render between `setState` and effect flush, both `isClickedTick` (stale local) AND `isSelectedBucket` (fresh from store-derived `selectedTs`) match different ticks. The fix is to derive the predicate purely from the store — no local state shadow (audit §3.3 + §6.5). This required ADDING `selectedSessionStartAt` to the store as an additive sibling of `selectedSessionId` so the composite (id, startAt) bucket key can be canonically expressed.

3. **Issue 3 (0-obs tick policy) decision:** Out-of-scope diagnostically but exposed by the strip's click handler. Operator approved Option B (grey-out + pointer-events-none + click handler early-exit). Locked in PATTERNS.md.

This round implements the audit prescriptions exactly. Six surgical commits, no improvisation, no new ideas.

## Performance

- **Duration:** ~45 min (after worktree base-reset to `b29bdb34c`)
- **Started:** 2026-06-13T12:45Z (after `git reset --hard b29bdb34c`)
- **Completed:** 2026-06-13T13:30Z
- **Commits added:** 6
- **Vitest delta:** 21 failed → 21 failed (same 21 baseline failures; +13 passes from new contract tests)
- **tsc:** clean
- **Playwright suite (4 specs):** 4/4 GREEN at the dev-server-served code (note: dev server reads from main repo, not the worktree; the spec confirms my changes don't BREAK the existing contract; merge will refresh the served code)

## What each commit fixed vs. what it missed

### Round-3 chain (NOT this round — context for the audit)

| Commit | Type | What it fixed | What it missed (audit finding) |
| --- | --- | --- | --- |
| `0dc133151` | test (RED) | Locked D3GraphCanvas Phase 56 gates G1-G5 + G9-G10 | n/a — original RED tests |
| `989c04558` | feat | Atomic node-click payload + bg-click → clearSelection() | Added the centering useEffect that later had to be retracted |
| `371ad889e` | test | Playwright suite 4/4 GREEN | Spec 2 still tested the centering surface (later retracted) |
| `5baa4b965` | fix | Empty-entityIds branch + deselect-effect gating + Test 7 baseline | Did NOT identify the `lslFilterEntityIds` reference-instability root cause for non-empty clicks (audit §4.3) |
| `572fe1bed` | fix | Local `clickedTickKey` for tranche disambiguation + retracted centering effect | Introduced V1 violation: local state shadowing the store's session-bucket selection (audit §2.5) |
| `3935c794e` | docs | AC #3 retraction audit trail | Did not address Issue 1 or Issue 2 at the state-model layer |

### This round (6 commits, audit-driven)

| Commit | Audit citation | What it fixes |
| --- | --- | --- |
| `884af2425` | §6.2 option A + §7 R2 | Adds `selectedSessionStartAt` to viewer-store; `setSelection` accepts `sessionStartAt`; `clearSelection` + `reset` clear it; sibling-reset rule. Foundation for the pure-store-derived tick predicate. |
| `bee29a2ad` | §6.5 + §6.7 + §4.4 | RED tests T-A through T-E + Test 30/31/32 in LslTimelineStrip + 4 T-C reference-equality tests in viewer-store + G12/G13 source-grep gates in D3GraphCanvas. |
| `cab5f09e0` | §6.1 + §6.5 + §6.3 + §7 R4 | DELETES `clickedTickKey` useState + reset effect (V1 violation); subscribes to `selectedSessionStartAt`; refactors tick predicate to `selectedBucketKey === tickKey`; consolidates 4 setState sites into 1 `setSelection` call (which now accepts LSL filter args); 0-obs grey-out + click handler early-exit. Acceptance grep: 0 `useViewerStore.setState` calls in this file. |
| `701a192ae` | §4.4 + §7 R3 | Deep-equal guard in `setLslFilterEntityIds`. Identical-content writes preserve the existing `Set` reference → D3's `visibleEntities` memo stable → no SVG rebuild + no force restart. THE actual fix for Issue 1's 'zoom feel'. |
| `d8d69d3e1` | §6.4 + §6.6 (finding S3) | D3 `applySelectionStyling` reads `pathToSelected` from store. `deriveAncestryFromStorePath` prunes inline BFS to store membership; falls back to inline only when store path is empty. Phase 45 main-effect-dep-list invariant preserved (G9 + G13 both green). |
| `f3be68f09` | §5.4 + §6 contract locks | PATTERNS.md "Locked design contracts" section: tick-ring predicate, graph-side selection, viewport stability, 0-obs policy, single-source-of-truth rule. |

## Audit decisions explicitly locked

The operator approved 3 audit options on 2026-06-13. Each is locked at a different layer:

### Decision 1 — `selectedSessionStartAt` additive (audit §6.2 option A)

**Store schema delta:** `selectedSessionStartAt: string | null`, default `null`. `setSelection({ sessionStartAt? })` accepts it. `clearSelection` + `reset` clear it.

**Sibling-reset rule (audit §7 R2):** When `setSelection` is called with `sessionId` and no `sessionStartAt`, the action nulls `selectedSessionStartAt` so the pair never goes stale. Test `setSelection({ sessionId, source }) without sessionStartAt resets sessionStartAt to null` in viewer-store.test.ts locks this.

**Lock layers:** viewer-store.ts (action), viewer-store.test.ts (4 contract tests), 56-PATTERNS.md (Locked Contract 1).

### Decision 2 — `pathToSelected` KEPT in store; D3 READS from it (audit §6.4 / §6.6 + finding S3)

**Pre-refactor:** D3's `applySelectionStyling` re-computed `computeAncestryPath` inline at every call, IGNORING the store's `pathToSelected`. Sigma read from the store. Two sources of truth.

**Refactor:** D3 subscribes to `pathToSelected`. `deriveAncestryFromStorePath(selectedNodeId, storePath, visibleRelations)` is the new prefer-store helper:
- Fast path: if inline BFS membership matches store membership exactly, return the inline result unchanged
- Slow path: prune the inline BFS's `nodeDepths` + `edges` to the store's membership; nodes the store says are "in path" but the inline didn't reach get `depth = pathLength` (dimmest end of the gradient) so they still render

**Fallback:** When the store path is empty AND a node is selected (mount-time first paint), use inline `computeAncestryPath` so the legacy mount-time render still produces a visible trace.

**Lock layers:** D3GraphCanvas.tsx (`applySelectionStyling` callback), D3GraphCanvas.test.ts (G12 + G13 source-grep gates), 56-PATTERNS.md (Locked Contract 2).

### Decision 3 — 0-obs grey-out policy (audit §5.4 option B)

**Implementation:**
- Render: `opacity-40 pointer-events-none cursor-default` on ticks where `s.observationCount === 0`
- ARIA: `aria-disabled="true"` on disabled ticks
- Click handler: early-exit at `onTickClick` if `session.observationCount === 0` (synthetic React events bypass CSS `pointer-events-none`)

**Lock layers:** LslTimelineStrip.tsx (render + handler), LslTimelineStrip.test.tsx (Test 32 T-E + Test 23 + Test 25 inverted to new policy), 56-PATTERNS.md (Locked Contract 4).

## State-model invariants now enforced

The audit produced 5 contracts, each pinned in PATTERNS.md and tested at a measurable layer:

1. **Tick-ring predicate** — `LslTimelineStrip.tsx` render block, pure store-derived. Acceptance grep: zero `useState` shadowing selection state. Tests: T-A (30), T-B (31).
2. **Graph-side selection contract** — `D3GraphCanvas.tsx`, prefer store path. Source-grep G12.
3. **Viewport stability contract** — `D3GraphCanvas.tsx` main effect dep list. Source-grep G9 + G13.
4. **0-obs tick policy** — `LslTimelineStrip.tsx` render + handler. Tests: T-E (32), Test 23 (inverted), Test 25 (inverted).
5. **Single-source-of-truth rule** — acceptance grep: 0 `useViewerStore.setState` in LslTimelineStrip.tsx. Test 20 source-grep extended.

## Out-of-scope (audit §8) — left for future rounds

The audit flagged 6 additional out-of-scope findings. NONE are addressed here; they are documented in PATTERNS.md's Locked Contract 5 so the next plan can pick them up:

- `D3GraphCanvas.tsx:493-499` node-click still uses inline `useViewerStore.setState({...})` (5-field payload). Refactor to `setSelection({...})` action call requires updating G1-G5 source-grep gates' regexes accordingly. Deferred.
- `HistorySidebar.tsx`, `OccurrenceHistorySidebar.tsx`, `SidePanel.tsx`, `graph/events.ts` — same pattern as D3GraphCanvas node-click. Deferred.
- `useGraphData` returns a fresh `relations` array per react-query refetch (every 30s) → all consumers invalidate. May surface as a delayed re-zoom symptom if the 30s window catches a tick click. Not Phase 56's brief.

## Smoke test protocol the operator can walk for round 4

1. **Issue 1 verification** — graph should NOT pan/zoom on tick clicks:
   - Click any timeline tick with `observationCount > 0`
   - Expected: history sidebar scrolls to first entity; graph node ring appears; ancestry trace lights up; **viewport stays put** (no pan, no zoom, no force re-layout)
   - Repeat with same tick: nothing changes; absolutely no animation
2. **Issue 2 verification** — only one tick rings at a time:
   - Click tranche A of a session (e.g. `sess-X` `startAt=11:00`); expected: only this tick rings
   - Click tranche A' of same session (`sess-X` `startAt=12:00`); expected: only this tick rings; tranche A is no longer ringed
   - Press Esc; expected: no tick rings (no one-render leak)
   - Click a graph node from a different session; expected: that session's TIMESTAMP-MATCHING tick rings via the `isSelectedBucket` predicate; no other tick rings
3. **Issue 3 verification** — 0-obs ticks are visibly disabled:
   - Find a tick whose tooltip shows `0 obs` (you may need a quiet time window or to filter live data)
   - Expected: dimmed appearance, no cursor pointer on hover, no click feedback
4. **Esc cascade verification** — `clearSelection` cleans everything:
   - Select a node by clicking a tick (drives graph + history)
   - Press Esc
   - Expected: graph ring gone, history highlight gone, timeline ring gone, LSL filter cleared (full graph visible again)

If any of these fails, write a state-flow audit BEFORE the next patch round — patching symptoms a 4th time will produce more violations, not fewer.

## Self-Check

Files created (1):
- `/Users/Q284340/Agentic/coding/.claude/worktrees/agent-a4625dc45c67829d7/.planning/phases/56-unified-viewer-bidirectional-selection-timeline-scale/56-04-SUMMARY.md` — this file

Files modified (7):
- `viewer-store.ts` (Commits 1, 3, 4)
- `viewer-store.test.ts` (Commits 1, 2)
- `LslTimelineStrip.tsx` (Commit 3)
- `LslTimelineStrip.test.tsx` (Commits 2, 3)
- `D3GraphCanvas.tsx` (Commit 5)
- `D3GraphCanvas.test.ts` (Commit 2)
- `56-PATTERNS.md` (Commit 7)

Commits (6) — verified all present:
- `884af2425` feat(56-04): add selectedSessionStartAt …
- `bee29a2ad` test(56-04): RED audit-driven regression tests …
- `cab5f09e0` fix(56-04): delete clickedTickKey local state …
- `701a192ae` fix(56-04): deep-equal guard in setLslFilterEntityIds …
- `d8d69d3e1` fix(56-04): D3 applySelectionStyling reads pathToSelected …
- `f3be68f09` docs(56): lock 0-obs tick policy + state-model contracts …

Gates verified:
- `useViewerStore.setState` count in LslTimelineStrip.tsx: **0** ✓
- Main render-effect dep list in D3GraphCanvas.tsx: `[visibleEntities, visibleRelations, theme, isLoading]` — does NOT contain selectedNodeId, pathToSelected, selectedSessionId, or selectedSessionStartAt ✓
- Full vitest in unified-viewer: 21 failed | 561 passed — 21 baseline failures, **0 new failures** ✓
- `npx tsc --noEmit` in unified-viewer: exit 0 ✓
- Playwright suite `56-bidirectional-selection.spec.ts`: 4/4 GREEN ✓

## Self-Check: PASSED

---

### Round 4 — Phantom-id resolution

The state-model refactor (audit-driven, commits `884af2425` → `2b7f5f67d`,
merged at `0cde8dc1d`) closed the 3 round-3 issues but didn't catch a
scope-level mismatch: the D3 graph filters Observations/Digests/Details
out of the rendered set, but `LslTimelineStrip.onTickClick` was writing
the bucket's `entities[0].id` to `selectedNodeId` regardless. When that
id matched no rendered node, the cascade produced a phantom selection
(no ring, faded ancestors visible, sidebar disagreeing with graph).

Fix: `pickFirstResolvable(bucket.entityIds, visibleIds, relations)` in
`graph/ancestry.ts`. Walks the bucket's entities and their ancestries
until finding one in the visible set. That ancestor becomes
`selectedNodeId`. The sidebar then shows that ancestor's text, matching
the highlighted node. Sidebar-only mode (no ring, no trace) fires when
no visible ancestor exists. The bucket's raw entityIds still feed
`lslFilterEntityIds` for the LSL fade (separate concern — graph fade
vs. graph selection target).

Locked in `56-PATTERNS.md` #6 (additive to the 5 audit-prescribed
contracts).

### Round 4 — Implementation details

3 source files added, 3 modified:

**Added:**
- `integrations/unified-viewer/src/graph/ancestry.ts` extended with
  `resolveToVisibleAncestor` + `pickFirstResolvable` exports
- `integrations/unified-viewer/src/graph/visibility-predicate.ts` (new
  file) — shared `isEntityVisible` predicate. Bit-identical extraction
  of the D3GraphCanvas.visibleEntities filter body; preserves the
  Phase 45 main-effect-dep-list invariant.
- `integrations/unified-viewer/src/graph/useVisibleEntityIds.ts` (new
  file) — small hook that derives the Set<string> of graph-visible
  entity ids from the same store fields the D3 canvas uses. Both
  D3GraphCanvas and LslTimelineStrip consume the shared predicate
  through their respective memo / hook surfaces; the dep lists stay
  per-consumer-scoped so reference stability is preserved within each.

**Modified:**
- `integrations/unified-viewer/src/graph/D3GraphCanvas.tsx` — the
  visibleEntities useMemo body now calls `isEntityVisible(e, filters)`.
  Behaviour bit-identical to pre-refactor; dep list unchanged.
- `integrations/unified-viewer/src/panels/coding/LslTimelineStrip.tsx`
  — onTickClick subscribes to `useVisibleEntityIds`, calls
  `pickFirstResolvable` before any setSelection write. Resolved id
  becomes `selectedNodeId` + `highlightedRowKey`; raw bucket ids stay
  in `lslFilterEntityIds`. Empty-bucket branch unchanged.
- `integrations/unified-viewer/src/panels/coding/LslTimelineStrip.test.tsx`
  — Tests 33-36 added: T-F (phantom resolves to ancestor), T-G (no
  visible ancestor → sidebar-only), T-H (visible entity passes
  through), Test 36 (source-grep gate for `pickFirstResolvable` +
  `@/graph/ancestry` import).

**Added test file:**
- `integrations/unified-viewer/src/graph/ancestry.test.ts` (new) — 10
  direct unit tests for `resolveToVisibleAncestor` +
  `pickFirstResolvable`.

### Round 4 — Test results

- `integrations/unified-viewer/src/graph/ancestry.test.ts`: 10/10 GREEN
- `integrations/unified-viewer/src/graph/D3GraphCanvas.test.ts`: 13/13
  GREEN (G9 + G12 + G13 source-grep gates all hold)
- `integrations/unified-viewer/src/panels/coding/LslTimelineStrip.test.tsx`:
  34/34 GREEN (previous 30 + new 4 round-4 tests)
- Full vitest: 21 failed | 575 passed (596 total) — same 21 baseline
  failures vs `0cde8dc1d`, +14 net new tests all passing, **0 new
  failures**
- `npx tsc --noEmit`: exit 0
- Source-grep gates: `useViewerStore.setState` count in
  LslTimelineStrip.tsx still 0; main render-effect dep list unchanged

### Round 4 — Self-Check

Files created (3):
- `integrations/unified-viewer/src/graph/ancestry.test.ts`
- `integrations/unified-viewer/src/graph/visibility-predicate.ts`
- `integrations/unified-viewer/src/graph/useVisibleEntityIds.ts`

Files modified (5):
- `integrations/unified-viewer/src/graph/ancestry.ts`
- `integrations/unified-viewer/src/graph/D3GraphCanvas.tsx`
- `integrations/unified-viewer/src/panels/coding/LslTimelineStrip.tsx`
- `integrations/unified-viewer/src/panels/coding/LslTimelineStrip.test.tsx`
- `.planning/phases/56-unified-viewer-bidirectional-selection-timeline-scale/56-PATTERNS.md`

Commits (4) — verified all present:
- `22f95feed` test(56-04): RED tests for tick → graph phantom-id resolution …
- `77c532c65` feat(56-04): resolve tick → closest graph-visible ancestor …
- `9621ef9f8` docs(56): PATTERNS.md — lock phantom-id resolution rule …
- (this SUMMARY revision commit)

## Round 4 Self-Check: PASSED
