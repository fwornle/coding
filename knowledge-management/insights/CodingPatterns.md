# CodingPatterns

**Type:** Component

[LLM] The Wave agents follow a consistent design pattern, as seen in the constructor(repoPath, team) + ensureLLMInitialized() + execute(input) pattern for lazy LLM initialization. This pattern is demonstrated in the OntologyClassificationAgent (integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts) which uses a lazy initialization approach and the LLMService for ontology-based classification and analysis. The agent's constructor initializes the repository path and team, while the ensureLLMInitialized function checks if the LLM is initialized before proceeding with the execution of the input. This design pattern enables efficient and modular implementation of agents, allowing for easy extension and customization of their functionality. The LLMController (lib/llm/dist/index.js) also uses the LLMService for large language model operations, illustrating the project's use of established libraries and frameworks to support advanced language processing capabilities.

## What It Is  

**CodingPatterns** is the central repository of the project’s reusable architectural and coding guidance. It lives throughout the codebase, but its concrete manifestations are visible in a handful of key files:  

* `storage/graph-database-adapter.ts` – the **GraphDatabaseAdapter** that couples **Graphology** with a **LevelDB** persistence layer and automatically synchronises a JSON export.  
* `integrations/code‑graph‑rag/README.md` – the public description of the **CodeGraphRAG** system, a graph‑based Retrieval‑Augmented Generation (RAG) engine for arbitrary codebases.  
* `integrations/mcp‑server‑semantic‑analysis/src/agents/ontology‑classification‑agent.ts` – an example of a **Wave agent** that follows the `constructor(repoPath, team) → ensureLLMInitialized() → execute(input)` lazy‑initialisation pattern.  
* `lib/llm/dist/index.js` – the **LLMController** that delegates to the shared **LLMService** and demonstrates the same lazy‑initialisation discipline.  
* `integrations/copi/docs/hooks.md` and `integrations/copi/README.md` – the hook catalogue and a CLI wrapper that illustrate the hook/callback mechanism used across the ecosystem.  
* `integrations/browser‑access/README.md` – a browser‑based MCP server that shows how the component can be exposed through a web UI and configured via environment variables (`BROWSER_ACCESS_PORT`, `BROWSER_ACCESS_SSE_URL`).  

Together these artefacts capture the **design patterns, coding conventions, best practices, graph‑database usage, and constraint‑monitoring** concerns that the **CodingPatterns** component codifies for the whole **Coding** parent component.

---

## Architecture and Design  

The architecture of **CodingPatterns** is deliberately **modular and data‑centric**. The dominant structural decisions observed are:

1. **Graph‑oriented persistence** – The `GraphDatabaseAdapter` (storage/graph-database-adapter.ts) implements a **singleton**‑style provider of a single graph instance, guaranteeing that every consumer (e.g., the LiveLoggingSystem, SemanticAnalysis agents, or the CodeGraphRAG system) works against the same in‑memory graph backed by LevelDB. This guarantees **data consistency and integrity** across the entire platform, a design echoed in the sibling **LiveLoggingSystem** and **ConstraintSystem** components, both of which also rely on a shared graph store.

2. **Lazy LLM initialisation** – Wave agents such as the `OntologyClassificationAgent` (integrations/mcp‑server‑semantic‑analysis/src/agents/ontology‑classification‑agent.ts) and the `LLMController` (lib/llm/dist/index.js) adopt a **constructor‑plus‑ensureLLMInitialized** pattern. The constructor only records static configuration (`repoPath`, `team`) while the heavy LLM bootstrap is deferred until the first `execute` call. This pattern is also present in the sibling **KnowledgeManagement** component, reducing memory pressure and start‑up latency when many agents coexist.

3. **Hook / callback extensibility** – The `hooks.md` document (integrations/copi/docs/hooks.md) defines a **hook registry** (`before‑exec`, `after‑exec`, etc.) that any component can subscribe to. The Copi CLI wrapper (integrations/copi/README.md) demonstrates this by inserting custom behaviour into the Tmux status line. This decouples feature extensions from core logic, a design also leveraged by the **BrowserAccess** server to inject SSE‑based updates without hard‑coding them into the request handling pipeline.

