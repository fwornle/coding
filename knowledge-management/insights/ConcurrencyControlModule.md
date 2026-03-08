# ConcurrencyControlModule

**Type:** SubComponent

ConcurrencyControlModule uses a locking mechanism, such as acquireLock() in locking-mechanism.ts, to prevent data inconsistencies when multiple components are accessing the knowledge graph simultaneously.

## What It Is  

The **ConcurrencyControlModule** lives inside the *KnowledgeManagement* component and is responsible for guaranteeing safe, concurrent access to the shared knowledge graph.  Its concrete implementation can be seen in a set of TypeScript files that together provide a lock‑based coordination layer:

* `locking‑mechanism.ts` – defines the core lock primitives (`acquireLock()` and the counterpart `releaseLock()`).
* `deadlock‑detection.ts` – supplies a `detectDeadlock()` routine that scans held locks and resolves contention.
* `timeout‑mechanism.ts` – offers a `setTimeout()`‑based guard that forces lock release after a configurable period.
* `logging.ts` – implements `logConcurrencyControl()` to record lock activity for audit and debugging.

The module is declared as a **SubComponent** of *KnowledgeManagement* and itself contains the child component **LockingMechanism**.  It works closely with sibling modules such as **PersistenceModule**, **GraphDatabaseModule**, **ManualLearning**, **OnlineLearning**, **CodeGraphModule**, and **OntologyModule**, all of which ultimately rely on the same underlying graph database via the `GraphDatabaseAdapter` (see `storage/graph-database-adapter.ts`).  By mediating access, the ConcurrencyControlModule prevents the data inconsistencies that could arise when those siblings issue overlapping write or read‑modify‑write operations.

---

## Architecture and Design  

The architecture follows a **centralized lock manager** pattern.  All components that need to read or mutate the knowledge graph must first invoke `acquireLock()` (found in `locking‑mechanism.ts`).  The lock manager tracks which component holds which lock, and the lock is released explicitly via `releaseLock()` once the operation completes.  This simple acquire/release contract enforces **mutual exclusion** without requiring each caller to implement its own synchronization logic.

To guard against the classic pitfalls of lock‑based designs, the module augments the lock manager with two complementary mechanisms:

1. **Deadlock detection** – `detectDeadlock()` (in `deadlock‑detection.ts`) periodically examines the lock‑ownership graph for cycles.  When a cycle is found, the routine can break the deadlock by aborting one of the waiting requests and forcing its lock release.  This keeps the system from stalling indefinitely.

2. **Timeout enforcement** – `setTimeout()` (in `timeout‑mechanism.ts`) attaches a maximum hold time to each lock acquisition.  If a component exceeds this window, the timeout handler automatically releases the lock, ensuring that stray or crashed processes do not monopolise resources.

Both mechanisms are **orthogonal** to the core lock manager: they observe the same lock state but do not alter the basic acquire/release API.  This separation makes the design easier to reason about and test.  

The module also integrates a **logging concern** (`logConcurrencyControl()` in `logging.ts`).  Every lock acquisition, release, timeout, and deadlock resolution is recorded, providing an audit trail that is valuable for debugging concurrent failures and for compliance reporting.

Because the ConcurrencyControlModule sits directly under *KnowledgeManagement*, it shares the same **graph‑database‑centric** orientation as its siblings.  The lock manager does not embed any knowledge‑graph‑specific logic; instead, it treats the graph as an opaque resource that must be protected, allowing the same concurrency controls to be reused by **PersistenceModule**, **OnlineLearning**, **ManualLearning**, **CodeGraphModule**, and **OntologyModule**.

---

## Implementation Details  

### Locking Mechanism (`locking‑mechanism.ts`)  
* **`acquireLock(resourceId: string, ownerId: string): Promise<boolean>`** – attempts to obtain an exclusive lock on a named resource (e.g., a sub‑graph or entity collection).  The function returns a promise that resolves to `true` when the lock is granted, otherwise it blocks (or rejects) until the lock becomes available.  
* **`releaseLock(resourceId: string, ownerId: string): void`** – removes the lock entry, making the resource available for other owners.  The implementation records the release event via `logConcurrencyControl()`.

Internally, the file maintains an in‑memory map (`Map<string, LockInfo>`) where each key is a `resourceId` and the value records the current `ownerId`, a timestamp, and any waiting queue.  This map is the single source of truth for lock state.

