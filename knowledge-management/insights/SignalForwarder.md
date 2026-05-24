# SignalForwarder

**Type:** Detail

scripts/dashboard-service.js wires signal handlers as part of its startup sequence (described as 'wire signals' in the structural pattern shared with api-service.js), meaning signal forwarding is set up immediately after the child process is spawned.

# SignalForwarder

## What It Is

SignalForwarder is the signal-handling concern implemented within `scripts/dashboard-service.js`, where it is wired into the service startup sequence immediately after the child process is spawned. As a constituent of the parent `DashboardWrapper`, it serves as the bridge that propagates POSIX signals from the wrapper process to the child process it supervises. The forwarder specifically handles `SIGTERM` and `SIGINT`, ensuring that termination intent originating outside the Node.js wrapper reaches the actual workload process.

This component is not implemented as a standalone module or exported class — rather, it is a structural concern realized through signal handler registration in the wrapper script. The same signal-forwarding pattern is mirrored exactly in `api-service.js`, indicating that SignalForwarder represents a shared convention applied uniformly across the project's Dockerized service wrappers.

## Architecture and Design

The architectural approach centers on a thin supervisor pattern: `DashboardWrapper` spawns a child process via `child_process` and then immediately establishes signal forwarders so that any termination signal delivered to the wrapper is transparently relayed to the child. This sequencing — spawn first, wire signals second — is deliberate and matches the canonical structure shared with `api-service.js` (`spawn → registerService → wire signals → unregisterService on exit`).

By choosing to forward both `SIGTERM` and `SIGINT`, the design accommodates two distinct termination pathways. `SIGTERM` is the signal Docker issues during orderly container stops (e.g., `docker stop`, Kubernetes pod termination), while `SIGINT` arises during interactive terminal use when a developer presses Ctrl+C. Supporting both signals on the wrapper means SignalForwarder presents a uniform shutdown contract regardless of how the service is being run.

A key architectural insight is the implicit coupling between SignalForwarder and its sibling `PSMRegistrationLifecycle`. Rather than requiring explicit orchestration code, the two concerns coordinate through child-process termination: when a forwarded signal causes the child to exit, the wrapper's exit handler invokes `unregisterService`. This decoupling — forwarding signals on one side, reacting to child exit on the other — keeps each concern focused and prevents the wrapper from needing a centralized shutdown coordinator.

## Implementation Details

SignalForwarder is realized in `scripts/dashboard-service.js` as part of the startup sequence described structurally as "wire signals." Concretely, the wrapper registers process-level handlers for `SIGTERM` and `SIGINT` immediately after spawning the child process. When either signal is received by the wrapper, the handler forwards the same signal to the spawned child, allowing the child to perform its own shutdown logic.

The mechanics rely on Node.js's built-in `process` event emitter and the `ChildProcess` instance returned by `child_process.spawn`. There is no abstraction layer, no custom class, and no exported symbol — SignalForwarder exists as a recognized pattern in the script rather than as a discoverable code entity (the code-structure analysis reports zero symbols associated with it). Its implementation is intentionally minimal, which is precisely why it is replicated verbatim in `api-service.js`.

Because the wrapper does not catch or transform the signal, the child receives an authentic `SIGTERM` or `SIGINT` and can apply its own graceful shutdown semantics. The wrapper's only responsibility is propagation; it does not attempt to enforce timeouts, escalate to `SIGKILL`, or otherwise modify shutdown behavior at this layer.

## Integration Points

SignalForwarder integrates with three principal touchpoints. First, it depends on the child-process handle produced by `DashboardWrapper`'s spawn step — without that handle, there is nothing to forward signals to. Second, it integrates with the Node.js runtime's process-level signal handling, hooking into the global `process` object to receive `SIGTERM` and `SIGINT`.

