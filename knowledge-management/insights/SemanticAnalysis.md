# SemanticAnalysis

**Type:** Component

The BaseAgent class, defined in integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts, provides a foundation for the various agents within the SemanticAnalysis component. This class includes a confidence calculation mechanism, which determines the accuracy of an agent's output, as well as an issue detection mechanism, which identifies any potential problems or inconsistencies in the data. The BaseAgent class also defines a standard response envelope creation pattern, ensuring consistency in the output of the various agents. By leveraging this base class, the agents within the component can focus on their specific tasks, while relying on the BaseAgent to handle common functionality and ensure consistency across the component.

## What It Is  

The **SemanticAnalysis** component lives under the `integrations/mcp-server-semantic-analysis/src/agents/` directory and is realized as a collection of tightly‑coupled but **modular agents**.  The entry points for the most important agents are:  

* `ontology-classification-agent.ts` – the **OntologyClassificationAgent** that classifies observations against the system ontology.  
* `semantic-analysis-agent.ts` – the **SemanticAnalysisAgent** that parses source files with **Tree‑sitter**, builds an AST and extracts semantic insights.  
* `code-graph-agent.ts` – the **CodeGraphAgent** that turns the AST into a **code knowledge graph** using **Memgraph**.  
* `content-validation-agent.ts` – the **ContentValidationAgent** that validates persisted entities and detects staleness.  

All agents inherit from the shared **BaseAgent** (`base-agent.ts`), which supplies a **confidence‑calculation mechanism**, an **issue‑detection routine**, and a **standard response‑envelope factory**.  Persistence is delegated to a single **GraphDatabaseAdapter** (`storage/graph-database-adapter.ts`) that abstracts a **Graphology + LevelDB** store and automatically synchronises a JSON export.  

In the broader project hierarchy, **SemanticAnalysis** is a child of the top‑level **Coding** component and sits alongside siblings such as **LiveLoggingSystem**, **KnowledgeManagement**, and **ConstraintSystem**, all of which also rely on the same `GraphDatabaseAdapter`.  Its own children – `Pipeline`, `Ontology`, `Insights`, `KnowledgeGraphConstructor`, `ObservationClassifier`, `CodeAnalyzer`, `ContentValidator`, and `GraphDatabase` – are realized as the agents and supporting adapters described above.

---

## Architecture and Design  

### Agent‑Centric Modular Architecture  
The component follows a **modular, agent‑centric architecture**.  Each agent has a single responsibility (classification, AST parsing, graph construction, validation) and is isolated in its own file.  This mirrors the “single‑purpose service” idea without introducing a full micro‑service boundary; the agents run in‑process but communicate through well‑defined contracts (the response envelope).  

### Inheritance‑Based Common Behaviour (BaseAgent)  
`BaseAgent` (`integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts`) implements the **template‑method** style pattern: concrete agents extend it and automatically gain confidence scoring, issue detection, and envelope creation.  This eliminates duplicated logic and guarantees a uniform output shape across the component.  

### Adapter Pattern for Persistence  
`GraphDatabaseAdapter` (`storage/graph-database-adapter.ts`) is a classic **Adapter**.  It hides the details of the underlying **Graphology + LevelDB** implementation, presents a clean API (`saveGraph`, `getGraph`, query helpers), and adds the extra responsibility of **automatic JSON export sync**.  Because every agent (OntologyClassificationAgent, SemanticAnalysisAgent, CodeGraphAgent, ContentValidationAgent) injects this adapter, the persistence layer is interchangeable and can be extended (e.g., to a remote graph service) without touching the agents.  

### Standard Response Envelope  
Both the **OntologyClassificationAgent** and the **ContentValidationAgent** explicitly use a “standard response envelope creation pattern”.  This is a **facade‑like** construct that wraps raw results together with confidence scores, issue lists, and metadata, ensuring downstream consumers (the Pipeline coordinator, other components) can treat all agent outputs uniformly.  

### Coordination via a Pipeline Coordinator  
The child **Pipeline** component introduces a **CoordinatorAgent** (`coordinator-agent.ts`).  It orchestrates the execution order of the other agents, effectively acting as a **controller** that sequences classification → analysis → graph construction → validation.  This keeps the runtime flow explicit and makes it easy to add or reorder steps.  

### Shared Infrastructure with Siblings  
Sibling components such as **LiveLoggingSystem** and **KnowledgeManagement** also import the `OntologyClassificationAgent` and `GraphDatabaseAdapter`.  This demonstrates **horizontal reuse** of the same agents and adapters across the code‑base, reinforcing a consistent data model and reducing duplication.

