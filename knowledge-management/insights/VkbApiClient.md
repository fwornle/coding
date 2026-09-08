# VkbApiClient

**Type:** Detail

[LLM] Every one of the eight HTTP methods in `lib/ukb-unified/core/VkbApiClient.js` — `getEntities`, `deleteEntity`, `createEntity`, `updateEntity`, `getRelations`, `deleteRelation`, `createRelation`, `exportTeam` — independently repeats the identical five-step boilerplate: build URL, `fetch()` with `AbortSignal.timeout(this.timeout)`, check `!response.ok`, parse the error body via `response.json()`, and throw `new Error(error.message || 'Failed to X')`. There is no shared `#request()` or `_fetch()` private helper, so the class has eight near-identical fetch call sites instead of one parametrized one. This duplication means a cross-cutting change (auth headers, retry-on-5xx, exponential backoff, consistent error typing/status codes) requires eight coordinated edits, and any one of them drifting (e.g. a future method forgetting the `!response.ok` check) would silently swallow HTTP errors as a successful `.json()` parse of an error payload.

# VkbApiClient: Technical Insight Document

## What It Is

`VkbApiClient` is implemented as a hand-authored JavaScript class in `lib/ukb-unified/core/VkbApiClient.js`, with a parallel, separately-maintained TypeScript declaration file at `lib/ukb-unified/core/VkbApiClient.d.ts`. It functions as a thin HTTP client wrapping the VKB server's REST surface — `/api/entities`, `/api/relations`, `/api/export`, and `/api/health` — behind eight instance methods: `getEntities`, `searchEntities`, `createEntity`, `updateEntity`, `deleteEntity`, `getRelations`, `createRelation`, `deleteRelation`, `exportTeam`, and `isServerAvailable`. As a component, it is contained by both `ManualLearning` and `VKBServer`, positioning it as the primary programmatic gateway these parents use to talk to the VKB backend, and it sits alongside siblings `ApiRoutes`, `VKBServerCLI`, `UKBUnifiedCLI`, and `WorkflowOrchestrator` in the broader UKB/VKB subsystem.

## Architecture and Design

The dominant pattern is a **thin HTTP client / API gateway**: each public method maps one-to-one to a server endpoint, with no abstraction layer beyond the method boundary. This is paired with a **declaration-file-as-contract pattern** — `VkbApiClient.d.ts` is not generated via `tsc --declaration` but hand-written alongside the `.js` implementation, meaning TypeScript consumers (notably dashboard `.tsx` files) depend on a contract that must be manually kept in sync whenever a method like `getEntities` or `exportTeam` changes signature.

A second defining architectural characteristic is the **absence of a shared request helper**. Every method — `getEntities`, `deleteEntity`, `createEntity`, `updateEntity`, `getRelations`, `deleteRelation`, `createRelation`, `exportTeam` — independently repeats the same five-step boilerplate: build a URL, call `fetch()` with `AbortSignal.timeout(this.timeout)`, check `!response.ok`, parse the error body via `response.json()`, and throw a formatted `Error`. No `#request()` or `_fetch()` private method exists to centralize this, a gap also independently flagged from the sibling `VKBServerCLI` perspective. The one exception is `searchEntities`, which reuses `getEntities` by delegating with a `searchTerm` parameter rather than hitting a distinct endpoint — a narrow instance of DRY in an otherwise duplicated codebase.

The system also exhibits a **fail-open availability check**: `isServerAvailable()` treats any 200 response as "healthy" without inspecting deeper graph/entity health, deferring granular failure detection to the individual entity/relation calls themselves.

## Implementation Details

The constructor (`constructor(options = {})`) accepts `baseUrl`, `timeout` (defaulting to 10000ms via `options.timeout || 10000`), and `debug`. Of these, `this.debug` is stored but never referenced anywhere else in the class body — it is dead configuration; callers such as `initializeDatabase` in `lib/ukb-database/cli.js` that pass `{ debug: true }` observe no behavioral change.

`isServerAvailable()` (lines 17–33) deliberately uses a hardcoded `AbortSignal.timeout(2000)` instead of the configurable `this.timeout`, justified in-code as a "fail fast" health-check design. This creates an asymmetry: callers who raise `this.timeout` for slow environments (cold-start CI, throttled networks) get no equivalent adjustment for the availability probe, risking false-negative unavailability under load.

