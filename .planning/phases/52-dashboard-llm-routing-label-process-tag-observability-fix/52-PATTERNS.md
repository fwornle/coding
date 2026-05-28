# Phase 52: Dashboard LLM Routing Label + Process Tag Observability Fix — Pattern Map

**Mapped:** 2026-05-28
**Files analyzed:** 13 (5 new / 8 modify)
**Analogs found:** 13 / 13 (100% — all targets have strong existing precedents in-repo)

---

## File Classification

| File | Status | Role | Data Flow | Closest Analog | Match Quality | Topology |
|------|--------|------|-----------|----------------|---------------|----------|
| `integrations/mcp-server-semantic-analysis/src/agents/process-tags.ts` | **NEW** | shared registry / frozen constants | constant export | `integrations/mcp-server-semantic-analysis/src/agents/wave1-project-agent.ts:37` (current `WAVE1_PROCESS_TAG` literal) | role-match (frozen object analog: `coordinator.ts:50-63` `PROGRESS_PRESERVE_KEYS`) | submodule real dir → **submodule + pointer-bump pair** |
| `integrations/mcp-server-semantic-analysis/src/agents/wave1-project-agent.ts` | modify | agent / LLM caller | request-response | self (3 existing `llmWithProcess.complete` call sites at 270, 452, 937) | exact | submodule real dir |
| `integrations/mcp-server-semantic-analysis/src/agents/wave2-component-agent.ts` | modify | agent / LLM caller | request-response | self (2 existing call sites at 394, 597) | exact | submodule real dir |
| `integrations/mcp-server-semantic-analysis/src/agents/wave3-detail-agent.ts` | modify | agent / LLM caller | request-response | self (2 existing call sites at 389, 595) | exact | submodule real dir |
| `integrations/mcp-server-semantic-analysis/src/agents/semantic-analyzer.ts` | modify | service / LLM proxy | request-response | `llm-with-process.ts` factory + wave1 wiring | exact (strangler swap) | submodule real dir |
| `integrations/mcp-server-semantic-analysis/src/agents/insight-generation-agent.ts` | modify | agent / LLM caller (5 sites) | request-response | wave1 `.complete()` call-site shape | role-match (must thread `process` through `AnalysisOptions`) | submodule real dir |
| `integrations/mcp-server-semantic-analysis/src/agents/wave-controller.ts` | modify | orchestrator / progress emitter | event-driven / progress-write | self (`updateStepOutputs('wave4_insights', { planned, generated, ... })` at line 2851) | exact | submodule real dir |
| `integrations/system-health-dashboard/src/components/workflow/constants.ts` | modify | config / agent definitions | static export | self (`WORKFLOW_AGENTS` literal array, 24 entries) | exact | bind-mounted (no Docker rebuild) |
| `integrations/system-health-dashboard/src/components/workflow/types.ts` | modify | type definitions | type export | self (`AgentDefinition` interface, line 6-22) | exact | bind-mounted |
| `integrations/system-health-dashboard/src/components/workflow/hooks.ts` (or trace-modal-internal hook) | **NEW** | React hook / live fetch | request-response (interval) | `integrations/system-health-dashboard/src/pages/token-usage.tsx:265-289` (`fetchData` + `useEffect` polling pattern) | exact | bind-mounted |
| `integrations/system-health-dashboard/src/components/workflow/trace-modal.tsx` | modify | UI / wave row render | event-driven | self (`EntityFlowBadge` at line 131-141 — same inline-badge shape as new `{n}/{N}` counter) | exact | bind-mounted |
| `scripts/configure-wave-analysis-routing.sh` | modify (optional / D-05 follow-on) | shell installer | config-write | self (existing entries for `wave-analysis-wave{1,2,3}`) | exact | outer-repo |
| `.planning/phases/52-.../tests/zero-unknown.test.ts` or post-run query script (D-10) | **NEW** | verification gate | batch / SQL query | `scripts/backfill-raw-observations.mjs` (sqlite open + query pattern) | role-match | outer-repo |

**Topology summary** (CRITICAL for commit topology):
- All files under `integrations/mcp-server-semantic-analysis/src/agents/` are in a **real subdirectory** of the submodule (verified `ls -la`: `drwxr-xr-x`). Changes there require the **submodule + outer-repo pointer-bump pair** (matches Phase 42.2-04 precedent commit `a27aac6` + `8bfee7faf`).
- `integrations/mcp-server-semantic-analysis/src/ontology` and `src/knowledge-management` are **symlinks** to outer-repo paths — but Phase 52 does not touch them.
- All `integrations/system-health-dashboard/src/` files are bind-mounted; **`npm run build` + frontend supervisorctl restart** is the rebuild cycle, no Docker container rebuild.

---

## Pattern Assignments

### 1. `src/agents/process-tags.ts` (**NEW** — frozen registry module)

**Analog A (per-wave-level literal pattern):** `src/agents/wave1-project-agent.ts:37`

```typescript
// Phase 42.2 Plan 02 Gap 2 — process-tag for token-usage attribution.
// Wave1 enrich + analyze + observation-retry all share this tag (forensics
// report §2.1 row 1-3). The proxy reads `body.process` and stores it in
// `.data/llm-proxy/token-usage.db` for operator per-step routing config.
const WAVE1_PROCESS_TAG = 'wave-analysis-wave1';
```

