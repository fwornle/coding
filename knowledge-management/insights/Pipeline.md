# Pipeline

**Type:** SubComponent

Each pipeline agent extends BaseAgent<TInput, TOutput> and must populate all five lifecycle slots (process, calculateConfidence, detectIssues, generateRouting, applyCorrections) even if some return stubs, because the coordinator uses routing output to make branching decisions

# Pipeline — Technical Insight Document

## What It Is

The Pipeline is a sub-component of SemanticAnalysis that coordinates the sequenced execution of agents through a directed acyclic graph (DAG). Its topology is not encoded in application code but is instead declared in `batch-analysis.yaml`, the configuration artifact represented by the child component BatchAnalysisYamlConfig. The pipeline coordinator reads this YAML file, resolves each step's `depends_on` edges, and orchestrates execution in a fixed, deterministic order.

Functionally, the Pipeline takes raw inputs — typically arrays of git commits consumed by agents like `SemanticAnalysisAgent` — and transforms them through a chain of specialized stages: semantic observation generation, ontology classification, deduplication, and finally persistence to the Memgraph knowledge graph. Every agent that participates in the Pipeline derives from the `BaseAgent<TInput, TOutput>` abstract class defined in `src/agents/base-agent.ts` (inherited from the parent SemanticAnalysis component), which guarantees a uniform execution envelope across heterogeneous processing concerns.

![Pipeline — Architecture](images/pipeline-architecture.png)

## Architecture and Design

The Pipeline follows a **DAG-based orchestration pattern** with **configuration-driven topology**. By externalizing agent sequencing into `batch-analysis.yaml`, the design explicitly separates *what the pipeline does* (encoded in agent implementations) from *how the pipeline is wired together* (encoded in YAML). This is a deliberate inversion: re-ordering stages, inserting new agents, or branching execution does not require recompiling TypeScript — it requires editing a declarative config. This makes BatchAnalysisYamlConfig the single point of authority for pipeline topology.

Each stage in the DAG declares its dependencies through explicit `depends_on` edges, which the coordinator uses to compute execution order and parallelization opportunities. This contrasts with implicit ordering schemes (such as registration order or alphabetical sorting) and ensures that the graph structure is auditable directly from the configuration file.

Critically, the Pipeline depends on the **uniform agent contract** enforced by `BaseAgent<TInput, TOutput>`. Because every agent must populate all five lifecycle slots (`process`, `calculateConfidence`, `detectIssues`, `generateRouting`, `applyCorrections`), the coordinator can treat all stages polymorphically. The `generateRouting` output, in particular, is consumed by the coordinator to make branching decisions — meaning even agents with no meaningful routing logic must still return a (possibly empty) routing object. This rigidity is the price paid for a homogeneous orchestration layer.

The Pipeline also enforces a **strict stage ordering for KG-related concerns**: deduplication is a discrete stage that sits *before* persistence, not bundled into it. This means deduplication agents receive entities that have already been ontology-classified by upstream stages, and they must resolve identity conflicts before any writes hit Memgraph. This separation reflects a deliberate trade-off — performing dedup pre-write keeps the graph clean but requires the deduplication agent to hold and compare classified entities in working memory.

## Implementation Details

The execution backbone is the `BaseAgent<TInput, TOutput>` abstract class, which every Pipeline-participating agent extends. The generic parameters allow the Pipeline to carry wildly different payload types between stages: `SemanticAnalysisAgent`, for example, declares `TInput` as a raw git commit array and produces structured observations as `TOutput`. Downstream KG operator agents then receive those observations and continue the transformation chain. Despite this heterogeneity, the response envelope (timestamps, model usage metadata, routing suggestions, corrections list) is identical across stages.

Persistence is handled through dedicated KG operator agents that write to Memgraph using `MEMGRAPH_BATCH_SIZE` as a tuning parameter. This environment-controlled value governs how many entities are flushed per batch to the graph database, providing a direct lever for balancing throughput against memory pressure and transaction overhead. Increasing the batch size reduces round trips to Memgraph but increases the working set held in memory before flush.

