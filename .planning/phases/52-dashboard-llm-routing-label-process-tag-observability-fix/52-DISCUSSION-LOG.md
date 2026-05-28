# Phase 52: Dashboard LLM routing label + process tag observability fix - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-28
**Phase:** 52-dashboard-llm-routing-label-process-tag-observability-fix
**Areas discussed:** Label correctness strategy, Process tag granularity, Wave-4 + unknown stragglers, Progress counter feedback (Issue 3)

---

## Label correctness strategy

### Q1 — How should the dashboard derive the per-sub-step LLM model badge?

| Option | Description | Selected |
|--------|-------------|----------|
| Live token-usage lookup | Dashboard reads /api/token-usage/recent at render time, groups by process tag, shows actual provider/model that served the most recent N calls. Truthful + self-updating. One extra fetch + cache invalidation on workflow tick. | ✓ |
| Static relabel to tier + fallback | Replace 'Groq: llama-3.3-70b-versatile' with 'standard / auto (claude-sonnet → copilot → llama-70b)'. Zero runtime cost, but stays a guess. | |
| Hybrid | Static tier label by default; live-lookup mode toggled via a 'Show actual model' switch. Adds UI complexity. | |

**User's choice:** Live token-usage lookup
**Notes:** Live data is the source of truth; no cosmetic guesses.

### Q2 — Which time window should the badge query against?

| Option | Description | Selected |
|--------|-------------|----------|
| Most-recent N | Last 10 calls per process tag in the token_usage table. Reflects current routing without being noisy. | ✓ |
| Current workflow run | Scope to the active wave-analysis run; most precise but requires exposing run boundary cleanly. | |
| Last 24h aggregate | Group by process+provider+model over last 24h, show modal split. More stable but blurs A/B comparisons. | |

**User's choice:** Most-recent N (N=10)

### Q3 — What should the badge show when a process tag has never been called (no data yet)?

| Option | Description | Selected |
|--------|-------------|----------|
| Preference order tier label | Show 'auto: claude-code → copilot → groq'. Honest + tells operator what's expected. | ✓ |
| Dash / em-dash | Cleanest visually; operator must wait until first call lands. | |
| Hardcoded fallback to last-known-good | Cache last seen value per process tag in localStorage. Persists across reloads but stale on first run. | |

**User's choice:** Preference order tier label

### Q4 — What's the data path — should the dashboard hit token-usage directly, or via a new badge-resolution endpoint?

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse existing /api/token-usage/recent | Dashboard fetches the same endpoint Token Usage page uses; filter by process tag client-side. Zero backend churn. | ✓ |
| New /api/workflow/llm-badges endpoint | Proxy adds a small endpoint that returns {process → latest provider/model}. Cleaner API but needs rapid-llm-proxy code change. | |
| Embed in /api/ukb/progress payload | Health coordinator joins token-usage when emitting workflow progress. Lowest dashboard complexity but couples health-coordinator to token-usage DB. | |

**User's choice:** Reuse existing /api/token-usage/recent

---

## Process tag granularity

### Q5 — Is wave-level granularity enough, or do we need per-sub-step tags?

| Option | Description | Selected |
|--------|-------------|----------|
| Per-sub-step | Split into wave-analysis-wave1-l1emit / wave2-subcomponent / wave3-detail-extract / wave3-ontology-classify / wave3-relation-discovery / wave4-insight. 1:1 with dashboard sub-step badges; settings UI can pin each independently. | ✓ |
| Wave-level only | Keep current 3 tags + add wave4. Simpler; sub-step badges in same wave all show same model. | |
| Per-wave + a few outliers | Wave-level baseline + split the 1-2 sub-steps that empirically dominate latency/call volume. | |

**User's choice:** Per-sub-step

### Q6 — How should the per-sub-step tag flow through the agent code?

| Option | Description | Selected |
|--------|-------------|----------|
| Per-call-site override | createLLMWithProcess stays bound to the wave-level default; each call site that needs sub-step granularity passes `process` override at .complete() time. Minimal code change. | ✓ |
| One wrapper instance per sub-step | Each agent constructs N instances of createLLMWithProcess. Clearer but adds boilerplate and risks drift. | |
| TaskType-derived (auto) | Wrapper derives process tag from req.taskType. Zero new params but couples proxy tag schema to internal taskType naming. | |

**User's choice:** Per-call-site override

### Q7 — Should the sub-step tag schema be locked in code or auto-derived?

| Option | Description | Selected |
|--------|-------------|----------|
| Frozen constants module | New process-tags.ts exports a frozen registry. Single source of truth that dashboard + settings UI also import. Grep gate keeps it in sync. | ✓ |
| Per-agent local constants | Each agent file defines its own sub-step tag constants near the call site. | |
| Convention + lint check | Tags follow naming convention enforced by unit test. No registry. | |

**User's choice:** Frozen constants module

### Q8 — How should the dashboard map UI sub-step rows → process tags?

| Option | Description | Selected |
|--------|-------------|----------|
| Import the registry directly | Dashboard imports the same process-tags registry; each WORKFLOW_NODE in constants.ts gets a processTag field. Type-safe. | ✓ |
| Hand-maintained mapping in constants.ts | Local STEP_TO_PROCESS table. Decouples but two files need to stay in sync. | |
| Heuristic by step ID | Derive process tag from step ID via regex/transform. Brittle and silent on mismatches. | |

**User's choice:** Import the registry directly

---

## Wave-4 + unknown stragglers

### Q9 — Wave-4 (InsightGenerationAgent) goes through `semanticAnalyzer.analyzeContent()` — not llmWithProcess. How do we close the gap?

