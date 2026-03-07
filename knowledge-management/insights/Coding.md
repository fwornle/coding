# Coding

**Type:** Project

Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 8 major components: LiveLoggingSystem: The LiveLoggingSystem component is a comprehensive logging infrastructure designed to capture and process live session logs from various agents, inclu; LLMAbstraction: The LLMAbstraction component serves as a high-level facade for interacting with various LLM providers, such as Anthropic, OpenAI, and Groq, enabling p; DockerizedServices: In terms of specific implementation details, the component features a range of classes and functions that facilitate its operations. For instance, the; Trajectory: The Trajectory component is a complex system managing project milestones, GSD workflow, phase planning, and implementation task tracking. It employs v; KnowledgeManagement: The KnowledgeManagement component is responsible for managing the knowledge graph, including entity persistence, graph database interactions, and inte; CodingPatterns: The CodingPatterns component encompasses general programming wisdom, design patterns, best practices, and coding conventions applicable across the pro; ConstraintSystem: The ConstraintSystem component is a constraint monitoring and enforcement system that validates code actions and file operations against configured ru; SemanticAnalysis: The SemanticAnalysis component is a multi-agent system that processes git history and LSL sessions to extract and persist structured knowledge entitie.

## What It Is  

The **Coding** project is a unified knowledge‑driven development platform whose source lives in a single repository that houses eight first‑level components: **LiveLoggingSystem**, **LLMAbstraction**, **DockerizedServices**, **Trajectory**, **KnowledgeManagement**, **CodingPatterns**, **ConstraintSystem**, and **SemanticAnalysis**.  The root of the hierarchy is the “Coding” node itself, which acts as the logical parent for all of these subsystems.  Each child component occupies its own logical domain but shares a common runtime (Node.js/TypeScript) and a common persistence layer (graph‑oriented stores such as LevelDB and Graphology).  The project does not expose a monolithic code base; instead, it is organized around purpose‑driven modules that can be built, container‑ized, and run independently while still cooperating through well‑defined adapters and service contracts.

---

## Architecture and Design  

The overall architecture follows a **modular, service‑oriented** style where each L1 component encapsulates a cohesive set of responsibilities and communicates with its peers through lightweight interfaces (e.g., the `SpecstoryAdapter` in **Trajectory** or the LLM provider façade in **LLMAbstraction**).  The design leans heavily on classic **object‑oriented patterns** that are explicitly mentioned in the observations:

* **Dependency Injection** – used throughout **LLMAbstraction** to inject concrete provider implementations (Anthropic, OpenAI, Groq) into the façade, allowing the rest of the system to remain agnostic of the underlying API.  
* **Singleton** – the provider registry inside **LLMAbstraction** is instantiated once per process, guaranteeing a single source of truth for routing decisions.  
* **Factory** – both **LLMAbstraction** and **DockerizedServices** employ factories to construct concrete service objects (e.g., the `LLMService` in `lib/llm/llm-service.ts`).  
* **Work‑Stealing Concurrency** – the **LiveLoggingSystem** processes live session logs using a pool of workers that dynamically balance load, which is essential for handling bursty agent traffic.  
* **Circuit‑Breaker & Retry Logic** – the `LLMService` class and the `startServiceWithRetry` function in `lib/service-starter.js` protect external calls (LLM endpoints, Docker containers) from transient failures and prevent cascade failures across the system.  

Interaction patterns are deliberately **asynchronous and event‑driven** (though not labelled as such) – log records flow from agents into **LiveLoggingSystem**, which classifies them via heuristic ontology agents and persists the enriched metadata into the graph database shared with **KnowledgeManagement**.  **SemanticAnalysis** consumes Git history and LSL session streams, producing structured knowledge entities that are stored by the same graph layer, making the knowledge graph the central integration hub.  **Trajectory** orchestrates project‑level planning through a GraphQL API, IPC channels, and a file‑watch directory, feeding milestone updates into the knowledge graph and allowing other components (e.g., **ConstraintSystem**) to query current state for rule enforcement.

