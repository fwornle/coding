# HealthChecker

**Type:** SubComponent

The HealthChecker uses the isServiceHealthy function to check the health of services by making requests to their health endpoints.

## What It Is  

**HealthChecker** is the sub‑component responsible for continuously validating that each service managed by the platform is alive and operating correctly. Its logic lives alongside the *DockerizedServices* parent and is invoked through the same start‑up helper found in **`lib/service-starter.js`**. When a service is launched—e.g., the API service via **`scripts/api-service.js`**—the starter calls **`isServiceHealthy`**, which is the core entry point of HealthChecker. The component performs protocol‑specific health probes (HTTP and TCP), enforces a configurable timeout, records health‑related metrics, and applies a retry strategy to tolerate transient failures. All of this is coordinated with the **ServiceManager**, which owns the service lifecycle and ensures that a service is only marked “ready” after HealthChecker reports a successful check.

---

## Architecture and Design  

The design of HealthChecker follows a **coordinator‑worker** style where the **ServiceManager** acts as the coordinator and HealthChecker supplies the worker logic for health validation. The observations point to a **retry‑with‑backoff** pattern: HealthChecker implements its own retry loop, while a sibling component, **RetryMechanism**, supplies an exponential back‑off algorithm that the health‑check retries reuse. This separation keeps the retry policy reusable across start‑up and health‑check flows.

HealthChecker is **protocol‑agnostic** but currently supports **HTTP** and **TCP** health probes. By abstracting the probe behind a simple function signature (`isServiceHealthy(serviceConfig)`), the component can be extended with additional protocols without altering the surrounding orchestration code. The timeout guard prevents indefinite waits, a classic **circuit‑breaker**‑like safeguard, though the full circuit‑breaker implementation is not observed.

Metrics collection is baked into the health‑check path, giving the system visibility into failure rates, latency of health probes, and retry counts. This aligns with an **observability** design principle, allowing the DockerizedServices parent and other monitoring tooling to react to health degradation.

Interaction flow (derived from the hierarchy context):  

1. **DockerOrchestrator** spins up a Docker container.  
2. **ServiceManager** receives the container handle and calls `startService` in `lib/service-starter.js`.  
3. `startService` invokes **HealthChecker** via `isServiceHealthy`.  
4. HealthChecker performs protocol‑specific probes, applies a timeout, records metrics, and, if needed, retries using the **RetryMechanism** policy.  
5. On success, ServiceManager marks the service as “healthy” and registers it in **ServiceRegistry**.

---

## Implementation Details  

- **Entry Point – `isServiceHealthy`**: This function accepts a service configuration object (including endpoint URL, protocol, timeout, and retry settings). It decides which probe to run based on the `protocol` field.  
- **Protocol Probes**:  
  * **HTTP** – Sends a GET request to the service’s `/health` endpoint and expects a 2xx response.  
  * **TCP** – Attempts to open a socket to the configured host/port and validates that the connection is established.  
- **Timeout Handling**: Each probe is wrapped in a timer that aborts the request after the configured period, ensuring the health check never blocks the start‑up pipeline.  
- **Retry Logic**: HealthChecker delegates the back‑off calculation to the **RetryMechanism** sibling. The loop runs up to the configured retry count, sleeping for the back‑off interval between attempts. If all attempts fail, the health check reports failure to ServiceManager.  
- **Metrics**: After each probe, HealthChecker increments counters such as `health_success`, `health_failure`, and records latency histograms. These metrics are exposed to the broader monitoring stack (e.g., Prometheus) via the parent DockerizedServices component.  
- **Service‑Specific Logic**: Some services require custom validation beyond a simple “alive” ping (e.g., checking a version string in the HTTP payload). HealthChecker allows callers to supply a `validationFn` that runs after a successful protocol probe, enabling these service‑specific checks without hard‑coding them.

Because no concrete class definitions were listed, the implementation appears to be **functional** rather than object‑oriented: the health‑check behavior is encapsulated in pure functions (`isServiceHealthy`, `probeHttp`, `probeTcp`) that are composed together at call time.

---

## Integration Points  

- **Parent – DockerizedServices**: HealthChecker is invoked from the service‑starter library (`lib/service-starter.js`) that DockerizedServices uses to launch containers. The parent supplies the service configuration and consumes the health‑check result to decide whether a container is ready.  
- **Sibling – ServiceManager**: Directly consumes the boolean outcome of `isServiceHealthy` and updates the service lifecycle state (e.g., moving from *starting* to *ready*).  
- **Sibling – RetryMechanism**: Provides the exponential back‑off algorithm used by HealthChecker’s retry loop. This keeps the retry policy consistent across both start‑up and health‑check phases.  
- **Sibling – ServiceRegistry**: After a successful health verification, ServiceManager registers the service (name, status, configuration) in the registry; HealthChecker’s metrics are also stored here for later querying.  
- **Sibling – DockerOrchestrator**: While DockerOrchestrator handles container isolation, it relies on HealthChecker’s outcome to decide when a container is considered healthy enough to be added to the orchestrated network.  

The only external dependency explicitly mentioned is the **network stack** (HTTP client, TCP socket) used for probing. All other interactions are internal function calls within the JavaScript codebase.

