# Ontology

**Type:** SubComponent

`OntologyClassificationAgent` manages a three-phase lifecycle — initialize → classify → suggest extensions — ensuring the ontology registry is ready before any entity is classified and can propose new classes when observed entities don't fit existing ones

# Ontology

## What It Is

The Ontology subsystem is a classification and metadata layer within SemanticAnalysis (`integrations/mcp-server-semantic-analysis`) responsible for assigning every extracted knowledge entity a structured ontological identity before it is persisted or consumed by downstream stages like Insights. It operates through `OntologyClassificationAgent`, which drives a three-phase lifecycle, backed by an external registry accessed via `LegacyOntologyAdapter`, and configured through the singleton `OntologyConfigManager`.

![Ontology — Architecture](images/ontology-architecture.png)

Its purpose is narrow and well-bounded: take an entity produced by upstream pipeline agents, determine which ontology class it belongs to, record the confidence and method of that determination, and flag it if its source content is stale. The result is an `OntologyMetadata` record attached to the entity that carries the full audit context needed by validation, insight generation, and eventual persistence.

## Architecture and Design

The dominant architectural pattern here is a **guarded lifecycle with an anti-corruption adapter**. The `OntologyClassificationAgent` enforces an `initialize → classify → suggest extensions` sequence — the initialize phase must complete before any classification is attempted. This guard pattern, documented in `docs/architecture/adding-new-agent.md` and formalized in the child component ThreePhaseOntologyLifecycle, prevents classification against an unloaded or partially loaded registry and is consistent with how all pipeline agents are structured through the shared `BaseAgent<TInput, TOutput>` contract.

The anti-corruption layer is `LegacyOntologyAdapter`, which wraps `@fwornle/km-core`'s `OntologyRegistry` and presents the interface that `OntologyValidator` and `OntologyClassifier` were written against. This isolates both components from future changes in the upstream registry implementation — a deliberate trade-off that accepts a shim layer in exchange for zero call-site rewrites on the consumer side. This same adapter is what makes `OntologyConfigManager` (a sibling component) the single point of configuration truth: class hierarchy file paths, LLM mode toggles, and budget caps are all resolved at the config layer and never hard-coded into classifiers or validators.

A second notable design decision is the **dual-mode classification strategy**: heuristic pattern matching for speed, LLM-assisted classification for accuracy, with a configurable budget cap on LLM calls. This makes cost a first-class design concern rather than an operational afterthought. The budget cap is configured through `OntologyConfigManager`, which is a singleton — all agents in a process share one configuration state, with an explicit `reset()` method for test isolation.

![Ontology — Relationship](images/ontology-relationship.png)

## Implementation Details

`OntologyClassificationAgent` is the central orchestrator. In the **initialize** phase it loads the ontology hierarchy — upper and lower class definitions — from file paths specified in `OntologyConfigManager`, meaning the hierarchy is externally editable without code changes. This is a significant maintainability affordance: new domain concepts can be introduced by editing configuration files rather than touching classifier logic.

In the **classify** phase, each entity passes through either heuristic or LLM-assisted classification, producing an `OntologyMetadata` record with four fields: ontology class, confidence score, classification method (`heuristic` or `llm`), and ontology version. The version field is particularly important for downstream auditability — the Insights stage, which operates on fully classified entities, can inspect which ontology snapshot was in effect when a given entity was classified.

Before classification, `GitStalenessDetector` runs a two-pronged staleness check: reference-pattern regex scanning to identify structurally outdated content, combined with git-commit correlation to confirm whether the source has actually changed. Entities flagged as stale are prevented from entering classification, keeping the ontology registry clean of observations that may no longer reflect the codebase's current state.

In the **suggest extensions** phase, entities that don't map cleanly to existing ontology classes surface as proposed new classes. This closes a feedback loop — the ontology can evolve in response to observed reality rather than requiring manual discovery of gaps.

## Integration Points

The Ontology subsystem sits between the semantic LLM analysis stage and the Insights generation stage in the SemanticAnalysis pipeline. It receives unclassified entities from upstream agents and emits `OntologyMetadata`-annotated entities consumed by Insights and the persistence layer. Its dependency on `@fwornle/km-core`'s `OntologyRegistry` is fully mediated by `LegacyOntologyAdapter` — no other component in the ontology subsystem imports from `@fwornle/km-core` directly.

LLM calls made during the LLM-assisted classification mode are routed through `@rapid/llm-proxy`'s `LLMService`, consistent with the parent SemanticAnalysis component's cross-cutting approach to LLM access with token usage telemetry via `attachTokenLogger`. The budget cap in `OntologyConfigManager` therefore acts in concert with telemetry infrastructure rather than replacing it.

