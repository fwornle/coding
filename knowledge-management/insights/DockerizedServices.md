# DockerizedServices

**Type:** Component

In terms of specific implementation details, the component features a range of classes and functions that facilitate its operations. For instance, the LLMService class in lib/llm/llm-service.ts serves as a high-level facade for all LLM operations, handling mode routing, caching, and circuit breaking. Similarly, the startServiceWithRetry function in lib/service-starter.js enables robust service startup with retry logic and timeout protection. These elements collectively contribute to the component's overall architecture and functionality.

## What It Is  

DockerizedServices is the **runtime‑deployment component** that packages the various back‑end agents of the Coding project into Docker containers and supplies the plumbing required to start, monitor, and communicate with those services. The implementation lives primarily in the **`scripts/`** folder – e.g. `scripts/api‑service.js` and `scripts/dashboard‑service.js` – which wrap the constraint‑monitoring API server and the Global Service Coordinator dashboard respectively. Internally the component is built around a small set of reusable libraries found under `lib/`, notably `lib/llm/llm‑service.ts`, `lib/service‑starter.js`, and supporting utilities such as `isPortListening`. DockerizedServices also owns three child sub‑components – **LLMServiceManager**, **ServiceStarter**, and **LoggingMechanism** – that expose the core capabilities (LLM façade, robust startup, and standardized logging) to the rest of the system.

## Architecture and Design  

The architecture follows a **facade‑oriented, retry‑enhanced deployment model**. The `LLMService` class in `lib/llm/llm‑service.ts` acts as a **high‑level façade** for all language‑model interactions, encapsulating mode routing, caching, and circuit‑breaking concerns. This façade is consumed by the child component **LLMServiceManager**, which centralises LLM‑related logic for the Dockerized services.  

Service startup is handled by the **ServiceStarter** child, which relies on the `startServiceWithRetry` function in `lib/service‑starter.js`. This function implements **retry logic with exponential back‑off**, timeout protection, and a guard against endless loops. The complementary `isPortListening` utility validates that a container’s exposed port is ready before the system proceeds, providing a lightweight health‑check.  

The deployment scripts (`scripts/api‑service.js`, `scripts/dashboard‑service.js`) embody a **Docker‑wrapper pattern**: they construct Docker run commands, inject environment variables, and invoke the ServiceStarter logic to ensure each container is launched reliably. The overall design mirrors the sibling component **LLMAbstraction**, which also uses a façade (but for provider‑agnostic LLM calls) and shares patterns such as dependency injection and singleton management. By keeping DockerizedServices focused on container lifecycle while delegating LLM concerns to LLMServiceManager, the component maintains a clear separation of concerns.

## Implementation Details  

* **LLMService (`lib/llm/llm‑service.ts`)** – Exposes a `complete` method that performs full routing logic. It first determines the active LLM mode via `getLLMMode` (found in `integrations/mcp‑server‑semantic‑analysis/src/mock/llm‑mock‑service.ts`), then decides whether to invoke a mock, local, or public LLM backend. The method also integrates cache look‑ups, budget enforcement, and sensitivity checks before issuing the final request. Circuit‑breaking is baked into the service so that repeated failures trigger a fallback path, protecting downstream components.

* **Mode Management (`integrations/mcp‑server‑semantic‑analysis/src/mock/llm‑mock‑service.ts`)** – Provides `getLLMMode` and `setGlobalLLMMode`. `getLLMMode` resolves the mode for a given agent by consulting per‑agent overrides, a global mode setting, and legacy `mockLLM` flags, ensuring backward compatibility. `setGlobalLLMMode` updates a progress file and the legacy flag, guaranteeing that the new mode persists across restarts.

* **Service Startup (`lib/service‑starter.js`)** – The `startServiceWithRetry` function accepts a start callback, a maximum retry count, and back‑off parameters. It repeatedly invokes the callback, awaiting success, while catching transient errors. If the retry limit is hit, the function throws a controlled exception, allowing higher‑level orchestration to degrade gracefully. The helper `isPortListening` opens a temporary socket to the target port and resolves only when the service reports readiness, preventing race conditions between container launch and client connection.

* **Docker Scripts (`scripts/api‑service.js`, `scripts/dashboard‑service.js`)** – These scripts assemble the Docker command line, set environment variables (including the LLM mode), and then call `startServiceWithRetry`. They also pipe logs through the **LoggingMechanism** child, which uses the project‑wide logging framework to produce structured, configurable output.  

* **LoggingMechanism** – While the exact file is not listed, the child component is described as using a logging framework to emit events and errors, providing a unified observability surface across all Dockerized services.

## Integration Points  

DockerizedServices sits at the intersection of three major system layers:

1. **LLMAbstraction** – The `LLMService` façade mirrors the provider‑agnostic LLMAbstraction façade, allowing Dockerized services to request completions without caring about the underlying provider. Mode resolution (`getLLMMode`) draws on configuration data that is also consumed by other agents in the SemanticAnalysis and ConstraintSystem components.

