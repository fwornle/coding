# VkbServer

**Type:** SubComponent

lib/vkb-server/api-routes.js's ApiRoutes.registerRoutes() wires dozens of endpoints (/api/entities, /api/relations, /api/stats, /api/export, /api/query, /api/ontology/classes) as the single HTTP surface for all consumers

# VkbServer — Technical Insight Document

## What It Is

VkbServer is the HTTP server subcomponent of the parent KnowledgeManagement system, implemented primarily in `lib/vkb-server/` with a core `VKBServer` class exposed from `index.js`. It provides the single network-facing surface for graph-based knowledge operations, wiring together request routing, query resolution, process lifecycle management, and data preparation. Its role within KnowledgeManagement is to be the "server" half of the abstraction layer that decouples consumers — agents, CLIs, and other components — from the underlying graph database (previously LevelDB, now KMCore).

![VkbServer — Architecture](images/vkb-server-architecture.png)

## Architecture and Design

The dominant pattern is a thin HTTP routing layer backed by a dedicated query service. `lib/vkb-server/api-routes.js`'s `ApiRoutes.registerRoutes()` registers dozens of endpoints (`/api/entities`, `/api/relations`, `/api/stats`, `/api/export`, `/api/query`, `/api/ontology/classes`) as the canonical API surface. Rather than let route handlers talk directly to the database, the `ApiRoutes` constructor builds a `KnowledgeQueryService` from `databaseManager.graphDB`, cleanly separating query resolution logic from the raw graph database implementation — a deliberate layering decision that supports the backend-migration goals noted at the KnowledgeManagement level.

Process control is treated as a distinct concern from request handling: `lib/vkb-server/cli.js` implements `vkb-cli server start/stop/restart/status/logs`, wrapping the `VKBServer` class so operators get lifecycle control independent of the API logic itself. This is reinforced by `restartVKBServer` in `health-remediation-actions.js`, which calls `log` and `supervisorctlRestart` to integrate server recovery into a broader health-remediation/supervisor mechanism — indicating the server is expected to run under supervision with automated restart capability rather than being manually babysat.

A second CLI, `lib/vkb-server/db-query-cli.js`, exposes entities/relations/teams/stats/health operations by shelling out to `KnowledgeQueryService` directly, deliberately avoiding spinning up a second JS server process for the Python API server proxy. This reflects a trade-off favoring process economy over uniform HTTP-only access.

![VkbServer — Relationship](images/vkb-server-relationship.png)

## Implementation Details

The `VKBServer` class (`index.js`) is the central object instantiated both by `cli.js`'s server subcommands and by `VkbServerCli`'s `server start` subcommand, which calls `server.start({ foreground, force })` and reports back `result.alreadyRunning` versus a freshly started PID and log file — showing the server tracks its own running state and supports idempotent start semantics.

`ApiRoutes` is the routing/controller layer, translating HTTP verbs into calls against `KnowledgeQueryService`, which itself wraps `databaseManager.graphDB`. This three-tier structure (HTTP routes → query service → graph DB) is the backbone of the child component `ApiRoutes`.

Data freshness for downstream visualization is handled by `DataProcessor.prepareData()` in `lib/vkb-server/data-processor.js`, which supports `batch`, `online`, or `combined` dataSourceMode. It deletes and regenerates `memory.json` to keep the visualizer's dataset consistent with the backend — an explicit trade-off of full regeneration over incremental updates, prioritizing consistency over write efficiency.

Health/availability checking is implemented redundantly but consistently across clients: `VkbApiClient.isServerAvailable()` (`lib/ukb-unified/core/VkbApiClient.js`) probes `/api/health` with a 2-second timeout, while sibling-level `UkbDatabaseCli.isVKBRunning()` pings the same endpoint with a 1-second `AbortSignal` timeout. Both exist to let other tools decide whether to route through the running server or fall back to direct DB access.

## Integration Points

