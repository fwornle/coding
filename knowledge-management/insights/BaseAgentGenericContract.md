# BaseAgentGenericContract

**Type:** Detail

Referenced explicitly in the Insights sub-component description and elaborated in `integrations/mcp-server-semantic-analysis/docs/architecture/agents.md`, `BaseAgent<TInput, TOutput>` uses TypeScript generics to enforce distinct data shapes at ingestion (`TInput`) and emission (`TOutput`) without coupling individual agents to a common payload schema.

## What It Is  

**BaseAgentGenericContract** is the core type‑level contract that underpins every Insight agent in the **Insights** sub‑system.  It lives in the documentation hierarchy of the semantic‑analysis integration, specifically referenced in `integrations/mcp-server-semantic-analysis/docs/architecture/agents.md`.  The contract is expressed as the generic class `BaseAgent<TInput, TOutput>` – a TypeScript abstraction that forces each concrete agent to declare the shape of the data it **ingests** (`TInput`) and the shape of the data it **emits** (`TOutput`).  Because the contract is generic, agents can be heterogeneous (e.g., call‑graph pattern detectors, dependency‑cluster discoverers, naming‑convention validators) while still being orchestrated by a single pipeline.  

A mandatory method, `generateRouting()`, is defined on `BaseAgent`.  The method does not issue hard routing commands; instead it returns **ConfidenceBasedRoutingHints** – a lightweight hint object that the downstream orchestration layer interprets to decide whether a pattern proceeds to the knowledge‑report authoring stage (high confidence) or is sent back for re‑analysis (low confidence).  This makes confidence‑driven routing a first‑class concern of every Insight agent rather than an optional add‑on.

---

## Architecture and Design  

The architecture around **BaseAgentGenericContract** follows a **generic‑type‑driven orchestration** pattern.  By parameterising the contract with `<TInput, TOutput>`, the system decouples the *payload schema* from the *execution engine*.  All agents share a common runtime interface (`BaseAgent`) but retain compile‑time safety for their specific data models.  This design enables a **single orchestration pipeline** (described in `integrations/mcp-server-semantic-analysis/docs/architecture/README.md`) to treat every agent uniformly: it can instantiate, invoke, and collect results without needing bespoke adapters for each payload shape.

The mandatory `generateRouting()` method introduces a **routing‑hint** pattern.  Rather than embedding routing logic inside the orchestrator, each agent contributes a confidence signal that is later aggregated.  The sibling component **ConfidenceBasedRoutingHints** formalises this signal, allowing the orchestrator to combine multiple hints (e.g., from different agents analysing the same artifact) before committing a pattern to the downstream **knowledge‑report authoring** stage.  This yields a **pipeline‑centric, confidence‑weighted decision model**.

Because the contract lives in the **Insights** parent component, all Insight agents inherit the same lifecycle expectations (initialisation, ingestion, emission, routing hint generation).  The sibling relationship with **ConfidenceBasedRoutingHints** ensures that any change to the hint schema propagates automatically to all agents, preserving contract consistency across the system.

---

## Implementation Details  

* **Class Signature** – `BaseAgent<TInput, TOutput>` is defined as a generic abstract class.  The two type parameters force concrete implementations to declare concrete interfaces for incoming data (`TInput`) and outgoing data (`TOutput`).  This eliminates the need for a universal payload envelope and prevents runtime type mismatches.

* **Mandatory Method** – `generateRouting(): ConfidenceBasedRoutingHints`.  The method is declared abstract on `BaseAgent`, so every subclass **must** implement it.  Implementations analyse the internal confidence metrics of the insight they have produced and return a hint object that typically contains:
  * a numeric confidence score,
  * a routing flag (e.g., `high`, `low`),
  * optional metadata (e.g., reason codes).

* **Interaction with Orchestrator** – The orchestration layer (documented in `integrations/mcp-server-semantic-analysis/docs/architecture/README.md`) treats each agent as a black box that:
  1. Receives a `TInput` payload,
  2. Executes its domain‑specific logic,
  3. Emits a `TOutput` payload,
  4. Calls `generateRouting()` to produce a hint.  
  The orchestrator aggregates hints from all agents that processed the same source artifact and makes a deterministic routing decision.

* **Extensibility** – Adding a new Insight agent requires only:
  1. Declaring a concrete class that extends `BaseAgent<NewInput, NewOutput>`,
  2. Implementing the core analysis logic,
  3. Providing a `generateRouting()` implementation that returns a `ConfidenceBasedRoutingHints` instance.  
  No changes to the orchestration code are required because the generic contract guarantees compatibility.

* **Documentation Anchor** – All of the above is described in the architectural docs located at:
  * `integrations/mcp-server-semantic-analysis/docs/architecture/agents.md` (contract definition and routing hint semantics),
  * `integrations/mcp-server-semantic-analysis/docs/architecture/README.md` (pipeline orchestration overview).

---

## Integration Points  

1. **Insights Parent Component** – `BaseAgentGenericContract` is the foundational interface for every Insight agent.  The parent component expects agents to conform to this contract, providing a uniform entry point for the semantic‑analysis server.

2. **ConfidenceBasedRoutingHints Sibling** – The contract’s `generateRouting()` method returns objects defined by the **ConfidenceBasedRoutingHints** contract.  This tight coupling ensures that any evolution of the hint schema is reflected across all agents automatically.

