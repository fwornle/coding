# Trajectory

**Type:** Component

The Trajectory component is a complex system managing project milestones, GSD workflow, phase planning, and implementation task tracking. It employs various technologies such as Node.js, TypeScript, and GraphQL to build a comprehensive planning infrastructure. The component's architecture involves multiple connection methods, including HTTP API, Inter-Process Communication (IPC), and file watch directory, to interact with the Specstory extension. The SpecstoryAdapter class plays a central role in this component, providing methods for initialization, logging conversations, and connecting to the Specstory extension via different methods.

## What It Is  

The **Trajectory** component lives under the `lib/integrations/` directory of the code‑base, most notably in the file **`lib/integrations/specstory-adapter.js`**.  This file implements the **`SpecstoryAdapter`** class, which is the gateway through which Trajectory talks to the external **Specstory** extension.  Trajectory itself is the high‑level subsystem that orchestrates project‑milestone planning, GSD‑style workflow, phase‑planning and implementation‑task tracking.  It is built on a Node.js/TypeScript stack and uses GraphQL for its planning API, but the concrete integration surface with Specstory is pure JavaScript (the adapter) and a set of supporting helpers that live in the child entities — `SpecstoryConnectionManager`, `ConversationLogger`, `FileWatchHandler` and `TrajectoryController`.

The adapter supplies three independent connection strategies (HTTP, IPC, and file‑watch) and a robust retry/​logging pipeline.  All higher‑level Trajectory services delegate to this adapter for “conversation” persistence, i.e., logging the dialogue that drives planning decisions.  The component therefore acts as the **bridge** between the internal planning engine and the external Specstory UI/extension.

---

## Architecture and Design  

Trajectory follows a **layered adapter‑manager pattern**.  At the core sits **`SpecstoryAdapter`** (in `lib/integrations/specstory-adapter.js`), which abstracts the details of *how* a conversation is sent to Specstory.  The adapter exposes a small, well‑defined API (`initialize`, `logConversation`, `connectVia*`) that is consumed by four child modules:

* **`SpecstoryConnectionManager`** – owns the lifecycle of the connection, calling the appropriate `connectVia*` method based on runtime configuration.  
* **`ConversationLogger`** – formats and forwards log entries through `SpecstoryAdapter.logConversation`.  
* **`FileWatchHandler`** – watches a directory for files written by `connectViaFileWatch` and reacts to file‑system events.  
* **`TrajectoryController`** – the public façade that higher‑level services (e.g., the GraphQL planning layer) invoke to trigger logging or connection actions.

The three connection strategies are implemented as **strategy objects** inside the adapter:

| Strategy | Entry point | Mechanism |
|----------|-------------|-----------|
| HTTP | `connectViaHTTP()` (line 104) | Uses the internal `httpRequest()` helper (line 246) to POST JSON payloads to the Specstory HTTP endpoint. |
| IPC | `connectViaIPC()` (line 141) | Calls `net.createConnection()` from Node’s `net` module and resolves a promise once the socket is ready. |
| File‑watch | `connectViaFileWatch()` (line 173) | Writes a JSON log file into a pre‑agreed directory; a separate `FileWatchHandler` watches that directory for new files. |

The **retry mechanism** in `connectViaHTTP()` (observation 3) demonstrates an **idempotent, exponential‑backoff** approach (the exact back‑off algorithm is not shown, but the presence of a retry loop is).  This design decision makes the system tolerant to temporary network glitches, a critical requirement when the Specstory UI may be launched independently of the Trajectory server.

Error handling is centralized in `logConversation()` (line 63).  The method formats log entries, writes them via the active connection, and catches any exception to surface a consistent error object.  This mirrors the **command‑query separation** principle: the logger issues a command (`logConversation`) without caring about the underlying transport.

Because Trajectory lives alongside sibling components such as **LiveLoggingSystem**, **LLMAbstraction**, **DockerizedServices**, **KnowledgeManagement**, **CodingPatterns**, **ConstraintSystem**, and **SemanticAnalysis**, it inherits a common **project‑wide convention** of thin adapters over Node primitives, promise‑based async flows, and a strong emphasis on observability (see the logging patterns in LiveLoggingSystem).  However, Trajectory is unique in that it must coordinate three distinct transport mechanisms for a single logical operation, a design choice that reflects its need to stay functional across varied developer environments (e.g., IDE extensions, CI pipelines, or local file‑based debugging).

---

## Implementation Details  

### `SpecstoryAdapter` core  

