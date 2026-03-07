# DockerizedServices

**Type:** Component

The component also employs various technologies, such as Node.js, TypeScript, and GraphQL, to build its services and APIs. The use of process managers, like the ProcessStateManager, enables the regist...

**DockerizedServices – Technical Insight Document**  

---

## What It Is  

DockerizedServices is the part of the **Coding** root component that supplies a container‑based, micro‑service‑oriented runtime for the project’s back‑end capabilities.  The implementation lives primarily under the repository’s source tree in a handful of concrete files that have been explicitly referenced:

* **`lib/llm/llm-service.ts`** – the high‑level façade that coordinates all Large‑Language‑Model (LLM) interactions.  
* **`lib/service-starter.js`** – the “service starter” module that launches each service with retry‑with‑backoff logic.  
* **`scripts/process-state-manager.js`** – the **ProcessStateManager** that registers and unregisters services, guaranteeing clean shutdown.  
* **`integrations/code-graph-rag/docker-compose.yaml`** – the Docker‑Compose definition that wires the individual containers together.  
* **`integrations/mcp-server-semantic-analysis/src/graphql/schema.ts`** – the GraphQL schema that describes the public API surface.  

Together these assets form a **Docker‑containerised micro‑services framework** that is used by sibling components such as **LiveLoggingSystem**, **LLMAbstraction**, **Trajectory**, **KnowledgeManagement**, **CodingPatterns**, **ConstraintSystem**, and **SemanticAnalysis**.  DockerizedServices itself contains four child sub‑components – **LLMServiceManager**, **ServiceStarter**, **ProcessStateManager**, and **GraphQLAPI** – each of which implements a distinct concern of the overall platform.

---

## Architecture and Design  

The observations reveal a **layered micro‑services architecture** built on top of Docker containerisation.  Each logical service (e.g., semantic analysis, constraint monitoring, code‑graph analysis) runs in its own container as described in **`integrations/code-graph-rag/docker-compose.yaml`**, enabling independent scaling and isolated resource allocation.  

### Core Design Patterns  

| Pattern (observed) | Where it appears | What it solves |
|--------------------|------------------|----------------|
| **Facade** | `lib/llm/llm-service.ts` (LLMService) | Provides a single entry point for all LLM operations, hiding routing, caching, and circuit‑breaker details from callers. |
| **Dependency Injection** | LLMService class (uses injected providers, cache, circuit‑breaker) | Increases testability and flexibility; callers can swap real providers for mocks. |
| **Retry‑With‑Backoff** | `lib/service-starter.js` (ServiceStarter) | Guarantees reliable start‑up of services, avoiding tight loops when a container is temporarily unavailable. |
| **Circuit Breaker** | LLMService (caching + circuit‑breaker module) | Protects the system from cascading failures when an LLM provider becomes unresponsive. |
| **Process Registry / Manager** | `scripts/process-state-manager.js` (ProcessStateManager) | Centralised registration/unregistration of running services, ensuring graceful cleanup and preventing orphaned processes. |
| **GraphQL Schema Management** | `integrations/mcp-server-semantic-analysis/src/graphql/schema.ts` (SchemaManager) | Dynamically defines and updates the public API contract for the services. |
| **Micro‑service orchestration** | Docker‑Compose file | Declares service dependencies, network topology, and shared volumes, enabling reproducible local and CI environments. |

The **ServiceStarter** works hand‑in‑hand with **ProcessStateManager**: the starter attempts to spin a container, applying the retry‑with‑backoff strategy; once the container reports readiness, the starter registers the instance with ProcessStateManager.  Conversely, when a container stops or crashes, ProcessStateManager deregisters it, allowing other components (e.g., LLMServiceManager) to discover the change and route traffic accordingly.

The **LLMServiceManager** (child of DockerizedServices) adds a routing layer (`LLMRouter`) that directs incoming LLM requests to the appropriate provider based on mode (mock, local, public).  This routing logic is built on top of the **LLMService** façade, which itself performs caching and circuit‑breaker checks.  The overall flow mirrors the pattern used in the sibling **LLMAbstraction** component, but DockerizedServices focuses on the container‑level lifecycle rather than the pure provider abstraction.

---

## Implementation Details  

