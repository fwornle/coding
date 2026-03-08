# OnlineLearning

**Type:** SubComponent

OnlineLearning could leverage the GraphDatabaseAdapter (storage/graph-database-adapter.ts) to interact with the central knowledge graph and store automatically extracted data.

## What It Is  

OnlineLearning is a **sub‑component** of the larger **KnowledgeManagement** system.  Its implementation lives in the same repository as the other KnowledgeManagement modules and is expected to orchestrate the automatic extraction, transformation, and persistence of learning‑related insights.  The observations point to concrete artefacts that OnlineLearning will call directly:  

* **PersistenceAgent** – `src/agents/persistence-agent.ts` – the agent responsible for persisting entities, performing ontology classification, and validating content before they are written to the graph.  
* **CodeGraphAgent** – `src/agents/code-graph-agent.ts` – the agent that builds a code‑oriented knowledge graph from extracted entities.  
* **GraphDatabaseAdapter** – `storage/graph-database-adapter.ts` – the adapter that hides the details of the underlying Graphology + LevelDB store and provides a uniform API for graph operations.  

In practice, OnlineLearning consumes raw, unstructured learning material (documents, videos, code snippets, etc.), runs it through a **data‑processing pipeline** that may include natural‑language‑processing (NLP) or computer‑vision models, schedules the extraction jobs (potentially with Apache Airflow), and finally stores the resulting entities and insights via the PersistenceAgent and GraphDatabaseAdapter.  The resulting artefacts become part of the central knowledge graph that the rest of KnowledgeManagement (e.g., InsightGenerationModule, OntologyClassificationModule) can query.

---

## Architecture and Design  

The architecture that emerges from the observations is a **modular, agent‑driven** design anchored by a **graph‑centric data store**.  Each functional concern is encapsulated in its own module (agents, adapters, pipelines), mirroring the modular approach described for the parent KnowledgeManagement component.  

* **Agent pattern** – Both `PersistenceAgent` and `CodeGraphAgent` are thin, purpose‑built services that expose high‑level operations (e.g., `storeEntity`, `buildCodeGraph`).  They hide the complexity of interacting with the underlying storage layer and any domain‑specific validation logic.  
* **Adapter pattern** – `GraphDatabaseAdapter` (`storage/graph-database-adapter.ts`) acts as a façade over the Graphology + LevelDB graph database, translating generic graph operations into the concrete API of the storage engine.  This decouples OnlineLearning (and its sibling modules) from the specifics of the graph implementation, making it possible to swap the backend with minimal code changes.  
* **Pipeline orchestration** – The mention of a “data processing pipeline” and a scheduling library such as **Apache Airflow** indicates a batch‑oriented workflow where extraction jobs are defined as DAGs (directed acyclic graphs).  Each stage of the DAG can invoke an ML model, transform the output into entities, and finally call the agents for persistence.  

Interaction flow (high‑level):  

1. **Scheduler** (Airflow) triggers a pipeline run for a new learning artefact.  
2. The pipeline invokes an **ML model** (NLP for text, CV for images/video) to produce raw insights.  
3. Raw insights are normalized into **entity objects** that conform to the ontology used by KnowledgeManagement.  
4. The **PersistenceAgent** validates and enriches these entities, then hands them to the **GraphDatabaseAdapter**, which writes them into the central graph.  
5. If the artefact contains code, the **CodeGraphAgent** builds a supplemental code‑knowledge sub‑graph, again persisted via the adapter.  

Because the same agents and adapter are shared with sibling components (ManualLearning, EntityPersistenceModule, OntologyClassificationModule, InsightGenerationModule, CodeGraphModule), OnlineLearning benefits from **reuse** and **consistent data contracts** across the whole KnowledgeManagement domain.

---

## Implementation Details  

### PersistenceAgent (`src/agents/persistence-agent.ts`)  
The agent likely exports a class (e.g., `PersistenceAgent`) with methods such as `storeEntity(entity: Entity): Promise<void>` and `validateContent(content: any): ValidationResult`.  Internally it may invoke the **GraphDatabaseAdapter** to perform the actual write.  The agent also appears to handle **ontology classification**, suggesting it contains or delegates to a classifier that maps raw entity attributes to the system’s ontology nodes before persistence.

