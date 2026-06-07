---
phase: 45
slug: unified-web-viewer
phase_number: 45
mapped: 2026-06-07
files_classified: 28
analogs_found: 24
analogs_missing: 4
greenfield: true
---

# Phase 45 — Pattern Map

> Maps every greenfield file at `integrations/unified-viewer/` (D-45-01) to its closest in-repo analog.
> The planner copies the excerpts below verbatim into per-plan task actions. **Analog = REFERENCE, not fork** (D-45-01 lockup).
>
> Two structural notes that hold for the whole map:
>
> 1. The dashboard (`integrations/system-health-dashboard/`) is the **dominant analog tree** — shadcn + Vite + TS + React 18.3.1 + Router 7 + ESM aliases (`@/*`) — and Phase 45 inherits its preset verbatim per UI-SPEC.md Design System. Where the dashboard pattern fits, the planner copies it; where it doesn't (Zustand vs RTK, multi-base-URL routing, REST shape lock, Sigma renderer), the analog is partial and the gap is filled per RESEARCH.md.
> 2. The legacy viewers (`integrations/memory-visualizer/` = VKB, `_work/rapid-automations/.../viewer/` = VOKB) are explicit PORT sources only for two panels (MarkdownViewer, RcaOpsPanel). VKB is on disk; **VOKB is NOT in this workspace** (`_work/rapid-automations` is absent) — the planner must fetch VOKB's `RcaOperationsPanel.tsx` (562 lines per RESEARCH.md §Summary) from the rapid-automations repo at scaffold time; this map flags it as `analog: external (rapid-automations submodule)` rather than a local path.

---

## File Classification

| New File (greenfield at `integrations/unified-viewer/`) | Role | Data Flow | Closest Analog (in-repo) | Match Quality |
|---|---|---|---|---|
| `package.json` | config | n/a | `integrations/system-health-dashboard/package.json` | exact (version table) |
| `tsconfig.json` | config | n/a | `integrations/system-health-dashboard/tsconfig.json` | exact |
| `vite.config.ts` | config | n/a | `integrations/system-health-dashboard/vite.config.ts` | exact (port + define block to adapt) |
| `tailwind.config.ts` | config | n/a | `integrations/system-health-dashboard/tailwind.config.ts` | exact (verbatim copy) |
| `postcss.config.mjs` | config | n/a | `integrations/system-health-dashboard/postcss.config.mjs` | exact (verbatim copy) |
| `components.json` | config | n/a | `integrations/system-health-dashboard/components.json` | exact (verbatim copy — shadcn preset) |
| `vitest.config.ts` | config | n/a | NONE (dashboard has no vitest) | NO ANALOG — derive from vite.config.ts + vitest standard |
| `playwright.config.ts` (Phase-45 scope) | config | n/a | `tests/e2e/dashboard/playwright.config.ts` | exact (port + baseURL adaptation) |
| `index.html` | config | n/a | `integrations/system-health-dashboard/index.html` (referenced by vite.config content array) | exact |
| `.env.example` | config | n/a | none (NEW) | NO ANALOG — derive from D-45-02 env-var list |
| `src/main.tsx` | entry | request-response | `integrations/system-health-dashboard/src/main.tsx` | exact |
| `src/App.tsx` | route | request-response | `integrations/system-health-dashboard/src/App.tsx` | role-match (Router pattern; provider differs: Zustand not Redux) |
| `src/index.css` | config | n/a | `integrations/system-health-dashboard/src/index.css` | exact (CSS-variable block) |
| `src/lib/utils.ts` | utility | n/a | `integrations/system-health-dashboard/src/lib/utils.ts` | exact (`cn()` verbatim) |
| `src/components/ui/{button,card,badge,input,dialog,tooltip,scroll-area,separator,tabs,select,checkbox,collapsible,progress,accordion,alert}.tsx` (15 primitives) | component | n/a | `integrations/system-health-dashboard/src/components/ui/*.tsx` (14 present + alert via `npx shadcn add alert`) | exact (verbatim copy via `npx shadcn add`) |
| `src/config/system-endpoints.ts` | config | n/a | `integrations/system-health-dashboard/src/lib/config.ts` | role-match (single→multi base URL) |
| `src/config/theme.ts` | utility | n/a | dashboard has no extracted theme hook | NO ANALOG — derive from UI-SPEC + index.css class-toggle pattern |
| `src/api/ApiClient.ts` | service | request-response | `integrations/system-health-dashboard/src/store/middleware/apiMiddleware.ts` + `pages/digests.tsx` fetch patterns | role-match (no class wrapper exists; build new) |
| `src/api/OkmRcaClient.ts` | service | request-response + event-stream (SSE) | VOKB `RcaOperationsPanel.tsx` (external — see structural note 2) | external port |
| `src/api/schemas.ts` | model | n/a | `lib/km-core/src/adapters/observation-view.ts` (LegacyDigest, LegacyInsight) + `tests/integration/typed-views.test.js` (REQUIRED_*_KEYS) | exact (port interface declarations + mirror REQUIRED_*_KEYS as Zod schemas) |
| `src/api/shape-lock.test.ts` | test | n/a | `tests/integration/typed-views.test.js` | exact (mirror the assertion lists) |
| `src/store/viewer-store.ts` | store | CRUD (in-memory) | `integrations/system-health-dashboard/src/store/slices/healthStatusSlice.ts` | role-match (RTK→Zustand idiom shift; same shape-shape) |
| `src/routes/UnifiedViewer.tsx` | route | request-response | `integrations/system-health-dashboard/src/components/system-health-dashboard.tsx` | role-match (page-shell composition) |
| `src/routes/UnknownSystem.tsx` | route | n/a | none | NO ANALOG — derive from UI-SPEC §Routing |
| `src/graph/SigmaCanvas.tsx` | component | streaming (WebGL frame loop) | VKB `KnowledgeGraph/GraphVisualization.tsx` (D3 force) — reference only; planner builds NEW on `@react-sigma/core` | reference (Pattern 3 in RESEARCH.md is the canonical excerpt) |
| `src/graph/color-fallback.ts` | utility | n/a | UI-SPEC.md ships the FNV-1a formula verbatim (lines 122-137) | exact (port from UI-SPEC) |
| `src/graph/useGraphData.ts` | utility | request-response | dashboard has no `useQuery` analog; `react-query` is new | NO ANALOG — derive from RESEARCH.md Pattern 2 |
| `src/graph/events.ts` | utility | event-driven | `@react-sigma/core` `useRegisterEvents` hook — RESEARCH.md Example 1 | reference |
| `src/graph/node-renderer.ts` | utility | n/a | UI-SPEC §Color State color overlays table (lines 142-152) | exact (port from UI-SPEC) |
| `src/panels/EntityDetailPanel.tsx` | component | request-response | `integrations/system-health-dashboard/src/pages/digests.tsx` (DigestCard shape) | role-match (Card + Badge + ScrollArea layout) |
| `src/panels/MarkdownViewerPanel.tsx` | component | request-response | `integrations/memory-visualizer/src/components/MarkdownViewer.tsx` | exact (PORT — Mermaid hook STRIPPED per D-45-04) |
| `src/panels/RcaOpsPanel.tsx` | component | event-driven (SSE) | VOKB `RcaOperationsPanel.tsx` (external) | external port (Option A per RESEARCH.md §Summary) |
| `src/panels/FilterRail.tsx` | component | request-response | `integrations/memory-visualizer/src/components/Filters/SearchFilter.tsx` + `TypeFilters.tsx` | role-match (rebuild in shadcn primitives) |
| `src/panels/NavBar.tsx` | component | request-response | `integrations/system-health-dashboard/src/components/nav-bar.tsx` | exact (Link + useLocation pattern) |
| `src/lib-domain/markdown-text.tsx` | utility | n/a | `integrations/system-health-dashboard/src/components/markdown-text.tsx` | exact (135 lines, verbatim port — lightweight redaction-aware renderer for entity descriptions) |
| `src/lib-domain/states.tsx` | component | n/a | UI-SPEC §State Contract + `integrations/system-health-dashboard/src/pages/digests.tsx:304-308` (destructive banner) | role-match (port banner styles) |
| `src/components/IconButton.tsx` | component | n/a | UI-SPEC §Icon-only controls table (lines 209-220) + shadcn `<Button>` + `<Tooltip>` | derive from UI-SPEC |
| `tests/e2e/system-routing.spec.ts` | test | n/a | `tests/e2e/dashboard/workflow-graph-colors.spec.ts` | role-match (Playwright shape) |
| `tests/e2e/entity-detail.spec.ts` | test | n/a | same as above | role-match |
| `tests/e2e/expand-neighbors.spec.ts` | test | n/a | same as above | role-match |
| `tests/e2e/rca-ingestion.spec.ts` | test | n/a (SSE mock) | same as above + SSE mock pattern from VOKB external | partial |
| **Backend extension:** `lib/km-core/src/api/handlers/ontology.ts` MODIFY (NOT new file) | controller | request-response | the file itself, lines 50-69 | exact (extend existing handler) |

---

## Pattern Assignments

### `package.json` (config — version pin table)

