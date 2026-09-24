# DynamicEtaCalculation

**Type:** Detail

## What It Is

DynamicEtaCalculation refers to the ETA (estimated-time-remaining) estimation logic centered on `calculateDynamicEta()` in `integrations/system-health-dashboard/src/components/ukb-workflow-modal.tsx`, along with its legacy companion `calculateStepAwareEta()` and helper functions `getStepMedianDuration()` and `calculateMedian()` defined in the same file. It is a component of the broader UkbWorkflowDashboard, computing a live estimate of remaining time for a UKB workflow run as it progresses through batch processing and finalization phases.

## Architecture and Design

The core design is a **multi-branch state machine estimator**: `calculateDynamicEta()` selects among three estimation regimes based on `isInFinalization` and `remainingBatches` — a batch phase (multiplying `remainingBatches` by `learnedAvgBatchMs`, plus a finalization buffer), a finalization phase (summing `getStepMedianDuration()` across `process.steps`, with running steps weighted at 50%), and a fallback linear-interpolation phase using `totalElapsedMs` and `progressPercent`. Each branch draws from a distinct data source (`batchIterations`, `process.steps`, or elapsed/progress), so estimation accuracy varies by workflow phase.

A second pattern is **confidence-weighted averaging**: rather than a flat mean, `learnedAvgBatchMs` applies a ×1.2 "be conservative" multiplier when only one batch has completed, falling back through a graceful degradation cascade — current-run data → `workflowStats?.avgBatchDurationMs` → a rough `totalElapsedMs / currentBatch` estimate — as data sources become unavailable.

A third pattern is **defense-in-depth clamping**: outputs pass through a relative sanity bound (`Math.max(linearEtaMs * 0.3, Math.min(linearEtaMs * 2.0, etaMs))`) layered under an absolute `MIN_ETA_MS`/`MAX_ETA_MS` (1s–30min) clamp, guarding against both moderate drift and pathological inputs like `progressPercent` near zero.

Finally, `calculateStepAwareEta()` embodies a **legacy shim/delegation pattern**, preserving an older call signature (no `progressPercent` parameter) while internally delegating to `calculateDynamicEta()`, avoiding a caller-wide migration.

## Implementation Details

`calculateDynamicEta()`'s batch-phase branch multiplies remaining batches by the learned average and adds `workflowStats?.avgFinalizationDurationMs` (default 60000ms). The finalization branch relies on `getStepMedianDuration()` and `calculateMedian()` to compute per-step estimates from `process.steps`. The fallback computes `linearEtaMs = totalElapsedMs * ((100 - progressPercent) / progressPercent)`. All tuning constants — the 1.2× multiplier, 60000ms default, 0.3x/2.0x sanity bounds, and 1s/30min absolute bounds — are hardcoded literals inside the function body, not externalized configuration. A code comment notes the minimum bound was deliberately lowered from 5s to 1s "to let it show accurate small numbers," evidence of past over-smoothing being corrected.

## Integration Points

The function depends on three independently-shaped data structures — `UKBProcess.batchProgress`, `UKBProcess.batchIterations`, and `WorkflowTimingStats`, defined in `integrations/system-health-dashboard/src/store/slices/ukbSlice.ts`. Because these fields are optional, upstream type changes can silently degrade ETA accuracy without compile errors. Within its parent UkbWorkflowDashboard, DynamicEtaCalculation sits alongside sibling concerns WorkflowHistoryPagination (the `HISTORY_PAGE_SIZE` constant in the same file) and IntentToCodeDrillDown — both reflecting the dashboard's recurring theme of ensuring displayed derived numbers (counts, aggregates, estimates) faithfully represent underlying state, as also seen in the "UKB Summary — totalCommits Calculation" work distinguishing single-batch, current-run, and full-run-history scopes.

## Usage Guidelines

Developers modifying `calculateDynamicEta()` must keep `calculateStepAwareEta()`'s signature compatible or update it in lockstep, since it's a thin wrapper kept for existing call sites. Any retuning of constants (the 1.2× factor, 60000ms default, clamp bounds) requires direct code edits since nothing is externalized. Because the ETA functions live inline in `ukb-workflow-modal.tsx` rather than an extracted estimation module, changes to `ukbSlice.ts` data structures should be cross-checked against this file's assumptions — optional fields can silently degrade estimate quality without a compile-time signal.


## Work Record

What working sessions recorded about this entity — decisions taken, problems hit, and why things are the way they are:

- The 'System Health Dashboard — Workflow History Page-Size Limit' work record, filed about UkbWorkflowDashboard, establishes that a single page-size constant (HISTORY_PAGE_SIZE) in this same file previously gated how many historical workflow records were retrievable, silently making the oldest batch-analysis run unreachable while the UI reported an incomplete count as if it were the total. This sits in the same file as calculateDynamicEta() and reflects the same class of risk the ETA function's own defensive clamps are guarding against: a computed/displayed number (a count, or here an estimate) can silently misrepresent the underlying state if the function producing it isn't bounded or cross-checked against a known-good baseline.
- The 'UKB Summary — totalCommits Calculation' work record, also filed about UkbWorkflowDashboard, establishes that summary aggregate metrics for a UKB run needed correction to reflect true cumulative activity across an entire run rather than a single batch or zero — the same distinction calculateDynamicEta() draws between per-run 'learned' batch durations (`learnedAvgBatchMs`, scoped to `batchIterations` in the CURRENT run) and historical-average fallbacks (`workflowStats?.avgBatchDurationMs`). Both concerns are examples of this dashboard needing to correctly distinguish single-batch, current-run, and full-run-history scopes when computing any derived number for the UI.

## Hierarchy Context

### Parent
- [UkbWorkflowDashboard](./UkbWorkflowDashboard.md) -- [SESSION] Unified Viewer — Intent-to-Code Drill-Down work record notes drill-down from intent-level entities to code files is surfaced in this dashboard's detail panel rather than only abstract text

### Siblings
- [WorkflowHistoryPagination](./WorkflowHistoryPagination.md) -- [SESSION] System Health Dashboard — Workflow History Page-Size Limit: undersized page-size constants make specific cards/records/reports unreachable in the UI even though the underlying data exists.
- [IntentToCodeDrillDown](./IntentToCodeDrillDown.md) -- [SESSION] Unified Viewer — Intent-to-Code Drill-Down: lets users drill from an intent-level entity in the graph to the underlying code files that evidence it, surfacing file-level traceability directly in the detail panel.
- [IntentSpineDerivation](./IntentSpineDerivation.md) -- [LLM] None of the four supplied code files implement, call, or import anything resembling an intent-spine derivation process. ukb-workflow-modal.tsx and ukbSlice.ts (integrations/system-health-dashboard/src/components and src/store/slices) implement the UKB *workflow-run* dashboard — history list, live progress, ETA estimation, Redux state for an executing pipeline. D3GraphCanvas.tsx and hierarchy-parents.test.ts (integrations/unified-viewer/src/graph) implement graph rendering and a DAG→tree parent-selection algorithm for a viewer UI. Neither pair touches deriving 'Intent' entities from a taxonomy or aggregating Insight nodes into an intent tree, which is what this component's name implies. This is a retrieval mismatch, not a thin component.


---

*Generated from 9 observations*