### 1. LLM Service Facade (`lib/llm/llm-service.ts`)  
The file defines a **class `LLMService`** that receives its dependencies (provider registry, cache, circuit‑breaker) through its constructor – a classic dependency‑injection approach.  Public methods such as `invokeModel(request)` first consult the cache; on a miss they invoke the selected provider via the **LLMRouter** (implemented in the child **LLMServiceManager**) and wrap the call in a circuit‑breaker guard.  Mode routing (mock vs. real) is performed by inspecting a configuration flag that is also used by the sibling **LLMAbstraction** component, ensuring consistent behaviour across the codebase.

### 2. Service Starter (`lib/service-starter.js`)  
`ServiceStarter` exports a function `startService(name, options)` that launches a Docker container using the Docker CLI or Dockerode library.  The module embeds a **`RetryStrategy`** class that implements exponential back‑off (initial delay → doubled on each retry, capped at a maximum).  The retry loop terminates either on successful health‑check (e.g., a `/healthz` endpoint) or after a configurable max‑retry count, after which the module logs a graceful degradation event.  This pattern is also referenced in the **Trajectory** component’s connection‑retry logic, indicating a shared utility philosophy across the project.

### 3. Process State Management (`scripts/process-state-manager.js`)  
The **`ProcessStateManager`** maintains an in‑memory **`ProcessRegistry`** map where keys are service identifiers and values are process handles (PID, Docker container ID, health status).  Public APIs `register(serviceId, handle)` and `unregister(serviceId)` are invoked by ServiceStarter after a successful start and by Docker event listeners on container stop.  By centralising this state, other modules (e.g., LLMServiceManager) can query the registry to discover which LLM provider containers are currently healthy, enabling dynamic routing without hard‑coded hostnames.

### 4. GraphQL API (`integrations/mcp-server-semantic-analysis/src/graphql/schema.ts`)  
A **`SchemaManager`** class parses TypeScript definitions and constructs a GraphQL schema object.  The schema exposes queries and mutations that internally call into the micro‑service layer (e.g., `semanticAnalysis`, `codeGraphQuery`).  Because the schema is generated at start‑up, any new service added to Docker Compose can automatically contribute new resolvers, provided a corresponding resolver file is placed in the `src/graphql/resolvers` directory.  This mirrors the approach used by the **SemanticAnalysis** sibling component, which also publishes a GraphQL interface.

### 5. Docker Compose Orchestration (`integrations/code-graph-rag/docker-compose.yaml`)  
The compose file defines services such as `semantic-analysis`, `constraint-monitor`, and `code-graph`.  Each service declares `depends_on` relationships, health‑check commands, and shared networks.  Environment variables (e.g., `LLM_MODE`) are propagated to the containers, allowing the LLM routing logic to align with the mode selected by **LLMService**.  The compose file is the single source of truth for container versions, making it easy for CI pipelines to spin up a reproducible environment.

---

## Integration Points  

* **Parent – Coding**: DockerizedServices supplies the runtime platform for all other Coding siblings.  For example, **LiveLoggingSystem** writes logs to a volume that is mounted into the Docker containers defined by DockerizedServices, while **KnowledgeManagement** accesses the same GraphQL endpoint exposed by the **GraphQLAPI** child.  
* **Sibling – LLMAbstraction**: Both components expose an LLM façade, but DockerizedServices adds container lifecycle control (start/stop, health‑check) while LLMAbstraction focuses on provider‑level abstraction.  The two can be combined by configuring LLMAbstraction to point at the LLM containers managed by DockerizedServices.  
* **Sibling – Trajectory**: Trajectory’s retry‑with‑backoff connection strategy is conceptually identical to the **ServiceStarter** retry logic, suggesting a shared utility library could be extracted in the future.  
* **Child – LLMServiceManager**: The manager’s `LLMRouter` consults the **ProcessStateManager** registry to locate the active LLM container before forwarding a request.  This creates a dynamic discovery loop: when a container restarts, the registry updates, and the router automatically reroutes without code changes.  
* **Child – ServiceStarter**: Invoked by higher‑level orchestration scripts (e.g., CI pipelines) to bring up each micro‑service.  It also emits events that the **ProcessStateManager** listens to for registration.  
* **Child – ProcessStateManager**: Exposes a simple JSON‑over‑HTTP endpoint (`/processes`) that other services (including the **GraphQLAPI**) can query to obtain current process health, enabling UI dashboards in the **LiveLoggingSystem** to display live service status.  
* **Child – GraphQLAPI**: Serves as the external contract for all DockerizedServices.  Consumers such as the **SemanticAnalysis** component issue GraphQL queries that are resolved by resolvers calling into the underlying containers via HTTP or gRPC.

