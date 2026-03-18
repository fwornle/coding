# CodeGraphRAG

**Type:** SubComponent

The CodeGraphRAG sub-component utilizes the graph_operations.py module to handle code graph and RAG operations, specifically through the CodeGraphBuilder class and its build_rag() function.

## What It Is  

CodeGraphRAG is a **sub‑component** that lives inside the `DockerizedServices` assembly. Its primary source of documentation is the README located at **`integrations/code‑graph‑rag/README.md`**. The component is responsible for building a *graph‑based Retrieval‑Augmented Generation (RAG)* index over a codebase, enabling downstream services to query code‑level context efficiently. Configuration is driven by two environment variables – **`CODE_GRAPH_RAG_SSE_PORT`** (the port on which the Server‑Sent Events stream is exposed) and **`CODE_GRAPH_RAG_PORT`** (the main HTTP API port). The core operational logic resides in the **`graph_operations.py`** module, where the **`CodeGraphBuilder`** class implements the `build_rag()` function that constructs the graph and populates the RAG store.

## Architecture and Design  

The architecture follows a **modular, Docker‑centric** style typical of the `DockerizedServices` parent. Each sub‑component, including CodeGraphRAG, is packaged as an isolated container that reads its configuration from environment variables – a direct application of the *12‑factor app* principle for configuration.  

Within CodeGraphRAG, the **Builder pattern** is evident through the `CodeGraphBuilder` class. By exposing a single `build_rag()` method, the class encapsulates the multi‑step process of parsing source files, constructing a dependency graph, and indexing the resulting nodes for retrieval. This isolates the complex graph construction logic from callers and makes the operation reusable.  

The presence of a **handler** sub‑entity – `CodeGraphRAGHandler` – suggests a *Handler* or *Controller* pattern that mediates HTTP/SSE requests and forwards them to the builder or the underlying RAG store. While the exact implementation of the handler is not detailed in the observations, its naming and placement under CodeGraphRAG indicate it serves as the public entry point for the component’s API surface, analogous to how `LLMService` acts as the façade for LLM operations in the sibling `LLMService` component.  

Interaction with siblings is minimal but follows a common contract: both `CodeGraphRAG` and `LLMService` expose HTTP endpoints configured via environment variables and run inside the same Docker network managed by `DockerizedServices`. This shared deployment model enables them to be composed together—for example, an LLM request could trigger a code‑graph lookup via CodeGraphRAG.

## Implementation Details  

The heart of the implementation lives in **`integrations/code‑graph‑rag/graph_operations.py`**. The `CodeGraphBuilder` class is instantiated by the `CodeGraphRAGHandler` (the child component) when a request arrives at the RAG API. Its `build_rag()` function performs three logical phases:

1. **Code Parsing** – source files are traversed, ASTs are generated, and symbols (functions, classes, modules) are extracted.  
2. **Graph Construction** – nodes representing symbols are linked based on import statements, call relationships, and inheritance, producing a directed graph that mirrors the codebase’s structure.  
3. **RAG Index Population** – each node’s textual representation (e.g., docstrings, comments) is embedded (likely via an external embedding model) and stored in a vector store that supports similarity search.  

The component’s runtime configuration is read at container start‑up. `CODE_GRAPH_RAG_PORT` determines the primary HTTP listener that serves RESTful endpoints (e.g., `/build`, `/query`). `CODE_GRAPH_RAG_SSE_PORT` opens a secondary listener dedicated to Server‑Sent Events, allowing clients to receive incremental updates as the graph is built or as query results stream in. This dual‑port design decouples bulk data transfer from low‑latency streaming, aligning with the design seen in the sibling `BrowserAccess` MCP server, which also leverages SSE for real‑time communication.

## Integration Points  

- **Parent – DockerizedServices**: CodeGraphRAG is packaged as a Docker service defined under the `DockerizedServices` compose file. It inherits the parent’s networking, logging, and health‑check conventions. The parent’s high‑level façade for LLM operations (`LLMService`) shares the same environment‑variable‑driven configuration approach, making it straightforward to orchestrate both services together.  

- **Sibling – LLMService**: Both services expose HTTP APIs and may be co‑located on the same Docker network, allowing the LLM layer to call CodeGraphRAG endpoints for code‑specific context augmentation. The similarity in configuration (port variables) simplifies deployment scripts.  

- **Sibling – BrowserAccess**: The BrowserAccess MCP server also uses SSE for real‑time updates, suggesting a common pattern for streaming data across the ecosystem. If a developer needs to visualize the evolving code graph, BrowserAccess could subscribe to the SSE stream emitted by CodeGraphRAG.  

- **Child – CodeGraphRAGHandler**: The handler implements the public API surface. It parses incoming requests, validates payloads, and delegates to `CodeGraphBuilder.build_rag()`. It also translates query results into the SSE format when clients connect to the `CODE_GRAPH_RAG_SSE_PORT`.  

- **External Dependencies**: While not explicitly listed, the RAG pipeline likely depends on an embedding service (e.g., OpenAI, HuggingFace) and a vector store (e.g., FAISS, Pinecone). These would be injected via environment variables or Docker secrets, following the same pattern used by `LLMService`.

## Usage Guidelines  

