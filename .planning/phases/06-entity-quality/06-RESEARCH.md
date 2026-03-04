# Phase 6: Entity Quality - Research

**Researched:** 2026-03-04
**Domain:** Wave pipeline observation enrichment + insight document generation
**Confidence:** HIGH

## Summary

Phase 6 enhances the output quality of the wave-based analysis pipeline built in Phase 5. Two distinct workstreams are needed: (1) enriching LLM prompts in wave agents so every entity gets 3+ specific observations with code artifact references, plus post-LLM validation with retry/supplementation logic; and (2) wiring the existing `InsightGenerationAgent` into the WaveController as a finalization step that runs after all three waves complete, generating markdown insight documents with PlantUML diagrams for L1/L2 entities and text-only insights for L0/L3 entities.

The codebase is well-positioned for this phase. The `InsightGenerationAgent` (6082 lines) is a fully operational engine with `generateTechnicalDocumentation()` for observation-based content, `generateDeepInsight()` for LLM-synthesized narrative, `generateAllDiagrams()` for parallel 4-diagram PlantUML generation, and `validateAndFixPlantUML()` for syntax repair. The `WaveController` already has a `runWithConcurrency()` work-stealing pattern that can be reused for bounded-parallel insight generation. All entity metadata fields (`validated_file_path`, `has_insight_document`) already exist on `SharedMemoryEntity.metadata`.

**Primary recommendation:** Modify wave agent prompts for observation quality, add observation count validation with retry, then add a `generateInsightsForWaveEntities()` finalization method to WaveController that instantiates InsightGenerationAgent and processes entities with bounded concurrency after Wave 3 persistence.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Enhance LLM prompts in Wave1/2/3 agents to produce richer, more specific observations directly
- Add post-LLM validation that enforces minimum 3 observations per entity
- If fewer than 3 returned: retry once with an enriched prompt including code snippets and hierarchy context
- If still under 3 after retry: supplement from entity description, hierarchy path, and code-graph-rag file analysis
- Observations stay as plain strings (string[]) -- content quality matters more than wrapper format
- Observation quality bar: must reference specific code artifacts (files, classes, functions, patterns). "Uses GraphDatabaseAdapter for LevelDB persistence" not "Handles data storage"
- Insight generation runs as a finalization step after all waves complete -- not inline during waves
- All entities and relationships exist at this point, so cross-references are complete
- Only generate insights for entities created/updated in the current wave run (not all entities in graph)
- Use bounded concurrency via existing runWithConcurrency work-stealing pattern (2-3 entities in parallel)
- Insight files stored in existing location: knowledge-management/insights/<EntityName>.md with puml/ and images/ subdirectories
- After generating each insight, update entity metadata: validated_file_path and has_insight_document = true
- PlantUML diagrams generated for L1 Component and L2 SubComponent entities only (matches QUAL-03 "architectural entities")
- All 4 diagram types generated: architecture, sequence, use-cases, class (InsightGenerationAgent already does this in parallel)
- L0 Project and L3 Detail entities get text-only insight documents (no diagrams) -- satisfies QUAL-02 for all entities
- If a diagram fails to render after LLM repair attempts: skip that diagram type, continue with remaining diagrams and insight doc
- Each insight document references parent, children, and sibling entities at the same level
- Describes relationships in context (e.g., "Pipeline is a sub-component of SemanticAnalysis alongside Ontology and Insights")
- Cross-references appear in two forms: natural references woven into narrative text AND a structured "Related Entities" section at the end
- Entity names rendered as relative markdown links: [Pipeline](./Pipeline.md) -- navigable in any markdown viewer
- One-line description for each related entity uses its first observation (no extra LLM call)

