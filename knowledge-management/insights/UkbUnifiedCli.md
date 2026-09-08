# UKBUnifiedCLI

**Type:** Detail

[Code References] lib/ukb-unified/cli.js:33-39 - UKBCli constructor, eager sub-manager init + null orchestrator placeholder; lib/ukb-unified/cli.js:157-243 - defaultCommand() staged checkpoint/gap/execute pipeline; lib/ukb-unified/cli.js:178-186 - hardcoded dry-run seven-step agent list; lib/ukb-unified/core/VkbApiClient.js:18-33 - isServerAvailable() health-check-not-graph-gated logic; lib/ukb-unified/core/VkbApiClient.js:83-131 - createEntity/updateEntity duplicated fetch/error-unwrap boilerplate; lib/ukb-database/cli.js:29-38 - isVKBRunning() 1000ms-timeout health check; lib/ukb-database/cli.js:255-266 - updateEntityFromStdin() single up-front vkbRunning check; integrations/system-health-dashboard/src/components/ukb-workflow-modal.tsx:53-73 - HISTORY_PAGE_SIZE=500 rationale comment; integrations/system-health-dashboard/src/components/ukb-workflow-modal.tsx:130-230 - calculateDynamicEta() three-branch estimator with self-clamp

# UKBUnifiedCLI — Technical Insight Document

## What It Is

UKBUnifiedCLI is the orchestration entry point implemented at `lib/ukb-unified/cli.js`, serving as the command-line coordinator for the unified knowledge base workflow. Its core class, `UKBCli`, ties together checkpoint state management, gap analysis, and workflow execution into a single command surface. It sits within the broader `ManualLearning` and `VKBServer` containment hierarchy, and works alongside sibling components `VkbApiClient` (`lib/ukb-unified/core/VkbApiClient.js`), `WorkflowOrchestrator`, `VKBServerCLI`, and `ApiRoutes` to drive the end-to-end knowledge-base agent pipeline.

## Architecture and Design

The dominant pattern is a **staged, guard-clause pipeline** inside `UKBCli.defaultCommand()` (`cli.js:157-243`): execution proceeds through a checkpoint check, then a gap check, then orchestrator execution, with each stage able to short-circuit the rest. This keeps control flow linear and easy to trace, at the cost of tightly coupling three distinct concerns (checkpoint state, gap analysis, workflow execution) into one class rather than composing them as an injectable pipeline of independent stages.

Initialization follows a **lazy/deferred construction** strategy: the `UKBCli` constructor (`cli.js:33-39`) eagerly initializes sub-managers but leaves the `WorkflowOrchestrator` as a null placeholder, deferring its real construction until after async configuration loads. This avoids partially-constructed orchestrator state but means the constructor's shape doesn't fully reflect the object's eventual dependency graph.

A recurring anti-pattern across the CLI family is **duplicated HTTP boilerplate without a shared helper**. `VkbApiClient.js` exposes eight methods (`isServerAvailable`, `getEntities`, `searchEntities`, `deleteEntity`, `createEntity`, `updateEntity`, `getRelations`, `deleteRelation`, `createRelation`, `exportTeam`), each independently constructing its own `fetch`, `AbortSignal.timeout`, and error-unwrap block (`createEntity`/`updateEntity` boilerplate at `VkbApiClient.js:83-131`). Only `searchEntities` reuses `getEntities`; everything else reimplements the same shape from scratch. This exact anti-pattern is mirrored independently in `ukb-database/cli.js`'s `sendToVKB`, indicating the duplication problem spans multiple CLIs rather than being localized.

Another notable pattern is the **availability-gated dual-write path**: `updateEntityFromStdin()` (`ukb-database/cli.js:255-266`) calls `isVKBRunning()` once up front and branches between live-server and direct-database mutation. Interestingly, this gating is asymmetric — the create paths (`add-entity`, `add-relation`) never perform this check, an intentional but undocumented design choice.

Finally, `calculateDynamicEta()` in `ukb-workflow-modal.tsx:130-230` implements a **self-clamping estimator**: a three-branch calculation whose dynamic output is bounded against a naive linear-interpolation baseline, preventing runaway ETA predictions.

## Implementation Details

`UKBCli`'s constructor performs eager sub-manager initialization while nulling out the orchestrator reference, a pattern that trades a slightly awkward two-phase construction for correctness around async config dependencies. The `defaultCommand()` method is the functional heart of the class, walking through checkpoint validation, gap detection, and finally orchestrator execution — each step gated so failure or incompleteness at an earlier stage prevents later stages from running.

