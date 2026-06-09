# Phase 55: Unified Viewer Feature Parity with VOKB — Pattern Map

**Mapped:** 2026-06-09
**Files analyzed:** 31 (18 new + 7 extended + 5 backend + 1 config edit)
**Analogs found:** 27 / 31

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `integrations/unified-viewer/src/config/system-endpoints.ts` (EDIT) | config | const-export | self (Phase 45 file — `okb`/`cap` lines edited) | exact (self-edit) |
| `integrations/unified-viewer/src/panels/StatsBar.tsx` (NEW) | header strip | request-response + SSE | `okbClient.ts:35-45` (OkbStats interface) + dashboard `healthRefreshMiddleware.ts:102-144` (SSE pattern) | role-match (synthesized) |
| `integrations/unified-viewer/src/panels/filters/LayerFilter.tsx` (NEW) | filter | store-mutating + derived counts | `_work/.../viewer/src/components/Filters/LayerFilter.tsx` | exact |
| `integrations/unified-viewer/src/panels/filters/DomainFilter.tsx` (NEW) | filter | store-mutating + derived counts | `_work/.../viewer/src/components/Filters/DomainFilter.tsx` | exact |
| `integrations/unified-viewer/src/panels/filters/OntologyFilter.tsx` (NEW) | filter | store-mutating + derived counts | `_work/.../viewer/src/components/Filters/OntologyFilter.tsx` | exact |
| `integrations/unified-viewer/src/panels/filters/GraphToggles.tsx` (NEW) | toggle group | store-mutating | `_work/.../viewer/src/components/Filters/LegendPanel.tsx:14-80` (toggle half only) | exact |
| `integrations/unified-viewer/src/panels/TrendingPanel.tsx` (NEW) | sidebar list | request-response | `_work/.../viewer/src/components/KnowledgeGraph/TrendingPanel.tsx` | exact |
| `integrations/unified-viewer/src/panels/LegendPanel.tsx` (NEW) | static reference | read-only render | `_work/.../viewer/src/components/Filters/LegendPanel.tsx:82-184` (legend half only) | exact |
| `integrations/unified-viewer/src/panels/EntityDetailPanel.tsx` (EXTEND) | side panel + sub-tabs | request-response + derive | `_work/.../viewer/src/components/KnowledgeGraph/NodeDetails.tsx` (sub-tab structure :893-935) + self (existing flat panel keeps as Default tab) | role-match (extension) |
| `integrations/unified-viewer/src/panels/EntityIdentityHeader.tsx` (NEW) | shared header chip block | read-only render | existing `EntityDetailPanel.tsx:75-86` header + `NodeDetails.tsx` Identity section | exact (refactor) |
| `integrations/unified-viewer/src/panels/OccurrenceHistorySidebar.tsx` (NEW) | sidebar list | read-only render | `_work/.../viewer/src/components/KnowledgeGraph/HistorySidebar.tsx` | exact |
| `integrations/unified-viewer/src/panels/MarkdownViewerPanel.tsx` (EXTEND) | side panel | request-response | self (Phase 45 file — extend header + width) | exact (self-extend) |
| `integrations/unified-viewer/src/panels/SidePanel.tsx` (EDIT) | tab map | store-mutating | self (drop `rca` tab; harmonize width) | exact (self-edit) |
| `integrations/unified-viewer/src/panels/NavBar.tsx` (EXTEND) | sticky nav | store-mutating | self (add Mode `<ToggleGroup>` + ETM-tail trigger) | exact (self-extend) |
| `integrations/unified-viewer/src/panels/RcaOpsPanel.tsx` (DELETE) | n/a | n/a | n/a | n/a |
| `integrations/unified-viewer/src/routes/UnifiedViewer.tsx` (EXTEND) | route shell | host (compose) | self (add StatsBar, LslTimelineStrip, WorkflowStatusPanel, mode state) | exact (self-extend) |
| `integrations/unified-viewer/src/routes/IssueTriageView.tsx` (NEW) | mode B view | request-response + BFS derive | `_work/.../viewer/src/components/KnowledgeGraph/IssueTriage.tsx` | exact |
| `integrations/unified-viewer/src/panels/coding/HierarchyNavigator.tsx` (NEW) | coding-only tree | store-mutating + derive | NO VOKB analog → uses unified-viewer's `FilterRail`-section pattern + tree from `entities.metadata.parent` | role-match (synthesized) |
| `integrations/unified-viewer/src/panels/coding/LslTimelineStrip.tsx` (NEW) | coding-only horizontal strip | request-response | NO VOKB analog → closest is dashboard `batch-progress.tsx` + obs-api LSL endpoints (NEW) | role-match (synthesized) |
| `integrations/unified-viewer/src/panels/coding/EtmTailSheet.tsx` (NEW) | coding-only SSE sheet | SSE consumer | dashboard `healthRefreshMiddleware.ts:102-144` (SSE EventSource pattern w/ retry) | role-match |
| `integrations/unified-viewer/src/panels/coding/WorkflowStatusPanel.tsx` (NEW) | coding-only inline panel | request-response (poll) | `integrations/system-health-dashboard/src/components/ukb-workflow-modal.tsx` (UkbOps reference) | role-match |
| `integrations/unified-viewer/src/graph/SigmaCanvas.tsx` (EXTEND) | renderer host | host | self (add halo + dashed border via node program) | exact (self-extend) |
| `integrations/unified-viewer/src/graph/node-renderer.ts` (EXTEND) | renderer | pure derivation | self (add `borderStyle`/`pulseRule` table) | exact (self-extend) |
| `integrations/unified-viewer/src/graph/color-fallback.ts` (EXTEND) | renderer fallback | pure derivation | self (add `shapeFallback`/`borderStyleFallback`/`pulseRuleFallback`) | exact (self-extend) |
| `integrations/unified-viewer/src/graph/vokb-palette.ts` (NEW) | const module | read-only export | `_work/.../viewer/src/components/KnowledgeGraph/GraphVisualization.tsx:31-176` (semantic palette) + `NodeDetails.tsx:94-128` (EDGE_LABELS/EDGE_DOT_COLORS) | exact |
| `integrations/unified-viewer/src/lib-domain/evidence-types.ts` (NEW) | const module | read-only export | `_work/.../viewer/src/components/KnowledgeGraph/NodeDetails.tsx:243-296` (EVIDENCE_TYPE_ICONS, EVIDENCE_TYPE_LABELS, evidenceAgeBadge) + `IssueTriage.tsx:21-53` (verbatim dup — extract to shared module) | exact |
| `integrations/unified-viewer/src/store/viewer-store.ts` (EXTEND) | Zustand store | store-mutating | self + `_work/.../viewer/src/store/slices/filtersSlice` (Redux shape → translate to Zustand slices) | role-match (extension) |
| `integrations/unified-viewer/src/components/KeyboardHelpDialog.tsx` (EXTEND) | help dialog | read-only render | self (add 6 new shortcut rows) | exact (self-extend) |
| `lib/km-core/src/api/handlers/ontology.ts` (EXTEND) | API handler | request-response | self (extend `DisplayHint` schema with `borderStyle`/`pulseRule`) | exact (self-extend) |
| `lib/km-core/src/ontology/display-overlay.ts` (EXTEND) | overlay loader | file I/O | self (add Zod validation for new fields) | exact (self-extend) |
| `scripts/observations-api-server.mjs` (EXTEND) | obs-api routes | SSE + request-response | self (add `/api/coding/observations/stream` SSE + `/api/coding/lsl/sessions` + `/api/v1/stats` + `/api/v1/trends?top=N` + `/api/v1/entities/:id/confidence`) | exact (self-extend) |
| `_work/.../operational-knowledge-management/src/api/routes.ts` (potential EXTEND) | OKM API | request-response | self (D-55-01a adapter check; may add `/api/v1/trends` parallel) | exact (self-extend) |
| `coding/.data/ontologies/coding.display.json` (NEW) | overlay JSON | read-only export | UI-SPEC §14 table | role-match (config) |
| `tests/e2e/unified-viewer/55-*.spec.ts` (NEW) | E2E test | gsd-browser | existing `tests/e2e/unified-viewer/*.spec.ts` (Phase 45) | exact |

---

## Pattern Assignments

### `integrations/unified-viewer/src/config/system-endpoints.ts` (EDIT — drop `cap`, fix `okb`)

**Analog:** self (Phase 45 file at `integrations/unified-viewer/src/config/system-endpoints.ts:12-31`).

**Three-line edit pattern** (D-55-01a + D-55-01b):

```typescript
// BEFORE (lines 12-26)
export type System = 'coding' | 'okb' | 'cap'
export const VALID_SYSTEMS: readonly System[] = ['coding', 'okb', 'cap'] as const
export const SYSTEM_ENDPOINTS: Record<System, string> = {
  coding: import.meta.env.VITE_BACKEND_CODING_URL ?? 'http://localhost:12436',
  okb:    import.meta.env.VITE_BACKEND_OKB_URL    ?? 'http://localhost:3848',
  cap:    import.meta.env.VITE_BACKEND_CAP_URL    ?? 'https://okm.cc.bmwgroup.net',  // ← hallucinated
} as const
export const SYSTEM_LABELS: Record<System, string> = {
  coding: 'Coding', okb: 'OKB', cap: 'CAP',
} as const

// AFTER (Phase 55)
export type System = 'coding' | 'okb'
export const VALID_SYSTEMS: readonly System[] = ['coding', 'okb'] as const
export const SYSTEM_ENDPOINTS: Record<System, string> = {
  coding: import.meta.env.VITE_BACKEND_CODING_URL ?? 'http://localhost:12436',
  okb:    import.meta.env.VITE_BACKEND_OKB_URL    ?? 'http://localhost:8090',  // ← OKM Express, NOT semantic-analysis
} as const
export const SYSTEM_LABELS: Record<System, string> = {
  coding: 'Coding', okb: 'OKB',
} as const
export function isValidSystem(s: string | undefined): s is System {
  return s === 'coding' || s === 'okb'
}
```

**Executor guidance:**
- Drop `cap` from `System` union, `VALID_SYSTEMS`, `SYSTEM_ENDPOINTS`, `SYSTEM_LABELS`, `isValidSystem`.
- Change `okb` default from `localhost:3848` to `localhost:8090` (OKM Express, per D-55-01a + UI-SPEC §18).
- Drop `VITE_BACKEND_CAP_URL` references throughout the repo.
- Grep gate: `grep -r "cap\b" integrations/unified-viewer/src/` must return only React-component-unrelated hits (the word "capability" etc. is fine, but no `'cap'` literals tied to `System`).
- Forbidden-string grep gate: `grep -r "cc.bmwgroup.net" integrations/unified-viewer/` returns ZERO (D-55-01c).

