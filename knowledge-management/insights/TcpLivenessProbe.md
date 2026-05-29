# TcpLivenessProbe

**Type:** Detail

The TCP liveness probe in `lib/utils/service-probe.js` uses a raw socket connection to verify a service is accepting connections on a specified port, bypassing any HTTP layer requirements.

# TcpLivenessProbe — Technical Insight Document

## What It Is

`TcpLivenessProbe` is implemented in `lib/utils/service-probe.js` as one of two probe strategies exposed by the ServiceProbeLibrary. It provides a TCP-level health check mechanism designed specifically for services that do not expose HTTP endpoints — such as Redis, PostgreSQL, or other databases and message brokers. Rather than issuing an HTTP request and inspecting a response, it verifies service availability at the transport layer by attempting to open a raw socket connection to a specified port.

## Architecture and Design

The core architectural decision behind `TcpLivenessProbe` is the separation of probe strategy from probe consumer. By defining both `TcpLivenessProbe` and its sibling `HttpLivenessProbe` within the same `lib/utils/service-probe.js` module, ServiceProbeLibrary establishes a strategy pattern: different services declare the probe type appropriate to their protocol, and the library supplies the corresponding implementation. This avoids forcing non-HTTP services into an artificial HTTP health endpoint just to satisfy a liveness check.

The design trade-off here is deliberate minimalism. A TCP connection attempt is the lowest-common-denominator health signal — it confirms the process is running and the port is bound, but says nothing about application-level correctness. This is an intentional constraint: for services like PostgreSQL or Redis, port reachability is a reliable and universally applicable signal, whereas an HTTP check would require additional instrumentation on the target service.

Placing both probe types in a single library file reflects a cohesion decision — probe strategies are co-located so that developers have a single reference point when choosing or extending probe behavior.

## Implementation Details

`TcpLivenessProbe` uses a raw socket connection to perform its check. The mechanics bypass any HTTP layer entirely: a socket is opened to the target host and port, and success is determined by whether the connection is accepted. This approach works across virtually any TCP-based service without requiring the target to implement any specific protocol above the transport layer.

The probe is configured with at minimum a port (and implicitly a host), which is sufficient to attempt the connection. No HTTP headers, paths, or response parsing are involved. This makes the implementation simpler and more robust for its intended targets — a database accepting connections on port 5432 or a Redis instance on port 6379 need only be reachable at the socket level.

Because no code symbols were extracted, the precise class shape and constructor signature are not available from current observations, but the functional contract is clear from the observations: given a port, attempt a TCP connection; resolve healthy if the connection succeeds, unhealthy if it is refused or times out.

## Integration Points

`TcpLivenessProbe` lives within ServiceProbeLibrary (`lib/utils/service-probe.js`), which is the authoritative module for probe strategy selection. Its primary integration relationship is as a peer to `HttpLivenessProbe` — both are exported from the same module and serve as interchangeable strategies from the consumer's perspective. Services that depend on ServiceProbeLibrary select between the two based on their protocol.

The natural consumers of `TcpLivenessProbe` are service definitions for infrastructure dependencies — databases, caches, and message brokers — that are declared alongside application services and need liveness checking before dependent services start or during runtime health monitoring.

## Usage Guidelines

Developers should select `TcpLivenessProbe` when the target service does not expose an HTTP health endpoint and when port reachability is a sufficient signal of service health. This is the correct choice for Redis, PostgreSQL, and similar infrastructure services. `HttpLivenessProbe` (the sibling strategy in ServiceProbeLibrary) should be preferred when the target service exposes an HTTP endpoint that provides richer application-level health semantics.

A key limitation to communicate: a successful TCP connection confirms the port is open and accepting connections, but does not confirm the service is fully operational at the application level. For example, a PostgreSQL instance in recovery mode may accept TCP connections while not being ready for <USER_ID_REDACTED>. Developers should weigh this when deciding whether TCP-level probing is sufficient for their availability requirements.

When extending ServiceProbeLibrary with new probe types, the existing pattern of co-locating strategies in `lib/utils/service-probe.js` should be followed to maintain discoverability and consistency.

---

**Architectural Patterns Identified:** Strategy pattern for probe type selection; single-module co-location of related strategies.

**Key Design Decision:** Deliberately thin abstraction — TCP socket check only, no application-layer protocol overhead, maximizing compatibility with non-HTTP services.

**Maintainability:** High — the probe has minimal dependencies (raw socket only) and a narrow, well-defined responsibility. Changes to HTTP probe behavior in `HttpLivenessProbe` are isolated from this implementation.

**Scalability Consideration:** TCP connection attempts are lightweight and stateless, making this probe suitable for high-frequency liveness checking without significant resource overhead on either the prober or the target service.


## Hierarchy Context

### Parent
- [ServiceProbeLibrary](./ServiceProbeLibrary.md) -- lib/utils/service-probe.js exposes at least two probe strategies — HTTP (checking an endpoint for a success response) and TCP (checking port reachability) — allowing different services to declare the appropriate probe type


---

*Generated from 3 observations*
