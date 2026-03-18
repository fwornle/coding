# ViolationCapture

**Type:** SubComponent

ViolationCapture works closely with the ContentValidator sub-component to capture validation failures and persist them for further analysis.

## What It Is  

**ViolationCapture** is a sub‑component of the **ConstraintSystem** that records every constraint‑validation failure detected by the system.  The implementation lives inside the ConstraintSystem package (the exact source file is not listed in the observations, but all interactions are mediated through the shared **GraphDatabaseAdapter** found at  

```
integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.js
```  

ViolationCapture receives failure reports from **ContentValidator**, enriches them with data from **SemanticAnalyzer**, persists the violation objects as graph nodes/edges via the adapter, and then pushes notifications to the appropriate stakeholders.  The sub‑component follows a single, canonical data model for “constraint violations,” which guarantees that every consumer—whether a reporting UI, an analytics pipeline, or an audit service—sees a uniform representation.

---

## Architecture and Design  

The observations reveal a **modular, graph‑centric architecture**.  The primary design pattern evident is a **Repository‑style abstraction**: all persistence work is funneled through the `GraphDatabaseAdapter`, which hides the underlying graph‑database API behind methods such as *addNode*, *updateNode*, and *addEdge*.  By delegating storage concerns to this adapter, ViolationCapture remains focused on the business logic of “what to capture” rather than “how to store it.”

A second, implicit pattern is an **Observer‑like notification mechanism**.  After a violation is recorded, ViolationCapture “alerts stakeholders,” indicating a publish‑subscribe style flow where downstream listeners (e.g., alerting services, dashboards) subscribe to violation events without the capture logic needing to know their identities.  This decouples the capture logic from the notification delivery channels and supports extensibility.

Interaction flow:  

1. **ContentValidator** detects a rule breach and hands the failure payload to ViolationCapture.  
2. ViolationCapture enriches the payload using **SemanticAnalyzer** (e.g., adding NLP‑derived context).  
3. The enriched violation is transformed into the standardized graph model and persisted via the **GraphDatabaseAdapter** (`addNode`, `addEdge`, `updateNode`).  
4. A notification event is emitted, reaching any registered stakeholder consumers.  

All three sibling components—ContentValidator, SemanticAnalyzer, and GraphDatabaseAdapter—share the same graph‑database foundation, reinforcing a **shared‑infrastructure** approach within the ConstraintSystem hierarchy.

---

## Implementation Details  

Even though the source code for ViolationCapture itself is not listed, the observations give a clear picture of its internal mechanics:  

* **Standardized Data Model** – ViolationCapture defines a fixed schema for violation records (e.g., fields for constraint ID, offending entity ID, severity, timestamp, and optional semantic tags).  This model is compatible with the graph schema enforced by `GraphDatabaseAdapter`, ensuring that each violation becomes a node with edges linking it to the offending entity and the constraint definition.  

* **Graph Persistence** – Calls to the adapter are the only persistence touch‑points.  Typical calls are:  

  ```js
  // Pseudo‑code derived from observations
  graphAdapter.addNode('Violation', violationPayload);
  graphAdapter.addEdge('violates', entityNodeId, violationNodeId);
  graphAdapter.updateNode(violationNodeId, { status: 'acknowledged' });
  ```  

  These operations let the system query violations efficiently (e.g., “find all violations for a given constraint” or “trace the lineage of a violated entity”).  

* **Notification Engine** – After a successful write, ViolationCapture triggers a notification.  While the concrete implementation is not detailed, the wording “notification mechanism, alerting stakeholders” suggests a lightweight event emitter or message‑bus call such as `eventBus.publish('violation.captured', payload)`.  Stakeholder services subscribe to this channel to act in real time.  

* **Query & Filter API** – ViolationCapture exposes methods that translate high‑level filter criteria (severity, time range, constraint type) into graph queries executed via the adapter.  Because the graph database excels at relationship traversals, complex filters (e.g., “all high‑severity violations that involve entities linked to a deprecated taxonomy”) are feasible without additional indexing layers.  

* **Scalability Hooks** – The component is described as “designed for scalability, handling high volumes of violation data without impacting system performance.”  This is achieved primarily by:  

  * Leveraging the inherent horizontal scalability of the underlying graph store.  
  * Performing bulk writes where possible (batching multiple violation nodes/edges).  
  * Decoupling notification delivery from the write path, so a spike in violations does not block persistence.  

---

## Integration Points  

ViolationCapture sits at the nexus of three major collaborators:  

| Integration | Direction | Mechanism (as observed) |
|-------------|-----------|------------------------|
| **ContentValidator** | Input | Receives raw validation failures; both components use the same `GraphDatabaseAdapter` for reading entity relationships. |
| **SemanticAnalyzer** | Enrichment | Calls into NLP‑driven analysis to augment violation records with semantic context (e.g., extracted keywords, sentiment). |
| **GraphDatabaseAdapter** | Persistence & Query | All create, read, update, and delete operations on violation data are performed through the adapter located at `integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.js`. |
| **Stakeholder Notification Channels** | Output | Emits events after a violation is stored; exact channel (message bus, webhook, etc.) is not specified but is abstracted behind the “notification mechanism.” |
| **ConstraintSystem (parent)** | Ownership | ViolationCapture is a child of ConstraintSystem; the parent component orchestrates overall constraint evaluation and delegates capture responsibilities to this sub‑component. |

Because the siblings share the same adapter, any change to the graph schema or adapter API propagates uniformly, reducing duplication and keeping integration contracts stable.

---

## Usage Guidelines  

1. **Always submit violations through the public ViolationCapture API** rather than invoking the GraphDatabaseAdapter directly.  This guarantees that the standardized data model and notification side‑effects are applied consistently.  

2. **Enrich payloads before calling capture**: if additional semantic insight is available (e.g., from `SemanticAnalyzer`), attach it to the violation object.  The richer the context, the more useful downstream analysis will be.  

3. **Respect the notification contract**: if a consumer only needs to be informed after the violation is persisted, subscribe to the `violation.captured` event (or the equivalent channel) rather than polling the graph.  This avoids unnecessary load on the database.  

4. **Batch when possible**: for high‑throughput scenarios (e.g., bulk content imports), accumulate violations and invoke a bulk‑write method on ViolationCapture if one exists.  This leverages the adapter’s bulk‑operation capabilities and mitigates write amplification.  

5. **Do not mutate stored violation nodes directly**; use the provided update functions on ViolationCapture.  Direct graph edits bypass the notification mechanism and can lead to inconsistent state across reporting tools.  

---

### Architectural patterns identified  

* **Repository abstraction** – `GraphDatabaseAdapter` acts as a repository for graph entities, isolating persistence details.  
* **Observer / Publish‑Subscribe** – The “notification mechanism” follows an observer‑style pattern, decoupling producers (ViolationCapture) from consumers (stakeholder services).  

### Design decisions and trade‑offs  

* **Graph‑database persistence** was chosen for its natural fit with constraint relationships, enabling expressive queries at the cost of requiring developers to understand graph modeling.  
* **Standardized violation model** improves consistency and downstream tooling but imposes a rigid schema that must evolve carefully.  
* **Separate notification path** enhances responsiveness but adds an extra integration point that must be monitored for reliability.  

### System structure insights  

ViolationCapture is a leaf sub‑component under **ConstraintSystem**, sharing the **GraphDatabaseAdapter** with its siblings **ContentValidator** and **SemanticAnalyzer**.  This shared adapter creates a cohesive data‑access layer across the entire constraint‑evaluation pipeline, while each sibling focuses on a distinct responsibility (validation, semantic enrichment, capture).  

### Scalability considerations  

* The graph database’s native horizontal scaling handles large violation volumes.  
* Bulk write support and asynchronous notifications prevent back‑pressure on the capture path.  
* Query and filter capabilities are off‑loaded to the graph engine, avoiding custom indexing layers.  

### Maintainability assessment  

* **High cohesion** – ViolationCapture’s responsibilities (capture, persistence, notification) are well‑defined and isolated from validation or analysis logic.  
* **Low coupling** – Interaction occurs through clearly defined interfaces (adapter, event bus), making it straightforward to replace or upgrade the underlying graph store.  
* **Standard data model** – Guarantees that any new consumer can rely on a stable schema, reducing the need for ad‑hoc data transformations.  
* **Potential risk** – Central reliance on the `GraphDatabaseAdapter` means that changes to the adapter’s API ripple through all siblings; rigorous versioning and backward‑compatible contracts are essential.  

By adhering to the guidelines above, developers can extend ViolationCapture safely, keep performance predictable, and maintain the overall health of the ConstraintSystem’s violation‑management pipeline.


## Hierarchy Context

### Parent
- [ConstraintSystem](./ConstraintSystem.md) -- [LLM] The ConstraintSystem component utilizes a GraphDatabaseAdapter (integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.js) to store and retrieve knowledge in a graph-based structure, which enables efficient querying and analysis of entity relationships. This choice of data storage allows for flexible and scalable management of complex constraints. Furthermore, the GraphDatabaseAdapter class provides methods for adding, removing, and updating graph nodes and edges, facilitating dynamic modifications to the knowledge graph.

### Siblings
- [ContentValidator](./ContentValidator.md) -- ContentValidator utilizes the GraphDatabaseAdapter class (integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.js) to retrieve and validate entity relationships.
- [SemanticAnalyzer](./SemanticAnalyzer.md) -- SemanticAnalyzer leverages natural language processing (NLP) techniques to parse and understand entity content.
- [GraphDatabaseAdapter](./GraphDatabaseAdapter.md) -- GraphDatabaseAdapter implements a standardized data model for representing entities, relationships, and constraints in the graph database.


---

*Generated from 7 observations*
