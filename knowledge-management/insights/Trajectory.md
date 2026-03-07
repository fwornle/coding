# Trajectory

**Type:** Component

The Trajectory component is a complex system that manages project milestones, GSD workflow, phase planning, and implementation task tracking. Its architecture involves utilizing various connection met...

## What It Is  

The **Trajectory** component lives in the code‑base under the integration layer **`lib/integrations/specstory-adapter.js`**.  This file exports the **`SpecstoryAdapter`** class, which is the public entry point for all of Trajectory’s runtime behaviour.  Trajectory’s responsibility is to orchestrate the flow of project‑level concerns—milestones, GSD (Getting‑Stuff‑Done) workflow, phase planning, and implementation‑task tracking—by maintaining a reliable conversation channel with the **Specstory** extension.  The adapter creates a **session ID** (`this.sessionId`) that uniquely identifies a run, logs every interaction through the shared logger (`createLogger` from `../logging/Logger.js`), and guarantees delivery of messages even when the preferred transport (HTTP or IPC) is unavailable by falling back to a file‑watch based protocol.

## Architecture and Design  

Trajectory follows a **modular, fault‑tolerant integration pattern**.  The core class (`SpecstoryAdapter`) isolates three distinct transport strategies—HTTP, IPC (named‑pipe or socket), and file‑watch—each encapsulated in its own method (`connectViaHTTP`, `connectViaIPC`, `connectViaFileWatch`).  The component implements an **explicit retry‑and‑fallback** design: the primary connection attempt is made via HTTP; if that fails, the adapter retries a configurable number of times (see the retry loops in `lib/integrations/specstory-adapter.js:50‑150`), then transparently switches to IPC, and finally to the file‑watch fallback (`lib/integrations/specstory-adapter.js:200‑250`).  This layered approach mirrors the **Chain‑of‑Responsibility** pattern, where each transport handler decides whether it can fulfil the request and, if not, passes control to the next handler.

Trajectory’s internal responsibilities are further decomposed into child entities that are referenced throughout the hierarchy:

* **ConnectionManager** – wraps the `SpecstoryAdapter` and presents a higher‑level API to the rest of the system.  
* **SpecstoryApiClient** – uses the active connection (HTTP/IPC/file) to invoke the Specstory extension’s API.  
* **ConversationLogger** – channels all log statements through the shared logger, ensuring a uniform audit trail.  
* **RetryManager** – centralises the retry logic that the adapter’s `connectVia*` methods rely on.  
* **SessionManager** – owns the generation and lifecycle of `this.sessionId`, enabling correlation of logs and messages.

Because Trajectory sits under the **Coding** root component, it inherits the project‑wide conventions for logging, error handling, and configuration that are also used by siblings such as **LiveLoggingSystem** (which provides a broader logging infrastructure) and **LLMAbstraction** (which supplies a façade for external services).  All of these components share the same `createLogger` implementation, reinforcing a **cross‑cutting logging concern** across the code‑base.

## Implementation Details  

### Constructor → Initialize → Log Flow  
The `SpecstoryAdapter` constructor establishes the basic state (including `this.sessionId`) and injects the logger.  Immediately after instantiation, the public `initialize()` method is called; it orchestrates the connection sequence by invoking the transport‑specific methods in order of preference.  Each `connectVia*` method follows a similar skeleton:

1. **Prepare transport‑specific resources** – e.g., create an HTTP request object (`http` module) or open a Unix socket (`net` module).  
2. **Attempt the handshake** – send a “ping” or version check to the Specstory extension.  
3. **Retry on failure** – loop with exponential back‑off, delegating the logic to **RetryManager** (observed in the retry loops at lines 50‑150).  
4. **On success** – store the active channel (e.g., `this.httpClient` or `this.ipcSocket`) and resolve the promise.  

If all attempts fail, `connectViaFileWatch` is invoked.  This method watches a designated directory (using `fs.watch` from the `fs` module) for JSON payload files that the extension drops.  When a new file appears, the adapter reads it, parses the message, and acknowledges receipt by moving the file to a “processed” sub‑folder.  This file‑watch approach guarantees eventual consistency even when the extension is running in a sandboxed environment that blocks network sockets.

### Logging and Error Handling  
All significant events—connection attempts, retries, successful handshakes, and message exchanges—are emitted through the logger created via `../logging/Logger.js`.  The logger is configured at the project level (as used by **LiveLoggingSystem**) to write structured JSON entries to a central log store, enabling downstream analytics and troubleshooting.

### Session Management  
`SessionManager` generates a UUID for each adapter instance (`this.sessionId`).  This ID is attached to every outbound request and logged inbound responses, providing a traceable link between the Trajectory component’s internal state and the external Specstory extension’s activity.  The session ID also scopes any temporary files created by the file‑watch fallback, preventing cross‑talk between concurrent runs.

### Dependency Footprint  
Trajectory relies on native Node.js modules—`fs`, `path`, `os`, `net`, and `http`—for its low‑level I/O, and on the shared logger for observability.  No external third‑party packages are introduced, keeping the component lightweight and easy to ship within the Dockerized services that the **DockerizedServices** sibling manages.

