# ServiceWrapperScripts

**Type:** SubComponent

api-service.js and dashboard-service.js resolve CODING_REPO-relative paths before spawning target processes, supporting both container and host execution

# ServiceWrapperScripts — Technical Insight Document

## What It Is

ServiceWrapperScripts is implemented as a pair of Node.js entry-point scripts — `api-service.js` and `dashboard-service.js` — that live within the DockerizedServices layer. These wrappers act as thin, consistent process-launchers responsible for taking a service definition (the constraint monitor API and its dashboard, respectively) and turning it into a supervised, lifecycle-tracked OS process. Rather than embedding service logic directly, the wrappers exist purely to bridge the gap between how a process needs to be started/managed in Docker (via supervisord) versus on a bare host, resolving paths, validating targets, spawning children, and forwarding control signals.

## Architecture and Design

The core architectural pattern is **path-agnostic process wrapping**: both scripts resolve `CODING_REPO`-relative paths before spawning target processes, which allows the same code to function correctly whether running inside a container (where `CODING_ROOT` may differ from host paths) or as a standalone host process under a Global Service Coordinator. This mirrors a broader theme in DockerizedServices, where mock-mode services like LLMMockService also have to reconcile in-container vs. host path assumptions.

A **fail-fast validation** pattern precedes every spawn: both wrappers verify that target files/directories exist before attempting to launch a child process. This is a deliberate trade-off favoring clear, immediate errors over silent crash-loop behavior that would otherwise be harder to diagnose under supervisord restart policies.

![ServiceWrapperScripts — Architecture](images/service-wrapper-scripts-architecture.png)

Process I/O is handled via **stdio inheritance** rather than piping or buffering, meaning logs flow directly to the Docker container's stdout/stderr streams for aggregation by supervisord or external log collectors. This is a simplicity-over-flexibility design choice — no custom log formatting or multiplexing layer is introduced at the wrapper level.

## Implementation Details

Each wrapper follows an identical lifecycle sequence: resolve path → verify existence → spawn with inherited stdio → forward signals → register/unregister with ProcessStateManager. Signal forwarding specifically covers SIGTERM/SIGINT, which are propagated from the wrapper process to its spawned child, ensuring graceful shutdown semantics rather than abrupt termination when Docker or a process manager issues a stop signal.

Lifecycle tracking is delegated asynchronously: both `api-service.js` and `dashboard-service.js` call register/unregister operations exposed by ProcessStateManager (`scripts/process-state-manager.js`). This asynchronous, non-blocking registration keeps the wrapper's primary responsibility — spawning and monitoring a single process — decoupled from the bookkeeping needed by the wider fleet-tracking system.

## Integration Points

ServiceWrapperScripts sits directly beneath DockerizedServices in the hierarchy, functioning as the mechanism through which Docker artifacts (docker-compose.yml, Dockerfile.coding-services, supervisord.conf, entrypoint.sh) actually invoke real backend logic. It depends on ProcessStateManager for centralized process lifecycle tracking, a sibling component shared across the dockerized/global service fleet.

![ServiceWrapperScripts — Relationship](images/service-wrapper-scripts-relationship.png)

While the wrappers themselves don't perform retries or health checks, they operate alongside siblings ServiceStarter and ServiceProbe/HealthCoordinator, which provide the retry/backoff and liveness-probing layers on top of the processes these wrappers spawn — the wrapper is concerned with *launching and signaling*, while ServiceStarter/HealthCoordinator concern themselves with *verifying and retrying*.

## Usage Guidelines

Developers adding a new wrapped service should follow the established pattern exactly: resolve paths relative to `CODING_REPO`, validate existence before spawn, inherit stdio, forward SIGTERM/SIGINT, and register/unregister with ProcessStateManager asynchronously. Deviating from stdio inheritance would break log aggregation assumptions in supervisord-managed containers. Because path resolution is CODING_REPO-relative, wrappers must be tested in both container and host execution contexts before being considered complete.


## Hierarchy Context

### Parent
- [DockerizedServices](./DockerizedServices.md) -- DockerizedServices provides the containerization and process-management layer that wraps Coding's various services (semantic analysis MCP, constraint monitor API/dashboard, graphify, LLM services) so they can run reliably both inside Docker containers and as standalone Node processes managed by a Global Service Coordinator. The layer combines Docker artifacts (docker-compose.yml, Dockerfile.coding-services, supervisord.conf, entrypoint.sh) with a set of Node.js wrapper scripts (api-service.js, dashboard-service.js) that spawn actual backend processes, forward signals, and register/unregister with a ProcessStateManager (PSM) for lifecycle tracking.

A core architectural pattern is robust startup with retry/backoff and health verification, implemented in lib/service-starter.js's startServiceWithRetry(), which wraps a start function and a health-check function with timeouts (via withDeadline) and exponential backoff, distinguishing required vs optional services for graceful degradation. Complementing this, lib/utils/service-probe.js implements liveness probes (probeHttpHealth, probeTcpPort) used by scripts/health-coordinator.js to poll services every 5 seconds per config/health-verification-rules.json, strictly avoiding false-positive 'healthy' states per its SPEC R6 invariant.

Service wrappers such as api-service.js and dashboard-service.js follow a consistent pattern: resolve CODING_REPO-relative paths, verify target files/directories exist, spawn the real process with stdio inherited, forward SIGTERM/SIGINT, and asynchronously register/unregister with ProcessStateManager for centralized process tracking across the dockerized/global service fleet. Mock-mode support (llm-mock-service.ts) allows service behavior (LLM calls) to be swapped for deterministic mocks driven by a shared workflow-progress.json state file, aiding testing inside containers where CODING_ROOT may differ from host paths.

### Siblings
- [ServiceStarter](./ServiceStarter.md) -- startServiceWithRetry() in lib/service-starter.js wraps a caller-supplied start function and health-check function, retrying with exponential backoff on failure
- [ServiceProbe](./ServiceProbe.md) -- probeHttpHealth() in lib/utils/service-probe.js issues HTTP requests to a service's health endpoint and interprets response codes/timeouts
- [ProcessStateManager](./ProcessStateManager.md) -- scripts/process-state-manager.js exposes register/unregister operations called asynchronously by wrapper scripts like api-service.js and dashboard-service.js
- [LLMMockService](./LLMMockService.md) -- integrations/semantic-analysis/src/mock/llm-mock-service.ts implements mode management supporting 'mock', 'local', and 'public' LLM call routing
- [HealthCoordinator](./HealthCoordinator.md) -- scripts/health-coordinator.js polls services every 5 seconds, using probeHttpHealth() and probeTcpPort() from lib/utils/service-probe.js


---

*Generated from 5 observations*
