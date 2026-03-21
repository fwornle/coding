# ConcurrencyAndParallelism

**Type:** SubComponent

ParallelismConfiguration.java loads configuration settings for parallelism, such as thread pool sizes and queue capacities, as demonstrated in the parallelism-configuration-example.java file

## What It Is  

`ConcurrencyAndParallelism` is the sub‑component that houses the core runtime facilities for executing work concurrently across a Java code‑base. The implementation lives in a handful of concrete classes that are directly referenced in the source observations:  

* **`WorkStealingExecutor.java`** – implements a classic work‑stealing algorithm that lets idle worker threads “steal” tasks from the queues of busy peers.  
* **`GraphBasedExecution.java`** – provides a DAG‑based execution model; it builds a topological ordering of dependent tasks before dispatching them.  
* **`ParallelTaskExecutor.java`** – acts as a façade exposing a simple API for submitting tasks and retrieving their results.  
* **`ConcurrentQueue.java`** – a lock‑protected queue used by the executors to store pending work.  
* **`SynchronizationUtils.java`** – a collection of low‑level helpers for acquiring and releasing locks, condition variables, etc.  
* **`ParallelismConfiguration.java`** – reads external configuration (thread‑pool sizes, queue capacities) and makes those values available to the executors.  
* **`ConcurrencyException.java**` – a domain‑specific exception type that signals deadlock, starvation, or other concurrency‑related failures.  

Together these classes form the **ParallelTaskManagement** and **DagBasedExecutionModel** children of `ConcurrencyAndParallelism`, which itself is a child of the broader **CodingPatterns** component. The sibling components (e.g., `DesignPatterns`, `GraphDatabaseManagement`) share the same high‑level goal of providing reusable, well‑documented building blocks, but they focus on different concerns such as singleton creation or graph‑DB connection pooling.

---

## Architecture and Design  

The architecture of `ConcurrencyAndParallelism` follows a **modular, strategy‑oriented** layout. Each execution strategy is encapsulated in its own class hierarchy:

* **Work‑Stealing Strategy** – realized by `WorkStealingExecutor`. The executor owns a set of worker threads, each with its own local `ConcurrentQueue`. When a thread’s queue empties, it probes the queues of its peers and atomically transfers a task, achieving dynamic load‑balancing without a central scheduler.  
* **DAG‑Based Strategy** – embodied by `GraphBasedExecution`. It accepts a directed acyclic graph of tasks, computes a topological sort, and then schedules independent nodes in parallel using the same underlying thread pool.  

A **Facade pattern** is evident in `ParallelTaskExecutor`. It hides the complexity of the two execution strategies behind a uniform API (`submit`, `awaitResult`, etc.), allowing callers to switch strategies without changing their code.  

Configuration is externalized through `ParallelismConfiguration`, which reads properties (e.g., `threadPoolSize`, `queueCapacity`) at startup and injects them into the executors. This separation of concerns follows the **configuration‑driven design** principle, enabling easy tuning for different deployment environments.  

Synchronization concerns are centralized in `SynchronizationUtils`. Rather than scattering `synchronized` blocks or explicit `Lock` handling throughout the executors, the utilities provide named methods such as `acquireLock(Object lock)` and `releaseLock(Object lock)`, improving readability and reducing duplication.  

Error handling is standardized by `ConcurrencyException`, which captures high‑level concurrency failures (deadlock, starvation) and propagates them through the façade, ensuring that callers receive a consistent exception type regardless of the underlying strategy.

---

## Implementation Details  

### WorkStealingExecutor.java  
Located at the path `WorkStealingExecutor.java`, the class creates a fixed pool of worker threads (size driven by `ParallelismConfiguration`). Each thread owns a `ConcurrentQueue` instance (implemented in `ConcurrentQueue.java`). The core loop of a worker performs:

1. **Local Dequeue** – attempt to poll a task from its own queue.  
2. **Steal Phase** – if the local queue is empty, iterate over peer queues (using a deterministic ordering to avoid livelock) and invoke `ConcurrentQueue.steal()` which atomically removes the tail element.  
3. **Execution** – run the task, capture any thrown `Throwable`, and wrap it in a `Future`‑like result object.  

The executor also provides `submit(Runnable task)` which places the task into the queue of the thread that called the method (or a randomly chosen thread for load distribution). Result retrieval is handled through a lightweight `Future` implementation returned by `submit`.

### GraphBasedExecution.java  
The DAG executor (`GraphBasedExecution.java`) receives a collection of `TaskNode` objects, each declaring its dependencies. It runs a **topological sort** (Kahn’s algorithm) to produce a linear ordering that respects dependency constraints. After sorting, the executor groups nodes that have no mutual dependencies and dispatches each group to the underlying thread pool (the same pool used by `WorkStealingExecutor`). The grouping is performed by scanning the sorted list and building batches where all nodes in a batch are ready to run concurrently.  