## Integration Points  

* **Parent – Coding**: Trajectory is one of eight major components under the **Coding** umbrella.  It consumes the global configuration and logger that Coding provides, and it contributes milestone and task data that may be visualised by higher‑level tooling (e.g., a project‑dashboard).  

* **Sibling – LiveLoggingSystem**: Both components funnel their logs through the same `createLogger` implementation, meaning that Trajectory’s conversation logs appear alongside live agent transcripts in the unified logging pipeline.  

* **Sibling – LLMAbstraction**: While Trajectory does not directly invoke LLM providers, it may forward milestone‑related prompts to the LLMAbstraction service via the Specstory extension, leveraging the same abstracted API surface used by other components.  

* **Child – ConnectionManager**: Exposes methods such as `connect()`, `disconnect()`, and `sendMessage()` to the rest of the system, abstracting away the transport details implemented in `SpecstoryAdapter`.  

* **Child – SpecstoryApiClient**: Implements higher‑level API calls (e.g., `createMilestone`, `updatePhase`) on top of the raw transport channel, translating Trajectory’s domain concepts into the JSON schema expected by the Specstory extension.  

* **Child – ConversationLogger**: Wraps the logger to add Trajectory‑specific metadata (session ID, milestone identifiers) before persisting each message.  

* **Child – RetryManager**: Centralises the exponential back‑off algorithm and maximum‑retry thresholds used by the three `connectVia*` methods.  

* **Child – SessionManager**: Provides lifecycle hooks (`startSession()`, `endSession()`) that other components can call to ensure a consistent session context across the whole Coding system.

## Usage Guidelines  

1. **Instantiate via ConnectionManager** – Application code should never import `SpecstoryAdapter` directly.  Use `new ConnectionManager()` which internally creates the adapter, calls `initialize()`, and returns a ready‑to‑use client.  

2. **Respect the retry configuration** – The default retry count and back‑off intervals are defined in `RetryManager`.  If a component needs a tighter SLA, it should create a custom `RetryManager` instance and pass it to the `ConnectionManager` constructor rather than modifying the adapter’s internal loops.  

3. **Always provide a session ID** – When starting a new Trajectory workflow, invoke `SessionManager.startSession()` first.  The returned ID must be passed to any downstream calls (e.g., `SpecstoryApiClient.createMilestone(sessionId, ...)`) so that logs stay correlated.  

4. **Prefer HTTP, fall back only when necessary** – The design assumes HTTP is the fastest and most reliable transport.  Developers should ensure that the Specstory extension’s HTTP endpoint is reachable in production environments; otherwise, configure the environment variable that forces the file‑watch fallback (`TRAJECTORY_FORCE_FILE_WATCH=1`).  

5. **Monitor the unified logs** – Since Trajectory uses the shared logger, its log entries can be queried alongside LiveLoggingSystem data.  Alert on log levels `error` or `warn` that contain the tag `Trajectory` to catch connection failures early.  

6. **Clean up resources** – When a workflow completes, call `ConnectionManager.disconnect()` to close sockets, stop file watchers, and invoke `SessionManager.endSession()`.  This prevents dangling file‑watch listeners that could interfere with subsequent runs.  

---

### Architectural patterns identified  
* **Chain‑of‑Responsibility** for transport selection (HTTP → IPC → File‑watch)  
* **Retry/Back‑off** encapsulated in a dedicated **RetryManager**  
* **Facade** pattern via **SpecstoryApiClient** exposing domain‑level operations  
* **Session‑Scoped Logging** using a shared logger and a unique session ID  

### Design decisions and trade‑offs  
* **Multiple transport layers** increase resilience but add complexity in error handling and state management.  
* **File‑watch fallback** guarantees eventual delivery even in highly restricted environments, at the cost of higher latency compared to HTTP/IPC.  
* **No external dependencies** keep the component lightweight, but rely on native Node APIs that may behave differently across operating systems (e.g., socket path limits).  

### System structure insights  
Trajectory is a thin integration layer that delegates most business logic to its children (ConnectionManager, SpecstoryApiClient, etc.).  The parent‑child hierarchy cleanly separates concerns: connection handling, API translation, logging, retry policy, and session tracking each live in their own module, making the overall system easier to reason about.  

### Scalability considerations  
Because each Trajectory instance maintains its own connection and session, the system can scale horizontally—multiple concurrent workflows run in parallel, each with an isolated session ID.  The only shared bottleneck is the Specstory extension itself; if that service becomes a hotspot, scaling it (e.g., running multiple extension instances behind a load balancer) would be necessary.  The file‑watch fallback is less scalable due to filesystem contention, so it should be used only as a safety net.  

### Maintainability assessment  
The clear separation of responsibilities, reliance on a shared logger, and explicit retry/fallback logic make the component **highly maintainable**.  Adding a new transport (e.g., WebSocket) would involve implementing another `connectVia*` method and inserting it into the existing chain without touching the other layers.  The use of native Node modules reduces external upgrade risk, and the child entities (ConnectionManager, RetryManager, etc.) provide natural extension points for future enhancements.


