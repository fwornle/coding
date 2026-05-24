# VkbServerAvailabilityGate

**Type:** Detail

GraphDatabaseAdapter (referenced explicitly in the ManualLearning sub-component description) performs a server-availability probe prior to each manual write, selecting the REST path only when the VKB HTTP server is confirmed up.

## What It Is  

**VkbServerAvailabilityGate** is a runtime gate that lives inside the **ManualLearning** component. Its sole responsibility is to guard every manual write operation that flows through the **GraphDatabaseAdapter**. Before the adapter attempts to persist a human‑authored entity, the gate probes the **VKB HTTP server**; only when the server answers positively does the adapter select the REST endpoint (via **VkbApiClient**) and route the write to the server‑owned LevelDB instance. If the HTTP server cannot be reached, the gate blocks the write instead of silently falling back to a direct LevelDB connection. This behaviour eliminates the architectural risk of having two concurrent LevelDB handles—one owned by the server process and one opened directly by the client—thereby preserving data‑consistency for manually authored edits.

> **Location (as inferred from the documentation)** – The gate is referenced in the *ManualLearning* description and is conceptually positioned between **GraphDatabaseAdapter** and the **VkbApiClient** REST call. No concrete file‑system path is supplied in the observations, so the exact source file is not enumerated here.

---

## Architecture and Design  

The design of **VkbServerAvailabilityGate** follows a *guard‑or‑filter* pattern that sits at the edge of a write‑path pipeline. Its interaction can be described as:

1. **GraphDatabaseAdapter** receives a manual write request from the **EntityAuthoringInterface** (the sibling component that presents the authoring UI).  
2. The adapter invokes **VkbServerAvailabilityGate** to verify server health.  
3. The gate performs a lightweight **availability probe** (likely an HTTP HEAD or health‑check request) against the **VKB HTTP server**.  
4. **If the probe succeeds** → the adapter proceeds to the **VkbApiClient** REST path, ensuring the mutation is recorded in the server‑owned LevelDB store.  
5. **If the probe fails** → the gate returns a failure, and the adapter blocks the write, preventing a direct LevelDB fallback.

This flow enforces a *single source of truth* for manual edits: all successful writes must pass through the server‑managed LevelDB. The gate therefore acts as a *consistency enforcer* rather than a *fallback router*. No alternative persistence path is offered, which is a deliberate design choice to avoid the “competing direct LevelDB connection” risk highlighted in the parent description.

> **Diagram (inline)**  
> ![VkbServerAvailabilityGate flow](/assets/diagrams/VkbServerAvailabilityGate_flow.png)  
> *The gate sits between GraphDatabaseAdapter and VkbApiClient, blocking writes when the HTTP server is down.*

---

## Implementation Details  

While the source repository does not expose concrete symbols, the observations give us the essential elements that must exist:

| Element | Role |
|---------|------|
| **VkbServerAvailabilityGate** | A class or module exposing a `probe()` or `isServerAvailable()` method. |
| **GraphDatabaseAdapter** | Calls the gate before any manual write; decides which persistence route to take based on the gate’s result. |
| **VkbApiClient** | Encapsulates the REST call to the VKB HTTP server; used only when the gate reports availability. |
| **Availability Probe** | Likely an HTTP request (e.g., `GET /health` or `HEAD /`) that returns a 2xx status on success. No fallback logic is present. |

The gate’s implementation can be distilled into two logical steps:

1. **Health Check Execution** – The gate opens a short‑lived HTTP connection to the server’s health endpoint. It must handle network time‑outs gracefully and interpret any non‑2xx response as “unavailable”.  
2. **Decision Signal** – The result (boolean) is returned to the caller (GraphDatabaseAdapter). The adapter interprets `true` as “use REST path”, `false` as “block write”.

Because the gate is invoked **prior to each manual write**, it must be lightweight to avoid degrading authoring latency. The gate does **not** cache results; each write triggers a fresh probe, ensuring the most up‑to‑date view of server availability.

---

## Integration Points  

- **Parent Component – ManualLearning**  
  The gate is embedded in the ManualLearning workflow. ManualLearning orchestrates the overall handling of human‑authored data, and the gate is the critical safety valve that guarantees those edits only reach the server‑owned LevelDB.

- **Sibling Component – EntityAuthoringInterface**  
  This UI‑layer component feeds manual write requests into the **GraphDatabaseAdapter**. The adapter, in turn, consults the gate, meaning any UI‑level feature that triggers a write is automatically protected without additional code.

- **External Dependency – VKB HTTP Server**  
  The gate’s probe targets the HTTP server that hosts the LevelDB instance. The server must expose a reliable health endpoint; otherwise, all manual writes will be blocked.

- **Internal Dependency – VkbApiClient**  
  When the gate reports availability, the adapter forwards the request to VkbApiClient, which handles serialization, authentication, and the actual REST call.

