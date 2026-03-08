# CodingPatterns

**Type:** Component

The modular design of the CodingPatterns component is a key architectural aspect that promotes maintainability and scalability. The project is composed of several components, such as the `ModeRouter` and `DockerizedServices`, which are designed to be independent and self-contained. The `ModeRouter` class (mode-router.ts:300) is responsible for managing the different modes of operation, while the `DockerizedServices` class (dockerized-services.ts:400) is responsible for managing the Dockerized services. This design decision enables the project to adapt to changing requirements and facilitates the integration of new components. Furthermore, the use of a modular design reduces the complexity of the codebase and improves its overall maintainability. The `WaveController` class (wave-controller.ts:500) is another example of a component that benefits from the modular design, as it can be easily integrated with other components and tested independently.

## What It Is  

The **CodingPatterns** component lives at the heart of the `Coding` parent component and is realized through a collection of TypeScript/JavaScript modules that together define how the project enforces coding conventions, manages graph‑based persistence, and wires together Large Language Model (LLM) providers.  The most visible artefacts are:  

* `storage/graph-database-adapter.ts` – the **GraphDatabaseAdapter** that synchronises the in‑memory graph with a persistent store and exports a JSON snapshot.  
* `.eslintrc.json` – the ESLint configuration that codifies the project’s linting rules (e.g., `indent`, `no-console`).  
* `llm-service-module.ts` – the **LLMServiceModule** that supplies the current LLM provider via a dependency‑injection container.  
* `provider-registry-module.ts` – the **ProviderRegistryModule** that creates concrete LLM provider instances through a factory method.  
* `jest.config.js` together with test files such as `mode-router.ts` – the Jest‑based test harness that validates the behaviour of core classes like `ModeRouter`.  
* Several modular runtime classes – `mode-router.ts`, `dockerized-services.ts`, `wave-controller.ts` – each encapsulated in its own file and designed to be independently testable.

In short, **CodingPatterns** is the “how‑we‑code” layer: it defines the standards (ESLint), the persistence contract (GraphDatabaseAdapter), the extensibility model for LLMs (DI + factory), and the quality‑gate (Jest) that together keep the codebase coherent, testable, and easy to evolve.

---

## Architecture and Design  

The component follows a **modular architecture** in which each logical concern is isolated into its own module.  This is evident from the separation of the graph persistence logic (`storage/graph-database-adapter.ts`), the linting configuration (`.eslintrc.json`), the LLM service wiring (`llm-service-module.ts` and `provider-registry-module.ts`), and the runtime routers (`mode-router.ts`).  Modularity reduces coupling and makes it straightforward to replace or extend any piece without rippling changes through unrelated code.

Two classic **design patterns** are explicitly employed:

1. **Dependency Injection (DI)** – The `LLMServiceModule` class (see `llm-service-module.ts:50`) acts as a container that resolves the currently configured LLM provider.  Its public method `getLLMProvider` (line 100) returns the concrete implementation, allowing callers to depend on the abstraction rather than a hard‑coded class.  This promotes loose coupling, simplifies unit testing (providers can be mocked), and enables runtime swapping of providers.

2. **Factory Pattern** – The `ProviderRegistryModule` (see `provider-registry-module.ts:200`) maintains a registry of available LLM providers and exposes `createLLMProvider` (line 250) to instantiate the requested provider.  By centralising creation logic, the system can add new providers simply by registering them; the rest of the codebase remains unchanged.

The **GraphDatabaseAdapter** embodies a **separation‑of‑concerns** principle: it owns all persistence‑related responsibilities (synchronisation via `syncData` at line 123 and JSON export via `exportJSON` at line 150) while the rest of the component works with in‑memory representations.  This clear boundary makes the graph layer replaceable (e.g., swapping Graphology+LevelDB for another store) without affecting higher‑level logic.

Finally, **testability** is baked in through **Jest**.  The `jest.config.js` (line 10) defines the environment, and classes such as `ModeRouter` (`mode-router.ts:300`) have dedicated test suites that exercise both happy‑path and edge‑case scenarios.  This testing strategy reinforces the modular design and ensures that each isolated piece behaves as intended before integration.

---

## Implementation Details  

