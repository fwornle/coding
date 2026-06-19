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

// ---------- Phase 56 / 56.1 — cross-pane selection sync ----------
//
// 'graph' | 'timeline' | 'history' tags WHO drove the current selection so
// consumers can avoid feedback loops (e.g. timeline doesn't re-center on
// its own click). `null` = no selection / selection cleared.
//
// Phase 56.1 evolution: the source tag continues to disambiguate sidebar
// mode (timeline source + non-empty selectedBucketKeys → bucket-card list;
// graph source + selectedNodeIds.size > 1 → bucket-card list of buckets
// touching focal; otherwise EntityDetailPanel for focalNodeId). The set
// of valid sources is unchanged.
export type SelectionSource = 'graph' | 'timeline' | 'history' | null

// 2026-06-14 (Plan 06 gap-closure — Decision 1 selection-history stack):
// snapshot of the selection slice + LSL slice + path slice captured BEFORE
// a drill (Layer 1 → Layer 2 transition). One-slot only — the operator
// explicitly scoped this to a single back-step, NOT a full history stack
// (browser-back-button-style ambiguity avoided). `popSelection()` restores
// this exact shape, clearing `selectionHistory` to null in the same write.
//
// Field coverage MUST mirror `clearSelection()` (viewer-store.ts:496-508)
// EXACTLY — anything `clearSelection()` clears must be restorable by
// `popSelection()`, or the pop produces a partial restore that's worse
// than full clear. The 9 fields below match clearSelection()'s payload
// 1:1 except for `selectedEdgeId` which is preserved separately (edge
// selection is orthogonal to node-selection drill).
export interface SelectionSnapshot {
  selectionSource: SelectionSource
  highlightedRowKey: string | null
  selectedNodeIds: ReadonlySet<string>
  focalNodeId: string | null
  selectedBucketKeys: ReadonlySet<string>
  focalBucketKey: string | null
  pathToSelected: ReadonlySet<string>
  lslSessionFilter: string[]
  lslFilterEntityIds: ReadonlySet<string> | null
}

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
  selectedEdgeId: string | null

  // 2026-06-11: ancestry path of `focalNodeId` (System → … → selected).
  // When non-empty, reducer dims every node NOT in this set so the path
  // through the hierarchy is visually traced from the clicked node back
  // to the root — VKB reference behaviour. Empty = no path highlight.
  // Phase 56.1: the trace is drawn from `focalNodeId` only (NOT every
  // halo node in `selectedNodeIds`) — per CONTEXT.md D-4 + discretion #2.
  pathToSelected: ReadonlySet<string>

  // ---------- Phase 56.1 — many-to-many cross-pane selection sync ----------
  //
  // Promotes Phase 56's one-to-one selection (`selectedNodeId: string|null`,
  // `selectedSessionId|StartAt: string|null`) to many-to-many Sets with
  // derived focal singletons. The four selection-slice fields:
  //
  //   selectedNodeIds: ReadonlySet<string>      // multi-set of graph nodes
  //   focalNodeId: string | null                // derived (insertion-order)
  //   selectedBucketKeys: ReadonlySet<string>   // multi-set of `${sid}|${startAt}`
  //   focalBucketKey: string | null             // derived (insertion-order)
  //
  // Focal derivation is "last id added" (insertion-order semantics). The
  // focal MUST always be a member of its owning Set when the Set is
  // non-empty; null when the Set is empty. Consumers NEVER write focal
  // fields directly — they pass `focal: {nodeId?, bucketKey?}` to
  // `setSelection` (or omit it to use insertion-order derivation).
  //
  // AUDIT-LOCKED INVARIANTS preserved across the refactor:
  //   - Invariant #2/#3 (56-PATTERNS Locked Contract #3 — viewport
  //     stability): `sameSetMembership` deep-equal guard wraps the writes
  //     to `selectedNodeIds`, `selectedBucketKeys` AND `lslFilterEntityIds`
  //     so identical-content writes preserve the existing Set reference and
  //     downstream `useMemo` deps (D3GraphCanvas `visibleEntities`) do not
  //     invalidate. This is the load-bearing piece that stops the
  //     "graph re-layouts on every tick click" cascade (audit §4.4).
  //   - Invariant #4 (`clearSelection()` field coverage): clears the full
  //     selection slice + LSL slice + pathToSelected as a single snapshot.
  //   - Invariant #5 (WR-04 — `reset()` field coverage): mirrors
  //     `clearSelection()` field coverage; closes the WR-04 gap that left
  //     `lslSessionFilter`/`lslFilterEntityIds`/`pathToSelected` untouched.
  //
  // `selectionSource` (graph|timeline|history|null) lets consumers avoid
  // feedback loops and disambiguates sidebar mode in multi-mode.
  // `highlightedRowKey` is the history-sidebar row to scroll/highlight
  // (often === focalNodeId but may differ for aggregate selections).
  //
  // ALL writes route through `setSelection({...})` (or the imperative
  // `setSelectedNode`/`clearSelection` siblings) so subscribers see a
  // coherent snapshot — never a half-written state.
  selectionSource: SelectionSource
  highlightedRowKey: string | null
  selectedNodeIds: ReadonlySet<string>
  focalNodeId: string | null
  selectedBucketKeys: ReadonlySet<string>
  focalBucketKey: string | null
  // 2026-06-14 (Plan 06 gap-closure — Decision 1 selection-history stack):
  // null when no drill has happened. Populated by `setSelection({...,
  // pushHistory: true})` immediately BEFORE the new selection takes effect.
  // `popSelection()` restores this snapshot and clears the slot to null.
  // `clearSelection()` clears this slot too (full clear = no history).
  // The Layer 1 ↔ Layer 2 stack is intentionally one-deep — see
  // SelectionSnapshot's docstring above for rationale.
  selectionHistory: SelectionSnapshot | null

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

  // ---------- Phase 56.1 — many-to-many cross-pane selection sync actions ----------
  // setSelection: atomic multi-field write — accepts multi-set inputs (Set
  // or string[]) for both axes (graph nodes + timeline buckets) plus an
  // optional explicit `focal` override. Focal derivation defaults to
  // "last id added" (insertion order) — see deriveFocal() helper below.
  // Only keys passed in `args` are overwritten; unspecified keys are
  // preserved. `source` is required so every selection carries its origin.
  // When `nodeIds` is supplied and no explicit `pathToSelected` is passed,
  // `pathToSelected` is reset to an empty Set (the graph recomputes
  // ancestry from the focal on the next render).
  //
  // The `sameSetMembership` deep-equal guard is applied to `selectedNodeIds`,
  // `selectedBucketKeys` AND `lslFilterEntityIds` — identical-content writes
  // preserve the existing Set references (audit-locked invariant — viewport
  // stability per 56-PATTERNS Locked Contract #3 + 56.1-PATTERNS §1
  // invariants #2/#3).
  //
  // clearSelection: cross-pane variant of `clearLslSessionFilter()`. Empties
  // the entire selection slice AND the LSL filter slice AND pathToSelected
  // so Esc + bg-click leave the user in a fully cleared state — see
  // CONTEXT.md "Esc + click-background clears in all three panes".
  setSelection: (args: {
    nodeIds?: ReadonlySet<string> | string[]
    bucketKeys?: ReadonlySet<string> | string[]
    // Explicit focal override — wins over insertion-order derivation when
    // the caller knows precisely which member should be focal (e.g. graph
    // click on a halo node should refocus to that node, not the "last
    // added" one). Pass `null` to explicitly null the focal even when the
    // owning Set is non-empty (rare; insertion-order derivation is the
    // default). Per-axis: pass `nodeId` and/or `bucketKey`.
    focal?: { nodeId?: string | null; bucketKey?: string | null }
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
    // 2026-06-14 (Plan 06 gap-closure — Decision 1 selection-history stack):
    // when `true`, the current selection state is captured into
    // `selectionHistory` BEFORE this write applies. The drill writers
    // (BucketCardList.onCardClick, D3GraphCanvas halo-node click) pass
    // `pushHistory: true` so Esc/X can pop back one layer to the pre-drill
    // multi-set. All other writers (Layer 0 → Layer 1 entry, programmatic
    // navigation) pass false / omit — Layer 0 is the natural floor and
    // `selectionHistory` stays null between drills.
    pushHistory?: boolean
  }) => void
  clearSelection: () => void
  // 2026-06-14 (Plan 06 gap-closure — Decision 1): one-step-back action.
  // If `selectionHistory !== null`, restores the captured snapshot AND
  // clears the history slot (only one layer back, no deeper history per
  // operator decision). Otherwise calls `clearSelection()` so Esc-from-
  // Layer-1 (no drill yet) still resets to Layer 0. Returns true when a
  // pop happened (caller uses this to decide whether to preventDefault).
  popSelection: () => boolean

  // 2026-06-14 (WR-04 fix — 56.1-REVIEW): atomic additive variant of
  // setSelection. Performs the UNION of the supplied ids with the current
  // selection state INSIDE the `set(s => {...})` callback, so the union is
  // computed against the freshest state — closing the read-modify-write
  // race the Cmd-click additive path in LslTimelineStrip.onTickClick had.
  //
  // Behavior: every supplied Set is UNIONED with its corresponding store
  // field (selectedNodeIds, selectedBucketKeys, lslFilterEntityIds,
  // lslSessionFilter[]). Reference-stability guard fires when the union
  // result has identical membership to the current value (no-op writes
  // preserve refs). Focal derivation follows the same rules as setSelection
  // (explicit focal wins, else CR-01-fixed deriveFocal).
  addToSelection: (args: {
    nodeIds?: ReadonlySet<string> | string[]
    bucketKeys?: ReadonlySet<string> | string[]
    focal?: { nodeId?: string | null; bucketKey?: string | null }
    highlightedRowKey?: string | null
    source: SelectionSource
    pathToSelected?: ReadonlySet<string>
    lslSessionFilter?: string[]
    lslFilterEntityIds?: ReadonlySet<string>
    pushHistory?: boolean
  }) => void

  // ---------- Phase 55 — VOKB filtersSlice parity ----------
  selectedLayers: string[] // empty = "all visible" (UI-SPEC §10)
  selectedDomains: string[]
  selectedOntologyClasses: string[] // NEW canonical, replaces selectedClasses
  showEdges: boolean
  showClusters: boolean
  showRelationLabels: boolean
  showMergedOnly: boolean
  hideDocNodes: boolean
  // Phase 60 Plan 03 (G3) — D-09..D-11: when true, the visibility predicate
  // skips the Observation/Digest hard-exclusion branch so operators can debug
  // those types. Default false (architecture-bleed shield ON). Non-persistent
  // (D-11): no localStorage / persist middleware — resets every page load.
  showDebugEntityTypes: boolean

  // Plan 60-08 Gap E — bidirectional hover. The id of the node/row the operator
  // is currently hovering (graph → sidebar OR sidebar → graph). Its own slice,
  // strictly additive to the Phase 56.1 D-1 multi-selection contract
  // (selectedNodeIds / focalNodeId / selectedBucketKeys are NOT touched).
  // Non-persistent (mirrors showDebugEntityTypes / D-11): resets on page load.
  hoveredNodeId: string | null
  setHoveredNodeId: (id: string | null) => void

  toggleLayer: (layer: string) => void
  toggleDomain: (domain: string) => void
  toggleOntologyClass: (cls: string) => void
  setSelectedOntologyClasses: (classes: string[]) => void
  toggleShowEdges: () => void
  toggleShowClusters: () => void
  toggleShowRelationLabels: () => void
  toggleShowMergedOnly: () => void
  toggleHideDocNodes: () => void
  // Phase 60 Plan 03 (G3) — D-09..D-11: flips showDebugEntityTypes.
  toggleShowDebugEntityTypes: () => void

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

