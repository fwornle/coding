# LegacyOntologyAdapter

**Type:** SubComponent

`LegacyOntologyAdapter` wraps `OntologyRegistry` from `@fwornle/km-core`, acting as an anti-corruption layer so that the legacy interface expected by `OntologyValidator` and `OntologyClassifier` is preserved even as the underlying registry implementation evolves

# LegacyOntologyAdapter — Technical Reference

## What It Is

`LegacyOntologyAdapter` is a SubComponent of the SemanticAnalysis MCP server (`integrations/mcp-server-semantic-analysis`), housed within the broader Ontology component alongside `OntologyConfigManager` and the `OntologyClassificationAgent` lifecycle. Its singular responsibility is to wrap `OntologyRegistry` from `@fwornle/km-core` and re-expose it through the legacy interface that `OntologyValidator` and `OntologyClassifier` were originally written against — shielding those consumers from any evolution in the upstream `km-core` package.

The adapter itself contains one child component, AntiCorruptionLayerWrapper, which is where the actual translation mechanics live. Together, `LegacyOntologyAdapter` and its inner `AntiCorruptionLayerWrapper` form a two-layer containment boundary: the outer adapter establishes the contract boundary visible to call sites, while the inner wrapper performs the field-name and method-signature mapping work.

---

## Architecture and Design

![LegacyOntologyAdapter — Architecture](images/legacy-ontology-adapter-architecture.png)

The dominant pattern here is the **Adapter / Anti-Corruption Layer (ACL)**, a technique drawn from Domain-Driven Design. The intent is explicit: `OntologyValidator` and `OntologyClassifier` were written against a stable internal interface, and that interface is now preserved artificially by `LegacyOntologyAdapter` even as `OntologyRegistry` inside `@fwornle/km-core` continues to evolve independently. The ACL ensures that no upstream change to `km-core` can propagate as a breaking change into the classification and validation logic without an explicit, deliberate update to the adapter itself.

This mirrors a known precedent in the codebase: the Phase 42.x `KmCoreAdapter` storage migration, where the same shim strategy was used to preserve legacy field names and method signatures at the storage call sites while replacing `GraphDatabaseAdapter` and `PersistenceAgent` with the newer `KmCoreAdapter` surface. The repetition of this pattern across both the storage and ontology subsystems suggests it is an established architectural convention within this project — when a backing dependency must be modernized, a thin adapter shim absorbs the delta rather than cascading changes through all consumers.

![LegacyOntologyAdapter — Relationship](images/legacy-ontology-adapter-relationship.png)

A notable structural trade-off of this approach is the introduction of an indirection layer that must be actively maintained. Every future `OntologyRegistry` API change requires a corresponding update to `LegacyOntologyAdapter` before it can be used. This is intentional: the friction is the feature. The adapter makes upstream changes *visible* at a single point rather than silently diffusing them across every `OntologyValidator` and `OntologyClassifier` call site.

---

## Implementation Details

The adapter delegates initialization to the `OntologyRegistry` side of `@fwornle/km-core` — most likely through a call equivalent to `OntologyRegistry.load()`. This is a lifecycle-critical detail: because `OntologyClassificationAgent` drives the initialize → classify → suggest-extensions sequence, `LegacyOntologyAdapter` must complete its initialization handshake before any entity reaches the classify phase. A failure at initialization would block the entire downstream classification pipeline, including the attachment of `OntologyMetadata` (class, confidence, method, version) that every entity requires before persistence.

The AntiCorruptionLayerWrapper child component handles the mechanical translation — mapping legacy field names and method signatures to their modern `km-core` equivalents. This decomposition keeps the outer `LegacyOntologyAdapter` focused on lifecycle and interface contract, while the inner wrapper owns the mapping table. When `OntologyRegistry` changes a method name or restructures a return shape, the change is absorbed inside `AntiCorruptionLayerWrapper` without touching the adapter's public surface.

Because no code symbols or key files were resolvable from static analysis (0 symbols found), the exact method signatures and field mappings within `AntiCorruptionLayerWrapper` are not enumerable from this analysis. The behavioral contract, however, is well-established by the observations: the adapter's output must satisfy `OntologyValidator` and `OntologyClassifier` exactly as if they were calling a native legacy registry directly.

---

## Integration Points

`LegacyOntologyAdapter` sits at the intersection of two dependency chains. Upstream, it depends on `@fwornle/km-core`'s `OntologyRegistry` — an external package boundary that represents the only point of exposure to km-core's evolution. Downstream, it is consumed by `OntologyValidator` and `OntologyClassifier`, both of which are wholly ignorant of `OntologyRegistry`'s actual API; they program entirely against the legacy interface the adapter exposes.

Within the SemanticAnalysis pipeline, the adapter's lifecycle is governed by `OntologyClassificationAgent`, which is itself one of the sequenced agents in the batch-analysis pipeline managed by the parent SemanticAnalysis component. The Ontology sibling grouping — which includes `OntologyClassificationAgent` and the singleton `OntologyConfigManager` — collectively owns the classification concern. `LegacyOntologyAdapter` is the infrastructure underpinning of that group, providing the registry access that the agent and classifier logic require.

