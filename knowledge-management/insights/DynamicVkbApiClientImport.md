# DynamicVkbApiClientImport

**Type:** Detail

GraphDatabaseService, the direct LevelDB accessor, is instantiated only when VkbApiClient is absent (server unavailable), at which point the current process takes ownership of the LevelDB file lock for the duration of the adapter's lifetime.

## What It Is  

`DynamicVkbApiClientImport` lives inside **`storage/graph-database-adapter.ts`**. It is not a standalone file but a logical import‑time decision point that determines whether the adapter will load the **`VkbApiClient`** REST module or fall back to a direct **LevelDB** accessor (`GraphDatabaseService`). The decision hinges on the static method **`VkbApiClient.isServerAvailable()`**. When the method returns *true* the adapter dynamically imports the client and routes every entity read/write through the remote VKB server; when *false* the client is never loaded and the adapter creates a local `GraphDatabaseService` that opens the LevelDB files and holds the exclusive file lock for the process lifetime.  

Because the import is performed **once at adapter initialization**, the storage backend (remote‑via‑REST or local‑LevelDB) is fixed for the whole lifetime of the adapter instance. This eliminates per‑request network probes and guarantees a single source of truth for the chosen persistence strategy.

---

## Architecture and Design  

The component embodies a **conditional dynamic import** pattern combined with a **strategy selection** at startup. The `GraphDatabaseAdapter` probes server availability via the sibling **`ServerAvailabilityProbe`** (also executed in `storage/graph-database-adapter.ts`). The result of that probe is the single piece of state that drives the `DynamicVkbApiClientImport` decision.  

* **Strategy Selection** – The adapter chooses between two mutually exclusive strategies:  
  1. **Remote strategy** – a thin proxy that forwards all CRUD operations to the VKB server through `VkbApiClient`.  
  2. **Local strategy** – a direct LevelDB driver (`GraphDatabaseService`) that owns the file lock.  

* **Dynamic Import** – By calling `import()` only when `VkbApiClient.isServerAvailable()` is true, the system avoids loading the REST client bundle (and its transitive dependencies) in the local‑only scenario, reducing memory footprint and start‑up latency.  

* **Lock Ownership Discipline** – When the remote strategy is active, the adapter never attempts to open LevelDB, leaving the file lock exclusively with the VKB server process. Conversely, the local strategy acquires the lock exactly once when `GraphDatabaseService` is instantiated. This clear separation prevents lock contention and simplifies concurrency handling.  

* **Single‑point Decision** – The decision is made **once per adapter lifetime**, not per request. This design eliminates repeated network checks (a benefit highlighted in the sibling `ServerAvailabilityProbe` observation) and stabilizes performance characteristics for both strategies.

---

## Implementation Details  

1. **Availability Probe** – At the top of `storage/graph-database-adapter.ts` the code executes `VkbApiClient.isServerAvailable()`. This static method likely performs a lightweight HTTP HEAD or health‑check against the VKB server and returns a boolean.  

2. **Dynamic Import Block** – Pseudo‑code derived from the observations:  

   ```ts
   let db: GraphDatabaseService | VkbApiClient;
   if (await VkbApiClient.isServerAvailable()) {
       const { VkbApiClient } = await import('./vkb-api-client');
       db = new VkbApiClient();               // remote proxy
   } else {
       const { GraphDatabaseService } = await import('./graph-database-service');
       db = new GraphDatabaseService();        // direct LevelDB accessor
   }
   ```  

   The `await import()` syntax ensures that the module is fetched only when needed. Because the condition is evaluated before any entity operation, the chosen `db` instance is cached for the remainder of the adapter’s life.

3. **Proxy Behavior** – When the remote client is active, `VkbApiClient` implements the same interface that the adapter expects for entity reads/writes. Internally it forwards each call over HTTP/REST to the server process, which itself holds the LevelDB lock. The adapter therefore remains agnostic to whether the underlying storage is local or remote.

4. **Lock Management** – In the local path, `GraphDatabaseService` opens the LevelDB files using the native LevelDB bindings and immediately acquires an exclusive file lock. This lock persists until the adapter shuts down, guaranteeing that no other process (including a stray VKB server) can corrupt the database.

5. **Parent‑Child Relationship** – `DynamicVkbApiClientImport` is conceptually a child of **`GraphDatabaseAdapter`**, which orchestrates the overall storage strategy. Its sibling, **`ServerAvailabilityProbe`**, shares the same initialization timing and contributes the boolean that drives the import decision.

---

## Integration Points  

* **Parent Component – `GraphDatabaseAdapter`** – The adapter delegates all persistence calls to the object produced by `DynamicVkbApiClientImport`. It expects the returned instance to expose the same CRUD API regardless of whether it is a `VkbApiClient` proxy or a `GraphDatabaseService` driver.  

* **Sibling – `ServerAvailabilityProbe`** – The probe runs in the same module and supplies the availability flag. Any changes to the probing logic (e.g., timeout adjustments) will directly affect which import path is taken.  

