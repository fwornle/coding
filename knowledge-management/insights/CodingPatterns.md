# CodingPatterns

**Type:** Component

The integration of the ontology classification agent, located in integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts, allows the CodingPatterns component to perform ontology-based analysis. This agent enables the component to categorize and analyze coding patterns using ontological frameworks, providing a more nuanced understanding of coding practices and their relationships. By leveraging this agent, the component can offer more accurate and informative insights into coding patterns, ultimately supporting better-informed decision-making and code development.

## What It Is  

The **CodingPatterns** component lives under the `coding` knowledge hierarchy and is implemented across several source files. Its core responsibilities are to **store, retrieve, and analyse coding‑pattern knowledge** using a graph‑database backend. The component’s entry points are scattered through:

* `storage/graph-database-adapter.ts` – the low‑level adapter that persists pattern entities.  
* `integrations/mcp-server-semantic-analysis/src/agents/code-graph-agent.ts` – an agent that builds and analyses code graphs.  
* `integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts` – an ontology‑classification agent that adds semantic depth to pattern data.  
* `lib/agent-api/hooks/hook-manager.js` – the **UnifiedHookManager** used to register event handlers for pattern‑related events.  

Within the component, the **DesignPatternManager** class orchestrates retrieval of stored patterns for security‑ and validation‑related use‑cases. The component also follows a **lazy LLM initialization** workflow (`constructor(repoPath, team) → ensureLLMInitialized() → execute(input)`) that mirrors the approach used by other “wave agents” in the codebase.

In short, CodingPatterns is a graph‑backed, agent‑driven knowledge service that supplies design‑pattern data to the rest of the system while remaining responsive to events and capable of semantic enrichment via ontology classification.

---

## Architecture and Design  

### Adapter‑Based Persistence  
The component relies on the **GraphDatabaseAdapter** (`storage/graph-database-adapter.ts`). This class implements an **Adapter pattern** that abstracts the underlying graph store (Graphology + LevelDB) behind a simple API such as `createEntity()`. By delegating all persistence concerns to this adapter, CodingPatterns stays decoupled from the concrete database implementation, enabling other siblings—*KnowledgeManagement* and *ConstraintSystem*—to reuse the same persistence layer without duplication.

### Manager & Service Layer  
`DesignPatternManager` acts as a **Manager/Facade** that groups together retrieval logic, security checks, and validation steps. It hides the details of how patterns are fetched from the graph database, exposing a clean interface to callers. This mirrors the design of the *LLMAbstraction* component’s `LLMService` façade, reinforcing a consistent service‑oriented style across the hierarchy.

### Multi‑Agent Collaboration  
Two agents are explicitly mentioned:

* **CodeGraphAgent** (`integrations/mcp-server-semantic-analysis/src/agents/code-graph-agent.ts`) – builds a graph representation of source code and pushes it into the graph database.  
* **OntologyClassificationAgent** (`integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts`) – consumes the stored patterns and classifies them against an ontology.

Both agents follow the **Multi‑Agent System** approach used by the sibling *SemanticAnalysis* component. Each agent has a narrow responsibility (graph construction vs. semantic classification) and communicates through shared persistence (the GraphDatabaseAdapter) and event hooks.

### Event‑Driven Hook Manager  
`UnifiedHookManager` (`lib/agent-api/hooks/hook-manager.js`) provides a **Publish‑Subscribe** style mechanism. CodingPatterns registers handlers for events such as “design pattern update” or “code‑graph change”. This enables the component to react asynchronously to changes made by agents or external services, embodying an **event‑driven architecture** without a full message‑bus.

### Lazy LLM Initialization  
The constructor pattern `constructor(repoPath, team) → ensureLLMInitialized() → execute(input)` mirrors the **Lazy Initialization** pattern used throughout the “wave agents”. The LLM (large language model) client is only instantiated when the component actually needs to generate or evaluate pattern‑related text, conserving resources and reducing start‑up latency.

---

## Implementation Details  

1. **GraphDatabaseAdapter (`storage/graph-database-adapter.ts`)**  
   * Exposes `createEntity()` which receives a design‑pattern payload and stores it as a node in the underlying graph.  
   * Handles low‑level graph operations (node/edge creation, indexing) and synchronises a JSON export for downstream consumption, a behaviour shared with the *ConstraintSystem* sibling.