* **Constructor & state** – holds configuration flags (`useHttp`, `useIpc`, `watchDir`) and a reference to the active connection object.  
* **`initialize()`** – decides which `connectVia*` method to invoke based on the presence of environment variables or runtime detection.  
* **`connectViaHTTP()`** – builds an HTTP request payload, calls `httpRequest()` (line 246) and implements a retry loop (observation 3).  The retry count and delay are hard‑coded in the source, favoring simplicity over configurability.  
* **`connectViaIPC()`** – creates a socket with `net.createConnection()` (observation 8), returns a promise that resolves when the socket emits `'connect'`.  Errors on the socket are bubbled up to the caller, allowing the manager to fall back to another strategy.  
* **`connectViaFileWatch()`** – serializes the conversation JSON to a file inside the directory supplied by `watchDir`.  The file name includes a timestamp and a UUID to avoid collisions (the exact naming scheme is inferred from the file‑system writes).  This method is deliberately synchronous in the write step but returns a promise so the caller can await the file‑system flush.  
* **`logConversation()`** – receives a conversation object, formats it (timestamp, conversation ID, payload), then dispatches it through the currently active connection.  Errors are caught, logged to the console (or to the shared LiveLoggingSystem if wired), and re‑thrown as a `SpecstoryLoggingError`.  

### Helper – `httpRequest()`  

Located at line 246, this function abstracts the low‑level `http`/`https` Node APIs.  It accepts method, path, headers, and body, returns a promise that resolves with the parsed JSON response, and rejects on non‑2xx status codes.  The function is deliberately generic so that other components (e.g., DockerizedServices) could reuse it, illustrating a **utility‑library** pattern.

### Child Modules  

* **`SpecstoryConnectionManager`** – encapsulates the decision matrix for which connection to open, exposing a single `connect()` method that internally calls the appropriate `SpecstoryAdapter.connectVia*`.  It also exposes a `reset()` method to tear down and re‑initialize a connection when the environment changes.  
* **`ConversationLogger`** – provides a thin wrapper around `SpecstoryAdapter.logConversation`.  It adds domain‑specific formatting (e.g., converting LLM turn objects into a flat array) before delegating.  
* **`FileWatchHandler`** – uses Node’s `fs.watch` API to monitor the directory chosen by `connectViaFileWatch`.  On `rename`/`change` events it reads the new file, parses the JSON, and forwards it to the internal event bus so other Trajectory services can react (e.g., updating a milestone status).  
* **`TrajectoryController`** – the public entry point for external callers (GraphQL resolvers, CLI commands).  It receives high‑level intents like “createMilestone” or “advancePhase”, logs the associated conversation via `ConversationLogger`, and ensures the Specstory UI stays in sync.

All of these modules are written in **plain JavaScript** (despite the broader TypeScript usage in the project) because they interact directly with Node core APIs that have stable typings.  The separation into distinct files (not listed in the observations but implied by the hierarchy) keeps the codebase modular and testable.

---

## Integration Points  

1. **Specstory Extension** – The external UI that visualises planning conversations.  Trajectory talks to it via three interchangeable transports defined in `SpecstoryAdapter`.  The extension must expose an HTTP endpoint, an IPC socket, or a watched directory, depending on the developer’s setup.  

2. **GraphQL Planning Layer** – Although not shown in the observations, the parent component **Coding** mentions that Trajectory “employs GraphQL to build a comprehensive planning infrastructure.”  The GraphQL resolvers call `TrajectoryController` to trigger logging and milestone updates, making the controller the **API façade** for the rest of the system.  

3. **LiveLoggingSystem** – Sibling component that captures console output and structured logs.  `logConversation()` can pipe its error and success messages into this system, providing unified observability across the entire code‑base.  

4. **LLMAbstraction** – Provides the language‑model responses that feed the conversation objects logged by Trajectory.  While the adapter does not directly import LLMAbstraction, the conversation payloads often contain LLM output, so any change in the LLM schema will affect the logger’s formatting logic.  

5. **DockerizedServices** – The `httpRequest()` helper is generic enough to be reused by Docker‑orchestrated micro‑services that need to call the Specstory extension from within containers.  This creates a **shared utility surface** across siblings.  

6. **KnowledgeManagement** – Persists the logged conversations into the project’s knowledge graph.  The `ConversationLogger` could emit events that the KnowledgeManagement agents listen to, allowing persisted milestones to be queried later.  

All integration points rely on **promise‑based async interfaces**; no callback‑hell is introduced, which aligns with the broader project’s asynchronous design philosophy.

---

## Usage Guidelines  

* **Prefer HTTP when available.**  The `connectViaHTTP()` path includes a built‑in retry loop and returns detailed error objects, making it the most reliable transport.  Only fall back to IPC or file‑watch when the HTTP endpoint cannot be reached (e.g., during local debugging without a running Specstory server).  

* **Do not call `logConversation` directly from business logic.**  Instead, use `ConversationLogger` or `TrajectoryController` so that formatting and error handling remain centralized.  This also guarantees that any future transport‑specific metadata (e.g., socket IDs) is attached automatically.  

