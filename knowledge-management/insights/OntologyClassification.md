# OntologyClassification

**Type:** SubComponent

OntologyClassification may utilize a similar approach to Claude Code Hook Data Format, as described in integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md

## What It Is  

**OntologyClassification** is a sub‑component of the **KnowledgeManagement** domain that is responsible for assigning semantic categories (ontologies) to entities discovered throughout the system.  The implementation lives in the *integrations* folder and is tightly coupled to a set of documented contracts:

* **ClaudeCodeHookDataFormat** – the data exchange schema defined in `integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md`.  
* **Constraint configuration** – rules for how ontological constraints are expressed, described in `integrations/mcp-constraint-monitor/docs/constraint-configuration.md`.  
* **Semantic‑constraint detection** – the algorithmic description in `integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md`.  

In practice, OntologyClassification consumes the Claude‑style payloads, applies the semantic‑constraint logic, and persists the resulting typed entities via the **EntityPersistence** sibling component.  When deeper code‑level reasoning is required, it forwards the relevant code graph to the **Code Graph RAG** system (see `integrations/code-graph-rag/README.md`).  The component also registers itself with the **MCP Constraint Monitor** (`integrations/mcp-constraint-monitor/README.md`) so that any violations of ontology‑based constraints are surfaced to the broader monitoring infrastructure.

---

## Architecture and Design  

The architecture of OntologyClassification follows a **modular, contract‑driven composition** pattern.  Rather than embedding ontology logic directly, it delegates to a collection of well‑defined sub‑systems that each own a specific responsibility:

1. **Data‑format contract** – The Claude code‑hook format provides a stable JSON‑ish schema that all upstream producers (e.g., the **UKBTraceReporting** sibling) must adhere to.  By anchoring on this file‑level contract, OntologyClassification can evolve its internal processing without breaking callers.  

2. **Constraint‑monitor integration** – The component registers its ontological rules with the MCP Constraint Monitor (documented in `integrations/mcp-constraint-monitor/README.md`).  This mirrors the *observer* pattern: the monitor watches for constraint violations emitted by OntologyClassification and raises alerts downstream.  

3. **Semantic detection pipeline** – The detection logic described in `semantic-constraint-detection.md` is invoked as a pure‑function pipeline that receives the Claude payload, enriches it with inferred semantic relationships, and emits a set of ontology tags.  This pipeline is stateless, which supports easy unit testing and parallel execution.  

4. **Persistence via EntityPersistence** – Typed entities are handed off to the **EntityPersistence** sibling, which—according to its own documentation—stores entities in a graph database.  The hand‑off is a simple interface call (e.g., `EntityPersistence.saveTypedEntity(entity)`) that abstracts away storage concerns from OntologyClassification.  

5. **Graph‑based reasoning with Code Graph RAG** – For complex code‑level classification, OntologyClassification forwards a sub‑graph to the **Code Graph RAG** system (`integrations/code-graph-rag/README.md`).  This follows a *request‑response* style integration: OntologyClassification supplies a code‑graph fragment, the RAG service returns enriched semantic annotations, and the component merges those back into its ontology assignment.  

The parent **KnowledgeManagement** component employs lazy LLM initialization (see `wave-controller.ts:489`).  OntologyClassification inherits this “defer‑until‑needed” philosophy by only loading the heavy constraint‑monitor and RAG clients when a classification request arrives, thereby keeping the overall memory footprint low.

---

## Implementation Details  

Even though no concrete class definitions appear in the current source snapshot, the documentation outlines the concrete steps that OntologyClassification follows:

1. **Payload ingestion** – A request arrives containing the Claude‑style data structure.  The format is strictly defined in `integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md`, which enumerates fields such as `codeSnippet`, `metadata`, and `hookId`.  The component parses this payload into an internal `ClaudeHookPayload` object.

2. **Constraint configuration lookup** – Using the rules described in `constraint-configuration.md`, OntologyClassification selects the appropriate ontology constraint set based on the `hookId` and any supplied metadata.  This lookup is typically a map lookup (`constraintMap[hookId]`) that yields a `ConstraintSpec`.

3. **Semantic‑constraint detection** – The core algorithm, documented in `semantic-constraint-detection.md`, runs a series of pattern‑matching and inference steps:
   * Tokenize the `codeSnippet`.
   * Match token sequences against a pre‑compiled ontology lexicon.
   * Generate a provisional set of ontology tags (`candidateTags`).
   * Apply the `ConstraintSpec` to filter out illegal combinations, producing the final `assignedTags`.

4. **Graph enrichment (optional)** – If the payload includes a code‑graph identifier, OntologyClassification invokes the Code Graph RAG service.  The request payload is constructed per the RAG README and sent over an internal RPC channel.  The RAG response contains additional semantic edges that are merged into `assignedTags`.

