# DockerizedServices

**Type:** Component

[LLM] The API Service Wrapper, defined in scripts/api-service.js, provides a constraint monitoring API server management system. This service is responsible for managing the lifecycle of the API server, including startup, shutdown, and health checks. The API Service Wrapper utilizes the LLMService and ServiceStarter to manage the language models and ensure robust service startup. The code in scripts/api-service.js demonstrates a focus on robustness and reliability, with features like retry logic and health checks. The use of environment variables, such as CODING_REPO and CONSTRAINT_DIR, further supports the flexibility and scalability of the API Service Wrapper.

## What It Is  

The **DockerizedServices** component lives under the `integrations/code‑graph‑rag/` folder and is orchestrated through a collection of Docker‑Compose manifests, the most visible of which is `integrations/code-graph-rag/docker-compose.yaml`.  Each logical capability—semantic analysis, constraint monitoring, and code‑graph analysis—is packaged as an independent Docker service (e.g., `mcp-server-semantic-analysis`, `mcp-constraint-monitor`).  The runtime behaviour of those services is driven by a thin Node‑JS wrapper layer that lives in the `scripts/` directory (`api-service.js`, `dashboard-service.js`) and by shared utility libraries such as `lib/llm/llm-service.ts` and `lib/service-starter.js`.  Environment variables like `CODING_REPO` and `CONSTRAINT_DIR` are injected at container start‑up, allowing the same images to be reused across different repositories or constraint sets.  In the broader **Coding** hierarchy, DockerizedServices supplies the execution platform for its three child components—**ConstraintMonitor**, **CodeGraphAnalyzer**, and **SemanticAnalysisService**—while sharing the same modular philosophy that appears in sibling components such as **LLMAbstraction** and **KnowledgeManagement**.

## Architecture and Design  

DockerizedServices follows a **modular, service‑oriented architecture** that is expressed through Docker Compose.  Each functional domain is isolated in its own container, which makes the system amenable to independent scaling, versioning, and failure isolation.  The primary architectural pattern evident in the code base is **“service wrapper with fault‑tolerant startup”**: the `scripts/api-service.js` (the API Service Wrapper) delegates lifecycle concerns to `lib/service-starter.js`, which implements retry loops, timeout handling, and health‑check verification before declaring a service ready.  This pattern is repeated across the other wrappers (e.g., the dashboard service) and enforces a consistent contract for service availability.

A second, cross‑cutting pattern is the **LLM abstraction layer** embodied in `lib/llm/llm-service.ts`.  The LLMService provides **mode routing**, **caching**, and **circuit‑breaking**—classic resilience patterns that protect downstream LLM calls from transient failures.  The service is injected into the API Service Wrapper, demonstrating **dependency injection** without a heavyweight framework: the wrapper simply imports the singleton LLMService and calls its public methods.  This mirrors the approach taken by the sibling **LLMAbstraction** component, reinforcing a shared design language across the code base.

Communication between services is primarily **HTTP‑based** (the Docker Compose `depends_on` relationships imply network links) and **environment‑variable configuration**.  The `docker-compose.yaml` files explicitly list service dependencies, ensuring that the constraint monitor, code‑graph analyzer, and semantic analysis service start in the correct order and can resolve each other’s hostnames.  No message‑bus or event‑driven architecture is mentioned, so the design leans on synchronous request‑response interactions.

## Implementation Details  

### LLMService (`lib/llm/llm-service.ts`)  
The LLMService encapsulates all interactions with language‑model providers.  Its implementation includes:
* **Mode routing** – selecting the appropriate provider (mock, local, public) based on configuration.  
* **Caching** – storing recent model responses to reduce latency and external API usage.  
* **Circuit breaking** – monitoring failure rates and short‑circuiting calls when a provider becomes unhealthy.  
* **Retry logic and health checks** – each request is wrapped in a retry loop with exponential back‑off, while a periodic health‑check endpoint validates provider connectivity.

These features are directly consumed by the API Service Wrapper, allowing the wrapper to focus on HTTP routing and service orchestration rather than low‑level LLM concerns.