### Deadlock Detection (`deadlock‑detection.ts`)  
* **`detectDeadlock(): void`** – runs on a timer (e.g., every few seconds).  It builds a wait‑for graph from the lock map, then applies a cycle‑detection algorithm (depth‑first search).  Upon finding a cycle, the routine selects a victim (typically the youngest lock holder) and forces its release, again logging the event.  

The deadlock detector is deliberately **passive**: it does not interfere with normal lock acquisition unless a cycle is detected, thereby minimizing performance impact.

### Timeout Mechanism (`timeout‑mechanism.ts`)  
* **`setTimeout(resourceId: string, ownerId: string, durationMs: number): void`** – registers a timer when a lock is granted.  If the timer expires before `releaseLock()` is called, the timeout handler automatically invokes `releaseLock()` and logs a timeout‑forced release.  

Timeout values are configurable per‑resource, allowing fine‑grained control (e.g., longer timeouts for bulk import jobs, shorter ones for quick look‑ups).

### Logging (`logging.ts`)  
* **`logConcurrencyControl(event: ConcurrencyEvent): void`** – serialises lock events (acquire, release, timeout, deadlock resolution) to the system logger.  The event payload includes timestamps, `resourceId`, `ownerId`, and the reason for the event, facilitating post‑mortem analysis.

### Interaction with Persistence and Graph Modules  
When **PersistenceModule** or any sibling component needs to persist an entity, it first calls `acquireLock(entityId, componentName)`.  After the write operation completes via the `GraphDatabaseAdapter`, the component calls `releaseLock(entityId, componentName)`.  The lock manager therefore acts as a thin façade that isolates the graph‑database code from concurrency concerns, keeping the persistence logic simple and deterministic.

---

## Integration Points  

1. **Parent – KnowledgeManagement**  
   The ConcurrencyControlModule is declared inside *KnowledgeManagement*, meaning its lifecycle is managed together with the other knowledge‑graph‑related sub‑components.  Any initialization code for the parent (e.g., configuration loading) can propagate timeout thresholds or deadlock‑detection intervals to the module.

2. **Sibling Modules**  
   *PersistenceModule*, *OnlineLearning*, *ManualLearning*, *CodeGraphModule*, and *OntologyModule* all rely on the same `GraphDatabaseAdapter`.  By routing their write paths through the ConcurrencyControlModule, they share a uniform concurrency contract, reducing the risk of divergent lock handling strategies.

3. **Child – LockingMechanism**  
   The child component encapsulated as **LockingMechanism** is essentially the code in `locking‑mechanism.ts`.  It is the only place where lock state is mutated, ensuring a single point of truth.  Other children (e.g., potential future “ReadOnlyLock” or “VersionedLock”) could be added without disturbing the existing API.

4. **External Observability**  
   The logging hook (`logConcurrencyControl()`) can be wired to external monitoring systems (e.g., Prometheus, ELK) to surface lock contention metrics, timeout rates, and deadlock incidents.  This integration is implicit in the design: every lock‑related event is emitted through a single logging façade.

5. **Configuration Interfaces**  
   While the observations do not expose a concrete configuration file, the presence of timeout and deadlock detection suggests that the module reads runtime parameters (e.g., default lock TTL, detection interval) from the parent component’s configuration store.  Developers should therefore ensure those settings are supplied during deployment.

---

## Usage Guidelines  

* **Always acquire before you act** – Any component that intends to modify or read‑modify‑write data in the knowledge graph must call `acquireLock(resourceId, ownerId)` first.  Skipping this step defeats the consistency guarantees provided by the module.  

* **Release promptly** – After the protected operation finishes, invoke `releaseLock(resourceId, ownerId)` as soon as possible.  Holding a lock longer than necessary increases the likelihood of contention and may trigger timeout‑forced releases.  

* **Respect timeout policies** – Design your component’s work‑flow to complete within the configured timeout window.  If a long‑running task is unavoidable, consider breaking it into smaller transactional steps or requesting an extended lock duration via a dedicated API (if added later).  

* **Handle lock acquisition failures** – `acquireLock` may reject or block if the resource is already locked.  Implement retry logic with exponential back‑off and be prepared to abort gracefully if a deadlock is reported by `detectDeadlock()`.  

* **Leverage logging for diagnostics** – The `logConcurrencyControl` output is the primary source for troubleshooting concurrency issues.  Include the `ownerId` that uniquely identifies your component (e.g., “OnlineLearning”) to make log entries easy to filter.  

* **Do not embed graph‑specific logic in the lock manager** – Keep all graph‑database calls separate from lock handling.  This separation preserves the modularity of the ConcurrencyControlModule and allows future replacement of the underlying database without touching concurrency code.

