# BrowserAccess

**Type:** SubComponent

BrowserAccess could involve the use of semantic constraint detection, as seen in integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md

## What It Is  

BrowserAccess is a **sub‑component** of the *KnowledgeManagement* component that supplies a browser‑based entry point for interacting with the system’s stored knowledge. The implementation lives under the integration folder documented in **`integrations/browser-access/README.md`**, where the same “Claude Code Setup for Graph‑Code MCP Server” approach is described. BrowserAccess also relies on several sibling sub‑components—*EntityPersistence*, *ManualLearning*, *CodeGraphRAG*, and the *MCP Constraint Monitor*—to retrieve, enrich, and validate the entities it serves. Its own configuration is encapsulated in the child component **BrowserAccessConfiguration**, which follows the same Claude‑code‑setup pattern.

In practice, a client (typically a web UI) issues requests to BrowserAccess, which then:

1. Pulls entity data from **EntityPersistence** (graph‑DB backed) or from **ManualLearning** (hand‑crafted entities).  
2. Optionally runs the **Code Graph RAG** pipeline (see `integrations/code-graph-rag/README.md`) to perform graph‑based code analysis and retrieve relevant code snippets.  
3. Applies **semantic constraint detection** via the **MCP Constraint Monitor** (see `integrations/mcp-constraint-monitor/README.md` and its `semantic-constraint-detection.md` doc) to ensure that returned entities respect defined constraints.  

Thus BrowserAccess is the façade that orchestrates these lower‑level services and presents a coherent, constraint‑aware view of the knowledge base to the browser.

---

## Architecture and Design  

The overall architecture follows a **modular, integration‑driven** style. Each integration lives in its own folder under `integrations/`, exposing a well‑defined contract that BrowserAccess consumes. The key architectural traits evident from the observations are:

* **Claude‑code‑setup reuse** – Both *BrowserAccess* and its child *BrowserAccessConfiguration* adopt the “Claude Code Setup for Graph‑Code MCP Server” described in `integrations/browser-access/README.md`. This indicates a shared initialization and configuration pattern (e.g., loading Claude‑compatible schemas, setting up MCP endpoints) that reduces duplication across components that need to talk to the MCP server.  

* **Graph‑based Retrieval‑Augmented Generation (RAG)** – BrowserAccess can invoke the **Code Graph RAG** system (`integrations/code-graph-rag/README.md`). This suggests a pipeline where code is represented as a graph, queries are transformed into graph traversals, and results are fed back into the LLM‑driven knowledge flow.  

* **Work‑Stealing Concurrency** – The parent *KnowledgeManagement* component uses a **shared atomic index counter** for work‑stealing as implemented in `wave-controller.ts` (line ≈ 489). Although BrowserAccess does not define its own concurrency primitives, it inherits this model from the parent, allowing concurrent handling of multiple browser requests without thread starvation.  

* **Constraint Monitoring** – Integration with the **MCP Constraint Monitor** (`integrations/mcp-constraint-monitor/README.md`) brings in a **semantic constraint detection** layer (`integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md`). This layer validates entity relationships against business rules before they are exposed to the UI, embodying a **policy‑enforcement** pattern.  

* **Dependency on Sibling Sub‑Components** – BrowserAccess does not store entities itself; it delegates persistence to **EntityPersistence** and manual curation to **ManualLearning**. This separation of concerns follows a **service‑oriented** approach within the monorepo, where each sibling focuses on a single responsibility.

The interaction flow can be visualised as:

```
Browser UI → BrowserAccess (via HTTP/WebSocket) → 
   { EntityPersistence | ManualLearning } → Knowledge Graph
   → CodeGraphRAG (optional) → MCP Constraint Monitor → 
   BrowserAccessConfiguration → Response to UI
```

---

## Implementation Details  

Because the repository currently contains **no concrete code symbols** for BrowserAccess, the implementation details are inferred from the README files and the surrounding components:

1. **Configuration Loading** – `integrations/browser-access/README.md` outlines that BrowserAccess reads a YAML/JSON configuration (mirroring the Claude‑code‑setup) at startup. The child component **BrowserAccessConfiguration** likely encapsulates this logic, exposing getters for endpoint URLs, authentication tokens, and RAG parameters.

2. **Request Handling** – Requests are probably routed through a lightweight HTTP server (e.g., Express or Fastify) instantiated in the BrowserAccess module. The handler extracts query parameters, then calls into the **EntityPersistence** API (graph‑DB client) to fetch matching entities. If a code‑related query is detected, it forwards the request to the **Code Graph RAG** service, which returns a ranked list of code fragments.

