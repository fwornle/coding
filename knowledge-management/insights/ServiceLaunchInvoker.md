# ServiceLaunchInvoker

**Type:** Detail

By design, lib/service-starter.js owns no SIGTERM/SIGINT handling; that responsibility is explicitly assigned to the wrapper scripts (api-service.js, dashboard-service.js), so ServiceLaunchInvoker can re-invoke a wrapper cleanly without signal state leaking back into the starter.

# ServiceLaunchInvoker

## What It Is

ServiceLaunchInvoker is an orchestration component implemented within `lib/service-starter.js`. It is a sub-component of the broader ServiceStarter module and is responsible for triggering the launch of services by delegating the actual process creation work to dedicated wrapper scripts—specifically `api-service.js` and `dashboard-service.js`. Rather than spawning or hosting processes directly, ServiceLaunchInvoker acts as a controlled invocation point that hands off process lifecycle responsibility to those wrappers.

Within the hierarchy of `lib/service-starter.js`, ServiceLaunchInvoker sits alongside RetryPolicy as a peer component. While RetryPolicy provides the gating logic that decides whether another attempt is warranted, ServiceLaunchInvoker is the mechanism that actually performs each attempt. Together they form the two halves of the restart loop: one decides *whether* to retry, the other executes the retry.

## Architecture and Design

The architectural approach is a clear separation between *orchestration* and *execution*. ServiceLaunchInvoker, living inside `lib/service-starter.js`, intentionally remains an orchestration layer—it does not host processes itself, does not capture process signals, and does not own any long-lived state about the running services. Instead, it defers actual process creation to the wrapper scripts `api-service.js` and `dashboard-service.js`. This delegation pattern keeps `service-starter.js` lean and focused on coordinating *when* and *how often* launches happen rather than the mechanics of the launches themselves.

A deliberate design decision is the exclusion of SIGTERM/SIGINT handling from `lib/service-starter.js`. The parent ServiceStarter has explicitly pushed signal handling out into the wrapper scripts (`api-service.js`, `dashboard-service.js`). This isolation means ServiceLaunchInvoker can re-invoke a wrapper without worrying about residual signal handlers accumulating in the starter process or signal state leaking back upstream. Each wrapper invocation is its own self-contained signal domain, and the starter remains signal-agnostic.

The invoker is also designed to be **stateless and re-entrant**, because it operates inside a restart cycle. Each launch attempt must begin from a clean slate, which means the interface between ServiceLaunchInvoker and the wrapper scripts cannot rely on residual state from a previous attempt. This re-entrancy is what allows the restart loop—coordinated with sibling RetryPolicy—to safely call ServiceLaunchInvoker repeatedly under failure conditions without compounding errors or drifting state.

## Implementation Details

The invoker is implemented as logic within `lib/service-starter.js`. Its core mechanic is to act as a thin trigger that calls into one of two wrapper scripts: `api-service.js` for the API service, and `dashboard-service.js` for the dashboard service. Each wrapper script is responsible for setting up its own environment, registering its own SIGTERM/SIGINT handlers, and managing the lifecycle of the actual service process. ServiceLaunchInvoker hands off control and then steps back.

Because the invoker may be called multiple times within a single restart cycle, its implementation avoids stashing any persistent handles, timers, or process references that would survive between invocations. Every call to ServiceLaunchInvoker is treated as an independent launch attempt. The wrapper scripts themselves enforce this clean-slate contract by owning all process-bound resources internally, so when one invocation completes (successfully or in failure), no state carries forward into the next attempt.

The pairing with the sibling RetryPolicy component (also in `lib/service-starter.js`) defines the runtime behavior. After each failed launch, control returns up through ServiceLaunchInvoker, RetryPolicy gates whether another attempt is warranted, and if so, ServiceLaunchInvoker is invoked again. This forms a tight loop where the two components are functionally distinct but operationally interlocked.

## Integration Points

ServiceLaunchInvoker integrates downward with the wrapper scripts `api-service.js` and `dashboard-service.js`. These are the only execution targets it knows about, and the interface contract requires those wrappers to handle process management, signal handling, and any service-specific bootstrap. The invoker does not need to know what those wrappers do internally—it simply triggers them.

Upward, ServiceLaunchInvoker is contained by its parent ServiceStarter, which provides the broader orchestration context. The parent enforces the architectural rule that signal handling stays out of `lib/service-starter.js`, shaping how ServiceLaunchInvoker can interact with its wrappers. Laterally, ServiceLaunchInvoker is tightly coupled with its sibling RetryPolicy: every invocation cycle alternates between RetryPolicy's gating decision and ServiceLaunchInvoker's launch execution. Although the two are separate components, they cannot function independently within the restart loop.

