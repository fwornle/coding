// PATTERN SOURCE: 45-PATTERNS.md § viewer-store.ts (the canonical excerpt) +
//                  55-PATTERNS.md § viewer-store.ts (EXTEND) for the Phase 55
//                  VOKB feature-parity slice additions.
//
// SHAPE REFERENCE (NOT a port): integrations/system-health-dashboard/src/store/slices/healthStatusSlice.ts:28-89
// SEMANTICS: 45-RESEARCH.md Pattern 1 — system-keyed remount as the cross-system reset boundary
//
// The Zustand store is module-scoped, but the entire React subtree under
// `<UnifiedViewer key={system}/>` unmounts on system switch (per
// 45-RESEARCH.md Pattern 1). Therefore `reset()` here is the IN-SYSTEM
// clear-button affordance only — it clears selection + search + selected
// classes, but intentionally does NOT touch `visibleLevels` or `theme`
// because those are filter-defaults / UI prefs that should persist across
// a single in-system reset action. Cross-system reset IS the remount —
// no manual `reset()` is called at the route boundary.
//
// PHASE 55 EXTENSION (Plan 55-04):
//   The store now exposes the slices VOKB's Redux store exposes (translated
//   to Zustand idiom) plus coding-specific slices for the ETM live tail,
//   hierarchy navigator and LSL session multi-select features. Action
//   names mirror VOKB's `_work/.../viewer/src/store/slices/filtersSlice.ts`
//   for source-portability. Empty-array semantic (`selectedLayers === []`
//   = "all visible") is a VOKB invariant preserved per UI-SPEC §10.
//
//   `selectedOntologyClasses: string[]` is the NEW canonical field that
//   replaces the Phase 45 `selectedClasses: Set<string>` field in VOKB-shape
//   terms (arrays serialize cleanly to URL, Sets do not — 55-PATTERNS.md).
//   For BC across wave boundaries the legacy `selectedClasses` Set + its
//   actions (`toggleClass`, `setSelectedClasses`) remain in place until
//   Plan 55-08 retires them when OntologyFilter replaces FilterRail's
//   ClassList. See 55-04-SUMMARY.md for the Rule 3 deviation rationale.
//
//   Logger discipline: ZERO raw console.* per feedback_logger_class.md.

import { create } from 'zustand'
import type { Observation } from '@/api/schemas'

export type Level = 0 | 1 | 2 | 3
export type ThemePref = 'light' | 'dark'
export type ViewerMode = 'kg' | 'triage'

// ---------- Phase 56 — cross-pane selection sync ----------
//
// 'graph' | 'timeline' | 'history' tags WHO drove the current selection so
// consumers can avoid feedback loops (e.g. timeline doesn't re-center on
// its own click). `null` = no selection / selection cleared.
export type SelectionSource = 'graph' | 'timeline' | 'history' | null

// Inline shape per 55-PATTERNS.md TrendingPanel section / okbClient.ts:68-78.
// A shared type module can pull this out in 55-06 if the StatsBar / trends
// endpoint introduces a wider surface; for now keep co-located with the
// only consumer (the store) to avoid premature API coupling.
export interface TrendingPattern {
  nodeId: string
  entity: {
    id: string
    name: string
    entityType: string
    description?: string
  }
  trendScore: number
  trends: {
    last7Days: number
    last30Days: number
    last90Days: number
  }
}

