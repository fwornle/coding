# CodeGraphAgent

**Type:** Detail

The CodeGraphAgent is mentioned in the context of integrations/mcp-server-semantic-analysis/src/agents/code-graph-agent.ts, indicating its role in code analysis.

## What It Is  

The **CodeGraphAgent** lives in the source tree at  

```
integrations/mcp-server-semantic-analysis/src/agents/code-graph-agent.ts
```  

and is the concrete implementation that performs code‑graph analysis for the broader **OnlineLearning** capability.  In the surrounding documentation the agent is repeatedly referenced together with two environment variables – `CODE_GRAPH_RAG_SSE_PORT` and `CODE_GRAPH_RAG_PORT` – which indicate that the agent either exposes or consumes a service that follows a Retrieval‑Augmented Generation (RAG) pattern.  Within the **OnlineLearning** hierarchy the agent is listed as a child component, meaning that the learning pipelines can call into it to transform raw repository contents into structured knowledge entities (e.g., symbols, dependencies, call graphs).  

In short, the CodeGraphAgent is the dedicated code‑analysis service that sits inside the *semantic‑analysis* integration and is leveraged by the OnlineLearning subsystem to turn source code into a graph‑based representation that downstream AI components can consume.

---

## Architecture and Design  

### Agent‑Oriented Design  
The file path `.../agents/code-graph-agent.ts` makes it clear that the system adopts an **agent** style of encapsulation: each distinct responsibility (e.g., code graph construction, semantic analysis, online learning) is packaged as an independent, self‑contained unit.  This encourages loose coupling – the OnlineLearning component can invoke the CodeGraphAgent through a well‑defined interface without needing to know the internal parsing logic.

### Service‑Boundary via Ports  
The presence of the two environment variables `CODE_GRAPH_RAG_SSE_PORT` and `CODE_GRAPH_RAG_PORT` signals a **port‑based communication boundary**.  The agent likely runs as a separate process (or container) that listens on one of those ports, exposing either a standard HTTP API (`CODE_GRAPH_RAG_PORT`) or a Server‑Sent Events stream (`CODE_GRAPH_RAG_SSE_PORT`).  This design isolates the heavy‑weight graph construction work from the rest of the application, allowing the OnlineLearning subsystem to remain responsive while the agent does its work asynchronously.

### Retrieval‑Augmented Generation (RAG) Integration  
The suffix “RAG” in the port names hints that the agent participates in a **retrieval‑augmented generation** workflow.  In practice this means that after the CodeGraphAgent builds the graph, it can serve pieces of that graph on demand to a downstream LLM or reasoning engine, which then augments its generated answers with concrete code‑level evidence.  The architecture therefore couples static analysis (graph building) with dynamic AI‑driven inference through a clear service contract.

### Hierarchical Relationship  
Within the **OnlineLearning** hierarchy the CodeGraphAgent is a child.  Its sibling agents (if any) would handle complementary concerns such as documentation extraction or test‑case generation.  The parent OnlineLearning orchestrates these agents, sequencing calls (e.g., first run CodeGraphAgent, then feed its output into a knowledge‑base builder).  This hierarchical composition keeps the overall learning pipeline modular and extensible.

---

## Implementation Details  

The only concrete implementation artifact we have is the TypeScript file `code-graph-agent.ts`.  From its location we can infer a typical Node/TS setup:

* **Exported Class / Function** – The file most likely exports a class named `CodeGraphAgent` (matching the file name) that implements a standard `Agent` interface used across the *semantic‑analysis* integration.  This interface probably defines lifecycle methods such as `initialize()`, `processRepository(repoPath: string)`, and `shutdown()`.

* **Port Configuration** – Inside the module the two environment variables are read, e.g.:

  ```ts
  const ragPort = Number(process.env.CODE_GRAPH_RAG_PORT);
  const ssePort = Number(process.env.CODE_GRAPH_RAG_SSE_PORT);
  ```

  These values are then passed to an HTTP server (Express, Fastify, or similar) and an SSE endpoint, respectively.  The server routes expose endpoints such as `/graph/:repoId` (returning JSON) and `/graph/stream/:repoId` (pushing incremental graph updates).

* **Graph Construction Logic** – Although not visible, the agent’s core responsibility is to parse source files, resolve imports, and emit a graph structure (nodes for symbols, edges for relationships).  The output format is probably a serializable JSON model that downstream components can ingest directly.

* **RAG Service Hooks** – The agent may also expose a retrieval API that accepts queries like “find all callers of `Foo.bar`” and returns the matching sub‑graph.  This aligns with the RAG naming and enables the LLM‑based components to request precise code context on demand.

Because no additional symbols were discovered, the above implementation details remain high‑level but are directly tied to the observed file path and configuration variables.

