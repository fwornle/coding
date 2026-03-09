# Phase 12: Pipeline Observability - Context

**Gathered:** 2026-03-09
**Status:** Ready for planning

<domain>
## Phase Boundary

The trace modal provides full visibility into pipeline execution — LLM call counts per wave and agent, timing per wave and agent, model info per call, and data flow between agents to diagnose information loss. This phase enhances the existing TraceModal component and wave-controller instrumentation.

</domain>

<decisions>
## Implementation Decisions

### Trace Detail Level
- Per-LLM-call granularity within each agent — every individual LLM call is a trace event
- Store metadata + truncated I/O per call: model, tokens, duration, purpose, first 500 chars of prompt and response
- Show ALL agent types including non-LLM (OntologyAgent, PersistenceAgent, QA Agent) — full pipeline visibility
- Parallel agents (e.g., 13 Wave 2 component agents) grouped with expand — show "Wave 2 Analyze (13 agents)" as one row, click to expand individual agents
- Capture trace data in real-time via SSE — LLM call events stream live to dashboard as they happen
- Failed/retried LLM calls (rate limits, timeouts) show up alongside successful ones — all attempts visible
- QA validation results (Phase 11 quality gates) appear as dedicated trace events with pass/fail, score, errors
- Entity counts tracked per stage: "9 entities produced → 7 passed QA → 6 persisted" — shows where entities get filtered

### Data Flow Visualization
- Inline in the timeline — each trace row shows input/output summary, click to expand
- Full entity list with observations shown when expanded — each entity name, type, observation count, first observation
- Information loss highlighted — entities filtered/rejected at each stage flagged with the reason (QA rejection, content quality, dedup)
- Observation code evidence references (file paths, class names) shown in the trace data flow

### Trace Modal Layout
- 3-level nesting: Wave → Step (analyze/classify/persist/qa) → Agent instances
- Detail panel is context-aware: Wave level shows summary stats + entity flow; Step level shows agent list + metrics; Agent level shows LLM calls + I/O data
- Summary stats bar enhanced with wave-level breakdown: "Wave 1: 16 calls, 40s | Wave 2: 45 calls, 120s | Wave 3: 30 calls, 80s"
- Parallel execution shown with overlapping waterfall bars at the same vertical level — visually conveys concurrency

### Historical Traces
- Keep last 10 workflow runs in trace history
- Side-by-side comparison of two historical traces — timing, entity counts, LLM calls
- Auto-flag anomalous runs: entity count drops, errors, high QA rejection rate, duration 2x+ longer than average

### Claude's Discretion
- Exact color scheme for LLM tiers and agent types
- Trace history file format and storage location
- Anomaly detection thresholds
- Exact truncation strategy for prompt/response previews
- How to render overlapping parallel bars (CSS approach)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `TraceModal` component (`integrations/system-health-dashboard/src/components/workflow/trace-modal.tsx`) — fully functional waterfall timeline with expandable outputs, already shows LLM metrics, timing, status icons
- `wave-controller.ts` stepMetrics Map (lines 59-100) — already captures tokensUsed, llmCalls, llmProvider, outputs per step via `captureStepMetrics()`
- `SemanticAnalyzer.getStepMetrics()` / `resetStepMetrics()` — existing LLM metrics aggregation used by wave-controller
- `workflow-progress.json` stepsDetail array — already has startTime, endTime, wave, outputs, llmProvider, tokensUsed, llmCalls per step
- SSE stream (port 3033 → healthRefreshMiddleware.ts → Redux ukbSlice) — full real-time data pipeline from backend to dashboard already working

### Established Patterns
- `TraceEventUI` interface: id, name, status, duration, tokensUsed, llmProvider, llmCalls, outputs, error, startOffset, llmTier
- `AGENT_SUBSTEPS` definitions in trace-modal.tsx for LLM tier color coding
- `writeProgressPreservingDetails()` in workflow-runner.ts preserves stepsDetail array across updates
- Entity-level `_traceData` already tracked on entities (wave-controller.ts line 1344-1352) — captures llmCallCount, model, provider, agentType per entity

### Integration Points
- wave-controller.ts `captureStepMetrics()` — extend to capture per-LLM-call detail, not just aggregates
- workflow-runner.ts `stepsDetail` array — extend schema to support nested agent/call events
- healthRefreshMiddleware.ts SSE transform — needs to handle nested trace structure
- Redux ukbSlice — needs to store extended trace data
- TraceModal component — needs 3-level nesting, context-aware detail panel, overlapping bars

</code_context>

<specifics>
## Specific Ideas

- Entity flow counters should make information loss immediately obvious — "9 → 7 → 6" tells you at a glance where entities are being filtered
- The wave-level summary stats bar should be the first thing you see — "which wave took the most time/cost?"
- Parallel agent bars should visually show concurrency — if 13 agents ran in parallel for 30s each, the wall-clock bar should be 30s, not 13x30s
- Failed LLM calls help diagnose provider reliability issues (Groq rate limits, Claude timeouts)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 12-pipeline-observability*
*Context gathered: 2026-03-09*
