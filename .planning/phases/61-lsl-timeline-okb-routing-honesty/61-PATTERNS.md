# Phase 61: LSL Timeline & OKB Routing Honesty - Pattern Map

**Mapped:** 2026-06-20
**Files analyzed:** 6 (5 modify, 1 test-extend; 0 net-new source files)
**Analogs found:** 6 / 6 — every "new" capability has an in-file or adjacent idiom to copy

This phase is wiring, not building. Every modified file copies a pattern from itself
or an immediate sibling. RESEARCH.md already located the exact analog sites; this map
pins the concrete excerpts the planner should reference per file.

## File Classification

| Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------|------|-----------|----------------|---------------|
| `scripts/observations-api-server.mjs` (`/api/coding/lsl/sessions` handler) | route (express) | request-response / file-I/O | itself — same handler (`aggregateForRange`, `allEnts` scan, `res.json` envelope) | exact (in-file) |
| `integrations/unified-viewer/src/panels/coding/useLslSessions.ts` | hook | request-response | itself — `fetchSessions` body-shape branch + `WINDOW_MS`/`LslWindow` | exact (in-file) |
| `integrations/unified-viewer/src/panels/coding/LslTimelineStrip.tsx` | component | request-response (render) | itself — `fillClass` composition + `ToggleGroupItem` + `'all'` auto-slide | exact (in-file) |
| `integrations/unified-viewer/src/api/ApiClient.ts` | service (REST client) | request-response / transform | itself — `listRelations` normalizer + `listOntologyClasses` BC-wrap | exact (in-file) |
| `integrations/unified-viewer/src/config/system-endpoints.ts` | config | n/a (slug map) | itself — `System` slug + `isValidSystem` guard | exact (in-file) |
| `tests/integration/obs-api.coding-lsl-sessions.test.js` | test | request-response (assertion) | itself — existing per-session shape assertions | exact (in-file) |

---

## Pattern Assignments

### `scripts/observations-api-server.mjs` — `/api/coding/lsl/sessions` (route, request-response + file-I/O)

**Analog:** the handler itself (lines 2345-2468). Two additive fields: `total` (D-02) and per-session `source` (D-07/D-09). No new endpoint, no second query.

**(A) `total` count — copy the already-computed-then-discarded value (D-02)**

The walk already builds the full `sessions` array; `sessions.length` IS `M`. The slice at line 2462 currently throws it away. Surface it in the envelope (line 2463):

Current (line 2461-2463):
```js
sessions.sort((a, b) => (b.startAt > a.startAt ? 1 : b.startAt < a.startAt ? -1 : 0));
const sliced = sessions.slice(0, limit);
res.json({ success: true, data: { sessions: sliced } });
```
Target shape (additive — `total` before slice, `limit` echoes the applied cap):
```js
const sliced = sessions.slice(0, limit);
res.json({ success: true, data: { sessions: sliced, total: sessions.length, limit } });
```

**Cap raise (D-03):** caps are `LSL_DEFAULT_LIMIT = 200` / `LSL_MAX_LIMIT = 500` (lines 2291-2292). Client requests `limit=200` (useLslSessions.ts:49). Raising the client request to `500` (the existing server max) is the discretionary cap-raise; no server change needed unless >500 is wanted (then raise `LSL_MAX_LIMIT` in lockstep — request is clamped server-side at lines 2348-2351).

**(B) per-session `source` — extend the existing `allEnts` scan + `aggregateForRange` (D-07/D-09)**

The `allEnts` scan (lines 2390-2408) already enumerates every km-core node's attributes per session-range. It captures `{id, type, hidden, createdMs}` — add `source`. Mind Pitfall 3: source lives at `attrs.metadata?.source ?? attrs.source`.

Current scan push (lines 2401-2407):
```js
allEnts.push({
  id,
  type: attrs.entityType,
  hidden: HIDDEN_FROM_VIEWER.has(attrs.entityType)
    || (typeof attrs.name === 'string' && attrs.name.startsWith('[Raw]')),
  createdMs,
});
```
Add `source: (attrs.metadata && attrs.metadata.source) ?? attrs.source` to this object.

