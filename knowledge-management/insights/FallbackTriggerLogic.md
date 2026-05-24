# FallbackTriggerLogic

**Type:** Detail

Per the SubComponent (L2) description, this dual-role architecture is a deliberate design decision within `@rapid/llm-proxy`, making FallbackTriggerLogic a single chokepoint through which all DMR-bound traffic flows regardless of cause — centralizing routing policy for local inference in one place rather than scattering fallback logic across provider-specific code paths.

## What It Is  

**FallbackTriggerLogic** lives inside the **LocalLLMFallback** sub‑component of the `@rapid/llm‑proxy` package. Its definition and behavior are captured in the fallback flow diagram located at  

```
docs/puml/local-llm-fallback.puml
```  

The diagram shows that **FallbackTriggerLogic** is the single decision point that determines whether a request should be routed to the *local* DMR (Deep‑Model‑Runtime) inference endpoint. This routing can happen for two distinct reasons:

1. **Explicit local mode** – the caller sets `mode == 'local'`.  
2. **Public‑provider failure** – the primary (public) LLM provider is unavailable and the system must fall back automatically.

Both paths converge on the same local DMR endpoint, meaning the component serves a *dual‑role* as both a planned “local‑only” mode and a resilience fallback mechanism.

---

## Architecture and Design  

The architecture adopts a **centralized routing chokepoint** model. Rather than scattering fallback checks throughout each provider‑specific connector, the system funnels every DMR‑bound request through **FallbackTriggerLogic**. This design is intentional, as highlighted in the SubComponent (L2) description of `@rapid/llm-proxy`.  

The core design pattern evident from the observations is an **OR‑condition routing rule**:  

```
if (mode === 'local' || publicProviderFailed) {
    routeToLocalDMR();
}
```  

Because the same logical block must handle two different trigger origins, **FallbackTriggerLogic** is required to *distinguish* between a proactive “local‑mode” request and a reactive “failure‑fallback” request. This distinction is important for downstream components that may need to propagate different error contexts or signaling metadata (e.g., marking a request as a fallback for telemetry).

The component sits directly under its parent **LocalLLMFallback** and works alongside its sibling **DMREndpointConnector**. While **FallbackTriggerLogic** decides *whether* to use the local endpoint, **DMREndpointConnector** is responsible for the *how* – establishing the actual network connection to the local DMR inference server. This separation of concerns (decision vs. execution) reinforces a clean, single‑responsibility design.

---

## Implementation Details  

Although the source code for **FallbackTriggerLogic** is not listed, the observations give us the essential mechanics:

* **Trigger Evaluation** – The logic evaluates two boolean conditions:  
  * `mode === 'local'` – a flag supplied by the caller.  
  * `publicProviderFailed` – a runtime flag set when the primary public LLM provider returns an error or becomes unreachable.  

* **Origin Discrimination** – Because the two entry paths have different semantics, the implementation must capture the *origin* of the trigger. This is typically done by attaching a flag or context object (e.g., `triggerSource: 'explicit' | 'fallback'`) that downstream components can inspect.  

* **Routing Decision** – When either condition is true, the component forwards the request to the **DMREndpointConnector**, which then handles the HTTP/gRPC (or other transport) call to the local DMR server.  

* **Error Context Propagation** – For fallback‑triggered requests, the system is expected to propagate the original public‑provider error downstream so that observability layers can differentiate between a normal local request and a resilience‑driven fallback.  

* **Diagram Reference** – The flow diagram (`docs/puml/local-llm-fallback.puml`) visually illustrates the two entry arrows converging on **FallbackTriggerLogic**, followed by a single outbound arrow to **DMREndpointConnector**. Embedding the diagram here clarifies the control flow:

![Fallback flow diagram](docs/puml/local-llm-fallback.puml)

---

## Integration Points  

**FallbackTriggerLogic** interacts with several neighboring pieces:

* **LocalLLMFallback (parent)** – Provides the configuration surface (`mode` flag) and aggregates the overall fallback behavior for the LLM proxy. All external callers that wish to enforce local inference must set `mode: 'local'` through this parent component.  

* **DMREndpointConnector (sibling)** – Receives the routed request and performs the actual network communication with the local DMR inference server. The connector assumes that routing decisions have already been made, allowing it to focus solely on transport concerns.  

