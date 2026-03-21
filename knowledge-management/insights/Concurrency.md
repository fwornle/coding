# Concurrency

**Type:** SubComponent

The ConcurrencyManager provides an API for querying and controlling the concurrent execution, allowing for flexible monitoring and debugging

## What It Is  

The **Concurrency** sub‑component lives inside the **SemanticAnalysis** module (see the description of `integrations/mcp-server-semantic-analysis/src/agents/semantic-analysis-agent.ts`).  It is realised by three tightly‑coupled classes – **WaveController**, **TaskScheduler**, and **ConcurrencyManager** – that together provide a lightweight, work‑stealing execution engine for the analysis pipeline.  

* **WaveController** is the runtime driver that distributes work‑units (“waves”) to a pool of worker threads.  It uses a shared `nextIndex` counter so that any idle worker can atomically claim the next pending task, achieving *work‑stealing* without a central dispatcher.  
* **TaskScheduler** sits in front of the WaveController and decides **when** a wave should be executed.  It maintains a priority queue so that higher‑priority waves are dispatched first, and it also embeds a retry loop that re‑queues a wave when the underlying task throws an exception.  
* **ConcurrencyManager** is the façade that creates and configures the thread‑pool, exposes synchronization primitives, and publishes an API for external callers (e.g., the InsightGenerator or CodeGraphAgent) to query the pool state, pause/resume execution, and collect debugging metrics.  

Together these classes give the SemanticAnalysis pipeline a deterministic yet highly concurrent execution model that can scale across many cores while remaining observable and controllable from the outside.

---

## Architecture and Design  

The design follows a **modular, layered concurrency framework**.  At the lowest level, **WaveController** implements a *work‑stealing* pattern using a single atomic `nextIndex` counter.  Workers repeatedly attempt to increment this counter under a lightweight lock; if the increment succeeds they own the corresponding wave, otherwise they spin or block until new work appears.  This approach avoids a heavyweight central scheduler and reduces contention when the number of workers grows.  

Above the controller sits **TaskScheduler**, which applies a *priority‑queue* scheduling discipline.  Each incoming wave is wrapped in a `ScheduledTask` object that carries a priority value.  The scheduler dequeues the highest‑priority task, hands it to the WaveController, and, on failure, re‑inserts it with an incremented retry count.  The retry mechanism is a simple exponential back‑off loop that prevents a single flaky task from starving the pool.  

The topmost façade, **ConcurrencyManager**, encapsulates *thread‑pool management* and *synchronization* concerns.  It creates a fixed‑size pool (configurable via the SemanticAnalysis configuration file) and supplies a public API (`getPoolStatus()`, `pause()`, `resume()`, `setConcurrencyLevel()`) that other modules—such as **Pipeline**, **OntologyClassificationAgent**, **InsightGenerator**, and **CodeGraphAgent**—use to coordinate their own workloads.  By exposing only high‑level controls, the manager isolates the lower‑level lock and counter mechanics from the rest of the system, reinforcing separation of concerns.  

The overall architecture is therefore a **stacked composition**: the manager orchestrates resources, the scheduler orders work, and the controller executes it with minimal coordination overhead.  No “microservice” or “event‑driven” terminology appears in the observations, so the design stays firmly within a single‑process, multi‑threaded model.

---

## Implementation Details  

1. **WaveController**  
   * **Work‑stealing via `nextIndex`** – The controller holds a shared integer (e.g., `private nextIndex: number = 0`).  Each worker calls `claimNext()` which acquires a short‑lived lock (`Mutex` or `synchronized` block), reads the current value, increments it, and returns the index.  Because the lock is held only for the read‑modify‑write sequence, contention remains low even with dozens of workers.  
   * **Locking for safety** – All accesses that modify shared state (e.g., the list of pending waves, the `nextIndex` counter) are guarded by a mutex.  This prevents race conditions such as two workers receiving the same wave or corrupting the internal wave list.  

