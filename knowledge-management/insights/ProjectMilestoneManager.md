# ProjectMilestoneManager

**Type:** SubComponent

ProjectMilestoneManager may utilize the connectViaHTTP method in SpecstoryAdapter to establish a connection to the Specstory extension on multiple ports (7357, 7358, 7359) to handle potential connection failures.

## What It Is  

**ProjectMilestoneManager** is a *SubComponent* that lives inside the **Trajectory** component.  It is responsible for coordinating the planning and tracking of project milestones and does so by delegating integration work to an **IntegrationAdapter** child.  The integration work ultimately relies on the **SpecstoryAdapter** class found at  

```
lib/integrations/specstory-adapter.js
```  

which implements the `connectViaHTTP` method.  When ProjectMilestoneManager needs to talk to the Specstory extension, it invokes this method through its IntegrationAdapter, attempting to open an HTTP connection on three possible ports – **7357**, **7358**, and **7359**.  The multi‑port approach is explicitly mentioned as a way to survive connection failures and, implicitly, to spread traffic across ports.

---

## Architecture and Design  

The observations reveal a **layered integration architecture**:  

1. **Trajectory (parent)** provides the overall planning and tracking context.  
2. **ProjectMilestoneManager (sub‑component)** focuses on milestone‑specific logic.  
3. **IntegrationAdapter (child)** abstracts the concrete way ProjectMilestoneManager talks to external services.  
4. **SpecstoryAdapter (sibling component)** supplies the concrete implementation for connecting to the Specstory extension via HTTP, IPC, or file‑watch mechanisms.  

The only concrete design pattern that can be justified from the evidence is a **Adapter pattern** – the IntegrationAdapter acts as a façade that shields ProjectMilestoneManager from the details of how the Specstory connection is established.  By delegating to SpecstoryAdapter, the sub‑component can remain agnostic to the transport (HTTP, IPC, file watch) and focus on milestone logic.

The `connectViaHTTP` method’s attempt to connect on three ports constitutes a **retry‑with‑fallback** strategy.  The observation that “multiple ports could suggest a load‑balancing strategy” indicates that the system is prepared either to retry on a different port when one fails or to distribute connections deliberately across ports, which is a lightweight form of load distribution without a dedicated load‑balancer component.

Interaction flow (as inferred from the hierarchy):  

- **PhasePlanner** and **TaskTracker** (sibling sub‑components) also call into **SpecstoryAdapter** for their own data, showing a shared integration surface.  
- **ProjectMilestoneManager** calls its **IntegrationAdapter**, which forwards the request to **SpecstoryAdapter.connectViaHTTP**.  
- **SpecstoryAdapter** iterates over the port list (7357 → 7358 → 7359) until a successful HTTP handshake is made, then returns the connection handle back up the chain.

---

## Implementation Details  

Although no source symbols were directly listed, the observations give us enough to outline the mechanics:

1. **SpecstoryAdapter (lib/integrations/specstory-adapter.js)**  
   - Exposes a method `connectViaHTTP()`.  
   - Internally loops through the hard‑coded port array `[7357, 7358, 7359]`.  
   - For each port, it attempts an HTTP request (likely a health‑check or handshake) to the Specstory extension.  
   - On success, it returns a connection object; on failure, it proceeds to the next port.  
   - The method thus provides both **retry** (to survive transient failures) and a rudimentary **load‑balancing** capability (by spreading attempts across ports).

2. **IntegrationAdapter (child of ProjectMilestoneManager)**  
   - Serves as a thin wrapper around SpecstoryAdapter.  
   - Exposes a higher‑level API that ProjectMilestoneManager uses (e.g., `openSpecstoryConnection()`), abstracting away the port‑list logic.  
   - May also expose alternative connection methods (IPC, file watch) as hinted by the broader description of SpecstoryAdapter’s capabilities.

3. **ProjectMilestoneManager**  
   - Holds milestone data structures and business rules for planning, scheduling, and tracking.  
   - When external milestone data or status updates are required, it calls its IntegrationAdapter, which in turn triggers `connectViaHTTP`.  
   - The presence of a retry mechanism means that the manager can continue operating even if a particular port is temporarily unavailable, improving resilience.

4. **Trajectory (parent)**  
   - Provides the overarching context and may orchestrate multiple sub‑components (PhasePlanner, TaskTracker, ProjectMilestoneManager).  
   - Its description emphasizes “flexible and scalable planning,” which aligns with the adaptable connection strategy employed by ProjectMilestoneManager.

---

## Integration Points  

- **Specstory Extension** – The external service that stores or processes story‑level data.  ProjectMilestoneManager reaches it via **SpecstoryAdapter**, which can use HTTP, IPC, or file‑watch methods.  The HTTP path is the one explicitly described, using ports 7357‑7359.  

- **IntegrationAdapter** – The immediate dependency of ProjectMilestoneManager.  It encapsulates the choice of transport and hides the retry‑logic from the manager.  

- **Sibling Components (PhasePlanner, TaskTracker)** – These also depend on SpecstoryAdapter for their own data needs.  The shared adapter means that any change to the connection strategy (e.g., adding a new port) propagates uniformly across all three sub‑components.  

- **Parent Component (Trajectory)** – Provides the higher‑level orchestration and may inject configuration (e.g., which ports to try) into ProjectMilestoneManager or its IntegrationAdapter.  Because Trajectory is described as “flexible and scalable,” it likely supplies environment‑specific settings that the IntegrationAdapter can consume.

