# ServerAvailabilityPrecheck

**Type:** Detail

The guard treats VkbApiClient as entirely optional at the module level — if the server check fails, the import is skipped entirely rather than caught after a failed instantiation, avoiding partial initialization side effects.

# ServerAvailabilityPrecheck

## What It Is

`ServerAvailabilityPrecheck` is a guard mechanism that performs an explicit availability probe via `isServerAvailable()` before any attempt is made to dynamically import the `VkbApiClient` module. It sits as a child concern within `AvailabilityGuardPatterns`, codifying the precise sequencing contract that availability confirmation must complete successfully before module resolution is permitted to proceed.

Functionally, it is the decision gate that determines whether the optional `VkbApiClient` dependency is ever brought into the runtime at all. Rather than being a passive check, it is an active prerequisite: the result of `isServerAvailable()` directly controls whether the subsequent dynamic import statement is reached. When the check fails, the import is bypassed entirely — the client module's code is never fetched, never parsed, and never executed.

This precheck is one of two complementary mechanisms under `AvailabilityGuardPatterns`. Its sibling, `VkbApiClientDeferredImport`, handles the inverse side of the same contract: the dynamic-import mechanics that deliberately defer module evaluation so that this precheck has meaningful authority to prevent loading. Together, they form a coordinated availability-then-load sequence.

## Architecture and Design

The architectural pattern at work is a **fail-fast guard at the dependency-loading boundary**. Rather than allowing the system to attempt instantiation of `VkbApiClient` and then handle a failure downstream (via try/catch around constructor calls or method invocations), the design pushes the failure decision upstream to the network probe. This means a single, cheap network check governs an entire module's lifecycle, including its load, parse, and initialization phases.

This represents a deliberate trade-off favored by the parent `AvailabilityGuardPatterns` design philosophy: the cost of a failed network probe is preferred over the cost of loading, parsing, and initializing a client module that cannot function. The probe is bounded and predictable; module initialization side effects are not. By gating at the import boundary, the design avoids any possibility of partial initialization — there is no half-constructed client, no registered listeners, no allocated resources to roll back.

The interaction model is sequential and strict. The guard does not race the availability check against the import, nor does it speculatively prefetch the module. The contract is linear: `isServerAvailable()` resolves first, and only on success does the dynamic `import()` of `VkbApiClient` execute. This linear ordering is the explicit sequencing contract referenced in the design, and it is what makes the sibling `VkbApiClientDeferredImport` pattern viable — without deferred importing, this precheck would have no module loading to guard.

## Implementation Details

The implementation centers on a single function call — `isServerAvailable()` — placed explicitly ahead of the dynamic `import()` expression that resolves `VkbApiClient`. The pattern is invocation-order based rather than declarative: there is no decorator, no registry, no middleware. The guard's effectiveness derives entirely from its lexical placement in the control flow.

When `isServerAvailable()` returns a falsy/failed result, the conditional flow short-circuits and the dynamic import statement is never reached. This is the key mechanic that distinguishes this approach from a try/catch wrapper around `new VkbApiClient(...)`: by the time a constructor failure could be caught, the module's top-level code has already executed, and any module-level side effects (singleton initialization, side-effecting imports, polyfill installation) would have occurred. The precheck design avoids this by ensuring the import itself is conditional.

The complementary mechanism in `VkbApiClientDeferredImport` is what makes this precheck meaningful in practice. Because `VkbApiClient` is loaded via `import()` (the dynamic, promise-returning form) rather than a static `import` declaration at the top of the file, the module's evaluation can be conditionally skipped. A static import would defeat the entire pattern, since the module would load regardless of any runtime check.

## Integration Points

The primary integration surface is the `isServerAvailable()` function itself, which serves as the boolean <COMPANY_NAME_REDACTED> for the guard. The precheck depends on this function being reliable, reasonably fast, and accurately representative of the backing server's reachability. Any latency or false-negative behavior in `isServerAvailable()` propagates directly into the load decision for `VkbApiClient`.

The downstream integration is the dynamic `import('...VkbApiClient...')` expression, which the precheck either enables or suppresses. This coupling is intentional and tight: the precheck only protects this one import site, and any other code paths that might load `VkbApiClient` would need to apply the same guard pattern to maintain the contract.

Within the broader `AvailabilityGuardPatterns` family, this precheck pairs with `VkbApiClientDeferredImport` as two halves of the same design: one provides the deferral capability (making the import skippable), and the other provides the decision logic (determining when to skip). Neither is fully effective without the other.

## Usage Guidelines

Developers extending or modifying this area should preserve the strict invocation ordering: `isServerAvailable()` must complete and resolve favorably before any reference to `VkbApiClient`'s module is reached. Reordering these calls, or converting the dynamic `import()` to a static `import` declaration, would silently break the optionality guarantee and reintroduce the partial-initialization risks the pattern was designed to avoid.

When introducing additional optional clients with similar reachability constraints, follow the same two-part structure exemplified by `ServerAvailabilityPrecheck` and its sibling `VkbApiClientDeferredImport`: gate the dynamic import behind an explicit availability check, and never assume that catching a constructor exception is equivalent to never loading the module. The two have fundamentally different side-effect profiles.

Avoid the temptation to cache or short-circuit the availability check in ways that could allow stale "available" results to permit an import after the server has become unreachable — or vice versa. The fail-fast guarantee depends on `isServerAvailable()` reflecting current reality at the moment of the import decision. If caching is introduced, its TTL and invalidation semantics become part of the guard's correctness contract.

Finally, treat the precheck as the single authoritative load gate for `VkbApiClient`. Any new code path that needs the client should route through this same guard pattern rather than introducing parallel import sites, ensuring the `AvailabilityGuardPatterns` contract remains consistent across the codebase.


## Hierarchy Context

### Parent
- [AvailabilityGuardPatterns](./AvailabilityGuardPatterns.md) -- isServerAvailable() is called before dynamic imports of VkbApiClient, ensuring the optional external API client is never loaded if its backing server cannot be reached.

### Siblings
- [VkbApiClientDeferredImport](./VkbApiClientDeferredImport.md) -- By placing VkbApiClient behind a dynamic import guarded by isServerAvailable(), the sub-component ensures the external API client's module code is never evaluated in environments or conditions where its backing server is absent.


---

*Generated from 3 observations*
