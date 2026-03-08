# WaveController

**Type:** SubComponent

WaveController implements work-stealing via a shared nextIndex counter, allowing idle workers to pull tasks immediately, as seen in the runWithConcurrency method.

## What It Is  

WaveController is a **sub‑component of the KnowledgeManagement module** that orchestrates the execution of “wave agents” – units of work that are processed concurrently.  The only concrete implementation detail that surfaces in the observations is the **`runWithConcurrency`** method, which drives the controller’s core scheduling loop.  Inside that loop a **shared `nextIndex` counter** is used to implement *work‑stealing*: idle workers read and increment the counter to claim the next task without needing a central dispatcher.  Although the exact file location is not listed in the source observations, the component lives under the KnowledgeManagement hierarchy and therefore shares the same persistence layer (Graphology + LevelDB) that the rest of the KnowledgeManagement stack uses.

## Architecture and Design  

The design that emerges from the observations is a **lightweight, shared‑counter work‑stealing scheduler**.  Rather than a heavyweight thread‑pool manager or a message‑queue broker, WaveController relies on a simple atomic counter (`nextIndex`) that all workers consult.  This pattern yields a **pull‑based concurrency model**: each worker repeatedly attempts to “steal” the next index, executes the associated wave agent, and then loops again.  

Because the component is part of KnowledgeManagement, it inherits the **graph‑oriented persistence strategy** (Graphology + LevelDB).  The observations suggest that task‑related metadata—such as assignments, priorities, and worker status—may be stored in that database, enabling fast look‑ups without additional services.  No explicit “event‑driven” or “micro‑service” patterns are mentioned, so the architecture stays within the bounds of a **single‑process, multi‑threaded (or multi‑process) scheduler** that is tightly coupled to the surrounding KnowledgeManagement code base.

Interaction with sibling components is implicit: while WaveController focuses on scheduling, **IntelligentRouter** decides how knowledge‑graph queries are routed, **GraphDatabaseAdapter** provides the low‑level storage primitives, and **ManualLearning / OnlineLearning** feed new tasks into the system.  WaveController therefore sits in the middle of a pipeline that receives tasks from learning modules, stores state via the graph adapter, and dispatches execution to worker threads.

## Implementation Details  

* **`runWithConcurrency`** – the entry point that spins up a configurable number of workers.  Each worker executes a loop that:
  1. Reads the current value of the shared **`nextIndex`** counter atomically.
  2. Increments the counter so the next worker sees a new index.
  3. Retrieves the corresponding wave‑agent payload (likely via a lookup in the Graphology + LevelDB store).
  4. Executes the agent’s logic.
  5. Repeats until the index exceeds the total number of pending agents.

* **Work‑stealing via `nextIndex`** – this counter is the sole coordination primitive.  Because it is shared and updated atomically, there is no need for a central task queue, reducing contention and latency.  The observations do not detail the exact synchronization primitive (e.g., `AtomicInteger`, `Mutex`), but the semantics are clear: *idle workers can instantly pull work*.

* **Task Scheduling Mechanism** – while the exact class name is not given, the description of “utilizes a task scheduling mechanism to manage the execution of wave agents” points to an internal scheduler that likely maps each index to a concrete agent object.  The scheduler may also respect **task prioritization**, as hinted, by ordering indices according to priority or by consulting the Graphology + LevelDB store for priority metadata before workers claim them.

* **Concurrency Handling** – the same `runWithConcurrency` method is referenced as the custom concurrency entry point.  It probably accepts a concurrency level (number of workers) and may expose hooks for monitoring (e.g., number of tasks completed, worker idle time).  No additional concurrency frameworks are mentioned, so the implementation is probably built on native language constructs (threads, async workers, or child processes).

* **Performance Monitoring** – the observations note that WaveController “may utilize performance monitoring and optimization techniques.”  This could be realized through instrumentation inside the worker loop (timing each task, tracking queue length) and feeding those metrics back to the KnowledgeManagement layer for adaptive tuning.

## Integration Points  

1. **GraphDatabaseAdapter (storage/graph-database-adapter.ts)** – provides the persistence API used by WaveController to read/write task descriptors, worker status, and possibly priority information.  Because the parent KnowledgeManagement component already relies on Graphology + LevelDB, WaveController’s data access is consistent with the rest of the system.

2. **IntelligentRouter** – while not directly invoked by WaveController, the router’s decision‑making about whether to use the VKB API or direct database access can affect how wave agents retrieve or store knowledge.  WaveController’s agents may call into the router when they need to resolve graph queries.

3. **ManualLearning & OnlineLearning** – these sibling components generate new knowledge‑extraction tasks that eventually become wave agents.  WaveController therefore depends on the output of these modules, either via a shared task queue or by reading newly inserted records in the graph database.

4. **UKBTraceReportGenerator** – may consume the results produced by wave agents (e.g., trace logs) and thus represents a downstream consumer of WaveController’s output.

