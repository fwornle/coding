# Coding

**Type:** Project

Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 8 major components: LiveLoggingSystem: [LLM] The LiveLoggingSystem component utilizes a modular design, with separate modules for session windowing, file routing, and classification layers.; LLMAbstraction: [LLM] The LLMAbstraction component implements a modular design with dependency injection, allowing for easy addition or removal of language models wit; DockerizedServices: [LLM] The DockerizedServices component employs a modular architecture, with separate services for semantic analysis, constraint monitoring, and code g; Trajectory: [LLM] The Trajectory component's modular architecture, as seen in the organization of its adapters and services in separate modules (e.g., lib/integra; KnowledgeManagement: [LLM] The KnowledgeManagement component utilizes a modular architecture, with separate modules for graph database adaptation, persistence, and semanti; CodingPatterns: [LLM] The CodingPatterns component utilizes the GraphDatabaseAdapter (storage/graph-database-adapter.ts) for storing and retrieving data in a graph da; ConstraintSystem: [LLM] The ConstraintSystem component utilizes a modular architecture, with each module responsible for a specific aspect of constraint management. For; SemanticAnalysis: [LLM] The SemanticAnalysis component utilizes a modular architecture, with each agent responsible for a specific task. For instance, the OntologyClass.

## What It Is  

The **Coding** project is a multi‑component system whose top‑level knowledge hierarchy is anchored in a single root node that aggregates eight first‑level (L1) modules: **LiveLoggingSystem**, **LLMAbstraction**, **DockerizedServices**, **Trajectory**, **KnowledgeManagement**, **CodingPatterns**, **ConstraintSystem**, and **SemanticAnalysis**.  

Each module lives in its own source tree and is exposed through clearly‑named entry points. For example, the **LLMAbstraction** service is implemented in `lib/llm/llm-service.ts`, while the **LiveLoggingSystem** logic is split across `session_windowing.py`, `file_routing.py`, and `classification_layers.py`. Docker‑based services are declared in files such as `integrations/code-graph-rag/docker-compose.yaml`, and the semantic‑analysis back‑end resides under `integrations/mcp-server-semantic-analysis/src/…`. The overall system therefore constitutes a **modular, container‑ready code‑base** that supports live logging, large‑language‑model (LLM) orchestration, graph‑based knowledge storage, and constraint‑driven code analysis.

---

## Architecture and Design  

### Modular Architecture  

All eight L1 components follow a **modular architecture**: each functional concern is isolated in its own directory and exposed through a thin public API. The observations repeatedly cite “separate modules for …” (e.g., session windowing, file routing, classification layers in **LiveLoggingSystem**, or adapters and services in **Trajectory**). This reflects a **module‑per‑concern** pattern that reduces coupling and makes the codebase navigable.

### Dependency Injection & Provider Registry  

The **LLMAbstraction** component demonstrates explicit **dependency injection**. `LLMService` (in `lib/llm/llm-service.ts`) receives its concrete LLM implementation from a `ProviderRegistry`. The registry holds entries for mock, local, and public providers, enabling the system to swap models without touching the service logic. This is a classic **Service Locator / Provider** pattern that supports extensibility and testability.

### Adapter / Agent Pattern  

Both **KnowledgeManagement** and **SemanticAnalysis** rely on **adapters** and **agents**. The `GraphDatabaseAdapter` (`integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts`) abstracts persistence to a graph database, while `PersistenceAgent` and `CodeGraphAgent` (`src/agents/*.ts`) encapsulate higher‑level operations such as ontology classification and code‑graph construction. This matches the **Adapter** pattern (wrapping external storage) and an **Agent** (or worker) pattern for background processing.

### Containerization & Service Isolation  

**DockerizedServices** uses Docker Compose to spin up isolated services: `mcp-server-semantic-analysis`, `constraint-monitor`, and `code-graph-rag`. Each service has its own Docker image and environment variables (e.g., `CODING_REPO`, `CONSTRAINT_DIR` used in `api-service.js` and `dashboard-service.js`). This reflects a **micro‑service‑style deployment** (even if the source code lives in a monorepo) that provides clear separation of concerns at runtime.