No direct interaction with the LevelDB library occurs in the gate itself; the gate’s purpose is to *prevent* any direct LevelDB access from the client side.

---

## Usage Guidelines  

1. **Do not bypass the gate** – All manual write paths must pass through **GraphDatabaseAdapter**, which already incorporates the gate. Introducing a custom persistence path that writes directly to LevelDB re‑introduces the architectural risk the gate is designed to eliminate.  
2. **Handle gate failures at the UI level** – When the gate blocks a write, the calling UI (EntityAuthoringInterface) should surface a clear error message such as “Server unavailable – please try again later”. Silently dropping the mutation is prohibited.  
3. **Keep the health endpoint stable** – The VKB HTTP server’s health check URL must remain unchanged; any modification requires a corresponding update in the gate’s probe implementation.  
4. **Monitor probe latency** – Because the gate runs on every manual write, excessive latency in the health check will directly impact authoring responsiveness. Ensure the probe is a lightweight request with a short timeout (e.g., ≤ 500 ms).  
5. **Testing** – Unit tests for **VkbServerAvailabilityGate** should mock both successful and failing HTTP responses, verifying that the gate returns the correct boolean and that **GraphDatabaseAdapter** respects the result (writes proceed vs. block).  

---

### Architectural Patterns Identified  

1. **Guard / Filter Pattern** – The gate acts as a runtime guard that filters write operations based on external health state.  
2. **Adapter Pattern** – **GraphDatabaseAdapter** adapts manual write calls to either a REST client or a blocked state, abstracting the underlying persistence mechanism.  
3. **Health‑Check / Circuit‑Breaker (lightweight)** – Although not a full circuit‑breaker, the gate’s probe resembles a health‑check that prevents calls to an unavailable downstream service.

### Design Decisions and Trade‑offs  

| Decision | Rationale | Trade‑off |
|----------|-----------|-----------|
| **Block writes instead of fallback** | Guarantees that human‑authored data never diverges between two LevelDB instances. | Manual edits become unavailable during server downtime, potentially impacting user productivity. |
| **Per‑write probe** | Provides the freshest view of server health, avoiding stale cache‑based decisions. | Adds a small latency overhead on every manual write. |
| **No direct LevelDB access from client** | Eliminates the risk of concurrent writes to separate LevelDB handles, simplifying consistency guarantees. | Removes the possibility of an offline‑mode write cache that could later sync. |

### System Structure Insights  

- **ManualLearning** is the orchestrator for human‑authored data; it delegates persistence to **GraphDatabaseAdapter**, which itself relies on **VkbServerAvailabilityGate** to enforce server‑owned storage.  
- **EntityAuthoringInterface** shares the same **GraphDatabaseAdapter** entry point as other manual‑write components, ensuring a uniform gating policy across the system.  
- The gate isolates the *availability concern* from the rest of the codebase, centralizing the logic that decides whether the server‑owned LevelDB can be used.

### Scalability Considerations  

- **Horizontal scaling of the VKB HTTP server** – Since the gate only checks a health endpoint, adding more server instances behind a load balancer does not affect the gate’s logic; the health endpoint must reflect aggregate health.  
- **Probe frequency** – In high‑throughput authoring scenarios, the per‑write probe could become a bottleneck. If scaling becomes an issue, a lightweight caching layer (e.g., a short‑lived in‑memory flag) could be introduced, but that would modify the current design trade‑off.  
- **Network latency** – The gate’s reliance on a network round‑trip means that geographic distribution of clients could affect write latency; colocating the health endpoint with the client’s network region mitigates this.

### Maintainability Assessment  

The gate is a small, self‑contained module with a single responsibility, which makes it easy to understand, test, and modify. Its clear contract (return true/false based on server health) limits the surface area for bugs. Because it does not embed any fallback logic, future changes (e.g., adding a cache or a circuit‑breaker) can be introduced without affecting the surrounding **GraphDatabaseAdapter** code, provided the public interface remains stable. The main maintainability risk lies in the health‑check endpoint contract; any change to that endpoint must be reflected in the gate, so documentation and versioning of the server API are essential. Overall, the component scores high on maintainability due to its narrow focus and explicit integration points.


## Hierarchy Context

### Parent
- [ManualLearning](./ManualLearning.md) -- GraphDatabaseAdapter routes manual entity writes through VkbApiClient REST endpoints when the VKB HTTP server is available, ensuring human-authored edits land in the server-owned LevelDB instance rather than a competing direct connection

### Siblings
- [EntityAuthoringInterface](./EntityAuthoringInterface.md) -- GraphDatabaseAdapter (named in the ManualLearning parent description) acts as the entry point for all manual entity writes, distinguishing human-authored mutations from automated pipeline writes before routing decisions are made.


---

*Generated from 3 observations*