2. **ConstraintSystem & SemanticAnalysis** – The `scripts/api‑service.js` container hosts the constraint‑monitoring API server, which is invoked by the ConstraintSystem to validate code actions. Similarly, the dashboard container (`scripts/dashboard‑service.js`) presents the Global Service Coordinator UI used by SemanticAnalysis agents for coordination.

3. **LiveLoggingSystem** – All logs emitted by the LoggingMechanism flow into the LiveLoggingSystem, which aggregates them for live session inspection. This shared logging pipeline ensures that failures during service startup or LLM calls are visible across the whole platform.

Dependencies are explicit: the Docker scripts import `startServiceWithRetry` and `isPortListening` from `lib/service‑starter.js`; the LLM façade imports `getLLMMode`/`setGlobalLLMMode` from the mock service module; and the child components (LLMServiceManager, ServiceStarter, LoggingMechanism) expose their APIs to sibling components that need to start or query services.

## Usage Guidelines  

* **Start Services via the Provided Scripts** – Developers should invoke `node scripts/api‑service.js` or `node scripts/dashboard‑service.js` rather than running Docker commands manually. The scripts guarantee that `startServiceWithRetry` and `isPortListening` are applied, preventing premature client connections.

* **Configure LLM Mode Consistently** – Use `setGlobalLLMMode` to change the global LLM mode; this updates both the progress file and the legacy `mockLLM` flag, ensuring that all agents—including those in SemanticAnalysis—see the same setting. When per‑agent overrides are needed, modify the configuration that `getLLMMode` reads rather than patching the service code.

* **Respect Retry Limits** – The default retry count and exponential back‑off values in `startServiceWithRetry` are tuned for typical development environments. If a service is expected to take longer to initialise (e.g., heavy model loading), increase the timeout or retry parameters rather than disabling the retry mechanism.

* **Log Through the Central Mechanism** – All custom logging inside DockerizedServices should go through the LoggingMechanism child so that logs are captured by LiveLoggingSystem. Avoid console‑logging directly; instead, use the provided logger’s `info`, `warn`, and `error` methods.

* **Do Not Bypass the Facade** – Direct calls to underlying LLM providers are discouraged. All LLM interactions must pass through `LLMService.complete` to benefit from caching, budget checks, and circuit‑breaking. This also keeps the system compatible with future provider additions managed by LLMAbstraction.

---

### 1. Architectural patterns identified  
* **Facade pattern** – `LLMService` provides a unified interface for all LLM operations.  
* **Retry / Exponential Back‑off pattern** – Implemented in `startServiceWithRetry`.  
* **Circuit Breaker** – Integrated inside `LLMService` to protect downstream calls.  
* **Docker‑Wrapper / Script‑Orchestrator pattern** – Deployment scripts encapsulate container launch and health‑check logic.  
* **Strategy‑like mode routing** – `getLLMMode` selects the execution strategy (mock, local, public) based on configuration.

### 2. Design decisions and trade‑offs  
* **Centralised LLM façade vs. scattered provider calls** – Improves consistency and allows cross‑cutting concerns (caching, budget) but adds a single point of failure mitigated by the circuit breaker.  
* **Robust startup with retries** – Guarantees service availability at the cost of longer start‑up times when containers are genuinely slow; exponential back‑off mitigates resource waste.  
* **Legacy flag handling** – Maintaining the `mockLLM` flag preserves backward compatibility, but introduces extra conditional logic in mode resolution.

### 3. System structure insights  
DockerizedServices is a leaf component under the root **Coding** node, with three children (LLMServiceManager, ServiceStarter, LoggingMechanism) that encapsulate distinct responsibilities. It shares the LLM façade concept with its sibling **LLMAbstraction**, and its health‑check utilities are reusable by other components that need to verify network readiness. The component’s scripts act as the glue that binds the containerised services to the broader platform (ConstraintSystem, SemanticAnalysis, LiveLoggingSystem).

### 4. Scalability considerations  
* **Horizontal scaling** – Because each service runs in its own Docker container, additional instances can be spawned without code changes; the retry logic ensures each instance starts cleanly.  
* **Cache and budget checks** in `LLMService.complete` limit API usage, supporting large‑scale deployments without overwhelming external LLM providers.  
* **Circuit breaker** prevents cascading failures when a provider becomes throttled, preserving overall system responsiveness as the number of agents grows.

### 5. Maintainability assessment  
The component is **well‑modularised**: startup logic, LLM façade, and logging are isolated into separate child modules, making unit testing straightforward. File‑level granularity (`lib/llm/llm‑service.ts`, `lib/service‑starter.js`) and explicit naming keep the codebase discoverable. However, the coexistence of modern mode handling and legacy `mockLLM` flags adds conditional branches that may increase cognitive load; a future refactor could deprecate the legacy path once all consumers migrate. Overall, the clear separation of concerns, use of standard patterns, and reliance on shared utilities (e.g., `isPortListening`) support long‑term maintainability.


