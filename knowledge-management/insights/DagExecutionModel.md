# DagExecutionModel

**Type:** Detail

The depends_on edges in the batch-analysis.yaml file explicitly declare the dependencies between steps, allowing for flexible and dynamic pipeline configuration

## What It Is  

`DagExecutionModel` is the execution engine that drives a Pipeline’s step‑wise processing by interpreting a **declarative YAML definition**. The concrete definition lives in **`batch‑analysis.yaml`**, where each pipeline step is listed together with a `depends_on` collection that explicitly declares its predecessor(s). At runtime the **`PipelineAgent`** reads this file, builds an in‑memory directed‑acyclic graph (DAG) from the declared edges, and applies a **topological‑sort algorithm** to produce a linearised order that respects every dependency. The sorted sequence is then handed to the Pipeline’s orchestrator so that each step can be executed in the correct order. In the broader component hierarchy, `DagExecutionModel` is owned by the **`Pipeline`** component, sitting alongside sibling stages such as **`EntityProcessingStage`** (via its `EntityProcessor`) and **`PipelineMonitoringSystem`**.

---

## Architecture and Design  

The design follows a **configuration‑driven DAG execution pattern**. Rather than hard‑coding the step order in code, the system externalises the workflow into `batch‑analysis.yaml`. This yields two clear separations of concern:

1. **Definition Layer** – The YAML file is the sole source of truth for step names and their dependency relationships (`depends_on`). This makes the pipeline definition **flexible** and **dynamic**; altering the workflow only requires editing the YAML, not recompiling code.  

2. **Execution Layer** – `PipelineAgent` embodies the **DAG orchestration** logic. By reading the YAML, it constructs a graph data structure where vertices are steps and directed edges are the `depends_on` relationships. The agent then runs a **topological sort** to produce a deterministic, dependency‑aware execution list. This algorithmic choice guarantees that no step is started before all its prerequisites have completed, while also detecting cycles early (a cycle would break the topological sort and can be surfaced as a configuration error).

The architecture therefore leverages **declarative configuration** combined with a classic **graph‑algorithm** (topological sorting) to achieve correct ordering. The `Pipeline` component acts as the container, exposing `DagExecutionModel` to its sibling stages. Because the DAG is built at runtime, the same execution engine can be reused for multiple pipelines simply by swapping the YAML file, reinforcing **reusability** across the system.

---

## Implementation Details  

1. **YAML Specification (`batch‑analysis.yaml`)** – Each entry defines a step identifier and an optional `depends_on` array. Example (illustrative, not in the source):  
   ```yaml
   steps:
     - name: ingest
     - name: cleanse
       depends_on: [ingest]
     - name: enrich
       depends_on: [cleanse]
   ```  
   The explicit `depends_on` edges give the system enough information to construct a directed graph without additional metadata.

2. **Graph Construction** – `PipelineAgent` parses the file, iterates over the `steps` collection, and creates a node object for each step. For every `depends_on` entry it adds a directed edge from the prerequisite node to the dependent node. The resulting structure is a classic adjacency list representation suitable for graph traversals.

3. **Topological Sort** – Once the graph is built, `PipelineAgent` runs a topological sort (typically Kahn’s algorithm or a depth‑first post‑order). The algorithm processes nodes with zero incoming edges first, removes them, and repeats until all nodes are ordered. If at any point no node with zero indegree exists while unprocessed nodes remain, a **cycle detection** path is triggered, and the agent reports a configuration error back to the Pipeline.

4. **Execution Dispatch** – The sorted list is handed to the Pipeline’s runner. Each step is invoked in order; because the ordering already respects dependencies, the runner can execute steps sequentially or, where the DAG permits parallelism, concurrently (the current observations do not detail parallel execution, but the DAG representation makes it possible).

5. **Integration with Siblings** – While `DagExecutionModel` focuses on ordering, the actual work of each step is often performed by components such as the **`EntityProcessor`** in the `EntityProcessingStage`. The `PipelineMonitoringSystem` can hook into the DAG execution lifecycle (e.g., start/end events for each step) to emit metrics or alerts, though the exact interfaces are not described in the observations.

---

## Integration Points  

