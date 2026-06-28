# Phase 74: Performance Dashboard & Reports - Pattern Map

**Mapped:** 2026-06-28
**Files analyzed:** 14 (7 NEW lib/UI, 3 MODIFIED, 1 ontology, 3+ test surfaces)
**Analogs found:** 14 / 14 (every target has a concrete in-repo analog; no RESEARCH-only fallbacks)

> Two-store / two-port reality (RESEARCH §Architecture): the experiment **Runs/Scores/Reports** come from the dedicated km-core LevelDB via **vkb-server :8080**; the DASH-02 **timeline** rows come from proxy-owned **`token-usage.db` SQLite** read-only. They are different stores on different ports. Honor it per-file below.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `integrations/system-health-dashboard/src/pages/performance.tsx` | page (component) | request-response (fetch + render) | `src/pages/token-usage.tsx` | exact (page shell) |
| `integrations/system-health-dashboard/src/components/performance/faceted-sidebar.tsx` | component | transform (client-side faceting) | shadcn `card`+`checkbox`+`collapsible`+`scroll-area`+`badge` (no faceted component exists) | role-match (composite) |
| `integrations/system-health-dashboard/src/components/performance/score-drawer.tsx` | component | request-response (PATCH save) | `src/components/ui/sheet.tsx` (NEW primitive) + PATCH idiom in RESEARCH | partial (new primitive) |
| `integrations/system-health-dashboard/src/components/performance/runs-table.tsx` | component | CRUD-read (table render) | `token-usage.tsx` `Table`+badge-triad (lines 800-817) | exact |
| `integrations/system-health-dashboard/src/components/performance/timeline.tsx` | component | event-driven (collapsible sub-bands) | shadcn `collapsible`+`badge` | role-match |
| `integrations/system-health-dashboard/src/components/performance/reports-subview.tsx` | component | CRUD (save/refresh) | `token-usage.tsx` `Tabs`+`Card` list | role-match |
| `integrations/system-health-dashboard/src/components/ui/sheet.tsx` | ui primitive | n/a (generated) | shadcn official registry (`npx shadcn add sheet`) | generated |
| `integrations/system-health-dashboard/src/App.tsx` | config (route table) | n/a | existing `/token-usage` route (line 9, 31) | exact |
| `integrations/system-health-dashboard/src/components/nav-bar.tsx` | config (tab table) | n/a | existing `Token Usage` tab (line 35) | exact |
| `integrations/system-health-dashboard/server.js` | route (reverse proxy) | request-response (proxy) | token-usage proxy block (lines 291-303) | exact |
| `lib/vkb-server/api-routes.js` (experiment GET/POST handlers) | route + handler | CRUD-read + write | `handleScoreOverride` (lines 403-468) + `registerRoutes` (line 77) | exact |
| `lib/experiments/query.mjs` (`readRuns`) | service (reader) | CRUD-read (iterate+join) | `score-write.mjs` iterate-by-entityType (lines 85-104) | role-match |
| `lib/experiments/timeline-read.mjs` (`readTimeline`) | service (reader) | file-I/O (readonly SQL) | `token-aggregate.mjs` `aggregateByTaskId` (lines 62-100) | exact |
| `lib/experiments/report-write.mjs` + `report-read.mjs` | service (writer/reader) | CRUD-write (idempotent) | `score-write.mjs` `writeScore` (lines 72-157) | exact |
| `.data/ontologies-experiment/experiment-ontology.json` (`Report` fill-in) | config (schema) | n/a | sibling `Score` class (lines 65-77) | exact |
| `tests/experiments/*.test.mjs` | test | n/a | `score-override-endpoint.test.mjs` `seedIsolatedStore` (lines 40-70) | exact |
| `tests/e2e/dashboard/performance.spec.ts` | test (E2E) | n/a | `tests/e2e/dashboard/workflow-graph-colors.spec.ts` | role-match |

---

## Pattern Assignments

### `lib/experiments/query.mjs` — `readRuns` (service, CRUD-read)

