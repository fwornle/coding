# CodingPatterns

**Type:** Component

The CodingPatterns component's modular architecture and provider registry enable it to support multiple language models and providers, making it a highly extensible and flexible system. The lib/llm/provider-registry.js file provides a clear example of how this registry is implemented, demonstrating how developers can add or remove providers and language models as needed. This flexibility is crucial for the system's long-term maintenance and development, as it allows developers to easily adapt the system to changing requirements and technologies.

## What It Is  

The **CodingPatterns** component lives at the heart of the *Coding* knowledge hierarchy. Its concrete artefacts are scattered across a handful of well‑named files:

* **`llm‑providers.yaml`** – the declarative catalogue that enumerates each language‑model provider and its configuration.  
* **`lib/llm/provider‑registry.js`** – the runtime registry that loads the providers defined in the YAML, decides which one to use based on the current *mode* and provider *availability*, and exposes a simple lookup API.  
* **`wave‑controller.ts`** – the orchestrator for “wave agents”.  It follows a three‑step pattern (constructor → lazy LLM init → execute) that guarantees agents are only materialised when required.  
* **`storage/graph‑database‑adapter.ts`** – the persistence façade for the Knowledge Management subsystem.  It automatically synchronises the in‑memory graph to a JSON export, keeping the external graph database current.  
* **`code‑graph‑rag/assets/…`** – a collection of Tree‑sitter‑derived AST samples that the **`CodeGraphConstructor`** class consumes to build knowledge‑graphs.  

Together these files give CodingPatterns the ability to **switch language‑model providers on the fly**, **construct and persist rich code knowledge graphs**, and **run specialised wave agents** that leverage the selected LLM.  The component sits under the parent **Coding** node, shares the provider‑registry implementation with its sibling **LLMAbstraction**, re‑uses the **GraphDatabaseAdapter** that belongs to the sibling **KnowledgeManagement**, and exposes child artefacts (**DesignPatterns**, **CodingConventions**, **ArchitectureGuidelines**) that document the very patterns it implements.

---

## Architecture and Design  

### Modular Provider Architecture  
The most visible architectural decision is a **modular, plug‑in style architecture** for language‑model providers.  Each provider lives in its own directory (e.g., `lib/llm/providers/anthropic-provider.ts`, `lib/llm/providers/dmr-provider.ts`) and is declared in **`llm‑providers.yaml`**.  The **Provider Registry** (`lib/llm/provider‑registry.js`) embodies the *Registry* pattern: it maintains a map of provider identifiers → provider instances, and supplies `getProvider(mode)` logic that selects the appropriate implementation based on runtime mode (e.g., *development*, *production*) and health checks.  This design decouples the rest of the system from concrete provider classes, enabling **zero‑impact addition or removal** of models.

### Wave‑Agent Execution Pattern  
Wave agents are orchestrated by **`wave‑controller.ts`**.  The file demonstrates a **lazy‑initialisation + command pattern**: the controller’s constructor records configuration, the LLM client is instantiated only when `execute()` is called, and the actual work is delegated to a concrete *wave* object that implements a known interface (`run(input): output`).  This pattern reduces start‑up cost and isolates side‑effects (LLM network calls) to the execution phase.

### Retry‑With‑Backoff for Resilience  
Both the **`ConnectionHandler`** (used for generic external services) and the **`SpecstoryAdapter.connectViaHTTP`** method implement a **retry‑with‑backoff** strategy.  The algorithm retries a failed request a bounded number of times, waiting an exponentially increasing interval (e.g., 100 ms → 200 ms → 400 ms).  By embedding this logic in the connection layer, the component shields higher‑level code from transient network glitches, improving overall reliability.

### Graph Persistence & Knowledge Construction  
The **`GraphDatabaseAdapter`** (`storage/graph-database-adapter.ts`) acts as a **Facade** over the underlying graph store.  Its responsibilities include:

* Translating in‑memory graph objects to the storage format.  
* Performing an **automatic JSON export sync** after each mutation, guaranteeing that the persisted graph mirrors the latest state.  

The **`CodeGraphConstructor`** (referenced from `code‑graph‑rag/assets/`) consumes **Tree‑sitter** AST nodes to produce a domain‑specific knowledge graph (nodes for functions, classes, imports, etc., edges for call‑relations).  The constructor pushes the resulting graph into the adapter, completing the *extract‑transform‑load* pipeline.

