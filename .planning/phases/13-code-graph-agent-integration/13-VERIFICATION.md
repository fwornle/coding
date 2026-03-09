---
phase: 13-code-graph-agent-integration
verified: 2026-03-09T18:15:00Z
status: passed
score: 4/4 must-haves verified
---

# Phase 13: Code Graph Agent Integration Verification Report

**Phase Goal:** Wave agents use code-graph-rag as a primary evidence source -- querying call graphs, dependencies, and code snippets -- so entities are grounded in actual code structure rather than purely LLM-generated text
**Verified:** 2026-03-09T18:15:00Z
**Status:** passed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | After `ukb full`, entity observations include code-grounded evidence from CGR (call graph references, dependency info, code snippets) | VERIFIED | Wave agents call `buildStructuralObservations()`, `buildRelationshipObservations()` producing `[CGR]`-prefixed observations pushed into entity.observations arrays. Wave3 adds `[CGR] Call chain:` entries from `queryCallGraph()`. |
| 2 | Wave agents query CGR for each entity they analyze, visible in trace logs as CGR API calls | VERIFIED | Wave1 calls `queryComponentEntities()` (line 131), Wave2 calls `queryEntityDetails()` (line 181), Wave3 calls `queryEntityDetails()` + `queryCallGraph()` (lines 150-151). WaveController captures `cgrStats` per wave step. Trace modal renders `cgrQueryEvents` section. |
| 3 | CGR index is automatically refreshed at wave1_init before analysis begins | VERIFIED | wave-controller.ts line 310-313: creates `CgrQueryCache`, calls `refreshIndex(30_000)` fire-and-forget with 30s timeout. `cgrAvailable` metric captured at line 321. |
| 4 | Entities have a mix of LLM-generated and code-grounded observations distinguishable by source tag | VERIFIED | `autoTagObservations()` static method on SAA (line 2049) tags untagged LLM observations as `[LLM]` or `[LLM+CGR]`. CGR observations pre-tagged `[CGR]`. Existing `[CGR]` observations preserved via filter-then-prepend pattern in wave agents. |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/services/cgr-query-cache.ts` | CgrQueryCache class with component-scoped caching | VERIFIED | 281 lines. Exports CgrQueryCache, CgrComponentData, CgrEntityDetails, CgrCallGraphResult. Wraps CodeGraphAgent with Cypher queries, Map cache, sanitization, graceful degradation. |
| `src/utils/cgr-observation-builder.ts` | CgrObservationBuilder utility for tagged observations | VERIFIED | 114 lines. Exports CgrObservationBuilder with buildStructuralObservations, buildRelationshipObservations, formatForLLMPrompt (produces `<code_graph>` XML with anti-hallucination rules), hasEvidence. |
| `src/trace-types.ts` | TraceCGRQuery interface | VERIFIED | TraceCGRQuery interface at line 44 with queryType, entityName, resultCount, durationMs, cacheHit, status. Added to TraceStepExtension at line 132 as `cgrQueryEvents`. |
| `src/types/wave-types.ts` | Extended EnrichedEntity and AnalyzeEntityCodeInput with CGR fields | VERIFIED | `_noCgrEvidence` at line 70 on EnrichedEntity. `cgrContext` at line 89 on AnalyzeEntityCodeInput. |
| `src/agents/wave-controller.ts` | CGR cache/builder creation, index refresh, agent wiring | VERIFIED | Creates CgrQueryCache at line 310, refreshIndex at 313, getters at 105/110, passes to all 3 agent constructors at lines 1194/1278/1400, captures cgrStats per wave. |
| `src/agents/wave1-project-agent.ts` | CGR component-scoped queries for L1 entities | VERIFIED | Accepts cgrCache/cgrBuilder in constructor. Calls queryComponentEntities, buildStructuralObservations, formatForLLMPrompt. Stores cgrPromptContext per component. Calls autoTagObservations. |
| `src/agents/wave2-component-agent.ts` | CGR snippet/signature queries for L2 entities | VERIFIED | Calls queryEntityDetails, buildStructuralObservations, buildRelationshipObservations, formatForLLMPrompt. Sets _noCgrEvidence flag. Calls autoTagObservations. Preserves existing [CGR] obs. |
| `src/agents/wave3-detail-agent.ts` | CGR deep call graph queries for L3 entities | VERIFIED | Calls queryEntityDetails + queryCallGraph(depth=2). Builds call chain observations. Calls formatForLLMPrompt(details, callGraph). Sets _noCgrEvidence. Calls autoTagObservations. |
| `src/agents/semantic-analysis-agent.ts` | cgrContext prompt injection + autoTagObservations | VERIFIED | Lines 1957-1962: injects cgrContext as `<code_graph>` section in LLM prompt with tagging instructions. Line 2049: autoTagObservations static method with regex-based code reference detection. |
| `workflow/types.ts` (dashboard) | TraceCGRQuery frontend type | VERIFIED | TraceCGRQuery interface at line 120, matching backend shape. |
| `workflow/trace-modal.tsx` (dashboard) | CGR Queries section in trace modal | VERIFIED | CGRQueryRow component with query type color coding. Code Graph Queries section with summary stats (queries, cached, duration). Falls back to "No CGR queries" message. |
| `cgr-reindex-modal.tsx` (dashboard) | Index freshness indicator | VERIFIED | Fetches /api/cgr/freshness. Shows last indexed relative time, entity count, incremental refresh availability, Memgraph status badge. |
| `server.js` (dashboard) | CGR freshness endpoint | VERIFIED | GET /api/cgr/freshness at line 150. Returns lastIndexedAt, entityCount, memgraphRunning, incrementalRefreshAvailable. |
| `trace-history-panel.tsx` (dashboard) | CGR stats and regression detection | VERIFIED | cgrStats per run, CGR regression anomaly type, comparison view with CGR queries delta, avgCgrQueries average calculation. |
| `ukb-workflow-modal.tsx` (dashboard) | CGR availability badge in wave progress | VERIFIED | Line 1514: CGR availability badge with green/gray dot, query/cache stats from wave1_init step. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| cgr-query-cache.ts | code-graph-agent.ts | imports CodeGraphAgent, calls runCypherQuery() | WIRED | Import at line 14, constructor creates CodeGraphAgent, queryComponentEntities/queryEntityDetails/queryCallGraph all call runCypherQuery() |
| wave-controller.ts | cgr-query-cache.ts | creates CgrQueryCache at wave1_init, calls initialize() | WIRED | Creates at line 310, refreshIndex at 313, passes to agents at 1194/1278/1400 |
| wave2-component-agent.ts | cgr-query-cache.ts | queryEntityDetails() call before SAA | WIRED | Line 181: `await this.cgrCache.queryEntityDetails(entity.name, input.componentFiles)` |
| semantic-analysis-agent.ts | LLM prompt | cgrContext injected as code_graph XML section | WIRED | Lines 1957-1962: cgrBlock inserted into prompt when input.cgrContext present |
| wave agents | entity.observations | CgrObservationBuilder produces [CGR]-tagged strings | WIRED | All 3 agents call buildStructuralObservations/buildRelationshipObservations, push results into observations, preserve [CGR] obs after SAA |
| trace-modal.tsx | stepsDetail cgrQueryEvents | reads cgrQueryEvents from step data | WIRED | Line 858: renders cgrQueryEvents with CGRQueryRow component |
| cgr-reindex-modal.tsx | server.js /api/cgr/freshness | fetch call for index freshness data | WIRED | Line 59: fetches /api/cgr/freshness |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| CGR-01 | 13-02, 13-03 | CGR wired into wave pipeline as code-evidence source | SATISFIED | All 3 wave agents query CgrQueryCache, produce [CGR] observations, pass cgrContext to SAA. Dashboard shows CGR queries. |
| CGR-02 | 13-02 | Wave agents query CGR for call graphs, dependencies, code snippets | SATISFIED | Wave1: queryComponentEntities. Wave2: queryEntityDetails (callees, imports, signatures). Wave3: queryEntityDetails + queryCallGraph(depth=2). |
| CGR-03 | 13-02, 13-03 | CGR evidence attached as code-grounded observations | SATISFIED | [CGR]-prefixed observations from CgrObservationBuilder. [LLM+CGR] auto-tagged by autoTagObservations(). Dashboard trace history tracks CGR stats. |
| CGR-04 | 13-01 | CGR index refreshed at wave1_init | SATISFIED | wave-controller.ts line 313: cgrCache.refreshIndex(30_000) fire-and-forget at wave1_init with 30s timeout and graceful degradation. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None found | - | - | - | No TODOs, FIXMEs, placeholders, or empty implementations in any Phase 13 artifacts |

### Human Verification Required

### 1. CGR Queries Return Data at Runtime

**Test:** Run `ukb full` with Memgraph running and indexed
**Expected:** Docker logs show `[CgrQueryCache]` info/warning messages, entities gain `[CGR]`-prefixed observations, trace modal shows non-zero CGR query counts
**Why human:** Depends on Memgraph being running with actual indexed data; cannot verify query results programmatically without live services

### 2. Trace Modal CGR Section Visual Correctness

**Test:** Open trace modal for a completed ukb run that had CGR enabled
**Expected:** Code Graph Queries section shows queries with color-coded type badges (blue/green/purple/gray), cache hit indicators, and summary stats
**Why human:** Visual rendering and layout correctness requires browser inspection

### 3. CGR Freshness Indicator in Reindex Modal

**Test:** Open CGR reindex modal in dashboard
**Expected:** Shows relative time since last index, entity count, Memgraph status badge
**Why human:** Requires live Memgraph service and visual verification

### 4. Graceful Degradation Without Memgraph

**Test:** Run `ukb full` with Memgraph stopped
**Expected:** Pipeline continues with LLM-only observations, no crashes. CGR badge shows "No CGR" in wave progress.
**Why human:** Requires stopping Memgraph service and running full pipeline

### Gaps Summary

No gaps found. All four success criteria from ROADMAP.md are verified in the codebase:

1. Code-grounded CGR evidence flows through the full pipeline: CGR queries -> [CGR] observations -> entity.observations
2. All 3 wave agents query CGR per entity with visible Cypher calls through CgrQueryCache
3. Index refresh fires at wave1_init with 30s timeout and graceful fallback
4. Three-tier observation tagging ([CGR], [LLM+CGR], [LLM]) is applied via autoTagObservations post-processing

The implementation is complete, substantive (no stubs or placeholders), and fully wired end-to-end from backend query layer through wave agent integration to dashboard observability.

---

_Verified: 2026-03-09T18:15:00Z_
_Verifier: Claude (gsd-verifier)_
