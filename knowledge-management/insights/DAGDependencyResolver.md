# DAGDependencyResolver

**Type:** Detail

The ConcurrentExecutor class uses the resolved dependencies to execute pipeline steps concurrently, ensuring that steps with unmet dependencies are not executed prematurely

## What It Is  

`DAGDependencyResolver` lives inside the **Pipeline** component – the core orchestrator that drives a data‑processing workflow. The resolver is fed the declarative **pipeline‑configuration.json** file (typically found in the repository’s `config/` or project root) where each step lists a `depends_on` array that defines explicit DAG edges. The resolver’s sole responsibility is to turn those declarations into a concrete execution order that respects the directed‑acyclic‑graph (DAG) semantics. It does **not** read the JSON itself; that work belongs to its sibling, the **PipelineConfigurator**, which parses the file and builds the initial graph that the resolver then topologically sorts.

The resolved ordering is subsequently handed to the **ConcurrentExecutor**, which schedules the ready‑to‑run steps on a thread‑pool. In this way, `DAGDependencyResolver` acts as the logical “brain” that guarantees no step is launched before all of its predecessor steps have completed, while still allowing maximum parallelism for independent branches of the pipeline.

---

## Architecture and Design  

The architecture follows a **pipeline‑centric, DAG‑driven orchestration model**. The high‑level flow is:

1. **PipelineConfigurator** reads `pipeline‑configuration.json` and creates an in‑memory representation of the steps and their `depends_on` relationships.  
2. **DAGDependencyResolver** receives that representation and applies a **topological sort** to produce a linearised execution plan that respects the DAG constraints.  
3. **ConcurrentExecutor** consumes the plan, uses a **thread‑pool** (a classic concurrency pattern) to run steps whose dependencies are already satisfied, and monitors completion to unlock downstream steps.

The design can be described as a **separation‑of‑concerns** pattern:

- **Parsing & graph construction** – PipelineConfigurator  
- **Dependency analysis & ordering** – DAGDependencyResolver  
- **Parallel execution** – ConcurrentExecutor  

Each component communicates through well‑defined data structures (the dependency graph and the ordered step list). The parent **PipelineCoordinator** orchestrates the sequence: it invokes the configurator, passes the graph to the resolver, and finally hands the resolved order to the executor. Because the resolver does not embed any execution logic, it can be swapped or extended without touching the executor or configurator, illustrating a **plug‑in style** modularity.

---

## Implementation Details  

### Graph Construction (PipelineConfigurator)  
The configurator parses `pipeline‑configuration.json`, which contains entries such as:

```json
{
  "steps": [
    { "name": "extract", "depends_on": [] },
    { "name": "transform", "depends_on": ["extract"] },
    { "name": "load", "depends_on": ["transform"] }
  ]
}
```

For each step it creates a node object (e.g., `PipelineStep`) and registers outgoing edges based on the `depends_on` array. The resulting structure is a classic adjacency‑list representation of a directed graph.

### Dependency Resolution (DAGDependencyResolver)  
`DAGDependencyResolver` receives the adjacency list and performs a **topological sort** (Kahn’s algorithm is a common choice). The algorithm works by:

1. Identifying nodes with zero inbound edges (no unmet dependencies).  
2. Emitting those nodes into the execution order list.  
3. Removing emitted nodes and their outgoing edges, then repeating until the graph is empty.  

If a cycle is detected (i.e., the graph cannot be emptied), the resolver raises an error, preventing the pipeline from entering an undefined state. The resolved order is typically a simple list of step identifiers that the executor can iterate over.

### Concurrent Execution (ConcurrentExecutor)  
The executor owns a **thread pool** (e.g., `java.util.concurrent.ExecutorService` or Python’s `concurrent.futures.ThreadPoolExecutor`). It tracks the dependency state of each step:

- When a step’s dependencies are all marked *completed*, the executor submits the step’s runnable to the pool.  
- Upon step completion, callbacks decrement dependency counters for downstream steps, potentially making them eligible for execution.  

This approach guarantees that steps are never started prematurely while still exploiting parallelism for branches that have no mutual dependencies.

---

## Integration Points  

