// PATTERN SOURCE: 45-PATTERNS.md § viewer-store.ts (the canonical excerpt)
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

import { create } from 'zustand'

export type Level = 0 | 1 | 2 | 3
export type ThemePref = 'light' | 'dark'

export interface ViewerState {
  // Selection
  selectedNodeId: string | null
  selectedEdgeId: string | null

  // Filters
  searchQuery: string
  visibleLevels: Set<Level>
  selectedClasses: Set<string>

  // UI
  theme: ThemePref
  filterRailCollapsed: boolean

  // Actions
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
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
  } catch {
    return 'light'
  }
}

export const useViewerStore = create<ViewerState>((set) => ({
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
}))