### GraphDatabaseAdapter (`storage/graph-database-adapter.ts`)  
* **`syncData` (line 123)** – Pulls changes from the in‑memory graph and writes them to the underlying LevelDB store.  It is invoked automatically whenever the component mutates the graph, guaranteeing eventual consistency.  
* **`exportJSON` (line 150)** – Serialises the current graph state into a JSON document that can be version‑controlled or consumed by external tools.  The export is triggered after each successful `syncData`, providing an audit trail of the knowledge base.

### ESLint Configuration (`.eslintrc.json`)  
The file defines the linting contract for the entire codebase.  Notable rules include:  
* **`indent`** (line 20) – Enforces a consistent indentation style, reducing diffs caused by formatting.  
* **`no-console`** (line 30) – Disallows stray `console.log` statements in production code, encouraging the use of the project’s logging abstraction.  

Because the configuration lives at the repository root, every developer and CI pipeline automatically inherits the same standards, which simplifies onboarding and reduces style‑related bugs.

### LLM Service Wiring (`llm-service-module.ts`)  
* **`LLMServiceModule` class (line 50)** – Registers provider implementations with the DI container during application bootstrap.  
* **`getLLMProvider` (line 100)** – Returns the concrete provider instance that matches the current configuration (e.g., OpenAI, Anthropic).  The method abstracts away provider‑specific initialization details, allowing downstream code to treat all providers uniformly.

### Provider Registry (`provider-registry-module.ts`)  
* **`ProviderRegistryModule` class (line 200)** – Holds a map of provider identifiers to factory functions.  
* **`createLLMProvider` (line 250)** – Given a provider key, it invokes the associated factory to produce a ready‑to‑use instance.  Adding a new provider merely requires registering a new factory; no changes to callers are needed.

### Runtime Modules (`mode-router.ts`, `dockerized-services.ts`, `wave-controller.ts`)  
Each of these classes follows the same pattern: they expose a small public API, rely on injected dependencies (e.g., the LLM provider from `LLMServiceModule`), and have isolated Jest test suites.  For example, `ModeRouter` (line 300) decides which LLM mode to invoke based on request metadata, while `DockerizedServices` (line 400) abstracts the lifecycle of containerised services, and `WaveController` (line 500) orchestrates higher‑level workflows.  Their independence is a direct result of the modular design described earlier.

---

## Integration Points  

* **Parent – Coding**:  CodingPatterns supplies the coding‑style and persistence foundation that the broader `Coding` component relies on.  Other sibling components (e.g., **KnowledgeManagement**) also consume the `GraphDatabaseAdapter`, ensuring a unified graph persistence strategy across the system.  

* **Sibling – LLMAbstraction**:  Both components share the same DI and factory mechanisms for LLM providers.  The `LLMServiceModule` in CodingPatterns mirrors the DI usage in `LLMAbstraction/lib/llm/llm-service.ts`, enabling seamless provider swapping across the entire codebase.  

* **Sibling – DockerizedServices**:  The `DockerizedServices` class (line 400) may launch containers that host the graph database or LLM inference services.  Because the graph adapter exports JSON (`exportJSON`), Dockerised services can mount the exported file for quick bootstrapping.  

* **Testing – Jest**:  The `jest.config.js` (line 10) is referenced by all sibling components; test suites for `ModeRouter`, `WaveController`, and even the `GraphDatabaseAdapter` are executed together, providing a single source of truth for code health.  

* **ESLint**:  The linting configuration is a project‑wide contract; any new module added under any sibling component automatically inherits the same rules, guaranteeing stylistic consistency.

---

## Usage Guidelines  

1. **Persisting Graph Data** – When mutating the knowledge graph, always invoke the high‑level API exposed by `GraphDatabaseAdapter`.  The adapter will internally call `syncData` to persist changes and `exportJSON` to keep the JSON snapshot up‑to‑date.  Direct writes to LevelDB are discouraged to avoid bypassing the synchronization logic.  

2. **Adding a New LLM Provider** – Register the provider’s factory in `ProviderRegistryModule` (e.g., `registry.register('myProvider', () => new MyProvider())`).  Then, update the configuration that `LLMServiceModule` reads so that `getLLMProvider` returns the new instance.  Because DI is used, existing consumers need not be altered.  

3. **Extending the Modular Runtime** – New operational modes should be added as separate classes (e.g., `NewModeRouter`) that implement the same interface expected by `ModeRouter`.  Wire them through the DI container and provide Jest test suites mirroring the pattern used for `ModeRouter`.  

