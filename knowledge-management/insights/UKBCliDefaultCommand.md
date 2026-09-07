# UKBCliDefaultCommand

**Type:** Detail

The --full flag documented in showHelp() bypasses checkpoint-based gap scoping in favor of complete-analysis, contrasting with the default incremental path

# UKBCliDefaultCommand: Technical Insight Document

## What It Is

UKBCliDefaultCommand is the default command handler within the OnlineLearning component of the UKB CLI system. Its core responsibility, expressed through `UKBCli.defaultCommand()`, is to determine whether an analysis run should proceed as a first-run (full) scan or an incremental scan, and to decide whether any workflow execution is warranted at all. It acts as the decision-making entry point that sits upstream of the actual workflow execution logic implemented in the sibling `WorkflowOrchestrator`.

## Architecture and Design

The design follows a **gate-then-delegate** pattern: `defaultCommand()` does not perform analysis work itself but instead consults two collaborators — a `checkpointManager` and a `gapAnalyzer` — to decide *if* and *how* a workflow should run. This separates decision logic (in UKBCliDefaultCommand) from execution logic (in WorkflowOrchestrator), which builds the `incremental-analysis` workflow parameters and calls `mcp__semantic_analysis__execute_workflow`.

A key architectural decision is the checkpoint-based state model: rather than always scanning full history, the command loads a persisted checkpoint via `checkpointManager.loadCheckpoint()` and inspects `checkpoint.lastSuccessfulRun` to distinguish first-run from incremental scenarios. This is a classic incremental-processing pattern that trades simplicity (always full scan) for efficiency (scan only what's changed), with the `--full` flag serving as an explicit escape hatch to bypass this optimization when a complete-analysis is desired.

The gap-detection step introduces a second gate: even after establishing incremental context, the command calls `gapAnalyzer.getGapSummary(checkpoint)` and branches on `summary.hasGap` before invoking any workflow. This avoids unnecessary work when no meaningful gap exists, reflecting a design bias toward minimizing redundant analysis runs.

## Implementation Details

The command's control flow can be understood as a two-stage conditional pipeline:

1. **Checkpoint stage** — `loadCheckpoint()` retrieves prior run state; `checkpoint.lastSuccessfulRun` presence/absence determines first-run vs. incremental branching.
2. **Gap analysis stage** — `getGapSummary(checkpoint)` produces a `summary` object whose `hasGap` boolean governs whether downstream workflow execution is triggered.

The `--full` flag, documented in `showHelp()`, is handled as a mode override: it bypasses the checkpoint-derived gap scoping entirely, forcing a complete-analysis path instead of the default incremental path. This suggests the command's argument parsing includes conditional logic that short-circuits the checkpoint/gap-analysis pipeline when `--full` is present.

Neither the `checkpointManager` nor `gapAnalyzer` implementations are detailed in the observations, but their interfaces are clear: `checkpointManager` exposes `loadCheckpoint()`, and `gapAnalyzer` exposes `getGapSummary(checkpoint)` returning a summary with a `hasGap` flag.

## Integration Points

UKBCliDefaultCommand integrates directly with the `WorkflowOrchestrator`'s `executeIncrementalWorkflow()`, which is the consumer of the gap scope this command effectively gates access to. Although the observations don't show UKBCliDefaultCommand directly invoking `executeIncrementalWorkflow()`, the parent-child relationship within OnlineLearning implies that once `hasGap` is true, the gap scope (containing `sinceCommit`, `commits`, `sessions`) flows toward workflow construction.

This is corroborated by the sibling `IncrementalAnalysisWorkflowParams`, which expects lightweight descriptors — `scope.commits.map(c => c.sha)` and `scope.sessions.map(s => s.path)` — rather than full objects. This implies the `gapAnalyzer.getGapSummary()` output (or a related gap scope structure) is designed to supply minimal commit/session identifiers, keeping the interface between gap detection and workflow parameter-building lightweight and serialization-friendly.

## Usage Guidelines

Developers invoking or modifying UKBCliDefaultCommand should preserve the checkpoint-first decision order: always check `lastSuccessfulRun` before considering gap analysis, since the incremental/first-run distinction determines how gap analysis itself should be scoped. The `--full` flag must remain a clean bypass — it should skip both checkpoint interpretation and gap-summary branching, not just one of them, to guarantee true complete-analysis semantics as documented in `showHelp()`.

When extending gap-scope data passed downstream, maintain consistency with `IncrementalAnalysisWorkflowParams`' expectation of lightweight `{sha}` and `{path}` descriptors rather than full commit/session objects — this keeps the contract between gap detection (UKBCliDefaultCommand/gapAnalyzer) and workflow execution (WorkflowOrchestrator) stable and avoids unnecessary payload bloat in `mcp__semantic_analysis__execute_workflow` calls.


## Hierarchy Context

### Parent
- [OnlineLearning](./OnlineLearning.md) -- lib/ukb-unified/core/WorkflowOrchestrator.js executeIncrementalWorkflow() builds workflow_name: 'incremental-analysis' parameters from a gap scope (sinceCommit, commits, sessions) and calls mcp__semantic_analysis__execute_workflow to run automated extraction

### Siblings
- [WorkflowOrchestrator](./WorkflowOrchestrator.md) -- executeIncrementalWorkflow() builds workflow_name: 'incremental-analysis' with parameters sinceCommit, sinceTimestamp, commits (mapped to sha), sessions (mapped to path), maxCommits, maxSessions, significanceThreshold
- [IncrementalAnalysisWorkflowParams](./IncrementalAnalysisWorkflowParams.md) -- scope.commits.map(c => c.sha) and scope.sessions.map(s => s.path) show the incremental workflow expects lightweight commit/session descriptors from GapAnalyzer rather than full objects


---

*Generated from 3 observations*
