# ProcessRegistry

**Type:** Detail

The ProcessRegistry would need to interact with the StateManager to ensure that process states are updated correctly during registration and discovery, possibly through a callback mechanism or event-d...

## What It Is  

The **ProcessRegistry** is a core module that acts as the authoritative catalogue of live process instances inside the system. Although the current source snapshot does not expose concrete file‑system locations (the observation set reports *“0 code symbols found”* and no explicit paths), the design intent is clear from the documentation: the registry is meant to be a **singleton** – a single, globally‑accessible object that any component can query or update. It lives under the umbrella of the **ProcessStateManager** component, which *“contains ProcessRegistry”*, indicating that the registry is a sub‑module of the state‑management layer rather than a top‑level service. Its primary responsibilities are to **register** newly created process instances, **store** identifying metadata (process ID, instance ID, etc.), and **enable dynamic discovery** of those instances for other runtime services such as the **ResourceAllocator** and the **StateManager**.

## Architecture and Design  

The observations point to three inter‑related architectural choices:

1. **Singleton Pattern** – The registry is described as “likely to be implemented as a singleton, providing a global point of access for process instances, similar to the pattern used in the DockerizedServices component.” This suggests that the system relies on a single, in‑memory registry instance that can be reached from any part of the codebase without explicit dependency injection. The singleton approach simplifies lookup logic but also introduces a shared mutable state that must be guarded against race conditions.

2. **Callback / Event‑Driven Interaction with StateManager** – The registry “would need to interact with the StateManager to ensure that process states are updated correctly during registration and discovery, possibly through a callback mechanism or event‑driven architecture.” This indicates a loosely‑coupled communication style where the **ProcessStateManager** (the parent) subscribes to registry events (e.g., *processRegistered*, *processDeregistered*) or supplies callbacks that the registry invokes when its internal map changes. The design avoids tight coupling while still guaranteeing that state transitions stay in sync with registration activity.

3. **Metadata Repository / Persistence Layer** – To support “dynamic process discovery,” the registry “might utilize a metadata repository or a database to store process instance information.” Rather than being a pure in‑memory hash map, the registry is expected to persist key attributes (process IDs, instance IDs, timestamps, possibly resource footprints). This persistence layer can be a lightweight embedded store (e.g., SQLite) or an external key‑value service, and it serves as the source of truth for discovery queries issued by the **ResourceAllocator** and other consumers.

These three pillars together shape a **centralized discovery service** that sits inside the state‑management hierarchy, exposing a simple API while delegating state consistency and durability concerns to its neighbours.

## Implementation Details  

Even though the source tree does not list concrete symbols, the conceptual implementation can be inferred:

* **Singleton Access** – A typical implementation would expose a static method such as `ProcessRegistry.getInstance()` that lazily constructs the sole registry object. Internally, the registry would hold a thread‑safe collection (e.g., `ConcurrentHashMap<String, ProcessInfo>`) where the key is a composite of process ID and instance ID, and the value is a data holder (`ProcessInfo`) containing the metadata needed for discovery.

* **Registration API** – Public methods like `register(ProcessInfo info)` and `deregister(String processId, String instanceId)` would be the entry points used by the **ProcessStateManager** when a new process is spawned or terminated. These methods would perform validation, update the in‑memory map, and then invoke any registered callbacks or publish events (e.g., via an internal `EventBus`).

* **Callback / Event Mechanism** – The registry would maintain a list of listener objects supplied by the **StateManager** (and possibly the **ResourceAllocator**). Listeners conform to a simple interface, e.g., `ProcessRegistryListener { void onProcessAdded(ProcessInfo); void onProcessRemoved(ProcessInfo); }`. When a registration change occurs, the registry iterates over the listeners and calls the appropriate method. If an event‑bus is preferred, the registry would publish messages to a topic such as `process.registry.change`, allowing any interested component to react asynchronously.

* **Persistence Hook** – Upon each mutation, the registry would forward the `ProcessInfo` to a persistence adapter. This adapter abstracts the underlying storage (SQL, NoSQL, flat file) and implements `save(ProcessInfo)` and `delete(ProcessInfo)`. The abstraction allows the system to switch storage back‑ends without touching the core registry logic. During startup, the registry would invoke a `loadAll()` routine to hydrate the in‑memory map from the persisted store, ensuring that discovery works even after a process restart.

* **Discovery API** – Consumers would call methods such as `findByProcessId(String pid)` or `listAll()` to retrieve current instances. The API would return immutable snapshots to prevent callers from inadvertently corrupting the internal state.

## Integration Points  

The **ProcessRegistry** sits at the nexus of three major components:

* **ProcessStateManager (Parent)** – The parent owns the registry and uses it to keep its finite‑state machine in step with the lifecycle of each process. When the **StateManager** receives a state transition event (e.g., *Running → Paused*), it may first verify that the corresponding process entry exists in the registry, then update the state and optionally emit a registry event to notify other services.

* **StateManager (Sibling)** – While the sibling **StateManager** focuses on the abstract state machine, it shares the need for consistent process identification. Both components likely agree on the same `ProcessInfo` schema and may register the same callbacks, ensuring that state changes and registry updates are atomic from the system’s perspective.