### ParallelTaskExecutor.java  
`ParallelTaskExecutor.java` offers methods such as:

* `Future<T> submit(Callable<T> work)` – forwards the call to the selected strategy (work‑stealing or DAG) based on a configuration flag.  
* `T getResult(Future<T> future)` – blocks until the computation completes, re‑throwing any `ConcurrencyException` that may have been captured.  

Because it is a façade, the class holds references to both `WorkStealingExecutor` and `GraphBasedExecution` but exposes only the high‑level contract.

### ConcurrentQueue.java  
Implemented as a lock‑protected deque, `ConcurrentQueue` uses `java.util.concurrent.locks.ReentrantLock` internally. The `steal()` method acquires the lock, removes the tail element, and releases the lock, guaranteeing that stealing is atomic and safe under contention.

### SynchronizationUtils.java  
Utility methods such as `tryLockWithTimeout(Lock lock, long timeout, TimeUnit unit)` and `awaitCondition(Condition cond, long timeout, TimeUnit unit)` are defined here. The executors call these utilities instead of directly manipulating `Lock` and `Condition` objects, which centralizes error handling (e.g., converting `InterruptedException` into `ConcurrencyException`).

### ParallelismConfiguration.java  
The configuration class reads a properties file (e.g., `parallelism.properties`) at startup. It exposes getters like `getThreadPoolSize()` and `getQueueCapacity()`. Both executors query this class during construction, allowing the system to be re‑tuned without code changes.

### ConcurrencyException.java  
All concurrency‑related errors are wrapped in this custom unchecked exception. For example, a deadlock detection routine (if present) would throw `new ConcurrencyException("Deadlock detected", e)`. The façade re‑throws these exceptions so that callers see a consistent error type.

---

## Integration Points  

`ConcurrencyAndParallelism` integrates with the broader **CodingPatterns** component in several ways:

* **Configuration Layer** – `ParallelismConfiguration` is shared with other sub‑components that need thread‑pool or queue sizing (e.g., the `GraphDatabaseAdapter` in the sibling `GraphDatabaseManagement` component).  
* **Utility Layer** – `SynchronizationUtils` is a common utility that could be reused by any component needing low‑level lock handling, including the double‑checked locking singleton in `DesignPatterns`.  
* **Exception Handling** – `ConcurrencyException` aligns with the error‑handling conventions defined in `CodingStandards`, ensuring that all modules propagate exceptions in a uniform fashion.  

The façade `ParallelTaskExecutor` is the primary entry point for client code. Modules that need parallel execution (e.g., a batch processing service) import `ParallelTaskExecutor` and call `submit`. Internally, the façade decides whether to route the work to `WorkStealingExecutor` (for independent tasks) or `GraphBasedExecution` (when a DAG is supplied).  

Both executors rely on `ConcurrentQueue` for task storage, which means any change to the queue implementation (e.g., swapping in a lock‑free structure) would affect the entire concurrency sub‑system. The design therefore isolates the queue behind a simple interface, making such a swap feasible without touching the executors.

---

## Usage Guidelines  

1. **Choose the Right Strategy** – Use `ParallelTaskExecutor.submit` for independent, fire‑and‑forget tasks; if your workload has explicit dependencies, construct a DAG of `TaskNode`s and pass it to `GraphBasedExecution`. The façade will automatically select the appropriate executor based on the input type.  

2. **Configure Thoughtfully** – Tune `threadPoolSize` and `queueCapacity` in the `parallelism.properties` file according to the target hardware and expected concurrency level. Over‑provisioning can increase context‑switch overhead, while under‑provisioning may lead to starvation, which will surface as `ConcurrencyException`.  

3. **Handle Results Safely** – Always retrieve results via the `Future` returned by `submit`. Wrap calls to `Future.get()` in try‑catch blocks for `ConcurrencyException` to surface deadlock or starvation issues early.  

4. **Avoid Blocking Inside Tasks** – Since the executors rely on a fixed pool, blocking I/O inside a task can reduce throughput and increase the chance of starvation. If blocking is unavoidable, consider increasing the pool size or using a separate dedicated executor.  

5. **Leverage SynchronizationUtils** – When you need custom synchronization inside a task (e.g., a barrier across a subset of threads), use the helper methods in `SynchronizationUtils` rather than raw `Lock`/`Condition` code. This ensures consistent exception translation and timeout handling.  

6. **Respect Exception Semantics** – Throw `ConcurrencyException` only for unrecoverable concurrency errors. For business‑logic failures, propagate the original exception inside the task’s `Future` so that callers can differentiate between functional and concurrency problems.