### ServiceStarter (`lib/service-starter.js`)  
ServiceStarter is a lightweight orchestrator used by every wrapper script.  Its responsibilities include:
* **Startup retry** – attempts to start a dependent container up to a configurable number of times, pausing between attempts.  
* **Timeout enforcement** – aborts the startup sequence if a service does not become healthy within a predefined window.  
* **Health verification** – polls a health‑check endpoint (exposed by each service) and only proceeds once a 200 response is received.  

The pattern is evident in `scripts/api-service.js`, where the wrapper calls `ServiceStarter.start()` before exposing its own HTTP endpoints.

### API Service Wrapper (`scripts/api-service.js`)  
This script acts as the public entry point for constraint monitoring.  It:
1. Reads environment variables (`CODING_REPO`, `CONSTRAINT_DIR`) to configure paths used by downstream services.  
2. Instantiates the LLMService and passes it to request handlers.  
3. Calls `ServiceStarter.start()` to ensure the semantic‑analysis container (`mcp-server-semantic-analysis`) is alive.  
4. Exposes REST endpoints that forward requests to the semantic‑analysis service, handling retries and translating errors into consistent HTTP responses.

The same wrapper pattern is reused for the dashboard service (`scripts/dashboard-service.js`), reinforcing a uniform interface across DockerizedServices.

### Docker Compose (`integrations/code-graph-rag/docker-compose.yaml`)  
The Compose file declares each micro‑service image, environment variable injection, network aliases, and explicit `depends_on` relationships.  For example, the `mcp-server-semantic-analysis` service is built from a Dockerfile in the same integration folder, receives `CODING_REPO` and `CONSTRAINT_DIR`, and exposes port `8080` for internal calls.  The file also defines resource limits (CPU, memory) that can be tuned for scaling.

## Integration Points  

DockerizedServices sits at the intersection of three child services—**ConstraintMonitor**, **CodeGraphAnalyzer**, and **SemanticAnalysisService**—all of which invoke the `mcp-server-semantic-analysis` container defined in the Compose file.  The API Service Wrapper provides the external HTTP façade that other components (e.g., the higher‑level **Coding** orchestrator or CI pipelines) can call to trigger constraint checks or semantic queries.  

Internally, the LLMService is a shared library also used by the sibling **LLMAbstraction** component, meaning any change to caching or circuit‑breaking logic propagates across both components.  The ServiceStarter is referenced by the **Trajectory** component’s adapters (e.g., `lib/integrations/specstory-adapter.js`) to ensure those adapters only start after their dependent services are healthy, illustrating a common fault‑tolerance contract across the project.  

Environment variables act as the primary configuration contract: `CODING_REPO` points to the source code base that the semantic analysis engine indexes, while `CONSTRAINT_DIR` supplies the directory where constraint definitions reside.  These variables are consumed by both the Docker containers (via `docker-compose.yaml`) and the Node‑JS wrappers, guaranteeing a single source of truth for configuration.

## Usage Guidelines  

1. **Start the stack with Docker Compose** – run `docker compose -f integrations/code-graph-rag/docker-compose.yaml up -d`.  Ensure that the host environment provides the required variables (`CODING_REPO`, `CONSTRAINT_DIR`) either in a `.env` file or via the shell.  
2. **Do not modify the service images directly**; instead, change the source code under `integrations/code-graph-rag/` and rebuild the image (`docker compose build`).  This keeps the immutable‑in‑production principle intact.  
3. **When adding a new consumer** (e.g., a new dashboard or CI job), route its HTTP calls through `scripts/api-service.js` so that the ServiceStarter and LLMService fault‑tolerance layers are automatically applied.  
4. **Observe health‑check endpoints** (`/health` on each container) during development; a non‑200 response indicates that ServiceStarter will continue retrying, preventing cascading failures.  
5. **Cache and circuit‑breaker settings** are configured inside `lib/llm/llm-service.ts`.  Adjust the thresholds only after profiling request latency, as overly aggressive caching may stale constraint data, while too‑lenient circuit breaking can overload external LLM providers.  

Following these conventions ensures that the modular services remain decoupled, resilient, and easy to operate both locally and in production environments.

---

