# StatusEnvelope

**Type:** Detail

health-coordinator.js consuming this envelope uniformly means new probe types can be added to service-probe.js without changing the aggregation logic, indicating the envelope is a deliberate extension point in the utility-to-orchestrator dependency direction described in the SubComponent metadata.

# StatusEnvelope: Technical Insight Document

## What It Is

StatusEnvelope is a data contract structure defined within the ServiceProbe subsystem, implemented as part of `lib/utils/service-probe.js`. It is not a standalone module but rather a shape/schema that flows between the probe-producing utilities and the orchestration layer at `scripts/health-coordinator.js`. Functionally, it serves as the canonical representation of a health-check outcome — encapsulating fields such as a status indicator and an optional error payload — regardless of which underlying protocol (HTTP, TCP) produced the result.

The envelope exists specifically to mediate between heterogeneous probe implementations and a single uniform consumer. Where its sibling HttpProbe and any co-resident TCP probe logic perform protocol-specific work, StatusEnvelope strips away those protocol details and presents a normalized result. This makes it the contract boundary that allows the parent ServiceProbe to function as a multi-protocol probe registry without leaking implementation specifics to its callers.

## Architecture and Design

The architectural approach embodied by StatusEnvelope is a classic **adapter/normalization pattern** layered on top of a producer-consumer relationship. The producer side — the various probe implementations in `lib/utils/service-probe.js`, including HttpProbe — generates protocol-native outcomes (HTTP status codes, response bodies, TCP connection states, socket errors). The envelope flattens these disparate outcomes into a **lowest-common-denominator status representation**: a status field plus an optional error payload. This deliberate reduction is the core design decision: rather than exposing rich protocol metadata, the envelope guarantees that all probes speak the same downstream language.

This design creates a clean **unidirectional dependency** from utility to orchestrator. As inherited from the parent ServiceProbe's positioning (utility-to-orchestrator dependency direction), `scripts/health-coordinator.js` depends on the envelope shape, not on the probe internals. The envelope thus functions as a **stable API surface** even when probe implementations evolve. The coordinator's aggregation logic operates uniformly across all envelope instances, which means new probe types added to `service-probe.js` flow through to the coordinator without requiring changes there.

A subtle architectural insight is that StatusEnvelope is positioned as a **deliberate extension point**. The envelope's design anticipates new sibling probes alongside HttpProbe — for example, additional TCP variants or other protocol probes — and ensures they can be onboarded by conforming to the envelope contract rather than by modifying consumer code. This is the Open/Closed Principle applied at the module boundary level.

## Implementation Details

StatusEnvelope is implemented inline within `lib/utils/service-probe.js`, sharing residence with its sibling HttpProbe and any TCP probe logic. No standalone code symbols are exposed for it in the current code structure, suggesting it is realized as a lightweight object literal or plain structure returned from probe functions rather than as a formal class with methods. This is consistent with its role as a transport-shape contract rather than a behavioral entity.

The envelope's fields are minimal by design — at minimum a `status` field plus an `error` payload that is optional. The optionality of the error payload encodes the success/failure duality: successful probes populate status without error, while failed probes populate both. By keeping the schema thin, the implementation avoids coupling consumers to any single protocol's vocabulary (no `httpStatusCode`, no `socketErrno`, no protocol-specific fields surface here).

The producer-side mechanics involve each probe (HttpProbe, TCP probe logic) performing its native protocol operation, catching or interpreting the result, and constructing an envelope before returning. The consumer-side mechanics in `scripts/health-coordinator.js` involve reading the envelope's status field and, when present, the error payload — without any conditional logic that branches on probe type. This uniformity is the payoff of the envelope abstraction.

## Integration Points

The primary integration is the **producer-consumer pair** between `lib/utils/service-probe.js` and `scripts/health-coordinator.js`. The envelope is the typed boundary across this seam: probes produce it, the coordinator consumes it. Because it is contained by ServiceProbe (per the relationship metadata), the envelope inherits ServiceProbe's positioning as a utility module called from the orchestrator script.

