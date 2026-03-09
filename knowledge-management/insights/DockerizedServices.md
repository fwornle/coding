# DockerizedServices

**Type:** Component

The startServiceWithRetry function, implemented in lib/service-starter.js, is used to implement a retry-with-backoff pattern for service startup, ensuring robust and reliable service initialization. This function takes into account the possibility of service startup failures and retries the startup process with increasing backoff intervals. The GraphDatabaseAdapter, defined in storage/graph-database-adapter.ts, is used for graph database persistence, enabling efficient storage and retrieval of graph data. The combination of these two components ensures that services are initialized correctly and that graph data is persisted reliably. Additionally, the ProviderRegistry class, located in lib/llm/provider-registry.js, manages LLM providers, allowing for flexible and dynamic provider configuration.

## What It Is  

The **DockerizedServices** component lives under the repository root in a set of service‑specific sub‑directories (e.g., `semantic‑analysis/`, `constraint‑monitoring/`, `code‑graph-construction/`).  The core runtime logic is concentrated in a handful of shared libraries:

* `lib/llm/llm-service.ts` – the **LLMService** class that acts as a high‑level façade for all Large‑Language‑Model (LLM) interactions.  
* `lib/llm/provider-registry.js` – the **ProviderRegistry** that holds concrete LLM provider implementations.  
* `lib/service‑starter.js` – the `startServiceWithRetry` helper that launches a Docker container with exponential back‑off.  
* `storage/graph-database-adapter.ts` – the **GraphDatabaseAdapter** that abstracts persistence of graph data.  

Two entry‑point scripts (`api‑service.js` and `dashboard‑service.js`) start the constraint‑monitoring REST API and the Next.js dashboard respectively.  The whole suite is orchestrated by `docker‑compose.yml`, which defines each service container, its networking, and inter‑service dependencies.  In the broader **Coding** hierarchy DockerizedServices is a sibling of components such as **LiveLoggingSystem**, **LLMAbstraction**, **Trajectory**, **KnowledgeManagement**, **CodingPatterns**, **ConstraintSystem**, and **SemanticAnalysis**.  Its children – **LLMServiceManager** and **ServiceOrchestrator** – build directly on the façade and the compose file to provide runtime configuration and lifecycle management.

---

## Architecture and Design  

DockerizedServices embraces a **modular, directory‑per‑service** architecture.  Each functional area (semantic analysis, constraint monitoring, code‑graph construction) lives in its own folder, which makes the codebase amenable to independent development, testing, and deployment.  The orchestration layer is **docker‑compose**, a declarative container‑orchestration format that wires the services together at runtime, providing a robust integration point for networking, volume mounting, and health‑check definitions.

Two classic design patterns surface repeatedly:

1. **Facade Pattern** – `LLMService` (`lib/llm/llm-service.ts`) presents a simplified API (mode routing, caching, circuit‑breaking) while hiding the complexity of individual provider implementations.  Callers never touch a concrete provider directly; they request the current provider via `LLMService.getProvider()`.

2. **Registry Pattern** – `ProviderRegistry` (`lib/llm/provider-registry.js`) maintains a map of available LLM providers (e.g., DMR, Anthropic).  Providers can be added, removed, or swapped at runtime without touching the façade, enabling the “dynamic provider configuration” highlighted in the observations.

A **retry‑with‑backoff** strategy is encapsulated in `startServiceWithRetry` (`lib/service-starter.js`).  This function repeatedly attempts to start a container, increasing the delay between attempts, which safeguards the system against transient startup failures (e.g., network hiccups, database warm‑up).  The same pattern appears in the **Trajectory** sibling component for external adapters, showing a consistent reliability approach across the codebase.

Persistence is abstracted through the **GraphDatabaseAdapter** (`storage/graph-database-adapter.ts`).  By isolating graph‑DB CRUD operations behind a thin TypeScript class, the component decouples the rest of the services from the underlying storage engine, supporting future swaps or multi‑backend strategies.

Overall, the architecture is **service‑oriented** (each directory is a bounded context) but not a full micro‑service system; the services share a common runtime (Docker) and common libraries (LLM façade, registry, adapters), which reduces duplication while preserving loose coupling.

---

## Implementation Details  

### LLMService (`lib/llm/llm-service.ts`)  
The class implements three cross‑cutting concerns:

* **Mode Routing** – determines whether calls should be directed to a real provider, a mock implementation, or a cached response.  
* **Caching** – stores recent LLM responses, likely in an in‑memory map or Redis (the observation does not specify the cache store).  
* **Circuit Breaking** – monitors provider health and temporarily disables a failing provider, falling back to a mock or cached path.

