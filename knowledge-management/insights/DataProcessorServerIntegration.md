# DataProcessorServerIntegration

**Type:** Detail

[Architecture Notes] Duplicated HTTP client logic between lib/ukb-unified/core/VkbApiClient.js and lib/ukb-database/cli.js's sendToVKB()/isVKBRunning() — two independent implementations of the same VKB-server integration concern; Server availability is treated as HTTP-reachability, not full-stack health — VkbApiClient.isServerAvailable() ignores the `graph` health flag by design; Persistence is split across three backends reachable from this integration layer: SQLite (analytics), Qdrant (vector, optional), and a graph DB path — all wired through a single DatabaseManager instance; State durability for incremental workflows relies on a git-tracked checkpoint file (.data/ukb-last-run.json) rather than solely on the VKB server's own storage; Dashboard-side ETA/history logic (ukb-workflow-modal.tsx) is decoupled from the server integration itself, consuming Redux-selected state (WorkflowTimingStats, UKBProcess) rather than calling VkbApiClient directly

# DataProcessorServerIntegration — Technical Insight Document

## What It Is

DataProcessorServerIntegration is the integration layer through which DataProcessor's server-backed code paths communicate with the VKB server and its associated persistence backends. It is implemented across several distinct surfaces rather than a single module: `lib/ukb-unified/core/VkbApiClient.js` provides the primary HTTP client abstraction (`getEntities`, `createEntity`, `updateEntity`, `deleteEntity`, `getRelations`, `createRelation`, `deleteRelation`, `exportTeam`); `lib/ukb-database/cli.js` implements a second, independent integration path (`isVKBRunning()`, `sendToVKB()`) alongside a database-backed persistence path via `DatabaseManager`; `lib/ukb-unified/cli.js` implements incremental workflow orchestration against the server state; and `integrations/system-health-dashboard/src/components/ukb-workflow-modal.tsx` consumes server-driven workflow state on the dashboard side. As a child of DataProcessor, this integration exists specifically to bound and manage DataProcessor's assumptions about server availability, latency, and persistence — in contrast to its sibling PrepareDataStatsReporting, which (per available evidence) belongs to a different code area entirely (`lib/vkb-server/data-processor.js`) and is not represented in these files.

## Architecture and Design

The dominant pattern is an Adapter/Client wrapper: `VkbApiClient` centralizes all HTTP access to the VKB server behind typed methods, scoped to a configurable `baseUrl` (default `http://localhost:8080`) and bounded by `AbortSignal.timeout` on every call (`this.timeout`, default 10000ms). A Circuit-probe/availability-check pattern complements this — `isServerAvailable()` uses a tighter 2000ms probe before committing to server-backed calls.

A second, parallel implementation of the same concern exists in `lib/ukb-database/cli.js`: `isVKBRunning()` (1000ms timeout) and `sendToVKB()` duplicate the base-URL resolution, timeout-guarded fetch, and error-unwrapping logic already present in `VkbApiClient`, rather than reusing it. This is a notable structural insight — the database CLI and the unified CLI evolved as separate integration paths into the same VKB server.

Optional dependency injection governs persistence mode: DataProcessor and `lib/ukb-database/cli.js`'s `initializeDatabase()` only construct a `databaseManager`/`KnowledgeExportService` when explicitly configured, keeping JSON-file-only mode decoupled from database-backed mode at the process-composition boundary rather than inside DataProcessor itself.

A Checkpoint/incremental-processing pattern appears in `lib/ukb-unified/cli.js`'s `UKBCli.defaultCommand()`, using `TeamCheckpointManager` and `GapAnalyzer.getGapSummary()` to avoid full reprocessing, with a `WorkflowOrchestrator` lazily constructed only when a gap exists and `--dry-run` is not set.

Finally, a Dynamic-learning-with-fallback-bounds pattern governs the dashboard's ETA logic (`calculateDynamicEta()`), blending live telemetry with historical averages under sanity clamps.

## Implementation Details

