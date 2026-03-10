# DockerizedServices

**Type:** Component

[LLM] The ConstraintMonitor, implemented in integrations/mcp-constraint-monitor, showcases a modular and reusable design by utilizing the mcp-server-semantic-analysis service for constraint monitoring. This design choice allows for efficient and effective constraint monitoring, as the ConstraintMonitor can leverage the capabilities of the mcp-server-semantic-analysis service without being concerned with its implementation details. The use of environment variables and Docker Compose for managing the mcp-server-semantic-analysis service also ensures a standardized and reproducible environment, promoting a robust and reliable system. The ConstraintMonitor can be easily modified or extended to support different constraint monitoring scenarios, making it a highly adaptable and maintainable component.

## What It Is  

The **DockerizedServices** component lives at the root of the *Coding* knowledge hierarchy and is materialised through a collection of concrete files that orchestrate and run the project’s back‑end services inside Docker containers. The primary artefacts are:

* **`docker-compose.yaml`** – the single source of truth for container definitions, networking, and environment‑variable injection for every service that belongs to DockerizedServices.  
* **`lib/service-starter.js`** – a small Node‑JS utility that boots individual services with a **retry‑with‑back‑off** strategy, guaranteeing resilient start‑up even when dependent containers are temporarily unavailable.  
* **`lib/llm/llm-service.ts`** – the façade for all Large‑Language‑Model (LLM) interactions; it is built with **dependency injection** so that different LLM providers (e.g., Hugging‑Face Transformers) can be swapped by changing the injection configuration.  
* **`scripts/api-service.js`** and **`scripts/dashboard-service.js`** – thin wrappers that launch the API and Dashboard services as **child processes**, registering them with the **Process State Manager (PSM)** for lifecycle control.  

Together these files give DockerizedServices a reproducible, container‑based runtime while exposing a programmable, modular API that its child services – SemanticAnalysisService, ConstraintMonitoringService, CodeGraphAnalysisService, LLMServiceManager, and ServiceStarterManager – can consume.

---

## Architecture and Design  

DockerizedServices follows a **container‑orchestrated modular architecture** anchored by Docker Compose. The compose file defines each service (e.g., `mcp-server-semantic-analysis`) and supplies **environment variables** that drive configuration at run‑time, a decision that keeps code static while allowing behaviour to be altered per deployment (Observation 6).  

Two explicit design patterns surface:

1. **Retry‑with‑Back‑off (lib/service-starter.js)** – the Service Starter wraps the `docker-compose up` flow with configurable retry limits and timeout protection. This pattern mitigates transient start‑up failures (e.g., a dependent database not yet ready) and is a classic resilience technique for distributed services.  

2. **Dependency Injection (lib/llm/llm-service.ts)** – the LLM Service is instantiated through an injection container that supplies the concrete provider implementation. This yields **loose coupling** between the LLM façade and provider libraries, making it straightforward to switch from one model to another without touching consumer code (Observation 2).  

A third, more operational pattern is the **Process State Manager (PSM)** used by the child‑process wrappers in `scripts/api-service.js` and `scripts/dashboard-service.js`. By registering each spawned process with the PSM, DockerizedServices gains a centralised view of service health, enabling graceful termination, restart, or graceful shutdown across the whole system (Observation 3).  

The component also demonstrates a **service‑oriented integration style**: both the CodeGraphAnalyzer (integrations/code-graph-rag) and the ConstraintMonitor (integrations/mcp-constraint-monitor) consume the `mcp-server-semantic-analysis` service rather than embedding semantic logic themselves (Observations 4 & 5). This isolates the heavy semantic workload into a dedicated container, promoting reuse and independent scaling.

---

## Implementation Details  

### Docker Compose (`docker-compose.yaml`)  
The compose file enumerates containers such as `mcp-server-semantic-analysis`, each receiving a set of `environment:` entries. These variables control which semantic analysis algorithm or model is used, allowing rapid experimentation without code changes (Observation 6). Network aliases defined here let sibling services (e.g., the CodeGraphAnalysisService) reach the semantic analysis container via a stable hostname.

### Service Starter (`lib/service-starter.js`)  
The starter exports a function that attempts to invoke `docker-compose up -d <service>` inside a loop. Parameters such as `maxRetries` and `initialDelayMs` are read from environment variables or defaults, and each failure triggers an exponential back‑off (`delay *= 2`). If the container does not become healthy within the configured timeout, the process aborts with a clear error, ensuring that downstream services never start against a partially‑initialized stack.