---

## Implementation Details  

### BaseAgent (`base-agent.ts`)  
* **Confidence Calculation** – a method that aggregates internal metrics (e.g., classification scores, parsing success rates) into a numeric confidence value.  
* **Issue Detection** – scans the agent’s output for anomalies (missing fields, contradictory classifications) and populates an `issues` array.  
* **Response Envelope** – `createResponse(payload, confidence, issues)` builds a JSON‑serialisable object that every child agent returns.  

### OntologyClassificationAgent (`ontology-classification-agent.ts`)  
* Extends `BaseAgent`.  
* Receives an observation, looks it up in the **ontology system**, and produces a classification label.  
* Calls `this.calculateConfidence()` (inherited) to attach a confidence score.  
* Wraps the result with `this.createResponse(...)`.  

### SemanticAnalysisAgent (`semantic-analysis-agent.ts`)  
* Uses **Tree‑sitter** to parse a source file (`treeSitter.parse(fileContent)`) and generate an AST.  
* Traverses the AST to extract semantic constructs (functions, classes, imports) and builds a domain‑specific insight object.  
* Persists the insight via `graphDatabaseAdapter.saveGraph(insightGraph)`.  
* Returns a response envelope containing the insight and confidence.  

### CodeGraphAgent (`code-graph-agent.ts`)  
* Also relies on **Tree‑sitter** for the AST but focuses on **graph construction**.  
* Transforms AST nodes into **Memgraph**‑compatible vertices/edges, then hands the resulting graph to `GraphDatabaseAdapter`.  
* Inherits the confidence and issue mechanisms from `BaseAgent`.  

### ContentValidationAgent (`content-validation-agent.ts`)  
* Queries the persisted graph through `graphDatabaseAdapter.getGraph()` to locate entities.  
* Checks timestamps, version tags, and structural integrity to detect **staleness** or inconsistencies.  
* Emits a response envelope that includes any validation issues and an overall confidence rating.  

### GraphDatabaseAdapter (`graph-database-adapter.ts`)  
* Wraps **Graphology** (an in‑memory graph library) with **LevelDB** as the durable store.  
* Provides `saveGraph(graph)`, `loadGraph(id)`, and `exportToJSON()` methods.  
* The “automatic JSON export sync” runs after each `saveGraph`, ensuring an up‑to‑date JSON snapshot for external tools.  
* Designed as a **modular** class: the LevelDB backend can be swapped, and additional back‑ends (e.g., remote VKB API) can be plugged in without changing agent code.  

### Pipeline Coordination (`coordinator-agent.ts`)  
* Instantiates each agent, injects the shared `GraphDatabaseAdapter`, and runs them in a deterministic sequence:  
  1. OntologyClassificationAgent → 2. SemanticAnalysisAgent → 3. CodeGraphAgent → 4. ContentValidationAgent.  
* Collects each agent’s response envelope, aggregates confidence scores, and decides whether to continue or abort based on predefined thresholds.  

---

## Integration Points  

1. **Shared Persistence Layer** – All agents interact with `GraphDatabaseAdapter`.  Because siblings like **KnowledgeManagement**, **CodingPatterns**, and **ConstraintSystem** also depend on this adapter, any change to the adapter’s API propagates across the whole system.  

2. **Ontology System** – The `OntologyClassificationAgent` calls into the central ontology repository (not shown in the observations but referenced by the LiveLoggingSystem sibling).  This creates a tight coupling between SemanticAnalysis and the broader **Ontology** child component.  

3. **Tree‑sitter Library** – Both the `SemanticAnalysisAgent` and `CodeGraphAgent` import the same parsing library, ensuring a consistent AST representation across analysis and graph construction.  

4. **Memgraph** – The `CodeGraphAgent` pushes the generated graph to a Memgraph instance, which is later queried by the `ContentValidationAgent`.  This establishes a **read‑write** loop within the component.  

5. **Pipeline Coordinator** – The `CoordinatorAgent` exposes a single entry point (`runPipeline(observation)`) that can be invoked by external services (e.g., the LiveLoggingSystem when a new observation arrives).  This makes the whole SemanticAnalysis workflow composable.  

6. **Sibling Reuse** – The LiveLoggingSystem’s use of `OntologyClassificationAgent` means that any improvements to classification confidence or envelope format immediately benefit both LiveLoggingSystem and SemanticAnalysis.  

