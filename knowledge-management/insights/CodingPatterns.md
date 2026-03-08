# CodingPatterns

**Type:** Component

The component employs the BaseAgent class (integrations/mcp-server-semantic-analysis/src/agents/BaseAgent.ts) as a foundation for all agents. This class provides a standard interface for agents, ensuring consistency and simplifying the development of new agents. The OntologyClassificationAgent (integrations/mcp-server-semantic-analysis/src/agents/ontology/OntologyClassificationAgent.ts) is a specific example of an agent built on top of the BaseAgent class, and is responsible for providing classified observations from the Ontology system. By leveraging the BaseAgent class, the OntologyClassificationAgent can focus on its specific task without worrying about the underlying implementation details.

## What It Is  

The **CodingPatterns** component lives under the `Coding` knowledge‑management hierarchy and is implemented primarily in the source tree at  

* `storage/graph-database-adapter.ts` – the GraphDatabaseAdapter that all sub‑modules use for persisting and retrieving knowledge entities.  
* `integrations/mcp-server-semantic-analysis/src/agents/BaseAgent.ts` – the abstract BaseAgent that supplies a common contract for every agent that the component creates.  
* `integrations/mcp-server-semantic-analysis/src/agents/ontology/OntologyClassificationAgent.ts` – a concrete agent that demonstrates the BaseAgent contract.  
* `wave-controller.ts:489` – the `runWithConcurrency()` routine that drives work‑stealing execution.  
* `hook-registry.ts` – the modular hook registration system.  
* `leveldb-database.ts` – the LevelDB‑backed store that underpins the graph database.

In short, **CodingPatterns** is the part of the overall *Coding* system that orchestrates the ingestion, classification, and storage of coding‑related knowledge patterns. It does so by coupling a high‑performance LevelDB‑based graph store (via the GraphDatabaseAdapter) with a set of lightweight agents (built on BaseAgent) that lazily initialise large language models (LLMs) only when required, and it executes heavy‑weight workloads using a work‑stealing concurrency model. Hook registration gives the component a pluggable extension point for additional processing stages.

---

## Architecture and Design  

### Adapter‑Centric Persistence  
The component adopts an **Adapter pattern** through `storage/graph-database-adapter.ts`. This class hides the details of the underlying LevelDB implementation (`leveldb-database.ts`) and presents a uniform API (`getGraph`, `saveGraph`, etc.) to all child modules – *OntologyIntegration*, *GraphDatabaseManagement* and *DataIngestion*. By delegating to LevelDB the component gains fast key‑value access while remaining agnostic to the concrete storage engine; the same adapter is also used by sibling components such as *KnowledgeManagement* and *ConstraintSystem*, reinforcing a shared persistence contract across the code base.

### Agent‑Based Extensibility  
All agents inherit from `integrations/mcp-server-semantic-analysis/src/agents/BaseAgent.ts`. This establishes a **Template/Strategy**‑like contract: each derived class (e.g., `OntologyClassificationAgent.ts`) only needs to implement its domain‑specific logic while the BaseAgent supplies lifecycle hooks, error handling, and a predictable interface. The pattern reduces duplication and guarantees that any new agent introduced under the *CodingPatterns* umbrella will behave consistently with the rest of the system, mirroring the approach used by the *LiveLoggingSystem* sibling that also consumes the OntologyClassificationAgent.

### Lazy LLM Initialization  
Wave‑style agents follow a three‑step sequence:  

1. **Constructor** – receives `(repoPath, team)` but does **not** instantiate the LLM.  
2. **ensureLLMInitialized()** – checks an internal flag and, if necessary, creates the LLM instance.  
3. **execute(input)** – runs the model once it is guaranteed to exist.

This is a classic **Lazy Initialization** pattern that minimizes memory‑pressure and start‑up latency, especially important when many agents may be instantiated but only a subset actually need an LLM. The pattern is explicitly mentioned in the observations and is shared with the *LLMAbstraction* sibling, which also relies on dependency‑injected LLM services.

