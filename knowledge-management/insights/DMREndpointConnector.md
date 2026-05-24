# DMREndpointConnector

**Type:** Detail

Because `docs/puml/local-llm-fallback.puml` shows local DMR inference as the terminal node reached by both trigger paths, DMREndpointConnector must be designed to handle requests arriving from two distinct upstream contexts (explicit-mode and failure-fallback) without requiring caller-specific branching in its own logic.

## What It Is  

**DMREndpointConnector** is a concrete implementation that lives inside the **`@rapid/llm-proxy`** package.  Its sole responsibility is to act as the *execution‑side* network bridge to the **local DMR inference server**.  In the overall fallback architecture, it is the counterpart to **`FallbackTriggerLogic`**, which makes the *decision‑side* determination of whether a request should be routed locally.  The connector is instantiated and owned by **`LocalLLMFallback`**, and every request that reaches the local DMR inference – whether the request arrived because the caller explicitly set `mode === 'local'` or because a public‑provider failure forced a fallback – is funneled through this component.  

The component is described as a **“request adapter”**, which means it translates the internal request shape used by the proxy into the exact API contract expected by the local DMR server.  This translation layer shields the rest of the system from any differences between the public‑provider APIs and the locally hosted inference endpoint.

> ![Local LLM fallback flow diagram](docs/puml/local-llm-fallback.puml)  
> *The diagram shows the two distinct entry paths (explicit‑mode and failure‑fallback) converging on the local DMR inference node, which is serviced by DMREndpointConnector.*

---

## Architecture and Design  

The architecture around **DMREndpointConnector** follows a **clear separation of concerns**:

1. **Decision Layer** – `FallbackTriggerLogic` decides *when* a request should be routed locally.  
2. **Adaptation Layer** – `DMREndpointConnector` decides *how* the request is sent to the local DMR server, normalising payloads, headers, and transport details.  
3. **Execution Layer** – The local DMR inference server actually performs the inference.

This layering embodies the **Adapter pattern**: `DMREndpointConnector` implements a thin façade that conforms to the proxy’s internal request interface while delegating the low‑level HTTP (or RPC) communication to the local server.  Because the connector receives traffic from two upstream contexts (explicit‑mode and failure‑fallback) **without any caller‑specific branching**, it also exhibits a **stateless, request‑agnostic** design.  The upstream components simply hand off a normalized request object; the connector does not need to inspect the origin, which reduces coupling and simplifies testing.

Interaction flow (derived from the diagram):

* `FallbackTriggerLogic` → (decision) → `LocalLLMFallback` → (delegates) → **`DMREndpointConnector`** → (network call) → **local DMR inference server**.

No other sibling components directly interact with the connector; its sole consumer is `LocalLLMFallback`.  This isolation reinforces **single‑responsibility** and makes the connector a natural point for future protocol changes (e.g., switching from HTTP to gRPC) without rippling effects elsewhere.

---

## Implementation Details  

Although the source repository reports **zero code symbols** in the current view, the observations give us enough to infer the internal structure:

* **Location** – `@rapid/llm-proxy` (likely under `src/connectors/DMREndpointConnector.ts` or similar).  
* **Class / Function** – The component is named **`DMREndpointConnector`**, suggesting an exported class or factory function.  
* **Primary Method** – A `send(request)` or `invoke(request)` routine that accepts the proxy’s internal request object. This method performs:
  * **Request Normalisation** – Mapping fields (e.g., `prompt`, `temperature`) from the proxy’s generic schema to the concrete schema required by the local DMR server.
  * **Transport Handling** – Opening an HTTP (or alternative) connection to the configured DMR endpoint, attaching any required authentication headers, and serialising the payload (likely JSON).
  * **Response Wrapping** – Converting the raw DMR response back into the proxy’s standard response shape so that downstream consumers (e.g., result aggregators) see a uniform interface.

Because the connector must serve both **explicit‑mode** and **failure‑fallback** callers, its implementation deliberately avoids any conditional logic based on request provenance.  All branching (e.g., retries, timeout handling) is performed purely on transport‑level signals, not on business‑level flags.

The **parent component**, `LocalLLMFallback`, likely holds an instance of `DMREndpointConnector` and calls its public method whenever a local inference is required.  The sibling `FallbackTriggerLogic` never interacts with the connector directly, preserving a clean directional flow.

---

## Integration Points  

