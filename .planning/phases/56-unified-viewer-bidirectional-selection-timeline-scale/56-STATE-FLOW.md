# Phase 56 — State-Flow Audit (read-only)

**Generated:** 2026-06-13 (post-round-3 patches)
**Scope:** End-to-end audit of the selection state model across the three
consumer components (D3GraphCanvas, LslTimelineStrip, HistorySidebar /
OccurrenceHistorySidebar) backed by `useViewerStore` (Zustand).
**Purpose:** Diagnose why three rounds of patching have not ended the bug
cycle. Identify state-model drift, not implementation typos. Recommend the
minimum-change refactor that ends the cycle.

**Authoritative source files audited (file:line citations below):**

- `integrations/unified-viewer/src/store/viewer-store.ts`
- `integrations/unified-viewer/src/panels/coding/LslTimelineStrip.tsx`
- `integrations/unified-viewer/src/graph/D3GraphCanvas.tsx`
- `integrations/unified-viewer/src/panels/HistorySidebar.tsx`
- `integrations/unified-viewer/src/panels/OccurrenceHistorySidebar.tsx`
- `integrations/unified-viewer/src/graph/ancestry.ts`
- `integrations/unified-viewer/src/graph/useGraphData.ts`
- `integrations/unified-viewer/src/hooks/useKeyboardShortcuts.ts`
- `scripts/observations-api-server.mjs` (backend bucket generator)

---

## 1. Store fields (canonical schema)

The Phase 56 cross-pane selection slice is five fields. For each we
catalog type, default, writers, readers, and whether the field is
intended as the single source of truth.

### 1.1 `selectionSource: 'graph' | 'timeline' | 'history' | null`

- **Type:** `SelectionSource` (`viewer-store.ts:47`)
- **Default:** `null` (`viewer-store.ts:236`)

**Writers (every site that flips `selectionSource`):**

| File:line | Trigger | New value |
|---|---|---|
| `viewer-store.ts:279` | `setSelection({...})` action | `args.source` (required arg) |
| `viewer-store.ts:292` | `clearSelection()` action | `null` |
| `viewer-store.ts:335` | `reset()` action | `null` |
| `D3GraphCanvas.tsx:497` | Graph node `.on('click')` (inline `useViewerStore.setState`) | `'graph'` |
| `HistorySidebar.tsx:104` | History row `onClick` (inline `setState`) | `'history'` |
| `OccurrenceHistorySidebar.tsx:117` | Occurrence row `onClick` (inline `setState`) | `'history'` |
| `LslTimelineStrip.tsx:446` | `onTickClick`, empty-entityIds branch | `'timeline'` |
| `LslTimelineStrip.tsx:492` | `onTickClick`, Cmd/Ctrl additive branch | `'timeline'` |
| `LslTimelineStrip.tsx:525` | `onTickClick`, plain-click branch | `'timeline'` |

**Readers (every site that consumes `selectionSource`):**

| File:line | Surface derived |
|---|---|
| — | NONE in current tree. |

- D3GraphCanvas formerly subscribed (`D3GraphCanvas.tsx:136-144` block-comment) but the subscription was deliberately removed when the centering effect was retracted in continuation-2.
- No other component reads it.

**Single source of truth?** YES — the field is written by every selection-producing handler and never read. It is effectively a *write-only loop-guard placeholder*. Now that the centering effect is gone, no consumer derives anything from it; it remains in the schema only as a contract bookmark (per `CONTEXT.md` Decision §3 — "selectionSource lets consumers avoid feedback loops on their own clicks").

> **Audit finding S1:** The field is dead read-side. Either (a) introduce the documented loop-guard subscription, or (b) keep it as a write-only contract field for future consumers. The plan author should pick one explicitly and document in PATTERNS.md.

### 1.2 `selectedNodeId: string | null`

- **Type:** `string | null` (`viewer-store.ts:77`)
- **Default:** `null` (`viewer-store.ts:232`)

**Writers:**

| File:line | Trigger | Comments |
|---|---|---|
| `viewer-store.ts:252` | `setSelectedNode(id)` action | Phase 45 legacy single-field setter (still used by some panels) |
| `viewer-store.ts:264-276` | `setSelection({...})` action | Atomic |
| `viewer-store.ts:290` | `clearSelection()` | `null` |
| `viewer-store.ts:331` | `reset()` | `null` |
| `D3GraphCanvas.tsx:494` | Graph node click | Bare id |
| `D3GraphCanvas.tsx:419` | Graph background click → `clearSelection()` | indirect |
| `HistorySidebar.tsx:101` | Row click (inline) | Bare id |
| `OccurrenceHistorySidebar.tsx:114` | Row click (inline) | Bare id |
| `LslTimelineStrip.tsx:518` | Plain tick click | `firstEntityId` (may be null when ids=[]) |
| **`LslTimelineStrip.tsx:443-457`** | Empty-entityIds branch | **Intentionally NOT touched** — preserves prior value |
| `useKeyboardShortcuts.ts:176` | Esc → `clearSelection()` | Indirect |
| `SidePanel.tsx:116` | Close button | `null` + `pathToSelected: new Set()` (bypasses `clearSelection`) |
| `graph/events.ts:99,103` | Sigma node click | Legacy path (sigma route) |