### Work‑Stealing Concurrency  
The `runWithConcurrency()` function in `wave-controller.ts` (line 489) implements a **Work‑Stealing** model using a single shared atomic index counter. Workers atomically fetch the next task index, execute the associated work, and continue until the counter exceeds the task list size. This eliminates the need for heavyweight locks, scales efficiently across CPU cores, and provides deterministic progress tracking. The same concurrency primitive is leveraged by other high‑throughput components (e.g., *Trajectory* when handling multiple integration streams), demonstrating a system‑wide preference for lock‑free parallelism.

### Hook Registration (Publish‑Subscribe)  
`hook-registry.ts` supplies a **Publish‑Subscribe**‑style registry. Modules can **register** a hook with a unique identifier, and the core controller later **dispatches** events to all registered callbacks. Because the registry is modular, new hooks can be added without touching the core execution loop, supporting extensibility for future pattern‑analysis pipelines. This design mirrors the modularity seen in the *DockerizedServices* sibling, where services are discovered and started via a registry‑like mechanism.

---

## Implementation Details  

### GraphDatabaseAdapter (`storage/graph-database-adapter.ts`)  
* Provides methods such as `getGraph()` and `saveGraph()` that either route to a remote VKB API or fall back to the local LevelDB instance (`leveldb-database.ts`).  
* Handles **automatic JSON export sync**, ensuring that any mutation to the graph is mirrored to a JSON representation used by downstream components (e.g., for UI rendering or export).  
* The adapter is a singleton per process, guaranteeing a single point of coordination for all graph operations across *OntologyIntegration*, *GraphDatabaseManagement*, and *DataIngestion*.

### LevelDB Backend (`leveldb-database.ts`)  
* Wraps the native LevelDB library with a thin promise‑based API.  
* Stores graph nodes and edges as serialized JSON blobs keyed by their identifiers, enabling rapid point‑lookup and range scans.  
* Designed for **fault tolerance**: on error it attempts automatic recovery and logs the failure, a behavior inherited by the adapter’s error‑handling path.

### BaseAgent (`integrations/mcp-server-semantic-analysis/src/agents/BaseAgent.ts`)  
* Defines abstract methods `initialize()`, `process(input)`, and `shutdown()`.  
* Supplies a **state machine** that tracks whether the agent is idle, initializing, or active, which is consulted by `ensureLLMInitialized()`.  
* Implements generic logging and telemetry hooks that are automatically wired into the hook registry, so any derived agent (e.g., `OntologyClassificationAgent.ts`) benefits from consistent observability.

### OntologyClassificationAgent (`.../ontology/OntologyClassificationAgent.ts`)  
* Extends BaseAgent and overrides `process(input)` to call the ontology service, map raw observations to ontology concepts, and return classified results.  
* Relies on the GraphDatabaseAdapter to persist classification outcomes, thereby keeping the knowledge graph up‑to‑date.

### Lazy LLM Flow  
* The constructor stores `repoPath` and `team` but leaves the LLM reference `null`.  
* `ensureLLMInitialized()` checks a boolean flag; if false, it resolves the appropriate LLM mode via the `LLMService` (found in the *LLMAbstraction* sibling) and creates the model instance.  
* Subsequent calls to `execute(input)` bypass the check, delivering low‑latency inference after the first warm‑up.

### Work‑Stealing (`wave-controller.ts:runWithConcurrency`)  
```ts
let atomicIdx = new AtomicInteger(0);
await Promise.all(workers.map(async () => {
  while (true) {
    const i = atomicIdx.getAndIncrement();
    if (i >= tasks.length) break;
    await tasks[i]();
  }
}));
```
* The `AtomicInteger` abstraction is provided by the runtime (Node.js worker threads or a custom shim).  
* This loop guarantees that each worker always has work until the task list is exhausted, achieving near‑optimal CPU utilisation without explicit mutexes.

### Hook Registry (`hook-registry.ts`)  
* Exposes `registerHook(name: string, fn: HookFn)` and `triggerHook(name: string, payload)`.  
* Internally stores hooks in a `Map<string, Set<HookFn>>`, allowing multiple listeners per event.  
* The registry is imported by both the concurrency controller (to fire `onTaskStart`/`onTaskComplete`) and by agents (to fire `onClassificationDone`).

---

## Integration Points  

1. **Graph Persistence** – All child modules (*OntologyIntegration*, *GraphDatabaseManagement*, *DataIngestion*) call into `GraphDatabaseAdapter`. The same adapter is also used by the sibling *KnowledgeManagement* component, creating a shared persistence layer across the *Coding* family.  

