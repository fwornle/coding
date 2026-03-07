# ConstraintSystem

**Type:** Component

The system-health-dashboard component, located in integrations/system-health-dashboard/src/components/workflow/hooks.ts, implements several hooks for managing workflow definitions, scroll preservation, node wiggle animation, and workflow layout computation. These hooks are registered with the UnifiedHookManager and are triggered by specific events, such as when a workflow definition is updated or when a node is added to the workflow. The system-health-dashboard component also utilizes the ContentValidationAgent to validate entity content against codebase references and detect staleness. The component uses the ViolationCaptureService to capture and persist constraint violations from live coding sessions. The system-health-dashboard component provides a visual representation of the workflow and allows users to interact with the workflow, which can trigger hook events and constraint validations.

## What It Is  

The **ConstraintSystem** component lives at the heart of the *Coding* parent component and is implemented across a handful of tightly‑coupled modules. Its persistence layer is the **GraphDatabaseAdapter** defined in `graphdb-adapter.ts`, which supplies CRUD operations for constraint‑validation results, entity‑refresh outcomes, hook configurations and violation records. Validation logic is performed by the **ContentValidationAgent** (`integrations/mcp‑server‑semantic‑analysis/src/agents/content-validation-agent.ts`), which extracts code‑base references using the patterns declared in `reference‑extraction‑patterns.ts`. Hook orchestration is handled by the **UnifiedHookManager** (`lib/agent-api/hooks/hook-manager.js`), while configuration merging is performed by the **HookConfigLoader** (`lib/agent-api/hooks/hook-config.js`). The component also exposes a set of TypeScript interfaces (`constraint‑system‑interfaces.ts`) that define the shape of validation results, entity‑refresh results and hook configurations. Together these pieces enable downstream consumers—most notably the **system‑health‑dashboard** (`integrations/system‑health‑dashboard/src/components/workflow/hooks.ts`) and the **ViolationCaptureService** (`scripts/violation‑capture‑service.js`)—to react to constraint events, visualise workflow state and persist live‑coding violations.

---

## Architecture and Design  

The architecture of **ConstraintSystem** is **modular** and **adapter‑centric**. The **GraphDatabaseAdapter** acts as an *Adapter* that abstracts the underlying graph‑database (Graphology + LevelDB) behind a simple, typed API (`createConstraintValidationResult`, `createHookConfiguration`, `createConstraintViolation`, `createNode`). This isolates the rest of the system from storage‑specific concerns and mirrors the approach used by the sibling **KnowledgeManagement** component, which also relies on a graph‑database adapter for persistence.  

Event propagation follows the classic **Observer** (publish‑subscribe) pattern. The **UnifiedHookManager** maintains a registry of handlers keyed by event type; components such as the **system‑health‑dashboard** register callbacks for workflow‑related events (definition updates, node additions, scroll preservation, etc.). When an agent—e.g., the **ContentValidationAgent** or **ViolationCaptureService**—detects a condition (stale reference, constraint violation), it dispatches a hook event through the manager, allowing any interested subscriber to react. The manager also supports handler removal, which is essential for components that have a limited lifecycle.  

The **ContentValidationAgent** demonstrates a *Strategy*‑like use of pattern collections. Reference extraction is driven by two pattern sets—`filePathPatterns` and `commandPatterns`—defined in `reference‑extraction‑patterns.ts`. By externalising these patterns, the agent can be extended or customised without touching its core logic, a design decision that promotes flexibility and aligns with the modular philosophy seen across the **SemanticAnalysis** sibling (where each agent handles a distinct responsibility).  

Finally, the **ViolationCaptureService** embodies a *Service* pattern: it is a self‑contained script that orchestrates persistence (via the GraphDatabaseAdapter), configuration loading (HookConfigLoader) and event dispatch (UnifiedHookManager). Its exposure of query APIs for violation data further decouples data retrieval from the capture workflow, enabling downstream analytics without coupling to the capture implementation.

---

## Implementation Details  

### GraphDatabaseAdapter (`graphdb-adapter.ts`)  
The adapter exports a suite of async methods that translate high‑level domain actions into graph‑database mutations.  
* `createConstraintValidationResult(result: ValidationResultSet)`: builds a node labelled `ConstraintValidationResult` and links it to the validated entity.  
* `createHookConfiguration(config: HookConfig)`: persists hook metadata, enabling dynamic discovery of registered handlers.  
* `createConstraintViolation(violation: ViolationRecord)`: stores live‑coding violations, attaching timestamps and source references.  
All methods ultimately call a lower‑level `createNode` helper that interacts with Graphology’s `addNode` API and ensures the graph is synchronised to the JSON export used by the **KnowledgeManagement** component.

