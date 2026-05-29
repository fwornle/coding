# Pipeline

**Type:** SubComponent

The pipeline sequences at least seven discrete agents in order: git history ingestion, vibe/LSL session ingestion, AST-based code graph construction, semantic LLM analysis, ontology classification, content validation, and insight generation — each consuming the prior agent's output

## Pipeline

### What It Is

The Pipeline is the central orchestration sub-component of SemanticAnalysis (`integrations/mcp-server-semantic-analysis`), defining the sequential execution contract through which raw source artifacts — git history and LSL/vibe session data — are transformed into classified, validated, and persisted structured knowledge entities. It is not a single class but a composed runtime of at least seven discrete agents, each consuming the prior agent's output and producing a typed result wrapped in the shared `BaseAgentResponseEnvelope` contract.

The pipeline's scope begins at data ingestion and ends at insight generation, encompassing every intermediate transformation: AST-based code graph construction, semantic LLM analysis, ontology classification, and content validation. All agents participating in this pipeline extend `BaseAgent<TInput, TOutput>`, making the Pipeline both a runtime execution order and an architectural contract.

---

### Architecture and Design

![Pipeline — Architecture](images/pipeline-architecture.png)

The Pipeline follows a **linear staged-processing** architecture where each agent is a typed transformation unit: `TInput` from the prior stage becomes `TOutput` to the next. The strict sequential ordering — git history ingestion → vibe/LSL session ingestion → AST code graph construction → semantic LLM analysis → ontology classification → content validation → insight generation — reflects deliberate data dependency: each stage requires the enriched output of the one before it. Insight generation (the Insights sibling component) sits at the terminal position precisely because it depends on ontology metadata attached by `OntologyClassificationAgent`, which must itself follow semantic analysis.

The architectural keystone is `BaseAgent<TInput, TOutput>` and its output contract, the `BaseAgentResponseEnvelope`. Every agent in the pipeline, regardless of domain concern, wraps its result in an `AgentResponse` envelope carrying confidence scores, detected issues, routing suggestions, and retry guidance. This uniform envelope means the pipeline coordinator can make consistent decisions about whether to proceed, retry, or route differently without special-casing individual agents. The child component `BaseAgentResponseEnvelope` is therefore not just a data structure — it is the contract that makes the pipeline composable.

![Pipeline — Relationship](images/pipeline-relationship.png)

A notable design decision is **non-fatal degradation as a first-class concern**. The `CodeGraphAgent`'s graceful degradation when the `uv` CLI or Memgraph TCP connection is unavailable exemplifies this: graph construction is skipped rather than aborting the run. Similarly, trace file writes to `logs/` are explicitly non-fatal. The pipeline prioritizes forward progress over completeness, accepting partial results rather than hard failures. This is a deliberate trade-off favoring availability of downstream insights over strict data integrity guarantees at every stage.

The migration from a legacy `GraphDatabaseAdapter` + `PersistenceAgent` trio to the `KmCoreAdapter` surface (completed in Phase 42.x) reveals a layered storage abstraction strategy. Field names were deliberately preserved during this migration to minimize call-site changes in downstream agents — a conservative, stability-first approach that treats internal agent code as a stable interface surface even when the persistence layer beneath it changes.

---

### Implementation Details

Each pipeline stage is an agent class extending `BaseAgent<TInput, TOutput>`. The generic typing enforces that stage boundaries are explicit: the output type of agent *N* must match the input type of agent *N+1*, making type mismatches compile-time errors rather than runtime surprises.

The **`CodeGraphAgent`** is the most infrastructure-dependent stage. It integrates Tree-sitter AST parsing with a Memgraph graph database backend to construct a code relationship graph. Its graceful degradation logic checks for both the `uv` CLI availability and Memgraph TCP connectivity before attempting graph construction — if either is absent, it emits a degraded-but-valid `AgentResponse` and the pipeline continues. This makes local development and CI environments without Memgraph viable without code changes.

LLM invocations across the semantic analysis stage and any other LLM-backed agents are routed uniformly through `@rapid/llm-proxy`'s `LLMService`. Token usage telemetry is attached via `attachTokenLogger`, enabling per-agent token accounting across a full batch run. This means the pipeline produces not only knowledge output but also a resource accounting record, which is critical for cost visibility in batch workloads. The `LegacyOntologyAdapter` shim — a sibling component — insulates the `OntologyClassificationAgent` from direct coupling to `@fwornle/km-core`'s `OntologyRegistry`, so the pipeline's classification stage remains stable even as the underlying registry implementation evolves.

The `OntologyClassificationAgent` (part of the Ontology sibling) runs its three-phase lifecycle — initialize → classify → suggest extensions — within the pipeline sequence. Its position after semantic LLM analysis is intentional: classification operates on semantically enriched entities, and the suggest-extensions phase can propose new ontology classes when observed entities fall outside existing classifications. The `OntologyConfigManager` singleton governs configuration for this stage; because it is process-wide, all agents within a pipeline run share one configuration state.

Debugging support is built into the pipeline via non-fatal trace file writes to `logs/`. These traces are written by individual agents and are designed to survive write failures silently, meaning trace infrastructure problems never propagate as pipeline failures. This is a pragmatic debugging affordance rather than a production observability system.

---

### Integration Points

The Pipeline's primary parent is SemanticAnalysis, which acts as the MCP server host and pipeline coordinator. The pipeline does not operate independently — it runs within the MCP server context that sequences agent invocations and manages the overall batch lifecycle.