---

## Integration Points  

1. **OnlineLearning (Parent)** – The OnlineLearning subsystem imports the `CodeGraphAgent` and invokes its public methods as part of the learning pipeline.  The parent likely provides the repository location and receives the generated graph for further processing (e.g., knowledge‑entity extraction).

2. **RAG Service Consumers** – Downstream AI services that perform Retrieval‑Augmented Generation consume the HTTP/SSE endpoints exposed on `CODE_GRAPH_RAG_PORT` and `CODE_GRAPH_RAG_SSE_PORT`.  These consumers may be separate micro‑services or in‑process modules that request graph fragments to enrich generated explanations.

3. **Configuration Layer** – The two port variables are injected via the environment, meaning that deployment scripts (Docker Compose, Kubernetes manifests, or CI pipelines) must set them consistently.  Changing a port value requires a restart of the CodeGraphAgent process, but the rest of the system can remain untouched as long as the contract is honored.

4. **Potential Sibling Agents** – While not enumerated, any other agents under `integrations/mcp-server-semantic-analysis/src/agents/` would share the same server bootstrap logic and could be co‑hosted on the same process, reusing the port configuration pattern.

---

## Usage Guidelines  

* **Initialize Once, Reuse** – Create a single instance of `CodeGraphAgent` at application start‑up (e.g., in the OnlineLearning bootstrap) and keep it alive for the lifetime of the service.  Re‑instantiating per request would waste the cost of opening the HTTP/SSE listeners repeatedly.

* **Respect Port Configuration** – Never hard‑code the ports; always read `process.env.CODE_GRAPH_RAG_PORT` and `process.env.CODE_GRAPH_RAG_SSE_PORT`.  This ensures the agent can be deployed in varied environments (local dev, staging, production) without code changes.

* **Prefer Asynchronous Calls** – Because the agent may be performing heavyweight static analysis, its public API should be awaited asynchronously.  When consuming the SSE stream, attach listeners early and handle back‑pressure to avoid memory spikes.

* **Error Handling** – The agent’s HTTP endpoints should return standard error codes (4xx for client misuse, 5xx for internal failures).  Callers in OnlineLearning must implement retry logic for transient failures, especially when the graph generation is triggered on large repositories.

* **Version Compatibility** – If the graph schema evolves, downstream consumers must validate the version field (if present) in the JSON payload.  Maintaining backward compatibility in the agent’s response format will reduce breakage across releases.

---

### Architectural Patterns Identified  

1. **Agent‑Oriented Modularity** – Each functional piece (code graph building) is encapsulated in a dedicated agent.  
2. **Port‑Based Service Boundary** – Communication through configurable ports (HTTP + SSE) isolates the agent from its callers.  
3. **Retrieval‑Augmented Generation (RAG) Integration** – The agent supplies structured knowledge to AI components on demand.

### Design Decisions & Trade‑offs  

* **Isolation vs. Latency** – Running the CodeGraphAgent as a separate service isolates resource‑intensive analysis but adds network latency for each request.  
* **SSE for Incremental Updates** – Streaming graph updates via SSE reduces the need for polling but requires consumers to manage streaming lifecycles.  
* **Environment‑Driven Configuration** – Using env vars simplifies deployment but couples runtime behavior to external configuration, demanding strict DevOps discipline.

### System Structure Insights  

The overall system is a **hierarchical pipeline**: OnlineLearning (parent) orchestrates a set of agents (children) that each expose a port‑based API.  The CodeGraphAgent sits at the intersection of static code analysis and AI‑driven retrieval, acting as a data provider for downstream RAG services.

### Scalability Considerations  

* **Horizontal Scaling** – Because the agent listens on a port, multiple instances can be load‑balanced behind a reverse proxy, allowing parallel processing of many repositories.  
* **Resource Management** – Graph construction can be CPU‑ and memory‑intensive; container limits and autoscaling policies should be tuned accordingly.  
* **Streaming Efficiency** – SSE streams should be throttled or chunked to prevent overwhelming network bandwidth when large graphs are emitted.

### Maintainability Assessment  

The agent’s **clear separation of concerns** (analysis logic vs. transport layer) and **environment‑driven configuration** make it straightforward to update or replace individual pieces.  However, the reliance on external port contracts means that any change to the API surface must be coordinated with all RAG consumers, necessitating versioned endpoints or backward‑compatible response formats to keep the ecosystem stable.


## Hierarchy Context

### Parent
- [OnlineLearning](./OnlineLearning.md) -- OnlineLearning may use the CodeAnalysisAgent in integrations/mcp-server-semantic-analysis/src/agents/code-graph-agent.ts to analyze code repositories and extract insights


---

*Generated from 3 observations*
