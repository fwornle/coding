# CodeGraphRAGService

**Type:** SubComponent

The CodeGraphRAGService likely uses the ANTHROPIC_API_KEY and BROWSERBASE_API_KEY environment variables to configure the services and ensure secure communication.

## What It Is  

The **CodeGraphRAGService** is a sub‑component that implements a graph‑based Retrieval‑Augmented Generation (RAG) engine for arbitrary codebases. Its source lives under the `integrations/code-graph-rag/` directory, with the primary user‑facing documentation in `integrations/code-graph-rag/README.md` and the detailed Claude‑specific setup instructions in `integrations/code-graph-rag/docs/claude-code-setup.md`. Inside the service a concrete server implementation—named **RAGServer**—exposes the RAG functionality over HTTP (and Server‑Sent Events) using ports that are supplied at runtime via the `CODE_GRAPH_RAG_PORT` and `CODE_GRAPH_RAG_SSE_PORT` environment variables. The service is packaged as a Docker container and is a child of the higher‑level **DockerizedServices** component, which orchestrates it alongside sibling services such as **ServiceOrchestrator** and **ConstraintMonitoringService**.

## Architecture and Design  

The architecture follows a **container‑per‑service modular pattern** that is explicitly described for the parent `DockerizedServices` component. Each service, including CodeGraphRAGService, runs in its own Docker container defined in the shared `docker‑compose.yaml`. This isolation enables independent scaling, versioning, and deployment. Configuration is driven entirely by environment variables, a design decision that keeps the container image immutable while allowing flexible deployment‑time tuning.  

The service itself is split into two logical layers: a **server layer** (the `RAGServer` child) that handles HTTP/SSE endpoints, and a **graph‑processing layer** that interacts with an external Memgraph database. The `MEMGRAPH_BATCH_SIZE` variable controls how many graph nodes/edges are processed in a single transaction, indicating a batch‑oriented data‑flow design that reduces round‑trip latency.  

Communication with external AI providers is mediated through API keys (`ANTHROPIC_API_KEY`) and a browser automation service (`BROWSERBASE_API_KEY`). The presence of `BROWSER_ACCESS_PORT` and `BROWSER_ACCESS_SSE_URL` suggests that the service can launch a headless browser instance (via BrowserBase) and stream results back to callers, employing SSE for low‑latency updates. The `CONTAINS_PACKAGE` variable is used to limit the scope of the graph to a specific package, reinforcing a **configuration‑by‑environment** approach rather than hard‑coded filters.

## Implementation Details  

* **Port Configuration** – `CODE_GRAPH_RAG_PORT` and `CODE_GRAPH_RAG_SSE_PORT` are read at startup (likely in the `RAGServer` initialization code) to bind the HTTP API and the SSE stream respectively. This enables the same container image to serve both synchronous and asynchronous client needs without code changes.  

* **Memgraph Integration** – The service connects to a Memgraph instance, using the `MEMGRAPH_BATCH_SIZE` env var to set the size of each bulk operation. Internally, a batch writer aggregates graph updates (nodes representing code entities, edges representing relationships) before flushing them to Memgraph, which improves throughput and reduces transaction overhead.  

* **LLM and Browser Access** – `ANTHROPIC_API_KEY` authenticates calls to Anthropic’s Claude model, while `BROWSERBASE_API_KEY` authorizes the launch of a BrowserBase session. The `BROWSER_ACCESS_PORT` and `BROWSER_ACCESS_SSE_URL` are used to route browser‑driven queries (e.g., web‑search or dynamic code inspection) back to the RAG pipeline, with results streamed via SSE to the client.  

* **Package Containment** – `CONTAINS_PACKAGE` is consulted by the graph‑construction logic to filter which parts of the codebase are ingested into Memgraph. This keeps the graph size manageable and aligns with the “any codebase” promise by allowing selective indexing.  

* **Documentation** – The `README.md` provides a quick‑start guide (container build, required env vars), while `docs/claude-code-setup.md` outlines the specific steps for configuring Claude as the underlying LLM, including any prompt engineering or model‑parameter tuning required for code‑centric retrieval.

## Integration Points  

CodeGraphRAGService sits within the broader **DockerizedServices** ecosystem. Its container is defined alongside **ServiceOrchestrator** and **ConstraintMonitoringService**, meaning it can be orchestrated, restarted, or scaled using the same `docker‑compose.yaml` file. The **RAGServer** child exposes REST endpoints that other services (e.g., a UI dashboard or an API gateway) can call to retrieve code‑related answers.  

The service depends on three external systems:  

1. **Memgraph** – a graph database that stores the code graph. The batch size tuning (`MEMGRAPH_BATCH_SIZE`) directly influences the load placed on this component.  
2. **Anthropic Claude** – the LLM that generates natural‑language responses based on retrieved graph context, authenticated via `ANTHROPIC_API_KEY`.  
3. **BrowserBase** – a headless‑browser service that can fetch live web content or execute JavaScript, accessed through `BROWSERBASE_API_KEY`, `BROWSER_ACCESS_PORT`, and `BROWSER_ACCESS_SSE_URL`.  

