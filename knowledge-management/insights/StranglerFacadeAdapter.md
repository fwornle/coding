# StranglerFacadeAdapter

**Type:** Detail

The strangler-facade pattern used here implies a planned migration path: legacy callers are gradually strangled out as they are updated to call OntologyRegistry directly, at which point the adapter can be removed.

# StranglerFacadeAdapter — Technical Insight Document

## What It Is

`StranglerFacadeAdapter` describes the structural role played by `LegacyOntologyAdapter` within the `OntologyRegistry` component of `km-core`. Rather than being a standalone class itself, it is the **pattern classification** for `LegacyOntologyAdapter` — a facade that preserves the old ontology-loading interface while internally delegating all real work to `OntologyRegistry`. It exists at the boundary between legacy callers and the modern `km-core` subsystem, acting as a compatibility shim with a defined expiration date.

## Architecture and Design

The strangler facade pattern is the central architectural decision here. `LegacyOntologyAdapter` presents the method signatures and call conventions that existing consumers already depend on, ensuring zero disruption to legacy callers at the time of introduction. Crucially, it contains **no independent logic** — all ontology resolution, loading, and registration behavior is delegated to `OntologyRegistry` inside `km-core`. This means `OntologyRegistry` is the single authoritative implementation, and `LegacyOntologyAdapter` is a pure routing layer.

The relationship between `LegacyOntologyAdapter` and its parent `OntologyRegistry` is deliberately asymmetric: `OntologyRegistry` owns the real behavior, and `LegacyOntologyAdapter` is contained within it as a transitional construct. This containment makes the dependency direction explicit — the adapter depends on the registry, never the reverse.

The strangler pattern implies a **time-bounded existence**. The adapter is not intended to be a permanent architectural feature; it is a migration scaffold. As legacy callers are updated to invoke `OntologyRegistry` directly, the justification for `LegacyOntologyAdapter` erodes, and it becomes safe to remove. The facade "strangles" legacy coupling incrementally rather than requiring a hard cutover.

**Trade-off acknowledged by this design:** The adapter introduces a layer of indirection and duplicates the interface surface area of `OntologyRegistry`. This is accepted as a short-term cost in exchange for zero-risk migration — legacy callers continue working without modification while the underlying system modernizes beneath them.

## Implementation Details

`LegacyOntologyAdapter` functions as a thin delegation wrapper. Its public methods mirror the legacy ontology-loading interface — preserving old method names, parameter shapes, and return conventions — while their implementations consist primarily of forwarding calls to the corresponding methods on `OntologyRegistry`. There is no business logic, caching, or transformation within the adapter itself.

The mechanics are straightforward: when a legacy caller invokes a method on `LegacyOntologyAdapter`, the adapter translates that call (if any signature mismatch exists) and passes it through to `OntologyRegistry`, which handles the actual ontology lifecycle — resolution, loading, and registration. The adapter may perform lightweight argument mapping if the legacy and modern signatures diverge, but it introduces no side effects of its own.

No specific file paths or code symbols are available from the observations, so precise method-level analysis is not possible. The structural mechanics, however, are fully determined by the pattern: every public entry point on `LegacyOntologyAdapter` has a direct correspondent in `OntologyRegistry`.

## Integration Points

The primary integration is the **inward dependency** on `OntologyRegistry`. `LegacyOntologyAdapter` cannot function without it — all meaningful behavior flows through the registry. This makes `OntologyRegistry` the true integration point for ontology operations; `LegacyOntologyAdapter` is simply a named entry path into that registry.

On the consumer side, legacy callers interact exclusively with `LegacyOntologyAdapter`'s interface and are unaware of `OntologyRegistry`'s existence. This is the facade's guarantee: the adapter absorbs all interface compatibility concerns so that `OntologyRegistry` can evolve its own API without breaking existing consumers prematurely.

## Usage Guidelines

**For legacy callers:** Continue using `LegacyOntologyAdapter` as you do today, but treat it as a deprecated interface. There is an explicit migration path — each call site should be tracked for eventual update to invoke `OntologyRegistry` directly.

**For new code:** Never introduce new dependencies on `LegacyOntologyAdapter`. All new ontology-loading, resolution, or registration code should target `OntologyRegistry` directly. Introducing new callers of the adapter would extend its lifetime and undermine the strangler migration.

**For maintainers:** The removal of `LegacyOntologyAdapter` is the success condition of this pattern, not a refactor risk. Tracking which callers remain on the legacy interface is the key maintenance activity. Once all call sites have migrated to `OntologyRegistry`, the adapter should be deleted rather than retained "just in case" — its presence after migration completion would be dead code that misleads future developers about the system's interface surface.

**Scalability note:** Because `LegacyOntologyAdapter` contains no state and no logic, it imposes negligible runtime overhead. Scalability is entirely determined by `OntologyRegistry`'s own characteristics. The adapter pattern here has no meaningful impact on throughput or resource usage.


## Hierarchy Context

### Parent
- [OntologyRegistry](./OntologyRegistry.md) -- LegacyOntologyAdapter implements the strangler-facade pattern, exposing the old ontology-loading interface while delegating internally to km-core OntologyRegistry


---

*Generated from 3 observations*