---

### `integrations/unified-viewer/src/panels/filters/LayerFilter.tsx` (NEW)

**Analog:** `_work/rapid-automations/integrations/operational-knowledge-management/viewer/src/components/Filters/LayerFilter.tsx` (74 lines, full file).

**Imports pattern** (VOKB uses Redux — translate to Zustand):

```typescript
// PORT-SPEC: _work/.../viewer/src/components/Filters/LayerFilter.tsx
// VOKB uses Redux dispatch → translate to Zustand selectors per unified-viewer convention.

import { useState, useMemo } from 'react'
import { useViewerStore } from '@/store/viewer-store'
import { Checkbox } from '@/components/ui/checkbox'  // shadcn (NOT raw <input type=checkbox>)
import { Logger } from '@/lib/logging'
```

**Core pattern** (LayerFilter.tsx:17-72):

```typescript
const LAYERS = [
  { value: 'evidence', label: 'Evidence', colorClass: 'text-blue-600' },
  { value: 'pattern',  label: 'Pattern',  colorClass: 'text-amber-600' },
] as const

export function LayerFilter() {
  const selectedLayers = useViewerStore(s => s.selectedLayers)
  const toggleLayer = useViewerStore(s => s.toggleLayer)
  const entities = useViewerStore(s => s.entities)  // or via useGraphData
  const [collapsed, setCollapsed] = useState(false)

  // count: derived per-frame; empty selection = "all visible" (VOKB convention)
  const counts = useMemo(() => {
    const map: Record<string, number> = {}
    for (const e of entities) {
      const layer = e.layer || 'evidence'
      map[layer] = (map[layer] || 0) + 1
    }
    return map
  }, [entities])

  const isSelected = (layer: string) =>
    selectedLayers.length === 0 || selectedLayers.includes(layer)

  // ... <Checkbox> per LAYERS row with text-[10px] count badge
}
```

**Executor guidance:**
- VOKB uses raw `<input type="checkbox">`; unified-viewer uses shadcn `<Checkbox>` (per Phase 45 convention — see `FilterRail.tsx:148-159`).
- VOKB's `text-[10px]` count badge styling is preserved verbatim (UI-SPEC §3 micro-type exception).
- Use `Logger.info(Logger.Categories.FILTERS, ...)` for state changes (FilterRail.tsx:155).
- Empty selection = "all visible" — this VOKB semantic MUST hold (UI-SPEC §10 filter composition rules).
- Tailwind shapes: keep `text-xs` for labels, `text-[10px]` for count badges; layer dot colors lift from `vokb-palette.ts`.

---

### `integrations/unified-viewer/src/panels/filters/DomainFilter.tsx` (NEW)

**Analog:** `_work/.../viewer/src/components/Filters/DomainFilter.tsx` (74 lines).

Structurally identical to `LayerFilter.tsx` — same checkbox pattern, same `useMemo` count derivation, same `isSelected` semantic.

**Executor guidance:**
- DOMAINS constant: `[{value:'raas',label:'RaaS'},{value:'kpifw',label:'KPI-FW'},{value:'general',label:'General'}]` (DomainFilter.tsx:12-16).
- VOKB derives `domain` from `entity.domain || 'general'` (line 28).
- Coding-tab degradation per UI-SPEC §7 row 3: if `entity.domain` absent on every entity, render italic "Domain filter not applicable for this system" (do NOT 500, do NOT hide silently).

---

### `integrations/unified-viewer/src/panels/filters/OntologyFilter.tsx` (NEW — replaces Phase 45 flat `ClassList`)

**Analog:** `_work/.../viewer/src/components/Filters/OntologyFilter.tsx` (265 lines, full file).

**Imports + grouping constants** (OntologyFilter.tsx:13-43):

```typescript
// PORT-SPEC: _work/.../viewer/src/components/Filters/OntologyFilter.tsx
// Group constants MUST be parameterized (D-55-02a "OntologyFilter accepts a groupingSchema prop" — UI-SPEC §7 row 4).

interface OntologyGroupSchema {
  upper: { name: string; subgroups: Record<string, ReadonlySet<string>> }
  lower: { name: string; subgroups: Record<string, ReadonlySet<string>> }
}

// VOKB schema (verbatim from OntologyFilter.tsx:14-42)
export const VOKB_SCHEMA: OntologyGroupSchema = {
  upper: { name: 'Upper Ontology', subgroups: {
    'Execution Model': new Set(['Component','DataAsset','Infrastructure','Job','Pipeline','Service','Session','Step']),
    'Failure Model':   new Set(['FailurePattern','Incident','Resolution','RootCause','Symptom']),
  }},
  lower: { name: 'Lower Ontology', subgroups: {
    'RaaS':     new Set(['ArgoWorkflow','DataQualityCheck','RPU','RPUType','RPUVersion','S3DataPath']),
    'KPI-FW':   new Set(['GrafanaDashboard','KPIDefinition','KPIPipeline','MetricsAggregation','SignalExtraction']),
    'Business': new Set(['ActionItem','Decision','DocumentSource','Requirement','Risk']),
  }},
}

// Coding schema (NEW — UI-SPEC §13.1 hierarchy)
export const CODING_SCHEMA: OntologyGroupSchema = {
  upper: { name: 'Hierarchy', subgroups: {
    'L0 — Project':       new Set(['Project']),
    'L1 — Component':     new Set(['Component']),
    'L2 — SubComponent':  new Set(['SubComponent']),
    'L3 — Detail':        new Set(['Detail']),
  }},
  lower: { name: 'Typed Views', subgroups: {
    'LSL Pipeline':  new Set(['Observation','Digest','Insight','LearningArtifact']),
    'Patterns':      new Set(['Pattern','Service','Feature','Contract','RuntimeDiagnostics']),
    'Other':         new Set(['File','System','Knowledge']),
  }},
}
```

**Group-select pattern** (OntologyFilter.tsx:93-105):

```typescript
const selectGroup = useCallback((classes: string[]) => {
  const current = new Set(selectedOntologyClasses)
  for (const cls of classes) current.add(cls)
  setSelectedOntologyClasses(Array.from(current))  // union, not replace
}, [selectedOntologyClasses])

const deselectGroup = useCallback((classes: string[]) => {
  const toRemove = new Set(classes)
  setSelectedOntologyClasses(selectedOntologyClasses.filter(c => !toRemove.has(c)))
}, [selectedOntologyClasses])
```

**Per-class checkbox row** (OntologyFilter.tsx:107-123) — preserve verbatim VOKB micro-type:

```tsx
<label className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 p-1 rounded">
  <Checkbox checked={isSelected(cls)} onCheckedChange={() => toggleOntologyClass(cls)} aria-label={cls} />
  <span className="text-xs text-gray-700 dark:text-gray-300 flex-1">{cls}</span>
  <span className="text-[10px] text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">
    {counts[cls] || 0}
  </span>
</label>
```

**Group-header pattern** with `text-[10px]`/`text-[9px]`/`text-[8px]` disclosure (OntologyFilter.tsx:125-187) — VERBATIM micro-type per UI-SPEC §3.

**Executor guidance:**
- This component REPLACES Phase 45's flat `ClassList` inside `FilterRail.tsx:249-286`. Delete the flat list there; mount the new `OntologyFilter` from `panels/filters/OntologyFilter.tsx` instead.
- VOKB uses Redux selectors — translate to Zustand: `useViewerStore(s => s.selectedClasses)` + `useViewerStore(s => s.toggleClass)`.
- `availableOntologyClasses` in VOKB is derived from the entity payload — keep `UnifiedViewer.tsx:93-101` `classOptions` derivation, pass it down as a prop (or read from store).
- `groupingSchema` prop must default to `VOKB_SCHEMA`; the coding-tab caller passes `CODING_SCHEMA`.
- Catch-all `Other` group catches any class not in known sets — anything unmapped MUST surface, never silently invisible (verbatim VOKB rule, OntologyFilter.tsx:42).
- Per-class count badge `text-[10px]` is a documented micro-type exception (UI-SPEC §3) — DO NOT replace with `text-xs`.
- `all` / `none` per-group select toggles use `text-[9px]` (OntologyFilter.tsx:139-152).

---

### `integrations/unified-viewer/src/panels/filters/GraphToggles.tsx` (NEW)

**Analog:** `_work/.../viewer/src/components/Filters/LegendPanel.tsx:14-80` (the toggle block — NOT the legend body below at :82-184).

**Toggle pattern** (LegendPanel.tsx:14-80):

```tsx
// 4 toggles + 1 nested sub-toggle:
//   Show All Relations
//     └ Labels (visible only when Show All Relations is on)
//   Show Clusters
//     └ italic hint "Halos = connectivity clusters (densely linked groups)"
//   Merged Only
//     └ italic hint "Nodes with content from multiple ingestion runs"
//   Hide Documentation
//     └ italic hint "Hides green business/doc nodes (Decision, Requirement, DocumentSource, etc.)"

export function GraphToggles() {
  const { showClusters, showEdges, showRelationLabels, showMergedOnly, hideDocNodes } =
    useViewerStore(s => s.graphToggles)
  // Each toggle: <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300 cursor-pointer">
  //   <Checkbox checked={X} onCheckedChange={...} className="w-3.5 h-3.5 rounded border-gray-300" />
  //   Show All Relations
  // </label>
  // Nested hint: <p className="text-[10px] text-gray-400 dark:text-gray-500 leading-tight ml-6">
}
```

**Executor guidance:**
- Copy each label string VERBATIM from LegendPanel.tsx (Copywriting Contract UI-SPEC §5 locked).
- Nested "Labels" toggle for `Show All Relations` (LegendPanel.tsx:27-37) appears ONLY when parent toggle is on.
- Italic hint text uses `text-[10px] ml-6 leading-tight` — UI-SPEC §3 micro-type exception preserved.
- Translate Redux `dispatch(toggleShowEdges())` → Zustand `useViewerStore(s => s.toggleShowEdges)()`.

---

### `integrations/unified-viewer/src/panels/TrendingPanel.tsx` (NEW)

**Analog:** `_work/.../viewer/src/components/KnowledgeGraph/TrendingPanel.tsx` (103 lines).

**Score-color helpers** (TrendingPanel.tsx:14-24):

```typescript
function scoreColor(score: number): string {
  if (score > 1.5) return 'bg-green-500'
  if (score > 1.0) return 'bg-amber-400'
  return 'bg-gray-300'
}
function scoreBadgeClass(score: number): string {
  if (score > 1.5) return 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
  if (score > 1.0) return 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300'
  return 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
}
```