4. **Linting Discipline** – Run `npm run lint` (or the equivalent CI step) before committing.  Respect the `indent` and `no-console` rules; if a rule must be relaxed for a specific file, add an inline ESLint comment rather than editing the global config.  

5. **Testing** – All new modules must include unit tests under the `__tests__` directory and be referenced in `jest.config.js`.  Aim for high coverage on edge cases, especially when dealing with asynchronous provider calls or graph synchronisation.  

6. **Docker Integration** – When a new service requires a persistent graph, mount the JSON export location defined by `GraphDatabaseAdapter.exportJSON` into the container.  This allows the container to initialise its in‑memory graph quickly without re‑syncing the whole LevelDB store.

---

### Architectural Patterns Identified  

* Dependency Injection (via `LLMServiceModule`)  
* Factory Pattern (via `ProviderRegistryModule.createLLMProvider`)  
* Modular Design / Separation of Concerns (distinct files for persistence, linting, routing, Docker services)  
* Test‑Driven Structure (Jest integration)  

### Design Decisions and Trade‑offs  

* **DI vs. Service Locator** – Choosing DI makes the codebase more testable but adds a small runtime container overhead.  
* **Factory Registry** – Centralising provider creation simplifies extension but introduces a single point of failure if the registry is mis‑configured.  
* **Automatic JSON Export** – Guarantees an up‑to‑date snapshot for external tooling; however, frequent exports can increase I/O load on large graphs.  
* **Strict ESLint Rules** – Improves code quality and onboarding speed, yet may require occasional rule overrides for legacy code.  

### System Structure Insights  

The component sits as a **foundational layer** within the `Coding` hierarchy, exposing services that are consumed by siblings such as **KnowledgeManagement** (graph persistence) and **LLMAbstraction** (LLM provider resolution).  Its child, **GraphDatabaseAdapter**, encapsulates all low‑level persistence concerns, while sibling modules each focus on a single responsibility, reflecting a clean, vertical slice architecture.

### Scalability Considerations  

* **Graph Persistence** – The use of Graphology + LevelDB scales well for read‑heavy workloads; however, write‑heavy bursts may need batching or background sync to avoid blocking `syncData`.  
* **Provider Registry** – Adding many providers does not affect runtime performance because factories are invoked lazily.  The DI container can be extended to support scoped lifetimes if provider initialization becomes costly.  
* **Modular Services** – Dockerized services can be horizontally scaled independently; the JSON export provides a lightweight state‑share mechanism for new container instances.  

### Maintainability Assessment  

Overall maintainability is high:

* **Clear separation** between concerns (persistence, linting, LLM wiring) reduces cognitive load.  
* **Standardised tooling** (ESLint, Jest) enforces consistent style and regression safety.  
* **DI and factories** enable painless swapping or mocking of external dependencies, which is essential for long‑term evolution.  
* The only potential maintenance hotspot is the **GraphDatabaseAdapter**’s synchronous export path; monitoring its performance and possibly making export asynchronous would further improve resilience.

By adhering to the guidelines above, developers can safely extend the **CodingPatterns** component while preserving the architectural integrity that the rest of the `Coding` ecosystem depends upon.


## Hierarchy Context