There are no direct integrations with external systems evident from the observations—the entity's surface is bounded by the wrapper scripts on one side and the in-module RetryPolicy on the other.

## Usage Guidelines

Developers working with ServiceLaunchInvoker should respect its role as an **orchestrator, not a process host**. Any logic related to spawning processes, managing their stdio, or handling signals belongs in the wrapper scripts (`api-service.js`, `dashboard-service.js`), not in `lib/service-starter.js`. Adding signal handlers to the starter would violate the explicit isolation that makes re-invocation safe.

Because ServiceLaunchInvoker is called repeatedly inside a restart cycle, all interactions with it must be **stateless and re-entrant**. Do not introduce module-level state, cached process references, or persistent listeners inside the invoker that would survive across launch attempts. Each call must start from a clean slate; otherwise, retries can produce inconsistent or compounding behavior.

When extending the system to support new services, the established pattern is to add a new wrapper script (analogous to `api-service.js` or `dashboard-service.js`) that owns its own SIGTERM/SIGINT handling and process lifecycle. ServiceLaunchInvoker should then delegate to that new wrapper using the same stateless contract. Do not bypass the wrapper layer and have ServiceLaunchInvoker spawn processes directly—this would collapse the orchestration/execution separation that the design depends on.

Finally, any changes to retry semantics should be coordinated with the sibling RetryPolicy rather than embedded into ServiceLaunchInvoker. The invoker should remain focused on "perform one launch attempt against a wrapper," while RetryPolicy retains ownership of "should we attempt again." Maintaining this division keeps both components small, testable, and aligned with the parent ServiceStarter's design intent.

---

### Architectural Patterns Identified
- **Delegation / Orchestration–Execution Separation**: ServiceLaunchInvoker orchestrates; wrapper scripts execute.
- **Stateless Re-entrant Invocation**: Each call is independent, enabling safe repetition within a restart loop.
- **Responsibility Isolation for Signal Handling**: Signal management is pushed entirely into wrapper scripts.

### Design Decisions and Trade-offs
- **Decision**: Keep signal handling out of `lib/service-starter.js`. **Trade-off**: Gains clean re-invocation semantics; requires each wrapper to independently implement signal handling, introducing some duplication.
- **Decision**: Use wrapper scripts as the execution boundary. **Trade-off**: Adds an extra indirection layer, but enables a small, focused starter module.
- **Decision**: Pair tightly with sibling RetryPolicy. **Trade-off**: Coupling is high within the module, but the two components remain conceptually clear and easy to reason about together.

### System Structure Insights
The system structure under ServiceStarter is two-tiered: a coordination tier (ServiceLaunchInvoker + RetryPolicy in `lib/service-starter.js`) and an execution tier (`api-service.js`, `dashboard-service.js`). This is a clean vertical split where coordination logic stays uniform while execution logic is per-service.

### Scalability Considerations
Scaling to additional services is achieved by adding new wrapper scripts that follow the same contract as `api-service.js` and `dashboard-service.js`. Because ServiceLaunchInvoker is stateless, adding more launch targets does not increase its own complexity—only the set of wrappers grows. Concurrent or parallel service launches would require careful consideration since the current design (driven by RetryPolicy gating) appears sequential within a restart cycle.

### Maintainability Assessment
Maintainability is favorable. The deliberate separation of concerns—orchestration in the starter, execution in the wrappers, gating in RetryPolicy—creates small, focused units. The stateless, re-entrant contract reduces the surface area for subtle bugs across retry attempts. The main maintenance risk is drift between wrapper scripts: since each owns its own signal handling, inconsistencies between `api-service.js` and `dashboard-service.js` could emerge over time and would need to be guarded against via convention or shared utility code.


## Hierarchy Context

### Parent
- [ServiceStarter](./ServiceStarter.md) -- lib/service-starter.js is explicitly isolated from SIGTERM/SIGINT handling — signal propagation is owned by the wrapper scripts (api-service.js, dashboard-service.js), not by the starter

### Siblings
- [RetryPolicy](./RetryPolicy.md) -- RetryPolicy lives in lib/service-starter.js and is the gating logic consulted after each failed launch attempt before ServiceLaunchInvoker is invoked again, making the two tightly coupled within the restart loop.


---

*Generated from 3 observations*