A notable drift risk lives in the dry-run path: `defaultCommand()` prints a **hardcoded seven-step agent list** (`cli.js:178-186`) describing the pipeline, rather than deriving it from `WorkflowOrchestrator`'s actual configuration. This means the dry-run output can silently diverge from real orchestrator behavior as the orchestrator evolves.

`VkbApiClient.isServerAvailable()` (`VkbApiClient.js:18-33`) performs a health check that is not graph-gated — it checks service liveness without verifying deeper graph/database readiness. `ukb-database/cli.js`'s parallel `isVKBRunning()` (`cli.js:29-38`) uses a 1000ms timeout health check, functioning as an independently maintained twin of `isServerAvailable()`.

On the frontend side, `ukb-workflow-modal.tsx` defines `HISTORY_PAGE_SIZE=500` with an explanatory rationale comment (`tsx:53-73`), and its ETA logic depends on `batchIterations` step-status naming conventions (`'completed'`/`'skipped'`) remaining in sync with whatever the backend workflow actually emits — an implicit contract not enforced by types or shared constants.

## Integration Points

UKBUnifiedCLI is contained within both `ManualLearning` and `VKBServer`, positioning it as a shared CLI surface across these two parent contexts. It depends directly on `VkbApiClient` for all server-side entity/relation operations, and on `WorkflowOrchestrator` for actual pipeline execution — though as noted, the CLI's dry-run description of that pipeline is not sourced from the orchestrator itself. `ApiRoutes` and `VKBServerCLI` sit alongside it as siblings, presumably exposing the same underlying operations through different interfaces (HTTP routes vs. CLI). The `ukb-database/cli.js` module operates as a parallel, database-level CLI that duplicates health-check and API-call logic rather than sharing code with `VkbApiClient.js`. The frontend `ukb-workflow-modal.tsx` component integrates by consuming workflow status/history data (via `HISTORY_PAGE_SIZE`-bounded pagination) and computing ETAs from step-status naming that originates server-side.

## Usage Guidelines

Developers extending `UKBCli` should be cautious about adding new stages to `defaultCommand()` — the guard-clause pipeline structure means new checks should follow the same short-circuit convention and should not assume access to fully-formed orchestrator state before the deferred construction completes. Any changes to the dry-run agent list must be manually reconciled with real `WorkflowOrchestrator` configuration since there is no shared source of truth. When modifying `VkbApiClient.js` error-handling behavior (e.g., non-JSON error bodies, new headers), all eight methods must be updated in lockstep — a strong candidate for introducing a shared `_request()`/`_handleResponse()` helper, and the equivalent duplication in `ukb-database/cli.js`'s `sendToVKB` should be updated in parallel. The asymmetry between update-path availability checks and create-path checks in `ukb-database/cli.js` should be documented explicitly or reconciled, since it currently appears as an undocumented inconsistency. Finally, any changes to backend workflow step-status naming (`'completed'`/`'skipped'`) must be coordinated with `ukb-workflow-modal.tsx`'s ETA logic to avoid silent frontend estimation errors.


## Hierarchy Context

### Siblings
- [ApiRoutes](./ApiRoutes.md) -- [CGR] ApiRoutes (class) in api-routes.js
- [VKBServerCLI](./VKBServerCLI.md) -- [LLM] `VkbApiClient.js` (`lib/ukb-unified/core/VkbApiClient.js`) exposes eight methods — `isServerAvailable`, `getEntities`, `searchEntities`, `deleteEntity`, `createEntity`, `updateEntity`, `getRelations`, `deleteRelation`, `createRelation`, `exportTeam` — and every single one independently constructs its own `fetch` call, its own `AbortSignal.timeout`, and its own `if (!response.ok) { const error = await response.json(); throw new Error(error.message || 'Failed to X'); }` block. There is no shared `_request()` or `_handleResponse()` helper anywhere in the class. This is a textbook copy-paste-drift risk: `searchEntities` delegates to `getEntities` (reuse exists there), but every other method reimplements the boilerplate from scratch, meaning a change to error-shape handling (e.g. supporting a non-JSON error body, or adding a request-id header) requires seven coordinated edits rather than one.
- [WorkflowOrchestrator](./WorkflowOrchestrator.md) -- [CGR] WorkflowOrchestrator (class) in WorkflowOrchestrator.js
- [VkbApiClient](./VkbApiClient.md) -- [CGR] VkbApiClient (class) in VkbApiClient.js


---

*Generated from 10 observations*