---

## Usage Guidelines  

* **Instantiate via the Coordinator** – Clients should call the `CoordinatorAgent` rather than invoking agents directly.  This guarantees that the execution order, shared `GraphDatabaseAdapter` instance, and confidence thresholds are respected.  

* **Respect the Response Envelope** – Every agent returns `{ payload, confidence, issues, metadata }`.  Downstream code must inspect `confidence` and `issues` before trusting `payload`.  A common pattern is to abort the pipeline if any agent reports confidence < 0.7 or non‑empty `issues`.  

* **Do Not Bypass the GraphDatabaseAdapter** – Directly accessing LevelDB or Graphology from an agent breaks the abstraction and will cause the automatic JSON export to fall out of sync.  Always use the adapter’s `saveGraph` / `loadGraph` methods.  

* **Version the Ontology** – When updating the ontology definitions, ensure that the `OntologyClassificationAgent` is redeployed before the pipeline runs, otherwise confidence scores may be inflated by stale mappings.  

* **Testing with Mock Adapters** – Because the adapter follows the **Adapter pattern**, unit tests can inject a mock implementation that records calls without touching the file system.  This is the recommended approach for isolated agent testing.  

* **Extending the Pipeline** – To add a new analysis step, create a new class that extends `BaseAgent`, implement its `execute` method, and register it in `CoordinatorAgent`.  The shared response envelope guarantees compatibility with existing steps.  

---

### 1. Architectural patterns identified  

| Pattern | Where it appears | Purpose |
|---------|------------------|---------|
| **Agent‑based modular architecture** | All files under `src/agents/` (e.g., `ontology-classification-agent.ts`, `semantic-analysis-agent.ts`) | Isolate single responsibilities and enable easy composition |
| **Inheritance/template‑method (BaseAgent)** | `base-agent.ts` | Provide common confidence, issue detection, and envelope creation |
| **Adapter** | `graph-database-adapter.ts` | Hide Graphology + LevelDB details, expose a uniform persistence API |
| **Standard response envelope (facade‑like)** | Implemented in `BaseAgent` and used by `OntologyClassificationAgent`, `ContentValidationAgent` | Ensure uniform output for downstream consumers |
| **Coordinator/Controller** | `coordinator-agent.ts` (Pipeline child) | Orchestrate execution order of agents |
| **Repository‑style query abstraction** | `GraphDatabaseAdapter.getGraph`, `saveGraph` | Centralise data access for all agents |

---

### 2. Design decisions and trade‑offs  

* **Single‑process agents vs. micro‑services** – The team chose in‑process agents, which reduces inter‑process latency and simplifies deployment, but it limits horizontal scaling of individual agents.  
* **Centralised persistence via an adapter** – Guarantees data consistency and automatic JSON export, at the cost of a single point of failure; scaling the graph store must be addressed at the adapter level.  
* **Confidence‑driven pipeline control** – Enables early abort on low‑confidence results, improving overall quality, but introduces the need to tune thresholds and may cause false negatives if confidence metrics are not well‑calibrated.  
* **Tree‑sitter as a shared parsing engine** – Provides a language‑agnostic AST, simplifying both analysis and graph construction, yet adds a heavy dependency that must be kept in sync with supported language grammars.  
* **Extensible BaseAgent** – Encourages code reuse, but deep inheritance can make debugging harder if an issue originates in the base class logic.

---

### 3. System structure insights  

* **Vertical layering** – Observations flow from raw source files → AST (SemanticAnalysisAgent) → graph (CodeGraphAgent) → validation (ContentValidationAgent) → persisted knowledge (GraphDatabaseAdapter).  
* **Horizontal reuse** – The same `OntologyClassificationAgent` and `GraphDatabaseAdapter` are shared with sibling components, creating a common knowledge‑management backbone across the entire **Coding** parent.  
* **Clear separation of concerns** – Classification, parsing, graph building, and validation are each encapsulated, allowing independent evolution.  
* **Pipeline as the glue** – The coordinator ties the vertical layers together, exposing a single entry point for external callers (e.g., LiveLoggingSystem).  

---

### 4. Scalability considerations  

