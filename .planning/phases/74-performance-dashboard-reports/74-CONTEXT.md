# Phase 74: Performance Dashboard & Reports - Context

**Gathered:** 2026-06-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver the operator-facing surface of the v7.4 Performance Measurement System: a new **"Performance" dashboard tab** (slotted after Tokens) that lets an operator (1) build task-anchored queries over experiment **Run**s, (2) read reasoning-cost and granularity-tier honestly in the timeline, (3) correct judged rubric scores via the score-override UI, and (4) save curated findings as durable **Report**s.

Requirements: **DASH-01** (task-anchored query-builder tab), **DASH-02** (timeline per-reasoning-step sub-bands + `granularity_tier` badge), **KB-04** (`Report` entity + saved-query workflow), **DASH-03** (Report views render a saved query against a stable results snapshot), plus ROADMAP SC#5 — the **SCORE-02 override UI** deferred from Phase 73 (D-07).

**In scope:**
- A new React page (`pages/performance.tsx`) + route registered in `App.tsx`, slotted after the Tokens tab.
- A **faceted-sidebar** query-builder over Runs in the experiment store.
- A **per-run detail drawer** with the 5-dimension rubric and editable `corrected_*` fields that drive the existing `PATCH /api/experiments/scores/:taskId` endpoint (no new write endpoint — UI only).
- A timeline view rendering per-reasoning-step rows as collapsible stacked sub-bands with an always-visible `granularity_tier` badge.
- Filling in the `Report` ontology entity schema (currently a schema-only stub) + a saved-query workflow + Report views.
- A **read/query REST surface** over the experiment store for the Performance tab (locate/extend the existing experiment REST surface in `lib/vkb-server/api-routes.js`).

**Out of scope (other phases / not this phase):**
- Changing the rubric schema, the judge, the `Score`/`Run`/`Route`/`Outcome` write keying, or the `token_usage` schema — all consumed read-only (Phases 68–73).
- The score-override **storage + PATCH API** — already shipped in Phase 73 (D-07); this phase calls it, does not re-implement it.
- Unrelated VKB / unified-viewer / observability dashboard fixes (see Deferred Ideas).

</domain>

<decisions>
## Implementation Decisions

### Query-builder model (DASH-01)
- **D-01:** **Faceted sidebar.** The query-builder is a left-rail facet panel (facets such as `task_id`, date window, route-class, `granularity_tier`, score-dimension thresholds) with live counts; clicking facets progressively narrows the Run set shown in the results table. Chosen over a flat structured filter form for discoverability. **Note for research:** this is a *new* interaction pattern for `system-health-dashboard` — confirm no existing faceted component, and identify reusable filter/table primitives before building from scratch.

### Score override UX (SC#5 / SCORE-02)
- **D-02:** **Per-run detail drawer.** Clicking a Run row opens a side drawer showing all 5 rubric dimensions with their **judged** values, **editable `corrected_*` fields**, and the rubric rationale. Save issues `PATCH /api/experiments/scores/:taskId` (the Phase 73 endpoint). Keeps the results table clean and gives room to show judged-vs-corrected side by side.
- **D-03:** **Corrected-wins display convention.** When a Run has a corrected (overridden) dimension, the results table shows the **corrected** value as the effective number with a small "edited" marker; the original **judged** value is revealed on hover and in the detail drawer. This realizes 73-CONTEXT **D-06**'s "corrected-wins-if-present" read convention — lock it for any averages/aggregations the table computes.

### Report save & snapshot (KB-04 / DASH-03)
- **D-04:** **Query + cached snapshot + manual Refresh.** "Save report" persists BOTH the query/facet-state definition AND a frozen results snapshot. Report views render the **snapshot** (stable, no bit-rot — satisfies DASH-03); a manual **Refresh** action re-runs the saved query and updates the snapshot (keeps the saved-query workflow alive — satisfies KB-04). Rejected: immutable-snapshot-only (goes stale, no refresh) and live-query-only (bit-rots).
- **D-05:** **Reports live as a sub-view inside the Performance tab.** A "Saved Reports" list/section within the Performance tab (saved facet-states), not a separate top-level nav tab — keeps top-level nav lean and keeps reports next to the query-builder that creates them.

### Timeline sub-bands + tier badge (DASH-02)
- **D-06:** **Collapsible sub-bands, collapsed by default.** Each parent turn shows an always-visible `granularity_tier` badge; expanding a turn reveals stacked per-reasoning-step sub-bands. The persistent tier badge is the honesty signal that discourages over-interpreting cross-tier averages; collapsed-default avoids flooding the timeline on long runs.

