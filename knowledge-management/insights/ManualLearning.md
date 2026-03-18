# ManualLearning

**Type:** SubComponent

ManualLearning pre-populates ontology metadata fields in integrations/copi/docs/STATUS-LINE-QUICK-REFERENCE.md to prevent redundant LLM re-classification

## What It Is  

ManualLearning is a **SubComponent** of the `KnowledgeManagement` system that orchestrates the “manual” portion of learning‑and‑knowledge‑capture workflows. The core of its implementation lives under the **`integrations/copi/`** directory:  

* `integrations/copi/README.md` – describes the Copi wrapper (a GitHub Copilot CLI façade) and its responsibilities for **logging** and **tmux** session management.  
* `integrations/copi/hooks.md` – enumerates the **hook functions** that drive the manual‑learning pipeline (e.g., start‑session, capture‑snapshot, finalize‑run).  
* `integrations/copi/scripts/README.md` – documents the **work‑stealing concurrency** strategy that ManualLearning uses when processing large batches of manual‑learning tasks.  
* `integrations/copi/docs/STATUS‑LINE‑QUICK‑REFERENCE.md` – lists the **ontology metadata fields** that are pre‑populated for each manual‑learning artefact, eliminating the need for downstream LLM re‑classification.  

In addition to the Copi integration, ManualLearning leverages two other integration packages:  

* `integrations/code-graph-rag/README.md` – provides a **graph‑based Retrieval‑Augmented Generation (RAG)** capability that lets ManualLearning query the code knowledge graph built by the sibling components `OnlineLearning` and `CodeGraphConstruction`.  
* `integrations/mcp-constraint-monitor/` – supplies a **DAG‑based execution model** (`constraint-configuration.md`) and **semantic‑constraint detection** (`semantic-constraint-detection.md`) that enforce logical consistency across manual‑learning steps.  

Together these files constitute the complete technical surface of ManualLearning, positioning it as the glue that records, validates, and enriches manually‑curated learning artefacts within the broader KnowledgeManagement ecosystem.

---

## Architecture and Design  

The architecture of ManualLearning is deliberately **integration‑centric**. Its primary building block is the **CopiIntegration** child component, which wraps the GitHub Copilot CLI and adds two orthogonal concerns: robust logging (to a central KnowledgeManagement store) and tmux‑based session orchestration. This mirrors the design of sibling components such as `EntityPersistence` and `UKBTraceReporting`, which also rely on `integrations/copi/README.md` for similar logging/tmux capabilities, indicating a shared **logging‑and‑session** pattern across the KnowledgeManagement domain.  

Concurrency is handled via a **work‑stealing** scheme described in `integrations/copi/scripts/README.md`. A shared `nextIndex` counter is atomically incremented by worker threads, allowing any idle worker to “steal” the next unit of work. This design avoids the need for a central task queue and scales well when many manual‑learning tasks (e.g., batch captures of code snippets) are queued simultaneously.  

ManualLearning’s execution order is governed by a **DAG‑based model** (`integrations/mcp-constraint-monitor/docs/constraint-configuration.md`). Each node in the DAG represents a manual‑learning step (e.g., “capture snapshot”, “apply ontology tags”, “run semantic check”). Before execution, the system performs a **topological sort**, guaranteeing that prerequisite steps complete before dependent ones run. This deterministic ordering is essential for the **semantic‑constraint detection** logic (`semantic-constraint-detection.md`), which validates that the artefacts produced at each stage respect the ontology’s logical rules.  

Finally, the component taps into the **graph‑based RAG system** (`integrations/code-graph-rag/README.md`). ManualLearning can query the existing code knowledge graph to enrich manual artefacts with contextual information (e.g., related functions, call‑graphs). This reuse of the RAG layer aligns ManualLearning with its siblings `OnlineLearning` and `CodeGraphConstruction`, both of which also depend on the same RAG integration for code‑graph queries.  

