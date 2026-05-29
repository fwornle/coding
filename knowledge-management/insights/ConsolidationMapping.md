# ConsolidationMapping

**Type:** Detail

Unmapped type strings are expected to be tracked separately (per the UnregisteredClassTracker suggestion from parent analysis), indicating this mapping is not exhaustive by design and is intended to grow over time.

# ConsolidationMapping — Technical Insight Document

## What It Is

ConsolidationMapping is a normalization layer contained within **EntityTypeRegistry**, responsible for translating arbitrary or legacy incoming type strings into one of three canonical forms defined by the **ThreeTypeOntology** (System, Project, Pattern). It sits at the boundary between external data producers and the internal knowledge graph, acting as the single point of truth for type resolution before any entity reaches graph insertion. While no specific source file paths were surfaced in the code analysis, its existence and purpose are grounded in the `docs/RELEASE-2.0.md` release notes for the Ontology Integration System and are described explicitly in the EntityTypeRegistry parent component context.

## Architecture and Design

The central architectural decision here is the separation of *canonical representation* from *input diversity*. Rather than requiring all data producers to conform to the three-type ontology at source, ConsolidationMapping absorbs that variance internally. This is a deliberate compatibility strategy documented in `docs/RELEASE-2.0.md`: the system was designed to handle legacy or variant type strings without forcing breaking changes on existing producers. The implication is that ConsolidationMapping acts as an **anti-corruption layer** — a concept directly evident from the observations — insulating the clean three-type ontology from the messy reality of upstream data.

This design creates a clear contract: everything downstream of EntityTypeRegistry operates in a world of only three types. Everything upstream of ConsolidationMapping may use any string. The mapping boundary is where that translation contract is enforced. This keeps **ThreeTypeOntology** — the sibling component — pure and stable, since it only needs to define the canonical surface, not accommodate every historical variant. The two components are complementary: ThreeTypeOntology defines *what is valid*, and ConsolidationMapping defines *how to get there*.

A notable architectural trade-off is that ConsolidationMapping is explicitly **not exhaustive by design**. Unmapped strings are expected to pass through without a canonical match and are tracked separately via the suggested **UnregisteredClassTracker** mechanism. This means the system prefers graceful handling of unknown inputs over strict rejection, which favors availability and observability over rigidity.

## Implementation Details

No code symbols or file paths were surfaced in the static analysis, which suggests ConsolidationMapping may be implemented as configuration, a data structure (such as a dictionary or lookup table), or as private logic embedded within EntityTypeRegistry rather than as a standalone class with exported symbols. Based on the observations, its core mechanic is a lookup: given an incoming type string, return the matching canonical type from {System, Project, Pattern}, or indicate no match was found.

The non-exhaustive nature is a key implementation detail. The mapping is expected to grow incrementally as new variant strings are encountered — suggesting a living configuration or registry entry rather than a hard-coded switch. The pairing with UnregisteredClassTracker implies a feedback loop: unmatched strings are recorded, reviewed, and eventually either added to the mapping or classified as noise. This gives the system an evolutionary mechanism for expanding coverage without requiring upfront completeness.

## Integration Points

ConsolidationMapping's primary integration is upward into **EntityTypeRegistry**, which uses it as the mandatory preprocessing step before graph insertion. No entity type reaches the knowledge graph without passing through this mapping. Its secondary integration is with the **UnregisteredClassTracker** (referenced in the parent analysis), which consumes the residual output — the strings ConsolidationMapping cannot resolve. Together, these two components form a complete handling pipeline for type strings: map what you can, track what you cannot.

The sibling **ThreeTypeOntology** defines the target types that ConsolidationMapping maps *toward*. Any change to ThreeTypeOntology's canonical set (e.g., adding a fourth type) would require a corresponding update to ConsolidationMapping's target vocabulary, making these two components tightly coupled at the schema level even if loosely coupled in implementation.

## Usage Guidelines

Developers contributing new entity producers should not attempt to enforce type normalization at the producer level — that responsibility belongs to ConsolidationMapping. Producers should pass their natural type strings and trust EntityTypeRegistry to resolve them. However, if a producer introduces a genuinely new type string variant, it should be surfaced via the UnregisteredClassTracker output and a corresponding entry should be added to ConsolidationMapping, rather than embedding ad-hoc normalization elsewhere in the pipeline.

Because ConsolidationMapping is intended to grow over time, it should be treated as a maintained artifact, not a static configuration. Changes to it represent ontological decisions — mapping a string to "System" rather than "Project" has downstream consequences for graph structure and querying. Such additions should be reviewed with the same rigor as changes to ThreeTypeOntology itself. The evolutionary design is a strength, but only if the feedback loop from UnregisteredClassTracker is actively monitored and acted upon.

---

**Architectural Patterns Identified:** Anti-corruption layer, canonical type normalization, graceful degradation for unknown inputs.

**Key Design Trade-off:** Completeness vs. availability — the system favors forward progress with unmatched types over strict rejection, accepting incompleteness in exchange for resilience.

**Scalability Consideration:** The incremental growth model scales well for slow-moving ontology drift but could become a maintenance burden if upstream producers are highly heterogeneous or frequently introduce new type strings.

**Maintainability Assessment:** Moderate — the design is clean and purposeful, but the absence of surfaced code symbols makes it difficult to assess how the mapping is stored or versioned. Formalizing it as an explicit, inspectable artifact (rather than embedded logic) would improve long-term maintainability.


## Hierarchy Context

### Parent
- [EntityTypeRegistry](./EntityTypeRegistry.md) -- EntityTypeRegistry enforces a three-type ontology (System/Project/Pattern) as the canonical classification surface, with all incoming entity types mapped through this consolidation layer before graph insertion

### Siblings
- [ThreeTypeOntology](./ThreeTypeOntology.md) -- Documented in docs/RELEASE-2.0.md ('Release 2.0 - Ontology Integration System'), this three-type ontology was introduced as a formal classification surface to consolidate previously inconsistent entity typing across the knowledge system.


---

*Generated from 3 observations*