URL construction is inconsistent in a subtle but consequential way. Query-based methods build `URLSearchParams` for filtering (e.g., `getEntities`'s `${this.baseUrl}/api/entities${query ? `?${query}` : ''}`), while path-segment identifiers are manually escaped with `encodeURIComponent(name)`, as seen in `deleteEntity` and `updateEntity` (lines 66–81). There is no unifying `buildUrl(path, params)` helper, so this split relies on convention rather than enforcement.

`deleteRelation(from, to, params = {})` (lines 143–160) diverges structurally from `createRelation(relationData)`: deletion merges `from`, `to`, and `params` into a single `URLSearchParams` for a DELETE request, while creation POSTs a single JSON object body. This is conventional REST design but means the two operations on `/api/relations` have non-mirrored parameter shapes.

## Integration Points

`VkbApiClient` is contained by `VKBServer` and `ManualLearning`, serving as their conduit to the VKB HTTP API. Its TypeScript declaration (`VkbApiClient.d.ts`) is the contract consumed by dashboard `.tsx` files. Notably, its HTTP contract is **independently reimplemented** rather than shared: `lib/ukb-database/cli.js`'s `isVKBRunning()`/`sendToVKB()` functions (lines 27–45) duplicate the same request/response logic with yet another timeout value (1000ms), distinct from both `isServerAvailable()`'s 2000ms and the class's default 10000ms — three uncoordinated timeout constants for conceptually related health/availability checks across the codebase.

## Usage Guidelines

Developers extending this class should be aware of several traps baked into its current design. First, any new method must replicate the fetch/error-check/parse pattern by hand unless a shared helper is introduced — omitting the `!response.ok` check would silently swallow HTTP errors as successful JSON parses. Second, adding or renaming a method requires a manual, easy-to-forget edit to `VkbApiClient.d.ts` to avoid TypeScript consumers drifting from runtime behavior. Third, path-segment values (like entity names) must be explicitly wrapped in `encodeURIComponent` — there is no enforced helper, so a new method could accidentally introduce injection-style URL corruption. Finally, do not rely on `isServerAvailable()`'s pass/fail as tunable via the constructor's `timeout` option; it's hardcoded at 2000ms regardless of instance configuration, and the `debug` constructor option currently has zero effect on behavior — don't assume it enables logging without adding that logic yourself.


## Code Evidence

Key code artifacts grounding this entity's analysis:

**Structural:**
- VkbApiClient (class) in VkbApiClient.js
- VkbApiClient (class) in VkbApiClient.d.ts

**Other:**
- VkbApiClient.js (module) in VkbApiClient.js
- VkbApiClient.d.ts (module) in VkbApiClient.d.ts
- The code graph identifies exactly one class entity, `VkbApiClient`, present in both `VkbApiClient.js` (implementation) and `VkbApiClient.d.ts` (type declaration) — indicating this is a hand-maintained JS class with a parallel, separately-authored TypeScript declaration file rather than a TS source compiled to JS. This dual-file pattern is a maintenance risk distinct from the parent-context's `restartVKBServer`/`VKBServer` pairing: any method added, renamed, or resignatured in `VkbApiClient.js` (e.g. `getEntities`, `createEntity`, `updateEntity`, `deleteEntity`, `getRelations`, `createRelation`, `deleteRelation`, `exportTeam`, `isServerAvailable`) requires a manual, easy-to-forget parallel edit in `VkbApiClient.d.ts` to keep TypeScript consumers (such as the dashboard's `.tsx` files) from silently drifting out of sync with runtime behavior.


## Hierarchy Context

### Siblings
- [ApiRoutes](./ApiRoutes.md) -- [CGR] ApiRoutes (class) in api-routes.js
- [VKBServerCLI](./VKBServerCLI.md) -- [LLM] `VkbApiClient.js` (`lib/ukb-unified/core/VkbApiClient.js`) exposes eight methods — `isServerAvailable`, `getEntities`, `searchEntities`, `deleteEntity`, `createEntity`, `updateEntity`, `getRelations`, `deleteRelation`, `createRelation`, `exportTeam` — and every single one independently constructs its own `fetch` call, its own `AbortSignal.timeout`, and its own `if (!response.ok) { const error = await response.json(); throw new Error(error.message || 'Failed to X'); }` block. There is no shared `_request()` or `_handleResponse()` helper anywhere in the class. This is a textbook copy-paste-drift risk: `searchEntities` delegates to `getEntities` (reuse exists there), but every other method reimplements the boilerplate from scratch, meaning a change to error-shape handling (e.g. supporting a non-JSON error body, or adding a request-id header) requires seven coordinated edits rather than one.
- [UKBUnifiedCLI](./UKBUnifiedCLI.md) -- [LLM] [object Object]
- [WorkflowOrchestrator](./WorkflowOrchestrator.md) -- [CGR] WorkflowOrchestrator (class) in WorkflowOrchestrator.js


---

*Generated from 14 observations*
