# GraphKMStore

**Type:** Detail

docs/architecture/memory-systems.md ('Graph-Based Knowledge Storage Architecture') explicitly documents GraphKMStore as the named component responsible for graph-based knowledge storage within the KnowledgeManagementPatterns sub-component.

# GraphKMStore — Technical Insight Document

---

## What It Is

GraphKMStore is the graph-based knowledge storage component within the **KnowledgeManagementPatterns** sub-component, as explicitly documented in `docs/architecture/memory-systems.md` under the section titled *Graph-Based Knowledge Storage Architecture*. It sits within the broader **KnowledgeManagement** system and serves as the authoritative store for structured knowledge represented as a graph — where nodes, edges, and their relationships encode domain knowledge rather than raw records.

Its scope extends beyond a single project boundary: `docs/architecture/cross-project-knowledge.md` (*Cross-Project Knowledge System*) establishes that GraphKMStore supports cross-project knowledge retrieval, meaning its graph schema is designed to accommodate project-scoped node relationships. This positions GraphKMStore not as a local, single-tenant store, but as a shared knowledge graph that can be <USER_ID_REDACTED> across project contexts.

GraphKMStore contains one notable child component — **UUIDv7TimeOrderedIdentity** — which governs how entities within the graph are identified. No source code files were surfaced in the analysis, so the following architectural discussion is derived from documented design intent rather than code-level inspection.

---

## Architecture and Design

### Graph Schema with Project-Scoped Relationships

The most significant architectural decision evident from `docs/architecture/cross-project-knowledge.md` is that GraphKMStore's graph schema explicitly encodes **project scope as a first-class relationship dimension**. Rather than treating project membership as a metadata filter applied at query time, the schema models it through node relationships — meaning graph traversal itself can respect or cross project boundaries depending on the query strategy. This is a deliberate design choice that trades schema simplicity for query expressiveness: cross-project knowledge discovery is a graph traversal problem, not a filter problem.

### Ontology Integration Layer

`docs/RELEASE-2.0.md` (*Release 2.0 - Ontology Integration System*) reveals a significant architectural evolution: ontology tagging is applied **during storage**, not post-hoc. This means GraphKMStore integrates with an ontology classification layer at write time, embedding semantic classification into the graph at the moment of entity creation. The design implication is that every node stored through GraphKMStore carries ontological identity from inception — the graph is semantically enriched by construction, not by a separate enrichment pass. This tightly couples GraphKMStore to the ontology system introduced in Release 2.0, creating a dependency that must be respected when extending or replacing either component.

### Identity Strategy: UUIDv7 Over Legacy IDs

A deliberate departure from legacy identifier schemes (used by GraphDatabaseService/LevelDB) is encoded in the **UUIDv7TimeOrderedIdentity** child component. The choice of UUIDv7 embeds entity creation time directly into the identifier itself, enabling natural chronological ordering of knowledge entities without requiring a separate timestamp column or sort index. This is an architectural trade-off that prioritizes:

- **Sortability by creation time** as a zero-cost operation (the ID carries the ordering signal)
- **Distributed ID generation** without coordination (UUIDv7 retains the decentralized generation property of UUIDs)
- **Explicit break from legacy** — the decision to move away from GraphDatabaseService/LevelDB ID schemes signals that GraphKMStore treats knowledge entity identity as a first-class concern, not an inherited convention

---

## Implementation Details

### UUIDv7TimeOrderedIdentity

The **UUIDv7TimeOrderedIdentity** component is the concrete identity mechanism for all entities managed by GraphKMStore. UUIDv7 encodes a millisecond-precision Unix timestamp in the most significant bits of the 128-bit identifier, which means that when graph nodes are listed or indexed by ID, chronological order is preserved naturally. For a knowledge graph where the recency and sequence of knowledge acquisition may be semantically meaningful, this is a non-trivial design affordance.

This choice also carries operational implications: time-ordered IDs cluster recently created nodes together in storage structures that use ID-based partitioning or B-tree indexing, which can improve write locality and range scan performance for recent knowledge entities — a likely common access pattern.

### Ontology Tagging at Write Time

Based on `docs/RELEASE-2.0.md`, the storage path through GraphKMStore includes an ontology classification step before (or during) persistence. The practical mechanics of this integration are not fully specified in available observations, but the "during storage" framing implies GraphKMStore either invokes the ontology layer as part of its write pipeline or delegates to a combined write operation that atomically stores the graph entity and its ontological tags. Developers extending GraphKMStore's storage logic should treat ontology classification as a mandatory write-path concern, not an optional enrichment.

