# HookOrchestrator

**Type:** SubComponent

HookOrchestrator.runHook() implements a work-stealing concurrency model, as implemented in HookOrchestrator.runWithConcurrency(), allowing idle workers to pull hook tasks immediately

## What It Is  

**HookOrchestrator** is the central sub‑component that drives the execution of “hooks” – small units of work that react to events inside the **ConstraintSystem**. Its implementation lives primarily in `HookOrchestrator.ts`, with supporting configuration in `hook-pipeline.yaml`, caching logic in `hook-cache.ts`, and external integration through `validation-agent.ts`. The orchestrator is responsible for discovering hook definitions, wiring them to the topics they subscribe to, persisting their metadata in a graph‑database‑backed store, and running them efficiently across a pool of workers. By pre‑populating hook metadata (`hookType`, `metadata.hookClass`) via `HookOrchestrator.mapHookToAgent()` and caching results in Redis, the component avoids redundant re‑evaluation and provides fast, deterministic responses to downstream agents such as **ValidationAgent**.

---

## Architecture and Design  

The design of **HookOrchestrator** is a composition of several well‑defined patterns that emerge directly from the source observations:

1. **Pub‑Sub (Publish‑Subscribe) Pattern** – Each hook declares the topics it listens to, and the `SubscriptionManager` (implemented inside `HookOrchestrator.ts`) maintains a registry that maps topics to hook callbacks. This enables loose coupling: hooks can be added or removed without touching the core orchestrator logic.

2. **Pipeline‑Based Execution Model** – The orchestrator reads `hook-pipeline.yaml`, where every pipeline step lists explicit `depends_on` edges. This creates a directed acyclic graph (DAG) of hook execution, ensuring that dependent hooks run only after their prerequisites have completed. The pipeline model dovetails with the graph‑database adapter, allowing the system to query execution order and results efficiently.

3. **Work‑Stealing Concurrency** – Execution is driven by `HookOrchestrator.runHook()` which delegates to `HookOrchestrator.runWithConcurrency()`. Workers that finish early “steal” pending hook tasks from the queue, keeping CPU utilization high and reducing latency for idle workers. This model mirrors the concurrency approach used by the parent **ConstraintSystem**.

4. **Graph‑Database Persistence** – Hook metadata and results are persisted through a graph‑database adapter referenced in `HookOrchestrator.ts`. Because hooks and their dependencies naturally form a graph, this storage choice enables fast traversal queries (e.g., “find all hooks that depend on X”) and supports the pipeline’s `depends_on` semantics.

5. **Redis‑Based Result Caching** – The `hook-cache.ts` module provides a Redis cache layer that stores hook outputs. By checking the cache before re‑executing a hook, the orchestrator eliminates unnecessary work, especially for idempotent or frequently‑invoked hooks.

These patterns interact through clearly defined child components:

* **HookPipeline** – defined in `HookOrchestrator.ts`, it parses `hook-pipeline.yaml` and builds the execution DAG.
* **SubscriptionManager** – also in `HookOrchestrator.ts`, it registers subscriptions and notifies hooks when topics are published.
* **HookStore** – again in `HookOrchestrator.ts`, it persists the pre‑populated metadata (via `mapHookToAgent`) into the graph database.

Together they form a cohesive orchestration layer that sits inside the larger **ConstraintSystem**, sharing the same graph‑DB and work‑stealing concurrency foundations used by sibling components such as **StalenessDetector** and **GitHistoryProcessor**.

---

## Implementation Details  

### Core Functions  

* **`HookOrchestrator.mapHookToAgent()`** – When a hook class is discovered, this method injects two critical fields into its metadata: `hookType` (identifying the kind of hook) and `metadata.hookClass` (the concrete class reference). By doing this once at load time, the orchestrator avoids re‑evaluating the same hook definition on every execution cycle.

* **`HookOrchestrator.runHook()`** – The entry point for executing a single hook. It first checks the Redis cache (`hook-cache.ts`) for a stored result; if a hit occurs, the cached payload is returned immediately. Otherwise, the hook is queued for execution.

* **`HookOrchestrator.runWithConcurrency()`** – Implements the work‑stealing scheduler. A pool of worker threads (or async tasks) pulls hook jobs from a shared queue. When a worker becomes idle, it attempts to “steal” a job from another busy worker’s queue, ensuring that all CPU cores stay busy until the pipeline DAG is fully processed.

### Subscription Management  

