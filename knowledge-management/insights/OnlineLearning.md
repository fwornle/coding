# OnlineLearning

**Type:** SubComponent

The EntityExtractionService in entity_extraction_service.py extracts entities from various sources and integrates them into the knowledge graph.

## What It Is  

OnlineLearning is the **online‑learning sub‑component** of the larger **KnowledgeManagement** system. Its entry point lives in `online_learning_module.py` as the **`OnlineLearningModule`** class, which orchestrates the extraction of new knowledge from a variety of runtime artefacts and pushes the results into the shared knowledge graph.  

The module brings together three primary extractors – **`GitHistoryAnalyzer`** (`git_history_analyzer.py`), **`LSLSessionAnalyzer`** (`lsl_session_analyzer.py`), and **`CodeAnalysisModule`** (`code_analysis_module.py`) – each responsible for a distinct source of knowledge (git commit history, Lab Streaming Layer sessions, and static code respectively). The extracted artefacts are then handed to **`KnowledgeGraphUpdater`** (`knowledge_graph_updater.py`) which writes the new triples into the graph managed by the sibling **`GraphDatabaseManager`** component.  Entity‑level enrichment is performed by **`EntityExtractionService`** (`entity_extraction_service.py`), ensuring that newly discovered concepts become first‑class nodes in the graph.

In short, OnlineLearning is a pipeline that continuously harvests, normalises, and persists knowledge, keeping the KnowledgeManagement graph fresh without manual intervention.

---

## Architecture and Design  

The architecture follows a **modular pipeline** style: each source of knowledge is encapsulated in its own *analyzer* class, and a dedicated *updater* writes the results to the graph. This reflects a **separation‑of‑concerns** design that mirrors the sibling components in the same tier (e.g., ManualLearning uses an authoring tool, while OnlineLearning uses analyzers).  

The observed modules implement a **builder‑updater pattern**: `GitHistoryAnalyzer`, `LSLSessionAnalyzer`, and `CodeAnalysisModule` act as *builders* of domain knowledge, while `KnowledgeGraphUpdater` consumes those built artefacts and persists them. The pipeline is coordinated by `OnlineLearningModule`, which functions as a lightweight **orchestrator** (no explicit workflow engine is mentioned, but the orchestrator role is clear from the observations).  

Interaction with the persistent store is abstracted through the sibling **`GraphDatabaseManager`**, which itself hides the details of the underlying graph database behind the `GraphDBClient` (as described in the sibling description). This mirrors the **intelligent routing** pattern noted for the parent component: OnlineLearning can call the manager in either API mode or direct client mode without needing to know which path is taken.  

Finally, the presence of `EntityExtractionService` indicates a **service‑oriented** approach for entity enrichment, allowing the pipeline to plug in additional extraction logic without altering the core analyzers.

---

## Implementation Details  

### Core Orchestrator – `OnlineLearningModule` (`online_learning_module.py`)  
`OnlineLearningModule` is the façade exposed to the rest of the system. It instantiates each analyzer, runs them (typically on a schedule or in response to events), collects the returned knowledge objects, and forwards them to the updater. The module also injects the `GraphDatabaseManager` dependency so that the updater can obtain a database session.

### Knowledge Extractors  

| Analyzer | File | Key Responsibility |
|----------|------|--------------------|
| **`GitHistoryAnalyzer`** | `git_history_analyzer.py` | Walks the repository commit log, parses commit messages, diff metadata, and file‑level changes to produce *knowledge statements* such as “function X was refactored in commit Y”. |
| **`LSLSessionAnalyzer`** | `lsl_session_analyzer.py` | Consumes LSL session logs, identifies patterns (e.g., sensor streams, timing relationships) and emits temporal knowledge that can be linked to code artefacts. |
| **`CodeAnalysisModule`** | `code_analysis_module.py` | Performs static analysis (AST traversal, dependency graph building) and extracts domain concepts like classes, APIs, and design patterns via methods such as `getCodeKnowledge` and `extractCodeInsights`. |

