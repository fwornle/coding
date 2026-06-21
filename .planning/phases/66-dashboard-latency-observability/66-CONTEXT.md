# Phase 66: Dashboard Latency Observability - Context

**Gathered:** 2026-06-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the worker-pool speedup **visible on the system-health dashboard**: surface the **median** claude-code fallback latency (per model), sourced from the same fallback-path telemetry the pool serves, so the ~14s → ≤3s improvement — and any regression back toward the ~14s baseline — reads off the dashboard within a day of rollout rather than only being provable by an ad-hoc probe (PERF-03).

**In scope:** computing a per-model median (p50) over the existing token-usage telemetry; surfacing it on the main dashboard + the Token Usage page with a regression-visible threshold treatment.

**Out of scope (own phases / deferred):** changing the worker pool itself; tagging telemetry cold-vs-warm; sub-agent observation capture; alerting/paging; historical retention changes. No production `proxy-bridge/worker-pool.mjs` behavior change is required by this phase (a read-only stats/query addition on the proxy is acceptable; pool logic stays put).

</domain>

<decisions>
## Implementation Decisions

### Display surface
- **D-01:** Surface the figure in **BOTH** places: (a) a headline **per-model tile** on the primary system-health dashboard (`:3032`, the page operators watch daily) for glanceability, and (b) the existing **Token Usage page** (`token-usage.tsx`) as the drill-down (recent calls, per-model detail). The tile is the at-a-glance "did the speedup land / is it holding" signal; the page is the detail view.

### Statistic
- **D-02:** The displayed statistic is the **median (p50)**, NOT the average. PERF-03 names median explicitly, and the dashboard already shows `AVG(latency_ms)` (insufficient — averages are skewed by occasional cold spawns / outliers). Median is the new computation this phase adds (no median/percentile exists anywhere in the codebase today). Recording max/p95 alongside is optional/nice-to-have, not required.

### Regression visibility
- **D-03:** Regression is made visible via **threshold color + trend** — each per-model median shows a trend indicator (vs the prior window) AND a color/badge that flips green→red when it crosses a regression threshold. Anchor the threshold to the established bars: **green ≤3s** (meets the PERF-01 warm steady-state bar), **red when climbing toward the ~14s baseline** (the worked example was `>5s = regressed`). Exact amber-band / threshold tuning is Claude's discretion for the planner; the contract is "an operator sees a regression at a glance without reading the number." This satisfies SC-2: a pool disabled via the `LLM_PROXY_DISABLE_WORKER_POOL` escape hatch or thrashing workers shows up as the median climbing and the badge turning red.

