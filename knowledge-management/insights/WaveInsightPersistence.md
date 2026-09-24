# WaveInsightPersistence

**Type:** SubComponent

## What It Is

WaveInsightPersistence is documented only at the level of a session/work record — "Wave Insight Persistence work record" — describing a fix within KnowledgeManagement, but none of the retrieved code files (config/knowledge-management.json, ukb-workflow-modal.tsx, ukbSlice.ts, D3GraphCanvas.tsx, hierarchy-parents.test.ts) implement or reference it, its write path, `findEntityByName`, or `km-core-adapter.ts` directly. The observations are explicit that the actual fix location — `integrations/semantic-analysis/src/storage/km-core-adapter.ts` — was named in the session record but was "not present in retrieved files."

## Architecture and Design

INSUFFICIENT_EVIDENCE: the retrieved files are downstream consumers (dashboard UI, viewer hierarchy tests) and the parent's configuration, not WaveInsightPersistence's own implementation, so its architecture cannot be described from source without inference.


## Code Evidence

Key code artifacts grounding this entity's analysis:

- [LLM] None of the retrieved code files implement or reference WaveInsightPersistence, findEntityByName, km-core-adapter.ts, or any Insight-node write path. The five files supplied — config/knowledge-management.json, ukb-workflow-modal.tsx, ukbSlice.ts, D3GraphCanvas.tsx, and hierarchy-parents.test.ts — are dashboard/viewer surfaces that consume the graph after the fact (workflow progress UI, Redux state shape, D3 force-graph rendering, and hierarchy-derivation tests), not the wave-analysis write path the parent's session records describe. The <code_graph> block is also empty, so no [LLM+CGR] observations can be made.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- Wave Insight Persistence work record establishes that Wave 4 was writing 73 insight documents but zero Insight graph nodes, fixed by explicitly creating Insight entities stamped with source/subsystem='wave-analysis'
- History UI filters to entityType='Insight', so without graph-node creation, batch results could never surface in that view regardless of document output
- UKB Backfill and Metadata Repair Pipeline work record documents repairing parent-metadata clobbering after large-scale UKB backfill runs to keep entity store and History UI consistent
- Provenance Graph Consolidation — Multi-Stage Pipeline (Stage 6) establishes that Wave 4 batch analysis was writing 73 insight documents to storage while creating zero corresponding Insight-typed graph nodes. Because the History UI filters strictly on entityType='Insight', an entire batch of wave-analysis conclusions existed on disk but was invisible in the UI — the document layer and graph layer had silently diverged. The fix explicitly creates Insight entities stamped with source/subsystem='wave-analysis' at write time, establishing that in this system document persistence and graph-node persistence are two separate steps that must both be performed deliberately.
- The duplicate-name entity anchoring bug documented in the work record shows findEntityByName previously resolved purely by name with 'oldest wins' semantics, causing a newly created Detail-typed entity to silently inherit 24 pre-existing edges from an unrelated older SubComponent entity sharing the same name. The fix, in km-core-adapter.ts (integrations/semantic-analysis/src/storage/km-core-adapter.ts), threads an optional entityType/endpointTypes parameter through queryIncomingRelations and storeRelationship so relationship writes bind to the entity of the correct type rather than the oldest namesake — establishing entityType disambiguation as a required discipline anywhere name-based entity lookup occurs.

## Diagrams

![WaveInsightPersistence — Architecture](images/wave-insight-persistence-architecture.png)

![WaveInsightPersistence — Relationship](images/wave-insight-persistence-relationship.png)


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- [SESSION] Wave Insight Persistence work record establishes that Wave 4 was writing 73 insight documents but zero Insight graph nodes, meaning History UI (which filters to entityType='Insight') could never show batch results — fixed by explicitly creating Insight entities stamped with source/subsystem='wave-analysis'

