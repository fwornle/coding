// Vitest setup — register jest-dom matchers (toBeInTheDocument, etc.).
// Imported by vitest.config.ts setupFiles.
import '@testing-library/jest-dom/vitest'

// jsdom 25 in this project ships a stubbed `localStorage` object that has
// NO Storage methods (setItem/getItem/removeItem all undefined). The
// Logger's _load/_save calls silently swallow these errors and fall back
// to defaults, which is fine in production but breaks persistence tests
// (Plan 45-03 Task 0 — Logger). Install a minimal in-memory polyfill if
// `setItem` is missing so unit tests can verify round-trip behaviour.
if (typeof window !== 'undefined' && typeof window.localStorage?.setItem !== 'function') {
  const memoryStore = new Map<string, string>()
  const polyfill: Storage = {
    get length(): number {
      return memoryStore.size
    },
    clear(): void {
      memoryStore.clear()
    },
    getItem(key: string): string | null {
      return memoryStore.has(key) ? (memoryStore.get(key) as string) : null
    },
    key(index: number): string | null {
      return Array.from(memoryStore.keys())[index] ?? null
    },
    removeItem(key: string): void {
      memoryStore.delete(key)
    },
    setItem(key: string, value: string): void {
      memoryStore.set(key, String(value))
    },
  }
  Object.defineProperty(window, 'localStorage', {
    value: polyfill,
    writable: true,
    configurable: true,
  })
  // Also expose on globalThis so bare `localStorage` references work
  ;(globalThis as { localStorage?: Storage }).localStorage = polyfill
}

// Stub WebGL2RenderingContext at module-load time. The `sigma` package
// references `WebGL2RenderingContext.prototype` at top-level (see
// node_modules/sigma/dist/index-*.cjs.dev.js around line 145) — jsdom does
// not provide WebGL, so importing sigma in any test would crash with
// "WebGL2RenderingContext is not defined". We provide a minimal stub so
// modules load; tests that need to render a real sigma canvas (none in
// unit tests — verified manually via gsd-browser) would mock sigma exports.
if (typeof (globalThis as { WebGL2RenderingContext?: unknown }).WebGL2RenderingContext === 'undefined') {
  class WebGL2RenderingContextStub {}
  ;(globalThis as { WebGL2RenderingContext: unknown }).WebGL2RenderingContext =
    WebGL2RenderingContextStub
}
if (typeof (globalThis as { WebGLRenderingContext?: unknown }).WebGLRenderingContext === 'undefined') {
  class WebGLRenderingContextStub {}
  ;(globalThis as { WebGLRenderingContext: unknown }).WebGLRenderingContext =
    WebGLRenderingContextStub
}

// Stub ResizeObserver — Radix UI's Tooltip/Popover layers reference it at
// portal-mount time. jsdom does not provide ResizeObserver, so importing
// any Radix overlay component into a test crashes with
// `ReferenceError: ResizeObserver is not defined` during portal teardown.
// Provide a minimal no-op stub so unit tests can mount Radix overlays.
if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  ;(globalThis as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub
  if (typeof window !== 'undefined') {
    ;(window as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub
  }
}
