# Phase 9: Agent Pipeline Integration - Research

**Researched:** 2026-03-07
**Domain:** Wave pipeline agent orchestration (TypeScript, LLM service integration)
**Confidence:** HIGH

## Summary

Phase 9 transforms the wave pipeline from lightweight standalone LLM calls into a rich multi-agent pipeline where SemanticAnalysisAgent, OntologyClassificationAgent, PersistenceAgent, and InsightGenerationAgent all participate in entity production. The codebase already has all four agents implemented and partially wired -- the work is integration, not creation.

The primary challenge is the per-entity pipeline integration for Waves 2+3, where each entity must flow through `analyze -> classify` as an atomic unit before persistence, while Wave 1 gets a simpler multi-step LLM enhancement. A critical bug exists in `persistWaveResult()` where hierarchy fields (parentId, level, hierarchyPath) are stripped during the `.map()` call before being passed to `persistEntities()`.

**Primary recommendation:** Fix the hierarchy field stripping in `persistWaveResult()` first (quick win, high impact), then integrate SemanticAnalysisAgent into Wave 2+3 agents as a sub-step, change ontology classification from batch-per-wave to per-entity sequential, and finally enhance insight generation input with analysis artifacts.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Hybrid approach: Wave 1 uses enhanced multi-step prompts (2 LLM calls: structure analysis then observation synthesis). Wave 2+3 route through SemanticAnalysisAgent for deep code-grounded analysis
- SemanticAnalysisAgent (semantic-analysis-agent.ts), NOT SemanticAnalyzer -- the focused agent, not the orchestrator. Wave agent stays in control of entity construction
- Sub-step integration: wave agents call SemanticAnalysisAgent for code analysis + observation generation only, then construct entities themselves (hierarchy fields, relationships, suggested children)
- Trace data instrumented now: SemanticAnalysisAgent calls capture LLM call counts, timing, and model info so the data is available for Phase 12 to display
- Per-wave pipeline: SemanticAnalysisAgent + OntologyClassificationAgent run per-wave before persistence. Insights finalize at end (Wave 4) for cross-reference completeness
- Sequential within entity: analyze first, then classify. Ontology gets enriched observations as input
- Per-entity processing: each entity gets its own SemanticAnalysisAgent call with focused code context, then its own ontology classification
- Atomic per-entity pipeline: each parallel slot runs the full analyze->classify pipeline for one entity before taking the next
- Bounded concurrency: 2-3 entities processed in parallel within a wave using existing runWithConcurrency() pattern
- In-memory pipeline: results flow through in-memory (wave agent -> semantic analysis enriches -> ontology classifies -> persistence writes). No graph I/O between agent steps
- Fresh agent instances per wave (current pattern): no cross-wave state contamination
- Fallback on failure: if SemanticAnalysisAgent fails for an entity, fall back to wave agent's own lightweight LLM observations. Mark entity with 'shallow_analysis' flag. No data loss
- Fix mapEntityToSharedMemory() to correctly pass parentId, level, hierarchyPath through the persistence path
- Enable basic structural validation: hierarchy fields present, observations non-empty. Content quality validation stays disabled (Phase 11)
- Discovery stays batch: wave agents discover all entities in one LLM call (current pattern), then SemanticAnalysisAgent enriches each discovered entity individually
- Keep Wave 4 finalization: all insights generated after waves 1-3 complete, for cross-reference completeness
- Pass analysis artifacts: beyond observations, pass SemanticAnalysisAgent's raw analysis artifacts (code patterns, architecture notes) to the insight agent for deeper insight documents
- Add diagrams for L3: all entity levels (L1, L2, AND L3) get full PlantUML diagram treatment
- InsightGenerationAgent logic stays the same, just receives richer input from the pipeline