### LLM Service (`lib/llm/llm-service.ts`)  
The TypeScript class `LLMService` implements a façade with methods like `getProvider(mode)` and `invoke(request)`. The constructor receives a **provider registry** injected from a configuration module. Mode routing logic selects the appropriate provider (e.g., “transformers”, “openai”) at runtime, and a fallback chain ensures that if the primary provider fails, a secondary one can be tried. This design is explicitly called out as “modular architecture with dependency injection” (Observation 2).

### Child‑Process Wrappers (`scripts/api-service.js`, `scripts/dashboard-service.js`)  
Each script spawns its target service using Node’s `child_process.fork` (or `spawn`) and immediately registers the resulting process with the **Process State Manager**. The PSM tracks `pid`, `status`, and provides hooks for `onExit` to clean up resources or restart the service. By isolating the API and Dashboard into separate processes, DockerizedServices can run them on the same host without interference, while still benefiting from Docker’s network isolation.

### Integrations (`integrations/code-graph-rag`, `integrations/mcp-constraint-monitor`)  
Both integrations import a client library that talks to the `mcp-server-semantic-analysis` container over HTTP (or gRPC, depending on the internal protocol). They do not embed any semantic logic; instead they send code snippets or constraints and receive analysis results. This **service‑oriented** approach reduces duplication and centralises updates to the semantic engine.

---

## Integration Points  

DockerizedServices is the glue that binds several sibling components under the *Coding* parent:

* **SemanticAnalysisService** – directly consumes the `mcp-server-semantic-analysis` container defined in `docker-compose.yaml`.  
* **ConstraintMonitoringService** – also talks to the same semantic analysis container, reusing its API for constraint checks.  
* **CodeGraphAnalysisService** – leverages the CodeGraphAnalyzer integration, which in turn calls the semantic analysis service.  
* **LLMServiceManager** – uses the DI‑enabled `LLMService` to route requests to the appropriate LLM provider; the manager itself is started by the Service Starter.  
* **ServiceStarterManager** – orchestrates the start‑up sequence for all child services, applying the retry‑with‑back‑off policy.  

External dependencies include:

* **Docker Engine** – required to run the containers defined in `docker-compose.yaml`.  
* **Process State Manager** – a runtime component (likely a singleton module) that receives registration calls from the child‑process scripts.  
* **LLM provider libraries** – such as the Hugging Face Transformers package, which are injected into `LLMService`.  

All communication between these pieces is either via Docker’s internal network (container‑to‑container HTTP/gRPC) or via Node’s inter‑process messaging (PSM). The reliance on environment variables for configuration ensures that the same codebase can be deployed across development, CI, and production without modification.

---

## Usage Guidelines  

1. **Never edit service code to change runtime behaviour** – instead modify the appropriate environment variables in `docker-compose.yaml` and redeploy. This keeps the container images immutable and the configuration declarative (Observation 6).  
2. **Start the stack through the Service Starter** (`node lib/service-starter.js <service>`). The built‑in retry‑with‑back‑off will handle transient failures, so manual `docker-compose up` should be avoided in production scripts.  
3. **When adding a new LLM provider**, register it in the DI configuration module used by `lib/llm/llm-service.ts`. No changes to consumer code are required because the façade resolves providers at runtime (Observation 2).  
4. **If you need a new auxiliary service** (e.g., a new analytics worker), follow the pattern used by `scripts/api-service.js` and `scripts/dashboard-service.js`: launch it as a child process, register it with the PSM, and expose any required configuration via `docker-compose.yaml`.  
5. **For debugging container health**, inspect the logs of the specific container (`docker logs <container>`), but also monitor the PSM’s state output, which aggregates health across all child processes.  

Adhering to these conventions preserves the reproducibility and resilience that DockerizedServices was designed to provide.

---

### Architectural patterns identified  
* **Docker‑Compose‑based service orchestration** – a declarative, reproducible environment.  
* **Retry‑with‑Back‑off** – resilient start‑up logic in `lib/service-starter.js`.  
* **Dependency Injection** – loose coupling of LLM providers in `lib/llm/llm-service.ts`.  
* **Process State Manager (PSM) pattern** – centralized lifecycle management for child processes.  
* **Service‑oriented integration** – externalised semantic analysis accessed by CodeGraphAnalyzer and ConstraintMonitor.  

