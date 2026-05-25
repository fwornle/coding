# TieredModelProposal

**Type:** Detail

The document lives alongside architecture and configuration references in integrations/mcp-server-semantic-analysis/docs/, suggesting it is a design-phase artifact intended to guide both the YAML schema and the agent initialization sequence described in docs/architecture/agents.md.

## What It Is  

**TieredModelProposal** is the formal design artifact that defines how the MCP‑Server’s semantic‑analysis service selects an LLM provider based on a *tier rank*. The proposal lives in the source tree at  

```
integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md
```  

and is paired with the runtime configuration file  

```
integrations/mcp-server-semantic-analysis/llm-providers.yaml
```  

The markdown document captures the *escalation criteria*—the conditions that cause the routing layer to move a request from a lower‑cost tier (e.g., a fast, inexpensive model) to a higher‑capability tier (e.g., a more accurate but costlier model). The proposal is a child of the **LLMTierRoutingPattern** component, which orchestrates the tier‑based routing logic across the server. The design outlined in the proposal also informs the agent‑initialization sequence described in `docs/architecture/agents.md`, ensuring that agents are instantiated with the appropriate provider according to the tier decision.

---

## Architecture and Design  

The architecture embodied by **TieredModelProposal** follows a **configuration‑driven tiered routing** pattern. Rather than hard‑coding provider selection, the system externalizes the decision matrix into `llm-providers.yaml`. At startup, the routing component reads this YAML, builds an in‑memory tier map, and uses the escalation rules defined in the proposal to decide, per request, which tier to invoke.

* **Parent‑child relationship** – The proposal is a child of **LLMTierRoutingPattern**, which acts as the orchestrator. The pattern encapsulates three logical stages: (1) initial tier lookup, (2) runtime evaluation of escalation criteria, and (3) provider dispatch. The proposal supplies the *policy* (the “what” and “when”), while the routing pattern supplies the *mechanism* (the “how”).

* **Decision‑logic flow** – The escalation criteria are expressed as predicates on request metadata (e.g., token budget, latency SLA, confidence thresholds). When a request fails a predicate at its current tier, the routing layer automatically promotes it to the next tier in the rank order. This creates a deterministic, rule‑based escalation path without requiring custom code per provider.

* **Configuration as source of truth** – All tier definitions, cost limits, and capability flags are stored in `llm-providers.yaml`. The proposal explicitly ties the runtime behavior to this file, ensuring that changes to tier strategy are made in a single, version‑controlled location.

Because the design is documented alongside other architecture artifacts (`docs/architecture/agents.md`), the team treats the tiered routing as a shared contract between the **routing layer**, the **agent framework**, and any **provider adapters** that implement the LLM APIs.

---

## Implementation Details  

1. **Tier Definition (llm-providers.yaml)**  
   The YAML file enumerates providers under keys such as `tier: 1`, `tier: 2`, etc. Each entry contains:
   * `provider_id` – the symbolic name used by adapters.  
   * `cost_per_token` – used by the escalation logic to compare economic impact.  
   * `capabilities` – flags (e.g., `supports_function_calls`, `max_context`) that the routing layer can query.  

2. **LLMTierRoutingPattern**  
   The routing pattern is realized by a class (or set of functions) named **LLMTierRouter** located in the server’s routing package (e.g., `integrations/mcp-server-semantic-analysis/src/router/llm_tier_router.py`). Its responsibilities include:
   * Loading `llm-providers.yaml` at initialization.  
   * Building a sorted list of tier objects based on the `tier` rank.  
   * Exposing a method `select_provider(request)` that:
     - Reads the request metadata.  
     - Applies the escalation predicates defined in **TieredModelProposal** (e.g., “if `estimated_latency > SLA` then promote”).  
     - Returns the `provider_id` of the chosen tier.  

3. **Escalation Criteria**  
   The proposal enumerates concrete criteria such as:
   * **Budget overflow** – when the projected token cost exceeds a per‑request budget.  
   * **Confidence threshold** – if the model’s confidence score falls below a configured floor.  
   * **Latency SLA breach** – when the observed response time of the current tier exceeds a latency SLA.  

   These predicates are implemented as lightweight functions (e.g., `should_escalate_budget(request, tier)`) that the router invokes sequentially. The router stops at the first tier that satisfies all predicates, guaranteeing the minimal‑cost tier that still meets the request’s <USER_ID_REDACTED> constraints.

4. **Agent Initialization (docs/architecture/agents.md)**  
   Agents are instantiated by the `AgentFactory` after the router has selected a provider. The factory injects the chosen `provider_id` into the agent’s configuration, allowing the agent to call the correct LLM adapter without needing to understand tier logic. This decouples agent code from provider selection concerns and aligns with the “separation of concerns” principle described in the proposal.

---

## Integration Points  

* **Configuration Layer** – `llm-providers.yaml` is the sole source of tier metadata. Any change to tier composition, cost parameters, or capability flags must be reflected here. The router watches this file for hot‑reload (if supported) to allow dynamic re‑tiering without redeploying the service.

