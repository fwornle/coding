# HttpHealthProbe

**Type:** Detail

probeHttpHealth() in lib/utils/service-probe.js issues an HTTP GET request to the service's configured health endpoint and treats any 2xx status code as healthy while classifying non-2xx responses or request timeouts as failures.

# HttpHealthProbe — Technical Insight Document

## What It Is

HttpHealthProbe is the HTTP-based health-checking mechanism implemented via the `probeHttpHealth()` function in `lib/utils/service-probe.js`. It performs an HTTP GET request against a service's configured health endpoint and determines the service's operational status based on the response received. This entity is a functional component within the broader ServiceProbe system, representing the specific strategy for validating service health over HTTP as opposed to other potential probing mechanisms.

## Architecture and Design

The design follows a straightforward request-response health-check pattern common in service monitoring: issue a request, interpret the outcome, return a binary health verdict. `probeHttpHealth()` acts as the concrete implementation detail of the parent ServiceProbe component, which is described as issuing HTTP requests to a service's health endpoint and interpreting response codes/timeouts to decide pass/fail status. This establishes a clear separation of concerns — ServiceProbe defines the conceptual contract of "probing for health," while HttpHealthProbe (the function `probeHttpHealth()`) supplies the HTTP-specific execution logic.

The classification logic embodies a simple, well-understood convention from HTTP semantics: any 2xx status code is treated as healthy, while non-2xx responses and timeouts are both classified as failures. This binary interpretation avoids ambiguity and keeps the health-check contract simple for consumers, at the cost of not distinguishing between different failure modes (e.g., a 500 server error is treated the same as a network timeout).

## Implementation Details

The core implementation resides in a single function, `probeHttpHealth()`, located in `lib/utils/service-probe.js`. Its mechanics are:

1. Issue an HTTP GET request to the service's configured health endpoint.
2. Await the response or a timeout condition.
3. Evaluate the resulting status code: a 2xx code is mapped to "healthy."
4. Any non-2xx status code, or a timeout occurring before a response is received, is mapped to "failure."

No additional code symbols, classes, or supporting utilities are documented beyond this function, suggesting the current implementation is intentionally minimal and self-contained rather than distributed across multiple collaborating objects.

## Integration Points

HttpHealthProbe is a child/member of the ServiceProbe component ("ServiceProbe contains HttpHealthProbe"), meaning it is invoked as part of ServiceProbe's broader health-checking responsibilities. The primary integration point is the "service's configured health endpoint" — implying that endpoint configuration is externalized and supplied to `probeHttpHealth()` rather than hardcoded, though the exact configuration mechanism is not detailed in the current observations. Consumers of ServiceProbe rely on this function's pass/fail determination as an input to higher-level service health decisions.

## Usage Guidelines

Developers integrating with or extending HttpHealthProbe should treat the 2xx/non-2xx/timeout classification as the authoritative contract: any change to this logic affects how ServiceProbe reports service health. Because timeouts and non-2xx responses are currently treated identically as failures, callers should not expect differentiated error handling based on failure type unless the implementation is extended. When configuring services for health probing, ensure the health endpoint reliably returns 2xx codes under healthy conditions, since any deviation is uniformly interpreted as an outage signal.


## Hierarchy Context

### Parent
- [ServiceProbe](./ServiceProbe.md) -- probeHttpHealth() in lib/utils/service-probe.js issues HTTP requests to a service's health endpoint and interprets response codes/timeouts


---

*Generated from 3 observations*