## Hierarchy Context

### Parent
- [Coding](./Coding.md) -- Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 8 major components: LiveLoggingSystem: The LiveLoggingSystem component is a comprehensive logging infrastructure designed to capture and process conversations from various agents, such as C; LLMAbstraction: The LLMAbstraction component is a high-level facade that provides an abstraction layer over various LLM providers, including Anthropic, OpenAI, and Gr; DockerizedServices: The component also employs various technologies, such as Node.js, TypeScript, and GraphQL, to build its services and APIs. The use of process managers; Trajectory: The Trajectory component is a complex system that manages project milestones, GSD workflow, phase planning, and implementation task tracking. Its arch; KnowledgeManagement: Key patterns in this component include the use of intelligent routing for database interactions, with the ability to switch between API and direct acc; CodingPatterns: Key patterns in this component include the use of graph database adapters, work-stealing concurrency, and lazy initialization of large language models; ConstraintSystem: The system's key patterns include the use of GraphDatabaseAdapter for graph database persistence, the implementation of work-stealing concurrency, and; SemanticAnalysis: The SemanticAnalysis component is a multi-agent system that processes git history and LSL sessions to extract and persist structured knowledge entitie.

### Children
- [ConnectionManager](./ConnectionManager.md) -- ConnectionManager uses the SpecstoryAdapter class as its main entry point for connection management, as seen in the lib/integrations/specstory-adapter.js file.
- [SpecstoryApiClient](./SpecstoryApiClient.md) -- SpecstoryApiClient uses the extension API to interact with the Specstory extension, as defined in the lib/integrations/specstory-adapter.js file.
- [ConversationLogger](./ConversationLogger.md) -- ConversationLogger uses the logger to handle logging and errors, providing a clear audit trail for conversations and logs.
- [RetryManager](./RetryManager.md) -- RetryManager uses a retry mechanism to retry connections in case of failures, as implemented in the lib/integrations/specstory-adapter.js file.
- [SessionManager](./SessionManager.md) -- SessionManager uses a session ID to track and manage conversations and logs effectively, as seen in the lib/integrations/specstory-adapter.js file.

### Siblings
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- The LiveLoggingSystem component is a comprehensive logging infrastructure designed to capture and process conversations from various agents, such as Claude Code. It handles session windowing, file routing, classification layers, and transcript capture. The system's architecture involves multiple modules and classes, including the OntologyClassificationAgent, which classifies observations against an ontology system, and the TranscriptAdapter, which provides a unified abstraction for reading and converting transcripts from different agent formats. The system also utilizes a logging mechanism, as seen in the logging.ts file, which asynchronously writes log entries to a file.
- [LLMAbstraction](./LLMAbstraction.md) -- The LLMAbstraction component is a high-level facade that provides an abstraction layer over various LLM providers, including Anthropic, OpenAI, and Groq. It enables provider-agnostic model calls, tier-based routing, and mock mode for testing. The component is designed to handle different LLM modes, including mock, local, and public, and it uses a registry to manage the available providers. The LLMAbstraction component is implemented in the lib/llm/llm-service.ts file and uses various other modules, such as the provider registry, circuit breaker, and cache, to manage the LLM operations.
- [DockerizedServices](./DockerizedServices.md) -- The component also employs various technologies, such as Node.js, TypeScript, and GraphQL, to build its services and APIs. The use of process managers, like the ProcessStateManager, enables the registration and unregistration of services, ensuring proper cleanup and resource management. Overall, the DockerizedServices component provides a flexible and scalable framework for coding services, leveraging Docker containerization and a microservices-based architecture.
- [KnowledgeManagement](./KnowledgeManagement.md) -- Key patterns in this component include the use of intelligent routing for database interactions, with the ability to switch between API and direct access modes. Additionally, the component utilizes a classification cache to avoid redundant LLM calls and implements data loss tracking to monitor data flow through the system.
- [CodingPatterns](./CodingPatterns.md) -- Key patterns in this component include the use of graph database adapters, work-stealing concurrency, and lazy initialization of large language models. The project also employs a custom OntologyLoader class to load the ontology and a custom EntityAuthoringService class to handle manual entity creation and editing. These patterns and principles contribute to the overall quality and maintainability of the codebase.
- [ConstraintSystem](./ConstraintSystem.md) -- The system's key patterns include the use of GraphDatabaseAdapter for graph database persistence, the implementation of work-stealing concurrency, and the utilization of a unified hook manager for central orchestration of hook events. The system also employs various logging mechanisms, such as the use of a logger wrapper for content validation and the implementation of error handling mechanisms.
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component is a multi-agent system that processes git history and LSL sessions to extract and persist structured knowledge entities. It utilizes various agents, including the OntologyClassificationAgent, SemanticAnalysisAgent, and CodeGraphAgent, to perform tasks such as ontology classification, semantic analysis, and code graph construction. The component's architecture is designed to facilitate the integration of multiple agents and enable the efficient processing of large amounts of data.


---

*Generated from 8 observations*