* **Routing Layer** – The **LLMTierRouter** sits between the incoming request handler (`request_handler.py`) and the provider adapters (`adapters/openai_adapter.py`, `adapters/anthropic_adapter.py`, etc.). It consumes the request, applies escalation logic, and forwards the request to the selected adapter.

* **Agent Framework** – The `AgentFactory` (documented in `docs/architecture/agents.md`) consumes the router’s output. Agents receive a `provider_context` that includes the selected provider ID and any tier‑specific configuration (e.g., temperature defaults). This ensures that downstream business logic remains agnostic to tier decisions.

* **Observability** – Metrics collection (e.g., `tier_selection_counter`, `escalation_latency_histogram`) is hooked into the router to surface how often escalations occur and which tiers are most frequently used. These metrics feed back into the design loop for adjusting tier thresholds.

* **Testing Harness** – Integration tests located under `integrations/mcp-server-semantic-analysis/tests/` mock `llm-providers.yaml` with multiple tier scenarios and assert that the router respects the escalation predicates defined in the proposal.

---

## Usage Guidelines  

1. **Define tiers before deployment** – Populate `llm-providers.yaml` with a complete tier hierarchy. Each tier must have a unique numeric rank and a corresponding `provider_id`. Do not leave gaps in the rank sequence, as the router expects a contiguous ordering for escalation.

2. **Document escalation predicates** – When adding new criteria (e.g., a new SLA metric), update the **TieredModelProposal** markdown to keep the design and implementation in sync. The router’s predicate functions should be named consistently (`should_escalate_<criterion>`).

3. **Prefer lower tiers** – The routing logic always attempts the lowest‑ranked tier that satisfies the request. Developers should tune cost and capability fields in `llm-providers.yaml` to reflect the desired trade‑off between expense and performance.

4. **Monitor escalation frequency** – High escalation rates may indicate that the lower tier is under‑provisioned or that thresholds are too strict. Use the exposed metrics to adjust tier parameters or add an intermediate tier.

5. **Hot‑reload with caution** – If the server is configured for hot‑reloading of `llm-providers.yaml`, ensure that any in‑flight requests complete before the new tier map is applied. This avoids transient mismatches between the router’s view and the provider adapters.

---

### Architectural Patterns Identified  

* **Configuration‑Driven Routing** – Tier and provider selection are externalized to YAML, enabling runtime flexibility without code changes.  
* **Escalation (Tiered) Pattern** – A deterministic, rule‑based promotion from lower to higher tiers based on defined predicates.  
* **Separation of Concerns** – Routing logic is isolated from agent initialization; agents receive a ready‑made provider context.  

### Design Decisions and Trade‑offs  

| Decision | Rationale | Trade‑off |
|----------|-----------|-----------|
| Store tier policy in `llm-providers.yaml` | Single source of truth; easy to edit and version‑control | Requires disciplined schema management; runtime validation needed |
| Use rule‑based escalation rather than ML‑based routing | Predictable, auditable behavior; aligns with compliance needs | Less adaptive to unforeseen workload patterns |
| Decouple agents from routing via `AgentFactory` | Keeps agent code simple and reusable across providers | Adds an extra indirection layer that must be kept in sync with routing updates |

### System Structure Insights  

* **LLMTierRoutingPattern** is the parent orchestrator; **TieredModelProposal** supplies the policy.  
* Provider adapters are siblings to the router, each implementing a common interface (`generate(request)`).  
* The agent subsystem is a child of the routing layer, consuming the selected provider via a context object.

### Scalability Considerations  

* Adding new tiers is a linear operation: simply extend `llm-providers.yaml` and, if needed, add corresponding escalation predicates.  
* The router’s decision path is O(N) in the number of tiers, but because tier lists are typically short (3‑5 entries), latency impact is negligible.  
* Hot‑reloading enables scaling the tier configuration horizontally across multiple server instances without coordinated redeploys.

### Maintainability Assessment  

The design is **highly maintainable** because:

* **Documentation‑code alignment** – The markdown proposal, YAML schema, and router implementation are co‑located in the same `integrations/mcp-server-semantic-analysis/docs/` directory, encouraging synchronous updates.  
* **Clear contract** – Escalation criteria are expressed as named predicates, making it straightforward to add, remove, or modify rules.  
* **Testability** – The router’s deterministic nature and isolated predicate functions lend themselves to unit and integration testing.  

Potential maintenance risk lies in **schema drift** between the proposal and `llm-providers.yaml`. Enforcing schema validation (e.g., via a JSON‑Schema validator run at CI) mitigates this risk.


## Hierarchy Context

### Parent
- [LLMTierRoutingPattern](./LLMTierRoutingPattern.md) -- integrations/mcp-server-semantic-analysis/docs/TIERED-MODEL-PROPOSAL.md documents the formal proposal for tiered model selection, establishing the rationale and design that llm-providers.yaml implements


---

*Generated from 3 observations*