**Analog:** `integrations/system-health-dashboard/package.json`

**Anti-auto-bump version pin table (CRITICAL — Pitfall 6 in RESEARCH.md). The planner MUST copy these EXACTLY into `integrations/unified-viewer/package.json`:**

```jsonc
// dependencies — verbatim from dashboard EXCEPT no @reduxjs/toolkit, no react-redux, no recharts, no cors/express/yaml (server-side dashboard deps)
{
  "react": "^18.3.1",
  "react-dom": "^18.3.1",
  "react-router-dom": "^7.14.0",
  "lucide-react": "^0.544.0",
  "class-variance-authority": "^0.7.1",
  "clsx": "^2.1.1",
  "tailwind-merge": "^3.3.1",
  "zod": "^4.3.6",
  // Radix primitives — same 11 verbatim from dashboard:
  "@radix-ui/react-accordion": "^1.2.12",
  "@radix-ui/react-collapsible": "^1.1.2",
  "@radix-ui/react-dialog": "^1.1.15",
  "@radix-ui/react-progress": "^1.1.7",
  "@radix-ui/react-scroll-area": "^1.2.10",
  "@radix-ui/react-select": "^2.2.6",
  "@radix-ui/react-separator": "^1.1.7",
  "@radix-ui/react-slot": "^1.2.3",
  "@radix-ui/react-switch": "^1.2.6",
  "@radix-ui/react-tabs": "^1.1.13",
  "@radix-ui/react-tooltip": "^1.2.8",
  // NEW for Phase 45 (RESEARCH.md verified versions):
  "@react-sigma/core": "^5.0.6",
  "sigma": "^3.0.3",
  "graphology": "^0.26.0",
  "zustand": "^5.0.14",
  "@tanstack/react-query": "^5.101.0",
  "react-markdown": "^10.1.0",
  "remark-gfm": "^4.0.1",
  "rehype-highlight": "^7.0.2",
  "highlight.js": "^11.11.1",
  "@tailwindcss/typography": "^0.5.19"
}
// devDependencies — verbatim from dashboard PLUS vitest:
{
  "@playwright/test": "^1.58.2",
  "@types/node": "^20",
  "@types/react": "^18.3.3",
  "@types/react-dom": "^18.3.0",
  "@vitejs/plugin-react": "^4.3.1",
  "autoprefixer": "^10.4.19",
  "postcss": "^8.4.38",
  "tailwindcss": "^3.4.4",
  "typescript": "^5.2.2",
  "vite": "^5.3.1",
  // NEW for Phase 45:
  "vitest": "^1.x"  // research §Test Infrastructure: matches Vite 5 major
}
```

**Why pinned (do NOT change):**

- `react@^18.3.1` (NOT 19.x) — UI-SPEC.md inherit-verbatim rule
- `vite@^5.3.1` (NOT 8.x) — UI-SPEC.md inherit-verbatim rule
- `tailwindcss@^3.4.4` (NOT 4.x) — RESEARCH.md Pitfall 4 (engine break)
- `lucide-react@^0.544.0` (NOT 1.17.0) — RESEARCH.md Pitfall 3 (icon renames)
- `react-router-dom@^7.14.0` — dashboard match (RESEARCH.md Table)

**Scripts pattern** (port from dashboard `package.json`):

```json
"scripts": {
  "dev": "vite",
  "build": "tsc --noEmit 2>/dev/null; vite build",
  "preview": "vite preview",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:e2e": "playwright test"
}
```

---

### `tsconfig.json` (config)

**Analog:** `integrations/system-health-dashboard/tsconfig.json` (lines 1-23, verbatim)

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "tests/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

Single change vs dashboard: extend `include` to also pick up `tests/**/*.ts`.

---

### `vite.config.ts` (config)

**Analog:** `integrations/system-health-dashboard/vite.config.ts` (lines 1-37)