A subtle but important implementation detail lives in `PersistenceAgent.mapEntityToSharedMemory()`: this method pre-populates ontology metadata fields — specifically `entityType` and `metadata.ontologyClass` — into shared memory. The intent is to **prevent redundant LLM re-classification on subsequent pipeline runs**. Without this caching of classification results into the persisted representation, every re-run would force expensive LLM calls for entities whose ontology classification is already known. This is a deliberate optimization that couples the persistence layer to the ontology subsystem's vocabulary (the same vocabulary curated by the sibling Ontology component via its upper/lower hierarchy and managed through `OntologyConfigManager` in the OntologySubsystem sibling).

![Pipeline — Relationship](images/pipeline-relationship.png)

Deduplication, as a discrete pre-persistence stage, receives the already-classified entity stream and applies identity resolution. Because it runs after classification but before persistence, it can use ontology class information as part of its matching heuristics, but it must complete before any Memgraph write occurs.

## Integration Points

The Pipeline integrates upward with its parent **SemanticAnalysis** component, which provides the `BaseAgent<TInput, TOutput>` contract that all pipeline stages implement. Without that contract, the coordinator would have no uniform way to invoke heterogeneous agents.

Downward, the Pipeline integrates with its child **BatchAnalysisYamlConfig**, which defines the agent sequencing, dependency edges, and configuration parameters. Any change to pipeline topology is a change to this YAML file rather than to coordinator code.

Laterally, the Pipeline connects to the sibling **Ontology** component (which defines the upper/lower ontology two-tier hierarchy) and the **OntologySubsystem** sibling (whose `OntologyConfigManager` under `src/ontology/` centralizes ontology configuration loading). When KG operator agents in the Pipeline classify or persist entities, they consume ontology definitions sourced from these siblings. The `PersistenceAgent.mapEntityToSharedMemory()` optimization specifically depends on the ontology vocabulary being stable across runs.

The Pipeline also has a downstream relationship with the sibling **Insights** component, which operates as a post-persistence concern. Insights does not read from the Pipeline's intermediate stages — it consumes already-written KG data from Memgraph, as documented in `integrations/mcp-server-semantic-analysis/docs/architecture/agents.md`. This means the Pipeline's contract with Insights is mediated entirely through the persisted graph state, not through in-memory handoff.

Externally, the Pipeline integrates with **Memgraph** as its persistent sink, parameterized by `MEMGRAPH_BATCH_SIZE`, and with whatever **LLM providers** the upstream classification agents invoke.

## Usage Guidelines

When implementing a new agent for the Pipeline, developers must extend `BaseAgent<TInput, TOutput>` and populate **all five lifecycle methods**, even if some return stub values. The coordinator depends on `generateRouting()` output for branching decisions, so returning empty stubs can cause silent routing failures rather than compile errors. Treat the five lifecycle slots as required slots, not optional hooks.

To add a new stage to the Pipeline, modify `batch-analysis.yaml` (the BatchAnalysisYamlConfig artifact) and declare the appropriate `depends_on` edges. Do not attempt to encode ordering in application logic — the configuration file is the single source of truth for topology, and bypassing it will produce a Pipeline whose actual behavior diverges from its declared structure.

When tuning persistence performance, adjust `MEMGRAPH_BATCH_SIZE` rather than rewriting the flush logic. Larger values reduce database round trips but increase memory pressure; smaller values are safer for large entity sets but increase transactional overhead. Profile against actual commit workloads before changing the default.

Respect the **deduplication-before-persistence** ordering. If you introduce a new entity-producing agent, ensure it runs upstream of the deduplication stage so that identity conflicts are resolved before any KG writes occur. Inserting persistence-writing agents before dedup will corrupt graph integrity and undermine the optimization guarantees of `PersistenceAgent.mapEntityToSharedMemory()`.