### Children
- [InsightHierarchyPlacement](./InsightHierarchyPlacement.md) -- [LLM+CGR] hierarchy-parents.test.ts's 'an Insight is a hierarchy class at Detail level' test asserts HIERARCHY_CLASSES.has('Insight') and HIERARCHY_LEVEL.Insight === HIERARCHY_LEVEL.Detail, and a companion test documents that before this change 'deriveParents emitted no parent for any of the 975 Insights in the live graph' — this is the actual InsightHierarchyPlacement logic present in the retrieved files, but it is viewer-side placement, not the write-path component the parent describes.
- [IntentInsightSpine](./IntentInsightSpine.md) -- [LLM] None of the five retrieved files — config/knowledge-management.json, integrations/system-health-dashboard/src/components/ukb-workflow-modal.tsx, integrations/system-health-dashboard/src/store/slices/ukbSlice.ts, integrations/unified-viewer/src/graph/D3GraphCanvas.tsx, and integrations/unified-viewer/src/graph/hierarchy-parents.test.ts — implement, import, or reference an entity, module, or symbol named IntentInsightSpine. They were selected by filename/topic proximity to 'insight' and 'intent', not because they contain this component's code.

### Siblings
- [GraphDatabaseService](./GraphDatabaseService.md) -- [LLM] None of the supplied files contain a GraphDatabaseService class, module, or method. config/knowledge-management.json declares the storage backend the service presumably wraps ('database': { 'type': 'graphology-level', 'path': '.data/knowledge-graph', 'options': { 'multi': true, 'valueEncoding': 'json' } }), but this is configuration data consumed by some unseen service, not the service's implementation — there is no _persistGraphToLevel(), no findEntityByName, no <AWS_SECRET_REDACTED> in any file above, despite the parent context naming those exact methods as the site of two recent bugfixes.
- [OnlineLearning](./OnlineLearning.md) -- [SESSION] Intent Spine Derivation Pipeline work record establishes a single consolidated producer script folding five prior ad-hoc scripts into one, clustering insights into Intent entities
- [ManualLearning](./ManualLearning.md) -- [LLM] None of the supplied code files contain a class, type, string literal, or module named "ManualLearning": config/knowledge-management.json only configures embeddings, ontology layers, and inference budgets; integrations/system-health-dashboard/src/components/ukb-workflow-modal.tsx and src/store/slices/ukbSlice.ts model the UKB batch-workflow UI (StepInfo, UKBProcess, WorkflowExecutionState); integrations/unified-viewer/src/graph/D3GraphCanvas.tsx renders the force-directed knowledge graph; and hierarchy-parents.test.ts tests deriveParents over System/Project/Component/Detail/Insight hierarchy classes. This is parent-component and sibling-component material for KnowledgeManagement, not ManualLearning's own implementation.
- [GraphifyGraph](./GraphifyGraph.md) -- [LLM] None of the supplied code files implement or reference GraphifyGraph. integrations/system-health-dashboard/src/components/ukb-workflow-modal.tsx and integrations/system-health-dashboard/src/store/slices/ukbSlice.ts belong to the UKB workflow dashboard UI (workflow progress, ETA calculation, Redux state for run history); integrations/unified-viewer/src/graph/D3GraphCanvas.tsx and integrations/unified-viewer/src/graph/hierarchy-parents.test.ts belong to the unified-viewer's D3/force-directed rendering and hierarchy-derivation logic. None of the four imports, calls, or mentions integrations/semantic-analysis/src/agents/graphify-graph.ts, GraphifyGraph, EntityKind, or graph.json — the artifacts the parent context says define this component.
- [KmCoreMigration](./KmCoreMigration.md) -- [SESSION] UKB Backfill and Metadata Repair Pipeline work record describes a dry-run-then-production migration pattern against the live entity store to repair parent-metadata clobbering
- [UnifiedViewerGraphRendering](./UnifiedViewerGraphRendering.md) -- [SESSION] Unified Viewer — Intent-to-Code Drill-Down work record establishes drill-down from an intent-level entity to underlying code files, surfaced directly in the detail panel
- [UkbWorkflowDashboard](./UkbWorkflowDashboard.md) -- [SESSION] Unified Viewer — Intent-to-Code Drill-Down work record notes drill-down from intent-level entities to code files is surfaced in this dashboard's detail panel rather than only abstract text


---

*Generated from 12 observations*