### Claude's Discretion
- Exact LLM prompt wording for enriched observation generation
- WaveController integration architecture for the insight finalization step
- Concurrency level for insight generation (2-3 entities, tuned to LLM rate limits)
- InsightGenerationAgent method selection (generateInsightDocument vs generateTechnicalDocumentation)
- Observation retry prompt design and supplementation strategy
- Error handling and logging for the finalization step

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| QUAL-01 | Each entity produced by the pipeline has 3+ meaningful, specific observations (not one-liner stubs) | Enhanced LLM prompts in wave agents + post-LLM validation with retry + supplementation fallback. Current prompts ask for 3-7 observations but have no enforcement. |
| QUAL-02 | Each entity gets a detailed insight document (markdown with architecture context, purpose, patterns) | InsightGenerationAgent.generateTechnicalDocumentation() already produces this format. Wire into WaveController finalization step for all entities. |
| QUAL-03 | Insight documents include PlantUML diagrams for architectural entities | InsightGenerationAgent.generateAllDiagrams() generates all 4 diagram types in parallel. Apply only to L1 (Component) and L2 (SubComponent) entities per user decision. |
| QUAL-05 | Insight documents cross-reference related entities and parent/child relationships | generateTechnicalDocumentation() already has Related Entities section with dependencies/used-by. Enhance to include parent/children/siblings with relative markdown links and first-observation descriptions. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| LLMService | internal | LLM completions for observation generation and deep insights | Already used by all wave agents; provides provider abstraction, retry, timeout |
| InsightGenerationAgent | internal (6082 lines) | Markdown insight docs + PlantUML diagram generation | Fully operational engine with generateTechnicalDocumentation, generateDeepInsight, generateAllDiagrams |
| WaveController | internal (724 lines) | Wave orchestration + entity persistence | Has runWithConcurrency pattern, persistWaveResult hook point |
| PersistenceAgent | internal | Entity storage to GraphDB (Graphology + LevelDB) | Has updateEntityObservations, storeEntityToGraph, linkInsightDocuments methods |
| GraphDatabaseAdapter | internal | Direct Graphology + LevelDB access | Entity CRUD, relationship storage, team scoping |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| SemanticAnalyzer | internal | LLM analysis interface used by InsightGenerationAgent | Deep insight generation via analyzeContent() |
| SerenaCodeAnalyzer | internal | Code reference extraction from observations | When observations contain file/class references |
| plantuml CLI | system | PlantUML rendering to PNG | Diagram generation for L1/L2 entities |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| generateTechnicalDocumentation | generateInsightDocument | generateInsightDocument requires gitAnalysis/vibeAnalysis params not available in wave context; generateTechnicalDocumentation takes observations/relations directly -- much better fit |
| Inline insight generation (during waves) | Post-wave finalization | Finalization ensures all entities + relationships exist for complete cross-references; inline would miss sibling/child entities not yet created |

## Architecture Patterns

### Recommended Integration Architecture

The WaveController execute() method currently follows this flow:
```
Wave 1 -> persist -> Wave 2 -> persist -> Wave 3 -> persist -> summary
```

Phase 6 extends this to:
```
Wave 1 -> persist -> Wave 2 -> persist -> Wave 3 -> persist -> INSIGHT FINALIZATION -> summary
```

### Wave Controller Finalization Step

**What:** A new `generateInsightsForWaveEntities()` private method on WaveController, called after Wave 3 persistence and before `buildSummaryReport()`.

**Architecture:**
```typescript
// In WaveController.execute(), after Wave 3 persistence:

// ---- Insight Finalization ----
this.logWaveBanner('FINALIZATION', 'Insight Document Generation');
this.updateProgress({ currentWave: 4, totalWaves: 4, message: 'Generating insight documents' });

const insightResult = await this.generateInsightsForWaveEntities(waveResults);
```

**Method signature:**
```typescript
private async generateInsightsForWaveEntities(
  waveResults: WaveResult[]
): Promise<{ generated: number; failed: number; skippedDiagrams: number }>
```

**Key design decisions:**
1. Instantiate InsightGenerationAgent once (constructor takes repositoryPath)
2. Collect ALL entities from all 3 waves' agentOutputs
3. Collect ALL relationships from all 3 waves' agentOutputs
4. For each entity, build the cross-reference context (parent, children, siblings)
5. Use runWithConcurrency(tasks, 2) for bounded parallel processing
6. After each insight is generated, update entity metadata via GraphDatabaseAdapter

### Pattern 1: Observation Enrichment via Enhanced LLM Prompts

**What:** Strengthen the prompt instructions in each wave agent to produce richer, more specific observations.