Then derive the session `source` inside `aggregateForRange` (lines 2423-2432), applying the PINNED **any-`manual`→`batch`, else `online`** rule (D-09):
```js
const aggregateForRange = (startMs, endMs) => {
  const matches = allEnts.filter((e) => e.createdMs >= startMs && e.createdMs < endMs);
  matches.sort((a, b) => TYPE_RANK(a.type) - TYPE_RANK(b.type));
  return {
    entityIds: matches.map((x) => x.id),
    totalCount: matches.length,
    // D-09: any matched entity tagged 'manual' marks the whole session 'batch';
    // pure online/auto/null windows (incl. empty) default to 'online' (= pink).
    source: matches.some((m) => m.source === 'manual') ? 'batch' : 'online',
  };
};
```
And add `source` to the per-session push (lines 2453-2459) — destructure it alongside `entityIds, totalCount` at line 2447, default `'online'` on the non-finite branch (line 2450).

**Logging idiom (project constraint):** keep `process.stderr.write(...)` for any new diagnostics (lines 2411, 2465) — NEVER `console.log` (CLAUDE.md `no-console-log`).

---

### `integrations/unified-viewer/src/panels/coding/useLslSessions.ts` (hook, request-response)

**Analog:** the hook itself. Three changes: `'all'`→`'1y'` rename, widen the body type for `total`, request `limit=500`.

**(A) `'all'`→`'1y'` rename (D-04, D-06).** Type (line 23) and `WINDOW_MS` key (line 33) — value unchanged:
```ts
export type LslWindow = '24h' | '7d' | '30d' | '1y'   // was 'all'
// ...
export const WINDOW_MS: Record<LslWindow, number> = {
  '24h': 24 * 3600_000,
  '7d': 7 * 24 * 3600_000,
  '30d': 30 * 24 * 3600_000,
  '1y': 365 * 24 * 3600_000,   // key renamed; 365d value unchanged per D-04
}
```

**(B) total-`M` plumbing — widen the existing body union, return an object (D-02).** The body type at lines 54-56 already tolerates `{ sessions: LslSession[] } | LslSession[]`. Widen the object arm and return `{ sessions, total, limit }`:
```ts
const body = (await res.json()) as
  | { success: true; data: { sessions: LslSession[]; total?: number; limit?: number } | LslSession[] }
  | { success: false; error: string }
// ... after the success guard:
const data = body.data
if (Array.isArray(data)) return { sessions: data, total: data.length }
return { sessions: data?.sessions ?? [], total: data?.total }
```
Change `fetchSessions`' return type from `Promise<LslSession[]>` to `Promise<{ sessions: LslSession[]; total?: number }>`, and update the `useLslSessions` consumers to read `data.sessions` / `data.total` (the strip computes `N = data.sessions.length`, `M = data.total`).

**(C) cap raise (D-03).** Line 49 — bump `limit=200` to `limit=500`:
```ts
const url = `${apiClient.base}/api/coding/lsl/sessions?since=${encodeURIComponent(since)}&limit=500`
```

**(D) header comment (D-03).** The hook header (lines 1-18) documents the 56.1 extraction contract, NOT the cap. Add a line documenting the bounded cap + the N-of-M badge meaning per D-03.

---

### `integrations/unified-viewer/src/panels/coding/LslTimelineStrip.tsx` (component, render)

**Analog:** the strip itself. Three changes: second `fillClass` hue, `'all'`→`'1y'` consumer sites, N-of-M badge.

**(A) bi-source tick color — add a `fillClass` branch (D-08).** The single branch point is lines 919-921. The disabled (`opacity-40`) and selection/halo (`ring-blue-*`) classes compose ON TOP unchanged (lines 908-928, 945) — do not touch them.

Current (lines 919-921):
```ts
const fillClass = isHaloBucket
  ? 'bg-blue-200/40 hover:bg-blue-300/50'
  : 'bg-pink-300 hover:bg-pink-400'
```
Target — split the non-halo arm on `s.source` (pink stays for online/auto per the existing `metadata.source==='auto'` convention documented in the inline comment at lines 939-944; amber recommended for batch per A2, NOT slate — slate reads too close to the `opacity-40` disabled dim):
```ts
const fillClass = isHaloBucket
  ? 'bg-blue-200/40 hover:bg-blue-300/50'
  : s.source === 'batch'
    ? 'bg-amber-300 hover:bg-amber-400'   // manual/batch (wave-analysis)
    : 'bg-pink-300 hover:bg-pink-400'     // online/auto (existing convention)
```
Add `source?: 'online' | 'batch'` to the `LslSession` interface (useLslSessions.ts:36-42). This mirrors the existing source→color mental model in `src/graph/color-fallback.ts:64-72` (`source === 'auto' ? ONLINE_PALETTE : BATCH_PALETTE`) — same provenance partition, different render surface.