Finally, when designing agents that perform ontology classification, ensure that classification results are written into `entityType` and `metadata.ontologyClass` fields in shared memory. Skipping this step forces redundant LLM calls on subsequent Pipeline runs, defeating the caching optimization built into the persistence layer. This pattern is the contract that lets the Pipeline run cheaply on re-execution.

### Architectural patterns identified
- **DAG orchestration** with explicit `depends_on` edges
- **Configuration-driven topology** via `batch-analysis.yaml`
- **Uniform agent contract** via `BaseAgent<TInput, TOutput>` and the five-method lifecycle
- **Pipeline staging** with strict pre-persistence dedup
- **Result caching via persisted metadata** to avoid redundant LLM work

### Design decisions and trade-offs
- Externalizing topology to YAML trades runtime flexibility for slightly more indirection
- Rigid five-method lifecycle trades implementation overhead for polymorphic coordination
- Pre-write deduplication trades memory footprint for graph cleanliness
- Batch-size tuning trades memory for throughput

### System structure insights
- Pipeline is sandwiched between SemanticAnalysis (contract provider) and BatchAnalysisYamlConfig (topology declaration)
- Memgraph acts as the boundary between Pipeline and the sibling Insights component
- Ontology and OntologySubsystem siblings supply the classification vocabulary consumed mid-pipeline

### Scalability considerations
- `MEMGRAPH_BATCH_SIZE` is the primary throughput lever
- Pre-classified metadata caching eliminates LLM cost on re-runs — the dominant scalability win for repeat workloads
- DAG structure permits parallel execution of independent stages, though parallelism depends on `depends_on` declarations in BatchAnalysisYamlConfig

### Maintainability assessment
- **High**: topology changes are config-only; agent contract is uniform; ordering is auditable from YAML
- **Risk areas**: agents that return stub routing/issue values can silently break coordinator branching; ontology metadata field names are implicitly contracted between persistence and classification stages and should be treated as a stable interface


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- [LLM] The `BaseAgent<TInput, TOutput>` abstract class defined in `src/agents/base-agent.ts` establishes a rigid, five-method execution contract that every agent in the pipeline must implement: `process()`, `calculateConfidence()`, `detectIssues()`, `generateRouting()`, and `applyCorrections()`. This is not a loose interface — each method is called sequentially within a standardized envelope, meaning an agent cannot skip confidence calculation or issue detection even if it has nothing meaningful to report for those phases. The resulting `AgentResponse` envelope carries not just the domain output but also metadata (timestamps, model usage), routing suggestions for downstream agents, and a corrections list for self-healing. For a new developer, this means that implementing a new agent is less about writing a single processing function and more about correctly filling all five lifecycle slots; an agent that returns empty stubs for `detectIssues()` or `generateRouting()` will still compile and run, but the orchestrating pipeline likely depends on those fields being populated to make branching decisions. The generic type parameters `<TInput, TOutput>` allow the base class to be reused across wildly different domains — from raw git commit arrays (SemanticAnalysisAgent) to ontology classification batches (OntologyClassificationAgent) — without sacrificing static type safety on the input/output contracts.

### Children
- [BatchAnalysisYamlConfig](./BatchAnalysisYamlConfig.md) -- The Pipeline sub-component description explicitly names batch-analysis.yaml as the file where agent sequencing is defined, making it the single configuration point controlling pipeline topology rather than having order encoded in application logic.

### Siblings
- [Ontology](./Ontology.md) -- The upper ontology defines broad abstract categories while lower ontology definitions provide concrete entity types, creating a two-tier classification hierarchy referenced by OntologyClassificationAgent
- [Insights](./Insights.md) -- Insight generation operates as a post-persistence concern, consuming already-written KG data rather than raw pipeline input, as described in integrations/mcp-server-semantic-analysis/docs/architecture/agents.md
- [OntologySubsystem](./OntologySubsystem.md) -- OntologyConfigManager centralizes all ontology configuration loading under src/ontology/, meaning changes to entity type hierarchies flow through a single managed entry point rather than being scattered across agents


---

*Generated from 6 observations*