### Claude's Discretion
- Whether wave agents pass existing CGR file context to SemanticAnalysisAgent or let it read its own code (pick based on actual interface)
- Whether to merge SemanticAnalysisAgent observations with wave agent's own observations or replace entirely (pick based on quality and dedup)
- Insight scope: current-run entities only vs all entities (pick based on full-replace re-run model from Phase 7)
- Concurrency level tuning (2 vs 3 parallel entities) based on LLM rate limits
- Error handling and logging patterns for the enriched pipeline
- How to store and pass analysis artifacts from SemanticAnalysisAgent to InsightGenerationAgent

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AGNT-01 | Wave agent LLM calls route through SemanticAnalyzer for deep, multi-observation analysis | SemanticAnalysisAgent.analyzeGitAndVibeData() exists but is designed for the old batch pipeline. Wave 2+3 agents need a new focused method or adapted call. Wave 1 gets multi-step LLM prompts instead |
| AGNT-02 | Semantic analysis agent integrated into wave pipeline (all 3 waves) | Wave 1: multi-step LLM in wave1-project-agent.ts. Wave 2+3: SemanticAnalysisAgent called as sub-step after entity discovery, before entity construction |
| AGNT-03 | Persistence agent restored in wave persistence path | PersistenceAgent already called in persistWaveResult(). The bug is hierarchy field stripping in the .map() on line 465 of wave-controller.ts |
| AGNT-04 | Insight generation agent produces detailed insight documents per entity | InsightGenerationAgent.generateEntityInsight() already wired in Wave 4. Enhancement: pass SemanticAnalysisAgent artifacts as additional context, enable L3 diagrams |
| AGNT-05 | Ontology classification agent fully integrated into wave pipeline | OntologyClassificationAgent.classifyObservations() already called batch per-wave. Change to per-entity sequential within the analyze->classify atomic pipeline |
</phase_requirements>

## Architecture Patterns

### Current Pipeline Flow (BEFORE Phase 9)
```
Wave Agent discovers entities (1 LLM call)
  -> entities have lightweight observations (1-2 liners)
  -> classifyWaveEntities() runs batch on entire wave result
  -> persistWaveResult() strips hierarchy fields via .map()
  -> Wave 4: InsightGenerationAgent gets basic observations only
```

### Target Pipeline Flow (AFTER Phase 9)
```
Wave Agent discovers entities (1 LLM call, unchanged)
  -> FOR EACH entity (2-3 concurrent via runWithConcurrency):
       -> SemanticAnalysisAgent enriches observations (Wave 2+3)
          OR multi-step LLM enrichment (Wave 1)
       -> OntologyClassificationAgent classifies entity
  -> persistWaveResult() with fixed hierarchy field passthrough
  -> Wave 4: InsightGenerationAgent gets rich observations + analysis artifacts
```

### Recommended Modification Structure
```
src/agents/
  wave-controller.ts        # Fix persistWaveResult(), refactor classifyWaveEntities() to per-entity
  wave1-project-agent.ts    # Add 2-step LLM: structure analysis -> observation synthesis
  wave2-component-agent.ts  # Add SemanticAnalysisAgent sub-step after entity discovery
  wave3-detail-agent.ts     # Add SemanticAnalysisAgent sub-step after entity discovery
  semantic-analysis-agent.ts # Add focused analyzeEntityCode() method for wave integration
src/types/
  wave-types.ts             # Extend WaveAgentOutput with analysis artifacts
```

### Pattern 1: Per-Entity Atomic Pipeline
**What:** Each entity flows through analyze->classify as one atomic unit within a concurrent slot
**When to use:** Wave 2 and Wave 3 entity processing
**Example:**
```typescript
// In wave2-component-agent.ts execute(), after entity discovery:
const enrichEntity = async (entity: KGEntity, fileContext: string[]): Promise<KGEntity> => {
  try {
    const semanticAgent = new SemanticAnalysisAgent(this.repositoryPath);
    const analysis = await semanticAgent.analyzeEntityCode({
      entityName: entity.name,
      entityType: entity.type,
      codeFiles: fileContext,
      parentContext: input.l1Entity.observations,
    });
    // Replace or merge observations
    entity.observations = analysis.observations;
    // Attach raw artifacts for insight generation
    (entity as any)._analysisArtifacts = analysis.artifacts;
    // Attach trace data for Phase 12
    (entity as any)._traceData = analysis.traceData;
  } catch (err) {
    // Fallback: keep lightweight observations
    (entity as any)._shallowAnalysis = true;
    log(`SemanticAnalysisAgent failed for ${entity.name}, using shallow analysis`, 'warning');
  }
  return entity;
};
```