All of these dependencies are injected via environment variables, keeping the service loosely coupled and allowing developers to swap implementations (e.g., a different graph DB) by changing the runtime configuration rather than the code.

## Usage Guidelines  

1. **Environment‑First Configuration** – Always supply the required variables (`CODE_GRAPH_RAG_PORT`, `CODE_GRAPH_RAG_SSE_PORT`, `ANTHROPIC_API_KEY`, `BROWSERBASE_API_KEY`, etc.) through the Docker Compose file or the container runtime. Missing variables will cause the service to abort during startup.  

2. **Batch Size Tuning** – Adjust `MEMGRAPH_BATCH_SIZE` based on the size of the target codebase and the performance characteristics of the Memgraph instance. Larger batches improve throughput but increase memory pressure; start with the default and monitor container memory usage.  

3. **Package Scoping** – When working with large monorepos, set `CONTAINS_PACKAGE` to the specific package you wish to index. This reduces graph size and speeds up both ingestion and query time.  

4. **SSE Consumption** – Clients that need real‑time updates (e.g., IDE plugins) should connect to the SSE endpoint using the URL derived from `CODE_GRAPH_RAG_SSE_PORT` and `BROWSER_ACCESS_SSE_URL`. Ensure the client correctly handles reconnection logic, as network interruptions are common with long‑running streams.  

5. **Security** – Keep API keys (`ANTHROPIC_API_KEY`, `BROWSERBASE_API_KEY`) out of version control. Use Docker secrets or a secrets manager to inject them at container start‑up.  

6. **Documentation Reference** – Consult `integrations/code-graph-rag/README.md` for container build and run instructions, and `integrations/code-graph-rag/docs/claude-code-setup.md` for LLM‑specific configuration details before deployment.

---

### Architectural Patterns Identified
* **Container‑Per‑Service (modular Docker architecture)**
* **Configuration‑by‑Environment (extensive use of env vars)**
* **Batch Processing (Memgraph batch writes)**
* **Server‑Sent Events for streaming results**

### Design Decisions and Trade‑offs
* **Env‑var driven configurability** provides deployment flexibility but requires careful secret management.  
* **Separate HTTP and SSE ports** allow clients to choose between request‑response and streaming models, at the cost of exposing two network surfaces.  
* **Batch size tunability** balances ingestion speed against memory usage.  
* **Using Memgraph** gives native graph traversal performance but introduces a dependency on a specialized database.

### System Structure Insights
* **DockerizedServices** orchestrates the service as a container alongside peers.  
* **CodeGraphRAGService** encapsulates the RAG logic, exposing it via **RAGServer**.  
* **RAGServer** handles inbound API calls, delegates to the graph layer, invokes Claude, and streams browser results when needed.

### Scalability Considerations
* Horizontal scaling is straightforward: spin up additional containers behind a load balancer, each with its own `CODE_GRAPH_RAG_PORT` (or use a port‑mapping strategy).  
* Memgraph’s scaling limits become the bottleneck; consider clustering Memgraph if the graph grows beyond a single node’s capacity.  
* SSE streams are lightweight but require the client to maintain open connections; monitor connection counts and tune OS limits accordingly.

### Maintainability Assessment
* **High** – Clear separation of concerns (server vs. graph vs. LLM), all runtime knobs exposed as env vars, and comprehensive markdown documentation reduce the learning curve for new developers.  
* **Potential Risk** – Reliance on multiple external services (Anthropic, BrowserBase, Memgraph) means version compatibility must be tracked; automated integration tests that mock these services would mitigate regression risk.  

Overall, the CodeGraphRAGService presents a well‑encapsulated, configurable, and container‑friendly implementation of a graph‑based RAG system, ready to be orchestrated alongside its sibling services within the DockerizedServices ecosystem.

## Diagrams

### Relationship

## Architecture Diagrams

## Hierarchy Context

### Parent
- [DockerizedServices](./DockerizedServices.md) -- [LLM] The DockerizedServices component employs a modular architecture, with each service running in its own container. This is evident in the docker-compose.yaml file, where separate services such as the constraint monitoring API server and the dashboard server are defined. The use of Docker Compose for container orchestration allows for efficient resource utilization and easy maintenance. For instance, the constraint monitoring API server is defined in the scripts/api-service.js file, which utilizes environment variables and configuration files for customizable settings.

### Children
- [RAGServer](./RAGServer.md) -- The CodeGraphRAGService sub-component uses the CODE_GRAPH_RAG_PORT environment variable to configure the ports for the Code Graph RAG service, indicating a server component is present.

### Siblings
- [ServiceOrchestrator](./ServiceOrchestrator.md) -- The ServiceOrchestrator likely utilizes the docker-compose.yaml file to define and manage the services, as seen in the use of environment variables and configuration files for customizable settings.
- [ConstraintMonitoringService](./ConstraintMonitoringService.md) -- The ConstraintMonitoringService uses the integrations/mcp-constraint-monitor/docs/constraint-configuration.md file to configure the constraints and their dependencies.

---

*Generated from 7 observations*