**Readers:**

| File:line | Surface derived |
|---|---|
| `D3GraphCanvas.tsx:135` | `selectedNodeId` subscription → drives `applySelectionStyling` red ring + ancestry trace via `useCallback` dep at `:328` |
| `D3GraphCanvas.tsx:294-326` | `applySelectionStyling` reads it as closure cap. → ring + node opacity + edge stroke |
| `D3GraphCanvas.tsx:484` | Node click handler reads it for path computation |
| `D3GraphCanvas.tsx:509` | Initial-mount ring opacity (`.attr('opacity', d => selectedNodeId === d.id ? 1 : 0)`) |
| `HistorySidebar.tsx:115` | `selectedNodeId` subscription → row highlight (`item.id === selectedNodeId`) |
| `HistorySidebar.tsx:118-124` | `scrollIntoView` effect |
| `OccurrenceHistorySidebar.tsx:56,73` | Subscription → MOUNT GATE (`if (selectedNodeId !== null) return null`) — entire sidebar is conditional on this |
| `LslTimelineStrip.tsx:201,248` | Subscription → `selectedTs` memo for graph→timeline cascade ring |
| `LslTimelineStrip.tsx:272-325` | Auto-slide window effect (depends on `selectedTs` derived from selectedNodeId) |
| `SidePanel.tsx:45-52` | Subscription → entity lookup for the side panel |
| `EntityDetailPanel.tsx:527-618` | Subscription → entity payload + neighbor map |
| `graph/reducers.ts:247` | Sigma edge styling |
| `graph/graph-builder.ts:461,478` | Sigma node state |

**Single source of truth?** YES — every consumer reads from the store. No local copy or shadow.

### 1.3 `selectedSessionId: string | null`

- **Type:** `string | null` (`viewer-store.ts:98`)
- **Default:** `null` (`viewer-store.ts:238`)

**Writers:**

| File:line | Trigger | New value |
|---|---|---|
| `viewer-store.ts:265,277` | `setSelection({...})` | `args.sessionId ?? preserve` |
| `viewer-store.ts:294` | `clearSelection()` | `null` |
| `viewer-store.ts:337` | `reset()` | `null` |
| `D3GraphCanvas.tsx:498` | Graph node click | `null` (graph is not session-scoped) |
| `LslTimelineStrip.tsx:445` | Empty-entityIds branch | `sessionId` |
| `LslTimelineStrip.tsx:493` | Cmd/Ctrl branch | `sessionId` |
| `LslTimelineStrip.tsx:526` | Plain-click branch | `sessionId` |

**Readers:**

| File:line | Surface derived |
|---|---|
| `LslTimelineStrip.tsx:207` | Subscription |
| `LslTimelineStrip.tsx:226-230` | Effect that resets local `clickedTickKey` to `null` when store value goes to `null` |

**Single source of truth?** PARTIAL — `selectedSessionId` IS the store's representation of "which session is selected", but the strip does NOT derive the tick ring from it. Instead it derives the ring from local `clickedTickKey` (§2 + §3). So the field is being WRITTEN as the canonical aggregate selection but READ only for its `null` transition (to drop the local cache). The ring surface is *not* driven by it. See §3 root-cause.

> **Audit finding S2:** `selectedSessionId` is canonical for "session selected" semantically but is not the input to the visible ring predicate. The visible ring is driven by `clickedTickKey` (local) + `isSelectedBucket` (derived from `selectedNodeId`-via-`selectedTs`). The field is half-truth, half-write-only.

### 1.4 `highlightedRowKey: string | null`

- **Type:** `string | null` (`viewer-store.ts:97`)
- **Default:** `null` (`viewer-store.ts:237`)

**Writers:**

| File:line | Trigger | New value |
|---|---|---|
| `viewer-store.ts:266-267,278` | `setSelection({...})` | `args.highlightedRowKey ?? preserve` |
| `viewer-store.ts:293` | `clearSelection()` | `null` |
| `viewer-store.ts:336` | `reset()` | `null` |
| `D3GraphCanvas.tsx:496` | Graph node click | `d.id` |
| `HistorySidebar.tsx:103` | Row click | `id` |
| `OccurrenceHistorySidebar.tsx:116` | Row click | `entity.id` |
| `LslTimelineStrip.tsx:491` | Cmd/Ctrl branch | `ids[0] ?? null` |
| `LslTimelineStrip.tsx:524` | Plain-click branch | `firstEntityId` |
| **`LslTimelineStrip.tsx:443-457`** | Empty-entityIds branch | NOT written (preserves) |

**Readers:**

