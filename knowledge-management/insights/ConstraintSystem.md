# ConstraintSystem

**Type:** Component

The ConstraintSystem component is a constraint monitoring and enforcement system that validates code actions and file operations against configured rules during Claude Code sessions. It utilizes various technologies such as Node.js, TypeScript, and GraphQL to build its architecture. The system's key patterns include the use of intelligent routing for database interactions, graph database adapters for persistence, and work-stealing concurrency for efficient data processing. The component also employs a multi-agent system that processes git history and LSL sessions to detect staleness and validate entity content.

## What It Is  

The **ConstraintSystem** lives in the code‑base under the *integrations* and *lib* trees and is the runtime engine that watches every code‑action and file operation performed during a Claude Code session.  Its primary responsibility is to **validate those actions against a set of configurable rules** and to surface any violations to the developer‑facing dashboards.  The component is implemented in **Node.js** with **TypeScript** and is exposed to the rest of the platform through a **GraphQL** façade (the same technology stack used by its parent *Coding* component).  

Key entry points that make the system visible to the rest of the product are:  

* `integrations/mcp-server-semantic-analysis/src/agents/content-validation-agent.ts` – the **ContentValidationAgent** that extracts file‑paths and commands from entity payloads and drives the rule‑checking flow.  
* `lib/agent-api/hooks/hook-config.js` – the **HookConfigLoader** that pulls hook definitions from multiple sources (local JSON, remote service, environment overrides) and merges them into a single configuration object.  
* `scripts/violation-capture-service.js` – the **ViolationCaptureService** that receives violation events from the agents, persists them, and makes them available to the system‑health dashboard.  

Together these files form the backbone of a **multi‑agent, rule‑engine** that sits between the user’s edits and the persistent knowledge graph.

---

## Architecture and Design  

### High‑level style  

ConstraintSystem follows a **modular, agent‑centric architecture**.  Each concern (validation, hook orchestration, staleness detection, content analysis, git history processing, LSL session processing) is encapsulated in a dedicated *agent* or *processor* that communicates through well‑defined interfaces.  The design mirrors the broader *Coding* parent component, which also relies on agents (e.g., the LiveLoggingSystem’s transcript adapters) and shared infrastructure such as the **GraphDatabaseAdapter**.

### Core patterns  

| Observed pattern | Where it appears | What it accomplishes |
|------------------|------------------|----------------------|
| **Intelligent routing for database interactions** | Mentioned in observation 1; realized through the shared **GraphDatabaseAdapter** used by ConstraintSystem and its siblings (LiveLoggingSystem, KnowledgeManagement). | Routes read/write requests to the appropriate graph shard or LevelDB store based on entity type, improving latency and locality. |
| **Graph database adapters for persistence** | Observation 7; concrete class lives in the KnowledgeManagement component but is imported by ConstraintSystem agents. | Provides a uniform API (`saveEntity`, `queryRelations`) that abstracts away the underlying Graphology/LevelDB implementation. |
| **Work‑stealing concurrency** | Observation 1; the runtime spawns a pool of Node.js worker threads that steal work from each other when idle. | Keeps CPU cores busy while processing large git histories or LSL streams, reducing overall latency. |
| **Rules‑engine pattern** | Child component **ValidationAgent** (see “ValidationAgent uses a rules‑engine pattern with ValidationRules.ts”). | Encapsulates each constraint as a `ValidationRule` object with a `condition` function and an `action` (e.g., raise violation). |
| **Pub‑sub hook orchestration** | Child component **HookOrchestrator** (see “HookOrchestrator uses a pub‑sub pattern with HookOrchestrator.ts”). | Allows any agent to emit a `hookEvent` that the **UnifiedHookManager** (`lib/agent-api/hooks/hook-manager.js`) dispatches to registered listeners. |
| **Multi‑agent staleness detection** | Observation 8; realized by the combination of **GitHistoryAgent** and **VibeHistoryAgent**. | Detects when an entity’s persisted content is out‑of‑date relative to the latest git commit or LSL session. |
| **Redux‑backed workflow definitions** | `integrations/system-health-dashboard/src/components/workflow/hooks.ts` via `useWorkflowDefinitions`. | Supplies the ConstraintSystem with the current workflow context (e.g., “code‑review”, “refactor”) so that rule applicability can be scoped. |

### Interaction flow  

