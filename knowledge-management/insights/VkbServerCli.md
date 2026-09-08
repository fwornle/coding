# VKBServerCLI

**Type:** Detail

[LLM] `lib/ukb-database/cli.js` reimplements the exact same two responsibilities found in `VkbApiClient.js` — server-liveness probing (`isVKBRunning()`) and raw request dispatch (`sendToVKB(method, path, body, team)`) — as free functions rather than importing the client class. The duplication is not just structural but behaviorally divergent: `isVKBRunning()` uses a 1000ms timeout against `/api/health` versus the client's 2000ms in `isServerAvailable()`, and `sendToVKB()`'s error branch (`error.message || 'HTTP ${response.status}: ${response.statusText}'`) differs from every per-method message in `VkbApiClient.js` (`'Failed to X'` fallback). Two independent callers guessing slightly different timeout/error conventions against the same undocumented HTTP contract (`/api/health`, `/api/entities`, `/api/relations`) is a maintenance hazard if the server's actual health-check latency or error-body shape ever changes — one caller could silently start failing while the other keeps working.

# VKBServerCLI — Technical Insight Document

## What It Is

VKBServerCLI, as instantiated under the parent VKBServer, is not a single monolithic module but a set of CLI-facing entry points that talk to the VKB HTTP surface (`/api/health`, `/api/entities`, `/api/relations`). The two concrete implementations analyzed are `lib/ukb-unified/cli.js` (which composes `VkbApiClient` from `lib/ukb-unified/core/VkbApiClient.js`, a sibling entity) and `lib/ukb-database/cli.js`, which implements its own parallel free-function client (`isVKBRunning()`, `sendToVKB()`) rather than reusing `VkbApiClient`. Both CLIs exist to let operators and scripts perform entity/relation CRUD and team export operations against a running VKB server, with fallback behavior for direct database writes when the server isn't reachable.

## Architecture and Design

The dominant pattern is what can be called an **ad hoc HTTP client pattern**: `VkbApiClient.js` exposes eight methods (`isServerAvailable`, `getEntities`, `searchEntities`, `deleteEntity`, `createEntity`, `updateEntity`, `getRelations`, `deleteRelation`, `createRelation`, `exportTeam`), and nearly every one independently builds its own `fetch`, `AbortSignal.timeout`, and `!response.ok` error-handling block. Only `searchEntities` reuses `getEntities`. There is no shared `_request()`/`_handleResponse()` abstraction.

Layered on top of this is a **duplicated parallel-client pattern**: `lib/ukb-database/cli.js` reimplements the same liveness-check and dispatch responsibilities as standalone functions instead of importing `VkbApiClient`, with behaviorally divergent details (1000ms vs 2000ms timeout, different error-message fallback conventions).

A third pattern, **availability-optimistic health checking**, appears in both `isServerAvailable()` and `isVKBRunning()`: both treat HTTP 200 from `/api/health` as sufficient signal, explicitly declining to gate on richer graph-health payloads (documented inline: "Don't require graph === true... Entity APIs work via HTTP even if graph health check has issues").

Finally, there's an **asymmetric write-path routing** design: `addEntityFromStdin()`/`addRelationFromStdin()` write directly via `UKBDatabaseWriter.storeEntity()`/`storeRelation()` with no liveness check, while `updateEntityFromStdin()` branches on `isVKBRunning()` first, preferring the live server route when available.

## Implementation Details

`VkbApiClient.js` (lines 18-33) implements `isServerAvailable()` with a fixed, non-configurable 2000ms timeout — deliberately decoupled from `this.timeout` (default 10000ms, constructor-configurable via `options.timeout`) used by every data-operation method like `getEntities()` (lines 38-54) and `createEntity()` (lines 96-113). This split treats liveness probing as a cheap, fast-fail check distinct from the budget given to actual mutations.

`exportTeam()` (lines 180-198) is structurally unique: its POST body carries `filePath` alongside `team`, meaning the write happens against the VKB server process's own filesystem, not the caller's — a different contract from every other method where the JSON body is the full payload being persisted.