**Current state (Wave 1, line 184):**
```typescript
// Current prompt instruction:
"2. List 3-7 specific observations about this component. Each observation should be a detailed
sentence about architecture, behavior, or design decisions. NOT generic boilerplate."
```

**Enhanced prompt pattern:**
```typescript
const observationPrompt = `
2. List 5-7 specific observations about this component. Each observation MUST:
   - Reference at least one specific code artifact (file path, class name, function name, or module)
   - Describe a concrete architectural decision, behavior, or pattern
   - Be self-contained (understandable without reading the source)

   GOOD observations:
   - "Uses GraphDatabaseAdapter (storage/graph-database-adapter.ts) for Graphology+LevelDB persistence with automatic JSON export sync"
   - "Wave agents follow constructor(repoPath, team) + ensureLLMInitialized() + execute(input) pattern for lazy LLM initialization"
   - "Implements work-stealing concurrency via shared atomic index counter in runWithConcurrency() (wave-controller.ts:489)"

   BAD observations (DO NOT write these):
   - "Handles data storage" (too generic)
   - "Is an important component" (no code reference)
   - "Processes data efficiently" (no specifics)
`;
```

**Apply to all three wave agents:**
- wave1-project-agent.ts: `analyzeComponent()` prompt (line 166)
- wave2-component-agent.ts: `analyzeL2Components()` prompt (line 170)
- wave3-detail-agent.ts: `discoverL3Details()` prompt (line 148)

### Pattern 2: Post-LLM Observation Validation with Retry

**What:** After parsing LLM response, validate observation count and quality. Retry once if insufficient, then supplement.

**Implementation location:** Add validation logic in each wave agent's parse method after JSON extraction.

```typescript
// After parsing LLM response observations:
private async ensureMinimumObservations(
  entityName: string,
  observations: string[],
  context: { description: string; hierarchyPath: string; fileContents: string }
): Promise<string[]> {
  // Step 1: Filter out generic observations
  const specific = observations.filter(obs => this.isSpecificObservation(obs));

  if (specific.length >= 3) return specific;

  // Step 2: Retry with enriched prompt (one attempt)
  if (specific.length < 3) {
    const retryObs = await this.retryObservationGeneration(entityName, context);
    const combined = [...specific, ...retryObs];
    const deduped = [...new Set(combined)];
    if (deduped.length >= 3) return deduped.slice(0, 7);
  }

  // Step 3: Supplement from available data
  return this.supplementObservations(entityName, specific, context);
}

private isSpecificObservation(obs: string): boolean {
  // Must be non-trivial length
  if (obs.length < 30) return false;
  // Must contain at least one code artifact indicator
  const hasCodeRef = /\b(\.ts|\.js|\.py|class\s|function\s|module|interface|implements|extends|import|export|const\s|let\s|var\s)\b/i.test(obs)
    || /[A-Z][a-z]+[A-Z]/.test(obs)  // PascalCase/camelCase names
    || /\w+\.\w+\(/.test(obs)         // method calls
    || /\/[\w-]+\//i.test(obs);       // file paths
  return hasCodeRef;
}
```

### Pattern 3: Insight Document Cross-References

**What:** Each insight document includes parent, children, and sibling entity references with relative markdown links and first-observation descriptions.

**Implementation approach:** Build cross-reference context before calling generateTechnicalDocumentation.

```typescript
// Build cross-reference data for an entity from wave results
function buildCrossReferences(
  entity: KGEntity,
  allEntities: KGEntity[],
  allRelationships: KGRelation[]
): CrossReferenceContext {
  const parent = allEntities.find(e => e.name === entity.parentId);
  const children = allEntities.filter(e => e.parentId === entity.name);
  const siblings = entity.parentId
    ? allEntities.filter(e => e.parentId === entity.parentId && e.name !== entity.name)
    : [];

  return {
    parent: parent ? { name: parent.name, firstObservation: parent.observations[0] } : undefined,
    children: children.map(c => ({ name: c.name, firstObservation: c.observations[0] })),
    siblings: siblings.map(s => ({ name: s.name, firstObservation: s.observations[0] })),
  };
}
```