### Pattern 2: Wave 1 Multi-Step LLM Enhancement
**What:** Wave 1 uses 2 LLM calls instead of 1 for deeper observations
**When to use:** Wave 1 only (L0/L1 entities)
**Example:**
```typescript
// Step 1: Structure analysis
const structureAnalysis = await this.llmService.complete({
  prompt: `Analyze the code structure of component ${component.name}...`,
  // ... focused on architecture, patterns, file organization
});

// Step 2: Observation synthesis from structure analysis
const observations = await this.llmService.complete({
  prompt: `Given this structure analysis:\n${structureAnalysis}\n\nGenerate 5+ detailed observations...`,
  // ... focused on multi-paragraph, code-grounded observations
});
```

### Pattern 3: Hierarchy Field Fix in persistWaveResult()
**What:** Pass hierarchy fields through the persistence path instead of stripping them
**Critical bug location:** wave-controller.ts line 464-475
**Example:**
```typescript
// CURRENT (broken): strips hierarchy fields
await persistenceAgent.persistEntities({
  entities: sharedMemoryEntities.map(e => ({
    name: e.name,
    entityType: e.entityType,
    observations: e.observations.map(obs => typeof obs === 'string' ? obs : obs.content),
    significance: e.significance,
    metadata: e.metadata,
    // MISSING: parentId, level, hierarchyLevel, parentEntityName
  })),
  team: this.team,
});

// FIXED: include hierarchy fields that persistEntities processEntity expects
await persistenceAgent.persistEntities({
  entities: sharedMemoryEntities.map(e => ({
    name: e.name,
    entityType: e.entityType,
    observations: e.observations.map(obs => typeof obs === 'string' ? obs : obs.content),
    significance: e.significance,
    metadata: e.metadata,
    // Pass through for processEntity's (entity as any).parentId / .level access
    parentId: e.parentEntityName,
    level: e.hierarchyLevel,
  })),
  team: this.team,
});
```

### Anti-Patterns to Avoid
- **Using SemanticAnalyzer instead of SemanticAnalysisAgent:** The context decision explicitly says use `semantic-analysis-agent.ts`, not `semantic-analyzer.ts` (the orchestrator). The agent is focused; the analyzer is the full pipeline orchestrator from batch-analysis days.
- **Graph I/O between agent steps:** The decision says in-memory pipeline. Don't read from graph DB between analyze and classify steps.
- **Sharing agent instances across entities:** Fresh instances avoid state contamination. The SemanticAnalysisAgent has internal state (llmInitialized) that should be fresh per entity or at minimum per wave.
- **Modifying persistEntities() signature:** The persistence agent's interface is stable. Fix the caller (wave-controller.ts) to pass the right data, not the callee.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Bounded concurrency | Custom Promise pool | `runWithConcurrency()` in wave-controller.ts | Already battle-tested, work-stealing pattern |
| Ontology classification | Manual type assignment | `OntologyClassificationAgent.classifyObservations()` | Handles heuristic + LLM hybrid classification |
| Insight documents | Template string generation | `InsightGenerationAgent.generateEntityInsight()` | Full LLM-generated docs with PlantUML |
| Entity persistence | Direct GraphDB calls | `PersistenceAgent.persistEntities()` | Handles dedup, observation merging, batching |

**Key insight:** All four agents already exist and work. This phase is integration plumbing, not agent creation.

## Common Pitfalls