### Shared Infrastructure Across Siblings  
Because the **Provider Registry** lives in `lib/llm/provider-registry.js`, both **CodingPatterns** and its sibling **LLMAbstraction** reuse the same registry instance, ensuring a single source of truth for provider availability.  Likewise, **CodingPatterns** leverages the **GraphDatabaseAdapter** that is also the cornerstone of the **KnowledgeManagement** sibling, fostering a unified persistence strategy across the codebase.

---

## Implementation Details  

### Provider Registry (`lib/llm/provider-registry.js`)  
* **Data structures** – a plain JavaScript `Map<string, Provider>` keyed by provider name.  
* **API** – `registerProvider(name, providerClass)`, `getProvider(mode)`, `listAvailable()`.  
* **Mode handling** – reads the current mode from a global config, then selects the first provider whose `isAvailable()` returns true.  If none match, it falls back to a default (often a mock provider used in tests).  

### Wave Controller (`wave-controller.ts`)  
```ts
export class WaveController {
  private llm?: LLMClient;          // lazily created
  constructor(private readonly config: WaveConfig) {}
  private async initLLM() {
    if (!this.llm) {
      const provider = ProviderRegistry.getProvider(this.config.mode);
      this.llm = await provider.createClient(this.config);
    }
  }
  async execute(input: WaveInput): Promise<WaveOutput> {
    await this.initLLM();
    const wave = new SpecificWave(this.llm);
    return wave.run(input);
  }
}
```  
The three‑step flow guarantees that the heavy LLM client is only instantiated when the wave actually runs, keeping the controller lightweight for scenarios where waves are conditionally triggered.

### Retry‑With‑Backoff (ConnectionHandler & SpecstoryAdapter)  
Both classes expose a `retry(fn, attempts = 5, baseDelay = 100)` helper.  The algorithm:

```js
async function retry(fn, attempts, baseDelay) {
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (e) {
      if (i === attempts - 1) throw e;
      await sleep(baseDelay * 2 ** i); // exponential back‑off
    }
  }
}
```  

`SpecstoryAdapter.connectViaHTTP` wraps the HTTP call with this helper, ensuring that temporary outages do not cause permanent failures.

### Graph Database Adapter (`storage/graph-database-adapter.ts`)  
* **Constructor** – accepts a low‑level driver (e.g., Neo4j, JanusGraph) and a path for the JSON export file.  
* **CRUD methods** – `addNode(node)`, `addEdge(source, target, type)`, `removeNode(id)`, each of which invokes the driver and then calls `syncExport()`.  
* **`syncExport()`** – serialises the whole graph to JSON and writes it atomically to the configured location.  This guarantees that any downstream consumer that reads the JSON file always sees a consistent snapshot.

### Code Graph Construction (`CodeGraphConstructor`)  
* **AST ingestion** – uses Tree‑sitter to parse source files into a concrete syntax tree.  
* **Visitor pattern** – walks the AST, mapping node types (function, class, import) to graph nodes, and establishing edges for call‑relationships, inheritance, and module dependencies.  
* **Persistence** – after the in‑memory graph is built, the constructor calls `graphAdapter.addNode/Edge` for each element, triggering the automatic JSON sync described above.

---

## Integration Points  

1. **LLM Provider Ecosystem** – The same `provider‑registry.js` is consumed by **LLMAbstraction** (which houses the high‑level `LLMService` façade) and by **CodingPatterns**’ wave agents.  Any new provider added to `llm‑providers.yaml` instantly becomes visible to both components.  

2. **Knowledge Management** – The **GraphDatabaseAdapter** is a shared persistence contract.  **CodingPatterns** builds knowledge graphs via `CodeGraphConstructor`, while **KnowledgeManagement** reads, queries, and updates those graphs for downstream tasks (e.g., semantic search, RAG).  

3. **External Integrations** – The **SpecstoryAdapter** (found in the sibling **Trajectory** component) demonstrates how CodingPatterns can reach out to external services using the retry‑with‑backoff logic.  This pattern is reused by the **ConnectionHandler** for any other HTTP/IPC endpoints that wave agents might need (e.g., code‑review APIs).  