**Insight document template addition:**
```markdown
## Related Entities

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- Multi-agent pipeline for automated knowledge extraction

### Children
- [WaveController](./WaveController.md) -- Hierarchical wave orchestration engine replacing flat batch-analysis DAG
- [InsightGeneration](./InsightGeneration.md) -- Generates markdown insight documents with PlantUML diagrams

### Siblings
- [KnowledgeStorage](./KnowledgeStorage.md) -- Graphology+LevelDB persistence layer for knowledge graph entities
- [Ontology](./Ontology.md) -- Upper and lower ontology classification system
```

### Pattern 4: generateTechnicalDocumentation Adaptation for Wave Context

**What:** The existing `generateTechnicalDocumentation` method (line 220) is the right choice over `generateInsightDocument` (line 1610).

**Why:** `generateInsightDocument` requires `gitAnalysis`, `vibeAnalysis`, `semanticAnalysis`, and `PatternCatalog` parameters that come from the old batch pipeline. These aren't available in the wave context. In contrast, `generateTechnicalDocumentation` takes exactly what wave entities provide: `entityName`, `entityType`, `observations[]`, `relations[]`, and optional `diagrams[]`.

**Key adaptation needed:** The cross-reference section must be enhanced. The existing `generateTechnicalDocumentation` has a basic Related Entities section with outgoing/incoming relationships. Phase 6 needs to add:
1. Parent/children/siblings from hierarchy data (not just relationship edges)
2. Relative markdown links `[Name](./Name.md)` instead of plain text
3. First-observation descriptions for each related entity

**Approach:** Extend the `relations` parameter or add a new `crossReferences` parameter to `generateTechnicalDocumentation`. Since this is a private method, the signature can be modified freely.

### Anti-Patterns to Avoid

- **Generating insights inline during waves:** Would miss sibling entities not yet created. The finalization step guarantees all entities exist for complete cross-references.
- **Using generateInsightDocument for wave entities:** Requires batch pipeline data structures (gitAnalysis, vibeAnalysis) not available in wave context. Use generateTechnicalDocumentation instead.
- **Blocking diagram failures:** A failed diagram should NOT prevent the insight document from being generated. Skip the diagram type and continue.
- **Re-classifying entities during insight metadata update:** Use storeEntityToGraph carefully or directly update via GraphDatabaseAdapter to avoid triggering ontology re-classification. The existing `hasValidPreClassification` check should handle this.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PlantUML diagram generation | Custom PlantUML string builder | InsightGenerationAgent.generateAllDiagrams() | Already handles LLM-enhanced generation, validation, auto-repair, parallel execution, file naming conventions |
| PlantUML syntax fixing | Manual regex fixes | InsightGenerationAgent.validateAndFixPlantUML() | Handles 20+ common PlantUML syntax errors |
| Bounded parallel execution | Custom Promise.all with limits | WaveController.runWithConcurrency() | Work-stealing pattern already handles fail-fast, ordered results |
| Entity metadata updates | Direct LevelDB writes | PersistenceAgent.storeEntityToGraph() | Handles ontology classification skip, insight file linking, relationship storage |
| Deep insight narrative | Template-based markdown | InsightGenerationAgent.generateDeepInsight() | LLM-powered synthesis with grounding rules, produces coherent narrative from observations |
| Markdown file output | Custom file writer | InsightGenerationAgent already handles outputDir, directory creation, file writing, orphan cleanup |

**Key insight:** InsightGenerationAgent is a 6000+ line battle-tested engine. The phase's job is to wire it into the wave pipeline, not rebuild any of its capabilities.

## Common Pitfalls

### Pitfall 1: generateInsightDocument vs generateTechnicalDocumentation Confusion
**What goes wrong:** Using `generateInsightDocument` (line 1610) instead of `generateTechnicalDocumentation` (line 220) for wave entities, then getting crashes because gitAnalysis/vibeAnalysis are null.
**Why it happens:** `generateInsightDocument` is the main entry point for the old batch pipeline and looks like the "right" public method.
**How to avoid:** Use `generateTechnicalDocumentation` which takes `entityName, entityType, observations[], relations[], diagrams[]` directly. These map 1:1 to wave entity data.
**Warning signs:** Null reference errors on `gitAnalysis.commits` or `patternCatalog.patterns`.

