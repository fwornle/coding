# WorkflowOrchestrator

**Type:** Detail

executeIncrementalWorkflow() builds workflow_name: 'incremental-analysis' with parameters sinceCommit, sinceTimestamp, commits (mapped to sha), sessions (mapped to path), maxCommits, maxSessions, significanceThreshold

# WorkflowOrchestrator — Technical Insight Document

## What It Is

`WorkflowOrchestrator` is implemented in `lib/ukb-unified/core/WorkflowOrchestrator.js` as part of the `OnlineLearning` subsystem. It serves as the bridge between UKB's internal gap-detection/checkpoint logic and Claude Code's MCP (Model Context Protocol) semantic analysis tooling. Its central responsibility is orchestrating "incremental analysis" workflows — packaging a scope of changed commits and sessions into a well-formed request, dispatching it to the MCP server, and normalizing the response into a format the rest of UKB can consume.

## Architecture and Design

The class follows an **adapter/facade pattern**: it hides the specifics of the MCP function-calling interface (`mcp__semantic_analysis__execute_workflow`, `mcp__semantic_analysis__test_connection`) behind a small set of orchestration methods (`executeIncrementalWorkflow()`, `callMCPWorkflow()`, `testMCPConnection()`). This isolates the rest of the codebase from MCP's global-function invocation style and from any changes in the MCP result schema.

A **capability-detection guard** (`checkMCPToolsAvailability()`) is used before invoking MCP workflows, checking `typeof mcp__semantic_analysis__execute_workflow === 'function'`. This is a defensive design choice reflecting that the orchestrator may run in environments where the MCP server is not configured (e.g., outside Claude Code), so the architecture must fail gracefully or branch behavior rather than assume MCP availability.

Result handling is centralized through `transformWorkflowResult()`, a **normalization layer** that converts heterogeneous raw MCP output fields (`entitiesCreated`, `relationsCreated`, `insightsGenerated`) into a single UKB-compatible shape, independent of which workflow type produced them. This keeps downstream consumers workflow-agnostic.

## Implementation Details

`executeIncrementalWorkflow()` constructs a payload with `workflow_name: 'incremental-analysis'` and parameters including `sinceCommit`, `sinceTimestamp`, `maxCommits`, `maxSessions`, and `significanceThreshold`. Notably, it maps richer domain objects down to lightweight descriptors before sending them over MCP: `commits` are reduced to `sha` values and `sessions` to `path` values (per the `IncrementalAnalysisWorkflowParams` pattern), suggesting the MCP interface intentionally expects minimal, serializable identifiers rather than full domain objects.

`callMCPWorkflow()` performs the actual invocation of `mcp__semantic_analysis__execute_workflow`, wrapping the call with SUCCESS/FAILED logging keyed off `result.success`, and converting exceptions into a standardized `'MCP workflow execution failed'` error. This gives a single, predictable error-handling seam for all MCP workflow calls.

`testMCPConnection()` is a separate, lightweight probe (`mcp__semantic_analysis__test_connection()`) decoupled from running a full workflow — allowing connectivity/health checks without the cost or side effects of a real analysis run.

## Integration Points

Upstream, `WorkflowOrchestrator` is invoked as part of the `OnlineLearning` flow: the parent context indicates that `executeIncrementalWorkflow()` receives its scope (commits, sessions, sinceCommit) from a **GapAnalyzer**-produced gap scope, meaning the orchestrator depends on gap-detection logic elsewhere in the system to determine what needs analysis. Sibling entity `UKBCliDefaultCommand` shows the entry point for this flow: `UKBCli.defaultCommand()` calls `checkpointManager.loadCheckpoint()` and inspects `checkpoint.lastSuccessfulRun` to distinguish first-run from incremental scenarios — implying `WorkflowOrchestrator` is invoked once the CLI determines an incremental run is appropriate.

Downstream, the orchestrator's output (via `transformWorkflowResult()`) feeds into UKB's knowledge base ingestion, since the transformed result is explicitly "UKB-compatible." The direct dependency surface is the global MCP functions (`mcp__semantic_analysis__execute_workflow`, `mcp__semantic_analysis__test_connection`), which are environment-provided (Claude Code) rather than imported modules — an unusual but deliberate integration style dictated by the MCP calling convention.

## Usage Guidelines

Callers should always gate MCP workflow execution behind `checkMCPToolsAvailability()` to avoid runtime errors in environments lacking the MCP server. When supplying scope data to `executeIncrementalWorkflow()`, pass lightweight commit/session descriptors (objects with `.sha` / `.path`) consistent with `IncrementalAnalysisWorkflowParams` rather than full domain entities, since the orchestrator performs the mapping itself. Use `testMCPConnection()` for health checks or pre-flight validation separate from triggering a full analysis workflow. Any new workflow types should route their results through `transformWorkflowResult()` to preserve the UKB-compatible output contract rather than handling raw MCP fields ad hoc. Error handling should rely on the existing SUCCESS/FAILED logging and standardized error wrapping in `callMCPWorkflow()` rather than introducing parallel error-handling paths.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- WorkflowOrchestrator (class) in WorkflowOrchestrator.js

**Other:**
- WorkflowOrchestrator.js (module) in WorkflowOrchestrator.js


## Hierarchy Context

### Parent
- [OnlineLearning](./OnlineLearning.md) -- lib/ukb-unified/core/WorkflowOrchestrator.js executeIncrementalWorkflow() builds workflow_name: 'incremental-analysis' parameters from a gap scope (sinceCommit, commits, sessions) and calls mcp__semantic_analysis__execute_workflow to run automated extraction

### Siblings
- [IncrementalAnalysisWorkflowParams](./IncrementalAnalysisWorkflowParams.md) -- scope.commits.map(c => c.sha) and scope.sessions.map(s => s.path) show the incremental workflow expects lightweight commit/session descriptors from GapAnalyzer rather than full objects
- [UKBCliDefaultCommand](./UKBCliDefaultCommand.md) -- UKBCli.defaultCommand() calls this.checkpointManager.loadCheckpoint() and checks checkpoint.lastSuccessfulRun to detect first-run vs incremental scenarios


---

*Generated from 7 observations*