### Architectural patterns identified  
1. **Modular Service‑Oriented Architecture** (Docker Compose based isolation).  
2. **Service Wrapper with Fault‑Tolerant Startup** (ServiceStarter).  
3. **LLM Abstraction Layer** (mode routing, caching, circuit breaking).  
4. **Dependency Injection via module imports** (LLMService into wrappers).  

### Design decisions and trade‑offs  
* **Isolation vs. Overhead** – Running each capability in its own container improves failure isolation and independent scaling but adds network latency and operational complexity (image management, compose orchestration).  
* **Centralised LLMService** – Consolidates LLM concerns, reducing duplication across siblings, yet creates a single point of change that must be carefully versioned.  
* **Retry & Health‑Check Logic** – Increases robustness at the cost of longer start‑up times when services are unhealthy.  
* **Environment‑Variable Configuration** – Simple and portable, but requires disciplined management of `.env` files across environments.  

### System structure insights  
DockerizedServices forms a three‑tier hierarchy: the **Docker Compose layer** defines container topology; the **Node‑JS wrapper layer** (scripts/*.js) provides HTTP entry points and lifecycle management; the **shared library layer** (`lib/llm`, `lib/service-starter`) supplies cross‑cutting concerns.  Its children (ConstraintMonitor, CodeGraphAnalyzer, SemanticAnalysisService) are thin consumers that rely on the same underlying `mcp-server-semantic-analysis` service, reinforcing a DRY approach to business logic.

### Scalability considerations  
Because each functional area runs in its own container, horizontal scaling can be achieved by increasing the replica count for a given service in the Compose file (or migrating to Docker Swarm/Kubernetes).  The LLMService’s caching layer helps mitigate the cost of scaling out LLM calls, while circuit breaking prevents a surge of requests from overwhelming external providers.  However, the current design assumes a single instance of `mcp-server-semantic-analysis`; scaling that service would require a stateless design or external shared storage for any persisted indexes.

### Maintainability assessment  
The clear separation of concerns—Docker‑level orchestration, service‑startup logic, and LLM interaction—makes the code base highly maintainable.  Reuse of `ServiceStarter` and `LLMService` across siblings reduces duplication and eases bug‑fix propagation.  The reliance on plain JavaScript/TypeScript modules rather than a heavyweight framework keeps the learning curve low.  Potential maintenance challenges include keeping Docker images in sync with library updates and managing environment‑variable drift across development, staging, and production pipelines.  Overall, the modular approach and explicit health‑check contracts provide a solid foundation for long‑term upkeep.


## Hierarchy Context

### Parent
- [Coding](./Coding.md) -- Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 8 major components: LiveLoggingSystem: [LLM] The LiveLoggingSystem component utilizes a modular design, with separate modules for session windowing, file routing, and classification layers.; LLMAbstraction: [LLM] The LLMAbstraction component implements a modular design with dependency injection, allowing for easy addition or removal of language models wit; DockerizedServices: [LLM] The DockerizedServices component employs a modular architecture, with separate services for semantic analysis, constraint monitoring, and code g; Trajectory: [LLM] The Trajectory component's modular architecture, as seen in the organization of its adapters and services in separate modules (e.g., lib/integra; KnowledgeManagement: [LLM] The KnowledgeManagement component utilizes a modular architecture, with separate modules for graph database adaptation, persistence, and semanti; CodingPatterns: [LLM] The CodingPatterns component utilizes the GraphDatabaseAdapter (storage/graph-database-adapter.ts) for storing and retrieving data in a graph da; ConstraintSystem: [LLM] The ConstraintSystem component utilizes a modular architecture, with each module responsible for a specific aspect of constraint management. For; SemanticAnalysis: [LLM] The SemanticAnalysis component utilizes a modular architecture, with each agent responsible for a specific task. For instance, the OntologyClass.

### Children
- [ConstraintMonitor](./ConstraintMonitor.md) -- ConstraintMonitor uses the mcp-server-semantic-analysis service defined in integrations/code-graph-rag/docker-compose.yaml to analyze constraints
- [CodeGraphAnalyzer](./CodeGraphAnalyzer.md) -- CodeGraphAnalyzer uses the mcp-server-semantic-analysis service defined in integrations/code-graph-rag/docker-compose.yaml to analyze code graphs
- [SemanticAnalysisService](./SemanticAnalysisService.md) -- SemanticAnalysisService uses the mcp-server-semantic-analysis service defined in integrations/code-graph-rag/docker-compose.yaml to perform semantic analysis

### Siblings
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- [LLM] The LiveLoggingSystem component utilizes a modular design, with separate modules for session windowing, file routing, and classification layers. This is evident in the 'session_windowing.py' and 'file_routing.py' files, which contain functions such as 'window_session' and 'route_file' that handle these specific tasks. The 'classification_layers.py' file contains classes such as 'Classifier' that handle the classification of logs.
- [LLMAbstraction](./LLMAbstraction.md) -- [LLM] The LLMAbstraction component implements a modular design with dependency injection, allowing for easy addition or removal of language models without affecting the overall system. This is evident in the LLMService class (lib/llm/llm-service.ts), which acts as the single public entry point for all LLM operations and handles mode routing, caching, and circuit breaking. The use of a ProviderRegistry to manage different providers, including mock, local, and public providers, further reinforces this modular design.
- [Trajectory](./Trajectory.md) -- [LLM] The Trajectory component's modular architecture, as seen in the organization of its adapters and services in separate modules (e.g., lib/integrations/specstory-adapter.js), enables easy maintenance, updates, and integration with other components. This is evident in the use of the SpecstoryAdapter class, which encapsulates the logic for connecting to the Specstory extension via HTTP, IPC, or file watch. The createLogger function from ../logging/Logger.js is also utilized to create a logger instance, allowing for standardized logging across the component.
- [KnowledgeManagement](./KnowledgeManagement.md) -- [LLM] The KnowledgeManagement component utilizes a modular architecture, with separate modules for graph database adaptation, persistence, and semantic analysis. This is evident in the way the GraphDatabaseAdapter (integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts) is used for persistence, and the PersistenceAgent (integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts) is used for managing entity persistence and ontology classification. The CodeGraphAgent (integrations/mcp-server-semantic-analysis/src/agents/code-graph-agent.ts) is also used for constructing code knowledge graphs and providing semantic code search capabilities. The ukb-trace-report (integrations/mcp-server-semantic-analysis/src/utils/ukb-trace-report.ts) is used for generating detailed trace reports of UKB workflow runs. This modular design allows for flexibility and maintainability of the component.
- [CodingPatterns](./CodingPatterns.md) -- [LLM] The CodingPatterns component utilizes the GraphDatabaseAdapter (storage/graph-database-adapter.ts) for storing and retrieving data in a graph database. This adapter provides a standardized interface for interacting with the database, ensuring consistency and modularity in the component's architecture. For instance, the GraphDatabaseAdapter's 'createNode' method is used to persist new entities in the database, while the 'getNode' method retrieves existing nodes based on their IDs. This modular approach enables easy switching between different database implementations if needed, as seen in lib/llm/provider-registry.js, where various providers are managed and registered.
- [ConstraintSystem](./ConstraintSystem.md) -- [LLM] The ConstraintSystem component utilizes a modular architecture, with each module responsible for a specific aspect of constraint management. For instance, the ContentValidationAgent (integrations/mcp-server-semantic-analysis/src/agents/content-validation-agent.ts) is used for entity content validation against configured rules. This modular design allows for easy maintenance and scalability of the system. The HookConfigLoader (lib/agent-api/hooks/hook-config.js) is another example of this modularity, as it is responsible for loading and merging hook configurations from multiple sources. This separation of concerns enables developers to focus on specific aspects of the system without affecting other parts.
- [SemanticAnalysis](./SemanticAnalysis.md) -- [LLM] The SemanticAnalysis component utilizes a modular architecture, with each agent responsible for a specific task. For instance, the OntologyClassificationAgent (integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts) is used for classifying observations against the ontology system. This is evident in the classifyObservations method of the OntologyClassificationAgent class, which takes in a list of observations and returns a list of classified observations. The use of separate modules for different agents and utilities, such as the storage and logging modules, also contributes to the overall modularity of the component. This modular design allows for easier maintenance and updates, as changes to one agent do not affect the others.


---

*Generated from 7 observations*
