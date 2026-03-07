# ResourceAllocator

**Type:** Detail

The ResourceAllocator would need to interact with the ProcessRegistry and StateManager to ensure that resource allocation and deallocation are properly synchronized with process instance creation and ...

## What It Is  

The **ResourceAllocator** is the component responsible for managing the lifecycle of system resources that are required by process instances.  According to the observations, it lives inside the **ProcessStateManager** module – *ProcessStateManager contains ResourceAllocator* – and therefore its implementation is co‑located with the state‑management logic that drives process execution.  No concrete file‑system paths were supplied in the source observations, so the exact location (e.g., `src/ProcessStateManager/ResourceAllocator.ts`) cannot be listed, but its logical home is clearly within the `ProcessStateManager` package.  

Its primary duties are three‑fold: (1) to stay in sync with **ProcessRegistry** and **StateManager** so that allocation and deallocation occur at the correct moments in a process’s life‑cycle; (2) to optimise utilisation through a pooling or caching strategy; and (3) to enforce per‑process resource constraints or quotas, protecting the overall system from a single runaway process.  In short, it is the gate‑keeper that guarantees that every process gets the resources it needs while the system remains stable and efficient.

## Architecture and Design  

The observations reveal a **co‑ordination‑centric** design in which **ResourceAllocator** acts as a collaborator of its parent **ProcessStateManager** and its siblings **ProcessRegistry** and **StateManager**.  The parent‑child relationship suggests a *composition* pattern: `ProcessStateManager` aggregates a `ResourceAllocator` instance, delegating allocation‑related responsibilities to it while retaining overall control of state transitions.  

Interaction with **ProcessRegistry** indicates a *lookup* or *service‑locator* style coupling – the allocator must query the registry to discover which process instances are currently active and therefore eligible for resource assignment.  The tie‑in with **StateManager** (which likely implements a finite‑state‑machine for process lifecycles) points to an *observer*‑like relationship: the allocator listens for state‑change events (e.g., *Initialized → Running* or *Running → Terminated*) and triggers allocation or de‑allocation accordingly.  

The optional pooling/caching mechanism described in observation 2 is a classic **Object Pool** pattern applied to scarce resources (e.g., database connections, thread workers, memory buffers).  By re‑using pre‑created resource objects, the allocator reduces allocation overhead and latency.  The quota‑enforcement role (observation 3) introduces a **Policy**‑oriented decision point: before granting a resource, the allocator checks a per‑process quota table and refuses or throttles requests that would exceed the limit.  No higher‑level architectural styles such as micro‑services or event‑driven pipelines are mentioned, so the design remains intra‑process and tightly coupled to the surrounding state‑management subsystem.

## Implementation Details  

Even though the source observations do not enumerate concrete classes or functions, the described responsibilities imply a small but focused API surface inside the **ProcessStateManager** package:

1. **`allocateResources(processId: string): AllocationHandle`** – invoked when the **StateManager** signals that a process has entered a state that requires resources (e.g., *Running*).  The method would consult the **ProcessRegistry** to verify the existence of the process, then either pull a resource from an internal pool or create a new one if the pool is exhausted and the quota permits.

2. **`releaseResources(handle: AllocationHandle): void`** – called when a process transitions to a terminal state (e.g., *Terminated*) or when a de‑allocation request is issued.  The handle is returned to the pool for future reuse, or the underlying resource is destroyed if pooling is not applicable.

3. **`enforceQuota(processId: string, requested: number): boolean`** – a private helper that reads a quota configuration (likely stored in a configuration file or a lightweight in‑memory map) and decides whether the requested amount of resources can be granted.  This function embodies the “prevent any single process from consuming excessive system resources” rule.

4. **`initializePool(poolSize: number): void`** – executed during **ProcessStateManager** start‑up, pre‑populating the pool with a configurable number of resource objects.  This aligns with the “resource pooling mechanism” mentioned in observation 2.

The **ResourceAllocator** would maintain internal state such as:
- A **resource pool** (e.g., a `Queue<Resource>` or `Stack<Resource>`).
- A **quota map** keyed by `processId` that tracks current consumption.
- References to the **ProcessRegistry** singleton (as indicated by the sibling description) and to the **StateManager** event emitter.

All interactions are expected to be synchronous or use lightweight async primitives, given that allocation must happen promptly when a state transition occurs.

## Integration Points  

The allocator’s primary integration points are:

* **ProcessRegistry** – accessed to verify that a `processId` is valid and to retrieve metadata (e.g., required resource types).  The sibling description suggests that **ProcessRegistry** follows a singleton pattern, so the allocator likely obtains a global instance via `ProcessRegistry.getInstance()`.