Overall, ManualLearning’s design is a composition of **integration reuse**, **concurrency via work‑stealing**, **DAG‑driven execution**, and **graph‑based knowledge retrieval**, each anchored in concrete markdown documentation rather than hidden source files.

---

## Implementation Details  

1. **Copi Wrapper & Hooks** – The `integrations/copi/README.md` defines the Copi CLI wrapper, exposing commands such as `copi start`, `copi capture`, and `copi finish`. Hook definitions in `integrations/copi/hooks.md` map these commands to internal functions (e.g., `onStartSession()`, `onCaptureSnapshot()`, `onFinalizeRun()`). Each hook writes a structured log entry to the KnowledgeManagement log store, embedding the pre‑populated ontology fields described in `STATUS‑LINE‑QUICK‑REFERENCE.md`.  

2. **Work‑Stealing Scheduler** – The concurrency model in `integrations/copi/scripts/README.md` introduces a global `nextIndex` integer protected by atomic operations (e.g., `std::atomic<int>` in the underlying implementation). Worker threads repeatedly execute:  
   ```cpp
   int idx = nextIndex.fetch_add(1);
   if (idx >= totalTasks) break;
   processTask(taskList[idx]);
   ```  
   This simple loop eliminates central bottlenecks and ensures that all manual‑learning tasks are processed as quickly as possible, even when the number of workers exceeds the number of tasks.  

3. **Ontology Pre‑Population** – `STATUS‑LINE‑QUICK‑REFERENCE.md` lists mandatory metadata fields such as `entity_type`, `learning_stage`, `source_timestamp`, and `confidence_score`. When a hook logs an event, it populates these fields directly from the context (e.g., the current tmux pane ID, the Copi command invoked, timestamps). By doing so, the downstream LLM that would otherwise need to infer these attributes is spared, reducing latency and improving classification accuracy.  

4. **DAG Execution & Topological Sort** – The constraint monitor (`integrations/mcp-constraint-monitor/docs/constraint-configuration.md`) provides a declarative YAML description of the DAG. At runtime, the system parses this file, builds an adjacency list, and runs a classic Kahn’s algorithm to produce a topologically sorted list of steps. Each step corresponds to a Copi hook or a RAG query, and the executor respects the sorted order, invoking the appropriate hook function.  

5. **Semantic Constraint Detection** – Implemented in `semantic-constraint-detection.md`, this module inspects the artefacts produced after each DAG node. It checks for violations such as missing required ontology fields, contradictory `learning_stage` values, or mismatched entity relationships. When a violation is detected, the system emits a warning log and optionally aborts downstream nodes, preserving the integrity of the manual‑learning record.  

6. **Graph‑Based RAG Integration** – The RAG README (`integrations/code-graph-rag/README.md`) outlines a set of query APIs (e.g., `graph.search(term)`, `graph.expand(nodeId)`). ManualLearning invokes these APIs during the “enrich artefact” DAG node to fetch related code entities, which are then attached to the log entry as additional context. This cross‑component reuse ensures that manually captured knowledge is immediately linked to the existing code graph maintained by `KnowledgeManagement`.  

No explicit source‑code symbols were discovered in the observations, but the markdown files provide a complete contract that the runtime implementation must obey.

---

## Integration Points  

ManualLearning sits at the intersection of three major integration packages:

* **CopiIntegration** – Provides the low‑level CLI wrapper, logging, and tmux session control. All manual‑learning hooks funnel through this layer, making it the primary entry point for developers who wish to script or automate manual capture actions.  

* **Code‑Graph‑RAG** – Supplies contextual enrichment. ManualLearning queries the code knowledge graph built by `OnlineLearning` and `CodeGraphConstruction` to attach relevant code artefacts to each manual entry. This creates a bidirectional link: manual artefacts reference code nodes, and code nodes can be traced back to the manual capture that introduced them.  