2. **DesignPatternManager**  
   * Instantiated by the CodingPatterns component to retrieve patterns.  
   * Calls the adapter’s read APIs, then runs security‑validation routines before returning data to callers.  
   * Centralises pattern‑related business rules, making it the single source of truth for validation logic.

3. **CodeGraphAgent (`integrations/mcp-server-semantic-analysis/src/agents/code-graph-agent.ts`)**  
   * Parses repository code (using the repoPath supplied to the component) and constructs a code‑graph representation.  
   * Persists the graph via `GraphDatabaseAdapter.createEntity()`.  
   * Emits events through `UnifiedHookManager` (e.g., `codeGraphCreated`) so other agents can react.

4. **OntologyClassificationAgent (`integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts`)**  
   * Retrieves stored patterns and code graphs, then applies an ontology model to classify each pattern.  
   * Updates the graph with classification metadata, again using the adapter.  
   * Registers a hook for pattern‑update events so newly added patterns are automatically classified.

5. **UnifiedHookManager (`lib/agent-api/hooks/hook-manager.js`)**  
   * Provides `register(eventName, handler)` and `emit(eventName, payload)`.  
   * Allows CodingPatterns to stay loosely coupled: agents only need to know the event name, not the concrete consumer.

6. **Lazy LLM Initialization**  
   * The component’s constructor stores `repoPath` and `team` but does not create the LLM client.  
   * `ensureLLMInitialized()` checks a private flag; if the client is missing, it loads the appropriate provider from the **LLMAbstraction** registry (`lib/llm/provider-registry.js`).  
   * `execute(input)` is the public entry point that guarantees the LLM is ready before delegating the request.

All of these pieces are wired together at runtime by the parent **Coding** component, which provides the overall knowledge‑graph context and ensures that sibling components share the same `GraphDatabaseAdapter` instance where appropriate.

---

## Integration Points  

* **Persistence Layer** – Both *KnowledgeManagement* and *ConstraintSystem* share the same `GraphDatabaseAdapter`. Any change to the adapter (e.g., swapping LevelDB for another store) propagates uniformly across these components, reducing duplication but creating a shared‑runtime dependency.

* **Agent Ecosystem** – The `CodeGraphAgent` and `OntologyClassificationAgent` are part of the broader *SemanticAnalysis* multi‑agent system. They communicate indirectly via the graph database and directly via `UnifiedHookManager`. This design allows new agents to be added without modifying existing code, as long as they respect the hook contract.

* **LLM Provider Registry** – The lazy‑init path pulls the LLM client from the `ProviderRegistry` used by the *LLMAbstraction* sibling. This ensures a consistent provider configuration (e.g., Anthropic, DMR) across the entire platform.

* **Event Hooks** – Any component that needs to react to pattern changes can simply register a handler with `UnifiedHookManager`. For example, a hypothetical *LiveLoggingSystem* could listen for `designPatternUpdated` to enrich live logs with pattern metadata.

* **Ontology Services** – The ontology classification agent depends on an external ontology definition (not detailed in the observations) but is invoked automatically whenever a pattern entity is created or updated, ensuring semantic consistency throughout the system.

---

## Usage Guidelines  

1. **Persisting a New Pattern** – Use the `GraphDatabaseAdapter.createEntity()` method. Supply a well‑formed pattern object that includes at least a unique identifier, description, and any initial metadata. After creation, emit a `designPatternCreated` event via `UnifiedHookManager` so downstream agents (e.g., ontology classification) can act.

2. **Retrieving Patterns** – Call the `DesignPatternManager` methods. They will automatically enforce the security and validation checks baked into the manager. Do not bypass the manager to query the adapter directly, as this would skip important validation logic.

3. **Extending Functionality** – To add a new analysis step, implement a new agent that registers for relevant events (`codeGraphCreated`, `designPatternUpdated`, etc.) and interacts with the graph through the adapter. Follow the existing file placement conventions (`integrations/mcp-server-semantic-analysis/src/agents/`) to keep the codebase discoverable.

4. **LLM Interaction** – When you need LLM‑driven insight (e.g., generating a pattern description), invoke the component’s `execute(input)` method. Trust that `ensureLLMInitialized()` will lazily load the appropriate provider; avoid manually instantiating LLM clients inside the component.

5. **Testing & Mocking** – Because persistence is abstracted behind the adapter, unit tests can replace `GraphDatabaseAdapter` with an in‑memory mock. Likewise, agents can be tested by emitting events on a test instance of `UnifiedHookManager` rather than starting the full multi‑agent system.

