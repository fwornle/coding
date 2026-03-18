# GraphCodeRagIntegration

**Type:** Detail

The presence of CODE_GRAPH_RAG_SSE_PORT and CODE_GRAPH_RAG_PORT in the key documented components suggests a defined interface for interacting with the Code Graph RAG system.

## What It Is  

**GraphCodeRagIntegration** lives under the `integrations/code-graph-rag/` directory of the repository. The core description of the system is in `integrations/code-graph-rag/README.md`, which explains that the integration implements a *graph‑based Retrieval‑Augmented Generation (RAG)* pipeline for source‑code analysis. The purpose of the integration is to ingest a code‑base, construct a navigable graph representation of symbols, dependencies, and call‑flows, and then expose that graph to downstream LLM‑driven components (for example, the Claude‑based code‑assistant described in `integrations/code-graph-rag/docs/claude-code-setup.md`).  

Two environment variables—`CODE_GRAPH_RAG_PORT` and `CODE_GRAPH_RAG_SSE_PORT`—are documented as the primary network interfaces. The former is the HTTP API endpoint that accepts requests such as “search this graph for a definition” or “retrieve the call‑graph of a function”. The latter opens a Server‑Sent Events (SSE) stream that pushes incremental graph updates or long‑running query results back to the caller. Together they define a clear, port‑based contract for any consumer, including the parent component **ObservationDerivation**, which may invoke the RAG service to enrich its own observations with code‑graph context.

---

## Architecture and Design  

The integration follows a **graph‑centric architecture**. The code‑base is first parsed into an internal graph model (nodes representing files, classes, functions, variables; edges representing import, inheritance, call, and data‑flow relationships). This model is stored in a process‑local or external graph store (the README hints at a “graph database” but does not name a concrete implementation).  

Interaction with the graph is performed via two **port‑exposed interfaces**:

1. **`CODE_GRAPH_RAG_PORT`** – a conventional HTTP REST API. Requests are routed to handlers that translate high‑level queries (e.g., “find all implementations of interface X”) into graph traversals.  
2. **`CODE_GRAPH_RAG_SSE_PORT`** – an SSE endpoint that streams results for long‑running traversals or pushes live updates when the underlying code changes.  

The design therefore separates **command‑style** interactions (immediate request/response) from **event‑style** interactions (asynchronous streaming). This dual‑interface pattern is explicitly documented in the Claude setup guide, which shows how the Claude‑based MCP (Model‑Control‑Plane) server subscribes to the SSE stream to receive incremental context while a user is typing.  

Because the integration is packaged under the `integrations/` hierarchy, it is treated as a **plug‑in** rather than a core service. The parent component **ObservationDerivation** can load the integration at runtime, invoke its HTTP API, and optionally listen to its SSE feed, thereby reusing the graph‑based insight generation without duplicating graph construction logic.

---

## Implementation Details  

The only concrete artifacts referenced are the README and the Claude‑specific setup doc, but they reveal the following implementation clues:

* **Configuration via environment variables** – `CODE_GRAPH_RAG_PORT` and `CODE_GRAPH_RAG_SSE_PORT` are read at startup, suggesting a lightweight server bootstrap (likely using a minimal web framework such as FastAPI, Express, or Flask).  
* **Graph construction pipeline** – while not named, the README describes a “graph‑based approach to code analysis”. This implies a parsing stage (AST generation) followed by a transformation step that emits nodes and edges. The pipeline is probably encapsulated in a module (e.g., `graph_builder.py` or similar) that is invoked when the service starts or when a “refresh” endpoint is called.  
* **Claude integration** – `integrations/code-graph-rag/docs/claude-code-setup.md` outlines a concrete integration point: the Claude MCP server connects to the SSE port to receive live graph updates. The doc likely contains sample code that opens an SSE client, authenticates (if needed), and registers callbacks for events such as `graph_updated` or `query_result_chunk`.  
* **Port exposure** – the presence of two distinct ports indicates that the service runs two listeners, possibly on separate threads or async event loops, to keep request handling and event streaming independent.  

No class or function names are given, so the analysis stays at the module and service level. The implementation appears to be deliberately **stateless** for the HTTP API (each request triggers a fresh graph traversal) while maintaining **stateful streaming** for SSE (the server keeps a subscription registry to push updates).

---

## Integration Points  

1. **Parent – ObservationDerivation**  
   *ObservationDerivation* can call the HTTP API (`CODE_GRAPH_RAG_PORT`) to enrich its observation payloads with code‑graph facts (e.g., “this function is overridden in three modules”). It can also subscribe to the SSE feed (`CODE_GRAPH_RAG_SSE_PORT`) to receive incremental updates when the underlying code changes, allowing ObservationDerivation to keep its cached observations fresh without polling.

