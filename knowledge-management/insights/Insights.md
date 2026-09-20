# Insights

**Type:** SubComponent

# Insights — Technical Insight Document

## What It Is

Insights is a cross-cutting SubComponent of SemanticAnalysis that spans server, client, and batch/backfill tooling — it is not a single class but a family of coordinated implementations that surface, serve, and reconcile derived observations across the system. Concrete implementations include the `INSIGHTS` class in `kb-ab-sample-tasks.mjs`, the `INSIGHTS_DIR` constant/class in `observations-api-server.mjs`, `handleGetInsights` in `server.js`, `listInsights` in `ApiClient.ts`, `GatedInsights` in `App.tsx`, `analyzeSessionForInsights` in `copilot-http-server.js`, and data-reconciliation utilities like `deriveInsightSummary` (`backfill-insight-mentions.mjs`) and `readInsights` (`backfill.ts`). Test and audit usages (`online-mapper.test.ts`, `audit-knowledge-overlap.mjs`) confirm Insights is treated as a first-class, independently verifiable data artifact rather than an incidental byproduct of other pipelines.

![Insights — Architecture](images/insights-architecture.png)

## Architecture and Design

The Insights subsystem follows a layered read/write split: a server-side API surface (`handleGetInsights`, `INSIGHTS_DIR`) persists and exposes insight data, a client layer (`ApiClient.ts`'s `listInsights`, `App.tsx`'s `GatedInsights`) consumes and gates it for UI display, and offline/batch tooling (`backfill.ts`, `backfill-insight-mentions.mjs`) reconciles or backfills insight records against historical data. The `GatedInsights` naming in `App.tsx`, together with UI imports (`ClipboardButton`, `ConsolidationProgress`, `MarkdownText`, `Badge`, `Button`), suggests a presentation layer that conditionally renders insight content pending some readiness/permission gate, consistent with the project's broader habit (seen in sibling `L2SubsystemClassifier`) of treating certain data as requiring validation before exposure.

As a child of SemanticAnalysis, Insights inherits the parent's "deterministic-first" philosophy in spirit: `deriveInsightSummary` and `readInsights` operate as deterministic derivation/reconciliation steps over existing observation data rather than invoking LLM judgment for every insight, mirroring how `OntologyClassificationAgent` avoids LLM calls for structurally critical decisions. Insights is a sibling of Ontology, Pipeline, BaseAgent, and L2SubsystemClassifier — it likely consumes the same knowledge pipeline (`pollKnowledgePipeline`) and ontology-classified observations that those components produce, functioning as a downstream consumer/synthesizer rather than a classifier itself.

## Implementation Details

`handleGetInsights` in `server.js` is the primary read endpoint, backed by file/data storage referenced via `INSIGHTS_DIR` in `observations-api-server.mjs`. The call graph (`_forwardObsApi`, `get`, `readExport`, `makePreview`, `previewVersion`, `_toLegacyDigestRow`, `_toLegacyInsightRow`, `_publishEmbeddingEvent`, `_getSanitizer`, `_jaccard`) indicates the server-side implementation handles legacy row translation (`_toLegacyDigestRow`, `_toLegacyInsightRow`), similarity/deduplication logic (`_jaccard`), sanitization (`_getSanitizer`), and event publishing for embeddings (`_publishEmbeddingEvent`) — implying Insights records are compared, deduplicated, and versioned rather than simply appended. `previewVersion`/`makePreview` suggest a preview-before-commit workflow for insight content.

On the client, `ApiClient.ts`'s `listInsights` provides the typed fetch interface, and `GatedInsights` in `App.tsx` composes UI primitives (`ClipboardButton`, `ConsolidationProgress`/`InflightInfo`, `MarkdownText`, `Badge`, `Button`) to render insight text with copy affordances and in-progress/consolidation status. `analyzeSessionForInsights` in `copilot-http-server.js` indicates session transcripts are analyzed on the fly to produce candidate insights, separate from the batch backfill path. `deriveInsightSummary` and `readInsights` in the backfill scripts operate offline, reprocessing historical data to generate or validate insight summaries — analogous in spirit to `batch-provenance.mjs`'s time-window attribution approach used elsewhere in the codebase, favoring conservative, auditable derivation over inference.

![Insights — Relationship](images/insights-relationship.png)

## Integration Points

Insights integrates vertically across the stack: `copilot-http-server.js` (session analysis) → `observations-api-server.mjs`/`server.js` (storage and API) → `ApiClient.ts` (typed client) → `App.tsx` (`GatedInsights` UI). It also integrates horizontally with audit and testing infrastructure (`audit-knowledge-overlap.mjs`, `online-mapper.test.ts`), suggesting insight data quality (overlap, duplication) is independently checked outside the main serving path. As a SubComponent under SemanticAnalysis, it likely consumes classified/ontology-tagged observations produced by sibling components like L2SubsystemClassifier and BaseAgent's pipeline, and its data may feed or be fed by the knowledge pipeline (`pollKnowledgePipeline`). UI-level dependencies on shared components (`Badge`, `Button`, `MarkdownText`, `ConsolidationProgress`) tie it into the broader system-health-dashboard component library.

