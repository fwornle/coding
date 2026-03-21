# StepExecutor

**Type:** Detail

The StepExecutor applies transformations to entities using the TransformationApplier and KG operators

## What It Is  

The **StepExecutor** is the core runtime component that drives the execution of a single step inside a **Pipeline**.  It lives within the pipeline execution package (the exact file path is not disclosed in the current observations) and is invoked by the **Pipeline** coordinator after the DAG‑based dependency resolution has identified that the step is ready to run.  Its primary responsibilities are to orchestrate the processing of incoming entities, apply any declared transformations, and ensure that duplicate entities are removed before the step’s results are emitted downstream.  To fulfil these responsibilities the executor composes three specialised services that are injected or looked‑up at runtime:  

1. **EntityProcessor** – consumes raw entities and produces structured observations.  
2. **TransformationApplier** – runs the step‑specific transformation logic, leveraging the KG (knowledge‑graph) operators that are part of the transformation DSL.  
3. **DeduplicationService** – performs entity‑level deduplication to guarantee idempotent downstream consumption.  

Because the **Pipeline** is defined in a `pipeline-config.yaml` file and resolved by the **DAGDependencyResolver**, the **StepExecutor** is always executed in a topologically‑sorted order, guaranteeing that all declared `depends_on` edges are satisfied before a step runs.

---

## Architecture and Design  

The design of **StepExecutor** follows a **composition‑over‑inheritance** style: rather than embedding processing logic directly, it delegates to three focused collaborators (EntityProcessor, TransformationApplier, DeduplicationService).  This results in a **service‑oriented** internal architecture where each collaborator encapsulates a single concern (processing, transformation, deduplication).  The executor itself acts as a **facade**, presenting a simple “execute step” interface while coordinating the underlying services.

The surrounding pipeline infrastructure (PipelineCoordinator, DAGDependencyResolver, PipelineConfigParser) implements a **DAG‑based orchestration** pattern.  The configuration parser extracts step definitions from `pipeline-config.yaml`; the dependency resolver builds a directed acyclic graph; the coordinator walks the graph in topological order and calls each **StepExecutor**.  This makes the overall system **data‑driven**: the shape of the execution flow is defined declaratively in YAML rather than hard‑coded.

Interaction flow (high‑level):

1. **PipelineCoordinator** determines that a step is ready and creates/injects a **StepExecutor** instance.  
2. **StepExecutor** receives a batch of input entities.  
3. It forwards the batch to **EntityProcessor**, which yields a stream of observations.  
4. The observations are handed to **TransformationApplier**, which applies KG operators (e.g., graph traversals, enrichments) according to the step’s transformation definition.  
5. The transformed entities are passed to **DeduplicationService**, which filters out duplicates based on configured keys or similarity heuristics.  
6. The deduplicated result set is returned to the coordinator and forwarded to downstream steps or persisted.

No additional architectural patterns (such as micro‑services or event‑driven messaging) are evident from the observations, so the analysis stays strictly within the observed composition and DAG orchestration model.

---

## Implementation Details  

Although the source files are not enumerated, the implementation can be inferred from the class names mentioned:

* **EntityProcessor** – likely implements an interface such as `process(Iterable<Entity>) → Iterable<Observation>`.  It may contain parsers, validators, and schema mappers that convert raw payloads into typed observation objects used later in the pipeline.

* **TransformationApplier** – encapsulates the logic for applying step‑specific transformations.  The reference to “KG operators” suggests that the component interacts with a knowledge‑graph library, invoking operators like node expansion, edge filtering, or attribute enrichment.  The applier probably receives a transformation definition (perhaps a DSL fragment extracted from `pipeline-config.yaml`) and executes it against each observation.

* **DeduplicationService** – provides a `deduplicate(Iterable<Entity>) → Iterable<Entity>` method.  Internally it may maintain a hash‑set of entity identifiers or apply fuzzy‑matching algorithms to detect duplicates.  Because deduplication is performed after transformation, the service works on the enriched representation, ensuring that semantically identical entities (even if they differ in raw form) are collapsed.

The **StepExecutor** itself likely follows a simple procedural algorithm:

```python
def execute_step(self, input_entities):
    observations = self.entity_processor.process(input_entities)
    transformed = self.transformation_applier.apply(observations)
    deduped = self.deduplication_service.deduplicate(transformed)
    return deduped
```

Error handling is probably delegated to the individual services, with the executor propagating exceptions upward so that the **PipelineCoordinator** can decide whether to retry, abort, or mark the step as failed.  Logging and metrics (e.g., count of processed entities, transformation latency, deduplication rate) are expected to be emitted at each stage, although the observations do not explicitly mention them.

---

## Integration Points  

* **Parent – Pipeline**: The **StepExecutor** is instantiated and managed by the **Pipeline** component.  The pipeline’s DAG resolver guarantees that the executor runs only after all prerequisite steps have completed, and the coordinator supplies the input entity batch that originates from upstream step outputs or external sources.

* **Sibling – DAGDependencyResolver & PipelineConfigParser**: These siblings operate at configuration time.  The **PipelineConfigParser** reads `pipeline-config.yaml` and produces a model that includes each step’s transformation definition and deduplication settings.  The **DAGDependencyResolver** then builds the execution order.  The **StepExecutor** consumes the resolved configuration (e.g., transformation rules) when it constructs its **TransformationApplier** and **DeduplicationService** instances.

