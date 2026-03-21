# PhasePlanner

**Type:** SubComponent

PhasePlanner could utilize the SpecstoryAdapter class to connect to the Specstory extension and retrieve relevant phase planning data.

## What It Is  

PhasePlanner is a **sub‑component** that lives inside the **Trajectory** component.  Although no source files are listed directly for PhasePlanner, its responsibilities are inferred from the surrounding architecture: it orchestrates the ordering and execution of project phases by pulling data from the **Specstory** extension (via `SpecstoryAdapter`) and by consulting the **ProjectMilestoneManager** for milestone context.  The component is therefore the logical bridge between raw phase‑planning data supplied by Specstory and the higher‑level milestone‑driven workflow that Trajectory manages.  In practice, a PhasePlanner instance will request phase definitions, apply a topological sort to guarantee a dependency‑respecting order, and then hand the ordered list back to Trajectory for downstream processing.

## Architecture and Design  

The design that emerges from the observations is a **layered, adapter‑driven architecture**.  The `SpecstoryAdapter` class (found at `lib/integrations/specstory-adapter.js`) implements the **Adapter pattern**, exposing a uniform `connectViaHTTP` method that hides the details of communicating with the external Specstory extension.  PhasePlanner consumes this adapter rather than speaking HTTP, IPC, or file‑watch protocols directly, which keeps PhasePlanner focused on its core domain logic.  

Within PhasePlanner, the primary algorithmic pattern is a **topological sort**.  By sorting phases according to their dependency graph, PhasePlanner guarantees that each phase is scheduled only after all prerequisite phases have been completed.  This deterministic ordering is essential for the “correct project execution” guarantee mentioned in the observations.  

Two cross‑cutting concerns—**load balancing** and **retry**—are inherited from the adapter.  `connectViaHTTP` attempts connections on three ports (7357, 7358, 7359).  This multi‑port approach serves both as a simple load‑balancing mechanism (spreading connection attempts across ports) and as a retry strategy that gracefully handles transient failures.  PhasePlanner does not re‑implement these mechanisms; it relies on the adapter’s built‑in resilience, reinforcing a **separation‑of‑concerns** design.

## Implementation Details  

1. **SpecstoryAdapter (`lib/integrations/specstory-adapter.js`)** – The adapter provides `connectViaHTTP`, which iterates over the port list `[7357, 7358, 7359]`.  For each port it attempts an HTTP handshake with the Specstory extension; on failure it proceeds to the next port, effectively retrying up to three times.  Successful connection yields a client object that PhasePlanner can use to request phase data.  

2. **PhasePlanner (implicit implementation)** – Upon initialization PhasePlanner obtains a reference to `SpecstoryAdapter` (likely via constructor injection or a service locator in the Trajectory context).  It then calls a method such as `adapter.fetchPhaseData()` (the exact name is not enumerated but is implied by “retrieve relevant phase planning data”).  The raw data, which includes phase identifiers and dependency edges, is fed into a topological‑sort routine.  The sort can be implemented with classic depth‑first search or Kahn’s algorithm; the observation only guarantees that the sort exists, not the exact implementation.  

3. **ProjectMilestoneManager (sibling component)** – PhasePlanner depends on this manager to enrich phase information with milestone timestamps, status flags, or constraints.  The interaction is likely a method call such as `milestoneManager.getMilestonesForPhase(phaseId)`.  This dependency ensures that phase ordering respects higher‑level milestone deadlines.  

4. **Retry & Load‑Balancing Integration** – Because the adapter already handles port‑level retries, PhasePlanner’s own retry logic is limited to handling higher‑level failures (e.g., malformed data).  The load‑balancing effect is passive; PhasePlanner simply uses whichever connection the adapter succeeded on, without needing to manage connection pools.

## Integration Points  

- **Parent – Trajectory**: Trajectory owns PhasePlanner and invokes it when a new project plan is being assembled.  After PhasePlanner returns an ordered list of phases, Trajectory can integrate this list into its broader milestone‑tracking workflow.  

- **Sibling – ProjectMilestoneManager**: PhasePlanner calls into ProjectMilestoneManager to fetch milestone metadata, ensuring that phase sequencing aligns with milestone constraints.  Conversely, ProjectMilestoneManager may also call `SpecstoryAdapter.connectViaHTTP` directly (as noted in the sibling description), indicating that both components share the same integration surface.  

- **Sibling – TaskTracker**: While TaskTracker focuses on task‑level data, it also uses `SpecstoryAdapter`.  This common dependency suggests that any change to the adapter’s connection strategy (e.g., adding a new port) will automatically propagate to PhasePlanner, TaskTracker, and ProjectMilestoneManager, preserving consistency across the system.  

- **External – Specstory Extension**: The ultimate data source is the Specstory extension, reachable via HTTP on ports 7357‑7359.  PhasePlanner never contacts Specstory directly; it relies on the adapter’s `connectViaHTTP` method, which encapsulates all networking concerns.  