## Usage Guidelines

Given the presence of legacy-row translation functions (`_toLegacyDigestRow`, `_toLegacyInsightRow`) and preview/versioning calls, developers should treat insight records as versioned, backward-compatible data structures — new fields or formats must be translated for legacy consumers rather than replacing them outright. The `GatedInsights` naming implies UI consumers must respect gating conditions (e.g., readiness, consolidation state) before displaying data; bypassing the gate risks showing incomplete or in-flight insights. Batch/backfill operations (`deriveInsightSummary`, `readInsights`) should remain idempotent and deterministic, consistent with the codebase's broader bias (seen in `batch-provenance.mjs`) toward under-reporting rather than fabricating insight associations. Any overlap/duplication logic (`_jaccard`) suggests new insight-generation code should reuse existing similarity utilities rather than reimplementing ad hoc comparison logic, and audit scripts (`audit-knowledge-overlap.mjs`) should be run to validate changes to insight derivation logic before deployment.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- INSIGHTS (class) in kb-ab-sample-tasks.mjs
- handleGetInsights (method) in server.js
- listInsights (method) in ApiClient.ts
- INSIGHTS_DIR (class) in observations-api-server.mjs
- GatedInsights (class) in App.tsx
- analyzeSessionForInsights (method) in copilot-http-server.js
- deriveInsightSummary (function) in backfill-insight-mentions.mjs
- readInsights (function) in backfill.ts

**Relationships:**
- Calls: _forwardObsApi, get, readExport, makePreview, previewVersion, _toLegacyDigestRow, _toLegacyInsightRow, _publishEmbeddingEvent, _getSanitizer, _jaccard (+10 more)
- Imports: clipboard-button.tsx, ClipboardButton, consolidation-progress.tsx, InflightInfo, ConsolidationProgress, components/markdown-text.tsx, MarkdownText, system-health-dashboard/src/components/ui/badge.tsx, Badge, system-health-dashboard/src/components/ui/button.tsx (+10 more)

**Other:**
- insights (variable) in online-mapper.test.ts
- insights (variable) in audit-knowledge-overlap.mjs


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- [LLM] The classification pipeline in OntologyClassificationAgent embodies a deliberate 'deterministic-first, LLM-as-fallback' philosophy that recurs throughout SemanticAnalysis. Before any LLM call is made, classifySingleObservation() checks the observation's name against the hard-root-guard set (CollectiveKnowledge, Coding, DynArch, Timeline, Normalisa) imported from @fwornle/km-core's HIERARCHY_ROOTS. If matched, the method immediately assigns classificationMethod='hard-root-guard' and returns without ever invoking classifier.classify() or touching the LLM. This is a defensive engineering decision: because these 5 names anchor the entire hierarchy, any LLM-driven misclassification of them would cascade corruption through the whole ontology tree, so the developers chose to hardcode an escape hatch rather than trust probabilistic classification for structurally critical nodes.

### Siblings
- [Ontology](./Ontology.md) -- [CGR] ontology (variable) in knowledge-management.json
- [Pipeline](./Pipeline.md) -- [CGR] pollKnowledgePipeline (function) in health-coordinator.js
- [BaseAgent](./BaseAgent.md) -- [LLM] The parent observation describing BaseAgent's template-method execute() pipeline (process() → calculateConfidence() → detectIssues() → generateRouting() → applyCorrections() → buildMetadata()) is not directly visible in the provided code files, but the surrounding config/agents/*.sh scripts (copilot.sh, opencode.sh, pi.sh) reveal a parallel template-method philosophy at the shell layer: each agent definition file sources common hooks (agent_check_requirements, agent_pre_launch, agent_cleanup) that are called uniformly by launch-agent-common.sh, mirroring the same 'implement the hooks, let the orchestrator drive the sequence' pattern that BaseAgent enforces in TypeScript. This suggests the project applies the template-method pattern consistently across both its LLM-agent pipeline and its CLI-agent launch pipeline.
- [L2SubsystemClassifier](./L2SubsystemClassifier.md) -- [LLM] L2SubsystemClassifier's refinement step, as implemented via loadL2Classes() in ontology-classification-agent.ts, is architected as a closed-vocabulary lookup rather than an open classification task. It derives its candidate set by filtering registry.classCatalog to entries whose `extends` field resolves to one of REFINABLE_L1_PARENTS ('Component','SubComponent','Detail'), sourced from .data/ontologies/coding.lower.json. This means the classifier's entire universe of possible outputs (currently 10 L2 classes such as EtmDaemon, RapidLlmProxy, ConstraintMonitor) is defined declaratively in a JSON ontology file rather than being inferable or extensible by the LLM itself — a new SubComponent type cannot be classified into existence, it must first be registered in the ontology.


---

*Generated from 21 observations*