// Phase 56.1: normalise Set | string[] inputs to ReadonlySet<string>.
// `undefined` passes through (signals "preserve current value"); a Set is
// returned identity (no copy); an array becomes a fresh Set.
function asSet(
  input: ReadonlySet<string> | string[] | undefined,
): ReadonlySet<string> | undefined {
  if (input === undefined) return undefined
  if (input instanceof Set) return input
  return new Set<string>(input)
}

// Phase 56.1: derive the focal element from a (prev, next, explicit) triple
// per CONTEXT.md D-1 + 56.1-PATTERNS §1 deriveFocal rule.
//   - explicit !== undefined wins (caller override, including explicit null)
//   - next.size === 0 → null
//   - else last "added" id (in next, not in prev); if no new additions,
//     fall back to last iteration-order element of next (Set preserves
//     insertion order in ES2015+, so this is deterministic).
function deriveFocal(
  prev: ReadonlySet<string>,
  next: ReadonlySet<string>,
  explicit: string | null | undefined,
): string | null {
  if (explicit !== undefined) return explicit
  if (next.size === 0) return null
  // Walk next in iteration order; track the last element AND the last
  // newly-added element in a single pass.
  let last: string | null = null
  let lastAdded: string | null = null
  for (const id of next) {
    last = id
    if (!prev.has(id)) lastAdded = id
  }
  return lastAdded ?? last
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

export const useViewerStore = create<ViewerState>((set, get) => ({
  // ---------- Phase 45 baseline ----------
  selectedEdgeId: null,
  pathToSelected: new Set<string>(),
  // ---------- Phase 56.1 — many-to-many cross-pane selection sync (initial) ----------
  selectionSource: null,
  highlightedRowKey: null,
  selectedNodeIds: new Set<string>(),
  focalNodeId: null,
  selectedBucketKeys: new Set<string>(),
  focalBucketKey: null,
  // 2026-06-14 (Plan 06 gap-closure — Decision 1): one-slot history for
  // drill-back. Null at fresh mount; only the drill writers push.
  selectionHistory: null,
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

  // Phase 56.1: imperative one-node setter. Routes through the multi-set
  // semantics — `id=null` empties the Set; `id=string` produces a singleton
  // Set + focal = id. Callers (e.g. useKeyboardShortcuts) keep the same
  // string|null API surface; the multi-set machinery is internal.
  setSelectedNode: (id) =>
    set(() => ({
      selectedNodeIds: id === null ? new Set<string>() : new Set<string>([id]),
      focalNodeId: id,
    })),
  setSelectedEdge: (id) => set({ selectedEdgeId: id }),

  // ---------- Phase 56.1 — many-to-many cross-pane selection sync setters ----------
  // Atomic multi-field write. The argument shape lets callers update only
  // the fields they care about — the merge below preserves any key that
  // wasn't passed. `source` is required so every selection carries its
  // origin; `pathToSelected` defaults to an empty Set when `nodeIds` changes
  // (the graph recomputes ancestry on next render) but is preserved if the
  // caller didn't move the node (e.g. timeline-only writes).
  //
  // Reference stability (audit-locked invariant — 56-PATTERNS Locked
  // Contract #3 + 56.1-PATTERNS §1 invariants #2/#3): identical-content
  // writes to `selectedNodeIds`, `selectedBucketKeys`, and `lslFilterEntityIds`
  // preserve the existing Set reference via `sameSetMembership`. This stops
  // the "graph re-layouts on every tick click" cascade from regressing
  // through the multi-set evolution.
  setSelection: ({
    nodeIds,
    bucketKeys,
    focal,
    highlightedRowKey,
    source,
    pathToSelected,
    lslSessionFilter,
    lslFilterEntityIds,
    pushHistory,
  }) =>
    set((s) => {
      const nodeIdsArg = asSet(nodeIds)
      const bucketKeysArg = asSet(bucketKeys)

      // selectedNodeIds: explicit > preserve. Reference-stability guard
      // (audit invariant #2 — viewport stability per 56-PATTERNS Locked
      // Contract #3) preserves the existing Set reference on identical
      // content.
      const nextSelectedNodeIds: ReadonlySet<string> =
        nodeIdsArg !== undefined
          ? sameSetMembership(s.selectedNodeIds, nodeIdsArg)
            ? s.selectedNodeIds
            : nodeIdsArg
          : s.selectedNodeIds

      // Focal derivation: explicit override (incl. null) > insertion-order
      // last-added > last iteration-order element. When neither nodeIds
      // nor explicit focal was passed, preserve the current focal.
      //
      // 2026-06-14 (CR-01 fix — 56.1-REVIEW): if `nextSelectedNodeIds`
      // reference-equals `s.selectedNodeIds` (deep-equal write via the
      // `sameSetMembership` guard above), `deriveFocal(prev, prev, undefined)`
      // would find zero new additions and fall back to the last iteration-
      // order element — silently clobbering the user-meaningful focal.
      // Preserve the current focal in that case unless the caller passed
      // an explicit override. Explicit override (including explicit null)
      // still wins.
      const nextFocalNodeId: string | null =
        focal?.nodeId !== undefined
          ? focal.nodeId
          : nodeIdsArg !== undefined && nextSelectedNodeIds !== s.selectedNodeIds
            ? deriveFocal(s.selectedNodeIds, nextSelectedNodeIds, undefined)
            : s.focalNodeId

      const nextSelectedBucketKeys: ReadonlySet<string> =
        bucketKeysArg !== undefined
          ? sameSetMembership(s.selectedBucketKeys, bucketKeysArg)
            ? s.selectedBucketKeys
            : bucketKeysArg
          : s.selectedBucketKeys

      // 2026-06-14 (CR-01 fix — 56.1-REVIEW): symmetric guard for bucket
      // focal — see nodeFocal note above.
      const nextFocalBucketKey: string | null =
        focal?.bucketKey !== undefined
          ? focal.bucketKey
          : bucketKeysArg !== undefined && nextSelectedBucketKeys !== s.selectedBucketKeys
            ? deriveFocal(s.selectedBucketKeys, nextSelectedBucketKeys, undefined)
            : s.focalBucketKey

      const nextHighlightedRowKey =
        highlightedRowKey !== undefined ? highlightedRowKey : s.highlightedRowKey

      // pathToSelected: explicit > reset-on-nodeIds-change > preserve.
      let nextPath: ReadonlySet<string> = s.pathToSelected
      if (pathToSelected !== undefined) {
        nextPath = pathToSelected
      } else if (nodeIds !== undefined) {
        nextPath = new Set<string>()
      }

      // 2026-06-13 (audit §6.3 + §7 R4 — UNCHANGED from Phase 56): LSL
      // filter slice writes piggy-back on the same atomic snapshot when
      // the caller passes them. Reference-stability guard shared with
      // `setLslFilterEntityIds` (audit invariant #3 — DO NOT alter).
      const nextLslSessionFilter =
        lslSessionFilter !== undefined ? lslSessionFilter.slice() : s.lslSessionFilter
      const nextLslFilterEntityIds =
        lslFilterEntityIds !== undefined
          ? sameSetMembership(s.lslFilterEntityIds, lslFilterEntityIds)
            ? s.lslFilterEntityIds
            : lslFilterEntityIds
          : s.lslFilterEntityIds

      // 2026-06-14 (Plan 06 gap-closure — Decision 1 selection-history stack):
      // capture the PRE-write snapshot before the new selection takes
      // effect. Only the drill writers (BucketCardList.onCardClick,
      // D3GraphCanvas halo-node click) set `pushHistory: true`; all other
      // callers leave history alone (Layer 0 → Layer 1 entry, programmatic
      // re-selection from search, etc.). The snapshot mirrors
      // SelectionSnapshot field-for-field — DO NOT drift this without
      // updating the type + popSelection's restore site below.
      //
      // Only push if there's actually a meaningful selection to remember:
      // pushing an empty snapshot (Layer 0 state) into history would let
      // Esc-from-Layer-2 land back at the same Layer 0 the user could have
      // reached by `clearSelection()` — a useless one-step-back. Guard on
      // `selectedNodeIds.size > 0 || selectedBucketKeys.size > 0`.
      const shouldPush =
        pushHistory === true
        && (s.selectedNodeIds.size > 0 || s.selectedBucketKeys.size > 0)
      const nextSelectionHistory: SelectionSnapshot | null = shouldPush
        ? {
            selectionSource: s.selectionSource,
            highlightedRowKey: s.highlightedRowKey,
            selectedNodeIds: s.selectedNodeIds,
            focalNodeId: s.focalNodeId,
            selectedBucketKeys: s.selectedBucketKeys,
            focalBucketKey: s.focalBucketKey,
            pathToSelected: s.pathToSelected,
            lslSessionFilter: s.lslSessionFilter.slice(),
            lslFilterEntityIds: s.lslFilterEntityIds,
          }
        : s.selectionHistory

      return {
        selectedNodeIds: nextSelectedNodeIds,
        focalNodeId: nextFocalNodeId,
        selectedBucketKeys: nextSelectedBucketKeys,
        focalBucketKey: nextFocalBucketKey,
        highlightedRowKey: nextHighlightedRowKey,
        selectionSource: source,
        pathToSelected: nextPath,
        lslSessionFilter: nextLslSessionFilter,
        lslFilterEntityIds: nextLslFilterEntityIds,
        selectionHistory: nextSelectionHistory,
      }
    }),

  // Single-shot `set({...})` so subscribers see the cleared snapshot once.
  // Mirrors `clearLslSessionFilter` (line below) but extends to the entire
  // selection slice + LSL filter — matches CONTEXT.md "Esc + click-background
  // clears in all three panes".
  //
  // Phase 56.1 (audit invariant #4): clears all 4 new selection fields
  // (selectedNodeIds, focalNodeId, selectedBucketKeys, focalBucketKey),
  // selectedEdgeId, the source + row tag, pathToSelected, and the LSL
  // filter slice. Fresh `new Set()` instances (NOT null) for the Set
  // fields so consumers can always call `.has()` / `.size` without
  // null-check noise.
  clearSelection: () =>
    set({
      selectedEdgeId: null,
      selectionSource: null,
      highlightedRowKey: null,
      selectedNodeIds: new Set<string>(),
      focalNodeId: null,
      selectedBucketKeys: new Set<string>(),
      focalBucketKey: null,
      pathToSelected: new Set<string>(),
      lslSessionFilter: [],
      lslFilterEntityIds: null,
      // 2026-06-14 (Plan 06 gap-closure — Decision 1): full clear discards
      // history too. Background-click on SVG / explicit reset semantics:
      // "done entirely" — no Layer 1 to come back to.
      selectionHistory: null,
    }),

  // 2026-06-14 (Plan 06 gap-closure — Decision 1 selection-history stack):
  // one-step-back pop. If `selectionHistory !== null`, restore the captured
  // snapshot AND clear the history slot (single-deep stack — no chain).
  // Otherwise fall through to `clearSelection()` so Esc-from-Layer-1 (no
  // drill yet) still reaches Layer 0. Returns true when a pop happened so
  // the caller (Esc handler, X button) can decide whether to preventDefault.
  //
  // Layer model recap:
  //   Layer 0: no selection. selectionHistory always null here.
  //   Layer 1: multi-set (tick click halo OR graph node click). On entry,
  //            selectionHistory captured = null (Layer 0 has no meaningful
  //            selection to remember — see shouldPush guard in setSelection).
  //   Layer 2: drill (card click OR halo-node click). On entry, the drill
  //            writer passed pushHistory: true so selectionHistory holds
  //            the pre-drill Layer 1 state.
  // popSelection from L2 → restores L1; from L1 → falls through to clear → L0.
  popSelection: () => {
    const snap = get().selectionHistory
    if (snap === null) {
      // 2026-06-14 (WR-05 fix — 56.1-REVIEW): popSelection now ONLY pops.
      // It no longer side-effects a clearSelection() call when there's no
      // snapshot — that conflated two responsibilities (read the stack +
      // mutate state) and made callers reason about a single boolean
      // return that meant different things depending on the path. Callers
      // (Esc handler in useKeyboardShortcuts, X-button in SidePanel) are
      // updated to gate on the return value and call clearSelection()
      // themselves when popSelection returns false.
      return false
    }
    set({
      selectionSource: snap.selectionSource,
      highlightedRowKey: snap.highlightedRowKey,
      selectedNodeIds: snap.selectedNodeIds,
      focalNodeId: snap.focalNodeId,
      selectedBucketKeys: snap.selectedBucketKeys,
      focalBucketKey: snap.focalBucketKey,
      pathToSelected: snap.pathToSelected,
      lslSessionFilter: snap.lslSessionFilter,
      lslFilterEntityIds: snap.lslFilterEntityIds,
      // Stack is one-deep: clear history after pop.
      selectionHistory: null,
    })
    return true
  },

  // 2026-06-14 (WR-04 fix — 56.1-REVIEW): atomic additive write.
  //
  // Performs the UNION inside the `set(s => {...})` callback so the
  // union is computed against the freshest store state. Closes the
  // read-modify-write race that the Cmd-click additive path in
  // LslTimelineStrip.onTickClick had: previously it captured prevState
  // via `useViewerStore.getState()`, computed the union outside the
  // store action, then wrote with `setSelection(...)` — between the
  // get and the set, a concurrent third-pane mutation could silently
  // be clobbered.
  //
  // Semantics mirror setSelection, but instead of REPLACING each axis
  // the new ids are UNIONED with the existing axis. lslSessionFilter
  // (an array, not a Set) is deduped via Set conversion. Reference
  // stability is preserved when the union produces an identical-membership
  // result (sameSetMembership guard), so the viewport-stability invariant
  // (PATTERNS-LOCK Contract #3 Part A) survives.
  addToSelection: ({
    nodeIds,
    bucketKeys,
    focal,
    highlightedRowKey,
    source,
    pathToSelected,
    lslSessionFilter,
    lslFilterEntityIds,
    pushHistory,
  }) =>
    set((s) => {
      const nodeIdsArg = asSet(nodeIds)
      const bucketKeysArg = asSet(bucketKeys)

      // Union the per-axis sets (if supplied) with the current state.
      // When no ids are supplied for an axis, preserve the current Set.
      const unionedNodeIds: ReadonlySet<string> =
        nodeIdsArg !== undefined
          ? (() => {
              const u = new Set<string>(s.selectedNodeIds)
              for (const id of nodeIdsArg) u.add(id)
              return u
            })()
          : s.selectedNodeIds
      const nextSelectedNodeIds: ReadonlySet<string> =
        nodeIdsArg !== undefined && sameSetMembership(s.selectedNodeIds, unionedNodeIds)
          ? s.selectedNodeIds
          : unionedNodeIds

      const nextFocalNodeId: string | null =
        focal?.nodeId !== undefined
          ? focal.nodeId
          : nodeIdsArg !== undefined && nextSelectedNodeIds !== s.selectedNodeIds
            ? deriveFocal(s.selectedNodeIds, nextSelectedNodeIds, undefined)
            : s.focalNodeId

      const unionedBucketKeys: ReadonlySet<string> =
        bucketKeysArg !== undefined
          ? (() => {
              const u = new Set<string>(s.selectedBucketKeys)
              for (const k of bucketKeysArg) u.add(k)
              return u
            })()
          : s.selectedBucketKeys
      const nextSelectedBucketKeys: ReadonlySet<string> =
        bucketKeysArg !== undefined && sameSetMembership(s.selectedBucketKeys, unionedBucketKeys)
          ? s.selectedBucketKeys
          : unionedBucketKeys

      const nextFocalBucketKey: string | null =
        focal?.bucketKey !== undefined
          ? focal.bucketKey
          : bucketKeysArg !== undefined && nextSelectedBucketKeys !== s.selectedBucketKeys
            ? deriveFocal(s.selectedBucketKeys, nextSelectedBucketKeys, undefined)
            : s.focalBucketKey

      const nextHighlightedRowKey =
        highlightedRowKey !== undefined ? highlightedRowKey : s.highlightedRowKey

      const nextPath: ReadonlySet<string> = pathToSelected !== undefined
        ? pathToSelected
        : s.pathToSelected

      const nextLslSessionFilter = lslSessionFilter !== undefined
        ? Array.from(new Set<string>([...s.lslSessionFilter, ...lslSessionFilter]))
        : s.lslSessionFilter

      const unionedLslFilterEntityIds: ReadonlySet<string> | null =
        lslFilterEntityIds !== undefined
          ? (() => {
              const u = new Set<string>(s.lslFilterEntityIds ?? [])
              for (const id of lslFilterEntityIds) u.add(id)
              return u
            })()
          : s.lslFilterEntityIds
      const nextLslFilterEntityIds: ReadonlySet<string> | null =
        lslFilterEntityIds !== undefined
          && sameSetMembership(s.lslFilterEntityIds, unionedLslFilterEntityIds as ReadonlySet<string> | null)
          ? s.lslFilterEntityIds
          : unionedLslFilterEntityIds

      const shouldPush =
        pushHistory === true
        && (s.selectedNodeIds.size > 0 || s.selectedBucketKeys.size > 0)
      const nextSelectionHistory: SelectionSnapshot | null = shouldPush
        ? {
            selectionSource: s.selectionSource,
            highlightedRowKey: s.highlightedRowKey,
            selectedNodeIds: s.selectedNodeIds,
            focalNodeId: s.focalNodeId,
            selectedBucketKeys: s.selectedBucketKeys,
            focalBucketKey: s.focalBucketKey,
            pathToSelected: s.pathToSelected,
            lslSessionFilter: s.lslSessionFilter.slice(),
            lslFilterEntityIds: s.lslFilterEntityIds,
          }
        : s.selectionHistory

      return {
        selectedNodeIds: nextSelectedNodeIds,
        focalNodeId: nextFocalNodeId,
        selectedBucketKeys: nextSelectedBucketKeys,
        focalBucketKey: nextFocalBucketKey,
        highlightedRowKey: nextHighlightedRowKey,
        selectionSource: source,
        pathToSelected: nextPath,
        lslSessionFilter: nextLslSessionFilter,
        lslFilterEntityIds: nextLslFilterEntityIds,
        selectionHistory: nextSelectionHistory,
      }
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
  //
  // Phase 56.1 (WR-04 closure / audit invariant #5 — 56.1-PATTERNS §1
  // invariants table): reset() now FULLY mirrors clearSelection()'s
  // selection-slice + LSL-slice + pathToSelected coverage. Phase 56's
  // reset() left `lslSessionFilter`, `lslFilterEntityIds`, and
  // `pathToSelected` untouched — that gap surfaced as WR-04 in the
  // Phase 56 review and is closed here. searchQuery + selectedClasses
  // are still cleared (in-system clear button affordance from Phase 45).
  reset: () =>
    set({
      selectedEdgeId: null,
      searchQuery: '',
      selectedClasses: new Set<string>(),
      selectionSource: null,
      highlightedRowKey: null,
      selectedNodeIds: new Set<string>(),
      focalNodeId: null,
      selectedBucketKeys: new Set<string>(),
      focalBucketKey: null,
      // WR-04 closure: these three were missing from the Phase 56 reset.
      lslSessionFilter: [],
      lslFilterEntityIds: null,
      pathToSelected: new Set<string>(),
      // 2026-06-14 (Plan 06 gap-closure — Decision 1): mirror clearSelection
      // field coverage. WR-04 invariant: reset() and clearSelection() always
      // touch the same selection-slice fields.
      selectionHistory: null,
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
  // Phase 60 Plan 03 (G3) — D-11: NOT persisted (no localStorage). Resets every
  // page load so operators must consciously re-enable Observation/Digest debug.
  showDebugEntityTypes: false,
  hoveredNodeId: null,

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

  // Plan 60-08 Gap E — hover slice setter. Writes ONLY hoveredNodeId; never
  // touches the multi-selection slice (Phase 56.1 D-1 invariant).
  setHoveredNodeId: (id) => set({ hoveredNodeId: id }),

  toggleShowEdges: () => set((s) => ({ showEdges: !s.showEdges })),
  toggleShowClusters: () => set((s) => ({ showClusters: !s.showClusters })),
  toggleShowRelationLabels: () => set((s) => ({ showRelationLabels: !s.showRelationLabels })),
  toggleShowMergedOnly: () => set((s) => ({ showMergedOnly: !s.showMergedOnly })),
  toggleHideDocNodes: () => set((s) => ({ hideDocNodes: !s.hideDocNodes })),
  // Phase 60 Plan 03 (G3) — D-09..D-11: toggle the showDebugEntityTypes flag.
  toggleShowDebugEntityTypes: () =>
    set((s) => ({ showDebugEntityTypes: !s.showDebugEntityTypes })),

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
