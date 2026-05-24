# RetryPolicy

**Type:** Detail

Because lib/service-starter.js is explicitly isolated from SIGTERM/SIGINT handling (those signals are owned by api-service.js and dashboard-service.js), RetryPolicy can evaluate failure conditions purely based on process exit codes or health state rather than signal-driven termination, simplifying its decision logic.

# RetryPolicy — Technical Insight Document

## What It Is

RetryPolicy is a decision component implemented in `lib/service-starter.js`, co-located with its sibling `ServiceLaunchInvoker` inside the `ServiceStarter` module. It functions as the gating logic that is consulted after each failed launch attempt to determine whether another restart should be initiated. In effect, it acts as the conditional checkpoint of the restart loop: failed attempts flow into RetryPolicy, and only with its approval does control pass back to `ServiceLaunchInvoker` for the next attempt.

The policy is described as a `Detail`-level component — a focused piece of orchestration logic rather than a standalone service. It exposes configurable knobs (retry count and interval), making it the primary tuning surface for controlling how aggressively the starter retries a failing process. Because it lives inside `ServiceStarter`, it inherits the starter's posture of being an orchestration layer rather than a direct process host.

## Architecture and Design

The architectural pattern at play is a classic **Policy-Invoker pairing** within an orchestration loop. RetryPolicy embodies the *policy* (the "should we?" decision), while its sibling `ServiceLaunchInvoker` embodies the *mechanism* (the "how do we?" action of process spawning, which it delegates to the wrapper scripts `api-service.js` and `dashboard-service.js`). The two components are tightly coupled within the restart loop but cleanly separated in responsibility — a deliberate separation-of-concerns choice that keeps tuning logic isolated from execution logic.

A key design decision visible in the observations is the **signal-handling isolation boundary**. `lib/service-starter.js` is explicitly isolated from SIGTERM/SIGINT handling; those signals are owned by the wrapper scripts (`api-service.js` and `dashboard-service.js`) at the parent level. This boundary directly shapes RetryPolicy's design: because it never sees signal-driven termination, its decision surface can remain narrow, evaluating failure conditions purely from process exit codes or health state. This avoids the considerable complexity of distinguishing a user-initiated graceful shutdown from a crash that warrants a retry.

RetryPolicy is positioned as a **configurable strategy object**. Its parameters (retry count and interval) are either constructor-injected or sourced from environment/config, which keeps the tuning surface external to the launch mechanism itself. Operators can adjust restart aggressiveness without modifying `ServiceLaunchInvoker` or the wrapper scripts — a clean change-isolation pattern.

## Implementation Details

RetryPolicy resides inside `lib/service-starter.js` alongside `ServiceLaunchInvoker`. The two collaborate via the restart loop: after each launch attempt that ends in failure, the loop consults RetryPolicy with the current failure state. RetryPolicy evaluates two configurable parameters — a maximum retry count and an interval between attempts — and returns a decision (proceed or abort) plus, implicitly, any delay that must be observed before the next attempt.

Because signal handling is owned by `api-service.js` and `dashboard-service.js` rather than by the starter, RetryPolicy's input domain is constrained to non-signal failure signals: process exit codes and health-state indicators. This simplification means RetryPolicy does not need to branch on signal type, distinguish operator-driven shutdowns, or implement signal-propagation logic. Its decision logic stays compact and focused on quantitative failure tracking (counts) and temporal pacing (intervals).

Configuration injection makes RetryPolicy the system's tuning knob. Whether parameters are passed at construction time within `ServiceStarter` or pulled from environment variables, the result is the same: changing retry aggressiveness is a configuration concern, not a code change. This is consistent with the broader `ServiceStarter` design philosophy of being an orchestration layer that composes smaller, focused subcomponents.

## Integration Points

RetryPolicy's most immediate integration is with its sibling `ServiceLaunchInvoker` — both live in `lib/service-starter.js` and together form the restart loop. RetryPolicy is invoked after each failed attempt by `ServiceLaunchInvoker`; if RetryPolicy approves continuation, `ServiceLaunchInvoker` is re-entered to spawn another process. This tight in-file coupling reflects their shared lifecycle within the orchestration loop.