1. **Hook loading** – At startup, **HookConfigLoader** reads hook definitions (local files, remote config service) and merges them. The resulting config is handed to **UnifiedHookManager**, which registers each hook with the **HookOrchestrator** pub‑sub bus.  
2. **Action capture** – When a user performs a code action (e.g., edits a file, runs a CLI command), the **ContentValidationAgent** receives the raw payload. It uses **EntityContentAnalyzer** (regex‑based extraction) to pull out file paths, commands, and any inline metadata.  
3. **Rule evaluation** – The extracted data is fed into **ValidationAgent**. Each `ValidationRule` checks its condition against the payload and, on failure, emits a violation event.  
4. **Violation handling** – **ViolationCaptureService** listens to the violation topic on the hook bus, persists the violation via **GraphDatabaseAdapter**, and pushes a notification to the dashboard (the system‑health UI consumes it through GraphQL).  
5. **Staleness & semantic checks** – In parallel, **GitHistoryProcessor** and **LSLSessionProcessor** run continuously (work‑stealing workers) to update the knowledge graph. Their output feeds the **StalenessDetector**, which may retroactively flag entities as stale, causing additional validation passes.  

The architecture is deliberately **decoupled**: agents do not call each other directly but communicate via the hook bus, which keeps the system extensible and testable.

---

## Implementation Details  

### ContentValidationAgent (`integrations/mcp-server-semantic-analysis/src/agents/content-validation-agent.ts`)  

* **Entry point** – Exposes a `validateEntity(content: string): ValidationResult` method.  
* **Mechanics** – Calls `EntityContentAnalyzer.extract(content)` (implemented in `EntityContentAnalyzer.ts`) to obtain a structured object `{filePath, command, metadata}`.  
* **Integration** – Emits a `hookEvent('entity.validated', payload)` that the **UnifiedHookManager** routes to any listeners (e.g., the **ValidationAgent**).  

### HookConfigLoader (`lib/agent-api/hooks/hook-config.js`)  

* Reads configuration from three locations in order:  
  1. **Local JSON** (`hooks.local.json`)  
  2. **Remote service** (`GET /api/hooks`)  
  3. **Environment overrides** (`process.env.HOOKS_*`)  
* Performs a deep‑merge, preserving array order, and validates the final shape against a JSON schema (`hook-schema.json`).  

### UnifiedHookManager (`lib/agent-api/hooks/hook-manager.js`)  

* Maintains an internal map `topic → Set<listenerFn>`.  
* Provides `register(topic, fn)` and `emit(topic, data)` APIs.  
* On `emit`, it iterates over listeners synchronously but off‑loads heavy work to the **work‑stealing thread pool**.  

### ValidationAgent (child component)  

* Loads `ValidationRules.ts` where each rule is exported as `{id, description, condition: (payload) => boolean, action: (payload) => void}`.  
* On receiving a `entity.validated` event, it iterates through the rule list, short‑circuiting on the first failure (configurable via `stopOnFirstError`).  
* Calls `ViolationCaptureService.recordViolation(rule.id, payload)` for each failed rule.  

### ViolationCaptureService (`scripts/violation-capture-service.js`)  

* Listens to the `violation.captured` hook.  
* Persists the violation using `GraphDatabaseAdapter.saveViolation(violationObj)`.  
* Publishes a GraphQL mutation (`createViolation`) that the system‑health dashboard subscribes to.  

### StalenessDetector (child component)  

* Consumes events from `git.history.updated` (produced by **GitHistoryProcessor**) and `lsl.session.completed` (produced by **LSLSessionProcessor**).  
* Uses a simple timestamp comparison (`entity.lastUpdated < gitCommit.timestamp`) to flag stale entities.  
* Triggers a re‑validation cycle by re‑emitting `entity.validated` for the stale entity.  

### GraphDatabaseAdapter (shared)  

* Wraps Graphology APIs (`graph.addNode`, `graph.addEdge`) and LevelDB persistence (`db.put`, `db.get`).  
* Exposes a promise‑based API that agents use (`await adapter.saveEntity(entity)`).  

All of the above modules are written in **TypeScript** (except the few legacy JS files like `hook-config.js`), which provides static typing for payload shapes and helps keep the contract between agents explicit.

---

## Integration Points  

1. **Parent – Coding**  
   * ConstraintSystem inherits the **GraphQL** server configuration from *Coding* and registers its own resolvers (`createViolation`, `listViolations`).  
   * It also consumes the **workflow definitions** exposed by the system‑health dashboard via the `useWorkflowDefinitions` hook (`integrations/system-health-dashboard/src/components/workflow/hooks.ts`).  

2. **Siblings**  
   * **LiveLoggingSystem** shares the **GraphDatabaseAdapter** and the same work‑stealing thread pool, allowing both components to process events without contention.  
   * **KnowledgeManagement** provides the underlying knowledge graph that stores both constraint definitions and violation records.  
   * **SemanticAnalysis** contributes the **SemanticAnalyzer** used by the **ContentValidationAgent** to enrich extracted commands with ontology tags.  

