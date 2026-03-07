# CodingPatterns

**Type:** Component

Key patterns in this component include the use of graph database adapters, work-stealing concurrency, and lazy initialization of large language models. The project also employs a custom OntologyLoader...

## What It Is  

The **CodingPatterns** component lives at the heart of the *Coding* knowledge hierarchy and encapsulates the reusable architectural and coding conventions that the whole platform relies on.  Its concrete artefacts are scattered across a few well‑named source files, the most visible being  

* `storage/graph-database-adapter.ts` – the concrete **GraphDatabaseAdapter** that mediates all persistence to the underlying graph store.  
* `wave-controller.ts` (line 489) – the implementation of **runWithConcurrency()**, the work‑stealing loop that drives parallel execution of “wave” agents.  
* The **OntologyLoader** class (referenced from the `OntologyManager` module) and the **EntityAuthoringService** class (used by the entity‑authoring UI).  
* `DatabaseConnection` (not shown in a file path but referenced as a Singleton) that guarantees a single live connection to the database.  

Together these files illustrate a disciplined approach to **lazy LLM initialization**, **graph‑database‑centric persistence**, and **high‑throughput concurrent processing**.  The component is a sibling to other major blocks such as *LiveLoggingSystem*, *LLMAbstraction*, *DockerizedServices*, *Trajectory*, *KnowledgeManagement*, *ConstraintSystem*, and *SemanticAnalysis*, and it supplies the design‑pattern “library” that those siblings repeatedly draw from.

---

## Architecture and Design  

### Core Design Patterns  

| Pattern | Where it appears | Why it was chosen |
|---------|------------------|-------------------|
| **Singleton** | `DatabaseConnection` (observation 3) | Guarantees a single, thread‑safe handle to the graph store, avoiding connection storms and ensuring consistent transaction boundaries. |
| **Lazy Initialization** | Wave agents follow `constructor(repoPath, team) → ensureLLMInitialized() → execute(input)` (observation 6) | Defers heavyweight LLM model loading until the first inference request, keeping startup time low and memory usage modest on idle nodes. |
| **Work‑Stealing Concurrency** | `runWithConcurrency()` in `wave-controller.ts:489` (observation 7) | Uses a shared atomic index counter so multiple worker threads can dynamically pull tasks, improving CPU utilisation on heterogeneous workloads. |
| **Repository / Adapter** | `GraphDatabaseAdapter` in `storage/graph-database-adapter.ts` (observation 5) | Abstracts the concrete graph‑DB driver (e.g., Neo4j, JanusGraph) behind a stable API, enabling the rest of the codebase to remain DB‑agnostic. |
| **Custom Service Layer** | `EntityAuthoringService` (observation 8) | Encapsulates business rules for manual entity creation and editing, keeping UI code thin and centralising validation logic. |
| **Ontology Loader** | `OntologyLoader` class (observations 4 & 1) | Provides a single entry point for loading the domain ontology, supporting the *OntologyManagement* child component. |

These patterns are not isolated; they interlock to produce a **modular, testable, and extensible** architecture.  For example, the Singleton `DatabaseConnection` is consumed by the `GraphDatabaseAdapter`, which in turn is the persistence backbone for the `EntityAuthoringService`.  The lazy LLM bootstrap lives inside each “wave” agent, but the agents themselves are scheduled by the work‑stealing loop in `wave-controller.ts`, ensuring that heavy model loading only occurs on demand and that many agents can run in parallel without contention.

### Interaction Model  

1. **Startup** – The application boots, the `DatabaseConnection` Singleton is instantiated, and the `GraphDatabaseAdapter` registers itself with the higher‑level repository interfaces.  
2. **Ontology Preparation** – The `OntologyLoader` (a child of the *OntologyManagement* sub‑component) reads the ontology files once, caches the result, and makes it available to downstream services such as the `EntityAuthoringService`.  
3. **Wave Execution** – A client creates a wave agent via `new WaveAgent(repoPath, team)`. The constructor stores configuration, then `ensureLLMInitialized()` lazily pulls the required LLM model (leveraging the *LLMAbstraction* sibling). Once ready, the agent’s `execute(input)` method is handed off to `runWithConcurrency()`, which distributes work across a pool of workers using the atomic index counter.  
4. **Persistence** – Results (e.g., newly authored entities, inferred relationships) flow into the `EntityAuthoringService`, which validates them and persists them through the `GraphDatabaseAdapter`.  

The component therefore sits at the **confluence of data persistence, ontology handling, and AI‑augmented processing**, providing a clean contract for its siblings to consume.

