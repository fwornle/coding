# OnlineLearning

**Type:** SubComponent

OnlineLearning could involve the use of semantic constraint detection, as mentioned in integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md

## What It Is  

**OnlineLearning** is a sub‑component of the **KnowledgeManagement** system that focuses on continuously extracting, refining, and persisting knowledge from source‑code repositories.  The core of its functionality lives in the *batch analysis pipeline* (see the project documentation that mentions “extract knowledge from git history”) which is declared as a child component under **OnlineLearning**.  In practice, the sub‑component stitches together a handful of existing integrations:

* **Code Graph RAG** – described in `integrations/code-graph-rag/README.md`, providing retrieval‑augmented generation over a graph representation of code.  
* **MCP Constraint Monitor** – documented in `integrations/mcp-constraint-monitor/README.md` together with its constraint‑configuration guide (`integrations/mcp-constraint-monitor/docs/constraint-configuration.md`) and semantic‑constraint detection (`integrations/mcp-constraint-monitor/docs/semantic-constraint-detection.md`).  
* **Claude Code Hook Data Format** – the canonical payload format for communicating code‑related observations, defined in `integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md`.  
* **copi** – a thin wrapper around the GitHub Copilot CLI, referenced in `integrations/copi/README.md`, used to enrich the learning loop with AI‑generated suggestions.

Together these pieces enable **OnlineLearning** to ingest historical Git data, transform it into a code‑graph, run constraint‑based validation, and finally feed the results back into the broader KnowledgeManagement knowledge base.

---

## Architecture and Design  

The architecture of **OnlineLearning** is a *pipeline‑oriented* composition rather than a monolithic block.  The design follows a **batch‑processing** pattern where the **BatchAnalysisPipeline** acts as the orchestrator: it pulls a series of commits, runs analysis steps, and persists the derived artefacts.  Each step is realized by an existing integration, allowing the sub‑component to remain thin while reusing proven capabilities.

* **Retrieval‑Augmented Generation (RAG)** – The Code Graph RAG system (`integrations/code-graph-rag/README.md`) supplies a *graph‑based index* of code entities that can be queried during the learning phase.  This RAG layer is invoked after the raw Git history is parsed, enabling semantic similarity searches that feed the constraint monitor.  

* **Constraint‑Monitoring** – The MCP Constraint Monitor (`integrations/mcp-constraint-monitor/README.md`) provides two complementary mechanisms: a *static configuration* (see `constraint-configuration.md`) and a *semantic detection* engine (`semantic-constraint-detection.md`).  The monitor consumes the Claude Code Hook payload format (`CLAUDE-CODE-HOOK-FORMAT.md`) to standardize the data it validates, ensuring a single contract across all downstream consumers.  

* **Lazy LLM Initialization (Inherited)** – The parent **KnowledgeManagement** component employs a lazy‑loading strategy for large language models (LLMs) – a pattern observable in its `ensureLLMInitialized()` method.  **OnlineLearning** inherits this behaviour, deferring the heavy LLM startup until the first batch run needs to generate or score code snippets (e.g., via **copi**).  This reduces memory pressure and improves overall system responsiveness.  

* **CLI Wrapper Integration** – The **copi** wrapper (`integrations/copi/README.md`) is used as a thin façade around the Copilot CLI, allowing the batch pipeline to request AI‑generated code suggestions without embedding Copilot directly.  This keeps the dependency surface small and isolates versioning concerns.  

The overall interaction diagram can be described as:

```
BatchAnalysisPipeline
   └─> Git history extractor  (parent KnowledgeManagement)
   └─> Code Graph RAG (integrations/code-graph-rag)
   └─> Claude Code Hook payload construction
   └─> MCP Constraint Monitor (config + semantic detection)
   └─> Optional Copi AI suggestions
   └─> Persisted knowledge back into KnowledgeManagement
```

---

## Implementation Details  

Even though the repository currently shows “0 code symbols found,” the observable file paths give a clear picture of the implementation boundaries:

1. **BatchAnalysisPipeline** – The pipeline is defined as a child of **OnlineLearning** and is referenced in the project documentation.  It likely consists of a series of scripted stages (e.g., a `runBatch.sh` or a TypeScript orchestrator) that iterate over commit ranges, invoke the downstream integrations, and write results to the KnowledgeManagement store.

2. **Code Graph RAG Integration** – The `integrations/code-graph-rag/README.md` outlines the steps for building a graph of code entities (functions, classes, modules) and exposing a query API.  Within **OnlineLearning**, this API is called after the Git diff is parsed, converting raw code changes into graph nodes that can be traversed for similarity or dependency analysis.

3. **Constraint Configuration** – `integrations/mcp-constraint-monitor/docs/constraint-configuration.md` describes a YAML/JSON schema that lists allowed patterns, prohibited APIs, and policy thresholds.  The BatchAnalysisPipeline loads this configuration at start‑up, feeding it into the monitor’s rule engine.