### ContentValidationAgent (`integrations/mcp‑server‑semantic‑analysis/src/agents/content-validation-agent.ts`)  
The agent receives an entity’s content, runs `extractReferences(content, filePathPatterns, commandPatterns)` (patterns sourced from `reference‑extraction‑patterns.ts`), and validates each reference against the current codebase snapshot. Stale references trigger a call to `UnifiedHookManager.dispatch('referenceStale', payload)`. The agent also invokes `HookConfigLoader.load()` to merge user‑level and project‑level hook configurations, ensuring that any custom staleness handlers are honoured.

### UnifiedHookManager (`lib/agent-api/hooks/hook-manager.js`)  
The manager maintains an internal map: `{ eventType → [{handler, priority}] }`. Registration is performed via `register(eventType, handler, priority?)`, while removal uses `unregister(eventType, handler)`. Dispatching respects handler priority, iterating from highest to lowest, and supports asynchronous handlers by awaiting each promise before proceeding. This deterministic ordering is leveraged by the **system‑health‑dashboard** to guarantee that layout computation occurs after node‑wiggle animations have been applied.

### HookConfigLoader (`lib/agent-api/hooks/hook-config.js`)  
The loader reads two JSON/YAML files—`userHooks.json` and `projectHooks.json`—merges them (project config overrides user config where keys clash), and returns a consolidated `HookConfig` object. Both the **ContentValidationAgent** and **ViolationCaptureService** call this loader at start‑up, guaranteeing a consistent view of which events are of interest across the entire ConstraintSystem.

### ViolationCaptureService (`scripts/violation-capture-service.js`)  
Running as a long‑lived Node script, the service subscribes to live‑coding telemetry, constructs a `ViolationRecord` for each breach, persists it with `GraphDatabaseAdapter.createConstraintViolation`, and fires `UnifiedHookManager.dispatch('violationCaptured', record)`. It also exposes a simple query API (`getViolations(filter)`) that reads from the graph database, enabling the **system‑health‑dashboard** to render violation heat‑maps.

### Interfaces (`constraint‑system‑interfaces.ts`)  
The file defines three core contracts:  
* `ValidationResultSet` – encapsulates `entityId`, `rulesApplied`, `outcome`, and optional `details`.  
* `EntityRefreshResult` – holds `entityId`, `status`, `timestamp`.  
* `HookConfig` – describes `eventType`, `handler` (function reference), and optional `priority`.  
All consumers—agents, services, and UI components—implement these interfaces, providing compile‑time safety and clear documentation of data shape.

---

## Integration Points  

**ConstraintSystem** sits on the *Coding* backbone and interacts with several sibling components. Its persistence strategy mirrors that of **KnowledgeManagement**, both delegating to a shared `GraphDatabaseAdapter`. The **LiveLoggingSystem** provides logging utilities that the agents and services use (e.g., `integrations/mcp‑server‑semantic‑analysis/src/logging.ts`), while the **LLMAbstraction** supplies LLM‑based suggestions that may be incorporated into validation rules (though not directly observed here).  

Internally, the **ValidationModule**, **HookManagementSystem**, **ViolationPersistenceModule**, and **GraphDatabaseAdapter** form the four child modules. The **ValidationModule** calls `GraphDatabaseAdapter.createConstraintValidationResult` to store results. The **HookManagementSystem** leverages both `GraphDatabaseAdapter.createHookConfiguration` and `UnifiedHookManager` for registration and dispatch. The **ViolationPersistenceModule** uses `GraphDatabaseAdapter.createConstraintViolation` and offers query helpers consumed by the **system‑health‑dashboard**.  

External integration occurs via the **system‑health‑dashboard** component, which registers UI‑specific hooks (`workflowDefinitionUpdated`, `nodeAdded`, etc.) in `integrations/system‑health‑dashboard/src/components/workflow/hooks.ts`. This dashboard also invokes the **ContentValidationAgent** to keep entity content in sync with the codebase and the **ViolationCaptureService** to surface live‑coding infractions. All of these interactions are mediated through the well‑typed interfaces defined in `constraint‑system‑interfaces.ts`, ensuring that data contracts remain stable across component boundaries.

---

## Usage Guidelines  

1. **Persist Through the Adapter** – All constraint‑related data (validation results, hook configs, violations) must be stored using the `GraphDatabaseAdapter` methods. Direct graph‑database manipulation bypasses the abstraction and risks schema drift.  

2. **Register Hooks Early** – Components that need to react to ConstraintSystem events should call `UnifiedHookManager.register(eventType, handler, priority)` during their initialization phase (e.g., in the module’s top‑level script). Registering later may miss early events such as the first `violationCaptured`.  

3. **Leverage HookConfigLoader** – When extending or customizing hook behaviour, place JSON/YAML hook definitions in the appropriate user or project config directory. The loader automatically merges them; avoid manual merging to keep the precedence rules consistent.  

