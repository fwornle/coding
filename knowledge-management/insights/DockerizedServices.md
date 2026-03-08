# DockerizedServices

**Type:** Component

The DockerizedServices component follows a facade pattern in the LLMService class to enable provider-agnostic model calls for LLM operations. This design decision promotes flexibility and maintainability by decoupling the LLM operations from the underlying providers. The LLMService class provides a unified interface for LLM operations, which are then routed to the appropriate provider based on the configuration settings and the availability of the providers. For example, in the LLMService class, the predict method takes a input text and returns a prediction result, which is obtained by calling the corresponding method on the underlying LLM provider. The predict method is implemented using a combination of mode routing and caching, which improves the overall system performance and responsiveness.

## What It Is  

The **DockerizedServices** component lives at the root of the *Coding* hierarchy and is materialised by a handful of concrete files and classes. Its core start‑up logic resides in **`service-starter.js`**, which is responsible for launching the internal services – `SemanticAnalysisService`, `ConstraintMonitoringService`, `CodeGraphService` and the generic `ServiceStarter` itself.  LLM‑related work is encapsulated in **`lib/llm/llm‑service.ts`**, where the `LLMService` class provides a provider‑agnostic façade for all large‑language‑model (LLM) interactions.  Graph‑database access is abstracted through the **`GraphDatabaseAdapter`** that is used by the `CodeGraphAgent` located in **`integrations/mcp-server-semantic-analysis/src/agents/CodeGraphAgent.ts`**.  Together these pieces give DockerizedServices a self‑contained, resilient runtime that can be started inside a Docker container while gracefully handling transient failures of optional downstream services.

## Architecture and Design  

DockerizedServices adopts a **resilience‑oriented architecture** built around three recurring design patterns:

1. **Retry‑with‑Backoff** – Implemented in `service‑starter.js` via a recursive function that calls `setTimeout` with an exponentially increasing delay.  The pattern caps the number of attempts and backs off to avoid overwhelming dependent services.  

2. **Circuit Breaker** – Encapsulated inside `LLMService` (see `lib/llm/llm‑service.ts`).  A finite‑state‑machine tracks the health of each LLM provider, moving between **closed**, **open**, and **half‑open** states based on time‑outs and error counts.  When the breaker is open, further requests are short‑circuited, preventing cascading latency spikes.  

3. **Facade (Provider‑Agnostic) Pattern** – `LLMService` presents a single `predict`, `getMode`, and related methods that hide the concrete provider implementations (e.g., Anthropic, DMR, mock).  Mode routing and caching are performed inside the façade, allowing the rest of DockerizedServices to remain oblivious to provider details.  

The **GraphDatabaseAdapter** adds a fourth pattern – a **Adapter** – that normalises interactions with the underlying graph store, enabling the `CodeGraphAgent` to query and mutate the knowledge graph without coupling to a specific database technology.  

Interaction flow is straightforward: the `ServiceStarter` script boots each child service, each of which may invoke `LLMService` for language‑model calls or the `GraphDatabaseAdapter` for graph queries.  Because the start‑up script enforces timeout protection (also via `setTimeout`), a service that hangs is marked as failed and the retry logic is triggered, keeping the overall container from stalling indefinitely.

## Implementation Details  

### Service‑starter.js  
* **Retry logic** – A recursive helper receives the current attempt count, computes a back‑off delay (`baseDelay * 2^attempt`), and schedules the next attempt with `setTimeout`.  The maximum attempts and base delay are configurable via environment variables or a JSON config file.  
* **Timeout protection** – For each launch attempt a separate `setTimeout` acts as a watchdog.  If the service reports success before the watchdog fires, the timer is cleared; otherwise the watchdog invokes the retry routine.  

