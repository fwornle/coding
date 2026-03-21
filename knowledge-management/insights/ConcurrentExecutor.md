# ConcurrentExecutor

**Type:** Detail

The ConcurrentExecutor also implements a work-stealing algorithm, which allows threads to steal work from other threads that are blocked or idle, improving overall throughput

## What It Is  

`ConcurrentExecutor` is the core runtime component that drives the parallel execution of a pipeline’s steps. It lives inside the **Pipeline** package (the exact source file path is not disclosed in the observations) and is instantiated by the `Pipeline` (or more precisely by the `PipelineCoordinator`) when a pipeline run is started. The class builds a **thread‑pool** and, using a **dependency graph**, decides which steps can run concurrently while respecting the explicit `depends_on` edges that are defined in *pipeline‑configuration.json*. In addition, the executor augments the plain thread‑pool with a **work‑stealing algorithm** so that idle or blocked threads can dynamically acquire work from busy peers, thereby keeping the CPU saturated and improving overall throughput.

## Architecture and Design  

The design of `ConcurrentExecutor` is centred around a **DAG‑driven, concurrent execution model**. The parent component, `Pipeline`, supplies a pre‑processed DAG that has already been resolved by the sibling `DAGDependencyResolver`. This resolver, together with `PipelineConfigurator`, translates the JSON configuration into an in‑memory graph where each node represents a pipeline step and edges encode the `depends_on` relationships. `ConcurrentExecutor` consumes this graph and applies a **topological‑order‑aware scheduling**: only steps whose inbound dependencies have been satisfied are eligible for submission to the thread pool.

Two architectural patterns emerge from the observations:

1. **Thread‑Pool (Worker‑Thread) pattern** – a fixed set of worker threads is created up‑front and reused for the lifetime of the execution, avoiding the overhead of thread creation per step.  
2. **Work‑Stealing scheduling** – each worker maintains its own local queue of ready steps; when a worker becomes idle it attempts to “steal” work from the queues of other workers. This dynamic load‑balancing mechanism reduces contention on a single global queue and improves throughput, especially when step execution times are heterogeneous.

The executor therefore acts as a bridge between the static DAG produced by the configuration layer and the dynamic, high‑performance runtime provided by the thread‑pool plus work‑stealing scheduler. No additional design patterns (e.g., micro‑services, event‑driven) are introduced beyond what the observations explicitly describe.

## Implementation Details  

`ConcurrentExecutor` encapsulates three logical subsystems:

1. **Dependency‑Graph Engine** – upon construction it receives the DAG (produced by `PipelineConfigurator` → `DAGDependencyResolver`). It maintains a per‑node counter of unresolved dependencies. When a step finishes, the executor atomically decrements the counters of its downstream nodes; any node whose counter reaches zero is marked as *ready*.

2. **Thread‑Pool Manager** – a pool of worker threads is created once the executor starts. Each worker repeatedly pulls a ready step from its local queue (or from a shared ready‑set if the local queue is empty) and invokes the step’s `run()` method. The size of the pool is typically derived from the number of CPU cores, but can be overridden by configuration.

3. **Work‑Stealing Scheduler** – each worker’s local queue is a double‑ended queue (deque). When a worker’s deque is empty, it scans the deques of its peers and attempts to pop a task from the opposite end (the “steal” side). This algorithm ensures that long‑running steps do not starve the pool and that short steps are quickly redistributed, achieving better CPU utilisation.

Error handling is performed at the step level: if a step throws an exception, the executor records the failure, propagates the error up to the `PipelineCoordinator`, and may abort downstream steps that depend on the failed node. The observations do not detail a specific retry or compensation mechanism, so the current design appears to favour fail‑fast semantics.

## Integration Points  

`ConcurrentExecutor` is tightly coupled with three surrounding entities:

* **Pipeline (parent)** – the `PipelineCoordinator` creates the executor, passes the resolved DAG, and receives completion or failure callbacks. The coordinator also supplies any runtime context (e.g., environment variables, shared resources) that steps may need.
* **DAGDependencyResolver (sibling)** – this component provides the executor with the exact ordering constraints. Any change in how dependencies are expressed (e.g., adding conditional edges) will directly affect the executor’s readiness logic.
* **PipelineConfigurator (sibling)** – responsible for parsing *pipeline‑configuration.json* and constructing the in‑memory graph that the resolver and executor consume. Modifications to the JSON schema (new step attributes, alternative dependency syntax) must be reflected in both the configurator and the executor’s dependency‑tracking code.