* **External Dependency – VKB Server Process** – When the remote strategy is selected, the adapter depends on a reachable VKB server that implements the REST endpoints expected by `VkbApiClient`. The server holds the LevelDB lock, so the adapter must never attempt to open LevelDB locally in this mode.  

* **Local Dependency – LevelDB Native Bindings** – In the local strategy, `GraphDatabaseService` pulls in the LevelDB native library. This dependency is only loaded when the server is unavailable, keeping the binary size smaller for remote‑only deployments.  

* **Configuration Surface** – The only visible configuration for developers is the presence or absence of a reachable VKB server at startup. No explicit flags are required; the system self‑detects via `VkbApiClient.isServerAvailable()`.

---

## Usage Guidelines  

1. **Do not manually import `VkbApiClient` or `GraphDatabaseService`** from elsewhere in the codebase. Always obtain the persistence instance through `GraphDatabaseAdapter`, which internally uses `DynamicVkbApiClientImport` to guarantee a single, consistent strategy.  

2. **Ensure the VKB server’s health endpoint is reliable** because the entire storage mode hinges on the boolean returned by `VkbApiClient.isServerAvailable()`. A flaky health check could cause the adapter to switch unintentionally on restart.  

3. **Avoid starting multiple adapter instances in the same host** when the remote strategy is active. Since the VKB server holds the LevelDB lock, concurrent local adapters would fail to acquire the lock if they mistakenly fall back to the local strategy.  

4. **When testing locally**, you can force the local path by shutting down the VKB server or by mocking `VkbApiClient.isServerAvailable()` to return `false`. This is useful for unit tests that need deterministic, in‑process LevelDB access without network overhead.  

5. **Be aware of the one‑time decision**: Changing server availability after the adapter has been instantiated will not cause a re‑selection of the storage strategy. To switch strategies you must restart the process so that `DynamicVkbApiClientImport` re‑evaluates the availability probe.

---

### Architectural Patterns Identified  

| Pattern | Where It Appears |
|---------|------------------|
| Conditional Dynamic Import | `DynamicVkbApiClientImport` in `storage/graph-database-adapter.ts` |
| Strategy Selection (Remote vs. Local) | Decision based on `VkbApiClient.isServerAvailable()` |
| Proxy (Remote Client) | `VkbApiClient` forwards CRUD calls to VKB server |
| Single‑point Initialization | Probe and import happen once at adapter construction |

### Design Decisions & Trade‑offs  

* **Performance vs. Flexibility** – Loading the REST client only when needed reduces startup time and memory usage for pure‑local deployments, at the cost of a hard‑coded one‑time strategy selection.  
* **Lock Ownership Simplicity** – Delegating lock management exclusively to either the server or the local process eliminates complex coordination but requires careful deployment to avoid two processes thinking they own the lock.  
* **Implicit Configuration** – Relying on server availability as the sole selector removes the need for explicit config flags, simplifying deployment but making the system sensitive to transient network issues during startup.

### System Structure Insights  

* `GraphDatabaseAdapter` is the façade that abstracts away the storage backend.  
* `DynamicVkbApiClientImport` acts as the internal factory that decides which concrete implementation (`VkbApiClient` or `GraphDatabaseService`) to instantiate.  
* `ServerAvailabilityProbe` is a sibling utility that centralises the health‑check logic, ensuring a consistent decision source across the adapter.  

### Scalability Considerations  

* **Remote Strategy** – Scaling out is straightforward: multiple adapter instances can share a single VKB server, provided the server can handle the aggregate request volume. Since the server holds the LevelDB lock, horizontal scaling of the database itself is not possible without sharding or a different storage engine.  
* **Local Strategy** – Each process gets exclusive access to its own LevelDB file set, so scaling horizontally requires separate data partitions per instance.  

### Maintainability Assessment  

The design is **highly maintainable** because:  

* The conditional import isolates the REST client and LevelDB driver into distinct modules, keeping their dependency graphs separate.  
* The single decision point (`DynamicVkbApiClientImport`) is small and self‑contained, making future changes (e.g., adding a third storage backend) a matter of extending the `if/else` block.  
* Clear ownership of the LevelDB lock reduces the risk of subtle concurrency bugs, simplifying debugging and operational monitoring.  

Overall, `DynamicVkbApiClientImport` provides a clean, low‑overhead mechanism for selecting the appropriate persistence strategy at runtime, aligning with the broader architecture of `GraphDatabaseAdapter` while keeping the system both performant and easy to reason about.


## Hierarchy Context

### Parent
- [GraphDatabaseAdapter](./GraphDatabaseAdapter.md) -- storage/graph-database-adapter.ts probes server availability at initialization via VkbApiClient.isServerAvailable(), selecting the REST path or direct LevelDB path before any entity operations are attempted

### Siblings
- [ServerAvailabilityProbe](./ServerAvailabilityProbe.md) -- The probe is executed at adapter initialization in storage/graph-database-adapter.ts, meaning the storage backend decision is made once per adapter lifetime rather than per-request, avoiding repeated network checks during entity reads and writes.


---

*Generated from 3 observations*
