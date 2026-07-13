# Phase 80: Experiment Surface — Dashboard & Skill Packaging - Context

**Gathered:** 2026-07-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 80 surfaces the Phase 79 comparison in two places: (1) a **variant-column matrix view in the Performance dashboard tab** (CMP-04), fed by a live backend endpoint, and (2) a **single installed `experiment` skill** wrapping the full declare→run→compare flow, distributed across all driveable coding agents (ORCH-01). It is the final requirement gap of milestone v7.5.

**In scope:** a new "Comparison" sub-tab rendering the variant matrix; a new `GET /api/experiments/comparison` endpoint on the vkb-server that computes `buildComparison` over stored Runs; a `.claude/commands/experiment.md` skill wrapping run+compare; distribution via `generate-agent-instructions.sh`; visual verification (gsd-browser) + a Playwright test.

**Out of scope:** re-implementing the comparison logic (Phase 79's `buildComparison` is reused verbatim); the runner engine (Phase 78); any change to the Phase 79 JSON schema (it is FROZEN and consumed as-is).

</domain>

<decisions>
## Implementation Decisions

### Dashboard Surface (CMP-04)
- **D-01:** The variant comparison lives in a **new dedicated "Comparison" sub-tab** in the Performance tab (`performance.tsx` controlled `Tabs`: Runs | Avenues | Compare | Reports | **Comparison**). Do NOT overload the existing "Compare" tab (manual 2-run A/B `RunCompare`/DifferenceViewer) or "Reports" tab (Phase 74 saved queries) — both mean different things (audit false-positive trap).
- **D-02:** Matrix layout: **variants as columns, metrics/variance/gate-outcome as rows**, ranked (best composite first). Surface the ranked / failed / ungated / unscored groupings from the Phase 79 JSON, each variant's gate outcome, `n`, and the variance block. A variant with no successful runs shows as "no successful runs" — never a cheap winner (Phase 79 honesty spine carried through to the UI).
- **D-03:** Tab is selected by `task_hash` (an experiment identity). The view fetches for the currently-selected task_hash; reuse the existing run-selection/task context in `performanceSlice.ts`.

### Comparison Data Source (CMP-04)
- **D-04:** A **live backend endpoint** `GET /api/experiments/comparison?task_hash=X` on the **vkb-server** (`lib/vkb-server/api-routes.js`, NOT the dashboard `server.js` — that only proxies `/api/experiments/*` to `host.docker.internal:8080`). The handler opens the store transiently (open → `readRuns` → `buildComparison` → close), mirroring `handleRunsQuery` (api-routes.js:541+). Always fresh; no dependency on the CLI having been run.
- **D-05:** The endpoint returns the **frozen Phase 79 JSON schema** verbatim (`task_hash`, `rank_by`, `generated_at`, the four group arrays; each VariantEntry with `variant`, `n`, `gate_outcome`, optional `rank`/`composite`/`reason`, and the `{mean,stddev,median,min,max,n}` metrics block). Do NOT invent a new schema — reuse `buildComparison`'s output shape (see `scripts/experiments-compare.mjs` `writeReportJson` / `79-03-SUMMARY.md`). Optional `?rank_by=` query param maps to `buildComparison`'s rank override (default composite).
- **D-06:** Validate `task_hash` server-side (same allowlist as the CLI's `sanitizeTaskHash`) before use; the endpoint is read-only (open→read→close), no mutation.

### Skill Packaging (ORCH-01)
- **D-07:** A single installed **`experiment` skill** (`.claude/commands/experiment.md`) wraps the **full flow**: `experiment run --goal "..." --variants A,B --agents claude,opencode --repeats N` launches the matrix via `scripts/experiment-run.mjs`, then **auto-runs the comparison** (`scripts/experiments-compare.mjs`) and prints the ranked table + writes the report JSON (which the dashboard Comparison tab then reads live via D-04). Delivers success-criterion 3 (one-line command → rendered comparison).
- **D-08:** The skill is **distributed to all driveable coding agents** (claude, copilot, opencode, and mastra where targeted) via `scripts/generate-agent-instructions.sh` (the existing installer that copies/symlinks `.claude/commands/*.md` per agent — "installed N skill(s)"). Verify the skill appears in each agent's skill surface after running the installer.
- **D-09:** The skill is a **thin wrapper** — it shells to the existing `scripts/experiment-run.mjs` + `scripts/experiments-compare.mjs`; it does NOT reimplement runner or comparison logic. Copilot/OpenCode hook-schema quirks apply (see canonical refs — copilot hooks need `{version:1,hooks:{...}}`, no `$CODING_REPO` in cwd).

### Claude's Discretion
- Exact matrix cell formatting, column ordering within a rank tier, and how variance is visually rendered (e.g. `mean ± stddev` with median/range on hover).
- Redux slice shape for the comparison fetch (mirror the existing `performanceSlice` `createAsyncThunk` pattern).
- Skill file prose/structure (mirror an existing `.claude/commands/*.md`).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 79 substrate (REUSE — do not reimplement)
- `lib/experiments/compare.mjs` — `buildComparison` (the aggregator the endpoint calls) + `aggregateByVariant`/`isRankable`/`summaryStats`/`rubricScore`.
- `scripts/experiments-compare.mjs` — the CLI: `writeReportJson` (the FROZEN JSON schema to mirror), `sanitizeTaskHash` (reuse server-side), `--rank-by` semantics. The skill's compare step shells to this.
- `.planning/phases/79-comparison-aggregation-report/79-03-SUMMARY.md` + `79-02-SUMMARY.md` — the documented schema + D-08 (`rubric_score = goal_aligned_ratio`).

### Dashboard (CMP-04)
- `integrations/system-health-dashboard/src/pages/performance.tsx` — the controlled `Tabs` (Runs/Avenues/Compare/Reports at lines ~198-203); add the "Comparison" `TabsTrigger` + `TabsContent`.
- `integrations/system-health-dashboard/src/store/slices/performanceSlice.ts` — Redux state; add a `createAsyncThunk` for the comparison fetch (mirror the existing runs/timeline/reconciliation thunks).
- `integrations/system-health-dashboard/src/components/performance/runs-table.tsx` — existing variant provenance handling (variant/base_variant) for reference; NOT the matrix.
- `integrations/system-health-dashboard/server.js:346` — the `/api/experiments/*` proxy to `host.docker.internal:8080` (NO change needed — it forwards the new route automatically).

### Backend endpoint (CMP-04)
- `lib/vkb-server/api-routes.js` — register `app.get('/api/experiments/comparison', ...)` near lines 91-95; add `handleComparison` mirroring `handleRunsQuery` (line 541+, the open→`readRuns`→close transient-store idiom). Import `buildComparison` from `../experiments/compare.mjs`.

### Skill packaging (ORCH-01)
- `scripts/experiment-run.mjs` — the run-matrix CLI (78-04) the skill wraps.
- `scripts/generate-agent-instructions.sh` — the skill installer (distributes `.claude/commands/*.md` to each agent; "Claude: installed N skill(s)" at ~line 122).
- `.claude/commands/sl.md` / `documentation-style.md` — existing skill-file shape to mirror.
- Memory: `feedback_copilot_hook_schema.md` — copilot hooks need `{version:1,hooks:{...}}` type/bash, no `$CODING_REPO` in cwd; `reference_uniform_token_capture_agents.md` — opencode headless needs `--dangerously-skip-permissions`.

### Requirements
- `.planning/REQUIREMENTS.md` §CMP-04 (line 48), §ORCH-01 (line 52).
- `.planning/ROADMAP.md` §"Phase 80" — goal + 3 success criteria (esp. #3: one-line command → rendered dashboard comparison end-to-end).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `buildComparison` (compare.mjs) — the endpoint is a thin HTTP wrapper: open store → readRuns → buildComparison → JSON. No new comparison logic.
- `handleRunsQuery` (api-routes.js:541+) — the exact transient-store pattern (`open → readRuns → close` on the single-owner LevelDB) to clone for `handleComparison`.
- The Performance tab's controlled `Tabs` + `performanceSlice` Redux store — the Comparison tab is a new tab + a new async thunk + a matrix component; no new page.

### Established Patterns
- Dashboard state = Redux (`createSlice`+`createAsyncThunk`, `store/slices/performanceSlice.ts`) — NOT local `useState` (see memory `project_dashboard_redux_state`).
- `/api/experiments/*` is proxied dashboard→:8080; all new experiment endpoints go on the vkb-server, not the dashboard server.
- Skill install is centralized in `generate-agent-instructions.sh`; adding a `.claude/commands/experiment.md` + re-running it distributes to all agents.

### Integration Points
- **Upstream:** consumes Phase 79's `buildComparison` (backend) + frozen JSON schema (frontend). Schema drift between 79 and 80 = broken tab, so the endpoint reuses buildComparison directly rather than re-deriving.
- **Downstream:** the installed skill's compare step writes the report JSON AND the dashboard fetches live — both paths surface the same Phase 79 comparison.

### MANDATORY build + verification (project rules)
- **Dashboard is bind-mounted** (not `docker-compose build`): after editing, `cd integrations/system-health-dashboard && npm run build` then `docker exec coding-services supervisorctl restart web-services:health-dashboard-frontend` (frontend bundle) — VirtioFS caches, so a restart is required (CLAUDE.md). Backend (`server.js`) change would need full container restart — but D-04 puts the endpoint on the vkb-server, not server.js.
- **vkb-server** (`lib/vkb-server/`) runs on :8080 — confirm how it's restarted to pick up the new route (it is NOT the dashboard container).
- **Visual verification is MANDATORY** (user standing preference, memory `feedback_e2e_verify` / `feedback_dashboard_screenshots_gsd_browser`): verify the Comparison tab renders at `localhost:3032` via **gsd-browser** (navigate/screenshot/click), NOT a hand-rolled Playwright script. Add a structured Playwright test under `tests/e2e/` for the variant-column rendering (memory `feedback_green_nodes`: ALWAYS write Playwright tests for graph/coloring-style UI). Never claim "works" from DB/endpoint queries alone.

</code_context>

<specifics>
## Specific Ideas

- One-command end-to-end is the headline (success-criterion 3): `experiment run …` → matrix runs → auto-compare → ranked table in terminal AND the dashboard Comparison tab shows the same variant matrix (fetched live). Both surfaces, one source (buildComparison).
- Carry the Phase 79 honesty spine into the UI: failed/ungated/unscored variants are visibly separated, never rendered as a cheap winner.

</specifics>

<deferred>
## Deferred Ideas

- None — discussion stayed within CMP-04 + ORCH-01 scope. (This is the last requirement gap of v7.5; remaining milestone work is Phase 78-05 live verification + close-out, tracked separately.)

</deferred>

---

*Phase: 80-experiment-surface-dashboard-skill-packaging*
*Context gathered: 2026-07-13*
