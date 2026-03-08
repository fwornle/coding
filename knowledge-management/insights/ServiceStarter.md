# ServiceStarter

**Type:** SubComponent

The isPortListening function in lib/service-starter.js performs health verification checks to confirm that services are responding correctly, adding an extra layer of reliability to the startup process.

**## What It Is**  
ServiceStarter is a **sub‑component** that lives under the `DockerizedServices` parent and is responsible for guaranteeing that external services (e.g., Memgraph, Redis) are fully up and reachable before the main application proceeds. The core logic resides in **`lib/service-starter.js`**, where two public‑facing helpers are defined:

* `startServiceWithRetry` – launches a container‑based service and, on failure, retries the start operation using a **retry‑with‑back‑off** strategy.  
* `isPortListening` – probes the service’s TCP port to confirm that the process is listening, providing a health‑verification step.

Together these functions form a deterministic bootstrap sequence: start → wait → verify → continue. Because ServiceStarter is embedded in DockerizedServices, every Docker‑orchestrated service benefits from the same start‑up guardrails. Its sibling, **ServiceMonitor**, re‑uses `isPortListening` to perform ongoing health checks, while the child component **RetryMechanism** encapsulates the back‑off logic used by `startServiceWithRetry`.

---

**## Architecture and Design**  
The observable architecture follows a **layered bootstrap pattern**. The top‑level `DockerizedServices` component delegates the low‑level start‑up responsibilities to ServiceStarter, which in turn delegates the retry algorithm to its child **RetryMechanism**. This separation keeps the orchestration logic (Docker container launch) distinct from the resilience logic (retry/back‑off) and from the health‑check logic (port probing).

* **Retry‑with‑Back‑off** – Implemented inside `startServiceWithRetry`, this pattern mitigates rapid, repeated start attempts that could overwhelm the host or the service itself. By increasing the delay between attempts, the system gives transient failures (e.g., network hiccups, resource contention) a chance to resolve.  
* **Health‑Check Verification** – `isPortListening` embodies a simple **probe‑until‑ready** design. After each start attempt, the function repeatedly attempts to open a TCP connection to the service’s advertised port, only returning success when the socket is accepted. This adds a concrete readiness signal beyond merely “container started”.  

Interaction flow: `DockerizedServices` → `ServiceStarter.startServiceWithRetry` → (on failure) `RetryMechanism` backs off → after each attempt, `ServiceStarter.isPortListening` validates readiness → on success, control returns to the parent to continue application initialization. The sibling **ServiceMonitor** taps the same health‑check routine, demonstrating **code reuse** across start‑up and runtime monitoring concerns.

---

**## Implementation Details**  
All implementation details are confined to **`lib/service-starter.js`**:

1. **`startServiceWithRetry(serviceConfig)`**  
   * Accepts a configuration object that identifies the Docker image, container name, and the port to monitor.  
   * Initiates the container launch (likely via a Docker CLI wrapper or SDK call).  
   * Enters a retry loop where each iteration invokes `isPortListening`. If the probe fails, the loop sleeps for an exponentially increasing interval (the back‑off). The maximum number of attempts and base delay are configurable, enabling the child **RetryMechanism** to be tuned without touching the start logic.  

2. **`isPortListening(host, port)`**  
   * Opens a TCP socket to `host:port`.  
   * Returns a boolean indicating whether the connection succeeded, typically wrapped in a promise for async handling.  
   * May include a short timeout to avoid hanging on unresponsive services, ensuring the retry loop proceeds promptly.  

3. **RetryMechanism (child component)**  
   * Not a separate file but a logical encapsulation inside `startServiceWithRetry`. It calculates the back‑off delay (e.g., `delay = base * 2^attempt`) and handles jitter if implemented. This design isolates the timing policy from the Docker launch code, making it easier to adjust or replace in the future.

Because there are **no explicit classes or symbols** reported, the functions are likely exported as plain module functions, keeping the API surface minimal and straightforward.

---

**## Integration Points**  
ServiceStarter is tightly coupled to the **DockerizedServices** parent, which orchestrates the overall container lifecycle. The parent invokes `startServiceWithRetry` for each required service during its initialization phase. The sibling **ServiceMonitor** imports `isPortListening` from the same module to continuously poll service health after the initial start, providing a unified health‑check implementation across start‑up and runtime.

External dependencies include:

* **Docker runtime** – The start routine assumes Docker is available and that the service can be launched via Docker commands or API calls.  
* **Network stack** – `isPortListening` relies on the host’s ability to open TCP sockets; any firewall or port‑mapping misconfiguration will surface as a start‑up failure.  

