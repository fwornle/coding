# Insights

**Type:** SubComponent

[CGR] Imports: clipboard-button.tsx, ClipboardButton, consolidation-progress.tsx, InflightInfo, ConsolidationProgress, components/markdown-text.tsx, MarkdownText, system-health-dashboard/src/components/ui/badge.tsx, Badge, system-health-dashboard/src/components/ui/button.tsx (+10 more)

# Insights — Technical Insight Document

## What It Is

Insights is the terminal sub-component of the SemanticAnalysis pipeline, defined via `AGENT_SUBSTEPS['insight_generation']` in `multi-agent-graph.tsx`. It comprises two declared sub-steps: **Pattern Discovery** (`patterns`), which consumes Code entities and Relations to produce Pattern instances and descriptive text, and **Architecture Diagramming** (`arch`), which consumes Components and Dependencies to generate architecture diagrams. Beyond this orchestration-level definition, the codebase contains a wide surface of concrete artifacts touching "insights" — from UI components like `GatedInsights` in `App.tsx`, to server handlers like `handleGetInsights` in `server.js`, to consolidation logic in `ObservationConsolidator.js` (`synthesizeInsights`, `_relinkOrphanOnlineInsights`), to batch/migration scripts (`backfill-insight-mentions.mjs`, `backfill.ts`) that derive and read insight data.

![Insights — Architecture](images/insights-architecture.png)

## Architecture and Design

Insights sits downstream of both Pipeline (which extracts entities/relations via parse, extract, relate, enrich) and Ontology (which classifies those entities via match, validate, extend). This placement reflects a strict staged pipeline: raw extraction → classification → insight authoring, mirroring the parent SemanticAnalysis description of separating extraction from classification into dedicated agent responsibilities. Insight generation is the consumer at the end of this chain, relying on the outputs of its sibling stages rather than performing its own extraction or classification.

A notable design decision is the tiering of LLM cost: Pattern Discovery is tagged `llmUsage:'premium'`, the same tier as Ontology's `extend` sub-step. This signals a deliberate architectural choice to budget novel-pattern discovery and novel-class discovery as similarly expensive, "creative" LLM operations, distinct from cheaper, more mechanical sub-steps like match/validate or parse/extract. The `arch` sub-step is architecturally distinct in output type — it produces diagrams rather than pattern text — suggesting Insights bifurcates into a text/semantic track and a visual/structural track from the same upstream Components/Dependencies data.

## Implementation Details

At the implementation level, "insights" functionality is diffused across multiple layers rather than centralized in one module. `ObservationConsolidator.js` contains the core synthesis logic (`synthesizeInsights`) plus repair/maintenance logic (`_relinkOrphanOnlineInsights`), and calls a large set of internal helpers (`_forwardObsApi`, `readExport`, `makePreview`, `previewVersion`, `_toLegacyDigestRow`, `_toLegacyInsightRow`, `_publishEmbeddingEvent`, `_getSanitizer`, `_jaccard`, `_findSimilarInsightId`, among 10+ others). The presence of `_jaccard` and `_findSimilarInsightId` indicates similarity-based deduplication or matching logic underlies insight consolidation, while `_toLegacyDigestRow`/`_toLegacyInsightRow` point to backward-compatibility transforms for older data schemas, and `_publishEmbeddingEvent` implies insights are embedded and published as events for downstream consumers.

On the data/backfill side, `deriveInsightSummary` (in `backfill-insight-mentions.mjs`) and `readInsights` (in `backfill.ts`) support batch reconstruction or migration of insight data, while `analyzeSessionForInsights` in `copilot-http-server.js` derives insights from session logs at request time. Server-side exposure is handled through `handleGetInsights` in `server.js`, and `INSIGHTS` as a class in `kb-ab-sample-tasks.mjs` suggests a sample/test fixture representing insight structures for AB-testing tasks.

## Integration Points

![Insights — Relationship](images/insights-relationship.png)

Insights integrates with the UI layer through `GatedInsights` in `App.tsx`, which imports shared components including `ClipboardButton` (`clipboard-button.tsx`), `ConsolidationProgress`/`InflightInfo` (`consolidation-progress.tsx`), `MarkdownText` (`components/markdown-text.tsx`), and UI primitives `Badge`/`Button` from `system-health-dashboard/src/components/ui/`. This indicates insights are rendered as gated, progressively-loaded UI content with markdown rendering and copy-to-clipboard affordances, consistent with a consolidation workflow that surfaces in-progress or streaming results (`ConsolidationProgress`, `InflightInfo`).

On the pipeline side, Insights depends on outputs from Pipeline (Code entities, Relations, Components, Dependencies) and Ontology (classified entities), per the parent SemanticAnalysis architecture. Test and audit tooling (`online-mapper.test.ts`, `audit-knowledge-overlap.mjs`) reference `insights` as variables, implying these are validated/audited as part of quality-assurance processes across the knowledge graph.

## Usage Guidelines

Given the premium LLM tagging on Pattern Discovery, callers should treat pattern generation as a costlier operation to be invoked judiciously rather than on every entity change — mirroring how Ontology's `extend` is similarly gated. Consumers of insight data should be aware of the dual legacy/current schema handling evident in `_toLegacyDigestRow`/`_toLegacyInsightRow`, meaning integrations should tolerate or explicitly handle both formats. Deduplication logic (`_jaccard`, `_findSimilarInsightId`) suggests new insights should be checked against existing ones before insertion to avoid redundant pattern entries. Finally, since Insights strictly consumes upstream Pipeline and Ontology outputs, changes to entity/relation schemas in those sibling stages will directly impact insight generation correctness and should be coordinated.


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
- [SemanticAnalysis](./SemanticAnalysis.md) -- [LLM] The batch-analysis pipeline is organized as a multi-agent workflow where distinct responsibilities are separated into dedicated agent classes rather than a single monolithic analyzer. semantic-analysis-agent.ts is responsible for extracting structured knowledge entities from raw inputs (git history diffs/commits and LSL session logs), while ontology-classification-agent.ts takes those extracted entities and classifies them into a hierarchy (determining parent-child relationships and where a given entity fits within the broader ontology). This separation of extraction from classification allows each agent to have a narrower, more testable prompt/response contract with the underlying LLM, and lets the pipeline swap or tune one stage without affecting the other's logic.

### Siblings
- [Pipeline](./Pipeline.md) -- AGENT_SUBSTEPS['semantic_analysis'] in multi-agent-graph.tsx defines four ordered sub-steps: parse, extract, relate, enrich, each with declared inputs/outputs
- [Ontology](./Ontology.md) -- AGENT_SUBSTEPS['ontology_classification'] in multi-agent-graph.tsx defines match, validate, and extend sub-steps for the classification agent


---

*Generated from 16 observations*