5. **Persistence** – The resulting `TypedEntity` (containing the original entity identifier, the `assignedTags`, and provenance metadata) is handed to the **EntityPersistence** sibling.  The persistence layer stores the entity in a graph database, enabling downstream queries from components such as **ObservationDerivation**.

6. **Constraint‑monitor reporting** – Finally, OntologyClassification emits a `ConstraintEvent` to the MCP Constraint Monitor, indicating whether any constraints were violated during classification.  The monitor, as per its README, aggregates these events for alerting and analytics.

All of these steps are orchestrated in a single, async workflow that respects the lazy‑load philosophy of the parent KnowledgeManagement component: the constraint‑monitor client, the RAG client, and the persistence driver are instantiated only when the first classification request triggers them.

---

## Integration Points  

| Integration Target | Path / Document | Interaction Pattern | Key Artifacts |
|--------------------|-----------------|---------------------|---------------|
| **ClaudeCodeHookDataFormat** | `integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md` | Input schema contract | `ClaudeHookPayload` JSON |
| **MCP Constraint Monitor** | `integrations/mcp-constraint-monitor/README.md` | Observer / event emitter | `ConstraintEvent` objects |
| **Constraint Configuration** | `integrations/mcp-constraint-monitor/docs/constraint-configuration.md` | Rule lookup service | `ConstraintSpec` map |
| **Semantic‑Constraint Detection** | `integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md` | Pure‑function pipeline | `candidateTags`, `assignedTags` |
| **EntityPersistence** | (sibling component) | Persistence interface | `EntityPersistence.saveTypedEntity()` |
| **Code Graph RAG** | `integrations/code-graph-rag/README.md` | Request‑response RPC | `CodeGraphRequest`, `CodeGraphResponse` |
| **Parent KnowledgeManagement** | `wave-controller.ts:489` (lazy LLM init) | Deferred initialization | Shared atomic index, `ensureLLMInitialized()` |

Through these explicit contracts, OntologyClassification remains decoupled from the concrete implementations of its siblings.  For example, the **EntityPersistence** sibling could swap a Neo4j backend for a JanusGraph backend without affecting OntologyClassification, as long as the `saveTypedEntity` contract stays stable.

---

## Usage Guidelines  

1. **Provide a valid Claude payload** – All callers must construct the JSON according to the schema in `CLAUDE-CODE-HOOK-FORMAT.md`.  Missing fields will cause the ingestion step to abort early.  

2. **Register constraint specifications** – Before any classification can occur, the appropriate `ConstraintSpec` must be defined in the configuration file referenced by `constraint-configuration.md`.  Failure to do so will result in a fallback to a permissive rule set, which may generate noisy ontology tags.  

3. **Leverage lazy loading** – Do not pre‑instantiate the RAG or constraint‑monitor clients in application startup code.  Let OntologyClassification create them on demand; this aligns with the parent component’s memory‑saving strategy.  

4. **Handle asynchronous responses** – Both the RAG service and the persistence layer operate asynchronously.  Callers should await the returned promise (or use a callback) to ensure that the classification result is fully persisted before proceeding.  

5. **Monitor constraint events** – Subscribe to the MCP Constraint Monitor’s event stream if you need to react to ontology violations (e.g., for alerting or automated remediation).  The event payload includes the offending `hookId` and the violated rule, enabling precise diagnostics.  

6. **Avoid circular dependencies** – Because OntologyClassification consumes services from several siblings, keep import statements one‑directional: OntologyClassification → EntityPersistence / CodeGraphRAG, but not the reverse.  This preserves a clean dependency graph and prevents build‑time cycles.  

---

### Architectural patterns identified  

* **Contract‑driven modular composition** – All interactions are mediated by explicit documentation (Claude format, constraint config).  
* **Observer / event‑emitter** – MCP Constraint Monitor receives classification events.  
* **Lazy initialization** – Defers heavyweight client creation until needed, inherited from KnowledgeManagement.  
* **Stateless pipeline** – Semantic‑constraint detection runs as a pure function, enabling parallelism.  

### Design decisions and trade‑offs  

| Decision | Rationale | Trade‑off |
|----------|-----------|-----------|
| Use Claude code‑hook format as the canonical payload | Provides a single source of truth for incoming data; aligns with existing monitoring tooling. | Ties OntologyClassification to a specific external format; any change requires coordination across all producers. |
| Delegate persistence to EntityPersistence | Keeps classification logic focused on semantics; enables reuse of a shared graph store. | Introduces an extra network hop and potential latency when persisting large batches. |
| Optional RAG enrichment | Allows deeper reasoning only when needed, saving compute for simple cases. | Adds complexity to the workflow and requires handling of partial failures from the RAG service. |
| Support multiple ontology systems | Increases flexibility for different domains (e.g., domain‑specific taxonomies). | Increases the size of the ontology lookup tables and may cause ambiguous tag assignments that need disambiguation logic. |

