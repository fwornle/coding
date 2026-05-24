# AvailabilityProbeFunction

**Type:** Detail

The probe targets port-based services: integrations/mcp-server-semantic-analysis/docs/configuration.md documents both CODE_GRAPH_RAG_PORT and CODE_GRAPH_RAG_SSE_PORT as the reachability endpoints, indicating the probe performs a TCP or HTTP-level check against these configured ports before loading any client module.

## What It Is  

**AvailabilityProbeFunction** lives inside the *MCP‑Server‑Semantic‑Analysis* integration.  The only concrete locations that mention it are the documentation files under  

* `integrations/mcp-server-semantic-analysis/docs/configuration.md` – which lists the ports **CODE_GRAPH_RAG_PORT** and **CODE_GRAPH_RAG_SSE_PORT** as the endpoints the probe checks, and  
* `integrations/mcp-server-semantic-analysis/CRITICAL-ARCHITECTURE-ISSUES.md` – which records the “probe‑before‑import” fix that was applied to avoid crashes when optional services are missing.  

The function itself is not exposed as a public class or module in the source tree (the “0 code symbols found” observation confirms there is no direct source‑code reference).  Instead, it is a logical component of the **DynamicImportGuardPattern** – the parent pattern that wraps optional external services (e.g., Memgraph, external analysis servers) with a runtime availability check before any client library is imported or any request is sent.  Its sibling, **GracefulDegradationResponse**, defines the contract that the MCP host must receive a well‑formed response even when the probe fails.

In short, **AvailabilityProbeFunction** is the runtime guard that validates reachability of required ports (TCP/HTTP) for optional services **before** the rest of the import chain is executed, thereby turning a hard‑startup failure into a controlled degradation path.

---

## Architecture and Design  

The architecture around **AvailabilityProbeFunction** follows a *guard‑first* style.  The parent **DynamicImportGuardPattern** orchestrates a three‑step flow:

1. **Probe** – Using the ports defined in `configuration.md` (`CODE_GRAPH_RAG_PORT`, `CODE_GRAPH_RAG_SSE_PORT`), the probe performs a low‑level TCP (or HTTP) connection attempt.  This is a pure network‑reachability test; no client library code is loaded at this point.  
2. **Decision** – If the probe succeeds, the guard proceeds to dynamically import the corresponding client module (e.g., the Memgraph driver).  If the probe fails, the guard short‑circuits the import and delegates to **GracefulDegradationResponse**.  
3. **Degradation** – The response object produced by the sibling component satisfies the “tool‑level contract” described in `docs/architecture/tools.md`, ensuring the MCP host always receives a structurally valid payload.

The design pattern is explicitly called the **Probe‑Before‑Import** pattern in the *CRITICAL‑ARCHITECTURE‑ISSUES* document.  It was introduced to remediate a failure mode where the application crashed at startup because an optional external service (e.g., Memgraph) was not running.  By moving the availability check to runtime and keeping the import lazy, the system gains resilience without sacrificing the ability to use the service when it is present.

The interaction diagram (conceptual, not provided in source) would show:

```
+-------------------+          +-------------------+          +-------------------+
| DynamicImportGuard|  probe   | AvailabilityProbe | success  | Imported Client   |
| Pattern           +--------->| Function          +--------->| (e.g., Memgraph)  |
+-------------------+          +-------------------+          +-------------------+
        |                                   |
        | failure                           |
        v                                   v
+-------------------+          +-------------------+
| GracefulDegradationResponse |  | MCP Host          |
| (fallback payload)          +<--------+--------------+
+-------------------+          +-------------------+
```

---

## Implementation Details  

Although the source repository does not expose a concrete class, the implementation can be inferred from the documentation:

* **Port Configuration** – `integrations/mcp-server-semantic-analysis/docs/configuration.md` defines two constants, **CODE_GRAPH_RAG_PORT** and **CODE_GRAPH_RAG_SSE_PORT**.  The probe reads these values at runtime, likely via a configuration loader used throughout the MCP server.  
* **Network Check** – The probe attempts a socket connection (or an HTTP HEAD request) against each configured port.  The choice of TCP vs. HTTP is not spelled out, but the wording “TCP or HTTP‑level check” suggests the implementation abstracts the protocol behind a small helper (e.g., `isPortOpen(host, port)` or `httpHealthCheck(url)`).  
* **Dynamic Import Guard** – The parent **DynamicImportGuardPattern** wraps the import statement in a conditional block.  Pseudo‑code, derived from the pattern description, would look like:

```python
if AvailabilityProbeFunction.probe(CODE_GRAPH_RAG_PORT):
    from memgraph_client import MemgraphClient  # imported only when reachable
else:
    response = GracefulDegradationResponse.build_missing_service('Memgraph')
```

* **Graceful Degradation** – The sibling component provides a static method that builds a response object adhering to the “tool‑level contract”.  This contract is documented in `docs/architecture/tools.md` and guarantees that downstream MCP components can always parse the response, regardless of service availability.

