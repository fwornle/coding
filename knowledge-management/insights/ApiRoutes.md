# ApiRoutes

**Type:** Detail

[LLM] Cross-referencing the client-side evidence against the `ApiRoutes` class name strongly implies a request/response contract that is informally versioned and duplicated on the CONSUMING side rather than centrally documented on the SERVING side. `VkbApiClient.js` implements `getEntities`, `createEntity`, `updateEntity`, `deleteEntity`, `getRelations`, `createRelation`, `deleteRelation`, and `exportTeam` against this presumed route surface, while `lib/ukb-database/cli.js` reimplements a parallel, lower-fidelity client (`isVKBRunning()`, `sendToVKB()`) against the same routes with different timeouts (1000ms vs. `VkbApiClient`'s 2000ms for health checks, 10000ms default for data operations). Because `ApiRoutes` is the single source of truth for the actual contract (status codes, error envelope shape, required fields), any route change in `api-routes.js` risks silently breaking one of these two independently-maintained clients without the other noticing, since neither shares a schema or OpenAPI-style definition with `ApiRoutes`.

# ApiRoutes — Technical Insight Document

## What It Is

`ApiRoutes` is a class defined in `api-routes.js`, and it is the sole entity the code graph resolves for that file — no internal methods or call edges are present. Rather than being an oversight, this itself is diagnostic: it indicates `ApiRoutes` is likely a thin HTTP route-registration surface (e.g., wiring `/api/health`, `/api/entities`, and `/api/relations` handlers) mounted by its parent, `VKBServer` (in `index.js`), rather than a deep service class with rich internal structure. `ApiRoutes` functions as the HTTP boundary of the VKB server process — the single, authoritative surface that all external clients must go through to read or write entity/relation data.

## Architecture and Design

The dominant pattern here is **route-layer/service-layer separation**: `ApiRoutes` is contained by `VKBServer`, which owns the actual process lifecycle, while `ApiRoutes` presumably exposes that logic over HTTP. This separation is coupled to a **duplicated client pattern** — rather than a shared SDK, two independent consumers reimplement the HTTP contract from scratch: the sibling `VkbApiClient` (`lib/ukb-unified/core/VkbApiClient.js`) and `lib/ukb-database/cli.js`. Neither shares a schema, OpenAPI spec, or common request helper with `ApiRoutes`, meaning the contract (status codes, error envelope, field names) is defined only implicitly, on the server side, and re-derived independently on each client.

A second notable design decision is **asymmetric read/write routing**: `lib/ukb-database/cli.js`'s `add-entity`/`add-relation` commands bypass `ApiRoutes` entirely, writing directly to `DatabaseManager`/`UKBDatabaseWriter` (SQLite/Qdrant/graph-DB under `.data/`), while `update-entity` checks `isVKBRunning()` and, if the server is live, prefers routing through `ApiRoutes`. This implies at least one `ApiRoutes` handler (likely `PUT /api/entities/:name`) carries side effects — plausibly cache invalidation or decay-state recalculation — that a raw database write does not replicate.

Finally, resilience is pushed **outside** `ApiRoutes` entirely: the sibling remediation logic in `health-remediation-actions.js` (`restartVKBServer`, calling `supervisorctlRestart`) treats the whole process as the unit of recovery. There's no evidence of per-route timeouts or circuit breakers inside `api-routes.js` itself — a wedged handler is recovered via full process restart, not targeted mitigation.

## Implementation Details

Because the graph exposes no internal methods, `ApiRoutes`' implementation must be inferred from consumer behavior. The `VkbApiClient` sibling implements `getEntities`, `createEntity`, `updateEntity`, `deleteEntity`, `getRelations`, `createRelation`, `deleteRelation`, and `exportTeam`, each independently constructing a `fetch` call and unwrapping errors via `if (!response.ok) { const error = await response.json(); throw new Error(error.message || 'Failed to X'); }`. The consistency of this pattern across eight call sites strongly implies `ApiRoutes` handlers return a JSON body with a `message` field on non-2xx responses — but none of the clients defensively verify the body is valid JSON before parsing, so any handler that returns a raw string or HTML (e.g., from a proxy timeout or unhandled exception) will produce a confusing `SyntaxError` instead of a descriptive error.

Health semantics are similarly inferred: `isServerAvailable()` (`VkbApiClient.js:20-33`) treats any 200 from `/api/health` as sufficient, explicitly ignoring an internal `graph` sub-field ("Entity APIs work via HTTP even if graph health check has issues"). `lib/ukb-database/cli.js:28-40`'s `isVKBRunning()` reimplements the same check with a different timeout (1000ms vs. 2000ms in `VkbApiClient`), and `sendToVKB()` (`cli.js:45-60`) reimplements generic request/error handling independently of `VkbApiClient`'s boilerplate.

## Integration Points

`ApiRoutes` is contained by `VKBServer`, which mounts it and presumably provides the underlying entity/relation/decay/caching logic the routes expose. On the consumer side, it integrates with the sibling `VkbApiClient` class and the standalone `lib/ukb-database/cli.js` script, both targeting the same endpoint surface with independently-written HTTP logic and divergent timeout configurations. It also integrates indirectly with `health-remediation-actions.js` via `VKBServer`'s supervised-process relationship — a failure inside `ApiRoutes` surfaces as a `restartVKBServer` remediation action rather than a route-local failure. No integration with `WorkflowOrchestrator` or `VKBServerCLI`/`UKBUnifiedCLI` is directly evidenced in these observations, though those siblings exist at the same hierarchy level.

## Usage Guidelines

Any change to a handler in `api-routes.js` must be treated as a breaking-change risk against *two* independently maintained clients (`VkbApiClient.js` and `lib/ukb-database/cli.js`) — there is no shared SDK to update once. Error responses must consistently return JSON with a `message` field; deviating from this (e.g., returning HTML or plain text on failure) will break every consumer's fallback logic. Developers modifying entity-update behavior must remember the live-server path (via `ApiRoutes`) and the direct-database-write path are NOT equivalent — the former likely carries cache/decay side effects the latter doesn't replicate, so they cannot be freely substituted for one another. Finally, because resilience is handled at the process level (via `supervisorctlRestart`) rather than per-route, handlers inside `ApiRoutes` should be written defensively against slow/blocking operations, since there is no in-process circuit breaker to fall back on.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- ApiRoutes (class) in api-routes.js

**Relationships:**
- The parent-context observation pairs `VKBServer` (the class presumably instantiating and mounting `ApiRoutes`) with a dedicated `restartVKBServer` remediation method in `health-remediation-actions.js`, which calls `log` and `supervisorctlRestart`. This tells us `ApiRoutes` is not a stateless, horizontally-scalable route table — it's bound to a single supervised process instance, and if any handler inside `ApiRoutes` wedges (e.g., a slow graph query blocking the event loop), the system's recovery mechanism is a full process restart via `supervisorctlRestart` rather than a targeted route-level circuit breaker. This constrains how defensive `ApiRoutes` handlers need to be internally: since there's no per-route timeout/circuit-breaking visible in the graph data, resilience is pushed to the external supervisor layer instead of being handled within `api-routes.js` itself.

**Other:**
- The code graph identifies a single key entity for this component: an `ApiRoutes` class in `api-routes.js`. No other classes, methods, or call edges for this file are present in the supplied graph data, which is itself informative — it suggests `ApiRoutes` is either a thin, self-contained route-registration class (e.g., wiring Express/Fastify handlers to already-external logic) or that the graph indexer has not yet resolved its internal method-level structure. Given the parent-context observation that `VKBServer` (in `index.js`) is the SubComponent's central entity, `ApiRoutes` is almost certainly the HTTP route layer that `VKBServer` mounts to expose the `/api/health`, `/api/entities`, and `/api/relations` endpoints that three independent client implementations (`VkbApiClient.js`, `lib/ukb-database/cli.js`, and presumably the unified CLI's entity/relation commands) all target.