**Analog B (frozen-object exported registry shape):** `src/agents/coordinator.ts:50-63`

```typescript
const PROGRESS_PRESERVE_KEYS = [
  'stepPaused',
  'pausedAtStep',
  'pausedAt',
  'mockLLM',
  'mockLLMDelay',
  'singleStepMode',
  'stepIntoSubsteps',
  'llmState',
] as const;

const PROGRESS_PRESERVE_NESTED: ReadonlyArray<readonly [string, string]> = [
  ['config', 'singleStepMode'],
] as const;
```

**Pattern to copy:**
1. File-level JSDoc following the `llm-with-process.ts:1-35` doc header style (rationale paragraph, design decisions bullet list, `@module` tag, references to the proxy contract in `_work/rapid-llm-proxy/proxy-bridge/server.mjs`).
2. Single named export of a frozen `Record<LogicalSubStep, ProcessTag>` typed by `as const` so consumers get string-literal narrowing (matches the `as const` modifier on lines 59 & 63 of coordinator.ts).
3. No runtime dependencies; no imports beyond `type`-only if any.
4. No `console.*` — write to `process.stderr` only if logging is ever needed (per CLAUDE.md constraint mandate).
5. Module placement: `integrations/mcp-server-semantic-analysis/src/agents/process-tags.ts`. Co-locates with the three current consumers (`wave1/2/3-*-agent.ts`) which all already use `.js` extension on relative imports — registry imports must follow `./process-tags.js` ESM convention (see wave1 line 31: `import { createLLMWithProcess } from './llm-with-process.js';`).