---

### Summary Deliverables  

1. **Architectural patterns identified**  
   * Work‑Stealing execution strategy (algorithmic pattern)  
   * DAG‑based execution with topological sort (dependency‑driven parallelism)  
   * Facade pattern (`ParallelTaskExecutor`)  
   * Configuration‑driven design (`ParallelismConfiguration`)  
   * Centralized utility pattern (`SynchronizationUtils`)  

2. **Design decisions and trade‑offs**  
   * Separate executors for independent vs. dependent workloads – provides clarity but adds two code paths to maintain.  
   * Fixed‑size thread pool with configurable size – simple to reason about, but may need retuning for varying loads.  
   * Lock‑based `ConcurrentQueue` – easy to implement and reason about; could become a bottleneck under extreme contention compared to lock‑free alternatives.  
   * Custom `ConcurrencyException` – gives a uniform error model, yet callers must be aware of the unchecked nature of the exception.  

3. **System structure insights**  
   * `ConcurrencyAndParallelism` sits under the high‑level `CodingPatterns` component, sharing cross‑cutting concerns (configuration, utilities) with siblings like `DesignPatterns`.  
   * Child components (`WorkStealingAlgorithm`, `ParallelTaskManagement`, `DagBasedExecutionModel`) map directly to concrete classes (`WorkStealingExecutor`, `ParallelTaskExecutor`, `GraphBasedExecution`).  
   * The façade unifies the API surface, allowing other modules to remain agnostic of the underlying execution model.  

4. **Scalability considerations**  
   * Work‑stealing scales well with the number of cores because idle threads dynamically acquire work, reducing idle time.  
   * DAG execution enables parallelism proportional to the width of the graph; the topological sort adds O(V+E) overhead but is negligible for typical task graphs.  
   * Configuration parameters (`threadPoolSize`, `queueCapacity`) give operators the levers needed to adapt to larger hardware or higher throughput demands.  

5. **Maintainability assessment**  
   * Clear separation of concerns (execution strategy, configuration, synchronization, exception handling) promotes isolated changes.  
   * The façade reduces the surface area exposed to client code, limiting the impact of internal refactors.  
   * Centralizing synchronization logic in `SynchronizationUtils` and error handling in `ConcurrencyException` aids consistency across the codebase.  
   * Potential maintenance burden lies in the lock‑based queue; future performance tuning may require replacing it with a lock‑free structure, but the queue’s interface isolates that change.  

Overall, `ConcurrencyAndParallelism` delivers a well‑structured, configurable, and extensible foundation for concurrent task execution, tightly integrated with the broader `CodingPatterns` ecosystem while remaining focused on its core responsibilities.

## Hierarchy Context

### Parent
- [CodingPatterns](./CodingPatterns.md) -- The CodingPatterns component encompasses general programming wisdom, design patterns, best practices, and coding conventions applicable across the project. This component serves as a catch-all for entities that do not fit into other specific components. Its architecture is designed to promote consistency and efficiency in coding practices, ensuring that the project adheres to established standards and guidelines. Key patterns in this component include the use of intelligent routing, graph database adapters, and work-stealing concurrency, which contribute to its overall structure and functionality.

### Children
- [WorkStealingAlgorithm](./WorkStealingAlgorithm.md) -- WorkStealingExecutor (WorkStealingExecutor.java:10) implements the work-stealing algorithm, allowing threads to steal tasks from other threads when their own task queue is empty
- [ParallelTaskManagement](./ParallelTaskManagement.md) -- The WorkStealingExecutor (WorkStealingExecutor.java:20) provides methods for submitting tasks and retrieving results, allowing developers to manage parallel tasks with ease
- [DagBasedExecutionModel](./DagBasedExecutionModel.md) -- The GraphBasedExecution (GraphBasedExecution.java:15) class implements the DAG-based execution model, allowing developers to define complex task dependencies and execute them efficiently

### Siblings
- [DesignPatterns](./DesignPatterns.md) -- SingletonPattern.java uses a double-checked locking mechanism to ensure thread safety in getInstance() method
- [GraphDatabaseManagement](./GraphDatabaseManagement.md) -- GraphDatabaseAdapter.java uses a connection pool to manage graph database connections, as configured in graph-database-adapter.properties
- [CodingStandards](./CodingStandards.md) -- CodingStandards.java provides a set of guidelines for coding, such as naming conventions and code formatting, as seen in the coding-standards-example.java file
- [ProjectStructure](./ProjectStructure.md) -- ProjectStructure.java provides a set of guidelines for project structure, such as package organization and directory layout, as seen in the project-structure-example.java file

---

*Generated from 7 observations*