4. **Environment‑driven configuration** – The BrowserAccess MCP server (integrations/browser-access/README.md) reads `BROWSER_ACCESS_PORT` and `BROWSER_ACCESS_SSE_URL` from the process environment. This mirrors the configuration strategy used throughout the sibling **DockerizedServices** component (YAML‑based service definitions) and reinforces a **12‑factor‑style** approach to externalising configuration.

5. **Consistent coding conventions** – Across `graph-database-adapter.ts`, `ontology‑classification‑agent.ts`, and `index.js` the code exhibits clear, concise comments, naming consistency, and TypeScript typings. The presence of a dedicated **CodingConventions** child (README naming, CONTRIBUTING guidelines) confirms that these conventions are intentional rather than incidental.

Collectively these patterns create a **layered architecture** where low‑level data storage (graph database) is a shared foundation, LLM‑driven agents sit atop it with lazy initialisation, and higher‑level UI or CLI integrations plug in via hooks and environment variables. The design mirrors the broader **Coding** parent component’s emphasis on interchangeable, observable services.

---

## Implementation Details  

### GraphDatabaseAdapter (`storage/graph-database-adapter.ts`)  
* **Singleton provision** – The module exports a single `getGraphInstance()` function that lazily creates a Graphology graph bound to a LevelDB backend the first time it is called. Subsequent calls receive the same instance, guaranteeing a single source of truth.  
* **Automatic JSON export sync** – After each mutation, the adapter triggers a background job that serialises the graph to JSON and writes it to a predefined location. This enables other components (e.g., CodeGraphRAG) to import a snapshot without direct DB access, supporting **seamless data exchange**.  

### CodeGraphRAG (`integrations/code-graph-rag/README.md`)  
* The README outlines a **graph‑based Retrieval‑Augmented Generation** pipeline that ingests a codebase, builds a graph of symbols, and answers natural‑language queries by traversing the graph. The implementation re‑uses the singleton graph instance, ensuring that the RAG engine always works with the most up‑to‑date knowledge base.  

### Wave Agent Pattern (`integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts`)  
* **Constructor** – Stores immutable configuration (`repoPath`, `team`).  
* **ensureLLMInitialized()** – Checks an internal flag; if the LLM service is not yet instantiated, it calls the global `LLMService` factory to create it.  
* **execute(input)** – Guarantees that the LLM is ready, then forwards the input to the LLM for ontology classification. This three‑step flow is replicated by the `LLMController` in `lib/llm/dist/index.js`.  

### Hook System (`integrations/copi/docs/hooks.md`)  
* The file enumerates hook identifiers and their signatures. Hooks are stored in a central registry that any module can `registerHook(name, fn)`.  
* The Copi CLI wrapper demonstrates a concrete usage: a `before‑exec` hook updates the Tmux status line, while an `after‑exec` hook logs execution metrics. The design enables **decoupled extensibility** without modifying the core command dispatcher.  

### BrowserAccess Server (`integrations/browser-access/README.md`)  
* The server starts an Express‑style HTTP listener on `process.env.BROWSER_ACCESS_PORT`.  
* Server‑Sent Events (SSE) are exposed at the URL defined by `BROWSER_ACCESS_SSE_URL`.  
* The README stresses that the server is merely a thin UI layer; all heavy lifting (graph queries, LLM calls) is delegated to the underlying services defined in **CodingPatterns** (graph adapter, agents, hooks).  

### Coding Standards (`integrations/code-graph-rag/README.md`, `lib/llm/dist/index.js`)  
* Both files contain block comments that describe purpose, inputs, and outputs.  
* Naming follows a **camelCase** for functions and **PascalCase** for classes, matching the conventions documented in the **CodingConventions** child component.  

---

## Integration Points  

1. **Graph Database** – The singleton provided by `GraphDatabaseAdapter` is consumed by every component that needs structural knowledge:  
   * **LiveLoggingSystem** (sibling) reads and writes knowledge entities.  
   * **SemanticAnalysis** agents (sibling) query the graph for ontology matches.  
   * **CodeGraphRAG** (child) performs retrieval‑augmented generation directly on the graph.  