`SubscriptionManager` builds a map `topic → [hookIds]`. When a hook publishes an event (e.g., a validation result), the manager iterates over the subscriber list and enqueues the corresponding hooks for execution. Because subscriptions are declared explicitly in each hook file, the manager can validate topics at load time, catching mismatches early.

### Pipeline Construction  

`hook-pipeline.yaml` defines each step as:

```yaml
- name: ValidateEntity
  depends_on: [ParseEntity]
  topics: [entity.parsed]
```

The orchestrator reads this file, constructs a DAG, and stores the relationships in the graph database. The `depends_on` edges are also materialized as adjacency lists inside the `HookPipeline` component, enabling fast topological sorting before execution.

### Persistence  

All hook metadata (including the pre‑populated fields from `mapHookToAgent`) are written to the graph database via the adapter imported in `HookOrchestrator.ts`. Queries such as “find all hooks of type Validation” or “retrieve the execution history of Hook X” are performed using graph traversals, which are more efficient than relational joins for this highly connected data.

### Integration with ValidationAgent  

`validation-agent.ts` imports `HookOrchestrator` to register validation‑related hooks. When the ValidationAgent processes a rule, it publishes a topic that the orchestrator’s `SubscriptionManager` routes to the appropriate validation hook. This tight coupling is intentional: the ValidationAgent relies on the orchestrator’s pub‑sub and caching mechanisms to avoid duplicate validation work.

---

## Integration Points  

* **Parent – ConstraintSystem** – HookOrchestrator is a child of **ConstraintSystem**, inheriting the system‑wide graph‑DB adapter and work‑stealing concurrency model. The parent component orchestrates overall constraint enforcement, while HookOrchestrator focuses on the hook‑level granularity.

* **Sibling – ValidationAgent** – Directly consumes HookOrchestrator’s subscription API. ValidationAgent publishes topics that trigger validation hooks, and it also reads cached hook results to accelerate rule evaluation.

* **Sibling – StalenessDetector, EntityContentAnalyzer, GitHistoryProcessor, LSLSessionProcessor** – Although these siblings use different algorithms (git‑based detection, regex matching, session processing), they share the same underlying concurrency and persistence infrastructure. If any of these components emit events that match a hook’s subscription topics, HookOrchestrator will automatically schedule the relevant hooks.

* **Children – HookPipeline, SubscriptionManager, HookStore** – These internal modules expose public methods used by the orchestrator’s public API (`runHook`, `mapHookToAgent`). External code interacts with HookOrchestrator at the high‑level API; the children remain encapsulated implementation details.

* **External Services – Redis (hook-cache.ts) and Graph Database** – The orchestrator depends on a Redis instance for result caching and on a graph‑DB for durable storage. Both are configured via environment variables in the broader system configuration and are assumed to be highly available.

---

## Usage Guidelines  

1. **Declare Subscriptions Explicitly** – When adding a new hook, always list the topics it listens to in the hook file. The `SubscriptionManager` validates these at load time, preventing silent failures.

2. **Define Pipeline Dependencies** – Update `hook-pipeline.yaml` with accurate `depends_on` edges for any new hook that participates in the execution DAG. Missing dependencies can cause deadlocks or out‑of‑order execution.

3. **Leverage Caching** – Hooks that produce deterministic results should be marked as cache‑eligible (e.g., by setting a `cache: true` flag in their metadata). The orchestrator will then store the output in Redis automatically.

4. **Avoid Heavy Computation in Subscription Callbacks** – Subscription callbacks should be lightweight; heavy work belongs in the hook’s `run` method so that the work‑stealing scheduler can balance load across workers.

5. **Persist Metadata Early** – Call `HookOrchestrator.mapHookToAgent()` during module initialization rather than at runtime. This prevents repeated reflection and ensures the graph store contains a complete view of all hooks before any execution begins.

6. **Monitor Queue Saturation** – Since the work‑stealing model relies on a shared queue, monitor its length during peak loads. If the queue consistently grows, consider scaling the worker pool or revisiting hook granularity.

---

### Architectural patterns identified  

1. Pub‑Sub (topic‑based subscription)  
2. Pipeline/DAG execution model (explicit `depends_on` edges)  
3. Work‑Stealing concurrency  
4. Graph‑Database persistence  
5. Redis result caching  

### Design decisions and trade‑offs  