### Design decisions and trade‑offs  
* **Containerisation vs. direct execution** – using Docker guarantees environment parity but adds an extra layer of indirection and requires Docker Engine.  
* **Environment‑variable driven configuration** – maximises flexibility but can lead to “configuration sprawl” if not documented.  
* **Retry‑with‑Back‑off** – improves robustness at the cost of longer start‑up times under failure conditions.  
* **Dependency injection for LLMs** – enables extensibility but introduces a modest runtime overhead for provider resolution.  

### System structure insights  
DockerizedServices sits under the **Coding** parent, shares the same Docker‑Compose foundation with siblings such as *LiveLoggingSystem* and *SemanticAnalysis*, and supplies concrete runtime services to its children (SemanticAnalysisService, ConstraintMonitoringService, etc.). The component’s internal modules are deliberately thin: orchestration lives in `docker-compose.yaml` and `service-starter.js`, while domain‑specific logic is delegated to child integrations that consume the semantic analysis container.

### Scalability considerations  
Because each logical service runs in its own container, horizontal scaling is straightforward: increase the replica count of a service in `docker-compose.yaml` (or migrate to Docker Swarm/Kubernetes) without touching the code. The retry‑with‑back‑off logic ensures that newly added replicas can join the mesh safely. However, the current design assumes a single Docker host; moving to a multi‑node orchestrator would require externalising the PSM state store and possibly replacing the child‑process model with a true distributed process manager.

### Maintainability assessment  
The heavy reliance on **declarative configuration** (environment variables, Docker Compose) and **well‑defined patterns** (DI, retry, PSM) makes the codebase highly maintainable. Adding new providers, swapping semantic models, or introducing additional services can be done with minimal code changes. The main maintenance burden lies in keeping the environment variable documentation up‑to‑date and ensuring that the PSM remains the single source of truth for process health. Overall, DockerizedServices exhibits a clean separation of concerns that aligns with the broader modular philosophy of the *Coding* ecosystem.


## Hierarchy Context

### Parent
- [Coding](./Coding.md) -- Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 8 major components: LiveLoggingSystem: [LLM] The LiveLoggingSystem component's modular architecture is evident in its use of separate modules for handling different aspects of the logging p; LLMAbstraction: [LLM] The LLMAbstraction component utilizes the LLMService class (lib/llm/llm-service.ts) as a high-level facade for all LLM operations. This class in; DockerizedServices: [LLM] The DockerizedServices component's reliance on Docker Compose, as defined in docker-compose.yaml, enables a standardized and reproducible enviro; Trajectory: [LLM] The Trajectory component's modular architecture is evident in its organization around adapters and integrations, such as the SpecstoryAdapter cl; KnowledgeManagement: [LLM] The KnowledgeManagement component utilizes a modular architecture, with separate modules for graph database storage, entity persistence, and kno; CodingPatterns: [LLM] The CodingPatterns component's modular architecture is evident in its utilization of the GraphDatabaseAdapter, as seen in the storage/graph-data; ConstraintSystem: [LLM] The ConstraintSystem component utilizes a modular architecture, with each module responsible for a specific aspect of constraint validation and ; SemanticAnalysis: [LLM] The SemanticAnalysis component utilizes a modular architecture, with each agent having a specific role and interacting with others through a wor.

### Children
- [SemanticAnalysisService](./SemanticAnalysisService.md) -- The SemanticAnalysisService relies on the mcp-server-semantic-analysis service, as defined in docker-compose.yaml, to enable standardized and reproducible environment for service orchestration and management.
- [ConstraintMonitoringService](./ConstraintMonitoringService.md) -- The ConstraintMonitoringService relies on the mcp-server-semantic-analysis service, as defined in docker-compose.yaml, to enable standardized and reproducible environment for service orchestration and management.
- [CodeGraphAnalysisService](./CodeGraphAnalysisService.md) -- The CodeGraphAnalysisService utilizes the CodeGraphAnalyzer to analyze code graphs, demonstrating a modular and adaptable design.
- [LLMServiceManager](./LLMServiceManager.md) -- The LLMServiceManager manages the lifecycle of LLM services, including provider configuration, mode switching, and dependency injection.
- [ServiceStarterManager](./ServiceStarterManager.md) -- The ServiceStarterManager oversees service startup, utilizing the Service Starter and retry-with-backoff approach for robust initialization.