// Hard cap on the ring buffer per UI-SPEC §13.3. Burst coalescing (>10/sec
// debounced to 250ms batches) happens in the EtmTailSheet consumer (55-12),
// not in the store; this keeps the store simple and deterministic.
export const ETM_OBSERVATION_RING_BUFFER_MAX = 100

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

  // ---------- Phase 56 — cross-pane selection sync ----------
  // Shared selection slice consumed by D3GraphCanvas, LslTimelineStrip and
  // HistorySidebar / OccurrenceHistorySidebar. `selectionSource` lets
  // consumers avoid feedback loops on their own clicks; `highlightedRowKey`
  // is the history-sidebar row to scroll/highlight (often === selectedNodeId
  // but may differ for aggregate selections); `selectedSessionId` +
  // `selectedSessionStartAt` together identify the LSL session-tick bucket
  // (composite key — a single session id is sliced into many tranches that
  // share `id` but differ in `startAt`). ALL of these are written atomically
  // via `setSelection({...})` (or via `useViewerStore.setState({...})` from
  // in-tree consumers) so subscribers see a coherent snapshot — never a
  // half-written state.
  //
  // 2026-06-13 (state-flow audit `b29bdb34c5d54c09962c2724c1311825da412d8b`
  // §6.2 — option A): `selectedSessionStartAt` is the additive companion to
  // `selectedSessionId`. The tick-ring predicate in LslTimelineStrip now
  // derives the selected-bucket key from the composite `${id}|${startAt}` so
  // a click on one tranche of `sess-X` no longer rings every other tranche
  // of the same session id. The two fields are ALWAYS written + cleared
  // together — never one without the other (audit §7 R2).
  selectionSource: SelectionSource
  highlightedRowKey: string | null
  selectedSessionId: string | null
  selectedSessionStartAt: string | null

  // 2026-06-11: VKB-style filter rail additions.
  //   - learningSource: 'batch' (manual/UKB) | 'online' (auto/ETM) | 'combined' (both)
  //   - selectedTeams: empty Set = "all visible"; populated = exact filter
  // Drives computeNodeState: nodes whose metadata.source / metadata.team
  // don't match get filter-hidden.
  learningSource: 'batch' | 'online' | 'combined'
  selectedTeams: ReadonlySet<string>

  // Filters
  searchQuery: string
  visibleLevels: Set<Level>
  /**
   * Phase 45 legacy class-selection Set. Retained as a BC shim until Plan
   * 55-08 (OntologyFilter) retires the flat ClassList. New code MUST use
   * `selectedOntologyClasses` (URL-serializable, VOKB-shape parity).
   */
  selectedClasses: Set<string>

  // UI
  theme: ThemePref
  filterRailCollapsed: boolean
  // 2026-06-11: which graph renderer drives the central canvas. `d3`
  // ports VKB's original force-directed SVG view verbatim — chosen
  // automatically for the coding/VKB tab. `sigma` keeps the WebGL
  // viewer for OKB / Knowledge-Graph tabs.
  renderer: 'd3' | 'sigma'

  // Phase 45 actions
  setSelectedNode: (id: string | null) => void
  setSelectedEdge: (id: string | null) => void
  setSearch: (q: string) => void
  toggleLevel: (level: Level) => void
  toggleClass: (className: string) => void
  setVisibleLevels: (levels: Set<Level>) => void
  setSelectedClasses: (classes: Set<string>) => void
  setTheme: (t: ThemePref) => void
  setFilterRailCollapsed: (collapsed: boolean) => void
  reset: () => void

  // ---------- Phase 56 — cross-pane selection sync actions ----------
  // setSelection: atomic multi-field write. Only keys passed in `args` are
  // overwritten; unspecified keys are preserved. `source` is required so
  // every selection carries its origin. When `nodeId` is supplied and no
  // explicit `pathToSelected` is passed, `pathToSelected` is reset to an
  // empty Set (the graph recomputes ancestry on the next render).
  // clearSelection: cross-pane variant of `clearLslSessionFilter()`. Nulls
  // the entire selection slice AND the LSL filter slice so Esc + bg-click
  // leave the user in a fully cleared state — see CONTEXT.md "Esc +
  // click-background clears in all three panes".
  setSelection: (args: {
    nodeId?: string | null
    sessionId?: string | null
    // 2026-06-13 (audit §6.2 — option A): pass the SESSION-bucket startAt
    // alongside `sessionId` so the strip's tick-ring predicate can identify
    // the SPECIFIC tranche. Atomically set/cleared together with sessionId.
    sessionStartAt?: string | null
    highlightedRowKey?: string | null
    source: SelectionSource
    pathToSelected?: ReadonlySet<string>
    // 2026-06-13 (audit §6.3 + §7 R4): LSL filter slice fields are part of
    // the same atomic snapshot when a timeline tick is the writer — the
    // alternative is letting the strip fall back to direct `setState`
    // which is exactly the source-of-truth violation the audit calls out.
    // These are optional so non-timeline writers (graph, history) can omit
    // them and the action preserves the existing values.
    lslSessionFilter?: string[]
    lslFilterEntityIds?: ReadonlySet<string> | null
  }) => void
  clearSelection: () => void

  // ---------- Phase 55 — VOKB filtersSlice parity ----------
  selectedLayers: string[] // empty = "all visible" (UI-SPEC §10)
  selectedDomains: string[]
  selectedOntologyClasses: string[] // NEW canonical, replaces selectedClasses
  showEdges: boolean
  showClusters: boolean
  showRelationLabels: boolean
  showMergedOnly: boolean
  hideDocNodes: boolean

  toggleLayer: (layer: string) => void
  toggleDomain: (domain: string) => void
  toggleOntologyClass: (cls: string) => void
  setSelectedOntologyClasses: (classes: string[]) => void
  toggleShowEdges: () => void
  toggleShowClusters: () => void
  toggleShowRelationLabels: () => void
  toggleShowMergedOnly: () => void
  toggleHideDocNodes: () => void

  // ---------- Phase 55 — mode slice ----------
  mode: ViewerMode
  setMode: (mode: ViewerMode) => void

  // ---------- Phase 55 — trends slice (cached) ----------
  trendingPatterns: TrendingPattern[]
  setTrendingPatterns: (patterns: TrendingPattern[]) => void

  // ---------- Phase 55 — coding-only ETM tail slice ----------
  /** Ring buffer, newest first. Hard-capped at ETM_OBSERVATION_RING_BUFFER_MAX. */
  etmObservations: Observation[]
  etmStreamConnected: boolean
  etmSheetOpen: boolean
  pushObservation: (observation: Observation) => void
  setEtmStreamConnected: (connected: boolean) => void
  setEtmSheetOpen: (open: boolean) => void

  // ---------- Phase 55 — coding-only hierarchy / LSL slices ----------
  hierarchySubtreeFilter: string | null
  lslSessionFilter: string[]
  // 2026-06-12: the entity-id set the LSL session filter resolves to.
  // Mirrors `lslSessionFilter` semantically (which is just IDs) so the
  // D3 graph predicate can intersect entities against it cheaply.
  // null = "no filter" (every visible entity passes); empty set = "this
  // session has zero clickable entities — show nothing". The strip is
  // the producer; the graph + side panel are consumers.
  lslFilterEntityIds: ReadonlySet<string> | null
  setHierarchySubtreeFilter: (rootId: string | null) => void
  setLslSessionFilter: (ids: string[]) => void
  addLslSessionFilter: (id: string) => void
  clearLslSessionFilter: () => void
  setLslFilterEntityIds: (ids: ReadonlySet<string> | null) => void
}

