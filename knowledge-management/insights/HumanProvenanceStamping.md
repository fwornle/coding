# HumanProvenanceStamping

**Type:** Detail

Per the ManualLearning sub-component description, entities carry provenance metadata explicitly marking them as human-authored, contrasting with pipeline provenance stamps applied by KMCoreMigration — indicating a shared provenance field with distinct enum-like values rather than separate entity types.

# HumanProvenanceStamping — Technical Insight Document

---

## What It Is

HumanProvenanceStamping is a design mechanism within the **ManualLearning** sub-component responsible for marking knowledge entities as human-authored at the point of creation. Rather than being a standalone service or module with its own file path (no code symbols were resolved in the current index), it represents a **stamping convention** — a field-level tagging discipline applied to entities as they enter the knowledge graph through manual authoring workflows.

The mechanism is architecturally grounded in `docs/architecture/memory-systems.md`, which describes **GraphKMStore** as the underlying persistence layer. This means human provenance stamps are not ephemeral labels but first-class graph entity properties, stored persistently alongside the entity's content and any automated provenance metadata applied by sibling processes such as KMCoreMigration.

The defining characteristic of HumanProvenanceStamping is what it is *not*: it is not a post-hoc inference or a classification applied after the fact. It is an **at-creation enforcement point** — the act of stamping is architecturally colocated with entity creation inside ManualLearning, ensuring that every entity introduced through the manual pathway carries its provenance identity from birth.

---

## Architecture and Design

### Shared Provenance Field with Enum-Like Values

The most significant architectural decision evident from the observations is that **human and automated provenance are not represented as separate entity types**. Instead, both ManualLearning and KMCoreMigration write into a **shared provenance field**, with distinct enum-like values distinguishing origin. This is a deliberate unification — the knowledge graph's entity schema treats provenance as a property of all entities uniformly, rather than forking the type hierarchy based on origin.

This design decision carries meaningful trade-offs. On the positive side, it enables **uniform querying and graph traversal** regardless of provenance: a consumer of GraphKMStore does not need to know which entity type to look for, only which provenance value to filter on. It also avoids schema proliferation — a common hazard in systems that model every conceptual distinction as a separate class. The trade-off is that **semantic correctness depends on disciplined stamping at write time**; since the schema permits any provenance value, corruption or omission at the ManualLearning boundary would produce misclassified entities that are indistinguishable from automated ones at query time.

### Enforcement at Entity Creation, Not Inference

The architecture explicitly separates ManualLearning from automated ingestion at the sub-component boundary, and provenance tagging is enforced at entity creation rather than inferred post-hoc. This is a strong architectural stance: the system does not attempt to reverse-engineer whether an entity was human-authored by analyzing its content or structure. The stamp *is* the authoritative record. This means HumanProvenanceStamping is not an analytics layer — it is a **write-path invariant** that must be upheld by ManualLearning's entity creation logic.

The contrast with KMCoreMigration's pipeline provenance stamps reinforces this design: KMCoreMigration applies its stamps through an automated pipeline, while ManualLearning applies human provenance stamps through its own creation pathway. Both paths converge on the same GraphKMStore, but each is responsible for the integrity of its own stamps. There is no central provenance arbiter — correctness is distributed to the point of creation.

---

## Implementation Details

No code symbols or specific file paths for HumanProvenanceStamping's implementation were resolved in the current index. The following is grounded strictly in what the observations reveal about the mechanics.

The stamping mechanism operates on entities destined for **GraphKMStore**, meaning the provenance value is set as a **graph entity property** — a node-level attribute in the underlying graph structure described in `docs/architecture/memory-systems.md`. The property likely takes one of at least two values: a human-authorship marker (applied by ManualLearning / HumanProvenanceStamping) and a pipeline marker (applied by KMCoreMigration). The "enum-like" characterization from the observations suggests the set of valid values is bounded and known to the system, even if not enforced by a strict type at the storage layer.

Because provenance is stamped at entity creation time, the implementation is expected to be embedded in whatever constructor, factory, or ingestion function ManualLearning uses to instantiate new knowledge entities. It is not a middleware step applied after construction — it is part of the creation contract. Developers working within ManualLearning should assume that any entity creation path that bypasses HumanProvenanceStamping will produce an entity with either a missing or incorrect provenance field, which GraphKMStore will persist without complaint.

---

## Integration Points

HumanProvenanceStamping's primary integration is **upward into ManualLearning**, its containing sub-component. ManualLearning is the boundary at which human-authored knowledge enters the system, and HumanProvenanceStamping is the mechanism that formalizes that boundary in the data.

The **sibling relationship with KMCoreMigration** is architecturally significant. KMCoreMigration applies its own provenance stamps through automated pipeline ingestion — these stamps and the human stamps produced by HumanProvenanceStamping share the same field on the same entity schema. This means any system component reading from GraphKMStore and filtering by provenance will interact with both stamp types. The two sub-components do not directly depend on each other, but they share an implicit contract: the provenance field's value space is a shared namespace, and both must use distinct, non-colliding values.

**GraphKMStore** (documented in `docs/architecture/memory-systems.md`) is the downstream persistence dependency. Human provenance tags flow into it as graph entity properties and are queryable by any consumer of the store. There is no indication of a separate index or secondary store for provenance metadata — it is co-located with the entity in the graph.

---

## Usage Guidelines

**Stamp at creation, not after.** The architecture's core invariant is that provenance is applied when an entity is created within ManualLearning. Any workflow that creates entities and defers stamping — or stamps them in a separate pass — violates the design intent and risks producing entities that are incorrectly attributed as automated or unprovenanced.

**Treat the provenance field as immutable post-creation.** Since HumanProvenanceStamping is an at-creation concern, there is no architectural provision described for updating provenance after the fact. Entities should be considered stamped-for-life. If an entity's origin changes (e.g., an automated entity is edited by a human), the system's current design does not address re-stamping — this is a gap to be aware of when extending ManualLearning.

**Do not invent new provenance values without coordinating with KMCoreMigration.** The provenance field is a shared namespace between ManualLearning and KMCoreMigration. Introducing a new value for human provenance (e.g., to distinguish sub-types of human authorship) must be done with awareness that KMCoreMigration and all GraphKMStore consumers will be operating against the same field. Undocumented values will be invisible to existing <USER_ID_REDACTED> and may cause silent misclassification.

**Validate provenance field presence in any ManualLearning entity creation path.** Because there is no separate entity type to enforce provenance structurally, the only safety net is validation at the ManualLearning boundary. Integration tests for ManualLearning should assert that every entity written to GraphKMStore via this path carries a non-null, valid human-authorship provenance value.

---

*This document reflects the current architectural state as synthesized from available observations. Specific file paths and class names for HumanProvenanceStamping's implementation were not resolved in the current index and should be updated as code symbols become available.*


## Hierarchy Context

### Parent
- [ManualLearning](./ManualLearning.md) -- ManualLearning entities are distinguished by provenance metadata that marks their origin as human-authored, contrasting with the automated pipeline provenance stamps applied by KMCoreMigration


---

*Generated from 3 observations*
