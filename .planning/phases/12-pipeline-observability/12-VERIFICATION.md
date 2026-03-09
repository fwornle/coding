---
phase: 12-pipeline-observability
verified: 2026-03-09T18:30:00Z
status: human_needed
score: 4/4 must-haves verified
gaps: []
human_verification:
  - test: "Run ukb full, open trace modal, verify 3-level Wave > Step > Agent nesting renders correctly"
    expected: "Waves expand to show steps, steps expand to show agents/LLM calls, LLM calls expand to show prompt/response previews"
    why_human: "Visual rendering, interaction flow, layout correctness cannot be verified programmatically"
  - test: "Verify parallel agent waterfall bars overlap correctly for Wave 2/3 agents"
    expected: "Agents that ran in parallel should have overlapping horizontal bars at the same timeline position"
    why_human: "CSS layout positioning and visual overlap require visual inspection"
  - test: "Verify History tab comparison view with two traces selected"
    expected: "Two-column layout with aligned wave rows, green/red delta highlighting for improvements/regressions"
    why_human: "Comparison layout and color-coded deltas need visual confirmation"
  - test: "Verify code evidence references render with monospace styling in LLM call previews"
    expected: "File paths like src/foo.ts and PascalCase class names render in code tags with zinc-800 background"
    why_human: "Regex-based code detection and styling needs visual confirmation with real data"
---

# Phase 12: Pipeline Observability Verification Report