Storage integration runs through `KmCoreAdapter`, the current persistence surface following the Phase 42.x migration. Downstream agents reference field names that were preserved from the legacy `GraphDatabaseAdapter` API, meaning the integration point is stable at the field-name level even though the adapter implementation changed. The `LegacyOntologyAdapter` provides a similar anti-corruption boundary for ontology operations, connecting the pipeline's classification stage to `@fwornle/km-core`'s `OntologyRegistry` without exposing its evolving API directly to pipeline agents.

LLM integration is centralized through `@rapid/llm-proxy`'s `LLMService` with `attachTokenLogger` — any pipeline agent making LLM calls should route through this surface to ensure token telemetry is captured. The `CodeGraphAgent` adds an external infrastructure dependency on Memgraph (TCP) and the `uv` CLI, both treated as optional via the degradation logic. The Insights sibling component acts as a consumer of the pipeline's full output, depending on the complete chain having run and ontology metadata being present on each entity.

---

### Usage Guidelines

**Treat stage ordering as a hard dependency graph, not an implementation detail.** The semantic and classification stages must follow ingestion; insight generation must follow classification. Reordering agents will produce type errors at compile time (via the generic `BaseAgent` chain) and semantic errors at runtime (missing metadata on entities).

**Never make pipeline-aborting failures out of infrastructure uncertainty.** The `CodeGraphAgent` pattern — check availability, degrade gracefully, emit a valid `AgentResponse` — is the model for any agent with optional external dependencies. The `BaseAgentResponseEnvelope`'s routing suggestions and retry guidance fields exist precisely to communicate degraded states upstream without throwing exceptions that halt the run.

**Route all LLM calls through `LLMService` with `attachTokenLogger`.** Ad-hoc LLM calls that bypass this surface will produce blind spots in per-agent token accounting, making cost attribution for batch runs incomplete.

**Respect the `KmCoreAdapter` field-name contract.** The deliberate field-name preservation during the storage migration means downstream agents carry implicit assumptions about field naming. Introducing field renames in `KmCoreAdapter` without auditing all agent call-sites will break the pipeline silently if those fields are not validated at the envelope level.

**Do not rely on trace files for production observability.** Trace writes to `logs/` are non-fatal and may silently fail. They are a developer debugging aid. Production monitoring should be built on the token telemetry and `AgentResponse` envelope data, not on trace file presence.


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component is a multi-agent MCP server (`integrations/mcp-server-semantic-analysis`) that orchestrates a batch-analysis pipeline over git history and LSL (vibe) sessions to extract, classify, validate, and persist structured knowledge entities. It coordinates several specialized agents in sequence: git history ingestion, vibe/LSL session ingestion, AST-based code graph construction, semantic LLM analysis, ontology classification, content validation, and insight generation. Each agent is built on a shared `BaseAgent<TInput, TOutput>` abstract class that wraps execution in a standardized `AgentResponse` envelope with confidence scoring, issue detection, routing suggestions, and retry guidance.

The pipeline uses an ontology system backed by `@fwornle/km-core`'s `OntologyRegistry` (accessed via a `LegacyOntologyAdapter` shim) to classify extracted observations into upper/lower ontology classes with configurable heuristic and LLM-assisted classification modes. The `OntologyClassificationAgent` manages lifecycle (initialize → classify → suggest extensions) and attaches `OntologyMetadata` (class, confidence, method, version) to every entity before persistence. Storage was migrated from a legacy `GraphDatabaseAdapter`+`PersistenceAgent` trio to a `KmCoreAdapter` surface in Phase 42.x, with field names preserved for minimal call-site disruption.

Key cross-cutting concerns include: LLM calls routed through `@rapid/llm-proxy`'s `LLMService` with token usage telemetry via `attachTokenLogger`; optional code-graph-rag integration via `CodeGraphAgent` (Tree-sitter AST + Memgraph) that gracefully degrades when the `uv` CLI or Memgraph TCP connection is unavailable; content staleness detection combining reference-pattern regex scanning and git-commit correlation via `GitStalenessDetector`; and trace files written to `logs/` for debugging non-fatally.

### Children
- [BaseAgentResponseEnvelope](./BaseAgentResponseEnvelope.md) -- Per the Pipeline sub-component description, every agent extending BaseAgent<TInput, TOutput> wraps its output in an AgentResponse envelope, enforcing a uniform contract across all SemanticAnalysis pipeline stages.

### Siblings
- [Ontology](./Ontology.md) -- `OntologyClassificationAgent` manages a three-phase lifecycle — initialize → classify → suggest extensions — ensuring the ontology registry is ready before any entity is classified and can propose new classes when observed entities don't fit existing ones
- [Insights](./Insights.md) -- Insight generation is the final sequential stage in the pipeline, operating on fully classified and validated entities produced by upstream agents, making it dependent on the complete ontology metadata attached by `OntologyClassificationAgent`
- [OntologyConfigManager](./OntologyConfigManager.md) -- `OntologyConfigManager` is implemented as a singleton, meaning all agents and subsystems within a process share one configuration state; the explicit `reset()` method exists specifically to restore defaults between unit tests without restarting the process
- [LegacyOntologyAdapter](./LegacyOntologyAdapter.md) -- `LegacyOntologyAdapter` wraps `OntologyRegistry` from `@fwornle/km-core`, acting as an anti-corruption layer so that the legacy interface expected by `OntologyValidator` and `OntologyClassifier` is preserved even as the underlying registry implementation evolves


---

*Generated from 6 observations*
