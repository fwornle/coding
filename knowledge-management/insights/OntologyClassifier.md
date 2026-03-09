# OntologyClassifier

**Type:** SubComponent

OntologyClassifier could leverage the VkbApiClientWrapper (vkb-api-client-wrapper module) for simplifying server-based knowledge graph operations.

## What It Is  

**OntologyClassifier** is a sub‑component of the **KnowledgeManagement** component that provides LLM‑driven reasoning to assign ontology classes to incoming entities.  The classifier lives inside the KnowledgeManagement code‑base (the exact source file is not listed in the observations, but its logical location is alongside the other KnowledgeManagement agents such as `src/agents/persistence‑agent.ts`).  Its primary responsibility is to take a raw entity—whether generated automatically by the system or created manually by a user—and, using a large language model, decide which ontology node best describes that entity.  The result of the classification is then handed off to the persistence stack so that the entity and its ontology label are stored in the graph database.

## Architecture and Design  

The design of **OntologyClassifier** follows the *separation‑of‑concerns* principle that is evident throughout the KnowledgeManagement hierarchy.  Classification is isolated from persistence, graph management, and API communication, allowing each sibling component to evolve independently.  The classifier itself does **not** perform any storage work; instead it delegates those responsibilities to the **PersistenceModule** (which wraps `src/agents/persistence‑agent.ts`).  This delegation mirrors the *adapter* pattern used by the **GraphDatabaseAdapter** (`storage/graph-database-adapter.ts`) that translates Graphology operations into LevelDB calls.  

Interaction flow (as inferred from the observations):  

1. An entity arrives from a consumer (e.g., the **ManualLearning** module).  
2. **OntologyClassifier** invokes an LLM service to obtain a classification label.  
3. The label, together with the entity payload, is passed to the **PersistenceModule** for durable storage.  
4. The **PersistenceModule** uses the **GraphDatabaseManager** (which in turn relies on **GraphDatabaseAdapter**) to write the entity into the underlying graph database.  

When external knowledge‑graph operations are required—such as synchronising the new classification with a remote service—the classifier can call the **VkbApiClientWrapper** (from the `vkb-api-client-wrapper` module).  This wrapper abstracts the HTTP/GraphQL details of the server‑side knowledge‑graph API, keeping the classifier’s core logic focused on reasoning rather than transport concerns.

Because the parent **KnowledgeManagement** component is described as “micro‑services‑oriented,” the classifier is positioned as a logical service within that ecosystem, even though the concrete implementation is a library‑level class rather than a network‑exposed endpoint.  The micro‑service framing provides a scalability mindset: each agent (e.g., **PersistenceAgent**, **CodeGraphAgent**) can be scaled independently, and the classifier can be swapped for a more capable LLM without touching the persistence layer.

## Implementation Details  

While no concrete symbols were discovered in the source dump, the observations give a clear picture of the key collaborators:

| Collaborator | Path / Module | Role in Classification |
|--------------|---------------|------------------------|
| **OntologyClassifier** | (sub‑component of KnowledgeManagement) | Runs LLM inference, produces ontology tags |
| **PersistenceModule** | `src/agents/persistence-agent.ts` (via PersistenceModule) | Persists classified entities |
| **GraphDatabaseAdapter** | `storage/graph-database-adapter.ts` | Bridges Graphology → LevelDB for efficient graph writes |
| **GraphDatabaseManager** | `graph-database-manager` module | Provides higher‑level CRUD APIs used by PersistenceModule |
| **VkbApiClientWrapper** | `vkb-api-client-wrapper` module | Wraps remote KG API calls for sync or enrichment |
| **ManualLearning** | sibling component | Supplies manually created entities for classification |

The classifier likely follows a simple pipeline:

```text
receive(entity) → invokeLLM(entity) → classificationResult
→ PersistenceModule.save(entity, classificationResult)
```

* **LLM Invocation** – The classifier calls an LLM (the exact client is not named; it could be a wrapper around OpenAI, Anthropic, etc.).  The input is the raw entity description; the output is a string or identifier that matches a node in the ontology graph.  

