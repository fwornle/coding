# SemanticAnalysis

**Type:** Component

The SemanticAnalysis component employs a multi-agent architecture, with each agent designed to perform a specific task, such as the OntologyClassificationAgent, which utilizes the ontology system to classify observations. This agent is implemented in the file integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts and follows the BaseAgent pattern defined in integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts. The use of a standardized agent structure, as seen in the BaseAgent class, allows for easier development and maintenance of new agents. For instance, the SemanticAnalysisAgent, responsible for analyzing code files, is implemented in integrations/mcp-server-semantic-analysis/src/agents/semantic-analysis-agent.ts and leverages the LLMService from lib/llm/dist/index.js for language model-based analysis.

## What It Is  

The **SemanticAnalysis** component lives under the `integrations/mcp-server-semantic-analysis` directory and is realized as a **multi‑agent system**. Its core agents are defined in the `src/agents` folder:

* `base-agent.ts` – the abstract **BaseAgent** that supplies a common lifecycle and wiring for every agent.  
* `ontology-classification-agent.ts` – an **OntologyClassificationAgent** that classifies observations against the shared ontology.  
* `semantic-analysis-agent.ts` – a **SemanticAnalysisAgent** that drives code‑file analysis by calling the **LLMService** located in `lib/llm/dist/index.js`.  
* `code-graph-agent.ts` – a **CodeGraphAgent** that builds a knowledge graph from Tree‑sitter ASTs and persists it in **Memgraph**.  
* `content-validation-agent.ts` – a **ContentValidationAgent** that validates graph entities and detects staleness.

Together these agents form the **SemanticAnalysis** pipeline, which is a child of the top‑level **Coding** component. Its sibling components (LiveLoggingSystem, LLMAbstraction, DockerizedServices, Trajectory, KnowledgeManagement, CodingPatterns, ConstraintSystem) all share a modular, plug‑in style architecture, but only **SemanticAnalysis** focuses on code‑level semantic insight generation.

---

## Architecture and Design  

### Multi‑Agent Architecture  
The component follows a **multi‑agent pattern**: each concern (ontology classification, LLM‑driven analysis, graph construction, content validation) is encapsulated in its own agent class. All agents inherit from `BaseAgent` (`integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts`), which defines a standardized interface (initialisation, execution, teardown). This pattern gives a **clear separation of responsibilities** and makes it straightforward to add new agents without touching existing logic.

### Work‑Stealing Concurrency  
Processing of large code bases is parallelised using a **work‑stealing algorithm** driven by shared atomic index counters. The counters guarantee thread‑safe distribution of file‑processing tasks across worker threads, allowing each thread to “steal” work when it runs out of its own slice. This design maximises CPU utilisation on multi‑core machines while keeping the coordination logic lightweight.

### Knowledge‑Graph Construction  
`CodeGraphAgent` (`integrations/mcp-server-semantic-analysis/src/agents/code-graph-agent.ts`) parses source files with **Tree‑sitter** to obtain a high‑performance AST. The AST is traversed to extract entities (functions, classes, imports, etc.) and relationships, which are then materialised in **Memgraph**—the component’s chosen graph database. The graph enables downstream agents (e.g., `ContentValidationAgent`) to run expressive queries for reasoning and staleness detection.

### Modular LLM Integration  
The **LLMService** (`lib/llm/dist/index.js`) is a façade over multiple language‑model providers (see the sibling **LLMAbstraction** component). `SemanticAnalysisAgent` consumes this service to generate code summaries, recommendations, and other insights. Because the service is modular, new model providers can be added without altering the agent code.

### Ontology‑Based Classification  
`OntologyClassificationAgent` (`integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts`) taps into the shared **Ontology** (a child of SemanticAnalysis) to map raw observations to predefined concepts. This mirrors the usage of the same agent in the **LiveLoggingSystem** sibling, illustrating a reusable classification capability across the system.

---

## Implementation Details  

### BaseAgent (`base-agent.ts`)  
`BaseAgent` defines abstract methods such as `setup()`, `run()`, and `teardown()`. Concrete agents extend this class, inheriting common logging, error handling, and lifecycle orchestration. The pattern reduces boilerplate and enforces a uniform contract across the pipeline.

### OntologyClassificationAgent (`ontology-classification-agent.ts`)  
- **Dependency**: the global ontology store (part of the **Ontology** child).  
- **Key Method**: `classify(observation)`, which receives a raw observation (often a transcript from another component) and returns an ontology node identifier.  
- **Reuse**: also instantiated by the **LiveLoggingSystem** sibling, demonstrating cross‑component reuse of classification logic.

