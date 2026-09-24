# Insights

**Type:** SubComponent

## What It Is

Insights is a SubComponent of SemanticAnalysis representing the knowledge-base entity type that stores derived findings from the UKB wave pipeline. Its direct implementation is not visible in the supplied source files — the retrieved files (health-coordinator.js, repair-writer-ontology-class.mjs, src/ontology/index.ts, health-coordinator-etm-expected.test.mjs, copilot.sh) contain no reference to it. What we know instead comes from code-graph identifiers scattered across the codebase: an `insights` variable in `backfill-insight-parents.mjs`, `delete-wave-insight-stubs.mjs`, `online-mapper.test.ts`, and `audit-knowledge-overlap.mjs`; an `INSIGHTS` class in `kb-ab-sample-tasks.mjs`; `handleGetInsights` in `server.js`; and a UI module `insights.tsx` exporting `InsightsPage`. These are names only — bodies were not shown — so this document describes the surrounding pipeline behavior rather than internal logic.

![Insights — Architecture](images/insights-architecture.png)

## Architecture and Design

The observations point to a write-then-consume pipeline: insight documents are produced by a UKB wave pipeline under evidence-gating rules (only written "when sufficient real evidence exists," preventing empty stub Insight entities), then consumed downstream by taxonomy-derivation and rollup processes. Two competing organizational schemes exist over the ~987-991 item corpus: an intent-derived spine (clustering insights into Intent entities via aggregate edges, produced by a single consolidated script replacing five ad-hoc predecessors) versus the existing 8-branch code spine — this tension is itself a first-class architectural decision documented under "UKB Insight Taxonomy."

Child components decompose specific concerns: InsightCompactionPipeline (`scripts/compact-insights.mjs`) is a thin client that POSTs to obs-api's `/api/insights/compact` and polls `/api/insights/compact/status`, deliberately not performing clustering itself after a prior in-process `ObservationConsolidator` design failed with "km-core not configured" errors. HierarchicalInsightRollup assigns insights to SubComponent parents via `metadata.parentId`, controlling coverage vs. hub concentration in KB views. InsightFreshnessVerification renders a `FreshnessBadge` in `insights.tsx` derived from `metadata.codeVerification`, explicitly avoiding a "green-by-default" false-positive state for unmeasured insights.

## Implementation Details

`writeInsight` is the central write path, referenced via `_toLegacyInsightRow`, `_findSimilarInsightId`, `_jaccard`, `_tokenize`, and `_publishEmbeddingEvent` in the call graph — indicating embedding-based near-duplicate detection is being wired in behind a dry-run flag, explicitly not yet affecting live writes pending latency/precision validation. `deriveInsightSummary` in `backfill-insight-mentions.mjs` and `compact-insights.mjs` handle post-hoc maintenance and compaction of existing records. `handleGetInsights` in `server.js` serves read access, and `InsightsPage` in `integrations/system-health-dashboard/.../insights.tsx` renders the UI, importing `ClipboardButton`, `ConsolidationProgress`/`InflightInfo`, `MarkdownText`, and Badge/Button/Card/Input/ScrollArea primitives — suggesting a dashboard panel composing these, though usage specifics weren't confirmed in source.

## Integration Points

Insights sits under SemanticAnalysis, which also owns the Ontology and Pipeline siblings currently tracking an unresolved CodingLowerOntologySource emission bug — a contract mismatch in source-tagging that could affect insight provenance tagging if shared logic is involved. It relates to OntologyClassificationAgent/SemanticAnalysisAgent through the intent-derived taxonomy, validated for stability via disjoint-sample re-derivation before being frozen as a spine dependency. Downstream, PlantUML diagram generation over three diagram trees has encountered syntax failures and bad absolute `!include` paths, a concern for any visualization built atop insight/intent hierarchies.

![Insights — Relationship](images/insights-relationship.png)

## Usage Guidelines

Given the evidence-gating rule, new insight-writing code must not bypass the check that prevents stub or low-evidence documents. The embedding-based dedup path in `writeInsight` is dry-run only — do not assume duplicates are filtered in production until this is confirmed enabled. When reasoning about taxonomy, be aware two spines (intent vs. code) coexist over the same corpus, and any consumer should be explicit about which it depends on, given the stability-validation precedent from OntologyClassificationAgent. Finally, several sections of this document rest on identifier names without visible implementation bodies (`insights` variables, `INSIGHTS` class) — treat those as pointers for further investigation rather than confirmed design facts.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- INSIGHTS (class) in kb-ab-sample-tasks.mjs
- handleGetInsights (method) in server.js
- InsightsPage (function) in insights.tsx
- deriveInsightSummary (function) in backfill-insight-mentions.mjs