2. **LLM Service** – The `LLMController` (lib/llm/dist/index.js) and the `OntologyClassificationAgent` both import the shared `LLMService` (found under `lib/llm`). This service is configured by **DockerizedServices** through YAML files, enabling different providers (Anthropic, DMR) to be swapped without code changes.  

3. **Hooks** – The hook registry defined in `hooks.md` is a public API. Any sibling component (e.g., **Trajectory**, **ConstraintSystem**) can register custom hooks to react to lifecycle events such as “graph‑updated” or “LLM‑response‑ready”. The BrowserAccess UI registers an `after‑exec` SSE hook to push updates to the client.  

4. **Environment Variables** – The BrowserAccess server demonstrates a pattern that all services follow: runtime configuration is externalised. For instance, the **DockerizedServices** component reads container‑specific env vars to decide which LLM provider to instantiate.  

5. **Constraint Monitoring** – The `mcp‑constraint‑monitor/docs/CLAUDE-CODE-HOOK‑FORMAT.md` file (child **ConstraintMonitoring**) defines a JSON hook payload that agents can emit when a constraint violation is detected. The hook system routes this payload to any registered consumer, allowing the **ConstraintSystem** sibling to react (e.g., abort a workflow or raise an alert).  

---

## Usage Guidelines  

* **Obtain the graph via `getGraphInstance()`** – Always request the graph through the exported function rather than constructing a new Graphology instance. This preserves the singleton guarantee and ensures that automatic JSON sync remains functional.  

* **Follow the lazy‑initialisation contract** – When writing a new Wave‑style agent, replicate the `constructor → ensureLLMInitialized → execute` flow. Do **not** instantiate the LLM in the constructor; instead, call `ensureLLMInitialized()` at the start of `execute`. This keeps start‑up times low and aligns with the pattern used by the **KnowledgeManagement** sibling.  

* **Register hooks early** – Hooks should be registered during module initialization (e.g., top‑level of the file) so that they are available before any component emits events. Use the identifiers documented in `hooks.md` and respect the expected payload shape.  

* **Configure via environment** – Do not hard‑code ports or URLs. For any server‑side component (including new UI front‑ends), read configuration from `process.env` following the naming convention used by BrowserAccess (`*_PORT`, `*_SSE_URL`).  

* **Adhere to coding conventions** – Keep comments concise, use camelCase for functions, PascalCase for classes, and include JSDoc‑style type annotations. Follow the naming style illustrated in the **CodingConventions** child (e.g., README titles, file prefixes).  

* **Testing and contribution** – When extending the graph adapter or adding a new agent, add unit tests that mock the `LLMService` (the service provides a `setMockService` method as shown in **DockerizedServices**). Follow the contribution workflow described in `integrations/code-graph-rag/CONTRIBUTING.md`.  

---

### Architectural patterns identified  

1. **Singleton** – `GraphDatabaseAdapter` supplies a single graph instance.  
2. **Lazy Initialisation** – Wave agents and `LLMController` defer LLM creation until first use.  
3. **Hook / Callback Registry** – Decoupled extensibility via `hooks.md`.  
4. **Environment‑Driven Configuration** – Server ports and URLs read from process env.  
5. **Adapter / Facade** – `GraphDatabaseAdapter` abstracts Graphology + LevelDB; `LLMService` abstracts multiple LLM providers.  

### Design decisions and trade‑offs  

* **Centralised graph vs. distributed stores** – Using a singleton graph guarantees consistency but can become a memory bottleneck for extremely large codebases; however, LevelDB persistence and JSON export mitigate this by off‑loading to disk.  
* **Lazy LLM loading** – Reduces upfront cost and allows many agents to coexist, at the expense of a slight latency on the first LLM call.  
* **Hook system** – Provides high flexibility and low coupling, but requires disciplined documentation (as done in `hooks.md`) to avoid “magic strings” and versioning issues.  
* **Environment configuration** – Simplifies deployment across containers, yet places responsibility on operators to supply correct variables; missing variables can cause runtime failures.  

### System structure insights  