* **StateManager** – subscribes to state‑change events.  When **StateManager** publishes a transition (e.g., `onEnterRunning(processId)`), the allocator’s `allocateResources` method is called.  Conversely, on exit events the allocator releases resources.  This tight coupling ensures that resource lifetimes mirror process lifetimes.

* **ProcessStateManager** – as the parent, it owns the allocator instance and may expose higher‑level façade methods such as `startProcess(processId)` that internally coordinate registry lookup, state transition, and resource allocation in a single transaction.

* **Configuration subsystem** – not explicitly mentioned but implied by quota enforcement; the allocator would read a configuration file or environment variables that define per‑process limits and pool sizing.

No external services or network calls are evident from the observations, so the integration surface remains confined to the three sibling modules and internal configuration.

## Usage Guidelines  

1. **Never allocate manually** – developers should let **StateManager** drive allocation by transitioning processes through the defined states.  Direct calls to `allocateResources` bypass quota checks and can lead to resource leaks.

2. **Respect quotas** – if a process requires more resources than its configured quota, the allocator will reject the request.  Callers should handle the `false` return from `enforceQuota` (or the thrown exception) and either downgrade the workload or abort the process start.

3. **Pool sizing** – during system startup, configure the pool size to match expected concurrency.  Oversizing wastes memory; undersizing increases allocation latency.  Adjust `initializePool` parameters based on observed load patterns.

4. **Graceful shutdown** – before shutting down the application, invoke a clean‑up routine that drains the pool and ensures all allocated resources are released.  This prevents dangling handles that could block subsequent restarts.

5. **Testing** – unit tests should mock **ProcessRegistry** and **StateManager** to verify that allocation only occurs after a successful registration lookup and that quota enforcement behaves as expected.

---

### 1. Architectural patterns identified  
* **Composition** – `ProcessStateManager` contains a `ResourceAllocator`.  
* **Object Pool** – reuse of scarce resources to minimise allocation overhead.  
* **Policy/Quota enforcement** – per‑process constraints guard system stability.  
* **Observer‑like coupling** – allocator reacts to state‑change events from `StateManager`.  
* **Singleton access** – interaction with the globally‑available `ProcessRegistry`.

### 2. Design decisions and trade‑offs  
* **Tight coupling vs. flexibility** – By wiring the allocator directly to `StateManager` and `ProcessRegistry`, the system gains deterministic, low‑latency coordination, but it reduces the ability to replace one of those modules with an alternative implementation without changing the allocator.  
* **Pooling vs. on‑demand creation** – Pooling reduces latency and GC pressure at the cost of higher baseline memory consumption; the chosen pool size must balance these concerns.  
* **Quota enforcement location** – Placing quota checks inside the allocator centralises resource governance, but it also makes the allocator responsible for policy logic that could otherwise be externalised.

### 3. System structure insights  
The **ResourceAllocator** sits at the heart of the process‑execution pipeline: `ProcessRegistry` registers processes, `StateManager` drives their lifecycle, and `ResourceAllocator` ensures that each lifecycle step has the necessary resources.  This three‑component triangle forms the core of the runtime engine, with **ProcessStateManager** orchestrating the flow.

### 4. Scalability considerations  
* **Pool scalability** – As the number of concurrent processes grows, the pool must be sized accordingly; dynamic pool resizing could be added later to avoid a static limit.  
* **Quota granularity** – Fine‑grained quotas enable the system to support many heterogeneous workloads without one dominating resources.  
* **Lock contention** – The allocator’s internal data structures (pool queue, quota map) should be thread‑safe but low‑contention; using lock‑free queues or sharded maps can improve throughput under high concurrency.

### 5. Maintainability assessment  
Because the allocator’s responsibilities are well‑defined and confined to a single module, the codebase remains approachable.  The reliance on explicit interfaces (`ProcessRegistry`, `StateManager`) aids testability.  However, the lack of a formal abstraction layer for quota policies could make future extensions (e.g., dynamic quota adjustments) more invasive.  Documenting the event contracts between `StateManager` and the allocator, and keeping the pool implementation isolated, will preserve maintainability as the system evolves.


## Hierarchy Context

### Parent
- [ProcessStateManager](./ProcessStateManager.md) -- ProcessStateManager uses a ProcessRegistry module to store and retrieve process instances, enabling dynamic process discovery and registration

### Siblings
- [ProcessRegistry](./ProcessRegistry.md) -- The ProcessRegistry module is likely to be implemented as a singleton, providing a global point of access for process instances, similar to the pattern used in the DockerizedServices component.
- [StateManager](./StateManager.md) -- The StateManager would likely implement a finite state machine using an enumeration of states (e.g., Initialized, Running, Paused, Terminated) and define transitions between these states based on specific events or actions.


---

*Generated from 3 observations*