### Parent
- [Coding](./Coding.md) -- Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 8 major components: LiveLoggingSystem: The LiveLoggingSystem component utilizes the OntologyClassificationAgent class (integrations/mcp-server-semantic-analysis/src/agents/ontology-classifi; LLMAbstraction: The LLMAbstraction component utilizes a modular design, with its codebase organized into multiple modules and files, each with its own specific respon; DockerizedServices: The DockerizedServices component implements a modular design, with each service being a separate Docker container. This is evident in the use of Docke; Trajectory: The Trajectory component's use of dependency injection is evident in the SpecstoryAdapter class, where it utilizes a factory pattern to create instanc; KnowledgeManagement: The KnowledgeManagement component's utilization of a Graphology+LevelDB database for persistence, as seen in the GraphDatabaseAdapter (storage/graph-d; CodingPatterns: The CodingPatterns component utilizes the GraphDatabaseAdapter (storage/graph-database-adapter.ts) to manage graph data persistence. This adapter is r; ConstraintSystem: The ConstraintSystem component's modular architecture is evident in its utilization of the ContentValidationAgent, which is defined in the file integr; SemanticAnalysis: The SemanticAnalysis component's utilization of a DAG-based execution model with topological sort allows for efficient processing of git history and L.

### Children
- [GraphDatabaseAdapter](./GraphDatabaseAdapter.md) -- GraphDatabaseAdapter uses the `syncData` function (storage/graph-database-adapter.ts:123) to synchronize data with the graph database

### Siblings
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- The LiveLoggingSystem component utilizes the OntologyClassificationAgent class (integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts) for classifying observations against the ontology system. This classification process is crucial for providing meaningful insights into the conversations captured by the system. The OntologyClassificationAgent class is designed to work in conjunction with the modular design of the LiveLoggingSystem, allowing for easy extension and maintenance of the classification layers. For instance, the classifyObservation method in the OntologyClassificationAgent class takes in an observation object and returns a classified observation object, which is then used by the LiveLoggingSystem to capture and log the conversation.
- [LLMAbstraction](./LLMAbstraction.md) -- The LLMAbstraction component utilizes a modular design, with its codebase organized into multiple modules and files, each with its own specific responsibilities and functions. For instance, the LLMService (lib/llm/llm-service.ts) serves as the primary entry point for all LLM operations, handling mode routing, caching, and circuit breaking. This modular design promotes code reusability and maintainability, as seen in the use of design patterns such as dependency injection and factory patterns. The dependency injection in LLMService (lib/llm/llm-service.ts) enables the resolution of the current LLM provider and supports various LLM modes, making it easier to switch between different providers or modes without affecting the rest of the codebase.
- [DockerizedServices](./DockerizedServices.md) -- The DockerizedServices component implements a modular design, with each service being a separate Docker container. This is evident in the use of Docker Compose files, which define the services and their dependencies. For example, the docker-compose.yml file in the root directory defines the services and their dependencies. The LLMService class, located in lib/llm/llm-service.ts, is a high-level facade that handles mode routing, caching, and circuit breaking for all LLM operations. This modular design allows for easy addition or removal of services, making the system highly scalable and maintainable.
- [Trajectory](./Trajectory.md) -- The Trajectory component's use of dependency injection is evident in the SpecstoryAdapter class, where it utilizes a factory pattern to create instances of different connection methods. This is seen in the lib/integrations/specstory-adapter.js file, where the constructor() function is used to initialize the adapter with the required dependencies. The initialize() function is then used to set up the connection, and the logConversation() function is used to log any errors or warnings that occur during the connection process. This pattern allows for loose coupling between the adapter and the connection methods, making it easier to switch between different connection methods or add new ones.
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component's utilization of a Graphology+LevelDB database for persistence, as seen in the GraphDatabaseAdapter (storage/graph-database-adapter.ts), allows for efficient storage and querying of knowledge graphs. This choice of database is particularly noteworthy due to its ability to handle large amounts of data and provide a robust foundation for the component's intelligent routing mechanism. The intelligent routing, which switches between VKB API and direct database access, enables the component to optimize its interactions with the knowledge graph, thus improving overall performance. For instance, when an agent needs to store an entity, it can use the storeEntity method in GraphDatabaseAdapter, which ultimately relies on the Graphology+LevelDB database for persistence.
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem component's modular architecture is evident in its utilization of the ContentValidationAgent, which is defined in the file integrations/mcp-server-semantic-analysis/src/agents/content-validation-agent.ts. This agent is responsible for validating entity content against configured rules, and its implementation follows the constructor(config) + initialize() + execute(input) pattern, allowing for lazy initialization and execution. The ContentValidationAgent's constructor initializes the agent with a given configuration, while the initialize method sets up the necessary resources for validation. The execute method then takes an input and performs the actual validation against the configured rules.
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component's utilization of a DAG-based execution model with topological sort allows for efficient processing of git history and LSL sessions. This is evident in the OntologyClassificationAgent, which leverages the OntologyConfigManager, OntologyManager, and OntologyValidator classes to classify observations against the ontology system, as seen in the integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts file. The topological sort ensures that the agents are executed in a specific order, preventing any potential circular dependencies or inconsistencies in the knowledge entities extraction process.


---

*Generated from 6 observations*