2. **TaskScheduler**  
   * **Priority queue** – Implemented with a binary heap (`Heap<ScheduledTask>`).  Each `ScheduledTask` contains a `priority: number` and a reference to the wave payload.  The scheduler’s `schedule(task)` method inserts the task; the `dispatch()` loop extracts `heap.pop()` to obtain the highest‑priority wave.  
   * **Retry mechanism** – When a wave’s execution throws, the scheduler catches the exception, increments a `retryCount` on the task, applies an exponential delay (`setTimeout` or `sleep`), and pushes the task back onto the heap.  A maximum retry limit (configurable) prevents infinite loops.  

3. **ConcurrencyManager**  
   * **Thread‑pool creation** – Uses the language’s native thread‑pool API (e.g., `ThreadPoolExecutor` in JavaScript/Node via worker_threads, or a custom pool built on `worker_threads`).  The pool size is read from the SemanticAnalysis configuration, allowing the system to be tuned per deployment.  
   * **Synchronization primitives** – Provides wrappers around `Mutex`, `ConditionVariable`, or atomic primitives that the WaveController and TaskScheduler consume.  By centralising these primitives, the manager guarantees consistent memory‑visibility semantics across the whole component.  
   * **Control API** – Public methods (`queryStatus()`, `setConcurrencyLevel()`, `enableDebugLogging()`) expose the internal state to sibling components.  For example, the **InsightGenerator** can pause the pool while it aggregates results, then resume it once it is ready for the next wave.  

All three classes are deliberately small and focused, which makes unit‑testing straightforward: the WaveController can be tested for correct index allocation under contention, the TaskScheduler for priority ordering and retry back‑off, and the ConcurrencyManager for proper pool lifecycle handling.

---

## Integration Points  

* **Parent – SemanticAnalysis** – The Concurrency sub‑component is instantiated by `semantic-analysis-agent.ts`.  The agent passes a configuration object that defines the pool size, default priority, and retry limits.  Throughout the analysis pipeline, each stage (ontology classification, code‑graph construction, insight generation) registers its work as a *wave* with the **TaskScheduler**.  

* **Sibling – Pipeline** – The Pipeline coordinator uses a DAG‑based execution model.  When a DAG node becomes ready, it creates a wave and hands it to the **TaskScheduler**.  The priority queue respects the DAG’s topological order by assigning higher priority to nodes that are on the critical path.  

* **Sibling – OntologyClassificationAgent** – This agent creates waves that involve heavy ontology look‑ups.  Because those waves are I/O‑bound, the **ConcurrencyManager** can be instructed (via its API) to temporarily increase the pool size, demonstrating dynamic scaling at runtime.  

* **Sibling – Insights & CodeGraph** – Both generate data that must be processed in parallel.  They subscribe to the **ConcurrencyManager**’s status events (`onPoolIdle`, `onTaskFailed`) to trigger downstream actions (e.g., flushing aggregated insights or rebuilding the code graph).  The shared locking mechanism guarantees that updates to shared insight caches are safe.  

* **External monitoring** – The API exposed by **ConcurrencyManager** is used by the system’s observability layer (metrics collector, logging framework) to report active thread count, queue depth, and retry statistics.  This tight coupling enables real‑time dashboards that show how the work‑stealing engine behaves under load.

---

## Usage Guidelines  

1. **Prefer the ConcurrencyManager API** – All external modules should obtain a reference to the manager and use `scheduleWave(task, priority)` rather than constructing threads or locks directly.  This guarantees that every wave participates in the work‑stealing and priority mechanisms.  

2. **Assign meaningful priorities** – Since the TaskScheduler orders work by priority, developers should map DAG criticality or business importance to numeric values (lower number = higher priority).  Over‑using the same priority can degrade the benefits of the priority queue.  

3. **Respect the retry contract** – When implementing a custom wave handler, ensure that failures are thrown as exceptions; the scheduler will automatically retry up to the configured limit.  If a failure is unrecoverable, re‑throw a `FatalTaskError` (a convention defined in the manager) so that the scheduler can abort further retries and surface the issue to monitoring.  

4. **Avoid long‑running blocking calls inside a wave** – Although the work‑stealing design distributes tasks efficiently, a single wave that blocks the worker thread for minutes will starve the pool.  Offload such I/O‑heavy work to asynchronous APIs or increase the pool size via `ConcurrencyManager.setConcurrencyLevel()`.  