4. **Parent‑Level Coordination** – The **Coding** root component aggregates the outputs of all child components.  CodingPatterns contributes its *design‑time* artefacts (provider configurations, wave definitions) to the overall project scaffolding, while also feeding runtime artefacts (knowledge graphs) to the **SemanticAnalysis** sibling, which runs multi‑agent pipelines that may invoke wave agents as sub‑tasks.  

5. **Child Documentation** – The **DesignPatterns**, **CodingConventions**, and **ArchitectureGuidelines** children expose the same registry and wave‑agent conventions as documentation assets, ensuring that developers downstream have a single source of truth for the patterns implemented in CodingPatterns.

---

## Usage Guidelines  

* **Adding a New LLM Provider** – Create a provider directory under `lib/llm/providers/`, implement the required interface (`createClient`, `isAvailable`), add an entry to `llm‑providers.yaml` with the provider’s name and configuration, then register it in `provider‑registry.js` via `registerProvider`.  No changes to wave agents or other consumers are required.  

* **Writing a Wave Agent** – Follow the three‑step pattern demonstrated in `wave‑controller.ts`:  
  1. **Constructor** – accept configuration but do not instantiate the LLM.  
  2. **Lazy LLM Init** – call `ProviderRegistry.getProvider(mode)` inside an async `initLLM()` helper.  
  3. **Execute** – perform the agent’s core logic in a `run()` method that receives input and returns output.  Keep side‑effects (network calls, file writes) inside `run` so they are only triggered on explicit execution.  

* **Persisting Knowledge Graphs** – Use the `GraphDatabaseAdapter` directly or via the `CodeGraphConstructor`.  Never write directly to the JSON export file; always go through the adapter so that automatic sync is honoured.  

* **Handling External Connections** – Wrap any HTTP/IPC call with the provided `retry` helper (or call `ConnectionHandler.connect()`) to benefit from exponential back‑off.  Adjust the `attempts` and `baseDelay` parameters only after measuring latency in the target environment.  

* **Naming & Conventions** – Follow the **PascalCase** naming style highlighted in the **CodingConventions** child component.  Provider names, wave classes, and graph node types should all respect this convention to keep the codebase searchable and consistent.  

* **Testing** – Because providers are decoupled via the registry, unit tests can inject a mock provider by calling `ProviderRegistry.registerProvider('mock', MockProvider)`.  Wave agents can then be exercised without real LLM calls, and the GraphDatabaseAdapter can be swapped for an in‑memory stub during CI runs.

---

### 1. Architectural patterns identified  

* **Modular / Plug‑in Architecture** – per‑provider directories and a central registry.  
* **Registry Pattern** – `lib/llm/provider‑registry.js` maintains a runtime map of providers.  
* **Facade Pattern** – `storage/graph-database-adapter.ts` hides the details of the underlying graph store.  
* **Lazy‑initialisation + Command Pattern** – wave agents are instantiated only when `execute()` runs.  
* **Retry‑With‑Backoff (Resilience) Pattern** – used in `ConnectionHandler` and `SpecstoryAdapter`.  
* **Visitor / AST Traversal Pattern** – Tree‑sitter AST walk inside `CodeGraphConstructor`.  

### 2. Design decisions and trade‑offs  

| Decision | Benefit | Trade‑off |
|----------|---------|-----------|
| Separate provider directories & YAML config | Clear separation, easy addition/removal, environment‑specific configs | Slight runtime overhead for registry lookup; must keep YAML and code in sync |
| Provider Registry centralised in `lib/llm/provider-registry.js` | Single source of truth, shared across siblings (LLMAbstraction, CodingPatterns) | Tight coupling of all components to the same registry; a breaking change in the registry affects many consumers |
| Lazy LLM creation in wave agents | Reduces memory/CPU at start‑up, avoids unnecessary API keys usage | First execution incurs latency; developers must ensure `await initLLM()` is called before any LLM‑dependent call |
| Automatic JSON export sync in GraphDatabaseAdapter | Guarantees external consumers always see the latest graph, simplifies backup | Extra I/O on every mutation; may become a bottleneck under very high write throughput |
| Retry‑with‑backoff at connection layer | Improves resilience without littering business logic with retry code | Increases overall latency for transient failures; needs careful tuning to avoid overwhelming the target service |