3. **Children**  
   * **ValidationAgent**, **HookOrchestrator**, **StalenessDetector**, **EntityContentAnalyzer**, **GitHistoryProcessor**, and **LSLSessionProcessor** are all wired through the **UnifiedHookManager**.  
   * Each child implements a clear contract (e.g., `processGitHistory(gitData)` for the **GitHistoryProcessor**) that the parent orchestrates via hook events.  

4. **External services**  
   * The **HookConfigLoader** may call a remote configuration service (HTTP GET).  
   * The **ViolationCaptureService** pushes data to the dashboard via GraphQL; the dashboard in turn may query the violations for UI rendering.  

These integration points keep the component loosely coupled yet tightly coordinated, enabling independent evolution of agents while preserving a coherent validation pipeline.

---

## Usage Guidelines  

* **Rule definition** – All constraints must be expressed as a `ValidationRule` in `ValidationRules.ts`.  The rule’s `condition` should be a pure function; side‑effects belong in the `action` field, which typically calls `ViolationCaptureService`.  Avoid long‑running I/O inside `condition` because the rules engine runs on the main event loop.  
* **Hook registration** – When adding a new hook, use `UnifiedHookManager.register(topic, listener)` **before** the system starts processing events (e.g., in the module’s top‑level initialization).  Registering after the first event may cause missed validations.  
* **Concurrency awareness** – Agents that perform heavy computation (e.g., **GitHistoryProcessor**) must explicitly delegate to the work‑stealing pool via `await threadPool.run(task)`.  Direct synchronous loops will block the validation pipeline and degrade latency.  
* **Configuration merging** – If a project needs custom hook behavior, provide a `hooks.local.json` in the project root; the **HookConfigLoader** will merge it on top of the remote defaults.  Remember that environment overrides (`process.env.HOOKS_*`) take highest precedence.  
* **Testing** – Unit tests should mock the **UnifiedHookManager** and verify that agents emit the correct topics.  End‑to‑end tests can spin up an in‑memory GraphDatabaseAdapter (Graphology) to assert that violations are persisted and surfaced through GraphQL.  

Following these conventions ensures that new rules, hooks, or agents integrate cleanly without breaking the existing validation flow.

---

### Summary of Architectural Insights  

| Architectural pattern identified | Design decision / trade‑off |
|----------------------------------|-----------------------------|
| **Agent‑centric modularity** – each concern lives in its own processor. | Improves separation of concerns and testability, at the cost of additional indirection (hook bus). |
| **Pub‑sub hook orchestration** (UnifiedHookManager). | Enables dynamic addition of hooks; however, ordering guarantees rely on explicit priority handling in the manager. |
| **Rules‑engine** for constraints. | Declarative rule files are easy to extend; performance hinges on keeping rule conditions lightweight. |
| **Intelligent DB routing + GraphDatabaseAdapter**. | Abstracts persistence and allows sharding; introduces a runtime routing layer that must stay in sync with graph schema. |
| **Work‑stealing concurrency** for heavy agents. | Maximizes CPU utilization for git/LSL processing; adds complexity in debugging race conditions. |
| **Redux‑backed workflow context** (`useWorkflowDefinitions`). | Allows rules to be scoped to a workflow; requires the dashboard to keep the Redux store up‑to‑date. |

**Scalability considerations** – Because the heavy agents run in a shared thread pool, the system can scale horizontally by increasing the pool size or by spawning additional Node.js worker processes behind a load balancer.  The graph‑database adapter already supports sharding, so as the number of stored violations grows the persistence layer can be scaled independently.

**Maintainability assessment** – The strict separation of agents, the explicit hook contracts, and the use of TypeScript typings make the codebase approachable for new contributors.  The main maintenance risk is the **hook bus**: a proliferation of topics can become hard to audit.  Introducing a small registry documentation (e.g., a `hooks.md` file generated from the loader) would mitigate that risk.  Overall, the design balances extensibility with performance and aligns well with the patterns used across sibling components such as **LiveLoggingSystem** and **KnowledgeManagement**.


## Hierarchy Context

### Parent
- [Coding](./Coding.md) -- Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 8 major components: LiveLoggingSystem: The LiveLoggingSystem component is a comprehensive logging infrastructure designed to capture and process live session logs from various agents, inclu; LLMAbstraction: The LLMAbstraction component serves as a high-level facade for interacting with various LLM providers, such as Anthropic, OpenAI, and Groq, enabling p; DockerizedServices: In terms of specific implementation details, the component features a range of classes and functions that facilitate its operations. For instance, the; Trajectory: The Trajectory component is a complex system managing project milestones, GSD workflow, phase planning, and implementation task tracking. It employs v; KnowledgeManagement: The KnowledgeManagement component is responsible for managing the knowledge graph, including entity persistence, graph database interactions, and inte; CodingPatterns: The CodingPatterns component encompasses general programming wisdom, design patterns, best practices, and coding conventions applicable across the pro; ConstraintSystem: The ConstraintSystem component is a constraint monitoring and enforcement system that validates code actions and file operations against configured ru; SemanticAnalysis: The SemanticAnalysis component is a multi-agent system that processes git history and LSL sessions to extract and persist structured knowledge entitie.

