# Phase 12: Pipeline Observability - Research

**Researched:** 2026-03-09
**Domain:** Dashboard trace visualization, pipeline instrumentation, SSE real-time data flow
**Confidence:** HIGH

## Summary

Phase 12 enhances the existing TraceModal component and wave-controller instrumentation to provide full pipeline observability. The existing infrastructure is substantial: the wave-controller already captures per-step LLM metrics (tokensUsed, llmCalls, llmProvider), the SSE pipeline streams stepsDetail to the dashboard in real-time, and the TraceModal renders a waterfall timeline with expandable outputs. The gap is that the current system operates at step-level granularity (17 flat steps) without wave-level grouping, per-LLM-call detail, entity flow tracking, data flow visualization, or historical trace storage.

The work divides into three domains: (1) backend instrumentation to capture per-LLM-call events, entity flow counters, and QA results within the wave-controller, (2) SSE/Redux data flow extensions to carry the nested trace structure from backend to frontend, and (3) TraceModal UI redesign for 3-level nesting (Wave > Step > Agent), context-aware detail panels, parallel execution visualization, entity flow indicators, and historical trace comparison.

**Primary recommendation:** Extend the existing `stepsDetail` array in `workflow-progress.json` with nested sub-events per step, entity flow counters, and QA trace events. The frontend TraceModal needs a complete rewrite from flat list to 3-level tree with context-aware detail panel. Historical traces should be saved as JSON files in `.data/trace-history/`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Per-LLM-call granularity within each agent -- every individual LLM call is a trace event
- Store metadata + truncated I/O per call: model, tokens, duration, purpose, first 500 chars of prompt and response
- Show ALL agent types including non-LLM (OntologyAgent, PersistenceAgent, QA Agent) -- full pipeline visibility
- Parallel agents (e.g., 13 Wave 2 component agents) grouped with expand -- show "Wave 2 Analyze (13 agents)" as one row, click to expand individual agents
- Capture trace data in real-time via SSE -- LLM call events stream live to dashboard as they happen
- Failed/retried LLM calls (rate limits, timeouts) show up alongside successful ones -- all attempts visible
- QA validation results (Phase 11 quality gates) appear as dedicated trace events with pass/fail, score, errors
- Entity counts tracked per stage: "9 entities produced -> 7 passed QA -> 6 persisted" -- shows where entities get filtered
- Inline in the timeline -- each trace row shows input/output summary, click to expand
- Full entity list with observations shown when expanded -- each entity name, type, observation count, first observation
- Information loss highlighted -- entities filtered/rejected at each stage flagged with the reason (QA rejection, content quality, dedup)
- Observation code evidence references (file paths, class names) shown in the trace data flow
- 3-level nesting: Wave > Step (analyze/classify/persist/qa) > Agent instances
- Detail panel is context-aware: Wave level shows summary stats + entity flow; Step level shows agent list + metrics; Agent level shows LLM calls + I/O data
- Summary stats bar enhanced with wave-level breakdown: "Wave 1: 16 calls, 40s | Wave 2: 45 calls, 120s | Wave 3: 30 calls, 80s"
- Parallel execution shown with overlapping waterfall bars at the same vertical level -- visually conveys concurrency
- Keep last 10 workflow runs in trace history
- Side-by-side comparison of two historical traces -- timing, entity counts, LLM calls
- Auto-flag anomalous runs: entity count drops, errors, high QA rejection rate, duration 2x+ longer than average