**Relationships:**
- Calls: _forwardObsApi, e, _toLegacyDigestRow, _toLegacyInsightRow, _publishEmbeddingEvent, _getSanitizer, _jaccard, _findSimilarInsightId, _tokenize, _pushInsightToKG (+10 more)
- Imports: clipboard-button.tsx, ClipboardButton, consolidation-progress.tsx, ConsolidationProgress, InflightInfo, components/markdown-text.tsx, MarkdownText, system-health-dashboard/src/components/ui/badge.tsx, Badge, system-health-dashboard/src/components/ui/button.tsx (+10 more)
- The imports list (clipboard-button.tsx, consolidation-progress.tsx, markdown-text.tsx, and system-health-dashboard/src/components/ui/{badge,button,card,input,scroll-area}.tsx) suggests Insights is rendered as a dashboard UI panel composing Card/Badge/Button/Input/ScrollArea primitives alongside a ClipboardButton and ConsolidationProgress/InflightInfo widget, but none of these files' contents were provided to confirm actual usage.

**Other:**
- insights (variable) in backfill-insight-parents.mjs
- insights (variable) in delete-wave-insight-stubs.mjs
- insights (variable) in online-mapper.test.ts
- insights (variable) in audit-knowledge-overlap.mjs
- insights.tsx (module) in insights.tsx
- compact-insights.mjs (module) in compact-insights.mjs


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- Intent Spine Derivation Pipeline describes deriving an 'intent spine' by clustering insights into Intent entities via aggregate edges, consolidating five prior ad-hoc scripts into one producer script.
- UKB Insight Generation Pipeline — Evidence Gating and Document Quality ensures insight documents from the UKB wave pipeline are only written when sufficient real evidence exists, preventing empty stub 'Insight' entities from contaminating the knowledge base.
- writeInsight Embedding-Based Dedup Integration tracks wiring embedding-based near-duplicate detection into the writeInsight write path, gated behind a dry-run flag before enabling live writes.
- PlantUML Diagram Generation — Wave 4 Syntax Failures documents diagnostic work on generated .puml files failing with syntax errors and incorrect absolute !include paths across all three diagram trees.
- UKB Insight Taxonomy: Intent Spine vs Code Spine compares an intent-derived category spine against the existing 8-branch code spine for organizing the ~987-991 item UKB insight corpus.
- The Intent Spine Derivation Pipeline record states that a single consolidated producer script folds five prior ad-hoc scripts into one, deriving an 'intent spine' over the knowledge graph by clustering insights into Intent entities via aggregate edges, giving the KB an intent-first taxonomy layer the unified viewer can render as an alternate hierarchy.
- The writeInsight Embedding-Based Dedup Integration record establishes that embedding-based near-duplicate detection is being wired into the writeInsight write path behind a dry-run flag specifically so that live writes are not affected until latency and precision are validated — this is in-progress work, not a shipped guarantee.
- The UKB Insight Generation Pipeline — Evidence Gating and Document Quality record establishes that insight documents from the UKB wave pipeline are only written when sufficient real evidence exists, a gate designed to prevent empty stub 'Insight' entities and machine-generated garbage text from contaminating the knowledge base.

## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- [SESSION] Pipeline CodingLowerOntologySource Emission Bug documents an unresolved defect where the pipeline emits a CodingLowerOntologySource reference in output despite documentation stating this source type should never be produced

### Children
- [InsightCompactionPipeline](./InsightCompactionPipeline.md) -- [LLM+CGR] scripts/compact-insights.mjs is a thin client that POSTs to obs-api's /api/insights/compact endpoint and polls /api/insights/compact/status rather than performing clustering itself; the module comment explains this replaced a prior design that instantiated its own ObservationConsolidator with no kmStore, which threw 'km-core not configured' on every invocation and meant the insight corpus had never actually been compacted.
- [HierarchicalInsightRollup](./HierarchicalInsightRollup.md) -- [SESSION] Insight Roll-up Pipeline — Synthesis and Parent Visibility establishes that observations/insights are assigned to SubComponent 'parent' entities via metadata.parentId, directly controlling coverage diversity vs. hub concentration in downstream KB views.
- [InsightFreshnessVerification](./InsightFreshnessVerification.md) -- [LLM] `FreshnessBadge` in `integrations/system-health-dashboard/src/pages/insights.tsx` renders three distinct states off a single `CodeVerification` object read from `metadata.codeVerification`: no badge at all when `cv` is undefined (insight never went through the verifier), a solid-slate `UNVERIFIABLE` pill when `cv.totalClaims` is 0 (zero backticked claims to check), and a `FRESH`/`PARTIAL`/`STALE` band from `freshnessClass`/`freshnessLabel` when `verificationRatio` is a number, using thresholds of 0.7 and 0.5. The component deliberately avoids defaulting an unmeasured insight to green, per the comment 'avoids the green-by-default illusion that a 0/0 insight is 100% true'.

