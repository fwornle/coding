# IncrementalAnalysisWorkflowParams

**Type:** Detail

scope.commits.map(c => c.sha) and scope.sessions.map(s => s.path) show the incremental workflow expects lightweight commit/session descriptors from GapAnalyzer rather than full objects

# IncrementalAnalysisWorkflowParams — Technical Insight Document

## What It Is

`IncrementalAnalysisWorkflowParams` is the parameter contract constructed inside `WorkflowOrchestrator.executeIncrementalWorkflow()` (lib/ukb-unified/core/WorkflowOrchestrator.js). It defines the shape of data passed to `mcp__semantic_analysis__execute_workflow` when running the `'incremental-analysis'` workflow. Rather than being a standalone class, it is best understood as a structured parameters object — assembled from a gap scope (containing `sinceCommit`, `commits`, `sessions`) — that bridges the gap-detection layer and the semantic analysis execution layer. It belongs conceptually to the `OnlineLearning` component, which relies on it to drive automated, incremental extraction runs rather than full re-analysis.

## Architecture and Design

The design follows a **normalization-at-the-boundary** pattern: instead of passing full commit or session objects across the workflow boundary, `executeIncrementalWorkflow()` maps them down to lightweight descriptors — `scope.commits.map(c => c.sha)` and `scope.sessions.map(s => s.path)`. This indicates an architectural expectation that `GapAnalyzer` (the presumed producer of `scope`) deals in richer objects, while the workflow execution layer only needs identifiers/paths, minimizing payload size and decoupling the workflow's parameter schema from the internal representation used elsewhere in the system.

A second pattern is **defensive default enforcement at construction time**: numeric tuning parameters (`maxCommits`, `maxSessions`, `significanceThreshold`) are resolved via `||` fallback expressions directly in the parameter-building code, ensuring the workflow always receives sane bounds even if the caller/options object is incomplete.

A third pattern is **environment-aware defaulting for repository context**: `repository: scope.codingRepo || process.cwd()` ties the workflow's target repository to whatever the caller specifies, falling back to the process's current working directory. This keeps the workflow usable both in explicit multi-repo contexts and in simple single-repo CLI invocations.

## Implementation Details

The core mechanics live in `executeIncrementalWorkflow()`, which builds a `workflow_name: 'incremental-analysis'` payload with the following fields: `sinceCommit`, `sinceTimestamp`, `commits` (mapped to `.sha`), `sessions` (mapped to `.path`), `maxCommits`, `maxSessions`, `significanceThreshold`, and `repository`. The mapping operations (`.map(c => c.sha)`, `.map(s => s.path)`) are the key transformation step, converting whatever object shape `GapAnalyzer` produces into simple scalar arrays suitable for transport to the `mcp__semantic_analysis__execute_workflow` call.

Default values are hardcoded as fallback literals: 100 for `maxCommits`, 50 for `maxSessions`, and 5 for `significanceThreshold`. These are not configurable via external config files per the observations — they live inline in the parameter-construction logic, meaning any change to defaults requires touching `WorkflowOrchestrator.js` directly.

The `repository` field's fallback to `process.cwd()` implies this parameter set is often constructed in CLI or local-execution contexts where no explicit repo path is threaded through, reinforcing that the params object is designed to work correctly with minimal caller input.

## Integration Points

`IncrementalAnalysisWorkflowParams` sits between three system components. Upstream, it depends on a **gap scope** object (produced by `GapAnalyzer`, based on `sinceCommit`, `commits`, `sessions` fields) — the params object is essentially a transformation/adaptation layer over that scope. Downstream, it feeds `mcp__semantic_analysis__execute_workflow`, the actual execution entry point for the `'incremental-analysis'` workflow.

Sibling entity `UKBCliDefaultCommand` (`UKBCli.defaultCommand()`) is relevant context: it calls `checkpointManager.loadCheckpoint()` and inspects `checkpoint.lastSuccessfulRun` to distinguish first-run from incremental scenarios. This suggests `IncrementalAnalysisWorkflowParams` is only constructed in the incremental branch of that decision — first runs likely bypass this parameter set entirely in favor of a full-analysis workflow. The parent `OnlineLearning` component is the conceptual owner tying together the checkpoint-driven decision (via `UKBCliDefaultCommand`) and the parameter construction (via `WorkflowOrchestrator`).

## Usage Guidelines

Callers building a gap scope for this workflow should ensure `commits` and `sessions` arrays contain objects with `.sha` and `.path` properties respectively, since these are extracted via `.map()` without additional validation — malformed objects will silently produce `undefined` entries. When overriding tuning parameters, pass `maxCommits`, `maxSessions`, or `significanceThreshold` explicitly through `options`; omitting them is safe due to the enforced defaults (100/50/5) but relying on implicit defaults across environments could cause inconsistent incremental analysis granularity. For `repository`, explicitly setting `scope.codingRepo` is recommended in any multi-repo or non-interactive context, since the `process.cwd()` fallback ties behavior to process invocation location — a potential source of subtle bugs if the workflow is triggered from an unexpected working directory. Finally, since this params object is only used in the incremental path (as opposed to first-run handling in `UKBCliDefaultCommand`), ensure checkpoint state (`checkpoint.lastSuccessfulRun`) is correctly populated before relying on this workflow being invoked.


## Hierarchy Context

### Parent
- [OnlineLearning](./OnlineLearning.md) -- lib/ukb-unified/core/WorkflowOrchestrator.js executeIncrementalWorkflow() builds workflow_name: 'incremental-analysis' parameters from a gap scope (sinceCommit, commits, sessions) and calls mcp__semantic_analysis__execute_workflow to run automated extraction

### Siblings
- [WorkflowOrchestrator](./WorkflowOrchestrator.md) -- executeIncrementalWorkflow() builds workflow_name: 'incremental-analysis' with parameters sinceCommit, sinceTimestamp, commits (mapped to sha), sessions (mapped to path), maxCommits, maxSessions, significanceThreshold
- [UKBCliDefaultCommand](./UKBCliDefaultCommand.md) -- UKBCli.defaultCommand() calls this.checkpointManager.loadCheckpoint() and checks checkpoint.lastSuccessfulRun to detect first-run vs incremental scenarios


---

*Generated from 3 observations*
