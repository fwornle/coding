# Phase 74: Performance Dashboard & Reports - Research

**Researched:** 2026-06-28
**Domain:** React dashboard page + km-core read/query REST surface over a dedicated experiment LevelDB store + faceted UI
**Confidence:** HIGH (all surfaces read from the live codebase with line citations; no external library version risk — this phase adds zero new runtime deps beyond one shadcn component)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01 (DASH-01):** Faceted sidebar query-builder — left-rail facet panel (`task_id`, date window, route-class, `granularity_tier`, score-dimension thresholds) with live counts; clicking facets progressively narrows the Run set. NET-NEW interaction pattern for `system-health-dashboard` — confirm no existing faceted component, identify reusable filter/table primitives first.
- **D-02 (SC#5 / SCORE-02):** Per-run detail drawer — clicking a Run row opens a side drawer with all 5 rubric dimensions (judged values), editable `corrected_*` fields, and rubric rationale. Save issues `PATCH /api/experiments/scores/:taskId` (Phase 73 endpoint).
- **D-03 (corrected-wins display):** When a Run has a corrected dimension, the table shows the **corrected** value as effective with a small "edited" marker; original judged value revealed on hover + in drawer. Locks 73-CONTEXT D-06 corrected-wins-if-present for any table averages/aggregations.
- **D-04 (KB-04 / DASH-03):** Query + cached snapshot + manual Refresh — "Save report" persists BOTH the query/facet-state AND a frozen results snapshot. Report views render the **snapshot**; a manual **Refresh** re-runs the saved query and updates the snapshot.
- **D-05:** Reports live as a sub-view INSIDE the Performance tab (a "Saved Reports" section), not a separate top-level nav tab.
- **D-06 (DASH-02):** Collapsible sub-bands, collapsed by default. Each parent turn shows an always-visible `granularity_tier` badge; expanding reveals stacked per-reasoning-step sub-bands. Tier badge stays visible even when collapsed (honesty signal).

### Claude's Discretion
- Exact facet set and ordering in the sidebar (D-01) — start from locked facets; may add obvious ones (e.g. `not_scored`/`pending` score state) and must justify any beyond.
- Visual treatment of the "edited" marker and tier badge — follow existing dashboard component styling (shadcn/Card/badge conventions).
- Report storage location/shape (experiment store `Report` entity vs a lighter dashboard-side store) — decide in planning based on where the query/snapshot is cheapest to persist/re-read; the `Report` ontology class is the intended home (KB-04).

### Deferred Ideas (OUT OF SCOPE)
- Report **sharing/export** (CSV/permalink) — note for a future dashboard phase.
- Faceted-sidebar **cross-task analytics / charts** beyond the runs table — DASH-01 is a query-builder over runs, not a charting phase.
- Any "Delete report" destructive affordance.
- Changing the rubric schema, the judge, the Score/Run/Route/Outcome write keying, or the `token_usage` schema (all read-only this phase).
- The score-override storage + PATCH API (shipped Phase 73; this phase calls it).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DASH-01 | New "Performance" tab (after Tokens) providing a task-anchored query-builder over runs | Net-new `pages/performance.tsx` + faceted sidebar (D-01) + NEW read/query GET endpoints over experiment store (none exist today — only PATCH); Run faceting fields enumerated in §Experiment Data Model |
| DASH-02 | Timeline renders per-reasoning-step rows as stacked sub-bands under parent turn + `granularity_tier` badge | Timeline data source is **`token-usage.db`** (not the experiment store): `granularity_tier ∈ {per-turn, per-reasoning-step, per-session-aggregate}`, parent/child linkage via `parent_call_id`/`tool_call_id` — see §Timeline Data Source |
| KB-04 | `Report` entity + saved-query workflow (query + stable snapshot) | `Report` ontology class is a schema-only stub today; §Report Schema Design proposes the properties; net-new `writeReport`/`readReports` (no writer exists) |
| DASH-03 | Report views render a saved query against a stable results snapshot | Snapshot stored on the Report entity (D-04); render-from-snapshot + manual Refresh re-runs query |
</phase_requirements>

## Summary

Phase 74 is a **UI-plus-thin-read-API** phase, not a data-engineering phase. All write paths (Run/Outcome/Route/Score materialization, the score-override PATCH) shipped in Phases 71–73 and are consumed read-only. The two genuinely net-new code surfaces are: **(1) a read/query REST layer over the dedicated experiment LevelDB store** (today `lib/vkb-server/api-routes.js` has ONLY the `PATCH /api/experiments/scores/:taskId` write endpoint — there are zero experiment GET endpoints), and **(2) a `Report` entity writer + reader** (the `Report` ontology class is a schema-only stub with empty `properties`/`relationships`, and no `writeReport` exists anywhere). The React work mirrors `pages/token-usage.tsx` structurally and reuses the mature shadcn design system already in `system-health-dashboard` — only ONE new shadcn primitive (`sheet`) is required.

The single biggest architectural fact the planner must internalize: **the Performance tab reads from TWO different data stores on TWO different services.** The Runs table + scores + reports come from the **experiment km-core LevelDB store** (`.data/experiments/leveldb`) served by **vkb-server on port 8080**. The DASH-02 timeline's per-reasoning-step / per-turn rows come from the **proxy-owned `token-usage.db` SQLite** (`.data/llm-proxy/token-usage.db`), the same DB `token-aggregate.mjs` reads read-only. These are not the same store and not the same port. There is also **no existing same-origin reverse-proxy route to port 8080** in the dashboard's `server.js` (it only proxies `/api/token-usage/*` to 12435) — so connectivity from the container-served `:3032` page to the experiment endpoints is an explicit decision the planner must make (add a `server.js` proxy route to 8080, OR fetch 8080 directly from the browser).

**Primary recommendation:** Build the read/query endpoints in `lib/vkb-server/api-routes.js` using the SAME transient `open → operate → close-in-finally` `openExperimentStore()` pattern the existing PATCH handler uses (single-owner LevelDB). Add a same-origin `/api/experiments/*` proxy route in `system-health-dashboard/server.js` forwarding to `host.docker.internal:8080` (mirroring the existing 12435 token-usage proxy block at server.js:291-302), and have `pages/performance.tsx` fetch through it. Store Reports as `Report` entities in the experiment store (KB-04's intended home) keyed on a minted UUIDv7 with a `report_id` idempotency slug, mirroring the `writeScore`/`writeRun` idempotent-write pattern exactly.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Faceted query-builder UI (D-01) | Frontend (React page) | — | Pure client state over fetched Run rows; faceting/counts computed client-side from a fetched run set OR server-side via query params |
| Run read/query endpoints | API / Backend (vkb-server :8080) | Database (experiment LevelDB) | km-core store is single-owner LevelDB — must be opened server-side, never from browser |
| Score-override save (D-02) | API / Backend (existing PATCH) | Database (experiment LevelDB) | Endpoint already exists (api-routes.js:77/403); UI only calls it |
| Timeline sub-bands (DASH-02) | API / Backend (read over token-usage.db) | Database (proxy SQLite) | Per-reasoning-step rows live in `token-usage.db`, NOT the experiment store; read-only SQL like `token-aggregate.mjs` |
| Report persist + read (KB-04) | API / Backend (new endpoints) | Database (experiment LevelDB) | Report entity is the KB-04 home; needs new writeReport/readReports + endpoints |
| Same-origin connectivity to :8080 | Frontend Server (dashboard server.js) | — | Container-served `:3032` page cannot assume direct browser access to :8080; mirror the 12435 proxy block |
| Nav/route registration | Frontend (App.tsx + nav-bar.tsx) | — | Add `/performance` route + tab after `/token-usage` |

## Standard Stack

This phase adds **no new runtime dependencies** to the backend. The frontend adds exactly one shadcn component (`sheet`) generated from the shadcn official registry into the existing component set. Everything else is already present.

### Core (all already installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@fwornle/km-core` | (workspace-pinned; same as Phases 71–73) | Experiment store (`GraphKMStore`), `mintEntityId`, strict-path `putEntity`, `iterate` | The experiment store is built on it (store.mjs:22); read/query + Report write reuse the SAME store |
| `better-sqlite3` | installed (verified `require('better-sqlite3')` OK) | Read-only timeline query over `token-usage.db` | Already the proxy DB reader in `token-aggregate.mjs:29`; `{ readonly: true }` sole-writer guardrail |
| React + react-router-dom | existing in system-health-dashboard | Page + route | `App.tsx` already uses `BrowserRouter`/`Routes`/`Route` |
| shadcn/ui (Radix) + lucide-react | existing | All UI primitives | `components.json` present, new-york/neutral preset (UI-SPEC) |
| express | existing (vkb-server + dashboard server.js) | REST endpoints + reverse proxy | api-routes.js registers via `registerRoutes(app)` |

### Supporting (one net-new component)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| shadcn `sheet` component | shadcn official registry (latest) | Right-side per-run detail drawer (D-02) | Add via `npx shadcn add sheet`. No `sheet`/`drawer` exists today (confirmed: `src/components/ui/` has no `sheet.tsx`). Fallback per UI-SPEC: existing `dialog` right-aligned, but `sheet` preferred |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| New vkb-server GET endpoints | Reuse generic `/api/entities?type=Run` | REJECT — `/api/entities` reads the SHARED knowledge-graph store (`KnowledgeQueryService`/`graphDB`), NOT the dedicated experiment LevelDB. Experiment Runs are not in that store. Dedicated `/api/experiments/*` endpoints over `openExperimentStore()` are required |
| `sheet` drawer | `dialog` (existing) | dialog works but is shorter; the judged-vs-corrected side-by-side form benefits from the taller side panel (UI-SPEC sanctions sheet as preferred) |
| Server-side faceting | Client-side faceting over a fetched run set | At current scale (5 Runs; tens-to-low-hundreds expected before the v7.5 policy gate at ~50 runs), client-side faceting over a single `GET /api/experiments/runs` fetch is simplest and gives instant live counts. Plan should default to client-side, leave server-side filter params as an additive option |

**Installation:**
```bash
# Frontend (run inside integrations/system-health-dashboard)
npx shadcn@latest add sheet
# No backend package installs — all deps already present.
```

**Version verification:** No new npm packages are introduced on the backend, so no registry version pin is needed. `better-sqlite3` and `@fwornle/km-core` are already resolved in the workspace (verified `require('better-sqlite3')` succeeds; km-core is imported by the live store.mjs). The only registry fetch is the shadcn `sheet` component source (copied into the repo, not a runtime dep) from the shadcn official registry — `components.json` declares `"registries": {}` (no third-party), so this is the sanctioned official path.

## Package Legitimacy Audit

> This phase installs **no new npm runtime packages**. The only registry interaction is `npx shadcn add sheet`, which copies component SOURCE from the shadcn OFFICIAL registry into `src/components/ui/sheet.tsx` (vendored code, not a dependency). No third-party registries are configured (`components.json: "registries": {}`).

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `better-sqlite3` | npm (already installed) | mature (10+ yrs) | very high | github.com/WiseLibs/better-sqlite3 | not run (no new install) | Pre-existing — Approved |
| `@fwornle/km-core` | workspace (private) | n/a | n/a | private/workspace | n/a | Pre-existing — Approved |
| shadcn `sheet` | shadcn official registry (vendored source) | n/a (not a dep) | n/a | github.com/shadcn-ui/ui | n/a (source copy, not registry install) | Approved (official) |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

*slopcheck was not run because this phase introduces no new npm dependency installs. The shadcn `sheet` addition is a source-vendoring operation from the official registry, not a package install, and `components.json` forbids third-party registries.*

## Architecture Patterns

### System Architecture Diagram

```
                          BROWSER  (http://localhost:3032)
                                    │
                  ┌─────────────────┴──────────────────┐
                  │   pages/performance.tsx (React)     │
                  │  ┌──────────┐  ┌──────────────────┐ │
                  │  │ Faceted  │  │ Runs table +     │ │
                  │  │ sidebar  │─▶│ corrected-wins   │ │
                  │  │ (D-01)   │  │ cells (D-03)     │ │
                  │  └──────────┘  └────────┬─────────┘ │
                  │  ┌──────────────────────▼─────────┐ │
                  │  │ Sheet detail drawer (D-02)     │ │
                  │  │ 5 rubric rows + corrected_*    │ │
                  │  └────────────────────────────────┘ │
                  │  ┌──────────────┐ ┌───────────────┐ │
                  │  │ Timeline     │ │ Reports       │ │
                  │  │ sub-bands    │ │ sub-view      │ │
                  │  │ (D-06)       │ │ (D-04/D-05)   │ │
                  │  └──────────────┘ └───────────────┘ │
                  └──────────────────┬───────────────────┘
                                     │  fetch (same-origin)
                                     ▼
              DASHBOARD server.js  (container-served :3032 → :3033 api)
              reverse-proxy block (mirror server.js:291-302)
                  ┌──────────────────────────┬──────────────────────┐
                  │ /api/experiments/* ─────▶ host.docker.internal:8080
                  │ /api/token-usage/* ─────▶ host.docker.internal:12435 (exists)
                  └──────────────────────────┴──────────────────────┘
                                     │                         │
                ┌────────────────────▼──────┐    ┌─────────────▼──────────────┐
                │ VKB-SERVER  :8080          │    │ rapid-llm-proxy :12435     │
                │ lib/vkb-server/api-routes  │    │ (read-only DB consumer      │
                │                            │    │  side: token-aggregate.mjs) │
                │ EXISTING:                  │    └─────────────┬──────────────┘
                │  PATCH /experiments/       │                  │ readonly SQL
                │    scores/:taskId  (73)    │                  ▼
                │ NEW (this phase):          │     ┌────────────────────────────┐
                │  GET  /experiments/runs    │     │ token-usage.db (SQLite)    │
                │  GET  /experiments/        │     │ .data/llm-proxy/           │
                │    runs/:taskId/timeline   │────▶│ granularity_tier rows:     │
                │  GET  /experiments/reports │     │  per-turn / per-reasoning- │
                │  POST /experiments/reports │     │  step / per-session-aggr   │
                │  POST /experiments/        │     │  parent_call_id linkage    │
                │    reports/:id/refresh     │     └────────────────────────────┘
                └─────────────┬──────────────┘
                              │ openExperimentStore() — transient open/close
                              ▼
                ┌──────────────────────────────────────────┐
                │ EXPERIMENT km-core LevelDB (single-owner)  │
                │ .data/experiments/leveldb                  │
                │  Run · Outcome · Route · Score · Report    │
                │  (Report: schema-only stub → KB-04 fills)  │
                │  ontologyDir: .data/ontologies-experiment  │
                └──────────────────────────────────────────┘
```

### Component Responsibilities
| File | Responsibility | New / Modified |
|------|----------------|----------------|
| `integrations/system-health-dashboard/src/pages/performance.tsx` | The Performance page (mirror token-usage.tsx structure) | NEW |
| `integrations/system-health-dashboard/src/App.tsx` | Add `<Route path="/performance" element={<PerformancePage/>} />` after `/token-usage` (line 31) | MODIFIED |
| `integrations/system-health-dashboard/src/components/nav-bar.tsx` | Add `{ label: 'Performance', path: '/performance' }` after Token Usage in `tabs[]` (line 35) | MODIFIED |
| `integrations/system-health-dashboard/server.js` | Add `/api/experiments/*` reverse-proxy block → `host.docker.internal:8080` (mirror lines 291-302) | MODIFIED |
| `integrations/system-health-dashboard/src/components/ui/sheet.tsx` | shadcn sheet primitive (drawer) | NEW (generated) |
| `lib/vkb-server/api-routes.js` | New experiment GET/POST handlers + route registration in `registerRoutes` (after line 77) | MODIFIED |
| `lib/experiments/query.mjs` (or `run-read.mjs`) | Read/query helpers over the experiment store (iterate Runs+join Scores) | NEW |
| `lib/experiments/timeline-read.mjs` | Read-only timeline rows from `token-usage.db` by task_id, grouped by granularity_tier | NEW |
| `lib/experiments/report-write.mjs` + `report-read.mjs` | `writeReport`/`readReports`/`refreshReport` over the experiment store | NEW |
| `.data/ontologies-experiment/experiment-ontology.json` | Fill in `Report` class `properties`/`relationships` (KB-04) | MODIFIED |

### Pattern 1: Transient single-owner store access (MANDATORY for every read endpoint)
**What:** Open the experiment store per-request, operate, close in `finally`. LevelDB is single-owner — two concurrent opens against `.data/experiments/leveldb` will conflict.
**When to use:** Every new GET/POST experiment endpoint.
**Example:**
```javascript
// Source: lib/vkb-server/api-routes.js:457-468 (the live handleScoreOverride pattern)
const { openExperimentStore } = await import('../experiments/store.mjs');
const store = await openExperimentStore(
  this.experimentRepoRoot ? { repoRoot: this.experimentRepoRoot } : {}
);
try {
  // ... iterate / putEntity ...
} finally {
  await store.close();   // ALWAYS — single-owner LevelDB
}
```
Note the `this.experimentRepoRoot` indirection (api-routes.js:40) — tests inject an isolated tmp root so the real single-owner store is never touched. New endpoints MUST honor it identically.

### Pattern 2: Idempotent strict-path entity write (for the Report writer)
**What:** Mint a UUIDv7 id ONCE on first write (never use a human-readable key as the id — `parseEntityId` requires UUIDv7), key idempotency on a `metadata.*_id` slug, re-find via `iterate({ entityType })` on re-write, supply a synthetic provenance stamp (the store never invents one, D-30).
**When to use:** `writeReport`/`refreshReport`.
**Example:**
```javascript
// Source: lib/experiments/score-write.mjs:120-157 (writeScore) — mirror exactly for Report
let existingId;
for await (const e of store.iterate({ entityType: 'Report' })) {
  if (e.metadata?.report_id === reportId) { existingId = e.id; break; }
}
const provenance = { provider: 'coding-dashboard', model: 'n/a', runId: reportId, timestamp: new Date().toISOString() };
const id = await store.putEntity({
  id: existingId ?? mintEntityId(),       // mint on first write, reuse on refresh
  name: `${reportId}-report`,
  entityType: 'Report',                    // validated against experiment-ontology.json (strict path)
  layer: 'evidence',
  metadata: {
    domain: 'experiment',                  // exporter buckets by metadata.domain → experiment.json
    report_id: reportId,                   // idempotency key
    facet_state: JSON.stringify(facetState),   // serialize objects/arrays (Score serializes event_labels this way, score-write.mjs:134)
    snapshot: JSON.stringify(snapshotRows),
    snapshot_frozen_at: new Date().toISOString(),
    title, created_by,
  },
}, { provenance });
```

### Pattern 3: Read-only timeline query over token-usage.db (DASH-02)
**What:** The per-turn / per-reasoning-step rows are NOT in the experiment store — they are in `token-usage.db`. Query read-only by `task_id`, parameterized, grouped/ordered by tier and call linkage.
**When to use:** `timeline-read.mjs` + the `/runs/:taskId/timeline` endpoint.
**Example:**
```javascript
// Source: lib/experiments/token-aggregate.mjs:76-94 (the readonly DB-open + bound-param pattern)
const db = new Database(dbPath, { readonly: true, fileMustExist: true });   // NEVER writable — sole-writer guardrail (Security V5)
try {
  const rows = db.prepare(`
    SELECT timestamp, granularity_tier, tool_call_id, parent_call_id,
           reasoning_tokens, input_tokens, output_tokens, total_tokens,
           tokens_estimated, model
    FROM token_usage
    WHERE task_id = ?
    ORDER BY timestamp ASC, tool_call_id ASC
  `).all(taskId);                                  // task_id ALWAYS a bound ? — never interpolated (T-71-03-01)
  return rows;
} finally { db.close(); }
```
Tier values are exactly `'per-turn'`, `'per-reasoning-step'` (estimated, `tokens_estimated=1`), `'per-session-aggregate'` (copilot). Parent turn = `per-turn` row with `tool_call_id = baseToolCallId`; its sub-bands = `per-reasoning-step` rows whose `tool_call_id` is `${baseToolCallId}:reason:N` (claude-token-rows.mjs:222). Group children under their parent by stripping `:reason:N`. **Missing DB file = graceful empty result, NOT a throw** (token-aggregate.mjs:68).

### Recommended Project Structure
```
lib/experiments/
├── store.mjs              # EXISTING — openExperimentStore (reuse)
├── run-write.mjs          # EXISTING — Run keying reference
├── score-write.mjs        # EXISTING — writeScore/applyOverride reference
├── query.mjs              # NEW — readRuns(filters), join Scores by run_task_id
├── timeline-read.mjs      # NEW — readTimeline(taskId) over token-usage.db
├── report-write.mjs       # NEW — writeReport / refreshReport
└── report-read.mjs        # NEW — readReports / readReport(reportId)

integrations/system-health-dashboard/src/
├── pages/performance.tsx              # NEW — page shell (mirror token-usage.tsx)
├── components/ui/sheet.tsx            # NEW — generated shadcn primitive
└── components/performance/            # NEW — optional sub-components
    ├── faceted-sidebar.tsx
    ├── runs-table.tsx
    ├── score-drawer.tsx
    ├── timeline.tsx
    └── reports-subview.tsx
```

### Anti-Patterns to Avoid
- **Reading Runs via `/api/entities?type=Run`:** That endpoint hits the SHARED knowledge-graph store, not the dedicated experiment LevelDB. Experiment Runs do not live there. Use new `/api/experiments/*` endpoints over `openExperimentStore()`.
- **Constructing `new GraphKMStore(...)` inline:** Forbidden by CLAUDE.md — always go through `openExperimentStore()` so `ontologyDir` is set (otherwise strict-path `putEntity` validation silently degrades; store.mjs:8-12).
- **Using `span.task_id` (or any human string) as a km-core entity id:** `parseEntityId` requires UUIDv7 and will throw. Mint via `mintEntityId()`, key idempotency on `metadata.*_id` (run-write.mjs:8-14).
- **Opening `token-usage.db` writable:** It is proxy-owned (writer #1). Open `{ readonly: true }` only (token-aggregate.mjs:74).
- **Fetching :8080 from the `:3032` page without a same-origin proxy:** The page is container-served; `llm-latency-tile.tsx:15-17` documents that container pages MUST ride server.js's reverse proxy, not hit host:port directly. Add the proxy block.
- **`console.log` in `.mjs`/`.ts`:** CLAUDE.md `no-console-log` — use `process.stderr.write` server-side (every experiment writer does).
- **`?? 0` on a null heuristic/score dimension:** null means "could not compute / no evidence" and is meaningful (run-write.mjs:58, score-write.mjs D-01). Preserve null in the UI; render as `—`, never `0`. Corrected-wins display must show the judged `—` when neither judged nor corrected exists.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Score-override write/validation | A new write endpoint or client-side validation | Existing `PATCH /api/experiments/scores/:taskId` (api-routes.js:403) + `applyOverride` (score-write.mjs:197) | Endpoint already validates dimension allowlist, value ranges (regressions 0\|1, others [0,1]), `overridden_by` length, 404-on-missing, and preserves judged fields. The drawer must respect THESE exact ranges client-side too |
| Drawer component | Custom side panel | shadcn `sheet` (`npx shadcn add sheet`) | Radix-backed, a11y + focus-trap handled |
| Token aggregation by task_id | New SQL | `aggregateByTaskId()` (token-aggregate.mjs) | Already computes totals + per-(agent,model,provider,tier) breakdown read-only |
| Idempotent km-core entity write | Custom upsert | `writeScore`/`writeRun` pattern (mintEntityId + iterate-find + strict putEntity) | Handles UUIDv7 minting, re-write dedupe, provenance, domain bucketing |
| Status/threshold badge styling | New color system | token-usage's green/amber/red triad (token-usage.tsx:813-817) + `Badge variant` conventions | UI-SPEC mandates exact reuse |
| Same-origin API proxy | Custom CORS/fetch plumbing | server.js reverse-proxy block (server.js:291-302 pattern) | One working idiom already forwards to host.docker.internal |

**Key insight:** Almost every "hard" piece (validated writes, idempotent persistence, token aggregation, the design system) already exists. This phase is composition + two thin read layers + one new entity writer.

## Experiment Data Model (faceting source — what the sidebar can facet over)

The experiment store currently holds (verified from `.data/experiments/exports/experiment.json`): **5 Run, 5 Outcome, 5 Route** nodes; **0 Score** nodes (Scores are written by the judge close path, separately). Faceting/columns available **per Run** (`metadata.*`, from run-write.mjs:94-121 and the export):

| Field | Source | Facet type | Notes |
|-------|--------|-----------|-------|
| `task_id` | Run.metadata.task_id | identity / search | idempotency key; also the join key to Score/Outcome/Route + timeline |
| `task_class` | Run.metadata.task_class | enum facet | `refactor\|bugfix\|new-feature\|migration\|debug\|docs\|unclassified` |
| `agent` | Run.metadata.agent | enum facet | may be null |
| `model` | Run.metadata.model | enum facet | may be null |
| `framework` | Run.metadata.framework | enum facet | may be null |
| `pending` | Run.metadata.pending | boolean facet | D-06 quarantine — exclude by default (CONTEXT note); surface as a `score state` facet |
| `started_at` / `ended_at` | Run.metadata.* | date-window facet | the "date window" facet (D-01) |
| `loop_count`, `edit_revert_count`, `redundant_read_count`, `abandoned_tool_count`, `total_step_count`, `wallclock_per_step` | Run.metadata (route heuristics) | numeric / threshold | null preserved = "could not compute" |
| Outcome: `totalTokens`/`inputTokens`/`outputTokens`/`reasoningTokens`/`closedState` | Outcome.metadata (run-write.mjs:142-150) | numeric / enum | join via Outcome.metadata.run_task_id == task_id |
| Score: `goal_aligned_ratio` + 5 judged dims + `corrected_*` + `overridden_by/at` + `pending`/`not_scored` | Score.metadata (score-write.mjs:126-156) | threshold + score-state | join via Score.metadata.run_task_id == task_id. **5 dims:** `goal_achieved`, `code_quality`, `test_coverage`, `regressions`, `spec_drift` |

**Joining for the runs table:** iterate `Run`s, then for each `task_id` look up the matching `Outcome` and `Score` by `metadata.run_task_id`. At current scale a full iterate-and-map per request is fine; if Score count grows, build a `Map(run_task_id → Score)` in one iterate pass. **`granularity_tier` is NOT a Run field** — it is a `token-usage.db` column (see Timeline). The D-01 "granularity_tier facet" is therefore best applied in the timeline view, or derived per-run from the timeline DB if a per-run tier facet is wanted (researcher flags this as a planner decision — see Open Questions).

**Corrected-wins read rule (D-03, locks 73 D-06):** effective dimension value = `corrected_<dim>` if non-null, else judged `<dim>`. The "edited" marker shows when `corrected_<dim> != null`. Any table aggregate uses the effective value. Judged value shown on hover/in-drawer.

## Timeline Data Source (DASH-02)

The timeline's per-reasoning-step sub-bands and per-turn parents come from **`token-usage.db`** (`.data/llm-proxy/token-usage.db`, verified present, 48MB), NOT the experiment store. Schema (token-db.mjs:53 INSERT columns): `id, timestamp, provider, model, process, subscription, input_tokens, output_tokens, total_tokens, latency_ms, prompt_preview, tokens_estimated, user_hash, model_raw, overhead_ms, agent, task_id, tool_call_id, parent_call_id, granularity_tier, reasoning_tokens`.

- `granularity_tier ∈ { 'per-turn', 'per-reasoning-step', 'per-session-aggregate' }` (claude-token-rows.mjs:189/224, copilot-token-rows.mjs:237).
- **Parent/child linkage (claude):** one `per-turn` row per assistant usage block with `tool_call_id = requestId|uuid`; one `per-reasoning-step` row per `thinking` block with `tool_call_id = ${baseToolCallId}:reason:${N}` (claude-token-rows.mjs:222). To nest sub-bands under a turn, group `per-reasoning-step` rows by `tool_call_id.split(':reason:')[0]` matching the parent's `tool_call_id`.
- `tokens_estimated = 1` on per-reasoning-step rows — these reasoning-token values are ESTIMATED (claude-token-rows.mjs:217-219). The UI should signal "estimated" honestly alongside the tier badge.
- Copilot emits a single `per-session-aggregate` row (no per-turn/reasoning breakdown) — the timeline must degrade gracefully (show one aggregate band, no expand).

**Honesty signal (D-06 / ROADMAP SC#2):** the `granularity_tier` badge stays visible collapsed-or-expanded; it is informational (`Badge variant="secondary"`, muted), never pass/fail color (UI-SPEC §Color).

## Report Schema Design (KB-04)

Today (`experiment-ontology.json:78-83`): `Report extends Feature`, empty `properties` and `relationships`. KB-04 fills it. Recommended properties (declared on the class; the snapshot/facet payloads ride in `metadata` as serialized JSON, mirroring how Score's `event_labels` and `corrected_*` ride in metadata — score-write.mjs:67):

```jsonc
"Report": {
  "extends": "Feature",
  "description": "Saved query (facet-state) + frozen results snapshot (KB-04 / DASH-03).",
  "relationships": { "references": ["Run"] },   // optional: link snapshotted Runs (or keep snapshot self-contained)
  "properties": {
    "reportId":         { "type": "string", "description": "Stable slug; idempotency key (also metadata.report_id)" },
    "title":            { "type": "string", "description": "Operator-given report name" },
    "createdBy":        { "type": "string", "description": "Operator id" },
    "createdAt":        { "type": "string", "description": "ISO creation time" },
    "snapshotFrozenAt": { "type": "string", "description": "ISO time the current snapshot was captured/refreshed (DASH-03 staleness note)" }
    // facet_state (the saved query, JSON-serialized) and snapshot (frozen rows, JSON-serialized)
    // ride in metadata as strings — large/variable payloads belong in metadata, not declared props.
  }
}
```

**Persistence + keying (D-04, mirror writeScore exactly):**
- `writeReport({ reportId, title, createdBy, facetState, snapshotRows })` — mint UUIDv7 on first write, idempotency on `metadata.report_id`, strict-path putEntity, `domain: 'experiment'` so it buckets into `experiment.json` (run-write.mjs:99 / score-write.mjs:130).
- `refreshReport(reportId)` — re-run the saved `facet_state` query, overwrite `snapshot` + `snapshot_frozen_at`, reuse the same entity id (idempotent — score-write.mjs:81-93 lookup pattern).
- Serialize `facet_state` and `snapshot` with `JSON.stringify` and parse on read (km-core metadata stores scalars/strings cleanly; complex values must be serialized — Score serializes `event_labels` the same way, score-write.mjs:134).
- Read render uses the stored `snapshot` (stable, DASH-03); Refresh is the only path that re-queries (D-04). No automatic re-query on view.

## Dashboard Connectivity (the load-bearing integration decision)

| Service | Port | What it serves | How the page reaches it today |
|---------|------|----------------|-------------------------------|
| Dashboard frontend | 3032 | the React SPA | direct (browser) |
| Health API (server.js) | 3033 | `/api/health`, observations, **token-usage reverse-proxy** | nav-bar.tsx fetches 3033 directly; server.js proxies `/api/token-usage/*` → 12435 |
| LLM proxy | 12435 | `/api/token-usage/*` | token-usage.tsx fetches `PROXY_BASE=http://localhost:12435` directly (host context) |
| **vkb-server** | **8080** | experiment PATCH + (new) experiment GET/POST | **NO existing proxy route; NO direct fetch from any page today** |

**The gap:** the container-served `:3032` page cannot assume direct browser access to `:8080`. `llm-latency-tile.tsx:15-17` explicitly documents that container pages MUST ride server.js's same-origin reverse proxy (which forwards over `host.docker.internal`), not hit host:port directly. The existing token-usage proxy block is:
```javascript
// Source: integrations/system-health-dashboard/server.js:291-302
this.app.get('/api/token-usage/:endpoint', async (req, res) => {
  const url = `http://host.docker.internal:12435/api/token-usage/${endpoint}${qs ? '?' + qs : ''}`;
  // ... fetch + forward, 502 on unreachable ...
});
```
**Recommendation:** add an analogous `/api/experiments/*` proxy block in server.js forwarding to `host.docker.internal:8080`, supporting GET (runs/timeline/reports) and POST/PATCH (report save/refresh, score override). `pages/performance.tsx` then fetches same-origin `/api/experiments/...` (like the latency tile), not a hard-coded host:port. This is a planner-confirmable decision but is the only pattern consistent with the existing container-served architecture. (Note: token-usage.tsx fetches 12435 directly because it historically ran in a host context; the latency TILE is the newer same-origin idiom and the right model for a new page.)

## Common Pitfalls

### Pitfall 1: Wrong store for Runs
**What goes wrong:** Reusing `/api/entities?type=Run` returns nothing (or wrong data) because experiment Runs live in the dedicated LevelDB, not the shared KG.
**Why it happens:** Both stores are km-core; the generic endpoint reads `graphDB`/`KnowledgeQueryService`, not `openExperimentStore()`.
**How to avoid:** New `/api/experiments/runs` endpoint over `openExperimentStore()` only.
**Warning signs:** Empty runs table despite `experiment.json` having nodes; Runs showing up with KG-shaped attributes.

### Pitfall 2: ontologyDir omission breaks strict writes
**What goes wrong:** Report `putEntity` validation silently degrades; entityType not validated.
**Why it happens:** Constructing the store without `ontologyDir`.
**How to avoid:** Always `openExperimentStore()` (it sets ontologyDir). Never `new GraphKMStore` inline. (CLAUDE.md km-core rule.)
**Warning signs:** `opts.classes omitted but store has no ontology registry` throw, or writes that should reject bad entityTypes silently pass.

### Pitfall 3: Concurrent LevelDB open
**What goes wrong:** A long-lived store handle or an overlapping request locks the single-owner DB.
**Why it happens:** Not closing in `finally`, or keeping a module-level open store.
**How to avoid:** Transient open→operate→close-in-finally per request (Pattern 1).
**Warning signs:** LevelDB lock errors; requests hanging.

### Pitfall 4: null coerced to 0 in the UI
**What goes wrong:** A "no evidence" dimension or "could not compute" heuristic renders as 0, lying to the operator.
**Why it happens:** `value ?? 0` in display code.
**How to avoid:** Render null/undefined as `—`; only show a number when truly present. Corrected-wins must fall through judged-null to `—`.
**Warning signs:** Scores of 0 where the rationale says "no test evidence".

### Pitfall 5: Timeline read from the wrong store / writable open
**What goes wrong:** Querying the experiment store for per-reasoning-step rows (they're not there), or opening `token-usage.db` writable (corrupts a proxy-owned DB).
**Why it happens:** Assuming all experiment data is in one store.
**How to avoid:** Timeline reads `token-usage.db` `{ readonly: true }` by `task_id` (Pattern 3); graceful empty on missing file.
**Warning signs:** Empty timeline for a run that clearly has token rows; "database is locked" against the proxy DB.

### Pitfall 6: Dashboard rebuild forgotten
**What goes wrong:** Frontend edits don't appear at :3032.
**Why it happens:** Bind-mount + VirtioFS cache.
**How to avoid (CLAUDE.md):** `cd integrations/system-health-dashboard && npm run build` then `docker exec coding-services supervisorctl restart web-services:health-dashboard-frontend`. For `server.js` (backend) edits, restart the whole container (`docker-compose restart coding-services`) — a supervisor-only restart re-reads the STALE cached file.
**Warning signs:** Stale UI; truncated `server.js` SyntaxError mid-line.

## Code Examples

### Reading Runs joined with Scores (new query.mjs)
```javascript
// Source pattern: score-write.mjs:87-93 + run-write.mjs:67-72 (iterate-by-entityType + metadata-key join)
export async function readRuns(store, { includePending = false } = {}) {
  const scores = new Map();   // run_task_id -> Score.metadata
  for await (const s of store.iterate({ entityType: 'Score' })) {
    if (s.metadata?.run_task_id) scores.set(s.metadata.run_task_id, s.metadata);
  }
  const outcomes = new Map();
  for await (const o of store.iterate({ entityType: 'Outcome' })) {
    if (o.metadata?.run_task_id) outcomes.set(o.metadata.run_task_id, o.metadata);
  }
  const runs = [];
  for await (const r of store.iterate({ entityType: 'Run' })) {
    const m = r.metadata ?? {};
    if (m.pending && !includePending) continue;   // D-06 quarantine excluded by default
    runs.push({ ...m, score: scores.get(m.task_id) ?? null, outcome: outcomes.get(m.task_id) ?? null });
  }
  return runs;
}
```

### Corrected-wins effective value (UI helper)
```typescript
// D-03 — corrected if present, else judged, else null (render as —). Lock for aggregates.
function effective(dim: string, score: Record<string, number | null> | null): number | null {
  if (!score) return null
  const corrected = score[`corrected_${dim}`]
  return corrected != null ? corrected : (score[dim] ?? null)
}
function isEdited(dim: string, score: Record<string, number | null> | null): boolean {
  return !!score && score[`corrected_${dim}`] != null
}
```

### Drawer save (reuse existing PATCH — D-02)
```typescript
// One PATCH per edited dimension (the endpoint takes a single {dimension,value,overridden_by}).
// Respect the SAME ranges the server enforces (api-routes.js:411-455):
//   regressions ∈ {0,1}; the other four ∈ [0,1]; overridden_by non-empty, ≤256 chars.
await fetch(`/api/experiments/scores/${encodeURIComponent(taskId)}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ dimension, value, overridden_by: operatorId }),
})
// 400 = validation; 404 = score changed/missing → surface "reopen the run and try again" (UI-SPEC copy)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| token-usage.tsx fetches host:port (12435) directly | Same-origin reverse-proxy via server.js (llm-latency-tile.tsx) | Phase 34+/container era | New pages should use the same-origin proxy idiom, not direct host:port |
| (n/a — new) | shadcn `sheet` for drawers | this phase | First drawer in system-health-dashboard |

**Deprecated/outdated:** none relevant — the experiment stack (Phases 71–73) is current as of 2026-06-28.

## Runtime State Inventory

This is an additive feature phase (new page, new endpoints, one ontology-class fill-in). It is not a rename/refactor/migration. The one stateful change worth flagging:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | New `Report` entities will be written into `.data/experiments/leveldb` (and exported to `.data/experiments/exports/experiment.json`). No migration of existing data — Report is currently an empty stub with zero instances. | code only (new writer) |
| Live service config | None — no OS/service registration changes. | None — verified no launchd/scheduler touch |
| OS-registered state | None. | None |
| Secrets/env vars | None new. Reuses `CODING_REPO`, `LLM_PROXY_DATA_DIR` (already set). | None |
| Build artifacts | Dashboard frontend bundle must be rebuilt (`npm run build` + supervisor restart); `server.js` change needs full container restart (VirtioFS cache). | rebuild per CLAUDE.md |

**Ontology change caution:** filling in the `Report` class adds declared `properties`/`relationships`. Because `openExperimentStore` runs `ontologyStrict: false` (store.mjs:48), this is low-risk, but the ontology file is COPIED into test tmp dirs verbatim (score-override-endpoint.test.mjs:44-46) — Report-write tests will pick up the change automatically.

## Validation Architecture

> `.planning/config.json` has no explicit `workflow.nyquist_validation` key → treat as enabled.

### Test Framework
| Property | Value |
|----------|-------|
| Framework (experiment lib) | **`node:test` + `node:assert/strict`** — the established convention for `tests/experiments/*` (route-readers.test.mjs:15, score-override-endpoint.test.mjs:24). NOTE: package.json `"test"` defaults to **jest**, but the experiment suite deliberately uses node:test and is run per-file. |
| Framework (dashboard E2E) | Playwright (`playwright.config.ts` present; `tests/e2e/dashboard/*.spec.ts`) + **`gsd-browser` CLI** (verified on PATH) for visual smoke per CLAUDE.md |
| Quick run command | `node --test tests/experiments/<file>.test.mjs` |
| Full experiment suite | `node --test tests/experiments/` |
| E2E | `npx playwright test tests/e2e/dashboard/<spec>.spec.ts` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DASH-01 | `readRuns` returns Runs joined to Score/Outcome; pending excluded by default | unit | `node --test tests/experiments/run-read.test.mjs` | ❌ Wave 0 |
| DASH-01 | `GET /api/experiments/runs` returns rows from an isolated store (experimentRepoRoot) | unit | `node --test tests/experiments/runs-endpoint.test.mjs` | ❌ Wave 0 |
| DASH-02 | `readTimeline(taskId)` groups per-reasoning-step under per-turn; readonly DB; graceful empty on missing file | unit | `node --test tests/experiments/timeline-read.test.mjs` | ❌ Wave 0 |
| KB-04 | `writeReport` idempotent on report_id; `refreshReport` re-runs query + updates snapshot, same id | unit | `node --test tests/experiments/report-write.test.mjs` | ❌ Wave 0 |
| DASH-03 | Report read renders the FROZEN snapshot (stable across underlying Run changes until Refresh) | unit | `node --test tests/experiments/report-snapshot.test.mjs` | ❌ Wave 0 |
| D-02/SCORE-02 | Drawer Save round-trips through existing PATCH; corrected-wins reflected | unit (endpoint already covered) + E2E | existing `tests/experiments/score-override-endpoint.test.mjs` + new Playwright | partial (endpoint ✅, UI ❌) |
| DASH-01/02/03 | Performance tab renders, facets narrow runs, drawer opens, timeline expands, report saves | E2E (visual) | `gsd-browser navigate http://localhost:3032/performance` + `screenshot`; `npx playwright test tests/e2e/dashboard/performance.spec.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `node --test tests/experiments/<touched>.test.mjs`
- **Per wave merge:** `node --test tests/experiments/` (full experiment suite green)
- **Phase gate:** experiment suite green + Playwright `performance.spec.ts` green + a `gsd-browser` visual pass against `localhost:3032/performance` (CLAUDE.md E2E-verify rule — never claim UI works from DB queries alone).

### Snapshot stability test (DASH-03 — the load-bearing correctness property)
Seed a Report from a query, mutate an underlying Run/Score, re-read the Report → snapshot UNCHANGED. Then `refreshReport` → snapshot now reflects the mutation. This proves D-04's "stable until Refresh" contract.

### Override round-trip test (D-02/D-03)
PATCH a `corrected_*` dimension via the endpoint, then `readRuns` → effective value = corrected, judged preserved, "edited" derivable. Reuses the seeding helper in `score-override-endpoint.test.mjs:40-70`.

### Wave 0 Gaps
- [ ] `tests/experiments/run-read.test.mjs` — covers DASH-01 read/join
- [ ] `tests/experiments/runs-endpoint.test.mjs` — covers DASH-01 endpoint (use `experimentRepoRoot` isolation like score-override-endpoint test)
- [ ] `tests/experiments/timeline-read.test.mjs` — covers DASH-02 (seed a tmp token-usage.db OR point `dbPathOverride` at a fixture)
- [ ] `tests/experiments/report-write.test.mjs` + `report-snapshot.test.mjs` — covers KB-04/DASH-03
- [ ] `tests/e2e/dashboard/performance.spec.ts` — Playwright UI flow
- [ ] Shared seed helper: factor `seedIsolatedStore` (currently in score-override-endpoint.test.mjs:40) into a reusable fixture for the new tests

## Security Domain

> `.planning/config.json` has no explicit `security_enforcement: false` → treat as enabled.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Local operator dashboard; no auth layer in scope |
| V3 Session Management | no | n/a |
| V4 Access Control | partial | `overridden_by` is operator-supplied; no role enforcement (local tool) — keep as-is |
| V5 Input Validation | **yes** | Score override already validated server-side (dimension allowlist, value ranges, length cap — api-routes.js:411-455); **new endpoints** must validate `task_id`/`report_id` and bound all SQL params |
| V6 Cryptography | no | No secrets/crypto introduced |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection via task_id into token-usage.db | Tampering | ALWAYS bind `task_id` as `?` (token-aggregate.mjs:84-94 precedent, T-71-03-01); never interpolate |
| Becoming a second writer to the proxy-owned DB | Tampering/availability | Open `token-usage.db` `{ readonly: true }` only (token-aggregate.mjs:74) — sole-writer guardrail |
| Unvalidated override values corrupting Score | Tampering | Reuse the existing PATCH validation; mirror ranges client-side but DON'T trust client (server is authoritative) |
| Path/store confusion writing Reports to the shared KG | Tampering | Reports go ONLY through `openExperimentStore()` → dedicated LevelDB; never `UKBDatabaseWriter`/shared KG (same rule the PATCH handler enforces, api-routes.js:457-460) |
| XSS via report title / facet strings rendered in the UI | Tampering | React escapes by default; avoid `dangerouslySetInnerHTML`; treat snapshot/title as text |
| New `/api/experiments/*` GET leaking unintended data | Info disclosure | Endpoints expose only experiment Run/Score/Report fields — no secrets present in those entities; confirm no provenance/internal-only fields are over-serialized |

## Project Constraints (from CLAUDE.md)
- **km-core ontologyDir:** any code constructing `GraphKMStore` MUST pass `ontologyDir` → always use `openExperimentStore()`. Add an acceptance grep for `openExperimentStore` (not `new GraphKMStore`) in new endpoint/writer code.
- **no-console-log:** server-side `.mjs`/`.ts` use `process.stderr.write` only.
- **Dashboard rebuild (bind-mounted):** frontend → `npm run build` + `supervisorctl restart web-services:health-dashboard-frontend`; `server.js` backend → full `docker-compose restart coding-services` (supervisor-only restart re-reads stale VirtioFS cache).
- **E2E-verify with gsd-browser:** verify the Performance tab visually against `localhost:3032` — never claim UI works from DB/endpoint checks alone.
- **documentation-style skill:** invoke before any PlantUML/Mermaid/doc artifacts.
- **PlantUML:** `plantuml` CLI only.
- **TypeScript strict; never break working APIs for type compliance.**
- **Constraint dodging forbidden:** fix the underlying issue, don't swap to a pattern-matching-evading API.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `better-sqlite3` | Timeline read (DASH-02) | ✓ | installed (`require` OK) | — |
| `@fwornle/km-core` | Experiment store reads/writes | ✓ | workspace-pinned | — |
| `.data/experiments/leveldb` | Run/Score/Report store | ✓ | 5 Runs / 5 Outcomes / 5 Routes, 0 Scores currently | empty store → endpoints return [] gracefully |
| `.data/llm-proxy/token-usage.db` | Timeline rows | ✓ | present (48MB) | missing → timeline returns empty (token-aggregate.mjs:68 precedent) |
| vkb-server (:8080) | experiment endpoints | runtime service | — | 502 from server.js proxy if down (mirror token-usage 502, server.js:301) |
| `gsd-browser` CLI | UI visual verification | ✓ | on PATH | Playwright `npx playwright test` |
| Playwright | E2E specs | ✓ | `playwright.config.ts` + `tests/e2e/dashboard/` present | — |
| shadcn CLI | add `sheet` | (network at build time) | latest | UI-SPEC fallback: existing `dialog` |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** `sheet` (fallback `dialog`); token-usage.db (fallback empty timeline).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Same-origin proxy via server.js → `host.docker.internal:8080` is the right connectivity path (vs direct browser fetch to :8080) | Dashboard Connectivity | If the page is run in a context with direct :8080 access, a direct fetch would also work — but the proxy is the safer, container-consistent default. Planner should confirm the runtime context |
| A2 | Reports stored as `Report` entities in the experiment LevelDB (vs a lighter dashboard-side store) | Report Schema | CONTEXT D-05/discretion leaves this open; experiment store is the KB-04 "intended home" but planner may choose lighter storage. Schema design holds either way |
| A3 | Client-side faceting over a single fetched run set is sufficient at current/near-term scale | Standard Stack alternatives | If run count grows large (>>hundreds) before this phase ships, server-side filtering may be needed; additive, low risk |
| A4 | `granularity_tier` as a per-run sidebar facet (D-01 lists it) is best satisfied in the timeline view, since tier is a token-usage.db column not a Run field | Experiment Data Model | If a per-run tier facet is strictly required, it needs a per-run tier rollup from the timeline DB — flagged in Open Questions |
| A5 | km-core metadata stores serialized-JSON strings reliably for `facet_state`/`snapshot` (as Score does for event_labels) | Report Schema | Low risk — Score already serializes arrays into metadata this way (score-write.mjs:134) |
| A6 | The experiment `node:test` convention (not the jest default) is correct for new lib tests | Validation Architecture | Low risk — every existing tests/experiments/* file uses node:test |

## Open Questions

1. **Report storage location (D-05 discretion)**
   - What we know: `Report` ontology class is the KB-04 intended home; experiment store has a working idempotent-write pattern.
   - What's unclear: whether a lighter dashboard-side store would be cheaper to read for the Reports sub-view.
   - Recommendation: store in the experiment `Report` entity (consistency, single source of truth, the KB-04 mandate). Decide finally in planning.

2. **`granularity_tier` as a per-run facet (D-01) vs a timeline-only concern**
   - What we know: tier is a `token-usage.db` column, not a Run field; it varies WITHIN a run (per-turn + per-reasoning-step rows coexist for one task_id).
   - What's unclear: what "filter runs by granularity_tier" means when a single run spans multiple tiers.
   - Recommendation: surface the tier badge + tier filtering in the TIMELINE view (where it is meaningful per-row), and in the sidebar offer a per-run derived facet only if the planner confirms a clear semantic (e.g. "runs that have any per-reasoning-step data"). Document the chosen semantic.

3. **Connectivity path (A1)** — confirm whether `pages/performance.tsx` runs in a context with direct :8080 access or must ride the same-origin server.js proxy. Recommendation: add the proxy block (safe default).

## Sources

### Primary (HIGH confidence — read directly this session, with line citations)
- `lib/vkb-server/api-routes.js` — full file; experiment PATCH at :77/:403, transient-store pattern :457-468, `experimentRepoRoot` :40; NO experiment GET endpoints exist.
- `lib/experiments/store.mjs` — `openExperimentStore()`, ontologyDir requirement, single-owner caveat.
- `lib/experiments/score-write.mjs` — `writeScore` (idempotent strict write), `applyOverride` (override contract, dimension allowlist, ranges), metadata serialization.
- `lib/experiments/run-write.mjs` — Run/Outcome/Route keying, 8-tag schema, null-not-zero rule, domain bucketing.
- `lib/experiments/token-aggregate.mjs` — readonly token-usage.db query, bound-param SQL, graceful-missing-file.
- `lib/lsl/token/claude-token-rows.mjs` + `copilot-token-rows.mjs` + `token-db.mjs` — granularity_tier values, per-turn/per-reasoning-step linkage, full token_usage column list.
- `.data/ontologies-experiment/experiment-ontology.json` — Report stub (empty), all class shapes.
- `.data/experiments/exports/experiment.json` — live node counts (5 Run/5 Outcome/5 Route, 0 Score) + Run metadata key list.
- `integrations/system-health-dashboard/src/pages/token-usage.tsx` — page shell, fetch/state/layout conventions, threshold-badge triad.
- `integrations/system-health-dashboard/src/App.tsx` + `components/nav-bar.tsx` — route + tab registration mechanics.
- `integrations/system-health-dashboard/server.js` — token-usage reverse-proxy block (:291-302), port 3033, container-served context.
- `integrations/system-health-dashboard/src/components/system-health-dashboard.tsx` — vkb_server port 8080 / llm_cli_proxy 12435 mapping.
- `integrations/system-health-dashboard/src/components/llm-latency-tile.tsx` — same-origin reverse-proxy idiom for container pages.
- `tests/experiments/score-override-endpoint.test.mjs` + `route-readers.test.mjs` — node:test convention + isolated-store seeding helper.
- `74-CONTEXT.md`, `74-UI-SPEC.md`, `REQUIREMENTS.md` — decisions, UI contract, requirement text.

### Secondary (MEDIUM)
- CLAUDE.md / MEMORY.md — rebuild rules, km-core ontologyDir rule, port rules.

### Tertiary (LOW)
- none — no unverified web claims; this phase is entirely codebase-internal.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new backend deps; one shadcn component; all libs verified present.
- Architecture: HIGH — every surface read with line citations; two-store/two-port fact verified.
- Pitfalls: HIGH — derived from the actual write-path code comments and CLAUDE.md lessons.
- Report schema: MEDIUM — schema is a proposal (the class is genuinely empty today); shape is sound but D-05 leaves storage location to planning.

**Research date:** 2026-06-28
**Valid until:** 2026-07-28 (stable internal stack; re-verify if Phases 71–73 code or the experiment ontology change)