### SemanticAnalysisAgent (`semantic-analysis-agent.ts`)  
- **Workflow**: iterates over a list of source files assigned by the work‑stealing scheduler, reads each file, and calls `LLMService.analyzeCode(fileContent)`.  
- **Output**: produces **Insights** objects (code summaries, refactor suggestions) that are later persisted or displayed.  
- **Integration**: relies on the LLMService implementation in `lib/llm/dist/index.js`, which itself abstracts provider‑specific details via the registry pattern seen in the **LLMAbstraction** sibling.

### CodeGraphAgent (`code-graph-agent.ts`)  
- **Parsing**: uses Tree‑sitter parsers (language‑specific grammars) to generate an AST for each file.  
- **Graph Building**: walks the AST, creates nodes/edges representing code entities, and writes them to Memgraph via a thin driver wrapper.  
- **Collaboration**: hands off the freshly built graph to `ContentValidationAgent` for freshness checks.

### ContentValidationAgent (`content-validation-agent.ts`)  
- **Validation Logic**: combines metadata timestamps with content‑based hash checks to flag stale entities.  
- **Staleness Detection**: runs a periodic algorithm that queries Memgraph for entities whose `lastUpdated` field exceeds a configurable threshold.  
- **Maintenance**: removes or marks outdated nodes, ensuring downstream consumers (e.g., UI dashboards) see only current knowledge.

### Concurrency Mechanics  
All agents that process files share a **global atomic index** (e.g., `AtomicUsize` in TypeScript). Worker threads atomically increment the counter to fetch the next file index, guaranteeing no two threads work on the same file. When a thread exhausts its local batch, it attempts to “steal” work from another thread’s queue, balancing load dynamically.

---

## Integration Points  

1. **Ontology** (child) – The `OntologyClassificationAgent` reads from the ontology store defined under the SemanticAnalysis component. This store is also referenced by other components that need semantic categorisation.  
2. **LLMService** (child) – Located at `lib/llm/dist/index.js`, it is the sole provider of language‑model capabilities for the component. Its modular registry (exposed in the **LLMAbstraction** sibling) lets the `SemanticAnalysisAgent` switch providers without code changes.  
3. **Memgraph** – The graph database is accessed exclusively through `CodeGraphAgent`. Other components, such as **KnowledgeManagement**, interact with Memgraph via the `GraphDatabaseAdapter` (`storage/graph-database-adapter.ts`), enabling a shared knowledge‑graph layer across the ecosystem.  
4. **Tree‑sitter** – The parsing library is a third‑party dependency imported by `CodeGraphAgent`. Its language‑agnostic grammars allow the component to support the same set of languages as the **Trajectory** sibling, which also relies on language‑specific adapters.  
5. **Work‑Stealing Scheduler** – Implemented inside the agents’ run loops, this scheduler is a shared concurrency primitive that does not expose a public API but influences how the component scales on multi‑core hardware.  
6. **Parent – Coding** – The parent component aggregates all child pipelines (including **SemanticAnalysis**) and provides common infrastructure such as logging, configuration, and lifecycle management.  

---

## Usage Guidelines  

* **Instantiate via BaseAgent** – When adding a new agent, extend `BaseAgent` and implement `setup`, `run`, and `teardown`. This guarantees compatibility with the work‑stealing scheduler and the component’s logging conventions.  
* **Respect the Atomic Counter Contract** – Agents that process files must obtain their work slice by calling the shared atomic index API; direct list slicing can break the load‑balancing guarantees.  
* **Prefer Tree‑sitter for New Languages** – To support additional programming languages, add the corresponding Tree‑sitter grammar and update the AST visitor in `code-graph-agent.ts`. This keeps parsing performance consistent.  
* **Leverage LLMService Registry** – Register any new LLM provider in the registry used by `lib/llm/provider-registry.js` (as done in **LLMAbstraction**) so that `SemanticAnalysisAgent` can transparently select it via configuration.  
* **Validate Graph Freshness** – Run `ContentValidationAgent` after any bulk graph update to ensure stale nodes are pruned. Schedule it as a periodic background task if the codebase changes frequently.  
* **Monitor Concurrency** – The work‑stealing algorithm assumes the number of worker threads matches the number of physical cores. Over‑provisioning can lead to context‑switch overhead; tune the thread pool size via the component’s config file.  

---

### Architectural Patterns Identified  

