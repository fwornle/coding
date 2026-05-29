# AntiCorruptionLayerWrapper

**Type:** Detail

Based on the parent context, LegacyOntologyAdapter acts as an anti-corruption layer (a DDD pattern) ensuring OntologyValidator and OntologyClassifier never directly depend on @fwornle/km-core's OntologyRegistry, isolating them from upstream API changes.

# AntiCorruptionLayerWrapper — Technical Insight Document

## What It Is

`AntiCorruptionLayerWrapper` is a structural concept contained within `LegacyOntologyAdapter`, representing the core mechanics by which `LegacyOntologyAdapter` fulfills its anti-corruption layer (ACL) responsibility. Rather than being a standalone class with independently discoverable symbols, it is the logical wrapper pattern instantiated inside `LegacyOntologyAdapter` — the boundary enforcement mechanism that interposes between the external `OntologyRegistry` (from `@fwornle/km-core`) and the internal consumers `OntologyValidator` and `OntologyClassifier` within the `SemanticAnalysis` component.

No independent file paths or code symbols are registered for `AntiCorruptionLayerWrapper` itself, which is architecturally meaningful: it exists as a design-level abstraction, not a separately deployed artifact. Its implementation surface is entirely expressed through `LegacyOntologyAdapter`.

---

## Architecture and Design

The architectural pattern at work here is the **Anti-Corruption Layer (ACL)** from Domain-Driven Design, used specifically to defend a bounded context's internal model from the vocabulary and structural changes of an upstream dependency. In this case, the upstream is `@fwornle/km-core`'s `OntologyRegistry`, and the protected internal context is the `SemanticAnalysis` component's validation and classification pipelines.

The design decision to encapsulate the wrapping logic within `LegacyOntologyAdapter` — and to name the inner concern `AntiCorruptionLayerWrapper` — reflects a deliberate separation of concerns: `LegacyOntologyAdapter` is the public-facing adapter visible to `OntologyValidator` and `OntologyClassifier`, while `AntiCorruptionLayerWrapper` represents the translation and shielding mechanics operating beneath that surface. This layering prevents a common failure mode where adapter logic bleeds into consumer code over time.

The containment relationship (`LegacyOntologyAdapter` **contains** `AntiCorruptionLayerWrapper`) is architecturally significant. It signals that the wrapping behavior is not a peer concern or a utility shared across components — it is scoped entirely to `LegacyOntologyAdapter`'s purpose. This keeps the ACL cohesive and ensures that any future changes to `OntologyRegistry`'s API are handled in exactly one place.

The trade-off embedded in this design is classic: introducing the adapter adds an indirection layer and a maintenance obligation (the adapter must be updated when `OntologyRegistry` changes), but it eliminates the cascading risk of those changes propagating into `OntologyValidator` and `OntologyClassifier`. Given that `@fwornle/km-core` is an external or separately-versioned package, this trade-off strongly favors the ACL approach.

---

## Implementation Details

The `AntiCorruptionLayerWrapper` concept is realized through `LegacyOntologyAdapter`'s wrapping of `OntologyRegistry`. The adapter holds a reference to `OntologyRegistry` and exposes a **stable legacy interface** — a contract that `OntologyValidator` and `OntologyClassifier` depend on. This legacy interface does not mirror `OntologyRegistry`'s API directly; instead, it presents the shape that the internal `SemanticAnalysis` consumers expect, translating calls and data structures as necessary.

The term "legacy interface" here is technically precise: it describes an interface that predates or is independent of `@fwornle/km-core`'s current API surface. The wrapper's job is to absorb any semantic or structural drift between `OntologyRegistry`'s evolving API and this stable contract. This means translation logic (renaming methods, reshaping return types, providing default values for newly required parameters) lives entirely within the wrapper boundary.

Because no independent code symbols are surfaced for `AntiCorruptionLayerWrapper`, the implementation mechanics are expressed through `LegacyOntologyAdapter`'s methods. The wrapper pattern likely manifests as private delegation methods within the adapter class that call `OntologyRegistry` and transform the results before returning them via the legacy interface.

---

## Integration Points

The integration topology is straightforward and deliberately constrained:

- **Upstream dependency**: `OntologyRegistry` from `@fwornle/km-core` — the wrapped external API. The `AntiCorruptionLayerWrapper` is the only point of contact with this registry within the `SemanticAnalysis` component.
- **Downstream consumers**: `OntologyValidator` and `OntologyClassifier` — both depend exclusively on the legacy interface exposed by `LegacyOntologyAdapter`, never on `OntologyRegistry` directly.
- **Containing entity**: `LegacyOntologyAdapter` — owns and exposes the wrapper; serves as the integration surface for all consumers.

This means that `OntologyValidator` and `OntologyClassifier` are fully decoupled from `@fwornle/km-core`'s versioning lifecycle. A major version bump in `km-core` that restructures `OntologyRegistry` requires changes only within `LegacyOntologyAdapter` / `AntiCorruptionLayerWrapper`, leaving the validation and classification pipelines untouched.

---

## Usage Guidelines

**Never bypass the wrapper.** The entire value of `AntiCorruptionLayerWrapper` collapses if `OntologyValidator` or `OntologyClassifier` are ever given a direct reference to `OntologyRegistry`. Dependency injection configuration or module boundaries should enforce that these consumers receive only the `LegacyOntologyAdapter` interface.

**All `OntologyRegistry` API changes are handled here, exclusively.** When `@fwornle/km-core` is upgraded, the first and only place to assess impact is `LegacyOntologyAdapter`'s wrapper logic. The legacy interface contract exposed to `OntologyValidator` and `OntologyClassifier` should be treated as frozen unless there is an intentional internal refactor — changes to the legacy interface require coordinated updates to all consumers, which defeats the purpose of the ACL.

**The legacy interface is a first-class contract.** It should be formally defined (e.g., as a TypeScript interface or abstract class) so that both the adapter implementation and its consumers can be independently tested and validated against it. This also enables mock implementations for unit testing `OntologyValidator` and `OntologyClassifier` without any dependency on `@fwornle/km-core`.

**Scalability of the pattern** is bounded by the complexity of the translation layer. If `OntologyRegistry`'s API diverges significantly over time, the wrapper's translation logic can grow complex. In such cases, consider decomposing the wrapper into focused translation functions within `LegacyOntologyAdapter` rather than allowing a monolithic translation block to accumulate. The ACL pattern scales well structurally, but requires disciplined maintenance of the translation logic to remain comprehensible.


## Hierarchy Context

### Parent
- [LegacyOntologyAdapter](./LegacyOntologyAdapter.md) -- `LegacyOntologyAdapter` wraps `OntologyRegistry` from `@fwornle/km-core`, acting as an anti-corruption layer so that the legacy interface expected by `OntologyValidator` and `OntologyClassifier` is preserved even as the underlying registry implementation evolves


---

*Generated from 3 observations*