### Children
- [ValidationAgent](./ValidationAgent.md) -- ValidationAgent uses a rules-engine pattern with ValidationRules.ts, each rule declaring explicit conditions and actions
- [HookOrchestrator](./HookOrchestrator.md) -- HookOrchestrator uses a pub-sub pattern with HookOrchestrator.ts, each hook declaring explicit subscription topics
- [StalenessDetector](./StalenessDetector.md) -- StalenessDetector uses a git-based staleness detection algorithm, as seen in StalenessDetector.ts, to identify outdated entity content
- [EntityContentAnalyzer](./EntityContentAnalyzer.md) -- EntityContentAnalyzer uses a regex-based pattern matching algorithm, as seen in EntityContentAnalyzer.ts, to extract file paths and commands from entity content
- [GitHistoryProcessor](./GitHistoryProcessor.md) -- GitHistoryProcessor uses a git-based history processing algorithm, as seen in GitHistoryProcessor.ts, to detect changes and updates in entity content
- [LSLSessionProcessor](./LSLSessionProcessor.md) -- LSLSessionProcessor uses a session-based processing algorithm, as seen in LSLSessionProcessor.ts, to detect changes and updates in entity content

### Siblings
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- The LiveLoggingSystem component is a comprehensive logging infrastructure designed to capture and process live session logs from various agents, including Claude Code conversations. Its architecture involves multiple sub-components, including transcript adapters, log converters, and ontology classification agents. Key patterns in this component include the use of graph database adapters for persistence, work-stealing concurrency for efficient processing, and heuristic-based classification for ontology metadata attachment.
- [LLMAbstraction](./LLMAbstraction.md) -- The LLMAbstraction component serves as a high-level facade for interacting with various LLM providers, such as Anthropic, OpenAI, and Groq, enabling provider-agnostic model calls, tier-based routing, and mock mode for testing. Its architecture involves a combination of interfaces, classes, and modules that work together to manage LLM operations, including mode resolution, provider registration, and completion requests. The component utilizes design patterns like dependency injection, singleton, and factory to ensure flexibility, scalability, and maintainability.
- [DockerizedServices](./DockerizedServices.md) -- In terms of specific implementation details, the component features a range of classes and functions that facilitate its operations. For instance, the LLMService class in lib/llm/llm-service.ts serves as a high-level facade for all LLM operations, handling mode routing, caching, and circuit breaking. Similarly, the startServiceWithRetry function in lib/service-starter.js enables robust service startup with retry logic and timeout protection. These elements collectively contribute to the component's overall architecture and functionality.
- [Trajectory](./Trajectory.md) -- The Trajectory component is a complex system managing project milestones, GSD workflow, phase planning, and implementation task tracking. It employs various technologies such as Node.js, TypeScript, and GraphQL to build a comprehensive planning infrastructure. The component's architecture involves multiple connection methods, including HTTP API, Inter-Process Communication (IPC), and file watch directory, to interact with the Specstory extension. The SpecstoryAdapter class plays a central role in this component, providing methods for initialization, logging conversations, and connecting to the Specstory extension via different methods.
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component is responsible for managing the knowledge graph, including entity persistence, graph database interactions, and intelligent routing for database access. It utilizes various technologies such as Graphology, LevelDB, and VKB API to provide a comprehensive knowledge management system. The component's architecture is designed to support multiple agents, including CodeGraphAgent and PersistenceAgent, which work together to analyze code, extract concepts, and store entities in the graph database.
- [CodingPatterns](./CodingPatterns.md) -- The CodingPatterns component encompasses general programming wisdom, design patterns, best practices, and coding conventions applicable across the project. This component serves as a catch-all for entities that do not fit into other specific components. Its architecture is designed to promote consistency and efficiency in coding practices, ensuring that the project adheres to established standards and guidelines. Key patterns in this component include the use of intelligent routing, graph database adapters, and work-stealing concurrency, which contribute to its overall structure and functionality.
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component is a multi-agent system that processes git history and LSL sessions to extract and persist structured knowledge entities. It utilizes various technologies such as Node.js, TypeScript, and GraphQL to build a comprehensive semantic analysis pipeline. The component's architecture is designed to support multiple agents, each with its own specific responsibilities, such as ontology classification, semantic analysis, and content validation. Key patterns in this component include the use of intelligent routing for database interactions, graph database adapters for persistence, and work-stealing concurrency for efficient processing.


---

*Generated from 8 observations*