### Pitfall 1: Hierarchy Field Stripping in persistWaveResult()
**What goes wrong:** `mapEntityToSharedMemory()` correctly sets `parentEntityName` and `hierarchyLevel`, but the `.map()` in `persistWaveResult()` creates a new object that only includes name/entityType/observations/significance/metadata. Hierarchy fields are lost.
**Why it happens:** The `persistEntities()` type signature accepts `{ name, entityType, observations, significance, metadata }` -- hierarchy fields aren't in the type. They're accessed via `(entity as any).parentId` inside processEntity.
**How to avoid:** Add `parentId` and `level` fields to the mapped objects in `persistWaveResult()`. These get picked up by `(entity as any).parentId` / `(entity as any).level` on lines 3384-3392 of persistence-agent.ts.
**Warning signs:** Entities in KG have no `parentEntityName` or `hierarchyLevel` after persistence.

### Pitfall 2: SemanticAnalysisAgent Interface Mismatch
**What goes wrong:** The existing `analyzeGitAndVibeData()` method expects git history and vibe session data. Wave agents don't have that -- they have scoped file lists and component context.
**Why it happens:** SemanticAnalysisAgent was designed for the old batch pipeline, not the wave pipeline.
**How to avoid:** Add a new focused method like `analyzeEntityCode()` that takes entity name, code files, and parent context. Don't try to shoehorn the old interface.
**Warning signs:** Trying to construct fake git/vibe analysis objects to satisfy the old interface.

### Pitfall 3: LLM Rate Limiting with Per-Entity Calls
**What goes wrong:** With 2-3 concurrent entities, each making SemanticAnalysisAgent + OntologyClassification LLM calls, you can hit rate limits.
**Why it happens:** The old batch classification made fewer LLM calls (batch of entities). Per-entity means N more LLM calls per wave.
**How to avoid:** Start with concurrency of 2 (conservative). OntologyClassificationAgent already has heuristic-first classification that avoids LLM for clear cases. Monitor timing.
**Warning signs:** 429 errors from LLM provider, increasing latency per call.

### Pitfall 4: Docker Rebuild After Code Changes
**What goes wrong:** Changes to wave-controller.ts or agent files take effect in source but NOT in the running container.
**Why it happens:** Submodule TS files must be compiled (`npm run build`) AND Docker container rebuilt.
**How to avoid:** After every code change: `cd integrations/mcp-server-semantic-analysis && npm run build && cd /Users/Q284340/Agentic/coding/docker && docker-compose build coding-services && docker-compose up -d coding-services`
**Warning signs:** Changes appear in source files but `ukb full` produces same output as before.

### Pitfall 5: Ontology Batch-to-PerEntity Migration
**What goes wrong:** Moving from `classifyWaveEntities()` (batch) to per-entity classification breaks the current API contract since `classifyObservations()` expects an array of observations.
**Why it happens:** The classification agent is designed for batch input.
**How to avoid:** Call `classifyObservations()` with a single-element array per entity. Or check if the agent has a single-entity classification method. The batch API handles single items fine.
**Warning signs:** Classification returning empty results when called with single entities.

### Pitfall 6: Analysis Artifact Passthrough to Insights
**What goes wrong:** SemanticAnalysisAgent analysis artifacts need to reach InsightGenerationAgent in Wave 4, but they flow through different code paths (wave agents -> wave controller -> insight generation).
**Why it happens:** WaveAgentOutput doesn't have a field for analysis artifacts. They need to be stored somewhere entities can carry them.
**How to avoid:** Extend KGEntity or use the existing `_analysisArtifacts` pattern (attaching to entity via `as any`). Then in `generateInsightsForWaveEntities()`, extract and pass to `generateEntityInsight()`. Consider adding an `additionalContext` parameter or using the existing `observations` enrichment.
**Warning signs:** Insight documents are no richer than before despite SemanticAnalysisAgent enrichment.

## Code Examples

### Current classifyWaveEntities (batch, to be changed to per-entity)
```typescript
// Source: wave-controller.ts:506-579
// Currently called once per wave with ALL entities
private async classifyWaveEntities(waveResult: WaveResult): Promise<{...}> {
  const allEntities = waveResult.agentOutputs.flatMap(o => o.entities);
  const ontologyAgent = new OntologyClassificationAgent(this.team, this.repositoryPath);
  const classificationResult = await ontologyAgent.classifyObservations({
    observations: allEntities.map(entity => ({
      name: entity.name,
      entityType: entity.type || 'Unclassified',
      observations: entity.observations || [],
      significance: entity.significance || 5,
      tags: [],
    })),
    autoExtend: true,
    minConfidence: 0.6,
  });
  // ... applies classification back in-place
}
```