**Phase Goal:** The trace modal provides full visibility into pipeline execution -- how many LLM calls each agent made, how long each wave and agent took, which model was used, and what data flowed between agents
**Verified:** 2026-03-09T18:30:00Z
**Status:** human_needed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | After `ukb full`, the trace modal shows LLM call counts broken down by wave and by agent type | VERIFIED | Wave summary bar renders per-wave LLM call counts (trace-modal.tsx:584-592). AgentInstanceRow shows per-agent LLM call count (trace-modal.tsx:271). wave-controller captures per-LLM-call events via captureLLMCallEvent() (line 138) wired into all 3 waves (lines 238, 307-729). Trace history files confirm llmCallEvents present in saved data. |
| 2 | The trace modal shows wall-clock timing for each wave and each agent invocation | VERIFIED | WaveGroup.totalDuration computed and displayed (trace-modal.tsx:347-353, 663). AgentInstanceRow computes agent duration from startTime/endTime (trace-modal.tsx:250-251, 269). Waterfall bars positioned by CSS offset (trace-modal.tsx:276-281). |
| 3 | The trace modal displays which LLM model and provider were used for each agent call | VERIFIED | LLMCallRow shows model badge with tier-based color (trace-modal.tsx:162-175, 183-185). Expanded detail shows provider and model fields (trace-modal.tsx:196-197). TraceLLMCall interface includes model and provider fields (trace-types.ts:19-21). |
| 4 | The trace modal includes a data flow view showing what input each agent received and what output it produced | VERIFIED | EntityFlowBadge shows produced > passedQA > persisted counters (trace-modal.tsx:128-138). Context-aware detail panel shows entity flow diagram on wave and step levels (trace-modal.tsx:849-866, 939-961). LLM call detail shows promptPreview and responsePreview with code evidence highlighting (trace-modal.tsx:208-224). rejectedReasons displayed when present (trace-modal.tsx:781-787). |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `integrations/mcp-server-semantic-analysis/src/trace-types.ts` | Shared trace type contracts | VERIFIED | 106 lines. Exports TraceLLMCall, TraceAgentInstance, TraceEntityFlow, TraceQAResult, TraceStepExtension. All fields documented with JSDoc. |
| `integrations/mcp-server-semantic-analysis/src/agents/wave-controller.ts` | Per-LLM-call capture, entity flow tracking, QA trace, agent instance grouping | VERIFIED | captureLLMCallEvent (line 138), captureEntityFlow (line 157), captureQAResult (line 173), captureAgentInstance (line 207). Wired into all 3 waves. updateProgress includes trace extension fields (lines 2184-2187). |
| `integrations/mcp-server-semantic-analysis/src/workflow-runner.ts` | Trace history file saving | VERIFIED | saveTraceHistory function (line 422-496). Saves to .data/trace-history/, keeps last 10, wrapped in try/catch. Called after workflow completion (line 658). |
| `integrations/system-health-dashboard/src/store/slices/ukbSlice.ts` | Extended StepInfo with trace fields, WaveGroup, selectWaveGroups | VERIFIED | StepInfo extended with wave, agentInstances, entityFlow, qaResult, llmCallEvents (lines 170-173). WaveGroup interface (line 145). selectWaveGroups selector (line 1785). Frontend trace type interfaces mirrored from backend. |
| `integrations/system-health-dashboard/src/components/workflow/constants.ts` | Agent type colors, wave display names, step categories | VERIFIED | AGENT_TYPE_COLORS (line 843), WAVE_DISPLAY_NAMES (line 853), STEP_CATEGORIES (line 862). |
| `integrations/system-health-dashboard/src/pages/api/trace-history.ts` | REST endpoint for trace history | VERIFIED | 133 lines. handleTraceHistory function. Lists traces with summaries, serves individual trace files. Filename validation with SAFE_FILENAME regex. |
| `integrations/system-health-dashboard/src/components/workflow/trace-modal.tsx` | 3-level nested TraceModal with context-aware detail panel | VERIFIED | 1001 lines (exceeds 400 min). 3-level tree: Wave > Step > Agent. Summary stats bar, EntityFlowBadge, QABadge, LLMCallRow, AgentInstanceRow. Code evidence rendering. History tab with TraceHistoryPanel. Graceful degradation for old data. |
| `integrations/system-health-dashboard/src/components/workflow/trace-history-panel.tsx` | History list, comparison layout, anomaly badges | VERIFIED | 586 lines (exceeds 200 min). List view with checkbox selection, comparison view with aligned wave rows and delta highlighting. Anomaly detection for entity drops, slow runs, failed steps, high rejection. |
| `.data/trace-history/` | Trace history JSON files | VERIFIED | 4 trace files present. Latest file contains all expected keys (workflowName, startTime, endTime, status, totalLLMCalls, totalTokens, entityCounts, stepsDetail) with agentInstances, entityFlow, llmCallEvents, qaResult in step entries. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| wave-controller.ts captureLLMCallEvent() | stepMetrics Map | Pushes TraceLLMCall events into per-step llmCallEvents array | WIRED | Line 145-148: appends to entry.llmCallEvents |
| wave-controller.ts updateProgress() | stepsDetail in workflow-progress.json | Includes agentInstances, entityFlow, qaResult in step entries | WIRED | Lines 2184-2187: spread operator conditionally includes all trace extension fields |
| workflow-runner.ts | .data/trace-history/ | Saves full stepsDetail + metadata as JSON | WIRED | Lines 462-470: creates dir, writes file with timestamp prefix |
| trace-modal.tsx | ukbSlice WaveGroup | Uses WaveGroup for 3-level rendering | WIRED | Imports WaveGroup type (line 33), computes waveGroups in useMemo (line 333) |
| trace-modal.tsx | constants.ts | Uses AGENT_TYPE_COLORS, WAVE_DISPLAY_NAMES, STEP_CATEGORIES | WIRED | Imports at line 41-47, used throughout rendering |
| trace-modal.tsx | trace-history-panel.tsx | History tab renders TraceHistoryPanel | WIRED | Import at line 48, rendered at line 574 |
| trace-history-panel.tsx | /api/trace-history | Fetches trace list and detail via REST | WIRED | fetch('/api/trace-history') at line 192, fetch with file param at lines 261-262 |
| server.js | handleTraceHistory | Express route registration | WIRED | Line 146: app.get('/api/trace-history', this.handleTraceHistory.bind(this)) |
| wave-controller.ts | trace-types.ts | Import trace type contracts | WIRED | Line 39: import from '../trace-types.js' |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| OBSV-01 | 12-01, 12-02, 12-03, 12-04 | Trace modal displays LLM call counts per wave and agent | SATISFIED | Wave summary bar with per-wave LLM counts, AgentInstanceRow with per-agent LLM counts, LLMCallRow with individual call detail |
| OBSV-02 | 12-01, 12-02, 12-03, 12-04 | Trace modal displays timing breakdown per agent and wave | SATISFIED | WaveGroup.totalDuration, agent duration from startTime/endTime, waterfall bars with CSS positioning |
| OBSV-03 | 12-01, 12-02, 12-03 | Trace modal displays model info (which LLM, provider) | SATISFIED | LLMCallRow shows model badge and provider, TraceLLMCall captures model/provider per call |
| OBSV-04 | 12-01, 12-02, 12-03 | Trace modal shows data flow -- what went in/out of each agent | SATISFIED | EntityFlowBadge (produced > passedQA > persisted), promptPreview/responsePreview in LLM call detail, code evidence rendering, rejectedReasons display |

