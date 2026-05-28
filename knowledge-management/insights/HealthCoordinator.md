# HealthCoordinator

**Type:** SubComponent

The 5-second polling interval in health-coordinator.js represents a deliberate latency/overhead tradeoff, balancing timely failure detection against socket and HTTP connection overhead across multiple services

# HealthCoordinator — Technical Reference

## What It Is

HealthCoordinator is a SubComponent implemented in `scripts/health-coordinator.js` that provides continuous liveness monitoring for the four core services in the DockerizedServices ecosystem: the Next.js dashboard, Node.js API, Memgraph, and Redis. It operates by polling results from `lib/utils/service-probe.js` (the ServiceProbeLibrary sibling component) on a fixed 5-second interval, aggregating probe outcomes into a unified health view consumed by the Next.js dashboard.

![HealthCoordinator — Architecture](images/health-coordinator-architecture.png)

The component sits within DockerizedServices alongside DockerLLMModeControl and ServiceProbeLibrary. While ServiceProbeLibrary owns the mechanics of how individual services are tested (HTTP response codes, raw TCP socket connections), HealthCoordinator owns the *scheduling* and *state interpretation* of those tests. The actual scheduling behavior is delegated to its child component, PollingScheduler, which implements the fixed-interval pattern rather than any event-driven or callback-based approach.

---

## Architecture and Design

The central architectural decision in `health-coordinator.js` is **protocol-agnostic polling**: by consuming both `probeHttpHealth()` and `probeTcpPort()` through a single unified polling loop, the coordinator never special-cases individual service types. The Next.js dashboard and Node.js API (HTTP-based) and Memgraph's Bolt protocol and Redis (TCP-based) all flow through the same code path. This is a deliberate abstraction boundary — the probe selection logic lives in ServiceProbeLibrary, and HealthCoordinator simply trusts that any probe it calls will return one of the three valid status strings.

![HealthCoordinator — Relationship](images/health-coordinator-relationship.png)

The state machine embedded in `health-coordinator.js` is intentionally narrow: it recognizes exactly three status strings — `'running'`, `'stopped'`, and `'unknown'` — which directly mirrors the invariant enforced by ServiceProbeLibrary (documented as SPEC R6 in the parent DockerizedServices context). This tight coupling between the probe output contract and the coordinator's state machine is a **correctness-by-contract** design: the coordinator does not defensively handle unexpected values; instead, the system relies on probe implementations never producing a fourth string. Any violation of this contract produces undefined state transitions.

The 5-second polling interval reflects a conscious **latency/overhead tradeoff**. Each polling cycle opens multiple HTTP connections and TCP sockets across all monitored services. A shorter interval would improve failure detection time but increase connection overhead proportionally; a longer interval reduces overhead but risks stale health state being surfaced to the dashboard. Five seconds represents the chosen equilibrium for this workload.

---

## Implementation Details

The PollingScheduler child component drives the timing backbone of HealthCoordinator, implementing a fixed-interval schedule rather than an adaptive or event-triggered model. Every 5 seconds, `health-coordinator.js` invokes the probe functions sourced from `service-probe.js`. For HTTP-capable services, it calls `probeHttpHealth()`, which maps 2xx/3xx response codes to `'running'`. For non-HTTP services like Memgraph (Bolt protocol) and Redis, it calls `probeTcpPort()`, which uses a raw `net.Socket` connection to verify port reachability.

The results from all probes are fed into the internal state machine, which maps each service's current probe result to one of the three recognized states. Because the state machine has no handling for values outside `{'running', 'stopped', 'unknown'}`, the architecture places the enforcement burden entirely on ServiceProbeLibrary's probe implementations. This makes the coordinator's logic clean and minimal but means its correctness is contingent on the probe contract being honored system-wide.

There are no code symbols currently indexed for this component (0 symbols found), which suggests `health-coordinator.js` may be a script-style module rather than a class-based implementation — consistent with its role as a runtime coordination script rather than an imported library.

---

## Integration Points

HealthCoordinator's primary upstream dependency is ServiceProbeLibrary (`lib/utils/service-probe.js`), specifically the `probeHttpHealth()` and `probeTcpPort()` functions. The coordinator is a pure consumer of these functions — it does not modify probe behavior, only schedules and aggregates results.