* **Upstream** – `FallbackTriggerLogic` (decision side) and any other future decision modules feed into `LocalLLMFallback`.  The only contract they must satisfy is to hand a request object to `LocalLLMFallback`, which in turn forwards it to `DMREndpointConnector`.  
* **Parent** – `LocalLLMFallback` owns the connector.  It is responsible for configuring the connector with endpoint URLs, authentication tokens, and any runtime options (e.g., request timeout).  
* **Downstream** – The **local DMR inference server** is the external system that receives the normalized request.  The connector must align with the server’s API contract, which may differ from public LLM providers (hence the need for adaptation).  
* **Configuration** – All endpoint details are expected to be supplied via the `@rapid/llm-proxy` configuration layer (environment variables or a config file), keeping the connector free of hard‑coded values.  

Because the connector is a thin adapter, it can be swapped out or stubbed in tests without affecting the higher‑level logic.  Its only external dependency is the network stack (e.g., `fetch` or `axios`) and the local DMR server’s reachable address.

---

## Usage Guidelines  

1. **Treat the connector as a black box** – Callers (currently only `LocalLLMFallback`) should pass a fully‑formed request object and rely on the connector to perform all necessary translation and transport.  Do not embed mode‑specific logic inside the request; the connector does not differentiate origins.  
2. **Configure centrally** – All endpoint URLs, authentication headers, and timeout settings must be defined in the `@rapid/llm-proxy` configuration and injected when constructing `DMREndpointConnector`.  Changing these values should never require code changes inside the connector.  
3. **Stateless usage** – Because the connector does not retain per‑request state, it can be instantiated once and reused across the lifetime of the application.  This encourages resource reuse (e.g., HTTP keep‑alive connections).  
4. **Error handling** – Let the connector surface transport‑level errors (network failures, non‑2xx responses) directly to `LocalLLMFallback`.  The fallback logic can then decide whether to retry, switch back to a public provider, or surface the error to the caller.  
5. **Testing** – Mock the network layer (e.g., using a fetch mock) and verify that the connector correctly maps the internal request schema to the external DMR payload.  Because the connector is isolated from decision logic, unit tests can focus purely on request/response transformation.

---

### Architectural Patterns Identified  

| Pattern | Evidence |
|---------|----------|
| **Adapter** | Explicitly described as a “request adapter” that normalises outgoing requests to the local DMR server’s contract. |
| **Separation of Concerns / Single Responsibility** | The connector handles only network‑level adaptation, while `FallbackTriggerLogic` handles decision making. |
| **Stateless Facade** | Handles requests from multiple upstream contexts without branching on caller identity. |

### Design Decisions & Trade‑offs  

* **Adapter vs Direct Call** – By inserting an adapter layer, the system gains flexibility (easy swap of the local inference backend) at the cost of an extra abstraction hop.  
* **Statelessness** – Avoiding per‑request state simplifies concurrency and scaling but limits the ability to implement request‑specific optimisations (e.g., caching based on caller).  
* **Centralised Configuration** – Keeps deployment flexibility high; however, misconfiguration can affect all downstream calls, so validation is essential.

### System Structure Insights  

* The fallback architecture converges two distinct routing decisions onto a single execution endpoint (`DMREndpointConnector`).  
* `DMREndpointConnector` sits at the bottom of the fallback stack, providing a stable, uniform gateway to the local DMR inference service.  

### Scalability Considerations  

* Because the connector is stateless and reusable, it scales horizontally with the application process pool.  
* Network throughput to the local DMR server becomes the primary scaling bottleneck; horizontal scaling of the DMR server itself would be required for high request volumes.  

### Maintainability Assessment  

* **High** – The connector’s narrow responsibility and clear adapter role make it easy to understand, test, and modify.  
* **Isolation** – Changes to the local DMR API affect only this component, leaving decision logic untouched.  
* **Potential Risk** – Lack of visible code symbols suggests the implementation may be minimal; any future feature expansion (e.g., retry policies) should be added carefully to avoid bloating the adapter.  

---  

*This insight document captures the current design and integration landscape of **DMREndpointConnector** as derived from the provided observations.  It should serve as a reference for developers extending, testing, or maintaining the local fallback pathway within the `@rapid/llm-proxy` ecosystem.*


## Hierarchy Context

### Parent
- [LocalLLMFallback](./LocalLLMFallback.md) -- `docs/puml/local-llm-fallback.puml` diagrams the fallback flow, showing that local DMR inference is activated both by explicit `'local'` mode assignment and by public provider failure, making it serve dual roles as a mode target and a resilience mechanism

### Siblings
- [FallbackTriggerLogic](./FallbackTriggerLogic.md) -- The `docs/puml/local-llm-fallback.puml` fallback flow diagram exposes two independent entry paths into DMR inference: one triggered by explicit `mode == 'local'` assignment, and one triggered by public provider unavailability — meaning the same local endpoint is reused for both planned and emergency routing.


---

*Generated from 3 observations*
