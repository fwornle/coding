# BaseAgentResponseEnvelope

**Type:** Detail

Per the Pipeline sub-component description, every agent extending BaseAgent<TInput, TOutput> wraps its output in an AgentResponse envelope, enforcing a uniform contract across all SemanticAnalysis pipeline stages.

## What It Is

`BaseAgentResponseEnvelope` is the standardized response wrapper used by every agent within the **Pipeline** component. It is the concrete structural embodiment of the `AgentResponse` envelope described in `docs/architecture/agent-abstraction-api.md`, which serves as the canonical reference for this contract. Rather than being a loosely agreed-upon convention, the envelope is enforced at the type level through the `BaseAgent<TInput, TOutput>` abstract class — meaning no pipeline agent can produce output that bypasses this structure. The envelope carries at minimum: confidence scores, detected issues, routing suggestions, and retry guidance, making it a self-describing response object rather than a bare data payload.

---

## Architecture and Design

### Uniform Contract via Inheritance

The core architectural decision behind `BaseAgentResponseEnvelope` is **contract enforcement through inheritance**. Every agent in the SemanticAnalysis pipeline extends `BaseAgent<TInput, TOutput>`, and the abstract class itself is responsible for wrapping execution output in the `AgentResponse` envelope. This means the envelope is not something individual agents opt into — it is structurally unavoidable. The **Pipeline** parent component's design philosophy is explicit here: uniform output shape across all pipeline stages, regardless of the diversity of `TInput`/`TOutput` generics each agent may carry.

This pattern trades flexibility for consistency. An agent cannot "forget" to include routing suggestions or retry guidance because the envelope is produced by the base class machinery, not by agent-specific code. The trade-off is that any change to the envelope structure propagates across every agent in the pipeline simultaneously — a deliberate coupling that prioritizes contract stability over agent autonomy.

### Routing and Fault Recovery as First-Class Concerns

A significant design decision is that the envelope includes **routing suggestions and retry guidance as native fields**, not as optional extensions or error-channel metadata. This elevates dynamic re-routing and fault recovery to first-class pipeline concerns rather than afterthoughts. The implication is that the pipeline infrastructure itself can inspect any `AgentResponse` and make forwarding or retry decisions without needing to understand the domain logic of the producing agent. Callers are explicitly relieved of custom error-handling logic — the envelope itself carries the instructions.

This is a **self-describing failure model**: an agent that encounters a recoverable issue does not throw an exception or return a null; it returns a fully populated envelope that says "retry with these parameters" or "route to this alternative agent." This keeps pipeline orchestration logic centralized and prevents error-handling patterns from fragmenting across individual agent implementations.

---

## Implementation Details

The `BaseAgentResponseEnvelope` (surfaced as `AgentResponse` in the API contract) carries four documented payload categories as described in the **Pipeline** parent component:

- **Confidence scores** — a numeric signal indicating the agent's certainty about its output, usable by downstream agents or orchestrators for threshold-based routing decisions.
- **Detected issues** — structured problem descriptors produced during the agent's analysis pass, forming the primary domain output for SemanticAnalysis pipeline stages.
- **Routing suggestions** — directives indicating where the response should be forwarded next, enabling dynamic pipeline topology without hardcoded stage sequencing.
- **Retry guidance** — instructions describing whether and how the producing agent should be re-invoked, offloading retry policy decisions from callers.

The canonical structural definition lives in `docs/architecture/agent-abstraction-api.md`. While no code symbols were directly surfaced in this analysis, the `BaseAgent<TInput, TOutput>` class is the implementation vehicle — its execution wrapper is the mechanism through which raw `TOutput` is elevated into a fully populated `AgentResponse`. The generic typing (`TInput`, `TOutput`) ensures that individual agents retain strong typing for their domain-specific data while the envelope layer remains consistent.

---

## Integration Points

`BaseAgentResponseEnvelope` sits at the boundary between every producing agent and every consuming stage in the **Pipeline**. Because all agents share this envelope as their output type, the pipeline orchestrator can treat any agent's response uniformly — inspecting routing suggestions to determine the next stage, reading retry guidance to decide on re-invocation, and passing detected issues downstream without type-switching on the producing agent's identity.

The reference document `docs/architecture/agent-abstraction-api.md` is the integration contract for any new agent author or pipeline consumer. It defines what fields are guaranteed to be present, what their semantics are, and what the `BaseAgent` contract requires of implementors. Any component that consumes pipeline output — whether a downstream agent, a result aggregator, or an external caller — should treat this document as the authoritative schema.

---

## Usage Guidelines

**For agent authors:** When extending `BaseAgent<TInput, TOutput>`, the envelope is produced by the base class — your responsibility is to populate the domain-specific fields (detected issues, confidence scores) accurately. Do not attempt to bypass the envelope by returning raw `TOutput` through side channels; the entire pipeline's routing and fault-recovery infrastructure depends on every agent producing a properly formed `AgentResponse`.

**For pipeline consumers:** Never write custom error-handling logic that assumes an agent will throw exceptions on failure. The envelope's retry guidance and routing suggestions are the failure signaling mechanism. Consuming code should inspect these fields before deciding on next steps.

**For architects extending the pipeline:** Any modification to `BaseAgentResponseEnvelope`'s field contract is a cross-cutting change affecting every agent simultaneously. New fields should be additive and nullable/optional to preserve backward compatibility. Breaking changes to existing fields (e.g., confidence score semantics, routing suggestion schema) require coordinated updates across all pipeline stages and should be reflected immediately in `docs/architecture/agent-abstraction-api.md`.

**Canonical reference:** `docs/architecture/agent-abstraction-api.md` is the single source of truth for this contract. When in doubt about field semantics or expected behavior, this document takes precedence over any individual agent's implementation.

---

## Architectural Patterns Identified

| Pattern | Evidence |
|---|---|
| **Template Method** | `BaseAgent<TInput, TOutput>` wraps execution in envelope, subclasses provide domain logic |
| **Self-Describing Response** | Envelope carries routing/retry instructions, not just data |
| **Contract-First Design** | Canonical API doc (`agent-abstraction-api.md`) precedes and governs implementation |
| **Uniform Pipeline Stage Interface** | All stages share identical output shape regardless of internal type parameters |

The primary **scalability consideration** is that the envelope's routing suggestion mechanism allows pipeline topology to remain dynamic — new agents can be inserted or bypassed based on envelope directives without recompiling orchestration logic. The main **maintainability risk** is the tight coupling inherent in a shared base class contract: the envelope is a high-leverage dependency, and schema drift or ambiguous field semantics will propagate broadly. Keeping `docs/architecture/agent-abstraction-api.md` rigorously current is the primary mitigation.


## Hierarchy Context

### Parent
- [Pipeline](./Pipeline.md) -- All pipeline agents extend the shared `BaseAgent<TInput, TOutput>` abstract class, which wraps execution in a standardized `AgentResponse` envelope carrying confidence scores, detected issues, routing suggestions, and retry guidance


---

*Generated from 3 observations*
