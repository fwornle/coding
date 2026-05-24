# ChildProcessSpawner

**Type:** Detail

scripts/api-service.js uses Node's child_process.spawn (not exec or fork) to launch the Express API, which keeps the child process lifetime directly observable through process lifecycle events (e.g., 'exit', 'error') on the returned ChildProcess handle.

# ChildProcessSpawner

## What It Is

ChildProcessSpawner is the process-launching mechanism implemented in `scripts/api-service.js` that uses Node.js's `child_process.spawn` API to bring up the constraint monitor Express API as a separate OS process. It is a constituent detail of the broader `ConstraintAPIWrapper`, which encapsulates the wrapper's responsibility for owning and supervising the lifecycle of the Express child.

The choice of `spawn` — rather than `exec` or `fork` — is deliberate. `spawn` returns a `ChildProcess` handle whose lifetime is directly observable through standard process lifecycle events such as `'exit'` and `'error'`, and whose `stdout`/`stderr` streams are exposed as readable streams rather than buffered into memory. This makes the spawned Express API observable, supervisable, and stream-addressable from the wrapper.

Within the hierarchy of the constraint API system, ChildProcessSpawner is the lower-level mechanic that enables the higher-level identity contract established by its sibling, `PSMRegistrationLifecycle`. While `PSMRegistrationLifecycle` registers the logical service identity with PSM, ChildProcessSpawner produces the actual OS-level process that binds the port and serves traffic.

## Architecture and Design

The architecture demonstrates a clear **wrapper / supervisor pattern**: `scripts/api-service.js` runs as the long-lived parent process that owns the PSM service identity, while the Express API runs as a separately spawned child that owns the port binding. This separation creates a two-tier process model where logical identity (in PSM) and physical execution (the Express process) are intentionally decoupled. The wrapper-as-parent positioning is what enables this decoupling — by interposing itself between PSM and the Express API, the wrapper can mediate everything that flows between them.

A second design choice evident from the observations is the use of `spawn` as an **observability boundary**. Because `spawn` returns a `ChildProcess` handle, the wrapper retains a programmatic grip on the child's lifecycle events. The wrapper can react to `'exit'` and `'error'` events from the `ChildProcess` and translate them into PSM-visible state transitions, rather than having PSM observe the raw OS process directly. Likewise, by routing stdout/stderr through the wrapper, the architecture allows for stream interception, log enrichment, filtering, or transformation before the output reaches any external observer.

This design also coordinates with its sibling component. `PSMRegistrationLifecycle` ensures that the service is registered with PSM *before* the Express child is spawned, so by the time ChildProcessSpawner produces a `ChildProcess`, there is already a stable logical identity that the new child can be associated with. The OS-level PID returned by `spawn` is therefore subordinate to — and replaceable underneath — the PSM identity owned by the wrapper.

## Implementation Details

The core implementation point is the `child_process.spawn` invocation inside `scripts/api-service.js`. The deliberate selection of `spawn` over its sibling APIs carries specific technical consequences:

- **vs. `exec`**: `spawn` does not buffer output into a callback; it streams `stdout` and `stderr`, which is essential for a long-running Express server whose output cannot be bounded by a buffer.
- **vs. `fork`**: `spawn` launches an arbitrary executable rather than a Node module connected via IPC channel, which keeps the Express API's runtime fully independent and inspectable as an OS process rather than as a coupled child Node process.

The returned `ChildProcess` handle is the primary integration surface inside the wrapper. Through it, `api-service.js` can attach listeners for `'exit'` (to detect normal or abnormal termination, with exit code and signal information) and `'error'` (to detect spawn failures such as missing executables or permission issues). These events are the raw material that the wrapper translates into PSM-visible lifecycle state.

A subtle but important implementation detail is the separation of the OS-level PID of the Express child from the service identity registered with PSM. The PSM identity belongs to the wrapper process; the PID returned by `spawn` belongs to the child. This means restarts of the Express child do not invalidate the PSM identity, and PSM consumers do not need to track changing PIDs to maintain a stable reference to the service.

## Integration Points

