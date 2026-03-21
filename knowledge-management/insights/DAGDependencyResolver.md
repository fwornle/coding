# DAGDependencyResolver

**Type:** Detail

The use of a DAG-based execution model allows for flexible and dynamic pipeline configuration, with dependencies between tasks explicitly declared in the batch-analysis.yaml file.

## What It Is  

`DAGDependencyResolver` lives inside the **Pipeline** sub‑component of the batch‑processing system. Its concrete implementation is anchored to the configuration file **`batch-analysis.yaml`**, where every pipeline step declares explicit `depends_on` edges. In practice, `DAGDependencyResolver` reads the `depends_on` declarations from this YAML file, builds an in‑memory directed‑acyclic graph (DAG), and supplies the rest of the pipeline with a deterministic execution order that respects all declared dependencies. Because the resolver is a child of the **Pipeline** component, it is the authoritative source for dependency information that the broader pipeline execution engine consumes when scheduling tasks.

---

## Architecture and Design  

The architecture revolves around a **DAG‑based execution model**. This model is the central design pattern identified in the observations: each pipeline step is a node, and the `depends_on` relationships defined in `batch-analysis.yaml` are the directed edges. `DAGDependencyResolver` embodies the *graph‑construction* and *topological‑sorting* responsibilities that enable the Pipeline to transform a declarative dependency description into an executable schedule.

Interaction flow:

1. **Configuration Ingestion** – The resolver parses `batch-analysis.yaml`, extracting step identifiers and their `depends_on` lists.  
2. **Graph Construction** – Using the extracted data, it creates a directed graph data structure (typically an adjacency list or map).  
3. **Validation** – The resolver checks the graph for cycles; any cycle detection triggers a configuration error because a true DAG must be acyclic.  
4. **Ordering** – It performs a topological sort to produce a linear ordering (or a set of parallelizable layers) that the Pipeline’s scheduler can consume.

Because the resolver is a child of **Pipeline**, the parent component delegates all dependency‑resolution concerns to it. Sibling components (if any) that need to understand task ordering simply query the resolver’s output rather than re‑implementing graph logic. This clear separation of concerns keeps the DAG handling logic encapsulated within `DAGDependencyResolver`.

---

## Implementation Details  

While the observations do not enumerate individual methods, the responsibilities of `DAGDependencyResolver` imply a small, focused API:

* **`load_configuration(path: str) -> None`** – Reads `batch-analysis.yaml` and populates an internal representation of steps and their raw `depends_on` lists.  
* **`build_graph() -> None`** – Transforms the raw data into a directed graph object, typically using a dictionary where keys are step IDs and values are sets of dependent step IDs.  
* **`detect_cycles() -> bool`** – Executes a depth‑first search (DFS) or Kahn’s algorithm to confirm the graph remains acyclic; returns `True` if a cycle is found, causing the resolver to raise a configuration exception.  
* **`topological_sort() -> List[Set[str]]`** – Produces an ordered list of step groups; each set contains steps that can run concurrently because they share no mutual dependencies.  
* **`get_execution_plan() -> List[Set[str]]`** – Public accessor used by the Pipeline to retrieve the final schedule.

The resolver’s internal state is tightly coupled to the **`batch-analysis.yaml`** file, making the file the single source of truth for dependency information. Because the resolver only deals with static configuration, it remains stateless between runs, which simplifies testing and enables deterministic builds.

---

## Integration Points  

`DAGDependencyResolver` is invoked early in the Pipeline’s lifecycle. The parent **Pipeline** component calls the resolver during its initialization phase to obtain the execution plan. The resolver therefore depends on:

* **YAML parsing library** – to read `batch-analysis.yaml`.  
* **Graph utilities** – either a custom lightweight graph class or a standard library collection (e.g., `dict`/`set`) for adjacency representation.  

The output of the resolver (the ordered list of step groups) is consumed by the Pipeline’s **scheduler** component, which translates each group into concrete task instances (e.g., Spark jobs, container executions). No other system parts directly read `batch-analysis.yaml`; they rely on the resolver to enforce consistency, which reduces duplicated parsing logic and centralizes error handling.

---

## Usage Guidelines  

1. **Declare all dependencies explicitly** – Every step in `batch-analysis.yaml` must list its upstream steps in a `depends_on` array. Omitting a needed dependency can lead to race conditions, while adding unnecessary edges can reduce parallelism.  
2. **Maintain a true DAG** – The resolver will reject configurations that introduce cycles. When adding new steps, verify that the new edges do not close a loop.  
3. **Keep the YAML file minimal and declarative** – Since the resolver treats the file as the sole source of truth, avoid embedding procedural logic or runtime values inside `batch-analysis.yaml`.  
4. **Leverage the parallel groups** – The topological sort returns sets of steps that can run concurrently. The Pipeline’s scheduler should respect these groups to maximize throughput.  
5. **Version‑control the configuration** – Because the resolver’s behavior is entirely driven by `batch-analysis.yaml`, any change to the pipeline’s topology should be reviewed and tracked in source control.

---

### Architectural Patterns Identified  

* **DAG‑based Execution Model** – Nodes = pipeline steps; edges = `depends_on` relationships.  
* **Separation of Concerns** – `DAGDependencyResolver` isolates graph construction and validation from scheduling logic.  

### Design Decisions and Trade‑offs  

* **Declarative Dependency Definition** – By pushing all dependency information into `batch-analysis.yaml`, the system gains transparency and ease of modification, at the cost of requiring developers to maintain an accurate, up‑to‑date YAML file.  
* **Static Resolution vs. Dynamic Scheduling** – Resolving the DAG once at pipeline start simplifies runtime scheduling but limits the ability to adapt dependencies on the fly. This trade‑off favors predictability and reproducibility.  

### System Structure Insights  

The Pipeline hierarchy is: **Pipeline (parent) → DAGDependencyResolver (child)**. The resolver acts as the single entry point for dependency information, feeding a downstream scheduler that may have sibling components (e.g., resource allocators) but no other entity directly parses `batch-analysis.yaml`.  

### Scalability Considerations  

Because the resolver builds the full graph in memory and performs a single topological sort, its computational complexity is O(V + E) where V is the number of steps and E the number of dependency edges. This linear cost scales well for typical batch pipelines (hundreds to low‑thousands of steps). Parallel execution groups produced by the resolver enable the scheduler to exploit cluster resources efficiently, improving overall throughput.  

### Maintainability Assessment  

Encapsulating all DAG logic in `DAGDependencyResolver` yields high maintainability: changes to dependency handling are localized, and the YAML‑driven approach makes the pipeline’s structure self‑documenting. The lack of hidden runtime dependency manipulation reduces technical debt. However, maintainability hinges on disciplined updates to `batch-analysis.yaml`; stale or incorrect declarations directly break the execution plan, so robust validation (cycle detection) and thorough code reviews of the YAML file are essential.

## Hierarchy Context

### Parent
- [Pipeline](./Pipeline.md) -- The batch processing pipeline follows a DAG-based execution model, with each step declaring explicit depends_on edges in batch-analysis.yaml.

---

*Generated from 3 observations*
