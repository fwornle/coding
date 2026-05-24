# PostSpawnPsmRegistration

**Type:** Detail

scripts/dashboard-service.js explicitly follows the same post-spawn PSM registration pattern as scripts/api-service.js, confirming this is a shared architectural convention across the DockerizedServices component, not an incidental implementation choice.

## What It Is  

`PostSpawnPsmRegistration` is the logical step that occurs **after** a child service process has been forked and is considered live. The concrete implementation lives in the JavaScript entry‑points of the Dockerized services, namely **`scripts/dashboard-service.js`** and **`scripts/api-service.js`**. Both scripts invoke the same routine – a *post‑spawn PSM registration* – which is encapsulated by the parent component **`DashboardServiceWrapper`** (the wrapper class that owns the registration logic).  

In practice the routine calls **`PSM.registerService()`**. The call is deliberately fire‑and‑forget: any failure to reach the Process‑State‑Manager (PSM) is ignored, logged, and does **not** block or roll back the already‑running dashboard or API process. The pattern is therefore a *non‑blocking coordination sink*: the service’s own lifecycle is independent of the availability of the central registry.

---

## Architecture and Design  

The overall architecture follows a **post‑spawn coordination** model. The critical path is the creation of the child process (handled by the **`ChildProcessSpawner`** sibling component). As soon as the `fork()` succeeds, the child is treated as *authoritative* – it begins listening for traffic, loading its own configuration, etc. The registration with the PSM is a *side‑effect* that trails this critical path.  

Because the registration is non‑blocking, the design embodies two implicit contracts:

1. **Decoupled lifecycle** – the service does not depend on the PSM for readiness. This eliminates a hard coupling between service start‑up and registry health, allowing the service to stay up even when the registry is temporarily unavailable.  
2. **Ordering contract** – the only ordering guarantee is that the PSM call occurs *after* the child process has been spawned. No downstream component waits for a PSM acknowledgment, and the parent (`DashboardServiceWrapper`) never treats the registration result as a readiness signal.

The pattern is repeated across Dockerized services, indicating an intentional architectural convention rather than an ad‑hoc implementation. No higher‑level orchestration (e.g., event‑driven messaging or service mesh) is mentioned; the coordination is limited to a single RPC‑style call to the PSM.

---

## Implementation Details  

### Core Call Path  

1. **`scripts/dashboard-service.js`** (and its sibling `scripts/api-service.js`) start by invoking the **`ChildProcessSpawner`** to fork the actual service binary.  
2. Immediately after the fork returns, the wrapper **`DashboardServiceWrapper`** executes its **`PostSpawnPsmRegistration`** routine.  
3. Inside that routine the code performs a single call:  
   ```js
   PSM.registerService({ name: 'dashboard', pid: child.pid, metadata: … });
   ```  
   The call is wrapped in a `try / catch` (or a promise `.catch`) that logs any error but does not propagate it.  

### Error‑Suppression Semantics  

The observations explicitly label the PSM as a *non‑blocking coordination sink*. Consequently the implementation purposefully **suppresses registration failures**. This is typically done by:

* Ignoring the returned promise resolution status.  
* Logging the error locally (e.g., `console.warn('PSM registration failed', err)`).  
* Continuing the startup flow without retry or rollback.  

Because the registration is fire‑and‑forget, the service does not maintain any internal state that depends on the success of the call.

### Relationship to Parent and Siblings  

* **Parent – `DashboardServiceWrapper`**: owns the post‑spawn routine and provides a single point of change for all Dockerized services. Any modification to the registration logic (e.g., adding additional metadata) will be reflected automatically in both dashboard and API services.  
* **Sibling – `ChildProcessSpawner`**: responsible only for the spawning mechanics. It does **not** wait for PSM acknowledgment, reinforcing the separation of concerns: spawning = *process creation*, registration = *coordination side‑effect*.  

---

## Integration Points  

| Integration Point | Direction | Description |
|-------------------|-----------|-------------|
| **PSM (`PSM.registerService`)** | Outbound (service → registry) | The only external dependency of `PostSpawnPsmRegistration`. It is invoked after the child process is live. Failure is logged but ignored. |
| **ChildProcessSpawner** | Inbound (spawner → wrapper) | Provides the `child` object (including PID) needed for registration. The wrapper assumes the child is ready to receive traffic as soon as the spawn call returns. |
| **DashboardServiceWrapper** | Internal coordination | Encapsulates the registration logic for all services that share the pattern. Other components (e.g., health‑check monitors) may query the wrapper for registration status, but the current design does not expose such a status. |
| **DockerizedServices component** | Cohesive package | `scripts/dashboard-service.js` and `scripts/api-service.js` are siblings within this component and both rely on the same post‑spawn registration convention. |

No other explicit interfaces are observed; the pattern is self‑contained within the startup scripts.

---

## Usage Guidelines  