### Pitfall 2: InsightGenerationAgent Constructor Side Effects
**What goes wrong:** InsightGenerationAgent constructor (line 129) creates directories, checks PlantUML availability, loads ontology descriptions, and creates multiple sub-agents (SemanticAnalyzer, ContentAgnosticAnalyzer, RepositoryContextManager, SerenaCodeAnalyzer, WebSearchAgent). Instantiating it multiple times wastes resources.
**Why it happens:** Natural instinct to create agent per entity.
**How to avoid:** Instantiate InsightGenerationAgent ONCE before the concurrency loop. Pass it to each task closure.
**Warning signs:** Multiple "PlantUML available" log messages, slow startup.

### Pitfall 3: Observation Quality Check False Negatives
**What goes wrong:** The `isSpecificObservation()` check rejects valid observations that reference code artifacts using unusual formats.
**Why it happens:** Regex patterns are too strict or don't cover all naming conventions (e.g., kebab-case file names, Go-style names).
**How to avoid:** Make the check lenient -- focus on rejecting clearly generic observations rather than validating specific patterns. A 30+ character observation with any proper noun is likely specific enough.
**Warning signs:** Too many observations being rejected, leading to excessive retries and LLM cost.

### Pitfall 4: Diagram Generation Blocking Insight Finalization
**What goes wrong:** If PlantUML CLI is unavailable or all 4 diagram types fail for an entity, the entire finalization step stalls.
**Why it happens:** Not handling the InsightGenerationAgent's diagram failure paths correctly.
**How to avoid:** The user decision explicitly says "skip that diagram type, continue with remaining diagrams and insight doc." The existing `generateAllDiagrams` already returns failed diagrams with `success: false`. The `generateTechnicalDocumentation` already handles empty diagram arrays gracefully.
**Warning signs:** Finalization step hanging for 60s+ per entity (LLM timeout on diagram content generation).

### Pitfall 5: Missing runWithConcurrency Access
**What goes wrong:** `runWithConcurrency` is a private method on WaveController. New insight finalization code can call it directly since it's also a private method on the same class.
**Why it happens:** Thinking about access modifiers when adding to the same class.
**How to avoid:** The finalization method goes directly on WaveController as a private method, alongside runWithConcurrency. No access issues.

### Pitfall 6: Entity Type Field Mismatch (KGEntity.type vs SharedMemoryEntity.entityType)
**What goes wrong:** Passing `entity.entityType` when the field is actually `entity.type` on KGEntity, or vice versa.
**Why it happens:** Two different interfaces use different field names for the same concept.
**How to avoid:** Always use `entity.type` when working with KGEntity (from wave agents), and `entity.entityType` when working with SharedMemoryEntity (for persistence). The existing `mapEntityToSharedMemory` already handles this mapping correctly.
**Warning signs:** Entities stored as "undefined" type.

### Pitfall 7: Submodule Build + Docker Rebuild
**What goes wrong:** Code changes to wave agents or WaveController don't take effect at runtime.
**Why it happens:** TypeScript source must be compiled (`npm run build`) and the Docker container must be rebuilt.
**How to avoid:** After ALL code changes: `cd integrations/mcp-server-semantic-analysis && npm run build && cd ../../docker && docker-compose build coding-services && docker-compose up -d coding-services`.
**Warning signs:** New log messages don't appear, behavior unchanged after code edits.

## Code Examples

### Example 1: Current Wave1 LLM Prompt (Enhancement Target)
```typescript
// Source: wave1-project-agent.ts line 166-196
const prompt = `You are analyzing the ${component.name} component of the Coding project.

## Project Context
${directoryStructure}

## Existing Knowledge
${existingEntitiesContext}

## Component Definition
Name: ${component.name}
Description: ${component.description}
Keywords: ${component.keywords.join(', ')}

## Source Files
${fileContentsBlock}

## Task
1. Write a comprehensive summary (2-3 paragraphs) of what this component does...
2. List 3-7 specific observations about this component. Each observation should be a detailed
   sentence about architecture, behavior, or design decisions. NOT generic boilerplate.