* **Graph storage scalability** – Because `GraphDatabaseAdapter` currently couples Graphology with LevelDB, scaling beyond a single machine will require swapping the backend (e.g., to a distributed graph DB). The adapter’s modular design makes this feasible without touching agents.  
* **Parallel agent execution** – The current pipeline runs agents sequentially. If throughput becomes a bottleneck, independent agents (e.g., classification and AST parsing) could be parallelised, provided the adapter can handle concurrent writes.  
* **Memgraph integration** – Memgraph itself can be clustered; leveraging its clustering capabilities would allow the `CodeGraphAgent` to offload large graphs to a distributed store.  
* **Confidence thresholds** – Dynamic adjustment of thresholds based on load can prevent the pipeline from stalling on low‑confidence, high‑cost analyses during peak periods.  

---

### 5. Maintainability assessment  

* **High cohesion, low coupling** – Each agent does one thing and communicates through well‑defined envelopes, making the codebase easy to understand and modify.  
* **Centralised shared logic** – `BaseAgent` and `GraphDatabaseAdapter` reduce duplication, but any change to them ripples through many agents; thorough regression testing is essential.  
* **Modular file layout** – All agents live in their own files under a clear directory, aiding discoverability.  
* **Extensibility** – Adding new agents or swapping the persistence layer is straightforward thanks to the inheritance and adapter patterns.  
* **Potential technical debt** – The reliance on a single `GraphDatabaseAdapter` instance across many components could become a maintenance hotspot if the adapter grows complex (e.g., handling multiple back‑ends). Introducing an interface abstraction for the adapter would further isolate callers.  

Overall, the **SemanticAnalysis** component exhibits a clean, agent‑oriented design with strong reuse of common infrastructure, making it well‑suited for incremental enhancements while providing clear pathways for future scaling and refactoring.


## Hierarchy Context

### Parent
- [Coding](./Coding.md) -- Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 8 major components: LiveLoggingSystem: The LiveLoggingSystem component utilizes the OntologyClassificationAgent, located in integrations/mcp-server-semantic-analysis/src/agents/ontology-cla; LLMAbstraction: The LLMAbstraction component uses dependency injection to set functions that resolve the current LLM mode, mock service, repository path, budget track; DockerizedServices: The DockerizedServices component utilizes a microservices architecture, with each service having its own container and communication happening through; Trajectory: The Trajectory component's architecture is designed to handle multiple integration methods, including HTTP, IPC, and file watch, as seen in the Specst; KnowledgeManagement: The KnowledgeManagement component utilizes a GraphDatabaseAdapter (storage/graph-database-adapter.ts) to handle graph database persistence, which is a; CodingPatterns: The CodingPatterns component utilizes the GraphDatabaseAdapter (storage/graph-database-adapter.ts) for storing and retrieving knowledge entities. This; ConstraintSystem: The ConstraintSystem component utilizes the GraphDatabaseAdapter, located in storage/graph-database-adapter.ts, for storing and retrieving graph data.; SemanticAnalysis: The SemanticAnalysis component employs a modular architecture, with each agent responsible for a specific task, such as the OntologyClassificationAgen.

### Children
- [Pipeline](./Pipeline.md) -- The Pipeline uses a coordinator agent, as seen in the integrations/mcp-server-semantic-analysis/src/agents/coordinator-agent.ts file, to manage the execution of other agents.
- [Ontology](./Ontology.md) -- The OntologyClassificationAgent, located in the integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts file, uses a confidence calculation mechanism to determine the accuracy of its classifications.
- [Insights](./Insights.md) -- The InsightGenerationAgent, located in the integrations/mcp-server-semantic-analysis/src/agents/insight-generation-agent.ts file, uses a combination of natural language processing and machine learning algorithms to generate insights.
- [KnowledgeGraphConstructor](./KnowledgeGraphConstructor.md) -- The KnowledgeGraphConstructor, located in the integrations/mcp-server-semantic-analysis/src/agents/knowledge-graph-constructor.ts file, uses the GraphDatabaseAdapter to interact with the graph database.
- [ObservationClassifier](./ObservationClassifier.md) -- The ObservationClassifier, located in the integrations/mcp-server-semantic-analysis/src/agents/observation-classifier.ts file, uses the OntologyClassificationAgent to classify observations.
- [CodeAnalyzer](./CodeAnalyzer.md) -- The CodeAnalyzer, located in the integrations/mcp-server-semantic-analysis/src/agents/code-analyzer.ts file, uses the SemanticAnalysisAgent to analyze code files.
- [ContentValidator](./ContentValidator.md) -- The ContentValidator, located in the integrations/mcp-server-semantic-analysis/src/agents/content-validator.ts file, uses the ContentValidationAgent to validate entity content.
- [GraphDatabase](./GraphDatabase.md) -- The GraphDatabase, located in the integrations/mcp-server-semantic-analysis/src/adapters/graph-database-adapter.ts file, uses a graph-based data structure to store and manage the knowledge graph.

