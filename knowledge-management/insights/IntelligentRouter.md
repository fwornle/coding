# IntelligentRouter

**Type:** SubComponent

IntelligentRouter utilizes the VKB API and direct database access to optimize interactions with the knowledge graph, as seen in the intelligent routing mechanism.

## What It Is  

The **IntelligentRouter** is a sub‑component of the **KnowledgeManagement** module that decides, on a per‑request basis, whether to interact with the knowledge graph through the external **VKB API** or by using direct access to the underlying **Graphology + LevelDB** store.  Although the source tree does not contain a dedicated file for the router itself, the surrounding documentation makes it clear that the routing logic lives inside the KnowledgeManagement layer and is invoked whenever a higher‑level operation (e.g., storing an entity, fetching a relationship) needs to be executed.  The router therefore acts as the “traffic controller” for all knowledge‑graph interactions, selecting the most efficient path and optionally applying performance‑monitoring or machine‑learning‑driven optimisations.

## Architecture and Design  

The design of **IntelligentRouter** follows a *conditional routing* approach.  Based on the characteristics of the incoming query—such as its complexity, latency requirements, or cached performance metrics—the router chooses between two concrete strategies:

1. **VKB‑API path** – an HTTP‑based client that forwards the request to the external VKB service.  
2. **Direct‑DB path** – a local call that leverages the **GraphDatabaseAdapter** (found at `storage/graph-database-adapter.ts`) to read or write directly against the **Graphology + LevelDB** database.

This dichotomy is reminiscent of a **Strategy**‑type selection, although the observations do not name the pattern explicitly.  The router also appears to maintain **performance monitoring** data (e.g., latency, success rates) that feed back into the decision‑making process.  In addition, the documentation hints at a possible **machine‑learning** layer that refines routing choices over time, suggesting an adaptive optimisation loop built on top of the basic conditional logic.

Interaction with sibling components is implicit: while **ManualLearning**, **OnlineLearning**, and **WaveController** focus on data creation, batch analysis, and work‑stealing respectively, they all ultimately rely on the same knowledge‑graph persistence layer provided by **GraphDatabaseAdapter**.  By centralising the routing decision in **IntelligentRouter**, the system ensures that all these siblings benefit from the same optimisation logic without each having to duplicate routing code.

## Implementation Details  

Although no concrete symbols were discovered in the code base, the observations give us several concrete implementation anchors:

| Element | Likely Location / Role |
|---------|------------------------|
| `routeRequest` (or similar) | The core method that evaluates a request and forwards it to either the VKB client or the local adapter. |
| VKB API client | A wrapper that translates internal query objects into HTTP calls understood by the external VKB service. |
| Direct DB handler | Calls into `GraphDatabaseAdapter.storeEntity`, `GraphDatabaseAdapter.fetchEntity`, etc., which in turn use the **Graphology + LevelDB** backend. |
| Performance monitor | A lightweight telemetry collector that records metrics (latency, error rates) for each routing decision. |
| ML optimiser (optional) | A component that consumes the telemetry, trains a model, and updates routing thresholds or scoring functions. |

The router most likely begins by inspecting the incoming request payload—looking for markers such as query size, required consistency level, or historical performance data stored in the **Graphology + LevelDB** database (e.g., “query patterns and performance metrics”).  If the request matches a pattern that historically performed better via the VKB API (perhaps because the external service has specialised indexes), the router forwards the request to the VKB client.  Otherwise, it calls the appropriate method on **GraphDatabaseAdapter**, which directly manipulates the LevelDB‑backed graph.

The **GraphDatabaseAdapter** itself provides methods like `storeEntity`, `fetchEntity`, and others that encapsulate low‑level Graphology operations.  Because the router sits above this adapter, any enhancements to persistence (e.g., schema migrations, index tuning) remain transparent to the routing logic.

## Integration Points  

* **Parent – KnowledgeManagement**: The router is embedded within the KnowledgeManagement component, acting as the gateway for all knowledge‑graph interactions.  Its decisions directly affect the performance of the parent’s higher‑level services (e.g., agents that query or update knowledge).  