| File:line | Surface derived |
|---|---|
| `HistorySidebar.tsx:116,150` | Subscription → `isHighlighted = item.id === selectedNodeId \|\| item.id === highlightedRowKey` |
| `OccurrenceHistorySidebar.tsx:60,94` | Subscription → row highlight |

**Single source of truth?** YES — the only consumer surface (history-sidebar row tint) reads it directly. No shadow.

### 1.5 `pathToSelected: ReadonlySet<string>`

- **Type:** `ReadonlySet<string>` (`viewer-store.ts:84`)
- **Default:** `new Set<string>()` (`viewer-store.ts:234`)

**Writers:**

| File:line | Trigger | New value | Reference behavior |
|---|---|---|---|
| `viewer-store.ts:269-281` | `setSelection({...})` | explicit > reset-on-nodeId-change > preserve | New `Set` only when `nodeId` arg passes and `pathToSelected` arg omitted |
| `viewer-store.ts:295` | `clearSelection()` | `new Set<string>()` | Fresh ref every clear |
| `D3GraphCanvas.tsx:495` | Graph node click | `new Set(path.nodeDepths.keys())` | Fresh ref every click |
| `HistorySidebar.tsx:102` | Row click | `new Set<string>()` | Fresh empty ref |
| `OccurrenceHistorySidebar.tsx:115` | Row click | `new Set<string>()` | Fresh empty ref |
| `LslTimelineStrip.tsx:470-472` | Both non-empty branches | `new Set<string>(path.nodeDepths.keys())` or `new Set<string>()` | Fresh ref every click |
| **`LslTimelineStrip.tsx:443-457`** | Empty branch | NOT written | Reference stable |
| `SidePanel.tsx:116` | Close | `new Set()` | Fresh ref |
| `graph/events.ts:99,103` | Sigma | `path` / `new Set()` | Fresh ref |

**Readers:**

| File:line | Surface derived |
|---|---|
| — | NONE in `D3GraphCanvas.tsx` directly — see note below |
| `graph/graph-builder.ts:461,487` | Sigma — node opacity in `computeNodeState` (the **sigma** path, not D3) |
| `graph/reducers.ts:237` | Sigma edge reducer |

**Single source of truth?** PARTIAL/BROKEN — see audit finding S3.

> **Audit finding S3:** `pathToSelected` is written by every writer of `selectedNodeId` (graph, history, timeline) BUT in the D3 path it is **not read by `applySelectionStyling`**. `applySelectionStyling` instead RE-COMPUTES the ancestry inline via `computeAncestryPath(selectedNodeId, visibleRelations)` at `D3GraphCanvas.tsx:307`. So `pathToSelected` is dead read-side in the D3 render path. It is only consumed by the sigma render path. This duplicates the truth (store + inline-recompute) and creates the §4 reference-instability hazard for free — every writer ALSO has to re-fire the D3 ancestry compute, but the *real* D3 trace doesn't depend on `pathToSelected` at all.

This is a major source-of-truth violation. Either the D3 path should read from the store (cheap and stable) or the store field should be removed from the D3-side cascade entirely.

---

## 2. Local component state that touches selection (the violation list)

Grep of `useState`/`useRef` inside the three audited components yields
the following hooks. Each is classified.

### 2.1 `LslTimelineStrip.tsx`

| Line | Hook | Value type | Classification |
|---|---|---|---|
| `:178` | `useState<LslWindow>('7d')` (`windowKey`) | UI-window toggle | LEGITIMATE LOCAL — pure UI state (which window radio button is active) |
| `:183` | `useRef<LslWindow \| null>(preSlideWindowRef)` | "remember pre-autoslide window so deselect restores it" | LEGITIMATE LOCAL — UX-only memory, not a selection surface |
| `:197` | `useRef<number \| null>(prevSelectedTsRef)` | Previous `selectedTs` for "did we transition selected → deselected?" | LEGITIMATE LOCAL — derived-from-store guard against effect re-firing |
| `:208` | `useRef<HTMLDivElement \| null>(stripRef)` | DOM ref for keyboard nav | LEGITIMATE LOCAL — DOM handle |
| **`:225`** | **`useState<string \| null>(clickedTickKey)`** | **"Which tick was last clicked? (id\|startAt)"** | **VIOLATION** — the tick-ring surface is read from this local cache (`:669`). The same surface should derive from `selectedSessionId` + `selectedNodeId` (the canonical store fields). This is the **root cause of Issue 2** (multi-tick ring leak across navigations). |

### 2.2 `D3GraphCanvas.tsx`

| Line | Hook | Value type | Classification |
|---|---|---|---|
| `:118` | `useRef<HTMLDivElement>(containerRef)` | DOM ref | LEGITIMATE |
| `:119` | `useRef<SVGSVGElement>(svgRef)` | DOM ref | LEGITIMATE |
| `:120` | `useRef<d3.ZoomBehavior>(zoomBehaviorRef)` | d3 zoom handle | LEGITIMATE |
| `:121` | `useRef<d3.ZoomTransform>(transformRef)` | d3 transform cache | LEGITIMATE — required by d3 zoom API to persist across re-renders |
| `:122` | `useRef<d3.Simulation>(simulationRef)` | d3 simulation handle | LEGITIMATE — d3 mutation API requires a handle outside the effect |