### Current persistWaveResult (hierarchy field bug)
```typescript
// Source: wave-controller.ts:449-496
// Line 465: .map() strips hierarchy fields
await persistenceAgent.persistEntities({
  entities: sharedMemoryEntities.map(e => ({
    name: e.name,
    entityType: e.entityType,
    observations: e.observations.map(obs =>
      typeof obs === 'string' ? obs : obs.content,
    ),
    significance: e.significance,
    metadata: e.metadata,
    // BUG: parentEntityName and hierarchyLevel NOT passed through
  })),
  team: this.team,
});
```

### InsightGenerationAgent.generateEntityInsight() interface
```typescript
// Source: insight-generation-agent.ts:160-167
public async generateEntityInsight(params: {
  entityName: string;
  entityType: string;
  observations: string[];
  relations: Array<{ from: string; to: string; relationType: string }>;
  crossReferences: CrossReferenceContext;
  generateDiagrams: boolean;
}): Promise<{ filePath: string; diagramCount: number; success: boolean }>
```

### KGEntity hierarchy fields
```typescript
// Source: kg-operators.ts:31-47
export interface KGEntity {
  id: string;
  name: string;
  type: string;
  observations: string[];
  significance: number;
  parentId?: string;       // Entity name of parent node
  level?: number;          // 0=Project, 1=Component, 2=SubComponent, 3=Detail
  hierarchyPath?: string;  // Slash-separated path
  // ... other fields
}
```

## Discretion Recommendations

Based on code analysis, here are recommendations for the discretion areas:

### CGR File Context: Pass existing context
**Recommendation:** Wave agents should pass their already-scoped file lists to SemanticAnalysisAgent rather than letting it read its own code. Reason: Wave agents already have CGR-scoped files (via `getComponentFiles()`), and SemanticAnalysisAgent's `analyzeGitAndVibeData()` method expects file paths to be pre-extracted. A new `analyzeEntityCode()` method should accept pre-scoped files.

### Observation Merge Strategy: Replace entirely
**Recommendation:** Replace wave agent's lightweight observations with SemanticAnalysisAgent's deep observations. Reason: The whole point is deeper analysis. Merging creates dedup complexity and observation bloat. If SemanticAnalysisAgent fails, fallback keeps the originals. The `shallow_analysis` flag makes the distinction clear.

### Insight Scope: Current-run entities only
**Recommendation:** Generate insights for current-run entities only. Reason: Phase 7's full-replace model means each run produces a complete entity set. Re-generating insights for all entities (including previous runs) would be wasteful and potentially inconsistent with refreshed observations.

### Concurrency Level: Start with 2
**Recommendation:** Use 2 concurrent entities per wave. Each entity now makes 2+ LLM calls (SemanticAnalysis + Ontology). With 8+ L1 components spawning 20+ L2 entities, that's 40+ LLM calls per wave. 2 concurrent keeps rate limit pressure manageable.

### Analysis Artifact Passthrough
**Recommendation:** Attach artifacts to KGEntity via `_analysisArtifacts` property (already the `as any` pattern used for `_ontologyMetadata`). In `generateInsightsForWaveEntities()`, extract and pass as `additionalContext` in the observations array or extend the `generateEntityInsight()` params.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Custom (no jest/vitest) -- `npm run build && node dist/test.js` |
| Config file | None -- no formal test config |
| Quick run command | `cd integrations/mcp-server-semantic-analysis && npm run build` (compile check) |
| Full suite command | `cd /Users/Q284340/Agentic/coding && coding --claude` then `ukb full` (integration test via actual run) |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AGNT-01 | Deep semantic observations produced | integration | `ukb full` + inspect entity observations in KG | N/A -- manual inspection |
| AGNT-02 | SemanticAnalysisAgent called in all 3 waves | integration | `ukb full` + check Docker logs for SemanticAnalysisAgent log lines | N/A -- log inspection |
| AGNT-03 | Hierarchy fields preserved through persistence | smoke | Compile + `ukb full` + verify entities have parentEntityName/hierarchyLevel in KG | N/A -- manual verification |
| AGNT-04 | Insight documents generated per entity | integration | `ukb full` + check .data/knowledge-graph/insights/ directory | N/A -- file existence check |
| AGNT-05 | Ontology classification per entity | integration | `ukb full` + verify entities have non-auto-assigned ontology metadata | N/A -- manual verification |