---

## Implementation Details  

### Graph Database Adapter (`storage/graph-database-adapter.ts`)  
The adapter implements the **Repository** style API (`saveNode`, `findNodeById`, `queryEdges`, …). Internally it holds a reference to the Singleton `DatabaseConnection`, reusing the same underlying driver session for every call.  The file follows the project‑wide PascalCase class naming and camelCase variable naming conventions (observation 2).  Error handling is centralized, translating low‑level driver exceptions into domain‑specific `GraphPersistenceError` objects, which are caught by higher‑level services such as `EntityAuthoringService`.

### Singleton Database Connection  
Although the exact file path is not listed, the pattern is evident: a static `instance` field, a private constructor, and a public `getInstance()` accessor.  This ensures that any module that `import`s the connection receives the same object, preventing accidental multiple socket creation.  The design trades a tiny amount of testability (global state) for runtime stability and reduced connection overhead.

### Lazy LLM Initialization (Wave Agents)  
Each wave agent follows a three‑step lifecycle:  
1. **Construction** – Captures immutable configuration (`repoPath`, `team`).  
2. **ensureLLMInitialized()** – Checks an internal flag; if false, it calls into the *LLMAbstraction* service to load the appropriate model (OpenAI, Anthropic, etc.). The call is asynchronous and memoised, so subsequent agents on the same node reuse the already‑loaded model.  
3. **execute(input)** – Performs the actual inference, then returns a structured result that downstream services can consume.  

This pattern prevents the expensive model download and GPU warm‑up from blocking the main event loop, a critical scalability decision for a system that may spin up dozens of agents per request.

### Work‑Stealing Concurrency (`wave-controller.ts:489`)  
The function `runWithConcurrency(taskList, workerCount)` creates a shared `AtomicInteger` (or Node.js `Atomics` on a SharedArrayBuffer) representing the next task index.  Each worker thread (or async worker) atomically fetches and increments the index, processes the assigned task, and loops until the index exceeds the list length.  Because the index is atomic, no explicit lock is required, dramatically reducing contention.  The design is deliberately **lock‑free**, matching the high‑throughput demands of the *SemanticAnalysis* sibling, which also runs many parallel agents.

### OntologyLoader & EntityAuthoringService  
`OntologyLoader` (referenced from `OntologyManager`) reads ontology definition files (likely JSON‑LD or Turtle) and builds an in‑memory graph representation.  It is a **Singleton** in the *DesignPatterns* child component, ensuring the ontology is parsed once per process.  `EntityAuthoringService` receives user‑driven CRUD requests, validates them against the loaded ontology (e.g., type constraints, mandatory properties), and then persists the entity via `GraphDatabaseAdapter`.  By separating validation (ontology‑aware) from persistence, the service remains testable and adheres to the **Single Responsibility Principle**.

---

## Integration Points  

1. **LLMAbstraction** – Wave agents call `ensureLLMInitialized()` which internally uses the LLM façade (e.g., `lib/llm/llm-service.ts`).  This keeps the CodingPatterns component agnostic to the specific provider.  
2. **LiveLoggingSystem** – When a wave agent finishes, it emits an event that the logging subsystem captures, persisting a transcript via the `TranscriptAdapter`.  The logging pipeline respects the same naming conventions and error‑handling style.  
3. **KnowledgeManagement** – The intelligent routing logic in KnowledgeManagement can switch between direct graph‑DB calls (via `GraphDatabaseAdapter`) or API‑based access; CodingPatterns supplies the low‑level adapter that both paths rely on.  
4. **ConstraintSystem & SemanticAnalysis** – Both siblings spawn large numbers of concurrent agents; they reuse the `runWithConcurrency()` implementation, guaranteeing consistent scheduling semantics across the platform.  
5. **DockerizedServices** – The component is packaged as a Node.js/TypeScript service, containerised by Docker.  Environment variables (e.g., DB connection strings) are read by `DatabaseConnection` at start‑up, making the component portable across dev, staging, and production clusters.  

All these integration points respect the **PascalCase / camelCase** naming discipline (observation 2) and the **module‑boundary** conventions defined in the parent *Coding* component, ensuring that cross‑component imports remain predictable.

---

## Usage Guidelines  

