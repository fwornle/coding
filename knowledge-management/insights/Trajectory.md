# Trajectory

**Type:** Component

The Trajectory component's architecture is centered around the SpecstoryAdapter class in lib/integrations/specstory-adapter.js, which provides a unified interface for interacting with the Specstory extension. This class implements multiple connection methods, including HTTP, IPC, and file watch, allowing for flexibility in how the component connects to the Specstory extension. For example, the connectViaHTTP method in lib/integrations/specstory-adapter.js uses a retry-with-backoff pattern to handle connection failures, ensuring that the component can recover from temporary network issues. The SpecstoryAdapter class also logs conversation entries via the logConversation method, which formats the entries and logs them via the Specstory extension.

## What It Is  

The **Trajectory** component lives under the **Coding** root of the project and is realized primarily by the `SpecstoryAdapter` class found in `lib/integrations/specstory-adapter.js`.  This class is the single point of contact between Trajectory and the external **Specstory** extension.  It supplies a **unified interface** that hides the details of how the component talks to Specstory—whether over HTTP, via an inter‑process‑communication (IPC) channel, or by watching a file‑system directory.  Every interaction is tagged with a **unique session‑ID** that is generated when a `SpecstoryAdapter` instance is constructed, allowing the system to differentiate concurrent sessions and preserve per‑session state.

## Architecture and Design  

Trajectory follows a **modular, responsibility‑segregated architecture** that is reflected in its child entities:

* **ConnectionManager** – encapsulates the three connection strategies (`connectViaHTTP`, `connectViaIPC`, `connectViaFileWatch`).  
* **LoggingMechanism** – provides the `logConversation` method that formats and forwards logs to Specstory.  
* **RetryMechanism** – implements the **retry‑with‑backoff** algorithm used by the HTTP connection path.  

The central **SpecstoryAdapter** composes these children, exposing a clean façade to the rest of the codebase.  The design deliberately avoids hard‑wiring a single transport; instead it **fails over** from HTTP → IPC → file‑watch, ensuring the component remains functional even when a particular channel is unavailable.  

The only explicit design pattern observed is the **retry‑with‑backoff** strategy, which appears both in Trajectory’s `connectViaHTTP` implementation and in the sibling **DockerizedServices** component (see its `service‑starter.js`).  This shared pattern demonstrates a system‑wide preference for graceful degradation rather than immediate failure.

## Implementation Details  

### Core class – `SpecstoryAdapter` (`lib/integrations/specstory-adapter.js`)  

* **Constructor** – generates a UUID‑style session ID and stores it for later use by all connection methods.  
* **`connectViaHTTP`** – builds a request payload, then delegates to the helper `httpRequest`.  The method wraps the request in a **retry‑with‑backoff loop**: after each failed attempt it waits an exponentially increasing delay before retrying, capping the number of retries to avoid infinite loops.  This logic protects the component from transient network glitches while preventing overload of the Specstory service.  
* **`httpRequest`** – a thin wrapper around Node’s HTTP client.  It assembles the request, sends it, and normalises error handling so that `connectViaHTTP` can focus on retry semantics.  By centralising request logic here the code eliminates duplication across potential future transport methods.  
* **`connectViaIPC`** – opens an IPC socket to the Specstory extension, using the same session ID to tag messages.  The method is invoked only when the HTTP path exhausts its retries, providing a **fallback transport** that does not depend on network reachability.  
* **`connectViaFileWatch`** – monitors a designated directory for files that represent conversation entries.  When a file appears, the adapter reads its contents and forwards them through the same logging pipeline.  This method is a last‑resort channel used when both network‑based transports are unavailable.  
* **`logConversation`** – receives a raw conversation entry, formats it according to Specstory’s logging schema, and forwards the formatted payload via the currently active transport (HTTP, IPC, or file‑watch).  The method is invoked by all three connection strategies, guaranteeing a consistent logging experience regardless of how the component is connected.  

### Child modules  

* **ConnectionManager** – essentially the trio of connection methods described above; it isolates transport concerns from higher‑level business logic.  
* **LoggingMechanism** – the `logConversation` implementation plus any auxiliary formatting utilities (not detailed in the observations but implied).  
* **RetryMechanism** – the back‑off algorithm embedded in `connectViaHTTP`; it tracks attempt count, computes delay (typically exponential), and respects a configurable maximum retry limit.  

All three children are instantiated inside the `SpecstoryAdapter` constructor, reinforcing the “single façade” principle.

## Integration Points  

Trajectory does not operate in isolation.  Its **parent** component, **Coding**, aggregates eight major subsystems, and Trajectory shares several cross‑cutting concerns with its **siblings**:

* **DockerizedServices** – also uses a retry‑with‑backoff pattern (in `service‑starter.js`).  The similarity suggests that a shared utility library for back‑off could be extracted in the future.  
* **LiveLoggingSystem** – provides a broader logging infrastructure; while Trajectory logs via Specstory, both subsystems ultimately feed into the same observability pipeline, implying that log formats may need to stay compatible.  
* **LLMAbstraction** – employs a façade (`lib/llm/llm-service.ts`) to hide provider details.  Trajectory mirrors this approach by hiding transport specifics behind `SpecstoryAdapter`.  

Externally, Trajectory’s **integration surface** consists of:

* **Specstory extension** – the remote service that receives HTTP/IPC/file‑watch messages.  The contract is defined by the payload format expected by `logConversation`.  
* **Node’s HTTP and IPC APIs** – used directly by `httpRequest` and `connectViaIPC`.  
* **File system watcher** – likely built on `fs.watch` or similar, used in `connectViaFileWatch`.  

No other internal modules are referenced in the observations, but the presence of a **session ID** suggests that downstream consumers (e.g., a UI or analytics service) may query logs per session.

## Usage Guidelines  

1. **Instantiate via the façade** – Always create a `new SpecstoryAdapter()` rather than calling the connection methods directly.  The constructor guarantees a unique session ID and wires the three child modules together.  
2. **Prefer HTTP, fallback automatically** – Call `adapter.connectViaHTTP()` first; the internal retry‑with‑backoff will attempt reconnection a configurable number of times.  If it ultimately fails, the adapter will transparently switch to `connectViaIPC`, and finally to `connectViaFileWatch`.  Developers should not manually invoke the fallback methods unless a very specific scenario demands it.  
3. **Log through `logConversation`** – Pass raw conversation objects to this method; it handles formatting and routing.  Do not duplicate formatting logic elsewhere, as the adapter may evolve the schema to stay in sync with Specstory.  
4. **Respect back‑off limits** – The retry mechanism is deliberately bounded; altering its limits should be done through the adapter’s configuration (if exposed) rather than by editing the loop directly, to avoid destabilising the system.  
5. **Session‑ID awareness** – When correlating logs or debugging multi‑user scenarios, always include the session ID that the adapter generated.  This ID is automatically attached to every outbound request, but external tooling must be aware of it to filter or aggregate data correctly.  

## Summary of Key Insights  

| Item | Insight |
|------|---------|
| **Architectural patterns identified** | Unified façade (`SpecstoryAdapter`), modular responsibility segregation (ConnectionManager, LoggingMechanism, RetryMechanism), **retry‑with‑backoff** for resilience. |
| **Design decisions and trade‑offs** | Multiple transport options (HTTP → IPC → file‑watch) give high availability at the cost of added complexity in connection management; retry‑with‑backoff protects against transient failures but introduces latency during back‑off periods. |
| **System structure insights** | Trajectory sits under the **Coding** parent, sharing a resilience‑first philosophy with siblings like **DockerizedServices**.  Its children encapsulate distinct concerns, enabling independent testing and potential reuse (e.g., a shared back‑off library). |
| **Scalability considerations** | The unique session ID enables concurrent sessions without cross‑talk, supporting multi‑user or parallel processing scenarios.  Because each session maintains its own transport state, the component can scale horizontally as more adapters are instantiated. |
| **Maintainability assessment** | Clear separation of concerns and a single entry point (`SpecstoryAdapter`) make the codebase easy to understand.  However, the duplicated retry logic in both Trajectory and DockerizedServices suggests an opportunity to extract a common utility, which would further improve maintainability. |

By grounding every observation in concrete file paths (`lib/integrations/specstory-adapter.js`) and method names, this document provides a reliable reference for developers who need to extend, debug, or integrate the **Trajectory** component within the broader **Coding** ecosystem.


## Hierarchy Context

