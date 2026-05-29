# ServiceProbe

**Type:** SubComponent

The probe contract enforced by lib/utils/service-probe.js explicitly prohibits returning 'healthy' as a status value, returning only 'running'/'stopped'/'unknown' to maintain strict liveness semantics distinct from readiness

# ServiceProbe — Technical Reference

## What It Is

ServiceProbe is implemented in `lib/utils/service-probe.js` as a sub-component of DockerizedServices, providing the low-level probe mechanics that the health coordinator uses to determine liveness of containerized services. It contains two concrete probe strategies — HttpProbe and TcpProbe — each suited to a different class of service. The monitored targets span the full Docker Compose deployment: the semantic analysis MCP, constraint monitor, code-graph-rag, Memgraph, and Redis.

![ServiceProbe — Architecture](images/service-probe-architecture.png)

## Architecture and Design

ServiceProbe is organized around a two-strategy model: HttpProbe handles services that expose HTTP health endpoints, while TcpProbe handles services that do not — databases and brokers like Memgraph and Redis being the canonical examples. This division reflects a deliberate design decision to use the most semantically appropriate protocol for each service type rather than forcing a single probe mechanism across heterogeneous services.

The most architecturally significant decision in ServiceProbe is its **status vocabulary constraint**: the probe contract explicitly prohibits returning `'healthy'` as a status. Valid return values are strictly `'running'`, `'stopped'`, and `'unknown'`. This enforces a clear semantic boundary between *liveness* (is the process reachable?) and *readiness* (is the service capable of serving traffic?). By never emitting `'healthy'`, ServiceProbe avoids conflating these two concerns — a distinction that matters when the health coordinator at the DockerizedServices layer must decide whether to attempt a service interaction vs. whether to consider a service fully operational.

The third status value, `'unknown'`, is an intentional departure from binary up/down semantics. It encodes the difference between a conclusive negative (explicit connection refusal — the port is closed, the process is down) and an inconclusive result (connection timeout — the service may be starting, overloaded, or network-partitioned). This three-state model gives consumers richer signal to act on.

![ServiceProbe — Relationship](images/service-probe-relationship.png)

## Implementation Details

Both HttpProbe and TcpProbe live inside `lib/utils/service-probe.js`, co-located rather than split into separate files. HttpProbe issues an HTTP request to a configured endpoint and maps the outcome to the three-status vocabulary: a successful response maps to `'running'`, an explicit connection refused maps to `'stopped'`, and ambiguous failures (timeouts, DNS errors) map to `'unknown'`. TcpProbe opens a raw TCP socket to a host/port pair and applies the same status mapping logic — a successful connection means `'running'`, an immediate refusal means `'stopped'`, and anything inconclusive means `'unknown'`.

TcpProbe's role as a fallback or alternative — rather than a second-class citizen — reflects the reality that infrastructure services like Redis and Memgraph do not expose HTTP health endpoints by design. Forcing them through an HTTP probe would require either a sidecar or a wrapper, both of which add complexity. TcpProbe enables uniform polling cadence and status reporting across all services without that overhead.

## Integration Points

ServiceProbe feeds directly into the health coordinator, which aggregates per-service liveness states across the full set of Dockerized services. The health coordinator is the sole consumer described in the observations; ServiceProbe does not appear to be called ad hoc from other layers.

ServiceStarter, a sibling component in `lib/service-starter.js`, operates downstream of the same liveness signals — it implements retry-with-backoff on startup, relying on health checks resolving to `'running'` before proceeding. While ServiceStarter and ServiceProbe are siblings rather than directly coupled, they share an implicit contract: ServiceStarter's retry logic only terminates successfully when a probe returns `'running'`, making the status vocabulary a shared interface boundary across both components.

LLMMockService, the other sibling, is unrelated to probe mechanics — it operates at the LLM interaction layer and has no dependency on ServiceProbe's output.

## Usage Guidelines

**Never expect `'healthy'` as a return value.** Any consumer code that checks for `'healthy'` will never match — the contract is `'running'`/`'stopped'`/`'unknown'` exclusively. This is a hard invariant of the probe design, not a convention that might change.

**Treat `'unknown'` as distinct from `'stopped'`.** The `'unknown'` state means a conclusive determination was impossible, not that the service is down. Consumers (such as ServiceStarter's retry logic) should handle `'unknown'` as "retry is warranted" rather than "service is confirmed stopped." Treating it as `'stopped'` risks aborting startup sequences for services that are still initializing.

**Choose the probe type based on what the target service actually exposes.** HttpProbe is appropriate for services with a dedicated health route; TcpProbe is appropriate for bare TCP services like Redis and Memgraph. Using TcpProbe for an HTTP service is technically valid (a successful TCP connection means the port is open) but loses the signal that comes from HTTP response codes — a 500-responding service would still appear as `'running'` under a TCP probe. Match the probe type to the service's actual health surface.

**Scalability and maintainability** of ServiceProbe are straightforward given its scope: it is a utility with two concrete strategies and a fixed vocabulary. Adding support for a new service type would mean either reusing TcpProbe (for any TCP-speaking service) or extending with a new probe strategy alongside HttpProbe and TcpProbe in `lib/utils/service-probe.js`. The co-location of both strategies in a single file keeps the surface area small and the status contract enforceable in one place.


## Hierarchy Context

### Parent
- [DockerizedServices](./DockerizedServices.md) -- DockerizedServices provides the containerization layer for the coding infrastructure, packaging services like the semantic analysis MCP, constraint monitor, code-graph-rag, Memgraph, and Redis into a unified Docker Compose deployment. The architecture centers on docker/docker-compose.yml and docker/Dockerfile.coding-services with supervisord.conf managing multiple processes within a container. Service health is verified through two probe mechanisms: HTTP health endpoints and TCP port checks, used by the health coordinator to track service liveness with strict contracts (never returning 'healthy', only 'running'/'stopped'/'unknown').

### Children
- [HttpProbe](./HttpProbe.md) -- Defined in lib/utils/service-probe.js as part of the ServiceProbe sub-component, handling services that expose HTTP health endpoints
- [TcpProbe](./TcpProbe.md) -- Defined in lib/utils/service-probe.js alongside HttpProbe, providing an alternative probe mechanism for non-HTTP services such as databases or message brokers

### Siblings
- [ServiceStarter](./ServiceStarter.md) -- ServiceStarter in lib/service-starter.js implements a retry-with-backoff pattern for service startup, meaning each failed health check attempt waits an increasing delay before retrying rather than polling at a fixed interval
- [LLMMockService](./LLMMockService.md) -- LLMMockService in integrations/mcp-server-semantic-analysis/src/mock/llm-mock-service.ts implements a three-mode switcher (mock/local/public) allowing the semantic analysis MCP to operate without external LLM dependencies during development or testing


---

*Generated from 5 observations*
