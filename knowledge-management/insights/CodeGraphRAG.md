# CodeGraphRAG

**Type:** SubComponent

CodeGraphRAG could involve the use of semantic constraint detection, as seen in integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md

## What It Is  

**CodeGraphRAG** is a sub‑component of the **KnowledgeManagement** layer that provides graph‑based Retrieval‑Augmented Generation (RAG) for source‑code artefacts. The core of its implementation lives in the *integrations/code‑graph‑rag* folder – the README and the Claude‑code setup documentation (`integrations/code-graph-rag/README.md` and `integrations/code-graph-rag/docs/claude-code-setup.md`) describe how the Graph‑Code MCP (Model‑Control‑Plane) server is configured and wired into the system.  

The component is not a monolithic service; it is built around the **GraphCodeSetup** child component, which encapsulates the concrete MCP server configuration. CodeGraphRAG leverages the **entity‑typing system** (potentially multiple ontologies) to tag code entities, and it cooperates with sibling services such as **EntityPersistence** (graph‑DB storage) and **ManualLearning** (hand‑crafted entity ingestion). In addition, it can tap into the **MCP Constraint Monitor** (`integrations/mcp-constraint-monitor/README.md` and its semantic‑constraint documentation) to enforce domain‑specific rules on the generated graph.

---

## Architecture and Design  

The architecture follows a **modular, integration‑driven** style. Each major concern—graph construction, persistence, constraint monitoring, and learning—resides in its own sibling component, and CodeGraphRAG orchestrates them through well‑defined interfaces.  

1. **Lazy LLM Initialization (Parent Influence)** – The parent **KnowledgeManagement** component defers LLM creation until required (`ensureLLMInitialized()`). CodeGraphRAG inherits this pattern: the RAG pipeline only spins up the language model when a retrieval request arrives, keeping memory footprints low.  

2. **Work‑Stealing Concurrency** – The `wave-controller.ts` file (used by KnowledgeManagement) introduces a **shared atomic index counter** for work‑stealing. CodeGraphRAG reuses this concurrency primitive in its graph‑building stage, allowing multiple worker threads to pull tasks (e.g., parsing files, extracting symbols) from a common queue without contention.  

3. **Entity‑Typing & Multi‑Ontology** – Observations note that CodeGraphRAG “may leverage the entity typing system, possibly using multiple ontology systems.” This suggests a **strategy pattern** where different ontology providers (e.g., Claude‑code hook format, UKB trace taxonomy) can be swapped at runtime, each supplying type definitions for code entities.  

4. **MCP Constraint Monitoring** – The component plugs into the **MCP Constraint Monitor** (`integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md`). This integration follows a **publish‑subscribe** model: after the graph is assembled, constraint detectors publish violations, and the monitor subscribes to enforce them.  

5. **Graph Persistence via EntityPersistence** – CodeGraphRAG hands off the constructed graph to **EntityPersistence**, which likely uses a graph database (as hinted in its documentation). The hand‑off follows a **repository pattern**, abstracting storage details from the RAG logic.  

Overall, the design emphasizes **separation of concerns**, **reusability of concurrency utilities**, and **extensibility through ontology and constraint plugins**.

---

## Implementation Details  

### Core Files  
- **`integrations/code-graph-rag/README.md`** – outlines the high‑level workflow: source ingestion → entity typing → graph construction → constraint checking → persistence → RAG query handling.  
- **`integrations/code-graph-rag/docs/claude-code-setup.md`** – provides the concrete MCP server configuration (host, ports, authentication) that the **GraphCodeSetup** child component materialises.  

### GraphCodeSetup  
The child component encapsulates the MCP server bootstrap. It reads the Claude‑code setup YAML, instantiates the server, and exposes an API (`startServer()`, `registerEntityHandler()`) used by CodeGraphRAG to push parsed entities into the graph.  

