# Insights

**Type:** SubComponent

Insight generation is the final sequential stage in the pipeline, operating on fully classified and validated entities produced by upstream agents, making it dependent on the complete ontology metadata attached by `OntologyClassificationAgent`

# Insights

## What It Is

Insights is a SubComponent of the SemanticAnalysis multi-agent MCP server (`integrations/mcp-server-semantic-analysis`), positioned as the **final sequential stage** of the batch-analysis pipeline. It operates exclusively on entities that have already been classified, validated, and annotated with `OntologyMetadata` by upstream agents — meaning it cannot begin execution until `OntologyClassificationAgent` has completed its full lifecycle (initialize → classify → suggest extensions) across all entities in scope.

The component carries at least three distinct responsibilities as described in the pipeline manifest: **insight generation**, **pattern catalog extraction**, and **knowledge report authoring**. These concerns are distinct enough to suggest separate classes or agent steps internally, though no concrete file paths or class names are surfaced in the available observations. Its child component, OntologyDrivenInsightGeneration, represents the core mechanism by which ontology metadata attached upstream is consumed to derive structured insights.

![Insights — Relationship](images/insights-relationship.png)

## Architecture and Design

Like every other agent in the SemanticAnalysis pipeline, Insights extends `BaseAgent<TInput, TOutput>` — the shared abstract base class that wraps execution in a standardized `AgentResponse` envelope. This means the insights it produces carry the same first-class metadata as observations produced by earlier stages: confidence scores, detected issues, routing suggestions, and retry guidance. Consumers of the pipeline can therefore treat generated insights with the same programmatic trust model applied to raw observations or classification results.

![Insights — Architecture](images/insights-architecture.png)

The three-responsibility structure (generation, pattern catalog extraction, report authoring) reflects a deliberate **separation of concerns** within what is already a late-stage, synthesis-focused component. Insight generation and pattern catalog extraction are likely structured or semi-structured outputs derived deterministically from ontology-annotated entities, while knowledge report authoring introduces a distinct LLM-assisted prose generation step. Routing these two modes of work through different execution paths — one potentially heuristic or rule-based, one LLM-driven — is consistent with how the broader pipeline distinguishes between classification modes (heuristic vs. LLM-assisted) in `OntologyClassificationAgent`.

The sequential dependency on upstream ontology classification is an explicit architectural constraint, not incidental. Because OntologyDrivenInsightGeneration (the child component) is described as ontology-driven by name, the `OntologyMetadata` bundle — carrying class, confidence, method, and version fields attached by `OntologyClassificationAgent` — is effectively the primary input contract for this stage.

## Implementation Details

The knowledge report authoring path routes LLM calls through `@rapid/llm-proxy`'s `LLMService`, with `attachTokenLogger` applied to instrument token consumption. This is the same LLM infrastructure used across the SemanticAnalysis pipeline, but the token logging attachment means insight narrative generation is **tracked as a distinct spend category** — separable in telemetry from classification token spend incurred by `OntologyClassificationAgent` or semantic analysis agents earlier in the pipeline. This separation supports cost attribution and budget analysis at a per-stage granularity.

The child component OntologyDrivenInsightGeneration is the concrete realization of the ontology-to-insight translation. Given that all entities entering this stage carry `OntologyMetadata` (class, confidence, method, version), the generation logic can make decisions conditioned on ontology class membership, confidence thresholds, and the classification method used (heuristic vs. LLM) — enabling differential treatment of high-confidence vs. tentative classifications when surfacing insights or building the pattern catalog.

No concrete file paths or class symbol names are available in the current observations. The three-responsibility decomposition (generation, pattern catalog, report authoring) should guide future code navigation: look for distinct classes or agent step implementations corresponding to each concern rather than a monolithic agent body.

## Integration Points

Insights sits at the downstream terminus of the SemanticAnalysis pipeline, making its integration surface primarily **inbound** rather than bidirectional. Its direct upstream dependency is `OntologyClassificationAgent`, which must fully complete before Insights can execute. The `OntologyMetadata` attached to every entity — class, confidence, method, version — constitutes the structured contract this component consumes.

On the output side, generated insights are returned in the standard `AgentResponse` envelope inherited from `BaseAgent<TInput, TOutput>`, making them consumable by any pipeline coordinator or downstream caller with the same interface used to consume outputs from Pipeline siblings. Storage of persisted knowledge entities uses the `KmCoreAdapter` surface (migrated from the legacy `GraphDatabaseAdapter`+`PersistenceAgent` trio in Phase 42.x), so persisted insights follow the same field-name conventions as other entity types to minimize call-site disruption.

The LLM report authoring path depends on `@rapid/llm-proxy`'s `LLMService` with `attachTokenLogger`, shared with other LLM-assisted agents in the system. The `LegacyOntologyAdapter` (wrapping `@fwornle/km-core`'s `OntologyRegistry`) is the anti-corruption layer that keeps ontology class resolution stable across registry evolution — Insights inherits this stability indirectly through the metadata already attached by `OntologyClassificationAgent`.

## Usage Guidelines

