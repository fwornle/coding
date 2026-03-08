# CodingPatterns

**Type:** Component

The CodingPatterns component uses the CodeGraphAgent and InsightGenerator classes in integrations/mcp-server-semantic-analysis/src/ for code graph analysis and insight generation. This design decision enables the component to analyze code structures and generate actionable insights, promoting code quality and maintainability. The CodeGraphAgent class provides a framework for analyzing code graphs, allowing developers to write custom analysis logic and generate insights. The InsightGenerator class, on the other hand, takes the output of the CodeGraphAgent and generates human-readable insights, providing developers with a clear understanding of code quality and maintainability issues. For example, the CodeGraphAgent class can be used to analyze code graphs and identify patterns and anti-patterns, while the InsightGenerator class can be used to generate insights and recommendations for improving code quality.

## What It Is  

The **CodingPatterns** component lives primarily in the `lib/llm/llm‑service.ts` file, where the `LLMService` class is defined, and it reaches into several other parts of the codebase to fulfil its responsibilities.  It is a **Component** that supplies analysis‑driven insights about coding practices (design patterns, code quality, conventions) by orchestrating large‑language‑model (LLM) calls, graph‑database interactions, and semantic‑analysis agents.  Its children—`DesignPatternAnalyzer`, `CodeQualityEvaluator`, `CodingConventionManager`, `GraphDatabaseManager`, and the `LLMService` itself—are thin, purpose‑specific wrappers that all depend on the same underlying infrastructure.  Because `CodingPatterns` is a child of the top‑level **Coding** component, it inherits the project‑wide conventions for data persistence, service start‑up, and ontology‑based reasoning that are shared across siblings such as **LiveLoggingSystem**, **LLMAbstraction**, **DockerizedServices**, **Trajectory**, **KnowledgeManagement**, **ConstraintSystem**, and **SemanticAnalysis**.

## Architecture and Design  

The architecture of **CodingPatterns** is deliberately layered and highly modular.  At the core sits the **Facade pattern** implemented by `LLMService` (see `lib/llm/llm-service.ts`).  `LLMService` hides the details of multiple LLM providers (e.g., Specstory, Anthropic, DMR) and presents a single, provider‑agnostic API to its children.  This mirrors the same façade used by the sibling **LLMAbstraction** component, reinforcing a consistent entry point for all model interactions across the codebase.  

Data persistence is handled through the **GraphDatabaseAdapter**, also referenced from `lib/llm/llm-service.ts`.  By routing every read/write operation through this adapter, the component achieves a **centralized data‑management** strategy that aligns with the approach taken by the **KnowledgeManagement** sibling (which also uses the adapter for a Graphology+LevelDB store).  This guarantees type‑safe, lock‑free access to the underlying knowledge graph and simplifies future migrations or provider swaps.  

Hook‑based validation is provided by the **HookManager** (`lib/agent‑api/hooks/hook‑manager.js`).  The manager registers and executes custom validation hooks before insight generation, guaranteeing that inputs conform to project‑wide standards.  Because the manager is a shared utility, any new hook added for `CodingPatterns` automatically becomes available to other components that also import `HookManager`.  

Robust service start‑up follows the **retry‑with‑backoff** pattern embodied in `ServiceStarter` (`lib/service‑starter.js`).  The component’s initialization code (e.g., establishing connections to the graph database or loading ontology files) is wrapped in this mechanism, ensuring that transient failures do not cause a hard crash.  This pattern is identical to the one used by the **DockerizedServices** sibling, providing a uniform resilience strategy across the system.  

Finally, **semantic analysis** is injected via `OntologyManager`, `CodeGraphAgent`, and `InsightGenerator` located in `integrations/mcp‑server‑semantic‑analysis/src/`.  These classes together build a knowledge‑graph representation of the source code, run custom graph‑based analyses, and translate raw graph data into human‑readable recommendations.  Their placement inside the **SemanticAnalysis** sibling underscores a clear separation of concerns: ontology handling lives outside the core `CodingPatterns` code but is tightly coupled through well‑defined interfaces.

