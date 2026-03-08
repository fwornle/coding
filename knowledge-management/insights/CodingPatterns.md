# CodingPatterns

**Type:** Component

The CodingPatterns component follows a modular approach in its components and sub-components, such as the DockerModelRunner class in lib/llm/docker-model-runner.ts. This modularity suggests a design focused on maintainability and scalability, as each component can be easily updated or replaced without affecting the rest of the system. The use of a modular approach also enables the component to be easily extended or customized, as new components or sub-components can be added as needed. This is evident in the way the EntityClassifier sub-component is designed, as it can be easily replaced or updated without affecting the rest of the component. The modular approach also reflects the use of the RetryManager and the SemanticInsightGenerator, which are designed to work together to provide robust and informative output.

## What It Is  

The **CodingPatterns** component lives under the `integrations/mcp-server-semantic-analysis/` tree and is the part of the system that discovers, stores, and serves reusable coding‑level knowledge such as design patterns, coding conventions, and quality‑related insights.  The core implementation touches a handful of concrete files that make the component observable:

* **Persistence** – `graph-database-config.json` ( `config/graph-database-config.json` ) defines the connection to a graph database and is consumed by the **GraphDatabase** class.  
* **Adapter layer** – `integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts` implements **GraphDatabaseAdapter**, the abstraction that shields the rest of the component from the underlying graph store.  
* **Pattern storage** – `integrations/mcp-server-semantic-analysis/src/pattern-storage/pattern-storage.ts` (the **PatternStorage** sub‑component) uses the adapter to read/write design patterns, conventions and related entities.  
* **LLM interaction** – `lib/llm/llm-service.ts` contains **LLMService**, a high‑level façade that orchestrates calls to large‑language‑model providers and persists the results through the **GraphDatabaseAdapter**.  
* **Entity classification** – `integrations/mcp-server-semantic-analysis/src/classifier/entity-classifier.ts` provides the **EntityClassifier** with its `classifyEntity` method.  
* **Model execution** – `lib/llm/docker-model-runner.ts` defines **DockerModelRunner**, a pluggable runner for locally hosted LLM containers.  
* **Reliability** – `integrations/mcp-server-semantic-analysis/src/utils/retry-manager.ts` implements **RetryManager**, while `integrations/mcp-server-semantic-analysis/src/insight-generator/semantic-insight-generator.ts` hosts **SemanticInsightGenerator** that produces the final insights using the retry logic.

Together these files make up a self‑contained, graph‑backed knowledge service that sits under the top‑level **Coding** component and works alongside siblings such as **LiveLoggingSystem**, **LLMAbstraction**, **DockerizedServices**, **Trajectory**, **KnowledgeManagement**, and **SemanticAnalysis**.

---

## Architecture and Design  

The design of **CodingPatterns** is deliberately modular and layered, reflecting a classic *Adapter + Facade* architecture:

1. **Adapter pattern** – `GraphDatabaseAdapter` abstracts the concrete graph database (configured in `graph-database-config.json`).  All persistence calls from child modules (`PatternStorage`, `CodingConvention`, `DesignPatternAnalyzer`, `CodeQualityEvaluator`) go through this adapter, enabling the underlying store to be swapped without touching higher‑level logic.

2. **Facade pattern** – `LLMService` acts as a façade for all LLM‑related activities.  It hides the complexity of provider selection (Anthropic, Docker‑based models via `DockerModelRunner`, etc.) and presents a simple API to the rest of the component.  This mirrors the façade used by the sibling **LLMAbstraction** component, reinforcing a shared architectural language across the codebase.

3. **Modular decomposition** – Each functional concern lives in its own sub‑component (e.g., `EntityClassifier`, `PatternStorage`, `SemanticInsightGenerator`).  The modules expose narrow, well‑defined interfaces (e.g., `classifyEntity`, `storePattern`, `generateInsights`) so they can be replaced or extended independently.  The observation that “the EntityClassifier sub‑component can be easily replaced” illustrates this intent.

4. **Retry‑with‑backoff** – `RetryManager` implements a reusable retry strategy that is injected into the insight generation pipeline (`SemanticInsightGenerator`).  This pattern is also echoed in the sibling **DockerizedServices** component’s `ServiceStarter`, indicating a system‑wide reliability convention.