---

## Integration Points

**KnowledgeManagementPatterns (Parent):** GraphKMStore is one component within the KnowledgeManagementPatterns sub-component, meaning it operates alongside sibling components that likely address other knowledge storage or retrieval strategies. Its graph-based approach is specifically documented in `docs/architecture/memory-systems.md`, suggesting KnowledgeManagementPatterns encompasses multiple storage paradigms of which graph-based storage is one named pattern.

**KnowledgeManagement (Container):** GraphKMStore is contained within KnowledgeManagement, implying it is one of potentially several storage backends or knowledge organization mechanisms coordinated at that higher level.

**Ontology Classification System:** As introduced in Release 2.0, the ontology layer is a write-time dependency for GraphKMStore. Any knowledge entity stored must pass through ontology tagging, making this system a hard integration point in the storage pipeline.

**Cross-Project Knowledge System:** `docs/architecture/cross-project-knowledge.md` establishes GraphKMStore as a participant in cross-project retrieval scenarios. This implies query interfaces on GraphKMStore must support project-scope parameters — either to constrain traversal within a project or to explicitly enable cross-project graph <USER_ID_REDACTED>.

**Legacy Systems (GraphDatabaseService / LevelDB):** The explicit choice of UUIDv7 over legacy ID schemes signals that GraphKMStore is architecturally distinct from and intentionally not backward-compatible with GraphDatabaseService/LevelDB identity conventions. Integration paths that attempt to bridge these systems would need to manage identity translation explicitly.

---

## Usage Guidelines

### Treat Ontology Classification as Non-Optional

Because ontology tagging occurs during storage (per `docs/RELEASE-2.0.md`), callers of GraphKMStore's write interface should ensure the ontology system is available and correctly configured before invoking storage operations. Bypassing or disabling ontology classification at write time would produce nodes without semantic classification, degrading graph query <USER_ID_REDACTED> and breaking assumptions baked into the schema.

### Leverage UUIDv7 Ordering Properties

Developers querying or indexing knowledge entities should leverage the natural chronological ordering of **UUIDv7TimeOrderedIdentity** identifiers rather than introducing redundant timestamp fields for sort operations. ID-range <USER_ID_REDACTED> can substitute for time-range <USER_ID_REDACTED> on recently created entities, which is more efficient in ID-indexed structures.

### Respect Project Scope in Graph <USER_ID_REDACTED>

Given that GraphKMStore's schema encodes project-scoped node relationships (per `docs/architecture/cross-project-knowledge.md`), <USER_ID_REDACTED> should be explicit about whether they intend single-project or cross-project traversal. Omitting project scope in traversal <USER_ID_REDACTED> may inadvertently return knowledge from unintended project contexts, which is a correctness concern in multi-project deployments.

### Do Not Inherit Legacy ID Schemes

When creating new entity types or extending GraphKMStore's node model, use **UUIDv7TimeOrderedIdentity** exclusively. Reintroducing legacy ID formats from GraphDatabaseService or LevelDB would undermine the chronological ordering guarantees and create an inconsistent identity model within the graph.

---

## Scalability and Maintainability Assessment

GraphKMStore's design reflects several forward-looking decisions. The use of UUIDv7 supports distributed entity creation without ID coordination overhead, which is favorable for scale. The embedding of ontological classification at write time means the graph remains semantically queryable at any scale without requiring a separate enrichment pipeline to "catch up." The project-scoped graph schema enables knowledge isolation and targeted retrieval, which scales naturally to multi-tenant or multi-project deployments.

The primary maintainability risk is the tight write-time coupling to the ontology classification system. Changes to the ontology layer's interface or classification behavior will have direct impact on GraphKMStore's storage pipeline. This coupling should be explicitly managed through a stable interface contract between the two systems. The absence of surfaced code symbols in this analysis means that the exact implementation of these integration points remains opaque and warrants closer inspection as the codebase evolves.


## Hierarchy Context

### Parent
- [KnowledgeManagementPatterns](./KnowledgeManagementPatterns.md) -- GraphKMStore is explicitly named in project documentation as the graph-based knowledge storage component, with docs/architecture/memory-systems.md describing its Graph-Based Knowledge Storage Architecture

### Children
- [UUIDv7TimeOrderedIdentity](./UUIDv7TimeOrderedIdentity.md) -- As described in the SubComponent context, GraphKMStore explicitly chose UUIDv7 over legacy IDs used by GraphDatabaseService/LevelDB, meaning entity creation time is embedded in the ID itself and enables natural chronological sorting of knowledge entities.


---

*Generated from 3 observations*