4. **Follow Interface Contracts** – Implement `ValidationResultSet`, `EntityRefreshResult` and `HookConfig` exactly as defined in `constraint‑system‑interfaces.ts`. This guarantees compatibility with the GraphDatabaseAdapter and UnifiedHookManager, and enables TypeScript to catch mismatches at compile time.  

5. **Respect Handler Priorities** – If multiple handlers listen to the same event, assign explicit priorities to control execution order. The **system‑health‑dashboard** relies on higher‑priority layout computation running after animation hooks.  

6. **Avoid Blocking Handlers** – Hook handlers may be asynchronous; always return a promise or use `async` functions. The manager awaits each handler, so long‑running synchronous code can stall the entire event pipeline.  

7. **Query via Service APIs** – For reading violation data, prefer the query functions exposed by `ViolationCaptureService` rather than raw graph queries. This encapsulates pagination, filtering and future schema changes.

---

### Architectural patterns identified  
* **Adapter Pattern** – `GraphDatabaseAdapter` abstracts the underlying graph database.  
* **Observer / Publish‑Subscribe** – `UnifiedHookManager` provides event registration, dispatch, and removal.  
* **Strategy‑like Pattern** – Reference extraction patterns (`filePathPatterns`, `commandPatterns`) are externalised, allowing the `ContentValidationAgent` to switch strategies without code changes.  
* **Service Pattern** – `ViolationCaptureService` encapsulates a cohesive set of responsibilities (capture, persist, dispatch, query).  

### Design decisions and trade‑offs  
* **Centralised hook manager** simplifies cross‑component communication but introduces a single point of coordination; careful handler prioritisation mitigates contention.  
* **Graph database persistence** offers rich relationship queries (essential for constraint graphs) at the cost of added operational complexity compared to a simple relational store.  
* **External pattern files** increase configurability but require disciplined versioning of `reference‑extraction‑patterns.ts`.  
* **Typed interfaces** enforce contract stability but add boilerplate for every consumer; the benefit is strong compile‑time safety across the multi‑language codebase.  

### System structure insights  
ConstraintSystem is a **parent‑child hierarchy** under the *Coding* root, with four child modules (ValidationModule, HookManagementSystem, ViolationPersistenceModule, GraphDatabaseAdapter). Its design mirrors sibling components (e.g., KnowledgeManagement) that also rely on graph persistence, indicating a project‑wide preference for graph‑oriented data models. The component’s internal modules are loosely coupled through well‑defined interfaces and a shared event bus, facilitating independent evolution.  

### Scalability considerations  
* **Graph database scaling** – As validation and violation nodes grow, indexing strategies (e.g., on `entityId` and `timestamp`) become critical. The adapter’s `createNode` can be extended to batch writes for high‑throughput live‑coding sessions.  
* **Hook dispatch throughput** – Since the UnifiedHookManager processes handlers sequentially per event, a surge of events could create back‑pressure. Introducing asynchronous fire‑and‑forget dispatch or sharding events by type could improve scalability.  
* **Agent parallelism** – The ContentValidationAgent could be parallelised across files using worker threads, provided the GraphDatabaseAdapter remains thread‑safe.  

### Maintainability assessment  
The component’s **modular separation** (adapter, agents, manager, service) yields high maintainability; each concern lives in its own file and can be unit‑tested in isolation. The reliance on **typed contracts** (`constraint‑system‑interfaces.ts`) further reduces regression risk. However, the **central hook manager** is a shared mutable singleton; any change to its API or event naming must be coordinated across all subscribers, demanding comprehensive integration tests. Documentation of the pattern files and hook configuration merging is essential to prevent configuration drift. Overall, the architecture balances flexibility with clear boundaries, making future extensions (new validation agents, additional hook events) straightforward while keeping the core persistence logic stable.


## Hierarchy Context

### Parent
- [Coding](./Coding.md) -- Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 8 major components: LiveLoggingSystem: The LiveLoggingSystem component employs a modular architecture, with separate modules for logging, transcript conversion, and ontology classification.; LLMAbstraction: The LLMAbstraction component's architecture is designed with modularity in mind, as seen in the separation of concerns between the LLMService (lib/llm; DockerizedServices: The DockerizedServices component utilizes a microservices architecture, with each service potentially running in its own container. This is evident in; Trajectory: The Trajectory component's architecture is designed with flexibility and fault tolerance in mind, as evident from its ability to adapt to different co; KnowledgeManagement: The KnowledgeManagement component's reliance on the GraphDatabaseAdapter (storage/graph-database-adapter.ts) for persistence and automatic JSON export; CodingPatterns: The CodingPatterns component demonstrates a modular structure through its use of various integration modules, such as integrations/browser-access/ and; ConstraintSystem: The ConstraintSystem component utilizes a GraphDatabaseAdapter for persistence, which is a crucial aspect of its architecture. This adapter is respons; SemanticAnalysis: The SemanticAnalysis component employs a modular architecture, with each agent responsible for a specific task, such as the OntologyClassificationAgen.