5. **Configuration‑driven persistence** – The presence of `graph-database-config.json` signals a declarative approach to external resources.  The component reads this file at start‑up, allowing operators to point the service at different graph back‑ends (e.g., Neo4j, Graphology‑LevelDB) without code changes.

The interaction flow can be summarised as:

```
[LLMService] ──► (DockerModelRunner / Provider) ──► LLM output
        │
        ▼
[EntityClassifier] – classifies entities in the LLM output
        │
        ▼
[PatternStorage] – persists classified patterns via GraphDatabaseAdapter
        │
        ▼
[SemanticInsightGenerator] – reads stored patterns, produces insights
        │
        ▼
[RetryManager] – wraps calls to handle transient failures
```

All of this lives under the **Coding** parent, sharing the graph‑database abstraction with the sibling **KnowledgeManagement** component, which also uses `GraphDatabaseAdapter`.  This commonality reduces duplication and encourages reuse of persistence logic across the broader system.

---

## Implementation Details  

### Persistence Layer  
* **`graph-database-config.json`** – JSON file containing host, port, credentials and optional driver options for the graph store.  
* **`GraphDatabase`** – instantiated using the configuration; provides low‑level CRUD operations on nodes and edges.  
* **`GraphDatabaseAdapter`** (`integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts`) – wraps `GraphDatabase` and exposes domain‑specific methods such as `savePattern(pattern)`, `findPatternsByEntity(entityId)`, and `exportGraphAsJson()`.  The adapter uses Graphology and LevelDB under the hood (as noted in the sibling KnowledgeManagement description), giving it both in‑memory graph semantics and durable storage.

### Pattern Management  
* **`PatternStorage`** – located in `integrations/mcp-server-semantic-analysis/src/pattern-storage/pattern-storage.ts`.  It coordinates the lifecycle of design patterns, coding conventions, and quality rules.  Calls like `storePattern`, `updatePattern`, `queryPatterns` delegate to the adapter, ensuring that complex relationships (e.g., “pattern A extends pattern B”) are persisted as graph edges.

### LLM Integration  
* **`LLMService`** (`lib/llm/llm-service.ts`) – a façade that receives high‑level requests (e.g., “generate patterns for a given code snippet”).  It selects a provider based on configuration, forwards the request to either an external API or the **DockerModelRunner**, and then passes the raw LLM output to the **EntityClassifier**.  
* **`DockerModelRunner`** (`lib/llm/docker-model-runner.ts`) – encapsulates Docker Desktop’s Model Runner, handling container lifecycle, health checks and model versioning.  Because it implements a common provider interface, swapping it for a cloud‑based provider requires only a configuration change.

### Classification & Insight Generation  
* **`EntityClassifier`** (`integrations/mcp-server-semantic-analysis/src/classifier/entity-classifier.ts`) – implements `classifyEntity(text: string): ClassificationResult`.  The method analyses the LLM output, identifies entities such as “Singleton”, “Factory”, or “Code Smell”, and tags them with relevance scores.  Its modular design means a new classifier (e.g., a transformer‑based one) can replace the current implementation without touching downstream code.  
* **`SemanticInsightGenerator`** (`integrations/mcp-server-semantic-analysis/src/insight-generator/semantic-insight-generator.ts`) – pulls classified entities and stored patterns, performs graph traversals (e.g., “find all patterns linked to a given entity”), and emits structured insights.  All calls that touch the database are wrapped by **`RetryManager`**.

### Reliability  
* **`RetryManager`** (`integrations/mcp-server-semantic-analysis/src/utils/retry-manager.ts`) – provides `executeWithRetry<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T>`.  Options include max attempts, exponential back‑off, and jitter.  The manager is used by both the insight generator and any direct storage calls, guaranteeing graceful recovery from temporary network glitches or database hiccups.

---

## Integration Points  

1. **Parent – Coding**  
   *The CodingPatterns component is one leaf of the overall **Coding** knowledge hierarchy.*  It contributes pattern knowledge that other parents (e.g., **LiveLoggingSystem** for ontology classification or **Trajectory** for speculative story generation) can consume via the shared graph store.

