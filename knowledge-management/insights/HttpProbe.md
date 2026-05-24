# HttpProbe

**Type:** Detail

As a utility function (per the utility-to-orchestrator dependency direction noted in the SubComponent description), HttpProbe is expected to be stateless and side-effect-free beyond the outbound HTTP call, making it safe to invoke repeatedly in polling loops from health-coordinator.js.

# HttpProbe: Technical Insight Document

## What It Is

HttpProbe is a probe utility implemented within `lib/utils/service-probe.js`, where it coexists with TCP probe logic and other protocol-specific probes. Rather than occupying its own dedicated module, HttpProbe is one of several probe implementations registered inside `service-probe.js`, which effectively functions as a multi-protocol probe registry. It is a sub-component of the broader ServiceProbe entity, sharing the same file location and architectural role.

Functionally, HttpProbe performs outbound HTTP requests against a target service and translates the resulting HTTP semantics — successful 2xx responses, non-2xx failures, and timeouts — into a generic, normalized representation. It does not expose raw HTTP response objects to its callers. Instead, every invocation yields a StatusEnvelope, a sibling entity that serves as the standardized contract for probe results across the system.

As a utility function, HttpProbe is designed to be stateless and side-effect-free beyond its outbound HTTP call, which makes it suitable for repeated invocation in polling loops driven by the upstream orchestrator, `scripts/health-coordinator.js`.

## Architecture and Design

The architectural approach evident in HttpProbe reflects a **registry pattern** combined with a **strict utility-to-orchestrator dependency direction**. By placing HttpProbe alongside TCP probe logic in `lib/utils/service-probe.js`, the design treats `service-probe.js` as a unified registration point for all probe protocols rather than fragmenting probes across protocol-specific files. This consolidation makes it straightforward to add new probe types (e.g., gRPC, ICMP) without introducing new module boundaries or rewiring orchestration dependencies.

The most important architectural decision is the use of the **StatusEnvelope as a contract boundary**. HttpProbe translates HTTP-specific semantics (2xx → success, non-2xx → failure, timeout → failure) into the envelope's generic status vocabulary before returning. This adapter-style translation decouples the consumer — `scripts/health-coordinator.js` — from any knowledge of HTTP, allowing the coordinator to treat all probe results uniformly regardless of protocol. The sibling StatusEnvelope entity is explicitly described as "the contract boundary between lib/utils/service-probe.js (producer) and scripts/health-coordinator.js (consumer)," and HttpProbe is one of its primary producers.

The **utility-to-orchestrator dependency direction** is a deliberate inversion-of-control choice: HttpProbe (and its parent ServiceProbe) knows nothing about how it will be scheduled, batched, or interpreted. The orchestrator pulls from the utility layer; the utility never reaches upward. This unidirectional dependency keeps the probe layer trivially testable in isolation and prevents cyclic coupling between health-checking strategy and probe mechanics.

## Implementation Details

HttpProbe is implemented as a stateless function within `lib/utils/service-probe.js`. Its mechanics revolve around three classification rules that map HTTP outcomes to StatusEnvelope status values:

1. **2xx responses** → success status in the envelope
2. **Non-2xx responses** → failure status in the envelope
3. **Timeouts** → failure status in the envelope (treated equivalently to non-2xx for status purposes)

Because no code symbols were extracted for HttpProbe, the precise function signature is not detailed in the available observations, but the behavioral contract is clear: input is whatever HTTP target configuration is needed to issue a request, and output is always a StatusEnvelope. The probe never propagates HTTP-specific structures (response headers, body content, raw status codes) past its own boundary — these are absorbed into the envelope's generic vocabulary.

The statelessness guarantee is significant: HttpProbe holds no internal state between invocations, manages no connection pools that persist across calls (or if it does, they are not its responsibility to expose), and produces no side effects beyond the outbound HTTP request itself. This makes it safe to call concurrently or in tight polling loops without coordination concerns.

## Integration Points