The downstream consumer of HealthCoordinator's output is the Next.js dashboard, which receives the aggregated liveness heartbeat. This makes HealthCoordinator the single source of truth for service health state as presented in the UI.

Within DockerizedServices, HealthCoordinator operates independently of DockerLLMModeControl, which handles LLM mock service path resolution via `llm-mock-service.ts` and the `CODING_ROOT` environment variable. There is no observed coupling between these two sibling components.

---

## Usage Guidelines

**Never introduce a fourth status string.** This is the most critical rule for developers extending the system. If a new service probe is added to ServiceProbeLibrary, it must return only `'running'`, `'stopped'`, or `'unknown'`. Introducing any other value — even something semantically reasonable like `'degraded'` or `'healthy'` — will cause the state machine in `health-coordinator.js` to encounter undefined transitions. The parent DockerizedServices documentation explicitly calls out that `'healthy'` is a forbidden return value (SPEC R6).

**Non-HTTP services must use `probeTcpPort()`.** When adding a new service to the monitored set, the protocol determines which probe function to use. Any service not reachable via HTTP/HTTPS (such as a database using a binary protocol like Bolt) must be registered with `probeTcpPort()`. Using `probeHttpHealth()` for a TCP-only service will produce incorrect results that still satisfy the state machine's string contract, making the failure silent and harder to detect.

**Understand the 5-second detection window.** Consumers of health state (e.g., the Next.js dashboard) should treat the displayed status as having up to a 5-second staleness window. Failure detection latency is bounded by the polling interval, not by real-time event propagation. Any alerting or automated response logic built on top of HealthCoordinator's output should account for this window. Changing the polling interval requires evaluating the cumulative connection overhead across all monitored services, not just the latency improvement in isolation.

---

### Scalability Considerations

The fixed polling model scales linearly with the number of monitored services — each new service adds one additional probe call per 5-second cycle. For the current four-service scope this is negligible, but as the number of services grows, the per-cycle connection overhead (HTTP handshakes, TCP socket opens) will grow proportionally. The architecture does not currently include batching, connection pooling for probes, or adaptive interval scaling, so significant service count growth would warrant revisiting the PollingScheduler's fixed-interval approach.

### Maintainability Assessment

The strict three-value state contract is both a strength and a fragility. It keeps the coordinator logic simple and auditable, but it means the system has a hidden global invariant that is not enforced by types or runtime validation in `health-coordinator.js` itself — it is enforced by convention and documentation. A future improvement would be to add an explicit guard in the state machine that logs or throws on unrecognized status strings, converting silent undefined behavior into a visible failure.


## Hierarchy Context

### Parent
- [DockerizedServices](./DockerizedServices.md) -- [LLM] The DockerizedServices component uses a dual-probe health checking architecture implemented in lib/utils/service-probe.js that strictly separates HTTP-based and TCP-based service verification. probeHttpHealth() issues HTTP/HTTPS requests and maps 2xx/3xx response codes to the 'running' state, while probeTcpPort() opens a raw net.Socket connection to verify port reachability for non-HTTP protocols like Memgraph's Bolt protocol. A critical architectural invariant (documented as SPEC R6) enforces that neither probe ever returns the string 'healthy'—only 'running', 'stopped', or 'unknown' are valid return values. This distinction matters because health-coordinator.js in scripts/health-coordinator.js consumes these probes on a 5-second polling interval and must be able to uniformly handle all service types (Next.js dashboard, Node.js API, Memgraph, Redis) without special-casing the protocol. New developers adding services must use probeTcpPort() for any non-HTTP service and must not introduce a fourth status string, or the health-coordinator's state machine will behave incorrectly.

### Children
- [PollingScheduler](./PollingScheduler.md) -- Based on the SubComponent description, health-coordinator.js polls service-probe.js results every 5 seconds, establishing a fixed-interval scheduling pattern rather than event-driven probing.

### Siblings
- [DockerLLMModeControl](./DockerLLMModeControl.md) -- llm-mock-service.ts uses CODING_ROOT environment variable for path resolution, enabling the service to locate mock fixtures regardless of Docker volume mount points
- [ServiceProbeLibrary](./ServiceProbeLibrary.md) -- probeHttpHealth() in lib/utils/service-probe.js maps 2xx/3xx HTTP/HTTPS response codes to the 'running' state, covering services like the Next.js dashboard and Node.js API


---

*Generated from 4 observations*