3. Suggest sub-components (L2 nodes)...

## Output Format (JSON)
{
  "summary": "...",
  "observations": ["...", "..."],
  "suggestedChildren": [...]
}`;
```

### Example 2: generateTechnicalDocumentation Invocation Pattern
```typescript
// Source: insight-generation-agent.ts line 220-377
// This is the method to use for wave entities
const content = await insightAgent['generateTechnicalDocumentation']({
  entityName: entity.name,
  entityType: entity.type,
  observations: entity.observations,
  relations: allRelationships
    .filter(r => r.from === entity.name || r.to === entity.name)
    .map(r => ({ from: r.from, to: r.to, relationType: r.type })),
  diagrams: successfulDiagrams.map(d => ({ name: d.name, type: d.type, success: d.success }))
});
```

### Example 3: runWithConcurrency Pattern
```typescript
// Source: wave-controller.ts line 489-529
// Already used for Wave 2/3 agent parallelism
private async runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  maxConcurrent: number,
): Promise<T[]> {
  // Work-stealing pattern: shared index counter, workers pull tasks when idle
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;
  // ... workers pull from nextIndex atomically
}

// Usage for insight finalization:
const insightTasks = entities.map(entity => async () => {
  return await this.generateEntityInsight(entity, allEntities, allRelationships, insightAgent);
});
await this.runWithConcurrency(insightTasks, 2); // 2 concurrent insight generations
```

### Example 4: Entity Metadata Update for Insight Link
```typescript
// Source: persistence-agent.ts line 1063-1074
// storeEntityToGraph automatically links insight files by checking filesystem
const insightsDir = path.join(this.repositoryPath, 'knowledge-management', 'insights');
const insightFilePath = path.join(insightsDir, `${entity.name}.md`);
try {
  await fs.promises.access(insightFilePath);
  entity.metadata.validated_file_path = insightFilePath;
  entity.metadata.has_insight_document = true;
} catch {
  // No insight file exists yet
}
```

