# RegistrationAPI

**Type:** Detail

The L2 description explicitly states process-state-manager.js exposes register/unregister operations called asynchronously by wrapper scripts like api-service.js and dashboard-service.js.

# RegistrationAPI — Technical Insight Document

## What It Is

RegistrationAPI is the interface exposed by `scripts/process-state-manager.js`, specifically the `register` and `unregister` operations that constitute its public surface. It is a child concept of the parent component **ProcessStateManager**, representing the contract through which external processes announce their lifecycle state to a centralized tracking mechanism. Rather than being a standalone module, RegistrationAPI is best understood as the operational boundary of ProcessStateManager — the set of entry points other scripts use to interact with process state tracking without needing to know its internal implementation.

## Architecture and Design

The architecture reflects a **centralized registration pattern**: rather than each service independently tracking its own process lifecycle, wrapper scripts such as `api-service.js` and `dashboard-service.js` delegate this responsibility to a single authority (ProcessStateManager) via the register/unregister calls. This is a classic separation-of-concerns decision — process bookkeeping logic lives in one place, and consumers merely announce state transitions.

A key design decision evident from the observations is the **asynchronous invocation model**. Wrapper scripts call `register`/`unregister` asynchronously, implying these operations are treated as fire-and-forget (or at least non-blocking) with respect to the primary service startup/shutdown flow. This trade-off favors service responsiveness and startup speed over strict synchronization guarantees — a service can proceed with its own startup sequence without waiting for registration to fully complete or be acknowledged.

## Implementation Details

The concrete implementation resides in `scripts/process-state-manager.js`, which exposes `register` and `unregister` as its primary operations. No additional internal classes or symbols were identified in the current observations, suggesting the API surface is intentionally narrow — likely a thin functional interface rather than a class hierarchy. The calling convention is asynchronous, meaning consumers (wrapper scripts) invoke these functions without blocking their own execution threads on the outcome, consistent with typical non-critical bookkeeping operations in service lifecycle management.

## Integration Points

RegistrationAPI's primary integration points are its callers: `api-service.js` and `dashboard-service.js`. These wrapper scripts act purely as **consumers** of the API — they do not implement their own process tracking logic, reinforcing that ProcessStateManager (and by extension, RegistrationAPI) is the single source of truth for process state across these services. This establishes a dependency direction: wrapper scripts depend on ProcessStateManager's register/unregister contract, but ProcessStateManager itself has no reciprocal dependency on the specifics of any individual wrapper script's internals.

## Usage Guidelines

Developers integrating new services into this ecosystem should follow the established pattern demonstrated by `api-service.js` and `dashboard-service.js`: call `register` at service startup and `unregister` at shutdown, invoking both asynchronously so they do not block the service's own lifecycle transitions. New wrapper scripts should avoid implementing parallel/duplicate process-tracking logic and instead route through ProcessStateManager's RegistrationAPI to preserve the centralized tracking model. Because the API is currently minimal (only register/unregister), any extension of its responsibilities should be done cautiously to preserve its lightweight, non-blocking contract.

---

**Summary of Insights:**
1. **Architectural pattern**: Centralized registration/state-tracking authority consumed by multiple wrapper scripts.
2. **Design trade-off**: Asynchronous calls prioritize service startup/shutdown speed over strict registration confirmation.
3. **Structure**: Thin, narrow API surface (register/unregister) with no exposed internal classes — implementation details are encapsulated in ProcessStateManager.
4. **Scalability**: Centralization simplifies adding new wrapper scripts as consumers without duplicating tracking logic, though it may create a single point of coordination as more services are added.
5. **Maintainability**: Clear separation between API consumers and the state-tracking implementation improves maintainability, provided the async contract and minimal API surface are preserved as new integrations are added.


## Hierarchy Context

### Parent
- [ProcessStateManager](./ProcessStateManager.md) -- scripts/process-state-manager.js exposes register/unregister operations called asynchronously by wrapper scripts like api-service.js and dashboard-service.js


---

*Generated from 3 observations*
