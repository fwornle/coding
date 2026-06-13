# Phase 56: Unified Viewer — Bidirectional Selection & Timeline Scale — Pattern Map

**Mapped:** 2026-06-13
**Files analyzed:** 7 modified + 3 test files extended + 1 new E2E spec
**Analogs found:** 11 / 11 (every file has at least an in-tree analog — most are extend-in-place)

> Phase 56 is a **modify-in-place** phase. Every file in scope already exists
> and has a `*.test.ts(x)` sibling. The pattern map below is dominated by
> **"extend this exact section"** notes rather than "copy from another file."
> The one exception is the **timestamp-scale renderer** in `LslTimelineStrip.tsx`
> — there is no in-tree analog for d3-axis-style tick labels, so the planner
> must hand-roll a small renderer using the **`pctOfWindow` math already in
> the file** + `Intl.DateTimeFormat`. d3-scale / d3-axis are NOT available
> (the unified-viewer package.json ships d3 7.9 in full but no usage of
> `scaleTime` / `axisBottom` exists anywhere in `/integrations`).

## File Classification

| File (modify) | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/store/viewer-store.ts` | store | state-slice extension | self (Phase 55 selection slice at lines 67-85, 156-169) | exact (extend) |
| `src/graph/D3GraphCanvas.tsx` | component | event-driven (d3 selection sync) | self (existing `applySelectionStyling` at lines 327-365) | exact (extend) |
| `src/panels/coding/LslTimelineStrip.tsx` | component | event-driven + time-scale render | self (lines 103-119 `pctOfWindow`, 414-460 tick render) | exact (extend) — no in-tree d3-axis analog |
| `src/panels/HistorySidebar.tsx` | component | request-response (entity list) + selection sync | self (lines 94-109 already has scroll-into-view on selectedNodeId) | exact (extend visual highlight) |
| `src/panels/OccurrenceHistorySidebar.tsx` | component | request-response + selection sync | self (lines 88-114 has setSelectedNode on click) | exact (extend visual highlight + remove `null` guard if needed) |
| `src/panels/SidePanel.tsx` | component | passive — no behavior change | self | n/a (verify-only) |
| `src/App.tsx` | route shell | n/a | self | n/a (no change — keyboard already wired in ViewerCore via `useKeyboardShortcuts`) |
| `src/store/viewer-store.test.ts` | test | vitest unit | self (lines 101-184 "Phase 55 initial state" pattern) | exact (extend with Phase 56 init-state + setter tests) |
| `src/panels/OccurrenceHistorySidebar.test.tsx` | test | RTL + vitest | self (existing 7 tests using mocked `useGraphData`) | exact (extend with selection-highlight test) |
| `src/panels/coding/LslTimelineStrip.test.tsx` | test | RTL + vitest + fetch mock | self (existing 13 tests cover click/keyboard) | exact (extend with timestamp-scale + selection-tick test) |
| `tests/e2e/unified-viewer/56-bidirectional-selection.spec.ts` (NEW) | E2E | Playwright | `tests/e2e/unified-viewer/entity-detail.spec.ts` (lines 26-80) | role-match (selection-via-store pattern) |

## Pattern Assignments

### `src/store/viewer-store.ts` (store — extend)

**Analog:** itself. The store already defines `selectedNodeId`, `selectedEdgeId`,
`pathToSelected`, plus the LSL slice (`lslSessionFilter`, `lslFilterEntityIds`).
Phase 56 adds **cross-pane sync fields** in the same idiom.

**Existing selection slice — extend right after line 77 (`pathToSelected`):**
```typescript
// Lines 67-77 (existing) — Phase 56 will add adjacent fields below
export interface ViewerState {
  // ---------- Phase 45 — preserved verbatim (BC) ----------
  // Selection
  selectedNodeId: string | null
  selectedEdgeId: string | null