* **MCP‑Constraint‑Monitor** – Enforces execution order and semantic validity. The DAG configuration file is shared across the KnowledgeManagement domain, allowing ManualLearning to align its workflow with system‑wide constraints (e.g., “no snapshot may be finalized before its ontology tags are applied”).  

Because the parent component `KnowledgeManagement` already employs **work‑stealing concurrency** for data processing, ManualLearning inherits this pattern, ensuring consistent concurrency semantics across the system. Moreover, the shared logging format means that logs from ManualLearning appear alongside those from `EntityPersistence` and `UKBTraceReporting`, simplifying observability and debugging at the KnowledgeManagement level.

---

## Usage Guidelines  

1. **Always invoke the predefined hooks** – Developers should trigger manual‑learning actions via the Copi CLI (`copi start`, `copi capture`, `copi finish`) or by calling the corresponding hook functions (`onStartSession()`, etc.). Directly writing to the log store bypasses the ontology pre‑population step and can cause downstream LLM components to mis‑classify artefacts.  

2. **Respect the DAG order** – When extending the manual‑learning workflow, add new steps to the `constraint-configuration.md` DAG file and ensure that any new node’s dependencies are correctly expressed. The topological sort will enforce the order automatically; violating dependencies will result in runtime warnings from the semantic‑constraint detector.  

3. **Leverage the RAG API for enrichment** – If a manual capture would benefit from code context (e.g., linking a design note to a function), invoke the `graph.search()` or `graph.expand()` APIs during the “enrich artefact” step. This keeps the manual record tightly coupled to the code graph maintained by sibling components.  

4. **Do not modify the shared `nextIndex` counter** – The work‑stealing scheduler assumes exclusive control over `nextIndex`. Custom concurrency logic should be built on top of the provided worker loop rather than replacing it, to avoid race conditions and lost tasks.  

5. **Populate all mandatory ontology fields** – The quick‑reference file (`STATUS‑LINE‑QUICK‑REFERENCE.md`) enumerates required metadata. Missing fields will be flagged by the semantic‑constraint detector, potentially aborting the pipeline. Use the provided helper utilities (if any) to auto‑fill timestamps, session IDs, and confidence scores.  

6. **Monitor logs centrally** – Since ManualLearning’s logs share the same schema as `EntityPersistence` and `UKBTraceReporting`, use the KnowledgeManagement logging dashboard to trace end‑to‑end flows. Correlate tmux pane IDs with log entries to diagnose session‑level issues.  

Following these conventions ensures that manual learning artefacts are captured consistently, validated against system constraints, and enriched with the broader code knowledge graph.

---

### Architectural Patterns Identified  

1. **Work‑Stealing Concurrency** – shared `nextIndex` counter for dynamic load balancing.  
2. **DAG‑Based Execution with Topological Sort** – deterministic ordering of manual‑learning steps.  
3. **Logging + tmux Session Integration** – standardized observability and session management via Copi.  
4. **Hook‑Driven Workflow** – declarative mapping of CLI actions to internal functions.  
5. **Pre‑Populated Ontology Metadata** – reduces downstream LLM classification overhead.  
6. **Graph‑Based Retrieval‑Augmented Generation (RAG)** – contextual enrichment from the code knowledge graph.  

### Design Decisions and Trade‑offs  

* **Choosing work‑stealing over a central queue** simplifies implementation and improves scalability on heterogeneous workloads, but it assumes that tasks are roughly uniform; heavily imbalanced tasks could still lead to idle workers.  
* **Embedding ontology fields at log time** trades a slight increase in logging complexity for a large reduction in LLM inference latency. The downside is tighter coupling between the logging layer and the ontology schema.  
* **Using a DAG for step ordering** provides clear dependency management and deterministic runs, yet it introduces the need for careful maintenance of the configuration file whenever new steps are added.  
* **Relying on markdown documentation as the contract** keeps the system lightweight and easy to audit, but it places the burden of synchronizing documentation and implementation on developers.  

### System Structure Insights  