### Children
- [ValidationModule](./ValidationModule.md) -- ValidationModule uses the createConstraintValidationResult method in graphdb-adapter.ts to store validation results in the graph database.
- [HookManagementSystem](./HookManagementSystem.md) -- HookManagementSystem uses the createHookConfiguration method in graphdb-adapter.ts to store hook configurations in the graph database.
- [ViolationPersistenceModule](./ViolationPersistenceModule.md) -- ViolationPersistenceModule uses the createConstraintViolation method in graphdb-adapter.ts to store constraint violations in the graph database.
- [GraphDatabaseAdapter](./GraphDatabaseAdapter.md) -- GraphDatabaseAdapter uses the createNode method to create a new node in the graph database, as seen in the graphdb-adapter.ts file.

### Siblings
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- The LiveLoggingSystem component employs a modular architecture, with separate modules for logging, transcript conversion, and ontology classification. This is evident in the organization of the codebase, where each module is responsible for a specific task. For instance, the logging module (integrations/mcp-server-semantic-analysis/src/logging.ts) handles log entries and provides a unified logging interface, while the TranscriptAdapter (lib/agent-api/transcript-api.js) abstracts transcript formats and provides a unified interface for reading and converting transcripts. The use of separate modules for each task allows for easier maintenance and modification of the codebase.
- [LLMAbstraction](./LLMAbstraction.md) -- The LLMAbstraction component's architecture is designed with modularity in mind, as seen in the separation of concerns between the LLMService (lib/llm/llm-service.ts) and the provider registry (lib/llm/provider-registry.js). This modular design allows for the easy addition or removal of LLM providers, such as Anthropic and DMR, without affecting the core functionality of the component. Furthermore, the use of dependency injection in the LLMService enables the injection of various dependencies, including budget trackers, sensitivity classifiers, and quota trackers, which enhances the flexibility and customizability of the component.
- [DockerizedServices](./DockerizedServices.md) -- The DockerizedServices component utilizes a microservices architecture, with each service potentially running in its own container. This is evident in the use of the startServiceWithRetry function (lib/service-starter.js) for robust service startup with retry, timeout, and exponential backoff mechanisms. For instance, in scripts/api-service.js, the spawn function from the child_process module is used to start the API server, and in scripts/dashboard-service.js, it is used to start the dashboard. The startServiceWithRetry function ensures that these services are started with a retry mechanism, preventing endless loops and providing graceful degradation when optional services fail.
- [Trajectory](./Trajectory.md) -- The Trajectory component's architecture is designed with flexibility and fault tolerance in mind, as evident from its ability to adapt to different connection methods such as HTTP, IPC, and file watch. This is achieved through the use of the SpecstoryAdapter class in lib/integrations/specstory-adapter.js, which provides a unified interface for connecting to the Specstory extension. The connectViaHTTP function in specstory-adapter.js demonstrates this flexibility by implementing a connection retry mechanism to handle transient connection issues.
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component's reliance on the GraphDatabaseAdapter (storage/graph-database-adapter.ts) for persistence and automatic JSON export sync enables efficient data management. This is evident in the way the adapter leverages Graphology and LevelDB for robust graph database interactions. For instance, the 'syncJSONExport' function in graph-database-adapter.ts ensures that data remains consistent across different storage formats, thus supporting the project's data analysis goals.
- [CodingPatterns](./CodingPatterns.md) -- The CodingPatterns component demonstrates a modular structure through its use of various integration modules, such as integrations/browser-access/ and integrations/code-graph-rag/. These modules accommodate different coding patterns and practices, allowing for flexibility and scalability in the project's architecture. For instance, the setup-browser-access.sh script in the browser-access module automates the setup process for browser-based coding environments, while the delete-coder-workspaces.py script in the same module handles teardown processes. This modularity enables developers to easily add or remove integration modules as needed, without affecting the overall project structure. The config/teams/*.json files, which store team-specific settings and coding conventions, further emphasize the component's emphasis on modularity and configurability.
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component employs a modular architecture, with each agent responsible for a specific task, such as the OntologyClassificationAgent (integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts) for classifying observations against the ontology system. This modularity allows for easier maintenance and extension of the component, as new agents can be added or existing ones modified without affecting the overall system. For instance, the SemanticAnalysisAgent (integrations/mcp-server-semantic-analysis/src/agents/semantic-analysis-agent.ts) utilizes the LLMService for large language model-based analysis and generation, demonstrating the flexibility of the component's design. The use of a standardized agent interface, as defined in the BaseAgent (integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts), ensures consistency across the different agents and facilitates communication between them.


---

*Generated from 6 observations*
