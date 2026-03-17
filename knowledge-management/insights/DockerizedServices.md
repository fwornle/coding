# DockerizedServices

**Type:** Component

[LLM] The DockerizedServices component employs a modular architecture, with each service running in its own container. This is evident in the docker-compose.yaml file, where separate services such as the constraint monitoring API server and the dashboard server are defined. The use of Docker Compose for container orchestration allows for efficient resource utilization and easy maintenance. For instance, the constraint monitoring API server is defined in the scripts/api-service.js file, which utilizes environment variables and configuration files for customizable settings.

## What It Is  

The **DockerizedServices** component lives inside the *DockerizedServices* directory of the overall **Coding** code‑base.  Its concrete implementation is expressed through a collection of source files that define the individual services and the runtime glue that starts them.  The primary orchestration definition is the `docker‑compose.yaml` file, which declares separate containers for the *constraint‑monitoring API server* (implemented in `scripts/api‑service.js`) and the *dashboard server*, among others.  Each service reads its configuration from environment variables or dedicated configuration files – for example, `CODING_REPO` and `CONSTRAINT_API_PORT` are injected at container start‑up.  Supporting libraries such as `lib/llm/llm-service.ts`, `storage/graph-database-adapter.ts`, and `lib/service-starter.js` provide reusable building blocks that the individual services consume.

---

## Architecture and Design  

DockerizedServices follows a **modular, container‑per‑service** architecture.  By describing each micro‑unit in `docker‑compose.yaml`, the component leverages Docker Compose as a lightweight orchestrator that isolates runtime concerns (networking, ports, volume mounts) while keeping the overall system simple to spin up for development or testing.  This modularity mirrors the broader **Coding** hierarchy, where sibling components such as **LiveLoggingSystem** and **LLMAbstraction** also expose self‑contained services that are wired together through environment‑driven configuration.

Several classic design patterns are evident in the code base:  

* **Singleton** – `lib/llm/llm-service.ts` implements the LLMService as a singleton, guaranteeing a single, thread‑safe instance that holds model caches, routing tables, and circuit‑breaker state.  This avoids redundant model loading across the many containers that may need LLM capabilities (e.g., the semantic‑analysis API server).  

* **Factory** – `lib/service-starter.js` acts as a factory for service instances.  It encapsulates the creation logic, applying retry policies, timeout guards, and health‑check hooks before exposing a ready‑to‑run service object.  

* **Mock** – The testing‑only `integrations/mcp‑server‑semantic‑analysis/src/mock/llm‑mock‑service.ts` follows the Mock pattern, providing a stand‑in LLM implementation that returns deterministic responses.  This enables the rest of DockerizedServices to be exercised without external model dependencies.  

* **Adapter** – `storage/graph-database-adapter.ts` implements an adapter that translates the component’s domain objects into the persistence format required by the underlying graph database (LevelDB/Graphology).  The adapter also synchronises JSON exports, decoupling storage concerns from business logic.  

Interaction between services is primarily **message‑oriented over HTTP** (ports exposed by Docker Compose) and **shared configuration via environment variables**.  For example, the *ConstraintMonitoringService* (a child of DockerizedServices) reads its constraint definitions from `integrations/mcp‑constraint‑monitor/docs/constraint‑configuration.md` and exposes an API that the dashboard consumes.  The *CodeGraphRAGService* (another child) uses `CODE_GRAPH_RAG_SSE_PORT` and `CODE_GRAPH_RAG_PORT` environment variables to publish retrieval‑augmented generation streams that downstream agents in **SemanticAnalysis** can subscribe to.

---

## Implementation Details  

### Service Startup – `lib/service-starter.js`  
The ServiceStarter class encapsulates three responsibilities:  
1. **Retry Logic** – On launch it attempts to start the target service binary (e.g., `node scripts/api-service.js`) up to a configurable number of times, backing off exponentially.  
2. **Timeout Protection** – If the service does not emit a “ready” health‑check signal within the `STARTUP_TIMEOUT_MS` window, the starter aborts and propagates an error.  
3. **Health Verification** – After a successful start, the starter polls the service’s health endpoint (`/healthz`) until a 200 response is received, confirming the container is ready to accept traffic.  

The factory pattern is evident because the starter returns a concrete service object that implements a common `start()` / `stop()` interface, allowing the orchestrator to treat all services uniformly.

### LLM Service – `lib/llm/llm-service.ts`  
Implemented as a TypeScript singleton, LLMService holds:  
* **Mode Routing** – a map from request type (e.g., “semantic‑analysis”, “code‑graph‑RAG”) to a concrete provider (Anthropic, DMR, etc.).  
* **Caching Layer** – an in‑memory LRU cache keyed by prompt hash, reducing duplicate calls to expensive LLM endpoints.  
* **Circuit Breaker** – per‑provider state that trips after a configurable error threshold, temporarily routing requests to fallback providers or the mock service.  