## Hierarchy Context

### Siblings
- [VKBServerCLI](./VKBServerCLI.md) -- [LLM] `VkbApiClient.js` (`lib/ukb-unified/core/VkbApiClient.js`) exposes eight methods — `isServerAvailable`, `getEntities`, `searchEntities`, `deleteEntity`, `createEntity`, `updateEntity`, `getRelations`, `deleteRelation`, `createRelation`, `exportTeam` — and every single one independently constructs its own `fetch` call, its own `AbortSignal.timeout`, and its own `if (!response.ok) { const error = await response.json(); throw new Error(error.message || 'Failed to X'); }` block. There is no shared `_request()` or `_handleResponse()` helper anywhere in the class. This is a textbook copy-paste-drift risk: `searchEntities` delegates to `getEntities` (reuse exists there), but every other method reimplements the boilerplate from scratch, meaning a change to error-shape handling (e.g. supporting a non-JSON error body, or adding a request-id header) requires seven coordinated edits rather than one.
- [UKBUnifiedCLI](./UKBUnifiedCLI.md) -- [LLM] [object Object]
- [WorkflowOrchestrator](./WorkflowOrchestrator.md) -- [CGR] WorkflowOrchestrator (class) in WorkflowOrchestrator.js
- [VkbApiClient](./VkbApiClient.md) -- [CGR] VkbApiClient (class) in VkbApiClient.js


---

*Generated from 10 observations*