### Claude's Discretion
- Exact color scheme for LLM tiers and agent types
- Trace history file format and storage location
- Anomaly detection thresholds
- Exact truncation strategy for prompt/response previews
- How to render overlapping parallel bars (CSS approach)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| OBSV-01 | Trace modal displays LLM call counts per wave and agent | Wave-level grouping of stepsDetail + captureStepMetrics already provides per-step llmCalls; needs per-agent breakdown within parallel waves and wave-level summary aggregation |
| OBSV-02 | Trace modal displays timing breakdown per agent and wave | stepsDetail already has startTime/endTime per step; needs parallel agent timing (Wave 2/3 run multiple agents concurrently), wave-level duration aggregation |
| OBSV-03 | Trace modal displays model info (which LLM, provider) | llmProvider already captured in stepsDetail (e.g., "llama-3.3-70b-versatile@groq"); needs per-LLM-call model info for multi-model steps |
| OBSV-04 | Trace modal shows data flow -- what went in/out of each agent | outputs field exists but only stores aggregate counts; needs entity lists, observation samples, QA results, and information loss tracking between stages |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 18.x | UI components (TraceModal) | Already used in dashboard |
| Next.js | 14.x | Dashboard framework | Already used |
| Redux Toolkit | 2.x | State management (ukbSlice) | Already used for workflow state |
| shadcn/ui | latest | UI primitives (Dialog, ScrollArea, Badge, etc.) | Already used in TraceModal |
| Lucide React | latest | Icons | Already used |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Tailwind CSS | 3.x | Styling (waterfall bars, nesting indentation) | All UI work |
| EventSource | browser native | SSE real-time updates | Already used in healthRefreshMiddleware |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| CSS waterfall bars | D3.js/Recharts | Overkill -- CSS flexbox + absolute positioning is simpler for waterfall bars and already used |
| JSON file trace history | SQLite/LevelDB | Unnecessary complexity -- 10 JSON files is trivial storage |

## Architecture Patterns

### Current Architecture (What Exists)

Data flows from backend to frontend through this pipeline:

1. `wave-controller.ts` calls `captureStepMetrics()` / `captureAgentMetrics()` after each agent completes
2. `wave-controller.ts` calls `updateProgress()` which builds `stepsDetail` array from `stepMetrics` Map
3. `updateProgress()` writes the complete progress state to `workflow-progress.json`
4. `workflow-runner.ts` uses `writeProgressPreservingDetails()` to merge updates without losing stepsDetail
5. SSE stream on port 3033 broadcasts `workflow-progress.json` content to connected clients
6. `healthRefreshMiddleware.ts` receives SSE events and transforms into Redux dispatch
7. `ukbSlice` stores the process data including `steps` (from stepsDetail)
8. `TraceModal` renders a flat waterfall timeline from the `steps` array

### Target Architecture (What We Build)

Same pipeline, extended at each layer:

1. **wave-controller.ts**: Add `captureLLMCallEvent()`, `captureEntityFlow()`, `captureQAResult()` methods
2. **updateProgress()**: Include `agentInstances`, `entityFlow`, `qaResult` in stepsDetail entries
3. **workflow-progress.json**: Extended stepsDetail schema with nested trace data
4. **SSE + middleware**: Pass through new nested fields (no transform needed -- already uses spread)
5. **ukbSlice**: Extended StepInfo type with optional nested trace fields
6. **TraceModal**: Complete rewrite from flat list to 3-level tree (Wave > Step > Agent)
7. **New**: Trace history files saved to `.data/trace-history/`, REST endpoint for loading

### Key Data Structures

#### Extended stepsDetail Entry (Backend)
```typescript
interface TraceStepDetail {
  name: string;           // e.g., "wave2_analyze"
  status: string;
  wave: number;
  startTime?: string;
  endTime?: string;
  llmProvider?: string;
  tokensUsed?: number;
  llmCalls?: number;
  outputs?: Record<string, unknown>;
  // --- NEW FIELDS ---
  agentInstances?: TraceAgentInstance[];  // Per-agent detail within parallel steps
  entityFlow?: {
    produced: number;
    passedQA: number;
    persisted: number;
    rejectedReasons?: Record<string, number>;  // e.g., {"qa_rejection": 2, "content_quality": 1}
  };
  qaResult?: {
    passed: boolean;
    score: number;
    errors?: string[];
    retried?: boolean;
  };
}

interface TraceAgentInstance {
  agentId: string;        // e.g., "wave2_agent_LiveLogging"
  agentType: string;      // e.g., "SemanticAnalyzer"
  parentEntity: string;   // e.g., "LiveLoggingSystem"
  startTime: string;
  endTime?: string;
  status: string;
  llmCalls: TraceLLMCall[];
  entityCount: number;
  observationCount: number;
}

interface TraceLLMCall {
  id: string;
  model: string;
  provider: string;
  purpose: string;        // e.g., "analyze_component", "classify_entity"
  durationMs: number;
  tokensIn: number;
  tokensOut: number;
  status: 'success' | 'failed' | 'retried';
  error?: string;
  promptPreview?: string;   // First 500 chars
  responsePreview?: string; // First 500 chars
}
```