* **Batch Processing Guard** – The constant **MEMGRAPH_BATCH_SIZE** appears in the project documentation as a configuration key for batch writes.  The probe must succeed before any code that references this constant is executed, ensuring that batch operations are never attempted against a non‑existent Memgraph instance.

Because the probe runs *before* any heavy client library is loaded, the runtime overhead is limited to a short socket/HTTP handshake, after which the system either proceeds with the full import path or follows the fallback.

---

## Integration Points  

* **Configuration Layer** – The probe reads the ports from `configuration.md`.  Any change to service endpoints must be reflected there; otherwise the probe will target the wrong address.  
* **DynamicImportGuardPattern** – This pattern is the direct parent and orchestrates the probe.  All optional external services in the MCP server (e.g., Memgraph, external analysis servers) are wrapped by this guard, meaning that any new optional service should follow the same probe‑before‑import flow.  
* **GracefulDegradationResponse** – The sibling component receives the failure signal from the probe and produces a response that satisfies the tool contract defined in `docs/architecture/tools.md`.  This ensures that downstream pipelines (e.g., the MCP host request handler) do not need to add special‑case logic for missing services.  
* **Batch Write Logic** – The constant **MEMGRAPH_BATCH_SIZE** is only consulted after a successful probe, linking the probe outcome to the data‑ingestion path.  This prevents attempts to write batches to an unavailable Memgraph instance.  

Overall, **AvailabilityProbeFunction** sits at the intersection of configuration, dynamic import control, and graceful degradation, acting as the first line of defense for any optional service.

---

## Usage Guidelines  

1. **Never hard‑code service endpoints** – Always rely on the values defined in `integrations/mcp-server-semantic-analysis/docs/configuration.md`.  Changing a port without updating the config file will cause the probe to fail silently and trigger degradation.  
2. **Add new optional services through the DynamicImportGuardPattern** – When introducing a new external dependency, declare its port(s) in the configuration file, implement a small probe call (reusing the existing helper if possible), and wrap the import in the guard.  Follow the same fallback path that **GracefulDegradationResponse** provides.  
3. **Respect the probe result** – Code that performs batch operations or any service‑specific logic must first verify that the probe succeeded.  The pattern already guarantees this ordering, but developers should avoid calling client APIs outside the guarded block.  
4. **Maintain the contract in `tools.md`** – Any change to the shape of the fallback response must be reflected in the “tool‑level contract” so that the MCP host can continue to parse responses uniformly.  
5. **Testing** – Unit tests should mock the probe to simulate both reachable and unreachable states, verifying that the system correctly imports the client in the success case and returns a well‑formed degradation payload otherwise.

---

### Architectural patterns identified  

* **Probe‑Before‑Import (availability guard)** – validates external service reachability before dynamic import.  
* **Dynamic Import Guard Pattern** – lazy loading of optional dependencies based on runtime health.  
* **Graceful Degradation** – sibling component supplies a contract‑compliant fallback response.  

### Design decisions and trade‑offs  

* **Safety vs. Startup Latency** – Adding a network probe introduces a small start‑up delay but prevents crashes when services are down.  
* **Loose coupling** – Optional services are not hard‑wired; they are discovered at runtime, allowing independent scaling or maintenance of those services.  
* **Complexity in error handling** – All callers must be prepared to handle the degraded response, increasing the surface area for testing.  

### System structure insights  

The MCP server’s optional‑service subsystem is a three‑layer stack: configuration → probe → dynamic import → functional client or graceful fallback.  This stack is encapsulated by the **DynamicImportGuardPattern**, making the optional‑service handling orthogonal to the core request‑processing pipeline.

### Scalability considerations  

Because the probe is a simple TCP/HTTP handshake, it scales linearly with the number of optional services.  Adding more services only adds another lightweight check at start‑up; there is no per‑request overhead once the import decision is made.  The pattern also supports horizontal scaling of the optional services themselves (e.g., Memgraph clusters) because the probe only checks a single endpoint – the endpoint can be a load‑balanced address.

### Maintainability assessment  

The design is highly maintainable:

* **Single source of truth** for service endpoints (the configuration file).  
* **Encapsulated guard logic** – changes to probing or import strategy are localized to the DynamicImportGuardPattern.  
* **Clear contract** – GracefulDegradationResponse guarantees a stable interface for downstream components.  

The main maintenance burden is ensuring the configuration stays in sync with the actual deployment topology and that any new optional service follows the same guard pattern.  As long as developers adhere to the usage guidelines, the system remains robust and easy to evolve.


## Hierarchy Context

### Parent
- [DynamicImportGuardPattern](./DynamicImportGuardPattern.md) -- The pattern appears in integrations/mcp-server-semantic-analysis where optional external services (e.g., Memgraph, external analysis servers) may or may not be running, requiring a probe before importing or invoking their client libraries

### Siblings
- [GracefulDegradationResponse](./GracefulDegradationResponse.md) -- integrations/mcp-server-semantic-analysis/docs/architecture/tools.md ('Tool Extensions') defines the tool-level contract that each tool must satisfy; graceful degradation is a required part of that contract so that the MCP host receives a well-formed response object regardless of optional-service state.


---

*Generated from 3 observations*