No orphaned requirements found -- all OBSV-01 through OBSV-04 are mapped to Phase 12 in REQUIREMENTS.md and covered by plans.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| trace-modal.tsx | 165 | `return false` in tier color matching (dead code) | Info | Fallback logic at lines 168-174 handles this; the find() call never matches, relying on the heuristic below it. No functional impact. |

### Human Verification Required

### 1. Visual 3-Level Nesting

**Test:** Run `ukb full`, open dashboard at localhost:3032, click completed workflow to open trace modal. Expand Wave 2, expand an analyze step, expand an agent instance.
**Expected:** Three distinct indentation levels visible. Wave rows show aggregate metrics. Step rows show step-level metrics. Agent rows show individual agent detail with LLM calls expandable to prompt/response previews.
**Why human:** Visual rendering hierarchy, indentation, and interactive expand/collapse behavior.

### 2. Parallel Agent Waterfall Bars

**Test:** In trace modal, expand Wave 2 or Wave 3 analyze step with multiple agents.
**Expected:** Agent waterfall bars should overlap horizontally where agents ran concurrently, not stack sequentially.
**Why human:** CSS absolute positioning and visual overlap require visual inspection.

### 3. History Tab Comparison

**Test:** Click "History" tab in trace modal. Select two traces using checkboxes. Click "Compare Selected".
**Expected:** Two-column comparison view with wave-aligned rows. Deltas shown in green (improvement) or red (regression) with threshold-based coloring.
**Why human:** Comparison layout, delta calculation display, and color coding need visual confirmation.

### 4. Code Evidence Rendering

**Test:** Expand an LLM call in the trace modal to see prompt/response previews.
**Expected:** File paths (e.g., `src/agents/wave-controller.ts`) and PascalCase class names (e.g., `WaveController`) rendered in monospace with dark zinc background.
**Why human:** Regex-based detection and CSS styling of code references requires visual inspection with real pipeline data.

### Gaps Summary

No structural gaps found. All four success criteria are met at the code level:

1. **LLM call counts by wave and agent** -- Backend captures via captureLLMCallEvent(), frontend displays in wave summary bar and agent instance rows.
2. **Wall-clock timing** -- Duration computed from startTime/endTime at wave, step, and agent levels with waterfall visualization.
3. **Model and provider info** -- TraceLLMCall captures model/provider, LLMCallRow renders model badges with tier-based colors.
4. **Data flow view** -- EntityFlowBadge shows entity pipeline flow, LLM call detail shows truncated prompt/response with code evidence highlighting.

The only remaining verification needed is visual/interactive confirmation that the UI renders correctly with real pipeline trace data.

---

_Verified: 2026-03-09T18:30:00Z_
_Verifier: Claude (gsd-verifier)_