### lib/llm/llm‑service.ts – LLMService  
* **Facade methods** – `predict(input)`, `getMode()`, and internal helpers (`routeToProvider`, `cacheResult`).  The façade reads the current mode from a configuration object (`this.config.llmMode`) and selects the appropriate provider implementation.  
* **Circuit breaker** – A private state machine (`this.circuitState`) holds the current breaker state.  Transition rules are based on response latency and error thresholds; a timeout triggers an **open** state, after a cool‑down period a **half‑open** probe is sent, and success returns the breaker to **closed**.  
* **Caching** – Results are stored in an in‑memory map keyed by a hash of the input; cache hits bypass the provider call, reducing latency and external load.  

### GraphDatabaseAdapter (used by CodeGraphAgent)  
* Provides methods such as `queryGraph(cypher)` and `mutateGraph(payload)`.  The adapter abstracts the underlying graph engine (e.g., Neo4j, Graphology+LevelDB) so that `CodeGraphAgent` can focus on semantic analysis logic.  

### CodeGraphAgent (integrations/mcp-server-semantic-analysis/src/agents/CodeGraphAgent.ts)  
* Calls `this.graphAdapter.queryGraph(...)` to retrieve code‑relationship data needed for constraint monitoring and semantic analysis.  The agent does not reference any concrete database driver, relying entirely on the adapter’s contract.  

## Integration Points  

* **Parent – Coding**: DockerizedServices is one of eight sibling components under the *Coding* root.  It shares the same resilience philosophy (retry‑with‑backoff, circuit breaking) seen in siblings such as **Trajectory** (which also uses a back‑off retry in its `SpecstoryAdapter`).  
* **Siblings** – The **LLMAbstraction** component also defines a façade around LLM providers, mirroring the pattern used in DockerizedServices.  This duplication suggests a shared architectural language across the codebase, making cross‑component refactoring feasible.  
* **Children** – Each child (`SemanticAnalysisService`, `ConstraintMonitoringService`, `CodeGraphService`) is started by `ServiceStarter` and inherits the same start‑up safeguards.  They may each invoke `LLMService` for model inference or the `GraphDatabaseAdapter` for graph queries, reinforcing a consistent dependency graph.  
* **External services** – Optional LLM providers (public APIs, local models) and the graph database are external dependencies.  Their availability is guarded by the circuit breaker (LLM) and the adapter (graph), ensuring DockerizedServices can degrade gracefully when these services are unreachable.  

## Usage Guidelines  

1. **Configuration First** – All mode selection, retry limits, back‑off base delay, and circuit‑breaker thresholds are driven by configuration files or environment variables.  Developers should never hard‑code these values; instead, expose them via the component’s `config` object.  
2. **Do Not Bypass the Facade** – Direct calls to a concrete LLM provider or to the raw graph driver break the provider‑agnostic contract and will cause future integration failures.  Always go through `LLMService.predict` (or the appropriate façade method) and `GraphDatabaseAdapter` methods.  
3. **Respect Timeouts** – When extending a child service, ensure any long‑running operation respects the timeout semantics enforced by `service‑starter.js`.  Use the same `setTimeout`‑based watchdog pattern if you need custom sub‑tasks.  
4. **Handle Circuit‑Breaker States** – When consuming `LLMService`, be prepared for `predict` to reject with a “circuit open” error.  Implement fallback logic (e.g., return a mock response or queue the request) rather than retrying immediately, which would defeat the breaker’s purpose.  
5. **Testing with Mock Mode** – The configuration supports a `mock` LLM mode.  Unit tests should set the mode to `mock` to avoid external API calls, leveraging the built‑in caching and deterministic responses.  

---

### 1. Architectural patterns identified  
* Retry‑with‑Backoff (exponential)  
* Timeout protection for service start‑up  
* Circuit Breaker (finite state machine)  
* Facade (provider‑agnostic LLM interface)  
* Adapter (GraphDatabaseAdapter)  

