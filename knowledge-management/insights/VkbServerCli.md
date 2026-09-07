# VkbServerCli

**Type:** Detail

The `data process` subcommand calls server.dataProcessor.prepareData() and reports entity/relation counts, indicating VKBServer exposes a dataProcessor for NDJSON conversion

# VkbServerCli: Technical Insight Document

## What It Is

VkbServerCli is the command-line interface layer for VkbServer, providing a thin operational shell over the server's process lifecycle and data management capabilities. It exposes subcommands—`server start`, `server status`, `server logs`, `data process`, and `data refresh`—that delegate directly to methods on a VKBServer instance rather than implementing independent logic. As a child component in the hierarchy, VkbServerCli's sole purpose is to translate CLI invocations into calls against the VKBServer object model, then format the results for terminal output (PID/log file reporting, entity/relation counts, running status, etc.).

## Architecture and Design

The defining architectural pattern here is **delegation over reimplementation**. Every subcommand observed—`start`, `status`, `logs`, `data process`, `data refresh`—forwards its work to a method on the VKBServer instance (`server.start()`, `server.status()`, `server.logs()`, `server.dataProcessor.prepareData()`, `server.refreshData()`). This keeps VkbServerCli as a stateless presentation/dispatch layer, avoiding duplicated process-management or data-processing logic that would otherwise drift out of sync with the server implementation.

This mirrors the design philosophy seen in sibling components: ApiRoutes similarly acts as a thin HTTP-facing wrapper (`ApiRoutes.registerRoutes()`) around core server functionality, exposing endpoints like `/api/entities` and `/api/stats` without embedding business logic itself. VkbServerCli and ApiRoutes are effectively parallel "front doors" onto the same VKBServer core—one for humans/scripts via terminal, one for HTTP consumers—both deferring to the parent VkbServer for actual behavior.

## Implementation Details

- **`server start`**: Instantiates a VKBServer and calls `server.start({ foreground, force })`. The CLI branches its reporting based on `result.alreadyRunning`, distinguishing between an existing running instance and a freshly started one (which yields a new PID and log file path).
- **`server status` / `server logs`**: Read live process state via `server.status()` and `server.logs({ lines, follow })`. Notably, the CLI does not reimplement process introspection (e.g., checking PIDs directly)—it trusts VKBServer's own status/log-reading methods, reinforcing the delegation pattern.
- **`data process`**: Invokes `server.dataProcessor.prepareData()`, implying VKBServer exposes a `dataProcessor` sub-object responsible for NDJSON conversion. The CLI reports entity/relation counts returned from this call, suggesting `prepareData()` returns structured summary metadata rather than raw output.
- **`data refresh`**: Calls `server.refreshData()` to update visualization data incrementally, explicitly avoiding a full server restart. This indicates VKBServer maintains internal state that can be refreshed independently of its process lifecycle—an important operational distinction from `server start`.

## Integration Points

VkbServerCli's primary dependency is its parent, VkbServer, which it contains and drives programmatically (not via HTTP)—a key difference from siblings like VkbApiClient and UkbDatabaseCli, which interact with the server over HTTP (`/api/health`) rather than in-process method calls. VkbApiClient's `isServerAvailable()` and UkbDatabaseCli's `isVKBRunning()` both perform HTTP health checks with timeouts to decide whether to route through the server, whereas VkbServerCli operates with direct object access, implying it likely runs in the same process/host context as the server it manages (e.g., for starting/stopping it locally).

This distinction matters architecturally: VkbServerCli is a *management* interface (lifecycle control, data refresh), while ApiRoutes and the HTTP-based clients (VkbApiClient, UkbDatabaseCli) are *consumption* interfaces for querying entities/relations once the server is running. VkbServerCli's `data process` subcommand also implies a dependency on VKBServer's `dataProcessor`, an internal component not otherwise detailed in these observations but clearly scoped to NDJSON conversion.

## Usage Guidelines

- Treat VkbServerCli as an operational tool for managing the VKBServer process and its data state—not as a data query interface. For querying entities/relations, consumers should use HTTP-based paths like ApiRoutes or VkbApiClient instead.
- When starting the server via `server start`, always check `result.alreadyRunning` before assuming a fresh instance was launched, since the CLI's PID/log reporting depends on this distinction.
- Prefer `data refresh` over a full `server start --force` restart when only visualization data needs updating, since `refreshData()` is designed to avoid full-restart overhead.
- Because VkbServerCli calls VKBServer methods directly rather than over HTTP, it should be invoked in a context with direct access to the VKBServer instance/module—unlike UkbDatabaseCli or VkbApiClient, which are designed to work against a remote or independently running server process via health-checked HTTP calls.


## Hierarchy Context

### Parent
- [VkbServer](./VkbServer.md) -- lib/vkb-server/api-routes.js's ApiRoutes.registerRoutes() wires dozens of endpoints (/api/entities, /api/relations, /api/stats, /api/export, /api/query, /api/ontology/classes) as the single HTTP surface for all consumers

### Siblings
- [ApiRoutes](./ApiRoutes.md) -- ApiRoutes.registerRoutes(app) registers core CRUD endpoints like app.get('/api/entities'), app.post('/api/entities'), app.put('/api/entities/:name'), and app.delete('/api/entities/:name')
- [VkbApiClient](./VkbApiClient.md) -- isServerAvailable() checks /api/health and returns true based solely on response.ok, deliberately not requiring graph===true because 'Entity APIs work via HTTP even if graph health check has issues'
- [UkbDatabaseCli](./UkbDatabaseCli.md) -- isVKBRunning() pings `${VKB_SERVER_URL}/api/health` with a 1-second AbortSignal timeout before deciding whether to route through the server


---

*Generated from 4 observations*
