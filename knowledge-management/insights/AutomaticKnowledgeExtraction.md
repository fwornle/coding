# AutomaticKnowledgeExtraction

**Type:** Detail

The architecture separates extraction concerns by source type, allowing each extractor to operate independently while contributing to the same graph store (GraphKMStore, referenced in project documentation)

# AutomaticKnowledgeExtraction — Technical Insight Document

## What It Is

`AutomaticKnowledgeExtraction` is a subsystem nested within **OnlineLearning**, as documented in `docs/architecture/memory-systems.md`. Its role is to continuously harvest structured knowledge from three distinct raw source types — **git history**, **LSL sessions**, and **code analysis** — and convert that raw data into typed graph entities destined for the shared knowledge graph store (**GraphKMStore**). Rather than requiring manual curation, this component automates the ingestion pipeline so that the broader OnlineLearning system receives a steady, structured stream of domain knowledge without human-in-the-loop intervention.

## Architecture and Design

The dominant architectural decision evident from the observations is **source-separated extraction with a unified output schema**. Each of the three extractors (git history, LSL sessions, code analysis) operates independently of the others, meaning failures, latency differences, or schema evolution in one extractor do not cascade into another. Despite their independence, all three converge on the same typed graph entity format before writing to GraphKMStore. This is a deliberate separation-of-concerns strategy: isolation at the input boundary, unification at the output boundary.

The enforcement of a **typed schema** at the extraction boundary is a significant design decision. By requiring each extractor to produce typed graph entities rather than raw or loosely-structured data, the architecture pushes validation and normalization responsibility as close to the source as possible. Downstream consumers — including OnlineLearning itself and any reasoning layers reading from GraphKMStore — can operate with confidence that every node in the graph conforms to a known type contract, reducing the need for defensive parsing further along the pipeline.

This design implicitly acknowledges that the three source types are epistemically heterogeneous: git history captures change lineage and authorship intent; LSL sessions capture runtime or interactive behavioral traces; code analysis captures static structural relationships. Treating them as independent extractors rather than forcing them through a single parser reflects an understanding that their data shapes, cadences, and noise profiles differ substantially.

**Trade-off:** Source independence improves resilience and maintainability but requires that each extractor individually implement the full type-mapping contract. Any evolution of the typed graph entity schema must be propagated to all three extractors, creating a coordination surface that could become a maintenance burden as the schema matures.

## Implementation Details

No code symbols or file paths beyond `docs/architecture/memory-systems.md` are available in the current observations, so the following is grounded strictly in the documented design rather than source-level mechanics.

Each extractor can be understood as a **transformer**: it accepts a raw source stream (commit log records, session event traces, or AST/static analysis output) and emits typed graph entity objects. The typing enforced at this stage implies the existence of a schema definition — likely a set of node types and edge types recognized by GraphKMStore — that each extractor must map its source data onto. The specific class names, function signatures, and file locations implementing these transformers are not yet captured in observations and should be traced directly from the codebase when available.

The pipeline's output — typed graph entities — feeds directly into GraphKMStore, which serves as the persistent, queryable substrate for OnlineLearning. The extraction process is described as automatic (hence the component name), suggesting it is triggered either continuously or on an event/schedule basis rather than on-demand.

## Integration Points

`AutomaticKnowledgeExtraction` is contained by **OnlineLearning**, which is its primary consumer and orchestrating parent. OnlineLearning depends on this component to keep GraphKMStore populated with current, accurate knowledge without manual intervention.

The three source integrations represent the system's external-facing boundaries:

- **Git history** ties the extractor to the project's version control system, meaning the extractor must have read access to repository metadata and commit records.
- **LSL sessions** tie it to whatever runtime or interactive environment produces LSL session data — the exact nature of this source warrants further documentation.
- **Code analysis** ties it to static analysis tooling, likely operating over the same codebase that git history tracks, creating a complementary dynamic/static pair.

All three feed into **GraphKMStore**, making that store the single integration point on the output side. Any sibling components within OnlineLearning that consume knowledge do so from GraphKMStore, not directly from the extractors — a clean read/write separation.

## Usage Guidelines

**Schema discipline is critical.** Because the typed graph entity schema is the contract between extractors and GraphKMStore, developers extending or modifying any individual extractor must first verify that their output continues to conform to the current schema. Introducing a new entity type requires coordinating a schema update in GraphKMStore before deploying the extractor change.

**Extractor independence should be preserved.** The architecture's resilience stems from extractors not depending on one another. New extractors for additional source types should be added as independent units following the same typed-output contract, not as extensions bolted onto existing extractors.

**Source-specific noise handling belongs in the extractor.** Each source type has its own signal-to-noise characteristics (e.g., merge commits vs. meaningful commits in git history, or noisy traces in LSL sessions). Filtering and normalization logic should live within the relevant extractor so that GraphKMStore and OnlineLearning always receive clean, meaningful entities.

**When no code symbols are available** (as is currently the case), treat `docs/architecture/memory-systems.md` as the authoritative reference for extraction source definitions and update this document as implementation-level observations become available.

---

### Architectural Patterns Summary

| Pattern | Evidence |
|---|---|
| Source-separated extraction | Three independent extractors per `memory-systems.md` |
| Typed output schema enforcement | Each extractor produces typed graph entities |
| Unified graph store as output sink | All extractors converge on GraphKMStore |
| Encapsulation within parent system | AutomaticKnowledgeExtraction is contained by OnlineLearning |

**Scalability consideration:** Because extractors are independent, they can in principle run concurrently or be scaled individually based on source volume. GraphKMStore becomes the scalability bottleneck — its write throughput and schema flexibility will determine how well the system handles increased extraction load.

**Maintainability assessment:** Moderate. The separation-of-concerns design aids maintainability, but the shared typed schema creates cross-cutting coordination overhead. Comprehensive schema versioning and per-extractor test coverage against the schema contract would significantly reduce maintenance risk as the system evolves.


## Hierarchy Context

### Parent
- [OnlineLearning](./OnlineLearning.md) -- docs/architecture/memory-systems.md identifies git history, LSL sessions, and code analysis as the three automatic extraction sources feeding OnlineLearning, each producing typed graph entities


---

*Generated from 3 observations*
