# ViolationDetector

**Type:** SubComponent

ViolationDetector provides a violation metadata repository in violation-metadata.ts to store violation configuration and registration data.

## What It Is  

ViolationDetector is a **SubComponent** that lives inside the `ConstraintSystem` hierarchy. Its implementation can be traced to several concrete files:  

* `storage/graph-database-adapter.ts` – the low‑level adapter used for persisting and retrieving violation‑related metadata.  
* `violation-metadata.ts` – the repository that stores configuration and registration data for each type of violation.  
* `cache-violation.ts` – an in‑process cache that speeds up repeated detection runs.  
* `notification-manager.ts` – the mechanism that pushes detection results to end‑users or downstream tools.  

The core public entry point is the `detectViolation` function, which applies a **rule‑based** engine to the current tool interaction context. When a rule fires, the detector records the event through the GraphDatabaseAdapter, optionally caches the result, and finally notifies interested parties via the NotificationManager. The detector also registers hooks with the system‑wide `HookManager`, allowing other modules (e.g., `ContentValidator` or `AgentManager`) to react to detection events.

---

## Architecture and Design  

### Adapter & Repository Layers  
The presence of `GraphDatabaseAdapter` signals an **Adapter pattern** that isolates the detector from the underlying graph store (Graphology + LevelDB). All persistence calls go through this adapter, making the detector agnostic to storage details and enabling future replacement or extension of the database layer without touching detection logic.  

`violation-metadata.ts` implements a **Repository pattern** for violation configuration. It centralises CRUD operations for violation definitions, mirroring the approach taken by sibling components such as `ConstraintMetadataManager` (which uses `metadata-repository.ts`). This common repository style promotes a uniform data‑access contract across the constraint ecosystem.

### Rule‑Based Engine  
`detectViolation` follows a classic **Rule Engine** design: a collection of declarative constraints is evaluated against the current state. The rule set is stored in the violation metadata repository, allowing dynamic addition or removal of rules without recompiling the detector. This design aligns with the broader constraint‑centric philosophy of the parent `ConstraintSystem`.

### Caching Strategy  
`cache-violation.ts` introduces a **Cache‑Aside** approach. Before executing the rule engine, the detector checks the cache for a previously computed result for the same input. If a hit occurs, the expensive rule evaluation and database write are bypassed, improving latency for high‑frequency interactions. The cache is kept coherent by invalidating entries when the underlying violation metadata changes (a responsibility shared with the `HookManager`).

### Hook & Notification Integration  
Integration with `HookManager` follows a **Publish‑Subscribe** style: the detector publishes “violation‑detected” events, and any registered hook (e.g., from `ContentValidator` or custom extensions) can subscribe. This loosely‑coupled mechanism encourages extensibility while keeping the detector’s core logic simple.  

The `NotificationManager` implements an **Observer**‑like pattern for end‑user communication. After a violation is recorded, the manager formats and dispatches notifications (e.g., UI alerts, logs, or external service calls). This separation of concerns ensures that detection does not need to know the specifics of how a user is informed.

---

## Implementation Details  

1. **GraphDatabaseAdapter (`storage/graph-database-adapter.ts`)**  
   - Provides `saveViolation(metadata)` and `loadViolation(id)` methods.  
   - Wraps Graphology APIs and persists the underlying graph to LevelDB, mirroring the storage strategy used by the sibling `GraphDatabaseManager`.  

2. **ViolationMetadataRepository (`violation-metadata.ts`)**  
   - Exposes `registerRule(ruleId, ruleDefinition)`, `getRule(ruleId)`, and `listActiveRules()`.  
   - Internally uses the GraphDatabaseAdapter to persist rule definitions, ensuring that rule data lives alongside other constraint metadata managed by the parent `ConstraintSystem`.  

3. **Cache Layer (`cache-violation.ts`)**  
   - Implements a simple in‑memory map keyed by a hash of the input context (e.g., tool interaction payload).  
   - Functions `getCachedResult(key)` and `setCachedResult(key, result)` are invoked at the start and end of `detectViolation`.  
   - Cache invalidation hooks are registered with `HookManager` to purge entries when rule sets are updated.  

4. **Detection Core (`detectViolation`)**  
   - Retrieves the active rule set from `ViolationMetadataRepository`.  
   - Iterates over each rule, applying its predicate to the current interaction payload.  
   - On a match, creates a violation record, persists it via the GraphDatabaseAdapter, stores the outcome in the cache, and calls `NotificationManager.notify(violation)`.  

5. **Notification Manager (`notification-manager.ts`)**  
   - Offers `notify(violation)` which formats a user‑friendly message and forwards it to configured channels (UI toast, console log, external webhook).  
   - The manager is reusable by other components; for instance, `ContentValidator` may also use it to surface validation errors.  

6. **Hook Registration**  
   - During initialization, `ViolationDetector` registers a hook like `HookManager.on('toolInteraction', detectViolation)`.  
   - This ensures the detector runs automatically whenever the system processes a new interaction, mirroring the pattern used by other siblings such as `ContentValidator`.  

---

## Integration Points  

* **Parent – ConstraintSystem**: The detector is a child of `ConstraintSystem`, inheriting the same persistence backbone (GraphDatabaseAdapter) and contributing to the overall constraint enforcement pipeline.  

* **Sibling – HookManager**: By registering its detection routine as a hook, ViolationDetector participates in the same event‑driven flow that powers `ContentValidator` and other rule‑based components. This shared hook infrastructure reduces duplication of event wiring.  

* **Sibling – GraphDatabaseManager**: Both the detector and the manager rely on the same LevelDB‑backed graph store, guaranteeing consistent transaction semantics and enabling cross‑component queries (e.g., a violation may be correlated with constraint metadata stored by `ConstraintMetadataManager`).  