### CodeGraphAgent (`src/agents/code-graph-agent.ts`)  
This agent is specialized for code‑related knowledge.  Its core method might be `buildCodeGraph(sourceFiles: string[]): Promise<GraphSubsection>` which parses source code, extracts symbols, and creates relationships (e.g., “calls”, “inherits”).  The resulting sub‑graph is then persisted through the same GraphDatabaseAdapter, ensuring that code knowledge lives alongside other learning entities.

### GraphDatabaseAdapter (`storage/graph-database-adapter.ts`)  
Implemented as a thin wrapper around **Graphology** (a JavaScript graph library) backed by **LevelDB** for durability.  Expected public API includes `addNode(node: GraphNode)`, `addEdge(edge: GraphEdge)`, `query(criteria: QuerySpec)`.  By centralising all graph operations here, the system isolates the rest of the codebase from storage‑specific concerns such as transaction handling, indexing, or serialization format.

### Data‑Processing Pipeline & ML Models  
Although concrete code is not listed, the observations indicate a pipeline that calls out to **machine‑learning models** (NLP for document summarisation, CV for extracting text from images/video).  These models are likely encapsulated behind service interfaces (e.g., `NLPService.analyze(text)`) and invoked from Airflow tasks.  The pipeline then maps model outputs to the **Entity** schema expected by the PersistenceAgent.

### Scheduling with Apache Airflow  
Airflow DAGs would be defined in a `dags/online_learning/` directory (not shown) and would reference Python operators that call into the Node.js services (perhaps via HTTP or a message queue).  This external scheduler is not part of the repo but is a critical integration point for automated extraction.

### Data Warehouse  
The observation that a “data warehouse” may be used suggests a secondary storage layer for analytical queries (e.g., reporting on extraction throughput, model accuracy).  The pipeline could push a denormalised view of extracted entities into the warehouse after successful persistence, enabling downstream BI tools without overloading the graph store.

---

## Integration Points  

1. **Parent – KnowledgeManagement** – OnlineLearning contributes automatically extracted entities to the central knowledge graph that the parent component orchestrates.  All other sibling modules (ManualLearning, InsightGenerationModule, etc.) read from and write to the same graph via the shared agents and adapter, guaranteeing a single source of truth.  

2. **Sibling – PersistenceAgent & CodeGraphAgent** – Both agents are reused across siblings.  For example, **ManualLearning** uses `PersistenceAgent` to store manually curated entities, while **CodeGraphModule** uses `CodeGraphAgent` for code‑graph construction.  OnlineLearning’s reliance on the same agents ensures that automatically extracted entities are indistinguishable from manually entered ones at the graph level.  

3. **GraphDatabaseAdapter** – Serves as the primary persistence contract for every module that needs graph access.  Any change to the underlying LevelDB configuration or Graphology version is isolated to this file, protecting the rest of the system.  

4. **External Scheduler (Airflow)** – The DAG definitions are external to the codebase but invoke the pipeline’s entry points (likely HTTP endpoints exposed by a thin Express server).  The Airflow‑to‑Node.js bridge is a critical integration surface; failures here affect the timeliness of automatic extraction.  

5. **Machine‑Learning Services** – Whether hosted locally or as remote inference endpoints, the ML models are called from the pipeline.  Their contracts (input schema, output format) must align with the entity model expected by `PersistenceAgent`.  Versioning of these models is a hidden integration concern that impacts downstream insight quality.  

6. **Data Warehouse** – If present, the warehouse receives a copy of the extracted data for analytics.  The integration likely uses a streaming connector (e.g., Kafka → Snowflake) or a batch export step after each successful pipeline run.

---

## Usage Guidelines  

* **Always route entity creation through `PersistenceAgent`.**  Direct writes to the graph bypass validation, ontology classification, and content checks that the agent enforces.  This rule applies whether the entity originates from OnlineLearning, ManualLearning, or any other module.  

* **Treat `CodeGraphAgent` as the sole entry point for code‑related graph mutations.**  Its internal parsing logic expects source files in a specific format; feeding it malformed code can corrupt the code sub‑graph.  

* **Do not modify `GraphDatabaseAdapter` unless you need to change the underlying storage technology.**  Because every module depends on this adapter, any API change will ripple throughout the KnowledgeManagement system.  

* **When extending the data‑processing pipeline, keep the Airflow DAGs declarative and idempotent.**  Each task should be able to rerun without creating duplicate entities—relying on the agent’s upsert semantics (e.g., `storeEntity` should check for existing IDs).  