**(B) `'all'`→`'1y'` consumer sites (D-06).** Per the research grep inventory, rename at:
- Auto-slide ladder fall-through (line 405): `: 'all'` → `: '1y'`
- `allOriginMs` guard (line 452): `if (windowKey !== 'all')` → `'1y'`
- `isAll` derivation (line 477): `const isAll = windowKey === 'all'` → `'1y'`
- `WINDOW_MS['all']` reads (line 479): → `WINDOW_MS['1y']`
- `onWindowChange` guard (line 497): `next === 'all'` → `next === '1y'`
- The `ToggleGroupItem` (lines 835-837): `value="all"` / `aria-label="All time"` / label `all` → `value="1y"` / `aria-label="1 year"` / label `1y`. The ladder context is lines 826-834 (24h/7d/30d items — copy that exact `className="text-[10px] h-6 px-1.5"` styling for consistency).
- Prose comments referencing `'all'` (lines 211, 319, 331, 334-336, 387, 446-450) — non-functional; update for clarity.

ToggleGroupItem idiom (lines 826-837) to copy verbatim for the renamed `1y` item:
```tsx
<ToggleGroupItem value="30d" aria-label="30 days" className="text-[10px] h-6 px-1.5">
  30d
</ToggleGroupItem>
<ToggleGroupItem value="1y" aria-label="1 year" className="text-[10px] h-6 px-1.5">
  1y
</ToggleGroupItem>
```