---

## Usage Guidelines  

1. **Start the Platform via Docker Compose** – Run `docker compose -f integrations/code-graph-rag/docker-compose.yaml up -d`.  This ensures that every micro‑service defined in the compose file is launched with the health‑check hooks expected by **ServiceStarter**.  

2. **Service Lifecycle Management** – Do not manually invoke Docker commands on the individual containers.  Always use the **ServiceStarter** API (`startService`) so that the retry‑with‑backoff and registration steps execute correctly.  When a service must be stopped, call `processStateManager.unregister(serviceId)` before issuing a container stop to guarantee graceful cleanup.  

3. **LLM Mode Configuration** – The LLM routing mode is controlled through the environment variable `LLM_MODE` (values: `mock`, `local`, `public`).  This variable must be set consistently in both the Docker Compose file and the **LLMService** configuration object; otherwise the façade may attempt to contact a provider that is not running, triggering circuit‑breaker trips.  

4. **Testing with Mocks** – Because **LLMService** is built with dependency injection, unit tests should provide mock provider instances, a stub cache, and a disabled circuit‑breaker.  The child **LLMServiceManager** can be instantiated with a mocked `ProcessRegistry` to simulate container availability without launching Docker containers.  

5. **Extending the GraphQL API** – New queries or mutations should be added by creating a resolver file under `src/graphql/resolvers` and updating the **SchemaManager** if new types are introduced.  The resolver can call any micro‑service by looking up its address via `processStateManager.get(serviceId)`, ensuring the call always targets the current healthy instance.  

6. **Monitoring and Observability** – Leverage the `/processes` endpoint exposed by **ProcessStateManager** and the health‑check URLs defined in Docker Compose.  Integrate these with the **LiveLoggingSystem** to capture start‑up failures, retry attempts, and circuit‑breaker events for post‑mortem analysis.  

---

## Summary of Architectural Findings  

1. **Architectural patterns identified** – Facade, Dependency Injection, Retry‑With‑Backoff, Circuit Breaker, Process Registry/Manager, GraphQL Schema Management, Docker‑Compose based micro‑service orchestration.  

2. **Design decisions & trade‑offs** –  
   * *Container isolation* gives strong fault boundaries and independent scaling, at the cost of added operational complexity (Docker Compose, health‑checks).  
   * *Retry‑with‑backoff* improves robustness during transient failures but introduces start‑up latency in worst‑case scenarios.  
   * *Circuit‑breaker* protects downstream services but requires careful tuning of thresholds to avoid premature trips.  
   * *Dependency injection* boosts testability but adds boilerplate for wiring providers.  

3. **System structure insights** – DockerizedServices sits under the **Coding** root, providing the execution platform for sibling components.  Its child modules each own a single responsibility: LLM routing, service start‑up, process bookkeeping, and API exposition.  The clear separation enables independent evolution (e.g., swapping the GraphQL engine) without rippling changes across the codebase.  

4. **Scalability considerations** – Because each logical service runs in its own container, horizontal scaling is a matter of adjusting the `replicas` field in Docker Compose (or moving to Docker Swarm/Kubernetes).  The **ProcessStateManager** registry is currently in‑memory; scaling beyond a single host would require externalising this registry (e.g., Redis) to keep discovery consistent across nodes.  

5. **Maintainability assessment** – The use of well‑known patterns (facade, DI, retry) and explicit registration logic makes the codebase approachable for new developers.  However, the tight coupling between **ServiceStarter**, **ProcessStateManager**, and Docker‑Compose definitions means that any change to container naming or health‑check semantics must be reflected in multiple places.  Introducing a shared configuration module could reduce duplication and further improve maintainability.  

---  

*Prepared from the concrete observations supplied, without extrapolation beyond the documented files and entities.*


## Hierarchy Context

### Parent
- [Coding](./Coding.md) -- Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 8 major components: LiveLoggingSystem: The LiveLoggingSystem component is a comprehensive logging infrastructure designed to capture and process conversations from various agents, such as C; LLMAbstraction: The LLMAbstraction component is a high-level facade that provides an abstraction layer over various LLM providers, including Anthropic, OpenAI, and Gr; DockerizedServices: The component also employs various technologies, such as Node.js, TypeScript, and GraphQL, to build its services and APIs. The use of process managers; Trajectory: The Trajectory component is a complex system that manages project milestones, GSD workflow, phase planning, and implementation task tracking. Its arch; KnowledgeManagement: Key patterns in this component include the use of intelligent routing for database interactions, with the ability to switch between API and direct acc; CodingPatterns: Key patterns in this component include the use of graph database adapters, work-stealing concurrency, and lazy initialization of large language models; ConstraintSystem: The system's key patterns include the use of GraphDatabaseAdapter for graph database persistence, the implementation of work-stealing concurrency, and; SemanticAnalysis: The SemanticAnalysis component is a multi-agent system that processes git history and LSL sessions to extract and persist structured knowledge entitie.

