# TcpProbe

**Type:** Detail

TcpProbe is configured in docker-compose.yml using the `test: ["CMD", "nc", "-z", "localhost", "<port>"]` syntax to verify TCP connectivity for services lacking HTTP health endpoints

# TcpProbe

## What It Is

TcpProbe is implemented in `lib/utils/service-probe.js`, co-located with its sibling HttpProbe within the broader ServiceProbe component. It provides a TCP-level connectivity check for services that do not expose HTTP health endpoints — typical targets include databases, message brokers, and other infrastructure services that communicate over raw TCP rather than HTTP.

Where HttpProbe serves services with dedicated health routes, TcpProbe fills the complementary role of verifying that a port is simply open and accepting connections, making the two probes collectively sufficient to cover the full spectrum of service types in the system.

## Architecture and Design

The most significant architectural decision visible here is the **protocol-agnostic probe abstraction** within ServiceProbe. By defining both TcpProbe and HttpProbe under a single parent component with a shared three-value status contract (`running` / `stopped` / `unknown`), the design enforces uniform status reporting regardless of how the underlying connectivity check is performed. Consumers of ServiceProbe never need to branch on probe type to interpret results — the contract is identical.

This is a classic **strategy pattern**: ServiceProbe selects the appropriate probe mechanism based on the nature of the target service, while all probes conform to the same interface. TcpProbe and HttpProbe are parallel strategies, and the parent ServiceProbe acts as the context that delegates to whichever is appropriate.

The `unknown` state in the three-value contract is a deliberate design trade-off. Rather than collapsing ambiguity into a binary `running/stopped`, the system acknowledges that probe execution itself can fail — the network may be unreachable, the probe tool may error — and surfaces that as a distinct, actionable state rather than silently misreporting.

## Implementation Details

TcpProbe relies on `nc` (netcat) with the `-z` flag, as configured in `docker-compose.yml` via the syntax `["CMD", "nc", "-z", "localhost", "<port>"]`. The `-z` flag instructs netcat to scan for listening daemons without sending any data — it opens a TCP connection to the target port and immediately closes it, reporting only whether the port accepted the connection. This is a deliberate minimalist probe: it validates network reachability and port availability without requiring any knowledge of the application-layer protocol running on that port.

The probe is port-parameterized, meaning different services can be checked by substituting the appropriate `<port>` value. This makes TcpProbe reusable across any TCP-based service without modification to the probe logic itself.

No additional code symbols were resolved from `lib/utils/service-probe.js` in the available observations, so the internal class structure and method signatures of TcpProbe are not directly visible. However, given its co-residence with HttpProbe and their shared status contract, it is reasonable to infer that TcpProbe exposes at minimum a `check()` or equivalent method that resolves to one of the three status values.

## Integration Points

TcpProbe integrates upward into ServiceProbe, which orchestrates probe selection and status aggregation. Its sibling HttpProbe handles the HTTP-endpoint case, and the two together give ServiceProbe complete coverage of the service health monitoring surface.

The `docker-compose.yml` integration is the primary external wiring point: the `test` directive on each service container definition invokes TcpProbe's underlying mechanism (`nc -z`) directly as a Docker health check command. This means TcpProbe's behavior is exercised both by the application-level ServiceProbe logic and by Docker's own container lifecycle management, creating a consistent health signal at both layers.

The dependency on `nc` (netcat) being present in the target container image is an implicit environmental requirement. Services being probed via TcpProbe must have netcat available, which constrains base image choices or requires explicit installation in Dockerfiles.

## Usage Guidelines

TcpProbe should be selected over HttpProbe whenever a service does not expose an HTTP health endpoint — databases (PostgreSQL, Redis, MongoDB), message brokers (RabbitMQ AMQP port, Kafka), and any binary-protocol services are natural candidates. Attempting to use HttpProbe against such services would result in connection errors or protocol mismatches that would produce misleading `unknown` statuses.

When configuring TcpProbe in `docker-compose.yml`, the port specified in the `nc -z localhost <port>` command must match the port the service actually binds to inside the container, not any host-mapped port. Misconfiguring this is a common source of false `stopped` readings in containerized environments.

Developers extending ServiceProbe with new probe types should treat TcpProbe's three-value status contract as a mandatory interface requirement. Introducing a probe that returns a different status vocabulary would break the uniformity that makes ServiceProbe's consumers simple and robust. The `unknown` state in particular should be preserved and emitted whenever probe execution itself cannot complete reliably.


## Hierarchy Context

### Parent
- [ServiceProbe](./ServiceProbe.md) -- ServiceProbe in lib/utils/service-probe.js implements two distinct probe mechanisms: HTTP endpoint checks and TCP port checks, allowing different services to be monitored via their most appropriate protocol

### Siblings
- [HttpProbe](./HttpProbe.md) -- Defined in lib/utils/service-probe.js as part of the ServiceProbe sub-component, handling services that expose HTTP health endpoints


---

*Generated from 3 observations*