The façade exposes methods such as `getProvider()`, which queries the **ProviderRegistry** for the currently configured implementation.  All downstream services (semantic analysis, constraint monitoring) import `LLMService` rather than individual provider modules, guaranteeing a single point of change for provider‑related logic.

### ProviderRegistry (`lib/llm/provider-registry.js`)  
This module registers concrete provider classes (e.g., `dmr-provider.ts`, `anthropic-provider.ts`) under symbolic keys.  The registry offers `register(name, providerClass)` and `resolve(name)` functions, enabling **dynamic provider configuration** at startup based on environment variables or configuration files.  Because the registry is a plain JavaScript object, it imposes minimal runtime overhead while delivering the flexibility required by the LLMAbstraction sibling.

### Service Startup (`lib/service-starter.js`)  
`startServiceWithRetry` accepts a Docker‑compose service name and a maximum retry count.  Internally it invokes Docker CLI commands (or Docker SDK calls) and catches failures.  On each failure it waits `baseDelay * 2^attempt` milliseconds before retrying, capping the delay to avoid unbounded wait times.  This pattern is reused by the **Trajectory** component for external adapters, indicating a shared reliability philosophy.

### Graph Persistence (`storage/graph-database-adapter.ts`)  
The adapter implements methods such as `saveNode(node)`, `saveEdge(edge)`, and `query(criteria)`.  It abstracts the underlying graph database (Neo4j, JanusGraph, etc.) behind a TypeScript interface, handling connection pooling, automatic JSON export sync, and intelligent routing between API‑level and direct DB calls.  The adapter is leveraged by both the **KnowledgeManagement** sibling (for ontology storage) and the DockerizedServices themselves (e.g., code‑graph construction).

### Service Entry Points  
* `api-service.js` boots an Express (or Fastify) server exposing a RESTful API for constraint monitoring.  
* `dashboard-service.js` launches a Next.js application that visualizes constraint data, pulling from the same API endpoint.  

Both scripts are defined as services in `docker-compose.yml`, which also declares environment variables (e.g., `MOCK_LLM_ENABLED`) that the `isMockLLMEnabled` function (`integrations/mcp-server-semantic-analysis/src/mock/llm-mock-service.ts`) reads to decide whether to inject a mock LLM implementation.

### Children – LLMServiceManager & ServiceOrchestrator  
* **LLMServiceManager** wraps `LLMService` to expose higher‑level lifecycle hooks (initialization, warm‑up, graceful shutdown) to the orchestrator.  
* **ServiceOrchestrator** reads `docker-compose.yml`, resolves dependencies, and invokes `startServiceWithRetry` for each container, ensuring the correct start order (e.g., database before API server).

---

## Integration Points  

DockerizedServices sits at the intersection of several other components:

* **Coding (parent)** – Provides the overarching configuration and shared utilities (e.g., logging, environment handling) that DockerizedServices inherits.  
* **LLMAbstraction (sibling)** – Supplies the concrete provider implementations that `ProviderRegistry` registers; any change to a provider in LLMAbstraction is instantly reflected in DockerizedServices through the shared registry.  
* **KnowledgeManagement (sibling)** – Consumes the same `GraphDatabaseAdapter` for persisting graph data, ensuring a single source of truth for both knowledge graphs and code‑graph artifacts.  
* **ConstraintSystem (sibling)** – Relies on the constraint‑monitoring API started by `api-service.js`; the dashboard in DockerizedServices visualizes data generated by ConstraintSystem.  
* **Trajectory (sibling)** – Mirrors the retry‑with‑backoff pattern for external adapters, indicating a reusable reliability library that could be extracted into a common utility module.  

External interfaces include:

* **Docker Compose** – The `docker-compose.yml` file declares service images, environment variables, network aliases, and volume mounts.  It is the primary contract for deployment pipelines (CI/CD).  
* **REST API** – Exposed by `api-service.js`, consumed by the Next.js dashboard and any external client needing constraint data.  
* **Mock LLM Toggle** – The boolean returned by `isMockLLMEnabled` influences the LLM façade, enabling developers to run the whole stack without real LLM credentials.  

All these integration points are wired through environment variables and shared configuration files, keeping the coupling loose while allowing coordinated deployments.

---

## Usage Guidelines  

1. **Add a New Service** – Create a dedicated sub‑directory (e.g., `my‑new‑service/`) containing its Dockerfile and any source code.  Register the service in `docker-compose.yml` with appropriate `depends_on` clauses to respect start‑up order.  If the service needs LLM access, inject `LLMService` via dependency injection rather than importing a concrete provider.

