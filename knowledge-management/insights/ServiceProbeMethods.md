# ServiceProbeMethods

**Type:** Detail

The existence of two distinct probe functions implies HealthCoordinator supports at least two health-check strategies: HTTP-based checks and raw TCP port checks, likely chosen per service type.

# ServiceProbeMethods — Technical Insight Document

## What It Is

ServiceProbeMethods refers to the set of health-check transport functions—`probeHttpHealth()` and `probeTcpPort()`—implemented in `lib/utils/service-probe.js`. These functions are not standalone; they are consumed by `scripts/health-coordinator.js`, which imports them to perform liveness checks against dependent services. Conceptually, ServiceProbeMethods represents the probing/transport layer that its parent, HealthCoordinator, relies on to determine whether a given service is reachable and healthy.

## Architecture and Design

The architecture reflects a clear separation of concerns: HealthCoordinator (in `scripts/health-coordinator.js`) owns the orchestration logic—deciding *when* and *which* services to check, polling every 5 seconds—while the actual *how* of checking connectivity is delegated to the shared utility module `lib/utils/service-probe.js`. This is a straightforward strategy-style pattern: two distinct probe functions, `probeHttpHealth()` and `probeTcpPort()`, represent two interchangeable health-check strategies that can be selected per service type (HTTP-based services vs. raw TCP-listening services). By isolating transport mechanics in a utility module rather than embedding them directly in the coordinator, the design keeps HealthCoordinator focused on scheduling/aggregation concerns rather than protocol-level details.

## Implementation Details

The observations indicate two concrete functions comprising ServiceProbeMethods:

- **`probeHttpHealth()`** — presumably issues an HTTP request to a service endpoint to verify health status (e.g., checking for a 200 response or health payload).
- **`probeTcpPort()`** — presumably performs a lower-level check by attempting a raw TCP connection to a given port, useful for services that don't expose an HTTP health endpoint.

Both functions are imported directly into `scripts/health-coordinator.js`, indicating they are exposed as named exports from `lib/utils/service-probe.js` and used synchronously or asynchronously within the coordinator's polling loop. No additional internal structure (classes, helper functions) is visible from the current observations, suggesting the module is likely a lean, function-based utility rather than a class-based abstraction.

## Integration Points

ServiceProbeMethods integrates into the system exclusively through its parent, HealthCoordinator. The dependency direction is one-way: `scripts/health-coordinator.js` imports from `lib/utils/service-probe.js`, meaning the probe module has no reverse dependency on the coordinator and can theoretically be reused by other coordinators or scripts needing service liveness checks. The HealthCoordinator's 5-second polling cycle is the primary invocation context—both probe functions are called repeatedly as part of this loop to assess the state of dependent services.

## Usage Guidelines

Given the two-strategy design, developers integrating a new service into HealthCoordinator should choose the appropriate probe function based on the service's exposed interface: use `probeHttpHealth()` for services with HTTP health endpoints, and `probeTcpPort()` for services only exposing a TCP listener. Since both functions live in the shared `lib/utils/service-probe.js` module, any enhancement to probing behavior (timeouts, retries, error handling) should be made centrally there rather than duplicated in the coordinator, preserving the separation of concerns. Developers should also be mindful that HealthCoordinator polls every 5 seconds, so probe function implementations should be lightweight and fail fast to avoid blocking or overlapping poll cycles.


## Hierarchy Context

### Parent
- [HealthCoordinator](./HealthCoordinator.md) -- scripts/health-coordinator.js polls services every 5 seconds, using probeHttpHealth() and probeTcpPort() from lib/utils/service-probe.js


---

*Generated from 3 observations*