## Usage Guidelines  

1. **Instantiate via Trajectory** – Developers should never create a PhasePlanner instance in isolation.  Instead, obtain it from the Trajectory component’s factory or service container, ensuring that the same `SpecstoryAdapter` and `ProjectMilestoneManager` instances are shared across siblings.  

2. **Handle Adapter Failures Gracefully** – Although `SpecstoryAdapter.connectViaHTTP` retries across three ports, the call can still fail (e.g., if the Specstory service is down).  PhasePlanner callers must be prepared to catch connection‑related exceptions and either surface a user‑friendly error or trigger a higher‑level retry policy defined by Trajectory.  

3. **Validate Phase Graph Before Sorting** – Because the topological sort assumes an acyclic dependency graph, callers should validate that the phase data retrieved from Specstory contains no cycles.  If a cycle is detected, PhasePlanner should raise a specific `CycleDetectedError` (or similar) so that the issue can be addressed upstream.  

4. **Leverage Milestone Context** – When invoking PhasePlanner, provide any known milestone constraints to the `ProjectMilestoneManager` first.  This ensures that the subsequent phase ordering respects both dependency and milestone timing requirements.  

5. **Avoid Direct Adapter Calls** – Even though the adapter is public, PhasePlanner should be the sole consumer of phase‑planning data.  Direct calls to `SpecstoryAdapter` from other modules can lead to duplicated connection logic and make future changes to the adapter harder to coordinate.  

---

### Architectural Patterns Identified  
* **Adapter Pattern** – `SpecstoryAdapter` abstracts multiple connection mechanisms (HTTP, IPC, file watch) behind a uniform API.  
* **Topological Sort Algorithm** – Guarantees dependency‑respecting phase ordering.  
* **Retry / Load‑Balancing via Multi‑Port Strategy** – Implemented in `connectViaHTTP`.  

### Design Decisions & Trade‑offs  
* **Centralized Adapter** reduces coupling but makes the adapter a single point of failure; the multi‑port retry mitigates this.  
* **Topological Sort** provides deterministic ordering but requires acyclic input; validation overhead is a trade‑off.  
* **Dependency on ProjectMilestoneManager** enriches phase data but introduces tighter coupling between planning and milestone subsystems.  

### System Structure Insights  
PhasePlanner sits as a leaf under Trajectory, sharing the `SpecstoryAdapter` with TaskTracker and ProjectMilestoneManager.  This shared adapter creates a cohesive integration layer for all components that need Specstory data.  

### Scalability Considerations  
* **Connection Scalability** – The three‑port approach distributes load modestly; adding more ports or a proper load balancer could improve throughput under heavy usage.  
* **Algorithmic Scalability** – Topological sort runs in O(V + E); it scales linearly with the number of phases and dependencies, which is suitable for typical project sizes.  

### Maintainability Assessment  
The clear separation of concerns—adapter handling connectivity, PhasePlanner handling ordering, and MilestoneManager handling scheduling—makes the codebase relatively easy to maintain.  Because the adapter encapsulates all retry and load‑balancing logic, changes to connection strategy are localized.  However, the implicit reliance on a specific port list (7357‑7359) means that any environment‑specific changes require updates in a single place (`SpecstoryAdapter`) but must be communicated to all dependent components.  Overall, the architecture promotes maintainability while keeping the critical path (phase ordering) simple and well‑defined.

## Hierarchy Context

### Parent
- [Trajectory](./Trajectory.md) -- [LLM] The Trajectory component's architecture is designed to facilitate flexible and scalable planning and tracking of project milestones, with the SpecstoryAdapter class in lib/integrations/specstory-adapter.js playing a crucial role in connecting to the Specstory extension via HTTP, IPC, or file watch methods. This design decision allows for multiple integration points, enabling the component to adapt to different environments and use cases. The connectViaHTTP method in SpecstoryAdapter attempts to connect to the Specstory extension on multiple ports (7357, 7358, 7359) to establish a connection, demonstrating a retry mechanism to handle potential connection failures. The use of multiple ports also suggests a load-balancing strategy to distribute the connection load across different ports.

### Siblings
- [ProjectMilestoneManager](./ProjectMilestoneManager.md) -- ProjectMilestoneManager may utilize the connectViaHTTP method in SpecstoryAdapter to establish a connection to the Specstory extension on multiple ports (7357, 7358, 7359) to handle potential connection failures.
- [TaskTracker](./TaskTracker.md) -- TaskTracker could utilize the SpecstoryAdapter class to connect to the Specstory extension and retrieve relevant task data.
- [SpecstoryAdapter](./SpecstoryAdapter.md) -- SpecstoryAdapter implements the connectViaHTTP method to establish a connection to the Specstory extension on multiple ports (7357, 7358, 7359).

---

*Generated from 5 observations*