### Children
- [LLMServiceManager](./LLMServiceManager.md) -- LLMServiceManager uses a routing mechanism in its LLMRouter class to direct incoming requests to the appropriate LLM service
- [ServiceStarter](./ServiceStarter.md) -- ServiceStarter uses a RetryStrategy class to implement a retry-with-backoff pattern, preventing endless loops and ensuring reliable service startup
- [ProcessStateManager](./ProcessStateManager.md) -- ProcessStateManager uses a ProcessRegistry module to store and retrieve process instances, enabling dynamic process discovery and registration
- [GraphQLAPI](./GraphQLAPI.md) -- GraphQLAPI uses a SchemaManager class to manage GraphQL schema definitions, enabling dynamic schema updates and registration

### Siblings
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- The LiveLoggingSystem component is a comprehensive logging infrastructure designed to capture and process conversations from various agents, such as Claude Code. It handles session windowing, file routing, classification layers, and transcript capture. The system's architecture involves multiple modules and classes, including the OntologyClassificationAgent, which classifies observations against an ontology system, and the TranscriptAdapter, which provides a unified abstraction for reading and converting transcripts from different agent formats. The system also utilizes a logging mechanism, as seen in the logging.ts file, which asynchronously writes log entries to a file.
- [LLMAbstraction](./LLMAbstraction.md) -- The LLMAbstraction component is a high-level facade that provides an abstraction layer over various LLM providers, including Anthropic, OpenAI, and Groq. It enables provider-agnostic model calls, tier-based routing, and mock mode for testing. The component is designed to handle different LLM modes, including mock, local, and public, and it uses a registry to manage the available providers. The LLMAbstraction component is implemented in the lib/llm/llm-service.ts file and uses various other modules, such as the provider registry, circuit breaker, and cache, to manage the LLM operations.
- [Trajectory](./Trajectory.md) -- The Trajectory component is a complex system that manages project milestones, GSD workflow, phase planning, and implementation task tracking. Its architecture involves utilizing various connection methods to integrate with the Specstory extension, including HTTP, IPC, and file watch. The component is implemented in the lib/integrations/specstory-adapter.js file and uses a logger to handle logging and errors. The SpecstoryAdapter class is the main entry point for this component, providing methods to initialize the connection, log conversations, and connect via different methods. The component's design allows for flexibility and fault tolerance, with multiple connection attempts and fallbacks in case of failures. The use of a session ID and extension API enables the component to track and manage conversations and logs effectively.
- [KnowledgeManagement](./KnowledgeManagement.md) -- Key patterns in this component include the use of intelligent routing for database interactions, with the ability to switch between API and direct access modes. Additionally, the component utilizes a classification cache to avoid redundant LLM calls and implements data loss tracking to monitor data flow through the system.
- [CodingPatterns](./CodingPatterns.md) -- Key patterns in this component include the use of graph database adapters, work-stealing concurrency, and lazy initialization of large language models. The project also employs a custom OntologyLoader class to load the ontology and a custom EntityAuthoringService class to handle manual entity creation and editing. These patterns and principles contribute to the overall quality and maintainability of the codebase.
- [ConstraintSystem](./ConstraintSystem.md) -- The system's key patterns include the use of GraphDatabaseAdapter for graph database persistence, the implementation of work-stealing concurrency, and the utilization of a unified hook manager for central orchestration of hook events. The system also employs various logging mechanisms, such as the use of a logger wrapper for content validation and the implementation of error handling mechanisms.
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component is a multi-agent system that processes git history and LSL sessions to extract and persist structured knowledge entities. It utilizes various agents, including the OntologyClassificationAgent, SemanticAnalysisAgent, and CodeGraphAgent, to perform tasks such as ontology classification, semantic analysis, and code graph construction. The component's architecture is designed to facilitate the integration of multiple agents and enable the efficient processing of large amounts of data.


---

*Generated from 8 observations*