**Analog:** `lib/experiments/score-write.mjs:85-104` (iterate-by-entityType + metadata-key join). Caller owns open/close — `readRuns(store, …)` takes an ALREADY-OPEN store, exactly like `writeScore`/`applyOverride`.

**Iterate + join pattern** (score-write.mjs:85-104 — copy the iterate shape, join on `metadata.run_task_id`):
```javascript
let existingId, existingMeta;
for await (const e of store.iterate({ entityType: 'Score' })) {
  if (e.metadata?.run_task_id === span.task_id) { existingId = e.id; existingMeta = e.metadata ?? {}; break; }
}
```
**Adapt to:** build `Map(run_task_id → Score.metadata)` and `Map(run_task_id → Outcome.metadata)` in one iterate pass each, then iterate `Run`s and attach. Exclude `metadata.pending` runs unless `includePending` (D-06 quarantine — RESEARCH Code Examples lines 416-432).

**null-not-zero (RESEARCH Pitfall 4):** never `?? 0` a score dimension/heuristic. `null` means "no evidence / could not compute" and must survive to the UI as `—`.

**Differs:** read-only (no `putEntity`); does not mint ids; produces a joined row array for the table, not a single entity.

---

### `lib/experiments/timeline-read.mjs` — `readTimeline` (service, file-I/O)

**Analog:** `lib/experiments/token-aggregate.mjs:62-100` — the read-only `better-sqlite3` open + bound-param + graceful-missing-file pattern. This is a DIFFERENT store from the experiment LevelDB (it reads `token-usage.db`).

**Readonly open + bound param + missing-file guard** (token-aggregate.mjs:68-99):
```javascript
if (!fs.existsSync(dbPath)) { return { totals: zeroTotals(), byAgentModel: [] }; } // graceful empty, NOT throw
let db;
try {
  db = new Database(dbPath, { readonly: true, fileMustExist: true }); // readonly load-bearing — sole-writer guardrail
  const rows = db.prepare(`SELECT ... FROM token_usage WHERE task_id = ? ...`).all(taskId); // ALWAYS bound ?
  return rows;
} finally { if (db) db.close(); }
```
**Adapt to:** `SELECT timestamp, granularity_tier, tool_call_id, parent_call_id, reasoning_tokens, input_tokens, output_tokens, total_tokens, tokens_estimated, model FROM token_usage WHERE task_id = ? ORDER BY timestamp ASC, tool_call_id ASC`. Then group children: a `per-turn` row is a parent; its sub-bands are `per-reasoning-step` rows whose `tool_call_id.split(':reason:')[0]` matches the parent's `tool_call_id` (RESEARCH §Timeline lines 318-323). Copilot `per-session-aggregate` = single band, no expand. Accept a `dbPathOverride` param so tests point at a fixture DB (`token-aggregate.mjs:56`).

**Differs:** returns parent/child grouped rows for the collapsible timeline; never aggregates totals.