* **CodingPatterns** sits at the heart of the **Coding** hierarchy, supplying cross‑cutting concerns (graph persistence, LLM orchestration, extensibility hooks) that are consumed by all sibling components.  
* Its children **DesignPatterns**, **CodingConventions**, **BestPractices**, **GraphDatabase**, and **ConstraintMonitoring** each expose a focused view of the broader guidance (e.g., the singleton pattern lives in **DesignPatterns**, while JSON export format lives in **ConstraintMonitoring**).  
* The component’s API surface is intentionally small: a graph getter, a hook registry, and a set of LLM‑initialisation utilities. This minimalism encourages reuse and reduces the cognitive load for developers working on siblings such as **LiveLoggingSystem** or **SemanticAnalysis**.  

### Scalability considerations  

* **Graph size** – The combination of in‑memory Graphology and LevelDB scales well to medium‑sized projects; for very large repositories, sharding or a dedicated graph database (e.g., Neo4j) could be introduced without breaking the singleton contract.  
* **Concurrent LLM calls** – Lazy initialisation paired with the shared `LLMService` enables pooling of LLM connections; however, the service must enforce rate‑limiting to avoid provider throttling.  
* **Hook throughput** – Since hooks are synchronous by default, long‑running handlers should off‑load work to background workers (e.g., via a message queue) to keep the main execution path responsive.  

### Maintainability assessment  

The codebase exhibits **high maintainability**:

* **Consistent style** and thorough comments across key files make onboarding straightforward.  
* **Modular adapters** (graph, LLM) isolate third‑party dependencies, allowing upgrades (e.g., moving from LevelDB to RocksDB) with minimal ripple effects.  
* **Explicit patterns** (singleton, lazy init, hooks) are documented in child components, reducing the risk of divergent implementations.  
* **Environment‑driven config** and clear README instructions promote reproducible deployments.  

Potential technical debt lies mainly in the **single‑process singleton graph**, which could become a contention point under heavy parallel workloads. Monitoring memory usage and providing a future‑proof abstraction for a distributed graph store would further strengthen long‑term maintainability.


## Hierarchy Context