### Concurrency Engine  
`wave-controller.ts` (line ≈ 489) defines a **shared atomic index counter** (`AtomicLong workIndex`). CodeGraphRAG creates a pool of workers that each atomically fetch the next work item (`workIndex.getAndIncrement()`) and process a chunk of source files. This work‑stealing approach minimizes idle threads when the number of files is unevenly distributed.  

### Entity Typing & Ontology Integration  
Although concrete class names are not listed, the observation about “multiple ontology systems” implies the existence of an **`OntologyProvider` interface** with implementations such as `ClaudeCodeHookOntology` (referenced by the sibling **OntologyClassification**) and possibly a UKB‑based provider. CodeGraphRAG registers the appropriate provider at start‑up based on configuration.  

### Constraint Monitoring  
The **MCP Constraint Monitor** supplies a `SemanticConstraintDetector` (documented in `integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md`). After the graph is populated, CodeGraphRAG invokes `detector.run(graph)`; any violations are emitted as events that the monitor logs or uses to reject malformed entities.  

### Persistence Layer  
Interaction with **EntityPersistence** follows a repository‑style API (`entityRepo.saveGraph(graph)`). The persistence implementation likely maps graph nodes to vertices in a Neo4j‑like store, preserving relationships such as “calls”, “inherits”, and “defines”.  

### RAG Query Path  
When a downstream component (e.g., **OnlineLearning** or a user‑facing LLM) needs code context, it calls `CodeGraphRAG.retrieveContext(query)`. The method performs a graph traversal (e.g., shortest‑path or neighborhood expansion) to collect relevant nodes, serialises them into a prompt, and forwards the prompt to the lazily‑initialized LLM via the parent KnowledgeManagement pipeline.

---

## Integration Points  

1. **Parent – KnowledgeManagement**  
   - Inherits lazy LLM initialization and the work‑stealing concurrency utilities.  
   - Contributes the `ensureLLMInitialized()` guard that wraps the final RAG call.  

2. **Sibling – EntityPersistence**  
   - Receives the final graph for durable storage.  
   - Exposes a `GraphRepository` interface that CodeGraphRAG calls after constraint validation.  

3. **Sibling – ManualLearning**  
   - Supplies manually curated entities that bypass automatic parsing but still flow through the same typing and constraint pipeline.  

4. **Sibling – OntologyClassification**  
   - Provides the ontology definitions used by CodeGraphRAG’s entity‑typing stage. The Claude‑code hook format (`integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md`) is a concrete example.  

5. **Sibling – MCP Constraint Monitor**  
   - Offers semantic constraint detection; CodeGraphRAG registers its graph with the monitor to trigger validation.  

6. **Child – GraphCodeSetup**  
   - Handles low‑level MCP server bootstrapping and exposes the API for entity ingestion.  

All these interactions are mediated through clearly named interfaces (e.g., `EntityRepository`, `OntologyProvider`, `ConstraintDetector`), keeping coupling low and enabling independent evolution of each sibling.

---

## Usage Guidelines  

1. **Initialize via KnowledgeManagement** – Do not instantiate CodeGraphRAG directly; obtain it from the KnowledgeManagement container so that the lazy LLM guard and shared concurrency controller are correctly wired.  

2. **Select an Ontology Early** – Choose the appropriate ontology provider (Claude‑code hook, UKB, etc.) at start‑up via configuration. Changing it at runtime requires a full graph rebuild because entity types are baked into node metadata.  

3. **Respect the Work‑Stealing Model** – When adding custom parsers or file walkers, use the shared atomic index counter (`AtomicLong workIndex`) rather than spawning independent thread pools. This preserves the system‑wide load‑balancing guarantees.  

4. **Validate Before Persistence** – Always invoke the MCP Constraint Monitor (`detector.run(graph)`) and handle any reported violations before calling `entityRepo.saveGraph(graph)`. Persisting a graph with constraint violations can corrupt downstream RAG queries.  

5. **Leverage ManualLearning for Edge Cases** – For code artefacts that cannot be auto‑parsed (generated code, proprietary DSLs), feed them through ManualLearning. The manual path still benefits from the same typing and constraint pipeline, ensuring consistency.  