Each analyzer returns a **structured knowledge payload** (likely a collection of triples or a domain‑specific DTO). The payload format is not explicitly described, but the fact that `KnowledgeGraphUpdater` can consume it implies a common schema.

### Graph Persistence – `KnowledgeGraphUpdater` (`knowledge_graph_updater.py`)  
`KnowledgeGraphUpdater` receives the payloads, transforms them into graph‑compatible triples, and uses the injected `GraphDatabaseManager` to persist them. The updater likely implements **idempotent upserts** to avoid duplicate nodes, a design decision that aligns with the parent component’s “classification cache” pattern for avoiding redundant operations.

### Entity Enrichment – `EntityExtractionService` (`entity_extraction_service.py`)  
After raw knowledge is stored, `EntityExtractionService` scans the newly added data, extracts entities (e.g., technical terms, domain concepts) and creates or updates corresponding nodes in the graph. This service is a bridge between raw artefacts and the higher‑level ontology managed by the sibling **OntologyManager**.

### Supporting Infrastructure  

* **`GraphDatabaseManager`** – Provides the graph database session, abstracting direct driver calls (`GraphDBClient` in `graph_db_client.py`).  
* **Parent Context – KnowledgeManagement** – Supplies cross‑cutting concerns such as intelligent routing (API vs. direct DB access) and data‑loss tracking, which OnlineLearning inherits automatically.

---

## Integration Points  

1. **Graph Database** – All knowledge ultimately flows through `GraphDatabaseManager`. OnlineLearning does not interact with the database directly; it relies on the manager’s public API, benefitting from the parent’s routing flexibility.  

2. **Entity Extraction Service** – `EntityExtractionService` is invoked after `KnowledgeGraphUpdater` commits new triples. This coupling ensures that every piece of extracted knowledge is enriched with entity metadata before it is exposed to downstream consumers (e.g., OntologyManager or WorkflowManager).  

3. **Sibling Components** –  
   * **ManualLearning** shares the same knowledge graph but writes via the `EntityAuthoringTool`. The two pipelines therefore converge on the same persistence layer, guaranteeing a unified view of both manually authored and automatically learned knowledge.  
   * **ClassificationCacheManager** – While not directly referenced, the cache pattern likely influences OnlineLearning’s updater to check for existing classifications before creating new ones, reducing redundant LLM calls.  

4. **Parent Services** – The **intelligent routing** and **data loss tracking** mechanisms defined in KnowledgeManagement are automatically applied to OnlineLearning’s database interactions, giving the sub‑component built‑in resilience and observability without extra code.

---

## Usage Guidelines  

* **Instantiate via the orchestrator** – Developers should interact with OnlineLearning through `OnlineLearningModule`. Direct use of the individual analyzers is discouraged because the orchestrator handles dependency injection, scheduling, and error aggregation.  

* **Configure the GraphDatabaseManager** – Ensure that the manager is set to the desired access mode (API vs. direct) before starting the online‑learning pipeline; this choice propagates to all persistence calls.  

* **Respect idempotency** – When extending an analyzer, return knowledge objects that can be uniquely identified (e.g., using commit SHA for Git history) so that `KnowledgeGraphUpdater` can safely upsert without creating duplicates.  

* **Leverage EntityExtractionService** – If a new domain‑specific entity type is introduced, register its extraction rules with `EntityExtractionService` rather than modifying the updater. This keeps entity logic isolated and aligns with the system’s service‑oriented design.  

* **Monitor through DataLossTracker** – The parent’s data‑loss tracking is automatically engaged; however, developers should emit appropriate telemetry (e.g., number of extracted triples) from each analyzer to make the tracking meaningful.

---

### 1. Architectural patterns identified  
* **Modular pipeline / separation‑of‑concerns** – distinct analyzer modules feeding a central updater.  
* **Builder‑Updater (or Producer‑Consumer)** – analyzers build knowledge, updater persists it.  
* **Service‑Oriented component** – `EntityExtractionService` operates as a downstream enrichment service.  
* **Intelligent routing** (inherited from KnowledgeManagement) for database access.  