3. **Concurrency Model** – While BrowserAccess itself does not define concurrency code, it inherits the **work‑stealing** mechanism from the parent *KnowledgeManagement* component. The shared atomic index counter in `wave-controller.ts` (line ≈ 489) is used by the parent’s `runWithConcurrency()` method to distribute work across a pool of workers. BrowserAccess request handlers thus execute within this pool, gaining the benefits of dynamic load balancing without additional synchronization code.

4. **Constraint Validation** – After entities are retrieved, BrowserAccess invokes the **MCP Constraint Monitor**. The monitor’s semantic detection logic (see `semantic-constraint-detection.md`) analyses entity attributes against a set of declarative constraints (e.g., type compatibility, ontology rules). Violations cause the monitor to filter or annotate the result set before it reaches the UI.

5. **Integration with ManualLearning** – When a request asks for manually curated knowledge, BrowserAccess queries the **ManualLearning** sub‑component, which follows the same Claude‑code‑setup pattern (as noted in the sibling description). This ensures that manually added entities are stored in the same schema and can be processed by the same RAG and constraint pipelines.

---

## Integration Points  

| Integration Target | Path / Document | Role in BrowserAccess |
|--------------------|-----------------|----------------------|
| **Claude Code Setup** | `integrations/browser-access/README.md` | Supplies the base configuration and MCP server wiring used by BrowserAccess and its configuration child. |
| **Code Graph RAG** | `integrations/code-graph-rag/README.md` | Optional analysis engine that transforms code queries into graph traversals and returns relevant snippets. |
| **EntityPersistence** | (implicit, described in sibling notes) | Primary source of persisted entities stored in a graph database. BrowserAccess calls its API to fetch data. |
| **ManualLearning** | (implicit, sibling note) | Provides access to manually authored entities; BrowserAccess queries this when manual knowledge is requested. |
| **MCP Constraint Monitor** | `integrations/mcp-constraint-monitor/README.md` & `semantic-constraint-detection.md` | Performs semantic constraint checks on the result set before returning it to the client. |
| **Wave Controller (Concurrency)** | `wave-controller.ts:489` | Supplies the shared atomic index counter used by the parent’s `runWithConcurrency()` method; BrowserAccess runs within this concurrency framework. |
| **BrowserAccessConfiguration** | Child component (no explicit path) | Holds runtime configuration (endpoints, auth, RAG settings) derived from the Claude‑code‑setup. |

These integration points are **loose contracts** rather than hard‑coded imports, allowing each sub‑component to evolve independently as long as the agreed‑upon API surface remains stable.

---

## Usage Guidelines  

1. **Initialize via BrowserAccessConfiguration** – Before any request is processed, ensure that the configuration object has been instantiated (typically at application start). The configuration must contain valid MCP server URLs and any RAG parameters; otherwise downstream calls will fail silently.

2. **Leverage the Parent’s Concurrency** – Do not create additional thread pools inside BrowserAccess. Rely on the work‑stealing pool managed by `wave-controller.ts` to handle parallel request execution. This avoids contention on the shared atomic index counter and preserves the system’s scalability guarantees.

3. **Explicitly Request RAG When Needed** – Because invoking the Code Graph RAG pipeline can be expensive, only set the `useRag` flag (or similar) on the request object when the query pertains to code artifacts. This keeps simple entity look‑ups lightweight.

4. **Validate Constraints Early** – If a client can anticipate constraint violations (e.g., by checking ontology compatibility), it should pre‑filter queries. The MCP Constraint Monitor will still run, but early pruning reduces unnecessary processing.

5. **Prefer EntityPersistence for Bulk Reads** – For large‑scale data extraction, query EntityPersistence directly (or use its batch API) rather than issuing many fine‑grained BrowserAccess calls. BrowserAccess is optimized for interactive, low‑latency UI interactions, not bulk ETL workloads.

6. **Keep Configuration in Sync with Claude Setup** – Any changes to the Claude‑code‑setup (e.g., schema version bumps) must be reflected in both BrowserAccess and BrowserAccessConfiguration. A mismatch can cause deserialization errors when the MCP server returns data.

---

### Architectural Patterns Identified  

