# PsmLifecycleRegistration

**Type:** Detail

[Architecture Notes] Both scripts/api-service.js and scripts/dashboard-service.js couple wrapper process lifecycle entirely to child process lifecycle — the wrapper has no independent exit path outside the existsSync guard and spawn 'error' handler; dashboard-service.js has an undocumented compile-time coupling to api-service.js's port configuration via a hardcoded NEXT_PUBLIC_API_BASE_URL, breaking the otherwise consistent env-var-driven configuration pattern; docker/entrypoint.sh cannot execute the host's actual feature resolver (features.yaml is host-only, unmounted) so it reimplements a partial, flat mirror (PROGRAM_FEATURES) whose correctness depends on an external test (tests/features/container-gating.test.mjs) rather than any in-script invariant; lib/service-starter.js separates port/HTTP-health checking (isPortListening), raw TCP checking (isTcpPortListening), and PID liveness (isProcessRunning) into distinct single-purpose helpers composed by startServiceWithRetry(); Unhealthy-process cleanup (SIGTERM→SIGKILL escalation) in startServiceWithRetry() only triggers on a false health check return, not on a thrown exception, leaving an asymmetric leak risk on the exception path

# PsmLifecycleRegistration — Technical Insight Document

## What It Is

PsmLifecycleRegistration is the pattern by which the two `ServiceWrapperScripts` — `scripts/api-service.js` and `scripts/dashboard-service.js` — integrate their spawned child processes with the PSM (process/service management) observability layer. Concretely, it consists of two asymmetric operations per script: a registration call made in an **unawaited async IIFE** placed after `console.log(\`Started (PID: ${child.pid})\`)` (api-service.js:65-83), and an **awaited unregistration call** inside the `child.on('exit', async (code) => {...})` handler that runs before `process.exit(code || 0)` (api-service.js:52-63). Both `ApiServiceWrapper` and `DashboardServiceWrapper` implement this identical scaffolding, making PsmLifecycleRegistration a structural property of the wrapper pattern rather than a feature unique to either script.

## Architecture and Design

The defining architectural trait is **temporal asymmetry built on structural symmetry**: registration is fire-and-forget, unregistration is synchronously awaited. This is a deliberate (if under-examined) trade-off — treating PSM registration as best-effort observability ("Continue anyway - not critical" per the broader Best-effort/optional side-registration pattern) while treating unregistration as a required cleanup step gating process exit. The design favors fast startup (not blocking child spawn on PSM availability) over strict consistency (guaranteeing registration completes before any possible exit).

This creates a genuine, if narrow, race window: if the child crashes quickly, `exit` can fire and invoke `unregisterService` — then `process.exit` — before the registration IIFE's `await psm.initialize()` chain resolves. The result is `unregisterService` being called for a service that was never actually registered. Because both wrapper scripts share this exact ordering, the race is not a one-off bug but an inherent property of the fire-and-forget/awaited-teardown asymmetry.

## Implementation Details

The mechanics hinge on Node's event loop ordering guarantees (or lack thereof) between an unawaited async IIFE and an `on('exit')` callback. The IIFE begins execution synchronously up to its first `await`, then yields control — there is no mechanism forcing it to complete before a subsequent `exit` event's handler runs. This means the registration path and the unregistration path are racing on two independent promise chains with no shared coordination primitive (no mutex, no registration-in-flight flag, no `await` linking the two).

The two sibling scripts diverge slightly in child-invocation mechanics (`ApiServiceWrapper` spawns `node` directly against a resolved path; `DashboardServiceWrapper` spawns `npm run dev`), but the PSM lifecycle scaffolding itself — registration IIFE placement, unregistration-before-exit ordering, signal forwarding — is identical, reinforcing that this is copy-pasted scaffolding rather than a shared abstraction.

## Integration Points

PsmLifecycleRegistration sits within the `ServiceWrapperScripts` parent component, which spawns child processes (e.g., `node src/dashboard-server.js` inside `integrations/constraint-monitor`) with `stdio:'inherit'` and forwards `PORT`/`DASHBOARD_PORT` env vars. The PSM registration/unregistration calls are the wrapper's sole hook into the broader service-observability system — there is no other channel by which the PSM layer learns about these child processes' lifecycle. Notably, this concern is entirely separate from `lib/service-starter.js`'s `startServiceWithRetry()`, which handles retry/health-check orchestration (`withDeadline()`, `isPortListening`, `isProcessRunning`, SIGTERM→SIGKILL escalation) but has no involvement in PSM registration — the two subsystems address different lifecycle concerns (startup reliability vs. observability bookkeeping) without a shared base abstraction, despite both scripts otherwise duplicating identical signal-handling and existsSync guard logic.

## Usage Guidelines

Developers modifying either `api-service.js` or `dashboard-service.js` must apply any PSM lifecycle fix **twice by hand**, since no shared `service-wrapper.js` factory exists to centralize this logic — this is a known maintainability gap even though `lib/service-starter.js` demonstrates that shared utility modules are an established pattern in this codebase for other concerns. Anyone relying on PSM state as a strict source of truth should be aware that registration is best-effort and can lose the race against a fast crash-and-exit sequence; unregistration should be made defensive (tolerating "service not registered" as a non-error) rather than assuming registration always precedes it. Long-term, the fix would be to either await registration before logging "Started," or to guard the exit handler's unregister call with a check that registration actually completed — but any such fix must be applied in both wrapper scripts identically, or the asymmetry between `ApiServiceWrapper` and `DashboardServiceWrapper` will reappear.


## Hierarchy Context

### Parent
- [ServiceWrapperScripts](./ServiceWrapperScripts.md) -- api-service.js spawns `node src/dashboard-server.js` inside integrations/constraint-monitor with stdio:'inherit', propagating PORT and DASHBOARD_PORT env vars into the child

### Siblings
- [ApiServiceWrapper](./ApiServiceWrapper.md) -- [LLM] scripts/api-service.js and scripts/dashboard-service.js implement identical lifecycle scaffolding with only the target artifact, port, and spawn command differing. Both resolve CODING_REPO via `process.env.CODING_REPO || join(__dirname, '..')` (api-service.js:14, dashboard-service.js:14), both guard with `fs.existsSync` before spawning (api-service.js:24-27, dashboard-service.js:24-27), and both wire identical SIGTERM/SIGINT/exit/error handlers. This duplication means any lifecycle fix (e.g., adding a graceful-shutdown timeout, or fixing a PSM registration race) must be applied twice by hand — there is no shared base module like a `service-wrapper.js` factory, even though `lib/service-starter.js` already exists as a shared utility in the same codebase for a different concern (retry/health-check orchestration, not spawn/PSM/signal wiring).
- [DashboardServiceWrapper](./DashboardServiceWrapper.md) -- [LLM] [object Object]


---

*Generated from 10 observations*
