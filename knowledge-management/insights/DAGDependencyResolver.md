# DAGDependencyResolver

**Type:** Detail

The DAGDependencyResolver uses a topological sort algorithm to order the steps, ensuring that a step is only executed after all its dependencies have been met

## What It Is  

`DAGDependencyResolver` is the component that materialises the directed‑acyclic‑graph (DAG) execution model for a **Pipeline**. Its responsibility is to read the step definitions that live in **`pipeline-config.yaml`**, interpret the explicit `depends_on` edges declared for each step, and produce a linearised ordering that respects those dependencies. The resolver is invoked by the **`PipelineCoordinator`**, which subsequently drives the actual execution of the steps in the order returned by the resolver. In the repository hierarchy the resolver lives alongside its sibling components **`PipelineConfigParser`** and **`StepExecutor`**, all of which are children of the top‑level **`Pipeline`** aggregate.

## Architecture and Design  

The architecture follows a **pipeline‑oriented, DAG‑based execution model**. The key design pattern evident from the observations is the **Topological Sort** algorithm, employed by `DAGDependencyResolver` to guarantee that no step runs before all of its declared predecessors have completed. This algorithmic choice enforces a strict partial‑order without requiring runtime cycle detection – the configuration must already be a DAG, otherwise the sort will fail early.  

Interaction between components is straightforward and **layered**:  
1. **`PipelineConfigParser`** reads `pipeline-config.yaml` and extracts a lightweight representation of steps and their `depends_on` relationships.  
2. The parsed representation is handed to **`DAGDependencyResolver`**, which constructs an internal graph (nodes = steps, edges = dependencies) and runs a topological sort.  
3. The ordered list is returned to **`PipelineCoordinator`**, which iterates through it and delegates each step to **`StepExecutor`**.  

Because the resolver does not itself execute any business logic, it remains **single‑responsibility** and **purely functional** – given the same input graph it always yields the same ordering. This separation of concerns keeps the DAG logic isolated from parsing (`PipelineConfigParser`) and execution (`StepExecutor`).

## Implementation Details  

Although the source code is not listed, the observations give us the essential building blocks:

* **`pipeline-config.yaml`** – the canonical source of truth for step definitions. Each step entry includes a `depends_on` list that explicitly declares predecessor step identifiers.  
* **`DAGDependencyResolver`** – a class (or module) that consumes the parsed step list. Internally it likely builds an adjacency list or map (`Map<StepId, Set<DependentIds>>`) and tracks in‑degree counts for each node. The classic Kahn’s algorithm (queue of zero‑in‑degree nodes) or a depth‑first search with post‑order collection would be used to produce a topologically sorted array of step identifiers. Errors such as cycles or missing dependencies are surfaced as exceptions, preventing the `PipelineCoordinator` from proceeding with an invalid schedule.  
* **`PipelineCoordinator`** – orchestrates the overall run. After receiving the ordered step list, it loops through the sequence, invoking **`StepExecutor`** for each step. Because the order is already validated, the coordinator can safely assume that any required predecessor data has been materialised.  
* **`PipelineConfigParser`** – parses the YAML file into a domain model (e.g., `StepDefinition { id, depends_on, … }`). It abstracts away YAML syntax details, exposing a clean API that the resolver consumes.  
* **`StepExecutor`** – the runtime worker that executes a single step. It may further delegate to an **`EntityProcessor`** (as noted in the sibling description) to transform input entities and produce observations, but this is orthogonal to the DAG resolution.

The resolver’s public interface is likely a method such as `resolve(List<StepDefinition>) → List<StepDefinition>` or `resolve(Map<String, StepDefinition>) → List<String>`. The method is deterministic, side‑effect free, and throws on invalid graphs.

## Integration Points  

