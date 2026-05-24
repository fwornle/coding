# PsmRegistrationSideEffect

**Type:** Detail

This ordering means that any PSM consumer (e.g., a health check, routing layer, or orchestrator) polling immediately after spawn may observe the service as unregistered despite it already accepting traffic, a race condition flagged as the defining architectural concern of ApiServiceWrapper.

## What It Is  

**PsmRegistrationSideEffect** is the side‑effect logic that registers a newly‑started service instance with the **ProcessStateManager**. The implementation lives in the **ApiServiceWrapper** sub‑component, whose code is found in `scripts/api-service.js`. Within this file the sequence is explicit: a child process is spawned (via the **ChildProcessSpawner** logic that also resides in `scripts/api-service.js`), the process begins handling traffic, and **only after** the spawn succeeds does the wrapper invoke `ProcessStateManager.registerService()`. The registration does **not** gate the spawn; it is a post‑spawn side effect that informs the PSM (Process State Manager) that the service is now known to the system.

Because registration occurs after the service is already live, any PSM consumer that polls the registration state immediately after the spawn may see the service as *unregistered* even though it is already accepting requests. This race condition is highlighted as the defining architectural concern of the **ApiServiceWrapper**. Moreover, if `ProcessStateManager.registerService()` fails, the child process continues to run but remains permanently invisible to the PSM, creating a “running but unregistered” state.

---

## Architecture and Design  

The observed design follows a **sequential side‑effect pattern**: the primary responsibility of `scripts/api-service.js` is to start a child process, and the secondary responsibility—registering that process with the PSM—is performed as a **post‑condition side effect**. There is no explicit orchestration layer that waits for registration before exposing the service; instead, the wrapper assumes that the service can safely receive traffic immediately after the OS‑level spawn succeeds.

* **Component Interaction**  
  * **ApiServiceWrapper** (the owner of the side effect) directly calls `ProcessStateManager.registerService()` after the spawn step.  
  * **ChildProcessSpawner** is co‑located in the same file; it provides the `spawn` logic but does not itself manage registration.  
  * **ProcessStateManager** acts as a registry/observer that other system parts (health checks, routing layers, orchestrators) query to discover live services.

* **Design Patterns Evident**  
  * **Facade / Wrapper** – `ApiServiceWrapper` hides the complexity of spawning a child process and subsequently registering it, presenting a single entry point for the rest of the system.  
  * **Side‑Effect Invocation** – Registration is treated as a side effect rather than a required step in the creation pipeline.  
  * **Implicit Contract** – The contract between the wrapper and the PSM is that registration will eventually happen; there is no enforcement that registration must succeed before traffic is allowed.

* **Race Condition as Architectural Concern** – The ordering (spawn → register) deliberately decouples service availability from PSM awareness. This design choice simplifies startup latency but introduces a window where external components may misinterpret the service’s state.

---

## Implementation Details  

The core implementation resides in **`scripts/api-service.js`**:

1. **Child Process Spawn** – The wrapper invokes a spawn routine (the exact function name is not listed, but it is part of the **ChildProcessSpawner** logic). The spawn call returns a handle to the child process and signals success once the OS reports the process is running.

2. **Post‑Spawn Registration** – Immediately after a successful spawn, the wrapper executes `ProcessStateManager.registerService()`. The call supplies enough context for the PSM to identify the new service instance (e.g., PID, service name, listening port). No conditional gating is performed; the registration is fire‑and‑forget.

3. **Error Path** – If `registerService()` throws or returns an error, the wrapper does **not** terminate or restart the child process. The process continues to run, but the PSM never receives the registration event, leaving the service in an “unregistered” state from the PSM’s perspective.

4. **No Additional Coordination** – There is no retry logic, health‑check loop, or callback that reconciles the “running but unregistered” scenario. The side effect is a single invocation tied directly to the spawn success path.

Because the code base reports **0 code symbols found**, the concrete class or function names beyond those mentioned are not available. The analysis therefore focuses on the observable call flow and its implications.

---

## Integration Points  

* **ProcessStateManager** – The sole external dependency of the side effect. It provides the `registerService()` method that records the new service. Consumers of the PSM (health checks, routing, orchestrators) rely on this registry to make routing decisions.

