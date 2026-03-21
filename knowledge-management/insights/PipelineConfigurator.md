# PipelineConfigurator

**Type:** Detail

The pipeline-configuration.json file contains a list of steps, each with a unique id and a list of dependencies, which are used by the PipelineConfigurator to create the dependency graph

## What It Is  

`PipelineConfigurator` is the component that translates a declarative description of a data‑processing workflow—stored in **`pipeline-configuration.json`**—into an in‑memory, executable pipeline graph. The class lives inside the **Pipeline** subsystem (the parent component) and is invoked by the `Pipeline` object whenever a new pipeline definition must be materialised. Its public contract is the `configurePipeline` method, which accepts the JSON file as input, validates the definition (ensuring each step has a unique identifier and that all declared dependencies exist), and finally produces a graph structure that downstream components such as `DAGDependencyResolver` and `ConcurrentExecutor` can consume.

The JSON configuration is a simple list of step objects, each step exposing an `id` and a `depends_on` array. By keeping the pipeline description external to the code, the system enables non‑developers or automated tools to author, version, and modify pipelines without recompiling. `PipelineConfigurator` therefore acts as the bridge between a static, human‑readable artifact and the dynamic, runtime‑oriented execution engine.

## Architecture and Design  

The architecture follows a **configuration‑driven pipeline construction** approach. The `Pipeline` component delegates three distinct responsibilities to three sibling classes:

1. **`PipelineConfigurator`** – parses and validates the JSON, building a directed‑acyclic graph (DAG) representation.  
2. **`DAGDependencyResolver`** – consumes the graph produced by the configurator and performs a topological sort to derive a safe execution order.  
3. **`ConcurrentExecutor`** – receives the ordered steps (or the DAG itself) and schedules them on a thread‑pool, allowing parallel execution where the dependency graph permits.

This separation of concerns mirrors the **Builder** style of constructing complex objects: the configurator “builds” the pipeline graph, while the resolver and executor “use” it. The design avoids tight coupling; each sibling operates on the same abstract graph but does not need to know the internals of the others. The parent `Pipeline` orchestrates the flow: it first calls `PipelineConfigurator.configurePipeline`, then passes the result to `DAGDependencyResolver`, and finally hands the resolved order to `ConcurrentExecutor`.

Because the pipeline definition is a pure data file, the system naturally supports **plug‑and‑play** of new steps: adding a step only requires updating `pipeline-configuration.json`. No code changes are needed in the configurator, which simply reads the new node and validates it against existing IDs and dependencies.

## Implementation Details  

The core of `PipelineConfigurator` is the `configurePipeline` method. Its implementation can be inferred as follows:

1. **File Ingestion** – The method opens **`pipeline-configuration.json`**, parses the JSON into a native collection (e.g., a list of dictionaries).  
2. **Validation Phase** –  
   * **Unique ID Check** – It iterates through the step list, collecting IDs in a set and raising an error if a duplicate is found.  
   * **Dependency Declaration Check** – For each step, it verifies that every entry in its `depends_on` array references an existing step ID; missing references trigger a validation exception.  
3. **Graph Construction** – After validation succeeds, the configurator creates a graph object (likely an adjacency list or adjacency map) where each node corresponds to a step ID and edges point from a step to its dependents. The graph is returned to the caller as the “configured pipeline”.

The validation logic guarantees that the resulting graph is a **DAG**; cycles would be caught either during dependency validation (if a step depends on itself) or later when `DAGDependencyResolver` attempts a topological sort. By performing validation up‑front, the configurator prevents runtime failures in the execution phase.

Although the observations do not list concrete class names for the graph structure, the surrounding components (`DAGDependencyResolver`, `ConcurrentExecutor`) imply a shared, lightweight representation—most likely a simple in‑memory object that can be traversed efficiently.

## Integration Points  

`PipelineConfigurator` sits at the entry point of the pipeline creation pipeline. Its primary integration surface is the `Pipeline` parent, which invokes `configurePipeline` during pipeline startup or when a new configuration is loaded. The configurator’s output—a validated DAG—is handed directly to **`DAGDependencyResolver`**, which lives side‑by‑side as a sibling component. The resolver consumes the graph to compute a topological ordering, exposing that ordering (or a refined sub‑graph) to **`ConcurrentExecutor`**, which finally schedules the steps on a thread pool.