## Implementation Details  

1. **LLMService (Facade)** – Defined in `lib/llm/llm-service.ts`, this class exposes methods such as `callModel`, `generateInsight`, and `storeResult`.  Internally it selects a provider implementation (e.g., `lib/llm/providers/anthropic-provider.ts` or the mock service in `integrations/mcp‑server‑semantic‑analysis/src/mock/llm‑mock‑service.ts`) based on configuration, then forwards the request.  By delegating to the provider, `LLMService` remains oblivious to authentication, request formatting, or response parsing details.  

2. **GraphDatabaseAdapter** – Also imported in `llm-service.ts`, the adapter encapsulates all CRUD operations on the underlying Graphology+LevelDB store.  It offers methods like `saveNode`, `queryEdges`, and `exportJSON`.  Because every child (`DesignPatternAnalyzer`, `CodeQualityEvaluator`, etc.) receives a reference to the same adapter instance, data consistency is guaranteed and duplicate persistence logic is eliminated.  

3. **HookManager** – Exported from `lib/agent‑api/hooks/hook‑manager.js`, the class maintains a registry of hook callbacks.  Typical usage in `CodingPatterns` looks like:  
   ```js
   const hookMgr = new HookManager();
   hookMgr.register('preInsight', validateCodingConventions);
   hookMgr.execute('preInsight', payload);
   ```  
   This pattern enables developers to inject new validation rules without touching the core insight generation pipeline.  

4. **ServiceStarter (Retry‑with‑Backoff)** – The `ServiceStarter` class in `lib/service‑starter.js` wraps asynchronous initialization steps with an exponential backoff algorithm.  A simplified flow is:  
   ```js
   async function start() {
     await retryWithBackoff(() => graphAdapter.connect(), { maxAttempts: 5 });
   }
   ```  
   The backoff parameters are configurable, allowing the component to adapt to different deployment environments (local dev, CI, production).  

5. **Semantic Analysis Pipeline** – `OntologyManager` (`integrations/mcp‑server‑semantic‑analysis/src/ontology-manager.ts`) loads and manages ontology files that describe programming constructs.  `CodeGraphAgent` consumes these ontologies to construct a code graph from the source repository, exposing methods like `analyzePatterns` and `detectAntiPatterns`.  The resulting graph fragments are fed into `InsightGenerator`, which formats them into markdown or JSON insight payloads that downstream tools (e.g., the UI or reporting scripts) can consume.  

All child components (`DesignPatternAnalyzer`, `CodeQualityEvaluator`, etc.) are thin wrappers that call `LLMService` for LLM‑driven reasoning and then pass the LLM’s raw output to `InsightGenerator` for final formatting.  This layered approach keeps each class focused on a single responsibility.

## Integration Points  

- **Parent – Coding**: `CodingPatterns` inherits the global configuration and logging facilities provided by the root **Coding** component.  Shared utilities such as the logger (`lib/logger.ts`) and environment loader are used throughout the component, ensuring consistent observability.  

- **Siblings**:  
  * **LiveLoggingSystem** – Both components rely on `HookManager` for validation; a hook that validates live‑session logs can be reused by `CodingPatterns` to enforce the same content standards.  
  * **LLMAbstraction** – The façade implementation in `LLMService` mirrors the one in `LLMAbstraction`, allowing developers to swap the underlying provider across both components without code changes.  
  * **DockerizedServices** – The `ServiceStarter` retry‑with‑backoff logic is shared, so any configuration tweaks (e.g., backoff multiplier) propagate automatically to `CodingPatterns`.  
  * **Trajectory** – While `Trajectory` focuses on Specstory integration, both components use the same `SpecstoryAdapter`‑style pattern for external service communication, illustrating a reusable “adapter” idiom across the codebase.  
  * **KnowledgeManagement** – Directly shares the `GraphDatabaseAdapter`, meaning that any schema evolution in the knowledge graph is instantly visible to `CodingPatterns`.  
  * **ConstraintSystem** – Also uses the façade pattern for model calls; the two components could coordinate to avoid duplicate LLM requests when both need the same analysis result.  
  * **SemanticAnalysis** – Provides the ontology and graph‑analysis classes (`OntologyManager`, `CodeGraphAgent`, `InsightGenerator`) that `CodingPatterns` consumes to turn raw code graphs into actionable recommendations.  

