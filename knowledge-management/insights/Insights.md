# Insights

**Type:** SubComponent

[Code References] config/agents/copilot.sh:agent_pre_launch() - unsets inherited COPILOT_PROVIDER_* and defers BYOK wiring to configure_proxy_routing(); config/agents/opencode.sh:_oc_splice_config() - JSON fragment splicing helper avoiding trailing-comma bugs on empty config; config/agents/opencode.sh:_oc_variants / _oc_provider_entries - per-turn reasoningEffort band mapping (cheap/standard/deep); config/agents/pi.sh:_pi_install_extensions() - marker-guarded copy-not-symlink installation of pi-extensions/*.ts; config/agents/pi.sh:_pi_write_models_json() - writes openai-completions provider config pointed at LLM_CLI_PROXY_PORT (default 12435); config/agents/pi-extensions/no-unbounded-fs-scan.ts:offendingRoot()/findRoots() - parses `find` command roots to detect whole-filesystem scans; config/agents/pi-extensions/no-unbounded-fs-scan.ts:extension() default export - registers pi.on('tool_call', ...) fail-open guard; integrations/system-health-dashboard/src/components/agent-badge.tsx:AGENT_COLORS - legacy 'mastra' key retained for historical row fidelity

# Insights — Technical Reference

## What It Is

"Insights" is a cross-cutting concept in the codebase that spans multiple distinct layers: a knowledge-graph classification target within the SemanticAnalysis pipeline, a consolidation/synthesis primitive in the observation-processing subsystem, and a UI-facing feature gated behind access control. Concretely, it appears as `INSIGHTS` (class, `kb-ab-sample-tasks.mjs`), `synthesizeInsights` and `_relinkOrphanOnlineInsights` (methods on `ObservationConsolidator.js`), `handleGetInsights` (server.js API handler), `GatedInsights` (React component in `App.tsx`), and supporting utility functions like `deriveInsightSummary` (`backfill-insight-mentions.mjs`) and `readInsights` (`backfill.ts`). This diversity indicates "Insights" is not a single class but a domain concept implemented consistently across ingestion, consolidation, backfill/migration tooling, server APIs, and the React frontend.

![Insights — Architecture](images/insights-architecture.png)

## Architecture and Design

The dominant pattern is **consolidation-then-synthesis**: raw observations are aggregated and transformed into higher-level "insight" records via `ObservationConsolidator.synthesizeInsights`, with orphan-relinking logic (`_relinkOrphanOnlineInsights`) handling cases where insights lose their originating observation chain — a defensive pattern echoing the graceful-degradation philosophy noted in sibling components like L2SubsystemClassifier and the parent SemanticAnalysis pipeline. The consolidator also exposes legacy-shape adapters (`_toLegacyDigestRow`, `_toLegacyInsightRow`), showing a **legacy-compatibility mapping pattern** consistent with `AGENT_COLORS` retaining historical `'mastra'` entries in the dashboard — a recurring project convention of preserving backward-compatible read shapes while evolving internal representations.

On the frontend, `GatedInsights` (App.tsx) implements an **access-gating wrapper pattern**, controlling insight visibility likely tied to permissions or feature flags, and composes UI primitives imported from `clipboard-button.tsx`, `consolidation-progress.tsx` (`ConsolidationProgress`, `InflightInfo`), and `markdown-text.tsx` — indicating insights are rendered as rich, copyable, progress-aware content blocks in the dashboard UI, similar in spirit to `agent-badge.tsx` in the sibling dashboard components.

Server-side, `handleGetInsights` (server.js) and `analyzeSessionForInsights` (copilot-http-server.js) form a **request/analysis boundary**: one serves already-synthesized insights, the other performs live session analysis to derive them — mirroring the analysis/consumption split seen between SemanticAnalysisAgent and OntologyClassificationAgent in the parent pipeline.

## Implementation Details

Similarity and identity resolution appear central to insight synthesis: `_jaccard` and `_findSimilarInsightId` suggest insights are deduplicated or merged using Jaccard similarity over text/tag sets before being persisted, avoiding duplicate insight proliferation across consolidation runs. Supporting calls like `_forwardObsApi`, `readExport`, `makePreview`, `previewVersion`, and `_publishEmbeddingEvent` indicate the consolidator publishes embedding events (likely for downstream vector search) and generates previews/versions of insight content — implying insights are versioned artifacts with preview states before finalization. `_getSanitizer` further suggests insight text undergoes sanitization before storage or rendering, guarding against unsafe markdown/HTML given the `MarkdownText` rendering component.

`deriveInsightSummary` (backfill-insight-mentions.mjs) and `readInsights` (backfill.ts) point to a **migration/backfill toolchain** that retroactively computes insight summaries and mention linkages for historical data — a maintenance mechanism for keeping the knowledge graph consistent as the insight schema evolves, analogous to `_pi_install_extensions`'s marker-guarded, idempotent regeneration approach used elsewhere in the codebase.

## Integration Points

![Insights — Relationship](images/insights-relationship.png)

Insights sit downstream of SemanticAnalysis's classification pipeline (OntologyClassificationAgent, SemanticAnalysisAgent) as a consumer/synthesizer of classified observations, while also feeding the system-health-dashboard UI via `GatedInsights` and its imported components (`Badge`, `Button` from `system-health-dashboard/src/components/ui/`). The `analyzeSessionForInsights` method ties insights to live copilot session analysis (`copilot-http-server.js`), while `handleGetInsights` exposes them via a general server API. The consolidator's embedding-event publication (`_publishEmbeddingEvent`) implies integration with an embedding/vector-search subsystem elsewhere in the platform. Test coverage exists via `online-mapper.test.ts` and `audit-knowledge-overlap.mjs`, both referencing an `insights` variable, suggesting insight data is validated against knowledge-overlap and online-mapping correctness checks.

## Usage Guidelines

When modifying insight synthesis logic, changes to `_jaccard`/`_findSimilarInsightId` thresholds should be tested against `audit-knowledge-overlap.mjs` to avoid regressions in duplicate detection. Legacy row adapters (`_toLegacyDigestRow`, `_toLegacyInsightRow`) must be preserved or explicitly migrated when altering insight schema, following the same backward-compatibility discipline seen in `AGENT_COLORS`. Any new insight-consuming UI should route through `GatedInsights` rather than bypassing its access gate, and should reuse `MarkdownText`/`ClipboardButton` for consistent rendering. Backfill scripts (`backfill.ts`, `backfill-insight-mentions.mjs`) should be run after schema changes to keep historical insight mentions and summaries consistent with current derivation logic.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- INSIGHTS (class) in kb-ab-sample-tasks.mjs
- handleGetInsights (method) in server.js
- GatedInsights (class) in App.tsx
- analyzeSessionForInsights (method) in copilot-http-server.js
- deriveInsightSummary (function) in backfill-insight-mentions.mjs
- readInsights (function) in backfill.ts
- synthesizeInsights (method) in ObservationConsolidator.js
- _relinkOrphanOnlineInsights (method) in ObservationConsolidator.js

**Relationships:**
- Calls: _forwardObsApi, readExport, makePreview, previewVersion, _toLegacyDigestRow, _toLegacyInsightRow, _publishEmbeddingEvent, _getSanitizer, _jaccard, _findSimilarInsightId (+10 more)
- Imports: clipboard-button.tsx, ClipboardButton, consolidation-progress.tsx, InflightInfo, ConsolidationProgress, components/markdown-text.tsx, MarkdownText, system-health-dashboard/src/components/ui/badge.tsx, Badge, system-health-dashboard/src/components/ui/button.tsx (+10 more)

**Other:**
- insights (variable) in online-mapper.test.ts
- insights (variable) in audit-knowledge-overlap.mjs


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- SemanticAnalysis is a multi-agent pipeline (integrations/semantic-analysis/src/agents/) that processes git history and LSL session data to extract, classify, and persist structured knowledge entities into the ontology-backed knowledge graph. It orchestrates specialized agents extending BaseAgent (base-agent.ts) which wrap agent-specific logic in a standardized AgentResponse envelope, computing confidence breakdowns, detecting issues, and generating routing suggestions for retry/escalation between workflow steps.

At its core, OntologyClassificationAgent (ontology-classification-agent.ts) assigns ontology metadata (class, confidence, method) to observations by combining heuristic classifiers, an LLM-backed OntologyClassifier, and hard-coded hierarchy-root guards for closed-set entities (CollectiveKnowledge, Coding, DynArch, Timeline, Normalisa) imported from @fwornle/km-core's HIERARCHY_ROOTS. A newer L2 refinement layer (Phase 57/60) further refines generic L1 classes (Component/SubComponent/Detail) into specific subsystem classes declared in coding.lower.json, using pure, independently-testable helper functions (loadL2Classes, buildL2RefinementPrompt, extractL2FromLLMResponse) alongside a deterministic keyword-based fallback classifier (l2-subsystem-classifier.ts).

The SemanticAnalysisAgent (semantic-analysis-agent.ts) performs the actual code/git/vibe cross-analysis, reading files from git history, computing complexity metrics and architectural pattern detection, and invoking an LLM (via @rapid/llm-proxy's LLMService) to generate deeper semantic insights that are merged with heuristically-detected patterns. The pipeline emphasizes testability (extensive node:test suites with tmpdir-isolated ontology fixtures) and graceful degradation (e.g., absent coding.lower.json yields empty L2 refinement rather than errors), reflecting an incremental, plan-driven development process (Phase 42/57/60 markers throughout the code).

### Siblings
- [Pipeline](./Pipeline.md) -- Pipeline agents extend BaseAgent (base-agent.ts) so each stage wraps its output in a standardized AgentResponse envelope with confidence breakdowns.
- [Ontology](./Ontology.md) -- OntologyClassificationAgent (ontology-classification-agent.ts) combines heuristic classifiers, an LLM-backed OntologyClassifier, and hard-coded hierarchy-root guards.
- [BaseAgent](./BaseAgent.md) -- [LLM] The code files supplied for this analysis (config/agents/copilot.sh, config/agents/opencode.sh, config/agents/pi.sh, config/agents/pi-extensions/no-unbounded-fs-scan.ts, integrations/system-health-dashboard/src/components/agent-badge.tsx) do not correspond to the parent-context description of BaseAgent (integrations/semantic-analysis/src/agents/base-agent.ts) and its execute() -> process() -> calculateConfidence() -> detectIssues() -> generateRouting() -> applyCorrections() -> buildMetadata() pipeline. There is a naming collision between two unrelated 'agent' concepts in this codebase: (1) semantic-analysis's BaseAgent subclasses (OntologyClassificationAgent, SemanticAnalysisAgent) that process observations into knowledge-graph entities, and (2) the top-level 'coding' CLI wrapper's per-tool agent launch configs (copilot/opencode/pi) that configure how a human-facing coding assistant CLI is started, proxied, and instrumented. No code_graph data was provided, so no [LLM+CGR] observations can be made; all statements below are grounded in the literal file contents shown, not in the BaseAgent class itself.
- [L2SubsystemClassifier](./L2SubsystemClassifier.md) -- [LLM] The L2SubsystemClassifier's fallback path is a deterministic keyword-based classifier housed in l2-subsystem-classifier.ts, separate from the LLM-driven refinement in ontology-classification-agent.ts. This separation lets the pipeline degrade gracefully: when the LLM call fails, times out, or coding.lower.json is absent, the workflow can still emit an L2 class (or empty result) without throwing, consistent with the project's stated 'graceful degradation' design goal rather than hard-failing the whole classification step.
- [LegacyOntologyAdapter](./LegacyOntologyAdapter.md) -- [CGR] LegacyOntologyAdapter (class) in LegacyOntologyAdapter.ts


---

*Generated from 22 observations*