Because the configurator works solely with the JSON file, any external system that can produce a correctly‑shaped `pipeline-configuration.json` can integrate with the pipeline without code changes. For example, a CI/CD system could generate a configuration per deployment, or a UI could allow users to drag‑and‑drop steps and export the resulting JSON for the configurator to consume.

## Usage Guidelines  

1. **Maintain Unique IDs** – Every step in `pipeline-configuration.json` must have a distinct `id`. Duplicate identifiers will cause the configurator’s validation to reject the file.  
2. **Declare All Dependencies Explicitly** – The `depends_on` array must reference only existing step IDs. Missing references are treated as configuration errors.  
3. **Preserve Acyclic Structure** – Although the configurator validates direct references, indirect cycles (e.g., A → B → C → A) will be caught later by `DAGDependencyResolver`. Designers should avoid creating circular dependencies in the JSON.  
4. **Version the JSON File** – Since the configurator treats the JSON as the single source of truth, version control of `pipeline-configuration.json` is essential for reproducibility and rollback.  
5. **Leverage Parallelism** – Steps that have no mutual dependencies can be executed concurrently by `ConcurrentExecutor`. When authoring the configuration, aim to minimise unnecessary dependencies to maximise parallel execution.

---

### 1. Architectural patterns identified  
* **Configuration‑driven construction** – the pipeline is defined outside code in a JSON file.  
* **Builder‑style separation** – `PipelineConfigurator` builds the graph, while `DAGDependencyResolver` and `ConcurrentExecutor` consume it.  
* **DAG (Directed Acyclic Graph) execution model** – explicit `depends_on` edges enable topological sorting and parallel execution.

### 2. Design decisions and trade‑offs  
* **Early validation** (in the configurator) trades a modest start‑up cost for safety, preventing runtime execution errors.  
* **External JSON definition** improves flexibility and enables non‑developer pipeline authoring, but introduces a dependency on correct JSON syntax and schema.  
* **Separate resolver and executor** isolates ordering logic from concurrency concerns, simplifying each component but adding an extra hand‑off step.

### 3. System structure insights  
The system is layered: `Pipeline` (orchestrator) → `PipelineConfigurator` (graph builder) → `DAGDependencyResolver` (ordering) → `ConcurrentExecutor` (runtime). Sibling components share the same graph representation, reinforcing a clear contract between them. The parent‑child relationship (Pipeline → PipelineConfigurator) underscores that configuration is a foundational step before any execution can occur.

### 4. Scalability considerations  
Because the pipeline is modeled as a DAG, steps without dependencies can be run in parallel, and `ConcurrentExecutor`’s thread‑pool scales with available CPU cores. Adding more steps merely expands the graph; the resolver’s topological sort is O(V + E) and remains efficient even for large pipelines. The configurator’s validation is also linear, so the overall pipeline creation scales well.

### 5. Maintainability assessment  
* **High maintainability** – the declarative JSON separates business logic from wiring, making updates as simple as editing a file.  
* **Clear validation rules** reduce the likelihood of subtle bugs.  
* **Modular components** (`PipelineConfigurator`, `DAGDependencyResolver`, `ConcurrentExecutor`) allow independent evolution; for instance, a new executor strategy can be introduced without touching the configurator.  
* Potential risk: if the JSON schema evolves, the configurator must be updated accordingly; however, because the schema is simple (id + depends_on), versioning impact is minimal.

## Hierarchy Context

### Parent
- [Pipeline](./Pipeline.md) -- PipelineCoordinator uses a DAG-based execution model with topological sort in pipeline-configuration.json steps, each step declaring explicit depends_on edges

### Siblings
- [DAGDependencyResolver](./DAGDependencyResolver.md) -- The pipeline-configuration.json file defines the steps and their dependencies, which are then used by the DAGDependencyResolver to determine the execution order
- [ConcurrentExecutor](./ConcurrentExecutor.md) -- The ConcurrentExecutor class uses a thread pool to execute pipeline steps concurrently, with each thread executing a separate step

---

*Generated from 3 observations*