**Row layout** (TrendingPanel.tsx:64-96) — dot + name + score badge + `7d/30d/90d` trend numbers, all `tabular-nums`.

**Empty state copy** (TrendingPanel.tsx:50-56) — VERBATIM per UI-SPEC §5 (substitute "RCA analyses" → "analyses" for coding-tab compatibility, see UI-SPEC §5 row "Trending Patterns — empty body").

**Data fetch:**
- Endpoint `GET /api/v1/trends?top=20` (UI-SPEC §18 row 5 — NEW endpoint required on coding side).
- Response shape: `TrendingPattern[]` per `okbClient.ts:68-78`:
  ```typescript
  interface TrendingPattern {
    nodeId: string
    entity: { id: string; name: string; entityType: string; description?: string }
    trendScore: number
    trends: { last7Days: number; last30Days: number; last90Days: number }
  }
  ```
- Use TanStack Query (per Phase 45 convention — see `MarkdownViewerPanel.tsx:27` `useQuery`); poll every 60s per UI-SPEC §18.

**Executor guidance:**
- Click handler `setSelectedNodeId(pattern.nodeId)` triggers `EntityDetailPanel` update + Sigma node highlight.
- If currently in Triage mode, switch back to KG mode first (UI-SPEC §10 click semantics row 7).
- Wrap row buttons with `Logger.info(Logger.Categories.PANELS, 'Trending → nodeId')`.

---

### `integrations/unified-viewer/src/panels/LegendPanel.tsx` (NEW)

**Analog:** `_work/.../viewer/src/components/Filters/LegendPanel.tsx:82-184` (the `<details>` reference block beneath toggles).

**Structure pattern** (LegendPanel.tsx:82-184):

```tsx
<details className="group">
  <summary className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide cursor-pointer select-none">
    Legend
  </summary>
  <div className="mt-1.5 space-y-2">
    <Section title="Domains"> {/* shape swatches: SVG circle/diamond/square */} </Section>
    <Section title="Layers"> {/* color dots: <div className="w-3 h-3 rounded-full" style={{backgroundColor: ...}}/> */} </Section>
    <Section title="Source"> {/* stroke swatches: SVG circle with strokeWidth + dashed */} </Section>
    <Section title="Relationships"> {/* line samples: SVG <line> with stroke + strokeDasharray */} </Section>
  </div>
</details>
```

**Executor guidance:**
- All swatch colors MUST come from `vokb-palette.ts` (NEW) — never inline. Source-of-truth dependency per UI-SPEC §4 "Palette source-of-truth file".
- VOKB uses inline `style={{ backgroundColor: '#3b82f6' }}` for dot fills (LegendPanel.tsx:113); translate to Tailwind `bg-blue-500` per `vokb-palette.ts` LAYER_BADGE_CLASS map.
- Phase 55 keeps the `<details>` collapsible per UI-SPEC §7 row 12 "Collapsed by default".

---

### `integrations/unified-viewer/src/panels/StatsBar.tsx` (NEW)

**Analog:** synthesized — no VOKB component exists. Schema source = `okbClient.ts:35-45` (`OkbStats` interface). SSE state source = dashboard `healthRefreshMiddleware.ts:102-144`.

**Data shape** (okbClient.ts:35-45):

```typescript
interface ViewerStats {
  nodeCount: number; edgeCount: number; evidenceCount: number;
  patternCount: number; orphanCount: number; componentCount: number;
  connectivity: number;          // 0-1 fraction, render as percent
  lastUpdated: string;            // ISO timestamp
  activeSnapshot: { hash: string; message: string; date: string } | null;
}
```

**SSE-with-polling-fallback pattern** (healthRefreshMiddleware.ts:102-144):

```typescript
// Connect SSE on mount
const sse = new EventSource(`${apiClient.base}/api/v1/stream`)
sse.onopen = () => { setIsLive(true); Logger.info(Logger.Categories.NETWORK, 'SSE connection established') }
sse.onmessage = (event) => {
  try {
    const stats = JSON.parse(event.data) as ViewerStats
    setStats(stats); setLastUpdated(new Date())
  } catch {}
}
sse.onerror = () => {
  setIsLive(false)
  sse.close()
  // exponential backoff: 1s, 2s, 4s, 8s, 16s capped
  setTimeout(() => connectSSE(), nextBackoffMs())
}
// Polling fallback every 30s when isLive === false
```

**Stats bar layout** (UI-SPEC §6 + §7 row 1):

```tsx
<div className="sticky top-16 z-19 h-10 bg-card border-b border-border flex items-center px-6 gap-6 text-xs">
  <Metric label="📊 nodes" value={stats.nodeCount} />
  <span>·</span>
  <Metric label="edges" value={stats.edgeCount} />
  {/* ... evidence, patterns, orphans, connectivity% ... */}
  <div className="ml-auto flex items-center gap-2">
    {isLive
      ? <><div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" /><span>LIVE</span></>
      : <><div className="w-2 h-2 bg-muted-foreground rounded-full" /><span>Polling</span></>
    }
  </div>
</div>
```

**Executor guidance:**
- `animate-pulse` MUST use `bg-emerald-500` (fixed semantic-green, UI-SPEC §3.5 carve-out item 5 — NOT the primary accent token).
- All numeric metrics MUST use `tabular-nums` className (UI-SPEC §3).
- Stats endpoint: per UI-SPEC §18 row 1, planner composes from `/api/v1/graph/connectivity` + `/api/v1/graph/orphans` + `/api/v1/entities?count=true` on frontend — OR adds single `/api/v1/stats` route in `scripts/observations-api-server.mjs` (see backend pattern below).
- Use shadcn `<Tooltip>` on each metric (UI-SPEC §10 hover semantics) and shadcn `<Popover>` on the LIVE dot.
- Skeleton state: render `—` placeholders for numbers, "Connecting…" for LIVE label (UI-SPEC §16 row 1).

---

### `integrations/unified-viewer/src/routes/IssueTriageView.tsx` (NEW)

**Analog:** `_work/.../viewer/src/components/KnowledgeGraph/IssueTriage.tsx` (530 lines, full file).

**RCA edge types** (IssueTriage.tsx:64-68) — LOCKED set:

```typescript
const RCA_EDGE_TYPES = new Set([
  'HAS_SYMPTOM', 'HAS_ROOT_CAUSE', 'CAUSED', 'CAUSED_BY',
  'INDICATES', 'MITIGATED_BY', 'MITIGATES', 'ADDRESSES',
  'MATCHES', 'DERIVED_FROM', 'AFFECTS', 'APPLIED_TO',
])
```

**Section metadata** (IssueTriage.tsx:71-81) — colors + icons:

```typescript
const SECTION_ORDER = ['Symptom','FailurePattern','RootCause','Resolution','Risk','Decision'] as const
const SECTION_META = {
  Symptom:        { label: 'Symptoms',         color: '#ef4444', icon: '🔴' },
  FailurePattern: { label: 'Failure Patterns', color: '#f59e0b', icon: '🟡' },
  RootCause:      { label: 'Root Causes',      color: '#8b5cf6', icon: '🟣' },
  Resolution:     { label: 'Resolutions',      color: '#10b981', icon: '🟢' },
  Risk:           { label: 'Risks',            color: '#f97316', icon: '🟠' },
  Decision:       { label: 'Decisions',        color: '#3b82f6', icon: '🔵' },
}
```

**BFS pattern** (IssueTriage.tsx:97-182) — adjacency build + 2-hop walk filtered by RCA_EDGE_TYPES:

```typescript
const adjacency = useMemo(() => {
  const adj: Record<string, Array<{ neighborId: string; edgeType: string; direction: 'outgoing' | 'incoming' }>> = {}
  for (const e of relations) {
    if (!adj[e.from]) adj[e.from] = []
    if (!adj[e.to]) adj[e.to] = []
    adj[e.from].push({ neighborId: e.to, edgeType: e.type, direction: 'outgoing' })
    adj[e.to].push({ neighborId: e.from, edgeType: e.type, direction: 'incoming' })
  }
  return adj
}, [relations])

const rcaChain = useMemo((): Map<SectionType, ChainItem[]> => {
  const sections = new Map<SectionType, ChainItem[]>()
  if (!selectedKey) return sections
  const visited = new Set<string>([selectedKey])
  const queue = [{ nodeKey: selectedKey, depth: 0 }]
  while (queue.length > 0) {
    const { nodeKey, depth } = queue.shift()!
    if (depth >= 2) continue
    for (const { neighborId, edgeType, direction } of (adjacency[nodeKey] || [])) {
      if (visited.has(neighborId)) continue
      if (depth > 0 && !RCA_EDGE_TYPES.has(edgeType)) continue
      const neighbor = entityByKey.get(neighborId)
      if (!neighbor) continue
      visited.add(neighborId)
      const section = SECTION_ORDER.find(s => (neighbor.entityType||'').toLowerCase() === s.toLowerCase())
      if (section) {
        if (!sections.has(section)) sections.set(section, [])
        sections.get(section)!.push({ entity: neighbor, edgeType, direction })
      }
      if (section === 'RootCause' || section === 'Symptom' || section === 'FailurePattern') {
        queue.push({ nodeKey: neighborId, depth: depth + 1 })
      }
    }
  }
  return sections
}, [selectedKey, adjacency, entityByKey])
```

**Layout pattern:**
- Left pane `w-[380px]` — incident list + search input + trending strip.
- Right pane `flex-1` — RCA chain (6 sections per SECTION_ORDER) + Sources & Evidence section.
- Click incident → `setIncidentKey(key)` triggers BFS.
- Click chain item → "View in Graph" returns to KG mode + selects entity.

**Executor guidance:**
- VOKB uses Redux + local component state; translate to Zustand store slice + local `useState` for `selectedKey` and `searchTerm`.
- Triage mode toggles via NavBar `<ToggleGroup>` (UI-SPEC §9); URL `?mode=triage` persists per UI-SPEC §9.
- Mode-switch HIDDEN entirely when entity dataset lacks `Incident`/`FailureIncident` types (UI-SPEC §9). Use `entities.some(e => /incident|failureincident/i.test(e.entityType))` predicate.
- "View in Graph" CTA copy locked per UI-SPEC §5: `View in Graph`.
- Evidence section reuses `lib-domain/evidence-types.ts` (NEW shared module — see below) — DO NOT duplicate `EVIDENCE_TYPE_ICONS`/`EVIDENCE_TYPE_LABELS`.

