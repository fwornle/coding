# BudgetTracker

**Type:** SubComponent

The LLMService class (lib/llm/llm-service.ts) serves as the main entry point for all LLM operations, routing requests to the appropriate provider based on the registry, and is utilized by the BudgetTracker to monitor usage costs.

## What It Is  

**BudgetTracker** is a sub‑component of the **LLMAbstraction** layer that is responsible for observing and accounting for the monetary cost of Large Language Model (LLM) calls.  The implementation lives alongside the core LLM plumbing – it draws on the provider registry defined in `lib/llm/provider-registry.js` and the request‑routing façade in `lib/llm/llm-service.ts`.  By consulting the concrete provider classes – `lib/llm/providers/anthropic-provider.ts` and `lib/llm/providers/dmr-provider.ts` – BudgetTracker can attribute usage to the correct vendor and compute the associated expense.  Supporting documentation such as `integrations/copi/USAGE.md`, `integrations/mcp-constraint-monitor/docs/constraint-configuration.md`, and `integrations/code-graph-rag/README.md` provides the operational context for how the tracker should be configured, constrained, and optionally linked to the Code‑Graph RAG system.  A runtime constant named **MEMGRAPH_BATCH_SIZE** (referenced in the project documentation) is used to batch cost‑recording operations, reducing overhead when many LLM calls occur in rapid succession.

---

## Architecture and Design  

The overall design of BudgetTracker follows the **provider‑agnostic registry pattern** already established by its parent component **LLMAbstraction**.  The `lib/llm/provider-registry.js` file acts as a central catalogue where each concrete LLM provider registers itself (e.g., `AnthropicProvider`, `DMRProvider`).  This registry enables **decoupling**: BudgetTracker never hard‑codes a specific vendor; instead, it queries the registry to discover which provider serviced a given request and extracts the pricing metadata that each provider exposes.

BudgetTracker sits on top of the **service façade** embodied by `lib/llm/llm-service.ts`.  The `LLMService` class is the single entry point for all LLM operations; it receives a request, looks up the appropriate provider in the registry, forwards the call, and returns the response.  BudgetTracker hooks into this flow—either by listening to the service’s internal events or by wrapping the service calls—to capture usage data (request count, token count, etc.) and map it to cost using the provider‑specific pricing rules.

Configuration‑driven constraints are introduced through the documentation in `integrations/mcp-constraint-monitor/docs/constraint-configuration.md`.  These files suggest that BudgetTracker can be instructed, via external YAML/JSON files, to enforce budget caps, alert thresholds, or throttling policies.  The design therefore blends **registry‑based routing**, **service façade**, and **configuration‑driven policy enforcement** to provide a flexible cost‑monitoring layer without altering the core LLM request path.

---

## Implementation Details  

1. **Provider Registry (`lib/llm/provider-registry.js`)**  
   - Exposes an object (or Map) keyed by provider identifier.  
   - Each provider module (`anthropic-provider.ts`, `dmr-provider.ts`) registers itself during module initialization.  
   - The registry supplies both the concrete provider instance and any static pricing data (e.g., per‑token cost).

2. **LLM Service (`lib/llm/llm-service.ts`)**  
   - Implements a `callModel(request)` method that resolves the correct provider via the registry, forwards the request, and returns the model’s response.  
   - Provides hooks or emits events (e.g., `onRequestComplete`) that BudgetTracker can subscribe to for cost capture.

3. **BudgetTracker Logic**  
   - Subscribes to the LLMService’s request lifecycle. When a request finishes, it extracts: provider ID, token usage, and any other usage metrics.  
   - Looks up the provider’s pricing information from the registry and computes a monetary value (`cost = tokens * pricePerToken`).  
   - Aggregates costs in memory and periodically flushes them using the **MEMGRAPH_BATCH_SIZE** threshold, thereby reducing write amplification to any persistent store (e.g., a graph database referenced by the “code‑graph‑rag” integration).  

4. **Configuration & Constraints**  
   - Reads constraint definitions from `integrations/mcp-constraint-monitor/docs/constraint-configuration.md`. These definitions may include maximum daily spend, per‑provider caps, or alert levels.  
   - Enforces constraints by comparing the running total (maintained by BudgetTracker) against the configured limits, emitting warnings or aborting further LLM calls when thresholds are crossed.

5. **Documentation‑Driven Guidance**  
   - `integrations/copi/USAGE.md` outlines best‑practice usage patterns (e.g., always invoke the tracker before a model call, log the returned cost).  
   - `integrations/code-graph-rag/README.md` explains how to forward aggregated cost data into the Code‑Graph RAG system for downstream analytics, which BudgetTracker can optionally invoke after each batch flush.

---

## Integration Points  

- **Parent Component – LLMAbstraction**: BudgetTracker is a child of LLMAbstraction, inheriting the provider‑agnostic foundation.  It relies on the same registry and service façade that the rest of the abstraction uses, ensuring consistent provider handling across the system.  

- **Sibling Components – ProviderRegistry & LLMService**: BudgetTracker directly consumes the public APIs of `ProviderRegistry` (to obtain pricing data) and `LLMService` (to intercept request lifecycle events).  No circular dependencies exist because BudgetTracker only reads from the registry and observes service events; it does not modify provider implementations.  

- **External Documentation & Config Files**: The usage guide (`integrations/copi/USAGE.md`) and constraint configuration (`integrations/mcp-constraint-monitor/docs/constraint-configuration.md`) are treated as runtime inputs.  Changing these files alters BudgetTracker’s behavior without code changes, supporting a configuration‑first integration style.  

