# SingletonModulePattern

**Type:** Detail

This design trades explicit testability (injecting a mock registry) for simplicity across the three-consumer topology; a developer modifying any of api-service.js, dashboard-service.js, or health-coordinator.js must be aware that their changes affect the same live registry seen by all other scripts.

# SingletonModulePattern

## What It Is

The SingletonModulePattern is a structural design convention implemented within `ProcessStateManager` (PSM) that leverages Node.js's built-in module caching behavior to guarantee a single shared instance across the entire process. Rather than relying on an explicit Singleton class implementation (with private constructors, `getInstance()` methods, or instance flags), this pattern delegates the uniqueness guarantee to the CommonJS module loader itself. When `api-service.js`, `dashboard-service.js`, and `health-coordinator.js` each `require()` the ProcessStateManager module, Node.js caches the result of the first `require()` call and returns that exact same exported object to every subsequent importer.

The pattern is foundational to how the three consumer scripts coordinate state. It eliminates the need for any wiring code that would otherwise need to pass a PSM reference between modules. The module system effectively becomes the dependency-injection container — implicit, zero-configuration, and process-wide.

## Architecture and Design

The architectural approach embodies a **Module-Level Singleton** pattern, which is idiomatic to Node.js and distinct from classical OOP Singleton implementations. The design centers on a single shared registry exposed by ProcessStateManager and consumed by exactly three callers: `api-service.js`, `dashboard-service.js`, and `health-coordinator.js`. Because all three consumers operate on the identical in-memory object, mutations made by one consumer are immediately visible to the others without any message-passing, observer registration, or synchronization plumbing.

This sits naturally above the sibling component `ServiceRegistry`, which is the actual data structure (a service-name-to-process-handle map) populated through `psm.registerService()` calls. The SingletonModulePattern ensures that when `api-service.js` and `dashboard-service.js` register their spawned child processes into ServiceRegistry, the entries are inserted into the *same* map instance that `health-coordinator.js` later iterates. The pattern and the registry are therefore complementary: the registry defines *what* is shared, and the singleton pattern defines *how* sharing is enforced.

The interaction model is intentionally implicit. There is no factory, no service locator, and no `getInstance()` call. The coupling mechanism is the `require()` statement itself. This design philosophy treats the module graph as the architectural source of truth — if two files import the same module path, they are guaranteed to share state.

## Implementation Details

The technical mechanics rest entirely on Node.js's module cache. When `api-service.js` executes `const psm = require('./ProcessStateManager')`, Node.js resolves the path, executes the module's top-level code exactly once, and stores the resulting `module.exports` object in its internal cache keyed by the resolved absolute path. Subsequent `require()` calls from `dashboard-service.js` and `health-coordinator.js` bypass module re-execution and return the cached export directly.

No constructor arguments are accepted, and no dependency-injection container is involved. Each consumer script simply imports ProcessStateManager and immediately receives the shared instance. Concretely:

- `api-service.js` calls `psm.registerService()` after spawning its child process, inserting an entry into the shared ServiceRegistry map.
- `dashboard-service.js` performs the same registration step for its own spawned child process.
- `health-coordinator.js` later iterates the registry to inspect every registered service handle.

Because all three scripts hold references to the same PSM object, the registry seen by `health-coordinator.js` reflects in real time every insertion performed by `api-service.js` and `dashboard-service.js`. There is no serialization boundary and no eventual-consistency window — state changes are synchronously observable across all consumers.

## Integration Points

The pattern integrates with the broader system through three explicit consumers and one parent abstraction. The parent component, ProcessStateManager, is the entity actually subjected to module caching; the SingletonModulePattern describes the *behavior* that emerges from how ProcessStateManager is loaded. The sibling component, ServiceRegistry, is the concrete map structure that benefits from the singleton guarantee — it must be a single shared instance for cross-script visibility to function correctly.

The three consumer scripts form the integration surface:

- **`api-service.js`** — wrapper script that spawns its child process and calls `psm.registerService()` to publish its service handle.
- **`dashboard-service.js`** — parallel wrapper script following the same registration protocol.
- **`health-coordinator.js`** — read-side consumer that iterates the registry to perform health checks across all registered services.

There are no external dependencies or interfaces beyond Node.js's native `require()` mechanism. The integration contract is therefore extremely thin: any new consumer wishing to participate need only `require()` ProcessStateManager and call the appropriate registration or query methods.

## Usage Guidelines

Developers working with any of the three consumer scripts (`api-service.js`, `dashboard-service.js`, `health-coordinator.js`) must internalize that modifications to PSM state are globally visible. A change made to the registry in one script is immediately observable in the other two. This shared-mutable-state model is the explicit trade-off the design accepts: simplicity and zero wiring overhead are gained at the cost of implicit coupling.

The pattern explicitly sacrifices **testability via dependency injection**. Because the registry is acquired through `require()` rather than passed as a constructor argument, there is no clean seam to inject a mock registry during unit testing. Tests that need to isolate behavior must either manipulate Node.js's module cache directly (e.g., `delete require.cache[...]`) or use module-mocking libraries. This trade-off is deemed acceptable given the small, fixed three-consumer topology — if the consumer count were to grow significantly or if isolated testing became a priority, migrating to explicit dependency injection would be the appropriate refactor.

Additional conventions to follow:

1. **Never instantiate ProcessStateManager manually.** The module export *is* the instance; treating it as a class to be `new`-ed defeats the singleton guarantee.
2. **Always use the canonical import path.** Different resolved paths (e.g., via symlinks or differing relative paths) can produce distinct cache entries and thus distinct instances. Consistency in `require()` paths is essential.
3. **Be aware of registration timing.** Since `api-service.js` and `dashboard-service.js` call `psm.registerService()` immediately after spawning their child processes, any consumer reading the registry before those calls complete will see an incomplete view. `health-coordinator.js` and any future readers must account for this initialization ordering.
4. **Treat the registry as a shared resource.** Avoid destructive mutations (such as clearing the registry) unless the operation is intentional and coordinated across all three consumers.


## Hierarchy Context

### Parent
- [ProcessStateManager](./ProcessStateManager.md) -- PSM is a singleton, meaning all wrapper scripts (api-service.js, dashboard-service.js) and health-coordinator.js share a single registry instance without passing references explicitly

### Siblings
- [ServiceRegistry](./ServiceRegistry.md) -- api-service.js and dashboard-service.js each call psm.registerService() immediately after spawning their child processes, inserting a service-name-to-process-handle entry into this shared map so downstream consumers have an up-to-date view.


---

*Generated from 3 observations*