**CLAUDE.md:** `readonly: true` MANDATORY (`token-usage.db` is proxy-owned, writer #1); bind `task_id` as `?` (no interpolation — V5/T-71-03-01).

---

### `lib/experiments/report-write.mjs` + `report-read.mjs` — `writeReport`/`refreshReport`/`readReports` (service, CRUD-write)

**Analog:** `lib/experiments/score-write.mjs:72-157` (`writeScore`) — idempotent strict-path entity write. Mirror it EXACTLY.

**Idempotent mint-once + iterate-find + strict putEntity** (score-write.mjs:85-93, 108-157):
```javascript
let existingId;
for await (const e of store.iterate({ entityType: 'Report' })) {
  if (e.metadata?.report_id === reportId) { existingId = e.id; break; }   // idempotency on a metadata slug, NOT the id
}
const provenance = { provider: 'coding-dashboard', model: 'n/a', runId: reportId, timestamp: new Date().toISOString() };
const id = await store.putEntity({
  id: existingId ?? mintEntityId(),          // mint UUIDv7 on first write, reuse on refresh — NEVER reportId as id
  name: `${reportId}-report`,
  entityType: 'Report',                       // validated against experiment-ontology.json (strict path)
  layer: 'evidence',
  metadata: {
    domain: 'experiment',                     // exporter buckets by metadata.domain → experiment.json (score-write.mjs:130)
    report_id: reportId,
    facet_state: JSON.stringify(facetState),  // serialize objects/arrays (Score serializes event_labels: score-write.mjs:134)
    snapshot: JSON.stringify(snapshotRows),
    snapshot_frozen_at: new Date().toISOString(),
    title, created_by,
  },
}, { provenance });
```
**`refreshReport(reportId)`:** re-run the saved `facet_state` query (call `readRuns`), overwrite `snapshot` + `snapshot_frozen_at`, REUSE the same entity id via the iterate-find lookup (D-04 — same idempotent path). `readReports`/`readReport` parse `JSON.parse(metadata.snapshot)` / `metadata.facet_state` on read.

**Differs from writeScore:** no override-preservation/tri-state markers; payloads (`facet_state`, `snapshot`) ride in metadata as serialized JSON.

**CLAUDE.md:** must construct the store ONLY via `openExperimentStore()` (never `new GraphKMStore` — ontologyDir rule); `process.stderr.write` for any logging.

---

### `lib/vkb-server/api-routes.js` — experiment GET/POST handlers (route + handler)

**Analog:** `handleScoreOverride` (lines 403-468) + its route registration (line 77). The transient open→operate→close-in-finally is the MANDATORY pattern for every new endpoint.

**Route registration** (register new handlers right after line 77, inside `registerRoutes`):
```javascript
app.patch('/api/experiments/scores/:taskId', (req, res) => this.handleScoreOverride(req, res)); // EXISTING
// NEW (this phase):
app.get('/api/experiments/runs', (req, res) => this.handleRunsQuery(req, res));
app.get('/api/experiments/runs/:taskId/timeline', (req, res) => this.handleTimeline(req, res));
app.get('/api/experiments/reports', (req, res) => this.handleReportsQuery(req, res));
app.post('/api/experiments/reports', (req, res) => this.handleSaveReport(req, res));
app.post('/api/experiments/reports/:id/refresh', (req, res) => this.handleRefreshReport(req, res));
```

**Transient single-owner store access** (api-routes.js:457-468 — copy verbatim into every experiment-store handler):
```javascript
const { openExperimentStore } = await import('../experiments/store.mjs');
const store = await openExperimentStore(this.experimentRepoRoot ? { repoRoot: this.experimentRepoRoot } : {});
try {
  // ... readRuns / writeReport / refreshReport ...
} finally {
  await store.close();   // ALWAYS — single-owner LevelDB
}
```
The `this.experimentRepoRoot` indirection (api-routes.js:40) lets tests inject an isolated tmp root — new handlers MUST honor it identically.

**Error/validation shape** (api-routes.js:412-477): validate inputs (bound `task_id`/`report_id`) and return `400` on bad input, `404` on missing, `502`/`500` on store error, all as `res.status(n).json({ error, message })`. The timeline handler reads `token-usage.db` (NOT the experiment store) via `timeline-read.mjs` — no `openExperimentStore` there.

**Anti-pattern (RESEARCH Pitfall 1):** do NOT route Runs through `/api/entities?type=Run` — that hits the shared KG, not the experiment LevelDB.

---

### `integrations/system-health-dashboard/server.js` — `/api/experiments/*` reverse proxy (route)

**Analog:** token-usage proxy block (server.js:291-303). Add an analogous block forwarding to `host.docker.internal:8080` (vkb-server), supporting GET + POST + PATCH (the page rides this same-origin proxy, not a direct host:port fetch — RESEARCH lines 354-371).

**Proxy block to copy/adapt** (server.js:292-303):
```javascript
this.app.get('/api/token-usage/:endpoint', async (req, res) => {
  try {
    const endpoint = req.params.endpoint;
    const qs = new URLSearchParams(req.query).toString();
    const url = `http://host.docker.internal:12435/api/token-usage/${endpoint}${qs ? '?' + qs : ''}`;
    const resp = await fetch(url);
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'LLM proxy unreachable', details: err.message });
  }
});
```
**Adapt to:** a `/api/experiments/*` block → `http://host.docker.internal:8080/api/experiments/...`, forwarding method/body/query (GET runs/timeline/reports; POST report save/refresh; PATCH score override). 502 on unreachable with `error: 'experiment API (vkb-server) unreachable'` (matches UI-SPEC error copy line 129).

**CLAUDE.md:** `server.js` is bind-mounted but VirtioFS-cached — backend edits need a FULL `docker-compose restart coding-services` (a supervisor-only restart re-reads the stale cached file — RESEARCH Pitfall 6).

---

### `integrations/system-health-dashboard/src/pages/performance.tsx` (page, request-response)

**Analog:** `src/pages/token-usage.tsx` — page shell, fetch/state conventions, threshold-badge triad, summary-card grid + `Tabs` body.

**Imports pattern** (token-usage.tsx:1-12 — reuse exact primitive import paths):
```typescript
import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription } from '@/components/ui/alert'
```
**Fetch base — USE THE SAME-ORIGIN PROXY, not token-usage's direct host:port.** token-usage.tsx:18-19 hardcodes `PROXY_BASE = http://localhost:12435` (historical host context). The Performance page MUST fetch same-origin `/api/experiments/...` (the latency-tile idiom for container-served pages — RESEARCH lines 363-371). Do NOT copy the `PROXY_BASE = http://localhost:8080` anti-pattern.

**Threshold-badge triad** (token-usage.tsx:814-817 — reuse EXACTLY, UI-SPEC §Color line 109):
```typescript
? 'bg-green-50 text-green-700 border-green-200'
  : 'bg-yellow-50 text-yellow-700 border-yellow-200'
    : 'bg-red-50 text-red-700 border-red-200'
```
**Corrected-wins effective value** (RESEARCH Code Examples lines 436-446 — lock for table aggregates, D-03): `corrected_<dim>` if non-null else judged `<dim>` else `null` (render `—`, never `0`).

**Layout:** two-column `grid grid-cols-[260px_1fr] gap-6` (sidebar 260px fixed + results table) per UI-SPEC line 39; summary `Card` grid is the focal point (UI-SPEC line 49); `Tabs` with a second value for the Reports sub-view (D-05).

**Differs:** adds a faceted sidebar (net-new), a `Sheet` drawer, a collapsible timeline, and a Reports sub-view — none exist in token-usage.tsx.

---

### `src/components/ui/sheet.tsx` + `score-drawer.tsx` (ui primitive + component, request-response)

**Analog:** none in repo — `src/components/ui/` has NO `sheet.tsx` (confirmed: existing set is alert/badge/button/card/checkbox/collapsible/dialog/input/progress/scroll-area/select/separator/table/tabs/tooltip). Generate via `npx shadcn@latest add sheet` (shadcn official). Fallback per UI-SPEC line 31: right-aligned `dialog`.

**Drawer save (reuse existing PATCH — D-02)** (RESEARCH lines 448-459; respect the EXACT ranges api-routes.js:411-455 enforces — regressions ∈ {0,1}, others ∈ [0,1], `overridden_by` non-empty ≤256):
```typescript
await fetch(`/api/experiments/scores/${encodeURIComponent(taskId)}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ dimension, value, overridden_by: operatorId }),
})
// 400 = validation; 404 = score changed/missing → "reopen the run and try again" (UI-SPEC line 130)
```
**Drawer contract** (UI-SPEC line 165): right-side `Sheet` `sm:max-w-md`; 5 rubric rows (read-only judged `text-muted-foreground` + editable `corrected_*` `Input` + rationale); footer primary `Save override` (`Button` default) + `Discard changes` (`variant="ghost"`).

**Differs:** first drawer in the dashboard; one PATCH per edited dimension (the endpoint takes a single `{dimension,value,overridden_by}`).

---

### `src/App.tsx` + `src/components/nav-bar.tsx` (config — route/tab tables)

**Analog:** existing `/token-usage` registration. Add `/performance` AFTER it.

**App.tsx** (import line 9, route line 31): add `import { PerformancePage } from './pages/performance'` and `<Route path="/performance" element={<PerformancePage />} />` immediately after line 31.

**nav-bar.tsx** (tabs array line 35): add `{ label: 'Performance', path: '/performance' }` after the `Token Usage` entry. Active-tab style is the existing `border-b-2 border-primary` convention (nav-bar.tsx:50 — UI-SPEC §Color reserved-accent item 1).

**Differs:** none — pure additive registration.

---

### `.data/ontologies-experiment/experiment-ontology.json` — `Report` class fill-in (config, schema)

**Analog:** sibling `Score` class (lines 65-77) — declares scalar `properties`, keeps variable/serialized payloads in metadata (note line 67: "corrected_*/overridden_by/overridden_at ride in metadata (not declared properties)"). The `Report` stub today (lines 78-83): `extends: Feature`, empty `properties`/`relationships`.