  // 2026-06-11: ancestry path of `selectedNodeId` (System → … → selected).
  // When non-empty, reducer dims every node NOT in this set so the path
  // through the hierarchy is visually traced from the clicked node back
  // to the root — VKB reference behaviour. Empty = no path highlight.
  pathToSelected: ReadonlySet<string>
```

**Pattern — initial-state convention (lines 192-194):**
```typescript
export const useViewerStore = create<ViewerState>((set) => ({
  selectedNodeId: null,
  selectedEdgeId: null,
  pathToSelected: new Set<string>(),
```
- Every Set-typed field initialises with `new Set<...>()`
- Every nullable string initialises with `null`
- Setter is **colocated** with the field group block (Phase 45 setters at lines 208-242, Phase 55 setters at lines 257-340)

**Pattern — setter style (lines 208-209):**
```typescript
setSelectedNode: (id) => set({ selectedNodeId: id }),
setSelectedEdge: (id) => set({ selectedEdgeId: id }),
```
Two flavours co-exist:
1. **Setter on the store** — `setSelectedNode(id)` → `set({ selectedNodeId: id })`
2. **Direct `useViewerStore.setState({ ... })` from consumers** — used by D3GraphCanvas (lines 429, 495) and LslTimelineStrip (line 302) to write **multiple fields atomically**.

**For Phase 56 — recommended fields (planner may rename):**
- `selectionSource: 'graph' | 'timeline' | 'history' | null` — tag who set the selection (lets consumers avoid feedback loops, e.g. timeline doesn't re-center on its own click).
- `highlightedRowKey: string | null` — the history-sidebar row to highlight + scroll. Often equal to `selectedNodeId` but may differ for aggregate selections (LSL session).
- `selectedSessionId: string | null` — orthogonal to `selectedNodeId`. The LSL session tick (aggregate selection per AC #6).
- Setter `setSelection({ nodeId, sessionId?, source })` — atomic write so consumers see a consistent snapshot.

**`reset()` extension (lines 236-242):**
```typescript
// IN-SYSTEM clear button. Does NOT reset visibleLevels (filter defaults
// should persist) or theme (UI pref). Cross-system reset is the remount.
reset: () =>
  set({
    selectedNodeId: null,
    selectedEdgeId: null,
    searchQuery: '',
    selectedClasses: new Set<string>(),
  }),
```
Add the new Phase 56 fields to this object so `reset()` clears them too.

**Cross-pane reset pattern already present in `clearLslSessionFilter` (line 386):**
```typescript
clearLslSessionFilter: () => set({ lslSessionFilter: [], lslFilterEntityIds: null }),
```
Same idiom for any new `clearSelection()` action: clear `selectedNodeId`,
`pathToSelected`, `highlightedRowKey`, `selectedSessionId`, and **also** the
LSL filter fields so Esc/bg-click leave the user in a fully cleared state.

**Logger discipline (line 34):**
> `Logger discipline: ZERO raw console.* per feedback_logger_class.md.`

The store itself never logs — logging happens in consumers (LslTimelineStrip,
SidePanel, FilterRail). Phase 56 should preserve this.

---

### `src/store/viewer-store.test.ts` (test — extend)

**Analog:** itself. The Phase 55 extension (lines 101-358) is the **direct
template**.

**Pattern — initial-state assertion via `getInitialState()` (lines 107-184):**
```typescript
describe('useViewerStore — Phase 55 initial state (Task 1)', () => {
  // PATTERN: Zustand v5 exposes `getInitialState()` on the store hook (vanilla.d.ts:12).
  // We assert against the FRESH store factory snapshot — NOT against any
  // `setState` we (or another test) might have written. This is the only way
  // to guarantee that the new slices are actually wired into the store
  // creator rather than being silently accepted as untyped setState keys.
  const initial = () =>
    (useViewerStore as unknown as { getInitialState: () => ViewerStateAny }).getInitialState()

  test('initial state: selectedLayers === [] (empty = all visible per UI-SPEC §10)', () => {
    expect(initial().selectedLayers).toEqual([])
  })
```
**Use this exact `getInitialState()` cast** for every Phase 56 new field —
that's how you confirm the store creator wires it, not just `setState`.

**Pattern — setter-test boilerplate (lines 187-211 + 214-217):**
```typescript
describe('useViewerStore — Phase 55 action setters (Task 2)', () => {
  beforeEach(() => {
    useViewerStore.setState({
      selectedNodeId: null,
      // … reset every field tested below to a clean baseline …
    })
  })

  test("toggleLayer('evidence') from empty list adds it", () => {
    useViewerStore.getState().toggleLayer('evidence')
    expect(useViewerStore.getState().selectedLayers).toEqual(['evidence'])
  })
```

**Phase 56 tests to add:**
1. Initial state for each new field (mirror lines 110-159 style).
2. Setter test: `setSelection({...})` writes all fields atomically.
3. `reset()` clears the new fields too (mirror line 27 `reset()` test).
4. `clearLslSessionFilter()` (or whatever the "clear all" action is named)
   also clears `selectedNodeId` / `highlightedRowKey` — round-trip safety.

---

### `src/graph/D3GraphCanvas.tsx` (component — extend)

**Analog:** itself. **No external d3 component to copy** — this file IS the
in-tree D3 selection-handling pattern.

**Click handler on nodes (lines 493-500) — the canonical "graph→others" path:**
```typescript
.on('click', (event: MouseEvent, d) => {
  const path = computeAncestryPath(d.id, visibleRelations)
  useViewerStore.setState({
    selectedNodeId: d.id,
    pathToSelected: new Set(path.nodeDepths.keys()),
  })
  event.stopPropagation()
})
```
- `setState` (NOT the named setter) is used because **multiple fields are
  written atomically** — same atomic pattern as the LslTimelineStrip tick
  click (LslTimelineStrip.tsx:302-307, 320-325).
- `event.stopPropagation()` is critical — otherwise the SVG background
  click handler (line 427-431) fires next and clears the selection.

**Background click handler (lines 427-431) — the canonical "click bg = clear" path:**
```typescript
// Background click deselects.
svg.on('click', (event) => {
  if (event.target === svgRef.current) {
    useViewerStore.setState({ selectedNodeId: null, pathToSelected: new Set() })
  }
})
```
**Phase 56:** Extend the payload to clear any new selection fields
(`highlightedRowKey: null`, `selectedSessionId: null`, etc.). The
LslTimelineStrip useEffect at lines 187-211 ALREADY listens to
`selectedTs === null` and clears the LSL filter — so as long as `selectedNodeId`
flips to `null`, the cascade fires for free.

**Selection-styling re-application (lines 327-373) — the canonical re-render path:**
```typescript
const applySelectionStyling = useCallback(
  (svg: d3.Selection<SVGSVGElement, unknown, null, undefined>) => {
    svg.selectAll<SVGCircleElement, D3Node>('.selection-ring').attr('opacity', 0)
    if (!selectedNodeId) { /* clear all */ return }
    svg.selectAll<SVGGElement, D3Node>('.node')
      .filter((d) => d.id === selectedNodeId)
      .select<SVGCircleElement>('.selection-ring')
      .attr('opacity', 1)
    // … ancestry-path styling …
  },
  [selectedNodeId, visibleRelations, theme],
)

// Lightweight selection effect — runs when selection changes without
// a data rebuild. Main render also calls applySelectionStyling at its
// tail so a filter change doesn't drop the highlight.
useEffect(() => {
  if (!svgRef.current) return
  applySelectionStyling(d3.select(svgRef.current))
}, [applySelectionStyling])
```
This is THE pattern for "graph→others" propagation **of the selection ring**.
The store-side selection is the source of truth; this effect mutates the
live DOM **without** triggering the main `useEffect` rebuild (the main
effect's dep list **intentionally omits `selectedNodeId`** — see comment
at lines 599-605). When the planner adds **"history→graph centering"**
(AC #3), centering belongs in this effect — d3's `zoomBehaviorRef.current`
+ `svg.transition().duration(500).call(zoomBehavior.transform, transform)`
(seen at line 557 in `fitToScreen`) is the pan-to-node primitive.

**Gotchas (read first, lines 599-606):**
```typescript
// CRITICAL: the dep list intentionally OMITS `selectedNodeId`. Listing
// it here makes every click rebuild the entire SVG + restart the force
// simulation + clobber whatever the selection useEffect just painted.
// The initial selection-ring visibility is set once at mount-time from
// the current `selectedNodeId` value (closure capture); subsequent
// selection changes are handled exclusively by the selection useEffect
// above, which mutates ring + path styling in place on the LIVE DOM.
}, [visibleEntities, visibleRelations, theme, isLoading])
```
**Phase 56 must not violate this invariant.** Any new selection-aware
visual (e.g. highlighting nodes whose id is in `lslFilterEntityIds`)
must either live in `applySelectionStyling` or in **another lightweight
effect** that mutates the live DOM — never expand the main `useEffect`
dep list.

**No `Esc` handler in this file** — global Esc is handled by
`useKeyboardShortcuts.ts:152-174` (see "Keyboard handlers" section below).

---

### `src/panels/coding/LslTimelineStrip.tsx` (component — extend)

**Analog:** itself. The tick-positioning math is in-place; Phase 56 adds a
**second SVG/HTML layer above the ticks** for the timestamp scale.

**Existing tick-position helper (lines 103-119):**
```typescript
function pctOfWindow(iso: string, windowMs: number, originMs?: number): number {
  const ts = new Date(iso).getTime()
  if (Number.isNaN(ts)) return 0
  // 2026-06-12: with an explicit `originMs` (used by the 'all' window),
  // position is measured against [originMs, now] instead of [now-windowMs, now].
  if (typeof originMs === 'number') {
    const span = Math.max(Date.now() - originMs, 1)
    const pct = ((ts - originMs) / span) * 100
    return Math.max(0, Math.min(100, pct))
  }
  const age = Date.now() - ts
  const pct = (1 - age / windowMs) * 100
  return Math.max(0, Math.min(100, pct))
}
```
**Phase 56:** The same math gives you the **major tick X positions**. To get
5–8 evenly-spaced labels, compute timestamps at `[0%, 14%, 28%, …, 100%]` of
the window/origin span, format each, and render them as absolutely-positioned
`<span>`s above the strip (mirror the existing tick `style={{ left: ${left}% }}`
at line 446).

**Existing local-time formatter (lines 124-132):**
```typescript
function fmtLocalTs(iso: string | null | undefined): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return iso
  const d = new Date(t)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} `
    + `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
```
**Phase 56 timestamp-scale formatter** should follow the same hand-rolled
`pad`-based style (no `d3-time-format` import — see "AVAILABLE LIBRARIES"
below). For the **format-by-duration** contract in CONTEXT.md (sub-min /
sub-day / multi-day), wrap a `formatScaleLabel(ms, windowMs)` helper near
the existing `fmtLocalTs`:
```typescript
// SUGGESTED — planner picks the exact format strings
function formatScaleLabel(ms: number, windowMs: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  if (windowMs <= 60_000) return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  if (windowMs <= 86_400_000) return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  // multi-day: "Jun 12" + minor HH:MM ticks separately
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
```

**Existing tick render layer (lines 405-461):**
```typescript
<div className="flex-1 relative h-6">
  {sessions.length === 0 ? (
    <div data-testid="lsl-empty-state" ... />
  ) : (
    sessions.map((s) => {
      const left = pctOfWindow(s.startAt, WINDOW_MS[windowKey], allOriginMs)
      // … ringClass / fillClass …
      return (
        <Tooltip key={`${s.id}|${s.startAt}`}>
          <TooltipTrigger asChild>
            <button
              ...
              style={{ left: `${left}%` }}
              className={`absolute w-2 h-6 ${fillClass} rounded-sm ${ringClass}`}
              aria-label={...}
            />
          </TooltipTrigger>
          <TooltipContent>{formatTooltipText(s)}</TooltipContent>
        </Tooltip>
      )
    })
  )}
</div>
```
**Phase 56 scale layer** mirrors this. Inside the same `<div className="flex-1 relative h-6">`,
add a sibling layer (or split into two stacked divs — `flex-col`) that maps a
computed `scaleTicks: number[]` (millisecond timestamps) to absolutely-positioned
labels.

**Container height bump:** the strip is currently `h-8` (line 380). Adding a
text label row means going to `h-12` or `h-14`. **Verify the StatsBar /
Footer layout (UnifiedViewer.tsx:362-398) still snaps** — Phase 55 §7 visual
parity guard.

**Existing aggregate-selection store-write pattern (lines 287-330) — the canonical "timeline→others" path:**
```typescript
function onTickClick(
  e: React.MouseEvent<HTMLButtonElement>,
  sessionId: string,
  session?: LslSession,
) {
  e.stopPropagation()
  const ids = session?.entityIds ?? []
  if (e.metaKey || e.ctrlKey) { /* additive — set union */ }
  // Plain click — REPLACE the filter with this session's entity set.
  const firstEntityId = ids[0] ?? null
  useViewerStore.setState({
    selectedNodeId: firstEntityId,
    pathToSelected: new Set<string>(),
    lslSessionFilter: [sessionId],
    lslFilterEntityIds: new Set<string>(ids),
  })
  Logger.info(
    Logger.Categories.PANELS,
    `LslTimelineStrip tick → filter:${ids.length} ids, select:${firstEntityId ?? 'none'}`,
  )
}
```
**This is already AC #4-compliant** ("clicking a tick selects the
corresponding node(s) in the graph"). What Phase 56 needs to ADD here:
- Write `highlightedRowKey: firstEntityId` so the history sidebar scrolls.
- Write `selectionSource: 'timeline'` so the store knows the source.
- Write `selectedSessionId: sessionId` so the timeline's own "selected
  tick" rendering can stay loop-safe.

**Existing reverse-mapping (lines 161-175) — already drives "graph→timeline" highlight:**
```typescript
const { entities } = useGraphData(apiClient, system)
const selectedTs = useMemo<number | null>(() => {
  if (!selectedNodeId) return null
  const ent = entities.find((e) => e.id === selectedNodeId)
  const created = (ent?.createdAt as string | undefined)
    ?? ((ent?.metadata as { createdAt?: string } | undefined)?.createdAt)
  if (typeof created !== 'string') return null
  const t = Date.parse(created)
  return Number.isFinite(t) ? t : null
}, [selectedNodeId, entities])
```
Confirmed: AC #2 ("graph→timeline tick highlight") is **already wired**
via `selectedTs` → `isSelectedBucket` predicate at lines 426-435. Phase 56
verifies this still works after store extension; no new code required for
graph→timeline.

---

### `src/panels/coding/LslTimelineStrip.test.tsx` (test — extend)

**Analog:** itself. Existing 13 tests cover click semantics, keyboard, and
empty state. Phase 56 adds:
1. **Timestamp-scale label render** — assert 5–8 labels visible across the
   strip, format matches the window (sub-min / sub-day / multi-day).
2. **Selection→tick highlight** — set `selectedNodeId` to a node whose
   `createdAt` falls in session B's range, assert `lsl-tick-sess-B...`
   has `ring-blue-500`.

**Pattern for fetch mocking (lines 66-104):**
```typescript
function makeFetchResponse(payload: unknown): typeof fetch {
  return vi.fn().mockImplementation(async () => {
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ success: true, data: payload }),
    } as Response
  }) as unknown as typeof fetch
}

function renderStrip({
  system = 'coding',
  sessions = makeSessions(),
}: { system?: 'coding' | 'okb'; sessions?: LslSession[] } = {}) {
  const originalFetch = globalThis.fetch
  const fetchImpl = makeFetchResponse({ sessions })
  globalThis.fetch = fetchImpl
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })
  const apiClient = new ApiClient('http://localhost:12436')
  const result = render(
    <QueryClientProvider client={client}>
      <LslTimelineStrip system={system} apiClient={apiClient} />
    </QueryClientProvider>,
  )
  return { ...result, fetchImpl, apiClient, restore: () => { globalThis.fetch = originalFetch } }
}
```

**Pattern for store-driven selection in test (lines 196-208):**
```typescript
test('Test 6: click a tick sets setLslSessionFilter([id]) (replaces selection)', async () => {
  useViewerStore.setState({ lslSessionFilter: ['stale'] })
  const r = renderStrip()
  try {
    await waitFor(() => screen.getByTestId('lsl-tick-sess-bbbbbbbb'))
    const tick = screen.getByTestId('lsl-tick-sess-bbbbbbbb')
    act(() => { fireEvent.click(tick) })
    expect(useViewerStore.getState().lslSessionFilter).toEqual(['sess-bbbbbbbb'])
  } finally { r.restore() }
})
```
**Phase 56 add — "selection→tick highlight":**
```typescript
test('Test 14: setting selectedNodeId on a node in sess-B range adds ring-blue-500 to its tick', async () => {
  // Mock useGraphData via vi.mock at top of file (or use a real ApiClient that
  // hits the mock fetch — both shown in this file).
  // Then:
  useViewerStore.setState({ selectedNodeId: 'e3' /* in sess-bbbbbbbb */ })
  const r = renderStrip()
  try {
    await waitFor(() => {
      const tick = screen.getByTestId('lsl-tick-sess-bbbbbbbb')
      expect(tick.className).toMatch(/ring-blue-500/)
    })
  } finally { r.restore() }
})
```

**Source-grep gates (lines 271-297) — Phase 56 must keep these green:**
```typescript
test('Test 11: Logger discipline — no raw console.* in the source file', () => {
  const src = readFileSync(...)
  expect(src).not.toMatch(/console\.(log|warn|error|info|debug|trace)/)
})

test('Test 12: source-grep gates — system==coding gate, /api/coding/lsl/sessions, ToggleGroup, setLslSessionFilter all present (≥4)', () => {
  // …
})
```
**Add a Phase 56 grep gate:** `expect(src).toMatch(/formatScaleLabel|d.toLocaleDateString|d3-time-format/)`
to assert the scale renderer is wired in source (catches drift if a refactor
loses the scale code).

---

### `src/panels/HistorySidebar.tsx` (component — extend)

**Analog:** itself. **AC #2 ("graph→history highlight") is already partially
wired** — lines 101-109 already auto-scroll on `selectedNodeId`. Phase 56
adds the **visual highlight class** to the active row.

**Existing click→store handler (lines 94-96):**
```typescript
const onClick = (id: string) => {
  useViewerStore.setState({ selectedNodeId: id })
}
```
**Phase 56 extends to atomic write:**
```typescript
const onClick = (id: string) => {
  useViewerStore.setState({
    selectedNodeId: id,
    pathToSelected: new Set(),  // graph recomputes
    highlightedRowKey: id,
    selectionSource: 'history',
  })
}
```

**Existing scroll-on-selection effect (lines 101-109):**
```typescript
const selectedNodeId = useViewerStore((s) => s.selectedNodeId)
const listRef = useRef<HTMLUListElement | null>(null)
useEffect(() => {
  if (!selectedNodeId || !listRef.current) return
  const el = listRef.current.querySelector<HTMLElement>(
    `[data-history-id="${CSS.escape(selectedNodeId)}"]`,
  )
  if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}, [selectedNodeId])
```
**Missing piece:** the `data-history-id` attribute is **NEVER set in the
render** (look at lines 129-159 — the `<button>` has no `data-history-id`).
The selector is dead code today. **Phase 56 MUST add `data-history-id={item.id}`
to the `<button>` at line 132.**

**Existing row render (lines 129-159) — Phase 56 highlight pattern:**
```typescript
<button
  type="button"
  onClick={() => onClick(item.id)}
  className="w-full text-left px-2.5 py-2 rounded border border-border bg-card hover:bg-accent transition-colors"
>
```
Highlight the active row by extending `className` with a conditional —
mirror the existing `isSelectedBucket` ring pattern from LslTimelineStrip
(line 431): `bg-blue-100 dark:bg-blue-900/40` is the in-tree "selected"
token (already used in OccurrenceHistorySidebar's auto badge — line 147).

---

### `src/panels/OccurrenceHistorySidebar.tsx` (component — extend)

**Analog:** itself. **AC #2 partially wired** — click already sets selection.
Phase 56 must reconsider the `null` guard at line 70.

**Existing click handler + log (lines 88-101):**
```typescript
<button
  key={entity.id}
  type="button"
  role="listitem"
  data-testid={`occurrence-row-${entity.id}`}
  className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
  onClick={() => {
    setSelectedNode(entity.id)
    Logger.info(
      Logger.Categories.PANELS,
      `OccurrenceHistorySidebar → ${entity.id}`,
    )
  }}
>
```

**Visibility guard (line 70) — Phase 56 design question:**
```typescript
// UI-SPEC §7 row 11 — hide entire sidebar when an entity is selected.
if (selectedNodeId !== null) return null
```
This sidebar is **HIDDEN when a node is selected**. Phase 56 AC #2 says
"graph selection highlights matching ROW in history sidebar" — but with
this guard the sidebar isn't even visible. **Two possible plans:**

1. **Keep current UX** — when a graph node is selected, this sidebar
   disappears and `EntityDetailPanel` takes over. AC #2 is satisfied by
   `HistorySidebar.tsx` (the other history feed used in `SidePanel.tsx`
   when nothing is selected — see line 132-136 of SidePanel.tsx).
2. **Drop the guard** — let the sidebar stay visible and highlight the
   selected row. This regresses UI-SPEC §7 row 11 hybrid contract; planner
   should NOT do this without an explicit decision.

**Recommendation:** Plan around option 1 unless the user explicitly wants
the sidebar visible while a selection is active. AC #3 ("history→graph
centering") is already implemented (line 95 `setSelectedNode(entity.id)`).
The Phase 56 work here is the **atomic store write** (add `highlightedRowKey`,
`selectionSource: 'history'`) and **a test for the highlight class** when
the sidebar IS visible (i.e. when `selectedNodeId === null`).

---

### `src/panels/OccurrenceHistorySidebar.test.tsx` (test — extend)

**Analog:** itself. Existing 7 tests use a `mockEntities` array + `vi.mock('@/graph/useGraphData')`.

**Pattern — full mock + render harness (lines 25-49):**
```typescript
const mockEntities: Entity[] = [
  { id: 'e-just-now', name: 'Just Now Entity', ontologyClass: 'Observation', updatedAt: MIN_AGO, layer: 'evidence' },
  // …
]

vi.mock('@/graph/useGraphData', () => ({
  useGraphData: () => ({
    entities: mockEntities,
    relations: [],
    ontology: [],
    isLoading: false,
    error: null,
  }),
}))

import { OccurrenceHistorySidebar } from './OccurrenceHistorySidebar'
import type { ApiClient } from '@/api/ApiClient'

function renderPanel() {
  const apiClient = { base: 'http://test.local' } as ApiClient
  return render(<OccurrenceHistorySidebar apiClient={apiClient} system="coding" />)
}
```

**Pattern — click → store assertion (lines 120-125):**
```typescript
test('Test 4: clicking a row calls setSelectedNode(entity.id)', () => {
  renderPanel()
  const row = screen.getByTestId('occurrence-row-e-min')
  fireEvent.click(row)
  expect(useViewerStore.getState().selectedNodeId).toBe('e-min')
})
```

**Phase 56 add — atomic store write assertion:**
```typescript
test('Test 8: clicking a row writes selection atomically (Phase 56)', () => {
  renderPanel()
  const row = screen.getByTestId('occurrence-row-e-min')
  fireEvent.click(row)
  const s = useViewerStore.getState()
  expect(s.selectedNodeId).toBe('e-min')
  expect(s.highlightedRowKey).toBe('e-min')          // NEW
  expect(s.selectionSource).toBe('history')          // NEW
})
```

**Important — `cleanup()` between tests (line 13 + line 57):**
```typescript
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
// …
beforeEach(() => {
  useViewerStore.setState({ selectedNodeId: null, theme: 'light' })
  cleanup()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
```
**Phase 56 tests must keep this `cleanup()` discipline** because the
sidebar is conditionally rendered (line 70 guard) and stale DOM from a
previous test would mask a regression.

---

### `src/App.tsx` (route shell — verify-only)

**Analog:** itself. **Phase 56 should NOT modify this file.** Keyboard
handling lives in `useKeyboardShortcuts.ts` mounted from `routes/UnifiedViewer.tsx`
(line 92). App.tsx is a 4-route shell with no business logic.

---

### `src/routes/UnifiedViewer.tsx` (route shell — verify-only, NOT in scope)

**Why mentioned here:** The mounting site for `useKeyboardShortcuts` (line 92-101).
Phase 56 verifies that Esc still flows through this hook AFTER the store
extension. **No edit expected.** The hook's Esc handler already calls
`setSelectedNode(null)` at line 170 — Phase 56 may want to either:
- Extend the hook to call a new `clearSelection()` store action (cleaner), or
- Rely on the hook calling `setSelectedNode(null)` + the LslTimelineStrip
  effect at lines 187-211 cascading the LSL filter clear (already wired).

The latter requires zero changes to the hook. The former centralises the
clear logic in the store and matches the planner's "go through the store,
not per-pane handlers" intent in CONTEXT.md.

---

### `src/hooks/useKeyboardShortcuts.ts` (hook — already complete)

**Analog:** itself. **Phase 56 should NOT modify this file** unless the
planner picks the "centralise clear in store" option above.

**Existing Esc-clears-selection handler (lines 150-174):**
```typescript
function onKeyDown(event: KeyboardEvent) {
  // Esc fires regardless of focus (UI-SPEC override)
  if (event.key === 'Escape') {
    const searchEl = searchInputRef.current
    if (searchEl && document.activeElement === searchEl) {
      // Blur the search input first — leaves search query intact per UI-SPEC.
      searchEl.blur()
      event.preventDefault()
      Logger.debug(Logger.Categories.PANELS, 'Esc: blurred search input')
      return
    }
    // Then try to close any open dialog
    if (bindingsRef.current.onCloseHelpDialog()) {
      event.preventDefault()
      Logger.debug(Logger.Categories.PANELS, 'Esc: closed help dialog')
      return
    }
    // Finally fall back to deselecting the current node
    const { selectedNodeId, setSelectedNode } = useViewerStore.getState()
    if (selectedNodeId !== null) {
      setSelectedNode(null)
      event.preventDefault()
      Logger.debug(Logger.Categories.STORE, 'Esc: deselected node')
    }
    return
  }
```
**This is THE Esc handler.** It's mounted exactly once (UnifiedViewer.tsx:92).
Confirmed: AC #7 ("Esc clears in all three panes") is already 80% wired —
Esc clears `selectedNodeId`, which cascades through the LslTimelineStrip
effect (lines 187-211) to clear the LSL filter too. The cascade through
HistorySidebar / OccurrenceHistorySidebar is automatic because those
subscribe to `selectedNodeId`.

**Phase 56 minimum change — if the planner adds new selection fields,**
either:
1. Extend lines 168-173 to clear them, OR
2. Add a `clearSelection()` setter to the store that clears all of them,
   and call it from line 169 (`useViewerStore.getState().clearSelection()`).

**Option 2 is the cleaner pattern** and matches CONTEXT.md "Implementation
must go through the store, not per-pane handlers."

---

### `tests/e2e/unified-viewer/56-bidirectional-selection.spec.ts` (NEW — Playwright E2E)

**Analog:** `tests/e2e/unified-viewer/entity-detail.spec.ts` (lines 26-80) —
the canonical "drive selection via store, assert panel reacts" pattern.

**Pattern — full spec scaffold (verbatim style from entity-detail.spec.ts):**
```typescript
import { test, expect } from '@playwright/test'

interface WindowWithSigma {
  __viewerSigma?: {
    getGraph(): { order: number; nodes(): string[] }
    emit(eventType: string, payload: unknown): void
  }
}

test.describe('Unified Viewer — Phase 56 bidirectional selection', () => {
  test('selecting a node highlights matching history row + timeline tick', async ({ page }) => {
    await page.goto('/viewer/coding')
    await expect(page.getByTestId('viewer-canvas')).toBeVisible()

    // Wait for graph data.
    await expect(async () => {
      const order = await page.evaluate(() => {
        const w = window as unknown as WindowWithSigma
        return w.__viewerSigma?.getGraph()?.order ?? 0
      })
      expect(order).toBeGreaterThan(0)
    }).toPass({ timeout: 30_000 })

    // Drive selection through sigma's clickNode emitter (same as entity-detail.spec.ts).
    const firstNodeId = await page.evaluate(() => {
      const w = window as unknown as WindowWithSigma
      return w.__viewerSigma?.getGraph()?.nodes()?.[0] ?? null
    })
    expect(firstNodeId).not.toBeNull()
    await page.evaluate((id) => {
      const w = window as unknown as WindowWithSigma
      w.__viewerSigma?.emit('clickNode', { node: id })
    }, firstNodeId)

    // Assert history-sidebar row highlighted (Phase 56 new contract).
    await expect(page.locator(`[data-history-id="${firstNodeId}"]`)).toHaveClass(/bg-blue/, { timeout: 5_000 })

    // Assert timeline tick ringed.
    await expect(page.locator('[data-testid^="lsl-tick-"].ring-blue-500')).toHaveCount(1, { timeout: 5_000 })
  })

  test('Esc clears selection in all three panes', async ({ page }) => {
    // … set up selection as above, then …
    await page.keyboard.press('Escape')
    await expect(page.locator('.ring-blue-500')).toHaveCount(0)
    await expect(page.locator('[data-history-id].bg-blue')).toHaveCount(0)
  })
})
```

**Gotchas (verbatim from entity-detail.spec.ts:18-24):**
```
We click the node via the Zustand store rather than a coordinate-based
canvas click because sigma's WebGL hit-testing is unreliable inside
headless chromium when ForceAtlas2 is still settling. The store path
is the same code path the click event handler invokes (`events.ts`
line `deps.setStore({ selectedNodeId: nodeId })`), so the test is
semantically equivalent.
```
**However:** Phase 56 ships the D3 canvas for coding (UnifiedViewer.tsx:353
`const useD3 = system === 'coding' && renderer === 'd3'`), NOT sigma. The
`__viewerSigma` global may not exist when D3 is active. **Planner must
verify** what global the D3GraphCanvas exposes (Grep for `__viewer` in
D3GraphCanvas.tsx — likely nothing today, in which case the planner adds a
small `window.__viewerStore = useViewerStore` test-only hook OR drives
selection via `page.locator('.node').first().click()` against the SVG).

**Playwright config (verified at `/Users/Q284340/Agentic/coding/playwright.config.ts`):**
- `unified-viewer` project, `baseURL: 'http://localhost:5173'`, `testDir: 'tests/e2e/unified-viewer'`
- WebGL flags wired: `--use-gl=swiftshader --enable-webgl --enable-unsafe-swiftshader`
- Run with: `npx playwright test --project=unified-viewer`

---

## Shared Patterns

### Atomic multi-field store writes

**Source:** `LslTimelineStrip.tsx:302-307, 320-325`; `D3GraphCanvas.tsx:429, 495-499`
**Apply to:** Every Phase 56 selection write that touches more than one field.

```typescript
useViewerStore.setState({
  selectedNodeId: firstEntityId,
  pathToSelected: new Set<string>(),
  lslSessionFilter: [sessionId],
  lslFilterEntityIds: new Set<string>(ids),
})
```
Using `setState({...})` (NOT chained named setters) guarantees subscribers
see a consistent snapshot. **Mandatory for Phase 56** because consumers
read `(selectedNodeId, highlightedRowKey, selectionSource)` together —
splitting writes opens a window where the LslTimelineStrip's `selectedTs`
memo recomputes before `highlightedRowKey` flips, masking bugs.

### Logger discipline (mandatory)

**Source:** `LslTimelineStrip.tsx:46 + 206-210, 226-229`; `D3GraphCanvas.tsx` (no logging)
**Apply to:** Every new file or extension. ZERO `console.*`.
```typescript
import { Logger } from '@/lib/logging'

Logger.info(Logger.Categories.PANELS, `LslTimelineStrip tick → filter:${ids.length} ids`)
```

**Available categories** (`src/lib/logging/config/loggingConfig.ts`):
- `DEFAULT`, `ROUTING`, `API`, `STORE`, `GRAPH`, `FILTERS`, `PANELS`, `LOGGER`
- Use `PANELS` for sidebar / timeline actions, `STORE` for store-level
  events, `GRAPH` for D3 selection sync.

**Levels:** `error`, `warn`, `info`, `debug`, `trace`. Default active set
is `[ERROR, WARN, INFO]` — `debug` is dev-opt-in via localStorage.

**Source-grep gates** (already present in LslTimelineStrip.test.tsx:271-277):
```typescript
test('Logger discipline — no raw console.* in the source file', () => {
  const src = readFileSync(path.resolve(process.cwd(), 'src/panels/coding/LslTimelineStrip.tsx'), 'utf8')
  expect(src).not.toMatch(/console\.(log|warn|error|info|debug|trace)/)
})
```
**Phase 56 must add the same gate** to any modified source file's test.

### Zustand store subscription (read path)

**Source:** `SidePanel.tsx:45`, `D3GraphCanvas.tsx:179-193`, `LslTimelineStrip.tsx:151-154, 161`
**Apply to:** Every consumer of new selection fields.

Two flavours used in the codebase:
```typescript
// (A) Subscribe — triggers re-render on change
const selectedNodeId = useViewerStore((s) => s.selectedNodeId)

// (B) Imperative read — no subscription, used inside effects/handlers
const { selectedNodeId, setSelectedNode } = useViewerStore.getState()
```
Use (A) in component bodies, (B) inside `onClick` / `useEffect` callbacks
to avoid stale closures. Both styles co-exist in this codebase.

### Test boilerplate: `beforeEach` + `cleanup`

**Source:** `OccurrenceHistorySidebar.test.tsx:52-58`, `LslTimelineStrip.test.tsx:106-115`
**Apply to:** Every new vitest spec.
```typescript
beforeEach(() => {
  useViewerStore.setState({ /* baseline */ })
  cleanup()  // RTL — required because Phase 56 sidebars are conditionally rendered
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})
```

---

## Available Libraries (relevant to Phase 56)

`package.json:` (verified):

| Library | Version | Status for Phase 56 |
|---|---|---|
| `d3` | `^7.9.0` | Available — but **NO `d3-scale` / `d3-axis` / `d3-time-format` USAGE EXISTS ANYWHERE** in `/integrations`. The planner should hand-roll the timestamp formatter rather than introduce a fresh d3 sub-module dependency style. `d3` is bundled monolithically, so `d3.scaleTime()` etc. ARE available without changing deps — but the in-tree convention is "math by hand." |
| `zustand` | `^5.0.14` | Used by `viewer-store.ts`. v5 exposes `getInitialState()` (used in `viewer-store.test.ts:107-108`). |
| `@tanstack/react-query` | (peer of LslTimelineStrip) | Already wired for session fetch. Phase 56 should NOT add new fetches. |
| `@playwright/test` | `^1.58.2` | Available for the new E2E spec. |
| `vitest` | `^1.6.0` | Test runner. |

**No new deps required.** `Intl.DateTimeFormat` (browser-native) is fine for
the timestamp scale; the existing `fmtLocalTs` helper at line 124-132 of
LslTimelineStrip.tsx already uses hand-rolled `pad()` formatting, so
sticking to that style is preferred for consistency.

---

## Project Constraints to Respect

From `CLAUDE.md` (project rules — verified at `/Users/Q284340/Agentic/coding/CLAUDE.md`):

1. **TypeScript strict** — `npm run tsc --noEmit` must pass. No `any` types
   on the new store fields; use exact unions for `selectionSource`
   (`'graph' | 'timeline' | 'history' | null`).
2. **`gsd-browser` for visual verification** — NOT inline `chromium.launch()`
   scripts. The constraint `prefer-gsd-browser` fires on hand-rolled
   Playwright `node /tmp/foo.mjs` scripts. For Phase 56, use **structured
   E2E spec under `tests/e2e/unified-viewer/`** (not gsd-browser, not
   inline) — that's the project's official channel and matches the entity-detail.spec.ts pattern.
3. **`no-console-log` constraint** — applies to all `.ts(x)` edits. Use
   `Logger.info(Logger.Categories.PANELS, ...)` etc.
4. **`documentation-style` skill** — only triggers for PlantUML / Mermaid /
   markdown documentation artifacts. Phase 56 doesn't ship docs.
5. **Submodule rebuild — N/A.** `integrations/unified-viewer/` is NOT a
   submodule; it's an in-tree Vite app. `npm run build` runs locally and
   Vite dev server picks up file changes hot. No Docker rebuild step.
6. **Project skills directory** — `.claude/skills/` does NOT exist in this
   repo (verified: only `.claude/commands/` and `.claude/rules/` are
   present). The "Available Skills" section of CLAUDE.md lists the
   commands; the planner can read them if needed but none target store /
   d3 patterns directly.

---

## No Analog Found

| File / Need | Reason |
|---|---|
| d3-axis / scaleTime style timestamp scale | NO usage anywhere in `/integrations`. **Hand-roll** using `pctOfWindow` + `Intl.DateTimeFormat` (or hand-rolled `pad()` like `LslTimelineStrip.tsx:128-132`). |
| Existing E2E test for cross-pane sync | None exists. `tests/e2e/unified-viewer/entity-detail.spec.ts` is the closest analog (sigma-emit pattern + getByTestId assertions). |
| `data-history-id` test-id selector usage | The selector is referenced in `HistorySidebar.tsx:106` but the attribute is NEVER set in render. Phase 56 must add it. |

---

## Metadata

**Analog search scope:**
- `integrations/unified-viewer/src/` (full tree)
- `integrations/system-health-dashboard/src/store/slices/` (Redux Toolkit slice analog for store layout)
- `integrations/memory-visualizer/src/` (origin of D3GraphCanvas port)
- `tests/e2e/unified-viewer/` (Playwright E2E sibling specs)
- `/Users/Q284340/Agentic/coding/playwright.config.ts` (root config)

**Files read (no re-reads):**
1. `.planning/phases/56-unified-viewer-bidirectional-selection-timeline-scale/56-CONTEXT.md`
2. `.planning/ROADMAP.md` (lines 960-994)
3. `.planning/STATE.md` (grep-targeted)
4. `integrations/unified-viewer/src/store/viewer-store.ts` (1-389, full)
5. `integrations/unified-viewer/src/store/viewer-store.test.ts` (1-358, full)
6. `integrations/unified-viewer/src/graph/D3GraphCanvas.tsx` (1-644, full)
7. `integrations/unified-viewer/src/panels/coding/LslTimelineStrip.tsx` (1-466, full)
8. `integrations/unified-viewer/src/panels/coding/LslTimelineStrip.test.tsx` (1-298, full)
9. `integrations/unified-viewer/src/panels/HistorySidebar.tsx` (1-166, full)
10. `integrations/unified-viewer/src/panels/OccurrenceHistorySidebar.tsx` (1-117, full)
11. `integrations/unified-viewer/src/panels/OccurrenceHistorySidebar.test.tsx` (1-140, full)
12. `integrations/unified-viewer/src/panels/SidePanel.tsx` (1-147, full)
13. `integrations/unified-viewer/src/App.tsx` (1-27, full)
14. `integrations/unified-viewer/src/routes/UnifiedViewer.tsx` (1-411, full)
15. `integrations/unified-viewer/src/hooks/useKeyboardShortcuts.ts` (1-292, full)
16. `integrations/unified-viewer/src/test-setup.ts` (1-108, full)
17. `tests/e2e/unified-viewer/entity-detail.spec.ts` (1-80, targeted)
18. `integrations/system-health-dashboard/src/store/slices/healthStatusSlice.ts` (28-89, targeted)
19. `integrations/unified-viewer/src/lib/logging/config/loggingConfig.ts` (targeted)

**Pattern extraction date:** 2026-06-13

## PATTERN MAPPING COMPLETE

**Most interesting analog:** The Phase 56 work is dominated by a single
in-tree precedent — **the LslTimelineStrip→graph filter cascade at
`LslTimelineStrip.tsx:287-330` + the matching reverse-lookup at lines
161-175**. That code already implements the "click tick → write atomic
multi-field setState → other panes react via subscription" pattern that
all three Phase 56 bidirectional flows need. The planner can use it as
the template verbatim: write all related fields in one `setState({...})`,
tag the source with `selectionSource`, let subscribers cascade. The
selection-tick highlight (`isSelectedBucket` predicate at lines 422-435)
is the matching consumer pattern for "graph→timeline" — already wired.
Phase 56 is mostly **add the symmetric pattern for HistorySidebar +
OccurrenceHistorySidebar + the missing `data-history-id` attribute**, then
**add a hand-rolled timestamp scale row above the existing tick layer**.

---

## Locked design contracts (after state-flow audit `b29bdb34c`)

The 2026-06-13 state-flow audit (`b29bdb34c` —
`.planning/phases/56-unified-viewer-bidirectional-selection-timeline-scale/56-STATE-FLOW.md`)
diagnosed that the first three rounds of Plan 56-04 patches chased
symptoms (visual surfaces) rather than the underlying state-model
violations. The locks below freeze the audit-prescribed contracts so
future plans don't re-litigate them. Each lock cites the audit section
the operator approved on 2026-06-13.

### 1. Tick-ring predicate (audit §6.5 verbatim)

> **The tick ring SHOWS on bucket X iff:**
> `selectedBucketKey === ${X.id}|${X.startAt}` OR
> `(selectedTs !== null && selectedTs >= X.startMs && selectedTs < X.endMs)`
>
> where `selectedBucketKey` is derived from store as
> `${selectedSessionId}|${selectedSessionStartAt}`.

**Implementation:** `LslTimelineStrip.tsx` render block, no local state.
The store carries the composite (sessionId, startAt) pair via the
`selectedSessionStartAt` field added in Commit 1 of this round. Any
local `useState` that shadows a selection-related store field is a
violation of the audit's V1 finding (§2.5).

### 2. Graph-side selection contract (audit §6.6 verbatim)

> **The graph node ring + ancestry trace SHOWS on node X iff:**
> `selectedNodeId === X.id`
>
> The ancestry trace prefers the store's `pathToSelected` field; the
> inline `computeAncestryPath` is the FALLBACK when the store path is
> empty (mount-time first paint before any writer attaches a trace).

**Implementation:** `D3GraphCanvas.tsx`'s `applySelectionStyling` calls
`deriveAncestryFromStorePath(selectedNodeId, pathToSelected,
visibleRelations)` when `pathToSelected.size > 0`, else falls back to
`computeAncestryPath(selectedNodeId, visibleRelations)`. The sigma path
(`graph-builder.ts:461,487`) was already store-driven; D3 now agrees.

### 3. Viewport stability contract (audit §6.7 verbatim)

> **The graph viewport DOES NOT animate / re-fit / re-layout on
> non-graph selection.**
>
> Mechanism: the D3GraphCanvas main render effect dep list MUST be
> `[visibleEntities, visibleRelations, theme, isLoading]` ONLY —
> never `selectedNodeId`, `pathToSelected`, `selectedSessionId`, or
> `selectedSessionStartAt`. `visibleEntities` itself MUST NOT
> invalidate on tick clicks — `lslFilterEntityIds` writes use the
> deep-equal guard in `setLslFilterEntityIds` so identical-content
> writes preserve the existing Set reference.

**Implementation:** `D3GraphCanvas.tsx:706-707` dep list + `viewer-store.ts`
`setLslFilterEntityIds` action (+ `setSelection` when it carries
`lslFilterEntityIds`). Both use the shared `sameSetMembership` helper.
Source-grep gates G9 + G13 in `D3GraphCanvas.test.ts` lock the dep list.

### 4. 0-obs tick policy (audit §5.4 option B)

> **Sessions whose `observationCount === 0` render greyed-out
> (`opacity-40 pointer-events-none cursor-default`), carry
> `aria-disabled="true"`, and are NOT selectable.** The click handler
> in `onTickClick` early-exits before any store write, because
> synthetic React events bypass CSS `pointer-events-none`.

The tick STILL renders so the operator sees "I had a session at X
o'clock" — this is the diagnostic-value half of the audit's option B.
Selection is the other half: a bucket with no observations cannot be
a meaningful selection target.

This supersedes the prior round's Test 23 + Test 25 contracts, which
asserted "tick always rings on its own click, even when the entity
cascade can't fire" — that policy is exactly the multi-tick leak Issue
2 surfaced. Both tests have been updated to assert the inverted contract.

### 5. Single-source-of-truth rule for selection (audit §6.3 + §7 R4)

> **NO local React state may shadow a selection-related store field.
> All cross-pane selection writes route through `setSelection` /
> `clearSelection` (or the matching LSL filter actions). Acceptance
> grep: zero `useViewerStore.setState({...})` call sites in any
> consumer component that participates in selection (LslTimelineStrip,
> D3GraphCanvas, HistorySidebar, OccurrenceHistorySidebar, SidePanel,
> graph/events.ts).**

**Implementation status (after Commit 3 of this round):**
- `LslTimelineStrip.tsx`: 0 inline `setState({...})` call sites ✓
- `D3GraphCanvas.tsx`: 1 inline `setState({...})` site remains (node
  onClick, line ~493) — out of audit-prescribed scope this round;
  refactor to `setSelection({...})` action call deferred to a future
  follow-up so the AC #2 / G1-G5 source-grep gates stay green.
- `HistorySidebar.tsx`, `OccurrenceHistorySidebar.tsx`, `SidePanel.tsx`,
  `graph/events.ts`: still have inline `setState({...})` sites —
  audit §8 out-of-scope notes, deferred.

Future plans extending this rule should bring those remaining sites
into the action regime and add the matching acceptance greps.

---

These contracts are intended to be DURABLE — any future plan that
relaxes them must justify the relaxation in its own SUMMARY against
the audit's specific finding. The audit itself (`56-STATE-FLOW.md`)
is the canonical reference for the diagnoses that produced these
contracts.
