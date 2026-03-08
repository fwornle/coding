# Coding

**Type:** Project

Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 8 major components: LiveLoggingSystem: The LiveLoggingSystem component utilizes the OntologyClassificationAgent, located in integrations/mcp-server-semantic-analysis/src/agents/ontology-cla; LLMAbstraction: The LLMAbstraction component uses dependency injection to set functions that resolve the current LLM mode, mock service, repository path, budget track; DockerizedServices: The DockerizedServices component utilizes a microservices architecture, with each service having its own container and communication happening through; Trajectory: The Trajectory component's architecture is designed to handle multiple integration methods, including HTTP, IPC, and file watch, as seen in the Specst; KnowledgeManagement: The KnowledgeManagement component utilizes a GraphDatabaseAdapter (storage/graph-database-adapter.ts) to handle graph database persistence, which is a; CodingPatterns: The CodingPatterns component utilizes the GraphDatabaseAdapter (storage/graph-database-adapter.ts) for storing and retrieving knowledge entities. This; ConstraintSystem: The ConstraintSystem component utilizes the GraphDatabaseAdapter, located in storage/graph-database-adapter.ts, for storing and retrieving graph data.; SemanticAnalysis: The SemanticAnalysis component employs a modular architecture, with each agent responsible for a specific task, such as the OntologyClassificationAgen.

## What It Is  

The **Coding** project is a multi‑component knowledge‑management platform whose source lives under a single repository.  Its root hierarchy contains eight first‑level modules – **LiveLoggingSystem**, **LLMAbstraction**, **DockerizedServices**, **Trajectory**, **KnowledgeManagement**, **CodingPatterns**, **ConstraintSystem**, and **SemanticAnalysis** – each realised in its own folder or logical grouping.  

Key implementation locations that anchor the system are:  

* **LiveLoggingSystem** – uses the `OntologyClassificationAgent` found at  
  `integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts`.  
* **LLMAbstraction** – the `LLMService` class lives in `lib/llm/llm-service.ts`.  
* **DockerizedServices** – service‑startup logic is in `lib/service-starter.js`.  
* **Trajectory** – the `SpecstoryAdapter` implementation resides in `lib/integrations/specstory-adapter.js`.  
* **KnowledgeManagement**, **CodingPatterns**, and **ConstraintSystem** – all share the `GraphDatabaseAdapter` defined in `storage/graph-database-adapter.ts`.  

Together these modules form a cohesive platform that ingests live observations, classifies them against an ontology, stores the resulting knowledge in a graph database, and exposes the capabilities through a set of containerised micro‑services.

---

## Architecture and Design  

The overall architecture is **modular** and **service‑oriented**.  Each L1 component encapsulates a distinct responsibility and communicates with its peers through well‑defined adapters or API contracts.  

* **Micro‑service orientation** – The **DockerizedServices** component follows a classic micro‑service pattern: every logical service runs in its own Docker container and interacts with others via HTTP APIs or message queues.  The `startServiceWithRetry` helper in `lib/service-starter.js` supplies exponential‑backoff retry logic, a common reliability technique in distributed systems.  

* **Dependency‑injection (DI)** – In **LLMAbstraction**, the `LLMService` class receives functions that resolve the current LLM mode, mock service, repository path, budget tracker, sensitivity classifier, and quota tracker.  This DI approach (observed in `lib/llm/llm-service.ts`) decouples the service from concrete implementations, enabling easy swapping of mocks for tests and allowing runtime configuration of the LLM behaviour.  

* **Adapter pattern** – The **Trajectory** component’s `SpecstoryAdapter` (`lib/integrations/specstory-adapter.js`) implements three concrete connection methods – `connectViaHTTP`, `connectViaIPC`, and `connectViaFileWatch`.  By exposing a uniform interface while encapsulating the transport details, the adapter pattern lets the rest of the system treat the Specstory extension as a single integration point regardless of the underlying channel.  

* **Graph‑database abstraction** – **KnowledgeManagement**, **CodingPatterns**, and **ConstraintSystem** all rely on a shared `GraphDatabaseAdapter` (`storage/graph-database-adapter.ts`).  This adapter abstracts away the specifics of Graphology, LevelDB, and the optional VKB API, providing a single façade for persisting and retrieving graph‑structured knowledge entities.  