**Topology call-out for planner:** Because `src/agents/` is a **real submodule subdir**, adding `process-tags.ts` lands as a single submodule commit. The outer-repo dashboard consumes the registry by **importing from the compiled `dist/`** via the existing bind-mount (the submodule's `dist/agents/process-tags.js` will be present after `npm run build`). Alternative — pure outer-repo placement — would let the dashboard import without `npm run build`, but would force every wave-agent import to use `../../../../src/agents/process-tags.js` which breaks the symlink consistency. Recommend submodule placement; planner has discretion.

---

### 2. `src/agents/wave{1,2,3}-*-agent.ts` (modify — replace literal with registry import + per-call override)

**Analog:** self — the existing wired call-site at `wave1-project-agent.ts:267-279`

```typescript
// Phase 42.2 Plan 02 Gap 2 — route through llmWithProcess so the
// proxy's token-usage telemetry attributes this call to
// process='wave-analysis-wave1' (no longer 'unknown').
const enrichResult = await this.llmWithProcess.complete({
  messages: [{ role: 'user', content: enrichPrompt }],
  taskType: 'semantic_analysis',
  agentId: 'wave1_project_enrich',
  tier: 'standard',
  maxTokens: 2048,
  temperature: 0.7,
  timeout: 60_000,
  responseFormat: { type: 'json_object' },
});
```

**Pattern to copy (D-06 — per-call-site override):**

The current factory binds a single `processTag` at construction (`createLLMWithProcess(WAVE1_PROCESS_TAG, …)` at wave1 line 81). Phase 52 D-06 keeps the wave-level default and adds an OPTIONAL `process?: string` field on the request that, when set, overrides the bound tag. The factory at `llm-with-process.ts:236-248` currently does:

```typescript
export function createLLMWithProcess(
  processTag: string,
  metricsTracker?: MetricsTrackerLike,
): { complete: (req: Omit<LLMWithProcessRequest, 'process'>) => Promise<…> } {
  return {
    complete: (req) =>
      llmWithProcessComplete({ ...req, process: processTag }, metricsTracker),
  };
}
```

**Minimal D-06 patch (planner authors exact code):**
- Change `req: Omit<LLMWithProcessRequest, 'process'>` to `req: Omit<LLMWithProcessRequest, 'process'> & { process?: string }`.
- Change body to `{ ...req, process: req.process ?? processTag }`.

That single change unlocks per-call-site override without breaking any existing caller. The 7 current `.complete()` sites continue to work unchanged; per-sub-step sites add a `process: PROCESS_TAGS.WAVE3_DETAIL_EXTRACT` field.

**Per-file modification map:**

| File | Existing call sites (line numbers) | Per-call-site `process` value (planner finalizes) |
|------|------------------------------------|--------------------------------------------------|
| `wave1-project-agent.ts` | 270 (enrich), 452 (analyzeComponent), 937 (observation-retry) | `PROCESS_TAGS.WAVE1_L1_EMIT` for all three (single sub-step today; planner may split further if observation-retry warrants its own tag) |
| `wave2-component-agent.ts` | 394 (L2 analysis), 597 (observation-retry) | `PROCESS_TAGS.WAVE2_SUBCOMPONENT` |
| `wave3-detail-agent.ts` | 389 (L3 discovery), 595 (observation-retry) | `PROCESS_TAGS.WAVE3_DETAIL_EXTRACT` |

The wave3 file in particular hosts only ONE sub-step today (`detail-extract`). The CONTEXT.md initial split lists `wave3-ontology-classify` and `wave3-relation-discovery` separately — those tags are emitted by code that lives OUTSIDE the wave3 agent (in `wave-controller.ts` KG operators block at line 1188+ and in the dedup/predicate operators). Planner inventories where ontology classification + relation discovery LLM calls fire (likely `coordinator.ts:3098` ontology classification path, and KG operators in `kg-operators.ts`) and tags each.

---

### 3. `src/agents/semantic-analyzer.ts` (modify — strangler swap of `analyzeContent` SDK direct path)

**Analog A (current bypass path that creates `process='unknown'`):** `semantic-analyzer.ts:428-450`

```typescript
// Single request: delegate to LLM service
try {
  const result = await this.llmService.complete({
    messages: [{ role: 'user', content: prompt }],
    tier: effectiveTier,
    taskType: taskType,
    agentId: SemanticAnalyzer.currentAgentId || undefined,
    // Phase 42.2 Plan 06 follow-up — forward caller-supplied timeout so a
    // stalled proxy connection aborts via AbortSignal.timeout instead of
    // hanging the wave forever (Wave 4 insights regression root cause).
    ...(typeof timeout === 'number' ? { timeout } : {}),
  });

  const analysisResult = this.toAnalysisResult(result);
  // Record metrics for step-level aggregation
  SemanticAnalyzer.recordCallMetrics(analysisResult, prompt?.slice(0, 500), result.content?.slice(0, 500));
  return analysisResult;
} catch (error: any) {
  log('All LLM providers failed', 'error', { error: error.message });
  throw new Error(`All LLM providers failed. Errors: ${error.message}`);
}
```

**Analog B (Phase 42.2-02 strangler precedent — what the swap looks like):** `wave1-project-agent.ts:79-84`

```typescript
this.llmWithProcess = createLLMWithProcess(
  WAVE1_PROCESS_TAG,
  this.llmService.getMetricsTracker(),
);
```

**Analog C (`AnalysisOptions` interface that gains the `process` field):** `semantic-analyzer.ts:40-53`

```typescript
export interface AnalysisOptions {
  context?: string;
  analysisType?: "general" | "code" | "patterns" | "architecture" | "diagram" | "classification" | "raw" | "passthrough";
  provider?: "groq" | "gemini" | "anthropic" | "openai" | "ollama" | "custom" | "auto";
  tier?: ModelTier;
  taskType?: TaskType;
  /** Phase 42.2 Plan 06 follow-up — per-call timeout in milliseconds. […] */
  timeout?: number;
}
```

**Pattern to apply (D-09 — Phase 52 strangler step):**

1. Add `process?: string` to `AnalysisOptions` (mirror the JSDoc style of the existing `timeout` field — explain wave-4 unknown gap).
2. Inside `analyzeContent` (line 389), if `options.process` is set, route through a `llmWithProcessComplete` direct-fetch call (import from `'./llm-with-process.js'`) — replicate the SDK-shape-normalization pattern in `llm-with-process.ts:177-200`. If `options.process` is undefined, fall through to the existing `this.llmService.complete(…)` SDK path (preserves backward compatibility for any orphan caller not yet migrated).
3. Pass `this.llmService.getMetricsTracker()` (or equivalent SDK accessor — `semantic-analyzer.ts` accesses the metrics tracker via `SemanticAnalyzer.recordCallMetrics` static; planner finds the equivalent instance accessor) to `llmWithProcessComplete` so SDK-side `getDetailedCalls()` consumers still see the call (matches Phase 42.2-02 Gap 2 contract — `MetricsTrackerLike` duck type at `llm-with-process.ts:44-54`).
4. After the call, still invoke `SemanticAnalyzer.recordCallMetrics(analysisResult, …)` — that's a separate SDK-side metrics aggregation per line 444.

**Error handling pattern:** identical to lines 447-450 — wrap in try/catch, log via `log('…', 'error', { error: error.message })`, rethrow.

---

### 4. `src/agents/insight-generation-agent.ts` (modify — 5 call sites thread `process`)

**Analog:** self — the 5 existing `semanticAnalyzer.analyzeContent(…)` call sites all share an identical option-object shape. Example at line 631-638:

```typescript
const result = await this.semanticAnalyzer.analyzeContent(prompt, {
  analysisType: 'architecture',
  context: `Deep insight generation for ${entityName}`,
  provider: 'auto',
  taskType: 'insight_generation',
  timeout: 60000,  // Phase 42.2 Plan 06 follow-up — prevent Wave 4 hang on stalled proxy
});
```

**Pattern to apply:** Each call site gets one new line — `process: PROCESS_TAGS.<TAG_FOR_THIS_PURPOSE>` — inserted alongside the existing `taskType` field. Per-site tag assignment:

| Line | Purpose | Suggested tag |
|------|---------|---------------|
| 632 | Deep insight generation (wave-4 insight body) | `PROCESS_TAGS.WAVE4_INSIGHT` |
| 2505 | PlantUML diagram generation | `PROCESS_TAGS.WAVE4_DIAGRAM` (planner — may be `_DIAGRAM_PRIMARY` or roll into `_INSIGHT`) |
| 2761 | PlantUML repair retry | `PROCESS_TAGS.WAVE4_DIAGRAM_REPAIR` (likely separate — has known different latency profile) |
| 4333 | Pattern extraction from git commits | `PROCESS_TAGS.WAVE4_PATTERN_EXTRACT` |
| 5110 | Documentation generation | `PROCESS_TAGS.WAVE4_DOCS` |
| 5449 | Pattern-extraction retry (format hint) | `PROCESS_TAGS.WAVE4_PATTERN_EXTRACT` (same as 4333 — same purpose, retry path) |

Planner finalizes the exact tag list; the registry is the single source of truth for what's allowed.

---

### 5. `src/agents/wave-controller.ts` (modify — per-item progress emission via `updateStepOutputs`)

**Analog:** self — `wave-controller.ts:2846-2887` already implements the exact pattern Phase 52 D-13 needs, for `wave4_insights`. The existing flow:

```typescript
// (from inside the per-entity insightTasks loop)
// panel can render "N/<planned>" while wave4 is running.
this.updateStepOutputs('wave4_insights', { planned, generated, failed, skippedDiagrams });
```

with `updateStepOutputs` defined at `wave-controller.ts:257-262`:

```typescript
private updateStepOutputs(stepName: string, outputs: Record<string, unknown>): void {
  const existing = this.stepMetrics.get(stepName) ?? {};
  const mergedOutputs = { ...((existing as any).outputs ?? {}), ...outputs };
  this.stepMetrics.set(stepName, { ...existing, outputs: mergedOutputs });
  this.touchProgress();
}
```

And `touchProgress()` at line 144 already calls a JSON read-merge-write against `this.progressFile` and writes via `fs.writeFileSync(this.progressFile, …)`.

**Pattern to apply (D-13):**

1. For wave1 — wave1 currently emits `wave1_analyze` via `captureAgentMetrics` after `runWithConcurrency` returns (line 633). Per-item progress requires moving the emission **into** the loop. The cleanest hook is the `onTaskComplete` callback on `runWithConcurrency` (line 2943) — see existing example at line 1762: `await this.runWithConcurrency(agentTasks, this.maxAgentsPerWave, (idx, output) => { … });`. Phase 52 adds a throttled call inside that callback: every K=5 completed items OR every 2s, whichever comes later, invoke `this.updateStepOutputs(<wave_step>, { itemsCompleted: idx + 1, itemsTotal: tasks.length })`.

2. For wave2/wave3 — same pattern; both call `runWithConcurrency` for their classify tasks at lines 952 / 1129. The wave2 component loop at wave-controller line 1762 already passes an `onTaskComplete` callback today.

3. For wave4 — the `insightTasks` loop already emits `planned, generated, failed, skippedDiagrams` after each entity (lines 2851, 2881, 2886). Phase 52 adds two more fields to that same object: `itemsCompleted: generated + failed` and `itemsTotal: planned`. Zero structural change — just expand the second arg to `updateStepOutputs(…)`.

**Throttle helper (NEW — small utility, planner places in same file):**

No analog needed — straightforward. Pattern:

```typescript
// Inside the class — module-private member, not exported.
private lastProgressEmitTs = 0;
private progressItemsSinceEmit = 0;
private readonly PROGRESS_EMIT_EVERY_N = 5;
private readonly PROGRESS_EMIT_MIN_MS = 2000;

private maybeEmitItemProgress(stepName: string, completed: number, total: number): void {
  this.progressItemsSinceEmit += 1;
  const now = Date.now();
  const dueByCount = this.progressItemsSinceEmit >= this.PROGRESS_EMIT_EVERY_N;
  const dueByTime  = now - this.lastProgressEmitTs >= this.PROGRESS_EMIT_MIN_MS;
  if (dueByCount || dueByTime || completed === total) {
    this.updateStepOutputs(stepName, { itemsCompleted: completed, itemsTotal: total });
    this.progressItemsSinceEmit = 0;
    this.lastProgressEmitTs = now;
  }
}
```

CRITICAL — Phase 10 race-condition zone (`workflow-runner.ts:469-530`): The `touchProgress()` path that `updateStepOutputs` invokes goes through a direct `fs.writeFileSync(this.progressFile, …)` at `wave-controller.ts:188`, NOT through `coordinator.writeProgressFile` / `preserveFromExisting`. That's the bypass that Phase 42.2-02 explicitly accepted as a single-writer architecture choice (wave-controller owns `wave*` keys, coordinator owns everything else). Phase 52 emission stays inside this same already-blessed path; the planner does NOT need to add a `preserveFromExisting` call from wave-controller because the allowlist guards COORDINATOR's writes, not wave-controller's. **Verify this with planner:** `grep -n "preserveFromExisting" wave-controller.ts` → 0 hits today, confirming wave-controller does not (and must not) call it. The fields wave-controller writes (`stepsDetail.{wave}.tokensUsed / llmCalls / llmProvider / subSteps / outputs`) are wave-owned; adding `itemsCompleted` and `itemsTotal` into `outputs.{itemsCompleted, itemsTotal}` keeps them in the wave-owned namespace.

---

### 6. `integrations/system-health-dashboard/src/components/workflow/constants.ts` (modify — 18+ literals replaced)

**Analog:** self — `WORKFLOW_AGENTS` array at line 69. Each entry currently has a hardcoded `llmModel: 'Groq: llama-3.3-70b-versatile'`. Example at lines 71-82:

```typescript
{
  id: 'quality_assurance',
  name: 'Quality Assurance',
  shortName: 'QA',
  icon: Shield,
  description: 'Validates all outputs and provides quality feedback to the Orchestrator. Uses LLM-powered quality scoring. Focuses on overarching quality aspects not covered by individual agents.',
  usesLLM: true,
  llmModel: 'Groq: llama-3.3-70b-versatile',
  techStack: 'SemanticAnalyzer + Semantic Value Filter',
  row: 3,
  col: 0,
},
```

**Pattern to apply (D-01 + D-08):**

1. Per D-08, each `WORKFLOW_NODE` (the AgentDefinition entries) gets a new optional field `processTag?: string` referencing the registry. The import line at the top of constants.ts:

```typescript
// Phase 52 D-07 — import the frozen registry from the semantic-analysis
// submodule's dist/ output (bind-mounted; no Docker rebuild needed).
import { PROCESS_TAGS } from '@semantic-analysis/agents/process-tags';
//   ^ path alias TBD by planner — current dashboard tsconfig uses
//     '@/*' for src/*; planner adds a new alias OR uses a relative path
//     to the bind-mounted dist (e.g.
//     '../../../mcp-server-semantic-analysis/dist/agents/process-tags.js').
```

2. Per D-01, the static `llmModel: 'Groq: llama-3.3-70b-versatile'` literals (lines 59, 78, 118, 130, 144, 156, 181, 193, 229, 241, 267, 281, 293, 307, 319, 357 — 16 sites of that specific string + line 168 / 205 / 217 / 255 / 333 / 345 of other static literals = 22 total `llmModel:` fields) become either:
  - **`null`** (badge resolved entirely at render time by the new hook fetching `/api/token-usage/recent`), OR
  - **a tier-label string** (D-03 fallback when the bucket is empty) like `'auto: claude-code → copilot → groq'` — D-03 is the documented fallback for empty buckets, NOT the steady-state badge.

  D-01 is firm: live token-usage is source of truth. Planner picks whether the field is dropped entirely (relying on the registry's `processTag` to drive a live look-up) or kept as the empty-bucket fallback.

3. Line 603 `standard: 'llama-70b'` in the `TIER_MODELS` map: planner keeps the map (it serves the D-03 empty-bucket fallback path) but documents that it's now a fallback hint, not a routing claim.

**Error handling:** UI render falls through to the legacy `llmModel` static string when the fetch fails or the bucket is empty, matching the D-03 path. Mirror the `token-usage.tsx:299-307` error pattern (`if (error && !summary)` shows an `<Alert variant="destructive">`).

---

### 7. `integrations/system-health-dashboard/src/components/workflow/types.ts` (modify — add `processTag`)

**Analog:** self — `AgentDefinition` interface, lines 6-22:

```typescript
export interface AgentDefinition {
  id: string
  name: string
  shortName: string
  icon: LucideIcon
  description: string
  usesLLM: boolean
  llmModel: string | null
  techStack: string
  row: number
  col: number
  phase?: number
  // Multi-agent system properties
  isOrchestrator?: boolean  // Can start/stop other agents (only the main Orchestrator)
  canRetry?: string[]       // IDs of agents the orchestrator can retry
  reportsTo?: string        // ID of agent this one reports to (for feedback loops)
}
```

**Pattern to apply (D-08):**

Insert one new optional field after `usesLLM`:

```typescript
  /** Phase 52 D-08 — Process tag for live LLM badge resolution.
   *  Imported from the frozen registry (process-tags.ts). When set, the
   *  trace-modal renders the live provider/model from the most-recent N
   *  rows of token_usage.db where process = this tag. Falls back to the
   *  static `llmModel` string when no rows match (D-03 empty-bucket case). */
  processTag?: string  // e.g. PROCESS_TAGS.WAVE3_DETAIL_EXTRACT
```

Also extend `AgentDefinitionAPI` (lines 93-105) identically — the API response shape must mirror the runtime type per the existing convention.

**Also extend `StepInfo` (lines 33-58) — Phase 52 D-15:**

```typescript
  // Phase 52 D-15 — per-item progress fields written by wave-controller's
  // throttled emission inside wave1/2/3/4 loops. Optional + backward-compat:
  // when itemsTotal is missing the dashboard falls back to the legacy
  // arrow-style render (8 → 8 → 8). Field lives under outputs.* on the
  // disk JSON, so this entry just documents the contract.
  itemsCompleted?: number
  itemsTotal?: number
```

Planner inspects whether `outputs` is already typed as `Record<string, unknown>` (line 39) — if so, `itemsCompleted/itemsTotal` flow through unchanged and only require dashboard reader-side typing.

---

### 8. `integrations/system-health-dashboard/src/components/workflow/hooks.ts` (**NEW** — live-fetch hook for badges)

**Analog:** `integrations/system-health-dashboard/src/pages/token-usage.tsx:18-21, 265-289` — exact fetch pattern.

**Imports + constants:**

```typescript
const PROXY_PORT = '12435'
const PROXY_BASE = `http://localhost:${PROXY_PORT}`
const REFRESH_INTERVAL = 30_000
```

**Fetch + state pattern (full reusable shape):**

```typescript
const [recent, setRecent] = useState<RecentCall[]>([])
const [loading, setLoading] = useState(true)
const [error, setError] = useState<string | null>(null)
const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

const fetchData = useCallback(async (isAuto = false) => {
  if (!isAuto) setLoading(true)
  setError(null)
  try {
    const [sumRes, recRes] = await Promise.all([
      fetch(`${PROXY_BASE}/api/token-usage/summary?hours=${encodeURIComponent(hoursWindow)}`),
      fetch(`${PROXY_BASE}/api/token-usage/recent?limit=50`)
    ])
    if (!sumRes.ok || !recRes.ok) throw new Error(`HTTP ${sumRes.status}/${recRes.status}`)
    const recData = await recRes.json()
    setRecent(recData.data || [])
  } catch (err) {
    setError('Failed to load token usage. Check that the LLM proxy is running on port 12435.')
  } finally {
    setLoading(false)
  }
}, [hoursWindow])

useEffect(() => {
  fetchData()
  intervalRef.current = setInterval(() => fetchData(true), REFRESH_INTERVAL)
  return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
}, [fetchData])
```

**`RecentCall` type (already defined at `token-usage.tsx:144-156`) — re-use this exact shape:**

```typescript
interface RecentCall {
  id: number
  timestamp: string
  provider: string
  model: string
  process: string
  input_tokens: number
  output_tokens: number
  total_tokens: number
  latency_ms: number
  subscription: string
  prompt_preview: string
}
```

**Pattern to apply (D-04 + D-02 + D-03):**

1. New hook `useLLMBadgeForProcess(processTag: string): { provider: string; model: string } | null` — internally maintains the recent[] state (or planner sources it via React context / shared store to avoid every row firing its own interval).
2. Client-side filter: `const matches = recent.filter(r => r.process === processTag).slice(0, N)` with `N = 10` per D-02.
3. Aggregate over the N matches: most-recent `provider/model` wins; tie-break by frequency. Return null when no matches → trace-modal renders D-03 fallback.
4. Re-use the dashboard's existing `shortenModel(model)` helper at `constants.ts:609` for the badge string (`'sonnet'`, `'haiku'`, `'llama-70b'`, etc).

Planner places the hook either at the existing `integrations/system-health-dashboard/src/components/workflow/hooks.ts` (if it exists) or at a new file in the same directory.

---

### 9. `integrations/system-health-dashboard/src/components/workflow/trace-modal.tsx` (modify — `{n}/{N}` inline counter + progress bar)

**Analog A (the exact wave row render — where the counter lands):** `trace-modal.tsx:759-790`:

```typescript
return (
  <div key={waveId}>
    {/* Level 1: Wave row */}
    <div
      className={`flex items-center gap-3 p-2 rounded cursor-pointer transition-colors ${
        selectedLevel?.type === 'wave' && selectedLevel.waveNumber === wg.waveNumber
          ? 'bg-blue-500/10 border border-blue-500/30'
          : 'hover:bg-zinc-800/30'
      }`}
      onClick={() => {
        toggleExpand(waveId)
        setSelectedLevel({ type: 'wave', waveNumber: wg.waveNumber })
      }}
    >
      {isWaveExpanded
        ? <ChevronDown className="h-4 w-4 text-zinc-400" />
        : <ChevronRight className="h-4 w-4 text-zinc-400" />
      }
      <span className="font-medium text-sm flex-1">{waveName}</span>
      {/* Wave metrics */}
      <span className="text-xs text-zinc-500 tabular-nums">{formatDuration(wg.totalDuration)}</span>
      <Badge variant="outline" className="text-[10px] h-5">
        <Cpu className="h-3 w-3 mr-1" />{wg.totalLLMCalls}
      </Badge>
      {wg.totalTokens > 0 && (
        <span className="text-[10px] text-zinc-500 tabular-nums">{wg.totalTokens.toLocaleString()}t</span>
      )}
      {/* Entity flow mini-badge */}
      {(wg.entityFlow.produced > 0 || wg.entityFlow.persisted > 0) && (
        <EntityFlowBadge flow={wg.entityFlow} />
      )}
    </div>
```

**Analog B (the exact inline mini-badge shape Phase 52's `{n}/{N}` counter mirrors):** `trace-modal.tsx:131-141` — `EntityFlowBadge`:

```typescript
const EntityFlowBadge = React.memo(function EntityFlowBadge({ flow }: { flow: TraceEntityFlow }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-mono">
      <span className="text-blue-400">{flow.produced}</span>
      <ArrowRight className="h-2.5 w-2.5 text-zinc-500" />
      <span className="text-amber-400">{flow.passedQA}</span>
      <ArrowRight className="h-2.5 w-2.5 text-zinc-500" />
      <span className="text-green-400">{flow.persisted}</span>
    </span>
  )
})
```

**Pattern to apply (D-15):**

1. New inline component `ItemProgressBadge` next to `EntityFlowBadge` (line 131-141, same memoization pattern):

```typescript
const ItemProgressBadge = React.memo(function ItemProgressBadge({
  completed, total
}: { completed: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-mono">
      <span className="text-zinc-400 tabular-nums">{completed}/{total}</span>
      <span className="inline-block w-12 h-1 bg-zinc-700 rounded-full overflow-hidden">
        <span
          className="block h-full bg-blue-400 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </span>
    </span>
  )
})
```

2. Insert into the wave row JSX between `totalLLMCalls` and `EntityFlowBadge` (around line 787) — fall back to nothing (existing render unchanged) when `itemsTotal` is missing:

```typescript
{wg.itemsTotal != null && wg.itemsTotal > 0 && wg.itemsCompleted != null && (
  <ItemProgressBadge completed={wg.itemsCompleted} total={wg.itemsTotal} />
)}
```

3. `WaveGroup` type (planner finds in `@/store/slices/ukbSlice` — referenced at trace-modal.tsx:35) needs `itemsCompleted?: number` + `itemsTotal?: number` added to the optional fields; the reducer that builds `WaveGroup` from `steps[]` (currently lines 404-482 of trace-modal.tsx itself, the `waveGroups` `useMemo`) reads the underlying `step.outputs?.itemsCompleted` / `step.outputs?.itemsTotal` and surfaces it to the group.

**Badge integration with hook from §8 above:** The Level-2 step row (inside expanded wave, around line 805+) reads `step.processTag` (from the registry-augmented constants), passes it to `useLLMBadgeForProcess(step.processTag)`, and shows the live provider/model returned. Falls back to the static `llmModel` from `WORKFLOW_AGENTS` when the hook returns null (D-03 path).

---

### 10. `scripts/configure-wave-analysis-routing.sh` (optional modify — D-05 sub-step tags)

**Analog:** self — script already installs `wave-analysis-wave{1,2,3}` entries.

**Pattern to apply:** Extend the existing `processOverrides` install block to include any new sub-step tags D-05 finalizes (`wave-analysis-wave1-l1emit`, `wave-analysis-wave2-subcomponent`, `wave-analysis-wave3-detail-extract`, `wave-analysis-wave3-ontology-classify`, `wave-analysis-wave3-relation-discovery`, `wave-analysis-wave4-insight`, etc). The `--reset` and `--show` flag behavior described in CLAUDE.md must continue to work — `--reset` removes only the `wave-analysis-*` entries and must match the new tag prefix.

Planner choice: extend in this phase OR defer to a follow-up housekeeping commit (the proxy's stage-3 preference-order fallback at `server.mjs:1470-1510` already correctly routes new sub-step tags without an explicit override, so the script extension is a nice-to-have not a blocker).

---

### 11. Test / verification gate for D-10 zero-unknown bar (**NEW**)

**Analog:** `scripts/backfill-raw-observations.mjs:40,95` (canonical sqlite + LLM-proxy script pattern). Also CLAUDE.md mandates `ontologyDir` grep for any km-core CLI — not applicable here since this gate is a token_usage.db query, not a km-core consumer.

**Pattern to apply (D-10):**

A Node script (placement at planner's discretion — likely `scripts/verify-zero-unknown.mjs` or `.planning/phases/52-…/tests/zero-unknown.test.mjs`) that:

1. Opens `.data/llm-proxy/token-usage.db` via `better-sqlite3` or the sqlite3 CLI.
2. Asserts:

```sql
SELECT COUNT(*) FROM token_usage
WHERE process = 'unknown'
  AND timestamp > datetime('now', '-1 hour')
```

returns 0 after a fresh wave-analysis run scoped to the coding-services container's lifetime (planner picks the scoping mechanism — likely a marker file or pre-run timestamp anchor).

3. Exits non-zero on fail with a stderr message listing the offending `(provider, model)` pairs so the planner can identify the un-tagged caller path.

**Error handling pattern:** matches the host-side script style in `scripts/backfill-raw-observations.mjs` — no `console.*`, all logs to `process.stderr.write`. Throw on schema mismatch (the token_usage table shape documented at CONTEXT.md canonical_refs).

---

## Shared Patterns

### Submodule build pipeline (applies to ALL `integrations/mcp-server-semantic-analysis/src/agents/*.ts` modifications)

**Source:** `CLAUDE.md` § "Rebuilding After Code Changes"

```bash
cd integrations/mcp-server-semantic-analysis && npm run build
cd /Users/Q284340/Agentic/coding/docker && docker-compose build coding-services && docker-compose up -d coding-services
```

**Apply to:** Plans touching wave1/2/3-agent.ts, semantic-analyzer.ts, insight-generation-agent.ts, wave-controller.ts, the new process-tags.ts.

Verification grep gates the planner MUST encode in every plan's acceptance section:
- `grep -F "PROCESS_TAGS" integrations/mcp-server-semantic-analysis/dist/agents/wave1-project-agent.js` non-empty after build (confirms TS compiled the registry import).
- `wc -lc integrations/mcp-server-semantic-analysis/dist/agents/process-tags.js` non-zero (confirms the new file landed in dist).

---

### Dashboard build pipeline (applies to ALL `integrations/system-health-dashboard/src/**` modifications)

**Source:** `CLAUDE.md` § "Rebuilding After Code Changes" — dashboard subsection.

```bash
cd /Users/Q284340/Agentic/coding/integrations/system-health-dashboard && npm run build
docker exec coding-services supervisorctl restart web-services:health-dashboard-frontend
```

**Apply to:** Plans touching constants.ts, types.ts, trace-modal.tsx, hooks.ts (new).

NO `docker-compose build`. The bind-mount + supervisorctl restart picks up the rebuilt `dist/`.

---

### Submodule + outer-repo pointer-bump dual commit (applies to plans modifying `src/agents/*.ts`)

**Source:** Phase 42.2-04 SUMMARY (STATE.md line 175); Phase 42.1.2-03 SUMMARY (STATE.md line 172)

```bash
# Inside the submodule
cd /Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis
git add src/agents/process-tags.ts src/agents/wave1-project-agent.ts …
git commit -m "phase52: per-sub-step process tags + registry"

# Outer repo
cd /Users/Q284340/Agentic/coding
git add integrations/mcp-server-semantic-analysis
git commit -m "bump submodule: phase52 process-tag registry"
```

**Apply to:** All process-tag, semantic-analyzer, wave-controller plans.

**Skip (single outer-repo commit only):** any plan touching `src/ontology/` or `src/knowledge-management/` files — those are symlinks owned by the outer repo (Phase 42.1.2-02 precedent). Phase 52 does not modify any symlinked path, so all submodule plans use the dual-commit topology.

---

### Constraint compliance: `no-console-log` + `process.stderr.write` only

**Source:** `MEMORY.md` § "Constraint Violations = Real Issues" + `llm-with-process.ts:32` JSDoc.

**Apply to:** All new TypeScript files in this phase. Use `log(...)` from `'../logging.js'` (mcp-server-semantic-analysis convention; see wave1-project-agent.ts:20) OR `process.stderr.write(...)` directly. Never `console.log/info/warn/error`.

---

### Backward-compatible progress file shape (D-15 fallback)

**Source:** Phase 42.2-02 (STATE.md line 153); enforced in `coordinator.ts:81-145` `preserveFromExisting`.

**Apply to:** trace-modal.tsx wave row render — render `ItemProgressBadge` only when `itemsTotal != null && itemsTotal > 0`. When older progress files (or running wave that hasn't emitted yet) don't have these fields, the legacy `formatDuration(wg.totalDuration)` + `EntityFlowBadge` render path remains intact.

---

## No Analog Found

None. All 13 file targets have strong existing precedent in the codebase. The Phase 42.2-02 strangler pattern + the wave-controller's existing `updateStepOutputs('wave4_insights', …)` line 2851 are particularly close matches that the planner can copy near-verbatim.

The only mild "fresh path" is the **per-call-site `process` override** factory change in `llm-with-process.ts` (changing `Omit<…, 'process'>` to `Omit<…, 'process'> & { process?: string }`) — but that's a 2-line modification mirroring the same pattern the SDK request shape itself uses, not a new architecture.

---

## Metadata

**Analog search scope:**
- `integrations/mcp-server-semantic-analysis/src/agents/` (full enumeration via `ls -la`; verified `src/agents/` is real, `src/ontology` + `src/knowledge-management` are symlinks)
- `integrations/system-health-dashboard/src/components/workflow/` (full file inspection: constants.ts, types.ts, trace-modal.tsx)
- `integrations/system-health-dashboard/src/pages/token-usage.tsx` (fetch pattern source-of-truth)
- `integrations/mcp-server-semantic-analysis/src/workflow-runner.ts:469-530` (Phase 10 race-condition zone — confirmed wave-controller bypasses `coordinator.writeProgressFile`, so Phase 52 emission inherits the same exemption)
- `_work/rapid-llm-proxy/proxy-bridge/server.mjs:1470-1510` (cited only — not loaded; CONTEXT.md provides the routing-order contract)

**Files scanned (full or partial Read):**
- `52-CONTEXT.md` (full), `NOTES.md` (full), `STATE.md` (full), `CLAUDE.md` (full)
- `llm-with-process.ts` (full — 249 lines, single Read)
- `wave1-project-agent.ts` (lines 1-130, 260-300, 440-480, 920-960)
- `wave2-component-agent.ts` (lines 1-120)
- `wave3-detail-agent.ts` (lines 1-130, 375-415)
- `semantic-analyzer.ts` (lines 35-105, 380-540)
- `insight-generation-agent.ts` (lines 625-660, 2498-2525, 2755-2775, 4325-4355, 5100-5130, 5440-5470)
- `coordinator.ts` (lines 35-145, 275-360, 680-710)
- `wave-controller.ts` (lines 130-205, 250-340, 420-455, 1150-1230, 2850-2895, 2940-2986)
- `workflow-runner.ts` (lines 465-540)
- `constants.ts` (lines 1-90, 580-630; grep for `llmModel:` literals)
- `types.ts` (full — 161 lines, single Read)
- `trace-modal.tsx` (lines 1-60, 125-170, 750-870; grep for wave / itemsCompleted markers)
- `token-usage.tsx` (lines 1-100, 140-160, 240-330)

**Pattern extraction date:** 2026-05-28

**Topology verification done:**

```
drwxr-xr-x  src/agents          ← REAL dir (submodule + pointer-bump dual commit)
lrwxr-xr-x  src/knowledge-management → ../../../src/knowledge-management  (symlink — outer-repo single commit)
lrwxr-xr-x  src/ontology         → ../../../src/ontology                   (symlink — outer-repo single commit)
drwxr-xr-x  src/storage         ← REAL dir
drwxr-xr-x  src/types           ← REAL dir
```

Phase 52 only touches `src/agents/` (REAL dir) → all submodule plans use the **dual-commit topology** (Phase 42.2-04 precedent `a27aac6` + `8bfee7faf`).