### 2. Design decisions and trade‑offs  
* **Fine‑grained analyzers** give clear ownership of source‑specific logic but increase the number of classes to maintain.  
* **Centralised updater** simplifies persistence logic and enforces consistent graph schema, at the cost of a single point of failure (mitigated by the parent’s data‑loss tracking).  
* **Dependency injection via `OnlineLearningModule`** improves testability but requires careful configuration of the sibling `GraphDatabaseManager`.  

### 3. System structure insights  
OnlineLearning sits one level below the **KnowledgeManagement** parent, exposing three child components (GitHistoryAnalyzer, CodeKnowledgeExtractor, KnowledgeGraphBuilder). It shares the same persistence backbone as its siblings, enabling a unified knowledge graph that blends manual and automated inputs.  

### 4. Scalability considerations  
* **Horizontal scaling** can be achieved by running multiple instances of `OnlineLearningModule` with partitioned sources (e.g., each instance processes a subset of repositories).  
* The **updater’s idempotent upserts** help avoid contention on the graph database when many instances write concurrently.  
* Adding new analyzers is straightforward – they plug into the orchestrator without touching the persistence layer.  

### 5. Maintainability assessment  
The clear module boundaries (analyzers, updater, extraction service) promote **high cohesion** and **low coupling**, making the codebase easy to extend. Reuse of shared infrastructure (GraphDatabaseManager, classification cache) reduces duplication. The main maintenance burden lies in keeping the knowledge extraction heuristics up‑to‑date with evolving source formats (e.g., new LSL session schemas), but the isolated analyzer design mitigates ripple effects across the system.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- Key patterns in this component include the use of intelligent routing for database interactions, with the ability to switch between API and direct access modes. Additionally, the component utilizes a classification cache to avoid redundant LLM calls and implements data loss tracking to monitor data flow through the system.

### Children
- [GitHistoryAnalyzer](./GitHistoryAnalyzer.md) -- GitHistoryAnalyzer uses the git_history_analyzer.py module to extract knowledge from git history, specifically the GitHistoryAnalyzer class
- [CodeKnowledgeExtractor](./CodeKnowledgeExtractor.md) -- The CodeKnowledgeExtractor uses code analysis to extract knowledge, specifically using methods such as getCodeKnowledge and extractCodeInsights
- [KnowledgeGraphBuilder](./KnowledgeGraphBuilder.md) -- The KnowledgeGraphBuilder uses the extracted knowledge from the GitHistoryAnalyzer and CodeKnowledgeExtractor to build a knowledge graph

### Siblings
- [ManualLearning](./ManualLearning.md) -- ManualLearning uses the EntityAuthoringTool class in entity_authoring_tool.py to create and edit entities manually.
- [GraphDatabaseManager](./GraphDatabaseManager.md) -- GraphDatabaseManager uses the GraphDBClient class in graph_db_client.py to interact with the graph database.
- [EntityPersistenceManager](./EntityPersistenceManager.md) -- EntityPersistenceManager uses the EntityClassifier class in entity_classifier.py to classify entities.
- [TraceReportGenerator](./TraceReportGenerator.md) -- TraceReportGenerator uses the WorkflowRunner class in workflow_runner.py to run workflows and capture data flow.
- [ClassificationCacheManager](./ClassificationCacheManager.md) -- ClassificationCacheManager uses the ClassificationCache class in classification_cache.py to store and retrieve classification results.
- [DataLossTracker](./DataLossTracker.md) -- DataLossTracker uses the DataFlowMonitor class in data_flow_monitor.py to monitor data flow and track data loss.
- [OntologyManager](./OntologyManager.md) -- OntologyManager uses the OntologyUpdater class in ontology_updater.py to update the ontology.
- [WorkflowManager](./WorkflowManager.md) -- WorkflowManager uses the WorkflowRunner class in workflow_runner.py to run workflows.


---

*Generated from 7 observations*