ManualLearning is a thin orchestration layer that stitches together three integration packages (Copi, Code‑Graph‑RAG, MCP‑Constraint‑Monitor) under the umbrella of the `KnowledgeManagement` parent. Its child component, **CopiIntegration**, encapsulates all low‑level interactions with the Copilot CLI, while the sibling components share the same logging and concurrency primitives. The overall system resembles a **modular integration hub**, where each integration contributes a focused capability (logging, graph query, constraint enforcement) that ManualLearning composes into a coherent manual‑learning pipeline.

### Scalability Considerations  

* **Concurrency** – The work‑stealing scheduler scales linearly with the number of worker threads up to the point where CPU or I/O becomes saturated. Because the tasks are primarily I/O‑bound (logging, RAG queries), adding more workers can improve throughput until the underlying storage or graph service becomes the bottleneck.  
* **DAG Complexity** – As the number of manual‑learning steps grows, the topological sort remains O(V + E) and thus scales well. However, a very deep DAG may increase latency between the start of a session and finalization, so designers should keep the DAG shallow where possible.  
* **RAG Queries** – Enrichment calls to the code graph are dependent on the performance of the `code-graph-rag` service. Caching frequently accessed sub‑graphs can mitigate latency spikes when many manual artefacts request similar context.  

### Maintainability Assessment  

The heavy reliance on **markdown‑based contracts** (README, hooks, configuration) makes the system highly readable and approachable for new developers; the documentation lives next to the code it describes. Because the actual source symbols are minimal or generated at runtime, the risk of drift between code and docs is low provided the build process respects the markdown sources.  

The **shared concurrency primitive** (`nextIndex`) and **common logging format** promote reuse across siblings, reducing duplication and easing cross‑component bug fixes. However, any change to the Copi hook signatures or ontology field list must be propagated to all consumers (ManualLearning, EntityPersistence, UKBTraceReporting), demanding coordinated releases.  

Overall, ManualLearning’s architecture balances **simplicity** (few moving parts, clear markdown contracts) with **extensibility** (plug‑in style hooks, DAG configuration). This yields a maintainable subsystem that can evolve alongside its parent KnowledgeManagement component without introducing unnecessary complexity.

## Diagrams

### Relationship

![ManualLearning Relationship](images/manual-learning-relationship.png)



## Architecture Diagrams

![relationship](../../.data/knowledge-graph/insights/images/manual-learning-relationship.png)


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component is responsible for managing the knowledge graph, which includes storing, querying, and updating entities and relationships. It utilizes a Graphology+LevelDB database for persistence and provides a JSON export sync feature. The component's architecture is designed to handle concurrent access and provides an intelligent routing mechanism for storing and retrieving data. Key patterns include the use of adapters for database interactions, lazy initialization of LLM (Large Language Model) providers, and work-stealing concurrency for efficient data processing.

### Children
- [CopiIntegration](./CopiIntegration.md) -- The integrations/copi/README.md file describes Copi as a GitHub Copilot CLI wrapper with logging and tmux integration, indicating its purpose in the ManualLearning sub-component.

### Siblings
- [OnlineLearning](./OnlineLearning.md) -- OnlineLearning uses integrations/code-graph-rag/README.md to construct and query the code knowledge graph
- [CodeGraphConstruction](./CodeGraphConstruction.md) -- CodeGraphConstruction uses integrations/code-graph-rag/README.md to construct and query the code knowledge graph
- [EntityPersistence](./EntityPersistence.md) -- EntityPersistence uses integrations/copi/README.md to handle logging and tmux integration for entity persistence
- [UKBTraceReporting](./UKBTraceReporting.md) -- UKBTraceReporting uses integrations/copi/README.md to handle logging and tmux integration for trace reporting
- [BrowserAccess](./BrowserAccess.md) -- BrowserAccess uses integrations/browser-access/README.md to handle browser access to the knowledge graph


---

*Generated from 7 observations*
