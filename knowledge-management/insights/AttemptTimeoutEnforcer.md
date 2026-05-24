# AttemptTimeoutEnforcer

**Type:** Detail

Identified through parent component analysis as residing in lib/service-starter.js alongside startServiceWithRetry(), the enforcer operates at per-attempt granularity rather than imposing a single global deadline, which allows the retry loop in RetryPolicy to remain responsive after each timed-out attempt.

# AttemptTimeoutEnforcer

## What It Is

The `AttemptTimeoutEnforcer` is a detail-level component implemented within `lib/service-starter.js`, residing alongside the `startServiceWithRetry()` function that serves as its parent context. It is the mechanism responsible for converting open-ended, potentially blocking service spawn operations into bounded, finite operations that either complete successfully within a defined window or fail in a way that is recoverable by the surrounding retry machinery.

Operationally, the enforcer applies its timeout at **per-attempt granularity** rather than wrapping the entire retry sequence in a single global deadline. This means each invocation of the underlying spawn logic receives its own independent time budget, and exceeding that budget produces a timed-out failure that the retry loop can observe and react to. This design choice is deliberate: it preserves the responsiveness of the retry loop in its sibling component, `RetryPolicy`, allowing subsequent attempts to be scheduled normally after any one attempt hangs.

As a Detail-type entity within the `ServiceStarter` parent component, the enforcer is not a standalone service or exported API — it is an internal enforcement mechanism that makes the fault-tolerance guarantees advertised by `startServiceWithRetry()` actually achievable.

## Architecture and Design

The architectural approach embodied by `AttemptTimeoutEnforcer` is a classic **promise/operation racing pattern**. Because `lib/service-starter.js` is the single entry point for all service launches, the timeout enforcement must be generic enough to wrap any spawned service. The implementation therefore wraps the spawn promise or child-process handle with a racing timer, rather than relying on service-specific signals or instrumentation inside each launched service. This generic approach is essential: the enforcer cannot assume anything about the internal behavior of the services it bounds.

The design decision to enforce timeouts per-attempt rather than globally has significant architectural consequences. A global deadline would conflate two distinct failure modes — a service that hangs once but could succeed on retry, versus a service that is fundamentally unavailable for the entire retry window. By bounding only the individual attempt, the enforcer cleanly separates the concern of "this spawn took too long" from the concern of "we've exhausted our retries," which is `RetryPolicy`'s responsibility. The two sibling components thus form a layered fault-tolerance pipeline: `AttemptTimeoutEnforcer` converts hangs into failures, and `RetryPolicy` decides what to do about repeated failures.

This separation also exemplifies a broader architectural principle visible in the `ServiceStarter` parent: rather than duplicating timeout and retry logic across individual service call sites, both concerns are centralized in `lib/service-starter.js`. The enforcer is one half of the centralized policy, and its design must be intentionally generic to support the "any service" contract of `startServiceWithRetry()`.

## Implementation Details

The enforcer's core mechanic is to take an open-ended blocking spawn operation and impose a finite upper bound on its execution time. Implementation-wise, this is consistent with racing the spawn promise (or a promise wrapping the child-process handle) against a timer promise — whichever settles first determines the outcome of the attempt. If the spawn completes first, the attempt is treated as successful (or as having failed for spawn-specific reasons); if the timer fires first, the attempt is rejected as a timed-out failure that surfaces to the retry loop.

A subtle but important implementation requirement is that the enforcer must be **service-agnostic**. Because `lib/service-starter.js` is the single entry point for launches across the codebase, the enforcer cannot inspect service-specific protocols, health-check endpoints, or readiness signals to determine timeout behavior. It must operate purely on the lifecycle of the spawn primitive itself — typically the promise returned by, or the handle representing, the underlying child-process invocation.

The enforcer is the mechanism that fulfills the fault-tolerance guarantee of `startServiceWithRetry()`. Without it, a single hung spawn could block the entire retry loop indefinitely, defeating the purpose of having retries at all. The enforcer ensures that every attempt either succeeds, fails with a service-specific error, or fails with a timeout — and in all three cases, control returns promptly to the surrounding logic so that `RetryPolicy` can make its next decision.

No specific code symbols were extracted for this component, indicating that `AttemptTimeoutEnforcer` is likely an inline concern within `startServiceWithRetry()` rather than a separately named function or class. This is consistent with its role as a Detail-level implementation aspect of its parent rather than a publicly exposed abstraction.

## Integration Points

The enforcer's primary integration is with its parent component `ServiceStarter` — specifically the `startServiceWithRetry()` function in `lib/service-starter.js`. It is invoked on each attempt within that function's retry loop, wrapping the spawn operation that the attempt performs. Its output (success, error, or timeout rejection) feeds directly into the decision-making logic of its sibling `RetryPolicy`, which uses the outcome to determine whether to schedule another attempt or surface the failure to the caller.

