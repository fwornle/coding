# ServiceStarter

**Type:** SubComponent

startServiceWithRetry() in lib/service-starter.js wraps a caller-supplied start function and health-check function, retrying with exponential backoff on failure

# ServiceStarter — Technical Insight Document

## What It Is

ServiceStarter is implemented in `lib/service-starter.js` and centers on a single exported function, `startServiceWithRetry()`. This function wraps a caller-supplied start function and a caller-supplied health-check function, providing retry-with-backoff semantics around the volatile process of bringing a service online. It is not a service itself but a reusable reliability primitive that other components in the DockerizedServices layer depend on to avoid duplicating startup logic.

As the parent component, DockerizedServices provides the overall containerization and process-management layer for Coding's services (MCP, constraint monitor, graphify, LLM services). ServiceStarter is the piece of that layer specifically responsible for making startup itself robust — handling transient failures, timeouts, and required-vs-optional service semantics.

![ServiceStarter — Architecture](images/service-starter-architecture.png)

## Architecture and Design

The core architectural pattern is a **wrapper/decorator pattern**: `startServiceWithRetry()` does not know how to start any particular service; instead it accepts a start function and a health-check function as parameters and applies cross-cutting reliability behavior around them. This keeps service-specific startup logic (how to spawn a process, how to check its health) decoupled from generic retry/backoff/timeout logic.

A second key pattern is the **timeout boundary via `withDeadline()`**, which wraps any single start attempt or health check so that a hung operation is treated as a failure rather than blocking startup indefinitely. This is layered underneath the retry loop, meaning each retry attempt is itself deadline-bounded.

The third pattern is **graceful degradation via required/optional classification**. Services marked optional are allowed to fail without aborting the overall startup sequence, while required services presumably do abort or escalate failure. This lets DockerizedServices bring up a partially degraded but still-useful system rather than an all-or-nothing startup.

Exponential backoff between retries is a deliberate trade-off favoring reduced load on dependent services during transient failures over faster failure detection — appropriate for a startup sequence where dependent services (databases, other containers) may still be initializing.

## Implementation Details

`startServiceWithRetry()` in `lib/service-starter.js` is the sole entry point described in the observations. Internally it composes:

- A **retry loop** that re-invokes the caller's start function on failure, using exponentially growing backoff intervals between attempts to avoid hammering dependent services.
- A **deadline wrapper (`withDeadline()`)** applied to both the start function and the health-check function per attempt, ensuring no single attempt can stall the process indefinitely.
- A **required/optional flag** that governs whether an exhausted retry sequence propagates as a fatal error or is swallowed as a non-fatal degradation.

Notably, health-check logic itself is not implemented here — it is supplied by the caller, which in practice means functions built on top of sibling component ServiceProbe's `probeHttpHealth()` and `probeTcpPort()` (`lib/utils/service-probe.js`) are natural candidates to pass in as the health-check argument, though the observations describe ServiceStarter as accepting a generic function rather than hard-depending on ServiceProbe.

## Integration Points

ServiceStarter is designed to be called by wrapper scripts rather than embedding retry logic per service — specifically `api-service.js` and `dashboard-service.js`, which are also documented as ServiceWrapperScripts siblings. These scripts follow a consistent pattern of resolving CODING_REPO-relative paths, verifying target files/directories, spawning the real process, and forwarding signals — and it is within this flow that they would invoke `startServiceWithRetry()` to supervise the spawn/health-check cycle.

![ServiceStarter — Relationship](images/service-starter-relationship.png)

Because it is described as "the single choke-point for startup reliability logic," ServiceStarter is shared across the MCP, constraint monitor, graphify, and LLM services — all of which live under the DockerizedServices parent. This makes it a load-bearing dependency: any change to backoff timing, deadline behavior, or required/optional semantics affects startup behavior system-wide rather than for a single service.

