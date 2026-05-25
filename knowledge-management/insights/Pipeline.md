# Pipeline

**Type:** SubComponent

Each agent extends the BaseAgent<TInput, TOutput> abstract class (documented in docs/architecture/agents.md), enforcing a standard response envelope with confidence scoring, issue detection, routing suggestions, and corrections

# Pipeline — Technical Insight Document

## What It Is

Pipeline is a SubComponent within the broader `SemanticAnalysis` system, implemented in `integrations/mcp-server-semantic-analysis/` and configured declaratively through `batch-analysis.yaml`. It represents the orchestrated execution layer that coordinates a sequence of specialized agents — coordinator, observation, KG (knowledge graph), dedup, and persistence — into a directed acyclic graph (DAG) of dependent steps. Pipeline is the runtime contract that turns the heterogeneous agent collection into a single, repeatable workflow for extracting structured knowledge entities from git history, LSL/vibe sessions, and AST-parsed code graphs.

Structurally, Pipeline sits beneath `SemanticAnalysis` and contains `DAGTopologicalExecutor` as its primary child. The DAG declaration in `batch-analysis.yaml` uses explicit `depends_on` edges so the executor can compute topological ordering and dispatch steps in the correct sequence. Each step in the DAG resolves to an agent that extends the shared `BaseAgent<TInput, TOutput>` abstract class — the same contract used by sibling components such as `Ontology`, `Insights`, and `OntologyConfigManager`.

![Pipeline — Architecture](images/pipeline-architecture.png)

## Architecture and Design

The architectural backbone of Pipeline is a **declarative DAG configuration**: rather than hard-coding step sequencing in imperative code, the pipeline is defined as data in `batch-analysis.yaml`, with `depends_on` edges between named steps. This separation allows the `DAGTopologicalExecutor` child component to compute a valid execution order purely from the dependency graph, decoupling the *what* (which agents run) from the *how* (the order they run in). It also makes the workflow inspectable, version-controlled, and modifiable without touching agent source code.

A second architectural pattern is the **standard response envelope** enforced by `BaseAgent<TInput, TOutput>` (documented in `docs/architecture/agents.md`). Every agent — whether it handles coordination, observation, KG construction, deduplication, or persistence — produces an output envelope containing confidence scoring, issue detection, routing suggestions, and corrections. This shared contract is what enables the **coordinator agent** to act as a generic handoff orchestrator: it routes outputs from upstream agents as typed inputs into downstream agents based purely on the envelope structure, without needing per-agent glue code.

<USER_ID_REDACTED>-gating is built directly into the envelope. Because every step emits a confidence score and optional routing suggestions, the pipeline can make **retry or reroute decisions at step boundaries** without restarting the full batch. This converts what could be a brittle linear chain into a self-correcting workflow: a low-confidence observation can be re-issued or routed to a more specialized downstream path, while high-confidence outputs flow straight through.

The placement of **deduplication as a discrete pipeline step between KG construction and persistence** is a deliberate design decision. By the time entities reach dedup, they are already structured KG outputs from upstream operator agents — meaning deduplication operates over typed entity sets rather than raw text. This keeps the dedup logic focused and avoids re-doing semantic work that the KG step already performed.

## Implementation Details

The DAG declaration in `batch-analysis.yaml` is the source of truth for step topology. Each entry names a step, identifies its agent, and lists `depends_on` predecessors. `DAGTopologicalExecutor` (the child component of Pipeline) consumes this configuration and produces a topologically sorted execution plan that respects all dependency edges across the coordinator, observation, KG, dedup, and persistence stages.

Each agent in the pipeline extends `BaseAgent<TInput, TOutput>` — a generic abstract class parameterized on input and output types. This enforces type safety across the heterogeneous agent set: the KG agent's output type, for instance, is the input type expected by the dedup agent. The base class enforces the standardized envelope so that confidence scores, detected issues, routing hints, and proposed corrections are uniformly available regardless of which agent produced the envelope.

The **coordinator agent** is the runtime mediator between steps. It reads the envelope from an upstream agent, applies any routing suggestions, and dispatches the payload as a typed input to the next agent according to the DAG. Because all agents speak the same envelope contract, the coordinator does not need agent-specific logic — it operates purely on envelope semantics.

`PersistenceAgent.mapEntityToSharedMemory()` is an important optimization at the tail of the pipeline. It pre-populates ontology metadata fields — specifically `entityType` and `metadata.ontologyClass` — directly into shared memory. This prevents redundant LLM-driven re-classification when retry cycles re-enter the persistence stage, saving both latency and model cost. The persistence stage itself is further tuned by `MEMGRAPH_BATCH_SIZE`, a configuration value referenced in project documentation, which controls how many entities are flushed per write batch. This **decouples agent output volume from storage write pressure**, letting upstream agents produce at their natural rate while persistence smooths the load against the graph store.

![Pipeline — Relationship](images/pipeline-relationship.png)

## Integration Points

Pipeline is the operational embodiment of its parent `SemanticAnalysis`: it is the layer through which all the parent's specialized agents are wired together. Through the coordinator agent, Pipeline integrates with each sibling-domain agent — git history ingestion, code graph construction, insight generation (via the `Insights` sibling), ontology classification (via `Ontology` and its `LegacyOntologyAdapter`), and persistence — all under the unified `BaseAgent<TInput, TOutput>` contract.

