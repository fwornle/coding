# Ontology

**Type:** SubComponent

[CGR] Imports: OntologyConfigManager.ts, OntologyConfigManager, ontologyPathResolver.ts, __clearCache, __getProbeCount, OntologyPathNotFoundError, __resetProbeCounter, resolveOntologyPath, ApiClient.ts, Entity (+10 more)

# Ontology — Technical Insight Document

## What It Is

Ontology is the classification and knowledge-modeling subcomponent of the SemanticAnalysis system, responsible for taking entities extracted upstream and organizing them into a structured class hierarchy. Its behavior as an agent is formally declared in `multi-agent-graph.tsx` via `AGENT_SUBSTEPS['ontology_classification']`, which defines three ordered sub-steps: match, validate, and extend. Beyond this agent definition, "ontology" appears pervasively across the codebase as a first-class concept: as a variable in `knowledge-management.json`, `events.test.ts`, and `graph-builder.test.ts`; as a method on `GraphKMStore.ts`; as a dedicated `Ontology` class in `types.ts`; and as request-handling logic (`handleOntologyClasses`) in `api-routes.js`. This breadth indicates Ontology is not an isolated agent step but a cross-cutting data model referenced throughout storage, API, and tooling layers.

## Architecture and Design

Architecturally, Ontology follows the same multi-agent decomposition pattern as its parent, SemanticAnalysis: rather than a monolithic classifier, responsibilities are split into three discrete, linearly-ordered sub-steps — match, validate, extend — each with its own LLM usage tier and technical note. This mirrors the sibling Pipeline component's `parse -> extract -> relate -> enrich` chain and the Insights component's pattern-discovery step, reflecting a house style of exposing pipeline stages as explicitly declared, inspectable sub-steps in `multi-agent-graph.tsx` rather than hiding them inside opaque agent logic.

![Ontology — Architecture](images/ontology-architecture.png)

A key design decision is the graduated cost/risk model applied to LLM usage across the three steps: 'match' (Class Matching) uses a 'standard' tier LLM for semantic-similarity-based mapping of entities to existing classes; 'validate' (Classification Validation) uses a 'fast' tier, combining rule-based checks with LLM validation to catch constraint violations cheaply; 'extend' (Ontology Auto-Extension) alone uses a 'premium' LLM tier. This escalation reflects a deliberate trade-off: routine classification is optimized for cost and speed, while decisions that reshape the ontology itself (creating new classes) are treated as higher-stakes and warrant the most capable model, complete with rationale generation for new class suggestions.

## Implementation Details

The match step assigns entities to ontology classes via LLM-guided semantic similarity ("standard" tier). The validate step cross-checks these classifications against ontology constraints, surfacing "Violations" using a hybrid rule + fast-LLM approach — a cheaper gate before any structural change is considered. The extend step only engages when entities don't fit existing classes, producing "New class suggestions" with accompanying rationale via a premium LLM, effectively acting as a controlled schema-evolution mechanism.

Beyond the agent flow, ontology data is materialized and manipulated through several concrete artifacts: the `Ontology` class in `types.ts` defines the shape of ontology data; `GraphKMStore.ts` exposes an `ontology` method for graph-based storage access; and path/config resolution is handled by dedicated utilities — `resolveOntologyDir` (in both `backfill-insight-mentions.mjs` and `backfill-l2-subsystem-class.mjs`), `KG_ONTOLOGY_DIR` and `collectByOntologyClass` in `observations-api-server.mjs`. Imports referencing `OntologyConfigManager.ts`, `ontologyPathResolver.ts` (with `resolveOntologyPath`, `OntologyPathNotFoundError`, `__clearCache`, `__getProbeCount`, `__resetProbeCounter`) indicate a dedicated configuration/path-resolution layer with cache and probe-count instrumentation for testability.

## Integration Points

![Ontology — Relationship](images/ontology-relationship.png)