### Example 5: Diagram Generation for Architectural Entities
```typescript
// Source: insight-generation-agent.ts line 1808-1854
// Parallel 4-diagram generation (architecture, sequence, use-cases, class)
const diagrams = await insightAgent['generateAllDiagrams'](toKebabCase(entity.name), {
  patternCatalog: null,
  entityInfo: {
    name: entity.name,
    type: entity.type,
    observations: entity.observations
  }
});
// Returns PlantUMLDiagram[] with success/failure per type
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Flat batch analysis with insight generation for patterns | Wave-based hierarchical analysis (Phase 5) | 2026-03-04 | Entities now have hierarchy context (parentId, level, hierarchyPath) |
| generateInsightDocument from git/vibe analysis | generateTechnicalDocumentation from observations | Phase 5 era | Observation-based docs are more grounded in actual code |
| Single insight per pipeline run | Per-entity insight documents | Available since insight-generation-agent refactor | Each entity gets its own .md file |
| Insight generation in coordinator batch pipeline | (Phase 6) Insight generation in WaveController finalization | This phase | Insight docs will have complete cross-reference data |

**Deprecated/outdated:**
- `generateInsightDocument` for wave entities: Use `generateTechnicalDocumentation` instead (takes observation data directly)
- `generateComprehensiveInsights` for wave context: This is the coordinator's batch pipeline entry point, requires git/vibe analysis data not available in wave context

## Open Questions

1. **generateTechnicalDocumentation is private -- how to access from WaveController?**
   - What we know: It's a private method on InsightGenerationAgent (line 220)
   - What's unclear: Whether to make it public, use bracket notation, or create a public wrapper
   - Recommendation: Add a new public method `generateEntityInsight(params)` to InsightGenerationAgent that wraps `generateTechnicalDocumentation` + optional `generateAllDiagrams`. This is cleaner than bracket-notation private access. The new method serves as the wave-pipeline API surface.

2. **Cross-reference enhancement: modify generateTechnicalDocumentation or post-process?**
   - What we know: The existing method has a Related Entities section using relations. We need to add parent/children/siblings with markdown links.
   - What's unclear: Whether to modify the existing method signature or add cross-reference content after the fact.
   - Recommendation: Extend the params to include a `crossReferences` object with parent/children/siblings data. The method already builds sections -- add a new section builder for hierarchy context. This keeps the change contained.

3. **How to collect "entities from current wave run" for selective insight generation?**
   - What we know: WaveController.execute() has access to all three WaveResult objects. Each WaveResult.agentOutputs contains KGEntity arrays.
   - What's unclear: Whether to track entity names in a Set or simply iterate agentOutputs.
   - Recommendation: Flatten all agentOutputs from all 3 waves into a single KGEntity[] and KGRelation[]. This gives the complete set of entities that need insights.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Manual validation via `ukb full` pipeline execution |
| Config file | none -- integration testing via live pipeline |
| Quick run command | `npm run build` in submodule + Docker rebuild + `ukb full debug` for mock mode |
| Full suite command | `ukb full` for real LLM execution |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| QUAL-01 | 3+ specific observations per entity | smoke | After `ukb full`: query KG entities and verify observation counts | N/A -- manual verification |
| QUAL-02 | Each entity has insight document | smoke | `ls knowledge-management/insights/*.md` and cross-check with KG entity names | N/A -- manual verification |
| QUAL-03 | PlantUML diagrams for L1/L2 entities | smoke | `ls knowledge-management/insights/images/*.png` and verify L1/L2 entity coverage | N/A -- manual verification |
| QUAL-05 | Cross-references in insight docs | smoke | `grep -l "Related Entities" knowledge-management/insights/*.md` + verify markdown links | N/A -- manual verification |

### Sampling Rate
- **Per task commit:** `npm run build` in submodule compiles without error
- **Per wave merge:** Docker rebuild + `ukb full debug` mock pipeline runs to completion
- **Phase gate:** `ukb full` with real LLM, then verify all 4 QUAL requirements manually

### Wave 0 Gaps
- None -- existing build and pipeline infrastructure covers all testing needs. No new test framework required for this phase since validation is done through pipeline execution and output inspection.

## Sources

### Primary (HIGH confidence)
- insight-generation-agent.ts (6082 lines) -- read lines 100-505, 1580-1930, 2960-3100: InsightGenerationAgent constructor, generateTechnicalDocumentation, generateDeepInsight, generateAllDiagrams, generateInsightContent, toKebabCase
- wave-controller.ts (724 lines) -- read in full: WaveController.execute(), persistWaveResult(), mapEntityToSharedMemory(), runWithConcurrency()
- wave1-project-agent.ts (640 lines) -- read lines 1-270: Wave1ProjectAgent constructor, analyzeComponent() LLM prompt, parseComponentAnalysis()
- wave2-component-agent.ts (358 lines) -- read lines 1-285: Wave2ComponentAgent constructor, analyzeL2Components() LLM prompt, parseL2Response()
- wave3-detail-agent.ts (334 lines) -- read lines 1-265: Wave3DetailAgent constructor, discoverL3Details() LLM prompt, parseL3Response()
- persistence-agent.ts -- read lines 1-130, 1051-1115, 3160-3340: SharedMemoryEntity interface, EntityMetadata interface, storeEntityToGraph, persistEntities, linkInsightDocuments
- kg-operators.ts line 31-56: KGEntity and KGRelation interfaces
- wave-types.ts (complete): All wave type contracts
- knowledge-management/insights/ -- existing insight documents and directory structure

### Secondary (MEDIUM confidence)
- coordinator.ts lines 1555-1634, 3855-3965: How InsightGenerationAgent is instantiated and used in batch pipeline context

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all components are existing internal code, read directly from source
- Architecture: HIGH -- integration points identified precisely (WaveController.execute line 142 insertion point, InsightGenerationAgent private method access)
- Pitfalls: HIGH -- based on direct code inspection of interface mismatches, constructor side effects, and method signature requirements
- Cross-references: MEDIUM -- the exact implementation of enhanced Related Entities section requires some design work (extending generateTechnicalDocumentation params)

**Research date:** 2026-03-04
**Valid until:** 2026-04-04 (stable internal codebase, no external dependency changes expected)
