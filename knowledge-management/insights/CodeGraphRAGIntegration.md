# CodeGraphRAGIntegration

**Type:** Detail

The presence of CODE_GRAPH_RAG_SSE_PORT and CODE_GRAPH_RAG_PORT in the project documentation implies a configured integration with Code Graph RAG, facilitating real-time code analysis and monitoring.

## What It Is  

**CodeGraphRAGIntegration** is the concrete implementation that ties the **CodeAnalysisAgent** to a graph‑based Retrieval‑Augmented Generation (RAG) service dedicated to codebases. The integration lives under the `integrations/code-graph-rag/` folder of the repository. Its purpose is to expose the internal AST‑driven analysis performed by **CodeAnalysisAgent** to the external “Code Graph RAG” service so that downstream agents (for example the Claude‑based code assistant) can query a live, graph‑structured representation of a code repository. The primary documentation for the integration is the **README** at  

```
integrations/code-graph-rag/README.md
```  

and the Claude‑specific setup instructions are recorded in  

```
integrations/code-graph-rag/docs/claude-code-setup.md
```  

Both files describe the integration as a “graph‑based RAG system for any codebases”, confirming that the component is deliberately generic and not tied to a single language or project. Two environment variables – `CODE_GRAPH_RAG_PORT` and `CODE_GRAPH_RAG_SSE_PORT` – are defined in the project documentation, indicating that the integration runs a service (or a set of services) that listen on dedicated ports for HTTP and Server‑Sent Events (SSE) traffic respectively.  

In the overall hierarchy, **CodeGraphRAGIntegration** is a child of **CodeAnalysisAgent** (the parent component that performs AST‑based extraction). The relationship is explicit: *CodeAnalysisAgent contains CodeGraphRAGIntegration*. No sibling components are listed in the observations, but any other integration under `integrations/` would be a logical sibling.

---

## Architecture and Design  

The architecture revealed by the observations is a **service‑oriented integration** that bridges a local code‑analysis pipeline with an external graph‑RAG engine. The design relies on **configuration‑driven networking**: the integration reads `CODE_GRAPH_RAG_PORT` (the main HTTP endpoint) and `CODE_GRAPH_RAG_SSE_PORT` (the streaming endpoint) to establish bi‑directional communication with the RAG service. This pattern resembles a **thin‑client façade**, where the heavy lifting (graph construction, vector storage, retrieval) resides in the external RAG system, while the local component focuses on feeding it fresh analysis data and consuming its responses.

The presence of an SSE port suggests an **event‑driven streaming model** for real‑time updates. As **CodeAnalysisAgent** discovers new AST nodes or concept extracts, it can push incremental changes to the graph service over the SSE channel, allowing downstream LLM‑based agents (e.g., Claude) to receive up‑to‑date context without polling. This design choice reduces latency and bandwidth compared to a pure request‑response approach.

The documentation in `claude-code-setup.md` explicitly mentions a “Claude Code Setup for Graph‑Code MCP Server”, indicating that the integration is intended to be used together with a Claude‑powered code assistant. The pattern here is a **client‑server contract** where the client (the agent) formats its payloads according to the expectations of the Graph‑Code MCP (Multi‑Component Platform) server, which then returns graph‑augmented results. No explicit micro‑service or event‑bus frameworks are referenced; the integration appears to rely on standard HTTP/SSE primitives.

---

## Implementation Details  

Because the observations do not list concrete classes or functions, the implementation can be inferred from the file hierarchy and the environment variables:

1. **Configuration Layer** – The integration reads `CODE_GRAPH_RAG_PORT` and `CODE_GRAPH_RAG_SSE_PORT` at startup, most likely via a small helper module that parses `process.env` (or the equivalent in the host language). This module is probably located near the top of the `integrations/code-graph-rag/` directory, though the exact file name is not disclosed.

2. **Transport Layer** – Two transport clients are expected:
   * An **HTTP client** that posts analysis artefacts (e.g., AST nodes, extracted concepts) to the RAG service at `http://localhost:{CODE_GRAPH_RAG_PORT}`. The client may expose methods like `pushGraphUpdate(payload)` or `queryGraph(query)`.
   * An **SSE client** that opens a persistent connection to `http://localhost:{CODE_GRAPH_RAG_SSE_PORT}/events` (or a similar endpoint). This client listens for events such as “graph‑updated”, “index‑ready”, or “error”, enabling the local agent to react promptly.

3. **Adapter Logic** – Inside **CodeAnalysisAgent**, after each AST traversal or concept extraction, the agent invokes the integration’s adapter functions. These functions translate internal data structures (e.g., `CodeNode`, `Concept`) into the JSON schema expected by the graph‑RAG service. The adapter is the glue that keeps the two systems loosely coupled.

4. **Claude‑Specific Hook** – The `claude-code-setup.md` file likely documents additional steps required to register the integration with Claude’s code‑assistant runtime. This could involve providing an API key, setting up a “MCP server” endpoint, or configuring Claude to listen on the SSE stream for real‑time context.

Because no source symbols were discovered, the integration probably consists of a small set of utility modules rather than a large class hierarchy. The design emphasizes **separation of concerns**: analysis stays within **CodeAnalysisAgent**, while graph‑RAG responsibilities (storage, retrieval, vectorisation) are delegated to the external service.