VkbServer sits beneath KnowledgeManagement and above four children: `ApiRoutes` (HTTP CRUD surface), `VkbApiClient` (HTTP availability/consumption client), `UkbDatabaseCli`, and `VkbServerCli` (process lifecycle CLI). `VkbApiClient.isServerAvailable()` notably returns true based solely on `response.ok`, not requiring `graph===true`, because "Entity APIs work via HTTP even if graph health check has issues" — an intentional leniency decision to maximize availability of entity operations.

At the sibling level, ManualLearning's `lib/ukb-database/cli.js` (add-entity, update-entity, add-relation, import, export via `UKBDatabaseWriter`) represents a manual-authoring path distinct from VkbServer's HTTP-driven flow, while OnlineLearning's `WorkflowOrchestrator.executeIncrementalWorkflow()` drives automated extraction independently — both are alternate data-entry paths that VkbServer's API and health checks must coexist with, not replace.

## Usage Guidelines

Use `vkb-cli server start/stop/restart/status/logs` (via `cli.js`/`VkbServerCli`) for lifecycle management rather than manipulating processes directly, since restart logic is also tied into automated health remediation (`restartVKBServer` + `supervisorctlRestart`). Prefer checking `/api/health` (via `VkbApiClient.isServerAvailable()` or `UkbDatabaseCli.isVKBRunning()`) before deciding whether to hit the server or write directly to the database, and honor the timeout differences (2s vs 1s) as intentional per-context tuning rather than inconsistency. When adding new endpoints, extend `ApiRoutes.registerRoutes()` and route through `KnowledgeQueryService` rather than the raw graph DB, preserving the decoupling that enables backend migration. For the Python API proxy or similar non-JS consumers, prefer `db-query-cli.js` over launching a second server process. When altering visualizer data flows, remember `DataProcessor.prepareData()` fully regenerates `memory.json`, so downstream consumers should not assume partial/incremental updates.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- VKBServer (class) in index.js
- restartVKBServer (method) in health-remediation-actions.js

**Relationships:**
- Calls: log, supervisorctlRestart


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- [LLM] The KnowledgeManagement component centers around a VKB (Virtual Knowledge Base) server that exposes graph-based storage operations to the rest of the Coding infrastructure. This server acts as the primary access point for entity CRUD operations, query resolution, and relationship traversal across the knowledge graph, decoupling consumers (agents, CLI tools, other components) from the underlying storage engine. This abstraction layer is critical because it has allowed the project to migrate storage backends (LevelDB to KMCore) without requiring downstream consumers to change their integration code, as evidenced by the dedicated migration test suite.

### Children
- [ApiRoutes](./ApiRoutes.md) -- ApiRoutes.registerRoutes(app) registers core CRUD endpoints like app.get('/api/entities'), app.post('/api/entities'), app.put('/api/entities/:name'), and app.delete('/api/entities/:name')
- [VkbApiClient](./VkbApiClient.md) -- isServerAvailable() checks /api/health and returns true based solely on response.ok, deliberately not requiring graph===true because 'Entity APIs work via HTTP even if graph health check has issues'
- [UkbDatabaseCli](./UkbDatabaseCli.md) -- isVKBRunning() pings `${VKB_SERVER_URL}/api/health` with a 1-second AbortSignal timeout before deciding whether to route through the server
- [VkbServerCli](./VkbServerCli.md) -- The `server start` subcommand instantiates a VKBServer and calls server.start({ foreground, force }), reporting result.alreadyRunning vs a fresh PID and log file

### Siblings
- [ManualLearning](./ManualLearning.md) -- lib/ukb-database/cli.js exposes add-entity, update-entity, add-relation, import, and export commands that read JSON from stdin and pass it through UKBDatabaseWriter, a manual-authoring entry point distinct from the batch pipeline
- [OnlineLearning](./OnlineLearning.md) -- lib/ukb-unified/core/WorkflowOrchestrator.js executeIncrementalWorkflow() builds workflow_name: 'incremental-analysis' parameters from a gap scope (sinceCommit, commits, sessions) and calls mcp__semantic_analysis__execute_workflow to run automated extraction


---

*Generated from 9 observations*