#### TraceModal 3-Level Tree Structure (Frontend)
```typescript
interface WaveGroup {
  waveNumber: number;
  steps: TraceStepDetail[];
  totalDuration: number;
  totalLLMCalls: number;
  totalTokens: number;
  entityFlow: { produced: number; passedQA: number; persisted: number };
}

// Detail panel content varies by selection level
type DetailPanelContent =
  | { level: 'wave'; wave: WaveGroup }
  | { level: 'step'; step: TraceStepDetail }
  | { level: 'agent'; agent: TraceAgentInstance }
```

### Pattern 1: 3-Level Nesting in TraceModal
**What:** Group flat stepsDetail into Wave > Step > Agent hierarchy
**When to use:** Always -- this is the core UI pattern for the entire trace view

The existing flat `events` array derived from `steps` must be restructured into `WaveGroup[]`. The wave number is already present on each step (`step.wave`). Steps within a wave are ordered: analyze > qa > classify > persist. Agent instances within analyze steps represent parallel agents.

### Pattern 2: Entity Flow Counters
**What:** Track entity counts at each pipeline stage to show information loss
**When to use:** For analyze, qa, classify, persist steps

The wave-controller already has the data: `wave1Result.totalEntities`, QA pass/fail counts, persistence counts. Currently these are captured as output metrics but not structured for entity flow visualization.

### Pattern 3: Historical Trace Storage
**What:** Save completed workflow traces as JSON files for comparison
**When to use:** After each `ukb full` completes

Save the complete stepsDetail + metadata to `.data/trace-history/{timestamp}-{workflowName}.json`. Keep only the last 10 files (delete oldest on save). Load on-demand when user opens history tab.

### Anti-Patterns to Avoid
- **Storing full prompt/response text in stepsDetail:** Would bloat workflow-progress.json and SSE bandwidth. Truncate to 500 chars as decided.
- **Re-rendering entire TraceModal on every SSE update:** Use memoization aggressively -- only re-render changed wave/step nodes.
- **Building a separate tracing pipeline:** The existing stepsDetail + SSE path works. Extend it, don't create a parallel system.
- **Blocking pipeline execution for trace writes:** All trace capture must be fire-and-forget, never awaited in the critical path.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tree collapse/expand UI | Custom tree state manager | React useState with Set of hierarchical IDs | Already proven pattern in current TraceModal |
| Waterfall bar rendering | Canvas/SVG drawing | CSS flexbox + percentage widths | Already working in current TraceModal, just needs offset support for parallel bars |
| SSE data transport | WebSocket or polling replacement | Existing EventSource + healthRefreshMiddleware | Already working, just needs to pass through new nested fields |
| JSON file persistence | Database or custom storage | fs.writeFileSync/readFileSync | 10 JSON files is trivially small |

## Common Pitfalls

### Pitfall 1: SSE Payload Size Explosion
**What goes wrong:** Including full LLM call data (500-char previews per call, entity lists) in every SSE update causes bandwidth issues and JSON parse slowdowns.
**Why it happens:** The wave-controller writes to workflow-progress.json on every step change, and SSE broadcasts the entire file.
**How to avoid:** Two-tier approach: (1) stepsDetail carries summary metrics only (counts, durations, status). (2) Detailed LLM call data and entity lists stored in a separate trace detail file read on-demand when user expands a step in the modal.
**Warning signs:** SSE updates taking >100ms to parse, browser memory growing during long runs.

### Pitfall 2: Parallel Agent Timing Display
**What goes wrong:** Parallel agents (Wave 2 has up to 13 agents) shown sequentially makes wall-clock time look 13x longer.
**Why it happens:** The current waterfall rendering uses sequential offsets.
**How to avoid:** For parallel agents within a step, render bars at the same vertical offset. Use `startTime` from each agent to compute actual offset from wave start, not cumulative. The step's duration should be max(agent durations), not sum.
**Warning signs:** Wave 2 analyze step showing 10+ minutes when it actually ran in ~60 seconds.

### Pitfall 3: stepsDetail Schema Backward Compatibility
**What goes wrong:** Adding new fields to stepsDetail breaks existing SSE consumers or dashboard versions.
**Why it happens:** The SSE middleware and Redux slice use loose typing (spread operators, `any` casts).
**How to avoid:** All new fields are optional. The TraceModal gracefully degrades: if `agentInstances` is missing, show old flat view. If `entityFlow` is missing, don't render the flow counters.
**Warning signs:** Dashboard crashing on stale data from a previous run.