### Window & scope
- **D-04:** Show a **per-model breakdown** — a median row per claude-code model that flows through the fallback path (sonnet + opus), plus the **haiku direct-path** for context (haiku is served on the direct OAuth path, not the pool, so it carries NO regression threshold — it's shown as a reference baseline, not a pool-health signal). A single sonnet-only headline number was rejected in favor of per-model visibility.
- **D-05:** The canonical window is a **rolling 24h** median (matches PERF-03's "within 24h of rollout"). A selectable 1h/7d window was explicitly NOT chosen — keep one fixed 24h window for the headline tile to avoid scope creep (the planner MAY add a window control on the drill-down page only if cheap, but it is not required).

### Cold-spawn handling
- **D-06:** The median is computed over **ALL** claude-code fallback calls in the window, **including cold spawns** (the honest real-world number). No warm/cold tagging is added. Rationale: if the pool stays warm, cold spawns are rare and the median stays ≤3s; a cold-spawn storm (pool thrashing) *should* correctly push the median up and trip the regression badge. This deliberately avoids a production proxy change to record a cold/warm flag and keeps the displayed number honest about what operators actually experience.

### Data source (regression-faithful)
- **D-07:** The latency figure is sourced from the **same fallback-path token-usage telemetry the pool serves** — the proxy's `token-usage.db` (`provider`, `model`, `latency_ms` per `/api/complete` call). This is what makes a regression visible (SC-2): the displayed median tracks the same traffic the pool handles, so disabling the pool or thrashing it moves the number.

### Claude's Discretion
- WHERE the median is computed (proxy SQL query layer vs dashboard backend vs frontend over `/recent`) — architecture call for research/planner. Recommended path in `<code_context>` below: add a `MEDIAN(latency_ms)`/percentile query to the proxy's token-usage layer exposed via a thin endpoint/param, surfaced through the existing dashboard server proxy. SQLite has no native median — the planner picks the approach (ordered-offset subquery, percentile via window function on a recent-rows pull, or compute in JS over `/recent`).
- Exact regression threshold value(s) and amber band (within the D-03 green ≤3s / red-toward-14s envelope).
- Tile visual layout within the dashboard's existing tile/card system.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirement & milestone scope
- `.planning/ROADMAP.md` § "Phase 66: Dashboard Latency Observability" — goal + SC-1 (median surfaced, ~14s→≤3s visible within 24h) and SC-2 (sourced from same fallback traffic so regression is visible).
- `.planning/REQUIREMENTS.md` — PERF-03 (line ~43) and the v7.3 traceability row (PERF-03 → Phase 66).
- `.planning/research/v7.2-llm-proxy-perf-worker-pool.md` — milestone latency breakdown / acceptance seed (the ~14s baseline and ≤3s target this phase visualizes).
- `.planning/phases/65-steady-state-latency-crash-survival-acceptance/65-HUMAN-UAT.md` — the ≤3s warm steady-state was live-proven 2026-06-21; the bar this dashboard's green threshold anchors to.

### Latency telemetry source (rapid-llm-proxy — separate repo, local-only)
- `/Users/Q284340/Agentic/_work/rapid-llm-proxy/proxy-bridge/server.mjs` — `latencyMs = Date.now() - startTime` at ~line 1650; `logTokenCall()` persists `latency_ms`/`provider`/`model`/`process` to the token-usage DB at ~1662-1677; `/api/token-usage/summary?hours=` and `/api/token-usage/recent?limit=` endpoints (NO `/stats`/`/metrics`, NO median today).
- `/Users/Q284340/Agentic/_work/rapid-llm-proxy/src/token-usage.ts` (built to `dist/token-usage.js`) — `initTokenDb`/`logCall`/`getSummary`; `getSummary()` computes only `AVG(latency_ms)` (~line 707). The new MEDIAN/percentile query and any new endpoint param land here. DB path: `${LLM_PROXY_DATA_DIR}/llm-proxy/token-usage.db`.

### Dashboard surface (coding repo)
- `integrations/system-health-dashboard/src/pages/token-usage.tsx` — existing avg-latency UI: interface w/ `avg_latency_ms`/`avg_latency` (~105-126), "Avg Latency" card (~475-476), by-provider pie (~556-565), by-model table (~707-755), `formatLatency()` (~182), recent-calls table w/ per-call `latency_ms` (~821). Reuse `formatLatency` + the by-model table shape for the median rows.
- `integrations/system-health-dashboard/server.js` — token-usage reverse-proxy `GET /api/token-usage/:endpoint` → `http://host.docker.internal:12435/api/token-usage/{endpoint}` (~291-303); health-verifier status reshape (~236). The new median data rides this proxy pattern.
- `CLAUDE.md` — dashboard rebuild/restart procedure (frontend `npm run build` + `supervisorctl restart web-services:health-dashboard-frontend`; backend edits need full `docker-compose restart coding-services` due to VirtioFS cache); rapid-llm-proxy LLM endpoint is port **12435**.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **token-usage SQLite DB** already records `provider` + `model` + `latency_ms` + `process` per `/api/complete` call — ~80% of the data plumbing exists; the gap is a median query, not new instrumentation.
- **`/api/token-usage/summary|recent` endpoints + dashboard `server.js:291-303` proxy** — the channel to get latency data from proxy → dashboard already exists and is wired to `:12435`.
- **`token-usage.tsx`** — `formatLatency()`, the by-model table, and the page's fetch pattern (`PROXY_BASE`) are directly reusable for the per-model median rows + drill-down.

### Established Patterns
- **No median/percentile anywhere** — only `AVG()` aggregates; no rolling-window p50/p95 precedent to copy. The planner introduces the first one (SQLite has no native `MEDIAN`).
- **Metric flow** = source service stats endpoint → dashboard `server.js` reverse-proxy → React page fetch. A new main-dashboard tile follows this same source→backend→frontend path.

### Integration Points
- New per-model median tile plugs into the main system-health dashboard's existing tile/card grid (`:3032`).
- New median data is exposed by the proxy token-usage layer and consumed via the existing dashboard `/api/token-usage/*` proxy route (likely a new `:endpoint` like `latency` or a `percentile=50` param on `summary`).
- **Regression source to make visible:** `LLM_PROXY_DISABLE_WORKER_POOL=1` escape hatch (Phase 62 GUARD-01) and worker thrashing — both manifest as the median climbing in the same token-usage traffic.

</code_context>

<specifics>
## Specific Ideas

- Green ≤3s anchors to the PERF-01 warm bar (Phase 65); red as the median climbs toward the ~14s pre-pool baseline — the worked threshold example was `>5s = regressed`.
- Haiku is the direct-path reference row (no pool, no regression threshold) so operators can distinguish "fallback path latency" from "direct path latency".

</specifics>

<deferred>
## Deferred Ideas

- **Selectable time window (1h/7d)** on the headline tile — explicitly not chosen (D-05). May appear as a drill-down-page-only control if trivially cheap; otherwise a future enhancement.
- **Warm-vs-cold latency split** — would require a production proxy change to tag calls; deliberately out of scope (D-06).
- **Alerting/paging on regression** — this phase makes regression *visible*, not *actionable-via-alert*. Future observability phase.

### Reviewed Todos (not folded)
- `2026-06-10-sub-agent-dashboard-observability-gap.md` (score 0.9, "sub-agent observations from worktree-isolated Agent() calls don't reach dashboard") — matched on "dashboard"+"observability" but is a **different** concern (sub-agent observation capture, not LLM latency telemetry). Out of scope for PERF-03; belongs in an agent-capture/observability phase.
- `2026-06-10-okm-express-api-contract-bridge.md`, `2026-06-14-lsl-timeline-200-cap-and-all-window-misnaming.md`, `2026-06-14-vkb-legend-static-cross-domain-bleed.md` (score ~0.6) — unified-viewer / VKB / OKM concerns, unrelated to LLM latency observability. Deferred.

</deferred>

---

*Phase: 66-dashboard-latency-observability*
*Context gathered: 2026-06-21*