### 3. System structure insights  

* **Hierarchical organization** – The component sits under the *Coding* root, shares infrastructure with siblings, and exposes child artefacts that document its own patterns.  
* **Shared libraries** – `lib/llm/` is a common ground for both **CodingPatterns** and **LLMAbstraction**, reinforcing the “don’t duplicate provider logic” principle.  
* **Cross‑component contracts** – `GraphDatabaseAdapter` is the contract between **CodingPatterns**, **KnowledgeManagement**, and any future analytics component.  
* **Extensibility hotspots** – Adding a new provider or a new wave agent requires changes only in the provider directory or in a new wave class; no core files need to be touched.

### 4. Scalability considerations  

* **Provider scaling** – Because each provider is isolated, horizontal scaling of LLM calls can be achieved by deploying multiple instances of a provider client behind a load balancer, without touching the registry.  
* **Graph persistence** – The automatic JSON export is simple and works well for modest graph sizes. For very large knowledge graphs, the sync could become I/O‑bound; a future iteration might replace the JSON export with incremental change logs or a streaming export mechanism.  
* **Wave agent concurrency** – Wave controllers are lightweight; spawning many concurrent wave agents is feasible, but each will lazily create its own LLM client. Pooling LLM clients or sharing a singleton per provider could improve throughput.  
* **Retry policy** – Exponential back‑off mitigates thundering‑herd problems during outages, but the max‑attempt count should be configurable per integration to avoid long stalls in high‑traffic scenarios.

### 5. Maintainability assessment  

* **High** – The modular directory layout, explicit YAML config, and central registry make it straightforward for a newcomer to locate the code responsible for a given language model.  
* **Clear conventions** – Consistent PascalCase naming (as enforced by the **CodingConventions** child) and the repeated pattern in `wave‑controller.ts` provide a predictable mental model.  
* **Potential technical debt** – The automatic JSON sync in the GraphDatabaseAdapter could become a hidden performance bottleneck; monitoring and possibly refactoring it into a batched write system would preserve maintainability as data volume grows.  
* **Documentation synergy** – The child components (**DesignPatterns**, **ArchitectureGuidelines**) already capture the same patterns, ensuring that documentation and implementation stay aligned, which further reduces maintenance friction.  

---  

*In summary, CodingPatterns exemplifies a clean, extensible architecture built around a provider registry, lazy‑initialized wave agents, resilient connection handling, and a unified graph persistence layer.  Its design choices foster flexibility and reuse across the broader **Coding** ecosystem while providing a solid foundation for future scaling and evolution.*


## Hierarchy Context

### Parent
- [Coding](./Coding.md) -- Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 8 major components: LiveLoggingSystem: The LiveLoggingSystem component utilizes the OntologyClassificationAgent, located in integrations/mcp-server-semantic-analysis/src/agents/ontology-cla; LLMAbstraction: The LLMAbstraction component's modular architecture, as seen in the separate modules for different providers (e.g., lib/llm/providers/dmr-provider.ts ; DockerizedServices: The DockerizedServices component utilizes a modular architecture, with separate directories for each service, allowing for flexible deployment and man; Trajectory: The Trajectory component utilizes a modular architecture, with each language model having its own directory and configuration, allowing for easy maint; KnowledgeManagement: The KnowledgeManagement component utilizes the GraphDatabaseAdapter, located in storage/graph-database-adapter.ts, to interact with the graph database; CodingPatterns: The CodingPatterns component utilizes a modular architecture for language models, as observed in the llm-providers.yaml file. Each language model has ; ConstraintSystem: The ConstraintSystem component employs a modular architecture, integrating multiple sub-components such as the ContentValidationAgent, HookConfigLoade; SemanticAnalysis: The SemanticAnalysis component employs a multi-agent architecture, with each agent designed to perform a specific task, such as the OntologyClassifica.

### Children
- [DesignPatterns](./DesignPatterns.md) -- The lib/llm/provider-registry.js file defines a provider registry that manages different providers, enabling provider switching based on mode and availability.
- [CodingConventions](./CodingConventions.md) -- The use of a consistent naming convention, such as PascalCase, is evident throughout the project, as seen in the lib/llm/provider-registry.js file.
- [ArchitectureGuidelines](./ArchitectureGuidelines.md) -- The use of a modular architecture enables developers to add or remove language models without affecting the overall system, as seen in the directory structure of the project.

