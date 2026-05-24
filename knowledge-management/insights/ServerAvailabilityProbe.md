# ServerAvailabilityProbe

**Type:** Detail

A positive probe result activates the REST path (all entity operations are delegated to VkbApiClient), while a negative result activates the direct LevelDB path via GraphDatabaseService — these two paths are mutually exclusive within one adapter instance.

## What It Is  

**ServerAvailabilityProbe** is a runtime‑time check that runs once when a **GraphDatabaseAdapter** instance is created (see `storage/graph-database-adapter.ts`). Its sole purpose is to ask the remote VKB service whether it currently holds the exclusive LevelDB lock by calling `VkbApiClient.isServerAvailable()`. The boolean result of that call determines which execution path the adapter will use for *all* subsequent entity operations:

* **Positive result** → the adapter routes every read/write through the REST client (`VkbApiClient`).  
* **Negative result** → the adapter bypasses the network and talks directly to the local LevelDB store via `GraphDatabaseService`.

Because the probe is performed at **adapter initialization**, the decision is made once per adapter lifetime, not per request. This guarantees that the chosen path is consistent for the whole lifetime of the adapter instance.

---

## Architecture and Design  

The design follows a **runtime strategy selection** pattern. At start‑up the adapter probes the environment and then **commits** to one of two mutually exclusive strategies:

1. **Remote‑API strategy** – all entity CRUD calls are delegated to the REST client (`VkbApiClient`).  
2. **Local‑store strategy** – the adapter uses the direct LevelDB service (`GraphDatabaseService`).

The selection is performed by **ServerAvailabilityProbe**, which acts as a *guard* that isolates the rest of the code from the probing logic. This guard enables two important architectural goals:

* **Separation of concerns** – the probing logic lives in its own component, while the adapter focuses on delegating to the chosen backend.  
* **Lazy module loading** – the sibling component **DynamicVkbApiClientImport** conditionally imports the `VkbApiClient` module only when the probe reports that the remote server is available. This reduces start‑up overhead in local‑only mode.

The overall flow can be visualised as:

```
+---------------------------+
| GraphDatabaseAdapter      |
| (storage/graph-database-  |
|  adapter.ts)              |
+-----------+---------------+
            |
            v
+---------------------------+
| ServerAvailabilityProbe   |
|  - calls VkbApiClient.is  |
|    ServerAvailable()      |
+-----------+---------------+
            |
   +--------+--------+
   |                 |
   v                 v
[REST path]      [Direct LevelDB path]
   |                 |
   v                 v
VkbApiClient      GraphDatabaseService
```

The mutually exclusive paths are enforced by the adapter’s internal state; once the probe sets the mode, the adapter never flips it until it is re‑instantiated.

---

## Implementation Details  

### Probe Execution  
*Located in* `storage/graph-database-adapter.ts`, the constructor (or an explicit `init()` method) invokes `ServerAvailabilityProbe`. The probe performs a single HTTP request through `VkbApiClient.isServerAvailable()`. The client method returns a boolean indicating whether the VKB process currently owns the LevelDB lock.

### Conditional Import  
The sibling **DynamicVkbApiClientImport** uses a dynamic `import()` statement that is wrapped in the same conditional logic that evaluates the probe result. When the probe yields `false`, the import is skipped entirely, meaning the REST client bundle is never loaded into the Node.js process. This lazy‑loading technique reduces memory footprint and eliminates unnecessary network‑stack initialisation for local‑only deployments.

### Backend Selection  
The adapter stores the probe outcome in a private flag (e.g., `useRestApi: boolean`). All public CRUD methods (`createEntity`, `readEntity`, `updateEntity`, `deleteEntity`, etc.) consult this flag:

```ts
if (this.useRestApi) {
  return this.vkbApiClient.performOperation(...);
} else {
  return this.graphDatabaseService.performOperation(...);
}
```

Because the flag is immutable after construction, the code path is deterministic and can be optimised by the JavaScript engine.

### Direct LevelDB Path  
When the probe is negative, the adapter constructs a `GraphDatabaseService` instance that directly accesses the LevelDB files on disk. This service encapsulates all low‑level transaction handling, lock management, and data serialization. The adapter therefore acts purely as a façade, forwarding calls without any additional transformation.

### REST Path  
When the probe is positive, the adapter creates a `VkbApiClient` instance (via the conditional dynamic import) that knows how to translate the same CRUD semantics into HTTP calls against the remote VKB server. The remote server, being the source of truth for the LevelDB lock, guarantees that only one process writes to the underlying store at a time.

---

## Integration Points  

* **Parent Component – GraphDatabaseAdapter**  
  `ServerAvailabilityProbe` is invoked from the adapter’s initialization code (`storage/graph-database-adapter.ts`). The adapter relies on the probe’s outcome to configure its internal routing logic.

