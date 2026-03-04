# Phase 5: Wave Orchestration - Context

**Gathered:** 2026-03-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the flat batch-analysis DAG with a hierarchical wave controller that executes analysis in sequential waves: Wave 1 (L0/L1), Wave 2 (L2), Wave 3 (L3). Each wave operates at one hierarchy level, producing parent nodes before spawning child-level agents. The wave workflow becomes the new default for `ukb full`.

</domain>

<decisions>
## Implementation Decisions

### Wave input model
- Wave agents analyze the **current codebase at HEAD** — not commit history
- Wave 1 reads actual source files with a **tiered approach**: directory structure scan for overall shape, then 3-5 representative file deep-reads per L1 component for richer summaries
- Wave 1 also reads **existing knowledge graph entities** (the ~30 entities already in the KG) as additional context to produce richer output
- Wave 2 agents each read files belonging to their assigned L1 component, scoped via **code-graph-rag queries** against the Memgraph index
- Wave 3 agents read files relevant to their assigned L2 sub-component, also scoped via **code-graph-rag queries**
- No git history processing in waves — pure structural analysis of what exists now

### Wave structure source
- **Manifest-driven at L0/L1**: Wave 1 reads the component manifest (8 L1 components) and creates L0 Project + L1 Component entities. The manifest is the structural source of truth; Wave 1 enriches each with observations from actual code analysis + existing KG context
- **Manifest seeds + code extends at L2**: Wave 2 starts from manifest-defined L2 sub-components but agents can discover additional sub-nodes from code-graph-rag analysis
- **Pure discovery at L3**: Wave 3 is entirely LLM-driven — agents analyze code within their L2 scope and identify Detail-level entities
- **Discovered entities flagged**: Entities discovered beyond the manifest are created with a 'discovered' flag/tag, distinguishable from manifest-defined nodes

### Batch-to-wave transition
- Waves **replace** the batch-analysis workflow — a new `wave-analysis` workflow is created
- `ukb full` switches to invoke `wave-analysis` **immediately** (day one) instead of `batch-analysis`
- `batch-analysis` remains available via explicit workflow name for backward compatibility
- **Reuse existing agent implementations** (SemanticAnalysisAgent, ObservationGenerationAgent, PersistenceAgent, etc.) — agents are good, orchestration changes
- **New WaveController class** — dedicated TypeScript class separate from the existing coordinator. Manages wave sequencing, agent spawning per level, and parent-child context passing
- **Replace in workflow-runner**: WaveController gets its own code path in workflow-runner.ts for wave-analysis; coordinator keeps batch-analysis path
- **Fresh agents per wave** — create new agent instances for each wave, no cross-wave state contamination

### Agent output per wave
- Each wave agent produces: entity node + observations + parent-child relationships (both parentId AND explicit relationship edges in the graph)
- Observation count: **Claude's discretion** based on entity complexity (no fixed minimum — richer entities get more observations)
- Agents also identify what children should exist for the next wave
- Child identification output: **separate structured manifest** (JSON/YAML) of suggested children per agent. Wave controller reads these to spawn next-wave agents
- Insight documents are NOT produced in Phase 5 — that's Phase 6 (Entity Quality)

### Persistence model
- **Incremental merge** — wave output is merged with existing entities, not clean slate
- Wave 2 agents can query persisted L1 entities for context
- Crash-resilient: persisted entities from completed waves survive if a later wave fails
- **Fail fast on agent failure** — if any agent crashes, abort remaining waves. Persisted progress from completed waves survives. User re-runs to retry.

### Progress visibility
- **Full observability**: console log banners + workflow-progress.json updates + SSE events for real-time dashboard updates
- **Per-agent + per-entity granularity**: each entity creation is reported, each agent reports its progress within a wave
- **Wall clock timing**: duration tracked per wave and per agent for bottleneck identification
- **Structured summary report** on completion: entities per level, manifest vs discovered counts, total time, any failures
- Wave banners: clear log markers when each wave starts/ends (e.g., "=== WAVE 2: L2 SubComponents ===")

### Claude's Discretion
- YAML wave structure design (explicit wave phases vs. single-step-per-wave)
- Optimal agent concurrency within each wave (bounded by LLM rate limits)
- Which finalization steps (CGR re-index, dedup, validation) to include in the wave workflow vs. defer to Phase 6-7
- WaveController internal architecture and error handling
- Observation count per entity (scale to complexity)
- Merge strategy details for incremental persistence (conflict resolution when existing entity differs from wave output)

</decisions>

<specifics>
## Specific Ideas

- The component manifest defines 8 L1 + 5 L2 components — this is the starting structure
- HierarchyClassifierAgent exists for keyword-based entity->component assignment — may be reusable within wave agents
- SmartOrchestrator has adaptive routing and confidence propagation — could inform wave controller design
- Success criteria explicitly require: waves visible in logs, L0/L1 before L2, L2 before L3, parallel agents within waves
- Code-graph-rag (Memgraph) must be indexed before wave execution for file scoping to work
- Discovered entities should be visually distinguishable in the summary report

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `SemanticAnalysisAgent` (semantic-analysis-agent.ts): Core code analysis with LLM — can be reused per wave agent
- `ObservationGenerationAgent` (observation-generation-agent.ts): Structured observation creation — reusable
- `PersistenceAgent` (persistence-agent.ts): Entity persistence to LevelDB — reusable with wave context
- `HierarchyClassifierAgent` (hierarchy-classifier.ts): Keyword-based manifest->entity classification — may be useful for file scoping
- `loadComponentManifest()` (component-manifest.ts): Loads and flattens manifest — ready to use
- `SmartOrchestrator` (orchestrator/smart-orchestrator.ts): Adaptive routing, confidence propagation — reference for wave controller
- `BatchScheduler` (batch-scheduler.ts): Manages batch windowing — reference for wave scheduling
- `GraphDatabaseAdapter` (graph-database-adapter.ts): Graph persistence with relationship edge support — needed for explicit parent-child edges

### Established Patterns
- Workflows defined in YAML (config/workflows/*.yaml) with phases: initialization, batch, finalization
- Coordinator loads YAML workflow definition and executes steps in order with dependency resolution
- Agent chain pattern: each agent receives upstream results and produces downstream output
- `KGEntity` interface has hierarchy fields: parentId, level, hierarchyPath (Phase 4)
- Entities persisted via GraphDatabaseAdapter to Graphology + LevelDB
- SSE progress events already established via sse-server.ts

### Integration Points
- `workflow-runner.ts`: Entry point for `execute_workflow` MCP tool — needs code path for WaveController
- `coordinator.ts`: Keeps batch-analysis execution — wave-analysis bypasses this
- `config/workflows/`: Location for `wave-analysis.yaml`
- `tools.ts`: Registers MCP tools — `execute_workflow` already accepts workflow_name parameter
- `sse-server.ts`: SSE progress events — wave progress uses same pattern
- `code-graph-rag`: Must be indexed (Memgraph) before wave execution for CGR-based file scoping
- `workflow-progress.json`: Wave progress updates feed into system health dashboard

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 05-wave-orchestration*
*Context gathered: 2026-03-04*