* **Always acquire the DB connection through `DatabaseConnection.getInstance()`** – never instantiate the driver directly. This preserves the Singleton guarantee and prevents hidden connection leaks.  
* **Never call the LLM directly** – instantiate a wave agent and let its `ensureLLMInitialized()` method handle model loading. This guarantees lazy initialization and centralises provider selection in *LLMAbstraction*.  
* **When adding new persistence operations, extend `GraphDatabaseAdapter`** rather than reaching into the driver. Follow the Repository pattern already established: expose high‑level methods that accept domain objects, not raw query strings.  
* **For parallel workloads, use `runWithConcurrency()`**. Do not implement ad‑hoc loops with `Promise.all` on large arrays; the work‑stealing loop provides better CPU utilisation and graceful back‑pressure.  
* **If you need to augment the ontology**, modify the source files consumed by `OntologyLoader` and re‑run the loader at process start. Do not attempt to mutate the ontology at runtime – the loader is a Singleton and expects a stable, immutable definition.  
* **Adhere to naming conventions** – classes in PascalCase (`EntityAuthoringService`), variables and functions in camelCase (`ensureLLMInitialized`). This consistency is enforced across siblings and makes automated linting reliable.  

Following these guidelines will keep the component performant, easy to test, and aligned with the broader *Coding* ecosystem.

---

### Summary Deliverables  

1. **Architectural patterns identified**  
   * Singleton (DatabaseConnection, OntologyLoader)  
   * Lazy Initialization (LLM in wave agents)  
   * Work‑Stealing Concurrency (runWithConcurrency)  
   * Repository / Adapter (GraphDatabaseAdapter)  
   * Service Layer (EntityAuthoringService)  

2. **Design decisions and trade‑offs**  
   * Singleton simplifies connection management but introduces global state, mitigated by careful test‑double injection.  
   * Lazy LLM loading reduces cold‑start latency at the cost of a one‑time model‑load pause on first use.  
   * Work‑stealing avoids lock contention, but requires atomic primitives that are only available in recent Node.js versions.  
   * Adapter abstracts the graph DB, enabling future driver swaps without touching business logic, at the expense of a thin indirection layer.  

3. **System structure insights**  
   * CodingPatterns sits centrally, providing reusable patterns to siblings (LiveLoggingSystem, KnowledgeManagement, etc.).  
   * Child components (DesignPatterns, GraphDatabaseManagement, OntologyManagement, etc.) specialize the generic patterns with concrete implementations (e.g., OntologyLoader Singleton).  
   * The component’s modules are organized by concern: persistence (`storage/`), concurrency (`wave-controller.ts`), AI integration (wave agents), and domain services (`EntityAuthoringService`).  

4. **Scalability considerations**  
   * Work‑stealing concurrency scales linearly with CPU cores, allowing the system to handle thousands of concurrent wave tasks.  
   * Lazy LLM initialization prevents unnecessary memory pressure, enabling the service to run on modest instances when traffic is low.  
   * The GraphDatabaseAdapter can be backed by a clustered graph database, and the Singleton connection will multiplex sessions across the cluster.  

5. **Maintainability assessment**  
   * Consistent naming conventions and clear separation of concerns make the codebase approachable for new developers.  
   * Centralised patterns (Singleton, Adapter) reduce duplication but require disciplined testing of global state.  
   * The explicit, documented lifecycle of wave agents (constructor → ensureLLMInitialized → execute) serves as a living contract, simplifying future extensions (e.g., new LLM providers).  
   * Overall, the component balances performance with readability, positioning it as a robust foundation for the rest of the *Coding* ecosystem.


## Hierarchy Context

### Parent
- [Coding](./Coding.md) -- Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 8 major components: LiveLoggingSystem: The LiveLoggingSystem component is a comprehensive logging infrastructure designed to capture and process conversations from various agents, such as C; LLMAbstraction: The LLMAbstraction component is a high-level facade that provides an abstraction layer over various LLM providers, including Anthropic, OpenAI, and Gr; DockerizedServices: The component also employs various technologies, such as Node.js, TypeScript, and GraphQL, to build its services and APIs. The use of process managers; Trajectory: The Trajectory component is a complex system that manages project milestones, GSD workflow, phase planning, and implementation task tracking. Its arch; KnowledgeManagement: Key patterns in this component include the use of intelligent routing for database interactions, with the ability to switch between API and direct acc; CodingPatterns: Key patterns in this component include the use of graph database adapters, work-stealing concurrency, and lazy initialization of large language models; ConstraintSystem: The system's key patterns include the use of GraphDatabaseAdapter for graph database persistence, the implementation of work-stealing concurrency, and; SemanticAnalysis: The SemanticAnalysis component is a multi-agent system that processes git history and LSL sessions to extract and persist structured knowledge entitie.