### Siblings
- [Ontology](./Ontology.md) -- [SESSION] Pipeline CodingLowerOntologySource Emission Bug documents an unresolved defect where the pipeline emits a CodingLowerOntologySource reference in output despite documentation stating this source type should never be produced, indicating a gap between the lower-ontology source contract and actual emission behavior.
- [Pipeline](./Pipeline.md) -- [SESSION] Pipeline CodingLowerOntologySource Emission Bug tracks an unresolved defect where the pipeline emits a CodingLowerOntologySource reference in its output despite documentation stating this source type should never be produced, indicating a mismatch between the pipeline's source-tagging logic and its own contract.
- [OntologyClassificationAgent](./OntologyClassificationAgent.md) -- [SESSION] Taxonomy Stability Validation via Disjoint Sample Re-derivation establishes that intent-derived taxonomies produced by SemanticAnalysisAgent were validated for stability by re-deriving the taxonomy independently from disjoint data samples and measuring agreement between the two derivations, rather than by inspecting a single run's output. This methodology exists because the taxonomy serves as a fixed 'spine' for downstream KB stages — instability would propagate structural drift into every consumer that depends on the taxonomy being held fixed, so reproducibility across disjoint samples was treated as a precondition for freezing the spine rather than an optional sanity check. This bears on OntologyClassificationAgent because its L1/L2 output is exactly the kind of categorical assignment such a spine depends on staying stable run-to-run.
- [SemanticAnalysisAgent](./SemanticAnalysisAgent.md) -- [SESSION] Taxonomy Stability Validation via Disjoint Sample Re-derivation validates that an intent-derived taxonomy produced from SemanticAnalysisAgent-adjacent processing is stable and reproducible by re-deriving it independently from disjoint data samples.
- [BaseAgentFramework](./BaseAgentFramework.md) -- [LLM] None of the five files retrieved for this request — scripts/health-coordinator.js, scripts/repair-writer-ontology-class.mjs, src/ontology/index.ts, tests/integration/health-coordinator-etm-expected.test.mjs, and config/agents/copilot.sh — define, import, or reference a class named BaseAgent, BaseAgentFramework, or any of the five lifecycle methods (process(), calculateConfidence(), detectIssues(), generateRouting(), applyCorrections(), buildMetadata()) that the parent context attributes to base-agent.ts. The <code_graph> block supplied for this request is also empty, so there is no structural (call-graph) evidence tying these files to the framework either. This is a retrieval mismatch, not a finding about the framework's design.
- [L2RefinementClassifier](./L2RefinementClassifier.md) -- [LLM] None of the supplied code files (scripts/health-coordinator.js, scripts/repair-writer-ontology-class.mjs, src/ontology/index.ts, tests/integration/health-coordinator-etm-expected.test.mjs, config/agents/copilot.sh) implement or reference loadL2Classes(), buildL2RefinementPrompt(), or extractL2FromLLMResponse() — the three functions the parent context attributes to L2RefinementClassifier's implementation in ontology-classification-agent.ts. That file is absent from the supplied evidence.
- [HealthCoordinator](./HealthCoordinator.md) -- [LLM] scripts/health-coordinator.js implements the actual HealthCoordinator daemon: a single-owner in-memory state object (currentState) exposed over HTTP (GET /health, GET /health/state, POST /signals, POST /health/refresh) and refreshed on a 5s tick that iterates a check registry loaded from config/health-verification-rules.json. This is the concrete component behind the 'HealthCoordinator' label in the parent context, though the parent's observations (SemanticAnalysisAgent, OntologyClassificationAgent, BaseAgent lifecycle) describe an entirely different subsystem.
- [AgentLauncherConfigs](./AgentLauncherConfigs.md) -- [LLM] The supplied code files (health-coordinator.js, repair-writer-ontology-class.mjs, src/ontology/index.ts, health-coordinator-etm-expected.test.mjs, config/agents/copilot.sh) contain no reference to an 'AgentLauncherConfigs' class, module, or file. config/agents/copilot.sh is an agent definition sourced by launch-agent-common.sh, which is thematically adjacent to an 'agent launcher' concept but is not itself a config aggregation component named AgentLauncherConfigs.
- [NoUnboundedFsScanGuard](./NoUnboundedFsScanGuard.md) -- [LLM] None of the supplied code files implement or reference anything resembling a filesystem-scan bound or guard. `scripts/health-coordinator.js` owns health-state polling and Docker/service/LSL checks; `scripts/repair-writer-ontology-class.mjs` repairs `ontologyClass` vs `entityType` mismatches over HTTP against obs-api; `src/ontology/index.ts` wires `LegacyOntologyAdapter`/`OntologyValidator`/`OntologyClassifier`; the test file asserts ETM-expectation lifecycle invariants; `config/agents/copilot.sh` configures the CoPilot agent launch. None of these touch directory traversal, `fs.readdir`/`fs.walk` recursion, or any depth/size/count ceiling that a name like 'NoUnboundedFsScanGuard' would imply.


---

*Generated from 25 observations*