- **Children**: Each child component receives the same injected instances of `LLMService`, `GraphDatabaseAdapter`, and `HookManager`.  This guarantees that all analysis sub‑modules operate under identical configuration and share the same persistence layer, simplifying testing and deployment.

## Usage Guidelines  

1. **Instantiate via the Component Factory** – All entry points should obtain an instance of `LLMService` from the central factory (`lib/llm/llm-factory.ts`).  This guarantees that the same provider configuration and `GraphDatabaseAdapter` are used across the component and its children.  

2. **Register Hooks Early** – Before invoking any analysis method, register any custom validation hooks with `HookManager`.  Hooks should be pure functions that either return a boolean or throw an error; they run synchronously in the `preInsight` phase to prevent unnecessary LLM calls on invalid input.  

3. **Respect the Retry Policy** – When adding new asynchronous initialization steps (e.g., loading additional ontologies), wrap them with `ServiceStarter.retryWithBackoff`.  Do not bypass the backoff logic, as this would re‑introduce the risk of cascading failures that the pattern is designed to mitigate.  

4. **Leverage the Facade for Provider Changes** – If a new LLM provider must be added, implement the provider interface (`call`, `parseResponse`) and register it in the `LLMService` provider map.  No changes are required in any child analyzer or the insight generation pipeline.  

5. **Persist Insight Results via the Adapter** – All generated insights should be stored using `GraphDatabaseAdapter.saveNode` (or a higher‑level wrapper in `GraphDatabaseManager`).  Direct file‑system writes bypass the central knowledge graph and break the lock‑free guarantees provided by the adapter.  

6. **Testing** – Use the mock LLM service located at `integrations/mcp‑server‑semantic‑analysis/src/mock/llm‑mock‑service.ts` to stub out external calls during unit tests.  Because the facade abstracts the provider, swapping the mock implementation requires only a configuration change.  

---

### 1. Architectural patterns identified  
* Facade pattern – `LLMService` provides a unified LLM interface.  
* Retry‑with‑backoff – `ServiceStarter` ensures resilient service start‑up.  
* Centralized Hook Management – `HookManager` implements a plug‑in validation framework.  
* Adapter pattern – `GraphDatabaseAdapter` abstracts the underlying Graphology+LevelDB store.  
* Semantic‑analysis pipeline – `OntologyManager`, `CodeGraphAgent`, and `InsightGenerator` collaborate to transform code graphs into insights.

### 2. Design decisions and trade‑offs  
* **Facade + Adapter**: simplifies consumer code and enables provider/DB swaps, at the cost of an additional indirection layer that must be kept in sync with provider APIs.  
* **Retry‑with‑backoff**: improves availability but introduces latency during start‑up; the backoff parameters must be tuned to avoid overly long waits in CI pipelines.  
* **HookManager**: offers extensibility without code duplication, yet excessive or poorly ordered hooks can degrade performance.  
* **Shared GraphDatabaseAdapter**: ensures data consistency across components, but creates a single point of contention if the underlying LevelDB store becomes a bottleneck under heavy write loads.

### 3. System structure insights  
* `CodingPatterns` sits under the root **Coding** component and shares infrastructure (logging, config, adapters) with all sibling components.  
* Its children are thin, purpose‑specific wrappers that all converge on the same three core services (`LLMService`, `GraphDatabaseAdapter`, `HookManager`).  
* The semantic‑analysis sub‑package lives outside the component but is tightly coupled through well‑defined interfaces, illustrating a clean “integration” boundary.