### Siblings
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- The LiveLoggingSystem component utilizes the OntologyClassificationAgent, located in integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts, to classify observations against the ontology system. This agent plays a crucial role in the system's architecture, enabling the classification of observations based on predefined ontologies. The classification process involves the agent analyzing the observations and mapping them to specific concepts within the ontology system. This mapping is essential for providing a structured representation of the observations, facilitating their storage, retrieval, and analysis. The OntologyClassificationAgent's functionality is critical to the overall operation of the LiveLoggingSystem, as it enables the system to organize and make sense of the vast amounts of data generated during live sessions.
- [LLMAbstraction](./LLMAbstraction.md) -- The LLMAbstraction component uses dependency injection to set functions that resolve the current LLM mode, mock service, repository path, budget tracker, sensitivity classifier, and quota tracker in the LLMService class (lib/llm/llm-service.ts). This design decision allows for flexibility and testability, as different implementations can be easily swapped in. The resolveMode method in LLMService, which determines the LLM mode based on the agent ID and other factors, is a good example of this. The method takes into account various parameters, such as the agent ID, to decide which LLM mode to use, and returns the corresponding mode. This approach enables the component to adapt to different scenarios and requirements.
- [DockerizedServices](./DockerizedServices.md) -- The DockerizedServices component utilizes a microservices architecture, with each service having its own container and communication happening through APIs or message queues, as seen in the lib/service-starter.js file which employs the startServiceWithRetry function to start services with retry logic and exponential backoff. This design decision allows for easy addition or removal of services as needed, making the system highly scalable and flexible. The use of APIs or message queues for communication between services is a common pattern in microservices architecture, enabling loose coupling and fault tolerance. The startServiceWithRetry function in lib/service-starter.js ensures robust startup and prevents endless loops, making the system more reliable.
- [Trajectory](./Trajectory.md) -- The Trajectory component's architecture is designed to handle multiple integration methods, including HTTP, IPC, and file watch, as seen in the SpecstoryAdapter class (lib/integrations/specstory-adapter.js). This adapter class provides methods such as connectViaHTTP (lib/integrations/specstory-adapter.js:134), connectViaIPC (lib/integrations/specstory-adapter.js:193), and connectViaFileWatch (lib/integrations/specstory-adapter.js:241) to establish connections with the Specstory extension. The use of these multiple integration methods allows the Trajectory component to adapt to different environments and connection scenarios.
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component utilizes a GraphDatabaseAdapter (storage/graph-database-adapter.ts) to handle graph database persistence, which is a crucial aspect of the system's architecture. This adapter enables the use of Graphology and LevelDB for data storage, with automatic JSON export synchronization. The intelligent routing mechanism within the GraphDatabaseAdapter allows the system to switch between the VKB API and direct database access seamlessly, which is essential for maintaining a high level of performance and scalability. For instance, the 'getGraph' function in the GraphDatabaseAdapter class demonstrates how the system can retrieve the graph database, either from the VKB API or the local LevelDB storage, depending on the configuration. Furthermore, the 'saveGraph' function showcases the adapter's ability to persist the graph database to the local storage and synchronize it with the VKB API.
- [CodingPatterns](./CodingPatterns.md) -- The CodingPatterns component utilizes the GraphDatabaseAdapter (storage/graph-database-adapter.ts) for storing and retrieving knowledge entities. This adapter provides a standardized interface for interacting with the graph database, which is built on top of LevelDB for efficient data storage and retrieval. The use of LevelDB allows for high-performance data storage and querying, making it an ideal choice for the CodingPatterns component. Furthermore, the GraphDatabaseAdapter also provides automatic JSON export sync, ensuring that data is consistently up-to-date and readily available for use within the component.
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem component utilizes the GraphDatabaseAdapter, located in storage/graph-database-adapter.ts, for storing and retrieving graph data. This adapter provides a standardized interface for interacting with the graph database, allowing the ConstraintSystem to focus on its core logic without worrying about the underlying database implementation. By using this adapter, the system can easily switch between different graph databases if needed, making it more modular and flexible. For example, the GraphDatabaseAdapter's query method can be used to retrieve specific nodes or edges from the graph, as seen in the ContentValidationAgent's constructor, where it is used to fetch entity content for validation.


---

*Generated from 6 observations*
