# PipelineStepExecutor

**Type:** Detail

The PipelineStepExecutor would need to use the dependencies resolved by the DAGDependencyResolver to determine the order in which to execute the steps, potentially using a scheduling algorithm like th...

## What It Is  

`PipelineStepExecutor` is the runtime component that actually runs the individual steps that make up a **Pipeline**.  It lives inside the *Pipeline* hierarchy (the parent component) and is invoked by the Pipeline Coordinator after the DAG of steps has been built and topologically sorted.  Although the source repository does not expose a concrete file path for this class, the observations make it clear that the executor is tightly coupled to three other core entities:  

* **DAGDependencyResolver** – supplies the resolved dependency graph that tells the executor the exact order in which steps must run.  
* **DataIngestion** – provides the raw or pre‑processed data that each step consumes, typically via an API call or a direct read from a data‑store.  
* The **Pipeline** container itself – which owns the executor and coordinates its lifecycle.  

In practice, `PipelineStepExecutor` receives a list of steps (already ordered by the DAG resolver), pulls the required inputs from `DataIngestion`, and invokes each step’s business logic while handling any runtime failures.

---

## Architecture and Design  

The architecture around `PipelineStepExecutor` follows a **DAG‑driven execution model**.  The parent `Pipeline` (through its *PipelineCoordinator*) parses a `pipeline-configuration.yaml` file, builds a directed‑acyclic graph of steps, and hands the ordered list to the executor.  This design mirrors the classic *pipeline* pattern where each stage is a node in a DAG and the edges express `depends_on` relationships.  

Two design concepts emerge from the observations:

1. **Scheduling via Critical Path Method (CPM)** – The executor may employ a CPM‑style algorithm to prioritize steps that lie on the longest dependency chain, ensuring that overall latency is minimized.  This is an explicit design hint rather than a hard‑coded implementation, but it suggests the executor is not a naïve linear loop; it can reason about parallelism where the DAG permits it.  

2. **Resilience through Retry/Fallback** – Error handling is baked into the executor.  When a step throws an exception, the executor can either retry the step a configurable number of times or roll back to a previous, known‑good version of the step.  This reflects a *retry* pattern combined with a simple *fallback* strategy, both of which are common in data‑processing pipelines that must tolerate transient failures.

Interaction flow:  

* `PipelineCoordinator` → **DAGDependencyResolver** (produces ordered step list) → **PipelineStepExecutor** (executes steps) → **DataIngestion** (supplies inputs).  

The sibling `PipelineConfigurationParser` feeds the coordinator with the raw YAML configuration, while the resolver translates that configuration into the dependency graph that the executor consumes.  All three siblings share the same *pipeline‑configuration.yaml* contract, reinforcing a cohesive configuration‑driven design.

---

## Implementation Details  

While the source does not expose concrete class definitions, the observations give us enough to infer the internal responsibilities of `PipelineStepExecutor`:

* **Dependency Consumption** – The executor receives the output of `DAGDependencyResolver`, likely as an ordered array or a more expressive graph object.  It iterates over this structure, respecting the topological order or, when parallelism is possible, dispatches independent steps concurrently.  

* **Step Invocation** – For each step, the executor calls into a step‑specific handler (perhaps a function or a class implementing a known interface).  Prior to execution it asks `DataIngestion` for the required datasets.  The data retrieval could be an HTTP request to an internal API or a direct read from a storage system (e.g., a data lake or a relational store).  

* **Error Management** – Execution is wrapped in a try/catch block.  On failure, the executor consults a retry policy (max attempts, back‑off strategy) and may re‑invoke the step.  If retries are exhausted, the executor can either abort the whole pipeline or fall back to a previous version of the step—this fallback mechanism likely involves loading a cached artifact or a version‑controlled implementation.  

* **Scheduling Logic** – The mention of a “critical path method” implies the executor may compute the longest path through the DAG and prioritize those steps, possibly by allocating more resources or by starting them earlier in the schedule.  This would require the executor to annotate each node with estimated execution time or weight, then use that metadata to drive a simple CPM algorithm.

Because no concrete file paths are listed, the implementation likely resides alongside other pipeline orchestration code, perhaps in a directory such as `src/pipeline/executor/` or similar, following the same naming conventions used for `DAGDependencyResolver` and `PipelineConfigurationParser`.

---

## Integration Points  

`PipelineStepExecutor` sits at the heart of the pipeline runtime and connects to several other components:

* **PipelineCoordinator (Parent)** – Calls the executor after the DAG has been resolved.  The coordinator supplies configuration metadata and may listen for execution events (step start, success, failure) emitted by the executor.  