2. **Sibling – KnowledgeManagement**  
   *Both components rely on the same `GraphDatabaseAdapter`* (the sibling’s implementation lives in `integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts`).  This enables cross‑component queries such as “show all design patterns that affect a given ontology node”.

3. **Child – CodingConvention, DesignPatternAnalyzer, CodeQualityEvaluator**  
   Each child module uses the façade exposed by `LLMService` to request LLM‑generated analyses, then persists its results through `PatternStorage`.  For example, `CodingConvention` calls `LLMService.generateConvention(codeSnippet)` and stores the returned convention via `PatternStorage.saveConvention`.

4. **External LLM Providers**  
   The **DockerModelRunner** interacts with a locally hosted Docker container, while the abstract provider interface used by `LLMService` also allows cloud providers (e.g., Anthropic).  This plug‑in point is defined in `lib/llm/providers/*` and is shared with the sibling **LLMAbstraction** component.

5. **Retry & Resilience**  
   `RetryManager` is a cross‑cutting utility also used by **DockerizedServices** (`ServiceStarter`).  Its public API is imported wherever a potentially flaky operation occurs, ensuring a consistent retry strategy across the system.

6. **Configuration**  
   All components that need database access read `config/graph-database-config.json`.  Changing the JSON (e.g., switching from a local LevelDB graph to a remote Neo4j instance) automatically propagates to **CodingPatterns**, **KnowledgeManagement**, and any other consumer of the adapter.

---

## Usage Guidelines  

* **Prefer the façade** – All interactions with LLMs should go through `LLMService`.  Directly instantiating a provider bypasses health‑check logic and may break future provider‑fallback mechanisms.  
* **Persist through PatternStorage** – When adding a new design pattern, coding convention, or quality rule, use the `PatternStorage` API (`savePattern`, `updatePattern`).  This guarantees that relationships are correctly represented in the graph and that the `RetryManager` will guard the operation.  
* **Classify before storing** – Run the raw LLM output through `EntityClassifier.classifyEntity` first; the classification result is required by downstream insight generation and ensures that the graph contains enriched metadata.  
* **Configure the graph once** – Do not duplicate connection settings; edit `config/graph-database-config.json` and rely on the shared `GraphDatabaseAdapter`.  This avoids configuration drift between siblings.  
* **Handle retries at the call site** – When writing custom utilities that touch the graph directly, wrap the call with `RetryManager.executeWithRetry`.  Do not re‑implement back‑off logic; reuse the existing manager to stay consistent with the rest of the system.  
* **Testing** – Mock `GraphDatabaseAdapter` rather than the concrete `GraphDatabase` when unit‑testing child modules.  This respects the adapter boundary and keeps tests fast and deterministic.  
* **Extending classifiers** – If a new classification algorithm is needed, implement the same `classifyEntity` signature and register the class in the DI container used by `LLMService`.  No changes to `SemanticInsightGenerator` are required because it only consumes the classification result.

---

### Architectural patterns identified  

1. **Adapter** – `GraphDatabaseAdapter` abstracts the graph persistence layer.  
2. **Facade** – `LLMService` provides a unified entry point for LLM operations.  
3. **Modular decomposition** – distinct sub‑components (`EntityClassifier`, `PatternStorage`, `SemanticInsightGenerator`).  
4. **Retry‑with‑backoff** – `RetryManager` implements a reusable resilience pattern.  
5. **Configuration‑driven external resource** – `graph-database-config.json` governs persistence.

### Design decisions and trade‑offs  

* **Graph database choice** – Enables rich relationship queries at the cost of requiring a specialized storage engine and operational overhead.  
* **Adapter layer** – Adds an indirection layer, increasing code size but granting flexibility to swap the backend.  
* **Facade over multiple LLM providers** – Provides provider agnosticism and easy fallback, but introduces a larger abstraction surface that must be kept in sync with provider capabilities.  
* **Modularity** – Facilitates independent evolution of classifiers, storage, and insight generation, yet may lead to higher runtime latency due to extra indirection if not carefully tuned.  
* **Retry manager** – Improves robustness for transient failures; however, excessive retries could mask underlying performance problems if not bounded.

### System structure insights  