Sibling integration occurs implicitly through shared use of the envelope shape. HttpProbe, residing in the same `service-probe.js` file, is one of the protocol-specific implementations that materialize envelopes. Any TCP probe logic in the same file does the same. The envelope is thus a **shared output contract among all sibling probes** within the ServiceProbe registry.

External to the immediate ServiceProbe scope, the envelope influences how `scripts/health-coordinator.js` performs aggregation. Since all probe outcomes arrive in identical shape, the coordinator can iterate uniformly, tally statuses, and collect errors without conditional logic per probe type. This integration pattern means downstream changes — such as new health dashboards or alerting consumers — can rely on the same envelope shape if they're given access to the coordinator's aggregated output.

## Usage Guidelines

When extending the ServiceProbe registry with a new protocol probe, the cardinal rule is: **always return a StatusEnvelope**. Do not return protocol-native objects, do not enrich the envelope with protocol-specific fields beyond what the schema permits, and do not bypass the envelope by writing custom consumer-side handling in `scripts/health-coordinator.js`. The whole point of the abstraction is that the coordinator remains untouched as probes evolve.

Developers should resist the temptation to **leak protocol details** into the envelope. If a probe needs to convey richer diagnostic information, that information belongs in the optional error payload — kept structured but generic — rather than as new top-level envelope fields. Adding protocol-specific top-level fields would erode the lowest-common-denominator guarantee and gradually push consumers back toward type-specific logic.

When consuming envelopes in `scripts/health-coordinator.js` or any future consumer, treat the envelope as **read-only and protocol-agnostic**. Avoid inspecting the error payload's internal structure beyond what is documented as common across probes. If consumers begin to branch on error payload contents in ways that imply probe type, that is a signal that the envelope schema needs to grow a new common field, not that consumers should become probe-aware.

Finally, recognize that StatusEnvelope is the **stable extension point** of the ServiceProbe subsystem. New sibling probes alongside HttpProbe should be added by conforming to the envelope contract; changes to the envelope itself should be treated as breaking changes that require coordinated updates across both `lib/utils/service-probe.js` and `scripts/health-coordinator.js`.

---

### Summary of Key Insights

1. **Architectural patterns identified**: Adapter/normalization pattern, producer-consumer with typed contract, Open/Closed extension point, lowest-common-denominator schema design.

2. **Design decisions and trade-offs**: Trading rich protocol-specific information for uniform consumer logic; favoring a thin schema (status + optional error) over expressive but coupled alternatives; inlining the envelope shape within `service-probe.js` rather than extracting it to a separate module.

3. **System structure insights**: Unidirectional utility-to-orchestrator dependency; `service-probe.js` serving as a multi-protocol probe registry; envelope acting as the seam between heterogeneous producers and a uniform consumer.

4. **Scalability considerations**: New probe types scale horizontally without touching the coordinator; the envelope's thin schema avoids combinatorial growth of consumer-side logic; aggregation in `health-coordinator.js` remains O(n) over uniform records regardless of probe diversity.

5. **Maintainability assessment**: High — the envelope isolates change. Probe internals can evolve freely, and new probes can be added with localized impact. The main maintainability risk is schema drift: if developers add protocol-specific fields to the envelope over time, the abstraction degrades. Treating envelope changes as cross-cutting and disciplined will preserve the design's integrity.


## Hierarchy Context

### Parent
- [ServiceProbe](./ServiceProbe.md) -- ServiceProbe lives at lib/utils/service-probe.js and is consumed by scripts/health-coordinator.js, establishing a clear utility-to-orchestrator dependency direction

### Siblings
- [HttpProbe](./HttpProbe.md) -- HttpProbe resides in lib/utils/service-probe.js alongside any TCP probe logic, establishing service-probe.js as a multi-protocol probe registry rather than a single-purpose module.


---

*Generated from 3 observations*