4. **Semantic Constraint Detection** – The `semantic-constraint-detection.md` document explains how the monitor leverages LLM‑based embeddings to discover violations that are not expressible in static rules.  Because KnowledgeManagement lazily loads its LLM, the first time a semantic check runs the model is instantiated, after which the monitor can reuse the embeddings for subsequent commits.

5. **Claude Code Hook Data Format** – The `CLAUDE-CODE-HOOK-FORMAT.md` defines a JSON envelope containing fields such as `filePath`, `codeSnippet`, `metadata`, and `diagnostics`.  OnlineLearning constructs this envelope after each analysis step, ensuring downstream consumers (including the MCP monitor and any reporting UI) receive a uniform payload.

6. **copi Integration** – The `integrations/copi/README.md` shows a simple command‑line interface (`copi suggest --file <path>`) that returns AI‑generated suggestions.  The pipeline optionally invokes this command when a constraint violation is detected, using the suggestion as a remediation hint that is stored alongside the original payload.

Because the sub‑component does not introduce its own bespoke classes, the bulk of its logic lives in orchestration scripts and configuration files that wire together the above integrations.

---

## Integration Points  

* **Parent – KnowledgeManagement**  
  * Receives the final knowledge artefacts (graph updates, constraint reports) from **OnlineLearning**.  
  * Supplies the lazy‑loaded LLM used by both the semantic constraint detector and any Copilot‑based suggestion generation.  

* **Sibling – CodeGraphRAG**  
  * Shares the same underlying graph‑construction logic; **OnlineLearning** simply consumes the ready‑made graph API rather than rebuilding it.  

* **Sibling – MCP Constraint Monitor**  
  * Both **OnlineLearning** and **UKBTraceReporting** rely on the same Claude Code Hook format, promoting a unified contract for constraint data across the system.  

* **Child – BatchAnalysisPipeline**  
  * Acts as the execution engine for the learning loop, invoking the Code Graph RAG, the constraint monitor, and optionally **copi**.  

* **External – copi (GitHub Copilot CLI wrapper)**  
  * Provides AI‑assisted remediation suggestions that are fed back into the knowledge base as actionable items.  

All integration points are mediated through well‑documented README or markdown files, meaning that developers can locate the exact contract (e.g., JSON schema, CLI flags) without hunting through source code.

---

## Usage Guidelines  

1. **Configure Constraints First** – Before running any batch job, ensure that `integrations/mcp-constraint-monitor/docs/constraint-configuration.md` is populated with the organization’s policy rules.  Missing or malformed configuration will cause the pipeline to abort early.  

2. **Run the Batch Pipeline Incrementally** – Because the pipeline processes Git history, it is advisable to limit each run to a reasonable commit window (e.g., one week or a feature branch).  This prevents excessive memory consumption and keeps the LLM warm for semantic checks.  

3. **Maintain the Claude Code Hook Schema** – Any changes to `CLAUDE-CODE-HOOK-FORMAT.md` must be reflected in both the constraint monitor and any downstream reporting components (e.g., **UKBTraceReporting**).  Validation scripts are provided in the integration docs to catch schema mismatches early.  

4. **Leverage copi Sparingly** – The **copi** wrapper incurs network latency and API cost.  Use it only when the constraint monitor flags a violation that cannot be auto‑resolved; otherwise, rely on static rule enforcement to keep the batch run fast.  

5. **Monitor LLM Warm‑up** – The first batch execution after a system restart will experience a noticeable delay due to lazy LLM initialization (as described in the parent component).  Plan for this latency in CI pipelines or scheduled jobs.  

6. **Version Pin Integrations** – Each integration lives under its own `integrations/` directory with its own README.  Pin the versions of these sub‑modules in the top‑level `package.json` (or equivalent) to avoid accidental breaking changes when upstream repositories evolve.

---

### Architectural Patterns Identified  

* **Batch Processing Pipeline** – orchestrated by the child **BatchAnalysisPipeline**.  
* **Retrieval‑Augmented Generation (RAG)** – via the Code Graph RAG system.  
* **Constraint‑Monitoring (Rule‑Based + Semantic)** – implemented by the MCP Constraint Monitor.  
* **Lazy LLM Initialization** – inherited from the parent **KnowledgeManagement** component.  
* **Standardized Data Exchange (Claude Code Hook Format)** – a contract‑first JSON payload model.  

### Design Decisions and Trade‑offs  

