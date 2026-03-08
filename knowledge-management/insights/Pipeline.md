# Pipeline

**Type:** SubComponent

The batch processing pipeline is defined in the batch-analysis.yaml file, which declares the steps and their dependencies using the depends_on edges.

## What It Is  

The **Pipeline** sub‑component lives in the batch‑analysis portion of the code base and is orchestrated from the file **`batch-analysis.yaml`**. This YAML manifest declares each processing step and the explicit `depends_on` edges that form a directed‑acyclic graph (DAG). At runtime the **`PipelineAgent`** class (found in **`pipeline-agent.ts`**) reads this manifest and drives execution by performing a topological sort over the DAG. The pipeline’s purpose is to take raw input data, turn it into structured observations, enrich those observations with knowledge‑graph operations, de‑duplicate the result set, and finally persist the clean observations for downstream analysis. The concrete processing stages are implemented by the following classes:

* **`ObservationGeneration`** – `observation-generation.ts`  
* **`KGOperator`** – `kg-operator.ts`  
* **`Deduplication`** – `deduplication.ts`  
* **`PersistenceAgent`** – `persistence-agent.ts`  

Together they form a linear‑ish but dependency‑aware batch workflow that feeds the higher‑level **SemanticAnalysis** component (its parent) with ready‑to‑use observations.

---

## Architecture and Design  

The architecture follows a **pipeline‑oriented, DAG‑driven execution model**. The manifest (`batch-analysis.yaml`) is the single source of truth for step ordering, allowing the pipeline to be re‑configured without code changes. The **`PipelineAgent`** embodies the **Pipeline pattern**: it interprets the manifest, constructs an in‑memory DAG, and executes each node once all its predecessor nodes have completed. The topological sort guarantees that cyclic dependencies are impossible, which is a deliberate design decision to keep the execution model deterministic and safe for batch jobs.

Each processing stage is encapsulated in its own class, reflecting a **separation‑of‑concerns** design. `ObservationGeneration` focuses solely on translating raw input into observation objects based on the ontology definitions, while `KGOperator` applies knowledge‑graph transformations (e.g., linking, inference) to those observations. `Deduplication` removes redundant entries, and `PersistenceAgent` writes the final payload into a shared memory store used by other components such as **InsightGenerator** (a sibling under the *Insights* component). This modular decomposition enables independent evolution of each stage and simplifies testing.

Interaction between components is explicit and interface‑driven: each class exposes a method (e.g., `process()`) that accepts and returns a typed collection of observations. The pipeline glue code in `pipeline-agent.ts` invokes these methods in the order dictated by the DAG. Because the pipeline is defined declaratively, adding a new step (for example, a future **Enrichment** stage) only requires updating the YAML file and providing a corresponding implementation class—no changes to the core agent logic are needed.

---

## Implementation Details  

**`batch-analysis.yaml`** – The YAML file lists steps such as `observation_generation`, `kg_operator`, `deduplication`, and `persistence`. Each entry contains a `depends_on` array that the **`PipelineAgent`** parses to build adjacency lists for the DAG. Example fragment:

```yaml
steps:
  observation_generation:
    depends_on: []
  kg_operator:
    depends_on: [observation_generation]
  deduplication:
    depends_on: [kg_operator]
  persistence:
    depends_on: [deduplication]
```

**`pipeline-agent.ts`** – The `PipelineAgent` class reads the manifest, validates that the graph is acyclic, and then performs a topological sort (e.g., Kahn’s algorithm). It stores a mapping from step names to the concrete class constructors (`ObservationGeneration`, `KGOperator`, etc.). During execution it iterates over the sorted list, instantiating each class (or re‑using a singleton if appropriate) and invoking its `process(observations)` method, passing forward the observation collection produced by the previous step.

**`observation-generation.ts`** – `ObservationGeneration` consumes raw input payloads and leverages the ontology definitions supplied by the **Ontology** sibling (`OntologyDefinition` class). It creates observation objects that embed semantic tags derived from the upper and lower ontology layers. The class is deliberately stateless, making it easy to run in parallel if the upstream data source is sharded.

**`kg-operator.ts`** – `KGOperator` receives the observations and applies knowledge‑graph operations such as entity linking, relationship inference, and property propagation. It interacts with the knowledge‑graph layer (not detailed in the observations) through a well‑defined API, ensuring that graph mutations remain isolated from the rest of the pipeline.

**`deduplication.ts`** – `Deduplication` implements a deterministic duplicate‑removal algorithm, typically based on a hash of the observation’s canonical representation. By performing this step before persistence, the pipeline avoids unnecessary storage bloat and downstream re‑processing.

**`persistence-agent.ts`** – `PersistenceAgent` writes the final, deduplicated observation set into a shared memory store that is later consumed by the **SemanticAnalysis** component and the **InsightGenerator** sibling. The persistence logic abstracts the underlying storage mechanism (e.g., in‑memory cache, Redis, or a file‑based store) behind a simple `save(observations)` method.

All classes follow a **single‑responsibility** principle, expose clear input/output contracts, and are deliberately lightweight to keep the batch job’s memory footprint modest.

---

## Integration Points  