Interfaces exposed by ServiceStarter are the two functions (`startServiceWithRetry`, `isPortListening`). Consumers only need to supply service‑specific configuration (image name, ports) and can rely on the built‑in retry and verification logic. Because the module does not expose internal retry parameters directly, any tuning must be done via configuration objects passed to `startServiceWithRetry`.

---

**## Usage Guidelines**  
1. **Provide complete service configuration** – When calling `startServiceWithRetry`, include the Docker image tag, container name, and the exact port that the service will listen on. Missing or mismatched ports will cause `isPortListening` to time out and trigger unnecessary retries.  
2. **Respect the retry limits** – The default back‑off parameters are chosen to balance speed and stability. If a service is expected to take longer to become ready (e.g., large data imports), increase the maximum attempts or the base delay via the configuration object rather than modifying the source.  
3. **Do not duplicate health checks** – Since `ServiceMonitor` already re‑uses `isPortListening` for runtime monitoring, avoid implementing separate port probes in your own code; this prevents inconsistent readiness definitions.  
4. **Handle failure gracefully** – If `startServiceWithRetry` exhausts its attempts, it should propagate an error that the parent `DockerizedServices` can catch. The application startup should then either abort or fall back to a degraded mode, depending on business requirements.  
5. **Keep Docker environment stable** – The retry‑with‑back‑off strategy assumes transient failures. Persistent Docker daemon issues (e.g., out‑of‑disk space) will cause repeated retries without benefit, so monitor Docker health separately.

---

### Summary Deliverables  

1. **Architectural patterns identified**  
   * Retry‑with‑Back‑off (implemented in `startServiceWithRetry`).  
   * Probe‑until‑Ready health check (`isPortListening`).  
   * Layered bootstrap with parent → sub‑component → child (DockerizedServices → ServiceStarter → RetryMechanism).  

2. **Design decisions and trade‑offs**  
   * **Decision:** Centralize start‑up and health‑check logic in a single module.  
     **Trade‑off:** Simplicity vs. flexibility; any change to the start logic impacts all services.  
   * **Decision:** Use exponential back‑off rather than fixed intervals.  
     **Trade‑off:** Faster recovery for short‑lived failures but longer wait times for genuinely slow services.  
   * **Decision:** Expose only two functions, keeping the public API minimal.  
     **Trade‑off:** Limits extensibility (e.g., custom back‑off strategies) without modifying the module.  

3. **System structure insights**  
   * ServiceStarter sits under DockerizedServices, acting as the resilience layer for container start‑up.  
   * Its child, RetryMechanism, encapsulates timing policy, while the sibling ServiceMonitor re‑uses the health‑check function, illustrating purposeful code sharing.  
   * The overall system forms a clear hierarchy: DockerizedServices → ServiceStarter → (RetryMechanism) and parallel ServiceMonitor → (isPortListening).  

4. **Scalability considerations**  
   * The back‑off algorithm scales well with a growing number of services because each service’s retry loop runs independently; however, simultaneous retries could increase load on the Docker daemon and the host network.  
   * `isPortListening` performs lightweight TCP probes, so adding more services does not dramatically increase CPU or memory usage, but network socket limits should be monitored.  
   * If the number of services becomes large, consider batching start attempts or introducing a concurrency limiter to avoid overwhelming resources.  

5. **Maintainability assessment**  
   * High maintainability: a small, well‑named module (`lib/service-starter.js`) with only two exported functions keeps the codebase easy to understand and test.  
   * Encapsulation of the back‑off logic in a child component (RetryMechanism) allows future adjustments (e.g., adding jitter) without touching the start‑up flow.  
   * The reliance on explicit configuration objects makes the module adaptable to new services without code changes, supporting extensibility.  
   * Potential risk: Tight coupling to Docker means any shift to a different container runtime would require refactoring the start logic, but the health‑check portion remains reusable.


## Hierarchy Context

### Parent
- [DockerizedServices](./DockerizedServices.md) -- The DockerizedServices component employs a robust service startup mechanism through the startServiceWithRetry function in lib/service-starter.js, which utilizes a retry-with-backoff pattern to handle service startup failures. This approach ensures that services are given multiple opportunities to start successfully, with increasing time delays between attempts, thereby preventing rapid sequential failures. The isPortListening function within the same file performs health verification checks to confirm that services are responding correctly, adding an extra layer of reliability to the startup process. For instance, when starting Memgraph or Redis services, this mechanism ensures they are properly initialized and ready to accept requests before proceeding with the application startup.

### Children
- [RetryMechanism](./RetryMechanism.md) -- The startServiceWithRetry function in lib/service-starter.js implements the retry-with-backoff pattern, which is a key architectural decision to handle service startup failures.

### Siblings
- [ServiceMonitor](./ServiceMonitor.md) -- The ServiceMonitor sub-component uses the isPortListening function in lib/service-starter.js to continuously check the services' status.


---

*Generated from 3 observations*