All consumers (e.g., the semantic‑analysis API server) import the singleton via `import LLMService from '../../lib/llm/llm-service'`, ensuring a single point of control for model interactions across containers.

### Graph Persistence – `storage/graph-database-adapter.ts`  
The adapter reads connection details (`GRAPH_DB_CONN_STRING`) from the environment and opens a LevelDB instance wrapped by Graphology.  It exposes CRUD methods (`addNode`, `addEdge`, `querySubgraph`) that return plain JavaScript objects.  A background worker watches for changes and writes a JSON snapshot to the directory defined by `JSON_EXPORT_DIR`.  This design decouples the rest of DockerizedServices from the specifics of LevelDB locking, as noted in the sibling **KnowledgeManagement** component’s description of a “lock‑free architecture”.

### Constraint Monitoring API – `scripts/api-service.js`  
This Node.js entry point reads configuration (`CONSTRAINT_API_PORT`, `CODING_REPO`) from `process.env`, instantiates the ServiceStarter, and registers HTTP routes that expose constraint status, health checks, and metrics.  The service is launched as a Docker container defined in `docker‑compose.yaml` under the name `constraint-monitor`.

### Mock LLM – `integrations/mcp‑server‑semantic‑analysis/src/mock/llm‑mock‑service.ts`  
The mock implements the same interface as the real LLMService but returns canned JSON payloads.  Test suites import this module directly, allowing CI pipelines to run deterministic integration tests without network calls to external LLM providers.

---

## Integration Points  

DockerizedServices sits at the intersection of several other **Coding** components:  

* **LiveLoggingSystem** – consumes logs emitted by DockerizedServices containers via a shared logging driver; the logs are later processed by the LiveLoggingSystem’s OntologyClassificationAgent.  
* **LLMAbstraction** – supplies the provider registry (`lib/llm/provider-registry.js`) that LLMService consults for routing; any new provider added to LLMAbstraction automatically becomes available to DockerizedServices without code changes.  
* **KnowledgeManagement** – re‑uses the same `storage/graph-database-adapter.ts` to persist graph data generated by the *CodeGraphRAGService*; both components therefore share the JSON export directory, enabling downstream analytics.  
* **SemanticAnalysis** – calls the semantic‑analysis API server (hosted in DockerizedServices) to obtain enriched code‑level semantics, which are then fed into agents such as `CodeGraphAgent`.  

Child components expose their own ports and configuration keys:  

* **ServiceOrchestrator** – orchestrates the lifecycle of all DockerizedServices containers, reading the `docker‑compose.yaml` and applying the ServiceStarter logic to each defined service.  
* **ConstraintMonitoringService** – reads its rule set from `integrations/mcp‑constraint‑monitor/docs/constraint‑configuration.md` and publishes constraint violations over HTTP.  
* **CodeGraphRAGService** – uses `CODE_GRAPH_RAG_SSE_PORT` for Server‑Sent Events streams, allowing real‑time retrieval‑augmented generation results to be consumed by agents in **SemanticAnalysis**.  

All services rely on a common pattern of **environment‑driven configuration**, making the component portable across local development, staging, and production clusters.

---

## Usage Guidelines  

1. **Container Management** – Always start DockerizedServices via `docker‑compose up -d` from the repository root.  This ensures that ServiceOrchestrator, ServiceStarter, and health‑check hooks are applied uniformly.  For single‑service debugging, you may run the individual entry point (e.g., `node scripts/api-service.js`) after setting the required environment variables (`CONSTRAINT_API_PORT`, `CODING_REPO`, etc.).  

2. **Configuration Discipline** – Keep all mutable settings in `.env` files or CI secret stores.  Do not hard‑code ports or connection strings inside source files; the observations stress that both `CODING_REPO` and `CONSTRAINT_API_PORT` are intended to be overridden at runtime.  

3. **LLM Provider Updates** – When adding a new LLM provider, register it in `lib/llm/provider-registry.js`.  Because LLMService is a singleton, the new provider becomes instantly visible to all services without redeploying the entire stack.  

4. **Testing with Mocks** – Use the `llm‑mock‑service.ts` implementation in integration tests.  Replace the real LLMService import with the mock via dependency injection or module aliasing; this avoids external API calls and guarantees repeatable test outcomes.  

5. **Graph Persistence** – Do not modify the LevelDB files directly.  All interactions should go through `GraphDatabaseAdapter` to ensure the automatic JSON export remains in sync.  If you need to change the export directory, adjust the `JSON_EXPORT_DIR` environment variable and restart the affected services.  

6. **Health Monitoring** – Rely on the `/healthz` endpoint exposed by each service for liveness probes in orchestration platforms (Kubernetes, Docker Swarm).  The ServiceStarter already validates this endpoint during startup; external monitors should follow the same contract.