* **Sibling – GraphDatabaseAdapter**: The router calls into the adapter for direct‑DB paths.  The adapter’s implementation (`storage/graph-database-adapter.ts`) defines the concrete persistence API that the router relies on.  

* **Sibling – ManualLearning / OnlineLearning / WaveController**: These components generate or consume knowledge‑graph data but do not implement routing themselves.  By delegating to **IntelligentRouter**, they gain a uniform optimisation layer without coupling to the specifics of VKB or LevelDB.  

* **External – VKB API**: The router’s alternative path is an HTTP client that talks to the VKB service.  This external dependency is abstracted behind a thin client wrapper, allowing the router to switch seamlessly between local and remote execution.  

* **Telemetry / ML Sub‑system (inferred)**: If present, this subsystem would subscribe to the router’s performance events, store aggregated metrics back into the **Graphology + LevelDB** store, and periodically update routing heuristics.

## Usage Guidelines  

1. **Prefer the Router for All Knowledge‑Graph Access** – Direct calls to `GraphDatabaseAdapter` should be avoided in new code; instead, invoke the higher‑level API that internally uses **IntelligentRouter**.  This guarantees that performance‑optimised routing is applied uniformly.  

2. **Understand Query Characteristics** – When designing a new query, consider its size and latency sensitivity.  Extremely large batch operations may benefit from the VKB API if the external service offers bulk endpoints; otherwise, keep the request simple to allow the router to favour local execution.  

3. **Monitor Telemetry** – Developers should instrument any custom routing extensions with the same telemetry hooks used by the router.  Consistent metric naming (e.g., `router.latency`, `router.success`) ensures the optional ML optimiser receives accurate data.  

4. **Avoid Hard‑Coded Routing Flags** – The router’s decision logic is designed to evolve (especially if an ML layer is added).  Hard‑coding “use‑VKB” or “use‑local” flags in client code circumvents the optimisation engine and can lead to degraded performance as workloads change.  

5. **Graceful Degradation** – If the VKB service becomes unavailable, the router should automatically fall back to the direct‑DB path.  Ensure that error handling in callers does not assume a particular backend; treat failures as generic routing errors.  

---

### Architectural Patterns Identified  

* **Conditional Routing / Strategy Selection** – The router chooses between two concrete execution strategies (VKB API vs. direct DB) based on request attributes and performance data.  
* **Adapter Pattern** – `GraphDatabaseAdapter` adapts the Graphology + LevelDB store to a uniform persistence interface used by the router.  
* **Telemetry‑Driven Optimisation** – Continuous collection of latency and success metrics feeds back into routing decisions, hinting at a feedback‑loop pattern.  
* **Potential Adaptive Learning Loop** – The mention of machine‑learning techniques suggests an emerging *self‑optimising* pattern where routing heuristics are refined automatically.

### Design Decisions and Trade‑offs  

| Decision | Rationale | Trade‑off |
|----------|-----------|-----------|
| Dual‑path routing (VKB API vs. direct DB) | Allows the system to exploit the strengths of an external service (e.g., specialised indexes) while retaining low‑latency local access when appropriate. | Increases complexity: the router must maintain two code paths, duplicate error handling, and keep consistency between remote and local data. |
| Centralised routing logic in KnowledgeManagement | Guarantees a single source of truth for optimisation, simplifying maintenance for sibling components. | Creates a single point of failure; the router must be highly reliable and performant. |
| Use of Graphology + LevelDB for persistence | Provides a fast, embeddable graph store suitable for large knowledge graphs. | LevelDB is key‑value oriented; complex graph queries may require additional indexing or caching layers. |
| Optional ML‑driven routing | Enables the system to adapt to evolving workloads without manual tuning. | Requires collection of sufficient telemetry and a model‑training pipeline; adds runtime overhead and potential unpredictability if the model misclassifies. |

### System Structure Insights  

The overall system can be visualised as a three‑tiered hierarchy:

1. **KnowledgeManagement (parent)** – orchestrates high‑level knowledge operations and houses the **IntelligentRouter**.  
2. **IntelligentRouter (focus)** – mediates every request, deciding between the VKB client and the local **GraphDatabaseAdapter**.  
3. **Persistence Layer** – `storage/graph-database-adapter.ts` implements concrete Graphology + LevelDB interactions; the VKB service provides a remote counterpart.

Sibling components (ManualLearning, OnlineLearning, WaveController, UKBTraceReportGenerator) all funnel their graph‑related work through this hierarchy, ensuring a consistent optimisation surface.

### Scalability Considerations  

* **Horizontal Scaling of VKB Calls** – Because the VKB path is an external HTTP service, it can be scaled independently of the local process pool.  The router’s decision logic can be tuned to off‑load high‑throughput workloads to VKB when local resources saturate.  
* **Local DB Bottlenecks** – LevelDB is single‑process by design; heavy concurrent writes may become a contention point.  The router can mitigate this by preferentially routing write‑heavy bursts to the VKB API, assuming the external service supports write operations.  
* **Telemetry Overhead** – Continuous metric collection must be lightweight; otherwise, the monitoring itself could become a scalability limiter.  Aggregating metrics asynchronously and storing them in the same Graphology + LevelDB store helps keep overhead low.  
* **ML Optimiser Scaling** – If a machine‑learning model is introduced, training can be performed offline and the resulting model cached in memory, ensuring that inference (routing decision) remains O(1).  

### Maintainability Assessment  

The **IntelligentRouter** centralises routing concerns, which is a strong maintainability advantage: changes to routing heuristics affect all consumers automatically.  The reliance on well‑named adapters (`GraphDatabaseAdapter`) and clear separation between remote (VKB) and local (LevelDB) paths further isolates responsibilities.  However, the lack of explicit source files for the router (0 code symbols found) suggests that the implementation may be scattered or generated, potentially hindering discoverability.  Adding a dedicated module (e.g., `src/intelligent-router.ts`) with clearly documented `routeRequest` and telemetry hooks would improve code navigation and onboarding.  

Overall, the design balances performance optimisation with architectural clarity, but future work should focus on surfacing the router’s code, documenting the ML feedback loop, and establishing robust test suites that cover both routing paths.

## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component's utilization of a Graphology+LevelDB database for persistence, as seen in the GraphDatabaseAdapter (storage/graph-database-adapter.ts), allows for efficient storage and querying of knowledge graphs. This choice of database is particularly noteworthy due to its ability to handle large amounts of data and provide a robust foundation for the component's intelligent routing mechanism. The intelligent routing, which switches between VKB API and direct database access, enables the component to optimize its interactions with the knowledge graph, thus improving overall performance. For instance, when an agent needs to store an entity, it can use the storeEntity method in GraphDatabaseAdapter, which ultimately relies on the Graphology+LevelDB database for persistence.

### Siblings
- [ManualLearning](./ManualLearning.md) -- ManualLearning likely utilizes the storeEntity method in GraphDatabaseAdapter (storage/graph-database-adapter.ts) to persist manually created entities.
- [OnlineLearning](./OnlineLearning.md) -- OnlineLearning probably utilizes a batch analysis pipeline, similar to the one described in batch-analysis.yaml, to extract knowledge from git history and other sources.
- [WaveController](./WaveController.md) -- WaveController implements work-stealing via a shared nextIndex counter, allowing idle workers to pull tasks immediately, as seen in the runWithConcurrency method.
- [UKBTraceReportGenerator](./UKBTraceReportGenerator.md) -- UKBTraceReportGenerator probably utilizes a report generation mechanism to create detailed trace reports for UKB workflow runs.
- [GraphDatabaseAdapter](./GraphDatabaseAdapter.md) -- GraphDatabaseAdapter utilizes the Graphology+LevelDB database for storing and querying knowledge graphs, as seen in the storeEntity method.

---

*Generated from 7 observations*