**Port pattern** (alias + manualChunks structure verbatim; adjust chunks to drop redux/recharts):

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-icons': ['lucide-react'],
          'vendor-graph': ['sigma', 'graphology', '@react-sigma/core'],   // NEW
          'vendor-markdown': ['react-markdown', 'remark-gfm', 'rehype-highlight', 'highlight.js'],  // NEW
        },
      },
    },
  },
  server: {
    port: 5173,        // RESEARCH.md Wave-0 probe row 1 uses :5173 for the CORS check
    strictPort: true,
  },
})
```

---

### `tailwind.config.ts` + `postcss.config.mjs` + `components.json` + `src/index.css` (CSS variable block)

**Analog:** all four — verbatim from dashboard. No modifications.

- `tailwind.config.ts` — `integrations/system-health-dashboard/tailwind.config.ts` (lines 1-79, all CSS-variable color mappings preserved)
- `postcss.config.mjs` — `integrations/system-health-dashboard/postcss.config.mjs` (5 lines)
- `components.json` — `integrations/system-health-dashboard/components.json` (22 lines; preset `style="new-york", baseColor="neutral", iconLibrary="lucide", cssVariables=true`)
- `src/index.css` — copy the `:root` + `.dark` CSS-variable blocks from `integrations/system-health-dashboard/src/index.css` lines 46-91. Append viewer-specific tokens at bottom per UI-SPEC.

---

### `src/components/ui/*.tsx` (shadcn primitives — VERBATIM COPY)

**Analog:** `integrations/system-health-dashboard/src/components/ui/`

**The 15 primitives to copy verbatim** (14 already present in dashboard tree; `alert.tsx` is in dashboard list already verified by `ls`):

| Primitive | Dashboard file (exact path) |
|---|---|
| `button.tsx` | `integrations/system-health-dashboard/src/components/ui/button.tsx` |
| `card.tsx` | `integrations/system-health-dashboard/src/components/ui/card.tsx` |
| `badge.tsx` | `integrations/system-health-dashboard/src/components/ui/badge.tsx` |
| `input.tsx` | `integrations/system-health-dashboard/src/components/ui/input.tsx` |
| `dialog.tsx` | `integrations/system-health-dashboard/src/components/ui/dialog.tsx` |
| `tooltip.tsx` | `integrations/system-health-dashboard/src/components/ui/tooltip.tsx` |
| `scroll-area.tsx` | `integrations/system-health-dashboard/src/components/ui/scroll-area.tsx` |
| `separator.tsx` | `integrations/system-health-dashboard/src/components/ui/separator.tsx` |
| `tabs.tsx` | `integrations/system-health-dashboard/src/components/ui/tabs.tsx` |
| `select.tsx` | `integrations/system-health-dashboard/src/components/ui/select.tsx` |
| `checkbox.tsx` | `integrations/system-health-dashboard/src/components/ui/checkbox.tsx` |
| `collapsible.tsx` | `integrations/system-health-dashboard/src/components/ui/collapsible.tsx` |
| `progress.tsx` | `integrations/system-health-dashboard/src/components/ui/progress.tsx` |
| `accordion.tsx` | (NOT present in dashboard — run `npx shadcn add accordion` in the new package) |
| `alert.tsx` | `integrations/system-health-dashboard/src/components/ui/alert.tsx` |

**Anti-pattern to avoid:** Do NOT wrap these in viewer-themed variants per RESEARCH.md "Anti-Patterns to Avoid" — UI-SPEC mandates the dashboard preset verbatim.

**Reference excerpt (Button variants — shows cva pattern for any custom variants the panel work needs):**

```typescript
// integrations/system-health-dashboard/src/components/ui/button.tsx lines 7-35
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ...",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-white ...",
        outline: "border bg-background shadow-xs hover:bg-accent ...",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground ...",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: { default: "h-9 px-4 py-2 ...", sm: "h-8 ...", lg: "h-10 ...", icon: "size-9" },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
)
```

---

### `src/lib/utils.ts` (utility — `cn()` helper)

**Analog:** `integrations/system-health-dashboard/src/lib/utils.ts` (lines 1-7, verbatim)

```typescript
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

---

### `src/main.tsx` (entry)

**Analog:** `integrations/system-health-dashboard/src/main.tsx` (lines 1-10, near-verbatim)

**Port pattern** (add QueryClient + StrictMode preserved):

```typescript
// PATTERN SOURCE: integrations/system-health-dashboard/src/main.tsx:1-10
import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'  // NEW
import App from './App'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: true } },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
)
```

---

### `src/App.tsx` (route — Router shell)

**Analog:** `integrations/system-health-dashboard/src/App.tsx` (lines 1-47)

**Port pattern (BrowserRouter + Routes verbatim; Provider DROPPED — Zustand needs none; routes adapted to D-45-02):**

```typescript
// PATTERN SOURCE: integrations/system-health-dashboard/src/App.tsx:37-45
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { UnifiedViewer } from './routes/UnifiedViewer'
import { UnknownSystem } from './routes/UnknownSystem'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/viewer/coding" replace />} />
        <Route path="/viewer/:system" element={<UnifiedViewer />} />
        <Route path="*" element={<UnknownSystem />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
```

Note: dashboard wraps `<Provider store={store}>` around `<BrowserRouter>` (App.tsx:38-44). Phase 45 OMITS this — Zustand stores work standalone (no Provider).

---

### `src/routes/UnifiedViewer.tsx` (route — system-keyed remount)

**Analog (role-match):** `integrations/system-health-dashboard/src/components/system-health-dashboard.tsx` (page-shell composition; lines 35-44 imports + state-hook pattern)

**Core pattern (NEW — Pattern 1 from RESEARCH.md verbatim):**

```typescript
// PATTERN SOURCE: 45-RESEARCH.md §Pattern 1 (lines 367-384)
// CRITICAL: key={system} guarantees full unmount on system switch (Pitfall 2)
import { useParams, Navigate } from 'react-router-dom'
import { ViewerCore } from './ViewerCore'

const VALID_SYSTEMS = ['coding', 'okb', 'cap'] as const
type System = typeof VALID_SYSTEMS[number]

export function UnifiedViewer() {
  const { system } = useParams<{ system: string }>()
  if (!system || !VALID_SYSTEMS.includes(system as System)) {
    return <Navigate to="/viewer/coding" replace />
  }
  // The key={system} forces React to unmount-then-remount whenever the
  // route param changes. ZERO state can survive across systems.
  return <ViewerCore key={system} system={system as System} />
}
```

Layout composition (3-pane shell — derived from UI-SPEC §Layout Contract):

```typescript
// ViewerCore.tsx — derived from UI-SPEC §Layout Contract lines 158-164
function ViewerCore({ system }: { system: System }) {
  return (
    <div className="flex flex-col h-screen">
      <NavBar system={system} />
      <div className="flex flex-1 overflow-hidden">
        <FilterRail />
        <SigmaCanvas />
        <SidePanel system={system} />
      </div>
      <Footer />
    </div>
  )
}
```

---

### `src/api/ApiClient.ts` (service — km-core REST client)

**Analog (role-match — no class-style client exists in repo; closest fetch patterns are):**

1. `integrations/system-health-dashboard/src/store/middleware/apiMiddleware.ts:10-23` — `API_BASE_URL` pattern + fetch+throw idiom
2. `integrations/system-health-dashboard/src/components/nav-bar.tsx:5-27` — multi-endpoint fetch with `.then().catch()` swallowing
3. `integrations/system-health-dashboard/src/pages/digests.tsx:11-12` — `${API_BASE_URL}` + envelope `body.data` pattern

**Core pattern (NEW, derived from those three):**

```typescript
// PATTERN SOURCES:
//   integrations/system-health-dashboard/src/store/middleware/apiMiddleware.ts:10-30 (fetch+throw)
//   integrations/system-health-dashboard/src/pages/digests.tsx:29-34 (envelope shape)
//   lib/km-core/src/api/handlers/ontology.ts:50-68 (canonical /api/v1 routes)

interface ApiSuccess<T> { success: true; data: T }
interface ApiError { success: false; error: string }

export class ApiClient {
  constructor(private readonly baseUrl: string) {}

  private async get<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
    const body = (await res.json()) as ApiSuccess<T> | ApiError
    if (!body.success) throw new Error(body.error)
    return body.data
  }

  listEntities() { return this.get<Entity[]>('/api/v1/entities') }
  listRelations() { return this.get<Relation[]>('/api/v1/relations') }
  listOntologyClasses() { return this.get<OntologyClass[]>('/api/v1/ontology/classes?withDisplay=true') }
  listOntologyClassesNoDisplay() { return this.get<OntologyClass[]>('/api/v1/ontology/classes') }
  getNeighbors(id: string, depth = 1) { return this.get<NeighborhoodPayload>(`/api/v1/entities/${id}/neighbors?depth=${depth}`) }
  // Phase 44 typed views (camelCase wire shape per Plan 44-16 lock):
  listDigests(limit = 50) { return this.get<{ data: Digest[]; total: number; limit: number; offset: number }>(`/api/coding/digests?limit=${limit}`) }
  listInsights(limit = 50) { return this.get<{ data: Insight[]; total: number; limit: number; offset: number }>(`/api/coding/insights?limit=${limit}`) }
}
```

**Hook (TanStack Query) wrapping the client — RESEARCH.md Pattern 2:**

```typescript
// integrations/unified-viewer/src/api/useEntities.ts
import { useQuery } from '@tanstack/react-query'
import { useApiClient } from './ApiClient'

export function useEntities(system: System) {
  const client = useApiClient(system)
  return useQuery({
    queryKey: ['entities', system],   // CRITICAL: system-keyed to prevent cross-system leak
    queryFn: () => client.listEntities(),
    staleTime: 30_000,
  })
}
```

---

### `src/api/OkmRcaClient.ts` (service — C-specific RCA SSE)

**Analog:** VOKB `RcaOperationsPanel.tsx` (external — not in this workspace; per RESEARCH.md §Summary lines 74-561 of the source).

**RESEARCH.md verified facts:**

- Endpoints: `POST /api/okm/rca/ingest`, `GET /api/okm/rca/dirs`, `GET /api/okm/rca/status`, `SSE /api/okm/ingest/progress`
- These are NOT inside the `/api/v1/*` canonical surface (per RESEARCH.md §Summary line 115)
- 5-stage pipeline: Extract → Dedup → Store → Synthesize → Resolve
- 120s stale-ingestion watchdog (VOKB lines 225-236) — PORT verbatim
- 'connected' SSE bootstrap event (VOKB lines 117-124) — PORT verbatim

**Why separate from `ApiClient`:** keeping `/api/v1/*` reads pure (`ApiClient`) vs. system-specific RCA endpoints (`OkmRcaClient`) makes the cross-system extension story clear — A and B never instantiate `OkmRcaClient`. The planner registers `OkmRcaClient` only when `system === 'cap'`.

**Pattern skeleton (planner expands at port time):**

```typescript
// integrations/unified-viewer/src/api/OkmRcaClient.ts (NEW — PORT from VOKB)
export class OkmRcaClient {
  constructor(private baseUrl: string) {}
  async listDirs() { /* GET /api/okm/rca/dirs */ }
  async getStatus() { /* GET /api/okm/rca/status */ }
  async rcaIngest(pipeline: 'raas'|'kpifw'|'e2e', dirPath: string) { /* POST /api/okm/rca/ingest */ }
  subscribeProgress(onMsg: (e: PipelineEvent) => void): EventSource {
    // SSE: GET /api/okm/ingest/progress
    const es = new EventSource(`${this.baseUrl}/api/okm/ingest/progress`)
    es.onmessage = (ev) => onMsg(JSON.parse(ev.data))
    return es
  }
}
```

---

### `src/api/schemas.ts` (model — Zod schemas for the wire-shape lock)

**Analog (exact for type shapes):** `lib/km-core/src/adapters/observation-view.ts` (LegacyDigest at lines 78-90, LegacyInsight at lines 95-108)

**Analog (exact for key list):** `tests/integration/typed-views.test.js` lines 35-63

**Port the interface declarations VERBATIM:**

```typescript
// PATTERN SOURCE: lib/km-core/src/adapters/observation-view.ts:78-108 (LegacyDigest, LegacyInsight)
// PATTERN SOURCE: tests/integration/typed-views.test.js:35-63 (REQUIRED_*_KEYS arrays)
import { z } from 'zod'

// Phase 44 Plan 16 wire-shape lock — DO NOT change to snake_case (see 44-CONTEXT-amendment-4.md)
export const DigestSchema = z.object({
  id: z.string(),
  date: z.string(),
  theme: z.string(),
  summary: z.string(),
  observationIds: z.array(z.string()),   // NOT observation_ids
  agents: z.array(z.string()),
  filesTouched: z.array(z.string()),      // NOT files_touched
  project: z.string().nullable().optional(),
  // 'createdAt' surfaces in dashboard payloads (digests.tsx:23) — keep optional
  createdAt: z.string().optional(),
})

export const InsightSchema = z.object({
  id: z.string(),
  topic: z.string(),
  summary: z.string(),
  confidence: z.number(),
  digestIds: z.array(z.string()),         // NOT digest_ids
  lastUpdated: z.string(),                // NOT last_updated
  project: z.string().nullable().optional(),
})

// Observations are the only typed-view that keeps snake_case session_id
// per Plan 44-16 lock (typed-views.test.js:35-42).
export const ObservationSchema = z.object({
  id: z.string(),
  agent: z.string(),
  project: z.string(),
  content: z.string(),
  artifacts: z.array(z.string()),
  timestamp: z.string(),
  session_id: z.string().optional(),      // EXCEPTION — snake_case stays
})
```

---

### `src/api/shape-lock.test.ts` (test — mirror `tests/integration/typed-views.test.js`)

**Analog:** `tests/integration/typed-views.test.js` (entire file, 163 lines)

**Mirror the REQUIRED_*_KEYS arrays VERBATIM** (no change — the wire keys are the same; just port from Jest to Vitest):

```typescript
// PATTERN SOURCE: tests/integration/typed-views.test.js:35-63 (verbatim key lists)
// Phase 45 wire-shape lock test — re-asserts Plan 44-16 contract at the viewer boundary.
// If a key shifts, BOTH this test AND tests/integration/typed-views.test.js must update together.