- **Parent** – `PipelineCoordinator` is the orchestrator that wires the three siblings together. It first calls `PipelineConfigurator.configurePipeline(pipeline-configuration.json)` to obtain the raw graph, then invokes `DAGDependencyResolver.resolve(graph)` to get the ordered list, and finally passes that list to `ConcurrentExecutor.execute(order)`.  
- **Sibling – PipelineConfigurator** – Supplies the initial graph; any change in JSON schema directly impacts the configurator but not the resolver.  
- **Sibling – ConcurrentExecutor** – Consumes the resolver’s output; the executor expects a deterministic ordering that respects dependencies, and it provides the runtime environment (thread pool, logging, error handling).  
- **External Interfaces** – The resolver does not depend on I/O; it only requires an in‑memory graph object. This makes it easy to unit‑test by feeding synthetic graphs.  
- **Data Flow** – `pipeline-configuration.json` → `PipelineConfigurator` → *graph* → `DAGDependencyResolver` → *ordered list* → `ConcurrentExecutor` → *runtime steps*.

---

## Usage Guidelines  

1. **Keep the JSON declarative** – Only list direct dependencies in `depends_on`. Avoid implicit ordering; let the resolver compute the correct sequence.  
2. **Validate the configuration early** – Run `PipelineConfigurator` in a validation mode (if available) to catch malformed JSON or missing step definitions before the resolver is invoked.  
3. **Do not embed execution logic in the resolver** – All side‑effects (I/O, network calls, database writes) must live in the step implementations executed by `ConcurrentExecutor`. The resolver should remain pure‑function‑like for predictability and testability.  
4. **Respect thread‑safety** – Steps executed concurrently must be thread‑safe. The executor assumes independent steps can run in parallel; shared mutable state must be protected or avoided.  
5. **Handle cycles gracefully** – If a cycle is detected, the resolver will raise an exception. Catch this at the pipeline startup phase and surface a clear error message indicating the offending steps.  
6. **Extensibility** – To add new step types, only modify `pipeline-configuration.json` and ensure the configurator can map the new type to a `PipelineStep` implementation. The resolver and executor require no changes.

---

### 1. Architectural patterns identified  
- **Separation‑of‑Concerns** (parsing, dependency analysis, execution)  
- **Topological Sort** for DAG ordering (algorithmic pattern)  
- **Thread‑Pool / Worker‑Pool** concurrency pattern  

### 2. Design decisions and trade‑offs  
- **Pure resolver** vs. embedding execution logic – improves testability and modularity but requires a disciplined hand‑off to the executor.  
- **Explicit `depends_on` edges** – makes the DAG visible and editable, at the cost of requiring authors to maintain correct dependency lists.  
- **Concurrent execution** – gains performance on independent branches, but introduces the need for thread‑safe step implementations and careful error propagation.  

### 3. System structure insights  
The pipeline is a three‑layer stack under the **Pipeline** parent:  
1. **Configuration layer** (`pipeline-configuration.json` + `PipelineConfigurator`)  
2. **Resolution layer** (`DAGDependencyResolver`)  
3. **Execution layer** (`ConcurrentExecutor`)  

Each layer passes a well‑defined artifact to the next, enabling clear boundaries and easier unit testing.

### 4. Scalability considerations  
- **Graph size** – Topological sort runs in O(V + E) time, so the resolver scales linearly with the number of steps and dependencies.  
- **Parallelism** – The thread‑pool size can be tuned to the underlying hardware; independent sub‑graphs execute concurrently, allowing the pipeline to scale with CPU cores.  
- **Memory footprint** – The in‑memory adjacency list grows with the number of steps; for extremely large pipelines, a streaming or lazy graph representation could be introduced without altering the resolver’s contract.  

### 5. Maintainability assessment  
Because `DAGDependencyResolver` is isolated from I/O and execution concerns, it is highly maintainable: changes to the JSON schema only affect the configurator, and new concurrency strategies only impact the executor. The clear contract (input graph → ordered list) encourages comprehensive unit tests and makes the component resilient to future refactoring. The only maintenance burden is ensuring that step authors correctly declare dependencies, which can be mitigated with schema validation tools.


## Hierarchy Context

### Parent
- [Pipeline](./Pipeline.md) -- PipelineCoordinator uses a DAG-based execution model with topological sort in pipeline-configuration.json steps, each step declaring explicit depends_on edges

### Siblings
- [PipelineConfigurator](./PipelineConfigurator.md) -- The PipelineConfigurator class has a method called configurePipeline that takes the pipeline-configuration.json file as input and returns a configured pipeline graph
- [ConcurrentExecutor](./ConcurrentExecutor.md) -- The ConcurrentExecutor class uses a thread pool to execute pipeline steps concurrently, with each thread executing a separate step


---

*Generated from 3 observations*
