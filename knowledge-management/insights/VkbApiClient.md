# VkbApiClient

**Type:** Detail

isServerAvailable() checks /api/health and returns true based solely on response.ok, deliberately not requiring graph===true because 'Entity APIs work via HTTP even if graph health check has issues'

# VkbApiClient: Technical Insight Document

## What It Is

VkbApiClient is a client-side class implemented in `VkbApiClient.js` (with corresponding type declarations in `VkbApiClient.d.ts`) that provides a JavaScript API surface for communicating with the VkbServer's HTTP endpoints. It acts as the consumer-facing wrapper around the server's REST API, translating method calls into HTTP requests against endpoints registered by `ApiRoutes.registerRoutes()`. As a child component of VkbServer, it exists specifically to abstract away raw HTTP mechanics (fetch calls, timeouts, endpoint paths) behind a clean, typed JavaScript interface.

## Architecture and Design

The class follows a **thin-wrapper/facade pattern**: rather than implementing business logic, VkbApiClient's methods (`getEntities()`, `createEntity()`, `updateEntity()`, `deleteEntity()`) map directly to corresponding HTTP verbs and paths on `/api/entities`, mirroring the route definitions in `lib/vkb-server/api-routes.js`. This keeps the client intentionally "dumb," pushing all authoritative logic (validation, persistence, export generation) to the server side.

A notable design decision is in `isServerAvailable()`, which checks `/api/health` but deliberately evaluates availability based solely on `response.ok`, ignoring the `graph` health flag. This reflects an explicit architectural judgment that Entity APIs remain functional over HTTP independent of graph subsystem health — decoupling the availability contract from a specific internal dependency's status, and preventing a non-critical subsystem failure from blocking clients unnecessarily.

The `searchEntities(query, params)` method exemplifies a **composition-over-duplication** approach: rather than exposing a distinct search endpoint, it reuses `getEntities()` with an injected `searchTerm` parameter, avoiding endpoint proliferation and keeping the server-side API surface (and this client's mapping to it) simpler.

`exportTeam(team, filePath)` is architecturally significant because it delegates the actual export operation to the server via a POST to `/api/export`, rather than performing file assembly client-side. This centralizes export logic on the server, ensuring consistency regardless of which client (this API client, a CLI, etc.) triggers the export.

## Implementation Details

Core CRUD methods wrap `/api/entities` endpoints using `AbortSignal.timeout(this.timeout)`, giving every request a configurable, cancellable timeout — a defensive mechanic against hung requests, consistent with the pattern used elsewhere in the system (e.g., `UkbDatabaseCli.isVKBRunning()` uses a similar 1-second `AbortSignal` timeout against `/api/health`).

The dual presence of `VkbApiClient.js` and `VkbApiClient.d.ts` indicates the module ships with hand-authored or generated TypeScript type declarations alongside plain JavaScript implementation, supporting type-checked consumption without a full TypeScript build pipeline.

Method naming and structure directly parallel server route definitions: `getEntities()`, `createEntity()`, `updateEntity()`, and `deleteEntity()` correspond respectively to `app.get('/api/entities')`, `app.post('/api/entities')`, `app.put('/api/entities/:name')`, and `app.delete('/api/entities/:name')` as registered by ApiRoutes — a tight, predictable 1:1 mapping that simplifies tracing client calls to server behavior.

## Integration Points

VkbApiClient is a contained child of VkbServer, and its entire behavior is dependent on the HTTP surface defined by its sibling ApiRoutes, which registers all endpoints (`/api/entities`, `/api/relations`, `/api/stats`, `/api/export`, `/api/query`, `/api/ontology/classes`) as the single point of contact for consumers. Any change to ApiRoutes' endpoint contracts directly impacts VkbApiClient's method implementations.

It also shares a conceptual pattern with sibling UkbDatabaseCli, which independently pings `/api/health` with its own AbortSignal-based timeout to decide whether to route operations through the server — suggesting `/api/health` is a common integration checkpoint across multiple consumers, though each implements its own client logic rather than sharing a unified health-check abstraction.

## Usage Guidelines

Developers should treat `isServerAvailable()` as a lightweight liveness check only — it does not guarantee full subsystem (e.g., graph) health, so callers needing graph-specific guarantees should check that separately. When needing entity search, use `searchEntities()` rather than manually reconstructing `getEntities()` calls with search terms, since it centralizes that translation. For exports, rely on `exportTeam()` rather than assembling export data manually client-side, since the server is the authoritative source for export formatting via `/api/export`. All request-issuing methods respect `this.timeout` via `AbortSignal.timeout`, so configuring an appropriate timeout value at construction is important for balancing responsiveness against slow-network tolerance.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- VkbApiClient (class) in VkbApiClient.js
- VkbApiClient (class) in VkbApiClient.d.ts

**Other:**
- VkbApiClient.js (module) in VkbApiClient.js
- VkbApiClient.d.ts (module) in VkbApiClient.d.ts


## Hierarchy Context

### Parent
- [VkbServer](./VkbServer.md) -- lib/vkb-server/api-routes.js's ApiRoutes.registerRoutes() wires dozens of endpoints (/api/entities, /api/relations, /api/stats, /api/export, /api/query, /api/ontology/classes) as the single HTTP surface for all consumers

### Siblings
- [ApiRoutes](./ApiRoutes.md) -- ApiRoutes.registerRoutes(app) registers core CRUD endpoints like app.get('/api/entities'), app.post('/api/entities'), app.put('/api/entities/:name'), and app.delete('/api/entities/:name')
- [UkbDatabaseCli](./UkbDatabaseCli.md) -- isVKBRunning() pings `${VKB_SERVER_URL}/api/health` with a 1-second AbortSignal timeout before deciding whether to route through the server
- [VkbServerCli](./VkbServerCli.md) -- The `server start` subcommand instantiates a VKBServer and calls server.start({ foreground, force }), reporting result.alreadyRunning vs a fresh PID and log file


---

*Generated from 8 observations*