import { describe, test, expect } from 'vitest'
import { DigestSchema, InsightSchema, ObservationSchema } from './schemas'

const REQUIRED_OBS_KEYS = ['id','agent','project','content','artifacts','timestamp']
const REQUIRED_DIGEST_KEYS = ['id','date','theme','summary','observationIds','agents','filesTouched','project']
const REQUIRED_INSIGHT_KEYS = ['id','topic','summary','confidence','digestIds','lastUpdated','project']

describe('Phase 45 wire-shape lock — Plan 44-16 mirror', () => {
  test('DigestSchema enforces camelCase keys', () => {
    const valid = { id:'x', date:'2026-06-07', theme:'t', summary:'s', observationIds:['a'], agents:['claude'], filesTouched:['f'], project:'coding' }
    expect(DigestSchema.parse(valid)).toBeTruthy()
    // The snake_case shape MUST fail:
    expect(() => DigestSchema.parse({ ...valid, observation_ids: ['a'], observationIds: undefined })).toThrow()
  })
  // ... same shape for Insight + Observation (session_id snake_case allowed)
})
```

---

### `src/store/viewer-store.ts` (store — Zustand)

**Analog (role-match — RTK shape, idiom shift to Zustand):** `integrations/system-health-dashboard/src/store/slices/healthStatusSlice.ts` (lines 28-89 — shape, initial state, reducers)

**RTK reference pattern (what the dashboard does — DO NOT port verbatim, port the SHAPE):**

```typescript
// SOURCE: integrations/system-health-dashboard/src/store/slices/healthStatusSlice.ts:28-89
interface HealthStatusState {
  overallStatus: 'healthy' | 'degraded' | 'unhealthy' | 'offline'
  loading: boolean
  error: string | null
  /* ... */
}
const initialState: HealthStatusState = { /* ... */ }
const slice = createSlice({
  name: 'healthStatus',
  initialState,
  reducers: {
    fetchStart(state) { state.loading = true; state.error = null },
    fetchSuccess(state, action: PayloadAction<...>) { /* ... */ },
    fetchFailure(state, action: PayloadAction<string>) { /* ... */ },
  },
})
```

**Zustand idiom (NEW for Phase 45 — RESEARCH.md §Standard Stack recommends Zustand 5):**

```typescript
// integrations/unified-viewer/src/store/viewer-store.ts (NEW)
// Shape mirrors healthStatusSlice's idea (state + reducers as setters);
// Provider eliminated per RESEARCH.md Anti-Pattern "RTK time-travel not needed here"
import { create } from 'zustand'

export interface ViewerState {
  // Selection
  selectedNodeId: string | null
  selectedEdgeId: string | null
  // Filters
  searchQuery: string
  visibleLevels: Set<0 | 1 | 2 | 3>
  selectedClasses: Set<string>
  // UI
  theme: 'light' | 'dark'
  filterRailCollapsed: boolean
  // Actions
  setSelectedNode: (id: string | null) => void
  setSearch: (q: string) => void
  toggleLevel: (level: 0|1|2|3) => void
  toggleClass: (className: string) => void
  reset: () => void
}

export const useViewerStore = create<ViewerState>((set) => ({
  selectedNodeId: null,
  selectedEdgeId: null,
  searchQuery: '',
  visibleLevels: new Set([0, 1, 2, 3]),
  selectedClasses: new Set(),
  theme: (localStorage.getItem('viewer-theme') as 'light' | 'dark') ?? 'light',
  filterRailCollapsed: false,
  setSelectedNode: (id) => set({ selectedNodeId: id }),
  setSearch: (q) => set({ searchQuery: q }),
  toggleLevel: (level) => set((s) => {
    const next = new Set(s.visibleLevels)
    next.has(level) ? next.delete(level) : next.add(level)
    return { visibleLevels: next }
  }),
  toggleClass: (cn) => set((s) => {
    const next = new Set(s.selectedClasses)
    next.has(cn) ? next.delete(cn) : next.add(cn)
    return { selectedClasses: next }
  }),
  reset: () => set({ selectedNodeId: null, selectedEdgeId: null, searchQuery: '', selectedClasses: new Set() }),
}))
```

**Per-system reset:** the `<UnifiedViewer key={system}>` remount tears the entire Zustand store down with the component subtree — no manual `reset()` call needed across systems. This is the whole reason Zustand wins over RTK here.

---

### `src/config/system-endpoints.ts` (config — multi-base-URL map)

**Analog (role-match):** `integrations/system-health-dashboard/src/lib/config.ts` (lines 14-19 — single-base-URL map)

**Dashboard's pattern (SINGLE base URL — port the env-var-with-fallback IDIOM):**

```typescript
// SOURCE: integrations/system-health-dashboard/src/lib/config.ts:10-19
const API_PORT = process.env.CONSTRAINT_API_PORT ? parseInt(process.env.CONSTRAINT_API_PORT) : 3031;
export const CONFIG = { API_BASE_URL: `http://localhost:${API_PORT}`, ... } as const;
```

**Phase 45 (MULTI base URL — D-45-02):**

```typescript
// integrations/unified-viewer/src/config/system-endpoints.ts (NEW)
// PATTERN SOURCE: env-var-with-fallback idiom from system-health-dashboard/src/lib/config.ts:10
// CONTRACT SOURCE: D-45-02 (CONTEXT.md lines 51-67)
export type System = 'coding' | 'okb' | 'cap'

export const SYSTEM_ENDPOINTS: Record<System, string> = {
  coding: import.meta.env.VITE_BACKEND_CODING_URL ?? 'http://localhost:12436',
  okb:    import.meta.env.VITE_BACKEND_OKB_URL    ?? 'http://localhost:3848',
  cap:    import.meta.env.VITE_BACKEND_CAP_URL    ?? 'https://okm.cc.bmwgroup.net',
} as const

export const SYSTEM_LABELS: Record<System, string> = {
  coding: 'Coding',
  okb: 'OKB',
  cap: 'CAP',
} as const

export function isValidSystem(s: string): s is System {
  return s === 'coding' || s === 'okb' || s === 'cap'
}
```

Note shift from `process.env.X` (dashboard) to `import.meta.env.VITE_X` (Phase 45) — Vite-canonical env access; same outcome.

---

### `src/graph/SigmaCanvas.tsx` (component — Sigma + graphology renderer)

**Analog:** None on disk. VKB has `integrations/memory-visualizer/src/components/KnowledgeGraph/GraphVisualization.tsx` (D3 force) — REFERENCE only, do NOT port (RESEARCH.md "Don't Hand-Roll" says NOT to inherit VOKB's 1165 / VKB's ~800 lines of d3-tick code).

**Build NEW on `@react-sigma/core`** per RESEARCH.md Pattern 3 + Example 1:

```typescript
// PATTERN SOURCE: 45-RESEARCH.md §Example 1 (lines 596-639) — verified against
// https://sim51.github.io/react-sigma/
import { SigmaContainer, useLoadGraph, useRegisterEvents } from '@react-sigma/core'
import { useLayoutForceAtlas2 } from '@react-sigma/layout-forceatlas2'
import Graph from 'graphology'
import '@react-sigma/core/lib/style.css'

function GraphSetup({ entities, relations, ontology, theme }: Props) {
  const loadGraph = useLoadGraph()
  const registerEvents = useRegisterEvents()
  const { assign } = useLayoutForceAtlas2({ iterations: 100 })

  useEffect(() => {
    const graph = new Graph()
    for (const e of entities) {
      const cls = ontology.find(c => c.name === e.ontologyClass)
      graph.addNode(e.id, {
        x: Math.random(), y: Math.random(),
        size: 8,
        color: cls?.display?.color ?? classColor(e.ontologyClass, theme),
        label: e.name,
      })
    }
    for (const r of relations) {
      graph.addEdge(r.from, r.to, { size: 1, color: 'rgba(100,100,100,0.5)' })
    }
    loadGraph(graph)
    assign()
    registerEvents({
      clickNode: ({ node }) => useViewerStore.getState().setSelectedNode(node),
      doubleClickNode: ({ node }) => expandNeighbors(node),
    })
  }, [entities, relations, ontology, theme])

  return null
}
```

---

### `src/graph/color-fallback.ts` (utility — FNV-1a hash → HSL)

**Analog:** UI-SPEC.md §Color (lines 122-137) — the formula is verbatim in the spec.

```typescript
// PATTERN SOURCE: 45-UI-SPEC.md §Color (lines 122-137 verbatim)
// CONTRACT: D-45-03 "deterministic color = hsl(hash(name) % 360, 65%, 55%)"
export function classColor(className: string, theme: 'light' | 'dark'): string {
  let h = 2166136261
  for (let i = 0; i < className.length; i++) {
    h = (h ^ className.charCodeAt(i)) * 16777619
    h = h >>> 0
  }
  const hue = h % 360
  return theme === 'dark'
    ? `hsl(${hue}, 65%, 60%)`
    : `hsl(${hue}, 55%, 45%)`
}
```

---

### `src/graph/node-renderer.ts` (utility — per-state stroke + opacity overlays)

**Analog:** UI-SPEC.md §Color State color overlays table (lines 142-152)

```typescript
// PATTERN SOURCE: 45-UI-SPEC.md §Color State table (verbatim port)
export type NodeState = 'default' | 'hover' | 'selected' | 'search-match' | 'filter-dimmed' | 'filter-hidden'

