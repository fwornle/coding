# BrowserAccess

**Type:** SubComponent

BrowserAccess pre-populates ontology metadata fields in integrations/copi/docs/STATUS-LINE-QUICK-REFERENCE.md to prevent redundant LLM re-classification

## What It Is  

BrowserAccess is the **sub‑component that enables a live browser‑based interface to the KnowledgeManagement graph**.  All of its operational logic is described in the markdown files under the `integrations/browser-access/` directory, most notably `integrations/browser-access/README.md`.  The README documents the **Browser Access MCP (Message‑Control‑Protocol) server** that mediates requests from a user’s browser to the underlying knowledge graph and downstream services.  BrowserAccess also owns two concrete children – **MCPBrowserAccess** (the server implementation) and **BrowserAccessConfig** (the configuration surface that ties the server to Claude Code and other LLM back‑ends).  

Within the broader KnowledgeManagement ecosystem, BrowserAccess lives alongside ManualLearning, OnlineLearning, CodeGraphConstruction, EntityPersistence, and UKBTraceReporting.  Those siblings share common integration conventions (e.g., the COPI logging framework) but each focuses on a distinct workflow.  BrowserAccess draws on the same **browser‑access mechanism** that appears in `integrations/code-graph-rag/README.md`, showing a reuse of the low‑level browser‑to‑service plumbing across the platform.

---

## Architecture and Design  

The design of BrowserAccess is **document‑driven and composition‑oriented**.  Rather than a monolithic code base, the component’s behavior is assembled from a set of integration READMEs that act as both specification and configuration artifacts.  The primary architectural motifs that emerge from the observations are:

1. **Work‑Stealing Concurrency** – The component inherits the platform‑wide work‑stealing model described in `integrations/copi/scripts/README.md`.  A shared `nextIndex` counter is used by multiple workers to dynamically balance the processing of incoming browser requests, ensuring that idle workers can “steal” work from busy peers.  This pattern reduces contention and improves throughput under bursty traffic.

2. **DAG‑Based Execution with Topological Sort** – BrowserAccess leverages the **directed‑acyclic‑graph (DAG) execution engine** outlined in `integrations/mcp-constraint-monitor/docs/constraint-configuration.md`.  Before a request is serviced, the system builds a DAG of dependent operations (e.g., constraint checks, ontology look‑ups, LLM calls) and orders them via a topological sort.  This guarantees that prerequisite data is available before downstream steps execute, while still allowing maximal parallelism where branches are independent.

3. **Semantic Constraint Detection** – The DAG nodes include **semantic constraint detectors** defined in `integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md`.  These detectors enforce domain‑specific rules (e.g., type consistency, relationship cardinality) on the graph updates that originate from browser actions.  By embedding constraint logic directly into the execution graph, the component can abort or rewrite operations early, preserving graph integrity.

4. **Metadata Pre‑Population** – To avoid costly re‑classification by large language models, BrowserAccess **pre‑populates ontology metadata fields** as described in `integrations/copi/docs/STATUS-LINE-QUICK-REFERENCE.md`.  When a browser request creates or modifies an entity, the necessary metadata (status line, tags, provenance) is filled in from cached values, sidestepping an extra LLM inference round.

5. **Shared Browser‑Access Mechanism** – Both BrowserAccess and the code‑graph‑RAG pipelines (`integrations/code-graph-rag/README.md`) rely on a common low‑level browser‑access library.  This library abstracts HTTP/WebSocket handling, session management, and authentication, providing a unified entry point for all browser‑driven services.

Collectively, these patterns produce a **pipeline‑oriented architecture** where a request flows from the browser, through a concurrent work‑stealing dispatcher, into a DAG of constraint‑aware operations, and finally back to the client with enriched, pre‑validated graph updates.

---

## Implementation Details  

### Core Files  
* **`integrations/browser-access/README.md`** – Serves as the canonical specification for the MCP server, detailing startup flags, environment variables, and the mapping of HTTP endpoints to internal handlers.  It also references the **MCPBrowserAccess** implementation and the **BrowserAccessConfig** schema.  
* **`integrations/copi/scripts/README.md`** – Defines the shared `nextIndex` counter and the work‑stealing loop that BrowserAccess adopts.  Workers poll this counter, claim a batch of request IDs, and process them in parallel.  
* **`integrations/copi/docs/STATUS-LINE-QUICK-REFERENCE.md`** – Lists the ontology metadata fields (e.g., `status_line`, `source`, `confidence`) that BrowserAccess injects before any LLM classification step.  The file doubles as a quick‑reference for developers to understand which fields are auto‑filled.  
* **`integrations/mcp-constraint-monitor/docs/constraint-configuration.md`** – Provides the DSL for describing the DAG nodes, their dependencies, and the topological sorting algorithm used at runtime.  BrowserAccess reads this configuration at startup to build its execution graph for each request type.  
* **`integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md`** – Enumerates the concrete semantic constraints (e.g., “no circular parent‑child links”, “entity type must match predicate domain”) and the detection functions that are invoked as DAG nodes.  