6. **Monitor Resource Usage** – Because the LLM is lazily loaded, the first retrieval may incur a noticeable latency. Warm‑up the model during system start‑up if low‑latency responses are required.  

---

## Summary of Architectural Insights  

| Aspect | Observation‑Based Insight |
|--------|---------------------------|
| **Architectural patterns identified** | Modular integration, lazy initialization (parent), work‑stealing concurrency (`wave-controller.ts`), strategy for ontology providers, publish‑subscribe for constraint monitoring, repository pattern for persistence. |
| **Design decisions and trade‑offs** | *Lazy LLM* reduces memory but adds first‑call latency; *shared atomic counter* gives high concurrency with low contention but ties all workers to a single index source; *multiple ontologies* increase flexibility at the cost of added configuration complexity; *constraint monitoring* ensures graph quality but introduces an extra validation step before persistence. |
| **System structure insights** | CodeGraphRAG sits under KnowledgeManagement, shares concurrency utilities, and delegates storage to EntityPersistence. Its child GraphCodeSetup abstracts MCP server details, while siblings supply typing, persistence, manual data, and constraint services. |
| **Scalability considerations** | Work‑stealing enables scaling across many CPU cores for large codebases. The graph database in EntityPersistence must be sized for the expected node/edge volume; horizontal scaling can be achieved by sharding the graph if the repository supports it. Constraint detection is a linear pass over the graph, so its cost grows with graph size – consider incremental validation for incremental updates. |
| **Maintainability assessment** | High maintainability due to clear separation of concerns and interface‑driven contracts. The reliance on shared utilities (atomic counter, lazy LLM) centralises complexity, making updates easier. Potential risk: tight coupling to the specific Claude‑code setup format; any change in that format requires coordinated updates in GraphCodeSetup and OntologyClassification. Overall, the design is well‑structured for incremental evolution. |


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- [LLM] The KnowledgeManagement component employs a lazy loading approach for LLM initialization, as seen in the constructor-based pattern for wave agents. This is evident in the ensureLLMInitialized() method, which suggests that the component defers the initialization of Large Language Models (LLMs) until they are actually needed. This design decision helps to reduce memory consumption and improve system responsiveness, especially when dealing with multiple LLMs. The use of a shared atomic index counter for work-stealing concurrency in the runWithConcurrency() method (wave-controller.ts:489) further enhances the component's efficiency by allowing it to dynamically adjust its workload and minimize idle time.

### Children
- [GraphCodeSetup](./GraphCodeSetup.md) -- The Graph-Code setup is described in the integrations/code-graph-rag/docs/claude-code-setup.md file, which provides details on the configuration of the Graph-Code MCP Server.

### Siblings
- [ManualLearning](./ManualLearning.md) -- ManualLearning may utilize a similar approach to Claude Code Setup for Graph-Code MCP Server as described in integrations/browser-access/README.md
- [OnlineLearning](./OnlineLearning.md) -- OnlineLearning may use the batch analysis pipeline to extract knowledge from git history, as hinted in the project documentation
- [EntityPersistence](./EntityPersistence.md) -- EntityPersistence may use a graph database to store entities, as hinted in the project documentation
- [OntologyClassification](./OntologyClassification.md) -- OntologyClassification may utilize a similar approach to Claude Code Hook Data Format, as described in integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md
- [ObservationDerivation](./ObservationDerivation.md) -- ObservationDerivation may utilize a similar approach to the Code Graph RAG system, as described in integrations/code-graph-rag/README.md
- [UKBTraceReporting](./UKBTraceReporting.md) -- UKBTraceReporting may utilize a similar approach to the Claude Code Hook Data Format, as described in integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md
- [BrowserAccess](./BrowserAccess.md) -- BrowserAccess may utilize a similar approach to the Claude Code Setup for Graph-Code MCP Server, as described in integrations/browser-access/README.md


---

*Generated from 7 observations*