1. **Multi‑Agent Architecture** – distinct agents for classification, analysis, graph construction, and validation.  
2. **Template Method / Abstract Base Class** – `BaseAgent` provides a skeletal algorithm for agents.  
3. **Work‑Stealing Concurrency** – dynamic load balancing using atomic counters.  
4. **Facade / Registry Pattern** – `LLMService` acts as a façade over multiple provider implementations managed by a registry.  
5. **Adapter Pattern** – Tree‑sitter adapters translate source code into a uniform AST representation.  

### Design Decisions and Trade‑offs  

| Decision | Benefit | Trade‑off |
|----------|---------|-----------|
| Separate agents per concern | High cohesion, easy testing, extensibility | Added coordination overhead; more moving parts to orchestrate |
| Work‑stealing with atomic counters | Near‑optimal CPU utilisation on large codebases | Complexity in debugging race conditions; requires careful thread‑pool sizing |
| Use of Memgraph for the knowledge graph | Fast graph queries, native Cypher support | Introduces an external service dependency; operational overhead |
| Tree‑sitter for parsing | Language‑agnostic, high‑performance ASTs | Need to maintain grammar versions; learning curve for custom visitors |
| Modular LLMService with provider registry | Plug‑and‑play model providers, future‑proof | Slight indirection overhead; consistency across providers must be ensured |

### System Structure Insights  

* **Parent‑Child Relationship** – `SemanticAnalysis` is a child of the overarching **Coding** component, inheriting shared infrastructure (logging, config).  
* **Sibling Reuse** – Both **LiveLoggingSystem** and **SemanticAnalysis** reuse `OntologyClassificationAgent`, demonstrating a cross‑component ontology‑driven classification service.  
* **Child Modules** – `Pipeline` (BaseAgent), `Ontology` (classification logic), `Insights` (LLM‑generated outputs), and `LLMService` (model façade) are tightly coupled yet independently replaceable, reflecting a clean modular hierarchy.  

### Scalability Considerations  

* **Horizontal Scaling** – The work‑stealing scheduler can distribute file‑processing across many threads on a single machine; to scale beyond a single host, the design could be extended by sharding the codebase and running multiple instances that each own a subset of the atomic counter space.  
* **Graph Database Scaling** – Memgraph supports clustering; as the knowledge graph grows, adding Memgraph nodes can maintain query latency.  
* **LLM Throughput** – `LLMService` can be configured with multiple provider instances; batching requests or using asynchronous calls can mitigate rate‑limit bottlenecks.  
* **Parsing Throughput** – Tree‑sitter parsing is CPU‑bound; the current concurrency model already maximises core usage, but adding GPU‑accelerated parsing is not currently supported.  

### Maintainability Assessment  

The **BaseAgent** abstraction and the clear separation of concerns make the codebase **highly maintainable**: new agents can be added with minimal impact on existing ones. The reliance on well‑documented third‑party libraries (Tree‑sitter, Memgraph, LLM providers) reduces the need for custom parsing or graph logic. However, the **multi‑agent orchestration** and **work‑stealing concurrency** introduce non‑trivial runtime behavior that requires thorough testing and monitoring. The modular LLM registry, while flexible, demands disciplined versioning of provider adapters to avoid breaking changes. Overall, the design strikes a good balance between extensibility and operational complexity, positioning the component for long‑term evolution within the broader **Coding** ecosystem.


## Hierarchy Context

### Parent
- [Coding](./Coding.md) -- Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 8 major components: LiveLoggingSystem: The LiveLoggingSystem component utilizes the OntologyClassificationAgent, located in integrations/mcp-server-semantic-analysis/src/agents/ontology-cla; LLMAbstraction: The LLMAbstraction component's modular architecture, as seen in the separate modules for different providers (e.g., lib/llm/providers/dmr-provider.ts ; DockerizedServices: The DockerizedServices component utilizes a modular architecture, with separate directories for each service, allowing for flexible deployment and man; Trajectory: The Trajectory component utilizes a modular architecture, with each language model having its own directory and configuration, allowing for easy maint; KnowledgeManagement: The KnowledgeManagement component utilizes the GraphDatabaseAdapter, located in storage/graph-database-adapter.ts, to interact with the graph database; CodingPatterns: The CodingPatterns component utilizes a modular architecture for language models, as observed in the llm-providers.yaml file. Each language model has ; ConstraintSystem: The ConstraintSystem component employs a modular architecture, integrating multiple sub-components such as the ContentValidationAgent, HookConfigLoade; SemanticAnalysis: The SemanticAnalysis component employs a multi-agent architecture, with each agent designed to perform a specific task, such as the OntologyClassifica.