* **Sibling – DynamicVkbApiClientImport**  
  The dynamic import mechanism is tightly coupled with the probe result. It ensures that the `VkbApiClient` module is only loaded when the remote API path is selected, preventing unnecessary module parsing and network initialisation.

* **External Service – VKB Server**  
  The probe’s HTTP call (`VkbApiClient.isServerAvailable()`) reaches the VKB server, which holds the authoritative lock on the LevelDB file. This external dependency is the only point where the system contacts the network during start‑up.

* **Local Store – GraphDatabaseService**  
  When the probe disables the REST path, the adapter directly interacts with `GraphDatabaseService`. This service is the concrete implementation that reads/writes LevelDB files on the same host.

* **Entity Operations**  
  All higher‑level entity APIs (e.g., repository classes, domain services) invoke the adapter’s CRUD methods without needing to know which backend is active. The probe therefore provides a transparent abstraction layer.

---

## Usage Guidelines  

1. **Do not call `ServerAvailabilityProbe` manually** – it is automatically executed by `GraphDatabaseAdapter` during construction. Manual invocations could lead to inconsistent mode selection within the same process.  

2. **Treat the adapter as immutable after construction** – because the probe result is cached, changing the remote server’s availability at runtime will not affect the current adapter instance. If the environment changes (e.g., the VKB server goes down or comes up), restart the process to create a fresh adapter and re‑run the probe.  

3. **Avoid mixing REST and direct LevelDB calls** – the design guarantees exclusivity per adapter instance. Introducing ad‑hoc direct LevelDB accesses outside the adapter would break the lock‑ownership contract enforced by the VKB server.  

4. **Keep `VkbApiClient.isServerAvailable()` lightweight** – since the probe runs only once, it can afford a simple HTTP HEAD or health‑check endpoint, but it should return <USER_ID_REDACTED> to avoid delaying adapter start‑up.  

5. **When adding new entity operations, route them through the existing adapter methods** – this ensures they automatically respect the selected backend without duplicating probing logic.  

6. **Testing** – unit tests should mock `VkbApiClient.isServerAvailable()` to force both true and false paths, verifying that the adapter correctly delegates to either `VkbApiClient` or `GraphDatabaseService`.  

---

### Architectural patterns identified  

* **Strategy (runtime selection)** – the probe decides between a REST‑based strategy and a direct‑store strategy.  
* **Lazy/Dynamic Module Loading** – `DynamicVkbApiClientImport` conditionally loads the REST client only when needed.  
* **Facade** – `GraphDatabaseAdapter` presents a unified interface while hiding the underlying backend choice.  

### Design decisions and trade‑offs  

* **Single probe at start‑up** eliminates per‑request latency but means the adapter cannot adapt to mid‑life server failures without a restart.  
* **Mutually exclusive paths** simplify state management and avoid race conditions on the LevelDB lock, at the cost of requiring two separate code paths that must stay functionally equivalent.  
* **Conditional import** reduces memory and start‑up cost in local‑only deployments, but adds a small complexity in the build pipeline (ensuring the dynamic import works in all environments).  

### System structure insights  

* The probe sits at the *boundary* between the adapter (internal) and the VKB server (external).  
* All downstream components (repositories, services) depend only on the adapter, not on the probe or the client directly.  
* The sibling import mechanism provides a clean separation of concerns: network‑related code is completely absent when the system runs in local mode.  

### Scalability considerations  

* **REST path** – enables horizontal scaling because multiple processes can safely use the remote VKB server as the lock authority; the probe ensures only one process writes at a time.  
* **Direct LevelDB path** – limits scalability to a single host, as the LevelDB file cannot be safely shared across machines. The probe’s early decision makes the scaling model explicit to developers.  

### Maintainability assessment  

* **High cohesion** – `ServerAvailabilityProbe` has a single responsibility (determine backend mode).  
* **Low coupling** – the probe interacts only with `VkbApiClient.isServerAvailable()`, keeping external dependencies minimal.  
* **Clear separation** – having two distinct backends (REST vs. direct) isolates changes; updates to one path do not affect the other as long as the adapter’s façade contract remains stable.  
* **Potential debt** – maintaining parity between the two backends requires discipline; any new feature must be implemented in both `VkbApiClient` and `GraphDatabaseService`. Automated tests that exercise both modes mitigate this risk.


## Hierarchy Context

### Parent
- [GraphDatabaseAdapter](./GraphDatabaseAdapter.md) -- storage/graph-database-adapter.ts probes server availability at initialization via VkbApiClient.isServerAvailable(), selecting the REST path or direct LevelDB path before any entity operations are attempted

### Siblings
- [DynamicVkbApiClientImport](./DynamicVkbApiClientImport.md) -- The dynamic import of VkbApiClient is conditional on the result of VkbApiClient.isServerAvailable(), so the REST client module is not loaded at all when the adapter is running in direct LevelDB mode, reducing initialization overhead.


---

*Generated from 3 observations*