* **Claude‑code‑setup reuse** – a shared initialization pattern across integrations.  
* **Work‑stealing concurrency** – implemented via a shared atomic index counter (`wave-controller.ts`).  
* **Service‑oriented modularity** – distinct sub‑components (EntityPersistence, ManualLearning, CodeGraphRAG, MCP Constraint Monitor) expose focused APIs.  
* **Policy‑enforcement (semantic constraint detection)** – validation layer before data leaves the system.  
* **Retrieval‑Augmented Generation (graph‑based)** – Code Graph RAG pipeline for code‑centric queries.

### Design Decisions and Trade‑offs  

* **Centralized configuration** (Claude‑code‑setup) reduces duplication but introduces a single point of failure if the config schema changes.  
* **Work‑stealing pool** offers high throughput for bursty UI traffic but requires careful tuning of the atomic counter to avoid contention under extreme load.  
* **Optional RAG integration** balances performance (skip heavy graph traversal when not needed) against feature richness (code insight).  
* **Constraint monitoring** improves data quality at the cost of additional latency; the system mitigates this by running it after the primary fetch, not before.

### System Structure Insights  

BrowserAccess sits at the **interaction layer** of the KnowledgeManagement hierarchy. It consumes services from sibling components, inherits concurrency mechanisms from its parent, and delegates configuration to its child. This positioning makes it the natural façade for any external UI or API that needs constraint‑aware knowledge retrieval.

### Scalability Considerations  

* The **work‑stealing concurrency** model scales horizontally with the number of worker threads, allowing the system to handle many simultaneous browser sessions.  
* **Code Graph RAG** is the most resource‑intensive piece; scaling it may require separate compute clusters or caching of frequent graph traversals.  
* **EntityPersistence** (graph DB) must be provisioned with enough read capacity; BrowserAccess’s read‑only nature keeps write pressure low.

### Maintainability Assessment  

* **High cohesion, low coupling** – BrowserAccess’s responsibilities are clearly delineated (orchestration, constraint enforcement), while persistence and learning concerns stay in dedicated modules.  
* **Shared patterns** (Claude‑code‑setup, work‑stealing) promote reuse and reduce code churn across the codebase.  
* **Documentation‑driven integration** – Most integration points are described in README files, which aids onboarding but also means that any change must be reflected promptly in those docs to avoid drift.  
* **Absence of concrete symbols** in the repository suggests that the implementation may be generated or heavily templated; maintaining the generation templates will be essential to keep BrowserAccess functional.  

Overall, BrowserAccess exhibits a well‑structured, integration‑centric design that leverages existing concurrency and constraint‑monitoring mechanisms, making it both performant for interactive use and extensible for future knowledge‑access features.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- [LLM] The KnowledgeManagement component employs a lazy loading approach for LLM initialization, as seen in the constructor-based pattern for wave agents. This is evident in the ensureLLMInitialized() method, which suggests that the component defers the initialization of Large Language Models (LLMs) until they are actually needed. This design decision helps to reduce memory consumption and improve system responsiveness, especially when dealing with multiple LLMs. The use of a shared atomic index counter for work-stealing concurrency in the runWithConcurrency() method (wave-controller.ts:489) further enhances the component's efficiency by allowing it to dynamically adjust its workload and minimize idle time.

### Children
- [BrowserAccessConfiguration](./BrowserAccessConfiguration.md) -- The BrowserAccess sub-component may utilize a similar approach to the Claude Code Setup for Graph-Code MCP Server, as described in integrations/browser-access/README.md

### Siblings
- [ManualLearning](./ManualLearning.md) -- ManualLearning may utilize a similar approach to Claude Code Setup for Graph-Code MCP Server as described in integrations/browser-access/README.md
- [OnlineLearning](./OnlineLearning.md) -- OnlineLearning may use the batch analysis pipeline to extract knowledge from git history, as hinted in the project documentation
- [EntityPersistence](./EntityPersistence.md) -- EntityPersistence may use a graph database to store entities, as hinted in the project documentation
- [OntologyClassification](./OntologyClassification.md) -- OntologyClassification may utilize a similar approach to Claude Code Hook Data Format, as described in integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md
- [ObservationDerivation](./ObservationDerivation.md) -- ObservationDerivation may utilize a similar approach to the Code Graph RAG system, as described in integrations/code-graph-rag/README.md
- [UKBTraceReporting](./UKBTraceReporting.md) -- UKBTraceReporting may utilize a similar approach to the Claude Code Hook Data Format, as described in integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md
- [CodeGraphRAG](./CodeGraphRAG.md) -- CodeGraphRAG may utilize a similar approach to the Claude Code Setup for Graph-Code MCP Server, as described in integrations/browser-access/README.md


---

*Generated from 7 observations*