2. **Claude MCP Server**  
   The Claude setup doc shows the MCP server acting as a **client** of the SSE endpoint. The MCP uses the streaming data to augment LLM prompts with up‑to‑date graph context, enabling more accurate code‑completion or explanation responses.

3. **External Consumers**  
   Any tool that needs programmatic access to the code graph (e.g., IDE plugins, CI analysis scripts) can target the HTTP port. The clear port‑based contract means no additional SDK is required; a simple `curl` or HTTP client suffices.

4. **Configuration Layer**  
   The two environment variables are the sole public configuration surface. Changing ports or disabling the SSE stream can be done by adjusting these variables, making deployment flexible across container orchestration platforms.

---

## Usage Guidelines  

* **Start the service with explicit ports** – always set `CODE_GRAPH_RAG_PORT` and `CODE_GRAPH_RAG_SSE_PORT` before launching the integration. This avoids accidental port collisions in multi‑service environments.  
* **Prefer the HTTP API for one‑off queries** – when you need a single graph lookup (e.g., “list callers of function X”), issue a POST/GET to the HTTP endpoint and close the connection promptly.  
* **Use the SSE stream for long‑running or dynamic scenarios** – if your workflow involves watching the graph for changes (as the Claude MCP does) or processing large traversals that produce incremental results, open a persistent SSE connection to the `CODE_GRAPH_RAG_SSE_PORT`. Remember to handle reconnection logic because SSE does not guarantee delivery across network interruptions.  
* **Leverage ObservationDerivation as the canonical consumer** – if you are extending the system, route all observation‑enrichment calls through ObservationDerivation. This centralizes caching, error handling, and future upgrades to the graph pipeline.  
* **Keep the graph in sync** – after any code change, trigger a refresh (the README likely mentions a “/refresh” endpoint) so that the SSE stream emits an update event. Failing to do so will cause downstream consumers to operate on stale graph data.  

---

### Architectural Patterns Identified  

1. **Graph‑Centric Data Model** – the core abstraction is a navigable graph of code entities.  
2. **Port‑Based Service Interface** – two distinct network ports expose synchronous HTTP and asynchronous SSE interfaces.  
3. **Plug‑in Integration** – housed under `integrations/`, the component is designed to be attached to larger workflows (e.g., ObservationDerivation).  

### Design Decisions and Trade‑offs  

* **Separate HTTP and SSE ports** – simplifies protocol handling but requires two listening sockets; the trade‑off is clearer separation of concerns versus a single multiplexed endpoint.  
* **Environment‑variable configuration** – lightweight and container‑friendly, but lacks runtime configurability without a restart.  
* **Graph as a shared knowledge base** – provides rich context for LLMs, yet incurs upfront parsing cost and memory usage proportional to code‑base size.  

### System Structure Insights  

The integration is a self‑contained service that ingests source code, builds a graph, and offers two APIs. It sits directly under the `integrations/` tree, making it a sibling to other third‑party connectors. Its parent, **ObservationDerivation**, treats it as a data‑source component, while its child‑like consumers (Claude MCP, IDE plugins) treat it as an external service.

### Scalability Considerations  

* **Horizontal scaling** – because the HTTP API is stateless, multiple instances can be load‑balanced behind a reverse proxy, provided the underlying graph store is shared (e.g., a distributed graph DB).  
* **SSE scalability** – streaming many concurrent clients can increase memory pressure; a publish‑subscribe broker (Redis Streams, NATS) could be introduced to offload fan‑out.  
* **Graph size** – very large repositories may require sharding or incremental graph construction to keep memory footprints manageable.  

### Maintainability Assessment  

The design is **modular** and **well‑documented** via the README and the Claude setup guide, which reduces onboarding friction. The reliance on simple environment variables and standard HTTP/SSE protocols keeps the codebase approachable. However, the lack of explicit class or module names in the current observations suggests that internal code organization may be informal; introducing a clear package structure (e.g., `graph_builder/`, `api/`, `stream/`) would improve discoverability. Overall, the integration scores high on maintainability due to its isolated responsibilities and explicit contract, with the primary risk being the hidden complexity of the graph construction pipeline.


## Hierarchy Context

### Parent
- [ObservationDerivation](./ObservationDerivation.md) -- ObservationDerivation may utilize a similar approach to the Code Graph RAG system, as described in integrations/code-graph-rag/README.md


---

*Generated from 3 observations*
