# CodeGraphRagIntegration

**Type:** Detail

The integrations/code-graph-rag/docs/claude-code-setup.md file provides setup instructions for Claude Code with the Graph-Code MCP Server, indicating a connection between the Code Graph RAG system and the OnlineLearning sub-component.

## What It Is  

The **CodeGraphRagIntegration** lives inside the `integrations/code‑graph‑rag/` directory of the repository. Its purpose is to expose the *Graph‑Code Retrieval‑Augmented Generation (RAG)* system so that other components—most notably the **OnlineLearning** sub‑system—can query a knowledge graph that is automatically built from source‑code artefacts. The primary documentation for the integration is found in two markdown files:

* `integrations/code-graph-rag/README.md` – an overview of the Graph‑Code RAG system, describing how it extracts *knowledge entities* (e.g., classes, functions, modules) and the *relationships* among them from a codebase.  
* `integrations/code-graph-rag/docs/claude-code-setup.md` – step‑by‑step instructions for wiring Claude Code (the LLM‑backed coding assistant) to the **Graph‑Code MCP Server**, which is the runtime service that serves the knowledge graph.

The integration is also referenced in the broader system through two environment variables that appear in the documentation:

* `CODE_GRAPH_RAG_PORT` – the HTTP port on which the Graph‑Code RAG service listens for standard request/response interactions.  
* `CODE_GRAPH_RAG_SSE_PORT` – the port dedicated to Server‑Sent Events (SSE), enabling real‑time streaming of updates (e.g., incremental extraction results) to consumers such as OnlineLearning.

Together, these pieces make **CodeGraphRagIntegration** the bridge that lets OnlineLearning consume a continuously refreshed, graph‑structured view of the codebase, and optionally push that view into Claude Code for context‑aware assistance.

---

## Architecture and Design  

From the observations we can infer a **service‑oriented** architecture where the Graph‑Code RAG functionality is packaged as an independent server process (the *Graph‑Code MCP Server*). The server exposes two network endpoints:

1. **REST‑style API** on `CODE_GRAPH_RAG_PORT` for synchronous queries (e.g., “find all functions that call X”).  
2. **SSE stream** on `CODE_GRAPH_RAG_SSE_PORT` for asynchronous, push‑based notifications (e.g., “new entity extracted”).

This dual‑port design follows a **separation‑of‑concerns** pattern: request‑response traffic is kept distinct from streaming traffic, allowing each to be tuned independently for latency, throughput, and security. The integration is *hosted* within the **OnlineLearning** component, as indicated by the relationship “OnlineLearning contains CodeGraphRagIntegration”. Consequently, OnlineLearning likely acts as a **client** of the Graph‑Code RAG service, consuming its APIs to enrich learning experiences (e.g., generating quizzes from code relationships) and to feed data into Claude Code.

The documentation also mentions the *Graph‑Code MCP Server*—the “MCP” (Microservice Control Plane) terminology hints at a **microservice** that manages lifecycle events (start/stop, health‑checks) for the graph extraction pipeline, although the term appears only in the setup guide and is not elaborated elsewhere. No explicit design patterns such as *repository* or *factory* are referenced in the source observations, so we refrain from asserting their presence.

---

## Implementation Details  

The only concrete implementation artefacts we have are the two markdown files. They describe the **setup workflow** rather than code. The `claude-code-setup.md` guide walks a developer through:

1. **Starting the Graph‑Code MCP Server** – typically via a Docker container or a binary that reads the `CODE_GRAPH_RAG_PORT` and `CODE_GRAPH_RAG_SSE_PORT` environment variables.  
2. **Configuring Claude Code** – by pointing the Claude client to the MCP Server’s HTTP endpoint, enabling the LLM to query the graph for context while answering coding questions.  
3. **Connecting to OnlineLearning** – the guide mentions the *OnlineLearning sub‑component* as a consumer of the same server, implying that OnlineLearning reads the same configuration variables and establishes HTTP/SSE connections.

Because no source files (e.g., Java, Python, Go) are listed under “Code symbols found”, we cannot name concrete classes, functions, or modules. The implementation therefore appears to be **configuration‑driven**, with the heavy lifting performed by the external Graph‑Code MCP Server binary rather than by in‑repo source code. The integration’s responsibilities are limited to:

* Providing **documentation** that explains how to launch and wire the external service.  
* Declaring **environment variables** (`CODE_GRAPH_RAG_PORT`, `CODE_GRAPH_RAG_SSE_PORT`) that act as the contract between OnlineLearning, Claude Code, and the Graph‑Code RAG service.

---

## Integration Points  

1. **OnlineLearning ↔ CodeGraphRagIntegration** – OnlineLearning reads the two port variables and opens a REST client (for query) and an SSE client (for streaming updates). The parent‑child relationship (“OnlineLearning contains CodeGraphRagIntegration”) suggests that OnlineLearning may own the lifecycle of the RAG service (e.g., start it as a subprocess or Docker container).  

