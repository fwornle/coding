# OnlineLearning

**Type:** SubComponent

## What It Is

OnlineLearning is a KnowledgeManagement subcomponent whose own implementation is largely absent from the retrieved evidence — what is visible is almost entirely its *traces* in other components: a consumer-side rendering flag in `integrations/unified-viewer/src/graph/D3GraphCanvas.tsx`, a streaming config block in `config/knowledge-management.json`, and a test comment in `integrations/unified-viewer/src/graph/hierarchy-parents.test.ts`. It has two named children — IntentSpineDerivation and LearningSourceClassification — but neither child's actual logic (the consolidated intent-clustering script, or the `isOnlineLearned` predicate module) is present in the supplied files. This document therefore describes the *shape* of OnlineLearning as inferred from its footprints, not its internal mechanics, which live in files not retrieved (`learning-source.ts`, the five ad-hoc predecessor scripts, `vokb-palette` ring-color logic).

## Architecture and Design

The clearest architectural signal is a flag-driven differentiation pattern: online-learned entities are not a separate node type in the graph but ordinary entities carrying a boolean predicate, `isOnlineLearned`, evaluated at render time by D3GraphCanvas.tsx to apply `ONLINE_RING_COLOR`. This mirrors — and inverts — how its sibling WaveInsightPersistence distinguishes batch origin: batch-produced entities are stamped at write time with `source/subsystem='wave-analysis'`, meaning the *absence* of that stamp is what implicitly marks an entity as online-learned. Online and batch ingestion are thus structurally siblings that converge on the same entity/graph store, with UkbWorkflowDashboard (backed by `ukb-workflow-modal.tsx` and `ukbSlice.ts`) representing the batch state machine (`UKBProcess`, `batchIterations`, `WaveGroup`) that has no online-path counterpart in evidence.

![OnlineLearning — Architecture](images/online-learning-architecture.png)

The `streaming` block in `config/knowledge-management.json` (`bufferSize: 10`, `debounceMs: 2000`, `minExchangeLength: 50`, `batchSize: 5`) is the best available proxy for an online capture front-end: it governs debouncing and buffering of live conversational exchanges before they become observations/digests, distinct from the origin-agnostic `inference.budget` and `ontology.classification` sections in the same file.

## Implementation Details

No class or function bodies for OnlineLearning's own logic are in evidence. What can be said mechanically: `D3GraphCanvas.tsx` imports `isOnlineLearned` from `./learning-source` and `ONLINE_RING_COLOR` from `./vokb-palette`, applying the predicate purely for visual encoding, not for graph structure. The hierarchy viewer's `deriveParents` (tested in `hierarchy-parents.test.ts`) treats online-learned and batch-learned Insight entities as a single undifferentiated population once placed in the Component→Detail→Insight tree — a fix dated 2026-09-21 made `Insight` a hierarchy class at Detail level, resolving a prior state where all 975 Insights, including "the whole online-learning population," sat outside the tree. This confirms online-learning output ultimately lands as Insight-typed entities subject to the same hierarchy placement logic as batch output.

## Integration Points

![OnlineLearning — Relationship](images/online-learning-relationship.png)

OnlineLearning sits under KnowledgeManagement alongside WaveInsightPersistence, GraphDatabaseService, ManualLearning, GraphifyGraph, KmCoreMigration, UnifiedViewerGraphRendering, and UkbWorkflowDashboard. Its most concrete integration is with UnifiedViewerGraphRendering via the `isOnlineLearned`/`ONLINE_RING_COLOR` rendering hook, and with the hierarchy-derivation logic that places its Insight output in the same tree as batch-derived Insights. It also shares the underlying entity/graph store with the batch pipeline (UkbWorkflowDashboard, WaveInsightPersistence), meaning any online write path is subject to the same disambiguation discipline documented in the km-core-adapter.ts bugfix: entity resolution by bare name alone is unsafe, and `entityType`/`endpointTypes` must be threaded through `queryIncomingRelations`/`storeRelationship` to avoid a newly created entity silently inheriting edges from an unrelated older entity sharing its name.

## Usage Guidelines