| Option | Description | Selected |
|--------|-------------|----------|
| Route semanticAnalyzer through llmWithProcess | Replace the SDK direct path inside semantic-analyzer.ts with the same llmWithProcess wrapper. Single fix covers Wave-4 AND every other agent that calls analyzeContent. Closes deferred 42.2-06 item. | ✓ |
| Add process param to analyzeContent signature only | Thread `process?: string` through analyzeContent → SDK call options. Lighter touch but leaves direct-fetch shape (same drop-risk as before). | |
| Per-call llmWithProcess in InsightGenerationAgent only | Bypass semanticAnalyzer for the wave-4 deep-insight path. Cleaner per-agent but doesn't help other unknown callers. | |

**User's choice:** Route semanticAnalyzer through llmWithProcess

### Q10 — What's the success bar for closing the 'unknown' bucket?

| Option | Description | Selected |
|--------|-------------|----------|
| Zero `unknown` from semantic-analysis container | Acceptance test: query token_usage.db over a fresh wave-analysis run, assert COUNT(*) WHERE process='unknown' AND <coding-services scope> == 0. Hard contract. | ✓ |
| Best-effort — wave-1/2/3/4 tagged, others may slip | Only enforce that the 4 named waves emit their tags; tolerate residual unknowns. Lower friction. | |
| Threshold — ≤5% unknown across all coding-services calls | Set a numeric SLI. Accommodates drift; needs periodic check job. | |

**User's choice:** Zero `unknown` from semantic-analysis container

### Q11 — Should the operator settings UI surface the new sub-step tags for pinning?

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-list all known tags from registry | Settings UI imports the frozen process-tags registry and renders one row per tag with override dropdowns. Always in sync. | ✓ |
| Manual rows for the 4 waves only | Add 4 named rows; finer pinning works via raw JSON but not surfaced in UI. | |
| Defer settings-UI work to a follow-up phase | Phase 52 ships tags + dashboard label; settings UI lands later. | |

**User's choice:** Auto-list all known tags from registry

---

## Progress counter feedback (Issue 3)

### Q12 — Issue 3 (wave counters jumping from 0→N at wave end) is a different code path. In/out of Phase 52?

| Option | Description | Selected |
|--------|-------------|----------|
| Bundle in Phase 52 | Same display surface; one PR, one verification run keeps the dashboard-UX story coherent. | ✓ |
| Split to its own phase | Phase 52 stays narrow; progress-counter feedback isolates blast radius (Phase 10 race-condition zone). | |
| Defer indefinitely | Capture as deferred idea; revisit if it bites again. | |

**User's choice:** Bundle in Phase 52

### Q13 — How should per-item progress be emitted?

| Option | Description | Selected |
|--------|-------------|----------|
| Throttled writeProgressPreservingDetails per item | Inside each wave loop call coordinator.writeProgressPreservingDetails every K items (K=5) OR every 2s, whichever later. Honors Phase 42.2-02 preserve-keys + Phase 10 race-condition guidance. | ✓ |
| Every item, no throttling | Most responsive but more I/O + higher race-condition surface. | |
| Dashboard polls token-usage instead | Zero agent-side risk; only counts LLM calls (non-LLM steps show no progress). | |

**User's choice:** Throttled writeProgressPreservingDetails per item

### Q14 — Which inner loops get instrumented in this phase?

| Option | Description | Selected |
|--------|-------------|----------|
| Wave-3 detail-extract + Wave-4 insight-generation | The two longest-running loops. High operator value; smaller blast radius. | |
| All four waves (wave1–4) | Instrument every wave loop uniformly. More work + more risk, no asymmetry. | ✓ |
| Only wave-4 (insight-generation) | Smallest scope. Wave-3 detail-extract still snaps. | |

**User's choice:** All four waves (wave1–4)

### Q15 — How does the dashboard render the new itemsCompleted/itemsTotal fields?

| Option | Description | Selected |
|--------|-------------|----------|
| Inline `{n}/{N}` next to wave row + progress bar | Replace static `8 → 8 → 8` arrows with live `47/107` counter and thin progress bar. Falls back to old display when itemsTotal missing. | ✓ |
| Counter only, no bar | Just text. Less visual noise. | |
| Spinner + ETA | Most informative; needs sustained measurement + rolling average. | |

**User's choice:** Inline `{n}/{N}` next to wave row + progress bar

---

## Claude's Discretion

- Exact list of sub-step process tag strings (planner inventories inner loops and finalizes naming).
- Location of frozen registry — `integrations/mcp-server-semantic-analysis/src/agents/process-tags.ts` vs a shared `lib/llm/` location (depends on dashboard import path; planner picks least-Docker-rebuild option).
- Verification strategy for the zero-unknown bar (unit test vs integration probe vs post-run query script).
- Throttle constants for D-13 (K=5 items, 2s minimum) — planner may adjust based on inner-loop call rates.

## Deferred Ideas

- Spinner + ETA on wave rows (future phase if `{n}/{N}` baseline isn't enough feedback).
- Dedicated `/api/workflow/llm-badges` endpoint (future phase if client-side filtering proves noisy).
- Threshold-based unknown SLI (≤5%) — rejected for hard zero gate.
- Periodic post-run query job for unknown enforcement — out of scope.
- Auto-derived tags from `taskType` — rejected for explicit registry + per-call override.

### Reviewed todos not folded

- `2026-05-23-orphan-digest-observation-refs.md` (score 0.6) — observation/digest data integrity, different scope.
- `2026-03-10-replace-console-log-with-proper-logging.md` (score 0.4) — generic tooling cleanup, unrelated.
- `2026-05-10-obs-api-libcxx-mutex-shutdown-crash.md` (score 0.3) — obs-api crash, different surface.