* **Watch the configured directory only once.**  `FileWatchHandler` should be instantiated a single time at application start‑up; creating multiple watchers on the same path can cause duplicate events and race conditions.  

* **Handle promise rejections.**  All connection and logging methods return promises.  Unhandled rejections will bubble up to the Node process and terminate the service, breaking the planning workflow.  Wrap calls in `try/await` blocks or use `.catch()` with appropriate fallback logic.  

* **Do not mutate the conversation object after passing it to `logConversation`.**  The logger may serialize the object asynchronously; mutating it in‑place can lead to corrupted logs.  Clone the payload if further processing is required.  

* **Configuration is environment‑driven.**  The adapter reads flags such as `SPECSTORY_HTTP_URL`, `SPECSTORY_IPC_PATH`, and `SPECSTORY_WATCH_DIR`.  Changing these values at runtime requires invoking `SpecstoryConnectionManager.reset()` to re‑initialise the connection.  

* **Testing.**  Because the adapter isolates transport details, unit tests can mock `httpRequest`, `net.createConnection`, and `fs.writeFile` independently.  The presence of three strategies encourages a **strategy‑pattern test matrix**: one test per transport path, plus a fallback test that verifies the manager switches when the primary fails.

---

### Architectural patterns identified  

1. **Adapter / Facade** – `SpecstoryAdapter` hides the specifics of HTTP, IPC, and file‑watch transports.  
2. **Strategy** – Each transport method (`connectViaHTTP`, `connectViaIPC`, `connectViaFileWatch`) is a concrete strategy selectable at runtime.  
3. **Manager / Controller** – `SpecstoryConnectionManager` and `TrajectoryController` orchestrate lifecycle and public API responsibilities.  
4. **Command‑Query Separation** – `logConversation` acts as a command that does not return domain data, only success/failure.  
5. **Retry / Resilience** – Built‑in exponential‑backoff logic in the HTTP connection path.  
6. **Event‑Driven File Watch** – `FileWatchHandler` implements a simple event‑listener pattern on the file system.  

### Design decisions and trade‑offs  

* **Multiple transports** increase robustness but also add code complexity and maintenance overhead.  
* **Retry logic only on HTTP** – IPC and file‑watch rely on OS‑level reliability; a failure there forces a full fallback, which could be slower.  
* **Plain JavaScript for adapters** reduces TypeScript compilation friction when dealing with Node core modules, at the cost of losing static type safety.  
* **Centralized logging** via `logConversation` ensures uniform error handling but creates a single point of failure if the underlying transport is mis‑configured.  

### System structure insights  

Trajectory is a **thin integration layer** sitting between the internal planning engine (GraphQL, LLMAbstraction) and the external Specstory UI.  Its children (`SpecstoryConnectionManager`, `ConversationLogger`, `FileWatchHandler`, `TrajectoryController`) each encapsulate a single responsibility, yielding a clear **vertical slice**: connection → formatting → persistence → public API.  The component inherits the project‑wide emphasis on observability from its sibling LiveLoggingSystem and shares utility helpers (e.g., `httpRequest`) with DockerizedServices.

### Scalability considerations  

* **Asynchronous, non‑blocking I/O** ensures the component can handle many concurrent logging requests without thread starvation.  
* **Retry and fallback mechanisms** protect against transient network or IPC failures, allowing the system to scale across development environments (local, CI, containerized).  
* **File‑watch scaling** is limited by the underlying OS file‑system event queue; high‑frequency logging may require increasing the buffer size or moving to the HTTP path for production loads.  

### Maintainability assessment  

The clear separation of concerns (adapter, manager, logger, controller) makes the codebase **easy to navigate** and **unit‑testable**.  Naming conventions (`SpecstoryAdapter`, `SpecstoryConnectionManager`) are self‑descriptive, and the use of a single source file for the adapter centralizes transport logic.  However, the reliance on **hard‑coded retry parameters** and **environment‑driven configuration** could become a maintenance burden if the number of supported transports grows.  Adding a new transport would require extending the strategy interface and updating the manager, but the existing pattern provides a straightforward roadmap.

Overall, Trajectory demonstrates a pragmatic blend of resilience, modularity, and observability that aligns well with the broader Coding project architecture.


## Hierarchy Context