### Parent
- [Coding](./Coding.md) -- Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 8 major components: LiveLoggingSystem: The LiveLoggingSystem component employs a modular architecture, with classes such as the OntologyClassificationAgent (integrations/mcp-server-semantic; LLMAbstraction: The LLMAbstraction component utilizes the facade pattern, as seen in the lib/llm/llm-service.ts file, which provides a unified interface for all LLM o; DockerizedServices: The DockerizedServices component employs a robust service startup mechanism through the service-starter.js script, which implements a retry-with-backo; Trajectory: The Trajectory component's architecture is centered around the SpecstoryAdapter class in lib/integrations/specstory-adapter.js, which provides a unifi; KnowledgeManagement: The KnowledgeManagement component utilizes a Graphology+LevelDB database for persistence, which is facilitated by the GraphDatabaseAdapter class in th; CodingPatterns: The CodingPatterns component utilizes the GraphDatabaseAdapter in lib/llm/llm-service.ts for graph database interactions and data storage. This design; ConstraintSystem: The ConstraintSystem component employs the facade pattern to enable provider-agnostic model calls, as seen in the ContentValidationAgent (integrations; SemanticAnalysis: The OntologyClassificationAgent, located in integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts, utilizes a configur.

### Children
- [ConnectionManager](./ConnectionManager.md) -- ConnectionManager uses a retry-with-backoff pattern in connectViaHTTP method in lib/integrations/specstory-adapter.js to handle connection failures.
- [LoggingMechanism](./LoggingMechanism.md) -- LoggingMechanism uses the logConversation method in lib/integrations/specstory-adapter.js to format conversation entries and log them via the Specstory extension.
- [RetryMechanism](./RetryMechanism.md) -- RetryMechanism uses a retry-with-backoff pattern in connectViaHTTP method in lib/integrations/specstory-adapter.js to handle connection failures.
- [SpecstoryAdapter](./SpecstoryAdapter.md) -- SpecstoryAdapter provides a unified interface for interacting with the Specstory extension, including connection methods and logging.

### Siblings
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- The LiveLoggingSystem component employs a modular architecture, with classes such as the OntologyClassificationAgent (integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts) and the LSLConfigValidator (scripts/validate-lsl-config.js) working together to provide a unified abstraction for reading and converting transcripts from different agent formats into the Live Session Logging (LSL) format. This modular approach allows for easier maintenance and updates, as individual modules can be modified or replaced without affecting the entire system. For example, the OntologyClassificationAgent uses a configuration file to classify observations and entities against the ontology system, adding ontology metadata to entities before persistence. The use of a configuration file allows for easy modification of the classification rules without requiring changes to the code.
- [LLMAbstraction](./LLMAbstraction.md) -- The LLMAbstraction component utilizes the facade pattern, as seen in the lib/llm/llm-service.ts file, which provides a unified interface for all LLM operations. This design decision allows for provider-agnostic model calls, enabling the addition or removal of providers without affecting the rest of the system. For instance, the Anthropic provider (lib/llm/providers/anthropic-provider.ts) and the DMR provider (lib/llm/providers/dmr-provider.ts) can be easily integrated or removed without modifying the core component. The facade pattern also enables the component to support multiple modes, including the mock provider (integrations/mcp-server-semantic-analysis/src/mock/llm-mock-service.ts) for testing purposes.
- [DockerizedServices](./DockerizedServices.md) -- The DockerizedServices component employs a robust service startup mechanism through the service-starter.js script, which implements a retry-with-backoff pattern to prevent endless loops and provide graceful degradation when optional services fail. This pattern is crucial in ensuring that the services can recover from temporary failures and maintain overall system stability. The service-starter.js script also utilizes exponential backoff to gradually increase the delay between retries, reducing the likelihood of overwhelming the system with repeated requests. For instance, in the service-starter.js file, the retry logic is implemented using a combination of setTimeout and a recursive function call, allowing for a configurable number of retries and a backoff strategy.
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component utilizes a Graphology+LevelDB database for persistence, which is facilitated by the GraphDatabaseAdapter class in the graph-database-adapter.ts file. This adapter provides a type-safe interface for agents to interact with the central knowledge graph and implements automatic JSON export sync. For instance, the PersistenceAgent class in the persistence-agent.ts file uses the GraphDatabaseAdapter to persist entities and classify ontologies. This design decision enables lock-free architecture, allowing the component to seamlessly switch between VKB API and direct database access when the server is running or stopped.
- [CodingPatterns](./CodingPatterns.md) -- The CodingPatterns component utilizes the GraphDatabaseAdapter in lib/llm/llm-service.ts for graph database interactions and data storage. This design decision allows for a centralized and efficient management of data, promoting code quality and consistency throughout the project. By employing this adapter, the component can seamlessly interact with the graph database, enabling features such as data retrieval, storage, and querying. For instance, the LLMService class in lib/llm/llm-service.ts uses the GraphDatabaseAdapter to perform provider-agnostic model calls, demonstrating the component's ability to abstract away underlying database complexities. Furthermore, the use of this adapter facilitates collaboration among developers, as it provides a standardized interface for database interactions, making it easier for team members to understand and contribute to the codebase.
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem component employs the facade pattern to enable provider-agnostic model calls, as seen in the ContentValidationAgent (integrations/mcp-server-semantic-analysis/src/agents/content-validation-agent.ts). This allows the system to abstract away the underlying complexity of entity content validation, making it easier to switch between different validation providers. The ContentValidationAgent uses a combination of natural language processing and machine learning algorithms to validate entity content, and it also supports automatic refresh reports. This is particularly useful in the context of Claude Code sessions, where the system needs to validate code actions and file operations in real-time.
- [SemanticAnalysis](./SemanticAnalysis.md) -- The OntologyClassificationAgent, located in integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts, utilizes a configuration file to initialize the ontology system. This configuration file is crucial for the agent's functionality, as it provides the necessary information for classifying observations against the ontology. The agent's reliance on this configuration file highlights the importance of proper configuration management in the SemanticAnalysis component. Furthermore, the use of a configuration file allows for flexibility and ease of modification, as changes to the ontology system can be made by updating the configuration file without requiring modifications to the agent's code.


---

*Generated from 6 observations*