No `useState` in D3GraphCanvas. All selection reads flow from `useViewerStore` subscriptions. No violations in this file at the **local-state** layer — but see §3 / §4 for the dep-list violation.

### 2.3 `HistorySidebar.tsx`

| Line | Hook | Value type | Classification |
|---|---|---|---|
| `:117` | `useRef<HTMLUListElement>(listRef)` | DOM ref for scrollIntoView | LEGITIMATE |

No local selection state. CLEAN.

### 2.4 `OccurrenceHistorySidebar.tsx`

No `useState`/`useRef`. CLEAN.

### 2.5 Violation list summary

ONE violation, in ONE file:

> **V1:** `LslTimelineStrip.tsx:225` — `const [clickedTickKey, setClickedTickKey] = useState<string | null>(null)`. The tick-ring CSS class predicate reads this local state at `:669`. It duplicates state that the store already carries (`selectedSessionId` + the (id, startAt) bucket identity). It is the proximate root cause of Issue 2 (multi-tick leak after pane-to-pane navigation).

---

## 3. Tick ring root cause (Issue 2 — multi-tick ring leak)

### 3.1 The predicate (current form, `LslTimelineStrip.tsx:651-675`)

```tsx
const isSelectedBucket =
  selectedTs !== null
  && Number.isFinite(startMs)
  && selectedTs >= startMs
  && selectedTs < endMs                     // line 655
const tickKey = `${s.id}|${s.startAt}`      // line 668
const isClickedTick = clickedTickKey === tickKey   // line 669
const isSelected = isSelectedBucket || isClickedTick // line 670
const ringClass = isSelected
  ? 'ring-2 ring-blue-500'
  : (isRunning && selectedTs === null && clickedTickKey === null)
    ? 'ring-2 ring-primary'
    : ''
```

### 3.2 Inputs the predicate feeds on

| Input | Source | Stability |
|---|---|---|
| `selectedTs` | Derived (`useMemo` at `:246-254`) from store `selectedNodeId` + `entities` | Store-driven |
| `startMs`, `endMs` | Per-tick render data | Stable for a given tick |
| **`clickedTickKey`** | **LOCAL** `useState` (`:225`) | **Local cache, only reset by the effect at `:226-230`** |

So **one of the three predicate inputs is LOCAL not store-derived**. That's the violation in §2 surfaced.

### 3.3 Why two successive tick clicks can leave two ticks ringed

The local `clickedTickKey` is reset to `null` only by ONE rule:

```tsx
useEffect(() => {
  if (selectedSessionId === null) {
    setClickedTickKey(null)
  }
}, [selectedSessionId])
```

(`LslTimelineStrip.tsx:226-230`)

That is, `clickedTickKey` only clears when store `selectedSessionId`
transitions `non-null → null`. But:

- Clicking **tick A** writes `selectedSessionId = 'sess-A'` and `clickedTickKey = 'sess-A|tA'`. Both ticks of session A would NOT light up because the local key is keyed on the composite (good).
- Clicking **tick B** writes `selectedSessionId = 'sess-B'` and `clickedTickKey = 'sess-B|tB'`. Both A's ring (driven by `isClickedTick`) clears because `clickedTickKey` now equals B's key.
- Same-session two-click case: clicking **tick A** then a second tranche **tick A'** (same id, different startAt) writes `selectedSessionId = 'sess-A'` BOTH times. The effect at `:226-230` does NOT fire — `selectedSessionId` did not transition to `null`. The local `clickedTickKey` updates from `sess-A|tA` to `sess-A|tA'`, so only one ring is shown via `isClickedTick`. So pure two-click-tick-to-tick within the strip itself does NOT produce a multi-ring leak.

**So when DOES the leak happen?** The most likely surface is **graph-side selection drives `isSelectedBucket` while a stale `clickedTickKey` is still set**:

State transition replay:
1. User clicks tick A (`sess-A|tA`). Strip writes `selectedNodeId=e1`, `selectedSessionId=sess-A`, `clickedTickKey=sess-A|tA`. Tick A rings via `isClickedTick`. Other tranches of session A also have a `selectedTs` falling in their bucket if e1's createdAt happens to lie in their `[startMs, endMs)` range — and because A's tranches are time-contiguous, more than one tranche of A may straddle (or be neighbor to) `selectedTs`. In practice the API returns one tranche per LSL file with non-overlapping ranges, so `isSelectedBucket` only fires on the tranche that contains e1's createdAt.
2. Then user clicks a **graph node** e2 (from a different session). The graph writes:
   - `selectedNodeId = e2`
   - `selectedSessionId = null` (`D3GraphCanvas.tsx:498`)
   - The `selectedSessionId → null` transition fires the effect at `:226-230` → `setClickedTickKey(null)`. Good.
3. But: between the `setState` at `:493-499` and React's effect flush, the render uses the NEW `selectedNodeId` (so `selectedTs` updates to e2's createdAt → `isSelectedBucket` flips to e2's hosting tranche) AND the STILL-CACHED `clickedTickKey = sess-A|tA` (because `setState` from inside the effect at `:226-230` schedules an additional render, not a synchronous reset of the value within this render). So during the intermediate render, BOTH the old `isClickedTick` (sess-A|tA) AND the new `isSelectedBucket` (around e2) ring.

This is the **multi-tick ring leak**: a one-render visual flash where two ticks are simultaneously ringed because the local cache `clickedTickKey` clears one render late relative to the store-driven `isSelectedBucket`. Visually this can persist long enough to be noticed as "two ticks ringed".

### 3.4 What the predicate SHOULD be if the store fields were the only inputs

The CONTEXT.md decision (§3 / §5) says shared selection lives in the
store. The tick ring should fire iff one of the following two store
predicates holds:

```ts
// Pure store-derived. No local state.
const isSelectedBucket =                       // graph→timeline cascade
  selectedTs !== null && selectedTs >= startMs && selectedTs < endMs
