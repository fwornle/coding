# RegistrationApi

**Type:** Detail

ProcessStateManager.registerService() is explicitly identified in the L2 description as the single entry point used by both scripts/api-service.js and scripts/dashboard-service.js, establishing it as the canonical write interface for service identity data.

## What It Is  

`RegistrationApi` lives inside the **ProcessStateManager** component. The only public entry point that the rest of the codebase interacts with is **`ProcessStateManager.registerService()`**, which is invoked from two concrete scripts:

* `scripts/api‑service.js`  
* `scripts/dashboard‑service.js`  

Both scripts spawn a child process first, obtain a live PID, and then call `registerService()` to record the newly‑started service in the **ServiceRegistry**. The complementary `unregisterService()` method (implied by the parent analysis) completes the lifecycle when the process exits. In effect, `RegistrationApi` is a thin, service‑agnostic façade that writes identity data (at minimum a PID) into a central registry; it does **not** contain any business logic about what the registered service actually does.

---

## Architecture and Design  

The design follows a **single‑write façade** pattern. All mutations to the service registry flow through one canonical method – `ProcessStateManager.registerService()`. This guarantees a consistent registration contract and prevents scattered, ad‑hoc writes. Because the same façade is used by two distinct wrapper scripts, the API is deliberately **service‑agnostic**: the `ProcessStateManager` knows only that a service exists and has a PID; it never inspects the service’s internal behavior.

The surrounding architecture can be visualised as:

```
+-------------------+          +-------------------+
| scripts/api‑service.js   |          | scripts/dashboard‑service.js |
+----------+--------+          +----------+--------+
           |                               |
           | spawn → child PID              | spawn → child PID
           v                               v
+-------------------+   registerService()   +-------------------+
| ProcessStateManager (RegistrationApi) |--------------------|
+----------+--------+--------------------+-------------------+
           | writes to ServiceRegistry (sibling)
           v
+-------------------+
| ServiceRegistry   |
+-------------------+
```

* **Facade / Wrapper** – `ProcessStateManager.registerService()` abstracts the underlying registry implementation.  
* **Symmetric Lifecycle** – The implied `unregisterService()` mirrors registration, aligning with process start/stop events.  
* **Explicit Dependency on PID** – Because registration occurs *after* `spawn`, the PID is guaranteed to be present, making it a required field rather than an optional attribute.  

No other design patterns (e.g., event‑driven, micro‑service) are evident from the observations.

---

## Implementation Details  

The implementation revolves around three concrete symbols:

| Symbol | Location | Role |
|--------|----------|------|
| `ProcessStateManager.registerService()` | `ProcessStateManager` (parent component) | Canonical write method for service identity data. |
| `ProcessStateManager.unregisterService()` | (implied) | Symmetric counterpart that removes a service entry on process termination. |
| `ServiceRegistry` | sibling component | Holds the persisted registration records; receives all writes from the façade. |

**Mechanics of registration**  

1. **Spawn** – `scripts/api-service.js` or `scripts/dashboard-service.js` creates a child process via `child_process.spawn` (or equivalent). The child’s PID becomes immediately available.  
2. **Call registerService** – The script passes an object containing at least `{ pid: <number>, name: <string> }` to `ProcessStateManager.registerService()`.  
3. **Write path** – Inside `registerService()`, the method validates the presence of a PID (guaranteed by step 1) and then inserts a new entry into `ServiceRegistry`. No lazy population occurs; the registry entry is created **synchronously** at registration time.  
4. **Unregister** – When the child process exits, the wrapper script (or a process‑exit handler) invokes `unregisterService()`, which removes the matching PID entry from `ServiceRegistry`.

Because the registry is the sole source of truth for running services, any read‑only consumers must query `ServiceRegistry` directly; they never write to it.

---

## Integration Points  