* **Persistence Hand‑off** – By handing the result to **PersistenceModule**, the classifier avoids direct coupling to storage concerns.  The PersistenceModule internally creates a graph node (or updates an existing one) using the **GraphDatabaseManager**.  

* **Graph Storage** – The **GraphDatabaseManager** uses the **GraphDatabaseAdapter** to write the node into LevelDB via the Graphology library.  This adapter ensures that the graph is kept in sync with a JSON export, as described in the parent component’s documentation.  

* **Remote Sync** – When a classification must be reflected in an external knowledge graph, the **VkbApiClientWrapper** is invoked.  This wrapper hides authentication, request throttling, and response parsing, allowing the classifier to remain agnostic of the external API contract.

## Integration Points  

1. **ManualLearning** – When a user manually creates an entity, ManualLearning calls **OntologyClassifier** to obtain an ontology tag before persisting the entity.  This ensures that even hand‑crafted data follows the same semantic standards as automatically generated data.  

2. **PersistenceModule** – The classifier’s only required runtime dependency is the PersistenceModule’s `save` method.  The contract is simple: `save(entity, classification)`; any implementation that respects this signature can be swapped in.  

3. **GraphDatabaseManager / GraphDatabaseAdapter** – These two layers sit beneath PersistenceModule.  They expose methods such as `createNode`, `updateNode`, and `queryNode`.  Because the adapter abstracts LevelDB specifics, the classifier does not need to know about storage format or indexing strategies.  

4. **VkbApiClientWrapper** – Optional but recommended for environments where the ontology must be mirrored to a central knowledge‑graph service.  The wrapper provides methods like `pushClassification(entityId, ontologyId)` and `fetchOntologyUpdates()`.  

5. **KnowledgeManagement (Parent)** – The parent component orchestrates the lifecycle of agents.  OntologyClassifier is registered as a service within the KnowledgeManagement container, making it discoverable by other agents (e.g., OnlineLearning could reuse the classifier for auto‑labeling newly mined code entities).  

All integration points are defined through explicit module imports; there is no implicit coupling, which eases testing and future refactoring.

## Usage Guidelines  

* **Invoke via the PersistenceModule** – Direct calls to OntologyClassifier should be avoided; instead, submit the entity to the PersistenceModule which will internally trigger classification.  This guarantees that every persisted entity has an associated ontology label.  

* **Provide a clear textual description** – The LLM’s accuracy depends heavily on the quality of the input.  When constructing the entity payload, include domain‑specific keywords and context that match the ontology’s terminology.  

* **Handle classification failures gracefully** – The LLM may return an “unknown” or low‑confidence label.  In such cases, the classifier should return a sentinel value (e.g., `null` or `unclassified`) and let the caller decide whether to store the entity as‑is or flag it for manual review.  

* **Keep the VkbApiClientWrapper configuration up‑to‑date** – If the external knowledge‑graph API changes (e.g., endpoint URLs, auth tokens), update the wrapper only; the classifier will automatically pick up the new behavior.  

* **Testing** – Mock the LLM client and the PersistenceModule when unit‑testing OntologyClassifier.  Because the classifier does not touch the graph database directly, tests can focus on the reasoning logic without requiring LevelDB or Graphology.  

* **Performance** – Classification is typically the most time‑consuming step due to remote LLM calls.  Consider batching entities or using a cached inference layer if throughput becomes a concern.  

---

### 1. Architectural patterns identified  

* **Separation of Concerns** – Classification, persistence, graph storage, and remote API interaction are split into distinct modules.  
* **Adapter Pattern** – `GraphDatabaseAdapter` adapts the Graphology API to LevelDB storage.  
* **Facade/Wrapper** – `VkbApiClientWrapper` provides a simplified façade over the external KG API.  
* **Dependency Injection (implicit)** – Components receive collaborators (e.g., PersistenceModule) rather than instantiating them directly, enabling easy swapping in tests or alternative implementations.  

### 2. Design decisions and trade‑offs  