**Fill-in shape** (RESEARCH §Report Schema lines 332-345 — declare scalar props; `facet_state`/`snapshot` ride in metadata as JSON strings, mirroring Score's `event_labels`):
```jsonc
"Report": {
  "extends": "Feature",
  "description": "Saved query (facet-state) + frozen results snapshot (KB-04 / DASH-03).",
  "relationships": { "references": ["Run"] },
  "properties": {
    "reportId":         { "type": "string" },
    "title":            { "type": "string" },
    "createdBy":        { "type": "string" },
    "createdAt":        { "type": "string" },
    "snapshotFrozenAt": { "type": "string" }
  }
}
```
**Differs:** this is the only schema change; tests pick it up automatically because the ontology dir is copied verbatim into test tmp roots (score-override-endpoint.test.mjs:44-46).

---

### `tests/experiments/*.test.mjs` (test)

**Analog:** `tests/experiments/score-override-endpoint.test.mjs:40-70` — `seedIsolatedStore` (tmp repo-root + verbatim ontology copy + `experimentRepoRoot` isolation). `node:test` + `node:assert/strict` convention (NOT the jest package.json default — RESEARCH line 491).

**Isolated-store seeding helper** (score-override-endpoint.test.mjs:40-52 — factor into a shared fixture for the new tests, RESEARCH Wave 0 line 525):
```javascript
async function seedIsolatedStore(taskId = 't1') {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), '...-test-'));
  const tmpOntologyDir = path.join(tmp, '.data', 'ontologies-experiment');
  fs.mkdirSync(tmpOntologyDir, { recursive: true });
  for (const f of fs.readdirSync(SRC_ONTOLOGY_DIR)) fs.copyFileSync(...); // REAL ontology copied verbatim
  const { openExperimentStore } = await import('../../lib/experiments/store.mjs');
  const store = await openExperimentStore({ repoRoot: tmp });   // isolated — never the real single-owner store
  try { /* writeRun + writeScore seed */ } finally { /* close */ }
}
```
**New tests** (RESEARCH Wave 0 lines 520-525): `run-read.test.mjs`, `runs-endpoint.test.mjs` (Object.create(ApiRoutes.prototype) + experimentRepoRoot, like score-override-endpoint), `timeline-read.test.mjs` (fixture token-usage.db via `dbPathOverride`), `report-write.test.mjs`, `report-snapshot.test.mjs` (the load-bearing DASH-03 stability test — mutate underlying Run, snapshot unchanged until `refreshReport`).

**Run command:** `node --test tests/experiments/<file>.test.mjs` (per-file; the jest default would skip these).

---

### `tests/e2e/dashboard/performance.spec.ts` (test, E2E)

**Analog:** `tests/e2e/dashboard/workflow-graph-colors.spec.ts` (only existing dashboard spec) + `playwright.config.ts`. Plus a `gsd-browser` visual pass against `localhost:3032/performance` (CLAUDE.md E2E-verify rule — never claim UI works from DB/endpoint checks alone).

**Run command:** `npx playwright test tests/e2e/dashboard/performance.spec.ts`.

---

## Shared Patterns

### Transient single-owner store access (MANDATORY — every experiment-LevelDB endpoint + reader/writer)
**Source:** `lib/vkb-server/api-routes.js:457-468` (handler) / `lib/experiments/store.mjs:40-54` (factory)
**Apply to:** every new `/api/experiments/*` handler that touches the experiment store, and `query.mjs`/`report-*.mjs` (which receive an already-open store).
```javascript
const { openExperimentStore } = await import('../experiments/store.mjs');
const store = await openExperimentStore(this.experimentRepoRoot ? { repoRoot: this.experimentRepoRoot } : {});
try { /* iterate / putEntity */ } finally { await store.close(); }   // single-owner LevelDB
```
NEVER `new GraphKMStore` inline (CLAUDE.md ontologyDir rule — `openExperimentStore` sets it).

### Idempotent strict-path entity write (Report writer)
**Source:** `lib/experiments/score-write.mjs:85-157` (writeScore)
**Apply to:** `report-write.mjs` `writeReport`/`refreshReport`.
Mint UUIDv7 once (`mintEntityId()`), key idempotency on `metadata.report_id`, supply synthetic `provenance`, tag `domain: 'experiment'`, serialize objects via `JSON.stringify`.

### Read-only proxy-DB query (timeline)
**Source:** `lib/experiments/token-aggregate.mjs:68-99`
**Apply to:** `timeline-read.mjs`.
`new Database(dbPath, { readonly: true, fileMustExist: true })`, bound `?` params, graceful empty on missing file, `db.close()` in finally.

### Same-origin reverse proxy (connectivity)
**Source:** `integrations/system-health-dashboard/server.js:291-303`
**Apply to:** server.js `/api/experiments/*` block + `pages/performance.tsx` fetch base (same-origin `/api/experiments/...`, NOT host:8080).

### Threshold-badge triad + corrected-wins display
**Source:** `token-usage.tsx:814-817` (triad) + RESEARCH lines 436-446 (corrected-wins)
**Apply to:** runs-table + drawer cells. null → `—` (never `0`); corrected-if-present effective value; amber/Pencil "edited" marker (UI-SPEC line 108).

### Server-side logging
**Source:** every `lib/experiments/*.mjs` (`process.stderr.write`)
**Apply to:** all new `.mjs` readers/writers and `.ts` server code — CLAUDE.md `no-console-log`. Never `console.log`; never dodge via a different raw-write API.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/components/ui/sheet.tsx` | ui primitive | n/a | No `sheet`/`drawer` exists; GENERATE from shadcn official (`npx shadcn add sheet`). Fallback: right-aligned `dialog`. |
| `src/components/performance/faceted-sidebar.tsx` | component | transform | No faceted-filter component exists anywhere in `system-health-dashboard` (confirmed). Build from `card`+`checkbox`+`collapsible`+`scroll-area`+`badge` primitives per UI-SPEC line 39. |

*(Both are composition-of-existing-primitives, not greenfield — they have primitive analogs, just not a whole-component analog.)*

---

## Metadata

**Analog search scope:** `lib/experiments/`, `lib/vkb-server/`, `integrations/system-health-dashboard/src/{pages,components,components/ui}`, `integrations/system-health-dashboard/server.js`, `tests/experiments/`, `tests/e2e/dashboard/`, `.data/ontologies-experiment/`
**Files read this session:** token-usage.tsx (1-120 + lines 800-817 via grep), api-routes.js (1-90, 388-477), score-write.mjs (1-160, 185-249), token-aggregate.mjs (55-100), server.js (285-319), store.mjs (full), App.tsx (full), nav-bar.tsx (1-60), experiment-ontology.json (60-85), score-override-endpoint.test.mjs (1-75), ui/ + e2e/ directory listings
**Pattern extraction date:** 2026-06-28