### Siblings
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- [LLM] The LiveLoggingSystem component's modular architecture is evident in its use of separate modules for handling different aspects of the logging process. For instance, the OntologyClassificationAgent class in integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts is used for classifying observations and entities against the ontology system. This modularity allows for easier maintenance and updates to the system, as individual modules can be modified without affecting the entire system.
- [LLMAbstraction](./LLMAbstraction.md) -- [LLM] The LLMAbstraction component utilizes the LLMService class (lib/llm/llm-service.ts) as a high-level facade for all LLM operations. This class incorporates mode routing, caching, and provider fallback, allowing for efficient and flexible management of LLM providers. The LLMService class is responsible for routing requests to the appropriate provider based on the mode and configuration. For example, in the lib/llm/llm-service.ts file, the getProvider method is used to determine the provider based on the mode and configuration. The use of this facade pattern allows for loose coupling between the LLM providers and the rest of the system, making it easier to add or remove providers as needed.
- [Trajectory](./Trajectory.md) -- [LLM] The Trajectory component's modular architecture is evident in its organization around adapters and integrations, such as the SpecstoryAdapter class in lib/integrations/specstory-adapter.js. This class provides a connection to the Specstory extension via HTTP, IPC, or file watch, and is a key part of the component's functionality. The use of separate modules for different functionalities, such as logging and data persistence, allows for a clear separation of concerns and makes the codebase easier to understand and maintain. For example, the createLogger function from ../logging/Logger.js is used in SpecstoryAdapter to implement logging functionality.
- [KnowledgeManagement](./KnowledgeManagement.md) -- [LLM] The KnowledgeManagement component utilizes a modular architecture, with separate modules for graph database storage, entity persistence, and knowledge decay tracking, as seen in the storage/graph-database-adapter.ts file which implements the GraphDatabaseAdapter. This modular approach allows for easier maintenance and updates of individual components without affecting the entire system. For instance, the CodeGraphAgent in integrations/mcp-server-semantic-analysis/src/agents/code-graph-agent.ts can be modified or extended without impacting the PersistenceAgent in integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts.
- [CodingPatterns](./CodingPatterns.md) -- [LLM] The CodingPatterns component's modular architecture is evident in its utilization of the GraphDatabaseAdapter, as seen in the storage/graph-database-adapter.ts file. This adapter enables the component to leverage Graphology+LevelDB persistence, with automatic JSON export sync. The PersistenceAgent, implemented from integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts, plays a crucial role in handling persistence tasks. For instance, the PersistenceAgent's handlePersistenceTask function, defined in the persistence-agent.ts file, is responsible for orchestrating the persistence workflow. This modular design allows for seamless integration of various coding patterns and practices, ensuring consistency and quality in the project's codebase.
- [ConstraintSystem](./ConstraintSystem.md) -- [LLM] The ConstraintSystem component utilizes a modular architecture, with each module responsible for a specific aspect of constraint validation and enforcement. This is evident in the use of ContentValidationAgent (integrations/mcp-server-semantic-analysis/src/agents/content-validation-agent.ts) for validating entity content and ViolationCaptureService (scripts/violation-capture-service.js) for capturing constraint violations from tool interactions. The modular design allows for easier maintenance and updates, as each module can be modified or replaced independently without affecting the overall system. Furthermore, the use of a unified hook manager (lib/agent-api/hooks/hook-manager.js) enables central orchestration of hook events, making it easier to manage and coordinate the various modules. For instance, the useWorkflowDefinitions hook (integrations/system-health-dashboard/src/components/workflow/hooks.ts) can be used to retrieve workflow definitions from Redux, which can then be used to inform the constraint validation process.
- [SemanticAnalysis](./SemanticAnalysis.md) -- [LLM] The SemanticAnalysis component utilizes a modular architecture, with each agent having a specific role and interacting with others through a workflow-based execution model. This is evident in the way the OntologyClassificationAgent, SemanticAnalysisAgent, and CodeGraphAgent are implemented as separate classes in the integrations/mcp-server-semantic-analysis/src/agents directory. For instance, the OntologyClassificationAgent class in ontology-classification-agent.ts extends the BaseAgent abstract base class, which standardizes agent behavior and response formats. The execute method in ontology-classification-agent.ts demonstrates how the agent classifies observations against an ontology system, showcasing the component's ability to extract and persist structured knowledge entities.


---

*Generated from 6 observations*