The executor does not expose a public API beyond its constructor and a `run()`/`start()` method (inferred from typical executor designs). Interaction with steps is through a common interface (e.g., a `Step` abstract class with a `run()` method), which is not named in the observations but is implied by the “execute pipeline steps” phrasing.

## Usage Guidelines  

1. **Configure the thread pool size thoughtfully** – while the default is usually the number of logical cores, pipelines with I/O‑bound steps may benefit from a larger pool. Over‑provisioning can increase context‑switch overhead without improving throughput.  
2. **Define clear `depends_on` relationships** – the executor relies on the DAG to avoid premature execution. Missing or circular dependencies will cause the scheduler to deadlock or raise errors during the resolution phase.  
3. **Keep step execution time reasonably bounded** – extremely long‑running steps can starve other work even with work‑stealing. If a step is expected to run for minutes, consider breaking it into smaller sub‑steps or marking it as “asynchronous” if the framework supports it.  
4. **Handle exceptions within steps** – because the executor propagates step failures upstream, steps should catch recoverable errors and either retry locally or convert them into a controlled failure state. Unhandled exceptions will abort dependent steps.  
5. **Avoid side‑effects that bypass the dependency graph** – steps should not modify shared state that other steps rely on unless those dependencies are explicitly declared; otherwise the executor cannot guarantee correct ordering.

---

### 1. Architectural patterns identified  
* Thread‑Pool (Worker‑Thread) pattern for reusable concurrency resources.  
* Work‑Stealing scheduling for dynamic load balancing across workers.  
* DAG‑based execution ordering (topological sort) derived from the pipeline configuration.

### 2. Design decisions and trade‑offs  
* **Thread‑pool vs. per‑step thread creation** – a pool reduces overhead but limits parallelism to the pool size.  
* **Work‑stealing vs. single global queue** – stealing improves scalability for heterogeneous step durations but adds complexity and requires lock‑free deques.  
* **Fail‑fast error propagation** – simplifies error handling but may abort unrelated branches that could have completed successfully.

### 3. System structure insights  
* `ConcurrentExecutor` sits between the static DAG produced by `PipelineConfigurator`/`DAGDependencyResolver` and the dynamic runtime managed by `PipelineCoordinator`.  
* It acts as the sole consumer of the resolved graph, translating dependency counters into ready‑task signals for the thread pool.  
* No child components are described; the executor’s “children” are the individual step objects it schedules.

### 4. Scalability considerations  
* Work‑stealing enables the executor to scale with the number of cores and with variable step runtimes.  
* The dependency‑graph approach ensures that adding more steps does not increase coordination overhead beyond the graph traversal and counter updates, which are O(1) per dependency edge.  
* Potential bottlenecks include contention on the atomic counters for highly connected nodes and memory pressure from large step payloads.

### 5. Maintainability assessment  
* The separation of concerns—configuration (`PipelineConfigurator`), dependency resolution (`DAGDependencyResolver`), and execution (`ConcurrentExecutor`)—promotes modularity and eases testing.  
* Because the executor’s core logic (dependency tracking, work‑stealing) is algorithmic, changes to scheduling policies can be isolated without touching the configuration layer.  
* Lack of explicit file paths or public interfaces in the observations limits traceability, so documentation should explicitly map class names to source files to aid future developers.

## Hierarchy Context

### Parent
- [Pipeline](./Pipeline.md) -- PipelineCoordinator uses a DAG-based execution model with topological sort in pipeline-configuration.json steps, each step declaring explicit depends_on edges

### Siblings
- [DAGDependencyResolver](./DAGDependencyResolver.md) -- The pipeline-configuration.json file defines the steps and their dependencies, which are then used by the DAGDependencyResolver to determine the execution order
- [PipelineConfigurator](./PipelineConfigurator.md) -- The PipelineConfigurator class has a method called configurePipeline that takes the pipeline-configuration.json file as input and returns a configured pipeline graph

---

*Generated from 3 observations*