Ontology is the second stage in the SemanticAnalysis pipeline, consuming entities produced by `semantic-analysis-agent.ts` extraction and feeding downstream consumers such as `Insights`, whose Pattern Discovery step consumes "Code entities" and "Relations" — outputs consistent with what Ontology classification would help produce. Ontology's classes and registries are queried across the system via calls like `getClass`, `getAllClassNames`, `getRegistry`, `classifyAvailable`, `resolveOverlaySystem`, and `loadDisplayOverlay`, alongside API access through `apiPath`/`get`/`ApiClient.ts` and viewer state via `useViewerStore`. Backfill scripts (`backfill-insight-mentions.mjs`, `backfill-l2-subsystem-class.mjs`) depend on `resolveOntologyDir`, and the observations API server exposes `collectByOntologyClass` and `KG_ONTOLOGY_DIR`, showing Ontology data is queried both live (via `handleOntologyClasses` in `api-routes.js`) and in batch/maintenance contexts.

## Usage Guidelines

Developers should preserve the match -> validate -> extend ordering when extending or debugging the classification agent, since validation assumes matching has occurred and extension is explicitly reserved for entities that fail both prior steps. Given the premium-tier cost of the extend step, new-class creation should not be triggered casually — it's designed as an exception path, not a routine one. When working with ontology paths and configuration, use the established resolver utilities (`resolveOntologyPath`, `OntologyConfigManager`) rather than hardcoding directories, since cache-clearing (`__clearCache`) and probe-counting (`__getProbeCount`, `__resetProbeCounter`) hooks exist specifically to support testable, deterministic path resolution. Tests in `events.test.ts` and `graph-builder.test.ts` should be consulted as the reference contract for expected ontology variable shapes when modifying `GraphKMStore.ts` or `types.ts`.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- ontology (method) in GraphKMStore.ts
- Ontology (class) in types.ts
- handleOntologyClasses (method) in api-routes.js
- resolveOntologyDir (function) in backfill-insight-mentions.mjs
- resolveOntologyDir (function) in backfill-l2-subsystem-class.mjs
- KG_ONTOLOGY_DIR (class) in observations-api-server.mjs
- collectByOntologyClass (function) in observations-api-server.mjs

**Relationships:**
- Calls: _tokenize, apiPath, get, classifyAvailable, useViewerStore, getClass, getAllClassNames, getRegistry, resolveOverlaySystem, loadDisplayOverlay (+10 more)
- Imports: OntologyConfigManager.ts, OntologyConfigManager, ontologyPathResolver.ts, __clearCache, __getProbeCount, OntologyPathNotFoundError, __resetProbeCounter, resolveOntologyPath, ApiClient.ts, Entity (+10 more)

**Other:**
- ontology (variable) in knowledge-management.json
- ontology (variable) in events.test.ts
- ontology (variable) in graph-builder.test.ts


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- [LLM] The batch-analysis pipeline is organized as a multi-agent workflow where distinct responsibilities are separated into dedicated agent classes rather than a single monolithic analyzer. semantic-analysis-agent.ts is responsible for extracting structured knowledge entities from raw inputs (git history diffs/commits and LSL session logs), while ontology-classification-agent.ts takes those extracted entities and classifies them into a hierarchy (determining parent-child relationships and where a given entity fits within the broader ontology). This separation of extraction from classification allows each agent to have a narrower, more testable prompt/response contract with the underlying LLM, and lets the pipeline swap or tune one stage without affecting the other's logic.

### Siblings
- [Pipeline](./Pipeline.md) -- AGENT_SUBSTEPS['semantic_analysis'] in multi-agent-graph.tsx defines four ordered sub-steps: parse, extract, relate, enrich, each with declared inputs/outputs
- [Insights](./Insights.md) -- AGENT_SUBSTEPS['insight_generation'] defines a 'patterns' sub-step (Pattern Discovery) tagged llmUsage:'premium', consuming 'Code entities' and 'Relations' to produce 'Pattern instances' and descriptions


---

*Generated from 18 observations*
