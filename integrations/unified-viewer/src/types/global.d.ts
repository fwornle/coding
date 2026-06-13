// Phase 56 — Playwright E2E test hook.
//
// The unified-viewer publishes the Zustand store hook on `window.__viewerStore`
// during ViewerCore mount so Playwright specs can drive selection without
// going through coordinate-based canvas clicks (D3's hit-testing is
// unreliable inside headless chromium when ForceAtlas2 / d3-force is still
// settling). The publication happens in
// `src/routes/UnifiedViewer.tsx` and is torn down on unmount.
//
// Why dev-only: the publication surface is identical to the production
// viewer's mount path (same React subtree). In production builds there is
// no untrusted producer of `window.__viewerStore` beyond the page's own
// bundle, and the store carries no PII or secrets — only selection +
// filter state. STRIDE T-56-01 ("Spoofing") is accept-disposition per the
// Phase 56 plan threat model.
//
// Module-augment Window so callers can `window.__viewerStore?.getState()`
// without `(window as any)` casts and tsc --strict stays clean.

import type { useViewerStore } from '@/store/viewer-store'

declare global {
  interface Window {
    /**
     * Phase 56 E2E hook. Set on ViewerCore mount, deleted on unmount.
     * Playwright specs call `window.__viewerStore?.getState()` /
     * `setSelection({...})` / `clearSelection()` to drive the store
     * directly — same code path the in-tree click handlers use.
     */
    __viewerStore?: typeof useViewerStore
  }
}

export {}