### Pitfall 4: Race Between captureStepMetrics and updateProgress
**What goes wrong:** Metrics captured after updateProgress was already called for a step, resulting in missing data.
**Why it happens:** `captureStepMetrics()` is called after the agent work completes, but `updateProgress()` may have already written the step as "running" without metrics.
**How to avoid:** Ensure `captureStepMetrics()` is always called before the next `updateProgress()`. Current code already follows this pattern -- verify it holds for new per-call events.
**Warning signs:** Steps showing `llmCalls: undefined` in the trace despite actual LLM calls being made.

### Pitfall 5: Docker Rebuild Required
**What goes wrong:** Backend changes to wave-controller.ts not taking effect.
**Why it happens:** wave-controller.ts is in a submodule that requires `npm run build` + Docker rebuild.
**How to avoid:** After every backend change: `cd integrations/mcp-server-semantic-analysis && npm run build` then `cd /Users/Q284340/Agentic/coding/docker && docker-compose build coding-services && docker-compose up -d coding-services`.
**Warning signs:** Dashboard shows old trace format despite code changes.

## Code Examples

### Current: How step metrics flow from wave-controller to dashboard

```typescript
// wave-controller.ts - captures metrics after agent work
private captureStepMetrics(stepName: string, outputs?: Record<string, unknown>): void {
  const metrics = SemanticAnalyzer.getStepMetrics();
  SemanticAnalyzer.resetStepMetrics();
  this.stepMetrics.set(stepName, {
    tokensUsed: metrics.totalTokens || undefined,
    llmCalls: metrics.totalCalls || undefined,
    llmProvider: metrics.providers?.join(', ') || undefined,
    outputs,
  });
}

// wave-controller.ts - updateProgress builds stepsDetail from stepMetrics
const captured = this.stepMetrics.get(step.name);
return {
  name: step.name,
  status,
  wave: step.wave,
  ...(startTime && { startTime }),
  ...(endTime && { endTime }),
  ...(usesLLM && captured?.llmProvider && { llmProvider: captured.llmProvider }),
  ...(captured?.tokensUsed && { tokensUsed: captured.tokensUsed }),
  ...(captured?.llmCalls && { llmCalls: captured.llmCalls }),
  ...(captured?.outputs && { outputs: captured.outputs }),
};
```

### Current: How SSE passes stepsDetail to Redux

```typescript
// healthRefreshMiddleware.ts - passes stepsDetail directly
const inlineProcess = {
  // ...
  steps: progress.stepsDetail || [],
  // ...
};
this.store.dispatch(fetchUKBStatusSuccess({ /* ... */ processes: [inlineProcess] }));
```

### Existing entity trace data on entities (wave-controller.ts:1344)

```typescript
// Per-entity trace data already captured (not yet surfaced in UI)
const traceArr = (entity as any)._traceData || [];
traceArr.push({
  llmCallCount: 1,
  totalDurationMs: 0,
  model: 'heuristic+llm',
  provider: 'ontology',
  agentType: 'OntologyClassificationAgent',
});
(entity as any)._traceData = traceArr;
```

### New: Per-LLM-call event capture pattern (to implement)

```typescript
// wave-controller.ts - new method to capture individual LLM calls
private captureLLMCallEvent(stepName: string, call: TraceLLMCall): void {
  const existing = this.stepMetrics.get(stepName);
  if (!existing) return;
  const calls = (existing as any).llmCallEvents || [];
  calls.push(call);
  (existing as any).llmCallEvents = calls;
}
```

### New: TraceModal wave grouping (to implement)

