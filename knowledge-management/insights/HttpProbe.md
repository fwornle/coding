# HttpProbe

**Type:** Detail

HttpProbe class in http_probe.py implements the `check()` method by performing an HTTP GET request to a configured health endpoint and mapping the HTTP response status codes to one of three normalized statuses: `running`, `stopped`, or `unknown`.

# HttpProbe — Technical Insight Document

## What It Is

HttpProbe is implemented in `http_probe.py` and is also referenced as part of `lib/utils/service-probe.js` within the broader ServiceProbe sub-component. It is one of two concrete probe mechanisms provided by ServiceProbe — the other being TcpProbe — and is specifically designed for services that expose an HTTP health endpoint. Its singular responsibility is to determine whether a given service is reachable and healthy by issuing an HTTP GET request and translating the response into a normalized status value.

## Architecture and Design

**Three-Value Status Contract**

The most notable architectural decision in HttpProbe is its rejection of a binary up/down model in favor of a three-value status contract: `running`, `stopped`, or `unknown`. This is a deliberate design choice that preserves semantic precision for callers. A binary model collapses two meaningfully different situations — a confirmed failure (the service responded with an error) and an indeterminate state (the probe could not reach the service at all, e.g., network timeout or DNS failure) — into a single "down" signal. By surfacing `unknown` as a distinct value, HttpProbe allows upstream consumers to make more informed decisions, such as suppressing alerts on transient network issues while acting immediately on confirmed `stopped` states.

**Probe Specialization via Sibling Pattern**

HttpProbe exists as a sibling to TcpProbe within the ServiceProbe parent component. This design reflects a deliberate protocol-aware specialization: HTTP-speaking services (web servers, REST APIs, microservice health routes) are monitored via HttpProbe, while non-HTTP services such as databases or message brokers are handled by TcpProbe. ServiceProbe acts as the containing abstraction that selects and delegates to the appropriate probe type, keeping protocol-specific logic encapsulated within each sibling class rather than mixed into a single monolithic checker.

## Implementation Details

The core of HttpProbe is its `check()` method, which performs an HTTP GET request to a configured health endpoint URL. The method then maps the HTTP response status code onto one of the three normalized statuses. The general mapping logic follows HTTP semantics: a successful 2xx response maps to `running`, an explicit error response (likely 4xx/5xx indicating the service is up but unhealthy or explicitly reporting failure) maps to `stopped`, and conditions where no valid HTTP response can be obtained — connection refused, timeout, DNS failure — map to `unknown`. This mapping isolates HTTP protocol knowledge inside HttpProbe, preventing it from leaking into ServiceProbe or any higher-level consumer.

The `check()` method interface is the public contract of the class. Because TcpProbe presumably implements an equivalent `check()` method (given both are managed by ServiceProbe), the two probes share a polymorphic interface, allowing ServiceProbe to invoke either without branching on type.

## Integration Points

HttpProbe is contained by and invoked through ServiceProbe (`lib/utils/service-probe.js`). ServiceProbe is responsible for configuration — supplying HttpProbe with the target health endpoint URL — and for routing probe selection between HttpProbe and TcpProbe based on the service type being monitored. The three-value return contract (`running`/`stopped`/`unknown`) is the interface boundary that all callers must handle; any consumer receiving probe results must be prepared to act on all three values, not just the binary case.

## Usage Guidelines

Developers configuring HttpProbe should ensure the target health endpoint is a purpose-built health route (e.g., `/health`, `/status`, `/ping`) rather than a functional API endpoint, to avoid false positives or negatives from business logic responses. The `unknown` status must never be silently treated as `stopped` — doing so would cause false failure alerts on transient network conditions. Similarly, `unknown` must not be treated as `running`, as that would mask genuine outages obscured by connectivity issues. For services that do not expose HTTP, TcpProbe should be selected instead; HttpProbe is not appropriate for raw TCP services such as databases, as it will produce `unknown` results rather than meaningful health signals.

---

**Key Architectural Patterns Identified:**
- **Polymorphic probe interface** — `check()` as a shared contract across HttpProbe and TcpProbe
- **Status normalization** — HTTP-specific codes abstracted into a protocol-agnostic three-value enum
- **Protocol-aware specialization** — probe type selection delegated to the ServiceProbe parent

**Primary Design Trade-off:** The three-value contract adds handling complexity for consumers but significantly improves diagnostic precision over a binary model, which is the correct trade-off for a health-monitoring subsystem where false negatives carry operational cost.


## Hierarchy Context

### Parent
- [ServiceProbe](./ServiceProbe.md) -- ServiceProbe in lib/utils/service-probe.js implements two distinct probe mechanisms: HTTP endpoint checks and TCP port checks, allowing different services to be monitored via their most appropriate protocol

### Siblings
- [TcpProbe](./TcpProbe.md) -- Defined in lib/utils/service-probe.js alongside HttpProbe, providing an alternative probe mechanism for non-HTTP services such as databases or message brokers


---

*Generated from 3 observations*