**(C) N-of-M badge (D-01/D-02).** Pure presentation of the two backend numbers from the hook. Render near the toggle row (lines 819-838) when `M > N`. Reuse the toggle's `text-[10px]` + `text-muted-foreground` (the scale-row uses `text-[10px] text-muted-foreground` at line 846) so it reads as chrome:
```tsx
{typeof total === 'number' && total > sessions.length && (
  <span className="text-[10px] text-muted-foreground px-1.5" data-testid="lsl-nofm-badge">
    showing {sessions.length} of {total}
  </span>
)}
```
`total` comes from `useLslSessions` (the widened `{ sessions, total }` return); `sessions.length` is the deduped count from the `useMemo` at lines 425-444 (note: dedup may make N < `data.sessions.length` — compare the badge `M` against the underlying `data.total`, and consider whether N should be the deduped `sessions.length` or raw — planner decides; the honest comparison is M-total vs what's actually rendered as ticks, i.e. `sessions.length`).

---

### `integrations/unified-viewer/src/api/ApiClient.ts` (service, request-response + transform)

**Analog:** the class's own normalizer idioms — `listRelations` (lines 115-137) and `listOntologyClasses` BC-wrap (lines 144-151). RESEARCH (Unknown 3) confirmed OKM's entity + relation shapes are already viewer-compatible, so **the only work is okb-scoped path rewrite** (`/api/v1/` → `/api/`), NOT a new normalizer.

**(A) okb-scoped path version — constructor param (D-10/D-11).** Scope strictly to `okb`; `coding` keeps `/api/v1/` unchanged. The constructor (line 82) gains an apiVersion param driven off the system slug:
```ts
constructor(
  private readonly baseUrl: string,
  private readonly apiVersion: 'v1' | 'legacy' = 'v1',
) {}

private apiPath(canonical: string): string {
  // canonical is the '/api/v1/...' path; OKM Express serves the legacy '/api/...' shape.
  return this.apiVersion === 'legacy'
    ? canonical.replace('/api/v1/', '/api/')
    : canonical
}
```
Then each hard-coded path routes through `apiPath(...)`:
- `listEntities` (line 112): `this.get<Entity[]>(this.apiPath('/api/v1/entities?limit=1000000'))` — NOTE: verify OKM doesn't 400 on `?limit=1000000` (Open Question 3); if it does, drop the query for the legacy branch.
- `listRelations` (line 131): `this.apiPath('/api/v1/relations')` — the normalizer body (lines 132-136) is UNCHANGED; OKM `/api/relations` returns the byte-identical graphology `{source,target,attributes.type}` shape this already maps to `{from,to,type}`.
- `listOntologyClasses` (line 145) + `getNeighbors` (line 161): path-rewrite too. NOTE: OKM has NO neighbors endpoint (404 on all variants) — `getNeighbors` will fail on okb; per A3 either compute 1-hop client-side from loaded relations or document okb node-expand as unsupported (planner decides; out of the locked decisions).

**Existing normalizer idiom to follow** (the established pattern, NOT to be duplicated — it already covers OKM):
```ts
// listRelations (lines 132-136) — graphology {source,target,attributes.type} → {from,to,type}
return raw.map((r) => ({
  from: r.source ?? r.from ?? '',
  to: r.target ?? r.to ?? '',
  type: canonicalizeRelationType(r.attributes?.type ?? r.type),
}))
```
```ts
// listOntologyClasses (lines 146-150) — BC-wrap string[] → [{name}]
if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'string') {
  return (raw as string[]).map((name) => ({ name }))
}
return raw as OntologyClass[]
```
The shared `{success, data}` envelope unwrap in `get<T>` (lines 89-100) works for BOTH systems unchanged — no envelope adapter.

**SCALE LANDMINE (research Pitfall 2):** OKM has 18,958 relations (13.7k `CORRELATED_WITH`). NOT a locked decision — flag a micro-decision (cap/drop `CORRELATED_WITH` or top-N by degree) before any E2E loads the full okb graph. If a relations filter is added, it slots as a `.filter(...)` in the `listRelations` map for the legacy branch only.

**(B) call-site wiring (D-11).** `ApiClient` is constructed per-system at `UnifiedViewer.tsx:421` with `SYSTEM_ENDPOINTS[system]`. Pass the version off the slug:
```ts
new ApiClient(SYSTEM_ENDPOINTS[system], system === 'okb' ? 'legacy' : 'v1')
```

---

### `integrations/unified-viewer/src/config/system-endpoints.ts` (config)

**Analog:** the file itself. okb is ALREADY retargeted to `:8090` (line 24, committed `7b3cbf67e`). No endpoint change needed — this file is the **branch source** for D-11 (the `System` slug the ApiClient version-switch keys off).

```ts
export type System = 'coding' | 'okb'           // line 18 — the branch discriminant
export const SYSTEM_ENDPOINTS: Record<System, string> = {
  coding: import.meta.env.VITE_BACKEND_CODING_URL ?? 'http://localhost:12436',
  okb:    import.meta.env.VITE_BACKEND_OKB_URL    ?? 'http://localhost:8090',  // line 24 — already :8090
}
export function isValidSystem(s: string | undefined): s is System {  // line 39
  return s === 'coding' || s === 'okb'
}
```
**Likely no edit here** — the okb-scoping branch lives at the `ApiClient` construction call (`UnifiedViewer.tsx:421`), driven off this `System` slug. Include only if the planner chooses to colocate an `apiVersion` map here (e.g. `SYSTEM_API_VERSION: Record<System,'v1'|'legacy'>`) rather than an inline ternary at the call site.

---

### `tests/integration/obs-api.coding-lsl-sessions.test.js` (test)

**Analog:** the file's own per-session shape assertions (lines 100-112) and the cap test (lines 159-165). Extend, don't restructure. Test harness already seeds km-core + LSL files and drives the in-process `app` (lines 35-98).

**(A) `total` field assertion (D-02).** Mirror the existing envelope test (lines 100-112) and the cap test (lines 159-165). After the cap test add: with `?limit=2` and 4 seeded sessions, `body.data.total === 4` while `body.data.sessions.length === 2` (the N<M case that drives the badge):
```js
test('returns total = full pre-slice count even when limit caps the array', async () => {
  const { body } = await httpGet('/api/coding/lsl/sessions?since=2026-05-01T00:00:00Z&limit=2');
  expect(body.data.sessions.length).toBe(2);
  expect(body.data.total).toBe(4);   // M > N — drives the N-of-M badge
});
```

**(B) `source` field + any-batch→batch rule (D-07/D-09).** The shape loop at lines 105-111 must add `expect(['online','batch']).toContain(s.source)`. To lock the any-`manual`→`batch` rule deterministically, seed km-core entities with `metadata.source: 'manual'` whose `createdAt` falls inside a seeded session's `[startAt, endAt)` window, and an online-only session, then assert the respective `source` values. Seed entities via the same `kmStore` used in `beforeAll` (lines 68-77) — add nodes with `createdAt` inside the `2026-06-09_1600-1700` window (one `metadata.source:'manual'`) and inside another window (only `auto`/`online`).

Header comment (lines 1-17) documents the pre-source contract — update the wire-shape line 7 to include `source` and `total`.

---

## Shared Patterns

### Source→provenance partition (online/auto vs manual/batch)
**Source:** `integrations/unified-viewer/src/graph/color-fallback.ts:64-72`
**Apply to:** obs-api `source` derivation AND the strip `fillClass` branch — keep the same mental model both sides.
```ts
const palette = source === 'auto' ? ONLINE_PALETTE : BATCH_PALETTE
```
The graph viewer keys `'auto'`→online(pink/red), else→batch. The strip + obs-api adopt the same two-bucket split: online (pink `bg-pink-300`) vs batch (amber). Backend (D-07) is the source of truth via `metadata.source`; the rule is any-`manual`→`batch` (D-09).

### REST response normalization (adapter idiom)
**Source:** `ApiClient.ts:132-136` (`listRelations`) + `144-151` (`listOntologyClasses` BC-wrap)
**Apply to:** the okb path-rewrite. The idiom is "map upstream shape → viewer shape inside the method, after the shared `get<T>` envelope unwrap." For OKM the SHAPES already match — only the path differs — so the okb work is `apiPath()` rewrite, not a new mapper. Do NOT duplicate `listRelations`.

### Truthful-failure UX (never swallow into empty)
**Source:** `UnifiedViewer.tsx:304-326` (error → `ErrorUnreachableState`) + `lib-domain/states.tsx:140-160`
**Apply to:** the okb path-rewrite (SC#5 / D-13). The error path is ALREADY truthful — `ApiClient.get` throws on `!res.ok` (lines 92-94), `useGraphData` surfaces `error`, `UnifiedViewer` renders `ErrorUnreachableState` with `baseUrl={apiClient.base}` (renders "Cannot reach {system} API at {baseUrl}" — line 149, includes `:8090`). The deliverable is to NOT regress it: never add `catch { return [] }` or `?? defaultEntities` near the okb branch (would degrade to `EmptyNoDataState` "no data" at line 324-325 instead of the unreachable banner). There is NO existing silent-fallback path to delete (RESEARCH Unknown 4 reframed D-13 — the premise was a stale build).
```tsx
return (
  <ErrorUnreachableState system={system} baseUrl={apiClient.base} onRetry={() => window.location.reload()} />
)
```

### Server logging idiom
**Source:** `observations-api-server.mjs:2411, 2465`
**Apply to:** any new obs-api diagnostics. Use `process.stderr.write(...)`, NEVER `console.log` (CLAUDE.md `no-console-log` — constraint dodging via other raw-write APIs is also forbidden).

---

## No Analog Found

None. Every modified file has an exact in-file or immediate-sibling idiom. This phase
introduces zero net-new source files and zero new packages.

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| — | — | — | All capabilities have an existing adjacent pattern (see assignments above) |

**Net-new test specs (Wave-0 gaps, no existing analog file but follow existing spec idioms):**
- "N of M" badge vitest — follows existing unified-viewer `*.test.ts` Vitest idiom (strip component test).
- SC#5 E2E (`:8090` down → `ErrorUnreachableState` text incl `:8090`) — follows `tests/e2e/unified-viewer/55-okb-routing.spec.ts` Playwright idiom; per CLAUDE.md visual smoke MUST use `gsd-browser`, structured specs under `tests/e2e/unified-viewer/`.
- `'all'` grep-absence / `1y` toggle render gate — unit/E2E.

---

## Metadata

**Analog search scope:**
- `integrations/unified-viewer/src/{api,config,panels/coding,graph,routes,lib-domain}/`
- `scripts/observations-api-server.mjs` (obs-api handler)
- `tests/integration/obs-api.coding-lsl-sessions.test.js`

**Files scanned:** 8 (ApiClient.ts, system-endpoints.ts, useLslSessions.ts, LslTimelineStrip.tsx, color-fallback.ts, UnifiedViewer.tsx, states.tsx, observations-api-server.mjs) + 1 test
**Pattern extraction date:** 2026-06-20
