# UkbWorkflowDashboard

**Type:** SubComponent

## What It Is

UkbWorkflowDashboard is implemented primarily in `integrations/system-health-dashboard/src/components/ukb-workflow-modal.tsx`, with its Redux state modeled in `integrations/system-health-dashboard/src/store/slices/ukbSlice.ts`. Although the entity graph names it "UkbWorkflowDashboard," the concrete file is `ukb-workflow-modal.tsx`, a Dialog-based component (`UKBWorkflowModalProps: open, onOpenChange, processes, apiBaseUrl`) that composes History, Progress, Statistics, and Graph views into a single tabbed modal using Radix/shadcn primitives (Dialog, Tabs, ScrollArea, Progress, Card). This is the UI surface that lets an operator inspect both live and historical UKB batch-analysis workflow runs, and it sits under the KnowledgeManagement parent alongside siblings like WaveInsightPersistence and GraphDatabaseService.

![UkbWorkflowDashboard — Architecture](images/ukb-workflow-dashboard-architecture.png)

## Architecture and Design

The component follows a tabbed-dashboard-in-modal pattern, delegating graph and trace rendering to imported subcomponents (`MultiAgentGraph` aliased as `UKBWorkflowGraph`, `WorkflowLegend`, `TraceModal`, `UKBNodeDetailsSidebar`) pulled from a local `./workflow` barrel rather than implementing that logic inline. This keeps the modal itself focused on layout/orchestration while pushing rendering complexity into dedicated files.

State management runs through Redux Toolkit (`createSlice`/`createSelector` in `ukbSlice.ts`), which is a deliberate contrast to the Zustand-based `useViewerStore` in the separate unified-viewer package — the two packages share no imports and use different rendering engines (D3 force simulation vs. Tabs/Progress), confirming they are architecturally distinct despite thematic overlap.

A notable design tension is the coexistence of two parallel state representations in `ukbSlice.ts`: a newer event-driven `WorkflowExecutionState` (workflowId, stepStatuses, substepStatuses, batchProgress, fed by `useWorkflowWebSocket`) and an older polling-based `UKBProcess` shape (pid, isAlive, health, heartbeatAgeSeconds, batchIterations). This dual-shape arrangement reflects an in-progress migration rather than a finished design, and it's something future maintainers should expect to eventually consolidate.

## Implementation Details

Its children encapsulate the dashboard's most complex logic. DynamicEtaCalculation covers `calculateDynamicEta()`, a three-branch estimator: a batch phase (remaining batches × `learnedAvgBatchMs`, plus a defaulted `avgFinalizationDurationMs`), a finalization phase (summing `getStepMedianDuration()` over pending/running `process.steps`, with running steps counted at half duration), and a linear-interpolation fallback (`linearEtaMs`). The function applies a conservative ×1.2 multiplier when only one batch has completed, then clamps its result against the linear baseline (0.3x–2.0x) and absolute `MIN_ETA_MS`/`MAX_ETA_MS` bounds (1s–30min) — a defensive design against noisy early-run estimates. The older `calculateStepAwareEta()` is explicitly commented as a legacy shim that now delegates to `calculateDynamicEta`, preserving call-site compatibility during the API migration.

WorkflowHistoryPagination corresponds to the `HISTORY_PAGE_SIZE` constant, whose fix (raising the limit from 50 to 500) is documented directly in code comments: `/api/ukb/history` parses every report regardless of `limit` and only slices at the end, so raising the page size costs payload size, not server compute — a deliberate correctness-over-payload trade-off that previously made the oldest of 119 workflow reports permanently unreachable while the UI misleadingly reported "50 workflows found."

The `UKBProcess.llmMode` field is typed as `LLMMode | undefined` rather than boolean, explicitly to distinguish "server stated no mode" from "server stated public" — a tri-state design the old `mockLLM` boolean couldn't express, nor could it represent a "local" mode.

## Integration Points

![UkbWorkflowDashboard — Relationship](images/ukb-workflow-dashboard-relationship.png)

The dashboard's History tab is directly coupled to graph-node persistence correctness upstream: the parent KnowledgeManagement's WaveInsightPersistence fix established that Wave 4 batch analysis wrote 73 insight documents to storage while creating zero corresponding Insight-typed graph nodes, and since the History UI filters strictly on `entityType='Insight'`, an entire batch of analysis results was invisible despite existing on disk. This illustrates that document persistence and graph-node persistence are separate steps that must both be performed deliberately — exactly the failure class that silently under-reports history in this component.