* **Child – Service Collaborators**: The three internal services (EntityProcessor, TransformationApplier, DeduplicationService) are the direct children of the executor.  They expose well‑defined interfaces that the executor calls in sequence.  If a new capability (e.g., validation, enrichment) is required, a new service can be added as another child without altering the executor’s core flow.

* **External – Knowledge‑Graph Layer**: The mention of “KG operators” indicates a dependency on a knowledge‑graph subsystem.  The **TransformationApplier** likely imports a KG client or library, making the executor indirectly dependent on that external component.

---

## Usage Guidelines  

1. **Declare Transformations Clearly** – Because the **TransformationApplier** consumes definitions from the pipeline YAML, step authors should keep transformation specifications explicit, versioned, and validated by the **PipelineConfigParser**.  Ambiguous or overly complex transformation DSL fragments can increase execution latency and make debugging harder.

2. **Configure Deduplication Thoughtfully** – The **DeduplicationService** relies on keys or similarity thresholds defined per step.  Selecting identifiers that are stable across transformations (e.g., a canonical URI) prevents accidental removal of distinct entities.  Over‑aggressive deduplication may hide legitimate duplicates that need separate handling downstream.

3. **Handle Errors at Service Level** – Each collaborator should raise domain‑specific exceptions (e.g., `ProcessingError`, `TransformationError`, `DeduplicationError`).  The **StepExecutor** should catch these, log contextual information (step name, entity IDs), and re‑throw or return a failure status so the **PipelineCoordinator** can decide on retries or aborts.

4. **Monitor Performance Metrics** – Instrument the executor to emit counts of input entities, observations created, transformations applied, and duplicates removed.  These metrics help identify bottlenecks (e.g., a transformation that is computationally heavy) and guide scaling decisions.

5. **Keep Services Stateless When Possible** – Stateless implementations of EntityProcessor, TransformationApplier, and DeduplicationService simplify parallel execution of multiple **StepExecutor** instances, especially when the pipeline is scaled horizontally.

---

### Architectural Patterns Identified  

1. **Composition / Facade** – The executor composes three focused services and presents a single “execute” façade.  
2. **DAG‑Based Orchestration** – Execution order is driven by a directed acyclic graph derived from `pipeline-config.yaml`.  
3. **Service‑Oriented Internal Design** – Each concern (processing, transformation, deduplication) is isolated in its own service.

### Design Decisions and Trade‑offs  

* **Sequential Service Pipeline** – Processing, transformation, and deduplication are performed in a fixed sequence.  This simplifies reasoning and debugging but may limit parallelism; if a transformation is independent of deduplication, a more pipelined or concurrent design could improve throughput.  
* **Explicit Configuration‑Driven Transformations** – Storing transformation logic in YAML makes pipelines declarative and versionable, but it couples the executor tightly to the configuration parser; any change in the DSL requires updates across parser, resolver, and executor.  
* **Deduplication After Transformation** – Placing deduplication downstream ensures that duplicates are identified on enriched data, reducing false negatives.  The trade‑off is that duplicate detection may be more computationally expensive because transformed entities are larger.

### System Structure Insights  

* The **Pipeline** acts as the root orchestrator, with **StepExecutor** as a leaf node that performs concrete work.  
* Sibling components (**DAGDependencyResolver**, **PipelineConfigParser**) operate at pipeline‑initialisation time, feeding static metadata into the executor.  
* The executor’s child services are interchangeable; swapping an **EntityProcessor** for a different parser does not affect the transformation or deduplication stages.

### Scalability Considerations  

* Because each **StepExecutor** processes a batch of entities independently, the system can scale horizontally by running multiple executor instances in parallel, provided the underlying services are stateless or use distributed state (e.g., a shared deduplication cache).  
* The knowledge‑graph operators used by **TransformationApplier** may become a bottleneck if they involve remote graph queries; caching frequently accessed sub‑graphs or pre‑computing materialised views can mitigate latency.  
* Deduplication complexity is typically O(N) with hash‑based approaches, but if fuzzy matching is used, the cost can rise to O(N²).  Configuring deterministic keys or limiting similarity windows helps keep the operation scalable.

### Maintainability Assessment  

The clear separation of concerns—processing, transformation, deduplication—makes the **StepExecutor** highly maintainable.  Adding a new capability (e.g., validation) can be achieved by introducing another service without altering existing logic.  However, the heavy reliance on configuration files means that changes to the transformation DSL or deduplication rules must be propagated through the **PipelineConfigParser** and possibly the **DAGDependencyResolver**, requiring coordinated updates and comprehensive integration tests.  Overall, the architecture promotes readability and modular testing, but disciplined governance of the YAML schema and service contracts is essential to avoid hidden coupling.

## Hierarchy Context

### Parent
- [Pipeline](./Pipeline.md) -- PipelineCoordinator uses a DAG-based execution model with topological sort in pipeline-config.yaml steps, each step declaring explicit depends_on edges

### Siblings
- [DAGDependencyResolver](./DAGDependencyResolver.md) -- The pipeline-config.yaml file defines the steps and their dependencies, which are then resolved by the DAGDependencyResolver
- [PipelineConfigParser](./PipelineConfigParser.md) -- The pipeline-config.yaml file is parsed by the PipelineConfigParser, which extracts the steps and their dependencies

---

*Generated from 3 observations*
