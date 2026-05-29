# ServiceStarter

**Type:** SubComponent

ServiceStarter coordinates with the Docker Compose deployment defined in docker/docker-compose.yml by managing post-container-start health convergence at the application layer beyond what Docker's healthcheck primitive provides

## What It Is

ServiceStarter is implemented in `lib/service-starter.js` and functions as the application-layer orchestrator responsible for managing the startup lifecycle of individual services within the DockerizedServices stack. While Docker's native `healthcheck` primitive provides basic container-level readiness signaling, ServiceStarter operates above that layer — handling the period after a container starts but before the service inside it is genuinely ready to serve traffic. It is the component that answers the question: "Is this service actually ready, not just running?"

![ServiceStarter — Architecture](images/service-starter-architecture.png)

Within the DockerizedServices hierarchy, ServiceStarter sits alongside ServiceProbe and LLMMockService as a sibling component. Where ServiceProbe provides the low-level sensing capability (HTTP endpoint checks and TCP port checks against individual services), ServiceStarter consumes those probe results and wraps them in a higher-order startup policy: retry budgets, backoff timing, and degradation behavior. The division of responsibility is clean — ServiceProbe answers "is the service responding right now?", and ServiceStarter answers "has the service successfully started, given our tolerance parameters?"

---

## Architecture and Design

The central architectural pattern in `lib/service-starter.js` is **retry-with-backoff**, chosen deliberately over fixed-interval polling. This is a meaningful design decision: fixed-interval polling under load can create thundering-herd conditions and wastes cycles probing services that are still in early initialization. Exponential (or otherwise increasing) backoff means early retries are fast — catching services that start <USER_ID_REDACTED> — while later retries space out, reducing unnecessary pressure on services that are slow to converge. The result is a startup sequence that is both responsive and resource-considerate.

![ServiceStarter — Relationship](images/service-starter-relationship.png)

A second major design decision is **per-service configurability of retry budgets and backoff parameters**. Rather than applying a single global policy, `service-starter.js` allows different services — such as Memgraph (a graph database with a heavier initialization footprint) versus Redis (typically fast to start) — to carry their own tolerance thresholds. This acknowledges a real operational reality: services have heterogeneous startup profiles, and forcing uniform retry windows either under-waits for slow services or over-waits for fast ones.

The third architectural pillar is **graceful degradation**. When a non-critical service exhausts its retry budget without a successful health probe, ServiceStarter allows the broader stack to continue in a reduced-capability mode rather than halting the entire startup sequence. This is a deliberate availability trade-off: it prioritizes partial system functionality over all-or-nothing startup semantics. The boundary between "critical" and "non-critical" is necessarily encoded in the configuration passed to ServiceStarter, making that classification an explicit architectural decision rather than an implicit one.

---

## Implementation Details

ServiceStarter's startup sequence for any given service can be understood as a bounded retry loop. On each iteration, it delegates the actual health sensing to ServiceProbe — using whichever probe mechanism is appropriate for that service (HTTP or TCP, as ServiceProbe supports both). If the probe returns a non-running status, ServiceStarter waits for the current backoff interval before attempting again, incrementing the delay on each failure. When the retry budget is exhausted, the outcome depends on the service's criticality flag: critical services cause a startup failure to propagate, while non-critical services are marked degraded and the loop exits cleanly.

The configurability surface in `service-starter.js` covers at minimum the retry count and the backoff parameters — likely an initial delay and a multiplier or increment. This is what enables the Memgraph-versus-Redis differentiation noted in the observations. The configuration likely flows in from the DockerizedServices parent layer, which has full knowledge of the service topology defined in `docker/docker-compose.yml`.

It is worth noting what ServiceStarter explicitly does *not* do: it does not own the probe logic itself. That responsibility belongs entirely to ServiceProbe in `lib/utils/service-probe.js`. ServiceStarter is a policy engine; ServiceProbe is the sensor. This separation keeps `service-starter.js` free of protocol-specific concerns (HTTP vs. TCP) and keeps `service-probe.js` free of retry and degradation policy.

---

## Integration Points

ServiceStarter's primary runtime dependency is ServiceProbe. Every health verification step in the startup sequence runs through ServiceProbe's probe mechanisms, meaning ServiceStarter's correctness is contingent on ServiceProbe returning reliable results. The parent component, DockerizedServices, provides the container lifecycle context — `docker/docker-compose.yml` defines when containers are brought up, and ServiceStarter takes over from that point to drive health convergence at the application layer.

The relationship with `docker/docker-compose.yml` is worth examining as an architectural seam. Docker Compose's `healthcheck` and `depends_on` directives provide coarse-grained ordering guarantees, but they operate at the container level and with limited policy expressiveness. ServiceStarter fills the gap between "container started" and "service is genuinely ready," which is the operationally significant window for complex services like Memgraph that may take time to initialize internal state after the process starts.

LLMMockService, while a sibling component, does not appear to be a direct integration target for ServiceStarter — its role is to substitute LLM dependencies during development, which is a different concern from service startup orchestration.

---

## Usage Guidelines

Developers configuring a new service into the DockerizedServices stack should treat the ServiceStarter configuration for that service as a first-class architectural decision. The retry budget and backoff parameters should be chosen based on observed startup characteristics of the service under realistic conditions — not arbitrary defaults. Under-budgeting retries for a slow-starting service (like Memgraph under load) will cause false startup failures; over-budgeting for a fast service (like Redis) simply delays detection of genuine failures.

The criticality flag deserves particular care. Marking a service as non-critical enables graceful degradation but means that downstream code must be written to tolerate the service's absence. If a service is marked non-critical but the application actually hard-depends on it at runtime, the degradation path will produce runtime errors rather than clean startup failures — a harder class of bug to diagnose. The criticality designation should be validated against the actual dependency graph of the application.

Since ServiceStarter relies entirely on ServiceProbe for health sensing, any new service added to the stack must have a compatible probe configuration — either an HTTP health endpoint or a reachable TCP port. If neither is available for a service, the probe layer cannot provide signal and ServiceStarter cannot make meaningful startup decisions. Ensuring probe coverage is therefore a prerequisite for integrating a new service with the ServiceStarter lifecycle.


## Hierarchy Context

### Parent
- [DockerizedServices](./DockerizedServices.md) -- DockerizedServices provides the containerization layer for the coding infrastructure, packaging services like the semantic analysis MCP, constraint monitor, code-graph-rag, Memgraph, and Redis into a unified Docker Compose deployment. The architecture centers on docker/docker-compose.yml and docker/Dockerfile.coding-services with supervisord.conf managing multiple processes within a container. Service health is verified through two probe mechanisms: HTTP health endpoints and TCP port checks, used by the health coordinator to track service liveness with strict contracts (never returning 'healthy', only 'running'/'stopped'/'unknown').

### Siblings
- [ServiceProbe](./ServiceProbe.md) -- ServiceProbe in lib/utils/service-probe.js implements two distinct probe mechanisms: HTTP endpoint checks and TCP port checks, allowing different services to be monitored via their most appropriate protocol
- [LLMMockService](./LLMMockService.md) -- LLMMockService in integrations/mcp-server-semantic-analysis/src/mock/llm-mock-service.ts implements a three-mode switcher (mock/local/public) allowing the semantic analysis MCP to operate without external LLM dependencies during development or testing


---

*Generated from 5 observations*
