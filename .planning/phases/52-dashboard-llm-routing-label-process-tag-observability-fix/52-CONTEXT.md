# Phase 52: Dashboard LLM routing label + process tag observability fix - Context

**Gathered:** 2026-05-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the dashboard's claim of "what model handled this sub-step" verifiable from telemetry, and let operators pin sub-step providers via the settings UI. Bug-fix style phase, outside v7.1 milestone scope.

**In scope:**
- Replace hardcoded `Groq: llama-3.3-70b-versatile` labels in `integrations/system-health-dashboard/src/components/workflow/constants.ts` (18+ literals) with live-derived model badges sourced from token-usage telemetry.
- Drive `process` tags to per-sub-step granularity (split current wave-level tags into per-sub-step tags) so the settings UI can pin providers at sub-step resolution.
- Close the wave-4 InsightGenerationAgent `unknown` process gap (carried over from 42.2-06-SUMMARY) by routing `semanticAnalyzer.analyzeContent()` through the existing `llmWithProcess` wrapper.
- Emit throttled per-item progress updates from every wave loop (wave1–wave4) so wave rows show live `{n}/{N}` counters with a progress bar instead of jumping 0→N at wave end.

**Out of scope (non-goals):**
- Changing the actual routing preference order (claude-code → copilot → groq → openai → anthropic). Routing already works correctly per the 2026-05-24 evidence.
- Reshaping the rapid-llm-proxy API surface or token_usage schema.
- Rolling forward any v7.1 milestone work (43/44/45/46).

</domain>

<decisions>
## Implementation Decisions

### Label correctness (Issue 1)
- **D-01: Live token-usage lookup is the source of truth for the badge.** Dashboard reads `/api/token-usage/recent` at render time, groups by `process` tag, badges each sub-step with the actual provider/model that served the most recent N calls for that tag.
- **D-02: Window = most-recent N (N=10) per process tag.** Reflects current routing without being noisy from week-old runs. Falls back to "no data yet" path when the table has no rows for the tag.
- **D-03: Empty-bucket fallback = preference-order tier label.** When a process tag has no calls yet, show `auto: claude-code → copilot → groq` (the documented preference order from `_work/rapid-llm-proxy/proxy-bridge/server.mjs:1470-1510`). Honest about not having seen a call yet, still tells the operator what's expected.
- **D-04: Reuse existing `/api/token-usage/recent`** endpoint (already consumed by `integrations/system-health-dashboard/src/pages/token-usage.tsx`). Filter by process tag client-side. Zero backend churn, no new API surface. NOT a new `/api/workflow/llm-badges` endpoint and NOT piggybacked on the SSE stream.

### Process tag granularity (Issue 2)
- **D-05: Per-sub-step tags.** Split current `wave-analysis-wave{1,2,3}` into per-sub-step tags. Initial split (planner finalizes the exact list from inner-loop inventory):
  - `wave-analysis-wave1-l1emit`
  - `wave-analysis-wave2-subcomponent`
  - `wave-analysis-wave3-detail-extract`
  - `wave-analysis-wave3-ontology-classify`
  - `wave-analysis-wave3-relation-discovery`
  - `wave-analysis-wave4-insight`
  - plus any additional sub-step tags surfaced when wave-4 routes through `llmWithProcess` (semantic-analyzer downstream callers).
- **D-06: Per-call-site override.** `createLLMWithProcess(WAVE_DEFAULT_TAG)` stays bound to a wave-level default; each call site that needs sub-step granularity passes `process` override at `.complete()` time. Minimal code change — existing wave-level callers keep working unchanged. NOT one wrapper instance per sub-step; NOT taskType-derived.
- **D-07: Frozen constants module is the single source of truth.** Introduce a registry (location TBD by planner — likely `integrations/mcp-server-semantic-analysis/src/agents/process-tags.ts` or a shared `lib/llm/` location, depending on what the dashboard can import) that exports a frozen object mapping logical sub-step → process tag string. Dashboard, settings UI, and agent call sites all import from this single module.
- **D-08: Dashboard maps UI rows → process tags by importing the registry directly.** Each `WORKFLOW_NODE` in `constants.ts` gets a `processTag` field referencing the registry. Type-safe — dashboard can't badge a row with a tag that doesn't exist. NOT a hand-maintained local mapping table; NOT a regex/heuristic derivation.