* **Modular agent architecture** – Within **SemanticAnalysis**, each agent (e.g., `OntologyClassificationAgent`) is a self‑contained unit that performs a single semantic task.  This mirrors a **pipeline** design where agents can be chained or replaced without affecting the surrounding infrastructure.  

Interaction flows are therefore straightforward: live observations are captured by **LiveLoggingSystem**, classified by the ontology agent, enriched by LLM services, persisted via the graph adapter, and finally exposed through Dockerised micro‑services that may be consumed by other components such as **Trajectory** or external clients.

---

## Implementation Details  

### LiveLoggingSystem  
The heart of the live‑logging pipeline is the `OntologyClassificationAgent` (`integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts`).  It receives raw observation objects, maps them onto pre‑defined ontology concepts, and emits structured entities that downstream modules store.  The agent’s classification routine is deterministic and leverages a static ontology definition, ensuring repeatable results across sessions.

### LLMAbstraction  
`LLMService` (`lib/llm/llm-service.ts`) is a thin orchestration layer.  Its constructor receives a configuration object populated via DI.  The `resolveMode(agentId, …)` method examines the supplied `agentId` and other contextual flags (budget, sensitivity) to decide whether to invoke a full‑size LLM, a mock stub, or a constrained “quota‑aware” mode.  Because the resolution functions are injected, unit tests can replace them with deterministic fakes, and production deployments can point to different LLM back‑ends without code changes.

### DockerizedServices  
Service startup is managed by `startServiceWithRetry` in `lib/service-starter.js`.  The function accepts a service entry point, attempts to launch the container, and on failure retries with exponential back‑off (e.g., 100 ms → 200 ms → 400 ms).  This prevents cascading failures during container orchestration and aligns with the micro‑service principle of **self‑healing**.  Each service exposes its own HTTP or message‑queue interface, allowing other components to invoke functionality without sharing process memory.

### Trajectory  
`SpecstoryAdapter` (`lib/integrations/specstory-adapter.js`) implements three connection strategies:  

* `connectViaHTTP` – opens a RESTful channel to the Specstory extension.  
* `connectViaIPC` – uses Node’s inter‑process communication sockets for low‑latency local calls.  
* `connectViaFileWatch` – watches a designated directory for JSON payload files, enabling a file‑based bridge when network channels are unavailable.  

The adapter abstracts these methods behind a common `connect()` façade, letting the rest of the system request a connection without caring about the underlying transport.

### KnowledgeManagement / CodingPatterns / ConstraintSystem  
All three components share the `GraphDatabaseAdapter` (`storage/graph-database-adapter.ts`).  The adapter’s key methods include:  

* `getGraph()` – retrieves the current graph either from a remote VKB API or from a local LevelDB store, based on runtime configuration.  
* `saveGraph(graph)` – persists the in‑memory graph to LevelDB and optionally synchronises it to the VKB API.  

Internally the adapter uses **Graphology** for an in‑memory graph model and **LevelDB** for durable storage.  The “intelligent routing” logic decides at runtime whether to favour the API (for cloud‑centralised deployments) or the local store (for edge or offline scenarios).  

### SemanticAnalysis  
Agents such as `OntologyClassificationAgent` are registered in a lightweight registry.  Each agent implements a single `process(input)` method, returning a transformed payload.  The modularity allows new agents to be added (e.g., sentiment analysis) without touching the core orchestration code, preserving the **open/closed** principle.

---

## Integration Points  

* **LiveLoggingSystem ↔ SemanticAnalysis** – The ontology agent lives under the `integrations/mcp-server-semantic-analysis` namespace and is invoked directly by the live‑logging pipeline to enrich raw observations.  

* **LLMAbstraction ↔ LiveLoggingSystem & CodingPatterns** – The `LLMService` is injected into components that need language‑model assistance (e.g., generating summaries for knowledge entities).  Its mode‑resolution logic is shared across siblings, ensuring consistent LLM behaviour throughout the platform.  

* **DockerizedServices ↔ All other components** – Each micro‑service container exposes an API that other components (e.g., Trajectory’s HTTP connector) call.  The retry logic in `lib/service-starter.js` guarantees that service endpoints become available before dependent modules attempt communication.  

* **Trajectory ↔ External Specstory extension** – Through `SpecstoryAdapter`, the system can connect via HTTP, IPC, or file‑watch, making the integration resilient to environment constraints.  