### Sampling Rate
- **Per task commit:** `cd integrations/mcp-server-semantic-analysis && npm run build` (compile check -- catches type errors)
- **Per wave merge:** `ukb full` integration run (full pipeline validation)
- **Phase gate:** Full `ukb full` run producing entities with deep observations, hierarchy fields, insight documents, and ontology classifications

### Wave 0 Gaps
- [ ] No formal unit test infrastructure -- all validation is integration-level via `ukb full`
- [ ] Compilation (`npm run build`) is the only automated check available
- [ ] Consider adding a simple validation script that inspects KG output JSON after `ukb full` to verify hierarchy fields, observation depth, insight file existence

## Open Questions

1. **SemanticAnalysisAgent new method signature**
   - What we know: `analyzeGitAndVibeData()` is batch-oriented. Wave agents need focused per-entity analysis.
   - What's unclear: Exact parameter shape for `analyzeEntityCode()`. Should it return `SemanticAnalysisResult` or a simpler shape?
   - Recommendation: Create a new method that takes `{ entityName, entityType, codeFiles: string[], parentContext: string[], analysisDepth: 'deep' }` and returns `{ observations: string[], artifacts: { patterns: string[], architectureNotes: string[] }, traceData: { llmCallCount, timing, model } }`.

2. **Trace data shape for Phase 12**
   - What we know: Phase 12 needs LLM call counts, timing, and model info per agent.
   - What's unclear: Exact schema that Phase 12 will consume.
   - Recommendation: Capture `{ llmCallCount: number, totalDurationMs: number, model: string, provider: string }` per SemanticAnalysisAgent call. Store on entity. Phase 12 can iterate later.

3. **L3 diagram generation impact on runtime**
   - What we know: Currently only L1/L2 get diagrams. Adding L3 means 50+ more PlantUML generations per run.
   - What's unclear: How much this will add to total runtime (PlantUML CLI calls are blocking).
   - Recommendation: Implement but monitor. If too slow, PlantUML diagrams can be made optional per-level via config.

## Sources

### Primary (HIGH confidence)
- `wave-controller.ts` -- Full source read, lines 1-850+. All orchestration logic verified.
- `semantic-analysis-agent.ts` -- Full interface and `analyzeGitAndVibeData()` method verified.
- `persistence-agent.ts` -- `persistEntities()` method and hierarchy field handling verified at lines 3214-3430.
- `insight-generation-agent.ts` -- `generateEntityInsight()` interface verified at line 160.
- `ontology-classification-agent.ts` -- `classifyObservations()` call pattern verified in wave-controller.ts.
- `kg-operators.ts` -- KGEntity interface with hierarchy fields verified at lines 31-47.
- `wave-types.ts` -- All type contracts verified.

### Secondary (MEDIUM confidence)
- CONTEXT.md decisions -- User-locked implementation choices, taken as constraints.
- STATE.md -- Project history and critical pitfalls list.

### Tertiary (LOW confidence)
- Runtime behavior of per-entity OntologyClassification (currently only tested batch). Should work with single-element arrays but unverified.
- L3 diagram generation performance impact -- estimated, not measured.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all code is in the existing codebase, verified via source reads
- Architecture: HIGH -- pipeline flow fully traced through source, bug identified with exact line numbers
- Pitfalls: HIGH -- hierarchy field bug verified at source level, other pitfalls from codebase patterns

**Research date:** 2026-03-07
**Valid until:** 2026-04-07 (stable -- internal codebase, no external dependency changes)