### Claude's Discretion
- Exact facet set and ordering in the sidebar (D-01) — start from the locked facets above; researcher/planner may add obvious ones (e.g., `not_scored`/`pending` score state) and must justify any beyond.
- Visual treatment of the "edited" marker and tier badge — follow existing dashboard component styling (shadcn/Card/badge conventions in `system-health-dashboard`).
- Report storage location/shape (experiment store `Report` entity vs a lighter dashboard-side store) — decide in planning based on where the query/snapshot is cheapest to persist and re-read; the `Report` ontology class is the intended home (KB-04).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 74 scope source
- `.planning/ROADMAP.md` §"Phase 74: Performance Dashboard & Reports" — goal, success criteria (incl. SC#5 the deferred score-override UI), dependencies (Phases 71/73 + 69/70), `UI hint: yes`.
- `.planning/REQUIREMENTS.md` — DASH-01 (line 59), DASH-02 (line 60), DASH-03 (line 61), KB-04 (line 55).

### Phase 73 substrate (scoring storage + override API this UI renders/calls)
- `.planning/phases/73-semantic-route-judge-success-scoring/73-CONTEXT.md` — D-05 (`Score` entity shape: `goal_aligned_ratio` + 5 judged dims + rationale), **D-06** (overrides stored as `corrected_*` + `overridden_by`/`overridden_at`; corrected-wins read convention), **D-07** (storage+PATCH in 73, override UI in 74).
- `lib/vkb-server/api-routes.js` — the live `PATCH /api/experiments/scores/:taskId` override endpoint (route at line 77, handler `handleScoreOverride` ~line 390) and the existing experiment REST surface to extend for read/query.
- `lib/experiments/score-write.mjs` — `applyOverride` (dimension allowlist, value ranges, stamps) the PATCH endpoint wraps; defines the override contract the UI must respect.

### Experiment store + ontology (the data the tab queries)
- `.data/ontologies-experiment/experiment-ontology.json` — classes `Experiment/Run/Route/Step/Decision/Outcome/Score/Report`. The `Report` class is currently a **schema-only stub** (`extends: Feature`, empty `properties`/`relationships`) — KB-04 fills it in.
- `.planning/phases/71-experiment-kb-task-taxonomy/71-CONTEXT.md` — the dedicated experiment `GraphKMStore`, Run keyed by `task_id`, idempotent re-close; how Runs/Outcomes/Routes are written (the rows this tab reads).
- `lib/experiments/store.mjs` — `openExperimentStore()` (the ontologyDir-aware store opener the read endpoints must use — see CLAUDE.md km-core `ontologyDir` rule).

### Dashboard integration points (where the UI lands)
- `integrations/system-health-dashboard/src/App.tsx` — React Router tab registration (add the `/performance` route after `/token-usage`).
- `integrations/system-health-dashboard/src/pages/token-usage.tsx` — the closest existing page pattern (filter + summary cards + table, fetches `/api/token-usage/*` via `PROXY_BASE`); model the Performance page on it.
- `CLAUDE.md` — dashboard rebuild rule (bind-mounted: `npm run build` + `supervisorctl restart web-services:health-dashboard-frontend`, no Docker rebuild) and the km-core `ontologyDir`/LLM-proxy port rules.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `pages/token-usage.tsx` — established page shape (summary cards + filtered table + `PROXY_BASE` fetch). The Performance page mirrors this structure; the faceted sidebar (D-01) is the net-new piece.
- `lib/vkb-server/api-routes.js` — already hosts the experiment PATCH endpoint and opens the experiment store transiently per request (single-owner LevelDB). Add the read/query GET endpoints here using the same transient `openExperimentStore` pattern.
- `lib/experiments/score-write.mjs` `applyOverride` + the override field contract — the drawer's Save path goes through the existing PATCH, so no new write logic.

### Established Patterns
- React Router page + `App.tsx` route registration; tabs are pages under `src/pages/`.
- Experiment-store access is **transient open → operate → close in finally** (honors single-owner LevelDB); all new read endpoints must follow it.
- Dashboard is bind-mounted — frontend changes need `npm run build` + frontend supervisor restart only (no Docker rebuild). Verify any UI change with `gsd-browser` against `localhost:3032` per CLAUDE.md (E2E-verify rule).

### Integration Points
- New `/api/experiments/*` GET/query endpoints in `lib/vkb-server/api-routes.js` ← consumed by the new `pages/performance.tsx`.
- Drawer Save → existing `PATCH /api/experiments/scores/:taskId`.
- `Report` ontology class (`experiment-ontology.json`) ← schema filled in for KB-04; Report persistence reads/writes via the experiment store.

</code_context>

<specifics>
## Specific Ideas

- The `granularity_tier` badge is explicitly an **honesty signal** (per ROADMAP SC#2) — its purpose is to stop operators averaging across tiers blindly, so it must stay visible even when sub-bands are collapsed (D-06).
- A saved Report is conceptually a **saved facet-state + frozen snapshot** (D-01 + D-04 compose): saving captures the current sidebar facet selection plus the resulting rows.

</specifics>

<deferred>
## Deferred Ideas

- Report **sharing/export** (CSV/permalink) — not in DASH-03 scope; note for a future dashboard phase if requested.
- Faceted-sidebar **cross-task analytics / charts** beyond the runs table — DASH-01 is a query-builder over runs, not a charting phase.

### Reviewed Todos (not folded)
The `todo.match-phase 74` scan returned 15 matches, all scoring ≤ 0.9 but on **observability / VKB / unified-viewer** surfaces, not the experiment Performance tab. None are in Phase 74 scope; left for their own observability/VKB phases:
- `obs-api crashes on SIGTERM with libc++abi mutex error` (0.9) — observability daemon, unrelated to the Performance tab.
- `Sub-agent observations from worktree-isolated Agent() calls don't reach dashboard` (0.9) — observations pipeline, not experiment Runs.
- `LSL timeline strip silently truncates history (200-record cap)` (0.6) — the **LSL** timeline strip, a different timeline from the DASH-02 experiment-run timeline.
- Remaining VKB filter/legend/ontology-bleed todos (0.4–0.6) — unified-viewer concerns, out of scope here.

</deferred>

---

*Phase: 74-performance-dashboard-reports*
*Context gathered: 2026-06-28*