### Shared Logging Infrastructure  

The **Trajectory** component imports a logger via `createLogger` from `../logging/Logger.js`. By reusing a common logging module across components, the project enforces a **cross‑cutting concern** implementation that aids observability and debugging throughout the system.

---

## Implementation Details  

### LiveLoggingSystem  

- **File layout** – `session_windowing.py` defines `window_session`, which slices incoming log streams into time‑bounded windows.  
- `file_routing.py` provides `route_file`, responsible for directing log files to appropriate downstream processors based on file type or source.  
- `classification_layers.py` houses a `Classifier` class that applies rule‑based or ML‑based classification to each log entry. The three modules together enable a pipeline that ingests raw logs, partitions them, and tags them for downstream analytics.

### LLMAbstraction  

- **Core class** – `LLMService` (in `lib/llm/llm-service.ts`) implements a façade over multiple language‑model providers. It handles **mode routing** (e.g., chat vs. completion), **caching**, and **circuit breaking** to protect downstream services from provider failures.  
- **ProviderRegistry** – a singleton that registers concrete providers (mock, local, public). Adding a new LLM only requires implementing the provider interface and adding it to the registry, thanks to the DI design.

### DockerizedServices  

- The Docker Compose file `integrations/code-graph-rag/docker-compose.yaml` declares three primary services:  
  1. `mcp-server-semantic-analysis` – runs the semantic analysis agents.  
  2. `constraint-monitor` – watches constraint files and triggers re‑evaluation.  
  3. `code-graph-rag` – builds and serves the code‑graph for Retrieval‑Augmented Generation.  
- Environment variables (`CODING_REPO`, `CONSTRAINT_DIR`) are read by JavaScript entry points (`api-service.js`, `dashboard-service.js`) to locate source code and constraint definitions at runtime.

### Trajectory  

- The **SpecstoryAdapter** (`lib/integrations/specstory-adapter.js`) encapsulates three connection strategies—HTTP, IPC, and file‑watch—allowing the component to integrate with the Specstory extension regardless of the host environment.  
- Logging is standardized through `createLogger` from `../logging/Logger.js`, ensuring that every adapter action is traceable.

### KnowledgeManagement & SemanticAnalysis  

- **Persistence Layer** – `GraphDatabaseAdapter` (`src/storage/graph-database-adapter.ts`) abstracts CRUD operations against a graph database (likely Neo4j or similar).  
- **Agents** – `PersistenceAgent` (`src/agents/persistence-agent.ts`) orchestrates entity storage and ontology classification; `CodeGraphAgent` (`src/agents/code-graph-agent.ts`) builds a knowledge graph from source code and exposes semantic search APIs.  
- **Utility** – `ukb-trace-report.ts` (`src/utils/ukb-trace-report.ts`) generates detailed trace reports for UKB workflow runs, aiding debugging and auditability.

### ConstraintSystem & CodingPatterns  

Although specific files are not listed, the observations state that each module follows the same modular principle, with each sub‑module handling a distinct aspect of constraint management or pattern storage. The **CodingPatterns** component re‑uses the `GraphDatabaseAdapter` for pattern persistence, reinforcing a shared data‑access strategy across siblings.

---

## Integration Points  

1. **LLMAbstraction ↔ LiveLoggingSystem** – The `LLMService` can be called from the **LiveLoggingSystem** classification layer to enrich log entries with LLM‑generated insights. The dependency is mediated through the public `LLMService` API.  
2. **DockerizedServices ↔ KnowledgeManagement** – The `mcp-server-semantic-analysis` container runs the agents (`PersistenceAgent`, `CodeGraphAgent`) that depend on the `GraphDatabaseAdapter`. The container mounts the same graph‑DB credentials as the host code, ensuring a consistent persistence contract.  
3. **Trajectory ↔ Logging** – `SpecstoryAdapter` imports the shared logger, allowing its events to be correlated with logs produced by **LiveLoggingSystem** and **ConstraintSystem**.  
4. **ConstraintSystem ↔ SemanticAnalysis** – Constraints are evaluated by agents in **SemanticAnalysis**; any violation is reported back to the **ConstraintSystem** through a defined interface (e.g., a REST endpoint exposed by the constraint‑monitor service).  
5. **CodingPatterns ↔ KnowledgeManagement** – Both components use the same `GraphDatabaseAdapter`, meaning pattern definitions are stored alongside other knowledge graph entities, enabling cross‑entity queries (e.g., “find all code snippets that match pattern X”).  