* **ResourceAllocator (Sibling)** – The **ResourceAllocator** must allocate CPU, memory, or I/O resources based on the set of active processes. It will query the registry (e.g., `listAll()`) to discover which instances are currently alive and then map those to resource pools. Because allocation decisions can affect process health, the allocator may also subscribe to registry events so that it can release resources immediately when a process deregisters.

* **Persistence Layer** – Though not a sibling in the component diagram, the underlying metadata repository is a critical integration point. The registry’s persistence adapter must expose a stable contract (`save`, `delete`, `loadAll`) that the rest of the system can rely on for durability guarantees.

All interactions are mediated through well‑defined interfaces (registration API, listener callbacks, persistence adapter), minimizing direct coupling and enabling unit testing of each component in isolation.

## Usage Guidelines  

1. **Always Access via the Singleton** – Code should never instantiate a `new ProcessRegistry()`. Use the provided accessor (`ProcessRegistry.getInstance()`) to guarantee a single source of truth. This also ensures that any internal initialization (loading persisted entries, wiring listeners) occurs exactly once.

2. **Register Before State Transitions** – When a new process is launched, the creator must first call `register` with a fully populated `ProcessInfo`. Only after successful registration should the **ProcessStateManager** transition the process into its initial state. This ordering prevents the state machine from operating on an unknown entity.

3. **Handle Callbacks Idempotently** – Listener implementations (e.g., in **StateManager** or **ResourceAllocator**) should be defensive: the same event may be delivered more than once due to retries or race conditions. Listeners must therefore check the current registry state before acting on an event.

4. **Persist Consistently** – The persistence adapter should be configured with transactional guarantees appropriate to the chosen store. If the registry writes to a relational database, wrap `save`/`delete` calls in a transaction that also updates any related audit tables to avoid partial updates.

5. **Avoid Long‑Running Operations Inside Callbacks** – Callbacks should be quick and non‑blocking. If a listener needs to perform heavy work (e.g., provisioning resources), it should off‑load that work to an asynchronous worker pool rather than blocking the registry’s event dispatch loop.

6. **Graceful Shutdown** – During application shutdown, invoke a `shutdown()` method on the registry (if provided) to flush any pending persistence operations and deregister listeners. This helps prevent lost updates and ensures that the persisted metadata accurately reflects the final system state.

---

### Architectural patterns identified  

* **Singleton** – Guarantees a single, globally reachable registry instance.  
* **Observer / Callback** – Registry notifies interested parties (StateManager, ResourceAllocator) of changes via listeners or an event bus.  
* **Repository / Persistence Abstraction** – Decouples in‑memory storage from the underlying metadata store, allowing interchangeable back‑ends.

### Design decisions and trade‑offs  

* **Singleton vs. Dependency Injection** – The singleton simplifies lookup but makes testing harder; a DI‑friendly wrapper could mitigate this.  
* **In‑Memory + Persistent Store** – Combining fast lookups with durability improves performance but introduces consistency challenges (e.g., reconciling in‑memory state with persisted data after crashes).  
* **Callback vs. Full Event Bus** – Callbacks are lightweight but tightly couple listeners to the registry; an external event bus would further decouple components at the cost of added infrastructure.

### System structure insights  

* **ProcessRegistry** is a child of **ProcessStateManager**, exposing a narrow API focused on process metadata.  
* It shares the same lifecycle concerns with sibling components (**StateManager**, **ResourceAllocator**) that also depend on accurate process discovery.  
* The registry acts as the glue that synchronizes state transitions, resource allocation, and persistence.

### Scalability considerations  

* Because the registry is a singleton, it is inherently limited to a single JVM instance. Scaling horizontally would require sharding the registry or moving to a distributed store (e.g., etcd, Redis) and replacing the singleton with a client façade.  
* The current design’s reliance on in‑memory maps is performant for modest numbers of processes; however, large fleets may cause memory pressure and slower iteration over `listAll()`. Pagination or filtered queries in the persistence layer would mitigate this.

### Maintainability assessment  

* The clear separation of concerns (registration logic, event notification, persistence) promotes modularity and eases unit testing.  
* The lack of explicit file paths in the current snapshot makes navigation harder; adding a dedicated package (e.g., `com.example.process.registry`) with well‑named classes would improve discoverability.  
* Documentation of the listener contract and persistence adapter interface is essential to prevent accidental breaking changes, especially if the underlying storage technology evolves.  

Overall, the **ProcessRegistry** is designed as a centralized, singleton‑based catalogue that leverages callbacks/event notifications and a pluggable persistence layer to keep the rest of the system (state management and resource allocation) in lock‑step with the lifecycle of process instances.


## Hierarchy Context

### Parent
- [ProcessStateManager](./ProcessStateManager.md) -- ProcessStateManager uses a ProcessRegistry module to store and retrieve process instances, enabling dynamic process discovery and registration

### Siblings
- [StateManager](./StateManager.md) -- The StateManager would likely implement a finite state machine using an enumeration of states (e.g., Initialized, Running, Paused, Terminated) and define transitions between these states based on specific events or actions.
- [ResourceAllocator](./ResourceAllocator.md) -- The ResourceAllocator would need to interact with the ProcessRegistry and StateManager to ensure that resource allocation and deallocation are properly synchronized with process instance creation and state transitions.


---

*Generated from 3 observations*