### Siblings
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- The LiveLoggingSystem component utilizes the OntologyClassificationAgent, located in integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts, to classify observations against the ontology system. This is evident in the way the agent is instantiated and used within the LiveLoggingSystem's classification layer. The OntologyClassificationAgent's classify method is called with the session transcript as an argument, allowing the system to categorize the conversation based on predefined ontology rules. Furthermore, the use of the TranscriptAdapter, defined in lib/agent-api/transcript-api.js, as an abstract base class for agent-specific transcript adapters, enables the system to handle transcripts from various agents in a unified manner. The TranscriptAdapter's adaptTranscript method is responsible for converting agent-specific transcripts into a standardized format, which is then passed to the OntologyClassificationAgent for classification.
- [LLMAbstraction](./LLMAbstraction.md) -- The LLMAbstraction component's modular architecture, as seen in the separate modules for different providers (e.g., lib/llm/providers/dmr-provider.ts and lib/llm/providers/anthropic-provider.ts), allows for easy maintenance and extension of the system. This is further facilitated by the use of a registry (lib/llm/provider-registry.js) to manage providers, enabling the addition or removal of providers without modifying the core logic of the LLMService class (lib/llm/llm-service.ts). The registry pattern helps to decouple the provider implementations from the service class, making it easier to swap out or add new providers as needed.
- [DockerizedServices](./DockerizedServices.md) -- The DockerizedServices component utilizes a modular architecture, with separate directories for each service, allowing for flexible deployment and management. This is evident in the directory structure, where each service has its own subdirectory, such as semantic analysis, constraint monitoring, and code graph construction. The lib/llm/llm-service.ts file, which contains the LLMService class, provides a high-level facade for LLM operations, handling mode routing, caching, and circuit breaking. This design decision enables loose coupling between services and promotes scalability. Furthermore, the use of docker-compose for service orchestration, as seen in the docker-compose.yml file, provides a robust framework for integrating multiple services.
- [Trajectory](./Trajectory.md) -- The Trajectory component utilizes a modular architecture, with each language model having its own directory and configuration, allowing for easy maintenance and scalability. For instance, the SpecstoryAdapter (lib/integrations/specstory-adapter.js) is used to connect to the Specstory extension via HTTP, IPC, or file watch, demonstrating a flexible approach to integrations. This adapter implements a retry-with-backoff pattern in the connectViaHTTP method (lib/integrations/specstory-adapter.js:123) to establish a connection with the Specstory extension, showcasing a robust approach to handling potential connection issues.
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component utilizes the GraphDatabaseAdapter, located in storage/graph-database-adapter.ts, to interact with the graph database. This adapter enables the component to perform tasks such as entity storage and relationship management, while also providing automatic JSON export sync. The use of this adapter allows for a flexible and scalable solution for knowledge graph management. Furthermore, the intelligent routing implemented in the GraphDatabaseAdapter enables the component to efficiently route requests for API or direct database access, ensuring optimal performance. The code in storage/graph-database-adapter.ts demonstrates how the adapter is used to handle concurrent access and provide a robust solution for graph database interactions.
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem component employs a modular architecture, integrating multiple sub-components such as the ContentValidationAgent, HookConfigLoader, and ViolationCaptureService. For instance, the ContentValidationAgent, located in integrations/mcp-server-semantic-analysis/src/agents/content-validation-agent.ts, is utilized for entity content validation and refresh. This modular design allows for easier maintenance and updates, as each sub-component can be modified or replaced independently without affecting the entire system.
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component employs a multi-agent architecture, with each agent designed to perform a specific task, such as the OntologyClassificationAgent, which utilizes the ontology system to classify observations. This agent is implemented in the file integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts and follows the BaseAgent pattern defined in integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts. The use of a standardized agent structure, as seen in the BaseAgent class, allows for easier development and maintenance of new agents. For instance, the SemanticAnalysisAgent, responsible for analyzing code files, is implemented in integrations/mcp-server-semantic-analysis/src/agents/semantic-analysis-agent.ts and leverages the LLMService from lib/llm/dist/index.js for language model-based analysis.


---

*Generated from 7 observations*