ChildProcessSpawner integrates with three concentric layers of the system. Internally, it integrates with the Node.js standard library through the `child_process` module — specifically the `spawn` function — and with the resulting `ChildProcess` object's event emitter interface and stream interfaces (`stdout`, `stderr`).

Upward within the wrapper, it integrates with the rest of `ConstraintAPIWrapper`, providing the `ChildProcess` handle that the wrapper uses to enforce supervision policy. Sideways, it has an implicit ordering dependency on `PSMRegistrationLifecycle`: registration with PSM occurs in `api-service.js` *before* the Express child is spawned, ensuring that the logical identity in the PSM registry is already in place when the child comes up and binds its port.

Externally, ChildProcessSpawner indirectly integrates with PSM and any other observers of the constraint monitor service. These external systems never see the Express child's OS PID directly; they see the PSM-registered identity owned by the wrapper. The intercepted stdout/stderr streams and proxied lifecycle events form the contract by which external systems learn about the Express API's state.

## Usage Guidelines

Developers working with or modifying ChildProcessSpawner should preserve several invariants implied by the current design:

1. **Continue to use `spawn`, not `exec` or `fork`.** Switching to `exec` would lose stream-based stdout/stderr access and risk buffer exhaustion for a long-running server. Switching to `fork` would couple the Express API to the Node IPC channel and change the process model.
2. **Keep the wrapper as the spawn parent.** Running the Express API directly (without `api-service.js` as the parent) would collapse the observability boundary and expose the Express process's PID as the externally visible identity, breaking the decoupling that PSM relies on.
3. **Do not expose the child's OS-level PID as a service identifier.** The PSM identity, owned by the wrapper, is the canonical service identity. Treat the child PID as a private supervision detail.
4. **Preserve the ordering with `PSMRegistrationLifecycle`.** PSM registration in `api-service.js` should remain ahead of the `spawn` call so that the logical identity is established before any child-level events need to be reported.
5. **Always wire `'exit'` and `'error'` handlers on the returned `ChildProcess`.** These are the mechanisms by which the wrapper enforces supervision and translates child lifecycle events into PSM-visible state changes. Leaving them unattached would silently drop crash signals from the Express API.

When extending the wrapper — for example, to add log shipping, restart-on-crash behavior, or structured event reporting — implement these behaviors against the `ChildProcess` handle inside `scripts/api-service.js` rather than inside the Express API itself, so that the wrapper remains the single point of supervision.

---

### Summary

1. **Architectural patterns identified**: wrapper/supervisor over a spawned child; decoupling of logical identity (PSM) from physical process (PID); stream-and-event interception boundary at the parent process.
2. **Design decisions and trade-offs**: choosing `spawn` over `exec` (streamed I/O, no buffer limits) and over `fork` (independent OS process, no IPC coupling); accepting the cost of an extra process (the wrapper) in exchange for stable identity and centralized supervision.
3. **System structure insights**: `ConstraintAPIWrapper` cleanly partitions concerns between `PSMRegistrationLifecycle` (identity) and ChildProcessSpawner (execution), with a strict temporal ordering between them inside `scripts/api-service.js`.
4. **Scalability considerations**: the single-wrapper / single-child model is per-instance; horizontal scaling would replicate wrapper+child pairs, each with its own PSM identity, preserving the decoupling at scale.
5. **Maintainability assessment**: the design is highly maintainable because supervision, logging, and lifecycle translation are concentrated in `scripts/api-service.js` and pivot on a single `ChildProcess` handle, giving future maintainers one well-defined location to extend supervision behavior without touching the Express API itself.


## Hierarchy Context

### Parent
- [ConstraintAPIWrapper](./ConstraintAPIWrapper.md) -- scripts/api-service.js uses Node's child_process module to spawn the constraint monitor Express API, decoupling the OS-level PID from the service identity tracked by PSM

### Siblings
- [PSMRegistrationLifecycle](./PSMRegistrationLifecycle.md) -- api-service.js registers the service with PSM prior to spawning the Express API child process, establishing a stable logical identity in the PSM registry that persists independently of the child's OS-level PID.


---

*Generated from 3 observations*