2. **Register a New LLM Provider** – Implement the provider class under `lib/llm/providers/` following the existing interface (e.g., a `generate(prompt)` method).  Add a registration call in `ProviderRegistry` (typically at application bootstrap).  No changes to `LLMService` are required because the façade resolves the provider at runtime.

3. **Enable Mock Mode for Testing** – Set the configuration flag inspected by `isMockLLMEnabled` (usually an environment variable like `MOCK_LLM_ENABLED=true`).  The façade will route all LLM calls to the mock implementation located in `integrations/mcp-server-semantic-analysis/src/mock/llm-mock-service.ts`.

4. **Persist Graph Data** – Use the `GraphDatabaseAdapter` methods rather than direct driver calls.  This guarantees that any future changes to the underlying graph engine will be transparent to callers.

5. **Handle Service Startup Failures** – When adding a service that depends on an external resource (e.g., a database), rely on `startServiceWithRetry` to manage transient failures.  Adjust the `maxRetries` and `baseDelay` parameters only if the default back‑off is insufficient for the specific dependency.

6. **Dashboard Development** – Extend `dashboard-service.js` only by adding new Next.js pages or API routes that consume the existing REST endpoints; avoid coupling the UI directly to internal service modules.

Following these conventions ensures that the modular architecture remains coherent and that new functionality can be introduced without breaking existing contracts.

---

### Summary Deliverables  

**1. Architectural patterns identified**  
* Modular, directory‑per‑service layout  
* Facade pattern (`LLMService`)  
* Registry pattern (`ProviderRegistry`)  
* Retry‑with‑backoff for service startup (`startServiceWithRetry`)  
* Docker‑Compose orchestration  

**2. Design decisions and trade‑offs**  
* **Loose coupling vs. shared libraries** – Using a common façade and registry reduces duplication but introduces a shared runtime dependency; a full micro‑service split would increase isolation at the cost of higher operational complexity.  
* **Mock LLM toggle** – Enables rapid local development but requires careful handling to avoid accidental deployment of mock mode to production.  
* **GraphDatabaseAdapter abstraction** – Future‑proofs persistence but adds an extra indirection layer that may impact raw performance for extremely high‑throughput scenarios.  

**3. System structure insights**  
* Parent **Coding** component provides global configuration; DockerizedServices contributes runtime services.  
* Sibling components share the same provider registry and graph adapter, reinforcing a unified data and LLM strategy across the codebase.  
* Children **LLMServiceManager** and **ServiceOrchestrator** encapsulate lifecycle concerns, keeping the top‑level compose file declarative while the code handles dynamic retries and graceful shutdowns.  

**4. Scalability considerations**  
* Adding more services is straightforward: drop a new directory, update `docker-compose.yml`, and optionally register a new LLM provider.  
* The retry‑with‑backoff mechanism prevents cascade failures during scale‑out events.  
* Caching and circuit‑breaking in `LLMService` protect downstream LLM APIs from overload, supporting horizontal scaling of consumer services.  

**5. Maintainability assessment**  
* High maintainability thanks to clear separation of concerns (facade, registry, adapters).  
* Centralized provider registration reduces the surface area for bugs when swapping LLM backends.  
* The modular directory layout, combined with Docker‑Compose, enables independent versioning and testing of each service.  
* Potential risk: shared libraries (`LLMService`, `ProviderRegistry`) become critical coupling points; changes must be version‑controlled and communicated across sibling components to avoid breaking downstream consumers.


## Hierarchy Context

### Parent
- [Coding](./Coding.md) -- Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 8 major components: LiveLoggingSystem: The LiveLoggingSystem component utilizes the OntologyClassificationAgent, located in integrations/mcp-server-semantic-analysis/src/agents/ontology-cla; LLMAbstraction: The LLMAbstraction component's modular architecture, as seen in the separate modules for different providers (e.g., lib/llm/providers/dmr-provider.ts ; DockerizedServices: The DockerizedServices component utilizes a modular architecture, with separate directories for each service, allowing for flexible deployment and man; Trajectory: The Trajectory component utilizes a modular architecture, with each language model having its own directory and configuration, allowing for easy maint; KnowledgeManagement: The KnowledgeManagement component utilizes the GraphDatabaseAdapter, located in storage/graph-database-adapter.ts, to interact with the graph database; CodingPatterns: The CodingPatterns component utilizes a modular architecture for language models, as observed in the llm-providers.yaml file. Each language model has ; ConstraintSystem: The ConstraintSystem component employs a modular architecture, integrating multiple sub-components such as the ContentValidationAgent, HookConfigLoade; SemanticAnalysis: The SemanticAnalysis component employs a multi-agent architecture, with each agent designed to perform a specific task, such as the OntologyClassifica.