* **Health‑Check / Routing Layers** – These components poll the PSM to discover registered services. They may encounter a transient mismatch where a newly spawned service is already handling traffic but is not yet listed in the PSM.

* **Orchestrator / Supervisor** – Any higher‑level controller that expects a service to be both live *and* registered will need to tolerate the race window or implement its own reconciliation.

* **Sibling Component – ChildProcessSpawner** – Shares the same file (`scripts/api-service.js`) and provides the low‑level spawn mechanics. It does not directly interact with the PSM; its output (the child process handle) is consumed by the wrapper to trigger registration.

No other modules, configuration files, or external services are referenced in the observations, so the integration surface is limited to the direct call to `ProcessStateManager.registerService()` and the downstream consumers that read the PSM state.

---

## Usage Guidelines  

1. **Understand the Registration Timing** – Developers should be aware that a service becomes reachable **before** it is registered with the PSM. Any component that depends on the PSM to discover services must tolerate a brief period where the service is live but unregistered.

2. **Handle Registration Failures Explicitly** – Since a failed `registerService()` leaves the process running but invisible to the PSM, callers should consider adding monitoring or retry logic around the registration call if visibility is required for correct operation (e.g., add a watchdog that re‑invokes registration on error).

3. **Avoid Immediate PSM Polling After Spawn** – If a health‑check or routing update is triggered immediately after spawning a child process, insert a short back‑off or listen for a registration event (if the PSM emits one) before assuming the service is fully integrated.

4. **Do Not Couple Service Liveness to PSM State** – Because the design deliberately decouples the two, code that treats “registered” as synonymous with “alive” will be fragile. Separate concerns: use OS‑level process checks for liveness, and the PSM for logical registration.

5. **Future Refactoring Considerations** – If tighter coupling becomes necessary (e.g., to eliminate the race), the registration step could be moved **before** exposing the service to traffic, or a handshake mechanism could be introduced where the child process confirms readiness before registration.

---

### Architectural Patterns Identified  

* Facade/Wrapper (`ApiServiceWrapper`)  
* Side‑Effect Invocation (post‑spawn registration)  

### Design Decisions & Trade‑offs  

* **Decision:** Register after spawn to minimize start‑up latency.  
  * **Benefit:** Service can accept traffic as soon as the OS reports it as running.  
  * **Cost:** Introduces a race condition where consumers may see an unregistered but live service.  

* **Decision:** Do not abort or restart the child process on registration failure.  
  * **Benefit:** Keeps the service running even if the PSM is temporarily unavailable.  
  * **Cost:** Leaves the system with “orphaned” processes that are invisible to orchestration layers.  

### System Structure Insights  

* All spawn‑and‑register logic is centralized in a single file (`scripts/api-service.js`), making the lifecycle easy to trace but also creating a single point of responsibility.  
* The **ChildProcessSpawner** and **PsmRegistrationSideEffect** are siblings that share the same module, reinforcing tight coupling between process creation and registration.

### Scalability Considerations  

* Because registration is a simple fire‑and‑forget call, scaling to many concurrent child processes does not add coordination overhead.  
* However, the race window may widen under high load, increasing the likelihood that health‑check systems see stale state, which could trigger unnecessary fail‑over or scaling actions.

### Maintainability Assessment  

* **Pros:** The logic is co‑located, straightforward, and has minimal indirection—easy for a developer to locate the spawn‑then‑register sequence.  
* **Cons:** The implicit contract and lack of explicit error handling for registration failures can lead to subtle bugs that are hard to detect without dedicated monitoring. Adding retries or event‑driven confirmation would increase code complexity but improve robustness.  

---  

*This document captures the current design and operational characteristics of **PsmRegistrationSideEffect** as implemented in `scripts/api-service.js`. It should serve as a reference for future development, debugging, and architectural refinement.*


## Hierarchy Context

### Parent
- [ApiServiceWrapper](./ApiServiceWrapper.md) -- scripts/api-service.js calls ProcessStateManager.registerService() after the child process is spawned, meaning the service is live before PSM acknowledgment occurs

### Siblings
- [ChildProcessSpawner](./ChildProcessSpawner.md) -- scripts/api-service.js is the single file identified in the sub-component description as housing both the child process spawning step and the subsequent ProcessStateManager.registerService() call, making it the sole owner of the spawn-then-register lifecycle pattern.


---

*Generated from 3 observations*