---

### Architectural patterns identified  

* Modular container‑per‑service architecture (Docker Compose)  
* Singleton (LLMService)  
* Factory (ServiceStarter)  
* Mock (LLM Mock Service)  
* Adapter (GraphDatabaseAdapter)  

### Design decisions and trade‑offs  

* **Singleton LLMService** – centralises model state and caching, reducing memory footprint, but introduces a single point of contention if many requests arrive concurrently; mitigated by internal thread‑safety.  
* **Docker Compose orchestration** – simple to use and great for local development, yet may not scale to large production clusters where a full orchestrator (K8s) would be required.  
* **Environment‑driven configuration** – maximises portability, but requires disciplined secret management to avoid leaking credentials.  
* **Retry/Timeout logic in ServiceStarter** – improves resilience during container start‑up, at the cost of longer start‑up times when services are genuinely failing.  

### System structure insights  

DockerizedServices is a leaf node under the **Coding** root, sharing common libraries (LLMAbstraction, KnowledgeManagement) with its siblings.  Its children—**ServiceOrchestrator**, **ConstraintMonitoringService**, and **CodeGraphRAGService**—are each defined as separate containers in `docker‑compose.yaml`, each exposing a focused API surface.  The component’s internal libraries (`lib/`, `storage/`) are reused by sibling components, reinforcing a cohesive ecosystem.

### Scalability considerations  

* Adding more services is straightforward: define a new entry in `docker‑compose.yaml` and implement a starter script that uses ServiceStarter.  
* Horizontal scaling of a service (e.g., running multiple instances of the semantic‑analysis API) would require an external load balancer; the current Docker Compose setup does not provide built‑in service discovery beyond Docker’s internal DNS.  
* The singleton LLMService could become a bottleneck under heavy load; scaling out would involve extracting the LLMService into its own microservice with a stateless API, allowing multiple instances behind a router.  

### Maintainability assessment  

The component’s reliance on well‑known patterns (Singleton, Factory, Adapter) and clear separation of concerns (each service in its own container) makes the codebase approachable for new contributors.  Configuration is externalised, reducing the need for code changes across environments.  However, the tight coupling of many services to the same singleton LLMService and shared GraphDatabaseAdapter may require careful coordination when updating those core libraries.  The presence of a dedicated mock implementation and health‑check contracts aids automated testing and continuous integration, further supporting long‑term maintainability.

## Diagrams

### Relationship

![DockerizedServices Relationship](images/dockerized-services-relationship.png)



## Architecture Diagrams

![relationship](../../.data/knowledge-graph/insights/images/dockerized-services-relationship.png)


## Hierarchy Context

