# ConcurrencyController

**Type:** SubComponent

The ConcurrencyController provides methods for workers to pull tasks and update the shared index counters.

## What It Is  

The **ConcurrencyController** is a sub‑component that lives inside the **Trajectory** component.  Although the source snapshot does not expose concrete file paths or symbols, the observations make it clear that the controller’s purpose is to **coordinate concurrent operations** and **distribute work among a pool of workers**.  It does this by exposing a set of methods that allow workers to **pull tasks** and **update shared atomic index counters**, which form the backbone of a **work‑stealing concurrency** strategy.  Errors and exceptions that arise during the execution of these concurrent tasks are also handled internally, ensuring that the overall system remains robust even when individual workers fail.

## Architecture and Design  

The design of the ConcurrencyController revolves around a **shared‑state, lock‑free coordination model**.  The core architectural decision is to employ **atomic index counters** as the synchronization primitive.  Because atomics guarantee read‑modify‑write safety without requiring heavyweight mutexes, the controller can support a high degree of parallelism while keeping contention low.  This choice aligns with a classic **work‑stealing** pattern: each worker queries the controller for the next index, processes the associated unit of work, and then attempts to “steal” additional indices when its own queue is exhausted.  

Within the hierarchy, the ConcurrencyController **contains** a child component named **WorkDistributor**.  The WorkDistributor is responsible for the concrete logic that maps atomic indices to concrete tasks, effectively acting as the “task queue” that workers interact with.  The parent **Trajectory** component owns the ConcurrencyController, meaning that any higher‑level orchestration of a trajectory (e.g., simulation steps, data pipelines) delegates the parallel execution of its sub‑tasks to this controller.  Sibling components such as **PipelineCoordinator** and **ServiceStarter** share the same overall goal of coordinating work, but they do so at different abstraction levels (pipeline‑level orchestration versus service lifecycle management).  The ConcurrencyController’s design therefore complements these siblings by handling fine‑grained, intra‑process parallelism.

## Implementation Details  

The implementation hinges on three tightly coupled concepts:

1. **Shared Atomic Index Counters** – These counters are the single source of truth for task allocation.  Workers invoke a method (implicitly described in the observations as “pull tasks”) that atomically increments the counter and receives the next work index.  Because the operation is atomic, multiple workers can safely request indices concurrently without race conditions.

2. **Work‑Stealing Algorithm** – The “specific concurrency control algorithm” referenced in the observations is a work‑stealing scheme.  When a worker’s local work queue is empty, it queries the ConcurrencyController for additional indices, effectively “stealing” work from the global pool.  This approach balances load dynamically and reduces idle time across workers.

3. **Error‑Handling Pathways** – The controller includes logic to capture exceptions thrown during task execution.  While the exact API is not listed, the observation that it “handles errors and exceptions” implies that any worker‑reported failure is caught, possibly logged, and may trigger a retry or safe termination of the offending worker thread.

The child **WorkDistributor** likely encapsulates the mapping from an index to a concrete task object (e.g., a function closure, a data chunk, or a simulation step).  By keeping this mapping separate, the ConcurrencyController remains agnostic to the nature of the work, focusing solely on coordination and safety.

## Integration Points  

- **Trajectory (Parent)** – The Trajectory component instantiates the ConcurrencyController to parallelize the execution of trajectory‑related workloads.  Calls from Trajectory to the controller are expected to be high‑level “start parallel execution” requests, after which workers interact directly with the controller’s task‑pulling API.

- **WorkDistributor (Child)** – The controller delegates the actual task retrieval to WorkDistributor.  Any changes to how tasks are generated (e.g., switching from batch‑wise to streaming generation) would be localized in WorkDistributor without touching the controller’s coordination logic.

- **Sibling Components** – While not directly coupled, siblings such as **PipelineCoordinator** and **ServiceStarter** may invoke the ConcurrencyController indirectly when they need to parallelize parts of their own workflows.  For example, a pipeline stage could create a set of workers that each call the controller to obtain work indices.

