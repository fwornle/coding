# Phase 5: Wave Orchestration - Research

**Researched:** 2026-03-04
**Domain:** TypeScript multi-agent orchestration, hierarchical wave execution, Node.js async concurrency
**Confidence:** HIGH -- all findings verified directly against local codebase (ground truth)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Wave input model**
- Wave agents analyze the current codebase at HEAD -- not commit history
- Wave 1 reads actual source files with a tiered approach: directory structure scan for overall shape, then 3-5 representative file deep-reads per L1 component for richer summaries
- Wave 1 also reads existing knowledge graph entities (~30 entities) as additional context
- Wave 2 agents each read files belonging to their assigned L1 component, scoped via code-graph-rag queries against the Memgraph index
- Wave 3 agents read files relevant to their assigned L2 sub-component, also scoped via code-graph-rag queries
- No git history processing in waves -- pure structural analysis of what exists now

**Wave structure source**
- Manifest-driven at L0/L1: Wave 1 reads the component manifest (8 L1 components) and creates L0 Project + L1 Component entities
- Manifest seeds + code extends at L2: Wave 2 starts from manifest-defined L2 sub-components but agents can discover additional sub-nodes from code-graph-rag analysis
- Pure discovery at L3: Wave 3 is entirely LLM-driven -- agents analyze code within their L2 scope and identify Detail-level entities
- Discovered entities flagged: Entities discovered beyond the manifest are created with a 'discovered' flag/tag

**Batch-to-wave transition**
- Waves replace the batch-analysis workflow -- a new `wave-analysis` workflow is created
- `ukb full` switches to invoke `wave-analysis` immediately (day one) instead of `batch-analysis`
- `batch-analysis` remains available via explicit workflow name for backward compatibility
- Reuse existing agent implementations -- agents are good, orchestration changes
- New WaveController class -- dedicated TypeScript class separate from the existing coordinator. Manages wave sequencing, agent spawning per level, and parent-child context passing
- Replace in workflow-runner: WaveController gets its own code path in workflow-runner.ts for wave-analysis; coordinator keeps batch-analysis path
- Fresh agents per wave -- create new agent instances for each wave, no cross-wave state contamination

**Agent output per wave**
- Each wave agent produces: entity node + observations + parent-child relationships (both parentId AND explicit relationship edges in the graph)
- Observation count: Claude's discretion based on entity complexity
- Agents also identify what children should exist for the next wave
- Child identification output: separate structured manifest (JSON/YAML) of suggested children per agent
- Insight documents are NOT produced in Phase 5 -- that is Phase 6 (Entity Quality)

**Persistence model**
- Incremental merge -- wave output is merged with existing entities, not clean slate
- Wave 2 agents can query persisted L1 entities for context
- Crash-resilient: persisted entities from completed waves survive if a later wave fails
- Fail fast on agent failure -- if any agent crashes, abort remaining waves

**Progress visibility**
- Full observability: console log banners + workflow-progress.json updates + SSE events
- Per-agent + per-entity granularity: each entity creation is reported
- Wall clock timing: duration tracked per wave and per agent
- Structured summary report on completion: entities per level, manifest vs discovered counts, total time, any failures
- Wave banners: clear log markers when each wave starts/ends (e.g., "=== WAVE 2: L2 SubComponents ===")

### Claude's Discretion
- YAML wave structure design (explicit wave phases vs. single-step-per-wave)
- Optimal agent concurrency within each wave (bounded by LLM rate limits)
- Which finalization steps (CGR re-index, dedup, validation) to include in the wave workflow vs. defer to Phase 6-7
- WaveController internal architecture and error handling
- Observation count per entity (scale to complexity)
- Merge strategy details for incremental persistence (conflict resolution when existing entity differs from wave output)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| WAVE-01 | Pipeline executes analysis in hierarchical waves (L0->L1->L2->L3) instead of a flat batch pass | WaveController class with sequential wave execution loop; new `wave-analysis` YAML workflow replaces batch-analysis for `ukb full` |
| WAVE-02 | Wave 1 agent surveys the entire project and produces L0 Project node + L1 Component nodes with comprehensive summaries | loadComponentManifest() already exists; Wave1Agent wraps SemanticAnalysisAgent + ObservationGenerationAgent; reads source files + existing KG entities |
| WAVE-03 | Wave 2 agents receive L1 results and produce L2 SubComponent nodes with detailed observations per component | Parent context passed as parameter; code-graph-rag NL queries scope file sets per L1 component; one agent per L1 node in parallel |
| WAVE-04 | Wave 3 agents receive L2 results and produce L3 Detail nodes with specific, deep knowledge | Same parallel agent pattern; scoped via code-graph-rag to L2 domain; pure LLM discovery (no manifest seeds) |
| WAVE-05 | Wave controller ensures wave N completes fully before wave N+1 spawns | Sequential `await Promise.all(wave)` pattern; WaveController awaits all agents in current wave before advancing |
| WAVE-06 | Within each wave, agents run in parallel (one agent per parent node being expanded) | `Promise.all()` over agent array for each wave; same pattern as coordinator's DAG parallel execution |
</phase_requirements>

---

## Summary