- **Parent (`Pipeline`)** – The Pipeline owns an instance of `DagExecutionModel`. When a Pipeline is instantiated, it supplies the path to the relevant `batch‑analysis.yaml` file, allowing the model to load the appropriate DAG. The Pipeline also receives the ordered step list from the model and orchestrates the actual execution of each step, often delegating to stage‑specific services (e.g., `EntityProcessor`).  

- **Sibling (`EntityProcessingStage`)** – Steps defined in the DAG may correspond to processing tasks performed by the `EntityProcessor`. The DAG merely dictates *when* each processing stage should run; the actual logic resides in the sibling component.  

- **Sibling (`PipelineMonitoringSystem`)** – Because the DAG execution is a critical control flow, the monitoring system can subscribe to events emitted by `PipelineAgent` (such as “step‑started”, “step‑completed”, “graph‑error”). This enables real‑time visibility and alerting without altering the DAG logic.  

- **Configuration Layer** – The only external artifact required by `DagExecutionModel` is the YAML file. Any system that wishes to introduce a new pipeline simply adds a new YAML definition and points the Pipeline to it, without touching code.

---

## Usage Guidelines  

1. **Define Clear Dependencies** – When adding a step to `batch‑analysis.yaml`, always specify its `depends_on` array to reflect true data or control dependencies. Omitting required dependencies can lead to out‑of‑order execution, while adding unnecessary ones can unnecessarily serialize the pipeline.  

2. **Avoid Cycles** – The topological sort will fail if the graph contains cycles. Validate new YAML definitions with a linting tool or a pre‑deployment test that runs the sort and reports errors before the pipeline is deployed.  

3. **Leverage Parallelism When Possible** – Although the current implementation orders steps linearly, the underlying DAG can be analysed for independent branches. If performance is a concern, consider extending the execution engine to launch non‑dependent steps concurrently, keeping the same `depends_on` semantics.  

4. **Keep the YAML Small and Modular** – For very large pipelines, consider splitting the definition into multiple included YAML files (if the system supports includes) to improve readability and maintainability.  

5. **Monitor Execution** – Integrate the `PipelineMonitoringSystem` to capture step‑level metrics. Because the DAG execution engine emits deterministic ordering, monitoring can reliably correlate timestamps with specific steps.  

---

### Summary of Key Insights  

| Aspect | Insight |
|--------|---------|
| **Architectural patterns identified** | Declarative configuration (YAML‑driven DAG), Graph‑based orchestration (topological sort), Separation of concerns between definition and execution. |
| **Design decisions and trade‑offs** | *Decision*: Use `depends_on` edges for explicit dependency declaration → *Benefit*: Flexibility and clear ordering; *Trade‑off*: Runtime cost of graph construction and sorting, need for cycle validation. |
| **System structure insights** | `Pipeline` → owns `DagExecutionModel` (reads `batch‑analysis.yaml`, builds graph, sorts) → supplies ordered steps to execution runtime; siblings (`EntityProcessingStage`, `PipelineMonitoringSystem`) consume the ordered steps or monitor them. |
| **Scalability considerations** | Adding steps is linear in effort; topological sort scales O(V + E). The DAG representation naturally supports parallel execution of independent branches, offering a path to scale horizontally as step count grows. |
| **Maintainability assessment** | High maintainability due to externalised YAML; changes to workflow do not require code changes. Risks include configuration drift and hidden cycles; mitigated by validation tooling and clear documentation of each step’s purpose. |

By grounding the execution model in a simple yet powerful DAG built from `batch‑analysis.yaml`, the system achieves a balance between **flexibility**, **correctness**, and **future extensibility**, while keeping the implementation straightforward enough for developers to reason about, modify, and monitor.


## Hierarchy Context

### Parent
- [Pipeline](./Pipeline.md) -- PipelineAgent uses a DAG-based execution model with topological sort in batch-analysis.yaml steps, each step declaring explicit depends_on edges

### Siblings
- [EntityProcessingStage](./EntityProcessingStage.md) -- The EntityProcessor is responsible for processing individual entities within the pipeline, and is a key component of the EntityProcessingStage
- [PipelineMonitoringSystem](./PipelineMonitoringSystem.md) -- The PipelineMonitoringSystem is likely to be implemented using a logging framework or monitoring tool, such as a metrics dashboard or alerting system


---

*Generated from 3 observations*