- **External Dependencies** – The observations do not list explicit external libraries, but the reliance on atomic operations suggests the use of a language‑level atomic primitive (e.g., `std::atomic` in C++ or `AtomicInteger` in Java).  No additional messaging or networking layers are indicated, reinforcing that the controller operates entirely within the process boundary.

## Usage Guidelines  

1. **Create Workers that Respect the Pull‑Update Contract** – Each concurrent worker should call the controller’s “pull task” method to obtain the next atomic index and, after completing the associated work, invoke the corresponding “update counter” method if any post‑processing bookkeeping is required.

2. **Design Idempotent Tasks** – Because work‑stealing can lead to the same logical unit being attempted by multiple workers in edge cases (e.g., when a worker crashes after pulling a task), tasks should be safe to retry or be able to detect prior completion.

3. **Handle Exceptions Locally, Propagate to Controller** – Workers must catch their own runtime errors and forward them to the ConcurrencyController’s error‑handling interface so that the controller can decide whether to log, retry, or abort the affected worker.

4. **Avoid Direct Manipulation of the Atomic Counters** – The atomic indices are the controller’s internal synchronization mechanism.  External code should never modify them directly; instead, always use the provided API methods.

5. **Tune the Number of Workers According to Work Granularity** – Since the controller’s algorithm is work‑stealing, oversubscribing the CPU can lead to diminishing returns.  Benchmark the size of each task (as defined by WorkDistributor) and choose a worker pool size that matches the hardware’s parallel capacity.

---

### Summarised Insights  

1. **Architectural patterns identified** – Lock‑free coordination using atomic counters; work‑stealing concurrency model; separation of concerns via a child WorkDistributor.  
2. **Design decisions and trade‑offs** – Preference for atomics over mutexes reduces contention but requires careful task idempotency; work‑stealing improves load balance at the cost of slightly more complex worker logic.  
3. **System structure insights** – ConcurrencyController sits under Trajectory, provides a shared service to sibling components, and delegates task mapping to WorkDistributor.  
4. **Scalability considerations** – The lock‑free atomic design scales well with core count; however, the global counter can become a bottleneck if task acquisition frequency is extremely high.  Work‑stealing mitigates this by allowing workers to fetch multiple indices in bursts if supported.  
5. **Maintainability assessment** – By isolating the coordination logic (ConcurrencyController) from the task generation logic (WorkDistributor), the codebase remains modular.  Adding new task types or changing the distribution strategy only touches WorkDistributor, while the concurrency guarantees stay centralized, simplifying future maintenance.

## Hierarchy Context

### Parent
- [Trajectory](./Trajectory.md) -- The Trajectory component's use of the SpecstoryAdapter class in lib/integrations/specstory-adapter.js allows for flexible connection establishment with the Specstory extension via multiple protocols such as HTTP, IPC, or file watch. This is evident in the way the SpecstoryAdapter class is instantiated and used throughout the component, providing a unified interface for different connection methods. Furthermore, the retry logic with exponential backoff implemented in the startServiceWithRetry function in lib/service-starter.js ensures that connections are re-established in case of failures, enhancing the overall robustness of the component.

### Children
- [WorkDistributor](./WorkDistributor.md) -- The ConcurrencyController uses shared atomic index counters, implying a need for thread-safe distribution of work.

### Siblings
- [SpecstoryConnector](./SpecstoryConnector.md) -- The SpecstoryAdapter class in lib/integrations/specstory-adapter.js is used to establish connections to the Specstory extension.
- [GraphDatabaseManager](./GraphDatabaseManager.md) -- The GraphDatabaseManager uses a graph database to store and retrieve data.
- [LLMInitializer](./LLMInitializer.md) -- The LLMInitializer uses a constructor to initialize the LLM.
- [PipelineCoordinator](./PipelineCoordinator.md) -- The PipelineCoordinator uses a coordinator agent to coordinate tasks and workflows.
- [ServiceStarter](./ServiceStarter.md) -- The ServiceStarter uses the startServiceWithRetry function to retry failed services.
- [SpecstoryAdapterFactory](./SpecstoryAdapterFactory.md) -- The SpecstoryAdapterFactory uses the SpecstoryAdapter class to create SpecstoryAdapter instances.

---

*Generated from 6 observations*