Phase 5 adds a new `WaveController` TypeScript class and a `wave-analysis` YAML workflow to the existing `integrations/mcp-server-semantic-analysis` submodule. The wave controller is a standalone class (not extending CoordinatorAgent) that manages three sequential waves: Wave 1 creates L0/L1 nodes by reading the component manifest and analyzing representative source files, Wave 2 creates L2 nodes in parallel (one agent per L1 component), and Wave 3 creates L3 Detail nodes in parallel (one agent per L2 node). All existing agent classes (SemanticAnalysisAgent, ObservationGenerationAgent, PersistenceAgent, GraphDatabaseAdapter) are reused without modification. The new entry point in `workflow-runner.ts` detects `wave-analysis` as the workflow name and routes to `WaveController.execute()` instead of `CoordinatorAgent.executeBatchWorkflow()`.

The codebase already has all necessary building blocks in place. `KGEntity` already carries `parentId`, `level`, and `hierarchyPath` fields (shipped in Phase 4). `loadComponentManifest()` and `flattenManifestEntries()` already parse the YAML that defines the 8 L1 and 5 L2 components. `GraphDatabaseAdapter` already handles entity persistence via VKB HTTP API or direct LevelDB. The `writeProgressFile` pattern and SSE progress event shape are established and can be adopted directly.

The primary implementation work is: (1) writing the `WaveController` class with wave sequencing logic and parallel agent spawning, (2) writing three wave-specific agent wrappers (Wave1ProjectAgent, Wave2ComponentAgent, Wave3DetailAgent) that compose existing agents into the right input/output shape, (3) adding the `wave-analysis` YAML workflow definition, (4) updating `workflow-runner.ts` to route `wave-analysis` to `WaveController`, and (5) updating `tools.ts` to add `wave-analysis` to the long-running workflow list.

**Primary recommendation:** Build WaveController as a pure TypeScript class with a simple `async execute()` method that runs three sequential `Promise.all()` waves. Do not attempt to shoehorn this into the existing YAML-driven coordinator DAG -- the coordinator's step graph model is a poor fit for the hierarchical spawning pattern.

---

## Standard Stack

### Core (all already installed in the submodule)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | 5.x | Type-safe implementation | Project mandatory (CLAUDE.md) |
| `yaml` package | already in deps | Parse component-manifest.yaml | Already used by workflow-loader.ts |
| `fs` (Node.js built-in) | - | File read for source code scanning | Already used everywhere |
| `path` (Node.js built-in) | - | Path resolution | Already used everywhere |
| `LLMService` | local lib | LLM API calls for wave agents | Already used by SemanticAnalysisAgent |

### Reusable Agents (no new dependencies)

| Class | Location | Purpose | Reuse Strategy |
|-------|----------|---------|----------------|
| `SemanticAnalysisAgent` | `agents/semantic-analysis-agent.ts` | Core LLM code analysis | Instantiate fresh per wave |
| `ObservationGenerationAgent` | `agents/observation-generation-agent.ts` | Structured observation creation | Instantiate fresh per wave |
| `PersistenceAgent` | `agents/persistence-agent.ts` | Entity persistence to LevelDB via VKB API | Shared instance, call `persistEntities()` after each wave completes |
| `GraphDatabaseAdapter` | `storage/graph-database-adapter.ts` | Graph reads/writes | Shared instance, needed to read L1 entities in Wave 2 |
| `HierarchyClassifierAgent` | `agents/hierarchy-classifier.ts` | Manifest keyword matching | Useful for file scoping by component name |
| `loadComponentManifest()` | `types/component-manifest.ts` | Load 8 L1 + 5 L2 from YAML | Call once at WaveController init |
| `flattenManifestEntries()` | `types/component-manifest.ts` | Iterate all L1/L2 entries | Use to seed Wave 2 / Wave 3 agent list |
| `CodeGraphAgent` | `agents/code-graph-agent.ts` | CGR NL queries for file scoping | Call `intelligentQuery()` per component to get relevant files |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Separate WaveController class | Extending CoordinatorAgent | CoordinatorAgent is tightly coupled to the YAML DAG model and batch iteration loop -- extracting reusable wave logic would require heavy refactoring with high regression risk |
| TypeScript Promise.all() | Worker threads / child processes | LLM rate limiting is the bottleneck, not CPU. Node.js async is sufficient and simpler |
| Separate wave-agent files | Inline functions in WaveController | Separate files are testable and follow the existing agent pattern |

**Installation:** No new packages needed. All dependencies are present.

---

## Architecture Patterns

### Recommended Project Structure

New files to create:

```
integrations/mcp-server-semantic-analysis/src/agents/wave-controller.ts
integrations/mcp-server-semantic-analysis/src/agents/wave1-project-agent.ts
integrations/mcp-server-semantic-analysis/src/agents/wave2-component-agent.ts
integrations/mcp-server-semantic-analysis/src/agents/wave3-detail-agent.ts
integrations/mcp-server-semantic-analysis/src/types/wave-types.ts
integrations/mcp-server-semantic-analysis/config/workflows/wave-analysis.yaml
```

Files to modify:

```
integrations/mcp-server-semantic-analysis/src/workflow-runner.ts  (add WaveController routing)
integrations/mcp-server-semantic-analysis/src/tools.ts            (add wave-analysis to longRunningWorkflows)
```

### Pattern 1: WaveController Sequential Execution

**What:** A class with an `execute()` method that runs waves sequentially. Each wave is a `Promise.all()` over agent instances.

**When to use:** This is the only execution model for Phase 5.

**Example:**