### Children
- [Pipeline](./Pipeline.md) -- The BaseAgent class in integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts provides a standardized structure for agents, allowing for easier development and maintenance of new agents.
- [Ontology](./Ontology.md) -- The OntologyClassificationAgent in integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts utilizes the ontology system to classify observations.
- [Insights](./Insights.md) -- The SemanticAnalysisAgent in integrations/mcp-server-semantic-analysis/src/agents/semantic-analysis-agent.ts leverages the LLMService from lib/llm/dist/index.js for language model-based analysis.
- [LLMService](./LLMService.md) -- The LLMService in lib/llm/dist/index.js provides a language model-based analysis, which is used by the Pipeline and Insights sub-components.

### Siblings
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- The LiveLoggingSystem component utilizes the OntologyClassificationAgent, located in integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts, to classify observations against the ontology system. This is evident in the way the agent is instantiated and used within the LiveLoggingSystem's classification layer. The OntologyClassificationAgent's classify method is called with the session transcript as an argument, allowing the system to categorize the conversation based on predefined ontology rules. Furthermore, the use of the TranscriptAdapter, defined in lib/agent-api/transcript-api.js, as an abstract base class for agent-specific transcript adapters, enables the system to handle transcripts from various agents in a unified manner. The TranscriptAdapter's adaptTranscript method is responsible for converting agent-specific transcripts into a standardized format, which is then passed to the OntologyClassificationAgent for classification.
- [LLMAbstraction](./LLMAbstraction.md) -- The LLMAbstraction component's modular architecture, as seen in the separate modules for different providers (e.g., lib/llm/providers/dmr-provider.ts and lib/llm/providers/anthropic-provider.ts), allows for easy maintenance and extension of the system. This is further facilitated by the use of a registry (lib/llm/provider-registry.js) to manage providers, enabling the addition or removal of providers without modifying the core logic of the LLMService class (lib/llm/llm-service.ts). The registry pattern helps to decouple the provider implementations from the service class, making it easier to swap out or add new providers as needed.
- [DockerizedServices](./DockerizedServices.md) -- The DockerizedServices component utilizes a modular architecture, with separate directories for each service, allowing for flexible deployment and management. This is evident in the directory structure, where each service has its own subdirectory, such as semantic analysis, constraint monitoring, and code graph construction. The lib/llm/llm-service.ts file, which contains the LLMService class, provides a high-level facade for LLM operations, handling mode routing, caching, and circuit breaking. This design decision enables loose coupling between services and promotes scalability. Furthermore, the use of docker-compose for service orchestration, as seen in the docker-compose.yml file, provides a robust framework for integrating multiple services.
- [Trajectory](./Trajectory.md) -- The Trajectory component utilizes a modular architecture, with each language model having its own directory and configuration, allowing for easy maintenance and scalability. For instance, the SpecstoryAdapter (lib/integrations/specstory-adapter.js) is used to connect to the Specstory extension via HTTP, IPC, or file watch, demonstrating a flexible approach to integrations. This adapter implements a retry-with-backoff pattern in the connectViaHTTP method (lib/integrations/specstory-adapter.js:123) to establish a connection with the Specstory extension, showcasing a robust approach to handling potential connection issues.
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component utilizes the GraphDatabaseAdapter, located in storage/graph-database-adapter.ts, to interact with the graph database. This adapter enables the component to perform tasks such as entity storage and relationship management, while also providing automatic JSON export sync. The use of this adapter allows for a flexible and scalable solution for knowledge graph management. Furthermore, the intelligent routing implemented in the GraphDatabaseAdapter enables the component to efficiently route requests for API or direct database access, ensuring optimal performance. The code in storage/graph-database-adapter.ts demonstrates how the adapter is used to handle concurrent access and provide a robust solution for graph database interactions.
- [CodingPatterns](./CodingPatterns.md) -- The CodingPatterns component utilizes a modular architecture for language models, as observed in the llm-providers.yaml file. Each language model has its own directory and configuration, allowing for easier maintenance and extension of the system. For instance, the lib/llm/provider-registry.js file defines a provider registry that manages different providers and enables provider switching based on mode and availability. This modular design enables developers to add or remove language models without affecting the overall system.
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem component employs a modular architecture, integrating multiple sub-components such as the ContentValidationAgent, HookConfigLoader, and ViolationCaptureService. For instance, the ContentValidationAgent, located in integrations/mcp-server-semantic-analysis/src/agents/content-validation-agent.ts, is utilized for entity content validation and refresh. This modular design allows for easier maintenance and updates, as each sub-component can be modified or replaced independently without affecting the entire system.


---

*Generated from 6 observations*
