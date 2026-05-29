# ThreeTypeOntology

**Type:** Detail

Documented in docs/RELEASE-2.0.md ('Release 2.0 - Ontology Integration System'), this three-type ontology was introduced as a formal classification surface to consolidate previously inconsistent entity typing across the knowledge system.

## What It Is

ThreeTypeOntology is the formal classification schema at the core of `EntityTypeRegistry`, defining exactly three canonical entity types — **System**, **Project**, and **Pattern** — that serve as the authoritative vocabulary for all entities entering the knowledge graph. Its existence is documented in `docs/RELEASE-2.0.md` under "Release 2.0 - Ontology Integration System," where it was introduced specifically to resolve previously inconsistent entity typing across the knowledge system. Its architectural role is further elaborated in `docs/architecture/memory-systems.md` ("Graph-Based Knowledge Storage Architecture"), which positions it as the enforcement layer sitting between raw entity ingestion and graph persistence.

This is not merely a type enumeration — it is a **classification gate**. No entity reaches graph storage without being mapped through this ontology, making it one of the most structurally critical invariants in the entire system.

---

## Architecture and Design

The design decision behind ThreeTypeOntology is one of **deliberate constraint**: rather than allowing an open or extensible type vocabulary, the architects chose a closed three-member set. This reflects a core trade-off — expressiveness versus consistency. Prior to Release 2.0, inconsistent entity typing created downstream problems in the knowledge graph (likely in querying, traversal, and entity resolution). The three-type ontology resolves this by making type ambiguity structurally impossible at the persistence boundary.

Within `EntityTypeRegistry`, ThreeTypeOntology functions as the **canonical surface** — it defines what is valid, while its sibling component ConsolidationMapping handles the practical work of translating arbitrary incoming strings into one of the three canonical forms. This separation of concerns is architecturally meaningful: ThreeTypeOntology owns the *definition of truth*, and ConsolidationMapping owns the *path to truth*. Together they form a two-layer normalization pipeline inside `EntityTypeRegistry`.

The positioning described in `docs/architecture/memory-systems.md` — as the enforcement layer between ingestion and persistence — suggests a **gate pattern**: a single, mandatory checkpoint that all data must pass through. This is a strong architectural guarantee. The explicit statement that "no entity bypasses this classification gate" indicates the design prioritizes correctness and uniformity over throughput flexibility.

---

## Implementation Details

No code symbols or source files were identified in the analysis, so the following is grounded entirely in the documented architecture rather than source inspection.

The three canonical types — **System**, **Project**, and **Pattern** — represent the full expressive range the ontology permits. Each incoming entity, regardless of how it was originally labeled or sourced, must resolve to one of these three. The mechanics of that resolution live in ConsolidationMapping, but ThreeTypeOntology defines the target set that ConsolidationMapping maps *toward*. In this sense, ThreeTypeOntology is best understood as a bounded enumeration or controlled vocabulary that ConsolidationMapping treats as its codomain.

The classification surface was introduced in Release 2.0 as a consolidation measure, which implies the three types were derived from analysis of what entity categories actually existed in the pre-2.0 system — they were not designed speculatively but emerged from rationalization of existing data. This increases confidence that the three types are semantically stable anchors rather than arbitrary choices.

---

## Integration Points

ThreeTypeOntology is contained within `EntityTypeRegistry`, which is its primary host and enforcement context. `EntityTypeRegistry` exposes the ontology as the canonical classification surface to all upstream ingestion processes. ConsolidationMapping, as a sibling component within `EntityTypeRegistry`, depends directly on ThreeTypeOntology as its mapping target — it cannot function meaningfully without the three-type definition to map toward.

Downstream, the graph persistence layer (described in `docs/architecture/memory-systems.md`) receives only entities that have already been typed through this ontology. This means the graph storage schema can safely assume all entity types are members of the three-type set — a contract that likely simplifies graph <USER_ID_REDACTED>, indexing strategies, and entity resolution logic considerably.

---

## Usage Guidelines

Developers working with entity ingestion must treat ThreeTypeOntology as a **non-negotiable contract**. Attempting to introduce a fourth entity type, or to bypass `EntityTypeRegistry` when inserting into the graph, would violate the architectural guarantee documented in both `docs/RELEASE-2.0.md` and `docs/architecture/memory-systems.md`. The correct path for any new entity type is not to extend the ontology directly, but to evaluate whether the entity fits an existing canonical type and update ConsolidationMapping accordingly.

Any proposed extension to the three-type set should be treated as a **major architectural change**, not a minor addition. The value of the ontology is precisely its closure — expanding it has ripple effects on ConsolidationMapping, graph schema, and any downstream logic that branches on entity type. Such changes warrant a release-level decision, consistent with how the ontology itself was introduced at a major version boundary (Release 2.0).

When contributing new entity sources or ingestion pipelines, validate that all entity types emitted by that pipeline have corresponding entries in ConsolidationMapping. ThreeTypeOntology itself should be treated as read-only stable infrastructure; ConsolidationMapping is the appropriate extension point for accommodating new source vocabularies.

---

## Architectural Patterns and Design Assessment

| Dimension | Assessment |
|---|---|
| **Pattern** | Gate / Normalization checkpoint with closed-vocabulary enumeration |
| **Key trade-off** | Expressiveness sacrificed for type consistency and graph integrity |
| **Scalability** | The three-type constraint is intentionally inextensible — scales in *data volume*, not *type breadth* |
| **Maintainability** | High, due to separation between type definition (ThreeTypeOntology) and mapping logic (ConsolidationMapping) |
| **Risk** | Ontology ossification — if the domain genuinely requires a fourth type, the cost of change is architecturally significant |

The most consequential design insight here is that **type stability was chosen as a first-class property**. The architecture accepts reduced flexibility in exchange for a guarantee that the graph never contains ambiguously typed entities — a reasonable trade in a knowledge system where type-based traversal and reasoning are likely core operations.


## Hierarchy Context

### Parent
- [EntityTypeRegistry](./EntityTypeRegistry.md) -- EntityTypeRegistry enforces a three-type ontology (System/Project/Pattern) as the canonical classification surface, with all incoming entity types mapped through this consolidation layer before graph insertion

### Siblings
- [ConsolidationMapping](./ConsolidationMapping.md) -- Referenced in the parent component context as the mechanism by which EntityTypeRegistry enforces its three-type ontology, mapping arbitrary incoming strings to canonical forms.


---

*Generated from 3 observations*