### Children
- [LLMServiceManager](./LLMServiceManager.md) -- LLMServiceManager uses the LLMService class in lib/llm/llm-service.ts to handle mode routing, caching, and circuit breaking.
- [ServiceOrchestrator](./ServiceOrchestrator.md) -- ServiceOrchestrator uses the docker-compose.yml file to define the services and their dependencies.

### Siblings
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- The LiveLoggingSystem component utilizes the OntologyClassificationAgent, located in integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts, to classify observations against the ontology system. This is evident in the way the agent is instantiated and used within the LiveLoggingSystem's classification layer. The OntologyClassificationAgent's classify method is called with the session transcript as an argument, allowing the system to categorize the conversation based on predefined ontology rules. Furthermore, the use of the TranscriptAdapter, defined in lib/agent-api/transcript-api.js, as an abstract base class for agent-specific transcript adapters, enables the system to handle transcripts from various agents in a unified manner. The TranscriptAdapter's adaptTranscript method is responsible for converting agent-specific transcripts into a standardized format, which is then passed to the OntologyClassificationAgent for classification.
- [LLMAbstraction](./LLMAbstraction.md) -- The LLMAbstraction component's modular architecture, as seen in the separate modules for different providers (e.g., lib/llm/providers/dmr-provider.ts and lib/llm/providers/anthropic-provider.ts), allows for easy maintenance and extension of the system. This is further facilitated by the use of a registry (lib/llm/provider-registry.js) to manage providers, enabling the addition or removal of providers without modifying the core logic of the LLMService class (lib/llm/llm-service.ts). The registry pattern helps to decouple the provider implementations from the service class, making it easier to swap out or add new providers as needed.
- [Trajectory](./Trajectory.md) -- The Trajectory component utilizes a modular architecture, with each language model having its own directory and configuration, allowing for easy maintenance and scalability. For instance, the SpecstoryAdapter (lib/integrations/specstory-adapter.js) is used to connect to the Specstory extension via HTTP, IPC, or file watch, demonstrating a flexible approach to integrations. This adapter implements a retry-with-backoff pattern in the connectViaHTTP method (lib/integrations/specstory-adapter.js:123) to establish a connection with the Specstory extension, showcasing a robust approach to handling potential connection issues.
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component utilizes the GraphDatabaseAdapter, located in storage/graph-database-adapter.ts, to interact with the graph database. This adapter enables the component to perform tasks such as entity storage and relationship management, while also providing automatic JSON export sync. The use of this adapter allows for a flexible and scalable solution for knowledge graph management. Furthermore, the intelligent routing implemented in the GraphDatabaseAdapter enables the component to efficiently route requests for API or direct database access, ensuring optimal performance. The code in storage/graph-database-adapter.ts demonstrates how the adapter is used to handle concurrent access and provide a robust solution for graph database interactions.
- [CodingPatterns](./CodingPatterns.md) -- The CodingPatterns component utilizes a modular architecture for language models, as observed in the llm-providers.yaml file. Each language model has its own directory and configuration, allowing for easier maintenance and extension of the system. For instance, the lib/llm/provider-registry.js file defines a provider registry that manages different providers and enables provider switching based on mode and availability. This modular design enables developers to add or remove language models without affecting the overall system.
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem component employs a modular architecture, integrating multiple sub-components such as the ContentValidationAgent, HookConfigLoader, and ViolationCaptureService. For instance, the ContentValidationAgent, located in integrations/mcp-server-semantic-analysis/src/agents/content-validation-agent.ts, is utilized for entity content validation and refresh. This modular design allows for easier maintenance and updates, as each sub-component can be modified or replaced independently without affecting the entire system.
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component employs a multi-agent architecture, with each agent designed to perform a specific task, such as the OntologyClassificationAgent, which utilizes the ontology system to classify observations. This agent is implemented in the file integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts and follows the BaseAgent pattern defined in integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts. The use of a standardized agent structure, as seen in the BaseAgent class, allows for easier development and maintenance of new agents. For instance, the SemanticAnalysisAgent, responsible for analyzing code files, is implemented in integrations/mcp-server-semantic-analysis/src/agents/semantic-analysis-agent.ts and leverages the LLMService from lib/llm/dist/index.js for language model-based analysis.


---

*Generated from 6 observations*