All components share the same environment variables (`CODING_REPO`, `CONSTRAINT_DIR`) and the common logger, which act as **global integration contracts** across the project.

---

## Usage Guidelines  

- **Add a new LLM**: Implement the provider interface, register it in `ProviderRegistry`, and update any configuration files that map model names to providers. Because `LLMService` performs mode routing and circuit breaking, no changes are required elsewhere.  
- **Extend logging**: When adding a new log source, create a dedicated function in `session_windowing.py` or `file_routing.py` that respects the existing windowing and routing conventions. Use the `Classifier` class to keep classification logic centralized.  
- **Deploy a new service**: Add a service definition to `integrations/code-graph-rag/docker-compose.yaml`, expose required environment variables, and ensure the service’s Dockerfile follows the same base image and health‑check patterns used by existing services.  
- **Persist new graph entities**: Use `GraphDatabaseAdapter` rather than raw driver calls. Follow the pattern shown in `PersistenceAgent` for transaction handling and error reporting.  
- **Write adapters**: Follow the example of `SpecstoryAdapter`—encapsulate external communication (HTTP, IPC, file) behind a single class and inject the shared logger. This keeps external dependencies isolated and testable.  

Consistently adhere to the modular boundaries; avoid importing across sibling modules unless a shared abstraction (e.g., the graph adapter or logger) already exists. This preserves the clean separation that the architecture relies on.

---

### Summary of Architectural Insights  

1. **Architectural patterns identified**  
   - Modular / component‑based architecture  
   - Dependency injection with a Provider Registry (service‑locator style)  
   - Adapter pattern for storage and external integrations  
   - Agent/worker pattern for background processing  
   - Container‑based service isolation via Docker Compose  

2. **Design decisions and trade‑offs**  
   - **Modularity** improves maintainability and allows independent evolution of components, at the cost of additional indirection (e.g., adapters, registries).  
   - **Dependency injection** enables easy swapping of LLM providers but introduces a runtime registry that must be kept in sync with configuration.  
   - **Dockerization** provides deployment isolation and horizontal scalability, though it adds operational overhead (image builds, networking).  

3. **System structure insights**  
   - A clear hierarchy: **Coding** (root) → eight L1 modules → sub‑modules (adapters, agents, utilities).  
   - Shared cross‑cutting concerns (logging, environment configuration, graph‑DB adapter) are centralized, reducing duplication.  

4. **Scalability considerations**  
   - Each Docker service can be scaled independently (e.g., multiple instances of `mcp-server-semantic-analysis` for higher query throughput).  
   - The provider‑registry design allows adding more powerful LLM back‑ends without touching consumer code, supporting future load growth.  
   - Graph‑DB persistence is abstracted; scaling the underlying database (clustering, sharding) does not affect calling code.  

5. **Maintainability assessment**  
   - Strong module boundaries and explicit adapters make the codebase approachable for new developers.  
   - Centralized registries and shared utilities reduce duplication but require disciplined versioning.  
   - Documentation should emphasize the contract of each adapter/agent to prevent accidental coupling between siblings.  

By staying faithful to the observed file structures and design cues, the **Coding** project presents a well‑organized, extensible platform ready for further feature growth and production‑grade scaling.


## Hierarchy Context

