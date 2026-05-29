# OntologyConfigManager

**Type:** SubComponent

`OntologyConfigManager` is implemented as a singleton, meaning all agents and subsystems within a process share one configuration state; the explicit `reset()` method exists specifically to restore defaults between unit tests without restarting the process

# OntologyConfigManager — Technical Reference

## What It Is

`OntologyConfigManager` is a singleton configuration hub living inside the `SemanticAnalysis` component (`integrations/mcp-server-semantic-analysis`). It serves as the single authoritative source for every tunable parameter that governs ontology loading and classification behavior: the file-system paths to upper and lower ontology definition files, classification confidence thresholds, and the LLM token-budget cap consulted by `OntologyClassificationAgent`. Because it is a singleton, every agent and subsystem sharing a process sees the same configuration state — a deliberate design choice that makes cross-agent behavior predictable without requiring each agent to independently read or negotiate configuration.

![OntologyConfigManager — Architecture](images/ontology-config-manager-architecture.png)

## Architecture and Design

The dominant pattern is the **singleton with explicit test-reset**, captured in the child component `SingletonResetPattern`. The singleton ensures that runtime configuration changes — such as swapping ontology file paths or adjusting a confidence threshold — propagate immediately to all consumers without passing a config object through every call chain. The trade-off accepted here is that global mutable state requires discipline: any agent that modifies configuration affects every other agent in the same process. The `reset()` method exists precisely to contain this risk in testing contexts, restoring defaults between unit tests without a full process restart.

The design also embeds **hot-reload** semantics. Ontology definition files can be updated on disk and picked up by the running MCP server process, which is especially valuable during iterative ontology development sessions where an analyst is actively refining the upper/lower ontology hierarchy. This means `OntologyConfigManager` must hold not just the path strings but also the reload trigger mechanism — making it responsible for both path configuration and file-watching lifecycle.

![OntologyConfigManager — Relationship](images/ontology-config-manager-relationship.png)

The placement of `OntologyConfigManager` inside `SemanticAnalysis` — as a sibling to `Pipeline`, `Ontology`, `Insights`, and `LegacyOntologyAdapter` — reflects a deliberate separation: pipeline execution logic and classification logic are kept independent of configuration concerns. `OntologyClassificationAgent` (the core of the `Ontology` sibling component) consults `OntologyConfigManager` for its LLM budget cap and confidence thresholds but contains no hardcoded tuning values itself.

## Implementation Details

**Ontology file path ownership.** `OntologyConfigManager` holds the canonical paths to both the upper and lower ontology definition files. This indirection means that changing where ontology definitions live requires modifying only this manager, not the agents or the `LegacyOntologyAdapter` shim that wraps `@fwornle/km-core`'s `OntologyRegistry`. The `LegacyOntologyAdapter` benefits from this because it can load or reload registry content by querying `OntologyConfigManager` for the current paths rather than embedding them in adapter logic.

**Classification thresholds.** The minimum confidence score required to accept a heuristic classification — as opposed to escalating to an LLM-assisted call — lives here. This is a significant design decision: by centralizing this threshold, the system allows <USER_ID_REDACTED> tuning to happen in one place rather than being scattered across individual agent implementations. The `OntologyClassificationAgent`'s three-phase lifecycle (initialize → classify → suggest extensions) depends on this threshold to decide, during the classify phase, whether heuristic confidence is sufficient or whether an LLM call is warranted.

**LLM budget cap.** The token-spend ceiling stored in `OntologyConfigManager` acts as a guard consulted by `OntologyClassificationAgent` before each LLM-assisted classification call. This is particularly important during large batch runs over git history or vibe/LSL sessions, where the number of entities requiring classification can be large. Without this cap, LLM calls routed through `@rapid/llm-proxy`'s `LLMService` (with token usage telemetry via `attachTokenLogger`) could accumulate unbounded cost.

**The `SingletonResetPattern`.** The explicit `reset()` method is a concession to testability. Because the singleton is process-wide, tests that modify thresholds, paths, or budget caps would otherwise pollute subsequent tests. `reset()` makes the singleton safe to use in unit test suites without forking processes.

## Integration Points

`OntologyConfigManager` sits at the intersection of three active consumers within `SemanticAnalysis`:

1. **`OntologyClassificationAgent`** (via the `Ontology` component) — reads the confidence threshold to decide heuristic-vs-LLM routing, and reads the LLM budget cap before spending tokens.
2. **`LegacyOntologyAdapter`** — depends on the file paths owned by `OntologyConfigManager` to load upper and lower ontology definitions into the `OntologyRegistry` from `@fwornle/km-core`.
3. **The `Insights` component** — indirectly dependent, because insight generation operates on entities that carry `OntologyMetadata` (class, confidence, method, version) attached by `OntologyClassificationAgent`. If classification thresholds are misconfigured, the <USER_ID_REDACTED> of metadata flowing into insight generation degrades.

