# Phase 66: Dashboard Latency Observability - Pattern Map

**Mapped:** 2026-06-21
**Files analyzed:** 4 (2 proxy repo, 2 dashboard repo) + 1 new tile component
**Analogs found:** 5 / 5 (all in-codebase; no RESEARCH.md exists)

> **Two-repo phase.** Files split across the standalone **rapid-llm-proxy** repo
> (`/Users/Q284340/Agentic/_work/rapid-llm-proxy/`) and the **coding** repo
> (`integrations/system-health-dashboard/`). The data path is:
> proxy SQL (`token-usage.ts`) → proxy HTTP endpoint (`server.mjs`) →
> dashboard reverse-proxy (`server.js`) → React UI (`token-usage.tsx` + new tile).

## File Classification

| New/Modified File | Repo | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|------|-----------|----------------|---------------|
| `src/token-usage.ts` (MODIFY — add median query) | rapid-llm-proxy | service / data-access | request-response (SQL aggregate) | `getSummary()` same file (`by_model` block) | exact (self-analog) |
| `proxy-bridge/server.mjs` (MODIFY — expose median) | rapid-llm-proxy | route | request-response | `/api/token-usage/summary` handler same file | exact (self-analog) |
| `integrations/system-health-dashboard/server.js` | coding | route (reverse-proxy) | request-response | `GET /api/token-usage/:endpoint` same file | exact (already generic — likely NO change) |
| `integrations/system-health-dashboard/src/pages/token-usage.tsx` (MODIFY — median rows) | coding | component (page/drill-down) | request-response (fetch+render) | by-model `<Table>` + `formatLatency` same file | exact (self-analog) |
| `.../src/components/llm-latency-tile.tsx` (NEW — `:3032` headline tile) | coding | component (dashboard tile) | request-response | `health-status-card.tsx` + token-usage Card cluster | role-match |

## Pattern Assignments

### `src/token-usage.ts` — add MEDIAN(latency_ms) per-model query (service, SQL aggregate)

**Analog:** the existing `by_model` aggregate inside `getSummary()`, same file.

**Where the avg lives today** — `getSummary()` per-model block (lines 807-814). SQLite
has **no native MEDIAN**; the planner adds a percentile/median query alongside this:
```typescript
const by_model = handle.db.prepare(`
  SELECT model,
         COUNT(*) AS calls,
         SUM(total_tokens) AS total_tokens,
         ROUND(AVG(latency_ms)) AS avg_latency
  FROM token_usage WHERE timestamp >= ?
  GROUP BY model ORDER BY total_tokens DESC
`).all(since) as Array<Record<string, number | string>>;
```

**`since` window derivation** (lines 774-779) — copy this exact rolling-window idiom
for the canonical 24h window (D-05). `hours` defaults to 24 already:
```typescript
const rawSince = Date.now() - hours * 3600_000;
const earliestRow = handle.db.prepare(
  `SELECT MIN(timestamp) AS earliest FROM token_usage`
).get() as { earliest: string | null };
const earliestMs = earliestRow.earliest ? Date.parse(earliestRow.earliest) : rawSince;
const since = new Date(Math.max(rawSince, earliestMs)).toISOString();
```

**Return-type contract** — `getSummary()`'s typed return object (lines 747-766) is the
shape callers expect. If the median rides on `getSummary` (recommended), add a
`p50_latency_ms` field to the `by_model` row type AND to the top-level return type.
If a new function (e.g. `getLatencyMedians`), mirror this explicit typed-return style.