## Hierarchy Context

### Parent
- [Coding](./Coding.md) -- Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 8 major components: LiveLoggingSystem: The LiveLoggingSystem component is a comprehensive logging infrastructure designed to capture and process live session logs from various agents, inclu; LLMAbstraction: The LLMAbstraction component serves as a high-level facade for interacting with various LLM providers, such as Anthropic, OpenAI, and Groq, enabling p; DockerizedServices: In terms of specific implementation details, the component features a range of classes and functions that facilitate its operations. For instance, the; Trajectory: The Trajectory component is a complex system managing project milestones, GSD workflow, phase planning, and implementation task tracking. It employs v; KnowledgeManagement: The KnowledgeManagement component is responsible for managing the knowledge graph, including entity persistence, graph database interactions, and inte; CodingPatterns: The CodingPatterns component encompasses general programming wisdom, design patterns, best practices, and coding conventions applicable across the pro; ConstraintSystem: The ConstraintSystem component is a constraint monitoring and enforcement system that validates code actions and file operations against configured ru; SemanticAnalysis: The SemanticAnalysis component is a multi-agent system that processes git history and LSL sessions to extract and persist structured knowledge entitie.

### Children
- [LLMServiceManager](./LLMServiceManager.md) -- LLMServiceManager utilizes the LLMService class in lib/llm/llm-service.ts to handle mode routing, caching, and circuit breaking.
- [ServiceStarter](./ServiceStarter.md) -- ServiceStarter uses the startServiceWithRetry function in lib/service-starter.js to enable robust service startup with retry logic and timeout protection.
- [LoggingMechanism](./LoggingMechanism.md) -- LoggingMechanism uses a logging framework to log events and errors, providing a standardized and configurable logging mechanism.

### Siblings
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- The LiveLoggingSystem component is a comprehensive logging infrastructure designed to capture and process live session logs from various agents, including Claude Code conversations. Its architecture involves multiple sub-components, including transcript adapters, log converters, and ontology classification agents. Key patterns in this component include the use of graph database adapters for persistence, work-stealing concurrency for efficient processing, and heuristic-based classification for ontology metadata attachment.
- [LLMAbstraction](./LLMAbstraction.md) -- The LLMAbstraction component serves as a high-level facade for interacting with various LLM providers, such as Anthropic, OpenAI, and Groq, enabling provider-agnostic model calls, tier-based routing, and mock mode for testing. Its architecture involves a combination of interfaces, classes, and modules that work together to manage LLM operations, including mode resolution, provider registration, and completion requests. The component utilizes design patterns like dependency injection, singleton, and factory to ensure flexibility, scalability, and maintainability.
- [Trajectory](./Trajectory.md) -- The Trajectory component is a complex system managing project milestones, GSD workflow, phase planning, and implementation task tracking. It employs various technologies such as Node.js, TypeScript, and GraphQL to build a comprehensive planning infrastructure. The component's architecture involves multiple connection methods, including HTTP API, Inter-Process Communication (IPC), and file watch directory, to interact with the Specstory extension. The SpecstoryAdapter class plays a central role in this component, providing methods for initialization, logging conversations, and connecting to the Specstory extension via different methods.
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component is responsible for managing the knowledge graph, including entity persistence, graph database interactions, and intelligent routing for database access. It utilizes various technologies such as Graphology, LevelDB, and VKB API to provide a comprehensive knowledge management system. The component's architecture is designed to support multiple agents, including CodeGraphAgent and PersistenceAgent, which work together to analyze code, extract concepts, and store entities in the graph database.
- [CodingPatterns](./CodingPatterns.md) -- The CodingPatterns component encompasses general programming wisdom, design patterns, best practices, and coding conventions applicable across the project. This component serves as a catch-all for entities that do not fit into other specific components. Its architecture is designed to promote consistency and efficiency in coding practices, ensuring that the project adheres to established standards and guidelines. Key patterns in this component include the use of intelligent routing, graph database adapters, and work-stealing concurrency, which contribute to its overall structure and functionality.
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem component is a constraint monitoring and enforcement system that validates code actions and file operations against configured rules during Claude Code sessions. It utilizes various technologies such as Node.js, TypeScript, and GraphQL to build its architecture. The system's key patterns include the use of intelligent routing for database interactions, graph database adapters for persistence, and work-stealing concurrency for efficient data processing. The component also employs a multi-agent system that processes git history and LSL sessions to detect staleness and validate entity content.
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component is a multi-agent system that processes git history and LSL sessions to extract and persist structured knowledge entities. It utilizes various technologies such as Node.js, TypeScript, and GraphQL to build a comprehensive semantic analysis pipeline. The component's architecture is designed to support multiple agents, each with its own specific responsibilities, such as ontology classification, semantic analysis, and content validation. Key patterns in this component include the use of intelligent routing for database interactions, graph database adapters for persistence, and work-stealing concurrency for efficient processing.


---

*Generated from 8 observations*