IntentToCodeDrillDown is attributed to this component per its work record, enabling drill-down from an intent-level graph entity to underlying code files in a detail panel — though this logic is not visible in the supplied `ukb-workflow-modal.tsx`/`ukbSlice.ts` and likely lives in `UKBNodeDetailsSidebar` or `TraceModal`, referenced but not included in these observations.

IntentSpineDerivation is listed as a child but the supplied code shows no evidence of intent-clustering logic within this component's files; it appears to be a retrieval/graph-linkage artifact rather than something implemented inside `ukb-workflow-modal.tsx` itself.

## Usage Guidelines

Developers extending the History tab should be aware that its correctness depends on invariants outside this component's own code — specifically that graph nodes of type Insight are stamped correctly at write time (per WaveInsightPersistence's fix using `source/subsystem='wave-analysis'`), and that `HISTORY_PAGE_SIZE` stays ahead of actual report counts, since `/api/ukb/history` computation cost is independent of `limit`.

When modifying ETA logic, prefer extending `calculateDynamicEta()` directly rather than `calculateStepAwareEta()`, which exists solely for backward compatibility. Any new UKBProcess fields following the `llmMode` precedent should preserve tri-state semantics (undefined vs. explicit values) rather than collapsing to booleans when "not stated" is a meaningfully different state from a negative value. Finally, because the Redux-based state in `ukbSlice.ts` currently carries both `WorkflowExecutionState` and `UKBProcess` representations, new features should clarify which shape they're built against rather than assuming a single source of truth.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- Unified Viewer — Intent-to-Code Drill-Down work record notes drill-down from intent-level entities to code files is surfaced in this dashboard's detail panel rather than only abstract text
- The Provenance Graph Consolidation (Stage 6) work record establishes that Wave 4 batch analysis wrote 73 insight documents to storage while creating zero corresponding Insight-typed graph nodes, and because the History UI filters strictly on entityType='Insight', an entire batch of wave-analysis conclusions was invisible in the UI despite existing on disk. This is directly relevant to the History tab this component renders: the fix (stamping Insight entities with source/subsystem='wave-analysis' at write time) established that document persistence and graph-node persistence are separate steps in this system that must both be performed deliberately, which is exactly the class of bug that would make the History tab in ukb-workflow-modal.tsx silently under-report completed work.
- The Unified Viewer — Intent-to-Code Drill-Down work record, filed specifically 'about UkbWorkflowDashboard', establishes that users can drill down from an intent-level entity in the graph to the underlying code files that evidence it, surfacing file-level traceability directly in a detail panel rather than only abstract intent/observation text. No drill-down-to-code-file logic is visible in the supplied ukb-workflow-modal.tsx/ukbSlice.ts, so this specific feature is evidenced only by the work record, not by the retrieved code — it may live in the UKBNodeDetailsSidebar or TraceModal components referenced but not included here.

## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- [SESSION] Wave Insight Persistence work record establishes that Wave 4 was writing 73 insight documents but zero Insight graph nodes, meaning History UI (which filters to entityType='Insight') could never show batch results — fixed by explicitly creating Insight entities stamped with source/subsystem='wave-analysis'