### Children
- [DesignPatterns](./DesignPatterns.md) -- The OntologyLoader class in ontology-loader.py utilizes the Singleton pattern to ensure only one instance is created.
- [CodingConventions](./CodingConventions.md) -- The CodeFormatter class in code-formatter.py enforces consistent coding conventions, such as indentation and naming conventions.
- [GraphDatabaseManagement](./GraphDatabaseManagement.md) -- The GraphDatabaseAdapter class in graph-database-adapter.py uses the Repository pattern to abstract the graph database interactions.
- [NaturalLanguageProcessing](./NaturalLanguageProcessing.md) -- The NaturalLanguageProcessor class in natural-language-processor.py uses the Pipeline pattern to process natural language text.
- [MachineLearningIntegration](./MachineLearningIntegration.md) -- The MachineLearningModel class in machine-learning-model.py uses the Factory pattern to create instances of different machine learning models.
- [OntologyManagement](./OntologyManagement.md) -- The OntologyLoader class in ontology-loader.py uses the Singleton pattern to ensure only one instance is created.
- [EntityManagement](./EntityManagement.md) -- The EntityAuthoringService class in entity-authoring-service.py employs the Factory pattern to handle manual entity creation and editing.

### Siblings
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- The LiveLoggingSystem component is a comprehensive logging infrastructure designed to capture and process conversations from various agents, such as Claude Code. It handles session windowing, file routing, classification layers, and transcript capture. The system's architecture involves multiple modules and classes, including the OntologyClassificationAgent, which classifies observations against an ontology system, and the TranscriptAdapter, which provides a unified abstraction for reading and converting transcripts from different agent formats. The system also utilizes a logging mechanism, as seen in the logging.ts file, which asynchronously writes log entries to a file.
- [LLMAbstraction](./LLMAbstraction.md) -- The LLMAbstraction component is a high-level facade that provides an abstraction layer over various LLM providers, including Anthropic, OpenAI, and Groq. It enables provider-agnostic model calls, tier-based routing, and mock mode for testing. The component is designed to handle different LLM modes, including mock, local, and public, and it uses a registry to manage the available providers. The LLMAbstraction component is implemented in the lib/llm/llm-service.ts file and uses various other modules, such as the provider registry, circuit breaker, and cache, to manage the LLM operations.
- [DockerizedServices](./DockerizedServices.md) -- The component also employs various technologies, such as Node.js, TypeScript, and GraphQL, to build its services and APIs. The use of process managers, like the ProcessStateManager, enables the registration and unregistration of services, ensuring proper cleanup and resource management. Overall, the DockerizedServices component provides a flexible and scalable framework for coding services, leveraging Docker containerization and a microservices-based architecture.
- [Trajectory](./Trajectory.md) -- The Trajectory component is a complex system that manages project milestones, GSD workflow, phase planning, and implementation task tracking. Its architecture involves utilizing various connection methods to integrate with the Specstory extension, including HTTP, IPC, and file watch. The component is implemented in the lib/integrations/specstory-adapter.js file and uses a logger to handle logging and errors. The SpecstoryAdapter class is the main entry point for this component, providing methods to initialize the connection, log conversations, and connect via different methods. The component's design allows for flexibility and fault tolerance, with multiple connection attempts and fallbacks in case of failures. The use of a session ID and extension API enables the component to track and manage conversations and logs effectively.
- [KnowledgeManagement](./KnowledgeManagement.md) -- Key patterns in this component include the use of intelligent routing for database interactions, with the ability to switch between API and direct access modes. Additionally, the component utilizes a classification cache to avoid redundant LLM calls and implements data loss tracking to monitor data flow through the system.
- [ConstraintSystem](./ConstraintSystem.md) -- The system's key patterns include the use of GraphDatabaseAdapter for graph database persistence, the implementation of work-stealing concurrency, and the utilization of a unified hook manager for central orchestration of hook events. The system also employs various logging mechanisms, such as the use of a logger wrapper for content validation and the implementation of error handling mechanisms.
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component is a multi-agent system that processes git history and LSL sessions to extract and persist structured knowledge entities. It utilizes various agents, including the OntologyClassificationAgent, SemanticAnalysisAgent, and CodeGraphAgent, to perform tasks such as ontology classification, semantic analysis, and code graph construction. The component's architecture is designed to facilitate the integration of multiple agents and enable the efficient processing of large amounts of data.


---

*Generated from 8 observations*