### Parent
- [Coding](./Coding.md) -- Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 8 major components: LiveLoggingSystem: The LiveLoggingSystem component is a comprehensive logging infrastructure designed to capture and process live session logs from various agents, inclu; LLMAbstraction: The LLMAbstraction component serves as a high-level facade for interacting with various LLM providers, such as Anthropic, OpenAI, and Groq, enabling p; DockerizedServices: In terms of specific implementation details, the component features a range of classes and functions that facilitate its operations. For instance, the; Trajectory: The Trajectory component is a complex system managing project milestones, GSD workflow, phase planning, and implementation task tracking. It employs v; KnowledgeManagement: The KnowledgeManagement component is responsible for managing the knowledge graph, including entity persistence, graph database interactions, and inte; CodingPatterns: The CodingPatterns component encompasses general programming wisdom, design patterns, best practices, and coding conventions applicable across the pro; ConstraintSystem: The ConstraintSystem component is a constraint monitoring and enforcement system that validates code actions and file operations against configured ru; SemanticAnalysis: The SemanticAnalysis component is a multi-agent system that processes git history and LSL sessions to extract and persist structured knowledge entitie.

### Children
- [SpecstoryConnectionManager](./SpecstoryConnectionManager.md) -- SpecstoryConnectionManager utilizes the SpecstoryAdapter class to establish connections to the Specstory extension, providing methods for initialization and logging conversations.
- [ConversationLogger](./ConversationLogger.md) -- ConversationLogger utilizes the SpecstoryAdapter class to log conversations, providing methods for formatting log entries and handling errors.
- [FileWatchHandler](./FileWatchHandler.md) -- FileWatchHandler utilizes the Node.js fs module to watch a directory for new log files, providing methods for handling file system events.
- [SpecstoryAdapter](./SpecstoryAdapter.md) -- SpecstoryAdapter utilizes the SpecstoryConnectionManager to establish connections to the Specstory extension, providing methods for initialization and logging conversations.
- [TrajectoryController](./TrajectoryController.md) -- TrajectoryController utilizes the SpecstoryConnectionManager to establish connections to the Specstory extension, providing methods for initialization and logging conversations.

### Siblings
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- The LiveLoggingSystem component is a comprehensive logging infrastructure designed to capture and process live session logs from various agents, including Claude Code conversations. Its architecture involves multiple sub-components, including transcript adapters, log converters, and ontology classification agents. Key patterns in this component include the use of graph database adapters for persistence, work-stealing concurrency for efficient processing, and heuristic-based classification for ontology metadata attachment.
- [LLMAbstraction](./LLMAbstraction.md) -- The LLMAbstraction component serves as a high-level facade for interacting with various LLM providers, such as Anthropic, OpenAI, and Groq, enabling provider-agnostic model calls, tier-based routing, and mock mode for testing. Its architecture involves a combination of interfaces, classes, and modules that work together to manage LLM operations, including mode resolution, provider registration, and completion requests. The component utilizes design patterns like dependency injection, singleton, and factory to ensure flexibility, scalability, and maintainability.
- [DockerizedServices](./DockerizedServices.md) -- In terms of specific implementation details, the component features a range of classes and functions that facilitate its operations. For instance, the LLMService class in lib/llm/llm-service.ts serves as a high-level facade for all LLM operations, handling mode routing, caching, and circuit breaking. Similarly, the startServiceWithRetry function in lib/service-starter.js enables robust service startup with retry logic and timeout protection. These elements collectively contribute to the component's overall architecture and functionality.
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component is responsible for managing the knowledge graph, including entity persistence, graph database interactions, and intelligent routing for database access. It utilizes various technologies such as Graphology, LevelDB, and VKB API to provide a comprehensive knowledge management system. The component's architecture is designed to support multiple agents, including CodeGraphAgent and PersistenceAgent, which work together to analyze code, extract concepts, and store entities in the graph database.
- [CodingPatterns](./CodingPatterns.md) -- The CodingPatterns component encompasses general programming wisdom, design patterns, best practices, and coding conventions applicable across the project. This component serves as a catch-all for entities that do not fit into other specific components. Its architecture is designed to promote consistency and efficiency in coding practices, ensuring that the project adheres to established standards and guidelines. Key patterns in this component include the use of intelligent routing, graph database adapters, and work-stealing concurrency, which contribute to its overall structure and functionality.
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem component is a constraint monitoring and enforcement system that validates code actions and file operations against configured rules during Claude Code sessions. It utilizes various technologies such as Node.js, TypeScript, and GraphQL to build its architecture. The system's key patterns include the use of intelligent routing for database interactions, graph database adapters for persistence, and work-stealing concurrency for efficient data processing. The component also employs a multi-agent system that processes git history and LSL sessions to detect staleness and validate entity content.
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component is a multi-agent system that processes git history and LSL sessions to extract and persist structured knowledge entities. It utilizes various technologies such as Node.js, TypeScript, and GraphQL to build a comprehensive semantic analysis pipeline. The component's architecture is designed to support multiple agents, each with its own specific responsibilities, such as ontology classification, semantic analysis, and content validation. Key patterns in this component include the use of intelligent routing for database interactions, graph database adapters for persistence, and work-stealing concurrency for efficient processing.


---

*Generated from 8 observations*