```typescript
// trace-modal.tsx - group flat steps into waves
const waveGroups = useMemo(() => {
  const groups = new Map<number, WaveGroup>();
  for (const step of steps) {
    const wave = (step as any).wave || 0;
    if (!groups.has(wave)) {
      groups.set(wave, {
        waveNumber: wave,
        steps: [],
        totalDuration: 0,
        totalLLMCalls: 0,
        totalTokens: 0,
        entityFlow: { produced: 0, passedQA: 0, persisted: 0 },
      });
    }
    const group = groups.get(wave)!;
    group.steps.push(step);
    group.totalLLMCalls += step.llmCalls || 0;
    group.totalTokens += step.tokensUsed || 0;
  }
  return Array.from(groups.values()).sort((a, b) => a.waveNumber - b.waveNumber);
}, [steps]);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Flat step list in trace | 3-level nested tree (this phase) | Phase 12 | Full pipeline visibility |
| Aggregate LLM counts | Per-call LLM events | Phase 12 | Diagnose individual call issues |
| No entity flow tracking | Entity counters per stage | Phase 12 | Identify information loss |
| No trace history | Last 10 runs stored + comparison | Phase 12 | Regression detection |

## Open Questions

1. **Per-LLM-call capture hook location**
   - What we know: SemanticAnalyzer.getStepMetrics() returns aggregate counts, not per-call detail. Wave agents call LLM directly via SemanticAnalyzer.
   - What's unclear: Whether to instrument SemanticAnalyzer with a call-level hook or capture at the wave-agent level.
   - Recommendation: Add a `onLLMCall` callback to SemanticAnalyzer that wave-controller sets. Each call pushes a TraceLLMCall event. This keeps the instrumentation centralized.

2. **SSE bandwidth for detailed trace data**
   - What we know: Current stepsDetail is ~5KB. With per-call events and entity lists, could grow to 50-100KB.
   - What's unclear: Whether SSE can handle this without lag.
   - Recommendation: Use two-tier approach: summary data in stepsDetail (SSE), detail data in separate file loaded on-demand via REST endpoint.

3. **Historical trace comparison layout**
   - What we know: User wants side-by-side comparison of two traces.
   - What's unclear: Whether to render two TraceModal columns or a diff view.
   - Recommendation: Two-column layout with aligned wave rows. Highlight deltas (red for worse, green for better).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Manual verification via `ukb full` + dashboard inspection |
| Config file | N/A -- no automated test framework for dashboard UI |
| Quick run command | `cd integrations/system-health-dashboard && npm run build` |
| Full suite command | `ukb full` then open dashboard trace modal |

### Phase Requirements Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| OBSV-01 | LLM call counts per wave/agent in trace | manual | Run `ukb full`, open trace modal, verify wave-level LLM call breakdown | N/A |
| OBSV-02 | Timing breakdown per agent/wave | manual | Run `ukb full`, verify timing bars and duration values per wave | N/A |
| OBSV-03 | Model/provider info display | manual | Run `ukb full`, verify model badges show correct provider per step | N/A |
| OBSV-04 | Data flow visualization with I/O | manual | Run `ukb full`, expand step in trace, verify entity lists and flow counters | N/A |

### Sampling Rate
- **Per task commit:** `cd integrations/system-health-dashboard && npm run build` (verify no build errors)
- **Per wave merge:** `cd integrations/mcp-server-semantic-analysis && npm run build` + Docker rebuild + visual inspection
- **Phase gate:** Full `ukb full` run with trace modal verification

### Wave 0 Gaps
- [ ] Backend: TypeScript interfaces for TraceLLMCall, TraceAgentInstance, entity flow counters
- [ ] Frontend: Build verification (`npm run build`) passes after TraceModal changes
- [ ] No automated UI tests exist -- all verification is manual via dashboard

## Sources

### Primary (HIGH confidence)
- `trace-modal.tsx` -- current TraceModal implementation (547 lines, flat waterfall)
- `constants.ts` -- STEP_TO_AGENT, AGENT_SUBSTEPS, TIER_COLORS, STEP_DISPLAY_NAMES
- `types.ts` -- StepInfo, ProcessInfo, AgentDefinition interfaces
- `ukbSlice.ts` -- Redux state shape, StepInfo, UKBProcess
- `healthRefreshMiddleware.ts` -- SSE to Redux data flow
- `wave-controller.ts` -- captureStepMetrics, updateProgress, WAVE_STEP_SEQUENCE (1922 lines)
- `workflow-runner.ts` -- writeProgressPreservingDetails, stepsDetail schema
- `.data/workflow-progress.json` -- actual runtime data shape (17 steps with wave, status, timing, outputs, llmProvider, llmCalls, tokensUsed)

### Secondary (MEDIUM confidence)
- CONTEXT.md decisions on trace layout, nesting, entity flow, historical traces

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in use, no new dependencies needed
- Architecture: HIGH -- extending existing proven data flow (wave-controller to progress.json to SSE to Redux to TraceModal)
- Pitfalls: HIGH -- derived from direct code inspection of the actual data flow and known project issues (Docker rebuild, race conditions)

**Research date:** 2026-03-09
**Valid until:** 2026-04-09 (stable -- internal project, no external API dependencies)