---

### `integrations/unified-viewer/src/panels/EntityDetailPanel.tsx` (EXTEND — adds sub-tabs)

**Analog:**
1. Self at `integrations/unified-viewer/src/panels/EntityDetailPanel.tsx` (existing Phase 45 flat panel) — keep current content as the **Default** sub-tab.
2. Sub-tab pill bar from VOKB `NodeDetails.tsx:893-935`.
3. Relationships breakdown from `NodeDetails.tsx:349-380` (`groupedRelations` useMemo) + `:94-128` (EDGE_LABELS + EDGE_DOT_COLORS) + `:649-672` (RELATION_COLORS).
4. Sources & Evidence shared with `lib-domain/evidence-types.ts`.
5. Occurrence History from `NodeDetails.tsx` occurrences block (and HistorySidebar.tsx pattern).

**Sub-tab pill bar pattern** (NodeDetails.tsx:893-935):

```tsx
// PORT-SPEC: NodeDetails.tsx:893-935 (verbatim micro-type)
const [descViewMode, setDescViewMode] = useState<'default'|'evolution'|'confidence'|'timeline'>('default')

// Visibility predicate (UI-SPEC §8 — verbatim):
const showEvolution = (entity.metadata?.descriptionSegments?.length ?? 0) > 0
  || (entity.metadata?.occurrences?.length ?? 0) > 1
  || (entity.metadata?.provenance?.confirmationCount ?? 0) > 0
const showTimeline = !!entity.metadata?.provenance?.createdBy
  || (entity.metadata?.descriptionSegments?.length ?? 0) > 0
  || (entity.metadata?.occurrences?.length ?? 0) > 0
const showConfidence = true  // always — falls back to client heuristic

// Pill bar
<div className="flex gap-1 mb-2" role="tablist">
  <button
    role="tab" aria-selected={descViewMode==='default'}
    onClick={() => setDescViewMode('default')}
    className={`px-2 py-0.5 text-[10px] rounded transition-colors ${descViewMode==='default'
      ? 'bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-100 font-semibold'
      : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
    Default
  </button>
  {showEvolution && <button role="tab" /* same shape, blue when active */>Evolution</button>}
  {showConfidence && <button role="tab" /* same shape, green when active */>Confidence</button>}
  {showTimeline && <button role="tab" /* same shape, indigo when active */>Timeline</button>}
</div>
```

**Relationships grouping** (NodeDetails.tsx:349-380):

```typescript
const { groupedRelations } = useMemo(() => {
  if (!selectedKey) return { groupedRelations: new Map() }
  const related = relations.filter(r => r.from === selectedKey || r.to === selectedKey)
  // Dedup by (type, source, target)
  const seen = new Set<string>()
  const deduped = related.filter(r => {
    const k = `${r.type}|${r.from}|${r.to}`
    if (seen.has(k)) return false
    seen.add(k); return true
  })
  const grouped = new Map<string, { edges: Relation[]; direction: 'outgoing'|'incoming' }[]>()
  for (const edge of deduped) {
    if (!grouped.has(edge.type)) grouped.set(edge.type, [])
    grouped.get(edge.type)!.push({
      edges: [edge],
      direction: edge.from === selectedKey ? 'outgoing' : 'incoming',
    })
  }
  return { groupedRelations: grouped }
}, [selectedKey, relations])
```

**Executor guidance:**
- Keep the existing `EntityDetailPanel.tsx` Sections (Description/Identity/Provenance/Neighbors/Raw) intact as the **Default** sub-tab's content.
- Add the pill bar ABOVE the existing content area when entity has `metadata.descriptionSegments` OR merge history (visibility predicate locked in UI-SPEC §8).
- Sub-tab state is LOCAL to component, NOT in Zustand (UI-SPEC §8 "Sub-tab state is local to the SidePanel").
- Selecting a different entity resets sub-tab to `Default` (UI-SPEC §8).
- Confidence sub-tab fetches lazily via `GET /api/v1/entities/:id/confidence` (UI-SPEC §18 row 8); on 404/error, fall back to client heuristic per `NodeDetails.tsx:165-213` (computeSegmentConfidence) — do NOT 500.
- Relationships breakdown REPLACES Phase 45's flat `Neighbors` section. Use `EDGE_LABELS` + `EDGE_DOT_COLORS` from `lib-domain/evidence-types.ts` (or a new shared `edge-labels.ts`).
- Tab triggers must be `role="tab"` inside `role="tablist"` per UI-SPEC §15.
- Keyboard shortcuts `1`/`2`/`3`/`4` cycle sub-tabs (UI-SPEC §10) — register via `useKeyboardShortcuts`.

---

### `integrations/unified-viewer/src/panels/EntityIdentityHeader.tsx` (NEW)

**Analog:** existing `EntityDetailPanel.tsx:75-86` (header) + Identity section `:96-106`. Extract to shared component.

```tsx
// PATTERN SOURCE: existing EntityDetailPanel.tsx:75-86 + :96-106
export function EntityIdentityHeader({ entity, theme }: Props) {
  const className = entity.ontologyClass ?? 'Unclassified'
  const borderColor = classColor(className, theme)
  return (
    <header className="space-y-2">
      <h2 className="text-xl font-semibold text-foreground">{entity.name}</h2>
      <Badge variant="outline" style={{ borderColor }}>{className}</Badge>
      <div className="text-xs text-muted-foreground flex gap-3 tabular-nums">
        <span>L{entity.level ?? '—'}</span>
        <span>parent: {entity.parent ?? '—'}</span>
        <span>created {entity.createdAt ?? '—'}</span>
        <span>last confirmed {entity.lastConfirmedAt ?? '—'}</span>
      </div>
    </header>
  )
}
```

**Executor guidance:**
- Used by both `EntityDetailPanel` (existing) and `MarkdownViewerPanel` (extension).
- Width harmonization per UI-SPEC §11: both panels `w-96` default, both expand to `w-[30rem]` for the same trigger predicates.

---

### `integrations/unified-viewer/src/panels/OccurrenceHistorySidebar.tsx` (NEW)

**Analog:** `_work/.../viewer/src/components/KnowledgeGraph/HistorySidebar.tsx` (145 lines, full file).

**Guard pattern** (HistorySidebar.tsx:24):

```typescript
// Only render when no node is selected
const selectedNodeId = useViewerStore(s => s.selectedNodeId)
if (selectedNodeId) return null
```

**Sort + cap** (HistorySidebar.tsx:27-35):

```typescript
const historyItems = useMemo(() => {
  return [...entities]
    .sort((a, b) => {
      const ta = a.updatedAt || a.createdAt || ''
      const tb = b.updatedAt || b.createdAt || ''
      return tb.localeCompare(ta)
    })
    .slice(0, 50)  // 50-item cap
}, [entities])
```

**Relative timestamp** (HistorySidebar.tsx:45-68) — `Just now`/`Xm ago`/`Xh ago`/`Xd ago` then absolute date.

**Layer-badge classes** (HistorySidebar.tsx:70-74) — lift to `vokb-palette.ts` `LAYER_BADGE_CLASS`.

**Executor guidance:**
- VOKB renders this as a `w-80` panel in the right gutter; on unified-viewer it's shown WITHIN the SidePanel area when `selectedNodeId === null` (UI-SPEC §7 row 11).
- Click handler `setSelectedNodeId(entity.id)` triggers the panel to swap from this sidebar to EntityDetailPanel.

---

### `integrations/unified-viewer/src/panels/MarkdownViewerPanel.tsx` (EXTEND)

**Analog:** self (existing Phase 45 file at `integrations/unified-viewer/src/panels/MarkdownViewerPanel.tsx`).

**Extension:**
- Mount `<EntityIdentityHeader>` ABOVE the markdown body.
- Apply harmonized width predicate (UI-SPEC §11): `w-96` default, `w-[30rem]` when `entity.metadata.markdown_url` exists OR `entity.description.length > 800`.

**Executor guidance:**
- The existing Markdown sanitizer + ReactMarkdown component overrides (Phase 45 Plan 04) are UNCHANGED.
- Width transition uses `transition-[width] duration-150` (UI-SPEC §11 "150ms transition-[width]").

---

### `integrations/unified-viewer/src/panels/SidePanel.tsx` (EDIT — drop RCA tab)

**Analog:** self (existing Phase 45 file at `integrations/unified-viewer/src/panels/SidePanel.tsx:1-83`).

**Edit pattern:**

```typescript
// BEFORE (line 21)
type TabValue = 'entity' | 'markdown' | 'rca'
// AFTER
type TabValue = 'entity' | 'markdown'

// DELETE lines 27 (showRca) and the entire <TabsTrigger value="rca"> block + <TabsContent value="rca">
// DELETE import of RcaOpsPanel (line 13)
```

**Width harmonization** per UI-SPEC §11:

```typescript
const widthClass = (() => {
  if (tab === 'markdown' && entity?.markdown_url) return 'w-[30rem]'
  if (entity?.description && entity.description.length > 800) return 'w-[30rem]'
  if (tab === 'entity' && ['evolution','timeline'].includes(subTab)) return 'w-[30rem]'
  return 'w-96'
})()
```

---

### `integrations/unified-viewer/src/panels/NavBar.tsx` (EXTEND)

**Analog:** self (existing `integrations/unified-viewer/src/panels/NavBar.tsx:1-112`).

**Extension — Mode switch** (UI-SPEC §9):

```tsx
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'  // shadcn add toggle-group
// In center cluster between system tabs and theme/help controls:
<ToggleGroup type="single" value={mode} onValueChange={(v) => v && setMode(v as 'kg'|'triage')}>
  <ToggleGroupItem value="kg" aria-label="Knowledge Graph mode">Knowledge Graph</ToggleGroupItem>
  <ToggleGroupItem value="triage" aria-label="Issue Triage mode">Issue Triage</ToggleGroupItem>
</ToggleGroup>
```

**Extension — ETM tail trigger** (UI-SPEC §13.3, coding-only):

```tsx
{system === 'coding' && (
  <IconButton
    icon={Radio}  // lucide 📡 equivalent
    ariaLabel={etmSheetOpen ? 'Close observation stream' : 'Open observation stream'}
    tooltipText="Observation stream (t)"
    onClick={() => setEtmSheetOpen(o => !o)}
    badge={unreadObservations > 0 ? unreadObservations : undefined}
  />
)}
```

**Executor guidance:**
- Mode toggle hidden when `entities.length === 0` OR (mode === triage prerequisite NOT met) per UI-SPEC §9.
- Use `Logger.info(Logger.Categories.PANELS, 'Mode switched')` on toggle.

---

### `integrations/unified-viewer/src/routes/UnifiedViewer.tsx` (EXTEND)

**Analog:** self (existing Phase 45 `routes/UnifiedViewer.tsx`).

**Extension areas:**
1. Add `<StatsBar />` between `<NavBar />` and the flex content row.
2. Add mode state: `const [mode, setMode] = useState<'kg'|'triage'>('kg')`.
3. Switch canvas content by mode: `mode === 'kg' ? <SigmaCanvas/> : <IssueTriageView/>`.
4. Add `<LslTimelineStrip />` (coding-only) between content row and Footer.
5. Add `<WorkflowStatusPanel />` (coding-only) BELOW Footer.
6. Mount `<EtmTailSheet />` as overlay sheet (coding-only, conditionally rendered).

**Executor guidance:**
- The `key={system}` remount discipline (Phase 45 Pattern 1) MUST be preserved — Phase 55 additions don't break the cross-system reset boundary.
- URL persistence for mode: `useSearchParams()` from react-router; default to `'kg'` on coding/okb; ignore `?mode=triage` if entity set lacks incidents.

---

### `integrations/unified-viewer/src/panels/coding/HierarchyNavigator.tsx` (NEW)

**Analog:** NO VOKB analog. Closest in-repo: FilterRail collapsible section pattern (`FilterRail.tsx`) + accordion via shadcn.

**Tree-build pattern:**

```typescript
// Build tree from flat entities with metadata.parent / metadata.hierarchyPath
const hierarchyTree = useMemo(() => {
  const hierarchyClasses = new Set(['Project','Component','SubComponent','Detail'])
  const hierarchyEntities = entities.filter(e => hierarchyClasses.has(e.ontologyClass ?? ''))
  // index by id, then walk parent pointers to build children arrays
  const byId = new Map(hierarchyEntities.map(e => [e.id, e]))
  const tree: TreeNode[] = []
  // ... standard parent-pointer to children-array tree build
}, [entities])
```

**Render pattern** (shadcn Accordion + UI-SPEC §13.1):

```tsx
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion'

<Accordion type="multiple" className="space-y-1" role="tree">
  {tree.map(l1 => (
    <AccordionItem key={l1.id} value={l1.id} role="treeitem" aria-level={1}>
      <AccordionTrigger className="text-xs">
        <button
          onClick={(e) => { e.stopPropagation(); filterToSubtree(l1.id) }}
          aria-label={`Filter to ${l1.ontologyClass}: ${l1.name} (${l1.descendantCount} descendants)`}
        >
          {l1.name} <span className="text-[10px] text-muted-foreground">({l1.descendantCount})</span>
        </button>
      </AccordionTrigger>
      <AccordionContent>
        {/* L2 children recursively */}
      </AccordionContent>
    </AccordionItem>
  ))}
</Accordion>
```

**Executor guidance:**
- Coding-only — render guarded by `system === 'coding'`.
- Click an L1 row sets transient filter chip (UI-SPEC §13.1).
- `Cmd/Ctrl+F` opens text input above tree per UI-SPEC §13.1 (extend `useKeyboardShortcuts`).
- ARIA: `role="tree"` parent + `role="treeitem"` rows + `aria-level` + `aria-expanded`.

---

### `integrations/unified-viewer/src/panels/coding/LslTimelineStrip.tsx` (NEW)

**Analog:** NO VOKB analog. Closest in-repo: dashboard `batch-progress.tsx` (horizontal-strip progress UI).

**Data shape** (per UI-SPEC §18 row 16 NEW endpoint):

```typescript
interface LslSession {
  id: string
  startAt: string        // ISO
  endAt: string | null   // null if currently running
  observationCount: number
  entityIds: string[]    // entities touched in this session
}
// Fetch: GET /api/coding/lsl/sessions?since=<iso>&limit=200
```

**Render layout pattern:**

```tsx
<div className="h-8 border-t border-border bg-card flex items-center px-2 gap-1 overflow-x-auto">
  <ToggleGroup type="single" value={window} onValueChange={setWindow}>
    <ToggleGroupItem value="24h">24h</ToggleGroupItem>
    <ToggleGroupItem value="7d">7d</ToggleGroupItem>
    <ToggleGroupItem value="30d">30d</ToggleGroupItem>
  </ToggleGroup>
  <div className="flex-1 flex items-center relative">
    {sessions.map(s => (
      <Tooltip key={s.id}>
        <TooltipTrigger asChild>
          <button
            onClick={(e) => e.metaKey || e.ctrlKey ? addSessionFilter(s.id) : setSessionFilter(s.id)}
            className={`w-2 h-6 ${s.endAt === null ? 'ring-2 ring-primary' : ''} bg-blue-400 mx-px`}
            style={{ left: `${pctOfWindow(s.startAt)}%` }}
          />
        </TooltipTrigger>
        <TooltipContent>
          {s.id.slice(0,8)} · {s.startAt} → {s.endAt ?? 'running'} · {s.observationCount} obs · {s.entityIds.length} entities
        </TooltipContent>
      </Tooltip>
    ))}
  </div>
</div>
```

**Executor guidance:**
- Coding-only (gate `system === 'coding'`).
- Click filters graph to entities in `entity.metadata.lslSessionIds.includes(sessionId)`.
- Cmd/Ctrl+Click multi-selects (additive filter chip).
- Keyboard nav per UI-SPEC §13.2 — `←`/`→` between ticks, `Enter` to select, `Esc` to clear.

---

### `integrations/unified-viewer/src/panels/coding/EtmTailSheet.tsx` (NEW)

**Analog:** dashboard `healthRefreshMiddleware.ts:102-144` (SSE EventSource pattern with auto-reconnect).

**SSE pattern with backoff** (verbatim from healthRefreshMiddleware.ts:102-144):

```typescript
function useEtmStream(apiClient: ApiClient) {
  const [observations, setObservations] = useState<Observation[]>([])
  const [isLive, setIsLive] = useState(false)
  const sseRef = useRef<EventSource | null>(null)
  const attemptRef = useRef(0)

  useEffect(() => {
    const connect = () => {
      const sse = new EventSource(`${apiClient.base}/api/coding/observations/stream`)
      sseRef.current = sse
      sse.onopen = () => { setIsLive(true); attemptRef.current = 0; Logger.info(Logger.Categories.NETWORK, 'ETM stream connected') }
      sse.onmessage = (event) => {
        try {
          const obs = JSON.parse(event.data) as Observation
          setObservations(prev => [obs, ...prev].slice(0, 100))  // ring buffer max 100
        } catch {}
      }
      sse.onerror = () => {
        setIsLive(false)
        sse.close()
        const delay = Math.min(16000, 1000 * 2 ** attemptRef.current)
        attemptRef.current++
        Logger.warn(Logger.Categories.NETWORK, `ETM stream error, reconnect in ${delay}ms`)
        setTimeout(connect, delay)
      }
    }
    connect()
    return () => sseRef.current?.close()
  }, [apiClient])

  return { observations, isLive }
}
```

**Sheet pattern** (shadcn `<Sheet>`):

```tsx
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'  // npx shadcn add sheet

<Sheet open={open} onOpenChange={setOpen}>
  <SheetContent side="right" className="w-96 sm:w-[480px]">
    <SheetHeader className="sticky top-0 bg-card">
      <SheetTitle className="flex items-center gap-2">
        ETM Live Tail
        {isLive
          ? <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
          : <div className="w-2 h-2 bg-muted-foreground rounded-full" />}
      </SheetTitle>
    </SheetHeader>
    <div aria-live="polite" aria-atomic="false" className="max-h-[30rem] overflow-y-auto">
      {observations.map(o => <ObservationRow key={o.id} observation={o} />)}
    </div>
  </SheetContent>
</Sheet>
```

**Executor guidance:**
- LIVE dot uses `bg-emerald-500` semantic-green (UI-SPEC §3.5 carve-out).
- `aria-live="polite"` on body (UI-SPEC §15).
- Agent tag color-coded: claude=violet, copilot=blue, opencode=teal, mastra=amber (UI-SPEC §13.3).
- Auto-scroll-to-top only when scrolled within 100px of top; otherwise "↑ N new observations" button (UI-SPEC §13.3).
- Burst debounce: coalesce >10 obs/sec into 250ms batch repaints (UI-SPEC §13.3 perf).
- Click row → if `observation.referencedEntities[0]` exists, `setSelectedNodeId(...)`.

---

### `integrations/unified-viewer/src/panels/coding/WorkflowStatusPanel.tsx` (NEW)

**Analog:** `integrations/system-health-dashboard/src/components/ukb-workflow-modal.tsx` (pattern reference) + Redux slice `ukbSlice.ts`. Endpoint is `/api/ukb/status` on port 3033 (NOT 12436 — UkbOps panel reads from health API).

**Poll-with-stop pattern:**

```typescript
function useWorkflowStatus() {
  const [data, setData] = useState<WorkflowStatus | null>(null)
  const idleSinceRef = useRef<number>(Date.now())
  useEffect(() => {
    const fetchOnce = async () => {
      const r = await fetch('http://localhost:3033/api/ukb/status')
      const json = await r.json()
      setData(json)
      if (json.status === 'idle') {
        idleSinceRef.current = idleSinceRef.current || Date.now()
      } else {
        idleSinceRef.current = 0
      }
    }
    fetchOnce()
    const interval = setInterval(() => {
      // Skip polling when idle for >5 min
      if (idleSinceRef.current > 0 && Date.now() - idleSinceRef.current > 5 * 60_000) return
      fetchOnce()
    }, 5000)
    return () => clearInterval(interval)
  }, [])
  return data
}
```

**Render pattern:**

```tsx
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'

<Collapsible open={expanded} onOpenChange={setExpanded}>
  <CollapsibleTrigger className="h-10 w-full px-6 flex items-center justify-between text-xs">
    {status?.status === 'running'
      ? <span>{status.workflowName} {status.progressPercent}% — {status.currentPhase}</span>
      : <span>No workflows running.</span>}
  </CollapsibleTrigger>
  <CollapsibleContent>
    <Card>
      <CardContent>
        {status?.stepsDetail?.map(step => (
          <div key={step.name} className="flex items-center gap-2 py-1">
            <StatusIcon status={step.status} />
            <span className="flex-1 text-xs">{step.label}</span>
            <Progress value={step.progressPercent} className="w-32" />
          </div>
        ))}
      </CardContent>
    </Card>
  </CollapsibleContent>
</Collapsible>
```

**Executor guidance:**
- Coding-only (gate `system === 'coding'`).
- Port 3033 is the Health API — NOT the obs-api or LLM proxy (CLAUDE.md note about port confusion).
- Auto-expand on idle→running transition; auto-collapse 30s after completion (UI-SPEC §13.4).
- Empty-state copy verbatim per UI-SPEC §5 row "Workflow status — no active runs".
- Click a step row: if `currentStepData.referencedEntities` is set, `setSelectedNodeId(first)`.

---

### `integrations/unified-viewer/src/graph/vokb-palette.ts` (NEW)

**Analog:** `_work/.../viewer/src/components/KnowledgeGraph/GraphVisualization.tsx:31-176` (semantic palette constants).

**Direct extracts from GraphVisualization.tsx:**

```typescript
// EXACT translation of GraphVisualization.tsx semantic palette (lines 31-176).
// Single source of truth for shape/color/border/edge constants.

// FAILURE_MODEL classes (GraphVisualization.tsx:60-62)
export const FAILURE_MODEL_CLASSES = new Set([
  'FailurePattern', 'Incident', 'Resolution', 'RootCause', 'Symptom',
])

// BUSINESS classes (GraphVisualization.tsx:66-68)
export const BUSINESS_CLASSES = new Set([
  'Decision', 'Requirement', 'Risk', 'ActionItem', 'DocumentSource',
])

// Node fill (GraphVisualization.tsx:70-85)
export function nodeFill(layer: string, ontologyClass?: string): string {
  const isFailure = ontologyClass && FAILURE_MODEL_CLASSES.has(ontologyClass)
  const isBusiness = ontologyClass && BUSINESS_CLASSES.has(ontologyClass)
  if (isBusiness) {
    if (layer === 'evidence') return '#10b981'
    if (layer === 'pattern')  return '#34d399'
    return '#6ee7b7'
  }
  if (layer === 'evidence') return isFailure ? '#93c5fd' : '#3b82f6'
  if (layer === 'pattern')  return isFailure ? '#fdba74' : '#f59e0b'
  return '#6b7280'
}

// Stroke (GraphVisualization.tsx:87-110)
export function nodeStroke(layer: string, ontologyClass?: string, sourceAuthority?: SourceAuthority): string { ... }
export function nodeStrokeWidth(sourceAuthority?: SourceAuthority): number { ... }
export function nodeStrokeDasharray(sourceAuthority?: SourceAuthority): string { ... }

// EDGE_STYLES — full map from GraphVisualization.tsx:135-173 (verbatim)
export const EDGE_STYLES: Record<string, { color: string; dasharray: string }> = { ... }

// Layer/confidence badge classes (NodeDetails.tsx:71-74, :219-228)
export const LAYER_BADGE_CLASS: Record<string, string> = {
  evidence: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  pattern:  'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
}
export const CONFIDENCE_COLOR: Record<'High'|'Moderate'|'Low', { class: string; dot: string }> = {
  High:     { class: 'bg-green-100 text-green-700',  dot: 'bg-green-500' },
  Moderate: { class: 'bg-yellow-100 text-yellow-700', dot: 'bg-yellow-500' },
  Low:      { class: 'bg-orange-100 text-orange-700', dot: 'bg-orange-500' },
}

// RUN_COLORS — 8-color cycle (NodeDetails.tsx:232-241)
export const RUN_COLORS = [
  { bg: 'bg-blue-100',    border: 'border-blue-400',    dot: 'bg-blue-500' },
  { bg: 'bg-emerald-100', border: 'border-emerald-400', dot: 'bg-emerald-500' },
  { bg: 'bg-violet-100',  border: 'border-violet-400',  dot: 'bg-violet-500' },
  { bg: 'bg-amber-100',   border: 'border-amber-400',   dot: 'bg-amber-500' },
  { bg: 'bg-rose-100',    border: 'border-rose-400',    dot: 'bg-rose-500' },
  { bg: 'bg-cyan-100',    border: 'border-cyan-400',    dot: 'bg-cyan-500' },
  { bg: 'bg-pink-100',    border: 'border-pink-400',    dot: 'bg-pink-500' },
  { bg: 'bg-lime-100',    border: 'border-lime-400',    dot: 'bg-lime-500' },
]
```

**Executor guidance:**
- VERBATIM port — write a snapshot test that diffs `vokb-palette.ts` constants against `GraphVisualization.tsx` semantic palette to detect drift (UI-SPEC §4 "Tested by snapshot against the VOKB source to ensure verbatim parity").
- Tailwind classes mirror hex values via the `bg-*`/`text-*` ladder used in VOKB.

---

### `integrations/unified-viewer/src/lib-domain/evidence-types.ts` (NEW)

**Analog:** `_work/.../viewer/src/components/KnowledgeGraph/NodeDetails.tsx:243-296` AND `IssueTriage.tsx:21-53` (verbatim duplicate — extract to shared module).

**Direct extract from NodeDetails.tsx:243-296:**

```typescript
export type EvidenceLinkType =
  | 'argo_workflow' | 'argo_logs' | 'raas_job' | 'cloudwatch'
  | 'grafana' | 's3' | 'github' | 'session' | 'mkdocs'
  | 'confluence' | 'jira' | 'codebeamer' | 'adr' | 'other'

export const EVIDENCE_TYPE_ICONS: Record<EvidenceLinkType, string> = {
  argo_workflow: '⚙', argo_logs: '⚙', raas_job: '📋',
  cloudwatch: '☁', grafana: '📊', s3: '📦',
  github: '⟨⟩', session: '🔗', mkdocs: '📖',
  confluence: '📄', jira: '🎯', codebeamer: '📝',
  adr: '⚖', other: '🔹',
}

export const EVIDENCE_TYPE_LABELS: Record<EvidenceLinkType, string> = {
  argo_workflow: 'Argo Workflows', argo_logs: 'Argo Logs', raas_job: 'RaaS Jobs',
  cloudwatch: 'CloudWatch', grafana: 'Grafana', s3: 'S3 Objects',
  github: 'GitHub', session: 'Sessions', mkdocs: 'Documentation',
  confluence: 'Confluence', jira: 'Jira', codebeamer: 'CodeBeamer',
  adr: 'Architecture Decisions', other: 'Other',
}

// Age-badge helper (NodeDetails.tsx:280-296)
export function evidenceAgeBadge(addedAt: string): { label: string; className: string } | null {
  const ageDays = (Date.now() - new Date(addedAt).getTime()) / 86_400_000
  if (ageDays > 180) return { label: `${Math.floor(ageDays)}d`, className: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' }
  if (ageDays > 90)  return { label: `${Math.floor(ageDays)}d`, className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' }
  return null
}
```

**Executor guidance:**
- BOTH `EntityDetailPanel` (sub-section: Sources & Evidence) AND `IssueTriageView` import from this module — NO duplication.
- The age-badge helper is exported as a named function, not inlined.

---

### `integrations/unified-viewer/src/store/viewer-store.ts` (EXTEND)

**Analog:** self (existing Phase 45 `store/viewer-store.ts:1-110`).

**Extension slices** (UI-SPEC §17 row 28 + §10 filter composition):

```typescript
// Existing fields preserved verbatim. Add:

export interface ViewerState {
  // ... existing fields ...

  // NEW slices — filtersSlice (translated from VOKB Redux slice)
  selectedLayers: string[]                  // empty = all visible
  selectedDomains: string[]
  selectedOntologyClasses: string[]         // grouped tree selection
  showEdges: boolean
  showClusters: boolean
  showRelationLabels: boolean
  showMergedOnly: boolean
  hideDocNodes: boolean

  // NEW — modeSlice
  mode: 'kg' | 'triage'

  // NEW — trendsSlice (cached)
  trendingPatterns: TrendingPattern[]

  // NEW — etmTailSlice (coding-only)
  etmObservations: Observation[]            // ring buffer max 100
  etmStreamConnected: boolean
  etmSheetOpen: boolean

  // NEW — hierarchySlice (coding-only)
  hierarchySubtreeFilter: string | null     // root id of subtree
  lslSessionFilter: string[]                // multi-select

  // ... new setters
  toggleLayer: (l: string) => void
  toggleDomain: (d: string) => void
  toggleOntologyClass: (c: string) => void
  setSelectedOntologyClasses: (cs: string[]) => void
  toggleShowEdges: () => void
  // ... etc
  setMode: (m: 'kg' | 'triage') => void
  pushObservation: (o: Observation) => void  // ring-buffer push
}
```

**Executor guidance:**
- Mirror VOKB Redux slice names for portability: see `_work/.../viewer/src/store/slices/filtersSlice.ts` for action names (`toggleLayer`, `toggleDomain`, `toggleOntologyClass`, `setSelectedOntologyClasses`, `toggleShowClusters`, etc.).
- Empty-array semantic (`selectedLayers === []` = "all visible") is a VOKB invariant (UI-SPEC §10) — preserve in selectors.
- Ring-buffer push: `etmObservations: [obs, ...prev].slice(0, 100)`.
- The existing `selectedClasses: Set<string>` field is REPLACED by `selectedOntologyClasses: string[]` to match VOKB Redux shape (arrays serialize cleanly to URL; Sets do not).

---

### `integrations/unified-viewer/src/components/KeyboardHelpDialog.tsx` (EXTEND)

**Analog:** self (existing `components/KeyboardHelpDialog.tsx`).

**Extension:** add 6 rows to the SHORTCUTS array per UI-SPEC §10:

```typescript
// Existing rows (Phase 45) + NEW Phase 55 rows
const PHASE_55_SHORTCUTS = [
  { keys: 'm', description: 'Toggle Knowledge Graph / Issue Triage mode' },
  { keys: 't', description: 'Open ETM live tail sheet (coding only)' },
  { keys: '1 / 2 / 3 / 4', description: 'Cycle Entity sub-tabs (Default / Evolution / Confidence / Timeline)' },
  { keys: '[ / ]', description: 'Collapse / expand the entire FilterRail' },
  { keys: 'g then h', description: '"Go to hierarchy" — focuses Hierarchy Navigator search (coding only)' },
  { keys: 'Shift+/', description: 'Open keyboard help (same as ?)' },
]
```

---

### `integrations/unified-viewer/src/graph/SigmaCanvas.tsx` (EXTEND — node program for halo + dashed)

**Analog:** self (existing `graph/SigmaCanvas.tsx:1-269`).

**Extension areas:**
1. Extend the `makeNodeReducer` invocation in `SigmaCanvas.tsx:166-170` to include `borderStyle` and `pulseRule` attributes.
2. Mount a sigma custom node program (registered via `nodeProgramClasses`) that supports dashed borders and pulse halos. Reference: `node-renderer.ts:24-55` returns `StrokeStyle`; extend that interface with `borderStyle: 'solid'|'dashed'` and `halo?: HaloSpec`.
3. Per-frame pulse-rule evaluation gated on `prefers-reduced-motion: reduce` media query (UI-SPEC §12 + §15).

**Executor guidance:**
- Pulse animation: SVG halo ring around node, opacity `0 → 0.5 → 0` over 1500ms (UI-SPEC §12).
- Reduced-motion fallback: static 50%-opacity ring (UI-SPEC §12).
- Pulse rules supported: `null`, `lastUpdatedWithin:60s`, `lastUpdatedWithin:5m`, `recentlyMerged:1h` (UI-SPEC §12 v1).
- Existing `useEffect` at SigmaCanvas.tsx:162-191 (reducer wiring) is the extension point — DO NOT restart layout when filter changes (already correct).

---

### `integrations/unified-viewer/src/graph/node-renderer.ts` (EXTEND)

**Analog:** self (existing `graph/node-renderer.ts:1-93`).

**Extension** (add new visual attributes):

```typescript
export interface StrokeStyle {
  width: number
  color: string
  opacity: number
  glow?: { color: string; size: number }
  borderStyle?: 'solid' | 'dashed'        // NEW Phase 55
  halo?: { color: string; phase: number } // NEW Phase 55 (phase 0..1 of animation cycle)
}

export function nodeStrokeForState(
  state: NodeState,
  borderStyle?: 'solid' | 'dashed',
  pulseRuleResult?: boolean,
): StrokeStyle | null {
  const base = /* existing switch from node-renderer.ts:36-54 */
  if (!base) return null
  return {
    ...base,
    borderStyle: borderStyle ?? 'solid',
    halo: pulseRuleResult ? { color: base.color, phase: (Date.now() % 1500) / 1500 } : undefined,
  }
}

// Pulse rule evaluator (NEW)
export function evaluatePulseRule(rule: string | null, entity: Entity): boolean {
  if (!rule) return false
  if (rule.startsWith('lastUpdatedWithin:')) {
    const window = rule.split(':')[1]  // e.g. '60s' or '5m'
    const ms = parseWindow(window)
    return Date.now() - new Date(entity.updatedAt ?? 0).getTime() < ms
  }
  if (rule.startsWith('recentlyMerged:')) {
    const ms = parseWindow(rule.split(':')[1])
    const occ = entity.metadata?.occurrences ?? []
    return occ.some(o => Date.now() - new Date(o.timestamp).getTime() < ms)
  }
  return false
}
```

---

### `integrations/unified-viewer/src/graph/color-fallback.ts` (EXTEND)

**Analog:** self (existing `graph/color-fallback.ts:1-65`).

**Extension** (add shape/border/pulse fallbacks parallel to `classColor`):

```typescript
// Existing classColor unchanged.

const SHAPE_PALETTE: Record<string, 'circle'|'diamond'|'square'|'triangle'|'hexagon'> = {
  // Map from UI-SPEC §14 coding.display.json:
  Project: 'hexagon', Component: 'square', SubComponent: 'square', Detail: 'circle',
  Observation: 'circle', Digest: 'diamond', Insight: 'diamond', LearningArtifact: 'diamond',
  Pattern: 'diamond', Service: 'square', File: 'square', Feature: 'hexagon',
  Contract: 'square', RuntimeDiagnostics: 'triangle', System: 'hexagon', Knowledge: 'circle',
}

export function shapeFallback(className: string): 'circle'|'diamond'|'square'|'triangle'|'hexagon' {
  return SHAPE_PALETTE[className] ?? 'circle'
}

export function borderStyleFallback(_className: string, hasRelations: boolean): 'solid' | 'dashed' {
  return hasRelations ? 'solid' : 'dashed'  // orphan → dashed (UI-SPEC §14 fallback rule 4)
}

export function pulseRuleFallback(_className: string): string | null {
  return null  // no pulse unless overlay specifies
}
```

---

### `lib/km-core/src/api/handlers/ontology.ts` (EXTEND — display schema)

**Analog:** self (existing `lib/km-core/src/api/handlers/ontology.ts:1-254`).

**Extension** (D-55-03 schema amendment):

```typescript
// Existing DisplayHint shape (Phase 45) — keep color/icon/shape; ADD borderStyle/pulseRule.
export interface DisplayHint {
  color?: string                                                          // existing Phase 45
  icon?: string                                                            // existing Phase 45
  shape?: 'circle'|'diamond'|'square'|'triangle'|'hexagon'                 // existing Phase 45
  borderStyle?: 'solid' | 'dashed'                                         // NEW Phase 55
  pulseRule?: null | 'lastUpdatedWithin:60s' | 'lastUpdatedWithin:5m' | 'recentlyMerged:1h'  // NEW Phase 55
}
```

**Executor guidance:**
- The `loadDisplayOverlay()` helper (lib/km-core/src/ontology/display-overlay.ts) needs Zod validation extended for the two new optional fields.
- BC contract is PRESERVED: `?withDisplay=true` continues to return enriched objects; missing fields stay `undefined`.
- Strict-equal `"true"` BC gate at ontology.ts:139-141 unchanged.
- Test extension: add a fixture overlay with `borderStyle:"dashed"` + `pulseRule:"lastUpdatedWithin:60s"` and assert serialization round-trip.

---

### `lib/km-core/src/ontology/display-overlay.ts` (EXTEND)

**Analog:** self.

**Extension:** extend Zod schema validation to accept the two new optional fields per the enum constraints from UI-SPEC §14:

```typescript
const DisplayHintSchema = z.object({
  color: z.string().optional(),
  icon: z.string().optional(),
  shape: z.enum(['circle','diamond','square','triangle','hexagon']).optional(),
  borderStyle: z.enum(['solid','dashed']).optional(),                                          // NEW
  pulseRule: z.union([z.null(), z.literal('lastUpdatedWithin:60s'),
                      z.literal('lastUpdatedWithin:5m'),
                      z.literal('recentlyMerged:1h')]).optional(),                              // NEW
})
```

---

### `scripts/observations-api-server.mjs` (EXTEND — NEW endpoints)

**Analog:** self (existing `scripts/observations-api-server.mjs:1300+` shows `/api/coding/*` pattern).

**New endpoints required** (per UI-SPEC §18):

1. **`GET /api/v1/stats`** — composed from connectivity + orphans + entity counts. Returns `ViewerStats` shape (see StatsBar pattern).
2. **`GET /api/v1/trends?top=20`** — returns `{ patterns: TrendingPattern[] }` per `okbClient.ts:62-78`. Coding-tab implementation: walk `entity.metadata.occurrences` for non-Observation classes, score by (occurrence count × recency decay).
3. **`GET /api/v1/entities/:id/confidence`** — returns `ConfidenceBreakdown` per `okbClient.ts:88-109`. If not implemented, viewer falls back to client heuristic per `NodeDetails.tsx:165-213`.
4. **`GET /api/coding/observations/stream`** (SSE) — `Content-Type: text/event-stream`. Streams each new observation as `data: <json>\n\n` on write. Reference pattern: `integrations/mcp-server-semantic-analysis/src/sse-server.ts:136` (`res.setHeader('Content-Type', 'text/event-stream')`).
5. **`GET /api/coding/lsl/sessions?since=<iso>&limit=200`** — returns `{ sessions: LslSession[] }`. Walks `.specstory/history/` filename conventions (per Phase 51 work) or queries `state.lsl[*]` from coordinator.
6. **`GET /api/v1/stream`** (SSE, OPTIONAL) — generic stats stream. If absent, StatsBar falls back to 30s polling.

**Executor guidance:**
- Mount endpoints alongside existing `/api/coding/*` handlers (around line 1309-1468). Same `_kmStore` accessor pattern.
- SSE handler reference (canonical):
  ```javascript
  app.get('/api/coding/observations/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    const send = (obs) => res.write(`data: ${JSON.stringify(obs)}\n\n`);
    // Subscribe to observation-writer events; on disconnect unsubscribe
    const unsub = subscribeObservationWritten(send);
    req.on('close', unsub);
  });
  ```
- Each endpoint uses `{ success: true, data: ... }` envelope per Phase 44 contract.
- camelCase keys throughout (Plan 44-16 lock — only `session_id` on observations stays snake_case).
- All new handler functions should emit zero `console.*` per CLAUDE.md `no-console-log` rule; use `process.stderr.write()` for errors (matches existing pattern at line 1361, 1407).

---

### `_work/rapid-automations/integrations/operational-knowledge-management/src/api/routes.ts` (potential EXTEND)

**Analog:** self.

**D-55-01a adapter check (REQUIRED before implementation):**
- OKM Express on `:8090` exposes `/api/v1/*` via `createKmCoreRouter` (per `server.ts:1-15`).
- Verify it conforms to Phase 44 contract: paths, camelCase keys, response shapes.
- If OKM Express lacks `/api/v1/stats`, `/api/v1/trends`, or `/api/v1/entities/:id/confidence`, planner decides:
  - **Preferred:** add to OKM repo (D-55-01a — "preferred — corporate repo, doable in `_work/`").
  - **Fallback:** frontend adapter shim that maps existing `/api/okm/*` endpoints (e.g. `/api/okm/patterns/trending` exists per routes.ts:478) to Phase 44 `/api/v1/*` shape.

**Existing OKM endpoints worth knowing** (routes.ts:462-510):
- `GET /api/okm/patterns/trending` → already there; OKB tab can use this directly or via adapter.
- `GET /api/okm/confidence/ranking` + `GET /api/okm/entities/:id/confidence` → already there.
- `GET /api/okm/source-documents/:runId` → for evidence deep-link.

---

### `coding/.data/ontologies/coding.display.json` (NEW)

**Analog:** UI-SPEC §14 table (lines 515-533).

**Content (verbatim from UI-SPEC §14):**

```jsonc
{
  "Project":            { "color": "#0ea5e9", "icon": "🏗", "shape": "hexagon",  "borderStyle": "solid", "pulseRule": null },
  "Component":          { "color": "#3b82f6", "icon": "🧩", "shape": "square",   "borderStyle": "solid", "pulseRule": null },
  "SubComponent":       { "color": "#60a5fa", "icon": "🔧", "shape": "square",   "borderStyle": "solid", "pulseRule": null },
  "Detail":             { "color": "#93c5fd", "icon": "🔹", "shape": "circle",   "borderStyle": "solid", "pulseRule": null },
  "Observation":        { "color": "#10b981", "icon": "📝", "shape": "circle",   "borderStyle": "solid", "pulseRule": "lastUpdatedWithin:60s" },
  "Digest":             { "color": "#f59e0b", "icon": "📋", "shape": "diamond",  "borderStyle": "solid", "pulseRule": null },
  "Insight":            { "color": "#a855f7", "icon": "💡", "shape": "diamond",  "borderStyle": "solid", "pulseRule": null },
  "LearningArtifact":   { "color": "#ec4899", "icon": "🎓", "shape": "diamond",  "borderStyle": "solid", "pulseRule": null },
  "Pattern":            { "color": "#fb923c", "icon": "🔁", "shape": "diamond",  "borderStyle": "solid", "pulseRule": null },
  "Service":            { "color": "#14b8a6", "icon": "⚙",  "shape": "square",   "borderStyle": "solid", "pulseRule": null },
  "File":               { "color": "#9ca3af", "icon": "📄", "shape": "square",   "borderStyle": "solid", "pulseRule": null },
  "Feature":            { "color": "#22c55e", "icon": "✨", "shape": "hexagon",  "borderStyle": "solid", "pulseRule": null },
  "Contract":           { "color": "#8b5cf6", "icon": "📜", "shape": "square",   "borderStyle": "solid", "pulseRule": null },
  "RuntimeDiagnostics": { "color": "#ef4444", "icon": "🚨", "shape": "triangle", "borderStyle": "solid", "pulseRule": "lastUpdatedWithin:5m" },
  "System":             { "color": "#64748b", "icon": "🌐", "shape": "hexagon",  "borderStyle": "solid", "pulseRule": null },
  "Knowledge":          { "color": "#06b6d4", "icon": "📚", "shape": "circle",   "borderStyle": "solid", "pulseRule": null }
}
```

---

### `tests/e2e/unified-viewer/55-*.spec.ts` (NEW E2E tests)

**Analog:** existing `tests/e2e/unified-viewer/*.spec.ts` (Phase 45 — directory exists per `ls tests/e2e/unified-viewer`).

**Executor guidance:**
- One spec per major surface group: `55-stats-bar.spec.ts`, `55-filters-parity.spec.ts`, `55-entity-sub-tabs.spec.ts`, `55-issue-triage.spec.ts`, `55-coding-surfaces.spec.ts`, `55-cap-removal.spec.ts`, `55-okb-routing.spec.ts`.
- Use `gsd-browser` CLI for screenshot verification per CLAUDE.md "Visual UI verification — use `gsd-browser`".
- Side-by-side screenshots vs VOKB at `localhost:3002` (per CONTEXT.md "verifier MUST include side-by-side screenshot comparison").
- Run via `npx playwright test tests/e2e/unified-viewer/`.
- DO NOT write hand-rolled `node /tmp/foo.mjs` Playwright scripts (re-triggers `prefer-gsd-browser` constraint per CLAUDE.md).
- Forbidden-string assertion: `expect(page.locator('body')).not.toContainText('cc.bmwgroup.net')` per D-55-01c.

---

## Shared Patterns

### Logger usage (port from VOKB; no raw `console.*`)

**Source:** existing `integrations/unified-viewer/src/lib/logging.ts` (already exports `Logger` per Phase 45 + memory `feedback_logger_class.md`).

**Apply to:** EVERY new TS/TSX file in this phase.

```typescript
import { Logger } from '@/lib/logging'

// Categorized + level-filtered + localStorage-persisted.
// VOKB convention: Logger.info(LogCategories.FILTERS, '...')
// Unified-viewer uses dot-namespace: Logger.info(Logger.Categories.FILTERS, '...')
Logger.info(Logger.Categories.PANELS, `Mode switched to ${next}`)
Logger.warn(Logger.Categories.NETWORK, 'SSE error — reconnecting')
Logger.debug(Logger.Categories.FILTERS, `Search: "${query}"`)
```

**ZERO raw `console.log`/`console.warn`/`console.error` in any file produced by Phase 55.** This is a memory-locked rule (`feedback_logger_class.md`). The `no-console-log` constraint will fire.

---

### `{success: true, data: T}` envelope unwrap (Phase 44 contract)

**Source:** `integrations/unified-viewer/src/api/ApiClient.ts:78-83`.

**Apply to:** any new fetch path (TrendingPanel, StatsBar, ConfidenceFetch, LSL sessions, etc.).

```typescript
const res = await fetch(url, { headers: { Accept: 'application/json' } })
if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
const body = (await res.json()) as ApiSuccess<T> | ApiError
if (!body.success) throw new Error(body.error)
return body.data
```

Use the existing `ApiClient.get<T>()` helper rather than calling `fetch` directly when possible — extend `ApiClient` with new typed methods.

---

### Network-failure classification (UI-SPEC §16 CRITICAL)

**Source:** UI-SPEC §16 verbatim function `classifyNetworkError`.

**Apply to:** every API client fetch error handler, anywhere a banner/copy is shown.

```typescript
function classifyNetworkError(err: unknown): 'dns'|'cors'|'tls'|'timeout'|'http-status'|'unknown' {
  if (!(err instanceof TypeError)) return 'unknown'
  const msg = err.message.toLowerCase()
  if (msg.includes('failed to fetch') && msg.includes('cors')) return 'cors'
  if (msg.includes('failed to fetch') && /name|dns|resolve/.test(msg)) return 'dns'
  if (msg.includes('tls') || msg.includes('certificate') || msg.includes('ssl')) return 'tls'
  if (msg.includes('timeout')) return 'timeout'
  return 'unknown'
}
```

NEVER say "CORS" in error copy when classification is `'dns'` (D-55-01c root cause).

---

### Shadcn primitive policy

**Source:** UI-SPEC §1.

**Apply to:** every panel needing UI primitives.

| Primitive | Add Command | Used By |
|-----------|------------|---------|
| `sheet` | `npx shadcn add sheet` | EtmTailSheet, mobile SidePanel drawer |
| `popover` | `npx shadcn add popover` | StatsBar LIVE indicator detail |
| `toggle-group` | `npx shadcn add toggle-group` | Mode switch (KG↔Triage), LSL time-window selector |
| `skeleton` | `npx shadcn add skeleton` | Loading states |

**Plan-time grep gate before any `npx shadcn add`** — check `src/components/ui/` first (`tabs`/`accordion`/`progress`/`collapsible`/`card`/`badge`/`checkbox` already present per Phase 45).

---

### gsd-browser visual verification (NEVER hand-rolled Playwright)

**Source:** CLAUDE.md "Visual UI verification — use `gsd-browser`" + memory `feedback_e2e_verify.md`.

**Apply to:** every Phase 55 visual smoke test against `localhost:5173` (unified-viewer dev) and `localhost:3002` (VOKB for side-by-side).

```bash
gsd-browser navigate http://localhost:5173/viewer/coding
gsd-browser screenshot /tmp/55-coding-kg-mode.png
gsd-browser click "[data-testid='mode-toggle-triage']"
gsd-browser screenshot /tmp/55-coding-triage-mode.png
```

**Constraint dodging forbidden** — DO NOT swap to `node /tmp/foo.mjs` with `chromium.launch()` (re-triggers `prefer-gsd-browser` per CLAUDE.md).

---

### Submodule build pipeline (for km-core changes)

**Source:** CLAUDE.md "Rebuilding After Code Changes".

**Apply to:** any change in `lib/km-core/` OR `_work/rapid-automations/integrations/operational-knowledge-management/`.

**km-core (in coding repo):**
```bash
cd lib/km-core && npm run build
# Then restart obs-api: launchctl kickstart -k gui/$(id -u)/com.coding.obs-api
```

**OKM (in `_work/`):**
```bash
cd _work/rapid-automations/integrations/operational-knowledge-management && npm run build
# Then restart OKM Express on :8090 per its own runbook
```

**Forgetting `npm run build` after editing TS source is a recurring failure mode** (CLAUDE.md memory `feedback_worktree_verification` & submodule notes).

---

## No Analog Found

Files with no close in-repo match — planner should use UI-SPEC patterns + synthesize:

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `integrations/unified-viewer/src/panels/StatsBar.tsx` | sticky stats strip | SSE + poll | VOKB lacks an explicit StatsBar component (UI-SPEC §7 row 1 notes "Phase 55 ADDS it grounded in OkbStats schema"). Synthesize from `okbClient.ts:35-45` (data shape) + dashboard `healthRefreshMiddleware.ts:102-144` (SSE pattern). |
| `integrations/unified-viewer/src/panels/coding/HierarchyNavigator.tsx` | coding hierarchy tree | derive | NO VOKB analog (UI-SPEC §13.1 coding-specific). Build on shadcn Accordion + filter chip pattern. |
| `integrations/unified-viewer/src/panels/coding/LslTimelineStrip.tsx` | LSL session strip | request-response | NO VOKB analog. Closest in-repo pattern: dashboard `batch-progress.tsx` horizontal strip. |
| `integrations/unified-viewer/src/panels/coding/EtmTailSheet.tsx` | ETM live observations | SSE | NO VOKB analog. Synthesize from dashboard SSE consumer pattern + shadcn Sheet. |

---

## Metadata

**Analog search scope:**
- `_work/rapid-automations/integrations/operational-knowledge-management/viewer/src/` (VOKB — canonical exact-parity source)
- `_work/rapid-automations/integrations/operational-knowledge-management/src/api/` (OKM backend conformance reference)
- `integrations/unified-viewer/src/` (Phase 45 scaffold being extended)
- `integrations/system-health-dashboard/src/` (coding-surface SSE + workflow reference)
- `lib/km-core/src/api/` (Phase 44 REST contract reference)
- `scripts/observations-api-server.mjs` (obs-api `/api/coding/*` + `/api/v1/*` reference)

**Files scanned:** ~25 (VOKB), ~18 (unified-viewer), ~6 (dashboard reference), ~4 (km-core), 1 (obs-api script).

**Strong analogs (3-5+ exact + role-match):** met — analog search stopped at 27/31 matches; remaining 4 are documented as "no analog" with synthesis sources.

**Pattern extraction date:** 2026-06-09

**Cross-cutting memory pointers (downstream agents):**
- `feedback_exact_ui_parity.md` — VOKB source, not screenshots.
- `feedback_logger_class.md` — Port VOKB Logger; ZERO raw `console.*`.
- `feedback_e2e_verify.md` — `gsd-browser` for visual verification.
- `feedback_bmw_ghe_https.md` — D-55-01c forbidden string purge.
- CLAUDE.md submodule build pipeline (km-core + OKM).