Because each component is packaged as a **Dockerized service**, the system can be deployed in containers that expose their own ports or Unix sockets, while still sharing the same underlying data stores.  The **CodingPatterns** component does not implement runtime code but supplies the design‑level conventions that guide the implementation of all siblings, ensuring consistency across the code base.

---

## Implementation Details  

### LiveLoggingSystem  
The logging pipeline is built from **transcript adapters**, **log converters**, and **ontology classification agents**.  The adapters ingest raw conversation streams (e.g., Claude Code sessions), the converters normalise them into a canonical log format, and the classification agents apply heuristic rules to attach ontology metadata.  Persistence is handled by **graph database adapters** that write enriched logs into a LevelDB‑backed Graphology store, enabling fast traversals for later analysis.  Concurrency is achieved via a **work‑stealing thread pool**, allowing the system to scale out when many agents are streaming logs simultaneously.

### LLMAbstraction  
At the heart of this façade is a set of **interfaces** (e.g., `LLMProvider`, `CompletionRequest`) and concrete implementations for each vendor.  Provider registration occurs at startup through a **singleton registry**; routing logic then selects the appropriate provider based on tier configuration (e.g., cost‑ vs. latency‑optimized).  A **mock mode** can be toggled for unit testing, bypassing external network calls.  The component’s internal **factory** builds `LLMClient` objects that encapsulate mode resolution, caching, and circuit‑breaker wrapping.

### DockerizedServices  
The most visible implementation artifact is the `LLMService` class located at `lib/llm/llm-service.ts`.  This class acts as a façade for all LLM‑related operations, delegating to the **LLMAbstraction** layer for provider selection, then applying **caching** and **circuit‑breaker** policies before forwarding the request.  Service startup robustness is provided by `startServiceWithRetry` in `lib/service-starter.js`, which loops with exponential back‑off and respects a configurable timeout, ensuring that container orchestration (Docker) can recover from transient failures without manual intervention.

### Trajectory  
`Trajectory` uses **Node.js**, **TypeScript**, and **GraphQL** to expose a planning API.  The `SpecstoryAdapter` class (the central piece) offers three connection strategies: an HTTP API for remote clients, **IPC** for local processes, and a **file‑watch directory** for legacy tooling.  This flexibility allows the **Specstory** extension (a VS Code plugin) to push milestone updates directly into the planning graph, where they become observable to other components such as **ConstraintSystem**.

### KnowledgeManagement  
Persistence of the knowledge graph is handled by a combination of **Graphology** (in‑memory graph model), **LevelDB** (on‑disk key‑value store), and the **VKB API** (external knowledge base).  Two primary agents—`CodeGraphAgent` and `PersistenceAgent`—collaborate: the former analyses source code (leveraging **SemanticAnalysis** output) to extract concepts and relationships; the latter writes these entities to the graph store, handling versioning and conflict resolution.  The component also provides **intelligent routing**, selecting the optimal storage backend based on entity size and access patterns.

### ConstraintSystem & SemanticAnalysis  
`ConstraintSystem` monitors file‑system actions and code edits, validating them against a rule set defined in the knowledge graph.  Violations are reported back to the developer through the logging pipeline.  `SemanticAnalysis` runs a **multi‑agent pipeline** that parses Git history and LSL session logs, transforms them into structured knowledge entities, and forwards them to `KnowledgeManagement` for persistence.  This creates a feedback loop where historical insights can inform future constraints and planning decisions.

### CodingPatterns  
While not a runtime module, `CodingPatterns` codifies best practices—naming conventions, error‑handling strategies, and preferred design patterns (e.g., the ones listed above).  All sibling components reference this repository to ensure a uniform code style and architectural consistency.

---

## Integration Points  