---

### 1. Architectural patterns identified  

* **Adapter pattern** – `GraphDatabaseAdapter` abstracts the concrete graph store.  
* **Manager/Facade pattern** – `DesignPatternManager` centralises retrieval and validation logic.  
* **Multi‑Agent System** – `CodeGraphAgent` and `OntologyClassificationAgent` operate as independent agents that collaborate through shared storage and events.  
* **Publish‑Subscribe (Event‑Driven) pattern** – `UnifiedHookManager` enables loose coupling between producers and consumers of pattern‑related events.  
* **Lazy Initialization** – The constructor → `ensureLLMInitialized()` → `execute()` sequence delays LLM client creation until needed.

### 2. Design decisions and trade‑offs  

* **Centralised graph adapter** simplifies data consistency across siblings but creates a single point of failure; any change to the adapter impacts multiple components.  
* **Event‑driven hooks** provide extensibility without tight coupling, yet they introduce indirect control flow that can be harder to trace during debugging.  
* **Lazy LLM init** conserves resources, especially in environments where many agents run concurrently, but it adds a small runtime check on every LLM‑related call.  
* **Agent segregation** (graph building vs. ontology classification) improves separation of concerns but requires careful ordering of events to avoid race conditions.

### 3. System structure insights  

The CodingPatterns component sits under the **Coding** root, sharing the `GraphDatabaseAdapter` child with *KnowledgeManagement* and *ConstraintSystem*. Its sibling components each showcase a different cross‑cutting concern (logging, LLM abstraction, service startup, trajectory management), illustrating a **modular, feature‑sliced architecture** where each top‑level component owns a distinct capability but reuses common infrastructure (adapter, hook manager, provider registry). The component’s internal agents form a **vertical slice** that handles a specific domain (coding‑pattern knowledge) from ingestion (code graph) through enrichment (ontology) to consumption (DesignPatternManager).

### 4. Scalability considerations  

* **Graph‑database backend** – By using Graphology + LevelDB, the system can handle large, highly‑connected pattern data sets, but scaling beyond a single node would require replacing the adapter with a distributed graph store.  
* **Event throughput** – `UnifiedHookManager` is in‑process; if the number of events grows dramatically, a move to an external message broker may be needed to avoid bottlenecks.  
* **Agent parallelism** – Agents can be instantiated per repository or per team, allowing horizontal scaling; however, concurrent writes to the same graph node must be guarded (optimistic locking is not mentioned).  
* **LLM usage** – Lazy init reduces unnecessary LLM loads, but high‑frequency calls could still saturate the provider; integrating caching (as seen in *LLMAbstraction*’s `LLMService`) would mitigate this.

### 5. Maintainability assessment  

The component’s **clear separation of concerns** (adapter, manager, agents, hooks) makes the codebase approachable for new developers. Reuse of shared infrastructure (adapter, hook manager, provider registry) reduces duplication and eases updates. However, the **indirect coupling via events** can obscure execution paths, so comprehensive documentation of emitted event names and payload schemas is essential. The reliance on a single `GraphDatabaseAdapter` instance across multiple components simplifies data consistency but may increase the impact of breaking changes; versioning the adapter or providing a thin façade per consumer could improve resilience. Overall, the design balances extensibility with reasonable complexity, positioning the component for incremental evolution.


## Hierarchy Context

### Parent
- [Coding](./Coding.md) -- Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 8 major components: LiveLoggingSystem: The LiveLoggingSystem's utilization of the OntologyClassificationAgent, as seen in integrations/mcp-server-semantic-analysis/src/agents/ontology-class; LLMAbstraction: The LLMAbstraction component utilizes a provider registry, implemented in the ProviderRegistry class (lib/llm/provider-registry.js), to manage the reg; DockerizedServices: The DockerizedServices component employs a robust service startup mechanism through the startServiceWithRetry function in lib/service-starter.js, whic; Trajectory: The Trajectory component's use of the SpecstoryAdapter class in lib/integrations/specstory-adapter.js demonstrates a modular architecture, allowing fo; KnowledgeManagement: The KnowledgeManagement component's utilization of the GraphDatabaseAdapter (storage/graph-database-adapter.ts) for Graphology+LevelDB persistence all; CodingPatterns: The CodingPatterns component utilizes the GraphDatabaseAdapter, as seen in storage/graph-database-adapter.ts, to store and retrieve coding patterns. T; ConstraintSystem: The ConstraintSystem component utilizes a GraphDatabaseAdapter for graph persistence, which automatically syncs data to JSON export. This is evident i; SemanticAnalysis: The SemanticAnalysis component utilizes a multi-agent system architecture, which allows for the integration of various agents, each with its own speci.

