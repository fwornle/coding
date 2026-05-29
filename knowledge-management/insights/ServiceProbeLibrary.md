# ServiceProbeLibrary

**Type:** SubComponent

lib/utils/service-probe.js exposes at least two probe strategies — HTTP (checking an endpoint for a success response) and TCP (checking port reachability) — allowing different services to declare the appropriate probe type

## What It Is

ServiceProbeLibrary is implemented in `lib/utils/service-probe.js` and provides the canonical health-checking primitives for the DockerizedServices system. It exposes at minimum two probe strategies — HTTP and TCP — that other components consume to verify service reachability without each component implementing its own polling logic.

## Architecture and Design

The central design decision in ServiceProbeLibrary is the separation of *probe definition* from *probe invocation*. Rather than letting individual services check their own or each other's health ad hoc, probe logic lives in one place and is consumed by higher-level orchestrators. This means the library acts as a shared vocabulary of health semantics rather than a utility that services call for themselves.

![ServiceProbeLibrary — Architecture](images/service-probe-library-architecture.png)

The two probe strategies reflect a deliberate mapping to service types. HTTP probes exist to check REST-endpoint-bearing services — the constraint monitor API and dashboard service are the identified consumers — while TcpLivenessProbe (a child component defined alongside `HttpLivenessProbe` in the same file) covers lower-level port availability for services that do not speak HTTP, such as databases or message brokers. This strategy pattern avoids forcing a uniform check mechanism on heterogeneous services.

A notable consequence of centralization is that timeout thresholds, retry semantics, and error interpretation logic are defined once and inherited everywhere. Changes to `lib/utils/service-probe.js` propagate automatically to both consumers without requiring coordinated updates across files.

## Implementation Details

`lib/utils/service-probe.js` contains at least two probe implementations: an HTTP probe that issues a request to a configured endpoint and interprets a success response as liveness, and `TcpLivenessProbe` that checks raw port reachability without requiring an application-level response. The HTTP probe is appropriate for services where a 2xx response confirms not just port availability but application-layer readiness. The TCP probe is a lighter check — confirming a port is accepting connections without asserting anything about the application's internal state.

Both probes are designed to be declarative from the caller's perspective: a service or coordinator declares *which* probe type applies and *what* target to check, rather than implementing the checking loop itself. This keeps probe consumers thin.

## Integration Points

![ServiceProbeLibrary — Relationship](images/service-probe-library-relationship.png)

ServiceProbeLibrary has two identified consumers, and the dual-consumer relationship is architecturally significant. First, `health-coordinator` uses the probes for **runtime liveness monitoring** — ongoing checks while the system is running. Second, the sibling component ServiceStarterFramework (`lib/service-starter.js`) reuses the same probes for **startup health gating** — verifying that services have become ready before proceeding with dependent startup steps. ServiceStarterFramework's retry-with-backoff logic wraps these probe calls, so the probe library itself remains stateless and purely functional while the retry state machine lives in the starter framework.

This dual usage means the probe library sits at a junction between startup orchestration and runtime health paths. Both paths exist within the DockerizedServices container environment where supervisord manages process lifecycles — the probes are the mechanism by which the application layer reports health back up through the orchestration stack.

## Usage Guidelines

Developers adding a new supervised service to the DockerizedServices architecture should declare the appropriate probe type in `lib/utils/service-probe.js`'s configuration surface: HTTP if the service exposes a REST endpoint, TCP if it only binds a port. Resist the temptation to implement inline health checks in new service code — the centralized pattern exists precisely to avoid that.

Because the same probe configuration affects both startup gating (via ServiceStarterFramework) and runtime monitoring (via health-coordinator), misconfiguring a probe — pointing it at the wrong port, using HTTP for a non-HTTP service — will cause failures in both contexts simultaneously. Validate probe targets carefully before deployment.

Timeout and retry parameters should be modified only in `lib/utils/service-probe.js`, never in calling code. Any caller-side timeout layering would create confusing double-timeout behavior and undermine the single-source-of-truth guarantee that the centralized design provides. When tuning thresholds, consider that the values apply equally to fast startup checks and to steady-state liveness polling — values appropriate for one context may be too aggressive or too lenient for the other.


## Hierarchy Context

### Parent
- [DockerizedServices](./DockerizedServices.md) -- [LLM] The multi-service container architecture uses supervisord (docker/supervisord.conf) to manage multiple long-running processes within a single Docker container defined in docker/Dockerfile.coding-services. This is an intentional design choice that trades container isolation purity for operational simplicity — rather than running separate containers for the semantic analysis MCP server, constraint monitor API, and dashboard service, all are co-located under supervisord's process supervision. The entrypoint script handles startup orchestration sequencing before handing off to supervisord. A new developer should be aware that this means a crash in one supervised service does not terminate the container, supervisord will attempt restarts, but it also means a single container failure takes down all co-located services simultaneously. The bind mount pattern `CODING_ROOT=/coding` connects the host repository filesystem into the container, making the container dependent on the host directory layout at runtime rather than baking code into the image.

### Children
- [TcpLivenessProbe](./TcpLivenessProbe.md) -- Defined alongside HttpLivenessProbe in lib/utils/service-probe.js, providing an alternative probe strategy for non-HTTP services such as databases or message brokers.

### Siblings
- [ServiceStarterFramework](./ServiceStarterFramework.md) -- lib/service-starter.js implements retry-with-backoff logic to handle transient startup failures, retrying service launches rather than failing immediately on first error


---

*Generated from 5 observations*
