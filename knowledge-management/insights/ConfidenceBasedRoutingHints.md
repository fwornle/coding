# ConfidenceBasedRoutingHints

**Type:** Detail

As described in the Insights sub-component contract and documented under `integrations/mcp-server-semantic-analysis/docs/architecture/agents.md`, `generateRouting()` returns hints rather than hard directives, allowing downstream orchestration to aggregate multiple signals before committing a pattern to the report authoring stage.

## What It Is  

**ConfidenceBasedRoutingHints** is the routing‑signal mechanism used by Insight agents to steer the flow of extracted patterns through the **SemanticAnalysis** pipeline. The contract for this mechanism lives in the documentation under  

```
integrations/mcp-server-semantic-analysis/docs/architecture/agents.md
```  

where the `generateRouting()` method of each `BaseAgent<TInput,TOutput>` is described. Rather than issuing a hard decision, `generateRouting()` produces a **hint** that encodes the confidence level of the agent’s output. High‑confidence hints direct the pattern straight to the **knowledge‑report authoring** stage, while low‑confidence hints feed the pattern back into the SemanticAnalysis pipeline for another pass. The hints therefore act as a lightweight, declarative signal that downstream consumers interpret to decide the next processing step.

The design purposefully keeps the agents themselves stateless with respect to pipeline topology; they only focus on pattern extraction and confidence estimation. The routing decision is deferred to the consumer of the hint, which aggregates signals from multiple agents before committing any pattern to the report‑authoring phase.

---

## Architecture and Design  

The architecture follows a **dual‑path, feedback‑loop** model. Every Insight agent produces two possible routing outcomes:  

1. **Forward path** – when confidence is high, the hint routes the output directly to the report authoring component.  
2. **Feedback path** – when confidence is low, the hint routes the output back into the **SemanticAnalysis** pipeline for re‑analysis, possibly by a different agent or a later iteration of the same agent.

This creates an **iterative refinement loop** that continuously improves ambiguous patterns without discarding them. The loop is not a hard filter; it is a soft, confidence‑based signal that allows multiple agents to contribute their assessments before a final decision is made.

The separation of concerns is explicit: the **agent** (implementing `BaseAgent<TInput,TOutput>`) is responsible solely for **pattern extraction** and **confidence scoring**, while the **routing hint consumer** (the downstream orchestrator) owns **pipeline flow control**. By encoding confidence as a routing hint rather than a binary filter, the system avoids coupling the extraction logic to the orchestration logic, which enhances modularity and testability.

The generic contract `BaseAgent<TInput,TOutput>`—also described in `agents.md`—enforces a clear type boundary between the data an agent receives (`TInput`) and the data it emits (`TOutput`). This generic typing ensures that each agent can define its own payload shape without being forced into a monolithic schema, supporting extensibility as new agents are added.

---

## Implementation Details  

The core of the mechanism is the `generateRouting()` method defined on every concrete Insight agent that extends `BaseAgent<TInput,TOutput>`. Although no source code is present in the observations, the contract specifies that `generateRouting()` returns a **routing hint** object rather than a direct command. The hint contains at least:

* a **confidence score** (implicitly used to decide the path), and  
* a **target identifier** indicating whether the next stage is the **authoring** pipeline or the **re‑analysis** pipeline.

Because agents are stateless with respect to routing, `generateRouting()` does not maintain any internal queue or state about previous passes; it simply evaluates the current `TOutput` and emits the appropriate hint. The downstream orchestrator aggregates hints from potentially many agents, applies a policy (e.g., “if any hint is high‑confidence, proceed to authoring”), and then routes the payload accordingly.

The generic base contract, `BaseAgent<TInput,TOutput>`, is defined in the same documentation set and uses TypeScript generics to guarantee compile‑time safety. This contract abstracts away the concrete payload types, allowing agents that operate on different domains (e.g., lexical patterns vs. semantic clusters) to coexist under a unified interface while still providing the `generateRouting()` hook.

---

## Integration Points  

**ConfidenceBasedRoutingHints** sits at the intersection of three major subsystems:

1. **Insight agents** – each agent implements `BaseAgent<TInput,TOutput>` and produces a routing hint via `generateRouting()`.  
2. **SemanticAnalysis pipeline** – low‑confidence hints are fed back into this pipeline, enabling additional passes or alternative agents to re‑process the same data.  
3. **Knowledge‑report authoring stage** – high‑confidence hints are consumed here, where the pattern is incorporated into the final report.

The orchestration layer that consumes the hints must understand the hint schema (confidence value, target identifier) and implement the aggregation logic. Because the hint is a plain data object, integration can be achieved through simple message passing, event emission, or function callbacks, without requiring a tightly coupled API.

The generic nature of `BaseAgent<TInput,TOutput>` also means that new agents can be introduced without changing the routing infrastructure; they only need to conform to the contract and emit appropriate hints. This decoupling makes the routing mechanism a **plug‑in point** for future extensions.

---

## Usage Guidelines  

* **Emit clear confidence signals** – agents should calculate confidence in a deterministic way and map it to the hint schema consistently (e.g., using a numeric range 0‑1). Ambiguous or undocumented confidence scales can break downstream aggregation.  
* **Treat hints as advisory, not authoritative** – the orchestrator must aggregate hints from all active agents before deciding the final path. Relying on a single hint defeats the purpose of the dual‑path design.  
* **Keep agents stateless regarding routing** – avoid persisting routing decisions inside the agent; let `generateRouting()` be a pure function of the current output. This preserves the separation of concerns highlighted in the architecture.  
* **Leverage the generic contract** – when adding a new Insight agent, extend `BaseAgent<TInput,TOutput>` with the appropriate type parameters and implement `generateRouting()`. Do not attempt to bypass the contract, as doing so would introduce coupling to the routing logic.  
* **Monitor the feedback loop** – because low‑confidence outputs re‑enter the SemanticAnalysis pipeline, ensure that there are termination safeguards (e.g., maximum iteration count) at the orchestration level to prevent infinite loops.

---

### Architectural Patterns Identified  

* **Dual‑Path Feedback Loop** – high‑confidence forward path vs. low‑confidence re‑analysis path.  
* **Separation of Concerns** – extraction (agents) vs. flow control (routing hint consumer).  
* **Generic Contract (Strategy‑like)** – `BaseAgent<TInput,TOutput>` provides a pluggable strategy for pattern extraction while keeping routing independent.  

### Design Decisions & Trade‑offs  

* **Confidence‑as‑Hint vs. Filter** – choosing hints preserves ambiguous data for later refinement, at the cost of added orchestration complexity.  
* **Stateless Agents** – improves testability and scalability, but requires the orchestrator to maintain any state needed for loop termination.  
* **TypeScript Generics** – enforce compile‑time safety and extensibility, though they add a learning curve for developers unfamiliar with generic constraints.  

### System Structure Insights  

The system is layered: **Agents → Routing Hints → Orchestrator → Pipeline Stages**. The routing hint is the sole contract between the agent layer and the orchestrator, enabling independent evolution of each side.

### Scalability Considerations  

Because agents are stateless and communicate only through lightweight hints, the architecture scales horizontally; additional agents can be deployed in parallel without affecting routing logic. The feedback loop can be parallelized as long as the orchestrator correctly aggregates hints from concurrent agents.

### Maintainability Assessment  

The clear separation between extraction and flow control, combined with the generic `BaseAgent` contract, yields high maintainability. Adding or modifying agents does not ripple into the routing infrastructure. The only maintenance hotspot is the orchestrator’s aggregation policy, which must stay in sync with any changes to the hint schema or confidence semantics. Regular documentation updates in `agents.md` are essential to keep the contract visible to contributors.


## Hierarchy Context

### Parent
- [Insights](./Insights.md) -- Insight agents implement BaseAgent<TInput, TOutput> with generateRouting() hints that direct high-confidence patterns to the knowledge report authoring stage and low-confidence ones back for re-analysis

### Siblings
- [BaseAgentGenericContract](./BaseAgentGenericContract.md) -- Referenced explicitly in the Insights sub-component description and elaborated in `integrations/mcp-server-semantic-analysis/docs/architecture/agents.md`, `BaseAgent<TInput, TOutput>` uses TypeScript generics to enforce distinct data shapes at ingestion (`TInput`) and emission (`TOutput`) without coupling individual agents to a common payload schema.


---

*Generated from 3 observations*
