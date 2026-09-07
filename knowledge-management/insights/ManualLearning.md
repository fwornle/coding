# ManualLearning

**Type:** SubComponent

Human-authored observations are stored alongside automatically extracted ones in the same graph schema, requiring a provenance/source field to distinguish manual vs. online-learned entities

# ManualLearning — Technical Insight Document

## What It Is

ManualLearning represents one of two knowledge provenance categories within the graph-based storage architecture documented in `docs/architecture/memory-systems.md`. It captures human-authored observations that are entered directly into the knowledge graph, as opposed to knowledge derived through automated extraction. As a SubComponent of KnowledgeManagement, ManualLearning entities are persisted exclusively through the VKB server's entity persistence operations rather than through direct storage writes — meaning there is no separate storage backend or schema for manually entered knowledge. Instead, human-authored observations live in the same graph schema as automatically extracted entities, distinguished at the data level by a provenance/source field rather than by structural separation.

![ManualLearning — Architecture](images/manual-learning-architecture.png)

## Architecture and Design

The defining architectural decision for ManualLearning is its bypass of the batch analysis pipeline entirely. Where its sibling, OnlineLearning, produces entities through a multi-stage pipeline ingesting git history, LSL session logs, and code analysis output, ManualLearning instead goes straight through the VKB server's mutation interface. This is a deliberate "fast path" design: manual edits don't need transformation, correlation, or extraction logic — they're already structured knowledge supplied by a human — so routing them through the same pipeline as automated learning would add unnecessary latency and complexity.

This design reinforces the parent KnowledgeManagement component's principle that the VKB server is the single choke point for all entity mutations, regardless of provenance. Both ManualLearning and OnlineLearning converge on the same persistence interface, preserving consistency guarantees and caching behavior uniformly across provenance types, even though their upstream paths to that interface are entirely different (direct mutation vs. batch pipeline output).

## Implementation Details

Because Manual and automated entities share a unified graph schema, the schema itself must carry a provenance/source field to distinguish which entities were manually authored versus online-learned. This is the primary mechanism enabling coexistence: rather than segregating storage, the system tags data at the entity level. No dedicated code symbols or classes for ManualLearning were identified in the current codebase inventory, suggesting that "ManualLearning" as a concept is currently realized more as a data-provenance pattern and a code path (the VKB mutation interface) than as a distinct module or class hierarchy.

A significant implementation gap flagged by the observations concerns decay tracking. Auto-extracted knowledge is subject to decay tracking logic (likely used to age out or deprioritize stale automated inferences), but manual entities skip this logic since they never pass through the batch pipeline where such tracking is presumably applied. This means manually authored knowledge likely requires separate handling to avoid premature pruning — an explicit design risk rather than a solved problem, based on current observations.

## Integration Points

ManualLearning integrates with the rest of the system almost entirely through the VKB server, which is also the persistence interface used by KnowledgeManagement broadly and consumed by downstream agents such as code-graph-agent.ts. Because ManualLearning entities share the same graph schema as OnlineLearning entities, any query or consumer operating over the knowledge graph must be aware of the provenance field to properly interpret or filter manually authored versus automatically learned facts.

![ManualLearning — Relationship](images/manual-learning-relationship.png)

The relationship to OnlineLearning is one of schema-sharing and interface-sharing but pipeline-divergence: both are governed by the same graph-based storage architecture and both ultimately persist through VKB server operations, but only OnlineLearning passes through the batch analysis pipeline (git history, LSL session logs, code analysis output). This makes ManualLearning the "direct write" counterpart to OnlineLearning's "derived write" model within the same parent system.

## Usage Guidelines

Developers working with manually entered knowledge should ensure the provenance/source field is correctly set whenever writing through the VKB mutation interface, since this is the only mechanism distinguishing manual entities from auto-extracted ones in the shared schema. Any tooling or query logic that filters, ranks, or ages knowledge should explicitly account for the fact that manual entities do not carry decay tracking metadata — treating them uniformly with auto-extracted entities in decay-based pruning logic risks either incorrectly preserving stale automated knowledge or, more importantly, incorrectly pruning valid human-curated knowledge that was never designed to decay in the same way.

Given the absence of dedicated code symbols for this subcomponent, future implementation work should focus on formalizing decay/retention handling for manually authored entities and, if warranted, introducing explicit code-level constructs (classes, functions) rather than relying solely on the implicit "goes straight through the mutation interface" pathway. Any schema changes affecting the provenance field must be coordinated through the VKB server, consistent with the parent KnowledgeManagement component's rule that the VKB server is the single choke point for schema and consistency guarantees.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- [LLM] The KnowledgeManagement component centers on a graph-based knowledge storage architecture (documented in docs/architecture/memory-systems.md) that replaced or augments a prior LevelDB-based store. The VKB (Virtual Knowledge Base) server acts as the primary runtime interface for querying and mutating the graph, exposing entity persistence operations that downstream agents (like code-graph-agent.ts) rely on rather than talking to the storage layer directly. This separation of concerns means the VKB server is the single choke point for consistency guarantees, caching, and decay tracking logic, so any schema change to entities must be coordinated through it rather than through ad-hoc script access.

### Siblings
- [OnlineLearning](./OnlineLearning.md) -- OnlineLearning entities are produced by a batch analysis pipeline that ingests git history, LSL session logs, and code analysis output as documented in docs/architecture/memory-systems.md


---

*Generated from 5 observations*