On the downstream side, the enforcer interfaces with whatever spawn primitive `startServiceWithRetry()` uses — likely a Node.js child-process API or a promise-based wrapper around one. The enforcer must be compatible with this primitive's cancellation or abandonment semantics: when a timeout fires, the in-flight spawn may need to be cleaned up to avoid leaking child processes or pending handles.

Upstream, every consumer of `startServiceWithRetry()` — that is, every caller in the codebase that launches a service — implicitly depends on the enforcer's behavior, even though they never reference it directly. The fault-tolerance contract they rely on is only as strong as the enforcer's ability to bound each attempt.

## Usage Guidelines

Developers working with or modifying `AttemptTimeoutEnforcer` should observe several conventions. First, the **per-attempt granularity** of the timeout is a deliberate architectural choice and should not be replaced with a global deadline; doing so would conflate independent failure modes and undermine the responsiveness of the retry loop coordinated by `RetryPolicy`. Second, the enforcer must remain **service-agnostic** — any temptation to add service-specific timeout logic should instead be implemented at the service-specific call site or in a configuration parameter passed through `startServiceWithRetry()`, preserving the generic contract.

When tuning timeout values, consider that the effective worst-case latency for a fully-retried launch is approximately the per-attempt timeout multiplied by the maximum retry count (plus any backoff delays imposed by `RetryPolicy`). Setting per-attempt timeouts too low can cause healthy-but-slow services to be erroneously failed and retried; setting them too high can mean a hung service takes a long time to surface as a final failure.

Because the enforcer lives in `lib/service-starter.js` — the single entry point for service launches — any changes to its behavior have system-wide impact. New service types should be onboarded through `startServiceWithRetry()` rather than bypassing it, ensuring they automatically benefit from the enforcer's bounding guarantee rather than reinventing timeout handling locally.

---

## Architectural Patterns Identified

- **Promise racing / operation timeout pattern**: wrapping an open-ended async operation with a racing timer to impose finite bounds.
- **Centralized cross-cutting concern**: timeout enforcement is implemented once in `lib/service-starter.js` rather than duplicated across call sites, paralleling the centralization of `RetryPolicy`.
- **Layered fault tolerance**: `AttemptTimeoutEnforcer` (bounding) and `RetryPolicy` (recovery) compose as orthogonal mechanisms within `ServiceStarter`.
- **Generic wrapper**: service-agnostic design that operates on spawn primitives rather than service-specific protocols.

## Design Decisions and Trade-offs

- **Per-attempt vs. global timeout**: Chose per-attempt to preserve retry-loop responsiveness, accepting that total worst-case latency scales with retry count.
- **Generic vs. service-specific enforcement**: Chose generic wrapping of the spawn primitive, trading the ability to use service-aware readiness signals for the simplicity of supporting any service through one entry point.
- **Inline implementation vs. exported abstraction**: The enforcer appears to be an internal detail of `startServiceWithRetry()` rather than a named, exported construct — favoring cohesion within `ServiceStarter` over reusability outside it.

## System Structure Insights

`lib/service-starter.js` acts as a chokepoint for service-launch concerns, with `AttemptTimeoutEnforcer` and `RetryPolicy` cooperating as the two main fault-tolerance primitives inside it. Both siblings exist because their parent `ServiceStarter` declares itself the single entry point for all launches; this structural decision is what makes centralized policy enforcement possible and what makes the enforcer's generic design necessary.

## Scalability Considerations

The enforcer's per-attempt design scales predictably with the number of retries and the timeout budget per attempt. Under load, many concurrent service launches each carry their own racing timer, which is cheap in terms of resources but does mean that a system experiencing widespread service hangs will hold open many pending operations until each timer fires. Care should be taken at the spawn-primitive layer to ensure timed-out spawns are properly cleaned up to avoid handle or process leaks under stress.

## Maintainability Assessment

The component benefits from being co-located with `startServiceWithRetry()` in a single file, making the interaction between timeout enforcement and retry policy easy to reason about and modify together. Its service-agnostic, generic design minimizes coupling to specific service implementations, so adding new services does not require changes to the enforcer. The principal maintainability risk is that, as a Detail-level concern without a clearly extracted code symbol, future contributors may not recognize it as a distinct responsibility — making it valuable to keep this architectural intent documented and to consider eventually extracting it into a named helper if its logic grows.


## Hierarchy Context

### Parent
- [ServiceStarter](./ServiceStarter.md) -- lib/service-starter.js exports startServiceWithRetry(), the single entry point for launching any service with fault-tolerance, centralizing retry policy rather than duplicating it per service

### Siblings
- [RetryPolicy](./RetryPolicy.md) -- startServiceWithRetry() in lib/service-starter.js is described as the single entry point for all service launches, meaning the retry policy is implemented once here rather than duplicated across individual service call sites — a centralisation design decision explicitly stated in the sub-component description.


---

*Generated from 3 observations*