### Children
- [WorkflowHistoryPagination](./WorkflowHistoryPagination.md) -- [SESSION] System Health Dashboard — Workflow History Page-Size Limit: undersized page-size constants make specific cards/records/reports unreachable in the UI even though the underlying data exists.
- [DynamicEtaCalculation](./DynamicEtaCalculation.md) -- [LLM] calculateDynamicEta() in integrations/system-health-dashboard/src/components/ukb-workflow-modal.tsx branches into three distinct estimation regimes selected by `isInFinalization` and `remainingBatches`: a batch phase that multiplies `remainingBatches` by `learnedAvgBatchMs` and adds `workflowStats?.avgFinalizationDurationMs` (defaulting to 60000ms), a finalization phase that sums `getStepMedianDuration()` over pending/running steps from `process.steps` (with running steps counted at 50% duration), and a fallback that returns `linearEtaMs` computed from `totalElapsedMs * ((100 - progressPercent) / progressPercent)`. The three branches read from different data sources (batchIterations, process.steps, and elapsed/progress respectively), so the function's accuracy characteristics change depending on which phase of the workflow it is called during.
- [IntentToCodeDrillDown](./IntentToCodeDrillDown.md) -- [SESSION] Unified Viewer — Intent-to-Code Drill-Down: lets users drill from an intent-level entity in the graph to the underlying code files that evidence it, surfacing file-level traceability directly in the detail panel.
- [IntentSpineDerivation](./IntentSpineDerivation.md) -- [LLM] None of the four supplied code files implement, call, or import anything resembling an intent-spine derivation process. ukb-workflow-modal.tsx and ukbSlice.ts (integrations/system-health-dashboard/src/components and src/store/slices) implement the UKB *workflow-run* dashboard — history list, live progress, ETA estimation, Redux state for an executing pipeline. D3GraphCanvas.tsx and hierarchy-parents.test.ts (integrations/unified-viewer/src/graph) implement graph rendering and a DAG→tree parent-selection algorithm for a viewer UI. Neither pair touches deriving 'Intent' entities from a taxonomy or aggregating Insight nodes into an intent tree, which is what this component's name implies. This is a retrieval mismatch, not a thin component.

### Siblings
- [WaveInsightPersistence](./WaveInsightPersistence.md) -- [SESSION] Wave Insight Persistence work record establishes that Wave 4 was writing 73 insight documents but zero Insight graph nodes, fixed by explicitly creating Insight entities stamped with source/subsystem='wave-analysis'
- [GraphDatabaseService](./GraphDatabaseService.md) -- [LLM] None of the supplied files contain a GraphDatabaseService class, module, or method. config/knowledge-management.json declares the storage backend the service presumably wraps ('database': { 'type': 'graphology-level', 'path': '.data/knowledge-graph', 'options': { 'multi': true, 'valueEncoding': 'json' } }), but this is configuration data consumed by some unseen service, not the service's implementation — there is no _persistGraphToLevel(), no findEntityByName, no <AWS_SECRET_REDACTED> in any file above, despite the parent context naming those exact methods as the site of two recent bugfixes.
- [OnlineLearning](./OnlineLearning.md) -- [SESSION] Intent Spine Derivation Pipeline work record establishes a single consolidated producer script folding five prior ad-hoc scripts into one, clustering insights into Intent entities
- [ManualLearning](./ManualLearning.md) -- [LLM] None of the supplied code files contain a class, type, string literal, or module named "ManualLearning": config/knowledge-management.json only configures embeddings, ontology layers, and inference budgets; integrations/system-health-dashboard/src/components/ukb-workflow-modal.tsx and src/store/slices/ukbSlice.ts model the UKB batch-workflow UI (StepInfo, UKBProcess, WorkflowExecutionState); integrations/unified-viewer/src/graph/D3GraphCanvas.tsx renders the force-directed knowledge graph; and hierarchy-parents.test.ts tests deriveParents over System/Project/Component/Detail/Insight hierarchy classes. This is parent-component and sibling-component material for KnowledgeManagement, not ManualLearning's own implementation.
- [GraphifyGraph](./GraphifyGraph.md) -- [LLM] None of the supplied code files implement or reference GraphifyGraph. integrations/system-health-dashboard/src/components/ukb-workflow-modal.tsx and integrations/system-health-dashboard/src/store/slices/ukbSlice.ts belong to the UKB workflow dashboard UI (workflow progress, ETA calculation, Redux state for run history); integrations/unified-viewer/src/graph/D3GraphCanvas.tsx and integrations/unified-viewer/src/graph/hierarchy-parents.test.ts belong to the unified-viewer's D3/force-directed rendering and hierarchy-derivation logic. None of the four imports, calls, or mentions integrations/semantic-analysis/src/agents/graphify-graph.ts, GraphifyGraph, EntityKind, or graph.json — the artifacts the parent context says define this component.
- [KmCoreMigration](./KmCoreMigration.md) -- [SESSION] UKB Backfill and Metadata Repair Pipeline work record describes a dry-run-then-production migration pattern against the live entity store to repair parent-metadata clobbering
- [UnifiedViewerGraphRendering](./UnifiedViewerGraphRendering.md) -- [SESSION] Unified Viewer — Intent-to-Code Drill-Down work record establishes drill-down from an intent-level entity to underlying code files, surfaced directly in the detail panel


---

*Generated from 11 observations*