### Execution Flow  
1. **Request Arrival** – A browser issues a REST or WebSocket call to the MCP server defined in `integrations/browser-access/README.md`.  
2. **Work‑Stealing Dispatch** – The server hands the request ID to the shared `nextIndex` counter.  A pool of worker coroutines reads the counter, claims the next batch, and begins processing.  
3. **DAG Construction** – Using the constraint configuration (`constraint-configuration.md`), the worker builds a per‑request DAG.  Nodes include *metadata pre‑population*, *semantic constraint checks*, and *LLM inference* (if needed).  
4. **Topological Sort & Execution** – The DAG is topologically sorted so that independent branches can run concurrently.  The sorted order respects all dependency edges, guaranteeing that, for example, metadata is present before constraints are evaluated.  
5. **Constraint Evaluation** – Each constraint node calls the detection logic from `semantic-constraint-detection.md`.  Violations trigger early termination or corrective actions, preventing invalid graph mutations.  
6. **Graph Update & Response** – After successful traversal, the worker writes the changes to the KnowledgeManagement graph (the parent component) and streams a response back to the browser, including any enriched metadata.  

### Child Components  
* **MCPBrowserAccess** – Implements the actual network server (HTTP/WebSocket listeners, routing table) as described in the BrowserAccess README.  It exposes the configuration surface defined by **BrowserAccessConfig**.  
* **BrowserAccessConfig** – A lightweight configuration file (YAML/JSON) that specifies the LLM endpoint (Claude Code), authentication tokens, and optional feature toggles (e.g., enable/disable constraint monitoring).  The config is read at server start‑up and injected into the DAG builder.

---

## Integration Points  

BrowserAccess sits at the intersection of several system layers:

* **Parent – KnowledgeManagement** – All successful graph mutations flow into the KnowledgeManagement component’s Graphology + LevelDB store.  BrowserAccess therefore respects the parent’s concurrency model (work‑stealing) and routing logic for read/write paths.  

* **Siblings** –  
  * **ManualLearning**, **OnlineLearning**, **CodeGraphConstruction**, **EntityPersistence**, and **UKBTraceReporting** all share the **COPI** logging and tmux orchestration framework (see `integrations/copi/README.md`).  BrowserAccess inherits the same logging conventions, ensuring a uniform observability footprint across the platform.  
  * **OnlineLearning** and **CodeGraphConstruction** also use the **browser‑access mechanism** from `integrations/code-graph-rag/README.md`.  This common library means that any improvement to session handling, authentication, or request throttling benefits all three components simultaneously.  

* **Constraint Monitor** – The DAG and semantic‑constraint modules (`integrations/mcp-constraint-monitor/...`) are a shared service used by BrowserAccess and other graph‑mutating components.  By centralizing constraint definitions, the system guarantees consistent validation rules regardless of the entry point (browser, batch job, or API).  

* **LLM Provider** – BrowserAccessConfig points to Claude Code as the default LLM.  The configuration is deliberately aligned with the parent’s lazy‑initialization strategy for LLM providers, meaning the LLM client is instantiated only when a DAG node explicitly requires inference.  

* **External Browser** – The MCP server exposes endpoints that browsers consume directly (e.g., via a UI extension).  The contract is defined in the BrowserAccess README and mirrors the contract used by the code‑graph‑RAG UI, enabling developers to reuse front‑end components.

---

## Usage Guidelines  

1. **Configure via BrowserAccessConfig** – Always define the LLM endpoint, authentication tokens, and constraint‑monitor toggle in the `BrowserAccessConfig` file before starting the MCP server.  Missing or malformed entries will cause the server to abort during start‑up, as the README explicitly warns.  

2. **Leverage Work‑Stealing Correctly** – When extending BrowserAccess with new request types, register the new handler with the shared `nextIndex` dispatcher.  Do **not** create a separate thread pool; doing so would defeat the platform‑wide load‑balancing guarantees and could lead to thread starvation.  