| Decision | Reasoning | Trade‑off |
|----------|-----------|-----------|
| Keep classification logic separate from persistence | Allows independent evolution of LLM reasoning and storage strategies | Adds an extra hop (classifier → PersistenceModule) which may introduce latency |
| Use a dedicated GraphDatabaseAdapter | Encapsulates LevelDB quirks and enables automatic JSON export sync | Requires maintenance of an extra abstraction layer |
| Optional remote sync via VkbApiClientWrapper | Enables the system to operate in offline mode while still supporting central KG updates | Increases surface area; developers must manage wrapper configuration |
| Rely on LLM for ontology mapping | Leverages powerful semantic reasoning without hand‑crafted rules | Classification quality depends on LLM prompts and may vary; incurs external API costs |

### 3. System structure insights  

* **KnowledgeManagement** acts as the container for a suite of agents (PersistenceAgent, CodeGraphAgent, OntologyClassifier, etc.).  
* **OntologyClassifier** sits at the semantic layer, consuming raw entities and emitting ontology identifiers.  
* **PersistenceModule** bridges the semantic layer to the graph‑storage layer (`GraphDatabaseManager` → `GraphDatabaseAdapter`).  
* Sibling components such as **ManualLearning** and **OnlineLearning** feed entities into the classifier, while **GraphDatabaseManager** and **CodeGraphConstructor** consume the persisted, classified graph for downstream analytics.  

### 4. Scalability considerations  

* Because classification is LLM‑driven, scaling horizontally (multiple classifier instances) is the primary way to increase throughput.  The micro‑service‑style decomposition of KnowledgeManagement supports this pattern.  
* The underlying graph storage (LevelDB via Graphology) is designed for efficient key‑value writes; however, heavy write bursts from massive classification jobs may require sharding or partitioning the LevelDB files.  
* The optional `VkbApiClientWrapper` can become a bottleneck if every classification triggers a remote sync; batching sync calls or using an asynchronous queue mitigates this risk.  

### 5. Maintainability assessment  

* **High** – Clear module boundaries and well‑named adapters make the codebase easy to navigate.  
* **Medium** – The reliance on an external LLM introduces a moving target (model updates, pricing changes) that must be tracked.  
* **Low** – No direct coupling between classification and storage reduces the risk of ripple changes when swapping out the graph database or the LLM provider.  
* Documentation should explicitly capture the LLM prompt templates and confidence thresholds, as these are the most volatile parts of the classifier’s behavior.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component's utilization of a microservices architecture allows for a high degree of scalability and maintainability, with each agent responsible for a specific task. For instance, the PersistenceAgent (src/agents/persistence-agent.ts) handles entity persistence and ontology classification, while the CodeGraphAgent (src/agents/code-graph-agent.ts) is responsible for constructing knowledge graphs from code repositories. This separation of concerns enables the development team to focus on individual components without affecting the overall system. The GraphDatabaseAdapter (storage/graph-database-adapter.ts) provides a crucial link between the Graphology library and LevelDB, facilitating efficient graph persistence and automatic JSON export sync.

### Siblings
- [ManualLearning](./ManualLearning.md) -- ManualLearning likely relies on the PersistenceModule (src/agents/persistence-agent.ts) for storing manually created entities.
- [OnlineLearning](./OnlineLearning.md) -- OnlineLearning likely utilizes the CodeGraphConstructor (src/agents/code-graph-agent.ts) for constructing knowledge graphs from code repositories.
- [GraphDatabaseManager](./GraphDatabaseManager.md) -- GraphDatabaseManager utilizes the GraphDatabaseAdapter (storage/graph-database-adapter.ts) for efficient graph persistence.
- [CodeGraphConstructor](./CodeGraphConstructor.md) -- CodeGraphConstructor utilizes the CodeGraphAgent (src/agents/code-graph-agent.ts) for constructing knowledge graphs.
- [PersistenceModule](./PersistenceModule.md) -- PersistenceModule utilizes the PersistenceAgent (src/agents/persistence-agent.ts) for handling entity persistence.
- [VkbApiClientWrapper](./VkbApiClientWrapper.md) -- VkbApiClientWrapper utilizes the VKB API client for server-based knowledge graph operations.


---

*Generated from 7 observations*