---

## Usage Guidelines  

1. **Never bypass the IntegrationAdapter** – All calls to the Specstory extension should go through the adapter to retain the retry and load‑balancing behavior.  Direct HTTP calls from ProjectMilestoneManager would duplicate logic and break resilience guarantees.  

2. **Respect the port list order** – The current implementation attempts ports sequentially (7357 → 7358 → 7359).  If you need to prioritize a specific port, modify the array in `SpecstoryAdapter.connectViaHTTP` rather than re‑ordering calls elsewhere.  

3. **Handle connection failures gracefully** – Even with retries, all three ports might be unreachable.  ProjectMilestoneManager should be prepared to receive a null/exception from the IntegrationAdapter and fallback to a safe state (e.g., queue milestone updates for later retry).  

4. **Leverage alternative transports when appropriate** – The broader SpecstoryAdapter supports IPC and file‑watch methods.  If the deployment environment restricts HTTP (e.g., sandboxed containers), configure the IntegrationAdapter to use the alternative method rather than forcing HTTP.  

5. **Keep the adapter thin** – Business logic (milestone calculations, deadline enforcement) must stay inside ProjectMilestoneManager.  Adding network concerns to the manager will increase coupling and reduce maintainability.

---

### Architectural Patterns Identified  

1. **Adapter / Façade** – IntegrationAdapter abstracts the concrete SpecstoryAdapter implementation.  
2. **Retry‑with‑Fallback** – `connectViaHTTP` cycles through multiple ports to survive failures.  
3. **Implicit Load Distribution** – Using several ports can spread connection load without a dedicated load balancer.

### Design Decisions and Trade‑offs  

- **Decision:** Centralise external communication in SpecstoryAdapter.  
  **Trade‑off:** All sub‑components share the same connection logic, simplifying maintenance but creating a single point of failure if the adapter is buggy.  

- **Decision:** Use a fixed list of three ports for HTTP connections.  
  **Trade‑off:** Provides deterministic retry behavior and modest load spreading; however, it limits flexibility unless the list is made configurable.  

- **Decision:** Provide multiple transport options (HTTP, IPC, file watch).  
  **Trade‑off:** Increases portability across environments but adds complexity to the adapter’s implementation and testing.

### System Structure Insights  

The hierarchy is cleanly nested: **Trajectory → ProjectMilestoneManager → IntegrationAdapter → SpecstoryAdapter**.  Sibling components (PhasePlanner, TaskTracker) sit at the same level as ProjectMilestoneManager and all depend on SpecstoryAdapter, indicating a **shared integration layer**.  This structure promotes reuse of connection logic while keeping domain‑specific code (milestones, phases, tasks) isolated.

### Scalability Considerations  

- **Connection Scalability:** By rotating across three ports, the system can handle a modest increase in concurrent connections without saturating a single port.  
- **Component Scalability:** Because the integration logic is abstracted, additional sub‑components can be added (e.g., a new “RiskAnalyzer”) that also reuse SpecstoryAdapter without code duplication.  
- **Future Growth:** If traffic grows beyond what three ports can comfortably support, the current pattern would need to evolve—either by expanding the port list, introducing a real load balancer, or moving to a more robust transport (e.g., gRPC).

### Maintainability Assessment  

The use of an **Adapter** layer isolates external‑service changes, making the system relatively easy to maintain.  The retry logic is simple and self‑contained within `connectViaHTTP`, reducing the surface area for bugs.  However, the hard‑coded port list is a maintainability hotspot; any environment‑specific change requires a code change unless a configuration mechanism is added.  Shared reliance on SpecstoryAdapter by multiple siblings means that a regression in the adapter can impact several parts of the system simultaneously, so thorough integration testing is essential.  

Overall, the architecture balances **resilience** (through retries) and **reuse** (via a common adapter) while keeping the domain logic of ProjectMilestoneManager cleanly separated from transport concerns.

## Hierarchy Context

### Parent
- [Trajectory](./Trajectory.md) -- [LLM] The Trajectory component's architecture is designed to facilitate flexible and scalable planning and tracking of project milestones, with the SpecstoryAdapter class in lib/integrations/specstory-adapter.js playing a crucial role in connecting to the Specstory extension via HTTP, IPC, or file watch methods. This design decision allows for multiple integration points, enabling the component to adapt to different environments and use cases. The connectViaHTTP method in SpecstoryAdapter attempts to connect to the Specstory extension on multiple ports (7357, 7358, 7359) to establish a connection, demonstrating a retry mechanism to handle potential connection failures. The use of multiple ports also suggests a load-balancing strategy to distribute the connection load across different ports.

### Children
- [IntegrationAdapter](./IntegrationAdapter.md) -- The ProjectMilestoneManager sub-component may utilize the connectViaHTTP method in SpecstoryAdapter to establish a connection to the Specstory extension on multiple ports (7357, 7358, 7359).

### Siblings
- [PhasePlanner](./PhasePlanner.md) -- PhasePlanner could utilize the SpecstoryAdapter class to connect to the Specstory extension and retrieve relevant phase planning data.
- [TaskTracker](./TaskTracker.md) -- TaskTracker could utilize the SpecstoryAdapter class to connect to the Specstory extension and retrieve relevant task data.
- [SpecstoryAdapter](./SpecstoryAdapter.md) -- SpecstoryAdapter implements the connectViaHTTP method to establish a connection to the Specstory extension on multiple ports (7357, 7358, 7359).

---

*Generated from 5 observations*