2. **Ontology Service** – `OntologyClassificationAgent` reaches out to the central Ontology system (via the OntologyClassificationAgent path) and stores results back through the adapter. This mirrors the usage in *LiveLoggingSystem*, which also depends on the same OntologyClassificationAgent for observation classification.  

3. **LLM Service** – Lazy LLM initialisation defers to the `LLMService` class found in the *LLMAbstraction* sibling. The component therefore respects the dependency‑injection contract defined there (e.g., mock service, budget tracker).  

4. **Concurrency Engine** – `runWithConcurrency()` is invoked by any wave‑style agent that needs to process large batches (e.g., bulk pattern extraction). The work‑stealing approach is compatible with the thread‑pool implementation used by *Trajectory* for handling parallel HTTP/IPC/file‑watch streams.  

5. **Hook System** – External modules can register custom processing steps (e.g., a metrics collector or a post‑processing transformer) via `hook-registry.ts`. This extensibility point is also consumed by the *DockerizedServices* starter script, which registers health‑check hooks for each container.  

6. **Parent‑Child Relationship** – As a child of the root *Coding* component, CodingPatterns inherits global configuration (e.g., repository root, team identifiers) that are passed through the constructors of agents. Its siblings share the same configuration source, ensuring consistent environment handling across the entire knowledge‑management suite.

---

## Usage Guidelines  

* **Persist via the Adapter** – Always read or write graph data through `GraphDatabaseAdapter`. Direct access to `leveldb-database.ts` bypasses the JSON export sync and may lead to inconsistency.  

* **Follow the Lazy‑LLM Contract** – When creating a new wave‑style agent, implement the three‑step pattern (`constructor(repoPath, team) → ensureLLMInitialized() → execute(input)`). Do not instantiate the LLM in the constructor; let `ensureLLMInitialized()` handle mode resolution via the injected `LLMService`.  

* **Register Hooks Early** – If a module needs to react to classification or concurrency events, call `registerHook()` during module initialization (before any tasks are scheduled). Hooks are invoked synchronously, so keep callbacks short or off‑load heavy work to the work‑stealing pool.  

* **Prefer Work‑Stealing for Bulk Work** – For any batch operation (e.g., ingesting a large set of code snippets), call `runWithConcurrency()` and supply an array of async task functions. Do not manually spawn additional worker threads; the atomic index counter already provides optimal load balancing.  

* **Error Handling** – Propagate errors from the adapter or LLM through the BaseAgent’s `shutdown()` method. The BaseAgent automatically logs the failure and triggers the `onAgentError` hook, giving downstream observers a chance to react.  

* **Testing** – Use the mock LLM service injected by *LLMAbstraction* to unit‑test agents without incurring real model load. The mock also respects the lazy‑initialisation contract, allowing tests to verify that `ensureLLMInitialized()` is called exactly once per agent lifecycle.  

---

### Architectural patterns identified  

1. **Adapter pattern** – `GraphDatabaseAdapter` abstracts LevelDB and remote VKB API.  
2. **Template/Strategy pattern** – `BaseAgent` defines a reusable agent lifecycle.  
3. **Lazy Initialization** – LLMs are created on‑demand via `ensureLLMInitialized()`.  
4. **Work‑Stealing concurrency** – Shared atomic index in `runWithConcurrency()`.  
5. **Publish‑Subscribe (Observer)** – `hook-registry.ts` enables modular hook registration.

### Design decisions and trade‑offs  

| Decision | Benefit | Trade‑off |
|----------|---------|-----------|
| Use LevelDB via an adapter | High‑speed local storage, simple key‑value ops, automatic JSON sync | Embedded DB limits distributed deployment; requires careful backup strategy |
| BaseAgent inheritance | Guarantees uniform agent API, reduces duplication | Tight coupling to BaseAgent may make radical redesign harder |
| Lazy LLM init | Saves memory and start‑up time when many agents exist | First inference incurs warm‑up latency; must guard against race conditions |
| Work‑stealing with atomic counter | Near‑optimal CPU utilisation, no explicit locks | Relies on atomic primitives that may not be available on all runtimes; debugging parallel progress can be harder |
| Hook registry | Extensible, decouples core logic from optional features | Indirect call paths can obscure flow; excessive hooks may affect performance |