```typescript
// integrations/mcp-server-semantic-analysis/src/agents/wave-controller.ts
import * as fs from 'fs';
import * as path from 'path';
import { log } from '../logging.js';
import { loadComponentManifest, flattenManifestEntries } from '../types/component-manifest.js';
import { GraphDatabaseAdapter } from '../storage/graph-database-adapter.js';
import { PersistenceAgent } from './persistence-agent.js';
import { Wave1ProjectAgent } from './wave1-project-agent.js';
import { Wave2ComponentAgent } from './wave2-component-agent.js';
import { Wave3DetailAgent } from './wave3-detail-agent.js';
import type { WaveResult, ChildManifestEntry } from '../types/wave-types.js';

export interface WaveControllerConfig {
  repositoryPath: string;
  team: string;
  progressFile: string;
}

export class WaveController {
  private repositoryPath: string;
  private team: string;
  private progressFile: string;
  private graphDB: GraphDatabaseAdapter;
  private persistenceAgent: PersistenceAgent;

  constructor(config: WaveControllerConfig) {
    this.repositoryPath = config.repositoryPath;
    this.team = config.team;
    this.progressFile = config.progressFile;
    this.graphDB = new GraphDatabaseAdapter();
    this.persistenceAgent = new PersistenceAgent(config.repositoryPath, config.team);
  }

  async execute(): Promise<WaveExecutionResult> {
    const startTime = Date.now();
    await this.graphDB.initialize();

    const manifest = loadComponentManifest();
    const l1Components = manifest.components;            // 8 items
    const l2Components = flattenManifestEntries(manifest)
      .filter(e => e.level === 2);                      // 5 items

    this.logWaveBanner('WAVE 1', 'L0/L1 Project + Components');
    this.updateProgress({ currentWave: 1, totalWaves: 3 });

    // Wave 1: single agent surveys entire project, produces L0 + all L1
    const wave1Agent = new Wave1ProjectAgent(this.repositoryPath, this.team);
    const wave1Result = await wave1Agent.execute({
      manifest,
      existingEntities: await this.loadExistingEntities()
    });
    await this.persistWaveResult(wave1Result, 1);

    this.logWaveBanner('WAVE 2', 'L2 SubComponents');
    this.updateProgress({ currentWave: 2, totalWaves: 3 });

    // Wave 2: one agent per L1 component, run in parallel
    const wave2Inputs = this.buildWave2Inputs(l1Components, wave1Result);
    const wave2Results = await this.runWithConcurrency(
      wave2Inputs.map(input => () => new Wave2ComponentAgent(this.repositoryPath, this.team).execute(input)),
      4  // max concurrent agents -- rate limit budget
    );
    for (const result of wave2Results) {
      await this.persistWaveResult(result, 2);
    }

    this.logWaveBanner('WAVE 3', 'L3 Detail nodes');
    this.updateProgress({ currentWave: 3, totalWaves: 3 });

    // Wave 3: one agent per L2 sub-component (manifest + discovered), run in parallel
    const allL2Nodes = this.collectL2Nodes(wave2Results, l2Components);
    const wave3Results = await this.runWithConcurrency(
      allL2Nodes.map(l2Node => () => new Wave3DetailAgent(this.repositoryPath, this.team).execute({ l2Node })),
      4
    );
    for (const result of wave3Results) {
      await this.persistWaveResult(result, 3);
    }

    return this.buildSummaryReport(startTime, wave1Result, wave2Results, wave3Results);
  }

  private logWaveBanner(wave: string, description: string): void {
    const line = '='.repeat(60);
    log(line, 'info');
    log(`=== ${wave}: ${description} ===`, 'info');
    log(line, 'info');
  }

  // Concurrency limiter -- avoids hammering LLM rate limits
  private async runWithConcurrency<T>(
    tasks: Array<() => Promise<T>>,
    maxConcurrent: number
  ): Promise<T[]> {
    const results: T[] = [];
    let i = 0;
    const running: Promise<void>[] = [];

    const runNext = async (): Promise<void> => {
      if (i >= tasks.length) return;
      const task = tasks[i++];
      const result = await task();
      results.push(result);
      await runNext();
    };

    const initial = Math.min(maxConcurrent, tasks.length);
    for (let j = 0; j < initial; j++) {
      running.push(runNext());
    }
    await Promise.all(running);
    return results;
  }
}
```

### Pattern 2: Wave Agent Wrapper Shape

**What:** Each wave agent wraps existing agents (SemanticAnalysisAgent + ObservationGenerationAgent) and returns `WaveAgentOutput` with entities + child manifest.

**When to use:** All three wave agent classes follow this shape.

**Example:**