* **KnowledgeManagement / CodingPatterns / ConstraintSystem ↔ GraphDatabaseAdapter** – All three siblings persist and query graph data through the same adapter, ensuring a single source of truth for graph operations.  The adapter’s dual‑path routing (VKB API vs. LevelDB) allows these components to operate both in cloud‑centric and edge‑centric deployments.  

* **SemanticAnalysis agents ↔ GraphDatabaseAdapter** – Agents may store classification results directly via the adapter, linking ontology concepts to graph nodes.  

Overall, the system’s integration surfaces are clearly delineated: file‑system adapters, HTTP/IPC endpoints, and a shared persistence façade.

---

## Usage Guidelines  

1. **Prefer Dependency Injection for LLM Configuration** – When extending or testing the LLM layer, supply custom resolver functions to `LLMService` rather than editing the class directly.  This keeps the component testable and isolates production credentials.  

2. **Leverage the GraphDatabaseAdapter for All Graph Operations** – Direct access to Graphology or LevelDB is discouraged.  Use `getGraph()` and `saveGraph()` to respect the routing logic that may point to the VKB API.  This guarantees that KnowledgeManagement, CodingPatterns, and ConstraintSystem remain in sync.  

3. **Choose the Appropriate Trajectory Connection** – For local development, `connectViaIPC` offers the lowest latency.  In CI environments where containers may be isolated, fall back to `connectViaHTTP`.  Only use `connectViaFileWatch` when network connectivity is unavailable or when a simple file‑drop integration is sufficient.  

4. **Deploy Services Independently** – Each micro‑service defined in **DockerizedServices** can be scaled horizontally.  Ensure that the container’s health‑check endpoint is reachable so that `startServiceWithRetry` can correctly detect readiness before other components attempt to call it.  

5. **Extend SemanticAnalysis via New Agents** – To add a new processing step, implement a class with a `process(input)` method and register it in the agent registry.  Avoid modifying existing agents; instead, compose new functionality by chaining agents.  

6. **Maintain Consistent Ontology Versions** – Since the `OntologyClassificationAgent` relies on a static ontology definition, any change to the ontology file must be version‑controlled and propagated to all environments.  Mismatched versions can cause classification failures across the LiveLoggingSystem and downstream storage.  

Following these conventions will keep the codebase modular, testable, and ready for scale.

---

### Summary Deliverables  

| Item | Insight |
|------|---------|
| **Architectural patterns identified** | Modular component layout, Micro‑service architecture (DockerizedServices), Dependency Injection (LLMAbstraction), Adapter pattern (Trajectory → SpecstoryAdapter), Graph‑database façade (GraphDatabaseAdapter), Agent‑pipeline pattern (SemanticAnalysis). |
| **Design decisions and trade‑offs** | *Micro‑services* give scalability but add operational overhead; *DI* improves testability at the cost of more wiring code; *Shared GraphDatabaseAdapter* reduces duplication but creates a single point of failure if routing logic is buggy; *Multiple integration methods* in Trajectory increase flexibility but raise maintenance surface. |
| **System structure insights** | Eight sibling L1 modules under the parent **Coding**; three of them converge on a common persistence adapter; LiveLoggingSystem and SemanticAnalysis form a tight classification loop; DockerizedServices act as the external façade; Trajectory provides the bridge to external extensions. |
| **Scalability considerations** | Horizontal scaling is native to DockerizedServices; the retry‑with‑backoff startup logic mitigates cascade failures; GraphDatabaseAdapter’s ability to switch between local LevelDB and remote VKB API lets the system scale from edge devices to cloud clusters. |
| **Maintainability assessment** | High maintainability due to clear separation of concerns, DI, and adapters.  The main risk lies in the shared GraphDatabaseAdapter – changes there impact three components simultaneously.  Documentation of ontology versions and service contracts is essential to keep the modular design coherent. |


## Hierarchy Context