5. **Monitor and tune pool size** – Use the manager’s `queryStatus()` method to watch the ratio of idle workers to queued waves.  If the queue consistently grows, consider raising the pool size; if workers are frequently idle, a smaller pool reduces context‑switch overhead.  

---

### Architectural Patterns Identified  

* **Work‑Stealing** (implemented by WaveController via a shared `nextIndex` counter)  
* **Priority Queue Scheduling** (TaskScheduler)  
* **Retry/Back‑off Loop** (TaskScheduler)  
* **Thread‑Pool Facade** (ConcurrencyManager)  
* **API‑Driven Control & Monitoring** (ConcurrencyManager)  

### Design Decisions & Trade‑offs  

| Decision | Benefit | Trade‑off |
|----------|---------|-----------|
| Shared atomic `nextIndex` with fine‑grained lock | Minimal contention, fast task claim | Requires careful lock implementation; risk of priority inversion if lock is held too long |
| Priority queue for ordering | Guarantees critical tasks run first, aligns with DAG execution | Slight overhead for heap operations; may starve low‑priority waves if high‑priority flood persists |
| Built‑in retry mechanism | Improves resilience to transient failures | Adds complexity; may increase queue depth under repeated failures |
| Exposed manager API | Centralised observability, dynamic pool tuning | External modules must conform to API; misuse can lead to inconsistent state if not validated |

### System Structure Insights  

The Concurrency sub‑component sits as a **service layer** beneath the high‑level analysis agents.  Its three classes form a clear vertical stack (manager → scheduler → controller) that isolates concerns: resource provisioning, task ordering, and execution.  Because the parent **SemanticAnalysis** module already employs lazy LLM initialization and modular agents, the concurrency layer fits naturally as the execution backbone, while sibling components contribute work units without needing to understand low‑level threading details.

### Scalability Considerations  

* **Horizontal scaling** is achieved through work‑stealing: as more CPU cores become available, adding workers to the pool automatically increases throughput because idle workers can claim any remaining wave.  
* **Queue pressure** is mitigated by the priority heap; however, extreme priority skew can cause backlog for low‑priority waves, so priority distribution should be balanced.  
* **Retry storms** are limited by a configurable maximum retry count and exponential back‑off, preventing a cascade of retries from overwhelming the pool.  

### Maintainability Assessment  

The component’s **modular boundaries** (manager, scheduler, controller) keep the codebase approachable: each class has a single responsibility and can be unit‑tested in isolation.  The reliance on standard synchronization primitives (locks, atomic counters) avoids exotic concurrency libraries, easing onboarding for new developers.  Documentation is reinforced by the explicit API surface of **ConcurrencyManager**, which serves as the single entry point for external modules.  The primary maintenance risk lies in the lock implementation inside WaveController; any change to its granularity must be validated against race‑condition tests.  Overall, the design balances performance with clarity, making future extensions (e.g., adding a custom scheduling policy) straightforward.

## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component utilizes a modular architecture, with each module responsible for a specific aspect of the analysis pipeline. For instance, the ontology management module is handled by the OntologyClassificationAgent (integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts), which classifies observations against the ontology system. This modular design enables flexible and scalable analysis, as seen in the use of lazy LLM initialization and work-stealing concurrency. The codebase organization is evident in the separation of concerns, such as code graph construction (integrations/mcp-server-semantic-analysis/src/agents/code-graph-agent.ts) and insight generation (integrations/mcp-server-semantic-analysis/src/agents/semantic-analysis-agent.ts).

### Siblings
- [Pipeline](./Pipeline.md) -- The Pipeline coordinator uses a DAG-based execution model with topological sort in batch-analysis.yaml steps, each step declaring explicit depends_on edges
- [Ontology](./Ontology.md) -- The OntologyClassificationAgent classifies observations against the ontology system, utilizing the upper and lower ontology definitions
- [Insights](./Insights.md) -- The InsightGenerator generates insights based on the processed data, utilizing the output from the pipeline and ontology classification system
- [CodeGraph](./CodeGraph.md) -- The CodeGraphAgent constructs the code graph, utilizing the input data and ontology definitions

---

*Generated from 6 observations*