```typescript
// integrations/mcp-server-semantic-analysis/src/agents/wave2-component-agent.ts
import { SemanticAnalysisAgent } from './semantic-analysis-agent.js';
import { ObservationGenerationAgent } from './observation-generation-agent.js';
import type { KGEntity } from './kg-operators.js';
import type { WaveAgentOutput } from '../types/wave-types.js';

export interface Wave2Input {
  l1Entity: KGEntity;           // Parent L1 node context
  componentFiles: string[];      // Files scoped to this component via code-graph-rag
  componentKeywords: string[];   // From manifest entry for this component
}

export class Wave2ComponentAgent {
  private semanticAgent: SemanticAnalysisAgent;
  private observationAgent: ObservationGenerationAgent;

  constructor(private repositoryPath: string, private team: string) {
    // Fresh instances per agent -- no cross-wave state contamination
    this.semanticAgent = new SemanticAnalysisAgent(repositoryPath);
    this.observationAgent = new ObservationGenerationAgent(repositoryPath, team);
  }

  async execute(input: Wave2Input): Promise<WaveAgentOutput> {
    const startTime = Date.now();
    log(`[Wave2Agent] Starting analysis for ${input.l1Entity.name}`, 'info');

    const fileContents = await this.readRepresentativeFiles(input.componentFiles, 5);

    const semanticResult = await this.semanticAgent.analyzeSemantics({
      parentContext: {
        name: input.l1Entity.name,
        description: input.l1Entity.observations.join('\n')
      },
      sourceFiles: fileContents
    });

    const observations = await this.observationAgent.generateStructuredObservations({
      semantic_analysis: semanticResult,
      scopeContext: { level: 2, parentName: input.l1Entity.name }
    });

    // LLM identifies child nodes for Wave 3
    const discoveredChildren = await this.identifyChildNodes(semanticResult, input.l1Entity);

    const duration = Date.now() - startTime;
    log(`[Wave2Agent] ${input.l1Entity.name}: ${observations.observations.length} obs, ${discoveredChildren.length} children (${duration}ms)`, 'info');

    return {
      entities: this.buildL2Entities(observations, input.l1Entity),
      relationships: this.buildParentChildEdges(observations, input.l1Entity),
      childManifest: discoveredChildren,   // Feeds Wave 3 agent list
      discovered: false,                   // Manifest-seeded, not discovered
      durationMs: duration,
      parentId: input.l1Entity.name
    };
  }
}
```

### Pattern 3: WaveAgentOutput and Child Manifest Types

**What:** The shared type contract between waves. Wave N agents emit `childManifest` which Wave N+1 controller reads to spawn agents.

**When to use:** Define in `types/wave-types.ts` and import across all wave files.

**Example:**

```typescript
// integrations/mcp-server-semantic-analysis/src/types/wave-types.ts
import type { KGEntity, KGRelation } from '../agents/kg-operators.js';

export interface ChildManifestEntry {
  name: string;
  level: number;           // 2 for L2, 3 for L3
  parentId: string;        // Parent entity name
  description: string;     // LLM-generated description
  discovered: boolean;     // true if not in manifest, discovered via code analysis
  suggestedFiles?: string[]; // Files relevant to this child node
}

export interface WaveAgentOutput {
  entities: KGEntity[];
  relationships: KGRelation[];
  childManifest: ChildManifestEntry[];  // What the next wave should spawn
  discovered: boolean;                  // Was this agent itself spawned from discovery?
  durationMs: number;
  parentId: string;                     // The parent entity this agent expanded
}

export interface WaveResult {
  wave: number;             // 1, 2, or 3
  agentOutputs: WaveAgentOutput[];
  totalEntities: number;
  manifestEntities: number;
  discoveredEntities: number;
  durationMs: number;
  success: boolean;
  error?: string;
}

export interface WaveExecutionResult {
  success: boolean;
  waves: WaveResult[];
  totalEntities: number;
  totalDurationMs: number;
  entitiesByLevel: Record<number, number>;  // {0: 1, 1: 8, 2: 12, 3: 45}
  manifestEntities: number;
  discoveredEntities: number;
  error?: string;
}
```

### Pattern 4: YAML Workflow Definition for wave-analysis

**What:** A minimal YAML workflow (no batch loop, no operators) that registers the workflow name. The `type: wave` signals workflow-runner to use WaveController.

**When to use:** `config/workflows/wave-analysis.yaml`

**Example:**

```yaml
# config/workflows/wave-analysis.yaml
workflow:
  name: wave-analysis
  version: "1.0"
  description: "Hierarchical wave analysis: Wave1 (L0/L1) -> Wave2 (L2) -> Wave3 (L3)"
  type: wave   # New type -- signals workflow-runner to use WaveController

config:
  max_agents_per_wave: 4   # Max concurrent agents within a wave (LLM rate limit budget)
  persist_after_each_wave: true
  fail_fast: true          # Abort remaining waves if any agent fails

parameters:
  repositoryPath:
    required: true
  team:
    required: true

# No steps block -- WaveController drives execution programmatically.
# The YAML exists only to register the workflow name and carry config.
```

### Pattern 5: workflow-runner.ts Route for wave-analysis

**What:** workflow-runner.ts detects `wave-analysis` and instantiates WaveController instead of CoordinatorAgent.

**When to use:** In the `main()` function of `workflow-runner.ts` before the coordinator instantiation block.

**Example:**

```typescript
// In workflow-runner.ts main() -- add before coordinator instantiation
if (workflowName === 'wave-analysis') {
  const { WaveController } = await import('./agents/wave-controller.js');
  const waveController = new WaveController({
    repositoryPath,
    team: parameters?.team || 'coding',
    progressFile
  });

  let execution;
  try {
    const result = await waveController.execute();
    writeProgressPreservingDetails(progressFile, {
      workflowId,
      workflowName: 'wave-analysis',
      team: parameters?.team || 'unknown',
      repositoryPath,
      status: result.success ? 'completed' : 'failed',
      message: `Wave analysis ${result.success ? 'completed' : 'failed'}: ${result.totalEntities} entities`,
      startTime: startTime.toISOString(),
      lastUpdate: new Date().toISOString(),
      elapsedSeconds: Math.round((Date.now() - startTime.getTime()) / 1000),
      pid: process.pid
    });
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    writeProgressPreservingDetails(progressFile, {
      workflowId,
      workflowName: 'wave-analysis',
      team: parameters?.team || 'unknown',
      repositoryPath,
      status: 'failed',
      error: errorMessage,
      message: `Wave analysis failed: ${errorMessage}`,
      startTime: startTime.toISOString(),
      lastUpdate: new Date().toISOString(),
      elapsedSeconds: Math.round((Date.now() - startTime.getTime()) / 1000),
      pid: process.pid
    });
    process.exit(1);
  }
}

// Existing coordinator path continues below unchanged
const coordinator = new CoordinatorAgent(repositoryPath);
```

