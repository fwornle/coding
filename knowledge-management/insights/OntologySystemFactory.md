# OntologySystemFactory

**Type:** Detail

## What It Is

OntologySystemFactory maps, despite the naming mismatch, to `createOntologySystem()` in `src/ontology/index.ts`. It is a factory function that assembles an `OntologySystem` facade interface (`ontology`, `validator`, `classifier`, `config`) from caller-supplied dependencies. A sibling function, `validateOntologyConfig()`, lives in the same file and handles static config validation separately from runtime object construction. Although organizationally positioned under Ontology and Pipeline, and nested beneath SemanticAnalysisAgent in the hierarchy, the documented actual consumer is `persistence-agent.ts`, not SemanticAnalysisAgent — an important correction to the parent-context framing.

## Architecture and Design

The factory embodies several deliberate patterns. First, fail-fast dependency injection: `createOntologySystem()` requires an `inferenceEngine` and a `LegacyOntologyAdapter`, throwing explicit, distinctly worded errors if either is missing rather than defaulting or mocking them. The doc comment is emphatic that there is "NO MOCK FALLBACK" — production and test callers alike must supply a real LLM engine sourced from SemanticAnalyzer.

Second, it follows an adapter/shim pattern: the `LegacyOntologyAdapter` is documented as a Phase 42-03 D-53 shim wrapping the newer km-core `OntologyRegistry`, preserving a pre-refactor call shape so that existing call paths in `persistence-agent.ts` remain unchanged. The factory deliberately does not construct the adapter or registry itself — that responsibility is pushed to the caller, keeping the factory's scope narrowly "assemble validator+classifier around a given adapter" rather than "stand up ontology storage."

Third, config validation is decoupled from instance construction: `validateOntologyConfig()` is synchronous, side-effect-free, and requires no live dependencies, whereas `createOntologySystem()`'s checks are runtime/dependency gates. This separation lets config correctness be verified at config-load time, independent of adapter or inference-engine availability.

## Implementation Details

`createOntologySystem()` takes a config plus the two required collaborators and wires four pieces together: it instantiates a bare `OntologyValidator(adapter)`, builds a `heuristicClassifier` via `createHeuristicClassifier()`, and constructs `new OntologyClassifier(adapter, validator, heuristicClassifier, inferenceEngine)`. No caching or singleton reuse is visible — validator and classifier are built fresh on every call.

`validateOntologyConfig()` returns `{valid, errors}`, checking that `upperOntologyPath` is present when ontology is enabled and `lowerOntologyPath` is present when a team is specified, short-circuiting to a valid result when ontology is disabled entirely.

## Integration Points

The factory depends on an inference engine (expected to originate from SemanticAnalyzer) and a caller-constructed `LegacyOntologyAdapter` wrapping km-core's `OntologyRegistry`. Its documented consumer is `persistence-agent.ts`, which relies on the pre-Phase-42-03 wiring shape remaining stable. Within the taxonomy this factory helps produce, downstream classification consumers depend on the taxonomy staying a fixed "spine," as validated by the Taxonomy Stability Validation work via disjoint-sample re-derivation. Separately, a known-bad discrepancy exists in the pipeline: CodingLowerOntologySource is emitted despite documentation saying it never should be, with suspicion falling on lower-ontology emission near `coding.lower.json` in OntologyClassificationAgent or its upstream producers — relevant to anyone touching this factory's `lowerOntologyPath` wiring. Sibling component OntologyClassRepair addresses a related but distinct concern offline, enforcing `ontologyClass`/`entityType` ancestry invariants via `scripts/repair-writer-ontology-class.mjs`, independent of this factory's runtime path.

## Usage Guidelines

Callers must never attempt to bypass the required-dependency throws by mocking the inference engine — this is an intentional hard gate, not an oversight. Adapter/registry construction belongs to the caller (e.g., persistence-agent.ts), not this factory. Use `validateOntologyConfig()` early, at config-load time, to catch malformed `OntologyConfig` before any adapter or engine exists. Developers modifying lower-ontology paths should treat the CodingLowerOntologySource emission bug as a known live defect, not a spec-compliant behavior, and avoid extending or trusting that path without cross-checking against OntologyClassificationAgent.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The Pipeline CodingLowerOntologySource Emission Bug work record documents an unresolved defect where the SemanticAnalysis pipeline emits a CodingLowerOntologySource reference despite project documentation stating this source type should never be produced, with the likely fault zone identified as the lower-ontology emission path near coding.lower.json consumption in OntologyClassificationAgent or its upstream producers — a live discrepancy a developer touching ontology construction (including this factory's lowerOntologyPath wiring) should treat as known-bad, not spec-compliant.
- The Taxonomy Stability Validation via Disjoint Sample Re-derivation work record establishes that intent-derived taxonomies were validated by re-deriving them independently from two disjoint data samples and measuring agreement, treating reproducibility as a precondition for freezing the taxonomy rather than a post-hoc sanity check — a methodology tied to the taxonomy's role as a fixed 'spine' that any downstream ontology-classification consumer (of the kind this factory assembles) depends on staying stable.

## Hierarchy Context

### Parent
- [SemanticAnalysisAgent](./SemanticAnalysisAgent.md) -- [SESSION] Taxonomy Stability Validation via Disjoint Sample Re-derivation validates that an intent-derived taxonomy produced from SemanticAnalysisAgent-adjacent processing is stable and reproducible by re-deriving it independently from disjoint data samples.

### Siblings
- [OntologyClassRepair](./OntologyClassRepair.md) -- [LLM] scripts/repair-writer-ontology-class.mjs is the OntologyClassRepair component itself: an offline, standalone script enforcing the invariant that `ontologyClass` must equal `entityType` or one of its ancestors in the ontology registry. `loadParentMap()` builds a `Map<className, parentName>` by reading every JSON file under `.data/ontologies/obs-api/` and pulling `body.extends ?? body.parent`, then `chainOf(cls, parent)` walks that map from a class up to its root (cycle-safe via a `seen` set) so a row is legal only if `chainOf(entityType, parent).includes(ontologyClass)`.


---

*Generated from 9 observations*