export function nodeStrokeForState(state: NodeState) {
  switch (state) {
    case 'default':       return { width: 1, color: 'hsl(var(--border))', opacity: 1.0 }
    case 'hover':         return { width: 2, color: 'hsl(var(--ring))', opacity: 1.0 }
    case 'selected':      return { width: 3, color: 'hsl(var(--primary))', opacity: 1.0 }
    case 'search-match':  return { width: 2, color: 'hsl(45, 100%, 50%)', opacity: 1.0 }  // FIXED amber per UI-SPEC
    case 'filter-dimmed': return { width: 1, color: 'hsl(var(--border))', opacity: 0.25 }
    case 'filter-hidden': return null
  }
}
```

---

### `src/panels/MarkdownViewerPanel.tsx` (component — port from VKB)

**Analog:** `integrations/memory-visualizer/src/components/MarkdownViewer.tsx` (406 lines total)

**Imports pattern (lines 1-4):**

```typescript
import React, { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
```

**`sanitizeMarkdownHtml()` — PORT VERBATIM (lines 6-29):**

```typescript
// PATTERN SOURCE: integrations/memory-visualizer/src/components/MarkdownViewer.tsx:6-29
function sanitizeMarkdownHtml(content: string): string {
  // Step 1: Convert <a href="..."><img ...></a> to [![alt](img-src)](link-href)
  content = content.replace(/<a\s+href="([^"]*)"[^>]*>\s*<img\s+[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>\s*<\/a>/gi,
    '[![$3]($2)]($1)')
  content = content.replace(/<a\s+href="([^"]*)"[^>]*>\s*<img\s+[^>]*alt="([^"]*)"[^>]*src="([^"]*)"[^>]*\/?>\s*<\/a>/gi,
    '[![$2]($3)]($1)')
  // Step 2: Convert standalone <img> to ![alt](src)
  content = content.replace(/<img\s+[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, '![$2]($1)')
  content = content.replace(/<img\s+[^>]*alt="([^"]*)"[^>]*src="([^"]*)"[^>]*\/?>/gi, '![$1]($2)')
  // Step 3: Convert <a href="...">text</a> to [text](href) — only for simple text content
  content = content.replace(/<a\s+href="([^"]*)"[^>]*>([^<]*)<\/a>/gi, '[$2]($1)')
  // Step 4: Convert <br> and <br/> to markdown line breaks
  content = content.replace(/<br\s*\/?>/gi, '  \n')
  // Step 5: Remove remaining HTML block tags but keep their content
  content = content.replace(/<\/?(div|picture|source|p|center)[^>]*>/gi, '')
  // Step 6: Fix indentation — leading-space images
  content = content.replace(/^[ \t]+(!\[)/gm, '$1')
  content = content.replace(/\n{3,}/g, '\n\n')
  return content
}
```

**Component-overrides block — PORT lines 280-388 EXCEPT Mermaid (`pre` + `code` lines 250-278 STRIP `MermaidDiagram` branch):**

```typescript
// PATTERN SOURCE: integrations/memory-visualizer/src/components/MarkdownViewer.tsx:280-388
// STRIPPED: Mermaid branches at lines 250-266 (D-45-04 defers Mermaid to v2)
<ReactMarkdown
  remarkPlugins={[remarkGfm]}
  rehypePlugins={[rehypeHighlight]}
  components={{
    img: ({ node, ...props }) => {
      let src = props.src || ''
      if (src && !src.startsWith('http')) {
        const baseUrl = filePath.substring(0, filePath.lastIndexOf('/'))
        src = `${baseUrl}/${src}`
      }
      return <img {...props} src={src} className="max-w-full h-auto" />
    },
    pre: ({ children, ...props }) => (
      // MERMAID HOOK STRIPPED per D-45-04 — render plain code block only
      <pre className="bg-muted rounded p-4 overflow-x-auto" {...props}>{children}</pre>
    ),
    code: ({ className, children, ...props }) => {
      const isInline = !className || !className.startsWith('language-')
      if (isInline) return <code className="bg-muted px-1 rounded" {...props}>{children}</code>
      // MERMAID HOOK STRIPPED — fallback to standard rendering
      return <code className={className} {...props}>{children}</code>
    },
    // h1-h6 with anchor IDs (port lines 280-309 verbatim — DRY into a helper)
    h1: ({ children, ...props }) => makeAnchor('h1', 'text-3xl font-bold mb-4 mt-6', children, props),
    h2: ({ children, ...props }) => makeAnchor('h2', 'text-2xl font-bold mb-3 mt-5', children, props),
    // ... h3-h6 same pattern
    a: ({ href, children, ...props }) => {
      // PORT lines 317-384 — anchor smooth-scroll + .md cross-link handling
      if (href?.startsWith('#')) { /* smooth-scroll branch */ }
      if (href?.endsWith('.md')) { /* relative .md link branch */ }
      return <a className="text-primary underline" href={href} {...props}>{children}</a>
    },
  }}
>
  {content}
</ReactMarkdown>
```

**Esc-handler — PORT lines 126-138 verbatim (keyboard close → store-deselect):**

```typescript
// PATTERN SOURCE: integrations/memory-visualizer/src/components/MarkdownViewer.tsx:126-138
useEffect(() => {
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') useViewerStore.getState().setSelectedNode(null)
  }
  document.addEventListener('keydown', handleKeyDown)
  return () => document.removeEventListener('keydown', handleKeyDown)
}, [])
```

**Modal shell REPLACED:** The VKB version (lines 152-153) renders `<div className="fixed inset-0 bg-black bg-opacity-50 ...">`. Phase 45 uses an EMBEDDED side panel (UI-SPEC §Layout Contract). Drop the fixed-inset wrapper; keep the internal scroll container + history-nav buttons (lines 156-216).

**Highlight.js CSS theme gating:**

```typescript
// VKB hardcodes 'highlight.js/styles/github.css' (line 31)
// Phase 45 gates by store theme (UI-SPEC §Reference Port-Specs Markdown row 'Highlight.js CSS theme'):
import 'highlight.js/styles/github.css'         // light
import 'highlight.js/styles/github-dark.css'    // dark
// Apply via theme-conditional <link rel="stylesheet"> swap
```

**Wrap markdown body** (UI-SPEC §MarkdownViewer Panel "Styling"):

```typescript
<div className="prose prose-sm dark:prose-invert max-w-none">
  <ReactMarkdown>...</ReactMarkdown>
</div>
```

(Requires `@tailwindcss/typography` plugin — already pinned in package.json above.)

---

### `src/panels/RcaOpsPanel.tsx` (component — port from VOKB Option A)

**Analog:** VOKB `RcaOperationsPanel.tsx` — **EXTERNAL** (not in this workspace; located at `_work/rapid-automations/integrations/operational-knowledge-management/viewer/src/components/RcaOperationsPanel.tsx` in the rapid-automations submodule per RESEARCH.md §Summary lines 74-561).

**Planner action item:** before this plan executes, the planner must EITHER (a) clone/access rapid-automations to read the source OR (b) consume the port-spec from UI-SPEC §Reference Port-Specs RCA panel table (lines 396-405) which captures the structural anchors.

**UI-SPEC port-spec table (verbatim from UI-SPEC.md lines 397-405):**

| Field | Source line | Action |
|---|---|---|
| SSE subscription | `RcaOperationsPanel.tsx:92-176` (`okbClient.subscribeProgress()` + `eventSourceRef`) | PORT, retargeting `okbClient` → `OkmRcaClient` |
| Stage state machine | `:44-72` (`PipelineStage[]` + `STAGE_TO_TIER_KEY`) | PORT |
| Raw color classes (`TIER_COLORS`) | `:59-63` (`bg-green-500`, `bg-blue-500`, `bg-purple-500`) | REPLACE with shadcn `bg-primary` (active) / `bg-muted` (done) / `bg-muted/40` (pending) |
| Raw button classes | `:434, :455, :481-501, :516-538` (`bg-blue-500 ...`) | REPLACE with `<Button size="sm" variant="default">` / `variant="secondary">` |
| Stale-ingestion 120s watchdog | `:225-236` | PORT verbatim |
| Connection bootstrap on 'connected' event | `:117-124` | PORT verbatim |

**Composition (derived from UI-SPEC §RCA Lookup Panel Option A — lines 309-315):**

```typescript
// integrations/unified-viewer/src/panels/RcaOpsPanel.tsx (NEW — PORT Option A)
// Composition order per UI-SPEC §RCA Lookup Panel Option A:
//   1. Directory list (Card + grouped lists KPI-FW/RaaS/E2E with per-row <Button size="sm">)
//   2. Pipeline stages (5 horizontal pills via <Badge variant="outline">)
//   3. Progress bar (<Progress value={progressPct}>)
//   4. Completion / error card (border-l-4 border-l-emerald-500 OR border-l-destructive)
```

---

### `src/panels/FilterRail.tsx` (component — search + level + class filters)

**Analog:** `integrations/memory-visualizer/src/components/Filters/SearchFilter.tsx` (lines 1-49) + `TypeFilters.tsx` (lines 1-55) — role-match

**VKB SearchFilter pattern** (Tailwind classes are raw-color; Phase 45 rebuilds in shadcn `<Input>`):

```typescript
// SOURCE: integrations/memory-visualizer/src/components/Filters/SearchFilter.tsx:24-48
<div className="bg-white rounded-lg shadow p-2">
  <h3 className="text-xs font-semibold text-gray-700 mb-1.5">Search</h3>
  <div className="relative">
    <input type="text" value={searchTerm} onChange={handleChange}
           placeholder="Search entities..." className="..."/>
    {searchTerm && <button onClick={handleClear}>✕</button>}
  </div>
