# HttpHealthProbe

**Type:** Detail

The function targets HTTP-based services such as the Next.js dashboard and Node.js API, making it the primary probe for web-layer containers in the DockerizedServices stack

## HttpHealthProbe

### What It Is

HttpHealthProbe is the HTTP/HTTPS health checking strategy implemented as `probeHttpHealth()` in `lib/utils/service-probe.js`. It is housed within the ServiceProbeLibrary and serves as the primary probe mechanism for web-layer containers in the DockerizedServices stack — specifically targeting services such as the Next.js dashboard and Node.js API.

Its responsibility is narrow and well-defined: issue an HTTP or HTTPS request to a target service endpoint and map the response into one of the three values defined by the ProbeStatusVocabulary contract (`running`, `stopped`, or `unknown`).

---

### Architecture and Design

The central design decision in HttpHealthProbe is its **inclusive definition of "healthy"**: any 2xx or 3xx response code is treated as `running`. This is a deliberate and pragmatic choice. Web services commonly respond to health check endpoints with redirects (301, 302, 307) — particularly frameworks like Next.js that may redirect to a canonical path. By treating 3xx responses as valid healthy states, the probe avoids false negatives that would arise if only 2xx codes were accepted. This reflects an understanding that health probing for web services is about reachability and responsiveness, not strict endpoint behavior.

The probe sits alongside TcpPortProbe as a sibling within ServiceProbeLibrary, and the division between the two reveals a clear **protocol-aware probe selection strategy**. HttpHealthProbe is appropriate when the target service speaks HTTP/HTTPS and can respond to a full request-response cycle. TcpPortProbe, by contrast, is used for services like Memgraph's Bolt port, where HTTP would be entirely inappropriate — a TCP connection attempt is sufficient to confirm the service is accepting connections. This sibling relationship makes the probe library a small strategy registry, where the correct probe is selected based on the protocol characteristics of the target service.

The three-value status vocabulary (`running`, `stopped`, `unknown`) imposes a clean contract on all probes within ServiceProbeLibrary. HttpHealthProbe honors this by mapping response outcomes deterministically: 2xx/3xx maps to `running`, 4xx/5xx maps to `stopped`, and connection-level failures (timeouts, DNS errors, refused connections) map to `unknown`. The distinction between `stopped` and `unknown` is architecturally meaningful — `stopped` implies the service responded but indicated failure, while `unknown` implies the probe itself could not complete, suggesting a network or infrastructure issue rather than an application-level one.

---

### Implementation Details

`probeHttpHealth()` in `lib/utils/service-probe.js` performs an HTTP or HTTPS request to the target service and evaluates the numeric status code of the response. The status code range check — `code >= 200 && code < 400` — is the effective gate that classifies 2xx and 3xx responses uniformly as `running`.

When a connection failure occurs (e.g., ECONNREFUSED, ETIMEDOUT, or similar network-level errors), the function does not treat this as `stopped`. Instead, it returns `unknown`, acknowledging that the absence of a response is epistemically different from a negative response. A 500 from a running-but-broken service is `stopped`; a refused connection from a container that hasn't started yet is `unknown`. This distinction prevents false alerting and allows consumers of the probe result to reason more precisely about the system state.

The probe covers both HTTP and HTTPS targets, making it suitable for services exposed with TLS termination or direct HTTPS endpoints, in addition to plain HTTP development endpoints.

---

### Integration Points

HttpHealthProbe integrates upward into ServiceProbeLibrary, which acts as the containing module and likely routes probe calls to the appropriate strategy (`probeHttpHealth` vs. `probeTcpPort`) based on service configuration. The DockerizedServices stack defines which services use which probe — web-layer services like the Next.js dashboard and Node.js API are wired to HttpHealthProbe, while protocol-specific services like Memgraph are wired to TcpPortProbe.

The ProbeStatusVocabulary contract is the shared interface that binds all probes. Any consumer reading probe results — whether a health dashboard, a restart policy, or a monitoring loop — depends on the three-value vocabulary and can treat probe results uniformly regardless of which probe strategy produced them.

---

### Usage Guidelines

HttpHealthProbe should be used for any service in the DockerizedServices stack that exposes an HTTP or HTTPS interface. Developers should not assume that only 2xx responses indicate health — the probe's 3xx-inclusive design is intentional and should not be "tightened" without understanding the redirect behavior of the target service.

For services that do not speak HTTP — such as databases, message queues, or binary protocol services — TcpPortProbe is the correct sibling probe to reach for. Applying HttpHealthProbe to a non-HTTP service will consistently produce `unknown` (connection failure) rather than a meaningful status, which would degrade observability without surfacing a clear error.

When extending the ServiceProbeLibrary with new service targets, the pattern is clear: identify the protocol, select the appropriate probe strategy, and ensure the result is expressed in the ProbeStatusVocabulary. The `unknown` state should be preserved for genuine network-level ambiguity — it must not be conflated with `stopped`, as they imply different remediation paths.


## Hierarchy Context

### Parent
- [ServiceProbeLibrary](./ServiceProbeLibrary.md) -- probeHttpHealth() in lib/utils/service-probe.js maps 2xx/3xx HTTP/HTTPS response codes to the 'running' state, covering services like the Next.js dashboard and Node.js API

### Siblings
- [TcpPortProbe](./TcpPortProbe.md) -- probeTcpPort() targets services that do not speak HTTP, most notably Memgraph's Bolt port, where an HTTP probe would be inappropriate


---

*Generated from 3 observations*