### Children
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- The LiveLoggingSystem component utilizes the OntologyClassificationAgent, located in integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts, to classify observations against the ontology system. This agent plays a crucial role in the system's architecture, enabling the classification of observations based on predefined ontologies. The classification process involves the agent analyzing the observations and mapping them to specific concepts within the ontology system. This mapping is essential for providing a structured representation of the observations, facilitating their storage, retrieval, and analysis. The OntologyClassificationAgent's functionality is critical to the overall operation of the LiveLoggingSystem, as it enables the system to organize and make sense of the vast amounts of data generated during live sessions.
- [LLMAbstraction](./LLMAbstraction.md) -- The LLMAbstraction component uses dependency injection to set functions that resolve the current LLM mode, mock service, repository path, budget tracker, sensitivity classifier, and quota tracker in the LLMService class (lib/llm/llm-service.ts). This design decision allows for flexibility and testability, as different implementations can be easily swapped in. The resolveMode method in LLMService, which determines the LLM mode based on the agent ID and other factors, is a good example of this. The method takes into account various parameters, such as the agent ID, to decide which LLM mode to use, and returns the corresponding mode. This approach enables the component to adapt to different scenarios and requirements.
- [DockerizedServices](./DockerizedServices.md) -- The DockerizedServices component utilizes a microservices architecture, with each service having its own container and communication happening through APIs or message queues, as seen in the lib/service-starter.js file which employs the startServiceWithRetry function to start services with retry logic and exponential backoff. This design decision allows for easy addition or removal of services as needed, making the system highly scalable and flexible. The use of APIs or message queues for communication between services is a common pattern in microservices architecture, enabling loose coupling and fault tolerance. The startServiceWithRetry function in lib/service-starter.js ensures robust startup and prevents endless loops, making the system more reliable.
- [Trajectory](./Trajectory.md) -- The Trajectory component's architecture is designed to handle multiple integration methods, including HTTP, IPC, and file watch, as seen in the SpecstoryAdapter class (lib/integrations/specstory-adapter.js). This adapter class provides methods such as connectViaHTTP (lib/integrations/specstory-adapter.js:134), connectViaIPC (lib/integrations/specstory-adapter.js:193), and connectViaFileWatch (lib/integrations/specstory-adapter.js:241) to establish connections with the Specstory extension. The use of these multiple integration methods allows the Trajectory component to adapt to different environments and connection scenarios.
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component utilizes a GraphDatabaseAdapter (storage/graph-database-adapter.ts) to handle graph database persistence, which is a crucial aspect of the system's architecture. This adapter enables the use of Graphology and LevelDB for data storage, with automatic JSON export synchronization. The intelligent routing mechanism within the GraphDatabaseAdapter allows the system to switch between the VKB API and direct database access seamlessly, which is essential for maintaining a high level of performance and scalability. For instance, the 'getGraph' function in the GraphDatabaseAdapter class demonstrates how the system can retrieve the graph database, either from the VKB API or the local LevelDB storage, depending on the configuration. Furthermore, the 'saveGraph' function showcases the adapter's ability to persist the graph database to the local storage and synchronize it with the VKB API.
- [CodingPatterns](./CodingPatterns.md) -- The CodingPatterns component utilizes the GraphDatabaseAdapter (storage/graph-database-adapter.ts) for storing and retrieving knowledge entities. This adapter provides a standardized interface for interacting with the graph database, which is built on top of LevelDB for efficient data storage and retrieval. The use of LevelDB allows for high-performance data storage and querying, making it an ideal choice for the CodingPatterns component. Furthermore, the GraphDatabaseAdapter also provides automatic JSON export sync, ensuring that data is consistently up-to-date and readily available for use within the component.
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem component utilizes the GraphDatabaseAdapter, located in storage/graph-database-adapter.ts, for storing and retrieving graph data. This adapter provides a standardized interface for interacting with the graph database, allowing the ConstraintSystem to focus on its core logic without worrying about the underlying database implementation. By using this adapter, the system can easily switch between different graph databases if needed, making it more modular and flexible. For example, the GraphDatabaseAdapter's query method can be used to retrieve specific nodes or edges from the graph, as seen in the ContentValidationAgent's constructor, where it is used to fetch entity content for validation.
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component employs a modular architecture, with each agent responsible for a specific task, such as the OntologyClassificationAgent for classifying observations against the ontology system, as seen in the integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts file. This agent utilizes a confidence calculation mechanism, as defined in the BaseAgent class, located in integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts, to determine the accuracy of its classifications. Furthermore, the OntologyClassificationAgent follows a standard response envelope creation pattern, ensuring consistency in its output.


---

*Generated from 2 observations*