* **Version ML models explicitly and store their metadata alongside extracted entities.**  This practice enables reproducibility of insights and eases rollback if a model regression is detected.  

* **If a data warehouse is used for reporting, schedule the export step only after the graph transaction commits successfully.**  This ordering guarantees consistency between the operational graph and analytical views.  

* **Monitor the Airflow scheduler and the GraphDatabaseAdapter health.**  Since OnlineLearning’s throughput depends on timely DAG execution and reliable graph writes, alerts should be set up for task failures, queue back‑logs, or LevelDB disk‑space warnings.

---

### Architectural patterns identified  

* **Agent pattern** – `PersistenceAgent`, `CodeGraphAgent` encapsulate domain‑specific operations.  
* **Adapter (Façade) pattern** – `GraphDatabaseAdapter` abstracts the Graphology + LevelDB implementation.  
* **Modular architecture** – Separate directories (`src/agents`, `storage/`) enforce clear boundaries.  
* **Pipeline / DAG orchestration** – Use of Apache Airflow to schedule extraction workflows.  

### Design decisions and trade‑offs  

* **Centralised graph store** provides a unified query surface but introduces a single point of contention; LevelDB’s on‑disk nature favors durability over low‑latency random access.  
* **Reusing agents across manual and automatic flows** reduces code duplication and ensures data consistency, at the cost of a tighter coupling between modules.  
* **External scheduling (Airflow)** offers powerful dependency management and scalability, but adds operational overhead and a separate technology stack to maintain.  

### System structure insights  

The system is layered: **pipeline → agents → adapter → graph**.  Sibling modules share the lower layers (agents, adapter), while the upper pipeline layer is where OnlineLearning differentiates itself (ML‑driven extraction, scheduled runs).  

### Scalability considerations  

* **Horizontal scaling of extraction pipelines** can be achieved by adding more Airflow workers and replicating the ML inference services.  
* **Graph database scaling** is limited by LevelDB’s single‑process design; for very large knowledge graphs a move to a distributed graph store would be required.  
* **Agent statelessness** (assuming they are) enables multiple instances behind a load balancer, improving throughput for concurrent persistence requests.  

### Maintainability assessment  

The **modular, agent‑centric** layout promotes maintainability: changes to persistence rules or code‑graph construction are isolated to their respective agents.  The **adapter** further isolates storage concerns, making future migrations straightforward.  However, the reliance on an external scheduler and multiple ML model versions introduces cross‑cutting concerns that require disciplined versioning, testing, and monitoring to keep the system maintainable over time.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component follows a modular architecture, with separate modules for different functionalities, such as entity persistence, ontology classification, and insight generation, as seen in the code organization of the src/agents directory, which contains the PersistenceAgent (src/agents/persistence-agent.ts) and the CodeGraphAgent (src/agents/code-graph-agent.ts). This modular approach allows for easier maintenance and scalability of the component, as each module can be updated or modified independently without affecting the rest of the component. For example, the PersistenceAgent is responsible for entity persistence, ontology classification, and content validation, and is used by the GraphDatabaseAdapter (storage/graph-database-adapter.ts) to interact with the central Graphology+LevelDB knowledge graph.

### Siblings
- [ManualLearning](./ManualLearning.md) -- ManualLearning likely utilizes the PersistenceAgent (src/agents/persistence-agent.ts) to store manually created entities in the knowledge graph.
- [EntityPersistenceModule](./EntityPersistenceModule.md) -- EntityPersistenceModule utilizes the PersistenceAgent (src/agents/persistence-agent.ts) to store entities in the knowledge graph.
- [OntologyClassificationModule](./OntologyClassificationModule.md) -- OntologyClassificationModule utilizes the PersistenceAgent (src/agents/persistence-agent.ts) to store classified entities in the knowledge graph.
- [InsightGenerationModule](./InsightGenerationModule.md) -- InsightGenerationModule utilizes the PersistenceAgent (src/agents/persistence-agent.ts) to store generated insights in the knowledge graph.
- [CodeGraphModule](./CodeGraphModule.md) -- CodeGraphModule utilizes the CodeGraphAgent (src/agents/code-graph-agent.ts) to construct and query the code knowledge graph.
- [GraphDatabaseAdapter](./GraphDatabaseAdapter.md) -- GraphDatabaseAdapter utilizes the PersistenceAgent (src/agents/persistence-agent.ts) to store and retrieve data from the knowledge graph.


---

*Generated from 7 observations*
