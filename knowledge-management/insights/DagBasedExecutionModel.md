# DagBasedExecutionModel

**Type:** Detail

The topological sort algorithm is used to order the steps in the pipeline, ensuring that steps with dependencies are executed after their dependencies have been met.

## What It Is  

The **DagBasedExecutionModel** lives at the heart of the pipeline execution stack and is materialised through the **`pipeline-configuration.yaml`** file. This YAML document enumerates every step of a pipeline together with an explicit **`depends_on`** list that describes the directed edges of the execution graph. When the **`PipelineController`** is instantiated, it reads this configuration, builds an in‑memory directed‑acyclic graph (DAG), and then applies a **topological sort** to produce a linearised ordering that respects all declared dependencies. Because the underlying structure is a DAG, the model can identify groups of steps that have no mutual dependencies and schedule them for parallel execution, thereby improving overall throughput.

In practice, the **DagBasedExecutionModel** is not a separate class file but a conceptual execution engine embedded inside the pipeline runtime. Its behaviour is driven entirely by the declarative specification found in **`pipeline-configuration.yaml`**, making the model both data‑driven and highly configurable without code changes. The model’s primary responsibility is to guarantee that every step runs **after** all of its `depends_on` ancestors have completed, while also exploiting concurrency where the graph permits.

---

## Architecture and Design  

The architecture follows a **declarative DAG‑driven execution pattern**. The **`PipelineController`** acts as the orchestrator: it parses **`pipeline-configuration.yaml`**, constructs a directed graph where nodes represent pipeline steps and edges represent the `depends_on` relationships, and then invokes a **topological sort algorithm** to derive a safe execution order. This algorithm is the classic depth‑first or Kahn’s algorithm implementation that ensures no step is scheduled before its prerequisites.

Parallelism is introduced implicitly by the DAG: after the topological sort, the controller can group together steps that share the same “layer” (i.e., have no inter‑dependencies) and dispatch them to worker threads or processes. This design avoids an explicit “parallel executor” component; instead, parallelism emerges from the graph topology itself. The only explicit design pattern visible from the observations is the **configuration‑driven orchestration** pattern, where runtime behaviour is dictated by external YAML rather than hard‑coded logic.

Interaction between components is straightforward: the **`PipelineController`** reads the configuration, builds the graph, runs the sort, and then hands off each step (or batch of parallel steps) to the underlying execution engine (e.g., a step runner). Because the model is purely based on the DAG, any new step can be added simply by appending a node in **`pipeline-configuration.yaml`** with appropriate `depends_on` edges, without touching the controller code.

---

## Implementation Details  

1. **Configuration Parsing** – The entry point is the **`pipeline-configuration.yaml`** file located in the pipeline’s root directory. This file contains a list of step definitions, each with a unique identifier and a `depends_on` array that enumerates the identifiers of prerequisite steps. The parser materialises these definitions into a collection of **Step** objects (the exact class name is not specified in the observations, but the concept is clear).

2. **Graph Construction** – Using the parsed step objects, the controller constructs an in‑memory DAG. Each step becomes a node; for every identifier listed in a step’s `depends_on`, a directed edge is added from the prerequisite node to the current node. The graph is validated to ensure it remains acyclic; any cycle detection would raise a configuration error before execution proceeds.

3. **Topological Sort** – The controller invokes a **topological sort algorithm** (commonly Kahn’s algorithm) on the DAG. This algorithm repeatedly selects nodes with zero incoming edges, emits them into an ordered list, and removes their outgoing edges, guaranteeing that each emitted step has all its dependencies satisfied. The resulting list is the canonical execution sequence.

4. **Parallel Execution Planning** – After sorting, the controller analyses the sorted list to identify contiguous groups of steps that have no inter‑dependencies (i.e., they were all eligible at the same iteration of the sort). These groups are scheduled concurrently. The exact mechanism (thread pool, async tasks, external job scheduler) is not detailed in the observations, but the design leverages the DAG’s inherent parallelism.

5. **Step Execution** – Each step, once scheduled, is handed to the underlying step executor. The executor is responsible for the actual work (e.g., data transformation, model training). The DagBasedExecutionModel does not dictate the internals of the step; it only guarantees ordering and concurrency constraints.

---

## Integration Points  

The **DagBasedExecutionModel** is tightly coupled with the **`Pipeline`** component, specifically the **`PipelineController`**, which acts as the bridge between configuration and execution. The controller reads **`pipeline-configuration.yaml`**, builds the DAG, and orchestrates step execution, making it the primary integration surface. Downstream, the model hands off each step to the **step runner** (not named in the observations) that performs the actual business logic. Upstream, any tool that generates or modifies **`pipeline-configuration.yaml`**—such as CI pipelines, UI editors, or automated workflow generators—directly influences the DAG structure and therefore the execution behaviour.

Because the model is configuration‑driven, external systems can influence execution simply by altering the YAML file. This creates a clear contract: the only required interface is the YAML schema (step identifiers and `depends_on` arrays). No code‑level API is exposed, which simplifies integration but also means that validation and error handling must be robust within the controller.

---

## Usage Guidelines  

1. **Declare Explicit Dependencies** – Every step in **`pipeline-configuration.yaml`** should list all direct prerequisites in its `depends_on` field. Omitting a required dependency can lead to race conditions, while over‑specifying dependencies can unnecessarily serialize the pipeline and reduce parallelism.

2. **Maintain Acyclic Structure** – The DAG must remain acyclic. Introducing circular dependencies will cause the topological sort to fail and the pipeline to abort during validation. Use tooling or linting scripts to detect cycles early.

3. **Leverage Parallelism** – To maximise performance, design the pipeline so that independent steps are placed in separate branches of the DAG. The controller will automatically schedule these branches in parallel, exploiting available CPU cores or distributed resources.

4. **Version Control the YAML** – Since the execution model is entirely driven by **`pipeline-configuration.yaml`**, treat this file as part of the source code. Changes to step ordering or dependencies should be reviewed and tested to avoid unintended execution order changes.

5. **Monitor Execution Order** – When debugging, inspect the order produced by the topological sort (often logged by the controller). This helps verify that the declared dependencies are being honoured and that parallel groups are formed as expected.

---

### Summary of Insights  

1. **Architectural patterns identified** – Declarative DAG‑driven orchestration, configuration‑driven execution, implicit parallelism via topological sorting.  
2. **Design decisions and trade‑offs** – Using a YAML‑defined DAG makes the pipeline highly configurable and easy to extend, but it places the burden of correct dependency declaration on the author and requires cycle detection logic. Parallelism is gained without a dedicated scheduler, at the cost of potentially complex dependency graphs.  
3. **System structure insights** – The **`PipelineController`** is the sole orchestrator, converting static configuration into a runtime graph, applying a deterministic topological sort, and delegating actual work to step executors. The model’s simplicity stems from a single source of truth (the YAML file).  
4. **Scalability considerations** – Because independent steps are automatically grouped for concurrent execution, the model scales with the number of CPU cores or distributed workers available. The primary scalability bottleneck is the size of the DAG and the overhead of graph construction and sorting, both of which are linear in the number of steps and edges.  
5. **Maintainability assessment** – High maintainability: adding or re‑ordering steps requires only YAML edits, no code changes. However, maintainability depends on clear documentation of each step’s purpose and its dependencies, and on tooling to validate the DAG’s acyclicity and correctness.


## Hierarchy Context

### Parent
- [Pipeline](./Pipeline.md) -- PipelineController uses a DAG-based execution model with topological sort in pipeline-configuration.yaml steps, each step declaring explicit depends_on edges


---

*Generated from 3 observations*