Third, and most importantly, SignalForwarder participates in an implicit contract with its sibling `PSMRegistrationLifecycle`. When forwarded signals cause the child to terminate, the wrapper's exit path invokes `unregisterService`, completing the PSM lifecycle. This means SignalForwarder is effectively the trigger mechanism for orderly PSM deregistration in response to external shutdown signals, even though it never calls `unregisterService` directly.

At the deployment boundary, SignalForwarder integrates with Docker (and any other process supervisor) by honoring the standard POSIX termination contract. Containers signaling the wrapper PID 1 will see those signals reach the actual workload, avoiding the common Dockerized-Node.js pitfall where a parent process swallows signals and leaves the child to be killed only after the grace period expires.

## Usage Guidelines

Developers extending or modifying `scripts/dashboard-service.js` should preserve the established ordering: spawn the child, register the service (PSM), wire signals, and rely on the exit handler to call `unregisterService`. Reordering these steps — for example, wiring signals before spawning — would break the invariant that a forwarded signal always has a valid child target.

When adding new Dockerized service wrappers to the project, follow the same pattern used in both `dashboard-service.js` and `api-service.js`. Both `SIGTERM` and `SIGINT` should be forwarded; omitting `SIGINT` would degrade the developer experience for local runs, while omitting `SIGTERM` would prevent clean container shutdowns. The symmetry between wrappers is itself a maintainability asset and should be preserved rather than refactored away prematurely.

Avoid layering additional logic into the signal handlers themselves. Concerns such as PSM deregistration belong in the child-exit path, not in the signal handler, because doing so preserves the clean separation between SignalForwarder and `PSMRegistrationLifecycle`. If shutdown coordination ever needs to become more elaborate (e.g., forced-kill escalation, draining), introduce a dedicated coordinator rather than expanding the handler in place — this keeps the forwarder's role narrow and predictable.

---

## Synthesis

**1. Architectural patterns identified:** Supervisor/wrapper pattern with transparent signal proxying; shared structural template across sibling wrappers (`dashboard-service.js` and `api-service.js`); implicit coordination via process-exit events rather than direct invocation between concerns.

**2. Design decisions and trade-offs:** Forwarding signals unmodified trades fine-grained shutdown control for simplicity and child-process autonomy. Coupling SignalForwarder to `PSMRegistrationLifecycle` through exit handlers (not direct calls) trades discoverability for separation of concerns — a developer reading the signal handler will not immediately see the PSM consequence.

**3. System structure insights:** SignalForwarder is one of two sibling concerns under `DashboardWrapper`, alongside `PSMRegistrationLifecycle`. The fact that both concerns are duplicated identically in `api-service.js` suggests an opportunity for extraction into a shared utility, though the current duplication keeps each wrapper self-contained and easy to reason about in isolation.

**4. Scalability considerations:** Signal forwarding itself is O(1) per signal and has no scalability concerns. The broader pattern scales linearly with the number of Dockerized services in the project — each new service requires its own wrapper with the same `spawn → registerService → wire signals → unregisterService on exit` structure.

**5. Maintainability assessment:** The pattern is highly maintainable because of its symmetry across wrappers and its minimal surface area. The chief maintainability risk is silent drift: if `api-service.js` or `dashboard-service.js` diverges in how it handles signals, the shared contract becomes implicit-only. Codifying the pattern in a shared helper would mitigate this, but only if doing so does not obscure the clear linear startup sequence that currently makes each wrapper easy to read end-to-end.


## Hierarchy Context

### Parent
- [DashboardWrapper](./DashboardWrapper.md) -- scripts/dashboard-service.js mirrors the structural pattern of api-service.js exactly: spawn via child_process, registerService, wire signals, unregisterService on exit

### Siblings
- [PSMRegistrationLifecycle](./PSMRegistrationLifecycle.md) -- scripts/dashboard-service.js follows the same registerService-on-start / unregisterService-on-exit pattern as api-service.js, indicating a shared PSM contract across all Dockerized services in the project.


---

*Generated from 3 observations*