5. **Concurrency Configuration** – the `runWithConcurrency` method likely exposes an API that other components (e.g., a higher‑level orchestrator in KnowledgeManagement) can call to adjust the degree of parallelism based on system load or resource availability.

## Usage Guidelines  

* **Configure Concurrency Wisely** – invoke `runWithConcurrency` with a worker count that matches the host’s CPU cores and expected I/O profile.  Over‑provisioning can increase context‑switch overhead without improving throughput, while under‑provisioning leaves the work‑stealing mechanism under‑utilized.

* **Persist Task Metadata Before Scheduling** – ensure that any wave agent’s definition (including priority, dependencies, and required resources) is stored in the Graphology + LevelDB store *prior* to invoking the scheduler.  This guarantees that workers can locate the task data when they pull the next index.

* **Leverage Prioritization if Available** – if the system exposes a priority field in the task records, order the indices accordingly (e.g., high‑priority tasks receive lower indices).  This works naturally with the shared‑counter approach because workers always claim the lowest remaining index.

* **Monitor Performance** – instrument the worker loop (start/end timestamps, success/failure counts) and feed those metrics to the KnowledgeManagement monitoring subsystem.  This data can be used to tune the concurrency level or to identify bottlenecks in the graph database access path.

* **Graceful Shutdown** – when terminating the controller, signal workers to stop after completing their current task.  Because the work‑stealing loop checks the `nextIndex` against the total task count, a shutdown flag can be introduced without altering the core scheduling algorithm.

---

### Architectural Patterns Identified
1. **Work‑Stealing Scheduler** – implemented via a shared atomic `nextIndex` counter.
2. **Pull‑Based Concurrency** – workers actively fetch work rather than being pushed tasks.
3. **Graph‑Oriented Persistence** – reliance on Graphology + LevelDB for task metadata.

### Design Decisions and Trade‑offs
* **Simplicity vs. Flexibility** – using a single counter avoids complex queue structures, reducing contention but limits dynamic task re‑ordering after workers have started.
* **Tight Coupling to Graph Database** – storing task state in the same graph store used by KnowledgeManagement simplifies data access but couples scheduling performance to the database’s read latency.
* **In‑process Scheduling** – keeping the scheduler inside the KnowledgeManagement process eliminates network overhead but may constrain scalability to a single machine.

### System Structure Insights
WaveController sits at the heart of KnowledgeManagement’s execution pipeline, bridging task creation (ManualLearning/OnlineLearning) and result consumption (UKBTraceReportGenerator).  Its only external dependency is the GraphDatabaseAdapter, and it shares the same persistence layer as its siblings.

### Scalability Considerations
* **Horizontal Scaling** – because the scheduler relies on a shared in‑process counter, scaling beyond a single host would require redesign (e.g., distributed counter or external queue).  
* **CPU‑Bound vs. I/O‑Bound Workloads** – the work‑stealing model scales well for CPU‑intensive agents; for I/O‑heavy agents, increasing the worker count may improve throughput but could saturate the LevelDB store.

### Maintainability Assessment
The design’s minimalism (single counter, straightforward worker loop) makes the code easy to understand and modify.  However, the lack of explicit abstractions (e.g., a dedicated task queue interface) could make future extensions—such as priority re‑balancing or distributed execution—more invasive.  Keeping task metadata schema stable in the Graphology + LevelDB store will be essential to avoid breaking the scheduler’s assumptions.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component's utilization of a Graphology+LevelDB database for persistence, as seen in the GraphDatabaseAdapter (storage/graph-database-adapter.ts), allows for efficient storage and querying of knowledge graphs. This choice of database is particularly noteworthy due to its ability to handle large amounts of data and provide a robust foundation for the component's intelligent routing mechanism. The intelligent routing, which switches between VKB API and direct database access, enables the component to optimize its interactions with the knowledge graph, thus improving overall performance. For instance, when an agent needs to store an entity, it can use the storeEntity method in GraphDatabaseAdapter, which ultimately relies on the Graphology+LevelDB database for persistence.

### Siblings
- [ManualLearning](./ManualLearning.md) -- ManualLearning likely utilizes the storeEntity method in GraphDatabaseAdapter (storage/graph-database-adapter.ts) to persist manually created entities.
- [OnlineLearning](./OnlineLearning.md) -- OnlineLearning probably utilizes a batch analysis pipeline, similar to the one described in batch-analysis.yaml, to extract knowledge from git history and other sources.
- [UKBTraceReportGenerator](./UKBTraceReportGenerator.md) -- UKBTraceReportGenerator probably utilizes a report generation mechanism to create detailed trace reports for UKB workflow runs.
- [GraphDatabaseAdapter](./GraphDatabaseAdapter.md) -- GraphDatabaseAdapter utilizes the Graphology+LevelDB database for storing and querying knowledge graphs, as seen in the storeEntity method.
- [IntelligentRouter](./IntelligentRouter.md) -- IntelligentRouter utilizes the VKB API and direct database access to optimize interactions with the knowledge graph, as seen in the intelligent routing mechanism.


---

*Generated from 7 observations*