The component sits as a leaf under the **Coding** parent, sharing the graph‑database adapter with **KnowledgeManagement** and exposing its own child services (`CodingConvention`, `DesignPatternAnalyzer`, `CodeQualityEvaluator`, `PatternStorage`).  The sibling components adopt similar modular and resilience patterns, indicating a coherent architectural language across the whole project.

### Scalability considerations  

* **Graph‑database scaling** – Horizontal scaling can be achieved by moving from an embedded LevelDB graph to a clustered Neo4j or JanusGraph; the adapter shields the rest of the code from this change.  
* **LLM provider scaling** – `LLMService` can route requests to multiple providers or to a pool of Docker containers, allowing load‑balancing and parallel inference.  
* **Retry back‑off parameters** – Must be tuned for high‑throughput scenarios to avoid cascading retries that could overwhelm the database.  
* **Modular isolation** – Because each sub‑component can be deployed or scaled independently (e.g., running `SemanticInsightGenerator` as a separate worker), the system can grow horizontally without monolithic bottlenecks.

### Maintainability assessment  

The heavy reliance on well‑named adapters, facades, and clearly scoped sub‑components yields high maintainability:

* **Clear boundaries** – Each module has a single responsibility, making code reviews and bug isolation straightforward.  
* **Reusable utilities** – `RetryManager` and the shared `GraphDatabaseAdapter` prevent duplication and centralize changes.  
* **Configuration centralisation** – All persistence settings live in a single JSON file, simplifying environment changes.  
* **Potential technical debt** – The extra abstraction layers (adapter + façade) introduce indirection that new developers must understand; comprehensive documentation (as produced here) mitigates that risk.  
* **Testability** – Interfaces are small and mockable, supporting unit tests for each child component without requiring a live graph database.

Overall, the **CodingPatterns** component exhibits a disciplined, modular architecture that balances flexibility (through adapters and facades) with robustness (retry management) while remaining aligned with the broader design language of the **Coding** parent ecosystem.


## Hierarchy Context

### Parent
- [Coding](./Coding.md) -- Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 8 major components: LiveLoggingSystem: The LiveLoggingSystem component utilizes the OntologyClassificationAgent class from integrations/mcp-server-semantic-analysis/src/agents/ontology-clas; LLMAbstraction: The LLMAbstraction component's architecture is designed with a high-level facade, specifically the LLMService class (lib/llm/llm-service.ts), which se; DockerizedServices: The DockerizedServices component utilizes a microservices architecture, with multiple sub-components and services working together to enable efficient; Trajectory: The Trajectory component's modular design pattern is evident in its use of classes and objects, such as the SpecstoryAdapter class in lib/integrations; KnowledgeManagement: The KnowledgeManagement component utilizes a GraphDatabaseAdapter for persistence, which is implemented in the file integrations/mcp-server-semantic-a; CodingPatterns: The CodingPatterns component utilizes the GraphDatabase class for persistence, as indicated by the presence of graph-database-config.json in the confi; ConstraintSystem: The ConstraintSystem component's utilization of the observer pattern for event handling is a key architectural aspect that enables efficient managemen; SemanticAnalysis: The SemanticAnalysis component utilizes a modular approach to agent development, with each agent having its own configuration and initialization logic.

### Children
- [CodingConvention](./CodingConvention.md) -- CodingConvention interacts with the GraphDatabaseAdapter in the lib/llm/llm-service.ts file to store and retrieve coding conventions.
- [DesignPatternAnalyzer](./DesignPatternAnalyzer.md) -- DesignPatternAnalyzer interacts with the GraphDatabaseAdapter in the lib/llm/llm-service.ts file to store and retrieve design pattern analysis results.
- [CodeQualityEvaluator](./CodeQualityEvaluator.md) -- CodeQualityEvaluator interacts with the GraphDatabaseAdapter in the lib/llm/llm-service.ts file to store and retrieve code quality evaluation results.
- [PatternStorage](./PatternStorage.md) -- PatternStorage interacts with the GraphDatabaseAdapter in the lib/llm/llm-service.ts file to store and retrieve coding patterns and entities.
- [GraphDatabaseAdapter](./GraphDatabaseAdapter.md) -- GraphDatabaseAdapter interacts with the graph database using the graph-database-config.json file in the config directory.

