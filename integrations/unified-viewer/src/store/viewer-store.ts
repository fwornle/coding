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
  setHierarchySubtreeFilter: (rootId: string | null) => void
  setLslSessionFilter: (ids: string[]) => void
  addLslSessionFilter: (id: string) => void
  clearLslSessionFilter: () => void
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
  searchQuery: '',
  visibleLevels: new Set<Level>([0, 1, 2, 3]),
  selectedClasses: new Set<string>(),
  theme: readPersistedThemeForStore(),
  filterRailCollapsed: false,

  setSelectedNode: (id) => set({ selectedNodeId: id }),
  setSelectedEdge: (id) => set({ selectedEdgeId: id }),
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
  reset: () =>
    set({
      selectedNodeId: null,
      selectedEdgeId: null,
      searchQuery: '',
      selectedClasses: new Set<string>(),
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
      const idx = s.selectedLayers.indexOf(layer)
      if (idx >= 0) {
        const next = s.selectedLayers.slice()
        next.splice(idx, 1)
        return { selectedLayers: next }
      }
      return { selectedLayers: [...s.selectedLayers, layer] }
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

  setSelectedOntologyClasses: (classes) => set({ selectedOntologyClasses: classes.slice() }),

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

  clearLslSessionFilter: () => set({ lslSessionFilter: [] }),
}))