* **Child – ViolationMetadataRepository**: The repository is the concrete storage façade for rule definitions. Its design mirrors the `metadata-repository.ts` used by `ConstraintMetadataManager`, suggesting a common contract for all metadata‑centric subcomponents.  

* **External Consumers**: The `NotificationManager` exposes a public API that UI layers, CLI tools, or external services can consume. Because the notification logic is decoupled, developers can plug in additional channels (e.g., Slack, email) without altering detection code.  

---

## Usage Guidelines  

1. **Register Rules Early** – Populate `ViolationMetadataRepository` with rule definitions during system start‑up (e.g., via a configuration file or programmatic registration). Changing rules at runtime requires triggering the appropriate hook to clear the cache, otherwise stale results may be returned.  

2. **Leverage Hooks, Not Direct Calls** – Prefer hooking `detectViolation` into `HookManager` events (`toolInteraction`) rather than invoking the function manually. This guarantees that all detection runs share the same context and caching behaviour as sibling components.  

3. **Respect Cache Boundaries** – The cache is scoped to the current process. In a multi‑process deployment, each instance maintains its own cache; therefore, developers should avoid relying on the cache for cross‑instance consistency. Use the GraphDatabaseAdapter for authoritative state.  

4. **Handle Notifications Gracefully** – The `NotificationManager` may be configured with multiple channels. Ensure that notification failures (e.g., network errors) are caught and logged but do not abort the detection pipeline.  

5. **Extending the Rule Set** – New rule types should conform to the existing rule schema stored in `violation-metadata.ts`. Reuse the same predicate interface to keep the detection loop simple and maintainable.  

---

### Architectural patterns identified  

* **Adapter Pattern** – `GraphDatabaseAdapter` abstracts the underlying graph‑store implementation.  
* **Repository Pattern** – `ViolationMetadataRepository` centralises rule persistence.  
* **Rule Engine** – `detectViolation` evaluates declarative constraints.  
* **Cache‑Aside** – `cache-violation.ts` provides a fast read path with explicit invalidation.  
* **Publish‑Subscribe / Hook System** – Integration with `HookManager`.  
* **Observer / Notification** – `NotificationManager` disseminates detection results.  

### Design decisions and trade‑offs  

* **Separation of persistence (adapter) from detection** improves testability but adds an indirection layer that can obscure performance bottlenecks.  
* **Rule‑based detection** offers flexibility at the cost of runtime evaluation overhead; the cache mitigates this for repeated inputs.  
* **In‑process caching** yields low latency but does not scale automatically across multiple nodes; developers must decide whether a distributed cache is needed.  
* **Hook‑driven execution** simplifies wiring but couples detection timing to the hook emission order; careful ordering is required when multiple hooks mutate shared state.  

### System structure insights  

ViolationDetector sits as a leaf under `ConstraintSystem`, sharing storage and hook infrastructure with its siblings. Its child component, `ViolationMetadataRepository`, mirrors the metadata handling strategy of `ConstraintMetadataManager`, suggesting a coherent architectural theme of “metadata‑driven” constraint enforcement throughout the system.  

### Scalability considerations  

* **Persistence scalability** is delegated to the GraphDatabaseAdapter, which already leverages LevelDB’s on‑disk scalability.  
* **Cache scalability** is limited to the host process; for high‑throughput environments, a distributed cache (e.g., Redis) could be introduced without altering detection logic, thanks to the clear cache‑aside abstraction.  
* **Rule set size** impacts detection latency linearly; large rule collections may benefit from rule indexing or pre‑filtering strategies, though such optimisations are not presently observed.  

### Maintainability assessment  

The component exhibits strong modular boundaries: persistence, caching, rule storage, and notification are each encapsulated in dedicated files. This separation aligns with the **Single Responsibility Principle**, making the codebase easier to navigate and test. Reuse of patterns across siblings (e.g., repository and hook mechanisms) promotes a shared mental model for developers. The primary maintenance risk lies in the coupling between cache invalidation and rule updates; ensuring that all cache‑clear hooks are correctly wired is essential to avoid stale detection results. Overall, the design is maintainable, extensible, and well‑aligned with the surrounding constraint‑system architecture.


## Hierarchy Context

### Parent
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem component utilizes the GraphDatabaseAdapter (storage/graph-database-adapter.ts) for storing and managing constraint metadata. This allows for efficient persistence and retrieval of constraint data, leveraging the capabilities of Graphology and LevelDB. The automatic JSON export sync feature ensures that the data remains consistent and up-to-date. Furthermore, the GraphDatabaseAdapter provides a flexible and scalable solution for handling large amounts of constraint metadata, making it an ideal choice for the ConstraintSystem.

### Children
- [ViolationMetadataRepository](./ViolationMetadataRepository.md) -- The parent context suggests the use of a GraphDatabaseAdapter in storage/graph-database-adapter.ts, which could be used to implement the ViolationMetadataRepository.

### Siblings
- [ContentValidator](./ContentValidator.md) -- ContentValidator utilizes the GraphDatabaseAdapter in storage/graph-database-adapter.ts to store and retrieve validation metadata.
- [HookManager](./HookManager.md) -- HookManager uses a modular hook registration system in hook-registry.ts to manage hook subscriptions.
- [GraphDatabaseManager](./GraphDatabaseManager.md) -- GraphDatabaseManager uses the LevelDB database in leveldb-database.ts to store graph data.
- [ConstraintMetadataManager](./ConstraintMetadataManager.md) -- ConstraintMetadataManager uses a metadata repository in metadata-repository.ts to store constraint configuration and registration data.
- [AgentManager](./AgentManager.md) -- AgentManager uses an agent repository in agent-repository.ts to store agent configuration and registration data.


---

*Generated from 6 observations*