### System structure insights  

* **Vertical layering** – Persistence (LevelDB) → Adapter → Domain services (agents) → Concurrency controller → Hook system.  
* **Shared foundations** – The same GraphDatabaseAdapter and concurrency primitives are reused by siblings (*KnowledgeManagement*, *ConstraintSystem*, *Trajectory*), indicating a deliberate effort to avoid duplication across the *Coding* family.  
* **Child‑module responsibilities** – *OntologyIntegration*, *GraphDatabaseManagement*, and *DataIngestion* each focus on a specific aspect of knowledge handling but all delegate storage to the central adapter, reinforcing a clear separation of concerns.

### Scalability considerations  

* **Storage** – LevelDB scales well on a single machine and can handle millions of nodes/edges; however, horizontal scaling would require sharding or moving to a distributed graph store.  
* **Concurrency** – Work‑stealing allows the component to saturate multi‑core CPUs; adding more workers linearly improves throughput until I/O (LevelDB reads/writes) becomes the bottleneck.  
* **LLM usage** – Lazy init prevents unnecessary model loads, but the system’s overall scalability will depend on the LLM provider’s rate limits and latency; injecting a pooled LLM service could improve throughput for high‑frequency agents.  
* **Hook system** – Because hooks run in the same event loop, a misbehaving hook can stall the pipeline; developers should keep hooks lightweight or dispatch heavy work to the work‑stealing pool.

### Maintainability assessment  

The component exhibits **high maintainability** due to:

* **Clear abstraction boundaries** (adapter, base agent, hook registry) that isolate changes.  
* **Re‑use of proven patterns** (lazy init, work‑stealing) that are well‑understood and documented in the codebase.  
* **Modular hook registration** that lets new functionality be added without touching core logic.  
* **Consistent naming and file organization** – all related files live under `storage/` and `integrations/.../agents/`, making discovery straightforward.  

Potential maintenance risks include the reliance on a single‑process LevelDB instance (harder to upgrade to a distributed store) and the complexity of debugging concurrent work‑stealing tasks. Proper test coverage (using the mock LLM service) and observability hooks mitigate these concerns.


## Hierarchy Context

### Parent
- [Coding](./Coding.md) -- Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 8 major components: LiveLoggingSystem: The LiveLoggingSystem component utilizes the OntologyClassificationAgent, located in integrations/mcp-server-semantic-analysis/src/agents/ontology-cla; LLMAbstraction: The LLMAbstraction component uses dependency injection to set functions that resolve the current LLM mode, mock service, repository path, budget track; DockerizedServices: The DockerizedServices component utilizes a microservices architecture, with each service having its own container and communication happening through; Trajectory: The Trajectory component's architecture is designed to handle multiple integration methods, including HTTP, IPC, and file watch, as seen in the Specst; KnowledgeManagement: The KnowledgeManagement component utilizes a GraphDatabaseAdapter (storage/graph-database-adapter.ts) to handle graph database persistence, which is a; CodingPatterns: The CodingPatterns component utilizes the GraphDatabaseAdapter (storage/graph-database-adapter.ts) for storing and retrieving knowledge entities. This; ConstraintSystem: The ConstraintSystem component utilizes the GraphDatabaseAdapter, located in storage/graph-database-adapter.ts, for storing and retrieving graph data.; SemanticAnalysis: The SemanticAnalysis component employs a modular architecture, with each agent responsible for a specific task, such as the OntologyClassificationAgen.

### Children
- [OntologyIntegration](./OntologyIntegration.md) -- OntologyIntegration uses the GraphDatabaseAdapter (storage/graph-database-adapter.ts) to store and retrieve knowledge entities, providing a standardized interface for interacting with the graph database.
- [GraphDatabaseManagement](./GraphDatabaseManagement.md) -- GraphDatabaseManagement uses the GraphDatabaseAdapter (storage/graph-database-adapter.ts) to provide a standardized interface for interacting with the graph database.
- [DataIngestion](./DataIngestion.md) -- DataIngestion uses the GraphDatabaseAdapter (storage/graph-database-adapter.ts) to store and retrieve knowledge entities, providing a standardized interface for interacting with the graph database.

