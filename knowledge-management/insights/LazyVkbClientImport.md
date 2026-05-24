# LazyVkbClientImport

**Type:** Detail

The dynamic import is conditional on the result of isServerAvailable(): when the probe confirms the server is reachable, VkbApiClient is imported and all subsequent adapter calls are delegated to it via HTTP; when the probe returns false, the import is skipped entirely and GraphDatabaseService/LevelDB is used instead.

# LazyVkbClientImport

## What It Is

LazyVkbClientImport is an architectural pattern implemented in `storage/graph-database-adapter.ts` that defers the loading of the `VkbApiClient` module until runtime conditions warrant it. Rather than declaring a static top-level `import` statement for `VkbApiClient`, the adapter uses a dynamic `import()` expression inside its `initialize()` method. This design ensures that the VKB client module is never loaded in environments where the VKB server is absent at startup, eliminating unnecessary module evaluation, memory overhead, and dependency resolution in offline or degraded deployments.

The pattern is a child concern of the broader `GraphDatabaseAdapter` component, which orchestrates the lifecycle decision of whether to delegate persistence operations to a remote HTTP service or to fall back to local storage. Specifically, the dynamic import is gated by the boolean result of `isServerAvailable()` — a probe invoked exactly once during initialization. When the probe succeeds, `VkbApiClient` is imported and becomes the active backend; when it fails, the import never occurs and `GraphDatabaseService`/LevelDB takes its place.

## Architecture and Design

The core architectural pattern at play is **lazy/conditional module loading** combined with the **strategy selection** behavior of the parent `GraphDatabaseAdapter`. By moving `VkbApiClient` from the static module graph to a runtime branch, the adapter achieves a form of dependency decoupling: the file `storage/graph-database-adapter.ts` advertises only a hard dependency on `GraphDatabaseService`/LevelDB at static analysis time, while the VKB integration becomes an optional, dynamically resolved capability. This is a deliberate inversion of the typical "import everything, decide later" pattern.

This design works in tight coordination with its sibling pattern, `SingleProbeRoutingDecision`. Together, they form a two-part contract: `SingleProbeRoutingDecision` ensures the routing question is asked exactly once (via a single `isServerAvailable()` call during `initialize()`), and LazyVkbClientImport ensures that the *cost* of choosing the remote path — namely, loading the `VkbApiClient` module — is only paid when that path is selected. The combination yields a startup profile that scales cleanly with deployment topology: minimal cost when offline, full HTTP delegation when online.

A noteworthy consequence is the asymmetry in dependency visibility. Static analyzers, bundlers, and type-checkers that do not specifically reason about dynamic `import()` expressions will see `storage/graph-database-adapter.ts` as having no compile-time dependency on `VkbApiClient`. This is by design — it allows the adapter to be packaged and shipped without forcing `VkbApiClient` into every bundle — but it places certain obligations on tooling configuration, discussed below.

## Implementation Details

The mechanic is straightforward in code structure but architecturally significant. Within the `initialize()` method of the adapter defined in `storage/graph-database-adapter.ts`, the flow is:

1. Invoke `isServerAvailable()` to probe the VKB server. This call happens exactly once for the lifetime of the adapter instance, per the `SingleProbeRoutingDecision` contract enforced at the parent level.
2. If the probe returns `true`, execute `await import('...VkbApiClient...')` to dynamically resolve and load the `VkbApiClient` module. The resulting client is then retained as the adapter's delegate, and all subsequent adapter calls (graph reads, writes, <USER_ID_REDACTED>) are forwarded over HTTP to the VKB server through this client.
3. If the probe returns `false`, the dynamic `import()` is never reached. The adapter instead initializes and routes operations through `GraphDatabaseService`/LevelDB, which is statically imported.

Because the dynamic import sits behind a conditional, the JavaScript engine never evaluates the `VkbApiClient` module in the offline branch — its top-level code never runs, its transitive dependencies are never resolved, and it contributes nothing to the runtime memory footprint. This is fundamentally different from a pattern where a client object is instantiated conditionally but the module is still statically imported; here, both the module load and the object construction are gated.