Any code path that writes online-learned entities should stamp or otherwise preserve origin metadata analogous to `source/subsystem='wave-analysis'`, since the current scheme distinguishes online from batch origin implicitly (by the stamp's absence) rather than via an explicit field — a fragile convention worth making explicit if extended. Writers must resolve entities by `(name, entityType)` rather than name alone, per the km-core-adapter.ts discipline. Given that IntentSpineDerivation and LearningSourceClassification's actual logic files were not retrieved here, engineers should treat this document as a structural map rather than an implementation guide, and consult `learning-source.ts`, `vokb-palette`, and the intent-spine producer script directly before making changes to online-learning behavior.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- Intent Spine Derivation Pipeline work record establishes a single consolidated producer script folding five prior ad-hoc scripts into one, clustering insights into Intent entities
- UKB Insight Generation Pipeline work record establishes evidence gating so insight documents are only written when sufficient real evidence exists, preventing empty stub Insight entities
- The Provenance Graph Consolidation (Wave Insight Persistence) work record establishes that Wave 4 batch analysis wrote 73 insight documents to disk but zero corresponding Insight-typed graph nodes, because the History UI filters strictly on `entityType='Insight'`. The fix stamped batch-produced entities with `source/subsystem='wave-analysis'` at write time — which implies the inverse case (an entity without that stamp) is how online-learned insights are distinguished from batch ones, consistent with the `isOnlineLearned` flag surfaced in D3GraphCanvas.tsx.
- The duplicate-name entity anchoring bug record establishes that `findEntityByName`'s prior 'oldest wins' resolution let a newly created Detail-typed entity silently inherit 24 edges from an unrelated older SubComponent sharing the same name, fixed in km-core-adapter.ts by threading `entityType`/`endpointTypes` through `queryIncomingRelations`/`storeRelationship`. This establishes entityType disambiguation as a required discipline for any online-learning write path that resolves entities by name rather than id, since bare-name lookup is unsafe under the current schema.

## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- [SESSION] Wave Insight Persistence work record establishes that Wave 4 was writing 73 insight documents but zero Insight graph nodes, meaning History UI (which filters to entityType='Insight') could never show batch results — fixed by explicitly creating Insight entities stamped with source/subsystem='wave-analysis'

### Children
- [IntentSpineDerivation](./IntentSpineDerivation.md) -- [SESSION] The Intent Spine Derivation Pipeline work record establishes that the current producer is a single consolidated script folding five prior ad-hoc scripts into one, clustering insights into Intent entities — none of the five predecessor scripts or the consolidated one appear in the supplied code files, so the pipeline's actual clustering logic is not evidenced here.
- [LearningSourceClassification](./LearningSourceClassification.md) -- [LLM] The only reference to a learning-source classification predicate in the retrieved evidence is the import of `isOnlineLearned` from './learning-source' in integrations/unified-viewer/src/graph/D3GraphCanvas.tsx, used alongside `ONLINE_RING_COLOR` to render a visual ring on online-learned entities. The module that actually defines `isOnlineLearned` and its classification logic is not present in any retrieved file.

### Siblings
- [WaveInsightPersistence](./WaveInsightPersistence.md) -- [SESSION] Wave Insight Persistence work record establishes that Wave 4 was writing 73 insight documents but zero Insight graph nodes, fixed by explicitly creating Insight entities stamped with source/subsystem='wave-analysis'
- [GraphDatabaseService](./GraphDatabaseService.md) -- [LLM] None of the supplied files contain a GraphDatabaseService class, module, or method. config/knowledge-management.json declares the storage backend the service presumably wraps ('database': { 'type': 'graphology-level', 'path': '.data/knowledge-graph', 'options': { 'multi': true, 'valueEncoding': 'json' } }), but this is configuration data consumed by some unseen service, not the service's implementation — there is no _persistGraphToLevel(), no findEntityByName, no <AWS_SECRET_REDACTED> in any file above, despite the parent context naming those exact methods as the site of two recent bugfixes.
- [ManualLearning](./ManualLearning.md) -- [LLM] None of the supplied code files contain a class, type, string literal, or module named "ManualLearning": config/knowledge-management.json only configures embeddings, ontology layers, and inference budgets; integrations/system-health-dashboard/src/components/ukb-workflow-modal.tsx and src/store/slices/ukbSlice.ts model the UKB batch-workflow UI (StepInfo, UKBProcess, WorkflowExecutionState); integrations/unified-viewer/src/graph/D3GraphCanvas.tsx renders the force-directed knowledge graph; and hierarchy-parents.test.ts tests deriveParents over System/Project/Component/Detail/Insight hierarchy classes. This is parent-component and sibling-component material for KnowledgeManagement, not ManualLearning's own implementation.
- [GraphifyGraph](./GraphifyGraph.md) -- [LLM] None of the supplied code files implement or reference GraphifyGraph. integrations/system-health-dashboard/src/components/ukb-workflow-modal.tsx and integrations/system-health-dashboard/src/store/slices/ukbSlice.ts belong to the UKB workflow dashboard UI (workflow progress, ETA calculation, Redux state for run history); integrations/unified-viewer/src/graph/D3GraphCanvas.tsx and integrations/unified-viewer/src/graph/hierarchy-parents.test.ts belong to the unified-viewer's D3/force-directed rendering and hierarchy-derivation logic. None of the four imports, calls, or mentions integrations/semantic-analysis/src/agents/graphify-graph.ts, GraphifyGraph, EntityKind, or graph.json — the artifacts the parent context says define this component.
- [KmCoreMigration](./KmCoreMigration.md) -- [SESSION] UKB Backfill and Metadata Repair Pipeline work record describes a dry-run-then-production migration pattern against the live entity store to repair parent-metadata clobbering
- [UnifiedViewerGraphRendering](./UnifiedViewerGraphRendering.md) -- [SESSION] Unified Viewer — Intent-to-Code Drill-Down work record establishes drill-down from an intent-level entity to underlying code files, surfaced directly in the detail panel
- [UkbWorkflowDashboard](./UkbWorkflowDashboard.md) -- [SESSION] Unified Viewer — Intent-to-Code Drill-Down work record notes drill-down from intent-level entities to code files is surfaced in this dashboard's detail panel rather than only abstract text


---

*Generated from 11 observations*