</div>
```

**Phase 45 port (shadcn primitives + Zustand store):**

```typescript
// integrations/unified-viewer/src/panels/FilterRail.tsx (NEW)
// PATTERN SOURCES:
//   VKB SearchFilter shape: integrations/memory-visualizer/src/components/Filters/SearchFilter.tsx:24-48
//   VKB TypeFilters multi-select: integrations/memory-visualizer/src/components/Filters/TypeFilters.tsx:19-53
//   shadcn primitives: integrations/system-health-dashboard/src/components/ui/{input,checkbox,select}.tsx
// COPY: UI-SPEC §Copywriting Contract — placeholder 'Search entities...' verbatim
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { useViewerStore } from '@/store/viewer-store'

export function FilterRail() {
  const { searchQuery, setSearch, visibleLevels, toggleLevel, selectedClasses, toggleClass } = useViewerStore()
  return (
    <aside className="w-64 bg-card border-r border-border p-md space-y-md">
      <Input
        value={searchQuery}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search entities..."  // UI-SPEC Copywriting row 'Primary CTA — search'
      />
      <section>
        <h3 className="text-xs font-medium mb-sm">Level</h3>
        {[0, 1, 2, 3].map((lvl) => (
          <label key={lvl} className="flex items-center gap-xs">
            <Checkbox checked={visibleLevels.has(lvl as 0|1|2|3)}
                      onCheckedChange={() => toggleLevel(lvl as 0|1|2|3)} />
            <span className="text-xs">L{lvl}</span>
          </label>
        ))}
      </section>
      {/* Class multi-select — derived from VKB TypeFilters but as shadcn Select */}
    </aside>
  )
}
```

---

### `src/panels/EntityDetailPanel.tsx` (component — entity card composition)

**Analog (role-match):** `integrations/system-health-dashboard/src/pages/digests.tsx` (DigestCard at lines 43-94)

**DigestCard composition pattern (PORT IDIOM — Card + Badge + ScrollArea):**

```typescript
// PATTERN SOURCE: integrations/system-health-dashboard/src/pages/digests.tsx:47-94
<Card className={`border-l-4 ${quality === 'high' ? 'border-l-amber-500' : 'border-l-border'}`}>
  <CardContent className="p-4">
    <div className="flex items-start gap-2">
      <ChevronDown className="w-4 h-4 mt-1 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">{theme}</span>
          <Badge variant="outline" className="text-xs shrink-0">{observationIds.length} obs</Badge>
        </div>
        <div className="mt-3 space-y-2">
          <MarkdownText text={summary} />
        </div>
      </div>
    </div>
  </CardContent>
</Card>
```

**Phase 45 adapts** (UI-SPEC §Entity Detail Panel — 5 sections: Description, Identity, Provenance, Neighbors, Raw):

```typescript
// integrations/unified-viewer/src/panels/EntityDetailPanel.tsx (NEW)
// PATTERN SOURCES:
//   integrations/system-health-dashboard/src/pages/digests.tsx:47-94 (Card + Badge composition)
//   UI-SPEC §Entity Detail Panel (lines 261-272) — 5 sections + empty state copy
//   integrations/system-health-dashboard/src/components/markdown-text.tsx (port for description rendering)
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Collapsible } from '@/components/ui/collapsible'
import { MarkdownText } from '@/lib-domain/markdown-text'

export function EntityDetailPanel({ entity, ontology }: Props) {
  if (!entity) return <EmptyState text="Click any node to see its details." />
  const cls = ontology.find(c => c.name === entity.ontologyClass)
  return (
    <ScrollArea className="w-96 border-l border-border">
      <div className="p-md space-y-md">
        <header>
          <h2 className="text-xl font-semibold">{entity.name}</h2>
          <Badge variant="outline" style={{ borderColor: cls?.display?.color ?? classColor(entity.ontologyClass, 'light') }}>
            {entity.ontologyClass}
          </Badge>
        </header>
        <section><MarkdownText text={entity.description} /></section>
        {/* Identity, Provenance, Neighbors, Raw — UI-SPEC §Entity Detail Panel */}
      </div>
    </ScrollArea>
  )
}
```

---

### `src/panels/NavBar.tsx` (component — route nav)

**Analog:** `integrations/system-health-dashboard/src/components/nav-bar.tsx` (lines 1-30 imports + Link pattern)

**Port pattern** (Link + useLocation, drop the fetch counters):

```typescript
// PATTERN SOURCE: integrations/system-health-dashboard/src/components/nav-bar.tsx:1-30
import { Link, useLocation } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'

export function NavBar({ system }: { system: System }) {
  const location = useLocation()
  const tabs: Array<{ label: string; path: string }> = [
    { label: 'Coding', path: '/viewer/coding' },
    { label: 'OKB',    path: '/viewer/okb' },
    { label: 'CAP',    path: '/viewer/cap' },
  ]
  return (
    <nav className="h-16 bg-secondary border-b border-border flex items-center px-lg">
      <div className="font-bold">Unified Viewer</div>
      <div className="flex-1 flex justify-center gap-md">
        {tabs.map(t => (
          <Link key={t.path} to={t.path}
                className={location.pathname === t.path ? 'font-bold underline' : ''}>
            {t.label}
          </Link>
        ))}
      </div>
      <ThemeToggle />
      <KeyboardHelpButton />
    </nav>
  )
}
```

---

### `src/lib-domain/markdown-text.tsx` (utility — lightweight inline renderer for entity descriptions)

**Analog:** `integrations/system-health-dashboard/src/components/markdown-text.tsx` (135 lines, VERBATIM port)

**Key pieces (lines 11, 14-22, 27-40, ~135 total):**

```typescript
// PATTERN SOURCE: integrations/system-health-dashboard/src/components/markdown-text.tsx (verbatim port)
// 135 lines; port the whole file. Handles ##, bullets, `code`, **bold**, line breaks + redaction-token styling.
const REDACTION_TOKEN_RX = /<[A-Z][A-Z0-9_]*_REDACTED>/g

export function renderWithRedactionStyling(text: string, keyBase: string = 'r'): (string | JSX.Element)[] {
  const parts: (string | JSX.Element)[] = []
  pushRedactionAware(parts, text, keyBase)
  return parts
}
// ... full body verbatim
```

This file appears in two UI-SPEC sections:

1. **EntityDetailPanel description rendering** (UI-SPEC §Entity Detail Panel section 1 "Description")
2. **RESEARCH.md "Don't Hand-Roll" table** — flagged distinct from the heavyweight `MarkdownViewer` panel (lines 510-512)

---

### `src/lib-domain/states.tsx` (component — Loading / Empty / Error)

**Analog:** UI-SPEC §State Contract (lines 240-254) + `integrations/system-health-dashboard/src/pages/digests.tsx:304-308` (destructive banner) + `:309-311` (success banner)

**Destructive banner pattern (PORT VERBATIM from digests.tsx:304-308):**

```typescript
// PATTERN SOURCE: integrations/system-health-dashboard/src/pages/digests.tsx:304-308
<div className="mb-4 p-3 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm">
  Cannot reach {system} API at {baseUrl}. Check that the service is running and accessible.
</div>
```

**Phase 45 component (UI-SPEC §State Contract — all 8 states):**

```typescript
// integrations/unified-viewer/src/lib-domain/states.tsx (NEW)
// PATTERN SOURCES:
//   integrations/system-health-dashboard/src/pages/digests.tsx:304-311 (banner styles)
//   45-UI-SPEC.md §State Contract lines 240-254 (8 state contracts + copy)
import { Loader2, Network } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function LoadingState({ system }: { system: string }) {
  return <div className="flex flex-col items-center justify-center p-2xl">
    <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
    <p className="text-sm text-muted-foreground mt-md">Loading {system} graph...</p>
  </div>
}