2. **Claude Code ↔ Graph‑Code MCP Server** – The `claude-code-setup.md` file explicitly instructs users to configure Claude Code to talk to the MCP Server. This connection is likely a **client‑server** interaction where Claude Code sends prompts that include references to code entities, and the MCP Server returns graph‑based context.  

3. **Ports & URLs** – The two environment variables provide the *interface contract*: any component that wishes to consume the knowledge graph must respect the designated ports. This makes the integration **plug‑and‑play**: swapping out the underlying graph engine or moving the service to a different host only requires updating the environment variables.

No other internal libraries, SDKs, or message queues are mentioned, so the integration appears to rely solely on HTTP/SSE for inter‑process communication.

---

## Usage Guidelines  

* **Configure Ports Early** – Before launching any consumer (OnlineLearning or Claude Code), ensure that `CODE_GRAPH_RAG_PORT` and `CODE_GRAPH_RAG_SSE_PORT` are set to free, reachable ports. Consistency across all consumers avoids connection failures.  

* **Start the MCP Server First** – The Graph‑Code MCP Server must be running before any client attempts to connect. Follow the step‑by‑step instructions in `integrations/code-graph-rag/docs/claude-code-setup.md` to launch the server, preferably in a containerized environment to isolate dependencies.  

* **Prefer SSE for Real‑Time Updates** – When you need to react to newly extracted entities (e.g., to refresh a learning module), subscribe to the SSE endpoint on `CODE_GRAPH_RAG_SSE_PORT`. The stream delivers incremental events, reducing the need for polling the REST API.  

* **Scope Queries Appropriately** – The REST API on `CODE_GRAPH_RAG_PORT` is intended for targeted look‑ups. Craft queries that are as specific as possible (e.g., by module name or entity type) to keep response latency low, especially when the underlying graph grows large.  

* **Document Environment in Deployment Manifests** – Because the integration’s contract is expressed through environment variables, any CI/CD pipeline or Kubernetes manifest that deploys OnlineLearning should explicitly declare `CODE_GRAPH_RAG_PORT` and `CODE_GRAPH_RAG_SSE_PORT`. This makes the dependency visible to operations teams and eases troubleshooting.

---

### Architectural Patterns Identified  

* **Service‑Oriented Architecture (SOA)** – The Graph‑Code RAG functionality is exposed as an independent service accessed via HTTP and SSE.  
* **Separation of Concerns via Dual Ports** – Distinct ports for request/response and streaming traffic.  

### Design Decisions & Trade‑offs  

* **Externalized Graph Engine** – By delegating graph extraction and storage to the MCP Server, the repository avoids embedding heavyweight graph libraries, simplifying maintenance but introducing a runtime dependency.  
* **Environment‑Variable Configuration** – Offers flexibility for deployment but requires careful coordination across components to avoid mismatched ports.  
* **SSE for Incremental Updates** – Provides low‑latency push semantics without the complexity of full‑duplex websockets, yet SSE is unidirectional and may not suit bidirectional interaction patterns.  

### System Structure Insights  

* **Parent‑Child Relationship** – `OnlineLearning` is the logical parent that orchestrates the RAG service; it likely contains orchestration scripts or Docker compose files (not observed) that start the MCP Server.  
* **Sibling Interactions** – While no siblings are explicitly listed, any other integration that consumes the same knowledge graph would share the same port contracts, promoting reuse.  

### Scalability Considerations  

* **Horizontal Scaling via Port Replication** – Because the service is accessed via network ports, multiple instances of the MCP Server could be run behind a load balancer, provided the environment variables point to a virtual address rather than a fixed port.  
* **Streaming Load** – The SSE endpoint must handle potentially high event rates when large codebases are being processed; capacity planning for the `CODE_GRAPH_RAG_SSE_PORT` listener is advisable.  

### Maintainability Assessment  

* **Documentation‑Centric Integration** – The bulk of the integration lives in markdown guides; this makes onboarding straightforward but places the burden of correctness on documentation upkeep.  
* **Loose Coupling** – By interacting only through HTTP/SSE and environment variables, the integration remains loosely coupled, easing future refactors or replacement of the underlying graph engine.  
* **Limited In‑Repo Code** – Absence of internal source symbols suggests low code‑maintenance overhead within this repository, but also means that bug‑fixes to the graph service must be applied upstream (in the MCP Server) rather than locally.  

---  

*All statements above are directly grounded in the observed files (`README.md`, `claude-code-setup.md`) and the documented environment variables (`CODE_GRAPH_RAG_PORT`, `CODE_GRAPH_RAG_SSE_PORT`). No additional patterns or code artefacts have been inferred beyond what the source material provides.*


## Hierarchy Context

### Parent
- [OnlineLearning](./OnlineLearning.md) -- OnlineLearning likely employs the GraphDatabaseManager to store and manage automatically extracted knowledge entities and relationships.


---

*Generated from 3 observations*