### Parent
- [Coding](./Coding.md) -- Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 8 major components: LiveLoggingSystem: [LLM] The LiveLoggingSystem component utilizes a graph database for storing and retrieving knowledge entities, as seen in the Graph-Code system (integ; LLMAbstraction: [LLM] The LLMAbstraction component utilizes the LLMService class (lib/llm/llm-service.ts) as a high-level facade for managing interactions with differ; DockerizedServices: [LLM] The DockerizedServices component employs a modular design, with separate modules for different services, such as the LLMService class (lib/llm/l; Trajectory: [LLM] The Trajectory component's use of adapters, such as the SpecstoryAdapter class in lib/integrations/specstory-adapter.js, allows for flexible con; KnowledgeManagement: [LLM] The KnowledgeManagement component employs a lazy loading approach for LLM initialization, as seen in the constructor-based pattern for wave agen; CodingPatterns: [LLM] The CodingPatterns component demonstrates a strong emphasis on data consistency and integrity, as reflected in the GraphDatabaseAdapter (storage; ConstraintSystem: [LLM] The ConstraintSystem component utilizes a GraphDatabaseAdapter (integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.js); SemanticAnalysis: [LLM] The SemanticAnalysis component's architecture is designed as a multi-agent system, with each agent responsible for a specific task. For instance.

### Children
- [DesignPatterns](./DesignPatterns.md) -- The GraphDatabaseAdapter class in storage/graph-database-adapter.ts utilizes the singleton pattern to provide a single instance of the graph database across the application.
- [CodingConventions](./CodingConventions.md) -- The integrations/code-graph-rag/README.md file follows a consistent naming convention, indicating adherence to coding standards.
- [BestPractices](./BestPractices.md) -- The integrations/code-graph-rag/CONTRIBUTING.md file outlines contribution guidelines, indicating a focus on best practices for code review and testing.
- [GraphDatabase](./GraphDatabase.md) -- The storage/graph-database-adapter.ts file provides a graph database adapter, indicating the use of a graph database.
- [ConstraintMonitoring](./ConstraintMonitoring.md) -- The mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md file defines the hook data format, potentially including constraints.

### Siblings
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- [LLM] The LiveLoggingSystem component utilizes a graph database for storing and retrieving knowledge entities, as seen in the Graph-Code system (integrations/code-graph-rag/README.md). This allows for efficient querying and retrieval of entities, which is crucial for the system's classification layers. The OntologyClassificationAgent (integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts) plays a key role in this process, as it classifies observations against the ontology system. The agent's constructor and the ensureLLMInitialized method demonstrate a lazy initialization approach for LLM services, which helps prevent unnecessary computations and improves overall system performance.
- [LLMAbstraction](./LLMAbstraction.md) -- [LLM] The LLMAbstraction component utilizes the LLMService class (lib/llm/llm-service.ts) as a high-level facade for managing interactions with different LLM providers. This class employs dependency injection, allowing for flexible configuration of the component, including the injection of mock services and budget trackers. The LLMService class also defines a set of interfaces (lib/llm/types.js) for LLM providers, requests, and responses, ensuring a standardized interaction with different providers. For example, the LLMService class uses the provider registry (lib/llm/provider-registry.js) to manage the registration and retrieval of various LLM providers, such as the AnthropicProvider (lib/llm/providers/anthropic-provider.ts) and DMRProvider (lib/llm/providers/dmr-provider.ts).
- [DockerizedServices](./DockerizedServices.md) -- [LLM] The DockerizedServices component employs a modular design, with separate modules for different services, such as the LLMService class (lib/llm/llm-service.ts) for managing large language model operations. This modularity allows for easier maintenance and updates, as well as scalability. For instance, the LLMService class utilizes dependency injection through the setModeResolver, setMockService, and setBudgetTracker methods, making it easier to test and extend the service. Additionally, the use of configuration files, such as YAML files, to manage settings and priorities for different providers and services, enables flexible configuration and customization.
- [Trajectory](./Trajectory.md) -- [LLM] The Trajectory component's use of adapters, such as the SpecstoryAdapter class in lib/integrations/specstory-adapter.js, allows for flexible connections to external services. This adapter attempts to connect to the Specstory extension via HTTP, IPC, or file watch, demonstrating a persistent connection approach. For instance, the connectViaHTTP method tries multiple ports to establish a connection, showcasing the adapter's ability to handle varying connection scenarios. This flexibility is crucial for maintaining a scalable and maintainable system, enabling easier integration of new services or features as needed.
- [KnowledgeManagement](./KnowledgeManagement.md) -- [LLM] The KnowledgeManagement component employs a lazy loading approach for LLM initialization, as seen in the constructor-based pattern for wave agents. This is evident in the ensureLLMInitialized() method, which suggests that the component defers the initialization of Large Language Models (LLMs) until they are actually needed. This design decision helps to reduce memory consumption and improve system responsiveness, especially when dealing with multiple LLMs. The use of a shared atomic index counter for work-stealing concurrency in the runWithConcurrency() method (wave-controller.ts:489) further enhances the component's efficiency by allowing it to dynamically adjust its workload and minimize idle time.
- [ConstraintSystem](./ConstraintSystem.md) -- [LLM] The ConstraintSystem component utilizes a GraphDatabaseAdapter (integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.js) to store and retrieve knowledge in a graph-based structure, which enables efficient querying and analysis of entity relationships. This choice of data storage allows for flexible and scalable management of complex constraints. Furthermore, the GraphDatabaseAdapter class provides methods for adding, removing, and updating graph nodes and edges, facilitating dynamic modifications to the knowledge graph.
- [SemanticAnalysis](./SemanticAnalysis.md) -- [LLM] The SemanticAnalysis component's architecture is designed as a multi-agent system, with each agent responsible for a specific task. For instance, the OntologyClassificationAgent (integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts) is used for classifying observations against the ontology system. This agent extends the BaseAgent (integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts) class, which provides a standardized structure for agent development. The use of a base agent class ensures consistency across all agents and simplifies the development of new agents. The OntologyClassificationAgent's classification process involves querying the GraphDatabaseAdapter (storage/graph-database-adapter.js) to retrieve relevant data for classification.


---

*Generated from 5 observations*