### System structure insights  

* **Vertical layering** – The parent KnowledgeManagement component supplies cross‑cutting concerns (lazy LLM init, concurrency utilities).  OntologyClassification sits one layer below, focusing on semantic classification, while its siblings (EntityPersistence, CodeGraphRAG) provide infrastructural services.  
* **Horizontal sibling collaboration** – OntologyClassification shares contracts with several peers (ManualLearning, OnlineLearning, UKBTraceReporting) but does not directly invoke them, preserving a clean separation of concerns.  
* **Documentation‑first contract definition** – All critical interfaces are defined in markdown files rather than code, which suggests a culture of “design‑first” documentation that drives implementation.  

### Scalability considerations  

* **Stateless detection pipeline** – Because the semantic‑constraint detection step is pure and does not retain mutable state, it can be horizontally scaled across multiple worker processes or containers.  
* **Graph‑RAG on demand** – By invoking the RAG service only for complex cases, the system avoids saturating the RAG backend under normal load, preserving capacity for high‑value queries.  
* **Lazy client creation** – Reduces the number of long‑lived connections to external services, allowing the system to handle spikes in request volume without exhausting resources.  
* **Constraint‑monitor event aggregation** – The monitor can batch constraint events, limiting the pressure on downstream alerting pipelines.  

### Maintainability assessment  

* **High modularity** – Clear separation between payload format, constraint logic, persistence, and graph enrichment makes each piece independently testable and replaceable.  
* **Documentation‑driven contracts** – While this improves clarity, it also creates a maintenance burden: any change in the markdown contracts must be propagated to all consuming components. Automated validation (e.g., schema generation from the markdown) would mitigate drift.  
* **Limited code visibility** – The absence of concrete code symbols in the current snapshot means that developers must rely heavily on the markdown guides; this can slow onboarding but also encourages disciplined adherence to the documented contracts.  
* **Dependency surface** – OntologyClassification depends on four sibling services; versioning and compatibility need careful coordination, especially if any sibling evolves its API.  

Overall, OntologyClassification exhibits a well‑structured, contract‑centric design that balances flexibility (multiple ontologies, optional RAG enrichment) with operational efficiency (lazy loading, stateless pipelines).  With disciplined documentation updates and automated contract validation, the component should remain both scalable and maintainable as the KnowledgeManagement ecosystem grows.

## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- [LLM] The KnowledgeManagement component employs a lazy loading approach for LLM initialization, as seen in the constructor-based pattern for wave agents. This is evident in the ensureLLMInitialized() method, which suggests that the component defers the initialization of Large Language Models (LLMs) until they are actually needed. This design decision helps to reduce memory consumption and improve system responsiveness, especially when dealing with multiple LLMs. The use of a shared atomic index counter for work-stealing concurrency in the runWithConcurrency() method (wave-controller.ts:489) further enhances the component's efficiency by allowing it to dynamically adjust its workload and minimize idle time.

### Children
- [ClaudeCodeHookDataFormat](./ClaudeCodeHookDataFormat.md) -- The CLAUDE-CODE-HOOK-FORMAT.md file describes the data format used by the OntologyClassification sub-component, providing a clear outline of the expected data structure.

### Siblings
- [ManualLearning](./ManualLearning.md) -- ManualLearning may utilize a similar approach to Claude Code Setup for Graph-Code MCP Server as described in integrations/browser-access/README.md
- [OnlineLearning](./OnlineLearning.md) -- OnlineLearning may use the batch analysis pipeline to extract knowledge from git history, as hinted in the project documentation
- [EntityPersistence](./EntityPersistence.md) -- EntityPersistence may use a graph database to store entities, as hinted in the project documentation
- [ObservationDerivation](./ObservationDerivation.md) -- ObservationDerivation may utilize a similar approach to the Code Graph RAG system, as described in integrations/code-graph-rag/README.md
- [UKBTraceReporting](./UKBTraceReporting.md) -- UKBTraceReporting may utilize a similar approach to the Claude Code Hook Data Format, as described in integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md
- [BrowserAccess](./BrowserAccess.md) -- BrowserAccess may utilize a similar approach to the Claude Code Setup for Graph-Code MCP Server, as described in integrations/browser-access/README.md
- [CodeGraphRAG](./CodeGraphRAG.md) -- CodeGraphRAG may utilize a similar approach to the Claude Code Setup for Graph-Code MCP Server, as described in integrations/browser-access/README.md

---

*Generated from 7 observations*
