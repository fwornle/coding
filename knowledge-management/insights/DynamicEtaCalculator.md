# DynamicEtaCalculator

**Type:** Detail

[LLM] calculateDynamicEta() in integrations/system-health-dashboard/src/components/ukb-workflow-modal.tsx implements a two-regime estimator that switches behavior based on process.batchProgress.currentBatch versus totalBatches: when currentBatch < totalBatches it is in the 'BATCH PHASE' and computes remainingBatches * learnedAvgBatchMs plus workflowStats?.avgFinalizationDurationMs (defaulting to 60000ms), then further refines by estimating time-left-in-current-batch using the fraction of completed steps in the last entry of batchIterations. When currentBatch >= totalBatches && totalBatches > 0 it switches to 'FINALIZATION PHASE' and instead sums getStepMedianDuration() per pending/running step from process.steps, applying a flat 50% completion assumption for any step in 'running' status. This is a hand-rolled piecewise model with no shared abstraction between the two phases — the finalization branch does not reuse learnedAvgBatchMs at all, and the batch branch does not use per-step medians, so the two estimation strategies could silently diverge in units or accuracy without either one being tested against the other.

# DynamicEtaCalculator — Technical Insight Document

## What It Is

DynamicEtaCalculator refers to the ETA-prediction logic centered on `calculateDynamicEta()`, implemented as a module-level free function in `integrations/system-health-dashboard/src/components/ukb-workflow-modal.tsx`. It is the primary detail component beneath the **OnlineLearning** parent, and rather than being a general-purpose learning engine, it is an operator-facing predictor that estimates remaining time for a multi-batch wave-analysis workflow. It is accompanied by a legacy wrapper, `calculateStepAwareEta()`, and two statistical helpers, `calculateMedian()` and `getStepMedianDuration()`, all colocated in the same UI component file rather than a dedicated ETA module.

## Architecture and Design

The core design is a **phase-based strategy switch**: `calculateDynamicEta()` branches into a 'BATCH PHASE' when `process.batchProgress.currentBatch < totalBatches`, and a 'FINALIZATION PHASE' once `currentBatch >= totalBatches`. Each phase implements an independent estimation strategy with its own data source — the batch phase uses `learnedAvgBatchMs` (an arithmetic mean over `batchIterations`), while the finalization phase sums `getStepMedianDuration()` across pending/running `process.steps`. This is a case of **online/incremental learning**, since `learnedAvgBatchMs` is recomputed from batches completed within the current run itself, consistent with the parent OnlineLearning entity's characterization as an "exponential-refinement pattern applied to progress estimation."

The function also demonstrates **defensive output clamping** as a substitute for upstream input validation: rather than guarding all inputs strictly, it computes a `linearEtaMs` sanity baseline and clamps the final result into `[linearEtaMs * 0.3, linearEtaMs * 2.0]`, then applies a second absolute clamp to `[MIN_ETA_MS, MAX_ETA_MS]`. Separately, `calculateStepAwareEta()` exemplifies a **strangler-fig/legacy-delegate pattern**, explicitly documented as forwarding to `calculateDynamicEta()` for backward compatibility.

## Implementation Details

The learning mechanism inside `calculateDynamicEta()` treats a batch as "complete" only when every step in `batch.steps` is `'completed'` or `'skipped'`, then divides total duration by `completedBatchCount`. Confidence handling is hardcoded per sample size: `>= 2` samples yields a plain average, exactly `1` sample is multiplied by an undocumented 1.2x conservatism factor, and `0` samples falls back through `workflowStats?.avgBatchDurationMs` or a rough `totalElapsedMs / currentBatch` estimate — a **graceful-degradation fallback chain**. This learning state is not persisted; it resets on every invocation, so the 1.2x heuristic is reapplied identically on each run's second batch rather than being empirically refined.

The finalization phase leans on `calculateMedian()` (a parity-aware, outlier-resistant median) via `getStepMedianDuration()`, which prefers `workflowStats.steps[stepName].recentDurations` and falls back to `step.avgDurationMs`. Notably, any step in `'running'` status is assumed to be at a flat 50% completion. A fallback-of-last-resort inside this phase (triggered when `etaMs === 0`) computes `finProgress` using a hardcoded assumption of exactly 8 steps per batch — a figure not derived from the `AGENT_SUBSTEPS` registry in `multi-agent-graph.tsx`, which defines variable substep counts per agent (7 for `kg_operators`, 4 for `insight_generation`).

## Integration Points

`calculateStepAwareEta()` integrates with `calculateDynamicEta()` as its sole call target, independently recomputing `progressPercent` before delegating — meaning two code paths must agree on progress derivation. `getStepMedianDuration()` integrates with `workflowStats.steps` and `calculateMedian()`. The hardcoded "8 steps per batch" assumption implicitly depends on (but doesn't reference) the `AGENT_SUBSTEPS` registry in `multi-agent-graph.tsx`, representing a fragile, unvalidated cross-file coupling.

## Usage Guidelines

Developers should treat `calculateStepAwareEta()` as a deprecation target: it directly violates this repository's CLAUDE.md rule against legacy-suffixed parallel functions, and its callers should be migrated to `calculateDynamicEta()` directly. Anyone modifying the sanity clamp should reconcile the JSDoc (which claims a 50% floor) with the actual 30% (`* 0.3`) enforced in code. The 8-steps-per-batch assumption should be replaced with a reference to `AGENT_SUBSTEPS` or otherwise validated/logged to catch drift. Given the statistical asymmetry between phases (mean vs. median), future work should consider unifying estimation rigor, and given the coupling of ETA logic into a UI component file, extraction into a dedicated ETA-calculation module would improve testability and maintainability.


## Hierarchy Context

### Parent
- [OnlineLearning](./OnlineLearning.md) -- [LLM] The OnlineLearning subcomponent's most detailed artifact, integrations/system-health-dashboard/src/components/ukb-workflow-modal.tsx, is not a learning engine itself but an operator-facing ETA/progress predictor for the wave-analysis workflow. `calculateDynamicEta()` implements a genuine online-learning loop: it computes `learnedAvgBatchMs` from batches completed *within the current run* (falling back to historical `workflowStats.avgBatchDurationMs` only when zero batches have finished), then blends that live estimate with a `linearEtaMs` sanity check that clamps the result to `[linearEtaMs * 0.3, linearEtaMs * 2.0]`. This is a textbook exponential-refinement pattern applied to progress estimation rather than model weights — the system 'learns' the current run's throughput characteristics and self-corrects as more batches complete, with `completedBatchCount === 1` handled specially (a 1.2x conservative multiplier) to avoid overfitting to a single noisy sample.


---

*Generated from 9 observations*