The Insights sibling component, operating as the final pipeline stage on fully classified entities, is indirectly dependent on `LegacyOntologyAdapter` being healthy: if the adapter fails to initialize or returns malformed ontology data, the `OntologyMetadata` attached to entities will be incomplete or missing, corrupting the inputs that Insights generation consumes. This makes `LegacyOntologyAdapter` a silent upstream dependency of the entire post-classification pipeline.

---

## Usage Guidelines

**Initialization must precede classification.** Any code path that triggers `OntologyClassificationAgent`'s classify phase must guarantee that `LegacyOntologyAdapter` has successfully completed initialization. Skipping or deferring this step will cause classification to operate against an unloaded registry, producing silent failures or incorrect ontology assignments that will only surface during Insights generation or persistence validation.

**Test isolation via mock substitution.** Because `OntologyValidator` and `OntologyClassifier` depend only on the legacy interface, unit tests for those components should substitute a mock adapter rather than instantiating a live `OntologyRegistry`. This is an explicitly supported pattern — it is one of the stated design goals of the ACL. Tests that instantiate a real `OntologyRegistry` are testing more than intended and introduce a hard `@fwornle/km-core` dependency into the unit test surface. The `OntologyConfigManager` singleton's `reset()` method (noted in the sibling context) provides a complementary mechanism for restoring configuration state between tests without process restarts.

**Changes to `@fwornle/km-core` must be absorbed at the adapter boundary.** When `OntologyRegistry` changes — whether a method rename, a return-type restructure, or a new initialization contract — the correct point of intervention is `AntiCorruptionLayerWrapper`, not the consumers. Updating `OntologyValidator` or `OntologyClassifier` directly in response to upstream `km-core` changes would defeat the entire purpose of the ACL and re-expose those components to future churn.

**Treat the adapter's legacy interface as a formal contract.** Because the field names and method signatures preserved by `LegacyOntologyAdapter` are the interface that downstream components were built against, any modification to that surface is a breaking change for `OntologyValidator` and `OntologyClassifier`. Such changes require coordinated updates across all consumers and should be treated with the same care as a public API version bump.


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component is a multi-agent MCP server (`integrations/mcp-server-semantic-analysis`) that orchestrates a batch-analysis pipeline over git history and LSL (vibe) sessions to extract, classify, validate, and persist structured knowledge entities. It coordinates several specialized agents in sequence: git history ingestion, vibe/LSL session ingestion, AST-based code graph construction, semantic LLM analysis, ontology classification, content validation, and insight generation. Each agent is built on a shared `BaseAgent<TInput, TOutput>` abstract class that wraps execution in a standardized `AgentResponse` envelope with confidence scoring, issue detection, routing suggestions, and retry guidance.

The pipeline uses an ontology system backed by `@fwornle/km-core`'s `OntologyRegistry` (accessed via a `LegacyOntologyAdapter` shim) to classify extracted observations into upper/lower ontology classes with configurable heuristic and LLM-assisted classification modes. The `OntologyClassificationAgent` manages lifecycle (initialize → classify → suggest extensions) and attaches `OntologyMetadata` (class, confidence, method, version) to every entity before persistence. Storage was migrated from a legacy `GraphDatabaseAdapter`+`PersistenceAgent` trio to a `KmCoreAdapter` surface in Phase 42.x, with field names preserved for minimal call-site disruption.

Key cross-cutting concerns include: LLM calls routed through `@rapid/llm-proxy`'s `LLMService` with token usage telemetry via `attachTokenLogger`; optional code-graph-rag integration via `CodeGraphAgent` (Tree-sitter AST + Memgraph) that gracefully degrades when the `uv` CLI or Memgraph TCP connection is unavailable; content staleness detection combining reference-pattern regex scanning and git-commit correlation via `GitStalenessDetector`; and trace files written to `logs/` for debugging non-fatally.

### Children
- [AntiCorruptionLayerWrapper](./AntiCorruptionLayerWrapper.md) -- Based on the parent context, LegacyOntologyAdapter acts as an anti-corruption layer (a DDD pattern) ensuring OntologyValidator and OntologyClassifier never directly depend on @fwornle/km-core's OntologyRegistry, isolating them from upstream API changes.

### Siblings
- [Pipeline](./Pipeline.md) -- All pipeline agents extend the shared `BaseAgent<TInput, TOutput>` abstract class, which wraps execution in a standardized `AgentResponse` envelope carrying confidence scores, detected issues, routing suggestions, and retry guidance
- [Ontology](./Ontology.md) -- `OntologyClassificationAgent` manages a three-phase lifecycle — initialize → classify → suggest extensions — ensuring the ontology registry is ready before any entity is classified and can propose new classes when observed entities don't fit existing ones
- [Insights](./Insights.md) -- Insight generation is the final sequential stage in the pipeline, operating on fully classified and validated entities produced by upstream agents, making it dependent on the complete ontology metadata attached by `OntologyClassificationAgent`
- [OntologyConfigManager](./OntologyConfigManager.md) -- `OntologyConfigManager` is implemented as a singleton, meaning all agents and subsystems within a process share one configuration state; the explicit `reset()` method exists specifically to restore defaults between unit tests without restarting the process


---

*Generated from 4 observations*