### Anti-Patterns to Avoid

- **Extending CoordinatorAgent for WaveController:** The coordinator is tightly coupled to the YAML DAG model and batch iteration loop. Inheritance would inherit all that complexity. Use composition instead.
- **Sharing agent instances across waves:** SemanticAnalysisAgent and ObservationGenerationAgent hold state (LLM session context, template caches). Create fresh instances per wave per agent to avoid contamination between waves.
- **Persisting inside each wave agent:** The persistence agent call should happen in WaveController after all agents in a wave complete. Crash-resilience requires that a wave either fully commits or does not -- not entity-by-entity.
- **Using YAML steps to model wave logic:** The coordinator's step dependency resolution was designed for a flat DAG, not for "fan out one-agent-per-node, then fan back in." The `Promise.all()` pattern is simpler and correct.
- **Piping Wave 3 child IDs from Wave 2 as YAML parameters:** This would require runtime YAML template evaluation to handle dynamic lists. Let WaveController pass results directly as TypeScript objects instead.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Component manifest loading | Custom YAML parser | `loadComponentManifest()` from `types/component-manifest.ts` | Already parses, validates, typed -- 0 lines to write |
| File path resolution from manifest | Custom directory scanner | `CodeGraphAgent.intelligentQuery()` for CGR-based scoping | CGR has AST-aware file lists per component; regex scanning would miss transitive dependencies |
| Entity persistence | Direct LevelDB writes | `PersistenceAgent.persistEntities()` | Handles conflict resolution, VKB API fallback, JSON export sync, metadata stamping |
| Graph relationship edges | Custom edge insertion | `GraphDatabaseAdapter` (relationship edge support already exists per CONTEXT.md) | Handles both Graphology in-memory and LevelDB sync atomically |
| Progress file writes | Custom JSON writer | `writeProgressPreservingDetails()` from workflow-runner.ts | Already handles debug state preservation, single-step mode, mock LLM mode -- critical for dashboard compatibility |
| LLM calls | Hardcoded Anthropic client | `LLMService` (imported by SemanticAnalysisAgent) | Already handles tier routing, retry, mock mode, provider fallback |
| Agent output typing | Inline any types | `KGEntity`, `KGRelation` from `agents/kg-operators.ts` | Phase 4 already extended these with hierarchy fields (parentId, level, hierarchyPath) |

**Key insight:** Every persistence, LLM, and graph operation already has a production-quality implementation. The wave controller's job is orchestration only -- routing data between agents, managing timing, and reporting progress.

---

## Common Pitfalls

### Pitfall 1: KGEntity vs SharedMemoryEntity Field Name Mismatch

**What goes wrong:** `KGEntity` uses `level` and `parentId`; `SharedMemoryEntity` (what PersistenceAgent stores) uses `hierarchyLevel` and `parentEntityName`. If WaveController builds `KGEntity` objects and passes them directly to PersistenceAgent without mapping, the hierarchy fields are silently dropped.

**Why it happens:** PersistenceAgent was written before the hierarchy schema stabilized. The field names diverged.

**How to avoid:** Always use a mapping function to transform `KGEntity` -> `SharedMemoryEntity` before calling `persistEntities()`. The coordinator has this logic (around line 3100 of coordinator.ts). Extract it into a shared utility or replicate in WaveController.

```typescript
// Field mapping required when converting KGEntity to SharedMemoryEntity
function mapEntityToSharedMemory(e: KGEntity): SharedMemoryEntity {
  return {
    id: e.id,
    name: e.name,
    entityType: e.type,           // NOT e.entityType -- use e.type
    significance: e.significance,
    observations: e.observations,
    relationships: [],
    metadata: { created_at: new Date().toISOString(), last_updated: new Date().toISOString() },
    hierarchyLevel: e.level,          // NOT e.hierarchyLevel
    parentEntityName: e.parentId,     // NOT e.parentEntityName directly
    isScaffoldNode: (e.level ?? 3) < 3  // L0, L1, L2 are scaffold nodes
  };
}
```

**Warning signs:** Entities appear in VKB with `hierarchyLevel: undefined` or `parentEntityName: undefined` after waves complete.

### Pitfall 2: Dedup Collapse of parentId

**What goes wrong:** `mergeEntities()` in `DeduplicationAgent` was identified (per STATE.md accumulated context) as overwriting `parentId` with `undefined` during merge. If dedup runs on wave output, hierarchy links are destroyed.

**Why it happens:** The dedup merge logic uses object spread without null-coalescing for hierarchy fields.

**How to avoid:** Do NOT pass wave-produced entities through the full deduplication pipeline. Merge strategy should be: if an entity with the same name already exists, append observations but never overwrite `parentId`, `level`, or `hierarchyPath`. Implement a targeted merge in WaveController's `persistWaveResult()` method.

```typescript
// Safe incremental merge preserving hierarchy fields
const merged: SharedMemoryEntity = {
  ...existing,
  ...newEntity,
  observations: [...(existing.observations || []), ...(newEntity.observations || [])],
  hierarchyLevel: newEntity.hierarchyLevel ?? existing.hierarchyLevel,
  parentEntityName: newEntity.parentEntityName ?? existing.parentEntityName,
  childEntityNames: [...new Set([...(existing.childEntityNames || []), ...(newEntity.childEntityNames || [])])],
};
```