* **Public Provider Connectors** – While not directly coupled, they feed the `publicProviderFailed` flag that **FallbackTriggerLogic** consumes. Failure detection logic (timeouts, HTTP error codes, etc.) lives in those connectors and updates a shared state that the fallback logic monitors.  

* **Telemetry / Observability Layer** – Because the component must differentiate trigger origins, any logging or metrics subsystem that consumes request metadata will receive a flag indicating whether a request was a proactive local call or a reactive fallback. This enables accurate reporting of fallback rates and latency impact.  

* **Configuration System** – The component likely reads runtime configuration (e.g., enable/disable fallback, thresholds for failure detection) from the broader `@rapid/llm-proxy` settings, though the observations do not detail the exact file.

---

## Usage Guidelines  

1. **Explicit Local Mode** – When a consumer truly intends to run inference locally (e.g., for privacy or latency reasons), set `mode: 'local'` on the request object that passes through **LocalLLMFallback**. This will short‑circuit any public‑provider attempts and invoke the local DMR directly.  

2. **Do Not Bypass FallbackTriggerLogic** – All routing to the local DMR must go through **FallbackTriggerLogic**. Directly invoking **DMREndpointConnector** bypasses the origin‑discrimination logic and can lead to missing telemetry or incorrect error handling.  

3. **Handle Fallback Errors Gracefully** – When a request arrives via the fallback path, preserve the original public‑provider error in the request context. Downstream consumers (e.g., UI layers) can surface a meaningful message such as “Switched to local model due to upstream provider outage.”  

4. **Monitoring** – Instrument the `triggerSource` flag (explicit vs. fallback) in logs and metrics. This enables operators to track how often the system relies on the fallback mechanism and to assess the health of public providers.  

5. **Configuration Awareness** – If the deployment disables the local DMR (e.g., the local server is not running), ensure that the configuration reflects this, otherwise **FallbackTriggerLogic** may route traffic to an unavailable endpoint, causing additional failures.  

---

### Architectural Patterns Identified  

* **Centralized Routing Chokepoint** – A single component decides all DMR routing.  
* **OR‑Condition Decision Logic** – Combines explicit mode and failure detection into one predicate.  
* **Separation of Concerns (Decision vs. Execution)** – **FallbackTriggerLogic** (decision) vs. **DMREndpointConnector** (execution).  

### Design Decisions and Trade‑offs  

* **Pros** – Simplifies the codebase by avoiding duplicated fallback checks across many provider connectors; provides a single place for telemetry and policy changes.  
* **Cons** – Introduces a single point of failure; the component must be carefully tested for both trigger origins to avoid conflating contexts.  

### System Structure Insights  

* **LocalLLMFallback** is the parent container that aggregates mode configuration and fallback policy.  
* **FallbackTriggerLogic** is the decision engine; **DMREndpointConnector** is the transport engine.  
* Public provider connectors feed failure signals but do not contain fallback routing themselves.  

### Scalability Considerations  

Because routing decisions are lightweight boolean checks, **FallbackTriggerLogic** scales well with request volume. The real scalability limit lies in the local DMR server capacity; the centralized routing does not impede horizontal scaling of request handling, provided the connector can multiplex connections efficiently.  

### Maintainability Assessment  

The clear separation between decision logic and endpoint connection aids maintainability: changes to fallback policy (e.g., adding new trigger conditions) affect only **FallbackTriggerLogic**, while updates to network protocols stay within **DMREndpointConnector**. However, the centralization means that any bug in **FallbackTriggerLogic** impacts all DMR traffic, so comprehensive unit tests covering both explicit and failure‑driven paths are essential.


## Hierarchy Context

### Parent
- [LocalLLMFallback](./LocalLLMFallback.md) -- `docs/puml/local-llm-fallback.puml` diagrams the fallback flow, showing that local DMR inference is activated both by explicit `'local'` mode assignment and by public provider failure, making it serve dual roles as a mode target and a resilience mechanism

### Siblings
- [DMREndpointConnector](./DMREndpointConnector.md) -- As noted in the SubComponent (L2) context, DMREndpointConnector lives within `@rapid/llm-proxy` and is responsible for the actual network-level connection to the local DMR inference server, making it the execution-side counterpart to FallbackTriggerLogic's decision-side role.


---

*Generated from 3 observations*
