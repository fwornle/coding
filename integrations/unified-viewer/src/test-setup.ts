// Vitest setup — register jest-dom matchers (toBeInTheDocument, etc.).
// Imported by vitest.config.ts setupFiles.
import '@testing-library/jest-dom/vitest'

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