3. **Extend the DAG Conservatively** – New processing steps (e.g., additional validation or enrichment) must be added as DAG nodes in `constraint-configuration.md`.  Declare explicit dependencies so the topological sort can order them correctly.  Avoid circular dependencies; the DAG must remain acyclic, otherwise the sort will fail and the request will be rejected.  

4. **Respect Metadata Pre‑Population** – When adding custom ontology fields, update `STATUS-LINE-QUICK-REFERENCE.md` so that BrowserAccess knows which values to pre‑populate.  Failure to do so will trigger unnecessary LLM re‑classification, increasing latency and cost.  

5. **Monitor Through COPI Logging** – All BrowserAccess activities emit logs in the format defined by the COPI framework.  Integrate these logs with the existing tmux‑based monitoring dashboards used by the sibling components.  Consistent log tagging (e.g., `component=BrowserAccess`) enables cross‑component traceability.  

6. **Test Constraint Changes in Isolation** – Because semantic constraints are shared across the system, any modification to `semantic-constraint-detection.md` should be validated with unit tests that simulate both BrowserAccess and other graph‑mutating workflows.  This prevents inadvertent regression in unrelated components.  

---

### Summary of Insights  

| Item | Insight |
|------|---------|
| **Architectural patterns identified** | Work‑stealing concurrency (shared `nextIndex`), DAG‑based execution with topological sort, semantic constraint detection embedded in the DAG, metadata pre‑population to avoid redundant LLM calls, shared browser‑access library. |
| **Design decisions and trade‑offs** | Choosing a document‑driven specification (README files) keeps configuration close to the source but limits discoverability via code navigation; work‑stealing maximizes CPU utilization at the cost of added synchronization complexity; DAG execution provides deterministic ordering but requires careful maintenance of acyclicity. |
| **System structure insights** | BrowserAccess is a thin MCP server that orchestrates existing platform services (constraint monitor, COPI logging, LLM provider) rather than implementing its own graph logic; it sits under KnowledgeManagement and shares many cross‑cutting concerns with its siblings. |
| **Scalability considerations** | Work‑stealing allows the component to scale horizontally across many worker threads; the DAG model enables parallel execution of independent branches, further improving throughput under high request volume.  However, the shared `nextIndex` counter can become a contention point if not implemented with lock‑free primitives. |
| **Maintainability assessment** | High maintainability due to centralized configuration (README‑driven) and reuse of shared libraries (browser‑access, COPI, constraint monitor).  The main risk is drift between documentation and actual behavior; keeping the markdown specifications in sync with any code changes is essential. |

These observations collectively portray **BrowserAccess** as a well‑orchestrated gateway that reuses platform‑wide concurrency and validation mechanisms to safely expose the KnowledgeManagement graph to end‑users via a browser interface.

## Diagrams

### Relationship

![BrowserAccess Relationship](images/browser-access-relationship.png)



## Architecture Diagrams

![relationship](../../.data/knowledge-graph/insights/images/browser-access-relationship.png)


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component is responsible for managing the knowledge graph, which includes storing, querying, and updating entities and relationships. It utilizes a Graphology+LevelDB database for persistence and provides a JSON export sync feature. The component's architecture is designed to handle concurrent access and provides an intelligent routing mechanism for storing and retrieving data. Key patterns include the use of adapters for database interactions, lazy initialization of LLM (Large Language Model) providers, and work-stealing concurrency for efficient data processing.

### Children
- [MCPBrowserAccess](./MCPBrowserAccess.md) -- The BrowserAccess MCP server is described in integrations/browser-access/README.md, which provides information on how to set up and use the server.
- [BrowserAccessConfig](./BrowserAccessConfig.md) -- The integrations/browser-access/README.md file mentions the Browser Access MCP Server for Claude Code, indicating a key configuration point for browser access.

### Siblings
- [ManualLearning](./ManualLearning.md) -- ManualLearning uses integrations/copi/README.md to handle logging and tmux integration for manual learning processes
- [OnlineLearning](./OnlineLearning.md) -- OnlineLearning uses integrations/code-graph-rag/README.md to construct and query the code knowledge graph
- [CodeGraphConstruction](./CodeGraphConstruction.md) -- CodeGraphConstruction uses integrations/code-graph-rag/README.md to construct and query the code knowledge graph
- [EntityPersistence](./EntityPersistence.md) -- EntityPersistence uses integrations/copi/README.md to handle logging and tmux integration for entity persistence
- [UKBTraceReporting](./UKBTraceReporting.md) -- UKBTraceReporting uses integrations/copi/README.md to handle logging and tmux integration for trace reporting


---

*Generated from 7 observations*