export function ErrorBanner({ system, baseUrl, kind, onRetry }: {
  system: string; baseUrl: string; kind: 'unreachable' | 'cors' | 'ontology'; onRetry: () => void
}) {
  const body = kind === 'unreachable'
    ? `Cannot reach ${system} API at ${baseUrl}. Check that the service is running and accessible.`
    : kind === 'cors'
    ? `Browser blocked the request to ${baseUrl} (CORS). The ${system} service must allow this origin or be reached through a proxy.`
    : `Ontology metadata unavailable — node colors will use hash-based fallback.`
  return <div className={kind === 'ontology'
    ? "p-3 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400 text-sm"
    : "p-3 rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm"}>
    {body} <Button size="sm" onClick={onRetry}>Retry</Button>
  </div>
}
```

---

### `src/components/IconButton.tsx` (component — icon-only with aria-label + Tooltip)

**Analog:** UI-SPEC §Icon-only controls table (lines 209-220) + shadcn `<Button>` + `<Tooltip>` from `integrations/system-health-dashboard/src/components/ui/{button,tooltip}.tsx`

**Pattern (UI-SPEC §Icon-only controls is NON-NEGOTIABLE — every icon-only button MUST have aria-label + tooltip):**

```typescript
// integrations/unified-viewer/src/components/IconButton.tsx (NEW)
// PATTERN SOURCE: 45-UI-SPEC.md §Icon-only controls (lines 209-220) — accessibility contract
// Wraps shadcn <Button> + <Tooltip> to guarantee aria-label + tooltip pairing
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface IconButtonProps {
  icon: React.ReactNode
  ariaLabel: string
  tooltip: string
  onClick: () => void
}