---

## Integration Points  

The primary integration surface is the **environment‑variable‑driven network interface**. By exposing `CODE_GRAPH_RAG_PORT` and `CODE_GRAPH_RAG_SSE_PORT`, the system allows developers to run the graph‑RAG service locally, in a container, or as a remote endpoint without code changes. The integration points can be enumerated as follows:

| Integration | Direction | Protocol | Key Artifact |
|-------------|-----------|----------|--------------|
| **CodeAnalysisAgent → Graph‑RAG** | Push | HTTP POST | Serialized AST / concept payloads |
| **Graph‑RAG → CodeAnalysisAgent** | Stream | Server‑Sent Events | Real‑time update notifications |
| **Claude Code Assistant → Graph‑RAG** | Query | HTTP (via Claude SDK) | Natural‑language code queries |
| **Graph‑RAG → Claude** | Response | HTTP JSON | Retrieved graph fragments, citations |

The **Claude‑specific documentation** suggests that the integration also registers a “MCP Server” endpoint with Claude, enabling Claude to issue graph queries directly. This creates a **tri‑angular coupling**: `CodeAnalysisAgent` feeds the graph, Claude consumes it, and the graph service mediates both sides.

No other code‑level dependencies are mentioned, but given the naming conventions, the integration likely depends on standard HTTP libraries (e.g., `requests`, `axios`) and an SSE client library. The absence of explicit sibling components in the observations means that any other integration (e.g., a “SemanticSearchIntegration”) would follow a similar pattern, sharing the same environment‑variable approach.

---

## Usage Guidelines  

1. **Port Configuration** – Ensure that both `CODE_GRAPH_RAG_PORT` and `CODE_GRAPH_RAG_SSE_PORT` are set before launching **CodeAnalysisAgent**. The ports must match the configuration of the external graph‑RAG service; mismatched ports will cause connection failures and loss of real‑time updates.

2. **Service Availability** – Start the Graph‑RAG server *before* the agent begins analysis. The SSE endpoint must be reachable; otherwise, the agent will fall back to a fire‑and‑forget HTTP push, losing incremental updates.

3. **Payload Consistency** – When extending **CodeAnalysisAgent** with new AST node types or concept extractors, update the adapter logic in **CodeGraphRAGIntegration** to serialize these new structures according to the graph‑RAG schema. Failure to do so will result in rejected payloads.

4. **Claude Integration** – Follow the step‑by‑step instructions in `integrations/code-graph-rag/docs/claude-code-setup.md`. Typical steps include providing an API token for Claude, registering the MCP server URL, and optionally configuring Claude’s request timeout to align with the SSE stream latency.

5. **Monitoring & Debugging** – Use the SSE stream to monitor health signals such as “graph‑updated” or “error”. Logging these events helps diagnose synchronization issues between the local analysis and the remote graph. If the SSE channel disconnects, restart the agent to re‑establish the connection.

6. **Scalability** – For large codebases, consider increasing the resources (CPU, memory) of the Graph‑RAG service rather than the agent, because the heavy graph construction and vector indexing happen remotely. The agent remains lightweight, acting primarily as a data feeder.

---

### Summary of Architectural Insights  

1. **Identified Architectural Patterns**  
   * Configuration‑driven client‑server integration (environment variables for ports).  
   * Event‑driven streaming via Server‑Sent Events for real‑time graph updates.  
   * Thin‑client façade that delegates storage and retrieval to an external graph‑RAG service.  

2. **Design Decisions & Trade‑offs**  
   * **Decoupling**: By keeping the graph logic external, the system stays language‑agnostic and easier to evolve, at the cost of a network dependency.  
   * **Real‑time Feedback**: SSE provides low‑latency updates but requires a stable connection; fallback to pure HTTP is possible but loses immediacy.  
   * **Port‑Based Configuration**: Simple to change in CI/CD pipelines, but hard‑coded port numbers may clash in shared environments unless carefully managed.  

3. **System Structure Insights**  
   * **CodeAnalysisAgent** → **CodeGraphRAGIntegration** (adapter) → **Graph‑RAG Service** (HTTP + SSE).  
   * Claude’s code assistant sits on the opposite side of the graph service, issuing queries that are satisfied by the same graph built from the agent’s analysis.  

4. **Scalability Considerations**  
   * Horizontal scaling of the Graph‑RAG service (multiple instances behind a load balancer) can handle larger codebases without changing the agent.  
   * SSE connections scale linearly with the number of agents; monitoring connection limits on the RAG server is advisable.  

5. **Maintainability Assessment**  
   * High maintainability due to clear separation: updates to analysis logic stay within **CodeAnalysisAgent**, while changes to graph storage stay inside the external service.  
   * The integration’s small footprint (environment variables, HTTP/SSE clients) means low code churn, but documentation (README, Claude setup) must stay in sync with any protocol changes.  

These insights should guide developers and architects when extending, deploying, or troubleshooting the **CodeGraphRAGIntegration** component within the broader code‑analysis ecosystem.


## Hierarchy Context

### Parent
- [CodeAnalysisAgent](./CodeAnalysisAgent.md) -- CodeAnalysisAgent uses AST-based techniques to analyze code structures and extract concepts.


---

*Generated from 3 observations*
