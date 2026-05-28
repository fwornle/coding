# TcpPortProbe

**Type:** Detail

The function uses net.Socket (Node.js built-in) to attempt a raw TCP connection, treating a successful connect event as 'running' and a connection refusal or timeout as 'stopped'/'unknown'

# TcpPortProbe — Technical Insight Document

## What It Is

`TcpPortProbe` is a TCP-level connectivity probe implemented within the `ServiceProbeLibrary`, co-located alongside `HttpHealthProbe` in `lib/utils/service-probe.js`. Its core function, `probeTcpPort()`, provides health-checking for services that communicate over raw TCP rather than HTTP — the canonical use case being Memgraph's Bolt protocol port, where issuing an HTTP request would be semantically inappropriate and likely produce a false negative or protocol error.

Where `HttpHealthProbe` evaluates service health by interpreting HTTP response codes, `TcpPortProbe` operates at a lower protocol layer, asking only a single binary question: can a TCP connection be established? This makes it the appropriate tool for any service that speaks a non-HTTP wire protocol.

## Architecture and Design

The design of `TcpPortProbe` reflects a deliberate protocol-abstraction strategy within `ServiceProbeLibrary`. Both `probeTcpPort()` and its sibling `probeHttpHealth()` are required to satisfy the same **SPEC R6 three-value return contract**, producing one of three discrete states: `'running'`, `'stopped'`, or `'unknown'`. This shared contract is the architectural cornerstone — probe consumers are intentionally kept agnostic to whether health was determined via an HTTP response code or a raw socket handshake. The protocol difference is entirely encapsulated within the probe implementation itself.

This is a classic **uniform interface** design decision: by mandating that all probes conform to the same return shape regardless of the underlying mechanism, the system allows orchestration logic to treat all services uniformly. Adding a new probe type for yet another protocol (e.g., UDP, gRPC) would require only that the new implementation honor the same three-value contract, leaving all consumers unchanged.

The choice to use Node.js's built-in `net.Socket` rather than a third-party library is also architecturally notable. It introduces zero additional dependencies, keeps the implementation firmly within the Node.js standard library, and ensures the probe is as lightweight as possible — appropriate for a utility function that may be called repeatedly in health-polling loops.

## Implementation Details

`probeTcpPort()` constructs a `net.Socket` instance and attempts to connect to the target host and port. The function maps socket lifecycle events directly to the three-value contract:

- A successful **`connect` event** maps to `'running'` — the service accepted the TCP handshake, confirming it is listening and reachable.
- A **connection refusal** (the remote host actively rejected the connection) maps to `'stopped'` — the port is not open, indicating the service is down.
- A **timeout** or other indeterminate failure maps to `'unknown'` — the probe could not determine service state, which may indicate network issues, a firewall, or a slow-starting service.

This three-way mapping is a deliberate parallel to how `probeHttpHealth()` handles its own state space: 2xx/3xx responses map to `'running'`, while error conditions are differentiated into `'stopped'` versus `'unknown'` based on specificity. The consistent semantic model across both probes makes the contract intuitive for any developer extending the library.

After the connect event fires (or an error occurs), the socket should be destroyed to avoid resource leaks — a standard hygiene requirement when using `net.Socket` imperatively.

## Integration Points

`TcpPortProbe` lives within `ServiceProbeLibrary` and is a peer to `HttpHealthProbe`. The two probes share no internal logic but share the external contract defined by SPEC R6. Any component that consumes `probeHttpHealth()` can consume `probeTcpPort()` interchangeably at the call site, since both return the same enumerated states.

The primary declared integration target is **Memgraph's Bolt port**. Bolt is a binary protocol; issuing an HTTP probe against it would result in a protocol mismatch and an unreliable health signal. `probeTcpPort()` exists precisely to serve this class of integration — infrastructure services that are non-HTTP but still require health visibility within the same monitoring framework.

## Usage Guidelines

Developers should reach for `probeTcpPort()` whenever a service's health cannot be meaningfully assessed via HTTP — specifically when the service speaks a binary or non-HTTP protocol, or when no HTTP endpoint is exposed. Using `probeHttpHealth()` against such a service would yield misleading results and should be avoided.

Because `probeTcpPort()` only validates TCP connectivity and not application-layer correctness, it is a **liveness probe**, not a **readiness probe** in the full sense. A service could accept a TCP connection before it is fully initialized. This is an inherent trade-off of protocol-layer probing and should be understood by consumers: `'running'` means the port is open and accepting connections, not that the application is fully ready to serve requests.

All callers must handle all three return values. Treating `'unknown'` as equivalent to `'stopped'` would be incorrect — `'unknown'` specifically represents indeterminate state and should trigger different handling (e.g., retry logic) than a confirmed `'stopped'` signal. This distinction is part of the SPEC R6 contract that both probes in `ServiceProbeLibrary` are designed to uphold.


## Hierarchy Context

### Parent
- [ServiceProbeLibrary](./ServiceProbeLibrary.md) -- probeHttpHealth() in lib/utils/service-probe.js maps 2xx/3xx HTTP/HTTPS response codes to the 'running' state, covering services like the Next.js dashboard and Node.js API

### Siblings
- [HttpHealthProbe](./HttpHealthProbe.md) -- probeHttpHealth() treats any 2xx or 3xx HTTP/HTTPS response code as a 'running' result, covering redirects as valid healthy states for web services


---

*Generated from 3 observations*