---

### Architectural patterns identified  

* **Centralized Lock Manager** – a single authority (`locking‑mechanism.ts`) that serialises access to shared resources.  
* **Deadlock Detection (wait‑for graph analysis)** – proactive cycle detection via `detectDeadlock()`.  
* **Timeout Guard** – safety net that forces lock release after a configurable period (`setTimeout()` in `timeout‑mechanism.ts`).  
* **Logging/Audit Trail** – cross‑cutting concern implemented by `logConcurrencyControl()`.

### Design decisions and trade‑offs  

* **Explicit acquire/release API** – simple to understand and enforce, but introduces the risk of forgotten releases (mitigated by timeouts).  
* **In‑memory lock state** – fast lookup and minimal latency; however, it limits scalability across multiple process instances unless a distributed store is later introduced.  
* **Passive deadlock detection** – low overhead during normal operation, but detection latency depends on the polling interval.  
* **Uniform logging** – provides observability at the cost of additional I/O; developers should configure log levels appropriately.

### System structure insights  

The ConcurrencyControlModule sits at the heart of *KnowledgeManagement*, acting as the gatekeeper for all graph‑database interactions.  Its child **LockingMechanism** encapsulates the only mutable state, while sibling modules share the same graph‑access façade, ensuring a cohesive concurrency model across the entire knowledge‑graph ecosystem.

### Scalability considerations  

* **Horizontal scaling** – Because lock state is kept in memory, scaling the system horizontally (multiple Node.js processes) would require a shared lock store (e.g., Redis) to maintain correctness.  Until such a store is introduced, the module scales well vertically (more CPU within a single process).  
* **Lock granularity** – Using fine‑grained `resourceId`s (e.g., per‑entity) reduces contention but increases the size of the lock map.  Coarser granularity simplifies the map but may become a bottleneck under heavy parallel writes.  
* **Deadlock detection frequency** – Tuning the detection interval can balance CPU usage against responsiveness to deadlocks.

### Maintainability assessment  

The module’s responsibilities are well‑encapsulated: lock acquisition/release, deadlock detection, timeout handling, and logging are each isolated in their own files.  This separation of concerns makes the codebase easy to navigate and test.  The primary maintenance risk lies in the in‑memory lock store; any change to process lifecycle (e.g., graceful shutdown, hot reload) must ensure that all held locks are released to avoid stale entries.  Adding a persistent lock backend or extending the API for read‑only/shared locks would be straightforward given the current modular layout.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component's architecture is designed to support multiple workflows and use cases, including code graph analysis, entity persistence, and ontology classification, through a set of APIs and interfaces for interacting with the knowledge graph. This is evident in the GraphDatabaseAdapter (storage/graph-database-adapter.ts) which provides a unified interface for graph database operations, making it easy to integrate with other components and tools. The use of a dynamic import mechanism in GraphDatabaseAdapter to load the VkbApiClient module allows for flexibility in the component's dependencies.

### Children
- [LockingMechanism](./LockingMechanism.md) -- The ConcurrencyControlModule uses a locking mechanism, such as acquireLock() in locking-mechanism.ts, to prevent data inconsistencies when multiple components are accessing the knowledge graph simultaneously.

### Siblings
- [ManualLearning](./ManualLearning.md) -- ManualLearning uses the GraphDatabaseAdapter (storage/graph-database-adapter.ts) to store manually created entities in the knowledge graph.
- [OnlineLearning](./OnlineLearning.md) -- OnlineLearning utilizes the GraphDatabaseAdapter (storage/graph-database-adapter.ts) to store automatically extracted knowledge in the knowledge graph.
- [CodeGraphModule](./CodeGraphModule.md) -- CodeGraphModule uses the GraphDatabaseAdapter (storage/graph-database-adapter.ts) to store extracted insights in the knowledge graph.
- [PersistenceModule](./PersistenceModule.md) -- PersistenceModule uses the GraphDatabaseAdapter (storage/graph-database-adapter.ts) to store entities in the knowledge graph.
- [OntologyModule](./OntologyModule.md) -- OntologyModule uses the GraphDatabaseAdapter (storage/graph-database-adapter.ts) to store ontology information in the knowledge graph.
- [GraphDatabaseModule](./GraphDatabaseModule.md) -- GraphDatabaseModule uses a dynamic import mechanism in GraphDatabaseAdapter (storage/graph-database-adapter.ts) to load the VkbApiClient module, allowing for flexibility in the component's dependencies.


---

*Generated from 7 observations*
