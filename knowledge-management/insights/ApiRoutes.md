# ApiRoutes

**Type:** Detail

State-changing git operations for branch-avenue merge/promote/prune (e.g. app.post('/api/experiments/avenue-promote')) are proxied to a host coordinator seam at :3034 instead of executing locally, per the comment 'every state-changing git op MUST run host-side, NEVER in this container'

# ApiRoutes — Technical Insight Document

## What It Is

`ApiRoutes` is implemented in `lib/vkb-server/api-routes.js` and serves as the HTTP routing layer for `VkbServer`. Its central method, `registerRoutes(app)`, wires dozens of endpoints — including core CRUD operations (`app.get('/api/entities')`, `app.post('/api/entities')`, `app.put('/api/entities/:name')`, `app.delete('/api/entities/:name')`) as well as broader surface area like `/api/relations`, `/api/stats`, `/api/export`, `/api/query`, and `/api/ontology/classes`. This class is the single HTTP surface through which all consumers of the VKB system interact, making it the primary integration boundary between external clients and the underlying database/experiment infrastructure.

## Architecture and Design

The design reflects a clear separation-of-concerns strategy: rather than inlining all functionality, `ApiRoutes` delegates domain-specific route groups to dedicated modules. The kgbench-related endpoints are handled by a separate `registerKgbenchRoutes(app, { repoRoot, coordinatorPost, logger })` call, keeping specialized benchmarking logic out of the core routing class while still injecting shared dependencies (repo root, a coordinator POST function, and a logger) via a plain options object — a lightweight dependency-injection pattern.

A more significant architectural decision is the enforcement of a **host/container security boundary** for git operations. State-changing git actions (branch-avenue merge/promote/prune, e.g. `app.post('/api/experiments/avenue-promote')`) are never executed inside the local process; instead they are proxied to a host-side coordinator listening on port 3034. The inline comment — "every state-changing git op MUST run host-side, NEVER in this container" — makes explicit that this is a hard security/isolation constraint, not an incidental implementation detail. This effectively splits the route layer into two trust zones: read-only/local-safe operations handled directly, and mutating git operations forwarded to a privileged host process.

A second boundary enforced at the routing layer is a **two-store separation** between experiment data and other application data. Endpoints such as `/api/experiments/run-status/:runId` are documented as pure file reads of `progress.json`, explicitly avoiding any access to the experiment LevelDB. This suggests a deliberate architectural rule preventing route handlers from blurring storage boundaries, likely to avoid lock contention or consistency issues between the file-based progress tracking and the LevelDB-backed experiment store.

## Implementation Details

Beyond routing, `ApiRoutes` owns database writer lifecycle management. The constructor eagerly creates one `UKBDatabaseWriter` per known team (`coding`, `ui`, `resi`), and a `_getWriter()` helper lazily instantiates writers for any unlisted team on demand. This design explicitly avoids a "silent fallback to coding" — i.e., it prevents a bug class where an unrecognized team's writes would be silently misattributed to the default team's database. This is a defensive-coding pattern: fail-fast/explicit-handling over implicit defaults.

The route registration itself is structured as a single method (`registerRoutes(app)`) that acts as a composition root — attaching core CRUD handlers directly and delegating out to `registerKgbenchRoutes` for a bounded, more specialized subset of functionality.

## Integration Points

`ApiRoutes` is a component of `VkbServer`, forming the HTTP interface that the entire server exposes. Its sibling components consume this surface indirectly: `VkbApiClient.isServerAvailable()` checks `/api/health` and treats any `response.ok` as availability, deliberately decoupling entity-API health from graph-health status — reflecting that entity CRUD routes registered here remain functional independent of graph subsystem issues. Similarly, `UkbDatabaseCli.isVKBRunning()` pings the same `/api/health` endpoint (with a 1-second abort timeout) to decide whether to route operations through the server versus operating locally. `VkbServerCli`'s `server start` subcommand is the operational entry point that ultimately causes `ApiRoutes.registerRoutes` to be invoked, via `VKBServer.start({ foreground, force })`.

The proxy relationship to the host coordinator at port 3034 is a key external integration point — one that ties the API layer's security model to a separate host-side process for any mutating git operation.

## Usage Guidelines

Developers extending `ApiRoutes` should preserve the delegation pattern rather than inlining new domain-specific route groups directly — following the precedent set by `registerKgbenchRoutes`. Any new state-changing git operation must be proxied to the host coordinator rather than executed in-container, per the explicit security comment; this rule should be treated as non-negotiable given its documented rationale. Route handlers touching experiment data should maintain the two-store boundary — reading `progress.json` for status rather than reaching into the experiment LevelDB. Finally, when adding support for new teams in writer-related endpoints, use `_getWriter()`'s explicit lazy-creation pattern rather than introducing implicit fallbacks, to avoid the silent-misattribution failure mode this design was built to prevent.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- ApiRoutes (class) in api-routes.js


## Hierarchy Context

### Parent
- [VkbServer](./VkbServer.md) -- lib/vkb-server/api-routes.js's ApiRoutes.registerRoutes() wires dozens of endpoints (/api/entities, /api/relations, /api/stats, /api/export, /api/query, /api/ontology/classes) as the single HTTP surface for all consumers

### Siblings
- [VkbApiClient](./VkbApiClient.md) -- isServerAvailable() checks /api/health and returns true based solely on response.ok, deliberately not requiring graph===true because 'Entity APIs work via HTTP even if graph health check has issues'
- [UkbDatabaseCli](./UkbDatabaseCli.md) -- isVKBRunning() pings `${VKB_SERVER_URL}/api/health` with a 1-second AbortSignal timeout before deciding whether to route through the server
- [VkbServerCli](./VkbServerCli.md) -- The `server start` subcommand instantiates a VKBServer and calls server.start({ foreground, force }), reporting result.alreadyRunning vs a fresh PID and log file


---

*Generated from 6 observations*