The hot-reload capability connects `OntologyConfigManager` to the MCP server process lifecycle: ontology file changes on disk can be absorbed without a server restart, making `OntologyConfigManager` a runtime configuration surface rather than a purely startup-time one.

## Usage Guidelines

**Treat threshold and budget values as operational levers, not code constants.** Because all classification <USER_ID_REDACTED> and cost control flows through `OntologyConfigManager`, tuning a batch run's LLM spend or adjusting classification confidence requires only changing values here — no agent code needs to change. This is the intended extension point for operational adjustments.

**Never modify singleton state in shared test fixtures without calling `reset()`.** The `SingletonResetPattern` exists for this reason. Any test that changes paths, thresholds, or budget caps must call `reset()` in teardown, or it risks silently affecting unrelated tests running in the same process.

**Ontology file path changes take effect on hot-reload, not immediately.** Agents already mid-classification will use the paths active at the time their classify phase began. Hot-reload is designed for iterative development between runs, not for swapping ontology definitions mid-batch.

**The LLM budget cap is a hard guard, not a soft warning.** `OntologyClassificationAgent` consults it before making calls, meaning entities that would exceed the cap fall back to heuristic classification (or are skipped for LLM escalation). During large batch analyses, set this value deliberately rather than leaving it at a default — the token telemetry via `attachTokenLogger` in `LLMService` can inform appropriate values from prior runs.


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component is a multi-agent MCP server (`integrations/mcp-server-semantic-analysis`) that orchestrates a batch-analysis pipeline over git history and LSL (vibe) sessions to extract, classify, validate, and persist structured knowledge entities. It coordinates several specialized agents in sequence: git history ingestion, vibe/LSL session ingestion, AST-based code graph construction, semantic LLM analysis, ontology classification, content validation, and insight generation. Each agent is built on a shared `BaseAgent<TInput, TOutput>` abstract class that wraps execution in a standardized `AgentResponse` envelope with confidence scoring, issue detection, routing suggestions, and retry guidance.

The pipeline uses an ontology system backed by `@fwornle/km-core`'s `OntologyRegistry` (accessed via a `LegacyOntologyAdapter` shim) to classify extracted observations into upper/lower ontology classes with configurable heuristic and LLM-assisted classification modes. The `OntologyClassificationAgent` manages lifecycle (initialize → classify → suggest extensions) and attaches `OntologyMetadata` (class, confidence, method, version) to every entity before persistence. Storage was migrated from a legacy `GraphDatabaseAdapter`+`PersistenceAgent` trio to a `KmCoreAdapter` surface in Phase 42.x, with field names preserved for minimal call-site disruption.

Key cross-cutting concerns include: LLM calls routed through `@rapid/llm-proxy`'s `LLMService` with token usage telemetry via `attachTokenLogger`; optional code-graph-rag integration via `CodeGraphAgent` (Tree-sitter AST + Memgraph) that gracefully degrades when the `uv` CLI or Memgraph TCP connection is unavailable; content staleness detection combining reference-pattern regex scanning and git-commit correlation via `GitStalenessDetector`; and trace files written to `logs/` for debugging non-fatally.

### Children
- [SingletonResetPattern](./SingletonResetPattern.md) -- Per parent context, all agents and subsystems within a process share one OntologyConfigManager instance, meaning configuration changes made by one agent are visible to all others in the same process.

### Siblings
- [Pipeline](./Pipeline.md) -- All pipeline agents extend the shared `BaseAgent<TInput, TOutput>` abstract class, which wraps execution in a standardized `AgentResponse` envelope carrying confidence scores, detected issues, routing suggestions, and retry guidance
- [Ontology](./Ontology.md) -- `OntologyClassificationAgent` manages a three-phase lifecycle — initialize → classify → suggest extensions — ensuring the ontology registry is ready before any entity is classified and can propose new classes when observed entities don't fit existing ones
- [Insights](./Insights.md) -- Insight generation is the final sequential stage in the pipeline, operating on fully classified and validated entities produced by upstream agents, making it dependent on the complete ontology metadata attached by `OntologyClassificationAgent`
- [LegacyOntologyAdapter](./LegacyOntologyAdapter.md) -- `LegacyOntologyAdapter` wraps `OntologyRegistry` from `@fwornle/km-core`, acting as an anti-corruption layer so that the legacy interface expected by `OntologyValidator` and `OntologyClassifier` is preserved even as the underlying registry implementation evolves


---

*Generated from 5 observations*