### Siblings
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- The LiveLoggingSystem component utilizes the OntologyClassificationAgent class from integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts for classifying observations against an ontology system. This agent is crucial for the system's ability to categorize and make sense of the data it processes. The use of this agent is a prime example of how the system's design incorporates external services to enhance its functionality. Furthermore, the integration of this agent demonstrates the system's ability to leverage external expertise and capabilities to improve its performance. The OntologyClassificationAgent class is a key component in the system's architecture, and its implementation has a significant impact on the overall behavior of the LiveLoggingSystem.
- [LLMAbstraction](./LLMAbstraction.md) -- The LLMAbstraction component's architecture is designed with a high-level facade, specifically the LLMService class (lib/llm/llm-service.ts), which serves as the central entry point for all LLM operations. This design allows for provider-agnostic model calls, enabling the component to interact with different providers, such as Anthropic and Docker Model Runner (DMR), through specific provider classes. For instance, the DMRProvider class (lib/llm/providers/dmr-provider.ts) utilizes Docker Desktop's Model Runner for local LLM inference, supporting per-agent model overrides and health checks. The use of a facade pattern in the LLMService class enables the component to manage the interaction between different providers and the application logic, promoting a loose coupling between the component's dependencies.
- [DockerizedServices](./DockerizedServices.md) -- The DockerizedServices component utilizes a microservices architecture, with multiple sub-components and services working together to enable efficient coding services. This is evident in the use of Docker for containerization, as seen in the lib/llm/llm-service.ts file, which acts as a high-level facade for all LLM operations. The LLMService class handles mode routing, caching, circuit breaking, budget/sensitivity checks, and provider fallback, demonstrating a clear separation of concerns and a modular design approach. Furthermore, the ServiceStarter class in lib/service-starter.js implements a retry-with-backoff pattern to prevent endless loops and provide graceful degradation when optional services fail, showcasing a robust and fault-tolerant design.
- [Trajectory](./Trajectory.md) -- The Trajectory component's modular design pattern is evident in its use of classes and objects, such as the SpecstoryAdapter class in lib/integrations/specstory-adapter.js, which enables encapsulation and reuse of code. This modularity is further enhanced by the component's asynchronous programming model, which allows for efficient and concurrent execution of tasks. For instance, the initialize method in the Trajectory class utilizes asynchronous programming to initialize the component without blocking other tasks. The use of promises in this method, as seen in the return statement, ensures that the component's initialization is non-blocking and efficient.
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component utilizes a GraphDatabaseAdapter for persistence, which is implemented in the file integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts. This adapter provides a layer of abstraction between the component and the underlying graph database, allowing for flexible data storage and retrieval. The GraphDatabaseAdapter class uses Graphology and LevelDB to store and manage the knowledge graph, and it also provides an automatic JSON export sync feature. This ensures that the knowledge graph is always up-to-date and can be easily exported for further analysis or processing. For example, the CodeGraphAgent class, located in integrations/mcp-server-semantic-analysis/src/agents/code-graph-agent.ts, uses the GraphDatabaseAdapter to store and retrieve code graph data.
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem component's utilization of the observer pattern for event handling is a key architectural aspect that enables efficient management of complex constraint relationships. This is evident in the use of hook configurations and the unified hook manager, as seen in the lib/agent-api/hooks/hook-manager.js file. The hook manager acts as a central orchestrator for hook events, allowing for customizable event handling and enabling the component to respond to various scenarios that may arise during code sessions. For instance, the ContentValidationAgent in integrations/mcp-server-semantic-analysis/src/agents/content-validation-agent.ts employs the hook manager to handle content validation events, demonstrating the component's ability to adapt to different scenarios. Furthermore, the use of design patterns such as the observer pattern facilitates the component's modular design, allowing for separate modules to handle different aspects of constraint monitoring and enforcement.
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component utilizes a modular approach to agent development, with each agent having its own configuration and initialization logic. For instance, the OntologyClassificationAgent has its own configuration file (integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts) that defines its behavior and dependencies. This modular approach allows for easier maintenance and extension of the agents, as each agent can be developed and tested independently. The execute method in the base-agent.ts file (integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts) serves as the entry point for each agent's execution, providing a standardized interface for agent interactions.


---

*Generated from 5 observations*
