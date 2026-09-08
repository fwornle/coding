# WorkflowOrchestrator

**Type:** Detail

[LLM] Positioned alongside `VkbApiClient.js` in the same `lib/ukb-unified/core/` directory, WorkflowOrchestrator is one of at least three core/ collaborators (`TeamCheckpointManager`, `GapAnalyzer`, `ConfigManager`, `WorkflowOrchestrator`) imported directly into `cli.js` with no dependency-injection container or factory — each is `new`'d individually in the `UKBCli` constructor or lazily in `defaultCommand()`. Given the parent-context observation that VKB's entity-mutation logic has an asymmetry (creates go direct to the DB, updates prefer the live server), and that `VkbApiClient`/`ukb-database/cli.js` independently reimplement the same HTTP contract, it's plausible WorkflowOrchestrator's incremental-workflow execution eventually funnels through one of these parallel VKB clients for persistence — but no call edge to `VkbApiClient` or `sendToVKB` is visible in the code graph or in the truncated source, so this remains an inference rather than a confirmed dependency.

# WorkflowOrchestrator — Technical Insight Document

## What It Is

`WorkflowOrchestrator` is implemented in `lib/ukb-unified/core/WorkflowOrchestrator.js`, positioned in the `core/` directory alongside sibling collaborators `VkbApiClient`, `TeamCheckpointManager`, `GapAnalyzer`, and `ConfigManager`. It is the central execution engine of the incremental workflow pipeline within the `UKBCli` tool, though its footprint in the code graph is unusually thin — the graph resolves only the class itself, with no internal methods, helpers, or call-edges surfaced. This contrasts sharply with the sibling `VkbApiClient`, whose eight HTTP methods (`isServerAvailable`, `getEntities`, `createEntity`, etc.) are fully resolved. Whether this opacity reflects a gap in graph extraction or a genuinely thin, delegation-heavy class body is not resolvable from available data, but it is worth flagging as an analysis blind spot.

Its concrete usage is visible entirely through `lib/ukb-unified/cli.js`, which imports it via `import { WorkflowOrchestrator } from './core/WorkflowOrchestrator.js'` and constructs it lazily inside `UKBCli.defaultCommand()`.

## Architecture and Design

The orchestrator sits at the tail end of a multi-stage pipeline: checkpoint retrieval → gap analysis → scope generation → orchestrated execution → checkpoint update. Each stage is owned by a distinct core/ class with no shared interface or schema binding them — `GapAnalyzer.generateIncrementalScope(checkpoint)` produces a `scope` object that the CLI then mutates directly (`scope.codingRepo = this.codingRepo`) before handing it to `executeIncrementalWorkflow`. This is loose coupling via plain, untyped JS objects rather than defined contracts, which is fast to write but fragile: a change to fields produced by `generateIncrementalScope` could silently break orchestrator behavior with no compile-time signal.

Instantiation follows a lazy-singleton pattern — `this.orchestrator = new WorkflowOrchestrator(config, { debug: options.debug })`, guarded by `if (!this.orchestrator)` — making it a de facto per-process singleton within `UKBCli`. There is no dependency-injection container anywhere in this system; `cli.js` directly `new`'s every core/ collaborator itself, a pattern consistent across `TeamCheckpointManager`, `GapAnalyzer`, `ConfigManager`, and `WorkflowOrchestrator` alike.

Error handling follows a result-object-over-exceptions convention: `executeIncrementalWorkflow` returns `{ success, error, stats, lastCommit, lastSession, workflowType, details? }` rather than throwing on failure, placing the burden on callers to check `result.success` before trusting `result.stats`.

## Implementation Details

The orchestrator's only known public contract is the async method `executeIncrementalWorkflow(scope, { verbose })`. Its `stats` payload — `entitiesCreated`, `relationsCreated`, `insightsGenerated`, `commitsAnalyzed`, `sessionsAnalyzed` — suggests it coordinates entity/relation creation and insight generation from commit and session data, but none of this internal logic is visible in the code graph or truncated source. The class does not resolve or validate its own configuration; it receives an already-validated `config` object from `ConfigManager.loadConfig()`, keeping configuration concerns entirely outside the orchestrator's responsibility.