The **Pipeline** sub‑component sits directly under **SemanticAnalysis**. The **OntologyClassificationAgent** (found in `integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts`) supplies the ontology configuration that `ObservationGeneration` consumes, establishing a tight coupling between the ontology definitions and the observation creation step. Configuration data is loaded by the sibling **ConfigurationManagement** component via `ConfigurationLoader` (`configuration-loader.ts`), which the pipeline agents use to obtain runtime parameters such as batch size, retry limits, or external service endpoints.

After the pipeline finishes, the persisted observations become the input for the **Insights** sibling, specifically the `InsightGenerator` class (`insight-generator.ts`). This downstream consumer reads from the same shared memory store that `PersistenceAgent` writes to, enabling a clean hand‑off without additional transformation layers.

The **LLMIntegration** sibling (`LLMClient` in `llm-client.ts`) does not directly participate in the batch pipeline, but the observations produced by the pipeline can be fed into language‑model prompts for higher‑level reasoning, illustrating a potential extension point.

Overall, the pipeline’s dependencies are limited to configuration loading, ontology definitions, and the shared memory abstraction, keeping its external surface area small and well‑defined.

---

## Usage Guidelines  

1. **Declare Steps Declaratively** – Always add, remove, or reorder processing stages by editing `batch-analysis.yaml`. Ensure that each new step’s `depends_on` list accurately reflects its true data dependencies; the DAG validation in `PipelineAgent` will reject cycles or missing references.

2. **Stateless Stage Implementations** – Implement new stage classes as pure functions of their input observations. Avoid retaining mutable global state; this preserves the ability of `PipelineAgent` to instantiate stages on demand and facilitates parallel execution in the future.

3. **Leverage ConfigurationLoader** – Retrieve any runtime parameters (e.g., thresholds, external service URLs) through the `ConfigurationLoader` API rather than hard‑coding values. This keeps the pipeline flexible across environments and aligns with the configuration‑centric approach used by the parent **SemanticAnalysis** component.

4. **Respect Ontology Contracts** – When extending `ObservationGeneration`, use the ontology structures defined by `OntologyDefinition`. Changing the ontology schema without updating the generation logic will lead to mismatched observations and downstream failures in `KGOperator` or `InsightGenerator`.

5. **Test at the DAG Level** – Unit‑test each stage in isolation, but also include integration tests that load a miniature `batch-analysis.yaml` and run the full `PipelineAgent` to verify that topological ordering and data flow behave as expected.

6. **Monitor Persistence** – Verify that `PersistenceAgent` successfully writes to the shared memory store; any failure here will block downstream Insight generation. Implement retry logic or health checks if the underlying store is external.

Following these conventions ensures that the pipeline remains predictable, extensible, and easy to maintain.

---

### Architectural patterns identified  
* **Pipeline pattern** driven by a declarative DAG manifest.  
* **Topological sort** for deterministic execution order.  
* **Separation of concerns / Single‑responsibility** across stage classes.  

### Design decisions and trade‑offs  
* **Declarative YAML configuration** trades compile‑time safety for runtime flexibility; changes require only manifest edits, but invalid DAGs are only caught at start‑up.  
* **Stateless stage classes** simplify testing and scaling but may require explicit passing of context that could otherwise be shared.  
* **In‑process DAG execution** keeps latency low for batch jobs but does not inherently provide distributed execution; scaling out would need additional orchestration.  

### System structure insights  
The pipeline forms a linear chain of dependent stages under the broader **SemanticAnalysis** hierarchy, with clear upstream (ontology, configuration) and downstream (insight generation) boundaries. Sibling components share common utilities (configuration loader) but remain loosely coupled through well‑defined data contracts (observations).  

### Scalability considerations  
Because each stage processes collections of observations, horizontal scaling can be achieved by sharding the input data and running multiple independent pipeline instances, each with its own DAG execution. The current design does not embed a distributed scheduler, so adding one would be a future enhancement. The DAG‑based ordering guarantees that parallelism respects data dependencies.  

### Maintainability assessment  
The clear separation of responsibilities, minimal coupling to external services, and the use of a single configuration source make the pipeline highly maintainable. Adding new functionality generally requires only a new class and a YAML entry, avoiding modifications to existing logic. The primary maintenance burden lies in keeping the DAG definition accurate and ensuring that ontology changes propagate correctly through `ObservationGeneration`. Regular integration tests that execute the full DAG will catch regressions early.


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- The OntologyClassificationAgent, located in integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts, utilizes a configuration file to initialize the ontology system. This configuration file is crucial for the agent's functionality, as it provides the necessary information for classifying observations against the ontology. The agent's reliance on this configuration file highlights the importance of proper configuration management in the SemanticAnalysis component. Furthermore, the use of a configuration file allows for flexibility and ease of modification, as changes to the ontology system can be made by updating the configuration file without requiring modifications to the agent's code.

### Siblings
- [Ontology](./Ontology.md) -- The OntologyDefinition class in ontology-definition.ts defines the upper and lower ontology structures.
- [Insights](./Insights.md) -- The InsightGenerator class in insight-generator.ts generates insights based on the processed observations.
- [LLMIntegration](./LLMIntegration.md) -- The LLMClient class in llm-client.ts provides a provider-agnostic interface for interacting with language models.
- [ConfigurationManagement](./ConfigurationManagement.md) -- The ConfigurationLoader class in configuration-loader.ts loads the configuration files and provides an interface for accessing the configuration data.


---

*Generated from 6 observations*