### 2. Design decisions and trade‑offs  
* **Resilience vs. start‑up latency** – Adding retries and timeouts prevents endless loops but can increase the time before a container reports “ready”.  
* **Provider agnosticism** – The façade enables swapping LLM providers without code changes, at the cost of an additional abstraction layer and potential performance overhead from routing and caching logic.  
* **Stateful circuit breaker** – Guarantees protection from cascading failures, yet introduces complexity in state persistence (in‑memory only) which resets on container restart.  

### 3. System structure insights  
DockerizedServices is a container‑level orchestrator that boots four child services, each of which may depend on LLM inference or graph queries.  All external interactions funnel through well‑defined façade/adapter boundaries, creating a clear dependency graph: `ServiceStarter → Child Service → (LLMService ↔ Provider) / (GraphDatabaseAdapter ↔ DB)`.  

### 4. Scalability considerations  
* **Back‑off limits** keep retry storms under control when scaling many containers.  
* **Circuit breaker** prevents a surge of failing LLM calls from exhausting thread pools or network sockets.  
* Because caching is in‑process, horizontal scaling will duplicate caches; a shared external cache (e.g., Redis) would be needed for cross‑instance cache coherence.  

### 5. Maintainability assessment  
The heavy reliance on configuration‑driven patterns and clear abstraction boundaries (facade, adapter) makes the codebase **highly maintainable**.  Adding a new LLM provider or swapping the graph store requires only implementing the provider interface or adapter contract.  However, the duplicated façade logic across DockerizedServices and the sibling LLMAbstraction component suggests an opportunity to extract a shared library, reducing future maintenance overhead.


## Hierarchy Context