A notable implementation detail is the mock-execution fallback: `result.details?.mock`, surfaced only as an optional nested flag, triggers a CLI-side console warning ("MCP semantic-analysis not available... run ukb within Claude Code"). This implies the orchestrator's real execution path depends on an external MCP semantic-analysis service, falling back to a degraded mock mode when unreachable — but the decision of which mode ran is reported post-hoc rather than queried upfront by the CLI.

## Integration Points

`WorkflowOrchestrator` is downstream of `GapAnalyzer` (scope input) and implicitly `TeamCheckpointManager` (via the checkpoint feeding `generateIncrementalScope`), and its `config` dependency originates from `ConfigManager`. Structurally, it sits beside `VkbApiClient.js` in `core/`, and given the parent-context asymmetry noted for VKB entity mutation (creates go direct to DB, updates prefer the live server), it's plausible that `executeIncrementalWorkflow` eventually funnels persistence through `VkbApiClient` or a `sendToVKB`-style path — but no call edge confirms this in the graph or visible source, so it remains an open inference rather than a documented dependency. Within the broader hierarchy, `WorkflowOrchestrator` is contained by both `ManualLearning` and `VKBServer`, and shares sibling status with `ApiRoutes`, `VKBServerCLI`, `UKBUnifiedCLI`, and `VkbApiClient`.

## Usage Guidelines

Callers must always check `result.success` before trusting `result.stats` or other result fields — this is not a throw-on-failure API. Since `scope` is built externally and mutated in place before being passed in, any code constructing a `scope` object must stay synchronized with whatever fields `GapAnalyzer.generateIncrementalScope` currently produces; there is no schema enforcing this. Developers should also be aware that mock-mode execution is possible and only detectable after the call completes via `result.details?.mock` — user-facing code should check this flag rather than assuming success implies real execution against MCP semantic-analysis. Finally, given the sparse code-graph visibility, any deep changes to this class should be validated against actual source rather than the graph, since static analysis tooling does not currently surface its internals.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- WorkflowOrchestrator (class) in WorkflowOrchestrator.js

**Other:**
- WorkflowOrchestrator.js (module) in WorkflowOrchestrator.js
- The code graph identifies exactly one class-level entity for this component — `WorkflowOrchestrator` in `WorkflowOrchestrator.js` — with no further internal methods, helpers, or called functions surfaced in the graph. This is a much thinner code-graph footprint than sibling core/ classes like `VkbApiClient` (which the graph would presumably resolve into eight distinct HTTP methods) or the parent-context's `VKBServer`/`restartVKBServer` pairing. Either the orchestrator's internals (e.g. an `executeIncrementalWorkflow` method) were not indexed by the graph extraction pass, or the class is unusually opaque to static analysis — both are worth flagging since every other Detail-level entity nearby has multiple call-edges attached.


## Hierarchy Context

### Siblings
- [ApiRoutes](./ApiRoutes.md) -- [CGR] ApiRoutes (class) in api-routes.js
- [VKBServerCLI](./VKBServerCLI.md) -- [LLM] `VkbApiClient.js` (`lib/ukb-unified/core/VkbApiClient.js`) exposes eight methods — `isServerAvailable`, `getEntities`, `searchEntities`, `deleteEntity`, `createEntity`, `updateEntity`, `getRelations`, `deleteRelation`, `createRelation`, `exportTeam` — and every single one independently constructs its own `fetch` call, its own `AbortSignal.timeout`, and its own `if (!response.ok) { const error = await response.json(); throw new Error(error.message || 'Failed to X'); }` block. There is no shared `_request()` or `_handleResponse()` helper anywhere in the class. This is a textbook copy-paste-drift risk: `searchEntities` delegates to `getEntities` (reuse exists there), but every other method reimplements the boilerplate from scratch, meaning a change to error-shape handling (e.g. supporting a non-JSON error body, or adding a request-id header) requires seven coordinated edits rather than one.
- [UKBUnifiedCLI](./UKBUnifiedCLI.md) -- [LLM] [object Object]
- [VkbApiClient](./VkbApiClient.md) -- [CGR] VkbApiClient (class) in VkbApiClient.js


---

*Generated from 11 observations*