**Warning signs:** Wave 2/3 entities lose their parent linkage after persistence -- visible as orphaned nodes in VKB tree view.

### Pitfall 3: Docker Build Forgetting

**What goes wrong:** TypeScript source is edited in the submodule, but `dist/` is not rebuilt. Docker container runs stale code. The wave-analysis workflow does nothing because workflow-runner.ts still routes everything to coordinator.

**Why it happens:** Recurring issue documented in CLAUDE.md and STATE.md -- `dist/` is compiled TypeScript, Docker copies `dist/`.

**How to avoid:** After every source file change in `integrations/mcp-server-semantic-analysis/`:

```bash
cd /Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis && npm run build
cd /Users/Q284340/Agentic/coding/docker && docker-compose build coding-services && docker-compose up -d coding-services
```

**Warning signs:** Logs show old workflow behavior after code changes. Check docker logs for compilation timestamp.

### Pitfall 4: LLM Rate Limit Hammering During Parallel Wave Agents

**What goes wrong:** Wave 2 spawns 8 agents simultaneously (one per L1 component), each immediately making LLM API calls. If all 8 start at the same time, the Anthropic API rate limiter returns 429 errors.

**Why it happens:** `Promise.all()` starts all promises simultaneously with no backpressure.

**How to avoid:** Use the `runWithConcurrency()` helper built into WaveController (see Pattern 1). Default `max_agents_per_wave: 4`. The Wave 1 code example in Pattern 1 shows this pattern. Do not use raw `Promise.all(wave2Agents)`.

**Warning signs:** Agent logs show repeated 429 errors followed by retry delays. Total wave time is longer than expected because all agents are waiting for rate limit windows simultaneously.

### Pitfall 5: Wave 2 CGR Query -- Memgraph Must Be Indexed First

**What goes wrong:** Wave 2 agents call `CodeGraphAgent.intelligentQuery()` to scope files per L1 component. If Memgraph is not indexed (e.g., fresh Docker start), the query returns empty results and agents analyze no files.

**Why it happens:** CGR indexing is a separate step (`index_codebase`) in the batch workflow. The wave workflow has no equivalent pre-flight step for CGR.

**How to avoid:** Add a WaveController pre-flight check before Wave 2: call `CodeGraphAgent.indexRepository()` if Memgraph node count is below threshold (the batch workflow uses `minNodeThreshold: 1000`).

**Warning signs:** Wave 2/3 agents report 0 files analyzed. CGR query logs show empty result sets.

### Pitfall 6: entityType vs type Field Disconnect (Bug Fixed in Batch, Must Not Re-Introduce)

**What goes wrong:** Per MEMORY.md, this bug was fixed in the coordinator around line 3098. Wave agent code that only sets `entity.type` without also setting `entity.entityType` triggers 200+ seconds of redundant LLM re-classification in the persistence layer.

**Why it happens:** `KGEntity` interface has `type` but NOT `entityType`. `SharedMemoryEntity` uses `entityType`. The persistence layer's `hasValidPreClassification()` checks `entityType`.

**How to avoid:** In the `mapEntityToSharedMemory()` function, ensure the `entityType` field is set:

```typescript
entityType: e.type,  // BOTH type and entityType must be set
```

And attach ontology metadata so pre-classification check passes:

```typescript
metadata: {
  ...existingMetadata,
  ontologyClass: 'Component',         // or appropriate class
  hasValidPreClassification: true     // prevents re-classification LLM call
}
```

### Pitfall 7: tools.ts `longRunningWorkflows` List Not Updated

**What goes wrong:** `wave-analysis` is not in the `longRunningWorkflows` array in `tools.ts`. The `handleExecuteWorkflow()` function then runs it synchronously (no `async_mode`), hitting MCP connection timeout after 2 minutes.

**Why it happens:** `longRunningWorkflows = ['complete-analysis', 'incremental-analysis', 'batch-analysis']` is hardcoded on line 987 of tools.ts.

**How to avoid:** Add `'wave-analysis'` to this array in the same commit that creates the YAML workflow.

```typescript
// tools.ts line 987 -- update this line
const longRunningWorkflows = ['complete-analysis', 'incremental-analysis', 'batch-analysis', 'wave-analysis'];
```

---

## Code Examples

Verified patterns from the existing codebase:

### Loading the Component Manifest

```typescript
// Source: src/types/component-manifest.ts (verified locally)
import { loadComponentManifest, flattenManifestEntries } from '../types/component-manifest.js';

const manifest = loadComponentManifest();           // Reads config/component-manifest.yaml
const l1Components = manifest.components;           // 8 L1 entries
const allEntries = flattenManifestEntries(manifest);// Flat array of L1 + L2 entries
const l2Only = allEntries.filter(e => e.level === 2); // 5 L2 entries
// L0 project: manifest.project.name = "Coding", manifest.project.level = 0
```

### KGEntity Hierarchy Fields (Phase 4, already in production)

```typescript
// Source: src/agents/kg-operators.ts lines 31-47 (verified locally)
export interface KGEntity {
  id: string;
  name: string;
  type: string;
  observations: string[];
  significance: number;
  // Hierarchy fields shipped in Phase 4:
  parentId?: string;       // Entity name of parent node
  level?: number;          // 0=Project, 1=Component, 2=SubComponent, 3=Detail
  hierarchyPath?: string;  // "Coding/KnowledgeManagement/OnlineLearning"
}
```

