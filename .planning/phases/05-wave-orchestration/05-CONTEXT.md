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
- Wave 1 reads actual source files to survey the project structure
- Wave 2 agents each read files belonging to their assigned L1 component
- Wave 3 agents read files relevant to their assigned L2 sub-component
- No git history processing in waves — pure structural analysis of what exists now

### Wave structure source
- **Manifest-driven at L0/L1**: Wave 1 reads the component manifest (8 L1 components) and creates L0 Project + L1 Component entities. The manifest is the structural source of truth; Wave 1 enriches each with observations from actual code analysis
- **Manifest seeds + code extends at L2**: Wave 2 starts from manifest-defined L2 sub-components but agents can discover additional sub-nodes from actual code structure
- **Pure discovery at L3**: Wave 3 is entirely LLM-driven — agents analyze code within their L2 scope and identify Detail-level entities

### Batch-to-wave transition
- Waves **replace** the batch-analysis workflow — a new `wave-analysis` workflow is created
- `ukb full` switches to invoke `wave-analysis` instead of `batch-analysis`
- `batch-analysis` remains available in config for backward compatibility
- **Reuse existing agent implementations** (SemanticAnalysisAgent, ObservationGenerationAgent, PersistenceAgent, etc.) — agents are good, orchestration changes
- **New WaveController class** — dedicated TypeScript class separate from the existing coordinator. Manages wave sequencing, agent spawning per level, and parent-child context passing

### Agent output per wave
- Each wave agent produces: entity node + 3+ observations + parent-child relationships
- Agents also identify what children should exist for the next wave
- Child identification: manifest-defined children as seed (L1→L2), LLM-suggested children from code analysis (L2→L3)
- Insight documents are NOT produced in Phase 5 — that's Phase 6 (Entity Quality)

### Persistence model
- **Persist per wave** — each wave saves its entities to the knowledge graph before the next wave starts
- Wave 2 agents can query persisted L1 entities for context
- Crash-resilient: partial progress is saved if a wave fails

### Existing data handling
- **Clean slate per run** — each `ukb full` wave run clears existing wave-produced entities and rebuilds from manifest + code analysis
- Existing entities get replaced by richer wave-produced ones
- Simplest model — no merge logic needed

### Progress visibility
- Clear log banners when each wave starts/ends (e.g., "=== WAVE 2: L2 SubComponents ===")
- Entity counts per agent (e.g., "SemanticAnalysis: created 5 L2 nodes")
- Minimal but sufficient for the success criteria ("distinct waves visible in logs")

### Claude's Discretion
- File scoping strategy for wave agents (manifest keywords, directory mapping, code-graph-rag, or combination)
- YAML wave structure design (explicit wave phases vs. single-step-per-wave)
- Optimal agent concurrency within each wave (bounded by LLM rate limits)
- Which finalization steps (CGR, dedup, validation) to include in the wave workflow vs. defer to Phase 6-7
- WaveController internal architecture and error handling

</decisions>

<specifics>
## Specific Ideas

- The component manifest defines 8 L1 + 5 L2 components — this is the starting structure
- HierarchyClassifierAgent exists for keyword-based entity→component assignment — may be reusable within wave agents
- SmartOrchestrator has adaptive routing and confidence propagation — could inform wave controller design
- Success criteria explicitly require: waves visible in logs, L0/L1 before L2, L2 before L3, parallel agents within waves

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `SemanticAnalysisAgent` (semantic-analysis-agent.ts): Core code analysis with LLM — can be reused per wave agent
- `ObservationGenerationAgent` (observation-generation-agent.ts): Structured observation creation — reusable
- `PersistenceAgent` (persistence-agent.ts): Entity persistence to LevelDB — reusable with wave context
- `HierarchyClassifierAgent` (hierarchy-classifier.ts): Keyword-based manifest→entity classification — may be useful for file scoping
- `loadComponentManifest()` (component-manifest.ts): Loads and flattens manifest — ready to use
- `SmartOrchestrator` (orchestrator/smart-orchestrator.ts): Adaptive routing, confidence propagation — reference for wave controller
- `BatchScheduler` (batch-scheduler.ts): Manages batch windowing — reference for wave scheduling

### Established Patterns
- Workflows defined in YAML (config/workflows/*.yaml) with phases: initialization, batch, finalization
- Coordinator loads YAML workflow definition and executes steps in order with dependency resolution
- Agent chain pattern: each agent receives upstream results and produces downstream output
- `KGEntity` interface has hierarchy fields: parentId, level, hierarchyPath (Phase 4)
- Entities persisted via GraphDatabaseAdapter to Graphology + LevelDB

### Integration Points
- `workflow-runner.ts`: Entry point for `execute_workflow` MCP tool — needs to route to WaveController for wave-analysis
- `coordinator.ts`: Currently handles all workflow execution — wave-analysis will bypass this and use WaveController
- `config/workflows/`: New `wave-analysis.yaml` file goes here
- `tools.ts`: Registers MCP tools — `execute_workflow` already accepts workflow_name parameter
- `sse-server.ts`: SSE progress events — wave progress should use same pattern

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 05-wave-orchestration*
*Context gathered: 2026-03-04*