- **Code‑Graph RAG System**: When the batch size defined by **MEMGRAPH_BATCH_SIZE** is reached, BudgetTracker may invoke the integration described in `integrations/code-graph-rag/README.md` to push cost records into a graph database, enabling query‑able cost analytics.  

- **Environment / Global Constants**: The constant **MEMGRAPH_BATCH_SIZE** (documented elsewhere) determines the granularity of batch writes, acting as a tuning knob for performance versus freshness of cost data.

---

## Usage Guidelines  

1. **Always route LLM calls through `LLMService`** – BudgetTracker’s cost capture hooks are attached to this façade.  Bypassing the service will result in untracked expenses.  

2. **Register new providers correctly** – When adding a new LLM vendor, ensure its class (e.g., `MyNewProvider`) registers itself in `lib/llm/provider-registry.js` and supplies accurate pricing metadata.  BudgetTracker will automatically begin tracking its usage.  

3. **Configure constraints explicitly** – Populate the constraint file referenced in `integrations/mcp-constraint-monitor/docs/constraint-configuration.md` with realistic budget limits.  BudgetTracker will enforce these limits at runtime and emit warnings as defined.  

4. **Respect the batch size** – The `MEMGRAPH_BATCH_SIZE` constant should be tuned based on expected request volume.  A too‑small value can increase I/O overhead; a too‑large value may delay cost visibility.  

5. **Leverage documentation** – Consult `integrations/copi/USAGE.md` for recommended logging practices and `integrations/code-graph-rag/README.md` if you need to forward cost data to the Code‑Graph RAG analytics pipeline.  

---

### Architectural Patterns Identified  

1. **Provider Registry Pattern** – Centralized catalog of interchangeable LLM providers (`lib/llm/provider-registry.js`).  
2. **Service Façade / Router** – `LLMService` abstracts request routing and provides a single entry point.  
3. **Observer / Event Hook** – BudgetTracker observes LLMService request completion to capture usage.  
4. **Configuration‑Driven Constraints** – External YAML/JSON files drive budget caps and alerts.  

### Design Decisions and Trade‑offs  

- **Decoupling vs. Overhead**: Using a registry and façade isolates BudgetTracker from provider specifics, simplifying future extensions. The trade‑off is the added indirection and the need for providers to expose pricing data.  
- **Batching (MEMGRAPH_BATCH_SIZE)**: Improves write performance and reduces load on downstream storage but introduces latency in cost visibility.  
- **Configuration‑First Constraints**: Allows ops teams to adjust budgets without code changes, but places reliance on correct documentation and file placement.  

### System Structure Insights  

- The **LLMAbstraction** component forms the architectural spine, with **ProviderRegistry** and **LLMService** as sibling modules that expose stable interfaces.  
- **BudgetTracker** sits as a thin, observatory layer that consumes these interfaces, aggregates data, and optionally pushes it to analytics (Code‑Graph RAG).  
- All cost‑related logic is centralized, avoiding scattered accounting code throughout the codebase.  

### Scalability Considerations  

- **Provider‑agnostic registry** enables horizontal scaling: new providers can be added without re‑architecting the tracker.  
- **Batch processing** via MEMGRAPH_BATCH_SIZE reduces per‑request overhead, allowing the system to handle high request rates.  
- If request volume grows dramatically, the batch size and downstream graph ingestion pipeline may need to be tuned or sharded.  

### Maintainability Assessment  

- **High maintainability**: The clear separation of concerns (registry, service, tracker) means changes in one area have minimal ripple effects.  
- Adding or deprecating providers requires only registry updates and pricing metadata adjustments.  
- Constraint policies are externalized, so budget policy changes do not require code modifications.  
- Documentation files (`USAGE.md`, `constraint-configuration.md`, `README.md`) serve as the single source of truth for operational behavior, reinforcing maintainability as long as they stay in sync with code.  

Overall, BudgetTracker leverages the existing provider‑registry and service façade infrastructure of LLMAbstraction to provide a robust, configurable, and extensible cost‑monitoring capability that can evolve alongside the underlying LLM ecosystem.

## Diagrams

### Relationship

![BudgetTracker Relationship](images/budget-tracker-relationship.png)



## Architecture Diagrams

![relationship](../../.data/knowledge-graph/insights/images/budget-tracker-relationship.png)


## Hierarchy Context

### Parent
- [LLMAbstraction](./LLMAbstraction.md) -- [LLM] The LLMAbstraction component is designed with a provider-agnostic approach, allowing for seamless integration of multiple Large Language Model (LLM) providers. This is evident in the lib/llm/provider-registry.js file, where a registry of providers is maintained, enabling easy addition or removal of providers. For instance, the AnthropicProvider class (lib/llm/providers/anthropic-provider.ts) and the DMRProvider class (lib/llm/providers/dmr-provider.ts) are both registered in this registry, demonstrating the flexibility of the component's architecture. The LLMService class (lib/llm/llm-service.ts) serves as the main entry point for all LLM operations, routing requests to the appropriate provider based on the registry. This design decision enables the component to adapt to changing requirements and new provider additions without significant modifications to the existing codebase.

### Siblings
- [ProviderRegistry](./ProviderRegistry.md) -- The lib/llm/provider-registry.js file maintains a registry of providers, enabling easy addition or removal of providers.
- [LLMService](./LLMService.md) -- The LLMService class (lib/llm/llm-service.ts) serves as the main entry point for all LLM operations, routing requests to the appropriate provider based on the registry.


---

*Generated from 7 observations*
