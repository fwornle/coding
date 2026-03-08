# CodeKnowledgeGraph

**Type:** SubComponent

The code knowledge graph constructor in integrations/mcp-server-semantic-analysis/src/code-knowledge-graph/code-knowledge-graph-constructor.ts handles errors and exceptions by logging them to a file and notifying the development team

## What It Is  

The **CodeKnowledgeGraph** sub‑component lives under the *SemanticAnalysis* umbrella in the repository path `integrations/mcp-server-semantic-analysis/src/code-knowledge-graph/`. Its core responsibilities are to **parse source code into an abstract syntax tree (AST), extract code entities, model the relationships between those entities, and persist the resulting graph**. The entry point for this work is the **`code-knowledge-graph-constructor.ts`** file, which drives the AST parsing, error handling, and coordination with the **`entity-relationship-manager.ts`**. The final graph is stored through the **`code-knowledge-graph-db.ts`** module, which talks to a graph‑database backend. Down‑stream agents—most notably the **Insight Generation Agent**—consume the persisted graph to produce higher‑level insights about the code base.

---

## Architecture and Design  

The observations reveal a **modular, decoupled architecture** built around three primary responsibilities:

1. **Parsing & Construction** – `code-knowledge-graph-constructor.ts` owns the AST parsing step. By isolating parsing logic in its own module, the design follows a *separation‑of‑concerns* approach that keeps the heavy language‑specific processing independent from relationship handling.  

2. **Relationship Management** – `entity-relationship-manager.ts` is dedicated to building and maintaining the edges between entities. It persists those edges in a **graph database** (explicitly noted in observation 5), which is a natural fit for representing code‑level relationships such as inheritance, calls, and imports.  

3. **Persistence Layer** – `code-knowledge-graph-db.ts` abstracts the underlying storage details, offering a single point of interaction for both the constructor and the relationship manager.  

Communication between the constructor and the relationship manager occurs **asynchronously via a message queue** (observation 6). This introduces an *event‑driven* style of interaction without labeling it as a formal pattern; the queue decouples the two modules, allowing each to scale or be replaced independently.  

Error handling is centralized in the constructor: any parsing or processing failure is **logged to a file and a notification is sent to the development team** (observation 4). This explicit logging‑plus‑alert strategy ensures that problems are visible early in the pipeline.

Because **CodeKnowledgeGraph** is a child of **SemanticAnalysis**, it inherits the broader modular philosophy described for sibling agents (e.g., OntologyClassificationAgent, InsightGenerationAgent). All agents share a common **BaseAgent** abstract class, which standardizes response structures and confidence calculations, although the graph component itself is not an agent but a supporting data service.

---

## Implementation Details  

### Constructor (`code-knowledge-graph-constructor.ts`)  
- **AST Parsing** – The constructor invokes an AST parser (the specific parser library is not named) to walk through source files. During this walk it extracts **entities** such as classes, functions, variables, and modules.  
- **Error Management** – All exceptions thrown by the parser or downstream steps are caught, written to a log file, and a notification mechanism (likely an internal alert service) informs the development team, ensuring rapid visibility of parsing issues.  

### Entity Relationship Manager (`entity-relationship-manager.ts`)  
- **Graph Database Interaction** – The manager uses a graph database (e.g., Neo4j, JanusGraph – the exact product is not specified) to store **entity relationships**. Nodes represent code entities; edges encode relationships like “calls”, “inherits”, or “imports”.  
- **Message Queue Integration** – The constructor publishes messages (containing parsed entity payloads) to a queue. The relationship manager consumes these messages, transforms the payload into graph operations, and writes them to the database. This async hand‑off isolates parsing latency from database write latency.  

### Persistence (`code-knowledge-graph-db.ts`)  
- Provides a thin wrapper around the graph database driver, exposing CRUD‑style methods that the relationship manager uses. By centralizing DB access, the module makes it easier to swap the underlying storage technology if needed.  

### Consumption by Insight Generation  
- The **Insight Generation Agent** (found at `integrations/mcp-server-semantic-analysis/src/agents/insight-generation-agent.ts`) queries the persisted graph to discover patterns, dependencies, or architectural smells. This downstream usage demonstrates that the graph is the canonical source of truth for code‑level knowledge within the SemanticAnalysis subsystem.  

---

## Integration Points  

1. **Upstream – SemanticAnalysis**  
   - The **SemanticAnalysis** component orchestrates the overall pipeline. It triggers the CodeKnowledgeGraph constructor as part of the code‑analysis stage, ensuring that the graph is up‑to‑date before any insight agents run.  

2. **Sibling Agents**  
   - While the **OntologyClassificationAgent** focuses on classifying entities against an ontology, it can leverage the same entity identifiers produced by the constructor. The **EntityValidationModule** may later validate the relationships stored by the manager, using the same graph database as its data source.  

3. **Message Queue**  
   - The queue (type not specified) acts as the contract between the constructor and the relationship manager. Any changes to the message schema must be coordinated across both modules.  

4. **Graph Database**  
   - Both the relationship manager and any downstream agents (e.g., InsightGenerationAgent, SemanticInsightGenerator) read from the same graph store, providing a unified view of code relationships.  

