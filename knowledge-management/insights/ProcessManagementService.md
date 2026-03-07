# ProcessManagementService

**Type:** SubComponent

ProcessManagementService interacts with the WaveController, as shown in wave-controller.ts, to implement work-stealing via shared nextIndex counter, allowing idle workers to pull tasks immediately.

## What It Is  

The **ProcessManagementService** is a sub‑component that lives inside the **DockerizedServices** suite. Its implementation is spread across several concrete files:  

* `integrations/mcp-server-semantic-analysis/src/mock/llm-mock-service.ts` – where the service obtains the **ProcessStateManager** class to create, monitor and clean‑up child processes.  
* `lib/llm/llm-service.ts` – the place where the service’s **lifecycle‑management** logic is defined (creation → execution → termination).  
* `scripts/api-service.js` – the script that wires the service into an **event‑driven** interaction model, allowing other services to trigger or listen to its actions without tight coupling.  
* `batch-analysis.yaml` – the configuration file that drives the execution model (parallelism, resource limits, retry policies, etc.).  

Together, these artefacts give the ProcessManagementService the ability to spin up child processes, coordinate work distribution, react to external events, and recover from transient failures while reporting its activity through the shared **logger.ts** facility.

---

## Architecture and Design  

The observations reveal a **layered, configuration‑driven architecture** that blends several well‑defined patterns without over‑engineering.  

1. **Lifecycle‑Management Pattern** – Encapsulated in `lib/llm/llm-service.ts`, the service follows a clear three‑stage lifecycle (initialize → run → shutdown). This isolates resource acquisition (e.g., spawning child processes via **ProcessStateManager**) from business logic and from cleanup, making the component predictable and testable.  

2. **Event‑Driven Interaction** – `scripts/api-service.js` shows the service publishing and subscribing to domain events. By decoupling callers from the concrete implementation, the system can evolve individual services (including ProcessManagementService) without breaking callers, a design that mirrors the sibling **ServiceRegistry**’s registry‑based approach.  

3. **Configuration‑Driven Execution** – The `batch-analysis.yaml` file supplies all tunable parameters (parallelism degree, retry counts, back‑off strategy). This makes the service portable across environments and aligns with the DockerizedServices philosophy of immutable, declarative configuration.  

4. **Work‑Stealing Scheduler** – Interaction with `wave-controller.ts` introduces a **shared‑counter work‑stealing** mechanism. Idle workers read a common `nextIndex` counter to pull pending tasks, which improves load balancing without a central dispatcher.  

5. **Retry & Resilience** – The `retry.ts` module supplies a reusable retry wrapper that the ProcessManagementService employs around transient operations (e.g., network calls, child‑process startups).  

6. **Centralised Logging** – All operational events flow through the `logger.ts` implementation, providing a uniform observability surface that the sibling **LoggingMechanism** also reuses.  

These patterns cooperate to give the ProcessManagementService a robust, loosely‑coupled, and easily configurable foundation while staying within the bounds of the existing DockerizedServices ecosystem.

---

## Implementation Details  

At the heart of the service is the **ProcessStateManager** class (found in `integrations/mcp-server-semantic-analysis/src/mock/llm-mock-service.ts`). It abstracts the OS‑level process APIs, exposing methods such as `spawn()`, `track()`, and `terminate()`. ProcessManagementService calls `ProcessStateManager.spawn()` for each logical unit of work, registers the resulting PID in an internal state map, and attaches listeners for `exit` and `error` events.  

The **lifecycle logic** in `lib/llm/llm-service.ts` orchestrates the following sequence:  