* **DAGDependencyResolver (Sibling)** – Provides the resolved execution order.  The executor does not recompute dependencies; it trusts the resolver’s output, which is derived from the same `pipeline-configuration.yaml` used by `PipelineConfigurationParser`.  

* **DataIngestion (External Service)** – Acts as the data provider.  The executor invokes its API (e.g., `fetchDataset(stepId)`) or reads from a storage bucket before each step runs.  The contract between executor and ingestion layer is likely defined by a simple request/response interface that abstracts away the underlying storage technology.  

* **Step Implementations (Children)** – Each pipeline step may be represented by a class or function that the executor calls.  These step objects are the “children” of the executor in the runtime hierarchy; they implement the actual business logic and expose a uniform `execute(input)` method so the executor can treat them polymorphically.

The integration is configuration‑driven: the YAML file defines step names, dependencies, and possibly the data source identifiers that the executor passes to `DataIngestion`.  This tight coupling to configuration ensures that changes to the pipeline topology do not require code changes in the executor.

---

## Usage Guidelines  

1. **Define Clear Dependencies** – When authoring `pipeline-configuration.yaml`, explicitly list `depends_on` edges for every step.  The executor relies on the DAG produced by `DAGDependencyResolver`; missing or circular dependencies will cause the resolver to fail, halting execution.  

2. **Provide Accurate Data Contracts** – Each step should declare the dataset identifiers it needs.  `DataIngestion` must be able to satisfy those identifiers; otherwise the executor will encounter a data‑fetch error that triggers the retry/fallback logic.  

3. **Configure Retry Policies** – If a step is prone to transient failures (e.g., network calls), set appropriate retry limits and back‑off intervals in the pipeline’s metadata.  Over‑aggressive retries can stall the entire pipeline, while too‑few retries may cause unnecessary aborts.  

4. **Version Steps for Fallback** – When a step’s implementation is updated, retain the previous version as a fallback artifact.  The executor’s fallback mechanism expects a known‑good version to roll back to if the new version repeatedly fails.  

5. **Monitor Critical Path Metrics** – If the executor employs a critical‑path scheduling algorithm, expose step‑level timing metrics.  This allows operators to identify bottlenecks and adjust resource allocation or step ordering in future configurations.  

---

### Architectural patterns identified  
* **DAG‑based execution** (topological sort)  
* **Critical Path Method** for scheduling (optional)  
* **Retry / Fallback** resilience pattern  

### Design decisions and trade‑offs  
* Leveraging a resolved DAG simplifies ordering but requires strict, acyclic configuration.  
* Using CPM can improve overall latency but adds computational overhead and requires accurate step‑duration estimates.  
* Retry/Fallback improves robustness at the cost of increased complexity and potential resource consumption during repeated attempts.  

### System structure insights  
* `Pipeline` (parent) owns the executor and coordinates with sibling components (`DAGDependencyResolver`, `PipelineConfigurationParser`).  
* Executor acts as the runtime engine, delegating data provision to `DataIngestion` and step logic to child step objects.  

### Scalability considerations  
* Parallel execution of independent DAG branches enables horizontal scaling; the executor must manage concurrency (threads, async tasks, or distributed workers).  
* Critical‑path scheduling helps prioritize long‑running branches, reducing makespan in large pipelines.  
* Retry policies should be bounded to avoid runaway resource usage under systemic failures.  

### Maintainability assessment  
* Configuration‑driven design isolates pipeline topology from code, easing updates.  
* Clear separation between dependency resolution, configuration parsing, and execution improves modularity.  
* However, the fallback versioning strategy introduces additional artefact management overhead, and the optional CPM scheduling adds algorithmic complexity that must be documented and tested.  

Overall, `PipelineStepExecutor` embodies a focused, DAG‑oriented execution engine that balances deterministic ordering, resilience, and optional performance optimisation through critical‑path awareness.

## Hierarchy Context

### Parent
- [Pipeline](./Pipeline.md) -- PipelineCoordinator uses a DAG-based execution model with topological sort in pipeline-configuration.yaml steps, each step declaring explicit depends_on edges

### Siblings
- [DAGDependencyResolver](./DAGDependencyResolver.md) -- PipelineCoordinator uses a DAG-based execution model with topological sort in pipeline-configuration.yaml steps, each step declaring explicit depends_on edges, as seen in the parent context
- [PipelineConfigurationParser](./PipelineConfigurationParser.md) -- The PipelineConfigurationParser would need to use a library like yamljs to parse the pipeline-configuration.yaml file, handling errors and exceptions that occur during parsing

---

*Generated from 3 observations*