`VkbApiClient`'s constructor (lines 1-13) accepts a configurable `baseUrl` and `timeout`, establishing the uniform HTTP surface. `isServerAvailable()` (lines 18-33) treats HTTP 200 as sufficient evidence of availability, deliberately ignoring the health payload's `graph` flag — an inline comment notes entity APIs "work via HTTP even if graph health check has issues" and that the health check structure "varies and may report false negatives." This pushes failure detection down to individual CRUD calls rather than a coarse health gate.

`lib/ukb-database/cli.js`'s `initializeDatabase()` (lines 71-101) constructs a `DatabaseManager` (`src/databases/DatabaseManager.js`) wired to three backends: SQLite (`sqlitePath` under `.data/knowledge.db`), Qdrant (host/port from env, toggled via `QDRANT_ENABLED`), and a graph DB path under `.data/knowledge-graph`, then injects that manager into a `UKBDatabaseWriter`.

`UKBCli.defaultCommand()` (lines 139-160, 186-232) loads a team checkpoint, computes a gap summary, and conditionally executes `executeIncrementalWorkflow()`. The checkpoint update step instructs operators to `git add .data/ukb-last-run.json .data/knowledge-export/*.json`, indicating durable state is synced via git rather than solely through server persistence.

On the dashboard side, `HISTORY_PAGE_SIZE` (lines 60-77) was raised from 50 to 500 because `/api/ukb/history` parses every report per call and slices only at the end — trading payload size for completeness. `calculateDynamicEta()` (lines 113-230) blends `batchIterations` telemetry with `WorkflowTimingStats` (avgBatchDurationMs, avgFinalizationDurationMs, recentDurations), clamped to 0.3x–2.0x of a linear ETA and a hard 1s–30min bound, with a 1.2x fallback multiplier for single-sample cases.

## Integration Points

This entity is the concrete mechanism by which DataProcessor's optionally-injected `databaseManager`/`KnowledgeExportService` gets constructed and wired — the parent's abstract "only used when explicitly provided" behavior is realized here at `initializeDatabase()`. Persistence fans out across SQLite, Qdrant, and a graph DB path, all through one `DatabaseManager` instance. Incremental workflows depend on git-tracked checkpoint files as a durability mechanism external to the VKB server. The dashboard component consumes Redux-selected state (`WorkflowTimingStats`, `UKBProcess`) rather than calling `VkbApiClient` directly, decoupling UI-side ETA/history logic from the server integration itself.

## Usage Guidelines

Developers should be aware that `VkbApiClient` availability checks are HTTP-reachability checks, not full-stack health checks — code paths must handle failures at the level of individual CRUD calls rather than trusting `isServerAvailable()` as a complete guarantee. Given the duplicated logic between `VkbApiClient` and `lib/ukb-database/cli.js`'s `sendToVKB()`/`isVKBRunning()`, any fix to timeout handling, error unwrapping, or base-URL resolution must be applied in both places until consolidated — a clear maintainability risk. Incremental workflows require the git checkpoint files (`.data/ukb-last-run.json`, `.data/knowledge-export/*.json`) to be committed for state continuity; skipping this breaks gap detection. Dashboard consumers should treat ETA output as bounded/sanity-clamped, not a raw projection, especially early in a run when few batches have completed.


## Hierarchy Context

### Siblings
- [PrepareDataStatsReporting](./PrepareDataStatsReporting.md) -- [LLM] The provided code files (ukb-workflow-modal.tsx, multi-agent-graph.tsx, lib/ukb-database/cli.js, lib/ukb-unified/cli.js, lib/ukb-unified/core/VkbApiClient.js) do not contain a 'PrepareDataStatsReporting' component, function, or class. None of the files reference DataProcessor.prepareData(), processMemoryData(), exportOnlineKnowledge(), createCombinedView(), or KnowledgeExportService, which are the parent context's actual subject matter (lib/vkb-server/data-processor.js). This is a mismatch between the requested component name/parent observations and the supplied code evidence.


---

*Generated from 10 observations*