* **initialize()** – reads `batch-analysis.yaml`, creates a `ProcessStateManager` instance, and registers the service with the **WaveController** (via `wave-controller.ts`).  
* **start()** – subscribes to domain events (e.g., `TASK_SUBMITTED`) published by `scripts/api-service.js`. When a task arrives, the service checks the shared `nextIndex` counter; if the counter indicates work is available, the service claims the index, creates a child process, and records the mapping in the state manager.  
* **handleFailure()** – wraps any asynchronous step with the retry helper from `retry.ts`. The retry policy (maxAttempts, backoff) is read from the YAML configuration, ensuring that transient failures (e.g., temporary network glitches) are retried before the task is marked as failed.  
* **shutdown()** – iterates over the tracked processes, invoking `ProcessStateManager.terminate()` for any that remain alive, then flushes logs via the `logger.ts` instance.  

The **event‑driven glue** in `scripts/api-service.js` uses a lightweight event emitter (Node’s `EventEmitter` or a custom wrapper) to broadcast `PROCESS_STARTED`, `PROCESS_COMPLETED`, and `PROCESS_ERROR`. Listeners in other services (including the sibling **ServiceRegistry**) can react, update their own state, or trigger downstream pipelines.  

All log statements—state changes, retries, errors—are funneled through the shared `logger.ts` implementation, which adds timestamps, severity levels, and (when running inside Docker) container identifiers. This unified logging makes tracing a specific child process from spawn to termination straightforward.

---

## Integration Points  

* **Parent – DockerizedServices** – ProcessManagementService is packaged as a Docker container alongside other services. The container image is built from the same source tree, inheriting the same environment variables and volume mounts (e.g., the `batch-analysis.yaml` configuration).  

* **Sibling – ServiceRegistry** – When a new child process is created, ProcessManagementService registers its metadata (process ID, task type, start time) with the **ServiceRegistry** (`service-registry.ts`). This enables other components to query the current pool of active processes for health checks or routing decisions.  

* **Sibling – LoggingMechanism** – All log output is emitted through the shared **LoggingMechanism** (`logger.ts`). Because the logger is a singleton across DockerizedServices, logs from ProcessManagementService appear in the same centralized stream as logs from other services, simplifying ops‑level monitoring.  

* **WaveController** – The work‑stealing coordination lives in `wave-controller.ts`. ProcessManagementService reads and increments the `nextIndex` counter atomically (via a lock‑free CAS or a simple mutex) to claim work. This tight coupling is intentional: it gives the service direct visibility into the global work queue without an additional broker.  

* **Retry Module** – The `retry.ts` utility is imported wherever a potentially flaky operation occurs (e.g., network calls to external LLM APIs). The retry wrapper returns a promise that either resolves with the successful result or rejects after exhausting attempts, propagating the final error to the lifecycle’s `handleFailure()` path.  

* **Configuration** – `batch-analysis.yaml` is parsed at startup (using a YAML parser) and provides keys such as `maxParallelProcesses`, `retryPolicy`, and `processTimeout`. Changing these values does not require code changes; the service picks up new settings on container restart.  

Overall, ProcessManagementService sits at the intersection of process orchestration, event handling, and system‑wide observability, acting as both a consumer (of tasks from WaveController) and a producer (of status events for ServiceRegistry and LoggingMechanism).

---

## Usage Guidelines  

1. **Configuration First** – Always edit `batch-analysis.yaml` before (re)starting the container. Adjust `maxParallelProcesses` to match the host’s CPU/memory envelope; setting it too high can cause resource contention, while too low under‑utilises the available capacity.  

2. **Idempotent Event Handling** – When emitting or handling events in `scripts/api-service.js`, ensure handlers are idempotent. Because the work‑stealing model may cause the same task index to be claimed by multiple workers in race conditions, event listeners should tolerate duplicate `PROCESS_STARTED` messages.  

3. **Graceful Shutdown** – Invoke the service’s `shutdown()` method (or send a SIGTERM to the container) to allow the **ProcessStateManager** to terminate child processes cleanly. Relying on Docker’s default SIGKILL may leave orphaned processes and obscure log entries.  

