# ThreePhaseOntologyLifecycle

**Type:** Detail

Based on the parent context describing OntologyClassificationAgent, the initialize phase must complete before classify can be called, representing a guard pattern common in agent-based architectures documented in docs/architecture/adding-new-agent.md

# ThreePhaseOntologyLifecycle

## What It Is

ThreePhaseOntologyLifecycle describes the structured operational lifecycle governing how `OntologyClassificationAgent` progresses through three discrete phases: **initialize → classify → suggest extensions**. This lifecycle is not implemented as a standalone class but rather as a behavioral contract embedded within the `OntologyClassificationAgent`, which is the parent component within the Ontology domain. The pattern is documented and governed by the agent abstraction API described in `docs/architecture/agent-abstraction-api.md`, with additional guidance on phase transitions in `docs/architecture/adding-new-agent.md`.

The lifecycle exists to enforce sequencing guarantees: the ontology registry must be fully prepared before any classification work begins, and extension proposals are only triggered reactively when the classification phase cannot find a suitable match for an observed entity.

## Architecture and Design

The ThreePhaseOntologyLifecycle embodies a **guard pattern** as its central architectural decision. The initialize phase acts as a precondition gate — classify cannot be invoked until initialization has completed successfully. This is a deliberate sequencing constraint that prevents classification logic from operating against an unprepared or partial ontology registry, a failure mode that would produce silent misclassifications rather than explicit errors.

The three phases are architecturally distinct in their trigger conditions and responsibilities:

- **Initialize** is imperative and eager — it must run first and unconditionally prepares the ontology registry for use.
- **Classify** is the primary operational phase, consuming observed entities and matching them against the prepared registry.
- **Suggest Extensions** is reactive and conditional — it activates only when classify fails to find a matching ontology class for an observed entity.

This design reflects a deliberate trade-off: extension suggestion is not a proactive or background process, but a fallback response to classification failure. This keeps the extension mechanism tightly coupled to observed gaps rather than speculative or batch-driven proposals, which constrains scope but improves signal <USER_ID_REDACTED> for ontology maintainers.

The overall structure aligns with the agent abstraction API documented in `docs/architecture/agent-abstraction-api.md`, meaning `OntologyClassificationAgent` is one realization of a broader agent contract used across the system. This conformance implies that other agents in the system follow analogous phase-transition patterns, making ThreePhaseOntologyLifecycle a domain-specific instance of a system-wide architectural norm.

## Implementation Details

The lifecycle is implemented behaviorally within `OntologyClassificationAgent` rather than as a separately instantiated lifecycle object. The guard pattern enforcing initialize-before-classify is described in `docs/architecture/adding-new-agent.md` as common to agent-based architectures in this system, suggesting the enforcement mechanism is likely a state flag or precondition check at the entry point of the classify phase.

The suggest-extensions phase is architecturally the most interesting: it is a **reactive extension mechanism**. When classify exhausts its matching logic against the current ontology registry and finds no suitable class for an observed entity, the suggest-extensions phase is activated. This creates a feedback loop where real-world observations that fall outside the current ontology directly drive ontology evolution proposals, without requiring a separate audit or review process to identify gaps.

No specific class names, function signatures, or file paths beyond the documentation references are available in the current observations, which limits the depth of mechanical analysis. The behavioral contract, however, is well-defined: three phases, strict ordering between phases one and two, and conditional activation of phase three.

## Integration Points

ThreePhaseOntologyLifecycle is contained within and expressed through `OntologyClassificationAgent`, making that agent the primary integration surface. Any component that needs to classify entities against the ontology must interact with `OntologyClassificationAgent` in a way that respects the lifecycle — specifically, it must not invoke classification before initialization has completed.

The lifecycle conforms to the agent abstraction API (`docs/architecture/agent-abstraction-api.md`), which means it participates in whatever agent management or orchestration layer that API implies. Developers adding new agents, as guided by `docs/architecture/adding-new-agent.md`, should treat this lifecycle as a reference implementation of the guard pattern for phase-sequenced agents.

The suggest-extensions output represents an integration point with ontology governance processes — whatever consumes extension suggestions (a review queue, a human workflow, or an automated proposal system) is a downstream dependency of this lifecycle's third phase.

## Usage Guidelines

Developers working with `OntologyClassificationAgent` must respect the lifecycle sequencing as a hard constraint. Invoking classify before initialize completes is explicitly guarded against, and any attempt to do so should be treated as a programming error rather than a recoverable runtime condition. When implementing or extending this agent, consult `docs/architecture/adding-new-agent.md` for the expected guard pattern implementation.

The conditional nature of suggest-extensions means it should not be assumed to run on every classification cycle. Code that depends on extension suggestions must be written to handle the common case where no suggestions are generated — most entity observations should match existing ontology classes, and suggest-extensions firing frequently is a signal that the ontology registry itself may be out of date or under-specified.

When adding new agents that follow a similar lifecycle, `docs/architecture/agent-abstraction-api.md` is the normative reference. ThreePhaseOntologyLifecycle, as embodied in `OntologyClassificationAgent`, serves as a concrete example of how that API's phase-transition model is applied in the ontology domain. The pattern of initialize → primary-operation → reactive-fallback is likely portable to other agent implementations where a registry or index must be prepared before operational work begins.

---

**Architectural Patterns Identified:** Guard pattern for phase sequencing; reactive fallback activation; agent abstraction conformance.

**Key Design Trade-off:** Suggest-extensions is reactive rather than proactive — this improves extension signal <USER_ID_REDACTED> at the cost of requiring a classification failure to surface ontology gaps.

**Scalability Consideration:** The reactive extension mechanism means extension proposal volume scales with the rate of novel/unmatched entities, not with total classification volume — a favorable property for ontology stability at scale.

**Maintainability Assessment:** Conformance to the documented agent abstraction API (`docs/architecture/agent-abstraction-api.md`) provides a stable contract for future refactoring, and the three-phase structure provides clear boundaries for isolating changes to initialization, classification, and extension logic independently.


## Hierarchy Context

### Parent
- [Ontology](./Ontology.md) -- `OntologyClassificationAgent` manages a three-phase lifecycle — initialize → classify → suggest extensions — ensuring the ontology registry is ready before any entity is classified and can propose new classes when observed entities don't fit existing ones


---

*Generated from 3 observations*
