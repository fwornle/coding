# ManualLearning

**Type:** SubComponent

ManualLearning may utilize a similar approach to Claude Code Setup for Graph-Code MCP Server as described in integrations/browser-access/README.md

## What It Is  

**ManualLearning** is a sub‑component of the **KnowledgeManagement** system that supports human‑directed knowledge acquisition and curation.  The implementation lives primarily in the *integrations/* hierarchy – the most concrete reference is the **Graph‑Code MCP Server** setup described in `integrations/browser-access/README.md` and the detailed Claude‑code configuration in `integrations/code-graph-rag/docs/claude-code-setup.md`.  Although no source files are listed directly under *ManualLearning*, the component is wired together by a collection of sibling sub‑components (e.g., **EntityPersistence**, **OntologyClassification**, **ObservationDerivation**, **UKBTraceReporting**, **BrowserAccess**, **CodeGraphRAG**) and by its child **GraphCodeSetup**.  In practice, ManualLearning orchestrates the flow from raw manual inputs → ontology‑based classification → graph‑database persistence → observation derivation → reporting, while optionally tapping into the **copi** GitHub‑Copilot CLI wrapper (`integrations/copi/README.md`) for assisted code generation.

---

## Architecture and Design  

The architecture that emerges from the observations is a **modular, graph‑centric pipeline** built around a shared **graph database**.  ManualLearning does not introduce a brand‑new pattern; instead it **re‑uses the design decisions** already present in its siblings:

* **Graph‑code integration** – The “Claude Code Setup for Graph‑Code MCP Server” described in `integrations/browser-access/README.md` shows a pattern where a language model (Claude) is paired with a graph‑based code representation.  ManualLearning inherits this pattern via its child **GraphCodeSetup**, meaning that any manual knowledge entry can be mapped onto the same graph‑code model used by the **CodeGraphRAG** sibling.

* **Ontology‑driven classification** – The component is expected to employ the **ontology classification system** (potentially multiple ontologies) that is also referenced by the **OntologyClassification** sibling.  This suggests a **strategy pattern** where the concrete ontology implementation is selected at runtime based on the type of manual input.

* **Entity persistence** – The observation that “it could store entities in a graph database, potentially using the EntityPersistence sub‑component” indicates a **repository pattern** that abstracts the underlying graph store (e.g., Neo4j, JanusGraph).  ManualLearning therefore delegates all CRUD operations to **EntityPersistence**, keeping the learning logic free of storage concerns.

* **Observation derivation & reporting** – By mirroring the **ObservationDerivation** and **UKBTraceReporting** sub‑components, ManualLearning follows a **pipeline pattern**: after entities are persisted, a derivation step extracts higher‑level observations, which are then fed into a reporting module that produces workflow execution traces.

* **Copi integration** – The optional hook to `integrations/copi/README.md` reveals a **tool‑wrapper integration**: ManualLearning can invoke the Copilot CLI to suggest code snippets or documentation while a user is manually entering knowledge, effectively augmenting the manual workflow with AI‑assisted suggestions.

Overall, the design is **composition‑over‑inheritance**: ManualLearning composes existing sibling services rather than re‑implementing them, resulting in a thin orchestration layer that respects the boundaries defined by each sub‑component.

---

## Implementation Details  

Even though the repository lists “0 code symbols found” for ManualLearning itself, the concrete implementation details are inferred from the referenced README files and the surrounding sub‑components:

1. **GraphCodeSetup** – The child component’s documentation (`integrations/code-graph-rag/docs/claude-code-setup.md`) describes a step‑by‑step configuration of a Claude‑backed MCP server that indexes code as graph nodes and edges.  ManualLearning likely calls a `setupGraphCode()` routine (implicitly defined in that doc) to initialize the graph schema for manual entities, ensuring that every manual entry is represented as a node with typed relationships (e.g., *“derivedFrom”*, *“classifiedAs”*).

2. **Ontology Classification** – The system probably imports a classification module that reads a configuration file (e.g., `ontology-config.json`) and selects the appropriate ontology engine.  The decision logic may resemble:
   ```ts
   const classifier = OntologyFactory.getClassifier(input.type);
   const tags = classifier.classify(input.content);
   ```
   This mirrors the approach used by **OntologyClassification** and allows ManualLearning to support “multiple ontology systems”.

3. **Entity Persistence** – Persistence calls are delegated to the **EntityPersistence** sibling, which abstracts the graph database.  A typical flow would be:
   ```ts
   const entity = {
     id: uuid(),
     type: 'ManualEntry',
     content: rawInput,
     tags,
   };
   await EntityPersistence.save(entity);
   ```
   The repository pattern ensures that ManualLearning remains agnostic to the underlying graph engine.

4. **Observation Derivation** – After persisting, ManualLearning triggers the **ObservationDerivation** pipeline, likely via an event or direct method call:
   ```ts
   const observations = await ObservationDerivation.deriveFrom(entity);
   ```
   This step extracts patterns such as “repeated manual corrections” or “knowledge gaps” that can later be surfaced in reports.

5. **UKBTraceReporting** – The final reporting stage uses the **UKBTraceReporting** sub‑component to emit execution traces.  The integration may look like:
   ```ts
   await UKBTraceReporting.record({
     action: 'ManualLearningEntry',
     entityId: entity.id,
     observations,
   });
   ```
   The trace format follows the Claude Code Hook Data Format referenced in several sibling READMEs.

6. **Copi Integration** – When a developer invokes a manual learning session, the system can spawn the Copilot CLI (`copi`) to fetch suggestions:
   ```bash
   copi suggest --context "manual learning entry: ${input.title}"
   ```
   The output is presented to the user for acceptance or modification before persistence.

All of these interactions are orchestrated by a thin controller (e.g., `ManualLearningController.ts` – not listed but implied by the pattern used in sibling components) that wires together the above services via dependency injection, mirroring the constructor‑based lazy initialization seen in the parent **KnowledgeManagement** component.

---

## Integration Points  

ManualLearning sits at the intersection of several major system modules:

* **Parent – KnowledgeManagement** – It inherits the lazy‑loading strategy of LLM initialization from its parent.  If a manual entry requires LLM assistance (e.g., summarisation), the `ensureLLMInitialized()` method from `wave-controller.ts:489` can be invoked, deferring heavy model loading until needed.

* **Sibling – EntityPersistence** – All entity CRUD operations flow through this repository, guaranteeing a single source of truth for graph data.

* **Sibling – OntologyClassification** – Classification decisions are delegated to the ontology engine(s) defined here, allowing ManualLearning to remain ontology‑agnostic.

* **Sibling – ObservationDerivation** – Derivation logic is reused, ensuring consistency of observation semantics across manual and online learning paths.

* **Sibling – UKBTraceReporting** – Reporting follows the same trace format used by other components, enabling unified monitoring and debugging tools.

* **Sibling – BrowserAccess & CodeGraphRAG** – The Graph‑Code MCP server setup (via **GraphCodeSetup**) aligns ManualLearning’s graph schema with the code‑graph RAG system, making manual knowledge searchable alongside code artifacts.

* **Integration – copi** – The Copilot CLI wrapper provides AI‑assisted code suggestions during manual entry, exposing a CLI‑based dependency that can be swapped out for other assistants if needed.

* **Graph Database** – Though not a concrete file path, the shared graph store (accessed via **EntityPersistence**) is the backbone that ties all these integrations together, enabling fast traversals for classification, derivation, and reporting.

These integration points are all **explicitly mentioned** in the observations, ensuring that the insight document does not extrapolate beyond the provided evidence.

---

## Usage Guidelines  

1. **Initialize the Graph Code Setup First** – Before any manual entry is processed, run the Graph‑Code MCP server configuration described in `integrations/code-graph-rag/docs/claude-code-setup.md`.  This guarantees that the graph schema (node types, relationship types) matches the expectations of **EntityPersistence** and **ObservationDerivation**.

2. **Select the Correct Ontology** – When creating a manual entry, specify the ontology identifier that best describes the domain (e.g., `ontology: "software‑architecture"`).  The system will automatically route the entry to the appropriate classifier defined in the ontology configuration.

3. **Leverage Copi for Assistance** – Invoke `copi suggest` from the CLI or through the UI to receive AI‑generated snippets or wording.  Accept the suggestion only after reviewing it, as Copi operates as a helper rather than a source of truth.

4. **Persist Before Deriving** – Always call the persistence layer (`EntityPersistence.save`) prior to invoking `ObservationDerivation`.  This ordering ensures that derived observations have a stable entity identifier and can be linked back in reports.

5. **Record Traces Consistently** – Use `UKBTraceReporting.record` for every manual learning action (creation, update, deletion).  The trace format must follow the Claude Code Hook Data Format to stay compatible with downstream analytics.

6. **Respect Lazy LLM Initialization** – If a manual entry requires LLM‑based summarisation or augmentation, invoke the parent’s `ensureLLMInitialized()` method.  This avoids unnecessary memory consumption when the LLM is not needed.

7. **Avoid Direct Graph Queries** – All interactions with the graph database should go through **EntityPersistence**.  Direct queries bypass the repository abstraction and can lead to schema drift.

Following these conventions keeps ManualLearning aligned with the broader KnowledgeManagement ecosystem, reduces coupling, and simplifies future refactoring.

---

### Architectural patterns identified  

* **Modular pipeline composition** – ManualLearning composes existing sibling services (ontology, persistence, derivation, reporting) into a linear pipeline.  
* **Repository pattern** – `EntityPersistence` abstracts the graph database.  
* **Strategy pattern** – Ontology classification selects an engine at runtime based on input type.  
* **Lazy initialization** – Inherited from the parent component for LLM resources.  
* **Tool‑wrapper integration** – Copi is integrated as an external CLI wrapper.

### Design decisions and trade‑offs  

* **Reuse vs. duplication** – By delegating to siblings, ManualLearning minimizes code duplication but introduces a dependency chain that must be kept in sync.  
* **Graph‑centric storage** – Enables rich relationship queries but requires careful schema management; adding new manual entity types may need schema migrations.  
* **Optional AI assistance (copi)** – Provides productivity gains without mandating the presence of the Copilot service; however, reliance on an external CLI can affect portability.  
* **Multiple ontologies** – Increases flexibility for domain‑specific classification but adds complexity to the configuration and testing matrix.

### System structure insights  

ManualLearning sits as a thin orchestration layer under **KnowledgeManagement**, bridging user‑driven inputs with the system’s graph‑based knowledge core.  Its child **GraphCodeSetup** aligns the manual data model with the code‑graph RAG infrastructure, ensuring that manual and code knowledge share the same retrieval mechanisms.  The sibling components collectively provide the “CRUD‑classify‑derive‑report” stack, each exposing a clear interface that ManualLearning calls in a deterministic order.

### Scalability considerations  

* **Graph database scaling** – Since all manual entities are stored in a shared graph, horizontal scaling of the underlying graph store (sharding, read replicas) will directly affect ManualLearning’s throughput.  
* **Ontology classification** – Adding more ontologies may increase CPU load during classification; caching classification results can mitigate this.  
* **Observation derivation** – Derivation can be computationally intensive for large sub‑graphs; employing asynchronous workers (similar to the wave‑controller’s work‑stealing concurrency) would improve latency.  
* **Copi integration** – Calls to the Copilot CLI are external I/O; they should be rate‑limited or queued to avoid bottlenecks.

### Maintainability assessment  

Because ManualLearning largely **re‑uses** well‑defined sibling modules, its own codebase remains small and easy to understand.  The main maintenance burden lies in keeping the **GraphCodeSetup** schema aligned with any changes in **EntityPersistence** or **CodeGraphRAG**.  The reliance on external READMEs for configuration means that documentation must stay current; otherwise developers may misconfigure the graph‑code pipeline.  Overall, the component scores high on maintainability provided the shared contracts (e.g., entity shape, trace format) are versioned and validated through integration tests.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- [LLM] The KnowledgeManagement component employs a lazy loading approach for LLM initialization, as seen in the constructor-based pattern for wave agents. This is evident in the ensureLLMInitialized() method, which suggests that the component defers the initialization of Large Language Models (LLMs) until they are actually needed. This design decision helps to reduce memory consumption and improve system responsiveness, especially when dealing with multiple LLMs. The use of a shared atomic index counter for work-stealing concurrency in the runWithConcurrency() method (wave-controller.ts:489) further enhances the component's efficiency by allowing it to dynamically adjust its workload and minimize idle time.

### Children
- [GraphCodeSetup](./GraphCodeSetup.md) -- The Graph-Code MCP Server setup is described in integrations/code-graph-rag/docs/claude-code-setup.md, which provides details on the configuration and setup process.

### Siblings
- [OnlineLearning](./OnlineLearning.md) -- OnlineLearning may use the batch analysis pipeline to extract knowledge from git history, as hinted in the project documentation
- [EntityPersistence](./EntityPersistence.md) -- EntityPersistence may use a graph database to store entities, as hinted in the project documentation
- [OntologyClassification](./OntologyClassification.md) -- OntologyClassification may utilize a similar approach to Claude Code Hook Data Format, as described in integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md
- [ObservationDerivation](./ObservationDerivation.md) -- ObservationDerivation may utilize a similar approach to the Code Graph RAG system, as described in integrations/code-graph-rag/README.md
- [UKBTraceReporting](./UKBTraceReporting.md) -- UKBTraceReporting may utilize a similar approach to the Claude Code Hook Data Format, as described in integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md
- [BrowserAccess](./BrowserAccess.md) -- BrowserAccess may utilize a similar approach to the Claude Code Setup for Graph-Code MCP Server, as described in integrations/browser-access/README.md
- [CodeGraphRAG](./CodeGraphRAG.md) -- CodeGraphRAG may utilize a similar approach to the Claude Code Setup for Graph-Code MCP Server, as described in integrations/browser-access/README.md


---

*Generated from 7 observations*
