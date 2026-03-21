# ProcessManagementService

**Type:** SubComponent

The ServiceStarter script in lib/service-starter.js is used by ProcessManagementService for robust service startup with retry, timeout, and health verification.

## What It Is  

`ProcessManagementService` lives inside the **DockerizedServices** component and is responsible for orchestrating the lifecycle of child processes that constitute the broader system (e.g., the API service and the dashboard service). The service is implemented in the repository’s root under the logical name *ProcessManagementService* and relies heavily on two concrete scripts:

* **`lib/service-starter.js`** – a reusable starter utility that provides retry, timeout, and health‑check capabilities.  
* **`scripts/api-service.js`** and **`scripts/dashboard-service.js`** – thin wrappers that invoke the actual API and dashboard processes.

The service does not contain its own process‑spawning code; instead, it delegates to the **`ProcessStateManager`** (the central registry for child‑process state) and collaborates with **`LLMServiceManager`** to guarantee that any required LLM‑related services are up and registered before the child processes are launched.

In short, `ProcessManagementService` is the **standardized interface** through which the Dockerized environment starts, monitors, and shuts down its constituent services, ensuring consistent behavior across all child processes.

---

## Architecture and Design  

The observations reveal a **centralized orchestration architecture**. `ProcessManagementService` acts as a façade that hides the complexities of process startup, health verification, and state tracking behind a simple API. The key design elements are:

1. **Service Starter Utility (`lib/service-starter.js`)** – This module encapsulates a **retry‑with‑timeout** pattern. By wrapping the actual start‑up logic of each child process, it guarantees that transient failures are retried a configurable number of times and that a health‑check is performed before the process is considered “ready”. This pattern is reused for both the API and dashboard services, demonstrating a **code‑reuse** strategy.

2. **Process State Management (`ProcessStateManager`)** – All child processes are registered with a single manager, providing a **single source of truth** for process status (running, stopped, failed). This design supports **consistent state queries** and simplifies shutdown coordination.

3. **LLM Service Coordination (`LLMServiceManager`)** – Before any child process is launched, `ProcessManagementService` contacts `LLMServiceManager` to ensure that LLM services are initialized and registered. This introduces a **dependency‑ordering** discipline: LLM services must be ready before dependent services start, preventing race conditions.

4. **Sibling Collaboration** – The service shares the same `service‑starter.js` utility with its siblings **APIService** and **DashboardService**, reinforcing a **shared infrastructure** approach within the Dockerized micro‑service ecosystem.

Overall, the architecture leans on **composition over inheritance**, using small, purpose‑built scripts (the service starter and the state manager) that are composed together to achieve robust process orchestration.

---

## Implementation Details  

### Core Orchestration Flow  

1. **Initialization** – When `ProcessManagementService` is invoked (typically at container start‑up), it first contacts `LLMServiceManager`. The manager checks that the LLM service (implemented in `lib/llm/llm-service.ts` as part of the sibling component) is alive and properly registered.

2. **Process Registration** – For each child service (API, dashboard), `ProcessManagementService` creates an entry in `ProcessStateManager`. The manager tracks metadata such as PID, start time, and health status.

3. **Startup via Service Starter** – The service calls `service‑starter.js` with the path to the child script (`scripts/api-service.js` or `scripts/dashboard-service.js`). The starter:
   * Spawns the child process.
   * Applies a **retry loop** (configurable attempts) if the child exits prematurely.
   * Enforces a **timeout** to avoid indefinite waiting.
   * Executes a **health verification** callback (often an HTTP ping or a custom readiness probe) before marking the process as “healthy”.

4. **State Updates** – Successful health checks cause `ProcessStateManager` to update the process record to “running”. Failures after all retries result in a “failed” state, which can be surfaced to the Docker orchestrator for remediation.

### Key Modules  

| Module | Path | Role |
|--------|------|------|
| `ProcessStateManager` | *(implicit, referenced)* | Central registry for child‑process lifecycle data. |
| `ServiceStarter` | `lib/service-starter.js` | Implements retry, timeout, and health‑check logic for any service start‑up. |
| API start script | `scripts/api-service.js` | Entrypoint that launches the API process; invoked via `ServiceStarter`. |
| Dashboard start script | `scripts/dashboard-service.js` | Entrypoint that launches the dashboard process; invoked via `ServiceStarter`. |
| LLM coordination | `LLMServiceManager` (sibling) | Guarantees LLM services are ready before other services start. |

No direct source code was provided, but the naming and responsibilities are explicit in the observations, allowing us to infer the flow described above.

---

## Integration Points  

`ProcessManagementService` sits at the intersection of three major subsystems:

1. **Parent – DockerizedServices**  
   The parent component defines the container boundary. Each child service started by `ProcessManagementService` runs in its own Docker container (as implied by the parent’s micro‑service description). The service therefore must expose health endpoints that Docker can probe, and it must respect container‑level signals (e.g., SIGTERM) for graceful shutdown.

2. **Sibling – LLMServiceManager**  
   Before any child process is launched, `ProcessManagementService` calls into `LLMServiceManager`. This dependency ensures that any LLM‑related capabilities (caching, circuit‑breaking) are available to downstream services. The integration is a **synchronous readiness check**.

3. **Sibling – APIService & DashboardService**  
   Both siblings share the same `service‑starter.js` utility. Their start scripts (`scripts/api-service.js`, `scripts/dashboard-service.js`) are passed to `ProcessManagementService` as arguments. Consequently, any change to the starter’s retry or health‑check logic automatically propagates to both services, guaranteeing uniform startup behavior.

External integrations are limited to the **process‑level** (spawning, monitoring) and **service‑level** (health checks, LLM readiness). No database, message queue, or network protocol specifics are mentioned in the observations.