export function IconButton({ icon, ariaLabel, tooltip, onClick }: IconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="icon" variant="ghost" aria-label={ariaLabel} onClick={onClick}>
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  )
}
```

---

### `tests/e2e/*.spec.ts` (Playwright E2E tests)

**Analog:** `tests/e2e/dashboard/workflow-graph-colors.spec.ts` (E2E shape) + `tests/e2e/dashboard/playwright.config.ts` (Playwright config)

**Playwright config port (adapt baseURL to viewer's port 5173):**

```typescript
// PATTERN SOURCE: tests/e2e/dashboard/playwright.config.ts:1-17
import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  use: {
    baseURL: 'http://localhost:5173',  // viewer dev server (vite default)
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
})
```

**E2E test shape (PORT from dashboard spec — header pattern lines 1-20):**

```typescript
// PATTERN SOURCE: tests/e2e/dashboard/workflow-graph-colors.spec.ts:1-20
// tests/e2e/unified-viewer/system-routing.spec.ts (NEW)
import { test, expect, type Page } from '@playwright/test'

test('mounts /viewer/coding without errors', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('pageerror', (e) => consoleErrors.push(e.message))
  await page.goto('/viewer/coding')
  await expect(page.getByText('Coding')).toBeVisible()
  expect(consoleErrors).toEqual([])
})

test('system switch fully resets store', async ({ page }) => {
  await page.goto('/viewer/coding')
  // click a node
  // navigate to /viewer/okb
  await page.goto('/viewer/okb')
  // assert selectedNodeId is null (Pitfall 2 lock test from RESEARCH.md)
})
```

---

### Backend extension: `lib/km-core/src/api/handlers/ontology.ts` (MODIFY existing handler)

**Analog:** the file ITSELF — the existing `/ontology/classes` handler (lines 50-69) is the analog.

**Existing handler (PRE-extension):**

```typescript
// SOURCE: lib/km-core/src/api/handlers/ontology.ts:50-69 (VERBATIM CURRENT)
routes.push({
  method: 'get',
  path: '/ontology/classes',
  handler: async (_req, res) => {
    const registry = getRegistry(store, opts)
    const names = registry
      ? registry.getAllClassNames
        ? registry.getAllClassNames()
        : Array.from(registry.classCatalog.keys())
      : []
    res.json({ success: true, data: names })  // CURRENT: array of strings
  },
})
```

**Extension (Phase 45 — D-45-03 + RESEARCH.md §Display-hints overlay):**

The current handler returns an array of class-name STRINGS (per the 2026-06-03 amendment in lines 8-12). The Phase 45 contract is OPT-IN via `?withDisplay=true` so the existing wire shape stays locked (no breaking change to the OKM `rest-contract.test.ts:257` byte-equal fixture).

**Port pattern (planner expands):**

```typescript
// EXTENSION SOURCE: 45-RESEARCH.md §Display-hints overlay (lines 408-431 of UI-SPEC.md)
// + D-45-03 (CONTEXT.md lines 89-98)
// CONTRACT: ?withDisplay=true branches into an enriched shape with optional display block.
//           Missing/malformed display.json → server warning, classes returned without display.
routes.push({
  method: 'get',
  path: '/ontology/classes',
  handler: async (req, res) => {
    const registry = getRegistry(store, opts)
    const names = registry?.getAllClassNames?.() ?? Array.from(registry?.classCatalog.keys() ?? [])

    // CRITICAL — recurring issue per CLAUDE.md: km-core require ontologyDir
    // No new GraphKMStore is constructed here, so the existing `opts` carries
    // ontologyDir from caller. If the planner adds an overlay-loader helper
    // that DOES construct a new store, it MUST pass `ontologyDir`.

    if (req.query?.withDisplay === 'true') {
      const system = inferSystemFromOpts(opts)  // 'coding' | 'okb' | 'cap'
      const overlay = await loadDisplayOverlay(opts.ontologyDir, system)  // optional file
      const enriched = names.map((name) => ({
        name,
        level: registry?.getClass?.(name)?.level,
        parent: registry?.getClass?.(name)?.parent,
        ...(overlay?.[name] ? { display: overlay[name] } : {}),  // optional
      }))
      res.json({ success: true, data: enriched })
      return
    }

    // DEFAULT: existing shape — array of name STRINGS (LOCKED by OKM rest-contract.test.ts:257)
    res.json({ success: true, data: names })
  },
})
```

**Display-overlay file location** (D-45-03): `.data/ontologies/{coding,okb,cap}.display.json` — co-located with existing ontology JSONs (`.data/ontologies/coding-ontology.json` exists today).

**Acceptance grep gate for the planner** (RESEARCH.md Pitfall 9 — recurring km-core issue):

```bash
# If the planner adds a NEW script (e.g. overlay-loader CLI), the script MUST construct
# GraphKMStore with ontologyDir or default-class resolution throws.
grep -E "new GraphKMStore.*ontologyDir" <new-script>  # MUST match
```

---

## Shared Patterns

### Shared Pattern 1: Phase 44 wire-shape lock (camelCase)

**Source:** `tests/integration/typed-views.test.js` (canonical assertion lists at lines 35-63)
**Source:** `lib/km-core/src/adapters/observation-view.ts` (interface declarations at lines 78-108)
**Source:** `.planning/phases/44-rest-api-git-snapshots/44-CONTEXT-amendment-4.md` (the lock document itself)

**Apply to:** every `src/api/*.ts` file + every panel that reads digest/insight payloads (EntityDetailPanel, MarkdownViewerPanel description rendering).

**Required camelCase keys (mirror exactly from `tests/integration/typed-views.test.js:35-63`):**

```typescript
const REQUIRED_OBS_KEYS     = ['id','agent','project','content','artifacts','timestamp']
const REQUIRED_DIGEST_KEYS  = ['id','date','theme','summary','observationIds','agents','filesTouched','project']
const REQUIRED_INSIGHT_KEYS = ['id','topic','summary','confidence','digestIds','lastUpdated','project']
```

**Anti-key list (these MUST NOT appear in any Phase 45 schema or component reader):**

- `observation_ids`, `files_touched`, `digest_ids`, `last_updated`, `created_at` (these are the snake_case versions that the storage layer uses internally but get aliased to camelCase by `observation-view.ts` reshape — see lines 161-247 of that file)
- Exception: `session_id` — observations row keeps snake_case for this single field per Plan 44-16 lock

**Test:** `src/api/shape-lock.test.ts` must include a NEGATIVE assertion that `DigestSchema.parse({ ...valid, observation_ids: ['a'], observationIds: undefined })` throws.

---

### Shared Pattern 2: Anti-auto-bump version pinning

**Source:** RESEARCH.md Pitfall 6 (lines 555-559) + UI-SPEC §Design System (line 27)
**Source:** `integrations/system-health-dashboard/package.json` (verbatim version table)

**Apply to:** EVERY `npm install` invocation in EVERY plan task.

**Rule:** `npm install <name>@<exact-version>` — NEVER `npm install <name>` bare. The latter fetches npm-latest, which is currently:

| Library | npm latest (2026-06-07) | REQUIRED Phase 45 pin | Why pinned |
|---|---|---|---|
| `react` | `19.2.7` | `^18.3.1` | Dashboard match (UI-SPEC inherit-verbatim) |
| `vite` | `8.0.16` | `^5.3.1` | Dashboard match + Pitfall 4 (Tailwind 4 engine) |
| `tailwindcss` | `4.3.0` | `^3.4.4` | Pitfall 4 — engine break + config format |
| `lucide-react` | `1.17.0` | `^0.544.0` | Pitfall 3 — icon renames (ZoomIn etc.) |
| `react-router-dom` | `7.17.0` | `^7.14.0` | Dashboard match |

**Acceptance gate** (planner adds this to Wave 0 task):

```bash
# Verify package.json deps match dashboard's pinned versions exactly
cd integrations/unified-viewer
# Compare specific lines (NOT a deep diff — only the shared deps):
diff <(node -e "const p=require('./package.json');for(const k of ['react','react-dom','vite','tailwindcss','lucide-react','react-router-dom']){console.log(k+'@'+(p.dependencies[k]||p.devDependencies[k]))}") \
     <(cd ../system-health-dashboard && node -e "const p=require('./package.json');for(const k of ['react','react-dom','vite','tailwindcss','lucide-react','react-router-dom']){console.log(k+'@'+(p.dependencies[k]||p.devDependencies[k]))}")
# Expected: no output (identical versions)
```

---

### Shared Pattern 3: shadcn preset verbatim inheritance

**Source:** `integrations/system-health-dashboard/components.json` (22 lines, all 22 verbatim) + `tailwind.config.ts` (lines 1-79) + `src/index.css` (lines 46-91 = the CSS-variable block)

**Apply to:** every component file under `src/components/ui/` + every place a Tailwind class is used.

**The 15-file shadcn primitive list** (mandatory copy from dashboard's `src/components/ui/`):

`button`, `card`, `badge`, `input`, `dialog`, `tooltip`, `scroll-area`, `separator`, `tabs`, `select`, `checkbox`, `collapsible`, `progress`, `accordion` (NEW — not in dashboard, run `npx shadcn add accordion`), `alert`

**Anti-pattern (RESEARCH.md "Anti-Patterns to Avoid" lines 504-505):** Do NOT wrap shadcn primitives in viewer-themed variants. No `<ViewerButton>`, no `<UnifiedCard>`. The dashboard preset IS the viewer preset.

**Verification gate** (planner adds this to Wave 0 task):

```bash
# Verify viewer's components.json matches dashboard's verbatim
diff integrations/unified-viewer/components.json integrations/system-health-dashboard/components.json
# Expected: no output
# Same for tailwind.config.ts:
diff integrations/unified-viewer/tailwind.config.ts integrations/system-health-dashboard/tailwind.config.ts
# Expected: no output
```

---

### Shared Pattern 4: System-keyed state isolation (`key={system}` + TanStack queryKey)

**Source:** RESEARCH.md Pattern 1 (lines 367-384) + Pattern 2 (lines 394-408)

**Apply to:** every component that mounts under `/viewer/:system` + every `useQuery` call.

**Rule 1 (component remount):** every child of `<UnifiedViewer>` must be mounted via `<ViewerCore key={system}>`. Never key on a static string.

**Rule 2 (TanStack Query):** every `useQuery` must have `queryKey: [<dataset>, system, ...rest]` so the cache partitions per system.

**Anti-pattern (RESEARCH.md Pitfall 2 lines 530-534):** sharing a single ApiClient instance across system switches → ghost edges + stale selection.

**Verification gate (component test):** `src/routes/UnifiedViewer.test.tsx` must assert that switching `system` prop unmounts and re-mounts the entire subtree (use `@testing-library/react`'s `rerender` + DOM ref check).

---

### Shared Pattern 5: `OkmRcaClient` placement is outside `/api/v1/*`

**Source:** RESEARCH.md §Summary (lines 113-117 — the "two corrections to CONTEXT.md" paragraph)

**Apply to:** `src/api/OkmRcaClient.ts` (the file itself) + the planner's mental model of which client an entity-detail panel calls.

**The split:** keep `ApiClient` PURE — `/api/v1/*` canonical + `/api/coding/*` typed views only. C-specific RCA endpoints (`/api/okm/rca/*` + SSE) live in `OkmRcaClient` and are instantiated only when `system === 'cap'`.

**Why separate (RESEARCH.md):** "the RCA endpoints live at `/api/okm/rca/*`, NOT inside the km-core canonical `/api/v1/*` surface ... this means the RCA panel needs a system-specific extension to the ApiClient — it's NOT a regression of D-45-02's 'REST contract reads only' principle, but the planner must surface the per-system endpoint extension to the operator."

**Anti-pattern:** adding RCA methods to `ApiClient`. This pollutes the canonical-API surface with system-specific endpoints — the planner must reject this even if it shortens the import count by one line.

---

### Shared Pattern 6: Icon-only buttons MUST have aria-label + Tooltip

**Source:** UI-SPEC §Icon-only controls (lines 209-220) — accessibility contract, NON-NEGOTIABLE per the ui-checker remediation in UI-SPEC frontmatter `verdict`

**Apply to:** every icon-only button across the viewer (7 specific controls listed in UI-SPEC table).

**Required 7 controls + aria-label + tooltip strings (PORT VERBATIM from UI-SPEC §Icon-only controls):**

| Control | `aria-label` | Tooltip text |
|---|---|---|
| Zoom-in | `Zoom in` | `Zoom in` |
| Zoom-out | `Zoom out` | `Zoom out` |
| Fit-to-view | `Fit graph to view` | `Fit to view` |
| Theme toggle | `Toggle theme` | `Light / Dark` (state-dependent) |
| Keyboard help (`?`) | `Show keyboard shortcuts` | `Keyboard shortcuts (?)` |
| Mobile filter toggle | `Show filters` / `Hide filters` (state-dependent) | matches `aria-label` |
| Markdown history-nav back/forward | `Previous viewed entity` / `Next viewed entity` | matches `aria-label` |

**Implementation: route ALL icon-only buttons through `IconButton.tsx`** (analog excerpt above). Do not allow direct `<Button size="icon">` without aria-label in PR review.

**Test:** `src/components/IconButton.a11y.test.tsx` must use `getByRole('button', { name: ... })` to confirm each of the 7 aria-labels resolves correctly.

---

## No Analog Found

Files with no close match in the codebase — planner should derive these from RESEARCH.md / UI-SPEC.md patterns:

| File | Role | Why no analog | Source for derivation |
|---|---|---|---|
| `vitest.config.ts` | config | Dashboard has no vitest config (uses Jest at `tests/integration/`) | Standard Vitest + Vite alignment: `import { defineConfig } from 'vitest/config'` + reuse vite alias |
| `.env.example` | config | New env var contract (D-45-02) — no existing example | D-45-02 lists 3 env vars verbatim: `VITE_BACKEND_CODING_URL`, `VITE_BACKEND_OKB_URL`, `VITE_BACKEND_CAP_URL` |
| `src/config/theme.ts` | utility | Dashboard has no extracted theme hook (theme toggle is inline) | UI-SPEC §Design System "Theming" row + `localStorage('viewer-theme')` + `.dark` class on `<html>` |
| `src/routes/UnknownSystem.tsx` | route | Dashboard has no 404 page | UI-SPEC §Routing row 5 — render 3 valid system Links |
| `src/graph/useGraphData.ts` | utility | No `useQuery` analog in repo (react-query is new) | RESEARCH.md Pattern 2 (lines 394-408) — TanStack Query keyed by `[dataset, system]` |
| **External (rapid-automations repo):** VOKB `RcaOperationsPanel.tsx` source | — | Workspace does not contain `_work/rapid-automations/` | Planner fetches from rapid-automations at scaffold time; UI-SPEC §Reference Port-Specs RCA panel table (lines 396-405) captures structural anchors with line numbers |

---

## Metadata

- **Analog search scope:**
  - `integrations/system-health-dashboard/` (full tree — `src/`, configs, tests)
  - `integrations/memory-visualizer/` (VKB — full tree)
  - `_work/rapid-automations/.../viewer/` (VOKB) — **ABSENT from workspace**; structural references taken from UI-SPEC port-spec table + RESEARCH.md line citations
  - `lib/km-core/src/api/handlers/`, `lib/km-core/src/adapters/`, `lib/km-core/src/ontology/`
  - `tests/integration/typed-views.test.js`, `tests/e2e/dashboard/`
- **Files scanned (this session):**
  - dashboard: `package.json`, `tsconfig.json`, `vite.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, `components.json`, `eslint.config.mjs`, `src/{main,App}.tsx`, `src/index.css`, `src/lib/{utils,config}.ts`, `src/store/{index.ts, slices/{healthStatusSlice,ukbSlice}.ts, middleware/apiMiddleware.ts}`, `src/components/{system-health-dashboard,nav-bar,markdown-text}.tsx`, `src/components/ui/{button,badge,card}.tsx`, `src/pages/digests.tsx`
  - VKB: `package.json`, `src/components/{MarkdownViewer,Filters/SearchFilter,Filters/TypeFilters}.tsx`
  - km-core: `lib/km-core/src/api/handlers/ontology.ts`, `lib/km-core/src/adapters/observation-view.ts` (LegacyDigest/LegacyInsight section)
  - tests: `tests/integration/typed-views.test.js`, `tests/e2e/dashboard/{playwright.config.ts, workflow-graph-colors.spec.ts}`
- **Pattern extraction date:** 2026-06-07
- **Key insight surfaced for planner:** VKB's MarkdownViewer renders as a **modal** (`fixed inset-0 bg-black bg-opacity-50`). UI-SPEC mandates an **embedded side panel** (right rail). The port MUST drop the modal wrapper while keeping the internal content + history-nav (lines 156-216). This is the single most error-prone substitution in the MarkdownViewer port.