// 2026-06-13 (audit §4.4 + §7 R3): shared deep-equal helper for the LSL
// filter slice. Two `ReadonlySet<string>` (or null) are considered equal
// when one of:
//   - both are null
//   - both are non-null Sets with identical membership (size + every key)
// This is the exact predicate that decides whether `setLslFilterEntityIds`
// (and `setSelection({ lslFilterEntityIds })`) writes a fresh reference or
// preserves the existing one. Reference stability is what stops the D3
// graph's `visibleEntities` useMemo from invalidating on identical-content
// LSL filter writes — Issue 1 root cause per audit §4.3.
function sameSetMembership(
  a: ReadonlySet<string> | null,
  b: ReadonlySet<string> | null,
): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  if (a.size !== b.size) return false
  for (const v of a) {
    if (!b.has(v)) return false
  }
  return true
}

function readPersistedThemeForStore(): ThemePref {
  // Plan 04 round 3: respect the OS-level color scheme on every fresh
  // page load. Hard reload no longer reads localStorage — instead it
  // probes `prefers-color-scheme: dark` and falls back to light if the
  // media query is unavailable (jsdom / SSR). NavBar still writes
  // localStorage on toggle for in-session consistency across remounts,
  // but the read path uses the OS hint so the app always starts in
  // sync with the user's system theme.
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light'
  }
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export const useViewerStore = create<ViewerState>((set) => ({
  // ---------- Phase 45 baseline ----------
  selectedNodeId: null,
  selectedEdgeId: null,
  pathToSelected: new Set<string>(),
  // ---------- Phase 56 — cross-pane selection sync (initial) ----------
  selectionSource: null,
  highlightedRowKey: null,
  selectedSessionId: null,
  // 2026-06-13 (audit §6.2 — option A): paired with selectedSessionId.
  selectedSessionStartAt: null,
  searchQuery: '',
  visibleLevels: new Set<Level>([0, 1, 2, 3]),
  selectedClasses: new Set<string>(),
  // VKB-style filters (2026-06-11). Default Combined + all teams visible.
  learningSource: 'combined',
  selectedTeams: new Set<string>(),
  theme: readPersistedThemeForStore(),
  // Default to the D3 renderer — that's the VKB-parity engine. The
  // UnifiedViewer route can override to 'sigma' for systems that
  // intentionally want the WebGL viewer (OKB / Knowledge-Graph).
  renderer: 'd3' as const,
  filterRailCollapsed: false,

  setSelectedNode: (id) => set({ selectedNodeId: id }),
  setSelectedEdge: (id) => set({ selectedEdgeId: id }),

  // ---------- Phase 56 — cross-pane selection sync setters ----------
  // Atomic multi-field write. The argument shape lets callers update only
  // the fields they care about — the merge below preserves any key that
  // wasn't passed. `source` is required so every selection carries its
  // origin; `pathToSelected` defaults to an empty Set when nodeId changes
  // (the graph recomputes ancestry on next render) but is preserved if the
  // caller didn't move the node (e.g. timeline-only writes).
  setSelection: ({
    nodeId,
    sessionId,
    sessionStartAt,
    highlightedRowKey,
    source,
    pathToSelected,
    lslSessionFilter,
    lslFilterEntityIds,
  }) =>
    set((s) => {
      const nextNodeId = nodeId !== undefined ? nodeId : s.selectedNodeId
      const nextSessionId = sessionId !== undefined ? sessionId : s.selectedSessionId
      // 2026-06-13 (audit §6.2 + §7 R2): session id and startAt are SIBLING
      // fields. When the caller passes `sessionId` we look at `sessionStartAt`
      // too. If the caller passed sessionStartAt explicitly, use it; otherwise
      // — when `sessionId` is in args at all — reset startAt to null so we
      // never end up with a "session selected" snapshot where startAt is
      // stale from an earlier tranche. If the caller didn't touch sessionId,
      // preserve startAt as-is.
      let nextSessionStartAt: string | null = s.selectedSessionStartAt
      if (sessionStartAt !== undefined) {
        nextSessionStartAt = sessionStartAt
      } else if (sessionId !== undefined) {
        nextSessionStartAt = null
      }
      const nextHighlightedRowKey =
        highlightedRowKey !== undefined ? highlightedRowKey : s.highlightedRowKey
      // pathToSelected: explicit > reset-on-nodeId-change > preserve.
      let nextPath: ReadonlySet<string> = s.pathToSelected
      if (pathToSelected !== undefined) {
        nextPath = pathToSelected
      } else if (nodeId !== undefined) {
        nextPath = new Set<string>()
      }
      // 2026-06-13 (audit §6.3 + §7 R4): LSL filter slice writes piggy-
      // back on the same atomic snapshot when the caller passes them.
      // Reference-stability guard is shared with `setLslFilterEntityIds`
      // (see Commit 4 deep-equal helper).
      const nextLslSessionFilter =
        lslSessionFilter !== undefined ? lslSessionFilter.slice() : s.lslSessionFilter
      const nextLslFilterEntityIds =
        lslFilterEntityIds !== undefined
          ? sameSetMembership(s.lslFilterEntityIds, lslFilterEntityIds)
            ? s.lslFilterEntityIds
            : lslFilterEntityIds
          : s.lslFilterEntityIds
      return {
        selectedNodeId: nextNodeId,
        selectedSessionId: nextSessionId,
        selectedSessionStartAt: nextSessionStartAt,
        highlightedRowKey: nextHighlightedRowKey,
        selectionSource: source,
        pathToSelected: nextPath,
        lslSessionFilter: nextLslSessionFilter,
        lslFilterEntityIds: nextLslFilterEntityIds,
      }
    }),

  // Single-shot `set({...})` so subscribers see the cleared snapshot once.
  // Mirrors `clearLslSessionFilter` (line below) but extends to the entire
  // selection slice + LSL filter — matches CONTEXT.md "Esc + click-background
  // clears in all three panes".
  clearSelection: () =>
    set({
      selectedNodeId: null,
      selectedEdgeId: null,
      selectionSource: null,
      highlightedRowKey: null,
      selectedSessionId: null,
      // 2026-06-13 (audit §6.2 + §7 R2): paired clear with selectedSessionId.
      selectedSessionStartAt: null,
      pathToSelected: new Set<string>(),
      lslSessionFilter: [],
      lslFilterEntityIds: null,
    }),

  setSearch: (q) => set({ searchQuery: q }),

  toggleLevel: (level) =>
    set((s) => {
      const next = new Set(s.visibleLevels)
      if (next.has(level)) next.delete(level)
      else next.add(level)
      return { visibleLevels: next }
    }),

  toggleClass: (className) =>
    set((s) => {
      const next = new Set(s.selectedClasses)
      if (next.has(className)) next.delete(className)
      else next.add(className)
      return { selectedClasses: next }
    }),

  setVisibleLevels: (levels) => set({ visibleLevels: new Set(levels) }),
  setSelectedClasses: (classes) => set({ selectedClasses: new Set(classes) }),

  setTheme: (t) => set({ theme: t }),
  setFilterRailCollapsed: (collapsed) => set({ filterRailCollapsed: collapsed }),

  // IN-SYSTEM clear button. Does NOT reset visibleLevels (filter defaults
  // should persist) or theme (UI pref). Cross-system reset is the remount.
  // Phase 56: also clears the three cross-pane selection fields so reset()
  // round-trips through the full selection slice — see 56-PATTERNS.md
  // "extend reset() too".
  reset: () =>
    set({
      selectedNodeId: null,
      selectedEdgeId: null,
      searchQuery: '',
      selectedClasses: new Set<string>(),
      selectionSource: null,
      highlightedRowKey: null,
      selectedSessionId: null,
      // 2026-06-13 (audit §6.2 + §7 R2): paired clear with selectedSessionId.
      selectedSessionStartAt: null,
    }),

  // ---------- Phase 55 — VOKB filtersSlice parity ----------
  // Initial state: empty arrays everywhere. Per VOKB invariant (UI-SPEC §10),
  // an empty selection means "all visible" — the consumer interprets emptiness,
  // not the store. Do NOT pre-seed with "all known values".
  selectedLayers: [],
  selectedDomains: [],
  selectedOntologyClasses: [],
  showEdges: false,
  showClusters: false,
  showRelationLabels: false,
  showMergedOnly: false,
  hideDocNodes: false,

  toggleLayer: (layer) =>
    set((s) => {
      // 2026-06-12: two related UX bugs the empty-array sentinel kept
      // re-creating.
      // (A) Initial state is `selectedLayers = []` meaning "all visible".
      //     Clicking Evidence used to push `['evidence']` ⇒ Pattern looked
      //     unchecked. Fix: materialise the full set first, then toggle.
      // (B) After (A), the user unchecks Evidence then unchecks Pattern.
      //     The naive splice leaves `[]` which collapses BACK to "all
      //     visible" so both checkboxes light up again. Fix: when a
      //     removal would empty the array, emit `['__none__']` — the
      //     reading code (D3 filter predicate, sigma graph-builder)
      //     treats this as "none visible" instead of all.
      // (C) Clicking anything from the `['__none__']` state turns ONLY
      //     that one on (the user just chose it explicitly).
      const ALL_LAYERS = ['evidence', 'pattern']
      if (s.selectedLayers.includes('__none__')) {
        // Coming out of "none visible" — selecting this one only.
        return { selectedLayers: [layer] }
      }
      const base = s.selectedLayers.length === 0 ? ALL_LAYERS.slice() : s.selectedLayers
      const idx = base.indexOf(layer)
      if (idx >= 0) {
        const next = base.slice()
        next.splice(idx, 1)
        return { selectedLayers: next.length === 0 ? ['__none__'] : next }
      }
      return { selectedLayers: [...base, layer] }
    }),

  toggleDomain: (domain) =>
    set((s) => {
      const idx = s.selectedDomains.indexOf(domain)
      if (idx >= 0) {
        const next = s.selectedDomains.slice()
        next.splice(idx, 1)
        return { selectedDomains: next }
      }
      return { selectedDomains: [...s.selectedDomains, domain] }
    }),

  toggleOntologyClass: (cls) =>
    set((s) => {
      const idx = s.selectedOntologyClasses.indexOf(cls)
      if (idx >= 0) {
        const next = s.selectedOntologyClasses.slice()
        next.splice(idx, 1)
        return { selectedOntologyClasses: next }
      }
      return { selectedOntologyClasses: [...s.selectedOntologyClasses, cls] }
    }),

  setSelectedOntologyClasses: (classes) =>
    set((s) => {
      // 2026-06-12: bridge to the legacy `selectedClasses: Set<string>`
      // field that the graph-builder + D3GraphCanvas still read from.
      // Without this sync, OntologyFilter checkboxes update the new
      // `selectedOntologyClasses` array but never reach the graph
      // predicate. The `__none__` sentinel collapses to an empty Set
      // here so the readers' "empty = none visible if learningSource
      // != combined; else all visible" semantics still hold via the
      // explicit value below.
      const arr = classes.slice()
      const isNoneSentinel = arr.length === 1 && arr[0] === '__none__'
      // If the new array is "all visible" (length 0), keep the legacy
      // Set populated with everything currently in it so the graph
      // doesn't suddenly hide all nodes. Otherwise the new array IS
      // the source of truth.
      const nextLegacy: Set<string> = isNoneSentinel
        ? new Set<string>()
        : arr.length === 0
          ? s.selectedClasses
          : new Set(arr)
      return {
        selectedOntologyClasses: arr,
        selectedClasses: nextLegacy,
      }
    }),

  toggleShowEdges: () => set((s) => ({ showEdges: !s.showEdges })),
  toggleShowClusters: () => set((s) => ({ showClusters: !s.showClusters })),
  toggleShowRelationLabels: () => set((s) => ({ showRelationLabels: !s.showRelationLabels })),
  toggleShowMergedOnly: () => set((s) => ({ showMergedOnly: !s.showMergedOnly })),
  toggleHideDocNodes: () => set((s) => ({ hideDocNodes: !s.hideDocNodes })),

  // ---------- Phase 55 — mode slice ----------
  mode: 'kg',
  setMode: (mode) => set({ mode }),

  // ---------- Phase 55 — trends slice (cached) ----------
  trendingPatterns: [],
  setTrendingPatterns: (patterns) => set({ trendingPatterns: patterns.slice() }),

  // ---------- Phase 55 — ETM live tail ring buffer ----------
  etmObservations: [],
  etmStreamConnected: false,
  etmSheetOpen: false,

  // Ring-buffer push per UI-SPEC §13.3 + 55-PATTERNS.md: newest first,
  // hard cap at ETM_OBSERVATION_RING_BUFFER_MAX (100). Burst coalescing
  // (>10/sec → 250ms batches) lives in the EtmTailSheet consumer (55-12),
  // not here — the store stays deterministic and side-effect-free.
  pushObservation: (observation) =>
    set((s) => ({
      etmObservations: [observation, ...s.etmObservations].slice(
        0,
        ETM_OBSERVATION_RING_BUFFER_MAX,
      ),
    })),
  setEtmStreamConnected: (connected) => set({ etmStreamConnected: connected }),
  setEtmSheetOpen: (open) => set({ etmSheetOpen: open }),

  // ---------- Phase 55 — coding-only hierarchy / LSL ----------
  hierarchySubtreeFilter: null,
  lslSessionFilter: [],
  lslFilterEntityIds: null,

  setHierarchySubtreeFilter: (rootId) => set({ hierarchySubtreeFilter: rootId }),
  setLslSessionFilter: (ids) => set({ lslSessionFilter: ids.slice() }),

  // Cmd/Ctrl+click multi-select pattern: idempotent add (no duplicate
  // entries). The consumer decides modifier-key semantics; the store
  // just guarantees uniqueness.
  addLslSessionFilter: (id) =>
    set((s) => {
      if (s.lslSessionFilter.includes(id)) return {}
      return { lslSessionFilter: [...s.lslSessionFilter, id] }
    }),

  clearLslSessionFilter: () => set({ lslSessionFilter: [], lslFilterEntityIds: null }),
  // 2026-06-13 (audit §4.4 + §7 R3): deep-equal guard. The audit traced
  // Issue 1's "zoom feel" to this writer producing a fresh `Set` reference
  // on every tick click → invalidating D3GraphCanvas's `visibleEntities`
  // useMemo (`lslFilterEntityIds` is in its dep list) → restarting the
  // force simulation. Reference stability when content is unchanged is
  // exactly what stops that cascade. `sameSetMembership` is the shared
  // predicate also used by `setSelection({ lslFilterEntityIds })` for the
  // same guarantee.
  setLslFilterEntityIds: (ids) =>
    set((s) => {
      if (sameSetMembership(s.lslFilterEntityIds, ids)) {
        return {} // no write — preserve the existing reference
      }
      return { lslFilterEntityIds: ids }
    }),
}))