### Parent
- [Coding](./Coding.md) -- Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 8 major components: LiveLoggingSystem: [LLM] The LiveLoggingSystem component utilizes the OntologyClassificationAgent, which is defined in the integrations/mcp-server-semantic-analysis/src/; LLMAbstraction: [LLM] The LLMAbstraction component is designed with a provider-agnostic approach, allowing for seamless integration of multiple Large Language Model (; DockerizedServices: [LLM] The DockerizedServices component employs a modular architecture, with each service running in its own container. This is evident in the docker-c; Trajectory: [LLM] The Trajectory component's use of asynchronous programming is evident in the SpecstoryAdapter class, specifically in the connectViaHTTP function; KnowledgeManagement: [LLM] The KnowledgeManagement component utilizes a GraphDatabaseAdapter for storing and managing knowledge graphs. This adapter, implemented in storag; CodingPatterns: [LLM] The CodingPatterns component utilizes a lazy initialization approach for LLM services, which is evident in the ensureLLMInitialized() method wit; ConstraintSystem: [LLM] The ConstraintSystem component's modular architecture allows for a clear separation of concerns, with each sub-component interacting through wel; SemanticAnalysis: [LLM] The SemanticAnalysis component utilizes a modular architecture with multiple agents, each responsible for a specific task, such as the OntologyC.

### Children
- [ServiceOrchestrator](./ServiceOrchestrator.md) -- The ServiceOrchestrator likely utilizes the docker-compose.yaml file to define and manage the services, as seen in the use of environment variables and configuration files for customizable settings.
- [ConstraintMonitoringService](./ConstraintMonitoringService.md) -- The ConstraintMonitoringService uses the integrations/mcp-constraint-monitor/docs/constraint-configuration.md file to configure the constraints and their dependencies.
- [CodeGraphRAGService](./CodeGraphRAGService.md) -- The CodeGraphRAGService uses the CODE_GRAPH_RAG_SSE_PORT and CODE_GRAPH_RAG_PORT environment variables to configure the ports for the Code Graph RAG service.

### Siblings
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- [LLM] The LiveLoggingSystem component utilizes the OntologyClassificationAgent, which is defined in the integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts file, for classifying observations against the ontology system. This agent is crucial in providing a standardized way of categorizing and understanding the interactions within the Claude Code conversations. The OntologyClassificationAgent follows a specific constructor and initialization pattern to ensure proper setup of the ontology system and classification capabilities. For instance, the agent initializes the ontology system by loading the necessary configuration files and setting up the classification models. This is evident in the code, where the constructor of the OntologyClassificationAgent class calls the initOntologySystem method, which in turn loads the configuration files and sets up the classification models.
- [LLMAbstraction](./LLMAbstraction.md) -- [LLM] The LLMAbstraction component is designed with a provider-agnostic approach, allowing for seamless integration of multiple Large Language Model (LLM) providers. This is evident in the lib/llm/provider-registry.js file, where a registry of providers is maintained, enabling easy addition or removal of providers. For instance, the AnthropicProvider class (lib/llm/providers/anthropic-provider.ts) and the DMRProvider class (lib/llm/providers/dmr-provider.ts) are both registered in this registry, demonstrating the flexibility of the component's architecture. The LLMService class (lib/llm/llm-service.ts) serves as the main entry point for all LLM operations, routing requests to the appropriate provider based on the registry. This design decision enables the component to adapt to changing requirements and new provider additions without significant modifications to the existing codebase.
- [Trajectory](./Trajectory.md) -- [LLM] The Trajectory component's use of asynchronous programming is evident in the SpecstoryAdapter class, specifically in the connectViaHTTP function in lib/integrations/specstory-adapter.js, which establishes a connection to the Specstory service via HTTP. This asynchronous approach allows the component to handle multiple tasks concurrently, improving overall performance and responsiveness. The connectViaHTTP function is a prime example of this, as it uses callbacks to handle the connection establishment process. Furthermore, the SpecstoryAdapter class's implementation of the initialize function, which attempts connections to the Specstory service using different methods, demonstrates the component's ability to adapt to various connection scenarios.
- [KnowledgeManagement](./KnowledgeManagement.md) -- [LLM] The KnowledgeManagement component utilizes a GraphDatabaseAdapter for storing and managing knowledge graphs. This adapter, implemented in storage/graph-database-adapter.ts, enables Graphology+LevelDB persistence with automatic JSON export sync. By using this adapter, the component can efficiently store and query knowledge graphs, which are essential for entity persistence and knowledge decay tracking. Furthermore, the GraphDatabaseAdapter employs a lock-free architecture to prevent LevelDB lock conflicts, ensuring that the component can handle multiple concurrent requests without performance degradation.
- [CodingPatterns](./CodingPatterns.md) -- [LLM] The CodingPatterns component utilizes a lazy initialization approach for LLM services, which is evident in the ensureLLMInitialized() method within the base-agent.ts file. This method ensures that the LLM service is only initialized when it is actually needed, thus optimizing resource usage and improving performance. Furthermore, the use of lazy initialization allows for more flexibility in the component's design, as it enables the creation of agents that can be used with or without LLM services. The ensureLLMInitialized() method is typically called within the constructor of the agent classes, such as the CodeGraphAgent class in integrations/mcp-server-semantic-analysis/src/agent/code-graph-agent.ts, to guarantee that the LLM service is properly initialized before the agent's execution.
- [ConstraintSystem](./ConstraintSystem.md) -- [LLM] The ConstraintSystem component's modular architecture allows for a clear separation of concerns, with each sub-component interacting through well-defined interfaces. For instance, the ContentValidationAgent (integrations/mcp-server-semantic-analysis/src/agents/content-validation-agent.ts) interacts with the GraphDatabaseAdapter for graph database persistence and semantic analysis. This modular design enables easier maintenance and updates to individual components without affecting the overall system. Furthermore, the HookConfigLoader (lib/agent-api/hooks/hook-config.js) loads and merges hook configurations from user-level and project-level sources, applying project config overrides. This design decision allows for flexible configuration management and customization of hook behaviors.
- [SemanticAnalysis](./SemanticAnalysis.md) -- [LLM] The SemanticAnalysis component utilizes a modular architecture with multiple agents, each responsible for a specific task, such as the OntologyClassificationAgent, SemanticAnalysisAgent, and ContentValidationAgent. For instance, the OntologyClassificationAgent, defined in integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts, is used for classifying observations against the ontology system. This agent follows the BaseAgent pattern, providing a standardized structure for agent development, as seen in integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts. The use of this pattern enables easier modification and extension of the agent's functionality, as demonstrated in the implementation of the SemanticAnalysisAgent in integrations/mcp-server-semantic-analysis/src/agents/semantic-analysis-agent.ts.


---

*Generated from 6 observations*
