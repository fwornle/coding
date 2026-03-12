# Coding

**Type:** Project

Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 8 major components: LiveLoggingSystem: [LLM] The LiveLoggingSystem component utilizes the OntologyClassificationAgent (integrations/mcp-server-semantic-analysis/src/agents/ontology-classifi; LLMAbstraction: [LLM] The LLMAbstraction component leverages the LLMService class (lib/llm/llm-service.ts) as the primary entry point for all LLM operations. This cla; DockerizedServices: [LLM] The DockerizedServices component utilizes dependency injection to manage its services and utilities, as seen in the LLMService class (lib/llm/ll; Trajectory: [LLM] The Trajectory component's architecture is designed to facilitate logging conversations and tracking project progress through its utilization of; KnowledgeManagement: [LLM] The KnowledgeManagement component utilizes the CodeGraphAgent (integrations/mcp-server-semantic-analysis/src/agents/code-graph-agent.ts) to cons; CodingPatterns: [LLM] The CodingPatterns component relies heavily on the GraphDatabaseAdapter (storage/graph-database-adapter.ts) for efficient data storage and retri; ConstraintSystem: [LLM] The ConstraintSystem component utilizes the GraphDatabaseAdapter for persistence, which is implemented in the storage/graph-database-adapter.ts ; SemanticAnalysis: [LLM] The SemanticAnalysis component utilizes a multi-agent architecture, with each agent responsible for a specific task, such as ontology classifica.

## What It Is  

The **Coding** project is a layered knowledge‑management platform whose source lives under the `integrations/mcp‑server‑semantic‑analysis` and `lib` directories.  Its eight first‑level components are implemented in concrete files that the observations name explicitly:

* **LiveLoggingSystem** – `integrations/mcp‑server‑semantic‑analysis/src/agents/ontology‑classification‑agent.ts`  
* **LLMAbstraction** – `lib/llm/llm‑service.ts` (with mode helpers in `integrations/mcp‑server‑semantic‑analysis/src/mock/llm‑mock‑service.ts`)  
* **DockerizedServices** – `lib/llm/llm‑service.ts` and `lib/service‑starter.js`  
* **Trajectory** – `lib/integrations/specstory‑adapter.js`  
* **KnowledgeManagement** – `integrations/mcp‑server‑semantic‑analysis/src/agents/code‑graph‑agent.ts`, `…/persistence‑agent.ts`, and `…/storage/graph‑database‑adapter.ts`  
* **CodingPatterns** – `…/storage/graph‑database‑adapter.ts`  
* **ConstraintSystem** – `…/storage/graph‑database‑adapter.ts`  
* **SemanticAnalysis** – a set of agents (e.g., the ontology‑classification agent) that together form a multi‑agent pipeline.

Collectively these components provide a unified “coding” knowledge base: they ingest raw observations, classify them against an ontology, construct a graph representation of source‑code structure, persist that graph, and expose it through a flexible LLM‑driven abstraction layer.  The parent node **Coding** simply groups the eight siblings; each sibling implements a distinct responsibility while sharing common infrastructure such as the `LLMService` and the `GraphDatabaseAdapter`.

---

## Architecture and Design  

### Multi‑Agent Pipeline  
`SemanticAnalysis` and `LiveLoggingSystem` both adopt a **multi‑agent architecture**.  Each agent (e.g., `OntologyClassificationAgent`, `CodeGraphAgent`, `PersistenceAgent`) owns a single, well‑defined task and communicates through typed interfaces.  This separation is evident in the way the `CodeGraphAgent` calls `PersistenceAgent.storeEntity` after building a graph, and how `OntologyClassificationAgent.classifyObservation` returns a structured classification object.  The design encourages extensibility: new agents can be added without touching existing ones, provided they honor the same input/output contracts.

### Abstraction Layer for LLM Interaction  
All interactions with large language models flow through `LLMService` (`lib/llm/llm‑service.ts`).  The service encapsulates **mode routing**, **caching**, **circuit‑breaking**, and **provider fallback**.  The routing logic is delegated to `getLLMMode` (found in `integrations/mcp‑server‑semantic‑analysis/src/mock/llm‑mock‑service.ts`), which decides between mock, local, or public LLM providers based on per‑agent overrides, global configuration, or defaults.  By funnelling every LLM call through a single façade, the system achieves a clear separation between business logic (e.g., “classify this observation”) and the underlying model provider.

### Dependency Injection (DI)  
`DockerizedServices` demonstrates **dependency injection**.  `LLMService` is constructed with injectable collaborators such as a mock LLM implementation or a budget‑tracking wrapper.  Likewise, `ServiceStarter` (`lib/service‑starter.js`) receives a service instance together with retry and timeout policies.  DI removes hard‑coded dependencies, makes unit‑testing straightforward (swap a mock for a real service), and allows runtime composition of different behaviours (e.g., enabling a budget tracker only in production).

### Adapter Pattern for Persistence  
Both `CodingPatterns` and `ConstraintSystem` rely on `GraphDatabaseAdapter` (`integrations/mcp‑server‑semantic‑analysis/src/storage/graph‑database‑adapter.ts`).  This class acts as an **adapter** that translates domain objects (code‑graph nodes, constraint entities) into the storage‑specific API of the underlying graph database.  The adapter is type‑safe, exposing methods such as `storeEntity` and `retrieveEntity` that hide implementation details (e.g., Cypher queries, connection handling) from the calling agents.

### Shared Utilities and Cross‑Component Contracts  
The eight components share a common contract surface:  
* **Agents** (`*Agent.ts`) expose `execute`‑style methods that accept domain objects and return promises.  
* **Adapters** (`*Adapter.ts`) provide CRUD‑style methods with typed signatures.  
* **Service starters** (`service‑starter.js`) wrap any long‑running service with retry/timeout logic.  

These contracts form a lightweight **service‑oriented** layer inside a single monorepo rather than a distributed micro‑service system.

---

## Implementation Details  

### LiveLoggingSystem – OntologyClassificationAgent  
The core of LiveLoggingSystem lives in `integrations/mcp‑server‑semantic‑analysis/src/agents/ontology‑classification‑agent.ts`.  Its public method `classifyObservation(observation: Observation): ClassificationResult` receives a text payload, runs a series of algorithmic steps (likely tokenisation → embedding → similarity scoring), and returns a `ClassificationResult` containing matched ontology concepts and confidence scores.  The agent is invoked by higher‑level pipelines (e.g., SemanticAnalysis) to map raw logs into structured knowledge.

### LLMAbstraction – LLMService  
`lib/llm/llm‑service.ts` implements a class `LLMService` with methods such as `invoke(prompt: string, options?: InvokeOptions): Promise<LLMResponse>`.  Internally it:

1. Calls `getLLMMode(agentId)` (from the mock service) to decide which provider implementation to use.  
2. Looks up a cached response if caching is enabled, otherwise forwards the request to the selected provider.  
3. Wraps the call in a circuit‑breaker (preventing repeated failures) and, on error, falls back to an alternate provider.  

The service is deliberately provider‑agnostic; adding a new LLM only requires implementing the provider interface and registering it in the mode map.

### DockerizedServices – DI and ServiceStarter  
`DockerizedServices` does not introduce new source files but showcases how the system is wired at runtime.  In `LLMService`’s constructor, the mock implementation or the budget tracker is injected via a simple object‑literal configuration.  `ServiceStarter` (`lib/service‑starter.js`) accepts a service instance and decorates it with retry logic (`retryCount`, `backoffStrategy`) and timeout protection (`setTimeout`).  This pattern enables the same service code to run in a Docker container with production‑grade resiliency while allowing a lightweight in‑memory version for local development.

### Trajectory – SpecstoryAdapter  
`lib/integrations/specstory‑adapter.js` defines `SpecstoryAdapter` with three connection strategies:

* `connectViaHTTP(endpoint: string)` – uses an internal `httpRequest` helper to POST conversation data to the Specstory extension.  
* `connectViaIPC(pipeName: string)` – opens a Node.js IPC channel for low‑latency communication.  
* `connectViaFileWatch(path: string)` – watches a directory for JSON files dropped by the extension and processes them.

The adapter abstracts away the transport details, letting the Trajectory component log conversations and progress updates regardless of how the external Specstory UI is attached.

### KnowledgeManagement – CodeGraphAgent & PersistenceAgent  
`CodeGraphAgent` (`integrations/mcp‑server‑semantic‑analysis/src/agents/code‑graph‑agent.ts`) receives an Abstract Syntax Tree (AST) and constructs a graph representation via `constructCodeGraph(ast)`.  Nodes represent symbols (functions, classes, variables) and edges capture relationships (calls, imports, inheritance).  Once built, the graph is handed to `PersistenceAgent` (`…/persistence‑agent.ts`) which calls `GraphDatabaseAdapter.storeEntity(entity)` to persist the graph in a type‑safe manner.  Retrieval follows the reverse path: a query goes through the adapter, returns raw graph data, and `CodeGraphAgent` can re‑hydrate it for semantic search.

### CodingPatterns & ConstraintSystem – GraphDatabaseAdapter  
Both components interact directly with `GraphDatabaseAdapter` (`integrations/mcp‑server‑semantic‑analysis/src/storage/graph‑database‑adapter.ts`).  The adapter exposes methods such as `runQuery<T>(cypher: string, params?: any): Promise<T[]>` and `upsertNode(node: GraphNode): Promise<void>`.  By centralising all graph‑DB calls, the system can swap the underlying database (e.g., Neo4j → JanusGraph) by providing a new implementation that satisfies the same TypeScript interface, without touching the agents that depend on it.

---

## Integration Points  

1. **Agent → Adapter → Persistence** – `CodeGraphAgent` → `PersistenceAgent` → `GraphDatabaseAdapter`.  This chain is the primary data‑flow for knowledge ingestion.  
2. **LLM Service → Agents** – `LLMService` is injected into agents that need generative capabilities (e.g., a future “ExplainCodeAgent”).  The service’s mode routing ensures the same agent works with mock or real LLMs.  
3. **DockerizedServices → ServiceStarter** – All long‑running components (LLMService, SpecstoryAdapter, etc.) are launched via `ServiceStarter`, which adds retry/timeout wrappers.  This makes the Docker container orchestration deterministic.  
4. **Trajectory ↔ Specstory Extension** – The `SpecstoryAdapter` provides three interchangeable transport mechanisms, allowing the Trajectory component to be used in environments ranging from local VS Code extensions (IPC) to remote CI pipelines (HTTP).  
5. **LiveLoggingSystem ↔ SemanticAnalysis** – The ontology classification performed by `OntologyClassificationAgent` feeds directly into the broader multi‑agent pipeline of `SemanticAnalysis`, enriching downstream agents with classified concepts.  

All eight components ultimately share the same **project‑wide configuration** (environment variables, mode flags) that is read by the `LLMService` and the DI container at startup, ensuring consistent behaviour across the hierarchy.

---

## Usage Guidelines  

* **Prefer the façade** – When an LLM operation is required, call `LLMService.invoke` rather than reaching directly for a provider.  This guarantees caching, circuit‑breaking, and mode handling.  
* **Inject test doubles** – For unit tests of any agent, construct `LLMService` (or any other service) with a mock implementation passed through the constructor.  The DI pattern in `DockerizedServices` makes this straightforward.  
* **Persist via the adapter** – All graph‑related writes must go through `GraphDatabaseAdapter`.  Do not embed raw Cypher strings in agents; instead, use the typed methods (`storeEntity`, `runQuery`) to keep the system portable.  
* **Select the appropriate Specstory connection** – In environments where low latency is critical (e.g., local development), use `connectViaIPC`.  For CI/CD pipelines where a file system is the only shared artifact, fall back to `connectViaFileWatch`.  
* **Classify before storing** – When adding new observations, run them through `OntologyClassificationAgent.classifyObservation` first; the classification result should be attached to the entity before it is persisted by `PersistenceAgent`.  
* **Respect mode overrides** – If an agent requires a specific LLM behaviour (e.g., deterministic mock responses), set a per‑agent mode in the configuration so `getLLMMode` will select the correct provider.  

Following these conventions maintains the decoupling intended by the architecture and prevents accidental coupling to implementation details.

---

### 1. Architectural patterns identified  

| Pattern | Where it appears | What it solves |
|---------|-------------------|----------------|
| **Multi‑Agent Architecture** | `LiveLoggingSystem`, `SemanticAnalysis` (multiple agents such as `OntologyClassificationAgent`, `CodeGraphAgent`, `PersistenceAgent`) | Separation of concerns; easy addition of new processing steps. |
| **Facade / Service Layer** | `LLMService` (`lib/llm/llm‑service.ts`) | Uniform entry point to heterogeneous LLM providers, handling routing, caching, circuit‑breaking. |
| **Dependency Injection** | `DockerizedServices` (DI into `LLMService`, `ServiceStarter`) | Loose coupling, testability, runtime configurability. |
| **Adapter** | `GraphDatabaseAdapter` (`integrations/.../graph‑database‑adapter.ts`) | Isolate domain logic from specific graph‑DB APIs, enable swapping storage back‑ends. |
| **Strategy (Mode Routing)** | `getLLMMode` in `llm‑mock‑service.ts` | Select among mock, local, or public LLM implementations per‑agent or globally. |
| **Retry/Timeout Decorator** | `ServiceStarter` (`lib/service‑starter.js`) | Add resiliency to any long‑running service without polluting core logic. |

---

### 2. Design decisions and trade‑offs  

* **Centralising LLM logic in a single service** – simplifies consumer code but adds a single point of failure; mitigated by circuit‑breaker and fallback.  
* **Using a graph‑database adapter** – provides portability at the cost of an extra abstraction layer; however, the type‑safe interface reduces runtime errors.  
* **Multi‑agent pipeline** – maximises extensibility but can increase latency if many agents are chained; the design can parallelise independent agents to offset this.  
* **Dependency injection over hard‑coded singletons** – improves testability and configurability but requires a modest amount of wiring code (currently manual in constructors).  

Overall, the decisions favour **modularity and testability** over raw performance, which aligns with a knowledge‑graph‑centric system that must evolve quickly.

---

### 3. System structure insights  

* The project is **hierarchically organised**: a top‑level `Coding` node aggregates eight sibling components, each responsible for a distinct domain (logging, LLM abstraction, containerisation, trajectory tracking, knowledge graph construction, pattern storage, constraint handling, and semantic analysis).  
* **Shared infrastructure** (LLMService, GraphDatabaseAdapter, ServiceStarter) lives in the `lib` folder, while domain‑specific agents reside under `integrations/mcp‑server‑semantic‑analysis/src/agents`.  
* The **data flow** follows a clear path: raw observation → `OntologyClassificationAgent` → classification result → `CodeGraphAgent` (AST → graph) → `PersistenceAgent` → `GraphDatabaseAdapter` → persistent graph store.  
* **Cross‑component reuse** is evident: both `CodingPatterns` and `ConstraintSystem` reuse the same persistence adapter, and all agents can optionally call LLMs via the same façade.

---

### 4. Scalability considerations  

* **Horizontal scaling of LLM calls** – because `LLMService` abstracts providers, multiple instances can be run behind a load balancer; caching within the service reduces duplicate requests.  
* **Graph‑DB bottleneck** – the adapter centralises all reads/writes; scaling the underlying graph database (clustering, sharding) will directly increase throughput without code changes.  
* **Agent parallelism** – independent agents in the `SemanticAnalysis` pipeline can be executed concurrently (e.g., classification and code‑graph construction) to improve latency as workload grows.  
* **Dockerized deployment** – the DI‑friendly design and `ServiceStarter` allow each component to be containerised and orchestrated (Kubernetes, Docker Compose), facilitating scaling of compute‑intensive parts (e.g., LLM inference).  

Potential limits arise from the single‑process nature of the current DI container; moving to a message‑bus architecture would be required for massive distributed scaling, but that is outside the present design.

---

### 5. Maintainability assessment  

* **High cohesion, low coupling** – agents focus on one responsibility, and shared services are injected, making the codebase easy to reason about and refactor.  
* **Type‑safe adapters** – `GraphDatabaseAdapter` enforces compile‑time contracts, reducing runtime bugs when the storage layer evolves.  
* **Clear entry points** – `LLMService.invoke` and `SpecstoryAdapter.connect*` serve as well‑documented APIs, limiting the surface area that developers need to understand.  
* **Potential technical debt** – the manual DI wiring could become cumbersome as more services are added; introducing a lightweight container (e.g., Inversify) would improve readability.  
* **Documentation alignment** – because the hierarchy explicitly lists parent‑child relationships, navigating the system’s conceptual model is straightforward, aiding onboarding.  

Overall, the architecture is **maintainable**: adding new agents, storage back‑ends, or LLM providers requires only implementing the existing interfaces and registering them with the DI configuration.  The trade‑off is a modest amount of boilerplate for wiring, but this is outweighed by the gains in testability and modularity.


## Hierarchy Context

### Children
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- [LLM] The LiveLoggingSystem component utilizes the OntologyClassificationAgent (integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts) for classifying observations against the ontology system. This agent is responsible for mapping the observations to the relevant concepts in the ontology, which enables the system to provide accurate and meaningful classifications. The classification process involves a series of complex algorithms and logic, which are implemented in the classifyObservation function of the OntologyClassificationAgent class. The function takes an observation object as input, which contains the text to be classified, and returns a classification result object that includes the matched concepts and their corresponding scores.
- [LLMAbstraction](./LLMAbstraction.md) -- [LLM] The LLMAbstraction component leverages the LLMService class (lib/llm/llm-service.ts) as the primary entry point for all LLM operations. This class handles mode routing, caching, circuit breaking, and provider fallback, thereby providing a unified interface for interacting with various LLM providers. For instance, the LLMService class utilizes the getLLMMode function (integrations/mcp-server-semantic-analysis/src/mock/llm-mock-service.ts) to determine the LLM mode for a specific agent, considering per-agent overrides, global mode, and default mode. This design decision enables the component to handle different LLM modes, including mock, local, and public, and to provide a flexible and scalable architecture.
- [DockerizedServices](./DockerizedServices.md) -- [LLM] The DockerizedServices component utilizes dependency injection to manage its services and utilities, as seen in the LLMService class (lib/llm/llm-service.ts) where it injects a mock service or a budget tracker. This design decision allows for loose coupling and testability of the services, enabling developers to easily swap out different implementations of the services. For instance, the LLMService class can be injected with a mock service for testing purposes, or with a budget tracker to monitor the service's resource usage. The use of dependency injection also facilitates the management of complex service dependencies, as services can be injected with other services or components, such as the ServiceStarter (lib/service-starter.js) injecting a service with a retry logic and timeout protection.
- [Trajectory](./Trajectory.md) -- [LLM] The Trajectory component's architecture is designed to facilitate logging conversations and tracking project progress through its utilization of the SpecstoryAdapter class in lib/integrations/specstory-adapter.js. This class provides multiple connection methods, including connectViaHTTP, connectViaIPC, and connectViaFileWatch, which allows the component to establish a connection with the Specstory extension via different means. For instance, the connectViaHTTP method in the SpecstoryAdapter class uses the httpRequest helper method to send HTTP requests to the Specstory extension, enabling the component to log conversations and track project progress.
- [KnowledgeManagement](./KnowledgeManagement.md) -- [LLM] The KnowledgeManagement component utilizes the CodeGraphAgent (integrations/mcp-server-semantic-analysis/src/agents/code-graph-agent.ts) to construct a code knowledge graph based on Abstract Syntax Trees (ASTs). This allows for efficient semantic code search capabilities. The CodeGraphAgent is designed to work in conjunction with the PersistenceAgent (integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts) to store and retrieve entities from the graph database. The GraphDatabaseAdapter (integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts) provides a type-safe interface for interacting with the graph database, ensuring seamless data persistence and retrieval. For instance, the CodeGraphAgent's constructCodeGraph function (integrations/mcp-server-semantic-analysis/src/agents/code-graph-agent.ts) takes an AST as input and returns a constructed code graph, which is then stored in the graph database via the PersistenceAgent's storeEntity function (integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts).
- [CodingPatterns](./CodingPatterns.md) -- [LLM] The CodingPatterns component relies heavily on the GraphDatabaseAdapter (storage/graph-database-adapter.ts) for efficient data storage and retrieval. This is evident in how it utilizes the adapter to fetch and update data across various sub-components, ultimately contributing to the overall performance of the system. For instance, when constructing the code knowledge graph using the CodeGraphConstructor (code-graph-constructor.ts), it leverages the GraphDatabaseAdapter to store and retrieve relevant graph data. Furthermore, the GraphDatabaseInteractions class is used in conjunction with the GraphDatabaseAdapter to handle interactions with graph databases and knowledge graph construction, as seen in the way it employs the adapter to execute queries and retrieve results.
- [ConstraintSystem](./ConstraintSystem.md) -- [LLM] The ConstraintSystem component utilizes the GraphDatabaseAdapter for persistence, which is implemented in the storage/graph-database-adapter.ts file. This adapter provides a robust mechanism for storing and retrieving data in a graph database, leveraging the capabilities of Graphology and LevelDB. The automatic JSON export sync feature ensures that data is consistently updated and available for further processing. For instance, the ContentValidationAgent, defined in integrations/mcp-server-semantic-analysis/src/agents/content-validation-agent.ts, relies on this adapter to store and retrieve validation results.
- [SemanticAnalysis](./SemanticAnalysis.md) -- [LLM] The SemanticAnalysis component utilizes a multi-agent architecture, with each agent responsible for a specific task, such as ontology classification, semantic analysis, and code graph construction. For example, the OntologyClassificationAgent, located in integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts, classifies observations against the ontology system. This agent extends the BaseAgent class, which provides a basic implementation of the execute(input) pattern, allowing for lazy LLM initialization and execution. The execute method in the OntologyClassificationAgent is responsible for executing the classification task, and it follows the pattern established by the BaseAgent class.


---

*Generated from 2 observations*
