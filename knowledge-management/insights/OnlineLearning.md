# OnlineLearning

**Type:** SubComponent

code-graph-agent.ts is described as a downstream agent consuming VKB-exposed entity operations rather than accessing storage directly, implying it participates in or consumes OnlineLearning output

# OnlineLearning: Technical Insight Document

## What It Is

OnlineLearning is a SubComponent of the broader KnowledgeManagement architecture, representing the automated, high-volume entity extraction pipeline documented in `docs/architecture/memory-systems.md`. Rather than being a manually curated store of knowledge, OnlineLearning is populated by a batch analysis pipeline that ingests three distinct sources: git history, LSL session logs, and code analysis output. This positions OnlineLearning as the "automatic" counterpart within the knowledge graph, in contrast to its sibling, ManualLearning, which represents human-curated entities persisted through the same underlying infrastructure but via a different provenance path.

![OnlineLearning — Architecture](images/online-learning-architecture.png)

## Architecture and Design

The defining architectural decision for OnlineLearning is strict decoupling between extraction and persistence. The batch analysis pipeline does not write directly to any storage layer; instead, extracted entities are written to the graph exclusively through the VKB server's persistence operations. This mirrors the pattern established for ManualLearning and reflects the parent KnowledgeManagement component's design principle that the VKB server is the single choke point for all graph mutations, caching, and consistency guarantees.

This choke-point pattern is a deliberate trade-off: it sacrifices some flexibility (pipelines can't optimize storage access for their specific high-volume needs) in exchange for centralized control over schema consistency and decay logic. The prior LevelDB-based store was replaced or augmented by the current graph architecture specifically to accommodate this kind of automated, high-volume ingestion pattern, suggesting that OnlineLearning's requirements were a primary driver behind the storage layer's evolution.

## Implementation Details

The pipeline's inputs are heterogeneous — git history, LSL session logs, and code analysis output — implying an aggregation or normalization step that transforms disparate raw signals into a common entity schema before they reach the VKB server's persistence API. No specific class or function names for this batch pipeline are documented, indicating it is treated as an external process relative to the graph runtime itself, communicating only through VKB's exposed operations rather than internal APIs.

Downstream, `code-graph-agent.ts` is described as consuming VKB-exposed entity operations rather than accessing storage directly. Since code analysis output is one of OnlineLearning's ingestion sources, code-graph-agent.ts likely sits on both sides of this pipeline conceptually — as a contributor of raw analysis data and/or a consumer of resulting graph entities — though it interacts with everything strictly through the VKB abstraction layer rather than touching OnlineLearning's storage directly.

A distinguishing implementation detail is that OnlineLearning entities are subject to decay tracking logic centralized in the VKB server. This decay mechanism is what structurally separates OnlineLearning entities from manually curated ones: automatically extracted knowledge is presumed to have a shelf life or confidence level that erodes over time, requiring the VKB server to track and apply this decay uniformly across all such entities.

![OnlineLearning — Relationship](images/online-learning-relationship.png)

## Integration Points

OnlineLearning's primary integration point is the VKB server, inherited directly from its parent KnowledgeManagement component. All entity writes flow through VKB's persistence operations, and any schema changes affecting automatically extracted entity types must be coordinated through the VKB server as the single point of consistency enforcement — no ad-hoc script access is permitted.

Its sibling, ManualLearning, shares this same integration contract, writing through identical VKB persistence operations despite representing a different provenance (human-curated vs. automated). This shared interface suggests the VKB server's entity persistence API is provenance-agnostic at the write layer, while downstream logic (like decay tracking) differentiates behavior based on entity origin. code-graph-agent.ts represents another integration point, consuming entities via VKB rather than reaching into OnlineLearning's underlying data directly, reinforcing the storage-decoupling principle throughout the system.

## Usage Guidelines

Developers extending or modifying OnlineLearning's ingestion sources (git history, LSL logs, code analysis) should never bypass the VKB server to write entities directly — doing so would break the decoupling contract and could interfere with centralized decay tracking. Any change to the schema of automatically extracted entity types must be coordinated through the VKB server, since it is documented as the required choke point for such changes.

Because decay tracking is centralized and specific to OnlineLearning-style entities, developers should be mindful that these entities are not intended for permanent, static storage the way ManualLearning entities might be — consumers of this data (such as code-graph-agent.ts) should account for the possibility that entity relevance or confidence degrades over time. When debugging or extending the batch pipeline, refer to `docs/architecture/memory-systems.md` as the authoritative source on ingestion and persistence flow.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- [LLM] The KnowledgeManagement component centers on a graph-based knowledge storage architecture (documented in docs/architecture/memory-systems.md) that replaced or augments a prior LevelDB-based store. The VKB (Virtual Knowledge Base) server acts as the primary runtime interface for querying and mutating the graph, exposing entity persistence operations that downstream agents (like code-graph-agent.ts) rely on rather than talking to the storage layer directly. This separation of concerns means the VKB server is the single choke point for consistency guarantees, caching, and decay tracking logic, so any schema change to entities must be coordinated through it rather than through ad-hoc script access.

### Siblings
- [ManualLearning](./ManualLearning.md) -- ManualLearning entities are persisted through the VKB server's entity persistence operations rather than via direct storage writes, per docs/architecture/memory-systems.md


---

*Generated from 6 observations*