1. **Do not await `PSM.registerService`** – the contract is fire‑and‑forget. Adding `await` or synchronous error handling will unintentionally re‑introduce a hard dependency on the registry.  
2. **Log registration failures locally** – keep the existing error‑suppression pattern (e.g., `console.warn`). This preserves observability without affecting service uptime.  
3. **Add metadata cautiously** – any additional fields sent to `PSM.registerService` must be backward compatible, because the PSM may ignore unknown keys but could also reject malformed payloads, leading to silent failures.  
4. **Do not move the registration call before the fork** – doing so would break the explicit ordering contract and could cause the PSM to register a PID that does not yet exist, complicating debugging.  
5. **When extending the DockerizedServices component**, reuse the same wrapper (`DashboardServiceWrapper`) rather than duplicating registration code; this maintains the single source of truth for the post‑spawn behavior.

---

## Architectural Patterns Identified  

| Pattern | Evidence |
|---------|----------|
| **Post‑Spawn Coordination** | Both `scripts/dashboard-service.js` and `scripts/api-service.js` invoke registration *after* the child process is spawned. |
| **Non‑Blocking Coordination Sink** | Observation 2 describes `PSM.registerService()` as fire‑and‑forget with failure suppression. |
| **Separation of Concerns (Spawner vs. Registrar)** | `ChildProcessSpawner` handles process creation; `DashboardServiceWrapper` handles registration, with no cross‑waiting. |

---

## Design Decisions and Trade‑offs  

* **Decision – Decouple service start‑up from registry availability**  
  * *Benefit*: Services remain available even when the central registry is down, improving resilience and reducing cascading failures.  
  * *Cost*: Operators lose an immediate visibility signal that a service failed to register; they must rely on logs or external monitoring to detect registration gaps.  

* **Decision – Fire‑and‑forget registration**  
  * *Benefit*: Simplicity; no retry loops or back‑pressure mechanisms needed during start‑up.  
  * *Cost*: Potential for silent registration loss; if the PSM is permanently unavailable, the service will never be discoverable without manual intervention.  

* **Decision – Shared wrapper (`DashboardServiceWrapper`)**  
  * *Benefit*: Centralizes the registration logic, ensuring consistency across services and simplifying future changes.  
  * *Cost*: Introduces a single point of failure for the registration path; any bug in the wrapper propagates to all Dockerized services.  

---

## System Structure Insights  

* The **DockerizedServices** component is organized around *startup scripts* (`scripts/*.js`) that each follow the same lifecycle: spawn → register → serve.  
* **`DashboardServiceWrapper`** sits one level above the scripts, acting as a façade that bundles the post‑spawn registration concern.  
* **`ChildProcessSpawner`** is a sibling utility that abstracts the low‑level `fork`/`exec` details; it does not expose any registration hooks, reinforcing the unidirectional flow: *spawn → register*.  

This hierarchy creates a clear vertical slice: the *process* layer (spawner) is independent of the *coordination* layer (PSM registration), which in turn is independent of the *service* layer (the actual dashboard or API logic).

---

## Scalability Considerations  

Because registration is asynchronous and non‑blocking, scaling the number of services does **not** increase start‑up latency. Each service can be launched in parallel without waiting for the PSM. However, the PSM itself must be able to ingest a high volume of fire‑and‑forget calls; if it becomes a bottleneck, registration loss may increase. The design therefore pushes scalability pressure onto the PSM rather than the service start‑up path.

If future growth demands guaranteed visibility of every instance, a more robust registration protocol (e.g., retries with exponential back‑off or a buffered queue) would be needed, but that would trade off the current low‑latency start‑up guarantee.

---

## Maintainability Assessment  

* **Positive factors**  
  * The pattern is *explicitly documented* by the shared scripts, making it easy for new developers to see the intended flow.  
  * Centralizing registration in `DashboardServiceWrapper` reduces code duplication and eases updates.  

* **Potential risks**  
  * The fire‑and‑forget nature can hide registration failures; without automated health checks on the PSM side, developers may miss mis‑registrations.  
  * Since the wrapper contains no retry or fallback logic, any change to the PSM API will require coordinated updates across all Dockerized services.  

Overall, the design is maintainable as long as the operational team monitors PSM health and logs registration errors. Adding a lightweight wrapper around `PSM.registerService` that emits a metric (e.g., “psm.registration.success”) would improve observability without altering the core non‑blocking contract.


## Hierarchy Context

### Parent
- [DashboardServiceWrapper](./DashboardServiceWrapper.md) -- scripts/dashboard-service.js follows the same post-spawn PSM registration pattern as scripts/api-service.js, treating PSM as a non-blocking coordination sink

### Siblings
- [ChildProcessSpawner](./ChildProcessSpawner.md) -- scripts/dashboard-service.js treats the child process as live and authoritative the moment it is forked — PSM acknowledgment is never awaited as a readiness signal, consistent with the non-blocking coordination model described in the parent component.


---

*Generated from 4 observations*