### Siblings
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- The LiveLoggingSystem component utilizes the OntologyClassificationAgent, located in integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts, to classify observations against the ontology system. This agent plays a crucial role in the system's architecture, enabling the classification of observations based on predefined ontologies. The classification process involves the agent analyzing the observations and mapping them to specific concepts within the ontology system. This mapping is essential for providing a structured representation of the observations, facilitating their storage, retrieval, and analysis. The OntologyClassificationAgent's functionality is critical to the overall operation of the LiveLoggingSystem, as it enables the system to organize and make sense of the vast amounts of data generated during live sessions.
- [LLMAbstraction](./LLMAbstraction.md) -- The LLMAbstraction component uses dependency injection to set functions that resolve the current LLM mode, mock service, repository path, budget tracker, sensitivity classifier, and quota tracker in the LLMService class (lib/llm/llm-service.ts). This design decision allows for flexibility and testability, as different implementations can be easily swapped in. The resolveMode method in LLMService, which determines the LLM mode based on the agent ID and other factors, is a good example of this. The method takes into account various parameters, such as the agent ID, to decide which LLM mode to use, and returns the corresponding mode. This approach enables the component to adapt to different scenarios and requirements.
- [DockerizedServices](./DockerizedServices.md) -- The DockerizedServices component utilizes a microservices architecture, with each service having its own container and communication happening through APIs or message queues, as seen in the lib/service-starter.js file which employs the startServiceWithRetry function to start services with retry logic and exponential backoff. This design decision allows for easy addition or removal of services as needed, making the system highly scalable and flexible. The use of APIs or message queues for communication between services is a common pattern in microservices architecture, enabling loose coupling and fault tolerance. The startServiceWithRetry function in lib/service-starter.js ensures robust startup and prevents endless loops, making the system more reliable.
- [Trajectory](./Trajectory.md) -- The Trajectory component's architecture is designed to handle multiple integration methods, including HTTP, IPC, and file watch, as seen in the SpecstoryAdapter class (lib/integrations/specstory-adapter.js). This adapter class provides methods such as connectViaHTTP (lib/integrations/specstory-adapter.js:134), connectViaIPC (lib/integrations/specstory-adapter.js:193), and connectViaFileWatch (lib/integrations/specstory-adapter.js:241) to establish connections with the Specstory extension. The use of these multiple integration methods allows the Trajectory component to adapt to different environments and connection scenarios.
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component utilizes a GraphDatabaseAdapter (storage/graph-database-adapter.ts) to handle graph database persistence, which is a crucial aspect of the system's architecture. This adapter enables the use of Graphology and LevelDB for data storage, with automatic JSON export synchronization. The intelligent routing mechanism within the GraphDatabaseAdapter allows the system to switch between the VKB API and direct database access seamlessly, which is essential for maintaining a high level of performance and scalability. For instance, the 'getGraph' function in the GraphDatabaseAdapter class demonstrates how the system can retrieve the graph database, either from the VKB API or the local LevelDB storage, depending on the configuration. Furthermore, the 'saveGraph' function showcases the adapter's ability to persist the graph database to the local storage and synchronize it with the VKB API.
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem component utilizes the GraphDatabaseAdapter, located in storage/graph-database-adapter.ts, for storing and retrieving graph data. This adapter provides a standardized interface for interacting with the graph database, allowing the ConstraintSystem to focus on its core logic without worrying about the underlying database implementation. By using this adapter, the system can easily switch between different graph databases if needed, making it more modular and flexible. For example, the GraphDatabaseAdapter's query method can be used to retrieve specific nodes or edges from the graph, as seen in the ContentValidationAgent's constructor, where it is used to fetch entity content for validation.
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component employs a modular architecture, with each agent responsible for a specific task, such as the OntologyClassificationAgent for classifying observations against the ontology system, as seen in the integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts file. This agent utilizes a confidence calculation mechanism, as defined in the BaseAgent class, located in integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts, to determine the accuracy of its classifications. Furthermore, the OntologyClassificationAgent follows a standard response envelope creation pattern, ensuring consistency in its output.


---

*Generated from 6 observations*