Because Insights is the terminal pipeline stage, **it must not be invoked before `OntologyClassificationAgent` has completed its full lifecycle**. Premature invocation would result in entities lacking `OntologyMetadata`, which would undermine the ontology-driven insight generation that the child component OntologyDrivenInsightGeneration is built around. Pipeline orchestration must enforce this ordering.

Developers extending or modifying Insights should respect the three-responsibility decomposition. Report authoring (prose generation via `LLMService`) and structural insight/pattern extraction are meaningfully different operations with different cost profiles and reliability characteristics. Conflating them risks both inflated token spend and reduced debuggability when LLM-generated narrative <USER_ID_REDACTED> degrades independently of structured output <USER_ID_REDACTED>.

Since `AgentResponse` carries confidence scores on generated insights, downstream consumers should treat low-confidence insights with the same caution applied to low-confidence classifications elsewhere in the pipeline. The `OntologyConfigManager` singleton governs classification configuration for the pipeline; if classification mode or thresholds are changed (e.g., in test scenarios using `reset()`), re-running the full pipeline including Insights is necessary to ensure insight output reflects the updated configuration rather than stale metadata.

---

**Architectural Patterns Identified:** Terminal-stage pipeline agent; separation of structured extraction from LLM-assisted prose generation; `AgentResponse` envelope for uniform consumer interface; token telemetry isolation via `attachTokenLogger`.

**Key Design Trade-offs:** Sequential dependency on upstream ontology classification introduces pipeline latency but guarantees insight <USER_ID_REDACTED> is bounded below by classification completeness. Routing report authoring through `LLMService` adds LLM cost at the final stage but enables rich narrative output that purely heuristic extraction cannot produce.

**Maintainability:** The three-responsibility structure, if implemented as distinct classes or steps, supports independent testing and replacement of each concern. The absence of concrete file paths in current observations is a gap — instrumentation or discovery work to surface actual class names would improve future navigability of this component.


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component is a multi-agent MCP server (`integrations/mcp-server-semantic-analysis`) that orchestrates a batch-analysis pipeline over git history and LSL (vibe) sessions to extract, classify, validate, and persist structured knowledge entities. It coordinates several specialized agents in sequence: git history ingestion, vibe/LSL session ingestion, AST-based code graph construction, semantic LLM analysis, ontology classification, content validation, and insight generation. Each agent is built on a shared `BaseAgent<TInput, TOutput>` abstract class that wraps execution in a standardized `AgentResponse` envelope with confidence scoring, issue detection, routing suggestions, and retry guidance.

The pipeline uses an ontology system backed by `@fwornle/km-core`'s `OntologyRegistry` (accessed via a `LegacyOntologyAdapter` shim) to classify extracted observations into upper/lower ontology classes with configurable heuristic and LLM-assisted classification modes. The `OntologyClassificationAgent` manages lifecycle (initialize → classify → suggest extensions) and attaches `OntologyMetadata` (class, confidence, method, version) to every entity before persistence. Storage was migrated from a legacy `GraphDatabaseAdapter`+`PersistenceAgent` trio to a `KmCoreAdapter` surface in Phase 42.x, with field names preserved for minimal call-site disruption.

Key cross-cutting concerns include: LLM calls routed through `@rapid/llm-proxy`'s `LLMService` with token usage telemetry via `attachTokenLogger`; optional code-graph-rag integration via `CodeGraphAgent` (Tree-sitter AST + Memgraph) that gracefully degrades when the `uv` CLI or Memgraph TCP connection is unavailable; content staleness detection combining reference-pattern regex scanning and git-commit correlation via `GitStalenessDetector`; and trace files written to `logs/` for debugging non-fatally.

### Children
- [OntologyDrivenInsightGeneration](./OntologyDrivenInsightGeneration.md) -- Based on the parent context, Insights operates as the final sequential stage in the SemanticAnalysis pipeline, meaning it cannot execute until OntologyClassificationAgent has completed attaching ontology metadata to all entities.

### Siblings
- [Pipeline](./Pipeline.md) -- All pipeline agents extend the shared `BaseAgent<TInput, TOutput>` abstract class, which wraps execution in a standardized `AgentResponse` envelope carrying confidence scores, detected issues, routing suggestions, and retry guidance
- [Ontology](./Ontology.md) -- `OntologyClassificationAgent` manages a three-phase lifecycle — initialize → classify → suggest extensions — ensuring the ontology registry is ready before any entity is classified and can propose new classes when observed entities don't fit existing ones
- [OntologyConfigManager](./OntologyConfigManager.md) -- `OntologyConfigManager` is implemented as a singleton, meaning all agents and subsystems within a process share one configuration state; the explicit `reset()` method exists specifically to restore defaults between unit tests without restarting the process
- [LegacyOntologyAdapter](./LegacyOntologyAdapter.md) -- `LegacyOntologyAdapter` wraps `OntologyRegistry` from `@fwornle/km-core`, acting as an anti-corruption layer so that the legacy interface expected by `OntologyValidator` and `OntologyClassifier` is preserved even as the underlying registry implementation evolves


---

*Generated from 4 observations*