### Wave-4 + unknown stragglers (Issue 2 cleanup)
- **D-09: Route `semanticAnalyzer.analyzeContent()` through `llmWithProcess`.** Replace the SDK direct path inside `semantic-analyzer.ts` with the same `llmWithProcess` wrapper used by wave1/2/3. Single fix covers wave-4 InsightGenerationAgent AND every other agent that calls `semanticAnalyzer.analyzeContent()` (~5113, ~2508, ~2764, ~4338, ~5451 call sites in `insight-generation-agent.ts` alone). Caller passes `process`. Closes the deferred 42.2-06 item.
- **D-10: Success bar = zero `unknown` from semantic-analysis container.** Acceptance test: after a fresh wave-analysis run, query `token_usage.db` and assert `COUNT(*) WHERE process='unknown' AND <coding-services scope> == 0`. Hard contract. CI gate (or verification gate) — if a new agent slips through unnamed, it fails.
- **D-11: Operator settings UI auto-lists from registry.** Settings UI imports the same frozen `process-tags.ts` registry and renders one row per tag with provider/model override dropdowns. Always in sync with code. No manual UI updates when a new sub-step tag is added.

### Per-item progress feedback (Issue 3 — bundled in this phase)
- **D-12: Bundle Issue 3 in Phase 52** (not split to its own phase). Same display surface (workflow modal); one PR, one verification run keeps the dashboard-UX story coherent.
- **D-13: Throttled per-item progress emission.** Inside each wave loop call `coordinator.writeProgressPreservingDetails({ stepsDetail: { <wave>: { itemsCompleted: n, itemsTotal: N } } })` every K items (K=5) OR every 2s, whichever is later. Honors Phase 42.2-02 `PROGRESS_PRESERVE_KEYS` allowlist and Phase 10 race-condition guidance. NOT every-item (too much I/O); NOT dashboard-side token-usage polling (only counts LLM calls, misses non-LLM steps).
- **D-14: Instrument all four waves (wave1–wave4).** No asymmetry between waves on the dashboard. Surfaces during wave-3 detail-extract and wave-4 insight-generation (longest loops per NOTES.md) but wave-1 and wave-2 instrumented too for uniformity.
- **D-15: Dashboard renders `{n}/{N}` inline + thin progress bar.** Replace the static `8 → 8 → 8` arrows on the wave row with a live `47/107` counter and a thin progress bar. Falls back to old display when `itemsTotal` is missing (backward compat with older `workflow-progress.json` files). NOT spinner+ETA (out of scope for this phase).