### 4. Scalability considerations  
* **Horizontal scaling** of LLM calls is straightforward because the façade abstracts provider endpoints; additional worker processes can be added without code changes.  
* **Graph database scalability** depends on the Graphology+LevelDB implementation; sharding or migrating to a more scalable graph store would require changes only in `GraphDatabaseAdapter`.  
* **Hook execution** should remain lightweight; heavy validation logic may need to be off‑loaded to asynchronous workers to avoid blocking the insight pipeline.

### 5. Maintainability assessment  
The component’s heavy reliance on well‑defined patterns (facade, adapter, retry‑with‑backoff, hook manager) yields high maintainability: developers can reason about each concern in isolation, replace providers or storage back‑ends with minimal ripple effects, and add new validation rules without touching core logic.  The primary maintenance risk lies in keeping the façade and adapter contracts up‑to‑date with external provider changes and ensuring that the backoff configuration remains appropriate for all deployment environments.  Overall, the architecture promotes clear separation of concerns, testability (via the mock LLM service), and consistent conventions across the broader **Coding** ecosystem.


## Hierarchy Context

### Parent
- [Coding](./Coding.md) -- Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 8 major components: LiveLoggingSystem: The LiveLoggingSystem component employs a modular architecture, with classes such as the OntologyClassificationAgent (integrations/mcp-server-semantic; LLMAbstraction: The LLMAbstraction component utilizes the facade pattern, as seen in the lib/llm/llm-service.ts file, which provides a unified interface for all LLM o; DockerizedServices: The DockerizedServices component employs a robust service startup mechanism through the service-starter.js script, which implements a retry-with-backo; Trajectory: The Trajectory component's architecture is centered around the SpecstoryAdapter class in lib/integrations/specstory-adapter.js, which provides a unifi; KnowledgeManagement: The KnowledgeManagement component utilizes a Graphology+LevelDB database for persistence, which is facilitated by the GraphDatabaseAdapter class in th; CodingPatterns: The CodingPatterns component utilizes the GraphDatabaseAdapter in lib/llm/llm-service.ts for graph database interactions and data storage. This design; ConstraintSystem: The ConstraintSystem component employs the facade pattern to enable provider-agnostic model calls, as seen in the ContentValidationAgent (integrations; SemanticAnalysis: The OntologyClassificationAgent, located in integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts, utilizes a configur.

### Children
- [DesignPatternAnalyzer](./DesignPatternAnalyzer.md) -- DesignPatternAnalyzer uses the LLMService class in lib/llm/llm-service.ts to perform provider-agnostic model calls, demonstrating its ability to abstract away underlying database complexities.
- [CodeQualityEvaluator](./CodeQualityEvaluator.md) -- CodeQualityEvaluator uses the LLMService class in lib/llm/llm-service.ts to perform provider-agnostic model calls, demonstrating its ability to abstract away underlying database complexities.
- [CodingConventionManager](./CodingConventionManager.md) -- CodingConventionManager uses the LLMService class in lib/llm/llm-service.ts to perform provider-agnostic model calls, demonstrating its ability to abstract away underlying database complexities.
- [GraphDatabaseManager](./GraphDatabaseManager.md) -- GraphDatabaseManager uses the LLMService class in lib/llm/llm-service.ts to perform provider-agnostic model calls, demonstrating its ability to abstract away underlying database complexities.
- [LLMService](./LLMService.md) -- LLMService uses the GraphDatabaseAdapter to interact with the graph database, enabling features such as data retrieval, storage, and querying.

### Siblings
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- The LiveLoggingSystem component employs a modular architecture, with classes such as the OntologyClassificationAgent (integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts) and the LSLConfigValidator (scripts/validate-lsl-config.js) working together to provide a unified abstraction for reading and converting transcripts from different agent formats into the Live Session Logging (LSL) format. This modular approach allows for easier maintenance and updates, as individual modules can be modified or replaced without affecting the entire system. For example, the OntologyClassificationAgent uses a configuration file to classify observations and entities against the ontology system, adding ontology metadata to entities before persistence. The use of a configuration file allows for easy modification of the classification rules without requiring changes to the code.
- [LLMAbstraction](./LLMAbstraction.md) -- The LLMAbstraction component utilizes the facade pattern, as seen in the lib/llm/llm-service.ts file, which provides a unified interface for all LLM operations. This design decision allows for provider-agnostic model calls, enabling the addition or removal of providers without affecting the rest of the system. For instance, the Anthropic provider (lib/llm/providers/anthropic-provider.ts) and the DMR provider (lib/llm/providers/dmr-provider.ts) can be easily integrated or removed without modifying the core component. The facade pattern also enables the component to support multiple modes, including the mock provider (integrations/mcp-server-semantic-analysis/src/mock/llm-mock-service.ts) for testing purposes.
- [DockerizedServices](./DockerizedServices.md) -- The DockerizedServices component employs a robust service startup mechanism through the service-starter.js script, which implements a retry-with-backoff pattern to prevent endless loops and provide graceful degradation when optional services fail. This pattern is crucial in ensuring that the services can recover from temporary failures and maintain overall system stability. The service-starter.js script also utilizes exponential backoff to gradually increase the delay between retries, reducing the likelihood of overwhelming the system with repeated requests. For instance, in the service-starter.js file, the retry logic is implemented using a combination of setTimeout and a recursive function call, allowing for a configurable number of retries and a backoff strategy.
- [Trajectory](./Trajectory.md) -- The Trajectory component's architecture is centered around the SpecstoryAdapter class in lib/integrations/specstory-adapter.js, which provides a unified interface for interacting with the Specstory extension. This class implements multiple connection methods, including HTTP, IPC, and file watch, allowing for flexibility in how the component connects to the Specstory extension. For example, the connectViaHTTP method in lib/integrations/specstory-adapter.js uses a retry-with-backoff pattern to handle connection failures, ensuring that the component can recover from temporary network issues. The SpecstoryAdapter class also logs conversation entries via the logConversation method, which formats the entries and logs them via the Specstory extension.
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component utilizes a Graphology+LevelDB database for persistence, which is facilitated by the GraphDatabaseAdapter class in the graph-database-adapter.ts file. This adapter provides a type-safe interface for agents to interact with the central knowledge graph and implements automatic JSON export sync. For instance, the PersistenceAgent class in the persistence-agent.ts file uses the GraphDatabaseAdapter to persist entities and classify ontologies. This design decision enables lock-free architecture, allowing the component to seamlessly switch between VKB API and direct database access when the server is running or stopped.
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem component employs the facade pattern to enable provider-agnostic model calls, as seen in the ContentValidationAgent (integrations/mcp-server-semantic-analysis/src/agents/content-validation-agent.ts). This allows the system to abstract away the underlying complexity of entity content validation, making it easier to switch between different validation providers. The ContentValidationAgent uses a combination of natural language processing and machine learning algorithms to validate entity content, and it also supports automatic refresh reports. This is particularly useful in the context of Claude Code sessions, where the system needs to validate code actions and file operations in real-time.
- [SemanticAnalysis](./SemanticAnalysis.md) -- The OntologyClassificationAgent, located in integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts, utilizes a configuration file to initialize the ontology system. This configuration file is crucial for the agent's functionality, as it provides the necessary information for classifying observations against the ontology. The agent's reliance on this configuration file highlights the importance of proper configuration management in the SemanticAnalysis component. Furthermore, the use of a configuration file allows for flexibility and ease of modification, as changes to the ontology system can be made by updating the configuration file without requiring modifications to the agent's code.


---

*Generated from 6 observations*