The routing decision, once made, is permanent for the adapter instance. There is no re-probe, no fallback after a failed HTTP call, and no dynamic switching between backends. This stability is a property inherited from the `SingleProbeRoutingDecision` design at the parent layer.

## Integration Points

LazyVkbClientImport's primary integration boundary is internal to `storage/graph-database-adapter.ts`. The pattern interacts with:

- **`isServerAvailable()`** — the probe function whose boolean return value is the sole gating condition for the dynamic import. This function is the bridge between network state and module-loading behavior.
- **`VkbApiClient`** — the dynamically imported module. When loaded, it becomes the HTTP-backed implementation of the adapter's operations. Its absence from the static import list is the defining characteristic of this pattern.
- **`GraphDatabaseService` / LevelDB** — the statically imported fallback. These dependencies are always present in the module graph regardless of deployment context, which means LevelDB and `GraphDatabaseService` are always available even in environments where they are unused.
- **Bundlers and type-checkers** — these tools see only the static dependency on `GraphDatabaseService`/LevelDB unless they are explicitly configured to follow dynamic `import()` expressions. Bundling configurations may need to either include `VkbApiClient` as an external chunk, code-split it, or exclude it from offline builds entirely.

At the higher architectural level, the pattern integrates with the parent `GraphDatabaseAdapter`'s lifecycle: the dynamic import happens inside `initialize()`, meaning callers do not see latency for module loading until they perform the explicit initialization step.

## Usage Guidelines

Developers working with or extending this pattern should observe several conventions. First, do not "fix" the dynamic import by converting it to a static top-level import — doing so would defeat the entire purpose of the design and force `VkbApiClient` to be evaluated in every environment, including those without a reachable VKB server. The lazy form is load-bearing.

Second, treat the routing decision as immutable for the adapter instance. The `SingleProbeRoutingDecision` sibling pattern guarantees that `isServerAvailable()` is called exactly once; do not introduce code paths that re-invoke the probe or attempt to "upgrade" from LevelDB to the VKB client mid-lifetime. If such adaptability is required, it should be a deliberate redesign at the `GraphDatabaseAdapter` level rather than a patch within the lazy-import logic.

Third, ensure that build tooling correctly handles the dynamic `import()`. Bundlers such as Webpack, esbuild, or Rollup, and type-checking tools like TypeScript, each have specific behaviors regarding dynamic imports. Verify that the `VkbApiClient` module is reachable at runtime in environments expected to use the remote path, and that it can be cleanly excluded or code-split in environments expected to operate offline. Type-checking the `VkbApiClient` interface at the call site should use explicit type imports (`import type`) to maintain compile-time safety without triggering runtime module loading.

Fourth, when adding new operations to the adapter, route them through the same conditional structure established by `initialize()`. The expectation is that a delegate (either `VkbApiClient` or `GraphDatabaseService`) is selected once and then used uniformly; new methods should not re-introduce branch logic or attempt their own dynamic imports.

Finally, recognize that this pattern is an explicit trade-off favoring startup efficiency and deployment flexibility over runtime adaptability. It assumes that server availability at initialization time is a reliable proxy for server availability throughout the adapter's lifetime — a simplification that pairs naturally with the predictability emphasis of `SingleProbeRoutingDecision`.


## Hierarchy Context

### Parent
- [GraphDatabaseAdapter](./GraphDatabaseAdapter.md) -- storage/graph-database-adapter.ts dynamically imports VkbApiClient during its first initialize() call and invokes isServerAvailable() exactly once, making this single probe the permanent routing decision for the adapter instance's lifetime

### Siblings
- [SingleProbeRoutingDecision](./SingleProbeRoutingDecision.md) -- storage/graph-database-adapter.ts calls isServerAvailable() exactly once during initialize(), making this the sole input to the routing decision for the adapter instance's lifetime — a deliberate design that trades adaptability for simplicity and predictability.


---

*Generated from 3 observations*