The sibling `OntologyConfigManager` integrates implicitly: as a singleton (per `docs/configuration.md` patterns), it provides every agent in the pipeline with a single authoritative view of ontology paths and classification thresholds. Because the pipeline's <USER_ID_REDACTED>-gating relies on confidence thresholds, the values surfaced by `OntologyConfigManager` directly influence Pipeline's retry/reroute behavior.

`LegacyOntologyAdapter` matters to Pipeline because it decouples pipeline agents from the concrete `km-core OntologyRegistry` API — resolving the tight-coupling issue documented in `CRITICAL-ARCHITECTURE-ISSUES.md`. This means the pipeline's ontology classification step can evolve independently of the underlying registry implementation.

At the storage boundary, Pipeline integrates with Memgraph through the persistence agent. The `MEMGRAPH_BATCH_SIZE` configuration is the explicit knob exposed for tuning this integration. Downstream consumers of the persisted graph rely on the entity metadata fields pre-populated by `PersistenceAgent.mapEntityToSharedMemory()`.

The child `DAGTopologicalExecutor` is the internal integration point that turns the YAML configuration into runtime behavior — it is the bridge between Pipeline's declarative configuration surface and its imperative execution.

## Usage Guidelines

When adding a new step to the pipeline, define it in `batch-analysis.yaml` with the appropriate `depends_on` edges rather than modifying imperative orchestration code. The new agent must extend `BaseAgent<TInput, TOutput>` so that its outputs participate in the shared envelope contract — without this, the coordinator agent cannot route its results, and <USER_ID_REDACTED>-gating will not function for that step.

Rely on the envelope's confidence scoring and routing suggestions for failure handling. Because the pipeline supports retry and reroute decisions at step boundaries, agents should emit meaningful confidence scores and surface issues through the envelope rather than throwing or short-circuiting the whole batch. Restarting the full DAG should be a last resort — the design intent is fine-grained <USER_ID_REDACTED>-gating per step.

When working with the persistence stage, do not bypass `PersistenceAgent.mapEntityToSharedMemory()` for ad-hoc writes. The pre-population of `entityType` and `metadata.ontologyClass` is what makes retries cheap; skipping it forces redundant LLM re-classification. If batch-flush behavior needs tuning for a different workload, adjust `MEMGRAPH_BATCH_SIZE` rather than introducing parallel write paths.

For ontology-aware steps, always consult the singleton `OntologyConfigManager` for thresholds and paths, and interact with the registry through `LegacyOntologyAdapter` rather than coupling new code to `km-core OntologyRegistry` directly. This preserves the architectural decoupling that the adapter was introduced to provide.

### Scalability and Maintainability Assessment

**Scalability** of Pipeline rests on three explicit mechanisms: the DAG-driven topological execution that allows independent steps to be scheduled without artificial sequencing; the `MEMGRAPH_BATCH_SIZE` knob that decouples agent throughput from graph write throughput; and the envelope-based <USER_ID_REDACTED>-gating that lets the system retry narrow sub-steps rather than reprocess entire batches. The ontology metadata caching inside `PersistenceAgent.mapEntityToSharedMemory()` further reduces the cost of retries at scale.

**Maintainability** is strong because the pipeline is configured declaratively in `batch-analysis.yaml`, agents share a single `BaseAgent<TInput, TOutput>` contract, and integration concerns (ontology access, configuration, persistence batching) are isolated behind dedicated siblings (`LegacyOntologyAdapter`, `OntologyConfigManager`) or explicit configuration values. New agents can be added by extending the base class and updating the DAG, without touching the coordinator or executor code.


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- SemanticAnalysis is a multi-agent pipeline in `integrations/mcp-server-semantic-analysis/` that processes git history, LSL/vibe sessions, and AST-parsed code graphs to extract and persist structured knowledge entities. The system orchestrates several specialized agents—covering git history ingestion, code graph construction, semantic insight generation, ontology classification, content validation, and persistence—coordinated through a batch-analysis workflow. Each agent extends a common `BaseAgent<TInput, TOutput>` abstract class that enforces a standard response envelope with confidence scoring, issue detection, routing suggestions, and corrections, enabling robust retry and <USER_ID_REDACTED>-gating across pipeline steps.

### Children
- [DAGTopologicalExecutor](./DAGTopologicalExecutor.md) -- batch-analysis.yaml defines the pipeline as a DAG of steps with explicit depends_on edges per the parent SubComponent context, enabling topological execution order across all agent stages

### Siblings
- [Ontology](./Ontology.md) -- docs/architecture/agents.md describes OntologyClassifier and OntologyValidator as distinct interfaces, both now backed by LegacyOntologyAdapter wrapping km-core OntologyRegistry
- [Insights](./Insights.md) -- docs/architecture/agents.md identifies a dedicated insight-generation agent responsible for authoring structured knowledge reports from aggregated code and history signals
- [OntologyConfigManager](./OntologyConfigManager.md) -- Implemented as a singleton (per docs/configuration.md patterns) to ensure all pipeline agents share a single authoritative view of ontology paths and classification thresholds
- [LegacyOntologyAdapter](./LegacyOntologyAdapter.md) -- Resolves the architectural issue documented in CRITICAL-ARCHITECTURE-ISSUES.md where OntologyClassifier was tightly coupled to an internal registry; the adapter decouples pipeline agents from the km-core registry's concrete API
- [BaseAgent](./BaseAgent.md) -- BaseAgent<TInput, TOutput> is a generic abstract class (documented in docs/architecture/agents.md) parameterized on input and output types, enforcing type safety across the heterogeneous agent pipeline


---

*Generated from 7 observations*