* **Caller Scripts** – `scripts/api-service.js` and `scripts/dashboard-service.js` are the only current consumers of `RegistrationApi`. Both must adhere to the contract of spawning a process first and then invoking `registerService()`.  
* **ServiceRegistry** – Acts as the persistent store for registration data. All other components that need to discover running services read from this sibling component.  
* **Process Lifecycle Handlers** – Although not explicitly listed, the existence of `unregisterService()` suggests that the wrapper scripts (or a higher‑level supervisor) hook into the child process’s `exit`/`close` events to trigger deregistration.  
* **Potential Future Consumers** – Because the API is service‑agnostic, any new wrapper script that follows the same spawn‑then‑register pattern can be added without modifying `ProcessStateManager`.

No external libraries or additional modules are referenced in the observations, so the integration surface is limited to the two wrapper scripts and the `ServiceRegistry`.

---

## Usage Guidelines  

1. **Spawn before Register** – Always create the child process first and ensure a valid PID exists before calling `ProcessStateManager.registerService()`. Skipping this step violates the implicit contract and will result in an incomplete registration.  
2. **Provide a PID (mandatory)** – The registration payload must contain a PID field; the API does not accept registrations without it. Optional metadata (e.g., service name, version) may be added, but the PID is the only required attribute.  
3. **Symmetric Lifecycle** – Pair every `registerService()` call with a corresponding `unregisterService()` when the child process terminates. This keeps `ServiceRegistry` accurate and prevents stale entries.  
4. **Do Not Bypass the Facade** – Direct writes to `ServiceRegistry` are discouraged. All mutations should flow through `ProcessStateManager.registerService()`/`unregisterService()` to maintain a single source of truth.  
5. **Read‑Only Access** – Components that need to know which services are running should query `ServiceRegistry` read‑only; they must not attempt to modify the registry.

Following these conventions ensures that the registration contract remains consistent, the registry stays clean, and future services can be added with minimal friction.

---

### Architectural Patterns Identified  

* **Facade (single‑write façade)** – `ProcessStateManager.registerService()` abstracts the underlying registry.  
* **Symmetric Lifecycle Contract** – Paired `registerService()` / `unregisterService()` methods.  
* **Service‑Agnostic Contract** – The API does not depend on the specifics of the service being registered.

### Design Decisions & Trade‑offs  

* **Centralised Write Path** – Guarantees consistency but creates a single point of contention if registration frequency spikes.  
* **PID‑Required Registration** – Simplifies identification of processes but forces every caller to manage a live process handle.  
* **Service‑Agnostic Interface** – Maximises reuse across different services, at the cost of not being able to enforce service‑specific validation at registration time.

### System Structure Insights  

* `ProcessStateManager` acts as the parent component that owns `RegistrationApi`.  
* `ServiceRegistry` is a sibling that stores the state; it is write‑only via the façade and read‑only for consumers.  
* The two wrapper scripts are leaf nodes that instantiate child processes and interact with the façade.

### Scalability Considerations  

Because all registrations funnel through a single method, the system scales well for a modest number of services (as typical for a monolithic or tightly‑coupled deployment). If the number of concurrently spawned services grows dramatically, the façade could become a bottleneck; sharding the registry or adding asynchronous <USER_ID_REDACTED> would be required, but such changes are not indicated by the current design.

### Maintainability Assessment  

The design’s simplicity—one write entry point, a clear contract, and a service‑agnostic interface—makes the codebase easy to understand and extend. Adding new services only requires invoking the existing façade. However, the tight coupling to a single registry means any change to the storage format or validation rules must be performed in one place, which can increase the impact radius of modifications. Overall, the current architecture favours maintainability through minimal surface area and clear lifecycle semantics.


## Hierarchy Context

### Parent
- [ProcessStateManager](./ProcessStateManager.md) -- ProcessStateManager.registerService() is the entry point called by both scripts/api-service.js and scripts/dashboard-service.js after child process spawn, recording service identity in the registry

### Siblings
- [ServiceRegistry](./ServiceRegistry.md) -- ProcessStateManager.registerService() (referenced in the L2 hierarchy description) is the sole write path into the registry, meaning all registry entries are created post-spawn and never lazily populated at read time.


---

*Generated from 4 observations*