### Children
- [GraphDatabaseAdapter](./GraphDatabaseAdapter.md) -- GraphDatabaseAdapter uses the createEntity() method in storage/graph-database-adapter.ts to store design patterns as entities in the graph database

### Siblings
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- The LiveLoggingSystem's utilization of the OntologyClassificationAgent, as seen in integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts, allows for the classification of observations against the ontology system. This classification is crucial for the system's ability to process and understand the live session logs from various agents. The OntologyClassificationAgent's implementation enables the LiveLoggingSystem to categorize and make sense of the vast amounts of data it receives, making it a vital component of the system's architecture. Furthermore, the agent's integration with the GraphDatabaseAdapter, as defined in storage/graph-database-adapter.ts, facilitates the persistence of classified observations in a graph database, enabling efficient querying and analysis of the data.
- [LLMAbstraction](./LLMAbstraction.md) -- The LLMAbstraction component utilizes a provider registry, implemented in the ProviderRegistry class (lib/llm/provider-registry.js), to manage the registration and initialization of various LLM providers, such as Anthropic and DMR, allowing for easy addition or removal of providers without modifying the underlying code. This approach enables a high degree of flexibility and scalability, as new providers can be integrated by simply registering them with the ProviderRegistry. Furthermore, the use of a registry decouples the providers from the rest of the system, making it easier to develop, test, and maintain individual providers independently. The LLMService class (lib/llm/llm-service.ts) serves as a high-level facade for all LLM operations, incorporating mode routing, caching, and circuit breaking, which helps to abstract away the complexities of provider management and provides a unified interface for interacting with the LLM providers.
- [DockerizedServices](./DockerizedServices.md) -- The DockerizedServices component employs a robust service startup mechanism through the startServiceWithRetry function in lib/service-starter.js, which utilizes a retry-with-backoff pattern to handle service startup failures. This approach ensures that services are given multiple opportunities to start successfully, with increasing time delays between attempts, thereby preventing rapid sequential failures. The isPortListening function within the same file performs health verification checks to confirm that services are responding correctly, adding an extra layer of reliability to the startup process. For instance, when starting Memgraph or Redis services, this mechanism ensures they are properly initialized and ready to accept requests before proceeding with the application startup.
- [Trajectory](./Trajectory.md) -- The Trajectory component's use of the SpecstoryAdapter class in lib/integrations/specstory-adapter.js demonstrates a modular architecture, allowing for the management of connections and logging in a flexible and adaptable manner. This class implements a retry mechanism for connection establishment, showcasing a RetryPolicy pattern. The connectViaHTTP method in this class attempts to connect to the Specstory extension via HTTP on multiple ports, highlighting a flexible connection establishment approach. Furthermore, the createLogger function from logging/Logger.js is used to establish a logger instance, providing a standardized logging mechanism.
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component's utilization of the GraphDatabaseAdapter (storage/graph-database-adapter.ts) for Graphology+LevelDB persistence allows for automatic JSON export sync, ensuring data consistency across the system. This design decision enables efficient data storage and retrieval, leveraging the strengths of both Graphology and LevelDB. The automatic JSON export sync feature, in particular, facilitates seamless integration with other components, as seen in the execute() function of the PersistenceAgent (agents/persistence-agent.ts), which relies on the GraphDatabaseAdapter for entity persistence and ontology classification.
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem component utilizes a GraphDatabaseAdapter for graph persistence, which automatically syncs data to JSON export. This is evident in the storage/graph-database-adapter.ts file, where the adapter is implemented to handle graph data storage and retrieval. The use of this adapter enables efficient data management and provides a robust foundation for the constraint system. Furthermore, the automatic JSON export sync feature ensures that data is consistently updated and available for further processing or analysis.
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component utilizes a multi-agent system architecture, which allows for the integration of various agents, each with its own specific responsibilities. For instance, the OntologyClassificationAgent (integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts) is responsible for classifying observations against the ontology system. This agent follows the BaseAgent (integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts) pattern, which standardizes agent behavior and response envelope creation. The use of this pattern ensures consistency across all agents, making it easier for new developers to understand and contribute to the codebase.


---

*Generated from 6 observations*