* **Input Integration:** The resolver’s sole input is the data structure produced by `PipelineConfigParser`. Any change to the YAML schema (e.g., renaming `depends_on` to `prerequisites`) would require coordinated updates in both the parser and the resolver’s expectation of the field name.  
* **Output Integration:** The resolved ordering is consumed exclusively by `PipelineCoordinator`. The coordinator treats the list as a contract: “execute steps in this exact sequence”. Consequently, the resolver must expose its result in a format the coordinator can iterate over without additional transformation.  
* **Error Propagation:** Validation failures (cycles, undefined dependencies) are propagated up to the coordinator, which can abort the pipeline run and surface a clear configuration error to the operator.  
* **Sibling Collaboration:** While `StepExecutor` does not interact directly with the resolver, it relies on the ordering guarantee that the resolver provides. Likewise, `PipelineConfigParser` and `DAGDependencyResolver` share a tight coupling around the shape of the step definition object; they are co‑evolving siblings within the pipeline package.  

No external services or databases are mentioned, indicating that the resolver operates entirely in‑process and is thus lightweight to invoke.

## Usage Guidelines  

1. **Declare Explicit Dependencies:** Every step in `pipeline-config.yaml` should list all required predecessor steps in its `depends_on` array. Omitting a needed dependency can lead to runtime failures because the resolver will schedule the step earlier than its data is ready.  
2. **Maintain Acyclic Graphs:** The configuration must remain a DAG. Introducing circular dependencies will cause the topological sort to throw an exception, halting pipeline deployment. Validate changes with a linting step or CI check that runs the resolver in “dry‑run” mode.  
3. **Keep Parsing and Resolution Separate:** Do not embed business logic inside the YAML or the resolver. The `PipelineConfigParser` should only translate the file into a plain data model; the resolver should only order that model. This separation preserves testability—unit tests can feed the resolver with synthetic step lists without involving file I/O.  
4. **Handle Resolver Exceptions Gracefully:** `PipelineCoordinator` should catch resolution errors and surface a user‑friendly message that points back to the offending step definitions. This aids operators in quickly fixing configuration mistakes.  
5. **Version Control the Config:** Because the resolver’s output is deterministic, any change to `pipeline-config.yaml` should be reviewed and versioned. A change that reorders steps (by adding or removing dependencies) will affect downstream execution order, so reviewers must understand the impact on data lineage.

---

### Architectural Patterns Identified  
* **Topological Sort (algorithmic pattern)** – ensures correct execution ordering in a DAG.  
* **Layered / Hexagonal separation** – parsing, resolution, coordination, and execution are distinct layers with single responsibilities.  

### Design Decisions & Trade‑offs  
* **Pure functional resolver** – simplifies testing and reasoning but places the burden of cycle detection on configuration authors.  
* **YAML‑driven configuration** – offers readability and flexibility but requires a robust parser and validation step to avoid runtime errors.  

### System Structure Insights  
The pipeline subsystem is organized around a clear hierarchy: `Pipeline` (parent) → `PipelineConfigParser`, `DAGDependencyResolver`, `StepExecutor` (siblings) → concrete step implementations (children). Each sibling contributes a focused capability, enabling independent evolution.  

### Scalability Considerations  
Topological sorting runs in O(V + E) time, where V is the number of steps and E the number of dependency edges, which scales linearly with pipeline size. Because the resolver works entirely in memory and does not depend on external services, it can handle very large step graphs provided the host process has sufficient RAM. Parallel execution of independent steps could be added on top of the resolved ordering without modifying the resolver itself.  

### Maintainability Assessment  
The strict separation of concerns, deterministic algorithm, and declarative YAML configuration make the `DAGDependencyResolver` highly maintainable. Adding new step types or altering execution order only requires changes to the YAML and, if needed, updates to the parser’s schema handling. The lack of intertwined business logic means that refactoring one sibling (e.g., enhancing `StepExecutor`) does not impact the resolver, reducing regression risk.


## Hierarchy Context

### Parent
- [Pipeline](./Pipeline.md) -- PipelineCoordinator uses a DAG-based execution model with topological sort in pipeline-config.yaml steps, each step declaring explicit depends_on edges

### Siblings
- [PipelineConfigParser](./PipelineConfigParser.md) -- The pipeline-config.yaml file is parsed by the PipelineConfigParser, which extracts the steps and their dependencies
- [StepExecutor](./StepExecutor.md) -- The StepExecutor uses the EntityProcessor to process entities and generate observations


---

*Generated from 3 observations*
