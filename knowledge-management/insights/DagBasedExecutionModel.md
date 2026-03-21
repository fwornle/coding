# DagBasedExecutionModel

**Type:** Detail

The use of a DAG-based execution model allows for efficient execution of steps with complex dependencies, as each step only needs to declare its dependencies and the model will handle the ordering.

## What It Is  

The **DagBasedExecutionModel** lives inside the *Pipeline* component and is materialised in the **`batch-analysis.yaml`** definition file.  Within this YAML file each step declares a **`depends_on`** list that explicitly describes the edges of a directed‑acyclic graph (DAG).  The Pipeline coordinator reads these declarations, builds the graph, and applies a **topological‑sort** algorithm to produce an execution order that guarantees every step runs only after all of its declared predecessors have completed.  In short, the model is a declarative, DAG‑driven scheduler that turns the static `depends_on` metadata into a runtime‑safe, dependency‑aware execution plan.

---

## Architecture and Design  

The architecture follows a **declarative DAG‑execution pattern**.  The primary architectural elements are:

1. **Declarative Step Specification** – Steps are described in `batch-analysis.yaml` with a `depends_on` field.  This eliminates the need for imperative ordering code and pushes the responsibility for dependency definition to the configuration layer.  
2. **Graph Construction & Validation** – The Pipeline coordinator parses the YAML, creates an in‑memory directed graph, and validates that it is acyclic.  The validation step is essential because the topological sort only works on a DAG.  
3. **Topological Sort Scheduler** – A classic topological‑sort algorithm (e.g., Kahn’s algorithm) is executed against the graph to produce a linearised list of steps.  This list is then handed to the underlying step‑execution engine.  

The only explicit code path referenced is the **`batch-analysis.yaml`** file, which acts as the contract between the configuration and the coordinator.  No additional design patterns (such as micro‑services or event‑driven) are mentioned, so the design remains focused on the DAG‑centric scheduling concern.

---

## Implementation Details  

The implementation can be broken down into three logical phases:

1. **Parsing Phase** – The coordinator reads `batch-analysis.yaml`.  Each entry is interpreted as a step object that contains at least two attributes: an identifier (the step name) and a `depends_on` collection.  
2. **Graph Building Phase** – For every step, the coordinator inserts a node into a directed graph data structure and adds edges from each declared dependency to the step node.  Because the dependencies are explicit, the graph construction is straightforward and deterministic.  
3. **Sorting Phase** – The coordinator invokes a topological sort.  The algorithm iteratively selects nodes with zero incoming edges, appends them to the execution list, and removes their outgoing edges, repeating until the graph is empty.  If at any point no node without incoming edges exists, the coordinator detects a cycle and aborts, protecting the system from invalid configurations.

The result of this process is a **linear execution plan** that respects all `depends_on` constraints.  The plan is then fed to the step‑execution runtime (outside the scope of the observations) which carries out the actual work of each step.

---

## Integration Points  

* **Pipeline (Parent)** – The DagBasedExecutionModel is a child of the Pipeline component.  The Pipeline coordinator is the orchestrator that invokes the DAG builder and sorter, meaning any change to the model directly impacts the Pipeline’s scheduling behaviour.  
* **Step Execution Engine (Sibling/Child)** – Although not named in the observations, the sorted list produced by the DagBasedExecutionModel is consumed by the step execution subsystem.  The interface between them is simply the ordered list of step identifiers.  
* **Configuration Layer** – `batch-analysis.yaml` is the sole integration touch‑point for developers.  The file’s schema (step definitions + `depends_on`) is the contract that the DagBasedExecutionModel expects.  Any external tooling that generates or modifies this YAML must adhere to the same schema to remain compatible.

---

## Usage Guidelines  

1. **Declare All Dependencies Explicitly** – Every step that relies on the output or side‑effects of another must list that predecessor in its `depends_on` array.  Omitting a required dependency can lead to race conditions or failed executions.  
2. **Maintain Acyclic Relationships** – Because the model relies on a topological sort, the dependency graph must remain acyclic.  Introducing circular dependencies will cause the coordinator to reject the configuration at parse time.  
3. **Keep Step Granularity Reasonable** – Very fine‑grained steps increase the size of the DAG and the overhead of sorting, while overly coarse steps reduce the parallelism benefits that the DAG model can provide.  Aim for a balance that matches the workload’s natural parallelism.  
4. **Version Control the YAML** – Since the DAG definition lives in `batch-analysis.yaml`, treat it as code: review changes, enforce linting rules (e.g., no duplicate step names), and ensure that any modification is accompanied by a validation run.  
5. **Monitor for Changes in Dependency Structure** – When adding new steps or re‑ordering existing ones, verify that the new `depends_on` edges do not unintentionally increase the critical path length, which could affect overall pipeline latency.

---

### Architectural Patterns Identified  

* **Declarative Configuration‑Driven Scheduling** – Steps are declared with dependencies rather than programmed imperatively.  
* **Directed‑Acyclic Graph (DAG) Execution Model** – The core scheduling mechanism is a DAG built from `depends_on` edges.  
* **Topological Sort as a Scheduling Algorithm** – Guarantees a valid linear order respecting all dependencies.

### Design Decisions and Trade‑offs  

* **Decision:** Use a static YAML file for dependency declaration.  
  *Trade‑off:* Simplicity and readability versus limited dynamism; runtime‑generated dependencies would require a different mechanism.  

* **Decision:** Rely on a topological sort rather than a more complex scheduler.  
  *Trade‑off:* Guarantees correctness for DAGs with minimal computational overhead, but does not provide advanced features such as priority‑based execution or dynamic re‑ordering.  

* **Decision:** Enforce acyclicity at configuration time.  
  *Trade‑off:* Prevents subtle runtime deadlocks, but places the burden of cycle detection on the author of `batch-analysis.yaml`.

### System Structure Insights  

The system is layered: the **configuration layer** (`batch-analysis.yaml`) feeds the **Pipeline coordinator**, which houses the **DagBasedExecutionModel** (graph builder + sorter).  The coordinator then hands the ordered list to the **step execution engine**.  This clear separation keeps the scheduling logic isolated from both configuration and execution, aiding both reasoning and testing.

### Scalability Considerations  

* **Graph Size:** Topological sort runs in linear time O(V + E), so the model scales well even as the number of steps (V) and dependencies (E) grows.  
* **Parallel Execution:** Because the DAG explicitly captures independent branches, downstream executors can run non‑dependent steps in parallel, improving throughput on multi‑core or distributed environments.  
* **Configuration Management:** Very large YAML files may become unwieldy; modularising the DAG into multiple files or using includes (if supported) could mitigate this.

### Maintainability Assessment  

The declarative nature of the DAG model makes the pipeline easy to read and modify: a developer can understand execution order simply by inspecting `depends_on` lists.  Validation of acyclicity at parse time provides early feedback, reducing runtime bugs.  However, the lack of explicit naming for classes or functions in the observations means that maintainers must rely on the YAML schema and the coordinator’s internal implementation details, which should be well‑documented in code comments and developer guides to avoid confusion.  Overall, the design promotes maintainability through clear separation of concerns and deterministic scheduling.

## Hierarchy Context

### Parent
- [Pipeline](./Pipeline.md) -- The Pipeline coordinator uses a DAG-based execution model with topological sort in batch-analysis.yaml steps, each step declaring explicit depends_on edges

---

*Generated from 3 observations*