Its sibling HealthCoordinator (`scripts/health-coordinator.js`) performs a related but distinct function — polling already-running services every 5 seconds using ServiceProbe — whereas ServiceStarter operates specifically during the startup/bring-up window. ProcessStateManager registration/unregistration, mentioned as occurring in the wrapper scripts, happens alongside but outside of ServiceStarter's own responsibility.

## Usage Guidelines

Developers adding a new dockerized service should not write bespoke retry/backoff code in a new wrapper script; instead they should follow the pattern of `api-service.js`/`dashboard-service.js` and call `startServiceWithRetry()`, supplying a start function and a health-check function specific to that service. The health-check function is a natural place to reuse ServiceProbe's `probeHttpHealth()` or `probeTcpPort()` rather than reimplementing health verification.

When integrating a new service, developers must explicitly decide whether it is required or optional — required services should be reserved for those whose failure should abort the whole startup sequence, while optional ones should be used when the system can operate in a degraded but functional state without them.

Because backoff and deadline behavior are centralized, do not implement local retry loops around start/health functions passed into ServiceStarter; doing so would double the backoff effect and undermine the "single choke-point" design intent that keeps startup reliability logic consistent across the MCP, constraint monitor, graphify, and LLM services.


## Hierarchy Context

### Parent
- [DockerizedServices](./DockerizedServices.md) -- DockerizedServices provides the containerization and process-management layer that wraps Coding's various services (semantic analysis MCP, constraint monitor API/dashboard, graphify, LLM services) so they can run reliably both inside Docker containers and as standalone Node processes managed by a Global Service Coordinator. The layer combines Docker artifacts (docker-compose.yml, Dockerfile.coding-services, supervisord.conf, entrypoint.sh) with a set of Node.js wrapper scripts (api-service.js, dashboard-service.js) that spawn actual backend processes, forward signals, and register/unregister with a ProcessStateManager (PSM) for lifecycle tracking.

A core architectural pattern is robust startup with retry/backoff and health verification, implemented in lib/service-starter.js's startServiceWithRetry(), which wraps a start function and a health-check function with timeouts (via withDeadline) and exponential backoff, distinguishing required vs optional services for graceful degradation. Complementing this, lib/utils/service-probe.js implements liveness probes (probeHttpHealth, probeTcpPort) used by scripts/health-coordinator.js to poll services every 5 seconds per config/health-verification-rules.json, strictly avoiding false-positive 'healthy' states per its SPEC R6 invariant.

Service wrappers such as api-service.js and dashboard-service.js follow a consistent pattern: resolve CODING_REPO-relative paths, verify target files/directories exist, spawn the real process with stdio inherited, forward SIGTERM/SIGINT, and asynchronously register/unregister with ProcessStateManager for centralized process tracking across the dockerized/global service fleet. Mock-mode support (llm-mock-service.ts) allows service behavior (LLM calls) to be swapped for deterministic mocks driven by a shared workflow-progress.json state file, aiding testing inside containers where CODING_ROOT may differ from host paths.

### Siblings
- [ServiceProbe](./ServiceProbe.md) -- probeHttpHealth() in lib/utils/service-probe.js issues HTTP requests to a service's health endpoint and interprets response codes/timeouts
- [ProcessStateManager](./ProcessStateManager.md) -- scripts/process-state-manager.js exposes register/unregister operations called asynchronously by wrapper scripts like api-service.js and dashboard-service.js
- [LLMMockService](./LLMMockService.md) -- integrations/semantic-analysis/src/mock/llm-mock-service.ts implements mode management supporting 'mock', 'local', and 'public' LLM call routing
- [HealthCoordinator](./HealthCoordinator.md) -- scripts/health-coordinator.js polls services every 5 seconds, using probeHttpHealth() and probeTcpPort() from lib/utils/service-probe.js
- [ServiceWrapperScripts](./ServiceWrapperScripts.md) -- api-service.js and dashboard-service.js resolve CODING_REPO-relative paths before spawning target processes, supporting both container and host execution


---

*Generated from 6 observations*