`OntologyConfigManager` is shared as a singleton with sibling pipeline agents. Because it holds mutable state (mode selection, file paths, budget cap), the `reset()` method is the designated mechanism for test isolation — developers must call it between tests rather than instantiating fresh config objects.

## Usage Guidelines

**Lifecycle ordering is non-negotiable.** The initialize phase must complete before any classify call. Skipping or parallelizing initialization against classification will result in classification against an unloaded registry. ThreePhaseOntologyLifecycle formalizes this constraint, and the pattern is documented in `docs/architecture/adding-new-agent.md`.

**Ontology hierarchy is file-driven.** Upper and lower class definitions are loaded from paths in `OntologyConfigManager`. When introducing new domain concepts, edit those files rather than modifying classifier code. This is the intended extension mechanism and keeps the class hierarchy auditable outside the codebase.

**LLM mode carries a real cost.** The budget cap exists precisely because LLM calls are expensive at scale. Set it conservatively in batch pipeline runs and use heuristic mode as the default unless accuracy requirements justify the cost. Monitor token telemetry via `attachTokenLogger` to calibrate the cap over time.

**Stale content is excluded, not corrected.** `GitStalenessDetector` flags and drops stale observations before classification — it does not attempt to refresh or re-derive them. If entities are being unexpectedly excluded from classification, the staleness detector's regex patterns and git-correlation thresholds in `OntologyConfigManager` are the first place to inspect.

**Test isolation requires explicit reset.** Because `OntologyConfigManager` is a singleton, tests that modify configuration must call `reset()` on teardown. Failing to do so will cause configuration bleed between test cases in the same process, which can produce non-deterministic classification behavior that is difficult to trace.


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component is a multi-agent MCP server (`integrations/mcp-server-semantic-analysis`) that orchestrates a batch-analysis pipeline over git history and LSL (vibe) sessions to extract, classify, validate, and persist structured knowledge entities. It coordinates several specialized agents in sequence: git history ingestion, vibe/LSL session ingestion, AST-based code graph construction, semantic LLM analysis, ontology classification, content validation, and insight generation. Each agent is built on a shared `BaseAgent<TInput, TOutput>` abstract class that wraps execution in a standardized `AgentResponse` envelope with confidence scoring, issue detection, routing suggestions, and retry guidance.

The pipeline uses an ontology system backed by `@fwornle/km-core`'s `OntologyRegistry` (accessed via a `LegacyOntologyAdapter` shim) to classify extracted observations into upper/lower ontology classes with configurable heuristic and LLM-assisted classification modes. The `OntologyClassificationAgent` manages lifecycle (initialize → classify → suggest extensions) and attaches `OntologyMetadata` (class, confidence, method, version) to every entity before persistence. Storage was migrated from a legacy `GraphDatabaseAdapter`+`PersistenceAgent` trio to a `KmCoreAdapter` surface in Phase 42.x, with field names preserved for minimal call-site disruption.

Key cross-cutting concerns include: LLM calls routed through `@rapid/llm-proxy`'s `LLMService` with token usage telemetry via `attachTokenLogger`; optional code-graph-rag integration via `CodeGraphAgent` (Tree-sitter AST + Memgraph) that gracefully degrades when the `uv` CLI or Memgraph TCP connection is unavailable; content staleness detection combining reference-pattern regex scanning and git-commit correlation via `GitStalenessDetector`; and trace files written to `logs/` for debugging non-fatally.

### Children
- [ThreePhaseOntologyLifecycle](./ThreePhaseOntologyLifecycle.md) -- Based on the parent context describing OntologyClassificationAgent, the initialize phase must complete before classify can be called, representing a guard pattern common in agent-based architectures documented in docs/architecture/adding-new-agent.md

### Siblings
- [Pipeline](./Pipeline.md) -- All pipeline agents extend the shared `BaseAgent<TInput, TOutput>` abstract class, which wraps execution in a standardized `AgentResponse` envelope carrying confidence scores, detected issues, routing suggestions, and retry guidance
- [Insights](./Insights.md) -- Insight generation is the final sequential stage in the pipeline, operating on fully classified and validated entities produced by upstream agents, making it dependent on the complete ontology metadata attached by `OntologyClassificationAgent`
- [OntologyConfigManager](./OntologyConfigManager.md) -- `OntologyConfigManager` is implemented as a singleton, meaning all agents and subsystems within a process share one configuration state; the explicit `reset()` method exists specifically to restore defaults between unit tests without restarting the process
- [LegacyOntologyAdapter](./LegacyOntologyAdapter.md) -- `LegacyOntologyAdapter` wraps `OntologyRegistry` from `@fwornle/km-core`, acting as an anti-corruption layer so that the legacy interface expected by `OntologyValidator` and `OntologyClassifier` is preserved even as the underlying registry implementation evolves


---

*Generated from 6 observations*