4. **Retry Policy Awareness** – The retry logic in `retry.ts` is configuration‑driven. Developers should be mindful of the `maxAttempts` and back‑off strategy to avoid hammering downstream services. For long‑running tasks, consider increasing `processTimeout` in the YAML file rather than inflating retries.  

5. **Observability** – Correlate logs from `logger.ts` with the `processId` field that the ProcessManagementService attaches to every log line. This enables ops teams to trace the complete lifecycle of a child process across container restarts.  

6. **Testing** – Use the mock implementation of **ProcessStateManager** located in `integrations/mcp-server-semantic-analysis/src/mock/llm-mock-service.ts` for unit tests. It simulates process spawning without spawning real OS processes, allowing deterministic verification of lifecycle transitions and retry behavior.  

Following these conventions ensures that ProcessManagementService remains predictable, observable, and resilient as the surrounding DockerizedServices environment evolves.

---

### Summary of Architectural Insights  

| Architectural Pattern | Where Observed | Rationale / Trade‑off |
|-----------------------|----------------|-----------------------|
| Lifecycle‑Management | `lib/llm/llm-service.ts` | Guarantees clean resource allocation and teardown; adds a small overhead of state tracking. |
| Event‑Driven Interaction | `scripts/api-service.js` | Enables loose coupling and extensibility; requires careful handling of duplicate events. |
| Configuration‑Driven Execution | `batch-analysis.yaml` | Promotes portability and easy tuning; changes need container restart. |
| Work‑Stealing Scheduler | `wave-controller.ts` | Improves load balance without a central dispatcher; relies on atomic counter correctness. |
| Retry & Resilience | `retry.ts` | Handles transient failures automatically; excessive retries can increase latency. |
| Centralised Logging | `logger.ts` | Simplifies debugging across services; shared logger must be performant under high concurrency. |

**Design Decisions & Trade‑offs** – The team chose a **single‑process, shared‑counter work‑stealing** model over a more complex message‑queue broker to keep deployment simple within Docker. This reduces operational overhead but places the onus on the WaveController to guarantee atomic updates. The **event‑driven** approach was preferred to a direct method call interface to future‑proof the system for additional services, at the cost of slightly more indirection and the need for idempotent handlers.

**System Structure Insights** – ProcessManagementService acts as a bridge between **task distribution** (WaveController) and **service orchestration** (ProcessStateManager, ServiceRegistry). Its placement inside DockerizedServices means it shares the same container lifecycle and logging infrastructure as its siblings.

**Scalability Considerations** – Scaling horizontally is straightforward: spin up additional Docker containers running the same service; the work‑stealing counter automatically distributes tasks among all instances. Bottlenecks may appear in the shared counter if contention becomes high; a future refinement could replace it with a distributed lock service.  

**Maintainability Assessment** – The clear separation of concerns (lifecycle, event handling, retry, logging) and the use of mockable components (ProcessStateManager mock) make the codebase highly testable and easy to evolve. The primary maintenance burden lies in keeping the YAML configuration synchronized with operational expectations and ensuring that any changes to the event schema are reflected across all listeners.


## Hierarchy Context

### Parent
- [DockerizedServices](./DockerizedServices.md) -- The component's implementation is spread across multiple files, including integrations/mcp-server-semantic-analysis/src/mock/llm-mock-service.ts, lib/llm/llm-service.ts, and scripts/api-service.js, among others. These files contain various classes, functions, and modules that work together to provide the component's functionality. Overall, the DockerizedServices component plays a crucial role in the coding project's infrastructure, enabling the deployment and management of multiple services and tasks.

### Siblings
- [ServiceRegistry](./ServiceRegistry.md) -- ServiceRegistry utilizes a registry-based approach, as seen in service-registry.ts, to manage available services and their metadata.
- [LoggingMechanism](./LoggingMechanism.md) -- LoggingMechanism utilizes a logging framework, as seen in logger.ts, to handle log messages and levels.


---

*Generated from 7 observations*