### SharedMemoryEntity Hierarchy Fields (PersistenceAgent storage schema)

```typescript
// Source: src/agents/persistence-agent.ts lines 40-59 (verified locally)
export interface SharedMemoryEntity {
  id: string;
  name: string;
  entityType: string;           // Note: NOT 'type'! Must sync with KGEntity.type
  // ... other fields ...
  hierarchyLevel?: number;          // Note: NOT 'level'!
  parentEntityName?: string;        // Note: NOT 'parentId'!
  childEntityNames?: string[];
  isScaffoldNode?: boolean;
}
```

### Wave Banner Log Pattern (follows coordinator style)

```typescript
// Source: coordinator.ts logging style convention (verified locally)
const line = '='.repeat(60);
log(line, 'info');
log(`=== WAVE 1: L0/L1 Project + Components ===`, 'info');
log(line, 'info');
// ... agent execution ...
log(`=== WAVE 1 COMPLETE: 1 L0 + 8 L1 entities created (${durationMs}ms) ===`, 'info');
log(line, 'info');
```

### writeProgressPreservingDetails Usage for Wave Progress

```typescript
// Source: src/workflow-runner.ts lines 268-318 (verified locally)
// Use this function (not writeProgress()) to avoid clobbering debug state
writeProgressPreservingDetails(progressFile, {
  workflowId,
  workflowName: 'wave-analysis',
  team: parameters?.team || 'unknown',
  repositoryPath,
  status: 'running',
  message: `Wave 2 in progress: 3/8 L1 components analyzed`,
  startTime: startTime.toISOString(),
  lastUpdate: new Date().toISOString(),
  elapsedSeconds: Math.round((Date.now() - startTime.getTime()) / 1000),
  pid: process.pid
});
```

### tools.ts longRunningWorkflows Update (Required)

```typescript
// Source: src/tools.ts line 987 (verified locally)
// BEFORE (current):
const longRunningWorkflows = ['complete-analysis', 'incremental-analysis', 'batch-analysis'];

// AFTER (required):
const longRunningWorkflows = ['complete-analysis', 'incremental-analysis', 'batch-analysis', 'wave-analysis'];
```

### Workflow Type Detection in workflow-runner.ts

```typescript
// Source: src/agents/coordinator.ts line 499 (verified pattern)
// Current check:
const isBatchWorkflow = workflow?.type === 'iterative' || resolvedWorkflowName === 'batch-analysis';

// New check to add in workflow-runner.ts:
const isWaveWorkflow = workflowName === 'wave-analysis';
// Route to WaveController before coordinator instantiation
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Flat batch pass (git history to all entities) | Wave-based hierarchical production (structure first, then detail) | Phase 5 (this phase) | Entities produced at each level are self-sufficient at that granularity |
| Single CoordinatorAgent for all workflows | CoordinatorAgent for batch, WaveController for wave | Phase 5 (this phase) | Clean separation avoids contaminating stable batch workflow |
| Entity hierarchy assigned post-hoc by keyword matching | Hierarchy is produced structurally by wave agents (parent before child) | Phase 5 (this phase) | Parent-child relationships are explicit from creation, not inferred |
| Flat entity list in knowledge graph | Tree structure in LevelDB (parentId + relationship edges) | Phase 4 (already shipped) | Phase 5 can rely on hierarchy schema being in production |

**Already shipped in Phase 4 (do not re-implement):**
- `KGEntity.parentId`, `KGEntity.level`, `KGEntity.hierarchyPath`
- `SharedMemoryEntity.hierarchyLevel`, `parentEntityName`, `childEntityNames`, `isScaffoldNode`
- Component manifest YAML (`config/component-manifest.yaml`) and TypeScript types
- Graph relationship edge support in GraphDatabaseAdapter
- HierarchyClassifierAgent (keyword-based entity-to-component assignment)
- `loadComponentManifest()` and `flattenManifestEntries()`

---

## Open Questions

1. **CGR Query API for file scoping**
   - What we know: `CodeGraphAgent.intelligentQuery()` exists and accepts NL queries; communicates with code-graph-rag via socket
   - What is unclear: Whether `intelligentQuery()` can filter by component name and return file paths specifically (vs. entity names), and whether the socket protocol supports batch queries efficiently for 8 simultaneous Wave 2 agents
   - Recommendation: During Wave 0 task (setup/pre-flight), test a sample NL query against live Memgraph to validate file-path output format before building Wave 2 agent inputs around it

2. **Wave 3 agent count scaling**
   - What we know: Wave 3 spawns one agent per L2 node. Currently 5 manifest-defined L2 nodes. Wave 2 agents may discover additional L2 nodes.
   - What is unclear: How many additional L2 nodes Wave 2 will typically discover (could be 0-20)
   - Recommendation: Design the concurrency limiter to handle up to 30 Wave 3 agents gracefully. Cap at `max_agents_per_wave` (default 4) regardless of L2 node count.

3. **VKB API availability during wave execution for entity reads**
   - What we know: `GraphDatabaseAdapter` uses VKB HTTP API when server is running, falls back to direct LevelDB. Wave 2 needs to read persisted L1 entities.
   - What is unclear: Whether VKB is always running during `ukb full` execution, and whether the VKB API supports the specific query needed (find entity by name + level)
   - Recommendation: Design Wave 2's L1-entity-read to work via direct LevelDB if VKB API returns a non-200 status. The GraphDatabaseAdapter fallback logic handles this.

---

## Validation Architecture

No dedicated test framework exists in the submodule (no jest.config.*, no vitest.config.*, no test directories beyond node_modules). The existing `test` script runs `node dist/test.js` -- a custom integration smoke test against a live Docker environment. Testing for Phase 5 follows this same integration approach.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Custom Node.js integration test (no unit test framework) |
| Config file | none -- `dist/test.js` is compiled from `src/test.ts` |
| Quick run command | `cd /Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis && npm run build` |
| Full suite command | `ukb full` invocation + KG entity inspection via VKB API or `vkb` command |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| WAVE-01 | wave-analysis workflow executes 3 sequential waves, visible in logs | Integration smoke | Check logs for "=== WAVE 1", "=== WAVE 2", "=== WAVE 3" banners | Wave 0 (file creation) |
| WAVE-02 | Wave 1 produces L0 + 8 L1 entities in KG | Integration | `curl http://localhost:8080/api/entities?level=1` returns 8 entities | Wave 0 (file creation) |
| WAVE-03 | Wave 2 agents receive L1 parent context, produce L2 entities with parentEntityName set | Integration | Check KG: L2 entities have `parentEntityName` set to L1 component names | Wave 0 (file creation) |
| WAVE-04 | Wave 3 agents produce L3 Detail nodes linked to L2 parents | Integration | Check KG: L3 entities have `hierarchyLevel=3` and valid `parentEntityName` | Wave 0 (file creation) |
| WAVE-05 | Wave N completes before Wave N+1 spawns | Integration (log timestamps) | Wave 2 start timestamp in logs is after Wave 1 complete timestamp | Wave 0 (file creation) |
| WAVE-06 | Agents run in parallel within each wave | Integration (timing) | Wave 2 total elapsed time is less than 8x a single agent's time | Wave 0 (file creation) |