---

## Usage Guidelines  

1. **Configure Timeouts and Retries Explicitly** – When defining a service in the configuration passed to `startService`, always set `healthTimeoutMs` and `maxHealthRetries`. The defaults are intentionally conservative to avoid false‑positive failures.  
2. **Prefer Built‑In Protocols** – Use the supported `http` or `tcp` protocols unless a custom probe is absolutely required. Adding a new protocol means extending the probe dispatcher inside `isServiceHealthy`.  
3. **Supply Validation Functions for Complex Services** – For services that need more than a simple “port open” check (e.g., verifying a DB schema version), provide a `validationFn` that returns a boolean. This keeps the core health‑check logic reusable.  
4. **Monitor Metrics** – HealthChecker emits counters and latency histograms; integrate these into your observability dashboards to spot flaky services early.  
5. **Do Not Block the Event Loop** – The health‑check implementation uses async/await with proper timeout cancellation. Avoid adding synchronous, long‑running code inside the probe functions.  

Following these conventions ensures that the start‑up pipeline remains fast, that services are only marked healthy after genuine verification, and that the system’s observability remains accurate.

---

### 1. Architectural patterns identified  

* **Coordinator‑Worker** – ServiceManager coordinates health checks performed by HealthChecker.  
* **Retry‑With‑Backoff** – HealthChecker’s retry loop leverages the exponential back‑off logic from the RetryMechanism sibling.  
* **Protocol‑Abstraction** – A single `isServiceHealthy` entry point abstracts over HTTP and TCP probes, enabling extensibility.  
* **Observability Hook** – Embedded metrics collection aligns with an observability pattern.

### 2. Design decisions and trade‑offs  

* **Functional vs. OO** – HealthChecker is implemented as pure functions, which simplifies testing and reduces shared mutable state, at the cost of lacking a formal class hierarchy that could encapsulate per‑service state.  
* **Timeout Guard** – Prevents hangs but may cause false‑negatives on slow networks; the trade‑off favors system responsiveness.  
* **Retry Limits** – Balances tolerance for transient failures against start‑up latency; configurable limits let operators tune per‑environment.  
* **Protocol Scope** – Supporting only HTTP and TCP keeps the implementation lightweight; adding new protocols will require code changes, but the abstraction makes it straightforward.

### 3. System structure insights  

HealthChecker sits at the intersection of **service lifecycle management** (ServiceManager) and **container orchestration** (DockerOrchestrator). It is a leaf node in the hierarchy (no children) but is a critical gatekeeper for the parent DockerizedServices component. Its shared use of RetryMechanism demonstrates a common utility layer across sibling components, promoting consistency.

### 4. Scalability considerations  

* **Parallel Checks** – Because health checks are async, the system can probe many services concurrently, limited only by the Node.js event loop and underlying network resources.  
* **Metric Aggregation** – As the number of services grows, the volume of health‑check metrics will increase; downstream monitoring must be sized accordingly.  
* **Timeout & Retry Configuration** – For large fleets, aggressive timeouts and low retry counts reduce start‑up latency, but may increase false‑negative rates; operators should tune per deployment scale.

### 5. Maintainability assessment  

HealthChecker’s **function‑centric** design, clear separation of concerns (probe, timeout, retry, metrics), and reliance on shared utilities (RetryMechanism) make the codebase easy to understand and extend. The lack of hidden state reduces bug surface area. However, because no class abstractions exist, adding per‑service state (e.g., health history) would require introducing a new data structure, which could increase complexity. Overall, the component is **highly maintainable** as long as new protocols or validation logic are added through the existing dispatcher and optional validation callbacks rather than by modifying core probe code.

## Hierarchy Context

### Parent
- [DockerizedServices](./DockerizedServices.md) -- [LLM] The DockerizedServices component utilizes lib/service-starter.js to manage the startup of various services, including the LLMService, with retry logic and health verification. This is evident in the use of the startService function in lib/service-starter.js, which takes a service configuration object as an argument and attempts to start the service with a specified number of retries. The health verification is performed using the isServiceHealthy function, which checks the service's health by making a request to its health endpoint. For example, in the scripts/api-service.js file, the startAPIService function uses the startService function from lib/service-starter.js to start the API service. The use of this library ensures that services are properly initialized and ready for use, which is crucial for the operational integrity of the project. Furthermore, the integration of this library with the semantic analysis pipeline, as seen in the mcp-server-semantic-analysis component, highlights the component's role in supporting key project functionalities.

### Siblings
- [ServiceManager](./ServiceManager.md) -- The ServiceManager uses the startService function in lib/service-starter.js to start services with retry logic and health verification.
- [DockerOrchestrator](./DockerOrchestrator.md) -- The DockerOrchestrator uses Docker containerization to manage services, ensuring isolation and scalability.
- [RetryMechanism](./RetryMechanism.md) -- The RetryMechanism uses a exponential backoff strategy to retry service startup, preventing cascading failures.
- [ServiceRegistry](./ServiceRegistry.md) -- The ServiceRegistry uses a service registry data structure to store service information, including service name, status, and configuration.

---

*Generated from 7 observations*