In `lib/ukb-database/cli.js`, `isVKBRunning()` (lines 27-38) and `sendToVKB(method, path, body, team)` (lines 43-58) reimplement the same responsibilities with different timeout and error-shape conventions than `VkbApiClient`. The update flow explicitly checks `isVKBRunning()` before choosing direct-DB vs. live-server paths, while the add-entity/add-relation flows skip this check entirely, writing straight to SQLite/graph-DB.

## Integration Points

VKBServerCLI sits alongside sibling components `ApiRoutes`, `UKBUnifiedCLI`, `WorkflowOrchestrator`, and `VkbApiClient` under the parent `VKBServer`. It depends on `VkbApiClient` (where `lib/ukb-unified/cli.js`'s `EntityCommand`/`RelationCommand` route through it) and independently on `UKBDatabaseWriter` for direct-write paths in `lib/ukb-database/cli.js`. Both CLI variants run as separate Node processes against the same VKB HTTP surface, meaning relative paths (like `exportTeam`'s `filePath`) resolve against the server's CWD, not the invoking CLI's — a path-resolution hazard not visible from client code alone. Notably, none of the three client-side files integrate with the server-side health remediation mechanism (`restartVKBServer` in `health-remediation-actions.js`, which calls `supervisorctlRestart`) — client failures are terminal `Error` throws with no retry-after-restart coordination.

## Usage Guidelines

Developers extending these CLIs should be aware of several traps. First, error-handling changes (e.g., supporting non-JSON error bodies, adding request-id headers) require coordinated edits across seven-plus methods in `VkbApiClient.js` plus separately in `lib/ukb-database/cli.js` — there's no single choke point. Second, the two independently-tuned liveness timeouts (2000ms vs 1000ms) mean a slow-but-alive server could report differently depending on which CLI checks it; don't assume consistent liveness semantics across the codebase. Third, extending `add-entity`/`add-relation` to require server-side side effects (cache invalidation, decay-state recalculation) would need to explicitly add the liveness-check branching that `updateEntityFromStdin()` already has — this asymmetry currently works by omission, not guaranteed design. Fourth, when invoking `exportTeam`, always use absolute paths since `filePath` resolves server-side. Finally, since no retry-after-restart logic exists, callers operating during a health-remediation window (server restarting) will receive hard failures rather than transient-retry signals — calling code should implement its own backoff if resilience during remediation is required.


## Code Evidence

Key code artifacts grounding this entity's analysis:

- The parent-context code graph identifies `VKBServer` (class, `index.js`) as the central entity paired with `restartVKBServer` (`health-remediation-actions.js`, calling `log` and `supervisorctlRestart`). None of the three client-side files analyzed here (`VkbApiClient.js`, `lib/ukb-database/cli.js`, `lib/ukb-unified/cli.js`) contain any retry-after-restart or backoff logic keyed to that remediation action — every client treats a failed request as a terminal `Error` to propagate, with no awareness that a `supervisorctlRestart` might be in flight or might resolve the failure moments later. This means the recovery loop the health system runs (detect unhealthy → restart) and the client's failure path (throw and let the caller decide) are entirely disconnected; a caller invoking these CLIs during a remediation window gets a hard failure rather than any signal that a retry might soon succeed.


## Hierarchy Context

### Siblings
- [ApiRoutes](./ApiRoutes.md) -- [CGR] ApiRoutes (class) in api-routes.js
- [UKBUnifiedCLI](./UKBUnifiedCLI.md) -- [LLM] [object Object]
- [WorkflowOrchestrator](./WorkflowOrchestrator.md) -- [CGR] WorkflowOrchestrator (class) in WorkflowOrchestrator.js
- [VkbApiClient](./VkbApiClient.md) -- [CGR] VkbApiClient (class) in VkbApiClient.js


---

*Generated from 10 observations*