1. **Graph Database / Knowledge Graph** – The single source of truth for enriched logs, code concepts, and planning entities.  Both **LiveLoggingSystem** and **KnowledgeManagement** write to it, while **ConstraintSystem**, **SemanticAnalysis**, and **Trajectory** read from it.  
2. **LLM Provider façade** – **LLMAbstraction** supplies a provider‑agnostic API that is consumed by **DockerizedServices** (`LLMService`) and indirectly by **LiveLoggingSystem** when it needs to summarize logs or generate annotations.  
3. **Service Startup Layer** – `startServiceWithRetry` in `lib/service-starter.js` is invoked by each Dockerized component (e.g., **LLMService**, **Trajectory**) to guarantee reliable container launch.  
4. **SpecstoryAdapter** – Bridges **Trajectory** with the external Specstory VS Code extension via HTTP, IPC, or file‑watch, allowing planning data to flow into the broader system.  
5. **Constraint Enforcement** – **ConstraintSystem** hooks into file‑system watchers and the Git hook pipeline; it queries the knowledge graph for rule definitions that were originally produced by **SemanticAnalysis**.  
6. **Logging Pipeline** – **LiveLoggingSystem** publishes classified logs to a message bus (implicit in the work‑stealing design) that other components can subscribe to for analytics or alerting.  

These integration points illustrate a **shared‑state, loosely‑coupled** architecture where the knowledge graph acts as the integration backbone, and each component interacts through well‑defined adapters rather than tight code dependencies.

---

## Usage Guidelines  

* **Prefer the façade APIs** – When invoking any LLM functionality, always go through `LLMAbstraction` (or the `LLMService` façade) to benefit from routing, caching, and circuit‑breaker protections. Direct HTTP calls to provider endpoints bypass these safeguards and are discouraged.  
* **Persist through KnowledgeManagement** – All new entities—whether they originate from log classification, semantic analysis, or planning updates—should be handed to the `PersistenceAgent`.  This guarantees consistent versioning and routing to the appropriate backend (Graphology vs. LevelDB).  
* **Follow the CodingPatterns conventions** – Naming, error handling, and async patterns prescribed by the **CodingPatterns** component must be respected across all new modules to keep the codebase maintainable.  
* **Handle start‑up failures gracefully** – Use `startServiceWithRetry` for any long‑running Dockerized service.  Configure exponential back‑off parameters in the service configuration file rather than hard‑coding them.  
* **Respect constraint validation** – Before committing code or performing file operations, run the `ConstraintSystem` validation step (typically invoked via a pre‑commit hook).  Ignoring violations can corrupt the knowledge graph and break downstream planning.  
* **Leverage the SpecstoryAdapter** – When extending the planning UI, connect through the adapter’s preferred channel (HTTP for remote, IPC for local) rather than accessing the GraphQL schema directly. This preserves backward compatibility with the file‑watch method used by legacy tools.  

---

### Summarized Deliverables  

1. **Architectural patterns identified**  
   * Dependency Injection, Singleton, Factory (LLMAbstraction)  
   * Work‑Stealing Concurrency (LiveLoggingSystem)  
   * Circuit‑Breaker, Retry Logic (DockerizedServices)  
   * Graph‑oriented persistence (KnowledgeManagement)  

2. **Design decisions and trade‑offs**  
   * Centralised knowledge graph enables rich cross‑component queries but introduces a single point of contention; mitigated by LevelDB sharding and in‑memory Graphology caching.  
   * Provider‑agnostic LLM façade adds abstraction overhead but yields flexibility to switch vendors without code changes.  
   * Multiple connection methods in Trajectory (HTTP, IPC, file‑watch) increase compatibility at the cost of added interface surface area.  

3. **System structure insights**  
   * Eight sibling modules under the “Coding” parent, each encapsulating a distinct domain (logging, LLM access, container orchestration, planning, knowledge graph, patterns, constraints, semantic analysis).  
   * Shared runtime (Node.js/TS) and persistence layer unify the ecosystem while allowing independent Docker container deployment.  

4. **Scalability considerations**  
   * Work‑stealing thread pools and circuit‑breaker patterns allow **LiveLoggingSystem** and **LLMService** to scale under high load.  
   * Graph database adapters and LevelDB provide horizontal scalability for the knowledge store; however, careful monitoring of write throughput is required as logging volume grows.  
   * Retry‑with‑backoff in service startup prevents cascade failures during container orchestration, supporting robust scaling in Kubernetes‑style environments.  