---

## Usage Guidelines  

* **Always invoke through the Service Starter** – Directly spawning a child process bypasses the retry/timeout/health logic and defeats the purpose of the centralized orchestration. Use `lib/service-starter.js` as the sole entry point for launching `scripts/api-service.js` or `scripts/dashboard-service.js`.

* **Register before starting** – Prior to invoking the starter, ensure that the child process is recorded in `ProcessStateManager`. This guarantees that state queries (e.g., “is the API running?”) are accurate from the moment the process begins.

* **Respect LLM readiness** – Do not start dependent services until `LLMServiceManager` reports a successful registration. This ordering prevents downstream failures caused by missing LLM capabilities.

* **Configure retry and timeout sensibly** – The starter’s defaults should be reviewed for the production environment. Overly aggressive retries can mask underlying issues; overly short timeouts may cause premature failures.

* **Graceful shutdown** – When the Docker container receives a termination signal, `ProcessManagementService` should iterate over the entries in `ProcessStateManager` and send appropriate shutdown signals to each child process, allowing them to clean up resources before the container exits.

---

## Architectural Patterns Identified  

1. **Facade / Centralized Orchestration** – `ProcessManagementService` provides a single, uniform interface for starting, monitoring, and stopping child processes.  
2. **Retry‑With‑Timeout Wrapper** – Implemented in `lib/service-starter.js`, encapsulating resilience logic for service startup.  
3. **State‑Registry (Singleton‑like) Pattern** – `ProcessStateManager` acts as a global registry for process metadata, ensuring consistent visibility across the system.  
4. **Dependency‑Ordering** – Explicit readiness check against `LLMServiceManager` before launching dependent services.

---

## Design Decisions and Trade‑offs  

* **Centralization vs. Decentralized Control** – By funneling all process management through a single service, the system gains consistency and easier debugging, but it also creates a single point of failure. If `ProcessManagementService` crashes, all child services may become orphaned.  

* **Reusable Service Starter** – Sharing `service‑starter.js` across siblings reduces duplication and enforces uniform resilience, but it couples the startup semantics of all services; a change needed for one service (e.g., a longer timeout) immediately affects the others.  

* **Explicit LLM Dependency** – Requiring LLM readiness before any other service starts guarantees functional correctness but adds start‑up latency, especially if the LLM component is slow to initialize.  

* **ProcessStateManager as Global State** – Simplifies status queries and coordinated shutdowns, yet maintaining a global mutable state can become a concurrency concern if multiple threads or async handlers modify it simultaneously.

---

## System Structure Insights  

The DockerizedServices component embodies a **container‑per‑service** model, where each logical service (API, dashboard, LLM) runs in its own container. `ProcessManagementService` sits at the host‑level orchestration layer, coordinating these containers via process handles. The sibling services share common infrastructure (the service starter) but remain logically independent, allowing them to be scaled or replaced individually.

---

## Scalability Considerations  

* **Horizontal Scaling of Child Services** – Because each child runs in its own container, additional instances can be launched by invoking `service‑starter.js` multiple times with distinct configurations (e.g., different ports). `ProcessStateManager` would need to support multiple entries per service type to track each instance.  

* **Startup Bottleneck** – The sequential dependency on `LLMServiceManager` may become a bottleneck if many services are added that all wait on the same LLM readiness check. Parallelizing LLM readiness verification or caching its ready state could mitigate this.  

* **Resource Contention** – All child processes share the host’s resources (CPU, memory). The central manager could be extended to monitor resource usage and apply back‑pressure or throttling when limits are approached.

---

## Maintainability Assessment  

The current design promotes **high maintainability** through:

* **Clear separation of concerns** – Startup logic lives in `service‑starter.js`, state tracking in `ProcessStateManager`, and LLM coordination in `LLMServiceManager`.  
* **Reusability** – The same starter script is reused across multiple services, reducing code duplication.  
* **Explicit interfaces** – The service exposes a standardized API for process management, making it straightforward for new developers to understand how to add additional child services.

Potential maintainability risks include:

* **Implicit coupling via shared starter configuration** – Changes to retry or health‑check behavior affect all services, which may require coordinated testing.  
* **Lack of type safety or documentation** – The observations do not mention TypeScript typings or extensive comments; if the codebase lacks these, future contributors might struggle to extend the manager safely.  

Overall, the architecture balances robustness with simplicity, providing a solid foundation for future extensions while keeping the operational surface area small.

## Hierarchy Context

### Parent
- [DockerizedServices](./DockerizedServices.md) -- The DockerizedServices component leverages a microservices architecture, where each service runs in its own container, providing flexibility, scalability, and ease of deployment. This is evident in the use of separate scripts for starting the API service (scripts/api-service.js) and the dashboard service (scripts/dashboard-service.js). The ServiceStarter script (lib/service-starter.js) is used for robust service startup with retry, timeout, and health verification, ensuring that services are properly initialized and registered. The LLMService class (lib/llm/llm-service.ts) handles high-level LLM operations, including mode routing, caching, and circuit breaking, which helps in managing the complexity of LLM-related tasks.

### Siblings
- [LLMServiceManager](./LLMServiceManager.md) -- LLMServiceManager leverages the LLMService class in lib/llm/llm-service.ts to handle mode routing, caching, and circuit breaking for LLM-related tasks.
- [APIService](./APIService.md) -- APIService uses the scripts/api-service.js file to start the API service, providing a clear entry point for API-related functionality.
- [DashboardService](./DashboardService.md) -- DashboardService uses the scripts/dashboard-service.js file to start the dashboard service, providing a clear entry point for dashboard-related functionality.

---

*Generated from 7 observations*
