# UkbDatabaseCli

**Type:** Detail

initializeDatabase() wires a DatabaseManager with sqlite, qdrant, and graphDbPath options and instantiates a UKBDatabaseWriter scoped to a team, defaulting to process.env.CODING_TEAM || 'coding'

# UkbDatabaseCli: Technical Insight Document

## What It Is

UkbDatabaseCli is a command-line interface for interacting with the UKB (Unified Knowledge Base) database, offering commands such as `add-entity`, `update-entity`, `add-relation`, `import`, and `export`, all driven by JSON piped via stdin as documented in its `showHelp()` usage text. Structurally, it sits as a component of VkbServer, alongside siblings ApiRoutes, VkbApiClient, and VkbServerCli — together forming the toolset that surrounds and operates the VKB server. Unlike ApiRoutes (which defines the HTTP surface) or VkbServerCli (which manages server lifecycle), UkbDatabaseCli is focused specifically on database read/write operations, either directly against local storage or by proxying through a running server.

## Architecture and Design

The defining architectural decision in UkbDatabaseCli is its dual-mode operation: it can talk directly to the database via a `DatabaseManager`, or it can detect a running VKB server and route requests through HTTP instead. This is implemented via `isVKBRunning()`, which pings `${VKB_SERVER_URL}/api/health` with a short 1-second `AbortSignal` timeout to make a fast go/no-go decision. This pattern mirrors VkbApiClient's `isServerAvailable()` health check, though the two differ in strictness of interpretation — a nuance worth understanding when reasoning about consistency across the tool ecosystem.

Once server mode is chosen, `sendToVKB(method, path, body, team)` is the single conduit for outbound requests, encapsulating request construction and error handling by surfacing the server's own `error.message` on non-OK responses. This centralizes failure semantics: callers don't need to parse HTTP status codes themselves, they simply catch thrown errors bearing server-provided messages.

For direct (non-server) mode, `initializeDatabase()` performs the wiring: it constructs a `DatabaseManager` configured with `sqlite`, `qdrant`, and `graphDbPath` options, then instantiates a `UKBDatabaseWriter` scoped to a specific team. This reflects a multi-store architecture underlying UKB — combining a relational/sqlite layer, a vector store (qdrant), and a graph database — unified behind a single writer abstraction.

## Implementation Details

Team scoping is a first-class concern: `UKBDatabaseWriter` defaults to `process.env.CODING_TEAM || 'coding'`, meaning multi-tenant or multi-team database segregation is baked into initialization rather than bolted on per-command. Every database mutation is implicitly namespaced by this team identifier unless overridden.

The health-check-then-route pattern (`isVKBRunning()`) is deliberately lightweight — a 1-second abort timeout ensures the CLI doesn't hang waiting for a potentially down server, falling back quickly to direct database access. This is a pragmatic trade-off favoring responsiveness over exhaustive retry logic.

Command dispatch follows a conventional stdin-JSON pattern: rather than requiring complex flag parsing for structured payloads (entities, relations), the CLI expects JSON piped in, keeping the interface simple for scripting and automation while pushing complexity into JSON payload construction by the caller.

## Integration Points

UkbDatabaseCli's most significant integration point is with the VKB server itself (parent: VkbServer), specifically the `/api/health` endpoint for availability checks and the broader API surface defined in `lib/vkb-server/api-routes.js`'s `ApiRoutes.registerRoutes()` (covering `/api/entities`, `/api/relations`, `/api/export`, etc.) when operating in server-proxy mode. This creates a direct dependency relationship where UkbDatabaseCli acts as one of potentially many consumers of the same HTTP surface that VkbApiClient also targets.

On the direct-access side, it depends on `DatabaseManager` and `UKBDatabaseWriter` abstractions to reach sqlite, qdrant, and the graph database backend, making it a bridge between raw storage engines and CLI-level commands.

Its sibling VkbServerCli manages starting/stopping the server process itself, meaning a natural operational sequence exists: `VkbServerCli`'s `server start` brings up the HTTP surface that `UkbDatabaseCli` can subsequently detect via `isVKBRunning()` and route through.

## Usage Guidelines

Developers should be aware that UkbDatabaseCli's behavior is environment-sensitive: `VKB_SERVER_URL` and `CODING_TEAM` env vars materially change routing and data scoping, so scripts using this CLI should explicitly set or verify these variables rather than relying on defaults in ambiguous contexts. Because of the short health-check timeout, transient server slowness may cause the CLI to silently fall back to direct database mode — worth remembering when debugging inconsistent behavior between runs. Finally, since commands consume JSON via stdin, callers should validate JSON structure before piping to avoid opaque failures, and should expect thrown errors to carry server-supplied `error.message` text when running in proxied mode.


## Hierarchy Context

### Parent
- [VkbServer](./VkbServer.md) -- lib/vkb-server/api-routes.js's ApiRoutes.registerRoutes() wires dozens of endpoints (/api/entities, /api/relations, /api/stats, /api/export, /api/query, /api/ontology/classes) as the single HTTP surface for all consumers

### Siblings
- [ApiRoutes](./ApiRoutes.md) -- ApiRoutes.registerRoutes(app) registers core CRUD endpoints like app.get('/api/entities'), app.post('/api/entities'), app.put('/api/entities/:name'), and app.delete('/api/entities/:name')
- [VkbApiClient](./VkbApiClient.md) -- isServerAvailable() checks /api/health and returns true based solely on response.ok, deliberately not requiring graph===true because 'Entity APIs work via HTTP even if graph health check has issues'
- [VkbServerCli](./VkbServerCli.md) -- The `server start` subcommand instantiates a VKBServer and calls server.start({ foreground, force }), reporting result.alreadyRunning vs a fresh PID and log file


---

*Generated from 4 observations*