### Claude's Discretion
- Exact list of sub-step process tags (the canonical names landing in `process-tags.ts`) — planner inventories the inner loops and finalizes the naming.
- Whether the frozen registry lives under semantic-analysis submodule or a shared `lib/` location (depends on whether the dashboard can import from the submodule's `dist/` cleanly; planner picks the path with least Docker-rebuild churn).
- Verification strategy for the zero-unknown bar (unit test vs integration probe vs post-run query script) — planner picks the cheapest enforceable option.
- Throttle constants (K=5 items, 2s minimum) — planner may adjust based on inner-loop call rates.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 52 pre-planning + carry-overs
- `.planning/phases/52-dashboard-llm-routing-label-process-tag-observability-fix/NOTES.md` — Original 2026-05-24 evidence base (Issue 1, Issue 2, Issue 3, suggested split). Now partially superseded by Phase 42.2 closure — re-read alongside this CONTEXT.md.
- `.planning/phases/42.2-retire-deferred-42-07-work-legacy-persistence-trio-atomic-le/42.2-06-PLAN.md` — Wave-1/2/3 process tag plumbing landed here; defines the `createLLMWithProcess` + `llmWithProcess.complete` pattern Phase 52 extends.
- `.planning/STATE.md` § "Documented follow-ups carried over from 42.2-06-SUMMARY" — locks the wave-4 InsightGenerationAgent gap as Phase 52 work.

### Agent-side LLM call surface
- `integrations/mcp-server-semantic-analysis/src/agents/llm-with-process.ts` — Existing `/api/complete` wrapper. Defines `createLLMWithProcess(processTag, metricsTracker)` (D-06) and `llmWithProcessComplete({ ...req, process })`.
- `integrations/mcp-server-semantic-analysis/src/agents/wave1-project-agent.ts:37,81` — `WAVE1_PROCESS_TAG = 'wave-analysis-wave1'` (current wave-level binding; planner extends to sub-steps).
- `integrations/mcp-server-semantic-analysis/src/agents/wave2-component-agent.ts:29,82` — `WAVE2_PROCESS_TAG = 'wave-analysis-wave2'`.
- `integrations/mcp-server-semantic-analysis/src/agents/wave3-detail-agent.ts:27,75` — `WAVE3_PROCESS_TAG = 'wave-analysis-wave3'`.
- `integrations/mcp-server-semantic-analysis/src/agents/insight-generation-agent.ts:632-638` — Wave-4 deep-insight call: `semanticAnalyzer.analyzeContent(prompt, { provider:'auto', taskType:'insight_generation', timeout:60000 })`. Target of D-09 refactor; ~5 such call sites in this file.
- `integrations/mcp-server-semantic-analysis/src/agents/semantic-analyzer.ts` — Houses `analyzeContent()`; the SDK direct path that currently bypasses `llmWithProcess` and yields `process='unknown'`.
- `CLAUDE.md` § "km-core LLM proxy endpoint" — `/api/complete` shape contract: `{ process, messages, taskType? }` request body. URL resolution precedence locked. Port 12435 host / `host.docker.internal:12435` container.

### Proxy + routing
- `_work/rapid-llm-proxy/proxy-bridge/server.mjs:1470-1510` — Routing logic: stage 0 process-pin → stage 1 explicit body.provider → stage 2 subscription hint → stage 3 preference order `['claude-code', 'copilot', 'groq', 'openai', 'anthropic']`. D-03 empty-bucket fallback uses this preference order.
- `_work/rapid-llm-proxy/.data/llm-proxy/llm-settings.json` — `processOverrides` map. Source-of-truth for hard-pins per process tag. New per-sub-step tags must be addable here (D-11 settings UI auto-lists them).
- `scripts/configure-wave-analysis-routing.sh` — Existing installer for wave-analysis-* `processOverrides`. May need extension when sub-step tags land (D-05) so first start still routes correctly.

### Telemetry + token usage
- `.data/llm-proxy/token-usage.db` — Schema: `(id, timestamp TEXT, provider, model, process, subscription, input_tokens, output_tokens, total_tokens, latency_ms, prompt_preview, ...)`. `process` defaults to `'unknown'` when not provided. Indexed on `timestamp`, `process`, `provider`. D-04 endpoint reads from this DB.
- `integrations/system-health-dashboard/src/pages/token-usage.tsx:270-271` — Existing fetch pattern for `/api/token-usage/summary` and `/api/token-usage/recent`. D-04 dashboard label fetch reuses this surface.

### Dashboard frontend surface
- `integrations/system-health-dashboard/src/components/workflow/constants.ts` — 18+ hardcoded `llmModel: 'Groq: llama-3.3-70b-versatile'` literals (D-01 replacement target). Line 603 `standard: 'llama-70b'` is the tier default.
- `integrations/system-health-dashboard/src/components/workflow/types.ts` — `WORKFLOW_NODE` type; gets a new optional `processTag?: string` field (D-08).
- `integrations/system-health-dashboard/src/components/workflow/trace-modal.tsx` — Renders wave rows + sub-step badges. D-15 inline `{n}/{N}` counter + progress bar lands here.

### Progress emission + state preservation
- `integrations/mcp-server-semantic-analysis/src/agents/coordinator.ts` § `writeProgressPreservingDetails` — Phase 42.2-02 single-writer + preserve-keys protocol. D-13 throttled emission MUST go through this method to respect the `PROGRESS_PRESERVE_KEYS` allowlist (stepPaused/pausedAtStep/pausedAt/mockLLM/mockLLMDelay/singleStepMode/stepIntoSubsteps/llmState).
- `integrations/mcp-server-semantic-analysis/src/workflow-runner.ts:469-530` — wave-analysis progress writing path; Phase 10 race-condition guidance per MEMORY.md ACTIVE block. Read before layering new progress writes (D-13).
- `.data/workflow-progress.json` — Live state file. `stepsDetail.{wave}.itemsCompleted` / `itemsTotal` are the fields D-15 reads.

### CLAUDE.md rules locked
- **rapid-llm-proxy routing**: `scripts/configure-wave-analysis-routing.sh` is REQUIRED on first start / after `.data/` wipe. Any new sub-step tag added in D-05 must be considered for inclusion in `processOverrides` defaults.
- **Submodule build pipeline**: `integrations/mcp-server-semantic-analysis` requires `npm run build` then Docker rebuild after any TS change. Dashboard (`integrations/system-health-dashboard/`) bind-mounted — `npm run build` only, restart frontend service.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`createLLMWithProcess`** (`llm-with-process.ts:236`): Factory that returns `{ complete }`. Already wired into wave1/2/3 agents. Pattern Phase 52 extends — per-call `process` override is a small wrapper change (currently `complete: (req) => llmWithProcessComplete({ ...req, process: processTag }, ...)`; D-06 allows `req.process` to override `processTag` default).
- **`/api/token-usage/recent` endpoint**: Already consumed by the Token Usage page. Phase 52 dashboard label fetch reuses the same surface — no new API.
- **Phase 42.2-02 `preserveFromExisting` helper** (module-level export in `coordinator.ts`): Allowlist guard for progress file writes. D-13 progress emission MUST honor this — write paths that bypass it re-introduce the Phase 42.2-02 race.
- **`MetricsTrackerLike` duck-typed interface** in `llm-with-process.ts`: Allows SDK-side `getDetailedCalls()` consumers to still see calls. D-09 semantic-analyzer refactor must preserve this so wave-controller tracer instrumentation keeps working.

### Established Patterns
- **Strangler-style tag plumbing** (Phase 42.2-02): When an LLM call site is missing a `process` tag, the fix is to swap the SDK direct path for `llmWithProcess` AND bind the SDK metrics tracker, NOT to add `process` parameter to the SDK wrapper. Phase 52 D-09 follows this.
- **Frozen constants for cross-module schema** (Phase 51 D-LSL-Filename precedent): Single-source-of-truth registry with grep gates is the project's preferred pattern over conventions or per-file constants. D-07 follows this.
- **Backward-compatible progress file shape** (Phase 42.2-02): New fields on `stepsDetail.{wave}` must be optional + fall back to old display when absent (D-15 itemsTotal-missing fallback).

### Integration Points
- **Submodule symlink topology**: `integrations/mcp-server-semantic-analysis/src/{ontology,knowledge-management}/` are symlinks to outer-repo paths (Phase 42.1.2 / 42.2-03 precedent). `src/agents/` is a real subdirectory — Phase 42.2-04 confirmed. Process-tags registry placement (D-07) interacts with this: outer-repo placement = single commit; submodule placement = submodule + pointer-bump pair.
- **rapid-llm-proxy bridge**: Phase 52 only consumes the proxy's existing `/api/complete` and `/api/token-usage/recent` surfaces. No proxy code change planned. `processOverrides` defaults installer (`scripts/configure-wave-analysis-routing.sh`) may need a small extension when new sub-step tags land (D-05).
- **Dashboard build cycle**: `integrations/system-health-dashboard/` is bind-mounted; D-01/D-08/D-15 changes only need `npm run build` + frontend service restart, not a Docker container rebuild.

</code_context>

<specifics>
## Specific Ideas

- NOTES.md called out the 2026-05-24 evidence: 6 copilot calls + 4 claude-code calls tagged `unknown` in a single wave-analysis run. As of 2026-05-28 (post-42.2 closure), wave1/2/3 are tagged correctly but the unknown bucket persists: 134 claude-code + 27 copilot calls over the last 3 days. Wave-4 + the `consolidator-*` paths likely account for most of this; the planner should run `sqlite3 .data/llm-proxy/token-usage.db "SELECT process, provider, model, COUNT(*) FROM token_usage WHERE timestamp > datetime('now','-3 days') GROUP BY process, provider, model ORDER BY 4 DESC"` against a fresh run to confirm the residual unknowns are all in the targeted refactor's scope.
- NOTES.md "68m 42s wave with essentially zero feedback" is the operator pain that motivates D-13–D-15.
- NOTES.md suggested 2-plan split (52-01 process tags, 52-02 dashboard labels). Phase 52 now bundles a third plan (per-item progress emission + dashboard render) per D-12. Planner should consider 3 plans: (1) process-tags registry + per-sub-step plumbing + semantic-analyzer refactor + zero-unknown gate, (2) dashboard live-lookup badges, (3) per-item progress emission + dashboard render. Final split is planner discretion.

</specifics>

<deferred>
## Deferred Ideas

- **Spinner + ETA on wave rows**: Considered for D-15 but out of scope. Requires sustained per-item latency measurement and rolling average; revisit after `{n}/{N}` baseline lands and operators report it's still not enough feedback.
- **`/api/workflow/llm-badges` dedicated endpoint**: Considered for D-04 but rejected in favor of reusing `/api/token-usage/recent`. If the client-side filter pattern proves too noisy under load, future phase could promote the badge resolution to a server-side endpoint.
- **Threshold-based unknown SLI (≤5%)**: Considered for D-10 but rejected in favor of zero-unknown hard gate. Lower-friction option remains available if the hard gate proves brittle on diagnostic/utility paths.
- **Periodic post-run query job for unknown enforcement**: Out of scope — D-10 verification at phase-close is enough for now. A standing job is a v8.x or out-of-milestone hygiene phase.
- **Auto-derived tags from `taskType`**: Considered for D-06 but rejected (couples proxy schema to internal taskType naming). Pattern remains available if the registry + per-call-site override approach proves too verbose.

### Reviewed Todos (not folded)
- `.planning/todos/pending/2026-05-23-orphan-digest-observation-refs.md` — Matched on keyword-score (0.6) but scope is observation/digest data integrity, not dashboard labels or process tagging. Belongs in a Phase-41 follow-up or its own data-repair phase.
- `.planning/todos/pending/2026-03-10-replace-console-log-with-proper-logging.md` — Matched on `process` keyword (0.4); generic tooling cleanup, not relevant to Phase 52's process-tag work.
- `.planning/todos/pending/2026-05-10-obs-api-libcxx-mutex-shutdown-crash.md` — Matched on observability area (0.3) but it's an obs-api SIGTERM crash, different surface entirely.

</deferred>

---

*Phase: 52-dashboard-llm-routing-label-process-tag-observability-fix*
*Context gathered: 2026-05-28*