HttpProbe's integration surface is narrow and well-defined. It is contained within the ServiceProbe parent component at `lib/utils/service-probe.js`, and shares that file with sibling protocol probes (notably the TCP probe logic). It produces StatusEnvelope instances, its sibling contract entity, which are then consumed exclusively upward by `scripts/health-coordinator.js`.

The integration flow is therefore:

- **Caller**: `scripts/health-coordinator.js` invokes HttpProbe (via the ServiceProbe registry surface)
- **Producer**: HttpProbe issues an outbound HTTP request to the target service
- **Output contract**: HttpProbe wraps the outcome in a StatusEnvelope
- **Consumer**: `scripts/health-coordinator.js` reads the StatusEnvelope without ever touching HTTP details

There is no downward dependency from HttpProbe into application-specific code, and no sideways coupling between HttpProbe and other probes in the registry — each probe is an independent producer of StatusEnvelope instances. The only shared concern between HttpProbe and TCP probe logic is their colocation in `service-probe.js` and their common output type.

## Usage Guidelines

Developers working with HttpProbe should observe the following conventions:

1. **Never bypass the StatusEnvelope contract.** Any code that consumes HttpProbe results must work through the StatusEnvelope abstraction. Reaching into HTTP-specific details defeats the decoupling that StatusEnvelope provides between probe producers and `scripts/health-coordinator.js`.

2. **Treat HttpProbe as safe for repeated invocation.** Because it is stateless and side-effect-free beyond the outbound HTTP call, it can be safely invoked in polling loops, parallelized across many targets, or retried without coordination concerns. This is explicitly the use case anticipated by the health-coordinator orchestration pattern.

3. **Add new probe protocols to the same registry.** When introducing additional protocol probes, follow HttpProbe's example by colocating them in `lib/utils/service-probe.js` and producing StatusEnvelope instances. This preserves `service-probe.js` as the single multi-protocol probe registry rather than fragmenting probe logic across files.

4. **Preserve the utility-to-orchestrator direction.** HttpProbe must not import from or depend on `scripts/health-coordinator.js` or any orchestration logic. The dependency arrow points one way: orchestrators consume utilities, never the reverse.

5. **Honor the HTTP semantic translation rules.** The mapping of 2xx → success, non-2xx → failure, and timeout → failure is the established contract. Changes to this mapping affect every consumer of StatusEnvelope and should be considered breaking changes to the probe layer's behavior.

---

### Summary of Key Insights

- **Architectural patterns identified**: Registry pattern (multi-protocol probe registry in `service-probe.js`), Adapter pattern (HTTP semantics → StatusEnvelope vocabulary), strict layered dependency (utility → orchestrator), and contract-boundary decoupling via StatusEnvelope.
- **Design decisions and trade-offs**: Consolidating probes into one file simplifies registration but couples protocol implementations at the file level; normalizing all outputs through StatusEnvelope sacrifices protocol-specific richness for orchestration uniformity.
- **System structure insights**: A clear three-layer structure — probe utilities (`lib/utils/service-probe.js`), contract envelope (StatusEnvelope), and orchestration (`scripts/health-coordinator.js`) — with unidirectional dependencies.
- **Scalability considerations**: Statelessness and side-effect-freedom make HttpProbe suitable for high-frequency polling and parallel invocation across many targets without coordination overhead.
- **Maintainability assessment**: High. The narrow contract (StatusEnvelope output), single-file colocation with sibling probes, and unidirectional dependency on the orchestrator make HttpProbe straightforward to test, modify, and extend with additional protocol probes following the same template.


## Hierarchy Context

### Parent
- [ServiceProbe](./ServiceProbe.md) -- ServiceProbe lives at lib/utils/service-probe.js and is consumed by scripts/health-coordinator.js, establishing a clear utility-to-orchestrator dependency direction

### Siblings
- [StatusEnvelope](./StatusEnvelope.md) -- StatusEnvelope acts as the contract boundary between lib/utils/service-probe.js (producer) and scripts/health-coordinator.js (consumer), decoupling probe implementation details from orchestration logic.


---

*Generated from 3 observations*