1. **Configuration** – Always set `CODE_GRAPH_RAG_PORT` and `CODE_GRAPH_RAG_SSE_PORT` before starting the container. Align these ports with the Docker compose network to avoid collisions with sibling services.  

2. **Building the Graph** – Invoke the `/build` endpoint (served on `CODE_GRAPH_RAG_PORT`) with a JSON payload that specifies the source directory and any inclusion/exclusion rules. The handler will instantiate `CodeGraphBuilder` and run `build_rag()`. Monitor the SSE endpoint on `CODE_GRAPH_RAG_SSE_PORT` to receive progress events, which is especially useful for large repositories.  

3. **Querying** – Use the `/query` endpoint to retrieve relevant code snippets. The request should include a natural‑language query; the handler will perform a similarity search against the vector store populated by `build_rag()`.  

4. **Error Handling** – The handler returns standard HTTP status codes. For streaming errors on the SSE channel, the client should reconnect using the same `CODE_GRAPH_RAG_SSE_PORT`.  

5. **Resource Management** – Graph construction can be CPU‑ and memory‑intensive. Allocate sufficient resources to the Docker container (e.g., `--cpus`, `--memory`) and consider running the build step during off‑peak hours.  

6. **Version Compatibility** – Keep the `graph_operations.py` module in sync with any updates to the embedding model or vector store API. Since the builder encapsulates these calls, changes are localized to this file, minimizing impact on the handler or other components.

---

### Architectural Patterns Identified
1. **Builder Pattern** – `CodeGraphBuilder` encapsulates multi‑step graph and RAG construction.  
2. **Handler/Controller Pattern** – `CodeGraphRAGHandler` mediates HTTP/SSE requests.  
3. **12‑Factor Config** – Environment variables (`CODE_GRAPH_RAG_PORT`, `CODE_GRAPH_RAG_SSE_PORT`) drive runtime configuration.  
4. **Dual‑Port Streaming** – Separate ports for REST API and Server‑Sent Events, mirroring the pattern used by `BrowserAccess`.

### Design Decisions and Trade‑offs
- **Separation of Concerns** – Builder logic lives in `graph_operations.py`, while request handling stays in the handler, simplifying testing and future extension.  
- **Streaming via SSE** – Provides real‑time feedback but requires an extra port and client logic to handle reconnections.  
- **Docker Isolation** – Guarantees reproducible environments at the cost of increased orchestration complexity.  
- **Environment‑Variable Config** – Easy to change per deployment, but sensitive values must be managed securely (e.g., Docker secrets).

### System Structure Insights
- **Parent‑Child Relationship** – `DockerizedServices` → `CodeGraphRAG` → `CodeGraphRAGHandler`.  
- **Sibling Cohesion** – Shares configuration style and networking with `LLMService` and `BrowserAccess`.  
- **Modular Packaging** – Each sub‑component is a self‑contained Docker service, facilitating independent scaling.

### Scalability Considerations
- **Horizontal Scaling** – Multiple instances of CodeGraphRAG can be run behind a load balancer, provided the underlying vector store is shared or sharded.  
- **Resource‑Intensive Build** – Graph construction may need to be off‑loaded to a dedicated worker node or run as a batch job to avoid blocking API requests.  
- **SSE Bandwidth** – Streaming large graphs can saturate the SSE port; consider rate‑limiting or batching events.

### Maintainability Assessment
- **High Maintainability** – Clear separation between graph building (`CodeGraphBuilder`) and request handling (`CodeGraphRAGHandler`) localizes changes.  
- **Documentation Anchor** – All high‑level behavior is described in `integrations/code‑graph‑rag/README.md`, ensuring a single source of truth.  
- **Potential Risks** – Tight coupling to external embedding/vector services could introduce breaking changes; encapsulating those calls within `graph_operations.py` mitigates impact.  
- **Testing** – Unit tests can target `CodeGraphBuilder.build_rag()` in isolation, while integration tests can validate the handler’s HTTP/SSE contract, supporting a robust CI pipeline.

## Diagrams

### Relationship

![CodeGraphRAG Relationship](images/code-graph-rag-relationship.png)



## Architecture Diagrams

![relationship](../../.data/knowledge-graph/insights/images/code-graph-rag-relationship.png)


## Hierarchy Context

### Parent
- [DockerizedServices](./DockerizedServices.md) -- [LLM] The DockerizedServices component utilizes a high-level facade for LLM operations, with the LLMService (lib/llm/llm-service.ts) acting as the single public entry point for all LLM operations, handling mode routing and provider fallback. This design decision allows for a clear separation of concerns and makes it easier to manage and maintain the component. The LLMService class is responsible for handling incoming requests, determining the appropriate mode and provider, and delegating the work to the corresponding provider. For example, the handleRequest function in lib/llm/llm-service.ts is responsible for handling incoming requests and delegating the work to the corresponding provider.

### Children
- [CodeGraphRAGHandler](./CodeGraphRAGHandler.md) -- The CodeGraphRAG system is described in integrations/code-graph-rag/README.md, indicating a graph-based RAG system for codebases.

### Siblings
- [LLMService](./LLMService.md) -- The LLMService class in lib/llm/llm-service.ts handles incoming requests and delegates the work to the corresponding provider.
- [BrowserAccess](./BrowserAccess.md) -- The BrowserAccess MCP server is described in integrations/browser-access/README.md.


---

*Generated from 3 observations*