const isDirectClickedBucket =                  // direct tick click cascade
  selectedSessionId === s.id && bucketKeyMatches(s, selectedTs, source)
const isSelected = isSelectedBucket || isDirectClickedBucket
```

But this fails on the **tranche-disambiguation problem** the existing
local state was introduced to solve. Two ways to fix it cleanly:

**Option A — replace `selectedSessionId: string` with `selectedBucketKey: string` in the store.** The store field carries the composite `(id|startAt)` of the selected bucket. Then the predicate becomes `selectedBucketKey === tickKey`. No local state, no race.

**Option B — keep `selectedSessionId` and add a parallel store field `selectedSessionStartAt: string | null`.** The predicate is `selectedSessionId === s.id && selectedSessionStartAt === s.startAt`. Same effect, less invasive to existing tests/typings.

Either way, the local `clickedTickKey` and its reset-effect must be deleted.

---

## 4. `pathToSelected` reference instability (Issue 1 — graph re-layout on tick click)

### 4.1 Where `pathToSelected` is written from `LslTimelineStrip.onTickClick`

`LslTimelineStrip.tsx:466-472` calls `computeAncestryPath(firstEntityId, relations)` from `@/graph/ancestry` and computes:

```ts
const pathToSelected: Set<string> = path !== null
  ? new Set<string>(path.nodeDepths.keys())
  : new Set<string>()