5. **Error Notification System**  
   - The logging and notification mechanism referenced in observation 4 likely integrates with the broader observability stack of the MCP server (e.g., centralized log aggregation, alerting service).  

---

## Usage Guidelines  

- **Invoke via SemanticAnalysis** – Developers should not call the constructor directly; instead, they trigger the **SemanticAnalysis** pipeline, which ensures that the graph is built in the correct order relative to other agents.  
- **Message Schema Stability** – When extending the data extracted by the constructor (e.g., adding new entity attributes), update the message payload definition and ensure the relationship manager’s consumer logic is updated simultaneously to avoid deserialization errors.  
- **Error Monitoring** – Monitor the constructor’s log file and the associated alert channel. Frequent parsing errors may indicate unsupported language features or malformed source files and should be addressed promptly.  
- **Graph Database Maintenance** – Periodically review the graph database’s health (index usage, storage growth). Since the graph grows with each codebase analysis, consider archiving older snapshots if long‑term retention is not required.  
- **Testing** – Unit‑test the constructor’s AST extraction logic with representative source files. Integration tests should cover the end‑to‑end flow: source → queue → relationship manager → graph DB, verifying that expected nodes/edges appear.  

---

### 1. Architectural patterns identified  
- **Separation of Concerns** – distinct modules for parsing, relationship handling, and persistence.  
- **Asynchronous Messaging** – use of a message queue to decouple the constructor from the relationship manager.  
- **Graph‑Database Persistence** – entities and relationships are stored in a graph database, matching the domain model.  
- **Centralized Error Logging & Notification** – constructor‑level error handling with file logging and team alerts.

### 2. Design decisions and trade‑offs  
- **Async queue vs. direct calls** – improves scalability and fault isolation but adds latency and operational overhead (queue management, message schema versioning).  
- **Graph DB choice** – excellent for relationship queries, but introduces a specialized storage dependency and may require graph‑specific tuning.  
- **Dedicated constructor** – isolates language‑specific parsing, making it easier to extend to new languages, yet it duplicates some error‑handling logic that could be shared elsewhere.  

### 3. System structure insights  
- CodeKnowledgeGraph sits as a **child component** of SemanticAnalysis and serves as the **data foundation** for sibling agents that perform classification, validation, and insight generation.  
- The three‑file module set (`code-knowledge-graph-constructor.ts`, `entity-relationship-manager.ts`, `code-knowledge-graph-db.ts`) forms a clear vertical slice: input → transformation → storage.  

### 4. Scalability considerations  
- The **message queue** enables horizontal scaling of both the constructor (multiple parsers) and the relationship manager (multiple consumers), allowing the system to handle larger codebases.  
- The **graph database** can scale horizontally (sharding) or vertically (more memory) depending on the chosen product, but query performance must be monitored as the node/edge count grows.  

### 5. Maintainability assessment  
- **High maintainability** thanks to well‑defined responsibilities and isolated modules.  
- The explicit error‑logging path provides clear failure signals, simplifying debugging.  
- Potential maintenance burden lies in managing the message schema and graph‑DB schema evolution; careful versioning and backward‑compatible changes are essential.  

Overall, the **CodeKnowledgeGraph** sub‑component exemplifies a clean, modular approach to building a persistent, queryable representation of source‑code structure, tightly integrated with the broader SemanticAnalysis pipeline while remaining independently scalable and testable.


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component utilizes a modular design, with each agent responsible for a specific task, such as the OntologyClassificationAgent for ontology-based classification, and the SemanticAnalysisAgent for analyzing git and vibe data. This is evident in the file structure, where each agent has its own file, such as integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts and integrations/mcp-server-semantic-analysis/src/agents/semantic-analysis-agent.ts. The use of a BaseAgent abstract class, as seen in integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts, standardizes the responses and confidence calculations across all agents, promoting consistency and maintainability.

### Siblings
- [Pipeline](./Pipeline.md) -- The coordinator agent in integrations/mcp-server-semantic-analysis/src/agents/coordinator-agent.ts utilizes a DAG-based execution model with topological sort in batch-analysis.yaml steps, each step declaring explicit depends_on edges
- [Ontology](./Ontology.md) -- The ontology classification agent in integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts utilizes a hierarchical classification model to resolve entity types
- [Insights](./Insights.md) -- The insight generation agent in integrations/mcp-server-semantic-analysis/src/agents/insight-generation-agent.ts utilizes a machine learning model to identify patterns in the data
- [EntityValidationModule](./EntityValidationModule.md) -- The entity validation agent in integrations/mcp-server-semantic-analysis/src/entity-validation-module/entity-validation-agent.ts utilizes a rule-based system to validate entities
- [SemanticInsightGenerator](./SemanticInsightGenerator.md) -- The semantic insight generator agent in integrations/mcp-server-semantic-analysis/src/semantic-insight-generator/semantic-insight-generator-agent.ts utilizes a machine learning model to identify patterns in the code and entity relationships
- [LLMIntegrationModule](./LLMIntegrationModule.md) -- The LLM integration agent in integrations/mcp-server-semantic-analysis/src/llm-integration-module/llm-integration-agent.ts initializes the LLM service and handles interactions
- [BaseAgent](./BaseAgent.md) -- The BaseAgent class in integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts provides a base class for all agents


---

*Generated from 7 observations*