Indirectly, RetryPolicy integrates with the wrapper scripts `api-service.js` and `dashboard-service.js`. These wrappers are the actual process hosts spawned by `ServiceLaunchInvoker`, and their exit codes and health signals become the inputs RetryPolicy reasons about. Crucially, because those wrappers also own SIGTERM/SIGINT handling, RetryPolicy is shielded from signal-related complexity — it sees only the downstream consequence (an exit code), not the upstream signal.

The configuration system (environment variables or constructor parameters) is the third integration surface. This is where operators and deployment tooling adjust retry count and interval to control restart behavior in different environments without touching `lib/service-starter.js` or the wrapper scripts.

## Usage Guidelines

When working with RetryPolicy, treat retry count and interval as the proper levers for adjusting restart aggressiveness. Do not embed retry logic into `ServiceLaunchInvoker` or the wrapper scripts — keeping policy concerns localized to RetryPolicy preserves the clean separation between policy and mechanism that the `ServiceStarter` design depends on.

Respect the signal-handling boundary. RetryPolicy is intentionally unaware of SIGTERM/SIGINT because `api-service.js` and `dashboard-service.js` handle those signals at the wrapper level. Avoid extending RetryPolicy to interpret signals directly; if a failure mode needs to be distinguished, surface it through an exit code or health state, which are RetryPolicy's natural inputs.

When tuning, consider the operational context: a high retry count with a short interval suits transient failures (e.g., dependency warm-up races), while a lower count with longer intervals avoids hot-looping on deterministic failures (e.g., bad configuration). Because RetryPolicy is the sole gate before `ServiceLaunchInvoker` re-runs, misconfiguration here directly translates into either insufficient resilience or runaway restart loops.

---

### Synthesis: Patterns, Trade-offs, Structure, Scalability, Maintainability

**Architectural patterns identified.** Policy/Mechanism separation between RetryPolicy and `ServiceLaunchInvoker`; orchestrator composition within `ServiceStarter`; configurable strategy via injected parameters; layered responsibility with signal handling pushed outward to the wrapper scripts.

**Design decisions and trade-offs.** The decision to isolate signals at the wrapper layer simplifies RetryPolicy at the cost of requiring discipline — failure modes must be encoded as exit codes or health state to be visible to the policy. Making retry count and interval configurable trades a small amount of indirection for substantial operational flexibility.

**System structure insights.** `lib/service-starter.js` is a focused orchestration module hosting both RetryPolicy and `ServiceLaunchInvoker`. The wrapper scripts (`api-service.js`, `dashboard-service.js`) sit one layer outward, owning process hosting and signal lifecycle. This produces a clean three-tier picture: wrappers (process + signals) → starter (orchestration: invoke + policy) → policy (decision).

**Scalability considerations.** RetryPolicy is per-process orchestration logic; it does not coordinate across multiple service instances. Its scalability is bounded by the appropriateness of its retry count/interval configuration — runaway loops are the primary risk vector, mitigated by setting a finite retry ceiling.

**Maintainability assessment.** High. The component is small, has a single responsibility, lives in one file with its closest collaborator, has a narrow input surface (exit codes / health state), and exposes its tuning via configuration rather than code. The explicit signal-handling boundary further reduces the cognitive surface area a maintainer must reason about.


## Hierarchy Context

### Parent
- [ServiceStarter](./ServiceStarter.md) -- lib/service-starter.js is explicitly isolated from SIGTERM/SIGINT handling — signal propagation is owned by the wrapper scripts (api-service.js, dashboard-service.js), not by the starter

### Siblings
- [ServiceLaunchInvoker](./ServiceLaunchInvoker.md) -- ServiceLaunchInvoker resides in lib/service-starter.js and delegates actual process creation to the wrapper scripts api-service.js and dashboard-service.js, keeping the starter itself as an orchestration layer rather than a direct process host.


---

*Generated from 3 observations*