```

Then writes it in BOTH the Cmd/Ctrl branch (`:497`) AND the plain-click branch (`:521`). The empty-entityIds branch at `:443-457` deliberately does **not** write it.

The writer **does NOT guarantee reference stability when the contents don't change**: every click constructs a fresh `new Set<string>(...)`. Two consecutive clicks on ticks that share the same focal entity (rare but possible after Cmd/Ctrl additive) will write *different references containing the same ids*.

### 4.2 Where `pathToSelected` is read in `D3GraphCanvas.tsx`

**Not read directly.** The D3 file does NOT subscribe to `pathToSelected`. There is no `useViewerStore((s) => s.pathToSelected)` in the file. Instead:

`D3GraphCanvas.tsx:307` — `applySelectionStyling` calls `computeAncestryPath(selectedNodeId, visibleRelations)` inline. The result is used directly, ignoring the store's `pathToSelected`.

So the D3 graph's "re-layout / zoom feel" on tick click CANNOT be attributed to `pathToSelected` reference instability — D3 doesn't read it.

### 4.3 What CAN cause the D3 re-layout on a tick click?

The D3 main render effect's dep list is at `:607`:

```ts
}, [visibleEntities, visibleRelations, theme, isLoading])
```

When the tick click writes to the store, the field changes that COULD invalidate the `visibleEntities` `useMemo` (`:162-255`) are:

- `selectedTeams`, `selectedClasses`, `visibleLevels`, `searchQuery`, `learningSource`, `selectedLayers`, `hideDocNodes`, `lslFilterEntityIds`, `entities`

Of these, the tick click writes **`lslFilterEntityIds`** (plain branch `:523` writes `new Set<string>(ids)`; Cmd/Ctrl branch `:490` writes a fresh `union` Set; the empty-entityIds branch deliberately omits it).

This means:

- **Plain tick click → fresh `Set` reference for `lslFilterEntityIds` → `visibleEntities` `useMemo` invalidates → fresh array → main render effect fires → SVG rebuilt + force simulation restarted.** This IS the "re-layout / zoom feel" Issue 1.
- **Empty-entityIds tick click → no `lslFilterEntityIds` write → `visibleEntities` stable → no re-render.** The continuation-2 fix at `:443-457` is correct *for this case*.
- **Graph node click on the same `selectedNodeId` it already had → no `visibleEntities` invalidation → no re-render.** Stable.

So Issue 1's root cause for **non-empty tick clicks is the fresh `Set` written to `lslFilterEntityIds` invalidating `visibleEntities`**, not `pathToSelected`. The `pathToSelected` thread is a red herring at the D3 surface; it IS a problem at the sigma surface (where `pathToSelected` IS a `visibleEntities`-tier input — `graph-builder.ts:461,487`), but the coding tab uses D3.

> **Audit finding R1:** Issue 1's true mechanism is `lslFilterEntityIds: new Set<string>(ids)` written on every plain tick click → `visibleEntities` memo invalidation → SVG rebuild + force-simulation restart. The empty-entityIds branch already dodges this correctly (it skips the write); the non-empty branches do NOT. To end Issue 1, either (a) deep-equal-guard the `lslFilterEntityIds` write to no-op when the new set matches the existing set, or (b) skip the `lslFilterEntityIds` write when the user clicked a tick whose ids are already the active filter (idempotent click), or (c) decouple the LSL filter writes from the selection writes — they are conceptually orthogonal and should not co-cascade.

### 4.4 Recommended minimal fix

The minimal fix is option (a) — deep-equal guard in the store action or at the call site:

```ts
// Pseudocode at the writer
const prev = useViewerStore.getState().lslFilterEntityIds
if (!prev || prev.size !== ids.length || !ids.every((id) => prev.has(id))) {
  // contents differ — write the new Set
  useViewerStore.setState({ lslFilterEntityIds: new Set<string>(ids) })
} // else: preserve reference, no D3 invalidation
```

The store action `setLslFilterEntityIds` (`viewer-store.ts:483`) is the natural place to host this. Today it does an unconditional `set({ lslFilterEntityIds: ids })`, which is reference-unstable. Hosting the dedup in the action also future-proofs other call sites (Cmd/Ctrl additive, future deep-link writes).

**Also recommended:** drop the inline `useViewerStore.setState({...})` pattern in `LslTimelineStrip.tsx:486-498,517-527` and route through the `setSelection` action (which already exists, `viewer-store.ts:262`). The `setSelection` action can carry deep-equal guards centrally so every caller benefits.

---

## 5. 0-obs / 0-entities tick policy (Issue 3)

### 5.1 Where 0-obs buckets originate

Bucket generation is server-side, in
`scripts/observations-api-server.mjs:2103-2226` (handler for
`GET /api/coding/lsl/sessions`). The aggregator walks the LSL history
directory, parses each filename via the regex at `:2053-2060`, then
calls `aggregateForRange(startMs, endMs)` at `:2181-2190`.

`aggregateForRange` does NOT skip empty ranges:

```js
const aggregateForRange = (startMs, endMs) => {
  const matches = allEnts.filter(
    (e) => e.createdMs >= startMs && e.createdMs < endMs,
  );
  matches.sort((a, b) => TYPE_RANK(a.type) - TYPE_RANK(b.type));
  return {
    entityIds: matches.map((x) => x.id),
    totalCount: matches.length,
  };
};
```

(`observations-api-server.mjs:2181-2190`)

When the bucket has no entities, it returns `{ entityIds: [], totalCount: 0 }` — which is still emitted as a session at `:2211-2217`:

```js
sessions.push({
  id: parsed.id,
  startAt: parsed.startAt,
  endAt,
  observationCount: totalCount,   // 0
  entityIds,                      // []
});
```

So every LSL filename that the writer dropped to disk shows up as a tick, even if no entities were captured into the KG during that window.

### 5.2 Confirmed source of 0-obs/0-ents ticks

`scripts/observations-api-server.mjs:2174-2180` documents the policy explicitly:

> "every tick must be clickable. Return ALL entityIds in the bucket, sorted by TYPE_RANK so the FIRST one is the best selection target — Insights bubble up; if none, the user gets the top non-stream entity; if still none, an Observation."

But the inverse — "if there's nothing to click, the bucket shouldn't be clickable" — is NOT implemented. Empty buckets render as ticks.

### 5.3 Phase-56 contract bleed

The Phase 56 fix at `LslTimelineStrip.tsx:443-457` introduced an "empty-entityIds branch" so empty clicks become near-no-ops — but the tick is still rendered AND clickable. This is a policy choice that should be made explicitly, not by lateral-load on the click handler.

### 5.4 Three candidate policies (operator to choose)

| Policy | Implementation locus | Pros | Cons |
|---|---|---|---|
| **A. Filter at the data layer** | `observations-api-server.mjs:2211` (skip when `totalCount === 0`) | Simplest; removes the clickability question entirely; reduces over-the-wire size | LSL filenames will silently disappear from the UI even though a transcript file exists; might surprise the operator looking for proof "I had a session at 11am" |
| **B. Grey-out at the render layer** | `LslTimelineStrip.tsx` — render `opacity-40 pointer-events-none` when `s.observationCount === 0` | Preserves "I had a session" visual marker; removes the spurious click cascade | Two visual states (clickable / non-clickable) need to be distinguishable to keyboard users too |
| **C. Leave but show count badge, click is explicit no-op** | `LslTimelineStrip.tsx` — render a small `0` badge; keep the existing empty-branch behaviour | Most informative; lets the operator see when entity capture lagged behind transcript write | Highest visual complexity; doesn't address Issue 3 framing ("they shouldn't show up as buckets you can select") |

**Recommendation:** B (grey-out + pointer-events-none). It honors the operator's "shouldn't be selectable" request while preserving the diagnostic value of seeing that a session existed. Implementation is one CSS class change in `LslTimelineStrip.tsx:693`.

> **Audit finding D1:** This is genuinely out of the Phase 56 selection-sync scope (per CONTEXT.md §domain: "pure frontend selection-plumbing phase"), but the Phase 56 click handler exposes it. The operator should make the call before another patch round; whichever policy is chosen, lock it in PATTERNS.md so future plans don't re-litigate.

---

## 6. Recommended refactor (state-model first)

Given the audit, the minimum-change refactor to end the cycle is:

### 6.1 Local-state hooks to DELETE

- `LslTimelineStrip.tsx:225` — `useState<string | null>(clickedTickKey)`. Driven entirely by the store's session/bucket selection.
- `LslTimelineStrip.tsx:226-230` — the reset effect that drives `clickedTickKey`. Falls out with V1.

### 6.2 Store fields to ADD

ONE addition recommended: `selectedSessionStartAt: string | null`.

Rationale: `selectedSessionId` alone cannot disambiguate tranches of the same session (multiple `LslSession` objects share `id`, differ in `startAt`). Adding the `startAt` lets the store carry the *bucket* identity, not just the session identity.

**Schema delta:**

```ts
// add
selectedSessionStartAt: string | null
// default
selectedSessionStartAt: null
// in setSelection args
sessionStartAt?: string | null
// in clearSelection / reset
selectedSessionStartAt: null
```

Alternatively (simpler but slightly looser): replace `selectedSessionId: string` with `selectedBucketKey: string` (`"<sessionId>|<startAt>"`). Less typesafe for cross-pane reads that only want the session id, so the additive approach above is preferred.

### 6.3 Writers to CONSOLIDATE

- All inline `useViewerStore.setState({...})` patterns in `LslTimelineStrip.tsx:444-451`, `:486-498`, `:517-527` → call `setSelection({...})` (action at `viewer-store.ts:262`). Reduces the number of "atomic write" sites from 4 to 1.
- All inline `useViewerStore.setState({...})` in `D3GraphCanvas.tsx:493-499`, `HistorySidebar.tsx:100-105`, `OccurrenceHistorySidebar.tsx:113-118` → same. (Three of these copies of the same pattern keep drifting.)
- The `setLslFilterEntityIds` action (`viewer-store.ts:483`) should host the deep-equal guard so the writer side is reference-stable. Today every writer constructs a fresh `Set` and the store accepts it unconditionally.

### 6.4 Read-derivations to push DOWN to pure functions

- `applySelectionStyling`'s inline `computeAncestryPath` call at `D3GraphCanvas.tsx:307` should READ `pathToSelected` from the store (or the store should drop the field — see §1.5 finding S3).
- `selectedTs` memo at `LslTimelineStrip.tsx:246-254` is a fine pattern (pure-function-of-store) — keep.

### 6.5 Tick-ring contract (predicate after refactor)

> **The tick ring SHOWS on bucket X iff:**
> `selectedBucketKey === ${X.id}|${X.startAt}` OR
> `(selectedTs !== null && selectedTs >= X.startMs && selectedTs < X.endMs)`
>
> where `selectedBucketKey` is derived from store as `${selectedSessionId}|${selectedSessionStartAt}` (or directly if the alternative schema is chosen).

No local state. The predicate is a pure function of the store snapshot.

### 6.6 Graph-side selection contract

> **The graph node ring + ancestry trace SHOWS on node X iff:**
> `selectedNodeId === X.id`
>
> The ancestry trace is computed from `selectedNodeId` + `relations` (current behavior at `D3GraphCanvas.tsx:307`). `pathToSelected` from the store is either (a) re-used here so the work isn't duplicated, or (b) removed from the store schema (preferred — the D3 path doesn't need it and the sigma path can derive it locally).

### 6.7 Viewport-stability contract

> **The graph viewport DOES NOT animate / re-fit / re-layout on non-graph selection.**
>
> Test assertion (D3GraphCanvas test surface):
> ```ts
> // capture the SVG <g transform=...> before tick click
> const before = svg.querySelector('g').getAttribute('transform')
> fireEvent.click(timelineTick)
> await act(() => waitForNextFrame())
> const after = svg.querySelector('g').getAttribute('transform')
> expect(after).toBe(before)        // no zoom transition
> // ALSO: no force-simulation restart
> expect(simulationRestartSpy).not.toHaveBeenCalled()
> // ALSO: no SVG rebuild
> expect(svg.querySelectorAll('.node').length).toBe(initialNodeCount) // stable count
> ```

The mechanism that enforces this is: `visibleEntities` `useMemo` MUST NOT invalidate on a tick click. Today it does because `lslFilterEntityIds: new Set<string>(ids)` is written with a fresh reference. After the deep-equal guard recommended in §4.4, the reference is preserved when ids are unchanged → memo stable → effect doesn't fire → no rebuild, no force restart.

---

## 7. Risk register

| # | Proposed change | Risk (what could break) | Test that would catch it |
|---|---|---|---|
| R1 | Delete `clickedTickKey` local state, derive tick ring from store | Same-session repeat-tranche click no longer disambiguates if `selectedSessionStartAt` field isn't added/wired correctly | New test: click tranche A of `sess-X`, then click tranche A' of `sess-X`; assert only A' rings, not A |
| R2 | Add `selectedSessionStartAt` to store | Existing tests that assert `selectedSessionId` round-trips might miss the new field and leave it stale across selections | Store test: every `setSelection` test asserts BOTH session-fields are set together |
| R3 | Deep-equal guard in `setLslFilterEntityIds` | Future caller might mutate the existing Set in place and expect a re-render — would not get one | Store test: feed the same ids twice and assert reference equality across the two writes |
| R4 | Consolidate inline `setState`s into `setSelection` action | If `setSelection` doesn't accept every key callers currently write (e.g. `lslFilterEntityIds` isn't in its args today — `viewer-store.ts:149-155`), some writers silently drop fields | Acceptance grep: every selection writer routes through `setSelection`; no `useViewerStore.setState` outside the store |
| R5 | Drop `pathToSelected` reads from D3 path or remove field entirely | Sigma renderer (events.ts/reducers.ts/graph-builder.ts) DOES read it; removal would break the sigma path | Sigma reducer test (already exists at `reducers.test.ts`) — keep passing |
| R6 | 0-obs tick policy change (filter / grey-out / leave) | Filter policy hides genuine session evidence; grey-out policy still uses up strip real-estate; leave policy preserves the puzzle | Smoke test specific to the chosen policy; lock with a Playwright assertion on `lsl-tick-*` count vs. session count |
| R7 | Switching writers to the `setSelection` action will change the field-merge semantics for partial writes | The action's preserve-vs-reset rules for `pathToSelected` (`viewer-store.ts:268-274`) may not match every caller's intent | Action-level test enumerating each caller's expected post-state |

---

## 8. Out of scope (found in passing, NOT Phase 56's brief)

- **Sigma renderer also reads `pathToSelected`.** Removing the field from the store would break the sigma path (`graph-builder.ts:461,487`, `reducers.ts:237`). Sigma is for OKB / KG tab; coding tab uses D3.
- **`SidePanel.tsx:116` close button bypasses `clearSelection()`.** It manually writes `{ selectedNodeId: null, pathToSelected: new Set() }`, which misses `highlightedRowKey`, `selectedSessionId`, `selectionSource`, and `lslFilterEntityIds`. Inconsistent with the Esc / bg-click path. Should route through `clearSelection()` like the rest.
- **`graph/events.ts:99,103`** writes `{ selectedNodeId, pathToSelected }` only — same partial-write issue as SidePanel. Sigma-path code path.
- **`useGraphData` returns a fresh `relations` array per react-query refetch** (`useGraphData.ts:63-69`); when the backend refetches every 30s, every consumer (`visibleEntities` memo, ancestry computation, etc.) invalidates. Out of scope for selection-sync, but worth noting for the "zoom feel after sitting idle for 30s" symptom if it appears.
- **`OccurrenceHistorySidebar.tsx:73`** has a hard mount-gate `if (selectedNodeId !== null) return null`. When the tick handler at `LslTimelineStrip.tsx:518` writes `selectedNodeId = firstEntityId` (a real id), the OccurrenceHistorySidebar unmounts mid-selection. Today this is documented and intended (UI-SPEC §7 row 11 hybrid) but worth flagging because the cascade ALSO clobbers any scroll position in that sidebar. Not a Phase 56 bug per se.
- **`toggleLayer`'s `__none__` sentinel** (`viewer-store.ts:368-381`) and its symmetric handling in `D3GraphCanvas.tsx:211` and `graph-builder.ts:478` are Phase 55 quirks that produce the layer-filter test failures the operator separately reported. Out of Phase 56 scope.
- **`reset()` clears `pathToSelected` only via the implicit setter at `:329-338`** — actually no, the `reset` action does NOT touch `pathToSelected`. Compare to `clearSelection()` which DOES. Two near-identical actions with subtly different field coverage. Out of Phase 56 scope but a near-future trap.

---

*Audit complete. No source files were modified.*