* **Explicit subscription topics** trade‑off: higher upfront effort for hook authors vs. runtime decoupling and safety.  
* **Pre‑populating metadata** reduces per‑execution reflection cost but adds a one‑time loading overhead.  
* **Work‑stealing** improves CPU utilization but introduces complexity in task queue management and requires thread‑safe data structures.  
* **Graph‑DB for metadata** enables fast dependency queries at the cost of requiring a graph database service and associated operational expertise.  
* **Redis caching** accelerates repeated hook calls but adds a dependency on an external cache layer and requires cache invalidation logic for mutable data.

### System structure insights  

HookOrchestrator sits three levels deep: it is a child of **ConstraintSystem**, a peer to other agents, and a parent to three internal modules (HookPipeline, SubscriptionManager, HookStore). All communication flows through well‑defined interfaces: the parent supplies the graph‑DB adapter and concurrency pool; siblings publish events that the SubscriptionManager routes; children expose the pipeline builder, subscription registry, and persistence layer. This layered organization keeps concerns separated—event routing, execution ordering, and data storage are each handled by a dedicated child component.

### Scalability considerations  

* **Horizontal scaling of workers** – Because `runWithConcurrency()` uses a work‑stealing queue, adding more worker threads or processes linearly increases throughput, provided the Redis cache and graph‑DB can handle the additional load.  
* **Cache hit ratio** – High cache effectiveness reduces graph‑DB reads and hook computation, making the system more scalable under bursty traffic.  
* **Pipeline depth** – Deep dependency chains can limit parallelism; designers should keep the DAG as shallow as possible to maximize concurrent execution.  
* **Graph‑DB query performance** – As the number of hooks grows, indexing on `hookType` and dependency edges becomes critical to maintain low‑latency lookups.

### Maintainability assessment  

The orchestrator’s architecture is **highly modular**: each responsibility lives in a dedicated file (`HookOrchestrator.ts` for core logic, `hook-pipeline.yaml` for DAG definition, `hook-cache.ts` for caching). Explicit subscription declarations and pipeline dependencies make the system **self‑documenting**—new developers can understand hook interactions by reading the YAML and subscription lists. However, the reliance on multiple external services (graph‑DB, Redis) introduces **operational complexity**; any change to those services may require coordinated updates. The work‑stealing scheduler, while performant, adds **concurrency intricacy**, demanding careful testing for race conditions. Overall, the design balances performance with clear separation of concerns, resulting in a maintainable codebase provided that documentation around the YAML schema and caching policies is kept up‑to‑date.


## Hierarchy Context

### Parent
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem component is a constraint monitoring and enforcement system that validates code actions and file operations against configured rules during Claude Code sessions. It utilizes various technologies such as Node.js, TypeScript, and GraphQL to build its architecture. The system's key patterns include the use of intelligent routing for database interactions, graph database adapters for persistence, and work-stealing concurrency for efficient data processing. The component also employs a multi-agent system that processes git history and LSL sessions to detect staleness and validate entity content.

### Children
- [HookPipeline](./HookPipeline.md) -- HookPipeline (HookOrchestrator.ts) utilizes a pub-sub pattern, enabling hooks to declare explicit subscription topics and facilitating loose coupling between hooks.
- [SubscriptionManager](./SubscriptionManager.md) -- SubscriptionManager (HookOrchestrator.ts) maintains a registry of hook subscriptions, allowing for efficient lookup and notification of subscribed hooks.
- [HookStore](./HookStore.md) -- HookStore (HookOrchestrator.ts) utilizes a data storage mechanism to persist hook metadata, ensuring that hook information is retained across system restarts.

### Siblings
- [ValidationAgent](./ValidationAgent.md) -- ValidationAgent uses a rules-engine pattern with ValidationRules.ts, each rule declaring explicit conditions and actions
- [StalenessDetector](./StalenessDetector.md) -- StalenessDetector uses a git-based staleness detection algorithm, as seen in StalenessDetector.ts, to identify outdated entity content
- [EntityContentAnalyzer](./EntityContentAnalyzer.md) -- EntityContentAnalyzer uses a regex-based pattern matching algorithm, as seen in EntityContentAnalyzer.ts, to extract file paths and commands from entity content
- [GitHistoryProcessor](./GitHistoryProcessor.md) -- GitHistoryProcessor uses a git-based history processing algorithm, as seen in GitHistoryProcessor.ts, to detect changes and updates in entity content
- [LSLSessionProcessor](./LSLSessionProcessor.md) -- LSLSessionProcessor uses a session-based processing algorithm, as seen in LSLSessionProcessor.ts, to detect changes and updates in entity content


---

*Generated from 7 observations*