3. **Orchestration Layer** – The orchestration engine (see `integrations/mcp-server-semantic-analysis/docs/architecture/README.md`) consumes agents via the generic contract.  It supplies `TInput` data, collects `TOutput` results, and aggregates the routing hints to decide the next stage (e.g., forwarding to the **knowledge‑report authoring** subsystem or looping back for re‑analysis).

4. **Downstream Knowledge‑Report Authoring** – High‑confidence hints trigger the hand‑off to the report authoring stage.  The contract does not dictate the shape of the authoring payload; instead, the `TOutput` type of each agent can be mapped downstream as needed.

5. **Testing & Validation** – Because the contract is purely TypeScript‑based, static analysis tools (e.g., `tsc`, ESLint) can verify that every concrete agent respects the generic constraints and implements `generateRouting()`.  This reduces runtime integration defects.

---

## Usage Guidelines  

* **Always Extend the Generic Base** – When creating a new Insight agent, extend `BaseAgent<TInput, TOutput>` with concrete type arguments that precisely describe the data you will consume and produce.  Do not fall back to `any` or loosely typed interfaces; doing so defeats the purpose of the contract’s strong typing.

* **Implement `generateRouting()` Thoughtfully** – The routing hint should reflect the true confidence of the insight.  Over‑inflating confidence scores can cause low‑<USER_ID_REDACTED> patterns to reach the knowledge‑report authoring stage, while under‑rating may lead to unnecessary re‑analysis cycles.  Follow the guidelines in `agents.md` for the expected hint shape and scoring conventions.

* **Keep Routing Logic Stateless** – `generateRouting()` should base its decision solely on the result of the current analysis run.  Persisting state across invocations can lead to non‑deterministic routing when the orchestrator aggregates hints from multiple agents.

* **Leverage Type Safety in the Pipeline** – The orchestration layer expects the generic contract; therefore, any mismatch between declared `TInput`/`TOutput` and the actual data passed will surface at compile time.  Use this to catch integration bugs early.

* **Document New Types** – When introducing new `TInput` or `TOutput` interfaces, add them to the project’s type definition files and reference them in the architectural docs.  This keeps the contract’s public surface up‑to‑date for future contributors.

---

### Architectural Patterns Identified  

1. **Generic‑Type‑Driven Contract** – `BaseAgent<TInput, TOutput>` enforces compile‑time data shape separation.  
2. **Routing‑Hint Pattern** – `generateRouting()` returns confidence hints rather than hard directives, enabling flexible downstream decision making.  
3. **Pipeline Orchestration** – A single orchestrator processes heterogeneous agents uniformly, aggregating hints before routing.

### Design Decisions & Trade‑offs  

| Decision | Rationale | Trade‑off |
|----------|-----------|-----------|
| Use TypeScript generics for payload separation | Strong static typing, no need for a universal envelope | Slightly higher cognitive load for developers to define precise types |
| Make routing hints mandatory via `generateRouting()` | Guarantees every agent contributes confidence data, simplifying orchestration | Forces agents to implement hint logic even when confidence is trivial (e.g., always high) |
| Aggregate hints downstream rather than routing inside agents | Centralises decision logic, allows multi‑agent consensus | Adds a coordination step that must handle conflicting hints |

### System Structure Insights  

* **Insights** is the parent domain that owns the contract.  
* **BaseAgentGenericContract** is the abstract generic base class.  
* **ConfidenceBasedRoutingHints** is a sibling contract that defines the shape of routing hints.  
* Concrete agents are children of the contract, each providing domain‑specific `TInput`/`TOutput` and a `generateRouting()` implementation.  
* The orchestration layer sits above the agents, treating them as interchangeable processing blocks.

### Scalability Considerations  

* **Horizontal Scaling** – Because agents are stateless (aside from their internal analysis), the orchestrator can instantiate multiple agent workers in parallel, each handling a slice of the incoming workload.  
* **Type‑Safety at Scale** – The generic contract ensures that adding new agents does not require changes to the orchestrator, preserving compile‑time safety even as the number of agents grows.  
* **Routing Hint Aggregation** – The hint‑based approach scales well: the orchestrator simply merges numeric scores or applies a policy (e.g., majority vote) without needing bespoke routing tables per agent type.

### Maintainability Assessment  

* **High** – The separation of concerns (analysis logic vs. routing hint) and the use of TypeScript generics create clear boundaries that are easy to reason about.  
* **Documentation‑Driven** – All contract expectations are captured in the architecture markdown files, providing a single source of truth for new contributors.  
* **Extensible** – Adding new insight types requires only a new subclass; no orchestration code changes are needed, reducing regression risk.  
* **Potential Pitfalls** – Over‑reliance on the hint mechanism may lead to “hint fatigue” if too many low‑confidence signals are generated; developers must calibrate confidence scoring to keep the downstream pipeline efficient.


## Hierarchy Context

### Parent
- [Insights](./Insights.md) -- Insight agents implement BaseAgent<TInput, TOutput> with generateRouting() hints that direct high-confidence patterns to the knowledge report authoring stage and low-confidence ones back for re-analysis

### Siblings
- [ConfidenceBasedRoutingHints](./ConfidenceBasedRoutingHints.md) -- As described in the Insights sub-component contract and documented under `integrations/mcp-server-semantic-analysis/docs/architecture/agents.md`, `generateRouting()` returns hints rather than hard directives, allowing downstream orchestration to aggregate multiple signals before committing a pattern to the report authoring stage.


---

*Generated from 3 observations*