### Children
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- [LLM] The LiveLoggingSystem component utilizes a modular design, with separate modules for session windowing, file routing, and classification layers. This is evident in the 'session_windowing.py' and 'file_routing.py' files, which contain functions such as 'window_session' and 'route_file' that handle these specific tasks. The 'classification_layers.py' file contains classes such as 'Classifier' that handle the classification of logs.
- [LLMAbstraction](./LLMAbstraction.md) -- [LLM] The LLMAbstraction component implements a modular design with dependency injection, allowing for easy addition or removal of language models without affecting the overall system. This is evident in the LLMService class (lib/llm/llm-service.ts), which acts as the single public entry point for all LLM operations and handles mode routing, caching, and circuit breaking. The use of a ProviderRegistry to manage different providers, including mock, local, and public providers, further reinforces this modular design.
- [DockerizedServices](./DockerizedServices.md) -- [LLM] The DockerizedServices component employs a modular architecture, with separate services for semantic analysis, constraint monitoring, and code graph analysis. This is evident in the separate Docker Compose files, such as integrations/code-graph-rag/docker-compose.yaml, which defines the services and their dependencies. For instance, the mcp-server-semantic-analysis service is defined with its own Docker image and environment variables, demonstrating a clear separation of concerns. The use of environment variables, such as CODING_REPO and CONSTRAINT_DIR, in scripts like api-service.js and dashboard-service.js, further supports this modular design.
- [Trajectory](./Trajectory.md) -- [LLM] The Trajectory component's modular architecture, as seen in the organization of its adapters and services in separate modules (e.g., lib/integrations/specstory-adapter.js), enables easy maintenance, updates, and integration with other components. This is evident in the use of the SpecstoryAdapter class, which encapsulates the logic for connecting to the Specstory extension via HTTP, IPC, or file watch. The createLogger function from ../logging/Logger.js is also utilized to create a logger instance, allowing for standardized logging across the component.
- [KnowledgeManagement](./KnowledgeManagement.md) -- [LLM] The KnowledgeManagement component utilizes a modular architecture, with separate modules for graph database adaptation, persistence, and semantic analysis. This is evident in the way the GraphDatabaseAdapter (integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts) is used for persistence, and the PersistenceAgent (integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts) is used for managing entity persistence and ontology classification. The CodeGraphAgent (integrations/mcp-server-semantic-analysis/src/agents/code-graph-agent.ts) is also used for constructing code knowledge graphs and providing semantic code search capabilities. The ukb-trace-report (integrations/mcp-server-semantic-analysis/src/utils/ukb-trace-report.ts) is used for generating detailed trace reports of UKB workflow runs. This modular design allows for flexibility and maintainability of the component.
- [CodingPatterns](./CodingPatterns.md) -- [LLM] The CodingPatterns component utilizes the GraphDatabaseAdapter (storage/graph-database-adapter.ts) for storing and retrieving data in a graph database. This adapter provides a standardized interface for interacting with the database, ensuring consistency and modularity in the component's architecture. For instance, the GraphDatabaseAdapter's 'createNode' method is used to persist new entities in the database, while the 'getNode' method retrieves existing nodes based on their IDs. This modular approach enables easy switching between different database implementations if needed, as seen in lib/llm/provider-registry.js, where various providers are managed and registered.
- [ConstraintSystem](./ConstraintSystem.md) -- [LLM] The ConstraintSystem component utilizes a modular architecture, with each module responsible for a specific aspect of constraint management. For instance, the ContentValidationAgent (integrations/mcp-server-semantic-analysis/src/agents/content-validation-agent.ts) is used for entity content validation against configured rules. This modular design allows for easy maintenance and scalability of the system. The HookConfigLoader (lib/agent-api/hooks/hook-config.js) is another example of this modularity, as it is responsible for loading and merging hook configurations from multiple sources. This separation of concerns enables developers to focus on specific aspects of the system without affecting other parts.
- [SemanticAnalysis](./SemanticAnalysis.md) -- [LLM] The SemanticAnalysis component utilizes a modular architecture, with each agent responsible for a specific task. For instance, the OntologyClassificationAgent (integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts) is used for classifying observations against the ontology system. This is evident in the classifyObservations method of the OntologyClassificationAgent class, which takes in a list of observations and returns a list of classified observations. The use of separate modules for different agents and utilities, such as the storage and logging modules, also contributes to the overall modularity of the component. This modular design allows for easier maintenance and updates, as changes to one agent do not affect the others.


---

*Generated from 2 observations*