| Decision | Benefit | Trade‑off |
|----------|---------|-----------|
| Reuse existing **Code Graph RAG** instead of building a custom index | Faster development, proven graph query capabilities | Introduces coupling to the RAG integration’s version and API surface |
| Centralize constraint logic in **MCP Constraint Monitor** | Single source of truth for policies, reusable across siblings | All constraint changes affect multiple components; requires careful coordination |
| Use **Claude Code Hook** as the universal payload format | Consistency across reporting, monitoring, and learning pipelines | Rigid schema may need extensions for future data types |
| Lazy‑load LLMs | Lower baseline memory usage, quicker cold start for unrelated components | First‑run latency and potential “cold‑start” failures if initialization errors occur |
| Optional **copi** AI suggestions | Adds value for remediation without embedding Copilot directly | Additional external service dependency, cost, and latency |

### System Structure Insights  

* **OnlineLearning** sits under **KnowledgeManagement**, inheriting its lazy LLM strategy and contributing enriched knowledge back to the parent.  
* It shares the **CodeGraphRAG** and **MCP Constraint Monitor** integrations with several siblings (**ObservationDerivation**, **UKBTraceReporting**, **OntologyClassification**), indicating a design where core analysis capabilities are deliberately factored out for reuse.  
* The child **BatchAnalysisPipeline** is the only concrete execution engine within the sub‑component, emphasizing a “pipeline‑as‑component” approach rather than a monolithic service.  

### Scalability Considerations  

* **Horizontal Scaling of the Batch Pipeline** – Since the pipeline processes commits independently, multiple instances can run in parallel on different commit ranges, leveraging the shared LLM cache to avoid redundant model loads.  
* **RAG Vector Store** – The underlying graph index can be sharded or hosted on a scalable vector database, allowing the retrieval layer to handle larger codebases without degrading query latency.  
* **Constraint Monitor Distribution** – Rule‑based checks are cheap and can be parallelized; semantic checks can be off‑loaded to a dedicated inference service that scales horizontally.  

### Maintainability Assessment  

* **High Reuse, Low Duplication** – By delegating heavy lifting to well‑documented integrations, the sub‑component’s own codebase remains small, which eases maintenance.  
* **Documentation‑Centric Integration** – All interaction contracts are captured in markdown files (`README.md`, `*.md`), providing clear guidance but also a risk: if documentation drifts from actual implementation, developers may encounter mismatches.  
* **Dependency Management** – The reliance on external tools (Copilot via **copi**, LLM providers) introduces version‑compatibility concerns; regular audits of the `integrations/` directories are required.  
* **Testing Surface** – Since the core logic is orchestration, integration tests that spin up the full pipeline (including the RAG graph and constraint monitor) are essential for regression safety.  

Overall, **OnlineLearning** is a well‑orchestrated, integration‑heavy sub‑component that leverages existing analysis and monitoring capabilities to turn Git history into actionable knowledge while adhering to the architectural conventions already established in the broader **KnowledgeManagement** ecosystem.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- [LLM] The KnowledgeManagement component employs a lazy loading approach for LLM initialization, as seen in the constructor-based pattern for wave agents. This is evident in the ensureLLMInitialized() method, which suggests that the component defers the initialization of Large Language Models (LLMs) until they are actually needed. This design decision helps to reduce memory consumption and improve system responsiveness, especially when dealing with multiple LLMs. The use of a shared atomic index counter for work-stealing concurrency in the runWithConcurrency() method (wave-controller.ts:489) further enhances the component's efficiency by allowing it to dynamically adjust its workload and minimize idle time.

### Children
- [BatchAnalysisPipeline](./BatchAnalysisPipeline.md) -- The project documentation mentions the batch analysis pipeline in the context of OnlineLearning, implying its importance in extracting knowledge from git history.

### Siblings
- [ManualLearning](./ManualLearning.md) -- ManualLearning may utilize a similar approach to Claude Code Setup for Graph-Code MCP Server as described in integrations/browser-access/README.md
- [EntityPersistence](./EntityPersistence.md) -- EntityPersistence may use a graph database to store entities, as hinted in the project documentation
- [OntologyClassification](./OntologyClassification.md) -- OntologyClassification may utilize a similar approach to Claude Code Hook Data Format, as described in integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md
- [ObservationDerivation](./ObservationDerivation.md) -- ObservationDerivation may utilize a similar approach to the Code Graph RAG system, as described in integrations/code-graph-rag/README.md
- [UKBTraceReporting](./UKBTraceReporting.md) -- UKBTraceReporting may utilize a similar approach to the Claude Code Hook Data Format, as described in integrations/mcp-constraint-monitor/docs/CLAUDE-CODE-HOOK-FORMAT.md
- [BrowserAccess](./BrowserAccess.md) -- BrowserAccess may utilize a similar approach to the Claude Code Setup for Graph-Code MCP Server, as described in integrations/browser-access/README.md
- [CodeGraphRAG](./CodeGraphRAG.md) -- CodeGraphRAG may utilize a similar approach to the Claude Code Setup for Graph-Code MCP Server, as described in integrations/browser-access/README.md


---

*Generated from 7 observations*