**SQLite median approach** (Claude's discretion per D-07; no native MEDIAN):
- Ordered-offset subquery per model: `SELECT latency_ms FROM token_usage WHERE model=? AND timestamp>=? ORDER BY latency_ms LIMIT 1 OFFSET (cnt-1)/2` (needs a per-model count first), OR
- Pull recent rows and compute p50 in JS (cheap at 24h volumes), OR
- `PERCENTILE`-style window function over a model-grouped CTE.
The planner picks one. Whichever path, keep it inside the same `prepare(...).all(since)`
best-effort idiom — the existing aggregates never throw into a hot path.

**Provider/model fact for D-04:** `model` values are canonicalized at log time
(`canonicalizeModelName`, server.mjs:1665) — so per-model GROUP BY keys are stable
canonical names (e.g. `claude-sonnet-4-*`, `claude-opus-4-*`, haiku). `provider`
distinguishes the fallback path (`claude-code`) from haiku's direct path — filter/
label on `provider='claude-code'` to apply the regression threshold only to pool
traffic, and show haiku (different provider) as the no-threshold reference row.

---

### `proxy-bridge/server.mjs` — expose median over HTTP (route, request-response)

**Analog:** the `/api/token-usage/summary` GET handler, same file (lines 1398-1424).

**Copy this handler shape verbatim** (DB-init guard → URL parse → query → JSON):
```javascript
if (req.method === 'GET' && req.url?.startsWith('/api/token-usage/summary')) {
  if (!_tokenDb) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'token-usage DB not initialized' }));
  }
  try {
    const url = new URL(req.url, 'http://localhost');
    const hoursParam = url.searchParams.get('hours') || '24';
    const hours = hoursParam === 'all' ? 10 * 365 * 24 : parseInt(hoursParam, 10);
    const bucketRaw = url.searchParams.get('bucketMinutes');
    const bucketMinutes = bucketRaw ? parseInt(bucketRaw, 10) : undefined;
    const summary = getTokenSummary(_tokenDb, { hours, bucketMinutes });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(summary));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: err.message }));
  }
}
```
**Two exposure options (Claude's discretion):**
1. **Piggyback on `summary`** — if the median is added to `getSummary()`'s `by_model`,
   no new endpoint is needed; the dashboard already fetches `summary`. Lowest cost.
2. **New `/api/token-usage/latency` (or `?percentile=50` param)** — add a sibling
   `if (req.url?.startsWith('/api/token-usage/latency'))` block copying the above.
   This is what the `:endpoint` reverse-proxy in dashboard `server.js` will pass through
   unchanged (see next file).

**Import line to extend** (line 37) if a new exported fn is added to token-usage.ts:
```javascript
import { initTokenDb, logCall as logTokenCall, getSummary as getTokenSummary, getRecent as getTokenRecent, backfillCanonicalModelNames } from '../dist/token-usage.js';
```
**Build reminder:** token-usage.ts compiles to `dist/token-usage.js` — `npm run build`
in the proxy repo before the running proxy picks up the new query.

---

### `integrations/system-health-dashboard/server.js` — reverse-proxy (route, request-response)

**Analog / likely NO-CHANGE:** the existing generic `:endpoint` passthrough (lines 291-303).
```javascript
// Token Usage API (proxy to LLM proxy)
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
This route is already `:endpoint`-generic, so a new `/api/token-usage/latency` (option 2
above) is proxied **with zero edits**. Only touch this file if a non-`token-usage/*` path
is chosen — not recommended. Note host networking: the dashboard backend reaches the proxy
via `host.docker.internal:12435` (it runs in the coding-services container), whereas the
React page fetches the proxy directly on `localhost:12435` (PROXY_BASE — see tile note).

---

### `src/pages/token-usage.tsx` — median rows on the drill-down page (component, fetch+render)

**Analog:** the by-model `<Table>` render (lines 720-756) + `formatLatency` (lines 182-185),
same file.

**Reuse `formatLatency` as-is** (lines 182-185) for rendering median ms:
```typescript
function formatLatency(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms)}ms`
}
```

**Reuse the by-model table cell shape** (lines 754-755) — add a "Median Latency" column
beside the existing "Avg Latency" column. Existing avg cell:
```tsx
<TableCell className="text-right font-mono text-muted-foreground">
  {m?.avg_latency != null ? formatLatency(m.avg_latency) : <span>—</span>}
</TableCell>
```
The new median cell is identical but reads `m.p50_latency_ms` and applies the
threshold color/badge (see Shared Patterns → Threshold Color).

**Extend the `TokenSummary.by_model` interface** (lines 121-126) to carry the new field:
```typescript
by_model: Array<{
  model: string
  calls: number
  total_tokens: number
  avg_latency?: number
  // ADD: p50_latency_ms?: number
}>
```

**Fetch pattern** (lines 277-285) — already fetches `summary`; if median rides on
`summary` no fetch change is needed. If a separate `/latency` endpoint is added, add a
third `fetch(\`${PROXY_BASE}/api/token-usage/latency?hours=...\`)` to the `Promise.all`:
```typescript
const [sumRes, recRes] = await Promise.all([
  fetch(`${PROXY_BASE}/api/token-usage/summary?hours=${encodeURIComponent(hoursWindow)}`),
  fetch(`${PROXY_BASE}/api/token-usage/recent?limit=50`)
])
```
`PROXY_BASE = http://localhost:12435` (lines 18-19) — the page hits the proxy directly,
NOT through the dashboard server.js proxy (that proxy is for the container backend).

---

### `src/components/llm-latency-tile.tsx` — NEW headline tile on `:3032` (component, fetch+render)

**Primary analog:** `health-status-card.tsx` (the card component every `:3032` tile uses)
**Secondary analog:** the token-usage.tsx Card cluster (lines 472-496) for the
fetch-then-render-a-stat shape.

**Card structure to copy** (`health-status-card.tsx` lines 74-128) — Card → CardHeader
(title + icon) → CardContent → per-item rows with a status icon + badge. For the median
tile, each "item" is one model's median row (sonnet, opus, haiku-reference).

**Status→color mapping to copy/adapt** (`health-status-card.tsx` lines 46-72) — this is
the green/yellow/red treatment D-03 needs, already in the dashboard's idiom:
```tsx
const getStatusBadge = (status: string) => {
  switch (status) {
    case 'operational':
      return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">OK</Badge>
    case 'warning':
      return <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">Warning</Badge>
    case 'error':
      return <Badge variant="destructive">Error</Badge>
    ...
```
Map: median ≤3s → `operational` (green); amber band (Claude's discretion) → `warning`;
>5s climbing toward 14s → `error` (red). Haiku row → no threshold (render plain).

**Tile registration on the main dashboard** — `system-health-dashboard.tsx` lines 539-567
renders the 5-up tile grid; add the new tile into this grid:
```tsx
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
  <HealthStatusCard title="Databases" icon={<Database className="h-5 w-5" />} items={getDatabaseItems()} />
  ...
  <HealthStatusCard title="LLM Proxy Health" icon={<Brain className="h-5 w-5 text-purple-500" />} items={getProxyHealthItems()} />
  {/* ADD: <LlmLatencyTile /> (or a HealthStatusCard fed by median items) */}
</div>
```
Two registration choices (Claude's discretion per D-03 "tile visual layout"):
- **Reuse `HealthStatusCard`** by writing a `getLatencyItems()` builder that maps each
  model median → `{ name, status, description }` (status from the threshold). Cheapest,
  most consistent. The existing `getDatabaseItems()` (lines 120-145) is the builder template.
- **New `LlmLatencyTile`** component if a bespoke big-number layout is wanted.

**Data source caveat — main dashboard uses Redux, not local fetch.** `SystemHealthDashboard`
reads `useAppSelector((state) => state.healthReport)` (line 41); its tile builders consume
`healthReport.report.checks`. The median data does NOT come through that health report. So
the new tile must own its data via a local `useState`+`useEffect`+`fetch` (copy the
token-usage.tsx `fetchData` idiom, lines 273-297, with `REFRESH_INTERVAL = 30_000`). The
tile fetches from the dashboard backend proxy (`/api/token-usage/...`, same-origin) — NOT
`localhost:12435` directly, because the `:3032` page is served from the container and
should ride `server.js`'s `host.docker.internal` proxy.

## Shared Patterns

### Rolling 24h window (D-05)
**Source:** `src/token-usage.ts` lines 774-779 (`getSummary` since-clamp).
**Apply to:** the proxy median query. `hours` defaults to 24; clamp `since` to the earliest
real row so an empty/young DB doesn't break the query.

### Latency formatting
**Source:** `token-usage.tsx` `formatLatency()` lines 182-185.
**Apply to:** the drill-down median column AND the new `:3032` tile (import/duplicate it).

### Threshold color / regression badge (D-03)
**Source:** `health-status-card.tsx` `getStatusIcon` (46-57) + `getStatusBadge` (59-72).
**Apply to:** both the drill-down median cell and the headline tile. Green ≤3s / amber band
/ red toward ~14s (worked example >5s = regressed). Haiku (direct path) carries NO threshold.

### Best-effort SQL, never-throw-into-hot-path
**Source:** `token-usage.ts` `logCall` try/catch (701-724); all `getSummary` aggregates use
`prepare(...).all(since)` with no per-call throw.
**Apply to:** the new median query — wrap so a malformed/empty DB returns `[]`/`0`, not a 500.

### Endpoint shape (DB-guard → parse → query → JSON, 503/500 on failure)
**Source:** `server.mjs` `/api/token-usage/summary` (1398-1424).
**Apply to:** any new proxy endpoint for median data.

### Reverse-proxy passthrough (generic `:endpoint`)
**Source:** dashboard `server.js` lines 291-303.
**Apply to:** automatically covers any new `/api/token-usage/<x>` — no edit expected.

## No Analog Found

| Concern | Reason |
|---------|--------|
| SQLite p50/percentile query | No median/percentile exists anywhere in either repo — only `AVG()`. This is the first one; the planner introduces it (no in-codebase pattern to copy, only the avg query as a structural template). |
| Regression trend indicator (vs prior window) | D-03 asks for a trend arrow vs the prior window. No existing dashboard tile compares two time windows; the trend delta computation is net-new (compute current-24h median vs prior-24h median; the window/since idiom from `getSummary` is reusable but the comparison is new). |

## Metadata

**Analog search scope:**
- `/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/token-usage.ts`, `/proxy-bridge/server.mjs`
- `integrations/system-health-dashboard/server.js`
- `integrations/system-health-dashboard/src/pages/token-usage.tsx`
- `integrations/system-health-dashboard/src/components/{system-health-dashboard,health-status-card}.tsx`
**Files scanned:** 6
**Pattern extraction date:** 2026-06-21