### Parent
- [Coding](./Coding.md) -- Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 8 major components: LiveLoggingSystem: The LiveLoggingSystem component employs a modular architecture, with classes such as the OntologyClassificationAgent (integrations/mcp-server-semantic; LLMAbstraction: The LLMAbstraction component utilizes the facade pattern, as seen in the lib/llm/llm-service.ts file, which provides a unified interface for all LLM o; DockerizedServices: The DockerizedServices component employs a robust service startup mechanism through the service-starter.js script, which implements a retry-with-backo; Trajectory: The Trajectory component's architecture is centered around the SpecstoryAdapter class in lib/integrations/specstory-adapter.js, which provides a unifi; KnowledgeManagement: The KnowledgeManagement component utilizes a Graphology+LevelDB database for persistence, which is facilitated by the GraphDatabaseAdapter class in th; CodingPatterns: The CodingPatterns component utilizes the GraphDatabaseAdapter in lib/llm/llm-service.ts for graph database interactions and data storage. This design; ConstraintSystem: The ConstraintSystem component employs the facade pattern to enable provider-agnostic model calls, as seen in the ContentValidationAgent (integrations; SemanticAnalysis: The OntologyClassificationAgent, located in integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts, utilizes a configur.

### Children
- [SemanticAnalysisService](./SemanticAnalysisService.md) -- SemanticAnalysisService employs the retry-with-backoff pattern in service-starter.js to prevent endless loops and provide graceful degradation when optional services fail.
- [ConstraintMonitoringService](./ConstraintMonitoringService.md) -- ConstraintMonitoringService uses the retry-with-backoff pattern in service-starter.js to prevent endless loops and provide graceful degradation when optional services fail.
- [CodeGraphService](./CodeGraphService.md) -- CodeGraphService employs the retry-with-backoff pattern in service-starter.js to prevent endless loops and provide graceful degradation when optional services fail.
- [ServiceStarter](./ServiceStarter.md) -- ServiceStarter employs the retry-with-backoff pattern to prevent endless loops and provide graceful degradation when optional services fail.

### Siblings
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- The LiveLoggingSystem component employs a modular architecture, with classes such as the OntologyClassificationAgent (integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts) and the LSLConfigValidator (scripts/validate-lsl-config.js) working together to provide a unified abstraction for reading and converting transcripts from different agent formats into the Live Session Logging (LSL) format. This modular approach allows for easier maintenance and updates, as individual modules can be modified or replaced without affecting the entire system. For example, the OntologyClassificationAgent uses a configuration file to classify observations and entities against the ontology system, adding ontology metadata to entities before persistence. The use of a configuration file allows for easy modification of the classification rules without requiring changes to the code.
- [LLMAbstraction](./LLMAbstraction.md) -- The LLMAbstraction component utilizes the facade pattern, as seen in the lib/llm/llm-service.ts file, which provides a unified interface for all LLM operations. This design decision allows for provider-agnostic model calls, enabling the addition or removal of providers without affecting the rest of the system. For instance, the Anthropic provider (lib/llm/providers/anthropic-provider.ts) and the DMR provider (lib/llm/providers/dmr-provider.ts) can be easily integrated or removed without modifying the core component. The facade pattern also enables the component to support multiple modes, including the mock provider (integrations/mcp-server-semantic-analysis/src/mock/llm-mock-service.ts) for testing purposes.
- [Trajectory](./Trajectory.md) -- The Trajectory component's architecture is centered around the SpecstoryAdapter class in lib/integrations/specstory-adapter.js, which provides a unified interface for interacting with the Specstory extension. This class implements multiple connection methods, including HTTP, IPC, and file watch, allowing for flexibility in how the component connects to the Specstory extension. For example, the connectViaHTTP method in lib/integrations/specstory-adapter.js uses a retry-with-backoff pattern to handle connection failures, ensuring that the component can recover from temporary network issues. The SpecstoryAdapter class also logs conversation entries via the logConversation method, which formats the entries and logs them via the Specstory extension.
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component utilizes a Graphology+LevelDB database for persistence, which is facilitated by the GraphDatabaseAdapter class in the graph-database-adapter.ts file. This adapter provides a type-safe interface for agents to interact with the central knowledge graph and implements automatic JSON export sync. For instance, the PersistenceAgent class in the persistence-agent.ts file uses the GraphDatabaseAdapter to persist entities and classify ontologies. This design decision enables lock-free architecture, allowing the component to seamlessly switch between VKB API and direct database access when the server is running or stopped.
- [CodingPatterns](./CodingPatterns.md) -- The CodingPatterns component utilizes the GraphDatabaseAdapter in lib/llm/llm-service.ts for graph database interactions and data storage. This design decision allows for a centralized and efficient management of data, promoting code quality and consistency throughout the project. By employing this adapter, the component can seamlessly interact with the graph database, enabling features such as data retrieval, storage, and querying. For instance, the LLMService class in lib/llm/llm-service.ts uses the GraphDatabaseAdapter to perform provider-agnostic model calls, demonstrating the component's ability to abstract away underlying database complexities. Furthermore, the use of this adapter facilitates collaboration among developers, as it provides a standardized interface for database interactions, making it easier for team members to understand and contribute to the codebase.
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem component employs the facade pattern to enable provider-agnostic model calls, as seen in the ContentValidationAgent (integrations/mcp-server-semantic-analysis/src/agents/content-validation-agent.ts). This allows the system to abstract away the underlying complexity of entity content validation, making it easier to switch between different validation providers. The ContentValidationAgent uses a combination of natural language processing and machine learning algorithms to validate entity content, and it also supports automatic refresh reports. This is particularly useful in the context of Claude Code sessions, where the system needs to validate code actions and file operations in real-time.
- [SemanticAnalysis](./SemanticAnalysis.md) -- The OntologyClassificationAgent, located in integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts, utilizes a configuration file to initialize the ontology system. This configuration file is crucial for the agent's functionality, as it provides the necessary information for classifying observations against the ontology. The agent's reliance on this configuration file highlights the importance of proper configuration management in the SemanticAnalysis component. Furthermore, the use of a configuration file allows for flexibility and ease of modification, as changes to the ontology system can be made by updating the configuration file without requiring modifications to the agent's code.


---

*Generated from 6 observations*