5. **Maintainability assessment**  
   * Strong reliance on well‑documented design patterns (DI, factory, singleton) and a central **CodingPatterns** guideline promotes code readability and onboarding ease.  
   * Decoupling via adapters (e.g., `SpecstoryAdapter`, graph DB adapters) isolates changes to a single module, reducing ripple effects.  
   * The monolithic knowledge graph is a maintenance hotspot; periodic compaction and clear versioning policies are essential to avoid degradation.  

Overall, the **Coding** project demonstrates a disciplined, pattern‑driven architecture that balances modular independence with a shared knowledge backbone, providing a solid foundation for extensible, observable, and resilient development tooling.


## Hierarchy Context

### Children
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- The LiveLoggingSystem component is a comprehensive logging infrastructure designed to capture and process live session logs from various agents, including Claude Code conversations. Its architecture involves multiple sub-components, including transcript adapters, log converters, and ontology classification agents. Key patterns in this component include the use of graph database adapters for persistence, work-stealing concurrency for efficient processing, and heuristic-based classification for ontology metadata attachment.
- [LLMAbstraction](./LLMAbstraction.md) -- The LLMAbstraction component serves as a high-level facade for interacting with various LLM providers, such as Anthropic, OpenAI, and Groq, enabling provider-agnostic model calls, tier-based routing, and mock mode for testing. Its architecture involves a combination of interfaces, classes, and modules that work together to manage LLM operations, including mode resolution, provider registration, and completion requests. The component utilizes design patterns like dependency injection, singleton, and factory to ensure flexibility, scalability, and maintainability.
- [DockerizedServices](./DockerizedServices.md) -- In terms of specific implementation details, the component features a range of classes and functions that facilitate its operations. For instance, the LLMService class in lib/llm/llm-service.ts serves as a high-level facade for all LLM operations, handling mode routing, caching, and circuit breaking. Similarly, the startServiceWithRetry function in lib/service-starter.js enables robust service startup with retry logic and timeout protection. These elements collectively contribute to the component's overall architecture and functionality.
- [Trajectory](./Trajectory.md) -- The Trajectory component is a complex system managing project milestones, GSD workflow, phase planning, and implementation task tracking. It employs various technologies such as Node.js, TypeScript, and GraphQL to build a comprehensive planning infrastructure. The component's architecture involves multiple connection methods, including HTTP API, Inter-Process Communication (IPC), and file watch directory, to interact with the Specstory extension. The SpecstoryAdapter class plays a central role in this component, providing methods for initialization, logging conversations, and connecting to the Specstory extension via different methods.
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component is responsible for managing the knowledge graph, including entity persistence, graph database interactions, and intelligent routing for database access. It utilizes various technologies such as Graphology, LevelDB, and VKB API to provide a comprehensive knowledge management system. The component's architecture is designed to support multiple agents, including CodeGraphAgent and PersistenceAgent, which work together to analyze code, extract concepts, and store entities in the graph database.
- [CodingPatterns](./CodingPatterns.md) -- The CodingPatterns component encompasses general programming wisdom, design patterns, best practices, and coding conventions applicable across the project. This component serves as a catch-all for entities that do not fit into other specific components. Its architecture is designed to promote consistency and efficiency in coding practices, ensuring that the project adheres to established standards and guidelines. Key patterns in this component include the use of intelligent routing, graph database adapters, and work-stealing concurrency, which contribute to its overall structure and functionality.
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem component is a constraint monitoring and enforcement system that validates code actions and file operations against configured rules during Claude Code sessions. It utilizes various technologies such as Node.js, TypeScript, and GraphQL to build its architecture. The system's key patterns include the use of intelligent routing for database interactions, graph database adapters for persistence, and work-stealing concurrency for efficient data processing. The component also employs a multi-agent system that processes git history and LSL sessions to detect staleness and validate entity content.
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component is a multi-agent system that processes git history and LSL sessions to extract and persist structured knowledge entities. It utilizes various technologies such as Node.js, TypeScript, and GraphQL to build a comprehensive semantic analysis pipeline. The component's architecture is designed to support multiple agents, each with its own specific responsibilities, such as ontology classification, semantic analysis, and content validation. Key patterns in this component include the use of intelligent routing for database interactions, graph database adapters for persistence, and work-stealing concurrency for efficient processing.


---

*Generated from 2 observations*