### Sampling Rate

- **Per task commit:** `npm run build` in submodule (TypeScript compilation catches type errors)
- **Per wave merge:** Full `ukb full` invocation against dev Docker environment + KG inspection
- **Phase gate:** All 6 success criteria from CONTEXT.md verified before `/gsd:verify-work`

### Wave 0 Gaps

All new files and modifications required before implementation waves can begin:

- [ ] `src/agents/wave-controller.ts` -- WaveController class (main orchestration entry point)
- [ ] `src/agents/wave1-project-agent.ts` -- Wave 1 agent wrapper (L0 + L1 production)
- [ ] `src/agents/wave2-component-agent.ts` -- Wave 2 agent wrapper (L2 production per L1 parent)
- [ ] `src/agents/wave3-detail-agent.ts` -- Wave 3 agent wrapper (L3 production per L2 parent)
- [ ] `src/types/wave-types.ts` -- WaveResult, WaveAgentOutput, ChildManifestEntry interfaces
- [ ] `config/workflows/wave-analysis.yaml` -- workflow registration YAML with `type: wave`
- [ ] `src/tools.ts` update -- add `wave-analysis` to `longRunningWorkflows` array (line 987)
- [ ] `src/workflow-runner.ts` update -- add WaveController routing branch before coordinator instantiation

---

## Sources

### Primary (HIGH confidence -- verified against local codebase)

- `/Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis/src/agents/coordinator.ts` -- executeBatchWorkflow(), executeWorkflow(), writeProgressFile(), DAG parallel execution pattern
- `/Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis/src/workflow-runner.ts` -- workflow routing, ProgressUpdate shape, writeProgressPreservingDetails()
- `/Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis/src/agents/kg-operators.ts` -- KGEntity interface with hierarchy fields (lines 31-47)
- `/Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts` -- SharedMemoryEntity interface with hierarchy fields (lines 40-59)
- `/Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis/src/types/component-manifest.ts` -- loadComponentManifest(), flattenManifestEntries()
- `/Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis/config/component-manifest.yaml` -- 8 L1 + 5 L2 component definitions (full structure verified)
- `/Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis/config/workflows/batch-analysis.yaml` -- workflow YAML structure, phase model, step shape
- `/Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis/src/tools.ts` -- handleExecuteWorkflow(), longRunningWorkflows list (line 987)
- `/Users/Q284340/Agentic/coding/.planning/phases/05-wave-orchestration/05-CONTEXT.md` -- user decisions (full file)
- `/Users/Q284340/Agentic/coding/.planning/STATE.md` -- accumulated pitfalls (dedup parentId, entityType disconnect, Docker rebuild)

### Secondary (MEDIUM confidence)

- `/Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis/src/agents/hierarchy-classifier.ts` -- keyword matching pattern, classifyHierarchy()
- `/Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis/src/orchestrator/smart-orchestrator.ts` -- StepResultWithMetadata shape, WorkflowState pattern
- `/Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis/src/agents/code-graph-agent.ts` -- CodeGraphAgent interface and query patterns
- `/Users/Q284340/Agentic/coding/integrations/mcp-server-semantic-analysis/src/mock/llm-mock-service.ts` -- MockLLMConfig shape (for test mode compatibility)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries verified locally as present and in use
- Architecture: HIGH -- patterns derived directly from existing production code
- Pitfalls: HIGH -- three of seven pitfalls are documented in STATE.md and MEMORY.md as previously encountered bugs in this exact codebase
- Validation architecture: MEDIUM -- no unit test framework exists; integration testing approach is inferred from existing `test` script pattern

**Research date:** 2026-03-04
**Valid until:** 2026-06-04 (90 days -- stable TypeScript codebase, no external library dependencies to track)
